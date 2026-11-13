// Staff profiles and team performance: the per-person numbers and ranking, who may see what (agents see
// only their own numbers; colleagues' phone numbers only for managers; never another business), and
// saving "My profile". Fake database; the real migration on PGlite for the table rules.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-000000000002';
process.env.APP_SECRET = 'server_encryption_secret_long_enough';
process.env.VITE_SUPABASE_URL = 'http://fake.supabase';
process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
process.env.WHATSAPP_BUSINESS_ID = A;

const app = require('../server/app.cjs');
const stats = require('../server/staffStats.cjs');
const limits = require('../server/limits.cjs');
const { _setStaffForToken } = require('../server/auth.cjs');
const { freshDb, asUser } = require('./helpers/pgHarness.cjs');

const OWNER = 'd0000000-0000-4000-8000-000000000001';
const RAVI = 'd0000000-0000-4000-8000-000000000002';
const SITA = 'd0000000-0000-4000-8000-000000000003';
const OTHER = 'd0000000-0000-4000-8000-000000000009';
const now = Date.now();
const ago = (h) => new Date(now - h * 3600000).toISOString();

let db;
function seed() {
  db = {
    businesses: [{ id: A, name: 'Arogya', status: 'active', plan_id: 'pro', limit_overrides: {} }, { id: B, name: 'Mayura', status: 'active', plan_id: 'pro', limit_overrides: {} }],
    plans: [{ id: 'pro', name: 'Pro', analytics_days: 90 }],
    staff_members: [
      { business_id: A, user_id: OWNER, email: 'owner@arogya.test', role: 'owner', created_at: ago(900) },
      { business_id: A, user_id: RAVI, email: 'ravi@arogya.test', role: 'agent', created_at: ago(800) },
      { business_id: A, user_id: SITA, email: 'sita@arogya.test', role: 'agent', created_at: ago(700) },
      { business_id: B, user_id: OTHER, email: 'x@mayura.test', role: 'agent', created_at: ago(700) },
    ],
    staff_profiles: [
      { user_id: SITA, business_id: A, full_name: 'Sita Devi', phone: '+91 90000 00003', job_title: 'Support lead', languages: 'Telugu' },
      { user_id: OTHER, business_id: B, full_name: 'Mayura person', phone: '+91 1111111111' },
    ],
    whatsapp_messages: [
      // Customer 1: waits 10 min for Ravi; customer 2: 4 min for Ravi; customer 3: 2 min for Sita
      { business_id: A, contact_phone: '1', direction: 'inbound', timestamp: ago(30) },
      { business_id: A, contact_phone: '1', direction: 'outbound', sent_by: null, timestamp: ago(29.99) }, // the bot: doesn't stop the clock
      { business_id: A, contact_phone: '1', direction: 'outbound', sent_by: 'ravi@arogya.test', timestamp: new Date(Date.parse(ago(30)) + 10 * 60000).toISOString() },
      { business_id: A, contact_phone: '2', direction: 'inbound', timestamp: ago(5) },
      { business_id: A, contact_phone: '2', direction: 'outbound', sent_by: 'RAVI@arogya.test', timestamp: new Date(Date.parse(ago(5)) + 4 * 60000).toISOString() },
      { business_id: A, contact_phone: '3', direction: 'inbound', timestamp: ago(2) },
      { business_id: A, contact_phone: '3', direction: 'outbound', sent_by: 'sita@arogya.test', timestamp: new Date(Date.parse(ago(2)) + 2 * 60000).toISOString() },
      { business_id: B, contact_phone: '9', direction: 'outbound', sent_by: 'x@mayura.test', timestamp: ago(1) },
    ],
    whatsapp_leads: [
      { business_id: A, phone: '1', assigned_to: 'ravi@arogya.test', stage: 'ordered', stage_changed_at: ago(20) },
      { business_id: A, phone: '2', assigned_to: 'ravi@arogya.test', stage: 'interested', stage_changed_at: ago(4) },
      { business_id: A, phone: '4', assigned_to: 'ravi@arogya.test', stage: 'completed', stage_changed_at: ago(24 * 60) }, // 60 days ago: not in 30 days
      { business_id: A, phone: '3', assigned_to: 'sita@arogya.test', stage: 'lost', stage_changed_at: ago(1) },
    ],
    queries: [
      { business_id: A, assigned_to: 'sita@arogya.test', stage: 'resolved', resolved_at: ago(3), rating: 5 },
      { business_id: A, assigned_to: 'sita@arogya.test', stage: 'resolved', resolved_at: ago(3), rating: 4 },
      { business_id: A, assigned_to: 'sita@arogya.test', stage: 'in_progress', resolved_at: null },
    ],
    lead_notes: [{ business_id: A, author: 'sita@arogya.test', created_at: ago(2) }],
    whatsapp_calls: [{ business_id: A, answered_by: 'ravi@arogya.test', status: 'ended', duration_sec: 125, created_at: ago(6) }],
  };
  limits.clearCache();
}

