// @ts-check
// Staff profiles and per-person activity: the "My profile" page (everyone) and the Team page's
// performance tab, ranking and member detail (Business Admin and managers).
//
// Activity comes from what the platform already records, per person (by email):
//   replies sent ......... whatsapp_messages (outbound, sent_by)
//   chats handled ........ distinct customers they replied to
//   response time ........ median minutes from a customer's message to their reply (analytics.staffResponseTimes)
//   conversions .......... chats assigned to them that reached Booked / Completed / Returning in the period
//   open chats ........... chats assigned to them now, not Completed or Lost
//   queries resolved ..... queries assigned to them, resolved in the period (+ average customer rating)
//   notes ................ notes they wrote;  calls ......... WhatsApp calls they answered (+ talk time)
// Points (for the ranking) = chats x2 + conversions x10 + queries resolved x5 + calls x3 + notes x1.
// Counts only: no message text or customer details are returned.
const { dbRequest } = require('./db.cjs');
const { requireBusinessId } = require('./tenant.cjs');
const { istDay, dayRange, median, staffResponseTimes } = require('./analytics.cjs');
const limits = require('./limits.cjs');

/** @typedef {import('./types.cjs').Staff} Staff */
/** @typedef {Record<string, any>} Row */

const CONVERTED = ['ordered', 'completed', 'repeat'];
const CLOSED_CHAT = ['completed', 'lost'];
const POINTS = { chats: 2, conversions: 10, queriesResolved: 5, calls: 3, notes: 1 };
/** @param {unknown} e */
const low = (e) => String(e || '').trim().toLowerCase();

// ---------------------------------------------------------------------------
// Profiles (personal and onboarding details)
// ---------------------------------------------------------------------------
// Fields: the API name, the column, the longest allowed, and
//   admin: set by the Business Admin / managers only (not on "My profile");
//   priv:  private: shown only to the person, the Business Admin, and managers for agents (chapter "who sees").
// Phone and job title / name / languages stay visible to managers for everyone, as before.
/** @type {Array<{ key: string, col: string, max: number, label: string, admin?: boolean, priv?: boolean, kind?: 'phone' | 'date' }>} */
const FIELDS = [
  { key: 'fullName', col: 'full_name', max: 80, label: 'Full name' },
  { key: 'jobTitle', col: 'job_title', max: 60, label: 'Job title' },
  { key: 'languages', col: 'languages', max: 120, label: 'Languages' },
  { key: 'phone', col: 'phone', max: 20, label: 'Phone', kind: 'phone' },
  { key: 'employeeCode', col: 'employee_code', max: 30, label: 'Employee ID', admin: true, priv: true },
  { key: 'joinedOn', col: 'joined_on', max: 10, label: 'Joining date', admin: true, priv: true, kind: 'date' },
  { key: 'workLocation', col: 'work_location', max: 80, label: 'Branch / location', admin: true, priv: true },
  { key: 'address', col: 'address', max: 200, label: 'Address', priv: true },
  { key: 'emergencyContactName', col: 'emergency_contact_name', max: 80, label: 'Emergency contact name', priv: true },
  { key: 'emergencyContactPhone', col: 'emergency_contact_phone', max: 20, label: 'Emergency contact phone', priv: true, kind: 'phone' },
];
const COLS = ['user_id', ...FIELDS.map(f => f.col), 'updated_at', 'updated_by'].join(',');

/**
 * Pure: check and clean profile input (tested). Fields not sent are left out (kept as they are); '' or null clears.
 * @param {Record<string, unknown>} input @param {{ admin: boolean }} opt  admin: may set the admin-only fields
 * @returns {{ error: string } | { values: Record<string, string | null> }}
 */
