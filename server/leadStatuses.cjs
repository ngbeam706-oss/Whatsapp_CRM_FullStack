// @ts-check
// Lead statuses per business (docs/progress/lead-statuses.md). Each business has its own list (up to 12): label,
// colour, order, active/hidden and a fixed TYPE. whatsapp_leads.stage holds the status KEY.
//
// Everything automatic works on the TYPE, never the label:
//   new      every new chat starts in the built-in "new" status (renamable; can't be hidden, deleted or retyped)
//   working  the bot moves a new chat here when the customer views something
//   won      booked / ordered (bot "Book" / "Enquire"): bookings to Meta, conversions, team ranking
//   done     visited / delivered: also counts as converted
//   repeat   came back for another booking / order: also counts as converted
//   lost     not going ahead
// The six original keys keep their meaning (new, interested, ordered, completed, repeat, lost), so older data,
// tests and ad conversions keep working; custom statuses get keys like s_ab12cd.
// Tenancy: every read and write is scoped to the staff member's own business.
const crypto = require('crypto');
const { dbRequest, countRows } = require('./db.cjs');
const { requireBusinessId, isManagerOrOwner } = require('./tenant.cjs');

/** @typedef {'new' | 'working' | 'won' | 'done' | 'repeat' | 'lost'} StatusType */
/** @typedef {{ key: string, label: string, hint: string | null, color: string, type: StatusType, sort_order: number, active: boolean }} LeadStatus */
/** @typedef {import('./types.cjs').Staff} Staff */

/** @type {readonly StatusType[]} */
const TYPES = ['new', 'working', 'won', 'done', 'repeat', 'lost'];
/** @type {Record<StatusType, string>} */
const TYPE_LABEL = { new: 'New', working: 'Working on it', won: 'Booked / ordered', done: 'Done (visited / delivered)', repeat: 'Returning', lost: 'Lost / closed' };
/** The original six keys, one per type (the logic below is written in these). */
/** @type {Record<StatusType, string>} */
const LEGACY_KEY = { new: 'new', working: 'interested', won: 'ordered', done: 'completed', repeat: 'repeat', lost: 'lost' };
/** @type {Record<string, StatusType>} */
const TYPE_OF_LEGACY = { new: 'new', interested: 'working', ordered: 'won', completed: 'done', repeat: 'repeat', lost: 'lost' };
/** Types that count as a conversion (bookings to Meta, analytics, team ranking). */
const CONVERTED_TYPES = ['won', 'done', 'repeat'];
const COLORS = ['slate', 'amber', 'sky', 'violet', 'emerald', 'rose', 'teal', 'indigo', 'orange', 'pink', 'lime', 'cyan'];
const MAX_STATUSES = 12;
const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

/** @param {string} key @param {string} label @param {string} hint @param {string} color @param {number} order @returns {LeadStatus} */
const row = (key, label, hint, color, order) => ({ key, label, hint, color, type: TYPE_OF_LEGACY[key], sort_order: order, active: true });

/** Today's six (every business before this feature; also the "general" starting list). */
const GENERAL = [
  row('new', 'New enquiry', 'Just reached out', 'slate', 1),
  row('interested', 'In discussion', 'Asking about services, doctors, prices or timings', 'amber', 2),
  row('ordered', 'Booked', 'Appointment booked or order placed', 'sky', 3),
  row('completed', 'Completed', 'Visited, treated or delivered', 'violet', 4),
  row('repeat', 'Returning', 'Came back for a follow-up, another visit or another order', 'emerald', 5),
  row('lost', 'Closed', 'Not going ahead, or gone quiet', 'rose', 6),
];
/** Starting lists for NEW businesses, by businesses.industry (same keys and types, words that fit). */
/** @type {Record<string, Array<[string, string]>>} label, hint per key in GENERAL order */
const INDUSTRY_WORDS = {
  hospital: [['New enquiry', 'Just reached out'], ['Called back', 'We called or replied with details'], ['Appointment booked', 'Has a date and time'], ['Visited', 'Came for the consultation or treatment'], ['Follow-up visit', 'Booked again'], ['Not interested', 'Not going ahead']],
  food: [['New', 'Just reached out'], ['Interested', 'Looking at the menu or prices'], ['Ordered', 'Order placed'], ['Delivered', 'Order delivered'], ['Repeat', 'Ordered again'], ['Lost', 'Not ordering']],
  retail: [['New enquiry', 'Just reached out'], ['Interested', 'Asking about products or prices'], ['Ordered', 'Order placed'], ['Delivered', 'Picked up or delivered'], ['Repeat customer', 'Bought again'], ['Not interested', 'Not buying']],
  services: [['New enquiry', 'Just reached out'], ['In discussion', 'Talking about the job or price'], ['Booked', 'Job booked'], ['Done', 'Job finished'], ['Returning', 'Booked again'], ['Not going ahead', 'Not going ahead']],
};

