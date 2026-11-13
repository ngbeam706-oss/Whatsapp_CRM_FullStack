// @ts-check
// Leads tools (docs/progress/leads-tools.md):
//   - filters shared by the Inbox and the Leads page (date range, status / type, source, ad, tag, assignee, unread,
//     WhatsApp number, Done, opted out, search)
//   - Leads page (managers + Business Admin): search, CSV export, permanent delete
//   - STOP suppression: a deleted lead that had opted out leaves a keyed hash of the number, so the number is marked
//     opted out again whenever it comes back (new message, Add lead, a pasted broadcast list).
// Tenancy: every query is scoped to the staff member's business_id; phone numbers travel in POST bodies, never URLs.
const crypto = require('crypto');
const { dbRequest, digits } = require('./db.cjs');
const { requireBusinessId, isManagerOrOwner } = require('./tenant.cjs');

/** @typedef {import('./types.cjs').Staff} Staff */
/** @typedef {Record<string, any>} Row */

const MAX_EXPORT = 50000;
const MAX_DELETE = 1000;
const PAGE = 1000;
const CHUNK = 100;
const IST_MS = 330 * 60000;
const RANGES = ['today', '2d', '7d', '30d', 'all', 'custom'];
const SOURCES_ADDED = ['Phone call', 'Walk-in', 'Referral', 'Website form', 'Other'];
const PHONE_RE = /^\d{7,15}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@,()]+@[^\s@,()]+$/;

// ---------------------------------------------------------------------------
// STOP suppression
// ---------------------------------------------------------------------------
/** Keyed hash of a business's customer number (the number itself is never stored). @param {string} biz @param {string} phone */
function phoneHash(biz, phone) {
  const key = (process.env.SETTINGS_ENCRYPTION_KEY || process.env.APP_SECRET || '').trim() || 'no-secret-configured';
  return crypto.createHmac('sha256', key).update(`${biz}:${digits(phone)}`).digest('hex');
}

/** Is this number suppressed for this business (deleted after STOP)? @param {string} biz @param {string} phone */
async function isSuppressed(biz, phone) {
  requireBusinessId(biz);
  if (!PHONE_RE.test(String(phone))) return false;
  const r = await dbRequest(`lead_suppressions?business_id=eq.${biz}&phone_hash=eq.${phoneHash(biz, phone)}&select=phone_hash`);
  return !!(r.ok && Array.isArray(r.data) && r.data.length);
}

/** The suppressed ones among some numbers. @param {string} biz @param {string[]} phones @returns {Promise<Set<string>>} */
async function suppressedAmong(biz, phones) {
  requireBusinessId(biz);
  const out = new Set();
  const list = [...new Set(phones.filter(p => PHONE_RE.test(String(p))))];
  for (let i = 0; i < list.length; i += CHUNK) {
    const chunk = list.slice(i, i + CHUNK);
    const byHash = new Map(chunk.map(p => [phoneHash(biz, p), p]));
    const r = await dbRequest(`lead_suppressions?business_id=eq.${biz}&phone_hash=in.(${[...byHash.keys()].join(',')})&select=phone_hash`);
    if (r.ok && Array.isArray(r.data)) for (const row of r.data) { const p = byHash.get(row.phone_hash); if (p) out.add(p); }
  }
  return out;
}

/** A suppressed number came back (new message, Add lead): mark its lead opted out again. @param {string} biz @param {string} phone */
async function reapply(biz, phone) {
  try {
    if (!(await isSuppressed(biz, phone))) return false;
    await dbRequest(`whatsapp_leads?business_id=eq.${biz}&phone=eq.${phone}`, { method: 'PATCH', prefer: 'return=minimal', body: { opted_out: true, opted_out_at: new Date().toISOString() } });
    return true;
  } catch { return false; }
}

/** The customer wrote START: they want messages again. @param {string} biz @param {string} phone */
async function unsuppress(biz, phone) {
  if (!PHONE_RE.test(String(phone))) return;
  await dbRequest(`lead_suppressions?business_id=eq.${requireBusinessId(biz)}&phone_hash=eq.${phoneHash(biz, phone)}`, { method: 'DELETE', prefer: 'return=minimal' });
}

