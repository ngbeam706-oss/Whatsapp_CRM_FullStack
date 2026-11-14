// Returning customers + names the team saves (docs/progress/returning-leads.md).
//   Names: WhatsApp never overwrites a staff-saved name but always updates wa_name; renaming follows the chat rules.
//   Returning: after N days of silence the status moves by TYPE and the owner is re-checked (same if available /
//   afresh); a shorter silence changes nothing; filter + funnel count them; tenancy; the migration.
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
const { logLead } = require('../server/db.cjs');
const inbox = require('../server/inbox.cjs');
const ls = require('../server/leadStatuses.cjs');
const ret = require('../server/returningLeads.cjs');
const fun = require('../server/adsFunnel.cjs');
const { _setStaffForToken } = require('../server/auth.cjs');

const DAY = 86400000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();
let db;
function seed() {
  db = {
    businesses: [{ id: SUN, name: 'Sunrise Clinic', status: 'active', industry: 'hospital', send_window_start: 0, send_window_end: 24 }, { id: LOTUS, name: 'Lotus', status: 'active', industry: 'food' }],
    lead_statuses: [...ls.template('hospital').map(s => ({ business_id: SUN, ...s })), ...ls.template('food').map(s => ({ business_id: LOTUS, ...s }))],
    staff_members: [{ business_id: SUN, email: 'a@sun.test', role: 'agent' }, { business_id: SUN, email: 'b@sun.test', role: 'agent' }, { business_id: SUN, email: 'manager@sun.test', role: 'manager' }],
    whatsapp_leads: [
      { business_id: SUN, phone: '919000000001', name: 'Ravi Kumar', wa_name: '😎 Ravi', name_set_by: 'a@sun.test', stage: 'completed', assigned_to: 'a@sun.test', last_inbound_at: ago(120) },
      { business_id: SUN, phone: '919000000002', name: 'Sita', wa_name: 'Sita', name_set_by: null, stage: 'lost', assigned_to: 'b@sun.test', last_inbound_at: ago(45) },
      { business_id: SUN, phone: '919000000003', name: 'Kiran', stage: 'interested', assigned_to: 'a@sun.test', last_inbound_at: ago(5) },
      { business_id: LOTUS, phone: '919000000001', name: 'Lotus Ravi', stage: 'ordered', assigned_to: null, last_inbound_at: ago(400) },
    ],
    lead_assignment_settings: [], lead_assignment_members: [], staff_availability: [], lead_status_history: [], lead_notes: [], ad_conversions: [], ad_conversion_settings: [], audit_log: [],
  };
  ls.clearCache();
}
const SKIP = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'or', 'and']);
function matcher(u) {
  const filters = [...new URL(u).searchParams.entries()].filter(([k]) => !SKIP.has(k));
  return (r) => filters.every(([k, v]) => {
    const val = r[k] === undefined || r[k] === null ? null : String(r[k]);
    if (v.startsWith('eq.')) return val === v.slice(3);
    if (v.startsWith('in.(')) return v.slice(4, -1).split(',').includes(val);
    if (v === 'is.null') return val === null;
    if (v === 'not.is.null') return val !== null;
    if (v.startsWith('gte.')) return val !== null && val >= v.slice(4);
    if (v.startsWith('lt.')) return val !== null && val < v.slice(3);
    return true;
  });
}
const json = (d, status = 200, headers = {}) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json', ...headers } });
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  const body = opts.body ? JSON.parse(opts.body) : null;
  if (!u.startsWith('http://fake.supabase/rest/v1/')) return json({}, 503);
  const table = u.slice('http://fake.supabase/rest/v1/'.length).split('?')[0];
  if (table.startsWith('rpc/')) return json([]);
  const rows = db[table] || (db[table] = []);
  const match = matcher(u);
  if (method === 'GET') {
    const hit = rows.filter(match);
    if (/[?&]limit=0/.test(u)) return json([], 200, { 'Content-Range': `*/${hit.length}` });
    return json(hit);
  }
  if (method === 'POST') {
    const list = (Array.isArray(body) ? body : [body]).map(r => ({ ...r }));
    for (const r of list) {
      const ex = table === 'whatsapp_leads' && rows.find(x => x.business_id === r.business_id && x.phone === r.phone);
      if (ex) Object.assign(ex, r); else rows.push(r);
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
function request(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } },
      (res) => { let t = ''; res.setEncoding('utf8'); res.on('data', c => { t += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch { /* text */ } resolve({ status: res.statusCode, text: t, json: j }); }); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const AGENT_B = { id: 'u-b', email: 'b@sun.test', role: 'agent', businessId: SUN, businessName: 'Sunrise Clinic' };
const MANAGER = { id: 'u-m', email: 'manager@sun.test', role: 'manager', businessId: SUN, businessName: 'Sunrise Clinic' };
_setStaffForToken('rn-agent-b', AGENT_B);
_setStaffForToken('rn-manager', MANAGER);
_setStaffForToken('rn-agent-a', { id: 'u-a', email: 'a@sun.test', role: 'agent', businessId: SUN, businessName: 'Sunrise Clinic' });
const lead = (biz, phone) => db.whatsapp_leads.find(l => l.business_id === biz && l.phone === phone);

// ---------------------------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------------------------
test('WhatsApp messages never overwrite a staff-saved name, but always update the WhatsApp name', async () => {
  await logLead(SUN, '919000000001', 'Boss 👑', 'hi');
  assert.deepEqual([lead(SUN, '919000000001').name, lead(SUN, '919000000001').wa_name], ['Ravi Kumar', 'Boss 👑']);
  // Not saved by staff: the shown name follows WhatsApp.
  await logLead(SUN, '919000000002', 'Sita Devi', 'hello');
  assert.deepEqual([lead(SUN, '919000000002').name, lead(SUN, '919000000002').wa_name], ['Sita Devi', 'Sita Devi']);
  // A new contact: both are the profile name.
  await logLead(SUN, '919000000099', 'New Person', 'hey');
  assert.deepEqual([lead(SUN, '919000000099').name, lead(SUN, '919000000099').wa_name], ['New Person', 'New Person']);
  // Another business's contact with the same number is untouched.
  assert.equal(lead(LOTUS, '919000000001').name, 'Lotus Ravi');
});

test('renaming follows the chat rules (a chat someone else has is view only); empty = back to the WhatsApp name', async () => {
  // Chat 1 belongs to agent a: agent b can't rename it.
  const no = await request('PATCH', '/api/inbox/919000000001', 'rn-agent-b', { name: 'Hacked' });
  assert.equal(no.status, 403);
  assert.equal(lead(SUN, '919000000001').name, 'Ravi Kumar');
  // Agent b's own chat.
  const ok = await request('PATCH', '/api/inbox/919000000002', 'rn-agent-b', { name: '  Sita   Reddy ' });
  assert.equal(ok.status, 200, ok.text);
  assert.deepEqual([lead(SUN, '919000000002').name, lead(SUN, '919000000002').name_set_by], ['Sita Reddy', 'b@sun.test']);
  // Rules: length, no < >.
  assert.equal((await request('PATCH', '/api/inbox/919000000002', 'rn-agent-b', { name: 'x'.repeat(81) })).status, 400);
  assert.equal((await request('PATCH', '/api/inbox/919000000002', 'rn-agent-b', { name: '<b>Sita</b>' })).status, 400);
  // A chat that is someone else's stays view only, for managers too (they can reassign it); its owner can rename it.
  assert.equal((await request('PATCH', '/api/inbox/919000000001', 'rn-manager', { name: 'x' })).status, 403);
  lead(SUN, '919000000003').assigned_to = null;
  assert.equal((await request('PATCH', '/api/inbox/919000000003', 'rn-manager', { name: 'Kiran R' })).status, 200, 'unassigned: anyone (and it becomes theirs)');
  // Empty clears the saved name.
  const clear = await request('PATCH', '/api/inbox/919000000001', 'rn-agent-a', { name: '' });
  assert.equal(clear.status, 200, clear.text);
  assert.deepEqual([lead(SUN, '919000000001').name, lead(SUN, '919000000001').name_set_by], ['😎 Ravi', null]);
});

test('Add lead: a typed name is the team\'s saved name', async () => {
  const r = await inbox.startConversation(MANAGER, '919000000077', 'Kiran from the call', { source: 'Phone call' });
  assert.ifError(r.error);
  assert.deepEqual([lead(SUN, '919000000077').name, lead(SUN, '919000000077').name_set_by], ['Kiran from the call', 'manager@sun.test']);
  await logLead(SUN, '919000000077', 'K 🙂', 'hi');
  assert.deepEqual([lead(SUN, '919000000077').name, lead(SUN, '919000000077').wa_name], ['Kiran from the call', 'K 🙂']);
});

// ---------------------------------------------------------------------------------------------
// Returning
// ---------------------------------------------------------------------------------------------
test('pure: which status a returning lead gets, by type', () => {
  const statuses = ls.template('hospital');
  const on = { statusCustomers: true, statusOthers: true };
  assert.equal(ret.returningStatus(statuses, 'completed', on), 'repeat');
  assert.equal(ret.returningStatus(statuses, 'ordered', on), 'repeat');
  assert.equal(ret.returningStatus(statuses, 'repeat', on), null, 'already returning');
  assert.equal(ret.returningStatus(statuses, 'lost', on), 'new');
  assert.equal(ret.returningStatus(statuses, 'interested', on), 'new');
  assert.equal(ret.returningStatus(statuses, 'completed', { statusCustomers: false, statusOthers: true }), null);
  assert.equal(ret.gapText(120), '4 months');
  assert.equal(ret.gapText(45), '45 days');
});

test('a past customer back after 4 months: Returning status (history "returning"), same agent kept when available', async () => {
  const before = { ...lead(SUN, '919000000001') };
  const r = await ret.apply(SUN, '919000000001', before);
  assert.deepEqual([r.returned, r.days, r.status, r.unassigned], [true, 120, 'repeat', null]);
  const l = lead(SUN, '919000000001');
  assert.deepEqual([l.stage, l.assigned_to, l.returned_after_days], ['repeat', 'a@sun.test', 120]);
  assert.ok(l.returned_at);
  assert.deepEqual(db.lead_status_history.map(h => [h.from_key, h.to_key, h.to_type, h.source]), [['completed', 'repeat', 'repeat', 'returning']]);
  assert.ok(db.lead_notes.some(n => n.author === 'returning' && /Came back after 4 months/.test(n.body)));
});

test('lost lead back after 45 days with its agent away: re-enquiry (New) and unassigned for the rotation', async () => {
  db.staff_availability.push({ business_id: SUN, email: 'b@sun.test', available: false, days: [0, 1, 2, 3, 4, 5, 6] });
  const r = await ret.apply(SUN, '919000000002', { ...lead(SUN, '919000000002') });
  assert.deepEqual([r.status, r.unassigned], ['new', 'b@sun.test']);
  assert.deepEqual([lead(SUN, '919000000002').stage, lead(SUN, '919000000002').assigned_to], ['new', null]);
  assert.ok(db.lead_notes.some(n => /they are away/.test(n.body)));
});

test('owner removed from the team, or "assign afresh": unassigned; status switch off: status kept', async () => {
  db.staff_members = db.staff_members.filter(s => s.email !== 'a@sun.test');
  db.lead_assignment_settings.push({ business_id: SUN, mode: 'off', return_enabled: true, return_days: 30, return_status_customers: false, return_status_others: true, return_owner: 'same' });
  const r = await ret.apply(SUN, '919000000001', { ...lead(SUN, '919000000001') });
  assert.deepEqual([r.status, r.unassigned], [null, 'a@sun.test']);
  assert.equal(lead(SUN, '919000000001').stage, 'completed');
  seed();
  db.lead_assignment_settings.push({ business_id: SUN, mode: 'off', return_enabled: true, return_days: 30, return_status_customers: true, return_status_others: true, return_owner: 'afresh' });
  assert.equal((await ret.apply(SUN, '919000000001', { ...lead(SUN, '919000000001') })).unassigned, 'a@sun.test');
});

test('a shorter silence, the rule off, or a new contact change nothing; another business is untouched', async () => {
  const kiran = { ...lead(SUN, '919000000003') };
  assert.deepEqual(await ret.apply(SUN, '919000000003', kiran), { returned: false });
  assert.deepEqual([lead(SUN, '919000000003').stage, lead(SUN, '919000000003').assigned_to, lead(SUN, '919000000003').returned_at], ['interested', 'a@sun.test', undefined]);
  assert.deepEqual(await ret.apply(SUN, '919000000099', null), { returned: false });
  db.lead_assignment_settings.push({ business_id: SUN, mode: 'off', return_enabled: false, return_days: 30, return_status_customers: true, return_status_others: true, return_owner: 'same' });
  assert.deepEqual(await ret.apply(SUN, '919000000001', { ...lead(SUN, '919000000001') }), { returned: false });
  assert.equal(lead(SUN, '919000000001').stage, 'completed');
  // Lotus' lead with the same number was never touched by Sunrise's rule.
  assert.equal(lead(LOTUS, '919000000001').returned_at, undefined);
});

test('settings: managers save the rule (7–365 days), agents can\'t', async () => {
  assert.equal((await request('PUT', '/api/lead-assignment', 'rn-agent-b', { returning: { days: 60 } })).status, 403);
  assert.equal((await request('PUT', '/api/lead-assignment', 'rn-manager', { returning: { days: 3 } })).status, 400);
  const ok = await request('PUT', '/api/lead-assignment', 'rn-manager', { returning: { enabled: true, days: 60, owner: 'afresh' } });
  assert.equal(ok.status, 200, ok.text);
  assert.deepEqual([db.lead_assignment_settings[0].return_days, db.lead_assignment_settings[0].return_owner], [60, 'afresh']);
  assert.ok(db.audit_log.some(a => a.details.fields.includes('return_days')));
});

test('the Returning filter and the funnel count returning leads apart from new chats', async () => {
  await ret.apply(SUN, '919000000001', { ...lead(SUN, '919000000001') });
  lead(SUN, '919000000001').last_contacted_at = new Date().toISOString(); // the message just arrived
  const list = await request('GET', '/api/inbox?returning=true&range=7d', 'rn-manager');
  assert.equal(list.status, 200, list.text);
  assert.deepEqual(list.json.conversations.map(c => c.phone), ['919000000001']);
  const statuses = ls.template('hospital');
  const now = new Date().toISOString();
  const f = fun.buildFunnel({
    insights: [], statuses, from: ago(7), to: new Date(Date.now() + DAY).toISOString(),
    leads: [{ phone: '1', stage: 'repeat', first_ad_id: '11', first_ad_at: ago(200), returned_at: now }, { phone: '2', stage: 'new', first_ad_id: '11', first_ad_at: now }],
  });
  assert.deepEqual([f.totals.chats, f.totals.returning], [1, 1]);
});

// ---------------------------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------------------------
test('SQL: name + returning columns, backfill, settings checks, history source, safe to re-run', async () => {
  const { freshDb, migrationSql } = require('./helpers/pgHarness.cjs');
  const pg = await freshDb({ upTo: '20261137_zz' });
  const biz = (await pg.query("insert into public.businesses (name, slug, plan_id) values ('Sunrise Clinic', 'sunrise-clinic', 'growth') returning id")).rows[0].id;
  await pg.query("insert into public.whatsapp_leads (phone, name, business_id) values ('919000000001', '😎 Ravi', $1), ('919000000002', '+919000000002', $1)", [biz]);
  await pg.exec(migrationSql('20261138_returning_and_names.sql'));
  await pg.exec(migrationSql('20261138_returning_and_names.sql'));
  const rows = (await pg.query('select phone, wa_name from public.whatsapp_leads where business_id = $1 order by phone', [biz])).rows;
  assert.deepEqual(rows.map(r => r.wa_name), ['😎 Ravi', null], 'a number is not a WhatsApp name');
  await pg.query("insert into public.lead_assignment_settings (business_id) values ($1)", [biz]);
  const s = (await pg.query('select return_enabled, return_days, return_owner from public.lead_assignment_settings where business_id = $1', [biz])).rows[0];
  assert.deepEqual([s.return_enabled, s.return_days, s.return_owner], [true, 30, 'same']);
  await assert.rejects(pg.query('update public.lead_assignment_settings set return_days = 3 where business_id = $1', [biz]));
  await assert.rejects(pg.query("update public.lead_assignment_settings set return_owner = 'boss' where business_id = $1", [biz]));
  await pg.query("insert into public.lead_status_history (business_id, phone, to_key, to_type, source) values ($1, '919000000001', 'repeat', 'repeat', 'returning')", [biz]);
});
