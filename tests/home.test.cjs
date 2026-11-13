// U2 Home ("My work"): scoped to the caller's business, the caller's own chats/queries, escalated
// queries above an agent's level left out, and "Q-1042" search only finds queries the caller may see.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const BIZ = 'b0000000-0000-4000-8000-000000000002';
const OTHER = 'a0000000-0000-4000-8000-000000000001';
process.env.VITE_SUPABASE_URL = 'http://fake.supabase';
process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';

const { myWork, teamToday, startOfDayIst } = require('../server/home.cjs');
const queries = require('../server/queries.cjs');

const agent = { id: 'u1', email: 'Ravi@Mayura.test', role: 'agent', businessId: BIZ };
const future = new Date(Date.now() + 3600e3).toISOString();
const past = new Date(Date.now() - 3600e3).toISOString();
let db;
let calls;
beforeEach(() => {
  calls = [];
  db = {
    whatsapp_leads: [
      { business_id: BIZ, phone: '911', name: 'Mine waiting', assigned_to: 'ravi@mayura.test', unread_count: 2, last_inbound_at: past },
      { business_id: BIZ, phone: '912', name: 'Nobody', assigned_to: null, unread_count: 1, last_inbound_at: past },
      { business_id: BIZ, phone: '913', name: 'Answered', assigned_to: 'ravi@mayura.test', unread_count: 0 },
      { business_id: BIZ, phone: '914', name: 'Someone else', assigned_to: 'sita@mayura.test', unread_count: 4 },
      { business_id: OTHER, phone: '915', name: 'OTHER BUSINESS', assigned_to: 'ravi@mayura.test', unread_count: 9 },
    ],
    queries: [
      { business_id: BIZ, id: 'q1', number: 1001, kind: 'customer', assigned_to: 'ravi@mayura.test', stage: 'in_progress', due_at: past, escalation_level: 0, subject: 'Report late' },
      { business_id: BIZ, id: 'q2', number: 1002, kind: 'customer', assigned_to: null, stage: 'new', due_at: future, escalation_level: 0, subject: 'Refund' },
      { business_id: BIZ, id: 'q3', number: 1003, kind: 'customer', assigned_to: null, stage: 'new', due_at: future, escalation_level: 2, subject: 'With the Business Admin' },
      { business_id: BIZ, id: 'q4', number: 1004, kind: 'internal', raised_by_email: 'ravi@mayura.test', addressed_to: 'managers', stage: 'waiting', subject: 'Which price?' },
      { business_id: BIZ, id: 'q5', number: 1005, kind: 'internal', raised_by_email: 'sita@mayura.test', addressed_to: 'owner', stage: 'new', subject: 'Private to the admin' },
      { business_id: OTHER, id: 'q9', number: 1001, kind: 'customer', assigned_to: 'ravi@mayura.test', stage: 'new', subject: 'OTHER BUSINESS' },
    ],
    staff_members: [
      { business_id: BIZ, email: 'Ravi@Mayura.test', role: 'agent' },
      { business_id: BIZ, email: 'sita@mayura.test', role: 'agent' },
      { business_id: OTHER, email: 'ravi@mayura.test', role: 'owner' },
    ],
    campaigns: [{ business_id: BIZ, status: 'sending' }, { business_id: OTHER, status: 'sending' }],
  };
});

// Tiny PostgREST: eq / ilike (case-insensitive) / is.null / gt / in, select ignored; count via Content-Range.
global.fetch = async (url, opts = {}) => {
  const u = decodeURIComponent(String(url));
  const [table, qs = ''] = u.slice('http://fake.supabase/rest/v1/'.length).split('?');
  calls.push(`${table}?${qs}`);
  const params = qs.split('&').map(p => p.split('=')).filter(([k]) => !['select', 'order', 'limit'].includes(k));
  const hit = (db[table] || []).filter(r => params.every(([k, v]) => {
    const [op, ...rest] = v.split('.');
    const val = rest.join('.');
    const cell = r[k];
    if (op === 'eq') return String(cell) === val;
    if (op === 'ilike') return String(cell || '').toLowerCase() === val.toLowerCase();
    if (op === 'is') return cell == null;
    if (op === 'gt') return Number(cell) > Number(val);
    if (op === 'gte') return String(cell || '') >= val;
    if (op === 'lt') return cell != null && String(cell) < val;
    if (op === 'in') return val.replace(/[()]/g, '').split(',').includes(String(cell));
    return true;
  }));
  void opts;
  return new Response(JSON.stringify(hit), { status: 200, headers: { 'Content-Type': 'application/json', 'Content-Range': `0-0/${hit.length}` } });
};

