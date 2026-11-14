// @ts-check
// Ads phase D: creating Click-to-WhatsApp ads from the CRM. D1 (this file so far): the "ready to create
// ads" check, choosing the Facebook Page, and the Business Admin's daily budget cap. Read-only towards
// Meta: nothing here creates or changes anything in the ad account.
//
// What Meta needs to create a Click-to-WhatsApp ad (docs checked 2026-11-10):
//   * a token that can create ads (ads_management) and advertise for a Page (pages_manage_ads,
//     pages_read_engagement, pages_show_list)
//   * a Facebook Page the ad account can promote, linked to the business's WhatsApp number
//   * an active ad account (and a daily budget at least Meta's minimum for it)
const { dbRequest } = require('./db.cjs');
const { requireBusinessId } = require('./tenant.cjs');
const ads = require('./ads.cjs');

/** @typedef {import('./types.cjs').Staff} Staff */
/** @typedef {Record<string, any>} Row */
/** @typedef {{ key: string, ok: boolean | null, label: string, detail: string, fix?: string[], link?: { href: string, text: string } }} Check */

const NEEDED_PERMISSIONS = ['ads_management', 'pages_manage_ads', 'pages_read_engagement', 'pages_show_list'];
const PAGE_ID_RE = /^\d{5,25}$/;
const DEFAULT_CAP = 2000;
const MAX_CAP = 1000000;
/** @param {unknown} v */
const digits = (v) => String(v || '').replace(/\D/g, '');

/** The business's main WhatsApp number (digits), as connected in the CRM. @param {string} biz */
async function businessNumber(biz) {
  const wa = await require('./whatsapp.cjs').getWhatsApp(biz);
  return digits(wa?.phoneNumber);
}

/** Every WhatsApp number of the business (main first): digits + the name staff gave it. @param {string} biz */
async function businessNumbers(biz) {
  const list = await require('./whatsapp.cjs').listNumbers(biz);
  return list.map(n => ({ phone: digits(n.phoneNumber), label: n.label || (n.main ? 'Main number' : ''), main: n.main })).filter(n => n.phone);
}

/**
 * Pure: which of the business's numbers a Page's linked WhatsApp number is (null if none). A click-to-WhatsApp
 * ad opens a chat with the number linked to the Page, so this is "the number the ad opens".
 * @param {string | null | undefined} pageWhatsApp @param {Array<{ phone: string, label: string, main: boolean }>} numbers
 */
function matchNumber(pageWhatsApp, numbers) {
  const pageWa = digits(pageWhatsApp);
  if (!pageWa) return null;
  return numbers.find(n => n.phone && pageWa.endsWith(n.phone.slice(-10))) || null;
}

/**
 * Pure: turn what Meta answered into the checklist the Ads page shows (tested).
 * @param {{ permissions: string[] | null, accountStatus: number | null, minDailyBudget: number | null, pages: Array<{ id: string, name: string }> | null, pagesError?: string | null,
 *   selectedPageId: string | null, pageWhatsApp: string | null | undefined, businessNumber: string, currency: string,
 *   numbers?: Array<{ phone: string, label: string, main: boolean }> }} s
 *   numbers: all the business's numbers (several numbers per business); the Page may be linked to any of them.
 * @returns {Check[]}
 */
function buildChecklist(s) {
  const missing = s.permissions ? NEEDED_PERMISSIONS.filter(p => !s.permissions?.includes(p)) : NEEDED_PERMISSIONS;
  const selected = (s.pages || []).find(p => p.id === s.selectedPageId) || null;
  /** @type {Check[]} */
  const list = [];
  list.push({
    key: 'account', ok: s.accountStatus === 1, label: 'Ad account is active',
    detail: s.accountStatus === 1 ? 'Meta says the ad account can run ads.' : s.accountStatus === null ? 'Could not read the ad account from Meta.' : `Meta says the ad account is not active (status ${s.accountStatus}).`,
    fix: s.accountStatus === 1 ? undefined : ['Open Meta Ads Manager and check the account (payment method, restrictions).'],
    link: s.accountStatus === 1 ? undefined : { href: 'https://adsmanager.facebook.com/adsmanager/', text: 'Ads Manager' },
  });
  list.push({
    key: 'permissions', ok: missing.length === 0, label: 'Token can create ads for a Page',
    detail: missing.length === 0 ? 'The saved token has every permission needed.' : `The saved token is missing: ${missing.join(', ')}.`,
    fix: missing.length === 0 ? undefined : [
      'Meta Business Settings -> Users -> System users -> the system user you used for this ad account.',
      'Generate new token for your app, and tick: ads_management, ads_read, business_management, pages_manage_ads, pages_read_engagement, pages_show_list.',
      'Paste it on this page under "Change token" (same ad account ID).',
    ],
    link: missing.length === 0 ? undefined : { href: 'https://business.facebook.com/settings/system-users', text: 'System users' },
  });
  const pagesFound = (s.pages || []).length > 0;
  list.push({
    key: 'page', ok: pagesFound && !!selected, label: 'Facebook Page to advertise as',
    detail: !pagesFound
      ? `Meta shows no Facebook Page this ad account can advertise for.${s.pagesError ? ` Meta says: ${s.pagesError}` : ''}`
      : selected ? `Ads will run as "${selected.name}".` : 'Choose the Page below.',
    fix: pagesFound ? undefined : [
      'Meta Business Settings -> Users -> System users -> the same system user -> Assign assets -> Pages -> your business Page, with permission to create ads.',
      'Then generate a new token (step above) and paste it here.',
    ],
    link: pagesFound ? undefined : { href: 'https://business.facebook.com/settings/system-users', text: 'Assign the Page' },
  });
  const pageWa = digits(s.pageWhatsApp);
  const all = s.numbers && s.numbers.length ? s.numbers : (s.businessNumber ? [{ phone: s.businessNumber, label: '', main: true }] : []);
  const match = selected ? matchNumber(pageWa, all) : null;
  const linked = !!match;
  const several = all.length > 1;
  const ours = several ? all.map(n => `+${n.phone}${n.label ? ` (${n.label})` : ''}`).join(', ') : `+${s.businessNumber}`;
  // Meta's Page field only reports ONE number (the Page's primary, and sometimes nothing at all). A Page can have
  // up to 50 numbers linked ("Connect multiple WhatsApp numbers"), and an ad may open any of them: the ad set names
  // the number and Meta checks the link when the ad is created. So "no match" is a warning, not a block.
  list.push({
    key: 'whatsapp', ok: !selected ? false : linked ? true : null,
    label: several ? 'Page is linked to one of your WhatsApp numbers' : 'Page is linked to your WhatsApp number',
    detail: !selected ? 'Choose a Page first.'
      : s.pageWhatsApp === undefined ? 'Meta did not say which WhatsApp number the Page is linked to. Meta checks it when the ad is created.'
        : linked ? `Linked to +${pageWa}${several && match?.label ? ` (${match.label})` : ''}.${several ? ' Your ads open a chat with this number.' : ''}`
          : pageWa ? `Meta reports the Page's primary WhatsApp number as +${pageWa}, which isn't ${several ? 'one of this business\'s numbers' : `this business's number (${ours})`}. If ${several ? 'yours is' : 'it is'} also linked to the Page as an extra number, ads can still open it; Meta confirms when the ad is created.`
            : `Meta didn't report a WhatsApp number for this Page. If ${ours} is linked under the Page's Linked accounts -> WhatsApp, you can go ahead; Meta confirms when the ad is created.`,
    fix: linked || !selected ? undefined : [
      'On Facebook, open the Page -> Settings -> Linked accounts -> WhatsApp.',
      `Check that ${several ? 'the number your ads should open' : 'the business number'} is in the list: ${ours}. If not, add it with "Connect another number" (WhatsApp sends a code to confirm).`,
      'Optional: press "Set as Primary" on it, so this check turns green.',
    ],
    link: linked || !selected ? undefined : { href: 'https://www.facebook.com/settings/?tab=linked_whatsapp', text: 'Page linked accounts' },
  });
  list.push({
    key: 'budget', ok: s.minDailyBudget !== null, label: 'Minimum daily budget',
    detail: s.minDailyBudget !== null ? `Meta's minimum for this account is ${s.currency} ${s.minDailyBudget} per day.` : 'Could not read Meta\'s minimum daily budget.',
  });
  return list;
}

/**
 * The Pages this ad account can advertise as. Meta's `promote_pages` is often empty for a system-user token even
 * when the system user has the Page with full access, so we also read the Pages assigned to the token's user
 * (`me/accounts`) and keep those it may advertise for (task ADVERTISE). Meta still checks when the ad is created.
 * @param {string} version @param {string} token @param {string} adAccountId
 * @returns {Promise<{ pages: Array<{ id: string, name: string }>, error: string | null }>}
 */
async function adPages(version, token, adAccountId) {
  const [promote, mine] = await Promise.all([
    ads.graph(version, token, `${adAccountId}/promote_pages?fields=id,name&limit=50`),
    ads.graph(version, token, 'me/accounts?fields=id,name,tasks&limit=100'),
  ]);
  /** @type {Map<string, { id: string, name: string }>} */
  const found = new Map();
  for (const p of promote.error ? [] : promote.data || []) found.set(String(p.id), { id: String(p.id), name: String(p.name || p.id) });
  for (const p of mine.error ? [] : mine.data || []) {
    const tasks = Array.isArray(p.tasks) ? p.tasks : null;
    if (tasks && !tasks.includes('ADVERTISE')) continue;
    if (!found.has(String(p.id))) found.set(String(p.id), { id: String(p.id), name: String(p.name || p.id) });
  }
  const pages = [...found.values()];
  const error = pages.length ? null : (promote.error || mine.error) ? ads.metaMsg(promote.error ? promote : mine) : null;
  return { pages, error };
}

/**
 * The "ready to create ads" check (Business Admin and managers can see it).
 * @param {Staff} staff
 */
