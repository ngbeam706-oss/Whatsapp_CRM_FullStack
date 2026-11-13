// M4: the Platform Admin console (counts only), new businesses, the neutral starter bot,
// and per-business sending hours. Fake database + fake Meta, no network.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const AROGYA = 'a0000000-0000-4000-8000-000000000001';
const MAYURA = 'b0000000-0000-4000-8000-000000000002';

process.env.APP_SECRET = 'server_encryption_secret_long_enough';
process.env.WHATSAPP_TOKEN = '';
process.env.PHONE_NUMBER_ID = '';
process.env.VITE_SUPABASE_URL = 'http://fake.supabase';
process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
process.env.WHATSAPP_BUSINESS_ID = AROGYA;

const secrets = require('../server/secrets.cjs');
const app = require('../server/app.cjs');
const { _setStaffForToken } = require('../server/auth.cjs');
const { _setPlatformAdminForToken } = require('../server/platform.cjs');
const platform = require('../server/platform.cjs');
const store = require('../server/botStore.cjs');
const business = require('../server/business.cjs');
const automations = require('../server/automations.cjs');
const whatsapp = require('../server/whatsapp.cjs');
const { handleArogyaRuchuluBot } = require('../server/bot.cjs');

const SECRET = 'PRIVATE_CUSTOMER_DATA';
let db;
let calls;
let sent;
let inviteBehaviour;
function seed() {
  db = {
    businesses: [
      { id: AROGYA, name: 'Arogya Ruchulu', slug: 'arogya-ruchulu', status: 'active', plan_id: 'pro', send_window_start: 9, send_window_end: 20, created_at: '2026-11-01T00:00:00Z' },
      { id: MAYURA, name: 'Mayura Hospitals', slug: 'mayura-hospitals', status: 'active', plan_id: 'growth', send_window_start: 8, send_window_end: 18, created_at: '2026-11-05T00:00:00Z' },
    ],
    plans: [{ id: 'starter', name: 'Starter', sort_order: 1 }, { id: 'growth', name: 'Growth', sort_order: 2 }, { id: 'pro', name: 'Pro', sort_order: 3 }],
    staff_members: [{ business_id: AROGYA, user_id: 'u1', email: 'owner@arogya.test', role: 'owner' }],
    whatsapp_leads: [{ business_id: AROGYA, phone: '919000000001', name: `${SECRET} Ravi` }],
    whatsapp_messages: [{ business_id: AROGYA, body: `${SECRET} hello`, timestamp: new Date().toISOString() }],
    business_whatsapp: [{
      business_id: MAYURA, phone_number: '919000000200', phone_number_id: '222222222222222', waba_id: '9222', token_last4: '9876',
      access_token_enc: secrets.encrypt('EAAG-mayura-token-9876'), app_secret_enc: secrets.encrypt('fedcba9876543210fedcba9876543210'),
      verify_token_enc: secrets.encrypt('v'), webhook_key: 'b'.repeat(32), graph_api_version: 'v26.0',
    }],
    usage_counters: [], audit_log: [], ai_settings: [], whatsapp_bot_rules: [], whatsapp_catalog: [], contact_events: [],
  };
  calls = [];
  sent = [];
  inviteBehaviour = () => ({ status: 200, body: { id: 'new-user-id' } });
  whatsapp.clearCache();
}

const json = (d, status = 200, headers = {}) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const eq = (u, k) => { const m = u.match(new RegExp(`[?&]${k}=eq\\.([^&]+)`)); return m ? decodeURIComponent(m[1]) : null; };

