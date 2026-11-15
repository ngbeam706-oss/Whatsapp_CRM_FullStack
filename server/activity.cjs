// @ts-check
// Activity log (docs/progress/activity-log.md, L1 + L2 + L3): who did what in a business, for the Business Admin.
//
// Rules for every entry (audit_log, add-only):
//   - who (actor email + role), what (action `area.verb`), when, and old -> new for settings
//   - NEVER the content: no message text, customer details, private values, passwords, keys, bot / AI text
//     (FORBIDDEN_KEYS are refused at write time and checked by a test)
//   - the customer an entry is about goes in audit_log.subject_phone, a column only the server can read (SQL 20261144);
//     the Business Admin's screen shows the customer's current name, never the number; the Platform console never gets it
//   - sign-in device + approximate network (masked IP) go in audit_log.private_details, server-only too
// Sign-ins: the browser calls POST /api/auth/signed-in right after signing in; the server checks the token, works out
// who it is (staff, doctor or platform staff) and records it once per session.
const crypto = require('crypto');
const { dbRequest, digits } = require('./db.cjs');
const { requireBusinessId, isBusinessId } = require('./tenant.cjs');

/** @typedef {{ email: string, role: string, businessId?: string | null }} Actor */
/** @typedef {Record<string, any>} Row */

/** Keys that must never appear in an entry's details (at any depth). */
const FORBIDDEN_KEYS = ['phone', 'body', 'text', 'value', 'key', 'token', 'password', 'note', 'name'];
const PHONE_RE = /^\d{7,15}$/;
const PAGE = 50;

/** The forbidden keys found in some details, with their paths. Pure. @param {unknown} obj @param {string} [path] @returns {string[]} */
function forbiddenKeysIn(obj, path = '') {
  /** @type {string[]} */
  const out = [];
  if (Array.isArray(obj)) obj.forEach((v, i) => out.push(...forbiddenKeysIn(v, `${path}[${i}]`)));
  else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      const p = path ? `${path}.${k}` : k;
      if (FORBIDDEN_KEYS.includes(k.toLowerCase())) out.push(p);
      out.push(...forbiddenKeysIn(v, p));
    }
  }
  return out;
}

/** Details without forbidden keys (a bug in a caller must never leak content into the log). Pure. @param {any} obj @returns {any} */
function scrub(obj) {
  if (Array.isArray(obj)) return obj.map(scrub);
  if (!obj || typeof obj !== 'object') return obj;
  /** @type {Row} */
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (!FORBIDDEN_KEYS.includes(k.toLowerCase())) out[k] = scrub(v);
  return out;
}

/** When the two server-only columns were last found missing (before SQL 20261144); re-checked after 5 minutes. */
let extraColumnsMissingAt = 0;
const RECHECK_MS = 5 * 60000;
/**
 * Add one entry. details: no content (forbidden keys are dropped, with a warning). subjectPhone: the customer it is
 * about (server-only column). privateDetails: server-only details (sign-in device / network). Never throws.
 * @param {Actor} actor @param {string} action @param {Row} [details]
 * @param {{ subjectPhone?: unknown, privateDetails?: Row | null, businessId?: string | null }} [o]
 */
async function record(actor, action, details = {}, { subjectPhone = null, privateDetails = null, businessId } = {}) {
  try {
    const bad = forbiddenKeysIn(details);
    if (bad.length) console.warn(`[activity] ${action}: dropped content keys ${bad.join(', ')}`);
    const biz = businessId !== undefined ? businessId : actor.businessId || null;
    const phone = subjectPhone ? digits(subjectPhone) : '';
    /** @type {Row} */
    const body = { business_id: biz && isBusinessId(biz) ? biz : null, actor_email: String(actor.email || '').toLowerCase() || null, actor_role: actor.role || null, action, details: bad.length ? scrub(details) : details };
    /** @type {Row} */
    const extra = {
      ...(PHONE_RE.test(phone) ? { subject_phone: phone } : {}),
      ...(privateDetails ? { private_details: privateDetails } : {}),
    };
    if (Date.now() - extraColumnsMissingAt > RECHECK_MS && Object.keys(extra).length) {
      const r = await dbRequest('audit_log', { method: 'POST', prefer: 'return=minimal', body: { ...body, ...extra } });
      if (r.ok) return true;
      if (r.status === 409) return false; // a duplicate (sign-in already recorded for this session)
      if (r.status !== 400) return false;
      extraColumnsMissingAt = Date.now(); // before SQL 20261144: write without them for a few minutes, then try again
    }
    const r = await dbRequest('audit_log', { method: 'POST', prefer: 'return=minimal', body });
    return r.ok;
  } catch (err) {
    console.warn('[activity] not recorded:', err instanceof Error ? err.message : err);
    return false;
  }
}
/** Tests: forget that the columns were missing. */
const _reset = () => { extraColumnsMissingAt = 0; };
/** Tests: pretend the columns went missing `ago` ms ago. @param {number} ago */
const _missingSince = (ago) => { extraColumnsMissingAt = Date.now() - ago; };

