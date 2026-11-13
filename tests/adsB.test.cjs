// Ads phase B: connecting a Meta ad account, syncing ad results, and the Ads page report.
// Fake database + fake Meta Graph API (no network), plus the real migration on PGlite for the
// database rules.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const A = 'a0000000-0000-4000-8000-000000000001'; // Arogya (Pro)
const B = 'b0000000-0000-4000-8000-000000000002'; // Mayura (Growth)
const C = 'c0000000-0000-4000-8000-000000000003'; // Small shop (Starter: no Ads)

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
const { freshDb, migrationSql, asUser } = require('./helpers/pgHarness.cjs');

const GOOD = 'EAAG-ads-token-arogya-1234';
const NO_READ = 'EAAG-token-without-ads-read-0000';
const LIMITED = 'EAAG-token-rate-limited-9999';
const IST = 330 * 60000;
const today = new Date(Date.now() + IST).toISOString().slice(0, 10);
const yesterday = new Date(Date.now() + IST - 86400000).toISOString().slice(0, 10);
const recent = new Date(Date.now() - 3600000).toISOString();

// ---- fake database ------------------------------------------------------------------------
let db;
let graphCalls;
function seed() {
  db = {
    plans: [
      { id: 'starter', name: 'Starter', ads_enabled: false },
      { id: 'growth', name: 'Growth', ads_enabled: true },
      { id: 'pro', name: 'Pro', ads_enabled: true },
    ],
    businesses: [
      { id: A, name: 'Arogya Ruchulu', status: 'active', plan_id: 'pro', limit_overrides: {} },
      { id: B, name: 'Mayura Hospitals', status: 'active', plan_id: 'growth', limit_overrides: {} },
      { id: C, name: 'Small Shop', status: 'active', plan_id: 'starter', limit_overrides: {} },
    ],
    business_ad_accounts: [],
    ad_insights_daily: [],
    whatsapp_leads: [
      { business_id: A, phone: '1', stage: 'ordered', first_ad_id: '901', first_ad_at: recent, first_ad_headline: 'Snack Box', last_ad_id: '901', last_ad_at: recent },
      { business_id: A, phone: '2', stage: 'new', first_ad_id: '901', first_ad_at: recent, last_ad_id: '901', last_ad_at: recent },
      { business_id: A, phone: '3', stage: 'new', first_ad_id: '555', first_ad_at: recent, last_ad_id: '555', last_ad_at: recent }, // ad from elsewhere
      { business_id: B, phone: '1', stage: 'ordered', first_ad_id: '901', first_ad_at: recent, last_ad_id: '901', last_ad_at: recent }, // other business
    ],
    audit_log: [],
  };
  graphCalls = [];
  limits.clearCache();
}

const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
const param = (u, k, op = 'eq') => { const m = u.match(new RegExp(`[?&]${k}=${op}\\.([^&]+)`)); return m ? decodeURIComponent(m[1]) : null; };

function graphReply(path, token) {
  if (![GOOD, NO_READ, LIMITED].includes(token)) return json({ error: { message: 'Invalid OAuth access token', code: 190 } }, 400);
  if (!path.startsWith('act_1111111111')) return json({ error: { message: 'Ad account not found', code: 100 } }, 400);
  if (path.startsWith('act_1111111111?fields=')) return json({ id: 'act_1111111111', name: 'Arogya Ads', currency: 'INR', account_status: 1, timezone_name: 'Asia/Kolkata' });
  if (path.includes('/insights?fields=spend&date_preset')) {
    return token === NO_READ ? json({ error: { message: '(#200) Requires ads_read permission', code: 200 } }, 400) : json({ data: [] });
  }
  if (path.includes('/insights?level=ad')) {
    if (token === LIMITED) return json({ error: { message: 'User request limit reached', code: 17 } }, 400);
    if (path.includes('after=page2')) {
      return json({ data: [{ ad_id: '902', ad_name: 'Ragi Cookies', campaign_id: 'c1', campaign_name: 'Launch', spend: '100.004', impressions: '2000', clicks: '40', date_start: today }] });
    }
    return json({
      data: [
        { ad_id: '901', ad_name: 'Snack Box', adset_id: 's1', campaign_id: 'c1', campaign_name: 'Launch', spend: '300', impressions: '5000', reach: '4000', clicks: '120', date_start: yesterday,
          actions: [{ action_type: 'link_click', value: '120' }, { action_type: ads.CONVERSATION_ACTION, value: '9' }] },
        { ad_id: '901', ad_name: 'Snack Box', adset_id: 's1', campaign_id: 'c1', campaign_name: 'Launch', spend: '200', impressions: '3000', clicks: '60', date_start: today,
          actions: [{ action_type: ads.CONVERSATION_ACTION, value: '5' }] },
      ],
      paging: { next: 'https://graph.facebook.com/v26.0/act_1111111111/insights?level=ad&after=page2' },
    });
  }
  if (path.startsWith('act_1111111111/ads?')) return json({ data: [{ id: '901', effective_status: 'ACTIVE' }, { id: '902', effective_status: 'PAUSED' }] });
  return json({ error: { message: 'unmocked graph call' } }, 400);
}

