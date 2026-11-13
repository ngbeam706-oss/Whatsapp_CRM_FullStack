// M3: every business has its own WhatsApp number, webhook address, app secret and verify token.
// Fake database + fake Meta Graph API, no network.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const http = require('node:http');

const A = 'a0000000-0000-4000-8000-000000000001'; // Arogya
const B = 'b0000000-0000-4000-8000-000000000002'; // Mayura

process.env.APP_SECRET = 'server_encryption_secret_long_enough';
process.env.SETTINGS_ENCRYPTION_KEY = '';
process.env.VERIFY_TOKEN = 'env_verify_token';
process.env.WHATSAPP_TOKEN = '';
process.env.PHONE_NUMBER_ID = '';
process.env.WABA_ID = '';
process.env.ALLOW_UNSIGNED_WEBHOOKS = '';
process.env.VITE_SUPABASE_URL = 'http://fake.supabase';
process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
process.env.WHATSAPP_BUSINESS_ID = A;

const secrets = require('../server/secrets.cjs');
const app = require('../server/app.cjs');
const { _setStaffForToken } = require('../server/auth.cjs');
const whatsapp = require('../server/whatsapp.cjs');
const inbox = require('../server/inbox.cjs');

const conn = {
  [A]: { key: 'a'.repeat(32), phoneId: '111111111111111', waba: '911111111111111', token: 'EAAG-token-for-arogya-1234', secret: '0123456789abcdef0123456789abcdef', verify: 'verify-arogya' },
  [B]: { key: 'b'.repeat(32), phoneId: '222222222222222', waba: '922222222222222', token: 'EAAG-token-for-mayura-9876', secret: 'fedcba9876543210fedcba9876543210', verify: 'verify-mayura' },
};

// ---- fake database ---------------------------------------------------------------------
let db;
let graphCalls;
function seed() {
  db = {
    businesses: [{ id: A, name: 'Arogya Ruchulu', status: 'active' }, { id: B, name: 'Mayura Hospitals', status: 'active' }],
    business_whatsapp: [A, B].map(id => ({
      business_id: id, phone_number: id === A ? '919000000100' : '919000000200', phone_number_id: conn[id].phoneId, waba_id: conn[id].waba,
      access_token_enc: secrets.encrypt(conn[id].token), token_last4: conn[id].token.slice(-4),
      app_secret_enc: secrets.encrypt(conn[id].secret), verify_token_enc: secrets.encrypt(conn[id].verify),
      webhook_key: conn[id].key, graph_api_version: 'v26.0',
    })),
    whatsapp_leads: [
      { business_id: A, phone: '919876500001', name: 'Ravi', assigned_to: null, stage: 'new', tags: [], last_inbound_at: new Date().toISOString() },
      { business_id: B, phone: '919876500001', name: 'Ravi (patient)', assigned_to: null, stage: 'new', tags: [], last_inbound_at: new Date().toISOString() },
    ],
    whatsapp_messages: [],
    audit_log: [],
  };
  graphCalls = [];
  whatsapp.clearCache();
}

const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
const eq = (u, k) => { const m = u.match(new RegExp(`[?&]${k}=eq\\.([^&]+)`)); return m ? decodeURIComponent(m[1]) : null; };