function cleanProfile(input, { admin }) {
  /** @type {Record<string, string | null>} */
  const values = {};
  for (const f of FIELDS) {
    const v = input?.[f.key];
    if (v === undefined) continue;
    if (f.admin && !admin) continue; // set by the Business Admin / managers only; ignored from "My profile"
    if (v !== null && typeof v !== 'string') return { error: `${f.label} must be text.` };
    const s = f.key === 'address' ? String(v || '').trim().replace(/[ \t]+/g, ' ') : String(v || '').trim().replace(/\s+/g, ' ');
    if (!s) { values[f.col] = null; continue; }
    if (s.length > f.max) return { error: `${f.label} is longer than ${f.max} characters.` };
    if (/[<>]/.test(s)) return { error: `${f.label}: < and > are not allowed.` };
    if (f.kind === 'phone' && !/^\+?[\d\s-]{7,20}$/.test(s)) return { error: `${f.label}: digits only (a + at the start is fine).` };
    if (f.kind === 'date') {
      const t = Date.parse(`${s}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(t)) return { error: `${f.label}: choose a date.` };
      if (t > Date.now() + 366 * 86400000 || t < Date.parse('1970-01-01')) return { error: `${f.label}: that date doesn't look right.` };
    }
    values[f.col] = s;
  }
  return { values };
}

/** @param {string} biz @returns {Promise<Record<string, Row>>} user_id -> profile */
async function profilesFor(biz) {
  let r = await dbRequest(`staff_profiles?business_id=eq.${biz}&select=${COLS}`);
  // Before SQL 20261130 the onboarding columns don't exist: read the original ones.
  if (!r.ok) r = await dbRequest(`staff_profiles?business_id=eq.${biz}&select=user_id,full_name,phone,job_title,languages,updated_at`);
  return r.ok && Array.isArray(r.data) ? Object.fromEntries(r.data.map((/** @type {Row} */ p) => [p.user_id, p])) : {};
}

/**
 * What a viewer may see of someone's profile.
 *   'basic': name, job title, languages (everyone in the team list);
 *   'phone': + phone (managers and the Business Admin, for anyone);
 *   'full':  + private fields (the person, the Business Admin, managers for agents).
 * @param {Row | undefined} p @param {'basic' | 'phone' | 'full'} level
 */
function profileView(p, level) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const f of FIELDS) {
    if (f.key === 'phone' && level === 'basic') continue;
    if (f.priv && level !== 'full') continue;
    out[f.key] = p?.[f.col] ? String(p[f.col]).slice(0, f.max) : '';
  }
  return out;
}

/** May `me` see someone's private details? @param {Staff} me @param {string} targetRole @param {boolean} self */
const canSeeFull = (me, targetRole, self) => self || me.role === 'owner' || (me.role === 'manager' && targetRole === 'agent');
/** May `me` edit someone else's details (onboarding)? The same people who set their passwords. @param {Staff} me @param {string} targetRole */
const canEditProfile = (me, targetRole) => (me.role === 'owner' && (targetRole === 'agent' || targetRole === 'manager')) || (me.role === 'manager' && targetRole === 'agent');

/** @param {string} biz @param {string} userId @param {Record<string, string | null>} values @param {string} by */
async function upsertProfile(biz, userId, values, by) {
  return dbRequest('staff_profiles?on_conflict=user_id', {
    method: 'POST', prefer: 'resolution=merge-duplicates,return=representation',
    body: { user_id: userId, business_id: biz, ...values, updated_at: new Date().toISOString(), ...(by ? { updated_by: by } : {}) },
  });
}
/** @param {{ ok: boolean, status?: number, data?: any }} r */
const saveError = (r) => (r.status === 409 || /duplicate|unique/i.test(JSON.stringify(r.data || ''))
  ? 'That employee ID is already used by someone else in your team.'
  : 'Could not save. Has the staff onboarding SQL (20261130) been run?');

/**
 * Save my own personal details ("My profile"). Employee ID, joining date and branch are set by the Business Admin
 * or a manager, not here, except the Business Admin's own (nobody above them sets them).
 * @param {Staff} staff @param {Record<string, unknown>} input
 */
