// @ts-check
// Team inbox + CRM: conversations from the database, replies, assignment,
// pipeline stages, bot pause (human takeover), tags and notes.
const { dbRequest, logMessage, digits } = require('./db.cjs');
const { sendTextMessage, sendTemplateMessage } = require('./meta.cjs');
const { pushMessage, broadcastEvent } = require('./state.cjs');
const { requireBusinessId, isManagerOrOwner, NO_WHATSAPP } = require('./tenant.cjs');
// whatsappFor: the number the customer last wrote to (several numbers per business), else the main one.
// Its 24-hour window is whatsapp_leads.last_inbound_at: the latest inbound message is on that same number.
const { whatsappFor, connectionForNumber, getWhatsApp } = require('./whatsapp.cjs');
const NUMBER_ID_RE = /^\d{5,30}$/;
const tpl = require('./templates.cjs');
const campaigns = require('./campaigns.cjs');

/** @typedef {import('./types.cjs').Staff} Staff */
/** @typedef {import('./types.cjs').Lead} Lead */
/** @typedef {'mine' | 'unassigned' | 'other'} Access */
/**
 * Result of the ownership check: refused (with an HTTP status), or allowed with the lead.
 * @typedef {{ error: string, status: number, assignedTo?: string | null, lead?: undefined }
 *   | { error?: undefined, lead: Lead, claimed: boolean }} ActResult
 */

// new = New enquiry, interested = In discussion, ordered = Booked (appointment/order), completed = Completed
// (visited/delivered), repeat = Returning, lost = Closed. Labels live in src/crmUtils.js.
const STAGES = ['new', 'interested', 'ordered', 'completed', 'repeat', 'lost'];
const WINDOW_MS = 24 * 3600 * 1000;            // WhatsApp customer-service window
const AUTO_PAUSE_HOURS = 12;                   // bot stays quiet after a staff reply / "talk to staff"
const LEAD_FIELDS = 'phone,name,last_message,last_contacted_at,last_inbound_at,assigned_to,stage,stage_changed_at,bot_paused,bot_paused_until,unread_count,source,referral,tags,opted_out,created_at,first_ad_id,first_ad_headline,first_ad_at,last_ad_id,last_ad_headline,last_ad_at,last_phone_number_id';
/** @param {unknown} p @returns {boolean} */
const isPhone = (p) => /^\d{7,15}$/.test(String(p || ''));

// Closing a chat with a reason (SQL 20261132). Until that SQL is run the columns don't exist: reads fall back to the
// older columns (rechecked every 5 minutes), so the inbox keeps working.
const CLOSE_FIELDS = 'closed_at,closed_reason,closed_by,close_note';
const CLOSE_REASONS = ['booked', 'resolved', 'not_interested', 'no_response', 'spam', 'other'];
let closeColumnsMissingAt = 0;
const closeColumnsReady = () => Date.now() - closeColumnsMissingAt > 5 * 60000;
/**
 * A lead query with the close columns when they exist, without them otherwise.
 * @param {(fields: string, withClose: boolean) => string} build  the request path for the given select list
 */
async function leadQuery(build) {
  if (closeColumnsReady()) {
    // Names + returning columns (SQL 20261138) too, when they exist.
    if (extraColumnsReady()) {
      const x = await dbRequest(build(`${LEAD_FIELDS},${CLOSE_FIELDS},${EXTRA_FIELDS}`, true));
      if (x.ok) { extraColumnsSeen = true; return x; }
      extraColumnsMissingAt = Date.now();
    }
    const r = await dbRequest(build(`${LEAD_FIELDS},${CLOSE_FIELDS}`, true));
    if (r.ok) return r;
    closeColumnsMissingAt = Date.now();
  }
  return dbRequest(build(LEAD_FIELDS, false));
}

// The team's saved name vs the WhatsApp name, and "returning after a long silence" (SQL 20261138). Same fallback idea.
const EXTRA_FIELDS = 'wa_name,name_set_by,name_set_at,returned_at,returned_after_days';
let extraColumnsMissingAt = 0;
const extraColumnsReady = () => Date.now() - extraColumnsMissingAt > 5 * 60000;
/** Seen working at least once (then search also looks at the WhatsApp name). */
let extraColumnsSeen = false;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Free-form replies are allowed only within 24h of the customer's last message.
 * @param {string | null | undefined} lastInboundAt
 * @param {number} [now]
 * @returns {boolean}
 */
function isWindowOpen(lastInboundAt, now = Date.now()) {
  const t = Date.parse(lastInboundAt || '');
  return Number.isFinite(t) && now - t < WINDOW_MS;
}

/** @param {string | null | undefined} lastInboundAt @returns {string | null} */
function windowClosesAt(lastInboundAt) {
  const t = Date.parse(lastInboundAt || '');
  return Number.isFinite(t) ? new Date(t + WINDOW_MS).toISOString() : null;
}

/**
 * Is the bot currently paused for this contact? (bot_paused_until null = until resumed)
 * @param {Partial<Lead> | null | undefined} lead
 * @param {number} [now]
 * @returns {boolean}
 */
function isBotPaused(lead, now = Date.now()) {
  if (!lead?.bot_paused) return false;
  const until = Date.parse(lead.bot_paused_until || '');
  return !Number.isFinite(until) || until > now;
}

/**
 * Automatic stage moves. Never moves a contact backwards or out of 'lost' except by an order.
 * event: 'inbound' | 'item_viewed' | 'order_enquiry'
 * @param {string | null | undefined} current
 * @param {'inbound' | 'item_viewed' | 'order_enquiry' | string} event
 * @param {{ hadEarlierOrder?: boolean }} [options]
 * @returns {string}
 */
