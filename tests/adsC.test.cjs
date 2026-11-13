// Ads phase C: pause/resume ads, change daily budgets, cost alerts.
// Fake database + fake Meta Graph API (no network); the migration is checked on PGlite.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const A = 'a0000000-0000-4000-8000-000000000001'; // Arogya (Pro)
const C = 'c0000000-0000-4000-8000-000000000003'; // Starter: no Ads

process.env.APP_SECRET = 'server_encryption_secret_long_enough';
process.env.SETTINGS_ENCRYPTION_KEY = '';
process.env.VITE_SUPABASE_URL = 'http://fake.supabase';
process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
process.env.WHATSAPP_BUSINESS_ID = A;

const secrets = require('../server/secrets.cjs');
const app = require('../server/app.cjs');
const { _setStaffForToken } = require('../server/auth.cjs');
const limits = require('../server/limits.cjs');
const ads = require('../server/ads.cjs');
const { freshDb, migrationSql } = require('./helpers/pgHarness.cjs');

const ACT = 'act_1111111111';
const MANAGE = 'EAAG-token-with-ads-management-1234';
const READ_ONLY = 'EAAG-token-read-only-000000000000';
const IST = 330 * 60000;
const today = new Date(Date.now() + IST).toISOString().slice(0, 10);
const recent = new Date(Date.now() - 3600000).toISOString();

// ---- fake Meta ------------------------------------------------------------------------------
const meta = {};
function seedMeta() {
  Object.assign(meta, {
    901: { account_id: '1111111111', name: 'Snack Box', status: 'ACTIVE', effective_status: 'ACTIVE' },
    902: { account_id: '1111111111', name: 'Ragi', status: 'DELETED', effective_status: 'DELETED' },
    777: { account_id: '2222222222', name: 'Someone else\'s ad', status: 'ACTIVE' },
    801: { account_id: '1111111111', name: 'Hyderabad 25-45', daily_budget: '50000', campaign_id: '701' },
    802: { account_id: '1111111111', name: 'CBO ad set', campaign_id: '701' },
    803: { account_id: '1111111111', name: 'Lifetime ad set', lifetime_budget: '900000', campaign_id: '701' },
    701: { account_id: '1111111111', name: 'Launch', daily_budget: '100000' },
  });
}

// ---- fake database ----------------------------------------------------------------------------
let db;
let graphCalls;
function seed(token = MANAGE) {
  seedMeta();
  db = {
    plans: [{ id: 'starter', name: 'Starter', ads_enabled: false }, { id: 'pro', name: 'Pro', ads_enabled: true }],
    businesses: [
      { id: A, name: 'Arogya Ruchulu', status: 'active', plan_id: 'pro', limit_overrides: {} },
      { id: C, name: 'Small Shop', status: 'active', plan_id: 'starter', limit_overrides: {} },
    ],
    business_ad_accounts: [{ business_id: A, ad_account_id: ACT, name: 'Arogya Ads', currency: 'INR', access_token_enc: secrets.encrypt(token), token_last4: '1234', last_sync_at: recent, alert_window_days: 3 }],
    ad_insights_daily: [
      { business_id: A, ad_account_id: ACT, date: today, ad_id: '901', ad_name: 'Snack Box', adset_id: '801', campaign_id: '701', campaign_name: 'Launch', effective_status: 'ACTIVE', spend: 500, impressions: 5000, clicks: 100, conversations: 8 },
      { business_id: A, ad_account_id: ACT, date: today, ad_id: '903', ad_name: 'Paused one', adset_id: '801', campaign_id: '701', campaign_name: 'Launch', effective_status: 'PAUSED', spend: 900, impressions: 5000, clicks: 100, conversations: 0 },
    ],
    whatsapp_leads: [
      { business_id: A, phone: '1', stage: 'ordered', first_ad_id: '901', first_ad_at: recent, last_ad_id: '901', last_ad_at: recent },
      { business_id: A, phone: '2', stage: 'new', first_ad_id: '901', first_ad_at: recent, last_ad_id: '901', last_ad_at: recent },
    ],
    audit_log: [],
  };
  graphCalls = [];
  limits.clearCache();
}

const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
const param = (u, k, op = 'eq') => { const m = u.match(new RegExp(`[?&]${k}=${op}\\.([^&]+)`)); return m ? decodeURIComponent(m[1]) : null; };

