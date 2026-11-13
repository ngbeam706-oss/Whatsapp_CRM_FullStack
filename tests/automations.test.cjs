// Phase 3 logic tests: sending window, triggers, event detection, validation.
const { test } = require('node:test');
const assert = require('node:assert');

process.env.SUPABASE_SERVICE_ROLE_KEY = '';
const a = require('../server/automations.cjs');
const tpl = require('../server/templates.cjs');
const { DEFAULT_CATALOG } = require('../server/defaults.cjs');

// Helper: an IST wall-clock time as a Date (IST = UTC+5:30).
const ist = (y, mo, d, h, mi = 0) => new Date(Date.UTC(y, mo - 1, d, h, mi) - 330 * 60000);
const istHour = (date) => {
  const t = new Date(date.getTime() + 330 * 60000);
  return `${t.getUTCDate()} ${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`;
};

test('intoSendingWindow keeps daytime and moves night to 9:00 IST', () => {
  assert.strictEqual(istHour(a.intoSendingWindow(ist(2026, 11, 6, 14, 30))), '6 14:30');
  assert.strictEqual(istHour(a.intoSendingWindow(ist(2026, 11, 6, 3, 0))), '6 09:00');   // early morning -> same day 9am
  assert.strictEqual(istHour(a.intoSendingWindow(ist(2026, 11, 6, 20, 0))), '7 09:00');  // 8pm -> next day 9am
  assert.strictEqual(istHour(a.intoSendingWindow(ist(2026, 11, 6, 23, 45))), '7 09:00');
  assert.strictEqual(istHour(a.intoSendingWindow(ist(2026, 11, 30, 22, 0))), '1 09:00'); // month rollover
});

test('computeDueAt adds the delay, then applies the window', () => {
  // 2 days after 7pm IST -> 7pm IST two days later (inside window)
  assert.strictEqual(istHour(a.computeDueAt(ist(2026, 11, 6, 19, 0), 2 * 1440)), '8 19:00');
  // 3 hours after 7pm -> 10pm -> next morning 9am
  assert.strictEqual(istHour(a.computeDueAt(ist(2026, 11, 6, 19, 0), 180)), '7 09:00');
});

test('triggersForEvent maps events to automation triggers', () => {
  assert.deepStrictEqual(a.triggersForEvent('order_enquiry', { isKit: true }), ['order_enquiry', 'kit_order']);
  assert.deepStrictEqual(a.triggersForEvent('order_enquiry', { isKit: false }), ['order_enquiry']);
  assert.deepStrictEqual(a.triggersForEvent('item_viewed'), ['item_viewed']);
  assert.deepStrictEqual(a.triggersForEvent('new_contact'), ['new_contact']);
  assert.deepStrictEqual(a.triggersForEvent('something_else'), []);
});

test('eventFromInteractive recognises bot clicks using the real catalog', () => {
  const list = (id) => ({ type: 'list_reply', list_reply: { id } });
  const btn = (id, title = '') => ({ type: 'button_reply', button_reply: { id, title } });

  assert.deepStrictEqual(a.eventFromInteractive(list('kit_lean_well'), DEFAULT_CATALOG),
    { type: 'item_viewed', data: { itemId: 'kit_lean_well', item: 'Lean Well (28 Days)', isKit: true } });
  assert.deepStrictEqual(a.eventFromInteractive(btn('btn_confirm_kit_sugar_shield'), DEFAULT_CATALOG),
    { type: 'order_enquiry', data: { itemId: 'kit_sugar_shield', item: 'Sugar Shield (28 Days)', isKit: true } });
  assert.deepStrictEqual(a.eventFromInteractive(btn('btn_step_1_rte_thali_box', '🍽️ 2 Portions'), DEFAULT_CATALOG),
    { type: 'order_enquiry', data: { itemId: 'rte_thali_box', item: 'Arogya Daily Veg Thali', isKit: false, choice: '🍽️ 2 Portions' } });
  assert.strictEqual(a.eventFromInteractive(btn('btn_cat_rte'), DEFAULT_CATALOG), null); // menu navigation is not an event
  assert.strictEqual(a.eventFromInteractive(btn('btn_talk_staff'), DEFAULT_CATALOG), null);
  assert.strictEqual(a.eventFromInteractive(null, DEFAULT_CATALOG), null);
});

test('validateAutomationInput checks name, trigger, delay', () => {
  const ok = { name: 'Reorder', trigger: 'kit_order', delayMinutes: 21 * 1440, templateName: 't', language: 'en' };
  assert.ifError(a.validateAutomationInput(ok).error);
  assert.strictEqual(a.validateAutomationInput(ok).row.stop_if_replied, true);
  assert.match(a.validateAutomationInput({ ...ok, name: ' ' }).error, /name/);
  assert.match(a.validateAutomationInput({ ...ok, trigger: 'x' }).error, /when/);
  assert.match(a.validateAutomationInput({ ...ok, delayMinutes: -5 }).error, /delay/);
  assert.match(a.validateAutomationInput({ ...ok, trigger: 'inactive', delayMinutes: 60 }).error, /1 day/);
  assert.match(a.validateAutomationInput({ ...ok, templateName: '' }).error, /template/);
});

test('describeDelay reads naturally', () => {
  assert.strictEqual(a.describeDelay(1440), '1 day');
  assert.strictEqual(a.describeDelay(21 * 1440), '21 days');
  assert.strictEqual(a.describeDelay(120), '2 hours');
  assert.strictEqual(a.describeDelay(45), '45 minutes');
});

test('event_item variable uses the product from the event', () => {
  const needs = tpl.templateNeeds({ components: [{ type: 'BODY', text: 'Hi {{1}}, how is your {{2}}?' }] });
  const vars = { body: [{ type: 'contact_name', fallback: 'there' }, { type: 'event_item', fallback: 'order' }] };
  assert.strictEqual(tpl.checkVariables(needs, vars), 'Body variable {{2}} needs a value.'); // not allowed in campaigns
  assert.strictEqual(tpl.checkVariables(needs, vars, { allowEventItem: true }), null);
  assert.strictEqual(tpl.renderPreview(needs, vars, { name: 'Asha K', item: 'Lean Well (28 Days)' }), 'Hi Asha, how is your Lean Well (28 Days)?');
  assert.strictEqual(tpl.renderPreview(needs, vars, { name: '' }), 'Hi there, how is your order?');
});
