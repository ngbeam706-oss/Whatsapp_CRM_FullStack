// @ts-check
// Queries: customer queries, team (internal) queries and Platform support queries.
//
//   kind 'customer'  raised by the bot, the AI (handover) or staff from a chat; handled by the team.
//   kind 'internal'  raised by a staff member, addressed to 'managers' or 'owner' (the Business Admin).
//   platform_queries raised by any staff member to Platform support; handled by the Platform Admin.
//
// The database lets browsers only READ (see 20261111_q1_queries.sql); every change goes through here.
// Stages: new -> assigned -> in_progress -> waiting -> escalated -> resolved -> closed (+ reopened).
const { dbRequest, digits } = require('./db.cjs');
const { requireBusinessId, isManagerOrOwner } = require('./tenant.cjs');

/**
 * @typedef {import('./types.cjs').Staff} Staff
 * @typedef {Record<string, any>} QueryRow  a row of queries or platform_queries
 * @typedef {Record<string, any>} Input  request body fields (each function checks what it uses)
 * @typedef {{ email: string, role: string }} Who
 * @typedef {'handler' | 'requester' | 'viewer' | 'none'} QueryAccess
 */

/** A save that came back empty (database error): say so instead of crashing. */
const SAVE_FAILED = { error: 'Could not save the query. Try again.', status: 500 };