// ---------------------------------------------------------------------------
// Filters (shared by the Inbox and the Leads page)
// ---------------------------------------------------------------------------
/**
 * @typedef {{ range: string, from: string, to: string, status: string, statusType: string, source: string, adId: string,
 *   tag: string, assignee: string, unread: boolean, number: string, closed: 'open' | 'closed' | 'any', optedOut: boolean, q: string }} Filters
 */
/** Clean what the browser sent (unknown values are dropped). @param {any} input @returns {Filters} */
function cleanFilters(input = {}) {
  const f = input && typeof input === 'object' ? input : {};
  const s = (/** @type {unknown} */ v, /** @type {number} */ max) => String(v ?? '').trim().slice(0, max);
  const range = RANGES.includes(f.range) ? f.range : 'all';
  return {
    range,
    from: DATE_RE.test(s(f.from, 10)) ? s(f.from, 10) : '',
    to: DATE_RE.test(s(f.to, 10)) ? s(f.to, 10) : '',
    status: /^[a-z][a-z0-9_]{0,39}$/.test(s(f.status, 40)) ? s(f.status, 40) : '',
    statusType: ['new', 'working', 'won', 'done', 'repeat', 'lost'].includes(f.statusType) ? f.statusType : '',
    source: s(f.source, 80),
    adId: /^\d{1,25}$/.test(s(f.adId, 25)) ? s(f.adId, 25) : '',
    tag: /^[a-z0-9\-_]{1,30}$/.test(s(f.tag, 30)) ? s(f.tag, 30) : '',
    assignee: s(f.assignee, 254).toLowerCase(),
    unread: f.unread === true || f.unread === 'true',
    number: /^\d{5,30}$/.test(s(f.number, 30)) ? s(f.number, 30) : '',
    closed: f.closed === 'closed' || f.closed === 'open' ? f.closed : 'any',
    optedOut: f.optedOut === true || f.optedOut === 'true',
    q: s(f.q, 40),
  };
}

/** Start of the India-time day `daysAgo` days back. @param {number} daysAgo @param {number} [now] */
function istDayStart(daysAgo, now = Date.now()) {
  const ist = new Date(now + IST_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_MS - daysAgo * 86400000).toISOString();
}

/** since / until (ISO) for a date range, by last activity. Pure. @param {Filters} f @param {number} [now] */
function rangeBounds(f, now = Date.now()) {
  if (f.range === 'today') return { since: istDayStart(0, now), until: '' };
  if (f.range === '2d') return { since: istDayStart(1, now), until: '' };
  if (f.range === '7d') return { since: istDayStart(6, now), until: '' };
  if (f.range === '30d') return { since: istDayStart(29, now), until: '' };
  if (f.range === 'custom') {
    return {
      since: f.from ? new Date(Date.parse(`${f.from}T00:00:00Z`) - IST_MS).toISOString() : '',
      until: f.to ? new Date(Date.parse(`${f.to}T00:00:00Z`) - IST_MS + 86400000).toISOString() : '',
    };
  }
  return { since: '', until: '' };
}

/**
 * PostgREST pieces for the filters: `parts` (and-ed query params) and `ors` (groups, one `or` each).
 * Agents can filter on "me" / "unassigned" only. The caller adds business_id and the Done (closed_at) part.
 * @param {string} biz @param {Filters} f @param {{ staffEmail?: string, isManager?: boolean }} ctx
 */
