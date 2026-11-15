// Customer fields + customer import, phases D1 + D2 (docs/progress/customer-import.md).
// Part 1: pure helpers (phone cleaning, value types, private fields, fill / overwrite). Part 2: the API with a fake
// database (roles, tenancy, limits, STOP, undo, the AI never gets private fields, the Inbox leaves imports out).
// Part 3: the migration on PGlite (server-only tables, safe to re-run, plan limits).
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');

const SUN = 'a0000000-0000-4000-8000-000000000001'; // Sunrise Loans
const LOTUS = 'b0000000-0000-4000-8000-000000000002'; // another business
process.env.APP_SECRET = 'server_encryption_secret_long_enough';
process.env.VITE_SUPABASE_URL = 'http://fake.supabase';
process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
process.env.WHATSAPP_BUSINESS_ID = 'c0000000-0000-4000-8000-000000000009';

const app = require('../server/app.cjs');
const cf = require('../server/customFields.cjs');
const li = require('../server/leadImport.cjs');
const ls = require('../server/leadStatuses.cjs');
const lt = require('../server/leadsTools.cjs');
const limits = require('../server/limits.cjs');
const ai = require('../server/ai.cjs');
const llm = require('../server/llm.cjs');
const secrets = require('../server/secrets.cjs');
const { _setStaffForToken } = require('../server/auth.cjs');

// ---------------------------------------------------------------------------------------------
// Part 1: pure helpers
// ---------------------------------------------------------------------------------------------
test('phone cleaning: Indian 10-digit -> 91…, +91 with spaces and dashes, other countries need the code, landlines rejected', () => {
  const ok = (raw, want) => assert.equal(li.cleanPhone(raw).phone, want, raw);
  ok('9876543210', '919876543210');
  ok('+91 98765-43210', '919876543210');
  ok('09876543210', '919876543210');
  ok('919876543210', '919876543210');
  ok('+44 7911 123456', '447911123456');
  ok('00447911123456', '447911123456');
  ok('9.876543210E+9', '919876543210'); // Excel's number format, every digit kept
  for (const bad of ['040 2345 6789', '4023456789', '+91 4023456789', '12345', 'call me', '', '0447911123456']) {
    assert.ok(li.cleanPhone(bad).error, `${bad} should be rejected`);
  }
  assert.match(li.cleanPhone('4023456789').error, /landline|mobile/i);
  const two = li.cleanPhone('98765 43210 / 91234 56789');
  assert.equal(two.phone, '919876543210');
  assert.deepEqual(two.more, ['919123456789'], 'the rest are kept');
});

test('value types: number, amount (₹ and Indian commas), date (day first), choice, yes/no; 500 characters at most', () => {
  const f = (type, options = []) => ({ key: 'k', label: 'K', type, options, private: false, hidden: false, sort_order: 0 });
  assert.deepEqual(cf.cleanValue(f('number'), '742'), { value: 742 });
  assert.ok(cf.cleanValue(f('number'), 'seven').error);
  assert.deepEqual(cf.cleanValue(f('amount'), '₹3,00,000'), { value: 300000 });
  assert.deepEqual(cf.cleanValue(f('amount'), 'Rs. 1,250.50'), { value: 1250.5 });
  assert.ok(cf.cleanValue(f('amount'), '-5').error);
  assert.deepEqual(cf.cleanValue(f('date'), '05/12/2026'), { value: '2026-12-05' });
  assert.deepEqual(cf.cleanValue(f('date'), '2026-12-05'), { value: '2026-12-05' });
  assert.ok(cf.cleanValue(f('date'), '31/02/2026').error, 'no 31 February');
  assert.deepEqual(cf.cleanValue(f('choice', ['Home', 'Car']), 'car'), { value: 'Car' });
  assert.ok(cf.cleanValue(f('choice', ['Home', 'Car']), 'Boat').error);
  assert.deepEqual(cf.cleanValue(f('yesno'), 'Yes'), { value: true });
  assert.deepEqual(cf.cleanValue(f('yesno'), 'n'), { value: false });
  assert.deepEqual(cf.cleanValue(f('text'), '   '), { value: null });
  assert.ok(cf.cleanValue(f('text'), 'x'.repeat(501)).error);
  assert.equal(cf.keyFromLabel('CIBIL score'), 'cibil_score');
  assert.equal(cf.keyFromLabel('CIBIL score', ['cibil_score']), 'cibil_score_2');
  assert.equal(cf.keyFromLabel('2nd number'), 'f_2nd_number');
  assert.ok(cf.looksSensitive('CIBIL Score') && cf.looksSensitive('Monthly income') && cf.looksSensitive('PAN number') && !cf.looksSensitive('Branch'));
});

const FIELDS = [
  { key: 'cibil', label: 'CIBIL score', type: 'number', options: [], private: true, hidden: false, sort_order: 1 },
  { key: 'branch', label: 'Branch', type: 'text', options: [], private: false, hidden: false, sort_order: 2 },
  { key: 'old_note', label: 'Old note', type: 'text', options: [], private: false, hidden: true, sort_order: 3 },
];

test('private fields: agents see "hidden", managers see values; the AI gets only normal, visible fields', () => {
  const custom = { cibil: 742, branch: 'Guntur', old_note: 'x' };
  const agent = cf.detailsFor(FIELDS, custom, 'agent');
  assert.deepEqual(agent.map(d => [d.key, d.hidden, d.value]), [['cibil', true, null], ['branch', false, 'Guntur']], 'hidden fields are not listed');
  const manager = cf.detailsFor(FIELDS, custom, 'manager');
  assert.equal(manager.find(d => d.key === 'cibil').value, 742);
  const facts = cf.aiFacts(FIELDS, custom);
  assert.equal(facts, '- Branch: Guntur');
  assert.ok(!facts.includes('742') && !facts.includes('CIBIL'));
});

test('fill / overwrite / skip for people already in the CRM; tags are added, nothing is erased', () => {
  const lead = { phone: '919000000001', name: 'Ravi', stage: 'interested', source: null, tags: ['vip'], assigned_to: null, custom: { branch: 'Guntur' } };
  const row = { row: 2, phone: '919000000001', more: [], name: 'Ravi Kumar', stage: 'new', source: 'Old CRM', tags: ['loans'], custom: { branch: 'Vizag', cibil: 700 } };
  const fill = li.changesFor(lead, row, 'fill');
  assert.deepEqual(fill.set.custom, { branch: 'Guntur', cibil: 700 }, 'fill keeps the saved branch');
  assert.equal(fill.set.name, undefined, 'fill keeps the saved name');
  assert.equal(fill.set.stage, undefined, 'fill never changes the status');
  assert.equal(fill.set.source, 'Old CRM');
  assert.deepEqual(fill.set.tags, ['vip', 'loans']);
  assert.deepEqual(fill.before, { cols: { source: null, tags: ['vip'] }, custom: { cibil: null } });
  const over = li.changesFor(lead, row, 'overwrite');
  assert.equal(over.set.name, 'Ravi Kumar');
  assert.equal(over.set.custom.branch, 'Vizag');
  assert.deepEqual(over.before.custom, { branch: 'Guntur', cibil: null });
  assert.equal(li.changesFor(lead, row, 'skip'), null);
  assert.equal(li.changesFor({ ...lead, source: 'Old CRM', tags: ['vip', 'loans'], custom: { branch: 'Guntur', cibil: 700 } }, row, 'fill'), null, 'nothing new');
});

