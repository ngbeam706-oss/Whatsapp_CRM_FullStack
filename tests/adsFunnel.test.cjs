// Ads conversion analytics A1 + A2 (docs/progress/ads-module.md "Funnel"): funnel math by status TYPE with custom
// statuses, attribution toggle, cost per step without dividing by zero, revenue / ROAS with and without booking values,
// status history written on every change path, tenancy, agents 403, the migration.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const SUN = 'a0000000-0000-4000-8000-000000000001';
const LOTUS = 'b0000000-0000-4000-8000-000000000002';
process.env.APP_SECRET = 'server_encryption_secret_long_enough';
process.env.VITE_SUPABASE_URL = 'http://fake.supabase';
process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
process.env.WHATSAPP_BUSINESS_ID = 'c0000000-0000-4000-8000-000000000009';

const app = require('../server/app.cjs');
const fun = require('../server/adsFunnel.cjs');
const ls = require('../server/leadStatuses.cjs');
const inbox = require('../server/inbox.cjs');
const limits = require('../server/limits.cjs');
const { _setStaffForToken } = require('../server/auth.cjs');

const st = (key, label, type, order, active = true) => ({ key, label, hint: null, color: 'slate', type, sort_order: order, active });
const STATUSES = [st('new', 'New', 'new', 1), st('s_call', 'Called back', 'working', 2), st('s_appt', 'Appointment fixed', 'won', 3), st('completed', 'Visited', 'done', 4), st('repeat', 'Again', 'repeat', 5), st('lost', 'Not interested', 'lost', 6)];
const FROM = '2026-11-01T00:00:00.000Z';
const TO = '2026-11-08T00:00:00.000Z';
const INS = [
  { date: '2026-11-02', ad_id: '11', ad_name: 'Knee ad', adset_id: '101', adset_name: 'Hyderabad 30+', campaign_id: '1001', campaign_name: 'Knee camp', spend: 600, impressions: 10000, clicks: 200, conversations: 8 },
  { date: '2026-11-03', ad_id: '12', ad_name: 'Back ad', adset_id: '101', adset_name: 'Hyderabad 30+', campaign_id: '1001', campaign_name: 'Knee camp', spend: 400, impressions: 6000, clicks: 100, conversations: 4 },
  { date: '2026-10-28', ad_id: '11', ad_name: 'Knee ad', adset_id: '101', adset_name: 'Hyderabad 30+', campaign_id: '1001', campaign_name: 'Knee camp', spend: 999, impressions: 1, clicks: 1, conversations: 1 }, // before the period
];
const lead = (phone, stage, extra = {}) => ({ phone, stage, assigned_to: 'a@sun.test', first_ad_id: '11', first_ad_at: '2026-11-02T05:00:00Z', last_ad_id: null, last_ad_at: null, ...extra });

