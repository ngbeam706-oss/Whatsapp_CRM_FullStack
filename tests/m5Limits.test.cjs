// M5: plan limits, usage counting and payments. Fake database + fake Meta, no network.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const BIZ = 'b0000000-0000-4000-8000-000000000002';
const OTHER = 'a0000000-0000-4000-8000-000000000001';

process.env.APP_SECRET = 'server_encryption_secret_long_enough';
process.env.WHATSAPP_TOKEN = '';
process.env.PHONE_NUMBER_ID = '';
process.env.VITE_SUPABASE_URL = 'http://fake.supabase';
process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
process.env.WHATSAPP_BUSINESS_ID = OTHER;

const secrets = require('../server/secrets.cjs');
const limits = require('../server/limits.cjs');
const team = require('../server/team.cjs');
const inbox = require('../server/inbox.cjs');
const campaigns = require('../server/campaigns.cjs');
const automations = require('../server/automations.cjs');
const ai = require('../server/ai.cjs');
const whatsapp = require('../server/whatsapp.cjs');

let db;
let usageCalls;
let sends;
function seed({ plan = {}, overrides = {}, paidUntil = null } = {}) {
  db = {
    businesses: [
      { id: BIZ, name: 'Mayura Hospitals', status: 'active', plan_id: 'starter', limit_overrides: overrides, paid_until: paidUntil },
      { id: OTHER, name: 'Arogya Ruchulu', status: 'active', plan_id: 'pro', limit_overrides: {}, paid_until: null },
    ],
    plans: [
      { id: 'starter', name: 'Starter', max_staff: 2, max_contacts: 2, max_broadcasts_month: 3, max_automations: 1, max_ai_replies_month: 0, max_keyword_rules: 2, analytics_days: 30, ai_enabled: false, ...plan },
      { id: 'pro', name: 'Pro', max_staff: null, max_contacts: null, max_broadcasts_month: null, max_automations: null, max_ai_replies_month: null, max_keyword_rules: null, analytics_days: 365, ai_enabled: true },
    ],
    staff_members: [{ business_id: BIZ, user_id: 'u1', email: 'admin@mayura.test', role: 'owner' }],
    whatsapp_leads: [{ business_id: BIZ, phone: '919000000001', name: 'A', opted_out: false }],
    whatsapp_bot_rules: [],
    automations: [],
    usage_counters: [],
    campaigns: [],
    campaign_recipients: [],
    audit_log: [],
    ai_settings: [{ business_id: BIZ, auto_reply: true, knowledge: '', instructions: '' }],
    ai_provider: [],
    business_whatsapp: [{
      business_id: BIZ, phone_number: '919000000200', phone_number_id: '222222222222222', waba_id: '9222', token_last4: '9876',
      access_token_enc: secrets.encrypt('EAAG-mayura-token-9876'), webhook_key: 'b'.repeat(32), graph_api_version: 'v26.0',
    }],
  };
  usageCalls = [];
  sends = 0;
  limits.clearCache();
  whatsapp.clearCache();
}

const json = (d, status = 200, headers = {}) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const eqv = (u, k) => { const m = u.match(new RegExp(`[?&]${k}=(?:eq|is)\\.([^&]+)`)); return m ? decodeURIComponent(m[1]) : null; };
const TEMPLATE = { name: 'promo', language: 'en', status: 'APPROVED', category: 'MARKETING', components: [{ type: 'BODY', text: 'Hello from us' }] };

