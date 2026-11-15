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
/** jsonb ordering, as Postgres does it: object > array > boolean > number > string > null. */
function jsonbCmp(x, y) {
  const rank = (v) => (v === null || v === undefined ? 0 : typeof v === 'string' ? 1 : typeof v === 'number' ? 2 : typeof v === 'boolean' ? 3 : Array.isArray(v) ? 4 : 5);
  const rx = rank(x), ry = rank(y);
  if (rx !== ry) return rx - ry;
  if (rx === 2 || rx === 3) return Number(x) - Number(y);
  return String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0;
}
/** custom->key (jsonb) / custom->>key (text) conditions, the way PostgREST turns them into SQL. */
function pathCond(r, col, op, key, v) {
  const val = (r[col] || {})[key];
  if (val === undefined || val === null) return false;
  const i = v.indexOf('.');
  const how = v.slice(0, i), arg = decodeURIComponent(v.slice(i + 1));
  if (op === '->') {
    const c = jsonbCmp(val, JSON.parse(arg));
    return how === 'gte' ? c >= 0 : how === 'lte' ? c <= 0 : how === 'eq' ? c === 0 : how === 'gt' ? c > 0 : how === 'lt' ? c < 0 : false;
  }
  const text = typeof val === 'string' ? val : JSON.stringify(val);
  if (how === 'gte') return text >= arg;
  if (how === 'lte') return text <= arg;
  if (how === 'eq') return text === arg;
  if (how === 'in') return arg.slice(1, -1).split(',').map(x => x.replace(/^"|"$/g, '')).includes(text);
  if (how === 'ilike') return text.toLowerCase().includes(arg.replace(/^\*|\*$/g, '').toLowerCase());
  return false;
}
/** One PostgREST condition ("col=op.value" or "col.op.value" inside or=()). */
function cond(r, k, v) {
  const path = k.match(/^(\w+)(->>|->)(\w+)$/);
  if (path) return pathCond(r, path[1], path[2], path[3], v);
  if (v.startsWith('cs.{') && r[k] && typeof r[k] === 'object' && !Array.isArray(r[k])) {
    const want = JSON.parse(decodeURIComponent(v.slice(3)));
    return Object.entries(want).every(([a, b]) => r[k][a] === b);
  }
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
    // agent: false = a fresh connection each time (a kept-alive socket the server just closed gives ECONNRESET under load).
    const req = http.request(`${base}${path}`, { method, agent: false, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } },
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

// ---------------------------------------------------------------------------------------------
// Part 5: D3 (matching, existing vs new, import owner) + D4 (filters, audiences, export, Pipeline cards)
// ---------------------------------------------------------------------------------------------
/** More fields for SUN: loan type (choice), EMI date, KYC (yes/no). */
function moreFields() {
  db.lead_custom_fields.push(
    { business_id: SUN, key: 'loan_type', label: 'Loan type', type: 'choice', options: ['Home', 'Car'], private: false, hidden: false, sort_order: 3, created_at: NOW() },
    { business_id: SUN, key: 'emi', label: 'EMI date', type: 'date', options: [], private: false, hidden: false, sort_order: 4, created_at: NOW() },
    { business_id: SUN, key: 'kyc', label: 'KYC done', type: 'yesno', options: [], private: false, hidden: false, sort_order: 5, created_at: NOW() },
  );
  const lead = (phone, custom) => db.whatsapp_leads.push({ business_id: SUN, phone, name: phone, stage: 'new', source: 'Imported', tags: [], custom, opted_out: false, last_contacted_at: NOW(), created_at: NOW() });
  lead('919100000001', { cibil: 1000, branch: 'Guntur', loan_type: 'Home', emi: '2026-01-05', kyc: true });
  lead('919100000002', { cibil: 760, branch: 'Vizag', loan_type: 'Car', emi: '2099-01-05', kyc: false });
  lead('919100000003', { cibil: 'high', branch: 'Guntur East' }); // a string never counts as a number
  db.plans[0].max_custom_fields = 20;
  cf.clearCache(); limits.clearCache();
}

test('D4 filters: checked against the fields; private ones refused for agents; parts use jsonb numbers, dates, the GIN index', () => {
  const F = [...FIELDS, { key: 'loan_type', label: 'Loan type', type: 'choice', options: ['Home', 'Car'], private: false, hidden: false, sort_order: 4 },
    { key: 'emi', label: 'EMI date', type: 'date', options: [], private: false, hidden: false, sort_order: 5 }, { key: 'kyc', label: 'KYC', type: 'yesno', options: [], private: false, hidden: false, sort_order: 6 }];
  assert.equal(cf.cleanCustomFilters(F, [{ key: 'cibil', min: 750 }], { seesPrivate: false }).status, 403, 'private: managers only');
  assert.ok(cf.cleanCustomFilters(F, [{ key: 'cibil', min: 750 }], { seesPrivate: true }).filters);
  assert.equal(cf.cleanCustomFilters(F, [{ key: 'nope' }], { seesPrivate: true }).status, 400);
  assert.equal(cf.cleanCustomFilters(F, [{ key: 'cibil', min: 'lots' }], { seesPrivate: true }).status, 400);
  assert.equal(cf.cleanCustomFilters(F, [{ key: 'loan_type', values: ['Boat'] }], { seesPrivate: true }).status, 400);
  assert.equal(cf.cleanCustomFilters(F, [{ key: 'branch', contains: 'gun' }], { seesPrivate: false, allowText: false }).status, 400, 'no free text in the Inbox address');
  assert.equal(cf.cleanCustomFilters(F, Array.from({ length: 11 }, () => ({ key: 'branch', contains: 'x' })), { seesPrivate: true }).status, 400);
  assert.equal(cf.cleanCustomFilters(F, 'not json', { seesPrivate: true }).status, 400);
  const c = cf.cleanCustomFilters(F, [
    { key: 'cibil', min: '750' }, { key: 'cibil', max: '900' }, { key: 'emi', from: '05/01/2026', to: '2026-02-01' },
    { key: 'loan_type', values: ['home'] }, { key: 'kyc', value: true }, { key: 'branch', contains: 'Gun*(' },
  ], { seesPrivate: true });
  assert.deepEqual(cf.customFilterParts(c.filters), [
    'custom->cibil=gte.750',
    'custom->cibil=gte.-1000000000000000', 'custom->cibil=lte.900', // "at most" still needs a number
    'custom->>emi=gte.2026-01-05', 'custom->>emi=lte.2026-02-01',
    `custom=cs.${encodeURIComponent('{"loan_type":"Home"}')}`,
    `custom=cs.${encodeURIComponent('{"kyc":true}')}`,
    `custom->>branch=ilike.${encodeURIComponent('*Gun*')}`,
  ]);
  // Date presets (India days): Saturday 2026-11-14.
  const sat = Date.parse('2026-11-14T06:00:00Z');
  assert.deepEqual(cf.presetRange('this_week', sat), { from: '2026-11-09', to: '2026-11-15' });
  assert.deepEqual(cf.presetRange('next_7', sat), { from: '2026-11-14', to: '2026-11-20' });
  assert.deepEqual(cf.presetRange('overdue', sat), { to: '2026-11-13' });
});

test('D4 Leads + Inbox: custom-field filters work on numbers (not text), dates, choices, yes/no; agents never filter by private fields', async () => {
  moreFields();
  const search = (filters, token = 'ci-manager') => request('POST', '/api/leads/search', token, { filters });
  const phones = (r) => r.json.leads.map(l => l.phone).sort();
  const cibil = await search({ custom: [{ key: 'cibil', min: 750 }] });
  assert.equal(cibil.status, 200, cibil.text);
  assert.deepEqual(phones(cibil), ['919100000001', '919100000002'], '1000 >= 750 (a text compare would say no); "high" is not a number');
  assert.deepEqual(phones(await search({ custom: [{ key: 'cibil', max: 800 }] })), ['919000000001', '919100000002'], '742 and 760; not "high"');
  assert.deepEqual(phones(await search({ custom: [{ key: 'loan_type', values: ['Car'] }, { key: 'kyc', value: false }] })), ['919100000002'], 'AND-ed');
  assert.deepEqual(phones(await search({ custom: [{ key: 'emi', preset: 'overdue' }] })), ['919100000001']);
  assert.deepEqual(phones(await search({ custom: [{ key: 'branch', contains: 'guntur' }] })), ['919000000001', '919100000001', '919100000003']);
  // Inbox: agents filter by normal fields only; private ones are refused by the server; no free text.
  // (POST /api/inbox/list: customer-field filters travel in the body, never the address.)
  const inbox = (custom, token) => request('POST', '/api/inbox/list', token, { filter: 'all', custom });
  // The address never carries them: a GET with custom= is answered unfiltered (and never refused, so nothing leaks either way).
  const viaGet = await request('GET', `/api/inbox?custom=${encodeURIComponent(JSON.stringify([{ key: 'cibil', min: 750 }]))}`, 'ci-agent');
  assert.equal(viaGet.status, 200);
  assert.ok(viaGet.json.conversations.length > 1, 'custom= in the address is ignored');
  const kyc = await inbox([{ key: 'kyc', value: true }], 'ci-agent');
  assert.equal(kyc.status, 200, kyc.text);
  assert.deepEqual(kyc.json.conversations.map(c => c.phone), ['919100000001']);
  const priv = await inbox([{ key: 'cibil', min: 750 }], 'ci-agent');
  assert.equal(priv.status, 403);
  assert.match(priv.json.error, /private/);
  assert.equal((await inbox([{ key: 'cibil', min: 750 }], 'ci-manager')).status, 200, 'managers may');
  assert.equal((await inbox([{ key: 'branch', contains: 'g' }], 'ci-manager')).status, 400);
  // Another business's fields can't be used.
  assert.equal((await request('POST', '/api/leads/search', 'ci-lotus', { filters: { custom: [{ key: 'cibil', min: 1 }] } })).status, 400);
});

test('D4 broadcast audiences: count by customer fields, STOP excluded, private fields fine for managers', async () => {
  moreFields();
  db.whatsapp_leads.find(l => l.phone === '919100000002').opted_out = true;
  const preview = (custom) => request('POST', '/api/audience/preview', 'ci-manager', { segment: { mode: 'filter', custom } });
  const r = await preview([{ key: 'cibil', min: 750 }]);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.json.count, r.json.optedOutExcluded], [1, 1]);
  assert.equal((await preview([{ key: 'nope', min: 1 }])).status, 400);
  assert.equal((await request('POST', '/api/audience/preview', 'ci-agent', { segment: { mode: 'filter' } })).status, 403);
});

