// Voice calls (server/calls.cjs): signed call links, and an "incoming call" alert that reaches ONLY the
// business the link belongs to. Before 2026-11-09 the customer page broadcast every call on one shared
// channel that every business's dashboard listened to. Fake database and fake Realtime, no network.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const AROGYA = 'a0000000-0000-4000-8000-000000000001';
const MAYURA = 'b0000000-0000-4000-8000-000000000002';

process.env.APP_SECRET = 'test_app_secret_with_enough_length';
process.env.VERIFY_TOKEN = 'test_verify_token';
process.env.WHATSAPP_TOKEN = '';
process.env.PHONE_NUMBER_ID = '';
process.env.VITE_SUPABASE_URL = 'http://fake.supabase';
process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
process.env.PUBLIC_SITE_URL = 'https://crm.example.test';

const calls = require('../server/calls.cjs');
const app = require('../server/app.cjs');
const { _setStaffForToken } = require('../server/auth.cjs');
const { _resetLimits } = require('../server/security.cjs');

_setStaffForToken('arogya-agent', { id: 'c0000000-0000-4000-8000-00000000000d', email: 'agent@arogya.test', role: 'agent', businessId: AROGYA, businessName: 'Arogya Ruchulu' });
_setStaffForToken('mayura-owner', { id: 'c0000000-0000-4000-8000-00000000000a', email: 'admin@mayura.test', role: 'owner', businessId: MAYURA, businessName: 'Mayura Hospitals' });

// ---- fake Supabase: record Realtime broadcasts; REST answers empty --------------------------
let broadcasts = [];
let realtimeOk = true;
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u === 'http://fake.supabase/realtime/v1/api/broadcast') {
    broadcasts.push({ headers: opts.headers, body: JSON.parse(opts.body) });
    return new Response(realtimeOk ? '' : 'down', { status: realtimeOk ? 202 : 500 });
  }
  return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
};
beforeEach(() => { broadcasts = []; realtimeOk = true; _resetLimits(); });

let server;
let base;
before(async () => {
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

/** Our own test server (global fetch is the fake above). */
function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
    }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, json: text ? JSON.parse(text) : null }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const tokenOf = (url) => new URL(url).searchParams.get('t');

// ---- staff channels --------------------------------------------------------------------------
test('each business has its own, unguessable incoming-call channel', () => {
  const a = calls.staffChannel(AROGYA);
  const m = calls.staffChannel(MAYURA);
  assert.match(a, /^incoming_calls_[A-Za-z0-9_-]{32}$/);
  assert.notStrictEqual(a, m);
  assert.strictEqual(calls.staffChannel(AROGYA), a, 'stable for one business');
  assert.ok(!a.includes(AROGYA) && !a.includes('a0000000'), 'the name does not reveal the business id');
  assert.notStrictEqual(a, 'whatsapp_incoming_calls');
  assert.strictEqual(calls.staffChannel('not-a-business'), null);
});

// ---- links and tokens ------------------------------------------------------------------------
test('a call link has a random room, a signed token and the business name, and no phone number', () => {
  const one = calls.createCallLink({ businessId: AROGYA, businessName: 'Arogya Ruchulu', phone: '+91 90000 00001', name: 'Ravi', outbound: false });
  const two = calls.createCallLink({ businessId: AROGYA, businessName: 'Arogya Ruchulu', phone: '919000000001', name: 'Ravi', outbound: false });
  assert.match(one.roomId, /^room_[0-9a-f]{32}$/);
  assert.notStrictEqual(one.roomId, two.roomId, 'rooms are random, not room_<phone>');
  const url = new URL(one.url);
  assert.strictEqual(url.origin + url.pathname, 'https://crm.example.test/call.html');
  assert.strictEqual(url.searchParams.get('room'), one.roomId);
  assert.strictEqual(url.searchParams.get('business'), 'Arogya Ruchulu');
  assert.ok(!one.url.includes('919000000001') && !url.searchParams.has('phone'), 'the customer number is not in the link');
  const data = calls.verifyToken(tokenOf(one.url));
  assert.deepStrictEqual({ b: data.b, r: data.r, p: data.p, n: data.n, o: data.o }, { b: AROGYA, r: one.roomId, p: '919000000001', n: 'Ravi', o: false });
});

