// @ts-check
// Production hardening for the Express app (no extra packages):
//   * securityHeaders  - standard browser protections on every response
//   * rateLimit        - per-IP request limits (in memory, per server instance)
//   * authFailureGuard - slows down token guessing: too many 401/403 answers -> 429 before any lookup
//   * clientErrorRoute - the dashboard's crash reports (scrubbed) into the Platform Admin's event log
//   * errorHandler     - JSON errors, never a stack trace
//
// Limits are per server instance. On Netlify several instances may run at once, so this is a brake
// on abuse from one address, not an exact quota. Webhooks are also protected by Meta's signature.
const events = require('./events.cjs');

/** @typedef {import('./types.cjs').AppRequest} AppRequest */
/** @typedef {import('./types.cjs').AppResponse} AppResponse */
/** @typedef {import('./types.cjs').Middleware} Middleware */
/**
 * @typedef {object} Counter
 * @property {(key: string, now?: number) => { count: number, resetMs: number }} add
 * @property {(key: string, now?: number) => number} peek
 * @property {() => void} reset
 */

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------
/** @type {Middleware} */
function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cross-Origin-Opener-Policy': 'same-origin',
    // Calls in the inbox use the microphone; nothing uses the camera, location or payments API.
    'Permissions-Policy': 'camera=(), geolocation=(), payment=(), microphone=(self)',
  });
  const https = req.secure || String(req.get('x-forwarded-proto') || '').split(',')[0].trim() === 'https';
  if (https) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // API answers can contain business data: never keep them in browser or proxy caches.
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
  next();
}

// ---------------------------------------------------------------------------
// Rate limits
// ---------------------------------------------------------------------------

/**
 * The caller's address. Netlify puts the real one in x-nf-client-connection-ip.
 * @param {Pick<AppRequest, 'get'> & { socket?: { remoteAddress?: string } }} req
 * @returns {string}
 */
function clientIp(req) {
  const nf = req.get('x-nf-client-connection-ip');
  if (nf) return nf.trim();
  const fwd = req.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

/**
 * Fixed-window counter per key.
 * @param {{ windowMs: number, maxKeys?: number }} options
 * @returns {Counter}
 */
function createCounter({ windowMs, maxKeys = 10000 }) {
  /** @type {Map<string, { start: number, count: number }>} */
  const hits = new Map();
  return {
    add(key, now = Date.now()) {
      let h = hits.get(key);
      if (!h || now - h.start >= windowMs) {
        h = { start: now, count: 0 };
        hits.set(key, h);
        if (hits.size > maxKeys) {
          for (const [k, v] of hits) if (now - v.start >= windowMs) hits.delete(k);
          const oldest = hits.keys().next().value;
          if (hits.size > maxKeys && oldest !== undefined) hits.delete(oldest);
        }
      }
      h.count += 1;
      return { count: h.count, resetMs: h.start + windowMs - now };
    },
    peek(key, now = Date.now()) {
      const h = hits.get(key);
      return h && now - h.start < windowMs ? h.count : 0;
    },
    reset() { hits.clear(); },
  };
}

/** @type {Counter[]} */
const counters = [];
/** @param {AppResponse} res @param {number} resetMs @param {string} [message] */
function tooMany(res, resetMs, message) {
  res.set('Retry-After', String(Math.max(1, Math.ceil(resetMs / 1000))));
  return res.status(429).json({ success: false, error: message || 'Too many requests. Please wait a moment and try again.' });
}

/**
 * At most `max` requests per `windowMs` from one address (for the paths it is mounted on).
 * @param {{ windowMs?: number, max: number, name: string, message?: string }} options
 * @returns {Middleware}
 */
function rateLimit({ windowMs = 60000, max, name, message }) {
  const counter = createCounter({ windowMs });
  counters.push(counter);
  return (req, res, next) => {
    const { count, resetMs } = counter.add(`${name}|${clientIp(req)}`);
    if (count > max) {
      if (count === max + 1) {
        events.logEvent({ level: 'warn', source: 'system', code: `rate_limited_${name}`, message: `Rate limit hit on ${name} (${max} per ${Math.round(windowMs / 1000)}s from one address)` });
      }
      return tooMany(res, resetMs, message);
    }
    return next();
  };
}

/**
 * Too many refused logins from one address -> 429 before the token is even looked up.
 * Stops token guessing and saves the Supabase lookups each guess would cost.
 * Counts 401s, and 403s only when the login check itself refused (res.locals.authFailed), so an
 * agent opening a manager-only page is never locked out.
 * @param {{ windowMs?: number, max?: number }} [options]
 * @returns {Middleware}
 */
function authFailureGuard({ windowMs = 60000, max = 30 } = {}) {
  const counter = createCounter({ windowMs });
  counters.push(counter);
  return (req, res, next) => {
    const ip = clientIp(req);
    if (counter.peek(ip) >= max) return tooMany(res, windowMs, 'Too many failed sign-in attempts from this address. Wait a minute and sign in again.');
    res.on('finish', () => {
      if (res.statusCode === 401 || (res.statusCode === 403 && res.locals.authFailed)) {
        const { count } = counter.add(ip);
        if (count === max) {
          events.logEvent({ level: 'warn', source: 'auth', code: 'too_many_auth_failures', message: `${max} refused API requests in ${Math.round(windowMs / 1000)}s from one address` });
        }
      }
    });
    return next();
  };
}

// ---------------------------------------------------------------------------
// Dashboard crash reports
// ---------------------------------------------------------------------------
const SCREEN_RE = /^[a-z_]{1,30}$/;

/**
 * POST /api/client-errors (staff only): { screen, name, message, path }.
 * @param {AppRequest} req
 * @param {AppResponse} res
 */
async function clientErrorRoute(req, res) {
  const b = req.body || {};
  const screen = SCREEN_RE.test(String(b.screen || '')) ? b.screen : 'unknown';
  const name = String(b.name || 'Error').replace(/[^\w]/g, '').slice(0, 40) || 'Error';
  const message = String(b.message || '').split('\n')[0].slice(0, 200);
  await events.logEvent({
    level: 'warn',
    source: 'system',
    businessId: req.staff?.businessId,
    code: `frontend_crash_${screen}`,
    message: `Dashboard crash on "${screen}": ${name}: ${message}`,
    details: { screen, role: req.staff?.role || 'unknown' },
  });
  res.status(204).end();
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
/**
 * Express error handler (4 arguments, so Express knows it handles errors).
 * @param {any} err  Anything can be thrown.
 * @param {AppRequest} req
 * @param {AppResponse} res
 * @param {import('./types.cjs').NextFunction} next
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) return undefined;
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ success: false, error: 'The request body is not valid JSON.' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ success: false, error: 'The request is too large.' });
  const status = Number(err?.status || err?.statusCode);
  if (status >= 400 && status < 500) return res.status(status).json({ success: false, error: 'The request could not be processed.' });
  console.error('[Unhandled error]', req.method, req.path, err);
  events.logEvent({ level: 'error', source: 'system', code: 'unhandled_error', message: `${req.method} ${req.path}: ${err?.message || err}` });
  return res.status(500).json({ success: false, error: 'Something went wrong on the server. It has been logged; please try again.' });
}

/** Tests only. */
function _resetLimits() {
  for (const c of counters) c.reset();
}

module.exports = { securityHeaders, rateLimit, authFailureGuard, clientErrorRoute, errorHandler, clientIp, createCounter, _resetLimits };
