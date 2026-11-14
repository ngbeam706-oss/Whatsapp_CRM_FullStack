// The Application URL (server/siteUrl.cjs, Platform console -> Branding): the address every business's WhatsApp
// webhook URL, customers' call links and invite / password email links are built from. Platform Owner only; https
// domain only (no path, port, IP or local address); saved only when the app answers at <address>/api/health;
// audited old -> new; the branding details save keeps it; empty = back to the default.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

process.env.APP_SECRET = 'server_encryption_secret_long_enough';
process.env.VITE_SUPABASE_URL = 'http://fake.supabase';
process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
process.env.PUBLIC_SITE_URL = 'https://default-site.example.test';

const app = require('../server/app.cjs');
const branding = require('../server/branding.cjs');
const site = require('../server/siteUrl.cjs');
const { webhookUrl } = require('../server/whatsapp.cjs');
const { createCallLink } = require('../server/calls.cjs');
const { _setPlatformAdminForToken } = require('../server/platform.cjs');
const { _resetLimits } = require('../server/security.cjs');

let db, health, asked;
function seed() {
  db = { platform_settings: [{ id: 1, maintenance_on: false, branding: { brandName: 'ChatDesk' } }], audit_log: [] };
  health = { 'https://crm.sunrise.example': { ok: true } };
  asked = [];
  branding.clearCache(); _resetLimits();
}
const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  // The reachability check: <address>/api/health.
  if (u.startsWith('https://') && u.endsWith('/api/health')) {
    const origin = u.slice(0, -'/api/health'.length);
    asked.push(origin);
    return origin in health ? json(health[origin]) : json({ message: 'not found' }, 404);
  }
  if (!u.startsWith('http://fake.supabase/rest/v1/')) return json({});
  const [path, qs = ''] = u.slice('http://fake.supabase/rest/v1/'.length).split('?');
  const method = opts.method || 'GET';
  const rows = (db[path] ||= []);
  const select = new URLSearchParams(qs).get('select');
  if (method === 'GET') return json(rows.map(r => (select && select !== '*' ? Object.fromEntries(select.split(',').map(k => [k, r[k] ?? null])) : r)));
  if (method === 'POST') {
    const body = JSON.parse(opts.body);
    if (path === 'platform_settings') { const hit = rows.find(r => r.id === body.id); if (hit) Object.assign(hit, body); else rows.push(body); } else rows.push(body);
    return json([], 201);
  }
  return json([]);
};

let server, base;
before(async () => { server = app.listen(0); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
beforeEach(seed);
function request(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } },
      (res) => { let t = ''; res.on('data', c => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, json: () => (t ? JSON.parse(t) : null) })); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
_setPlatformAdminForToken('su-owner', { id: 'p1', email: 'root@platform.test', role: 'owner' });
_setPlatformAdminForToken('su-manager', { id: 'p2', email: 'support@platform.test', role: 'manager' });
_setPlatformAdminForToken('su-developer', { id: 'p3', email: 'dev@platform.test', role: 'developer' });
const saved = () => db.platform_settings[0].branding;

test('pure: only an https domain, cleaned; no path, port, query, IP or local address; empty = default', () => {
  assert.deepStrictEqual(site.cleanAppUrl(' https://CRM.Sunrise.Example/ '), { value: 'https://crm.sunrise.example' });
  assert.deepStrictEqual(site.cleanAppUrl('crm.sunrise.example'), { value: 'https://crm.sunrise.example' }, 'https:// is added');
  assert.deepStrictEqual(site.cleanAppUrl(''), { value: '' });
  assert.match(site.cleanAppUrl('http://crm.sunrise.example').error, /https/);
  assert.match(site.cleanAppUrl('ftp://crm.sunrise.example').error, /https/);
  for (const bad of ['https://crm.sunrise.example/app', 'https://crm.sunrise.example:8443', 'https://crm.sunrise.example?x=1', 'https://user:pw@crm.sunrise.example']) {
    assert.match(site.cleanAppUrl(bad).error, /Only the address itself/, bad);
  }
  for (const bad of ['https://localhost', 'https://127.0.0.1', 'https://10.0.0.5', 'https://192.168.1.10', 'https://intranet', 'https://8.8.8.8']) {
    assert.match(site.cleanAppUrl(bad).error, /public web address/, bad);
  }
});

