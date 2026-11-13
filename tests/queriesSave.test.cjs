// When the database fails to save a query change, the API answers with a clear error instead of
// crashing on the empty result (found while adding types to server/queries.cjs, 2026-11-09).
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const BIZ = 'a0000000-0000-4000-8000-000000000001';
process.env.VITE_SUPABASE_URL = 'http://fake.supabase';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';

const queries = require('../server/queries.cjs');

const owner = { id: 'u1', email: 'owner@a.test', role: 'owner', businessId: BIZ };
const QID = 'c0000000-0000-4000-8000-000000000001';
let saveWorks;
const row = () => ({ id: QID, business_id: BIZ, number: 7, kind: 'customer', stage: 'in_progress', priority: 'normal', subject: 'Late order', assigned_to: 'owner@a.test', escalation_level: 0, created_at: new Date().toISOString(), due_at: new Date(Date.now() + 3600000).toISOString() });

global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
  const method = opts.method || 'GET';
  if (u.includes('/rest/v1/queries') && method === 'GET') return json([row()]);
  if (u.includes('/rest/v1/queries') && method === 'PATCH') return saveWorks ? json([{ ...row(), ...JSON.parse(opts.body) }]) : json({ message: 'db down' }, 503);
  if (u.includes('/rest/v1/businesses')) return json([{ query_due_hours: null }]);
  return json([]);
};
const quiet = console.warn;
beforeEach(() => { saveWorks = true; console.warn = () => {}; });

test('a failed save returns "Could not save" (500) instead of throwing', async () => {
  saveWorks = false;
  for (const input of [{ priority: 'high' }, { category: 'Delivery' }, { assignedTo: null }]) {
    const r = await queries.updateQuery(owner, QID, input);
    assert.deepStrictEqual(r, { error: 'Could not save the query. Try again.', status: 500 }, JSON.stringify(input));
  }
  const esc = await queries.escalate(owner, QID, 'please help');
  assert.strictEqual(esc.status, 500);
  console.warn = quiet;
});

test('a successful save still returns the updated query', async () => {
  const r = await queries.updateQuery(owner, QID, { priority: 'high' });
  assert.strictEqual(r.query.priority, 'high');
  assert.strictEqual(r.query.ref, 'Q-7');
  console.warn = quiet;
});