global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  if (u.startsWith('https://graph.facebook.com/')) {
    const path = u.replace(/^https:\/\/graph\.facebook\.com\/[^/]+\//, '');
    const token = String(opts.headers?.Authorization || '').replace('Bearer ', '');
    graphCalls.push({ path, method, token, body: opts.body ? JSON.parse(opts.body) : null });
    const owner = Object.values(conn).find(c => c.token === token);
    if (/^\d+\/messages$/.test(path)) return json({ messages: [{ id: `wamid.${graphCalls.length}` }] });
    if (path.startsWith('333333333333333?')) return json({ display_phone_number: '+91 90000 00300', verified_name: 'New Clinic' });
    if (/^\d+\?fields=/.test(path)) return owner || token === 'EAAG-brand-new-token-0000' ? json({ display_phone_number: '+91 90000 00100', verified_name: 'Arogya' }) : json({ error: { message: 'Invalid OAuth access token' } }, 400);
    if (/^\d+\/phone_numbers/.test(path)) {
      const waba = path.split('/')[0];
      if (waba === '944444444444444') return json({ data: [{ id: '333333333333333' }] });
      return json({ data: [{ id: '999999999999999' }] }); // the number is NOT in this account
    }
    if (/\/subscribed_apps$/.test(path)) return json({ success: true });
    return json({ error: { message: 'unmocked graph call' } }, 400);
  }
  if (!u.startsWith('http://fake.supabase/rest/v1/')) return json({}, 503);
  const path = u.slice('http://fake.supabase/rest/v1/'.length);
  const table = path.split('?')[0];
  const body = opts.body ? JSON.parse(opts.body) : null;
  if (table.startsWith('rpc/')) return json([]);
  const rows = db[table] || [];
  if (method === 'GET') {
    return json(rows.filter(r =>
      (!eq(u, 'business_id') || r.business_id === eq(u, 'business_id')) &&
      (!eq(u, 'id') || r.id === eq(u, 'id')) &&
      (!eq(u, 'webhook_key') || r.webhook_key === eq(u, 'webhook_key')) &&
      (!eq(u, 'phone') || r.phone === eq(u, 'phone'))));
  }
  if (method === 'POST') {
    const list = Array.isArray(body) ? body : [body];
    for (const r of list) {
      if (table === 'business_whatsapp') {
        const clash = rows.find(x => x.phone_number_id === r.phone_number_id && x.business_id !== r.business_id);
        if (clash) return json({ code: '23505', message: 'duplicate key value violates unique constraint "business_whatsapp_phone_number_id_key"' }, 409);
        const existing = rows.find(x => x.business_id === r.business_id);
        if (existing) Object.assign(existing, r); else rows.push({ webhook_key: crypto.randomBytes(16).toString('hex'), ...r });
      } else {
        (db[table] = db[table] || []).push({ ...r });
      }
    }
    return json(list, 201);
  }
  if (method === 'PATCH') {
    const hit = rows.filter(r => (!eq(u, 'business_id') || r.business_id === eq(u, 'business_id')) && (!eq(u, 'phone') || r.phone === eq(u, 'phone')));
    hit.forEach(r => Object.assign(r, body));
    return json(hit);
  }
  return json([]);
};

// ---- server ----------------------------------------------------------------------------------
let server;
let base;
before(async () => {
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
beforeEach(seed);

function request(method, path, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
    }, (res) => { let t = ''; res.on('data', c => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, text: t })); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const sign = (raw, secret) => 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
const inbound = (toPhoneId, text = 'STOP') => JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [{ changes: [{ value: {
    metadata: { phone_number_id: toPhoneId, display_phone_number: '91900' },
    contacts: [{ profile: { name: 'Ravi' }, wa_id: '919876500001' }],
    messages: [{ id: `wamid.in.${Math.random()}`, from: '919876500001', type: 'text', text: { body: text }, timestamp: String(Math.floor(Date.now() / 1000)) }],
  } }] }],
});

// ---- webhook --------------------------------------------------------------------------------
test('each business\'s webhook address only accepts its own app secret', async () => {
  const raw = inbound(conn[B].phoneId);
  const wrong = await request('POST', `/webhook/${conn[B].key}`, { body: raw, headers: { 'X-Hub-Signature-256': sign(raw, conn[A].secret) } });
  assert.strictEqual(wrong.status, 401);
  const right = await request('POST', `/webhook/${conn[B].key}`, { body: raw, headers: { 'X-Hub-Signature-256': sign(raw, conn[B].secret) } });
  assert.strictEqual(right.status, 200);
  const saved = db.whatsapp_messages.filter(m => m.direction === 'inbound');
  assert.strictEqual(saved.length, 1);
  assert.strictEqual(saved[0].business_id, B, 'the message belongs to Mayura');
  // The STOP reply went out from Mayura's own number with Mayura's token, and names Mayura.
  const sent = graphCalls.filter(c => c.path.endsWith('/messages'));
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].path, `${conn[B].phoneId}/messages`);
  assert.strictEqual(sent[0].token, conn[B].token);
  assert.match(sent[0].body.text.body, /Mayura Hospitals/);
  // Opted out in Mayura only.
  assert.strictEqual(db.whatsapp_leads.find(l => l.business_id === B).opted_out, true);
  assert.notStrictEqual(db.whatsapp_leads.find(l => l.business_id === A).opted_out, true);
});