// ---------------------------------------------------------------------------------------------
// Part 2: the API (fake database)
// ---------------------------------------------------------------------------------------------
const NOW = () => new Date().toISOString();
let db, llmCalls;
function seed() {
  db = {
    businesses: [{ id: SUN, name: 'Sunrise Loans', industry: 'finance', status: 'active', plan_id: 'growth' }, { id: LOTUS, name: 'Lotus Foods', industry: 'food', status: 'active', plan_id: 'growth' }],
    plans: [{ id: 'growth', name: 'Growth', max_contacts: 100, max_custom_fields: 4, max_import_rows_per_file: 10, max_import_file_mb: 5, max_import_rows_month: 6 }],
    lead_statuses: [...ls.template('general').map(s => ({ business_id: SUN, ...s })), ...ls.template('food').map(s => ({ business_id: LOTUS, ...s }))],
    staff_members: [
      { business_id: SUN, user_id: 'u-o', email: 'owner@sunrise.test', role: 'owner' },
      { business_id: SUN, user_id: 'u-m', email: 'manager@sunrise.test', role: 'manager' },
      { business_id: SUN, user_id: 'u-a', email: 'agent@sunrise.test', role: 'agent' },
      { business_id: LOTUS, user_id: 'u-l', email: 'manager@lotus.test', role: 'manager' },
    ],
    lead_custom_fields: [
      { business_id: SUN, key: 'cibil', label: 'CIBIL score', type: 'number', options: [], private: true, hidden: false, sort_order: 1, created_at: NOW() },
      { business_id: SUN, key: 'branch', label: 'Branch', type: 'text', options: [], private: false, hidden: false, sort_order: 2, created_at: NOW() },
      { business_id: LOTUS, key: 'fav', label: 'Favourite dish', type: 'text', options: [], private: false, hidden: false, sort_order: 1, created_at: NOW() },
    ],
    whatsapp_leads: [
      { business_id: SUN, phone: '919000000001', name: 'Ravi', stage: 'new', source: 'Direct WhatsApp', tags: ['vip'], assigned_to: null, custom: { cibil: 742, branch: 'Guntur' }, opted_out: false, last_contacted_at: NOW(), created_at: NOW(), unread_count: 0 },
      { business_id: SUN, phone: '919000000002', name: 'Sita', stage: 'new', source: 'Direct WhatsApp', tags: [], assigned_to: 'agent@sunrise.test', custom: {}, opted_out: false, last_contacted_at: NOW(), created_at: NOW(), unread_count: 0 },
      { business_id: LOTUS, phone: '919000000003', name: 'Lotus person', stage: 'new', source: 'Direct WhatsApp', tags: [], custom: { fav: 'Dosa' }, opted_out: false, last_contacted_at: NOW(), created_at: NOW() },
    ],
    whatsapp_messages: [{ business_id: SUN, contact_phone: '919000000001', direction: 'inbound', body: 'What is my loan status?', timestamp: NOW() }],
    lead_imports: [], lead_import_changes: [], lead_suppressions: [], audit_log: [], usage_counters: [], ai_settings: [],
    ai_provider: [{ business_id: SUN, provider: 'anthropic', model: 'claude-test', api_key_enc: secrets.encrypt('sk-test-key') }],
  };
  llmCalls = [];
  cf.clearCache(); cf._resetColumns(); ls.clearCache(); limits.clearCache();
}

