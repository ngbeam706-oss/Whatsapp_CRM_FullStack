// Lead statuses per business (docs/progress/lead-statuses.md): each business's own list; everything automatic
// works on the TYPE (automatic moves, bookings to Meta, analytics, team ranking); managers edit, agents only use;
// another business never sees or uses them; a status with chats can't be removed without moving them.
// Part 1: pure mapping. Part 2: the API with a fake database. Part 3: the migration on PGlite.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const SUN = 'a0000000-0000-4000-8000-000000000001'; // Sunrise Clinic (hospital)
const LOTUS = 'b0000000-0000-4000-8000-000000000002'; // another business
process.env.APP_SECRET = 'server_encryption_secret_long_enough';
process.env.VITE_SUPABASE_URL = 'http://fake.supabase';
process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
process.env.WHATSAPP_BUSINESS_ID = 'c0000000-0000-4000-8000-000000000009';

const app = require('../server/app.cjs');
const ls = require('../server/leadStatuses.cjs');
const inbox = require('../server/inbox.cjs');
const conv = require('../server/adConversions.cjs');
const analytics = require('../server/analytics.cjs');
const { _setStaffForToken } = require('../server/auth.cjs');

const st = (key, label, type, order, active = true) => ({ key, label, hint: null, color: 'slate', type, sort_order: order, active });
// A hospital that renamed things and added its own steps.
const CUSTOM = [
  st('new', 'New enquiry', 'new', 1),
  st('s_called', 'Called back', 'working', 2),
  st('interested', 'In discussion', 'working', 3),
  st('s_booked', 'Appointment booked', 'won', 4),
  st('ordered', 'Booked (old)', 'won', 5, false),
  st('completed', 'Visited', 'done', 6),
  st('s_followup', 'Follow-up visit', 'repeat', 7),
  st('lost', 'Not interested', 'lost', 8),
];

// ---------------------------------------------------------------------------------------------
// Part 1: the type mapping (pure)
// ---------------------------------------------------------------------------------------------
test('automatic moves go to the first visible status of the needed TYPE, never by name', () => {
  assert.equal(inbox.nextStatus(CUSTOM, 'new', 'item_viewed'), 's_called');
  assert.equal(inbox.nextStatus(CUSTOM, 'new', 'order_enquiry'), 's_booked', 'the hidden "ordered" is skipped');
  assert.equal(inbox.nextStatus(CUSTOM, 's_called', 'order_enquiry'), 's_booked');
  assert.equal(inbox.nextStatus(CUSTOM, 's_booked', 'order_enquiry'), 's_booked', 'already won: stays');
  assert.equal(inbox.nextStatus(CUSTOM, 's_booked', 'order_enquiry', { hadEarlierOrder: true }), 's_followup');
  assert.equal(inbox.nextStatus(CUSTOM, 'completed', 'order_enquiry'), 's_followup', 'booking again after a visit = returning');
  assert.equal(inbox.nextStatus(CUSTOM, 's_called', 'inbound'), 's_called');
  assert.equal(inbox.nextStatus(CUSTOM, 'lost', 'item_viewed'), 'lost');
  // No visible status of the needed type: the chat stays where it is.
  const noWorking = CUSTOM.filter(s => s.type !== 'working');
  assert.equal(inbox.nextStatus(noWorking, 'new', 'item_viewed'), 'new');
  // The original six behave exactly as before.
  for (const [cur, ev, want] of [['new', 'item_viewed', 'interested'], ['new', 'order_enquiry', 'ordered'], ['completed', 'order_enquiry', 'repeat']]) {
    assert.equal(inbox.nextStatus(ls.GENERAL, cur, ev), want);
    assert.equal(inbox.nextStage(cur, ev), want);
  }
});

test('conversions, open chats and the analytics pipeline count by type; unknown keys count as new', () => {
  assert.equal(ls.typeOf(CUSTOM, 's_followup'), 'repeat');
  assert.equal(ls.typeOf(CUSTOM, 'gone_key'), 'new');
  assert.ok(ls.isConverted(CUSTOM, 's_booked') && ls.isConverted(CUSTOM, 'completed') && !ls.isConverted(CUSTOM, 's_called'));
  const leads = [{ stage: 's_booked', first_ad_id: '1', first_ad_at: '2026-11-10T00:00:00Z' }, { stage: 's_called', first_ad_id: '1', first_ad_at: '2026-11-10T00:00:00Z' }, { stage: 'gone_key' }];
  const ads = analytics.adsPerformance(ls.byType(CUSTOM, leads), '2026-11-01T00:00:00Z');
  assert.equal(ads[0].converted, 1);
  const pipe = ls.pipelineCounts(CUSTOM, leads);
  assert.deepEqual(pipe.map(p => [p.stage, p.count]), [['new', 1], ['s_called', 1], ['interested', 0], ['s_booked', 1], ['completed', 0], ['s_followup', 0], ['lost', 0]], 'hidden empty status left out');
  assert.equal(pipe.find(p => p.stage === 's_booked').label, 'Appointment booked');
});

