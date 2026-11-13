// Q1: queries at every level — who can see which query, numbering, categories, and the rules.
// Real Postgres (PGlite) with all migrations; each role signs in and reads.
const test = require('node:test');
const assert = require('node:assert');
const { freshDb, migrationSql, asUser } = require('./helpers/pgHarness.cjs');

const AROGYA = 'a0000000-0000-4000-8000-000000000001';
let db;
const u = {};      // logins
const q = {};      // query ids
const pq = {};     // platform query ids
let MAYURA;

async function login(email) {
  return (await db.query('insert into auth.users (email) values ($1) returning id', [email])).rows[0].id;
}
async function addStaff(id, email, role, biz) {
  await db.query('insert into public.staff_members (user_id, email, role, business_id) values ($1, $2, $3, $4)', [id, email, role, biz]);
}
async function addQuery(fields) {
  const num = (await db.query('select public.next_query_number($1) as n', [fields.business_id])).rows[0].n;
  const cols = Object.keys(fields);
  const r = await db.query(
    `insert into public.queries (${[...cols, 'number'].join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')}, $${cols.length + 1}) returning id, number`,
    [...Object.values(fields), num]
  );
  return r.rows[0];
}
const seen = async (who, sql, params = []) => (await asUser(db, who, () => db.query(sql, params))).rows;

test.before(async () => {
  db = await freshDb();
  await db.exec(migrationSql('20261111_q1_queries.sql')); // already applied by freshDb: proves re-runnable
  MAYURA = (await db.query("insert into public.businesses (name, slug, industry) values ('Mayura Hospitals', 'mayura', 'hospital') returning id")).rows[0].id;
  await db.query('select public.seed_query_categories($1)', [MAYURA]);

  u.owner = await login('owner@arogya.test');
  u.manager = await login('manager@arogya.test');
  u.agent1 = await login('agent1@arogya.test');
  u.agent2 = await login('agent2@arogya.test');
  u.mayuraOwner = await login('admin@mayura.test');
  u.platform = await login('platform@crm.test');
  await addStaff(u.owner, 'owner@arogya.test', 'owner', AROGYA);
  await addStaff(u.manager, 'manager@arogya.test', 'manager', AROGYA);
  await addStaff(u.agent1, 'agent1@arogya.test', 'agent', AROGYA);
  await addStaff(u.agent2, 'agent2@arogya.test', 'agent', AROGYA);
  await addStaff(u.mayuraOwner, 'admin@mayura.test', 'owner', MAYURA);
  await db.query("insert into public.platform_admins (user_id, email) values ($1, 'platform@crm.test')", [u.platform]);

  // Customer query from the bot, and team queries raised by staff.
  q.customer = await addQuery({ business_id: AROGYA, kind: 'customer', source: 'bot', contact_phone: '919000000001', category: 'Delivery', subject: 'Order not delivered' });
  q.toManagers = await addQuery({ business_id: AROGYA, kind: 'internal', source: 'staff', raised_by_email: 'agent1@arogya.test', raised_by_role: 'agent', addressed_to: 'managers', category: 'Approval needed', subject: 'Refund for Ravi?' });
  q.toOwner = await addQuery({ business_id: AROGYA, kind: 'internal', source: 'staff', raised_by_email: 'Agent1@Arogya.test', raised_by_role: 'agent', addressed_to: 'owner', category: 'Access or permission', subject: 'Need access to broadcasts' });
  q.managerToOwner = await addQuery({ business_id: AROGYA, kind: 'internal', source: 'staff', raised_by_email: 'manager@arogya.test', raised_by_role: 'manager', addressed_to: 'owner', category: 'Plan / limits', subject: 'Broadcast limit reached' });
  q.mayuraCustomer = await addQuery({ business_id: MAYURA, kind: 'customer', source: 'ai', contact_phone: '919000000009', category: 'Reports', subject: 'Report not received' });

  // Timeline: a handler-only note and a normal comment on agent1's query to managers.
  await db.query("insert into public.query_events (business_id, query_id, author_email, author_role, type, visibility, body) values ($1, $2, 'manager@arogya.test', 'manager', 'note', 'handlers', 'check with accounts first'), ($1, $2, 'manager@arogya.test', 'manager', 'comment', 'all', 'Approved, go ahead')", [AROGYA, q.toManagers.id]);

  // Platform support queries.
  pq.agent1 = (await db.query("insert into public.platform_queries (business_id, raised_by_email, raised_by_role, category, subject) values ($1, 'agent1@arogya.test', 'agent', 'App problem / bug', 'Inbox does not load') returning id, number", [AROGYA])).rows[0];
  pq.mayura = (await db.query("insert into public.platform_queries (business_id, raised_by_email, raised_by_role, category, subject) values ($1, 'admin@mayura.test', 'owner', 'WhatsApp connection', 'Cannot connect number') returning id, number", [MAYURA])).rows[0];
  await db.query("insert into public.platform_query_events (platform_query_id, business_id, author_email, author_role, type, visibility, body) values ($1, $2, 'platform@crm.test', 'platform_admin', 'note', 'platform', 'internal platform note'), ($1, $2, 'platform@crm.test', 'platform_admin', 'comment', 'all', 'Looking into it')", [pq.agent1.id, AROGYA]);
});

test('query numbers count up per business without gaps; platform numbers are separate', () => {
  assert.deepStrictEqual([q.customer.number, q.toManagers.number, q.toOwner.number, q.managerToOwner.number], [1001, 1002, 1003, 1004]);
  assert.strictEqual(q.mayuraCustomer.number, 1001);
  assert.ok(pq.agent1.number >= 5001 && pq.mayura.number === pq.agent1.number + 1);
});