test('D4 export: customer fields as columns; private ones only for the Business Admin; audited without the data', async () => {
  const csvOf = (r) => r.text.replace(/^﻿/, '').trim().split('\r\n');
  const m = await request('POST', '/api/leads/export', 'ci-manager', { phones: ['919000000001'], columns: ['phone'], customFields: true });
  assert.equal(m.status, 200, m.text);
  assert.deepEqual(csvOf(m), ['Phone,Branch', "'+919000000001,Guntur"], 'no private CIBIL column for a manager');
  assert.equal((await request('POST', '/api/leads/export', 'ci-manager', { phones: ['919000000001'], columns: ['phone'], includePrivate: true })).status, 403);
  const o = await request('POST', '/api/leads/export', 'ci-owner', { phones: ['919000000001'], columns: ['phone'], includePrivate: true });
  assert.deepEqual(csvOf(o), ['Phone,CIBIL score,Branch', "'+919000000001,742,Guntur"]);
  const a = db.audit_log.filter(x => x.action === 'leads.exported');
  assert.deepEqual(a.map(x => [x.details.customFields, x.details.privateFields]), [[1, 0], [2, 1]]);
  assert.ok(!JSON.stringify(a).includes('742') && !JSON.stringify(a).includes('Guntur'));
  // A formula in a custom value is guarded.
  db.whatsapp_leads.find(l => l.phone === '919000000001').custom.branch = '=HYPERLINK("x")';
  const g = await request('POST', '/api/leads/export', 'ci-manager', { phones: ['919000000001'], columns: ['phone'], customFields: true });
  assert.ok(csvOf(g)[1].includes(`'=HYPERLINK`));
});

