// Ads phase H: H1 quick questions (ice breakers) to start the chat, H2 a tall picture for Stories / Reels / Status
// (with a fallback to one picture if Meta refuses it), H3 video ads (browser -> private storage -> Meta; only this
// business's uploads; Meta must finish processing first), H4 interests, places to leave out and languages.
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
const LAUNCH = '9a000000-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const VIDEO_PATH = `${A}/12345678-1234-4234-8234-123456789abc.mp4`;
const day = (n) => new Date(Date.now() + 330 * 60000 + n * 86400000).toISOString().slice(0, 10);
const HYD = { key: '1035921', type: 'city', name: 'Hyderabad', radius: 25 };
const SPEC = () => ({
  text: 'Free eye check-up camp this weekend. Message us to book.', headline: 'Book a slot', greeting: 'Hi! I saw your ad.', imageHash: 'a'.repeat(32), imageUrl: 'https://scontent.example/pic.jpg',
  locations: [HYD], ageMin: 25, ageMax: 60, gender: 'all', placement: 'auto',
  startDate: day(-3), endDate: day(20), number: '919000000500', useInstagram: false, schedule: null,
});
let db, graph, store, meta;
function seed() {
  db = {
    plans: [{ id: 'pro', name: 'Pro', ads_enabled: true }],
    businesses: [{ id: A, name: 'Clinic', status: 'active', plan_id: 'pro', limit_overrides: {}, industry: 'hospital', send_window_start: 9, send_window_end: 20 },
      { id: B2, name: 'Other', status: 'active', plan_id: 'pro', limit_overrides: {}, industry: 'food' }],
    business_ad_accounts: [{ business_id: A, ad_account_id: ACCOUNT, currency: 'INR', access_token_enc: secrets.encrypt('EAAG-ads-token-h-1234'), graph_api_version: 'v26.0', page_id: '55555', page_name: 'Page', max_daily_budget: 2000, last_sync_at: new Date().toISOString(), connected_at: '2026-11-01T00:00:00Z' }],
    business_whatsapp: [{ business_id: A, phone_number: '919000000500', phone_number_id: '555000000000001', waba_id: '955000000000001', token_last4: '1234', access_token_enc: secrets.encrypt('EAAG-wa-token-clinic-long'), webhook_key: 'h'.repeat(32), graph_api_version: 'v26.0' }],
    ad_launches: [{ id: LAUNCH, business_id: A, draft_id: '9c000000-aaaa-4aaa-8aaa-aaaaaaaaaaa3', created_by: 'owner1@h.test', name: 'Eye camp', spec: SPEC(), daily_budget: 500, currency: 'INR', status: 'launched', campaign_id: '700', adset_id: '701', creative_id: '702', ad_id: '703' }],
    audit_log: [], system_events: [], whatsapp_numbers: [],
  };
  graph = [];
  store = [];
  meta = { refuseTall: false, videoStatus: 'ready' };
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
    graph.push({ method, path, form });
    if (method === 'GET' && /^act_\d+\?fields=/.test(path)) return json({ min_daily_budget: 9600, currency: 'INR', account_status: 1 });
    if (method === 'GET' && path.startsWith('55555?fields=instagram')) return json({ id: '55555' });
    if (method === 'GET' && path.startsWith('search?type=adinterest')) return json({ data: [{ id: '6003107902433', name: 'Yoga', path: ['Fitness', 'Yoga'], audience_size_upper_bound: 900000 }, { id: 'bad id', name: 'Broken' }] });
    if (method === 'GET' && path.startsWith('search?type=adlocale')) return json({ data: [{ key: 46, name: 'Telugu' }, { key: 'x', name: 'Bad' }] });
    if (method === 'GET' && /^\d+\?fields=status/.test(path)) return json({ id: path.split('?')[0], status: { video_status: meta.videoStatus }, length: 14.5 });
    if (method === 'POST' && path.endsWith('/advideos')) return json({ id: '880000000001' });
    if (method === 'POST' && path.endsWith('/adcreatives') && form.asset_feed_spec && meta.refuseTall) return json({ error: { message: 'Asset customization is not supported for this objective', code: 100 } }, 400);
    if (method === 'POST' && ['campaigns', 'adsets', 'adcreatives', 'ads'].includes(path.split('/').pop())) return json({ id: String(nextId++) });
    return json({ success: true });
  }
  if (u.startsWith('http://fake.supabase/storage/v1/')) {
    const path = u.slice('http://fake.supabase/storage/v1/'.length);
    store.push({ method, path, body: opts.body ? JSON.parse(String(opts.body)) : null });
    if (path.startsWith('object/upload/sign/')) return json({ url: `/object/upload/sign/${path.slice('object/upload/sign/'.length)}?token=up` });
    if (path.startsWith('object/sign/')) return json({ signedURL: `/object/sign/${path.slice('object/sign/'.length)}?token=dl` });
    if (path.startsWith('object/list/')) return json([]);
    return json({});
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
    const list = (Array.isArray(body) ? body : [body]).map(x => ({ ...x }));
    for (const r of list) { if (path === 'ad_launches') r.id = `9e${String(rows.length).padStart(6, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`; rows.push(r); }
    return json(list, 201);
  }
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
const who = (n, role, biz = A) => ({ id: `d0000000-0000-4000-8000-00000000008${n}`, email: `${role}${n}@h.test`, role, businessId: biz, businessName: 'x' });
_setStaffForToken('h-owner', who(1, 'owner'));
_setStaffForToken('h-manager', who(2, 'manager'));
_setStaffForToken('h-agent', who(3, 'agent'));
const posts = () => graph.filter(g => g.method === 'POST');
const creatives = () => posts().filter(g => g.path.endsWith('/adcreatives'));
let draftN = 10;
const draft = (extra = {}) => ({
  draftId: `9f000000-aaaa-4aaa-8aaa-aaaaaaaaa${String(draftN++).padStart(3, '0')}`, name: 'Eye camp H', imageHash: 'b'.repeat(32), text: 'Book your free eye check-up on WhatsApp.',
  headline: 'Free check-up', greeting: 'Hi! I want to book.', locations: [HYD], ageMin: 25, ageMax: 60, gender: 'all', dailyBudget: 500, startDate: day(1), ...extra,
});

