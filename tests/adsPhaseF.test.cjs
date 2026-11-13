// Ads phase F (docs/progress/ads-module.md): F1 rejected / flagged ads with Meta's reasons + "needs attention"
// badge, F2 the Instagram account on new ads, F3 auto-pause over the cost limits (opt-in), F4 duplicate an ad.
// All on top of the existing Ads module: nothing changes unless switched on / clicked.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const A = 'a0000000-0000-4000-8000-000000000001';
const S = 'e0000000-0000-4000-8000-000000000005'; // a business on a plan without Ads
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
const ads = require('../server/ads.cjs');
const watch = require('../server/adWatch.cjs');
const c = require('../server/adCreate.cjs');
const { _setStaffForToken } = require('../server/auth.cjs');
const { freshDb, asUser } = require('./helpers/pgHarness.cjs');

const TODAY = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const ACCOUNT = 'act_1111111111';
let db, graph, meta;
function seed() {
  db = {
    plans: [{ id: 'pro', name: 'Pro', ads_enabled: true }, { id: 'starter', name: 'Starter', ads_enabled: false }],
    businesses: [{ id: A, name: 'Food Co', status: 'active', plan_id: 'pro', limit_overrides: {}, industry: 'food' }, { id: S, name: 'Small', status: 'active', plan_id: 'starter', limit_overrides: {} }],
    business_ad_accounts: [{ business_id: A, ad_account_id: ACCOUNT, currency: 'INR', access_token_enc: secrets.encrypt('EAAG-ads-token-f-1234'), graph_api_version: 'v26.0', page_id: '55555', page_name: 'Page', max_daily_budget: 2000, last_sync_at: new Date(Date.now() - 2 * 3600000).toISOString(), connected_at: '2026-11-01T00:00:00Z', alert_max_cost_per_chat: null, alert_max_cost_per_conversion: null, alert_window_days: 3, auto_pause: false }],
    business_whatsapp: [{ business_id: A, phone_number: '919000000500', phone_number_id: '555000000000001', waba_id: '955000000000001', token_last4: '1234', access_token_enc: secrets.encrypt('EAAG-wa-token-food-long'), webhook_key: 'f'.repeat(32), graph_api_version: 'v26.0' }],
    ad_insights_daily: [], whatsapp_leads: [], ad_issues: [], ad_launches: [], audit_log: [], system_events: [],
  };
  graph = [];
  meta = {
    ads: [], // what /act/ads answers
    objects: {}, // adId -> { account_id, name, status }
    failReviewFields: false,
    instagram: { id: '17841400000000001', username: 'foodco' },
  };
  limits.clearCache(); whatsapp.clearCache();
}

