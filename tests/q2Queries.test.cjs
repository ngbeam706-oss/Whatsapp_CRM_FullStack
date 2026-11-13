// Q2: the query engine — stages, due times, ownership, escalation, team queries, Platform support,
// customer messages. Fake database (a small PostgREST imitation) + fake Meta. No network.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const BIZ = 'a0000000-0000-4000-8000-000000000001';
const OTHER = 'b0000000-0000-4000-8000-000000000002';

process.env.APP_SECRET = 'server_encryption_secret_long_enough';
process.env.WHATSAPP_TOKEN = '';
process.env.PHONE_NUMBER_ID = '';
process.env.VITE_SUPABASE_URL = 'http://fake.supabase';
process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
process.env.WHATSAPP_BUSINESS_ID = BIZ;

const secrets = require('../server/secrets.cjs');
const Q = require('../server/queries.cjs');
const whatsapp = require('../server/whatsapp.cjs');

// ---- people -------------------------------------------------------------------------------
const owner = { id: 'u0', email: 'owner@arogya.test', role: 'owner', businessId: BIZ };
const manager = { id: 'u1', email: 'manager@arogya.test', role: 'manager', businessId: BIZ };
const agent1 = { id: 'u2', email: 'agent1@arogya.test', role: 'agent', businessId: BIZ };
const agent2 = { id: 'u3', email: 'agent2@arogya.test', role: 'agent', businessId: BIZ };
const outsider = { id: 'u9', email: 'admin@mayura.test', role: 'owner', businessId: OTHER };
const platformAdmin = { id: 'p1', email: 'platform@crm.test' };

// ---- fake database ---------------------------------------------------------------------------
let db;
let sent;
let counters;
let seq;
function seed({ lastInboundHoursAgo = 1 } = {}) {
  db = {
    businesses: [{ id: BIZ, name: 'Arogya Ruchulu', status: 'active', query_due_hours: { urgent: 2, high: 8, normal: 24, low: 72 } }, { id: OTHER, name: 'Mayura', status: 'active' }],
    staff_members: [owner, manager, agent1, agent2].map(s => ({ business_id: BIZ, user_id: s.id, email: s.email, role: s.role })),
    whatsapp_leads: [{ business_id: BIZ, phone: '919000000001', name: 'Ravi', last_inbound_at: new Date(Date.now() - lastInboundHoursAgo * 3600000).toISOString(), opted_out: false }],
    business_whatsapp: [{ business_id: BIZ, phone_number: '919000000100', phone_number_id: '111', waba_id: '911', token_last4: '1234', access_token_enc: secrets.encrypt('EAAG-arogya-token-1234'), webhook_key: 'a'.repeat(32), graph_api_version: 'v26.0' }],
    queries: [], query_events: [], platform_queries: [], platform_query_events: [], whatsapp_messages: [], query_categories: [],
  };
  sent = [];
  counters = {};
  seq = 5000;
  whatsapp.clearCache();
}

