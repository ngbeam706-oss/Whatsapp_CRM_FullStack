// Automatic lead assignment (docs/progress/lead-assignment.md): round-robin / least busy, only unassigned chats,
// skips Away / off shift / at the cap, per-number teams, Off = unchanged, agents can't change settings, tenancy, and the
// SQL function gives one assignee when messages arrive at once.
// Part 1: pure rules. Part 2: the SQL function on PGlite. Part 3: the API with a fake database.
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
const la = require('../server/leadAssignment.cjs');
const { _setStaffForToken } = require('../server/auth.cjs');

// ---------------------------------------------------------------------------------------------
// Part 1: pure rules
// ---------------------------------------------------------------------------------------------
// 2026-11-16 is a Monday; 10:00 IST = 04:30 UTC.
const MON_10 = Date.parse('2026-11-16T04:30:00Z');
const MON_22 = Date.parse('2026-11-16T16:30:00Z');
const WINDOW = { start: 9, end: 20 };

test('on shift: own days and hours in India time, else the business window; night shifts wrap', () => {
  const a = la.defaultAvailability('a@x.test');
  assert.equal(la.onShift(a, WINDOW, MON_10), true);
  assert.equal(la.onShift(a, WINDOW, MON_22), false, '22:00 is after the 9-20 window');
  assert.equal(la.onShift({ ...a, days: [0, 6] }, WINDOW, MON_10), false, 'weekends only');
  assert.equal(la.onShift({ ...a, start_hour: 21, end_hour: 6 }, WINDOW, MON_22), true, 'night shift');
  assert.equal(la.onShift({ ...a, start_hour: 21, end_hour: 6 }, WINDOW, MON_10), false);
});

test('candidates skip Away, off shift, at the cap and people no longer on the team; least busy sorts by open chats', () => {
  const team = ['a@x.test', 'b@x.test', 'c@x.test', 'd@x.test', 'gone@x.test'];
  const staff = new Set(['a@x.test', 'b@x.test', 'c@x.test', 'd@x.test']);
  const availability = new Map([
    ['b@x.test', { email: 'b@x.test', available: false, days: [0, 1, 2, 3, 4, 5, 6], start_hour: null, end_hour: null }],
    ['c@x.test', { email: 'c@x.test', available: true, days: [0, 6], start_hour: null, end_hour: null }],
  ]);
  const open = new Map([['a@x.test', 5], ['d@x.test', 1]]);
  const rr = la.pickCandidates({ mode: 'round_robin', team, staff, availability, open, maxOpen: null, window: WINDOW, now: MON_10 });
  assert.deepEqual(rr.candidates, ['a@x.test', 'd@x.test']);
  assert.deepEqual(rr.skipped.map(s => [s.email, s.why]), [['b@x.test', 'away'], ['c@x.test', 'off_shift'], ['gone@x.test', 'not_staff']]);
  const capped = la.pickCandidates({ mode: 'round_robin', team, staff, availability, open, maxOpen: 5, window: WINDOW, now: MON_10 });
  assert.deepEqual(capped.candidates, ['d@x.test']);
  const lb = la.pickCandidates({ mode: 'least_busy', team, staff, availability, open, maxOpen: null, window: WINDOW, now: MON_10 });
  assert.deepEqual(lb.candidates, ['d@x.test', 'a@x.test']);
});

test('per-number teams: a number with its own team uses it; others use the default team', () => {
  const members = [{ email: 'a@x.test', phone_number_id: '' }, { email: 'p@x.test', phone_number_id: '222222' }];
  assert.deepEqual(la.teamFor(members, true, '222222'), { team: ['p@x.test'], key: '222222' });
  assert.deepEqual(la.teamFor(members, true, '333333'), { team: ['a@x.test'], key: '' });
  assert.deepEqual(la.teamFor(members, false, '222222'), { team: ['a@x.test'], key: '' });
});