function graphReply(path, method, token, form) {
  if (![MANAGE, READ_ONLY].includes(token)) return json({ error: { message: 'Invalid OAuth access token', code: 190 } }, 400);
  const [id, query = ''] = path.split('?');
  const obj = meta[id];
  if (!obj) return json({ error: { message: 'Unsupported get request', code: 100 } }, 400);
  if (method === 'GET') {
    const fields = (new URLSearchParams(query).get('fields') || '').split(',');
    return json(Object.fromEntries(fields.filter(f => f in obj).map(f => [f, obj[f]])));
  }
  if (token === READ_ONLY) return json({ error: { message: '(#200) Requires ads_management permission to manage the object', code: 200 } }, 400);
  Object.assign(obj, Object.fromEntries(form.entries()));
  return json({ success: true });
}

global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  if (u.startsWith('https://graph.facebook.com/')) {
    const path = u.replace(/^https:\/\/graph\.facebook\.com\/[^/]+\//, '');
    const token = String(opts.headers?.Authorization || '').replace('Bearer ', '');
    const form = new URLSearchParams(opts.body || '');
    graphCalls.push({ path, method, token, form: Object.fromEntries(form.entries()) });
    return graphReply(path, method, token, form);
  }
  if (!u.startsWith('http://fake.supabase/rest/v1/')) return json({}, 503);
  const path = u.slice('http://fake.supabase/rest/v1/'.length);
  const table = path.split('?')[0];
  const body = opts.body ? JSON.parse(opts.body) : null;
  if (table.startsWith('rpc/')) return json([]);
  const rows = (db[table] ||= []);
  const match = (r) =>
    (!param(u, 'business_id') || r.business_id === param(u, 'business_id')) &&
    (!param(u, 'id') || r.id === param(u, 'id')) &&
    (!param(u, 'ad_id') || r.ad_id === param(u, 'ad_id')) &&
    (!param(u, 'ad_account_id') || r.ad_account_id === param(u, 'ad_account_id')) &&
    (!param(u, 'date', 'gte') || r.date >= param(u, 'date', 'gte'));
  if (method === 'GET') return json(rows.filter(match));
  if (method === 'POST') { (Array.isArray(body) ? body : [body]).forEach(r => rows.push({ ...r })); return json([], 201); }
  if (method === 'PATCH') { const hit = rows.filter(match); hit.forEach(r => Object.assign(r, body)); return json(hit); }
  return json([]);
};

