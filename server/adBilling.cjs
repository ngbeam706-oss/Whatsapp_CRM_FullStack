// @ts-check
// Ads billing card: what Meta says about the ad account's payments, shown on the Ads page.
//   * prepaid or automatic payments, the payment method as Meta describes it, amount due (spend not yet charged),
//     total spent, the account spending limit, and payment problems (Meta pauses every ad when a payment fails);
//   * read with the hourly ads sync (server/ads.cjs syncAccount) and on "Check now" (at most once a minute),
//     kept on business_ad_accounts.billing (migration 20261129), so visits don't call Meta;
//   * the Business Admin can set or remove the account spending limit (audited).
// The CRM never takes, holds or adds money: Meta's API has no way to pay or add funds. "Add funds" / "View bills"
// open Meta's own billing page for the ad account.
const { dbRequest } = require('./db.cjs');
const { requireBusinessId } = require('./tenant.cjs');
const ads = require('./ads.cjs');

/** @typedef {Record<string, any>} Row */
/**
 * @typedef {{ status: number | null, statusLabel: string, problem: 'payment' | 'disabled' | 'review' | 'closed' | null,
 *   problemText: string | null, disableReason: number | null, prepaid: boolean | null, due: number | null, spent: number | null,
 *   spendCap: number | null, method: string | null, currency: string }} Billing
 */

const CHECK_GAP_MS = 60 * 1000;
const MAX_CAP = 100000000; // ₹10 crore: a typo guard, not a business rule
const BASE_FIELDS = 'account_status,disable_reason,balance,amount_spent,spend_cap,is_prepay_account,currency';

/** Meta's account_status codes (Marketing API reference). */
const STATUS = /** @type {Record<number, [string, Billing['problem'], string | null]>} */ ({
  1: ['Active', null, null],
  2: ['Disabled', 'disabled', 'Meta has disabled this ad account, so no ads run. Open Meta to see why and to appeal.'],
  3: ['Payment failed', 'payment', 'A payment failed and money is owed, so Meta has paused every ad on this account. Pay the amount due in Meta to restart them.'],
  7: ['Under review', 'review', 'Meta is reviewing this ad account. Ads may not run until the review is finished.'],
  8: ['Payment pending', 'payment', 'Meta is waiting for a payment to be settled. Ads may stop until it is paid.'],
  9: ['Grace period', 'payment', 'A payment problem needs fixing. Ads still run for a short grace period, then Meta pauses them.'],
  100: ['Closing', 'closed', 'This ad account is being closed.'],
  101: ['Closed', 'closed', 'This ad account is closed.'],
});
const DISABLE_REASON = /** @type {Record<number, string>} */ ({
  1: 'ads policy', 2: 'IP review', 3: 'a payment risk', 4: 'a gray account', 5: 'an advertiser review', 6: 'a business review',
  7: 'a permanent closure', 8: 'an unused reseller account', 9: 'an unused account', 10: 'an umbrella ad account',
  11: 'a business manager integrity policy', 12: 'a misrepresented ad account', 13: 'ad account disapproval', 14: 'a compromised business', 15: 'a compromised ad account',
});

/** @param {unknown} v @param {number} factor @returns {number | null} */
const money = (v, factor) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round((n / factor) * 100) / 100 : null;
};

/**
 * Pure: Meta's ad account fields -> what the Ads page shows (tested). Money comes in the currency's smallest unit.
 * @param {Row} acct @param {string} [fallbackCurrency]
 * @returns {Billing}
 */
function parseBilling(acct, fallbackCurrency = 'INR') {
  const currency = String(acct?.currency || fallbackCurrency || 'INR').toUpperCase();
  const factor = ads.minorFactor(currency);
  const status = Number.isFinite(Number(acct?.account_status)) && acct?.account_status !== undefined ? Number(acct.account_status) : null;
  const [label, problem, text] = status !== null && STATUS[status] ? STATUS[status] : [status === null ? 'Unknown' : `Status ${status}`, null, null];
  const disableReason = Number(acct?.disable_reason) > 0 ? Number(acct.disable_reason) : null;
  const cap = money(acct?.spend_cap, factor);
  const details = acct?.funding_source_details;
  const method = details && typeof details.display_string === 'string' && details.display_string.trim() ? details.display_string.trim().slice(0, 120) : null;
  return {
    status, statusLabel: label, problem,
    problemText: text && problem === 'disabled' && disableReason && DISABLE_REASON[disableReason] ? `${text} Meta's reason: ${DISABLE_REASON[disableReason]}.` : text,
    disableReason,
    prepaid: typeof acct?.is_prepay_account === 'boolean' ? acct.is_prepay_account : null,
    due: money(acct?.balance, factor),
    spent: money(acct?.amount_spent, factor),
    spendCap: cap && cap > 0 ? cap : null, // 0 = no limit
    method,
    currency,
  };
}

