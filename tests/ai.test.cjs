// AI assistant, providers, key encryption, keyword matching.
// Every AI provider and the database are faked: no network.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

process.env.VITE_SUPABASE_URL = 'http://fake.supabase';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
process.env.APP_SECRET = 'test_app_secret_with_enough_length';
process.env.SETTINGS_ENCRYPTION_KEY = '';

const Anthropic = require('@anthropic-ai/sdk').default;
const secrets = require('../server/secrets.cjs');
const llm = require('../server/llm.cjs');
const ai = require('../server/ai.cjs');
const { hasWord } = require('../server/bot.cjs');
const { DEFAULT_CATALOG } = require('../server/defaults.cjs');

const BIZ = 'a0000000-0000-4000-8000-000000000001';
const boss = { id: 'u1', email: 'owner@arogya.in', role: 'owner', businessId: BIZ };

// ---- fake database + fake HTTP providers ------------------------------------------
let settings;
let providerRow;
let history;
let httpCalls;
let httpReply;
beforeEach(() => {
  settings = { auto_reply: true, knowledge: 'Delivery in Kukatpally and Miyapur only.', instructions: '' };
  providerRow = { provider: 'anthropic', model: 'claude-opus-5-5', base_url: null, api_key_enc: secrets.encrypt('sk-ant-secret-1234'), key_last4: '1234' };
  history = [];
  httpCalls = [];
  httpReply = () => ({ status: 200, body: {} });
  ai._resetCache();
});
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
  if (u.startsWith('http://fake.supabase')) {
    // Every database call must name this business (in the filter or the saved row).
    const scoped = u.includes(`business_id=eq.${BIZ}`) || u.includes(`businesses?id=eq.${BIZ}`) || (opts.body && JSON.parse(opts.body).business_id === BIZ);
    if (!scoped) return json({ message: `unscoped ${u}` }, 500);
    if (u.includes('/businesses')) return json([{ name: 'Arogya Ruchulu' }]);
    if (u.includes('/ai_settings')) return json([settings]);
    if (u.includes('/ai_provider')) {
      if ((opts.method || 'GET') === 'GET') return json([providerRow]);
      const body = JSON.parse(opts.body);
      providerRow = { ...providerRow, ...body };
      return json([providerRow]);
    }
    if (u.includes('/whatsapp_messages')) return json([...history].reverse()); // newest first, like the API
    return json([]);
  }
  httpCalls.push({ url: u, headers: opts.headers, body: JSON.parse(opts.body || '{}') });
  const r = httpReply(u);
  return json(r.body, r.status);
};

let lastParams;
let lastOptions;
function fakeClaude(behaviour) {
  llm._setAnthropicFactory((apiKey) => ({
    beta: { messages: { create: async (params, options) => { lastParams = { ...params, apiKey }; lastOptions = options; return behaviour(params); } } },
  }));
}
const textReply = (text) => () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }], usage: {} });

// ---- keyword matching ----------------------------------------------------------------
test('hasWord: whole words, plurals, no false greetings', () => {
  assert.strictEqual(hasWord('which kit is good for me?', 'hi'), false);
  assert.strictEqual(hasWord('his order', 'hi'), false);
  assert.strictEqual(hasWord('Hi!', 'hi'), true);
  assert.strictEqual(hasWord('show me your kits', 'kit'), true);
  assert.strictEqual(hasWord('what are the prices', 'price'), true);
  assert.strictEqual(hasWord('corporate', 'rate'), false);
  assert.strictEqual(hasWord('ప్లాన్ diet', 'diet'), true);
});

