// Ads phase D2: creating a Click-to-WhatsApp ad from the CRM. The text check and draft checks (pure), the
// exact requests to Meta (campaign -> ad set -> creative -> ad, all PAUSED, WhatsApp destination), rollback
// when Meta refuses a step, one ad per draft, Launch (typed budget) switching all three on, and who may do it.
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
const c = require('../server/adCreate.cjs');
const { _setStaffForToken } = require('../server/auth.cjs');
const { freshDb } = require('./helpers/pgHarness.cjs');

const TODAY = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const plusDays = (n) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const DRAFT = () => ({
  draftId: '11111111-2222-4333-8444-555555555555', name: 'Eye camp', imageHash: 'abcdef0123456789abcdef0123456789',
  imageUrl: 'https://scontent.fbcdn.net/x.jpg', text: 'Free eye check-up camp this weekend. Message us to book a slot.',
  headline: 'Book your free check-up', greeting: 'Hi! I want to book the eye camp.',
  locations: [{ key: '1035921', type: 'city', name: 'Hyderabad', radius: 25 }, { key: '1738', type: 'region', name: 'Telangana' }],
  ageMin: 25, ageMax: 60, gender: 'all', dailyBudget: 500, startDate: TODAY, endDate: plusDays(7),
});

let db, graph, failOn, nextId;
function seed() {
  db = {
    plans: [{ id: 'pro', name: 'Pro', ads_enabled: true }],
    businesses: [{ id: A, name: 'Mayura', status: 'active', plan_id: 'pro', limit_overrides: {} }],
    business_ad_accounts: [{ business_id: A, ad_account_id: 'act_1111111111', currency: 'INR', access_token_enc: secrets.encrypt('EAAG-ads-token-wizard-1234'), graph_api_version: 'v26.0', page_id: '55555', page_name: 'Mayura Hospitals', max_daily_budget: 2000 }],
    business_whatsapp: [{ business_id: A, phone_number: '919701103222', phone_number_id: '222', waba_id: '922', token_last4: '9876', access_token_enc: secrets.encrypt('EAAG-wa-token-9876-long'), webhook_key: 'k'.repeat(32), graph_api_version: 'v26.0' }],
    ad_launches: [], audit_log: [], system_events: [],
  };
  graph = [];
  failOn = null;
  nextId = 100;
  limits.clearCache();
  whatsapp.clearCache();
}