test('D4 Pipeline cards: up to 2 chosen fields; private ones only for managers; set by managers', async () => {
  assert.equal((await request('PATCH', '/api/customer-fields/cibil', 'ci-agent', { showOnCard: true })).status, 403);
  assert.equal((await request('PATCH', '/api/customer-fields/cibil', 'ci-manager', { showOnCard: true })).status, 200);
  assert.equal((await request('PATCH', '/api/customer-fields/branch', 'ci-manager', { showOnCard: true })).status, 200);
  db.lead_custom_fields.push({ business_id: SUN, key: 'extra', label: 'Extra', type: 'text', options: [], private: false, hidden: false, sort_order: 9, created_at: NOW() });
  cf.clearCache();
  const third = await request('PATCH', '/api/customer-fields/extra', 'ci-manager', { showOnCard: true });
  assert.equal(third.status, 400);
  assert.match(third.json.error, /At most 2/);
  const asAgent = await request('GET', '/api/pipeline', 'ci-agent');
  assert.deepEqual(asAgent.json.cards['919000000001'], [{ label: 'Branch', type: 'text', value: 'Guntur' }]);
  assert.ok(!JSON.stringify(asAgent.json.cards).includes('742'), 'no private value on an agent\'s board');
  const asManager = await request('GET', '/api/pipeline', 'ci-manager');
  assert.deepEqual(asManager.json.cards['919000000001'].map(c => c.value), [742, 'Guntur']);
});

