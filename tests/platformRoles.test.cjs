// Platform roles: Platform Owner, Application Manager (sign-ups, onboarding, support), Application Developer
// (health, logs, worker, delivery). Least privilege on the server and in the database rules; no role reads chats;
// every action audited; the last owner can't be removed; removing someone stops access at once.
// Part 1: the API with a fake database (no network). Part 2: the SQL rules for real (PGlite).
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const AROGYA = 'a0000000-0000-4000-8000-000000000001';
const SUNRISE = 'b0000000-0000-4000-8000-000000000002';
const PQ = 'f0000000-0000-4000-8000-000000000001';
const SIGNUP = 'e0000000-0000-4000-8000-000000000001';
const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const MANAGER_ID = '22222222-2222-4222-8222-222222222222';
const DEV_ID = '33333333-3333-4333-8333-333333333333';

process.env.APP_SECRET = 'server_encryption_secret_long_enough';
process.env.WHATSAPP_TOKEN = '';
process.env.PHONE_NUMBER_ID = '';
process.env.VITE_SUPABASE_URL = 'http://fake.supabase';
process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
process.env.WHATSAPP_BUSINESS_ID = AROGYA;

const app = require('../server/app.cjs');
const platform = require('../server/platform.cjs');
const { _setStaffForToken } = require('../server/auth.cjs');

const SECRET = 'PRIVATE_CHAT_TEXT';
let db;
let mails;
let inviteBehaviour;
function seed() {
  db = {
    businesses: [
      { id: AROGYA, name: 'Arogya Ruchulu', slug: 'arogya-ruchulu', status: 'active', plan_id: 'pro', created_at: new Date().toISOString() },
      { id: SUNRISE, name: 'Sunrise Clinic', slug: 'sunrise-clinic', status: 'active', plan_id: 'growth', created_at: new Date().toISOString() },
    ],
    plans: [{ id: 'starter', name: 'Starter', sort_order: 1 }, { id: 'growth', name: 'Growth', sort_order: 2 }, { id: 'pro', name: 'Pro', sort_order: 3 }],
    platform_admins: [
      { user_id: OWNER_ID, email: 'owner@platform.test', role: 'owner', created_at: '2026-11-01T00:00:00Z' },
      { user_id: MANAGER_ID, email: 'manager@platform.test', role: 'manager', created_at: '2026-11-02T00:00:00Z' },
      { user_id: DEV_ID, email: 'dev@platform.test', role: 'developer', created_at: '2026-11-03T00:00:00Z' },
    ],
    staff_members: [
      { business_id: SUNRISE, user_id: 'u-sun', email: 'admin@sunrise.test', role: 'owner', created_at: '2026-11-05T00:00:00Z' },
      { business_id: AROGYA, user_id: 'u-aro', email: 'owner@arogya.test', role: 'owner', created_at: '2026-11-01T00:00:00Z' },
    ],
    whatsapp_leads: [{ business_id: SUNRISE, phone: '919000000001', name: `${SECRET} Ravi` }],
    whatsapp_messages: [{ business_id: SUNRISE, body: `${SECRET} hello`, timestamp: new Date().toISOString() }],
    whatsapp_bot_rules: [{ business_id: SUNRISE, id: 'r1', keyword: 'price', response_text: `${SECRET} 130` }],
    lead_notes: [{ business_id: SUNRISE, body: `${SECRET} VIP` }],
    platform_queries: [{ id: PQ, number: 1001, business_id: SUNRISE, raised_by_email: 'admin@sunrise.test', raised_by_role: 'owner', category: 'Other', subject: 'Number not receiving', priority: 'normal', stage: 'new', assigned_to: null, created_at: new Date().toISOString() }],
    platform_query_events: [],
    signup_requests: [{ id: SIGNUP, status: 'pending', business_name: 'Lotus Dental', email: 'hello@lotus.test' }],
    audit_log: [], usage_counters: [], business_whatsapp: [], whatsapp_numbers: [], whatsapp_catalog: [], ai_settings: [],
    system_events: [], worker_runs: [], business_health: [],
  };
  mails = [];
  inviteBehaviour = () => ({ status: 200, body: { id: '44444444-4444-4444-8444-444444444444' } });
  platform._resetResends();
}

