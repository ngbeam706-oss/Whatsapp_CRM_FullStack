// @ts-check
// Team management: who can use the dashboard (staff_members) and their role, per business.
// Inviting uses Supabase Auth's admin invite: the person gets an email with a
// link to set their password, then lands on the dashboard.
// One login works for exactly one business: inviting someone who already works for
// another business is refused, never moved.
const { config } = require('./config.cjs');
const { dbRequest, serviceHeaders, dbReady } = require('./db.cjs');
const { ROLES, requireBusinessId } = require('./tenant.cjs');
const limits = require('./limits.cjs');

/** @typedef {import('./types.cjs').Staff} Staff */
/** @typedef {import('./types.cjs').Role} Role */

const ROLE_NAMES = 'Business Admin (owner), manager or agent';
/** @param {unknown} e */
const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || ''));
/** @param {unknown} id */
const isUuid = (id) => /^[0-9a-f-]{36}$/i.test(String(id));
const OTHER_BUSINESS = 'That person already works for another business. Each login can belong to one business only.';
/** @param {unknown} role @returns {role is Role} */
const isRole = (role) => /** @type {readonly unknown[]} */ (ROLES).includes(role);

/** @param {string} businessId */
async function listStaff(businessId) {
  requireBusinessId(businessId);
  const res = await dbRequest(`staff_members?select=user_id,email,role,created_at&business_id=eq.${businessId}&order=created_at.asc`);
  if (!res.ok) return { error: 'Could not load the team.' };
  // Names and job titles from "My profile" (never phone numbers: everyone in the team sees this list).
  const profiles = await require('./staffStats.cjs').profilesFor(businessId);
  return {
    staff: (res.data || []).map((/** @type {any} */ m) => ({
      ...m,
      full_name: profiles[m.user_id]?.full_name || null,
      job_title: profiles[m.user_id]?.job_title || null,
    })),
  };
}

/** The staff row for a login, in any business (server only). @param {string} userId */
async function staffRowFor(userId) {
  const res = await dbRequest(`staff_members?select=user_id,email,role,business_id&user_id=eq.${userId}`);
  return res.ok ? res.data?.[0] || null : null;
}

/** @param {string} businessId @param {string} email @param {Role} role */
async function addExisting(businessId, email, role) {
  const res = await dbRequest('rpc/staff_add_existing_to_business', {
    method: 'POST',
    body: { p_email: email, p_role: role, p_business: businessId },
  });
  if (!res.ok) {
    const msg = String(res.data?.message || '');
    if (/another business/i.test(msg)) return { error: OTHER_BUSINESS };
    if (/platform admin/i.test(msg)) return { error: 'That login is a platform admin and can\'t join a business.' };
    return { error: 'Could not add them. Has the M2 SQL been run?' };
  }
  if (!res.data?.length) return { error: 'No account found for that email.' };
  return { member: res.data[0], existing: true };
}

