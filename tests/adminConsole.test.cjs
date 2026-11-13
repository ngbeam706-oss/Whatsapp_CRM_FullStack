// Admin console monitoring: health, alerts, event log, worker runs, delivery counts, audit log,
// business detail. Platform admins only; never chat content, phone numbers or tokens.
// Fake database + fake Meta, no network. RLS checked on the real migration (PGlite).
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');

const AROGYA = 'a0000000-0000-4000-8000-000000000001';
const MAYURA = 'b0000000-0000-4000-8000-000000000002';
const MAYURA_APP_SECRET = 'fedcba9876543210fedcba9876543210';
const WEBHOOK_KEY = 'b'.repeat(32);

process.env.APP_SECRET = 'server_encryption_secret_long_enough';
process.env.WHATSAPP_TOKEN = '';
process.env.PHONE_NUMBER_ID = '';
process.env.VITE_SUPABASE_URL = 'http://fake.supabase';
process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
process.env.WHATSAPP_BUSINESS_ID = AROGYA;

const secrets = require('../server/secrets.cjs');
const app = require('../server/app.cjs');
const { _setStaffForToken } = require('../server/auth.cjs');
const platform = require('../server/platform.cjs');
const events = require('../server/events.cjs');
const monitor = require('../server/monitor.cjs');
const meta = require('../server/meta.cjs');
const whatsapp = require('../server/whatsapp.cjs');
const { freshDb, migrationSql, asUser } = require('./helpers/pgHarness.cjs');

const SECRET = 'PRIVATE_CUSTOMER_DATA';
const CUSTOMER_PHONE = '919000000001';
const CONTENT_TABLES = ['whatsapp_messages', 'whatsapp_leads', 'campaign_recipients', 'lead_notes', 'contact_events'];
let db;
let calls;
let graphReply;

function seed() {
  const old = new Date(Date.now() - 40 * 60000).toISOString();
  db = {
    businesses: [
      { id: AROGYA, name: 'Arogya Ruchulu', slug: 'arogya-ruchulu', status: 'active', plan_id: 'pro', paid_until: null, limit_overrides: {}, created_at: '2026-11-01T00:00:00Z' },
      { id: MAYURA, name: 'Mayura Hospitals', slug: 'mayura-hospitals', status: 'active', plan_id: 'starter', paid_until: '2026-01-01', limit_overrides: {}, industry: 'hospital', created_at: '2026-11-05T00:00:00Z' },
    ],
    plans: [
      { id: 'starter', name: 'Starter', sort_order: 1, max_staff: 1, max_contacts: 1, max_broadcasts_month: 100, ai_enabled: false },
      { id: 'growth', name: 'Growth', sort_order: 2 },
      { id: 'pro', name: 'Pro', sort_order: 3 },
    ],
    staff_members: [
      { business_id: AROGYA, user_id: 'u1', email: 'owner@arogya.test', role: 'owner' },
      { business_id: MAYURA, user_id: 'u2', email: 'owner@mayura.test', role: 'owner' },
      { business_id: MAYURA, user_id: 'u3', email: 'agent@mayura.test', role: 'agent' },
    ],
    whatsapp_leads: [
      { business_id: MAYURA, phone: CUSTOMER_PHONE, name: `${SECRET} Ravi`, opted_out: true },
      { business_id: MAYURA, phone: '919000000002', name: `${SECRET} Sita`, opted_out: false },
    ],
    whatsapp_messages: [
      { business_id: MAYURA, body: `${SECRET} hello`, direction: 'outbound', delivery_status: 'failed', timestamp: new Date().toISOString() },
      { business_id: MAYURA, body: `${SECRET} hi`, direction: 'outbound', delivery_status: 'read', timestamp: new Date().toISOString() },
    ],
    campaign_recipients: [{ business_id: MAYURA, phone: CUSTOMER_PHONE, name: SECRET, status: 'failed', error: SECRET }],
    business_whatsapp: [
      {
        business_id: MAYURA, phone_number: '919000000200', phone_number_id: '222222222222222', waba_id: '9222', token_last4: '9876',
        access_token_enc: secrets.encrypt('EAAG-mayura-token-9876'), app_secret_enc: secrets.encrypt(MAYURA_APP_SECRET),
        verify_token_enc: secrets.encrypt('verify-me-secret'), webhook_key: WEBHOOK_KEY, graph_api_version: 'v26.0',
      },
      // A token the server can no longer read (encryption secret changed).
      { business_id: AROGYA, phone_number: '919000000100', phone_number_id: '111111111111111', token_last4: '1111', access_token_enc: 'not-decryptable', app_secret_enc: secrets.encrypt(MAYURA_APP_SECRET), webhook_key: 'a'.repeat(32) },
    ],
    business_ad_accounts: [{ business_id: AROGYA, ad_account_id: 'act_123456', access_token_enc: 'x', last_sync_at: old, last_sync_error: 'Meta says: token EAAGsecrettoken12345 expired' }],
    ai_provider: [{ business_id: AROGYA, provider: 'anthropic', model: 'claude-sonnet-5-5', key_last4: 'abcd', api_key_enc: secrets.encrypt('sk-ant-secret-key-1234567890') }],
    usage_counters: [], audit_log: [
      { id: 1, business_id: MAYURA, actor_email: 'platform@crm.test', actor_role: 'platform_admin', action: 'business.created', details: { name: 'Mayura Hospitals' }, created_at: old },
      { id: 2, business_id: AROGYA, actor_email: 'owner@arogya.test', actor_role: 'owner', action: 'ads.connected', details: {}, created_at: old },
    ],
    system_events: [], worker_runs: [], business_health: [], automations: [], whatsapp_bot_rules: [],
    lead_notes: [{ business_id: MAYURA, body: SECRET }], contact_events: [],
  };
  calls = [];
  graphReply = () => ({ messages: [{ id: 'wamid.1' }] });
  whatsapp.clearCache();
  events._reset();
  monitor._resetChecks();
}

