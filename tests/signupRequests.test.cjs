// Public sign-up requests (the "Get started" page) and the public plans: validation (server AND the browser's
// copy, same cases), bot and duplicate handling that answers like a person, rate limit, Platform Admin approve /
// decline (creates the business + invite), who can see them, retention, and the database rules.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

process.env.APP_SECRET = 'server_encryption_secret_long_enough';
process.env.VITE_SUPABASE_URL = 'http://fake.supabase';
process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';

const app = require('../server/app.cjs');
const s = require('../server/signupRequests.cjs');
const { _setPlatformAdminForToken } = require('../server/platform.cjs');
const { _setStaffForToken } = require('../server/auth.cjs');
const { freshDb, asUser } = require('./helpers/pgHarness.cjs');
const { _resetLimits } = require('../server/security.cjs');

const GOOD = () => ({
  businessName: 'Sunrise Clinic', contactName: "Priya D'Souza-Rao", email: 'Priya@Sunrise.in', phone: '98765 43210', industry: 'hospital',
  city: 'Hyderabad', teamSize: '6-20', planInterest: 'growth', hasWhatsappApi: 'no', message: 'Two numbers, reception and pharmacy.',
  acceptTerms: true, acceptMarketing: false, startedAt: Date.now() - 60000, website: '',
});