const json = (d, status = 200, headers = {}) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const SKIP = new Set(['select', 'order', 'limit', 'offset', 'on_conflict']);
/** A row matches every eq / in / is.null / ilike filter in the URL (others are ignored). */
function matcher(u) {
  const filters = [...new URL(u).searchParams.entries()].filter(([k]) => !SKIP.has(k));
  return (r) => filters.every(([k, v]) => {
    const val = r[k] === undefined || r[k] === null ? null : String(r[k]);
    if (v.startsWith('eq.')) return val === v.slice(3);
    if (v.startsWith('ilike.')) return val !== null && val.toLowerCase() === v.slice(6).replace(/\\/g, '').toLowerCase();
    if (v.startsWith('in.(')) return v.slice(4, -1).split(',').includes(val);
    if (v === 'is.null') return val === null;
    return true;
  });
}

global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  const body = opts.body ? JSON.parse(opts.body) : null;
  if (u.startsWith('http://fake.supabase/auth/v1/invite')) { mails.push({ kind: 'invite', email: body.email }); const r = inviteBehaviour(); return json(r.body, r.status); }
  if (u.startsWith('http://fake.supabase/auth/v1/recover')) { mails.push({ kind: 'reset', email: body.email }); return json({}); }
  if (!u.startsWith('http://fake.supabase/rest/v1/')) return json({}, 503);
  const path = u.slice('http://fake.supabase/rest/v1/'.length);
  const table = path.split('?')[0];
  if (table === 'rpc/platform_staff_add_existing') return json([]);
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
    rows.push(...list);
    return json(list, 201);
  }
  if (method === 'PATCH') { const hit = rows.filter(match); hit.forEach(r => Object.assign(r, body)); return json(hit); }
  if (method === 'DELETE') { const hit = rows.filter(match); db[table] = rows.filter(r => !hit.includes(r)); return json(hit); }
  return json([]);
};

