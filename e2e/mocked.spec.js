// Browser tests with a FAKE backend: a signed-in owner and canned /api answers, so every screen
// that uses the shared data cache (src/queryClient.js) can be clicked through with no real login
// and no real data. Also proves the Netlify-credit rule: nothing refreshes while the tab is hidden.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import 'dotenv/config';

// The production Content Security Policy (netlify.toml), enforced on the page in these tests too, so
// every screen they open proves it works under the policy. A violation is logged as a console error.
const CSP = (readFileSync(new URL('../netlify.toml', import.meta.url), 'utf8').match(/^\s*Content-Security-Policy\s*=\s*"([^"]+)"/m) || [])[1];

async function enforceCsp(page) {
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`CSP violation: ${e.violatedDirective} blocked ${e.blockedURI || 'inline'}`);
    });
  });
  // Every page address of the app (/, /app, /admin/ads, /platform/health, ...), not files or the API.
  await page.route((url) => ['localhost', '127.0.0.1'].includes(url.hostname) && !url.pathname.includes('.') && !url.pathname.startsWith('/api/'), async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': CSP } });
  });
}

const require = createRequire(import.meta.url);
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
const { summarise } = require('../server/analytics.cjs');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://fgflvtxqdlchclrfybca.supabase.co';
const STORAGE_KEY = `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`;
const BIZ = 'a0000000-0000-4000-8000-000000000001';
const ME = { id: 'e2e00000-0000-4000-8000-000000000001', email: 'owner@e2e.test', role: 'owner' };
const NOW = new Date().toISOString();
const LEAD = { phone: '919000000001', name: 'Ravi Kumar', last_message: 'Do you deliver today?', last_contacted_at: NOW, last_inbound_at: NOW, stage: 'new', unread_count: 1, assigned_to: null, tags: ['vip'], source: 'Instagram Ad', created_at: NOW };

function analyticsReport() {
  const from = new Date(Date.now() - 29 * 86400000).toISOString();
  const leads = [{ ...LEAD, created_at: NOW }];
  return {
    ...summarise({ leads, allLeads: leads, messages: [{ contact_phone: LEAD.phone, direction: 'inbound', timestamp: NOW }], events: [], from, to: NOW }),
    campaigns: [], automations: [],
  };
}

const ANSWERS = {
  '/api/status': { phoneNumber: '919000000100', business: { name: 'E2E Test Kitchen' } },
  // A business on the basic flow (not Arogya's food bot).
  '/api/bot-catalog': { catalog: { foodBuiltIns: false, welcomeMessage: 'Welcome! 👋 How can we help?', welcomeButtons: [{ id: 'btn_menu', title: '📋 Our services' }, { id: 'btn_talk_staff', title: '💬 Talk to our team' }], menuItems: [], orderConfirmReply: 'Thanks!', staffNotificationReply: 'Our team will reply.' } },
  '/api/bot-rules': { rules: [] },
  '/api/business/usage': { metrics: [], billing: { state: 'ok' } },
  '/api/ai/settings': { settings: { auto_reply: false }, status: { configured: false }, role: 'owner' },
  '/api/team': { staff: [{ user_id: ME.id, email: ME.email, role: 'owner' }, { user_id: 'e2e00000-0000-4000-8000-000000000002', email: 'agent@e2e.test', role: 'agent' }], me: ME },
  '/api/inbox': { conversations: [LEAD] },
  '/api/inbox-numbers': { numbers: [{ id: '111111111111111', label: '', phoneNumber: '919000000100', main: true }] },
  [`/api/inbox/${LEAD.phone}`]: { contact: LEAD, messages: [{ id: 'wamid.1', direction: 'inbound', body: 'Do you deliver today?', type: 'text', timestamp: NOW }], notes: [] },
  '/api/pipeline': { columns: { new: [LEAD], interested: [], ordered: [], completed: [], repeat: [], lost: [] } },
  '/api/queries': { queries: [] },
  '/api/queries/settings': { categories: { customer: [], internal: [], platform: [] }, dueHours: {}, stages: [], priorities: [] },
  '/api/support': { queries: [] },
  // Home "My work" (filled in by the Home test).
  '/api/home': { myChats: [], newChats: [], myQueries: [], newQueries: [], waitingOnMe: [], today: { repliesSent: 0, myOpenChats: 0, overdueQueries: 0 } },
  '/api/home/team': { unassignedWaiting: 0, waitingTotal: 0, broadcastsSending: 0, longestWaiting: [], overdueQueries: [], people: [] },
  // Header bell (counts only).
  '/api/notifications': { items: [{ key: 'newChats', count: 1, label: '1 new chat nobody has taken yet', view: 'chat', level: 'normal' }], total: 1 },
  '/api/ads': { success: true, adsEnabled: false, account: { connected: false }, report: null, role: 'owner' },
  '/api/ads/billing': { success: true, billing: null, checkedAt: null, billingUrl: 'https://business.facebook.com/billing_hub/accounts/details/?asset_id=1', canEditLimit: true },
  // Broadcasts
  '/api/broadcast/account': { wabaConfigured: true, phone: { display_phone_number: '+91 90000 00100' }, dailyLimit: 1000, role: 'owner' },
  '/api/templates': { templates: [{ name: 'diwali_offer', language: 'en', status: 'APPROVED', category: 'MARKETING', components: [{ type: 'BODY', text: 'Hi {{1}}, our Diwali sweets are here.' }] }] },
  '/api/campaigns': { campaigns: [{ id: 'c0000000-0000-4000-8000-000000000001', name: 'Diwali Offer', status: 'completed', template_name: 'diwali_offer', template_language: 'en', created_at: NOW, created_by: ME.email, stats: { total: 10, sent: 10, delivered: 9, read: 5, replied: 1, failed: 0, skipped: 0 } }] },
  '/api/automations': { automations: [{ id: 'd0000000-0000-4000-8000-000000000001', name: 'Follow-up after enquiry', trigger: 'order_enquiry', delay_minutes: 60, template_name: 'diwali_offer', template_language: 'en', is_active: true, stats: null, created_at: NOW }] },
  '/api/audience/options': { sources: ['Instagram Ad'], tags: ['vip'], total: 1, optedOut: 0 },
  // Settings pages
  '/api/whatsapp': { connected: true, source: 'saved', phoneNumber: '919000000100', phoneNumberId: '111111111111111', wabaId: '222222222222222', tokenLast4: '1234', hasAppSecret: true, webhookUrl: 'https://example.test/webhook/abc', verifyToken: 'verify-e2e', role: 'owner', encryptionReady: true },
  '/api/business/checklist': { doneCount: 1, total: 2, steps: [{ id: 'wa', label: 'Connect your WhatsApp number', done: true, who: 'owner', view: 'whatsapp' }, { id: 'team', label: 'Invite your team', done: false, who: 'owner', view: 'team' }] },
  '/api/business': { business: { name: 'E2E Test Kitchen', sendWindowStart: 9, sendWindowEnd: 20 } },
};
// Team performance (server/staffStats.cjs): two people.
const STAT = (over) => ({
  userId: ME.id, email: ME.email, role: 'owner', joinedAt: NOW, repliesSent: 40, chatsHandled: 12, medianResponseMin: 6, conversions: 3, openChats: 5,
  queriesResolved: 2, openQueries: 1, avgRating: 4.5, notes: 4, calls: 2, talkMin: 9, activeDays: 8, lastActive: NOW, points: 70, rank: 1,
  daily: Array.from({ length: 30 }, (_, i) => ({ day: new Date(Date.now() - (29 - i) * 86400000).toISOString().slice(0, 10), replies: i % 5 })), ...over,
});
const POINTS = { chats: 2, conversions: 10, queriesResolved: 5, calls: 3, notes: 1 };
ANSWERS['/api/me/profile'] = { from: NOW, days: 30, teamSize: 2, points: POINTS, profile: { email: ME.email, role: 'owner', businessName: 'E2E Test Kitchen', fullName: 'Asha Rao', phone: '+91 90000 00001', jobTitle: 'Owner', languages: 'Telugu, English' }, stats: STAT({ fullName: 'Asha Rao' }) };
ANSWERS['/api/team/performance'] = {
  from: NOW, days: 30, points: POINTS,
  team: { repliesSent: 55, chatsHandled: 17, conversions: 4, queriesResolved: 3, calls: 2, notes: 5, medianResponseMin: 7 },
  members: [
    STAT({ fullName: 'Asha Rao', jobTitle: 'Owner' }),
    STAT({ userId: 'e2e00000-0000-4000-8000-000000000002', email: 'agent@e2e.test', role: 'agent', fullName: 'Ravi Kumar', points: 21, rank: 2, chatsHandled: 5, repliesSent: 15, medianResponseMin: 3 }),
  ],
};
ANSWERS['/api/team/members/e2e00000-0000-4000-8000-000000000002'] = { from: NOW, days: 30, teamSize: 2, points: POINTS, team: ANSWERS['/api/team/performance'].team, member: { ...ANSWERS['/api/team/performance'].members[1], phone: '+91 90000 00002', languages: 'Telugu' } };
// Contacts at 85% of the plan: the header shows the plan banner.
ANSWERS['/api/business/usage'] = {
  planId: 'growth', planName: 'Growth', period: '2026-11', analyticsDays: 90, aiIncluded: true, billing: { state: 'ok' },
  metrics: [{ key: 'contacts', label: 'Contacts', used: 8500, limit: 10000, percent: 85, warning: true, reached: false }],
};

// The business's own lead statuses (server/leadStatuses.cjs): a hospital's words + one custom step.
const LS = (key, label, type, color, order, active = true) => ({ key, label, hint: null, color, type, sort_order: order, active });
ANSWERS['/api/lead-statuses'] = {
  statuses: [LS('new', 'New enquiry', 'new', 'slate', 1), LS('interested', 'Called back', 'working', 'amber', 2), LS('s_report', 'Report sent', 'working', 'indigo', 3), LS('ordered', 'Booked', 'won', 'sky', 4), LS('completed', 'Visited', 'done', 'violet', 5), LS('repeat', 'Follow-up visit', 'repeat', 'emerald', 6), LS('lost', 'Not interested', 'lost', 'rose', 7)],
  types: [['new', 'New'], ['working', 'Working on it'], ['won', 'Booked / ordered'], ['done', 'Done (visited / delivered)'], ['repeat', 'Returning'], ['lost', 'Lost / closed']].map(([key, label]) => ({ key, label })),
  colors: ['slate', 'amber', 'sky', 'violet', 'emerald', 'rose', 'teal', 'indigo'], max: 12,
  counts: { new: 1, interested: 0, s_report: 2, ordered: 0, completed: 0, repeat: 0, lost: 0 },
};

// Clinic module (server/clinic.cjs): off for this (generic) test business unless a test turns it on.
ANSWERS['/api/clinic/status'] = { enabled: false };

// Inbox / Leads filter menus (server/leadsTools.cjs filterOptions).
ANSWERS['/api/inbox-filter-options'] = { sources: ['Direct WhatsApp', 'Instagram Ad', 'Phone call', 'Walk-in'], tags: ['vip'], ads: [{ id: '555', headline: 'Free check-up' }], addSources: ['Phone call', 'Walk-in', 'Referral', 'Website form', 'Other'] };

// Available / Away (server/leadAssignment.cjs) and the rotation settings.
ANSWERS['/api/me/availability'] = { availability: { available: true, days: [0, 1, 2, 3, 4, 5, 6], startHour: null, endHour: null, onShift: true }, sendWindow: { start: 9, end: 20 } };
ANSWERS['/api/lead-assignment'] = {
  settings: { mode: 'off', maxOpen: null, perNumber: false, updatedBy: null, updatedAt: null },
  teams: [{ numberId: '', members: [], availableNow: [] }],
  people: [{ email: 'owner@e2e.test', role: 'owner', available: true, onShift: true, atCap: false, open: 1 }, { email: 'agent@e2e.test', role: 'agent', available: false, onShift: true, atCap: false, open: 0 }],
  numbers: [{ id: '111111111111111', label: '', phoneNumber: '919000000100', main: true }], sendWindow: { start: 9, end: 20 }, tableReady: true,
};

/** Fake signed-in owner + canned API. Returns a counter of GET requests per path. */
async function fakeBackend(page, { role = 'owner' } = {}) {
  const hits = {};
  await enforceCsp(page);
  await page.addInitScript(([key, user]) => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem(key, JSON.stringify({
      access_token: 'e2e-fake-token', token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'e2e-refresh',
      user: { id: user.id, email: user.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} },
    }));
  }, [STORAGE_KEY, ME]);
  // Supabase: this user is staff (owner) of one business and not a platform admin.
  await page.route('**/rest/v1/staff_members*', r => r.fulfill({ json: { role, business_id: BIZ } }));
  await page.route('**/rest/v1/platform_admins*', r => r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }));
  await page.route('**/rest/v1/clinic_doctors*', r => r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }));
  await page.route('**/auth/v1/**', r => r.fulfill({ json: {} }));
  const report = analyticsReport();
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (route.request().method() === 'GET') hits[path] = (hits[path] || 0) + 1;
    if (route.request().method() !== 'GET') return route.fulfill({ json: { success: true } });
    if (path === '/api/analytics') return route.fulfill({ json: report });
    if (path === '/api/queries/stats') return route.fulfill({ json: { total: 0 } });
    const body = ANSWERS[path];
    return route.fulfill(body ? { json: body } : { status: 404, json: { error: `no mock for ${path}` } });
  });
  return hits;
}

/** Open a screen from the side menu (desktop): work, grow and settings pages are all listed there (U1). */
async function openScreen(page, name, opts) {
  await page.getByRole('navigation', { name: 'Main menu' }).getByRole('link', { name, exact: true }).click(opts);
}
/** The account menu (avatar, top right): My profile, Raise a query, Larger text, Sign out. */
async function openAccountMenu(page) {
  await page.getByRole('button', { name: 'Your account' }).click();
  return page.getByRole('menu');
}

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/status of 404/.test(m.text())) errors.push(`console: ${m.text()}`); });
  return errors;
}

test('signed in (fake backend): Inbox, Pipeline, Queries, Analytics, Ads and Team all render', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page);
  await page.goto('/app');
  await expect(page.getByRole('link', { name: 'Inbox', exact: true })).toBeVisible({ timeout: 20000 });

  // Inbox: the list and an open chat. (Everyone lands on Home first.)
  await openScreen(page, 'Inbox');
  await expect(page.locator('[data-testid="chat-row"]')).toHaveCount(1);
  await page.locator('[data-testid="chat-row"]').first().click();
  await expect(page.locator('[data-testid="chat-header"]')).toContainText(LEAD.phone);
  await expect(page.getByText('Do you deliver today?').last()).toBeVisible();
  // One WhatsApp number: no number badges, filter or "Reply from" (the inbox looks as before).
  await expect(page.getByTestId('number-filter')).toHaveCount(0);
  await expect(page.getByTestId('number-badge')).toHaveCount(0);
  await expect(page.getByTestId('reply-from')).toHaveCount(0);

  const checks = [
    ['Pipeline', 'Customer pipeline'],
    ['Queries', 'Raise a query'],
    ['Analytics', 'New leads per day'],
    ['Ads', 'Your plan does not include the Ads module'],
    ['Team', 'agent@e2e.test'],
  ];
  for (const [tab, expected] of checks) {
    await openScreen(page, tab);
    await expect(page.getByText(expected).first(), `${tab} shows "${expected}"`).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Something went wrong/)).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test('signed in (fake backend): Broadcasts, Automations, AI, WhatsApp, Setup, plan banner and query panels render', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page);
  await page.goto('/app');
  await expect(page.getByRole('link', { name: 'Inbox', exact: true })).toBeVisible({ timeout: 20000 });
  // Header: business name from /api/status, plan banner from /api/business/usage.
  await expect(page.getByText('E2E Test Kitchen').first()).toBeVisible();
  await expect(page.getByText('Over 80% of your plan: contacts.')).toBeVisible();

  // Inbox side panel: this contact's queries.
  await openScreen(page, 'Inbox');
  await page.locator('[data-testid="chat-row"]').first().click();
  await expect(page.getByText('Raise query').first()).toBeVisible();

  await page.getByRole('link', { name: 'Broadcasts', exact: true }).click();
  await expect(page.getByText('Diwali Offer').first()).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: /Templates/ }).first().click();
  await expect(page.getByText('diwali_offer').first()).toBeVisible();
  await page.getByRole('button', { name: /Automations/ }).first().click();
  await expect(page.getByText('Follow-up after enquiry').first()).toBeVisible();

  const checks = [
    ['AI assistant', 'AI replies: OFF'],
    ['WhatsApp', 'Connected number'],
    ['Setup', '1 of 2 done'],
  ];
  for (const [tab, expected] of checks) {
    await openScreen(page, tab);
    await expect(page.getByText(expected).first(), `${tab} shows "${expected}"`).toBeVisible({ timeout: 15000 });
    if (tab === 'WhatsApp') {
      // The connected number and its saved details, read-only (the token only as its last 4).
      await expect(page.getByTestId('wa-number')).toHaveText('+919000000100');
      await expect(page.getByTestId('wa-details')).toContainText('111111111111111');
    }
  }

  // The bot editors (menus from /api/bot-catalog, rules from /api/bot-rules).
  // A non-Arogya business gets the basic flow editor (no food tabs), and can add a service.
  await openScreen(page, 'Bot Flow');
  await expect(page.getByRole('heading', { name: 'WhatsApp Bot Flow' })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/28-Day|Ready to Eat|Arogya/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Add a service or product' }).click();
  await page.getByPlaceholder('e.g. General consultation').fill('General consultation');
  await page.getByRole('button', { name: 'Add item' }).click();
  const saved = page.waitForRequest(r => r.url().endsWith('/api/bot-catalog') && r.method() === 'POST');
  await page.getByRole('button', { name: 'Save changes' }).click();
  const body = (await saved).postDataJSON();
  expect(body.catalog.menuItems.map(i => i.title)).toEqual(['General consultation']);
  expect(body.catalog.welcomeButtons.map(b => b.id)).toEqual(['btn_menu', 'btn_talk_staff']);
  await openScreen(page, 'Auto-replies');
  await expect(page.getByRole('heading', { name: 'Auto-replies' })).toBeVisible({ timeout: 15000 });

  // "Raise a query" from the account menu (categories come from the shared cache).
  // (A Business Admin sends queries to Platform support only.)
  await (await openAccountMenu(page)).getByRole('menuitem', { name: 'Raise a query' }).click();
  await expect(page.getByRole('heading', { name: 'Raise a query' })).toBeVisible();
  await expect(page.getByText('Platform support').first()).toBeVisible();

  await expect(page.getByText(/Something went wrong/)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Meta setup guides: WhatsApp (connected: closed until opened) and Ads (not connected: open), with links', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page);
  // Ads included in the plan, no ad account yet (registered after fakeBackend, so it wins).
  await page.route((url) => url.pathname === '/api/ads', r => r.fulfill({ json: { success: true, adsEnabled: true, account: { connected: false }, report: null, role: 'owner' } }));
  await page.goto('/app');
  await expect(page.getByRole('link', { name: 'Inbox', exact: true })).toBeVisible({ timeout: 20000 });

  await openScreen(page, 'WhatsApp');
  const wa = page.getByTestId('guide-whatsapp');
  await expect(wa).toBeVisible({ timeout: 15000 });
  await expect(wa.getByText('Copy the Phone number ID and the WhatsApp Business Account ID')).toHaveCount(0); // connected: closed
  await wa.getByRole('button', { name: /connect your WhatsApp number/ }).click();
  await expect(wa.getByText('Copy the Phone number ID and the WhatsApp Business Account ID')).toBeVisible();
  await expect(wa.getByText('Things to know before you connect')).toBeVisible();
  const sys = wa.getByRole('link', { name: /System users/ }).first();
  await expect(sys).toHaveAttribute('href', 'https://business.facebook.com/settings/system-users');
  await expect(sys).toHaveAttribute('target', '_blank');
  await page.screenshot({ path: 'test-results/guide-whatsapp.png', fullPage: true });

  await page.getByRole('link', { name: 'Ads', exact: true }).click();
  const ads = page.getByTestId('guide-ads');
  await expect(ads.getByText('Find your ad account ID')).toBeVisible({ timeout: 15000 }); // not connected: open
  await expect(ads.getByText('Limits and things to know')).toBeVisible();
  await expect(ads.getByRole('link', { name: /Ads Manager/ }).first()).toHaveAttribute('href', 'https://adsmanager.facebook.com/adsmanager/');
  await expect(page.getByRole('heading', { name: 'Connect your Meta ad account' })).toBeVisible(); // the form is still there
  await page.screenshot({ path: 'test-results/guide-ads.png', fullPage: true });

  expect(errors).toEqual([]);
});

test('Ads page: Campaigns and Ads tabs, latest first, 10 per page, search and details', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page);
  // 23 ads in 3 campaigns; ad N last ran on day N of November, so "Ad 23" is the latest.
  const day = (n) => `2026-11-${String(n).padStart(2, '0')}`;
  const adRows = Array.from({ length: 23 }, (_, i) => {
    const n = i + 1;
    return {
      adId: `90${n}`, adName: `Ad ${n}`, campaignId: `c${n % 3}`, campaignName: ['Winter offer', 'Diwali sweets', 'Brand'][n % 3],
      adsetId: `s${n}`, adsetName: `Set ${n}`, status: n % 4 ? 'ACTIVE' : 'PAUSED', firstDate: day(1), lastDate: day(n),
      spend: 100 * n, impressions: 1000 * n, reach: 800 * n, clicks: 10 * n, ctr: 0.01, costPerClick: 10, metaConversations: n,
      newContacts: 1, returning: 0, chats: 1, converted: n % 2, costPerChat: 100 * n, costPerConverted: n % 2 ? 100 * n : null, costPerMetaConversation: 100,
    };
  }).reverse(); // server order: latest first
  const campaigns = ['Winter offer', 'Diwali sweets', 'Brand'].map((name, k) => ({
    campaignId: `c${k}`, campaignName: name, ads: adRows.filter(a => a.campaignId === `c${k}`).length, activeAds: 3, adsets: 7,
    firstDate: day(1), lastDate: day(23 - ((3 + 23 % 3 - k) % 3)), spend: 1000, impressions: 1, clicks: 1, ctr: 0.01, metaConversations: 1, chats: 1, converted: 1, costPerChat: 1000, costPerConverted: 1000,
  }));
  const report = {
    range: { from: NOW, days: 30, startDay: day(1) }, currency: 'INR', alertWindowDays: 3, alerts: [],
    totals: { spend: 27600, impressions: 1, clicks: 1, metaConversations: 1, chats: 23, converted: 12, costPerChat: 1200, costPerConverted: 2300, ctr: 0.01, otherAdChats: 0 },
    campaigns, ads: adRows,
  };
  // Ad previews: thumbnails for the page on screen, and Meta's preview frame (served here, offline).
  const thumbAsks = [];
  const previewFormats = [];
  await page.route('**/api/ads/thumbnails?*', r => {
    const ids = new URL(r.request().url()).searchParams.get('ids');
    thumbAsks.push(ids);
    return r.fulfill({ json: { success: true, thumbnails: Object.fromEntries(ids.split(',').map(id => [id, { thumbnailUrl: `${new URL(r.request().url()).origin}/preview-thumb.png` }])) } });
  });
  await page.route('**/preview-thumb.png', r => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64') }));
  await page.route('**/api/ads/ads/*/preview*', r => {
    const u = new URL(r.request().url());
    previewFormats.push(u.searchParams.get('format'));
    return r.fulfill({ json: { success: true, adId: u.pathname.split('/')[4], name: 'Ad', status: 'ACTIVE', format: u.searchParams.get('format'), formats: [], frameUrl: 'https://business.facebook.com/ads/api/preview_iframe.php?d=e2e', image: null, text: 'Book a free check-up today.', headline: 'Free check-up', cta: 'whatsapp message' } });
  });
  await page.route('https://business.facebook.com/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<html><body style="font-family:sans-serif;padding:16px">Meta ad preview (test)</body></html>' }));
  await page.route('**/api/ads?*', r => r.fulfill({ json: { adsEnabled: true, account: { connected: true, adAccountId: 'act_1', name: 'E2E Ads', currency: 'INR', lastSyncAt: NOW, alerts: { maxCostPerChat: null, maxCostPerConversion: null, windowDays: 3 } }, report } }));

  await page.goto('/app');
  await page.getByRole('link', { name: 'Ads', exact: true }).click({ timeout: 20000 });
  const tabs = page.getByRole('tablist', { name: 'Ad results' });
  await expect(tabs.getByRole('tab', { name: /Ad campaigns/ })).toHaveAttribute('aria-selected', 'true', { timeout: 15000 });
  await expect(page.getByText('Showing 1–3 of 3 campaigns')).toBeVisible();

  // Ads tab: 10 per page, latest first, 3 pages.
  await tabs.getByRole('tab', { name: /Ads/ }).click();
  const titles = page.locator('ul h3');
  await expect(titles).toHaveCount(10);
  await expect(titles.first()).toHaveText('Ad 23');
  await expect(page.getByText('Showing 1–10 of 23 ads')).toBeVisible();
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(titles.first()).toHaveText('Ad 13');
  await page.getByRole('button', { name: '3', exact: true }).click();
  await expect(titles).toHaveCount(3);
  await expect(page.getByText('Showing 21–23 of 23 ads')).toBeVisible();
  await page.screenshot({ path: 'test-results/ads-tab.png', fullPage: true });

  // Search starts again at page 1; details open below an ad.
  await page.getByRole('textbox', { name: 'Search' }).fill('Ad 7');
  await expect(titles).toHaveCount(1);
  await page.getByRole('button', { name: 'Details' }).click();
  await expect(page.getByText('Cost per Meta conversation')).toBeVisible();
  await expect(page.getByText('Set 7', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search' }).fill('');

  // "View ads" on a campaign shows only that campaign's ads.
  await tabs.getByRole('tab', { name: /Ad campaigns/ }).click();
  await page.screenshot({ path: 'test-results/ads-campaigns.png', fullPage: true });
  await page.getByRole('listitem').filter({ hasText: 'Diwali sweets' }).getByRole('button', { name: 'View ads' }).click();
  await expect(page.getByText('Showing 1–8 of 8 ads')).toBeVisible();
  await expect(titles.first()).toHaveText('Ad 22');

  // Thumbnails next to the names (one request for the page), and the Preview window.
  await expect(page.locator('ul img').first()).toHaveAttribute('src', /preview-thumb\.png$/);
  expect(thumbAsks.length).toBeGreaterThan(0);
  expect(thumbAsks.at(-1).split(',').length).toBeLessThanOrEqual(10);
  await page.getByRole('button', { name: 'Preview', exact: true }).first().click();
  const dlg = page.getByRole('dialog', { name: /Preview of Ad 22/ });
  await expect(dlg.getByText('Book a free check-up today.')).toBeVisible({ timeout: 15000 });
  await expect(dlg.locator('iframe')).toHaveAttribute('src', /^https:\/\/business\.facebook\.com\/ads\/api\/preview_iframe\.php/);
  await dlg.getByRole('button', { name: 'Instagram feed' }).click();
  await expect.poll(() => previewFormats.at(-1)).toBe('INSTAGRAM_STANDARD');
  await page.screenshot({ path: 'test-results/ads-preview.png' });
  await dlg.getByRole('button', { name: 'Close' }).click();
  expect(errors).toEqual([]);
});

test('agents see only Inbox, Pipeline and Queries, and never load admin data', async ({ page }) => {
  const errors = watchErrors(page);
  const hits = await fakeBackend(page, { role: 'agent' });
  // What the server now sends agents: only whether AI replies are on.
  await page.route('**/api/ai/settings', r => r.fulfill({ json: { settings: { auto_reply: true }, status: { configured: false }, role: 'agent' } }));
  await page.goto('/app');
  const menu = page.getByRole('navigation', { name: 'Main menu' });
  await expect(menu.getByRole('link', { name: 'Inbox' })).toBeVisible({ timeout: 20000 });
  await expect(menu.getByRole('link')).toHaveText(['Home', /^Inbox/, 'Pipeline', 'Queries', 'My profile']);
  await expect(page.getByText('Agent', { exact: true })).toBeVisible();
  for (const name of ['Supabase', 'Webhook', 'Webhook details', 'Data and sync']) await expect(page.getByRole('button', { name })).toHaveCount(0);
  await expect(page.getByRole('switch')).toHaveCount(0); // AI: a status badge, not a switch
  await expect(page.getByText('AI on', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /New chat/ })).toBeVisible();
  await expect(page.getByTestId('bell')).toBeVisible();
  const account = await openAccountMenu(page);
  await expect(account.getByRole('menuitem')).toHaveText(['My profile', 'Raise a query', 'Sign out']);
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'test-results/agent-inbox.png' });

  await menu.getByRole('link', { name: 'Pipeline' }).click();
  await expect(menu.getByRole('link', { name: 'Pipeline' })).toHaveAttribute('aria-current', 'page');
  await menu.getByRole('link', { name: 'Queries' }).click();
  await expect(menu.getByRole('link', { name: 'Queries' })).toHaveAttribute('aria-current', 'page');

  for (const path of ['/api/bot-catalog', '/api/bot-rules', '/api/business/usage', '/api/analytics', '/api/whatsapp', '/api/campaigns']) {
    expect(hits[path] || 0, `agent dashboard requested ${path}`).toBe(0);
  }

  // Phone width: the three menu items and the actions still fit, no sideways page scroll.
  await page.setViewportSize({ width: 390, height: 800 });
  await menu.getByRole('link', { name: 'Inbox' }).click();
  await expect(menu.getByRole('link', { name: 'Queries' })).toBeInViewport();
  await expect(menu.getByRole('link', { name: 'Inbox' })).toHaveAttribute('aria-current', 'page');
  await expect(menu.getByRole('link', { name: 'Queries' })).not.toHaveAttribute('aria-current', 'page');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.waitForTimeout(400); // let the button colour transition finish for the screenshot
  await page.screenshot({ path: 'test-results/agent-phone.png' });
  expect(errors).toEqual([]);
});

test('each screen has its own address in the role\'s area: refresh stays, Back works, Settings and Ads tabs have addresses, old links move', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page);
  // Business Admin: /app (old address) -> /admin/inbox.
  await page.goto('/app');
  await expect(page).toHaveURL(/\/admin\/home$/, { timeout: 20000 });
  const menu = page.getByRole('navigation', { name: 'Main menu' });
  await expect(menu.getByRole('link')).toHaveText(['Home', /^Inbox/, 'Pipeline', 'Leads', 'Queries', 'Broadcasts', 'Ads', 'Analytics', 'Setup', 'WhatsApp', 'Team', 'Lead statuses', 'Lead assignment', 'Customer fields', 'Activity log', 'Bot Flow', 'Auto-replies', 'AI assistant', 'My profile']);
  await menu.getByRole('link', { name: 'Ads', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/ads\/results$/);
  await expect(menu.getByRole('link', { name: 'Ads', exact: true })).toHaveAttribute('aria-current', 'page');
  // The reported problem: a refresh on Ads went back to the Inbox.
  await page.reload();
  await expect(page).toHaveURL(/\/admin\/ads\/results$/);
  await expect(menu.getByRole('link', { name: 'Ads', exact: true })).toHaveAttribute('aria-current', 'page', { timeout: 20000 });
  // Settings pages: listed in the side menu on desktop; /admin/settings opens Setup.
  await page.goto('/admin/settings');
  await expect(page).toHaveURL(/\/admin\/settings\/setup$/, { timeout: 20000 });
  const settings = menu;
  await settings.getByRole('link', { name: 'Team', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/settings\/team$/);
  await expect(menu.getByRole('link', { name: 'Team', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('Loading…')).toHaveCount(0, { timeout: 15000 });
  await expect(page.getByTestId('skeleton')).toHaveCount(0, { timeout: 15000 });
  await page.screenshot({ path: 'test-results/settings-area.png' });
  await page.reload();
  await expect(settings.getByRole('link', { name: 'Team', exact: true })).toHaveAttribute('aria-current', 'page', { timeout: 20000 });
  await page.goBack();
  await expect(page).toHaveURL(/\/admin\/settings\/setup$/);
  // Old screen links (/app/team, /app/bot-flow) open the new place.
  await page.goto('/app/bot-flow');
  await expect(page).toHaveURL(/\/admin\/settings\/bot-flow$/, { timeout: 20000 });
  await expect(settings.getByRole('link', { name: 'Bot Flow', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.goto('/admin/no-such-page');
  await expect(page.getByTestId('screen-not-found')).toBeVisible({ timeout: 20000 });
  await page.getByRole('link', { name: 'Go to the Inbox' }).click();
  await expect(page).toHaveURL(/\/admin\/inbox$/);
  expect(errors.filter(e => !/404/.test(e))).toEqual([]);
});

test('protected routes: signed out -> sign-in; each role only opens its own area (/admin, /manager, /agent, /platform); agents never reach managers\' screens', async ({ page }) => {
  await page.goto('/admin/ads');
  await expect(page.getByText('Staff sign-in')).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('navigation', { name: 'Main menu' })).toHaveCount(0);

  const hits = await fakeBackend(page, { role: 'agent' });
  await page.route('**/api/ai/settings', r => r.fulfill({ json: { settings: { auto_reply: true }, status: { configured: false }, role: 'agent' } }));
  // Another role's area: "Not allowed", nothing of it loads.
  for (const path of ['/admin/ads', '/manager/settings/team', '/platform/businesses']) {
    await page.goto(path);
    await expect(page.getByTestId('area-not-allowed'), path).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('navigation', { name: 'Main menu' })).toHaveCount(0);
  }
  // Own area, but a managers' screen: guarded too.
  for (const path of ['/agent/ads', '/agent/settings/team', '/agent/settings', '/agent/broadcasts']) {
    await page.goto(path);
    await expect(page.getByTestId('no-access'), path).toBeVisible({ timeout: 20000 });
  }
  for (const api of ['/api/ads/account', '/api/ads/issues', '/api/team', '/api/business/usage', '/api/campaigns', '/api/platform/overview']) {
    expect(hits[api] || 0, `agent requested ${api}`).toBe(0);
  }
  await page.getByRole('link', { name: 'Go to the Inbox' }).click();
  await expect(page).toHaveURL(/\/agent\/inbox$/);
  // "Go to my dashboard" from another area.
  await page.goto('/admin/inbox');
  await page.getByRole('link', { name: 'Go to my dashboard' }).click();
  await expect(page).toHaveURL(/\/agent\/home$/, { timeout: 20000 });
});

test('a manager\'s area is /manager; the Business Admin\'s /admin is not theirs', async ({ page }) => {
  await fakeBackend(page, { role: 'manager' });
  await page.goto('/app/ads');
  await expect(page).toHaveURL(/\/manager\/ads\/results$/, { timeout: 20000 });
  await page.goto('/admin/ads');
  await expect(page.getByTestId('area-not-allowed')).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(/This address is for the Business Admin/)).toBeVisible();
});

test('Broadcasts guides in pictures: campaigns (flow, phone, funnel) and templates (24-hour rule, parts, category, lifecycle)', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page);
  await page.goto('/admin/broadcasts');
  const campaigns = page.getByTestId('guide-pictures-campaigns');
  await expect(campaigns).toBeVisible({ timeout: 20000 });
  await expect(campaigns.getByRole('group', { name: 'How a broadcast campaign works' })).toContainText('Approved template');
  await expect(campaigns.getByRole('group', { name: 'Broadcast campaign or ad campaign?' })).toContainText('Ad campaign (Ads page)');
  await expect(campaigns.getByRole('group', { name: 'What your customer receives' })).toContainText('Reply STOP to unsubscribe');
  await expect(campaigns.getByRole('group', { name: 'What the results look like' })).toContainText('62 replied');
  await campaigns.screenshot({ path: 'test-results/guide-broadcast-campaigns.png' });

  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  const templates = page.getByTestId('guide-pictures-templates');
  await expect(templates).toBeVisible({ timeout: 15000 });
  await expect(templates.getByRole('group', { name: 'The WhatsApp 24-hour rule' })).toContainText('Only an approved template');
  await expect(templates.getByRole('group', { name: 'The parts of a template' })).toContainText('{{1}}');
  await expect(templates.getByRole('group', { name: 'What the customer sees' })).toContainText('Ravi');
  await expect(templates.getByRole('group', { name: 'Which category should I choose?' })).toContainText('Utility (costs less)');
  await expect(templates.getByRole('group', { name: 'From writing to sending' })).toContainText('Rejected');
  await templates.screenshot({ path: 'test-results/guide-templates.png' });
  await expect(page.getByText('Mayura')).toHaveCount(0);

  await page.getByRole('button', { name: 'Automations', exact: true }).click();
  await expect(page.getByTestId('guide-pictures-automations').getByRole('group', { name: 'How an automatic follow-up works' })).toContainText('Stops by itself', { timeout: 15000 });

  // Phone width: nothing scrolls sideways.
  await page.setViewportSize({ width: 390, height: 900 });
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect(errors.filter(e => !/404/.test(e))).toEqual([]);
});

