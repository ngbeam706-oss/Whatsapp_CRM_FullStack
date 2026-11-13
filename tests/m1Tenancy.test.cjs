// M1: businesses are kept apart by the database rules themselves.
const test = require('node:test');
const assert = require('node:assert');
const { freshDb, migrationSql, asUser } = require('./helpers/pgHarness.cjs');

const AROGYA = 'a0000000-0000-4000-8000-000000000001';
const M1 = '20261107_m1_multi_business.sql';

let db;
const ids = {};

async function addUser(email) {
  const r = await db.query('insert into auth.users (email) values ($1) returning id', [email]);
  return r.rows[0].id;
}

test.before(async () => {
  // Arogya's data as it is today, before M1.
  db = await freshDb({ upTo: '20261106_zz' });
  ids.owner = await addUser('owner@arogya.test');
  ids.agent = await addUser('agent@arogya.test');
  await db.query("insert into public.staff_members (user_id, email, role) values ($1, 'owner@arogya.test', 'owner'), ($2, 'agent@arogya.test', 'agent')", [ids.owner, ids.agent]);
  await db.exec(`
    insert into public.whatsapp_leads (phone, name) values ('919000000001', 'Ravi'), ('919000000002', 'Sita');
    insert into public.whatsapp_messages (message_id, direction, sender, recipient, body) values ('wamid.1', 'inbound', '919000000001', 'biz', 'hi');
    insert into public.whatsapp_bot_rules (id, keyword, response_text, is_active) values ('r1', 'price', 'Thali 130', true);
    insert into public.whatsapp_catalog (id, data) values ('main_catalog', '{}');
    insert into public.lead_notes (phone, author, body) values ('919000000001', 'owner@arogya.test', 'VIP');
  `);

  // Run M1 twice: it must be safe to re-run.
  await db.exec(migrationSql(M1));
  await db.exec(migrationSql(M1));

  // A second business with its own staff and data, and a platform admin.
  const b = await db.query("insert into public.businesses (name, slug, plan_id) values ('Mayura Hospitals', 'mayura-hospitals', 'growth') returning id");
  ids.mayura = b.rows[0].id;
  ids.mayuraOwner = await addUser('admin@mayura.test');
  await db.query("insert into public.staff_members (user_id, email, role, business_id) values ($1, 'admin@mayura.test', 'owner', $2)", [ids.mayuraOwner, ids.mayura]);
  // A different number for now: the old "one row per phone" key stays until the M2 server
  // update switches to the per-business key (business_id, phone).
  await db.query("insert into public.whatsapp_leads (phone, name, business_id) values ('919000000003', 'Ravi at Mayura', $1)", [ids.mayura]);
  ids.platform = await addUser('platform@crm.test');
  await db.query("insert into public.platform_admins (user_id, email) values ($1, 'platform@crm.test')", [ids.platform]);
});

test('all existing data now belongs to Arogya Ruchulu', async () => {
  for (const t of ['whatsapp_leads', 'whatsapp_messages', 'whatsapp_bot_rules', 'whatsapp_catalog', 'lead_notes', 'staff_members', 'ai_settings', 'ai_provider']) {
    const r = await db.query(`select count(*)::int as n from public.${t} where business_id = $1`, [AROGYA]);
    assert.ok(r.rows[0].n >= 1, `${t} should have Arogya rows`);
    const nulls = await db.query(`select count(*)::int as n from public.${t} where business_id is null`);
    assert.equal(nulls.rows[0].n, 0, `${t} has rows without a business`);
  }
  const plans = await db.query('select id from public.plans order by sort_order');
  assert.deepEqual(plans.rows.map(p => p.id), ['starter', 'growth', 'pro']);
});

test('Arogya staff see only Arogya data', async () => {
  const leads = await asUser(db, ids.agent, () => db.query('select name, business_id from public.whatsapp_leads order by name'));
  assert.deepEqual(leads.rows.map(r => r.name), ['Ravi', 'Sita']);
  assert.ok(leads.rows.every(r => r.business_id === AROGYA));
  const biz = await asUser(db, ids.owner, () => db.query('select name from public.businesses'));
  assert.deepEqual(biz.rows.map(r => r.name), ['Arogya Ruchulu']);
});

test('Mayura staff see only Mayura data', async () => {
  const leads = await asUser(db, ids.mayuraOwner, () => db.query('select name from public.whatsapp_leads'));
  assert.deepEqual(leads.rows.map(r => r.name), ['Ravi at Mayura']);
  const notes = await asUser(db, ids.mayuraOwner, () => db.query('select * from public.lead_notes'));
  assert.equal(notes.rows.length, 0);
  const staff = await asUser(db, ids.mayuraOwner, () => db.query('select email from public.staff_members'));
  assert.deepEqual(staff.rows.map(r => r.email), ['admin@mayura.test']);
});

