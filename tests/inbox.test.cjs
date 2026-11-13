// Phase 4 logic tests: reply window, bot pause, pipeline moves, tags, team input checks.
const { test } = require('node:test');
const assert = require('node:assert');

process.env.SUPABASE_SERVICE_ROLE_KEY = '';
const inbox = require('../server/inbox.cjs');
const team = require('../server/team.cjs');

const HOUR = 3600 * 1000;

test('24-hour reply window', () => {
  const now = Date.parse('2026-11-06T12:00:00Z');
  assert.strictEqual(inbox.isWindowOpen('2026-11-06T00:00:00Z', now), true);   // 12h ago
  assert.strictEqual(inbox.isWindowOpen('2026-11-05T12:00:01Z', now), true);   // just inside
  assert.strictEqual(inbox.isWindowOpen('2026-11-05T11:59:59Z', now), false);  // just outside
  assert.strictEqual(inbox.isWindowOpen(null, now), false);                     // never messaged
  assert.strictEqual(inbox.windowClosesAt('2026-11-06T00:00:00Z'), '2026-11-07T00:00:00.000Z');
});

test('bot pause: off, timed, indefinite, expired', () => {
  const now = Date.now();
  assert.strictEqual(inbox.isBotPaused(null, now), false);
  assert.strictEqual(inbox.isBotPaused({ bot_paused: false }, now), false);
  assert.strictEqual(inbox.isBotPaused({ bot_paused: true, bot_paused_until: null }, now), true);
  assert.strictEqual(inbox.isBotPaused({ bot_paused: true, bot_paused_until: new Date(now + HOUR).toISOString() }, now), true);
  assert.strictEqual(inbox.isBotPaused({ bot_paused: true, bot_paused_until: new Date(now - HOUR).toISOString() }, now), false);
});

test('pipeline only moves forward automatically', () => {
  assert.strictEqual(inbox.nextStage('new', 'item_viewed'), 'interested');
  assert.strictEqual(inbox.nextStage('interested', 'item_viewed'), 'interested');
  assert.strictEqual(inbox.nextStage('ordered', 'item_viewed'), 'ordered');       // never backwards
  assert.strictEqual(inbox.nextStage('new', 'order_enquiry'), 'ordered');
  assert.strictEqual(inbox.nextStage('lost', 'order_enquiry'), 'ordered');        // an order revives a lost lead
  assert.strictEqual(inbox.nextStage('ordered', 'order_enquiry'), 'ordered');     // same order, no earlier one
  assert.strictEqual(inbox.nextStage('ordered', 'order_enquiry', { hadEarlierOrder: true }), 'repeat');
  assert.strictEqual(inbox.nextStage('repeat', 'order_enquiry', { hadEarlierOrder: true }), 'repeat');
  assert.strictEqual(inbox.nextStage(null, 'inbound'), 'new');
  // Completed (visited / delivered): booking again makes them Returning; looking around doesn't move them back.
  assert.strictEqual(inbox.nextStage('completed', 'order_enquiry'), 'repeat');
  assert.strictEqual(inbox.nextStage('completed', 'item_viewed'), 'completed');
  assert.ok(inbox.STAGES.includes('completed'));
});

test('cleanTags normalises and limits tags', () => {
  assert.deepStrictEqual(inbox.cleanTags([' VIP ', 'vip', 'Diabetes Care', 'x'.repeat(31), '', 'gut@reset']), ['vip', 'diabetes-care', 'gutreset']);
  assert.deepStrictEqual(inbox.cleanTags('not-an-array'), []);
});

test('team email check', () => {
  assert.strictEqual(team.isEmail('staff@arogya.in'), true);
  assert.strictEqual(team.isEmail('no-at-sign'), false);
  assert.strictEqual(team.isEmail('a@b'), false);
});

test('invite rejects bad input before calling Supabase', async () => {
  const me = { id: 'u1', email: 'owner@arogya.in', role: 'owner', businessId: 'a0000000-0000-4000-8000-000000000001' };
  assert.match((await team.inviteStaff(me, 'bad', 'agent')).error, /valid email/);
  assert.match((await team.inviteStaff(me, 'ok@example.com', 'admin')).error, /manager or agent/);
  await assert.rejects(() => team.inviteStaff({ email: 'x@y.z', role: 'owner' }, 'ok@example.com', 'agent'), /business id/);
});