test('Inbox essentials: saved replies (/shortcut), send a file, open a photo, close with a reason, alert settings', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const convo = {
    contact: { ...LEAD, windowOpen: true, windowClosesAt: new Date(Date.now() + 20 * 3600000).toISOString(), last_inbound_at: NOW },
    messages: [
      { id: 1, message_id: 'wamid.TEXT1', direction: 'inbound', body: 'Do you deliver today?', type: 'text', timestamp: NOW },
      { id: 2, message_id: 'wamid.PHOTO1', direction: 'inbound', body: '📷 Photo', type: 'image', media_mime: 'image/jpeg', timestamp: NOW },
      { id: 3, message_id: 'wamid.DOC1', direction: 'inbound', body: '📄 report.pdf', type: 'document', media_mime: 'application/pdf', media_name: 'report.pdf', timestamp: NOW },
    ],
    notes: [],
  };
  let closed = null; let sentText = null; let uploadAsk = null; let sentFile = null; let mediaAsks = [];
  await page.route(`**/api/inbox/${LEAD.phone}`, r => (r.request().method() === 'GET' ? r.fulfill({ json: convo }) : r.fallback()));
  await page.route(`**/api/inbox/${LEAD.phone}/close`, r => { closed = r.request().postDataJSON(); return r.fulfill({ json: { success: true, contact: {} } }); });
  await page.route(`**/api/inbox/${LEAD.phone}/messages`, r => { sentText = r.request().postDataJSON(); return r.fulfill({ json: { success: true, sent: true } }); });
  await page.route(`**/api/inbox/${LEAD.phone}/media?*`, r => {
    const id = new URL(r.request().url()).searchParams.get('id'); mediaAsks.push(id);
    return r.fulfill({ json: { success: true, url: `https://e2e-test.supabase.co/storage/v1/object/sign/inbox-media/${id}.png?token=dl`, downloadUrl: 'https://e2e-test.supabase.co/x?download=1', mime: 'image/png', name: id === 'wamid.DOC1' ? 'report.pdf' : 'image' } });
  });
  await page.route('https://e2e-test.supabase.co/**', r => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'PUT, OPTIONS', 'Access-Control-Allow-Headers': 'x-upsert, content-type' };
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    if (r.request().method() === 'PUT') return r.fulfill({ status: 200, json: { Key: 'x' }, headers: cors });
    return r.fulfill({ status: 200, body: png, headers: { 'Content-Type': 'image/png', ...cors } });
  });
  await page.route(`**/api/inbox/${LEAD.phone}/media/upload-url`, r => { uploadAsk = r.request().postDataJSON(); return r.fulfill({ json: { success: true, uploadUrl: 'https://e2e-test.supabase.co/storage/v1/object/upload/sign/inbox-media/a/out/x.pdf?token=up', path: `${BIZ}/out/12345678-1234-4234-8234-123456789abc.pdf` } }); });
  await page.route(`**/api/inbox/${LEAD.phone}/media`, r => { sentFile = r.request().postDataJSON(); return r.fulfill({ json: { success: true, sent: true } }); });
  await page.route('**/api/saved-replies', r => r.fulfill({ json: { success: true, ready: true, replies: [
    { id: 1, shortcut: 'timings', title: 'Timings', body: 'Hi {name}, we are open Mon–Sat 9 am to 8 pm.' },
    { id: 2, shortcut: 'thanks', title: 'Thank you', body: 'Thank you! Our team will get back to you shortly.' },
  ] } }));

  await page.goto('/admin/inbox');
  await page.getByTestId('chat-row').first().click({ timeout: 20000 });
  // A photo shows by itself (private short-lived link); a document opens when asked.
  await expect(page.getByAltText('📷 Photo')).toBeVisible();
  await page.getByRole('button', { name: 'Open report.pdf' }).click();
  await expect(page.getByRole('link', { name: 'report.pdf' })).toBeVisible();
  expect(mediaAsks).toEqual(['wamid.PHOTO1', 'wamid.DOC1']);

  // Saved replies: chips, and "/tim" + Enter fills the reply with the customer's first name.
  await expect(page.getByTestId('saved-reply-chips')).toContainText('Timings');
  const box = page.getByLabel('Reply', { exact: true });
  await box.fill('/tim');
  await expect(page.getByTestId('slash-picker')).toContainText('/timings');
  await box.press('Enter');
  await expect(box).toHaveValue('Hi Ravi, we are open Mon–Sat 9 am to 8 pm.');
  await page.screenshot({ path: 'test-results/inbox-essentials.png' });
  await box.press('Enter');
  await expect.poll(() => sentText?.text).toBe('Hi Ravi, we are open Mon–Sat 9 am to 8 pm.');

  // Send a PDF: upload to private storage, then WhatsApp.
  await page.getByTestId('attach-input').setInputFiles({ name: 'Lab report.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 e2e') });
  const dlg = page.getByRole('dialog', { name: 'Send a file' });
  await dlg.getByLabel('Caption').fill('Your lab report');
  await dlg.getByTestId('attach-send').click();
  await expect.poll(() => sentFile?.caption).toBe('Your lab report');
  expect(uploadAsk).toEqual({ type: 'application/pdf', size: 12 });
  expect(sentFile).toEqual({ path: `${BIZ}/out/12345678-1234-4234-8234-123456789abc.pdf`, caption: 'Your lab report', name: 'Lab report.pdf' });

  // Close with a reason.
  await page.getByTestId('close-chat').click();
  const closeBox = page.getByRole('dialog', { name: 'Mark this chat done' });
  await closeBox.getByLabel('Booked / ordered').check();
  await closeBox.getByLabel('Close note').fill('Sunday 10 am');
  await closeBox.getByRole('button', { name: 'Mark done' }).click();
  await expect.poll(() => closed).toEqual({ reason: 'booked', note: 'Sunday 10 am' });

  // Alerts: this person's settings; "Done" is a view of its own (not the pipeline's "Closed" stage).
  await page.getByTestId('alert-bell').click();
  await expect(page.getByRole('dialog', { name: 'New-chat alerts' })).toContainText('Alerts for new chats');
  await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
  // A file's automatic label isn't repeated under it.
  await expect(page.getByText('📄 report.pdf')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Inbox alerts: a message on the business channel for an unassigned chat plays for me and titles the hidden tab', async ({ page }) => {
  await fakeBackend(page);
  await page.goto('/admin/inbox');
  await expect(page.getByTestId('chat-row').first()).toBeVisible({ timeout: 20000 });
  // The Realtime channel is the server's; here the same browser event it produces is fired directly.
  const title = await page.evaluate(async () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    const before = document.title;
    window.dispatchEvent(new CustomEvent('inbox-alert', { detail: { kind: 'message', assignedTo: null, newChat: true } }));
    window.dispatchEvent(new CustomEvent('inbox-alert', { detail: { kind: 'message', assignedTo: 'someone-else@e2e.test', newChat: false } }));
    return [before, document.title];
  });
  expect(title[1]).toBe(`(1) ${title[0]}`); // only the unassigned chat counts for me
});

test('My profile: details, my performance and my rank', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page);
  let saved = null;
  await page.route('**/api/me/profile', r => {
    if (r.request().method() === 'PUT') { saved = r.request().postDataJSON(); return r.fulfill({ json: { success: true } }); }
    return r.fallback();
  });
  await page.goto('/app');
  await page.getByRole('navigation', { name: 'Main menu' }).getByRole('link', { name: 'My profile' }).click({ timeout: 20000 });
  await expect(page.getByRole('heading', { name: 'My profile' })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('#1 of 2 in your team')).toBeVisible();
  await expect(page.getByText('Chats handled', { exact: true })).toBeVisible();
  await expect(page.getByText('Replies per day')).toBeVisible();
  await page.getByLabel('Job title').fill('Founder');
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect.poll(() => saved?.jobTitle).toBe('Founder');
  await page.screenshot({ path: 'test-results/my-profile.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('My profile (Business Admin): own employee ID / joining date / branch, and the business details card', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page);
  let me = null; let biz = null;
  await page.route('**/api/me/profile', r => {
    if (r.request().method() === 'PUT') { me = r.request().postDataJSON(); return r.fulfill({ json: { success: true } }); }
    return r.fallback();
  });
  await page.route('**/api/business', r => {
    if (r.request().method() === 'PUT') { biz = r.request().postDataJSON(); return r.fulfill({ json: { success: true, business: {} } }); }
    return r.fulfill({ json: { success: true, business: { name: 'Sunrise Clinic', industry: 'hospital', sendWindowStart: 9, sendWindowEnd: 20, detailsReady: true,
      details: { about: '', legalName: '', phone: '', email: '', website: '', address: '', city: 'Hyderabad', state: '', pin: '', gstin: '', registrationNo: '', hours: '' } } } });
  });
  await page.goto('/admin/profile');
  await expect(page.getByRole('heading', { name: 'My profile' })).toBeVisible({ timeout: 20000 });
  // The Business Admin's own work details are editable (nobody above them sets them).
  const mineForm = page.getByRole('form', { name: 'My personal details' });
  await mineForm.getByLabel('Employee ID').fill('MH-0001');
  await mineForm.getByLabel('Branch / location').fill('Head office');
  await mineForm.getByRole('button', { name: 'Save details' }).click();
  await expect.poll(() => me).toEqual({ employeeCode: 'MH-0001', workLocation: 'Head office' });

  // Business details: the type is the platform's; the rest is the Business Admin's.
  const card = page.getByTestId('business-details');
  await expect(card.getByTestId('business-industry')).toHaveText('Hospital');
  await expect(card.getByLabel('City')).toHaveValue('Hyderabad');
  await card.getByLabel('About the business').fill('A 50-bed eye and diabetes hospital.');
  await card.getByLabel('Business phone').fill('+91 40 1234 5678');
  await card.getByLabel('GSTIN').fill('36ABCDE1234F1Z5');
  await expect(card.getByRole('link', { name: 'Settings → Setup' })).toHaveAttribute('href', '/admin/settings/setup');
  await page.screenshot({ path: 'test-results/my-profile-business.png', fullPage: true });
  await card.getByRole('button', { name: 'Save business details' }).click();
  await expect.poll(() => biz).toEqual({ details: { about: 'A 50-bed eye and diabetes hospital.', phone: '+91 40 1234 5678', gstin: '36ABCDE1234F1Z5' } });
  expect(errors).toEqual([]);
});

test('My profile (agent): work details stay locked and there is no business details card', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page, { role: 'agent' });
  await page.route('**/api/me/profile*', r => r.fulfill({ json: { ...ANSWERS['/api/me/profile'], profile: { ...ANSWERS['/api/me/profile'].profile, role: 'agent' } } }));
  await page.goto('/agent/profile');
  await expect(page.getByRole('heading', { name: 'My profile' })).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('form', { name: 'My personal details' }).getByLabel('Employee ID')).toBeDisabled();
  await expect(page.getByTestId('business-details')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Team onboarding: the manager fills in an agent\'s details when adding them, then views and edits them', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page, { role: 'manager' });
  let added = null; let edited = null;
  await page.route('**/api/team/members', r => {
    if (r.request().method() !== 'POST') return r.fallback();
    added = r.request().postDataJSON();
    return r.fulfill({ json: { success: true, member: { user_id: 'e0000000-0000-4000-8000-00000000000a', email: added.email, role: 'agent' } } });
  });
  let member = { userId: 'e2e00000-0000-4000-8000-000000000002', email: 'agent@e2e.test', role: 'agent', joinedAt: NOW, fullName: 'Ravi Kumar', jobTitle: 'Front desk', languages: 'Telugu', phone: '+91 90000 00002',
    employeeCode: 'SC-0042', joinedOn: '2026-11-10', workLocation: 'Main branch', address: 'Kukatpally', emergencyContactName: 'Lakshmi (mother)', emergencyContactPhone: '+91 91234 56789',
    rank: 2, points: 10, chatsHandled: 3, repliesSent: 5, conversions: 0, queriesResolved: 0, calls: 0, notes: 0, medianResponseMin: 3, openChats: 1, lastActive: NOW, daily: [] };
  await page.route('**/api/team/members/*/profile', r => {
    edited = r.request().postDataJSON();
    member = { ...member, ...edited };
    return r.fulfill({ json: { success: true, profile: edited } });
  });
  await page.route(/\/api\/team\/members\/[0-9a-f-]+\?/, r => r.fulfill({ json: { success: true, days: 30, teamSize: 2, points: { chats: 2, conversions: 10, queriesResolved: 5, calls: 3, notes: 1 }, member, canEdit: true, updatedBy: 'manager@e2e.test' } }));

  await page.goto('/manager/settings/team');
  // Add an agent with onboarding details.
  const form = page.getByTestId('onboarding-details');
  await expect(form).toBeVisible({ timeout: 20000 });
  await page.getByPlaceholder('e.g. ravi@yourbusiness.in').fill('sita@e2e.test');
  await page.getByPlaceholder('e.g. Ravi Kumar').first().fill('Sita Devi');
  await page.locator('#new-member-jobTitle').fill('Pharmacy assistant');
  await page.locator('#new-member-employeeCode').fill('SC-0050');
  await page.locator('#new-member-joinedOn').fill('2026-11-12');
  await page.locator('#new-member-workLocation').fill('Pharmacy');
  await page.locator('#new-member-phone').fill('+91 98765 43210');
  await page.locator('#new-member-address').fill('Road 2, Kukatpally');
  await page.locator('#new-member-emergencyContactName').fill('Gopal (father)');
  await page.locator('#new-member-emergencyContactPhone').fill('+91 91234 00000');
  await page.screenshot({ path: 'test-results/team-onboarding-add.png', fullPage: true });
  await page.getByRole('button', { name: 'Create login' }).click();
  await expect.poll(() => added?.email).toBe('sita@e2e.test');
  expect(added).toMatchObject({ role: 'agent', fullName: 'Sita Devi', profile: { jobTitle: 'Pharmacy assistant', employeeCode: 'SC-0050', joinedOn: '2026-11-12', workLocation: 'Pharmacy', phone: '+91 98765 43210', address: 'Road 2, Kukatpally', emergencyContactName: 'Gopal (father)', emergencyContactPhone: '+91 91234 00000' } });

  // View and edit an agent's details.
  await page.getByRole('button', { name: /agent@e2e\.test/ }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Team member' });
  const details = drawer.getByTestId('member-details');
  await expect(details).toContainText('SC-0042', { timeout: 15000 });
  await expect(details).toContainText('Lakshmi (mother)');
  await expect(details).toContainText('10 Nov 2026');
  await expect(details).toContainText('Last changed by manager@e2e.test');
  await details.getByRole('button', { name: 'Edit details' }).click();
  await details.locator('#edit-member-address').fill('Flat 7, Miyapur');
  await details.locator('#edit-member-workLocation').fill('Miyapur branch');
  await details.getByRole('button', { name: 'Save details' }).click();
  await expect.poll(() => edited).toEqual({ address: 'Flat 7, Miyapur', workLocation: 'Miyapur branch' });
  await expect(details).toContainText('Miyapur branch');
  await page.screenshot({ path: 'test-results/team-member-details.png' });
  expect(errors).toEqual([]);
});

test('Team: performance ranking and a member\'s details', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page);
  await page.goto('/app');
  await openScreen(page, 'Team', { timeout: 20000 });
  await page.getByRole('tab', { name: /Performance/ }).click();
  await expect(page.getByText('Team ranking, last 30 days')).toBeVisible({ timeout: 15000 });
  const rows = page.locator('tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Asha Rao');
  await page.screenshot({ path: 'test-results/team-performance.png', fullPage: true });
  await page.getByLabel('Sort by').selectOption('medianResponseMin');
  await expect(rows.first()).toContainText('Ravi Kumar'); // fastest response first
  await rows.first().click();
  const drawer = page.getByRole('dialog', { name: 'Team member' });
  await expect(drawer.getByText('+91 90000 00002')).toBeVisible({ timeout: 15000 });
  await expect(drawer.getByText('#2 of 2')).toBeVisible();
  await page.screenshot({ path: 'test-results/team-member.png' });
  expect(errors).toEqual([]);
});

test('Team: add an agent with a password, and set a new password for one', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page);
  const sent = [];
  await page.route('**/api/team/members', r => { sent.push(['add', r.request().postDataJSON()]); return r.fulfill({ json: { success: true, member: { user_id: 'x', email: 'sita@shop.test', role: 'agent' } } }); });
  await page.route('**/api/team/*/password', r => { sent.push(['set', r.request().url(), r.request().postDataJSON()]); return r.fulfill({ json: { success: true, updated: true } }); });
  await page.goto('/app');
  await openScreen(page, 'Team', { timeout: 20000 });

  await expect(page.getByText('Add a team member')).toBeVisible({ timeout: 15000 });
  await page.getByPlaceholder('e.g. ravi@yourbusiness.in').fill('sita@shop.test');
  await page.getByPlaceholder('e.g. Ravi Kumar').fill('Sita Devi');
  const pw = await page.locator('#new-member-password').inputValue();
  expect(pw).toMatch(/^(?=.*[A-Za-z])(?=.*\d).{12}$/); // a strong password is pre-filled
  await page.getByRole('button', { name: 'Create login' }).click();
  await expect(page.getByText('Done. Give these to them privately')).toBeVisible();
  expect(sent[0][1]).toMatchObject({ email: 'sita@shop.test', password: pw, role: 'agent', fullName: 'Sita Devi' });
  await page.screenshot({ path: 'test-results/team-add-agent.png', fullPage: true });

  await page.getByRole('button', { name: 'Set password for agent@e2e.test' }).click();
  const dialog = page.getByRole('dialog', { name: 'Set password' });
  await dialog.locator('#set-member-password').fill('NewPass2026');
  await dialog.getByRole('button', { name: 'Set password' }).click();
  await expect(dialog.getByText('Password: NewPass2026')).toBeVisible();
  expect(sent[1][1]).toContain('/api/team/e2e00000-0000-4000-8000-000000000002/password');
  expect(sent[1][2]).toEqual({ password: 'NewPass2026' });
  await expect(page.getByRole('button', { name: `Set password for ${ME.email}` })).toHaveCount(0); // not for yourself
  expect(errors).toEqual([]);
});

test('managers and the Business Admin still get every page', async ({ page }) => {
  await fakeBackend(page);
  await page.goto('/app');
  const menu = page.getByRole('navigation', { name: 'Main menu' });
  await expect(menu.getByRole('link', { name: 'Inbox' })).toBeVisible({ timeout: 20000 });
  await expect(menu.getByRole('link')).toHaveText(['Home', /^Inbox/, 'Pipeline', 'Leads', 'Queries', 'Broadcasts', 'Ads', 'Analytics', 'Setup', 'WhatsApp', 'Team', 'Lead statuses', 'Lead assignment', 'Customer fields', 'Activity log', 'Bot Flow', 'Auto-replies', 'AI assistant', 'My profile']);
  await openScreen(page, 'Setup');
  // Phones: the settings pages also get their own row at the top of the Settings area.
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(page.getByRole('navigation', { name: 'Settings menu' }).getByRole('link')).toHaveText(['Setup', 'WhatsApp', 'Team', 'Lead statuses', 'Lead assignment', 'Customer fields', 'Activity log', 'Bot Flow', 'Auto-replies', 'AI assistant']);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByText('Business Admin', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/owner-header.png' });
});

test('a recorded WhatsApp call plays from the chat (private link fetched on Play)', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page);
  const convo = ANSWERS[`/api/inbox/${LEAD.phone}`];
  await page.route(`**/api/inbox/${LEAD.phone}`, r => r.fulfill({ json: { ...convo, messages: [...convo.messages,
    { id: 'c1', message_id: 'wacid.E2E_REC_log', direction: 'inbound', type: 'call', body: '📞 WhatsApp call, 1 min 5 s (answered by owner@e2e.test)', timestamp: NOW },
    { id: 'c2', message_id: 'wacid.E2E_MISSED_log', direction: 'inbound', type: 'call', body: '📞 Missed WhatsApp call', timestamp: NOW },
  ] } }));
  let asked = null;
  await page.route('**/api/wa-calls/recording/play', r => { asked = r.request().postDataJSON(); return r.fulfill({ json: { success: true, url: `${new URL(r.request().url()).origin}/fake-audio.webm`, seconds: 65 } }); });
  await page.route('**/fake-audio.webm', r => r.fulfill({ status: 200, contentType: 'audio/webm', body: Buffer.alloc(0) }));

  await page.goto('/admin/inbox');
  await page.getByText('Ravi Kumar').first().click({ timeout: 20000 });
  await expect(page.getByText('📞 WhatsApp call, 1 min 5 s')).toBeVisible({ timeout: 15000 });
  const play = page.getByRole('button', { name: 'Play recording' });
  await expect(play).toHaveCount(1); // the missed call has no player
  await page.screenshot({ path: 'test-results/call-recording-chat.png' });
  const audioRequested = page.waitForRequest('**/fake-audio.webm');
  await play.click();
  await expect.poll(() => asked?.callId).toBe('wacid.E2E_REC');
  await audioRequested; // the player loads the short-lived private link it was given
  expect(errors.filter(e => !/fake-audio|media|audio/i.test(e))).toEqual([]);
});

test('several WhatsApp numbers: badges, filter by number, and "Reply from" with each number\'s 24-hour window', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page);
  const MAIN = '111111111111111', PHARMACY = '111111111111112', LAB = '111111111111113';
  const hoursAgo = (h) => new Date(Date.now() - h * 3600000).toISOString();
  const lead = { ...LEAD, last_phone_number_id: PHARMACY, last_inbound_at: hoursAgo(1) };
  await page.route('**/api/inbox-numbers', r => r.fulfill({ json: { numbers: [
    { id: MAIN, label: 'Reception', phoneNumber: '919000000100', main: true },
    { id: PHARMACY, label: 'Pharmacy', phoneNumber: '919000000101', main: false },
    { id: LAB, label: 'Lab', phoneNumber: '919000000102', main: false },
  ] } }));
  const listUrls = [];
  await page.route('**/api/inbox?*', r => { listUrls.push(r.request().url()); return r.fulfill({ json: { conversations: [lead] } }); });
  const windowClosesAt = new Date(Date.now() + 23 * 3600000).toISOString();
  await page.route(`**/api/inbox/${LEAD.phone}`, r => r.fulfill({ json: { notes: [],
    contact: { ...lead, windowOpen: true, windowClosesAt, windows: [
      { numberId: PHARMACY, lastInboundAt: hoursAgo(1), open: true, closesAt: windowClosesAt },
      { numberId: LAB, lastInboundAt: hoursAgo(30), open: false, closesAt: hoursAgo(6) },
    ] },
    messages: [
      { id: 'm1', direction: 'inbound', body: 'Is my report ready?', type: 'text', timestamp: hoursAgo(30), phone_number_id: LAB },
      { id: 'm2', direction: 'inbound', body: 'Do you have this medicine?', type: 'text', timestamp: hoursAgo(1), phone_number_id: PHARMACY },
    ] } }));
  const sent = [];
  await page.route(`**/api/inbox/${LEAD.phone}/messages`, r => { sent.push(r.request().postDataJSON()); return r.fulfill({ json: { success: true, sent: true, id: 'wamid.x' } }); });
  let templatesUrl = '';
  await page.route('**/api/templates*', r => { templatesUrl = r.request().url(); return r.fulfill({ json: ANSWERS['/api/templates'] }); });

  await page.goto('/admin/inbox');
  const row = page.locator('[data-testid="chat-row"]').first();
  await expect(row.getByTestId('number-badge')).toHaveText(/Pharmacy/, { timeout: 20000 });

  // Filter by number: the list is asked for that number's chats.
  await page.getByTestId('number-filter').selectOption(LAB);
  await expect.poll(() => listUrls.some(u => u.includes(`number=${LAB}`))).toBe(true);
  await page.getByTestId('number-filter').selectOption('');

  await row.click();
  await expect(page.locator('[data-testid="chat-header"]')).toContainText('Wrote to Pharmacy');
  await expect(page.getByTestId('message-number').first()).toHaveText(/to Lab/);
  await expect(page.getByTestId('message-number').last()).toHaveText(/to Pharmacy/);

  // Default: reply from Pharmacy (window open), sent without choosing a number.
  const picker = page.getByTestId('reply-from').locator('select');
  await expect(picker.locator('option').first()).toHaveText(/Pharmacy \(they last wrote here\)/);
  await page.locator('[data-testid="chat-composer"] textarea').fill('Yes, we have it.');
  await page.locator('[data-testid="chat-composer"] textarea').press('Enter');
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toEqual({ text: 'Yes, we have it.' });

  // Lab: their last message there is 30 h old -> template only, from the lab's account.
  await picker.selectOption(LAB);
  await expect(page.getByTestId('window-closed')).toContainText('more than 24 hours since this customer wrote to Lab');
  await expect(page.locator('[data-testid="chat-composer"]')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/multi-number-inbox.png' });
  await page.getByRole('button', { name: 'Send template' }).click();
  await expect(page.getByText(`Send a template to ${LEAD.name} from Lab`)).toBeVisible();
  await expect.poll(() => templatesUrl).toContain(`number=${LAB}`);
  await page.keyboard.press('Escape');

  // Main number: never written to -> template only too.
  await picker.selectOption(MAIN);
  await expect(page.getByTestId('window-closed')).toContainText('hasn\'t written to Reception');
  expect(errors).toEqual([]);
});

test('WhatsApp page: the Business Admin adds, renames and removes extra numbers within the plan limit', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page);
  let numbers = [{ id: '111111111111112', phoneNumber: '919000000101', wabaId: '222222222222222', label: 'Pharmacy', ownToken: false, tokenLast4: null, tokenUnreadable: false, status: 'active', addedBy: ME.email, createdAt: NOW }];
  const answer = () => ({ main: { id: '111111111111111', phoneNumber: '919000000100', wabaId: '222222222222222', label: '' }, numbers, limit: 3, used: 1 + numbers.filter(n => n.status === 'active').length, planName: 'Growth', tableReady: true });
  const calls = [];
  await page.route('**/api/whatsapp/numbers**', async r => {
    const req = r.request();
    const method = req.method();
    if (method === 'GET') return r.fulfill({ json: answer() });
    const body = req.postData() ? req.postDataJSON() : null;
    calls.push([method, new URL(req.url()).pathname, body]);
    if (method === 'POST') {
      if (body.phoneNumberId === '999') return r.fulfill({ status: 400, json: { success: false, error: 'That phone number is not in this WhatsApp Business Account.' } });
      numbers = [...numbers, { id: body.phoneNumberId, phoneNumber: '919000000102', wabaId: '222222222222222', label: body.label, ownToken: false, tokenLast4: null, tokenUnreadable: false, status: 'active', addedBy: ME.email, createdAt: NOW }];
    }
    if (method === 'PATCH') { const id = new URL(req.url()).pathname.split('/').pop(); numbers = numbers.map(n => (n.id === id ? { ...n, label: body.label } : n)); }
    if (method === 'DELETE') { const id = new URL(req.url()).pathname.split('/').pop(); numbers = numbers.map(n => (n.id === id ? { ...n, status: 'disabled' } : n)); }
    return r.fulfill({ json: { success: true, verifiedName: 'E2E Kitchen' } });
  });

  await page.goto('/app');
  await openScreen(page, 'WhatsApp', { timeout: 20000 });
  const box = page.getByTestId('wa-numbers');
  await expect(box.getByTestId('numbers-usage')).toHaveText('2 of 3 on your Growth plan');
  await expect(box.getByTestId('number-row')).toHaveCount(2);

  // Add: Meta refuses first (shown in the form), then it works.
  await box.getByRole('button', { name: 'Add number' }).click();
  const form = box.getByTestId('add-number-form');
  await form.getByLabel('Name your team will see').fill('Lab');
  await form.getByLabel('Phone number ID').fill('999');
  await form.getByRole('button', { name: 'Add number' }).click();
  await expect(form).toContainText('not in this WhatsApp Business Account');
  await form.getByLabel('Phone number ID').fill('111111111111113');
  await form.getByRole('button', { name: 'Add number' }).click();
  await expect(box.getByTestId('number-row')).toHaveCount(3);
  await expect(box.getByTestId('numbers-usage')).toHaveText('3 of 3 on your Growth plan');
  await expect(box.getByRole('button', { name: 'Add number' })).toBeDisabled(); // plan limit reached
  expect(calls.find(c => c[0] === 'POST' && c[2].phoneNumberId === '111111111111113')[2]).toEqual({ label: 'Lab', phoneNumberId: '111111111111113' });
  await page.screenshot({ path: 'test-results/whatsapp-numbers.png', fullPage: true });

  // Rename the main number, then remove the pharmacy (asks first).
  await box.getByTestId('number-row').first().getByTitle('Rename').click();
  await box.getByLabel('Number name').fill('Reception');
  await box.getByLabel('Number name').press('Enter');
  await expect.poll(() => calls.some(c => c[0] === 'PATCH' && c[1].endsWith('/111111111111111') && c[2].label === 'Reception')).toBe(true);
  await box.getByTestId('number-row').nth(1).getByTitle('Remove number').click();
  await box.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(box).toContainText('removed · history kept');
  await expect(box.getByTestId('number-row')).toHaveCount(2);
  expect(errors.filter(e => !/status of 400/.test(e))).toEqual([]); // the 400 is the refused number above
});

