// Ads → Manage (docs/progress/ads-manage.md, M1 + M2): campaigns / ad sets / ads of the connected ad account with the
// CRM's chats and bookings; On/Off at every level; rename + end date (Business Admin), budget (managers too).
// Every id is checked to be in the connected ad account; agents and plans without Ads get nothing; changes audited.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const A = 'a0000000-0000-4000-8000-000000000001';
const S = 'e0000000-0000-4000-8000-000000000005'; // a business on a plan without Ads
process.env.APP_SECRET = 'server_encryption_secret_long_enough';
process.env.VITE_SUPABASE_URL = 'http://fake.supabase';
process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';

const secrets = require('../server/secrets.cjs');
const app = require('../server/app.cjs');
const limits = require('../server/limits.cjs');
const manage = require('../server/adsManage.cjs');
const { _setStaffForToken } = require('../server/auth.cjs');

const ACCOUNT = 'act_1111111111';
const TODAY = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const OLD = '2026-01-01T00:00:00+0000';
let db, graph, meta;

const camp = (id, name, extra = {}) => ({ id, name, objective: 'OUTCOME_ENGAGEMENT', status: 'ACTIVE', effective_status: 'ACTIVE', daily_budget: '50000', created_time: OLD, ...extra });
const adset = (id, campaign_id, name, extra = {}) => ({ id, campaign_id, name, status: 'ACTIVE', effective_status: 'ACTIVE', daily_budget: '30000', destination_type: 'WHATSAPP', created_time: OLD, ...extra });
const ad = (id, campaign_id, adset_id, name, extra = {}) => ({ id, campaign_id, adset_id, name, status: 'ACTIVE', effective_status: 'ACTIVE', created_time: OLD, ...extra });

