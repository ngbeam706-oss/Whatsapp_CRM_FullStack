// Ads phase E (docs/progress/ads-module.md): E1 bookings back to Meta (Conversions API for business messaging),
// E2 choosing the WhatsApp number per ad, E3 placements incl. WhatsApp Status (not for healthcare), E4 carousel.
// Everything plugs into the existing flow: nothing changes unless switched on / chosen.
// Fake database + fake Meta Graph API, plus the real migration on PGlite.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const A = 'a0000000-0000-4000-8000-000000000001'; // Mayura (hospital)
const F = 'f0000000-0000-4000-8000-000000000006'; // a food business
const B = 'b0000000-0000-4000-8000-000000000002'; // another business
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
const conv = require('../server/adConversions.cjs');
const { _setStaffForToken } = require('../server/auth.cjs');
const { freshDb, asUser } = require('./helpers/pgHarness.cjs');

const TODAY = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const CUSTOMER = '919381619750';
const CLID = 'ARAkLkA8rmlFeiCktEJQ-QTwRiyYHAFDLMNDBH0CD3qpjd0HR4irJ6LEkR7JwFF4XvnO2E4Nx0-eM-GABDLOPaOdRMv-_zfUQ2a';
const DRAFT = (patch = {}) => ({
  draftId: '11111111-2222-4333-8444-555555555555', name: 'Offer', imageHash: 'abcdef0123456789abcdef0123456789',
  text: 'Weekend offer. Message us on WhatsApp to order.', headline: 'Order now', greeting: 'Hi!',
  locations: [{ key: '1035921', type: 'city', name: 'Hyderabad', radius: 25 }], ageMin: 18, ageMax: 65, gender: 'all',
  dailyBudget: 500, startDate: TODAY, endDate: '', ...patch,
});

let db, graph, metaFail, nextId;
const waRow = (biz, num, pid, waba, token) => ({ business_id: biz, phone_number: num, phone_number_id: pid, waba_id: waba, token_last4: '1234', access_token_enc: secrets.encrypt(token), webhook_key: String(pid).padEnd(32, '0').slice(0, 32), graph_api_version: 'v26.0' });
function seed() {
  db = {
    plans: [{ id: 'pro', name: 'Pro', ads_enabled: true }],
    businesses: [
      { id: A, name: 'Mayura', status: 'active', plan_id: 'pro', limit_overrides: {}, industry: 'hospital' },
      { id: F, name: 'Food Co', status: 'active', plan_id: 'pro', limit_overrides: {}, industry: 'food' },
      { id: B, name: 'Other', status: 'active', plan_id: 'pro', limit_overrides: {}, industry: 'retail' },
    ],
    business_ad_accounts: [A, F].map(id => ({ business_id: id, ad_account_id: 'act_1111111111', currency: 'INR', access_token_enc: secrets.encrypt('EAAG-ads-token-e-1234'), graph_api_version: 'v26.0', page_id: '55555', page_name: 'Page', max_daily_budget: 2000 })),
    business_whatsapp: [waRow(A, '919701103222', '222000000000001', '922000000000001', 'EAAG-wa-token-mayura-long'), waRow(F, '919000000500', '555000000000001', '955000000000001', 'EAAG-wa-token-food-long'), waRow(B, '919000000900', '999000000000001', '999900000000001', 'EAAG-wa-token-other-long')],
    whatsapp_numbers: [{ business_id: A, phone_number_id: '222000000000002', phone_number: '919701103223', waba_id: '922000000000001', label: 'Pharmacy', status: 'active', created_at: '2026-11-10T00:00:00Z' }],
    whatsapp_leads: [],
    ad_launches: [], ad_conversion_settings: [], ad_conversion_datasets: [], ad_conversions: [],
    audit_log: [], system_events: [],
  };
  graph = []; metaFail = {}; nextId = 100;
  limits.clearCache(); whatsapp.clearCache();
}

