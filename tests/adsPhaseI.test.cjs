// Ads phase I: I1 more ads in one campaign made here ("same audience and budget" = another ad in the same ad set;
// "new audience" = a new ad set in the same campaign), I2 existing Facebook / Instagram posts as WhatsApp ads.
// Business Admin only, own business only, the campaign's number kept, at most 10 ads per campaign, audited.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const A = 'a0000000-0000-4000-8000-000000000001';
const B2 = 'b0000000-0000-4000-8000-000000000002';
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
const c = require('../server/adCreate.cjs');
const { _setStaffForToken } = require('../server/auth.cjs');

const ACCOUNT = 'act_1111111111';
const PAGE = '55555';
const IG = '17840000000001';
const PAGE_TOKEN = 'EAAG-page-token-never-leaves-the-server';
const LAUNCH = '9a000000-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const OTHER_LAUNCH = '9b000000-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const day = (n) => new Date(Date.now() + 330 * 60000 + n * 86400000).toISOString().slice(0, 10);
const HYD = { key: '1035921', type: 'city', name: 'Hyderabad', radius: 25 };
const SPEC = () => ({
  text: 'Free eye check-up camp this weekend. Message us to book.', headline: 'Book a slot', greeting: 'Hi! I saw your ad.', imageHash: 'a'.repeat(32), imageUrl: 'https://scontent.example/pic.jpg',
  locations: [HYD], ageMin: 25, ageMax: 60, gender: 'all', placement: 'auto', interests: [], excludedLocations: [], languages: [],
  startDate: day(-3), endDate: day(20), number: '919000000500', useInstagram: true, schedule: null,
});
let db, graph, meta;
function seed() {
  db = {
    plans: [{ id: 'pro', name: 'Pro', ads_enabled: true }],
    businesses: [{ id: A, name: 'Clinic', status: 'active', plan_id: 'pro', limit_overrides: {}, industry: 'hospital', send_window_start: 9, send_window_end: 20 },
      { id: B2, name: 'Other', status: 'active', plan_id: 'pro', limit_overrides: {}, industry: 'food' }],
    business_ad_accounts: [{ business_id: A, ad_account_id: ACCOUNT, currency: 'INR', access_token_enc: secrets.encrypt('EAAG-ads-token-i-1234'), graph_api_version: 'v26.0', page_id: PAGE, page_name: 'Page', max_daily_budget: 2000, last_sync_at: new Date().toISOString(), connected_at: '2026-11-01T00:00:00Z' }],
    business_whatsapp: [{ business_id: A, phone_number: '919000000500', phone_number_id: '555000000000001', waba_id: '955000000000001', token_last4: '1234', access_token_enc: secrets.encrypt('EAAG-wa-token-clinic-long'), webhook_key: 'i'.repeat(32), graph_api_version: 'v26.0' }],
    ad_launches: [
      { id: LAUNCH, business_id: A, draft_id: '9c000000-aaaa-4aaa-8aaa-aaaaaaaaaaa3', created_by: 'owner1@i.test', name: 'Eye camp', spec: SPEC(), daily_budget: 500, currency: 'INR', status: 'launched', campaign_id: '700', adset_id: '701', creative_id: '702', ad_id: '703', created_at: '2026-11-10T10:00:00Z' },
      { id: OTHER_LAUNCH, business_id: B2, draft_id: '9d000000-aaaa-4aaa-8aaa-aaaaaaaaaaa4', created_by: 'x@o.test', name: 'Theirs', spec: SPEC(), daily_budget: 500, currency: 'INR', status: 'launched', campaign_id: '800', adset_id: '801', creative_id: '802', ad_id: '803' },
    ],
    audit_log: [], system_events: [], whatsapp_numbers: [],
  };
  graph = [];
  meta = { ig: true, failCreative: false, userTokenReadsPosts: false, adsListFails: false, adsLeftInAdset: false, adsetsLeftInCampaign: false };
  limits.clearCache(); whatsapp.clearCache();
}

