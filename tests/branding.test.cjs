// Platform branding (console -> Branding): the app's name, logo and contact details. Public to read (website,
// sign-in page), only the Platform Admin can change it; checked fields; the logo must really be a small PNG / JPEG /
// WebP (never SVG or a disguised file); served from our own address with a versioned, cacheable link.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

process.env.APP_SECRET = 'server_encryption_secret_long_enough';
process.env.VITE_SUPABASE_URL = 'http://fake.supabase';
process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';

const app = require('../server/app.cjs');
const branding = require('../server/branding.cjs');
const { _setPlatformAdminForToken } = require('../server/platform.cjs');
const { _setStaffForToken } = require('../server/auth.cjs');
const { _resetLimits } = require('../server/security.cjs');
const { freshDb, asUser } = require('./helpers/pgHarness.cjs');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 2)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(200, 3)]);
const dataUrl = (type, buf) => `data:${type};base64,${buf.toString('base64')}`;

let db;
function seed() { db = { platform_settings: [], audit_log: [] }; branding.clearCache(); _resetLimits(); }
const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (!u.startsWith('http://fake.supabase/rest/v1/')) return json({});
  const [path, qs = ''] = u.slice('http://fake.supabase/rest/v1/'.length).split('?');
  const method = opts.method || 'GET';
  const rows = (db[path] ||= []);
  const select = new URLSearchParams(qs).get('select');
  if (method === 'GET') {
    return json(rows.map(r => (select && select !== '*' ? Object.fromEntries(select.split(',').map(k => [k, r[k] ?? null])) : r)));
  }
  if (method === 'POST') {
    const body = JSON.parse(opts.body);
    if (path === 'platform_settings') {
      const hit = rows.find(r => r.id === body.id);
      if (hit) Object.assign(hit, body); else rows.push({ maintenance_on: false, branding: {}, ...body });
    } else rows.push(body);
    return json([], 201);
  }
  return json([]);
};

let server, base;
before(async () => { server = app.listen(0); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
beforeEach(seed);
function request(method, path, { body, token } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } },
      (res) => { const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => { const buf = Buffer.concat(chunks); resolve({ status: res.statusCode, headers: res.headers, buf, json: () => JSON.parse(buf.toString()) }); }); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
_setPlatformAdminForToken('br-platform', { id: 'p1', email: 'root@platform.test' });
_setPlatformAdminForToken('br-owner', null);
_setStaffForToken('br-owner', { id: 'd0000000-0000-4000-8000-000000000041', email: 'owner@biz.test', role: 'owner', businessId: 'a0000000-0000-4000-8000-000000000001', businessName: 'x' });

test('validation: emails, phone, CIN, GSTIN, names; cleaned; empty clears; no tags', () => {
  const ok = branding.validate({ brandName: '  ChatDesk  ', supportEmail: 'help@chatdesk.in', phone: '+91 98765 43210', cin: 'u72900tg2024ptc123456', gstin: '36abcde1234f1z5', grievanceOfficerName: "Priya D'Souza", jurisdictionCity: 'Hyderabad', tagline: '' });
  assert.ok('value' in ok, JSON.stringify(ok));
  assert.deepStrictEqual([ok.value.brandName, ok.value.cin, ok.value.gstin, ok.value.tagline], ['ChatDesk', 'U72900TG2024PTC123456', '36ABCDE1234F1Z5', '']);
  const bad = branding.validate({ brandName: 'X', supportEmail: 'help@', phone: '12', cin: 'ABC', gstin: '36ABCDE1234F1Z', grievanceOfficerName: 'R2D2', jurisdictionCity: 'Hyd3', tagline: '<script>x</script>', companyName: 5 });
  assert.deepStrictEqual(Object.keys(bad.errors).sort(), ['brandName', 'cin', 'companyName', 'grievanceOfficerName', 'gstin', 'jurisdictionCity', 'phone', 'supportEmail', 'tagline']);
  assert.match(bad.errors.tagline, /< and > are not allowed/);
  assert.ok('value' in branding.validate({ unknownField: 'x' }), 'unknown fields are ignored');
});

test('logo: real PNG / JPEG / WebP only (by their bytes), at most 300 KB; SVG and disguised files refused', () => {
  assert.strictEqual(branding.readLogo(dataUrl('image/png', PNG)).type, 'image/png');
  assert.strictEqual(branding.readLogo(dataUrl('image/jpeg', JPEG)).type, 'image/jpeg');
  assert.strictEqual(branding.readLogo(dataUrl('image/webp', WEBP)).type, 'image/webp');
  assert.strictEqual(branding.readLogo(dataUrl('image/png', JPEG)).type, 'image/jpeg', 'the real type wins over the claimed one');
  assert.match(branding.readLogo(dataUrl('image/svg+xml', Buffer.from('<svg onload="alert(1)"/>'))).error, /SVG is not accepted/);
  assert.match(branding.readLogo(dataUrl('image/png', Buffer.from('<html><script>alert(1)</script></html>'))).error, /not a valid PNG, JPG or WebP/);
  assert.match(branding.readLogo(dataUrl('image/png', Buffer.concat([PNG, Buffer.alloc(310 * 1024)]))).error, /too large/);
  assert.match(branding.readLogo('https://evil.example/logo.png').error, /Choose a PNG/);
});

test('only the Platform Admin reads the console view and changes branding; business staff and visitors cannot', async () => {
  for (const [method, path, body] of [['GET', '/api/platform/branding'], ['PUT', '/api/platform/branding', { brandName: 'Hacked' }], ['POST', '/api/platform/branding/logo', { dataUrl: dataUrl('image/png', PNG) }], ['DELETE', '/api/platform/branding/logo']]) {
    assert.strictEqual((await request(method, path, { body })).status, 401, `${method} ${path} without login`);
    assert.strictEqual((await request(method, path, { body, token: 'br-owner' })).status, 403, `${method} ${path} as a Business Admin`);
  }
  assert.strictEqual(db.platform_settings.length, 0, 'nothing was saved');
});

test('save: per-field problems come back; good details are saved, kept, cleared with "", audited, and public at once', async () => {
  const bad = await request('PUT', '/api/platform/branding', { token: 'br-platform', body: { supportEmail: 'nope', brandName: 'ChatDesk' } });
  assert.strictEqual(bad.status, 400);
  assert.deepStrictEqual(Object.keys(bad.json().errors), ['supportEmail']);
  assert.strictEqual(db.platform_settings.length, 0);

  const ok = await request('PUT', '/api/platform/branding', { token: 'br-platform', body: { brandName: 'ChatDesk', supportEmail: 'help@chatdesk.in', companyAddress: 'Plot 1, Madhapur\nHyderabad 500081' } });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.json()));
  assert.deepStrictEqual(ok.json().branding, { brandName: 'ChatDesk', supportEmail: 'help@chatdesk.in', companyAddress: 'Plot 1, Madhapur\nHyderabad 500081' });
  assert.strictEqual(ok.json().updatedBy, 'root@platform.test');
  // A second save keeps fields it doesn't send, and '' clears one.
  await request('PUT', '/api/platform/branding', { token: 'br-platform', body: { tagline: 'Chats that convert', supportEmail: '' } });
  assert.deepStrictEqual(db.platform_settings[0].branding, { brandName: 'ChatDesk', companyAddress: 'Plot 1, Madhapur\nHyderabad 500081', tagline: 'Chats that convert' });
  assert.deepStrictEqual(db.audit_log.map(a => a.action), ['platform.branding_updated', 'platform.branding_updated']);

  const pub = await request('GET', '/api/public/branding');
  assert.strictEqual(pub.status, 200);
  assert.deepStrictEqual(pub.json().branding, { brandName: 'ChatDesk', companyAddress: 'Plot 1, Madhapur\nHyderabad 500081', tagline: 'Chats that convert', logoUrl: null });
  assert.match(pub.headers['cache-control'], /public, max-age=60/);
  assert.doesNotMatch(JSON.stringify(pub.json()), /root@platform/, 'who changed it is not public');
});