const STAGES =['new', 'assigned', 'in_progress', 'waiting', 'escalated', 'resolved', 'closed', 'reopened'];
const OPEN_STAGES = ['new', 'assigned', 'in_progress', 'waiting', 'escalated', 'reopened'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
/** @type {Record<string, number>} */
const DEFAULT_DUE_HOURS = { urgent: 2, high: 8, normal: 24, low: 72 };
const AUTO_CLOSE_DAYS = 3;   // resolved -> closed when nobody objects
const REOPEN_DAYS = 7;       // a customer/requester may reopen this long after "resolved"
const PLATFORM_CATEGORIES = ['App problem / bug', 'WhatsApp connection', 'Plan / billing', 'Feature request', 'How do I…?', 'Other'];

/** Which manual stage moves are allowed (automatic moves are handled separately). @type {Record<string, string[]>} */
const MOVES = {
  new: ['assigned', 'in_progress', 'waiting', 'escalated', 'resolved', 'closed'],
  assigned: ['in_progress', 'waiting', 'escalated', 'resolved', 'closed'],
  in_progress: ['waiting', 'escalated', 'resolved', 'closed'],
  waiting: ['in_progress', 'escalated', 'resolved', 'closed'],
  escalated: ['assigned', 'in_progress', 'waiting', 'resolved', 'closed'],
  resolved: ['closed', 'reopened'],
  closed: ['reopened'],
  reopened: ['assigned', 'in_progress', 'waiting', 'escalated', 'resolved', 'closed'],
};
/** @param {string} from @param {string} to */
const canMove = (from, to) => (MOVES[from] || []).includes(to);

/** @type {Record<string, string>} */
const STAGE_LABELS = {
  new: 'New', assigned: 'Assigned', in_progress: 'In progress', waiting: 'Waiting', escalated: 'Escalated',
  resolved: 'Resolved', closed: 'Closed', reopened: 'Reopened',
};
/** @param {string} s */
const label = (s) => STAGE_LABELS[s] || s;
/** "Q-12" (business query) or "S-12" (Platform support). @param {number} n @param {boolean} [platform] */
const fmtNumber = (n, platform = false) => `${platform ? 'S' : 'Q'}-${n}`;
/** @param {{ email?: string } | null | undefined} staff */
const emailOf = (staff) => String(staff?.email || '').toLowerCase();
/** @param {unknown} id */
const isUuid = (id) => /^[0-9a-f-]{36}$/i.test(String(id || ''));
/** One line, at most `max` characters. @param {unknown} s @param {number} max */
const clean = (s, max) => String(s || '').trim().replace(/\s+/g, ' ').slice(0, max);
/** Trimmed text (keeps line breaks), at most `max` characters. @param {unknown} s @param {number} max */
const cleanText = (s, max) => String(s || '').trim().slice(0, max);
const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Pure rules (unit-tested)
// ---------------------------------------------------------------------------

/**
 * Due time for a priority, counted from `from`, using the business's hours (or the defaults).
 * @param {string} priority @param {Date | string | number} [from] @param {Record<string, number>} [hours]
 */
function dueAt(priority, from = new Date(), hours = DEFAULT_DUE_HOURS) {
  const h = Number((hours || {})[priority] ?? DEFAULT_DUE_HOURS[priority] ?? 24);
  return new Date(new Date(from).getTime() + h * 3600000).toISOString();
}

/** Is an open query past its due time? (A waiting query's clock is stopped.) @param {QueryRow | null | undefined} q @param {number} [now] */
function isOverdue(q, now = Date.now()) {
  if (!q?.due_at || !OPEN_STAGES.includes(q.stage) || q.stage === 'waiting') return false;
  return Date.parse(q.due_at) < now;
}

/**
 * What a staff member may do with a business query:
 *   'handler'   may work on it (subject to the agent ownership rule below)
 *   'requester' raised it (team query): may comment, answer, confirm, reopen, rate
 *   'none'      can't see it
 * Mirrors public.query_access() in the database.
 * @param {QueryRow | null | undefined} q
 * @param {Staff | null | undefined} staff
 * @returns {QueryAccess}
 */
function accessFor(q, staff) {
  if (!q || !staff || q.business_id !== staff.businessId) return 'none';
  if (staff.role === 'owner') return 'handler';
  if (q.kind === 'customer') {
    // Escalated customer queries are for managers (level 1) or the Business Admin (level 2).
    if ((q.escalation_level || 0) >= 2) return 'viewer';
    if ((q.escalation_level || 0) === 1 && staff.role === 'agent') return 'viewer';
    return 'handler';
  }
  if (q.addressed_to === 'managers' && staff.role === 'manager') return 'handler';
  if (String(q.raised_by_email || '').toLowerCase() === emailOf(staff)) return 'requester';
  return 'none';
}

/**
 * An agent works on a customer query only if it is theirs or nobody's (same rule as chats).
 * @param {QueryRow | null} q @param {Staff} staff @returns {string | null} null = allowed
 */
function workDenied(q, staff) {
  if (!q) return 'Query not found.';
  const access = accessFor(q, staff);
  if (access !== 'handler') return access === 'none' ? 'Query not found.' : 'You can view this query, but not work on it.';
  if (q.kind === 'customer' && staff.role === 'agent' && q.assigned_to && q.assigned_to.toLowerCase() !== emailOf(staff)) {
    return `This query belongs to ${q.assigned_to}. Ask them, a manager or the Business Admin to transfer it.`;
  }
  return null;
}

/**
 * The fields to change when a query moves to `to` (timestamps, the waiting clock). Pure.
 * @param {QueryRow} q @param {string} to @param {Date} [now] @returns {Record<string, any>}
 */
function stagePatch(q, to, now = new Date()) {
  const t = now.toISOString();
  /** @type {Record<string, any>} */
  const patch = { stage: to, updated_at: t };
  // Leaving "waiting": the clock starts again, and the due time moves on by the time we waited.
  if (q.stage === 'waiting' && to !== 'waiting' && q.paused_at) {
    const waited = now.getTime() - Date.parse(q.paused_at);
    if (q.due_at && waited > 0) patch.due_at = new Date(Date.parse(q.due_at) + waited).toISOString();
    patch.paused_at = null;
  }
  if (to === 'waiting') patch.paused_at = t;
  if (to === 'resolved') patch.resolved_at = t;
  if (to === 'closed') patch.closed_at = t;
  if (to === 'reopened') { patch.resolved_at = null; patch.closed_at = null; }
  if (!q.first_response_at && to !== 'new') patch.first_response_at = t;
  return patch;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
const QUERY_FIELDS = 'id,business_id,number,kind,source,contact_phone,raised_by_email,raised_by_role,addressed_to,category,subject,description,priority,stage,assigned_to,escalation_level,due_at,paused_at,first_response_at,resolved_at,closed_at,rating,rating_comment,created_at,updated_at';

/** @param {string} biz @param {unknown} id @returns {Promise<QueryRow | null>} */
async function getQuery(biz, id) {
  requireBusinessId(biz);
  if (!isUuid(id)) return null;
  const r = await dbRequest(`queries?id=eq.${id}&business_id=eq.${biz}&select=${QUERY_FIELDS}`);
  return r.ok ? r.data?.[0] || null : null;
}

/** @param {string} biz @returns {Promise<Record<string, number>>} */
async function dueHoursFor(biz) {
  const r = await dbRequest(`businesses?id=eq.${biz}&select=query_due_hours`);
  return (r.ok && r.data?.[0]?.query_due_hours) || DEFAULT_DUE_HOURS;
}

/** Add the reference ("Q-12"), overdue flag and stage label. @param {QueryRow} q @returns {QueryRow} */
const decorate = (q) => ({ ...q, ref: fmtNumber(q.number), overdue: isOverdue(q), stageLabel: label(q.stage) });

/**
 * Search "Q-1042": the query with this number in the caller's business, if they may see it.
 * @param {Staff} staff @param {unknown} number
 * @returns {Promise<{ query: { id: string, ref: string, subject: string, kind: string } } | { error: string, status: number }>}
 */
async function findByNumber(staff, number) {
  const biz = requireBusinessId(staff?.businessId);
  const n = Number(String(number || '').replace(/^q-?/i, ''));
  if (!Number.isInteger(n) || n < 1 || n > 1e9) return { error: 'Not a query number.', status: 400 };
  const r = await dbRequest(`queries?business_id=eq.${biz}&number=eq.${n}&select=${QUERY_FIELDS}`);
  const q = r.ok ? r.data?.[0] || null : null;
  if (!q || accessFor(q, staff) === 'none') return { error: 'Query not found.', status: 404 };
  return { query: { id: q.id, ref: fmtNumber(q.number), subject: q.subject, kind: q.kind } };
}

/**
 * Queries a staff member may see. view: 'customer' | 'team' (both raised-by-me and for-me).
 * filters: stage, priority, category, mine (assigned to me), overdue, phone.
 * @param {Staff} staff
 * @param {{ view?: string, stage?: string, priority?: string, category?: string, mine?: boolean, overdue?: boolean, phone?: string }} [filters]
 */
async function listQueries(staff, { view = 'customer', stage = '', priority = '', category = '', mine = false, overdue = false, phone = '' } = {}) {
  const biz = requireBusinessId(staff?.businessId);
  const parts = [`business_id=eq.${biz}`, `select=${QUERY_FIELDS}`, 'order=created_at.desc', 'limit=500'];
  if (view === 'team') {
    parts.push('kind=eq.internal');
    const me = encodeURIComponent(emailOf(staff));
    if (staff.role === 'manager') parts.push(`or=(addressed_to.eq.managers,raised_by_email.ilike.${me})`);
    else if (staff.role !== 'owner') parts.push(`raised_by_email=ilike.${me}`);
  } else {
    parts.push('kind=eq.customer');
  }
  if (STAGES.includes(stage)) parts.push(`stage=eq.${stage}`);
  if (stage === 'open') parts.push(`stage=in.(${OPEN_STAGES.join(',')})`);
  if (PRIORITIES.includes(priority)) parts.push(`priority=eq.${priority}`);
  if (category) parts.push(`category=eq.${encodeURIComponent(clean(category, 40))}`);
  if (mine) parts.push(`assigned_to=ilike.${encodeURIComponent(emailOf(staff))}`);
  const p = digits(phone);
  if (p) parts.push(`contact_phone=eq.${p}`);
  const r = await dbRequest(`queries?${parts.join('&')}`);
  if (!r.ok) return { error: 'Could not load queries. Has the Q1 SQL been run?' };
  let rows = r.data.filter((/** @type {QueryRow} */ q) => accessFor(q, staff) !== 'none').map(decorate);
  if (overdue) rows = rows.filter((/** @type {QueryRow} */ q) => q.overdue);
  return { queries: rows };
}

/** One query with its history (handler-only notes are left out for the person who raised it). @param {Staff} staff @param {unknown} id */
async function getQueryDetail(staff, id) {
  const biz = requireBusinessId(staff?.businessId);
  const q = await getQuery(biz, id);
  const access = accessFor(q, staff);
  if (!q || access === 'none') return { error: 'Query not found.', status: 404 };
  const ev = await dbRequest(`query_events?query_id=eq.${q.id}&business_id=eq.${biz}&select=id,author_email,author_role,type,visibility,body,data,created_at&order=created_at.asc`);
  const events = (ev.ok ? ev.data : []).filter((/** @type {{ visibility: string }} */ e) => access !== 'requester' || e.visibility === 'all');
  return { query: decorate(q), events, access, canWork: !workDenied(q, staff) };
}

/** Active category names for customer or team queries. @param {string} biz @param {string} kind @returns {Promise<string[]>} */
async function categories(biz, kind) {
  const r = await dbRequest(`query_categories?business_id=eq.${requireBusinessId(biz)}&kind=eq.${kind === 'internal' ? 'internal' : 'customer'}&is_active=is.true&select=name&order=sort_order.asc`);
  return r.ok ? r.data.map((/** @type {{ name: string }} */ c) => c.name) : [];
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Every category, switched off ones too (for the Business Admin's settings). @param {string} biz */
async function allCategories(biz) {
  const r = await dbRequest(`query_categories?business_id=eq.${requireBusinessId(biz)}&select=kind,name,is_active,sort_order&order=sort_order.asc`);
  return r.ok ? r.data : [];
}

/**
 * One line in a query's history.
 * @param {string} biz @param {string} queryId
 * @param {{ author_email?: string | null, author_role?: string, type: string, visibility?: string, body?: string | null, data?: Record<string, unknown> }} event
 */
async function addEvent(biz, queryId, { author_email = null, author_role = 'system', type, visibility = 'all', body = null, data = {} }) {
  await dbRequest('query_events', {
    method: 'POST', prefer: 'return=minimal',
    body: { business_id: biz, query_id: queryId, author_email, author_role, type, visibility, body, data },
  });
}

/**
 * Save changes; with onlyIfStage, only if nobody moved it meanwhile. null = not saved.
 * @param {string} biz @param {string} id @param {Record<string, any>} body
 * @param {{ onlyIfStage?: string }} [options]
 * @returns {Promise<QueryRow | null>}
 */
async function patchQuery(biz, id, body, { onlyIfStage } = {}) {
  const extra = onlyIfStage ? `&stage=eq.${onlyIfStage}` : '';
  const r = await dbRequest(`queries?id=eq.${id}&business_id=eq.${biz}${extra}`, { method: 'PATCH', prefer: 'return=representation', body: { ...body, updated_at: body.updated_at || nowIso() } });
  return r.ok ? r.data?.[0] || null : null;
}

/**
 * Create a query.
 *  Customer query: { kind: 'customer', contactPhone, subject, description?, category?, priority? }
 *    by staff (staff given), the bot (source 'bot') or the AI (source 'ai').
 *  Team query: { kind: 'internal', addressedTo: 'managers' | 'owner', subject, description?, category?, priority?, contactPhone? (linked chat) }
 * @param {string} biz
 * @param {Input} [input]
 * @param {{ staff?: Staff | null, source?: string }} [options]
 */
async function createQuery(biz, input = {}, { staff = null, source = 'staff' } = {}) {
  requireBusinessId(biz);
  const kind = input.kind === 'internal' ? 'internal' : 'customer';
  const subject = clean(input.subject, 120);
  if (!subject) return { error: 'Write a short subject.' };
  const priority = PRIORITIES.includes(input.priority) ? input.priority : 'normal';
  const phone = digits(input.contactPhone);
  /** @type {Record<string, any>} */
  const row = {
    business_id: biz, kind, source: kind === 'internal' ? 'staff' : (['bot', 'ai', 'staff'].includes(source) ? source : 'staff'),
    subject, description: cleanText(input.description, 4000) || null,
    category: clean(input.category, 40) || null, priority,
    raised_by_email: staff ? emailOf(staff) : null, raised_by_role: staff?.role || null,
  };
  if (kind === 'customer') {
    if (!/^\d{7,15}$/.test(phone)) return { error: 'A customer query needs the customer\'s number.' };
    const lead = await dbRequest(`whatsapp_leads?business_id=eq.${biz}&phone=eq.${phone}&select=phone`);
    if (!(lead.ok && lead.data?.length)) return { error: 'That customer is not in your contacts.' };
    row.contact_phone = phone;
    row.addressed_to = 'team';
  } else {
    if (!staff) return { error: 'Only staff can raise a team query.' };
    if (!['managers', 'owner'].includes(input.addressedTo)) return { error: 'Choose who the query is for: Managers or the Business Admin.' };
    if (input.addressedTo === 'managers' && staff.role === 'manager') return { error: 'Managers send team queries to the Business Admin.' };
    if (staff.role === 'owner') return { error: 'As Business Admin, raise questions about the app with Platform support.' };
    row.addressed_to = input.addressedTo;
    if (phone) row.contact_phone = phone; // linked chat
  }
  const num = await dbRequest('rpc/next_query_number', { method: 'POST', body: { p_business: biz } });
  if (!num.ok || !Number.isFinite(Number(num.data))) return { error: 'Could not number the query. Has the Q1 SQL been run?' };
  row.number = Number(num.data);
  row.due_at = dueAt(priority, new Date(), await dueHoursFor(biz));
  const ins = await dbRequest('queries', { method: 'POST', prefer: 'return=representation', body: row });
  if (!ins.ok || !ins.data?.[0]) return { error: 'Could not save the query.' };
  const q = ins.data[0];
  await addEvent(biz, q.id, {
    author_email: row.raised_by_email, author_role: staff?.role || (source === 'ai' ? 'system' : 'customer'),
    type: 'created', body: row.description, data: { source: row.source, addressedTo: row.addressed_to },
  });
  if (kind === 'customer' && input.notifyCustomer !== false) {
    await notifyCustomer(biz, q, `Your query *${fmtNumber(q.number)}* is registered: "${subject}". Our team will update you right here.`);
  }
  return { query: decorate(q) };
}

/**
 * Atomically take an unassigned customer query (two agents can't both get it).
 * @param {string} biz @param {QueryRow} q @param {Staff} staff @returns {Promise<QueryRow | null>}
 */
async function claimIfNeeded(biz, q, staff) {
  if (q.kind !== 'customer' || q.assigned_to || staff.role !== 'agent') return q;
  const r = await dbRequest(`queries?id=eq.${q.id}&business_id=eq.${biz}&assigned_to=is.null`, {
    method: 'PATCH', prefer: 'return=representation',
    body: { assigned_to: emailOf(staff), stage: q.stage === 'new' ? 'assigned' : q.stage, updated_at: nowIso() },
  });
  if (r.ok && r.data?.length) {
    await addEvent(biz, q.id, { author_email: emailOf(staff), author_role: staff.role, type: 'assigned', data: { to: emailOf(staff) } });
    return r.data[0];
  }
  return getQuery(biz, q.id);
}

/**
 * Staff change a query: { stage?, priority?, assignedTo?, category? } (one kind of change per call).
 * @param {Staff} staff @param {unknown} id @param {Input} [input]
 */
async function updateQuery(staff, id, input = {}) {
  const biz = requireBusinessId(staff?.businessId);
  /** @type {QueryRow | null} */
  let q = await getQuery(biz, id);
  const access = accessFor(q, staff);
  if (!q || access === 'none') return { error: 'Query not found.', status: 404 };
  const me = emailOf(staff);

  // The person who raised a team query may confirm, reopen or close it — nothing else.
  if (access === 'requester') {
    if (!('stage' in input) || !['closed', 'reopened'].includes(input.stage)) return { error: 'Only the person handling it can change this query.', status: 403 };
    return requesterStage(biz, q, input.stage, { email: me, role: staff.role });
  }

  if ('assignedTo' in input) {
    const to = input.assignedTo ? String(input.assignedTo).toLowerCase().trim() : null;
    if (staff.role === 'agent' && to !== me) return { error: 'Only a manager or the Business Admin can hand a query to someone else.', status: 403 };
    if (staff.role === 'agent' && q.assigned_to && q.assigned_to.toLowerCase() !== me) return { error: `This query belongs to ${q.assigned_to}.`, status: 403 };
    if (to) {
      const st = await dbRequest(`staff_members?business_id=eq.${biz}&email=ilike.${encodeURIComponent(to)}&select=email,role`);
      const member = st.ok ? st.data?.[0] : null;
      if (!member) return { error: 'That person is not on your team.' };
      if (q.kind === 'internal' && !isManagerOrOwner(member.role)) return { error: 'Team queries are handled by managers or the Business Admin.' };
    }
    /** @type {Record<string, any>} */
    const body = { assigned_to: to };
    if (to && q.stage === 'new') body.stage = 'assigned';
    if (to && !q.first_response_at) body.first_response_at = nowIso();
    const saved = await patchQuery(biz, q.id, body);
    if (!saved) return SAVE_FAILED;
    await addEvent(biz, saved.id, { author_email: me, author_role: staff.role, type: 'assigned', data: { to } });
    return { query: decorate(saved) };
  }

  const denied = workDenied(q, staff);
  if (denied) return { error: denied, status: 403 };
  q = await claimIfNeeded(biz, q, staff);
  if (!q) return { error: 'Query not found.', status: 404 };

  if ('priority' in input) {
    if (!PRIORITIES.includes(input.priority)) return { error: 'Unknown priority.' };
    const body = { priority: input.priority, due_at: dueAt(input.priority, q.created_at, await dueHoursFor(biz)) };
    if (q.stage === 'waiting' && q.paused_at) body.due_at = dueAt(input.priority, new Date(Date.parse(q.created_at) + (Date.now() - Date.parse(q.paused_at))), await dueHoursFor(biz));
    const saved = await patchQuery(biz, q.id, body);
    if (!saved) return SAVE_FAILED;
    await addEvent(biz, saved.id, { author_email: me, author_role: staff.role, type: 'priority', data: { to: input.priority } });
    return { query: decorate(saved) };
  }
  if ('category' in input) {
    const cat = clean(input.category, 40);
    const saved = await patchQuery(biz, q.id, { category: cat || null });
    if (!saved) return SAVE_FAILED;
    return { query: decorate(saved) };
  }
  if ('stage' in input) {
    const to = String(input.stage);
    if (!STAGES.includes(to)) return { error: 'Unknown stage.' };
    if (to === q.stage) return { query: decorate(q) };
    if (to === 'escalated') return escalate(staff, q.id);
    if (!canMove(q.stage, to)) return { error: `A query can't go from ${label(q.stage)} to ${label(to)}.` };
    const moved = await patchQuery(biz, q.id, stagePatch(q, to), { onlyIfStage: q.stage });
    if (!moved) return { error: 'Someone changed this query a moment ago. Refresh and try again.', status: 409 };
    await addEvent(biz, q.id, { author_email: me, author_role: staff.role, type: 'stage', data: { from: q.stage, to } });
    if (moved.kind === 'customer' && to === 'resolved') {
      await notifyCustomer(biz, moved, `Your query *${fmtNumber(moved.number)}* ("${moved.subject}") is resolved. If it isn't solved, just reply NOT SOLVED within ${REOPEN_DAYS} days.`);
    }
    return { query: decorate(moved) };
  }
  return { error: 'Nothing to change.' };
}

/**
 * The person who raised a team query confirms it (closed) or says it isn't solved (reopened).
 * @param {string} biz @param {QueryRow} q @param {string} to @param {Who} who
 */
async function requesterStage(biz, q, to, who) {
  if (to === 'closed' && q.stage !== 'resolved') return { error: 'You can close it once it is resolved.' };
  if (to === 'reopened') {
    if (!['resolved', 'closed'].includes(q.stage)) return { error: 'Only a resolved query can be reopened.' };
    if (q.resolved_at && Date.now() - Date.parse(q.resolved_at) > REOPEN_DAYS * 86400000 && q.stage === 'closed') return { error: `It was resolved more than ${REOPEN_DAYS} days ago. Raise a new query instead.` };
  }
  const moved = await patchQuery(biz, q.id, stagePatch(q, to), { onlyIfStage: q.stage });
  if (!moved) return { error: 'Someone changed this query a moment ago. Refresh and try again.', status: 409 };
  await addEvent(biz, q.id, { author_email: who.email, author_role: who.role, type: 'stage', data: { from: q.stage, to } });
  return { query: decorate(moved) };
}

/**
 * Add to the history. visibility: 'all' (everyone who can see the query) or 'handlers' (internal note).
 * toCustomer: also send it to the customer on WhatsApp (customer queries; handlers only).
 * A reply from the requester while "waiting" moves the query back to "in progress".
 * @param {Staff} staff @param {unknown} id @param {Input} [input]
 */
async function addComment(staff, id, input = {}) {
  const biz = requireBusinessId(staff?.businessId);
  /** @type {QueryRow | null} */
  let q = await getQuery(biz, id);
  const access = accessFor(q, staff);
  if (!q || access === 'none') return { error: 'Query not found.', status: 404 };
  const body = cleanText(input.body, 4000);
  if (!body) return { error: 'Write something first.' };
  const me = emailOf(staff);

  if (access === 'requester' || access === 'viewer') {
    if (access === 'viewer') return { error: 'You can view this query, but not work on it.', status: 403 };
    await addEvent(biz, q.id, { author_email: me, author_role: staff.role, type: 'comment', visibility: 'all', body });
    if (q.stage === 'waiting') {
      const moved = await patchQuery(biz, q.id, stagePatch(q, 'in_progress'), { onlyIfStage: 'waiting' });
      if (moved) { await addEvent(biz, q.id, { author_role: 'system', type: 'stage', data: { from: 'waiting', to: 'in_progress', reason: 'requester answered' } }); q = moved; }
    }
    return { query: decorate(q) };
  }

  const denied = workDenied(q, staff);
  if (denied) return { error: denied, status: 403 };
  q = await claimIfNeeded(biz, q, staff);
  if (!q) return { error: 'Query not found.', status: 404 };
  const visibility = input.visibility === 'handlers' ? 'handlers' : 'all';
  const toCustomer = !!input.toCustomer && q.kind === 'customer' && visibility === 'all';
  await addEvent(biz, q.id, { author_email: me, author_role: staff.role, type: toCustomer ? 'reply' : (visibility === 'handlers' ? 'note' : 'comment'), visibility, body });
  let sent = null;
  if (toCustomer) sent = await notifyCustomer(biz, q, `*${fmtNumber(q.number)}*: ${body}`);
  if (!q.first_response_at && visibility === 'all') q = await patchQuery(biz, q.id, { first_response_at: nowIso() }) || q;
  return { query: decorate(q), customerMessage: sent };
}

/**
 * Escalate one level up.
 *   Customer query: team -> managers (level 1) -> Business Admin (level 2).
 *   Team query:     managers -> Business Admin -> Platform support (a linked platform query is created).
 * @param {Staff} staff @param {unknown} id @param {unknown} [note]
 */
async function escalate(staff, id, note = '') {
  const biz = requireBusinessId(staff?.businessId);
  const q = await getQuery(biz, id);
  const denied = workDenied(q, staff);
  if (denied || !q) return { error: denied || 'Query not found.', status: denied === 'Query not found.' || !q ? 404 : 403 };
  const me = emailOf(staff);
  if (['resolved', 'closed'].includes(q.stage)) return { error: 'A resolved or closed query can\'t be escalated.' };

  if (q.kind === 'customer') {
    const level = q.escalation_level || 0;
    if (level >= 2) return { error: 'This query is already with the Business Admin.' };
    const moved = await patchQuery(biz, q.id, { ...stagePatch(q, 'escalated'), escalation_level: level + 1, assigned_to: null });
    if (!moved) return SAVE_FAILED;
    await addEvent(biz, q.id, { author_email: me, author_role: staff.role, type: 'escalated', body: cleanText(note, 1000) || null, data: { to: level === 0 ? 'managers' : 'owner' } });
    return { query: decorate(moved) };
  }
  if (q.addressed_to === 'managers') {
    const moved = await patchQuery(biz, q.id, { ...stagePatch(q, 'escalated'), addressed_to: 'owner', assigned_to: null, escalation_level: (q.escalation_level || 0) + 1 });
    if (!moved) return SAVE_FAILED;
    await addEvent(biz, q.id, { author_email: me, author_role: staff.role, type: 'escalated', body: cleanText(note, 1000) || null, data: { to: 'owner' } });
    return { query: decorate(moved) };
  }
  // Business Admin -> Platform support.
  if (staff.role !== 'owner') return { error: 'Only the Business Admin can send this to Platform support.', status: 403 };
  const created = await createPlatformQuery(staff, {
    category: q.category && PLATFORM_CATEGORIES.includes(q.category) ? q.category : 'Other',
    subject: q.subject, description: [q.description, cleanText(note, 1000)].filter(Boolean).join('\n\n'), priority: q.priority,
  }, { escalatedFrom: q.id });
  if (created.error !== undefined) return created;
  const moved = await patchQuery(biz, q.id, { ...stagePatch(q, 'escalated'), escalation_level: (q.escalation_level || 0) + 1 });
  if (!moved) return SAVE_FAILED;
  await addEvent(biz, q.id, { author_email: me, author_role: staff.role, type: 'escalated', body: `Sent to Platform support as ${fmtNumber(created.query.number, true)}`, data: { to: 'platform', platformQueryId: created.query.id } });
  return { query: decorate(moved), platformQuery: created.query };
}

/** The person who raised a team query rates the answer (1-5) once it is resolved/closed. @param {Staff} staff @param {unknown} id @param {Input} [input] */
async function rateQuery(staff, id, input = {}) {
  const biz = requireBusinessId(staff?.businessId);
  const q = await getQuery(biz, id);
  if (!q || accessFor(q, staff) !== 'requester') return { error: 'Only the person who raised the query can rate it.', status: 403 };
  return saveRating(biz, q, input.rating, input.comment, { email: emailOf(staff), role: staff.role });
}

/** @param {string} biz @param {QueryRow} q @param {unknown} rating @param {unknown} comment @param {{ email?: string | null, role: string }} who */
async function saveRating(biz, q, rating, comment, who) {
  const r = Number(rating);
  if (!Number.isInteger(r) || r < 1 || r > 5) return { error: 'Rate from 1 to 5.' };
  if (!['resolved', 'closed'].includes(q.stage)) return { error: 'You can rate a query once it is resolved.' };
  const moved = await patchQuery(biz, q.id, { rating: r, rating_comment: cleanText(comment, 1000) || null });
  if (!moved) return SAVE_FAILED;
  await addEvent(biz, q.id, { author_email: who.email || null, author_role: who.role, type: 'rating', data: { rating: r } });
  return { query: decorate(moved) };
}

// ---------------------------------------------------------------------------
// Customers on WhatsApp
// ---------------------------------------------------------------------------

/**
 * Tell the customer about their query. Inside WhatsApp's 24-hour window: a normal message.
 * Outside it: the business's approved "query_update" template ({{1}} = the update), if it has one.
 * Returns { sent: true } or { sent: false, reason } (and notes the reason on the query).
 * @param {string} biz @param {QueryRow} q @param {string} text
 * @returns {Promise<{ sent: boolean, reason?: string }>}
 */
async function notifyCustomer(biz, q, text) {
  try {
    const { whatsappFor } = require('./whatsapp.cjs');
    const meta = require('./meta.cjs');
    const { isWindowOpen } = require('./inbox.cjs');
    // From the number the customer last wrote to: its window is the lead's last_inbound_at.
    const wa = await whatsappFor(biz, q.contact_phone);
    if (!wa) return note(biz, q, 'Customer not told: no WhatsApp number connected.');
    const lead = await dbRequest(`whatsapp_leads?business_id=eq.${biz}&phone=eq.${q.contact_phone}&select=last_inbound_at,opted_out`);
    const l = lead.ok ? lead.data?.[0] : null;
    let res;
    if (isWindowOpen(l?.last_inbound_at)) {
      res = await meta.sendTextMessage(wa, q.contact_phone, text);
    } else {
      // Outside 24 h we would start the conversation ourselves: never to someone who replied STOP.
      if (l?.opted_out) return note(biz, q, 'Customer not told: they replied STOP, so only a reply to their next message can reach them.');
      const tpl = await require('./campaigns.cjs').loadApprovedTemplate(wa, 'query_update', 'en');
      if (tpl.error !== undefined) return note(biz, q, 'Customer not told: their last message is older than 24 hours and there is no approved "query_update" template.');
      res = await meta.sendTemplateMessage(wa, q.contact_phone, 'query_update', tpl.template.language, [{ type: 'body', parameters: [{ type: 'text', text: text.replace(/\*/g, '').slice(0, 1000) }] }]);
    }
    const wamid = res?.messages?.[0]?.id;
    if (res?.error || !wamid) return note(biz, q, `Customer not told: WhatsApp said "${res?.error?.message || 'no message id'}".`);
    const { logMessage } = require('./db.cjs');
    await logMessage(biz, { id: wamid, direction: 'outbound', sender: wa.phoneNumber, senderName: 'Queries', recipient: q.contact_phone, body: text, type: 'text', timestamp: nowIso(), deliveryStatus: 'sent', numberId: wa.phoneNumberId || null });
    return { sent: true };
  } catch (err) {
    return note(biz, q, `Customer not told: ${err instanceof Error ? err.message : err}`);
  }
}
/** Why the customer was not told, as an internal note. @param {string} biz @param {QueryRow} q @param {string} reason */
async function note(biz, q, reason) {
  await addEvent(biz, q.id, { author_role: 'system', type: 'note', visibility: 'handlers', body: reason });
  return { sent: false, reason };
}

/** A customer wrote on WhatsApp: their waiting queries start moving again. Returns how many. @param {string} biz @param {string} phone */
async function onCustomerMessage(biz, phone) {
  requireBusinessId(biz);
  const p = digits(phone);
  if (!/^\d{7,15}$/.test(p)) return 0;
  const r = await dbRequest(`queries?business_id=eq.${biz}&contact_phone=eq.${p}&kind=eq.customer&stage=eq.waiting&select=${QUERY_FIELDS}`);
  let n = 0;
  for (const q of r.ok ? r.data : []) {
    const moved = await patchQuery(biz, q.id, stagePatch(q, 'in_progress'), { onlyIfStage: 'waiting' });
    if (moved) { n++; await addEvent(biz, q.id, { author_role: 'customer', type: 'stage', data: { from: 'waiting', to: 'in_progress', reason: 'customer replied' } }); }
  }
  return n;
}

/** Customer says it isn't solved: their most recent resolved query (within REOPEN_DAYS) is reopened. @param {string} biz @param {string} phone */
async function customerReopen(biz, phone) {
  const p = digits(phone);
  const since = new Date(Date.now() - REOPEN_DAYS * 86400000).toISOString();
  const r = await dbRequest(`queries?business_id=eq.${requireBusinessId(biz)}&contact_phone=eq.${p}&kind=eq.customer&stage=in.(resolved,closed)&resolved_at=gte.${encodeURIComponent(since)}&select=${QUERY_FIELDS}&order=resolved_at.desc&limit=1`);
  const q = r.ok ? r.data?.[0] : null;
  if (!q) return null;
  const moved = await patchQuery(biz, q.id, stagePatch(q, 'reopened'), { onlyIfStage: q.stage });
  if (moved) await addEvent(biz, q.id, { author_role: 'customer', type: 'stage', data: { from: q.stage, to: 'reopened', reason: 'customer said not solved' } });
  return moved ? decorate(moved) : null;
}

// ---------------------------------------------------------------------------
// Platform support (any staff role -> the Platform Admin)
// ---------------------------------------------------------------------------
const PQ_FIELDS = 'id,number,business_id,raised_by_email,raised_by_role,category,subject,description,priority,stage,assigned_to,escalated_from,due_at,paused_at,first_response_at,resolved_at,closed_at,rating,created_at,updated_at';
/** @param {QueryRow} q @returns {QueryRow} */
const decoratePlatform = (q) => ({ ...q, ref: fmtNumber(q.number, true), overdue: isOverdue(q), stageLabel: label(q.stage) });

/**
 * @param {Staff} staff @param {Input} [input] @param {{ escalatedFrom?: string | null }} [options]
 * @returns {Promise<{ error: string, query?: undefined } | { error?: undefined, query: QueryRow }>}
 */
async function createPlatformQuery(staff, input = {}, { escalatedFrom = null } = {}) {
  const biz = requireBusinessId(staff?.businessId);
  const subject = clean(input.subject, 120);
  if (!subject) return { error: 'Write a short subject.' };
  const priority = PRIORITIES.includes(input.priority) ? input.priority : 'normal';
  const row = {
    business_id: biz, raised_by_email: emailOf(staff), raised_by_role: staff.role,
    category: PLATFORM_CATEGORIES.includes(input.category) ? input.category : 'Other',
    subject, description: cleanText(input.description, 4000) || null, priority,
    due_at: dueAt(priority), escalated_from: escalatedFrom,
  };
  const ins = await dbRequest('platform_queries', { method: 'POST', prefer: 'return=representation', body: row });
  if (!ins.ok || !ins.data?.[0]) return { error: 'Could not send it to Platform support. Has the Q1 SQL been run?' };
  const q = ins.data[0];
  await dbRequest('platform_query_events', { method: 'POST', prefer: 'return=minimal', body: { platform_query_id: q.id, business_id: biz, author_email: row.raised_by_email, author_role: staff.role, type: 'created', body: row.description } });
  return { query: decoratePlatform(q) };
}

/**
 * Business side: the raiser sees their own; the Business Admin sees all from the business.
 * @param {QueryRow | null | undefined} q @param {Staff} staff @returns {'requester' | 'none'}
 */
function platformAccessForStaff(q, staff) {
  if (!q || q.business_id !== staff?.businessId) return 'none';
  if (staff.role === 'owner' || String(q.raised_by_email).toLowerCase() === emailOf(staff)) return 'requester';
  return 'none';
}

/** @param {Staff} staff */
async function listPlatformQueriesForBusiness(staff) {
  const biz = requireBusinessId(staff?.businessId);
  const mine = staff.role === 'owner' ? '' : `&raised_by_email=ilike.${encodeURIComponent(emailOf(staff))}`;
  const r = await dbRequest(`platform_queries?business_id=eq.${biz}${mine}&select=${PQ_FIELDS}&order=created_at.desc&limit=200`);
  if (!r.ok) return { error: 'Could not load support queries.' };
  return { queries: r.data.filter((/** @type {QueryRow} */ q) => platformAccessForStaff(q, staff) !== 'none').map(decoratePlatform) };
}

/**
 * @param {Staff} staff @param {unknown} id
 * @returns {Promise<{ error: string, status: number, query?: undefined } | { error?: undefined, query: QueryRow, events: any[] }>}
 */
async function getPlatformQueryForBusiness(staff, id) {
  const biz = requireBusinessId(staff?.businessId);
  if (!isUuid(id)) return { error: 'Query not found.', status: 404 };
  const r = await dbRequest(`platform_queries?id=eq.${id}&business_id=eq.${biz}&select=${PQ_FIELDS}`);
  const q = r.ok ? r.data?.[0] : null;
  if (!q || platformAccessForStaff(q, staff) === 'none') return { error: 'Query not found.', status: 404 };
  const ev = await dbRequest(`platform_query_events?platform_query_id=eq.${q.id}&business_id=eq.${biz}&visibility=eq.all&select=id,author_email,author_role,type,body,data,created_at&order=created_at.asc`);
  return { query: decoratePlatform(q), events: ev.ok ? ev.data : [] };
}

/** The business side adds a comment, confirms (closed) or reopens. @param {Staff} staff @param {unknown} id @param {Input} [input] */
async function businessActOnPlatformQuery(staff, id, input = {}) {
  const found = await getPlatformQueryForBusiness(staff, id);
  if (found.error !== undefined) return found;
  const q = found.query;
  const biz = staff.businessId;
  const who = { platform_query_id: q.id, business_id: biz, author_email: emailOf(staff), author_role: staff.role };
  if (input.body) {
    const body = cleanText(input.body, 4000);
    await dbRequest('platform_query_events', { method: 'POST', prefer: 'return=minimal', body: { ...who, type: 'comment', visibility: 'all', body } });
    if (q.stage === 'waiting') {
      await dbRequest(`platform_queries?id=eq.${q.id}&stage=eq.waiting`, { method: 'PATCH', prefer: 'return=minimal', body: stagePatch(q, 'in_progress') });
    }
    return getPlatformQueryForBusiness(staff, id);
  }
  if (input.stage === 'closed' || input.stage === 'reopened') {
    if (input.stage === 'closed' && q.stage !== 'resolved') return { error: 'You can close it once it is resolved.' };
    if (input.stage === 'reopened' && !['resolved', 'closed'].includes(q.stage)) return { error: 'Only a resolved query can be reopened.' };
    await dbRequest(`platform_queries?id=eq.${q.id}&business_id=eq.${biz}`, { method: 'PATCH', prefer: 'return=minimal', body: stagePatch(q, input.stage) });
    await dbRequest('platform_query_events', { method: 'POST', prefer: 'return=minimal', body: { ...who, type: 'stage', data: { from: q.stage, to: input.stage } } });
    return getPlatformQueryForBusiness(staff, id);
  }
  if ('rating' in input) {
    const r = Number(input.rating);
    if (!Number.isInteger(r) || r < 1 || r > 5) return { error: 'Rate from 1 to 5.' };
    if (!['resolved', 'closed'].includes(q.stage)) return { error: 'You can rate it once it is resolved.' };
    await dbRequest(`platform_queries?id=eq.${q.id}&business_id=eq.${biz}`, { method: 'PATCH', prefer: 'return=minimal', body: { rating: r } });
    return getPlatformQueryForBusiness(staff, id);
  }
  return { error: 'Nothing to change.' };
}

// Platform Admin side (mounted under /api/platform, platform admins only).
/**
 * who: 'mine' (assigned to `me`) | 'unassigned' | '' (everyone's).
 * @param {{ stage?: string, businessId?: string, who?: string, me?: string }} [filters]
 */
async function platformListAll({ stage = '', businessId = '', who = '', me = '' } = {}) {
  const parts = [`select=${PQ_FIELDS},businesses(name)`, 'order=created_at.desc', 'limit=500'];
  if (STAGES.includes(stage)) parts.push(`stage=eq.${stage}`);
  if (stage === 'open') parts.push(`stage=in.(${OPEN_STAGES.join(',')})`);
  if (isUuid(businessId)) parts.push(`business_id=eq.${businessId}`);
  if (who === 'mine' && me) parts.push(`assigned_to=eq.${encodeURIComponent(String(me).toLowerCase())}`);
  if (who === 'unassigned') parts.push('assigned_to=is.null');
  const r = await dbRequest(`platform_queries?${parts.join('&')}`);
  if (!r.ok) return { error: 'Could not load support queries.' };
  return { queries: r.data.map((/** @type {QueryRow} */ q) => ({ ...decoratePlatform(q), businessName: q.businesses?.name || '' })) };
}

/**
 * @param {unknown} id
 * @returns {Promise<{ error: string, status: number, query?: undefined } | { error?: undefined, query: QueryRow, events: any[] }>}
 */
async function platformGet(id) {
  if (!isUuid(id)) return { error: 'Query not found.', status: 404 };
  const r = await dbRequest(`platform_queries?id=eq.${id}&select=${PQ_FIELDS},businesses(name)`);
  const q = r.ok ? r.data?.[0] : null;
  if (!q) return { error: 'Query not found.', status: 404 };
  const ev = await dbRequest(`platform_query_events?platform_query_id=eq.${id}&select=id,author_email,author_role,type,visibility,body,data,created_at&order=created_at.asc`);
  return { query: { ...decoratePlatform(q), businessName: q.businesses?.name || '' }, events: ev.ok ? ev.data : [] };
}

/**
 * Platform Owner / Application Manager acts on a support query: reply or internal note, stage, assign, priority.
 * Every action is audited with who did it (never the reply text). Assigning: only to a Platform Owner or
 * Application Manager; an Application Manager may assign to themselves or unassign/assign among managers.
 * @param {{ email: string, role?: string }} admin @param {unknown} id @param {Input} [input]
 */
async function platformUpdate(admin, id, input = {}) {
  const found = await platformGet(id);
  if (found.error !== undefined) return found;
  const q = found.query;
  const ev = { platform_query_id: q.id, business_id: q.business_id, author_email: admin.email, author_role: 'platform_admin' };
  /** @param {string} action @param {Record<string, unknown>} [details] */
  const audit = (action, details = {}) => dbRequest('audit_log', {
    method: 'POST', prefer: 'return=minimal',
    body: { business_id: q.business_id, actor_email: admin.email, actor_role: 'platform_admin', action, details: { query: q.ref, ...details, ...(admin.role ? { platformRole: admin.role } : {}) } },
  });
  if (input.body) {
    const visibility = input.visibility === 'platform' ? 'platform' : 'all';
    await dbRequest('platform_query_events', { method: 'POST', prefer: 'return=minimal', body: { ...ev, type: visibility === 'platform' ? 'note' : 'comment', visibility, body: cleanText(input.body, 4000) } });
    if (!q.first_response_at && visibility === 'all') await dbRequest(`platform_queries?id=eq.${q.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { first_response_at: nowIso() } });
    await audit(visibility === 'platform' ? 'support.note' : 'support.replied');
    return platformGet(id);
  }
  if ('stage' in input) {
    const to = String(input.stage);
    if (!STAGES.includes(to)) return { error: 'Unknown stage.' };
    if (to !== q.stage && !canMove(q.stage, to)) return { error: `A query can't go from ${label(q.stage)} to ${label(to)}.` };
    await dbRequest(`platform_queries?id=eq.${q.id}`, { method: 'PATCH', prefer: 'return=minimal', body: stagePatch(q, to) });
    await dbRequest('platform_query_events', { method: 'POST', prefer: 'return=minimal', body: { ...ev, type: 'stage', data: { from: q.stage, to } } });
    await audit('support.stage', { from: q.stage, to });
    return platformGet(id);
  }
  if ('assignedTo' in input) {
    const to = input.assignedTo ? String(input.assignedTo).toLowerCase().trim() : null;
    if (to) {
      const who = await dbRequest(`platform_admins?select=role&email=eq.${encodeURIComponent(to)}`);
      const role = who.ok ? who.data?.[0]?.role || (who.data?.[0] ? 'owner' : null) : null;
      if (role !== 'owner' && role !== 'manager') return { error: 'Assign it to a Platform Owner or an Application Manager.' };
    }
    await dbRequest(`platform_queries?id=eq.${q.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { assigned_to: to, stage: to && q.stage === 'new' ? 'assigned' : q.stage, updated_at: nowIso() } });
    await dbRequest('platform_query_events', { method: 'POST', prefer: 'return=minimal', body: { ...ev, type: 'assigned', visibility: 'platform', data: { to } } });
    await audit('support.assigned', { to });
    return platformGet(id);
  }
  if ('priority' in input && PRIORITIES.includes(input.priority)) {
    await dbRequest(`platform_queries?id=eq.${q.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { priority: input.priority, due_at: dueAt(input.priority, q.created_at), updated_at: nowIso() } });
    await audit('support.priority', { to: input.priority });
    return platformGet(id);
  }
  return { error: 'Nothing to change.' };
}

// ---------------------------------------------------------------------------
// Worker + settings
// ---------------------------------------------------------------------------

/** Resolved queries nobody objected to are closed after AUTO_CLOSE_DAYS. Returns how many. @param {number} [now] */
async function autoClose(now = Date.now()) {
  const before = encodeURIComponent(new Date(now - AUTO_CLOSE_DAYS * 86400000).toISOString());
  const t = new Date(now).toISOString();
  const a = await dbRequest(`queries?stage=eq.resolved&resolved_at=lt.${before}`, { method: 'PATCH', prefer: 'return=representation', body: { stage: 'closed', closed_at: t, updated_at: t } });
  const b = await dbRequest(`platform_queries?stage=eq.resolved&resolved_at=lt.${before}`, { method: 'PATCH', prefer: 'return=representation', body: { stage: 'closed', closed_at: t, updated_at: t } });
  return (a.ok ? a.data.length : 0) + (b.ok ? b.data.length : 0);
}

/**
 * Numbers for managers and the Business Admin (no message text): queries raised in the last `days`,
 * by stage, category, source and priority; open and overdue now; average first response and
 * resolution time (hours); satisfaction. Pure part below so it can be unit-tested.
 * @param {QueryRow[]} rows @param {number} [now]
 */
function summarize(rows, now = Date.now()) {
  /** @param {string} key @returns {Record<string, number>} */
  const count = (key) => rows.reduce((m, q) => { const k = q[key] || 'none'; m[k] = (m[k] || 0) + 1; return m; }, /** @type {Record<string, number>} */ ({}));
  /** @param {string} from @param {string} to */
  const hours = (from, to) => (Date.parse(to) - Date.parse(from)) / 3600000;
  /** @param {number[]} xs */
  const avg = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
  const firstResp = rows.filter(q => q.first_response_at).map(q => hours(q.created_at, q.first_response_at)).filter(h => h >= 0);
  const resolution = rows.filter(q => q.resolved_at).map(q => hours(q.created_at, q.resolved_at)).filter(h => h >= 0);
  const rated = rows.filter(q => Number.isInteger(q.rating));
  const resolvedOnTime = rows.filter(q => q.resolved_at && q.due_at && Date.parse(q.resolved_at) <= Date.parse(q.due_at)).length;
  return {
    total: rows.length,
    open: rows.filter(q => OPEN_STAGES.includes(q.stage)).length,
    overdue: rows.filter(q => isOverdue(q, now)).length,
    byStage: count('stage'), byCategory: count('category'), bySource: count('source'), byPriority: count('priority'),
    avgFirstResponseHours: avg(firstResp), avgResolutionHours: avg(resolution),
    resolvedOnTimePct: resolution.length ? Math.round((resolvedOnTime / resolution.length) * 100) : null,
    avgRating: avg(rated.map(q => q.rating)), ratings: rated.length,
  };
}

/** @param {Staff} staff @param {number} [days] */
async function queryStats(staff, days = 30) {
  const biz = requireBusinessId(staff?.businessId);
  const since = encodeURIComponent(new Date(Date.now() - days * 86400000).toISOString());
  const r = await dbRequest(`queries?business_id=eq.${biz}&created_at=gte.${since}&select=kind,stage,category,source,priority,due_at,paused_at,first_response_at,resolved_at,rating,created_at&limit=5000`);
  if (!r.ok) return { error: 'Could not load query numbers.' };
  // Overdue right now also counts older queries that are still open.
  const o = await dbRequest(`queries?business_id=eq.${biz}&stage=in.(${OPEN_STAGES.join(',')})&select=kind,stage,due_at&limit=5000`);
  /** @type {QueryRow[]} */
  const openRows = o.ok ? o.data : [];
  /** @type {QueryRow[]} */
  const rows = r.data;
  return {
    days,
    customer: summarize(rows.filter(q => q.kind === 'customer')),
    team: summarize(rows.filter(q => q.kind === 'internal')),
    openNow: { customer: openRows.filter(q => q.kind === 'customer').length, team: openRows.filter(q => q.kind === 'internal').length },
    overdueNow: { customer: openRows.filter(q => q.kind === 'customer' && isOverdue(q)).length, team: openRows.filter(q => q.kind === 'internal' && isOverdue(q)).length },
  };
}

/** Business Admin: due hours per priority. @param {Staff} staff @param {Input} [input] */
async function saveDueHours(staff, input = {}) {
  const biz = requireBusinessId(staff?.businessId);
  /** @type {Record<string, number>} */
  const out = {};
  for (const p of PRIORITIES) {
    const h = Number(input[p]);
    if (!Number.isFinite(h) || h < 0.5 || h > 720) return { error: 'Each due time must be between 0.5 and 720 hours.' };
    out[p] = h;
  }
  if (!(out.urgent <= out.high && out.high <= out.normal && out.normal <= out.low)) return { error: 'Urgent must be due soonest, then High, Normal, Low.' };
  const r = await dbRequest(`businesses?id=eq.${biz}`, { method: 'PATCH', prefer: 'return=minimal', body: { query_due_hours: out } });
  return r.ok ? { dueHours: out } : { error: 'Could not save.' };
}

/** Business Admin: add, rename-by-replace, or switch off categories. @param {Staff} staff @param {Input} [input] */
async function saveCategory(staff, input = {}) {
  const biz = requireBusinessId(staff?.businessId);
  const kind = input.kind === 'internal' ? 'internal' : 'customer';
  const name = clean(input.name, 40);
  if (!name) return { error: 'Write a category name.' };
  const r = await dbRequest('query_categories?on_conflict=business_id,kind,name', {
    method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
    body: { business_id: biz, kind, name, is_active: input.active !== false, sort_order: Number(input.sortOrder) || 50 },
  });
  return r.ok ? { categories: await categories(biz, kind) } : { error: 'Could not save the category.' };
}

module.exports = {
  STAGES, OPEN_STAGES, PRIORITIES, DEFAULT_DUE_HOURS, PLATFORM_CATEGORIES, AUTO_CLOSE_DAYS, REOPEN_DAYS,
  canMove, dueAt, isOverdue, accessFor, workDenied, stagePatch, fmtNumber,
  listQueries, getQueryDetail, findByNumber, decorate, categories, createQuery, updateQuery, addComment, escalate, rateQuery,
  notifyCustomer, onCustomerMessage, customerReopen, saveRating,
  createPlatformQuery, listPlatformQueriesForBusiness, getPlatformQueryForBusiness, businessActOnPlatformQuery,
  platformListAll, platformGet, platformUpdate,
  autoClose, saveDueHours, saveCategory, summarize, queryStats, allCategories,
};