global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  if (u.startsWith('https://graph.facebook.com/')) {
    if (u.includes('/message_templates')) return json({ data: [TEMPLATE] });
    sends++;
    return json({ messages: [{ id: `wamid.${sends}` }] });
  }
  if (u.startsWith('http://fake.supabase/auth/v1/invite')) return json({ id: `new-${Math.random()}` });
  if (!u.startsWith('http://fake.supabase/rest/v1/')) return json({}, 503);
  const path = u.slice('http://fake.supabase/rest/v1/'.length);
  const table = path.split('?')[0];
  const body = opts.body ? JSON.parse(opts.body) : null;
  if (table === 'rpc/add_usage') {
    usageCalls.push(body);
    const col = body.p_metric;
    let row = db.usage_counters.find(r => r.business_id === body.p_business && r.period === limits.currentPeriod());
    if (!row) { row = { business_id: body.p_business, period: limits.currentPeriod(), broadcasts_sent: 0, ai_replies: 0 }; db.usage_counters.push(row); }
    row[col] += body.p_amount;
    return json(null, 204);
  }
  if (table === 'rpc/claim_campaign_recipients') {
    const batch = db.campaign_recipients.filter(r => r.status === 'queued');
    batch.forEach(r => { r.status = 'sending'; });
    return json(batch.map(r => ({ ...r, attempts: 1 })));
  }
  if (table.startsWith('rpc/')) return json([]);
  const rows = db[table] || (db[table] = []);
  const lte = u.match(/[?&]paid_until=lte\.([^&]+)/);
  const match = (r) => ['business_id', 'id', 'phone', 'period', 'email', 'is_active', 'status', 'campaign_id', 'user_id', 'opted_out'].every(k => {
    const v = eqv(u, k);
    return v === null || String(r[k]) === v;
  }) && (!lte || (r.paid_until && r.paid_until <= lte[1]));
  if (method === 'GET') {
    const hit = rows.filter(match);
    if (/limit=0/.test(u)) return json([], 200, { 'Content-Range': `*/${hit.length}` });
    return json(hit);
  }
  if (method === 'POST') {
    const list = (Array.isArray(body) ? body : [body]).map(r => ({ id: r.id || `${table}-${rows.length + 1}`, ...r }));
    for (const r of list) {
      if (table === 'campaign_recipients') r.status = 'queued';
      if (table === 'staff_members') { const ex = rows.find(x => x.user_id === r.user_id); if (ex) { Object.assign(ex, r); continue; } }
      rows.push(r);
    }
    return json(list, 201);
  }
  if (method === 'PATCH') { const hit = rows.filter(match); hit.forEach(r => Object.assign(r, body)); return json(hit); }
  if (method === 'DELETE') { const hit = rows.filter(match); db[table] = rows.filter(r => !hit.includes(r)); return json(hit); }
  return json([]);
};

const owner = { id: 'u1', email: 'admin@mayura.test', role: 'owner', businessId: BIZ };
beforeEach(() => seed());

// ---- the rules ----------------------------------------------------------------------------
test('limits = plan limits with per-business overrides; empty = unlimited', () => {
  const l = limits.effectiveLimits({ max_staff: 3, max_contacts: 1000, ai_enabled: false }, { max_staff: 10, max_contacts: null, ai_enabled: true });
  assert.strictEqual(l.max_staff, 10);
  assert.strictEqual(l.max_contacts, null);
  assert.strictEqual(l.ai_enabled, true);
  assert.strictEqual(limits.effectiveLimits({ max_staff: 3 }, {}).max_staff, 3);
});

test('payment: ok until the paid-until date, then 7 days of grace, then overdue', () => {
  const at = (d) => Date.parse(`${d}T06:00:00Z`);
  assert.strictEqual(limits.billingState(null).state, 'ok');
  assert.strictEqual(limits.billingState('2026-11-30', at('2026-11-30')).state, 'ok');
  const due = limits.billingState('2026-11-30', at('2026-12-03'));
  assert.strictEqual(due.state, 'due');
  assert.strictEqual(due.suspendOn, '2026-12-08');
  assert.strictEqual(limits.billingState('2026-11-30', at('2026-12-08')).state, 'overdue');
});

test('the worker pauses only businesses past the grace period', async () => {
  seed({ paidUntil: '2026-10-01' });
  db.businesses.push({ id: 'c0000000-0000-4000-8000-000000000003', name: 'Paid up', status: 'active', paid_until: '2099-01-01' });
  const n = await limits.enforceBilling(Date.parse('2026-11-06T06:00:00Z'));
  assert.strictEqual(n, 1);
  assert.strictEqual(db.businesses.find(b => b.id === BIZ).status, 'suspended');
  assert.strictEqual(db.businesses.find(b => b.id === OTHER).status, 'active', 'no paid-until date = never auto-paused');
  assert.ok(db.audit_log.some(a => a.action === 'business.suspended_unpaid'));
});

// ---- enforcement ---------------------------------------------------------------------------
test('team size: the invite is refused at the limit', async () => {
  assert.ifError((await team.inviteStaff(owner, 'second@mayura.test', 'agent')).error); // 2 of 2
  const r = await team.inviteStaff(owner, 'third@mayura.test', 'agent');
  assert.match(r.error, /Starter plan allows 2 team members/);
  assert.strictEqual(r.limitReached, true);
});

test('contacts: staff can\'t add more at the limit (incoming customers are never blocked)', async () => {
  assert.ifError((await inbox.startConversation(owner, '919000000002', 'B')).error); // 2 of 2
  const r = await inbox.startConversation(owner, '919000000003', 'C');
  assert.match(r.error, /2 contacts/);
});

test('broadcasts: a campaign bigger than what is left this month is refused', async () => {
  db.whatsapp_leads.push(...['2', '3', '4'].map(n => ({ business_id: BIZ, phone: `91900000000${n}`, name: n, opted_out: false })));
  const r = await campaigns.createCampaign(owner, { name: 'Big', templateName: 'promo', language: 'en', segment: {} });
  assert.match(r.error, /needs 4 broadcast messages but your Starter plan has 3 left/);
});