test('default categories depend on the type of business', async () => {
  const cats = async (biz, kind) => (await db.query('select name from public.query_categories where business_id = $1 and kind = $2 order by sort_order', [biz, kind])).rows.map(r => r.name);
  assert.ok((await cats(AROGYA, 'customer')).includes('Delivery'), 'food business gets food categories');
  assert.deepStrictEqual(await cats(MAYURA, 'customer'), ['Appointment', 'Reports', 'Billing', 'Doctor / treatment', 'Complaint', 'Other']);
  assert.strictEqual((await cats(MAYURA, 'internal')).length, 7);
});

const ids = (rows) => rows.map(r => r.id).sort();
const pick = (...names) => names.map(n => q[n].id).sort();

test('an agent sees all customer queries and only their own team queries', async () => {
  assert.deepStrictEqual(ids(await seen(u.agent1, 'select id from public.queries')), pick('customer', 'toManagers', 'toOwner'));
  assert.deepStrictEqual(ids(await seen(u.agent2, 'select id from public.queries')), pick('customer'));
});

test('a manager sees queries sent to managers and their own, not those sent only to the Business Admin', async () => {
  assert.deepStrictEqual(ids(await seen(u.manager, 'select id from public.queries')), pick('customer', 'toManagers', 'managerToOwner'));
});

test('the Business Admin sees every query of the business, and nothing of another business', async () => {
  assert.deepStrictEqual(ids(await seen(u.owner, 'select id from public.queries')), pick('customer', 'toManagers', 'toOwner', 'managerToOwner'));
  assert.deepStrictEqual(ids(await seen(u.mayuraOwner, 'select id from public.queries')), pick('mayuraCustomer'));
});

test('the person who raised a query sees replies but not the handlers\' internal notes', async () => {
  const forRaiser = await seen(u.agent1, 'select body from public.query_events where query_id = $1', [q.toManagers.id]);
  assert.deepStrictEqual(forRaiser.map(e => e.body), ['Approved, go ahead']);
  const forManager = await seen(u.manager, 'select body from public.query_events where query_id = $1 order by id', [q.toManagers.id]);
  assert.deepStrictEqual(forManager.map(e => e.body), ['check with accounts first', 'Approved, go ahead']);
  assert.strictEqual((await seen(u.agent2, 'select id from public.query_events')).length, 0);
});

test('the Platform Admin sees platform support queries only — never customer or team queries', async () => {
  assert.strictEqual((await seen(u.platform, 'select id from public.queries')).length, 0);
  assert.strictEqual((await seen(u.platform, 'select id from public.query_events')).length, 0);
  assert.deepStrictEqual(ids(await seen(u.platform, 'select id from public.platform_queries')), [pq.agent1.id, pq.mayura.id].sort());
  assert.strictEqual((await seen(u.platform, 'select id from public.platform_query_events')).length, 2);
});

test('platform support queries: the raiser and their Business Admin see them, other staff and businesses don\'t', async () => {
  assert.deepStrictEqual(ids(await seen(u.agent1, 'select id from public.platform_queries')), [pq.agent1.id]);
  assert.deepStrictEqual(ids(await seen(u.owner, 'select id from public.platform_queries')), [pq.agent1.id]);
  assert.strictEqual((await seen(u.agent2, 'select id from public.platform_queries')).length, 0);
  assert.strictEqual((await seen(u.manager, 'select id from public.platform_queries')).length, 0);
  assert.deepStrictEqual(ids(await seen(u.mayuraOwner, 'select id from public.platform_queries')), [pq.mayura.id]);
  // The business sees the platform's reply but not the platform's internal note.
  assert.deepStrictEqual((await seen(u.owner, 'select body from public.platform_query_events')).map(e => e.body), ['Looking into it']);
});

test('browsers can only read: every change goes through the server', async () => {
  for (const who of [u.owner, u.platform]) {
    await assert.rejects(asUser(db, who, () => db.query("insert into public.queries (business_id, number, kind, source, contact_phone, subject) values ($1, 9999, 'customer', 'staff', '1', 'x')", [AROGYA])));
    await assert.rejects(asUser(db, who, () => db.query("update public.queries set stage = 'closed'")));
    await assert.rejects(asUser(db, who, () => db.query("insert into public.platform_queries (business_id, raised_by_email, raised_by_role, subject) values ($1, 'x@y.z', 'owner', 'x')", [AROGYA])));
    await assert.rejects(asUser(db, who, () => db.query('select public.next_query_number($1)', [AROGYA])));
  }
  await assert.rejects(asUser(db, u.owner, () => db.query('select * from public.query_counters')));
});

test('the rules on a query are enforced by the database', async () => {
  const base = { business_id: AROGYA, number: 9001, subject: 'x' };
  const ins = (f) => db.query(`insert into public.queries (${Object.keys(f).join(',')}) values (${Object.keys(f).map((_, i) => `$${i + 1}`).join(',')})`, Object.values(f));
  await assert.rejects(ins({ ...base, kind: 'customer', source: 'bot' }), /customer_has_phone/);
  await assert.rejects(ins({ ...base, kind: 'internal', source: 'staff', addressed_to: 'managers' }), /internal_raised_by_staff/);
  await assert.rejects(ins({ ...base, kind: 'internal', source: 'staff', raised_by_email: 'a@b.c', raised_by_role: 'agent', addressed_to: 'team' }), /internal_raised_by_staff/);
  await assert.rejects(ins({ ...base, kind: 'customer', source: 'bot', contact_phone: '1', stage: 'pending' }));
  await assert.rejects(ins({ ...base, kind: 'customer', source: 'bot', contact_phone: '1', priority: 'critical' }));
  await assert.rejects(ins({ business_id: AROGYA, number: q.customer.number, kind: 'customer', source: 'bot', contact_phone: '1', subject: 'dup' }), /unique|duplicate/i);
});