test('starting lists per industry keep the six keys and types, with words that fit', () => {
  const h = ls.template('hospital');
  assert.deepEqual(h.map(s => s.label), ['New enquiry', 'Called back', 'Appointment booked', 'Visited', 'Follow-up visit', 'Not interested']);
  assert.deepEqual(h.map(s => s.type), ['new', 'working', 'won', 'done', 'repeat', 'lost']);
  assert.deepEqual(ls.template('food').map(s => s.label), ['New', 'Interested', 'Ordered', 'Delivered', 'Repeat', 'Lost']);
  assert.deepEqual(ls.template('unknown').map(s => s.label), ls.GENERAL.map(s => s.label));
});

// ---------------------------------------------------------------------------------------------
// Part 2: the API (fake database)
// ---------------------------------------------------------------------------------------------
let db;
function seed() {
  db = {
    businesses: [{ id: SUN, name: 'Sunrise Clinic', industry: 'hospital', status: 'active', plan_id: 'pro' }, { id: LOTUS, name: 'Lotus Foods', industry: 'food', status: 'active', plan_id: 'pro' }],
    lead_statuses: [
      ...ls.template('hospital').map(s => ({ business_id: SUN, ...s })),
      { business_id: LOTUS, ...st('s_lotus', 'Lotus secret step', 'working', 9) },
      ...ls.template('food').map(s => ({ business_id: LOTUS, ...s })),
    ],
    whatsapp_leads: [
      { business_id: SUN, phone: '919000000001', name: 'Ravi', stage: 'interested', assigned_to: null, referral: { ctwa_clid: 'clickid-1234' } },
      { business_id: SUN, phone: '919000000002', name: 'Sita', stage: 'interested', assigned_to: null },
      { business_id: LOTUS, phone: '919000000009', name: 'Lotus customer', stage: 's_lotus', assigned_to: null },
    ],
    audit_log: [], ad_conversion_settings: [{ business_id: SUN, enabled: true, booking_value: null, currency: 'INR' }], ad_conversions: [],
    staff_members: [], contact_events: [],
  };
  ls.clearCache();
}

