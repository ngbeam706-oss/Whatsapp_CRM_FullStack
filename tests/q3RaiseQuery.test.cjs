// Q3: customers raise queries on WhatsApp (keyword/button -> category list -> description -> number),
// the AI's handover creates a query, and "NOT SOLVED" reopens one. Fake database + fake Meta.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const AROGYA = 'a0000000-0000-4000-8000-000000000001';
const BIZ = 'b0000000-0000-4000-8000-000000000002'; // a hospital using the starter bot

process.env.APP_SECRET = 'server_encryption_secret_long_enough';
process.env.WHATSAPP_TOKEN = '';
process.env.PHONE_NUMBER_ID = '';
process.env.VITE_SUPABASE_URL = 'http://fake.supabase';
process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
process.env.WHATSAPP_BUSINESS_ID = AROGYA;

const secrets = require('../server/secrets.cjs');
const whatsapp = require('../server/whatsapp.cjs');
const ai = require('../server/ai.cjs');
const queryBot = require('../server/queryBot.cjs');
const Q = require('../server/queries.cjs');
const { handleArogyaRuchuluBot } = require('../server/bot.cjs');

const PHONE = '919000000001';
const CATS = ['Appointment', 'Reports', 'Billing', 'Doctor / treatment', 'Complaint', 'Other'];
let db;
let sent;
let counter;
function seed() {
  db = {
    businesses: [{ id: BIZ, name: 'Mayura Hospitals', status: 'active', plan_id: 'pro', query_due_hours: { urgent: 2, high: 8, normal: 24, low: 72 } }],
    plans: [{ id: 'pro', name: 'Pro', ai_enabled: true, max_ai_replies_month: null }],
    business_whatsapp: [{ business_id: BIZ, phone_number: '919000000200', phone_number_id: '222', waba_id: '922', token_last4: '9876', access_token_enc: secrets.encrypt('EAAG-mayura-token-9876'), webhook_key: 'b'.repeat(32), graph_api_version: 'v26.0' }],
    whatsapp_leads: [{ business_id: BIZ, phone: PHONE, name: 'Ravi', last_inbound_at: new Date().toISOString() }],
    query_categories: CATS.map((name, i) => ({ business_id: BIZ, kind: 'customer', name, sort_order: i + 1, is_active: true })),
    ai_settings: [{ business_id: BIZ, auto_reply: false }],
    queries: [], query_events: [], contact_events: [], whatsapp_messages: [], whatsapp_bot_rules: [], whatsapp_catalog: [], lead_notes: [], usage_counters: [],
  };
  sent = [];
  counter = 1000;
  whatsapp.clearCache();
}

const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
let idn = 0;
function matches(row, params) {
  for (const [k, raw] of params) {
    if (['select', 'order', 'limit', 'on_conflict'].includes(k)) continue;
    const i = raw.indexOf('.');
    const op = raw.slice(0, i);
    const val = raw.slice(i + 1);
    const v = row[k];
    if (op === 'eq' && String(v) !== val) return false;
    if (op === 'in' && !val.replace(/^\(|\)$/g, '').split(',').includes(String(v))) return false;
    if (op === 'is' && !(val === 'null' ? v == null : String(v) === val)) return false;
    if (op === 'gte' && !(v && v >= val)) return false;
  }
  return true;
}
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  const body = opts.body ? JSON.parse(opts.body) : null;
  if (u.startsWith('https://graph.facebook.com/')) {
    if (u.includes('/message_templates')) return json({ data: [] });
    sent.push(body);
    return json({ messages: [{ id: `wamid.${sent.length}` }] });
  }
  const [path, qs = ''] = u.slice('http://fake.supabase/rest/v1/'.length).split('?');
  const params = [...new URLSearchParams(qs).entries()];
  if (path === 'rpc/next_query_number') return json(++counter);
  if (path.startsWith('rpc/')) return json([]);
  const rows = db[path] || (db[path] = []);
  if (method === 'GET') {
    let out = rows.filter(r => matches(r, params));
    const order = params.find(([k]) => k === 'order')?.[1];
    if (order) { const [col, dir] = order.split('.'); out = [...out].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (dir === 'desc' ? -1 : 1)); }
    const limit = Number(params.find(([k]) => k === 'limit')?.[1]);
    return json(limit ? out.slice(0, limit) : out);
  }
  if (method === 'POST') {
    const list = (Array.isArray(body) ? body : [body]).map(r => ({ ...r }));
    for (const r of list) {
      r.created_at = r.created_at || new Date(Date.now() + (++idn)).toISOString(); // strictly increasing
      if (path === 'queries') Object.assign(r, { id: `q-${idn}`, stage: 'new', escalation_level: 0, assigned_to: null, first_response_at: null, paused_at: null, resolved_at: null, closed_at: null }, r);
      rows.push(r);
    }
    return json(list, 201);
  }
  if (method === 'PATCH') { const hit = rows.filter(r => matches(r, params)); hit.forEach(r => Object.assign(r, body)); return json(hit); }
  return json([]);
};