const json = (d, status = 200, headers = {}) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json', ...headers } });

// Rows matching every `key=eq.value` filter in the URL.
function matcher(u) {
  const q = new URL(u).searchParams;
  const eqs = [...q.entries()].filter(([, v]) => v.startsWith('eq.')).map(([k, v]) => [k, v.slice(3)]);
  const isNull = [...q.entries()].filter(([, v]) => v === 'is.null').map(([k]) => k);
  const isTrue = [...q.entries()].filter(([, v]) => v === 'is.true').map(([k]) => k);
  const isFalse = [...q.entries()].filter(([, v]) => v === 'is.false').map(([k]) => k);
  return (r) => eqs.every(([k, v]) => String(r[k]) === v) && isNull.every(k => r[k] == null)
    && isTrue.every(k => r[k] === true) && isFalse.every(k => r[k] === false);
}

let nextId = 100;
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  if (u.startsWith('https://graph.facebook.com/')) return json(graphReply(u));
  if (!u.startsWith('http://fake.supabase/rest/v1/')) return json({}, 503);
  const path = u.slice('http://fake.supabase/rest/v1/'.length);
  const table = path.split('?')[0];
  const body = opts.body ? JSON.parse(opts.body) : null;
  calls.push({ table, method, url: u });
  if (table.startsWith('rpc/')) return json([]);
  const rows = db[table] || (db[table] = []);
  const match = matcher(u);
  if (method === 'GET') {
    const hit = rows.filter(match);
    if (/[?&]limit=0(&|$)/.test(u)) return json([], 200, { 'Content-Range': `*/${hit.length}` });
    return json(hit);
  }
  if (method === 'POST') {
    const list = (Array.isArray(body) ? body : [body]).map(r => ({ id: nextId++, created_at: new Date().toISOString(), ...r }));
    for (const r of list) {
      if (table === 'business_health') {
        const ex = rows.find(x => x.business_id === r.business_id);
        if (ex) { Object.assign(ex, r); continue; }
      }
      rows.push(r);
    }
    return json(list, 201);
  }
  if (method === 'PATCH') { const hit = rows.filter(match); hit.forEach(r => Object.assign(r, body)); return json(hit); }
  if (method === 'DELETE') { const hit = rows.filter(match); db[table] = rows.filter(r => !hit.includes(r)); return json(hit); }
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
beforeEach(seed);

