// Platform maintenance mode: only the Platform Admin switches it; while on, every business's staff API
// answers 503 (dashboards show a maintenance screen), the public status says so, the webhook keeps
// working and the worker holds sending. Fake database; the real migration on PGlite for the table rules.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const AROGYA = 'a0000000-0000-4000-8000-000000000001';
process.env.APP_SECRET = 'server_encryption_secret_long_enough';
process.env.VITE_SUPABASE_URL = 'http://fake.supabase';
process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
process.env.WHATSAPP_BUSINESS_ID = AROGYA;

const app = require('../server/app.cjs');
const platform = require('../server/platform.cjs');
const maintenance = require('../server/maintenance.cjs');
const { _setStaffForToken } = require('../server/auth.cjs');
const { freshDb, asUser } = require('./helpers/pgHarness.cjs');

let db;
function seed() {
  db = { platform_settings: [{ id: 1, maintenance_on: false }], audit_log: [], system_events: [], worker_runs: [], whatsapp_leads: [] };
  maintenance.clearCache();
}
const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  if (!u.startsWith('http://fake.supabase/rest/v1/')) return json({ error: { message: 'offline in tests' } }, 503);
  const [path] = u.slice('http://fake.supabase/rest/v1/'.length).split('?');
  const body = opts.body ? JSON.parse(opts.body) : null;
  const rows = (db[path] ||= []);
  if (method === 'GET') return json(rows);
  if (method === 'POST') {
    for (const r of Array.isArray(body) ? body : [body]) {
      if (path === 'platform_settings') { const ex = rows.find(x => x.id === r.id); if (ex) Object.assign(ex, r); else rows.push(r); } else rows.push(r);
    }
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
    const req = http.request(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
    }, (res) => { let t = ''; res.on('data', c => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: t, json: () => JSON.parse(t) })); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

platform._setPlatformAdminForToken('platform', { id: 'p1', email: 'platform@crm.test' });
platform._setPlatformAdminForToken('owner', null);
_setStaffForToken('owner', { id: 'u1', email: 'owner@arogya.test', role: 'owner', businessId: AROGYA, businessName: 'Arogya Ruchulu' });
const later = () => new Date(Date.now() + 3600000).toISOString();

test('off by default: staff work normally and the public status says off', async () => {
  assert.deepStrictEqual((await request('GET', '/api/maintenance')).json(), { on: false, message: null, until: null });
  assert.notStrictEqual((await request('GET', '/api/status', 'owner')).status, 503);
});

test('only the Platform Admin can switch it; a Business Admin cannot', async () => {
  assert.strictEqual((await request('PUT', '/api/platform/maintenance', 'owner', { on: true })).status, 403);
  assert.strictEqual((await request('PUT', '/api/platform/maintenance', null, { on: true })).status, 401);
  assert.strictEqual(db.platform_settings[0].maintenance_on, false);
});

test('on: every staff route answers 503 with the message; the console, webhook and public status still work', async () => {
  const until = later();
  const r = await request('PUT', '/api/platform/maintenance', 'platform', { on: true, message: 'Upgrading, back soon.', until });
  assert.strictEqual(r.status, 200, r.text);
  assert.strictEqual(r.json().maintenance.on, true);
  const row = db.platform_settings[0];
  assert.deepStrictEqual([row.maintenance_on, row.maintenance_message, row.maintenance_until, row.updated_by], [true, 'Upgrading, back soon.', until, 'platform@crm.test']);
  assert.ok(row.maintenance_started);
  assert.ok(db.audit_log.some(a => a.action === 'platform.maintenance_on' && a.business_id === null && a.actor_role === 'platform_admin'));
  assert.ok(db.system_events.some(e => e.code === 'maintenance_on'));

  for (const path of ['/api/status', '/api/inbox', '/api/queries', '/api/bot-catalog']) {
    const s = await request('GET', path, 'owner');
    assert.strictEqual(s.status, 503, path);
    assert.deepStrictEqual(s.json(), { maintenance: true, error: 'Upgrading, back soon.', until });
    assert.strictEqual(s.headers['retry-after'], '120');
  }
  // Even without a login the staff API says "maintenance" (no account details are checked or leaked).
  assert.strictEqual((await request('GET', '/api/inbox')).status, 503);

  assert.deepStrictEqual((await request('GET', '/api/maintenance')).json(), { on: true, message: 'Upgrading, back soon.', until });
  assert.strictEqual((await request('GET', '/api/platform/maintenance', 'platform')).status, 200, 'the console keeps working');
  assert.strictEqual((await request('GET', '/api/health')).status, 200);
  // The Meta webhook is not closed: an unsigned call is refused for its signature, not for maintenance.
  assert.notStrictEqual((await request('POST', '/webhook', null, { object: 'whatsapp_business_account', entry: [] })).status, 503);
});