beforeEach(seed);
const say = (text, interactive = null) => handleArogyaRuchuluBot(BIZ, PHONE, 'Ravi', text, interactive);
const lastText = () => sent[sent.length - 1]?.text?.body || sent[sent.length - 1]?.interactive?.body?.text || '';

test('which messages mean "I want to raise a query"', () => {
  for (const t of ['query', 'Complaint', 'help', 'I have a complaint', 'raise a query', 'I want to file a complaint']) assert.ok(queryBot.wantsToRaise(t), t);
  for (const t of ['can you help me book a slot', 'what are your timings', 'hi', 'is there any problem with my order?']) assert.ok(!queryBot.wantsToRaise(t), t);
  assert.ok(queryBot.saysNotSolved('NOT SOLVED'));
  assert.ok(queryBot.saysNotSolved('still not resolved'));
  assert.ok(!queryBot.saysNotSolved('it is solved, thanks'));
});

test('a customer raises a query: keyword -> categories -> description -> number', async () => {
  await say('complaint');
  const list = sent[0];
  assert.strictEqual(list.interactive.type, 'list');
  assert.deepStrictEqual(list.interactive.action.sections[0].rows.map(r => r.title), CATS);

  await say('[List Selected: Complaint]', { type: 'list_reply', list_reply: { id: 'qcat_4', title: 'Complaint' } });
  assert.match(lastText(), /describe your \*Complaint\* query/);

  await say('I waited 2 hours at the reception yesterday');
  assert.strictEqual(db.queries.length, 1);
  const q = db.queries[0];
  assert.deepStrictEqual([q.kind, q.source, q.category, q.priority, q.contact_phone], ['customer', 'bot', 'Complaint', 'high', PHONE]);
  assert.match(q.subject, /^Complaint: I waited 2 hours/);
  assert.strictEqual(q.description, 'I waited 2 hours at the reception yesterday');
  assert.match(lastText(), /Q-1001.*registered/);

  // The next message is a normal chat again, not a second query.
  await say('hi');
  assert.strictEqual(db.queries.length, 1);
  assert.match(lastText(), /Welcome!/);
});

test('the "Raise a query" button starts the same flow', async () => {
  await say('[Button Clicked: Raise a query]', { type: 'button_reply', button_reply: { id: 'btn_raise_query', title: 'Raise a query' } });
  assert.strictEqual(sent[0].interactive.type, 'list');
});

