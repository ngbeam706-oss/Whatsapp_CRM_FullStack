// @ts-check
// One "complete this chat" call across AI providers.
//   anthropic          - official Anthropic SDK (prompt caching, low effort, refusal fallback on supported models)
//   openai             - OpenAI Chat Completions
//   openai_compatible  - any service with the OpenAI Chat Completions API (Groq, OpenRouter, Mistral, DeepSeek, ...)
//   gemini             - Google Gemini generateContent
// Every call returns { text } | { refusal: true } | { error }.
const Anthropic = require('@anthropic-ai/sdk').default;

/** @typedef {{ role: 'user' | 'assistant', content: string }} ChatTurn */
/** @typedef {{ text: string, refusal?: undefined, error?: undefined } | { refusal: true, text?: undefined, error?: undefined } | { error: string, text?: undefined, refusal?: undefined }} CompleteResult */
/**
 * @typedef {{ apiKey: string, model: string, system: string, messages: ChatTurn[], timeoutMs: number, maxTokens: number }} CallArgs
 * @typedef {{ status?: number, ok?: boolean, data?: any, timeout?: boolean, networkError?: string }} HttpResult
 */

/** @type {Record<string, { label: string, defaultModel: string }>} */
const PROVIDERS = {
  anthropic: { label: 'Anthropic Claude', defaultModel: 'claude-opus-5-5' },
  openai: { label: 'OpenAI', defaultModel: '' },
  gemini: { label: 'Google Gemini', defaultModel: '' },
  openai_compatible: { label: 'Other (OpenAI-compatible)', defaultModel: '' },
};

// ---------------------------------------------------------------------------
// Base URL safety (owner-entered URL that the server will call)
// ---------------------------------------------------------------------------
// Local testing only: ALLOW_PRIVATE_AI_URL=true lets the owner point at an http:// gateway on the
// office network (e.g. http://192.168.1.29:8000/v1). Never set it on the live site.
const allowPrivateAiUrl = () => process.env.ALLOW_PRIVATE_AI_URL === 'true';

/** @param {unknown} raw @returns {{ error: string, url?: undefined } | { error?: undefined, url: string }} */
function checkBaseUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { return { error: 'Enter the provider\'s API base URL, e.g. https://api.example.com/v1' }; }
  if (allowPrivateAiUrl() && (u.protocol === 'http:' || u.protocol === 'https:')) {
    return { url: u.toString().replace(/\/+$/, '') };
  }
  if (u.protocol !== 'https:') return { error: 'The base URL must start with https://' };
  const host = u.hostname.toLowerCase();
  const privateHost = host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')
    || /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    || host === '[::1]' || host.startsWith('[fc') || host.startsWith('[fd') || host.startsWith('[fe80');
  if (privateHost) return { error: 'The base URL must be a public internet address.' };
  return { url: u.toString().replace(/\/+$/, '') };
}

// ---------------------------------------------------------------------------
// Anthropic (SDK)
// ---------------------------------------------------------------------------
/** @type {(apiKey: string) => any} */
let anthropicFactory = (apiKey) => new Anthropic({ apiKey });
/** Tests replace the SDK client. @param {(apiKey: string) => any} fn */
function _setAnthropicFactory(fn) { anthropicFactory = fn; }

/** Server-side refusal fallback is available on these Claude models. @param {string} model */
const supportsFallback = (model) => /^claude-(opus-5|fable-5|sonnet-5-5)/.test(model);

/** @param {CallArgs} args @returns {Promise<CompleteResult>} */
async function anthropicComplete({ apiKey, model, system, messages, timeoutMs, maxTokens }) {
  // Plain object: some fields (effort, server-side fallback) are newer than the SDK's types.
  /** @type {Record<string, any>} */
  const params = {
    model,
    max_tokens: maxTokens,
    // Short, routine replies: low effort keeps them fast and cheap.
    output_config: { effort: 'low' },
    // The menu + knowledge block is the same for every customer: cache it.
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages,
  };
  if (supportsFallback(model)) {
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }
  try {
    const res = await anthropicFactory(apiKey).beta.messages.create(params, { timeout: timeoutMs, maxRetries: 0 });
    if (res.stop_reason === 'refusal') return { refusal: true };
    return { text: (res.content || []).filter((/** @type {any} */ b) => b.type === 'text').map((/** @type {any} */ b) => b.text).join('').trim() };
  } catch (err) {
    if (err instanceof Anthropic.APIConnectionTimeoutError) return { error: 'timeout' };
    if (err instanceof Anthropic.AuthenticationError) return { error: 'The API key was rejected by Anthropic.' };
    if (err instanceof Anthropic.NotFoundError) return { error: `Anthropic doesn't recognise the model "${model}".` };
    if (err instanceof Anthropic.RateLimitError) return { error: 'rate_limited' };
    if (err instanceof Anthropic.APIError) return { error: `Anthropic error ${err.status ?? ''}: ${err.message}`.slice(0, 300) };
    return { error: (err instanceof Error && err.message) || 'Request failed' };
  }
}

