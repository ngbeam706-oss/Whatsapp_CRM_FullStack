// @ts-check
// Plan limits and usage, per business.
//
// A business's limits = its plan's limits, with any per-business `limit_overrides` on top
// (set by the Platform Admin). null = unlimited. Usage is counted per India-time month in
// usage_counters (broadcast messages sent, AI replies) or counted live (team, contacts,
// active follow-ups, keyword rules).
//
// Never blocked by a limit: incoming customer messages, and staff replying to customers.
const { dbRequest, countRows } = require('./db.cjs');
const { requireBusinessId } = require('./tenant.cjs');

/**
 * @typedef {'max_staff' | 'max_contacts' | 'max_broadcasts_month' | 'max_automations' | 'max_ai_replies_month'
 *   | 'max_keyword_rules' | 'analytics_days' | 'max_whatsapp_numbers'
 *   | 'max_custom_fields' | 'max_import_rows_per_file' | 'max_import_file_mb' | 'max_import_rows_month'} LimitKey
 * @typedef {Record<LimitKey, number | null> & { ai_enabled: boolean, ads_enabled: boolean }} Limits  null = unlimited
 * @typedef {'staff' | 'contacts' | 'broadcasts' | 'automations' | 'aiReplies' | 'keywordRules'} Metric
 * @typedef {{ planId: string | null, planName: string, limits: Limits, paidUntil: string | null, status: string }} PlanInfo
 */

const CACHE_MS = 60 * 1000;
/** @type {Map<string, { at: number, value: PlanInfo }>} */
const cache = new Map();
const GRACE_DAYS = 7;    // after "paid until", the business keeps working this long, then is suspended
const WARN_AT = 0.8;

/** @type {LimitKey[]} */
// max_whatsapp_numbers: main + extra WhatsApp numbers (checked in server/whatsappNumbers.cjs, not a usage metric,
// so a one-number business is never shown "100% of your plan"). The customer-import limits (SQL 20261142) are checked in
// server/customFields.cjs and server/leadImport.cjs.
const LIMIT_KEYS = ['max_staff', 'max_contacts', 'max_broadcasts_month', 'max_automations', 'max_ai_replies_month', 'max_keyword_rules', 'analytics_days', 'max_whatsapp_numbers', 'max_custom_fields', 'max_import_rows_per_file', 'max_import_file_mb', 'max_import_rows_month'];
/** @type {Record<Metric, { limit: LimitKey, label: string }>} */
const METRICS = {
  staff: { limit: 'max_staff', label: 'Team members' },
  contacts: { limit: 'max_contacts', label: 'Contacts' },
  broadcasts: { limit: 'max_broadcasts_month', label: 'Broadcast messages this month' },
  automations: { limit: 'max_automations', label: 'Active follow-ups' },
  aiReplies: { limit: 'max_ai_replies_month', label: 'AI replies this month' },
  keywordRules: { limit: 'max_keyword_rules', label: 'Keyword rules' },
};

