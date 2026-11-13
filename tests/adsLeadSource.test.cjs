// Ads phase A: which Click-to-WhatsApp ad a contact came from (first touch kept, latest ad
// recorded, source no longer overwritten), still scoped per business.
const test = require('node:test');
const assert = require('node:assert');
const { freshDb, migrationSql, asUser } = require('./helpers/pgHarness.cjs');

process.env.SUPABASE_SERVICE_ROLE_KEY = '';
const { adsPerformance } = require('../server/analytics.cjs');

const AROGYA = 'a0000000-0000-4000-8000-000000000001';
const ADS_A = '20261112_ads_a_lead_source.sql';

let db;
const ids = {};

/** Same statement shape the server sends through PostgREST (merge-duplicates on business_id, phone). */
function logLead(biz, phone, source, referral = null) {
  const cols = ['business_id', 'phone', 'name', 'last_message', 'source'];
  const vals = [biz, phone, `+${phone}`, 'hi', source];
  if (referral) { cols.push('referral'); vals.push(JSON.stringify(referral)); }
  const ph = vals.map((_, i) => `$${i + 1}`).join(', ');
  const set = cols.filter(c => c !== 'business_id' && c !== 'phone').map(c => `${c} = excluded.${c}`).join(', ');
  return db.query(`insert into public.whatsapp_leads (${cols.join(', ')}) values (${ph}) on conflict (business_id, phone) do update set ${set}`, vals);
}

const lead = async (biz, phone) => (await db.query('select * from public.whatsapp_leads where business_id = $1 and phone = $2', [biz, phone])).rows[0];
const ad = (id, headline) => ({ source_id: id, source_type: 'ad', headline, ctwa_clid: `clid-${id}-${Math.random()}` });

test.before(async () => {
  db = await freshDb({ upTo: '20261111_zz' });
  // A contact saved from an ad before this migration existed.
  await db.query("insert into public.whatsapp_leads (business_id, phone, name, source, referral) values ($1, '919000000050', 'Old ad lead', 'Instagram Ad', $2)",
    [AROGYA, JSON.stringify({ source_id: 'ad-old', source_type: 'ad', headline: 'Millet Combo' })]);
  // Safe to re-run.
  await db.exec(migrationSql(ADS_A));
  await db.exec(migrationSql(ADS_A));

  const b = await db.query("insert into public.businesses (name, slug, plan_id) values ('Mayura Hospitals', 'mayura-ads', 'growth') returning id");
  ids.mayura = b.rows[0].id;
  const u = await db.query("insert into auth.users (email) values ('admin@mayura-ads.test') returning id");
  ids.mayuraOwner = u.rows[0].id;
  await db.query("insert into public.staff_members (user_id, email, role, business_id) values ($1, 'admin@mayura-ads.test', 'owner', $2)", [ids.mayuraOwner, ids.mayura]);
  const p = await db.query("insert into auth.users (email) values ('platform@ads.test') returning id");
  ids.platform = p.rows[0].id;
  await db.query("insert into public.platform_admins (user_id, email) values ($1, 'platform@ads.test')", [ids.platform]);
});

test('existing ad referrals are backfilled', async () => {
  const l = await lead(AROGYA, '919000000050');
  assert.strictEqual(l.first_ad_id, 'ad-old');
  assert.strictEqual(l.first_ad_headline, 'Millet Combo');
  assert.strictEqual(l.last_ad_id, 'ad-old');
});

test('first ad is kept, latest ad is updated, source stays where they first came from', async () => {
  await logLead(AROGYA, '919000000051', 'Instagram Ad', ad('ad-1', 'Healthy Snack Box'));
  let l = await lead(AROGYA, '919000000051');
  assert.strictEqual(l.first_ad_id, 'ad-1');
  assert.strictEqual(l.last_ad_id, 'ad-1');
  assert.strictEqual(l.source, 'Instagram Ad');

  // A normal follow-up message: no referral, source "Direct WhatsApp" must not overwrite.
  await logLead(AROGYA, '919000000051', 'Direct WhatsApp');
  l = await lead(AROGYA, '919000000051');
  assert.strictEqual(l.source, 'Instagram Ad');
  assert.strictEqual(l.first_ad_id, 'ad-1');

  // Later they tap a different ad.
  await logLead(AROGYA, '919000000051', 'Meta Ad', ad('ad-2', 'Ragi Cookies'));
  l = await lead(AROGYA, '919000000051');
  assert.strictEqual(l.first_ad_id, 'ad-1');
  assert.strictEqual(l.first_ad_headline, 'Healthy Snack Box');
  assert.strictEqual(l.last_ad_id, 'ad-2');
  assert.strictEqual(l.last_ad_headline, 'Ragi Cookies');
  assert.strictEqual(l.source, 'Instagram Ad');
});

