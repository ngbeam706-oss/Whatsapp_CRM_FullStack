// @ts-check
// Staff authentication for the dashboard API.
// The browser signs in with Supabase Auth and sends its access token as
// `Authorization: Bearer <token>`. We check the token with Supabase, then check that the
// user is listed in the `staff_members` table (see supabase/migrations).
const { config } = require('./config.cjs');
const { ROLES, isBusinessId } = require('./tenant.cjs');

/** @typedef {import('./types.cjs').Staff} Staff */
/** @typedef {Staff | { paused: true } | null} StaffLookup  null = not staff; paused = business suspended */

const CACHE_MS = 60 * 1000;
/** @type {Map<string, { staff: StaffLookup, expires: number }>} */
const cache = new Map();

/** @param {string} userToken @returns {Record<string, string>} */
function anonHeaders(userToken) {
  const headers = { apikey: config.supabaseAnonKey, Authorization: `Bearer ${userToken}` };
  return headers;
}

/** @param {string} token @returns {Promise<StaffLookup>} */
async function lookupStaff(token) {
  const userRes = await fetch(`${config.supabaseUrl}/auth/v1/user`, { headers: anonHeaders(token) });
  if (!userRes.ok) return null;
  const user = /** @type {{ id?: string, email?: string }} */ (await userRes.json());
  if (!user?.id) return null;

  // Read with the user's own token: RLS lets a user read only their own staff row, and
  // only their own (active) business.
  const staffRes = await fetch(
    `${config.supabaseUrl}/rest/v1/staff_members?select=role,business_id,businesses(name,status)&user_id=eq.${encodeURIComponent(user.id)}`,
    { headers: anonHeaders(token) }
  );
  if (!staffRes.ok) return null;
  const rows = await staffRes.json();
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const row = rows[0];
  // A suspended business locks its staff out. (The database only shows a business to its staff
  // while it is active, so a staff row without its business means the business is paused.)
  if (!isBusinessId(row.business_id) || row.businesses?.status !== 'active') return { paused: true };

  return {
    id: user.id,
    email: user.email || '',
    role: ROLES.includes(row.role) ? row.role : 'agent',
    businessId: row.business_id,
    businessName: row.businesses?.name || '',
  };
}

/** @param {string | null} token @returns {Promise<StaffLookup>} */
async function verifyStaffToken(token) {
  if (!token) return null;
  const now = Date.now();
  const hit = cache.get(token);
  if (hit && hit.expires > now) return hit.staff;

  let staff = null;
  try {
    staff = await lookupStaff(token);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[Auth] Staff lookup failed:', message);
    await require('./events.cjs').logEvent({ level: 'error', source: 'auth', code: 'staff_lookup_failed', message });
    return null; // Don't cache network failures.
  }
  cache.set(token, { staff, expires: now + CACHE_MS });
  if (cache.size > 1000) {
    for (const [k, v] of cache) if (v.expires <= now) cache.delete(k);
  }
  return staff;
}

/** @param {import('./types.cjs').AppRequest} req @returns {string | null} */
function extractToken(req) {
  const header = req.get('authorization') || '';
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  // EventSource cannot set headers, so /api/events may pass the token as a query param.
  if (req.path === '/api/events' && typeof req.query.access_token === 'string') return req.query.access_token;
  return null;
}

/**
 * Route guard: a signed-in staff member of an active business, or 401/403.
 * @type {import('./types.cjs').Middleware}
 */
async function requireStaff(req, res, next) {
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    return res.status(503).json({ error: 'Server auth is not configured (SUPABASE_URL / SUPABASE_ANON_KEY).' });
  }
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: 'Sign in required.' });

  const staff = await verifyStaffToken(token);
  if (!staff) {
    res.locals.authFailed = true; // counted by security.authFailureGuard (token guessing)
    return res.status(403).json({ error: 'This account is not an authorised staff member.' });
  }
  if ('paused' in staff) {
    return res.status(403).json({ paused: true, error: 'This business is paused on the platform (for example, a payment is overdue). Contact the platform team.' });
  }

  req.staff = staff;
  return next();
}

/** Tests only: put a known token -> staff entry in the cache. @param {string} token @param {StaffLookup} staff */
function _setStaffForToken(token, staff) {
  cache.set(token, { staff, expires: Date.now() + CACHE_MS });
}

module.exports = { requireStaff, _setStaffForToken };