/** "2026-11": the usage month, in India time (same as the add_usage database function). @param {number} [now] */
function currentPeriod(now = Date.now()) {
  const ist = new Date(now + 330 * 60000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Plan limits with the business's overrides on top. Pure.
 * @param {Record<string, any>} [plan]  a plans row
 * @param {Record<string, any>} [overrides]  businesses.limit_overrides
 * @returns {Limits}
 */
function effectiveLimits(plan = {}, overrides = {}) {
  const out = /** @type {Limits} */ ({});
  for (const k of LIMIT_KEYS) {
    const o = overrides && Object.prototype.hasOwnProperty.call(overrides, k) ? overrides[k] : undefined;
    const v = o !== undefined ? o : plan[k];
    out[k] = v === null || v === undefined || v === '' ? null : Number(v);
  }
  out.ai_enabled = overrides && 'ai_enabled' in overrides ? !!overrides.ai_enabled : plan.ai_enabled !== false;
  // Ads module: off unless the plan (or an override) switches it on.
  out.ads_enabled = overrides && 'ads_enabled' in overrides ? !!overrides.ads_enabled : plan.ads_enabled === true;
  return out;
}

/**
 * The business's plan, limits and billing state (cached for a minute).
 * @param {string} businessId
 * @param {{ fresh?: boolean }} [options]
 * @returns {Promise<PlanInfo>}
 */
async function getPlan(businessId, { fresh = false } = {}) {
  const id = requireBusinessId(businessId);
  const hit = cache.get(id);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const b = await dbRequest(`businesses?id=eq.${id}&select=plan_id,limit_overrides,paid_until,status`);
  const biz = b.ok ? b.data?.[0] : null;
  /** @type {Record<string, any>} */
  let plan = {};
  if (biz?.plan_id) {
    const p = await dbRequest(`plans?id=eq.${encodeURIComponent(biz.plan_id)}&select=*`);
    plan = p.ok ? p.data?.[0] || {} : {};
  }
  // If the plan can't be read, don't block anyone: limits fail open, usage is still counted.
  const value = {
    planId: biz?.plan_id || null,
    planName: plan.name || biz?.plan_id || '',
    limits: biz ? effectiveLimits(plan, biz.limit_overrides || {}) : effectiveLimits({}, {}),
    paidUntil: biz?.paid_until || null,
    status: biz?.status || 'active',
  };
  cache.set(id, { at: Date.now(), value });
  return value;
}
/** Forget cached plans (one business, or all). @param {string} [id] */
const clearCache = (id) => (id ? cache.delete(id) : cache.clear());

/** @param {string} businessId @returns {Promise<{ broadcasts: number, aiReplies: number }>} */
async function monthlyUsage(businessId) {
  const r = await dbRequest(`usage_counters?business_id=eq.${businessId}&period=eq.${currentPeriod()}&select=broadcasts_sent,ai_replies`);
  const row = r.ok ? r.data?.[0] : null;
  return { broadcasts: row?.broadcasts_sent || 0, aiReplies: row?.ai_replies || 0 };
}

/**
 * How much of one metric is used right now (null if it can't be read).
 * @param {string} businessId @param {Metric} metric @returns {Promise<number | null>}
 */
async function used(businessId, metric) {
  const id = requireBusinessId(businessId);
  switch (metric) {
    case 'staff': return countRows('staff_members', `business_id=eq.${id}`);
    case 'contacts': return countRows('whatsapp_leads', `business_id=eq.${id}`);
    case 'automations': return countRows('automations', `business_id=eq.${id}&is_active=is.true`);
    case 'keywordRules': return countRows('whatsapp_bot_rules', `business_id=eq.${id}`);
    case 'broadcasts': return (await monthlyUsage(id)).broadcasts;
    case 'aiReplies': return (await monthlyUsage(id)).aiReplies;
    default: throw new Error(`Unknown metric ${metric}`);
  }
}

/** @param {number} n */
const fmt = (n) => Number(n).toLocaleString('en-IN');

/**
 * @typedef {{ ok: true, left: number | null, error?: undefined }
 *   | { error: string, limit: number, used: number, left: number, limitReached: true, ok?: undefined }} CheckResult
 */

/**
 * May the business add `adding` more of `metric`? { ok: true, left } or { error, limit, used }.
 * Unlimited, or usage that can't be read, is allowed.
 * @param {string} businessId @param {Metric} metric @param {number} [adding]
 * @returns {Promise<CheckResult>}
 */
async function check(businessId, metric, adding = 1) {
  const { limits, planName } = await getPlan(businessId);
  const limit = limits[METRICS[metric].limit];
  if (limit === null || limit === undefined) return { ok: true, left: null };
  const n = await used(businessId, metric);
  if (n === null) return { ok: true, left: null };
  if (n + adding > limit) {
    const left = Math.max(limit - n, 0);
    const what = METRICS[metric].label.toLowerCase();
    const msg = adding > 1
      ? `This needs ${fmt(adding)} ${what.replace(' this month', '')} but your ${planName} plan has ${fmt(left)} left this month (limit ${fmt(limit)}). Ask the platform to upgrade your plan.`
      : `Your ${planName} plan allows ${fmt(limit)} ${what}, and you have reached it. Ask the platform to upgrade your plan.`;
    return { error: msg, limit, used: n, left, limitReached: true };
  }
  return { ok: true, left: limit - n - adding };
}

/** Is AI included in the plan, and are AI replies left this month? @param {string} businessId */
async function aiAllowed(businessId) {
  const { limits } = await getPlan(businessId);
  if (!limits.ai_enabled) return { ok: false, reason: 'plan has no AI' };
  const c = await check(businessId, 'aiReplies', 1);
  return c.error ? { ok: false, reason: 'AI reply limit reached' } : { ok: true };
}

/**
 * Add to this month's usage (server only). Never throws.
 * @param {string} businessId @param {Metric} metric @param {number} [amount]
 */
async function addUsage(businessId, metric, amount = 1) {
  const column = metric === 'broadcasts' ? 'broadcasts_sent' : metric === 'aiReplies' ? 'ai_replies' : null;
  if (!column || !(amount > 0)) return;
  try {
    await dbRequest('rpc/add_usage', { method: 'POST', body: { p_business: requireBusinessId(businessId), p_metric: column, p_amount: Math.round(amount) } });
  } catch (err) {
    console.warn('[Usage] could not count', metric, err instanceof Error ? err.message : err);
  }
}

/** Analytics history allowed by the plan. @param {string} businessId @param {unknown} days @returns {Promise<number>} */
async function clampAnalyticsDays(businessId, days) {
  const { limits } = await getPlan(businessId);
  const max = limits.analytics_days;
  const d = Math.min(Math.max(Number(days) || 30, 1), 365);
  return max ? Math.min(d, max) : d;
}

// ---------------------------------------------------------------------------
// Billing (payments are recorded by hand by the Platform Admin: "paid until")
// ---------------------------------------------------------------------------
/** India date 'YYYY-MM-DD'. @param {number} [now] */
const today = (now = Date.now()) => new Date(now + 330 * 60000).toISOString().slice(0, 10);
/** @param {string} isoDate 'YYYY-MM-DD' @param {number} days @returns {string} */
function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * 'ok' | 'due' (in the grace period) | 'overdue' (past grace) for a paid-until date. Pure.
 * @param {string | null | undefined} paidUntil @param {number} [now]
 * @returns {{ state: 'ok' | 'due' | 'overdue', paidUntil?: string, suspendOn?: string }}
 */
function billingState(paidUntil, now = Date.now()) {
  if (!paidUntil) return { state: 'ok' };
  const t = today(now);
  if (t <= paidUntil) return { state: 'ok', paidUntil };
  const suspendOn = addDays(paidUntil, GRACE_DAYS + 1);
  return { state: t < suspendOn ? 'due' : 'overdue', paidUntil, suspendOn };
}

/** Worker: suspend businesses whose payment is more than GRACE_DAYS overdue. Returns how many. @param {number} [now] */
async function enforceBilling(now = Date.now()) {
  const cutoff = addDays(today(now), -(GRACE_DAYS + 1)); // paid_until on or before this date = overdue
  const r = await dbRequest(`businesses?status=eq.active&paid_until=lte.${cutoff}&select=id,name,paid_until`);
  if (!r.ok || !r.data?.length) return 0;
  let n = 0;
  for (const b of r.data) {
    const upd = await dbRequest(`businesses?id=eq.${b.id}&status=eq.active`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'suspended', updated_at: new Date(now).toISOString() } });
    if (!upd.ok) continue;
    n++;
    clearCache(b.id);
    require('./whatsapp.cjs').clearCache(b.id);
    await dbRequest('audit_log', {
      method: 'POST', prefer: 'return=minimal',
      body: { business_id: b.id, actor_email: 'system', actor_role: 'billing', action: 'business.suspended_unpaid', details: { paidUntil: b.paid_until, graceDays: GRACE_DAYS } },
    });
    await require('./events.cjs').logEvent({ level: 'warn', source: 'billing', businessId: b.id, code: 'suspended_unpaid', message: `Paused: payment overdue (paid until ${b.paid_until}).` });
  }
  return n;
}

