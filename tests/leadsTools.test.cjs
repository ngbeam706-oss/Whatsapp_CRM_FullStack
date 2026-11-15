// Leads tools (docs/progress/leads-tools.md): inbox date range + filters, "Add lead", the Leads page export and
// permanent delete (managers + Business Admin only), and STOP numbers staying blocked after their lead is deleted.
// Part 1: pure helpers. Part 2: the API with a fake database. Part 3: the migration on PGlite.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const SUN = 'a0000000-0000-4000-8000-000000000001'; // Sunrise Clinic
const LOTUS = 'b0000000-0000-4000-8000-000000000002'; // another business
process.env.APP_SECRET = 'server_encryption_secret_long_enough';
process.env.VITE_SUPABASE_URL = 'http://fake.supabase';
process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
process.env.WHATSAPP_BUSINESS_ID = 'c0000000-0000-4000-8000-000000000009';

const app = require('../server/app.cjs');
const lt = require('../server/leadsTools.cjs');
const ls = require('../server/leadStatuses.cjs');
const limits = require('../server/limits.cjs');
const campaigns = require('../server/campaigns.cjs');
const { _setStaffForToken } = require('../server/auth.cjs');

// ---------------------------------------------------------------------------------------------
// Part 1: pure helpers
// ---------------------------------------------------------------------------------------------
test('CSV cells: commas, quotes, new lines, Telugu and ₹ kept; formulas can\'t run in Excel', () => {
  assert.equal(lt.csvCell('Ravi, Kumar'), '"Ravi, Kumar"');
  assert.equal(lt.csvCell('He said "hi"'), '"He said ""hi"""');
  assert.equal(lt.csvCell('line one\nline two'), '"line one\nline two"');
  assert.equal(lt.csvCell('రవి ₹130'), 'రవి ₹130');
  for (const bad of ['=HYPERLINK("x")', '+91 call', '-2+3', '@SUM(A1)']) assert.ok(lt.csvCell(bad).replace(/^"/, '').startsWith("'"), bad);
  assert.equal(lt.csvCell(null), '');
  assert.equal(lt.csvCell(['vip', 'new']), 'vip new');
  const csv = lt.toCsv(['Name', 'Phone'], [['రవి', '+919000000001']]);
  assert.ok(csv.startsWith('﻿Name,Phone\r\n'), 'UTF-8 BOM so Excel reads Telugu');
  assert.ok(csv.includes("రవి,'+919000000001"), 'a leading + is guarded too');
});

test('date ranges are India-time days by last activity; unknown filters are dropped', () => {
  const now = Date.parse('2026-11-13T10:00:00Z'); // 15:30 IST
  assert.equal(lt.rangeBounds(lt.cleanFilters({ range: 'today' }), now).since, '2026-11-12T18:30:00.000Z');
  assert.equal(lt.rangeBounds(lt.cleanFilters({ range: '2d' }), now).since, '2026-11-11T18:30:00.000Z');
  assert.deepEqual(lt.rangeBounds(lt.cleanFilters({ range: 'custom', from: '2026-11-01', to: '2026-11-02' }), now), { since: '2026-10-31T18:30:00.000Z', until: '2026-11-02T18:30:00.000Z' });
  assert.deepEqual(lt.rangeBounds(lt.cleanFilters({}), now), { since: '', until: '' });
  const f = lt.cleanFilters({ range: 'forever', status: 'DROP TABLE', tag: 'a,b', adId: 'x1', number: '12', statusType: 'boss' });
  assert.deepEqual([f.range, f.status, f.tag, f.adId, f.number, f.statusType], ['all', '', '', '', '', '']);
});

// ---------------------------------------------------------------------------------------------
// Part 2: the API (fake database)
// ---------------------------------------------------------------------------------------------
const OLD = '2026-01-01T00:00:00.000Z';
const NOW = () => new Date().toISOString();
let db, storageDeletes;
function seed() {
  db = {
    businesses: [{ id: SUN, name: 'Sunrise Clinic', industry: 'hospital', status: 'active', plan_id: 'pro' }, { id: LOTUS, name: 'Lotus Foods', industry: 'food', status: 'active', plan_id: 'pro' }],
    plans: [{ id: 'pro', name: 'Pro', max_contacts: null }],
    lead_statuses: [...ls.template('hospital').map(s => ({ business_id: SUN, ...s })), ...ls.template('food').map(s => ({ business_id: LOTUS, ...s }))],
    staff_members: [
      { business_id: SUN, user_id: 'u-m', email: 'manager@sunrise.test', role: 'manager' },
      { business_id: SUN, user_id: 'u-a', email: 'agent@sunrise.test', role: 'agent' },
      { business_id: SUN, user_id: 'u-a2', email: 'agent2@sunrise.test', role: 'agent' },
    ],
    whatsapp_leads: [
      { business_id: SUN, phone: '919000000001', name: 'Ravi, "the regular"', stage: 'ordered', source: 'Instagram Ad', tags: ['vip'], last_contacted_at: NOW(), created_at: NOW(), opted_out: false, unread_count: 2, first_ad_id: '555', first_ad_headline: 'Free check-up' },
      { business_id: SUN, phone: '919000000002', name: 'Sita', stage: 'interested', source: 'Direct WhatsApp', tags: [], last_contacted_at: OLD, created_at: OLD, opted_out: true, unread_count: 0 },
      { business_id: SUN, phone: '919000000003', name: '=cmd()', stage: 'new', source: 'Phone call', tags: [], last_contacted_at: NOW(), created_at: NOW(), opted_out: false, unread_count: 0 },
      // The SAME number in another business: never touched or exported.
      { business_id: LOTUS, phone: '919000000002', name: 'Sita at Lotus', stage: 'new', source: 'Direct WhatsApp', tags: [], last_contacted_at: NOW(), created_at: NOW(), opted_out: false },
    ],
    whatsapp_messages: [
      { business_id: SUN, contact_phone: '919000000002', body: 'hi', media_path: `${SUN}/919000000002/photo.jpg` },
      { business_id: LOTUS, contact_phone: '919000000002', body: 'hello Lotus', media_path: `${LOTUS}/919000000002/x.jpg` },
    ],
    lead_notes: [{ business_id: SUN, phone: '919000000002', body: 'note' }, { business_id: SUN, phone: '919000000001', body: 'a' }, { business_id: SUN, phone: '919000000001', body: 'b' }, { business_id: LOTUS, phone: '919000000002', body: 'lotus note' }],
    contact_events: [{ business_id: SUN, phone: '919000000002', event_type: 'order_enquiry' }],
    automation_runs: [{ business_id: SUN, phone: '919000000002' }], campaign_recipients: [{ business_id: SUN, phone: '919000000002' }],
    lead_number_windows: [], whatsapp_calls: [{ business_id: SUN, phone: '919000000002', recording_path: `${SUN}/call1.webm` }], ad_conversions: [],
    lead_import_changes: [{ import_id: 'imp1', business_id: SUN, phone: '919000000002', before: { cols: { name: 'Old' }, custom: {} } }, { import_id: 'imp9', business_id: LOTUS, phone: '919000000002', before: { cols: {}, custom: {} } }],
    queries: [{ id: 'q1', business_id: SUN, contact_phone: '919000000002', subject: 'Refund' }],
    lead_suppressions: [], audit_log: [], usage_counters: [],
  };
  storageDeletes = [];
  ls.clearCache(); limits.clearCache(); lt._resetResends?.();
}

const SKIP = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'or', 'and']);
function matcher(u) {
  const filters = [...new URL(u).searchParams.entries()].filter(([k]) => !SKIP.has(k));
  return (r) => filters.every(([k, v]) => {
    const raw = r[k];
    const val = raw === undefined || raw === null ? null : Array.isArray(raw) ? raw : String(raw);
    if (v.startsWith('eq.')) return val === v.slice(3);
    if (v.startsWith('in.(')) return v.slice(4, -1).split(',').includes(val);
    if (v === 'is.null') return val === null;
    if (v === 'not.is.null') return val !== null;
    if (v === 'is.true') return raw === true;
    if (v === 'is.false') return raw === false;
    if (v.startsWith('gte.')) return val !== null && val >= v.slice(4);
    if (v.startsWith('lt.')) return val !== null && val < v.slice(3);
    if (v.startsWith('gt.')) return Number(val) > Number(v.slice(3));
    if (v.startsWith('cs.{')) return Array.isArray(raw) && raw.includes(v.slice(4, -1));
    return true;
  });
}
const json = (d, status = 200, headers = {}) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json', ...headers } });
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  const body = opts.body ? JSON.parse(opts.body) : null;
  if (u.startsWith('http://fake.supabase/storage/v1/object/') && method === 'DELETE') { storageDeletes.push({ bucket: decodeURIComponent(u.split('/object/')[1]), paths: body.prefixes }); return json([]); }
  if (!u.startsWith('http://fake.supabase/rest/v1/')) return json({}, 503);
  const table = u.slice('http://fake.supabase/rest/v1/'.length).split('?')[0];
  if (table.startsWith('rpc/')) return json([]);
  const rows = db[table] || (db[table] = []);
  const match = matcher(u);
  if (method === 'GET') {
    const hit = rows.filter(match);
    if (/[?&]limit=0/.test(u)) return json([], 200, { 'Content-Range': `*/${hit.length}` });
    const off = Number(new URL(u).searchParams.get('offset') || 0);
    const lim = Number(new URL(u).searchParams.get('limit') || 100000);
    return json(hit.slice(off, off + lim));
  }
  if (method === 'POST') {
    const list = (Array.isArray(body) ? body : [body]).map(r => ({ ...r }));
    for (const r of list) {
      if (table === 'whatsapp_leads') { r.stage ??= 'new'; r.opted_out ??= false; r.created_at ??= NOW(); }
      if (table === 'lead_suppressions' && rows.some(x => x.business_id === r.business_id && x.phone_hash === r.phone_hash)) continue;
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
function request(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } },
      (res) => { let t = ''; res.setEncoding('utf8'); res.on('data', c => { t += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch { /* text */ } resolve({ status: res.statusCode, text: t, json: j, headers: res.headers }); }); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
_setStaffForToken('lt-manager', { id: 'u-m', email: 'manager@sunrise.test', role: 'manager', businessId: SUN, businessName: 'Sunrise Clinic' });
_setStaffForToken('lt-agent', { id: 'u-a', email: 'agent@sunrise.test', role: 'agent', businessId: SUN, businessName: 'Sunrise Clinic' });

test('agents can\'t search, export or delete on the Leads page', async () => {
  for (const p of ['/api/leads/search', '/api/leads/export', '/api/leads/delete']) {
    assert.equal((await request('POST', p, 'lt-agent', { filters: {}, phones: ['919000000001'], confirmCount: 1 })).status, 403, p);
  }
  assert.equal(db.whatsapp_leads.length, 4);
  assert.equal(db.audit_log.length, 0);
});

test('inbox: the date range, source, tag, type and STOP filters run on the server; own business only', async () => {
  const all = await request('GET', '/api/inbox', 'lt-agent');
  assert.equal(all.json.conversations.length, 3, 'no range = every chat of this business');
  const two = await request('GET', '/api/inbox?range=2d', 'lt-agent');
  assert.deepEqual(two.json.conversations.map(c => c.phone).sort(), ['919000000001', '919000000003']);
  assert.deepEqual((await request('GET', '/api/inbox?source=Phone%20call', 'lt-agent')).json.conversations.map(c => c.phone), ['919000000003']);
  assert.deepEqual((await request('GET', '/api/inbox?tag=vip', 'lt-agent')).json.conversations.map(c => c.phone), ['919000000001']);
  assert.deepEqual((await request('GET', '/api/inbox?statusType=won', 'lt-agent')).json.conversations.map(c => c.phone), ['919000000001']);
  assert.deepEqual((await request('GET', '/api/inbox?optedOut=true', 'lt-agent')).json.conversations.map(c => c.phone), ['919000000002']);
  const opts = await request('GET', '/api/inbox-filter-options', 'lt-agent');
  assert.ok(opts.json.sources.includes('Instagram Ad') && opts.json.tags.includes('vip'));
  assert.deepEqual(opts.json.ads, [{ id: '555', headline: 'Free check-up' }]);
});

test('Leads search + export: own business only, the right columns, formulas guarded, audited without the data', async () => {
  const s = await request('POST', '/api/leads/search', 'lt-manager', { filters: { range: 'all' } });
  assert.equal(s.json.total, 3);
  assert.ok(!s.text.includes('Lotus'));
  const ex = await request('POST', '/api/leads/export', 'lt-manager', { filters: { range: 'all' }, columns: ['name', 'phone', 'status', 'statusType', 'notes'] });
  assert.equal(ex.status, 200, ex.text);
  assert.match(ex.headers['content-type'], /text\/csv/);
  assert.equal(ex.headers['x-lead-count'], '3');
  const lines = ex.text.replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(lines[0], 'Name,Phone,Status,Status type,Notes');
  assert.ok(lines.includes('"Ravi, ""the regular""",\'+919000000001,Appointment booked,won,2'), lines.join('\n'));
  assert.ok(lines.some(l => l.startsWith("'=cmd()")), 'formula guarded');
  assert.ok(!ex.text.includes('Lotus'));
  const a = db.audit_log.find(x => x.action === 'leads.exported');
  assert.equal(a.details.count, 3);
  assert.ok(!JSON.stringify(a).includes('919000000'), 'no numbers in the audit log');
  // Selected numbers only (and another business's number is ignored even if sent).
  const sel = await request('POST', '/api/leads/export', 'lt-manager', { phones: ['919000000003'], columns: ['phone'] });
  assert.equal(sel.headers['x-lead-count'], '1');
});

test('delete: typed count required, removes the lead\'s data and files in this business only, keeps STOP numbers blocked', async () => {
  const wrong = await request('POST', '/api/leads/delete', 'lt-manager', { phones: ['919000000002'], confirmCount: 2 });
  assert.equal(wrong.status, 400);
  assert.equal(db.whatsapp_leads.length, 4);
  const ok = await request('POST', '/api/leads/delete', 'lt-manager', { phones: ['919000000002'], confirmCount: 1 });
  assert.equal(ok.status, 200, ok.text);
  assert.deepEqual([ok.json.deleted, ok.json.suppressed], [1, 1]);
  const sun = (t, col = 'phone') => db[t].filter(r => r.business_id === SUN && r[col] === '919000000002').length;
  for (const [t, col] of [['whatsapp_leads', 'phone'], ['whatsapp_messages', 'contact_phone'], ['lead_notes', 'phone'], ['contact_events', 'phone'], ['automation_runs', 'phone'], ['campaign_recipients', 'phone'], ['whatsapp_calls', 'phone'], ['lead_import_changes', 'phone']]) {
    assert.equal(sun(t, col), 0, `${t} still has the deleted lead`);
  }
  assert.equal(db.queries[0].contact_phone, null, 'the query stays but is unlinked');
  // The other business's lead with the same number is untouched.
  assert.ok(db.whatsapp_leads.some(l => l.business_id === LOTUS && l.phone === '919000000002'));
  assert.ok(db.lead_notes.some(n => n.business_id === LOTUS));
  assert.ok(db.lead_import_changes.some(c => c.business_id === LOTUS), 'the other business keeps its import history');
  assert.ok(db.whatsapp_messages.some(m => m.business_id === LOTUS));
  assert.deepEqual(storageDeletes, [{ bucket: 'inbox-media', paths: [`${SUN}/919000000002/photo.jpg`] }, { bucket: 'wa-call-recordings', paths: [`${SUN}/call1.webm`] }]);
  // Suppression: a hash, never the number.
  assert.equal(db.lead_suppressions.length, 1);
  assert.match(db.lead_suppressions[0].phone_hash, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(db.lead_suppressions).includes('919000000002'));
  assert.ok(db.audit_log.some(x => x.action === 'leads.deleted' && x.details.count === 1 && x.details.keptStop === 1));

  // Blocked from sending: manual / follow-up checks, pasted broadcast lists; not in another business.
  assert.equal(await campaigns.isOptedOut(SUN, '919000000002'), true);
  assert.equal(await campaigns.isOptedOut(LOTUS, '919000000002'), false);
  const aud = await campaigns.resolveAudience(SUN, { mode: 'list', phones: '919000000002\n919000000009' });
  assert.deepEqual(aud.recipients.map(r => r.phone), ['919000000009']);
  assert.equal(aud.optedOut, 1);
  // Added again by hand: it comes back opted out.
  const back = await request('POST', '/api/inbox/start', 'lt-manager', { phone: '919000000002', name: 'Sita', source: 'Phone call' });
  assert.equal(back.status, 200, back.text);
  assert.equal(back.json.optedOut, true);
  assert.equal(db.whatsapp_leads.find(l => l.business_id === SUN && l.phone === '919000000002').opted_out, true);
  // START from the customer lifts it.
  await campaigns.setOptOut(SUN, '919000000002', false);
  assert.equal(db.lead_suppressions.length, 0);
});

test('delete by filters, and never more than 1,000 at once', async () => {
  const r = await request('POST', '/api/leads/delete', 'lt-manager', { filters: { source: 'Phone call' }, confirmCount: 1 });
  assert.equal(r.status, 200, r.text);
  assert.ok(!db.whatsapp_leads.some(l => l.phone === '919000000003'));
  for (let i = 0; i < 1001; i++) db.whatsapp_leads.push({ business_id: SUN, phone: `9180000${String(i).padStart(5, '0')}`, stage: 'new', source: 'Bulk', last_contacted_at: NOW(), opted_out: false });
  const big = await request('POST', '/api/leads/delete', 'lt-manager', { filters: { source: 'Bulk' }, confirmCount: 1001 });
  assert.equal(big.status, 400);
  assert.match(big.json.error, /more than 1,000/);
  assert.equal(db.whatsapp_leads.filter(l => l.source === 'Bulk').length, 1001);
});

test('Add lead: source, status, tags, note; an existing number opens it; agents assign only themselves; plan limit', async () => {
  const add = await request('POST', '/api/inbox/start', 'lt-agent', { phone: '+91 90000 00077', name: 'Kiran', source: 'Walk-in', status: 'interested', tags: ['Knee pain'], note: 'Called about knee pain' });
  assert.equal(add.status, 200, add.text);
  const lead = db.whatsapp_leads.find(l => l.phone === '919000000077');
  assert.deepEqual([lead.business_id, lead.source, lead.stage, lead.assigned_to, lead.tags[0]], [SUN, 'Walk-in', 'interested', 'agent@sunrise.test', 'knee-pain']);
  assert.ok(db.lead_notes.some(n => n.phone === '919000000077' && n.body === 'Called about knee pain' && n.author === 'agent@sunrise.test'));
  assert.ok(db.contact_events.some(e => e.phone === '919000000077' && e.event_type === 'lead_added' && e.data.source === 'Walk-in'));

  const again = await request('POST', '/api/inbox/start', 'lt-agent', { phone: '919000000077', name: 'Someone else', source: 'Phone call' });
  assert.equal(again.json.existed, true);
  assert.equal(db.whatsapp_leads.filter(l => l.phone === '919000000077').length, 1);

  assert.equal((await request('POST', '/api/inbox/start', 'lt-agent', { phone: '919000000078', source: 'Phone call', assignedTo: 'agent2@sunrise.test' })).status, 403);
  assert.equal((await request('POST', '/api/inbox/start', 'lt-manager', { phone: '919000000079', source: 'Phone call', assignedTo: 'agent2@sunrise.test' })).status, 200);
  assert.equal((await request('POST', '/api/inbox/start', 'lt-manager', { phone: '919000000080', source: 'Phone call', assignedTo: 'someone@lotus.test' })).status, 400, 'not on this team');
  assert.equal((await request('POST', '/api/inbox/start', 'lt-manager', { phone: '919000000081', source: 'Carrier pigeon' })).status, 400);
  assert.equal((await request('POST', '/api/inbox/start', 'lt-manager', { phone: '12', source: 'Phone call' })).status, 400);

  db.plans[0].max_contacts = 1;
  limits.clearCache();
  const full = await request('POST', '/api/inbox/start', 'lt-manager', { phone: '919000000082', source: 'Phone call' });
  assert.equal(full.status, 400);
  assert.equal(full.json.limitReached, true);
});

// ---------------------------------------------------------------------------------------------
// Part 3: the migration
// ---------------------------------------------------------------------------------------------
test('SQL: suppressions are server-only, hashes only, safe to re-run', async () => {
  const { freshDb, migrationSql, asUser } = require('./helpers/pgHarness.cjs');
  const pg = await freshDb();
  await pg.exec(migrationSql('20261135_leads_tools.sql'));
  const biz = (await pg.query("insert into public.businesses (name, slug, plan_id) values ('Sunrise Clinic', 'sunrise-clinic', 'growth') returning id")).rows[0].id;
  await pg.query('insert into public.lead_suppressions (business_id, phone_hash) values ($1, $2)', [biz, 'a'.repeat(64)]);
  await assert.rejects(pg.query('insert into public.lead_suppressions (business_id, phone_hash) values ($1, $2)', [biz, '919000000001']), /check/);
  const u = (await pg.query("insert into auth.users (email) values ('owner@sunrise.test') returning id")).rows[0].id;
  await pg.query("insert into public.staff_members (user_id, email, role, business_id) values ($1, 'owner@sunrise.test', 'owner', $2)", [u, biz]);
  await assert.rejects(asUser(pg, u, () => pg.query('select * from public.lead_suppressions')));
  const idx = await pg.query("select indexname from pg_indexes where tablename = 'whatsapp_leads' and indexname in ('whatsapp_leads_business_active_idx', 'whatsapp_leads_business_created_idx')");
  assert.equal(idx.rows.length, 2);
});