async function filterParts(biz, f, { staffEmail = '', isManager = false } = {}) {
  /** @type {string[]} */
  const parts = [];
  /** @type {string[]} */
  const ors = [];
  const { since, until } = rangeBounds(f);
  if (since) parts.push(`last_contacted_at=gte.${encodeURIComponent(since)}`);
  if (until) parts.push(`last_contacted_at=lt.${encodeURIComponent(until)}`);
  if (f.status) parts.push(`stage=eq.${f.status}`);
  else if (f.statusType) {
    const ls = require('./leadStatuses.cjs');
    const keys = (await ls.listFor(biz)).filter(s => s.type === f.statusType).map(s => s.key);
    parts.push(`stage=in.(${keys.length ? keys.join(',') : '__none__'})`);
  }
  if (f.source) parts.push(`source=eq.${encodeURIComponent(f.source)}`);
  if (f.adId) ors.push(`or(first_ad_id.eq.${f.adId},last_ad_id.eq.${f.adId})`);
  if (f.tag) parts.push(`tags=cs.%7B${f.tag}%7D`);
  if (f.assignee === 'me' && staffEmail) parts.push(`assigned_to=eq.${encodeURIComponent(String(staffEmail).toLowerCase())}`);
  else if (f.assignee === 'unassigned') parts.push('assigned_to=is.null');
  else if (isManager && EMAIL_RE.test(f.assignee)) parts.push(`assigned_to=eq.${encodeURIComponent(f.assignee)}`);
  if (f.unread) parts.push('unread_count=gt.0');
  if (f.optedOut) parts.push('opted_out=is.true');
  if (f.number) {
    // Contacts from before several numbers (no number recorded) belong to the main number.
    const main = await require('./whatsapp.cjs').getWhatsApp(biz);
    if (main && String(main.phoneNumberId) === f.number) ors.push(`or(last_phone_number_id.eq.${f.number},last_phone_number_id.is.null)`);
    else parts.push(`last_phone_number_id=eq.${f.number}`);
  }
  const search = f.q.replace(/[^\p{L}\p{N} +]/gu, '').slice(0, 40);
  if (search) {
    const term = encodeURIComponent(`*${search}*`);
    const phoneTerm = encodeURIComponent(`*${digits(search) || search}*`);
    ors.push(`or(name.ilike.${term},phone.ilike.${phoneTerm})`);
  }
  return { parts, ors };
}

