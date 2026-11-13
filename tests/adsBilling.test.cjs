// Ads billing card (server/adBilling.cjs): what Meta says about the ad account's payments. Read with the hourly
// sync and "Check now" (at most once a minute), shown to managers and the Business Admin (never agents, never another
// business), payment problems on the Ads badge, and the account spending limit set only by the Business Admin
// (checked, audited). The CRM never pays or adds money.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const A = 'a0000000-0000-4000-8000-000000000001';
const B2 = 'b0000000-0000-4000-8000-000000000002'; // another business with its own ad account
const S = 'e0000000-0000-4000-8000-000000000005'; // a plan without Ads
process.env.APP_SECRET = 'server_encryption_secret_long_enough';
process.env.SETTINGS_ENCRYPTION_KEY = '';
process.env.VITE_SUPABASE_URL = 'http://fake.supabase';
process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';

const secrets = require('../server/secrets.cjs');
const app = require('../server/app.cjs');
const limits = require('../server/limits.cjs');
const ads = require('../server/ads.cjs');
const billing = require('../server/adBilling.cjs');
const { _setStaffForToken } = require('../server/auth.cjs');
const { freshDb, asUser } = require('./helpers/pgHarness.cjs');

const ACCOUNT = 'act_1111111111';
const OTHER = 'act_2222222222';
let db, graph, meta;
const acctRow = (biz, act) => ({ business_id: biz, ad_account_id: act, currency: 'INR', access_token_enc: secrets.encrypt('EAAG-ads-token-bill-1234'), graph_api_version: 'v26.0', last_sync_at: new Date(Date.now() - 2 * 3600000).toISOString(), connected_at: '2026-11-01T00:00:00Z', alert_window_days: 3, auto_pause: false });
function seed() {
  db = {
    plans: [{ id: 'pro', name: 'Pro', ads_enabled: true }, { id: 'starter', name: 'Starter', ads_enabled: false }],
    businesses: [{ id: A, name: 'Clinic', status: 'active', plan_id: 'pro', limit_overrides: {} }, { id: B2, name: 'Other', status: 'active', plan_id: 'pro', limit_overrides: {} }, { id: S, name: 'Small', status: 'active', plan_id: 'starter', limit_overrides: {} }],
    business_ad_accounts: [acctRow(A, ACCOUNT), acctRow(B2, OTHER)],
    ad_insights_daily: [], whatsapp_leads: [], ad_issues: [], audit_log: [], system_events: [],
  };
  graph = [];
  // Amounts in paise, as Meta sends them.
  meta = { account: { account_status: 1, balance: '86000', amount_spent: '286000', spend_cap: '0', is_prepay_account: false, currency: 'INR', funding_source_details: { id: '1', display_string: 'Visa *4242', type: 1 } }, refuseFunding: false };
  limits.clearCache();
}

