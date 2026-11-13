// @ts-check
// Which business a request, webhook event or background job belongs to, and who may do what.
// Every database read/write in server/ is scoped with the business id from here.

/** @typedef {import('./types.cjs').Role} Role */
/** @typedef {import('./types.cjs').Middleware} Middleware */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Arogya Ruchulu (business #1, created by the M1 migration). Until each business connects its own
// WhatsApp number (M3), messages arriving on the number in the environment settings belong to it.
const AROGYA_BUSINESS_ID = 'a0000000-0000-4000-8000-000000000001';
const ENV_WHATSAPP_BUSINESS_ID = (process.env.WHATSAPP_BUSINESS_ID || AROGYA_BUSINESS_ID).trim();

/**
 * A business id or an error: never run a query without one.
 * @param {unknown} id
 * @returns {string}
 */
function requireBusinessId(id) {
  const v = String(id || '');
  if (!UUID_RE.test(v)) throw new Error('Missing or invalid business id');
  return v;
}

/** @param {unknown} id @returns {boolean} */
const isBusinessId = (id) => UUID_RE.test(String(id || ''));

/** The business that owns the WhatsApp number in the environment settings (until M3). @returns {string} */
function envWhatsAppBusinessId() {
  return requireBusinessId(ENV_WHATSAPP_BUSINESS_ID);
}

// Whether a business can send is decided by server/whatsapp.cjs getWhatsApp(businessId):
// its own saved connection, or (for the environment's business) the environment settings.
const NO_WHATSAPP = 'This business has no WhatsApp number connected yet.';

// ---- Roles -----------------------------------------------------------------
// owner   = Business Admin: everything in their business, incl. team, WhatsApp, AI keys
// manager = runs the day-to-day: bot, keywords, AI switch/knowledge, broadcasts, follow-ups,
//           all chats, reassigning chats, analytics
// agent   = own and unassigned chats only
/** @type {Role[]} */
const ROLES = ['owner', 'manager', 'agent'];
/** @param {unknown} role @returns {boolean} */
const isManagerOrOwner = (role) => role === 'owner' || role === 'manager';

/**
 * Route guard: only these roles may continue (403 otherwise).
 * @param {...Role} allowed
 * @returns {Middleware}
 */
function requireRoles(...allowed) {
  return (req, res, next) => {
    const role = req.staff?.role;
    if (!role || !allowed.includes(role)) {
      const who = allowed.includes('manager') ? 'the Business Admin or a manager' : 'the Business Admin';
      return res.status(403).json({ success: false, error: `Only ${who} can do this.` });
    }
    return next();
  };
}
const requireOwner = requireRoles('owner');
const requireManager = requireRoles('owner', 'manager');

module.exports = {
  AROGYA_BUSINESS_ID,
  ROLES,
  requireBusinessId,
  isBusinessId,
  envWhatsAppBusinessId,
  NO_WHATSAPP,
  isManagerOrOwner,
  requireRoles,
  requireOwner,
  requireManager,
};