global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  if (u.startsWith('https://graph.facebook.com/')) {
    const path = u.replace(/^https:\/\/graph\.facebook\.com\/[^/]+\//, '');
    const token = String(opts.headers?.Authorization || '').replace('Bearer ', '');
    graphCalls.push({ path, token });
    return graphReply(path, token);
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
    (!param(u, 'ad_account_id') || r.ad_account_id === param(u, 'ad_account_id')) &&
    (!param(u, 'date', 'gte') || r.date >= param(u, 'date', 'gte'));
  if (method === 'GET') {
    let out = rows.filter(match);
    if (table === 'business_ad_accounts' && u.includes('or=(last_sync_at')) {
      const cutoff = decodeURIComponent(u.match(/last_sync_at\.lt\.([^)]+)\)/)[1]);
      out = out.filter(r => !r.last_sync_at || r.last_sync_at < cutoff);
    }
    return json(out);
  }
  if (method === 'POST') {
    const list = Array.isArray(body) ? body : [body];
    for (const r of list) {
      if (table === 'business_ad_accounts') {
        if (rows.find(x => x.ad_account_id === r.ad_account_id && x.business_id !== r.business_id)) {
          return json({ code: '23505', message: 'duplicate key value violates unique constraint "business_ad_accounts_ad_account_id_key"' }, 409);
        }
        const existing = rows.find(x => x.business_id === r.business_id);
        if (existing) Object.assign(existing, r); else rows.push({ ...r });
      } else if (table === 'ad_insights_daily') {
        const existing = rows.find(x => x.business_id === r.business_id && x.ad_id === r.ad_id && x.date === r.date);
        if (existing) Object.assign(existing, r); else rows.push({ ...r });
      } else {
        rows.push({ ...r });
      }
    }
    return json(list, 201);
  }
  if (method === 'PATCH') {
    const hit = rows.filter(match);
    hit.forEach(r => Object.assign(r, body));
    return json(hit);
  }
  if (method === 'DELETE') {
    db[table] = rows.filter(r => !match(r));
    return json([]);
  }
  return json([]);
};