const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  if (u.startsWith('https://graph.facebook.com/')) {
    const path = u.replace(/^https:\/\/graph\.facebook\.com\/[^/]+\//, '');
    const form = opts.body ? Object.fromEntries(new URLSearchParams(String(opts.body))) : null;
    graph.push({ method, path, form });
    if (method === 'GET' && path.startsWith('act_1111111111?fields=')) return json({ min_daily_budget: 9567, currency: 'INR' });
    if (method === 'GET' && path.startsWith('search?type=adgeolocation')) return json({ data: [{ key: '1035921', name: 'Hyderabad', type: 'city', region: 'Telangana', country_code: 'IN', country_name: 'India' }, { key: 'x', name: 'Odd', type: 'neighborhood' }] });
    if (method === 'GET' && path.includes('/generatepreviews')) return json({ data: [{ body: '<iframe src="https://business.facebook.com/ads/api/preview_iframe.php?d=1&amp;t=2"></iframe>' }] });
    if (method === 'POST') {
      const edge = path.split('/').pop();
      if (failOn && edge === failOn) return json({ error: { message: `(#100) Invalid ${failOn}`, code: 100 } }, 400);
      if (edge === 'adimages') return json({ images: { bytes: { hash: 'f00dfeed0123456789abcdef01234567', url: 'https://scontent.fbcdn.net/new.jpg' } } });
      if (['campaigns', 'adsets', 'adcreatives', 'ads'].includes(edge)) return json({ id: String(++nextId) });
      return json({ success: true }); // status changes
    }
    if (method === 'DELETE') return json({ success: true });
    return json({ error: { message: 'unmocked' } }, 400);
  }
  if (!u.startsWith('http://fake.supabase/rest/v1/')) return json({}, 503);
  const [path, qs = ''] = u.slice('http://fake.supabase/rest/v1/'.length).split('?');
  const p = new URLSearchParams(qs);
  const body = opts.body ? JSON.parse(opts.body) : null;
  const rows = (db[path] ||= []);
  const filt = (r) => [...p.entries()].every(([k, v]) => ['select', 'order', 'limit', 'on_conflict'].includes(k) || !v.startsWith('eq.') || String(r[k]) === v.slice(3));
  if (method === 'GET') return json(rows.filter(filt));
  if (method === 'POST') {
    if (path === 'ad_launches') {
      if (rows.some(r => r.business_id === body.business_id && r.draft_id === body.draft_id)) return json([], 201);
      const row = { id: `9${String(rows.length + 1).padStart(7, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, created_at: new Date().toISOString(), ...body };
      rows.push(row);
      return json([row], 201);
    }
    rows.push(body);
    return json([body], 201);
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
      (res) => { let t = ''; res.on('data', ch => { t += ch; }); res.on('end', () => resolve({ status: res.statusCode, text: t, json: () => JSON.parse(t) })); });
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
const posts = () => graph.filter(g => g.method === 'POST');

// ---- pure ------------------------------------------------------------------------------------
test('text check: blocks cure/guarantee claims and addressing the reader\'s health; warns on prices', () => {
  assert.deepStrictEqual(c.textCheck({ text: 'Diabetes care clinic in Hyderabad. Book a visit on WhatsApp.' }).blocks, []);
  for (const bad of ['We cure diabetes naturally', 'Guaranteed results in 30 days', '100% results', 'Are you diabetic? Message us', 'Struggling with PCOS? We can help', 'Lose 10 kg in a month', 'Reverse diabetes with our kit', 'No side effects']) {
    assert.ok(c.textCheck({ text: bad }).blocks.length > 0, bad);
  }
  assert.ok(c.textCheck({ headline: 'Is your thyroid slowing you down' }).blocks.length > 0, 'headline is checked too');
  const w = c.textCheck({ text: `Full body check-up for just ₹999. ${'x'.repeat(130)}` }).warnings;
  assert.ok(w.some(x => /price/.test(x)) && w.some(x => /125/.test(x)));
});

test('draft checks: complete draft passes; budget within Meta\'s minimum and the cap; dates; places; ages', () => {
  const lim = { minDailyBudget: 96, maxDailyBudget: 2000, today: TODAY };
  assert.deepStrictEqual(c.validateDraft(DRAFT(), lim), []);
  const bad = (patch) => c.validateDraft({ ...DRAFT(), ...patch }, lim);
  assert.match(bad({ dailyBudget: 50 }).join(), /minimum daily budget is 96/);
  assert.match(bad({ dailyBudget: 2500 }).join(), /most one ad may spend per day is 2000/);
  assert.match(bad({ startDate: plusDays(-1) }).join(), /past/);
  assert.match(bad({ endDate: TODAY }).join(), /end date must be after/);
  assert.match(bad({ locations: [] }).join(), /at least one place/);
  assert.match(bad({ locations: [{ key: '1', type: 'galaxy' }] }).join(), /not valid/);
  assert.match(bad({ locations: [{ key: '1', type: 'city', radius: 500 }] }).join(), /17 to 80 km/);
  assert.match(bad({ ageMin: 16 }).join(), /18 and 65/);
  assert.match(bad({ imageHash: '' }).join(), /picture/);
  assert.match(bad({ draftId: 'nope' }).join(), /start again/);
});

test('targeting: cities with a radius in km, regions, PIN codes, countries, gender', () => {
  const t = c.targetingFor({ ...DRAFT(), locations: [...DRAFT().locations, { key: '500001', type: 'zip' }, { key: 'IN', type: 'country', countryCode: 'IN' }], gender: 'female' });
  assert.deepStrictEqual(t, {
    geo_locations: { cities: [{ key: '1035921', radius: 25, distance_unit: 'kilometer' }], regions: [{ key: '1738' }], zips: [{ key: '500001' }], countries: ['IN'] },
    age_min: 25, age_max: 60, genders: [2],
  });
});

// ---- creating ------------------------------------------------------------------------------------
test('create: campaign -> ad set -> creative -> ad, all PAUSED, WhatsApp destination to our number', async () => {
  const r = await request('POST', '/api/ads/create', 'owner', DRAFT());
  assert.strictEqual(r.status, 200, r.text);
  const ps = posts();
  assert.deepStrictEqual(ps.map(g => g.path), ['act_1111111111/campaigns', 'act_1111111111/adsets', 'act_1111111111/adcreatives', 'act_1111111111/ads']);
  const [camp, adset, creative, ad] = ps.map(g => g.form);
  assert.deepStrictEqual([camp.objective, camp.status, camp.special_ad_categories], ['OUTCOME_ENGAGEMENT', 'PAUSED', '[]']);
  assert.deepStrictEqual([adset.status, adset.destination_type, adset.optimization_goal, adset.billing_event, adset.daily_budget, adset.campaign_id], ['PAUSED', 'WHATSAPP', 'CONVERSATIONS', 'IMPRESSIONS', '50000', '101']);
  assert.deepStrictEqual(JSON.parse(adset.promoted_object), { page_id: '55555', whatsapp_phone_number: '+919701103222' });
  assert.deepStrictEqual(JSON.parse(adset.targeting).geo_locations.cities, [{ key: '1035921', radius: 25, distance_unit: 'kilometer' }]);
  assert.strictEqual(adset.end_time, `${plusDays(7)}T23:59:00+0530`);
  const story = JSON.parse(creative.object_story_spec);
  assert.strictEqual(story.page_id, '55555');
  assert.deepStrictEqual(story.link_data.call_to_action, { type: 'WHATSAPP_MESSAGE', value: { app_destination: 'WHATSAPP' } });
  assert.deepStrictEqual([story.link_data.link, story.link_data.name, story.link_data.page_welcome_message], ['https://api.whatsapp.com/send', 'Book your free check-up', 'Hi! I want to book the eye camp.']);
  assert.deepStrictEqual([JSON.parse(ad.creative), ad.adset_id, ad.status], [{ creative_id: '103' }, '102', 'PAUSED']);
  const row = db.ad_launches[0];
  assert.deepStrictEqual([row.status, row.campaign_id, row.adset_id, row.creative_id, row.ad_id, row.created_by, row.daily_budget], ['created', '101', '102', '103', '104', 'owner1@x.test', 500]);
  assert.ok(!JSON.stringify(row.spec).includes('base64'), 'no image bytes stored');
  assert.ok(db.audit_log.some(a => a.action === 'ads.ad_created'));
});

test('the same draft twice (double click / retry) makes ONE ad', async () => {
  await request('POST', '/api/ads/create', 'owner', DRAFT());
  const n = posts().length;
  const again = await request('POST', '/api/ads/create', 'owner', DRAFT());
  assert.strictEqual(again.status, 200);
  assert.strictEqual(again.json().repeated, true);
  assert.strictEqual(posts().length, n, 'no new requests to Meta');
  assert.strictEqual(db.ad_launches.length, 1);
});

test('Meta refuses a step: what was made is deleted again, the draft is marked failed', async () => {
  failOn = 'adcreatives';
  const r = await request('POST', '/api/ads/create', 'owner', DRAFT());
  assert.strictEqual(r.status, 502);
  assert.match(r.json().error, /Meta refused the picture and text: \(#100\) Invalid adcreatives/);
  assert.deepStrictEqual(graph.filter(g => g.method === 'DELETE').map(g => g.path), ['102', '101'], 'ad set, then campaign');
  assert.strictEqual(posts().some(g => g.path.endsWith('/ads')), false);
  assert.strictEqual(db.ad_launches[0].status, 'failed');
  assert.ok(db.system_events.some(e => e.code === 'ad_create_failed'));
});

test('nothing reaches Meta when the text, budget or Page is wrong', async () => {
  const cure = await request('POST', '/api/ads/create', 'owner', { ...DRAFT(), text: 'We cure thyroid problems' });
  assert.strictEqual(cure.status, 400);
  assert.match(cure.json().error, /cure/);
  assert.strictEqual((await request('POST', '/api/ads/create', 'owner', { ...DRAFT(), dailyBudget: 5000 })).status, 400);
  db.business_ad_accounts[0].page_id = null;
  assert.match((await request('POST', '/api/ads/create', 'owner', DRAFT())).json().error, /Choose the Facebook Page/);
  assert.strictEqual(posts().length, 0);
  assert.strictEqual(db.ad_launches.length, 0);
});

test('launch: type the daily budget; campaign, ad set and ad are switched on; once', async () => {
  await request('POST', '/api/ads/create', 'owner', DRAFT());
  const id = db.ad_launches[0].id;
  assert.match((await request('POST', `/api/ads/launches/${id}/launch`, 'owner', { confirmBudget: 50 })).json().error, /Type the daily budget \(500\)/);
  graph = [];
  const r = await request('POST', `/api/ads/launches/${id}/launch`, 'owner', { confirmBudget: 500 });
  assert.strictEqual(r.status, 200, r.text);
  assert.deepStrictEqual(posts().map(g => [g.path, g.form.status]), [['101', 'ACTIVE'], ['102', 'ACTIVE'], ['104', 'ACTIVE']]);
  assert.deepStrictEqual([db.ad_launches[0].status, db.ad_launches[0].launched_by], ['launched', 'owner1@x.test']);
  assert.ok(db.audit_log.some(a => a.action === 'ads.ad_launched'));
  graph = [];
  assert.strictEqual((await request('POST', `/api/ads/launches/${id}/launch`, 'owner', { confirmBudget: 500 })).json().already, true);
  assert.strictEqual(posts().length, 0);
});

test('who: only the Business Admin creates, uploads and launches; managers see the list; agents and other businesses nothing', async () => {
  await request('POST', '/api/ads/create', 'owner', DRAFT());
  const id = db.ad_launches[0].id;
  assert.strictEqual((await request('POST', '/api/ads/create', 'manager', { ...DRAFT(), draftId: '22222222-2222-4333-8444-555555555555' })).status, 403);
  assert.strictEqual((await request('POST', `/api/ads/launches/${id}/launch`, 'manager', { confirmBudget: 500 })).status, 403);
  assert.strictEqual((await request('POST', '/api/ads/create/image', 'manager', { base64: 'iVBOR' })).status, 403);
  const list = await request('GET', '/api/ads/launches', 'manager');
  assert.deepStrictEqual(list.json().launches.map(l => l.name), ['Eye camp']);
  assert.strictEqual((await request('GET', '/api/ads/launches', 'agent')).status, 403);
  assert.notStrictEqual((await request('POST', `/api/ads/launches/${id}/launch`, 'other', { confirmBudget: 500 })).status, 200);
});

test('picture upload: JPG/PNG only, sent to Meta as bytes; places search keeps cities, regions, PINs, countries', async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const ok = await request('POST', '/api/ads/create/image', 'owner', { base64: `data:image/png;base64,${png}` });
  assert.strictEqual(ok.status, 200, ok.text);
  assert.deepStrictEqual(ok.json(), { success: true, imageHash: 'f00dfeed0123456789abcdef01234567', imageUrl: 'https://scontent.fbcdn.net/new.jpg' });
  assert.strictEqual(posts().at(-1).form.bytes, png);
  assert.match((await request('POST', '/api/ads/create/image', 'owner', { base64: Buffer.from('GIF89a-not-allowed').toString('base64') })).json().error, /JPG or PNG/);
  // A near-1 MB picture is ~1.4 MB of text: this route accepts it (other routes stop at 1 MB).
  const big = await request('POST', '/api/ads/create/image', 'owner', { base64: 'A'.repeat(1_350_000) });
  assert.notStrictEqual(big.status, 413, 'the larger limit applies to the picture route');
  assert.match(big.json().error, /JPG or PNG/);
  assert.strictEqual((await request('POST', '/api/ads/create/preview', 'owner', { ...DRAFT(), pad: 'A'.repeat(1_200_000) })).status, 413, 'other routes keep 1 MB');
  const places = (await request('GET', '/api/ads/create/locations?q=hyder', 'owner')).json().locations;
  assert.deepStrictEqual(places.map(p => [p.name, p.type, p.region]), [['Hyderabad', 'city', 'Telangana']]);
});

test('preview: Meta\'s rendering of the draft (business.facebook.com only) plus the text check', async () => {
  const r = (await request('POST', '/api/ads/create/preview', 'owner', { ...DRAFT(), text: 'Are you diabetic? Message us' })).json();
  assert.strictEqual(r.frameUrl, 'https://business.facebook.com/ads/api/preview_iframe.php?d=1&t=2');
  assert.ok(r.check.blocks.length > 0);
  assert.ok(graph.some(g => g.path.includes('/generatepreviews') && g.path.includes('WHATSAPP_MESSAGE')));
});

test('migration: ad_launches is server-only, one row per draft, known states only', async () => {
  const pg = await freshDb();
  const sql = require('fs').readFileSync(require('path').join(__dirname, '..', 'supabase', 'migrations', '20261121_ads_d2_launches.sql'), 'utf8');
  await pg.exec(sql);
  const ins = "insert into public.ad_launches (business_id, draft_id, created_by, name, daily_budget, status) values ($1, '11111111-2222-4333-8444-555555555555', 'a@x', 'Ad', 500, $2)";
  await pg.query(ins, [A, 'created']);
  await assert.rejects(pg.query(ins, [A, 'created']), /duplicate|unique/i);
  await assert.rejects(pg.query(ins.replace('1111', '9999'), [A, 'weird']));
});