test('several numbers elsewhere: broadcasts choose the sender (its templates), analytics show each number', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page);
  const LAB = '111111111111113';
  await page.route('**/api/inbox-numbers', r => r.fulfill({ json: { numbers: [
    { id: '111111111111111', label: 'Reception', phoneNumber: '919000000100', main: true },
    { id: LAB, label: 'Lab', phoneNumber: '919000000102', main: false },
  ] } }));
  await page.route('**/api/templates?number=*', r => r.fulfill({ json: { templates: [{ name: 'report_ready', language: 'en', status: 'APPROVED', category: 'UTILITY', components: [{ type: 'BODY', text: 'Your report is ready.' }] }] } }));
  let created = null;
  await page.route('**/api/campaigns', r => {
    if (r.request().method() === 'POST') { created = r.request().postDataJSON(); return r.fulfill({ json: { success: true, recipients: 1, campaign: { id: 'c0000000-0000-4000-8000-000000000009' } } }); }
    return r.fulfill({ json: { campaigns: [{ ...ANSWERS['/api/campaigns'].campaigns[0], phone_number_id: LAB }] } });
  });
  await page.route('**/api/audience/preview', r => r.fulfill({ json: { count: 1 } }));

  await page.goto('/app');
  await page.getByRole('link', { name: 'Broadcasts', exact: true }).click({ timeout: 20000 });
  await expect(page.getByTestId('campaign-from').first()).toHaveText(/from Lab/);
  // Named so they aren't confused with ad campaigns.
  await expect(page.getByRole('button', { name: 'Broadcast campaigns', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /How this works: Broadcast campaigns/ })).toBeVisible();
  await expect(page.getByText('WhatsApp messages you send to your own contacts. Not ads')).toBeVisible();
  await page.getByRole('button', { name: 'New broadcast' }).click();
  const from = page.getByTestId('broadcast-from');
  await expect(from.locator('option')).toHaveText(['Reception (main number)', 'Lab']);
  // Main number: the main account's templates; Lab: the lab account's.
  await expect(page.locator('select').filter({ hasText: 'diwali_offer' })).toHaveCount(1);
  await from.selectOption(LAB);
  const tpl = page.locator('select').filter({ hasText: 'report_ready' });
  await expect(tpl).toHaveCount(1);
  await page.getByPlaceholder('Weekend offer – Nov').fill('Reports ready');
  await tpl.selectOption('report_ready|en');
  // Step by step: Message -> Who gets it -> Check and send.
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByTestId('campaign-summary')).toContainText('report_ready');
  await expect(page.getByTestId('campaign-summary')).toContainText('Lab');
  await page.screenshot({ path: 'test-results/campaign-step3.png' });
  await page.getByRole('button', { name: /Save as draft|Save draft/ }).click();
  await expect.poll(() => created?.fromNumberId).toBe(LAB);
  expect(created.templateName).toBe('report_ready');

  // Analytics: one row per number (older messages without a number count for the main one).
  await page.getByRole('link', { name: 'Analytics', exact: true }).click();
  const table = page.getByTestId('by-number');
  await expect(table).toContainText('Reception');
  await expect(table).toContainText('Lab');
  await page.screenshot({ path: 'test-results/multi-number-analytics.png' });
  expect(errors).toEqual([]);
});