const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
function matches(row, params) {
  for (const [k, raw] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k)) continue;
    const i = raw.indexOf('.');
    const op = raw.slice(0, i);
    const val = raw.slice(i + 1);
    const v = row[k];
    if (op === 'eq' && String(v) !== val) return false;
    if (op === 'gte' && !(v && String(v) >= val)) return false;
    if (op === 'not' && val === 'is.null' && v == null) return false;
    if (op === 'is' && val === 'null' && v != null) return false;
  }
  return true;
}
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  if (!u.startsWith('http://fake.supabase/rest/v1/')) return json({ error: { message: 'offline in tests' } }, 503);
  const [path, qs = ''] = u.slice('http://fake.supabase/rest/v1/'.length).split('?');
  const params = [...new URLSearchParams(qs).entries()];
  const body = opts.body ? JSON.parse(opts.body) : null;
  if (path.startsWith('rpc/')) return json([]);
  const rows = (db[path] ||= []);
  if (method === 'GET') {
    const offset = Number(params.find(([k]) => k === 'offset')?.[1] || 0);
    return json(rows.filter(r => matches(r, params)).slice(offset));
  }
  if (method === 'POST') {
    const out = [];
    for (const r of Array.isArray(body) ? body : [body]) {
      if (path === 'staff_profiles') { const ex = rows.find(x => x.user_id === r.user_id); if (ex) { Object.assign(ex, r); out.push(ex); continue; } }
      rows.push(r); out.push(r);
    }
    return json(out, 201);
  }
  return json([]);
};

