// Activity log, phases L1 + L2 + L3 (docs/progress/activity-log.md).
// Part 1: pure helpers (IP masking, device names, sessions, forbidden keys, areas, sentences). Part 2: the API with a fake
// database: each new action written once, scoped by business, no content; sign-ins once per session; the Business
// Admin's screen (owner only, names never numbers, CSV audited); the Platform console never gets the private columns.
// Part 3: the migration on PGlite (column protection, one sign-in per session, safe to re-run).
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const SUN = 'a0000000-0000-4000-8000-000000000001';
const LOTUS = 'b0000000-0000-4000-8000-000000000002';
process.env.APP_SECRET = 'server_encryption_secret_long_enough';
process.env.VITE_SUPABASE_URL = 'http://fake.supabase';
process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
process.env.WHATSAPP_BUSINESS_ID = 'c0000000-0000-4000-8000-000000000009';

const app = require('../server/app.cjs');
const activity = require('../server/activity.cjs');
const monitor = require('../server/monitor.cjs');
const ls = require('../server/leadStatuses.cjs');
const limits = require('../server/limits.cjs');
const { _setStaffForToken } = require('../server/auth.cjs');
const clinic = require('../server/clinic.cjs');
const platform = require('../server/platform.cjs');

// ---------------------------------------------------------------------------------------------
// Part 1: pure helpers
// ---------------------------------------------------------------------------------------------
test('masked network: IPv4 last part hidden, IPv6 cut to /48, mapped IPv4 handled', () => {
  assert.equal(activity.maskIp('49.37.12.201'), '49.37.12.x');
  assert.equal(activity.maskIp('::ffff:49.37.12.201'), '49.37.12.x');
  assert.equal(activity.maskIp('2401:4900:1c2a:7f3e:1:2:3:4'), '2401:4900:1c2a::/48');
  assert.equal(activity.maskIp('2401:4900::1'), '2401:4900:0::/48');
  assert.equal(activity.maskIp(''), 'unknown');
});