test('WhatsApp page flow: connected details read-only, "Change details" on demand; not connected: steps 1-2-3', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page);
  let conn = { ...ANSWERS['/api/whatsapp'], connectedAt: NOW, updatedBy: ME.email };
  let saved = null;
  await page.route('**/api/whatsapp', r => {
    if (r.request().method() === 'PUT') { saved = r.request().postDataJSON(); return r.fulfill({ json: { success: true, verifiedName: 'E2E Kitchen' } }); }
    return r.fulfill({ json: conn });
  });
  await page.route('**/api/whatsapp/test', r => r.fulfill({ json: { success: true, ok: true, verifiedName: 'E2E Kitchen', displayPhoneNumber: '+91 90000 00100', qualityRating: 'GREEN', messagingLimit: 'TIER_1K' } }));

  await page.goto('/app');
  await openScreen(page, 'WhatsApp', { timeout: 20000 });
  const details = page.getByTestId('wa-details');
  await expect(page.getByTestId('wa-number')).toHaveText('+919000000100');
  for (const text of ['111111111111111', '222222222222222', '••••••••1234', 'Saved ✓', 'https://example.test/webhook/abc', 'verify-e2e', ME.email]) {
    await expect(details).toContainText(text);
  }
  await expect(page.getByTestId('wa-form')).toHaveCount(0); // no form until "Change details"
  await expect(page.getByTestId('wa-steps')).toContainText('1. Webhook in Meta');

  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByTestId('wa-test-ok')).toContainText('E2E Kitchen');
  await page.screenshot({ path: 'test-results/whatsapp-connected.png', fullPage: true });

  await page.getByRole('button', { name: 'Change details' }).click();
  const form = page.getByTestId('wa-form');
  await expect(form.getByLabel('Phone number ID')).toHaveValue('111111111111111');
  await expect(form.getByLabel('Access token')).toHaveValue(''); // never sent back
  await expect(form.getByLabel('Access token')).toHaveAttribute('placeholder', /Saved \(••••1234\)/);
  await form.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('wa-form')).toHaveCount(0);

  // Not connected yet: step 1 (webhook) and step 2 (empty form) in order.
  conn = { connected: false, source: 'none', phoneNumber: '', phoneNumberId: '', wabaId: '', tokenLast4: null, hasAppSecret: false, webhookUrl: 'https://example.test/webhook/new', verifyToken: 'verify-new', role: 'owner' };
  await page.reload();
  await openScreen(page, 'WhatsApp', { timeout: 20000 });
  await expect(page.getByTestId('wa-step1')).toContainText('Step 1: Set up the webhook in Meta');
  await expect(page.getByTestId('wa-form')).toContainText('Step 2: Your Meta details');
  await expect(page.getByTestId('wa-connected')).toHaveCount(0);
  const empty = page.getByTestId('wa-form');
  await expect(empty.getByLabel('Phone number ID')).toHaveValue('');
  await empty.getByLabel('Phone number ID').fill('333333333333333');
  await empty.getByLabel('WhatsApp Business Account ID').fill('444444444444444');
  await empty.getByRole('button', { name: 'Save and check' }).click();
  await expect.poll(() => saved?.phoneNumberId).toBe('333333333333333');
  await page.screenshot({ path: 'test-results/whatsapp-not-connected.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('Bot Flow guide agent: offers a tour, walks to each part with a spotlight, "show me a part" and help topics', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page);
  await page.goto('/app');
  await openScreen(page, 'Bot Flow', { timeout: 20000 });

  // First visit: the floating guide offers a tour.
  const offer = page.getByRole('dialog', { name: 'Guide offer' });
  await expect(offer).toContainText('I\'m your Bot Flow guide');
  await offer.getByRole('button', { name: 'Show me around' }).click();
  const bubble = page.getByTestId('tour-bubble');
  await expect(bubble).toContainText('Step 1 of 12');
  await expect(bubble).toContainText('This page is your WhatsApp bot');
  await page.screenshot({ path: 'test-results/bot-flow-tour-1.png' });

  // Next / arrow keys: it brings each part into view and explains it.
  await bubble.getByRole('button', { name: /Next/ }).click(); // the 3 parts
  await bubble.getByRole('button', { name: /Next/ }).click(); // the phone
  await expect(bubble).toContainText('Try it on the phone');
  await expect(page.locator('[data-tour="bf-phone"]')).toBeInViewport();
  await page.keyboard.press('ArrowRight');
  await expect(bubble).toContainText('1. The welcome message');
  await expect(page.locator('[data-tour="bf-welcome-text"]')).toBeInViewport();
  // The spotlight sits on the welcome box once the smooth scroll has finished.
  await expect.poll(async () => {
    const t = await page.locator('[data-tour="bf-welcome-text"]').boundingBox();
    const s = await page.getByTestId('tour-spotlight').boundingBox();
    return t && s ? Math.round(Math.abs(s.y + 8 - t.y) + Math.abs(s.x + 8 - t.x)) : -1;
  }).toBeLessThan(3);
  await page.screenshot({ path: 'test-results/bot-flow-tour-welcome.png' });
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  await expect(bubble).toContainText('Add your services or products');
  await expect(page.locator('[data-tour="bf-add-item"]')).toBeInViewport();
  await page.keyboard.press('ArrowRight');
  await expect(bubble).toContainText('3. Reply after Book / Enquire');
  await expect(page.locator('[data-tour="bf-reply-book"]')).toBeInViewport();
  await page.keyboard.press('ArrowLeft');
  await expect(bubble).toContainText('Add your services or products');
  await page.keyboard.press('Escape');
  await expect(bubble).toHaveCount(0);

  // The guide button: jump to one part, and short help topics.
  await page.getByRole('button', { name: 'Open the Bot Flow guide' }).click();
  const menu = page.getByRole('dialog', { name: 'Bot Flow guide' });
  await menu.getByRole('button', { name: /^Services/ }).click();
  await expect(bubble).toContainText('2. How the services list looks');
  await bubble.getByRole('button', { name: 'Close the guide' }).click();
  await page.getByRole('button', { name: 'Open the Bot Flow guide' }).click();
  await menu.getByRole('button', { name: 'In what order the bot decides' }).click();
  await expect(menu.getByTestId('agent-topic-order')).toContainText('STOP / START');
  await page.screenshot({ path: 'test-results/bot-flow-agent-menu.png' });

  // Offered only once (remembered in this browser).
  await page.reload();
  await openScreen(page, 'Bot Flow', { timeout: 20000 });
  await expect(page.getByRole('heading', { name: 'WhatsApp Bot Flow' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Guide offer' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Bot Flow phone preview plays the conversation as customers see it, with unsaved edits', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page);
  await page.addInitScript(() => { try { localStorage.setItem('bot_flow_agent_seen_v1', '1'); } catch { /* */ } });
  await page.goto('/app');
  await openScreen(page, 'Bot Flow', { timeout: 20000 });
  const phone = page.getByTestId('bot-phone');
  await expect(phone).toContainText('Welcome! 👋 How can we help?');
  // No services yet: "Our services" is hidden from customers (the page says so too).
  await expect(phone.getByRole('button', { name: '📋 Our services' })).toHaveCount(0);
  await expect(page.locator('#bf-welcome')).toContainText('Customers don\'t see this button yet');
  await expect(page.locator('[data-tour="bf-steps"]')).toContainText('2 of 3 parts ready');

  // Add a service (not saved yet): the phone shows it at once.
  await page.getByRole('button', { name: /Add a service or product/ }).click();
  await page.getByPlaceholder('e.g. General consultation').fill('Eye check-up');
  await page.locator('input[type=number]').fill('300');
  await page.getByRole('button', { name: 'Add item' }).click();
  await expect(page.getByTestId('bf-unsaved')).toBeVisible();
  await expect(page.locator('[data-tour="bf-steps"]')).toContainText('3 of 3 parts ready');
  await phone.getByRole('button', { name: '📋 Our services' }).click();
  await phone.getByRole('button', { name: /View options/ }).click();
  await phone.getByRole('dialog', { name: 'List in the preview' }).getByRole('button', { name: /Eye check-up/ }).click();
  await expect(phone).toContainText('Price: ₹300');
  await expect(phone).toContainText('Would you like to book or enquire?');
  await phone.getByRole('button', { name: '✅ Book / Enquire' }).click();
  await expect(phone).toContainText('Thanks!');
  await expect(phone).toContainText('moves to "Booked"');
  await page.screenshot({ path: 'test-results/bot-flow-phone.png' });

  // Start again, then "Talk to our team": the reply, and the bot pauses.
  await phone.getByRole('button', { name: 'Start the preview again' }).click();
  await phone.getByRole('button', { name: '💬 Talk to our team' }).click();
  await expect(phone).toContainText('Our team will reply.');
  await expect(phone).toContainText('Bot paused');
  expect(errors).toEqual([]);
});

test('WhatsApp page: managers see the numbers but cannot change them', async ({ page }) => {
  await fakeBackend(page, { role: 'manager' });
  await page.route('**/api/whatsapp', r => r.fulfill({ json: { connected: true, source: 'saved', phoneNumber: '919000000100', role: 'manager' } }));
  await page.route('**/api/whatsapp/numbers', r => r.fulfill({ json: { main: { id: '111111111111111', phoneNumber: '919000000100', wabaId: '2', label: 'Reception' }, numbers: [{ id: '111111111111112', phoneNumber: '919000000101', wabaId: '2', label: 'Pharmacy', ownToken: false, tokenLast4: null, tokenUnreadable: false, status: 'active', addedBy: null, createdAt: NOW }], limit: 2, used: 2, planName: 'Growth', tableReady: true } }));
  await page.goto('/app');
  await openScreen(page, 'WhatsApp', { timeout: 20000 });
  const box = page.getByTestId('wa-numbers');
  await expect(box.getByTestId('number-row')).toHaveCount(2);
  await expect(box).toContainText('Pharmacy');
  await expect(box.getByRole('button', { name: 'Add number' })).toHaveCount(0);
  await expect(box.getByTitle('Rename')).toHaveCount(0);
  await expect(box.getByTitle('Remove number')).toHaveCount(0);
});

test('Ads: "Create WhatsApp ads" is its own tab; its checklist shows what is missing in Meta and how to fix it', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page);
  // Start on the default tab (cleared once, so the reload below can show the remembered tab).
  await page.addInitScript(() => { try { if (!sessionStorage.getItem('e2e_cleared')) { localStorage.removeItem('ads_page_tab_v1'); sessionStorage.setItem('e2e_cleared', '1'); } } catch { /* */ } });
  await page.route('**/api/ads?*', r => r.fulfill({ json: { adsEnabled: true, account: { connected: true, adAccountId: 'act_1', name: 'E2E Ads', currency: 'INR', lastSyncAt: NOW, alerts: { maxCostPerChat: null, maxCostPerConversion: null, windowDays: 3 } }, report: null } }));
  let asked = 0;
  await page.route('**/api/ads/create/readiness', r => { asked++; return r.fulfill({ json: { success: true, ready: false, currency: 'INR', minDailyBudget: 96, maxDailyBudget: 2000, businessNumber: '919701103222', pages: [], selectedPageId: null, checks: [
    { key: 'account', ok: true, label: 'Ad account is active', detail: 'Meta says the ad account can run ads.' },
    { key: 'permissions', ok: false, label: 'Token can create ads for a Page', detail: 'The saved token is missing: pages_manage_ads, pages_read_engagement, pages_show_list.', fix: ['Open System users.', 'Generate a new token.'], link: { href: 'https://business.facebook.com/settings/system-users', text: 'System users' } },
    { key: 'page', ok: false, label: 'Facebook Page to advertise as', detail: 'Meta shows no Facebook Page this ad account can advertise for.' },
    { key: 'whatsapp', ok: false, label: 'Page is linked to your WhatsApp number', detail: 'Choose a Page first.' },
    { key: 'budget', ok: true, label: 'Minimum daily budget', detail: "Meta's minimum for this account is INR 96 per day." },
  ] } }); });

  await page.goto('/app');
  await page.getByRole('navigation', { name: 'Main menu' }).getByRole('link', { name: /^Ads/ }).click({ timeout: 20000 });
  // Tabs: Ad results (default) / Create WhatsApp ads / Setup guide. Meta is only asked when the tab opens.
  const tabs = page.getByRole('tablist', { name: 'Ads sections' });
  await expect(tabs.getByRole('tab')).toHaveText(['Ad results', 'Manage', 'Funnel', 'Create WhatsApp ads', 'Bookings to Meta', 'Setup guide'], { timeout: 15000 });
  await expect(tabs.getByRole('tab', { name: 'Ad results' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('ads-create-ready')).toHaveCount(0);
  await expect(page.getByTestId('guide-ads')).toHaveCount(0);
  expect(asked).toBe(0);
  await tabs.getByRole('tab', { name: 'Setup guide' }).click();
  // The tab opens with "How Meta is organised"; the connection steps are one click below it.
  await expect(page.getByTestId('meta-org-guide')).toContainText('The big picture: Meta\'s apps and tools');
  await page.getByTestId('guide-ads').getByRole('button').first().click();
  await expect(page.getByTestId('guide-ads').getByText('Find your ad account ID')).toBeVisible();
  await tabs.getByRole('tab', { name: 'Create WhatsApp ads' }).click();
  const card = page.getByTestId('ads-create-ready');
  await expect(card.getByText('2 of 5 ready')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sync now' })).toHaveCount(0); // results-only controls
  await expect(card.getByText(/missing: pages_manage_ads/)).toBeVisible();
  await expect(card.getByRole('link', { name: /System users/ })).toHaveAttribute('href', 'https://business.facebook.com/settings/system-users');
  await expect(card.getByRole('button', { name: 'Create an ad' })).toBeDisabled();
  await expect(card.getByText("Meta's minimum is INR 96.")).toBeVisible();
  await page.screenshot({ path: 'test-results/ads-create-ready.png', fullPage: true });
  await card.getByRole('button', { name: 'Check again' }).click();
  await expect.poll(() => asked).toBe(2);
  // The chosen tab is remembered.
  await page.reload();
  await page.getByRole('navigation', { name: 'Main menu' }).getByRole('link', { name: /^Ads/ }).click({ timeout: 20000 });
  await expect(page.getByRole('tab', { name: 'Create WhatsApp ads' })).toHaveAttribute('aria-selected', 'true', { timeout: 15000 });
  expect(errors).toEqual([]);
});

test('Ads: create a WhatsApp ad in 4 steps (paused), then launch it', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page);
  await page.addInitScript(() => { try { localStorage.setItem('ads_page_tab_v1', 'create'); } catch { /* */ } });
  await page.route('**/api/ads?*', r => r.fulfill({ json: { adsEnabled: true, account: { connected: true, adAccountId: 'act_1', name: 'E2E Ads', currency: 'INR', lastSyncAt: NOW, alerts: { maxCostPerChat: null, maxCostPerConversion: null, windowDays: 3 } }, report: null } }));
  await page.route('**/api/ads/create/readiness', r => r.fulfill({ json: { success: true, ready: true, currency: 'INR', minDailyBudget: 96, maxDailyBudget: 2000, businessNumber: '919701103222', pages: [{ id: '55555', name: 'Shop Page' }], selectedPageId: '55555',
    checks: ['account', 'permissions', 'page', 'whatsapp', 'budget'].map(key => ({ key, ok: true, label: key, detail: 'ok' })) } }));
  let uploaded = null; let created = null; let launched = null;
  const launches = [];
  await page.route('**/api/ads/launches', r => r.fulfill({ json: { success: true, launches } }));
  await page.route('**/api/ads/create/image', r => { uploaded = r.request().postDataJSON(); return r.fulfill({ json: { success: true, imageHash: 'abcdef0123456789abcdef0123456789', imageUrl: 'https://scontent.fbcdn.net/new.jpg' } }); });
  await page.route('**/api/ads/create/locations?*', r => r.fulfill({ json: { success: true, locations: [{ key: '1035921', type: 'city', name: 'Hyderabad', region: 'Telangana', country: 'India', countryCode: 'IN' }] } }));
  await page.route('**/api/ads/create/estimate', r => r.fulfill({ json: { success: true, estimate: { lower: 1200000, upper: 1400000 } } }));
  await page.route('**/api/ads/create/preview', r => r.fulfill({ json: { success: true, check: { blocks: [], warnings: ['Check every price in the ad is correct and current.'] }, frameUrl: 'https://business.facebook.com/ads/api/preview_iframe.php?d=e2e', note: null } }));
  await page.route('https://business.facebook.com/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>Meta preview (test)</body></html>' }));
  await page.route('**/api/ads/create', r => { created = r.request().postDataJSON(); return r.fulfill({ json: { success: true, launch: { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', name: created.name, status: 'created', daily_budget: Number(created.dailyBudget), currency: 'INR', ad_id: '104' } } }); });
  await page.route('**/api/ads/launches/*/launch', r => { launched = r.request().postDataJSON(); return r.fulfill({ json: { success: true, launch: { status: 'launched' } } }); });

  await page.goto('/app');
  await page.getByRole('navigation', { name: 'Main menu' }).getByRole('link', { name: /^Ads/ }).click({ timeout: 20000 });
  await page.getByRole('button', { name: 'Create an ad' }).click({ timeout: 15000 });
  const wiz = page.getByRole('dialog', { name: 'Create a WhatsApp ad' });

  // 1. Ad: a 600x600 picture made in the page, text, name.
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 600; c.height = 600; const g = c.getContext('2d'); g.fillStyle = '#0a8'; g.fillRect(0, 0, 600, 600); g.fillStyle = '#fff'; g.fillRect(150, 150, 300, 300); return c.toDataURL('image/png').split(',')[1]; });
  await wiz.getByTestId('ad-image-input').setInputFiles({ name: 'eye-camp.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(wiz.getByAltText('Ad picture')).toBeVisible();
  expect(uploaded.base64.length).toBeGreaterThan(1000);
  await wiz.getByPlaceholder(/Free eye check-up camp/).fill('Free eye check-up camp this weekend. Message us to book a slot.');
  await expect(wiz.getByPlaceholder('e.g. Eye camp – November')).toHaveValue('eye-camp');
  await wiz.getByRole('button', { name: 'Next' }).click();

  // 2. Who sees it.
  await wiz.getByRole('button', { name: 'Next' }).click();
  await expect(wiz.getByRole('alert')).toHaveText('Choose at least one place.');
  await wiz.getByLabel('Search places').fill('hyd');
  await wiz.getByRole('option', { name: /Hyderabad/ }).click();
  await wiz.getByLabel('Area around Hyderabad').selectOption('40');
  await wiz.getByRole('button', { name: 'Estimate reach' }).click();
  await expect(wiz.getByText(/About 12,00,000–14,00,000 people/)).toBeVisible();
  await wiz.getByRole('button', { name: 'Next' }).click();

  // 3. Budget: over the cap is refused, then 500.
  await wiz.locator('input[type=number]').fill('5000');
  await wiz.getByRole('button', { name: 'Next' }).click();
  await expect(wiz.getByRole('alert')).toContainText('most one ad may spend per day');
  await wiz.locator('input[type=number]').fill('500');
  await wiz.getByRole('button', { name: 'Next' }).click();

  // 4. Review: Meta's preview, the check, create paused.
  await expect(wiz.locator('iframe')).toHaveAttribute('src', /business\.facebook\.com/);
  await expect(wiz.getByText('Check every price in the ad is correct and current.')).toBeVisible();
  await page.screenshot({ path: 'test-results/ad-wizard-review.png' });
  await wiz.getByRole('button', { name: 'Create (paused)' }).click();
  await expect(wiz.getByText(/is created in Meta, switched off/)).toBeVisible();
  expect(created).toMatchObject({ name: 'eye-camp', imageHash: 'abcdef0123456789abcdef0123456789', imageUrl: 'https://scontent.fbcdn.net/new.jpg', dailyBudget: '500', gender: 'all' });
  expect(created.locations).toEqual([expect.objectContaining({ key: '1035921', type: 'city', radius: 40 })]);
  expect(created.localImage).toBeUndefined(); // the big in-browser picture is never sent

  // Launch: type the budget.
  const launch = wiz.getByRole('button', { name: 'Launch', exact: true });
  await expect(launch).toBeDisabled();
  await wiz.getByLabel('Type the daily budget to confirm').fill('500');
  await launch.click();
  await expect(wiz.getByText(/Meta is reviewing it/)).toBeVisible();
  expect(launched).toEqual({ confirmBudget: 500 });
  await page.screenshot({ path: 'test-results/ad-wizard-launched.png' });
  expect(errors).toEqual([]);
});

test('Ads G: "only during business hours" (days, hours, end date, whole-run budget) and editing a running ad', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page);
  await page.route('**/api/ads?*', r => r.fulfill({ json: { adsEnabled: true, account: { connected: true, adAccountId: 'act_1', name: 'E2E Ads', currency: 'INR', lastSyncAt: NOW, alerts: { maxCostPerChat: null, maxCostPerConversion: null, windowDays: 3 } }, report: null } }));
  await page.route('**/api/ads/create/readiness', r => r.fulfill({ json: { success: true, ready: true, currency: 'INR', minDailyBudget: 96, maxDailyBudget: 2000, businessNumber: '919701103222', pages: [{ id: '55555', name: 'Shop Page' }], selectedPageId: '55555',
    businessHours: { start: 10, end: 19 }, timezone: 'Asia/Kolkata', checks: ['account', 'permissions', 'page', 'whatsapp', 'budget'].map(key => ({ key, ok: true, label: key, detail: 'ok' })) } }));
  const spec = { text: 'Free eye check-up camp this weekend. Message us to book.', headline: 'Book a slot', greeting: 'Hi! I saw your ad.', imageHash: 'a'.repeat(32), imageUrl: '',
    locations: [{ key: '1035921', type: 'city', name: 'Hyderabad', region: 'Telangana', country: 'India', radius: 25 }], ageMin: 25, ageMax: 60, gender: 'all', placement: 'auto',
    startDate: '2026-11-16', endDate: '2026-11-29', schedule: { days: [1, 2, 3, 4, 5, 6], startHour: 9, endHour: 20 } };
  const launches = [{ id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', name: 'Eye camp', status: 'launched', daily_budget: 500, currency: 'INR', ad_id: '703', created_by: ME.email, created_at: NOW, spec, scheduleLabel: 'Mon, Tue, Wed, Thu, Fri, Sat, 9am–8pm' }];
  await page.route('**/api/ads/launches', r => r.fulfill({ json: { success: true, launches } }));
  let edited = null;
  await page.route('**/api/ads/launches/*', r => {
    if (r.request().method() !== 'PUT') return r.fallback();
    edited = r.request().postDataJSON();
    return r.fulfill({ json: { success: true, changed: ['words or picture', 'budget', 'hours'], review: true, launch: launches[0] } });
  });
  await page.route('**/api/ads/create/locations?*', r => r.fulfill({ json: { success: true, locations: [{ key: '1035921', type: 'city', name: 'Hyderabad', region: 'Telangana', country: 'India', countryCode: 'IN' }] } }));
  await page.route('**/api/ads/create/image', r => r.fulfill({ json: { success: true, imageHash: 'b'.repeat(32), imageUrl: 'https://scontent.fbcdn.net/new.jpg' } }));

  await page.goto('/admin/ads/create');
  await expect(page.getByText('Mon, Tue, Wed, Thu, Fri, Sat, 9am–8pm', { exact: false })).toBeVisible({ timeout: 20000 });

  // --- The wizard's Budget step: business hours.
  await page.getByRole('button', { name: 'Create an ad' }).click();
  const wiz = page.getByRole('dialog', { name: 'Create a WhatsApp ad' });
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 600; c.height = 600; const g = c.getContext('2d'); g.fillStyle = '#0a8'; g.fillRect(0, 0, 600, 600); return c.toDataURL('image/png').split(',')[1]; });
  await wiz.getByTestId('ad-image-input').setInputFiles({ name: 'opd.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await wiz.getByPlaceholder(/Free eye check-up camp/).fill('Evening OPD at the clinic. Message us to book.');
  await wiz.getByRole('button', { name: 'Next' }).click();
  await wiz.getByLabel('Search places').fill('hyd');
  await wiz.getByRole('option', { name: /Hyderabad/ }).click();
  await wiz.getByRole('button', { name: 'Next' }).click();
  await wiz.getByTestId('ad-when-hours').check();
  const sched = wiz.getByTestId('ad-schedule');
  // Defaults: the business's own hours (10 to 7 pm), Monday to Saturday.
  await expect(sched.getByLabel('From')).toHaveValue('10');
  await expect(sched.getByLabel('Until')).toHaveValue('19');
  await expect(sched.getByRole('button', { name: 'Sun' })).toHaveAttribute('aria-pressed', 'false');
  await expect(sched.getByRole('button', { name: 'Mon' })).toHaveAttribute('aria-pressed', 'true');
  await expect(sched).toContainText('Asia/Kolkata');
  await wiz.getByRole('button', { name: 'Next' }).click();
  await expect(wiz.getByRole('alert')).toContainText('needs an end date');
  await wiz.getByLabel('Start date', { exact: true }).fill('2026-11-16');
  await wiz.getByLabel('End date', { exact: true }).fill('2026-11-22');
  await expect(wiz.getByTestId('ad-budget-summary')).toContainText('Runs on 6 of 7 days');
  await expect(wiz.getByTestId('ad-budget-summary')).toContainText('₹3,000');
  await wiz.getByRole('button', { name: 'Close' }).click().catch(() => {});
  await page.keyboard.press('Escape');

  // --- Edit the running ad.
  await page.goto('/admin/ads/create');
  await page.getByRole('button', { name: 'Edit', exact: true }).click({ timeout: 20000 });
  const dlg = page.getByRole('dialog', { name: 'Edit Eye camp' });
  await dlg.getByLabel('Ad text').fill('Free eye check-up camp on Sunday. Message us to book.');
  await expect(dlg.getByTestId('ad-edit-review-note')).toBeVisible();
  await dlg.getByRole('tab', { name: 'Budget and dates' }).click();
  await dlg.getByTestId('ad-schedule').getByLabel('Until').selectOption('18');
  await dlg.getByLabel('Daily budget').fill('600');
  await dlg.getByRole('button', { name: 'Save changes' }).click();
  await expect(dlg.getByRole('alert')).toContainText('Type the new daily amount (600)');
  await dlg.getByLabel('Confirm the new daily amount').fill('600');
  await expect(dlg.getByTestId('ad-budget-summary')).toContainText('₹7,200');
  await page.screenshot({ path: 'test-results/ad-edit.png' });
  await dlg.getByRole('button', { name: 'Save changes' }).click();
  await expect(dlg).toHaveCount(0);
  // Only what changed is sent (never the number the ad opens).
  expect(edited).toEqual({ text: 'Free eye check-up camp on Sunday. Message us to book.', schedule: { days: [1, 2, 3, 4, 5, 6], startHour: 9, endHour: 18 }, dailyBudget: 600, confirmBudget: 600 });
  await expect(page.getByText(/Saved in Meta: words or picture, budget, hours/)).toBeVisible();
  expect(errors).toEqual([]);
});

test('Ads E: carousel, choose the number, where it shows (no Status for healthcare), and Bookings to Meta', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page);
  await page.addInitScript(() => { try { if (!sessionStorage.getItem('e2e_e')) { localStorage.setItem('ads_page_tab_v1', 'create'); sessionStorage.setItem('e2e_e', '1'); } } catch { /* */ } });
  await page.route('**/api/ads?*', r => r.fulfill({ json: { adsEnabled: true, account: { connected: true, adAccountId: 'act_1', name: 'E2E Ads', currency: 'INR', lastSyncAt: NOW, alerts: { maxCostPerChat: null, maxCostPerConversion: null, windowDays: 3 } }, report: null } }));
  await page.route('**/api/ads/create/readiness', r => r.fulfill({ json: { success: true, ready: true, currency: 'INR', minDailyBudget: 96, maxDailyBudget: 2000, businessNumber: '919701103222', pages: [{ id: '55555', name: 'Shop Page' }], selectedPageId: '55555',
    adNumber: { phone: '919701103222', label: 'Reception' }, statusAllowed: false,
    numbers: [{ id: '222000000000001', label: 'Reception', phone: '919701103222', main: true, linked: true }, { id: '222000000000002', label: 'Pharmacy', phone: '919701103223', main: false, linked: false }],
    checks: ['account', 'permissions', 'page', 'whatsapp', 'budget'].map(key => ({ key, ok: true, label: key, detail: 'ok' })) } }));
  await page.route('**/api/ads/launches', r => r.fulfill({ json: { success: true, launches: [] } }));
  let n = 0;
  await page.route('**/api/ads/create/image', r => { n++; return r.fulfill({ json: { success: true, imageHash: `${String(n).repeat(8)}abcdef0123456789abcdef01`, imageUrl: `https://scontent.fbcdn.net/${n}.jpg` } }); });
  await page.route('**/api/ads/create/locations?*', r => r.fulfill({ json: { success: true, locations: [{ key: '1035921', type: 'city', name: 'Hyderabad', region: 'Telangana', country: 'India', countryCode: 'IN' }] } }));
  await page.route('**/api/ads/create/preview', r => r.fulfill({ json: { success: true, check: { blocks: [], warnings: [] }, frameUrl: null, note: null } }));
  let created = null;
  await page.route('**/api/ads/create', r => { created = r.request().postDataJSON(); return r.fulfill({ json: { success: true, launch: { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', name: created.name, status: 'created', daily_budget: 500, currency: 'INR', ad_id: '104' } } }); });
  let conv = { settings: { enabled: false, bookingValue: null, currency: 'INR', updatedBy: null, updatedAt: null, tableReady: true }, last30: { sent: 3, waiting: 1, failed: 1 }, lastSentAt: NOW, lastError: { message: 'Meta refused it: (#200) Requires whatsapp_business_manage_events permission', at: NOW }, eventName: 'LeadSubmitted' };
  let saved = null;
  await page.route('**/api/ads/conversions', r => {
    if (r.request().method() === 'PUT') { saved = r.request().postDataJSON(); conv = { ...conv, settings: { ...conv.settings, ...saved } }; return r.fulfill({ json: { success: true, ...conv } }); }
    return r.fulfill({ json: { success: true, ...conv } });
  });

  await page.goto('/app');
  await page.getByRole('navigation', { name: 'Main menu' }).getByRole('link', { name: /^Ads/ }).click({ timeout: 20000 });
  await page.getByRole('button', { name: 'Create an ad' }).click({ timeout: 15000 });
  const wiz = page.getByRole('dialog', { name: 'Create a WhatsApp ad' });
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 600; c.height = 600; const g = c.getContext('2d'); g.fillStyle = '#a80'; g.fillRect(0, 0, 600, 600); return c.toDataURL('image/png').split(',')[1]; });
  const file = (name) => ({ name, mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await wiz.getByTestId('ad-image-input').setInputFiles(file('offer.png'));
  await expect(wiz.getByAltText('Ad picture')).toBeVisible();
  // E4: a second picture makes a carousel; each picture gets its own headline.
  await wiz.getByTestId('ad-more-image-input').setInputFiles(file('second.png'));
  await expect(wiz.getByTestId('carousel-cards')).toContainText('Carousel: 2 pictures');
  await wiz.getByLabel('Headline for picture 2').fill('Pharmacy home delivery');
  // E2: the number the ad opens (default: the Page's own).
  const num = wiz.getByTestId('ad-number-select');
  await expect(num.locator('option').first()).toContainText('Reception (+919701103222) – linked to the Page');
  await num.selectOption('222000000000002');
  await wiz.getByPlaceholder(/Free eye check-up camp/).fill('Medicines delivered at home. Message us on WhatsApp.');
  await page.screenshot({ path: 'test-results/ad-wizard-carousel.png' });
  await wiz.getByRole('button', { name: 'Next' }).click();

  // E3: where it shows. WhatsApp Status is off for a healthcare business.
  await wiz.getByLabel('Search places').fill('hyd');
  await wiz.getByRole('option', { name: /Hyderabad/ }).click();
  const where = wiz.getByTestId('ad-placement');
  await expect(where.getByRole('radio', { name: /WhatsApp Status/ })).toBeDisabled();
  await expect(where).toContainText('Not available: Meta doesn\'t allow WhatsApp Status ads for healthcare');
  await where.getByRole('radio', { name: /^Facebook \+ Instagram: feeds, Stories, Reels/ }).check();
  await wiz.getByRole('button', { name: 'Next' }).click();
  await wiz.getByRole('button', { name: 'Next' }).click();
  await expect(wiz.getByText('Carousel of 2')).toBeVisible();
  await expect(wiz.getByText('Pharmacy (+919701103223)')).toBeVisible();
  await wiz.getByRole('button', { name: 'Create (paused)' }).click();
  await expect.poll(() => created?.placement).toBe('feeds_stories');
  expect(created.numberId).toBe('222000000000002');
  expect(created.cards).toHaveLength(2);
  expect(created.cards[1]).toEqual({ imageHash: '22222222abcdef0123456789abcdef01', imageUrl: 'https://scontent.fbcdn.net/2.jpg', headline: 'Pharmacy home delivery' });
  expect(created.imageHash).toBe(created.cards[0].imageHash);
  expect(JSON.stringify(created)).not.toContain('data:image'); // in-browser pictures never sent
  await wiz.getByRole('button', { name: 'Close' }).click();

  // E1: Bookings to Meta tab.
  await page.getByRole('tab', { name: 'Bookings to Meta' }).click();
  const card = page.getByTestId('ad-conversions');
  await expect(card.getByTestId('conversions-state')).toHaveText('Off');
  await expect(card.getByTestId('conversions-counts')).toContainText('3');
  await expect(card.getByTestId('conversions-error')).toContainText('whatsapp_business_manage_events');
  await card.getByRole('button', { name: 'Switch on' }).click();
  await expect.poll(() => saved).toEqual({ enabled: true });
  await expect(card.getByTestId('conversions-state')).toHaveText('On');
  await page.screenshot({ path: 'test-results/ads-conversions.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('Ads I: an existing Instagram post as an ad, and more ads in one campaign (same audience / new audience), grouped', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page);
  await page.route('**/api/ads?*', r => r.fulfill({ json: { adsEnabled: true, account: { connected: true, adAccountId: 'act_1', name: 'E2E Ads', currency: 'INR', lastSyncAt: NOW, alerts: { maxCostPerChat: null, maxCostPerConversion: null, windowDays: 3 } }, report: null } }));
  await page.route('**/api/ads/create/readiness', r => r.fulfill({ json: { success: true, ready: true, currency: 'INR', minDailyBudget: 96, maxDailyBudget: 2000, businessNumber: '919701103222', pages: [{ id: '55555', name: 'Shop Page' }], selectedPageId: '55555',
    instagram: { id: '17840000000001', username: 'sunrise_clinic' }, checks: ['account', 'permissions', 'page', 'whatsapp', 'budget'].map(key => ({ key, ok: true, label: key, detail: 'ok' })) } }));
  const spec = { text: 'Free eye check-up camp this weekend.', headline: '', greeting: 'Hi!', imageHash: 'a'.repeat(32), imageUrl: '', locations: [{ key: '1035921', type: 'city', name: 'Hyderabad', region: 'Telangana', country: 'India', radius: 25 }],
    ageMin: 25, ageMax: 60, gender: 'all', placement: 'auto', startDate: '2026-11-10', endDate: null, schedule: null, number: '919701103222' };
  const launches = [
    { id: 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001', name: 'Eye camp', status: 'launched', daily_budget: 500, currency: 'INR', campaign_id: '700', adset_id: '701', ad_id: '703', created_by: ME.email, created_at: '2026-11-10T10:00:00Z', spec },
    { id: 'aaaaaaaa-bbbb-4ccc-8ddd-000000000002', name: 'Eye camp – reel', status: 'created', daily_budget: 500, currency: 'INR', campaign_id: '700', adset_id: '701', ad_id: '704', created_by: ME.email, created_at: '2026-11-11T10:00:00Z',
      spec: { ...spec, addedTo: 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001', sharedAdset: true } },
    { id: 'aaaaaaaa-bbbb-4ccc-8ddd-000000000003', name: 'Pharmacy delivery', status: 'created', daily_budget: 300, currency: 'INR', campaign_id: '800', adset_id: '801', ad_id: '803', created_by: ME.email, created_at: '2026-11-09T10:00:00Z', spec },
  ];
  await page.route('**/api/ads/launches', r => r.fulfill({ json: { success: true, launches } }));
  await page.route('**/api/ads/create/posts?*', r => {
    const source = new URL(r.request().url()).searchParams.get('source');
    return r.fulfill({ json: { success: true, posts: source === 'instagram' ? [
      { source: 'instagram', id: '18000000000000001', caption: 'Free eye check-up camp this Sunday at Sunrise Clinic', pictureUrl: '', permalink: 'https://instagram.com/p/1', createdAt: NOW, kind: 'IMAGE', eligible: true, reason: '', igEligible: true,
        inAds: [{ name: 'Eye camp boost', status: 'running' }] },
      { source: 'instagram', id: '18000000000000002', caption: 'Our song reel', pictureUrl: '', permalink: '', createdAt: NOW, kind: 'VIDEO', eligible: false, reason: 'Contains copyrighted music', igEligible: true },
    ] : [{ source: 'facebook', id: '55555_900000000001', caption: 'Facebook post', pictureUrl: '', permalink: '', createdAt: NOW, kind: '', eligible: true, reason: '', igEligible: false }] } });
  });
  await page.route('**/api/ads/create/preview', r => r.fulfill({ json: { success: true, check: { blocks: [], warnings: [] }, frameUrl: null, note: null } }));
  await page.route('**/api/ads/create/image', r => r.fulfill({ json: { success: true, imageHash: 'c'.repeat(32), imageUrl: 'https://scontent.fbcdn.net/c.jpg' } }));
  await page.route('**/api/ads/create/locations?*', r => r.fulfill({ json: { success: true, locations: [{ key: '1035921', type: 'city', name: 'Hyderabad', region: 'Telangana', country: 'India', countryCode: 'IN' }] } }));
  let created = null; let added = null; let addedTo = '';
  await page.route('**/api/ads/create', r => { created = r.request().postDataJSON(); return r.fulfill({ json: { success: true, launch: { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', name: created.name, status: 'created', daily_budget: 500, currency: 'INR' } } }); });
  await page.route('**/api/ads/launches/*/ads', r => { added = r.request().postDataJSON(); addedTo = r.request().url(); return r.fulfill({ json: { success: true, launch: { id: 'aaaaaaaa-bbbb-4ccc-8ddd-ffffffffffff', name: added.name, status: 'created', daily_budget: 500, currency: 'INR' } } }); });

  await page.goto('/admin/ads/create');
  // The list: campaigns grouped; the shared ad marked; "Add an ad to this campaign" per campaign.
  const groups = page.getByTestId('ad-campaign-group');
  await expect(groups).toHaveCount(2, { timeout: 20000 });
  await expect(groups.first()).toContainText('Campaign “Eye camp” · 2 ads');
  await expect(groups.first()).toContainText('Same audience & budget');
  await expect(groups.first()).toContainText('shares the budget above');
  await page.screenshot({ path: 'test-results/ads-i-grouped.png' });

  // --- I2: an existing Instagram post.
  await page.getByRole('button', { name: 'Create an ad' }).click();
  const wiz = page.getByRole('dialog', { name: 'Create a WhatsApp ad' });
  await wiz.getByRole('radio', { name: 'Use an existing post' }).click();
  const picker = wiz.getByTestId('ad-post-picker');
  await expect(picker.getByRole('tab', { name: 'Instagram posts' })).toHaveAttribute('aria-selected', 'true');
  await expect(picker.getByTestId('ad-post-18000000000000002')).toBeDisabled();
  await expect(picker).toContainText('Contains copyrighted music');
  // A post another ad already uses is marked; choosing it explains the overlap (not blocked).
  await expect(picker.getByTestId('ad-post-18000000000000001').getByTestId('ad-post-in-ads')).toHaveText('Already in an ad');
  await expect(picker.getByTestId('ad-post-18000000000000002').getByTestId('ad-post-in-ads')).toHaveCount(0);
  await picker.getByTestId('ad-post-18000000000000001').click();
  await expect(picker.getByTestId('ad-post-chosen')).toContainText('Instagram post');
  await expect(picker.getByTestId('ad-post-in-ads-note')).toContainText('already in “Eye camp boost” (running)');
  await expect(wiz.getByPlaceholder('e.g. Eye camp post – boost')).toHaveValue('Free eye check-up camp this Sunday at Sunrise Clinic');
  await page.screenshot({ path: 'test-results/ads-i-post-picker.png' });
  await wiz.getByRole('button', { name: 'Next' }).click();
  await wiz.getByLabel('Search places').fill('hyd');
  await wiz.getByRole('option', { name: /Hyderabad/ }).click();
  await wiz.getByRole('button', { name: 'Next' }).click();
  await wiz.getByRole('button', { name: 'Next' }).click();
  await expect(wiz.getByText('Existing Instagram post (its own words and picture)')).toBeVisible();
  await expect(wiz.getByTestId('ad-review-post')).toContainText('Send WhatsApp message');
  await wiz.getByRole('button', { name: 'Create (paused)' }).click();
  await expect.poll(() => created?.post?.id).toBe('18000000000000001');
  expect([created.text, created.imageHash, created.iceBreakers]).toEqual(['', '', []]);
  expect(created).not.toHaveProperty('source');
  await wiz.getByRole('button', { name: 'Close' }).click();

  // --- I1: add an ad to the "Eye camp" campaign with the same audience and budget (2 steps).
  await groups.first().getByTestId('ad-add-to-campaign').click();
  const add = page.getByRole('dialog', { name: 'Add an ad to the campaign' });
  await expect(add.getByTestId('ad-add-mode')).toContainText('₹500/day budget');
  await add.getByTestId('ad-add-same').click();
  await expect(add.getByRole('list', { name: 'Steps' })).toHaveText(/1\. Ad.*2\. Review/);
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 600; c.height = 600; const g = c.getContext('2d'); g.fillStyle = '#a08'; g.fillRect(0, 0, 600, 600); return c.toDataURL('image/png').split(',')[1]; });
  await add.getByTestId('ad-image-input').setInputFiles({ name: 'second.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await add.getByPlaceholder(/Free eye check-up camp/).fill('Second picture for the eye camp. Message us to book.');
  await add.getByRole('button', { name: 'Next' }).click();
  await expect(add.getByTestId('ad-review-shared')).toContainText('Same as “Eye camp” (₹500/day, shared)');
  await page.screenshot({ path: 'test-results/ads-i-add-review.png' });
  await add.getByRole('button', { name: 'Create (paused)' }).click();
  await expect.poll(() => added?.mode).toBe('same_audience');
  expect(addedTo).toContain('/api/ads/launches/aaaaaaaa-bbbb-4ccc-8ddd-000000000001/ads');
  expect(added.imageHash).toBe('c'.repeat(32));
  await add.getByRole('button', { name: 'Close' }).click();

  // Delete (with an in-app "Are you sure?"): the second campaign's lone ad.
  let deleted = '';
  await page.route('**/api/ads/launches/*', r => (r.request().method() === 'DELETE' ? (deleted = r.request().url(), r.fulfill({ json: { success: true, deleted: true, inMeta: true, removed: ['ad', 'ad set', 'campaign'] } })) : r.fallback()));
  await groups.nth(1).getByTestId('ad-delete').click();
  await expect(page.getByRole('dialog')).toContainText('Delete “Pharmacy delivery”?');
  await page.getByTestId('confirm-ok').click();
  await expect.poll(() => deleted).toContain('/api/ads/launches/aaaaaaaa-bbbb-4ccc-8ddd-000000000003');

  // The shared ad's Edit shows only the words (its audience and budget are the first ad's).
  await groups.first().getByTestId('ad-launch-row').nth(1).getByRole('button', { name: 'Edit' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit Eye camp – reel' });
  await expect(edit.getByTestId('ad-edit-shared')).toBeVisible();
  await expect(edit.getByRole('tab')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('Ads H: tall picture, video (upload -> Meta -> ready), quick questions and more targeting', async ({ page }) => {
  test.setTimeout(90000);
  const errors = watchErrors(page);
  await fakeBackend(page);
  await page.route('**/api/ads?*', r => r.fulfill({ json: { adsEnabled: true, account: { connected: true, adAccountId: 'act_1', name: 'E2E Ads', currency: 'INR', lastSyncAt: NOW, alerts: { maxCostPerChat: null, maxCostPerConversion: null, windowDays: 3 } }, report: null } }));
  await page.route('**/api/ads/create/readiness', r => r.fulfill({ json: { success: true, ready: true, currency: 'INR', minDailyBudget: 96, maxDailyBudget: 2000, businessNumber: '919701103222', pages: [{ id: '55555', name: 'Shop Page' }], selectedPageId: '55555',
    checks: ['account', 'permissions', 'page', 'whatsapp', 'budget'].map(key => ({ key, ok: true, label: key, detail: 'ok' })) } }));
  await page.route('**/api/ads/launches', r => r.fulfill({ json: { success: true, launches: [] } }));
  let n = 0;
  await page.route('**/api/ads/create/image', r => { n++; return r.fulfill({ json: { success: true, imageHash: `${String(n).repeat(8)}abcdef0123456789abcdef01`, imageUrl: `https://scontent.fbcdn.net/${n}.jpg` } }); });
  await page.route('**/api/ads/create/locations?*', r => r.fulfill({ json: { success: true, locations: [{ key: '1035921', type: 'city', name: 'Hyderabad', region: 'Telangana', country: 'India', countryCode: 'IN' }, { key: '1035922', type: 'city', name: 'Secunderabad', region: 'Telangana', country: 'India', countryCode: 'IN' }] } }));
  await page.route('**/api/ads/create/interests?*', r => r.fulfill({ json: { success: true, interests: [{ id: '6003107902433', name: 'Yoga', path: ['Fitness', 'Yoga'], size: 900000 }] } }));
  await page.route('**/api/ads/create/languages?*', r => r.fulfill({ json: { success: true, languages: [{ key: 46, name: 'Telugu' }] } }));
  await page.route('**/api/ads/create/preview', r => r.fulfill({ json: { success: true, check: { blocks: [], warnings: [] }, frameUrl: null, note: null } }));
  // Video: a one-time upload link (private storage), the upload itself, handing it to Meta, Meta's processing.
  let uploadAsk = null; let uploaded = false; let registered = null; let statusAsks = 0;
  const VPATH = 'a0000000-0000-4000-8000-000000000001/12345678-1234-4234-8234-123456789abc.mp4';
  await page.route('**/api/ads/create/video/upload-url', r => { uploadAsk = r.request().postDataJSON(); return r.fulfill({ json: { success: true, uploadUrl: 'https://e2e-test.supabase.co/storage/v1/object/upload/sign/ad-videos/v.mp4?token=up', path: VPATH } }); });
  await page.route('https://e2e-test.supabase.co/**', r => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'PUT, OPTIONS', 'Access-Control-Allow-Headers': 'x-upsert, content-type' };
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    uploaded = r.request().method() === 'PUT';
    return r.fulfill({ status: 200, json: { Key: 'ad-videos/v.mp4' }, headers: cors });
  });
  await page.route('**/api/ads/create/video', r => { registered = r.request().postDataJSON(); return r.fulfill({ json: { success: true, videoId: '880000000001', path: VPATH } }); });
  await page.route('**/api/ads/create/video/*/status', r => { statusAsks++; return r.fulfill({ json: { success: true, status: 'ready', seconds: 14 } }); });
  let created = null;
  await page.route('**/api/ads/create', r => { created = r.request().postDataJSON(); return r.fulfill({ json: { success: true, launch: { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', name: created.name, status: 'created', daily_budget: 500, currency: 'INR', ad_id: '104' } } }); });

  await page.goto('/admin/ads/create');
  await page.getByRole('button', { name: 'Create an ad' }).click({ timeout: 20000 });
  const wiz = page.getByRole('dialog', { name: 'Create a WhatsApp ad' });
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 600; c.height = 600; const g = c.getContext('2d'); g.fillStyle = '#08a'; g.fillRect(0, 0, 600, 600); return c.toDataURL('image/png').split(',')[1]; });
  const file = (name) => ({ name, mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await wiz.getByTestId('ad-image-input').setInputFiles(file('square.png'));
  await expect(wiz.getByAltText('Ad picture')).toBeVisible();

  // H2: a tall picture for Stories / Status.
  await wiz.getByTestId('ad-tall-input').setInputFiles(file('tall.png'));
  await expect(wiz.getByTestId('ad-tall-picture').getByAltText('Tall picture')).toBeVisible();

  // H1: quick questions instead of a pre-typed message.
  const chat = wiz.getByTestId('ad-chat-start');
  await chat.getByTestId('ad-chat-questions').check();
  await expect(chat.getByLabel('Quick question 1')).toHaveValue('Book an appointment');
  await chat.getByRole('textbox', { name: 'Welcome line' }).fill('Welcome to Sunrise Clinic!');
  await chat.getByLabel('Quick question 2').fill('What is the consultation fee?');
  await chat.getByRole('button', { name: 'Add a question' }).click();
  await chat.getByLabel('Quick question 3').fill('Where are you located?');
  await wiz.getByPlaceholder(/Free eye check-up camp/).fill('Evening OPD at Sunrise Clinic. Message us to book.');
  await page.screenshot({ path: 'test-results/ad-wizard-h-tall-questions.png' });

  // H3: a video replaces the tall picture (the square picture becomes its cover).
  await wiz.getByTestId('ad-video-input').setInputFiles({ name: 'clinic.mp4', mimeType: 'video/mp4', buffer: Buffer.from('fake mp4 bytes') });
  await expect.poll(() => registered).toEqual({ path: VPATH });
  expect(uploadAsk).toEqual({ type: 'video/mp4', size: 14 });
  expect(uploaded).toBe(true);
  await expect(wiz.getByTestId('ad-tall-picture')).toHaveCount(0);
  await expect(wiz.getByTestId('ad-video-status')).toContainText('Meta is processing it');
  await expect(wiz.getByTestId('ad-video-status')).toContainText('Ready', { timeout: 20000 }); // checked after 10 s
  expect(statusAsks).toBe(1);
  await wiz.getByRole('button', { name: 'Next' }).click();

  // H4: more targeting.
  await wiz.getByLabel('Search places').fill('hyd');
  await wiz.getByRole('option', { name: /Hyderabad/ }).click();
  const extras = wiz.getByTestId('ad-targeting-extras');
  await extras.getByRole('button', { name: /More targeting/ }).click();
  await extras.getByLabel('Search interests').fill('yoga');
  await extras.getByRole('option', { name: 'Yoga' }).click();
  await extras.getByLabel('Search places to leave out').fill('sec');
  await extras.getByRole('option', { name: /Secunderabad/ }).click();
  await extras.getByLabel('Search languages').fill('tel');
  await extras.getByRole('option', { name: 'Telugu' }).click();
  await expect(extras).toContainText('More targeting (optional): 3 chosen');
  await page.screenshot({ path: 'test-results/ad-wizard-h-targeting.png' });
  await wiz.getByRole('button', { name: 'Next' }).click();
  await wiz.getByRole('button', { name: 'Next' }).click();

  // Review, then create.
  await expect(wiz.getByText('Video (clinic.mp4) with a cover picture')).toBeVisible();
  await expect(wiz.getByText(/3 quick question\(s\): Book an appointment · What is the consultation fee\? · Where are you located\?/)).toBeVisible();
  await expect(wiz.getByText('Interests: Yoga · Not in: Secunderabad · Languages: Telugu')).toBeVisible();
  await page.screenshot({ path: 'test-results/ad-wizard-h-review.png' });
  await wiz.getByRole('button', { name: 'Create (paused)' }).click();
  await expect.poll(() => created?.videoId).toBe('880000000001');
  expect(created.videoPath).toBe(VPATH);
  expect(created.iceBreakers).toEqual(['Book an appointment', 'What is the consultation fee?', 'Where are you located?']);
  expect(created.greeting).toBe('Welcome to Sunrise Clinic!');
  expect(created.tallImageHash || '').toBe('');
  expect(created.interests).toEqual([{ id: '6003107902433', name: 'Yoga' }]);
  expect(created.excludedLocations.map(l => l.key)).toEqual(['1035922']);
  expect(created.languages).toEqual([{ key: 46, name: 'Telugu' }]);
  for (const k of ['chatStart', 'tallLocal', 'videoName', 'videoStatus']) expect(created).not.toHaveProperty(k); // browser-only fields stay in the browser
  expect(JSON.stringify(created)).not.toContain('data:image');
  expect(errors).toEqual([]);
});

test('Ads billing card: payment type, amounts, a failed payment (badge + "Fix payment in Meta"), Check now, spending limit', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page);
  await page.route('**/api/ads?*', r => r.fulfill({ json: { adsEnabled: true, account: { connected: true, adAccountId: 'act_1111111111', name: 'E2E Ads', currency: 'INR', lastSyncAt: NOW, alerts: { maxCostPerChat: null, maxCostPerConversion: null, windowDays: 3 } }, report: null } }));
  let billing = { status: 3, statusLabel: 'Payment failed', problem: 'payment', problemText: 'A payment failed and money is owed, so Meta has paused every ad on this account. Pay the amount due in Meta to restart them.', disableReason: null, prepaid: false, due: 1180, spent: 2860, spendCap: null, method: 'Visa *4242', currency: 'INR' };
  const answer = () => ({ success: true, billing, checkedAt: NOW, billingUrl: 'https://business.facebook.com/billing_hub/accounts/details/?asset_id=1111111111', canEditLimit: true });
  await page.route('**/api/ads/billing', r => r.fulfill({ json: answer() }));
  await page.route('**/api/ads/issues', r => r.fulfill({ json: { success: true, unread: 0, issues: [], billingProblem: billing.problem ? { problem: billing.problem, label: billing.statusLabel } : null } }));
  let checked = 0;
  await page.route('**/api/ads/billing/check', r => { checked++; billing = { ...billing, status: 1, statusLabel: 'Active', problem: null, problemText: null, due: 0 }; return r.fulfill({ json: answer() }); });
  let sentCap;
  await page.route('**/api/ads/billing/spend-cap', r => { sentCap = r.request().postDataJSON(); billing = { ...billing, spendCap: 50000 }; return r.fulfill({ json: answer() }); });

  await page.goto('/admin/ads/results');
  const menu = page.getByRole('navigation', { name: 'Main menu' });
  await expect(menu.getByTestId('ads-badge')).toHaveText('1', { timeout: 20000 });
  const card = page.getByTestId('ads-billing');
  await expect(card.getByTestId('billing-status')).toHaveText('Payment failed');
  await expect(card.getByTestId('billing-problem')).toContainText('paused every ad');
  await expect(card.getByText('Automatic payments', { exact: true })).toBeVisible();
  await expect(card.getByText('₹1,180')).toBeVisible();
  await expect(card.getByText('Visa *4242')).toBeVisible();
  const link = card.getByTestId('billing-meta-link');
  await expect(link).toHaveText(/Fix payment in Meta/);
  await expect(link).toHaveAttribute('href', /billing_hub\/accounts\/details\/\?asset_id=1111111111$/);
  await expect(link).toHaveAttribute('target', '_blank');
  await page.screenshot({ path: 'test-results/ads-billing.png' });

  // Paid in Meta, then "Check now": the warning and the badge go away.
  await card.getByRole('button', { name: 'Check now' }).click();
  await expect(card.getByTestId('billing-status')).toHaveText('Active');
  await expect(card.getByTestId('billing-problem')).toHaveCount(0);
  await expect(menu.getByTestId('ads-badge')).toHaveCount(0);
  await expect(link).toHaveText(/View bills in Meta/);
  expect(checked).toBe(1);

  // Business Admin sets an account spending limit.
  await card.getByRole('button', { name: 'Change the spending limit' }).click();
  await card.getByTestId('spend-cap-input').fill('50,000');
  await expect(card.getByTestId('spend-cap-input')).toHaveValue('50000');
  await card.getByRole('button', { name: 'Save limit' }).click();
  await expect(card.getByText('₹50,000')).toBeVisible();
  expect(sentCap).toEqual({ spendCap: '50000' });
  expect(errors).toEqual([]);
});

test('Ads billing card: prepaid accounts get "Add funds in Meta"; managers see the card but cannot change the limit', async ({ page }) => {
  await fakeBackend(page, { role: 'manager' });
  await page.route('**/api/ads?*', r => r.fulfill({ json: { adsEnabled: true, account: { connected: true, adAccountId: 'act_1', name: 'E2E Ads', currency: 'INR', lastSyncAt: NOW, alerts: { maxCostPerChat: null, maxCostPerConversion: null, windowDays: 3 } }, report: null } }));
  await page.route('**/api/ads/billing', r => r.fulfill({ json: { success: true, checkedAt: NOW, billingUrl: 'https://business.facebook.com/billing_hub/accounts/details/?asset_id=1', canEditLimit: false,
    billing: { status: 1, statusLabel: 'Active', problem: null, problemText: null, disableReason: null, prepaid: true, due: 0, spent: 1200, spendCap: 5000, method: null, currency: 'INR',
      ownership: { adAccount: { id: '111111', name: 'Vanguard Media' }, personal: false, adKnown: true, whatsapp: { id: '3577031679194010', name: 'Mayurahospitals' }, same: false } } } }));
  await page.goto('/manager/ads/results');
  // Who owns the ad account: a different portfolio is explained, with the guide one click away.
  const owner = page.getByTestId('ads-ownership');
  await expect(owner).toContainText('Ad account owned by: Vanguard Media (business portfolio)', { timeout: 20000 });
  await expect(owner).toContainText('WhatsApp account owned by: Mayurahospitals');
  await expect(owner.getByTestId('ads-ownership-warning')).toContainText('shows "0 ad accounts" in Meta');
  await owner.getByRole('button', { name: 'How Meta is organised' }).click();
  await expect(page).toHaveURL(/\/manager\/ads\/guide$/);
  const guide = page.getByTestId('meta-org-guide');
  // A booklet: contents, chapter 1 open, the others one click away.
  const contents = guide.getByRole('navigation', { name: 'Booklet contents' });
  await expect(contents.getByRole('listitem')).toHaveCount(14);
  await expect(guide.getByTestId('org-chapter-big-picture')).toContainText('WhatsApp Manager');
  await expect(guide.getByTestId('org-chapter-partners')).not.toContainText('0 ad accounts');
  await contents.getByRole('button', { name: /Partners and agencies/ }).click();
  await expect(guide.getByTestId('org-chapter-partners')).toContainText('My portfolio shows 0 ad accounts, but my ads still show here. Why?');
  await contents.getByRole('button', { name: /System users and access tokens/ }).click();
  await expect(guide.getByTestId('org-chapter-system-users')).toContainText('Employee system user');
  await guide.getByRole('button', { name: 'Open all' }).click();
  await expect(guide.getByLabel('Campaign, ad set and ads example')).toContainText('Free Eye Camp – November');
  await expect(guide.getByTestId('org-chapter-people-roles')).toContainText('Full control');
  await expect(guide).not.toContainText('Mayura');
  await page.screenshot({ path: 'test-results/meta-org-guide.png', fullPage: true });
  // Pictures: every chapter but the glossary has at least one captioned figure.
  expect(await guide.getByTestId('guide-figure').count()).toBeGreaterThanOrEqual(15);
  await expect(guide.getByRole('group', { name: 'Which role should I give?' })).toContainText('Finance role');
  await expect(guide.getByRole('group', { name: 'Agency runs ads from its own ad account' })).toContainText('Ad accounts: 0');
  for (const id of ['big-picture', 'hierarchy', 'people-roles', 'system-users', 'partners', 'whatsapp', 'ads', 'payments']) {
    await guide.getByTestId(`org-chapter-${id}`).screenshot({ path: `test-results/meta-org-${id}.png` });
  }
  // Phone width: flow charts stack vertically and nothing scrolls sideways.
  await page.setViewportSize({ width: 390, height: 900 });
  await guide.getByTestId('org-chapter-system-users').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await guide.getByRole('group', { name: 'From system user to a working CRM' }).screenshot({ path: 'test-results/meta-org-phone-flow.png' });
  await page.setViewportSize({ width: 1280, height: 720 });
  await guide.getByRole('button', { name: 'Close all' }).click();
  await page.getByRole('tab', { name: 'Ad results' }).click();
  const card = page.getByTestId('ads-billing');
  await expect(card.getByText('Prepaid', { exact: true })).toBeVisible({ timeout: 20000 });
  await expect(card.getByTestId('billing-meta-link')).toHaveText(/Add funds in Meta/);
  await expect(card.getByText('Prepaid funds')).toBeVisible();
  await expect(card.getByText('₹5,000')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Change the spending limit' })).toHaveCount(0);
});

test('Ads F: rejected / auto-paused ads need attention (badge + Got it), duplicate, auto-pause, Instagram, use as a start', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page);
  await page.addInitScript(() => { try { if (!sessionStorage.getItem('e2e_f')) { localStorage.setItem('ads_page_tab_v1', 'results'); sessionStorage.setItem('e2e_f', '1'); } } catch { /* */ } });
  const ad = { adId: '901', adName: 'Diwali sweets', campaignId: 'c1', campaignName: 'Diwali', adsetId: 's1', adsetName: 'Set', status: 'ACTIVE', firstDate: '2026-11-01', lastDate: '2026-11-10',
    spend: 900, impressions: 9000, reach: 8000, clicks: 90, ctr: 0.01, costPerClick: 10, metaConversations: 9, newContacts: 3, returning: 0, chats: 3, converted: 1, costPerChat: 300, costPerConverted: 900, costPerMetaConversation: 100 };
  const report = { range: { from: NOW, days: 30, startDay: '2026-11-01' }, currency: 'INR', alertWindowDays: 3, alerts: [],
    totals: { spend: 900, impressions: 9000, clicks: 90, metaConversations: 9, chats: 3, converted: 1, costPerChat: 300, costPerConverted: 900, ctr: 0.01, otherAdChats: 0 },
    campaigns: [{ campaignId: 'c1', campaignName: 'Diwali', ads: 1, activeAds: 1, adsets: 1, firstDate: '2026-11-01', lastDate: '2026-11-10', spend: 900, impressions: 9000, clicks: 90, ctr: 0.01, metaConversations: 9, chats: 3, converted: 1, costPerChat: 300, costPerConverted: 900 }], ads: [ad],
    adNumbers: { 901: { phone: '919000000100', viaPage: false, label: 'Main number', inCrm: true }, 902: { phone: '918977030642', viaPage: true, label: null, inCrm: false } } };
  let alerts = { maxCostPerChat: 200, maxCostPerConversion: null, windowDays: 3, autoPause: false };
  await page.route('**/api/ads?*', r => r.fulfill({ json: { adsEnabled: true, account: { connected: true, adAccountId: 'act_1', name: 'E2E Ads', currency: 'INR', lastSyncAt: NOW, alerts }, report } }));
  await page.route('**/api/ads/thumbnails?*', r => r.fulfill({ json: { success: true, thumbnails: {} } }));
  let acked = false;
  const issues = () => ({ unread: acked ? 0 : 2, issues: [
    { adId: '902', kind: 'review', adName: 'Weight loss kit', status: 'DISAPPROVED', reasons: ['Your ad promises unlikely results.'], since: NOW, acknowledged: acked, acknowledgedBy: acked ? ME.email : null },
    { adId: '903', kind: 'auto_paused', adName: 'Idli batter', status: 'PAUSED', reasons: ['Cost per chat INR 450 is over your limit of INR 200 (last 3 days, INR 900 spent, 2 chats).'], since: NOW, acknowledged: acked, acknowledgedBy: null },
  ] });
  await page.route('**/api/ads/issues', r => r.fulfill({ json: { success: true, ...issues() } }));
  await page.route('**/api/ads/issues/ack', r => { acked = true; return r.fulfill({ json: { success: true, ...issues() } }); });
  let copied = null;
  await page.route('**/api/ads/ads/*/copy', r => { copied = new URL(r.request().url()).pathname; return r.fulfill({ json: { success: true, copiedAdId: '990', message: 'Copied, switched off.' } }); });
  let savedAlerts = null;
  await page.route('**/api/ads/alerts', r => { savedAlerts = r.request().postDataJSON(); alerts = { ...alerts, ...savedAlerts }; return r.fulfill({ json: { success: true, alerts } }); });
  await page.route('**/api/ads/create/readiness', r => r.fulfill({ json: { success: true, ready: true, currency: 'INR', minDailyBudget: 96, maxDailyBudget: 2000, businessNumber: '919000000100', pages: [{ id: '55555', name: 'Shop Page' }], selectedPageId: '55555',
    instagram: { id: '17841400000000001', username: 'e2ekitchen' }, numbers: [], statusAllowed: true,
    checks: ['account', 'permissions', 'page', 'whatsapp', 'budget'].map(key => ({ key, ok: true, label: key, detail: 'ok' })) } }));
  await page.route('**/api/ads/launches', r => r.fulfill({ json: { success: true, launches: [{ id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', name: 'Eye camp', status: 'launched', daily_budget: 400, currency: 'INR', created_by: ME.email, created_at: NOW,
    spec: { imageUrl: '', text: 'Free eye camp' },
    template: { name: 'Eye camp (copy)', text: 'Free eye camp this weekend.', headline: 'Book now', greeting: 'Hi!', imageHash: 'abcdef0123456789abcdef0123456789', imageUrl: '', cards: [], locations: [{ key: '1035921', type: 'city', name: 'Hyderabad' }], ageMin: 25, ageMax: 60, gender: 'all', placement: 'feeds_stories', number: '', useInstagram: true, dailyBudget: 400 } }] } }));

  await page.goto('/app');
  // F1: the Ads menu shows how many problems are new.
  await expect(page.getByTestId('ads-badge')).toHaveText('2', { timeout: 20000 });
  await page.getByRole('navigation', { name: 'Main menu' }).getByRole('link', { name: /Ads/ }).click();
  const box = page.getByTestId('ads-attention');
  // Collapsed at first: a one-line summary; "Show all" opens the list (remembered in this browser).
  await expect(box).toContainText('Needs attention (2)');
  await expect(box).toContainText('1 rejected · 1 paused automatically');
  await expect(box.getByTestId('ads-issue')).toHaveCount(0);
  await expect(box.getByTestId('ads-attention-toggle')).toHaveAttribute('aria-expanded', 'false');
  await box.getByRole('button', { name: 'Show all' }).click();
  await expect(box.getByTestId('ads-issue')).toHaveCount(2);
  // The number each ad opens: a number not connected to this CRM is flagged.
  await expect(box.getByTestId('ads-issue').first().getByTestId('ad-number')).toContainText('+91 89770 30642');
  await expect(box.getByTestId('ads-issue').first().getByTestId('ad-number')).toContainText('not connected to this CRM');
  await expect(box).toContainText('Rejected by Meta');
  await expect(box).toContainText('Your ad promises unlikely results.');
  await expect(box).toContainText('Paused automatically');
  await expect(box.getByRole('link', { name: /Open in Ads Manager/ }).first()).toHaveAttribute('href', /adsmanager\.facebook\.com/);
  await page.screenshot({ path: 'test-results/ads-needs-attention.png' });
  await box.getByRole('button', { name: 'Got it' }).click();
  await expect(page.getByTestId('ads-badge')).toHaveCount(0);
  await expect(box.getByRole('button', { name: 'Got it' })).toHaveCount(0);

  // F3: auto-pause in the cost alerts.
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByTestId('auto-pause').getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Save alerts' }).click();
  await expect.poll(() => savedAlerts?.autoPause).toBe(true);

  // F4: duplicate an ad (asks first).
  await page.getByRole('tab', { name: /^Ads/ }).click();
  // Each ad card shows the WhatsApp number it opens (this one is the business's own).
  await expect(page.locator('li').getByTestId('ad-number').filter({ hasText: '+91 90000 00100' }).first()).toContainText('Main number');
  await page.screenshot({ path: 'test-results/ads-card-number.png' });
  await page.getByRole('button', { name: 'Duplicate' }).click();
  await page.getByTestId('confirm-ok').click(); // in-app "Are you sure?" (src/confirm.tsx)
  await expect.poll(() => copied).toBe('/api/ads/ads/901/copy');

  // F2 + F4: the Create tab shows the Instagram account; "Use as a start" opens the wizard filled in.
  await page.getByRole('tab', { name: 'Create WhatsApp ads' }).click();
  await expect(page.getByTestId('ad-instagram')).toContainText('@e2ekitchen');
  await page.getByRole('button', { name: 'Use as a start' }).click();
  const wiz = page.getByRole('dialog', { name: 'Create a WhatsApp ad' });
  await expect(wiz.getByPlaceholder('e.g. Eye camp – November')).toHaveValue('Eye camp (copy)');
  await expect(wiz.getByPlaceholder(/Free eye check-up camp/)).toHaveValue('Free eye camp this weekend.');
  await expect(wiz.getByTestId('ad-use-instagram')).toContainText('@e2ekitchen');
  await expect(wiz.getByTestId('ad-use-instagram').getByRole('checkbox')).toBeChecked();
  await wiz.getByRole('button', { name: 'Next' }).click();
  await expect(wiz.getByRole('radio', { name: /^Facebook \+ Instagram: feeds, Stories, Reels/ })).toBeChecked();
  await expect(wiz.getByText('Hyderabad')).toBeVisible();
  expect(errors).toEqual([]);
});

test.describe('WhatsApp voice call (fake microphone)', () => {
  test.use({ permissions: ['microphone'] }); // fake microphone: playwright.config.js launch args

  test('an incoming WhatsApp call rings, Accept answers it with WebRTC and the audio connects', async ({ page }) => {
    const errors = watchErrors(page);
    await fakeBackend(page);
    const CALL = 'wacid.E2E_CALL_1';
    let offer = '';
    let answer = '';
    let hungUp = false;
    await page.route('**/api/wa-calls/ringing', r => r.fulfill({ json: { calls: [{ callId: CALL, phone: '919381619750', name: 'Lakshmi', since: new Date().toISOString() }] } }));
    await page.route('**/api/wa-calls/claim', r => r.fulfill({ json: { success: true, callId: CALL, phone: '919381619750', name: 'Lakshmi', offer } }));
    let accepted = false;
    await page.route('**/api/wa-calls/accept', r => { answer = r.request().postDataJSON().sdp; return r.fulfill({ json: { success: true, preAccepted: true } }); });
    await page.route('**/api/wa-calls/connect', r => { accepted = true; return r.fulfill({ json: { success: true, connected: true } }); });
    await page.route('**/api/wa-calls/hangup', r => { hungUp = true; return r.fulfill({ json: { success: true, ended: true } }); });
    // Recording: upload links point at a fake storage address on this site; record what arrives.
    const uploads = [];
    let completed = null;
    await page.route('**/api/wa-calls/recording/upload-url', r => {
      const b = r.request().postDataJSON();
      return r.fulfill({ json: { success: true, url: `${new URL(r.request().url()).origin}/fake-storage/${b.final ? 'final' : `part-${b.part}`}`, contentType: 'audio/webm' } });
    });
    await page.route('**/fake-storage/**', async r => { uploads.push({ name: r.request().url().split('/').pop(), bytes: (r.request().postDataBuffer() || Buffer.alloc(0)).length, method: r.request().method() }); return r.fulfill({ status: 200, json: {} }); });
    await page.route('**/api/wa-calls/recording/complete', r => { completed = r.request().postDataJSON(); return r.fulfill({ json: { success: true, ready: true } }); });

    await page.goto('/app');
    const card = page.getByRole('alertdialog', { name: 'Incoming WhatsApp call from Lakshmi' });
    await expect(card).toBeVisible({ timeout: 20000 });

    // "Meta": a second peer in the page makes the offer, like Meta's in the "connect" webhook.
    offer = await page.evaluate(async () => {
      const pc = new RTCPeerConnection();
      window.__meta = pc;
      const tone = new AudioContext().createMediaStreamDestination();
      pc.addTrack(tone.stream.getAudioTracks()[0], tone.stream);
      await pc.setLocalDescription(await pc.createOffer());
      await new Promise(r => { if (pc.iceGatheringState === 'complete') r(); pc.onicegatheringstatechange = () => pc.iceGatheringState === 'complete' && r(); setTimeout(r, 2000); });
      return pc.localDescription.sdp;
    });
    await page.screenshot({ path: 'test-results/wa-call-ringing.png' });

    await card.getByRole('button', { name: 'Accept' }).click();
    const live = page.getByRole('dialog', { name: 'WhatsApp call' });
    // pre_accept first: the panel shows "Connecting…" and has not accepted yet.
    await expect.poll(() => answer, { timeout: 15000 }).toMatch(/^v=0/);
    expect(answer).toMatch(/a=candidate:/); // the answer carries this browser's network candidates
    await expect(live.getByText('Connecting…')).toBeVisible();
    expect(accepted).toBe(false);

    // Meta's side takes the answer: the two peers really connect, then the panel accepts.
    const state = await page.evaluate(async (sdp) => {
      const pc = window.__meta;
      await pc.setRemoteDescription({ type: 'answer', sdp });
      for (let i = 0; i < 50 && pc.connectionState !== 'connected'; i++) await new Promise(r => setTimeout(r, 200));
      return pc.connectionState;
    }, answer);
    expect(state).toBe('connected');
    await expect(live.getByText('WhatsApp call', { exact: true })).toBeVisible({ timeout: 15000 });
    expect(accepted).toBe(true);
    await expect(live.getByRole('button', { name: 'Mute' })).toBeEnabled();
    await expect(live.getByText('REC', { exact: true })).toBeVisible(); // the call is being recorded
    await page.waitForTimeout(1500); // a little audio to record
    await page.screenshot({ path: 'test-results/wa-call-live.png' });

    await live.getByRole('button', { name: 'Hang up' }).click();
    await expect(live).toHaveCount(0);
    await expect.poll(() => hungUp).toBe(true); // the panel closes first, then tells the server
    // The recording goes up: the last piece, then the whole file, then "complete".
    await expect.poll(() => completed?.callId, { timeout: 15000 }).toBe(CALL);
    const final = uploads.find(u => u.name === 'final');
    expect(final.method).toBe('PUT');
    expect(final.bytes).toBeGreaterThan(500); // real audio, not an empty file
    expect(uploads.some(u => u.name.startsWith('part-'))).toBe(true);
    expect(completed.seconds).toBeGreaterThanOrEqual(1);
    await expect(page.getByText('Call recording saved to the chat')).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test('a background refresh never wipes what someone is typing (AI knowledge box)', async ({ page }) => {
  await page.clock.install();
  const hits = await fakeBackend(page);
  await page.goto('/app');
  await openScreen(page, 'AI assistant', { timeout: 20000 });
  const box = page.locator('textarea').first();
  await expect(box).toBeVisible({ timeout: 15000 });
  await box.fill('Delivery in Hyderabad only, 9am to 8pm.');
  const before = hits['/api/ai/settings'];

  // Let the cached settings go stale, then leave and come back to the tab: the cache refreshes.
  await page.clock.runFor(20000);
  for (const state of ['hidden', 'visible']) {
    await page.evaluate((s) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => s === 'hidden' });
      document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    }, state);
  }
  await page.clock.runFor(1000);
  await expect.poll(() => hits['/api/ai/settings']).toBeGreaterThan(before);
  await expect(box).toHaveValue('Delivery in Hyderabad only, 9am to 8pm.');
});

test('screens share cached data: the team list is fetched once for Inbox, Pipeline and Team', async ({ page }) => {
  const hits = await fakeBackend(page);
  await page.goto('/admin/inbox');
  await expect(page.locator('[data-testid="chat-row"]')).toHaveCount(1, { timeout: 20000 });
  await page.getByRole('link', { name: 'Pipeline', exact: true }).click();
  await expect(page.getByText('Customer pipeline')).toBeVisible();
  await openScreen(page, 'Team');
  await expect(page.getByText('agent@e2e.test').first()).toBeVisible();
  expect(hits['/api/team']).toBe(1);
});

// ---- Platform console (a platform admin: counts and settings only, never chats) ----
const ADMIN = { id: 'e2e00000-0000-4000-8000-0000000000aa', email: 'admin@e2e.test' };
const PLAN = { id: 'growth', name: 'Growth', price_monthly_inr: 2999, max_staff: 5, max_contacts: 10000, max_broadcasts_month: 5000, max_automations: 10, max_ai_replies_month: 2000, max_keyword_rules: 50, analytics_days: 90, ai_enabled: true, ads_enabled: true };
const P_BIZ = { id: BIZ, name: 'E2E Test Kitchen', slug: 'e2e-kitchen', status: 'active', plan_id: 'growth', paid_until: null, created_at: NOW };
const PLATFORM_ANSWERS = {
  '/api/platform/me': { email: ADMIN.email, role: 'owner' },
  '/api/platform/overview': {
    plans: [PLAN],
    businesses: [{ ...P_BIZ, limit_overrides: {}, whatsapp: { connected: true, source: 'saved', phoneNumber: '919000000100' }, counts: { staff: 2, contacts: 120, messagesThisMonth: 340 }, limits: PLAN, billing: { state: 'ok' }, usage: { broadcastsSent: 50, aiReplies: 12, period: '2026-11' } }],
  },
  '/api/platform/health': {
    health: {
      checkedAt: NOW,
      api: { ok: true, node: 'v22', uptimeSec: 600, memoryMb: 80, missingConfig: [], encryptionReady: true, unsignedWebhooksAllowed: false },
      database: { ok: true, latencyMs: 40 },
      worker: { last: { id: 1, started_at: NOW, duration_ms: 900, ok: true, error_count: 0 }, minutesAgo: 1, runsLastHour: 12, runsLastDay: 288, failedLastDay: 0, avgDurationMs: 900, maxDurationMs: 2000, stale: false },
      events24h: { byLevel: { critical: 0, error: 1, warn: 2, info: 0 }, bySource: {}, tableMissing: false },
      businesses: [{ ...P_BIZ, whatsapp: { connected: true, source: 'saved', tokenReadable: true, hasAppSecret: true, qualityRating: 'GREEN', messagingTier: 'TIER_1K', checkedAt: NOW, checkError: null, tokenErrors24h: 0, sendErrors24h: 0 }, webhook: { lastReceivedAt: NOW, lastSignatureFailAt: null, signatureFailsLastHour: 0 }, ads: { connected: false }, ai: { configured: true, provider: 'anthropic', model: 'claude-opus-5-5', keyReadable: true, errors24h: 0 }, events24h: { total: 1, errors: 1, lastErrorAt: NOW } }],
    },
    alerts: [{ level: 'warn', code: 'ai_errors', message: '5 AI provider errors in 24 hours.', businessId: BIZ, businessName: 'E2E Test Kitchen' }],
  },
  '/api/platform/events': { events: [{ id: 7, created_at: NOW, level: 'error', source: 'meta', business_id: BIZ, code: 'send_131047', message: 'Re-engagement message', count: 2, details: {} }], nextBeforeId: null },
  '/api/platform/worker-runs': { runs: [{ id: 1, started_at: NOW, duration_ms: 900, ok: true, error_count: 0, steps: { automations: { result: { sent: 3 }, ms: 400 } } }], status: { last: null, minutesAgo: 1, runsLastHour: 12, runsLastDay: 288, failedLastDay: 0, avgDurationMs: 900, stale: false } },
  '/api/platform/delivery': { days: 7, businesses: [{ id: BIZ, name: 'E2E Test Kitchen', status: 'active', outbound: 400, failedMessages: 4, failureRate: 1, campaignSent: 50, campaignFailed: 0, campaignSkipped: 1, optedOutTotal: 3, optOutsInPeriod: 1, metaSendErrors: 2 }] },
  '/api/platform/audit': { entries: [{ id: 3, created_at: NOW, business_id: BIZ, actor_email: ADMIN.email, actor_role: 'platform_admin', action: 'business.updated', details: { plan_id: 'growth' } }], nextBeforeId: null },
  '/api/platform/support': { queries: [{ id: 'f0000000-0000-4000-8000-000000000001', ref: 'P-1001', business_id: BIZ, businessName: 'E2E Test Kitchen', stage: 'new', priority: 'normal', subject: 'WhatsApp number not receiving', category: 'WhatsApp connection', raised_by_email: ME.email, raised_by_role: 'owner', created_at: NOW, overdue: false }] },
  '/api/platform/support-assignees': { assignees: [{ email: ADMIN.email, role: 'owner' }, { email: 'manager@e2e.test', role: 'manager' }] },
  '/api/platform/onboarding': { days: 90, businesses: [{ id: BIZ, name: 'E2E Test Kitchen', slug: 'e2e-kitchen', status: 'active', plan_id: 'growth', created_at: NOW, ownerEmail: 'owner@e2e.test', doneCount: 1, total: 4, steps: [{ id: 'whatsapp', label: 'Connect your WhatsApp number', done: true }, { id: 'bot', label: 'Set up your bot', done: false }, { id: 'team', label: 'Invite your team', done: false }, { id: 'templates', label: 'Create a template', done: null }, { id: 'ai', label: 'AI', done: false }] }] },
  '/api/platform/team': { members: [{ user_id: ADMIN.id, email: ADMIN.email, role: 'owner', created_at: NOW }, { user_id: 'e2e00000-0000-4000-8000-0000000000bb', email: 'dev@e2e.test', role: 'developer', added_by: ADMIN.email, created_at: NOW }] },
  [`/api/platform/businesses/${BIZ}`]: {
    business: { ...P_BIZ, industry: 'food', limit_overrides: { max_staff: 8 }, created_by: ADMIN.email },
    usage: { planId: 'growth', planName: 'Growth', period: '2026-11', billing: { state: 'ok' }, metrics: [{ key: 'staff', label: 'Team members', used: 2, limit: 8 }] },
    whatsapp: { connected: true, source: 'saved', phoneNumber: '919000000100', tokenLast4: '1234', tokenReadable: true, hasAppSecret: true, connectedAt: NOW, qualityRating: 'GREEN', messagingTier: 'TIER_1K', checkedAt: NOW, sendErrors24h: 0 },
    webhook: { lastReceivedAt: NOW, lastSignatureFailAt: null, signatureFailsLastHour: 0 },
    ads: { connected: false }, ai: { configured: false }, staff: { owner: 1, manager: 0, agent: 1 },
    delivery: null, recentEvents: [], recentAudit: [], alerts: [],
  },
};

test('maintenance: staff see the maintenance screen, and the dashboard comes back when it ends', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page);
  const until = new Date(Date.now() + 3600000).toISOString();
  let on = true;
  await page.route('**/api/status', r => (on
    ? r.fulfill({ status: 503, json: { maintenance: true, error: 'Upgrading the platform. Back in 30 minutes.', until } })
    : r.fallback()));
  await page.route('**/api/maintenance', r => r.fulfill({ json: on ? { on: true, message: 'Upgrading the platform. Back in 30 minutes.', until } : { on: false, message: null, until: null } }));

  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Under maintenance' })).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('Upgrading the platform. Back in 30 minutes.')).toBeVisible();
  await expect(page.getByText(/Expected back by/)).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main menu' })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/maintenance-staff.png' });

  on = false; // the Platform Admin switches it off
  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(page.getByRole('navigation', { name: 'Main menu' }).getByRole('link', { name: 'Inbox' })).toBeVisible({ timeout: 20000 });
  expect(errors.filter(e => !/503/.test(e))).toEqual([]);
});

test('maintenance: the Platform Admin switches it on and off in the console', async ({ page }) => {
  await enforceCsp(page);
  await page.addInitScript(([key, user]) => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem(key, JSON.stringify({
      access_token: 'e2e-fake-token', token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'e2e-refresh',
      user: { id: user.id, email: user.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} },
    }));
  }, [STORAGE_KEY, ADMIN]);
  await page.route('**/rest/v1/staff_members*', r => r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }));
  await page.route('**/rest/v1/platform_admins*', r => r.fulfill({ json: { user_id: ADMIN.id } }));
  await page.route('**/rest/v1/clinic_doctors*', r => r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }));
  await page.route('**/auth/v1/**', r => r.fulfill({ json: {} }));
  let state = { on: false, message: null, until: null, startedAt: null };
  const sent = [];
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/platform/maintenance') {
      if (route.request().method() === 'PUT') {
        const b = route.request().postDataJSON();
        sent.push(b);
        state = { on: b.on, message: b.message, until: b.until, startedAt: b.on ? new Date().toISOString() : null, updatedBy: 'platform@crm.test' };
      }
      return route.fulfill({ json: { success: true, maintenance: state } });
    }
    if (route.request().method() !== 'GET') return route.fulfill({ json: { success: true } });
    const body = PLATFORM_ANSWERS[path];
    return route.fulfill(body ? { json: body } : { status: 404, json: { error: `no mock for ${path}` } });
  });
  await page.goto('/app');
  await page.getByRole('navigation', { name: 'Console menu' }).getByRole('link', { name: 'Maintenance', exact: true }).click({ timeout: 20000 });
  await expect(page.getByText('Normal', { exact: true })).toBeVisible();
  await page.getByPlaceholder(/upgrading the platform/i).fill('Database upgrade tonight.');
  await page.getByRole('button', { name: 'Switch maintenance on' }).click();
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByText('Under maintenance', { exact: true })).toBeVisible();
  expect(sent[0]).toMatchObject({ on: true, message: 'Database upgrade tonight.' });
  await page.screenshot({ path: 'test-results/maintenance-console.png' });

  // Other tabs show the reminder strip.
  await page.getByRole('navigation', { name: 'Console menu' }).getByRole('link', { name: 'Plans', exact: true }).click();
  const strip = page.getByRole('button', { name: /Maintenance mode is ON.*Manage/ });
  await expect(strip).toBeVisible();

  await strip.click();
  await page.getByRole('button', { name: 'Switch maintenance off' }).click();
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByText('Normal', { exact: true })).toBeVisible();
  expect(sent[1]).toMatchObject({ on: false });
});

test('platform console Branding: fill in the app details (problems shown per field), upload a logo, the draft list updates', async ({ page }) => {
  const errors = watchErrors(page);
  await enforceCsp(page);
  await page.addInitScript(([key, user]) => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem(key, JSON.stringify({ access_token: 'e2e-fake-token', token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'e2e-refresh', user: { id: user.id, email: user.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} } }));
  }, [STORAGE_KEY, ADMIN]);
  await page.route('**/rest/v1/staff_members*', r => r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }));
  await page.route('**/rest/v1/platform_admins*', r => r.fulfill({ json: { user_id: ADMIN.id } }));
  await page.route('**/rest/v1/clinic_doctors*', r => r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }));
  await page.route('**/auth/v1/**', r => r.fulfill({ json: {} }));
  // A tiny real PNG (1x1), so the preview image loads.
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  let saved = { branding: { brandName: 'ChatDesk' }, logoUrl: null, updatedBy: null, updatedAt: null };
  const sent = [];
  await page.route('**/api/**', route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path === '/api/platform/branding' && req.method() === 'PUT') {
      const body = req.postDataJSON();
      sent.push(body);
      if (!/@/.test(body.supportEmail || '@')) return route.fulfill({ status: 400, json: { success: false, error: 'Please fix the highlighted fields.', errors: { supportEmail: 'Enter a valid email address.' } } });
      saved = { ...saved, branding: Object.fromEntries(Object.entries(body).filter(([, v]) => v)), updatedBy: ADMIN.email, updatedAt: new Date().toISOString() };
      return route.fulfill({ json: { success: true, ...saved } });
    }
    if (path === '/api/platform/branding/logo' && req.method() === 'POST') {
      sent.push({ logo: req.postDataJSON().dataUrl.slice(0, 22) });
      saved = { ...saved, logoUrl: '/api/public/logo?v=abcdef123456' };
      return route.fulfill({ json: { success: true, ...saved } });
    }
    if (path === '/api/platform/branding') return route.fulfill({ json: { success: true, ...saved } });
    if (path === '/api/public/logo') return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (path === '/api/public/branding') return route.fulfill({ json: { branding: { ...saved.branding, logoUrl: saved.logoUrl } } });
    if (req.method() !== 'GET') return route.fulfill({ json: { success: true } });
    const body = PLATFORM_ANSWERS[path];
    return route.fulfill(body ? { json: body } : { status: 404, json: { error: `no mock for ${path}` } });
  });

  await page.goto('/platform/branding');
  const tab = page.getByTestId('platform-branding');
  await expect(tab).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('branding-missing')).toContainText('Registered company name');
  await expect(page.locator('#brand-brandName')).toHaveValue('ChatDesk');

  // A wrong email: the server's message shows next to that box.
  await page.locator('#brand-supportEmail').fill('help-at-chatdesk');
  await page.getByRole('button', { name: 'Save branding' }).click();
  await expect(page.locator('#brand-supportEmail')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#brand-supportEmail-msg')).toHaveText('Enter a valid email address.');
  await expect(page.locator('#brand-supportEmail')).toBeFocused();

  // Everything the policies need.
  const fill = { supportEmail: 'help@chatdesk.in', companyName: 'ChatDesk Technologies Private Limited', companyAddress: 'Plot 1, Madhapur, Hyderabad 500081', privacyEmail: 'privacy@chatdesk.in', phone: '+91 98765 43210', grievanceOfficerName: 'Priya Sharma', grievanceOfficerEmail: 'grievance@chatdesk.in', jurisdictionCity: 'Hyderabad' };
  for (const [k, v] of Object.entries(fill)) await page.locator(`#brand-${k}`).fill(v);
  await page.getByRole('button', { name: 'Save branding' }).click();
  await expect(page.getByText('Everything the policies need is filled in.')).toBeVisible();
  await expect(page.getByText(/Last changed by admin@e2e.test/)).toBeVisible();
  expect(sent.at(-1)).toMatchObject({ ...fill, brandName: 'ChatDesk', cin: '', gstin: '' });

  // Logo: picked, sent as an image, previewed.
  await page.getByTestId('branding-logo-input').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByTestId('branding-logo-preview')).toBeVisible();
  expect(sent.at(-1)).toEqual({ logo: 'data:image/png;base64,' });
  await page.screenshot({ path: 'test-results/platform-branding.png', fullPage: true });
  expect(errors.filter(e => !/400/.test(e))).toEqual([]);
});

test('platform console (fake backend): every tab and a business drawer render', async ({ page }) => {
  const errors = watchErrors(page);
  await enforceCsp(page);
  await page.addInitScript(([key, user]) => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem(key, JSON.stringify({
      access_token: 'e2e-fake-token', token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'e2e-refresh',
      user: { id: user.id, email: user.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} },
    }));
  }, [STORAGE_KEY, ADMIN]);
  // A platform admin: no staff row, but a platform_admins row.
  await page.route('**/rest/v1/staff_members*', r => r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }));
  await page.route('**/rest/v1/platform_admins*', r => r.fulfill({ json: { user_id: ADMIN.id } }));
  await page.route('**/rest/v1/clinic_doctors*', r => r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }));
  await page.route('**/auth/v1/**', r => r.fulfill({ json: {} }));
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET') return route.fulfill({ json: { success: true } });
    const body = PLATFORM_ANSWERS[path];
    return route.fulfill(body ? { json: body } : { status: 404, json: { error: `no mock for ${path}` } });
  });

  await page.goto('/app');
  await expect(page.getByText('Platform console')).toBeVisible({ timeout: 20000 });
  // The Platform Admin's area: /platform, Health first.
  await expect(page).toHaveURL(/\/platform\/health$/);
  await expect(page.getByText('5 AI provider errors in 24 hours.').first()).toBeVisible();
  await expect(page.getByText('GREEN').first()).toBeVisible();

  const checks = [
    ['Businesses', 'Messages (month)'],
    ['Plans', 'Analytics history (days)'],
    ['Logs', 'Re-engagement message'],
    ['Worker', 'automations: sent 3'],
    ['Delivery', 'Delivery and failures'],
    ['Audit', 'business.updated'],
    ['Support', 'WhatsApp number not receiving'],
  ];
  const consoleMenu = page.getByRole('navigation', { name: 'Console menu' });
  for (const [tab, expected] of checks) {
    await consoleMenu.getByRole('link', { name: tab, exact: true }).click();
    await expect(page.getByText(expected).first(), `${tab} shows "${expected}"`).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Something went wrong/)).toHaveCount(0);
  }
  // Each tab has its address: a refresh stays on it; business areas are not the Platform Admin's.
  await expect(page).toHaveURL(/\/platform\/support$/);
  await page.reload();
  await expect(consoleMenu.getByRole('link', { name: 'Support', exact: true })).toHaveAttribute('aria-current', 'page', { timeout: 20000 });
  await page.goto('/admin/inbox');
  await expect(page.getByTestId('area-not-allowed')).toBeVisible({ timeout: 20000 });
  await page.goto('/platform/businesses');

  // One business's drawer (usage, overrides, connections).
  await expect(consoleMenu.getByRole('link', { name: 'Businesses', exact: true })).toHaveAttribute('aria-current', 'page', { timeout: 20000 });
  await page.getByRole('button', { name: /Details/ }).first().click();
  await expect(page.getByText('Limit overrides for this business')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('input[value="8"]')).toBeVisible();
  await expect(page.getByText(/Something went wrong/)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Netlify credits: the inbox refreshes every 15s while visible, and never while the tab is hidden', async ({ page }) => {
  await page.clock.install();
  const hits = await fakeBackend(page);
  await page.goto('/admin/inbox');
  await expect(page.locator('[data-testid="chat-row"]')).toHaveCount(1, { timeout: 20000 });
  const start = hits['/api/inbox'];

  await page.clock.runFor(16000);
  await expect.poll(() => hits['/api/inbox']).toBeGreaterThan(start);
  const visibleCount = hits['/api/inbox'];

  // Hide the tab, then let ten minutes pass.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true })); // real ones bubble to window
  });
  await page.clock.runFor(10 * 60 * 1000);
  expect(hits['/api/inbox']).toBe(visibleCount);

  // Coming back refreshes once.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
  });
  await page.clock.runFor(1000); // the page's timers are fake: let the cache's scheduled work run
  await expect.poll(() => hits['/api/inbox']).toBeGreaterThan(visibleCount);
});