// ---- pure ---------------------------------------------------------------------------------------------------
test('H1 pure: no questions = the pre-typed greeting; with questions = Meta\'s welcome message with ice breakers', () => {
  assert.strictEqual(c.welcomeOf({ greeting: ' Hi! ' }), 'Hi!');
  assert.strictEqual(c.welcomeOf({ greeting: '', iceBreakers: [] }), null);
  const w = JSON.parse(c.welcomeOf({ greeting: 'Welcome to Sunrise Clinic', iceBreakers: [' Timings? ', '', 'Book a slot', 'Fees?', 'Address?', 'Fifth one'] }));
  assert.deepStrictEqual([w.type, w.version, w.landing_screen_type, w.text_format.customer_action_type], ['VISUAL_EDITOR', 2, 'welcome_message', 'ice_breakers']);
  assert.strictEqual(w.text_format.message.text, 'Welcome to Sunrise Clinic');
  assert.deepStrictEqual(w.text_format.message.ice_breakers, [{ title: 'Timings?' }, { title: 'Book a slot' }, { title: 'Fees?' }, { title: 'Address?' }], 'blanks dropped, at most 4');
  assert.strictEqual(JSON.parse(c.welcomeOf({ iceBreakers: ['Timings?'] })).text_format.message.text, 'Hi! How can we help you?');
});