/** Meta's billing page for this ad account (Add funds, payment methods, bills). @param {string} adAccountId */
const billingUrl = (adAccountId) => `https://business.facebook.com/billing_hub/accounts/details/?asset_id=${encodeURIComponent(String(adAccountId).replace(/^act_/, ''))}`;

/**
 * Read the billing fields from Meta. The payment method needs the token's MANAGE task; without it the rest still loads.
 * @param {string} version @param {string} token @param {string} adAccountId @param {string} currency
 * @returns {Promise<{ error: string } | { billing: Billing }>}
 */
async function fetchBilling(version, token, adAccountId, currency) {
  let acct = await ads.graph(version, token, `${adAccountId}?fields=${BASE_FIELDS},funding_source_details`);
  if (acct.error) acct = await ads.graph(version, token, `${adAccountId}?fields=${BASE_FIELDS}`);
  if (acct.error) return { error: `Meta says: ${ads.metaMsg(acct)}` };
  return { billing: parseBilling(acct, currency) };
}

// ---------------------------------------------------------------------------
// Who owns what (guidance): the business portfolio that owns the ad account, and the one that owns the WhatsApp
// account. When they differ (or the ad account belongs to a person), ads still run, but payment and access are
// controlled outside the business's own portfolio: the Ads page says so and links to "How Meta is organised".
// ---------------------------------------------------------------------------
/** @typedef {{ id: string, name: string }} Portfolio */
/**
 * @typedef {{ adAccount: Portfolio | null, personal: boolean, adKnown: boolean, whatsapp: Portfolio | null,
 *   same: boolean | null }} Ownership
 */

/** @param {any} v @returns {Portfolio | null} */
const portfolioOf = (v) => (v && /^\d{1,25}$/.test(String(v.id || '')) ? { id: String(v.id), name: String(v.name || '').slice(0, 120) || `Portfolio ${v.id}` } : null);

/**
 * Pure: the ownership picture from Meta's answers (tested). acct: { business?, owner? } or { error }; waba: { owner_business_info? } or null.
 * @param {Row} acct @param {Row | null} waba @returns {Ownership}
 */
function parseOwnership(acct, waba) {
  const adKnown = !!acct && !acct.error;
  const adAccount = adKnown ? portfolioOf(acct.business) : null;
  // No owning business, but Meta names an owner: a personal ad account.
  const personal = adKnown && !adAccount && /^\d{1,25}$/.test(String(acct.owner || ''));
  const whatsapp = waba && !waba.error ? portfolioOf(waba.owner_business_info) : null;
  const same = adAccount && whatsapp ? adAccount.id === whatsapp.id : personal && whatsapp ? false : null;
  return { adAccount, personal, adKnown, whatsapp, same };
}

/** Read both owners from Meta (best effort: a refused field just leaves that part unknown). @param {string} businessId @param {Row} row @param {string} version @param {string} token */
async function fetchOwnership(businessId, row, version, token) {
  const acct = await ads.graph(version, token, `${row.ad_account_id}?fields=business{id,name},owner`);
  /** @type {Row | null} */
  let waba = null;
  try {
    const wa = await require('./whatsapp.cjs').getWhatsApp(businessId);
    if (wa?.wabaId && /^\d{5,25}$/.test(String(wa.wabaId)) && wa.token) waba = await ads.graph(version, wa.token, `${wa.wabaId}?fields=owner_business_info`);
  } catch { /* unknown */ }
  return parseOwnership(acct, waba);
}

/**
 * Read from Meta and save on the ad account row; log once when a payment problem starts.
 * Used by the hourly sync (ads.syncAccount) and "Check now". The snapshot also carries who owns the ad account.
 * @param {string} businessId @param {Row} row @param {string} version @param {string} token
 */
async function refresh(businessId, row, version, token) {
  const r = await fetchBilling(version, token, row.ad_account_id, row.currency);
  if ('error' in r) return r;
  const ownership = await fetchOwnership(businessId, row, version, token).catch(() => null);
  /** @type {Billing & { ownership?: Ownership | null }} */
  const snapshot = { ...r.billing, ownership };
  const before = row.billing && typeof row.billing === 'object' ? row.billing.problem : null;
  const now = new Date().toISOString();
  const saved = await dbRequest(`business_ad_accounts?business_id=eq.${businessId}`, {
    method: 'PATCH', prefer: 'return=minimal', body: { billing: snapshot, billing_checked_at: now },
  });
  if (!saved.ok) return { error: 'Could not save the billing details. Has the ads billing SQL (20261129) been run?' };
  if (r.billing.problem && r.billing.problem !== before) {
    await require('./events.cjs').logEvent({ level: 'warn', source: 'ads', businessId, code: `billing_${r.billing.problem}`, message: `Ad account ${r.billing.statusLabel.toLowerCase()}` });
  }
  return { billing: snapshot, checkedAt: now };
}