// ---- server -----------------------------------------------------------------------------------
let server;
let base;
before(async () => {
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
beforeEach(() => seed());

function request(method, path, { body, token } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
    }, (res) => { let t = ''; res.on('data', c => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, text: t, json: () => JSON.parse(t) })); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const staff = (id, biz, role) => ({ id: `e0000000-0000-4000-8000-0000000000${id}`, email: `${role}@${biz.slice(0, 1)}.test`, role, businessId: biz, businessName: 'x' });
_setStaffForToken('a-owner', staff('a1', A, 'owner'));
_setStaffForToken('a-manager', staff('a2', A, 'manager'));
_setStaffForToken('a-agent', staff('a3', A, 'agent'));
_setStaffForToken('c-owner', staff('c1', C, 'owner'));
const posts = () => graphCalls.filter(c => c.method === 'POST');

// ---- pure helpers ---------------------------------------------------------------------------------
test('budgets use the currency\'s smallest unit', () => {
  assert.strictEqual(ads.minorFactor('INR'), 100);
  assert.strictEqual(ads.minorFactor('JPY'), 1);
});

test('evaluateAlerts flags running ads over the limits, including spend with no results yet', () => {
  const rows = [
    { adId: '1', spend: 500, chats: 2, converted: 1, status: 'ACTIVE' },   // 250/chat, 500/conversion
    { adId: '2', spend: 300, chats: 0, converted: 0, status: 'ACTIVE' },   // no chats yet: whole spend counts
    { adId: '3', spend: 900, chats: 0, converted: 0, status: 'PAUSED' },   // paused: ignored
    { adId: '4', spend: 50, chats: 1, converted: 1, status: 'ACTIVE' },    // fine
  ];
  const r = ads.evaluateAlerts(rows, { maxCostPerChat: 100, maxCostPerConversion: 400 });
  assert.deepStrictEqual(r.map(x => [x.adId, x.kind, x.cost]), [['1', 'chat', 250], ['1', 'conversion', 500], ['2', 'chat', 300]]); // ad 2: ₹300 < ₹400 per conversion
  assert.deepStrictEqual(ads.evaluateAlerts(rows, {}), []);
});

// ---- who may do what ---------------------------------------------------------------------------------
test('agents and businesses without Ads in their plan cannot use the controls', async () => {
  for (const [method, path, body] of [
    ['POST', '/api/ads/ads/901/status', { status: 'PAUSED' }],
    ['GET', '/api/ads/adsets/801/budget'],
    ['PUT', '/api/ads/adsets/801/budget', { dailyBudget: 600 }],
    ['PUT', '/api/ads/alerts', { maxCostPerChat: 100 }],
  ]) {
    assert.strictEqual((await request(method, path, { token: 'a-agent', body })).status, 403, `${method} ${path} agent`);
    assert.strictEqual((await request(method, path, { token: 'c-owner', body })).status, 403, `${method} ${path} starter`);
  }
  assert.strictEqual(graphCalls.length, 0);
});

// ---- pause / resume --------------------------------------------------------------------------------------
test('a manager pauses and resumes an ad; each change is audited', async () => {
  const p = await request('POST', '/api/ads/ads/901/status', { token: 'a-manager', body: { status: 'PAUSED' } });
  assert.strictEqual(p.status, 200, p.text);
  assert.deepStrictEqual(posts().map(c => [c.path, c.form.status]), [['901', 'PAUSED']]);
  assert.strictEqual(db.ad_insights_daily.find(r => r.ad_id === '901').effective_status, 'PAUSED');
  assert.deepStrictEqual(db.audit_log.map(a => [a.action, a.details.before, a.details.after, a.actor_role]), [['ads.ad_paused', 'ACTIVE', 'PAUSED', 'manager']]);

  const r = await request('POST', '/api/ads/ads/901/status', { token: 'a-manager', body: { status: 'ACTIVE' } });
  assert.strictEqual(r.status, 200, r.text);
  assert.strictEqual(meta[901].status, 'ACTIVE');
  assert.strictEqual(db.audit_log[1].action, 'ads.ad_resumed');
});

test('an ad from another ad account cannot be touched', async () => {
  const r = await request('POST', '/api/ads/ads/777/status', { token: 'a-owner', body: { status: 'PAUSED' } });
  assert.strictEqual(r.status, 400);
  assert.match(r.json().error, /not in your connected ad account/);
  assert.strictEqual(posts().length, 0);
  assert.strictEqual(meta[777].status, 'ACTIVE');
});

test('odd ad ids, bad statuses and deleted ads are refused before anything changes', async () => {
  // Refused by the route's id check (server/validate.cjs) before ads.cjs or Meta is reached.
  assert.match((await request('POST', '/api/ads/ads/me/status', { token: 'a-owner', body: { status: 'PAUSED' } })).json().error, /adId: is not a valid id/);
  assert.match((await request('POST', '/api/ads/ads/901/status', { token: 'a-owner', body: { status: 'DELETED' } })).json().error, /PAUSED or ACTIVE/);
  assert.match((await request('POST', '/api/ads/ads/902/status', { token: 'a-owner', body: { status: 'ACTIVE' } })).json().error, /Ads Manager/);
  assert.strictEqual(posts().length, 0);
  assert.strictEqual(graphCalls.filter(c => c.path.startsWith('me')).length, 0);
});

test('a read-only token gets a clear "needs ads_management" message', async () => {
  seed(READ_ONLY);
  const r = await request('POST', '/api/ads/ads/901/status', { token: 'a-owner', body: { status: 'PAUSED' } });
  assert.strictEqual(r.status, 400);
  assert.match(r.json().error, /ads_management/);
  assert.strictEqual(db.audit_log.length, 0);
  assert.strictEqual(db.ad_insights_daily.find(x => x.ad_id === '901').effective_status, 'ACTIVE');
});

// ---- budgets ----------------------------------------------------------------------------------------------
test('ad set budget: read in rupees, changed in paise, audited', async () => {
  const g = (await request('GET', '/api/ads/adsets/801/budget', { token: 'a-manager' })).json();
  assert.deepStrictEqual([g.level, g.dailyBudget, g.currency, g.maxAllowed], ['adset', 500, 'INR', 2500]);
  const s = await request('PUT', '/api/ads/adsets/801/budget', { token: 'a-manager', body: { dailyBudget: 800 } });
  assert.strictEqual(s.status, 200, s.text);
  assert.deepStrictEqual(posts().map(c => [c.path, c.form.daily_budget]), [['801', '80000']]);
  const a = db.audit_log[0];
  assert.deepStrictEqual([a.action, a.details.before, a.details.after, a.details.level], ['ads.budget_changed', 500, 800, 'adset']);
});

test('campaign budgets are changed on the campaign; lifetime budgets are left to Ads Manager', async () => {
  const g = (await request('GET', '/api/ads/adsets/802/budget', { token: 'a-owner' })).json();
  assert.deepStrictEqual([g.level, g.id, g.dailyBudget], ['campaign', '701', 1000]);
  assert.strictEqual((await request('PUT', '/api/ads/adsets/802/budget', { token: 'a-owner', body: { dailyBudget: 1200 } })).status, 200);
  assert.deepStrictEqual(posts().map(c => [c.path, c.form.daily_budget]), [['701', '120000']]);
  const l = await request('PUT', '/api/ads/adsets/803/budget', { token: 'a-owner', body: { dailyBudget: 100 } });
  assert.match(l.json().error, /one budget for its whole run.*Meta Ads Manager/);
  assert.strictEqual(posts().length, 1);
});

test('a budget jump over 5x (a likely typo) or zero is refused', async () => {
  assert.match((await request('PUT', '/api/ads/adsets/801/budget', { token: 'a-owner', body: { dailyBudget: 5000 } })).json().error, /5x/);
  assert.match((await request('PUT', '/api/ads/adsets/801/budget', { token: 'a-owner', body: { dailyBudget: 0 } })).json().error, /above zero/);
  assert.match((await request('PUT', '/api/ads/adsets/801/budget', { token: 'a-owner', body: { dailyBudget: 'abc' } })).json().error, /above zero/);
  assert.strictEqual(posts().length, 0);
});

// ---- alerts -------------------------------------------------------------------------------------------
test('alert limits are validated, saved, and flag costly running ads on the Ads page', async () => {
  assert.match((await request('PUT', '/api/ads/alerts', { token: 'a-manager', body: { maxCostPerChat: -5 } })).json().error, /above zero/);
  assert.match((await request('PUT', '/api/ads/alerts', { token: 'a-manager', body: { windowDays: 30 } })).json().error, /1 to 14/);
  const s = await request('PUT', '/api/ads/alerts', { token: 'a-manager', body: { maxCostPerChat: 100, maxCostPerConversion: '', windowDays: 7 } });
  assert.strictEqual(s.status, 200, s.text);
  const row = db.business_ad_accounts[0];
  assert.deepStrictEqual([row.alert_max_cost_per_chat, row.alert_max_cost_per_conversion, row.alert_window_days], [100, null, 7]);
  assert.ok(db.audit_log.some(a => a.action === 'ads.alerts_changed'));

  const page = (await request('GET', '/api/ads?days=30', { token: 'a-manager' })).json();
  // autoPause (phase F) is off unless switched on.
  assert.deepStrictEqual(page.account.alerts, { maxCostPerChat: 100, maxCostPerConversion: null, windowDays: 7, autoPause: false });
  // Snack Box: ₹500 for 2 chats = ₹250 per chat > ₹100. The paused ad is not flagged.
  assert.deepStrictEqual(page.report.alerts.map(a => [a.adId, a.kind, a.cost]), [['901', 'chat', 250]]);
  assert.strictEqual(page.report.ads.find(a => a.adId === '901').adsetId, '801');
});

test('no alerts when no limits are set', async () => {
  const page = (await request('GET', '/api/ads', { token: 'a-owner' })).json();
  assert.deepStrictEqual(page.report.alerts, []);
});

// ---- migration ----------------------------------------------------------------------------------------------
test('migration: alert columns with sane limits; safe to re-run', async () => {
  const pg = await freshDb();
  await pg.exec(migrationSql('20261114_ads_c_controls.sql'));
  await pg.query("insert into public.business_ad_accounts (business_id, ad_account_id, access_token_enc) values ($1, $2, 'enc')", [A, ACT]);
  const row = (await pg.query('select alert_window_days, alert_max_cost_per_chat from public.business_ad_accounts')).rows[0];
  assert.deepStrictEqual([row.alert_window_days, row.alert_max_cost_per_chat], [3, null]);
  await assert.rejects(pg.query('update public.business_ad_accounts set alert_window_days = 30'));
  await assert.rejects(pg.query('update public.business_ad_accounts set alert_max_cost_per_chat = 0'));
});