const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  if (u.startsWith('https://graph.facebook.com/')) {
    const path = u.replace(/^https:\/\/graph\.facebook\.com\/[^/]+\//, '');
    let body = null;
    try { body = opts.body ? JSON.parse(String(opts.body)) : null; } catch { body = Object.fromEntries(new URLSearchParams(String(opts.body))); }
    graph.push({ method, path, body, token: String(opts.headers?.Authorization || '').replace('Bearer ', '') });
    const edge = path.split('?')[0].split('/').pop();
    if (metaFail[edge]) return json(metaFail[edge], 400);
    if (method === 'GET' && path.startsWith('act_1111111111?fields=')) return json({ min_daily_budget: 9567, currency: 'INR', account_status: 1 });
    if (method === 'GET' && path.startsWith('55555?fields=whatsapp_number')) return json({ whatsapp_number: '+91 97011 03222' });
    if (method === 'GET' && path.startsWith('me/permissions')) return json({ data: [] });
    if (method === 'GET' && path.includes('/promote_pages')) return json({ data: [{ id: '55555', name: 'Page' }] });
    if (method === 'POST' && edge === 'dataset') return json({ id: `77${path.split('/')[0].slice(-10)}` });
    if (method === 'POST' && edge === 'events') return json({ events_received: 1, fbtrace_id: 'x' });
    if (method === 'POST' && ['campaigns', 'adsets', 'adcreatives', 'ads'].includes(edge)) return json({ id: String(++nextId) });
    if (method === 'DELETE') return json({ success: true });
    return json({ success: true });
  }
  if (!u.startsWith('http://fake.supabase/rest/v1/')) return json({}, 503);
  const [path, qs = ''] = u.slice('http://fake.supabase/rest/v1/'.length).split('?');
  const p = [...new URLSearchParams(qs).entries()];
  const body = opts.body ? JSON.parse(opts.body) : null;
  const rows = (db[path] ||= []);
  const filt = (r) => p.every(([k, v]) => {
    if (['select', 'order', 'limit', 'on_conflict', 'offset'].includes(k)) return true;
    if (v.startsWith('eq.')) return String(r[k]) === v.slice(3);
    if (v.startsWith('gte.')) return String(r[k] || '') >= v.slice(4);
    return true;
  });
  if (method === 'GET') return json(rows.filter(filt));
  if (method === 'POST') {
    const list = (Array.isArray(body) ? body : [body]).map(x => ({ ...x }));
    for (const r of list) {
      if (path === 'ad_conversions') {
        if (rows.some(x => x.business_id === r.business_id && x.phone === r.phone && x.ctwa_clid === r.ctwa_clid && x.event_name === r.event_name)) continue;
        Object.assign(r, { id: rows.length + 1, status: 'pending', attempts: 0, created_at: r.created_at || new Date().toISOString(), event_time: r.event_time || new Date().toISOString() });
      }
      if (path === 'ad_conversion_settings' || path === 'ad_conversion_datasets') {
        const ex = rows.find(x => x.business_id === r.business_id && (path === 'ad_conversion_settings' || x.waba_id === r.waba_id));
        if (ex) { if (path === 'ad_conversion_settings') Object.assign(ex, r); continue; }
      }
      if (path === 'ad_launches') {
        if (rows.some(x => x.business_id === r.business_id && x.draft_id === r.draft_id)) return json([], 201);
        r.id = `9${String(rows.length + 1).padStart(7, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
      }
      rows.push(r);
    }
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
const who = (n, role, biz = A) => ({ id: `d0000000-0000-4000-8000-00000000001${n}`, email: `${role}${n}@x.test`, role, businessId: biz, businessName: 'x' });
_setStaffForToken('e-owner', who(1, 'owner'));
_setStaffForToken('e-manager', who(2, 'manager'));
_setStaffForToken('e-agent', who(3, 'agent'));
_setStaffForToken('e-food', who(4, 'owner', F));
const adLead = (patch = {}) => ({ business_id: A, phone: CUSTOMER, name: 'Lakshmi', stage: 'interested', assigned_to: null, tags: [], referral: { source_type: 'ad', source_id: '120200', ctwa_clid: CLID }, ...patch });
const on = (biz = A, extra = {}) => db.ad_conversion_settings.push({ business_id: biz, enabled: true, booking_value: null, currency: 'INR', ...extra });

// ---- E1: bookings back to Meta --------------------------------------------------------------------------
test('E1 pure: the event Meta gets carries only the ad click id; Purchase only with a value', () => {
  assert.strictEqual(conv.eventFor(null), 'LeadSubmitted');
  assert.strictEqual(conv.eventFor(800), 'Purchase');
  assert.strictEqual(conv.clickIdOf({ ctwa_clid: CLID }), CLID);
  assert.strictEqual(conv.clickIdOf({ source_type: 'post' }), null);
  assert.strictEqual(conv.clickIdOf(null), null);
  const p = conv.eventPayload({ event_name: 'Purchase', value: 800, currency: 'INR', ctwa_clid: CLID, event_time: '2026-11-11T10:00:00Z', phone: CUSTOMER }, '922000000000001');
  assert.deepStrictEqual(p, { data: [{
    event_name: 'Purchase', event_time: Math.floor(Date.parse('2026-11-11T10:00:00Z') / 1000), action_source: 'business_messaging', messaging_channel: 'whatsapp',
    user_data: { whatsapp_business_account_id: '922000000000001', ctwa_clid: CLID }, custom_data: { currency: 'INR', value: 800 },
  }] });
  assert.doesNotMatch(JSON.stringify(p), new RegExp(CUSTOMER), 'never the customer\'s number');
  assert.strictEqual(conv.eventPayload({ event_name: 'LeadSubmitted', ctwa_clid: CLID, created_at: '2026-11-11T10:00:00Z' }, '1').data[0].custom_data, undefined);
});

test('E1: moving an ad chat to Booked queues ONE event when switched on; never otherwise', async () => {
  db.whatsapp_leads.push(adLead());
  // Off (default): nothing.
  assert.strictEqual((await request('PATCH', `/api/inbox/${CUSTOMER}`, 'e-owner', { stage: 'ordered' })).status, 200);
  assert.strictEqual(db.ad_conversions.length, 0);
  db.whatsapp_leads[0].stage = 'interested';

  on();
  await request('PATCH', `/api/inbox/${CUSTOMER}`, 'e-owner', { stage: 'interested' }); // not a booking
  assert.strictEqual(db.ad_conversions.length, 0);
  await request('PATCH', `/api/inbox/${CUSTOMER}`, 'e-owner', { stage: 'ordered' });
  await request('PATCH', `/api/inbox/${CUSTOMER}`, 'e-owner', { stage: 'completed' }); // same click, same event: once
  assert.deepStrictEqual(db.ad_conversions.map(x => [x.business_id, x.phone, x.ctwa_clid, x.event_name, x.stage]), [[A, CUSTOMER, CLID, 'LeadSubmitted', 'ordered']]);

  // A chat that didn't come from a Click-to-WhatsApp ad: nothing to report.
  db.whatsapp_leads.push(adLead({ phone: '919000000077', referral: null }));
  await request('PATCH', '/api/inbox/919000000077', 'e-owner', { stage: 'ordered' });
  assert.strictEqual(db.ad_conversions.length, 1);
});

test('E1: the bot\'s Book / Enquire counts too, and a broken queue never breaks the stage change', async () => {
  on(A, { booking_value: 800 });
  db.whatsapp_leads.push(adLead());
  await require('../server/inbox.cjs').applyStageEvent(A, CUSTOMER, 'order_enquiry');
  assert.strictEqual(db.whatsapp_leads[0].stage, 'ordered');
  assert.deepStrictEqual(db.ad_conversions.map(x => [x.event_name, Number(x.value), x.currency]), [['Purchase', 800, 'INR']]);

  // Even if queueing throws, the stage change goes through.
  const r = await conv.onStage(A, { phone: CUSTOMER, get referral() { throw new Error('boom'); } }, 'ordered');
  assert.deepStrictEqual(r, { queued: false });
});

test('E1 worker: dataset made once per WhatsApp account, event sent with the WhatsApp token; failures handled', async () => {
  on();
  db.whatsapp_leads.push(adLead(), adLead({ phone: '919000000078', referral: { ctwa_clid: `${CLID}x` } }));
  await conv.onStage(A, db.whatsapp_leads[0], 'ordered');
  await conv.onStage(A, db.whatsapp_leads[1], 'ordered');
  const r = await conv.sweep();
  assert.deepStrictEqual(r, { sent: 2, failed: 0, retried: 0 });
  assert.strictEqual(graph.filter(g => g.path === '922000000000001/dataset').length, 1, 'dataset created once, then remembered');
  const sent = graph.filter(g => g.path.endsWith('/events'));
  assert.strictEqual(sent.length, 2);
  assert.strictEqual(sent[0].path, `${db.ad_conversion_datasets[0].dataset_id}/events`);
  assert.strictEqual(sent[0].token, 'EAAG-wa-token-mayura-long');
  assert.strictEqual(sent[0].body.data[0].user_data.ctwa_clid, CLID);
  assert.ok(db.ad_conversions.every(x => x.status === 'sent' && x.sent_at));
  assert.deepStrictEqual(await conv.sweep(), { sent: 0, failed: 0, retried: 0 }, 'nothing sent twice');

  // A missing permission fails at once (retrying won't help) and is shown.
  db.ad_conversions.length = 0; db.ad_conversion_datasets.length = 0;
  await conv.onStage(A, db.whatsapp_leads[0], 'ordered');
  metaFail.dataset = { error: { message: '(#200) Requires whatsapp_business_manage_events permission', code: 200 } };
  assert.deepStrictEqual(await conv.sweep(), { sent: 0, failed: 1, retried: 0 });
  assert.match(db.ad_conversions[0].error, /whatsapp_business_manage_events/);

  // A passing Meta hiccup is retried later (up to 5 times).
  db.ad_conversions.length = 0; metaFail = { events: { error: { message: 'Temporary error', code: 2 } } };
  await conv.onStage(A, db.whatsapp_leads[0], 'ordered');
  assert.deepStrictEqual(await conv.sweep(), { sent: 0, failed: 0, retried: 1 });
  assert.strictEqual(db.ad_conversions[0].status, 'pending');
  assert.strictEqual(db.ad_conversions[0].attempts, 1);

  // Switched off before sending, or older than 7 days: not sent.
  metaFail = {};
  db.ad_conversion_settings[0].enabled = false;
  assert.deepStrictEqual(await conv.sweep(), { sent: 0, failed: 1, retried: 0 });
  db.ad_conversion_settings[0].enabled = true;
  db.ad_conversions.push({ id: 99, business_id: A, phone: CUSTOMER, ctwa_clid: 'old-click-id', event_name: 'LeadSubmitted', stage: 'ordered', status: 'pending', attempts: 0, event_time: new Date(Date.now() - 8 * 86400000).toISOString(), created_at: new Date(Date.now() - 8 * 86400000).toISOString() });
  await conv.sweep();
  assert.match(db.ad_conversions.find(x => x.id === 99).error, /7 days/);
});

test('E1 screen: managers see the status, only the Business Admin changes it; agents and other plans get nothing', async () => {
  const view = await request('GET', '/api/ads/conversions', 'e-manager');
  assert.strictEqual(view.status, 200);
  assert.deepStrictEqual([view.json().settings.enabled, view.json().eventName], [false, 'LeadSubmitted']);
  assert.strictEqual((await request('GET', '/api/ads/conversions', 'e-agent')).status, 403);
  assert.strictEqual((await request('PUT', '/api/ads/conversions', 'e-manager', { enabled: true })).status, 403);
  const save = await request('PUT', '/api/ads/conversions', 'e-owner', { enabled: true, bookingValue: 800 });
  assert.strictEqual(save.status, 200);
  assert.deepStrictEqual([save.json().settings.enabled, save.json().settings.bookingValue, save.json().eventName], [true, 800, 'Purchase']);
  assert.strictEqual((await request('PUT', '/api/ads/conversions', 'e-owner', { bookingValue: -5 })).status, 400);
  assert.strictEqual((await request('PUT', '/api/ads/conversions', 'e-owner', { enabled: 'yes' })).status, 400);
  assert.ok(db.audit_log.some(a => a.action === 'ads.conversions_settings' && a.business_id === A));
  assert.strictEqual(db.ad_conversion_settings.filter(s => s.business_id === F).length, 0, 'another business is untouched');
});

// ---- E2-E4: the wizard ----------------------------------------------------------------------------------
test('E3/E4 pure: placements and carousel; old drafts (no placement, one picture) build exactly as before', () => {
  const old = c.targetingFor(DRAFT());
  assert.strictEqual(old.publisher_platforms, undefined, 'automatic placements = nothing added');
  const fs = c.targetingFor(DRAFT({ placement: 'feeds_stories' }));
  assert.deepStrictEqual([fs.publisher_platforms, fs.instagram_positions, fs.whatsapp_positions], [['facebook', 'instagram'], ['stream', 'story', 'reels'], undefined]);
  const st = c.targetingFor(DRAFT({ placement: 'with_status' }));
  assert.deepStrictEqual([st.publisher_platforms, st.whatsapp_positions], [['facebook', 'instagram', 'whatsapp'], ['status']]);
  assert.ok(st.instagram_positions.includes('story'), 'Meta: Status only with Instagram Stories');

  const one = c.storyFor(DRAFT(), '55555');
  assert.deepStrictEqual([one.link_data.image_hash, one.link_data.name, one.link_data.child_attachments], ['abcdef0123456789abcdef0123456789', 'Order now', undefined]);
  const cards = [{ imageHash: 'a'.repeat(32), headline: 'Idli batter' }, { imageHash: 'b'.repeat(32), headline: '' }];
  const car = c.storyFor(DRAFT({ cards }), '55555');
  assert.strictEqual(car.link_data.image_hash, undefined);
  assert.deepStrictEqual(car.link_data.child_attachments.map(x => [x.image_hash, x.name, x.call_to_action.type]), [['a'.repeat(32), 'Idli batter', 'WHATSAPP_MESSAGE'], ['b'.repeat(32), undefined, 'WHATSAPP_MESSAGE']]);

  const lim = { minDailyBudget: 96, maxDailyBudget: 2000, today: TODAY };
  assert.deepStrictEqual(c.validateDraft(DRAFT({ placement: 'with_status', cards, numberId: '222000000000002' }), lim), []);
  assert.match(c.validateDraft(DRAFT({ placement: 'everywhere' }), lim).join(), /where the ad is shown/);
  assert.match(c.validateDraft(DRAFT({ cards: [cards[0]] }), lim).join(), /2 to 10/);
  assert.match(c.validateDraft(DRAFT({ cards: [...cards, { imageHash: 'nope' }] }), lim).join(), /missing/);
  assert.match(c.validateDraft(DRAFT({ numberId: 'abc' }), lim).join(), /WhatsApp numbers/);
});

test('E2: the ad opens the chosen number (one of this business\'s); another business\'s number is refused', async () => {
  const r = await request('POST', '/api/ads/create', 'e-owner', DRAFT({ numberId: '222000000000002' }));
  assert.strictEqual(r.status, 200, JSON.stringify(r.json()));
  const adset = graph.find(g => g.path.endsWith('/adsets'));
  assert.deepStrictEqual(JSON.parse(adset.body.promoted_object), { page_id: '55555', whatsapp_phone_number: '+919701103223' });
  assert.strictEqual(db.ad_launches[0].spec.number, '919701103223');

  const before = graph.filter(g => g.method === 'POST').length;
  const bad = await request('POST', '/api/ads/create', 'e-owner', DRAFT({ draftId: '21111111-2222-4333-8444-555555555555', numberId: '999000000000001' }));
  assert.strictEqual(bad.status, 400);
  assert.match(bad.json().error, /isn't connected to this business/);
  assert.strictEqual(graph.filter(g => g.method === 'POST').length, before, 'nothing created in Meta');

  // No choice: the Page's linked number, as before.
  await request('POST', '/api/ads/create', 'e-owner', DRAFT({ draftId: '31111111-2222-4333-8444-555555555555' }));
  assert.strictEqual(JSON.parse(graph.filter(g => g.path.endsWith('/adsets')).at(-1).body.promoted_object).whatsapp_phone_number, '+919701103222');
});

test('E3: WhatsApp Status for a food business adds the WhatsApp identity; refused for a hospital', async () => {
  const hosp = await request('POST', '/api/ads/create', 'e-owner', DRAFT({ placement: 'with_status' }));
  assert.strictEqual(hosp.status, 400);
  assert.match(hosp.json().error, /healthcare and pharma/);
  assert.strictEqual(graph.filter(g => g.method === 'POST').length, 0);
  const ready = await request('GET', '/api/ads/create/readiness', 'e-owner');
  assert.strictEqual(ready.json().statusAllowed, false);
  assert.deepStrictEqual(ready.json().numbers.map(n => [n.id, n.linked]), [['222000000000001', true], ['222000000000002', false]]);

  const food = await request('POST', '/api/ads/create', 'e-food', DRAFT({ placement: 'with_status', cards: [{ imageHash: 'a'.repeat(32), headline: 'Idli' }, { imageHash: 'b'.repeat(32), headline: 'Dosa' }] }));
  assert.strictEqual(food.status, 200, JSON.stringify(food.json()));
  const t = JSON.parse(graph.find(g => g.path.endsWith('/adsets')).body.targeting);
  assert.deepStrictEqual(t.whatsapp_positions, ['status']);
  const cr = graph.find(g => g.path.endsWith('/adcreatives')).body;
  assert.deepStrictEqual(JSON.parse(cr.wamo_whatsapp_identity_spec), { whatsapp_phone_number: '+919000000500' });
  assert.strictEqual(JSON.parse(cr.object_story_spec).link_data.child_attachments.length, 2);
  assert.strictEqual(db.ad_launches.at(-1).spec.placement, 'with_status');
  assert.strictEqual(db.ad_launches.at(-1).spec.cards.length, 2);
});

test('migration E: conversion tables are server-only, deduplicate, check values, safe to re-run', async () => {
  const pg = await freshDb();
  await pg.exec(require('fs').readFileSync(require('path').join(__dirname, '..', 'supabase', 'migrations', '20261125_ads_e_conversions.sql'), 'utf8'));
  await pg.query("insert into public.businesses (id, name, slug) values ($1, 'Mayura', 'e-mayura') on conflict do nothing", [A]);
  await pg.query("insert into public.ad_conversions (business_id, phone, ctwa_clid, event_name, stage) values ($1, '9190', 'clid1234', 'LeadSubmitted', 'ordered')", [A]);
  const again = await pg.query("insert into public.ad_conversions (business_id, phone, ctwa_clid, event_name, stage) values ($1, '9190', 'clid1234', 'LeadSubmitted', 'completed') on conflict do nothing returning id", [A]);
  assert.strictEqual(again.rows.length, 0, 'one event per lead + click + event');
  await assert.rejects(pg.query("insert into public.ad_conversions (business_id, phone, ctwa_clid, event_name, stage) values ($1, '9190', 'clid9999', 'Hacked', 'ordered')", [A]), /check/);
  await assert.rejects(pg.query("insert into public.ad_conversion_settings (business_id, booking_value) values ($1, -1)", [A]), /check/);
  const u = await pg.query("insert into auth.users (email) values ('owner@m.test') returning id");
  await pg.query("insert into public.staff_members (user_id, email, role, business_id) values ($1, 'owner@m.test', 'owner', $2)", [u.rows[0].id, A]);
  for (const t of ['ad_conversions', 'ad_conversion_settings', 'ad_conversion_datasets']) {
    await assert.rejects(asUser(pg, u.rows[0].id, () => pg.query(`select * from public.${t}`)), undefined, `${t} is server-only`);
  }
});