test('My work: my waiting chats, chats nobody took, my queries, new ones, and what waits on my answer', async () => {
  const r = await myWork(agent);
  assert.deepStrictEqual(r.myChats.map(c => c.name), ['Mine waiting']);
  assert.deepStrictEqual(r.newChats.map(c => c.name), ['Nobody']);
  assert.deepStrictEqual(r.myQueries.map(q => [q.ref, q.overdue]), [['Q-1001', true]]);
  // Escalated to the Business Admin (level 2): view-only for agents, so not offered to pick up.
  assert.deepStrictEqual(r.newQueries.map(q => q.ref), ['Q-1002']);
  assert.deepStrictEqual(r.waitingOnMe.map(q => q.ref), ['Q-1004']);
  assert.deepStrictEqual(r.today, { repliesSent: 0, myOpenChats: 2, overdueQueries: 1 });
  assert.ok(!JSON.stringify(r).includes('OTHER BUSINESS'), 'nothing from another business');
  for (const c of calls) assert.match(c, new RegExp(`business_id=eq.${BIZ}`), c);
});

test('Team today (managers): each person\'s load, the longest waiting chats and overdue queries, this business only', async () => {
  const r = await teamToday({ id: 'm', email: 'boss@mayura.test', role: 'manager', businessId: BIZ });
  assert.deepStrictEqual(r.people.map(p => [p.email, p.openChats, p.waitingChats, p.openQueries]), [
    ['ravi@mayura.test', 2, 1, 1],
    ['sita@mayura.test', 1, 1, 0],
  ]);
  assert.strictEqual(r.people[0].oldestWaitingSince, past);
  assert.deepStrictEqual(r.longestWaiting.map(c => c.name).sort(), ['Mine waiting', 'Nobody', 'Someone else']);
  assert.deepStrictEqual(r.overdueQueries.map(q => q.ref), ['Q-1001']);
  assert.strictEqual(r.unassignedWaiting, 1);
  assert.strictEqual(r.waitingTotal, 3);
  assert.strictEqual(r.broadcastsSending, 1);
  assert.ok(!JSON.stringify(r).includes('OTHER BUSINESS'));
  for (const c of calls) assert.match(c, new RegExp(`business_id=eq.${BIZ}`), c);
});

test('"today" starts at midnight India time', () => {
  // 2026-11-13 02:00 IST = 2026-11-12 20:30 UTC -> the day started 2026-11-12 18:30 UTC.
  assert.strictEqual(startOfDayIst(new Date('2026-11-12T20:30:00Z')), '2026-11-12T18:30:00.000Z');
  assert.strictEqual(startOfDayIst(new Date('2026-11-13T10:00:00Z')), '2026-11-12T18:30:00.000Z');
});

test('search by query number: only this business, only what the caller may see', async () => {
  const found = await queries.findByNumber(agent, 'Q-1001');
  assert.deepStrictEqual(found, { query: { id: 'q1', ref: 'Q-1001', subject: 'Report late', kind: 'customer' } });
  assert.strictEqual((await queries.findByNumber(agent, 'q1004')).query.id, 'q4', 'my own team query');
  assert.strictEqual((await queries.findByNumber(agent, '1005')).status, 404, 'a team query for the Business Admin is not an agent\'s');
  assert.strictEqual((await queries.findByNumber(agent, 'Q-9999')).status, 404);
  assert.strictEqual((await queries.findByNumber(agent, 'drop table')).status, 400);
  const owner = { ...agent, role: 'owner', email: 'admin@mayura.test' };
  assert.strictEqual((await queries.findByNumber(owner, '1005')).query.id, 'q5');
});
