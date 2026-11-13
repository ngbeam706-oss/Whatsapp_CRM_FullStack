// Staff onboarding details (server/staffStats.cjs): the Business Admin and managers fill in a team member's
// details when adding them and edit them later. Who may edit: the Business Admin -> managers and agents;
// managers -> agents only; never another Business Admin, never yourself here (use My profile), never another
// business. Who may see private details (address, emergency contact, employee details): the person, the Business
// Admin, and managers for agents. Employee ID / joining date / branch can't be set from My profile. Audit logs say
// which fields changed, never the values.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-000000000002';
process.env.APP_SECRET = 'server_encryption_secret_long_enough';
process.env.VITE_SUPABASE_URL = 'http://fake.supabase';
process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';

const app = require('../server/app.cjs');
const limits = require('../server/limits.cjs');
const stats = require('../server/staffStats.cjs');
const { _setStaffForToken } = require('../server/auth.cjs');
const { freshDb, asUser } = require('./helpers/pgHarness.cjs');

const OWNER = 'd0000000-0000-4000-8000-000000000101';
const MANAGER = 'd0000000-0000-4000-8000-000000000102';
const AGENT = 'd0000000-0000-4000-8000-000000000103';
const OWNER2 = 'd0000000-0000-4000-8000-000000000104';
const MANAGER2 = 'd0000000-0000-4000-8000-000000000105';
const OTHER = 'd0000000-0000-4000-8000-000000000201'; // an agent of business B

let db, auth;
function seed() {
  db = {
    businesses: [{ id: A, name: 'Sunrise Clinic', status: 'active', plan_id: 'pro', limit_overrides: {} }, { id: B, name: 'Other', status: 'active', plan_id: 'pro', limit_overrides: {} }],
    plans: [{ id: 'pro', name: 'Pro', max_staff: 20 }],
    staff_members: [
      { business_id: A, user_id: OWNER, email: 'owner@sunrise.test', role: 'owner', created_at: '2026-01-01T00:00:00Z' },
      { business_id: A, user_id: MANAGER, email: 'manager@sunrise.test', role: 'manager', created_at: '2026-01-02T00:00:00Z' },
      { business_id: A, user_id: AGENT, email: 'ravi@sunrise.test', role: 'agent', created_at: '2026-01-03T00:00:00Z' },
      { business_id: A, user_id: OWNER2, email: 'owner2@sunrise.test', role: 'owner', created_at: '2026-01-04T00:00:00Z' },
      { business_id: A, user_id: MANAGER2, email: 'manager2@sunrise.test', role: 'manager', created_at: '2026-01-05T00:00:00Z' },
      { business_id: B, user_id: OTHER, email: 'x@other.test', role: 'agent', created_at: '2026-01-06T00:00:00Z' },
    ],
    staff_profiles: [
      { user_id: MANAGER2, business_id: A, full_name: 'Meena', phone: '+91 90000 11111', address: 'Flat 2, Road 5', emergency_contact_name: 'Raj (husband)', emergency_contact_phone: '+91 90000 22222', employee_code: 'SC-0002' },
      { user_id: OTHER, business_id: B, full_name: 'Elsewhere', address: 'Secret street' },
    ],
    audit_log: [],
  };
  auth = { created: [] };
  limits.clearCache();
}

