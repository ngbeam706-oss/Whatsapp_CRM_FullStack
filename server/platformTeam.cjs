// @ts-check
// Platform team (Platform Owner only): who works on the platform itself and with which role.
//   owner = Platform Owner, manager = Application Manager, developer = Application Developer.
// Rules: a platform login is never business staff (database trigger); nobody changes or removes themselves;
// the last Platform Owner can't be removed or demoted; every change is audited; a removed person loses access
// on their next request (server/platform.cjs reads the role on every request). docs/progress/platform-roles.md
const { config } = require('./config.cjs');
const { dbRequest, serviceHeaders, dbReady } = require('./db.cjs');
const platform = require('./platform.cjs');
const team = require('./team.cjs');

/** @typedef {import('./platform.cjs').PlatformAdmin} PlatformAdmin */
/** @typedef {import('./platform.cjs').PlatformRole} PlatformRole */

/** @param {unknown} id */
const isUuid = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ''));
const ROLE_NAMES = 'Platform Owner, Application Manager or Application Developer';
const BUSINESS_STAFF = 'That login works for a business. Platform staff need their own separate login.';

async function list() {
  const r = await dbRequest('platform_admins?select=user_id,email,role,added_by,created_at&order=created_at.asc');
  if (!r.ok) return { error: 'Could not load the platform team. Has the platform roles SQL been run?', status: 500 };
  return { members: r.data || [], roles: platform.PLATFORM_ROLES.map(k => ({ key: k, label: platform.PLATFORM_ROLE_LABEL[k] })) };
}

async function countOwners() {
  const r = await dbRequest('platform_admins?select=user_id&role=eq.owner');
  return r.ok ? (r.data || []).length : 0;
}

/** @param {string} userId */
async function memberOf(userId) {
  const r = await dbRequest(`platform_admins?select=user_id,email,role&user_id=eq.${userId}`);
  return r.ok ? r.data?.[0] || null : null;
}

/** Add an existing login (SQL helper; refuses business staff). @param {string} email @param {PlatformRole} role @param {PlatformAdmin} me */
async function addExisting(email, role, me) {
  const r = await dbRequest('rpc/platform_staff_add_existing', { method: 'POST', body: { p_email: email, p_role: role, p_added_by: me.email } });
  if (!r.ok) {
    const msg = String(r.data?.message || '');
    if (/works for a business/i.test(msg)) return { error: BUSINESS_STAFF };
    return { error: 'Could not add them. Has the platform roles SQL been run?' };
  }
  if (!Array.isArray(r.data) || !r.data.length) return { error: 'No login found for that email.' };
  return { member: r.data[0], invited: false };
}

/**
 * Invite someone to the platform team by email with a role. A new login gets an invite email to set a password;
 * an existing login (not business staff) is added as it is.
 * @param {PlatformAdmin} me @param {{ email?: unknown, role?: unknown }} input
 */