test('U2 Home "My work": waiting chats and queries open the right place; Q-number search; Inbox keys; phone pipeline', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page, { role: 'agent' });
  await page.route('**/api/ai/settings', r => r.fulfill({ json: { settings: { auto_reply: false }, status: { configured: false }, role: 'agent' } }));
  const due = new Date(Date.now() - 2 * 3600000).toISOString();
  const QUERY = { id: 'f0000000-0000-4000-8000-000000000001', ref: 'Q-1042', number: 1042, kind: 'customer', subject: 'Report not received', priority: 'high', stage: 'in_progress', due_at: due, overdue: true, contact_phone: LEAD.phone, assigned_to: 'owner@e2e.test', created_at: NOW, business_id: BIZ };
  await page.route('**/api/home', r => r.fulfill({ json: {
    myChats: [{ ...LEAD, assigned_to: ME.email, unread_count: 2 }], newChats: [], myQueries: [QUERY], newQueries: [], waitingOnMe: [],
    today: { repliesSent: 7, myOpenChats: 3, overdueQueries: 1 },
  } }));
  await page.route('**/api/queries/by-number/1042', r => r.fulfill({ json: { success: true, query: { id: QUERY.id, ref: 'Q-1042', subject: QUERY.subject, kind: 'customer' } } }));
  await page.route(`**/api/queries/${QUERY.id}`, r => r.fulfill({ json: { success: true, query: QUERY, events: [], access: 'handler', canWork: true } }));

  // Lands on Home: today's numbers and the lists.
  await page.goto('/app');
  await expect(page).toHaveURL(/\/agent\/home$/, { timeout: 20000 });
  await expect(page.getByTestId('home-my-chats')).toContainText('Ravi Kumar');
  await expect(page.getByText('Replies sent today')).toBeVisible();
  await expect(page.getByTestId('home-my-queries')).toContainText('Q-1042');
  await expect(page.getByTestId('home-my-queries')).toContainText('overdue');
  await page.screenshot({ path: 'test-results/home-agent.png', fullPage: true });

  // A query row opens its detail on the Queries page, with the one-tap stage buttons.
  await page.getByTestId('home-query-row').first().click();
  await expect(page).toHaveURL(/\/agent\/queries$/);
  const stages = page.getByTestId('quick-stages');
  await expect(stages.getByRole('button')).toHaveText(['Waiting for reply', 'Mark resolved']);
  await page.screenshot({ path: 'test-results/query-quick-stages.png' });
  const moved = page.waitForRequest(r => r.url().endsWith(`/api/queries/${QUERY.id}`) && r.method() === 'PATCH');
  await stages.getByRole('button', { name: 'Mark resolved' }).click();
  expect((await moved).postDataJSON()).toEqual({ stage: 'resolved' });
  await page.keyboard.press('Escape');

  // A waiting chat opens in the Inbox.
  await page.getByRole('navigation', { name: 'Main menu' }).getByRole('link', { name: 'Home' }).click();
  await page.getByTestId('home-chat-row').first().click();
  await expect(page).toHaveURL(/\/agent\/inbox$/);
  await expect(page.getByTestId('chat-header')).toContainText(LEAD.phone, { timeout: 15000 });

  // Inbox keys: Esc back to the list, J opens the first chat, / goes to the search box.
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.keyboard.press('Escape');
  await page.keyboard.press('j');
  await expect(page.getByTestId('chat-header')).toContainText(LEAD.phone);
  await page.keyboard.press('/');
  await expect(page.getByLabel('Search chats')).toBeFocused();

  // Search: "Q-1042" finds the query and opens it.
  await page.keyboard.press('Escape');
  await page.getByTestId('search-button').click();
  await page.getByRole('dialog', { name: 'Search' }).getByRole('textbox').fill('Q-1042');
  await page.getByRole('dialog', { name: 'Search' }).getByText('Q-1042 · Report not received').click();
  await expect(page).toHaveURL(/\/agent\/queries$/);
  await expect(page.getByTestId('quick-stages')).toBeVisible();
  await page.keyboard.press('Escape');

  // Phone: the pipeline shows one stage at a time.
  await page.setViewportSize({ width: 390, height: 800 });
  await page.getByRole('navigation', { name: 'Main menu' }).getByRole('link', { name: 'Pipeline' }).click();
  const chips = page.getByTestId('stage-chips');
  await expect(chips.getByRole('button', { name: /New enquiry/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Ravi Kumar').first()).toBeVisible();
  await chips.getByRole('button', { name: /Booked/ }).click();
  await expect(page.locator('[data-stage="ordered"]').getByText('Nobody here')).toBeVisible();
  await expect(page.locator('[data-stage="new"]')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: 'test-results/pipeline-phone.png' });
  expect(errors).toEqual([]);
});