// ---------------------------------------------------------------------------
// HTTP providers (OpenAI, OpenAI-compatible, Gemini)
// ---------------------------------------------------------------------------
/**
 * @param {string} url @param {Record<string, string>} headers @param {unknown} body @param {number} timeoutMs
 * @returns {Promise<HttpResult>}
 */
async function postJson(url, headers, body, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON error page */ }
    return { status: res.status, ok: res.ok, data };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return { timeout: true };
    return { networkError: (err instanceof Error && err.message) || 'network error' };
  } finally {
    clearTimeout(timer);
  }
}

/** @param {string} provider @param {HttpResult} r @param {string} model @returns {{ error: string }} */
function httpError(provider, r, model) {
  if (r.timeout) return { error: 'timeout' };
  if (r.networkError) return { error: `Could not reach ${provider}: ${r.networkError}` };
  const msg = r.data?.error?.message || r.data?.message || (typeof r.data?.error === 'string' ? r.data.error : '') || `HTTP ${r.status}`;
  if (r.status === 401 || r.status === 403) return { error: `The API key was rejected by ${provider}.` };
  if (r.status === 404) return { error: `${provider} doesn't recognise the model "${model}" (or the base URL is wrong).` };
  if (r.status === 429) return { error: 'rate_limited' };
  return { error: `${provider} error: ${String(msg).slice(0, 250)}` };
}

/** @param {CallArgs & { baseUrl: string, label: string }} args @returns {Promise<CompleteResult>} */
async function openaiComplete({ apiKey, model, baseUrl, system, messages, timeoutMs, maxTokens, label }) {
  const r = await postJson(`${baseUrl}/chat/completions`, { Authorization: `Bearer ${apiKey}` }, {
    model,
    messages: [{ role: 'system', content: system }, ...messages],
    max_completion_tokens: maxTokens,
  }, timeoutMs);
  if (!r.ok) return httpError(label, r, model);
  const msg = r.data?.choices?.[0]?.message;
  if (msg?.refusal) return { refusal: true };
  const content = Array.isArray(msg?.content) ? msg.content.map((/** @type {any} */ p) => p.text || '').join('') : msg?.content;
  return { text: String(content || '').trim() };
}

/** @param {CallArgs} args @returns {Promise<CompleteResult>} */
async function geminiComplete({ apiKey, model, system, messages, timeoutMs, maxTokens }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const r = await postJson(url, { 'x-goog-api-key': apiKey }, {
    systemInstruction: { parts: [{ text: system }] },
    contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    generationConfig: { maxOutputTokens: maxTokens },
  }, timeoutMs);
  if (!r.ok) return httpError('Google Gemini', r, model);
  const cand = r.data?.candidates?.[0];
  if (!cand && r.data?.promptFeedback?.blockReason) return { refusal: true };
  if (cand?.finishReason === 'SAFETY') return { refusal: true };
  return { text: (cand?.content?.parts || []).map((/** @type {any} */ p) => p.text || '').join('').trim() };
}

// ---------------------------------------------------------------------------

/**
 * cfg: { provider, apiKey, model, baseUrl }
 * messages: [{ role: 'user'|'assistant', content: string }], starting with 'user'
 * @param {{ provider?: string, apiKey?: string | null, model?: string, baseUrl?: string | null } | null | undefined} cfg
 * @param {{ system: string, messages: ChatTurn[], timeoutMs?: number, maxTokens?: number }} request
 * @returns {Promise<CompleteResult>}
 */
async function complete(cfg, { system, messages, timeoutMs = 8000, maxTokens = 2048 }) {
  if (!cfg?.apiKey) return { error: 'No API key saved.' };
  if (!cfg.model) return { error: 'No model chosen.' };
  const args = { apiKey: cfg.apiKey, model: cfg.model, system, messages, timeoutMs, maxTokens };
  switch (cfg.provider) {
    case 'anthropic':
      return anthropicComplete(args);
    case 'openai':
      return openaiComplete({ ...args, baseUrl: 'https://api.openai.com/v1', label: 'OpenAI' });
    case 'openai_compatible': {
      const b = checkBaseUrl(cfg.baseUrl);
      if (b.error !== undefined) return { error: b.error };
      return openaiComplete({ ...args, baseUrl: b.url, label: 'the provider' });
    }
    case 'gemini':
      return geminiComplete(args);
    default:
      return { error: 'Unknown AI provider.' };
  }
}

module.exports = { PROVIDERS, checkBaseUrl, complete, supportsFallback, _setAnthropicFactory };