/** The starting list for a business type. @param {unknown} industry @returns {LeadStatus[]} */
function template(industry) {
  const words = INDUSTRY_WORDS[String(industry || '')];
  return GENERAL.map((s, i) => (words ? { ...s, label: words[i][0], hint: words[i][1] } : { ...s }));
}

const CACHE_MS = 60 * 1000;
/** @type {Map<string, { list: LeadStatus[], expires: number }>} */
const cache = new Map();
/** @param {string} [biz] */
function clearCache(biz) { if (biz) cache.delete(biz); else cache.clear(); }

/** @param {any[]} rows @returns {LeadStatus[]} */
const sortList = (rows) => rows
  .map(r => ({ key: String(r.key), label: String(r.label), hint: r.hint ?? null, color: COLORS.includes(r.color) ? r.color : 'slate', type: /** @type {StatusType} */ (TYPES.includes(r.type) ? r.type : 'new'), sort_order: Number(r.sort_order) || 0, active: r.active !== false }))
  .sort((a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key));

/**
 * The business's statuses in order (hidden ones included, flagged active=false). A business without a list yet
 * gets its industry's starting list saved. Before the SQL is run (no table): today's six, not saved.
 * @param {string} biz @param {{ fresh?: boolean }} [options] @returns {Promise<LeadStatus[]>}
 */
async function listFor(biz, { fresh = false } = {}) {
  const id = requireBusinessId(biz);
  const hit = cache.get(id);
  if (!fresh && hit && hit.expires > Date.now()) return hit.list;
  const r = await dbRequest(`lead_statuses?business_id=eq.${id}&select=key,label,hint,color,type,sort_order,active&order=sort_order.asc`);
  /** @type {LeadStatus[]} */
  let list;
  if (!r.ok || !Array.isArray(r.data)) {
    list = GENERAL.map(s => ({ ...s }));
  } else if (!r.data.length) {
    const b = await dbRequest(`businesses?id=eq.${id}&select=industry`);
    list = template(b.ok ? b.data?.[0]?.industry : null);
    await dbRequest('lead_statuses?on_conflict=business_id,key', {
      method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal',
      body: list.map(s => ({ business_id: id, ...s })),
    });
  } else {
    list = sortList(r.data);
  }
  cache.set(id, { list, expires: Date.now() + CACHE_MS });
  return list;
}

// ---------------------------------------------------------------------------
// The type mapping (pure)
// ---------------------------------------------------------------------------
/** The type of a status key (an unknown key counts as new). @param {LeadStatus[]} list @param {unknown} key @returns {StatusType} */
function typeOf(list, key) {
  const k = String(key || '');
  const s = list.find(x => x.key === k);
  if (s) return s.type;
  return TYPE_OF_LEGACY[k] || 'new';
}
/** The original key for a status's type (so type-based logic can keep using the six keys). @param {LeadStatus[]} list @param {unknown} key */
const canonicalStage = (list, key) => LEGACY_KEY[typeOf(list, key)];
/** Does this status count as a conversion? @param {LeadStatus[]} list @param {unknown} key */
const isConverted = (list, key) => CONVERTED_TYPES.includes(typeOf(list, key));
/** First active status of a type (by order), else null. @param {LeadStatus[]} list @param {StatusType} type */
function firstOfType(list, type) {
  const s = list.find(x => x.active && x.type === type);
  return s ? s.key : null;
}
/** Is this a status of the business (hidden ones included)? @param {LeadStatus[]} list @param {unknown} key */
const isKnown = (list, key) => list.some(x => x.key === String(key || ''));
/**
 * Lead rows with `stage` replaced by the original key of its type (for type-based counting code). Pure.
 * @template {{ stage?: unknown }} T @param {LeadStatus[]} list @param {T[]} leads @returns {T[]}
 */
const byType = (list, leads) => leads.map(l => ({ ...l, stage: canonicalStage(list, l.stage) }));
/**
 * Pipeline counts per status of the business (active ones, plus hidden ones that still hold chats). Pure.
 * @param {LeadStatus[]} list @param {Array<{ stage?: unknown }>} leads
 */
function pipelineCounts(list, leads) {
  /** @type {Record<string, number>} */
  const n = {};
  const entry = list.find(s => s.key === 'new')?.key || list[0]?.key || 'new';
  for (const l of leads) { const k = isKnown(list, l.stage) ? String(l.stage) : entry; n[k] = (n[k] || 0) + 1; }
  return list.filter(s => s.active || n[s.key]).map(s => ({ stage: s.key, label: s.label, color: s.color, type: s.type, count: n[s.key] || 0 }));
}