global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  if (u.startsWith('https://graph.facebook.com/')) {
    const body = opts.body ? JSON.parse(opts.body) : {};
    sent.push(body);
    return json({ messages: [{ id: `wamid.${sent.length}` }] });
  }
  if (u.startsWith('http://fake.supabase/auth/v1/invite')) { const r = inviteBehaviour(); return json(r.body, r.status); }
  if (!u.startsWith('http://fake.supabase/rest/v1/')) return json({}, 503);
  const path = u.slice('http://fake.supabase/rest/v1/'.length);
  const table = path.split('?')[0];
  const body = opts.body ? JSON.parse(opts.body) : null;
  calls.push({ table, method, url: u, prefer: opts.headers?.Prefer || '' });
  if (table === 'rpc/staff_add_existing_to_business') {
    return json({ message: 'This login already works for another business.' }, 400);
  }
  if (table.startsWith('rpc/')) return json([]);
  const rows = db[table] || (db[table] = []);
  const match = (r) => ['business_id', 'id', 'phone', 'webhook_key', 'user_id', 'period'].every(k => !eq(u, k) || String(r[k]) === eq(u, k));
  if (method === 'GET') {
    const hit = rows.filter(match);
    if (/limit=0/.test(u)) return json([], 200, { 'Content-Range': `*/${hit.length}` }); // count only
    return json(hit);
  }
  if (method === 'POST') {
    const list = (Array.isArray(body) ? body : [body]).map(r => ({ ...r }));
    for (const r of list) {
      if (table === 'businesses') {
        if (rows.some(x => x.slug === r.slug)) return json({ code: '23505' }, 409);
        Object.assign(r, { id: 'c0000000-0000-4000-8000-00000000000' + rows.length, status: 'active', created_at: new Date().toISOString() });
      }
      if (table === 'staff_members') {
        const ex = rows.find(x => x.user_id === r.user_id);
        if (ex) { Object.assign(ex, r); continue; }
      }
      rows.push(r);
    }
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
    }, (res) => { let t = ''; res.on('data', c => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, text: t })); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const admin = { id: 'p1', email: 'platform@crm.test' };
_setPlatformAdminForToken('platform', admin);
_setPlatformAdminForToken('staff-token', null);
_setStaffForToken('staff-token', { id: 'u1', email: 'owner@arogya.test', role: 'owner', businessId: AROGYA, businessName: 'Arogya Ruchulu' });

// ---- who can use what ---------------------------------------------------------------------
test('only platform admins reach the console, and the console isn\'t a back door to business data', async () => {
  assert.strictEqual((await request('GET', '/api/platform/overview')).status, 401);
  assert.strictEqual((await request('GET', '/api/platform/overview', 'staff-token')).status, 403);
  assert.strictEqual((await request('GET', '/api/platform/overview', 'platform')).status, 200);
  // A platform admin is not business staff: the business API stays closed to them.
  _setStaffForToken('platform', null);
  assert.strictEqual((await request('GET', '/api/inbox', 'platform')).status, 403);
});

test('the overview has counts and settings, never customers or messages', async () => {
  const r = await request('GET', '/api/platform/overview', 'platform');
  assert.strictEqual(r.status, 200);
  assert.ok(!r.text.includes(SECRET), 'customer data leaked into the platform overview');
  assert.ok(!r.text.includes('EAAG') && !r.text.includes('access_token_enc'), 'WhatsApp secrets leaked');
  const o = JSON.parse(r.text);
  const arogya = o.businesses.find(b => b.id === AROGYA);
  assert.deepStrictEqual(arogya.counts, { staff: 1, contacts: 1, messagesThisMonth: 1 });
  assert.strictEqual(o.businesses.find(b => b.id === MAYURA).whatsapp.connected, true);
  // Chats and contacts were only ever counted (limit=0), never read.
  const contentReads = calls.filter(c => ['whatsapp_leads', 'whatsapp_messages', 'lead_notes', 'contact_events'].includes(c.table) && !/limit=0/.test(c.url));
  assert.deepStrictEqual(contentReads, []);
});

// ---- businesses -----------------------------------------------------------------------------
test('creating a business invites its Business Admin into that business only', async () => {
  const r = await platform.createBusiness(admin, { name: 'Sunrise Clinic', planId: 'starter', adminEmail: 'Admin@Sunrise.test' });
  assert.ifError(r.error);
  assert.strictEqual(r.business.slug, 'sunrise-clinic');
  const member = db.staff_members.find(s => s.user_id === 'new-user-id');
  assert.strictEqual(member.business_id, r.business.id);
  assert.strictEqual(member.role, 'owner');
  assert.strictEqual(member.email, 'admin@sunrise.test');
  assert.ok(db.ai_settings.some(a => a.business_id === r.business.id));
  assert.ok(db.audit_log.some(a => a.action === 'business.created'));
});

test('if the admin already works for another business, nothing is created', async () => {
  inviteBehaviour = () => ({ status: 422, body: { msg: 'A user with this email address has already been registered' } });
  const before = db.businesses.length;
  const r = await platform.createBusiness(admin, { name: 'Copycat Foods', planId: 'starter', adminEmail: 'owner@arogya.test' });
  assert.match(r.error, /another business/);
  assert.strictEqual(db.businesses.length, before);
});

test('business input is checked', async () => {
  assert.match((await platform.createBusiness(admin, { name: 'X', planId: 'starter', adminEmail: 'a@b.co' })).error, /2 to 80/);
  assert.match((await platform.createBusiness(admin, { name: 'Good Name', planId: 'gold', adminEmail: 'a@b.co' })).error, /plan/);
  assert.match((await platform.createBusiness(admin, { name: 'Good Name', planId: 'starter', adminEmail: 'nope' })).error, /email/);
  assert.match((await platform.createBusiness(admin, { name: 'Arogya Ruchulu', planId: 'starter', adminEmail: 'a@b.co' })).error, /taken/);
});