/** @param {{ businessId: string }} me  only the business is used @param {unknown} rawEmail @param {unknown} [role] */
async function inviteStaff(me, rawEmail, role = 'agent') {
  const businessId = requireBusinessId(me?.businessId);
  const email = String(rawEmail || '').trim().toLowerCase();
  if (!isEmail(email)) return { error: 'Enter a valid email address.' };
  if (!isRole(role)) return { error: `Role must be ${ROLE_NAMES}.` };
  if (!dbReady()) return { error: 'Server database access is not configured.' };
  // Plan limit: team size (someone already in this business can still be re-invited).
  const already = await dbRequest(`staff_members?select=user_id&business_id=eq.${businessId}&email=eq.${encodeURIComponent(email)}`);
  if (!(already.ok && already.data?.length)) {
    const room = await limits.check(businessId, 'staff', 1);
    if (room.error) return { error: room.error, limitReached: true };
  }

  const res = await fetch(`${config.supabaseUrl}/auth/v1/invite?redirect_to=${encodeURIComponent(config.publicSiteUrl)}`, {
    method: 'POST',
    headers: serviceHeaders(),
    body: JSON.stringify({ email }),
  });
  /** @type {any} */
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }

  if (res.ok && data?.id) {
    // A brand-new login, so it can't be in another business; check anyway.
    const existing = await staffRowFor(data.id);
    if (existing && existing.business_id !== businessId) return { error: OTHER_BUSINESS };
    const ins = await dbRequest('staff_members?on_conflict=user_id', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=representation',
      body: { user_id: data.id, email, role, business_id: businessId },
    });
    if (!ins.ok) return { error: 'They were invited, but could not be added to the staff list.' };
    return { member: ins.data[0], invited: true };
  }

  const msg = String(data?.msg || data?.message || data?.error_description || '');
  // Already has a login (e.g. created earlier in Supabase): just give them access.
  if (res.status === 422 || /already/i.test(msg)) return addExisting(businessId, email, role);
  if (res.status === 429 || /rate limit/i.test(msg)) {
    return { error: 'Supabase\'s email limit was reached (a few emails per hour on the built-in mailer). Try again later, or set up custom SMTP in Supabase -> Authentication -> Emails.' };
  }
  return { error: msg || `Invite failed (${res.status}).` };
}

/** @param {string} businessId */
async function countOwners(businessId) {
  const res = await dbRequest(`staff_members?select=user_id&role=eq.owner&business_id=eq.${businessId}`);
  return res.ok ? res.data.length : 0;
}

/** @param {unknown} userId @param {unknown} role @param {Staff} me */
async function updateRole(userId, role, me) {
  const businessId = requireBusinessId(me?.businessId);
  if (!isUuid(userId)) return { error: 'Invalid user.' };
  if (!isRole(role)) return { error: `Role must be ${ROLE_NAMES}.` };
  if (userId === me.id) return { error: 'You can\'t change your own role.' };
  const target = await dbRequest(`staff_members?select=role&user_id=eq.${userId}&business_id=eq.${businessId}`);
  if (!target.ok || !target.data?.length) return { error: 'Staff member not found.' };
  if (target.data[0].role === 'owner' && role !== 'owner' && (await countOwners(businessId)) <= 1) {
    return { error: 'There must be at least one Business Admin.' };
  }
  const res = await dbRequest(`staff_members?user_id=eq.${userId}&business_id=eq.${businessId}`, { method: 'PATCH', prefer: 'return=representation', body: { role } });
  if (!res.ok || !res.data?.length) return { error: 'Staff member not found.' };
  return { member: res.data[0] };
}

/** @param {unknown} userId @param {Staff} me */
async function removeStaff(userId, me) {
  const businessId = requireBusinessId(me?.businessId);
  if (!isUuid(userId)) return { error: 'Invalid user.' };
  if (userId === me.id) return { error: 'You can\'t remove yourself.' };
  const res = await dbRequest(`staff_members?user_id=eq.${userId}&business_id=eq.${businessId}`, { method: 'DELETE', prefer: 'return=representation' });
  if (!res.ok || !res.data?.length) return { error: 'Staff member not found.' };
  // Their chats in this business go back to the shared queue.
  await dbRequest(`whatsapp_leads?business_id=eq.${businessId}&assigned_to=eq.${encodeURIComponent(res.data[0].email)}`, {
    method: 'PATCH', prefer: 'return=minimal', body: { assigned_to: null },
  });
  return { removed: true };
}

// ---------------------------------------------------------------------------
// Passwords set by the Business Admin / managers (agents can't reset or change their own)
// ---------------------------------------------------------------------------
// Rules: managers set passwords for agents; the Business Admin for agents and managers. Nobody sets
// another Business Admin's password, or their own here. Agents get no reset emails ("Forgot password?"
// goes through forgotPassword below). Passwords are sent to Supabase Auth only, never stored or logged.