// ---- key encryption -------------------------------------------------------------------
test('secrets: round trip, random IV, tamper and wrong-secret detection', () => {
  const a = secrets.encrypt('sk-test-abcdef');
  const b = secrets.encrypt('sk-test-abcdef');
  assert.notStrictEqual(a, b);
  assert.doesNotMatch(a, /sk-test/);
  assert.strictEqual(secrets.decrypt(a), 'sk-test-abcdef');
  const parts = a.split(':');
  parts[3] = Buffer.from('tampered').toString('base64');
  assert.strictEqual(secrets.decrypt(parts.join(':')), null);
  process.env.SETTINGS_ENCRYPTION_KEY = 'a-different-secret-entirely-1234';
  assert.strictEqual(secrets.decrypt(a), null);
  process.env.SETTINGS_ENCRYPTION_KEY = '';
});

// ---- provider settings ---------------------------------------------------------------------
test('providerStatus never includes the key', async () => {
  const s = await ai.providerStatus(BIZ);
  assert.strictEqual(s.configured, true);
  assert.strictEqual(s.keyLast4, '1234');
  assert.doesNotMatch(JSON.stringify(s), /sk-ant-secret|api_key_enc|v1:/);
});

test('saveProvider stores the key encrypted and returns no secret', async () => {
  const r = await ai.saveProvider({ provider: 'openai', model: 'some-model', apiKey: 'sk-openai-ABCD9876' }, boss);
  assert.ifError(r.error);
  assert.match(providerRow.api_key_enc, /^v1:/);
  assert.strictEqual(secrets.decrypt(providerRow.api_key_enc), 'sk-openai-ABCD9876');
  assert.strictEqual(providerRow.key_last4, '9876');
  assert.doesNotMatch(JSON.stringify(r), /sk-openai/);
});

test('switching provider requires a new key; blank key keeps the saved one otherwise', async () => {
  assert.match((await ai.saveProvider({ provider: 'gemini', model: 'm' }, boss)).error, /new provider/);
  assert.ifError((await ai.saveProvider({ provider: 'anthropic', model: 'claude-sonnet-5-5' }, boss)).error);
  assert.strictEqual(secrets.decrypt(providerRow.api_key_enc), 'sk-ant-secret-1234');
});

test('validation: provider, model, key shape, safe base URL', () => {
  assert.match(ai.validateProviderInput({ provider: 'x', model: 'm' }).error, /provider/);
  assert.match(ai.validateProviderInput({ provider: 'openai', model: 'has space' }).error, /model/);
  assert.match(ai.validateProviderInput({ provider: 'openai', model: 'm', apiKey: 'short' }).error, /key/);
  assert.match(ai.validateProviderInput({ provider: 'openai_compatible', model: 'm', baseUrl: 'http://api.x.com/v1' }).error, /https/);
  assert.match(ai.validateProviderInput({ provider: 'openai_compatible', model: 'm', baseUrl: 'https://127.0.0.1/v1' }).error, /public/);
  assert.match(ai.validateProviderInput({ provider: 'openai_compatible', model: 'm', baseUrl: 'https://localhost/v1' }).error, /public/);
  assert.strictEqual(ai.validateProviderInput({ provider: 'openai_compatible', model: 'm', baseUrl: 'https://api.groq.com/openai/v1/' }).baseUrl, 'https://api.groq.com/openai/v1');
});

// ---- provider adapters ---------------------------------------------------------------------
test('Claude: configured model + key, low effort, caching, refusal fallback, short timeout', async () => {
  history = [{ direction: 'inbound', body: 'Do you deliver to Miyapur?' }];
  fakeClaude(textReply('Yes! We deliver to Kukatpally and Miyapur. 🌿'));
  const r = await ai.answerCustomer({ businessId: BIZ, phone: '919000000001', catalog: DEFAULT_CATALOG });
  assert.deepStrictEqual(r, { reply: 'Yes! We deliver to Kukatpally and Miyapur. 🌿' });
  assert.strictEqual(lastParams.apiKey, 'sk-ant-secret-1234');
  assert.strictEqual(lastParams.model, 'claude-opus-5-5');
  assert.deepStrictEqual(lastParams.output_config, { effort: 'low' });
  assert.deepStrictEqual(lastParams.system[0].cache_control, { type: 'ephemeral' });
  assert.strictEqual(lastParams.fallbacks, 'default');
  assert.strictEqual(lastParams.thinking, undefined);
  assert.strictEqual(lastOptions.maxRetries, 0);
  assert.ok(lastOptions.timeout <= 8000);
});