// ---------------------------------------------------------------------------
// Managers and the Business Admin edit the list
// ---------------------------------------------------------------------------
/** @param {Staff} staff @param {string} action @param {Record<string, unknown>} details */
const audit = (staff, action, details) => dbRequest('audit_log', {
  method: 'POST', prefer: 'return=minimal',
  body: { business_id: staff.businessId, actor_email: staff.email, actor_role: staff.role, action, details },
});
/** @param {Staff} staff */
const denied = (staff) => (isManagerOrOwner(staff?.role) ? null : { error: 'Only managers and the Business Admin can change lead statuses.', status: 403 });
/** @param {unknown} v */
const cleanLabel = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Chats per status key, for the settings screen (counts only). @param {string} biz @param {LeadStatus[]} list */
async function chatCounts(biz, list) {
  const counts = await Promise.all(list.map(s => countRows('whatsapp_leads', `business_id=eq.${biz}&stage=eq.${encodeURIComponent(s.key)}`)));
  return Object.fromEntries(list.map((s, i) => [s.key, counts[i] ?? 0]));
}

/** Any staff: the list (+ chat counts for managers). @param {Staff} staff */
async function view(staff) {
  const biz = requireBusinessId(staff?.businessId);
  const list = await listFor(biz);
  return {
    statuses: list,
    types: TYPES.map(t => ({ key: t, label: TYPE_LABEL[t] })),
    colors: COLORS,
    max: MAX_STATUSES,
    ...(isManagerOrOwner(staff.role) ? { counts: await chatCounts(biz, list) } : {}),
  };
}

/** Check a label/colour/type change against the list. @param {LeadStatus[]} list @param {string | null} key @param {Record<string, unknown>} input */
function checkFields(list, key, input) {
  /** @type {Partial<LeadStatus>} */
  const out = {};
  if ('label' in input) {
    const label = cleanLabel(input.label);
    if (label.length < 1 || label.length > 30) return { error: 'A status name must be 1 to 30 characters.' };
    if (list.some(s => s.key !== key && s.label.toLowerCase() === label.toLowerCase())) return { error: `There is already a status called "${label}".` };
    out.label = label;
  }
  if ('hint' in input) {
    const hint = cleanLabel(input.hint).slice(0, 120);
    out.hint = hint || null;
  }
  if ('color' in input) {
    if (!COLORS.includes(String(input.color))) return { error: 'Choose one of the colours.' };
    out.color = String(input.color);
  }
  if ('type' in input) {
    if (!TYPES.includes(/** @type {StatusType} */ (input.type))) return { error: 'Choose what kind of status it is.' };
    if (key === 'new' && input.type !== 'new') return { error: 'The first status (where new chats start) is always of type New.' };
    out.type = /** @type {StatusType} */ (input.type);
  }
  if ('active' in input) {
    if (key === 'new' && input.active === false) return { error: 'New chats start in this status, so it can\'t be hidden. Rename it instead.' };
    out.active = !!input.active;
  }
  return { fields: out };
}

/** Rules that must hold for the whole list. @param {LeadStatus[]} list */
function listProblem(list) {
  if (!list.some(s => s.active && s.type === 'new')) return 'Keep at least one visible status of type New.';
  return null;
}

/** @param {Staff} staff @param {Record<string, unknown>} input */
async function add(staff, input = {}) {
  const no = denied(staff); if (no) return no;
  const biz = requireBusinessId(staff.businessId);
  const list = await listFor(biz, { fresh: true });
  if (list.length >= MAX_STATUSES) return { error: `A business can have up to ${MAX_STATUSES} statuses. Hide or remove one first.` };
  const checked = checkFields(list, null, { color: 'teal', type: 'working', ...input, label: input.label ?? '' });
  if ('error' in checked) return checked;
  const key = `s_${crypto.randomBytes(4).toString('hex').slice(0, 6)}`;
  const status = { key, label: '', hint: null, color: 'teal', type: /** @type {StatusType} */ ('working'), active: true, ...checked.fields, sort_order: Math.max(0, ...list.map(s => s.sort_order)) + 1 };
  const r = await dbRequest('lead_statuses', { method: 'POST', prefer: 'return=minimal', body: { business_id: biz, ...status } });
  if (!r.ok) return { error: 'Could not add the status. Has the lead statuses SQL (20261134) been run?' };
  clearCache(biz);
  await audit(staff, 'lead_status.added', { label: status.label, type: status.type });
  return { status, statuses: await listFor(biz) };
}

