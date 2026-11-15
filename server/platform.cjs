// @ts-check
// Platform Admin: the businesses on the platform, their plans and their usage.
//
// The Platform Admin manages businesses (create, suspend, change plan) but NEVER sees a
// business's customers or conversations: everything here is a count or a setting.
// (The database rules also keep platform admins out of every chat/contact/message table.)
const { config } = require('./config.cjs');
const { dbRequest, countRows } = require('./db.cjs');
const { isBusinessId } = require('./tenant.cjs');
const team = require('./team.cjs');

/**
 * Platform roles (docs/progress/platform-roles.md): owner = Platform Owner (everything), manager = Application
 * Manager (sign-ups, onboarding, support queries), developer = Application Developer (health, logs, worker,
 * delivery; businesses read-only). No role ever sees a business's chats.
 * @typedef {'owner' | 'manager' | 'developer'} PlatformRole
 * @typedef {{ id: string, email: string, role: PlatformRole }} PlatformAdmin
 */
/** @typedef {Record<string, any>} Input  request body fields (each function checks what it uses) */
/** @typedef {Record<string, any>} Row */

/** @type {readonly PlatformRole[]} */
const PLATFORM_ROLES = ['owner', 'manager', 'developer'];
/** @type {Record<PlatformRole, string>} */
const PLATFORM_ROLE_LABEL = { owner: 'Platform Owner', manager: 'Application Manager', developer: 'Application Developer' };
/** @param {unknown} r @returns {r is PlatformRole} */
const isPlatformRole = (r) => /** @type {readonly unknown[]} */ (PLATFORM_ROLES).includes(r);

const CACHE_MS = 60 * 1000;
/**
 * token -> the login behind it (who, not what they may do). The role is read from platform_admins on every
 * request, so removing someone or changing their role takes effect at once, on every server instance.
 * `pinned` (tests only) skips the database read.
 * @type {Map<string, { login: { id: string, email: string } | null, pinned?: PlatformAdmin | null, expires: number }>}
 */
const loginCache = new Map();

// ---------------------------------------------------------------------------
// Who is a platform admin, and with which role
// ---------------------------------------------------------------------------
/** The login behind a token (Supabase Auth). @param {string} token @returns {Promise<{ id: string, email: string } | null>} */
async function lookupLogin(token) {
  const headers = { apikey: config.supabaseAnonKey, Authorization: `Bearer ${token}` };
  const userRes = await fetch(`${config.supabaseUrl}/auth/v1/user`, { headers });
  if (!userRes.ok) return null;
  /** @type {any} */
  const user = await userRes.json();
  return user?.id ? { id: String(user.id), email: String(user.email || '') } : null;
}

/**
 * The platform_admins row of a login (server key). Before the platform-roles SQL is run there is no role
 * column: everyone in the table is then the Platform Owner, as before.
 * @param {string} userId @returns {Promise<{ found: boolean, role?: PlatformRole, email?: string } | { error: true }>}
 */
async function platformRow(userId) {
  const id = encodeURIComponent(userId);
  let r = await dbRequest(`platform_admins?select=role,email&user_id=eq.${id}`);
  if (!r.ok) {
    r = await dbRequest(`platform_admins?select=email&user_id=eq.${id}`);
    if (!r.ok) return { error: true };
  }
  const row = Array.isArray(r.data) ? r.data[0] : null;
  if (!row) return { found: false };
  return { found: true, role: isPlatformRole(row.role) ? row.role : 'owner', email: row.email };
}

/** @type {import('./types.cjs').Middleware} */
async function requirePlatformAdmin(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!token) return res.status(401).json({ error: 'Sign in required.' });
  const events = require('./events.cjs');
  const hit = loginCache.get(token);
  /** @type {PlatformAdmin | null} */
  let admin = null;
  try {
    if (hit && hit.expires > Date.now() && hit.pinned !== undefined) {
      admin = hit.pinned;
    } else {
      let login = hit && hit.expires > Date.now() ? hit.login : undefined;
      if (login === undefined) {
        login = await lookupLogin(token);
        loginCache.set(token, { login, expires: Date.now() + CACHE_MS });
      }
      if (login) {
        const row = await platformRow(login.id);
        if ('error' in row) return res.status(503).json({ error: 'Could not check your login.' });
        if (row.found && row.role) admin = { id: login.id, email: login.email || row.email || '', role: row.role };
      }
    }
  } catch (err) {
    await events.logEvent({ level: 'error', source: 'auth', code: 'platform_lookup_failed', message: err instanceof Error ? err.message : String(err) });
    return res.status(503).json({ error: 'Could not check your login.' });
  }
  if (!admin) {
    // Someone signed in (or not) tried the platform console. Counted, throttled, no email kept.
    await events.logEvent({ level: 'warn', source: 'auth', code: 'platform_denied', message: 'A login that is not a platform admin tried the platform console.' });
    res.locals.authFailed = true; // counted by security.authFailureGuard
    return res.status(403).json({ error: 'This login is not a platform admin.' });
  }
  req.platformAdmin = admin;
  return next();
}

