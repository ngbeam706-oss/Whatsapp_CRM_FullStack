// Analytics aggregation tests (pure functions, no database).
const { test } = require('node:test');
const assert = require('node:assert');

process.env.SUPABASE_SERVICE_ROLE_KEY = '';
const a = require('../server/analytics.cjs');

test('IST day boundaries', () => {
  assert.strictEqual(a.istDay('2026-11-05T18:29:00Z'), '2026-11-05'); // 23:59 IST
  assert.strictEqual(a.istDay('2026-11-05T18:31:00Z'), '2026-11-06'); // 00:01 IST next day
  assert.deepStrictEqual(a.dayRange('2026-11-04T00:00:00Z', '2026-11-06T10:00:00Z'), ['2026-11-04', '2026-11-05', '2026-11-06']);
});

test('median', () => {
  assert.strictEqual(a.median([]), null);
  assert.strictEqual(a.median([5, 1, 3]), 3);
  assert.strictEqual(a.median([4, 1, 3, 2]), 2.5);
});

test('leadsByDay: top 4 sources + Other, per day', () => {
  const leads = [
    ...Array(5).fill({ source: 'Instagram Ad' }), ...Array(4).fill({ source: 'Website' }),
    ...Array(3).fill({ source: 'Packaging QR' }), ...Array(2).fill({ source: 'Direct WhatsApp' }),
    { source: 'Added by staff' }, { source: null },
  ].map(l => ({ ...l, created_at: '2026-11-06T05:00:00Z' }));
  const r = a.leadsByDay(leads, ['2026-11-05', '2026-11-06']);
  assert.deepStrictEqual(r.series, ['Instagram Ad', 'Website', 'Packaging QR', 'Direct WhatsApp', 'Other']);
  assert.strictEqual(r.rows[0].total, 0);
  assert.strictEqual(r.rows[1].total, 16);
  assert.strictEqual(r.rows[1].Other, 2);
});

test('staff response time: from first waiting customer message to next staff reply', () => {
  const t = (min) => new Date(Date.parse('2026-11-06T04:00:00Z') + min * 60000).toISOString();
  const msgs = [
    { contact_phone: '1', direction: 'inbound', timestamp: t(0) },
    { contact_phone: '1', direction: 'outbound', sent_by: null, timestamp: t(0.1) },        // bot: clock keeps running
    { contact_phone: '1', direction: 'inbound', timestamp: t(2) },                          // still the same wait
    { contact_phone: '1', direction: 'outbound', sent_by: 'Asha@x.in', timestamp: t(10) }, // 10 min
    { contact_phone: '2', direction: 'inbound', timestamp: t(0) },
    { contact_phone: '2', direction: 'outbound', sent_by: 'ravi@x.in', timestamp: t(30) },  // 30 min
    { contact_phone: '3', direction: 'inbound', timestamp: t(0) },
    { contact_phone: '3', direction: 'outbound', sent_by: 'ravi@x.in', timestamp: t(60 * 30) }, // >24h: ignored
  ];
  const r = a.staffResponseTimes(msgs);
  assert.strictEqual(r.overallMedianMin, 20);
  assert.deepStrictEqual(r.staff.map(s => [s.email, s.replies, s.medianMin]), [['asha@x.in', 1, 10], ['ravi@x.in', 1, 30]]);
});

test('busiest hours use India time', () => {
  const h = a.busiestHours([{ direction: 'inbound', timestamp: '2026-11-06T04:30:00Z' }, { direction: 'outbound', timestamp: '2026-11-06T04:30:00Z' }]);
  assert.strictEqual(h[10].count, 1); // 04:30 UTC = 10:00 IST
  assert.strictEqual(h.reduce((n, x) => n + x.count, 0), 1);
});

test('topProducts ranks by orders then views', () => {
  const ev = (type, item) => ({ event_type: type, data: { item } });
  const r = a.topProducts([ev('item_viewed', 'A'), ev('item_viewed', 'A'), ev('item_viewed', 'B'), ev('order_enquiry', 'B'), ev('item_viewed', 'C')]);
  assert.deepStrictEqual(r.map(x => [x.item, x.views, x.orders]), [['B', 1, 1], ['A', 2, 0], ['C', 1, 0]]);
});

test('summarise: KPIs and pipeline', () => {
  const from = '2026-11-01T00:00:00Z';
  const allLeads = [
    { phone: '1', created_at: '2026-10-01T00:00:00Z', stage: 'repeat', assigned_to: 'a@x.in', unread_count: 2 },
    { phone: '2', created_at: '2026-11-02T00:00:00Z', stage: 'ordered', assigned_to: null, unread_count: 0 },
    { phone: '3', created_at: '2026-11-03T00:00:00Z', stage: 'new', assigned_to: null, unread_count: 1 },
  ];
  const r = a.summarise({ leads: allLeads.filter(l => l.created_at >= from), allLeads, messages: [], events: [], from, to: '2026-11-06T00:00:00Z' });
  assert.strictEqual(r.kpis.newLeads, 2);
  assert.strictEqual(r.kpis.newLeadConversion, 0.5);
  assert.strictEqual(r.kpis.unassignedNow, 2);
  assert.strictEqual(r.kpis.unreadNow, 3);
  // new, interested, ordered (Booked), completed, repeat (Returning), lost (Closed)
  assert.deepStrictEqual(r.pipeline.map(p => p.count), [1, 0, 1, 0, 1, 0]);
});