// ---------------------------------------------------------------------------------------------
// Part 2: the SQL function (real Postgres rules)
// ---------------------------------------------------------------------------------------------
test('SQL: takes turns fairly, never reassigns, one assignee when two messages race, server-only', async () => {
  const { freshDb, migrationSql, asUser } = require('./helpers/pgHarness.cjs');
  const pg = await freshDb();
  await pg.exec(migrationSql('20261136_lead_assignment.sql')); // safe to re-run
  const biz = (await pg.query("insert into public.businesses (name, slug, plan_id) values ('Sunrise Clinic', 'sunrise-clinic', 'growth') returning id")).rows[0].id;
  await pg.query("insert into public.lead_assignment_settings (business_id, mode) values ($1, 'round_robin')", [biz]);
  for (const p of ['919000000001', '919000000002', '919000000003', '919000000004']) {
    await pg.query('insert into public.whatsapp_leads (phone, name, business_id) values ($1, $2, $3)', [p, p, biz]);
  }
  const team = ['a@sun.test', 'b@sun.test', 'c@sun.test'];
  const assign = (phone, candidates = team) => pg.query('select public.assign_lead_by_rotation($1, $2, $3, $4, $5, $6) as who', [biz, phone, '', team, candidates, 'round_robin']).then(r => r.rows[0].who);
  assert.equal(await assign('919000000001'), 'a@sun.test');
  assert.equal(await assign('919000000002'), 'b@sun.test');
  // c is away: skipped, back to a.
  assert.equal(await assign('919000000003', ['a@sun.test', 'b@sun.test']), 'a@sun.test');
  // Two messages for the same chat at once: the second gets nothing and the chat keeps its assignee.
  const [x, y] = await Promise.all([assign('919000000004'), assign('919000000004')]);
  assert.deepEqual([x, y].filter(Boolean).length, 1);
  assert.equal((await pg.query("select assigned_to from public.whatsapp_leads where phone = '919000000004'")).rows[0].assigned_to, x || y);
  // An assigned chat is never taken away.
  assert.equal(await assign('919000000001'), null);
  assert.equal((await pg.query("select assigned_to from public.whatsapp_leads where phone = '919000000001'")).rows[0].assigned_to, 'a@sun.test');
  // Nobody available: nothing happens.
  await pg.query("insert into public.whatsapp_leads (phone, name, business_id) values ('919000000005', 'x', $1)", [biz]);
  assert.equal(await assign('919000000005', []), null);
  // Server-only.
  const u = (await pg.query("insert into auth.users (email) values ('owner@sun.test') returning id")).rows[0].id;
  await pg.query("insert into public.staff_members (user_id, email, role, business_id) values ($1, 'owner@sun.test', 'owner', $2)", [u, biz]);
  await assert.rejects(asUser(pg, u, () => pg.query('select * from public.lead_assignment_settings')));
  await assert.rejects(asUser(pg, u, () => pg.query("select public.assign_lead_by_rotation($1, '919000000005', '', '{}', '{}', 'round_robin')", [biz])));
});

