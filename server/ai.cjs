// @ts-check
// AI assistant: answers free-text customer questions from the bot menu + the owner's
// knowledge notes, hands over to staff when it shouldn't answer, and drafts replies
// for agents in the inbox. The provider (Claude, OpenAI, Gemini, any OpenAI-compatible
// service), model and API key are chosen by the owner in the dashboard (ai_provider table).
const { dbRequest } = require('./db.cjs');
const llm = require('./llm.cjs');
const secrets = require('./secrets.cjs');
const { requireBusinessId } = require('./tenant.cjs');

const HANDOVER_PREFIX = 'HANDOVER:';
const REPLY_TIMEOUT_MS = 8000;   // webhook path: the customer is waiting, and Netlify functions are short-lived
const DRAFT_TIMEOUT_MS = 25000;  // dashboard drafts can take longer
const MAX_HISTORY = 12;

/** @typedef {import('./types.cjs').Staff} Staff */
/** @typedef {import('./types.cjs').Catalog} Catalog */
/** @typedef {import('./types.cjs').BotRule} BotRule */
/** @typedef {import('./llm.cjs').ChatTurn} ChatTurn */
/** @typedef {import('./llm.cjs').CompleteResult} CompleteResult */
/** @typedef {Record<string, any>} Input  request body fields (each function checks what it uses) */
/**
 * @typedef {{ provider: string, model: string, baseUrl: string, apiKey: string | null, keyLast4: string | null,
 *   keyUnreadable: boolean, updatedBy: string | null, tableMissing: boolean }} Provider
 * @typedef {{ auto_reply?: boolean, knowledge?: string, instructions?: string, business_name?: string, [key: string]: any }} AiSettings
 * @typedef {{ direction: string, body?: string | null, timestamp?: string }} HistoryRow
 * @typedef {{ reply: string, handover?: undefined, skip?: undefined, reason?: undefined }
 *   | { handover: true, reason: string, reply?: undefined, skip?: undefined }
 *   | { skip: true, reason: string, reply?: undefined, handover?: undefined }} Decision
 */

/** @param {unknown} s */
const clean = (s) => String(s || '').replace(/^[^\p{L}\p{N}]+/u, '').trim();

// ---------------------------------------------------------------------------
// Provider settings (server-only table, key stored encrypted)
// ---------------------------------------------------------------------------
// businessId -> { at, value }. Each business has its own provider, key and settings.
/** @type {Map<string, { at: number, value: Provider }>} */
const providerCache = new Map();

/** @param {string} businessId @param {{ fresh?: boolean }} [options] @returns {Promise<Provider>} */
async function getProvider(businessId, { fresh = false } = {}) {
  requireBusinessId(businessId);
  const hit = providerCache.get(businessId);
  if (!fresh && hit && Date.now() - hit.at < 60000) return hit.value;
  const res = await dbRequest(`ai_provider?business_id=eq.${businessId}&select=provider,model,base_url,api_key_enc,key_last4,updated_by,updated_at`);
  const row = res.ok && res.data?.[0] ? res.data[0] : { provider: 'anthropic', model: '' };
  const value = {
    provider: row.provider || 'anthropic',
    model: row.model || '',
    baseUrl: row.base_url || '',
    apiKey: row.api_key_enc ? secrets.decrypt(row.api_key_enc) : null,
    keyLast4: row.key_last4 || null,
    keyUnreadable: !!row.api_key_enc && !secrets.decrypt(row.api_key_enc),
    updatedBy: row.updated_by || null,
    tableMissing: !res.ok,
  };
  providerCache.set(businessId, { at: Date.now(), value });
  return value;
}