const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
function matches(row, params) {
  for (const [k, raw] of params) {
    if (['select', 'order', 'limit', 'on_conflict', 'or'].includes(k)) continue;
    const i = raw.indexOf('.'); const op = raw.slice(0, i); const val = raw.slice(i + 1);
    if (op === 'eq' && String(row[k]) !== val) return false;
    if (op === 'gte' && !(String(row[k] || '') >= val)) return false;
  }
  return true;
}
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  const body = opts.body ? JSON.parse(opts.body) : null;
  if (u.startsWith('http://fake.supabase/auth/v1/admin/users')) {
    auth.created.push(body);
    return json({ id: `e0000000-0000-4000-8000-00000000000${auth.created.length}`, email: body.email });
  }
  if (!u.startsWith('http://fake.supabase/rest/v1/')) return json({}, 503);
  const [path, qs = ''] = u.slice('http://fake.supabase/rest/v1/'.length).split('?');
  const params = [...new URLSearchParams(qs).entries()];
  if (path.startsWith('rpc/')) return json([]);
  const rows = (db[path] ||= []);
  if (method === 'GET') return json(rows.filter(r => matches(r, params)));
  if (method === 'POST') {
    const list = (Array.isArray(body) ? body : [body]).map(x => ({ ...x }));
    const out = [];
    for (const r of list) {
      if (path === 'staff_profiles') {
        if (r.employee_code && rows.some(x => x.user_id !== r.user_id && x.business_id === r.business_id && String(x.employee_code || '').toLowerCase() === r.employee_code.toLowerCase())) return json({ code: '23505', message: 'duplicate key value violates unique constraint' }, 409);
        const ex = rows.find(x => x.user_id === r.user_id);
        if (ex) { Object.assign(ex, r); out.push(ex); continue; }
      }
      rows.push(r); out.push(r);
    }
    return json(out, 201);
  }
  if (method === 'PATCH') { const hit = rows.filter(r => matches(r, params)); hit.forEach(r => Object.assign(r, body)); return json(hit); }
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
      (res) => { let t = ''; res.on('data', c => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, json: () => (t ? JSON.parse(t) : null) })); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const tok = (id, email, role, biz = A) => _setStaffForToken(`t-${id}`, { id, email, role, businessId: biz, businessName: 'x' });
tok(OWNER, 'owner@sunrise.test', 'owner');
tok(MANAGER, 'manager@sunrise.test', 'manager');
tok(AGENT, 'ravi@sunrise.test', 'agent');
const profileOf = (id) => db.staff_profiles.find(p => p.user_id === id);
const DETAILS = { jobTitle: 'Front desk', employeeCode: 'SC-0042', joinedOn: '2026-11-10', workLocation: 'Main branch', phone: '+91 98765 43210', languages: 'Telugu, English', address: 'H.No 4-5, Road 2,\nKukatpally 500072', emergencyContactName: 'Lakshmi (mother)', emergencyContactPhone: '+91 91234 56789' };

test('pure: every field checked; admin-only fields ignored from My profile; empty clears', () => {
  const ok = stats.cleanProfile({ ...DETAILS, fullName: '  Ravi  Kumar ' }, { admin: true });
  assert.ok('values' in ok, JSON.stringify(ok));
  assert.deepStrictEqual([ok.values.full_name, ok.values.employee_code, ok.values.joined_on, ok.values.address], ['Ravi Kumar', 'SC-0042', '2026-11-10', 'H.No 4-5, Road 2,\nKukatpally 500072']);
  const self = stats.cleanProfile({ employeeCode: 'X', joinedOn: '2026-01-01', workLocation: 'Y', address: 'Home' }, { admin: false });
  assert.deepStrictEqual(self.values, { address: 'Home' }, 'employee ID, joining date and branch are not taken from My profile');
  assert.match(stats.cleanProfile({ emergencyContactPhone: 'call Lakshmi' }, { admin: true }).error, /Emergency contact phone: digits only/);
  assert.match(stats.cleanProfile({ joinedOn: '10/11/2026' }, { admin: true }).error, /Joining date: choose a date/);
  assert.match(stats.cleanProfile({ joinedOn: '2099-01-01' }, { admin: true }).error, /doesn't look right/);
  assert.match(stats.cleanProfile({ address: '<script>' }, { admin: true }).error, /not allowed/);
  assert.match(stats.cleanProfile({ address: 'x'.repeat(201) }, { admin: true }).error, /longer than 200/);
  assert.deepStrictEqual(stats.cleanProfile({ address: '', phone: null }, { admin: true }).values, { address: null, phone: null });
});

test('add a team member with onboarding details: saved with the login, by whom; a mistake creates no login', async () => {
  const bad = await request('POST', '/api/team/members', 't-' + MANAGER, { email: 'sita@sunrise.test', password: 'Secret123pass', role: 'agent', fullName: 'Sita', profile: { ...DETAILS, emergencyContactPhone: 'nope' } });
  assert.strictEqual(bad.status, 400);
  assert.match(bad.json().error, /Emergency contact phone/);
  assert.strictEqual(auth.created.length, 0, 'no login was created');

  const ok = await request('POST', '/api/team/members', 't-' + MANAGER, { email: 'sita@sunrise.test', password: 'Secret123pass', role: 'agent', fullName: 'Sita Devi', profile: DETAILS });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.json()));
  const id = ok.json().member.user_id;
  const p = profileOf(id);
  assert.deepStrictEqual([p.full_name, p.employee_code, p.joined_on, p.work_location, p.emergency_contact_name, p.updated_by, p.business_id], ['Sita Devi', 'SC-0042', '2026-11-10', 'Main branch', 'Lakshmi (mother)', 'manager@sunrise.test', A]);
  assert.doesNotMatch(JSON.stringify(ok.json()), /Secret123pass/);
});