test('OpenAI: chat completions request and reply', async () => {
  providerRow = { provider: 'openai', model: 'some-gpt-model', api_key_enc: secrets.encrypt('sk-openai-1111'), key_last4: '1111' };
  history = [{ direction: 'inbound', body: 'price of thali?' }, { direction: 'outbound', body: '₹130' }, { direction: 'inbound', body: 'and khichdi?' }];
  httpReply = () => ({ status: 200, body: { choices: [{ message: { content: 'Millet Khichdi is ₹120.' } }] } });
  const r = await ai.answerCustomer({ businessId: BIZ, phone: '919000000001', catalog: DEFAULT_CATALOG });
  assert.deepStrictEqual(r, { reply: 'Millet Khichdi is ₹120.' });
  const call = httpCalls[0];
  assert.strictEqual(call.url, 'https://api.openai.com/v1/chat/completions');
  assert.strictEqual(call.headers.Authorization, 'Bearer sk-openai-1111');
  assert.strictEqual(call.body.model, 'some-gpt-model');
  assert.deepStrictEqual(call.body.messages.map(m => m.role), ['system', 'user', 'assistant', 'user']);
});

test('OpenAI-compatible: uses the owner\'s base URL', async () => {
  providerRow = { provider: 'openai_compatible', model: 'llama-x', base_url: 'https://api.groq.com/openai/v1', api_key_enc: secrets.encrypt('gsk-2222xxxx'), key_last4: 'xxxx' };
  history = [{ direction: 'inbound', body: 'hello there friend how are you' }];
  httpReply = () => ({ status: 200, body: { choices: [{ message: { content: 'Namaste! Reply *menu* to see today\'s food.' } }] } });
  await ai.answerCustomer({ businessId: BIZ, phone: '919000000001', catalog: DEFAULT_CATALOG });
  assert.strictEqual(httpCalls[0].url, 'https://api.groq.com/openai/v1/chat/completions');
});

test('Gemini: generateContent request (key in header, not URL) and reply', async () => {
  providerRow = { provider: 'gemini', model: 'some-gemini-model', api_key_enc: secrets.encrypt('AIza-3333'), key_last4: '3333' };
  history = [{ direction: 'inbound', body: 'do you have sugar shield?' }, { direction: 'outbound', body: 'Yes, ₹3,699.' }, { direction: 'inbound', body: 'what is inside it?' }];
  httpReply = () => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: 'Low-GI grain blends and herbal teas.' }] } }] } });
  const r = await ai.answerCustomer({ businessId: BIZ, phone: '919000000001', catalog: DEFAULT_CATALOG });
  assert.deepStrictEqual(r, { reply: 'Low-GI grain blends and herbal teas.' });
  const call = httpCalls[0];
  assert.match(call.url, /models\/some-gemini-model:generateContent$/);
  assert.doesNotMatch(call.url, /AIza/);
  assert.strictEqual(call.headers['x-goog-api-key'], 'AIza-3333');
  assert.deepStrictEqual(call.body.contents.map(c => c.role), ['user', 'model', 'user']);
  assert.match(call.body.systemInstruction.parts[0].text, /No health or medical claims/);
});