const SKIP = new Set(['select', 'order', 'limit', 'offset', 'on_conflict']);
function matcher(u) {
  const filters = [...new URL(u).searchParams.entries()].filter(([k]) => !SKIP.has(k));
  return (r) => filters.every(([k, v]) => {
    const val = r[k] === undefined || r[k] === null ? null : String(r[k]);
    if (v.startsWith('eq.')) return val === decodeURIComponent(v.slice(3));
    if (v.startsWith('in.(')) return v.slice(4, -1).split(',').includes(val);
    if (v === 'is.null') return val === null;
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
    return json(hit);
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
      (res) => { let t = ''; res.on('data', c => { t += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch { /* text */ } resolve({ status: res.statusCode, text: t, json: j }); }); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
_setStaffForToken('ls-manager', { id: 'u-m', email: 'manager@sunrise.test', role: 'manager', businessId: SUN, businessName: 'Sunrise Clinic' });
_setStaffForToken('ls-agent', { id: 'u-a', email: 'agent@sunrise.test', role: 'agent', businessId: SUN, businessName: 'Sunrise Clinic' });
_setStaffForToken('ls-lotus', { id: 'u-l', email: 'owner@lotus.test', role: 'owner', businessId: LOTUS, businessName: 'Lotus Foods' });

test('everyone reads their own business\'s list; another business\'s statuses never show', async () => {
  const r = await request('GET', '/api/lead-statuses', 'ls-agent');
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json.statuses.map(s => s.label), ['New enquiry', 'Called back', 'Appointment booked', 'Visited', 'Follow-up visit', 'Not interested']);
  assert.ok(!r.text.includes('Lotus'), 'no other business\'s status');
  assert.equal(r.json.counts, undefined, 'agents get no chat counts');
  const m = await request('GET', '/api/lead-statuses', 'ls-manager');
  assert.equal(m.json.counts.interested, 2);
});

test('agents use statuses but can\'t change them', async () => {
  for (const [method, path, body] of [['POST', '/api/lead-statuses', { label: 'X', type: 'working' }], ['PATCH', '/api/lead-statuses/interested', { label: 'Y' }], ['PUT', '/api/lead-statuses/order', { keys: [] }], ['DELETE', '/api/lead-statuses/lost']]) {
    assert.equal((await request(method, path, 'ls-agent', body)).status, 403, `${method} ${path}`);
  }
  assert.equal(db.lead_statuses.filter(s => s.business_id === SUN).length, 6);
});

test('a manager adds, renames, recolours, hides and reorders; renaming never moves a chat; all audited', async () => {
  const add = await request('POST', '/api/lead-statuses', 'ls-manager', { label: 'Report sent', type: 'done', color: 'indigo' });
  assert.equal(add.status, 200, add.text);
  const key = add.json.status.key;
  assert.match(key, /^s_[0-9a-f]{6}$/);
  assert.equal((await request('POST', '/api/lead-statuses', 'ls-manager', { label: 'report SENT', type: 'done' })).status, 400, 'duplicate name');
  assert.equal((await request('POST', '/api/lead-statuses', 'ls-manager', { label: 'Odd', type: 'boss' })).status, 400, 'unknown type');

  const ren = await request('PATCH', '/api/lead-statuses/interested', 'ls-manager', { label: 'Spoke to them', color: 'orange' });
  assert.equal(ren.status, 200, ren.text);
  assert.equal(db.whatsapp_leads.filter(l => l.stage === 'interested').length, 2, 'chats keep their status');
  assert.equal((await request('PATCH', '/api/lead-statuses/interested', 'ls-manager', { color: 'neon' })).status, 400);
  assert.equal((await request('PATCH', '/api/lead-statuses/lost', 'ls-manager', { active: false })).status, 200);

  const keys = db.lead_statuses.filter(s => s.business_id === SUN).map(s => s.key).reverse();
  const ord = await request('PUT', '/api/lead-statuses/order', 'ls-manager', { keys });
  assert.equal(ord.status, 200, ord.text);
  assert.equal(ord.json.statuses[0].key, keys[0]);
  assert.equal((await request('PUT', '/api/lead-statuses/order', 'ls-manager', { keys: keys.slice(1) })).status, 400, 'every status once');

  const actions = db.audit_log.map(a => a.action);
  for (const a of ['lead_status.added', 'lead_status.updated', 'lead_status.reordered']) assert.ok(actions.includes(a), a);
  assert.ok(db.audit_log.every(a => a.business_id === SUN && a.actor_email === 'manager@sunrise.test'));
});

test('the start status can\'t be hidden, retyped or removed; at most 12 statuses', async () => {
  assert.equal((await request('PATCH', '/api/lead-statuses/new', 'ls-manager', { active: false })).status, 400);
  assert.equal((await request('PATCH', '/api/lead-statuses/new', 'ls-manager', { type: 'working' })).status, 400);
  assert.equal((await request('DELETE', '/api/lead-statuses/new', 'ls-manager')).status, 400);
  assert.equal((await request('PATCH', '/api/lead-statuses/new', 'ls-manager', { label: 'Fresh lead' })).status, 200, 'renaming is fine');
  for (let i = 0; i < 6; i++) assert.equal((await request('POST', '/api/lead-statuses', 'ls-manager', { label: `Step ${i}`, type: 'working' })).status, 200);
  const over = await request('POST', '/api/lead-statuses', 'ls-manager', { label: 'Step 13', type: 'working' });
  assert.equal(over.status, 400);
  assert.match(over.json.error, /up to 12/);
});

test('a status with chats can\'t be removed until they are moved; then nothing is lost', async () => {
  const refused = await request('DELETE', '/api/lead-statuses/interested', 'ls-manager');
  assert.equal(refused.status, 409);
  assert.equal(refused.json.chats, 2);
  assert.ok(db.lead_statuses.some(s => s.business_id === SUN && s.key === 'interested'));
  assert.equal((await request('DELETE', '/api/lead-statuses/interested?moveTo=s_lotus', 'ls-manager')).status, 409, 'another business\'s status is not a target');
  const ok = await request('DELETE', '/api/lead-statuses/interested?moveTo=ordered', 'ls-manager');
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.movedChats, 2);
  assert.deepEqual(db.whatsapp_leads.filter(l => l.business_id === SUN).map(l => l.stage), ['ordered', 'ordered']);
  assert.equal(db.whatsapp_leads.find(l => l.business_id === LOTUS).stage, 's_lotus', 'another business untouched');
  assert.ok(db.audit_log.some(a => a.action === 'lead_status.removed' && a.details.movedChats === 2));
  // An empty status goes straight away.
  assert.equal((await request('DELETE', '/api/lead-statuses/lost', 'ls-manager')).status, 200);
});

test('another business can\'t see, edit or use your statuses', async () => {
  assert.equal((await request('PATCH', '/api/lead-statuses/s_lotus', 'ls-manager', { label: 'Mine now' })).status, 404);
  assert.equal(db.lead_statuses.find(s => s.key === 's_lotus').label, 'Lotus secret step');
  const r = await inbox.updateContact('919000000002', { stage: 's_lotus' }, { id: 'u-m', email: 'manager@sunrise.test', role: 'manager', businessId: SUN });
  assert.match(r.error, /Unknown status/);
  // A hidden status can't be chosen either.
  db.lead_statuses.find(s => s.business_id === SUN && s.key === 'lost').active = false;
  ls.clearCache();
  assert.match((await inbox.updateContact('919000000002', { stage: 'lost' }, { id: 'u-m', email: 'manager@sunrise.test', role: 'manager', businessId: SUN })).error, /Unknown status/);
});

test('bookings to Meta follow the TYPE: a custom "won" status queues one, a custom "working" one doesn\'t', async () => {
  db.lead_statuses.push({ business_id: SUN, ...st('s_appt', 'Appointment fixed', 'won', 7) }, { business_id: SUN, ...st('s_call', 'Call later', 'working', 8) });
  ls.clearCache();
  const lead = db.whatsapp_leads[0];
  assert.equal((await conv.onStage(SUN, lead, 's_call')).queued, false);
  assert.equal((await conv.onStage(SUN, lead, 's_appt')).queued, true);
  assert.equal(db.ad_conversions[0].stage, 's_appt');
  // Moving a chat in the inbox does the same.
  const moved = await inbox.updateContact('919000000001', { stage: 's_appt' }, { id: 'u-m', email: 'manager@sunrise.test', role: 'manager', businessId: SUN });
  assert.ifError(moved.error);
  assert.equal(db.ad_conversions.length, 2);
});

test('a business with no list yet gets its industry\'s starting list, saved once', async () => {
  db.lead_statuses = db.lead_statuses.filter(s => s.business_id !== LOTUS);
  const r = await request('GET', '/api/lead-statuses', 'ls-lotus');
  assert.deepEqual(r.json.statuses.map(s => s.label), ['New', 'Interested', 'Ordered', 'Delivered', 'Repeat', 'Lost']);
  assert.equal(db.lead_statuses.filter(s => s.business_id === LOTUS).length, 6);
});

// ---------------------------------------------------------------------------------------------
// Part 3: the migration
// ---------------------------------------------------------------------------------------------
test('SQL: every existing business gets today\'s six, safe to re-run, server-only, custom keys allowed', async () => {
  const { freshDb, migrationSql, asUser } = require('./helpers/pgHarness.cjs');
  const pg = await freshDb({ upTo: '20261133_zz' });
  const biz = (await pg.query("insert into public.businesses (name, slug, plan_id) values ('Sunrise Clinic', 'sunrise-clinic', 'growth') returning id")).rows[0].id;
  await pg.query("insert into public.whatsapp_leads (phone, name, business_id, stage) values ('919000000001', 'Ravi', $1, 'ordered')", [biz]);
  await pg.exec(migrationSql('20261134_lead_statuses.sql'));
  await pg.exec(migrationSql('20261134_lead_statuses.sql'));
  const rows = (await pg.query('select key, label, type from public.lead_statuses where business_id = $1 order by sort_order', [biz])).rows;
  assert.deepEqual(rows.map(r => [r.key, r.label, r.type]), [['new', 'New enquiry', 'new'], ['interested', 'In discussion', 'working'], ['ordered', 'Booked', 'won'], ['completed', 'Completed', 'done'], ['repeat', 'Returning', 'repeat'], ['lost', 'Closed', 'lost']]);
  assert.equal((await pg.query('select stage from public.whatsapp_leads where business_id = $1', [biz])).rows[0].stage, 'ordered', 'no contact moved');
  // A custom key is now allowed; junk isn't.
  await pg.query("update public.whatsapp_leads set stage = 's_ab12cd' where business_id = $1", [biz]);
  await assert.rejects(pg.query("update public.whatsapp_leads set stage = 'Bad Key!' where business_id = $1", [biz]));
  await assert.rejects(pg.query("insert into public.lead_statuses (business_id, key, label, type) values ($1, 's_x', 'X', 'boss')", [biz]));
  await assert.rejects(pg.query("update public.lead_statuses set type = 'working' where business_id = $1 and key = 'new'", [biz]), /new_is_new/);
  // Server-only: the browser can't read anyone's list directly.
  const staffUser = (await pg.query("insert into auth.users (email) values ('owner@sunrise.test') returning id")).rows[0].id;
  await pg.query("insert into public.staff_members (user_id, email, role, business_id) values ($1, 'owner@sunrise.test', 'owner', $2)", [staffUser, biz]);
  await assert.rejects(asUser(pg, staffUser, () => pg.query('select * from public.lead_statuses')));
});
