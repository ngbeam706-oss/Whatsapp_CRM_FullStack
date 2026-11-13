// Business details (server/business.cjs, SQL 20261131): the Business Admin keeps what the business is and how to
// reach it on My profile. Only the Business Admin edits them, only their own business; every field is checked;
// fields not sent are kept; the business type (industry, which decides Meta's healthcare rules) can't be changed
// here; the audit log names the changed fields, not their values.
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
const business = require('../server/business.cjs');
const { _setStaffForToken } = require('../server/auth.cjs');
const { freshDb, asUser } = require('./helpers/pgHarness.cjs');

let db, detailsColumn;
function seed() {
  db = {
    businesses: [
      { id: A, name: 'Sunrise Clinic', status: 'active', plan_id: 'pro', industry: 'hospital', send_window_start: 9, send_window_end: 20, details: { city: 'Hyderabad', about: 'Eye care' } },
      { id: B, name: 'Other', status: 'active', plan_id: 'pro', industry: 'food', send_window_start: 9, send_window_end: 20, details: { city: 'Elsewhere' } },
    ],
    audit_log: [],
  };
  detailsColumn = true;
}

const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  if (!u.startsWith('http://fake.supabase/rest/v1/')) return json({}, 503);
  const [path, qs = ''] = u.slice('http://fake.supabase/rest/v1/'.length).split('?');
  const p = [...new URLSearchParams(qs).entries()];
  // Before the SQL: asking for the details column fails, as in Postgres.
  if (!detailsColumn && path === 'businesses' && (/details/.test(qs) || /"details"/.test(String(opts.body || '')))) return json({ message: 'column businesses.details does not exist' }, 400);
  const body = opts.body ? JSON.parse(opts.body) : null;
  const rows = (db[path] ||= []);
  const filt = (r) => p.every(([k, v]) => (['select', 'order', 'limit'].includes(k) ? true : v.startsWith('eq.') ? String(r[k]) === v.slice(3) : true));
  if (method === 'GET') return json(rows.filter(filt));
  if (method === 'POST') { rows.push(...(Array.isArray(body) ? body : [body])); return json([], 201); }
  if (method === 'PATCH') { const hit = rows.filter(filt); hit.forEach(r => Object.assign(r, body)); return json(hit); }
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
      (res) => { let t = ''; res.on('data', ch => { t += ch; }); res.on('end', () => resolve({ status: res.statusCode, json: () => (t ? JSON.parse(t) : null) })); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const who = (n, role, biz = A) => ({ id: `d0000000-0000-4000-8000-00000000030${n}`, email: `${role}${n}@sunrise.test`, role, businessId: biz, businessName: 'x' });
_setStaffForToken('bd-owner', who(1, 'owner'));
_setStaffForToken('bd-manager', who(2, 'manager'));
_setStaffForToken('bd-agent', who(3, 'agent'));
const mine = () => db.businesses.find(b => b.id === A);

test('pure: every field checked and tidied; unknown fields dropped; "" clears one', () => {
  const ok = business.cleanDetails({
    about: '  We care  for eyes.\r\n\r\n\r\n\r\nSince 1999. ', phone: '+91 40 1234 5678', email: 'care@sunrise.example', website: 'www.sunrise.example/about',
    pin: '500001', gstin: '36abcde1234f1z5', city: '', evil: '<script>', industry: 'food',
  });
  assert.deepStrictEqual(ok.values, {
    about: 'We care for eyes.\n\nSince 1999.', phone: '+91 40 1234 5678', email: 'care@sunrise.example', website: 'https://www.sunrise.example/about',
    pin: '500001', gstin: '36ABCDE1234F1Z5', city: '',
  });
  assert.match(business.cleanDetails({ pin: '50001' }).error, /PIN code: 6 digits/);
  assert.match(business.cleanDetails({ gstin: 'ABC' }).error, /GSTIN: 15 characters/);
  assert.match(business.cleanDetails({ email: 'not-an-email' }).error, /valid email/);
  assert.match(business.cleanDetails({ website: 'javascript:alert(1)' }).error, /like www\.example\.com/);
  assert.match(business.cleanDetails({ phone: 'call us' }).error, /digits only/);
  assert.match(business.cleanDetails({ about: 'x'.repeat(1001) }).error, /longer than 1000/);
  assert.match(business.cleanDetails({ legalName: '<b>Sunrise</b>' }).error, /< and > are not allowed/);
  assert.match(business.cleanDetails({ hours: { open: 9 } }).error, /must be text/);
  assert.strictEqual(business.cleanDetails({ hours: { open: 9 } }).field, 'hours');
});

test('the Business Admin saves details: merged with what is saved, own business only; the type of business stays', async () => {
  const r = await request('PUT', '/api/business', 'bd-owner', { details: { phone: '+91 40 1234 5678', about: '', gstin: '36ABCDE1234F1Z5' }, industry: 'food' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json()));
  assert.deepStrictEqual(mine().details, { city: 'Hyderabad', phone: '+91 40 1234 5678', gstin: '36ABCDE1234F1Z5' }, 'city kept, about cleared');
  assert.strictEqual(mine().industry, 'hospital', 'the business type is the platform\'s');
  assert.deepStrictEqual(db.businesses.find(b => b.id === B).details, { city: 'Elsewhere' });
  assert.deepStrictEqual(r.json().business.details.phone, '+91 40 1234 5678');
  assert.strictEqual(r.json().business.industry, 'hospital');
  // Audit: which fields, never the values.
  const a = db.audit_log.at(-1);
  assert.deepStrictEqual(a.details, { detailFields: ['about', 'phone', 'gstin'] });
  assert.doesNotMatch(JSON.stringify(db.audit_log), /1234 5678|36ABCDE/);
  // A bad field: nothing saved.
  const bad = await request('PUT', '/api/business', 'bd-owner', { details: { pin: '12', city: 'Changed' } });
  assert.strictEqual(bad.status, 400);
  assert.strictEqual(mine().details.city, 'Hyderabad');
});

test('managers and agents read their business\'s details only through the Business Admin\'s screens: agents can\'t, managers can\'t change them', async () => {
  assert.strictEqual((await request('PUT', '/api/business', 'bd-manager', { details: { city: 'X' } })).status, 403);
  assert.strictEqual((await request('PUT', '/api/business', 'bd-agent', { details: { city: 'X' } })).status, 403);
  assert.strictEqual((await request('GET', '/api/business', 'bd-agent')).status, 403);
  const m = await request('GET', '/api/business', 'bd-manager');
  assert.deepStrictEqual([m.json().business.details.city, m.json().business.detailsReady], ['Hyderabad', true]);
  assert.strictEqual(mine().details.city, 'Hyderabad');
});

test('before the SQL is run: the page still loads (name and hours work) and saving details says what to run', async () => {
  detailsColumn = false;
  const g = await request('GET', '/api/business', 'bd-owner');
  assert.strictEqual(g.status, 200);
  assert.deepStrictEqual([g.json().business.name, g.json().business.detailsReady], ['Sunrise Clinic', false]);
  assert.match((await request('PUT', '/api/business', 'bd-owner', { details: { city: 'X' } })).json().error, /business details SQL \(20261131\)/);
  assert.strictEqual((await request('PUT', '/api/business', 'bd-owner', { name: 'Sunrise Eye Clinic' })).status, 200);
});

test('migration: a details object (no arrays or huge blobs), staff read their own business only, safe to re-run', async () => {
  const pg = await freshDb();
  const sql = require('fs').readFileSync(require('path').join(__dirname, '..', 'supabase', 'migrations', '20261131_business_details.sql'), 'utf8');
  await pg.exec(sql);
  await pg.exec(sql);
  const biz = (await pg.query("select id from public.businesses limit 1")).rows[0].id;
  await pg.query("update public.businesses set details = '{\"city\":\"Hyderabad\"}' where id = $1", [biz]);
  await assert.rejects(pg.query("update public.businesses set details = '[1,2]' where id = $1", [biz]), /check/);
  await assert.rejects(pg.query("update public.businesses set details = jsonb_build_object('about', repeat('x', 20000)) where id = $1", [biz]), /check/);
  const u = await pg.query("insert into auth.users (email) values ('owner@x.in') returning id");
  const other = await pg.query("insert into public.businesses (name, slug, status, plan_id) values ('Other', 'other-bd', 'active', 'starter') returning id");
  await pg.query("insert into public.staff_members (user_id, email, role, business_id) values ($1, 'owner@x.in', 'owner', $2)", [u.rows[0].id, other.rows[0].id]);
  const seen = await asUser(pg, u.rows[0].id, () => pg.query('select id, details from public.businesses'));
  assert.deepStrictEqual(seen.rows.map(r => r.id), [other.rows[0].id], 'another business\'s details are not visible');
});