// ---------------------------------------------------------------------------
// Report for the Setup page / dashboard warnings
// ---------------------------------------------------------------------------
/** @param {string} businessId */
async function usageReport(businessId) {
  const id = requireBusinessId(businessId);
  const plan = await getPlan(id, { fresh: true });
  const month = await monthlyUsage(id);
  const [staff, contacts, automations, keywordRules] = await Promise.all([
    used(id, 'staff'), used(id, 'contacts'), used(id, 'automations'), used(id, 'keywordRules'),
  ]);
  /** @type {Record<Metric, number | null>} */
  const values = { staff, contacts, automations, keywordRules, broadcasts: month.broadcasts, aiReplies: month.aiReplies };
  const metrics = /** @type {Array<[Metric, { limit: LimitKey, label: string }]>} */ (Object.entries(METRICS)).map(([key, m]) => {
    const limit = plan.limits[m.limit];
    const value = values[key] ?? 0;
    const percent = limit ? Math.round((value / limit) * 100) : null;
    return { key, label: m.label, used: value, limit, percent, warning: !!limit && value >= limit * WARN_AT, reached: !!limit && value >= limit };
  });
  if (!plan.limits.ai_enabled) {
    const ai = metrics.find(x => x.key === 'aiReplies');
    if (ai) Object.assign(ai, { limit: 0, notIncluded: true, warning: false, reached: false, percent: null });
  }
  return {
    planId: plan.planId,
    planName: plan.planName,
    period: currentPeriod(),
    analyticsDays: plan.limits.analytics_days,
    aiIncluded: plan.limits.ai_enabled,
    metrics,
    billing: billingState(plan.paidUntil),
  };
}

module.exports = {
  GRACE_DAYS,
  METRICS,
  currentPeriod,
  effectiveLimits,
  getPlan,
  clearCache,
  used,
  check,
  aiAllowed,
  addUsage,
  clampAnalyticsDays,
  billingState,
  enforceBilling,
  usageReport,
};