function request(method, path, token, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}), ...extraHeaders },
    }, (res) => { let t = ''; res.on('data', c => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, text: t })); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const admin = { id: 'p1', email: 'platform@crm.test' };
platform._setPlatformAdminForToken('platform', admin);
platform._setPlatformAdminForToken('staff-token', null);
_setStaffForToken('staff-token', { id: 'u1', email: 'owner@arogya.test', role: 'owner', businessId: AROGYA, businessName: 'Arogya Ruchulu' });

const ROUTES = [
  ['GET', '/api/platform/health'],
  ['GET', '/api/platform/events'],
  ['GET', '/api/platform/worker-runs'],
  ['GET', '/api/platform/delivery'],
  ['GET', '/api/platform/audit'],
  ['GET', `/api/platform/businesses/${MAYURA}`],
  ['POST', `/api/platform/businesses/${MAYURA}/check-whatsapp`],
];

const assertNoPrivateData = (text, where) => {
  assert.ok(!text.includes(SECRET), `customer data leaked in ${where}`);
  assert.ok(!text.includes(CUSTOMER_PHONE), `customer phone leaked in ${where}`);
  assert.ok(!/EAAG|sk-ant|access_token_enc|api_key_enc|app_secret_enc|verify-me-secret/.test(text), `secret leaked in ${where}`);
};
const contentReads = () => calls.filter(c => CONTENT_TABLES.includes(c.table) && (c.method !== 'GET' || !/[?&]limit=0(&|$)/.test(c.url)));

// ---- who can use the monitoring routes ---------------------------------------------------------
test('monitoring routes: platform admins only (no login 401, business staff 403)', async () => {
  for (const [method, path] of ROUTES) {
    monitor._resetChecks();
    assert.strictEqual((await request(method, path)).status, 401, `${method} ${path} without login`);
    assert.strictEqual((await request(method, path, 'staff-token')).status, 403, `${method} ${path} as business staff`);
    const ok = await request(method, path, 'platform');
    assert.strictEqual(ok.status, 200, `${method} ${path} as platform admin: ${ok.text}`);
  }
  // A denied attempt is logged (no email kept).
  const denied = db.system_events.find(e => e.code === 'platform_denied');
  assert.ok(denied);
  assert.ok(!JSON.stringify(denied).includes('owner@arogya.test'));
});

test('health, delivery and business detail return counts and statuses, never chats, phones or secrets', async () => {
  for (const path of ['/api/platform/health', '/api/platform/delivery?days=7', `/api/platform/businesses/${MAYURA}`, `/api/platform/businesses/${AROGYA}`]) {
    const r = await request('GET', path, 'platform');
    assert.strictEqual(r.status, 200, r.text);
    assertNoPrivateData(r.text, path);
  }
  assert.deepStrictEqual(contentReads(), [], 'chat tables must only be counted, never read');

  const d = JSON.parse((await request('GET', '/api/platform/delivery?days=7', 'platform')).text);
  const m = d.businesses.find(b => b.id === MAYURA);
  assert.strictEqual(m.outbound, 2);
  assert.strictEqual(m.failedMessages, 1);
  assert.strictEqual(m.failureRate, 50);
  assert.strictEqual(m.optedOutTotal, 1);

  const detail = JSON.parse((await request('GET', `/api/platform/businesses/${MAYURA}`, 'platform')).text);
  assert.strictEqual(detail.whatsapp.connected, true);
  assert.strictEqual(detail.whatsapp.tokenReadable, true);
  assert.strictEqual(detail.whatsapp.verifyToken, undefined);
  assert.deepStrictEqual(detail.staff, { owner: 1, manager: 0, agent: 1 });
});