test('links follow it: webhook URL, call link; default until set', async () => {
  assert.strictEqual(await site.siteUrl(), 'https://default-site.example.test');
  assert.strictEqual(webhookUrl('abc123', await site.siteUrl()), 'https://default-site.example.test/webhook/abc123');
  saved().appUrl = 'https://crm.sunrise.example';
  branding.clearCache();
  const now = await site.siteUrl();
  assert.strictEqual(now, 'https://crm.sunrise.example');
  assert.strictEqual(webhookUrl('abc123', now), 'https://crm.sunrise.example/webhook/abc123');
  assert.strictEqual(webhookUrl(null, now), 'https://crm.sunrise.example/webhook', 'the first business\'s plain /webhook too');
  const link = createCallLink({ businessId: 'a0000000-0000-4000-8000-000000000001', phone: '919000000001', outbound: true, baseUrl: now });
  assert.match(link.url, /^https:\/\/crm\.sunrise\.example\/call\.html\?/);
  // A broken saved value is ignored (never used to build links).
  saved().appUrl = 'javascript:alert(1)';
  branding.clearCache();
  assert.strictEqual(await site.siteUrl(), 'https://default-site.example.test');
});

test('save: Platform Owner only; saved only when the app answers there; audited; empty goes back to the default', async () => {
  for (const t of ['su-manager', 'su-developer']) assert.strictEqual((await request('PUT', '/api/platform/branding/app-url', t, { appUrl: 'https://crm.sunrise.example' })).status, 403, t);
  assert.strictEqual(saved().appUrl, undefined);

  const notThere = await request('PUT', '/api/platform/branding/app-url', 'su-owner', { appUrl: 'https://typo.sunrise.example' });
  assert.strictEqual(notThere.status, 400);
  assert.match(notThere.json().error, /doesn't answer at https:\/\/typo\.sunrise\.example\/api\/health/);
  assert.strictEqual(saved().appUrl, undefined, 'nothing saved');
  health['https://other-app.example'] = { status: 'up' };
  assert.strictEqual((await request('PUT', '/api/platform/branding/app-url', 'su-owner', { appUrl: 'https://other-app.example' })).status, 400, 'another app at that address is refused');
  assert.strictEqual((await request('PUT', '/api/platform/branding/app-url', 'su-owner', { appUrl: 'http://crm.sunrise.example' })).status, 400);

  const ok = await request('PUT', '/api/platform/branding/app-url', 'su-owner', { appUrl: 'https://crm.sunrise.example/' });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.json()));
  assert.deepStrictEqual([ok.json().appUrl, ok.json().appUrlInUse, ok.json().appUrlDefault], ['https://crm.sunrise.example', 'https://crm.sunrise.example', 'https://default-site.example.test']);
  assert.deepStrictEqual([saved().appUrl, saved().brandName], ['https://crm.sunrise.example', 'ChatDesk'], 'the other details are kept');
  const a = db.audit_log.at(-1);
  assert.deepStrictEqual([a.action, a.details.from, a.details.to], ['platform.app_url_changed', 'https://default-site.example.test', 'https://crm.sunrise.example']);

  // Saving the other branding details keeps the Application URL.
  assert.strictEqual((await request('PUT', '/api/platform/branding', 'su-owner', { tagline: 'Chats that convert' })).status, 200);
  assert.deepStrictEqual([saved().appUrl, saved().tagline], ['https://crm.sunrise.example', 'Chats that convert']);

  // Back to the default: no reachability check needed.
  asked = [];
  const back = await request('PUT', '/api/platform/branding/app-url', 'su-owner', { appUrl: '' });
  assert.strictEqual(back.status, 200);
  assert.strictEqual(saved().appUrl, undefined);
  assert.deepStrictEqual(asked, []);
  assert.strictEqual(await site.siteUrl(), 'https://default-site.example.test');
});
