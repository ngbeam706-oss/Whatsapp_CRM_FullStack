// Ads phase G: G1 ads that run only in business hours (Meta's ad set schedule, which needs a budget for the whole
// run), G2 editing an ad made in the CRM (words / picture -> a new creative that Meta reviews; audience, budget,
// end date and hours -> the ad set). Business Admin only, own business only, bigger budgets typed again, audited.
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
const OTHER_LAUNCH = '9b000000-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const day = (n) => new Date(Date.now() + 330 * 60000 + n * 86400000).toISOString().slice(0, 10);
const SPEC = () => ({
  text: 'Free eye check-up camp this weekend. Message us to book.', headline: 'Book a slot', greeting: 'Hi! I saw your ad.', imageHash: 'a'.repeat(32), imageUrl: 'https://scontent.example/pic.jpg',
  locations: [{ key: '1035921', type: 'city', name: 'Hyderabad', radius: 25 }], ageMin: 25, ageMax: 60, gender: 'all', placement: 'auto',
  startDate: day(-3), endDate: day(20), number: '919000000500', useInstagram: false, schedule: null,
});
let db, graph, meta;
function seed() {
  db = {
    plans: [{ id: 'pro', name: 'Pro', ads_enabled: true }],
    businesses: [{ id: A, name: 'Clinic', status: 'active', plan_id: 'pro', limit_overrides: {}, industry: 'hospital', send_window_start: 9, send_window_end: 20 },
      { id: B2, name: 'Other', status: 'active', plan_id: 'pro', limit_overrides: {}, industry: 'food' }],
    business_ad_accounts: [{ business_id: A, ad_account_id: ACCOUNT, currency: 'INR', access_token_enc: secrets.encrypt('EAAG-ads-token-g-1234'), graph_api_version: 'v26.0', page_id: '55555', page_name: 'Page', max_daily_budget: 2000, last_sync_at: new Date().toISOString(), connected_at: '2026-11-01T00:00:00Z' },
      { business_id: B2, ad_account_id: 'act_2222222222', currency: 'INR', access_token_enc: secrets.encrypt('EAAG-ads-token-g-5678'), graph_api_version: 'v26.0', page_id: '66666', max_daily_budget: 2000 }],
    business_whatsapp: [{ business_id: A, phone_number: '919000000500', phone_number_id: '555000000000001', waba_id: '955000000000001', token_last4: '1234', access_token_enc: secrets.encrypt('EAAG-wa-token-clinic-long'), webhook_key: 'g'.repeat(32), graph_api_version: 'v26.0' }],
    ad_launches: [
      { id: LAUNCH, business_id: A, draft_id: '9c000000-aaaa-4aaa-8aaa-aaaaaaaaaaa3', created_by: 'owner1@g.test', name: 'Eye camp', spec: SPEC(), daily_budget: 500, currency: 'INR', status: 'launched', campaign_id: '700', adset_id: '701', creative_id: '702', ad_id: '703' },
      { id: OTHER_LAUNCH, business_id: B2, draft_id: '9d000000-aaaa-4aaa-8aaa-aaaaaaaaaaa4', created_by: 'x@o.test', name: 'Theirs', spec: SPEC(), daily_budget: 500, currency: 'INR', status: 'launched', campaign_id: '800', adset_id: '801', creative_id: '802', ad_id: '803' },
    ],
    audit_log: [], system_events: [], whatsapp_numbers: [],
  };
  graph = [];
  meta = { failCreative: false };
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
    if (method === 'GET' && path.startsWith('701?fields=account_id')) return json({ account_id: '1111111111', name: 'Eye camp – audience', lifetime_budget: '360000', daily_budget: '0', campaign_id: '700' });
    if (method === 'POST' && path.endsWith('/adcreatives') && meta.failCreative) return json({ error: { message: 'Image is too small', code: 100 } }, 400);
    if (method === 'POST' && ['campaigns', 'adsets', 'adcreatives', 'ads'].includes(path.split('/').pop())) return json({ id: String(nextId++) });
    if (method === 'POST' && /^\d+$/.test(path)) return json({ success: true });
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
const who = (n, role) => ({ id: `d0000000-0000-4000-8000-00000000007${n}`, email: `${role}${n}@g.test`, role, businessId: A, businessName: 'x' });
_setStaffForToken('g-owner', who(1, 'owner'));
_setStaffForToken('g-manager', who(2, 'manager'));
_setStaffForToken('g-agent', who(3, 'agent'));
const launchRow = () => db.ad_launches.find(l => l.id === LAUNCH);
const posts = () => graph.filter(g => g.method === 'POST');

// ---- G1 pure -----------------------------------------------------------------------------------------------
test('G1 pure: schedule checked and cleaned; scheduled days counted; Meta\'s schedule; a readable label', () => {
  assert.deepStrictEqual(c.checkSchedule({ days: [6, 1, 1, 2], startHour: 9, endHour: 20 }), { schedule: { days: [1, 2, 6], startHour: 9, endHour: 20 } });
  assert.match(c.checkSchedule({ days: [], startHour: 9, endHour: 20 }).error, /at least one day/);
  assert.match(c.checkSchedule({ days: [1], startHour: 20, endHour: 9 }).error, /end after the start/);
  assert.match(c.checkSchedule({ days: [1], startHour: 9.5, endHour: 12 }).error, /whole hours/);
  // 2026-11-16 is a Monday: Mon..Sun = 7 days, Mon-Sat = 6.
  assert.strictEqual(c.scheduledDays('2026-11-16', '2026-11-22', [1, 2, 3, 4, 5, 6]), 6);
  assert.strictEqual(c.scheduledDays('2026-11-16', '2026-11-22', [0]), 1);
  assert.deepStrictEqual(c.adsetScheduleOf({ days: [1, 2], startHour: 9, endHour: 20 }), [{ start_minute: 540, end_minute: 1200, days: [1, 2], timezone_type: 'ADVERTISER' }]);
  assert.strictEqual(c.scheduleLabel({ days: [1, 2, 3, 4, 5, 6], startHour: 9, endHour: 20 }), 'Mon, Tue, Wed, Thu, Fri, Sat, 9am–8pm');
  assert.strictEqual(c.lifetimeBudgetOf(500, { startDate: '2026-11-16', endDate: '2026-11-22', schedule: { days: [1, 2, 3, 4, 5, 6] } }), 3000);
});

test('G1 validation: business hours need an end date, a chosen day inside the run and Meta\'s minimum for the run', () => {
  const draft = { draftId: LAUNCH, name: 'Eye camp', imageHash: 'a'.repeat(32), text: 'Book a free check-up.', locations: SPEC().locations, dailyBudget: 500, startDate: '2026-11-16', schedule: { days: [1, 2, 3, 4, 5, 6], startHour: 9, endHour: 20 } };
  const lim = { minDailyBudget: 96, maxDailyBudget: 2000, today: '2026-11-15' };
  assert.match(c.validateDraft(draft, lim).join(' '), /needs an end date/);
  assert.deepStrictEqual(c.validateDraft({ ...draft, endDate: '2026-11-22' }, lim), []);
  assert.match(c.validateDraft({ ...draft, endDate: '2026-11-22', schedule: { days: [0], startHour: 9, endHour: 20 } }, { ...lim, minDailyBudget: 96 }).join(' '), /Meta needs at least 672 for the whole run/);
  assert.match(c.validateDraft({ ...draft, startDate: '2026-11-16', endDate: '2026-11-17', schedule: { days: [5], startHour: 9, endHour: 20 } }, lim).join(' '), /None of the chosen days/);
  // Editing a running ad: its start is in the past (fine), but the end can't be.
  assert.deepStrictEqual(c.validateDraft({ ...draft, startDate: '2026-11-10', endDate: '2026-11-22' }, { ...lim, editing: true }), []);
  assert.match(c.validateDraft({ ...draft, startDate: '2026-11-01', endDate: '2026-11-12' }, { ...lim, editing: true }).join(' '), /end date can't be in the past/);
});

test('G1 create: a business-hours ad gets a budget for the whole run, day parting and Meta\'s schedule; all-day ads unchanged', async () => {
  const draft = { draftId: '9f000000-aaaa-4aaa-8aaa-aaaaaaaaaaa5', name: 'Evening OPD', imageHash: 'b'.repeat(32), text: 'Book your OPD visit on WhatsApp.', locations: SPEC().locations, ageMin: 25, ageMax: 60, gender: 'all',
    dailyBudget: 500, startDate: day(1), endDate: day(7), schedule: { days: [0, 1, 2, 3, 4, 5, 6], startHour: 10, endHour: 19 } };
  const r = await request('POST', '/api/ads/create', 'g-owner', draft);
  assert.strictEqual(r.status, 200, JSON.stringify(r.json()));
  const adset = posts().find(g => g.path.endsWith('/adsets')).form;
  assert.strictEqual(adset.daily_budget, undefined);
  assert.strictEqual(adset.lifetime_budget, String(500 * 7 * 100), '7 days x ₹500, in paise');
  assert.deepStrictEqual(JSON.parse(adset.pacing_type), ['day_parting']);
  assert.deepStrictEqual(JSON.parse(adset.adset_schedule), [{ start_minute: 600, end_minute: 1140, days: [0, 1, 2, 3, 4, 5, 6], timezone_type: 'ADVERTISER' }]);
  assert.ok(adset.end_time);
  const saved = db.ad_launches.at(-1);
  assert.deepStrictEqual(saved.spec.schedule, { days: [0, 1, 2, 3, 4, 5, 6], startHour: 10, endHour: 19 });
  assert.strictEqual(Number(saved.daily_budget), 500);

  graph = [];
  const plain = await request('POST', '/api/ads/create', 'g-owner', { ...draft, draftId: '9f000000-aaaa-4aaa-8aaa-aaaaaaaaaaa6', schedule: null, endDate: '' });
  assert.strictEqual(plain.status, 200, JSON.stringify(plain.json()));
  const adset2 = posts().find(g => g.path.endsWith('/adsets')).form;
  assert.deepStrictEqual([adset2.daily_budget, adset2.lifetime_budget, adset2.adset_schedule], ['50000', undefined, undefined]);
});

// ---- G2 ---------------------------------------------------------------------------------------------------
test('G2 pure: what can and can\'t change after creation', () => {
  const old = SPEC();
  assert.match(c.applyEdit(old, { schedule: { days: [1], startHour: 9, endHour: 18 } }).error, /runs all day/);
  assert.match(c.applyEdit({ ...old, schedule: { days: [1], startHour: 9, endHour: 18 } }, { schedule: null }).error, /runs in set hours/);
  assert.match(c.applyEdit(old, { endDate: '' }).error, /moved, not removed/);
  const carousel = { ...old, cards: [{ imageHash: 'c'.repeat(32) }, { imageHash: 'd'.repeat(32) }] };
  assert.match(c.applyEdit(carousel, { imageHash: 'e'.repeat(32) }).error, /carousel can't be changed/);
  assert.deepStrictEqual(c.applyEdit(carousel, { cards: [{ headline: 'One' }, { headline: 'Two' }] }).next.cards.map(x => x.headline), ['One', 'Two']);
  assert.strictEqual(c.applyEdit(old, { number: '919999999999', unknown: 1 }).next.number, old.number, 'the number the ad opens is never changed');
});

test('G2 who: only the Business Admin edits, and only ads of their own business', async () => {
  for (const t of ['g-manager', 'g-agent']) assert.strictEqual((await request('PUT', `/api/ads/launches/${LAUNCH}`, t, { text: 'New words here.' })).status, 403);
  const theirs = await request('PUT', `/api/ads/launches/${OTHER_LAUNCH}`, 'g-owner', { text: 'New words here.' });
  assert.strictEqual(theirs.status, 404);
  assert.strictEqual(posts().length, 0, 'nothing sent to Meta');
  db.ad_launches[0].status = 'failed';
  assert.match((await request('PUT', `/api/ads/launches/${LAUNCH}`, 'g-owner', { text: 'New words here.' })).json().error, /created completely/);
});

test('G2 words: a new creative is put on the same ad (Meta reviews it); the ad set is untouched; blocked claims refused', async () => {
  const bad = await request('PUT', `/api/ads/launches/${LAUNCH}`, 'g-owner', { text: 'Guaranteed cure for diabetes!' });
  assert.strictEqual(bad.status, 400);
  assert.strictEqual(posts().length, 0);
  const r = await request('PUT', `/api/ads/launches/${LAUNCH}`, 'g-owner', { text: 'Free eye check-up camp on Sunday. Message us to book.', greeting: 'Hi! I want to book.' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json()));
  assert.deepStrictEqual([r.json().changed, r.json().review], [['words or picture'], true]);
  const calls = posts().map(g => g.path);
  assert.deepStrictEqual(calls, [`${ACCOUNT}/adcreatives`, '703']);
  assert.match(JSON.parse(posts()[0].form.object_story_spec).link_data.message, /on Sunday/);
  assert.match(posts()[1].form.creative, /"creative_id":"\d+"/);
  assert.strictEqual(launchRow().spec.greeting, 'Hi! I want to book.');
  assert.notStrictEqual(launchRow().creative_id, '702');
  assert.deepStrictEqual(db.audit_log.at(-1).details.changed, ['words or picture']);
});

test('G2 audience and dates: only the ad set changes; nothing changed answers "unchanged"', async () => {
  const same = await request('PUT', `/api/ads/launches/${LAUNCH}`, 'g-owner', { text: SPEC().text });
  assert.strictEqual(same.json().unchanged, true);
  assert.strictEqual(posts().length, 0);
  const r = await request('PUT', `/api/ads/launches/${LAUNCH}`, 'g-owner', { ageMin: 30, gender: 'female', endDate: day(30) });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json()));
  assert.deepStrictEqual(posts().map(g => g.path), ['701']);
  const f = posts()[0].form;
  assert.deepStrictEqual([JSON.parse(f.targeting).age_min, JSON.parse(f.targeting).genders, f.end_time.slice(0, 10), f.daily_budget], [30, [2], day(30), undefined]);
  assert.deepStrictEqual(r.json().changed, ['audience', 'end date']);
});

test('G2 budget: more money needs the amount typed again, within the cap; business-hours ads get a new whole-run budget', async () => {
  const noConfirm = await request('PUT', `/api/ads/launches/${LAUNCH}`, 'g-owner', { dailyBudget: 800 });
  assert.match(noConfirm.json().error, /Type the new daily amount \(800\)/);
  assert.strictEqual(noConfirm.json().needsConfirm, true);
  assert.match((await request('PUT', `/api/ads/launches/${LAUNCH}`, 'g-owner', { dailyBudget: 5000, confirmBudget: 5000 })).json().error, /most one ad may spend per day is 2000/);
  assert.strictEqual(posts().length, 0);
  const ok = await request('PUT', `/api/ads/launches/${LAUNCH}`, 'g-owner', { dailyBudget: 800, confirmBudget: 800 });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.json()));
  assert.deepStrictEqual(posts().map(g => [g.path, g.form.daily_budget]), [['701', '80000']]);
  assert.strictEqual(Number(launchRow().daily_budget), 800);
  // Lowering needs no confirmation.
  assert.strictEqual((await request('PUT', `/api/ads/launches/${LAUNCH}`, 'g-owner', { dailyBudget: 300 })).status, 200);

  // A business-hours ad: new hours and amount -> a new whole-run budget and schedule.
  graph = [];
  const sched = { days: [1, 2, 3, 4, 5, 6], startHour: 9, endHour: 20 };
  launchRow().spec = { ...SPEC(), startDate: '2026-11-16', endDate: '2026-11-29', schedule: sched };
  launchRow().daily_budget = 500;
  const r = await request('PUT', `/api/ads/launches/${LAUNCH}`, 'g-owner', { schedule: { ...sched, endHour: 18 }, dailyBudget: 400 });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json()));
  const f = posts()[0].form;
  assert.strictEqual(f.lifetime_budget, String(400 * 12 * 100), 'Mon-Sat over two weeks = 12 days');
  assert.deepStrictEqual(JSON.parse(f.adset_schedule)[0].end_minute, 1080);
  assert.strictEqual(f.daily_budget, undefined);
  assert.deepStrictEqual(r.json().changed, ['budget', 'hours']);
});

