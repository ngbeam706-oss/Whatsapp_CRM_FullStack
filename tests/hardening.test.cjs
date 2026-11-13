// Production hardening: security headers, rate limits, sign-in failure guard, crash reports,
// JSON error handler. Fake Supabase, no network.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const A = 'a0000000-0000-4000-8000-000000000001';
process.env.VITE_SUPABASE_URL = 'http://fake.supabase';
process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
process.env.WHATSAPP_BUSINESS_ID = A;

const app = require('../server/app.cjs');
const { _setStaffForToken } = require('../server/auth.cjs');
const security = require('../server/security.cjs');
const events = require('../server/events.cjs');

let saved; // system_events rows written
let authLookups;
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
  if (u.startsWith('http://fake.supabase/auth/v1/user')) { authLookups++; return json({ msg: 'invalid JWT' }, 401); }
  if (u.startsWith('http://fake.supabase/rest/v1/system_events') && opts.method === 'POST') { saved.push(JSON.parse(opts.body)); return json([], 201); }
  return json([]);
};

let server;
let base;
before(async () => {
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
beforeEach(() => { saved = []; authLookups = 0; security._resetLimits(); events._reset?.(); });

function request(method, path, { body, token, ip = '203.0.113.1', raw } = {}) {
  return new Promise((resolve, reject) => {
    const data = raw !== undefined ? raw : body === undefined ? null : JSON.stringify(body);
    const req = http.request(`${base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-nf-client-connection-ip': ip,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => { let t = ''; res.on('data', c => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: t })); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

_setStaffForToken('agent-token', { id: 'f0000000-0000-4000-8000-000000000001', email: 'agent@a.test', role: 'agent', businessId: A, businessName: 'Arogya' });

test('every response carries the security headers; API answers are never cached', async () => {
  const r = await request('GET', '/api/health');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers['x-content-type-options'], 'nosniff');
  assert.strictEqual(r.headers['x-frame-options'], 'DENY');
  assert.strictEqual(r.headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.match(r.headers['permissions-policy'], /camera=\(\)/);
  assert.strictEqual(r.headers['cache-control'], 'no-store');
  assert.strictEqual(r.headers['x-powered-by'], undefined);
});

test('broken JSON gets a short JSON error, never a stack trace', async () => {
  const r = await request('POST', '/api/inbox/contacts', { raw: '{"oops":', token: 'agent-token' });
  assert.strictEqual(r.status, 400);
  assert.match(r.text, /not valid JSON/);
  assert.ok(!/at \w+ \(|node_modules|\.cjs/.test(r.text), 'no stack trace in the answer');
});

test('too many refused sign-ins from one address -> 429 before any more token lookups', async () => {
  for (let i = 0; i < 30; i++) assert.strictEqual((await request('GET', '/api/inbox/contacts', { token: `guess-${i}` })).status, 403);
  const lookupsBefore = authLookups;
  const blocked = await request('GET', '/api/inbox/contacts', { token: 'guess-31' });
  assert.strictEqual(blocked.status, 429);
  assert.ok(Number(blocked.headers['retry-after']) > 0);
  assert.strictEqual(authLookups, lookupsBefore, 'blocked requests cost no Supabase lookup');
  // Another address is not affected.
  assert.strictEqual((await request('GET', '/api/inbox/contacts', { token: 'guess-x', ip: '198.51.100.7' })).status, 403);
  assert.ok(saved.some(e => e.code === 'too_many_auth_failures' && e.source === 'auth'));
});

test('missing tokens (401) count too; platform console refusals count', async () => {
  for (let i = 0; i < 30; i++) await request('GET', i % 2 ? '/api/inbox/contacts' : '/api/platform/overview', { ip: '192.0.2.9' });
  assert.strictEqual((await request('GET', '/api/inbox/contacts', { ip: '192.0.2.9' })).status, 429);
});

test('a role refusal (agent on a manager page) never locks the agent out', async () => {
  for (let i = 0; i < 40; i++) {
    const r = await request('GET', '/api/analytics?days=7', { token: 'agent-token' });
    assert.strictEqual(r.status, 403, `request ${i + 1}`);
  }
});

test('the dashboard API allows 600 requests a minute per address, then 429', async () => {
  let last;
  for (let i = 0; i < 600; i++) {
    last = await request('GET', '/api/health', { ip: '192.0.2.50' });
    if (last.status !== 200) break;
  }
  assert.strictEqual(last.status, 200);
  const r = await request('GET', '/api/health', { ip: '192.0.2.50' });
  assert.strictEqual(r.status, 429);
  assert.strictEqual((await request('GET', '/api/health', { ip: '192.0.2.51' })).status, 200);
  assert.ok(saved.some(e => e.code === 'rate_limited_api'));
});

test('Meta\'s webhook is not rate limited (bursts of delivery receipts)', async () => {
  for (let i = 0; i < 650; i++) {
    const r = await request('GET', '/api/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1', { ip: '31.13.0.1' });
    assert.notStrictEqual(r.status, 429, `request ${i + 1}`);
  }
});

test('crash reports: staff only, scrubbed, at most 10 a minute per address', async () => {
  assert.strictEqual((await request('POST', '/api/client-errors', { body: { screen: 'ads', message: 'x' } })).status, 401);
  const r = await request('POST', '/api/client-errors', {
    token: 'agent-token',
    body: { screen: 'ads', name: 'TypeError', message: 'Cannot read x of +91 98765 43210 ravi@example.com\nat AdsScreen.jsx:10', path: '/' },
  });
  assert.strictEqual(r.status, 204);
  const e = saved.find(x => x.code === 'frontend_crash_ads');
  assert.ok(e);
  assert.strictEqual(e.source, 'system');
  assert.strictEqual(e.business_id, A);
  assert.ok(!/98765|ravi@|AdsScreen\.jsx/.test(e.message), `scrubbed: ${e.message}`);
  assert.deepStrictEqual(e.details, { screen: 'ads', role: 'agent' });
  for (let i = 0; i < 9; i++) await request('POST', '/api/client-errors', { token: 'agent-token', body: { screen: 'inbox', message: `m${i}` } });
  assert.strictEqual((await request('POST', '/api/client-errors', { token: 'agent-token', body: { screen: 'inbox', message: 'm' } })).status, 429);
});

test('unexpected server errors: generic 500 answer, logged without leaking details', async () => {
  const res = { headersSent: false, statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  const orig = console.error;
  console.error = () => {};
  try {
    security.errorHandler(new Error('db password=hunter2 failed'), { method: 'GET', path: '/api/x' }, res, () => {});
  } finally {
    console.error = orig;
  }
  assert.strictEqual(res.statusCode, 500);
  assert.ok(!JSON.stringify(res.body).includes('hunter2'));
  await new Promise(r => setTimeout(r, 10));
  const e = saved.find(x => x.code === 'unhandled_error');
  assert.ok(e && !e.message.includes('hunter2'));
});

test('POST /api/send (call link) follows the Inbox rules: ownership, 24h window, logging', async () => {
  const inbox = require('../server/inbox.cjs');
  const orig = inbox.sendText;
  const calls = [];
  inbox.sendText = async (phone, text, staff) => {
    calls.push([phone, text, staff.email]);
    return phone === '919000000002'
      ? { error: 'This chat belongs to asha@a.test. You can view it, but only they can work on it.', status: 403 }
      : { sent: true, id: 'wamid.1' };
  };
  try {
    const ok = await request('POST', '/api/send', { token: 'agent-token', body: { to: '+91 90000 00001', message: 'Call link' } });
    assert.strictEqual(ok.status, 200, ok.text);
    assert.deepStrictEqual(calls[0], ['919000000001', 'Call link', 'agent@a.test']);
    const denied = await request('POST', '/api/send', { token: 'agent-token', body: { to: '919000000002', message: 'Call link' } });
    assert.strictEqual(denied.status, 403);
    // The old interactive modes (no ownership checks) are gone.
    const buttons = await request('POST', '/api/send', { token: 'agent-token', body: { to: '919000000001', message: 'x', type: 'buttons', buttons: [{ id: 'a', title: 'A' }] } });
    assert.strictEqual(buttons.status, 400);
    assert.strictEqual(calls.length, 2);
  } finally {
    inbox.sendText = orig;
  }
});

test('client address: Netlify header first, then x-forwarded-for', () => {
  const req = (h) => ({ get: (k) => h[k.toLowerCase()], socket: { remoteAddress: '10.0.0.1' } });
  assert.strictEqual(security.clientIp(req({ 'x-nf-client-connection-ip': '1.2.3.4', 'x-forwarded-for': '5.6.7.8' })), '1.2.3.4');
  assert.strictEqual(security.clientIp(req({ 'x-forwarded-for': '5.6.7.8, 10.0.0.2' })), '5.6.7.8');
  assert.strictEqual(security.clientIp(req({})), '10.0.0.1');
});