async function saveMyProfile(staff, input = {}) {
  const biz = requireBusinessId(staff?.businessId);
  const checked = cleanProfile(input, { admin: staff?.role === 'owner' });
  if ('error' in checked) return { error: checked.error };
  // Only the fields sent are written, so the original four still save before SQL 20261130.
  const r = await upsertProfile(biz, staff.id, checked.values, '');
  if (!r.ok) return { error: saveError(r) };
  return { profile: profileView(r.data?.[0], 'full') };
}

/**
 * Business Admin / manager: fill in or change a team member's details (onboarding). The Business Admin edits
 * managers and agents; managers edit agents. Never another Business Admin, never another business. Audited (which
 * fields changed, never the values).
 * @param {Staff} me @param {string} userId @param {Record<string, unknown>} input
 */
async function saveMemberProfile(me, userId, input = {}) {
  const biz = requireBusinessId(me?.businessId);
  const t = await dbRequest(`staff_members?select=user_id,email,role&user_id=eq.${userId}&business_id=eq.${biz}`);
  const target = t.ok ? t.data?.[0] : null;
  if (!target) return { error: 'This person is not in your team.', status: 404 };
  if (target.user_id === me.id) return { error: 'Change your own details on My profile.' };
  if (!canEditProfile(me, target.role)) return { error: me.role === 'manager' ? 'Managers can edit agents\' details only.' : 'Only a Business Admin can change their own details.', status: 403 };
  const checked = cleanProfile(input, { admin: true });
  if ('error' in checked) return { error: checked.error };
  if (!Object.keys(checked.values).length) return { error: 'Nothing to save.' };
  const r = await upsertProfile(biz, userId, checked.values, me.email);
  if (!r.ok) return { error: saveError(r) };
  await dbRequest('audit_log', {
    method: 'POST', prefer: 'return=minimal',
    body: { business_id: biz, actor_email: me.email, actor_role: me.role, action: 'team.profile_updated', details: { member: target.email, fields: FIELDS.filter(f => f.col in checked.values).map(f => f.key) } },
  });
  return { profile: profileView(r.data?.[0], 'full') };
}

// ---------------------------------------------------------------------------
// Activity (pure, tested)
// ---------------------------------------------------------------------------

/**
 * Per-person activity for the period [from, now].
 * @param {{ staff: Row[], messages: Row[], leads: Row[], queries: Row[], notes: Row[], calls: Row[], from: string, to?: string }} data
 */
