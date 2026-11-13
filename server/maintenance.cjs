// @ts-check
// Maintenance mode for the whole platform, switched by the Platform Admin (platform console).
//
// While it is ON:
//   * every business's staff API answers 503 { maintenance: true } and the dashboard shows a
//     "under maintenance" screen (it checks GET /api/maintenance to come back by itself);
//   * the Meta webhook keeps working: customers' messages are stored and the bot keeps answering;
//   * the worker holds broadcasts and follow-ups (they continue when maintenance ends);
//   * the platform console keeps working.
// The setting lives in platform_settings (one row, server-only). Each server instance keeps a copy for
// CACHE_MS, so switching takes effect everywhere within that time (at once on the instance that switched).
const { dbRequest } = require('./db.cjs');
const events = require('./events.cjs');

/** @typedef {{ on: boolean, message: string | null, until: string | null, startedAt: string | null, updatedBy?: string | null, updatedAt?: string | null }} MaintenanceState */

const CACHE_MS = 15 * 1000;
const MAX_MESSAGE = 500;
const DEFAULT_MESSAGE = 'The platform is under maintenance. Please check back in a little while.';
/** @type {MaintenanceState} */
const OFF = { on: false, message: null, until: null, startedAt: null };

/** @type {{ state: MaintenanceState, expires: number } | null} */
let cache = null;

/** @param {any} row @returns {MaintenanceState} */
const fromRow = (row) => (row ? {
  on: !!row.maintenance_on,
  message: row.maintenance_message || null,
  until: row.maintenance_until || null,
  startedAt: row.maintenance_started || null,
  updatedBy: row.updated_by || null,
  updatedAt: row.updated_at || null,
} : OFF);

/**
 * The current state. If the setting can't be read (table not created yet, database hiccup) the platform
 * stays usable: maintenance counts as OFF rather than locking everyone out.
 * @param {{ fresh?: boolean }} [options]
 * @returns {Promise<MaintenanceState>}
 */
async function getState({ fresh = false } = {}) {
  if (!fresh && cache && cache.expires > Date.now()) return cache.state;
  let state = OFF;
  try {
    const r = await dbRequest('platform_settings?id=eq.1&select=*');
    if (r.ok) state = fromRow(r.data?.[0]);
  } catch {
    state = OFF;
  }
  cache = { state, expires: Date.now() + CACHE_MS };
  return state;
}

/** What staff (and the sign-in page) may see. @param {MaintenanceState} s */
const publicView = (s) => ({ on: s.on, message: s.on ? s.message || DEFAULT_MESSAGE : null, until: s.on ? s.until : null });

/**
 * Staff API gate: 503 while maintenance is on. Mounted before requireStaff on the dashboard API.
 * @type {import('./types.cjs').Middleware}
 */
async function gate(req, res, next) {
  const s = await getState();
  if (!s.on) return next();
  res.set('Retry-After', '120');
  return res.status(503).json({ maintenance: true, error: s.message || DEFAULT_MESSAGE, until: s.until });
}

/**
 * Platform Admin switches maintenance on or off.
 * @param {{ email: string }} admin
 * @param {{ on?: unknown, message?: unknown, until?: unknown }} input
 */
async function setState(admin, input = {}) {
  if (typeof input.on !== 'boolean') return { error: 'Say whether maintenance is on or off.' };
  const message = typeof input.message === 'string' ? input.message.trim().slice(0, MAX_MESSAGE) : '';
  /** @type {string | null} */
  let until = null;
  if (input.until !== undefined && input.until !== null && input.until !== '') {
    const t = Date.parse(String(input.until));
    if (!Number.isFinite(t)) return { error: 'The "expected back" time is not a valid date.' };
    if (t < Date.now() - 60000) return { error: 'The "expected back" time is in the past.' };
    if (t > Date.now() + 14 * 86400000) return { error: 'The "expected back" time must be within 14 days.' };
    until = new Date(t).toISOString();
  }
  const before = await getState({ fresh: true });
  const now = new Date().toISOString();
  const row = {
    id: 1,
    maintenance_on: input.on,
    maintenance_message: input.on ? message || null : before.message,
    maintenance_until: input.on ? until : null,
    maintenance_started: input.on ? (before.on ? before.startedAt : now) : null,
    updated_by: admin.email,
    updated_at: now,
  };
  const r = await dbRequest('platform_settings?on_conflict=id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: row });
  if (!r.ok) return { error: 'Could not save. Has the platform settings SQL (20261117) been run?' };
  cache = null;
  await require('./platform.cjs').audit(admin, null, input.on ? 'platform.maintenance_on' : 'platform.maintenance_off', { message: input.on ? message : undefined, until });
  await events.logEvent({ level: input.on ? 'warn' : 'info', source: 'system', code: input.on ? 'maintenance_on' : 'maintenance_off', message: input.on ? `Maintenance switched on by ${admin.email}` : `Maintenance switched off by ${admin.email}` });
  return { maintenance: await getState({ fresh: true }) };
}

/** Tests only. */
function clearCache() { cache = null; }

module.exports = { getState, publicView, gate, setState, clearCache, DEFAULT_MESSAGE, CACHE_MS };
