// U1 header bell: counts only, scoped to the caller's business, and what is counted follows the role
// (agents: their own chats/queries; managers and the Business Admin: the whole business + team queries for them).
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const BIZ = 'b0000000-0000-4000-8000-000000000002';
process.env.VITE_SUPABASE_URL = 'http://fake.supabase';
process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';

const { forStaff } = require('../server/notifications.cjs');

let calls;
let answer; // (table, query) => number
beforeEach(() => { calls = []; answer = () => 0; });
global.fetch = async (url) => {
  const u = decodeURIComponent(String(url));
  const [table, query] = u.slice('http://fake.supabase/rest/v1/'.length).split('?');
  calls.push({ table, query });
  const n = answer(table, query);
  return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json', 'Content-Range': `0-0/${n}` } });
};

const staff = (role, email = `${role}@mayura.test`) => ({ id: 'x', email, role, businessId: BIZ });

test('every count is scoped to the business and nothing but counts comes back', async () => {
  answer = () => 2;
  const r = await forStaff(staff('owner'));
  assert.ok(calls.length >= 5);
  for (const c of calls) {
    assert.match(c.query, new RegExp(`business_id=eq.${BIZ}`), `${c.table} ${c.query}`);
    assert.match(c.query, /limit=0/, 'counts only, no rows');
  }
  for (const i of r.items) assert.deepStrictEqual(Object.keys(i).sort(), ['count', 'key', 'label', 'level', 'view']);
  assert.strictEqual(r.total, r.items.reduce((s, i) => s + i.count, 0));
});

test('an agent counts their own chats and queries; managers the whole business and team queries for managers', async () => {
  await forStaff(staff('agent', 'Ravi@Mayura.test'));
  const overdueAgent = calls.find(c => c.table === 'queries' && /due_at=lt\./.test(c.query));
  assert.match(overdueAgent.query, /assigned_to=eq\.ravi@mayura\.test/, 'agent: only their own overdue queries');
  assert.ok(calls.some(c => c.table === 'whatsapp_leads' && /assigned_to=eq\.ravi@mayura\.test&unread_count=gt\.0/.test(c.query)));
  assert.ok(!calls.some(c => /kind=eq\.internal/.test(c.query)), 'agents get no team-query count');

  calls = [];
  await forStaff(staff('manager'));
  const overdueManager = calls.find(c => c.table === 'queries' && /due_at=lt\./.test(c.query));
  assert.doesNotMatch(overdueManager.query, /assigned_to=eq/, 'manager: every overdue customer query');
  assert.ok(calls.some(c => /kind=eq\.internal&addressed_to=eq\.managers/.test(c.query)));

  calls = [];
  await forStaff(staff('owner'));
  assert.ok(calls.some(c => /kind=eq\.internal&addressed_to=eq\.owner/.test(c.query)));
  assert.ok(!calls.some(c => /addressed_to=eq\.managers/.test(c.query)));
});

test('waiting queries never count as overdue; zero counts are left out; labels read naturally', async () => {
  answer = (table, q) => (table === 'whatsapp_leads' && /assigned_to=eq\./.test(q) ? 1 : table === 'queries' && /due_at=lt/.test(q) ? 3 : 0);
  const r = await forStaff(staff('agent'));
  const overdue = calls.find(c => /due_at=lt/.test(c.query));
  assert.doesNotMatch(overdue.query, /waiting/);
  assert.deepStrictEqual(r.items.map(i => [i.key, i.count, i.view, i.level]), [
    ['myChats', 1, 'chat', 'urgent'],
    ['overdueQueries', 3, 'queries', 'urgent'],
  ]);
  assert.strictEqual(r.items[0].label, '1 of your chats is waiting for a reply');
  assert.strictEqual(r.items[1].label, '3 of your queries are overdue');
});