test('U3 managers: Team today (assign, who has what), Inbox by person + several chats at once, Analytics Today + CSV', async ({ page }) => {
  const errors = watchErrors(page);
  const hits = await fakeBackend(page);
  const AGENT = 'agent@e2e.test';
  const SECOND = { ...LEAD, phone: '919000000002', name: 'Lakshmi', assigned_to: AGENT };
  await page.route('**/api/home/team', r => r.fulfill({ json: {
    unassignedWaiting: 1, waitingTotal: 2, broadcastsSending: 0,
    longestWaiting: [LEAD, SECOND], overdueQueries: [],
    people: [
      { email: ME.email, role: 'owner', openChats: 0, waitingChats: 0, oldestWaitingSince: null, repliesToday: 4, openQueries: 0 },
      { email: AGENT, role: 'agent', openChats: 3, waitingChats: 1, oldestWaitingSince: NOW, repliesToday: 9, openQueries: 2 },
    ],
  } }));
  const patches = [];
  const closes = [];
  const inboxUrls = [];
  await page.route('**/api/inbox?*', r => { inboxUrls.push(r.request().url()); return r.fulfill({ json: { conversations: [LEAD, SECOND] } }); });
  await page.route('**/api/inbox/*', r => {
    const u = new URL(r.request().url());
    if (r.request().method() === 'PATCH') { patches.push([u.pathname.split('/').pop(), r.request().postDataJSON()]); return r.fulfill({ json: { success: true } }); }
    return r.fallback();
  });
  await page.route('**/api/inbox/*/close', r => { closes.push([r.request().url().split('/').at(-2), r.request().postDataJSON()]); return r.fulfill({ json: { success: true } }); });

  await page.goto('/admin/home');
  const team = page.getByTestId('team-today');
  await expect(team).toContainText('Team today', { timeout: 20000 });
  await expect(team.getByText('Chats waiting for a reply')).toBeVisible();
  await expect(page.getByTestId('team-people')).toContainText(AGENT);
  await page.screenshot({ path: 'test-results/home-manager.png', fullPage: true });

  // Hand the unassigned chat to the agent from Home.
  await page.getByRole('combobox', { name: 'Assign Ravi Kumar' }).selectOption(AGENT);
  await expect.poll(() => patches.at(-1)).toEqual([LEAD.phone, { assignedTo: AGENT }]);

  // "View chats" opens the Inbox with that person's chats.
  await page.getByTestId('team-people').getByRole('button', { name: 'View chats' }).click();
  await expect(page).toHaveURL(/\/admin\/inbox$/);
  await expect(page.getByTestId('assignee-filter')).toHaveValue(AGENT);
  await expect.poll(() => inboxUrls.some(u => u.includes(`assignee=${encodeURIComponent(AGENT)}`))).toBe(true);

  // Several chats at once: assign both, then mark them done (asks first).
  await page.getByTestId('assignee-filter').selectOption('');
  await page.getByTestId('select-chats').click();
  await page.getByTestId('chat-row').nth(0).click();
  await page.getByTestId('chat-row').nth(1).click();
  await expect(page.getByTestId('bulk-bar')).toContainText('2 selected');
  await page.screenshot({ path: 'test-results/inbox-bulk.png' });
  patches.length = 0;
  await page.getByRole('combobox', { name: 'Assign selected chats' }).selectOption(ME.email);
  await expect.poll(() => patches.length).toBe(2);
  expect(patches.map(p => p[1])).toEqual([{ assignedTo: ME.email }, { assignedTo: ME.email }]);
  await page.getByTestId('select-chats').click();
  await page.getByRole('button', { name: 'Select all' }).click();
  await page.getByRole('combobox', { name: 'Mark selected chats done' }).selectOption('resolved');
  await page.getByTestId('confirm-ok').click();
  await expect.poll(() => closes.length).toBe(2);
  expect(closes[0][1]).toEqual({ reason: 'resolved', note: '' });

  // Analytics: Today preset and a CSV download.
  await openScreen(page, 'Analytics');
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect.poll(() => Object.keys(hits).length).toBeGreaterThan(0);
  const download = page.waitForEvent('download');
  await page.getByTestId('analytics-csv').click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^analytics-(today|30-days)-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = await (await file.createReadStream()).toArray().then(chunks => Buffer.concat(chunks).toString('utf8'));
  expect(csv).toContain('New leads');
  expect(csv).toContain('Team member');
  await expect(page.getByText(/Plan who is on shift/)).toBeVisible();
  expect(errors).toEqual([]);
});

test('U4 Business Admin: guided setup and "Your business" on Home, plain settings names in groups, guide moves aside while a form is open', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page);
  await page.goto('/admin/home');

  // Guided setup until everything is done: the next step is highlighted and opens its page.
  const setup = page.getByTestId('setup-guide');
  await expect(setup).toContainText('1 of 2 done', { timeout: 20000 });
  await expect(setup.getByRole('button', { name: 'Start' })).toHaveCount(1);
  // "Your business": WhatsApp connection and plan usage.
  const biz = page.getByTestId('business-card');
  await expect(biz).toContainText('WhatsApp connected');
  await expect(biz).toContainText('Plan and usage');
  await page.screenshot({ path: 'test-results/home-admin.png', fullPage: true });
  await setup.getByRole('button', { name: 'Start' }).click();
  await expect(page).toHaveURL(/\/admin\/settings\/team$/);

  // Settings in two plain groups in the side menu.
  const menu = page.getByRole('navigation', { name: 'Main menu' });
  await expect(menu.getByText('Business settings')).toBeVisible();
  await expect(menu.getByText('Bot & AI')).toBeVisible();
  await menu.getByRole('link', { name: 'Auto-replies' }).click();
  await expect(page.getByRole('heading', { name: 'Auto-replies' })).toBeVisible();

  // Broadcasts: the full guide on the list; while making a campaign it becomes a button + side panel.
  await openScreen(page, 'Broadcasts');
  await expect(page.getByRole('button', { name: /How this works: Broadcast campaigns/ })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'New broadcast' }).click();
  await expect(page.getByRole('button', { name: /How this works: Broadcast campaigns/ })).toHaveCount(0);
  await page.getByTestId('guide-help-campaigns').click();
  const panel = page.getByRole('dialog', { name: /How this works: Broadcast campaigns/ });
  await expect(panel.getByTestId('guide-pictures-campaigns')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId('campaign-steps')).toBeVisible();
  expect(errors).toEqual([]);
});

test('U5 Platform console: grouped menu with badges, overview tiles, business search / filters, name opens the details', async ({ page }) => {
  await enforceCsp(page);
  await page.addInitScript(([key, user]) => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem(key, JSON.stringify({
      access_token: 'e2e-fake-token', token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'e2e-refresh',
      user: { id: user.id, email: user.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} },
    }));
  }, [STORAGE_KEY, ADMIN]);
  await page.route('**/rest/v1/staff_members*', r => r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }));
  await page.route('**/rest/v1/platform_admins*', r => r.fulfill({ json: { user_id: ADMIN.id } }));
  await page.route('**/rest/v1/clinic_doctors*', r => r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }));
  await page.route('**/auth/v1/**', r => r.fulfill({ json: {} }));
  // Two businesses: one fine, one paused with payment due and no WhatsApp yet.
  const second = { ...PLATFORM_ANSWERS['/api/platform/overview'].businesses[0], id: 'b0000000-0000-4000-8000-000000000002', name: 'Mayura Hospitals', slug: 'mayura', status: 'suspended', created_at: new Date(Date.now() - 86400000).toISOString(), whatsapp: { connected: false, source: 'none' }, billing: { state: 'due', suspendOn: '2026-11-20' }, counts: { staff: 1, contacts: 900, messagesThisMonth: 5 } };
  const answers = { ...PLATFORM_ANSWERS, '/api/platform/overview': { ...PLATFORM_ANSWERS['/api/platform/overview'], businesses: [...PLATFORM_ANSWERS['/api/platform/overview'].businesses, second] }, '/api/platform/signup-requests': { requests: [{ id: 1 }, { id: 2 }] } };
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET') return route.fulfill({ json: { success: true } });
    const body = answers[path];
    return route.fulfill(body ? { json: body } : { status: 404, json: { error: `no mock for ${path}` } });
  });

  await page.goto('/platform');
  const menu = page.getByRole('navigation', { name: 'Console menu' });
  await expect(menu.getByText('Customers')).toBeVisible({ timeout: 20000 });
  await expect(menu.getByText('System')).toBeVisible();
  await expect(page.getByTestId('console-badge-signups')).toHaveText('2');
  await expect(page.getByTestId('console-badge-support')).toHaveText('1');

  // Overview: counts; a tile opens Businesses already filtered.
  const ov = page.getByTestId('console-overview');
  await expect(ov.getByTestId('ov-active')).toContainText('1');
  await expect(ov.getByTestId('ov-no-wa')).toContainText('1');
  await expect(ov.getByTestId('ov-signups')).toContainText('2');
  await page.screenshot({ path: 'test-results/console-overview.png', fullPage: true });
  await ov.getByTestId('ov-due').click();
  await expect(page).toHaveURL(/\/platform\/businesses$/);
  await expect(page.getByRole('button', { name: 'Payment due', pressed: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mayura Hospitals' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'E2E Test Kitchen' })).toHaveCount(0);

  // Search and sort across all.
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.getByLabel('Search businesses').fill('kitch');
  await expect(page.getByRole('button', { name: 'E2E Test Kitchen' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mayura Hospitals' })).toHaveCount(0);
  await page.getByLabel('Search businesses').fill('');
  await page.getByRole('combobox').filter({ hasText: 'Newest first' }).selectOption('contacts');
  await expect(page.locator('[data-testid="business-filters"] + div button, [data-testid="business-filters"] ~ div .text-sm.font-bold button').first()).toHaveText('Mayura Hospitals');

  // The name opens the business details.
  await page.getByRole('button', { name: 'E2E Test Kitchen' }).click();
  await expect(page.getByText('Limit overrides for this business')).toBeVisible({ timeout: 15000 });
});

// ---- Platform roles: Platform Owner / Application Manager / Application Developer (docs/progress/platform-roles.md) ----
// Which /api/platform paths each role may call (mirrors server/platformRoutes.cjs); the fake server answers 403 otherwise.
const PLATFORM_ROLE_PATHS = {
  manager: /^\/api\/platform\/(me|overview|maintenance|signup-requests|support|support-assignees|onboarding|businesses)(\/|$)/,
  developer: /^\/api\/platform\/(me|overview|maintenance|health|events|worker-runs|delivery|businesses)(\/|$)/,
  owner: /^\/api\/platform\//,
};
async function platformAs(page, role) {
  await enforceCsp(page);
  await page.addInitScript(([key, user]) => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem(key, JSON.stringify({ access_token: 'e2e-fake-token', token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'e2e-refresh', user: { id: user.id, email: user.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} } }));
  }, [STORAGE_KEY, ADMIN]);
  await page.route('**/rest/v1/staff_members*', r => r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }));
  await page.route('**/rest/v1/platform_admins*', r => r.fulfill({ json: { user_id: ADMIN.id } }));
  await page.route('**/rest/v1/clinic_doctors*', r => r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }));
  await page.route('**/auth/v1/**', r => r.fulfill({ json: {} }));
  const seen = { forbidden: [], sent: [] };
  await page.route('**/api/**', route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path.startsWith('/api/platform/') && !PLATFORM_ROLE_PATHS[role].test(path)) {
      seen.forbidden.push(`${req.method()} ${path}`);
      return route.fulfill({ status: 403, json: { success: false, error: 'Your platform role can\'t do this.' } });
    }
    if (path === '/api/platform/me') return route.fulfill({ json: { email: ADMIN.email, role } });
    if (/^\/api\/platform\/support\/[^/]+$/.test(path)) {
      if (req.method() !== 'GET') seen.sent.push({ method: req.method(), path, body: req.postDataJSON() });
      return route.fulfill({ json: { success: true, query: PLATFORM_ANSWERS['/api/platform/support'].queries[0], events: [] } });
    }
    if (req.method() !== 'GET') { seen.sent.push({ method: req.method(), path, body: req.postDataJSON() }); return route.fulfill({ json: { success: true, member: { email: 'new@e2e.test' }, invited: true, email: 'owner@e2e.test', kind: 'invite' } }); }
    const body = PLATFORM_ANSWERS[path];
    return route.fulfill(body ? { json: body } : { status: 404, json: { error: `no mock for ${path}` } });
  });
  return seen;
}
const menuLinks = async (page) => (await page.getByRole('navigation', { name: 'Console menu' }).getByRole('link').allTextContents()).map(t => t.replace(/\d+$/, '').trim());

test('platform roles: an Application Manager sees sign-ups, businesses, onboarding and support only', async ({ page }) => {
  const errors = watchErrors(page);
  const seen = await platformAs(page, 'manager');
  await page.goto('/platform');
  await expect(page).toHaveURL(/\/platform\/overview$/, { timeout: 20000 });
  await expect(page.getByTestId('platform-role')).toContainText('Application Manager');
  await expect(page.getByTestId('console-overview')).toBeVisible();
  expect(await menuLinks(page)).toEqual(['Overview', 'Businesses', 'Onboarding', 'Sign-ups', 'Support']);

  // Businesses: read the plan, no plan / payment / suspend controls; may create (onboarding).
  await page.getByRole('navigation', { name: 'Console menu' }).getByRole('link', { name: 'Businesses', exact: true }).click();
  await expect(page.getByText('Plan: Growth')).toBeVisible();
  await expect(page.getByRole('button', { name: /Suspend/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /New business/ })).toBeVisible();
  // The drawer: no limit overrides, but "Resend owner invite".
  await page.getByRole('button', { name: /Details/ }).first().click();
  await expect(page.getByRole('button', { name: 'Resend owner invite' })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Limit overrides for this business')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.goto('/platform/onboarding');

  // Onboarding tracker: each step done or not; resend the invite.
  const row = page.getByTestId('onboarding-row').first();
  await expect(row).toContainText('1 of 4 done', { timeout: 20000 });
  await expect(row.getByTestId('step-whatsapp-done')).toBeVisible();
  await expect(row.getByTestId('step-bot-todo')).toBeVisible();
  await row.getByRole('button', { name: 'Resend invite' }).click();
  await expect(page.getByText('Invite sent again to owner@e2e.test.')).toBeVisible();
  expect(seen.sent.at(-1)).toMatchObject({ method: 'POST', path: `/api/platform/businesses/${BIZ}/resend-invite` });

  // Support: Mine / Unassigned.
  await page.getByRole('navigation', { name: 'Console menu' }).getByRole('link', { name: 'Support', exact: true }).click();
  await expect(page.getByText('WhatsApp number not receiving')).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Mine', exact: true }).click();
  await expect(page.getByText('WhatsApp number not receiving')).toHaveCount(0);
  await page.getByRole('button', { name: 'Unassigned', exact: true }).click();
  await expect(page.getByText('WhatsApp number not receiving')).toBeVisible();
  await page.getByText('WhatsApp number not receiving').click();
  await page.getByLabel('Assign to').selectOption('manager@e2e.test');
  await expect.poll(() => seen.sent.at(-1)?.body).toEqual({ assignedTo: 'manager@e2e.test' });
  await page.screenshot({ path: 'test-results/platform-role-manager.png', fullPage: true });

  // Owner-only addresses: "Not allowed", and nothing is fetched for them.
  for (const t of ['plans', 'branding', 'maintenance', 'audit', 'team', 'health', 'events']) {
    await page.goto(`/platform/${t}`);
    await expect(page.getByTestId('platform-tab-not-allowed'), t).toBeVisible({ timeout: 20000 });
  }
  expect(seen.forbidden).toEqual([]);
  expect(errors).toEqual([]);
});

test('platform roles: an Application Developer sees health, logs, worker, delivery and a read-only business list', async ({ page }) => {
  const errors = watchErrors(page);
  const seen = await platformAs(page, 'developer');
  await page.goto('/app');
  await expect(page).toHaveURL(/\/platform\/health$/, { timeout: 20000 });
  await expect(page.getByText('GREEN').first()).toBeVisible();
  await expect(page.getByTestId('console-overview')).toHaveCount(0);
  expect(await menuLinks(page)).toEqual(['Health', 'Businesses', 'Logs', 'Worker', 'Delivery']);

  await page.getByRole('navigation', { name: 'Console menu' }).getByRole('link', { name: 'Businesses', exact: true }).click();
  await expect(page.getByText('Plan: Growth')).toBeVisible();
  await expect(page.getByRole('button', { name: /New business/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Suspend/ })).toHaveCount(0);
  await page.getByRole('button', { name: /Details/ }).first().click();
  await expect(page.getByRole('button', { name: 'Check WhatsApp now' })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: 'Resend owner invite' })).toHaveCount(0);
  await expect(page.getByText('Limit overrides for this business')).toHaveCount(0);

  for (const t of ['signups', 'support', 'onboarding', 'plans', 'team', 'audit', 'overview']) {
    await page.goto(`/platform/${t}`);
    await expect(page.getByTestId('platform-tab-not-allowed'), t).toBeVisible({ timeout: 20000 });
  }
  expect(seen.forbidden).toEqual([]);
  expect(errors).toEqual([]);
});

test('platform roles: the Platform Owner sees every tab and manages the platform team', async ({ page }) => {
  const errors = watchErrors(page);
  const seen = await platformAs(page, 'owner');
  await page.goto('/platform');
  await expect(page).toHaveURL(/\/platform\/health$/, { timeout: 20000 });
  expect(await menuLinks(page)).toEqual(['Health', 'Businesses', 'Onboarding', 'Sign-ups', 'Plans', 'Support', 'Logs', 'Worker', 'Delivery', 'Audit', 'Maintenance', 'Branding', 'Platform team']);

  await page.getByRole('navigation', { name: 'Console menu' }).getByRole('link', { name: 'Platform team', exact: true }).click();
  const list = page.getByTestId('platform-team-list');
  await expect(list.getByTestId('platform-team-row')).toHaveCount(2, { timeout: 15000 });
  // Yourself: no remove button, role locked.
  await expect(page.getByLabel(`Role of ${ADMIN.email}`)).toBeDisabled();
  await expect(page.getByRole('button', { name: `Remove ${ADMIN.email}` })).toHaveCount(0);

  await page.getByPlaceholder('name@yourcompany.com').fill('support@e2e.test');
  await page.getByLabel('Role for the new person').selectOption('manager');
  await page.getByRole('button', { name: 'Invite' }).click();
  await expect.poll(() => seen.sent.at(-1)).toMatchObject({ method: 'POST', path: '/api/platform/team', body: { email: 'support@e2e.test', role: 'manager' } });

  await page.getByLabel('Role of dev@e2e.test').selectOption('manager');
  await expect.poll(() => seen.sent.at(-1)).toMatchObject({ method: 'PATCH', body: { role: 'manager' } });
  await page.getByRole('button', { name: 'Remove dev@e2e.test' }).click();
  await page.getByTestId('confirm-ok').click();
  await expect.poll(() => seen.sent.at(-1)?.method).toBe('DELETE');
  await page.screenshot({ path: 'test-results/platform-team.png', fullPage: true });
  expect(seen.forbidden).toEqual([]);
  expect(errors).toEqual([]);
});