/** At least 8 characters with a letter and a number; Supabase's maximum is 72. @param {unknown} p */
function passwordProblem(p) {
  if (typeof p !== 'string') return 'Enter a password.';
  if (p.length < 8) return 'Use at least 8 characters.';
  if (p.length > 72) return 'Use at most 72 characters.';
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return 'Use letters and at least one number.';
  return null;
}

/** May `me` set a password for someone with this role? @param {Staff} me @param {string} targetRole */
const maySetPasswordFor = (me, targetRole) =>
  (me.role === 'owner' && (targetRole === 'agent' || targetRole === 'manager')) || (me.role === 'manager' && targetRole === 'agent');

/** @param {string} userId @param {Record<string, unknown>} body */
async function adminUpdateUser(userId, body) {
  const res = await fetch(`${config.supabaseUrl}/auth/v1/admin/users/${userId}`, { method: 'PUT', headers: serviceHeaders(), body: JSON.stringify(body) });
  return res.ok;
}

/** @param {Staff} me @param {string} action @param {string} targetEmail */
async function auditPassword(me, action, targetEmail) {
  await dbRequest('audit_log', {
    method: 'POST', prefer: 'return=minimal',
    body: { business_id: me.businessId, actor_email: me.email, actor_role: me.role, action, details: { member: targetEmail } },
  });
}

/**
 * Create a login with a password (agents; the Business Admin may also create managers this way) and add
 * it to this business. The login email can be any address the business chooses (e.g. ravi@mybusiness.in);
 * nothing is emailed. Onboarding details (`profile`: phone, job title, employee ID, joining date, branch, address,
 * emergency contact…) are checked before the login is created and saved with it.
 * @param {Staff} me @param {{ email?: unknown, password?: unknown, role?: unknown, fullName?: unknown, profile?: unknown }} input
 */