// ---- server -------------------------------------------------------------------------------
let server;
let base;
before(async () => {
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
beforeEach(seed);

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

const staff = (id, biz, role) => ({ id: `d0000000-0000-4000-8000-0000000000${id}`, email: `${role}@${biz.slice(0, 1)}.test`, role, businessId: biz, businessName: 'x' });
_setStaffForToken('a-owner', staff('a1', A, 'owner'));
_setStaffForToken('a-manager', staff('a2', A, 'manager'));
_setStaffForToken('a-agent', staff('a3', A, 'agent'));
_setStaffForToken('b-owner', staff('b1', B, 'owner'));
_setStaffForToken('c-owner', staff('c1', C, 'owner'));

const connectA = () => request('PUT', '/api/ads/account', { token: 'a-owner', body: { adAccountId: '1111111111', accessToken: GOOD } });

// ---- pure helpers ---------------------------------------------------------------------------
test('ad account IDs are normalised to act_<digits>', () => {
  assert.strictEqual(ads.normalizeAdAccountId(' 1234567890 '), 'act_1234567890');
  assert.strictEqual(ads.normalizeAdAccountId('act_1234567890'), 'act_1234567890');
  assert.strictEqual(ads.normalizeAdAccountId('act_12ab'), null);
  assert.strictEqual(ads.normalizeAdAccountId('../me'), null);
});

test('parseInsights reads spend, counts and Meta messaging conversations', () => {
  const rows = ads.parseInsights([
    { ad_id: '1', date_start: '2026-11-01', spend: '12.345', impressions: '10', clicks: '2', actions: [{ action_type: ads.CONVERSATION_ACTION, value: '3' }, { action_type: 'link_click', value: '2' }] },
    { ad_id: null, date_start: '2026-11-01' },
  ], { businessId: A, adAccountId: 'act_1111111111', statuses: { 1: 'ACTIVE' } });
  assert.strictEqual(rows.length, 1);
  assert.deepStrictEqual([rows[0].spend, rows[0].impressions, rows[0].clicks, rows[0].conversations, rows[0].effective_status], [12.35, 10, 2, 3, 'ACTIVE']);
});

test('summariseAds joins Meta spend with CRM chats per ad', () => {
  const from = new Date(Date.now() - 7 * 86400000).toISOString();
  const r = ads.summariseAds({
    from,
    insights: [
      { date: '2026-11-01', ad_id: '901', ad_name: 'Snack Box', campaign_id: 'c1', campaign_name: 'Launch', spend: 300, impressions: 5000, clicks: 100, conversations: 9 },
      { date: '2026-11-02', ad_id: '901', ad_name: 'Snack Box', campaign_id: 'c1', campaign_name: 'Launch', spend: 200, impressions: 3000, clicks: 50, conversations: 5, effective_status: 'ACTIVE' },
      { date: '2026-11-02', ad_id: '902', ad_name: 'Ragi', campaign_id: 'c1', campaign_name: 'Launch', spend: 100, impressions: 1000, clicks: 10, conversations: 0 },
    ],
    leads: db.whatsapp_leads.filter(l => l.business_id === A),
  });
  const snack = r.ads.find(a => a.adId === '901');
  assert.deepStrictEqual([snack.spend, snack.chats, snack.converted, snack.costPerChat, snack.costPerConverted, snack.metaConversations, snack.status], [500, 2, 1, 250, 500, 14, 'ACTIVE']);
  assert.strictEqual(r.ads.find(a => a.adId === '902').costPerChat, null);
  assert.deepStrictEqual([r.totals.spend, r.totals.chats, r.totals.converted, r.totals.otherAdChats], [600, 2, 1, 1]);
  assert.strictEqual(r.campaigns[0].spend, 600);
});

test('ads and campaigns come latest first, with the days they ran', () => {
  const r = ads.summariseAds({
    from: new Date(Date.now() - 30 * 86400000).toISOString(),
    insights: [
      { date: '2026-11-01', ad_id: 'old', ad_name: 'Old big', campaign_id: 'c1', campaign_name: 'Diwali', adset_id: 's1', adset_name: 'Set 1', spend: 900, impressions: 10, clicks: 1, conversations: 0, effective_status: 'PAUSED' },
      { date: '2026-11-03', ad_id: 'old', ad_name: 'Old big', campaign_id: 'c1', campaign_name: 'Diwali', adset_id: 's1', adset_name: 'Set 1', spend: 100, impressions: 10, clicks: 1, conversations: 0, effective_status: 'PAUSED' },
      { date: '2026-11-09', ad_id: 'new', ad_name: 'New small', campaign_id: 'c2', campaign_name: 'Winter', adset_id: 's2', adset_name: 'Set 2', spend: 10, impressions: 100, clicks: 4, conversations: 1, effective_status: 'ACTIVE' },
      { date: '2026-11-09', ad_id: 'mid', ad_name: 'Started earlier', campaign_id: 'c2', campaign_name: 'Winter', adset_id: 's3', adset_name: 'Set 3', spend: 50, impressions: 100, clicks: 2, conversations: 0, effective_status: 'ACTIVE' },
      { date: '2026-11-05', ad_id: 'mid', ad_name: 'Started earlier', campaign_id: 'c2', campaign_name: 'Winter', adset_id: 's3', adset_name: 'Set 3', spend: 50, impressions: 100, clicks: 2, conversations: 0, effective_status: 'ACTIVE' },
    ],
    leads: [],
  });
  // Ran most recently first; same last day -> started most recently first. Spend no longer decides.
  assert.deepStrictEqual(r.ads.map(a => a.adId), ['new', 'mid', 'old']);
  const old = r.ads.find(a => a.adId === 'old');
  assert.deepStrictEqual([old.firstDate, old.lastDate, old.adsetName, old.spend], ['2026-11-01', '2026-11-03', 'Set 1', 1000]);
  assert.strictEqual(r.ads[0].ctr, 0.04);
  assert.strictEqual(r.ads[0].costPerClick, 2.5);
  assert.deepStrictEqual(r.campaigns.map(c => c.campaignName), ['Winter', 'Diwali']);
  const winter = r.campaigns[0];
  assert.deepStrictEqual([winter.firstDate, winter.lastDate, winter.ads, winter.activeAds, winter.adsets], ['2026-11-05', '2026-11-09', 2, 2, 2]);
  assert.strictEqual(r.campaigns[1].activeAds, 0);
});

test('the plan switch for Ads: off unless the plan or an override turns it on', () => {
  assert.strictEqual(limits.effectiveLimits({}, {}).ads_enabled, false);
  assert.strictEqual(limits.effectiveLimits({ ads_enabled: true }, {}).ads_enabled, true);
  assert.strictEqual(limits.effectiveLimits({ ads_enabled: true }, { ads_enabled: false }).ads_enabled, false);
  assert.strictEqual(limits.effectiveLimits({ ads_enabled: false }, { ads_enabled: true }).ads_enabled, true);
});

// ---- routes -----------------------------------------------------------------------------------
test('agents cannot open the Ads page or connect an account', async () => {
  assert.strictEqual((await request('GET', '/api/ads', { token: 'a-agent' })).status, 403);
  assert.strictEqual((await request('POST', '/api/ads/sync', { token: 'a-agent' })).status, 403);
  assert.strictEqual((await request('PUT', '/api/ads/account', { token: 'a-agent', body: { adAccountId: '1111111111', accessToken: GOOD } })).status, 403);
});

test('a business whose plan has no Ads cannot use it', async () => {
  const g = (await request('GET', '/api/ads', { token: 'c-owner' })).json();
  assert.strictEqual(g.adsEnabled, false);
  const p = await request('PUT', '/api/ads/account', { token: 'c-owner', body: { adAccountId: '1111111111', accessToken: GOOD } });
  assert.strictEqual(p.status, 400);
  assert.match(p.json().error, /plan does not include/);
  assert.strictEqual(db.business_ad_accounts.length, 0);
  assert.strictEqual(graphCalls.length, 0);
});

test('the owner connects: token stored encrypted, first sync saves every page, token never returned', async () => {
  const res = await connectA();
  assert.strictEqual(res.status, 200, res.text);
  assert.ok(!res.text.includes(GOOD));
  // Connect only checks with Meta: the slow first sync runs in the worker, not in the web request.
  assert.strictEqual(graphCalls.filter(c => c.path.includes('level=ad')).length, 0);
  assert.strictEqual(res.json().account.firstSyncPending, true);
  assert.match(res.json().syncNote, /load in the background/);
  const row = db.business_ad_accounts[0];
  assert.strictEqual(row.ad_account_id, 'act_1111111111');
  assert.ok(!JSON.stringify(row).includes(GOOD), 'token must not be stored in plain text');
  assert.strictEqual(secrets.decrypt(row.access_token_enc), GOOD);
  assert.strictEqual(row.token_last4, '1234');
  assert.ok(!row.last_sync_at);
  const sync = await request('POST', '/api/ads/sync', { token: 'a-manager' });
  assert.match(sync.json().error, /still loading/);

  assert.deepStrictEqual(await ads.syncDue({ deadlineMs: 20000 }), { synced: 1, failed: 0 });
  assert.ok(row.last_sync_at && !row.last_sync_error);
  // 30 days in 3-day windows, newest first.
  const windows = graphCalls.filter(c => c.path.includes('level=ad') && !c.path.includes('after=')).map(c => JSON.parse(decodeURIComponent(c.path.match(/time_range=([^&]+)/)[1])));
  assert.strictEqual(windows.length, 10);
  assert.strictEqual(windows[0].until, today);
  assert.ok(windows.every((w, i) => i === 0 || w.until < windows[i - 1].since), 'windows go back in time without overlap');
  assert.strictEqual(db.ad_insights_daily.length, 3);
  assert.ok(db.ad_insights_daily.every(r => r.business_id === A));
  assert.strictEqual(db.ad_insights_daily.find(r => r.ad_id === '902').effective_status, 'PAUSED');
  assert.ok(db.audit_log.some(a => a.action === 'ads.connected' && !JSON.stringify(a).includes(GOOD)));

  const page = await request('GET', '/api/ads?days=30', { token: 'a-manager' });
  assert.ok(!page.text.includes(GOOD));
  const r = page.json().report;
  assert.strictEqual(r.totals.spend, 600);
  assert.strictEqual(r.totals.chats, 2);
  assert.strictEqual(r.ads.find(a => a.adId === '901').costPerChat, 250);
});

test('a big account\'s first sync is spread over several worker runs and resumes where it stopped', async () => {
  await connectA();
  const row = db.business_ad_accounts[0];
  // Each window "takes" 7s+: with a 9s budget a run does one window, then stops.
  const realNow = Date.now;
  let fake = realNow();
  Date.now = () => fake;
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => { if (String(url).includes('level=ad')) fake += 4000; return realFetch(url, opts); };
  try {
    const first = await ads.syncDue({ deadlineMs: 9000 });
    assert.deepStrictEqual(first, { synced: 0, failed: 0, pending: 1 });
    assert.ok(!row.last_sync_at, 'not finished yet');
    // Rows were saved after connecting: the next run starts from the day before the oldest one.
    const before = graphCalls.length;
    db.ad_insights_daily.forEach(r => { r.updated_at = new Date(fake).toISOString(); });
    row.connected_at = new Date(fake - 60000).toISOString();
    await ads.syncDue({ deadlineMs: 9000 });
    const next = graphCalls.slice(before).find(c => c.path.includes('level=ad'));
    const oldestSaved = db.ad_insights_daily.map(r => r.date).sort()[0];
    assert.ok(JSON.parse(decodeURIComponent(next.path.match(/time_range=([^&]+)/)[1])).until < oldestSaved);
  } finally {
    Date.now = realNow;
    global.fetch = realFetch;
  }
});

test('a token that cannot read ad results is refused and nothing is saved', async () => {
  const res = await request('PUT', '/api/ads/account', { token: 'a-owner', body: { adAccountId: '1111111111', accessToken: NO_READ } });
  assert.strictEqual(res.status, 400);
  assert.match(res.json().error, /ads_read/);
  assert.strictEqual(db.business_ad_accounts.length, 0);
});

test('one ad account cannot be connected to two businesses', async () => {
  await connectA();
  const res = await request('PUT', '/api/ads/account', { token: 'b-owner', body: { adAccountId: 'act_1111111111', accessToken: GOOD } });
  assert.strictEqual(res.status, 400);
  assert.match(res.json().error, /another business/);
  assert.strictEqual(db.business_ad_accounts.length, 1);
});

test('managers may read and sync, but not connect; "Sync now" is limited to every 10 minutes', async () => {
  await connectA();
  assert.strictEqual((await request('PUT', '/api/ads/account', { token: 'a-manager', body: { adAccountId: '1111111111', accessToken: GOOD } })).status, 403);
  assert.strictEqual((await request('DELETE', '/api/ads/account', { token: 'a-manager' })).status, 403);
  await ads.syncDue({ deadlineMs: 20000 }); // the first sync (worker)
  const tooSoon = await request('POST', '/api/ads/sync', { token: 'a-manager' });
  assert.strictEqual(tooSoon.status, 400);
  assert.match(tooSoon.json().error, /min ago/);
  db.business_ad_accounts[0].last_sync_at = new Date(Date.now() - 11 * 60000).toISOString();
  graphCalls = [];
  const ok = await request('POST', '/api/ads/sync', { token: 'a-manager' });
  assert.strictEqual(ok.status, 200, ok.text);
  // Queued for the worker, not run inside the web request (Netlify's ~10s limit).
  assert.strictEqual(graphCalls.length, 0);
  assert.match(ok.json().message, /within about 5 minutes/);
  assert.deepStrictEqual(await ads.syncDue({ deadlineMs: 20000 }), { synced: 1, failed: 0 });
  assert.ok(Date.parse(db.business_ad_accounts[0].last_sync_at) > Date.now() - 60000);
});

test('another business sees none of this business\'s ad results', async () => {
  await connectA();
  const b = (await request('GET', '/api/ads', { token: 'b-owner' })).json();
  assert.strictEqual(b.account.connected, false);
  assert.strictEqual(b.report, null);
});

test('a Meta rate limit is recorded and retried at the next hourly sync', async () => {
  await connectA();
  db.business_ad_accounts[0].access_token_enc = secrets.encrypt(LIMITED);
  db.business_ad_accounts[0].last_sync_at = new Date(Date.now() - 2 * 3600000).toISOString();
  const out = await ads.syncDue({ deadlineMs: 5000 });
  assert.deepStrictEqual(out, { synced: 0, failed: 1 });
  assert.match(db.business_ad_accounts[0].last_sync_error, /rate limit/);
  assert.ok(Date.parse(db.business_ad_accounts[0].last_sync_at) > Date.now() - 60000);
});

test('the hourly sync skips suspended businesses and plans without Ads', async () => {
  await connectA();
  db.business_ad_accounts[0].last_sync_at = new Date(Date.now() - 2 * 3600000).toISOString();
  db.businesses.find(b => b.id === A).status = 'suspended';
  graphCalls = [];
  assert.deepStrictEqual(await ads.syncDue(), { synced: 0, failed: 0 });
  db.businesses.find(b => b.id === A).status = 'active';
  db.businesses.find(b => b.id === A).limit_overrides = { ads_enabled: false };
  limits.clearCache();
  assert.deepStrictEqual(await ads.syncDue(), { synced: 0, failed: 0 });
  assert.strictEqual(graphCalls.length, 0);
});

test('disconnect stops syncing (owner only)', async () => {
  await connectA();
  const res = await request('DELETE', '/api/ads/account', { token: 'a-owner' });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(db.business_ad_accounts.length, 0);
  assert.ok(db.audit_log.some(a => a.action === 'ads.disconnected'));
});

// ---- database rules (real migration on PGlite) -----------------------------------------------------
test('migration: ad tables are server-only, Growth/Pro get Ads, re-running keeps admin edits', async () => {
  const pg = await freshDb();
  const plans = await pg.query('select id, ads_enabled from public.plans order by sort_order');
  assert.deepStrictEqual(plans.rows.map(p => [p.id, p.ads_enabled]), [['starter', false], ['growth', true], ['pro', true]]);
  await pg.query("update public.plans set ads_enabled = false where id = 'growth'");
  await pg.exec(migrationSql('20261113_ads_b_accounts_insights.sql'));
  assert.strictEqual((await pg.query("select ads_enabled from public.plans where id = 'growth'")).rows[0].ads_enabled, false);

  const u = await pg.query("insert into auth.users (email) values ('owner@arogya.test') returning id");
  await pg.query("insert into public.staff_members (user_id, email, role, business_id) values ($1, 'owner@arogya.test', 'owner', $2)", [u.rows[0].id, A]);
  await pg.query("insert into public.business_ad_accounts (business_id, ad_account_id, access_token_enc) values ($1, 'act_1111111111', 'enc')", [A]);
  await pg.query("insert into public.ad_insights_daily (business_id, ad_account_id, date, ad_id, spend) values ($1, 'act_1111111111', '2026-11-01', '901', 10)", [A]);
  for (const t of ['business_ad_accounts', 'ad_insights_daily']) {
    await assert.rejects(asUser(pg, u.rows[0].id, () => pg.query(`select * from public.${t}`)), /permission denied/, `${t} must not be readable from the browser`);
  }
  await assert.rejects(pg.query("insert into public.business_ad_accounts (business_id, ad_account_id, access_token_enc) values ($1, '12345', 'enc')", [A]));
});