let server, base;
before(async () => { server = app.listen(0); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
beforeEach(seed);

function request(method, path, token, body) {
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
const who = (id, email, role, biz = A) => ({ id, email, role, businessId: biz, businessName: biz === A ? 'Arogya' : 'Mayura' });
_setStaffForToken('owner', who(OWNER, 'owner@arogya.test', 'owner'));
_setStaffForToken('ravi', who(RAVI, 'ravi@arogya.test', 'agent'));
_setStaffForToken('sita', who(SITA, 'sita@arogya.test', 'agent'));
_setStaffForToken('mayura', who(OTHER, 'x@mayura.test', 'owner', B));

test('the numbers per person: replies, chats, response time, conversions, queries, calls, notes, points and ranking', async () => {
  const r = await request('GET', '/api/team/performance?days=30', 'owner');
  assert.strictEqual(r.status, 200, r.text);
  const d = r.json();
  const ravi = d.members.find(m => m.email === 'ravi@arogya.test');
  const sita = d.members.find(m => m.email === 'sita@arogya.test');
  const owner = d.members.find(m => m.email === 'owner@arogya.test');
  assert.deepStrictEqual(
    [ravi.repliesSent, ravi.chatsHandled, ravi.medianResponseMin, ravi.conversions, ravi.openChats, ravi.calls, ravi.talkMin],
    [2, 2, 7, 1, 2, 1, 2], 'Ravi: the bot reply does not stop the clock; a 60-day-old conversion is outside 30 days; sent_by case does not matter');
  assert.deepStrictEqual(
    [sita.repliesSent, sita.chatsHandled, sita.medianResponseMin, sita.queriesResolved, sita.openQueries, sita.avgRating, sita.notes, sita.openChats],
    [1, 1, 2, 2, 1, 4.5, 1, 0]);
  // Points: Ravi 2x2 + 1x10 + 1x3 = 17; Sita 1x2 + 2x5 + 1 = 13; owner 0.
  assert.deepStrictEqual([ravi.points, sita.points, owner.points], [17, 13, 0]);
  assert.deepStrictEqual(d.members.map(m => [m.email, m.rank]), [['ravi@arogya.test', 1], ['sita@arogya.test', 2], ['owner@arogya.test', 3]]);
  assert.strictEqual(sita.fullName, 'Sita Devi');
  assert.strictEqual(sita.phone, undefined, 'the ranking list has no phone numbers');
  assert.deepStrictEqual(d.team.chatsHandled, 3);
  assert.ok(!r.text.includes('mayura'), 'no other business in the ranking');
  assert.strictEqual(ravi.daily.length, 30);
  assert.strictEqual(ravi.daily.reduce((n, x) => n + x.replies, 0), 2);
});

test('equal results share a rank', () => {
  const r = stats.computeStats({
    staff: [{ user_id: '1', email: 'a@x' }, { user_id: '2', email: 'b@x' }, { user_id: '3', email: 'c@x' }],
    messages: [], leads: [], queries: [], notes: [], calls: [], from: ago(24),
  });
  assert.deepStrictEqual(r.members.map(m => m.rank), [1, 1, 1]);
});

test('agents: only their own numbers and their place; never the ranking or a colleague', async () => {
  const me = await request('GET', '/api/me/profile?days=30', 'ravi');
  assert.strictEqual(me.status, 200, me.text);
  const d = me.json();
  assert.strictEqual(d.stats.email, 'ravi@arogya.test');
  assert.deepStrictEqual([d.stats.rank, d.teamSize], [1, 3]);
  assert.ok(!me.text.includes('sita@arogya.test') && !me.text.includes('Sita Devi'), 'no colleague data on my profile');
  assert.strictEqual((await request('GET', '/api/team/performance', 'ravi')).status, 403);
  assert.strictEqual((await request('GET', `/api/team/members/${SITA}`, 'ravi')).status, 403);
  // The team list (assignee menu) shows names and titles, never phone numbers.
  const team = await request('GET', '/api/team', 'ravi');
  assert.strictEqual(team.json().staff.find(s => s.email === 'sita@arogya.test').full_name, 'Sita Devi');
  assert.ok(!team.text.includes('90000 00003'));
});

test('managers: one member\'s details include their phone; another business\'s member is not found', async () => {
  const m = await request('GET', `/api/team/members/${SITA}?days=30`, 'owner');
  assert.strictEqual(m.status, 200, m.text);
  assert.deepStrictEqual([m.json().member.phone, m.json().member.jobTitle, m.json().member.rank], ['+91 90000 00003', 'Support lead', 2]);
  assert.strictEqual((await request('GET', `/api/team/members/${OTHER}`, 'owner')).status, 404);
  assert.strictEqual((await request('GET', `/api/team/members/${SITA}`, 'mayura')).status, 404, 'Mayura can\'t see Arogya\'s staff');
  assert.strictEqual((await request('GET', '/api/team/members/not-a-uuid', 'owner')).status, 400);
});

test('My profile: save my own details; bad input refused; I can\'t change someone else\'s', async () => {
  const r = await request('PUT', '/api/me/profile', 'ravi', { fullName: '  Ravi   Kumar ', phone: '+91 98765 43210', jobTitle: 'Sales', languages: 'Telugu, English', userId: SITA });
  assert.strictEqual(r.status, 200, r.text);
  const saved = db.staff_profiles.find(p => p.user_id === RAVI);
  assert.deepStrictEqual([saved.full_name, saved.phone, saved.business_id], ['Ravi Kumar', '+91 98765 43210', A]);
  assert.strictEqual(db.staff_profiles.find(p => p.user_id === SITA).full_name, 'Sita Devi', 'a userId in the body is ignored');
  assert.strictEqual((await request('PUT', '/api/me/profile', 'ravi', { phone: 'call me maybe' })).status, 400);
  assert.strictEqual((await request('PUT', '/api/me/profile', 'ravi', { fullName: 'x'.repeat(81) })).status, 400);
  assert.strictEqual((await request('PUT', '/api/me/profile', 'ravi', { jobTitle: { evil: true } })).status, 400);
  const me = (await request('GET', '/api/me/profile', 'ravi')).json();
  assert.strictEqual(me.profile.fullName, 'Ravi Kumar');
});

test('migration: staff_profiles is server-only and goes with the staff member', async () => {
  const pg = await freshDb();
  const u = await pg.query("insert into auth.users (email) values ('ravi@arogya.test') returning id");
  await pg.query("insert into public.staff_members (user_id, email, role, business_id) values ($1, 'ravi@arogya.test', 'agent', $2)", [u.rows[0].id, A]);
  await pg.query("insert into public.staff_profiles (user_id, business_id, full_name, phone) values ($1, $2, 'Ravi', '+91 1')", [u.rows[0].id, A]);
  await assert.rejects(asUser(pg, u.rows[0].id, () => pg.query('select * from public.staff_profiles')), /permission denied/);
  await pg.query('delete from public.staff_members where user_id = $1', [u.rows[0].id]);
  assert.strictEqual((await pg.query('select count(*)::int as n from public.staff_profiles')).rows[0].n, 0);
});