test('H2 pure: the tall picture goes to Stories / Reels (and Status when chosen), the square one to feeds; only single-picture ads', () => {
  const d = { ...SPEC(), tallImageHash: 'c'.repeat(32) };
  const f = c.placementFeedFor(d, '55555', '777777');
  assert.deepStrictEqual(f.object_story_spec, { page_id: '55555', instagram_user_id: '777777' });
  const a = f.asset_feed_spec;
  assert.deepStrictEqual([a.optimization_type, a.call_to_action_types, a.additional_data.is_click_to_message], ['PLACEMENT', ['WHATSAPP_MESSAGE'], true]);
  assert.deepStrictEqual(a.images.map(i => [i.hash[0], i.adlabels[0].name]), [['a', 'square'], ['c', 'tall']]);
  assert.strictEqual(a.additional_data.page_welcome_message, 'Hi! I saw your ad.');
  const tall = a.asset_customization_rules.find(r => r.image_label.name === 'tall').customization_spec;
  assert.deepStrictEqual([tall.facebook_positions, tall.instagram_positions, tall.whatsapp_positions], [['story', 'facebook_reels'], ['story', 'reels'], undefined]);
  const withStatus = c.placementFeedFor({ ...d, placement: 'with_status' }, '55555', null).asset_feed_spec.asset_customization_rules[0].customization_spec;
  assert.deepStrictEqual([withStatus.publisher_platforms, withStatus.whatsapp_positions], [['facebook', 'instagram', 'whatsapp'], ['status']]);
  assert.strictEqual(c.placementFeedFor(SPEC(), '55555', null), null, 'no tall picture asked for');
  assert.strictEqual(c.placementFeedFor({ ...d, videoId: '880000000001' }, '55555', null), null);
  assert.strictEqual(c.placementFeedFor({ ...d, cards: [{ imageHash: 'd'.repeat(32) }, { imageHash: 'e'.repeat(32) }] }, '55555', null), null);
  // Both versions are prepared; Status ads carry the WhatsApp number on both.
  const forms = c.creativeFormsFor({ ...d, placement: 'with_status' }, '55555', null, 'n', '919000000500');
  assert.ok(forms.tall.asset_feed_spec && forms.plain.object_story_spec);
  assert.strictEqual(forms.tall.wamo_whatsapp_identity_spec, forms.plain.wamo_whatsapp_identity_spec);
});

test('H3+H4 pure: a video creative; interests, excluded places and languages in the targeting', () => {
  const v = JSON.parse(c.creativeFormsFor({ ...SPEC(), videoId: '880000000001', iceBreakers: ['Timings?'] }, '55555', null, 'n', '').plain.object_story_spec);
  assert.strictEqual(v.link_data, undefined);
  assert.deepStrictEqual([v.video_data.video_id, v.video_data.image_hash, v.video_data.title], ['880000000001', 'a'.repeat(32), 'Book a slot']);
  assert.match(v.video_data.page_welcome_message, /ice_breakers/);
  const t = c.targetingFor({ ...SPEC(), interests: [{ id: '6003107902433', name: 'Yoga' }], excludedLocations: [{ key: '1035922', type: 'city', name: 'Secunderabad' }], languages: [{ key: 46, name: 'Telugu' }] });
  assert.deepStrictEqual(t.flexible_spec, [{ interests: [{ id: '6003107902433', name: 'Yoga' }] }]);
  assert.deepStrictEqual(t.excluded_geo_locations.cities.map(x => x.key), ['1035922']);
  assert.deepStrictEqual(t.locales, [46]);
  const plain = c.targetingFor(SPEC());
  assert.deepStrictEqual([plain.flexible_spec, plain.excluded_geo_locations, plain.locales], [undefined, undefined, undefined]);
});

