// The basic bot flow every business except Arogya Ruchulu gets (defaults.cjs NEUTRAL_CATALOG):
// welcome -> [Our services] [Talk to our team] [Raise a query] -> services list -> item -> Book / Enquire.
// Arogya keeps its food bot. Fake database + fake Meta (same harness style as q3RaiseQuery.test.cjs).
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const AROGYA = 'a0000000-0000-4000-8000-000000000001';
const BIZ = 'b0000000-0000-4000-8000-000000000002'; // a hospital using the basic flow

process.env.APP_SECRET = 'server_encryption_secret_long_enough';
process.env.WHATSAPP_TOKEN = '';
process.env.PHONE_NUMBER_ID = '';
process.env.VITE_SUPABASE_URL = 'http://fake.supabase';
process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
process.env.WHATSAPP_BUSINESS_ID = 'c0000000-0000-4000-8000-000000000009'; // nobody in these tests

const secrets = require('../server/secrets.cjs');
const whatsapp = require('../server/whatsapp.cjs');
const ai = require('../server/ai.cjs');
const automations = require('../server/automations.cjs');
const { NEUTRAL_CATALOG, DEFAULT_CATALOG } = require('../server/defaults.cjs');
const { handleArogyaRuchuluBot } = require('../server/bot.cjs');

const PHONE = '919000000001';
const SERVICES = [
  { id: 'menu_1', title: 'General consultation', description: 'Mon–Sat, 10am–6pm', price: 500, details: '' },
  { id: 'menu_2', title: 'Health check-up', description: 'Full body package', price: '', details: '*Health check-up*\nCome fasting. Takes about 2 hours.' },
];
const waRow = (business_id, n) => ({ business_id, phone_number: `91900000020${n}`, phone_number_id: `22${n}`, waba_id: `92${n}`, token_last4: '9876', access_token_enc: secrets.encrypt('EAAG-test-token-9876'), webhook_key: String(n).repeat(32), graph_api_version: 'v26.0' });

let db;
let sent;
function seed(catalogData = { menuItems: SERVICES }) {
  db = {
    businesses: [{ id: BIZ, name: 'Mayura Hospitals', status: 'active', plan_id: 'pro' }, { id: AROGYA, name: 'Arogya Ruchulu', status: 'active', plan_id: 'pro' }],
    plans: [{ id: 'pro', name: 'Pro', ai_enabled: true, max_ai_replies_month: null }],
    business_whatsapp: [waRow(BIZ, 1), waRow(AROGYA, 2)],
    whatsapp_leads: [{ business_id: BIZ, phone: PHONE, name: 'Ravi', last_inbound_at: new Date().toISOString() }],
    query_categories: [{ business_id: BIZ, kind: 'customer', name: 'Appointment', sort_order: 1, is_active: true }],
    ai_settings: [{ business_id: BIZ, auto_reply: false }, { business_id: AROGYA, auto_reply: false }],
    // Always a saved catalog row, so the in-memory copy never leaks between tests.
    whatsapp_catalog: [{ business_id: BIZ, id: 'main_catalog', data: catalogData }],
    queries: [], query_events: [], contact_events: [], whatsapp_messages: [], whatsapp_bot_rules: [], lead_notes: [], usage_counters: [],
  };
  sent = [];
  whatsapp.clearCache();
}

const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
function matches(row, params) {
  for (const [k, raw] of params) {
    if (['select', 'order', 'limit', 'on_conflict'].includes(k)) continue;
    const i = raw.indexOf('.');
    const op = raw.slice(0, i);
    const val = raw.slice(i + 1);
    if (op === 'eq' && String(row[k]) !== val) return false;
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
  if (path.startsWith('rpc/')) return json([]);
  const rows = db[path] || (db[path] = []);
  if (method === 'GET') return json(rows.filter(r => matches(r, params)));
  if (method === 'POST') { const list = (Array.isArray(body) ? body : [body]); rows.push(...list); return json(list, 201); }
  if (method === 'PATCH') { const hit = rows.filter(r => matches(r, params)); hit.forEach(r => Object.assign(r, body)); return json(hit); }
  return json([]);
};

beforeEach(() => seed());
const say = (text, interactive = null, biz = BIZ) => handleArogyaRuchuluBot(biz, PHONE, 'Ravi', text, interactive);
const last = () => sent[sent.length - 1];
const buttonsOf = (m) => (m?.interactive?.action?.buttons || []).map(b => b.reply);
const rowsOf = (m) => (m?.interactive?.action?.sections || []).flatMap(s => s.rows);
const tap = (id, title = '') => ({ type: 'button_reply', button_reply: { id, title } });
const pick = (id, title = '') => ({ type: 'list_reply', list_reply: { id, title } });

test('the basic flow has no Arogya Ruchulu or food words', () => {
  // Only the words customers or staff read (not field names like "dietKits").
  const strings = (v) => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : []);
  const text = strings(NEUTRAL_CATALOG).join('\n');
  for (const w of ['Arogya', 'nutritionist', 'kitchen', 'diet', '28-day', 'millet', 'thali']) {
    assert.ok(!text.toLowerCase().includes(w.toLowerCase()), `NEUTRAL_CATALOG mentions "${w}"`);
  }
  assert.strictEqual(NEUTRAL_CATALOG.foodBuiltIns, false);
  assert.deepStrictEqual(NEUTRAL_CATALOG.welcomeButtons.map(b => b.id), ['btn_menu', 'btn_talk_staff', 'btn_raise_query']);
});