/**
 * The platform admin behind a token (same rules and cache as requirePlatformAdmin), or null. Throws when the login can't
 * be checked. Used by the sign-in log (server/activity.cjs).
 * @param {string} token @returns {Promise<PlatformAdmin | null>}
 */
async function platformAdminForToken(token) {
  if (!token) return null;
  const hit = loginCache.get(token);
  if (hit && hit.expires > Date.now() && hit.pinned !== undefined) return hit.pinned;
  let login = hit && hit.expires > Date.now() ? hit.login : undefined;
  if (login === undefined) {
    login = await lookupLogin(token);
    loginCache.set(token, { login, expires: Date.now() + CACHE_MS });
  }
  if (!login) return null;
  const row = await platformRow(login.id);
  if ('error' in row) throw new Error('Could not check the platform login.');
  return row.found && row.role ? { id: login.id, email: login.email || row.email || '', role: row.role } : null;
}

/**
 * Only these platform roles may use the route (after requirePlatformAdmin). The Platform Owner is always allowed.
 * @param {...PlatformRole} roles @returns {import('./types.cjs').Middleware}
 */
function requirePlatformRole(...roles) {
  return (req, res, next) => {
    const role = req.platformAdmin?.role;
    if (role === 'owner' || (role && roles.includes(role))) return next();
    return res.status(403).json({ success: false, error: `Your platform role (${role ? PLATFORM_ROLE_LABEL[role] : 'none'}) can't do this.` });
  };
}

/** Forget cached logins for a user (their role changed or they were removed). @param {string} userId */
function forgetLogin(userId) {
  for (const [token, v] of loginCache) {
    if (v.login?.id === userId || v.pinned?.id === userId) loginCache.delete(token);
  }
}

/**
 * Tests only: this token is this platform admin (role defaults to owner), no database read.
 * @param {string} token @param {{ id: string, email: string, role?: PlatformRole } | null} admin
 */
function _setPlatformAdminForToken(token, admin) {
  loginCache.set(token, { login: admin ? { id: admin.id, email: admin.email } : null, pinned: admin ? { ...admin, role: admin.role || 'owner' } : null, expires: Date.now() + CACHE_MS });
}
/** Tests only: this token is this login; its platform role is read from platform_admins on each request. @param {string} token @param {{ id: string, email: string } | null} login */
function _setLoginForToken(token, login) {
  loginCache.set(token, { login, expires: Date.now() + CACHE_MS });
}