async function readiness(staff) {
  const ctx = await ads.controlContext(staff?.businessId);
  if (ctx.error !== undefined) return { error: ctx.error };
  const { row, token, version } = ctx;
  const [perms, acct, pagesRes, number, numbers] = await Promise.all([
    ads.graph(version, token, 'me/permissions'),
    ads.graph(version, token, `${row.ad_account_id}?fields=account_status,min_daily_budget,currency`),
    adPages(version, token, row.ad_account_id),
    businessNumber(ctx.id),
    businessNumbers(ctx.id),
  ]);
  const permissions = perms.error ? null : (perms.data || []).filter((/** @type {Row} */ p) => p.status === 'granted').map((/** @type {Row} */ p) => p.permission);
  const { pages, error: pagesError } = pagesRes;
  const currency = acct.currency || row.currency || 'INR';
  const factor = ads.minorFactor(currency);
  // The chosen Page, or the only one when there is exactly one.
  const selectedPageId = pages.some((/** @type {{ id: string }} */ p) => p.id === row.page_id) ? row.page_id : pages.length === 1 ? pages[0].id : null;
  /** @type {string | null | undefined} undefined = Meta didn't say */
  let pageWhatsApp;
  if (selectedPageId) {
    const page = await ads.graph(version, token, `${selectedPageId}?fields=whatsapp_number`);
    // Meta leaves the field out when no number is linked; an error means we couldn't tell.
    pageWhatsApp = page.error ? undefined : page.whatsapp_number || null;
  }
  if (selectedPageId && selectedPageId !== row.page_id) {
    const name = pages.find((/** @type {{ id: string }} */ p) => p.id === selectedPageId)?.name || null;
    await dbRequest(`business_ad_accounts?business_id=eq.${ctx.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { page_id: selectedPageId, page_name: name } });
  }
  const minDailyBudget = Number.isFinite(Number(acct.min_daily_budget)) && acct.min_daily_budget !== undefined ? Math.ceil(Number(acct.min_daily_budget) / factor) : null;
  const checks = buildChecklist({
    permissions, accountStatus: acct.error ? null : Number(acct.account_status), minDailyBudget, pages, pagesError,
    selectedPageId, pageWhatsApp, businessNumber: number, currency, numbers,
  });
  const opens = matchNumber(pageWhatsApp, numbers);
  return {
    ready: checks.every(c => c.ok !== false),
    checks,
    pages,
    selectedPageId,
    currency,
    minDailyBudget,
    maxDailyBudget: Number(row.max_daily_budget) || DEFAULT_CAP,
    businessNumber: opens?.phone || number,
    // The number the ads open (the one linked to the Page), when the business has several.
    adNumber: numbers.length > 1 && opens ? { phone: opens.phone, label: opens.label } : null,
    // E2: every number, for "Opens a chat with" in the wizard (linked = the Page's own number).
    numbers: (await require('./whatsapp.cjs').listNumbers(ctx.id)).map(n => ({
      id: n.id, label: n.label || (n.main ? 'Main number' : ''), phone: digits(n.phoneNumber), main: n.main,
      linked: !!opens && digits(n.phoneNumber) === opens.phone,
    })),
    // E3: Meta doesn't allow WhatsApp Status ads for healthcare / pharma businesses.
    statusAllowed: !(await isHealthcare(ctx.id)),
    // F2: the Instagram account the ads show as on Instagram (null = they show as the Facebook Page).
    instagram: selectedPageId ? await instagramOf(version, token, selectedPageId) : null,
    // G1: the business's own hours (its follow-up send window), the default for "only in business hours".
    businessHours: await require('./business.cjs').sendWindowFor(ctx.id),
    timezone: row.timezone_name || null,
  };
}

/** Business Admin: advertise as this Page (must be one the ad account can promote). @param {Staff} staff @param {unknown} pageId */
async function choosePage(staff, pageId) {
  const ctx = await ads.controlContext(staff?.businessId);
  if (ctx.error !== undefined) return { error: ctx.error };
  if (!PAGE_ID_RE.test(String(pageId || ''))) return { error: 'Invalid Page.' };
  const { pages } = await adPages(ctx.version, ctx.token, ctx.row.ad_account_id);
  const page = pages.find(p => p.id === String(pageId));
  if (!page) return { error: 'This ad account cannot advertise for that Page.' };
  const res = await dbRequest(`business_ad_accounts?business_id=eq.${ctx.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { page_id: String(page.id), page_name: String(page.name || '') } });
  if (!res.ok) return { error: 'Could not save. Has the Ads D1 SQL (20261120) been run?' };
  await ads.audit(staff, ctx.id, 'ads.page_chosen', { pageId: String(page.id), pageName: page.name || null });
  return { pageId: String(page.id), pageName: String(page.name || '') };
}

/** Business Admin: the most one ad may spend per day (in the account's currency). @param {Staff} staff @param {unknown} amount */
async function setBudgetCap(staff, amount) {
  const biz = requireBusinessId(staff?.businessId);
  const n = Math.round(Number(amount) * 100) / 100;
  if (!Number.isFinite(n) || n <= 0 || n > MAX_CAP) return { error: `Enter an amount between 1 and ${MAX_CAP.toLocaleString('en-IN')}.` };
  const res = await dbRequest(`business_ad_accounts?business_id=eq.${biz}`, { method: 'PATCH', prefer: 'return=representation', body: { max_daily_budget: n } });
  if (!res.ok) return { error: 'Could not save. Has the Ads D1 SQL (20261120) been run?' };
  if (!res.data?.length) return { error: 'No ad account is connected.' };
  await ads.audit(staff, biz, 'ads.budget_cap_set', { maxDailyBudget: n });
  return { maxDailyBudget: n };
}

// ===========================================================================
// D2: the wizard. Create the ad PAUSED (campaign -> ad set -> creative -> ad), then a separate Launch.
// ===========================================================================

const LIMITS = { name: 80, text: 1000, headline: 40, greeting: 160, locations: 10 };
const WHATSAPP_LINK = 'https://api.whatsapp.com/send';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMAGE_HASH_RE = /^[0-9a-f]{16,64}$/i;
const LOCATION_TYPES = ['city', 'region', 'zip', 'country'];
const MAX_IMAGE_BYTES = 1024 * 1024; // the browser resizes to <= 1 MB (Netlify's request limit is 6 MB)
// E3 placements: 'auto' = Meta decides (Advantage+ placements, the default); 'feeds_stories' = Facebook +
// Instagram feeds, Stories and Reels; 'with_status' = that + WhatsApp Status (Meta: Status needs Instagram
// Stories too, and is not allowed for healthcare / pharma advertisers).
const PLACEMENTS = ['auto', 'feeds_stories', 'with_status'];
const MAX_CARDS = 10; // E4 carousel
// Phase H: quick questions (ice breakers), a tall picture for Stories / Status, video, interests / excluded places / languages.
const MAX_ICE_BREAKERS = 4;
const ICE_BREAKER_MAX = 80;
const MAX_INTERESTS = 10;
const MAX_EXCLUDED = 10;
const MAX_LANGUAGES = 5;
const VIDEO_BUCKET = 'ad-videos';
const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // Supabase's per-file limit on the free plan
const VIDEO_TYPES = ['video/mp4', 'video/quicktime'];
// Phase I: more ads in one campaign (same audience and budget, or a new audience), and existing posts as ads.
const MAX_ADS_PER_CAMPAIGN = 10;
const FB_POST_RE = /^\d{5,25}_\d{5,25}$/;   // Page post: <page id>_<post id>
const IG_MEDIA_RE = /^\d{5,30}$/;
const POST_SOURCES = ['facebook', 'instagram'];
/** The ad-set settings an added ad shares with the ad it was added to ("same audience and budget"). */
const ADSET_KEYS = ['locations', 'ageMin', 'ageMax', 'gender', 'placement', 'startDate', 'endDate', 'schedule', 'interests', 'excludedLocations', 'languages'];

/**
 * Pure: a clean existing post { source, id, caption, pictureUrl, permalink, igEligible } or { error } (tested).
 * The words and picture are the post's own; the CRM only keeps a copy to show in its lists.
 * @param {unknown} input @param {string | null} [pageId]  for a Facebook post: it must be this Page's
 * @returns {{ error: string } | { post: Row }}
 */
function checkPost(input, pageId = null) {
  const p = /** @type {Row} */ (input && typeof input === 'object' ? input : {});
  const source = String(p.source || '');
  const id = String(p.id || '');
  if (!POST_SOURCES.includes(source)) return { error: 'Choose a Facebook or Instagram post.' };
  if (source === 'facebook' && (!FB_POST_RE.test(id) || (pageId && !id.startsWith(`${pageId}_`)))) return { error: 'That Facebook post is not one of this Page\'s posts. Choose it again.' };
  if (source === 'instagram' && !IG_MEDIA_RE.test(id)) return { error: 'That Instagram post is not valid. Choose it again.' };
  const https = (/** @type {unknown} */ v, /** @type {number} */ n) => (/^https:\/\//.test(String(v || '')) ? String(v).slice(0, n) : '');
  return {
    post: {
      source, id, caption: String(p.caption || '').slice(0, 2200), pictureUrl: https(p.pictureUrl, 1000), permalink: https(p.permalink, 500),
      igEligible: p.igEligible === true,
    },
  };
}

/**
 * Pure: Meta's answers -> the post picker's list (tested). Posts Meta says can't be promoted are kept, marked, with
 * the reason, so the Business Admin sees why.
 * @param {'facebook' | 'instagram'} source @param {Row[]} data
 */
function postsOf(source, data) {
  const https = (/** @type {unknown} */ v) => (/^https:\/\//.test(String(v || '')) ? String(v).slice(0, 1000) : '');
  return (Array.isArray(data) ? data : []).filter(Boolean).map((/** @type {Row} */ m) => {
    if (source === 'instagram') {
      const info = m.boost_eligibility_info && typeof m.boost_eligibility_info === 'object' ? m.boost_eligibility_info : null;
      const eligible = info ? info.eligible_to_boost !== false : true;
      return {
        source, id: String(m.id), caption: String(m.caption || '').slice(0, 2200), kind: String(m.media_type || ''),
        pictureUrl: https(m.media_type === 'VIDEO' ? m.thumbnail_url : m.media_url || m.thumbnail_url), permalink: https(m.permalink),
        createdAt: String(m.timestamp || ''), eligible, reason: eligible ? '' : String(info?.boost_ineligible_reason || 'Meta says this post can\'t be used as an ad.').slice(0, 200), igEligible: true,
      };
    }
    const eligible = m.is_eligible_for_promotion !== false;
    return {
      source, id: String(m.id), caption: String(m.message || '').slice(0, 2200), kind: '',
      pictureUrl: https(m.full_picture), permalink: https(m.permalink_url), createdAt: String(m.created_time || ''),
      eligible, reason: eligible ? '' : 'Meta says this post can\'t be promoted (e.g. a shared post or one with restricted content).', igEligible: m.is_instagram_eligible === true,
    };
  }).filter(p => (source === 'instagram' ? IG_MEDIA_RE : FB_POST_RE).test(p.id));
}

// Never in ads created here (same rule as AI/bot text): cure / guarantee claims, miracle results.
const BLOCKED = [
  [/\b(cure[sd]?|curing)\b/i, 'Don\'t promise a cure ("cure", "cures").'],
  [/\bguarantee[sd]?\b|\b100\s?%\s*(result|cure|success|guarantee|safe)/i, 'Don\'t guarantee results.'],
  [/\b(miracle|magic)\b/i, 'Avoid "miracle" / "magic" claims.'],
  [/\breverse[sd]?\s+(your\s+)?(diabetes|pcos|pcod|thyroid|bp|blood\s?pressure|ageing|aging|cancer)/i, 'Don\'t claim to reverse a disease.'],
  [/\bno\s+side[\s-]effects?\b/i, 'Don\'t claim "no side effects".'],
  [/\blose\s+\d+\s*(kg|kgs|kilos?)\b/i, 'Don\'t promise a specific weight loss.'],
  [/\bpermanent(ly)?\s+(cure|relief|solution)\b/i, 'Don\'t promise a permanent cure or solution.'],
];
// Meta rejects ads that say or imply they know the viewer's health condition.
const PERSONAL_HEALTH = /\b(are\s+you|do\s+you\s+(have|suffer)|you\s+have|your|struggling\s+with)\s+(a\s+|an\s+)?(diabet\w*|pcos|pcod|thyroid\w*|bp|blood\s?pressure|cancer|depress\w*|anxiety|obes\w*|overweight|infertil\w*|arthritis|cholesterol|kidney\s+\w+|heart\s+(disease|problem)s?|piles|asthma)\b/i;
const PRICE = /(₹|\brs\.?\s*|\binr\s*)\s?\d/i;

/**
 * Pure: problems in the ad's words. `blocks` stop the ad; `warnings` are shown for a second look.
 * @param {{ text?: unknown, headline?: unknown, greeting?: unknown }} d
 */
function textCheck(d = {}) {
  const ice = Array.isArray(/** @type {Row} */ (d).iceBreakers) ? /** @type {Row} */ (d).iceBreakers : [];
  const all = [d.text, d.headline, d.greeting, ...ice].map(v => String(v || '')).join('\n');
  /** @type {string[]} */
  const blocks = [];
  /** @type {string[]} */
  const warnings = [];
  for (const [re, why] of BLOCKED) if (/** @type {RegExp} */ (re).test(all)) blocks.push(/** @type {string} */ (why));
  if (PERSONAL_HEALTH.test(all)) blocks.push('Don\'t address the reader\'s health ("Are you diabetic?", "your PCOS"): Meta rejects these. Talk about your service instead ("Diabetes care clinic, book a visit").');
  if (PRICE.test(all)) warnings.push('Check every price in the ad is correct and current.');
  if (String(d.text || '').length > 125) warnings.push('Only about the first 125 characters show before "See more".');
  if (/[A-Z]{12,}/.test(all)) warnings.push('Long words in CAPITALS can look like spam.');
  return { blocks, warnings };
}

/** 'YYYY-MM-DD' today in India. */
const todayIst = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// G1: run only in business hours. Meta's ad set schedule ("dayparting") works only with a budget for the whole
// run (lifetime budget) and an end date; the CRM keeps asking for a daily amount and works out the total as
// daily amount x the scheduled days. Hours are whole hours in the ad account's time zone (Meta's rule).
// ---------------------------------------------------------------------------
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']; // Meta: 0 = Sunday

/**
 * Pure: a clean schedule { days: [0-6], startHour, endHour } or { error } (tested).
 * @param {unknown} input @returns {{ error: string } | { schedule: { days: number[], startHour: number, endHour: number } }}
 */
function checkSchedule(input) {
  const s = /** @type {Row} */ (input && typeof input === 'object' ? input : {});
  const days = Array.isArray(s.days) ? [...new Set(s.days.map(Number))].filter(n => Number.isInteger(n) && n >= 0 && n <= 6).sort() : [];
  if (!days.length) return { error: 'Choose at least one day for the ad to run.' };
  const startHour = Number(s.startHour), endHour = Number(s.endHour);
  if (!Number.isInteger(startHour) || !Number.isInteger(endHour) || startHour < 0 || endHour > 24 || startHour >= endHour) {
    return { error: 'Choose the hours the ad runs: whole hours, the end after the start (e.g. 9 to 20).' };
  }
  return { schedule: { days, startHour, endHour } };
}

/** Pure: how many of the run's calendar days are scheduled days (start and end included). @param {string} start @param {string} end @param {number[]} days */
function scheduledDays(start, end, days) {
  let n = 0;
  for (let t = Date.parse(`${start}T00:00:00Z`), last = Date.parse(`${end}T00:00:00Z`); t <= last; t += 86400000) {
    if (days.includes(new Date(t).getUTCDay())) n++;
  }
  return n;
}

/** Pure: Meta's adset_schedule for a schedule. @param {{ days: number[], startHour: number, endHour: number }} s */
const adsetScheduleOf = (s) => [{ start_minute: s.startHour * 60, end_minute: s.endHour * 60, days: s.days, timezone_type: 'ADVERTISER' }];

/** Pure: "Mon–Sat, 9am–8pm" style label. @param {{ days: number[], startHour: number, endHour: number }} s */
function scheduleLabel(s) {
  const h = (/** @type {number} */ n) => (n === 0 || n === 24 ? '12am' : n === 12 ? '12pm' : n < 12 ? `${n}am` : `${n - 12}pm`);
  return `${s.days.length === 7 ? 'Every day' : s.days.map(d => DAY_NAMES[d]).join(', ')}, ${h(s.startHour)}–${h(s.endHour)}`;
}

/**
 * Pure: is the draft complete and within the limits? Returns the list of problems (empty = fine).
 * @param {Row} d @param {{ minDailyBudget: number | null, maxDailyBudget: number, today?: string, editing?: boolean }} lim
 *   editing: checking a change to an ad that may already run (its start date may be in the past; the end must be ahead).
 */
function validateDraft(d, lim) {
  /** @type {string[]} */
  const errs = [];
  const s = (/** @type {unknown} */ v) => String(v ?? '').trim();
  if (!UUID_RE.test(s(d.draftId))) errs.push('Something went wrong with this draft. Close the window and start again.');
  if (!s(d.name) || s(d.name).length > LIMITS.name) errs.push(`Give the ad a name (up to ${LIMITS.name} characters).`);
  // I2: an existing post brings its own words and picture (nothing else of the creative can be added).
  const usesPost = d.post !== undefined && d.post !== null;
  if (usesPost) {
    const p = checkPost(d.post);
    if ('error' in p) errs.push(p.error);
    if ((Array.isArray(d.cards) && d.cards.length) || d.videoId || d.tallImageHash || (Array.isArray(d.iceBreakers) && d.iceBreakers.length)) {
      errs.push('An existing post is used as it is: no extra pictures, video or quick questions.');
    }
  } else if (!IMAGE_HASH_RE.test(s(d.imageHash))) errs.push(d.videoId ? 'Add a cover picture for the video.' : 'Add a picture.');
  // H3: a video (uploaded to Meta first); its cover is the picture above.
  if (d.videoId !== undefined && d.videoId !== null && d.videoId !== '') {
    if (!/^\d{5,30}$/.test(s(d.videoId))) errs.push('The video was not uploaded properly. Choose it again.');
    if (Array.isArray(d.cards) && d.cards.length) errs.push('A video ad can\'t also be a carousel. Remove the extra pictures or the video.');
  }
  // H2: a tall (9:16) picture for Stories, Reels and Status (single-picture ads).
  if (d.tallImageHash) {
    if (!IMAGE_HASH_RE.test(s(d.tallImageHash))) errs.push('The tall picture was not uploaded properly. Choose it again.');
    if ((Array.isArray(d.cards) && d.cards.length) || d.videoId) errs.push('The separate Stories picture is for single-picture ads only.');
  }
  // H1: quick questions people tap to start the chat.
  if (d.iceBreakers !== undefined && d.iceBreakers !== null) {
    const ice = Array.isArray(d.iceBreakers) ? d.iceBreakers : null;
    if (!ice || ice.length > MAX_ICE_BREAKERS) errs.push(`Add up to ${MAX_ICE_BREAKERS} quick questions.`);
    else if (ice.some(q => typeof q !== 'string' || !q.trim() || q.trim().length > ICE_BREAKER_MAX)) errs.push(`Each quick question needs 1 to ${ICE_BREAKER_MAX} characters.`);
    else if (new Set(ice.map(q => String(q).trim().toLowerCase())).size !== ice.length) errs.push('Two quick questions are the same.');
  }
  // H4: interests, excluded places, languages.
  if (d.interests !== undefined && d.interests !== null) {
    const list = Array.isArray(d.interests) ? d.interests : null;
    if (!list || list.length > MAX_INTERESTS) errs.push(`Choose up to ${MAX_INTERESTS} interests.`);
    else if (list.some(i => !i || !/^\d{1,25}$/.test(s(i.id)) || s(i.name).length > 120)) errs.push('One of the interests is not valid. Remove it and search again.');
  }
  if (d.excludedLocations !== undefined && d.excludedLocations !== null) {
    const list = Array.isArray(d.excludedLocations) ? d.excludedLocations : null;
    if (!list || list.length > MAX_EXCLUDED) errs.push(`Exclude up to ${MAX_EXCLUDED} places.`);
    else if (list.some(l => !l || !/^[A-Za-z0-9_-]{1,40}$/.test(s(l.key)) || !LOCATION_TYPES.includes(s(l.type)))) errs.push('One of the excluded places is not valid. Remove it and search again.');
  }
  if (d.languages !== undefined && d.languages !== null) {
    const list = Array.isArray(d.languages) ? d.languages : null;
    if (!list || list.length > MAX_LANGUAGES) errs.push(`Choose up to ${MAX_LANGUAGES} languages.`);
    else if (list.some(l => !l || !Number.isInteger(Number(l.key)) || Number(l.key) < 1 || Number(l.key) > 100000)) errs.push('One of the languages is not valid. Remove it and search again.');
  }
  if ((!usesPost && !s(d.text)) || s(d.text).length > LIMITS.text) errs.push(`Write the ad text (up to ${LIMITS.text} characters).`);
  if (s(d.headline).length > LIMITS.headline) errs.push(`The headline can be at most ${LIMITS.headline} characters.`);
  if (s(d.greeting).length > LIMITS.greeting) errs.push(`The WhatsApp greeting can be at most ${LIMITS.greeting} characters.`);
  const locs = Array.isArray(d.locations) ? d.locations : [];
  if (!locs.length) errs.push('Choose at least one place where the ad is shown.');
  if (locs.length > LIMITS.locations) errs.push(`Choose at most ${LIMITS.locations} places.`);
  for (const l of locs) {
    if (!l || !/^[A-Za-z0-9_-]{1,40}$/.test(s(l.key)) || !LOCATION_TYPES.includes(s(l.type))) { errs.push('One of the places is not valid. Remove it and search again.'); break; }
    // Meta: the area around a city is 17 to 80 km ("city only" has no radius).
    if (l.radius !== undefined && l.radius !== null && !(Number(l.radius) >= 17 && Number(l.radius) <= 80)) { errs.push(`The area around ${s(l.name) || 'a city'} must be 17 to 80 km (Meta's rule), or "city only".`); break; }
  }
  // E3: where the ad shows ('auto' = Meta decides, as before).
  if (!PLACEMENTS.includes(s(d.placement || 'auto'))) errs.push('Choose where the ad is shown.');
  // E4: a carousel of 2-10 pictures (a single picture stays a normal ad).
  if (d.cards !== undefined && d.cards !== null) {
    const cards = Array.isArray(d.cards) ? d.cards : [];
    if (cards.length && (cards.length < 2 || cards.length > MAX_CARDS)) errs.push(`A carousel has 2 to ${MAX_CARDS} pictures.`);
    for (const c of cards) {
      if (!c || !IMAGE_HASH_RE.test(s(c.imageHash))) { errs.push('One of the carousel pictures is missing. Remove it or add it again.'); break; }
      if (s(c.headline).length > LIMITS.headline) { errs.push(`Each picture's headline can be at most ${LIMITS.headline} characters.`); break; }
    }
  }
  // E2: the number the ad opens (optional; must be one of the business's numbers: checked when creating).
  if (d.numberId !== undefined && d.numberId !== null && d.numberId !== '' && !/^\d{5,30}$/.test(s(d.numberId))) errs.push('Choose one of your WhatsApp numbers.');
  const ageMin = Number(d.ageMin ?? 18), ageMax = Number(d.ageMax ?? 65);
  if (!(Number.isInteger(ageMin) && Number.isInteger(ageMax) && ageMin >= 18 && ageMax <= 65 && ageMin <= ageMax)) errs.push('Ages must be between 18 and 65.');
  if (!['all', 'male', 'female'].includes(s(d.gender || 'all'))) errs.push('Choose who sees it: everyone, men or women.');
  const budget = Number(d.dailyBudget);
  if (!(budget > 0)) errs.push('Enter a daily budget.');
  else {
    if (lim.minDailyBudget !== null && budget < lim.minDailyBudget) errs.push(`Meta's minimum daily budget is ${lim.minDailyBudget}.`);
    if (budget > lim.maxDailyBudget) errs.push(`The most one ad may spend per day is ${lim.maxDailyBudget} (the Business Admin can change this).`);
  }
  const today = lim.today || todayIst();
  const start = s(d.startDate) || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || (!lim.editing && start < today)) errs.push('The start date can\'t be in the past.');
  const end = s(d.endDate);
  if (end && (!/^\d{4}-\d{2}-\d{2}$/.test(end) || end <= start)) errs.push('The end date must be after the start date (an ad with a daily budget runs at least a day).');
  else if (end && lim.editing && end < today) errs.push('The end date can\'t be in the past.');
  // G1: only in business hours (a budget for the whole run, so an end date is needed).
  if (d.schedule) {
    const sc = checkSchedule(d.schedule);
    if ('error' in sc) errs.push(sc.error);
    else if (!end) errs.push('An ad that runs only in set hours needs an end date (Meta gives it one budget for the whole run).');
    else if (/^\d{4}-\d{2}-\d{2}$/.test(end) && end > start) {
      const n = scheduledDays(start, end, sc.schedule.days);
      const total = scheduledDays(start, end, [0, 1, 2, 3, 4, 5, 6]);
      if (!n) errs.push('None of the chosen days fall between the start and end dates.');
      else if (budget > 0 && lim.minDailyBudget !== null && budget * n < lim.minDailyBudget * total) {
        errs.push(`For ${total} days, Meta needs at least ${lim.minDailyBudget * total} for the whole run. Raise the daily amount to ${Math.ceil((lim.minDailyBudget * total) / n)} or choose more days.`);
      }
    }
  }
  return errs;
}

/** Pure: the whole-run budget of a scheduled ad (daily amount x scheduled days). @param {number} daily @param {Row} spec */
const lifetimeBudgetOf = (daily, spec) => Math.round(daily * scheduledDays(spec.startDate, spec.endDate, spec.schedule.days) * 100) / 100;

/** Meta's geo_locations for a list of places. @param {Row[]} list */
function geoOf(list) {
  /** @type {Record<string, any[]>} */
  const geo = {};
  for (const l of list || []) {
    const t = String(l.type);
    if (t === 'country') (geo.countries ||= []).push(String(l.countryCode || l.key));
    else if (t === 'city') (geo.cities ||= []).push(l.radius ? { key: String(l.key), radius: Number(l.radius), distance_unit: 'kilometer' } : { key: String(l.key) });
    else if (t === 'region') (geo.regions ||= []).push({ key: String(l.key) });
    else if (t === 'zip') (geo.zips ||= []).push({ key: String(l.key) });
  }
  return geo;
}

/** Meta's targeting for the draft. @param {Row} d */
function targetingFor(d) {
  /** @type {Record<string, any>} */
  const targeting = { geo_locations: geoOf(d.locations), age_min: Number(d.ageMin ?? 18), age_max: Number(d.ageMax ?? 65) };
  if (d.gender === 'male') targeting.genders = [1];
  if (d.gender === 'female') targeting.genders = [2];
  // H4: places to leave out, interests (any of them), and the languages people use Facebook in.
  if (Array.isArray(d.excludedLocations) && d.excludedLocations.length) targeting.excluded_geo_locations = geoOf(d.excludedLocations);
  if (Array.isArray(d.interests) && d.interests.length) targeting.flexible_spec = [{ interests: d.interests.map((/** @type {Row} */ i) => ({ id: String(i.id), name: String(i.name || '') })) }];
  if (Array.isArray(d.languages) && d.languages.length) targeting.locales = d.languages.map((/** @type {Row} */ l) => Number(l.key));
  // E3: placements. 'auto' (or missing, as in ads made before E3) adds nothing: Meta decides, as before.
  if (d.placement === 'feeds_stories' || d.placement === 'with_status') {
    targeting.publisher_platforms = ['facebook', 'instagram'];
    targeting.facebook_positions = ['feed', 'story', 'facebook_reels'];
    targeting.instagram_positions = ['stream', 'story', 'reels'];
    if (d.placement === 'with_status') {
      targeting.publisher_platforms.push('whatsapp');
      targeting.whatsapp_positions = ['status'];
    }
  }
  return targeting;
}

const CTA = { type: 'WHATSAPP_MESSAGE', value: { app_destination: 'WHATSAPP' } };

/**
 * F2: the Instagram account connected to the Page ({ id, username }), or null (none, or the token can't see it).
 * @param {string} version @param {string} token @param {string | null | undefined} pageId
 */
async function instagramOf(version, token, pageId) {
  if (!pageId || !PAGE_ID_RE.test(String(pageId))) return null;
  const r = await ads.graph(version, token, `${pageId}?fields=instagram_business_account{id,username}`);
  const ig = r?.instagram_business_account;
  return !r?.error && ig && /^\d{5,30}$/.test(String(ig.id)) ? { id: String(ig.id), username: String(ig.username || '') } : null;
}

/**
 * The creative's story for the draft: one picture, or a carousel (E4). With `igUserId` (F2) the ad shows as that
 * Instagram account on Instagram instead of as the Facebook Page.
 * @param {Row} d @param {string} pageId @param {string | null} [igUserId]
 */
function storyFor(d, pageId, igUserId = null) {
  const welcome = welcomeOf(d);
  // H3: a video ad (its cover is the picture).
  if (d.videoId) {
    /** @type {Record<string, any>} */
    const video = { video_id: String(d.videoId), image_hash: String(d.imageHash), message: String(d.text).trim(), call_to_action: CTA };
    if (String(d.headline || '').trim()) video.title = String(d.headline).trim();
    if (welcome) video.page_welcome_message = welcome;
    return { page_id: pageId, ...(igUserId ? { instagram_user_id: igUserId } : {}), video_data: video };
  }
  /** @type {Record<string, any>} */
  const link = {
    message: String(d.text).trim(),
    link: WHATSAPP_LINK,
    call_to_action: CTA,
  };
  const cards = Array.isArray(d.cards) ? d.cards : [];
  if (cards.length >= 2) {
    link.child_attachments = cards.map((/** @type {Row} */ c) => ({
      link: WHATSAPP_LINK,
      image_hash: String(c.imageHash),
      ...(String(c.headline || '').trim() ? { name: String(c.headline).trim() } : {}),
      call_to_action: CTA,
    }));
    link.multi_share_end_card = false;   // no extra "see more" card pointing at a website
    link.multi_share_optimized = false;  // keep the order the business chose
  } else {
    link.image_hash = String(d.imageHash);
    if (String(d.headline || '').trim()) link.name = String(d.headline).trim();
  }
  if (welcome) link.page_welcome_message = welcome;
  return { page_id: pageId, ...(igUserId ? { instagram_user_id: igUserId } : {}), link_data: link };
}

/**
 * Pure: what the chat opens with. Without quick questions: the greeting is the message filled in for the customer
 * (as before). With quick questions (H1): Meta's welcome message with ice breakers, the greeting as its text.
 * @param {Row} d @returns {string | null}
 */
function welcomeOf(d) {
  const greeting = String(d.greeting || '').trim();
  const ice = Array.isArray(d.iceBreakers) ? d.iceBreakers.map((/** @type {unknown} */ q) => String(q).trim()).filter(Boolean).slice(0, MAX_ICE_BREAKERS) : [];
  if (!ice.length) return greeting || null;
  return JSON.stringify({
    type: 'VISUAL_EDITOR', version: 2, landing_screen_type: 'welcome_message', media_type: 'text',
    text_format: { customer_action_type: 'ice_breakers', message: { text: greeting || 'Hi! How can we help you?', ice_breakers: ice.map(title => ({ title })) } },
  });
}

/**
 * H2: a single-picture ad with a separate tall picture for Stories, Reels and WhatsApp Status (Meta's placement asset
 * customization): square picture in feeds, tall picture in the full-screen places. Null when not asked for.
 * @param {Row} d @param {string} pageId @param {string | null} igUserId
 */
function placementFeedFor(d, pageId, igUserId) {
  if (!d.tallImageHash || d.videoId || (Array.isArray(d.cards) && d.cards.length >= 2)) return null;
  const welcome = welcomeOf(d);
  const tall = { publisher_platforms: ['facebook', 'instagram'], facebook_positions: ['story', 'facebook_reels'], instagram_positions: ['story', 'reels'] };
  if (d.placement === 'with_status') Object.assign(tall, { publisher_platforms: ['facebook', 'instagram', 'whatsapp'], whatsapp_positions: ['status'] });
  return {
    object_story_spec: { page_id: pageId, ...(igUserId ? { instagram_user_id: igUserId } : {}) },
    asset_feed_spec: {
      ad_formats: ['SINGLE_IMAGE'],
      optimization_type: 'PLACEMENT',
      images: [{ hash: String(d.imageHash), adlabels: [{ name: 'square' }] }, { hash: String(d.tallImageHash), adlabels: [{ name: 'tall' }] }],
      bodies: [{ text: String(d.text).trim() }],
      ...(String(d.headline || '').trim() ? { titles: [{ text: String(d.headline).trim() }] } : {}),
      link_urls: [{ website_url: WHATSAPP_LINK }],
      call_to_action_types: ['WHATSAPP_MESSAGE'],
      additional_data: { is_click_to_message: true, ...(welcome ? { page_welcome_message: welcome } : {}) },
      asset_customization_rules: [
        { customization_spec: tall, image_label: { name: 'tall' } },
        { customization_spec: { publisher_platforms: ['facebook', 'instagram'], facebook_positions: ['feed', 'marketplace', 'video_feeds', 'search'], instagram_positions: ['stream', 'explore', 'explore_home'] }, image_label: { name: 'square' } },
      ],
    },
  };
}

/**
 * The creative to send: with a separate tall picture when asked (falls back to the plain creative if Meta refuses it).
 * @param {Row} d @param {string} pageId @param {string | null} igUserId @param {string} name @param {string} number
 * @returns {{ tall: Record<string, string> | null, plain: Record<string, string> }}
 */
function creativeFormsFor(d, pageId, igUserId, name, number) {
  /** @type {Record<string, string>} */
  const plain = d.post ? postCreativeFor(d.post, pageId, igUserId, name) : { name, object_story_spec: JSON.stringify(storyFor(d, pageId, igUserId)) };
  if (d.placement === 'with_status' && number) plain.wamo_whatsapp_identity_spec = JSON.stringify({ whatsapp_phone_number: `+${number}` });
  const feed = d.post ? null : placementFeedFor(d, pageId, igUserId);
  /** @type {Record<string, string> | null} */
  const tall = feed ? { name, object_story_spec: JSON.stringify(feed.object_story_spec), asset_feed_spec: JSON.stringify(feed.asset_feed_spec) } : null;
  if (tall && plain.wamo_whatsapp_identity_spec) tall.wamo_whatsapp_identity_spec = plain.wamo_whatsapp_identity_spec;
  return { tall, plain };
}

/**
 * I2: the creative for an existing post, with the "Send WhatsApp message" button. Instagram posts follow Meta's
 * click-to-WhatsApp guide (source_instagram_media_id); Facebook Page posts use object_story_id (Meta checks the post
 * can be promoted and refuses with its reason otherwise). Pure (tested).
 * @param {Row} post  checkPost's post @param {string} pageId @param {string | null} igUserId @param {string} name
 * @returns {Record<string, string>}
 */
function postCreativeFor(post, pageId, igUserId, name) {
  const cta = JSON.stringify({ type: 'WHATSAPP_MESSAGE', value: { link: WHATSAPP_LINK, app_destination: 'WHATSAPP' } });
  if (post.source === 'instagram') {
    return { name, object_id: pageId, ...(igUserId ? { instagram_user_id: igUserId } : {}), source_instagram_media_id: String(post.id), call_to_action: cta };
  }
  // On Instagram the Facebook post shows as the Instagram account only when Meta says the post can.
  return { name, object_story_id: String(post.id), call_to_action: cta, ...(igUserId && post.igEligible ? { instagram_user_id: igUserId } : {}) };
}

/**
 * Create the creative in Meta: the tall-picture version first (if any), then the plain one if Meta refuses it.
 * @param {string} version @param {string} token @param {string} account @param {{ tall: Record<string, string> | null, plain: Record<string, string> }} forms
 * @returns {Promise<{ creative: Row, tallRefused: string | null }>}
 */
async function createCreative(version, token, account, forms) {
  if (forms.tall) {
    const c = await ads.graph(version, token, `${account}/adcreatives`, { method: 'POST', form: forms.tall });
    if (!c.error && c.id) return { creative: c, tallRefused: null };
    const plain = await ads.graph(version, token, `${account}/adcreatives`, { method: 'POST', form: forms.plain });
    return { creative: plain, tallRefused: ads.metaMsg(c) };
  }
  return { creative: await ads.graph(version, token, `${account}/adcreatives`, { method: 'POST', form: forms.plain }), tallRefused: null };
}

/** Is this business in healthcare / pharma (Meta doesn't allow WhatsApp Status ads for them)? @param {string} biz */
async function isHealthcare(biz) {
  const r = await dbRequest(`businesses?id=eq.${biz}&select=industry`);
  const industry = r.ok && Array.isArray(r.data) ? String(r.data[0]?.industry || '') : '';
  return industry === 'hospital';
}

/** Everything the wizard needs from the account, or { error }. @param {Staff} staff @param {{ needPage?: boolean }} [opt] */
async function wizardContext(staff, { needPage = true } = {}) {
  const ctx = await ads.controlContext(staff?.businessId);
  if (ctx.error !== undefined) return { error: ctx.error };
  if (needPage && !ctx.row.page_id) return { error: 'Choose the Facebook Page first (Create WhatsApp ads -> checklist).' };
  return ctx;
}

/** Business Admin: upload the ad picture to Meta (the browser already made it <= 1 MB JPEG/PNG). @param {Staff} staff @param {Row} input */
async function uploadImage(staff, input = {}) {
  const ctx = await wizardContext(staff, { needPage: false });
  if (ctx.error !== undefined) return { error: ctx.error };
  const b64 = String(input.base64 || '').replace(/^data:image\/[a-z]+;base64,/, '');
  if (!/^[A-Za-z0-9+/]+=*$/.test(b64)) return { error: 'That picture could not be read.' };
  const bytes = Buffer.from(b64, 'base64');
  if (bytes.length > MAX_IMAGE_BYTES) return { error: 'The picture is too large (up to 1 MB after resizing).' };
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const isPng = bytes[0] === 0x89 && bytes.subarray(1, 4).toString() === 'PNG';
  if (!isJpeg && !isPng) return { error: 'Use a JPG or PNG picture.' };
  const r = await ads.graph(ctx.version, ctx.token, `${ctx.row.ad_account_id}/adimages`, { method: 'POST', form: { bytes: b64 }, timeoutMs: 30000 });
  if (r.error) return { error: `Meta didn't accept the picture: ${ads.metaMsg(r)}`, status: 502 };
  const img = Object.values(r.images || {})[0];
  if (!img?.hash) return { error: 'Meta didn\'t return the picture. Try again.', status: 502 };
  return { imageHash: String(img.hash), imageUrl: String(img.url || '') };
}

/** Places for the audience (Meta's location search). @param {Staff} staff @param {unknown} q */
async function searchLocations(staff, q) {
  const ctx = await wizardContext(staff, { needPage: false });
  if (ctx.error !== undefined) return { error: ctx.error };
  const text = String(q || '').trim().slice(0, 60);
  if (text.length < 2) return { locations: [] };
  const types = encodeURIComponent(JSON.stringify(LOCATION_TYPES));
  const r = await ads.graph(ctx.version, ctx.token, `search?type=adgeolocation&location_types=${types}&q=${encodeURIComponent(text)}&limit=10`);
  if (r.error) return { error: `Meta says: ${ads.metaMsg(r)}`, status: 502 };
  return {
    locations: (r.data || []).map((/** @type {Row} */ l) => ({
      key: String(l.key), type: String(l.type), name: String(l.name || ''),
      region: String(l.region || ''), country: String(l.country_name || l.country_code || ''), countryCode: String(l.country_code || ''),
    })).filter((/** @type {Row} */ l) => LOCATION_TYPES.includes(l.type)),
  };
}

/** H4: interests for the audience (Meta's interest search; sensitive health topics are not offered by Meta). @param {Staff} staff @param {unknown} q */
async function searchInterests(staff, q) {
  const ctx = await wizardContext(staff, { needPage: false });
  if (ctx.error !== undefined) return { error: ctx.error };
  const text = String(q || '').trim().slice(0, 60);
  if (text.length < 2) return { interests: [] };
  const r = await ads.graph(ctx.version, ctx.token, `search?type=adinterest&q=${encodeURIComponent(text)}&limit=15`);
  if (r.error) return { error: `Meta says: ${ads.metaMsg(r)}`, status: 502 };
  return {
    interests: (r.data || []).filter((/** @type {Row} */ i) => /^\d{1,25}$/.test(String(i.id))).map((/** @type {Row} */ i) => ({
      id: String(i.id), name: String(i.name || '').slice(0, 120), path: Array.isArray(i.path) ? i.path.slice(0, 4).map(String) : [],
      size: Number(i.audience_size_upper_bound || i.audience_size) || null,
    })),
  };
}

/** H4: languages people use Facebook in (Meta's locale search). @param {Staff} staff @param {unknown} q */
async function searchLanguages(staff, q) {
  const ctx = await wizardContext(staff, { needPage: false });
  if (ctx.error !== undefined) return { error: ctx.error };
  const text = String(q || '').trim().slice(0, 40);
  if (text.length < 2) return { languages: [] };
  const r = await ads.graph(ctx.version, ctx.token, `search?type=adlocale&q=${encodeURIComponent(text)}&limit=10`);
  if (r.error) return { error: `Meta says: ${ads.metaMsg(r)}`, status: 502 };
  return { languages: (r.data || []).filter((/** @type {Row} */ l) => Number.isInteger(Number(l.key))).map((/** @type {Row} */ l) => ({ key: Number(l.key), name: String(l.name || '').slice(0, 60) })) };
}

// ---------------------------------------------------------------------------
// H3: video. The browser uploads the file straight to private storage (Netlify can't carry big files), then Meta
// fetches it from a short-lived link. The copy in storage is deleted once the ad is created (and stale ones after a day).
// ---------------------------------------------------------------------------
const VIDEO_PATH_RE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(mp4|mov)$/;

/** Business Admin: a one-time link to upload one video file. @param {Staff} staff @param {Row} input { type, size } */
async function videoUploadUrl(staff, input = {}) {
  const ctx = await wizardContext(staff, { needPage: false });
  if (ctx.error !== undefined) return { error: ctx.error };
  const type = String(input.type || '');
  if (!VIDEO_TYPES.includes(type)) return { error: 'Use an MP4 or MOV video.' };
  const size = Number(input.size);
  if (!(size > 0) || size > MAX_VIDEO_BYTES) return { error: `The video must be at most ${MAX_VIDEO_BYTES / 1024 / 1024} MB. Shorten or compress it first.` };
  const storage = require('./storage.cjs');
  await storage.ensureBucket(VIDEO_BUCKET, { maxBytes: MAX_VIDEO_BYTES, mimeTypes: VIDEO_TYPES });
  // Tidy up: this business's uploads that were never used.
  try {
    const old = await storage.list(VIDEO_BUCKET, ctx.id);
    if (old.length > 5) await storage.remove(VIDEO_BUCKET, old.slice(0, old.length - 5).map(o => `${ctx.id}/${o.name}`));
  } catch { /* best effort */ }
  const path = `${ctx.id}/${require('crypto').randomUUID()}.${type === 'video/quicktime' ? 'mov' : 'mp4'}`;
  const url = await storage.signedUploadUrl(VIDEO_BUCKET, path);
  if (!url) return { error: 'Could not prepare the upload. Try again.', status: 502 };
  return { uploadUrl: url, path };
}

/** Business Admin: hand the uploaded file to Meta (it downloads it), returning Meta's video id. @param {Staff} staff @param {unknown} path */
async function registerVideo(staff, path) {
  const ctx = await wizardContext(staff, { needPage: false });
  if (ctx.error !== undefined) return { error: ctx.error };
  const p = String(path || '');
  // Only this business's own uploads.
  if (!VIDEO_PATH_RE.test(p) || !p.startsWith(`${ctx.id}/`)) return { error: 'That video upload is not valid. Choose the video again.' };
  const link = await require('./storage.cjs').signedDownloadUrl(VIDEO_BUCKET, p, 3600);
  if (!link) return { error: 'The uploaded video could not be found. Choose it again.' };
  const r = await ads.graph(ctx.version, ctx.token, `${ctx.row.ad_account_id}/advideos`, { method: 'POST', form: { file_url: link, name: `CRM upload ${p.slice(-12)}` }, timeoutMs: 30000 });
  if (r.error || !r.id) return { error: `Meta didn't accept the video: ${ads.metaMsg(r)}`, status: 502 };
  return { videoId: String(r.id), path: p };
}

/** Is Meta done processing the video? @param {Staff} staff @param {unknown} videoId */
async function videoStatus(staff, videoId) {
  const ctx = await wizardContext(staff, { needPage: false });
  if (ctx.error !== undefined) return { error: ctx.error };
  if (!/^\d{5,30}$/.test(String(videoId || ''))) return { error: 'Invalid video.' };
  const r = await ads.graph(ctx.version, ctx.token, `${videoId}?fields=status,length`);
  if (r.error) return { error: `Meta says: ${ads.metaMsg(r)}`, status: 502 };
  const st = String(r.status?.video_status || 'processing');
  return { status: st === 'ready' ? 'ready' : st === 'error' ? 'error' : 'processing', seconds: Number(r.length) || null };
}

/** Rough audience size for the draft's targeting (best effort). @param {Staff} staff @param {Row} d */
async function estimate(staff, d = {}) {
  const ctx = await wizardContext(staff, { needPage: false });
  if (ctx.error !== undefined) return { error: ctx.error };
  const spec = encodeURIComponent(JSON.stringify(targetingFor(d)));
  const r = await ads.graph(ctx.version, ctx.token, `${ctx.row.ad_account_id}/delivery_estimate?optimization_goal=CONVERSATIONS&targeting_spec=${spec}`);
  if (r.error) return { estimate: null, note: 'Meta could not estimate this audience.' };
  const e = r.data?.[0] || {};
  return { estimate: { lower: Number(e.estimate_mau_lower_bound) || null, upper: Number(e.estimate_mau_upper_bound) || null } };
}

/** Meta's rendering of the ad before it exists, plus the text check. @param {Staff} staff @param {Row} d */
async function preview(staff, d = {}) {
  const ctx = await wizardContext(staff);
  if (ctx.error !== undefined) return { error: ctx.error };
  // I2: an existing post: its own caption is checked; the wizard shows the post's picture.
  if (d.post) return { check: textCheck({ text: d.post.caption }), frameUrl: null, note: null };
  const check = textCheck(d);
  if (!IMAGE_HASH_RE.test(String(d.imageHash || ''))) return { check, frameUrl: null };
  const creative = encodeURIComponent(JSON.stringify({ object_story_spec: storyFor(d, ctx.row.page_id) }));
  const r = await ads.graph(ctx.version, ctx.token, `${ctx.row.ad_account_id}/generatepreviews?ad_format=MOBILE_FEED_STANDARD&creative=${creative}`);
  const src = (String(r?.data?.[0]?.body || '').match(/src="([^"]+)"/) || [])[1]?.replace(/&amp;/g, '&') || null;
  return { check, frameUrl: src && /^https:\/\/(www|business)\.facebook\.com\//.test(src) ? src : null, note: r.error ? `Meta: ${ads.metaMsg(r)}` : null };
}

/** @param {string} biz @param {string} id @param {Record<string, unknown>} patch */
const patchLaunch = (biz, id, patch) => dbRequest(`ad_launches?business_id=eq.${biz}&id=eq.${id}`, { method: 'PATCH', prefer: 'return=representation', body: { ...patch, updated_at: new Date().toISOString() } });

/**
 * Business Admin: create the ad in Meta, PAUSED (nothing spends until Launch). Campaign -> ad set ->
 * creative -> ad; if any step fails, what was made is deleted again. The same draft id never makes two ads.
 * @param {Staff} staff @param {Row} d
 */
async function createAd(staff, d = {}) {
  return makeAd(staff, d, null);
}

/**
 * I1: Business Admin: one more ad in a campaign made here (own business only, up to MAX_ADS_PER_CAMPAIGN).
 *   mode 'same_audience': another picture / text / post in the same ad set: it shares that ad set's audience,
 *     budget and dates (Meta shows the better ad more); nothing new to pay.
 *   mode 'new_audience': a new ad set in the same campaign, with its own audience, budget and dates.
 * The ad opens the same WhatsApp number as the campaign. Created PAUSED, launched like any other.
 * @param {Staff} staff @param {unknown} launchId  any ad of the campaign @param {Row} d  the new ad (+ mode)
 */
async function addToCampaign(staff, launchId, d = {}) {
  const biz = requireBusinessId(staff?.businessId);
  if (!UUID_RE.test(String(launchId || ''))) return { error: 'Invalid ad.' };
  const r = await dbRequest(`ad_launches?business_id=eq.${biz}&id=eq.${launchId}&select=*`);
  const parent = r.ok ? r.data?.[0] : null;
  if (!parent) return { error: 'Not found.', status: 404 };
  if (!['created', 'launched'].includes(parent.status) || !parent.campaign_id || !parent.adset_id) return { error: 'Only ads that were created completely can get more ads.' };
  const mode = d.mode === 'new_audience' || d.mode === 'same_audience' ? d.mode : null;
  if (!mode) return { error: 'Choose: the same audience and budget, or a new audience with its own budget.' };
  const all = await dbRequest(`ad_launches?business_id=eq.${biz}&campaign_id=eq.${encodeURIComponent(String(parent.campaign_id))}&select=id,status`);
  const inCampaign = (all.data || []).filter((/** @type {Row} */ x) => x.status !== 'failed').length;
  if (inCampaign >= MAX_ADS_PER_CAMPAIGN) return { error: `A campaign made here holds up to ${MAX_ADS_PER_CAMPAIGN} ads. Create a new campaign instead.` };
  return makeAd(staff, d, { parent, mode });
}

/**
 * Create one ad in Meta, PAUSED: a new campaign (or the parent's), a new ad set (or the parent's), creative, ad.
 * @param {Staff} staff @param {Row} input @param {{ parent: Row, mode: string } | null} add
 */
async function makeAd(staff, input, add) {
  const ctx = await wizardContext(staff);
  if (ctx.error !== undefined) return { error: ctx.error };
  const { row, token, version } = ctx;
  const biz = ctx.id;
  const shared = add?.mode === 'same_audience';
  const ps = add ? (add.parent.spec || {}) : {};
  // An added ad keeps its campaign's number; "same audience" also the ad set's settings and budget.
  /** @type {Row} */
  const d = shared ? { ...input, ...Object.fromEntries(ADSET_KEYS.map(k => [k, ps[k] ?? null])), dailyBudget: Number(add.parent.daily_budget) } : { ...input };
  if (add) delete d.numberId;
  const acct = await ads.graph(version, token, `${row.ad_account_id}?fields=min_daily_budget,currency`);
  const currency = acct.currency || row.currency || 'INR';
  const factor = ads.minorFactor(currency);
  const minDailyBudget = acct.min_daily_budget !== undefined ? Math.ceil(Number(acct.min_daily_budget) / factor) : null;
  const errs = validateDraft(d, { minDailyBudget, maxDailyBudget: Number(row.max_daily_budget) || DEFAULT_CAP, editing: shared });
  if (errs.length) return { error: errs[0], problems: errs };
  /** @type {Row | null} */
  let post = null;
  if (d.post !== undefined && d.post !== null) {
    const p = checkPost(d.post, row.page_id);
    if ('error' in p) return { error: p.error };
    post = p.post;
  }
  const check = textCheck(post ? { text: post.caption } : d);
  if (check.blocks.length) return { error: check.blocks[0], problems: check.blocks };
  const numbers = await businessNumbers(biz);
  if (!numbers.length) return { error: 'This business has no WhatsApp number connected.' };
  // The ad opens the number linked to the Page: use it when it is one of this business's numbers
  // (several numbers per business); otherwise the main number (Meta then checks the link).
  let number = numbers[0].phone;
  if (numbers.length > 1 && row.page_id) {
    const page = await ads.graph(version, token, `${row.page_id}?fields=whatsapp_number`);
    const opens = page.error ? null : matchNumber(page.whatsapp_number, numbers);
    if (opens) number = opens.phone;
  }
  // E2: a number chosen for this ad (one of THIS business's numbers; Meta checks it is connected to the Page).
  if (d.numberId) {
    const all = await require('./whatsapp.cjs').listNumbers(biz);
    const chosen = all.find(n => n.id === String(d.numberId));
    if (!chosen || !digits(chosen.phoneNumber)) return { error: 'That WhatsApp number isn\'t connected to this business.' };
    number = digits(chosen.phoneNumber);
  }
  if (add && digits(ps.number)) number = digits(ps.number); // the campaign's own number
  // E3: WhatsApp Status is not allowed for healthcare / pharma advertisers (Meta's rule).
  const placement = PLACEMENTS.includes(String(d.placement)) ? String(d.placement) : 'auto';
  if (placement === 'with_status' && await isHealthcare(biz)) {
    return { error: 'Meta doesn\'t allow WhatsApp Status ads for healthcare and pharma businesses. Choose another placement.' };
  }

  // Idempotency: one row per draft. A retry returns what the first attempt made.
  const name = String(d.name).trim();
  const cards = Array.isArray(d.cards) && d.cards.length >= 2
    ? d.cards.slice(0, MAX_CARDS).map((/** @type {Row} */ c) => ({ imageHash: String(c.imageHash), headline: String(c.headline || '').trim(), imageUrl: /^https:\/\//.test(String(c.imageUrl || '')) ? String(c.imageUrl).slice(0, 1000) : '' }))
    : null;
  const spec = {
    text: String(d.text).trim(), headline: String(d.headline || '').trim(), greeting: String(d.greeting || '').trim(),
    imageHash: String(d.imageHash), imageUrl: /^https:\/\//.test(String(d.imageUrl || '')) ? String(d.imageUrl).slice(0, 1000) : '', locations: d.locations,
    ageMin: Number(d.ageMin ?? 18), ageMax: Number(d.ageMax ?? 65), gender: d.gender || 'all', startDate: d.startDate || todayIst(), endDate: d.endDate || null,
    placement, number, useInstagram: d.useInstagram !== false, ...(cards ? { cards } : {}),
    // G1: runs only in these hours (null = all day, every day).
    schedule: d.schedule ? /** @type {{ schedule: { days: number[], startHour: number, endHour: number } }} */ (checkSchedule(d.schedule)).schedule : null,
    // Phase H.
    iceBreakers: Array.isArray(d.iceBreakers) ? d.iceBreakers.map((/** @type {unknown} */ q) => String(q).trim()).filter(Boolean) : [],
    tallImageHash: d.tallImageHash && !cards && !d.videoId ? String(d.tallImageHash) : null,
    tallImageUrl: d.tallImageHash && /^https:\/\//.test(String(d.tallImageUrl || '')) ? String(d.tallImageUrl).slice(0, 1000) : '',
    videoId: d.videoId ? String(d.videoId) : null,
    interests: Array.isArray(d.interests) ? d.interests.map((/** @type {Row} */ i) => ({ id: String(i.id), name: String(i.name || '').slice(0, 120) })) : [],
    excludedLocations: Array.isArray(d.excludedLocations) ? d.excludedLocations : [],
    languages: Array.isArray(d.languages) ? d.languages.map((/** @type {Row} */ l) => ({ key: Number(l.key), name: String(l.name || '').slice(0, 60) })) : [],
  };
  // I2: an existing post: its own words and picture (a copy of the caption and picture link for the CRM's lists).
  if (post) Object.assign(spec, { post, text: '', headline: '', greeting: '', imageHash: '', imageUrl: post.pictureUrl, iceBreakers: [], tallImageHash: null, tallImageUrl: '', videoId: null });
  // I1: which ad it was added to, and whether it shares that ad's audience and budget.
  if (add) Object.assign(spec, { addedTo: String(add.parent.id), sharedAdset: shared });
  // F2 / I2: the Instagram account (needed for Instagram posts).
  const ig = d.useInstagram === false && post?.source !== 'instagram' ? null : await instagramOf(version, token, row.page_id);
  if (post?.source === 'instagram' && !ig) return { error: 'Instagram posts need the Instagram account connected to the Facebook Page (Meta Business settings -> Instagram accounts).' };
  // H3: Meta must have finished processing the video.
  if (spec.videoId) {
    const vs = await ads.graph(version, token, `${spec.videoId}?fields=status`);
    const st = String(vs?.status?.video_status || '');
    if (vs.error) return { error: `Meta can't find the video: ${ads.metaMsg(vs)}. Choose it again.` };
    if (st === 'error') return { error: 'Meta could not process the video. Try another file (MP4, H.264).' };
    if (st !== 'ready') return { error: 'Meta is still processing the video. Try again in a minute.', status: 409 };
  }
  const ins = await dbRequest('ad_launches?on_conflict=business_id,draft_id', {
    method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation',
    body: { business_id: biz, draft_id: String(d.draftId), created_by: staff.email, name, spec, daily_budget: Number(d.dailyBudget), currency, status: 'creating' },
  });
  if (!ins.ok) return { error: 'Could not save. Has the Ads D2 SQL (20261121) been run?' };
  /** @type {Row} */
  let launch;
  if (!ins.data?.length) {
    const prev = await dbRequest(`ad_launches?business_id=eq.${biz}&draft_id=eq.${String(d.draftId)}&select=*`);
    const p = prev.data?.[0];
    if (!p) return { error: 'Could not save.' };
    if (p.status !== 'failed') return { launch: p, repeated: true };
    // Meta refused this draft before (nothing was left in Meta): try again with the settings as they are now.
    const again = await patchLaunch(biz, p.id, { status: 'creating', error: null, name, spec, daily_budget: Number(d.dailyBudget), currency, created_by: staff.email });
    if (!again.ok || !again.data?.length) return { error: 'Could not save.' };
    launch = again.data[0];
  } else {
    launch = ins.data[0];
  }

  /** @type {Array<string>} */
  const made = [];
  /** @param {string} step @param {Row} r */
  const failed = async (step, r) => {
    for (const id of made.reverse()) await ads.graph(version, token, id, { method: 'DELETE' }); // no half ads left in Meta
    const msg = `Meta refused the ${step}: ${ads.metaMsg(r)}`;
    await patchLaunch(biz, launch.id, { status: 'failed', error: msg.slice(0, 500) });
    await require('./events.cjs').logEvent({ level: 'warn', source: 'ads', businessId: biz, code: 'ad_create_failed', message: msg });
    return { error: msg, status: 502 };
  };
  const startTime = spec.startDate <= todayIst() ? new Date(Date.now() + 10 * 60000).toISOString() : `${spec.startDate}T00:00:00+0530`;

  // I1: an added ad goes into its campaign (and, sharing, into its ad set).
  let campaignId = add ? String(add.parent.campaign_id) : '';
  if (!campaignId) {
    const campaign = await ads.graph(version, token, `${row.ad_account_id}/campaigns`, { method: 'POST', form: {
      name, objective: 'OUTCOME_ENGAGEMENT', status: 'PAUSED', special_ad_categories: '[]', is_adset_budget_sharing_enabled: 'false',
    } });
    if (campaign.error || !campaign.id) return failed('campaign', campaign);
    campaignId = String(campaign.id);
    made.push(campaignId);
  }
  let adsetId = shared ? String(add.parent.adset_id) : '';

  /** @type {Record<string, string>} */
  const adsetForm = {
    name: `${name} – audience`, campaign_id: campaignId, status: 'PAUSED',
    daily_budget: String(Math.round(Number(d.dailyBudget) * factor)),
    billing_event: 'IMPRESSIONS', optimization_goal: 'CONVERSATIONS', bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    destination_type: 'WHATSAPP',
    promoted_object: JSON.stringify({ page_id: row.page_id, whatsapp_phone_number: `+${number}` }),
    targeting: JSON.stringify(targetingFor(spec)),
    start_time: startTime,
  };
  if (spec.endDate) adsetForm.end_time = `${spec.endDate}T23:59:00+0530`;
  if (spec.schedule) {
    // G1: Meta runs scheduled ads only with a budget for the whole run.
    delete adsetForm.daily_budget;
    adsetForm.lifetime_budget = String(Math.round(lifetimeBudgetOf(Number(d.dailyBudget), spec) * factor));
    adsetForm.pacing_type = JSON.stringify(['day_parting']);
    adsetForm.adset_schedule = JSON.stringify(adsetScheduleOf(spec.schedule));
  }
  if (!adsetId) {
    const adset = await ads.graph(version, token, `${row.ad_account_id}/adsets`, { method: 'POST', form: adsetForm });
    if (adset.error || !adset.id) return failed('audience and budget', adset);
    adsetId = String(adset.id);
    made.push(adsetId);
  }

  // F2: the ad shows as the Page's Instagram account on Instagram (ig above; unless the Business Admin turned it off).
  // WhatsApp Status shows the business's WhatsApp identity (Meta: without it some Status ads don't deliver).
  // H2: with a tall picture, Meta's placement customization first; the plain creative if Meta refuses it.
  const { creative, tallRefused } = await createCreative(version, token, row.ad_account_id, creativeFormsFor(spec, row.page_id, ig?.id || null, `${name} – creative`, number));
  if (creative.error || !creative.id) return failed(post ? `${post.source === 'instagram' ? 'Instagram' : 'Facebook'} post as an ad` : spec.videoId ? 'video and text' : 'picture and text', creative);
  made.push(String(creative.id));
  if (tallRefused) spec.tallImageHash = null;

  const ad = await ads.graph(version, token, `${row.ad_account_id}/ads`, { method: 'POST', form: {
    name, adset_id: adsetId, creative: JSON.stringify({ creative_id: String(creative.id) }), status: 'PAUSED',
  } });
  if (ad.error || !ad.id) return failed('ad', ad);

  const done = await patchLaunch(biz, launch.id, { status: 'created', campaign_id: campaignId, adset_id: adsetId, creative_id: String(creative.id), ad_id: String(ad.id), error: null, ...(tallRefused ? { spec } : {}) });
  await ads.audit(staff, biz, add ? 'ads.ad_added' : 'ads.ad_created', {
    launchId: launch.id, adId: String(ad.id), name, dailyBudget: Number(d.dailyBudget), ...(add ? { addedTo: String(add.parent.id), sharedBudget: shared } : {}), ...(post ? { post: post.source } : {}),
  });
  // H3: Meta has its own copy of the video now; remove ours.
  if (spec.videoId && VIDEO_PATH_RE.test(String(d.videoPath || '')) && String(d.videoPath).startsWith(`${biz}/`)) {
    await require('./storage.cjs').remove(VIDEO_BUCKET, [String(d.videoPath)]).catch(() => false);
  }
  return {
    launch: done.data?.[0] || { ...launch, status: 'created', ad_id: String(ad.id) },
    ...(tallRefused ? { note: `Created with one picture everywhere: Meta didn't accept the separate Stories picture (${tallRefused}).` } : {}),
  };
}

/**
 * Business Admin: switch the created ad (and its ad set and campaign) on. Meta then reviews it.
 * @param {Staff} staff @param {unknown} launchId @param {unknown} confirmBudget  the daily budget, typed again
 */
async function launch(staff, launchId, confirmBudget) {
  const ctx = await wizardContext(staff, { needPage: false });
  if (ctx.error !== undefined) return { error: ctx.error };
  if (!UUID_RE.test(String(launchId || ''))) return { error: 'Invalid ad.' };
  const r = await dbRequest(`ad_launches?business_id=eq.${ctx.id}&id=eq.${launchId}&select=*`);
  const l = r.ok ? r.data?.[0] : null;
  if (!l) return { error: 'Not found.', status: 404 };
  if (l.status === 'launched') return { launch: l, already: true };
  if (l.status !== 'created' || !l.ad_id) return { error: 'This ad was not created completely; create it again.' };
  if (Number(confirmBudget) !== Number(l.daily_budget)) return { error: `Type the daily budget (${l.daily_budget}) to confirm.` };
  for (const [id, what] of [[l.campaign_id, 'campaign'], [l.adset_id, 'audience and budget'], [l.ad_id, 'ad']]) {
    const res = await ads.graph(ctx.version, ctx.token, String(id), { method: 'POST', form: { status: 'ACTIVE' } });
    if (res.error || res.success === false) return { error: `Meta didn't switch on the ${what}: ${ads.metaMsg(res)}`, status: 502 };
  }
  const done = await patchLaunch(ctx.id, l.id, { status: 'launched', launched_by: staff.email, launched_at: new Date().toISOString() });
  await ads.audit(staff, ctx.id, 'ads.ad_launched', { launchId: l.id, adId: l.ad_id, name: l.name, dailyBudget: Number(l.daily_budget) });
  return { launch: done.data?.[0] || { ...l, status: 'launched' } };
}

/** Ads created from the CRM (newest first; Business Admin and managers). @param {Staff} staff */
async function listLaunches(staff) {
  const biz = requireBusinessId(staff?.businessId);
  const r = await dbRequest(`ad_launches?business_id=eq.${biz}&select=id,name,status,error,daily_budget,currency,campaign_id,adset_id,ad_id,created_by,created_at,launched_by,launched_at,spec&order=created_at.desc&limit=100`);
  // The whole spec (this business's own ad): the Edit dialog starts from it.
  return { launches: r.ok ? (r.data || []).map((/** @type {Row} */ l) => ({ ...l, spec: l.spec || {}, scheduleLabel: l.spec?.schedule ? scheduleLabel(l.spec.schedule) : null, template: reuseOf(l) })) : [] };
}

// ---------------------------------------------------------------------------
// G2: edit an ad made here (Business Admin). Words / picture -> a new creative on the same ad (Meta reviews it
// again); audience, daily amount, end date and hours -> the ad set. The number the ad opens and the budget type
// (all day vs business hours) can't change after creation (Meta's rules): make a copy with "Use as a start".
// ---------------------------------------------------------------------------
const CREATIVE_KEYS = ['text', 'headline', 'greeting', 'imageHash', 'cards', 'iceBreakers', 'tallImageHash'];
const TARGET_KEYS = ['locations', 'ageMin', 'ageMax', 'gender', 'placement', 'interests', 'excludedLocations', 'languages'];
/** @param {Row} o @param {string[]} keys */
const sameAs = (o, keys) => JSON.stringify(keys.map(k => o?.[k] ?? null));

/**
 * Pure: the ad's settings after the requested changes (only known fields; tested). Returns { error } for changes
 * Meta doesn't allow here.
 * @param {Row} old  the saved spec @param {Row} input
 * @returns {{ error: string } | { next: Row }}
 */
function applyEdit(old, input) {
  const has = (/** @type {string} */ k) => Object.prototype.hasOwnProperty.call(input, k);
  const s = (/** @type {unknown} */ v) => String(v ?? '').trim();
  const next = { ...old };
  // I2: an existing post's words and picture are the post's own.
  if (old.post) {
    for (const k of ['text', 'headline', 'greeting', 'imageHash', 'cards', 'iceBreakers', 'tallImageHash', 'videoId', 'post']) {
      if (has(k) && JSON.stringify(input[k] ?? null) !== JSON.stringify(k === 'iceBreakers' ? (old[k] || []) : (old[k] ?? null))) {
        return { error: 'This ad uses an existing post: its words and picture are the post\'s own. Use "Add an ad" to promote another post.' };
      }
    }
  }
  for (const k of ['text', 'headline', 'greeting']) if (has(k)) next[k] = s(input[k]);
  const carousel = Array.isArray(old.cards) && old.cards.length >= 2;
  if (has('imageHash') && s(input.imageHash) !== s(old.imageHash)) {
    if (carousel) return { error: 'The pictures of a carousel can\'t be changed here. Use "Use as a start" to make a new ad.' };
    next.imageHash = s(input.imageHash);
    next.imageUrl = /^https:\/\//.test(s(input.imageUrl)) ? s(input.imageUrl).slice(0, 1000) : '';
  }
  // H1 / H2 / H3.
  if (has('iceBreakers')) next.iceBreakers = Array.isArray(input.iceBreakers) ? input.iceBreakers.map((/** @type {unknown} */ q) => s(q)).filter(Boolean) : [];
  if (has('tallImageHash') && s(input.tallImageHash) !== s(old.tallImageHash)) {
    if (carousel || old.videoId) return { error: 'The separate Stories picture is for single-picture ads only.' };
    next.tallImageHash = s(input.tallImageHash) || null;
    next.tallImageUrl = next.tallImageHash && /^https:\/\//.test(s(input.tallImageUrl)) ? s(input.tallImageUrl).slice(0, 1000) : '';
  }
  if (has('videoId') && s(input.videoId) !== s(old.videoId)) return { error: 'The video can\'t be swapped here. Use "Use as a start" to make a new ad with another video.' };
  if (has('cards') && carousel) {
    const cards = Array.isArray(input.cards) ? input.cards : [];
    if (cards.length !== old.cards.length) return { error: 'The pictures of a carousel can\'t be added or removed here.' };
    next.cards = old.cards.map((/** @type {Row} */ c, /** @type {number} */ i) => ({ ...c, headline: s(cards[i]?.headline) }));
  }
  for (const k of TARGET_KEYS) if (has(k)) next[k] = input[k];
  if (has('endDate')) {
    const end = s(input.endDate) || null;
    if (old.endDate && !end) return { error: 'The end date can be moved, not removed. Choose a later date instead.' };
    next.endDate = end;
  }
  if (has('schedule')) {
    if (!old.schedule && input.schedule) return { error: 'This ad runs all day; Meta doesn\'t let it switch to set hours. Use "Use as a start" to make a business-hours copy.' };
    if (old.schedule && !input.schedule) return { error: 'This ad runs in set hours; Meta doesn\'t let it switch to all day. Use "Use as a start" to make an all-day copy.' };
    if (input.schedule) {
      const sc = checkSchedule(input.schedule);
      if ('error' in sc) return { error: sc.error };
      next.schedule = sc.schedule;
    }
  }
  return { next };
}

/**
 * Business Admin: change an ad made here, in Meta and in the CRM's record.
 * @param {Staff} staff @param {unknown} launchId @param {Row} input  changed fields, dailyBudget, confirmBudget
 */
async function editAd(staff, launchId, input = {}) {
  const ctx = await wizardContext(staff);
  if (ctx.error !== undefined) return { error: ctx.error };
  if (!UUID_RE.test(String(launchId || ''))) return { error: 'Invalid ad.' };
  const r = await dbRequest(`ad_launches?business_id=eq.${ctx.id}&id=eq.${launchId}&select=*`);
  const l = r.ok ? r.data?.[0] : null;
  if (!l) return { error: 'Not found.', status: 404 };
  if (!['created', 'launched'].includes(l.status) || !l.ad_id || !l.adset_id) return { error: 'Only ads that were created completely can be edited.' };
  const old = l.spec || {};
  const applied = applyEdit(old, input || {});
  if ('error' in applied) return { error: applied.error };
  const next = applied.next;
  const before = Number(l.daily_budget);
  const daily = input.dailyBudget !== undefined && input.dailyBudget !== null && input.dailyBudget !== '' ? Math.round(Number(input.dailyBudget) * 100) / 100 : before;

  const { row, token, version } = ctx;
  const acct = await ads.graph(version, token, `${row.ad_account_id}?fields=min_daily_budget,currency`);
  const factor = ads.minorFactor(acct.currency || row.currency || 'INR');
  const minDailyBudget = acct.min_daily_budget !== undefined ? Math.ceil(Number(acct.min_daily_budget) / factor) : null;
  const errs = validateDraft({ ...next, draftId: l.draft_id, name: l.name, dailyBudget: daily }, { minDailyBudget, maxDailyBudget: Number(row.max_daily_budget) || DEFAULT_CAP, editing: true });
  if (errs.length) return { error: errs[0], problems: errs };
  const check = textCheck(next);
  if (check.blocks.length) return { error: check.blocks[0], problems: check.blocks };
  if (next.placement === 'with_status' && old.placement !== 'with_status' && await isHealthcare(ctx.id)) {
    return { error: 'Meta doesn\'t allow WhatsApp Status ads for healthcare and pharma businesses. Choose another placement.' };
  }
  // More money needs the new amount typed again (as when launching).
  if (daily > before && Number(input.confirmBudget) !== daily) return { error: `Type the new daily amount (${daily}) to confirm the increase.`, needsConfirm: true };

  const creativeChanged = sameAs(old, CREATIVE_KEYS) !== sameAs(next, CREATIVE_KEYS) || (old.placement === 'with_status') !== (next.placement === 'with_status');
  const targetChanged = sameAs(old, TARGET_KEYS) !== sameAs(next, TARGET_KEYS);
  const endChanged = (old.endDate || null) !== (next.endDate || null);
  const scheduleChanged = JSON.stringify(old.schedule || null) !== JSON.stringify(next.schedule || null);
  const budgetChanged = daily !== before;
  /** @type {string[]} */
  const changed = [
    ...(creativeChanged ? ['words or picture'] : []), ...(targetChanged ? ['audience'] : []), ...(budgetChanged ? ['budget'] : []),
    ...(endChanged ? ['end date'] : []), ...(scheduleChanged ? ['hours'] : []),
  ];
  if (!changed.length) return { launch: l, changed, unchanged: true };
  // I1: an ad that shares its ad set changes only its own words / picture; the shared settings belong to the ad it
  // was added to (one place to change them, so the two never disagree).
  if (old.sharedAdset && (targetChanged || budgetChanged || endChanged || scheduleChanged)) {
    return { error: 'This ad shares its audience, budget and dates with the ad it was added to. Change them on that ad.' };
  }

  // 1. The ad set: audience, budget, end date, hours (one call).
  /** @type {Record<string, string>} */
  const adsetForm = {};
  if (targetChanged) adsetForm.targeting = JSON.stringify(targetingFor(next));
  if (endChanged) adsetForm.end_time = `${next.endDate}T23:59:00+0530`;
  if (next.schedule) {
    if (budgetChanged || endChanged || scheduleChanged) adsetForm.lifetime_budget = String(Math.round(lifetimeBudgetOf(daily, next) * factor));
    if (scheduleChanged) adsetForm.adset_schedule = JSON.stringify(adsetScheduleOf(next.schedule));
  } else if (budgetChanged) {
    adsetForm.daily_budget = String(Math.round(daily * factor));
  }
  if (Object.keys(adsetForm).length) {
    const res = await ads.graph(version, token, String(l.adset_id), { method: 'POST', form: adsetForm });
    if (res.error || res.success === false) return { error: `Meta didn't save the audience / budget / dates: ${ads.metaMsg(res)}`, status: 502 };
    await syncShared(ctx.id, l, next, daily);
  }

  // 2. Words or picture: a new creative on the same ad (Meta reviews the ad again).
  let creativeId = l.creative_id;
  if (creativeChanged) {
    const saveSoFar = { ...next, ...Object.fromEntries(CREATIVE_KEYS.map(k => [k, old[k]])), imageUrl: old.imageUrl, placement: old.placement };
    const partly = async (/** @type {string} */ msg) => {
      if (Object.keys(adsetForm).length) await patchLaunch(ctx.id, l.id, { spec: saveSoFar, daily_budget: daily });
      return { error: Object.keys(adsetForm).length ? `${msg} The audience, budget and dates were saved.` : msg, status: 502 };
    };
    const ig = next.useInstagram === false ? null : await instagramOf(version, token, row.page_id);
    const { creative, tallRefused } = await createCreative(version, token, row.ad_account_id, creativeFormsFor(next, row.page_id, ig?.id || null, `${l.name} – creative (edited)`, next.number || ''));
    if (creative.error || !creative.id) return partly(`Meta refused the new words / picture: ${ads.metaMsg(creative)}.`);
    if (tallRefused) next.tallImageHash = null;
    const swap = await ads.graph(version, token, String(l.ad_id), { method: 'POST', form: { creative: JSON.stringify({ creative_id: String(creative.id) }) } });
    if (swap.error || swap.success === false) return partly(`Meta didn't put the new words / picture on the ad: ${ads.metaMsg(swap)}.`);
    creativeId = String(creative.id);
  }

  const done = await patchLaunch(ctx.id, l.id, { spec: next, daily_budget: daily, creative_id: creativeId });
  await ads.audit(staff, ctx.id, 'ads.ad_edited', { launchId: l.id, adId: l.ad_id, name: l.name, changed, budgetBefore: before, budgetAfter: daily });
  const saved = done.data?.[0] || { ...l, spec: next, daily_budget: daily };
  return { launch: { ...saved, scheduleLabel: next.schedule ? scheduleLabel(next.schedule) : null }, changed, review: creativeChanged };
}

/**
 * Business Admin: delete an ad made here.
 *   - Never reached Meta (failed, or stuck "creating" for 10+ minutes): only removed from the list.
 *   - In Meta: the ad is deleted; then its ad set if no ad is left in it, then its campaign if no ad set is left
 *     (asked of Meta, so ads added in Ads Manager are never lost). Other ads of the campaign stay; one that
 *     shared this ad's audience and budget becomes the ad set's own (editable) ad.
 * Spend already made stays in Meta's reports and the CRM's results. Own business only; audited.
 * @param {Staff} staff @param {unknown} launchId
 */
async function deleteLaunch(staff, launchId) {
  const biz = requireBusinessId(staff?.businessId);
  if (!UUID_RE.test(String(launchId || ''))) return { error: 'Invalid ad.' };
  const r = await dbRequest(`ad_launches?business_id=eq.${biz}&id=eq.${launchId}&select=*`);
  const l = r.ok ? r.data?.[0] : null;
  if (!l) return { error: 'Not found.', status: 404 };
  const removeRow = () => dbRequest(`ad_launches?business_id=eq.${biz}&id=eq.${l.id}`, { method: 'DELETE', prefer: 'return=minimal' });
  const inMeta = ['created', 'launched'].includes(l.status) && l.ad_id;
  if (!inMeta) {
    const stale = Date.now() - Date.parse(l.updated_at || l.created_at || 0) > 10 * 60000;
    if (l.status === 'creating' && !stale) return { error: 'This ad is still being created. Try again in a few minutes.' };
    await removeRow();
    await ads.audit(staff, biz, 'ads.ad_removed_from_list', { launchId: l.id, name: l.name, status: l.status });
    return { deleted: true, inMeta: false };
  }
  const ctx = await wizardContext(staff, { needPage: false });
  if (ctx.error !== undefined) return { error: ctx.error };
  const { token, version } = ctx;
  /** Deleted, or already gone in Meta. @param {Row} res */
  const gone = (res) => !res.error || /does not exist|not found|deleted|Unsupported (get|delete) request/i.test(ads.metaMsg(res));
  const delAd = await ads.graph(version, token, String(l.ad_id), { method: 'DELETE' });
  if (!gone(delAd)) return { error: `Meta didn't delete the ad: ${ads.metaMsg(delAd)}`, status: 502 };
  /** @type {string[]} */
  const removed = ['ad'];
  // Its ad set and campaign, once empty (Meta's own list: ads made in Ads Manager count too).
  if (l.adset_id) {
    const left = await ads.graph(version, token, `${l.adset_id}/ads?fields=id&limit=1`);
    if (!left.error && !(left.data || []).length) {
      const d = await ads.graph(version, token, String(l.adset_id), { method: 'DELETE' });
      if (gone(d)) removed.push('ad set');
    }
  }
  if (l.campaign_id && removed.includes('ad set')) {
    const left = await ads.graph(version, token, `${l.campaign_id}/adsets?fields=id&limit=1`);
    if (!left.error && !(left.data || []).length) {
      const d = await ads.graph(version, token, String(l.campaign_id), { method: 'DELETE' });
      if (gone(d)) removed.push('campaign');
    }
  }
  await removeRow();
  // An ad that shared this ad's audience and budget now owns them (so it can be edited).
  if (l.adset_id && !l.spec?.sharedAdset) {
    const sib = await dbRequest(`ad_launches?business_id=eq.${biz}&adset_id=eq.${encodeURIComponent(String(l.adset_id))}&select=id,spec,created_at&order=created_at.asc`);
    const heir = (sib.ok ? sib.data || [] : []).find((/** @type {Row} */ x) => x.spec?.sharedAdset);
    if (heir) {
      const { addedTo: _a, sharedAdset: _s, ...rest } = heir.spec || {};
      await patchLaunch(biz, heir.id, { spec: rest });
    }
  }
  await ads.audit(staff, biz, 'ads.ad_deleted', { launchId: l.id, adId: String(l.ad_id), name: l.name, removed });
  return { deleted: true, inMeta: true, removed };
}

/**
 * I1: the ads added to the same ad set ("same audience and budget") keep the same settings in the CRM's record.
 * @param {string} biz @param {Row} l  the edited ad @param {Row} next  its new spec @param {number} daily
 */
async function syncShared(biz, l, next, daily) {
  const r = await dbRequest(`ad_launches?business_id=eq.${biz}&adset_id=eq.${encodeURIComponent(String(l.adset_id))}&select=id,spec`);
  for (const o of (r.ok ? r.data || [] : []).filter((/** @type {Row} */ x) => x.id !== l.id)) {
    const spec = { ...(o.spec || {}), ...Object.fromEntries(ADSET_KEYS.map(k => [k, next[k] ?? null])) };
    await patchLaunch(biz, o.id, { spec, daily_budget: daily });
  }
}

// Ads that still count (running, paused, in review or with a problem); deleted / archived ones don't.
const LIVE_AD_STATUSES = ['ACTIVE', 'PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'IN_PROCESS', 'PENDING_REVIEW', 'PREAPPROVED', 'WITH_ISSUES', 'PENDING_BILLING_INFO', 'DISAPPROVED'];
/** @param {unknown} s */
const usageStatus = (s) => {
  const v = String(s || '');
  return v === 'ACTIVE' ? 'running' : ['IN_PROCESS', 'PENDING_REVIEW', 'PREAPPROVED'].includes(v) ? 'in review' : ['WITH_ISSUES', 'PENDING_BILLING_INFO', 'DISAPPROVED'].includes(v) ? 'has a problem' : 'paused';
};

/**
 * Pure: which posts the ad account's ads already use (tested): { [post id]: [{ name, status }] }. Facebook posts by
 * the creative's effective_object_story_id / object_story_id, Instagram posts by effective_instagram_media_id /
 * source_instagram_media_id (Meta's ad creative fields). Ads made with a new picture use a hidden post of their
 * own, so they never match a published post.
 * @param {Row[]} adsData
 * @returns {Record<string, Array<{ name: string, status: string }>>}
 */
function postUsageOf(adsData) {
  /** @type {Record<string, Array<{ name: string, status: string }>>} */
  const out = {};
  for (const ad of Array.isArray(adsData) ? adsData : []) {
    const c = ad?.creative || {};
    const ids = new Set([c.effective_object_story_id, c.object_story_id, c.effective_instagram_media_id, c.source_instagram_media_id].filter(Boolean).map(String));
    for (const id of ids) (out[id] ||= []).push({ name: String(ad.name || 'Ad').slice(0, 80), status: usageStatus(ad.effective_status) });
  }
  return out;
}

/**
 * I2: the ads in this business's ad account that use existing posts (up to 600 ads, best effort: on an error the
 * picker still works, without the labels). @param {string} version @param {string} token @param {string} account
 */
async function postUsage(version, token, account) {
  const statuses = encodeURIComponent(JSON.stringify(LIVE_AD_STATUSES));
  let url = `${account}/ads?fields=name,effective_status,creative{effective_object_story_id,object_story_id,effective_instagram_media_id,source_instagram_media_id}&effective_status=${statuses}&limit=200`;
  /** @type {Row[]} */
  const all = [];
  for (let page = 0; page < 3 && url; page++) {
    const r = await ads.graph(version, token, url);
    if (r.error) return { usage: postUsageOf(all), error: ads.metaMsg(r) };
    all.push(...(r.data || []));
    url = typeof r.paging?.next === 'string' ? r.paging.next : '';
  }
  return { usage: postUsageOf(all), error: null };
}

/** I2: the Page's recent Facebook posts, or the Instagram account's, for "Use an existing post" (each marked with the ads already using it). @param {Staff} staff @param {unknown} source */
async function listPosts(staff, source) {
  const ctx = await wizardContext(staff);
  if (ctx.error !== undefined) return { error: ctx.error };
  const r = await listPostsRaw(ctx, source);
  if ('error' in r) return r;
  const { usage, error } = await postUsage(ctx.version, ctx.token, ctx.row.ad_account_id);
  return {
    ...r,
    posts: r.posts.map(p => ({ ...p, inAds: usage[p.id] || [] })),
    usageNote: error ? `Couldn't check which posts are already in ads (Meta: ${error}).` : null,
  };
}

/** @param {{ row: Row, token: string, version: string }} ctx @param {unknown} source @returns {Promise<{ error: string, status?: number } | { posts: Row[], instagram?: Row }>} */
async function listPostsRaw(ctx, source) {
  const { row, token, version } = ctx;
  if (source === 'instagram') {
    const ig = await instagramOf(version, token, row.page_id);
    if (!ig) return { error: 'No Instagram account is connected to the Facebook Page (or the token can\'t see it).' };
    const r = await ads.graph(version, token, `${ig.id}/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,boost_eligibility_info&limit=24`);
    if (r.error) return { error: `Meta didn't list the Instagram posts: ${ads.metaMsg(r)}. The token may need the instagram_basic permission.`, status: 502 };
    return { posts: postsOf('instagram', r.data), instagram: ig };
  }
  if (source !== 'facebook') return { error: 'Choose Facebook or Instagram.' };
  const path = `${row.page_id}/published_posts?fields=id,message,full_picture,permalink_url,created_time,is_eligible_for_promotion,is_instagram_eligible&limit=24`;
  let r = await ads.graph(version, token, path);
  if (r.error) {
    // Reading a Page's posts may need the Page's own token: asked for here, used once, never stored or returned.
    const p = await ads.graph(version, token, `${row.page_id}?fields=access_token`);
    if (!p.error && typeof p.access_token === 'string' && p.access_token) r = await ads.graph(version, p.access_token, path);
  }
  if (r.error) return { error: `Meta didn't list the Page's posts: ${ads.metaMsg(r)}. The token needs pages_read_engagement for the Page.`, status: 502 };
  return { posts: postsOf('facebook', r.data) };
}

/**
 * F4: what a new ad can start from when duplicating one made here (no dates, a new name; pictures are reused by
 * Meta's image hash, so nothing is uploaded again). Pure.
 * @param {Row} l  an ad_launches row
 */
function reuseOf(l) {
  const s = l?.spec || {};
  const cards = Array.isArray(s.cards) ? s.cards.filter((/** @type {Row} */ c) => IMAGE_HASH_RE.test(String(c?.imageHash || ''))).slice(0, MAX_CARDS) : [];
  return {
    name: `${String(l?.name || 'Ad').slice(0, LIMITS.name - 7)} (copy)`,
    text: String(s.text || ''), headline: String(s.headline || ''), greeting: String(s.greeting || ''),
    imageHash: IMAGE_HASH_RE.test(String(s.imageHash || '')) ? String(s.imageHash) : '', imageUrl: String(s.imageUrl || ''),
    cards: cards.length >= 2 ? cards.map((/** @type {Row} */ c) => ({ imageHash: String(c.imageHash), imageUrl: String(c.imageUrl || ''), headline: String(c.headline || '') })) : [],
    locations: Array.isArray(s.locations) ? s.locations : [],
    ageMin: Number(s.ageMin) || 18, ageMax: Number(s.ageMax) || 65, gender: ['all', 'male', 'female'].includes(s.gender) ? s.gender : 'all',
    placement: PLACEMENTS.includes(s.placement) ? s.placement : 'auto', number: String(s.number || ''), useInstagram: s.useInstagram !== false,
    dailyBudget: Number(l?.daily_budget) || null,
    schedule: s.schedule && !('error' in checkSchedule(s.schedule)) ? s.schedule : null,
    // Phase H (the video itself isn't reused: a new ad gets its own upload).
    iceBreakers: Array.isArray(s.iceBreakers) ? s.iceBreakers.map(String).slice(0, MAX_ICE_BREAKERS) : [],
    tallImageHash: IMAGE_HASH_RE.test(String(s.tallImageHash || '')) ? String(s.tallImageHash) : '', tallImageUrl: String(s.tallImageUrl || ''),
    interests: Array.isArray(s.interests) ? s.interests.slice(0, MAX_INTERESTS) : [],
    excludedLocations: Array.isArray(s.excludedLocations) ? s.excludedLocations.slice(0, MAX_EXCLUDED) : [],
    languages: Array.isArray(s.languages) ? s.languages.slice(0, MAX_LANGUAGES) : [],
    // I2: the same existing post.
    post: s.post && !('error' in checkPost(s.post)) ? /** @type {{ post: Row }} */ (checkPost(s.post)).post : null,
  };
}

module.exports = {
  readiness, choosePage, setBudgetCap, buildChecklist, matchNumber, reuseOf, NEEDED_PERMISSIONS, DEFAULT_CAP,
  textCheck, validateDraft, targetingFor, storyFor, uploadImage, searchLocations, estimate, preview, createAd, launch, listLaunches,
  // G1 / G2: business hours, editing.
  checkSchedule, scheduledDays, adsetScheduleOf, scheduleLabel, lifetimeBudgetOf, applyEdit, editAd,
  // Phase H: quick questions, tall picture, video, interests / excluded places / languages.
  welcomeOf, placementFeedFor, creativeFormsFor, searchInterests, searchLanguages, videoUploadUrl, registerVideo, videoStatus, MAX_VIDEO_BYTES,
  // Phase I: more ads per campaign, existing posts.
  addToCampaign, checkPost, postsOf, postCreativeFor, listPosts, postUsageOf, MAX_ADS_PER_CAMPAIGN, deleteLaunch,
};