function seed() {
  db = {
    plans: [{ id: 'pro', name: 'Pro', ads_enabled: true }, { id: 'starter', name: 'Starter', ads_enabled: false }],
    businesses: [{ id: A, name: 'Sunrise Clinic', status: 'active', plan_id: 'pro', limit_overrides: {}, industry: 'hospital' }, { id: S, name: 'Small', status: 'active', plan_id: 'starter', limit_overrides: {} }],
    business_ad_accounts: [{ business_id: A, ad_account_id: ACCOUNT, currency: 'INR', access_token_enc: secrets.encrypt('EAAG-ads-token-m-1234'), graph_api_version: 'v26.0' }],
    ad_insights_daily: [
      { business_id: A, date: TODAY, ad_id: '301', adset_id: '201', campaign_id: '101', spend: 400, impressions: 1000, clicks: 50, conversations: 8 },
      { business_id: A, date: TODAY, ad_id: '302', adset_id: '201', campaign_id: '101', spend: 100, impressions: 500, clicks: 10, conversations: 2 },
      { business_id: A, date: TODAY, ad_id: '303', adset_id: '202', campaign_id: '102', spend: 60, impressions: 300, clicks: 5, conversations: 1 },
    ],
    whatsapp_leads: [
      { business_id: A, phone: '919000000001', first_ad_id: '301', first_ad_at: `${TODAY}T05:00:00Z`, stage: 'ordered' },
      { business_id: A, phone: '919000000002', first_ad_id: '301', first_ad_at: `${TODAY}T06:00:00Z`, stage: 'new' },
      { business_id: A, phone: '919000000003', first_ad_id: '302', first_ad_at: `${TODAY}T06:00:00Z`, stage: 'completed' },
    ],
    lead_statuses: [], audit_log: [],
  };
  graph = [];
  meta = {
    campaigns: [camp('101', 'Knee pain camp'), camp('102', 'Eye check', { daily_budget: undefined }), camp('103', 'Old winter camp', { status: 'PAUSED', effective_status: 'PAUSED' })],
    adsets: [adset('201', '101', 'Guntur 25-55'), adset('202', '102', 'Vijayawada', { daily_budget: undefined, lifetime_budget: '700000', end_time: '2026-12-31T23:59:00+0530' })],
    ads: [ad('301', '101', '201', 'Knee video'), ad('302', '101', '201', 'Knee photo'), ad('303', '102', '202', 'Eye photo')],
    foreign: { '999': { id: '999', account_id: '2222222222', name: 'Someone else\'s campaign', status: 'ACTIVE' } },
  };
  limits.clearCache(); manage._clearCache();
}
const all = () => [...meta.campaigns, ...meta.adsets, ...meta.ads];
const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  if (u.startsWith('https://graph.facebook.com/')) {
    const path = u.replace(/^https:\/\/graph\.facebook\.com\/[^/]+\//, '');
    const form = opts.body ? Object.fromEntries(new URLSearchParams(String(opts.body))) : null;
    graph.push({ method, path, form });
    const edge = path.match(/^(act_\d+|\d+)\/(campaigns|adsets|ads)\?/);
    if (method === 'GET' && edge) {
      const [, owner, kind] = edge;
      let list = meta[kind];
      if (!owner.startsWith('act_')) list = list.filter(x => x.campaign_id === owner || x.adset_id === owner);
      return json({ data: list });
    }
    const obj = path.match(/^(\d+)\?fields=account_id/);
    if (method === 'GET' && obj) {
      const o = all().find(x => x.id === obj[1]);
      if (o) return json({ ...o, account_id: '1111111111' });
      return meta.foreign[obj[1]] ? json(meta.foreign[obj[1]]) : json({ error: { message: 'Unsupported get request', code: 100 } }, 400);
    }
    if (method === 'POST' && /^\d+$/.test(path)) {
      const o = all().find(x => x.id === path);
      if (o && form.status) Object.assign(o, { status: form.status, effective_status: form.status });
      if (o && form.name) o.name = form.name;
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
    if (v === 'not.is.null') return r[k] != null;
    return true;
  });
  if (method === 'GET') return json(rows.filter(filt));
  if (method === 'POST') { const list = (Array.isArray(body) ? body : [body]).map(x => ({ ...x })); rows.push(...list); return json(list, 201); }
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
      (res) => { let t = ''; res.on('data', c => { t += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch { /* text */ } resolve({ status: res.statusCode, text: t, json: j }); }); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
_setStaffForToken('m-owner', { id: 'u1', email: 'owner@sun.test', role: 'owner', businessId: A, businessName: 'Sunrise Clinic' });
_setStaffForToken('m-manager', { id: 'u2', email: 'manager@sun.test', role: 'manager', businessId: A, businessName: 'Sunrise Clinic' });
_setStaffForToken('m-agent', { id: 'u3', email: 'agent@sun.test', role: 'agent', businessId: A, businessName: 'Sunrise Clinic' });
_setStaffForToken('m-small', { id: 'u4', email: 'owner@small.test', role: 'owner', businessId: S, businessName: 'Small' });
const posts = () => graph.filter(g => g.method === 'POST');

test('pure: totals per campaign / ad set / ad from Meta rows and CRM chats; booked = converted statuses', () => {
  const t = manage.totalsByLevel(
    [{ ad_id: '1', adset_id: 'S', campaign_id: 'C', spend: 10, impressions: 100, clicks: 3, conversations: 2 }, { ad_id: '2', adset_id: 'S', campaign_id: 'C', spend: 5.5, impressions: 50, clicks: 1, conversations: 1 }],
    [{ first_ad_id: '1', stage: 'won' }, { first_ad_id: '1', stage: 'new' }, { first_ad_id: '2', stage: 'won' }, { first_ad_id: '9', stage: 'won' }],
    (s) => s === 'won');
  assert.deepEqual(t.campaign.get('C'), { spend: 15.5, impressions: 150, clicks: 4, metaChats: 3, chats: 3, booked: 2 });
  assert.deepEqual(t.ad.get('1'), { spend: 10, impressions: 100, clicks: 3, metaChats: 2, chats: 2, booked: 1 });
  assert.equal(t.ad.get('9').chats, 1, 'a chat from an ad with no spend rows still counts for that ad');
  assert.match(manage.adsManagerUrl(ACCOUNT, 'adset', '201'), /adsmanager\/manage\/adsets\?act=1111111111&selected_adset_ids=201$/);
});

test('list: campaigns with Meta + CRM numbers; delivery filter, search, drill-down; agents and plans without Ads refused', async () => {
  assert.equal((await request('GET', '/api/ads/manage', 'm-agent')).status, 403);
  assert.equal((await request('GET', '/api/ads/manage', 'm-small')).status, 403);
  const r = await request('GET', '/api/ads/manage?level=campaign', 'm-manager');
  assert.equal(r.status, 200, r.text);
  const rows = Object.fromEntries(r.json.rows.map(x => [x.id, x]));
  assert.deepEqual(Object.keys(rows).sort(), ['101', '102'], 'an old paused campaign with no results is hidden by default');
  assert.deepEqual([rows['101'].spend, rows['101'].metaChats, rows['101'].chats, rows['101'].booked, rows['101'].costPerChat, rows['101'].dailyBudget], [500, 10, 3, 2, 166.67, 500]);
  assert.equal(rows['102'].dailyBudget, null, 'budget on its ad sets');
  assert.deepEqual([r.json.totals.spend, r.json.totals.chats], [560, 3]);
  assert.equal((await request('GET', '/api/ads/manage?level=campaign&delivery=all', 'm-manager')).json.rows.length, 3);
  assert.deepEqual((await request('GET', '/api/ads/manage?level=campaign&delivery=all&q=winter', 'm-manager')).json.rows.map(x => x.id), ['103']);
  // Drill down: the campaign's ad sets, then the ad set's ads.
  const sets = await request('GET', '/api/ads/manage?level=adset&parent=101', 'm-manager');
  assert.deepEqual(sets.json.rows.map(x => [x.id, x.whatsapp, x.dailyBudget]), [['201', true, 300]]);
  const lifetime = (await request('GET', '/api/ads/manage?level=adset&parent=102', 'm-manager')).json.rows[0];
  assert.deepEqual([lifetime.lifetimeBudget, lifetime.dailyBudget], [7000, null]);
  const adsRows = await request('GET', '/api/ads/manage?level=ad&parent=201', 'm-manager');
  assert.deepEqual(adsRows.json.rows.map(x => [x.id, x.chats]), [['301', 2], ['302', 1]]);
  // Another account's campaign can't be opened.
  assert.match((await request('GET', '/api/ads/manage?level=adset&parent=999', 'm-manager')).json.error, /not in your connected ad account/);
  // Read from Meta once per 5 minutes (no polling).
  const reads = graph.filter(g => g.path.startsWith(`${ACCOUNT}/campaigns`)).length;
  await request('GET', '/api/ads/manage?level=campaign', 'm-manager');
  assert.equal(graph.filter(g => g.path.startsWith(`${ACCOUNT}/campaigns`)).length, reads, 'served from the cache');
});

test('On/Off: a campaign or ad set is paused at Meta (only that id), audited; foreign / archived refused', async () => {
  const r = await request('POST', '/api/ads/manage/campaign/101/status', 'm-manager', { status: 'PAUSED' });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(posts().map(p => [p.path, p.form]), [['101', { status: 'PAUSED' }]]);
  const a = db.audit_log.at(-1);
  assert.deepEqual([a.action, a.details.before, a.details.after, a.actor_email], ['ads.campaign_paused', 'ACTIVE', 'PAUSED', 'manager@sun.test']);
  // The list shows it at once (the cache was dropped).
  assert.equal((await request('GET', '/api/ads/manage?level=campaign', 'm-manager')).json.rows.find(x => x.id === '101').status, 'PAUSED');
  assert.equal((await request('POST', '/api/ads/manage/adset/201/status', 'm-manager', { status: 'PAUSED' })).status, 200);
  assert.equal(db.audit_log.at(-1).action, 'ads.adset_paused');
  assert.match((await request('POST', '/api/ads/manage/campaign/999/status', 'm-manager', { status: 'PAUSED' })).json.error, /not in your connected ad account/);
  meta.campaigns[2].status = 'ARCHIVED';
  assert.match((await request('POST', '/api/ads/manage/campaign/103/status', 'm-owner', { status: 'ACTIVE' })).json.error, /archived/);
  assert.equal((await request('POST', '/api/ads/manage/campaign/101/status', 'm-agent', { status: 'ACTIVE' })).status, 403);
  assert.equal((await request('POST', '/api/ads/manage/nonsense/101/status', 'm-owner', { status: 'ACTIVE' })).status, 400);
  assert.equal(posts().length, 2, 'nothing else reached Meta');
});

test('rename + end date: Business Admin only; budget: managers too, on the level Meta keeps it, ≤ 5x, daily stays daily, lifetime stays lifetime', async () => {
  assert.equal((await request('PATCH', '/api/ads/manage/campaign/101', 'm-manager', { name: 'New name' })).status, 403);
  assert.equal((await request('PATCH', '/api/ads/manage/adset/201', 'm-manager', { endDate: '2030-01-31' })).status, 403);
  assert.equal((await request('PATCH', '/api/ads/manage/campaign/101', 'm-owner', { name: '  Knee camp  Nov ' })).status, 200);
  assert.deepEqual(posts().at(-1), { method: 'POST', path: '101', form: { name: 'Knee camp Nov' } });
  assert.deepEqual([db.audit_log.at(-1).action, db.audit_log.at(-1).details.before, db.audit_log.at(-1).details.after], ['ads.campaign_changed', 'Knee pain camp', 'Knee camp Nov']);
  assert.match((await request('PATCH', '/api/ads/manage/campaign/101', 'm-owner', { name: 'x', budget: 600 })).json.error, /one thing at a time/);

  // Budget: the campaign keeps a daily budget (₹500): ₹800 ok, ₹3,000 is more than 5x.
  assert.equal((await request('PATCH', '/api/ads/manage/campaign/101', 'm-manager', { budget: 800 })).status, 200);
  assert.deepEqual(posts().at(-1).form, { daily_budget: '80000' });
  assert.match((await request('PATCH', '/api/ads/manage/campaign/101', 'm-manager', { budget: 3000 })).json.error, /more than 5x/);
  // An ad set under a campaign budget, and a campaign whose budget is on its ad sets.
  meta.adsets.push(adset('203', '101', 'Uses campaign budget', { daily_budget: undefined }));
  assert.match((await request('PATCH', '/api/ads/manage/adset/203', 'm-manager', { budget: 100 })).json.error, /campaign's budget/);
  assert.match((await request('PATCH', '/api/ads/manage/campaign/102', 'm-manager', { budget: 100 })).json.error, /set on its ad sets/);
  // Lifetime budget stays a lifetime budget.
  assert.equal((await request('PATCH', '/api/ads/manage/adset/202', 'm-manager', { budget: 9000 })).status, 200);
  assert.deepEqual(posts().at(-1).form, { lifetime_budget: '900000' });
  assert.match((await request('PATCH', '/api/ads/manage/ad/301', 'm-manager', { budget: 10 })).json.error, /no budget of their own/);

  // End date: India end of day; not in the past; a lifetime-budget ad set keeps one.
  assert.equal((await request('PATCH', '/api/ads/manage/adset/201', 'm-owner', { endDate: '2030-01-31' })).status, 200);
  assert.deepEqual(posts().at(-1).form, { end_time: '2030-01-31T23:59:00+0530' });
  assert.match((await request('PATCH', '/api/ads/manage/adset/201', 'm-owner', { endDate: '2020-01-01' })).json.error, /past/);
  assert.match((await request('PATCH', '/api/ads/manage/adset/202', 'm-owner', { endDate: null })).json.error, /needs an end date/);
  assert.equal((await request('PATCH', '/api/ads/manage/adset/201', 'm-owner', { endDate: null })).status, 200);
  assert.deepEqual(posts().at(-1).form, { end_time: '0' });
  assert.match((await request('PATCH', '/api/ads/manage/campaign/999', 'm-owner', { name: 'Mine now' })).json.error, /not in your connected ad account/);
  assert.equal(db.audit_log.filter(a => a.action.endsWith('_changed')).length, 5, 'every change audited');
});