// ---------------------------------------------------------------------------
// Counts (never rows)
// ---------------------------------------------------------------------------
const monthStart = () => {
  const ist = new Date(Date.now() + 330 * 60000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - 330 * 60000).toISOString();
};
const period = () => {
  const ist = new Date(Date.now() + 330 * 60000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}`;
};

async function overview() {
  const [biz, plans, wa, usage, extras] = await Promise.all([
    dbRequest('businesses?select=id,name,slug,status,plan_id,limit_overrides,paid_until,send_window_start,send_window_end,created_at&order=created_at.asc'),
    dbRequest('plans?select=*&order=sort_order.asc'),
    dbRequest('business_whatsapp?select=business_id,phone_number,phone_number_id,connected_at,token_last4'),
    dbRequest(`usage_counters?select=business_id,broadcasts_sent,ai_replies&period=eq.${period()}`),
    // Extra WhatsApp numbers: counted per business (ids only, never labels or tokens).
    dbRequest('whatsapp_numbers?select=business_id&status=eq.active'),
  ]);
  /** @type {Map<string, number>} */
  const extrasBy = new Map();
  for (const e of (extras.ok && Array.isArray(extras.data) ? extras.data : [])) extrasBy.set(e.business_id, (extrasBy.get(e.business_id) || 0) + 1);
  if (!biz.ok) return { error: 'Could not load businesses. Has the M1 SQL been run?' };
  /** @type {Map<string, Row>} */
  const waBy = new Map((wa.ok ? wa.data : []).map((/** @type {Row} */ w) => [w.business_id, w]));
  /** @type {Map<string, Row>} */
  const usageBy = new Map((usage.ok ? usage.data : []).map((/** @type {Row} */ u) => [u.business_id, u]));
  const envBiz = (process.env.WHATSAPP_BUSINESS_ID || 'a0000000-0000-4000-8000-000000000001').trim();
  const since = encodeURIComponent(monthStart());

  const limitsLib = require('./limits.cjs');
  /** @type {Map<string, Row>} */
  const planBy = new Map((plans.ok ? plans.data : []).map((/** @type {Row} */ p) => [p.id, p]));
  const businesses = await Promise.all(biz.data.map(async (/** @type {Row} */ b) => {
    const [staff, contacts, messagesThisMonth] = await Promise.all([
      countRows('staff_members', `business_id=eq.${b.id}`),
      countRows('whatsapp_leads', `business_id=eq.${b.id}`),
      countRows('whatsapp_messages', `business_id=eq.${b.id}&timestamp=gte.${since}`),
    ]);
    const w = waBy.get(b.id);
    const savedConnection = !!(w && w.phone_number_id && w.token_last4);
    const connected = savedConnection || (b.id === envBiz && !!config.whatsappToken);
    return {
      ...b,
      whatsapp: {
        connected,
        numbers: (connected ? 1 : 0) + (extrasBy.get(b.id) || 0),
        source: savedConnection ? 'saved' : (b.id === envBiz && config.whatsappToken ? 'env' : 'none'),
        phoneNumber: savedConnection ? w?.phone_number : (b.id === envBiz ? config.phoneNumber : ''),
      },
      counts: { staff, contacts, messagesThisMonth },
      limits: limitsLib.effectiveLimits(planBy.get(b.plan_id) || {}, b.limit_overrides || {}),
      billing: limitsLib.billingState(b.paid_until),
      usage: { broadcastsSent: usageBy.get(b.id)?.broadcasts_sent || 0, aiReplies: usageBy.get(b.id)?.ai_replies || 0, period: period() },
    };
  }));
  return { businesses, plans: plans.ok ? plans.data : [] };
}

// ---------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------
/**
 * Audit row for a platform action: who (email) and with which platform role (details.platformRole).
 * @param {{ email: string, role?: string }} admin @param {string | null} businessId @param {string} action @param {Record<string, unknown>} [details]
 */
const audit = (admin, businessId, action, details = {}) => dbRequest('audit_log', {
  method: 'POST', prefer: 'return=minimal',
  body: { business_id: businessId, actor_email: admin.email, actor_role: 'platform_admin', action, details: { ...details, ...(admin.role ? { platformRole: admin.role } : {}) } },
});

/** @param {unknown} name */
function slugify(name) {
  return String(name || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim()
    .replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

/** @param {string} planId */
async function planExists(planId) {
  const r = await dbRequest(`plans?id=eq.${encodeURIComponent(planId)}&select=id`);
  return r.ok && r.data?.length > 0;
}

/** Create a business and invite its Business Admin. Nothing is left behind if the invite fails. @param {{ email: string }} admin @param {Input} [input] */
async function createBusiness(admin, input = {}) {
  const name = String(input.name || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) return { error: 'Business name must be 2 to 80 characters.' };
  const slug = slugify(input.slug || name);
  if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(slug)) return { error: 'Choose a short web name (letters, numbers and dashes, at least 3).' };
  const planId = String(input.planId || 'starter');
  if (!(await planExists(planId))) return { error: 'Choose a plan.' };
  const adminEmail = String(input.adminEmail || '').trim().toLowerCase();
  if (!team.isEmail(adminEmail)) return { error: 'Enter the Business Admin\'s email address.' };
  const industry = INDUSTRIES.includes(input.industry) ? input.industry : 'general';

  const ins = await dbRequest('businesses', {
    method: 'POST', prefer: 'return=representation',
    body: { name, slug, plan_id: planId, industry, created_by: admin.email },
  });
  if (!ins.ok || !ins.data?.[0]) {
    if (ins.status === 409) return { error: `The web name "${slug}" is taken. Choose another.` };
    return { error: 'Could not create the business.' };
  }
  const business = ins.data[0];
  await dbRequest('ai_settings', { method: 'POST', prefer: 'return=minimal', body: { business_id: business.id } });
  // Default query categories for its type of business (hospital, food, retail, services, general).
  await dbRequest('rpc/seed_query_categories', { method: 'POST', body: { p_business: business.id } });

  const invited = await team.inviteStaff({ businessId: business.id }, adminEmail, 'owner');
  if (invited.error) {
    await dbRequest(`businesses?id=eq.${business.id}`, { method: 'DELETE', prefer: 'return=minimal' });
    return { error: `The business was not created: ${invited.error}` };
  }
  await audit(admin, business.id, 'business.created', { name, slug, planId, adminEmail });
  return { business, invited: 'invited' in invited && !!invited.invited, adminEmail };
}

/** Change a business's status, plan, name or paid-until date. @param {{ email: string }} admin @param {unknown} rawId @param {Input} [input] */
async function updateBusiness(admin, rawId, input = {}) {
  if (!isBusinessId(rawId)) return { error: 'Invalid business.' };
  const id = String(rawId);
  /** @type {Record<string, unknown>} */
  const body = { updated_at: new Date().toISOString() };
  if ('status' in input) {
    if (!['active', 'suspended'].includes(input.status)) return { error: 'Status must be active or suspended.' };
    body.status = input.status;
  }
  if ('planId' in input) {
    if (!(await planExists(String(input.planId)))) return { error: 'Unknown plan.' };
    body.plan_id = String(input.planId);
  }
  if ('name' in input) {
    const name = String(input.name || '').trim();
    if (name.length < 2 || name.length > 80) return { error: 'Business name must be 2 to 80 characters.' };
    body.name = name;
  }
  if ('paidUntil' in input) {
    if (input.paidUntil !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(input.paidUntil))) return { error: 'Paid-until must be a date (YYYY-MM-DD) or empty.' };
    body.paid_until = input.paidUntil || null;
  }
  if ('limitOverrides' in input) {
    const o = cleanOverrides(input.limitOverrides);
    if (o.error !== undefined) return o;
    body.limit_overrides = o.overrides;
  }
  if (Object.keys(body).length === 1) return { error: 'Nothing to change.' };
  const res = await dbRequest(`businesses?id=eq.${id}`, { method: 'PATCH', prefer: 'return=representation', body });
  if (!res.ok || !res.data?.length) return { error: 'Business not found.' };
  await audit(admin, id, 'business.updated', Object.fromEntries(Object.entries(body).filter(([k]) => k !== 'updated_at')));
  // A business that was just suspended stops sending at once.
  require('./whatsapp.cjs').clearCache(id);
  require('./limits.cjs').clearCache(id);
  return { business: res.data[0] };
}

const INDUSTRIES = ['hospital', 'food', 'retail', 'services', 'general'];

/**
 * A business's basic details: its name and business type (industry). Platform Owner and Application Manager
 * (onboarding). The type decides the Clinic tools (hospital) and Meta's healthcare ad rules; existing data stays.
 * Plan, status, limits and payment stay Platform Owner only (updateBusiness).
 * @param {{ email: string }} admin @param {unknown} rawId @param {Input} [input]
 */
async function updateDetails(admin, rawId, input = {}) {
  if (!isBusinessId(rawId)) return { error: 'Invalid business.' };
  const id = String(rawId);
  const cur = await dbRequest(`businesses?id=eq.${id}&select=name,industry`);
  const before = cur.ok && Array.isArray(cur.data) ? cur.data[0] : null;
  if (!before) return { error: 'Business not found.' };
  /** @type {Record<string, unknown>} */
  const body = {};
  if ('name' in input) {
    const name = String(input.name || '').trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 80) return { error: 'Business name must be 2 to 80 characters.' };
    if (name !== before.name) body.name = name;
  }
  if ('industry' in input) {
    const industry = String(input.industry || '');
    if (!INDUSTRIES.includes(industry)) return { error: 'Pick the business type: hospital, food, retail, services or general.' };
    if (industry !== before.industry) body.industry = industry;
  }
  if (!Object.keys(body).length) return { business: { id, ...before }, unchanged: true };
  const res = await dbRequest(`businesses?id=eq.${id}`, { method: 'PATCH', prefer: 'return=representation', body: { ...body, updated_at: new Date().toISOString() } });
  if (!res.ok || !res.data?.length) return { error: 'Business not found.' };
  /** @type {Record<string, unknown>} */
  const details = {};
  for (const k of Object.keys(body)) details[k] = { from: before[k] ?? null, to: body[k] };
  await audit(admin, id, 'business.details_changed', details);
  return { business: res.data[0] };
}

const LIMIT_FIELDS = ['max_staff', 'max_contacts', 'max_broadcasts_month', 'max_automations', 'max_ai_replies_month', 'max_keyword_rules', 'analytics_days', 'max_whatsapp_numbers', 'max_custom_fields', 'max_import_rows_per_file', 'max_import_file_mb', 'max_import_rows_month'];

/**
 * Per-business changes to the plan's limits. A key that is left out uses the plan's value;
 * null means unlimited for this business; ai_enabled / ads_enabled switch a module on or off.
 * @param {unknown} input
 * @returns {{ error: string, overrides?: undefined } | { error?: undefined, overrides: Record<string, number | boolean | null> }}
 */
function cleanOverrides(input) {
  if (input === null) return { overrides: {} };
  if (typeof input !== 'object' || Array.isArray(input)) return { error: 'Overrides must be an object.' };
  /** @type {Record<string, number | boolean | null>} */
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (k === 'ai_enabled' || k === 'ads_enabled') { out[k] = !!v; continue; }
    if (!LIMIT_FIELDS.includes(k)) return { error: `Unknown limit: ${String(k).slice(0, 40)}.` };
    if (v === null) { out[k] = null; continue; }
    const n = Number(v);
    if (v === '' || !Number.isInteger(n) || n < 0 || n > 100000000) return { error: `${k.replace(/_/g, ' ')} must be a whole number (or null for unlimited).` };
    out[k] = n;
  }
  return { overrides: out };
}

/** Edit a plan's price and limits (null limit = unlimited). @param {{ email: string }} admin @param {unknown} planId @param {Input} [input] */
async function updatePlan(admin, planId, input = {}) {
  if (!(await planExists(String(planId)))) return { error: 'Unknown plan.' };
  /** @type {Record<string, unknown>} */
  const body = { updated_at: new Date().toISOString() };
  if ('name' in input) body.name = String(input.name || '').trim().slice(0, 40) || undefined;
  if ('priceMonthlyInr' in input) {
    const p = Number(input.priceMonthlyInr);
    if (!Number.isFinite(p) || p < 0 || p > 10000000) return { error: 'Price must be a number of rupees.' };
    body.price_monthly_inr = p;
  }
  if ('aiEnabled' in input) body.ai_enabled = !!input.aiEnabled;
  if ('adsEnabled' in input) body.ads_enabled = !!input.adsEnabled;
  for (const f of LIMIT_FIELDS) {
    if (!(f in (input.limits || {}))) continue;
    const v = input.limits[f];
    if (v === null || v === '') { body[f] = null; continue; }
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 100000000) return { error: `${f.replace(/_/g, ' ')} must be a whole number (or empty for unlimited).` };
    body[f] = n;
  }
  const res = await dbRequest(`plans?id=eq.${encodeURIComponent(String(planId))}`, { method: 'PATCH', prefer: 'return=representation', body });
  if (!res.ok || !res.data?.length) return { error: 'Could not save the plan.' };
  await audit(admin, null, 'plan.updated', { planId, ...body });
  require('./limits.cjs').clearCache();
  return { plan: res.data[0] };
}

// ---------------------------------------------------------------------------
// Onboarding (Platform Owner + Application Managers): setup progress, resend the owner's invite
// ---------------------------------------------------------------------------
/**
 * Each business with its setup checklist (WhatsApp connected? bot? team invited?…), newest first.
 * Yes/no per step only (server/business.cjs checklist): never chats, contacts or bot text.
 * @param {{ days?: unknown }} [q]
 */
async function onboarding(q = {}) {
  const days = Math.min(Math.max(Number(q.days) || 90, 1), 3650);
  const since = encodeURIComponent(new Date(Date.now() - days * 86400000).toISOString());
  const biz = await dbRequest(`businesses?select=id,name,slug,status,plan_id,created_at,created_by&created_at=gte.${since}&order=created_at.desc&limit=100`);
  if (!biz.ok) return { error: 'Could not load businesses.', status: 500 };
  const business = require('./business.cjs');
  const list = await Promise.all((biz.data || []).map(async (/** @type {Row} */ b) => {
    const [check, owners] = await Promise.all([
      business.checklist(b.id).catch(() => null),
      dbRequest(`staff_members?select=email,created_at&business_id=eq.${b.id}&role=eq.owner&order=created_at.asc&limit=1`),
    ]);
    return {
      id: b.id, name: b.name, slug: b.slug, status: b.status, plan_id: b.plan_id, created_at: b.created_at, created_by: b.created_by,
      ownerEmail: owners.ok ? owners.data?.[0]?.email || null : null,
      steps: check ? check.steps.map((/** @type {Row} */ s) => ({ id: s.id, label: s.label, done: s.done })) : [],
      doneCount: check ? check.doneCount : 0, total: check ? check.total : 0,
    };
  }));
  return { days, businesses: list };
}

/** @type {Map<string, number>} businessId -> last resend (ms) */
const lastResend = new Map();
const RESEND_GAP_MS = 10 * 60 * 1000;

/**
 * Send the Business Admin's invite again (they lost the email, or it expired). A login that was already set up
 * gets a "set your password" email instead. At most once every 10 minutes per business. Audited.
 * @param {PlatformAdmin} admin @param {unknown} rawId
 */
async function resendOwnerInvite(admin, rawId) {
  if (!isBusinessId(rawId)) return { error: 'Invalid business.' };
  const id = String(rawId);
  const owner = await dbRequest(`staff_members?select=email&business_id=eq.${id}&role=eq.owner&order=created_at.asc&limit=1`);
  const email = owner.ok ? owner.data?.[0]?.email : null;
  if (!email) return { error: 'This business has no Business Admin yet.', status: 404 };
  if (Date.now() - (lastResend.get(id) || 0) < RESEND_GAP_MS) return { error: 'An invite was sent less than 10 minutes ago. Ask them to check spam first.', status: 429 };
  lastResend.set(id, Date.now());
  const { serviceHeaders } = require('./db.cjs');
  const redirect = encodeURIComponent(await require('./siteUrl.cjs').siteUrl());
  const inv = await fetch(`${config.supabaseUrl}/auth/v1/invite?redirect_to=${redirect}`, { method: 'POST', headers: serviceHeaders(), body: JSON.stringify({ email }) });
  /** @type {'invite' | 'reset'} */
  let kind = 'invite';
  if (!inv.ok) {
    /** @type {any} */
    let data = {};
    try { data = await inv.json(); } catch { /* empty */ }
    const msg = String(data?.msg || data?.message || '');
    if (inv.status === 429 || /rate limit/i.test(msg)) { lastResend.delete(id); return { error: 'Supabase\'s email limit was reached. Try again later.', status: 429 }; }
    if (!(inv.status === 422 || /already/i.test(msg))) { lastResend.delete(id); return { error: msg || `Invite failed (${inv.status}).`, status: 502 }; }
    // They already have a login: a "set your password" email does the same job.
    kind = 'reset';
    const rec = await fetch(`${config.supabaseUrl}/auth/v1/recover?redirect_to=${redirect}`, { method: 'POST', headers: serviceHeaders(), body: JSON.stringify({ email }) });
    if (!rec.ok) { lastResend.delete(id); return { error: `Could not send the email (${rec.status}).`, status: 502 }; }
  }
  await audit(admin, id, 'business.invite_resent', { to: email, kind });
  return { sent: true, email, kind };
}

/** Tests only. */
function _resetResends() { lastResend.clear(); }

module.exports = {
  PLATFORM_ROLES,
  PLATFORM_ROLE_LABEL,
  isPlatformRole,
  requirePlatformAdmin,
  platformAdminForToken,
  requirePlatformRole,
  forgetLogin,
  audit,
  onboarding,
  resendOwnerInvite,
  _resetResends,
  _setPlatformAdminForToken,
  _setLoginForToken,
  overview,
  createBusiness,
  updateBusiness,
  updateDetails,
  updatePlan,
  slugify,
  countRows,
};