test('provider errors become clear messages; timeouts fall back to the menu', async () => {
  providerRow = { provider: 'openai', model: 'm', api_key_enc: secrets.encrypt('sk-bad-0000'), key_last4: '0000' };
  httpReply = () => ({ status: 401, body: { error: { message: 'Incorrect API key' } } });
  assert.match((await ai.testProvider(BIZ, { provider: 'openai', model: 'm' })).error, /rejected by OpenAI/);
  httpReply = () => ({ status: 404, body: { error: { message: 'model not found' } } });
  assert.match((await ai.testProvider(BIZ, { provider: 'openai', model: 'm' })).error, /doesn't recognise the model "m"/);

  providerRow = { provider: 'anthropic', model: 'claude-opus-5-5', api_key_enc: secrets.encrypt('sk-ant-x-5555'), key_last4: '5555' };
  ai._resetCache();
  history = [{ direction: 'inbound', body: 'what time do you open?' }];
  fakeClaude(() => { throw new Anthropic.APIConnectionTimeoutError(); });
  assert.deepStrictEqual(await ai.answerCustomer({ businessId: BIZ, phone: '919000000001', catalog: DEFAULT_CATALOG }), { skip: true, reason: 'timeout' });
});

test('test connection works with a typed key before saving', async () => {
  providerRow = { provider: 'anthropic', model: '', api_key_enc: null, key_last4: null };
  httpReply = () => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: 'OK' }] } }] } });
  const r = await ai.testProvider(BIZ, { provider: 'gemini', model: 'g-model', apiKey: 'AIza-typed-4444' });
  assert.deepStrictEqual(r, { ok: true, sample: 'OK' });
  assert.strictEqual(httpCalls[0].headers['x-goog-api-key'], 'AIza-typed-4444');
});

test('no key / auto-reply off: never calls any provider', async () => {
  history = [{ direction: 'inbound', body: 'hello?' }];
  let called = false;
  fakeClaude(() => { called = true; return textReply('x')(); });
  settings.auto_reply = false;
  assert.strictEqual((await ai.answerCustomer({ businessId: BIZ, phone: '1', catalog: DEFAULT_CATALOG })).skip, true);
  settings.auto_reply = true;
  providerRow = { provider: 'anthropic', model: 'claude-opus-5-5', api_key_enc: null };
  ai._resetCache();
  assert.deepStrictEqual(await ai.answerCustomer({ businessId: BIZ, phone: '1', catalog: DEFAULT_CATALOG }), { skip: true, reason: 'not configured' });
  assert.strictEqual(called, false);
});

// ---- prompt + decisions ------------------------------------------------------------------
test('system prompt carries the rules, the menu and the owner knowledge', () => {
  const s = ai.systemPrompt(DEFAULT_CATALOG, settings);
  assert.match(s, /No health or medical claims/);
  assert.match(s, /HANDOVER:/);
  assert.match(s, /Kukatpally and Miyapur/);
  assert.match(ai.catalogText(DEFAULT_CATALOG), /Lean Well \(28 Days\) - ₹3499/);
});

test('history must start with the customer', () => {
  const m = ai.historyToMessages([{ direction: 'outbound', body: 'Welcome!' }, { direction: 'inbound', body: 'hi' }, { direction: 'outbound', body: '' }]);
  assert.deepStrictEqual(m.map(x => x.role), ['user']);
});

test('interpret: reply, handover, refusal, errors', () => {
  assert.deepStrictEqual(ai.interpret({ text: 'The thali is ₹130.' }), { reply: 'The thali is ₹130.' });
  assert.deepStrictEqual(ai.interpret({ text: 'HANDOVER: refund request' }), { handover: true, reason: 'refund request' });
  assert.strictEqual(ai.interpret({ refusal: true }).handover, true);
  assert.deepStrictEqual(ai.interpret({ error: 'timeout' }), { skip: true, reason: 'timeout' });
});

test('draft reply never hands over', async () => {
  history = [{ direction: 'inbound', body: 'my order was late' }];
  fakeClaude(textReply('HANDOVER: Sorry about the delay, our team will check right away.'));
  assert.deepStrictEqual(await ai.draftReply({ businessId: BIZ, phone: '1', catalog: DEFAULT_CATALOG }), { draft: 'Sorry about the delay, our team will check right away.' });
});