const SKIP = new Set(['select', 'order', 'limit', 'offset', 'on_conflict']);
/** One PostgREST condition ("col=op.value" or "col.op.value" inside or=()). */
function cond(r, k, v) {
  const raw = r[k];
  const val = raw === undefined || raw === null ? null : Array.isArray(raw) ? raw : String(raw);
  if (v.startsWith('eq.')) return val === decodeURIComponent(v.slice(3));
  if (v.startsWith('in.(')) return v.slice(4, -1).split(',').includes(val);
  if (v === 'is.null') return val === null;
  if (v === 'not.is.null') return val !== null;
  if (v === 'is.true') return raw === true;
  if (v === 'is.false') return raw === false;
  if (v.startsWith('gte.')) return val !== null && val >= decodeURIComponent(v.slice(4));
  if (v.startsWith('lt.')) return val !== null && val < decodeURIComponent(v.slice(3));
  if (v.startsWith('gt.')) return Number(val) > Number(v.slice(3));
  if (v.startsWith('cs.{')) return Array.isArray(raw) && raw.includes(decodeURIComponent(v.slice(4, -1)));
  if (v.startsWith('ilike.')) return val !== null && new RegExp(decodeURIComponent(v.slice(6)).replace(/\*/g, '.*'), 'i').test(String(val));
  return true;
}
/** or(a.op.v,b.op.v) */
function orGroup(r, inner) {
  return inner.split(',').some(part => { const i = part.indexOf('.'); return cond(r, part.slice(0, i), part.slice(i + 1)); });
}
function matcher(u) {
  const params = [...new URL(u).searchParams.entries()].filter(([k]) => !SKIP.has(k));
  return (r) => params.every(([k, v]) => {
    if (k === 'or') return orGroup(r, v.slice(1, -1));
    if (k === 'not.and') return !v.slice(1, -1).split(',').every(part => { const i = part.indexOf('.'); return cond(r, part.slice(0, i), part.slice(i + 1)); });
    if (k === 'and') return [...v.matchAll(/or\(([^)]*)\)/g)].every(m => orGroup(r, m[1]));
    return cond(r, k, v);
  });
}
const json = (d, status = 200, headers = {}) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const KEYS = { whatsapp_leads: ['business_id', 'phone'], lead_custom_fields: ['business_id', 'key'], lead_import_changes: ['import_id', 'phone'] };
let slowInsertMs = 0; // tests: make inserts slow so two requests really overlap
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (slowInsertMs && (opts.method || 'GET') === 'POST' && u.includes('/rest/v1/whatsapp_leads?')) await new Promise(r => setTimeout(r, slowInsertMs));
  const method = opts.method || 'GET';
  const body = opts.body ? JSON.parse(opts.body) : null;
  const prefer = String(opts.headers?.Prefer || opts.headers?.prefer || '');
  if (!u.startsWith('http://fake.supabase/rest/v1/')) return json({}, 503);
  const table = u.slice('http://fake.supabase/rest/v1/'.length).split('?')[0];
  if (table === 'rpc/lead_import_claim_batch') {
    // Same rule as the SQL function: running, no part in progress (2-minute release), inside the row range.
    const i = db.lead_imports.find(x => x.id === body.p_import && x.business_id === body.p_business);
    const free = i && (!i.batch_started_at || Date.parse(i.batch_started_at) < Date.now() - 120000);
    if (!i || i.status !== 'running' || !free || body.p_rows <= 0 || (i.rows_done || 0) + body.p_rows > i.row_to - i.row_from + 1) return json([]);
    i.batch_started_at = NOW(); i.updated_at = NOW();
    return json([{ ...i }]);
  }
  if (table === 'rpc/lead_import_end_batch') {
    const i = db.lead_imports.find(x => x.id === body.p_import && x.business_id === body.p_business);
    if (!i) return json([]);
    i.rows_done += body.p_rows; i.created_count += body.p_created; i.updated_count += body.p_updated; i.skipped_count += body.p_skipped; i.rejected_count += body.p_rejected;
    i.batch_started_at = null; i.updated_at = NOW();
    return json([{ ...i }]);
  }
  if (table.startsWith('rpc/')) return json([]);
  const rows = db[table] || (db[table] = []);
  const match = matcher(u);
  if (method === 'GET') {
    const hit = rows.filter(match);
    const order = new URL(u).searchParams.get('order');
    if (order) { const col = order.split(',')[0].split('.')[0]; const desc = /.desc/.test(order.split(',')[0]); hit.sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (desc ? -1 : 1)); }
    if (/[?&]limit=0/.test(u)) return json([], 200, { 'Content-Range': `*/${hit.length}` });
    return json(hit.slice(0, Number(new URL(u).searchParams.get('limit') || 100000)));
  }
  if (method === 'POST') {
    const list = (Array.isArray(body) ? body : [body]).map(r => ({ ...r }));
    const keys = KEYS[table];
    const out = [];
    for (const r of list) {
      if (table === 'lead_imports') {
        if (rows.some(x => x.business_id === r.business_id && x.status === 'running')) return json({ message: 'duplicate key' }, 409);
        Object.assign(r, { id: crypto.randomUUID(), status: 'running', created_count: 0, updated_count: 0, skipped_count: 0, rejected_count: 0, rows_done: 0, created_at: NOW(), updated_at: NOW(), ...r });
      }
      if (table === 'whatsapp_leads') { r.stage ??= 'new'; r.opted_out ??= false; r.custom ??= {}; r.created_at ??= NOW(); }
      const existing = keys ? rows.find(x => keys.every(k => x[k] === r[k])) : null;
      if (existing) {
        if (/merge-duplicates/.test(prefer)) Object.assign(existing, r);
        else if (!/ignore-duplicates/.test(prefer)) return json({ message: 'duplicate key' }, 409);
        continue;
      }
      rows.push(r); out.push(r);
    }
    return json(out, 201);
  }
  if (method === 'PATCH') { const hit = rows.filter(match); hit.forEach(r => Object.assign(r, body)); return json(hit); }
  if (method === 'DELETE') { const hit = rows.filter(match); db[table] = rows.filter(r => !hit.includes(r)); return json(hit); }
  return json([]);
};