test('a token that was changed, signed with another secret, or expired is refused', () => {
  const { url } = calls.createCallLink({ businessId: AROGYA, phone: '919000000001', name: 'Ravi', outbound: false });
  const token = tokenOf(url);
  const [body, sig] = token.split('.');

  // Point it at another business, keeping the old signature.
  const data = JSON.parse(Buffer.from(body, 'base64url').toString());
  const forged = Buffer.from(JSON.stringify({ ...data, b: MAYURA })).toString('base64url');
  assert.strictEqual(calls.verifyToken(`${forged}.${sig}`), null);
  // A flipped signature character.
  assert.strictEqual(calls.verifyToken(`${body}.${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`), null);
  // Garbage.
  for (const bad of [undefined, null, '', 'x', 'a.b.c', 42, `${body}.`, '.'.repeat(3000)]) assert.strictEqual(calls.verifyToken(bad), null);
  // Expired.
  assert.ok(calls.verifyToken(token));
  assert.strictEqual(calls.verifyToken(token, Date.now() + calls.LINK_TTL_MS + 1000), null);
});

// ---- POST /api/call-ring (public) ---------------------------------------------------------
test('opening a link rings ONLY its own business, with the details from the signed token', async () => {
  const { url, roomId } = calls.createCallLink({ businessId: AROGYA, businessName: 'Arogya Ruchulu', phone: '919000000001', name: 'Ravi', outbound: false });
  const r = await request('POST', '/api/call-ring', { t: tokenOf(url), name: 'Someone else', phone: '1' });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.json, { success: true, rang: true });

  assert.strictEqual(broadcasts.length, 1);
  const msg = broadcasts[0].body.messages[0];
  assert.strictEqual(msg.topic, calls.staffChannel(AROGYA));
  assert.notStrictEqual(msg.topic, calls.staffChannel(MAYURA));
  assert.strictEqual(msg.event, 'incoming_call');
  // Name and number come from the token, never from what the page sends.
  assert.deepStrictEqual(msg.payload, { name: 'Ravi', phone: '919000000001', roomId });
  // Sent with the server key, not the public one.
  assert.strictEqual(broadcasts[0].headers.apikey, 'sb_secret_test');
});

test('a call staff started (outbound) does not ring anyone', async () => {
  const { url } = calls.createCallLink({ businessId: AROGYA, phone: '919000000001', name: 'Ravi', outbound: true });
  const r = await request('POST', '/api/call-ring', { t: tokenOf(url) });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.json, { success: true, rang: false });
  assert.strictEqual(broadcasts.length, 0);
});

test('a missing, forged or old-style link cannot ring', async () => {
  for (const body of [{}, { t: '' }, { t: 'forged.token' }, { t: 123 }]) {
    const r = await request('POST', '/api/call-ring', body);
    assert.strictEqual(r.status, 400, JSON.stringify(body));
    assert.strictEqual(r.json.success, false);
  }
  assert.strictEqual(broadcasts.length, 0);
});

test('if Realtime is down the page is told, and nothing else breaks', async () => {
  realtimeOk = false;
  const { url } = calls.createCallLink({ businessId: AROGYA, phone: '919000000001', name: 'Ravi', outbound: false });
  const r = await request('POST', '/api/call-ring', { t: tokenOf(url) });
  assert.strictEqual(r.status, 502);
  assert.strictEqual(r.json.success, false);
});

test('call-ring is rate-limited per address', async () => {
  const { url } = calls.createCallLink({ businessId: AROGYA, phone: '919000000001', name: 'Ravi', outbound: true });
  let last;
  for (let i = 0; i < 21; i++) last = await request('POST', '/api/call-ring', { t: tokenOf(url) });
  assert.strictEqual(last.status, 429);
});

// ---- staff routes ----------------------------------------------------------------------------
test('/api/status gives each business only its OWN call channel', async () => {
  const a = await request('GET', '/api/status', undefined, 'arogya-agent');
  const m = await request('GET', '/api/status', undefined, 'mayura-owner');
  assert.strictEqual(a.status, 200);
  assert.strictEqual(a.json.callChannel, calls.staffChannel(AROGYA));
  assert.strictEqual(m.json.callChannel, calls.staffChannel(MAYURA));
  assert.notStrictEqual(a.json.callChannel, m.json.callChannel);
  // Without a login there is no channel to learn.
  const anon = await request('GET', '/api/status');
  assert.strictEqual(anon.status, 401);
});

test('POST /api/calls/link: a signed, outbound link for the caller\'s own business', async () => {
  const r = await request('POST', '/api/calls/link', { phone: '919000000002', name: 'Patient' }, 'mayura-owner');
  assert.strictEqual(r.status, 200);
  const data = calls.verifyToken(tokenOf(r.json.url));
  assert.strictEqual(data.b, MAYURA);
  assert.strictEqual(data.o, true);
  assert.strictEqual(data.r, r.json.roomId);
  assert.strictEqual(new URL(r.json.url).searchParams.get('business'), 'Mayura Hospitals');

  const bad = await request('POST', '/api/calls/link', { phone: 'abc' }, 'mayura-owner');
  assert.strictEqual(bad.status, 400);
  const anon = await request('POST', '/api/calls/link', { phone: '919000000002' });
  assert.strictEqual(anon.status, 401);
});