/** @param {Row} row @param {boolean} isOwner */
function view(row, isOwner) {
  const billing = row.billing && typeof row.billing === 'object' ? row.billing : null;
  return { billing, checkedAt: row.billing_checked_at || null, billingUrl: billingUrl(row.ad_account_id), canEditLimit: isOwner };
}

/** GET /api/ads/billing (managers + Business Admin): the saved snapshot, no Meta call. @param {{ businessId: string, role: string }} staff */
async function status(staff) {
  const ctx = await ads.controlContext(staff?.businessId);
  if (ctx.error !== undefined) return { error: ctx.error };
  return view(ctx.row, staff.role === 'owner');
}

/** "Check now": read Meta again (at most once a minute per business). @param {{ businessId: string, role: string }} staff */
async function checkNow(staff) {
  const ctx = await ads.controlContext(staff?.businessId);
  if (ctx.error !== undefined) return { error: ctx.error };
  const last = Date.parse(ctx.row.billing_checked_at || '');
  if (Number.isFinite(last) && Date.now() - last < CHECK_GAP_MS) return { ...view(ctx.row, staff.role === 'owner'), note: 'Checked less than a minute ago.' };
  const r = await refresh(ctx.id, ctx.row, ctx.version, ctx.token);
  if ('error' in r) return { error: r.error };
  return { ...view({ ...ctx.row, billing: r.billing, billing_checked_at: r.checkedAt }, staff.role === 'owner') };
}

/**
 * Pure: check a new account spending limit (tested). null / '' / 0 = remove the limit.
 * @param {unknown} input @returns {{ error: string } | { remove: true } | { value: number }}
 */
function checkCap(input) {
  if (input === null || input === undefined || input === '' || input === 0 || input === '0') return { remove: true };
  const n = typeof input === 'number' ? input : typeof input === 'string' && /^\d+(\.\d{1,2})?$/.test(input.trim()) ? Number(input) : NaN;
  if (!Number.isFinite(n) || n < 0) return { error: 'Enter the limit as an amount, e.g. 50000.' };
  if (n < 100) return { error: 'Use a limit of at least 100.' };
  if (n > MAX_CAP) return { error: 'That limit looks too high. Check the number of zeros.' };
  return { value: Math.round(n * 100) / 100 };
}

/**
 * Business Admin: set or remove the ad account spending limit at Meta (the whole account stops spending at it).
 * @param {import('./types.cjs').Staff} staff @param {unknown} input
 */
async function setSpendCap(staff, input) {
  if (staff?.role !== 'owner') return { error: 'Only the Business Admin can change the account spending limit.' };
  const ctx = await ads.controlContext(staff.businessId);
  if (ctx.error !== undefined) return { error: ctx.error };
  const checked = checkCap(input);
  if ('error' in checked) return { error: checked.error };
  const before = ctx.row.billing && typeof ctx.row.billing === 'object' ? ctx.row.billing.spendCap ?? null : null;
  // Meta takes the new limit in the currency's normal unit (e.g. 50000 = ₹50,000); 'delete' removes it.
  /** @type {Record<string, string>} */
  const form = 'remove' in checked ? { spend_cap_action: 'delete' } : { spend_cap: String(checked.value) };
  const w = await ads.graph(ctx.version, ctx.token, ctx.row.ad_account_id, { method: 'POST', form });
  if (w.error) return { error: ads.actionError(w) };
  const r = await refresh(ctx.id, ctx.row, ctx.version, ctx.token);
  await ads.audit(staff, ctx.id, 'ads.spend_cap_changed', { adAccountId: ctx.row.ad_account_id, before, after: 'remove' in checked ? null : checked.value });
  if ('error' in r) return { error: `The limit was changed, but reading it back failed: ${r.error}` };
  return view({ ...ctx.row, billing: r.billing, billing_checked_at: r.checkedAt }, true);
}

/** For the Ads menu badge: is there a payment / account problem right now? @param {string} businessId */
async function problemOf(businessId) {
  const r = await dbRequest(`business_ad_accounts?business_id=eq.${requireBusinessId(businessId)}&select=billing`);
  const b = r.ok ? r.data?.[0]?.billing : null;
  return b && typeof b === 'object' && b.problem ? { problem: String(b.problem), label: String(b.statusLabel || '') } : null;
}

module.exports = { parseBilling, parseOwnership, billingUrl, fetchBilling, refresh, status, checkNow, checkCap, setSpendCap, problemOf, CHECK_GAP_MS };