async function add(me, input = {}) {
  const email = String(input.email || '').trim().toLowerCase();
  const role = input.role === undefined ? 'manager' : input.role;
  if (!team.isEmail(email)) return { error: 'Enter a valid email address.' };
  if (!platform.isPlatformRole(role)) return { error: `Role must be ${ROLE_NAMES}.` };
  if (!dbReady()) return { error: 'Server database access is not configured.' };
  const already = await dbRequest(`platform_admins?select=user_id&email=eq.${encodeURIComponent(email)}`);
  if (already.ok && already.data?.length) return { error: 'They are already in the platform team. Change their role instead.' };
  // Someone who works for a business can't also be platform staff (checked here for a clear message; the trigger enforces it).
  const staff = await dbRequest(`staff_members?select=user_id&email=ilike.${encodeURIComponent(email.replace(/[%_\\]/g, (c) => `\\${c}`))}`);
  if (staff.ok && staff.data?.length) return { error: BUSINESS_STAFF };

  const res = await fetch(`${config.supabaseUrl}/auth/v1/invite?redirect_to=${encodeURIComponent(config.publicSiteUrl)}`, {
    method: 'POST', headers: serviceHeaders(), body: JSON.stringify({ email }),
  });
  /** @type {any} */
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  /** @type {{ error: string } | { member: any, invited: boolean }} */
  let out;
  if (res.ok && data?.id) {
    const ins = await dbRequest('platform_admins', { method: 'POST', prefer: 'return=representation', body: { user_id: data.id, email, role, added_by: me.email } });
    if (!ins.ok) {
      const msg = String(ins.data?.message || '');
      return { error: /works for a business/i.test(msg) ? BUSINESS_STAFF : 'They were invited, but could not be added to the platform team.' };
    }
    out = { member: ins.data[0], invited: true };
  } else {
    const msg = String(data?.msg || data?.message || data?.error_description || '');
    if (res.status === 429 || /rate limit/i.test(msg)) return { error: 'Supabase\'s email limit was reached. Try again later.' };
    if (!(res.status === 422 || /already/i.test(msg))) return { error: msg || `Invite failed (${res.status}).` };
    out = await addExisting(email, role, me);
  }
  if ('error' in out) return out;
  await platform.audit(me, null, 'platform.staff_added', { member: email, role, invited: out.invited });
  return { member: { user_id: out.member.user_id, email, role }, invited: out.invited };
}

/** @param {PlatformAdmin} me @param {unknown} userId @param {unknown} role */
async function changeRole(me, userId, role) {
  if (!isUuid(userId)) return { error: 'Invalid person.' };
  if (!platform.isPlatformRole(role)) return { error: `Role must be ${ROLE_NAMES}.` };
  if (userId === me.id) return { error: 'You can\'t change your own role.' };
  const m = await memberOf(String(userId));
  if (!m) return { error: 'Not in the platform team.', status: 404 };
  if (m.role === role) return { member: m };
  if (m.role === 'owner' && (await countOwners()) <= 1) return { error: 'There must be at least one Platform Owner.' };
  const r = await dbRequest(`platform_admins?user_id=eq.${userId}`, { method: 'PATCH', prefer: 'return=representation', body: { role } });
  if (!r.ok || !r.data?.length) return { error: 'Not in the platform team.', status: 404 };
  platform.forgetLogin(String(userId));
  await platform.audit(me, null, 'platform.staff_role_changed', { member: m.email, from: m.role, to: role });
  return { member: { user_id: m.user_id, email: m.email, role } };
}

/** Remove from the platform team (their login stays; it just can't open the console). @param {PlatformAdmin} me @param {unknown} userId */
async function remove(me, userId) {
  if (!isUuid(userId)) return { error: 'Invalid person.' };
  if (userId === me.id) return { error: 'You can\'t remove yourself.' };
  const m = await memberOf(String(userId));
  if (!m) return { error: 'Not in the platform team.', status: 404 };
  if (m.role === 'owner' && (await countOwners()) <= 1) return { error: 'There must be at least one Platform Owner.' };
  const r = await dbRequest(`platform_admins?user_id=eq.${userId}`, { method: 'DELETE', prefer: 'return=representation' });
  if (!r.ok || !r.data?.length) return { error: 'Not in the platform team.', status: 404 };
  platform.forgetLogin(String(userId));
  // Their open support queries go back to the shared queue.
  await dbRequest(`platform_queries?assigned_to=eq.${encodeURIComponent(String(m.email).toLowerCase())}&stage=not.in.(resolved,closed)`, {
    method: 'PATCH', prefer: 'return=minimal', body: { assigned_to: null },
  });
  await platform.audit(me, null, 'platform.staff_removed', { member: m.email, role: m.role });
  return { removed: true };
}

/** Who a support query can be assigned to: Platform Owners and Application Managers (emails only). */
async function assignees() {
  const r = await dbRequest('platform_admins?select=email,role&role=in.(owner,manager)&order=email.asc');
  if (!r.ok) return { error: 'Could not load the platform team.', status: 500 };
  return { assignees: (r.data || []).map((/** @type {any} */ m) => ({ email: String(m.email).toLowerCase(), role: m.role })) };
}

module.exports = { list, add, changeRole, remove, assignees };