let server;
let base;
before(async () => {
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
beforeEach(seed);

function request(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
    }, (res) => { let t = ''; res.on('data', c => { t += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch { /* text */ } resolve({ status: res.statusCode, text: t, json: j }); }); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// Logins: the platform role is read from platform_admins on every request (as in production). A role change or
// removal also forgets the cached login, so each test signs everyone in again.
beforeEach(() => {
  platform._setLoginForToken('t-owner', { id: OWNER_ID, email: 'owner@platform.test' });
  platform._setLoginForToken('t-manager', { id: MANAGER_ID, email: 'manager@platform.test' });
  platform._setLoginForToken('t-dev', { id: DEV_ID, email: 'dev@platform.test' });
});
platform._setPlatformAdminForToken('t-staff', null);
_setStaffForToken('t-staff', { id: 'u-sun', email: 'admin@sunrise.test', role: 'owner', businessId: SUNRISE, businessName: 'Sunrise Clinic' });

test('/me tells the console each person\'s platform role', async () => {
  for (const [t, role] of [['t-owner', 'owner'], ['t-manager', 'manager'], ['t-dev', 'developer']]) {
    const r = await request('GET', '/api/platform/me', t);
    assert.equal(r.status, 200);
    assert.equal(r.json.role, role);
  }
  assert.equal((await request('GET', '/api/platform/me', 't-staff')).status, 403);
});

test('an Application Manager can\'t change plans, limits, businesses, branding, maintenance, the team or read the audit log', async () => {
  const denied = [
    ['PUT', '/api/platform/plans/growth', { priceMonthlyInr: 1 }],
    ['PATCH', `/api/platform/businesses/${SUNRISE}`, { limitOverrides: { max_staff: 99 } }],
    ['PATCH', `/api/platform/businesses/${SUNRISE}`, { status: 'suspended' }],
    ['PUT', '/api/platform/branding', { brandName: 'X' }],
    ['GET', '/api/platform/branding'],
    ['POST', '/api/platform/branding/logo', { dataUrl: 'data:image/png;base64,AA' }],
    ['PUT', '/api/platform/maintenance', { on: true }],
    ['GET', '/api/platform/team'],
    ['POST', '/api/platform/team', { email: 'x@platform.test', role: 'owner' }],
    ['PATCH', `/api/platform/team/${MANAGER_ID}`, { role: 'owner' }],
    ['DELETE', `/api/platform/team/${DEV_ID}`],
    ['GET', '/api/platform/audit'],
    ['GET', '/api/platform/health'],
    ['GET', '/api/platform/events'],
  ];
  for (const [m, p, b] of denied) {
    const r = await request(m, p, 't-manager', b);
    assert.equal(r.status, 403, `${m} ${p} should be refused for a manager`);
  }
  assert.equal(db.plans.find(p => p.id === 'growth').price_monthly_inr, undefined);
  assert.equal(db.businesses.find(b => b.id === SUNRISE).status, 'active');
  assert.deepEqual(db.platform_admins.map(a => a.role), ['owner', 'manager', 'developer']);
});

test('an Application Manager handles sign-ups, onboarding and support', async () => {
  assert.equal((await request('GET', '/api/platform/signup-requests', 't-manager')).status, 200);
  const rej = await request('POST', `/api/platform/signup-requests/${SIGNUP}/reject`, 't-manager', { note: 'duplicate' });
  assert.equal(rej.status, 200, rej.text);
  const a = db.audit_log.find(x => x.action === 'signup.rejected');
  assert.equal(a.actor_email, 'manager@platform.test');
  assert.equal(a.details.platformRole, 'manager');

  const ob = await request('GET', '/api/platform/onboarding', 't-manager');
  assert.equal(ob.status, 200, ob.text);
  const sunrise = ob.json.businesses.find(b => b.id === SUNRISE);
  assert.equal(sunrise.ownerEmail, 'admin@sunrise.test');
  assert.ok(sunrise.steps.some(s => s.id === 'whatsapp' && s.done === false));
  assert.ok(sunrise.steps.some(s => s.id === 'bot' && s.done === true));
  assert.ok(!ob.text.includes(SECRET), 'the onboarding view must never carry chat or bot text');

  const inv = await request('POST', `/api/platform/businesses/${SUNRISE}/resend-invite`, 't-manager');
  assert.equal(inv.status, 200, inv.text);
  assert.deepEqual(mails, [{ kind: 'invite', email: 'admin@sunrise.test' }]);
  assert.ok(db.audit_log.some(x => x.action === 'business.invite_resent' && x.actor_email === 'manager@platform.test' && x.business_id === SUNRISE));
  // Again within 10 minutes: refused (no email flood).
  assert.equal((await request('POST', `/api/platform/businesses/${SUNRISE}/resend-invite`, 't-manager')).status, 429);
  assert.equal(mails.length, 1);
});

test('resending to someone who already set up their login sends a "set your password" email instead', async () => {
  inviteBehaviour = () => ({ status: 422, body: { msg: 'A user with this email address has already been registered' } });
  const r = await request('POST', `/api/platform/businesses/${SUNRISE}/resend-invite`, 't-owner');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.kind, 'reset');
  assert.deepEqual(mails.map(m => m.kind), ['invite', 'reset']);
});

test('support: Mine / Unassigned, assign only to owners or managers, every action audited without the reply text', async () => {
  const un = await request('GET', '/api/platform/support?who=unassigned', 't-manager');
  assert.equal(un.json.queries.length, 1);
  assert.equal((await request('GET', '/api/platform/support?who=mine', 't-manager')).json.queries.length, 0);

  const toDev = await request('PATCH', `/api/platform/support/${PQ}`, 't-manager', { assignedTo: 'dev@platform.test' });
  assert.equal(toDev.status, 400);
  const toStranger = await request('PATCH', `/api/platform/support/${PQ}`, 't-manager', { assignedTo: 'someone@else.test' });
  assert.equal(toStranger.status, 400);
  const mine = await request('PATCH', `/api/platform/support/${PQ}`, 't-manager', { assignedTo: 'Manager@platform.test' });
  assert.equal(mine.status, 200, mine.text);
  assert.equal(db.platform_queries[0].assigned_to, 'manager@platform.test');
  assert.equal(db.platform_queries[0].stage, 'assigned');
  assert.equal((await request('GET', '/api/platform/support?who=mine', 't-manager')).json.queries.length, 1);
  assert.equal((await request('GET', '/api/platform/support?who=unassigned', 't-manager')).json.queries.length, 0);
  // The business doesn't see which platform person took it.
  assert.equal(db.platform_query_events.find(e => e.type === 'assigned').visibility, 'platform');

  const rep = await request('PATCH', `/api/platform/support/${PQ}`, 't-manager', { body: 'Please reconnect the number. Secret steps inside.' });
  assert.equal(rep.status, 200, rep.text);
  const replied = db.audit_log.find(x => x.action === 'support.replied');
  assert.equal(replied.actor_email, 'manager@platform.test');
  assert.equal(replied.details.platformRole, 'manager');
  assert.ok(!JSON.stringify(db.audit_log).includes('Secret steps'), 'reply text is never copied into the audit log');
  assert.ok(db.audit_log.some(x => x.action === 'support.assigned' && x.details.to === 'manager@platform.test'));

  const assignees = await request('GET', '/api/platform/support-assignees', 't-manager');
  assert.deepEqual(assignees.json.assignees.map(a => a.email).sort(), ['manager@platform.test', 'owner@platform.test']);
});

test('an Application Developer monitors but can\'t approve sign-ups, answer queries or change anything', async () => {
  const denied = [
    ['POST', `/api/platform/signup-requests/${SIGNUP}/approve`, {}],
    ['POST', `/api/platform/signup-requests/${SIGNUP}/reject`, {}],
    ['GET', '/api/platform/signup-requests'],
    ['GET', '/api/platform/support'],
    ['GET', `/api/platform/support/${PQ}`],
    ['PATCH', `/api/platform/support/${PQ}`, { body: 'hi' }],
    ['GET', '/api/platform/onboarding'],
    ['POST', `/api/platform/businesses/${SUNRISE}/resend-invite`],
    ['POST', '/api/platform/businesses', { name: 'Lotus Dental', adminEmail: 'a@lotus.test' }],
    ['PATCH', `/api/platform/businesses/${SUNRISE}`, { planId: 'pro' }],
    ['PUT', '/api/platform/plans/growth', { priceMonthlyInr: 1 }],
    ['PUT', '/api/platform/maintenance', { on: true }],
    ['PUT', '/api/platform/branding', { brandName: 'X' }],
    ['GET', '/api/platform/team'],
    ['GET', '/api/platform/audit'],
  ];
  for (const [m, p, b] of denied) {
    const r = await request(m, p, 't-dev', b);
    assert.equal(r.status, 403, `${m} ${p} should be refused for a developer`);
  }
  assert.equal(db.signup_requests[0].status, 'pending');
  assert.equal(db.platform_query_events.length, 0);
  // What they may use: the read-only business list and details, maintenance state, monitoring.
  for (const p of ['/api/platform/overview', `/api/platform/businesses/${SUNRISE}`, '/api/platform/maintenance', '/api/platform/worker-runs', '/api/platform/delivery', '/api/platform/events']) {
    const r = await request('GET', p, 't-dev');
    assert.notEqual(r.status, 403, `${p} should be open to a developer`);
    assert.ok(!r.text.includes(SECRET), `${p} must never carry chat content`);
  }
});

test('no platform role reaches a business\'s chat data through the business API', async () => {
  for (const t of ['t-owner', 't-manager', 't-dev']) {
    for (const p of ['/api/leads', '/api/inbox/chats', `/api/messages/919000000001`]) {
      const r = await request('GET', p, t);
      assert.ok(r.status >= 400, `${t} ${p} gave ${r.status}`);
      assert.ok(!r.text.includes(SECRET));
    }
    const o = await request('GET', '/api/platform/overview', t);
    assert.ok(!o.text.includes(SECRET));
  }
});

test('platform team: the owner adds, changes and removes staff; every change audited', async () => {
  const add = await request('POST', '/api/platform/team', 't-owner', { email: 'Support@Platform.test', role: 'manager' });
  assert.equal(add.status, 200, add.text);
  assert.equal(add.json.invited, true);
  const row = db.platform_admins.find(a => a.email === 'support@platform.test');
  assert.equal(row.role, 'manager');
  assert.equal(row.added_by, 'owner@platform.test');
  assert.ok(db.audit_log.some(x => x.action === 'platform.staff_added' && x.details.member === 'support@platform.test' && x.details.role === 'manager'));

  // Again: already in the team. Business staff: refused. Unknown role: refused.
  assert.equal((await request('POST', '/api/platform/team', 't-owner', { email: 'support@platform.test', role: 'developer' })).status, 400);
  const biz = await request('POST', '/api/platform/team', 't-owner', { email: 'admin@sunrise.test', role: 'developer' });
  assert.equal(biz.status, 400);
  assert.match(biz.json.error, /works for a business/);
  assert.equal((await request('POST', '/api/platform/team', 't-owner', { email: 'x@platform.test', role: 'boss' })).status, 400);

  const ch = await request('PATCH', `/api/platform/team/${DEV_ID}`, 't-owner', { role: 'manager' });
  assert.equal(ch.status, 200, ch.text);
  assert.equal(db.platform_admins.find(a => a.user_id === DEV_ID).role, 'manager');
  assert.ok(db.audit_log.some(x => x.action === 'platform.staff_role_changed' && x.details.from === 'developer' && x.details.to === 'manager'));

  const list = await request('GET', '/api/platform/team', 't-owner');
  assert.equal(list.json.members.length, 4);
});

test('the last Platform Owner can\'t be removed or demoted, and nobody changes themselves', async () => {
  assert.equal((await request('PATCH', `/api/platform/team/${OWNER_ID}`, 't-owner', { role: 'developer' })).status, 400);
  assert.equal((await request('DELETE', `/api/platform/team/${OWNER_ID}`, 't-owner')).status, 400);
  // A second owner tries to remove / demote the only other owner... after which there'd be one: allowed only while 2+ remain.
  db.platform_admins.push({ user_id: '55555555-5555-4555-8555-555555555555', email: 'owner2@platform.test', role: 'owner' });
  platform._setLoginForToken('t-owner2', { id: '55555555-5555-4555-8555-555555555555', email: 'owner2@platform.test' });
  const demote = await request('PATCH', `/api/platform/team/${OWNER_ID}`, 't-owner2', { role: 'manager' });
  assert.equal(demote.status, 200, demote.text);
  // Now owner2 is the last owner: the (former) owner can't touch the team at all, and owner2 can't remove themselves.
  assert.equal((await request('DELETE', '/api/platform/team/55555555-5555-4555-8555-555555555555', 't-owner')).status, 403);
  assert.equal((await request('DELETE', '/api/platform/team/55555555-5555-4555-8555-555555555555', 't-owner2')).status, 400);
  assert.equal(db.platform_admins.filter(a => a.role === 'owner').length, 1);
});

test('removing a platform staff member stops their access on the very next request', async () => {
  assert.equal((await request('GET', '/api/platform/support', 't-manager')).status, 200);
  db.platform_queries[0].assigned_to = 'manager@platform.test';
  const rm = await request('DELETE', `/api/platform/team/${MANAGER_ID}`, 't-owner');
  assert.equal(rm.status, 200, rm.text);
  assert.ok(db.audit_log.some(x => x.action === 'platform.staff_removed' && x.details.member === 'manager@platform.test'));
  // Their open support query goes back to the shared queue.
  assert.equal(db.platform_queries[0].assigned_to, null);
  for (const p of ['/api/platform/me', '/api/platform/support', '/api/platform/overview']) {
    assert.equal((await request('GET', p, 't-manager')).status, 403, p);
  }
  // A role change also applies at once: the developer, made a manager, can now open support.
  db.platform_admins.find(a => a.user_id === DEV_ID).role = 'manager';
  assert.equal((await request('GET', '/api/platform/support', 't-dev')).status, 200);
});

test('the owner still does everything (plans, businesses, audit)', async () => {
  const plan = await request('PUT', '/api/platform/plans/growth', 't-owner', { priceMonthlyInr: 2999 });
  assert.equal(plan.status, 200, plan.text);
  const audit = db.audit_log.find(x => x.action === 'plan.updated');
  assert.equal(audit.details.platformRole, 'owner');
  assert.equal((await request('PATCH', `/api/platform/businesses/${SUNRISE}`, 't-owner', { paidUntil: '2026-12-31' })).status, 200);
  assert.equal((await request('GET', '/api/platform/audit', 't-owner')).status, 200);
});

// ---------------------------------------------------------------------------------------------
// Part 2: the database rules (RLS) for real
// ---------------------------------------------------------------------------------------------
const { freshDb, migrationSql, asUser } = require('./helpers/pgHarness.cjs');

test('SQL: roles column, safe to re-run, and each platform role reads only what it should', async () => {
  const pg = await freshDb();
  await pg.exec(migrationSql('20261133_platform_roles.sql')); // safe to re-run
  const add = async (email) => (await pg.query('insert into auth.users (email) values ($1) returning id', [email])).rows[0].id;
  const owner = await add('owner@platform.test');
  const manager = await add('manager@platform.test');
  const dev = await add('dev@platform.test');
  await pg.query("insert into public.platform_admins (user_id, email) values ($1, 'owner@platform.test')", [owner]);
  await pg.query("insert into public.platform_admins (user_id, email, role) values ($1, 'manager@platform.test', 'manager'), ($2, 'dev@platform.test', 'developer')", [manager, dev]);
  assert.equal((await pg.query('select role from public.platform_admins where user_id = $1', [owner])).rows[0].role, 'owner', 'default role is owner');
  await assert.rejects(pg.query("update public.platform_admins set role = 'boss' where user_id = $1", [dev]));

  const biz = (await pg.query("insert into public.businesses (name, slug, plan_id) values ('Sunrise Clinic', 'sunrise-clinic', 'growth') returning id")).rows[0].id;
  await pg.query("insert into public.whatsapp_leads (phone, name, business_id) values ('919000000001', 'Ravi', $1)", [biz]);
  await pg.query("insert into public.whatsapp_messages (message_id, body, business_id) values ('wamid.1', 'hi', $1)", [biz]);
  await pg.query("insert into public.audit_log (action) values ('plan.updated')");
  await pg.query("insert into public.platform_queries (business_id, raised_by_email, raised_by_role, subject) values ($1, 'a@sunrise.test', 'owner', 'Help')", [biz]);

  const allBiz = (await pg.query('select count(*)::int as n from public.businesses')).rows[0].n;
  for (const who of [owner, manager, dev]) {
    // Never chats, contacts, notes, bot or AI content.
    for (const t of ['whatsapp_leads', 'whatsapp_messages', 'lead_notes', 'whatsapp_bot_rules', 'whatsapp_catalog', 'contact_events', 'ai_settings', 'queries', 'saved_replies']) {
      const r = await asUser(pg, who, () => pg.query(`select count(*)::int as n from public.${t}`)).catch(() => ({ rows: [{ n: 0 }] }));
      assert.equal(r.rows[0].n, 0, `platform role could read ${t}`);
    }
    // Everyone reads the business list.
    assert.equal((await asUser(pg, who, () => pg.query('select count(*)::int as n from public.businesses'))).rows[0].n, allBiz);
  }
  // Only the owner changes plans and businesses.
  for (const who of [manager, dev]) {
    const p = await asUser(pg, who, () => pg.query("update public.plans set price_monthly_inr = 1 where id = 'growth'"));
    assert.equal(p.affectedRows, 0);
    const b = await asUser(pg, who, () => pg.query("update public.businesses set status = 'suspended' where id = $1", [biz]));
    assert.equal(b.affectedRows, 0);
    assert.equal((await asUser(pg, who, () => pg.query('select count(*)::int as n from public.audit_log'))).rows[0].n, 0, 'audit log is the owner\'s');
    await assert.rejects(asUser(pg, who, () => pg.query("update public.platform_admins set role = 'owner' where user_id = $1", [who])));
  }
  const ob = await asUser(pg, owner, () => pg.query("update public.businesses set plan_id = 'pro' where id = $1", [biz]));
  assert.equal(ob.affectedRows, 1);
  assert.equal((await asUser(pg, owner, () => pg.query('select count(*)::int as n from public.audit_log'))).rows[0].n, 1);
  // Support queries: owner and managers, not developers.
  assert.equal((await asUser(pg, manager, () => pg.query('select count(*)::int as n from public.platform_queries'))).rows[0].n, 1);
  assert.equal((await asUser(pg, dev, () => pg.query('select count(*)::int as n from public.platform_queries'))).rows[0].n, 0);

  // The add-existing helper: server key only; refuses business staff.
  await assert.rejects(asUser(pg, owner, () => pg.query("select * from public.platform_staff_add_existing('x@platform.test', 'manager', 'me')")));
  const staffUser = await add('admin@sunrise.test');
  await pg.query("insert into public.staff_members (user_id, email, role, business_id) values ($1, 'admin@sunrise.test', 'owner', $2)", [staffUser, biz]);
  await assert.rejects(pg.query("select * from public.platform_staff_add_existing('admin@sunrise.test', 'developer', 'owner@platform.test')"), /works for a business/);
  const newbie = await add('new@platform.test');
  const added = await pg.query("select * from public.platform_staff_add_existing('NEW@platform.test', 'developer', 'owner@platform.test')");
  assert.equal(added.rows[0].user_id, newbie);
  assert.equal(added.rows[0].role, 'developer');
  assert.equal((await pg.query("select * from public.platform_staff_add_existing('nobody@platform.test', 'developer', 'x')")).rows.length, 0);
});