// ---- Lead statuses (docs/progress/lead-statuses.md): each business's own list ----
test('lead statuses: the Pipeline and Inbox use the business\'s own names; Settings -> Lead statuses edits them', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page);
  const sent = [];
  await page.route('**/api/lead-statuses**', route => {
    const req = route.request();
    if (req.method() === 'GET') return route.fallback();
    sent.push({ method: req.method(), path: new URL(req.url()).pathname + new URL(req.url()).search, body: req.postDataJSON() });
    return route.fulfill({ json: { success: true, statuses: ANSWERS['/api/lead-statuses'].statuses, status: { key: 's_new1', label: 'Called twice' } } });
  });

  // Pipeline: the business's words (and the bottom line names its own statuses).
  await page.goto('/admin/pipeline');
  await expect(page.locator('[data-stage="interested"]').getByText('Called back')).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(/looking at a service or product in the bot/)).toContainText('Called back');
  // Inbox: filter and the chat's badge.
  await page.goto('/admin/inbox');
  await expect(page.getByLabel('Status').locator('option', { hasText: 'Report sent' })).toHaveCount(1, { timeout: 20000 });

  // Settings -> Lead statuses.
  await page.goto('/admin/settings/lead-statuses');
  const screen = page.getByTestId('lead-statuses');
  await expect(screen.getByTestId('status-row')).toHaveCount(7, { timeout: 20000 });
  await expect(screen.getByTestId('status-preview')).toContainText('Report sent');
  // The start status: type locked, no hide / remove.
  await expect(page.getByLabel('Type of New enquiry')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Remove New enquiry' })).toHaveCount(0);

  await page.getByLabel('Name of Called back').fill('Called once');
  await page.getByLabel('Name of Called back').press('Enter');
  await expect.poll(() => sent.at(-1)).toMatchObject({ method: 'PATCH', path: '/api/lead-statuses/interested', body: { label: 'Called once' } });

  await page.getByPlaceholder('e.g. Called back').fill('Called twice');
  await page.getByLabel('Kind of the new status').selectOption('working');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect.poll(() => sent.at(-1)).toMatchObject({ method: 'POST', body: { label: 'Called twice', type: 'working' } });

  await page.getByRole('button', { name: 'Move Report sent up' }).click();
  await expect.poll(() => sent.at(-1)?.body?.keys?.slice(0, 3)).toEqual(['new', 's_report', 'interested']);

  // Removing a status that still has chats: they move first.
  await page.getByRole('button', { name: 'Remove Report sent' }).click();
  await expect(page.getByText('2 chats are in this status.')).toBeVisible();
  await page.getByLabel('Move its chats to').selectOption('ordered');
  await page.getByTestId('remove-status-ok').click();
  await expect.poll(() => sent.at(-1)).toMatchObject({ method: 'DELETE', path: '/api/lead-statuses/s_report?moveTo=ordered' });
  await page.screenshot({ path: 'test-results/lead-statuses.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('lead statuses: agents don\'t get the settings screen', async ({ page }) => {
  await fakeBackend(page, { role: 'agent' });
  await page.goto('/agent/settings/lead-statuses');
  await expect(page.getByTestId('lead-statuses')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Main menu' }).getByRole('link', { name: 'Lead statuses' })).toHaveCount(0);
});

// ---- Leads tools (docs/progress/leads-tools.md) ----
test('inbox: last 2 days by default, "Show all", more filters remembered; Add lead sends no WhatsApp message', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page, { role: 'agent' });
  const lists = [];
  const sent = [];
  await page.route('**/api/inbox**', route => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname === '/api/inbox' && req.method() === 'GET') lists.push(Object.fromEntries(url.searchParams));
    if (url.pathname === '/api/inbox/start') { sent.push(req.postDataJSON()); return route.fulfill({ json: { success: true, contact: { ...LEAD, phone: '919000000077' } } }); }
    return route.fallback();
  });
  await page.goto('/agent/inbox');
  await expect(page.getByTestId('inbox-range')).toContainText('Showing the last 2 days', { timeout: 20000 });
  await expect.poll(() => lists.at(-1)?.range).toBe('2d');
  await page.getByTestId('inbox-range').getByRole('button', { name: 'Show all' }).click();
  await expect.poll(() => lists.at(-1)?.range).toBe('all');
  await expect(page.getByTestId('inbox-range')).toContainText('Showing all chats');

  await page.getByTestId('inbox-range').getByRole('button', { name: /Filters/ }).click();
  await page.getByTestId('more-filters').getByLabel('Source').selectOption('Phone call');
  await page.getByTestId('more-filters').getByLabel('Active in').selectOption('7d');
  await expect.poll(() => lists.at(-1)).toMatchObject({ range: '7d', source: 'Phone call' });
  // Remembered for this person after a reload.
  await page.reload();
  await expect.poll(() => lists.at(-1), { timeout: 20000 }).toMatchObject({ range: '7d', source: 'Phone call' });

  // Add lead (an agent: assigned to themselves; no assignee menu).
  await page.getByRole('button', { name: 'Add lead' }).click();
  const form = page.getByTestId('add-lead');
  await form.getByPlaceholder('919876543210').fill('+91 90000 00077');
  await form.getByPlaceholder('Ravi Kumar').fill('Kiran');
  await form.getByLabel('Status').selectOption('interested');
  await form.getByLabel(/^Note/).fill('Called about knee pain, wants Saturday');
  await expect(form.getByText('The lead is assigned to you.')).toBeVisible();
  await page.getByTestId('add-lead-save').click();
  await expect.poll(() => sent.at(-1)).toMatchObject({ phone: '919000000077', name: 'Kiran', source: 'Phone call', status: 'interested', note: 'Called about knee pain, wants Saturday' });
  expect(sent.at(-1).assignedTo).toBeUndefined();
  await expect(page.getByText('Lead added.')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Leads page (managers): filters, export CSV with chosen columns, delete with the typed count; agents never see it', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page);
  const calls = [];
  const LEADS = [{ ...LEAD, stage: 'ordered', opted_out: false }, { ...LEAD, phone: '919000000002', name: 'Sita', stage: 'new', source: 'Phone call', tags: [], opted_out: true }];
  await page.route('**/api/leads/**', route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    calls.push({ path, body: req.postDataJSON() });
    if (path === '/api/leads/search') return route.fulfill({ json: { success: true, total: LEADS.length, leads: LEADS, capped: false } });
    if (path === '/api/leads/export') return route.fulfill({ status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="leads-2026-11-13.csv"', 'X-Lead-Count': '2' }, body: '﻿Name,Phone\r\nRavi Kumar,\'+919000000001\r\n' });
    if (path === '/api/leads/delete') return route.fulfill({ json: { success: true, deleted: 1, suppressed: 1 } });
    return route.fallback();
  });
  await page.goto('/admin/leads');
  const screen = page.getByTestId('leads-screen');
  await expect(screen.getByTestId('lead-row')).toHaveCount(2, { timeout: 20000 });
  await expect(screen.getByTestId('leads-total')).toHaveText('2 leads match');
  await expect(screen.getByTestId('lead-row').nth(1).getByText('STOP', { exact: true })).toBeVisible();
  // Filters go in the POST body (numbers never in the address).
  await screen.getByLabel('Status', { exact: true }).selectOption('ordered');
  await expect.poll(() => calls.filter(c => c.path === '/api/leads/search').at(-1)?.body?.filters?.status).toBe('ordered');

  // Export: everything matching, chosen columns, downloaded as a file.
  await screen.getByRole('button', { name: /Export CSV/ }).click();
  await page.getByRole('dialog').getByLabel('Notes count').uncheck();
  const download = page.waitForEvent('download');
  await page.getByTestId('export-go').click();
  expect((await download).suggestedFilename()).toBe('leads-2026-11-13.csv');
  const ex = calls.find(c => c.path === '/api/leads/export').body;
  expect(ex.filters.status).toBe('ordered');
  expect(ex.columns).not.toContain('notes');
  expect(ex.phones).toBeUndefined();

  // Delete one: typed count required.
  await screen.getByLabel('Select Sita').check();
  await screen.getByRole('button', { name: 'Delete (1)' }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('1');
  await page.getByTestId('confirm-ok').click();
  await expect.poll(() => calls.find(c => c.path === '/api/leads/delete')?.body).toEqual({ phones: ['919000000002'], confirmCount: 1 });
  await expect(page.getByText(/1 lead deleted \(1 STOP number kept blocked\)/)).toBeVisible();
  await page.screenshot({ path: 'test-results/leads-page.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('Leads page: agents get no menu item and no screen', async ({ page }) => {
  await fakeBackend(page, { role: 'agent' });
  await page.goto('/agent/leads');
  await expect(page.getByRole('navigation', { name: 'Main menu' }).getByRole('link', { name: 'Inbox' })).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('leads-screen')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Main menu' }).getByRole('link', { name: 'Leads', exact: true })).toHaveCount(0);
});

// ---- Lead assignment (docs/progress/lead-assignment.md) ----
test('Lead assignment: a manager turns on round-robin and picks the team; "no one available" is shown', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page);
  let state = structuredClone(ANSWERS['/api/lead-assignment']);
  const sent = [];
  await page.route('**/api/lead-assignment', route => {
    if (route.request().method() === 'PUT') {
      const b = route.request().postDataJSON();
      sent.push(b);
      state = { ...state, settings: { ...state.settings, mode: b.mode, updatedBy: ME.email }, teams: [{ numberId: '', members: b.teams[0].members, availableNow: [] }] };
    }
    return route.fulfill({ json: { success: true, ...state } });
  });
  await page.goto('/admin/settings/lead-assignment');
  const screen = page.getByTestId('lead-assignment');
  await expect(screen.getByRole('radio', { name: /Off/ })).toHaveAttribute('aria-checked', 'true', { timeout: 20000 });
  await screen.getByRole('radio', { name: /Round-robin/ }).click();
  await screen.getByRole('button', { name: 'Add agent@e2e.test' }).click();
  await screen.getByRole('button', { name: 'Add owner@e2e.test' }).click();
  await expect(screen.getByTestId('rotation-team').getByRole('listitem')).toHaveCount(2);
  await expect(screen.getByTestId('rotation-team')).toContainText('Away');
  await screen.getByRole('button', { name: 'Move owner@e2e.test up' }).click();
  await screen.getByRole('button', { name: /Save/ }).click();
  await expect.poll(() => sent.at(-1)).toMatchObject({ mode: 'round_robin', maxOpen: null, teams: [{ numberId: '', members: ['owner@e2e.test', 'agent@e2e.test'] }] });
  await expect(screen.getByTestId('nobody-available')).toBeVisible();
  await page.screenshot({ path: 'test-results/lead-assignment.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('Available / Away: the account menu switch and the My profile card', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page, { role: 'agent' });
  let mine = structuredClone(ANSWERS['/api/me/availability']);
  const sent = [];
  await page.route('**/api/me/availability', route => {
    if (route.request().method() === 'PUT') { const b = route.request().postDataJSON(); sent.push(b); mine = { ...mine, availability: { ...mine.availability, ...b } }; }
    return route.fulfill({ json: { success: true, ...mine } });
  });
  await page.goto('/agent/inbox');
  const menu = await openAccountMenu(page);
  await expect(menu.getByTestId('availability-toggle')).toContainText('Available for new chats', { timeout: 20000 });
  await menu.getByTestId('availability-toggle').click();
  await expect.poll(() => sent.at(-1)).toEqual({ available: false });
  await expect(menu.getByTestId('availability-toggle')).toContainText('Away');
  await page.goto('/agent/profile');
  const card = page.getByTestId('availability-card');
  await expect(card).toContainText('Away', { timeout: 20000 });
  await card.getByRole('button', { name: 'Sun' }).click();
  await card.getByLabel('Start hour').selectOption('10');
  await card.getByRole('button', { name: 'Save hours' }).click();
  await expect.poll(() => sent.at(-1)).toEqual({ days: [1, 2, 3, 4, 5, 6], startHour: 10, endHour: null });
  expect(errors).toEqual([]);
});

// ---- Ads funnel (A1 + A2) ----
test('Ads Funnel tab: steps, costs, campaigns, attribution toggle and CSV; summary on Analytics', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page);
  await page.route('**/api/ads?*', r => r.fulfill({ json: { adsEnabled: true, account: { connected: true, adAccountId: 'act_1', name: 'E2E Ads', currency: 'INR', lastSyncAt: NOW, alerts: { maxCostPerChat: null, maxCostPerConversion: null, windowDays: 3 } }, report: null } }));
  const M = (o) => ({ spend: 0, impressions: 0, clicks: 0, metaChats: 0, chats: 0, replied: 0, working: 0, won: 0, done: 0, repeat: 0, lost: 0, revenue: 0, valued: 0, costPerChat: null, costPerWorking: null, costPerWon: null, costPerDone: null, wonRate: null, roas: null, ...o });
  const tot = M({ spend: 1000, impressions: 16000, clicks: 300, metaChats: 12, chats: 5, replied: 2, working: 4, won: 3, done: 1, lost: 2, revenue: 2000, valued: 1, costPerChat: 200, costPerWon: 333.33, wonRate: 60, roas: 2 });
  const funnel = {
    range: { from: NOW, to: NOW, days: 30 }, currency: 'INR', attribution: 'first', avgValue: 1500,
    totals: { ...tot, medianDaysToWon: 1.5, medianFirstReplyMin: 31.5 }, previous: { ...M({ spend: 800, chats: 4, won: 1, costPerWon: 800 }), medianDaysToWon: null, medianFirstReplyMin: null },
    steps: [['spend', 'Spend', 1000], ['impressions', 'Impressions', 16000], ['clicks', 'Clicks', 300], ['metaChats', 'Chats started (Meta)', 12], ['chats', 'Chats in the CRM', 5], ['replied', 'Replied by the team', 2], ['working', 'Working', 4], ['won', 'Booked / ordered', 3], ['done', 'Done', 1], ['repeat', 'Returning', 0]].map(([key, label, count]) => ({ key, label, count, pctOfPrev: null })),
    campaigns: [{ campaignId: '1001', name: 'Knee camp', ...tot, lostReasons: { not_interested: 1 }, medianDaysToWon: 1.5, adsets: [{ adsetId: '101', name: 'Hyderabad 30+', ...tot, ads: [{ adId: '11', name: 'Knee ad', ...tot }] }] }],
    replyBands: [{ key: 'under5m', label: 'Under 5 min', chats: 1, won: 1, wonRate: 100 }], agents: [{ email: 'agent@e2e.test', chats: 5, replied: 2, won: 3, wonRate: 60, medianFirstReplyMin: 31.5 }],
    sources: [{ source: 'Ads', leads: 5, won: 3, wonRate: 60 }, { source: 'Phone call', leads: 2, won: 1, wonRate: 50 }],
    trend: [{ day: '2026-11-02', spend: 600, won: 1 }], campaignsList: [{ id: '1001', name: 'Knee camp' }], historyFrom: NOW,
  };
  const bodies = [];
  await page.route('**/api/ads/funnel', r => { bodies.push(r.request().postDataJSON()); return r.fulfill({ json: { success: true, funnel } }); });
  await page.route('**/api/ads/funnel/export', r => r.fulfill({ status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="ads-funnel-2026-11-14.csv"' }, body: '﻿Level,Campaign\r\n' }));
  await page.goto('/admin/ads/funnel');
  const f = page.getByTestId('ads-funnel');
  await expect(f.getByTestId('funnel-kpis')).toContainText('Booked / ordered', { timeout: 20000 });
  await expect(f.getByTestId('funnel-kpis')).toContainText('2×');
  await expect(f.getByTestId('funnel-steps')).toContainText('Replied by the team');
  await f.getByTestId('funnel-campaign').getByRole('button', { name: /Knee camp/ }).click();
  await expect(f.getByText('Hyderabad 30+')).toBeVisible();
  await expect(f.getByText(/lost: Not interested 1/)).toBeVisible();
  await f.getByRole('button', { name: 'Last ad' }).click();
  await expect.poll(() => bodies.at(-1)?.attribution).toBe('last');
  await f.getByLabel('Handled by').selectOption('agent@e2e.test');
  await expect.poll(() => bodies.at(-1)?.agent).toBe('agent@e2e.test');
  const download = page.waitForEvent('download');
  await f.getByRole('button', { name: /Export CSV/ }).click();
  expect((await download).suggestedFilename()).toBe('ads-funnel-2026-11-14.csv');
  await page.screenshot({ path: 'test-results/ads-funnel.png', fullPage: true });
  // Analytics: the short summary.
  await page.goto('/admin/analytics');
  await expect(page.getByTestId('ads-funnel-summary')).toContainText('3 booked', { timeout: 20000 });
  expect(errors).toEqual([]);
});

// ---- Returning customers + saved names (docs/progress/returning-leads.md) ----
test('Inbox: rename a contact in the chat header (WhatsApp name shown under it), "Back after" badge and the Returning filter', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page);
  const back = { ...LEAD, name: 'Ravi Kumar', wa_name: '😎 Ravi', name_set_by: 'owner@e2e.test', returned_at: NOW, returned_after_days: 120, assigned_to: ME.email };
  const lists = [];
  const sent = [];
  await page.route('**/api/inbox**', route => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname === '/api/inbox' && req.method() === 'GET') { lists.push(Object.fromEntries(url.searchParams)); return route.fulfill({ json: { conversations: [back] } }); }
    if (url.pathname === `/api/inbox/${LEAD.phone}` && req.method() === 'PATCH') { sent.push(req.postDataJSON()); return route.fulfill({ json: { success: true, contact: back } }); }
    if (url.pathname === `/api/inbox/${LEAD.phone}` && req.method() === 'GET') return route.fulfill({ json: { ...ANSWERS[`/api/inbox/${LEAD.phone}`], contact: back } });
    return route.fallback();
  });
  await page.goto('/admin/inbox');
  const row = page.locator('[data-testid="chat-row"]').first();
  await expect(row.getByTestId('returned-badge')).toHaveText('Back after 4 months', { timeout: 20000 });
  await row.click();
  const header = page.getByTestId('chat-header');
  await expect(header.getByTestId('chat-name')).toHaveText('Ravi Kumar');
  await expect(header.getByTestId('wa-name')).toContainText('WhatsApp: 😎 Ravi');
  await expect(header.getByTestId('returned-badge')).toBeVisible();
  await header.getByRole('button', { name: 'Rename contact' }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('Ravi K (knee)');
  await page.getByTestId('confirm-ok').click();
  await expect.poll(() => sent.at(-1)).toEqual({ name: 'Ravi K (knee)' });
  await expect(page.getByText('Name saved')).toBeVisible();
  // The Returning filter.
  await page.getByTestId('inbox-range').getByRole('button', { name: /Filters/ }).click();
  await page.getByTestId('more-filters').getByLabel('Returning').check();
  await expect.poll(() => lists.at(-1)?.returning).toBe('true');
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------------------------
// Clinic module (docs/progress/clinic.md): appointments for hospitals, doctors' own area.
// ---------------------------------------------------------------------------------------------
const istToday = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const CLINIC_DOCTOR = { id: 'd0000000-0000-4000-8000-000000000001', name: 'Dr Rao', specialty: 'General', fee: 500, slotMinutes: 15, active: true, loginReady: true };

test('Clinic: an agent books a patient with a doctor, picks PhonePe / UPI and marks it paid with the transaction ID', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page, { role: 'agent' });
  const slotAt = new Date(Date.now() + 3 * 3600000).toISOString();
  let appts = [];
  const sent = { book: [], desk: [] };
  await page.route('**/api/clinic/**', route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path === '/api/clinic/status') return route.fulfill({ json: { success: true, enabled: true, razorpay: false } });
    if (path === '/api/clinic/doctors') return route.fulfill({ json: { success: true, doctors: [CLINIC_DOCTOR] } });
    if (path.endsWith('/slots')) return route.fulfill({ json: { success: true, slots: [{ startsAt: slotAt, time: '11:00' }] } });
    if (path === '/api/clinic/patients') return route.fulfill({ json: { success: true, patients: [] } });
    if (path === '/api/clinic/follow-ups') return route.fulfill({ json: { success: true, followUps: [{ appointmentId: 'ap0', patientId: 'pa0', phone: '919000000001', patientName: 'Ravi Kumar', doctorId: CLINIC_DOCTOR.id, doctorName: 'Dr Rao', lastVisit: NOW, due: istToday(), note: 'Bring blood report', overdue: false, dueToday: true }] } });
    if (path === '/api/clinic/appointments' && req.method() === 'POST') {
      const b = req.postDataJSON(); sent.book.push(b);
      const a = { id: 'ap000000-0000-4000-8000-000000000001', doctorId: b.doctorId, doctorName: 'Dr Rao', phone: b.phone, patientName: b.patient.name, startsAt: b.startsAt, endsAt: b.startsAt, status: 'pending_payment', fee: 500, note: b.note, reason: b.reason, patientId: 'pa1', paymentMethod: b.payMethod || null, followUpOn: null, followUpNote: '', bookedBy: 'agent@e2e.test', confirmedAt: null, cancelledReason: '', payments: [] };
      appts = [a];
      return route.fulfill({ json: { success: true, appointment: a } });
    }
    if (path.endsWith('/desk-payment')) {
      sent.desk.push(req.postDataJSON());
      appts = appts.map(a => ({ ...a, status: 'confirmed', payments: [{ id: 'p1', method: sent.desk.at(-1).method, amount: 500, status: 'recorded', link: null, receiptNo: sent.desk.at(-1).receiptNo, recordedBy: 'agent@e2e.test', paidAt: NOW, createdAt: NOW }] }));
      return route.fulfill({ json: { success: true, appointment: appts[0] } });
    }
    if (path === '/api/clinic/appointments') return route.fulfill({ json: { success: true, appointments: appts } });
    return route.fulfill({ status: 404, json: { error: 'no mock' } });
  });
  await page.goto('/agent/appointments');
  const screen = page.getByTestId('appointments');
  await expect(screen.getByText('No appointments')).toBeVisible({ timeout: 20000 });
  await expect(screen.getByText(/Online payment links need Razorpay/)).toBeVisible();
  await screen.getByRole('button', { name: 'Book' }).click();
  const dialog = page.getByRole('dialog', { name: 'Book appointment' });
  await dialog.getByPlaceholder('91…').fill('919000000001');
  // No patients on this chat yet: the new-patient form. Name, age, gender and the reason are required.
  await dialog.getByLabel('Full name *').fill('Asha Devi');
  await dialog.getByLabel('Age (years) *').fill('34');
  await dialog.getByLabel('Doctor', { exact: true }).selectOption({ label: 'Dr Rao · General · ₹500' });
  await dialog.getByRole('radio', { name: '11:00' }).click();
  await expect(dialog.getByRole('button', { name: 'Book', exact: true })).toBeDisabled();
  await dialog.getByLabel('Gender *').selectOption('female');
  await dialog.getByLabel('Allergies').fill('Penicillin');
  await dialog.getByLabel('Reason for the visit *').fill('Fever for 3 days');
  // Payment type: online is off (no Razorpay here); PhonePe / UPI, to be marked paid when received.
  const payTypes = dialog.getByRole('radiogroup', { name: 'How the patient pays' });
  await expect(payTypes.getByRole('radio', { name: 'Online payment (Razorpay)' })).toBeDisabled();
  await expect(page.getByTestId('book-missing')).toHaveText('Still needed: how the patient pays');
  await expect(dialog.getByRole('button', { name: 'Book', exact: true })).toBeDisabled();
  await payTypes.getByRole('radio', { name: 'PhonePe / UPI' }).click();
  await dialog.getByRole('checkbox', { name: 'Already paid now' }).check();
  await page.screenshot({ path: 'test-results/clinic-book-payment.png' });
  await dialog.getByRole('checkbox', { name: 'Already paid now' }).uncheck();
  await dialog.getByRole('button', { name: 'Book', exact: true }).click();
  await expect.poll(() => sent.book.at(-1)).toMatchObject({ phone: '919000000001', doctorId: CLINIC_DOCTOR.id, startsAt: slotAt, reason: 'Fever for 3 days', payMethod: 'upi_desk',
    patient: { name: 'Asha Devi', age: 34, gender: 'female', allergies: 'Penicillin' } });
  expect(sent.book[0].fee).toBeUndefined();
  const item = screen.getByTestId('appointment');
  await expect(item).toContainText('Waiting for payment');
  await expect(item).toContainText('Will pay by PhonePe / UPI');
  await item.getByRole('button', { name: 'Mark as paid' }).click();
  const pay = page.getByRole('dialog', { name: /Mark as paid/ });
  await expect(pay.getByRole('radio', { name: 'PhonePe / UPI' })).toHaveAttribute('aria-checked', 'true');
  await expect(pay.getByRole('button', { name: 'Mark as paid' })).toBeDisabled();
  await pay.getByLabel('Payment reference').fill('T2611141234567');
  await pay.getByRole('button', { name: 'Mark as paid' }).click();
  await expect.poll(() => sent.desk.at(-1)).toMatchObject({ method: 'upi_desk', amount: '500', receiptNo: 'T2611141234567' });
  await expect(item).toContainText('Confirmed');
  await expect(item).toContainText('Paid ₹500 · PhonePe / UPI · ref T2611141234567');
  await expect(item).toContainText('Fever for 3 days');
  await expect(page.getByRole('navigation', { name: 'Main menu' }).getByRole('link', { name: 'Appointments', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/clinic-appointments.png', fullPage: true });
  // Follow-ups the doctors set.
  await screen.getByRole('tab', { name: 'Follow-ups' }).click();
  const f = page.getByTestId('follow-up');
  await expect(f).toContainText('Ravi Kumar');
  await expect(f).toContainText('Today');
  await expect(f).toContainText('Bring blood report');
  await page.screenshot({ path: 'test-results/clinic-follow-ups.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('Clinic: a doctor signs in to their own area (queue + hours), never the inbox or staff screens', async ({ page }) => {
  const errors = watchErrors(page);
  await enforceCsp(page);
  await page.addInitScript(([key, user]) => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem(key, JSON.stringify({ access_token: 'e2e-fake-token', token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'e2e-refresh', user: { id: user.id, email: user.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} } }));
  }, [STORAGE_KEY, { id: 'e2e00000-0000-4000-8000-0000000000d1', email: 'rao@e2e.test' }]);
  await page.route('**/rest/v1/staff_members*', r => r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }));
  await page.route('**/rest/v1/platform_admins*', r => r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }));
  await page.route('**/rest/v1/clinic_doctors*', r => r.fulfill({ json: { id: CLINIC_DOCTOR.id, active: true } }));
  await page.route('**/auth/v1/**', r => r.fulfill({ json: {} }));
  const day = istToday();
  let hours = { slotMinutes: 15, hours: [], daysOff: [] };
  const saved = [];
  const staffCalls = [];
  const VISIT_ID = 'ap100000-0000-4000-8000-000000000001';
  // A real 1x1 PNG: the browser shrinks it to a JPEG before upload.
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const uploads = [];
  const followUps = [];
  const visit = {
    visit: { id: VISIT_ID, startsAt: new Date().toISOString(), status: 'confirmed', reason: 'Fever for 3 days', note: 'First visit', patientName: 'Asha Devi', followUpOn: null, followUpNote: '', sheets: [] },
    patient: { id: 'pa1', name: 'Asha Devi', age: 34, gender: 'female', city: 'Guntur', allergies: 'Penicillin', conditions: 'Diabetes' },
    history: [{ id: 'ap0', startsAt: '2026-10-01T05:00:00.000Z', status: 'completed', doctorName: 'Dr Rao', reason: 'Cough', followUpOn: '2026-10-15', followUpNote: 'Review', sheets: [{ id: 'old1', url: PNG, addedAt: '2026-10-01T05:30:00.000Z' }] }],
  };
  await page.route('**/api/**', route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (!path.startsWith('/api/doctor/') && !path.startsWith('/api/public/') && path !== '/api/maintenance') staffCalls.push(path);
    if (path === '/api/doctor/me') return route.fulfill({ json: { success: true, doctor: { name: 'Dr Rao', email: 'rao@e2e.test' } } });
    if (path === '/api/doctor/appointments') return route.fulfill({ json: { success: true, day, appointments: [{ id: VISIT_ID, patientName: 'Asha Devi', startsAt: new Date().toISOString(), endsAt: new Date().toISOString(), status: 'confirmed', note: 'First visit', reason: 'Fever for 3 days', followUpOn: null }] } });
    if (path === `/api/doctor/appointments/${VISIT_ID}/sheets` && req.method() === 'POST') { uploads.push(req.postDataJSON().image); visit.visit.sheets.push({ id: `s${uploads.length}`, url: PNG, addedAt: NOW }); }
    if (path === `/api/doctor/appointments/${VISIT_ID}/follow-up`) { const b = req.postDataJSON(); followUps.push(b); visit.visit.followUpOn = b.date; visit.visit.followUpNote = b.note; }
    if (path.startsWith(`/api/doctor/appointments/${VISIT_ID}`)) return route.fulfill({ json: { success: true, ...visit } });
    if (path === '/api/doctor/hours' && req.method() === 'PUT') { const b = req.postDataJSON(); saved.push(b); hours = { ...hours, ...b }; }
    if (path === '/api/doctor/hours') return route.fulfill({ json: { success: true, ...hours } });
    if (path === '/api/maintenance') return route.fulfill({ json: { on: false } });
    return route.fulfill({ status: 404, json: { error: `no mock for ${path}` } });
  });
  await page.goto('/app');
  const app = page.getByTestId('doctor-app');
  await expect(app.getByRole('heading', { name: 'My appointments' })).toBeVisible({ timeout: 20000 });
  await expect(page).toHaveURL(/\/doctor\/appointments$/);
  await expect(app.getByRole('list', { name: 'Appointments' })).toContainText('Asha Devi');
  await expect(app.getByRole('list', { name: 'Appointments' })).toContainText('First visit');
  await expect(page.getByRole('navigation', { name: 'Main menu' })).toHaveCount(0);
  // Open the visit: the patient's details (allergy shown), the earlier visit's case sheet, add a photo, set a follow-up.
  await app.getByRole('link', { name: /Asha Devi/ }).click();
  const v = page.getByTestId('doctor-visit');
  await expect(v).toContainText('34 yrs · Female · Guntur');
  await expect(v).toContainText('Penicillin');
  await expect(v).toContainText('Diabetes');
  await expect(v.getByRole('list', { name: 'Earlier visits' })).toContainText('Cough');
  await expect(v.getByRole('list', { name: 'Earlier visits' }).getByRole('img', { name: 'Case sheet 1' })).toBeVisible();
  await v.getByLabel('Case-sheet photo', { exact: true }).setInputFiles({ name: 'sheet.png', mimeType: 'image/png', buffer: Buffer.from(PNG.split(',')[1], 'base64') });
  await expect.poll(() => uploads.length).toBe(1);
  expect(uploads[0]).toMatch(/^data:image\/jpeg;base64,/);
  await expect(v.getByText('Case sheet added')).toBeVisible();
  await v.getByRole('button', { name: '+14 days' }).click();
  await v.getByLabel('Follow-up note').fill('Bring blood report');
  await v.getByRole('button', { name: 'Save follow-up' }).click();
  await expect.poll(() => followUps.at(-1)).toMatchObject({ note: 'Bring blood report' });
  expect(followUps.at(-1).date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await page.screenshot({ path: 'test-results/clinic-visit.png', fullPage: true });
  await app.getByRole('link', { name: 'My hours' }).click();
  await app.getByRole('button', { name: 'Add time range' }).click();
  await app.getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => saved.at(-1)).toMatchObject({ slotMinutes: 15, hours: [{ weekday: 1, start: '09:00', end: '13:00' }] });
  await expect(app.getByText('Hours saved')).toBeVisible();
  await page.screenshot({ path: 'test-results/clinic-doctor.png', fullPage: true });
  await page.goto('/admin/inbox');
  await expect(page.getByTestId('area-not-allowed')).toBeVisible();
  expect(staffCalls).toEqual([]);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------------------------
// Ads → Manage (docs/progress/ads-manage.md): campaigns / ad sets / ads like Ads Manager.
// ---------------------------------------------------------------------------------------------
test('Ads Manage: campaigns with CRM numbers, drill down to ad sets and ads, turn a campaign off, change a budget', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page);
  await page.route('**/api/ads?*', r => r.fulfill({ json: { adsEnabled: true, account: { connected: true, adAccountId: 'act_1111111111', name: 'E2E Ads', currency: 'INR', lastSyncAt: NOW, alerts: { maxCostPerChat: null, maxCostPerConversion: null, windowDays: 3 } }, report: null } }));
  await page.route('**/api/ads/billing', r => r.fulfill({ json: { success: true, checkedAt: NOW, billingUrl: 'https://business.facebook.com/billing_hub/accounts/details/?asset_id=1', canEditLimit: true, billing: { status: 1, statusLabel: 'Active', problem: null, problemText: null, prepaid: false, due: 0, spent: 0, spendCap: null, method: null, currency: 'INR' } } }));
  await page.route('**/api/ads/issues', r => r.fulfill({ json: { success: true, unread: 0, issues: [], billingProblem: null } }));
  const row = (level, id, name, extra = {}) => ({ id, level, name, status: 'ACTIVE', delivery: 'ACTIVE', objective: level === 'campaign' ? 'OUTCOME_ENGAGEMENT' : null, campaignId: null, adsetId: null,
    dailyBudget: level === 'ad' ? null : 500, lifetimeBudget: null, budgetRemaining: null, start: null, end: null, created: NOW, whatsapp: level === 'adset' ? true : null, canToggle: true,
    spend: 500, impressions: 1500, clicks: 60, metaChats: 10, chats: 3, booked: 2, costPerChat: 166.67, metaUrl: `https://adsmanager.facebook.com/adsmanager/manage/x?act=1111111111&id=${id}`, ...extra });
  let campaigns = [row('campaign', '101', 'Knee pain camp'), row('campaign', '102', 'Eye check', { dailyBudget: null, spend: 60, chats: 0, booked: 0, costPerChat: null })];
  const asked = [];
  const sent = [];
  await page.route('**/api/ads/manage?*', r => {
    const u = new URL(r.request().url());
    asked.push(Object.fromEntries(u.searchParams));
    const level = u.searchParams.get('level');
    const rows = level === 'campaign' ? campaigns : level === 'adset' ? [row('adset', '201', 'Guntur 25-55')] : [row('ad', '301', 'Knee video'), row('ad', '302', 'Knee photo')];
    return r.fulfill({ json: { success: true, level, parent: u.searchParams.get('parent'), days: 30, delivery: 'recent', currency: 'INR', rows, totals: { spend: 560, impressions: 0, clicks: 0, metaChats: 10, chats: 3, booked: 2, costPerChat: 186.67 }, total: rows.length, truncated: false, canEditAll: true } });
  });
  await page.route('**/api/ads/manage/**', r => {
    sent.push({ url: new URL(r.request().url()).pathname, method: r.request().method(), body: r.request().postDataJSON() });
    if (r.request().url().endsWith('/status')) campaigns = campaigns.map(c => (c.id === '101' ? { ...c, status: 'PAUSED', delivery: 'PAUSED' } : c));
    return r.fulfill({ json: { success: true, ok: true } });
  });

  await page.goto('/admin/ads/manage');
  const m = page.getByTestId('ads-manage');
  const table = m.getByRole('table', { name: 'Campaigns' });
  await expect(table.getByRole('row').filter({ hasText: 'Knee pain camp' })).toContainText('₹500', { timeout: 20000 });
  await expect(table.getByRole('row').filter({ hasText: 'Knee pain camp' })).toContainText('Engagement');
  await expect(table.getByRole('row').filter({ hasText: 'Eye check' })).toContainText('On ad sets');
  await page.screenshot({ path: 'test-results/ads-manage.png', fullPage: true });

  // Turn the campaign off: asked first, then only that campaign.
  await table.getByRole('switch', { name: 'Knee pain camp on or off' }).click();
  await page.getByTestId('confirm-ok').click();
  await expect.poll(() => sent.at(-1)).toEqual({ url: '/api/ads/manage/campaign/101/status', method: 'POST', body: { status: 'PAUSED' } });
  await expect(table.getByRole('switch', { name: 'Knee pain camp on or off' })).toHaveAttribute('aria-checked', 'false');

  // Budget.
  await table.getByRole('button', { name: 'Change budget of Knee pain camp' }).click();
  await page.getByRole('dialog', { name: 'Daily budget' }).getByLabel('Budget', { exact: true }).fill('800');
  await page.getByRole('dialog', { name: 'Daily budget' }).getByRole('button', { name: 'Save' }).click();
  await expect.poll(() => sent.at(-1)).toEqual({ url: '/api/ads/manage/campaign/101', method: 'PATCH', body: { budget: 800 } });

  // Drill down: campaign → its ad sets → their ads, with a breadcrumb back.
  await table.getByRole('button', { name: 'Knee pain camp', exact: true }).click();
  await expect(m.getByRole('table', { name: 'Ad sets' })).toContainText('Guntur 25-55');
  await expect.poll(() => asked.at(-1)).toMatchObject({ level: 'adset', parent: '101' });
  await m.getByRole('table', { name: 'Ad sets' }).getByRole('button', { name: 'Guntur 25-55', exact: true }).click();
  await expect(m.getByRole('table', { name: 'Ads' })).toContainText('Knee photo');
  await expect.poll(() => asked.at(-1)).toMatchObject({ level: 'ad', parent: '201' });
  await expect(m.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Knee pain camp');
  await m.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('button', { name: 'All campaigns' }).click();
  await expect(m.getByRole('table', { name: 'Campaigns' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('Clinic Collections (managers): today\'s money by payment type and person, by doctor, payments with references', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page, { role: 'manager' });
  const asked = [];
  await page.route('**/api/clinic/**', route => {
    const u = new URL(route.request().url());
    if (u.pathname === '/api/clinic/status') return route.fulfill({ json: { success: true, enabled: true, razorpay: true } });
    if (u.pathname === '/api/clinic/doctors') return route.fulfill({ json: { success: true, doctors: [CLINIC_DOCTOR] } });
    if (u.pathname === '/api/clinic/appointments') return route.fulfill({ json: { success: true, appointments: [] } });
    if (u.pathname === '/api/clinic/report') {
      asked.push(Object.fromEntries(u.searchParams));
      const day = u.searchParams.get('from');
      return route.fulfill({ json: { success: true, from: day, to: u.searchParams.get('to'), days: day === u.searchParams.get('to') ? 1 : 7,
        totals: { collected: 1200, payments: 3, discount: 100, waiting: 300, appointments: 3, waitingPayment: 1, confirmed: 0, seen: 1, noShow: 1, cancelled: 1, showRate: 50 },
        byMethod: [{ method: 'cash', count: 1, amount: 500 }, { method: 'upi_desk', count: 1, amount: 400 }, { method: 'razorpay_link', count: 1, amount: 300 }],
        byPerson: [{ person: 'agent@e2e.test', count: 1, amount: 500, cash: 500 }, { person: 'Online (Razorpay)', count: 1, amount: 300, cash: 0 }],
        byDoctor: [{ doctorId: CLINIC_DOCTOR.id, doctor: 'Dr Rao', booked: 3, seen: 1, noShow: 1, cancelled: 1, collected: 1200 }],
        daily: [{ day, appointments: 3, collected: 1200 }],
        payments: [{ id: 'p2', paidAt: NOW, method: 'upi_desk', amount: 400, reference: 'T2611141234567', takenBy: 'manager@e2e.test', patientName: 'Ravi', doctor: 'Dr Rao', fee: 500 }] } });
    }
    return route.fulfill({ status: 404, json: { error: 'no mock' } });
  });
  await page.goto('/manager/appointments');
  await page.getByTestId('appointments').getByRole('tab', { name: 'Collections' }).click();
  const c = page.getByTestId('clinic-collections');
  await expect(c).toContainText('₹1,200', { timeout: 20000 });
  await expect(c).toContainText('₹100 discount');
  await expect(c.getByRole('table', { name: 'By payment type' })).toContainText('PhonePe / UPI');
  await expect(c.getByRole('table', { name: 'Taken by' })).toContainText('agent@e2e.test');
  await expect(c.getByRole('table', { name: 'By doctor' })).toContainText('Dr Rao');
  await expect(c.getByRole('table', { name: 'Payments' })).toContainText('T2611141234567');
  expect(asked[0].from).toBe(asked[0].to);
  await page.screenshot({ path: 'test-results/clinic-collections.png', fullPage: true });
  await c.getByRole('radio', { name: 'Last 7 days' }).click();
  await expect.poll(() => asked.at(-1)?.from !== asked.at(-1)?.to).toBe(true);
  expect(errors).toEqual([]);
});

test('sign-in after someone else signed out: the page left on /agent/inbox takes the Business Admin to /admin/inbox, not "Not allowed"', async ({ page }) => {
  // An agent signed out: the sign-in page stays on the agent's address.
  await page.goto('/agent/inbox');
  await expect(page.getByText('Staff sign-in')).toBeVisible({ timeout: 20000 });
  // The Business Admin signs in on that page (fake test login; nothing leaves this machine).
  await fakeBackend(page, { role: 'owner' });
  await page.route('**/auth/v1/token*', r => r.fulfill({ json: {
    access_token: 'e2e-fake-token', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'e2e-refresh',
    user: { id: ME.id, email: ME.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} },
  } }));
  // The Activity log hears about a real sign-in once (not again when the tab is focused later).
  let signIns = 0;
  await page.route('**/api/auth/signed-in', r => { signIns++; return r.fulfill({ json: { success: true } }); });
  await page.getByLabel('Email').fill(ME.email);
  await page.getByLabel('Password').fill('e2e-test-only-1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin\/inbox$/, { timeout: 20000 });
  await expect.poll(() => signIns).toBe(1);
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(300);
  expect(signIns).toBe(1);
  await expect(page.getByRole('navigation', { name: 'Main menu' })).toBeVisible();
  await expect(page.getByTestId('area-not-allowed')).toHaveCount(0);
  // Typing another role's address afterwards is still "Not allowed" (only the moment of signing in moves you).
  await page.goto('/agent/inbox');
  await expect(page.getByTestId('area-not-allowed')).toBeVisible({ timeout: 20000 });
});

// ---------------------------------------------------------------------------
// Loading states (docs/progress/ui-enhancement.md "Loading states"): while an answer is slow, each screen
// shows a skeleton shaped like its content (never a blank area or a wrong "nothing here"); a failed load
// shows the reason with "Try again".
// ---------------------------------------------------------------------------

/** Hold every request matching `pattern` until the returned release() is called, then answer as usual. */
async function holdRoute(page, pattern) {
  let release;
  const gate = new Promise(r => { release = r; });
  await page.route(pattern, async route => { await gate; await route.fallback(); });
  return () => release();
}

/** A signed-in platform admin or clinic doctor (no staff row), with the given /api answers. */
async function fakeOtherLogin(page, { user, platformAdmin = false, doctor = null, answer }) {
  await enforceCsp(page);
  await page.addInitScript(([key, u]) => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem(key, JSON.stringify({ access_token: 'e2e-fake-token', token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'e2e-refresh', user: { id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} } }));
  }, [STORAGE_KEY, user]);
  await page.route('**/rest/v1/staff_members*', r => r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }));
  await page.route('**/rest/v1/platform_admins*', r => (platformAdmin ? r.fulfill({ json: { user_id: user.id } }) : r.fulfill({ status: 200, contentType: 'application/json', body: 'null' })));
  await page.route('**/rest/v1/clinic_doctors*', r => (doctor ? r.fulfill({ json: doctor }) : r.fulfill({ status: 200, contentType: 'application/json', body: 'null' })));
  await page.route('**/auth/v1/**', r => r.fulfill({ json: {} }));
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    const body = answer(path, route.request());
    return route.fulfill(body ? { json: body } : { status: 404, json: { error: `no mock for ${path}` } });
  });
}

test('loading states (agent): sign-in check, Home, Inbox list, an open chat and the Pipeline show skeletons while slow', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page, { role: 'agent' });
  // 1. Checking the sign-in: the app's frame with a note, not a blank page.
  const releaseStaff = await holdRoute(page, '**/rest/v1/staff_members*');
  const releaseHome = await holdRoute(page, '**/api/home');
  await page.goto('/agent/home');
  await expect(page.getByTestId('signin-checking')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('signin-checking')).toContainText('Checking your sign-in…');
  releaseStaff();
  // 2. Home: number tiles and rows while /api/home is slow.
  await expect(page.getByRole('status', { name: 'Loading your work' }).first()).toBeVisible({ timeout: 20000 });
  releaseHome();
  await expect(page.getByTestId('all-caught-up')).toBeVisible();
  await expect(page.getByRole('status', { name: 'Loading your work' })).toHaveCount(0);

  // 3. Inbox: chat rows while the list loads, never "No conversations here" meanwhile.
  const releaseList = await holdRoute(page, /\/api\/inbox\?/);
  await openScreen(page, 'Inbox');
  await expect(page.getByRole('status', { name: 'Loading chats' }).first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('No conversations here.')).toHaveCount(0);
  releaseList();
  await expect(page.locator('[data-testid="chat-row"]')).toHaveCount(1);

  // 4. An open chat: message bubbles while the conversation loads.
  const releaseChat = await holdRoute(page, `**/api/inbox/${LEAD.phone}`);
  await page.locator('[data-testid="chat-row"]').first().click();
  await expect(page.getByRole('status', { name: 'Loading the conversation' })).toBeVisible();
  releaseChat();
  await expect(page.locator('[data-testid="chat-header"]')).toContainText(LEAD.phone);
  await expect(page.getByRole('status', { name: 'Loading the conversation' })).toHaveCount(0);

  // 5. Pipeline: columns of grey cards while it loads.
  const releasePipe = await holdRoute(page, '**/api/pipeline');
  await openScreen(page, 'Pipeline');
  await expect(page.getByRole('status', { name: 'Loading the pipeline' })).toBeVisible({ timeout: 15000 });
  releasePipe();
  await expect(page.getByText(LEAD.name).first()).toBeVisible();
  await expect(page.getByRole('status', { name: 'Loading the pipeline' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('loading states (manager): a screen\'s code shows its skeleton, a failed load shows "Try again" that works, Leads and Settings skeletons', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page, { role: 'manager' });
  await page.goto('/manager/home');
  await expect(page.getByRole('navigation', { name: 'Main menu' })).toBeVisible({ timeout: 20000 });

  // The Analytics screen's code is slow: the page skeleton (not a blank area or "Loading…") shows meanwhile.
  const releaseCode = await holdRoute(page, '**/assets/AnalyticsScreen-*.js');
  // ...and its first answer fails (a 4xx is not retried by itself): the reason and "Try again".
  let failed = false;
  await page.route(/\/api\/analytics\?/, r => {
    if (!failed) { failed = true; return r.fulfill({ status: 400, json: { error: 'Analytics is taking a break.' } }); }
    return r.fallback();
  });
  await openScreen(page, 'Analytics');
  await expect(page.getByRole('status', { name: 'Loading the page' }).first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Loading…')).toHaveCount(0);
  releaseCode();
  const problem = page.getByTestId('load-error');
  await expect(problem).toContainText('Analytics is taking a break.', { timeout: 15000 });
  await problem.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('New leads per day').first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('load-error')).toHaveCount(0);

  // Leads: a table skeleton while the list loads, then the empty state.
  await page.route('**/api/leads/search', r => r.fulfill({ json: { success: true, total: 0, leads: [], capped: false } }));
  const releaseLeads = await holdRoute(page, '**/api/leads/search');
  await openScreen(page, 'Leads');
  await expect(page.getByRole('status', { name: 'Loading leads' })).toBeVisible({ timeout: 15000 });
  releaseLeads();
  await expect(page.getByText('No leads match')).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('status', { name: 'Loading leads' })).toHaveCount(0);

  // Settings -> WhatsApp: a form skeleton while the connection loads.
  const releaseWa = await holdRoute(page, '**/api/whatsapp');
  await openScreen(page, 'WhatsApp');
  await expect(page.getByRole('status', { name: 'Loading the WhatsApp connection' })).toBeVisible({ timeout: 15000 });
  releaseWa();
  await expect(page.getByRole('status', { name: 'Loading the WhatsApp connection' })).toHaveCount(0, { timeout: 15000 });
  await page.screenshot({ path: 'test-results/loading-states-manager.png' });
  expect(errors.filter(e => !/status of 400/.test(e))).toEqual([]);
});

test('loading states (sign-in check fails): "Try again" instead of "No dashboard access"', async ({ page }) => {
  await fakeBackend(page, { role: 'owner' });
  let down = true;
  await page.route('**/rest/v1/staff_members*', r => (down ? r.abort('internetdisconnected') : r.fallback()));
  await page.goto('/admin/home');
  const failed = page.getByTestId('signin-check-failed');
  await expect(failed).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('No dashboard access')).toHaveCount(0);
  down = false;
  await failed.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('navigation', { name: 'Main menu' })).toBeVisible({ timeout: 20000 });
});