test('funnel by status TYPE with custom names; ever-reached from history; costs, lost reasons, reply speed, agents', () => {
  const leads = [
    lead('919000000001', 's_call'),
    lead('919000000002', 's_appt', { booking_value: 2000 }),
    lead('919000000003', 'completed'),
    lead('919000000004', 'lost', { closed_reason: 'not_interested' }),
    lead('919000000005', 'lost', { first_ad_id: '12', closed_reason: null }), // was booked earlier (history), then lost
    lead('919000000006', 'new', { first_ad_at: '2026-10-20T00:00:00Z' }), // before the period
  ];
  const messages = [
    { contact_phone: '919000000001', direction: 'inbound', sent_by: null, timestamp: '2026-11-02T05:00:00Z' },
    { contact_phone: '919000000001', direction: 'outbound', sent_by: 'a@sun.test', timestamp: '2026-11-02T05:03:00Z' },
    { contact_phone: '919000000002', direction: 'inbound', sent_by: null, timestamp: '2026-11-02T05:00:00Z' },
    { contact_phone: '919000000002', direction: 'outbound', sent_by: null, timestamp: '2026-11-02T05:00:10Z' }, // the bot, not the team
    { contact_phone: '919000000002', direction: 'outbound', sent_by: 'a@sun.test', timestamp: '2026-11-02T06:00:00Z' },
  ];
  const history = [
    { phone: '919000000002', to_type: 'won', changed_at: '2026-11-04T05:00:00Z' },
    { phone: '919000000005', to_type: 'won', changed_at: '2026-11-03T05:00:00Z' },
    { phone: '919000000005', to_type: 'lost', changed_at: '2026-11-05T05:00:00Z' },
  ];
  const f = fun.buildFunnel({ insights: INS, leads, messages, history, statuses: STATUSES, from: FROM, to: TO, avgValue: null });
  const t = f.totals;
  assert.deepEqual([t.spend, t.impressions, t.clicks, t.metaChats], [1000, 16000, 300, 12], 'only days in the period');
  assert.deepEqual([t.chats, t.replied, t.working, t.won, t.done, t.repeat, t.lost], [5, 2, 4, 3, 1, 0, 2]);
  assert.equal(t.costPerChat, 200);
  assert.equal(t.costPerWon, 333.33);
  assert.equal(t.costPerDone, 1000);
  assert.equal(t.revenue, 2000, 'only the booked lead with an amount (no average set); the lost one is not revenue');
  assert.equal(t.roas, 2);
  assert.equal(t.medianDaysToWon, 1.5, '2 days (lead 2) and 1 day (lead 5)');
  assert.deepEqual(f.steps.find(s => s.key === 'won'), { key: 'won', label: 'Booked / ordered', count: 3, pctOfPrev: 75 });
  // Campaign -> ad set -> ad, lost reasons.
  assert.equal(f.campaigns.length, 1);
  assert.deepEqual(f.campaigns[0].lostReasons, { not_interested: 1, not_given: 1 });
  assert.deepEqual(f.campaigns[0].adsets[0].ads.map(a => [a.adId, a.chats]), [['11', 4], ['12', 1]]);
  // Reply speed: 3 min (lead 1), 60 min (lead 2, the bot doesn't count), the rest no reply.
  assert.deepEqual(f.replyBands.map(b => [b.key, b.chats]), [['under5m', 1], ['5to30m', 0], ['30mto2h', 1], ['over2h', 0], ['noReply', 3]]);
  assert.deepEqual(f.agents[0], { email: 'a@sun.test', chats: 5, replied: 2, won: 3, wonRate: 60, medianFirstReplyMin: 31.5 });
  assert.deepEqual(f.trend.find(d => d.day === '2026-11-04'), { day: '2026-11-04', spend: 0, won: 1 });
});

test('attribution toggle, filters, the average booking value, and no division by zero', () => {
  const leads = [lead('919000000001', 's_appt', { last_ad_id: '12', last_ad_at: '2026-11-03T00:00:00Z' })];
  const first = fun.buildFunnel({ insights: INS, leads, statuses: STATUSES, from: FROM, to: TO, avgValue: 1500 });
  assert.equal(first.campaigns[0].adsets[0].ads.find(a => a.adId === '11').won, 1);
  assert.equal(first.totals.revenue, 1500, 'no amount: the business\'s average');
  const last = fun.buildFunnel({ insights: INS, leads, statuses: STATUSES, from: FROM, to: TO, attribution: 'last' });
  assert.equal(last.campaigns[0].adsets[0].ads.find(a => a.adId === '12').won, 1);
  assert.equal(last.totals.roas, null, 'no value at all: no ROAS');
  assert.equal(fun.buildFunnel({ insights: INS, leads, statuses: STATUSES, from: FROM, to: TO, filters: { agent: 'b@sun.test' } }).totals.chats, 0);
  assert.equal(fun.buildFunnel({ insights: INS, leads, statuses: STATUSES, from: FROM, to: TO, filters: { statusType: 'won' } }).totals.chats, 1);
  assert.equal(fun.buildFunnel({ insights: INS, leads, statuses: STATUSES, from: FROM, to: TO, filters: { campaignId: '999' } }).totals.spend, 0);
  const empty = fun.buildFunnel({ insights: [], leads: [], statuses: STATUSES, from: FROM, to: TO });
  assert.deepEqual([empty.totals.costPerChat, empty.totals.costPerWon, empty.totals.wonRate, empty.totals.roas, empty.totals.medianDaysToWon], [null, null, null, null, null]);
  assert.ok(empty.steps.every(s => s.pctOfPrev === null));
});