test('Phase H validation', () => {
  const lim = { minDailyBudget: 96, maxDailyBudget: 2000, today: day(0) };
  const ok = draft();
  const errs = (x) => c.validateDraft({ ...ok, ...x }, lim).join(' ');
  assert.strictEqual(errs({ iceBreakers: ['Timings?', 'Fees?'], interests: [{ id: '6003107902433', name: 'Yoga' }], languages: [{ key: 46, name: 'Telugu' }], excludedLocations: [{ key: '1035922', type: 'city' }] }), '');
  assert.match(errs({ iceBreakers: ['a', 'b', 'c', 'd', 'e'] }), /up to 4 quick questions/);
  assert.match(errs({ iceBreakers: ['x'.repeat(81)] }), /1 to 80 characters/);
  assert.match(errs({ iceBreakers: ['Fees?', ' fees? '] }), /are the same/);
  assert.ok(c.textCheck({ text: 'Book a visit.', iceBreakers: ['Guaranteed cure for diabetes?'] }).blocks.length, 'quick questions go through the same claims check as the ad text');
  assert.ok(c.textCheck({ text: 'Book a visit.', iceBreakers: ['Do you have diabetes?'] }).blocks.length);
  assert.match(errs({ videoId: 'abc' }), /video was not uploaded properly/);
  assert.match(errs({ videoId: '880000000001', imageHash: '' }), /cover picture for the video/);
  assert.match(errs({ videoId: '880000000001', cards: [{ imageHash: 'd'.repeat(32) }, { imageHash: 'e'.repeat(32) }] }), /can't also be a carousel/);
  assert.match(errs({ tallImageHash: 'c'.repeat(32), videoId: '880000000001' }), /single-picture ads only/);
  assert.match(errs({ tallImageHash: 'nope' }), /tall picture was not uploaded/);
  assert.match(errs({ interests: [{ id: '1; drop', name: 'x' }] }), /interests is not valid/);
  assert.match(errs({ interests: Array.from({ length: 11 }, (_, i) => ({ id: String(i + 1), name: 'x' })) }), /up to 10 interests/);
  assert.match(errs({ excludedLocations: [{ key: '1', type: 'planet' }] }), /excluded places is not valid/);
  assert.match(errs({ languages: [{ key: 'te' }] }), /languages is not valid/);
});

// ---- create ---------------------------------------------------------------------------------------------------
test('H1+H2+H4 create: quick questions, tall picture and extra targeting reach Meta and are saved', async () => {
  const r = await request('POST', '/api/ads/create', 'h-owner', draft({
    iceBreakers: ['What are the timings?', 'How do I book?'], tallImageHash: 'c'.repeat(32), tallImageUrl: 'https://scontent.example/tall.jpg',
    interests: [{ id: '6003107902433', name: 'Yoga' }], excludedLocations: [{ key: '1035922', type: 'city', name: 'Secunderabad' }], languages: [{ key: 46, name: 'Telugu' }],
  }));
  assert.strictEqual(r.status, 200, JSON.stringify(r.json()));
  assert.strictEqual(r.json().note, undefined);
  assert.strictEqual(creatives().length, 1, 'the tall version was accepted first time');
  const feed = JSON.parse(creatives()[0].form.asset_feed_spec);
  assert.match(feed.additional_data.page_welcome_message, /How do I book\?/);
  const tg = JSON.parse(posts().find(g => g.path.endsWith('/adsets')).form.targeting);
  assert.deepStrictEqual([tg.flexible_spec[0].interests[0].id, tg.excluded_geo_locations.cities[0].key, tg.locales], ['6003107902433', '1035922', [46]]);
  const spec = db.ad_launches.at(-1).spec;
  assert.deepStrictEqual([spec.iceBreakers, spec.tallImageHash, spec.tallImageUrl], [['What are the timings?', 'How do I book?'], 'c'.repeat(32), 'https://scontent.example/tall.jpg']);
});

test('H2 fallback: if Meta refuses the separate tall picture, the ad is made with one picture and the owner is told', async () => {
  meta.refuseTall = true;
  const r = await request('POST', '/api/ads/create', 'h-owner', draft({ tallImageHash: 'c'.repeat(32) }));
  assert.strictEqual(r.status, 200, JSON.stringify(r.json()));
  assert.match(r.json().note, /one picture everywhere.*Asset customization is not supported/);
  assert.deepStrictEqual(creatives().map(g => Boolean(g.form.asset_feed_spec)), [true, false]);
  const saved = db.ad_launches.at(-1);
  assert.strictEqual(saved.status, 'created');
  assert.strictEqual(saved.spec.tallImageHash, null, 'saved as Meta has it');
});

test('H3 create: Meta must have finished the video; once made, the storage copy is deleted (own business only)', async () => {
  meta.videoStatus = 'processing';
  const wait = await request('POST', '/api/ads/create', 'h-owner', draft({ videoId: '880000000001', videoPath: VIDEO_PATH }));
  assert.strictEqual(wait.status, 409);
  assert.match(wait.json().error, /still processing/);
  assert.strictEqual(posts().length, 0, 'nothing created');
  meta.videoStatus = 'error';
  assert.match((await request('POST', '/api/ads/create', 'h-owner', draft({ videoId: '880000000001' }))).json().error, /could not process the video/);

  meta.videoStatus = 'ready';
  const r = await request('POST', '/api/ads/create', 'h-owner', draft({ videoId: '880000000001', videoPath: VIDEO_PATH, tallImageHash: '' }));
  assert.strictEqual(r.status, 200, JSON.stringify(r.json()));
  assert.strictEqual(JSON.parse(creatives()[0].form.object_story_spec).video_data.video_id, '880000000001');
  assert.deepStrictEqual(store.filter(s => s.method === 'DELETE').map(s => s.body.prefixes), [[VIDEO_PATH]]);

  // A path from another business is never deleted.
  store = [];
  await request('POST', '/api/ads/create', 'h-owner', draft({ videoId: '880000000001', videoPath: `${B2}/12345678-1234-4234-8234-123456789abc.mp4` }));
  assert.strictEqual(store.filter(s => s.method === 'DELETE').length, 0);
});

// ---- video upload, search: who and what ---------------------------------------------------------------------
test('H3 upload: owner only; size and type checked; the upload goes to this business\'s own folder', async () => {
  for (const t of ['h-manager', 'h-agent']) {
    assert.strictEqual((await request('POST', '/api/ads/create/video/upload-url', t, { type: 'video/mp4', size: 1000 })).status, 403);
    assert.strictEqual((await request('POST', '/api/ads/create/video', t, { path: VIDEO_PATH })).status, 403);
    assert.strictEqual((await request('GET', '/api/ads/create/video/880000000001/status', t)).status, 403);
    assert.strictEqual((await request('GET', '/api/ads/create/interests?q=yoga', t)).status, 403);
    assert.strictEqual((await request('GET', '/api/ads/create/languages?q=tel', t)).status, 403);
  }
  assert.match((await request('POST', '/api/ads/create/video/upload-url', 'h-owner', { type: 'video/webm', size: 1000 })).json().error, /MP4 or MOV/);
  assert.match((await request('POST', '/api/ads/create/video/upload-url', 'h-owner', { type: 'video/mp4', size: c.MAX_VIDEO_BYTES + 1 })).json().error, /at most 50 MB/);
  const r = await request('POST', '/api/ads/create/video/upload-url', 'h-owner', { type: 'video/quicktime', size: 5_000_000 });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json()));
  assert.match(r.json().path, new RegExp(`^${A}/[0-9a-f-]{36}\\.mov$`));
  assert.match(r.json().uploadUrl, /\/storage\/v1\/object\/upload\/sign\/ad-videos\//);
});