test('D3 badge: "Imported customer · <tag>" on the Inbox, the chat, the Pipeline and Leads; never another business\'s import name', async () => {
  const { id } = await runImport('ci-manager', [{ row: 1, phone: '9876500111', name: 'Asha' }], { options: { mode: 'fill', tag: 'Loans Nov' } });
  const asha = db.whatsapp_leads.find(l => l.business_id === SUN && l.phone === '919876500111');
  asha.last_contacted_at = NOW();
  const inbox = await request('GET', '/api/inbox', 'ci-agent');
  assert.equal(inbox.json.conversations.find(c => c.phone === '919876500111').import_name, 'loans-nov');
  const chat = await request('GET', '/api/inbox/919876500111', 'ci-agent');
  assert.equal(chat.json.contact.import_name, 'loans-nov');
  const pipe = await request('GET', '/api/pipeline', 'ci-agent');
  assert.ok(JSON.stringify(pipe.json).includes('"import_name":"loans-nov"'));
  const leads = await request('POST', '/api/leads/search', 'ci-manager', { filters: {} });
  assert.equal(leads.json.leads.find(l => l.phone === '919876500111').import_name, 'loans-nov');
  // A lead pointing at another business's import never shows that import's name.
  db.lead_imports.push({ id: 'e0000000-0000-4000-8000-000000000009', business_id: LOTUS, file_name: 'lotus-secret.csv', options: { tag: 'lotus-vip' }, status: 'done' });
  asha.import_id = 'e0000000-0000-4000-8000-000000000009';
  const again = await request('GET', '/api/inbox', 'ci-agent');
  assert.equal(again.json.conversations.find(c => c.phone === '919876500111').import_name, 'an import');
  assert.ok(!again.text.includes('lotus'));
  assert.ok(id);
});

