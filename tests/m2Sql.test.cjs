// M2 SQL (parts A and B) on a real Postgres (PGlite): per-business keys and helpers.
const test = require('node:test');
const assert = require('node:assert');
const { freshDb, migrationSql, asUser } = require('./helpers/pgHarness.cjs');

const AROGYA = 'a0000000-0000-4000-8000-000000000001';
let db;
const ids = {};

test.before(async () => {
  db = await freshDb({ upTo: '20261107_zz' });   // everything up to and including M1
  const u = async (email) => (await db.query('insert into auth.users (email) values ($1) returning id', [email])).rows[0].id;
  ids.owner = await u('owner@arogya.test');
  ids.mayuraOwner = await u('admin@mayura.test');
  ids.newbie = await u('new@person.test');
  await db.query("insert into public.staff_members (user_id, email, role) values ($1, 'owner@arogya.test', 'owner')", [ids.owner]);
  await db.exec(`
    insert into public.whatsapp_leads (phone, name) values ('919000000001', 'Ravi');
    insert into public.whatsapp_bot_rules (id, keyword, response_text, is_active) values ('r1', 'price', 'Thali 130', true);
    insert into public.whatsapp_catalog (id, data) values ('main_catalog', '{}');
  `);
  // Part A, then (after the deploy) part B; both twice to prove they are safe to re-run.
  for (const f of ['20261108_m2a_before_deploy.sql', '20261108_m2a_before_deploy.sql', '20261108_m2b_after_deploy.sql', '20261108_m2b_after_deploy.sql']) {
    await db.exec(migrationSql(f));
  }
  ids.mayura = (await db.query("insert into public.businesses (name, slug) values ('Mayura Hospitals', 'mayura-hospitals') returning id")).rows[0].id;
  await db.query("insert into public.staff_members (user_id, email, role, business_id) values ($1, 'admin@mayura.test', 'owner', $2)", [ids.mayuraOwner, ids.mayura]);
});

test('the same customer, rule id, catalog and AI settings can exist in two businesses', async () => {
  await db.query("insert into public.whatsapp_leads (business_id, phone, name) values ($1, '919000000001', 'Ravi at Mayura')", [ids.mayura]);
  await db.query("insert into public.whatsapp_bot_rules (business_id, id, keyword, response_text, is_active) values ($1, 'r1', 'price', 'OPD fee', true)", [ids.mayura]);
  await db.query("insert into public.whatsapp_catalog (business_id, id, data) values ($1, 'main_catalog', '{}')", [ids.mayura]);
  await db.query('insert into public.ai_settings (business_id) values ($1)', [ids.mayura]);
  await db.query('insert into public.ai_provider (business_id) values ($1)', [ids.mayura]);
  const n = await db.query("select count(*)::int as n from public.whatsapp_leads where phone = '919000000001'");
  assert.equal(n.rows[0].n, 2);
  // ...but still only once per business.
  await assert.rejects(db.query("insert into public.whatsapp_leads (business_id, phone) values ($1, '919000000001')", [ids.mayura]));
  await assert.rejects(db.query('insert into public.ai_settings (business_id) values ($1)', [ids.mayura]));
});

test('the server\'s upserts work with the per-business keys', async () => {
  await db.query("insert into public.whatsapp_leads (business_id, phone, name) values ($1, '919000000001', 'Ravi K') on conflict (business_id, phone) do update set name = excluded.name", [AROGYA]);
  await db.query("insert into public.whatsapp_bot_rules (business_id, id, keyword) values ($1, 'r1', 'rate') on conflict (business_id, id) do update set keyword = excluded.keyword", [AROGYA]);
  await db.query("insert into public.ai_settings (business_id, auto_reply) values ($1, true) on conflict (business_id) do update set auto_reply = excluded.auto_reply", [AROGYA]);
  const r = await db.query("select name from public.whatsapp_leads where business_id = $1 and phone = '919000000001'", [AROGYA]);
  assert.equal(r.rows[0].name, 'Ravi K');
  const m = await db.query("select keyword from public.whatsapp_bot_rules where business_id = $1 and id = 'r1'", [ids.mayura]);
  assert.equal(m.rows[0].keyword, 'price', 'Mayura\'s rule must be untouched');
});