/** @param {Staff} staff @param {unknown} rawKey @param {Record<string, unknown>} input */
async function update(staff, rawKey, input = {}) {
  const no = denied(staff); if (no) return no;
  const biz = requireBusinessId(staff.businessId);
  const key = String(rawKey || '');
  const list = await listFor(biz, { fresh: true });
  const current = list.find(s => s.key === key);
  if (!current) return { error: 'Status not found.', status: 404 };
  const checked = checkFields(list, key, input);
  if ('error' in checked) return checked;
  if (!Object.keys(checked.fields).length) return { error: 'Nothing to change.' };
  const next = list.map(s => (s.key === key ? { ...s, ...checked.fields } : s));
  const problem = listProblem(next); if (problem) return { error: problem };
  const r = await dbRequest(`lead_statuses?business_id=eq.${biz}&key=eq.${encodeURIComponent(key)}`, { method: 'PATCH', prefer: 'return=minimal', body: { ...checked.fields, updated_at: new Date().toISOString() } });
  if (!r.ok) return { error: 'Could not save the status.' };
  clearCache(biz);
  await audit(staff, 'lead_status.updated', { status: current.label, fields: Object.keys(checked.fields), ...(checked.fields.label ? { newLabel: checked.fields.label } : {}) });
  return { statuses: await listFor(biz) };
}

/** New order: every key of the business, once. @param {Staff} staff @param {unknown} keys */
async function reorder(staff, keys) {
  const no = denied(staff); if (no) return no;
  const biz = requireBusinessId(staff.businessId);
  const list = await listFor(biz, { fresh: true });
  const order = Array.isArray(keys) ? keys.map(String) : [];
  if (order.length !== list.length || new Set(order).size !== order.length || !order.every(k => isKnown(list, k))) return { error: 'Send every status once, in the new order.' };
  for (let i = 0; i < order.length; i++) {
    const r = await dbRequest(`lead_statuses?business_id=eq.${biz}&key=eq.${encodeURIComponent(order[i])}`, { method: 'PATCH', prefer: 'return=minimal', body: { sort_order: i + 1, updated_at: new Date().toISOString() } });
    if (!r.ok) return { error: 'Could not save the order.' };
  }
  clearCache(biz);
  await audit(staff, 'lead_status.reordered', { order: order.map(k => list.find(s => s.key === k)?.label) });
  return { statuses: await listFor(biz) };
}

/**
 * Remove a status. If chats still have it, `moveTo` (another status key) must be given: they move there first.
 * The built-in "new" status can't be removed. Never loses a chat.
 * @param {Staff} staff @param {unknown} rawKey @param {unknown} [moveTo]
 */
async function remove(staff, rawKey, moveTo) {
  const no = denied(staff); if (no) return no;
  const biz = requireBusinessId(staff.businessId);
  const key = String(rawKey || '');
  const list = await listFor(biz, { fresh: true });
  const current = list.find(s => s.key === key);
  if (!current) return { error: 'Status not found.', status: 404 };
  if (key === 'new') return { error: 'New chats start in this status, so it can\'t be removed. Rename it instead.' };
  const rest = list.filter(s => s.key !== key);
  const problem = listProblem(rest); if (problem) return { error: problem };
  const chats = (await countRows('whatsapp_leads', `business_id=eq.${biz}&stage=eq.${encodeURIComponent(key)}`)) ?? 0;
  /** @type {LeadStatus | undefined} */
  let target;
  if (chats > 0) {
    target = rest.find(s => s.key === String(moveTo || ''));
    if (!target) return { error: `${chats} chat${chats === 1 ? ' is' : 's are'} still in "${current.label}". Choose a status to move ${chats === 1 ? 'it' : 'them'} to first.`, status: 409, chats };
    const mv = await dbRequest(`whatsapp_leads?business_id=eq.${biz}&stage=eq.${encodeURIComponent(key)}`, { method: 'PATCH', prefer: 'return=minimal', body: { stage: target.key, stage_changed_at: new Date().toISOString() } });
    if (!mv.ok) return { error: 'Could not move the chats. Nothing was removed.' };
  }
  const r = await dbRequest(`lead_statuses?business_id=eq.${biz}&key=eq.${encodeURIComponent(key)}`, { method: 'DELETE', prefer: 'return=minimal' });
  if (!r.ok) return { error: 'Could not remove the status.' };
  clearCache(biz);
  await audit(staff, 'lead_status.removed', { label: current.label, movedChats: chats, ...(target ? { movedTo: target.label } : {}) });
  return { removed: true, movedChats: chats, statuses: await listFor(biz) };
}

module.exports = {
  TYPES, TYPE_LABEL, LEGACY_KEY, TYPE_OF_LEGACY, CONVERTED_TYPES, COLORS, MAX_STATUSES, KEY_RE, GENERAL,
  template, listFor, clearCache, typeOf, canonicalStage, isConverted, firstOfType, isKnown, byType, pipelineCounts,
  view, add, update, reorder, remove,
};