const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
let nextId = 1000;
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  if (u.startsWith('https://graph.facebook.com/')) {
    const path = u.replace(/^https:\/\/graph\.facebook\.com\/[^/]+\//, '');
    const form = opts.body ? Object.fromEntries(new URLSearchParams(String(opts.body))) : null;
    const token = String(opts.headers?.Authorization || '').replace('Bearer ', '');
    graph.push({ method, path, form, token });
    if (method === 'GET' && /^act_\d+\?fields=/.test(path)) return json({ min_daily_budget: 9600, currency: 'INR', account_status: 1 });
    if (method === 'GET' && path.startsWith(`${PAGE}?fields=instagram`)) return json(meta.ig ? { id: PAGE, instagram_business_account: { id: IG, username: 'sunrise_clinic' } } : { id: PAGE });
    if (method === 'GET' && path === `${PAGE}?fields=access_token`) return json({ id: PAGE, access_token: PAGE_TOKEN });
    if (method === 'GET' && path.startsWith(`${PAGE}/published_posts`)) {
      if (token !== PAGE_TOKEN && !meta.userTokenReadsPosts) return json({ error: { message: '(#10) Requires a Page access token', code: 10 } }, 400);
      return json({ data: [
        { id: `${PAGE}_900000000001`, message: 'Eye camp this Sunday', full_picture: 'https://scontent.example/p1.jpg', permalink_url: 'https://www.facebook.com/p1', created_time: '2026-11-10T08:00:00+0000', is_eligible_for_promotion: true, is_instagram_eligible: true },
        { id: `${PAGE}_900000000002`, message: 'Shared from a friend', full_picture: 'http://insecure.example/p2.jpg', is_eligible_for_promotion: false },
        { id: 'not-a-post', message: 'x' },
      ] });
    }
    if (method === 'GET' && path.startsWith(`${IG}/media`)) return json({ data: [
      { id: '18000000000000001', caption: 'Free check-up camp', media_type: 'IMAGE', media_url: 'https://cdninstagram.example/1.jpg', permalink: 'https://instagram.com/p/1', timestamp: '2026-11-09T08:00:00+0000', boost_eligibility_info: { eligible_to_boost: true } },
      { id: '18000000000000002', caption: 'Song reel', media_type: 'VIDEO', thumbnail_url: 'https://cdninstagram.example/2.jpg', boost_eligibility_info: { eligible_to_boost: false, boost_ineligible_reason: 'Contains copyrighted music' } },
    ] });
    // The ad account's ads (two pages), for "already in an ad".
    if (method === 'GET' && path.startsWith(`${ACCOUNT}/ads?`)) {
      if (meta.adsListFails) return json({ error: { message: '(#200) Missing permission', code: 200 } }, 400);
      if (!path.includes('after=p2')) {
        return json({ data: [
          { name: 'Diwali boost', effective_status: 'ACTIVE', creative: { effective_object_story_id: `${PAGE}_900000000001` } },
          { name: 'New picture ad', effective_status: 'PAUSED', creative: { effective_object_story_id: `${PAGE}_777777777777`, object_story_id: null } },
        ], paging: { next: `https://graph.facebook.com/v26.0/${ACCOUNT}/ads?after=p2` } });
      }
      return json({ data: [{ name: 'Reel promo', effective_status: 'PENDING_REVIEW', creative: { effective_instagram_media_id: '18000000000000001', source_instagram_media_id: '18000000000000001' } }] });
    }
    // Delete: what is left in an ad set / campaign (Meta's own lists).
    if (method === 'GET' && /^\d+\/ads\?fields=id/.test(path)) return json({ data: meta.adsLeftInAdset ? [{ id: '999' }] : [] });
    if (method === 'GET' && /^\d+\/adsets\?fields=id/.test(path)) return json({ data: meta.adsetsLeftInCampaign ? [{ id: '998' }] : [] });
    if (method === 'POST' && path.endsWith('/adcreatives') && meta.failCreative) return json({ error: { message: 'This post can\'t be promoted', code: 100 } }, 400);
    if (method === 'POST' && ['campaigns', 'adsets', 'adcreatives', 'ads'].includes(path.split('/').pop())) return json({ id: String(nextId++) });
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
    return true;
  });
  if (method === 'GET') return json(rows.filter(filt));
  if (method === 'POST') {
    // unique (business_id, draft_id), as in Postgres: a repeat is ignored.
    if (path === 'ad_launches' && rows.some(r => r.business_id === body.business_id && r.draft_id === body.draft_id)) return json([], 201);
    const list = (Array.isArray(body) ? body : [body]).map(x => ({ ...x }));
    for (const r of list) { if (path === 'ad_launches') { r.id = `9e${String(rows.length).padStart(6, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`; r.created_at = new Date().toISOString(); } rows.push(r); }
    return json(list, 201);
  }
  if (method === 'PATCH') { const hit = rows.filter(filt); hit.forEach(r => Object.assign(r, body)); return json(hit); }
  if (method === 'DELETE') { const hit = rows.filter(filt); db[path] = rows.filter(r => !hit.includes(r)); return json(hit); }
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
      (res) => { let t = ''; res.on('data', ch => { t += ch; }); res.on('end', () => resolve({ status: res.statusCode, text: t, json: () => (t ? JSON.parse(t) : null) })); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const who = (n, role) => ({ id: `d0000000-0000-4000-8000-00000000009${n}`, email: `${role}${n}@i.test`, role, businessId: A, businessName: 'x' });
_setStaffForToken('i-owner', who(1, 'owner'));
_setStaffForToken('i-manager', who(2, 'manager'));
_setStaffForToken('i-agent', who(3, 'agent'));
const posts = () => graph.filter(g => g.method === 'POST');
const kinds = () => posts().map(g => g.path.split('/').pop());
let draftN = 10;
const draftId = () => `9f000000-aaaa-4aaa-8aaa-aaaaaaaaa${String(draftN++).padStart(3, '0')}`;
const newAd = (extra = {}) => ({
  draftId: draftId(), name: 'Eye camp – picture 2', imageHash: 'b'.repeat(32), text: 'Book your free eye check-up on WhatsApp.',
  locations: [HYD], ageMin: 25, ageMax: 60, gender: 'all', dailyBudget: 500, startDate: day(1), ...extra,
});
const IG_POST = { source: 'instagram', id: '18000000000000001', caption: 'Free check-up camp', pictureUrl: 'https://cdninstagram.example/1.jpg', permalink: 'https://instagram.com/p/1' };
const FB_POST = { source: 'facebook', id: `${PAGE}_900000000001`, caption: 'Eye camp this Sunday', pictureUrl: 'https://scontent.example/p1.jpg', igEligible: true };

// ---- pure ---------------------------------------------------------------------------------------------------
test('I2 pure: posts are checked (own Page only), listed with Meta\'s eligibility, and become a WhatsApp-button creative', () => {
  assert.deepStrictEqual(c.checkPost(FB_POST, PAGE).post.id, FB_POST.id);
  assert.match(c.checkPost({ ...FB_POST, id: '66666_900000000001' }, PAGE).error, /not one of this Page's posts/);
  assert.match(c.checkPost({ source: 'instagram', id: '1; drop' }).error, /not valid/);
  assert.match(c.checkPost({ source: 'tiktok', id: '123456' }).error, /Facebook or Instagram/);
  assert.strictEqual(c.checkPost({ ...IG_POST, pictureUrl: 'javascript:alert(1)' }).post.pictureUrl, '', 'only https pictures kept');

  const fb = c.postsOf('facebook', [{ id: `${PAGE}_1234567`, message: 'Hi', full_picture: 'http://x/y.jpg', is_eligible_for_promotion: false }, { id: 'bad' }]);
  assert.deepStrictEqual([fb.length, fb[0].eligible, fb[0].pictureUrl], [1, false, '']);
  assert.match(fb[0].reason, /can't be promoted/);
  const ig = c.postsOf('instagram', [{ id: '18000000000000002', media_type: 'VIDEO', thumbnail_url: 'https://t/2.jpg', boost_eligibility_info: { eligible_to_boost: false, boost_ineligible_reason: 'Contains copyrighted music' } }]);
  assert.deepStrictEqual([ig[0].eligible, ig[0].reason, ig[0].pictureUrl], [false, 'Contains copyrighted music', 'https://t/2.jpg']);

  const igForm = c.postCreativeFor(c.checkPost(IG_POST).post, PAGE, IG, 'n');
  assert.deepStrictEqual([igForm.object_id, igForm.instagram_user_id, igForm.source_instagram_media_id, igForm.object_story_spec], [PAGE, IG, IG_POST.id, undefined]);
  assert.deepStrictEqual(JSON.parse(igForm.call_to_action), { type: 'WHATSAPP_MESSAGE', value: { link: 'https://api.whatsapp.com/send', app_destination: 'WHATSAPP' } });
  const fbForm = c.postCreativeFor(c.checkPost(FB_POST).post, PAGE, IG, 'n');
  assert.deepStrictEqual([fbForm.object_story_id, fbForm.instagram_user_id], [FB_POST.id, IG]);
  assert.strictEqual(c.postCreativeFor(c.checkPost({ ...FB_POST, igEligible: false }).post, PAGE, IG, 'n').instagram_user_id, undefined);
  // The post replaces the picture and the words; nothing else of the creative can be added to it.
  const lim = { minDailyBudget: 96, maxDailyBudget: 2000, today: day(0) };
  const d = newAd({ imageHash: '', text: '', post: IG_POST });
  assert.deepStrictEqual(c.validateDraft(d, lim), []);
  assert.match(c.validateDraft({ ...d, iceBreakers: ['Fees?'] }, lim).join(' '), /used as it is/);
  assert.match(c.validateDraft({ ...d, videoId: '880000000001' }, lim).join(' '), /used as it is/);
  assert.strictEqual(c.reuseOf({ name: 'x', spec: { ...SPEC(), post: IG_POST } }).post.id, IG_POST.id);
});

// ---- I2 create ----------------------------------------------------------------------------------------------
test('I2 create: an Instagram post becomes the ad (no new picture); its caption is checked; saved for the lists', async () => {
  const r = await request('POST', '/api/ads/create', 'i-owner', newAd({ imageHash: '', text: '', post: IG_POST }));
  assert.strictEqual(r.status, 200, r.text);
  const form = posts().find(g => g.path.endsWith('/adcreatives')).form;
  assert.deepStrictEqual([form.source_instagram_media_id, form.instagram_user_id, form.object_id, form.object_story_spec], [IG_POST.id, IG, PAGE, undefined]);
  assert.deepStrictEqual(kinds(), ['campaigns', 'adsets', 'adcreatives', 'ads']);
  const saved = db.ad_launches.at(-1);
  assert.deepStrictEqual([saved.spec.post.id, saved.spec.text, saved.spec.imageUrl], [IG_POST.id, '', IG_POST.pictureUrl]);
  assert.strictEqual(db.audit_log.at(-1).details.post, 'instagram');

  graph = [];
  const claim = await request('POST', '/api/ads/create', 'i-owner', newAd({ imageHash: '', text: '', post: { ...IG_POST, caption: 'Guaranteed cure for diabetes' } }));
  assert.strictEqual(claim.status, 400);
  assert.strictEqual(posts().length, 0, 'nothing made in Meta');
});

test('I2 create: Instagram posts need the Page\'s Instagram account; Facebook posts must be the Page\'s own; Meta\'s refusal is shown and undone', async () => {
  meta.ig = false;
  assert.match((await request('POST', '/api/ads/create', 'i-owner', newAd({ imageHash: '', text: '', post: IG_POST }))).json().error, /need the Instagram account connected/);
  assert.match((await request('POST', '/api/ads/create', 'i-owner', newAd({ imageHash: '', text: '', post: { ...FB_POST, id: '66666_900000000001' } }))).json().error, /not one of this Page's posts/);
  assert.strictEqual(posts().length, 0);

  meta.failCreative = true;
  const r = await request('POST', '/api/ads/create', 'i-owner', newAd({ imageHash: '', text: '', post: FB_POST }));
  assert.strictEqual(r.status, 502);
  assert.match(r.json().error, /Meta refused the Facebook post as an ad: This post can't be promoted/);
  assert.deepStrictEqual(graph.filter(g => g.method === 'DELETE').length, 2, 'the new campaign and ad set are deleted again');
  assert.strictEqual(db.ad_launches.at(-1).status, 'failed');
});

test('I2 list posts: owner only; Facebook posts read with the Page\'s own token (never returned); Instagram posts with eligibility', async () => {
  for (const t of ['i-manager', 'i-agent']) assert.strictEqual((await request('GET', '/api/ads/create/posts?source=facebook', t)).status, 403);
  const fb = await request('GET', '/api/ads/create/posts?source=facebook', 'i-owner');
  assert.strictEqual(fb.status, 200, fb.text);
  assert.deepStrictEqual(fb.json().posts.map(p => [p.id, p.eligible]), [[`${PAGE}_900000000001`, true], [`${PAGE}_900000000002`, false]]);
  assert.ok(!fb.text.includes(PAGE_TOKEN), 'the Page token never reaches the browser');
  assert.strictEqual(graph.filter(g => g.path.startsWith(`${PAGE}/published_posts`)).at(-1).token, PAGE_TOKEN);
  const ig = await request('GET', '/api/ads/create/posts?source=instagram', 'i-owner');
  assert.deepStrictEqual(ig.json().posts.map(p => [p.id, p.eligible, p.reason]), [['18000000000000001', true, ''], ['18000000000000002', false, 'Contains copyrighted music']]);
  meta.ig = false;
  assert.match((await request('GET', '/api/ads/create/posts?source=instagram', 'i-owner')).json().error, /No Instagram account/);
});

test('I2 "already in an ad": posts used by the account\'s ads are marked (Facebook and Instagram, all pages of ads); a failure only drops the labels', async () => {
  const u = c.postUsageOf([
    { name: 'A', effective_status: 'ACTIVE', creative: { effective_object_story_id: '1_2', object_story_id: '1_2' } },
    { name: 'B', effective_status: 'CAMPAIGN_PAUSED', creative: { source_instagram_media_id: '99999' } },
    { name: 'C', effective_status: 'WITH_ISSUES', creative: { effective_object_story_id: '1_2' } },
    { name: 'D' },
  ]);
  assert.deepStrictEqual(u['1_2'], [{ name: 'A', status: 'running' }, { name: 'C', status: 'has a problem' }], 'one entry per ad, even when both ids name the post');
  assert.deepStrictEqual(u['99999'], [{ name: 'B', status: 'paused' }]);

  const fb = (await request('GET', '/api/ads/create/posts?source=facebook', 'i-owner')).json();
  assert.deepStrictEqual(fb.posts.map(p => [p.id, p.inAds]), [[`${PAGE}_900000000001`, [{ name: 'Diwali boost', status: 'running' }]], [`${PAGE}_900000000002`, []]]);
  assert.strictEqual(fb.usageNote, null);
  const ig = (await request('GET', '/api/ads/create/posts?source=instagram', 'i-owner')).json();
  assert.deepStrictEqual(ig.posts[0].inAds, [{ name: 'Reel promo', status: 'in review' }], 'found on the second page of ads');
  const asked = graph.find(g => g.path.startsWith(`${ACCOUNT}/ads?`)).path;
  assert.match(decodeURIComponent(asked), /effective_status=\["ACTIVE".*"PAUSED"/);
  assert.ok(!decodeURIComponent(asked).includes('DELETED') && !decodeURIComponent(asked).includes('ARCHIVED'), 'deleted / archived ads don\'t count');

  meta.adsListFails = true;
  const r = await request('GET', '/api/ads/create/posts?source=facebook', 'i-owner');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json().posts.length, 2);
  assert.match(r.json().usageNote, /Couldn't check which posts are already in ads/);
});

test('a draft Meta refused can be tried again after fixing it (not the old error again); radius only 17-80 km', async () => {
  const lim = { minDailyBudget: 96, maxDailyBudget: 2000, today: day(0) };
  assert.match(c.validateDraft(newAd({ locations: [{ ...HYD, radius: 10 }] }), lim).join(' '), /must be 17 to 80 km/);
  assert.deepStrictEqual(c.validateDraft(newAd({ locations: [{ ...HYD, radius: 17 }] }), lim), []);
  assert.deepStrictEqual(c.validateDraft(newAd({ locations: [{ ...HYD, radius: null }] }), lim), [], 'city only');

  const draft = newAd({ imageHash: '', text: '', post: FB_POST });
  meta.failCreative = true;
  const first = await request('POST', '/api/ads/create', 'i-owner', draft);
  assert.strictEqual(first.status, 502);
  const row = db.ad_launches.find(l => l.draft_id === draft.draftId);
  assert.strictEqual(row.status, 'failed');
  // Fixed (here: Meta accepts now), the same draft again: created, in the same record.
  meta.failCreative = false;
  graph = [];
  const again = await request('POST', '/api/ads/create', 'i-owner', { ...draft, dailyBudget: 120 });
  assert.strictEqual(again.status, 200, again.text);
  assert.deepStrictEqual([row.status, row.error, Number(row.daily_budget)], ['created', null, 120]);
  assert.strictEqual(db.ad_launches.filter(l => l.draft_id === draft.draftId).length, 1);
  assert.deepStrictEqual(kinds(), ['campaigns', 'adsets', 'adcreatives', 'ads']);
  // A created one is never made twice.
  graph = [];
  assert.strictEqual((await request('POST', '/api/ads/create', 'i-owner', draft)).json().repeated, true);
  assert.strictEqual(posts().length, 0);
});

// ---- delete ---------------------------------------------------------------------------------------------------
test('delete: Business Admin only, own business only; a failed attempt only leaves the list; one still being created waits', async () => {
  for (const t of ['i-manager', 'i-agent']) assert.strictEqual((await request('DELETE', `/api/ads/launches/${LAUNCH}`, t)).status, 403);
  assert.strictEqual((await request('DELETE', `/api/ads/launches/${OTHER_LAUNCH}`, 'i-owner')).status, 404);
  assert.ok(db.ad_launches.some(l => l.id === OTHER_LAUNCH), 'the other business\'s ad is untouched');
  db.ad_launches.push({ id: '9e100001-aaaa-4aaa-8aaa-aaaaaaaaaaaa', business_id: A, status: 'failed', name: 'Try 1', spec: {}, error: 'Meta refused', created_at: new Date().toISOString() });
  db.ad_launches.push({ id: '9e100002-aaaa-4aaa-8aaa-aaaaaaaaaaaa', business_id: A, status: 'creating', name: 'Now', spec: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  const f = await request('DELETE', '/api/ads/launches/9e100001-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'i-owner');
  assert.deepStrictEqual([f.status, f.json().inMeta], [200, false]);
  assert.ok(!db.ad_launches.some(l => l.id === '9e100001-aaaa-4aaa-8aaa-aaaaaaaaaaaa'));
  assert.match((await request('DELETE', '/api/ads/launches/9e100002-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'i-owner')).json().error, /still being created/);
  assert.strictEqual(graph.filter(g => g.method === 'DELETE').length, 0, 'nothing asked of Meta');
  assert.strictEqual(db.audit_log.at(-1).action, 'ads.ad_removed_from_list');
});

test('delete: a lone ad goes with its emptied ad set and campaign; in a shared campaign only the ad, and the shared ad takes over', async () => {
  const r = await request('DELETE', `/api/ads/launches/${LAUNCH}`, 'i-owner');
  assert.strictEqual(r.status, 200, r.text);
  assert.deepStrictEqual(graph.filter(g => g.method === 'DELETE').map(g => g.path), ['703', '701', '700']);
  assert.deepStrictEqual(r.json().removed, ['ad', 'ad set', 'campaign']);
  assert.ok(!db.ad_launches.some(l => l.id === LAUNCH));
  assert.deepStrictEqual([db.audit_log.at(-1).action, db.audit_log.at(-1).details.adId], ['ads.ad_deleted', '703']);

  // A campaign with a second ad sharing the ad set: deleting the first leaves the ad set (Meta still has an ad in it).
  seed();
  const add = await request('POST', `/api/ads/launches/${LAUNCH}/ads`, 'i-owner', newAd({ mode: 'same_audience' }));
  const child = db.ad_launches.find(l => l.id === add.json().launch.id);
  graph = []; meta.adsLeftInAdset = true;
  const r2 = await request('DELETE', `/api/ads/launches/${LAUNCH}`, 'i-owner');
  assert.deepStrictEqual(r2.json().removed, ['ad']);
  assert.deepStrictEqual(graph.filter(g => g.method === 'DELETE').map(g => g.path), ['703']);
  assert.deepStrictEqual([child.spec.sharedAdset, child.spec.addedTo], [undefined, undefined], 'the remaining ad now owns the audience and budget');
  assert.strictEqual((await request('PUT', `/api/ads/launches/${child.id}`, 'i-owner', { ageMin: 30 })).status, 200, 'and can change them');
});

// ---- I1 add to a campaign -------------------------------------------------------------------------------------
test('I1 same audience: a new creative + ad in the SAME ad set; the audience, dates and budget are the first ad\'s, whatever is sent', async () => {
  const r = await request('POST', `/api/ads/launches/${LAUNCH}/ads`, 'i-owner', newAd({ mode: 'same_audience', locations: [{ key: '999', type: 'city', name: 'Elsewhere' }], dailyBudget: 1500, numberId: '555000000000009' }));
  assert.strictEqual(r.status, 200, r.text);
  assert.deepStrictEqual(kinds(), ['adcreatives', 'ads'], 'no new campaign, no new ad set');
  assert.strictEqual(posts().find(g => g.path.endsWith('/ads')).form.adset_id, '701');
  const row = db.ad_launches.at(-1);
  assert.deepStrictEqual([row.campaign_id, row.adset_id, Number(row.daily_budget), row.status], ['700', '701', 500, 'created']);
  assert.deepStrictEqual([row.spec.addedTo, row.spec.sharedAdset, row.spec.locations, row.spec.number], [LAUNCH, true, [HYD], '919000000500']);
  assert.deepStrictEqual(db.audit_log.at(-1).action, 'ads.ad_added');
});

test('I1 new audience: a new ad set (own budget and audience) in the same campaign; the campaign\'s number', async () => {
  const r = await request('POST', `/api/ads/launches/${LAUNCH}/ads`, 'i-owner', newAd({ mode: 'new_audience', name: 'Eye camp – Secunderabad', locations: [{ key: '1035922', type: 'city', name: 'Secunderabad' }], dailyBudget: 300 }));
  assert.strictEqual(r.status, 200, r.text);
  assert.deepStrictEqual(kinds(), ['adsets', 'adcreatives', 'ads']);
  const adset = posts()[0].form;
  assert.deepStrictEqual([adset.campaign_id, adset.daily_budget, JSON.parse(adset.targeting).geo_locations.cities[0].key, JSON.parse(adset.promoted_object).whatsapp_phone_number], ['700', '30000', '1035922', '+919000000500']);
  const row = db.ad_launches.at(-1);
  assert.deepStrictEqual([row.campaign_id, row.adset_id === '701', Number(row.daily_budget), row.spec.sharedAdset], ['700', false, 300, false]);
  // Launching it switches on the campaign (already on), its own ad set and the ad.
  graph = [];
  const l = await request('POST', `/api/ads/launches/${row.id}/launch`, 'i-owner', { confirmBudget: 300 });
  assert.strictEqual(l.status, 200, l.text);
  assert.deepStrictEqual(posts().map(g => g.path), ['700', row.adset_id, row.ad_id]);
});

test('I1 who and limits: Business Admin only, own business only, complete ads only, a mode, at most 10 per campaign; failures undone', async () => {
  for (const t of ['i-manager', 'i-agent']) assert.strictEqual((await request('POST', `/api/ads/launches/${LAUNCH}/ads`, t, newAd({ mode: 'same_audience' }))).status, 403);
  assert.strictEqual((await request('POST', `/api/ads/launches/${OTHER_LAUNCH}/ads`, 'i-owner', newAd({ mode: 'same_audience' }))).status, 404);
  assert.match((await request('POST', `/api/ads/launches/${LAUNCH}/ads`, 'i-owner', newAd({}))).json().error, /same audience and budget, or a new audience/);
  assert.strictEqual(posts().length, 0);
  db.ad_launches[0].status = 'failed';
  assert.match((await request('POST', `/api/ads/launches/${LAUNCH}/ads`, 'i-owner', newAd({ mode: 'same_audience' }))).json().error, /created completely/);
  db.ad_launches[0].status = 'launched';
  for (let i = 0; i < 9; i++) db.ad_launches.push({ id: `9e10000${i}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, business_id: A, campaign_id: '700', adset_id: '701', status: 'created', spec: {} });
  assert.match((await request('POST', `/api/ads/launches/${LAUNCH}/ads`, 'i-owner', newAd({ mode: 'same_audience' }))).json().error, /holds up to 10 ads/);
  db.ad_launches.splice(2);

  meta.failCreative = true;
  const r = await request('POST', `/api/ads/launches/${LAUNCH}/ads`, 'i-owner', newAd({ mode: 'new_audience' }));
  assert.strictEqual(r.status, 502);
  const deleted = graph.filter(g => g.method === 'DELETE').map(g => g.path);
  assert.strictEqual(deleted.length, 1, 'only the new ad set is deleted');
  assert.ok(!deleted.includes('700') && !deleted.includes('701'), 'the existing campaign and ad set are never deleted');
});

// ---- edit -----------------------------------------------------------------------------------------------------
test('I edit: shared ads change only their own words; the first ad\'s audience change is copied to them; post words are the post\'s', async () => {
  const add = await request('POST', `/api/ads/launches/${LAUNCH}/ads`, 'i-owner', newAd({ mode: 'same_audience' }));
  const child = db.ad_launches.find(l => l.id === add.json().launch.id);
  graph = [];
  const refused = await request('PUT', `/api/ads/launches/${child.id}`, 'i-owner', { ageMin: 30 });
  assert.match(refused.json().error, /shares its audience, budget and dates/);
  assert.strictEqual(posts().length, 0);
  const words = await request('PUT', `/api/ads/launches/${child.id}`, 'i-owner', { text: 'Sunday eye camp. Message us to book.' });
  assert.strictEqual(words.status, 200, words.text);

  graph = [];
  const parent = await request('PUT', `/api/ads/launches/${LAUNCH}`, 'i-owner', { ageMin: 30, dailyBudget: 400 });
  assert.strictEqual(parent.status, 200, parent.text);
  assert.deepStrictEqual([child.spec.ageMin, Number(child.daily_budget)], [30, 400], 'the shared ad\'s record follows');

  // An ad made from a post: the audience can change, the words can't.
  const fromPost = await request('POST', '/api/ads/create', 'i-owner', newAd({ imageHash: '', text: '', post: IG_POST }));
  const id = fromPost.json().launch.id;
  db.ad_launches.find(l => l.id === id).status = 'created';
  assert.match((await request('PUT', `/api/ads/launches/${id}`, 'i-owner', { text: 'New words' })).json().error, /existing post/);
  assert.strictEqual((await request('PUT', `/api/ads/launches/${id}`, 'i-owner', { ageMax: 50 })).status, 200);
});

test('the list carries each ad\'s campaign and ad set, for grouping', async () => {
  await request('POST', `/api/ads/launches/${LAUNCH}/ads`, 'i-owner', newAd({ mode: 'same_audience' }));
  const r = await request('GET', '/api/ads/launches', 'i-manager');
  const mine = r.json().launches.filter(l => l.campaign_id === '700');
  assert.strictEqual(mine.length, 2);
  assert.ok(mine.every(l => l.adset_id === '701'));
  assert.ok(!r.json().launches.some(l => l.id === OTHER_LAUNCH));
});