test('D3 first message after an import: a timeline note once; the import\'s owner kept only when the option is on and they can take it', async () => {
  const before = { phone: '919876500222', imported_at: NOW(), import_id: null, last_inbound_at: null, assigned_to: 'agent@sunrise.test' };
  db.whatsapp_leads.push({ business_id: SUN, ...before, stage: 'new', custom: {} });
  db.lead_assignment_settings = [{ business_id: SUN, mode: 'round_robin', import_owner_first: false }];
  db.lead_assignment_members = [{ business_id: SUN, email: 'agent@sunrise.test', phone_number_id: '', sort_order: 1 }];
  // Off: the owner from the import keeps it; one note.
  let r = await li.onFirstMessage(SUN, '919876500222', before, {});
  assert.deepEqual(r, { note: true, owner: 'none' });
  assert.equal((db.lead_notes || []).filter(n => n.phone === '919876500222').length, 1);
  assert.match(db.lead_notes.find(n => n.phone === '919876500222').body, /First message after import/);
  r = await li.onFirstMessage(SUN, '919876500222', before, {});
  assert.equal(r.note, false, 'once only');
  assert.equal(db.lead_notes.filter(n => n.phone === '919876500222').length, 1);
  // On + the agent is away: released for the usual assignment, with a note saying why.
  const lead = db.whatsapp_leads.find(l => l.phone === '919876500222');
  lead.import_note_at = null;
  db.lead_assignment_settings[0].import_owner_first = true;
  db.staff_availability = [{ business_id: SUN, email: 'agent@sunrise.test', available: false }];
  r = await li.onFirstMessage(SUN, '919876500222', before, {});
  assert.equal(r.owner, 'released');
  assert.equal(lead.assigned_to, null);
  assert.match(db.lead_notes.at(-1).body, /can't take it now/);
  // On + available: kept.
  lead.assigned_to = 'agent@sunrise.test'; lead.import_note_at = null;
  db.staff_availability = [];
  r = await li.onFirstMessage(SUN, '919876500222', before, {});
  assert.equal(r.owner, 'kept');
  assert.equal(lead.assigned_to, 'agent@sunrise.test');
  // Not imported, or written before: nothing.
  assert.deepEqual(await li.onFirstMessage(SUN, '919000000001', { phone: '919000000001', imported_at: null }, {}), { note: false, owner: 'none' });
  assert.deepEqual(await li.onFirstMessage(SUN, '919876500222', { ...before, last_inbound_at: NOW() }, {}), { note: false, owner: 'none' });
  // The setting is saved by managers only and shown on the Lead assignment page.
  assert.equal((await request('PUT', '/api/lead-assignment', 'ci-agent', { importOwnerFirst: true })).status, 403);
});

test('D3 existing customers vs new people: per ad (funnel + CSV) and in Analytics; imported people are not "new leads"', () => {
  const { buildFunnel, csvOf, isExistingCustomer } = require('../server/adsFunnel.cjs');
  const { importSplit } = require('../server/analytics.cjs');
  const from = '2026-11-01T00:00:00.000Z', to = '2026-11-30T00:00:00.000Z';
  const insights = [{ date: '2026-11-05', ad_id: '11', ad_name: 'Loan ad', adset_id: '22', adset_name: 'Set', campaign_id: '33', campaign_name: 'Loans', spend: 100, impressions: 1000, clicks: 50, conversations: 3 }];
  const leads = [
    { phone: '1', stage: 'new', first_ad_id: '11', first_ad_at: '2026-11-05T10:00:00Z', imported_at: '2026-10-01T00:00:00Z' }, // existing
    { phone: '2', stage: 'new', first_ad_id: '11', first_ad_at: '2026-11-06T10:00:00Z', imported_at: '2026-11-07T00:00:00Z' }, // imported AFTER the chat: new
    { phone: '3', stage: 'new', first_ad_id: '11', first_ad_at: '2026-11-07T10:00:00Z' },                                       // new
  ];
  assert.equal(isExistingCustomer(leads[0], leads[0].first_ad_at), true);
  assert.equal(isExistingCustomer(leads[1], leads[1].first_ad_at), false);
  const f = buildFunnel({ insights, leads, statuses: ls.template('general'), from, to });
  assert.deepEqual([f.totals.chats, f.totals.existing, f.totals.newPeople, f.totals.existingShare], [3, 1, 2, 33.3]);
  const ad = f.campaigns[0].adsets[0].ads[0];
  assert.deepEqual([ad.existing, ad.newPeople], [1, 2]);
  const csv = csvOf(f).split('\r\n');
  assert.ok(csv[0].includes('Existing customers,New people,Existing customers %'));
  assert.ok(csv[1].startsWith('Campaign,Loans,,,100,1000,50,3,3,1,2,33.3'), csv[1]);
  const split = importSplit([...leads, { phone: '4', imported_at: '2026-11-08T00:00:00Z' }], from);
  assert.deepEqual(split, { importedPeople: 2, adChatsExisting: 1, adChatsNew: 2 });
});

test('SQL 20261143: show_on_card, import_owner_first, import_note_at; safe to re-run; jsonb compares numbers as numbers', async () => {
  const { freshDb, migrationSql } = require('./helpers/pgHarness.cjs');
  const pg = await freshDb();
  await pg.exec(migrationSql('20261143_customer_import_d3d4.sql'));
  const cols = (await pg.query("select table_name, column_name from information_schema.columns where column_name in ('show_on_card', 'import_owner_first', 'import_note_at') order by 1, 2")).rows.map(r => `${r.table_name}.${r.column_name}`);
  assert.deepEqual(cols, ['lead_assignment_settings.import_owner_first', 'lead_custom_fields.show_on_card', 'whatsapp_leads.import_note_at']);
  // What PostgREST runs for custom->cibil=gte.750: jsonb against jsonb; numbers by value, strings never match.
  const biz = (await pg.query("insert into public.businesses (name, slug) values ('Jsonb Biz', 'jsonb-biz') returning id")).rows[0].id;
  for (const [p, c] of [['919000000001', '{"cibil": 1000}'], ['919000000002', '{"cibil": 742}'], ['919000000003', '{"cibil": "800"}']]) {
    await pg.query('insert into public.whatsapp_leads (business_id, phone, custom) values ($1, $2, $3::jsonb)', [biz, p, c]);
  }
  const hit = (await pg.query("select phone from public.whatsapp_leads where business_id = $1 and custom->'cibil' >= '750' and custom->'cibil' >= '-1000000000000000' order by phone", [biz])).rows.map(r => r.phone);
  assert.deepEqual(hit, ['919000000001'], '1000 matches (text order would not), "800" is text and never matches');
  const cs = (await pg.query(`select count(*)::int as n from public.whatsapp_leads where business_id = $1 and custom @> '{"cibil": 742}'`, [biz])).rows[0].n;
  assert.equal(cs, 1);
});

// ---------------------------------------------------------------------------------------------
// Part 6: second review of D3 + D4
// ---------------------------------------------------------------------------------------------
test('review: hidden fields can\'t be used as filters by anyone (Leads, Inbox, audiences)', async () => {
  moreFields();
  db.lead_custom_fields.find(f => f.business_id === SUN && f.key === 'kyc').hidden = true;
  cf.clearCache();
  const F = [{ key: 'kyc', label: 'KYC done', type: 'yesno', options: [], private: false, hidden: true, sort_order: 1 }];
  assert.equal(cf.cleanCustomFilters(F, [{ key: 'kyc', value: true }], { seesPrivate: true }).status, 400);
  const custom = [{ key: 'kyc', value: true }];
  assert.equal((await request('POST', '/api/inbox/list', 'ci-agent', { custom })).status, 400, 'agent, Inbox');
  assert.equal((await request('POST', '/api/inbox/list', 'ci-manager', { custom })).status, 400, 'manager, Inbox');
  const leads = await request('POST', '/api/leads/search', 'ci-owner', { filters: { custom } });
  assert.equal(leads.status, 400);
  assert.match(leads.json.error, /hidden/);
  assert.equal((await request('POST', '/api/audience/preview', 'ci-manager', { segment: { mode: 'filter', custom } })).status, 400);
});

test('review: with lead assignment Off, the import-owner switch never leaves a chat with nobody; the note says what happened', async () => {
  const before = { phone: '919876500333', imported_at: NOW(), import_id: null, last_inbound_at: null, assigned_to: 'agent@sunrise.test' };
  db.whatsapp_leads.push({ business_id: SUN, ...before, stage: 'new', custom: {} });
  db.lead_assignment_settings = [{ business_id: SUN, mode: 'off', import_owner_first: true }];
  db.staff_availability = [{ business_id: SUN, email: 'agent@sunrise.test', available: false }];
  const r = await li.onFirstMessage(SUN, '919876500333', before, {});
  assert.equal(r.owner, 'kept_assignment_off');
  assert.equal(db.whatsapp_leads.find(l => l.phone === '919876500333').assigned_to, 'agent@sunrise.test', 'not released: nobody would take it');
  const note = db.lead_notes.filter(n => n.phone === '919876500333').at(-1).body;
  assert.match(note, /stays with them because automatic lead assignment is off/);
  assert.doesNotMatch(note, /usual rules/);
  // With assignment on, it is released for the next person (and the note says so).
  const l = db.whatsapp_leads.find(x => x.phone === '919876500333');
  l.import_note_at = null;
  db.lead_assignment_settings[0].mode = 'round_robin';
  db.lead_assignment_members = [{ business_id: SUN, email: 'agent@sunrise.test', phone_number_id: '', sort_order: 1 }];
  const r2 = await li.onFirstMessage(SUN, '919876500333', before, {});
  assert.equal(r2.owner, 'released');
  assert.match(db.lead_notes.at(-1).body, /goes to the next person by lead assignment/);
});