/** What the dashboard may see about the provider: never the key itself. @param {string} businessId */
async function providerStatus(businessId) {
  const p = await getProvider(businessId, { fresh: true });
  return {
    configured: !!(p.apiKey && p.model),
    provider: p.provider,
    providerLabel: llm.PROVIDERS[p.provider]?.label || p.provider,
    model: p.model,
    baseUrl: p.baseUrl,
    keyLast4: p.keyLast4,
    keyUnreadable: p.keyUnreadable,
    updatedBy: p.updatedBy,
    tableMissing: p.tableMissing,
    encryptionReady: secrets.canEncrypt(),
    providers: Object.entries(llm.PROVIDERS).map(([id, v]) => ({ id, label: v.label, defaultModel: v.defaultModel })),
  };
}

/**
 * @param {Input} [input]
 * @returns {{ error: string, provider?: undefined, model?: undefined, baseUrl?: undefined, apiKey?: undefined }
 *   | { error?: undefined, provider: string, model: string, baseUrl: string | null, apiKey: string }}
 */
function validateProviderInput(input = {}) {
  const provider = String(input.provider || '');
  if (!llm.PROVIDERS[provider]) return { error: 'Choose a provider.' };
  const model = String(input.model || '').trim();
  if (!model || model.length > 120 || /\s/.test(model)) return { error: 'Enter the model name exactly as your provider lists it (no spaces).' };
  /** @type {string | null} */
  let baseUrl = null;
  if (provider === 'openai_compatible') {
    const b = llm.checkBaseUrl(input.baseUrl);
    if (b.error !== undefined) return { error: b.error };
    baseUrl = b.url;
  }
  const apiKey = String(input.apiKey || '').trim();
  if (apiKey && (apiKey.length < 8 || apiKey.length > 500 || /\s/.test(apiKey))) return { error: 'That API key doesn\'t look right.' };
  return { provider, model, baseUrl, apiKey };
}