test('G2 partial failure: if Meta refuses the new picture, the saved audience change is kept and said so', async () => {
  meta.failCreative = true;
  const r = await request('PUT', `/api/ads/launches/${LAUNCH}`, 'g-owner', { text: 'Book your Sunday eye camp slot on WhatsApp.', ageMin: 40 });
  assert.strictEqual(r.status, 502);
  assert.match(r.json().error, /refused the new words.*audience, budget and dates were saved/);
  assert.strictEqual(launchRow().spec.ageMin, 40);
  assert.strictEqual(launchRow().spec.text, SPEC().text, 'the words stay as Meta has them');
  assert.strictEqual(launchRow().creative_id, '702');
});

test('Results budget control points business-hours ads (a whole-run budget) to Edit', async () => {
  const r = await request('GET', '/api/ads/adsets/701/budget', 'g-manager');
  assert.strictEqual(r.status, 400);
  assert.match(r.json().error, /one budget for its whole run.*"Edit" under Create WhatsApp ads/);
});

test('the list gives the Edit dialog the whole saved ad and a readable schedule', async () => {
  launchRow().spec = { ...SPEC(), schedule: { days: [1, 2, 3, 4, 5], startHour: 9, endHour: 18 } };
  const r = await request('GET', '/api/ads/launches', 'g-manager');
  const mine = r.json().launches.find(l => l.id === LAUNCH);
  assert.strictEqual(mine.scheduleLabel, 'Mon, Tue, Wed, Thu, Fri, 9am–6pm');
  assert.deepStrictEqual(mine.spec.locations, SPEC().locations);
  assert.deepStrictEqual(mine.template.schedule, { days: [1, 2, 3, 4, 5], startHour: 9, endHour: 18 });
  assert.ok(!r.json().launches.some(l => l.id === OTHER_LAUNCH), 'another business\'s ads never listed');
});
