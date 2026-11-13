// @ts-check
// System event log for the Platform Admin console: errors and warnings from the webhook,
// worker, Meta sends, AI, ads sync and logins. Server-only tables (see 20261115_admin_console.sql).
//
// Never stores chat content: callers pass a short error text (never a message body), and
// scrub() removes phone numbers, emails and anything that looks like a token before saving.
// Writing an event never throws and never blocks the caller for long.
const { dbRequest, dbReady } = require('./db.cjs');
const { isBusinessId } = require('./tenant.cjs');

const LEVELS = ['info', 'warn', 'error', 'critical'];
const SOURCES = ['webhook', 'worker', 'meta', 'ai', 'ads', 'auth', 'billing', 'system'];
const EVENT_RETENTION_DAYS = 30;
const RUN_RETENTION_DAYS = 14;
const THROTTLE_MS = 60 * 1000;   // the same event (source + code + business) is saved at most once a minute
const WEBHOOK_TOUCH_MS = 60 * 1000;

/** Remove anything private from an error text: tokens, keys, emails, phone numbers. @param {unknown} text @param {number} [max] */
function scrub(text, max = 300) {
  return String(text ?? '')
    .replace(/Bearer\s+[^\s"',]+/gi, 'Bearer [token]')
    .replace(/\b(EAA[A-Za-z0-9]{10,}|sk-[A-Za-z0-9_-]{10,}|sk-ant-[A-Za-z0-9_-]{10,}|sb_secret_[A-Za-z0-9_-]+|AIza[0-9A-Za-z_-]{20,}|eyJ[A-Za-z0-9_-]{20,}(\.[A-Za-z0-9_-]+)*)/g, '[token]')
    .replace(/(access_token|api_key|apikey|token|secret|password)=([^&\s]+)/gi, '$1=[hidden]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\+\d[\d\s-]{7,}\d/g, '[number]')
    .replace(/\d{7,}/g, '[number]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** @param {unknown} c */
const cleanCode = (c) => (c === null || c === undefined || c === '' ? null : String(c).replace(/[^\w.:-]/g, '_').slice(0, 60));

/** Only plain numbers, booleans and short scrubbed strings go into details. @param {Record<string, unknown> | null | undefined} details */
function cleanDetails(details) {
  /** @type {Record<string, number | boolean | string>} */
  const out = {};
  for (const [k, v] of Object.entries(details || {}).slice(0, 12)) {
    const key = String(k).replace(/[^\w]/g, '').slice(0, 40);
    if (!key) continue;
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
    else if (typeof v === 'boolean') out[key] = v;
    else if (typeof v === 'string') out[key] = scrub(v, 120);
  }
  return out;
}

/** @type {Map<string, { last: number, suppressed: number }>} */
const throttle = new Map(); // key -> { last, suppressed }

/**
 * Save one event. { level, source, businessId?, code?, message, details? }
 * Returns true if it was written (false when throttled, invalid or the database is off).
 * @param {{ level?: string, source?: string, businessId?: string | null, code?: string | null,
 *   message?: string, details?: Record<string, unknown> }} [event]
 * @returns {Promise<boolean>}
 */
async function logEvent({ level = 'error', source, businessId = null, code = null, message = '', details = {} } = {}) {
  try {
    if (!LEVELS.includes(level) || !source || !SOURCES.includes(source) || !dbReady()) return false;
    const biz = isBusinessId(businessId) ? businessId : null;
    const c = cleanCode(code);
    const key = `${source}|${c}|${biz}`;
    const now = Date.now();
    const t = throttle.get(key);
    if (t && now - t.last < THROTTLE_MS) { t.suppressed++; return false; }
    const count = 1 + (t?.suppressed || 0);
    throttle.set(key, { last: now, suppressed: 0 });
    if (throttle.size > 2000) {
      const oldest = throttle.keys().next().value;
      if (oldest !== undefined) throttle.delete(oldest);
    }
    const res = await dbRequest('system_events', {
      method: 'POST', prefer: 'return=minimal',
      body: { level, source, business_id: biz, code: c, message: scrub(message), count, details: cleanDetails(details) },
    });
    return !!res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Per-business health markers
// ---------------------------------------------------------------------------
/** @param {unknown} businessId @param {Record<string, unknown>} body */
async function upsertHealth(businessId, body) {
  if (!isBusinessId(businessId) || !dbReady()) return false;
  try {
    const res = await dbRequest('business_health?on_conflict=business_id', {
      method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
      body: { business_id: businessId, ...body, updated_at: new Date().toISOString() },
    });
    return !!res.ok;
  } catch {
    return false;
  }
}

/** @type {Map<unknown, number>} */
const touched = new Map(); // businessId -> last write
/** A signed webhook call arrived for this business (written at most once a minute). @param {unknown} businessId */
async function touchWebhook(businessId) {
  const now = Date.now();
  if (now - (touched.get(businessId) || 0) < WEBHOOK_TOUCH_MS) return false;
  touched.set(businessId, now);
  return upsertHealth(businessId, { last_webhook_at: new Date(now).toISOString() });
}

/** A webhook POST failed the Meta signature check. @param {string | null | undefined} businessId */
async function signatureFailed(businessId) {
  await logEvent({ level: 'warn', source: 'webhook', businessId: businessId ?? null, code: 'signature_invalid', message: 'Webhook POST rejected: missing or invalid X-Hub-Signature-256.' });
  if (isBusinessId(businessId)) await upsertHealth(businessId, { last_signature_fail_at: new Date().toISOString() });
}

// ---------------------------------------------------------------------------
// Worker runs
// ---------------------------------------------------------------------------
/**
 * @param {{ startedAt: number, finishedAt?: number, steps?: Record<string, unknown>,
 *   errors?: Array<{ step?: string, message?: unknown }> }} run
 */
async function recordWorkerRun({ startedAt, finishedAt = Date.now(), steps = {}, errors = [] }) {
  if (!dbReady()) return false;
  try {
    const errs = errors.slice(0, 20).map(e => ({ step: String(e.step || '').slice(0, 40), message: scrub(e.message, 200) }));
    const res = await dbRequest('worker_runs', {
      method: 'POST', prefer: 'return=minimal',
      body: {
        started_at: new Date(startedAt).toISOString(),
        finished_at: new Date(finishedAt).toISOString(),
        duration_ms: Math.max(0, Math.round(finishedAt - startedAt)),
        ok: errs.length === 0,
        steps,
        error_count: errs.length,
        errors: errs,
      },
    });
    return !!res.ok;
  } catch {
    return false;
  }
}

/** Retention: events older than 30 days and worker runs older than 14 days are deleted. @param {number} [now] */
async function prune(now = Date.now()) {
  const ev = encodeURIComponent(new Date(now - EVENT_RETENTION_DAYS * 86400000).toISOString());
  const runs = encodeURIComponent(new Date(now - RUN_RETENTION_DAYS * 86400000).toISOString());
  const [a, b] = await Promise.all([
    dbRequest(`system_events?created_at=lt.${ev}`, { method: 'DELETE', prefer: 'return=minimal' }),
    dbRequest(`worker_runs?started_at=lt.${runs}`, { method: 'DELETE', prefer: 'return=minimal' }),
  ]);
  return { ok: !!(a.ok && b.ok) };
}

/** Tests only. */
function _reset() { throttle.clear(); touched.clear(); }

module.exports = {
  LEVELS, SOURCES, EVENT_RETENTION_DAYS, RUN_RETENTION_DAYS,
  scrub, logEvent, upsertHealth, touchWebhook, signatureFailed, recordWorkerRun, prune, _reset,
};