test('a contact who first came directly records the ad they later came through', async () => {
  await logLead(AROGYA, '919000000052', 'Direct WhatsApp');
  await logLead(AROGYA, '919000000052', 'Meta Ad', ad('ad-3', null));
  const l = await lead(AROGYA, '919000000052');
  assert.strictEqual(l.source, 'Direct WhatsApp');
  assert.strictEqual(l.first_ad_id, 'ad-3');
  assert.strictEqual(l.first_ad_headline, null);
});

test('non-ad referrals (e.g. a post) are not counted as ads', async () => {
  await logLead(AROGYA, '919000000053', 'Meta Ad', { source_id: 'post-1', source_type: 'post' });
  const l = await lead(AROGYA, '919000000053');
  assert.strictEqual(l.first_ad_id, null);
  assert.strictEqual(l.last_ad_id, null);
});

test('the same number in another business has its own ad history', async () => {
  await logLead(ids.mayura, '919000000051', 'Meta Ad', ad('ad-m', 'Health checkup'));
  assert.strictEqual((await lead(ids.mayura, '919000000051')).first_ad_id, 'ad-m');
  assert.strictEqual((await lead(AROGYA, '919000000051')).first_ad_id, 'ad-1');
});

test('ad columns follow the per-business rules; the Platform Admin cannot read them', async () => {
  const mine = await asUser(db, ids.mayuraOwner, () => db.query('select phone, first_ad_id from public.whatsapp_leads'));
  assert.deepStrictEqual(mine.rows.map(r => r.first_ad_id), ['ad-m']);
  const platform = await asUser(db, ids.platform, () => db.query('select first_ad_id from public.whatsapp_leads'));
  assert.strictEqual(platform.rows.length, 0);
});

test('adsPerformance: new vs returning contacts and conversion per ad', () => {
  const from = '2026-11-01T00:00:00Z';
  const leads = [
    // New from ad A, now ordered.
    { stage: 'ordered', first_ad_id: 'A', first_ad_at: '2026-11-02T00:00:00Z', first_ad_headline: 'Snack Box', last_ad_id: 'A', last_ad_at: '2026-11-02T00:00:00Z', last_ad_headline: 'Snack Box' },
    // New from ad A, still new.
    { stage: 'new', first_ad_id: 'A', first_ad_at: '2026-11-03T00:00:00Z', last_ad_id: 'A', last_ad_at: '2026-11-03T00:00:00Z' },
    // Old contact from ad A (before the period) who came back through ad B and booked.
    { stage: 'repeat', first_ad_id: 'A', first_ad_at: '2026-10-01T00:00:00Z', last_ad_id: 'B', last_ad_at: '2026-11-04T00:00:00Z', last_ad_headline: 'Ragi Cookies' },
    // Old ad contact with no activity in the period: not counted.
    { stage: 'ordered', first_ad_id: 'C', first_ad_at: '2026-09-01T00:00:00Z', last_ad_id: 'C', last_ad_at: '2026-09-01T00:00:00Z' },
    // Not from an ad.
    { stage: 'ordered' },
  ];
  const r = adsPerformance(leads, from);
  assert.deepStrictEqual(r.map(x => [x.adId, x.headline, x.newLeads, x.returning, x.converted]), [
    ['A', 'Snack Box', 2, 0, 1],
    ['B', 'Ragi Cookies', 0, 1, 1],
  ]);
  assert.strictEqual(r[0].conversion, 0.5);
  assert.strictEqual(r[1].conversion, 1);
});