test("staff can't write into another business", async () => {
  await assert.rejects(
    asUser(db, ids.owner, () => db.query("insert into public.whatsapp_leads (phone, name, business_id) values ('919000000009', 'x', $1)", [ids.mayura]))
  );
  // Without a business_id, the row lands in the user's own business (today's app behaviour).
  await asUser(db, ids.owner, () => db.query("insert into public.whatsapp_bot_rules (id, keyword, response_text, is_active) values ('r2', 'menu', 'Menu', true)"));
  const r = await db.query("select business_id from public.whatsapp_bot_rules where id = 'r2'");
  assert.equal(r.rows[0].business_id, AROGYA);
  // Updating another business's rows changes nothing.
  const upd = await asUser(db, ids.owner, () => db.query("update public.whatsapp_leads set name = 'hacked' where business_id = $1", [ids.mayura]));
  assert.equal(upd.affectedRows, 0);
});

test('the platform admin manages businesses but can never read chats or contacts', async () => {
  const biz = await asUser(db, ids.platform, () => db.query('select name from public.businesses order by name'));
  assert.deepEqual(biz.rows.map(r => r.name), ['Arogya Ruchulu', 'Mayura Hospitals']);
  for (const t of ['whatsapp_leads', 'whatsapp_messages', 'lead_notes', 'whatsapp_bot_rules', 'whatsapp_catalog', 'contact_events', 'ai_settings']) {
    const r = await asUser(db, ids.platform, () => db.query(`select count(*)::int as n from public.${t}`));
    assert.equal(r.rows[0].n, 0, `platform admin could read ${t}`);
  }
  await asUser(db, ids.platform, () => db.query("update public.businesses set plan_id = 'pro' where id = $1", [ids.mayura]));
  const p = await db.query('select plan_id from public.businesses where id = $1', [ids.mayura]);
  assert.equal(p.rows[0].plan_id, 'pro');
});

test('one login is either business staff or platform admin, and in only one business', async () => {
  await assert.rejects(db.query("insert into public.staff_members (user_id, email, role, business_id) values ($1, 'platform@crm.test', 'agent', $2)", [ids.platform, AROGYA]), /platform admin/);
  await assert.rejects(db.query("insert into public.platform_admins (user_id, email) values ($1, 'agent@arogya.test')", [ids.agent]), /already works for a business/);
  await assert.rejects(db.query("insert into public.staff_members (user_id, email, role, business_id) values ($1, 'agent@arogya.test', 'agent', $2)", [ids.agent, ids.mayura]));
});

test('the manager role exists; unknown roles are refused', async () => {
  await db.query("update public.staff_members set role = 'manager' where user_id = $1", [ids.agent]);
  await assert.rejects(db.query("update public.staff_members set role = 'boss' where user_id = $1", [ids.agent]));
  await db.query("update public.staff_members set role = 'agent' where user_id = $1", [ids.agent]);
});

test('browsers can never read secrets (AI keys, WhatsApp tokens) or write usage', async () => {
  for (const user of [ids.owner, ids.platform]) {
    await assert.rejects(asUser(db, user, () => db.query('select * from public.ai_provider')));
    await assert.rejects(asUser(db, user, () => db.query('select * from public.business_whatsapp')));
  }
  await assert.rejects(asUser(db, ids.owner, () => db.query("insert into public.usage_counters (business_id, period) values ($1, '2026-11')", [AROGYA])));
});

test('usage counters add up per business and month', async () => {
  await db.query("select public.add_usage($1, 'ai_replies', 3)", [AROGYA]);
  await db.query("select public.add_usage($1, 'ai_replies', 2)", [AROGYA]);
  await db.query("select public.add_usage($1, 'broadcasts_sent', 10)", [ids.mayura]);
  const r = await db.query('select business_id, ai_replies, broadcasts_sent from public.usage_counters order by ai_replies desc');
  assert.equal(r.rows[0].business_id, AROGYA);
  assert.equal(r.rows[0].ai_replies, 5);
  assert.equal(r.rows[1].broadcasts_sent, 10);
  await assert.rejects(db.query("select public.add_usage($1, 'drop_table', 1)", [AROGYA]), /Unknown usage metric/);
  const own = await asUser(db, ids.mayuraOwner, () => db.query('select business_id from public.usage_counters'));
  assert.deepEqual(own.rows.map(x => x.business_id), [ids.mayura]);
});

test('staff of a suspended business are locked out', async () => {
  await db.query("update public.businesses set status = 'suspended' where id = $1", [ids.mayura]);
  const leads = await asUser(db, ids.mayuraOwner, () => db.query('select * from public.whatsapp_leads'));
  assert.equal(leads.rows.length, 0);
  const staff = await asUser(db, ids.mayuraOwner, () => db.query('select public.is_staff() as s'));
  assert.equal(staff.rows[0].s, false);
  await db.query("update public.businesses set status = 'active' where id = $1", [ids.mayura]);
});