function computeStats({ staff, messages, leads, queries, notes, calls, from, to = new Date().toISOString() }) {
  const days = dayRange(from, to);
  const inPeriod = (/** @type {unknown} */ ts) => !!ts && String(ts) >= from;
  const response = staffResponseTimes(messages);
  /** @type {Record<string, number | null>} */
  const responseBy = Object.fromEntries((response.staff || []).map((/** @type {Row} */ s) => [low(s.email), s.medianMin]));

  const rows = staff.map((m) => {
    const email = low(m.email);
    const mine = (/** @type {unknown} */ v) => low(v) === email;
    const replies = messages.filter(x => x.direction === 'outbound' && mine(x.sent_by) && inPeriod(x.timestamp));
    const myNotes = notes.filter(n => mine(n.author) && inPeriod(n.created_at));
    const myCalls = calls.filter(c => mine(c.answered_by) && c.status === 'ended' && inPeriod(c.created_at));
    const myLeads = leads.filter(l => mine(l.assigned_to));
    const myQueries = queries.filter(q => mine(q.assigned_to));
    const resolved = myQueries.filter(q => inPeriod(q.resolved_at));
    const ratings = resolved.map(q => Number(q.rating)).filter(n => n >= 1 && n <= 5);

    /** @type {Record<string, number>} */
    const perDay = Object.fromEntries(days.map(d => [d, 0]));
    for (const r of replies) { const d = istDay(r.timestamp); if (d in perDay) perDay[d] += 1; }
    const actionTimes = [...replies.map(r => r.timestamp), ...myNotes.map(n => n.created_at), ...myCalls.map(c => c.created_at)].filter(Boolean).sort();
    const activeDays = new Set(actionTimes.map(t => istDay(t))).size;

    const s = {
      repliesSent: replies.length,
      chatsHandled: new Set(replies.map(r => r.contact_phone).filter(Boolean)).size,
      medianResponseMin: responseBy[email] ?? null,
      conversions: myLeads.filter(l => CONVERTED.includes(l.stage) && inPeriod(l.stage_changed_at)).length,
      openChats: myLeads.filter(l => !CLOSED_CHAT.includes(l.stage)).length,
      queriesResolved: resolved.length,
      openQueries: myQueries.filter(q => !['resolved', 'closed'].includes(q.stage)).length,
      avgRating: ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null,
      notes: myNotes.length,
      calls: myCalls.length,
      talkMin: Math.round(myCalls.reduce((n, c) => n + (Number(c.duration_sec) || 0), 0) / 60),
      activeDays,
      lastActive: actionTimes.length ? actionTimes[actionTimes.length - 1] : null,
    };
    const points = s.chatsHandled * POINTS.chats + s.conversions * POINTS.conversions + s.queriesResolved * POINTS.queriesResolved + s.calls * POINTS.calls + s.notes * POINTS.notes;
    return { userId: m.user_id, email: m.email, role: m.role, joinedAt: m.created_at || null, ...s, points, daily: days.map(d => ({ day: d, replies: perDay[d] })) };
  });

  // Ranking: points, then chats handled, then replies; equal values share a rank.
  const ordered = [...rows].sort((a, b) => b.points - a.points || b.chatsHandled - a.chatsHandled || b.repliesSent - a.repliesSent || a.email.localeCompare(b.email));
  /** @type {Record<string, number>} */
  const rank = {};
  ordered.forEach((r, i) => {
    const prev = ordered[i - 1];
    rank[r.email] = prev && prev.points === r.points && prev.chatsHandled === r.chatsHandled && prev.repliesSent === r.repliesSent ? rank[prev.email] : i + 1;
  });
  const members = ordered.map(r => ({ ...r, rank: rank[r.email] }));
  const sum = (/** @type {keyof typeof members[number]} */ k) => members.reduce((n, r) => n + (Number(r[k]) || 0), 0);
  return {
    from, days: days.length,
    members,
    team: {
      repliesSent: sum('repliesSent'), chatsHandled: sum('chatsHandled'), conversions: sum('conversions'),
      queriesResolved: sum('queriesResolved'), calls: sum('calls'), notes: sum('notes'),
      medianResponseMin: response.overallMedianMin ?? median([]),
    },
    points: POINTS,
  };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/** @param {string} path @returns {Promise<Row[]>} */
async function readAll(path) {
  /** @type {Row[]} */
  const out = [];
  for (let offset = 0; offset < 50000; offset += 1000) {
    const r = await dbRequest(`${path}&limit=1000&offset=${offset}`);
    if (!r.ok) throw new Error('Could not read team activity.');
    out.push(...(r.data || []));
    if ((r.data || []).length < 1000) break;
  }
  return out;
}

/** The business's activity for the last `days` days (clamped to the plan's analytics history). @param {string} biz @param {unknown} days */
async function loadStats(biz, days) {
  requireBusinessId(biz);
  const span = await limits.clampAnalyticsDays(biz, days);
  const startDay = istDay(new Date(Date.now() - (span - 1) * 86400000).toISOString());
  const from = new Date(Date.parse(`${startDay}T00:00:00Z`) - 330 * 60000).toISOString();
  // A day earlier for messages, so a reply on the first day can be timed against the customer's message.
  const msgFrom = encodeURIComponent(new Date(Date.parse(from) - 86400000).toISOString());
  const f = encodeURIComponent(from);
  const [staffRes, messages, leads, queries, notes, calls] = await Promise.all([
    dbRequest(`staff_members?select=user_id,email,role,created_at&business_id=eq.${biz}&order=created_at.asc`),
    readAll(`whatsapp_messages?select=direction,sent_by,contact_phone,timestamp&business_id=eq.${biz}&timestamp=gte.${msgFrom}&order=timestamp.asc`),
    readAll(`whatsapp_leads?select=assigned_to,stage,stage_changed_at&business_id=eq.${biz}&assigned_to=not.is.null`),
    readAll(`queries?select=assigned_to,stage,resolved_at,rating&business_id=eq.${biz}&assigned_to=not.is.null`),
    readAll(`lead_notes?select=author,created_at&business_id=eq.${biz}&created_at=gte.${f}`),
    readAll(`whatsapp_calls?select=answered_by,status,duration_sec,created_at&business_id=eq.${biz}&created_at=gte.${f}`).catch(() => []),
  ]);
  if (!staffRes.ok) throw new Error('Could not load the team.');
  // Conversions and open chats by status TYPE (each business names its own statuses).
  const ls = require('./leadStatuses.cjs');
  const typed = ls.byType(await ls.listFor(biz), leads);
  return computeStats({ staff: staffRes.data || [], messages, leads: typed, queries, notes, calls, from });
}

/** Business Admin / managers: everyone's activity and the ranking. @param {Staff} staff @param {unknown} days */
async function teamPerformance(staff, days) {
  const biz = requireBusinessId(staff?.businessId);
  const [stats, profiles] = await Promise.all([loadStats(biz, days), profilesFor(biz)]);
  return {
    ...stats,
    members: stats.members.map(m => ({ ...m, ...profileView(profiles[m.userId], 'basic') })),
  };
}

/**
 * Business Admin / managers: one member's details and activity. Private details (address, emergency contact,
 * employee details) only for those who manage that person; `canEdit` says whether this viewer may change them.
 * @param {Staff} staff @param {string} userId @param {unknown} days
 */
async function memberDetail(staff, userId, days) {
  const biz = requireBusinessId(staff?.businessId);
  const [stats, profiles] = await Promise.all([loadStats(biz, days), profilesFor(biz)]);
  const m = stats.members.find(x => x.userId === userId);
  if (!m) return { error: 'This person is not in your team.', status: 404 };
  const self = userId === staff.id;
  const p = profiles[userId];
  return {
    from: stats.from, days: stats.days, teamSize: stats.members.length, team: stats.team, points: stats.points,
    member: { ...m, ...profileView(p, canSeeFull(staff, m.role, self) ? 'full' : 'phone') },
    canEdit: !self && canEditProfile(staff, m.role),
    updatedBy: canSeeFull(staff, m.role, self) ? p?.updated_by || null : null,
  };
}

/** Everyone: my own details, activity and my place in the team (others' numbers are not shown). @param {Staff} staff @param {unknown} days */
async function myProfile(staff, days) {
  const biz = requireBusinessId(staff?.businessId);
  const [stats, profiles] = await Promise.all([loadStats(biz, days), profilesFor(biz)]);
  const me = stats.members.find(x => x.userId === staff.id || low(x.email) === low(staff.email));
  return {
    from: stats.from, days: stats.days, teamSize: stats.members.length, points: stats.points,
    profile: { email: staff.email, role: staff.role, businessName: staff.businessName, ...profileView(profiles[staff.id], 'full') },
    stats: me || null,
  };
}

module.exports = {
  computeStats, saveMyProfile, saveMemberProfile, profilesFor, teamPerformance, memberDetail, myProfile, POINTS,
  // Onboarding details (also used by team.addWithPassword).
  FIELDS, cleanProfile, profileView, canSeeFull, canEditProfile, upsertProfile, saveError,
};