test('alerts: stopped worker, unreadable token, overdue payment, limits, ads error, signature failures', async () => {
  for (let i = 0; i < 6; i++) db.system_events.push({ business_id: MAYURA, level: 'warn', source: 'webhook', code: 'signature_invalid', count: 1, created_at: new Date().toISOString() });
  const r = JSON.parse((await request('GET', '/api/platform/health', 'platform')).text);
  const codes = (biz) => r.alerts.filter(a => a.businessId === biz).map(a => a.code);
  assert.ok(r.alerts.some(a => a.code === 'worker_stale' && a.level === 'critical'), 'no worker runs = critical');
  assert.ok(codes(AROGYA).includes('wa_token_unreadable'));
  assert.ok(codes(AROGYA).includes('ads_sync_error'));
  assert.ok(codes(MAYURA).includes('payment_overdue'));
  assert.ok(codes(MAYURA).includes('over_limits'), 'Starter allows 1 staff / 1 contact; Mayura has 2 of each');
  assert.ok(codes(MAYURA).includes('signature_failures'));
  assert.strictEqual(r.alerts[0].level, 'critical', 'critical alerts come first');
  assertNoPrivateData(JSON.stringify(r), 'alerts');

  // A recent worker run clears the stale alert.
  db.worker_runs.push({ id: 1, started_at: new Date().toISOString(), duration_ms: 1200, ok: true, error_count: 0, steps: {}, errors: [] });
  const r2 = JSON.parse((await request('GET', '/api/platform/health', 'platform')).text);
  assert.ok(!r2.alerts.some(a => a.code === 'worker_stale'));
  assert.strictEqual(r2.health.worker.runsLastHour, 1);
});

// ---- event log -------------------------------------------------------------------------------
test('scrub removes phone numbers, emails and tokens', () => {
  const s = events.scrub('Failed for +91 90000 00001 and 919000000001 (ravi@mail.com) Bearer abc.def token=xyz EAAGabcdefghijklmnop sk-ant-api03-abcdefghijk');
  assert.ok(!/9000|ravi@|abc\.def|xyz|EAAG|sk-ant/.test(s), s);
  assert.match(s, /\[number\].*\[email\].*Bearer \[token\]/);
});

test('events are validated, throttled per minute, and filterable', async () => {
  assert.strictEqual(await events.logEvent({ level: 'error', source: 'nope', message: 'x' }), false);
  assert.strictEqual(await events.logEvent({ level: 'error', source: 'ai', businessId: MAYURA, code: 'timeout', message: 'timeout' }), true);
  assert.strictEqual(await events.logEvent({ level: 'error', source: 'ai', businessId: MAYURA, code: 'timeout', message: 'timeout' }), false, 'same event within a minute is throttled');
  await events.logEvent({ level: 'warn', source: 'ads', businessId: AROGYA, code: 'sync_failed', message: 'x' });
  assert.strictEqual(db.system_events.length, 2);

  const r = JSON.parse((await request('GET', `/api/platform/events?source=ai&businessId=${MAYURA}`, 'platform')).text);
  assert.strictEqual(r.events.length, 1);
  assert.strictEqual(r.events[0].code, 'timeout');
  for (const bad of ['level=panic', 'source=chat', 'businessId=xyz', 'from=yesterday', 'beforeId=-1']) {
    assert.strictEqual((await request('GET', `/api/platform/events?${bad}`, 'platform')).status, 400, bad);
  }
});

test('webhook: a bad signature is logged per business; a signed call records "last received"; no message text stored', async () => {
  const payload = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { metadata: { phone_number_id: '222222222222222' }, statuses: [] } }] }] });
  const bad = await request('POST', `/webhook/${WEBHOOK_KEY}`, null, payload, { 'X-Hub-Signature-256': 'sha256=' + '0'.repeat(64) });
  assert.strictEqual(bad.status, 401);
  const ev = db.system_events.find(e => e.code === 'signature_invalid');
  assert.strictEqual(ev.business_id, MAYURA);
  assert.ok(db.business_health.find(h => h.business_id === MAYURA).last_signature_fail_at);

  const sig = 'sha256=' + crypto.createHmac('sha256', MAYURA_APP_SECRET).update(payload).digest('hex');
  const good = await request('POST', `/webhook/${WEBHOOK_KEY}`, null, payload, { 'X-Hub-Signature-256': sig });
  assert.strictEqual(good.status, 200);
  assert.ok(db.business_health.find(h => h.business_id === MAYURA).last_webhook_at);
});