test('device: browser + operating system only, short', () => {
  assert.equal(activity.deviceOf('Mozilla/5.0 (Linux; Android 14; SM-A146B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'), 'Chrome on Android');
  assert.equal(activity.deviceOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0'), 'Edge on Windows');
  assert.equal(activity.deviceOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'), 'Safari on iOS');
  assert.equal(activity.deviceOf(''), 'Browser on another system');
});

test('session key: Supabase session_id when present, else a hash of the token', () => {
  const sid = '11111111-2222-4333-8444-555555555555';
  const jwt = `x.${Buffer.from(JSON.stringify({ session_id: sid })).toString('base64url')}.y`;
  assert.equal(activity.sessionKey(jwt), sid);
  assert.match(activity.sessionKey('not-a-jwt'), /^[0-9a-f]{32}$/);
});

test('forbidden keys are found at any depth and dropped at write time', () => {
  assert.deepEqual(activity.forbiddenKeysIn({ a: 1, phone: '9', nested: { Body: 'x', list: [{ token: 't' }] } }), ['phone', 'nested.Body', 'nested.list[0].token']);
  assert.deepEqual(activity.scrub({ ok: 1, note: 'secret', deep: { password: 'p', fine: true } }), { ok: 1, deep: { fine: true } });
});

test('areas and sentences: plain words; a customer by name; "You" for the reader', () => {
  assert.equal(activity.areaOf('chat.transferred'), 'chats');
  assert.equal(activity.areaOf('lead.note_added'), 'chats');
  assert.equal(activity.areaOf('lead.tags_changed'), 'leads');
  assert.equal(activity.areaOf('team.role_changed'), 'team');
  assert.equal(activity.areaOf('auth.signed_in'), 'security');
  assert.equal(activity.areaOf('ai.provider_changed'), 'settings');
  assert.equal(activity.areaOf('broadcast.sent'), 'broadcasts');
  const ctx = { me: 'owner@sunrise.test', person: (e) => ({ 'priya@sunrise.test': 'Priya', 'arjun@sunrise.test': 'Arjun' }[String(e)] || String(e)), roleOf: (e, r) => (String(e).startsWith('priya') ? 'manager' : r), customer: () => 'Ravi Kumar' };
  assert.equal(activity.sentence({ actor_email: 'priya@sunrise.test', actor_role: 'manager', action: 'chat.transferred', details: { from: null, to: 'arjun@sunrise.test' }, subject_phone: '919000000001' }, ctx),
    'Priya (manager) transferred the chat with Ravi Kumar to Arjun');
  assert.equal(activity.sentence({ actor_email: 'owner@sunrise.test', actor_role: 'owner', action: 'team.role_changed', details: { member: 'arjun@sunrise.test', from: 'agent', to: 'manager' } }, ctx),
    "You changed Arjun's role from agent to manager");
  assert.equal(activity.sentence({ actor_email: 'owner@sunrise.test', action: 'clinic.doctor_updated', details: { doctor: 'Dr Rao', fee: { from: 500, to: 700 } } }, ctx), "You changed Dr Rao's details (fee ₹500 → ₹700)");
  assert.equal(activity.sentence({ actor_email: null, action: 'ads.campaign_paused', details: {} }, ctx), 'The system ads campaign paused');
});

// ---------------------------------------------------------------------------------------------
// Part 2: the API (fake database)
// ---------------------------------------------------------------------------------------------
const NOW = () => new Date().toISOString();
let db, nextId;
function seed() {
  db = {
    businesses: [{ id: SUN, name: 'Sunrise', industry: 'hospital', status: 'active', plan_id: 'pro' }, { id: LOTUS, name: 'Lotus', industry: 'food', status: 'active', plan_id: 'pro' }],
    plans: [{ id: 'pro', name: 'Pro', max_contacts: null, ads_enabled: true }],
    lead_statuses: ls.template('hospital').map(s => ({ business_id: SUN, ...s })),
    staff_members: [
      { business_id: SUN, user_id: 'a0000000-0000-4000-8000-0000000000a1', email: 'owner@sunrise.test', role: 'owner', created_at: NOW() },
      { business_id: SUN, user_id: 'a0000000-0000-4000-8000-0000000000a2', email: 'priya@sunrise.test', role: 'manager', created_at: NOW() },
      { business_id: SUN, user_id: 'a0000000-0000-4000-8000-0000000000a3', email: 'arjun@sunrise.test', role: 'agent', created_at: NOW() },
      { business_id: LOTUS, user_id: 'b0000000-0000-4000-8000-0000000000b1', email: 'boss@lotus.test', role: 'owner', created_at: NOW() },
    ],
    staff_profiles: [{ business_id: SUN, user_id: 'a0000000-0000-4000-8000-0000000000a2', full_name: 'Priya' }, { business_id: SUN, user_id: 'a0000000-0000-4000-8000-0000000000a3', full_name: 'Arjun' }],
    whatsapp_leads: [
      { business_id: SUN, phone: '919000000001', name: 'Ravi Kumar', stage: 'new', tags: ['vip'], assigned_to: null, last_contacted_at: NOW(), created_at: NOW(), custom: {} },
      { business_id: SUN, phone: '919000000002', name: 'Sita', stage: 'new', tags: [], assigned_to: 'arjun@sunrise.test', last_contacted_at: NOW(), created_at: NOW(), custom: {} },
      { business_id: LOTUS, phone: '919000000001', name: 'Lotus Ravi', stage: 'new', tags: [], last_contacted_at: NOW(), created_at: NOW() },
    ],
    campaigns: [{ id: 'c1000000-0000-4000-8000-000000000001', business_id: SUN, name: 'Diwali offer', template_name: 'diwali_offer', status: 'draft' }],
    campaign_recipients: [{ campaign_id: 'c1000000-0000-4000-8000-000000000001', business_id: SUN, phone: '919000000001', status: 'queued' }],
    automations: [{ id: 'd1000000-0000-4000-8000-000000000001', business_id: SUN, name: 'Welcome back', trigger: 'new_contact', is_active: true }],
    clinic_appointments: [{ id: 'e1000000-0000-4000-8000-000000000001', business_id: SUN, lead_phone: '919000000002', follow_up_on: '2026-11-20', follow_up_done_at: null }],
    audit_log: [], lead_notes: [], usage_counters: [], ai_provider: [], ai_settings: [],
  };
  nextId = 1;
  limits.clearCache(); ls.clearCache(); activity._reset();
}

const SKIP = new Set(['select', 'order', 'limit', 'offset', 'on_conflict']);
function cond(r, k, v) {
  const json = k.match(/^(\w+)->>(\w+)$/);
  const raw = json ? (r[json[1]] || {})[json[2]] : r[k];
  const val = raw === undefined || raw === null ? null : Array.isArray(raw) ? raw : String(raw);
  if (v.startsWith('eq.')) return val === decodeURIComponent(v.slice(3));
  if (v.startsWith('in.(')) return v.slice(4, -1).split(',').includes(val);
  if (v === 'is.null') return val === null;
  if (v === 'not.is.null') return val !== null;
  if (v.startsWith('gte.')) return val !== null && val >= decodeURIComponent(v.slice(4));
  if (v.startsWith('lt.')) return k === 'id' ? Number(raw) < Number(v.slice(3)) : val !== null && val < decodeURIComponent(v.slice(3));
  if (v.startsWith('like.')) return val !== null && new RegExp(`^${decodeURIComponent(v.slice(5)).replace(/[.]/g, '\\.').replace(/\*/g, '.*')}$`).test(val);
  if (v.startsWith('ilike.')) return val !== null && new RegExp(`^${decodeURIComponent(v.slice(6)).replace(/[.]/g, '\\.').replace(/\*/g, '.*')}$`, 'i').test(val);
  return true;
}
function matcher(u) {
  const params = [...new URL(u).searchParams.entries()].filter(([k]) => !SKIP.has(k));
  return (r) => params.every(([k, v]) => {
    if (k === 'or') return v.slice(1, -1).split(',').some(part => { const m = part.match(/^(\w+)\.(.*)$/); return m && cond(r, m[1], m[2]); });
    return cond(r, k, v);
  });
}
/** select=a,b,c: only those columns (as PostgREST does); embedded resources are ignored. */
function project(u, rows) {
  const sel = new URL(u).searchParams.get('select');
  if (!sel || sel === '*' || sel.includes('(')) return rows;
  const cols = sel.split(',');
  return rows.map(r => Object.fromEntries(cols.filter(c => c in r).map(c => [c, r[c]])));
}
const json = (d, status = 200, headers = {}) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json', ...headers } });
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  const body = opts.body ? JSON.parse(opts.body) : null;
  if (u.startsWith('http://fake.supabase/auth/v1/invite')) return json({ id: 'a0000000-0000-4000-8000-0000000000a9', email: body.email });
  if (u.startsWith('https://graph.facebook.com/')) {
    // Meta, faked: the number and account check, subscribing, templates, sending.
    if (u.includes('/phone_numbers?')) return json({ data: [{ id: '111111111111111' }] });
    if (u.includes('111111111111111?fields=')) return json({ id: '111111111111111', display_phone_number: '+91 90000 00100', verified_name: 'Sunrise' });
    if (/subscribed_apps/.test(u)) return json({ success: true });
    if (/message_templates/.test(u) && method === 'POST') return json({ id: 't1', status: 'PENDING', category: 'MARKETING' });
    if (/message_templates/.test(u) && method === 'DELETE') return json({ success: true });
    if (/message_templates/.test(u)) return json({ data: [{ name: 'diwali_offer', language: 'en', status: 'APPROVED', category: 'MARKETING', components: [{ type: 'BODY', text: 'Diwali sweets are here' }] }] });
    if (u.endsWith('/messages')) return json({ messages: [{ id: 'wamid.1' }] });
    return json({});
  }
  if (!u.startsWith('http://fake.supabase/rest/v1/')) return json({}, 503);
  const table = u.slice('http://fake.supabase/rest/v1/'.length).split('?')[0];
  if (table.startsWith('rpc/')) return json([]);
  const rows = db[table] || (db[table] = []);
  const match = matcher(u);
  if (method === 'GET') {
    let hit = rows.filter(match);
    const order = new URL(u).searchParams.get('order');
    if (order && /^(id|created_at)\.desc/.test(order)) hit = [...hit].sort((a, b) => (a.id < b.id ? 1 : -1));
    if (/[?&]limit=0/.test(u)) return json([], 200, { 'Content-Range': `*/${hit.length}` });
    return json(project(u, hit.slice(0, Number(new URL(u).searchParams.get('limit') || 100000))));
  }
  if (method === 'POST') {
    const list = (Array.isArray(body) ? body : [body]).map(r => ({ ...r }));
    for (const r of list) {
      if (table === 'audit_log') {
        // The unique sign-in-per-session index (SQL 20261144).
        if (r.action === 'auth.signed_in' && r.private_details?.session && rows.some(x => x.action === 'auth.signed_in' && x.private_details?.session === r.private_details.session)) return json({ message: 'duplicate key' }, 409);
        r.id = nextId++; r.created_at = new Date(Date.now() + r.id).toISOString();
      }
      if (table === 'staff_members' && /on_conflict/.test(u)) { const i = rows.findIndex(x => x.user_id === r.user_id); if (i >= 0) { Object.assign(rows[i], r); continue; } }
      if (table === 'lead_notes') r.id = nextId++;
      if (table === 'campaigns' || table === 'automations') { r.id ??= require('node:crypto').randomUUID(); if (table === 'campaigns') r.status ??= 'draft'; }
      rows.push(r);
    }
    return json(list, 201);
  }
  if (method === 'PATCH') { const hit = rows.filter(match); hit.forEach(r => Object.assign(r, body)); return json(hit); }
  if (method === 'DELETE') { const hit = rows.filter(match); db[table] = rows.filter(r => !hit.includes(r)); return json(hit); }
  return json([]);
};

let server, base;
before(async () => { server = app.listen(0); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
beforeEach(seed);
function request(method, path, token, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request(`${base}${path}`, { method, agent: false, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}), ...headers } },
      (res) => { let t = ''; res.setEncoding('utf8'); res.on('data', c => { t += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch { /* text */ } resolve({ status: res.statusCode, text: t, json: j, headers: res.headers }); }); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
_setStaffForToken('al-owner', { id: 'a0000000-0000-4000-8000-0000000000a1', email: 'owner@sunrise.test', role: 'owner', businessId: SUN, businessName: 'Sunrise' });
_setStaffForToken('al-manager', { id: 'a0000000-0000-4000-8000-0000000000a2', email: 'priya@sunrise.test', role: 'manager', businessId: SUN, businessName: 'Sunrise' });
_setStaffForToken('al-agent', { id: 'a0000000-0000-4000-8000-0000000000a3', email: 'arjun@sunrise.test', role: 'agent', businessId: SUN, businessName: 'Sunrise' });
_setStaffForToken('al-lotus', { id: 'b0000000-0000-4000-8000-0000000000b1', email: 'boss@lotus.test', role: 'owner', businessId: LOTUS, businessName: 'Lotus' });
clinic._setDoctorForToken('al-doctor', { id: 'f0000000-0000-4000-8000-000000000001', userId: 'f0000000-0000-4000-8000-0000000000f1', email: 'rao@sunrise.test', name: 'Dr Rao', businessId: SUN });
platform._setPlatformAdminForToken('al-platform', { id: 'f0000000-0000-4000-8000-0000000000aa', email: 'admin@platform.test', role: 'owner' });
for (const t of ['al-owner', 'al-manager', 'al-agent', 'al-lotus']) clinic._setDoctorForToken(t, null);
platform._setPlatformAdminForToken('al-doctor', null);

/** The audit rows written for an action, and a check that none holds content. */
function rows(action) { return db.audit_log.filter(r => r.action === action); }
function noContent() {
  for (const r of db.audit_log) assert.deepEqual(activity.forbiddenKeysIn(r.details), [], `${r.action} has content keys`);
}

test('L1 team: invited, role changed, removed (chats back in the queue); once each, own business, no content', async () => {
  assert.equal((await request('POST', '/api/team/invite', 'al-owner', { email: 'new@sunrise.test', role: 'agent' })).status, 200);
  assert.equal((await request('PATCH', '/api/team/a0000000-0000-4000-8000-0000000000a3', 'al-owner', { role: 'manager' })).status, 200);
  assert.equal((await request('DELETE', '/api/team/a0000000-0000-4000-8000-0000000000a3', 'al-owner')).status, 200);
  assert.deepEqual(rows('team.invited').map(r => [r.business_id, r.details.member, r.details.role]), [[SUN, 'new@sunrise.test', 'agent']]);
  assert.deepEqual(rows('team.role_changed').map(r => [r.details.from, r.details.to]), [['agent', 'manager']]);
  assert.deepEqual(rows('team.removed').map(r => [r.details.member, r.details.chatsReturned]), [['arjun@sunrise.test', 1]]);
  noContent();
});

test('L1 AI and WhatsApp: provider / key (last 4 only) / settings on-off; never the key or the AI text', async () => {
  const p = await request('PUT', '/api/ai/provider', 'al-owner', { provider: 'anthropic', model: 'claude-test', apiKey: 'sk-secret-key-9876' });
  assert.equal(p.status, 200, p.text);
  const s = await request('PUT', '/api/ai/settings', 'al-manager', { autoReply: true, instructions: 'Never say this text' });
  assert.equal(s.status, 200, s.text);
  const prov = rows('ai.provider_changed')[0];
  assert.deepEqual([prov.details.provider, prov.details.model, prov.details.keyChanged, prov.details.keyLast4], ['anthropic', 'claude-test', true, '9876']);
  assert.deepEqual(rows('ai.settings_changed')[0].details, { autoReply: true, changed: ['autoReply', 'instructions'] });
  const all = JSON.stringify(db.audit_log);
  assert.ok(!all.includes('sk-secret') && !all.includes('Never say'), 'no key, no AI text');
  noContent();
});

test('L2 chats: claimed, transferred, done, reopened, bot paused, renamed, tags, note; the customer only in subject_phone', async () => {
  const P = '/api/inbox/919000000001';
  assert.equal((await request('POST', `${P}/notes`, 'al-agent', { body: 'Called him back' })).status, 200); // claims + note
  assert.equal((await request('PATCH', P, 'al-agent', { tags: ['vip', 'hot'] })).status, 200);
  assert.equal((await request('PATCH', P, 'al-agent', { name: 'Ravi K' })).status, 200);
  assert.equal((await request('PATCH', P, 'al-agent', { botPaused: true, pauseHours: 4 })).status, 200);
  assert.equal((await request('POST', `${P}/close`, 'al-agent', { reason: 'booked', note: 'paid cash' })).status, 200);
  assert.equal((await request('POST', `${P}/reopen`, 'al-agent', {})).status, 200);
  assert.equal((await request('PATCH', P, 'al-manager', { assignedTo: 'priya@sunrise.test' })).status, 200);
  for (const a of ['chat.claimed', 'lead.note_added', 'lead.tags_changed', 'lead.renamed', 'chat.bot_paused', 'chat.done', 'chat.reopened', 'chat.transferred']) {
    assert.equal(rows(a).length, 1, a);
    assert.equal(rows(a)[0].subject_phone, '919000000001', a);
    assert.equal(rows(a)[0].business_id, SUN, a);
  }
  assert.deepEqual(rows('lead.tags_changed')[0].details, { added: ['hot'], removed: [] });
  assert.deepEqual(rows('chat.transferred')[0].details, { from: 'arjun@sunrise.test', to: 'priya@sunrise.test' });
  assert.deepEqual(rows('chat.done')[0].details, { reason: 'booked', withNote: true });
  const all = JSON.stringify(db.audit_log.map(r => r.details));
  assert.ok(!all.includes('Called him') && !all.includes('Ravi K') && !all.includes('paid cash') && !all.includes('919000000001'), 'no note text, no name, no number in details');
  noContent();
});

test('L2 broadcasts, follow-ups, bot, ads funnel export, clinic follow-up: once each, names only', async () => {
  assert.equal((await request('POST', '/api/campaigns/c1000000-0000-4000-8000-000000000001/cancel', 'al-manager', {})).status, 200);
  assert.deepEqual(rows('broadcast.cancelled')[0].details, { campaign: 'Diwali offer', template: 'diwali_offer', fromNumberId: null, audience: 1 });
  assert.equal((await request('PATCH', '/api/automations/d1000000-0000-4000-8000-000000000001', 'al-manager', { isActive: false })).status, 200);
  assert.equal((await request('DELETE', '/api/automations/d1000000-0000-4000-8000-000000000001', 'al-manager')).status, 200);
  assert.deepEqual(rows('automation.toggled')[0].details, { automation: 'Welcome back', trigger: 'new_contact', on: false });
  assert.equal(rows('automation.deleted')[0].details.automation, 'Welcome back');
  assert.equal((await request('POST', '/api/bot-rules', 'al-manager', { rule: { id: 'r1', keyword: 'price', matchType: 'contains', responseType: 'text', responseText: 'Our prices…', isActive: true } })).status, 200);
  assert.equal((await request('DELETE', '/api/bot-rules/r1', 'al-manager')).status, 200);
  assert.equal((await request('POST', '/api/bot-catalog', 'al-manager', { catalog: { welcomeMessage: 'Secret welcome words' } })).status, 200);
  assert.equal(rows('bot.rule_saved').length, 1);
  assert.equal(rows('bot.rule_deleted').length, 1);
  assert.deepEqual(rows('bot.flow_changed')[0].details, { parts: ['welcomeMessage'] });
  db.business_ad_accounts = [{ business_id: SUN, ad_account_id: 'act_1', currency: 'INR' }];
  const fx = await request('POST', '/api/ads/funnel/export', 'al-manager', { days: 7 });
  assert.equal(fx.status, 200, fx.text);
  assert.equal(rows('ads.funnel_exported')[0].details.days, 7);
  assert.equal((await request('POST', '/api/clinic/appointments/e1000000-0000-4000-8000-000000000001/follow-up-done', 'al-manager', {})).status, 200);
  assert.equal(rows('clinic.follow_up_done')[0].subject_phone, '919000000002');
  const all = JSON.stringify(db.audit_log.map(r => r.details));
  assert.ok(!all.includes('Our prices') && !all.includes('Secret welcome') && !all.includes('price'), 'no bot text or keyword');
  noContent();
});

test('L1 sign-in: once per session; device + masked network server-only; new device flagged; staff, doctors and platform staff', async () => {
  const ua = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', 'X-Forwarded-For': '49.37.12.201' };
  const first = await request('POST', '/api/auth/signed-in', 'al-agent', {}, ua);
  assert.equal(first.status, 200, first.text);
  assert.equal((await request('POST', '/api/auth/signed-in', 'al-agent', {}, ua)).json.duplicate, true, 'once per session');
  assert.equal(rows('auth.signed_in').length, 1);
  const r = rows('auth.signed_in')[0];
  assert.deepEqual([r.business_id, r.actor_email, r.actor_role], [SUN, 'arjun@sunrise.test', 'agent']);
  assert.deepEqual([r.private_details.device, r.private_details.network, r.private_details.newDevice], ['Chrome on Windows', '49.37.12.x', false]);
  assert.ok(!JSON.stringify(r.details).includes('49.37'), 'the network is not in the readable details');
  // Another session from a phone: a new device.
  _setStaffForToken('al-agent-2', { id: 'a0000000-0000-4000-8000-0000000000a3', email: 'arjun@sunrise.test', role: 'agent', businessId: SUN, businessName: 'Sunrise' });
  await request('POST', '/api/auth/signed-in', 'al-agent-2', {}, { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/131.0 Mobile Safari/537.36' });
  assert.equal(rows('auth.signed_in')[1].private_details.newDevice, true);
  // Doctors and platform staff.
  await request('POST', '/api/auth/signed-in', 'al-doctor', {}, ua);
  await request('POST', '/api/auth/signed-in', 'al-platform', {}, ua);
  assert.deepEqual(rows('auth.signed_in').slice(2).map(x => [x.actor_role, x.business_id]), [['doctor', SUN], ['platform_owner', null]]);
  assert.equal((await request('POST', '/api/auth/signed-in', 'nobody-token', {})).status, 401);
  // Sign-out and own password change.
  await request('POST', '/api/auth/signed-out', 'al-agent', {});
  assert.equal((await request('POST', '/api/auth/signed-out', 'al-agent', {})).json.duplicate, true, 'one sign-out per session');
  await request('POST', '/api/auth/password-changed', 'al-manager', {});
  assert.equal(rows('auth.signed_out').length, 1);
  assert.equal(rows('auth.password_changed')[0].actor_email, 'priya@sunrise.test');
  // "Last signed in" on the Team list: managers + the Business Admin only.
  const t = await request('GET', '/api/team', 'al-owner');
  assert.ok(t.json.staff.find(m => m.email === 'arjun@sunrise.test').last_signed_in);
  assert.equal((await request('GET', '/api/team', 'al-agent')).json.staff[0].last_signed_in, undefined);
  noContent();
});

test('L3 /api/activity: the Business Admin only; this business only; customers by name, never their number; CSV audited', async () => {
  await request('PATCH', '/api/inbox/919000000002', 'al-manager', { assignedTo: 'priya@sunrise.test' });
  await activity.record({ email: 'boss@lotus.test', role: 'owner', businessId: LOTUS }, 'chat.claimed', {}, { subjectPhone: '919000000001' });
  assert.equal((await request('POST', '/api/activity/list', 'al-manager', {})).status, 403);
  assert.equal((await request('POST', '/api/activity/list', 'al-agent', {})).status, 403);
  const r = await request('POST', '/api/activity/list', 'al-owner', {});
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json.entries.map(e => e.sentence), ['Priya (manager) transferred the chat with Sita from Arjun to Priya']);
  assert.ok(!r.text.includes('919000000002') && !r.text.includes('Lotus'), 'no number, no other business');
  // Filters: area, person, search.
  assert.equal((await request('POST', '/api/activity/list', 'al-owner', { area: 'team' })).json.entries.length, 0);
  assert.equal((await request('POST', '/api/activity/list', 'al-owner', { area: 'chats' })).json.entries.length, 1);
  assert.equal((await request('POST', '/api/activity/list', 'al-owner', { person: 'arjun@sunrise.test' })).json.entries.length, 0);
  assert.equal((await request('POST', '/api/activity/list', 'al-owner', { q: 'sita' })).json.entries.length, 1);
  // Security tab: sign-ins with device + network, for the Business Admin.
  await request('POST', '/api/auth/signed-in', 'al-agent', {}, { 'X-Forwarded-For': '49.37.12.201' });
  const sec = await request('POST', '/api/activity/list', 'al-owner', { tab: 'security' });
  assert.deepEqual(sec.json.entries.map(e => [e.person, e.security.network]), [['Arjun', '49.37.12.x']]);
  // CSV, audited without the data.
  const csv = await request('POST', '/api/activity/export', 'al-owner', {});
  assert.equal(csv.status, 200);
  assert.match(csv.headers['content-type'], /text\/csv/);
  assert.ok(csv.text.includes('transferred the chat with Sita'));
  assert.equal(rows('activity.exported').length, 1);
  assert.equal((await request('POST', '/api/activity/export', 'al-manager', {})).status, 403);
  // Paging: 50 at a time.
  for (let i = 0; i < 60; i++) await activity.record({ email: 'owner@sunrise.test', role: 'owner', businessId: SUN }, 'bot.rule_saved', { count: i });
  const p1 = await request('POST', '/api/activity/list', 'al-owner', {});
  assert.equal(p1.json.entries.length, 50);
  const p2 = await request('POST', '/api/activity/list', 'al-owner', { beforeId: p1.json.nextBeforeId });
  assert.ok(p2.json.entries.length >= 10);
  assert.ok(p2.json.entries.every(e => !p1.json.entries.some(x => x.id === e.id)));
});

test('the Platform console audit reader never returns subject_phone or sign-in network details', async () => {
  await request('PATCH', '/api/inbox/919000000002', 'al-manager', { assignedTo: 'priya@sunrise.test' });
  await request('POST', '/api/auth/signed-in', 'al-agent', {}, { 'X-Forwarded-For': '49.37.12.201' });
  const r = await monitor.auditLog({});
  assert.ok(r.entries.length >= 2);
  for (const e of r.entries) {
    assert.ok(!('subject_phone' in e) && !('private_details' in e), e.action);
  }
  assert.ok(!JSON.stringify(r).includes('919000000002') && !JSON.stringify(r).includes('49.37'));
});

test('L1 WhatsApp token / app secret changed (last 4 only); L2 templates, broadcast created + sent, follow-up created; clinic patient changed', async () => {
  const w = await request('PUT', '/api/whatsapp', 'al-owner', { phoneNumberId: '111111111111111', wabaId: '222222222222222', accessToken: 'EAAGsecretaccesstoken5678', appSecret: '0123456789abcdef0123456789abcdef' });
  assert.equal(w.status, 200, w.text);
  assert.deepEqual(rows('whatsapp.token_changed')[0].details, { changed: ['access token', 'app secret'], tokenLast4: '5678' });
  assert.equal((await request('POST', '/api/templates', 'al-manager', { name: 'new_offer', language: 'en', category: 'MARKETING', bodyText: 'Hello there, our new offer is here' })).status, 200);
  assert.equal((await request('DELETE', '/api/templates/new_offer', 'al-manager')).status, 200);
  assert.deepEqual([rows('template.created')[0].details.template, rows('template.deleted')[0].details.template], ['new_offer', 'new_offer']);
  const c = await request('POST', '/api/campaigns', 'al-manager', { name: 'Diwali 2', templateName: 'diwali_offer', language: 'en', variables: { header: [], body: [] }, segment: { mode: 'filter' }, sendNow: true });
  assert.equal(c.status, 200, c.text);
  assert.deepEqual([rows('broadcast.created')[0].details.campaign, rows('broadcast.created')[0].details.template, rows('broadcast.created')[0].details.audience], ['Diwali 2', 'diwali_offer', 2]);
  assert.equal(rows('broadcast.sent').length, 1);
  const au = await request('POST', '/api/automations', 'al-manager', { name: 'Thanks', trigger: 'new_contact', delayMinutes: 60, templateName: 'diwali_offer', language: 'en', variables: { header: [], body: [] } });
  assert.equal(au.status, 200, au.text);
  assert.deepEqual(rows('automation.created')[0].details, { automation: 'Thanks', trigger: 'new_contact', on: true });
  // Clinic: a patient's details edited at booking -> field names only.
  db.clinic_patients = [{ id: 'e2000000-0000-4000-8000-000000000001', business_id: SUN, lead_phone: '919000000002', name: 'Sita Devi', age_years: 30, gender: 'female', city: 'Guntur', allergies: null, conditions: null }];
  const staff = { id: 'x', email: 'priya@sunrise.test', role: 'manager', businessId: SUN, businessName: 'Sunrise' };
  const got = await require('../server/clinicPatients.cjs').resolvePatient(staff, SUN, '919000000002', { patientId: 'e2000000-0000-4000-8000-000000000001', patient: { name: 'Sita Devi', age: 31, gender: 'female', city: 'Vizag', allergies: 'Penicillin' } });
  assert.ok(got.patient);
  const pc = rows('clinic.patient_changed')[0];
  assert.deepEqual(pc.details.fields.sort(), ['age_years', 'age_on', 'allergies', 'city'].sort().filter(f => pc.details.fields.includes(f)));
  assert.ok(pc.details.fields.includes('allergies') && pc.details.fields.includes('city'));
  assert.equal(pc.subject_phone, '919000000002');
  const all = JSON.stringify(db.audit_log.map(r => r.details));
  assert.ok(!all.includes('EAAG') && !all.includes('0123456789abcdef') && !all.includes('Penicillin') && !all.includes('Vizag') && !all.includes('Hello there'));
  noContent();
});

// ---------------------------------------------------------------------------------------------
// Part 3: the migration (PGlite)
// ---------------------------------------------------------------------------------------------
test('SQL 20261144: browsers can\'t read subject_phone or private_details; one sign-in per session; safe to re-run', async () => {
  const { freshDb, migrationSql, asUser } = require('./helpers/pgHarness.cjs');
  const pg = await freshDb();
  await pg.exec(migrationSql('20261144_activity_log.sql'));
  const priv = async (col) => (await pg.query("select has_column_privilege('authenticated', 'public.audit_log', $1, 'SELECT') as ok", [col])).rows[0].ok;
  assert.equal(await priv('action'), true);
  assert.equal(await priv('details'), true);
  assert.equal(await priv('subject_phone'), false);
  assert.equal(await priv('private_details'), false);
  const user = (await pg.query("insert into auth.users (email) values ('o@x.test') returning id")).rows[0].id;
  await assert.rejects(asUser(pg, user, () => pg.query('select subject_phone from public.audit_log')), /permission denied/);
  await assert.rejects(asUser(pg, user, () => pg.query('select * from public.audit_log')), /permission denied/, 'select * fails too');
  await asUser(pg, user, () => pg.query('select id, action, details from public.audit_log'));
  await assert.rejects(asUser(pg, user, () => pg.query("insert into public.audit_log (action) values ('x')")), /permission denied/);
  const ins = (s) => pg.query("insert into public.audit_log (action, private_details) values ('auth.signed_in', $1::jsonb)", [JSON.stringify({ session: s })]);
  await ins('s1');
  await assert.rejects(ins('s1'), /audit_log_signin_session_key/);
  await ins('s2');
  // Indexes match the queries: newest first by id inside a business; sign-ins per business / per person; the prune.
  const idx = (await pg.query("select indexname, indexdef from pg_indexes where tablename = 'audit_log'")).rows;
  const def = (n) => idx.find(i => i.indexname === n)?.indexdef || '';
  assert.match(def('audit_log_business_id_idx'), /\(business_id, id DESC\)/);
  assert.match(def('audit_log_signins_biz_idx'), /\(business_id, id DESC\) WHERE/);
  assert.match(def('audit_log_signins_person_idx'), /\(actor_email, id DESC\) WHERE/);
  assert.match(def('audit_log_created_idx'), /created_at/);
  assert.ok(!def('audit_log_business_action_idx') && !def('audit_log_signins_idx'), 'the unused indexes are gone');
  await pg.exec(migrationSql('20261144_activity_log.sql')); // safe to re-run
  await assert.rejects(pg.query("insert into public.audit_log (action, subject_phone) values ('chat.claimed', 'abc')"), /check/);
});

// ---------------------------------------------------------------------------------------------
// Review fixes
// ---------------------------------------------------------------------------------------------
test('filters in the body, not the address; odd area names (constructor, toString) are ignored, not a crash', async () => {
  await request('PATCH', '/api/inbox/919000000002', 'al-manager', { assignedTo: 'priya@sunrise.test' });
  assert.equal((await request('GET', '/api/activity?q=sita', 'al-owner')).status, 404, 'no GET with search words in the address');
  for (const area of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    const r = await request('POST', '/api/activity/list', 'al-owner', { area });
    assert.equal(r.status, 200, `${area}: ${r.text}`);
    assert.equal(r.json.entries.length, 1);
  }
  const bad = await request('POST', '/api/activity/list', 'al-owner', { area: { x: 1 }, q: ['a'] });
  assert.equal(bad.status, 200, 'non-string filters are dropped');
});

test('a permanent lead delete removes the customer from the activity log (other businesses untouched)', async () => {
  await request('PATCH', '/api/inbox/919000000002', 'al-manager', { assignedTo: 'priya@sunrise.test' });
  await activity.record({ email: 'boss@lotus.test', role: 'owner', businessId: LOTUS }, 'chat.claimed', {}, { subjectPhone: '919000000002' });
  assert.equal(db.audit_log.filter(r => r.subject_phone === '919000000002').length, 2);
  const r = await require('../server/leadsTools.cjs').purgeLeads(SUN, ['919000000002']);
  assert.equal(r.error, undefined);
  const left = db.audit_log.filter(x => x.subject_phone === '919000000002');
  assert.deepEqual(left.map(x => x.business_id), [LOTUS], 'only the other business keeps its own entry');
  assert.equal(rows('chat.transferred')[0].subject_phone, null);
  const list = await request('POST', '/api/activity/list', 'al-owner', {});
  assert.match(list.json.entries.find(e => e.action === 'chat.transferred').sentence, /a customer|a deleted customer/);
});

test('before SQL 20261144: writes without the new columns, then tries them again after 5 minutes', async () => {
  const real = global.fetch;
  let missing = true;
  let tried = 0;
  global.fetch = async (url, opts = {}) => {
    if (String(url).includes('/rest/v1/audit_log') && opts.method === 'POST' && /subject_phone|private_details/.test(String(opts.body))) {
      tried++;
      if (missing) return new Response(JSON.stringify({ message: 'column does not exist' }), { status: 400 });
    }
    return real(url, opts);
  };
  try {
    const who = { email: 'owner@sunrise.test', role: 'owner', businessId: SUN };
    assert.equal(await activity.record(who, 'chat.claimed', {}, { subjectPhone: '919000000001' }), true);
    assert.equal(tried, 1);
    await activity.record(who, 'chat.claimed', {}, { subjectPhone: '919000000001' });
    assert.equal(tried, 1, 'not tried again at once');
    missing = false;
    activity._missingSince(6 * 60000);
    await activity.record(who, 'chat.claimed', {}, { subjectPhone: '919000000001' });
    assert.equal(tried, 2, 'tried again after 5 minutes');
    assert.equal(db.audit_log.at(-1).subject_phone, '919000000001');
  } finally { global.fetch = real; }
});

test('CSV export: one pass in pages of 1,000, names looked up once, at most 5,000 entries (and says so)', async () => {
  for (let i = 0; i < 5200; i++) db.audit_log.push({ id: nextId++, business_id: SUN, actor_email: 'owner@sunrise.test', actor_role: 'owner', action: 'bot.rule_saved', details: { count: i }, created_at: new Date().toISOString() });
  const real = global.fetch;
  let reads = 0; let teamReads = 0;
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/rest/v1/audit_log?') && (opts.method || 'GET') === 'GET') reads++;
    if (u.includes('/rest/v1/staff_members?')) teamReads++;
    return real(url, opts);
  };
  try {
    const csv = await request('POST', '/api/activity/export', 'al-owner', {});
    assert.equal(csv.status, 200, csv.text.slice(0, 200));
    assert.equal(csv.headers['x-entry-count'], '5000');
    assert.equal(csv.headers['x-entry-capped'], '1');
    assert.equal(csv.text.trim().split('\r\n').length, 5001, 'header + 5,000 rows');
    assert.ok(reads <= 6, `${reads} reads`);
    assert.ok(teamReads <= 3, `team names read ${teamReads} times`);
    assert.equal(rows('activity.exported')[0].details.capped, true);
  } finally { global.fetch = real; }
});

test('worker prune: entries older than 1 year go, newer stay', async () => {
  const now = Date.now();
  db.audit_log.push({ id: nextId++, business_id: SUN, action: 'bot.rule_saved', details: {}, created_at: new Date(now - 400 * 86400000).toISOString() });
  db.audit_log.push({ id: nextId++, business_id: null, action: 'platform.plan_changed', details: {}, created_at: new Date(now - 366 * 86400000).toISOString() });
  db.audit_log.push({ id: nextId++, business_id: SUN, action: 'bot.rule_saved', details: {}, created_at: new Date(now - 300 * 86400000).toISOString() });
  assert.equal(await activity.prune({ now }), 2);
  assert.equal(db.audit_log.length, 1);
  assert.equal(activity.KEEP_DAYS, 365);
  assert.match(require('node:fs').readFileSync(require('node:path').join(__dirname, '../netlify/functions/broadcast-worker.cjs'), 'utf8'), /step\('activityPrune'/);
});