test('the AI\'s handover becomes a query, and the customer gets its number in one message', async () => {
  const orig = { on: ai.isAutoReplyOn, answer: ai.answerCustomer };
  ai.isAutoReplyOn = async () => true;
  ai.answerCustomer = async () => ({ handover: true, reason: 'customer asks for a refund of the consultation fee' });
  try {
    await say('I want my money back for yesterday\'s consultation');
  } finally {
    ai.isAutoReplyOn = orig.on;
    ai.answerCustomer = orig.answer;
  }
  assert.strictEqual(db.queries.length, 1);
  assert.strictEqual(db.queries[0].source, 'ai');
  assert.match(db.queries[0].subject, /Handed over by the AI: customer asks for a refund/);
  assert.strictEqual(sent.length, 1, 'one message: the team notice with the reference');
  assert.match(lastText(), /A member of our team.*Your reference: \*Q-1001\*/s);
});

test('Q4: outside 24 h, a customer who replied STOP is not messaged about their query', async () => {
  const old = new Date(Date.now() - 3 * 86400000).toISOString();
  Object.assign(db.whatsapp_leads[0], { last_inbound_at: old, opted_out: true });
  const q = { id: 'q-x', number: 1009, contact_phone: PHONE, subject: 's' };
  const r = await Q.notifyCustomer(BIZ, q, 'Your query is resolved');
  assert.strictEqual(r.sent, false);
  assert.match(r.reason, /STOP/);
  assert.strictEqual(sent.length, 0, 'nothing sent to WhatsApp');
  assert.strictEqual(db.query_events[0].visibility, 'handlers', 'the reason is an internal note');

  // Inside 24 h they wrote to us, so a reply is fine.
  db.whatsapp_leads[0].last_inbound_at = new Date().toISOString();
  assert.strictEqual((await Q.notifyCustomer(BIZ, q, 'Reply')).sent, true);
});

test('Q4: query numbers (counts and times only)', () => {
  const t = (h) => new Date(Date.parse('2026-11-01T00:00:00Z') + h * 3600000).toISOString();
  const now = Date.parse(t(100));
  const s = Q.summarize([
    { stage: 'resolved', category: 'Reports', source: 'bot', priority: 'normal', created_at: t(0), first_response_at: t(1), resolved_at: t(10), due_at: t(24), rating: 5 },
    { stage: 'closed', category: 'Reports', source: 'ai', priority: 'high', created_at: t(0), first_response_at: t(3), resolved_at: t(30), due_at: t(8), rating: 3 },
    { stage: 'in_progress', category: 'Billing', source: 'staff', priority: 'urgent', created_at: t(90), due_at: t(92) },
    { stage: 'waiting', category: null, source: 'bot', priority: 'low', created_at: t(0), due_at: t(1) },
  ], now);
  assert.strictEqual(s.total, 4);
  assert.strictEqual(s.open, 2);
  assert.strictEqual(s.overdue, 1, 'waiting queries are never overdue');
  assert.deepStrictEqual(s.byCategory, { Reports: 2, Billing: 1, none: 1 });
  assert.deepStrictEqual(s.bySource, { bot: 2, ai: 1, staff: 1 });
  assert.strictEqual(s.avgFirstResponseHours, 2);
  assert.strictEqual(s.avgResolutionHours, 20);
  assert.strictEqual(s.resolvedOnTimePct, 50);
  assert.strictEqual(s.avgRating, 4);
  assert.strictEqual(s.ratings, 2);
  assert.deepStrictEqual(Q.summarize([]).avgRating, null);
});

test('"NOT SOLVED" reopens the customer\'s resolved query', async () => {
  await say('query');
  await say('[List Selected: Reports]', { type: 'list_reply', list_reply: { id: 'qcat_1', title: 'Reports' } });
  await say('My blood test report has not come');
  Object.assign(db.queries[0], { stage: 'resolved', resolved_at: new Date().toISOString() }); // staff resolved it
  assert.ok(Q.canMove('resolved', 'reopened'));
  const reply = await queryBot.notSolved(BIZ, PHONE);
  assert.match(reply, /Q-1001.*open again/);
  assert.strictEqual(db.queries[0].stage, 'reopened');
});