test('who may edit: Business Admin -> managers and agents; managers -> agents only; nobody -> another Business Admin or themselves; agents not at all', async () => {
  const put = (token, target, body = { address: 'New address 1' }) => request('PUT', `/api/team/members/${target}/profile`, `t-${token}`, body);
  assert.strictEqual((await put(OWNER, AGENT)).status, 200);
  assert.strictEqual((await put(OWNER, MANAGER2)).status, 200);
  assert.strictEqual((await put(OWNER, OWNER2)).status, 403, 'not another Business Admin');
  assert.match((await put(OWNER, OWNER)).json().error, /My profile/);
  assert.strictEqual((await put(MANAGER, AGENT, { employeeCode: 'SC-0099', joinedOn: '2026-11-01' })).status, 200);
  assert.strictEqual((await put(MANAGER, MANAGER2)).status, 403, 'managers edit agents only');
  assert.strictEqual((await put(MANAGER, OWNER)).status, 403);
  assert.strictEqual((await put(AGENT, AGENT)).status, 403, 'agents use My profile, not this');
  assert.strictEqual((await put(AGENT, MANAGER)).status, 403);
  assert.deepStrictEqual([profileOf(AGENT).employee_code, profileOf(AGENT).joined_on, profileOf(AGENT).updated_by], ['SC-0099', '2026-11-01', 'manager@sunrise.test']);
  assert.strictEqual(profileOf(OWNER2), undefined, 'nothing written for refused edits');
});

test('tenancy: another business\'s staff can\'t be read or edited', async () => {
  assert.strictEqual((await request('PUT', `/api/team/members/${OTHER}/profile`, `t-${OWNER}`, { address: 'Hacked' })).status, 404);
  assert.strictEqual((await request('GET', `/api/team/members/${OTHER}`, `t-${OWNER}`)).status, 404);
  assert.strictEqual(db.staff_profiles.find(p => p.user_id === OTHER).address, 'Secret street');
});

test('who sees private details: Business Admin sees everyone\'s; a manager sees agents\' but not another manager\'s address or emergency contact', async () => {
  await request('PUT', `/api/team/members/${AGENT}/profile`, `t-${OWNER}`, { address: 'Agent home', emergencyContactName: 'Lakshmi' });
  const ownerViewsManager = (await request('GET', `/api/team/members/${MANAGER2}`, `t-${OWNER}`)).json();
  assert.deepStrictEqual([ownerViewsManager.member.address, ownerViewsManager.member.employeeCode, ownerViewsManager.canEdit], ['Flat 2, Road 5', 'SC-0002', true]);
  const managerViewsAgent = (await request('GET', `/api/team/members/${AGENT}`, `t-${MANAGER}`)).json();
  assert.deepStrictEqual([managerViewsAgent.member.address, managerViewsAgent.member.emergencyContactName, managerViewsAgent.canEdit], ['Agent home', 'Lakshmi', true]);
  const managerViewsManager = (await request('GET', `/api/team/members/${MANAGER2}`, `t-${MANAGER}`)).json();
  assert.strictEqual(managerViewsManager.member.phone, '+91 90000 11111', 'phone as before');
  for (const k of ['address', 'emergencyContactName', 'emergencyContactPhone', 'employeeCode']) assert.ok(!(k in managerViewsManager.member), `no ${k}`);
  assert.strictEqual(managerViewsManager.canEdit, false);
  assert.strictEqual(managerViewsManager.updatedBy, null);
  // The team list (everyone, incl. agents) never carries phone numbers or private details.
  const list = (await request('GET', '/api/team', `t-${AGENT}`)).json();
  assert.doesNotMatch(JSON.stringify(list), /Flat 2|90000 11111|Raj \(husband\)/);
  // Ranking (managers) shows names only.
  const perf = (await request('GET', '/api/team/performance', `t-${MANAGER}`)).json();
  assert.doesNotMatch(JSON.stringify(perf), /Flat 2|90000 11111|SC-0002/);
});