const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  if (u.startsWith('https://graph.facebook.com/')) {
    const path = u.replace(/^https:\/\/graph\.facebook\.com\/[^/]+\//, '');
    const form = opts.body ? Object.fromEntries(new URLSearchParams(String(opts.body))) : null;
    graph.push({ method, path, form });
    if (method === 'GET' && /^act_\d+\/insights/.test(path)) return json({ data: meta.insights || [] });
    if (method === 'GET' && /^act_\d+\/ads/.test(path)) return json({ data: meta.adsList || [] });
    if (method === 'GET' && path.startsWith('55555?fields=whatsapp_number')) return json({ whatsapp_number: '+91 89770 30642' });
    if (method === 'GET' && /^act_\d+\?fields=business/.test(path)) return meta.adOwner ? json(meta.adOwner) : json({ error: { message: '(#200) needs business_management', code: 200 } }, 400);
    if (method === 'GET' && path.startsWith('955000000000001?fields=owner_business_info')) return json({ owner_business_info: { id: '3577031679194010', name: 'Mayurahospitals' }, id: '955000000000001' });
    if (method === 'GET' && /^act_\d+\?fields=/.test(path)) {
      const asked = path.includes('funding_source_details');
      if (meta.refuseFunding && asked) return json({ error: { message: '(#200) Requires MANAGE task', code: 200 } }, 400);
      const { funding_source_details: fsd, ...rest } = meta.account; // Meta returns only the fields asked for
      return json(asked ? { ...rest, funding_source_details: fsd } : rest);
    }
    if (method === 'POST' && /^act_\d+$/.test(path)) {
      if (form.spend_cap) meta.account.spend_cap = String(Number(form.spend_cap) * 100);
      if (form.spend_cap_action === 'delete') meta.account.spend_cap = '0';
      return json({ success: true });
    }
    return json({ success: true });
  }
  if (!u.startsWith('http://fake.supabase/rest/v1/')) return json({}, 503);
  const [path, qs = ''] = u.slice('http://fake.supabase/rest/v1/'.length).split('?');
  const p = [...new URLSearchParams(qs).entries()];
  const body = opts.body ? JSON.parse(opts.body) : null;
  const rows = (db[path] ||= []);
  const filt = (r) => p.every(([k, v]) => {
    if (['select', 'order', 'limit', 'on_conflict', 'offset', 'or'].includes(k)) return true;
    if (v.startsWith('eq.')) return String(r[k]) === v.slice(3);
    if (v.startsWith('gte.')) return String(r[k] || '') >= v.slice(4);
    if (v === 'is.null') return r[k] == null;
    return true;
  });
  if (method === 'GET') return json(rows.filter(filt));
  if (method === 'POST') { (Array.isArray(body) ? body : [body]).forEach(r => rows.push({ ...r })); return json([], 201); }
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
      (res) => { let t = ''; res.on('data', ch => { t += ch; }); res.on('end', () => resolve({ status: res.statusCode, json: () => (t ? JSON.parse(t) : null) })); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const who = (n, role, biz = A) => ({ id: `d0000000-0000-4000-8000-00000000006${n}`, email: `${role}${n}@b.test`, role, businessId: biz, businessName: 'x' });
_setStaffForToken('b-owner', who(1, 'owner'));
_setStaffForToken('b-manager', who(2, 'manager'));
_setStaffForToken('b-agent', who(3, 'agent'));
_setStaffForToken('b-small', who(4, 'owner', S));
_setStaffForToken('b-other', who(5, 'owner', B2));

test('pure: Meta\'s fields read in rupees, with the status, problem and payment type', () => {
  const ok = billing.parseBilling(meta.account);
  assert.deepStrictEqual(ok, { status: 1, statusLabel: 'Active', problem: null, problemText: null, disableReason: null, prepaid: false, due: 860, spent: 2860, spendCap: null, method: 'Visa *4242', currency: 'INR' });
  const failed = billing.parseBilling({ account_status: 3, balance: '118000', amount_spent: '100', spend_cap: '5000000', is_prepay_account: true });
  assert.deepStrictEqual([failed.problem, failed.statusLabel, failed.spendCap, failed.prepaid, failed.method], ['payment', 'Payment failed', 50000, true, null]);
  assert.match(failed.problemText, /paused every ad/);
  const disabled = billing.parseBilling({ account_status: 2, disable_reason: 3 });
  assert.match(disabled.problemText, /Meta's reason: a payment risk/);
  assert.strictEqual(billing.parseBilling({ account_status: 9 }).problem, 'payment', 'grace period');
  assert.strictEqual(billing.parseBilling({}).statusLabel, 'Unknown');
  assert.strictEqual(billing.billingUrl('act_1111111111'), 'https://business.facebook.com/billing_hub/accounts/details/?asset_id=1111111111');
});

test('pure: the spending limit is checked (amount, at least 100, typo guard); empty or 0 removes it', () => {
  assert.deepStrictEqual(billing.checkCap('50000'), { value: 50000 });
  assert.deepStrictEqual(billing.checkCap(2500.5), { value: 2500.5 });
  for (const v of [null, '', 0, '0']) assert.deepStrictEqual(billing.checkCap(v), { remove: true });
  assert.match(billing.checkCap('50').error, /at least 100/);
  assert.match(billing.checkCap('1e9').error, /amount/);
  assert.match(billing.checkCap('-5').error, /amount/);
  assert.match(billing.checkCap(500000000).error, /too high/);
});

test('the hourly sync saves the billing card; managers see it without calling Meta; agents and other plans cannot', async () => {
  await ads.syncAccount(A);
  const row = db.business_ad_accounts.find(r => r.business_id === A);
  assert.strictEqual(row.billing.due, 860);
  assert.ok(row.billing_checked_at);
  const before = graph.length;
  const r = await request('GET', '/api/ads/billing', 'b-manager');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual([r.json().billing.spent, r.json().billing.method, r.json().canEditLimit], [2860, 'Visa *4242', false]);
  assert.match(r.json().billingUrl, /asset_id=1111111111$/);
  assert.strictEqual(graph.length, before, 'reading the card never calls Meta');
  assert.strictEqual((await request('GET', '/api/ads/billing', 'b-owner')).json().canEditLimit, true);
  assert.strictEqual((await request('GET', '/api/ads/billing', 'b-agent')).status, 403);
  assert.strictEqual((await request('POST', '/api/ads/billing/check', 'b-agent')).status, 403);
  assert.strictEqual((await request('GET', '/api/ads/billing', 'b-small')).status, 403);
});

test('tenancy: each business sees only its own ad account\'s billing', async () => {
  meta.account = { ...meta.account, balance: '100' };
  await request('POST', '/api/ads/billing/check', 'b-other');
  const mine = (await request('GET', '/api/ads/billing', 'b-owner')).json();
  const theirs = (await request('GET', '/api/ads/billing', 'b-other')).json();
  assert.strictEqual(mine.billing, null, 'A was not checked yet');
  assert.strictEqual(theirs.billing.due, 1);
  assert.match(theirs.billingUrl, /2222222222/);
  assert.ok(graph.every(g => !g.path.startsWith(ACCOUNT)), 'A\'s ad account was never read for B');
});

test('"Check now": reads Meta at most once a minute; without the Manage permission the rest still loads', async () => {
  meta.refuseFunding = true;
  const first = await request('POST', '/api/ads/billing/check', 'b-manager');
  assert.strictEqual(first.status, 200, JSON.stringify(first.json()));
  assert.deepStrictEqual([first.json().billing.method, first.json().billing.due], [null, 860]);
  const reads = graph.filter(g => g.method === 'GET').length;
  const again = await request('POST', '/api/ads/billing/check', 'b-manager');
  assert.match(again.json().note, /less than a minute ago/);
  assert.strictEqual(graph.filter(g => g.method === 'GET').length, reads, 'no second Meta call');
});

test('a payment problem shows on the Ads badge (and is logged once) until Meta says it is fixed', async () => {
  meta.account = { ...meta.account, account_status: 3 };
  await request('POST', '/api/ads/billing/check', 'b-manager');
  let issues = (await request('GET', '/api/ads/issues', 'b-manager')).json();
  assert.deepStrictEqual(issues.billingProblem, { problem: 'payment', label: 'Payment failed' });
  assert.strictEqual(db.system_events.filter(e => e.code === 'billing_payment').length, 1);
  db.business_ad_accounts.find(r => r.business_id === A).billing_checked_at = new Date(Date.now() - 120000).toISOString();
  await request('POST', '/api/ads/billing/check', 'b-manager');
  assert.strictEqual(db.system_events.filter(e => e.code === 'billing_payment').length, 1, 'not logged again while it lasts');
  meta.account = { ...meta.account, account_status: 1 };
  db.business_ad_accounts.find(r => r.business_id === A).billing_checked_at = new Date(Date.now() - 120000).toISOString();
  await request('POST', '/api/ads/billing/check', 'b-manager');
  issues = (await request('GET', '/api/ads/issues', 'b-manager')).json();
  assert.strictEqual(issues.billingProblem, null);
});

test('account spending limit: only the Business Admin, checked, sent to Meta in rupees, removable, audited', async () => {
  assert.strictEqual((await request('PUT', '/api/ads/billing/spend-cap', 'b-manager', { spendCap: '50000' })).status, 403);
  assert.strictEqual((await request('PUT', '/api/ads/billing/spend-cap', 'b-agent', { spendCap: '50000' })).status, 403);
  const bad = await request('PUT', '/api/ads/billing/spend-cap', 'b-owner', { spendCap: '50' });
  assert.strictEqual(bad.status, 400);
  assert.ok(!graph.some(g => g.method === 'POST'), 'nothing sent to Meta for a bad value');

  const ok = await request('PUT', '/api/ads/billing/spend-cap', 'b-owner', { spendCap: '50000' });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.json()));
  assert.deepStrictEqual(graph.filter(g => g.method === 'POST').map(g => [g.path, g.form.spend_cap]), [[ACCOUNT, '50000']]);
  assert.strictEqual(ok.json().billing.spendCap, 50000, 'read back from Meta');
  const off = await request('PUT', '/api/ads/billing/spend-cap', 'b-owner', { spendCap: null });
  assert.strictEqual(off.json().billing.spendCap, null);
  assert.strictEqual(graph.filter(g => g.method === 'POST').at(-1).form.spend_cap_action, 'delete');
  assert.deepStrictEqual(db.audit_log.filter(a => a.action === 'ads.spend_cap_changed').map(a => [a.details.before, a.details.after]), [[null, 50000], [50000, null]]);
});

// ---- Who owns the ad account (guidance) ----
test('pure: ownership from Meta: same portfolio, another portfolio, a personal ad account, or unknown', () => {
  const wa = { owner_business_info: { id: '3577031679194010', name: 'Mayurahospitals' } };
  assert.deepStrictEqual(billing.parseOwnership({ business: { id: '3577031679194010', name: 'Mayurahospitals' } }, wa),
    { adAccount: { id: '3577031679194010', name: 'Mayurahospitals' }, personal: false, adKnown: true, whatsapp: { id: '3577031679194010', name: 'Mayurahospitals' }, same: true });
  const other = billing.parseOwnership({ business: { id: '111111', name: 'Vanguard Media' } }, wa);
  assert.deepStrictEqual([other.adAccount.name, other.same], ['Vanguard Media', false]);
  const personal = billing.parseOwnership({ owner: '1234567890' }, wa);
  assert.deepStrictEqual([personal.personal, personal.adAccount, personal.same], [true, null, false]);
  const unknown = billing.parseOwnership({ error: { code: 200 } }, null);
  assert.deepStrictEqual([unknown.adKnown, unknown.personal, unknown.same, unknown.whatsapp], [false, false, null, null]);
});

test('"Check now" also saves who owns the ad account and the WhatsApp account; a refused field leaves it unknown', async () => {
  db.business_whatsapp = [{ business_id: A, phone_number: '919701103222', phone_number_id: '555000000000001', waba_id: '955000000000001', token_last4: '1234', access_token_enc: secrets.encrypt('EAAG-wa-token-clinic-long'), webhook_key: 'o'.repeat(32), graph_api_version: 'v26.0' }];
  require('../server/whatsapp.cjs').clearCache();
  meta.adOwner = { business: { id: '111111', name: 'Vanguard Media' }, id: ACCOUNT };
  const r = await request('POST', '/api/ads/billing/check', 'b-manager');
  assert.strictEqual(r.status, 200, JSON.stringify(r.json()));
  assert.deepStrictEqual(r.json().billing.ownership, { adAccount: { id: '111111', name: 'Vanguard Media' }, personal: false, adKnown: true, whatsapp: { id: '3577031679194010', name: 'Mayurahospitals' }, same: false });
  // The WhatsApp token never leaves the server; only names and ids are returned.
  assert.doesNotMatch(JSON.stringify(r.json()), /EAAG/);
  meta.adOwner = null;
  db.business_ad_accounts.find(x => x.business_id === A).billing_checked_at = new Date(Date.now() - 120000).toISOString();
  const again = await request('POST', '/api/ads/billing/check', 'b-manager');
  assert.strictEqual(again.json().billing.ownership.adKnown, false);
  assert.strictEqual(again.json().billing.due, 860, 'billing still loads');
});

// ---- The WhatsApp number each ad opens (same SQL file) ----
test('pure: each ad\'s number from its ad set; Page-only ads use the Page\'s number; ads without one are left out', () => {
  const list = [
    { id: '901', adset: { promoted_object: { page_id: '55555', whatsapp_phone_number: '+91 97011 03222' } } },
    { id: '902', adset: { promoted_object: { page_id: '55555' } } },
    { id: '903', adset: { promoted_object: { page_id: '66666' } } },
    { id: '904' },
    { id: 'bad', adset: { promoted_object: { whatsapp_phone_number: '919701103222' } } },
  ];
  assert.deepStrictEqual(ads.adNumbersOf(list, { 55555: '918977030642' }), {
    901: { n: '919701103222', p: null }, 902: { n: '918977030642', p: '55555' }, 903: { n: null, p: '66666' },
  });
});

test('the sync saves each ad\'s number; the report labels the business\'s own numbers and flags others (their chats don\'t reach the CRM)', async () => {
  db.business_whatsapp = [{ business_id: A, phone_number: '919701103222', phone_number_id: '555000000000001', waba_id: '955000000000001', token_last4: '1234', access_token_enc: secrets.encrypt('EAAG-wa-token-clinic-long'), webhook_key: 'n'.repeat(32), graph_api_version: 'v26.0' }];
  db.whatsapp_numbers = [];
  require('../server/whatsapp.cjs').clearCache();
  const day = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const ins = (id) => ({ ad_id: id, ad_name: `Ad ${id}`, adset_id: '1', campaign_id: '2', spend: '100', impressions: '1000', reach: '900', clicks: '10', date_start: day, actions: [] });
  meta.insights = [ins('901'), ins('902')];
  meta.adsList = [
    { id: '901', effective_status: 'ACTIVE', adset: { promoted_object: { page_id: '55555', whatsapp_phone_number: '+919701103222' } } },
    { id: '902', effective_status: 'ACTIVE', adset: { promoted_object: { page_id: '55555' } } },
  ];
  await ads.syncAccount(A);
  const row = db.business_ad_accounts.find(r => r.business_id === A);
  assert.deepStrictEqual(row.ad_numbers, { 901: { n: '919701103222', p: null }, 902: { n: '918977030642', p: '55555' } });
  assert.ok(graph.some(g => g.path.includes('adset{promoted_object}')), 'asked Meta for the ad set\'s promoted object');
  const r = await request('GET', '/api/ads?days=30', 'b-manager');
  assert.strictEqual(r.status, 200, JSON.stringify(r.json()));
  assert.deepStrictEqual(r.json().report.adNumbers, {
    901: { phone: '919701103222', viaPage: false, label: 'Main number', inCrm: true },
    902: { phone: '918977030642', viaPage: true, label: null, inCrm: false },
  });
});

test('if Meta refuses the ad set field, the sync still saves statuses (older field list)', async () => {
  let refused = 0;
  const orig = global.fetch;
  global.fetch = async (url, opts) => {
    if (String(url).includes('adset%7Bpromoted_object%7D') || String(url).includes('adset{promoted_object}')) { refused++; return new Response(JSON.stringify({ error: { message: '(#100) unknown field', code: 100 } }), { status: 400 }); }
    return orig(url, opts);
  };
  try {
    meta.adsList = [{ id: '901', effective_status: 'PAUSED' }];
    const out = await ads.syncAccount(A);
    assert.ok(!out.error, JSON.stringify(out));
    assert.strictEqual(refused, 1);
  } finally { global.fetch = orig; }
});

test('migration: billing columns, object check, ad accounts still server-only, safe to re-run', async () => {
  const pg = await freshDb();
  const sql = require('fs').readFileSync(require('path').join(__dirname, '..', 'supabase', 'migrations', '20261129_ads_billing.sql'), 'utf8');
  await pg.exec(sql);
  await pg.exec(sql);
  const cols = await pg.query("select column_name from information_schema.columns where table_name = 'business_ad_accounts' and column_name in ('billing', 'billing_checked_at', 'ad_numbers') order by 1");
  assert.deepStrictEqual(cols.rows.map(r => r.column_name), ['ad_numbers', 'billing', 'billing_checked_at']);
  const u = await pg.query("insert into auth.users (email) values ('o@x.in') returning id");
  await pg.query("insert into public.staff_members (user_id, email, role, business_id) values ($1, 'o@x.in', 'owner', 'a0000000-0000-4000-8000-000000000001')", [u.rows[0].id]);
  await assert.rejects(asUser(pg, u.rows[0].id, () => pg.query('select billing from public.business_ad_accounts')));
});
