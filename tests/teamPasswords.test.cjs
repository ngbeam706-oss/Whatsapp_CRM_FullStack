// Passwords set by the Business Admin / managers: managers add and reset agents; the Business Admin also
// managers; nobody resets a Business Admin or themselves here; other businesses can't touch anyone; agents
// get no reset email from "Forgot password?" (same answer for everyone). Passwords never appear in
// responses or the audit log. Fake database + fake Supabase Auth.
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
const limits = require('../server/limits.cjs');
const { _setStaffForToken } = require('../server/auth.cjs');

const OWNER = 'd0000000-0000-4000-8000-000000000001';
const MANAGER = 'd0000000-0000-4000-8000-000000000002';
const AGENT = 'd0000000-0000-4000-8000-000000000003';
const OWNER2 = 'd0000000-0000-4000-8000-000000000004';
const PW = 'Secret123pass';

let db, auth, failDb;
function seed() {
  db = {
    businesses: [{ id: A, name: 'Mayura', status: 'active', plan_id: 'pro', limit_overrides: {} }],
    plans: [{ id: 'pro', name: 'Pro', max_staff: 10 }],
    staff_members: [
      { business_id: A, user_id: OWNER, email: 'owner@mayura.test', role: 'owner' },
      { business_id: A, user_id: MANAGER, email: 'manager@mayura.test', role: 'manager' },
      { business_id: A, user_id: AGENT, email: 'Ravi@Mayura.test', role: 'agent' },
      { business_id: A, user_id: OWNER2, email: 'owner2@mayura.test', role: 'owner' },
    ],
    staff_profiles: [], audit_log: [],
  };
  auth = { created: [], updated: [], recovered: [], existing: new Set(['old@mayura.test']) };
  failDb = false;
  limits.clearCache();
}

const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
function matches(row, params) {
  for (const [k, raw] of params) {
    if (['select', 'order', 'limit', 'on_conflict'].includes(k)) continue;
    const i = raw.indexOf('.'); const op = raw.slice(0, i); const val = raw.slice(i + 1); const v = row[k];
    if (op === 'eq' && String(v) !== val) return false;
    if (op === 'ilike' && String(v).toLowerCase() !== val.replace(/\\(.)/g, '$1').toLowerCase()) return false;
  }
  return true;
}
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  const body = opts.body ? JSON.parse(opts.body) : null;
  if (u.startsWith('http://fake.supabase/auth/v1/admin/users')) {
    if (method === 'POST') {
      if (auth.existing.has(body.email)) return json({ code: 422, msg: 'A user with this email address has already been registered' }, 422);
      auth.created.push(body);
      return json({ id: `e0000000-0000-4000-8000-00000000000${auth.created.length}`, email: body.email });
    }
    if (method === 'PUT') { auth.updated.push({ id: u.split('/').pop(), ...body }); return json({ id: u.split('/').pop() }); }
  }
  if (u.startsWith('http://fake.supabase/auth/v1/recover')) { auth.recovered.push(body.email); return json({}); }
  if (!u.startsWith('http://fake.supabase/rest/v1/')) return json({}, 503);
  const [path, qs = ''] = u.slice('http://fake.supabase/rest/v1/'.length).split('?');
  const params = [...new URLSearchParams(qs).entries()];
  if (failDb && path === 'staff_members') return json({ message: 'db down' }, 500);
  if (path === 'rpc/staff_add_existing_to_business') {
    const row = { user_id: 'e0000000-0000-4000-8000-000000000099', email: body.p_email, role: body.p_role, business_id: body.p_business };
    db.staff_members.push(row);
    return json([row]);
  }
  if (path.startsWith('rpc/')) return json([]);
  const rows = (db[path] ||= []);
  if (method === 'GET') return json(rows.filter(r => matches(r, params)));
  if (method === 'POST') { const list = Array.isArray(body) ? body : [body]; rows.push(...list); return json(list, 201); }
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
    const req = http.request(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
    }, (res) => { let t = ''; res.on('data', c => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, text: t, json: () => JSON.parse(t) })); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const who = (id, email, role, biz = A) => ({ id, email, role, businessId: biz, businessName: 'Mayura' });
_setStaffForToken('owner', who(OWNER, 'owner@mayura.test', 'owner'));
_setStaffForToken('manager', who(MANAGER, 'manager@mayura.test', 'manager'));
_setStaffForToken('agent', who(AGENT, 'ravi@mayura.test', 'agent'));
_setStaffForToken('other', who('d0000000-0000-4000-8000-000000000009', 'x@other.test', 'owner', B));