/** Owner saves provider/model and optionally a new key (blank = keep the saved one). @param {Input} input @param {Staff} staff */
async function saveProvider(input, staff) {
  input = input || {};
  const biz = requireBusinessId(staff?.businessId);
  if (input.removeKey) {
    const res = await dbRequest(`ai_provider?business_id=eq.${biz}`, {
      method: 'PATCH', prefer: 'return=minimal',
      body: { api_key_enc: null, key_last4: null, updated_by: staff.email, updated_at: new Date().toISOString() },
    });
    if (!res.ok) return { error: 'Could not remove the key.' };
    providerCache.delete(biz);
    return { status: await providerStatus(biz) };
  }
  const v = validateProviderInput(input);
  if (v.error !== undefined) return v;
  /** @type {Record<string, unknown>} */
  const body = { business_id: biz, provider: v.provider, model: v.model, base_url: v.baseUrl, updated_by: staff.email, updated_at: new Date().toISOString() };
  if (v.apiKey) {
    if (!secrets.canEncrypt()) return { error: 'The server has no encryption secret (APP_SECRET), so the key can\'t be stored safely.' };
    body.api_key_enc = secrets.encrypt(v.apiKey);
    body.key_last4 = v.apiKey.slice(-4);
  } else {
    const current = await getProvider(biz, { fresh: true });
    if (current.provider !== v.provider && current.apiKey) {
      return { error: 'You changed provider: paste the API key for the new provider (keys only work with the service that issued them).' };
    }
  }
  const res = await dbRequest('ai_provider?on_conflict=business_id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body });
  if (!res.ok) return { error: 'Could not save. Has the M2 SQL been run?' };
  providerCache.delete(biz);
  return { status: await providerStatus(biz) };
}

/** Owner checks a provider/model/key before saving or switching auto-replies on. @param {string} businessId @param {Input} [input] */
async function testProvider(businessId, input = {}) {
  const v = validateProviderInput(input);
  if (v.error !== undefined) return v;
  const saved = await getProvider(businessId, { fresh: true });
  const apiKey = v.apiKey || (saved.provider === v.provider ? saved.apiKey : null);
  if (!apiKey) return { error: 'Paste an API key to test (or save one first).' };
  const r = await llm.complete({ provider: v.provider, model: v.model, baseUrl: v.baseUrl, apiKey }, {
    system: 'You are a connection test. Reply with the single word OK.',
    messages: [{ role: 'user', content: 'Say OK.' }],
    timeoutMs: DRAFT_TIMEOUT_MS,
    maxTokens: 1024,
  });
  if (r.error) return { error: r.error === 'timeout' ? 'No answer within 25 seconds. The model may be too slow for WhatsApp replies.' : r.error === 'rate_limited' ? 'The provider says you are rate-limited or out of credit.' : r.error };
  if (r.refusal) return { ok: true, note: 'Connected (the model declined the test prompt, but the key and model work).' };
  return { ok: true, sample: String(r.text || '').slice(0, 100) };
}

/** Tests reset the caches. */
function _resetCache() {
  settingsCache.clear();
  providerCache.clear();
}

// ---------------------------------------------------------------------------
// Settings (one ai_settings row per business), cached for a minute per function instance
// ---------------------------------------------------------------------------
/** @type {Map<string, { at: number, value: AiSettings }>} */
const settingsCache = new Map(); // businessId -> { at, value }
/** @type {AiSettings} */
const DEFAULT_SETTINGS = { auto_reply: false, knowledge: '', instructions: '' };

/** @param {string} businessId @param {{ fresh?: boolean }} [options] @returns {Promise<AiSettings>} */
async function getSettings(businessId, { fresh = false } = {}) {
  requireBusinessId(businessId);
  const hit = settingsCache.get(businessId);
  if (!fresh && hit && Date.now() - hit.at < 60000) return hit.value;
  const [res, biz] = await Promise.all([
    dbRequest(`ai_settings?business_id=eq.${businessId}&select=auto_reply,knowledge,instructions,updated_by,updated_at`),
    dbRequest(`businesses?id=eq.${businessId}&select=name`),
  ]);
  /** @type {AiSettings} */
  const value = res.ok && res.data?.[0] ? res.data[0] : { ...DEFAULT_SETTINGS };
  value.business_name = biz.ok && biz.data?.[0]?.name ? biz.data[0].name : '';
  settingsCache.set(businessId, { at: Date.now(), value });
  return value;
}

/** @param {Input} input @param {Staff} staff */
async function saveSettings(input, staff) {
  input = input || {};
  const biz = requireBusinessId(staff?.businessId);
  /** @type {Record<string, unknown>} */
  const body = { business_id: biz, updated_by: staff.email, updated_at: new Date().toISOString() };
  if ('autoReply' in input) {
    body.auto_reply = !!input.autoReply;
    if (body.auto_reply && !(await require('./limits.cjs').getPlan(biz)).limits.ai_enabled) {
      return { error: 'Your plan doesn\'t include AI replies. Ask the platform to upgrade your plan.', limitReached: true };
    }
  }
  if ('knowledge' in input) body.knowledge = String(input.knowledge || '').slice(0, 20000);
  if ('instructions' in input) body.instructions = String(input.instructions || '').slice(0, 4000);
  const res = await dbRequest('ai_settings?on_conflict=business_id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body,
  });
  if (!res.ok) return { error: 'Could not save. Has the M2 SQL been run?' };
  settingsCache.delete(biz);
  return { settings: res.data[0] };
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

/** The bot catalog as plain text: the only product facts the assistant may use. @param {Catalog} [catalog] */
function catalogText(catalog = {}) {
  /** @type {string[]} */
  const lines = [];
  /** @param {string} title @param {any[] | undefined} items @param {boolean} [withDetails] */
  const section = (title, items, withDetails = false) => {
    if (!items?.length) return;
    lines.push(`\n## ${title}`);
    for (const i of items) {
      lines.push(`- ${clean(i.title)}${i.price ? ` - ₹${i.price}` : ''}: ${i.description || ''}`.trim());
      if (withDetails && i.details) lines.push(`  Details: ${String(i.details).replace(/\s+/g, ' ').trim()}`);
    }
  };
  section('Our services and products', catalog.menuItems, true);
  section('28-day diet kits', catalog.dietKits, true);
  section('Ready to eat (RTE) - vegetarian', catalog.rteVegItems);
  section('Ready to eat (RTE) - non-vegetarian', catalog.rteNonVegItems);
  section('Ready to cook (RTC) - vegetarian', catalog.rtcVegItems);
  section('Ready to cook (RTC) - non-vegetarian', catalog.rtcNonVegItems);
  return lines.join('\n').trim();
}

/**
 * The bot's own words: keyword-rule replies and the main flow messages. The assistant uses them
 * as approved answers, so AI replies match what the flow would say.
 * @param {Catalog} [catalog] @param {BotRule[]} [rules]
 */
function flowText(catalog = {}, rules = []) {
  /** @param {unknown} s */
  const one = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  /** @type {string[]} */
  const lines = [];
  const active = (rules || []).filter(r => r && r.isActive !== false && one(r.keyword) && one(r.responseText));
  if (active.length) {
    lines.push('## Our standard replies (keyword rules)');
    for (const r of active) {
      const buttons = Array.isArray(r.buttons) && r.buttons.length ? ` (menu options: ${r.buttons.map(b => clean(b.title)).filter(Boolean).join(', ')})` : '';
      lines.push(`- When a customer says "${one(r.keyword)}", we reply: ${one(r.responseText)}${buttons}`);
    }
  }
  const msgs = [
    ['Welcome message', catalog.welcomeMessage],
    ['When they open our services list', Array.isArray(catalog.menuItems) && catalog.menuItems.length ? catalog.menuPrompt : ''],
    ['When they open the diet kits', Array.isArray(catalog.dietKits) && catalog.dietKits.length ? catalog.dietKitsPrompt : ''],
    ['After an order enquiry', catalog.orderConfirmReply],
    ['When they ask for our team', catalog.staffNotificationReply],
  ].filter(([, t]) => one(t));
  if (msgs.length) {
    lines.push('', '## Our bot flow messages');
    for (const [label, t] of msgs) lines.push(`- ${label}: ${one(t)}`);
  }
  const mainMenu = (catalog.welcomeButtons || []).map((/** @type {{ title?: string }} */ b) => clean(b.title)).filter(Boolean);
  if (mainMenu.length) lines.push(`- Main menu options: ${mainMenu.join(', ')}`);
  return lines.join('\n').trim();
}

/** @param {Catalog} catalog @param {AiSettings} settings @param {BotRule[]} [rules] */
function systemPrompt(catalog, settings, rules = []) {
  return [
    `You are the WhatsApp assistant for ${settings.business_name || 'our business'}. What we offer is described in the business information below.`,
    '',
    'How to answer:',
    '- Use only the business information below. Never invent items, prices, offers, delivery areas, timings or policies. If the answer is not in the information, hand over.',
    '- No health or medical claims. Never say a food or kit cures, treats, controls, reverses, prevents or manages any disease or condition (for example diabetes, PCOS, thyroid, heart or gut problems), even if a product name suggests it. Describe only what is included (ingredients, portions, routine, service steps). For medical questions, suggest they check with their doctor, and hand over so a person from our team can help.',
    '- Keep replies short: at most 4 short lines, friendly, plain WhatsApp text. *Bold* is fine; no headings, no tables, no links unless they appear in the information.',
    '- Reply in the language the customer writes in (English, Telugu or Hindi, including Telugu or Hindi typed in English letters).',
    '- You cannot take orders, payments or addresses yourself. To browse or order, tell them to tap *Main menu* below your message; the team then confirms the details.',
    '- A plain greeting gets a short welcome (in the spirit of our welcome message) and a suggestion to tap *Main menu* below.',
    '- When a question matches one of our standard replies or flow messages below, give that same information in your own short words, so customers hear one consistent answer.',
    '- Every reply you send automatically shows two buttons under it: *Main menu* and *Connect with staff*. Do not write out any other buttons or options as if they were clickable.',
    '',
    `Hand over to a person when: it is a complaint, refund, or a problem with an existing order or delivery; they ask about a bulk, custom or party order; they ask a medical question; they ask for a person; or you are unsure. To hand over, reply with exactly one line: "${HANDOVER_PREFIX} <short reason for our staff>" and nothing else.`,
    '',
    '# Business information',
    '',
    '## Menu and prices (from the WhatsApp bot)',
    catalogText(catalog) || '(no menu configured)',
    '',
    flowText(catalog, rules),
    '',
    '## More information from the owner',
    settings.knowledge?.trim() || '(none provided)',
    ...(settings.instructions?.trim() ? ['', '## Extra instructions from the owner', settings.instructions.trim()] : []),
  ].join('\n');
}

/**
 * Recent chat as Claude messages: customer = user, business = assistant; must start with the customer.
 * @param {HistoryRow[]} rows @returns {ChatTurn[]}
 */
function historyToMessages(rows) {
  /** @type {ChatTurn[]} */
  const msgs = rows
    .filter(r => String(r.body || '').trim())
    .map(r => ({ role: r.direction === 'inbound' ? 'user' : 'assistant', content: String(r.body).slice(0, 2000) }));
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  return msgs;
}

/** @param {string} businessId @param {string} phone @returns {Promise<HistoryRow[]>} */
async function recentHistory(businessId, phone) {
  requireBusinessId(businessId);
  const res = await dbRequest(`whatsapp_messages?select=direction,body,timestamp&business_id=eq.${businessId}&contact_phone=eq.${encodeURIComponent(phone)}&order=timestamp.desc&limit=${MAX_HISTORY}`);
  return res.ok ? res.data.reverse() : [];
}

// ---------------------------------------------------------------------------
// Calling the chosen model
// ---------------------------------------------------------------------------

/**
 * @param {string} businessId @param {{ system: string, messages: ChatTurn[], timeoutMs: number }} request
 * @returns {Promise<CompleteResult>}
 */
async function callModel(businessId, { system, messages, timeoutMs }) {
  const p = await getProvider(businessId);
  if (!p.apiKey || !p.model) return { error: 'not configured' };
  const r = await llm.complete({ provider: p.provider, model: p.model, baseUrl: p.baseUrl, apiKey: p.apiKey }, { system, messages, timeoutMs, maxTokens: 2048 });
  // Provider failures go to the Platform Admin's event log (provider + error text, never the chat).
  if (r.error) {
    await require('./events.cjs').logEvent({
      level: 'error', source: 'ai', businessId,
      code: r.error === 'timeout' || r.error === 'rate_limited' ? r.error : 'provider_error',
      message: r.error, details: { provider: p.provider, model: p.model },
    });
  }
  return r;
}

/** Turn the model's text into a decision. @param {CompleteResult} result @returns {Decision} */
function interpret(result) {
  if (result.error !== undefined) return { skip: true, reason: result.error };
  if (result.refusal) return { handover: true, reason: 'The assistant declined to answer this message.' };
  const text = String(result.text || '').trim();
  if (!text) return { skip: true, reason: 'empty reply' };
  const idx = text.toUpperCase().indexOf(HANDOVER_PREFIX);
  if (idx !== -1 && idx < 5) return { handover: true, reason: text.slice(idx + HANDOVER_PREFIX.length).trim().slice(0, 300) || 'Needs a person' };
  return { reply: text.slice(0, 1500) };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Answer the customer's latest message (already saved to the chat history).
 * Returns { reply } | { handover, reason } | { skip, reason } (skip = fall back to the menu).
 */
/** The "AI replies" switch. Read fresh so turning it on or off takes effect on the next message. @param {string} businessId */
async function isAutoReplyOn(businessId) {
  try { return !!(await getSettings(businessId, { fresh: true })).auto_reply; } catch { return false; }
}

/** Keyword rules the assistant may quote (failures just mean fewer examples). @param {string} businessId @returns {Promise<BotRule[]>} */
async function activeRules(businessId) {
  try { return await require('./botStore.cjs').getActiveBotRules(businessId); } catch { return []; }
}

/** @param {{ businessId: string, phone: string, catalog: Catalog }} args @returns {Promise<Decision>} */
async function answerCustomer({ businessId, phone, catalog }) {
  const settings = await getSettings(businessId);
  if (!settings.auto_reply) return { skip: true, reason: 'auto-reply is off' };
  // Plan: AI included, and AI replies left this month? If not, the bot flow answers instead.
  const allowed = await require('./limits.cjs').aiAllowed(businessId);
  if (!allowed.ok) return { skip: true, reason: allowed.reason || 'AI replies are not available on this plan' };
  const messages = historyToMessages(await recentHistory(businessId, phone));
  if (!messages.length || messages[messages.length - 1].role !== 'user') return { skip: true, reason: 'no customer message' };
  return interpret(await callModel(businessId, { system: systemPrompt(catalog, settings, await activeRules(businessId)), messages, timeoutMs: REPLY_TIMEOUT_MS }));
}

/**
 * Owner's "try a question" box: same prompt, nothing is sent to anyone. Works even when auto-reply is off.
 * @param {{ businessId: string, question: unknown, catalog: Catalog }} args
 */
async function testQuestion({ businessId, question, catalog }) {
  const q = String(question || '').trim().slice(0, 1000);
  if (!q) return { error: 'Type a question.' };
  const settings = await getSettings(businessId, { fresh: true });
  const r = interpret(await callModel(businessId, { system: systemPrompt(catalog, settings, await activeRules(businessId)), messages: [{ role: 'user', content: q }], timeoutMs: DRAFT_TIMEOUT_MS }));
  if (r.skip) return { error: r.reason === 'timeout' ? 'The AI took too long. Try again.' : r.reason === 'not configured' ? 'Choose a provider and save an API key first.' : r.reason };
  return r;
}

/** Draft the next reply for a staff member to review, edit and send. @param {{ businessId: string, phone: string, catalog: Catalog }} args */
async function draftReply({ businessId, phone, catalog }) {
  const settings = await getSettings(businessId);
  const rows = await recentHistory(businessId, phone);
  if (!rows.length) return { error: 'No messages in this chat yet.' };
  const transcript = rows.map(r => `${r.direction === 'inbound' ? 'Customer' : 'Business'}: ${String(r.body || '').slice(0, 600)}`).join('\n');
  const result = await callModel(businessId, {
    system: systemPrompt(catalog, settings, await activeRules(businessId)),
    messages: [{
      role: 'user',
      content: `Here is the recent WhatsApp conversation with a customer:\n\n${transcript}\n\nWrite the next message our staff member should send, following the rules above. A person will review and send it, so do not hand over: if the information doesn't cover something, write a polite reply that says the team will check and get back. Reply with the message text only.`,
    }],
    timeoutMs: DRAFT_TIMEOUT_MS,
  });
  if (result.error !== undefined) return { error: result.error === 'timeout' ? 'The AI took too long. Try again.' : result.error === 'not configured' ? 'The AI assistant isn\'t set up yet (owner: AI page).' : result.error };
  if (result.refusal) return { error: 'The assistant could not draft a reply for this chat.' };
  const text = String(result.text || '').replace(new RegExp(`^${HANDOVER_PREFIX}\\s*`, 'i'), '').trim();
  return text ? { draft: text.slice(0, 1500) } : { error: 'Empty draft. Try again.' };
}

module.exports = {
  HANDOVER_PREFIX,
  catalogText,
  flowText,
  isAutoReplyOn,
  systemPrompt,
  historyToMessages,
  interpret,
  getProvider,
  providerStatus,
  saveProvider,
  testProvider,
  validateProviderInput,
  getSettings,
  saveSettings,
  answerCustomer,
  testQuestion,
  draftReply,
  _resetCache,
};