test('unknown webhook addresses are refused', async () => {
  const raw = inbound(conn[A].phoneId);
  assert.strictEqual((await request('POST', `/webhook/${'c'.repeat(32)}`, { body: raw, headers: { 'X-Hub-Signature-256': sign(raw, conn[A].secret) } })).status, 404);
  assert.strictEqual((await request('GET', '/webhook/not-a-key?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1')).status, 404);
});

test('a message for another business\'s number is ignored, even when correctly signed', async () => {
  const raw = inbound(conn[A].phoneId); // Arogya's number, sent to Mayura's address
  const r = await request('POST', `/webhook/${conn[B].key}`, { body: raw, headers: { 'X-Hub-Signature-256': sign(raw, conn[B].secret) } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(db.whatsapp_messages.length, 0);
  assert.strictEqual(graphCalls.length, 0);
});

test('Meta\'s verification only succeeds with that business\'s own verify token', async () => {
  const ok = await request('GET', `/webhook/${conn[A].key}?hub.mode=subscribe&hub.verify_token=${conn[A].verify}&hub.challenge=777`);
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.text, '777');
  assert.strictEqual((await request('GET', `/webhook/${conn[A].key}?hub.mode=subscribe&hub.verify_token=${conn[B].verify}&hub.challenge=1`)).status, 403);
  assert.strictEqual((await request('GET', `/webhook/${conn[A].key}?hub.mode=subscribe&hub.verify_token=env_verify_token&hub.challenge=1`)).status, 403);
});

// ---- sending ---------------------------------------------------------------------------------
test('staff replies go out from their own business\'s number and token', async () => {
  for (const biz of [A, B]) {
    graphCalls = [];
    const r = await inbox.sendText('919876500001', 'Hello', { id: 'x', email: 'staff@x.test', role: 'owner', businessId: biz });
    assert.ifError(r.error);
    assert.strictEqual(graphCalls[0].path, `${conn[biz].phoneId}/messages`);
    assert.strictEqual(graphCalls[0].token, conn[biz].token);
  }
});

test('a business without a connection can\'t send at all', async () => {
  db.business_whatsapp = db.business_whatsapp.filter(w => w.business_id !== B);
  whatsapp.clearCache();
  const r = await inbox.sendText('919876500001', 'Hello', { id: 'x', email: 'staff@x.test', role: 'owner', businessId: B });
  assert.match(r.error, /no WhatsApp number/);
  assert.strictEqual(graphCalls.length, 0);
});

test('a suspended business can\'t send', async () => {
  db.businesses.find(b => b.id === B).status = 'suspended';
  whatsapp.clearCache();
  assert.strictEqual(await whatsapp.getWhatsApp(B), null);
});

// ---- connecting a number -----------------------------------------------------------------------
const owner = { id: 'c0000000-0000-4000-8000-0000000000aa', email: 'admin@mayura.test', role: 'owner', businessId: B, businessName: 'Mayura Hospitals' };
const agent = { id: 'c0000000-0000-4000-8000-0000000000bb', email: 'agent@mayura.test', role: 'agent', businessId: B, businessName: 'Mayura Hospitals' };
_setStaffForToken('mayura-owner', owner);
_setStaffForToken('mayura-agent', agent);
const asOwner = { Authorization: 'Bearer mayura-owner' };

test('saving checks the number belongs to the WhatsApp Business Account', async () => {
  const r = await request('PUT', '/api/whatsapp', { headers: asOwner, body: { phoneNumberId: conn[B].phoneId, wabaId: '955555555555555', accessToken: conn[B].token } });
  assert.strictEqual(r.status, 400);
  assert.match(r.text, /not in this WhatsApp Business Account/);
});

test('a number already connected to another business is refused', async () => {
  // Mayura tries to take Arogya's number (Meta says the token is fine and the number is in the account).
  db.business_whatsapp = db.business_whatsapp.filter(w => w.business_id !== B);
  const r = await whatsapp.saveConnection(owner, { phoneNumberId: '333333333333333', wabaId: '944444444444444', accessToken: 'EAAG-brand-new-token-0000', appSecret: conn[B].secret });
  assert.ifError(r.error);
  db.business_whatsapp.find(w => w.business_id === A).phone_number_id = '333333333333333';
  db.business_whatsapp = db.business_whatsapp.filter(w => w.business_id !== B);
  const again = await whatsapp.saveConnection(owner, { phoneNumberId: '333333333333333', wabaId: '944444444444444', accessToken: 'EAAG-brand-new-token-0000', appSecret: conn[B].secret });
  assert.match(again.error, /already connected to another business/);
});

test('a saved connection is encrypted, and the browser never gets the token or app secret', async () => {
  db.business_whatsapp = db.business_whatsapp.filter(w => w.business_id !== B);
  const r = await request('PUT', '/api/whatsapp', { headers: asOwner, body: { phoneNumberId: '333333333333333', wabaId: '944444444444444', accessToken: 'EAAG-brand-new-token-0000', appSecret: conn[B].secret } });
  assert.strictEqual(r.status, 200, r.text);
  const row = db.business_whatsapp.find(w => w.business_id === B);
  assert.doesNotMatch(JSON.stringify(row), /EAAG-brand-new-token|fedcba9876543210/);
  assert.strictEqual(secrets.decrypt(row.access_token_enc), 'EAAG-brand-new-token-0000');
  assert.doesNotMatch(r.text, /EAAG-brand-new-token|fedcba9876543210|access_token_enc|app_secret_enc/);
  assert.ok(db.audit_log.some(a => a.action === 'whatsapp.connected' && a.business_id === B));

  const ownerView = await request('GET', '/api/whatsapp', { headers: asOwner });
  const o = JSON.parse(ownerView.text);
  assert.match(o.webhookUrl, new RegExp(`/webhook/${row.webhook_key}$`));
  assert.ok(o.verifyToken && o.verifyToken.length > 10);
  assert.strictEqual(o.tokenLast4, '0000');
  assert.doesNotMatch(ownerView.text, /EAAG-brand-new-token|fedcba9876543210/);

  // Agents don't see the WhatsApp page at all (2026-11-10).
  const agentView = await request('GET', '/api/whatsapp', { headers: { Authorization: 'Bearer mayura-agent' } });
  assert.strictEqual(agentView.status, 403);
  assert.doesNotMatch(agentView.text, /webhook|verify/i);
  assert.strictEqual((await request('PUT', '/api/whatsapp', { headers: { Authorization: 'Bearer mayura-agent' }, body: {} })).status, 403);
});

test('the webhook address and verify token are ready BEFORE the number is connected', async () => {
  db.business_whatsapp = db.business_whatsapp.filter(w => w.business_id !== B);

  // An agent opening the page creates nothing and sees nothing.
  const agentView = JSON.parse((await request('GET', '/api/whatsapp', { headers: { Authorization: 'Bearer mayura-agent' } })).text);
  assert.strictEqual(agentView.verifyToken, undefined);
  assert.strictEqual(db.business_whatsapp.some(w => w.business_id === B), false);

  // The Business Admin gets its own address and token, which stay the same on reload.
  const first = JSON.parse((await request('GET', '/api/whatsapp', { headers: asOwner })).text);
  assert.strictEqual(first.connected, false);
  assert.strictEqual(first.source, 'none');
  const row = db.business_whatsapp.find(w => w.business_id === B);
  assert.match(first.webhookUrl, new RegExp(`/webhook/${row.webhook_key}$`));
  assert.ok(first.verifyToken.length > 10);
  assert.doesNotMatch(JSON.stringify(row), new RegExp(first.verifyToken), 'stored encrypted');
  const again = JSON.parse((await request('GET', '/api/whatsapp', { headers: asOwner })).text);
  assert.deepStrictEqual([again.webhookUrl, again.verifyToken], [first.webhookUrl, first.verifyToken]);
  const status = JSON.parse((await request('GET', '/api/status', { headers: asOwner })).text);
  assert.deepStrictEqual([status.webhookUrl, status.verifyToken], [first.webhookUrl, first.verifyToken]);

  // Meta can verify the address now, with this token only.
  whatsapp.clearCache();
  const ok = await request('GET', `/webhook/${row.webhook_key}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(first.verifyToken)}&hub.challenge=4242`);
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.text, '4242');
  assert.strictEqual((await request('GET', `/webhook/${row.webhook_key}?hub.mode=subscribe&hub.verify_token=${conn[A].verify}&hub.challenge=1`)).status, 403);

  // But messages are refused until the details (with the App secret) are saved.
  const raw = inbound('333333333333333');
  for (const secret of [conn[A].secret, conn[B].secret]) {
    const r = await request('POST', `/webhook/${row.webhook_key}`, { body: raw, headers: { 'X-Hub-Signature-256': sign(raw, secret) } });
    assert.strictEqual(r.status, 404);
  }
  assert.strictEqual(db.whatsapp_messages.length, 0);

  // Saving the details keeps the same address and token (already pasted into Meta).
  const saved = await whatsapp.saveConnection(owner, { phoneNumberId: '333333333333333', wabaId: '944444444444444', accessToken: 'EAAG-brand-new-token-0000', appSecret: conn[B].secret });
  assert.ifError(saved.error);
  assert.deepStrictEqual([saved.status.webhookUrl, saved.status.verifyToken], [first.webhookUrl, first.verifyToken]);
  const now = await request('POST', `/webhook/${row.webhook_key}`, { body: raw, headers: { 'X-Hub-Signature-256': sign(raw, conn[B].secret) } });
  assert.strictEqual(now.status, 200);
  assert.strictEqual(db.whatsapp_messages.filter(m => m.business_id === B && m.direction === 'inbound').length, 1);
});