/** The `or` groups as query params (PostgREST allows one `or` per query, so several go in `and`). @param {string[]} ors */
const orParams = (ors) => (ors.length === 1 ? [ors[0].replace(/^or\(/, 'or=(')] : ors.length > 1 ? [`and=(${ors.join(',')})`] : []);

/** The closed (Done) part, only when the column exists. @param {Filters} f */
function closedPart(f) {
  const inbox = require('./inbox.cjs');
  const ready = typeof inbox.closeColumnsReady === 'function' ? inbox.closeColumnsReady() : true;
  if (!ready || f.closed === 'any') return [];
  return [f.closed === 'closed' ? 'closed_at=not.is.null' : 'closed_at=is.null'];
}

/** Values the filter menus offer (sources, tags, ads), from this business's leads only. @param {Staff} staff */
async function filterOptions(staff) {
  const biz = requireBusinessId(staff?.businessId);
  const r = await dbRequest(`whatsapp_leads?business_id=eq.${biz}&select=source,tags,first_ad_id,first_ad_headline,last_ad_id,last_ad_headline&limit=20000`);
  /** @type {Row[]} */
  const rows = r.ok && Array.isArray(r.data) ? r.data : [];
  const sources = new Set(SOURCES_ADDED);
  const tags = new Set();
  /** @type {Map<string, string>} */
  const ads = new Map();
  for (const l of rows) {
    if (l.source) sources.add(String(l.source));
    for (const t of l.tags || []) tags.add(String(t));
    if (l.first_ad_id) ads.set(String(l.first_ad_id), l.first_ad_headline || ads.get(String(l.first_ad_id)) || '');
    if (l.last_ad_id) ads.set(String(l.last_ad_id), l.last_ad_headline || ads.get(String(l.last_ad_id)) || '');
  }
  return {
    sources: [...sources].sort((a, b) => a.localeCompare(b)),
    tags: [...tags].sort(),
    ads: [...ads.entries()].map(([id, headline]) => ({ id, headline: headline || `Ad ${id}` })),
    addSources: SOURCES_ADDED,
  };
}

// ---------------------------------------------------------------------------
// Leads page (managers + Business Admin)
// ---------------------------------------------------------------------------
const LIST_FIELDS = 'phone,name,stage,source,tags,assigned_to,created_at,last_contacted_at,opted_out,first_ad_id,first_ad_headline,last_ad_id,last_ad_headline,unread_count';
/** @param {Staff} staff */
const denied = (staff) => (isManagerOrOwner(staff?.role) ? null : { error: 'Only managers and the Business Admin can use the Leads page.', status: 403 });

/** Every lead matching (up to `max`), in pages. @param {Staff} staff @param {Filters} f @param {string} fields @param {number} max */
async function matching(staff, f, fields, max) {
  const biz = requireBusinessId(staff.businessId);
  const { parts, ors } = await filterParts(biz, f, { staffEmail: staff.email, isManager: true });
  /** @type {Row[]} */
  const rows = [];
  for (let offset = 0; offset < max; offset += PAGE) {
    const path = (/** @type {string[]} */ closed) => `whatsapp_leads?${[`business_id=eq.${biz}`, ...parts, ...orParams(ors), ...closed, `select=${fields}`, 'order=last_contacted_at.desc.nullslast,phone.asc', `limit=${Math.min(PAGE, max - offset)}`, `offset=${offset}`].join('&')}`;
    const closed = closedPart(f);
    let r = await dbRequest(path(closed));
    // Before the inbox SQL (20261132) there is no closed_at column: no Done filter then.
    if (!r.ok && closed.length) r = await dbRequest(path([]));
    if (!r.ok || !Array.isArray(r.data)) return { error: 'Could not load the leads.' };
    rows.push(...r.data);
    if (r.data.length < PAGE) break;
  }
  return { rows };
}

/** Selected numbers (from the body) that really are leads of this business. @param {string} biz @param {unknown} phones @param {string} fields */
async function selected(biz, phones, fields) {
  const list = [...new Set((Array.isArray(phones) ? phones : []).map(p => digits(p)).filter(p => PHONE_RE.test(p)))];
  /** @type {Row[]} */
  const rows = [];
  for (let i = 0; i < list.length; i += CHUNK) {
    const r = await dbRequest(`whatsapp_leads?business_id=eq.${biz}&phone=in.(${list.slice(i, i + CHUNK).join(',')})&select=${fields}`);
    if (!r.ok) return { error: 'Could not load the leads.' };
    rows.push(...r.data);
  }
  return { rows };
}

/** What the audit log keeps about the filters (never a search term, which may be a number or a name). @param {Filters} f */
const auditFilters = (f) => Object.fromEntries(Object.entries({ ...f, q: f.q ? '(search)' : '' }).filter(([, v]) => v !== '' && v !== false && v !== 'any' && v !== 'all'));

/** Leads page list: matching leads (first 500 shown) and the total. @param {Staff} staff @param {any} body */
async function search(staff, body = {}) {
  const no = denied(staff); if (no) return no;
  const f = cleanFilters(body.filters || {});
  const r = await matching(staff, f, LIST_FIELDS, MAX_EXPORT);
  if ('error' in r) return r;
  return { total: r.rows.length, leads: r.rows.slice(0, 500), capped: r.rows.length >= MAX_EXPORT };
}

// ---- CSV ------------------------------------------------------------------------------------
/** One CSV cell: quoted when needed; a leading = + - @ (or tab / CR) gets a ' so Excel never runs it as a formula. @param {unknown} v */
function csvCell(v) {
  let s = v === null || v === undefined ? '' : Array.isArray(v) ? v.join(' ') : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
/** Rows to CSV text with a UTF-8 BOM (Excel opens Telugu and ₹ correctly). @param {string[]} header @param {unknown[][]} rows */
const toCsv = (header, rows) => `﻿${[header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n')}\r\n`;

/** @type {Record<string, { label: string, get: (l: Row, ctx: { statuses: any[], notes: Map<string, number> }) => unknown }>} */
const COLUMNS = {
  name: { label: 'Name', get: l => l.name },
  phone: { label: 'Phone', get: l => (l.phone ? `+${l.phone}` : '') },
  status: { label: 'Status', get: (l, c) => c.statuses.find(s => s.key === l.stage)?.label || l.stage },
  statusType: { label: 'Status type', get: (l, c) => require('./leadStatuses.cjs').typeOf(c.statuses, l.stage) },
  source: { label: 'Source', get: l => l.source },
  ad: { label: 'Ad', get: l => l.last_ad_headline || l.first_ad_headline || l.last_ad_id || l.first_ad_id || '' },
  tags: { label: 'Tags', get: l => (l.tags || []).join(' ') },
  assigned: { label: 'Assigned to', get: l => l.assigned_to },
  optedOut: { label: 'Replied STOP', get: l => (l.opted_out ? 'yes' : '') },
  created: { label: 'Created', get: l => l.created_at },
  lastMessage: { label: 'Last message date', get: l => l.last_contacted_at },
  notes: { label: 'Notes', get: (l, c) => c.notes.get(l.phone) || 0 },
};
const DEFAULT_COLUMNS = ['name', 'phone', 'status', 'statusType', 'source', 'ad', 'tags', 'assigned', 'created', 'lastMessage', 'notes'];

/**
 * CSV of the selected leads (body.phones) or of everything matching body.filters (up to 50,000). Audited (who, how
 * many, which filters and columns; never the data).
 * @param {Staff} staff @param {any} body
 */
async function exportCsv(staff, body = {}) {
  const no = denied(staff); if (no) return no;
  const biz = requireBusinessId(staff.businessId);
  const f = cleanFilters(body.filters || {});
  const cols = (Array.isArray(body.columns) && body.columns.length ? body.columns : DEFAULT_COLUMNS).filter((/** @type {string} */ c) => c in COLUMNS);
  if (!cols.length) return { error: 'Choose at least one column.' };
  const bySelection = Array.isArray(body.phones) && body.phones.length > 0;
  const got = bySelection ? await selected(biz, body.phones, LIST_FIELDS) : await matching(staff, f, LIST_FIELDS, MAX_EXPORT);
  if ('error' in got) return got;
  const rows = got.rows.slice(0, MAX_EXPORT);
  /** @type {Map<string, number>} */
  const notes = new Map();
  if (cols.includes('notes')) {
    const phones = rows.map(l => l.phone);
    for (let i = 0; i < phones.length; i += CHUNK) {
      const r = await dbRequest(`lead_notes?business_id=eq.${biz}&phone=in.(${phones.slice(i, i + CHUNK).join(',')})&select=phone`);
      if (r.ok && Array.isArray(r.data)) for (const n of r.data) notes.set(n.phone, (notes.get(n.phone) || 0) + 1);
    }
  }
  const statuses = await require('./leadStatuses.cjs').listFor(biz);
  const csv = toCsv(cols.map((/** @type {string} */ c) => COLUMNS[c].label), rows.map(l => cols.map((/** @type {string} */ c) => COLUMNS[c].get(l, { statuses, notes }))));
  await audit(staff, 'leads.exported', { count: rows.length, selection: bySelection, ...(bySelection ? {} : { filters: auditFilters(f) }), columns: cols });
  return { csv, count: rows.length };
}

// ---- Delete -----------------------------------------------------------------------------------
/** @param {Staff} staff @param {string} action @param {Record<string, unknown>} details */
const audit = (staff, action, details) => dbRequest('audit_log', {
  method: 'POST', prefer: 'return=minimal',
  body: { business_id: staff.businessId, actor_email: staff.email, actor_role: staff.role, action, details },
});

/** Tables that hold a lead's data, by their phone column. */
const LEAD_DATA = [
  ['whatsapp_messages', 'contact_phone'], ['lead_notes', 'phone'], ['contact_events', 'phone'], ['automation_runs', 'phone'],
  ['campaign_recipients', 'phone'], ['lead_number_windows', 'phone'], ['whatsapp_calls', 'phone'], ['ad_conversions', 'phone'],
];

/**
 * Permanently delete leads of this business: the selected ones (body.phones) or everything matching body.filters.
 * body.confirmCount must equal how many will be deleted (the person typed it). At most 1,000 per action. Removes
 * messages, notes, events, follow-up / broadcast rows, call rows, files (inbox-media, call recordings) and unlinks
 * queries. A lead that had replied STOP leaves a suppression (keyed hash) so it is never messaged again. Audited.
 * @param {Staff} staff @param {any} body
 */
async function deleteLeads(staff, body = {}) {
  const no = denied(staff); if (no) return no;
  const biz = requireBusinessId(staff.businessId);
  const f = cleanFilters(body.filters || {});
  const bySelection = Array.isArray(body.phones) && body.phones.length > 0;
  const got = bySelection ? await selected(biz, body.phones, 'phone,opted_out') : await matching(staff, f, 'phone,opted_out', MAX_DELETE + 1);
  if ('error' in got) return got;
  const leads = got.rows;
  if (!leads.length) return { error: 'No leads match.', status: 404 };
  if (leads.length > MAX_DELETE) return { error: `That is more than ${MAX_DELETE.toLocaleString('en-IN')} leads. Narrow the filters and delete in parts.`, status: 400 };
  if (Number(body.confirmCount) !== leads.length) return { error: `Type ${leads.length} to confirm.`, status: 400, count: leads.length };

  const phones = leads.map(l => String(l.phone));
  const storage = require('./storage.cjs');
  // STOP numbers: remembered (hash only) before anything is removed.
  const stopped = leads.filter(l => l.opted_out).map(l => String(l.phone));
  if (stopped.length) {
    const sup = await dbRequest('lead_suppressions?on_conflict=business_id,phone_hash', {
      method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal',
      body: stopped.map(p => ({ business_id: biz, phone_hash: phoneHash(biz, p), reason: 'stop', created_by: staff.email })),
    });
    if (!sup.ok) return { error: 'Could not keep the STOP list. Has the leads tools SQL (20261135) been run? Nothing was deleted.' };
  }
  for (let i = 0; i < phones.length; i += CHUNK) {
    const list = phones.slice(i, i + CHUNK).join(',');
    // Files first (only paths in this business's folder).
    const media = await dbRequest(`whatsapp_messages?business_id=eq.${biz}&contact_phone=in.(${list})&media_path=not.is.null&select=media_path`);
    const files = (media.ok && Array.isArray(media.data) ? media.data : []).map((/** @type {Row} */ m) => String(m.media_path)).filter(p => p.startsWith(`${biz}/`));
    if (files.length) await storage.remove('inbox-media', files);
    const rec = await dbRequest(`whatsapp_calls?business_id=eq.${biz}&phone=in.(${list})&recording_path=not.is.null&select=recording_path`);
    const recs = (rec.ok && Array.isArray(rec.data) ? rec.data : []).map((/** @type {Row} */ c) => String(c.recording_path)).filter(p => p.startsWith(`${biz}/`));
    if (recs.length) await storage.remove('wa-call-recordings', recs);
    for (const [table, col] of LEAD_DATA) {
      await dbRequest(`${table}?business_id=eq.${biz}&${col}=in.(${list})`, { method: 'DELETE', prefer: 'return=minimal' });
    }
    // Queries stay (they are the team's record) but no longer point at the deleted contact.
    await dbRequest(`queries?business_id=eq.${biz}&contact_phone=in.(${list})`, { method: 'PATCH', prefer: 'return=minimal', body: { contact_phone: null } });
    const del = await dbRequest(`whatsapp_leads?business_id=eq.${biz}&phone=in.(${list})`, { method: 'DELETE', prefer: 'return=minimal' });
    if (!del.ok) return { error: 'Some leads could not be deleted. Try again.', deleted: i };
  }
  await audit(staff, 'leads.deleted', { count: phones.length, keptStop: stopped.length, selection: bySelection, ...(bySelection ? {} : { filters: auditFilters(f) }) });
  return { deleted: phones.length, suppressed: stopped.length };
}

module.exports = {
  MAX_EXPORT, MAX_DELETE, SOURCES_ADDED, COLUMNS, DEFAULT_COLUMNS,
  phoneHash, isSuppressed, suppressedAmong, reapply, unsuppress,
  cleanFilters, rangeBounds, istDayStart, filterParts, orParams, filterOptions,
  search, exportCsv, deleteLeads, csvCell, toCsv,
};