/** An entry by a staff member (req.staff). @param {import('./types.cjs').Staff} staff @param {string} action @param {Row} [details] @param {{ subjectPhone?: unknown }} [o] */
const byStaff = (staff, action, details = {}, o = {}) => record({ email: staff.email, role: staff.role, businessId: staff.businessId }, action, details, o);

// ---------------------------------------------------------------------------
// Sign-ins: device, approximate network, once per session
// ---------------------------------------------------------------------------
/**
 * An approximate network: IPv4 with the last part hidden (49.37.12.x), IPv6 cut to its first 48 bits. Pure.
 * @param {unknown} raw @returns {string}
 */
function maskIp(raw) {
  let ip = String(raw || '').trim();
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) ip = mapped[1];
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.x`;
  if (ip.includes(':')) {
    const head = ip.split('%')[0].split('::')[0].split(':').filter(Boolean);
    const full = ip.split('%')[0].includes('::') ? [...head, '0', '0', '0'].slice(0, 3) : head.slice(0, 3);
    return `${full.join(':')}::/48`;
  }
  return 'unknown';
}

/** "Chrome on Android" from a user agent (browser + OS only, short). Pure. @param {unknown} ua */
function deviceOf(ua) {
  const s = String(ua || '');
  const browser = /Edg\//.test(s) ? 'Edge' : /OPR\/|Opera/.test(s) ? 'Opera' : /SamsungBrowser/.test(s) ? 'Samsung Internet'
    : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : 'Browser';
  const os = /Android/.test(s) ? 'Android' : /iPhone|iPad|iPod/.test(s) ? 'iOS' : /Windows/.test(s) ? 'Windows'
    : /Mac OS X|Macintosh/.test(s) ? 'macOS' : /CrOS/.test(s) ? 'ChromeOS' : /Linux/.test(s) ? 'Linux' : 'another system';
  return `${browser} on ${os}`;
}

/** One key per sign-in session: Supabase's session_id claim (the token was checked with Supabase first), else a hash. @param {string} token */
function sessionKey(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split('.')[1] || '', 'base64url').toString('utf8'));
    if (payload && typeof payload.session_id === 'string' && /^[0-9a-f-]{36}$/i.test(payload.session_id)) return payload.session_id;
  } catch { /* not a JWT (tests): hash below */ }
  return crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 32);
}

/**
 * Who a token belongs to: business staff, a clinic doctor, or platform staff. null = none of them.
 * @param {string | null} token @returns {Promise<Actor & { kind: 'staff' | 'doctor' | 'platform' } | null>}
 */
async function whoIs(token) {
  if (!token) return null;
  const staff = await require('./auth.cjs').verifyStaffToken(token);
  if (staff && !('paused' in staff)) return { kind: 'staff', email: staff.email, role: staff.role, businessId: staff.businessId };
  const doctor = await require('./clinic.cjs').doctorForToken(token).catch(() => null);
  if (doctor) return { kind: 'doctor', email: doctor.email, role: 'doctor', businessId: doctor.businessId };
  const admin = await require('./platform.cjs').platformAdminForToken(token).catch(() => null);
  if (admin) return { kind: 'platform', email: admin.email, role: `platform_${admin.role}`, businessId: null };
  return null;
}

/**
 * auth.signed_in, once per session: device, masked network and a "new device" flag (a device not seen in this
 * person's earlier sign-ins; the very first sign-in is not flagged). Server-only details.
 * @param {import('./types.cjs').AppRequest} req
 */
async function signedIn(req) {
  const token = require('./auth.cjs').extractToken(req);
  const who = await whoIs(token);
  if (!who || !token) return { error: 'Sign in required.', status: 401 };
  const session = sessionKey(token);
  const seen = await dbRequest(`audit_log?action=eq.auth.signed_in&private_details->>session=eq.${encodeURIComponent(session)}&select=id&limit=1`);
  if (seen?.ok && Array.isArray(seen.data) && seen.data.length) return { recorded: false, duplicate: true };
  const device = deviceOf(req.get('user-agent'));
  const network = maskIp(require('./security.cjs').clientIp(req));
  const prev = await dbRequest(`audit_log?action=eq.auth.signed_in&actor_email=eq.${encodeURIComponent(who.email.toLowerCase())}&select=private_details&order=id.desc&limit=50`);
  const earlier = prev.ok && Array.isArray(prev.data) ? prev.data : [];
  const newDevice = earlier.length > 0 && !earlier.some((/** @type {Row} */ p) => p.private_details?.device === device);
  const ok = await record(who, 'auth.signed_in', { as: who.kind, newDevice }, { privateDetails: { session, device, network, newDevice } });
  return { recorded: ok, newDevice };
}

/** auth.signed_out / auth.password_changed (the person themselves; the token is checked). @param {import('./types.cjs').AppRequest} req @param {'auth.signed_out' | 'auth.password_changed'} action */
async function selfEvent(req, action) {
  const token = require('./auth.cjs').extractToken(req);
  const who = await whoIs(token);
  if (!who || !token) return { error: 'Sign in required.', status: 401 };
  // Sign-out once per session (a repeated call is answered without writing again); a password change can happen twice,
  // so it is only rate-limited (server/activityRoutes.cjs).
  const session = sessionKey(token);
  const seen = action !== 'auth.signed_out' ? null : await dbRequest(`audit_log?action=eq.${action}&private_details->>session=eq.${encodeURIComponent(session)}&select=id&limit=1`);
  if (seen?.ok && Array.isArray(seen.data) && seen.data.length) return { recorded: false, duplicate: true };
  return { recorded: await record(who, action, { as: who.kind }, { privateDetails: { session } }) };
}

/** Last sign-in per person of a business (Team page). @param {string} biz @returns {Promise<Record<string, string>>} */
async function lastSignedIn(biz) {
  const r = await dbRequest(`audit_log?business_id=eq.${requireBusinessId(biz)}&action=eq.auth.signed_in&select=actor_email,created_at&order=id.desc&limit=2000`);
  /** @type {Record<string, string>} */
  const out = {};
  for (const x of r.ok && Array.isArray(r.data) ? r.data : []) { const e = String(x.actor_email || '').toLowerCase(); if (e && !out[e]) out[e] = x.created_at; }
  return out;
}

// ---------------------------------------------------------------------------
// The Activity log screen (Business Admin only)
// ---------------------------------------------------------------------------
/** @type {Record<string, string[]>} areas -> action prefixes */
const AREAS = {
  team: ['team.', 'staff.', 'staff_profile.'],
  chats: ['chat.', 'lead.note', 'saved_reply.', 'call_recording.'],
  leads: ['lead.', 'leads.', 'import.', 'custom_field.', 'customer_details.', 'lead_status.', 'lead_statuses.', 'lead_assignment.'],
  broadcasts: ['broadcast.', 'campaign.', 'automation.', 'template.'],
  ads: ['ads.', 'ad.'],
  clinic: ['clinic.'],
  security: ['auth.'],
  settings: ['ai.', 'whatsapp.', 'bot.', 'business.', 'activity.'],
};
const AREA_LABEL = { team: 'Team', chats: 'Chats', leads: 'Leads', broadcasts: 'Broadcasts', ads: 'Ads', clinic: 'Clinic', security: 'Security', settings: 'Settings' };
/** The area of an action. Pure. @param {string} action */
function areaOf(action) {
  for (const [area, prefixes] of Object.entries(AREAS)) {
    if (area === 'chats' && action.startsWith('lead.') && action !== 'lead.note_added') continue;
    if (prefixes.some(p => action === p || action.startsWith(p))) return area;
  }
  return 'settings';
}
const ROLE_LABEL = { owner: 'Business Admin', manager: 'manager', agent: 'agent', doctor: 'doctor' };
const rupees = (/** @type {unknown} */ v) => `₹${Number(v).toLocaleString('en-IN')}`;
/** @param {unknown} v */
const list = (v) => (Array.isArray(v) ? v.join(', ') : String(v ?? ''));

/**
 * What happened, as the end of a sentence ("transferred the chat with Ravi to Arjun"). Pure.
 * @param {Row} e  the entry @param {{ person: (email: unknown) => string, customer: string }} ctx
 * @returns {string}
 */
function phrase(e, ctx) {
  const d = e.details || {};
  const p = ctx.person;
  const c = ctx.customer;
  /** @type {Record<string, () => string>} */
  const P = {
    'auth.signed_in': () => `signed in${d.newDevice ? ' from a new device' : ''}`,
    'auth.signed_out': () => 'signed out',
    'auth.password_changed': () => 'changed their own password',
    'team.invited': () => `invited ${p(d.member)} as ${ROLE_LABEL[/** @type {keyof typeof ROLE_LABEL} */ (d.role)] || d.role}`,
    'team.role_changed': () => `changed ${p(d.member)}'s role from ${ROLE_LABEL[/** @type {keyof typeof ROLE_LABEL} */ (d.from)] || d.from} to ${ROLE_LABEL[/** @type {keyof typeof ROLE_LABEL} */ (d.to)] || d.to}`,
    'team.removed': () => `removed ${p(d.member)} from the team${d.chatsReturned ? ` (${d.chatsReturned} chats back in the queue)` : ''}`,
    'team.member_added_with_password': () => `added ${p(d.member)} with a password`,
    'team.password_set': () => `set a new password for ${p(d.member)}`,
    'ai.provider_changed': () => `changed the AI provider${d.provider ? ` to ${d.provider}` : ''}${d.model ? ` (${d.model})` : ''}${d.keyChanged ? `, new key …${d.keyLast4 || ''}` : ''}`,
    'ai.settings_changed': () => (d.autoReply !== undefined ? `turned AI replies ${d.autoReply ? 'on' : 'off'}` : `changed the AI assistant settings (${list(d.changed)})`),
    'whatsapp.token_changed': () => `changed the WhatsApp ${list(d.changed) || 'connection'}${d.tokenLast4 ? ` (token …${d.tokenLast4})` : ''}`,
    'whatsapp.disconnected': () => 'disconnected WhatsApp',
    'chat.claimed': () => `took the chat with ${c}`,
    'chat.transferred': () => (d.count > 1 ? `moved ${d.count} chats to ${d.to ? p(d.to) : 'the queue'}` : `transferred the chat with ${c}${d.from ? ` from ${p(d.from)}` : ''} to ${d.to ? p(d.to) : 'the queue'}`),
    'chat.done': () => `marked the chat with ${c} done${d.reason ? ` (${String(d.reason).replace(/_/g, ' ')})` : ''}`,
    'chat.reopened': () => `reopened the chat with ${c}`,
    'chat.bot_paused': () => (d.paused === false ? `turned the bot back on for ${c}` : `paused the bot for ${c}${d.hours ? ` for ${d.hours} h` : ''}`),
    'lead.renamed': () => `renamed ${c}`,
    'lead.tags_changed': () => `changed ${c}'s tags${d.added?.length ? `: added ${list(d.added)}` : ''}${d.removed?.length ? `${d.added?.length ? ';' : ':'} removed ${list(d.removed)}` : ''}`,
    'lead.note_added': () => `added a note to ${c}`,
    'broadcast.created': () => `created the broadcast "${d.campaign || ''}" (${d.template || 'template'}, ${d.audience ?? 0} people)`,
    'broadcast.sent': () => `started sending the broadcast "${d.campaign || ''}" to ${d.audience ?? 0} people`,
    'broadcast.scheduled': () => `scheduled the broadcast "${d.campaign || ''}"`,
    'broadcast.cancelled': () => `cancelled the broadcast "${d.campaign || ''}"`,
    'automation.created': () => `created the follow-up "${d.automation || ''}"`,
    'automation.changed': () => `changed the follow-up "${d.automation || ''}" (${list(d.changed)})`,
    'automation.toggled': () => `turned the follow-up "${d.automation || ''}" ${d.on ? 'on' : 'off'}`,
    'automation.deleted': () => `deleted the follow-up "${d.automation || ''}"`,
    'bot.flow_changed': () => `changed the bot (${list(d.parts) || 'menus'})`,
    'bot.flow_reset': () => 'reset the bot to its starting menus',
    'bot.rule_saved': () => `saved a keyword auto-reply${d.count ? ` (${d.count} rules)` : ''}`,
    'bot.rule_deleted': () => 'deleted a keyword auto-reply',
    'template.created': () => `created the message template "${d.template || ''}" (${String(d.category || '').toLowerCase()})`,
    'template.deleted': () => `deleted the message template "${d.template || ''}"`,
    'ads.funnel_exported': () => `downloaded the Ads funnel (${d.days ? `${d.days} days` : 'dates chosen'}, ${d.rows ?? 0} rows)`,
    'clinic.patient_changed': () => `changed ${c}'s patient details (${list(d.fields)})`,
    'clinic.follow_up_done': () => `marked ${c}'s follow-up done`,
    'clinic.doctor_updated': () => `changed ${d.doctor ? `Dr ${String(d.doctor).replace(/^dr\.?\s*/i, '')}'s` : 'a doctor\'s'} details${d.fee ? ` (fee ${d.fee.from != null ? `${rupees(d.fee.from)} → ` : ''}${rupees(d.fee.to)})` : ''}`,
    'leads.exported': () => `downloaded ${d.count ?? 0} leads${d.privateFields ? ` with ${d.privateFields} private field(s)` : ''}`,
    'leads.deleted': () => `permanently deleted ${d.count ?? 0} leads`,
    'import.started': () => `started importing ${d.rows ?? 0} rows from "${d.fileName || 'a file'}"`,
    'import.finished': () => `finished an import: ${d.created ?? 0} new, ${d.updated ?? 0} updated, ${d.rejected ?? 0} rejected`,
    'import.undone': () => `undid an import (${d.removed ?? 0} removed, ${d.restored ?? 0} put back)`,
    'customer_details.changed': () => `changed customer details of ${c} (${list(d.keys)})`,
    'activity.exported': () => `downloaded the activity log (${d.count ?? 0} entries)`,
  };
  const f = P[e.action];
  if (f) return f();
  // Anything else: the action in plain words ("ads campaign paused").
  return `${String(e.action).replace(/[._]/g, ' ')}${c && e.subject_phone ? ` (${c})` : ''}`;
}

/** @param {Row} e @param {{ me: string, person: (email: unknown) => string, roleOf: (email: unknown, role: unknown) => string, customer: (phone: unknown) => string }} ctx */
function sentence(e, ctx) {
  const actor = String(e.actor_email || '').toLowerCase();
  const who = actor && actor === ctx.me ? 'You' : actor ? `${ctx.person(actor)} (${ctx.roleOf(actor, e.actor_role)})` : 'The system';
  return `${who} ${phrase(e, { person: ctx.person, customer: ctx.customer(e.subject_phone) })}`;
}

/** @param {import('./types.cjs').Staff} staff */
const ownerOnly = (staff) => (staff?.role === 'owner' ? null : { error: 'Only the Business Admin can see the activity log.', status: 403 });

/**
 * Filters for the list (all optional): person (email), area, from / to (YYYY-MM-DD, India days), q (search in the
 * sentences), beforeId (paging), tab ('security' = sign-ins only).
 * @param {string} biz @param {Row} q
 */
function queryParts(biz, q) {
  const parts = [`business_id=eq.${biz}`];
  const person = String(q.person || '').trim().toLowerCase();
  if (/^[^\s@,()]+@[^\s@,()]+$/.test(person)) parts.push(`actor_email=eq.${encodeURIComponent(person)}`);
  const area = q.tab === 'security' ? 'security' : String(q.area || '');
  if (area === 'security' && q.tab === 'security') parts.push('action=eq.auth.signed_in');
  else if (Object.hasOwn(AREAS, area)) parts.push(`or=(${AREAS[area].map(p => `action.like.${p.replace(/\.$/, '')}.*`).join(',')}${area === 'chats' ? ',action.eq.lead.note_added' : ''})`);
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (day.test(String(q.from || ''))) parts.push(`created_at=gte.${encodeURIComponent(new Date(Date.parse(`${q.from}T00:00:00Z`) - 330 * 60000).toISOString())}`);
  if (day.test(String(q.to || ''))) parts.push(`created_at=lt.${encodeURIComponent(new Date(Date.parse(`${q.to}T00:00:00Z`) - 330 * 60000 + 86400000).toISOString())}`);
  return parts;
}

/** Names for the people and customers on some entries (one read each). @param {string} biz @param {Row[]} rows */
async function namesFor(biz, rows) {
  const team = await dbRequest(`staff_members?business_id=eq.${biz}&select=user_id,email,role`);
  const members = team.ok && Array.isArray(team.data) ? team.data : [];
  const profiles = await require('./staffStats.cjs').profilesFor(biz);
  /** @type {Map<string, { name: string, role: string }>} */
  const people = new Map(members.map((/** @type {Row} */ m) => [String(m.email).toLowerCase(), { name: profiles[m.user_id]?.full_name || String(m.email).split('@')[0], role: m.role }]));
  const phones = [...new Set(rows.map(r => String(r.subject_phone || '')).filter(p => PHONE_RE.test(p)))];
  /** @type {Map<string, string>} */
  const customers = new Map();
  for (let i = 0; i < phones.length; i += 100) {
    const r = await dbRequest(`whatsapp_leads?business_id=eq.${biz}&phone=in.(${phones.slice(i, i + 100).join(',')})&select=phone,name`);
    for (const l of r.ok && Array.isArray(r.data) ? r.data : []) {
      const n = String(l.name || '').trim();
      customers.set(String(l.phone), n && !/^\+?\d[\d\s]*$/.test(n) ? n : 'a customer');
    }
  }
  return {
    person: (/** @type {unknown} */ email) => people.get(String(email || '').toLowerCase())?.name || String(email || 'someone').split('@')[0],
    roleOf: (/** @type {unknown} */ email, /** @type {unknown} */ role) => {
      const r = String(people.get(String(email || '').toLowerCase())?.role || role || '');
      return ROLE_LABEL[/** @type {keyof typeof ROLE_LABEL} */ (r)] || (r.startsWith('platform_') ? 'platform team' : r || 'staff');
    },
    // A customer who has been deleted since: "a deleted customer". The number is never shown.
    customer: (/** @type {unknown} */ phone) => (phone ? customers.get(String(phone)) || 'a deleted customer' : 'a customer'),
  };
}

/** One entry as the screen shows it. @param {Row} e @param {Awaited<ReturnType<typeof namesFor>>} names @param {string} me */
function present(e, names, me) {
  const security = e.action === 'auth.signed_in' && e.private_details
    ? { device: String(e.private_details.device || ''), network: String(e.private_details.network || ''), newDevice: !!e.private_details.newDevice }
    : null;
  return {
    id: e.id, at: e.created_at, action: e.action, area: areaOf(e.action), actor: e.actor_email || null,
    person: e.actor_email ? names.person(e.actor_email) : 'The system',
    sentence: sentence(e, { me, ...names }),
    ...(security ? { security } : {}),
  };
}

/**
 * The Activity log, newest first, 50 at a time ("Load more" = beforeId). Search looks at the sentences (up to 2,000
 * entries back per page). Business Admin only; this business only.
 * @param {import('./types.cjs').Staff} staff @param {Row} [q]
 */
async function listActivity(staff, q = {}) {
  const no = ownerOnly(staff); if (no) return no;
  const biz = requireBusinessId(staff.businessId);
  const parts = queryParts(biz, q);
  const search = String(q.q || '').trim().toLowerCase().slice(0, 60);
  let before = Number(q.beforeId) > 0 ? Math.floor(Number(q.beforeId)) : 0;
  /** @type {ReturnType<typeof present>[]} */
  const out = [];
  let scanned = 0;
  let more = true;
  while (out.length < PAGE && more && scanned < 2000) {
    const batch = search ? 200 : PAGE;
    const r = await dbRequest(`audit_log?${[...parts, ...(before ? [`id=lt.${before}`] : []), 'select=id,created_at,actor_email,actor_role,action,details,subject_phone,private_details', 'order=id.desc', `limit=${batch}`].join('&')}`);
    if (!r.ok) return { error: 'Could not load the activity log. Has SQL 20261144 been run?', status: 500 };
    const rows = Array.isArray(r.data) ? r.data : [];
    scanned += rows.length;
    more = rows.length === batch;
    if (rows.length) before = rows[rows.length - 1].id;
    const names = await namesFor(biz, rows);
    for (const e of rows) {
      const shown = present(e, names, String(staff.email).toLowerCase());
      if (search && !`${shown.sentence} ${shown.person}`.toLowerCase().includes(search)) continue;
      out.push(shown);
      if (out.length >= PAGE) { more = true; before = e.id; break; }
    }
  }
  return { entries: out, nextBeforeId: more && out.length ? before : null, areas: AREA_LABEL };
}

/** The newest entries a CSV may hold: it is read in pages of 1,000 and must finish well inside Netlify's 10 seconds. */
const EXPORT_MAX = 5000;

/**
 * CSV of the filtered log: the newest EXPORT_MAX entries at most (`capped` says when there were more). Read in pages of
 * 1,000; staff and customer names looked up once for the whole file. Audited (count and filters, never the data).
 * @param {import('./types.cjs').Staff} staff @param {Row} [q]
 */
async function exportActivity(staff, q = {}) {
  const no = ownerOnly(staff); if (no) return no;
  const biz = requireBusinessId(staff.businessId);
  const parts = queryParts(biz, q);
  const search = String(q.q || '').trim().toLowerCase().slice(0, 60);
  /** @type {Row[]} */
  const raw = [];
  let before = 0;
  let capped = false;
  for (let page = 0; page < 20; page++) {
    const r = await dbRequest(`audit_log?${[...parts, ...(before ? [`id=lt.${before}`] : []), 'select=id,created_at,actor_email,actor_role,action,details,subject_phone,private_details', 'order=id.desc', 'limit=1000'].join('&')}`);
    if (!r.ok) return { error: 'Could not read the activity log.', status: 500 };
    const rows = Array.isArray(r.data) ? r.data : [];
    raw.push(...rows);
    if (rows.length < 1000) break;
    before = rows[rows.length - 1].id;
    if (!search && raw.length >= EXPORT_MAX) { capped = true; break; }
  }
  const names = await namesFor(biz, raw);
  const me = String(staff.email).toLowerCase();
  let shown = raw.map(e => present(e, names, me));
  if (search) shown = shown.filter(x => `${x.sentence} ${x.person}`.toLowerCase().includes(search));
  if (shown.length > EXPORT_MAX) { shown = shown.slice(0, EXPORT_MAX); capped = true; }
  const { toCsv } = require('./leadsTools.cjs');
  const csv = toCsv(['Time (India)', 'Person', 'Area', 'What happened', 'Device', 'Network'], shown.map(x => [
    new Date(x.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }), x.person, AREA_LABEL[/** @type {keyof typeof AREA_LABEL} */ (x.area)] || x.area, x.sentence,
    x.security?.device || '', x.security?.network || '',
  ]));
  await byStaff(staff, 'activity.exported', { count: shown.length, capped, filters: { area: q.area || null, person: q.person ? 'one person' : null, from: q.from || null, to: q.to || null, search: q.q ? 'yes' : null, tab: q.tab || null } });
  return { csv, count: shown.length, capped };
}

/** Logs are kept this long (docs/progress/activity-log.md: the user's choice). */
const KEEP_DAYS = 365;
/** Worker (hourly): delete entries older than KEEP_DAYS, every business and the platform's own. Returns how many. @param {{ now?: number }} [o] */
async function prune({ now = Date.now() } = {}) {
  const cutoff = new Date(now - KEEP_DAYS * 86400000).toISOString();
  const r = await dbRequest(`audit_log?created_at=lt.${encodeURIComponent(cutoff)}`, { method: 'DELETE', prefer: 'return=representation' });
  return r.ok && Array.isArray(r.data) ? r.data.length : 0;
}

module.exports = {
  FORBIDDEN_KEYS, AREAS, AREA_LABEL, PAGE,
  forbiddenKeysIn, scrub, record, byStaff, maskIp, deviceOf, sessionKey, whoIs, signedIn, selfEvent, lastSignedIn,
  areaOf, phrase, sentence, listActivity, exportActivity, prune, KEEP_DAYS, EXPORT_MAX, _reset, _missingSince,
};