test('loading states (doctor): each page shows its skeleton, then the empty state', async ({ page }) => {
  const errors = watchErrors(page);
  const day = istToday();
  await fakeOtherLogin(page, {
    user: { id: 'e2e00000-0000-4000-8000-0000000000d1', email: 'rao@e2e.test' },
    doctor: { id: CLINIC_DOCTOR.id, active: true },
    answer: (path) => (path === '/api/doctor/me' ? { success: true, doctor: { name: 'Dr Rao', email: 'rao@e2e.test' } }
      : path === '/api/doctor/appointments' ? { success: true, day, appointments: [] }
        : path === '/api/doctor/hours' ? { success: true, slotMinutes: 15, hours: [], daysOff: [] }
          : path === '/api/maintenance' ? { on: false } : null),
  });
  const releaseDay = await holdRoute(page, '**/api/doctor/appointments*');
  await page.goto('/doctor');
  const app = page.getByTestId('doctor-app');
  await expect(app.getByTestId('skeleton').first()).toBeVisible({ timeout: 20000 });
  releaseDay();
  await expect(app.getByTestId('empty-state').first()).toBeVisible();
  await expect(app.getByTestId('skeleton')).toHaveCount(0);
  const releaseHours = await holdRoute(page, '**/api/doctor/hours');
  await app.getByRole('link', { name: 'My hours' }).first().click();
  await expect(page.getByRole('status', { name: 'Loading your hours' })).toBeVisible({ timeout: 15000 });
  releaseHours();
  await expect(page.getByRole('status', { name: 'Loading your hours' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('loading states (platform console): the console frame while the role loads, then the tab\'s skeleton', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeOtherLogin(page, { user: ADMIN, platformAdmin: true, answer: (path, req) => (req.method() !== 'GET' ? { success: true } : PLATFORM_ANSWERS[path]) });
  const releaseMe = await holdRoute(page, '**/api/platform/me');
  const releaseHealth = await holdRoute(page, '**/api/platform/health');
  await page.goto('/platform');
  await expect(page.getByTestId('app-frame-skeleton')).toBeVisible({ timeout: 20000 });
  releaseMe();
  await expect(page.getByText('Platform console')).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('status', { name: 'Loading health' }).first()).toBeVisible();
  releaseHealth();
  await expect(page.getByText('5 AI provider errors in 24 hours.').first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('status', { name: 'Loading health' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// Customer import + customer fields (docs/progress/customer-import.md, D1 + D2). The file is read in the browser;
// these tests check what the wizard sends (mapped rows, new fields, private suggestion, consent) and what it shows.
// ---------------------------------------------------------------------------
const IMPORT_LIMITS = { planName: 'Growth', rowsPerFile: 10000, fileMb: 5, rowsMonth: 25000, monthLeft: 25000, contactsLeft: 900, newLeft: 900, newLeftReason: 'Your Growth plan allows 25,000 new people per month by import.' };
const IMPORT_FIELDS = { success: true, ready: true, fields: [{ key: 'branch', label: 'Branch', type: 'text', options: [], private: false, hidden: false, sort_order: 1 }], max: 25, canEdit: true,
  types: [['text', 'Text'], ['number', 'Number'], ['amount', 'Amount (₹)'], ['date', 'Date'], ['choice', 'Choice (list)'], ['yesno', 'Yes / No']].map(([key, label]) => ({ key, label })) };
const IMPORT_ID = 'f0000000-0000-4000-8000-000000000001';

/** A real (tiny) .xlsx file: one sheet, numbers and inline text cells. */
async function xlsxFile(rows) {
  const { ZipArchive } = await import('archiver');
  const { PassThrough } = await import('node:stream');
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const col = i => String.fromCharCode(65 + i);
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => (typeof v === 'number' ? `<c r="${col(ci)}${ri + 1}"><v>${v}</v></c>` : `<c r="${col(ci)}${ri + 1}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`)).join('')}</row>`).join('')}</sheetData></worksheet>`;
  const files = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Customers" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': sheet,
  };
  const zip = new ZipArchive();
  const out = new PassThrough();
  const chunks = [];
  out.on('data', c => chunks.push(c));
  const done = new Promise(r => out.on('end', r));
  zip.pipe(out);
  for (const [name, text] of Object.entries(files)) zip.append(text, { name });
  await zip.finalize();
  await done;
  return Buffer.concat(chunks);
}

/** The import API, mocked: records what the wizard sends. */
async function fakeImportApi(page, { limits = IMPORT_LIMITS, imports = [] } = {}) {
  const sent = { check: [], start: [], batch: [], finish: [], undo: [] };
  await page.route('**/api/leads/search', r => r.fulfill({ json: { success: true, total: 1, leads: [LEAD], capped: false } }));
  await page.route('**/api/imports', r => r.fulfill({ json: { success: true, ready: true, imports, limits, undoDays: 7 } }));
  await page.route('**/api/customer-fields', r => r.fulfill({ json: IMPORT_FIELDS }));
  await page.route('**/api/imports/check', r => {
    const body = r.request().postDataJSON();
    sent.check.push(body);
    return r.fulfill({ json: { success: true, results: body.rows.map((row, i) => ({ row: row.row, phone: `91${String(row.phone).replace(/\D/g, '').slice(-10)}`, kind: i === 1 ? 'existing' : 'new' })), limits,
      warnings: body.rows.some(row => String(row.phone).includes('/')) ? ['1 row has more than one number. Only the first is imported: no room for an "Other numbers" field.'] : [] } });
  });
  // The server answers each new field's saved key (here CIBIL's draft key was taken meanwhile).
  await page.route('**/api/imports/start', r => {
    sent.start.push(r.request().postDataJSON());
    const b = r.request().postDataJSON();
    const keyMap = Object.fromEntries((b.newFields || []).map(f => [f.key, f.key === 'cibil_score' ? 'cibil_score_2' : f.key]));
    return r.fulfill({ json: { success: true, import: { id: IMPORT_ID }, keyMap, limits } }); });
  await page.route(`**/api/imports/${IMPORT_ID}/batch`, r => { const b = r.request().postDataJSON(); sent.batch.push(b); return r.fulfill({ json: { success: true, created: b.rows.length - 1, updated: 1, skipped: 0, rejected: [] } }); });
  await page.route(`**/api/imports/${IMPORT_ID}/finish`, r => { sent.finish.push(r.request().postDataJSON()); return r.fulfill({ json: { success: true, import: { id: IMPORT_ID, status: 'done' } } }); });
  await page.route(`**/api/imports/${IMPORT_ID}/undo`, r => { sent.undo.push(true); return r.fulfill({ json: { success: true, removed: 2, restored: 1, kept: 0 } }); });
  return sent;
}

/** Leads -> Import customers -> choose the file -> map -> options (consent) -> check. */
async function wizardUpTo(page, file) {
  await page.goto('/admin/leads');
  await page.getByRole('button', { name: 'Import customers' }).click();
  const wiz = page.getByTestId('import-wizard');
  await expect(wiz).toBeVisible({ timeout: 20000 });
  await wiz.getByLabel('Customer file').setInputFiles(file);
  return wiz;
}

test('import customers (CSV): map columns (private suggested for CIBIL), consent, dry run, import in parts, rows on Leads', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page, { role: 'owner' });
  const sent = await fakeImportApi(page);
  const csv = 'Mobile,Customer name,CIBIL Score,Branch,Occupation\n9876543210,Asha,742,Guntur,Teacher\n"+91 91234 56789","Bala, Jr",701,Vizag,Farmer\n';
  const wiz = await wizardUpTo(page, { name: 'customers.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(wiz.getByTestId('file-summary')).toContainText('2 customer rows, 5 columns');
  await expect(wiz.getByTestId('import-limits')).toContainText('10,000 rows per upload');
  await wiz.getByRole('button', { name: 'Next: columns' }).click();
  await expect(wiz.getByLabel('Column Mobile')).toHaveValue('phone');
  await expect(wiz.getByLabel('Column Customer name')).toHaveValue('name');
  await expect(wiz.getByLabel('Column Branch')).toHaveValue('field:branch');
  await expect(wiz.getByLabel('Column CIBIL Score')).toHaveValue('new');
  await expect(wiz.getByLabel('Type for CIBIL Score')).toHaveValue('number');
  await expect(wiz.getByLabel('Private CIBIL Score')).toBeChecked();
  await expect(wiz.getByLabel('Private Occupation')).not.toBeChecked();
  await wiz.getByRole('button', { name: 'Next: options' }).click();
  await expect(wiz.getByTestId('run-check')).toBeDisabled();
  await wiz.getByLabel('Import tag').fill('loans-nov');
  await wiz.getByLabel('Consent').check();
  await wiz.getByTestId('run-check').click();
  await expect(wiz.getByTestId('count-new')).toContainText('1');
  await expect(wiz.getByTestId('count-existing')).toContainText('1');
  // The dry run sent mapped rows (not the file) and the new fields; nothing was started.
  expect(sent.check).toHaveLength(1);
  expect(sent.check[0].rows[1]).toEqual({ row: 2, phone: '+91 91234 56789', name: 'Bala, Jr', custom: { cibil_score: '701', branch: 'Vizag', occupation: 'Farmer' } });
  expect(sent.check[0].newFields.map(f => [f.label, f.type, f.private])).toEqual([['CIBIL Score', 'number', true], ['Occupation', 'text', false]]);
  expect(sent.start).toHaveLength(0);
  await wiz.getByTestId('run-import').click();
  await expect(wiz.getByTestId('import-result')).toContainText('1 new · 1 updated');
  await expect(wiz.getByRole('progressbar', { name: 'Done' })).toHaveAttribute('aria-valuenow', '100');
  expect(sent.start[0]).toMatchObject({ fileName: 'customers.csv', fileRows: 2, rowFrom: 1, rowTo: 2, consent: true, options: { mode: 'fill', tag: 'loans-nov' } });
  expect(sent.batch[0].rows).toHaveLength(2);
  // New-field values go to the key the server saved, never the browser's draft key.
  expect(sent.batch[0].rows[0].custom).toEqual({ cibil_score_2: '742', branch: 'Guntur', occupation: 'Teacher' });
  expect(sent.finish[0]).toEqual({ stopped: false });
  await page.screenshot({ path: 'test-results/import-done.png' });
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('lead-row')).toHaveCount(1);

  expect(errors.filter(e => !/404/.test(e))).toEqual([]);
});

test('import customers (Excel .xlsx): read in the browser, numbers kept whole, same mapping', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page, { role: 'manager' });
  const sent = await fakeImportApi(page);
  const buffer = await xlsxFile([['Phone', 'Name', 'Loan amount'], [9876543210, 'Asha', '₹3,00,000'], ['+91 91234 56789', 'Bala', 150000]]);
  await page.goto('/manager/leads');
  await page.getByRole('button', { name: 'Import customers' }).click();
  const wiz = page.getByTestId('import-wizard');
  await wiz.getByLabel('Customer file').setInputFiles({ name: 'loans.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer });
  await expect(wiz.getByTestId('file-summary')).toContainText('loans.xlsx: 2 customer rows, 3 columns', { timeout: 15000 });
  await wiz.getByRole('button', { name: 'Next: columns' }).click();
  await expect(wiz.getByLabel('Type for Loan amount')).toHaveValue('amount');
  await expect(wiz.getByLabel('Private Loan amount')).toBeChecked();
  await wiz.getByRole('button', { name: 'Next: options' }).click();
  await wiz.getByLabel('Consent').check();
  await wiz.getByTestId('run-check').click();
  await expect(wiz.getByTestId('count-new')).toBeVisible();
  expect(sent.check[0].rows.map(r => [r.phone, r.name, r.custom.loan_amount])).toEqual([['9876543210', 'Asha', '₹3,00,000'], ['+91 91234 56789', 'Bala', '150000']]);
  // A file that only pretends to be Excel is refused.
  await wiz.getByRole('button', { name: 'Back' }).click();
  await wiz.getByRole('button', { name: 'Back' }).click();
  await wiz.getByRole('button', { name: 'Back' }).click();
  await wiz.getByLabel('Customer file').setInputFiles({ name: 'fake.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('Phone,Name\n9876543210,A\n') });
  await expect(wiz.getByRole('alert')).toContainText('Choose a .csv or .xlsx file');
  expect(errors.filter(e => !/404/.test(e))).toEqual([]);
});

test('import over the plan\'s rows per file: "Rows 1–3 now", continue from the next row, and Undo from the history', async ({ page }) => {
  await fakeBackend(page, { role: 'owner' });
  const earlier = { id: IMPORT_ID, fileName: 'big.csv', fileRows: 5, rowFrom: 1, rowTo: 3, status: 'done', mode: 'fill', tag: '', created: 2, updated: 1, skipped: 0, rejected: 0, by: 'owner@e2e.test', createdAt: NOW, canUndo: true, undoUntil: NOW, undoResult: null };
  const sent = await fakeImportApi(page, { limits: { ...IMPORT_LIMITS, rowsPerFile: 3 }, imports: [earlier] });
  const csv = `Phone,Name\n${[1, 2, 3, 4, 5].map(i => `987654321${i},Person ${i}`).join('\n')}\n`;
  const wiz = await wizardUpTo(page, { name: 'big.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  const over = wiz.getByTestId('over-file-limit');
  await expect(over).toContainText('Your file has 5 rows; your plan allows 3 per upload. Rows 1–3 now');
  await expect(over).toContainText('Continue from row 4');
  await wiz.getByTestId('continue-from').click();
  await expect(wiz.getByLabel('Start from row')).toHaveValue('4');
  await expect(over).toContainText('Rows 4–5 now');
  await wiz.getByRole('button', { name: 'Next: columns' }).click();
  await wiz.getByRole('button', { name: 'Next: options' }).click();
  await wiz.getByLabel('Consent').check();
  await wiz.getByTestId('run-check').click();
  await expect(wiz.getByTestId('count-new')).toBeVisible();
  expect(sent.check[0].rows.map(r => r.row)).toEqual([4, 5]);
  // History: Undo, after an "Are you sure?".
  await page.getByRole('tab', { name: 'History and undo' }).click();
  const item = page.getByTestId('import-item');
  await expect(item).toContainText('big.csv');
  await expect(item).toContainText('rows 1–3 of 5');
  await item.getByRole('button', { name: 'Undo' }).click();
  await page.getByRole('button', { name: 'Undo import' }).click();
  await expect(page.getByText('Undone: 2 removed, 1 put back')).toBeVisible();
  expect(sent.undo).toHaveLength(1);
});

test('customer details card: an agent sees normal fields read-only and "Hidden" for private ones; the number is never in an address', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page, { role: 'agent' });
  const asked = [];
  await page.route('**/api/customer-details', r => {
    asked.push({ url: r.request().url(), body: r.request().postDataJSON() });
    return r.fulfill({ json: { success: true, canEdit: false, importName: 'loans-nov', fields: [
      { key: 'cibil', label: 'CIBIL score', type: 'number', options: [], private: true, hidden: true, value: null },
      { key: 'loan', label: 'Loan amount', type: 'amount', options: [], private: false, hidden: false, value: 300000 },
      { key: 'branch', label: 'Branch', type: 'text', options: [], private: false, hidden: false, value: 'Guntur' },
    ] } });
  });
  await page.goto('/agent/inbox');
  await page.locator('[data-testid="chat-row"]').first().click({ timeout: 20000 });
  const card = page.getByTestId('customer-details');
  await expect(card).toContainText('Branch');
  await expect(card).toContainText('Guntur');
  await expect(card).toContainText('₹3,00,000');
  await expect(card.getByText('Hidden')).toBeVisible();
  await expect(card).toContainText('Imported · loans-nov');
  await expect(card.getByRole('button', { name: 'Edit customer details' })).toHaveCount(0);
  expect(asked[0].body).toEqual({ phone: LEAD.phone });
  expect(asked.every(a => !a.url.includes(LEAD.phone))).toBe(true);
  // Agents don't get the Settings screen.
  await page.goto('/agent/settings/customer-fields');
  await expect(page.getByTestId('customer-fields')).toHaveCount(0);
  expect(errors.filter(e => !/404/.test(e))).toEqual([]);
});

test('Settings -> Customer fields (managers): list, add a private choice field, the details card edits values', async ({ page }) => {
  await fakeBackend(page, { role: 'manager' });
  const added = [];
  await page.route('**/api/customer-fields', r => {
    if (r.request().method() === 'POST') { added.push(r.request().postDataJSON()); return r.fulfill({ json: { success: true, fields: IMPORT_FIELDS.fields, field: { key: 'loan_type' } } }); }
    return r.fulfill({ json: IMPORT_FIELDS });
  });
  await page.goto('/manager/settings/customer-fields');
  const screen = page.getByTestId('customer-fields');
  await expect(screen.getByTestId('field-row')).toHaveCount(1, { timeout: 20000 });
  await screen.getByPlaceholder('e.g. CIBIL score').fill('Loan type');
  await screen.getByLabel('Type of the new field').selectOption('choice');
  await screen.getByPlaceholder('Home, Car, Personal').fill('Home, Car');
  await screen.getByText('Private: only managers and the Business Admin see it').click();
  await screen.getByRole('button', { name: 'Add', exact: true }).click();
  await expect.poll(() => added.length).toBe(1);
  expect(added[0]).toEqual({ label: 'Loan type', type: 'choice', private: true, options: ['Home', 'Car'] });
  // The card in the chat: a manager edits.
  const saves = [];
  await page.route('**/api/customer-details', r => r.fulfill({ json: { success: true, canEdit: true, fields: [{ key: 'branch', label: 'Branch', type: 'text', options: [], private: false, hidden: false, value: 'Guntur' }] } }));
  await page.route('**/api/customer-details/save', r => { saves.push(r.request().postDataJSON()); return r.fulfill({ json: { success: true, canEdit: true, fields: [{ key: 'branch', label: 'Branch', type: 'text', options: [], private: false, hidden: false, value: 'Vizag' }] } }); });
  await page.goto('/manager/inbox');
  await page.locator('[data-testid="chat-row"]').first().click({ timeout: 20000 });
  const card = page.getByTestId('customer-details');
  await card.getByRole('button', { name: 'Edit customer details' }).click();
  await card.getByLabel('Branch').fill('Vizag');
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(card).toContainText('Vizag');
  expect(saves[0]).toEqual({ phone: LEAD.phone, values: { branch: 'Vizag' } });
});

test('import dry run: a cell with two numbers shows the "only the first is imported" warning', async ({ page }) => {
  await fakeBackend(page, { role: 'owner' });
  await fakeImportApi(page);
  const wiz = await wizardUpTo(page, { name: 'two.csv', mimeType: 'text/csv', buffer: Buffer.from('Phone,Name\n9876543210 / 9123456789,Asha\n') });
  await wiz.getByRole('button', { name: 'Next: columns' }).click();
  await wiz.getByRole('button', { name: 'Next: options' }).click();
  await wiz.getByLabel('Consent').check();
  await wiz.getByTestId('run-check').click();
  await expect(wiz.getByTestId('check-warning')).toContainText('Only the first is imported');
});

// ---------------------------------------------------------------------------
// Customer import D3 + D4: the "Imported customer" badge, customer-field filters, broadcast audiences, export by role.
// ---------------------------------------------------------------------------
const D4_FIELDS = { success: true, ready: true, canEdit: true, max: 25, types: IMPORT_FIELDS.types, fields: [
  { key: 'cibil', label: 'CIBIL score', type: 'number', options: [], private: true, hidden: false, sort_order: 1 },
  { key: 'loan_type', label: 'Loan type', type: 'choice', options: ['Home', 'Car'], private: false, hidden: false, sort_order: 2 },
] };

test('D3 badge: an imported person shows "Imported customer · <tag>" in the Inbox list and the chat header', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page, { role: 'agent' });
  const imported = { ...LEAD, import_id: 'f0000000-0000-4000-8000-000000000002', import_name: 'loans-nov', imported_at: NOW };
  await page.route(/\/api\/inbox\?/, r => r.fulfill({ json: { conversations: [imported] } }));
  await page.route(`**/api/inbox/${LEAD.phone}`, r => r.fulfill({ json: { contact: imported, messages: [{ id: 1, direction: 'inbound', body: 'Hi, about my loan', timestamp: NOW }], notes: [{ id: 1, author: 'import', body: 'First message after import (loans-nov).', created_at: NOW }] } }));
  await page.goto('/agent/inbox');
  const row = page.locator('[data-testid="chat-row"]').first();
  await expect(row.getByTestId('imported-badge')).toHaveText('Imported customer · loans-nov', { timeout: 20000 });
  await row.click();
  await expect(page.getByTestId('chat-header').getByTestId('imported-badge')).toHaveText('Imported customer · loans-nov');
  await expect(page.getByText('First message after import (loans-nov).')).toBeVisible();
  expect(errors.filter(e => !/404/.test(e))).toEqual([]);
});

test('D4 Leads: filter by a customer field (sent in the POST body, never the address)', async ({ page }) => {
  await fakeBackend(page, { role: 'manager' });
  await page.route('**/api/customer-fields', r => r.fulfill({ json: D4_FIELDS }));
  const bodies = [];
  await page.route('**/api/leads/search', r => { bodies.push(r.request().postDataJSON()); return r.fulfill({ json: { success: true, total: 1, leads: [LEAD], capped: false } }); });
  await page.goto('/manager/leads');
  const filters = page.getByTestId('custom-filters');
  await filters.getByLabel('Filter by a customer field').selectOption('cibil', { timeout: 20000 });
  await filters.getByLabel('CIBIL score at least').fill('750');
  await filters.getByLabel('Filter by a customer field').selectOption('loan_type');
  await filters.getByLabel('Loan type is').selectOption('Home');
  await expect.poll(() => JSON.stringify(bodies.at(-1)?.filters?.custom)).toBe(JSON.stringify([{ key: 'cibil', min: '750' }, { key: 'loan_type', values: ['Home'] }]));
  expect(page.url()).not.toContain('750');
});

test('D4 broadcast audience by customer fields: a live count from the server', async ({ page }) => {
  await fakeBackend(page, { role: 'owner' });
  await page.route('**/api/customer-fields', r => r.fulfill({ json: D4_FIELDS }));
  const segments = [];
  await page.route('**/api/audience/preview', r => {
    const seg = r.request().postDataJSON().segment;
    segments.push(seg);
    const filtered = (seg.custom || []).length > 0;
    return r.fulfill({ json: { count: filtered ? 12 : 40, optedOutExcluded: filtered ? 1 : 3, notInContacts: 0, sample: [] } });
  });
  await page.goto('/admin/broadcasts');
  await page.getByRole('button', { name: 'New broadcast' }).click({ timeout: 20000 });
  await page.getByPlaceholder('Weekend offer – Nov').fill('Home loan offer');
  await page.locator('select').filter({ hasText: 'diwali_offer' }).selectOption('diwali_offer|en');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByTestId('audience-count')).toHaveText('40');
  const filters = page.getByTestId('custom-filters');
  await filters.getByLabel('Filter by a customer field').selectOption('loan_type');
  await filters.getByLabel('Loan type is').selectOption('Home');
  await expect(page.getByTestId('audience-count')).toHaveText('12');
  expect(segments.at(-1).custom).toEqual([{ key: 'loan_type', values: ['Home'] }]);
});

test('D4 export by role: managers can\'t include private fields; the Business Admin can tick them', async ({ page }) => {
  await fakeBackend(page, { role: 'manager' });
  await page.route('**/api/leads/search', r => r.fulfill({ json: { success: true, total: 1, leads: [LEAD], capped: false } }));
  const asked = [];
  await page.route('**/api/leads/export', r => { asked.push(r.request().postDataJSON()); return r.fulfill({ status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'X-Lead-Count': '1' }, body: '﻿Phone\r\n' }); });
  await page.goto('/manager/leads');
  await page.getByRole('button', { name: /Export CSV/ }).click({ timeout: 20000 });
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByText('Private customer fields are left out')).toBeVisible();
  await expect(dlg.getByLabel('Include private fields')).toHaveCount(0);
  await dlg.getByTestId('export-go').click();
  await expect.poll(() => asked.length).toBe(1);
  expect([asked[0].customFields, asked[0].includePrivate]).toEqual([true, false]);
  // The Business Admin.
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await fakeBackend(page, { role: 'owner' });
  await page.route('**/api/leads/search', r => r.fulfill({ json: { success: true, total: 1, leads: [LEAD], capped: false } }));
  await page.route('**/api/leads/export', r => { asked.push(r.request().postDataJSON()); return r.fulfill({ status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'X-Lead-Count': '1' }, body: '﻿Phone\r\n' }); });
  await page.goto('/admin/leads');
  await page.getByRole('button', { name: /Export CSV/ }).click({ timeout: 20000 });
  await page.getByRole('dialog').getByLabel('Include private fields').check();
  await page.getByRole('dialog').getByTestId('export-go').click();
  await expect.poll(() => asked.length).toBe(2);
  expect(asked[1].includePrivate).toBe(true);
});

// ---- Second review of D3 + D4: stored field filters never trap the Inbox; hidden fields never filter unseen ----
const REVIEW_FIELDS = (over = {}) => ({ success: true, ready: true, canEdit: false, max: 25, types: IMPORT_FIELDS.types, fields: [
  { key: 'loan_type', label: 'Loan type', type: 'choice', options: ['Home', 'Car'], private: false, hidden: false, sort_order: 1, ...over },
] });

test('Inbox: a stored field filter for a field that became private is dropped, not sent (no dead end)', async ({ page }) => {
  const errors = watchErrors(page);
  await page.addInitScript((email) => localStorage.setItem(`inbox-custom-filters:${email}`, JSON.stringify({ list: [{ key: 'loan_type', values: ['Home'] }] })), ME.email);
  await fakeBackend(page, { role: 'agent' });
  // The manager made "Loan type" private: an agent's field list no longer offers it.
  await page.route('**/api/customer-fields', r => r.fulfill({ json: REVIEW_FIELDS({ private: true }) }));
  let posted = 0;
  await page.route('**/api/inbox/list', r => { posted++; return r.fulfill({ status: 403, json: { success: false, error: 'Only managers and the Business Admin can filter by private fields.' } }); });
  await page.goto('/agent/inbox');
  await expect(page.locator('[data-testid="chat-row"]')).toHaveCount(1, { timeout: 20000 });
  await expect(page.getByTestId('load-error')).toHaveCount(0);
  expect(posted).toBe(0);
  await expect.poll(() => page.evaluate((email) => localStorage.getItem(`inbox-custom-filters:${email}`), ME.email)).toBe(JSON.stringify({ list: [] }));
  expect(errors.filter(e => !/404/.test(e))).toEqual([]);
});

test('Inbox: field filters go in a POST body; a 403 clears them once (with a note) and the list comes back; "Clear field filters" works', async ({ page }) => {
  await page.addInitScript((email) => localStorage.setItem(`inbox-custom-filters:${email}`, JSON.stringify({ list: [{ key: 'loan_type', values: ['Home'] }] })), ME.email);
  await fakeBackend(page, { role: 'agent' });
  await page.route('**/api/customer-fields', r => r.fulfill({ json: REVIEW_FIELDS() }));
  const bodies = [];
  const getUrls = [];
  await page.route(/\/api\/inbox\?/, r => { getUrls.push(r.request().url()); return r.fallback(); });
  await page.route('**/api/inbox/list', r => { bodies.push(r.request().postDataJSON()); return r.fulfill({ status: 403, json: { success: false, error: 'Only managers and the Business Admin can filter by private fields.' } }); });
  await page.goto('/agent/inbox');
  await expect.poll(() => bodies.length, { timeout: 20000 }).toBeGreaterThan(0);
  expect(bodies[0].custom).toEqual([{ key: 'loan_type', values: ['Home'] }]);
  expect(getUrls.every(u => !u.includes('custom'))).toBe(true);
  await expect(page.getByText('Your customer-field filters were cleared')).toBeVisible();
  await expect(page.locator('[data-testid="chat-row"]')).toHaveCount(1);
  // Clear field filters: set one by hand, then clear it.
  await page.unroute('**/api/inbox/list');
  await page.route('**/api/inbox/list', r => r.fulfill({ json: { conversations: [LEAD] } }));
  await page.getByRole('button', { name: /^Filters/ }).click();
  const panel = page.getByTestId('custom-filters');
  await panel.getByLabel('Filter by a customer field').selectOption('loan_type');
  await panel.getByLabel('Loan type is').selectOption('Car');
  await expect(panel.getByTestId('custom-filter')).toHaveCount(1);
  await panel.getByTestId('clear-custom-filters').click();
  await expect(panel.getByTestId('custom-filter')).toHaveCount(0);
});

test('Leads: a stored filter on a field that became hidden is dropped, never sent unseen', async ({ page }) => {
  await page.addInitScript((email) => localStorage.setItem(`leads-filters:${email}`, JSON.stringify({ custom: [{ key: 'loan_type', values: ['Home'] }] })), ME.email);
  await fakeBackend(page, { role: 'manager' });
  await page.route('**/api/customer-fields', r => r.fulfill({ json: { ...REVIEW_FIELDS({ hidden: true }), canEdit: true } }));
  const bodies = [];
  await page.route('**/api/leads/search', r => { bodies.push(r.request().postDataJSON()); return r.fulfill({ json: { success: true, total: 1, leads: [LEAD], capped: false } }); });
  await page.goto('/manager/leads');
  await expect(page.getByTestId('lead-row')).toHaveCount(1, { timeout: 20000 });
  expect(bodies.length).toBeGreaterThan(0);
  expect(bodies.every(b => !b.filters.custom)).toBe(true);
  await expect(page.getByTestId('custom-filter')).toHaveCount(0);
});

// ---- Activity log (docs/progress/activity-log.md): the Business Admin's screen, the Security tab, CSV; managers refused ----
const ACTIVITY_PAGE = { success: true, nextBeforeId: null, areas: { team: 'Team', chats: 'Chats', leads: 'Leads', broadcasts: 'Broadcasts', ads: 'Ads', clinic: 'Clinic', security: 'Security', settings: 'Settings' }, entries: [
  { id: 3, at: NOW, action: 'chat.transferred', area: 'chats', actor: 'priya@e2e.test', person: 'Priya', sentence: 'Priya (manager) transferred the chat with Ravi Kumar to Arjun' },
  { id: 2, at: NOW, action: 'team.role_changed', area: 'team', actor: 'owner@e2e.test', person: 'owner', sentence: "You changed Arjun's role from agent to manager" },
] };
const SIGNINS_PAGE = { ...ACTIVITY_PAGE, entries: [
  { id: 9, at: NOW, action: 'auth.signed_in', area: 'security', actor: 'agent@e2e.test', person: 'Arjun', sentence: 'Arjun (agent) signed in from a new device', security: { device: 'Chrome on Android', network: '49.37.12.x', newDevice: true } },
] };

test('Activity log (Business Admin): sentences, filters sent to the server, the Security tab and a CSV download', async ({ page }) => {
  const errors = watchErrors(page);
  await fakeBackend(page, { role: 'owner' });
  const asked = [];
  const urls = [];
  // Filters go in the request body (POST), never in the address.
  await page.route('**/api/activity/list', r => {
    urls.push(r.request().url());
    const body = r.request().postDataJSON() || {};
    asked.push(body);
    return r.fulfill({ json: body.tab === 'security' ? SIGNINS_PAGE : ACTIVITY_PAGE });
  });
  let exported = null;
  await page.route('**/api/activity/export', r => { urls.push(r.request().url()); exported = r.request().postDataJSON(); return r.fulfill({ status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="activity-2026-11-15.csv"', 'X-Entry-Count': '2', 'X-Entry-Capped': '0' }, body: '\uFEFFTime (India),Person,Area,What happened\r\n' }); });
  // Opening the app with a saved session (or coming back to the tab) is not a new sign-in.
  let signIns = 0;
  await page.route('**/api/auth/signed-in', r => { signIns++; return r.fulfill({ json: { success: true } }); });
  await page.goto('/admin/settings/activity');
  const screen = page.getByTestId('activity-log');
  await expect(screen.getByTestId('activity-row')).toHaveCount(2, { timeout: 20000 });
  await expect(screen.getByTestId('activity-row').first()).toContainText('Priya (manager) transferred the chat with Ravi Kumar to Arjun');
  await expect(screen).not.toContainText('919000000');
  await screen.getByLabel('Area').selectOption('chats');
  await expect.poll(() => asked.at(-1)?.area).toBe('chats');
  await screen.getByLabel('Search the activity').fill('ravi');
  await expect.poll(() => asked.at(-1)?.q).toBe('ravi');
  // CSV.
  const download = page.waitForEvent('download');
  await screen.getByTestId('activity-download').click();
  expect((await download).suggestedFilename()).toBe('activity-2026-11-15.csv');
  expect(exported).toMatchObject({ area: 'chats', q: 'ravi' });
  expect(urls.every(u => !u.includes('?'))).toBe(true);
  // Security tab: sign-ins with device, approximate network and the new-device flag.
  await screen.getByRole('tab', { name: /Security/ }).click();
  const row = screen.getByTestId('signin-row');
  await expect(row).toContainText('Chrome on Android');
  await expect(row).toContainText('49.37.12.x');
  await expect(row.getByTestId('new-device')).toBeVisible();
  await expect.poll(() => asked.at(-1)?.tab).toBe('security');
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(300);
  expect(signIns).toBe(0);
  expect(errors.filter(e => !/404/.test(e))).toEqual([]);
});

test('Activity log: managers don\'t see it in the menu and the address shows "not allowed"', async ({ page }) => {
  await fakeBackend(page, { role: 'manager' });
  let asked = 0;
  await page.route(/\/api\/activity/, r => { asked++; return r.fulfill({ status: 403, json: { success: false, error: 'Only the Business Admin can see the activity log.' } }); });
  await page.goto('/manager/settings/activity');
  await expect(page.getByTestId('no-access')).toContainText('This page is for the Business Admin.', { timeout: 20000 });
  await expect(page.getByRole('navigation', { name: 'Main menu' }).getByRole('link', { name: 'Activity log' })).toHaveCount(0);
  expect(asked).toBe(0);
});