test('Meta send failures are logged with the code; a rejected token is critical; no phone number kept', async () => {
  graphReply = () => ({ error: { code: 190, message: `Error validating access token for ${CUSTOMER_PHONE}: session expired`, error_subcode: 463 } });
  const wa = await whatsapp.getWhatsApp(MAYURA);
  await meta.sendTextMessage(wa, CUSTOMER_PHONE, `${SECRET} hello`);
  const e = db.system_events.find(x => x.source === 'meta');
  assert.strictEqual(e.level, 'critical');
  assert.strictEqual(e.code, 'token_invalid');
  assert.strictEqual(e.business_id, MAYURA);
  assert.ok(!JSON.stringify(e).includes(CUSTOMER_PHONE) && !JSON.stringify(e).includes(SECRET));

  const r = JSON.parse((await request('GET', '/api/platform/health', 'platform')).text);
  assert.ok(r.alerts.some(a => a.code === 'wa_token_invalid' && a.businessId === MAYURA));
});

test('check WhatsApp saves quality and tier, once a minute per business', async () => {
  graphReply = () => ({ display_phone_number: '+91 90000 00200', quality_rating: 'YELLOW', messaging_limit_tier: 'TIER_1K' });
  const r = await monitor.checkWhatsApp(admin, MAYURA);
  assert.deepStrictEqual(r, { ok: true, qualityRating: 'YELLOW', messagingTier: 'TIER_1K' });
  const h = db.business_health.find(x => x.business_id === MAYURA);
  assert.strictEqual(h.wa_quality_rating, 'YELLOW');
  assert.strictEqual((await monitor.checkWhatsApp(admin, MAYURA)).status, 429);
  assert.match((await monitor.checkWhatsApp(admin, 'not-an-id')).error, /Invalid/);
});

// ---- worker runs -------------------------------------------------------------------------------
test('each worker run is recorded with steps, counts and duration; a failing step is logged', async () => {
  const { runWorker, summarize } = require('../netlify/functions/broadcast-worker.cjs');
  assert.deepStrictEqual(summarize({ sent: 3, phone: '9190', list: [1], ok: true }), { sent: 3, ok: true });
  await runWorker({ hourly: true });
  assert.strictEqual(db.worker_runs.length, 1);
  const run = db.worker_runs[0];
  assert.ok(Number.isInteger(run.duration_ms));
  for (const s of ['billing', 'queriesAutoClose', 'prune', 'followUps', 'inactiveScan', 'campaigns']) assert.ok(s in run.steps, `step ${s} recorded`);
  assert.strictEqual(run.ok, run.error_count === 0);

  // A step that throws is recorded and logged; the other steps still run.
  db.worker_runs = [];
  const r = await runWorker({ hourly: false, tasks: {
    processDueRuns: async () => { throw new Error(`db down for ${CUSTOMER_PHONE}`); },
    processBatches: async () => ({ claimed: 2, sent: 2 }),
  } });
  const failed = db.worker_runs[0];
  assert.strictEqual(failed.ok, false);
  assert.strictEqual(failed.error_count, 1);
  assert.strictEqual(failed.errors[0].step, 'followUps');
  assert.ok(!JSON.stringify(failed.errors).includes(CUSTOMER_PHONE), 'phone numbers are scrubbed from errors');
  assert.deepStrictEqual(failed.steps.campaigns.result, { claimed: 2, sent: 2 });
  assert.ok(!('billing' in failed.steps), 'hourly steps only run in the first run of the hour');
  assert.strictEqual(r.errors.length, 1);
  const ev = db.system_events.find(e => e.source === 'worker');
  assert.strictEqual(ev.code, 'followUps_failed');
  assert.ok(!ev.message.includes(CUSTOMER_PHONE));
  const list = JSON.parse((await request('GET', '/api/platform/worker-runs?limit=10', 'platform')).text);
  assert.strictEqual(list.runs.length, 1);
});