function nextStage(current, event, { hadEarlierOrder = false } = {}) {
  const stage = current && STAGES.includes(current) ? current : 'new';
  if (event === 'order_enquiry') {
    if (stage === 'ordered' || stage === 'repeat') return hadEarlierOrder ? 'repeat' : stage;
    // Booking again after a completed visit/delivery = a returning customer or patient.
    if (stage === 'completed') return 'repeat';
    return hadEarlierOrder ? 'repeat' : 'ordered';
  }
  if (event === 'item_viewed' && stage === 'new') return 'interested';
  return stage;
}

/**
 * The same automatic moves for a business's own statuses: decided by TYPE (via the original key of each type),
 * landing in the business's first visible status of the needed type. No such status: the chat stays where it is.
 * @param {import('./leadStatuses.cjs').LeadStatus[]} list @param {string | null | undefined} current
 * @param {string} event @param {{ hadEarlierOrder?: boolean }} [options] @returns {string}
 */
function nextStatus(list, current, event, options = {}) {
  const ls = require('./leadStatuses.cjs');
  const from = current || 'new';
  const canon = ls.canonicalStage(list, from);
  const to = nextStage(canon, event, options);
  if (to === canon) return from;
  return ls.firstOfType(list, ls.TYPE_OF_LEGACY[to]) || from;
}

/** @param {unknown} tags @returns {string[]} */
function cleanTags(tags) {
  return [...new Set((Array.isArray(tags) ? tags : [])
    .map(t => String(t).trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-_]/g, ''))
    .filter(t => t && t.length <= 30))].slice(0, 20);
}