// ---------------------------------------------------------------------------------------------
// Part 3: the API (fake database; the SQL function emulated with the same rules)
// ---------------------------------------------------------------------------------------------
let db;
function seed() {
  db = {
    businesses: [{ id: SUN, name: 'Sunrise Clinic', status: 'active', send_window_start: 0, send_window_end: 24 }, { id: LOTUS, name: 'Lotus Foods', status: 'active' }],
    staff_members: [
      { business_id: SUN, email: 'manager@sun.test', role: 'manager' }, { business_id: SUN, email: 'a@sun.test', role: 'agent' }, { business_id: SUN, email: 'b@sun.test', role: 'agent' },
      { business_id: LOTUS, email: 'x@lotus.test', role: 'agent' },
    ],
    lead_assignment_settings: [], lead_assignment_members: [], lead_assignment_pointers: [], staff_availability: [],
    whatsapp_leads: [
      { business_id: SUN, phone: '919000000001', assigned_to: null, last_phone_number_id: null },
      { business_id: SUN, phone: '919000000002', assigned_to: 'b@sun.test', last_phone_number_id: null },
      { business_id: SUN, phone: '919000000003', assigned_to: null, last_phone_number_id: '222222' },
    ],
    lead_notes: [], audit_log: [], whatsapp_numbers: [],
  };
  require('../server/business.cjs');
}
const SKIP = new Set(['select', 'order', 'limit', 'offset', 'on_conflict']);
function matcher(u) {
  const filters = [...new URL(u).searchParams.entries()].filter(([k]) => !SKIP.has(k));
  return (r) => filters.every(([k, v]) => {
    const val = r[k] === undefined || r[k] === null ? null : String(r[k]);
    if (v.startsWith('eq.')) return val === v.slice(3);
    if (v === 'is.null') return val === null;
    return true;
  });
}
const json = (d, status = 200, headers = {}) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json', ...headers } });
let rpcCalls = [];
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  const body = opts.body ? JSON.parse(opts.body) : null;
  if (!u.startsWith('http://fake.supabase/rest/v1/')) return json({}, 503);
  const table = u.slice('http://fake.supabase/rest/v1/'.length).split('?')[0];
  if (table === 'rpc/assign_lead_by_rotation') {
    rpcCalls.push(body);
    const lead = db.whatsapp_leads.find(l => l.business_id === body.p_business && l.phone === body.p_phone);
    if (!lead || lead.assigned_to || !body.p_candidates.length) return json(null);
    const ptr = db.lead_assignment_pointers.find(p => p.business_id === body.p_business && p.phone_number_id === body.p_number);
    let pick = body.p_candidates[0];
    if (body.p_mode === 'round_robin') {
      const at = body.p_team.indexOf(ptr?.last_email);
      for (let k = 1; k <= body.p_team.length; k++) { const t = body.p_team[(at + k + body.p_team.length) % body.p_team.length]; if (body.p_candidates.includes(t)) { pick = t; break; } }
    }
    lead.assigned_to = pick;
    if (ptr) ptr.last_email = pick; else db.lead_assignment_pointers.push({ business_id: body.p_business, phone_number_id: body.p_number, last_email: pick });
    return json(pick);
  }
  if (table.startsWith('rpc/')) return json([]);
  const rows = db[table] || (db[table] = []);
  const match = matcher(u);
  if (method === 'GET') {
    const hit = rows.filter(match);
    if (/[?&]limit=0/.test(u)) return json([], 200, { 'Content-Range': `*/${hit.length}` });
    return json(hit);
  }
  if (method === 'POST') {
    const list = (Array.isArray(body) ? body : [body]).map(r => ({ ...r }));
    for (const r of list) {
      const keyCols = table === 'lead_assignment_settings' ? ['business_id'] : table === 'staff_availability' ? ['business_id', 'email'] : null;
      const ex = keyCols && rows.find(x => keyCols.every(k => x[k] === r[k]));
      if (ex) Object.assign(ex, r); else rows.push(r);
    }
    return json(list, 201);
  }
  if (method === 'PATCH') { const hit = rows.filter(match); hit.forEach(r => Object.assign(r, body)); return json(hit); }
  if (method === 'DELETE') { const hit = rows.filter(match); db[table] = rows.filter(r => !hit.includes(r)); return json(hit); }
  return json([]);
};