test('H3 register: only this business\'s own upload is handed to Meta (by a short-lived link); status read back', async () => {
  for (const bad of [`${B2}/12345678-1234-4234-8234-123456789abc.mp4`, `${A}/../x.mp4`, 'https://evil.example/v.mp4', '']) {
    const r = await request('POST', '/api/ads/create/video', 'h-owner', { path: bad });
    assert.strictEqual(r.status, 400, bad);
    assert.match(r.json().error, /not valid/);
  }
  assert.strictEqual(posts().length, 0, 'nothing sent to Meta');
  const r = await request('POST', '/api/ads/create/video', 'h-owner', { path: VIDEO_PATH });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json()));
  assert.strictEqual(r.json().videoId, '880000000001');
  const sent = posts().find(g => g.path === `${ACCOUNT}/advideos`).form;
  assert.match(sent.file_url, /\/object\/sign\/ad-videos\/.+token=dl/);
  assert.strictEqual(store.find(s => s.path.startsWith('object/sign/')).body.expiresIn, 3600);

  meta.videoStatus = 'processing';
  assert.deepStrictEqual((await request('GET', '/api/ads/create/video/880000000001/status', 'h-owner')).json(), { success: true, status: 'processing', seconds: 14.5 });
  assert.strictEqual((await request('GET', '/api/ads/create/video/abc/status', 'h-owner')).status, 400);
});

