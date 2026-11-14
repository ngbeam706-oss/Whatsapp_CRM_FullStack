// Platform console → Businesses → a business → "Business details": name + business type (industry).
// Platform Owner and Application Manager may change them (onboarding); the Application Developer may not; plan / status
// / limits stay Platform Owner only. Changes are audited from → to. Turning a business into "hospital" turns on the
// Clinic tools for its staff.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const SUN = 'a0000000-0000-4000-8000-000000000001';
process.env.APP_SECRET = 'server_encryption_secret_long_enough';
process.env.VITE_SUPABASE_URL = 'http://fake.supabase';
process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';

const app = require('../server/app.cjs');
const { _setPlatformAdminForToken } = require('../server/platform.cjs');
const { _setStaffForToken } = require('../server/auth.cjs');

let db;
function seed() {
  db = { businesses: [{ id: SUN, name: 'Sunrise Clinic test', slug: 'sunrise', status: 'active', plan_id: 'pro', industry: 'general' }], audit_log: [], clinic_settings: [] };
}
const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (!u.startsWith('http://fake.supabase/rest/v1/')) return json({}, 503);
  const [path, qs = ''] = u.slice('http://fake.supabase/rest/v1/'.length).split('?');
  const method = opts.method || 'GET';
  const body = opts.body ? JSON.parse(opts.body) : null;
  const rows = (db[path] ||= []);
  const p = [...new URLSearchParams(qs).entries()].filter(([k]) => !['select', 'order', 'limit'].includes(k));
  const match = (r) => p.every(([k, v]) => (v.startsWith('eq.') ? String(r[k]) === v.slice(3) : true));
  if (method === 'GET') return json(rows.filter(match));
  if (method === 'POST') { rows.push(...(Array.isArray(body) ? body : [body])); return json([], 201); }
  if (method === 'PATCH') { const hit = rows.filter(match); hit.forEach(r => Object.assign(r, body)); return json(hit); }
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
      (res) => { let t = ''; res.on('data', c => { t += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch { /* text */ } resolve({ status: res.statusCode, json: j }); }); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
_setPlatformAdminForToken('bd-owner', { id: 'p1', email: 'root@platform.test', role: 'owner' });
_setPlatformAdminForToken('bd-manager', { id: 'p2', email: 'support@platform.test', role: 'manager' });
_setPlatformAdminForToken('bd-developer', { id: 'p3', email: 'dev@platform.test', role: 'developer' });
_setStaffForToken('bd-staff-owner', { id: 'u1', email: 'admin@sun.test', role: 'owner', businessId: SUN, businessName: 'Sunrise Clinic test' });
const url = `/api/platform/businesses/${SUN}/details`;

test('Application Manager changes the business type to hospital: audited, and the Clinic tools appear for the business', async () => {
  assert.deepEqual((await request('GET', '/api/clinic/status', 'bd-staff-owner')).json, { success: true, enabled: false });
  const r = await request('PATCH', url, 'bd-manager', { name: 'Sunrise Clinic test', industry: 'hospital' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(db.businesses[0].industry, 'hospital');
  const a = db.audit_log.at(-1);
  assert.equal(a.action, 'business.details_changed');
  assert.deepEqual(a.details, { industry: { from: 'general', to: 'hospital' }, platformRole: 'manager' }, 'only what changed, and who');
  assert.equal(a.actor_email, 'support@platform.test');
  assert.equal((await request('GET', '/api/clinic/status', 'bd-staff-owner')).json.enabled, true);
});

test('Platform Owner renames; the Application Developer and business staff are refused; bad input refused; plan stays owner-only', async () => {
  assert.equal((await request('PATCH', url, 'bd-owner', { name: '  Sunrise   Hospitals  ' })).status, 200);
  assert.equal(db.businesses[0].name, 'Sunrise Hospitals');
  assert.equal((await request('PATCH', url, 'bd-developer', { industry: 'hospital' })).status, 403);
  assert.equal((await request('PATCH', url, 'bd-staff-owner', { industry: 'hospital' })).status, 403);
  assert.match((await request('PATCH', url, 'bd-owner', { industry: 'casino' })).json.error, /business type/);
  assert.match((await request('PATCH', url, 'bd-owner', { name: 'x' })).json.error, /2 to 80/);
  assert.equal((await request('PATCH', `/api/platform/businesses/${SUN}`, 'bd-manager', { planId: 'starter' })).status, 403, 'plan changes stay Platform Owner only');
  const unchanged = await request('PATCH', url, 'bd-owner', { name: 'Sunrise Hospitals', industry: 'general' });
  assert.equal(unchanged.json.unchanged, true);
  assert.equal(db.audit_log.filter(a => a.action === 'business.details_changed').length, 1, 'nothing changed: no audit row');
  assert.equal(db.businesses[0].industry, 'general');
});
