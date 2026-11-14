// Ads phase D1: the "ready to create ads" check (permissions, Page, Page linked to the WhatsApp number,
// account, Meta's minimum budget), choosing the Page and the daily budget cap. Read-only towards Meta.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-000000000002';
process.env.APP_SECRET = 'server_encryption_secret_long_enough';
process.env.SETTINGS_ENCRYPTION_KEY = '';
process.env.VITE_SUPABASE_URL = 'http://fake.supabase';
process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
process.env.WHATSAPP_BUSINESS_ID = 'c0000000-0000-4000-8000-000000000009';

const secrets = require('../server/secrets.cjs');
const app = require('../server/app.cjs');
const limits = require('../server/limits.cjs');
const whatsapp = require('../server/whatsapp.cjs');
const adCreate = require('../server/adCreate.cjs');
const { _setStaffForToken } = require('../server/auth.cjs');
const { freshDb } = require('./helpers/pgHarness.cjs');

let db, meta, graphCalls;
function seed() {
  db = {
    plans: [{ id: 'pro', name: 'Pro', ads_enabled: true }],
    businesses: [{ id: A, name: 'Mayura', status: 'active', plan_id: 'pro', limit_overrides: {} }],
    business_ad_accounts: [{ business_id: A, ad_account_id: 'act_1111111111', currency: 'INR', access_token_enc: secrets.encrypt('EAAG-ads-token-ready-1234'), graph_api_version: 'v26.0', page_id: null, max_daily_budget: 2000 }],
    business_whatsapp: [{ business_id: A, phone_number: '919701103222', phone_number_id: '222', waba_id: '922', token_last4: '9876', access_token_enc: secrets.encrypt('EAAG-wa-token-9876-long'), webhook_key: 'k'.repeat(32), graph_api_version: 'v26.0' }],
    audit_log: [],
  };
  meta = {
    permissions: ['ads_management', 'ads_read', 'pages_manage_ads', 'pages_read_engagement', 'pages_show_list'],
    pages: [{ id: '55555', name: 'Mayura Hospitals' }],
    pageWhatsApp: { 55555: '+91 97011 03222' },
    account: { account_status: 1, min_daily_budget: 9567, currency: 'INR' },
  };
  graphCalls = [];
  limits.clearCache();
  whatsapp.clearCache();
}

const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  if (u.startsWith('https://graph.facebook.com/')) {
    const path = u.replace(/^https:\/\/graph\.facebook\.com\/[^/]+\//, '');
    graphCalls.push(`${method} ${path}`);
    if (path.startsWith('me/permissions')) return json({ data: meta.permissions.map(permission => ({ permission, status: 'granted' })) });
    if (path.startsWith('act_1111111111?fields=')) return json(meta.account);
    if (path.startsWith('act_1111111111/promote_pages')) return json({ data: meta.pages });
    if (path.startsWith('me/accounts')) return meta.myPages ? json({ data: meta.myPages }) : json({ error: { message: 'unmocked' } }, 400);
    const page = path.match(/^(\d+)\?fields=whatsapp_number/);
    if (page) return json(meta.pageWhatsApp[page[1]] ? { id: page[1], whatsapp_number: meta.pageWhatsApp[page[1]] } : { id: page[1] });
    return json({ error: { message: 'unmocked' } }, 400);
  }
  if (!u.startsWith('http://fake.supabase/rest/v1/')) return json({}, 503);
  const [path, qs = ''] = u.slice('http://fake.supabase/rest/v1/'.length).split('?');
  const p = new URLSearchParams(qs);
  const body = opts.body ? JSON.parse(opts.body) : null;
  let rows = (db[path] ||= []);
  const filt = (r) => [...p.entries()].every(([k, v]) => ['select', 'order', 'limit'].includes(k) || !v.startsWith('eq.') || String(r[k]) === v.slice(3));
  if (method === 'GET') return json(rows.filter(filt));
  if (method === 'POST') { rows.push(body); return json([body], 201); }
  if (method === 'PATCH') { const hit = rows.filter(filt); hit.forEach(r => Object.assign(r, body)); return json(hit); }
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
      (res) => { let t = ''; res.on('data', c => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, text: t, json: () => JSON.parse(t) })); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const who = (n, role, biz = A) => ({ id: `d0000000-0000-4000-8000-00000000000${n}`, email: `${role}${n}@x.test`, role, businessId: biz, businessName: 'x' });