const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  if (u.startsWith('https://graph.facebook.com/')) {
    const path = u.replace(/^https:\/\/graph\.facebook\.com\/[^/]+\//, '');
    const form = opts.body ? Object.fromEntries(new URLSearchParams(String(opts.body))) : null;
    graph.push({ method, path, form });
    if (method === 'GET' && path.startsWith(`${ACCOUNT}/insights`)) return json({ data: [] });
    if (method === 'GET' && path.startsWith(`${ACCOUNT}/ads?fields=`)) {
      if (meta.failReviewFields && path.includes('ad_review_feedback')) return json({ error: { message: '(#100) Tried accessing nonexisting field (ad_review_feedback)', code: 100 } }, 400);
      return json({ data: meta.ads });
    }
    if (method === 'GET' && path.startsWith(`${ACCOUNT}?fields=`)) return json({ min_daily_budget: 9567, currency: 'INR', account_status: 1 });
    if (method === 'GET' && path.startsWith(`${ACCOUNT}/promote_pages`)) return json({ data: [{ id: '55555', name: 'Page' }] });
    if (method === 'GET' && path.startsWith('me/permissions')) return json({ data: [] });
    if (method === 'GET' && path.startsWith('55555?fields=instagram_business_account')) return json(meta.instagram ? { instagram_business_account: meta.instagram, id: '55555' } : { id: '55555' });
    if (method === 'GET' && path.startsWith('55555?fields=whatsapp_number')) return json({ whatsapp_number: '+91 90000 00500' });
    const obj = path.match(/^(\d+)\?fields=account_id/);
    if (method === 'GET' && obj) return meta.objects[obj[1]] ? json(meta.objects[obj[1]]) : json({ error: { message: 'Unsupported get request', code: 100 } }, 400);
    if (method === 'POST' && /^\d+\/copies$/.test(path)) return json({ copied_ad_id: '990000000001' });
    if (method === 'POST' && /^\d+$/.test(path)) return json({ success: true });
    if (method === 'POST' && ['campaigns', 'adsets', 'adcreatives', 'ads'].includes(path.split('/').pop())) return json({ id: String(Math.floor(Math.random() * 1e9)) });
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
    if (v === 'not.is.null') return r[k] != null;
    return true;
  });
  if (method === 'GET') return json(rows.filter(filt));
  if (method === 'POST') {
    const list = (Array.isArray(body) ? body : [body]).map(x => ({ ...x }));
    for (const r of list) {
      if (path === 'ad_issues') {
        const ex = rows.find(x => x.business_id === r.business_id && x.ad_id === r.ad_id && x.kind === r.kind);
        if (ex) { const { first_seen_at: _f, ...rest } = r; Object.assign(ex, rest); continue; }
      }
      if (path === 'ad_insights_daily') {
        const ex = rows.find(x => x.business_id === r.business_id && x.ad_id === r.ad_id && x.date === r.date);
        if (ex) { Object.assign(ex, r); continue; }
      }
      if (path === 'ad_launches') r.id = `9${String(rows.length + 1).padStart(7, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
      rows.push(r);
    }
    return json(list, 201);
  }
  if (method === 'PATCH') { const hit = rows.filter(filt); hit.forEach(r => Object.assign(r, body)); return json(hit); }
  if (method === 'DELETE') { db[path] = rows.filter(r => !filt(r)); return json([]); }
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
const who = (n, role, biz = A) => ({ id: `d0000000-0000-4000-8000-00000000002${n}`, email: `${role}${n}@f.test`, role, businessId: biz, businessName: 'x' });
_setStaffForToken('f-owner', who(1, 'owner'));
_setStaffForToken('f-manager', who(2, 'manager'));
_setStaffForToken('f-agent', who(3, 'agent'));
_setStaffForToken('f-small', who(4, 'owner', S));

const REJECTED = { id: '120200000000001', name: 'Diwali offer', effective_status: 'DISAPPROVED', ad_review_feedback: { global: { 'Unrealistic Outcomes': 'Your ad promises unlikely results.' } } };
const FLAGGED = { id: '120200000000002', name: 'Idli batter', effective_status: 'WITH_ISSUES', issues_info: [{ error_summary: 'Page not linked', error_message: 'The Page is not linked to this WhatsApp number.', level: 'AD' }] };
const FINE = { id: '120200000000003', name: 'Dosa', effective_status: 'ACTIVE' };

// ---- F1 --------------------------------------------------------------------------------------------------
test('F1 pure: Meta\'s reasons read from review feedback and issues, whatever the shape', () => {
  assert.deepStrictEqual(watch.reasonsOf(REJECTED), ['Your ad promises unlikely results.']);
  assert.deepStrictEqual(watch.reasonsOf(FLAGGED), ['Page not linked: The Page is not linked to this WhatsApp number.']);
  assert.deepStrictEqual(watch.reasonsOf({ ad_review_feedback: { placement_specific: { instagram: { X: 'Text in image.' } }, global: { Y: 'Text in image.' } } }), ['Text in image.'], 'nested + deduplicated');
  assert.deepStrictEqual(watch.reasonsOf({}), []);
  assert.strictEqual(watch.reasonsOf({ ad_review_feedback: { a: Array.from({ length: 20 }, (_, i) => `Reason number ${i}`) } }).length, 6);
});

test('F1 sync: rejected / flagged ads saved with reasons; unchanged stays seen; changed is announced again; fixed disappears', async () => {
  meta.ads = [REJECTED, FLAGGED, FINE];
  await ads.syncAccount(A);
  assert.ok(graph.some(g => g.path.includes('/ads?fields=id,name,effective_status,ad_review_feedback,issues_info')));
  assert.deepStrictEqual(db.ad_issues.map(i => [i.ad_id, i.kind, i.status, i.reasons.length, i.acknowledged_at]).sort(), [
    ['120200000000001', 'review', 'DISAPPROVED', 1, null], ['120200000000002', 'review', 'WITH_ISSUES', 1, null],
  ]);
  // Seen, then the same problem on the next sync: stays seen.
  db.ad_issues.forEach(i => { i.acknowledged_at = '2026-11-11T00:00:00Z'; });
  await ads.syncAccount(A);
  assert.ok(db.ad_issues.every(i => i.acknowledged_at), 'no new alert for the same problem');
  // A new reason: announced again.
  meta.ads = [{ ...REJECTED, ad_review_feedback: { global: { Z: 'Health claims are not allowed.' } } }, FLAGGED, FINE];
  await ads.syncAccount(A);
  assert.strictEqual(db.ad_issues.find(i => i.ad_id === REJECTED.id).acknowledged_at, null);
  // Fixed: gone.
  meta.ads = [{ ...REJECTED, effective_status: 'ACTIVE' }, FLAGGED, FINE];
  await ads.syncAccount(A);
  assert.deepStrictEqual(db.ad_issues.map(i => i.ad_id), [FLAGGED.id]);
  // Statuses still saved in the results as before.
  assert.ok(graph.filter(g => g.path.includes('/ads?fields=')).length >= 4);
});

test('F1 sync: if Meta refuses the review fields, the status update that works today still happens', async () => {
  meta.failReviewFields = true;
  meta.ads = [{ id: FINE.id, effective_status: 'PAUSED' }];
  const r = await ads.syncAccount(A);
  assert.ok(!r.error, JSON.stringify(r));
  assert.ok(graph.some(g => g.path.startsWith(`${ACCOUNT}/ads?fields=id,effective_status&`)), 'fell back to status only');
  assert.strictEqual(db.ad_issues.length, 0);
});

test('F1 screen: managers see the list and acknowledge it (badge count); agents can\'t; no Ads plan = empty', async () => {
  meta.ads = [REJECTED];
  await ads.syncAccount(A);
  const list = await request('GET', '/api/ads/issues', 'f-manager');
  assert.strictEqual(list.status, 200);
  assert.deepStrictEqual([list.json().unread, list.json().issues[0].reasons], [1, ['Your ad promises unlikely results.']]);
  assert.strictEqual((await request('GET', '/api/ads/issues', 'f-agent')).status, 403);
  assert.strictEqual((await request('POST', '/api/ads/issues/ack', 'f-agent')).status, 403);
  const ack = await request('POST', '/api/ads/issues/ack', 'f-manager');
  assert.strictEqual(ack.status, 200);
  assert.deepStrictEqual([ack.json().unread, ack.json().issues.length, ack.json().issues[0].acknowledgedBy], [0, 1, 'manager2@f.test'], 'a rejected ad stays listed until fixed');
  const small = await request('GET', '/api/ads/issues', 'f-small');
  assert.deepStrictEqual([small.status, small.json().issues, small.json().unread], [200, [], 0]);
});

// ---- F3 --------------------------------------------------------------------------------------------------
const spendRow = (adId, spend, name = 'Ad') => ({ business_id: A, ad_account_id: ACCOUNT, ad_id: adId, ad_name: name, campaign_id: '1', campaign_name: 'C', adset_id: '2', adset_name: 'S', date: TODAY, spend, impressions: 1000, reach: 900, clicks: 10, conversations: 0, effective_status: 'ACTIVE' });

test('F3: auto-pause pauses running ads over the limit (only when switched on), records why, never more than 5', async () => {
  db.ad_insights_daily.push(spendRow('120200000000011', 500, 'Expensive'), spendRow('120200000000012', 20, 'Cheap'));
  meta.objects['120200000000011'] = { account_id: '1111111111', name: 'Expensive', status: 'ACTIVE' };
  db.business_ad_accounts[0].alert_max_cost_per_chat = 50;
  // Off: alerts only, nothing paused.
  assert.deepStrictEqual(await watch.autoPause(A), { paused: 0 });
  assert.ok(!graph.some(g => g.method === 'POST'));

  db.business_ad_accounts[0].auto_pause = true;
  const r = await watch.autoPause(A);
  assert.deepStrictEqual(r, { paused: 1, failed: 0 });
  assert.deepStrictEqual(graph.filter(g => g.method === 'POST').map(g => [g.path, g.form.status]), [['120200000000011', 'PAUSED']]);
  const issue = db.ad_issues.find(i => i.kind === 'auto_paused');
  assert.strictEqual(issue.status, 'PAUSED');
  assert.match(issue.reasons[0], /Cost per chat INR 500 is over your limit of INR 50/);
  assert.ok(db.audit_log.some(a => a.action === 'ads.ad_auto_paused' && a.actor_email === 'system'));
  assert.strictEqual(db.ad_insights_daily.find(x => x.ad_id === '120200000000011').effective_status, 'PAUSED');

  // Already paused at Meta (someone did it by hand): left alone.
  graph.length = 0;
  db.ad_insights_daily.find(x => x.ad_id === '120200000000011').effective_status = 'ACTIVE';
  meta.objects['120200000000011'].status = 'PAUSED';
  await watch.autoPause(A);
  assert.ok(!graph.some(g => g.method === 'POST'));

  // At most 5 per run.
  graph.length = 0;
  for (let i = 0; i < 8; i++) {
    const id = `12020000000010${i}`;
    db.ad_insights_daily.push(spendRow(id, 900));
    meta.objects[id] = { account_id: '1111111111', name: `Ad ${i}`, status: 'ACTIVE' };
  }
  assert.strictEqual((await watch.autoPause(A)).paused, watch.MAX_PAUSES);
});

test('F3: an ad of another ad account is never paused; auto-pause needs a limit; the setting saves', async () => {
  db.ad_insights_daily.push(spendRow('120200000000021', 500));
  meta.objects['120200000000021'] = { account_id: '9999999999', name: 'Not ours', status: 'ACTIVE' };
  Object.assign(db.business_ad_accounts[0], { alert_max_cost_per_chat: 50, auto_pause: true });
  assert.strictEqual((await watch.autoPause(A)).paused, 0);
  assert.ok(!graph.some(g => g.method === 'POST'));

  Object.assign(db.business_ad_accounts[0], { alert_max_cost_per_chat: null, auto_pause: false });
  const noLimit = await request('PUT', '/api/ads/alerts', 'f-manager', { maxCostPerChat: '', maxCostPerConversion: '', windowDays: 3, autoPause: true });
  assert.strictEqual(noLimit.status, 400);
  const ok = await request('PUT', '/api/ads/alerts', 'f-manager', { maxCostPerChat: 60, maxCostPerConversion: '', windowDays: 3, autoPause: true });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.json()));
  assert.deepStrictEqual([db.business_ad_accounts[0].auto_pause, ok.json().alerts.autoPause], [true, true]);
  // Saving without the field (an older page) leaves auto-pause as it was.
  await request('PUT', '/api/ads/alerts', 'f-manager', { maxCostPerChat: 70, maxCostPerConversion: '', windowDays: 3 });
  assert.strictEqual(db.business_ad_accounts[0].auto_pause, true);
});

// ---- F4 --------------------------------------------------------------------------------------------------
test('F4: duplicate = a PAUSED copy in the same ad set, only for this account\'s ads, managers and up', async () => {
  meta.objects['120200000000031'] = { account_id: '1111111111', name: 'Dosa offer' };
  const r = await request('POST', '/api/ads/ads/120200000000031/copy', 'f-manager');
  assert.strictEqual(r.status, 200, JSON.stringify(r.json()));
  assert.strictEqual(r.json().copiedAdId, '990000000001');
  const call = graph.find(g => g.path === '120200000000031/copies');
  assert.deepStrictEqual(call.form, { status_option: 'PAUSED' });
  assert.ok(db.audit_log.some(a => a.action === 'ads.ad_copied'));
  meta.objects['120200000000032'] = { account_id: '9999999999', name: 'Not ours' };
  const foreign = await request('POST', '/api/ads/ads/120200000000032/copy', 'f-manager');
  assert.strictEqual(foreign.status, 400);
  assert.ok(!graph.some(g => g.path === '120200000000032/copies'));
  assert.strictEqual((await request('POST', '/api/ads/ads/120200000000031/copy', 'f-agent')).status, 403);
});

test('F4 pure: "Use as a start" keeps the ad but not its dates; F2: the Instagram account goes on new ads', async () => {
  const t = c.reuseOf({ name: 'Eye camp', daily_budget: 500, spec: { text: 'T', headline: 'H', greeting: 'G', imageHash: 'a'.repeat(32), imageUrl: 'https://x/y.jpg', locations: [{ key: '1', type: 'city' }], ageMin: 25, ageMax: 60, gender: 'female', placement: 'feeds_stories', number: '919000000500', useInstagram: false, startDate: TODAY, endDate: TODAY } });
  assert.deepStrictEqual([t.name, t.text, t.imageHash, t.ageMin, t.gender, t.placement, t.useInstagram, t.dailyBudget, t.startDate], ['Eye camp (copy)', 'T', 'a'.repeat(32), 25, 'female', 'feeds_stories', false, 500, undefined]);
  assert.strictEqual(c.reuseOf({ name: 'x', spec: { placement: 'mars', gender: 'x' } }).placement, 'auto');

  const draft = { draftId: '11111111-2222-4333-8444-555555555555', name: 'Offer', imageHash: 'abcdef0123456789abcdef0123456789', text: 'Weekend offer.', headline: '', greeting: 'Hi!', locations: [{ key: '1035921', type: 'city', name: 'Hyderabad' }], ageMin: 18, ageMax: 65, gender: 'all', dailyBudget: 500, startDate: TODAY, endDate: '' };
  const story = () => JSON.parse(graph.filter(g => g.path.endsWith('/adcreatives')).at(-1).form.object_story_spec);
  assert.strictEqual((await request('POST', '/api/ads/create', 'f-owner', draft)).status, 200);
  assert.strictEqual(story().instagram_user_id, '17841400000000001');
  await request('POST', '/api/ads/create', 'f-owner', { ...draft, draftId: '21111111-2222-4333-8444-555555555555', useInstagram: false });
  assert.strictEqual(story().instagram_user_id, undefined, 'switched off: the Page, as before');
  meta.instagram = null;
  await request('POST', '/api/ads/create', 'f-owner', { ...draft, draftId: '31111111-2222-4333-8444-555555555555' });
  assert.strictEqual(story().instagram_user_id, undefined, 'no Instagram account: the Page, as before');
  meta.instagram = { id: '17841400000000001', username: 'foodco' };
  const ready = await request('GET', '/api/ads/create/readiness', 'f-manager');
  assert.deepStrictEqual(ready.json().instagram, { id: '17841400000000001', username: 'foodco' });
});

test('migration F: ad_issues is server-only and checked; auto_pause defaults off; safe to re-run', async () => {
  const pg = await freshDb();
  await pg.exec(require('fs').readFileSync(require('path').join(__dirname, '..', 'supabase', 'migrations', '20261126_ads_f_watch.sql'), 'utf8'));
  await pg.query("insert into public.businesses (id, name, slug) values ($1, 'Food Co', 'f-food') on conflict do nothing", [A]);
  await pg.query("insert into public.ad_issues (business_id, ad_id, kind) values ($1, '1202', 'review')", [A]);
  await assert.rejects(pg.query("insert into public.ad_issues (business_id, ad_id, kind) values ($1, '1203', 'other')", [A]), /check/);
  await assert.rejects(pg.query("insert into public.ad_issues (business_id, ad_id, kind) values ($1, 'abc', 'review')", [A]), /check/);
  const col = await pg.query("select column_default from information_schema.columns where table_name = 'business_ad_accounts' and column_name = 'auto_pause'");
  assert.strictEqual(col.rows[0].column_default, 'false');
  const u = await pg.query("insert into auth.users (email) values ('m@f.test') returning id");
  await pg.query("insert into public.staff_members (user_id, email, role, business_id) values ($1, 'm@f.test', 'manager', $2)", [u.rows[0].id, A]);
  await assert.rejects(asUser(pg, u.rows[0].id, () => pg.query('select * from public.ad_issues')));
});