const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
let idn = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++idn).padStart(12, '0')}`;

/** Very small PostgREST filter: eq, ilike (no wildcards), in, is, gte, lt, and or=(...). */
function matches(row, params) {
  const test1 = (col, op, val) => {
    const v = row[col];
    if (op === 'eq') return String(v) === val;
    if (op === 'ilike') return String(v || '').toLowerCase() === val.toLowerCase();
    if (op === 'in') return val.replace(/^\(|\)$/g, '').split(',').includes(String(v));
    if (op === 'is') return val === 'null' ? v === null || v === undefined : String(v) === val;
    if (op === 'gte') return v && v >= val;
    if (op === 'lt') return v && v < val;
    return true;
  };
  for (const [k, raw] of params) {
    if (['select', 'order', 'limit', 'on_conflict'].includes(k)) continue;
    if (k === 'or') {
      const parts = raw.replace(/^\(|\)$/g, '').split(',').map(p => p.split('.'));
      if (!parts.some(([c, op, ...rest]) => test1(c, op, rest.join('.')))) return false;
      continue;
    }
    const i = raw.indexOf('.');
    if (!test1(k, raw.slice(0, i), raw.slice(i + 1))) return false;
  }
  return true;
}

global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  const body = opts.body ? JSON.parse(opts.body) : null;
  if (u.startsWith('https://graph.facebook.com/')) {
    if (u.includes('/message_templates')) return json({ data: [] }); // no "query_update" template
    sent.push(body);
    return json({ messages: [{ id: `wamid.${sent.length}` }] });
  }
  const [path, qs = ''] = u.slice('http://fake.supabase/rest/v1/'.length).split('?');
  const params = [...new URLSearchParams(qs).entries()];
  if (path === 'rpc/next_query_number') {
    counters[body.p_business] = (counters[body.p_business] || 1000) + 1;
    return json(counters[body.p_business]);
  }
  if (path.startsWith('rpc/')) return json([]);
  const rows = db[path] || (db[path] = []);
  if (method === 'GET') {
    let out = rows.filter(r => matches(r, params));
    if (qs.includes('businesses(name)')) out = out.map(r => ({ ...r, businesses: { name: db.businesses.find(b => b.id === r.business_id)?.name } }));
    return json(out);
  }
  if (method === 'POST') {
    const list = (Array.isArray(body) ? body : [body]).map(r => ({ ...r }));
    for (const r of list) {
      if (path === 'queries') Object.assign(r, { id: uuid(), stage: 'new', escalation_level: 0, assigned_to: null, created_at: new Date().toISOString(), first_response_at: null, paused_at: null, resolved_at: null, closed_at: null }, r);
      if (path === 'platform_queries') Object.assign(r, { id: uuid(), number: ++seq, stage: 'new', created_at: new Date().toISOString() }, r);
      if (path.endsWith('_events')) r.id = rows.length + 1;
      rows.push(r);
    }
    return json(list, 201);
  }
  if (method === 'PATCH') { const hit = rows.filter(r => matches(r, params)); hit.forEach(r => Object.assign(r, body)); return json(hit); }
  return json([]);
};

beforeEach(() => seed());
const newCustomerQuery = (by = agent1, extra = {}) => Q.createQuery(BIZ, { kind: 'customer', contactPhone: '919000000001', subject: 'Order not delivered', category: 'Delivery', ...extra }, { staff: by });
const eventsOf = (id) => db.query_events.filter(e => e.query_id === id);

// ---- pure rules -------------------------------------------------------------------------------
test('stage moves: only sensible ones are allowed', () => {
  assert.ok(Q.canMove('new', 'in_progress'));
  assert.ok(Q.canMove('resolved', 'reopened'));
  assert.ok(Q.canMove('closed', 'reopened'));
  assert.ok(!Q.canMove('new', 'reopened'));
  assert.ok(!Q.canMove('closed', 'in_progress'));
});

test('due times follow the priority, and "waiting" stops the clock', () => {
  const t0 = new Date('2026-11-07T10:00:00Z');
  assert.strictEqual(Q.dueAt('urgent', t0), '2026-11-07T12:00:00.000Z');
  assert.strictEqual(Q.dueAt('low', t0, { low: 48 }), '2026-11-09T10:00:00.000Z');
  const q = { stage: 'waiting', paused_at: '2026-11-07T11:00:00.000Z', due_at: '2026-11-07T12:00:00.000Z' };
  const p = Q.stagePatch(q, 'in_progress', new Date('2026-11-07T14:00:00Z')); // waited 3 h
  assert.strictEqual(p.due_at, '2026-11-07T15:00:00.000Z');
  assert.strictEqual(p.paused_at, null);
  assert.strictEqual(Q.isOverdue({ stage: 'waiting', due_at: '2000-01-01T00:00:00Z' }), false, 'a waiting query is never overdue');
  assert.strictEqual(Q.isOverdue({ stage: 'in_progress', due_at: '2000-01-01T00:00:00Z' }), true);
  assert.strictEqual(Q.isOverdue({ stage: 'resolved', due_at: '2000-01-01T00:00:00Z' }), false);
});

// ---- customer queries ----------------------------------------------------------------------------
test('a customer query gets a number and a due time, and the customer is told on WhatsApp', async () => {
  const r = await newCustomerQuery();
  assert.ifError(r.error);
  assert.strictEqual(r.query.ref, 'Q-1001');
  assert.strictEqual(r.query.raised_by_email, 'agent1@arogya.test');
  const hours = (Date.parse(r.query.due_at) - Date.parse(r.query.created_at)) / 3600000;
  assert.ok(Math.abs(hours - 24) < 0.01);
  assert.strictEqual(sent.length, 1);
  assert.match(sent[0].text.body, /Q-1001.*registered/);
  assert.strictEqual(sent[0].to, '919000000001');
  assert.ok(eventsOf(r.query.id).some(e => e.type === 'created'));
});

test('outside the 24-hour window without a "query_update" template, the team gets a note instead', async () => {
  seed({ lastInboundHoursAgo: 30 });
  const r = await newCustomerQuery();
  assert.strictEqual(sent.length, 0);
  const note = eventsOf(r.query.id).find(e => e.type === 'note');
  assert.match(note.body, /query_update/);
  assert.strictEqual(note.visibility, 'handlers');
});

test('a customer query needs a known customer of this business', async () => {
  assert.match((await Q.createQuery(BIZ, { kind: 'customer', contactPhone: '919999999999', subject: 'x' }, { staff: agent1 })).error, /not in your contacts/);
  assert.match((await Q.createQuery(BIZ, { kind: 'customer', subject: 'x' }, { staff: agent1 })).error, /number/);
});

test('the first agent to work on it owns it; other agents can only view', async () => {
  const { query } = await newCustomerQuery(owner);
  assert.ifError((await Q.addComment(agent1, query.id, { body: 'Checking with the kitchen' })).error);
  assert.strictEqual(db.queries[0].assigned_to, 'agent1@arogya.test');
  assert.strictEqual(db.queries[0].stage, 'assigned');
  const r = await Q.addComment(agent2, query.id, { body: 'me too' });
  assert.strictEqual(r.status, 403);
  assert.match(r.error, /belongs to agent1/);
  // ...but agent2 still sees it in the list.
  assert.strictEqual((await Q.listQueries(agent2, { view: 'customer' })).queries.length, 1);
});

test('waiting on the customer pauses it; their reply on WhatsApp starts it again', async () => {
  const { query } = await newCustomerQuery();
  assert.ifError((await Q.updateQuery(agent1, query.id, { stage: 'waiting' })).error);
  assert.ok(db.queries[0].paused_at);
  assert.strictEqual(await Q.onCustomerMessage(BIZ, '919000000001'), 1);
  assert.strictEqual(db.queries[0].stage, 'in_progress');
  assert.strictEqual(db.queries[0].paused_at, null);
});

test('resolving tells the customer; "not solved" reopens it', async () => {
  const { query } = await newCustomerQuery();
  sent = [];
  assert.ifError((await Q.updateQuery(agent1, query.id, { stage: 'resolved' })).error);
  assert.match(sent[0].text.body, /resolved.*NOT SOLVED/s);
  const reopened = await Q.customerReopen(BIZ, '919000000001');
  assert.strictEqual(reopened.stage, 'reopened');
  assert.strictEqual(db.queries[0].resolved_at, null);
});

test('impossible stage moves are refused', async () => {
  const { query } = await newCustomerQuery();
  // (The agent's first action claims it, so it is "Assigned" by the time the move is checked.)
  assert.match((await Q.updateQuery(agent1, query.id, { stage: 'reopened' })).error, /can't go from Assigned to Reopened/);
  assert.match((await Q.updateQuery(owner, query.id, { stage: 'new' })).error, /can't go from Assigned to New/);
  assert.match((await Q.updateQuery(agent1, query.id, { stage: 'done' })).error, /Unknown stage/);
});

test('replies can go to the customer; internal notes never do', async () => {
  const { query } = await newCustomerQuery();
  sent = [];
  await Q.addComment(agent1, query.id, { body: 'Your order leaves in 10 minutes', toCustomer: true });
  await Q.addComment(agent1, query.id, { body: 'Kitchen was short-staffed', visibility: 'handlers', toCustomer: true });
  assert.strictEqual(sent.length, 1);
  assert.match(sent[0].text.body, /Q-1001.*10 minutes/);
  assert.deepStrictEqual(eventsOf(query.id).filter(e => !['created', 'assigned'].includes(e.type)).map(e => [e.type, e.visibility]), [['reply', 'all'], ['note', 'handlers']]);
});

test('escalation: agent -> managers -> Business Admin', async () => {
  const { query } = await newCustomerQuery();
  assert.ifError((await Q.escalate(agent1, query.id, 'Customer wants a refund')).error);
  assert.deepStrictEqual([db.queries[0].stage, db.queries[0].escalation_level, db.queries[0].assigned_to], ['escalated', 1, null]);
  assert.strictEqual((await Q.addComment(agent1, query.id, { body: 'x' })).status, 403, 'agents only view escalated queries');
  assert.ifError((await Q.escalate(manager, query.id)).error);
  assert.strictEqual(db.queries[0].escalation_level, 2);
  assert.strictEqual((await Q.updateQuery(manager, query.id, { stage: 'resolved' })).status, 403, 'level 2 is for the Business Admin');
  assert.ifError((await Q.updateQuery(owner, query.id, { stage: 'resolved' })).error);
  assert.match((await Q.escalate(owner, query.id)).error, /resolved or closed/);
});

// ---- team (internal) queries ------------------------------------------------------------------------
test('an agent raises a team query to managers; managers handle it, other agents can\'t see it', async () => {
  const r = await Q.createQuery(BIZ, { kind: 'internal', addressedTo: 'managers', subject: 'Refund approval for Ravi', category: 'Approval needed', contactPhone: '919000000001' }, { staff: agent1 });
  assert.ifError(r.error);
  assert.strictEqual(sent.length, 0, 'team queries never message the customer');
  const id = r.query.id;
  assert.strictEqual((await Q.listQueries(manager, { view: 'team' })).queries.length, 1);
  assert.strictEqual((await Q.listQueries(agent1, { view: 'team' })).queries.length, 1);
  assert.strictEqual((await Q.listQueries(agent2, { view: 'team' })).queries.length, 0);
  assert.strictEqual((await Q.getQueryDetail(agent2, id)).status, 404);

  // Manager adds a private note and asks the agent something.
  await Q.addComment(manager, id, { body: 'Check refund policy first', visibility: 'handlers' });
  await Q.addComment(manager, id, { body: 'How much was the order?' });
  await Q.updateQuery(manager, id, { stage: 'waiting' });
  const forAgent = await Q.getQueryDetail(agent1, id);
  assert.strictEqual(forAgent.access, 'requester');
  assert.ok(!forAgent.events.some(e => e.body === 'Check refund policy first'), 'the raiser does not see handler notes');
  assert.ok(forAgent.events.some(e => e.body === 'How much was the order?'));

  // The agent answers -> back to in progress; the manager resolves; the agent confirms and rates.
  await Q.addComment(agent1, id, { body: '₹450' });
  assert.strictEqual(db.queries[0].stage, 'in_progress');
  assert.strictEqual((await Q.updateQuery(agent1, id, { stage: 'resolved' })).status, 403, 'the raiser cannot resolve it');
  assert.ifError((await Q.updateQuery(manager, id, { stage: 'resolved' })).error);
  assert.ifError((await Q.updateQuery(agent1, id, { stage: 'closed' })).error);
  assert.ifError((await Q.rateQuery(agent1, id, { rating: 5 })).error);
  assert.strictEqual(db.queries[0].rating, 5);
  assert.strictEqual((await Q.rateQuery(manager, id, { rating: 1 })).status, 403);
});

test('who can raise a team query, and to whom', async () => {
  assert.match((await Q.createQuery(BIZ, { kind: 'internal', addressedTo: 'managers', subject: 'x' }, { staff: manager })).error, /Business Admin/);
  assert.match((await Q.createQuery(BIZ, { kind: 'internal', addressedTo: 'owner', subject: 'x' }, { staff: owner })).error, /Platform support/);
  assert.match((await Q.createQuery(BIZ, { kind: 'internal', addressedTo: 'team', subject: 'x' }, { staff: agent1 })).error, /Choose who/);
  assert.ifError((await Q.createQuery(BIZ, { kind: 'internal', addressedTo: 'owner', subject: 'Need broadcast access' }, { staff: agent1 })).error);
  assert.strictEqual((await Q.listQueries(manager, { view: 'team' })).queries.length, 0, 'a query to the Business Admin is not shown to managers');
  assert.strictEqual((await Q.listQueries(owner, { view: 'team' })).queries.length, 1);
});

test('team query escalation: managers -> Business Admin -> Platform support', async () => {
  const { query } = await Q.createQuery(BIZ, { kind: 'internal', addressedTo: 'managers', subject: 'Inbox is slow', category: 'App problem / bug' }, { staff: agent1 });
  assert.ifError((await Q.escalate(manager, query.id)).error);
  assert.strictEqual(db.queries[0].addressed_to, 'owner');
  assert.strictEqual((await Q.listQueries(manager, { view: 'team' })).queries.length, 0, 'now only the Business Admin sees it');
  const toPlatform = await Q.escalate(owner, query.id, 'Happens every afternoon');
  assert.ifError(toPlatform.error);
  assert.strictEqual(db.platform_queries.length, 1);
  assert.strictEqual(db.platform_queries[0].escalated_from, query.id);
  assert.strictEqual(db.platform_queries[0].category, 'App problem / bug');
  assert.match(eventsOf(query.id).find(e => e.type === 'escalated' && e.data.to === 'platform').body, /S-50\d\d/);
});

// ---- Platform support -------------------------------------------------------------------------------
test('any staff member can ask Platform support; the raiser and Business Admin follow it, others can\'t', async () => {
  const r = await Q.createPlatformQuery(agent2, { category: 'WhatsApp connection', subject: 'Messages not arriving', priority: 'high' });
  assert.ifError(r.error);
  assert.match(r.query.ref, /^S-50\d\d$/);
  assert.strictEqual((await Q.listPlatformQueriesForBusiness(agent2)).queries.length, 1);
  assert.strictEqual((await Q.listPlatformQueriesForBusiness(owner)).queries.length, 1);
  assert.strictEqual((await Q.listPlatformQueriesForBusiness(agent1)).queries.length, 0);
  assert.strictEqual((await Q.getPlatformQueryForBusiness(outsider, r.query.id)).status, 404);

  // Platform admin: a private note, a reply, resolve. The business sees the reply, not the note.
  await Q.platformUpdate(platformAdmin, r.query.id, { body: 'Their webhook was paused by Meta', visibility: 'platform' });
  await Q.platformUpdate(platformAdmin, r.query.id, { body: 'Fixed: please try again' });
  assert.ifError((await Q.platformUpdate(platformAdmin, r.query.id, { stage: 'resolved' })).error);
  const forBiz = await Q.getPlatformQueryForBusiness(agent2, r.query.id);
  assert.deepStrictEqual(forBiz.events.filter(e => e.type === 'comment').map(e => e.body), ['Fixed: please try again']);
  assert.ifError((await Q.businessActOnPlatformQuery(agent2, r.query.id, { stage: 'closed' })).error);
  assert.strictEqual(db.platform_queries[0].stage, 'closed');
});

// ---- other businesses, settings, worker -----------------------------------------------------------
test('staff of another business can\'t see or touch these queries', async () => {
  const { query } = await newCustomerQuery();
  assert.strictEqual((await Q.getQueryDetail(outsider, query.id)).status, 404);
  assert.strictEqual((await Q.updateQuery(outsider, query.id, { stage: 'closed' })).status, 404);
  assert.strictEqual((await Q.addComment(outsider, query.id, { body: 'hi' })).status, 404);
  assert.strictEqual((await Q.listQueries(outsider, { view: 'customer' })).queries.length, 0);
});

test('due hours are checked; resolved queries close themselves after 3 days', async () => {
  assert.match((await Q.saveDueHours(owner, { urgent: 10, high: 8, normal: 24, low: 72 })).error, /soonest/);
  assert.ifError((await Q.saveDueHours(owner, { urgent: 1, high: 4, normal: 12, low: 48 })).error);
  const { query } = await newCustomerQuery();
  await Q.updateQuery(agent1, query.id, { stage: 'resolved' });
  db.queries[0].resolved_at = new Date(Date.now() - 4 * 86400000).toISOString();
  assert.strictEqual(await Q.autoClose(), 1);
  assert.strictEqual(db.queries[0].stage, 'closed');
});