// ---- audit log and overrides -----------------------------------------------------------------
test('audit log filters by business, actor and action', async () => {
  const all = JSON.parse((await request('GET', '/api/platform/audit', 'platform')).text);
  assert.strictEqual(all.entries.length, 2);
  const one = JSON.parse((await request('GET', `/api/platform/audit?businessId=${AROGYA}`, 'platform')).text);
  assert.deepStrictEqual(one.entries.map(e => e.action), ['ads.connected']);
  const call = calls.filter(c => c.table === 'audit_log').pop();
  assert.ok(call.url.includes(`business_id=eq.${AROGYA}`));
  await request('GET', '/api/platform/audit?actor=owner@arogya&action=ads.', 'platform');
  const call2 = calls.filter(c => c.table === 'audit_log').pop();
  assert.match(call2.url, /actor_email=ilike\.\*owner%40arogya\*/);
  assert.match(call2.url, /action=like\.ads\.\*/);
  assert.strictEqual((await request('GET', '/api/platform/audit?role=god', 'platform')).status, 400);
});

test('per-business limit overrides are validated and audited', async () => {
  assert.match((await platform.updateBusiness(admin, MAYURA, { limitOverrides: { max_staff: -1 } })).error, /whole number/);
  assert.match((await platform.updateBusiness(admin, MAYURA, { limitOverrides: { delete_everything: 1 } })).error, /Unknown limit/);
  assert.match((await platform.updateBusiness(admin, MAYURA, { limitOverrides: [1] })).error, /object/);
  assert.ifError((await platform.updateBusiness(admin, MAYURA, { limitOverrides: { max_staff: 5, max_contacts: null, ai_enabled: true } })).error);
  assert.deepStrictEqual(db.businesses.find(b => b.id === MAYURA).limit_overrides, { max_staff: 5, max_contacts: null, ai_enabled: true });
  assert.ok(db.audit_log.some(a => a.action === 'business.updated' && a.details.limit_overrides));
  // Staff cannot change it through the platform API.
  assert.strictEqual((await request('PATCH', `/api/platform/businesses/${MAYURA}`, 'staff-token', { limitOverrides: {} })).status, 403);
});

// ---- database rules (real migration on PGlite) -----------------------------------------------
test('migration: monitoring tables are server-only (no staff or platform-admin browser access) and safe to re-run', async () => {
  const pg = await freshDb();
  await pg.exec(migrationSql('20261115_admin_console.sql'));  // re-run is safe
  const staff = await pg.query("insert into auth.users (email) values ('owner@arogya.test') returning id");
  await pg.query("insert into public.staff_members (user_id, email, role, business_id) values ($1, 'owner@arogya.test', 'owner', $2)", [staff.rows[0].id, AROGYA]);
  const pa = await pg.query("insert into auth.users (email) values ('platform@crm.test') returning id");
  await pg.query("insert into public.platform_admins (user_id, email) values ($1, 'platform@crm.test')", [pa.rows[0].id]);

  await pg.query("insert into public.system_events (level, source, business_id, code, message) values ('error', 'meta', $1, 'send_131026', 'x')", [AROGYA]);
  await pg.query("insert into public.worker_runs (started_at, duration_ms) values (now(), 10)");
  await pg.query("insert into public.business_health (business_id, last_webhook_at) values ($1, now())", [AROGYA]);
  for (const t of ['system_events', 'worker_runs', 'business_health']) {
    for (const [who, id] of [['staff', staff.rows[0].id], ['platform admin', pa.rows[0].id]]) {
      await assert.rejects(asUser(pg, id, () => pg.query(`select * from public.${t}`)), /permission denied/, `${who} must not read ${t} from the browser`);
      await assert.rejects(asUser(pg, id, () => pg.query(`delete from public.${t}`)), /permission denied/, `${who} must not delete ${t}`);
    }
  }
  await assert.rejects(pg.query("insert into public.system_events (level, source, message) values ('loud', 'meta', 'x')"));
  await assert.rejects(pg.query("insert into public.system_events (level, source, message) values ('error', 'chat', 'x')"));
  await assert.rejects(pg.query('insert into public.system_events (level, source, message) values ($1, $2, $3)', ['error', 'meta', 'x'.repeat(501)]));
});