// ---------------------------------------------------------------------------
// Staff list (for assignment)
// ---------------------------------------------------------------------------
/** @param {string} biz @returns {Promise<string[]>} */
async function staffEmails(biz) {
  const res = await dbRequest(`staff_members?select=email&business_id=eq.${requireBusinessId(biz)}`);
  return res.ok ? res.data.map((/** @type {{ email: string }} */ s) => String(s.email).toLowerCase()) : [];
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * @param {string} biz
 * @param {{ filter?: string, stage?: string, q?: string, staffEmail?: string, number?: string, assignee?: string, extra?: any }} [options]
 *   extra: more filters (range, from, to, statusType, source, adId, tag, optedOut; server/leadsTools.cjs cleanFilters)
 *   number: only chats whose customer last wrote to this business number (Meta phone_number_id)
 *   assignee: only chats assigned to this team member (an email; the Inbox's "By person" filter)
 */
async function listConversations(biz, { filter = 'all', stage = '', q = '', staffEmail = '', number = '', assignee = '', extra = {} } = {}) {
  const parts = [`business_id=eq.${requireBusinessId(biz)}`, 'order=last_contacted_at.desc.nullslast', 'limit=300'];
  // More filters (server/leadsTools.cjs): date range by last activity, status type, source, ad, tag, STOP.
  const lt = require('./leadsTools.cjs');
  const more = lt.cleanFilters(extra);
  const added = await lt.filterParts(biz, { ...more, status: '', assignee: '', unread: false, number: '', q: '' });
  parts.push(...added.parts);
  if (filter === 'mine') parts.push(`assigned_to=eq.${encodeURIComponent(String(staffEmail).toLowerCase())}`);
  const who = String(assignee || '').trim().toLowerCase();
  if (filter !== 'mine' && filter !== 'unassigned' && /^[^\s@,()]+@[^\s@,()]+$/.test(who)) parts.push(`assigned_to=eq.${encodeURIComponent(who)}`);
  if (filter === 'unassigned') parts.push('assigned_to=is.null');
  if (filter === 'unread') parts.push('unread_count=gt.0');
  // A status key of the business (server/leadStatuses.cjs); any well-formed key is safe to filter on.
  if (stage && require('./leadStatuses.cjs').KEY_RE.test(stage)) parts.push(`stage=eq.${stage}`);
  /** @type {string[]} groups that must all match (PostgREST allows one `or` per query, so they go in `and`) */
  const ors = [...added.ors];
  const search = String(q || '').trim().replace(/[^\p{L}\p{N} +]/gu, '').slice(0, 40);
  if (search) {
    const term = encodeURIComponent(`*${search}*`);
    const phoneTerm = encodeURIComponent(`*${digits(search) || search}*`);
    // The saved name, the WhatsApp name (once those columns are known to exist) and the number.
    ors.push(`or(name.ilike.${term},${extraColumnsSeen && extraColumnsReady() ? `wa_name.ilike.${term},` : ''}phone.ilike.${phoneTerm})`);
  }
  const num = String(number || '');
  if (NUMBER_ID_RE.test(num)) {
    // Contacts from before several numbers (no number recorded) belong to the main number.
    const main = await getWhatsApp(biz);
    if (main && String(main.phoneNumberId) === num) ors.push(`or(last_phone_number_id.eq.${num},last_phone_number_id.is.null)`);
    else parts.push(`last_phone_number_id=eq.${num}`);
  }
  if (ors.length === 1) parts.push(ors[0].replace(/^or\(/, 'or=('));
  else if (ors.length > 1) parts.push(`and=(${ors.join(',')})`);
  // Closed chats only under "Closed"; every other view shows open chats.
  const res = await leadQuery((fields, withClose) => `whatsapp_leads?${[...parts, `select=${fields}`, ...(withClose ? [filter === 'closed' ? 'closed_at=not.is.null' : 'closed_at=is.null'] : [])].join('&')}`);
  if (!res.ok) return { error: 'Could not load conversations. Has the Phase 4 SQL been run?' };
  if (filter === 'closed' && !closeColumnsReady()) return { conversations: [], note: 'Closing chats needs the inbox SQL (20261132).' };
  const now = Date.now();
  return {
    conversations: res.data.map((/** @type {Lead} */ l) => ({ ...l, botPaused: isBotPaused(l, now), windowOpen: isWindowOpen(l.last_inbound_at, now) })),
  };
}

/** @param {string} biz @param {string} phone @returns {Promise<Lead | null>} */
async function getLead(biz, phone) {
  const id = requireBusinessId(biz);
  const res = await leadQuery(fields => `whatsapp_leads?select=${fields}&business_id=eq.${id}&phone=eq.${encodeURIComponent(phone)}`);
  return res.ok ? res.data?.[0] || null : null;
}

/** @param {string} biz @param {string} phone */
async function getConversation(biz, phone) {
  requireBusinessId(biz);
  if (!isPhone(phone)) return { error: 'Invalid number.' };
  const msgCols = 'id,message_id,direction,sender_name,body,type,sent_by,delivery_status,audio_url,timestamp,phone_number_id';
  const msgPath = (/** @type {string} */ cols) => `whatsapp_messages?select=${cols}&business_id=eq.${biz}&contact_phone=eq.${phone}&order=timestamp.desc&limit=300`;
  const [lead, msgs, notes, wins] = await Promise.all([
    getLead(biz, phone),
    // With the media columns (SQL 20261132) when they exist. Never media_id / media_path: the browser asks for a link.
    dbRequest(msgPath(`${msgCols},media_mime,media_name,media_size`)).then(r => (r.ok ? r : dbRequest(msgPath(msgCols)))),
    dbRequest(`lead_notes?select=id,author,body,created_at&business_id=eq.${biz}&phone=eq.${phone}&order=created_at.desc&limit=100`),
    dbRequest(`lead_number_windows?select=phone_number_id,last_inbound_at&business_id=eq.${biz}&phone=eq.${phone}`),
  ]);
  if (!lead) return { error: 'Contact not found.' };
  const now = Date.now();
  return {
    contact: {
      ...lead,
      botPaused: isBotPaused(lead),
      windowOpen: isWindowOpen(lead.last_inbound_at),
      windowClosesAt: windowClosesAt(lead.last_inbound_at),
      // Meta's 24-hour window is per business number: one entry per number this customer wrote to.
      windows: (wins.ok && Array.isArray(wins.data) ? wins.data : []).map((/** @type {{ phone_number_id: string, last_inbound_at: string }} */ w) => ({
        numberId: w.phone_number_id,
        lastInboundAt: w.last_inbound_at,
        open: isWindowOpen(w.last_inbound_at, now),
        closesAt: windowClosesAt(w.last_inbound_at),
      })),
    },
    messages: msgs.ok ? msgs.data.reverse() : [],
    notes: notes.ok ? notes.data : [],
  };
}

/** @param {string} biz */
async function pipeline(biz) {
  const id = requireBusinessId(biz);
  const res = await leadQuery(fields => `whatsapp_leads?select=${fields}&business_id=eq.${id}&order=last_contacted_at.desc.nullslast&limit=1000`);
  if (!res.ok) return { error: 'Could not load the pipeline. Has the Phase 4 SQL been run?' };
  // One column per visible status of this business (a hidden status still holding chats keeps its column).
  const ls = require('./leadStatuses.cjs');
  const list = await ls.listFor(id);
  const counts = ls.pipelineCounts(list, res.data);
  /** @type {Record<string, Lead[]>} */
  const columns = Object.fromEntries(counts.map(c => [c.stage, []]));
  const entry = columns.new ? 'new' : counts[0]?.stage;
  for (const l of res.data) (columns[l.stage] || columns[entry]).push(l);
  return { stages: counts.map(c => c.stage), statuses: list.filter(s => s.key in columns), columns };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** @param {string} biz @param {string} phone @param {Record<string, unknown>} body */
async function patchLead(biz, phone, body) {
  return dbRequest(`whatsapp_leads?business_id=eq.${requireBusinessId(biz)}&phone=eq.${encodeURIComponent(phone)}`, { method: 'PATCH', prefer: 'return=representation', body });
}

// ---------------------------------------------------------------------------
// Ownership rules
//   * Unassigned: anyone may act; acting claims the lead for them.
//   * Assigned to me: I may do anything, including transferring it.
//   * Assigned to someone else: view only.
//   * Owner role: may (re)assign any lead; otherwise follows the same rules.
// ---------------------------------------------------------------------------
/** @param {Partial<Staff> | null | undefined} staff @returns {string} */
const emailOf = (staff) => String(staff?.email || '').toLowerCase();
/**
 * A 403 answer.
 * @param {string} error
 * @param {{ assignedTo?: string | null }} [extra]
 * @returns {{ error: string, status: number, assignedTo?: string | null }}
 */
const forbidden = (error, extra = {}) => ({ error, status: 403, ...extra });

/**
 * 'mine' | 'unassigned' | 'other'
 * @param {Pick<Lead, 'assigned_to'> | null | undefined} lead
 * @param {Partial<Staff> | null | undefined} staff
 * @returns {Access}
 */
function accessFor(lead, staff) {
  if (!lead?.assigned_to) return 'unassigned';
  return String(lead.assigned_to).toLowerCase() === emailOf(staff) ? 'mine' : 'other';
}

/**
 * May `staff` change the assignee of `lead` to `target` (email or null)? Returns null if allowed, else a message.
 * @param {Pick<Lead, 'assigned_to'>} lead
 * @param {Partial<Staff> | null | undefined} staff
 * @param {string | null | undefined} target
 * @returns {string | null}
 */
function transferDenied(lead, staff, target) {
  // The Business Admin and managers may (re)assign any chat in their business.
  if (isManagerOrOwner(staff?.role)) return null;
  const access = accessFor(lead, staff);
  if (access === 'mine') return null;
  if (access === 'unassigned') {
    return target && String(target).toLowerCase() === emailOf(staff)
      ? null
      : 'You can take an unassigned chat yourself, but only the Business Admin or a manager can hand it to someone else.';
  }
  return `This chat belongs to ${lead.assigned_to}. Only they (or the Business Admin or a manager) can transfer it.`;
}

/**
 * Before any staff activity on a lead: allow it if the lead is mine, claim it if it's
 * unassigned (atomically, so two people acting at once can't both get it), refuse if
 * it belongs to someone else. Returns { lead, claimed } or a 403-style error.
 * Callers must check `.error` first; TypeScript then knows `.lead` is there.
 * @param {string} phone
 * @param {Staff} staff
 * @returns {Promise<ActResult>}
 */
async function ensureCanAct(phone, staff) {
  const biz = requireBusinessId(staff?.businessId);
  const lead = await getLead(biz, phone);
  if (!lead) return { error: 'Contact not found.', status: 404 };
  const access = accessFor(lead, staff);
  if (access === 'mine') return { lead, claimed: false };
  if (access === 'other') {
    return forbidden(`This chat belongs to ${lead.assigned_to}. You can view it, but only they can work on it. Ask them${isManagerOrOwner(staff.role) ? ', or reassign it to yourself,' : ' or the Business Admin'} to transfer it to you.`, { assignedTo: lead.assigned_to });
  }
  const claim = await dbRequest(`whatsapp_leads?business_id=eq.${biz}&phone=eq.${encodeURIComponent(phone)}&assigned_to=is.null`, {
    method: 'PATCH',
    prefer: 'return=representation',
    body: { assigned_to: emailOf(staff) },
  });
  if (claim.ok && claim.data?.length) return { lead: claim.data[0], claimed: true };
  // Someone else claimed it a moment ago.
  const now = await getLead(biz, phone);
  if (now && accessFor(now, staff) === 'mine') return { lead: now, claimed: false };
  return forbidden(`${now?.assigned_to || 'Someone else'} just took this chat.`, { assignedTo: now?.assigned_to });
}

/**
 * After a staff reply: clear unread and pause the bot for a while.
 * @param {string} biz
 * @param {Lead} lead
 * @param {string} staffEmail
 * @param {string} lastMessage
 */
async function afterStaffSend(biz, lead, staffEmail, lastMessage) {
  const now = new Date();
  /** @type {{ last_message: string, last_contacted_at: string, unread_count: number, bot_paused: boolean, bot_paused_until?: string }} */
  const body = {
    last_message: lastMessage.slice(0, 500),
    last_contacted_at: now.toISOString(),
    unread_count: 0,
    bot_paused: true,
    bot_paused_until: new Date(now.getTime() + AUTO_PAUSE_HOURS * 3600000).toISOString(),
  };
  // If someone paused the bot indefinitely, keep it that way.
  if (lead.bot_paused && !lead.bot_paused_until) delete body.bot_paused_until;
  // A reply on a closed chat opens it again.
  if (/** @type {Lead & { closed_at?: string | null }} */ (lead).closed_at) Object.assign(body, { closed_at: null, closed_reason: null, closed_by: null, close_note: null });
  await patchLead(biz, lead.phone, body);
}

/**
 * Close a chat with a reason (booked, solved, not interested…); the same rules as any other change (it may claim an
 * unassigned chat). A new customer message or a staff reply reopens it.
 * @param {string} phone @param {{ reason?: unknown, note?: unknown }} input @param {Staff} staff
 */
async function closeChat(phone, input, staff) {
  const biz = requireBusinessId(staff?.businessId);
  if (!isPhone(phone)) return { error: 'Invalid number.' };
  const reason = String(input?.reason || '');
  if (!CLOSE_REASONS.includes(reason)) return { error: 'Choose why the chat is closed.' };
  const note = String(input?.note || '').trim().replace(/\s+/g, ' ');
  if (note.length > 300) return { error: 'The note can be up to 300 characters.' };
  if (/[<>]/.test(note)) return { error: 'The note can\'t contain < or >.' };
  const access = await ensureCanAct(phone, staff);
  if (access.error !== undefined) return access;
  const res = await patchLead(biz, phone, { closed_at: new Date().toISOString(), closed_reason: reason, closed_by: emailOf(staff), close_note: note || null, unread_count: 0 });
  if (!res.ok || !res.data?.length) return { error: 'Could not close the chat. Has the inbox SQL (20261132) been run?' };
  return { contact: res.data[0] };
}

/** Open a closed chat again (same rules as any change). @param {string} phone @param {Staff} staff */
async function reopenChat(phone, staff) {
  const biz = requireBusinessId(staff?.businessId);
  if (!isPhone(phone)) return { error: 'Invalid number.' };
  const access = await ensureCanAct(phone, staff);
  if (access.error !== undefined) return access;
  const res = await patchLead(biz, phone, { closed_at: null, closed_reason: null, closed_by: null, close_note: null });
  if (!res.ok || !res.data?.length) return { error: 'Could not reopen the chat.' };
  return { contact: res.data[0] };
}

/**
 * Save a message staff sent (and show it in open dashboards).
 * @param {string} biz @param {any} wa @param {string} phone @param {string} wamid
 * @param {string} body @param {string} type @param {string} staffEmail
 * @param {import('./db.cjs').LoggedMessage['media']} [media]  a photo / document / audio / video sent
 */
function recordOutbound(biz, wa, phone, wamid, body, type, staffEmail, media = null) {
  const item = {
    media,
    id: wamid,
    direction: 'outbound',
    sender: wa.phoneNumber,
    senderName: staffEmail,
    sentBy: staffEmail,
    recipient: phone,
    body,
    type,
    timestamp: new Date().toISOString(),
    deliveryStatus: 'sent',
    numberId: wa.phoneNumberId || null,
  };
  pushMessage(item, biz);
  broadcastEvent('message', item, biz);
  return logMessage(biz, item);
}

/**
 * Which number a staff reply goes out from, and when the customer last wrote to THAT number (Meta's
 * 24-hour window is per number). No choice = the number they last wrote to (whose window is the lead's
 * last_inbound_at). A chosen number must be one of this business's numbers.
 * @param {string} biz @param {string} phone @param {Lead} lead @param {unknown} fromNumberId
 * @returns {Promise<{ error: string, wa?: undefined, lastInboundAt?: undefined } | { error?: undefined, wa: import('./whatsapp.cjs').WhatsAppConn | null, lastInboundAt: string | null | undefined }>}
 */
async function replyRoute(biz, phone, lead, fromNumberId) {
  const want = fromNumberId == null ? '' : String(fromNumberId).trim();
  if (!want) return { wa: await whatsappFor(biz, phone), lastInboundAt: lead.last_inbound_at };
  if (!NUMBER_ID_RE.test(want)) return { error: 'Choose one of your WhatsApp numbers.' };
  const wa = await connectionForNumber(biz, want);
  if (!wa) return { error: 'That WhatsApp number isn\'t connected to this business.' };
  const lastNumber = lead.last_phone_number_id || (await getWhatsApp(biz))?.phoneNumberId;
  if (String(lastNumber || '') === want) return { wa, lastInboundAt: lead.last_inbound_at };
  const r = await dbRequest(`lead_number_windows?select=last_inbound_at&business_id=eq.${biz}&phone=eq.${encodeURIComponent(phone)}&phone_number_id=eq.${want}`);
  return { wa, lastInboundAt: r.ok && Array.isArray(r.data) ? r.data[0]?.last_inbound_at || null : null };
}

/**
 * @param {string} phone @param {unknown} text @param {Staff} staff
 * @param {unknown} [fromNumberId] reply from this business number (default: the one the customer last wrote to)
 * @returns {Promise<{ error?: string, status?: number, windowClosed?: boolean, sent?: boolean, id?: string, [key: string]: any }>}
 */
async function sendText(phone, text, staff, fromNumberId) {
  const biz = requireBusinessId(staff?.businessId);
  if (!isPhone(phone)) return { error: 'Invalid number.' };
  const message = String(text || '').trim();
  if (!message) return { error: 'Type a message.' };
  if (message.length > 4096) return { error: 'Message is too long (max 4096 characters).' };
  const pre = await getLead(biz, phone);
  if (!pre) return { error: 'Contact not found.' };
  const route = await replyRoute(biz, phone, pre, fromNumberId);
  if (route.error !== undefined) return { error: route.error };
  const wa = route.wa;
  if (!wa) return { error: NO_WHATSAPP };
  if (!isWindowOpen(route.lastInboundAt)) {
    return { error: fromNumberId
      ? 'This customer hasn\'t messaged this number in the last 24 hours, so WhatsApp only allows an approved template from it. Use "Send template", or reply from the number they wrote to.'
      : 'This customer hasn\'t messaged in the last 24 hours, so WhatsApp only allows an approved template. Use "Send template".', windowClosed: true };
  }
  const access = await ensureCanAct(phone, staff);
  if (access.error !== undefined) return access;
  const { lead } = access;
  const res = await sendTextMessage(wa, phone, message);
  if (res.error || !res.messages?.[0]?.id) return { error: res.error?.error_data?.details || res.error?.message || 'WhatsApp rejected the message.' };
  await recordOutbound(biz, wa, phone, res.messages[0].id, message, 'text', staff.email);
  await afterStaffSend(biz, lead, staff.email, message);
  return { sent: true, id: res.messages[0].id };
}

/**
 * @param {string} phone
 * @param {{ templateName?: string, language?: string, variables?: Record<string, string | number>, fromNumberId?: unknown }} input
 * @param {Staff} staff
 */
async function sendTemplate(phone, input, staff) {
  const biz = requireBusinessId(staff?.businessId);
  if (!isPhone(phone)) return { error: 'Invalid number.' };
  const pre = await getLead(biz, phone);
  if (!pre) return { error: 'Contact not found.' };
  const route = await replyRoute(biz, phone, pre, input.fromNumberId);
  if (route.error !== undefined) return { error: route.error };
  const wa = route.wa;
  if (!wa) return { error: NO_WHATSAPP };
  // Templates belong to the sending number's WhatsApp Business Account.
  const loaded = await campaigns.loadApprovedTemplate(wa, input.templateName, input.language);
  if (loaded.error) return { error: loaded.error };
  if (pre.opted_out && loaded.template.category === 'MARKETING') {
    return { error: 'This customer replied STOP, so marketing templates can\'t be sent to them.' };
  }
  const access = await ensureCanAct(phone, staff);
  if (access.error !== undefined) return access;
  const { lead } = access;
  const needs = tpl.templateNeeds(loaded.template);
  const variables = input.variables || {};
  const varError = tpl.checkVariables(needs, variables);
  if (varError) return { error: varError };
  const contact = { name: lead.name };
  const res = await sendTemplateMessage(wa, phone, loaded.template.name, loaded.template.language, tpl.buildSendComponents(needs, variables, contact));
  if (res.error || !res.messages?.[0]?.id) return { error: res.error?.error_user_msg || res.error?.message || 'WhatsApp rejected the template.' };
  const preview = tpl.renderPreview(needs, variables, contact);
  await recordOutbound(biz, wa, phone, res.messages[0].id, `[📄 Template: ${loaded.template.name}]\n${preview}`, 'template', staff.email);
  await afterStaffSend(biz, lead, staff.email, preview);
  return { sent: true, id: res.messages[0].id };
}

/**
 * Opening a chat clears its unread badge, but only for the person it belongs to (or anyone, if unassigned). Not a claim.
 * @param {string} phone @param {Staff} staff
 */
async function markRead(phone, staff) {
  const biz = requireBusinessId(staff?.businessId);
  if (!isPhone(phone)) return { error: 'Invalid number.' };
  const lead = await getLead(biz, phone);
  if (!lead) return { error: 'Contact not found.' };
  if (accessFor(lead, staff) === 'other') return { ok: true, skipped: true };
  await patchLead(biz, phone, { unread_count: 0 });
  return { ok: true };
}

/**
 * Staff edits: assignee (transfer), stage, bot pause, tags, name.
 * Changing the assignee follows transferDenied(); any other change follows ensureCanAct().
 * @param {string} phone
 * @param {{ assignedTo?: string | null, stage?: string, botPaused?: boolean, pauseHours?: number | string | null, tags?: unknown, name?: string, bookingValue?: number | string | null }} input
 * @param {Staff} staff
 */
async function updateContact(phone, input = {}, staff) {
  const biz = requireBusinessId(staff?.businessId);
  if (!isPhone(phone)) return { error: 'Invalid number.' };
  /** @type {Record<string, unknown>} */
  const body = {};
  const editsOtherThanAssignee = Object.keys(input).some(k => ['stage', 'botPaused', 'pauseHours', 'tags', 'name', 'bookingValue'].includes(k));
  if ('assignedTo' in input && editsOtherThanAssignee) {
    return { error: 'Change the assignee on its own, then make other changes.' };
  }
  /** The status before this change (for the status history). @type {string | null} */
  let prevStage = null;
  /** The contact before this change (for clearing a saved name). @type {any} */
  let prevLead = null;

  if ('assignedTo' in input) {
    const email = input.assignedTo ? String(input.assignedTo).toLowerCase().trim() : null;
    if (email && !(await staffEmails(biz)).includes(email)) return { error: 'That person is not on the staff list.' };
    const lead = await getLead(biz, phone);
    if (!lead) return { error: 'Contact not found.' };
    const denied = transferDenied(lead, staff, email);
    if (denied) return forbidden(denied, { assignedTo: lead.assigned_to });
    body.assigned_to = email;
  } else if (editsOtherThanAssignee) {
    const access = await ensureCanAct(phone, staff);
    if (access.error !== undefined) return access;
    prevStage = access.lead?.stage ? String(access.lead.stage) : null;
    prevLead = access.lead || null;
  }

  // A booking's value (optional; Ads funnel revenue). null clears it.
  if ('bookingValue' in input) {
    const raw = /** @type {unknown} */ (/** @type {Record<string, unknown>} */ (input).bookingValue);
    if (raw === null || raw === '') body.booking_value = null;
    else {
      const v = Number(raw);
      if (!Number.isFinite(v) || v < 0 || v > 100000000) return { error: 'The booking value must be an amount from 0.' };
      body.booking_value = Math.round(v * 100) / 100;
    }
  }
  if ('stage' in input) {
    const list = await require('./leadStatuses.cjs').listFor(biz);
    if (!input.stage || !list.some(s => s.key === input.stage && s.active)) return { error: 'Unknown status.' };
    body.stage = input.stage;
    body.stage_changed_at = new Date().toISOString();
  }
  if ('botPaused' in input) {
    body.bot_paused = !!input.botPaused;
    const hours = Number(input.pauseHours);
    body.bot_paused_until = input.botPaused && hours > 0 ? new Date(Date.now() + Math.min(hours, 720) * 3600000).toISOString() : null;
  }
  if ('tags' in input) body.tags = cleanTags(input.tags);
  if ('name' in input) {
    // The team's own name for the contact: WhatsApp never overwrites it. Empty = back to the WhatsApp name.
    const name = String(input.name ?? '').replace(/\s+/g, ' ').trim();
    if (name.length > 80) return { error: 'A name can be up to 80 characters.' };
    if (/[<>]/.test(name)) return { error: 'A name can\'t contain < or >.' };
    if (name) Object.assign(body, { name, name_set_by: emailOf(staff), name_set_at: new Date().toISOString() });
    else Object.assign(body, { name: prevLead?.wa_name || `+${phone}`, name_set_by: null, name_set_at: null });
  }
  if (!Object.keys(body).length) return { error: 'Nothing to change.' };
  let res = await patchLead(biz, phone, body);
  // Before SQL 20261137 there is no booking_value column: save the rest.
  if (!res.ok && ('booking_value' in body || 'name_set_by' in body)) {
    const { booking_value: _skip, name_set_by: _by, name_set_at: _at, ...rest } = body;
    res = Object.keys(rest).length ? await patchLead(biz, phone, rest) : res;
  }
  if (!res.ok || !res.data?.length) return { error: 'Contact not found.' };
  // A booking from a Click-to-WhatsApp ad is reported to Meta (if switched on; never fails this change).
  if (body.stage) await require('./adConversions.cjs').onStage(biz, res.data[0], String(body.stage));
  if (body.stage) await require('./statusHistory.cjs').record(biz, [{ phone, from: prevStage, to: String(body.stage) }], { by: staff.email, source: 'staff' });
  // Handed to someone else: their dashboard gets an alert (never fails this change).
  if (body.assigned_to && body.assigned_to !== emailOf(staff)) {
    try { await require('./inboxAlerts.cjs').onAssigned(biz, String(body.assigned_to)); } catch { /* alerts are best effort */ }
  }
  return { contact: res.data[0] };
}

/**
 * Start a conversation with a new number (WhatsApp requires a template for the first message).
 * @param {Staff} staff @param {unknown} phone @param {unknown} name
 */
async function startConversation(staff, phone, name, extra = {}) {
  const biz = requireBusinessId(staff?.businessId);
  const p = digits(phone);
  if (!isPhone(p)) return { error: 'Enter the number with country code, e.g. 919876543210.' };
  const existing = await getLead(biz, p);
  if (existing) return { contact: existing, existed: true };

  // "Add lead" (a phone call, walk-in…): source, status, tags, assignee and a first note. Nothing is sent on WhatsApp.
  const lt = require('./leadsTools.cjs');
  const x = extra && typeof extra === 'object' ? /** @type {Record<string, unknown>} */ (extra) : {};
  const source = x.source === undefined ? 'Added by staff' : String(x.source);
  if (!lt.SOURCES_ADDED.includes(source) && source !== 'Added by staff') return { error: `Source must be one of: ${lt.SOURCES_ADDED.join(', ')}.` };
  const ls = require('./leadStatuses.cjs');
  const list = await ls.listFor(biz);
  const stage = x.status ? String(x.status) : (ls.firstOfType(list, 'new') || 'new');
  if (!list.some(s => s.key === stage && s.active)) return { error: 'Unknown status.' };
  const me = emailOf(staff);
  /** @type {string | null} */
  let assignTo = null;
  if (x.assignedTo !== undefined && x.assignedTo !== null && x.assignedTo !== '') {
    assignTo = String(x.assignedTo).toLowerCase().trim();
    if (!isManagerOrOwner(staff.role) && assignTo !== me) return forbidden('Agents can add leads for themselves only.');
    if (!(await staffEmails(biz)).includes(assignTo)) return { error: 'That person is not on the staff list.' };
  } else if (!isManagerOrOwner(staff.role) && 'source' in x) {
    assignTo = me; // a lead an agent adds is theirs
  }
  const note = typeof x.note === 'string' ? x.note.trim().slice(0, 2000) : '';

  // Plan limit: contacts added by staff. (Customers who message in are never blocked.)
  const room = await require('./limits.cjs').check(biz, 'contacts', 1);
  if (room.error) return { error: room.error, limitReached: true };
  const now = new Date().toISOString();
  const typedName = String(name || '').replace(/s+/g, ' ').trim().slice(0, 80).replace(/[<>]/g, '');
  /** @param {boolean} withSaved */
  const insert = (withSaved) => dbRequest('whatsapp_leads?on_conflict=business_id,phone', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: {
      business_id: biz, phone: p, name: typedName || `+${p}`, source, last_contacted_at: now, status: 'active',
      // A name typed by staff is the team's saved name: WhatsApp's profile name never replaces it (SQL 20261138).
      ...(withSaved && typedName ? { name_set_by: me, name_set_at: now } : {}),
      ...(stage !== 'new' ? { stage, stage_changed_at: now } : {}),
      ...('tags' in x ? { tags: cleanTags(x.tags) } : {}),
      ...(assignTo ? { assigned_to: assignTo } : {}),
    },
  });
  let res = await insert(true);
  if (!res.ok && typedName) res = await insert(false);
  if (!res.ok) return { error: 'Could not add the contact.' };
  // A number deleted after it replied STOP stays opted out.
  const suppressed = await lt.reapply(biz, p);
  await require('./statusHistory.cjs').record(biz, [{ phone: p, from: null, to: stage }], { by: staff.email, source: 'added' });
  if (note) await dbRequest('lead_notes', { method: 'POST', prefer: 'return=minimal', body: { business_id: biz, phone: p, author: staff.email, body: note } });
  if ('source' in x) {
    await dbRequest('contact_events', { method: 'POST', prefer: 'return=minimal', body: { business_id: biz, phone: p, event_type: 'lead_added', data: { by: staff.email, source } } });
  }
  const contact = suppressed ? (await getLead(biz, p)) || res.data?.[0] : res.data?.[0];
  return { contact, ...(suppressed ? { optedOut: true } : {}) };
}

/** @param {string} phone @param {unknown} body @param {Staff} staff */
async function addNote(phone, body, staff) {
  if (!isPhone(phone)) return { error: 'Invalid number.' };
  const text = String(body || '').trim();
  if (!text) return { error: 'Write a note first.' };
  if (text.length > 2000) return { error: 'Notes can be up to 2000 characters.' };
  const access = await ensureCanAct(phone, staff);
  if (access.error !== undefined) return access;
  const res = await dbRequest('lead_notes', { method: 'POST', prefer: 'return=representation', body: { business_id: staff.businessId, phone, author: staff.email, body: text } });
  if (!res.ok) return { error: 'Could not save the note.' };
  return { note: res.data[0] };
}

/** @param {string} id @param {Staff} staff */
async function deleteNote(id, staff) {
  const biz = requireBusinessId(staff?.businessId);
  if (!/^\d+$/.test(String(id))) return { error: 'Invalid note.' };
  const found = await dbRequest(`lead_notes?id=eq.${id}&business_id=eq.${biz}&select=id,phone,author`);
  const note = found.ok ? found.data?.[0] : null;
  if (!note) return { error: 'Note not found.', status: 404 };
  // The Business Admin and managers can delete any note. Others: only their own, on a chat they may work on.
  if (!isManagerOrOwner(staff.role)) {
    if (String(note.author).toLowerCase() !== emailOf(staff)) return forbidden('You can only delete your own notes.');
    const access = await ensureCanAct(note.phone, staff);
    if (access.error !== undefined) return access;
  }
  const res = await dbRequest(`lead_notes?id=eq.${id}&business_id=eq.${biz}`, { method: 'DELETE', prefer: 'return=representation' });
  if (!res.ok || !res.data?.length) return { error: 'Could not delete the note.' };
  return { deleted: true };
}

// ---------------------------------------------------------------------------
// Webhook hooks
// ---------------------------------------------------------------------------

/**
 * Incoming message: unread +1, open the reply window; and remember which of the business's numbers the
 * customer wrote to (replies go out from it) with that number's own 24-hour window.
 * @param {string} biz @param {string} phone @param {string | null} [numberId] Meta phone_number_id
 */
async function onInbound(biz, phone, numberId) {
  await dbRequest('rpc/lead_mark_inbound_in_business', { method: 'POST', body: { p_business: requireBusinessId(biz), p_phone: phone } });
  // The customer wrote again: a closed chat is open again.
  if (closeColumnsReady()) {
    await dbRequest(`whatsapp_leads?business_id=eq.${biz}&phone=eq.${encodeURIComponent(phone)}&closed_at=not.is.null`, {
      method: 'PATCH', prefer: 'return=minimal', body: { closed_at: null, closed_reason: null, closed_by: null, close_note: null },
    });
  }
  if (numberId && /^\d{5,30}$/.test(String(numberId))) {
    // Before migration 20261122 this function doesn't exist: harmless (404), the main number is used.
    await dbRequest('rpc/lead_mark_inbound_number', { method: 'POST', body: { p_business: biz, p_phone: phone, p_number: String(numberId) } });
  }
}

/** Customer asked for a person ("Talk to staff" / "Ask nutritionist"): pause the bot. @param {string} biz @param {string} phone */
async function pauseForHandover(biz, phone) {
  await patchLead(biz, phone, {
    bot_paused: true,
    bot_paused_until: new Date(Date.now() + AUTO_PAUSE_HOURS * 3600000).toISOString(),
  });
  // Asked for a person: if rotation is on and nobody has the chat yet, give it to the next available person.
  await require('./leadAssignment.cjs').assignIfDue(biz, phone, { reason: 'handover' });
}

/**
 * Move the contact along the pipeline after an event.
 * @param {string} biz @param {string} phone @param {'inbound' | 'item_viewed' | 'order_enquiry' | string} event
 */
async function applyStageEvent(biz, phone, event) {
  const lead = await getLead(biz, phone);
  if (!lead) return;
  let hadEarlierOrder = false;
  if (event === 'order_enquiry') {
    // The current order is already recorded, so "earlier" means another order more than a day ago.
    const before = new Date(Date.now() - 86400000).toISOString();
    const prev = await dbRequest(`contact_events?select=id&business_id=eq.${biz}&phone=eq.${encodeURIComponent(phone)}&event_type=eq.order_enquiry&created_at=lt.${encodeURIComponent(before)}&limit=1`);
    hadEarlierOrder = !!(prev.ok && prev.data.length);
  }
  const next = nextStatus(await require('./leadStatuses.cjs').listFor(biz), lead.stage, event, { hadEarlierOrder });
  if (next !== lead.stage) {
    await patchLead(biz, phone, { stage: next, stage_changed_at: new Date().toISOString() });
    await require('./adConversions.cjs').onStage(biz, lead, next); // the bot's Book / Enquire from an ad
    await require('./statusHistory.cjs').record(biz, [{ phone, from: lead.stage, to: next }], { by: 'bot', source: 'bot' });
  }
}

/** May searches also look at the WhatsApp name (the column is known to exist)? */
const waNameSearchable = () => extraColumnsSeen && extraColumnsReady();

module.exports = {
  closeColumnsReady,
  waNameSearchable,
  STAGES,
  AUTO_PAUSE_HOURS,
  isWindowOpen,
  windowClosesAt,
  isBotPaused,
  nextStage,
  nextStatus,
  cleanTags,
  accessFor,
  transferDenied,
  ensureCanAct,
  listConversations,
  getConversation,
  getLead,
  pipeline,
  sendText,
  sendTemplate,
  markRead,
  updateContact,
  startConversation,
  addNote,
  deleteNote,
  onInbound,
  pauseForHandover,
  applyStageEvent,
  // Inbox essentials: closing chats, media, alerts.
  CLOSE_REASONS,
  closeChat,
  reopenChat,
  recordOutbound,
  replyRoute,
  afterStaffSend,
  /** Tests only: forget that the close columns were missing. */
  _resetCloseColumns: () => { closeColumnsMissingAt = 0; },
};