test('My profile: the person sees all their own details and edits contact ones, not employee ID / joining date / branch', async () => {
  db.staff_profiles.push({ user_id: AGENT, business_id: A, employee_code: 'SC-0042', joined_on: '2026-11-10', work_location: 'Main branch' });
  const saved = await request('PUT', '/api/me/profile', `t-${AGENT}`, { address: 'My home', emergencyContactPhone: '+91 91234 56789', employeeCode: 'BOSS-1', joinedOn: '2020-01-01' });
  assert.strictEqual(saved.status, 200, JSON.stringify(saved.json()));
  assert.deepStrictEqual([profileOf(AGENT).address, profileOf(AGENT).employee_code, profileOf(AGENT).joined_on], ['My home', 'SC-0042', '2026-11-10']);
  const me = (await request('GET', '/api/me/profile', `t-${AGENT}`)).json();
  assert.deepStrictEqual([me.profile.employeeCode, me.profile.workLocation, me.profile.address], ['SC-0042', 'Main branch', 'My home']);
});

test('My profile: the Business Admin sets their own employee ID, joining date and branch (nobody above them); managers still can\'t', async () => {
  const own = await request('PUT', '/api/me/profile', `t-${OWNER}`, { employeeCode: 'MH-0001', joinedOn: '2024-04-01', workLocation: 'Head office' });
  assert.strictEqual(own.status, 200, JSON.stringify(own.json()));
  assert.deepStrictEqual([profileOf(OWNER).employee_code, profileOf(OWNER).joined_on, profileOf(OWNER).work_location], ['MH-0001', '2024-04-01', 'Head office']);
  assert.strictEqual((await request('PUT', '/api/me/profile', `t-${OWNER}`, { joinedOn: 'yesterday' })).status, 400, 'still checked');
  await request('PUT', '/api/me/profile', `t-${MANAGER}`, { employeeCode: 'BOSS-2', phone: '+91 90000 22222' });
  assert.notStrictEqual(profileOf(MANAGER)?.employee_code, 'BOSS-2', 'a manager\'s own work details stay the Business Admin\'s to set');
});

test('employee ID is unique in a business; audit says which fields changed, never the values', async () => {
  const dup = await request('PUT', `/api/team/members/${AGENT}/profile`, `t-${OWNER}`, { employeeCode: 'sc-0002' });
  assert.strictEqual(dup.status, 400);
  assert.match(dup.json().error, /employee ID is already used/);
  await request('PUT', `/api/team/members/${AGENT}/profile`, `t-${OWNER}`, { address: 'Secret 99', phone: '+91 99999 00000' });
  const a = db.audit_log.find(x => x.action === 'team.profile_updated');
  assert.deepStrictEqual(a.details, { member: 'ravi@sunrise.test', fields: ['phone', 'address'] });
  assert.doesNotMatch(JSON.stringify(db.audit_log), /Secret 99|99999/);
});

test('migration: new columns with limits, unique employee ID per business, still server-only, safe to re-run', async () => {
  const pg = await freshDb();
  const sql = require('fs').readFileSync(require('path').join(__dirname, '..', 'supabase', 'migrations', '20261130_staff_onboarding.sql'), 'utf8');
  await pg.exec(sql);
  await pg.exec(sql);
  const u1 = await pg.query("insert into auth.users (email) values ('a@x.in') returning id");
  const u2 = await pg.query("insert into auth.users (email) values ('b@x.in') returning id");
  for (const u of [u1, u2]) await pg.query("insert into public.staff_members (user_id, email, role, business_id) values ($1, $2, 'agent', 'a0000000-0000-4000-8000-000000000001')", [u.rows[0].id, `${u.rows[0].id}@x.in`]);
  await pg.query("insert into public.staff_profiles (user_id, business_id, employee_code, joined_on, address) values ($1, 'a0000000-0000-4000-8000-000000000001', 'SC-1', '2026-11-10', 'Home')", [u1.rows[0].id]);
  await assert.rejects(pg.query("insert into public.staff_profiles (user_id, business_id, employee_code) values ($1, 'a0000000-0000-4000-8000-000000000001', 'sc-1')", [u2.rows[0].id]), /duplicate|unique/);
  await assert.rejects(pg.query("update public.staff_profiles set address = repeat('x', 201) where user_id = $1", [u1.rows[0].id]), /check/);
  await assert.rejects(asUser(pg, u1.rows[0].id, () => pg.query('select address from public.staff_profiles')));
});
