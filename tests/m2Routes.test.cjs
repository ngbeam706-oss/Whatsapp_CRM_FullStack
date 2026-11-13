// M2: a staff member of one business calls EVERY dashboard API route with another business's
// ids. Nothing of the other business may be read or changed, and every database call the server
// makes must be scoped to the caller's own business. Fake database, no network.
const { test, before, after } = require('node:test');
const assert = require('node:assert');

const AROGYA = 'a0000000-0000-4000-8000-000000000001';
const MAYURA = 'b0000000-0000-4000-8000-000000000002';

process.env.APP_SECRET = 'test_app_secret_with_enough_length';
process.env.VERIFY_TOKEN = 'test_verify_token';
process.env.WHATSAPP_TOKEN = '';
process.env.PHONE_NUMBER_ID = '';
process.env.WABA_ID = '';
process.env.VITE_SUPABASE_URL = 'http://fake.supabase';
process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
process.env.WHATSAPP_BUSINESS_ID = AROGYA; // the environment's WhatsApp number belongs to Arogya

const app = require('../server/app.cjs');
const { _setStaffForToken } = require('../server/auth.cjs');
const state = require('../server/state.cjs');

// ---- staff ---------------------------------------------------------------------------
const staff = {
  mayuraOwner: { id: 'c0000000-0000-4000-8000-00000000000a', email: 'admin@mayura.test', role: 'owner', businessId: MAYURA, businessName: 'Mayura Hospitals' },
  arogyaOwner: { id: 'c0000000-0000-4000-8000-00000000000b', email: 'owner@arogya.test', role: 'owner', businessId: AROGYA, businessName: 'Arogya Ruchulu' },
  arogyaManager: { id: 'c0000000-0000-4000-8000-00000000000c', email: 'manager@arogya.test', role: 'manager', businessId: AROGYA, businessName: 'Arogya Ruchulu' },
  arogyaAgent: { id: 'c0000000-0000-4000-8000-00000000000d', email: 'agent@arogya.test', role: 'agent', businessId: AROGYA, businessName: 'Arogya Ruchulu' },
};
for (const [token, s] of Object.entries(staff)) _setStaffForToken(token, s);

// ---- fake database -------------------------------------------------------------------------
// Arogya's rows all carry the marker AROGYA_SECRET, so a leak shows up in any response.
const SECRET = 'AROGYA_SECRET';
const AROGYA_CAMPAIGN = 'd0000000-0000-4000-8000-000000000001';
const AROGYA_AUTOMATION = 'e0000000-0000-4000-8000-000000000001';
const seed = () => ({
  whatsapp_leads: [
    { business_id: AROGYA, phone: '919000000001', name: `${SECRET} Ravi`, stage: 'new', assigned_to: null, tags: [], last_inbound_at: new Date().toISOString() },
    { business_id: MAYURA, phone: '919000000002', name: 'Mayura patient', stage: 'new', assigned_to: null, tags: [] },
  ],
  whatsapp_messages: [{ business_id: AROGYA, id: 1, contact_phone: '919000000001', direction: 'inbound', body: `${SECRET} hello`, timestamp: new Date().toISOString() }],
  lead_notes: [{ business_id: AROGYA, id: 1, phone: '919000000001', author: 'owner@arogya.test', body: `${SECRET} note` }],
  contact_events: [{ business_id: AROGYA, id: 1, phone: '919000000001', event_type: 'order_enquiry', data: { item: SECRET }, created_at: new Date().toISOString() }],
  whatsapp_bot_rules: [{ business_id: AROGYA, id: 'r1', keyword: 'price', response_text: `${SECRET} price list`, is_active: true }],
  whatsapp_catalog: [{ business_id: AROGYA, id: 'main_catalog', data: { welcomeMessage: `${SECRET} welcome` } }],
  campaigns: [{ business_id: AROGYA, id: AROGYA_CAMPAIGN, name: `${SECRET} Diwali`, status: 'draft', created_at: new Date().toISOString() }],
  campaign_recipients: [{ business_id: AROGYA, id: 1, campaign_id: AROGYA_CAMPAIGN, phone: '919000000001', status: 'queued' }],
  automations: [{ business_id: AROGYA, id: AROGYA_AUTOMATION, name: `${SECRET} follow-up`, trigger: 'item_viewed', is_active: true, created_at: new Date().toISOString() }],
  automation_runs: [{ business_id: AROGYA, id: 1, automation_id: AROGYA_AUTOMATION, phone: '919000000001', status: 'scheduled' }],
  ai_settings: [{ business_id: AROGYA, auto_reply: true, knowledge: `${SECRET} knowledge`, instructions: '' }],
  ai_provider: [{ business_id: AROGYA, provider: 'anthropic', model: 'claude-opus-5-5', key_last4: 'SECR' }],
  staff_members: [
    { business_id: AROGYA, user_id: staff.arogyaOwner.id, email: 'owner@arogya.test', role: 'owner' },
    { business_id: AROGYA, user_id: staff.arogyaAgent.id, email: 'agent@arogya.test', role: 'agent' },
    { business_id: MAYURA, user_id: staff.mayuraOwner.id, email: 'admin@mayura.test', role: 'owner' },
  ],
});
let db = seed();
let calls = [];