_setStaffForToken('owner', who(1, 'owner'));
_setStaffForToken('manager', who(2, 'manager'));
_setStaffForToken('agent', who(3, 'agent'));
_setStaffForToken('other', who(4, 'owner', B));
const okKeys = (r) => r.checks.filter(c => c.ok === true).map(c => c.key);

test('ready: permissions, one Page (chosen automatically), linked to our number, active account, ₹96 minimum', async () => {
  const r = await request('GET', '/api/ads/create/readiness', 'manager');
  assert.strictEqual(r.status, 200, r.text);
  const d = r.json();
  assert.strictEqual(d.ready, true);
  assert.deepStrictEqual(okKeys(d), ['account', 'permissions', 'page', 'whatsapp', 'budget']);
  assert.deepStrictEqual([d.selectedPageId, d.minDailyBudget, d.maxDailyBudget, d.currency], ['55555', 96, 2000, 'INR']);
  assert.deepStrictEqual([db.business_ad_accounts[0].page_id, db.business_ad_accounts[0].page_name], ['55555', 'Mayura Hospitals'], 'the only Page is remembered');
  assert.ok(graphCalls.every(c => c.startsWith('GET ')), 'read-only towards Meta');
});

test('what today\'s tokens look like: missing Page permissions and no Page -> clear steps to fix', async () => {
  meta.permissions = ['ads_management', 'ads_read', 'business_management'];
  meta.pages = [];
  const d = (await request('GET', '/api/ads/create/readiness', 'owner')).json();
  assert.strictEqual(d.ready, false);
  const perm = d.checks.find(c => c.key === 'permissions');
  assert.match(perm.detail, /missing: pages_manage_ads, pages_read_engagement, pages_show_list/);
  assert.ok(perm.fix.length >= 2 && perm.link.href.includes('system-users'));
  assert.match(d.checks.find(c => c.key === 'page').detail, /no Facebook Page/);
  assert.strictEqual(d.checks.find(c => c.key === 'whatsapp').ok, false);
});

test('Page whose primary number is another one, or none: a warning with the fix, never a block (the number may be linked as an extra one)', () => {
  const base = { permissions: adCreate.NEEDED_PERMISSIONS, accountStatus: 1, minDailyBudget: 96, pages: [{ id: '1', name: 'P' }], selectedPageId: '1', businessNumber: '919701103222', currency: 'INR' };
  const other = adCreate.buildChecklist({ ...base, pageWhatsApp: '+91 89770 30642' }).find(c => c.key === 'whatsapp');
  assert.strictEqual(other.ok, null);
  assert.match(other.detail, /primary WhatsApp number as \+918977030642, which isn't this business's number \(\+919701103222\).*extra number/);
  assert.match(other.fix.join(' '), /Set as Primary/);
  const none = adCreate.buildChecklist({ ...base, pageWhatsApp: null });
  assert.strictEqual(none.find(c => c.key === 'whatsapp').ok, null);
  assert.ok(none.every(c => c.ok !== false), 'the rest being ready, an ad can be created');
  assert.strictEqual(adCreate.buildChecklist({ ...base, pageWhatsApp: undefined }).find(c => c.key === 'whatsapp').ok, null, 'unknown, not failed');
  assert.strictEqual(adCreate.buildChecklist({ ...base, pageWhatsApp: '9701103222' }).find(c => c.key === 'whatsapp').ok, true, 'number without country code still matches');
});