test('hi -> welcome with Our services, Talk to our team, Raise a query', async () => {
  await say('hi');
  assert.match(last().interactive.body.text, /Welcome! 👋/);
  assert.deepStrictEqual(buttonsOf(last()).map(b => b.id), ['btn_menu', 'btn_talk_staff', 'btn_raise_query']);
});

test('"Our services" is hidden while the list is empty, and the button still answers politely', async () => {
  seed({});
  await say('hello');
  assert.deepStrictEqual(buttonsOf(last()).map(b => b.id), ['btn_talk_staff', 'btn_raise_query']);
  // An old message's button tapped after the list was emptied: no empty list.
  await say('[Button Clicked]', tap('btn_menu'));
  assert.strictEqual(last().type, 'text');
  assert.match(last().text.body, /member of our team/);
});

test('Our services -> list of items + Talk to our team', async () => {
  await say('[Button Clicked: Our services]', tap('btn_menu', '📋 Our services'));
  const m = last();
  assert.strictEqual(m.interactive.type, 'list');
  assert.strictEqual(m.interactive.body.text, NEUTRAL_CATALOG.menuPrompt);
  assert.strictEqual(m.interactive.action.button, 'View options');
  assert.deepStrictEqual(rowsOf(m).map(r => r.id), ['menu_1', 'menu_2', 'row_talk_staff']);
});

test('typing "services" or "price" opens the same list', async () => {
  await say('what services do you have');
  assert.strictEqual(last().interactive.type, 'list');
  await say('price?');
  assert.deepStrictEqual(rowsOf(last()).map(r => r.id), ['menu_1', 'menu_2', 'row_talk_staff']);
});

test('picking an item shows its details with Book / Enquire and Talk to our team', async () => {
  await say('[List Selected]', pick('menu_1', 'General consultation'));
  const m = last();
  assert.match(m.interactive.body.text, /\*General consultation\*\nPrice: ₹500\nMon–Sat/);
  assert.deepStrictEqual(buttonsOf(m), [{ id: 'btn_confirm_menu_1', title: '✅ Book / Enquire' }, { id: 'btn_talk_staff', title: '💬 Talk to our team' }]);

  // Own details text wins; no price shown when there is none.
  await say('[List Selected]', pick('menu_2'));
  assert.strictEqual(last().interactive.body.text, SERVICES[1].details);
});

test('Book / Enquire sends the confirmation; it is recorded as an enquiry for that item', async () => {
  await say('[Button Clicked]', tap('btn_confirm_menu_1', '✅ Book / Enquire'));
  assert.strictEqual(last().text.body, NEUTRAL_CATALOG.orderConfirmReply);
  const catalog = { ...NEUTRAL_CATALOG, menuItems: SERVICES };
  assert.deepStrictEqual(automations.eventFromInteractive(tap('btn_confirm_menu_1'), catalog),
    { type: 'order_enquiry', data: { itemId: 'menu_1', item: 'General consultation', isKit: false } });
  assert.deepStrictEqual(automations.eventFromInteractive(pick('menu_2'), catalog),
    { type: 'item_viewed', data: { itemId: 'menu_2', item: 'Health check-up', isKit: false } });
});

test('"Talk to our team" row sends the staff message', async () => {
  await say('[List Selected]', pick('row_talk_staff', '💬 Talk to our team'));
  assert.strictEqual(last().text.body, NEUTRAL_CATALOG.staffNotificationReply);
});

test('a business\'s own labels are used', async () => {
  seed({ menuItems: SERVICES, menuButtonLabel: 'Doctors', enquireButtonLabel: '📅 Book a slot', menuPrompt: 'Our departments:' });
  await say('menu');
  assert.strictEqual(last().interactive.action.button, 'Doctors');
  assert.strictEqual(last().interactive.body.text, 'Our departments:');
  await say('[List Selected]', pick('menu_1'));
  assert.strictEqual(buttonsOf(last())[0].title, '📅 Book a slot');
});

test('food keywords never answer for a basic-flow business', async () => {
  seed({});
  for (const t of ['diet plan', 'thali', 'batter']) {
    await say(t);
    assert.ok(!JSON.stringify(last()).includes('28-Day'), t);
    assert.match(last().interactive.body.text, /Welcome! 👋/, t);
  }
});

test('Arogya Ruchulu keeps its food bot', async () => {
  await say('hi', null, AROGYA);
  assert.deepStrictEqual(buttonsOf(last()).map(b => b.id), DEFAULT_CATALOG.welcomeButtons.map(b => b.id));
  await say('[Button Clicked]', tap('btn_cat_diet_kits'), AROGYA);
  assert.ok(rowsOf(last()).some(r => r.id === 'kit_lean_well'));
});

test('a bot reply keeps the contact\'s name (it used to become "+91…")', async () => {
  await say('hi');
  const lead = db.whatsapp_leads.find(l => l.business_id === BIZ && l.phone === PHONE);
  assert.strictEqual(lead.name, 'Ravi');
  assert.match(lead.last_message, /Welcome Greeting/);
  assert.strictEqual(db.whatsapp_leads.filter(l => l.phone === PHONE).length, 1);
});

test('the AI assistant knows the services list', () => {
  const text = ai.catalogText({ ...NEUTRAL_CATALOG, menuItems: SERVICES });
  assert.match(text, /## Our services and products/);
  assert.match(text, /General consultation - ₹500: Mon–Sat/);
  assert.match(text, /Health check-up: Full body package/);
  assert.ok(!/nutritionist/i.test(ai.systemPrompt({ ...NEUTRAL_CATALOG, menuItems: SERVICES }, { business_name: 'Mayura Hospitals' })));
});