// Read-only views/RPCs the server may call with id lists (ids it already got from scoped reads).
// platform_settings: the one platform-wide row (maintenance mode), read by the API gate; no business data.
const UNSCOPED_OK = new Set(['campaign_stats', 'automation_stats', 'rpc/claim_campaign_recipients', 'rpc/claim_due_automation_runs', 'businesses', 'platform_settings']);

const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
function eqParam(url, key) {
  const m = url.match(new RegExp(`[?&]${key}=eq\\.([^&]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  if (u.startsWith('http://fake.supabase/auth/v1/invite')) return json({ msg: 'A user with this email address has already been registered' }, 422);
  if (!u.startsWith('http://fake.supabase/rest/v1/')) return json({ error: { message: 'offline in tests' } }, 503);

  const path = u.slice('http://fake.supabase/rest/v1/'.length);
  const table = path.split('?')[0];
  let body = null;
  try { body = opts.body ? JSON.parse(opts.body) : null; } catch { body = null; }
  const rows = Array.isArray(body) ? body : body ? [body] : [];
  const scopeFromUrl = eqParam(u, 'business_id');
  const scopeFromBody = rows.map(r => r.business_id || r.p_business).filter(Boolean);
  calls.push({ method, table, scopes: [scopeFromUrl, ...scopeFromBody].filter(Boolean), unscoped: !scopeFromUrl && !scopeFromBody.length, raw: `${u} ${opts.body || ''}` });

  if (table.startsWith('rpc/')) return json([]);
  if (!db[table]) return json([]);
  const biz = scopeFromUrl || scopeFromBody[0];
  const mine = db[table].filter(r => r.business_id === biz);
  if (method === 'GET') return json(mine);
  if (method === 'POST') { const added = rows.map(r => ({ ...r })); db[table].push(...added); return json(added, 201); }
  if (method === 'PATCH') { mine.forEach(r => Object.assign(r, body)); return json(mine); }
  if (method === 'DELETE') { db[table] = db[table].filter(r => !mine.includes(r)); return json(mine); }
  return json([]);
};

// ---- server --------------------------------------------------------------------------------
let server;
let base;
before(async () => {
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function call(token, method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}
// The global fetch above is the fake; requests to our own test server must use the real one.
const realFetch = globalThis.fetch;
const nodeFetch = require('node:http');
async function httpCall(token, method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = nodeFetch.request(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
    }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
void call; void realFetch;

const ROUTES = [
  ['GET', '/api/status'],
  ['GET', '/api/messages'],
  ['GET', '/api/bot-rules'],
  ['POST', '/api/bot-rules', { rule: { id: 'r1', keyword: 'hack', responseText: 'x' } }],
  ['GET', '/api/bot-catalog'],
  ['POST', '/api/bot-catalog', { catalog: { welcomeMessage: 'hack' } }],
  ['POST', '/api/clear'],
  ['POST', '/api/send', { to: '919000000001', message: 'hi' }],
  ['GET', '/api/broadcast/account'],
  ['GET', '/api/templates'],
  ['POST', '/api/templates', { name: 'x' }],
  ['DELETE', '/api/templates/x'],
  ['GET', '/api/audience/options'],
  ['POST', '/api/audience/preview', { segment: { mode: 'list', phones: '919000000001' } }],
  ['GET', '/api/campaigns'],
  ['GET', `/api/campaigns/${AROGYA_CAMPAIGN}`],
  ['POST', '/api/campaigns', { name: 'x', templateName: 't', language: 'en', segment: {} }],
  ['POST', '/api/campaigns/test', { to: '919000000001', templateName: 't', language: 'en' }],
  ['POST', `/api/campaigns/${AROGYA_CAMPAIGN}/start`],
  ['POST', `/api/campaigns/${AROGYA_CAMPAIGN}/cancel`],
  ['GET', '/api/automations'],
  ['GET', `/api/automations/${AROGYA_AUTOMATION}`],
  ['POST', '/api/automations', { name: 'x', trigger: 'item_viewed', delayMinutes: 60, templateName: 't', language: 'en' }],
  ['PATCH', `/api/automations/${AROGYA_AUTOMATION}`, { isActive: false }],
  ['DELETE', `/api/automations/${AROGYA_AUTOMATION}`],
  ['POST', '/api/automation-runs/1/cancel'],
  ['GET', '/api/inbox'],
  ['GET', '/api/inbox/919000000001'],
  ['POST', '/api/inbox/start', { phone: '919000000001' }],
  ['POST', '/api/inbox/919000000001/messages', { text: 'hi' }],
  ['POST', '/api/inbox/919000000001/template', { templateName: 't', language: 'en' }],
  ['POST', '/api/inbox/919000000001/read'],
  ['PATCH', '/api/inbox/919000000001', { stage: 'lost' }],
  ['PATCH', '/api/inbox/919000000001', { assignedTo: 'admin@mayura.test' }],
  ['POST', '/api/inbox/919000000001/notes', { body: 'hack' }],
  ['DELETE', '/api/notes/1'],
  ['POST', '/api/inbox/919000000001/suggest'],
  ['GET', '/api/pipeline'],
  ['GET', '/api/ai/settings'],
  ['PUT', '/api/ai/settings', { autoReply: false }],
  ['PUT', '/api/ai/provider', { removeKey: true }],
  ['POST', '/api/ai/provider/test', { provider: 'openai', model: 'm', apiKey: 'sk-test-12345678' }],
  ['POST', '/api/ai/test', { question: 'hi' }],
  ['GET', '/api/analytics'],
  ['GET', '/api/team'],
  ['POST', '/api/team/invite', { email: 'owner@arogya.test', role: 'agent' }],
  ['PATCH', `/api/team/${staff.arogyaOwner.id}`, { role: 'agent' }],
  ['DELETE', `/api/team/${staff.arogyaAgent.id}`],
  ['DELETE', '/api/bot-rules/r1'],
  ['POST', '/api/bot-catalog', { reset: true }],
  ['GET', '/api/business'],
  ['PUT', '/api/business', { name: 'Hacked name', sendWindowStart: 1, sendWindowEnd: 23 }],
  ['GET', '/api/business/checklist'],
  ['GET', '/api/whatsapp'],
  ['PUT', '/api/whatsapp', { phoneNumberId: '12345', wabaId: '12345', accessToken: 'EAAG-some-token-1234567890' }],
  ['POST', '/api/whatsapp/test'],
  ['GET', '/api/queries'],
  ['GET', '/api/queries?view=team'],
  ['GET', '/api/queries/settings'],
  ['POST', '/api/queries', { kind: 'customer', contactPhone: '919000000001', subject: 'hack' }],
  ['POST', '/api/queries', { kind: 'internal', addressedTo: 'owner', subject: 'x' }],
  ['GET', `/api/queries/${AROGYA_CAMPAIGN}`],
  ['PATCH', `/api/queries/${AROGYA_CAMPAIGN}`, { stage: 'closed' }],
  ['POST', `/api/queries/${AROGYA_CAMPAIGN}/comments`, { body: 'x' }],
  ['POST', `/api/queries/${AROGYA_CAMPAIGN}/escalate`],
  ['PUT', '/api/queries/settings/due-hours', { urgent: 1, high: 2, normal: 3, low: 4 }],
  ['POST', '/api/queries/settings/categories', { kind: 'customer', name: 'Hack', active: false }],
  ['GET', '/api/queries/stats'],
  ['GET', '/api/notifications'],
  ['GET', '/api/home'],
  ['GET', '/api/home/team'],
  ['GET', '/api/inbox?assignee=owner@arogya.test'],
  ['GET', '/api/queries/by-number/1001'],
  ['GET', '/api/support'],
  ['POST', '/api/support', { subject: 'help', category: 'Other' }],
  ['GET', `/api/support/${AROGYA_CAMPAIGN}`],
];

test('another business can\'t read or change Arogya\'s data through any route', async () => {
  db = seed();
  const arogyaBefore = JSON.stringify(Object.fromEntries(Object.entries(db).map(([t, rows]) => [t, rows.filter(r => r.business_id === AROGYA)])));
  calls = [];

  for (const [method, path, body] of ROUTES) {
    const r = await httpCall('mayuraOwner', method, path, body);
    assert.ok(!r.text.includes(SECRET), `${method} ${path} leaked Arogya data: ${r.text.slice(0, 200)}`);
    assert.ok(r.status < 500 || /offline in tests|not found|Could not/i.test(r.text), `${method} ${path} -> ${r.status} ${r.text.slice(0, 200)}`);
  }

  const arogyaAfter = JSON.stringify(Object.fromEntries(Object.entries(db).map(([t, rows]) => [t, rows.filter(r => r.business_id === AROGYA)])));
  assert.strictEqual(arogyaAfter, arogyaBefore, 'Arogya rows were changed by another business');

  const touchedArogya = calls.filter(c => c.scopes.includes(AROGYA) || c.raw.includes(AROGYA));
  assert.deepStrictEqual(touchedArogya, [], 'a database call mentioned Arogya while acting for Mayura');
  assert.ok(calls.length > 40, `expected the routes to hit the database (only ${calls.length} calls)`);
  const unscoped = calls.filter(c => c.unscoped && !UNSCOPED_OK.has(c.table));
  assert.deepStrictEqual(unscoped, [], 'a database call had no business filter');
});

test('Arogya staff still see Arogya data', async () => {
  db = seed();
  const inbox = await httpCall('arogyaAgent', 'GET', '/api/inbox');
  assert.strictEqual(inbox.status, 200);
  assert.ok(inbox.text.includes(`${SECRET} Ravi`));
  assert.ok(!inbox.text.includes('Mayura patient'));
  // The bot setup is for managers and the Business Admin; agents don't see it (2026-11-10).
  const rules = await httpCall('arogyaOwner', 'GET', '/api/bot-rules');
  assert.ok(rules.text.includes(`${SECRET} price list`));
  assert.strictEqual((await httpCall('arogyaAgent', 'GET', '/api/bot-rules')).status, 403);
});

test('agents only reach the Inbox, Pipeline and Queries: every admin page refuses them (2026-11-10)', async () => {
  db = seed();
  const adminPages = [
    '/api/bot-rules', '/api/bot-catalog', '/api/messages', '/api/analytics', '/api/ads',
    '/api/broadcast/account', '/api/audience/options', '/api/campaigns', `/api/campaigns/${AROGYA_CAMPAIGN}`,
    '/api/automations', '/api/whatsapp', '/api/business', '/api/business/checklist', '/api/business/usage',
  ];
  for (const path of adminPages) {
    const r = await httpCall('arogyaAgent', 'GET', path);
    assert.strictEqual(r.status, 403, `agent GET ${path} -> ${r.status}`);
    assert.ok(!r.text.includes(SECRET), `agent GET ${path} leaked data`);
  }
  assert.strictEqual((await httpCall('arogyaAgent', 'POST', '/api/audience/preview', { segment: {} })).status, 403);
  assert.strictEqual((await httpCall('arogyaAgent', 'POST', '/api/clear')).status, 403);

  // AI: agents learn only whether AI replies are on (header badge), never the knowledge or provider.
  db.ai_settings = [{ business_id: AROGYA, auto_reply: true, knowledge: `${SECRET} delivery areas`, instructions: `${SECRET} tone` }];
  const ai = await httpCall('arogyaAgent', 'GET', '/api/ai/settings');
  assert.strictEqual(ai.status, 200);
  assert.ok(!ai.text.includes(SECRET), 'agent saw the AI knowledge');
  const aiBody = JSON.parse(ai.text);
  assert.deepStrictEqual(Object.keys(aiBody.settings), ['auto_reply']);
  assert.strictEqual(aiBody.status.provider, undefined);

  // What agents still need keeps working.
  for (const path of ['/api/inbox', '/api/pipeline', '/api/team', '/api/queries', '/api/queries/settings', '/api/status']) {
    assert.strictEqual((await httpCall('arogyaAgent', 'GET', path)).status, 200, `agent GET ${path}`);
  }
  // Managers still see the admin pages.
  assert.strictEqual((await httpCall('arogyaOwner', 'GET', '/api/bot-catalog')).status, 200);
});

test('query settings: only the Business Admin gets the full category list (switched-off ones too)', async () => {
  db = seed();
  db.query_categories = [
    { business_id: AROGYA, kind: 'customer', name: 'Delivery', is_active: true, sort_order: 1 },
    { business_id: AROGYA, kind: 'customer', name: 'Old one', is_active: false, sort_order: 2 },
  ];
  const owner = JSON.parse((await httpCall('arogyaOwner', 'GET', '/api/queries/settings')).text);
  assert.deepStrictEqual(owner.allCategories.map(c => c.name), ['Delivery', 'Old one']);
  const agent = JSON.parse((await httpCall('arogyaAgent', 'GET', '/api/queries/settings')).text);
  assert.strictEqual(agent.allCategories, undefined);
});

test('roles: agents can\'t change setup; managers run the business but not the team or AI keys', async () => {
  db = seed();
  const agentDenied = [
    ['POST', '/api/bot-rules', { rule: { id: 'r9', keyword: 'x', responseText: 'x' } }],
    ['POST', '/api/bot-catalog', { catalog: {} }],
    ['PUT', '/api/ai/settings', { autoReply: false }],
    ['POST', '/api/campaigns', {}],
    ['POST', '/api/automations', {}],
    ['GET', '/api/analytics'],
    ['GET', '/api/queries/stats'],
    ['GET', '/api/home/team'],
    ['PUT', '/api/queries/settings/due-hours', { urgent: 1, high: 2, normal: 3, low: 4 }],
    ['POST', '/api/queries/settings/categories', { kind: 'customer', name: 'x' }],
    ['POST', '/api/team/invite', { email: 'a@b.co' }],
  ];
  for (const [m, p, b] of agentDenied) assert.strictEqual((await httpCall('arogyaAgent', m, p, b)).status, 403, `agent ${m} ${p}`);

  const managerAllowed = [
    ['POST', '/api/bot-rules', { rule: { id: 'r9', keyword: 'x', responseText: 'x' } }],
    ['PUT', '/api/ai/settings', { autoReply: true }],
    ['GET', '/api/analytics'],
    ['GET', '/api/queries/stats'],
  ];
  for (const [m, p, b] of managerAllowed) assert.notStrictEqual((await httpCall('arogyaManager', m, p, b)).status, 403, `manager ${m} ${p}`);

  const managerDenied = [
    ['PUT', '/api/ai/provider', { removeKey: true }],
    ['POST', '/api/ai/provider/test', {}],
    ['POST', '/api/team/invite', { email: 'a@b.co' }],
    ['PATCH', `/api/team/${staff.arogyaAgent.id}`, { role: 'owner' }],
    ['PUT', '/api/queries/settings/due-hours', { urgent: 1, high: 2, normal: 3, low: 4 }],
    ['POST', '/api/queries/settings/categories', { kind: 'customer', name: 'x' }],
  ];
  for (const [m, p, b] of managerDenied) assert.strictEqual((await httpCall('arogyaManager', m, p, b)).status, 403, `manager ${m} ${p}`);
});

test('live events and the recent-message cache are kept per business', () => {
  const got = { a: '', m: '' };
  const fakeRes = (k) => ({ write: (s) => { got[k] += s; } });
  const a = { res: fakeRes('a'), businessId: AROGYA };
  const m = { res: fakeRes('m'), businessId: MAYURA };
  state.sseClients.add(a);
  state.sseClients.add(m);
  state.broadcastEvent('message', { body: SECRET }, AROGYA);
  state.broadcastEvent('message', { body: 'no business' }); // never sent to anyone
  state.sseClients.delete(a);
  state.sseClients.delete(m);
  assert.ok(got.a.includes(SECRET));
  assert.strictEqual(got.m, '');

  state.pushMessage({ id: 'x1', body: SECRET }, AROGYA);
  assert.strictEqual(state.recentFor(MAYURA).messages.some(x => x.body === SECRET), false);
  assert.strictEqual(state.recentFor(AROGYA).messages.some(x => x.body === SECRET), true);
  state.clearMessages(MAYURA);
  assert.strictEqual(state.recentFor(AROGYA).messages.some(x => x.body === SECRET), true);
});