test('system-user token: promote_pages empty but the Page is assigned with ADVERTISE -> Page found and choosable', async () => {
  meta.pages = [];
  meta.myPages = [
    { id: '55555', name: 'Mayura Hospitals', tasks: ['ADVERTISE', 'ANALYZE', 'CREATE_CONTENT', 'MESSAGING', 'MODERATE', 'MANAGE'] },
    { id: '88888', name: 'Read-only Page', tasks: ['ANALYZE'] },
  ];
  const d = (await request('GET', '/api/ads/create/readiness', 'owner')).json();
  assert.deepStrictEqual(d.pages, [{ id: '55555', name: 'Mayura Hospitals' }], 'only Pages it may advertise for');
  assert.strictEqual(d.selectedPageId, '55555');
  assert.strictEqual(d.checks.find(c => c.key === 'page').ok, true);
  assert.strictEqual((await request('PUT', '/api/ads/create/page', 'owner', { pageId: '55555' })).status, 200);
  assert.match((await request('PUT', '/api/ads/create/page', 'owner', { pageId: '88888' })).json().error, /cannot advertise for that Page/);
});

test('choosing the Page: Business Admin only, and only a Page the ad account can promote', async () => {
  meta.pages = [{ id: '55555', name: 'Mayura Hospitals' }, { id: '66666', name: 'Mayura Pharmacy' }];
  const first = (await request('GET', '/api/ads/create/readiness', 'owner')).json();
  assert.strictEqual(first.selectedPageId, null, 'two Pages: the Business Admin chooses');
  assert.strictEqual((await request('PUT', '/api/ads/create/page', 'manager', { pageId: '66666' })).status, 403);
  assert.match((await request('PUT', '/api/ads/create/page', 'owner', { pageId: '77777' })).json().error, /cannot advertise for that Page/);
  const ok = await request('PUT', '/api/ads/create/page', 'owner', { pageId: '66666' });
  assert.strictEqual(ok.status, 200, ok.text);
  assert.deepStrictEqual([db.business_ad_accounts[0].page_id, db.business_ad_accounts[0].page_name], ['66666', 'Mayura Pharmacy']);
  assert.ok(db.audit_log.some(a => a.action === 'ads.page_chosen'));
});

test('budget cap: Business Admin only, sensible amounts', async () => {
  assert.strictEqual((await request('PUT', '/api/ads/create/budget-cap', 'manager', { maxDailyBudget: 500 })).status, 403);
  assert.strictEqual((await request('PUT', '/api/ads/create/budget-cap', 'owner', { maxDailyBudget: 0 })).status, 400);
  assert.strictEqual((await request('PUT', '/api/ads/create/budget-cap', 'owner', { maxDailyBudget: 'lots' })).status, 400);
  const r = await request('PUT', '/api/ads/create/budget-cap', 'owner', { maxDailyBudget: 1500.555 });
  assert.strictEqual(r.status, 200, r.text);
  assert.strictEqual(db.business_ad_accounts[0].max_daily_budget, 1500.56);
  assert.ok(db.audit_log.some(a => a.action === 'ads.budget_cap_set'));
});

test('agents and businesses without an ad account get nothing', async () => {
  assert.strictEqual((await request('GET', '/api/ads/create/readiness', 'agent')).status, 403);
  assert.notStrictEqual((await request('GET', '/api/ads/create/readiness', 'other')).status, 200);
});

test('migration: Page and budget cap columns, safe to re-run', async () => {
  const pg = await freshDb();
  const sql = require('fs').readFileSync(require('path').join(__dirname, '..', 'supabase', 'migrations', '20261120_ads_d1_create_ready.sql'), 'utf8');
  await pg.exec(sql);
  await pg.query("insert into public.business_ad_accounts (business_id, ad_account_id, access_token_enc) values ($1, 'act_1111111111', 'enc')", [A]);
  const row = (await pg.query('select max_daily_budget::float as cap, page_id from public.business_ad_accounts')).rows[0];
  assert.deepStrictEqual(row, { cap: 2000, page_id: null });
  await assert.rejects(pg.query("update public.business_ad_accounts set page_id = 'abc'"));
  await assert.rejects(pg.query('update public.business_ad_accounts set max_daily_budget = 0'));
});