test('a server row without business_id fails; a browser row lands in the user\'s own business', async () => {
  await assert.rejects(db.query("insert into public.lead_notes (phone, author, body) values ('1', 'server', 'x')"), /business_id/);
  await asUser(db, ids.mayuraOwner, () => db.query("insert into public.whatsapp_bot_rules (id, keyword, response_text, is_active) values ('r2', 'hi', 'Hello', true)"));
  const r = await db.query("select business_id from public.whatsapp_bot_rules where id = 'r2'");
  assert.equal(r.rows[0].business_id, ids.mayura);
});

test('incoming-message counter only touches the right business', async () => {
  await db.query("select public.lead_mark_inbound_in_business($1, '919000000001')", [ids.mayura]);
  const r = await db.query("select business_id, unread_count from public.whatsapp_leads where phone = '919000000001' order by business_id");
  const byBiz = Object.fromEntries(r.rows.map(x => [x.business_id, x.unread_count]));
  assert.equal(byBiz[ids.mayura], 1);
  assert.equal(byBiz[AROGYA], 0);
});

test('adding an existing login never moves them out of another business', async () => {
  await assert.rejects(db.query("select * from public.staff_add_existing_to_business('owner@arogya.test', 'agent', $1)", [ids.mayura]), /another business/);
  const still = await db.query('select business_id, role from public.staff_members where user_id = $1', [ids.owner]);
  assert.equal(still.rows[0].business_id, AROGYA);
  assert.equal(still.rows[0].role, 'owner');
  const added = await db.query("select * from public.staff_add_existing_to_business('new@person.test', 'manager', $1)", [ids.mayura]);
  assert.equal(added.rows[0].business_id, ids.mayura);
  assert.equal(added.rows[0].role, 'manager');
  const none = await db.query("select * from public.staff_add_existing_to_business('nobody@x.test', 'agent', $1)", [ids.mayura]);
  assert.equal(none.rows.length, 0);
});

test('agents can read the bot setup but only managers and the Business Admin can change it', async () => {
  const agent = (await db.query("insert into auth.users (email) values ('agent@arogya.test') returning id")).rows[0].id;
  const manager = (await db.query("insert into auth.users (email) values ('manager@arogya.test') returning id")).rows[0].id;
  await db.query("insert into public.staff_members (user_id, email, role, business_id) values ($1, 'agent@arogya.test', 'agent', $3), ($2, 'manager@arogya.test', 'manager', $3)", [agent, manager, AROGYA]);
  const seen = await asUser(db, agent, () => db.query('select id from public.whatsapp_bot_rules'));
  assert.ok(seen.rows.length >= 1);
  await assert.rejects(asUser(db, agent, () => db.query("insert into public.whatsapp_bot_rules (id, keyword) values ('agent-rule', 'x')")));
  const upd = await asUser(db, agent, () => db.query("update public.whatsapp_bot_rules set keyword = 'hacked'"));
  assert.equal(upd.affectedRows, 0);
  await asUser(db, manager, () => db.query("insert into public.whatsapp_bot_rules (id, keyword) values ('manager-rule', 'menu')"));
  const ok = await db.query("select business_id from public.whatsapp_bot_rules where id = 'manager-rule'");
  assert.equal(ok.rows[0].business_id, AROGYA);
  // Agents still work on chats.
  await asUser(db, agent, () => db.query("update public.whatsapp_leads set stage = 'interested' where phone = '919000000001'"));
});

test('the pipeline accepts the new Completed stage and still refuses unknown stages', async () => {
  await db.exec(migrationSql('20261110_pipeline_stages_all_businesses.sql'));
  await db.exec(migrationSql('20261110_pipeline_stages_all_businesses.sql')); // safe to re-run
  await db.query("update public.whatsapp_leads set stage = 'completed' where business_id = $1 and phone = '919000000001'", [AROGYA]);
  await assert.rejects(db.query("update public.whatsapp_leads set stage = 'admitted' where business_id = $1", [AROGYA]));
  await db.query("update public.whatsapp_leads set stage = 'new' where business_id = $1 and phone = '919000000001'", [AROGYA]);
});

test('the old single-business helpers are gone and browsers can\'t call the new ones', async () => {
  const fns = await db.query("select proname from pg_proc where proname in ('lead_mark_inbound', 'staff_add_existing')");
  assert.equal(fns.rows.length, 0);
  await assert.rejects(asUser(db, ids.owner, () => db.query("select public.lead_mark_inbound_in_business($1, '1')", [AROGYA])));
  await assert.rejects(asUser(db, ids.owner, () => db.query("select * from public.staff_add_existing_to_business('x@y.z', 'owner', $1)", [AROGYA])));
});