test('ads vs other sources, the period, and the CSV', () => {
  const rows = fun.bySource([{ stage: 's_appt', first_ad_id: '11' }, { stage: 'new', first_ad_id: '11' }, { stage: 'completed', source: 'Phone call' }, { stage: 'lost', source: 'Walk-in' }], STATUSES);
  assert.deepEqual(rows.map(r => [r.source, r.leads, r.won, r.wonRate]), [['Ads', 2, 1, 50], ['Phone call', 1, 1, 100], ['Walk-in', 1, 0, 0]]);
  const p = fun.period({ from: '2026-11-01', to: '2026-11-07' });
  assert.deepEqual([p.from, p.to, p.days, p.prevFrom], ['2026-10-31T18:30:00.000Z', '2026-11-07T18:30:00.000Z', 7, '2026-10-24T18:30:00.000Z']);
  const f = fun.buildFunnel({ insights: [{ ...INS[0], campaign_name: '=Knee, "camp"' }], leads: [], statuses: STATUSES, from: FROM, to: TO });
  const csv = fun.csvOf(f);
  assert.ok(csv.startsWith('﻿Level,Campaign,'));
  assert.ok(csv.includes('Campaign,"\'=Knee, ""camp"""'), 'quoted and formula-guarded');
});

// ---------------------------------------------------------------------------------------------
// The API and the status history (fake database)
// ---------------------------------------------------------------------------------------------
let db;
function seed() {
  db = {
    businesses: [{ id: SUN, name: 'Sunrise Clinic', status: 'active', plan_id: 'pro', industry: 'hospital' }, { id: LOTUS, name: 'Lotus', status: 'active', plan_id: 'pro' }],
    plans: [{ id: 'pro', name: 'Pro', ads_enabled: true, analytics_days: 365 }],
    lead_statuses: [...STATUSES.map(s => ({ business_id: SUN, ...s })), ...ls.template('food').map(s => ({ business_id: LOTUS, ...s }))],
    business_ad_accounts: [{ business_id: SUN, ad_account_id: 'act_1', currency: 'INR' }, { business_id: LOTUS, ad_account_id: 'act_2', currency: 'INR' }],
    ad_insights_daily: [], whatsapp_leads: [], whatsapp_messages: [], lead_status_history: [], ad_conversion_settings: [], audit_log: [], contact_events: [], lead_notes: [],
    staff_members: [{ business_id: SUN, email: 'manager@sun.test', role: 'manager' }],
  };
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const now = new Date().toISOString();
  db.ad_insights_daily.push({ business_id: SUN, ad_account_id: 'act_1', date: today, ad_id: '11', ad_name: 'Knee ad', adset_id: '101', adset_name: 'S', campaign_id: '1001', campaign_name: 'Knee camp', spend: 500, impressions: 100, clicks: 10, conversations: 3 });
  db.ad_insights_daily.push({ business_id: LOTUS, ad_account_id: 'act_2', date: today, ad_id: '99', ad_name: 'Lotus secret ad', adset_id: '9', adset_name: 'L', campaign_id: '9001', campaign_name: 'Lotus camp', spend: 7777, impressions: 1, clicks: 1, conversations: 1 });
  db.whatsapp_leads.push({ business_id: SUN, phone: '919000000001', stage: 's_appt', assigned_to: null, first_ad_id: '11', first_ad_at: now, source: 'Facebook Ad', created_at: now });
  db.whatsapp_leads.push({ business_id: LOTUS, phone: '919000000001', stage: 'ordered', assigned_to: null, first_ad_id: '99', first_ad_at: now, source: 'Facebook Ad', created_at: now });
  ls.clearCache(); limits.clearCache();
}
const SKIP = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'or']);
function matcher(u) {
  const filters = [...new URL(u).searchParams.entries()].filter(([k]) => !SKIP.has(k));
  return (r) => filters.every(([k, v]) => {
    const val = r[k] === undefined || r[k] === null ? null : String(r[k]);
    if (v.startsWith('eq.')) return val === v.slice(3);
    if (v.startsWith('in.(')) return v.slice(4, -1).split(',').includes(val);
    if (v === 'is.null') return val === null;
    if (v === 'not.is.null') return val !== null;
    if (v.startsWith('gte.')) return val !== null && val >= v.slice(4);
    if (v.startsWith('lt.')) return val !== null && val < v.slice(3);
    return true;
  });
}
const json = (d, status = 200, headers = {}) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json', ...headers } });
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  const body = opts.body ? JSON.parse(opts.body) : null;
  if (!u.startsWith('http://fake.supabase/rest/v1/')) return json({}, 503);
  const table = u.slice('http://fake.supabase/rest/v1/'.length).split('?')[0];
  if (table.startsWith('rpc/')) return json([]);
  const rows = db[table] || (db[table] = []);
  const match = matcher(u);
  if (method === 'GET') {
    const hit = rows.filter(match);
    if (/[?&]limit=0/.test(u)) return json([], 200, { 'Content-Range': `*/${hit.length}` });
    const off = Number(new URL(u).searchParams.get('offset') || 0);
    return json(hit.slice(off, off + Number(new URL(u).searchParams.get('limit') || 100000)));
  }
  if (method === 'POST') { const list = (Array.isArray(body) ? body : [body]).map(r => ({ ...r })); rows.push(...list); return json(list, 201); }
  if (method === 'PATCH') { const hit = rows.filter(match); hit.forEach(r => Object.assign(r, body)); return json(hit); }
  if (method === 'DELETE') { const hit = rows.filter(match); db[table] = rows.filter(r => !hit.includes(r)); return json(hit); }
  return json([]);
};
let server, base;
before(async () => { server = app.listen(0); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
beforeEach(seed);
function request(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } },
      (res) => { let t = ''; res.setEncoding('utf8'); res.on('data', c => { t += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch { /* text */ } resolve({ status: res.statusCode, text: t, json: j, headers: res.headers }); }); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const MANAGER = { id: 'u-m', email: 'manager@sun.test', role: 'manager', businessId: SUN, businessName: 'Sunrise Clinic' };
_setStaffForToken('af-manager', MANAGER);
_setStaffForToken('af-agent', { id: 'u-a', email: 'agent@sun.test', role: 'agent', businessId: SUN, businessName: 'Sunrise Clinic' });

test('agents can\'t open the funnel or its export', async () => {
  assert.equal((await request('POST', '/api/ads/funnel', 'af-agent', { days: 30 })).status, 403);
  assert.equal((await request('POST', '/api/ads/funnel/export', 'af-agent', { days: 30 })).status, 403);
});

test('the funnel counts only this business\'s ads and leads; CSV export works', async () => {
  const r = await request('POST', '/api/ads/funnel', 'af-manager', { days: 7 });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.funnel.totals.spend, 500);
  assert.equal(r.json.funnel.totals.chats, 1);
  assert.equal(r.json.funnel.totals.won, 1, 'custom "Appointment fixed" counts as booked by its type');
  assert.ok(!r.text.includes('Lotus'), 'another business\'s campaigns never appear');
  assert.ok(!r.text.includes('919000000001'), 'aggregates only: no numbers');
  const csv = await request('POST', '/api/ads/funnel/export', 'af-manager', { days: 7 });
  assert.equal(csv.status, 200);
  assert.match(csv.headers['content-type'], /text\/csv/);
  assert.ok(csv.text.includes('Knee camp') && !csv.text.includes('Lotus'));
});

test('status history is written on every change path: staff, bot, Add lead, moving chats when a status is removed', async () => {
  // Staff (Inbox / Pipeline), with a booking value.
  const r = await inbox.updateContact('919000000001', { stage: 'completed', bookingValue: 1800 }, MANAGER);
  assert.ifError(r.error);
  assert.equal(db.whatsapp_leads[0].booking_value, 1800);
  assert.deepEqual(db.lead_status_history.map(h => [h.business_id, h.from_key, h.from_type, h.to_key, h.to_type, h.source, h.changed_by]), [[SUN, 's_appt', 'won', 'completed', 'done', 'staff', 'manager@sun.test']]);
  assert.match((await inbox.updateContact('919000000001', { bookingValue: -5 }, MANAGER)).error, /amount/);
  // The bot.
  db.whatsapp_leads.push({ business_id: SUN, phone: '919000000002', stage: 'new', assigned_to: null });
  await inbox.applyStageEvent(SUN, '919000000002', 'item_viewed');
  assert.deepEqual(db.lead_status_history.at(-1), { ...db.lead_status_history.at(-1), phone: '919000000002', from_key: 'new', to_key: 's_call', to_type: 'working', source: 'bot', changed_by: 'bot' });
  // Add lead.
  await inbox.startConversation(MANAGER, '919000000003', 'Kiran', { source: 'Phone call', status: 's_appt' });
  assert.deepEqual([db.lead_status_history.at(-1).phone, db.lead_status_history.at(-1).from_key, db.lead_status_history.at(-1).to_type, db.lead_status_history.at(-1).source], ['919000000003', null, 'won', 'added']);
  // Moving chats when a status is removed.
  const before = db.lead_status_history.length;
  const rm = await ls.remove(MANAGER, 's_call', 'new');
  assert.ifError(rm.error);
  const moved = db.lead_status_history.slice(before);
  assert.deepEqual(moved.map(h => [h.phone, h.from_key, h.to_key, h.source]), [['919000000002', 's_call', 'new', 'bulk']]);
  assert.ok(db.lead_status_history.every(h => h.business_id === SUN));
});

// ---------------------------------------------------------------------------------------------
// The migration
// ---------------------------------------------------------------------------------------------
test('SQL: history is server-only, types checked, booking value checked, safe to re-run', async () => {
  const { freshDb, migrationSql, asUser } = require('./helpers/pgHarness.cjs');
  const pg = await freshDb();
  await pg.exec(migrationSql('20261137_ads_funnel.sql'));
  const biz = (await pg.query("insert into public.businesses (name, slug, plan_id) values ('Sunrise Clinic', 'sunrise-clinic', 'growth') returning id")).rows[0].id;
  await pg.query("insert into public.lead_status_history (business_id, phone, to_key, to_type) values ($1, '919000000001', 's_appt', 'won')", [biz]);
  await assert.rejects(pg.query("insert into public.lead_status_history (business_id, phone, to_key, to_type) values ($1, '919000000001', 'x', 'boss')", [biz]));
  await pg.query("insert into public.whatsapp_leads (phone, name, business_id, booking_value) values ('919000000001', 'R', $1, 1500.50)", [biz]);
  await assert.rejects(pg.query("update public.whatsapp_leads set booking_value = -1 where business_id = $1", [biz]));
  const u = (await pg.query("insert into auth.users (email) values ('owner@sun.test') returning id")).rows[0].id;
  await pg.query("insert into public.staff_members (user_id, email, role, business_id) values ($1, 'owner@sun.test', 'owner', $2)", [u, biz]);
  await assert.rejects(asUser(pg, u, () => pg.query('select * from public.lead_status_history')));
});