test('a suspended business\'s not-yet-connected webhook address is not verified', async () => {
  db.business_whatsapp = db.business_whatsapp.filter(w => w.business_id !== B);
  await whatsapp.ensureWebhookDetails(B);
  const row = db.business_whatsapp.find(w => w.business_id === B);
  const token = secrets.decrypt(row.verify_token_enc);
  db.businesses.find(b => b.id === B).status = 'suspended';
  const r = await request('GET', `/webhook/${row.webhook_key}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(token)}&hub.challenge=1`);
  assert.strictEqual(r.status, 404);
});

test('Arogya on the environment settings still shows the old /webhook address', async () => {
  const s = await whatsapp.connectionStatus(A, { prepare: true });
  assert.strictEqual(s.source, 'saved'); // seeded with a saved connection
  db.business_whatsapp = db.business_whatsapp.filter(w => w.business_id !== A);
  process.env.WHATSAPP_TOKEN = 'EAAG-env-token-123456789';
  process.env.PHONE_NUMBER_ID = '555555555555555';
  const { config } = require('../server/config.cjs');
  const keep = { t: config.whatsappToken, p: config.phoneNumberId };
  config.whatsappToken = process.env.WHATSAPP_TOKEN;
  config.phoneNumberId = process.env.PHONE_NUMBER_ID;
  try {
    const env = await whatsapp.connectionStatus(A, { prepare: true });
    assert.strictEqual(env.source, 'env');
    assert.match(env.webhookUrl, /\/webhook$/);
    assert.strictEqual(env.verifyToken, 'env_verify_token');
    assert.strictEqual(db.business_whatsapp.some(w => w.business_id === A), false, 'no empty row made for the environment business');
  } finally {
    config.whatsappToken = keep.t;
    config.phoneNumberId = keep.p;
    process.env.WHATSAPP_TOKEN = '';
    process.env.PHONE_NUMBER_ID = '';
  }
});

test('bad input is rejected before calling Meta', async () => {
  assert.match(whatsapp.validateInput({ phoneNumberId: 'abc', wabaId: '1' }).error, /Phone number ID/);
  assert.match(whatsapp.validateInput({ phoneNumberId: '12345', wabaId: 'x' }).error, /Business Account ID/);
  assert.match(whatsapp.validateInput({ phoneNumberId: '12345', wabaId: '12345', appSecret: 'short' }).error, /App secret/);
  assert.match(whatsapp.validateInput({ phoneNumberId: '12345', wabaId: '12345', accessToken: 'has space in it and is long enough' }).error, /access token/);
});