test('suspending a business stops its WhatsApp sending; plans and dates are validated', async () => {
  assert.ok(await whatsapp.getWhatsApp(MAYURA));
  assert.ifError((await platform.updateBusiness(admin, MAYURA, { status: 'suspended' })).error);
  assert.strictEqual(await whatsapp.getWhatsApp(MAYURA), null);
  assert.match((await platform.updateBusiness(admin, MAYURA, { status: 'deleted' })).error, /active or suspended/);
  assert.match((await platform.updateBusiness(admin, MAYURA, { planId: 'gold' })).error, /Unknown plan/);
  assert.match((await platform.updateBusiness(admin, MAYURA, { paidUntil: 'soon' })).error, /date/);
  assert.ifError((await platform.updateBusiness(admin, MAYURA, { planId: 'pro', paidUntil: '2026-12-31' })).error);
  assert.match((await platform.updatePlan(admin, 'growth', { limits: { max_staff: -1 } })).error, /whole number/);
  assert.ifError((await platform.updatePlan(admin, 'growth', { priceMonthlyInr: 999, limits: { max_staff: 12, max_automations: '' } })).error);
});

// ---- the neutral starter bot ---------------------------------------------------------------
test('a new business starts with a neutral bot, never Arogya\'s menu or prices', async () => {
  const catalog = await store.getActiveCatalog(MAYURA);
  const rules = await store.getActiveBotRules(MAYURA);
  const text = JSON.stringify({ catalog, rules });
  assert.doesNotMatch(text, /Arogya|Lean Well|Sugar Shield|₹/);
  assert.strictEqual(catalog.foodBuiltIns, false);
  assert.deepStrictEqual(rules, []);
  // Arogya keeps its own bot.
  assert.strictEqual((await store.getActiveCatalog(AROGYA)).foodBuiltIns, true);
});

test('Arogya\'s food keywords don\'t answer for another business', async () => {
  for (const word of ['price', 'diet plan', 'thali', 'batter']) {
    sent = [];
    await handleArogyaRuchuluBot(MAYURA, '919000000002', 'Ravi', word, null);
    const out = JSON.stringify(sent);
    assert.doesNotMatch(out, /Arogya|Lean Well|Sugar Shield|Thali|Batter|₹/i, `"${word}" sent Arogya content`);
    assert.match(out, /Welcome! 👋/, `"${word}" should get the business's own welcome`);
  }
});

// ---- sending hours ----------------------------------------------------------------------------
test('each business\'s follow-ups use its own sending hours', async () => {
  const w = await business.sendWindowFor(MAYURA);
  assert.deepStrictEqual(w, { start: 8, end: 18 });
  // 7:00 pm India time is outside Mayura's 8-18 window: moves to 8:00 next morning.
  const sevenPm = new Date('2026-11-06T13:30:00Z');
  assert.strictEqual(automations.intoSendingWindow(sevenPm, w).toISOString(), '2026-11-07T02:30:00.000Z');
  // ...but inside Arogya's 9-20 window.
  assert.strictEqual(automations.intoSendingWindow(sevenPm, await business.sendWindowFor(AROGYA)).toISOString(), sevenPm.toISOString());
});

test('the Business Admin can rename the business and set sending hours, with checks', async () => {
  const me = { id: 'x', email: 'admin@mayura.test', role: 'owner', businessId: MAYURA };
  assert.match((await business.saveProfile(me, { sendWindowStart: 20, sendWindowEnd: 9 })).error, /after the start/);
  assert.match((await business.saveProfile(me, { sendWindowStart: 9, sendWindowEnd: 10 })).error, /at least 2 hours/);
  assert.match((await business.saveProfile(me, { name: 'M' })).error, /2 to 80/);
  const r = await business.saveProfile(me, { name: 'Mayura Hospitals Hyderabad', sendWindowStart: 10, sendWindowEnd: 19 });
  assert.ifError(r.error);
  assert.strictEqual(db.businesses.find(b => b.id === MAYURA).name, 'Mayura Hospitals Hyderabad');
  assert.strictEqual(db.businesses.find(b => b.id === AROGYA).name, 'Arogya Ruchulu');
  assert.deepStrictEqual(await business.sendWindowFor(MAYURA), { start: 10, end: 19 });
});