test('logo: upload, served from our own address with a versioned long cache, replaced, removed', async () => {
  assert.strictEqual((await request('GET', '/api/public/logo')).status, 404);
  const svg = await request('POST', '/api/platform/branding/logo', { token: 'br-platform', body: { dataUrl: dataUrl('image/svg+xml', Buffer.from('<svg/>')) } });
  assert.strictEqual(svg.status, 400);

  const up = await request('POST', '/api/platform/branding/logo', { token: 'br-platform', body: { dataUrl: dataUrl('image/png', PNG) } });
  assert.strictEqual(up.status, 200, JSON.stringify(up.json()));
  const logoUrl = up.json().logoUrl;
  assert.match(logoUrl, /^\/api\/public\/logo\?v=[a-f0-9]{12}$/);
  const pub = (await request('GET', '/api/public/branding')).json();
  assert.strictEqual(pub.branding.logoUrl, logoUrl);
  const file = await request('GET', logoUrl);
  assert.deepStrictEqual([file.status, file.headers['content-type'], file.headers['cache-control']], [200, 'image/png', 'public, max-age=31536000, immutable']);
  assert.ok(file.buf.equals(PNG), 'the same bytes come back');
  assert.strictEqual(file.headers['x-content-type-options'], 'nosniff');

  await new Promise(r => setTimeout(r, 5));
  const again = await request('POST', '/api/platform/branding/logo', { token: 'br-platform', body: { dataUrl: dataUrl('image/jpeg', JPEG) } });
  assert.notStrictEqual(again.json().logoUrl, logoUrl, 'a new logo gets a new address, so browsers fetch it');
  const del = await request('DELETE', '/api/platform/branding/logo', { token: 'br-platform' });
  assert.strictEqual(del.json().logoUrl, null);
  assert.strictEqual((await request('GET', '/api/public/logo')).status, 404);
  assert.deepStrictEqual(db.audit_log.map(a => a.action), ['platform.logo_updated', 'platform.logo_updated', 'platform.logo_removed']);
});

test('migration: branding columns with checks, still server-only, safe to re-run', async () => {
  const pg = await freshDb();
  const sql = require('fs').readFileSync(require('path').join(__dirname, '..', 'supabase', 'migrations', '20261128_platform_branding.sql'), 'utf8');
  await pg.exec(sql);
  await pg.exec(sql);
  await pg.query("insert into public.platform_settings (id, branding) values (1, '{\"brandName\":\"ChatDesk\"}') on conflict (id) do update set branding = excluded.branding");
  await assert.rejects(pg.query("update public.platform_settings set brand_logo_type = 'image/svg+xml' where id = 1"), /check/);
  await assert.rejects(pg.query("update public.platform_settings set branding = '[1]' where id = 1"), /check/);
  await assert.rejects(pg.query('update public.platform_settings set brand_logo = repeat(\'A\', 409601) where id = 1'), /check/);
  const u = await pg.query("insert into auth.users (email) values ('o@x.in') returning id");
  await pg.query("insert into public.staff_members (user_id, email, role, business_id) values ($1, 'o@x.in', 'owner', 'a0000000-0000-4000-8000-000000000001')", [u.rows[0].id]);
  await assert.rejects(asUser(pg, u.rows[0].id, () => pg.query('select branding from public.platform_settings')));
  await assert.rejects(asUser(pg, null, () => pg.query('update public.platform_settings set branding = \'{}\'')));
});