test('H4 search: interests and languages from Meta, cleaned; short queries ask nothing', async () => {
  const i = await request('GET', '/api/ads/create/interests?q=yoga', 'h-owner');
  assert.deepStrictEqual(i.json().interests, [{ id: '6003107902433', name: 'Yoga', path: ['Fitness', 'Yoga'], size: 900000 }]);
  const l = await request('GET', '/api/ads/create/languages?q=tel', 'h-owner');
  assert.deepStrictEqual(l.json().languages, [{ key: 46, name: 'Telugu' }]);
  graph = [];
  assert.deepStrictEqual((await request('GET', '/api/ads/create/interests?q=y', 'h-owner')).json().interests, []);
  assert.strictEqual(graph.length, 0);
});

// ---- edit ---------------------------------------------------------------------------------------------------
test('Phase H edit: quick questions and tall picture make a new creative; interests change only the ad set; video can\'t be swapped', async () => {
  const r = await request('PUT', `/api/ads/launches/${LAUNCH}`, 'h-owner', { iceBreakers: ['Timings?', 'Fees?'] });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json()));
  assert.deepStrictEqual(r.json().changed, ['words or picture']);
  assert.match(JSON.parse(creatives()[0].form.object_story_spec).link_data.page_welcome_message, /Fees\?/);
  assert.deepStrictEqual(db.ad_launches[0].spec.iceBreakers, ['Timings?', 'Fees?']);

  graph = [];
  const aud = await request('PUT', `/api/ads/launches/${LAUNCH}`, 'h-owner', { interests: [{ id: '6003107902433', name: 'Yoga' }], languages: [{ key: 46, name: 'Telugu' }] });
  assert.strictEqual(aud.status, 200, JSON.stringify(aud.json()));
  assert.deepStrictEqual(posts().map(g => g.path), ['701']);
  assert.deepStrictEqual(JSON.parse(posts()[0].form.targeting).locales, [46]);

  graph = [];
  const tall = await request('PUT', `/api/ads/launches/${LAUNCH}`, 'h-owner', { tallImageHash: 'c'.repeat(32), tallImageUrl: 'https://scontent.example/tall.jpg' });
  assert.strictEqual(tall.status, 200, JSON.stringify(tall.json()));
  assert.ok(creatives()[0].form.asset_feed_spec);
  assert.strictEqual(db.ad_launches[0].spec.tallImageHash, 'c'.repeat(32));

  assert.match(c.applyEdit({ ...SPEC(), videoId: '880000000001' }, { videoId: '880000000002' }).error, /can't be swapped/);
  assert.match(c.applyEdit({ ...SPEC(), videoId: '880000000001' }, { tallImageHash: 'c'.repeat(32) }).error, /single-picture ads only/);
});