test('off again: staff are back at once, and the default message is used when none is given', async () => {
  await request('PUT', '/api/platform/maintenance', 'platform', { on: true });
  const s = await request('GET', '/api/inbox', 'owner');
  assert.strictEqual(s.json().error, maintenance.DEFAULT_MESSAGE);
  const off = await request('PUT', '/api/platform/maintenance', 'platform', { on: false });
  assert.strictEqual(off.json().maintenance.on, false);
  assert.notStrictEqual((await request('GET', '/api/status', 'owner')).status, 503);
  assert.ok(db.audit_log.some(a => a.action === 'platform.maintenance_off'));
  assert.strictEqual(db.platform_settings[0].maintenance_until, null);
});

test('bad input is refused', async () => {
  assert.strictEqual((await request('PUT', '/api/platform/maintenance', 'platform', { on: 'yes' })).status, 400);
  assert.match((await request('PUT', '/api/platform/maintenance', 'platform', { on: true, until: '2001-01-01T00:00:00Z' })).json().error, /in the past/);
  assert.match((await request('PUT', '/api/platform/maintenance', 'platform', { on: true, until: 'soon' })).json().error, /not a valid date/);
  assert.strictEqual((await request('PUT', '/api/platform/maintenance', 'platform', { on: true, message: 'x'.repeat(501) })).status, 400);
  assert.strictEqual(db.platform_settings[0].maintenance_on, false);
});

test('if the setting can\'t be read, the platform stays open (never locks everyone out by accident)', async () => {
  db.platform_settings = undefined;
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => (String(url).includes('platform_settings') ? json({ message: 'relation does not exist' }, 404) : realFetch(url, opts));
  try {
    maintenance.clearCache();
    assert.strictEqual((await maintenance.getState()).on, false);
    assert.notStrictEqual((await request('GET', '/api/status', 'owner')).status, 503);
  } finally {
    global.fetch = realFetch;
  }
});

test('the worker holds follow-ups, broadcasts and the ads sync during maintenance', async () => {
  const { runWorker } = require('../netlify/functions/broadcast-worker.cjs');
  const ran = [];
  const tasks = Object.fromEntries(['enforceBilling', 'autoCloseQueries', 'prune', 'processDueRuns', 'scanInactive', 'processBatches', 'syncAdsDue']
    .map(k => [k, async () => { ran.push(k); return { done: 1 }; }]));
  const held = await runWorker({ hourly: false, tasks: { ...tasks, maintenanceState: async () => ({ on: true }) } });
  assert.deepStrictEqual(ran, []);
  assert.deepStrictEqual(held.steps.maintenance.result, { on: true });
  await runWorker({ hourly: false, tasks: { ...tasks, maintenanceState: async () => ({ on: false }) } });
  assert.ok(ran.includes('processDueRuns') && ran.includes('processBatches'));
});

test('migration: one settings row, server-only, safe to re-run', async () => {
  const pg = await freshDb();
  await pg.exec(require('fs').readFileSync(require('path').join(__dirname, '..', 'supabase', 'migrations', '20261117_platform_settings.sql'), 'utf8'));
  const rows = await pg.query('select id, maintenance_on from public.platform_settings');
  assert.deepStrictEqual(rows.rows, [{ id: 1, maintenance_on: false }]);
  await assert.rejects(pg.query('insert into public.platform_settings (id) values (2)'));
  const u = await pg.query("insert into auth.users (email) values ('owner@arogya.test') returning id");
  await pg.query("insert into public.staff_members (user_id, email, role, business_id) values ($1, 'owner@arogya.test', 'owner', $2)", [u.rows[0].id, AROGYA]);
  await assert.rejects(asUser(pg, u.rows[0].id, () => pg.query('select * from public.platform_settings')), /permission denied/);
});