let server, base;
before(async () => { server = app.listen(0); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
beforeEach(() => { seed(); rpcCalls = []; });
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
_setStaffForToken('la-manager', { id: 'u-m', email: 'manager@sun.test', role: 'manager', businessId: SUN, businessName: 'Sunrise Clinic' });
_setStaffForToken('la-agent', { id: 'u-a', email: 'a@sun.test', role: 'agent', businessId: SUN, businessName: 'Sunrise Clinic' });

test('Off (the default): nothing is assigned automatically', async () => {
  assert.deepEqual(await la.assignIfDue(SUN, '919000000001'), { assigned: null });
  assert.equal(rpcCalls.length, 0);
  assert.equal(db.whatsapp_leads[0].assigned_to, null);
});

test('agents can\'t read or change the settings; anyone sets their own Available / Away', async () => {
  assert.equal((await request('GET', '/api/lead-assignment', 'la-agent')).status, 403);
  assert.equal((await request('PUT', '/api/lead-assignment', 'la-agent', { mode: 'round_robin' })).status, 403);
  assert.equal(db.lead_assignment_settings.length, 0);
  const away = await request('PUT', '/api/me/availability', 'la-agent', { available: false, days: [1, 2, 3], startHour: 10, endHour: 18 });
  assert.equal(away.status, 200, away.text);
  assert.deepEqual(db.staff_availability.map(a => [a.business_id, a.email, a.available, a.start_hour]), [[SUN, 'a@sun.test', false, 10]]);
  assert.equal((await request('PUT', '/api/me/availability', 'la-agent', { days: [] })).status, 400);
});

test('round-robin through the API: team saved and audited, chats take turns, Away people skipped, assigned chats kept', async () => {
  const put = await request('PUT', '/api/lead-assignment', 'la-manager', { mode: 'round_robin', maxOpen: null, teams: [{ numberId: '', members: ['a@sun.test', 'b@sun.test'] }] });
  assert.equal(put.status, 200, put.text);
  assert.ok(db.audit_log.some(a => a.action === 'lead_assignment.updated' && a.details.fields.includes('teams') && !JSON.stringify(a.details).includes('a@sun.test')));
  // Someone from another business can't be put in the team.
  assert.equal((await request('PUT', '/api/lead-assignment', 'la-manager', { teams: [{ numberId: '', members: ['x@lotus.test'] }] })).status, 400);

  assert.deepEqual(await la.assignIfDue(SUN, '919000000001'), { assigned: 'a@sun.test' });
  assert.ok(db.lead_notes.some(n => n.phone === '919000000001' && /by rotation/.test(n.body)), 'timeline note');
  // Already assigned: untouched, no SQL call.
  const before = rpcCalls.length;
  assert.deepEqual(await la.assignIfDue(SUN, '919000000002'), { assigned: null });
  assert.equal(rpcCalls.length, before);
  assert.equal(db.whatsapp_leads[1].assigned_to, 'b@sun.test');
  // b is Away: a gets the next one.
  db.staff_availability.push({ business_id: SUN, email: 'b@sun.test', available: false, days: [0, 1, 2, 3, 4, 5, 6] });
  db.whatsapp_leads.push({ business_id: SUN, phone: '919000000009', assigned_to: null });
  assert.deepEqual(await la.assignIfDue(SUN, '919000000009'), { assigned: 'a@sun.test' });
  // Everybody away: stays unassigned.
  db.staff_availability.push({ business_id: SUN, email: 'a@sun.test', available: false, days: [0, 1, 2, 3, 4, 5, 6] });
  db.whatsapp_leads.push({ business_id: SUN, phone: '919000000010', assigned_to: null });
  assert.deepEqual(await la.assignIfDue(SUN, '919000000010'), { assigned: null, nobody: true });
  assert.equal(db.whatsapp_leads.at(-1).assigned_to, null);
  const view = await request('GET', '/api/lead-assignment', 'la-manager');
  assert.deepEqual(view.json.teams[0].availableNow, []);
});

test('at the cap: skipped; least busy picks whoever has the fewest open chats', async () => {
  db.lead_assignment_settings.push({ business_id: SUN, mode: 'least_busy', max_open: 2, per_number: false });
  db.lead_assignment_members.push({ business_id: SUN, phone_number_id: '', email: 'a@sun.test', sort_order: 1 }, { business_id: SUN, phone_number_id: '', email: 'b@sun.test', sort_order: 2 });
  db.whatsapp_leads.push({ business_id: SUN, phone: '919000000020', assigned_to: 'a@sun.test' }, { business_id: SUN, phone: '919000000021', assigned_to: 'a@sun.test' });
  // a has 2 (at the cap), b has 1: b.
  assert.deepEqual(await la.assignIfDue(SUN, '919000000001'), { assigned: 'b@sun.test' });
  assert.equal(rpcCalls.at(-1).p_mode, 'least_busy');
  assert.deepEqual(rpcCalls.at(-1).p_candidates, ['b@sun.test']);
});

test('per-number teams: a chat on a number with its own team goes to that team', async () => {
  db.lead_assignment_settings.push({ business_id: SUN, mode: 'round_robin', max_open: null, per_number: true });
  db.lead_assignment_members.push({ business_id: SUN, phone_number_id: '', email: 'a@sun.test', sort_order: 1 }, { business_id: SUN, phone_number_id: '222222', email: 'b@sun.test', sort_order: 1 });
  assert.deepEqual(await la.assignIfDue(SUN, '919000000003'), { assigned: 'b@sun.test' });
  assert.equal(rpcCalls.at(-1).p_number, '222222');
  assert.deepEqual(await la.assignIfDue(SUN, '919000000001'), { assigned: 'a@sun.test' });
  assert.equal(rpcCalls.at(-1).p_number, '');
});

test('tenancy: another business\'s settings and people are never used', async () => {
  db.lead_assignment_settings.push({ business_id: LOTUS, mode: 'round_robin', per_number: false });
  db.lead_assignment_members.push({ business_id: LOTUS, phone_number_id: '', email: 'x@lotus.test', sort_order: 1 });
  assert.deepEqual(await la.assignIfDue(SUN, '919000000001'), { assigned: null }, 'Sunrise is Off');
  db.lead_assignment_settings.push({ business_id: SUN, mode: 'round_robin', per_number: false });
  assert.deepEqual(await la.assignIfDue(SUN, '919000000001'), { assigned: null, nobody: true }, 'Sunrise has no team of its own');
});