let server, base;
before(async () => {
  server = app.listen(0); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`;
  llm.complete = async (cfg, req) => { llmCalls.push(req); return { text: 'Our team will check your loan status.' }; };
});
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
_setStaffForToken('ci-owner', { id: 'u-o', email: 'owner@sunrise.test', role: 'owner', businessId: SUN, businessName: 'Sunrise Loans' });
_setStaffForToken('ci-manager', { id: 'u-m', email: 'manager@sunrise.test', role: 'manager', businessId: SUN, businessName: 'Sunrise Loans' });
_setStaffForToken('ci-agent', { id: 'u-a', email: 'agent@sunrise.test', role: 'agent', businessId: SUN, businessName: 'Sunrise Loans' });
_setStaffForToken('ci-lotus', { id: 'u-l', email: 'manager@lotus.test', role: 'manager', businessId: LOTUS, businessName: 'Lotus Foods' });

test('customer fields: everyone reads, only managers + Business Admin change them, own business only, plan limit', async () => {
  const agentView = await request('GET', '/api/customer-fields', 'ci-agent');
  assert.equal(agentView.status, 200);
  assert.deepEqual(agentView.json.fields.map(f => f.key), ['cibil', 'branch'], 'never another business\'s fields');
  assert.equal(agentView.json.canEdit, false);
  assert.equal((await request('POST', '/api/customer-fields', 'ci-agent', { label: 'Loan amount', type: 'amount' })).status, 403);
  assert.equal((await request('PATCH', '/api/customer-fields/branch', 'ci-agent', { private: true })).status, 403);
  const added = await request('POST', '/api/customer-fields', 'ci-manager', { label: 'Loan amount', type: 'amount', private: true });
  assert.equal(added.status, 200, added.text);
  assert.equal(added.json.field.key, 'loan_amount');
  assert.equal((await request('POST', '/api/customer-fields', 'ci-manager', { label: 'loan AMOUNT', type: 'text' })).status, 400, 'no two fields with one name');
  assert.equal((await request('POST', '/api/customer-fields', 'ci-manager', { label: 'Loan type', type: 'choice' })).status, 400, 'a choice needs choices');
  assert.equal((await request('POST', '/api/customer-fields', 'ci-manager', { label: 'Loan type', type: 'choice', options: ['Home', 'Car'] })).status, 200);
  const over = await request('POST', '/api/customer-fields', 'ci-manager', { label: 'EMI date', type: 'date' });
  assert.equal(over.status, 400);
  assert.match(over.json.error, /allows 4 customer fields/);
  const renamed = await request('PATCH', '/api/customer-fields/branch', 'ci-manager', { label: 'Home branch', hidden: true });
  assert.equal(renamed.status, 200);
  assert.equal(db.lead_custom_fields.find(f => f.business_id === SUN && f.key === 'branch').label, 'Home branch');
  assert.equal((await request('PATCH', '/api/customer-fields/fav', 'ci-manager', { label: 'Mine' })).status, 404, 'another business\'s field');
  const reorder = await request('PUT', '/api/customer-fields/order', 'ci-manager', { keys: ['loan_type', 'loan_amount', 'branch', 'cibil'] });
  assert.equal(reorder.status, 200, reorder.text);
  assert.deepEqual(reorder.json.fields.map(f => f.key), ['loan_type', 'loan_amount', 'branch', 'cibil']);
  const a = db.audit_log.filter(x => x.action.startsWith('custom_field.'));
  assert.ok(a.length >= 4);
});

test('details card: agents see normal values and "hidden" for private ones and cannot edit; managers edit with checked types', async () => {
  const asAgent = await request('POST', '/api/customer-details', 'ci-agent', { phone: '919000000001' });
  assert.equal(asAgent.status, 200, asAgent.text);
  assert.deepEqual(asAgent.json.fields.map(f => [f.key, f.hidden, f.value]), [['cibil', true, null], ['branch', false, 'Guntur']]);
  assert.ok(!asAgent.text.includes('742'), 'the private value never reaches an agent');
  assert.equal(asAgent.json.canEdit, false);
  assert.equal((await request('POST', '/api/customer-details/save', 'ci-agent', { phone: '919000000001', values: { branch: 'Vizag' } })).status, 403);
  const asManager = await request('POST', '/api/customer-details', 'ci-manager', { phone: '919000000001' });
  assert.equal(asManager.json.fields[0].value, 742);
  assert.equal((await request('POST', '/api/customer-details/save', 'ci-manager', { phone: '919000000001', values: { cibil: 'high' } })).status, 400, 'types are checked');
  const saved = await request('POST', '/api/customer-details/save', 'ci-manager', { phone: '919000000001', values: { cibil: '760', branch: null } });
  assert.equal(saved.status, 200, saved.text);
  const lead = db.whatsapp_leads.find(l => l.business_id === SUN && l.phone === '919000000001');
  assert.deepEqual(lead.custom, { cibil: 760 });
  assert.equal(lead.assigned_to, 'manager@sunrise.test', 'an unassigned chat is claimed, as for any action');
  const audit = db.audit_log.find(x => x.action === 'customer_details.changed');
  assert.deepEqual(audit.details, { keys: ['cibil', 'branch'], privateKeys: ['cibil'] });
  assert.ok(!JSON.stringify(audit).includes('760'), 'values are never audited');
  // Someone else's chat: refused (lead ownership as today).
  const other = await request('POST', '/api/customer-details/save', 'ci-manager', { phone: '919000000002', values: { branch: 'Vizag' } });
  assert.equal(other.status, 403);
  // Another business's customer: not found.
  assert.equal((await request('POST', '/api/customer-details', 'ci-manager', { phone: '919000000003' })).status, 404);
  assert.equal((await request('POST', '/api/customer-details', 'ci-lotus', { phone: '919000000001' })).status, 404);
});

test('the AI draft gets normal customer details but never private ones', async () => {
  const r = await ai.draftReply({ businessId: SUN, phone: '919000000001', catalog: {} });
  assert.equal(r.draft, 'Our team will check your loan status.');
  const sent = JSON.stringify(llmCalls);
  assert.ok(sent.includes('Branch: Guntur'), 'normal fields help the draft');
  assert.ok(!sent.includes('742') && !sent.includes('CIBIL'), 'private fields never reach the AI');
  assert.equal(await cf.aiFactsFor(SUN, '919000000001'), '- Branch: Guntur');
});

const ROWS = [
  { row: 1, phone: '9876543210', name: 'Asha', custom: { cibil: '700', branch: 'Guntur' } },
  { row: 2, phone: '+91 98765-43210', name: 'Asha again' },                       // same number twice
  { row: 3, phone: '919000000001', name: 'Ravi K', custom: { cibil: '710', branch: 'Vizag' } }, // already in the CRM
  { row: 4, phone: '4023456789', name: 'Landline' },                            // invalid
  { row: 5, phone: '9123456789', status: 'Not a status' },                      // unknown status
  { row: 6, phone: '9123456780', assignedTo: 'stranger@x.test' },               // not in the team
  { row: 7, phone: '9123456781', custom: { cibil: 'high' } },                   // wrong type
  { row: 8, phone: '9123456782 / 9123456783', tags: 'Hot lead, Nov' },          // two numbers
  { row: 9, phone: '9123456784' },
];

test('dry run: counts new / existing / invalid / duplicates, saves nothing; agents and other businesses can\'t', async () => {
  const before = JSON.stringify(db.whatsapp_leads);
  assert.equal((await request('POST', '/api/imports/check', 'ci-agent', { rows: ROWS })).status, 403);
  const r = await request('POST', '/api/imports/check', 'ci-manager', { rows: ROWS, options: { mode: 'fill' } });
  assert.equal(r.status, 200, r.text);
  const kinds = Object.fromEntries(r.json.results.map(x => [x.row, x.kind]));
  assert.deepEqual(kinds, { 1: 'new', 2: 'duplicate', 3: 'unchanged', 4: 'invalid', 5: 'invalid', 6: 'invalid', 7: 'invalid', 8: 'new', 9: 'new' });
  assert.match(r.json.results.find(x => x.row === 5).reason, /Unknown status/);
  assert.match(r.json.results.find(x => x.row === 6).reason, /team/);
  assert.match(r.json.results.find(x => x.row === 7).reason, /not a number/);
  assert.equal(JSON.stringify(db.whatsapp_leads), before, 'a dry run saves nothing');
  assert.equal(db.lead_imports.length, 0);
  // Another business sees its own customer as new (no matching across businesses).
  const lotus = await request('POST', '/api/imports/check', 'ci-lotus', { rows: [{ row: 1, phone: '919000000001' }] });
  assert.equal(lotus.json.results[0].kind, 'new');
});

/** Start + one batch + finish, as the wizard does. */
async function runImport(token, rows, extra = {}) {
  const s = await request('POST', '/api/imports/start', token, { fileName: 'loans-nov.xlsx', fileRows: rows.length, fileBytes: 2000, rowFrom: 1, rowTo: rows.length, consent: true, options: { mode: 'fill', tag: 'Loans Nov' }, ...extra });
  if (s.status !== 200) return { start: s };
  const id = s.json.import.id;
  const b = await request('POST', `/api/imports/${id}/batch`, token, { rows });
  const f = await request('POST', `/api/imports/${id}/finish`, token, {});
  return { start: s, batch: b, finish: f, id };
}

test('import: creates new people (out of the Inbox), fills existing ones, re-applies STOP, keeps other numbers, audited without data', async () => {
  db.lead_suppressions.push({ business_id: SUN, phone_hash: lt.phoneHash(SUN, '919123456784'), reason: 'stop' });
  assert.equal((await request('POST', '/api/imports/start', 'ci-manager', { fileName: 'x.xlsx', fileRows: 1, rowFrom: 1, rowTo: 1, consent: false })).status, 400, 'consent is required');
  assert.equal((await request('POST', '/api/imports/start', 'ci-manager', { fileName: 'x.pdf', fileRows: 1, rowFrom: 1, rowTo: 1, consent: true })).status, 400, 'csv / xlsx only');
  const { batch, finish, id } = await runImport('ci-manager', ROWS);
  assert.equal(batch.status, 200, batch.text);
  assert.equal(batch.json.created, 3, 'rows 1, 8 and 9');
  const sun = (p) => db.whatsapp_leads.find(l => l.business_id === SUN && l.phone === p);
  const asha = sun('919876543210');
  assert.equal(asha.import_id, id);
  assert.ok(asha.imported_at);
  assert.deepEqual(asha.custom, { cibil: 700, branch: 'Guntur' });
  assert.deepEqual(asha.tags, ['loans-nov']);
  assert.equal(asha.last_contacted_at, undefined, 'never chatted');
  const two = sun('919123456782');
  assert.equal(two.custom.other_numbers, '+919123456783', 'the second number is kept');
  assert.deepEqual(two.tags, ['hot-lead', 'nov', 'loans-nov']);
  assert.equal(sun('919123456784').opted_out, true, 'STOP re-applied');
  const ravi = sun('919000000001');
  assert.equal(ravi.name, 'Ravi', 'fill keeps the saved name');
  assert.deepEqual(ravi.custom, { cibil: 742, branch: 'Guntur' }, 'fill keeps saved values');
  assert.deepEqual(ravi.tags, ['vip', 'loans-nov']);
  assert.equal(ravi.import_id, undefined, 'existing people are not marked as created by the import');
  assert.equal(batch.json.rejected.length, 5);
  assert.equal(finish.json.import.status, 'done');
  assert.equal(finish.json.import.created, 3);
  // The Inbox and Pipeline leave out imported people who never chatted; the Leads filter finds them.
  const inbox = await request('GET', '/api/inbox', 'ci-agent');
  assert.deepEqual(inbox.json.conversations.map(c => c.phone).sort(), ['919000000001', '919000000002']);
  const pipe = await request('GET', '/api/pipeline', 'ci-agent');
  assert.ok(!JSON.stringify(pipe.json).includes('919876543210'));
  const leads = await request('POST', '/api/leads/search', 'ci-manager', { filters: { imported: true } });
  assert.deepEqual(leads.json.leads.map(l => l.phone).sort(), ['919123456782', '919123456784', '919876543210']);
  // Writing in brings them into the Inbox.
  asha.last_contacted_at = NOW();
  assert.ok((await request('GET', '/api/inbox', 'ci-agent')).json.conversations.some(c => c.phone === '919876543210'));
  // Audit: counts, file name, consent; never numbers or values.
  const audits = db.audit_log.filter(a => a.action.startsWith('import.'));
  assert.deepEqual(audits.map(a => a.action), ['import.started', 'import.finished']);
  assert.equal(audits[0].details.consent, true);
  assert.ok(!JSON.stringify(audits).includes('9876543210') && !JSON.stringify(audits).includes('700'));
  // Other businesses never see it.
  assert.equal((await request('POST', `/api/imports/${id}/undo`, 'ci-lotus')).status, 404);
  assert.equal((await request('GET', '/api/imports', 'ci-lotus')).json.imports.length, 0);
});

test('import limits: rows per file (continue from row…), new people per month, contacts, one import at a time', async () => {
  const many = Array.from({ length: 11 }, (_, i) => ({ row: i + 1, phone: `91234567${String(i).padStart(2, '0')}` }));
  const tooMany = await request('POST', '/api/imports/start', 'ci-manager', { fileName: 'big.csv', fileRows: 11, fileBytes: 100, rowFrom: 1, rowTo: 11, consent: true });
  assert.equal(tooMany.status, 400);
  assert.match(tooMany.json.error, /allows 10 rows per upload\. Import rows 1–10 now.*continue from row 11/);
  const bigFile = await request('POST', '/api/imports/start', 'ci-manager', { fileName: 'big.csv', fileRows: 5, fileBytes: 6 * 1024 * 1024, rowFrom: 1, rowTo: 5, consent: true });
  assert.match(bigFile.json.error, /5 MB/);
  // One at a time.
  const first = await request('POST', '/api/imports/start', 'ci-manager', { fileName: 'big.csv', fileRows: 11, fileBytes: 100, rowFrom: 1, rowTo: 10, consent: true });
  assert.equal(first.status, 200, first.text);
  const second = await request('POST', '/api/imports/start', 'ci-owner', { fileName: 'other.csv', fileRows: 1, fileBytes: 100, rowFrom: 1, rowTo: 1, consent: true });
  assert.equal(second.status, 409);
  // 6 new people a month: rows beyond are refused as over the limit.
  const b = await request('POST', `/api/imports/${first.json.import.id}/batch`, 'ci-manager', { rows: many.slice(0, 10) });
  assert.equal(b.json.created, 6);
  assert.equal(b.json.rejected.filter(r => r.kind === 'over_limit').length, 4);
  await request('POST', `/api/imports/${first.json.import.id}/finish`, 'ci-manager', {});
  // Continue from row 11 next time: still over the month's limit, and the same people are not counted twice.
  const again = await runImport('ci-manager', many.slice(0, 7).map((r, i) => ({ ...r, row: i + 1 })));
  assert.equal(again.batch.json.created, 0);
  assert.equal(again.batch.json.rejected.filter(r => r.kind === 'over_limit').length, 1, 'only the 7th, new, person is over the limit');
  // The total contacts ceiling counts imported people too.
  db.plans[0].max_import_rows_month = null; db.plans[0].max_contacts = 9; limits.clearCache();
  const lim = await li.limitsFor(SUN);
  assert.equal(lim.contactsLeft, 9 - db.whatsapp_leads.filter(l => l.business_id === SUN).length);
});

test('undo (7 days): removes the people the import created (not those who wrote in since) and puts back changed fields', async () => {
  const { id } = await runImport('ci-manager', [
    { row: 1, phone: '9876543210', name: 'Asha' },
    { row: 2, phone: '9876543211', name: 'Bala' },
    { row: 3, phone: '919000000001', name: 'Ravi K', source: 'x', custom: { cibil: '710', branch: 'Vizag' } },
  ], { options: { mode: 'overwrite', tag: 'nov' } });
  const sun = (p) => db.whatsapp_leads.find(l => l.business_id === SUN && l.phone === p);
  assert.equal(sun('919000000001').name, 'Ravi K');
  assert.deepEqual(sun('919000000001').custom, { cibil: 710, branch: 'Vizag' });
  // Bala wrote to us after the import: kept by Undo. A manager changed Ravi's branch meanwhile? (other keys stay)
  sun('919876543211').last_contacted_at = NOW();
  sun('919000000001').custom.note = 'kept';
  assert.equal((await request('POST', `/api/imports/${id}/undo`, 'ci-agent')).status, 403);
  const u = await request('POST', `/api/imports/${id}/undo`, 'ci-manager');
  assert.equal(u.status, 200, u.text);
  assert.deepEqual([u.json.removed, u.json.restored, u.json.kept, u.json.changedSince], [1, 1, 1, 0]);
  assert.equal(sun('919876543210'), undefined, 'removed');
  assert.ok(sun('919876543211'), 'kept: they wrote to us');
  const ravi = sun('919000000001');
  assert.equal(ravi.name, 'Ravi');
  assert.equal(ravi.source, 'Direct WhatsApp');
  assert.deepEqual(ravi.tags, ['vip']);
  assert.deepEqual(ravi.custom, { cibil: 742, branch: 'Guntur', note: 'kept' });
  assert.equal((await request('POST', `/api/imports/${id}/undo`, 'ci-manager')).status, 409, 'once only');
  assert.ok(db.audit_log.some(a => a.action === 'import.undone' && a.details.removed === 1));
  // After 7 days: no undo.
  const { id: old } = await runImport('ci-manager', [{ row: 1, phone: '9876543299' }]);
  db.lead_imports.find(i => i.id === old).created_at = new Date(Date.now() - 8 * 86400000).toISOString();
  assert.equal((await request('POST', `/api/imports/${old}/undo`, 'ci-manager')).status, 400);
});

// ---------------------------------------------------------------------------------------------
// Part 4: fixes from the cross-check (one test per finding)
// ---------------------------------------------------------------------------------------------
const startOnly = (token, rowTo, extra = {}) => request('POST', '/api/imports/start', token, { fileName: 'f.csv', fileRows: rowTo, fileBytes: 100, rowFrom: 1, rowTo, consent: true, ...extra });

test('1. a batch can never go past the import\'s row range (rows per file can\'t be skipped)', async () => {
  const s = await startOnly('ci-manager', 1);
  const id = s.json.import.id;
  const two = await request('POST', `/api/imports/${id}/batch`, 'ci-manager', { rows: [{ row: 1, phone: '9876500001' }, { row: 2, phone: '9876500002' }] });
  assert.equal(two.status, 400);
  assert.match(two.json.error, /past the rows of this import/);
  assert.equal((await request('POST', `/api/imports/${id}/batch`, 'ci-manager', { rows: [{ row: 1, phone: '9876500001' }] })).status, 200);
  const more = await request('POST', `/api/imports/${id}/batch`, 'ci-manager', { rows: [{ row: 2, phone: '9876500002' }] });
  assert.equal(more.status, 400, 'the range is used up');
  assert.equal(db.whatsapp_leads.filter(l => l.import_id === id).length, 1);
});

test('2. parallel batches: one part at a time per import, counts added in the database', async () => {
  const s = await startOnly('ci-manager', 10);
  const id = s.json.import.id;
  const part = (n) => Array.from({ length: 3 }, (_, i) => ({ row: n * 3 + i + 1, phone: `98765${n}${i}000` }));
  slowInsertMs = 150;
  const [a, b] = await Promise.all([
    request('POST', `/api/imports/${id}/batch`, 'ci-manager', { rows: part(1) }),
    request('POST', `/api/imports/${id}/batch`, 'ci-manager', { rows: part(2) }),
  ]);
  slowInsertMs = 0;
  assert.deepEqual([a.status, b.status].sort(), [200, 409], 'the second part waits for the first');
  const imp = db.lead_imports.find(i => i.id === id);
  assert.equal(imp.batch_started_at, null, 'the part lock is released');
  assert.equal((await request('POST', `/api/imports/${id}/batch`, 'ci-manager', { rows: part(2) })).status, 200);
  assert.equal(imp.rows_done, 6);
  assert.equal(imp.created_count, 6, 'counts added, never lost');
  // A part left "in progress" (a crashed request) is released after 2 minutes.
  imp.batch_started_at = new Date(Date.now() - 60000).toISOString();
  assert.equal((await request('POST', `/api/imports/${id}/batch`, 'ci-manager', { rows: [{ row: 7, phone: '9876599990' }] })).status, 409);
  imp.batch_started_at = new Date(Date.now() - 3 * 60000).toISOString();
  assert.equal((await request('POST', `/api/imports/${id}/batch`, 'ci-manager', { rows: [{ row: 7, phone: '9876599990' }] })).status, 200);
  // The month's limit uses the counts in the database: 6 a month here.
  assert.equal(imp.created_count, 6, 'the 7th new person was over the month\'s limit');
});

test('3. Excel scientific notation: refused when Excel dropped digits; kept when every digit is there', () => {
  for (const cell of ['9.18765E+11', '9.87654E+9', '9.87654321E9']) {
    assert.match(li.cleanPhone(cell).error || '', /shortened by Excel/, cell);
  }
  assert.equal(li.cleanPhone('9.876543210E+9').phone, '919876543210');
  assert.equal(li.cleanPhone('9.18765432101E+11').phone, '918765432101');
});

test('10. two numbers with single spaces split; Excel date serials accepted for dates; size-limited parts', async () => {
  assert.deepEqual(li.cleanPhone('98765 43210 91234 56789'), { phone: '919876543210', more: ['919123456789'] });
  assert.deepEqual(li.cleanPhone('919876543210 919123456789'), { phone: '919876543210', more: ['919123456789'] });
  assert.ok(li.cleanPhone('98765 43210 91234 5678').error, 'not two clear numbers: still refused');
  assert.equal(cf.parseDate('45000'), '2023-03-15');
  assert.equal(cf.parseDate('45000.5'), '2023-03-15');
  assert.equal(cf.parseDate('742'), null, 'small numbers are not dates');
  const { splitParts } = await import('../src/importUtils.ts');
  const wide = { custom: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`c${i}`, 'x'.repeat(500)])) };
  const parts = splitParts(Array.from({ length: 500 }, () => wide), 500, 4 * 1024 * 1024);
  assert.ok(parts.length >= 4, `500 wide rows go in several parts (${parts.length})`);
  for (const p of parts) assert.ok(Buffer.byteLength(JSON.stringify(p)) <= 4 * 1024 * 1024);
  assert.equal(parts.flat().length, 500);
  assert.deepEqual(splitParts([1, 2, 3], 2, 1000).map(p => p.length), [2, 1], 'and never more than 500 rows');
});

test('10. extra numbers: the dry run warns when the field limit leaves no room for "Other numbers"', async () => {
  db.plans[0].max_custom_fields = 2; limits.clearCache();
  const r = await request('POST', '/api/imports/check', 'ci-manager', { rows: [{ row: 1, phone: '9876543210 / 9123456789' }] });
  assert.equal(r.status, 200, r.text);
  assert.match(r.json.warnings[0], /Only the first is imported/);
  db.plans[0].max_custom_fields = 10; limits.clearCache();
  const ok = await request('POST', '/api/imports/check', 'ci-manager', { rows: [{ row: 1, phone: '9876543210 / 9123456789' }] });
  assert.deepEqual(ok.json.warnings, []);
});

test('10. new fields: the import maps them by the server\'s answer, never a draft key taken meanwhile', async () => {
  // The browser drafted key "branch" for its new "Branch office" field, but "branch" is taken.
  const s = await startOnly('ci-manager', 1, { newFields: [{ key: 'branch', label: 'Branch office', type: 'text' }] });
  assert.equal(s.status, 200, s.text);
  assert.deepEqual(s.json.keyMap, { branch: 'branch_office' });
  // The dry run renames the draft key the same way, so the value is checked against the new field, not "Branch".
  const chk = await request('POST', '/api/imports/check', 'ci-owner', { rows: [{ row: 1, phone: '9876543210', custom: { branch: 'x' } }], newFields: [{ key: 'branch', label: 'Head office', type: 'number' }] });
  assert.equal(chk.json.results[0].kind, 'invalid', 'checked as the new number field');
});

test('4. Undo puts a value back only while it still holds what the import wrote (later edits and other imports stay)', async () => {
  const sun = (p) => db.whatsapp_leads.find(l => l.business_id === SUN && l.phone === p);
  sun('919000000001').assigned_to = 'manager@sunrise.test';
  const a = await runImport('ci-manager', [{ row: 1, phone: '919000000001', status: 'In discussion', custom: { cibil: '710' } }], { options: { mode: 'overwrite', tag: 'a' } });
  assert.equal(sun('919000000001').custom.cibil, 710);
  // The team moves the status on; a second import changes CIBIL again.
  sun('919000000001').stage = 'lost';
  const b = await runImport('ci-manager', [{ row: 1, phone: '919000000001', custom: { cibil: '720' } }], { options: { mode: 'overwrite', tag: 'b' } });
  assert.ok(b.id);
  const u = await request('POST', `/api/imports/${a.id}/undo`, 'ci-manager');
  assert.equal(u.status, 200, u.text);
  assert.equal(u.json.changedSince, 1, 'reported: kept 1 person changed after the import');
  const ravi = sun('919000000001');
  assert.equal(ravi.stage, 'lost', 'the team\'s later status stays');
  assert.equal(ravi.custom.cibil, 720, 'import B\'s value stays');
  assert.deepEqual(ravi.tags, ['vip', 'a', 'b'], 'tags changed since (import B added one): kept as they are');
  assert.deepEqual(li.undoSet({ tags: ['vip', 'a', 'x'] }, { before: { cols: { tags: ['vip'] } }, after: { cols: { tags: ['vip', 'a'] } } }), { set: {}, keptChanged: true });
  assert.deepEqual(li.undoSet({ tags: ['vip', 'a'] }, { before: { cols: { tags: ['vip'] } }, after: { cols: { tags: ['vip', 'a'] } } }), { set: { tags: ['vip'] }, keptChanged: false });
  assert.equal(db.lead_import_changes.filter(c => c.import_id === a.id).length, 0, 'undone: its old values are deleted');
});

test('5. Undo removes created people with all their data, keeps anyone in touch since; broadcasts count as contact', async () => {
  const { id } = await runImport('ci-manager', [{ row: 1, phone: '9876543201' }, { row: 2, phone: '9876543202' }, { row: 3, phone: '9876543203' }]);
  const sun = (p) => db.whatsapp_leads.find(l => l.business_id === SUN && l.phone === p);
  // 1: only an automatic event (no contact): removed with it. 2: got a broadcast: kept. 3: a note by the team: kept.
  db.contact_events = [{ business_id: SUN, phone: '919876543201', event_type: 'tag_added' }];
  db.campaign_recipients = [{ business_id: SUN, phone: '919876543202', status: 'sent' }];
  db.lead_notes = [{ business_id: SUN, phone: '919876543203', body: 'called' }];
  // A broadcast marks an imported person as contacted (they join the Inbox).
  await li.markContacted(SUN, '919876543202');
  assert.ok(sun('919876543202').last_contacted_at);
  assert.ok((await request('GET', '/api/inbox', 'ci-agent')).json.conversations.some(c => c.phone === '919876543202'));
  const before = sun('919000000001').last_contacted_at;
  await li.markContacted(SUN, '919000000001');
  assert.equal(sun('919000000001').last_contacted_at, before, 'other people are not moved in the Inbox');
  const u = await request('POST', `/api/imports/${id}/undo`, 'ci-manager');
  assert.deepEqual([u.json.removed, u.json.kept], [1, 2]);
  assert.equal(sun('919876543201'), undefined);
  assert.equal(db.contact_events.length, 0, 'its data went with it');
  assert.ok(sun('919876543202') && sun('919876543203'));
});

test('6. after 7 days the worker deletes the Undo data and the import can\'t be undone', async () => {
  const { id } = await runImport('ci-manager', [{ row: 1, phone: '919000000001', custom: { cibil: '700' } }], { options: { mode: 'overwrite' } });
  assert.equal(db.lead_import_changes.filter(c => c.import_id === id).length, 1);
  assert.equal(await li.pruneUndo(), 0, 'not yet');
  db.lead_imports.find(i => i.id === id).created_at = new Date(Date.now() - 8 * 86400000).toISOString();
  assert.equal(await li.pruneUndo(), 1);
  assert.equal(db.lead_import_changes.filter(c => c.import_id === id).length, 0);
  const list = await request('GET', '/api/imports', 'ci-manager');
  assert.equal(list.json.imports.find(i => i.id === id).canUndo, false);
  const { runWorker } = require('../netlify/functions/broadcast-worker.cjs');
  let pruned = false;
  await runWorker({ hourly: true, tasks: { enforceBilling: async () => 0, autoCloseQueries: async () => 0, prune: async () => 0, signupPrune: async () => 0, importUndoPrune: async () => { pruned = true; return 0; }, maintenanceState: async () => ({ on: true }) } });
  assert.ok(pruned, 'the hourly worker run prunes');
});

test('7. an imported person\'s first message is a new chat; a second one is not', () => {
  const { isNewChat } = require('../server/webhook.cjs');
  assert.equal(isNewChat({ ok: true, lead: null }), true);
  assert.equal(isNewChat({ ok: true, lead: { imported_at: NOW(), last_contacted_at: null } }), true);
  assert.equal(isNewChat({ ok: true, lead: { imported_at: NOW(), last_contacted_at: NOW() } }), false);
  assert.equal(isNewChat({ ok: true, lead: { imported_at: null, last_contacted_at: null } }), false);
  assert.equal(isNewChat({ ok: false, lead: null }), false);
});

test('8. statuses set by an import: status history (source import) and the change time; never a booking for Meta', async () => {
  const { id } = await runImport('ci-manager', [
    { row: 1, phone: '919000000001', status: 'In discussion' },
    { row: 2, phone: '9876543299', status: 'Booked' },
  ], { options: { mode: 'overwrite' } });
  assert.ok(id);
  const hist = db.lead_status_history || [];
  const ravi = hist.find(h => h.phone === '919000000001');
  assert.equal(ravi.source, 'import');
  assert.equal(ravi.from_key, 'new');
  assert.equal(ravi.changed_by, 'manager@sunrise.test');
  assert.ok(hist.find(h => h.phone === '919876543299' && h.from_key === null && h.source === 'import'));
  assert.ok(db.whatsapp_leads.find(l => l.business_id === SUN && l.phone === '919000000001').stage_changed_at);
  assert.equal((db.ad_conversions || []).length, 0, 'nothing sent to Meta');
});

// ---------------------------------------------------------------------------------------------
// Part 3: the migration (PGlite)
// ---------------------------------------------------------------------------------------------
test('SQL 20261142: server-only tables, safe to re-run, plan limits, the custom size cap, one running import', async () => {
  const { freshDb, migrationSql, asUser } = require('./helpers/pgHarness.cjs');
  const pg = await freshDb();
  await pg.exec(migrationSql('20261142_customer_import.sql')); // twice in a row is fine
  const plans = Object.fromEntries((await pg.query('select id, max_custom_fields, max_import_rows_per_file, max_import_file_mb, max_import_rows_month from public.plans')).rows.map(r => [r.id, r]));
  assert.deepEqual([plans.starter.max_import_rows_per_file, plans.growth.max_import_rows_per_file, plans.pro.max_import_rows_per_file], [2000, 10000, 25000]);
  assert.deepEqual([plans.starter.max_custom_fields, plans.growth.max_custom_fields, plans.pro.max_custom_fields], [10, 25, 50]);
  assert.deepEqual([plans.starter.max_import_rows_month, plans.pro.max_import_file_mb], [5000, 10]);
  // A console edit survives a re-run.
  await pg.query("update public.plans set max_custom_fields = 7 where id = 'starter'");
  await pg.exec(migrationSql('20261142_customer_import.sql'));
  assert.equal((await pg.query("select max_custom_fields from public.plans where id = 'starter'")).rows[0].max_custom_fields, 7);
  // Browsers can't read the new tables.
  const user = (await pg.query("insert into auth.users (email) values ('x@y.test') returning id")).rows[0].id;
  for (const t of ['lead_custom_fields', 'lead_imports', 'lead_import_changes']) {
    await assert.rejects(asUser(pg, user, () => pg.query(`select * from public.${t}`)), /permission denied/, t);
  }
  // The custom JSON is capped.
  const biz = (await pg.query("insert into public.businesses (name, slug) values ('Biz CI', 'biz-ci') returning id")).rows[0].id;
  await pg.query("insert into public.whatsapp_leads (business_id, phone, custom) values ($1, '919000000001', '{\"a\": 1}')", [biz]);
  await assert.rejects(pg.query("update public.whatsapp_leads set custom = jsonb_build_object('a', repeat('x', 9500)) where business_id = $1", [biz]), /custom_check/);
  await assert.rejects(pg.query("update public.whatsapp_leads set custom = '[1]' where business_id = $1", [biz]), /custom_check/);
  // One running import per business; consent is required.
  const ins = (status) => pg.query("insert into public.lead_imports (business_id, file_name, file_rows, row_from, row_to, consent, created_by, status) values ($1, 'f.csv', 1, 1, 1, true, 'm@x.test', $2)", [biz, status]);
  await ins('running');
  await assert.rejects(ins('running'), /lead_imports_one_running/);
  await ins('done');
  // One part at a time, inside the row range; counts added in the database; browsers can't call these.
  const imp = (await pg.query("insert into public.lead_imports (business_id, file_name, file_rows, row_from, row_to, consent, created_by, status) values ($1, 'g.csv', 10, 1, 4, true, 'm@x.test', 'done') returning id", [biz])).rows[0].id;
  await pg.query("update public.lead_imports set status = 'stopped' where business_id = $1 and status = 'running'", [biz]);
  await pg.query("update public.lead_imports set status = 'running' where id = $1", [imp]);
  const claim = async (n) => (await pg.query('select * from public.lead_import_claim_batch($1, $2, $3)', [biz, imp, n])).rows.length;
  assert.equal(await claim(5), 0, 'past the 4-row range');
  assert.equal(await claim(3), 1);
  assert.equal(await claim(1), 0, 'a part is already being saved');
  await pg.query('select * from public.lead_import_end_batch($1, $2, 3, 2, 1, 0, 0)', [biz, imp]);
  assert.equal(await claim(2), 0, '3 done + 2 > 4');
  assert.equal(await claim(1), 1);
  await pg.query('select * from public.lead_import_end_batch($1, $2, 1, 1, 0, 0, 0)', [biz, imp]);
  const row = (await pg.query('select rows_done, created_count, updated_count, batch_started_at from public.lead_imports where id = $1', [imp])).rows[0];
  assert.deepEqual([row.rows_done, row.created_count, row.updated_count, row.batch_started_at], [4, 3, 1, null]);
  await assert.rejects(asUser(pg, user, () => pg.query('select * from public.lead_import_claim_batch($1, $2, 1)', [biz, imp])), /permission denied/);
  await pg.query("insert into public.lead_status_history (business_id, phone, to_key, to_type, source) values ($1, '919000000001', 'new', 'new', 'import')", [biz]);
  await assert.rejects(pg.query("insert into public.lead_imports (business_id, file_name, file_rows, row_from, row_to, consent, created_by) values ($1, 'f.csv', 1, 1, 1, false, 'm@x.test')", [biz]), /check/);
});