test('a manager adds an agent with a password: confirmed login, in this business, name saved, nothing emailed', async () => {
  const r = await request('POST', '/api/team/members', 'manager', { email: 'Sita@Mayura.test ', password: PW, fullName: 'Sita Devi' });
  assert.strictEqual(r.status, 200, r.text);
  assert.ok(!r.text.includes(PW), 'the password is never sent back');
  assert.deepStrictEqual([auth.created[0].email, auth.created[0].password, auth.created[0].email_confirm], ['sita@mayura.test', PW, true]);
  const row = db.staff_members.find(s => s.email === 'sita@mayura.test');
  assert.deepStrictEqual([row.role, row.business_id], ['agent', A]);
  assert.strictEqual(db.staff_profiles[0].full_name, 'Sita Devi');
  assert.strictEqual(auth.recovered.length, 0);
  assert.ok(db.audit_log.some(a => a.action === 'team.member_added_with_password'));
  assert.ok(!JSON.stringify(db.audit_log).includes(PW), 'the password is never logged');
});

test('who may add: managers only agents; agents nobody; weak passwords refused before Supabase', async () => {
  assert.strictEqual((await request('POST', '/api/team/members', 'manager', { email: 'm2@mayura.test', password: PW, role: 'manager' })).status, 403);
  assert.strictEqual((await request('POST', '/api/team/members', 'agent', { email: 'x@mayura.test', password: PW })).status, 403);
  assert.strictEqual((await request('POST', '/api/team/members', 'owner', { email: 'o3@mayura.test', password: PW, role: 'owner' })).status, 400, 'Business Admins are invited by email');
  for (const weak of ['short1', 'onlyletters', '12345678']) {
    assert.strictEqual((await request('POST', '/api/team/members', 'owner', { email: 'w@mayura.test', password: weak })).status, 400, weak);
  }
  assert.strictEqual(auth.created.length, 0);
  // The Business Admin may add a manager with a password.
  assert.strictEqual((await request('POST', '/api/team/members', 'owner', { email: 'm2@mayura.test', password: PW, role: 'manager' })).status, 200);
});

test('an email that already has a login is added (never moved) and gets the new password', async () => {
  const r = await request('POST', '/api/team/members', 'owner', { email: 'old@mayura.test', password: PW });
  assert.strictEqual(r.status, 200, r.text);
  assert.deepStrictEqual(auth.updated.map(u => [u.id, u.password]), [['e0000000-0000-4000-8000-000000000099', PW]]);
});

test('set password: managers -> agents; Business Admin -> agents and managers; never a Business Admin or yourself; never another business', async () => {
  assert.strictEqual((await request('PUT', `/api/team/${AGENT}/password`, 'manager', { password: PW })).status, 200);
  assert.strictEqual((await request('PUT', `/api/team/${OWNER}/password`, 'manager', { password: PW })).status, 403);
  assert.strictEqual((await request('PUT', `/api/team/${MANAGER}/password`, 'owner', { password: PW })).status, 200);
  assert.strictEqual((await request('PUT', `/api/team/${OWNER2}/password`, 'owner', { password: PW })).status, 403);
  assert.strictEqual((await request('PUT', `/api/team/${OWNER}/password`, 'owner', { password: PW })).status, 400);
  assert.strictEqual((await request('PUT', `/api/team/${MANAGER}/password`, 'agent', { password: PW })).status, 403);
  assert.strictEqual((await request('PUT', `/api/team/${AGENT}/password`, 'other', { password: PW })).status, 404);
  assert.strictEqual((await request('PUT', `/api/team/${AGENT}/password`, 'manager', { password: 'weak' })).status, 400);
  assert.deepStrictEqual(auth.updated.map(u => u.id), [AGENT, MANAGER]);
  assert.strictEqual(db.audit_log.filter(a => a.action === 'team.password_set').length, 2);
  assert.ok(!JSON.stringify(db.audit_log).includes(PW));
});

test('"Forgot password?": no email for agents (any capitals), emails for others; the same answer every time', async () => {
  const ask = (email) => request('POST', '/api/auth/forgot-password', null, { email });
  const agent = await ask('ravi@mayura.TEST');
  const owner = await ask('owner@mayura.test');
  const nobody = await ask('nobody@mayura.test');
  assert.deepStrictEqual([agent.status, owner.status, nobody.status], [200, 200, 200]);
  assert.strictEqual(agent.text, owner.text);
  assert.strictEqual(owner.text, nobody.text);
  assert.match(agent.json().message, /Agents: ask your manager/);
  assert.deepStrictEqual(auth.recovered, ['owner@mayura.test', 'nobody@mayura.test']);
  // If the staff list can't be read, send nothing (never risk an agent reset).
  failDb = true;
  await ask('owner@mayura.test');
  assert.strictEqual(auth.recovered.length, 2);
});

test('"Forgot password?" is rate limited', async () => {
  let last;
  for (let i = 0; i < 6; i++) last = await request('POST', '/api/auth/forgot-password', null, { email: `a${i}@x.test` });
  assert.strictEqual(last.status, 429);
});