test('broadcasts: the sender stops at the monthly limit and counts what it sent', async () => {
  db.whatsapp_leads.push({ business_id: BIZ, phone: '919000000002', name: 'B', opted_out: false });
  db.usage_counters.push({ business_id: BIZ, period: limits.currentPeriod(), broadcasts_sent: 2, ai_replies: 0 });
  // Plan allows 3: with 2 used, a 2-person campaign can't even be created...
  assert.match((await campaigns.createCampaign(owner, { name: 'Two', templateName: 'promo', language: 'en', segment: {} })).error, /has 1 left/);
  // ...and if one was queued anyway (e.g. before a plan change), only 1 more goes out.
  const needs = require('../server/templates.cjs').templateNeeds(TEMPLATE);
  db.campaigns.push({ id: 'c1', business_id: BIZ, name: 'Queued', status: 'sending', template_name: 'promo', template_language: 'en', variables: { header: [], body: [], needs } });
  db.campaign_recipients.push(
    { id: 1, business_id: BIZ, campaign_id: 'c1', phone: '919000000001', status: 'queued' },
    { id: 2, business_id: BIZ, campaign_id: 'c1', phone: '919000000002', status: 'queued' },
  );
  const totals = await campaigns.processBatches({ deadlineMs: 6000 });
  assert.strictEqual(totals.sent, 1);
  assert.strictEqual(totals.skipped, 1);
  assert.match(db.campaign_recipients.find(r => r.status === 'skipped').error, /limit/);
  assert.deepStrictEqual(usageCalls, [{ p_business: BIZ, p_metric: 'broadcasts_sent', p_amount: 1 }]);
});

test('follow-ups: no more active ones than the plan allows', async () => {
  db.automations.push({ id: 'a1', business_id: BIZ, is_active: true });
  const r = await automations.createAutomation(owner, { name: 'Second', trigger: 'item_viewed', delayMinutes: 60, templateName: 'promo', language: 'en' });
  assert.match(r.error, /1 active follow-ups/);
  // Paused ones can still be saved.
  assert.ifError((await automations.createAutomation(owner, { name: 'Paused', trigger: 'item_viewed', delayMinutes: 60, templateName: 'promo', language: 'en', isActive: false })).error);
});

test('AI: not in the plan means the bot flow answers, and it can\'t be switched on', async () => {
  assert.deepStrictEqual(await ai.answerCustomer({ businessId: BIZ, phone: '919000000001', catalog: {} }), { skip: true, reason: 'plan has no AI' });
  assert.match((await ai.saveSettings({ autoReply: true }, owner)).error, /doesn't include AI/);
});

test('AI: replies stop at the monthly limit', async () => {
  seed({ plan: { ai_enabled: true, max_ai_replies_month: 5 } });
  db.usage_counters.push({ business_id: BIZ, period: limits.currentPeriod(), broadcasts_sent: 0, ai_replies: 5 });
  assert.deepStrictEqual(await ai.answerCustomer({ businessId: BIZ, phone: '919000000001', catalog: {} }), { skip: true, reason: 'AI reply limit reached' });
});

test('analytics history is cut to the plan; another business\'s plan is not affected', async () => {
  assert.strictEqual(await limits.clampAnalyticsDays(BIZ, 365), 30);
  assert.strictEqual(await limits.clampAnalyticsDays(BIZ, 7), 7);
  assert.strictEqual(await limits.clampAnalyticsDays(OTHER, 365), 365);
});

test('a per-business override lifts one limit without changing the plan', async () => {
  seed({ overrides: { max_staff: 5 } });
  assert.ifError((await team.inviteStaff(owner, 'second@mayura.test', 'agent')).error);
  assert.ifError((await team.inviteStaff(owner, 'third@mayura.test', 'agent')).error);
});

test('the usage report shows each limit, warnings at 80%, and AI not included', async () => {
  db.usage_counters.push({ business_id: BIZ, period: limits.currentPeriod(), broadcasts_sent: 3, ai_replies: 0 });
  const r = await limits.usageReport(BIZ);
  const by = Object.fromEntries(r.metrics.map(m => [m.key, m]));
  assert.strictEqual(r.planName, 'Starter');
  assert.deepStrictEqual([by.broadcasts.used, by.broadcasts.limit, by.broadcasts.reached], [3, 3, true]);
  assert.deepStrictEqual([by.contacts.used, by.contacts.limit, by.contacts.warning, by.contacts.reached], [1, 2, false, false]);
  assert.strictEqual(by.aiReplies.notIncluded, true);
  assert.strictEqual(r.billing.state, 'ok');
});