let db, invites;
function seed() {
  db = {
    plans: [
      { id: 'starter', name: 'Starter', price_monthly_inr: 999, sort_order: 1, max_staff: 3, max_contacts: 1000, max_whatsapp_numbers: 1, ai_enabled: false, ads_enabled: false },
      { id: 'growth', name: 'Growth', price_monthly_inr: 2999, sort_order: 2, max_staff: 10, max_contacts: 10000, max_whatsapp_numbers: 2, ai_enabled: true, ads_enabled: true },
    ],
    signup_requests: [], businesses: [], audit_log: [], system_events: [], ai_settings: [],
  };
  invites = [];
  _resetLimits();
}
const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  if (u.includes('/auth/v1/invite')) { invites.push(JSON.parse(opts.body).email); return json({ id: 'f0000000-0000-4000-8000-00000000000a', email: JSON.parse(opts.body).email }); }
  if (u.includes('/auth/v1/')) return json({});
  if (!u.startsWith('http://fake.supabase/rest/v1/')) return json({}, 503);
  const [path, qs = ''] = u.slice('http://fake.supabase/rest/v1/'.length).split('?');
  const p = [...new URLSearchParams(qs).entries()];
  const body = opts.body ? JSON.parse(opts.body) : null;
  if (path.startsWith('rpc/')) return json([]);
  const rows = (db[path] ||= []);
  const filt = (r) => p.every(([k, v]) => {
    if (['select', 'order', 'limit', 'on_conflict'].includes(k)) return true;
    if (v.startsWith('eq.')) return String(r[k]) === v.slice(3);
    if (v.startsWith('lt.')) return String(r[k] || '') < v.slice(3);
    return true;
  });
  if (method === 'GET') return json(rows.filter(filt));
  if (method === 'POST') {
    const list = (Array.isArray(body) ? body : [body]).map(x => ({ ...x }));
    for (const r of list) {
      if (path === 'signup_requests') {
        if (rows.some(x => x.status === 'pending' && x.email === r.email)) return json({ code: '23505', message: 'duplicate key' }, 409);
        Object.assign(r, { id: `5${String(rows.length + 1).padStart(7, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, status: 'pending', created_at: new Date().toISOString() });
      }
      if (path === 'businesses') Object.assign(r, { id: `b${String(rows.length + 1).padStart(7, '0')}-0000-4000-8000-000000000001` });
      if (path === 'staff_members') continue;
      rows.push(r);
    }
    return json(list, 201);
  }
  if (method === 'PATCH') { const hit = rows.filter(filt); hit.forEach(r => Object.assign(r, body)); return json(hit); }
  if (method === 'DELETE') { db[path] = rows.filter(r => !filt(r)); return json([]); }
  return json([]);
};

let server, base;
before(async () => { server = app.listen(0); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
beforeEach(seed);
function request(method, path, { body, token, ip } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(ip ? { 'X-Forwarded-For': ip } : {}), ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } },
      (res) => { let t = ''; res.on('data', c => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, json: () => JSON.parse(t) })); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
_setPlatformAdminForToken('su-platform', { id: 'p1', email: 'root@platform.test' });
_setPlatformAdminForToken('su-staff', null);
_setStaffForToken('su-staff', { id: 'd0000000-0000-4000-8000-000000000031', email: 'owner@biz.test', role: 'owner', businessId: 'a0000000-0000-4000-8000-000000000001', businessName: 'x' });

// The same cases run against the server rules and the browser's copy (src/site/signupRules.ts).
const PHONES = [
  ['98765 43210', '919876543210'], ['+91 98765-43210', '919876543210'], ['09876543210', '919876543210'], ['919876543210', '919876543210'],
  ['+44 7911 123456', '447911123456'], ['+1 (415) 555-0132', '14155550132'],
  ['12345 67890', null], ['+91 12345 67890', null], ['98765', null], ['abc9876543210', null], ['7911123456789', null], ['', null],
];
const EMAILS = [
  ['name@business.com', true], ['first.last+crm@sub.domain.co.in', true], ['NAME@BUSINESS.IN', true],
  ['name@business', false], ['name@@business.com', false], ['name..x@business.com', false], ['name business@x.com', false], ['@business.com', false], ['name@.com', false],
];

test('validation: phone numbers and emails, server and browser agree', async () => {
  const web = await import('../src/site/signupRules.ts');
  for (const [raw, want] of PHONES) {
    assert.strictEqual(s.normalizePhone(raw), want, `server phone ${raw}`);
    assert.strictEqual(web.normalizePhone(raw), want, `browser phone ${raw}`);
  }
  for (const [email, okay] of EMAILS) {
    const server = !s.validateSignup({ ...GOOD(), email }).errors?.email;
    const browser = !web.checkField('email', { ...GOOD(), email, city: '', teamSize: '', planInterest: '', hasWhatsappApi: '', message: '' });
    assert.strictEqual(server, okay, `server email ${email}`);
    assert.strictEqual(browser, okay, `browser email ${email}`);
  }
  assert.strictEqual(web.emailSuggestion('priya@gmial.com'), 'priya@gmail.com');
  assert.strictEqual(web.emailSuggestion('priya@gmail.com'), null);
});

test('validation: every field, with clear messages; good input is cleaned', async () => {
  const web = await import('../src/site/signupRules.ts');
  const ok = s.validateSignup(GOOD(), { planIds: ['starter', 'growth'] });
  assert.ok(!ok.errors, JSON.stringify(ok.errors));
  assert.deepStrictEqual([ok.value.email, ok.value.phone, ok.value.contact_name, ok.value.consent_marketing], ['priya@sunrise.in', '919876543210', "Priya D'Souza-Rao", false]);
  const bad = s.validateSignup({ businessName: '1', contactName: 'R2D2', email: 'x', phone: '123', industry: 'casino', city: 'Hyd3rabad', teamSize: '1000', planInterest: 'gold', hasWhatsappApi: 'maybe', message: 'x'.repeat(1001), acceptTerms: false }, { planIds: ['starter'] });
  assert.deepStrictEqual(Object.keys(bad.errors).sort(), ['acceptTerms', 'businessName', 'city', 'contactName', 'email', 'hasWhatsappApi', 'industry', 'message', 'phone', 'planInterest', 'teamSize']);
  assert.match(bad.errors.acceptTerms, /Terms and the Privacy Policy/);
  assert.match(s.validateSignup({ ...GOOD(), businessName: '123 456' }).errors.businessName, /at least one letter/);
  // The browser shows the same problems for the same input.
  const form = { ...GOOD(), businessName: '1', contactName: 'R2D2', email: 'x', phone: '123', industry: 'casino', city: 'Hyd3rabad', teamSize: '1000', planInterest: 'gold', message: 'x'.repeat(1001), acceptTerms: false };
  assert.deepStrictEqual(Object.keys(web.checkAll(form, ['starter'])).sort(), ['acceptTerms', 'businessName', 'city', 'contactName', 'email', 'industry', 'message', 'phone', 'planInterest', 'teamSize']);
  assert.deepStrictEqual(web.checkAll({ ...GOOD(), city: '', message: '' }, ['starter', 'growth']), {});
});

test('public form: saves a valid request with consent recorded; field errors come back per field', async () => {
  const r = await request('POST', '/api/public/signup-requests', { body: GOOD(), ip: '10.0.0.1' });
  assert.strictEqual(r.status, 200);
  assert.match(r.json().message, /within 1–2 working days/);
  const row = db.signup_requests[0];
  assert.deepStrictEqual([row.email, row.phone, row.industry, row.plan_interest, row.policy_version], ['priya@sunrise.in', '919876543210', 'hospital', 'growth', s.POLICY_VERSION]);
  assert.ok(row.consent_at);
  assert.ok(db.system_events.some(e => e.code === 'signup_request'));
  assert.doesNotMatch(JSON.stringify(db.system_events), /priya|98765/i, 'no personal data in the event log');

  const bad = await request('POST', '/api/public/signup-requests', { body: { ...GOOD(), email: 'nope', acceptTerms: false }, ip: '10.0.0.2' });
  assert.strictEqual(bad.status, 400);
  assert.deepStrictEqual(Object.keys(bad.json().errors).sort(), ['acceptTerms', 'email']);
});

test('public form: bots (hidden field, instant submit) and repeats get the same thank-you but nothing is saved twice', async () => {
  for (const extra of [{ website: 'http://spam.example' }, { startedAt: Date.now() - 500 }]) {
    const r = await request('POST', '/api/public/signup-requests', { body: { ...GOOD(), ...extra }, ip: '10.0.1.1' });
    assert.strictEqual(r.status, 200);
  }
  assert.strictEqual(db.signup_requests.length, 0);
  await request('POST', '/api/public/signup-requests', { body: GOOD(), ip: '10.0.1.2' });
  const again = await request('POST', '/api/public/signup-requests', { body: GOOD(), ip: '10.0.1.3' });
  assert.strictEqual(again.status, 200, 'never reveals that this email already applied');
  assert.strictEqual(db.signup_requests.length, 1);
});

test('public form: at most 5 requests an hour from one network', async () => {
  for (let i = 0; i < 5; i++) await request('POST', '/api/public/signup-requests', { body: { ...GOOD(), email: `p${i}@sunrise.in` }, ip: '10.9.9.9' });
  const sixth = await request('POST', '/api/public/signup-requests', { body: { ...GOOD(), email: 'p6@sunrise.in' }, ip: '10.9.9.9' });
  assert.strictEqual(sixth.status, 429);
});

test('public plans: names, prices and limits only; no login needed', async () => {
  const r = await request('GET', '/api/public/plans');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.json().plans.map(p => [p.id, p.priceMonthlyInr, p.limits.whatsappNumbers, p.adsEnabled]), [['starter', 999, 1, false], ['growth', 2999, 2, true]]);
});

test('Platform Admin: lists, approves (business + invite on the chosen plan) and declines; nobody else can', async () => {
  await request('POST', '/api/public/signup-requests', { body: GOOD(), ip: '10.0.2.1' });
  await request('POST', '/api/public/signup-requests', { body: { ...GOOD(), businessName: 'Spice Kitchen', email: 'owner@spice.in', industry: 'food' }, ip: '10.0.2.2' });
  assert.strictEqual((await request('GET', '/api/platform/signup-requests')).status, 401);
  assert.strictEqual((await request('GET', '/api/platform/signup-requests', { token: 'su-staff' })).status, 403, 'business staff never see them');
  const list = await request('GET', '/api/platform/signup-requests', { token: 'su-platform' });
  assert.deepStrictEqual([list.status, list.json().requests.length, list.json().pendingCount], [200, 2, 2]);

  const [first, second] = db.signup_requests;
  const ok = await request('POST', `/api/platform/signup-requests/${first.id}/approve`, { token: 'su-platform', body: { planId: 'starter' } });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.json()));
  assert.deepStrictEqual([db.businesses[0].name, db.businesses[0].plan_id, db.businesses[0].industry], ['Sunrise Clinic', 'starter', 'hospital']);
  assert.deepStrictEqual(invites, ['priya@sunrise.in']);
  assert.deepStrictEqual([first.status, first.decided_by, first.business_id], ['approved', 'root@platform.test', db.businesses[0].id]);
  assert.strictEqual((await request('POST', `/api/platform/signup-requests/${first.id}/approve`, { token: 'su-platform' })).status, 400, 'only once');

  const no = await request('POST', `/api/platform/signup-requests/${second.id}/reject`, { token: 'su-platform', body: { note: 'Duplicate of an existing customer' } });
  assert.strictEqual(no.status, 200);
  assert.deepStrictEqual([second.status, second.decision_note], ['rejected', 'Duplicate of an existing customer']);
  assert.strictEqual(db.businesses.length, 1);
});

test('retention: decided requests are deleted after 30 days (approved) / 90 days (declined); open ones stay', async () => {
  const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
  db.signup_requests.push(
    { id: '1', status: 'approved', decided_at: daysAgo(31) }, { id: '2', status: 'approved', decided_at: daysAgo(10) },
    { id: '3', status: 'rejected', decided_at: daysAgo(91) }, { id: '4', status: 'rejected', decided_at: daysAgo(60) },
    { id: '5', status: 'pending', decided_at: null },
  );
  await s.prune();
  assert.deepStrictEqual(db.signup_requests.map(r => r.id), ['2', '4', '5']);
});

test('migration: server-only, checked values, one open request per email, safe to re-run', async () => {
  const pg = await freshDb();
  await pg.exec(require('fs').readFileSync(require('path').join(__dirname, '..', 'supabase', 'migrations', '20261127_signup_requests.sql'), 'utf8'));
  const ins = (email, extra = '') => pg.query(`insert into public.signup_requests (business_name, contact_name, email, phone, industry, consent_at, policy_version${extra ? ', industry_extra' : ''}) values ('Sunrise', 'Priya', $1, '919876543210', 'hospital', now(), '1')`, [email]);
  await ins('a@b.in');
  await assert.rejects(ins('A@B.in'), /duplicate|unique/, 'same email (any case) while one is open');
  await assert.rejects(pg.query("insert into public.signup_requests (business_name, contact_name, email, phone, industry, consent_at, policy_version) values ('S', 'P', 'x@y.in', '98', 'hospital', now(), '1')"), /check/);
  await assert.rejects(pg.query("insert into public.signup_requests (business_name, contact_name, email, phone, industry, consent_at, policy_version) values ('Sunrise', 'Priya', 'z@y.in', '919876543210', 'casino', now(), '1')"), /check/);
  await assert.rejects(pg.query("insert into public.signup_requests (business_name, contact_name, email, phone, industry, policy_version) values ('Sunrise', 'Priya', 'q@y.in', '919876543210', 'food', '1')"), /null/, 'consent is required');
  const u = await pg.query("insert into auth.users (email) values ('o@x.in') returning id");
  await pg.query("insert into public.staff_members (user_id, email, role, business_id) values ($1, 'o@x.in', 'owner', 'a0000000-0000-4000-8000-000000000001')", [u.rows[0].id]);
  await assert.rejects(asUser(pg, u.rows[0].id, () => pg.query('select * from public.signup_requests')));
  await assert.rejects(asUser(pg, null, () => pg.query('select * from public.signup_requests')), undefined, 'not even anonymously');
});