async function addWithPassword(me, input = {}) {
  const businessId = requireBusinessId(me?.businessId);
  const email = String(input.email || '').trim().toLowerCase();
  const role = input.role === undefined ? 'agent' : input.role;
  if (!isEmail(email)) return { error: 'Enter a valid login email.' };
  if (!isRole(role) || role === 'owner') return { error: 'Add agents (or, as the Business Admin, managers) with a password. Invite a Business Admin by email.' };
  if (!maySetPasswordFor(me, role)) return { error: 'Managers can add agents only.', status: 403 };
  const bad = passwordProblem(input.password);
  if (bad) return { error: bad };
  if (!dbReady()) return { error: 'Server database access is not configured.' };
  const fullName = typeof input.fullName === 'string' ? input.fullName.trim().slice(0, 80) : '';
  // Onboarding details: checked first, so a mistake never leaves a half-made login.
  const staffStats = require('./staffStats.cjs');
  const rawProfile = input.profile && typeof input.profile === 'object' ? /** @type {Record<string, unknown>} */ (input.profile) : {};
  const profile = staffStats.cleanProfile({ ...rawProfile, ...(fullName ? { fullName } : {}) }, { admin: true });
  if ('error' in profile) return { error: profile.error };
  const room = await limits.check(businessId, 'staff', 1);
  if (room.error) return { error: room.error, limitReached: true };

  const res = await fetch(`${config.supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST', headers: serviceHeaders(),
    body: JSON.stringify({ email, password: input.password, email_confirm: true, user_metadata: fullName ? { full_name: fullName } : {} }),
  });
  /** @type {any} */
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  /** @type {any} */
  let member = null;
  if (res.ok && data?.id) {
    const existing = await staffRowFor(data.id);
    if (existing && existing.business_id !== businessId) return { error: OTHER_BUSINESS };
    const ins = await dbRequest('staff_members?on_conflict=user_id', {
      method: 'POST', prefer: 'resolution=merge-duplicates,return=representation',
      body: { user_id: data.id, email, role, business_id: businessId },
    });
    if (!ins.ok) return { error: 'The login was created, but could not be added to the team.' };
    member = ins.data[0];
  } else if (res.status === 422 || /already/i.test(String(data?.msg || data?.message || ''))) {
    // That email already has a login: add it to this business (never moved from another), then set the password.
    const added = await addExisting(businessId, email, role);
    if (added.error || !added.member) return added;
    if (!(await adminUpdateUser(added.member.user_id, { password: input.password }))) return { error: 'They were added, but the password could not be set. Use "Set password" on their row.' };
    member = added.member;
  } else {
    return { error: String(data?.msg || data?.message || `Could not create the login (${res.status}).`) };
  }
  /** @type {string | null} */
  let profileWarning = null;
  if (Object.keys(profile.values).length) {
    const saved = await staffStats.upsertProfile(businessId, member.user_id, profile.values, me.email);
    if (!saved.ok) profileWarning = `The login was created, but the details were not saved: ${staffStats.saveError(saved)} Add them from their row.`;
  }
  await auditPassword(me, 'team.member_added_with_password', email);
  return { member: { user_id: member.user_id, email, role }, ...(profileWarning ? { profileWarning } : {}) };
}

/**
 * Set (reset) a team member's password.
 * @param {Staff} me @param {unknown} userId @param {unknown} password
 */
async function setPassword(me, userId, password) {
  const businessId = requireBusinessId(me?.businessId);
  if (!isUuid(userId)) return { error: 'Invalid user.' };
  if (userId === me.id) return { error: 'Change your own password with "Forgot password?" on the sign-in page.' };
  const target = await dbRequest(`staff_members?select=user_id,email,role&user_id=eq.${userId}&business_id=eq.${businessId}`);
  const row = target.ok ? target.data?.[0] : null;
  if (!row) return { error: 'Staff member not found.', status: 404 };
  if (!maySetPasswordFor(me, row.role)) {
    return { error: row.role === 'owner' ? 'A Business Admin\'s password can only be reset by themselves ("Forgot password?").' : 'Managers can set passwords for agents only.', status: 403 };
  }
  const bad = passwordProblem(password);
  if (bad) return { error: bad };
  if (!(await adminUpdateUser(String(userId), { password }))) return { error: 'Could not set the password. Try again.', status: 502 };
  await auditPassword(me, 'team.password_set', row.email);
  return { updated: true };
}

/**
 * "Forgot password?" on the sign-in page. Agents' passwords are managed by their Business Admin or
 * manager, so they get no reset email. The answer is the same either way (it never reveals who has a
 * login or what their role is).
 * @param {unknown} rawEmail
 */
async function forgotPassword(rawEmail) {
  const email = String(rawEmail || '').trim().toLowerCase();
  const answer = { message: 'If this login can reset its own password, a reset link is on its way. Agents: ask your manager or Business Admin to reset your password.' };
  if (!isEmail(email) || !dbReady()) return answer;
  // (case-insensitive: older rows may have capitals)
  const row = await dbRequest(`staff_members?select=role&email=ilike.${encodeURIComponent(email.replace(/[%_\\]/g, (c) => `\\${c}`))}`);
  if (!row.ok) return answer; // can't tell who this is: send nothing rather than risk an agent reset
  if ((row.data || []).some((/** @type {any} */ r) => r.role === 'agent')) return answer;
  try {
    await fetch(`${config.supabaseUrl}/auth/v1/recover?redirect_to=${encodeURIComponent(config.publicSiteUrl)}`, {
      method: 'POST', headers: serviceHeaders(), body: JSON.stringify({ email }),
    });
  } catch { /* same answer */ }
  return answer;
}

module.exports = { ROLES, listStaff, inviteStaff, updateRole, removeStaff, isEmail, OTHER_BUSINESS, addWithPassword, setPassword, forgotPassword, passwordProblem };
