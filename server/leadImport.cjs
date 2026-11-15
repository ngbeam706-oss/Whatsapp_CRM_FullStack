// @ts-check
// Customer import, phase D2 (docs/progress/customer-import.md): upload -> map -> check -> import -> undo.
//
// The browser reads the CSV / Excel file and sends only clean, mapped rows (never the file), at most 500 per request.
// The server re-checks every row: phone cleaning, types of custom fields, statuses, team members, STOP list, plan
// limits. Matching is by phone number only (unique per business), never by name.
//   POST /imports/check            dry run of up to 500 rows: nothing is saved
//   POST /imports/start            the import record (+ new custom fields); one import at a time per business
//   POST /imports/:id/batch        up to 500 rows: new people created, existing ones filled / overwritten / skipped
//   POST /imports/:id/finish       done (or stopped)
//   GET  /imports                  history + limits;  POST /imports/:id/undo (7 days)
// Imported people who never chatted stay out of the Inbox and Pipeline (Leads page filter "Imported, not chatted yet").
// Plan limits: max_import_rows_per_file, max_import_file_mb, max_import_rows_month (new people / month), and
// max_contacts (imported people count as contacts). Audited without the data. Managers and the Business Admin only.
const { dbRequest } = require('./db.cjs');
const { requireBusinessId, isManagerOrOwner } = require('./tenant.cjs');
const cf = require('./customFields.cjs');

/** @typedef {import('./types.cjs').Staff} Staff */
/** @typedef {import('./customFields.cjs').Field} Field */
/** @typedef {Record<string, any>} Row */
/** @typedef {'fill' | 'overwrite' | 'skip'} Mode */
/** @typedef {{ row: number, phone?: string, kind: 'new' | 'existing' | 'unchanged' | 'skip' | 'invalid' | 'duplicate' | 'over_limit', stop?: boolean, reason?: string }} RowResult */

const BATCH = 500;
const MAX_COLUMNS = 60;
const MAX_CELL = 500;
const UNDO_DAYS = 7;
const STALE_MS = 30 * 60000;      // a "running" import with no batch for 30 minutes was abandoned
const CHUNK = 100;
const MODES = /** @type {Mode[]} */ (['fill', 'overwrite', 'skip']);
const TAG_RE = /^[a-z0-9\-_]{1,30}$/;
const OTHER_NUMBERS = { key: 'other_numbers', label: 'Other numbers', type: 'text' };
const LEAD_COLS = 'phone,name,name_set_by,name_set_at,stage,source,tags,assigned_to,custom,opted_out,imported_at,import_id,last_contacted_at';
/** Columns written back for people who already existed (the same set on every row, so one bulk upsert does a batch). */
const WRITE_COLS = ['name', 'name_set_by', 'name_set_at', 'stage', 'source', 'tags', 'assigned_to', 'custom'];

// ---------------------------------------------------------------------------
// Phone numbers
// ---------------------------------------------------------------------------
/**
 * One cell -> the customer's number in WhatsApp's form (country code + number, digits only). Pure.
 *   9876543210 / 09876543210 / +91 98765-43210 / 919876543210 -> 919876543210
 *   +44 7911 123456 / 00447911123456 -> 447911123456 (other countries need their country code)
 * Several numbers in one cell ("98765 43210 / 91234 56789"): the first is used, the rest come back in `more`.
 * @param {unknown} raw
 * @returns {{ phone: string, more: string[], error?: undefined } | { error: string, phone?: undefined, more?: undefined }}
 */
function cleanPhone(raw) {
  const cell = String(raw ?? '').trim();
  if (!cell) return { error: 'No phone number.' };
  if (cell.length > 200) return { error: 'The phone cell is too long.' };
  // Excel shows big numbers as 9.87654321E+9. Only when every digit is still there (as many decimals as the exponent)
  // is it a number; 9.18765E+11 lost its last digits, so it can't be trusted.
  const sci = cell.match(/^(\d)(?:\.(\d+))?e\+?(\d{1,2})$/i);
  if (sci && (sci[2] || '').length < Number(sci[3])) return { error: 'The number was shortened by Excel. Format the phone column as Text in Excel and save the file again.' };
  const text = sci ? `${sci[1]}${(sci[2] || '').padEnd(Number(sci[3]), '0')}` : cell;
  const parts = text.split(/[,;/|\n]|\s(?:or|and)\s|\s{2,}/i).map(s => s.trim()).filter(s => /\d/.test(s)).flatMap(splitJoined);
  if (!parts.length) return { error: 'No phone number.' };
  /** @type {string[]} */
  const cleaned = [];
  let firstError = '';
  for (const p of parts) {
    const one = cleanOne(p);
    if (one.error !== undefined) { if (!cleaned.length && !firstError) firstError = one.error; continue; }
    if (!cleaned.includes(one.phone)) cleaned.push(one.phone);
  }
  if (!cleaned.length) return { error: firstError || 'Not a phone number.' };
  // A cell with a bad first number but a good second one: still the first GOOD number.
  return { phone: cleaned[0], more: cleaned.slice(1) };
}

/**
 * Two numbers written with single spaces ("98765 43210 91234 56789"): split when the digits are clearly two Indian
 * mobiles (10 + 10, or 91… 12 + 12). Anything else stays one part. @param {string} p @returns {string[]}
 */
function splitJoined(p) {
  if (/^\s*(\+|00)/.test(p)) return [p];
  const d = p.replace(/\D/g, '');
  const mobile = (/** @type {string} */ n) => /^[6-9]\d{9}$/.test(n);
  if (d.length === 20 && mobile(d.slice(0, 10)) && mobile(d.slice(10))) return [d.slice(0, 10), d.slice(10)];
  if (d.length === 24 && d.startsWith('91') && d.slice(12).startsWith('91') && mobile(d.slice(2, 12)) && mobile(d.slice(14))) return [d.slice(0, 12), d.slice(12)];
  return [p];
}

/** @param {string} p @returns {{ phone: string, error?: undefined } | { error: string, phone?: undefined }} */
function cleanOne(p) {
  const plus = /^\s*(\+|00)/.test(p);
  if (/[a-z]/i.test(p.replace(/\b(ext|x)\b.*$/i, ''))) return { error: 'Not a phone number (has letters).' };
  let d = p.replace(/\D/g, '');
  if (p.trim().startsWith('00')) d = d.slice(2);
  const indianMobile = (/** @type {string} */ n) => /^[6-9]\d{9}$/.test(n);
  if (plus) {
    if (d.startsWith('91')) return indianMobile(d.slice(2)) ? { phone: d } : { error: 'Not an Indian mobile number (landline or wrong length).' };
    return d.length >= 8 && d.length <= 15 && !d.startsWith('0') ? { phone: d } : { error: 'Not a valid international number.' };
  }
  if (d.length === 10) return indianMobile(d) ? { phone: `91${d}` } : { error: 'Not a mobile number (Indian mobiles start with 6, 7, 8 or 9; landlines can\'t use WhatsApp here).' };
  if (d.length === 11 && d.startsWith('0')) return indianMobile(d.slice(1)) ? { phone: `91${d.slice(1)}` } : { error: 'Looks like a landline number.' };
  if (d.length === 12 && d.startsWith('91')) return indianMobile(d.slice(2)) ? { phone: d } : { error: 'Not an Indian mobile number.' };
  if (d.length < 10) return { error: 'Too short for a mobile number.' };
  if (d.length > 15) return { error: 'Too long for a phone number.' };
  // 11–15 digits, not Indian: taken as a number with its country code.
  return d.startsWith('0') ? { error: 'Add the country code (e.g. +44…).' } : { phone: d };
}

/** Tags from a cell: "VIP, Loan list" -> ['vip', 'loan-list']. @param {unknown} v @returns {string[]} */
function cleanTags(v) {
  const list = Array.isArray(v) ? v : String(v ?? '').split(/[,;]/);
  /** @type {string[]} */
  const out = [];
  for (const t of list) {
    const tag = String(t).trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-_]/g, '').slice(0, 30);
    if (TAG_RE.test(tag) && !out.includes(tag)) out.push(tag);
    if (out.length >= 10) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// One row
// ---------------------------------------------------------------------------
/**
 * @typedef {{ fields: Field[], statuses: Array<{ key: string, label: string, active?: boolean }>, staff: Set<string>, mode: Mode, tag: string }} Ctx
 * @typedef {{ row: number, phone: string, more: string[], name?: string, stage?: string, source?: string, tags: string[], assignedTo?: string, custom: Record<string, string | number | boolean> }} CleanRow
 */

/**
 * A mapped row from the browser checked and cleaned. Pure (given the context).
 * Input: { row, phone, name?, status?, source?, tags?, assignedTo?, custom?: { key: raw } }.
 * @param {Ctx} ctx @param {any} input
 * @returns {{ clean: CleanRow, error?: undefined } | { error: string, phone?: string, clean?: undefined }}
 */
function cleanRow(ctx, input) {
  const row = Number(input?.row) || 0;
  const p = cleanPhone(input?.phone);
  if (p.error !== undefined) return { error: p.error };
  for (const [k, v] of Object.entries(input || {})) {
    if (k === 'custom') continue;
    if (typeof v === 'string' && v.length > MAX_CELL) return { error: `A cell is longer than ${MAX_CELL} characters.`, phone: p.phone };
  }
  /** @type {CleanRow} */
  const clean = { row, phone: p.phone, more: p.more, tags: [], custom: {} };
  const s = (/** @type {unknown} */ v) => String(v ?? '').replace(/\s+/g, ' ').trim();
  if (s(input.name)) clean.name = s(input.name).slice(0, 120);
  if (s(input.status)) {
    const want = s(input.status).toLowerCase();
    const hit = ctx.statuses.find(x => x.key === want || x.label.toLowerCase() === want);
    if (!hit) return { error: `Unknown status "${s(input.status).slice(0, 30)}" (use one of your lead statuses).`, phone: p.phone };
    clean.stage = hit.key;
  }
  if (s(input.source)) clean.source = s(input.source).slice(0, 80);
  if (s(input.assignedTo)) {
    const email = s(input.assignedTo).toLowerCase();
    if (!ctx.staff.has(email)) return { error: `"${s(input.assignedTo).slice(0, 60)}" is not an email of someone in your team.`, phone: p.phone };
    clean.assignedTo = email;
  }
  clean.tags = cleanTags([...cleanTags(input.tags), ...(ctx.tag ? [ctx.tag] : [])]);
  const custom = input.custom && typeof input.custom === 'object' ? input.custom : {};
  if (Object.keys(custom).length > MAX_COLUMNS) return { error: `More than ${MAX_COLUMNS} columns.`, phone: p.phone };
  const { values, errors } = cf.cleanValues(ctx.fields, custom);
  if (errors.length) return { error: errors[0], phone: p.phone };
  for (const [k, v] of Object.entries(values)) if (v !== null) clean.custom[k] = v;
  if (cf.customBytes(clean.custom) > cf.MAX_CUSTOM_BYTES) return { error: 'Too much detail in this row (about 8 KB at most).', phone: p.phone };
  return { clean };
}

/**
 * What an import does to an existing person. Never erases: empty cells are not sent. Pure.
 * fill: only empty fields get a value (name, source, owner, custom fields; status stays). overwrite: given values win.
 * Tags are always added. Returns the changed columns, the old values and the values written (both for Undo: a value is
 * put back only while it still holds what the import wrote), or null when nothing changes.
 * @param {Row} lead @param {CleanRow} r @param {Mode} mode
 */
function changesFor(lead, r, mode) {
  if (mode === 'skip') return null;
  const over = mode === 'overwrite';
  /** @type {Record<string, any>} */
  const set = {};
  /** @type {Record<string, any>} */
  const cols = {};
  const put = (/** @type {string} */ col, /** @type {any} */ v) => { if (v !== undefined && v !== lead[col]) { set[col] = v; cols[col] = lead[col] ?? null; } };
  if (r.name && (over || !lead.name)) put('name', r.name);
  if (r.stage && over) put('stage', r.stage);
  if (r.source && (over || !lead.source)) put('source', r.source);
  if (r.assignedTo && (over || !lead.assigned_to)) put('assigned_to', r.assignedTo);
  const oldTags = Array.isArray(lead.tags) ? lead.tags : [];
  const tags = [...oldTags, ...r.tags.filter(t => !oldTags.includes(t))].slice(0, 30);
  if (tags.length !== oldTags.length) { set.tags = tags; cols.tags = oldTags; }
  const oldCustom = lead.custom && typeof lead.custom === 'object' ? lead.custom : {};
  /** @type {Record<string, any>} */
  const customBefore = {};
  /** @type {Record<string, any>} */
  const customSet = {};
  for (const [k, v] of Object.entries(r.custom)) {
    const has = oldCustom[k] !== undefined && oldCustom[k] !== null && oldCustom[k] !== '';
    if ((over || !has) && oldCustom[k] !== v) { customSet[k] = v; customBefore[k] = has ? oldCustom[k] : null; }
  }
  if (Object.keys(customSet).length) set.custom = cf.mergeCustom(oldCustom, customSet);
  if (!Object.keys(set).length) return null;
  if (set.custom && cf.customBytes(set.custom) > cf.MAX_CUSTOM_BYTES) return { error: 'Too much detail for this customer (about 8 KB at most).' };
  /** @type {Record<string, any>} */
  const afterCols = {};
  for (const c of Object.keys(cols)) afterCols[c] = set[c];
  return { set, before: { cols, custom: customBefore }, after: { cols: afterCols, custom: customSet } };
}

// ---------------------------------------------------------------------------
// Context, limits
// ---------------------------------------------------------------------------
/** @param {Staff} staff */
const denied = (staff) => (isManagerOrOwner(staff?.role) ? null : { error: 'Only managers and the Business Admin can import customers.', status: 403 });

/** @param {string} biz @param {Field[]} extraFields @param {any} options @returns {Promise<Ctx>} */
async function contextFor(biz, extraFields, options) {
  const fields = [...(await cf.listFor(biz, { fresh: true })), ...extraFields];
  const statuses = await require('./leadStatuses.cjs').listFor(biz);
  const team = await dbRequest(`staff_members?business_id=eq.${biz}&select=email`);
  const staff = new Set((team.ok && Array.isArray(team.data) ? team.data : []).map((/** @type {Row} */ s) => String(s.email).toLowerCase()));
  return { fields, statuses, staff, mode: MODES.includes(options?.mode) ? options.mode : 'fill', tag: cleanTags(options?.tag || '')[0] || '' };
}

/** New fields described by the wizard (not saved yet) as Field shapes, checked. @param {Field[]} existing @param {unknown} input */
function draftFields(existing, input) {
  const list = Array.isArray(input) ? input.slice(0, MAX_COLUMNS) : [];
  const taken = new Set(existing.map(f => f.key));
  /** @type {Array<Field & { sentKey: string }>} */
  const out = [];
  for (const f of list) {
    const label = String(f?.label ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!label) return { error: 'A new field has no name.' };
    if (!cf.TYPES.includes(f?.type)) return { error: `"${label}": choose a type.` };
    if (existing.some(x => x.label.toLowerCase() === label.toLowerCase()) || out.some(x => x.label.toLowerCase() === label.toLowerCase())) return { error: `There is already a field called "${label}". Map the column to it instead.` };
    const key = typeof f.key === 'string' && cf.KEY_RE.test(f.key) && !taken.has(f.key) ? f.key : cf.keyFromLabel(label, taken);
    taken.add(key);
    // sentKey: the key the browser used in its rows (renamed here when it was taken meanwhile).
    out.push({ key, sentKey: typeof f.key === 'string' ? f.key : key, label, type: f.type, options: f.type === 'choice' ? cf.cleanOptions(f.options) : [], private: !!f.private, hidden: false, sort_order: 0 });
  }
  return { fields: out };
}

/** "2026-11" month start in India time, as ISO. @param {number} [now] */
function monthStart(now = Date.now()) {
  const ist = new Date(now + 330 * 60000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - 330 * 60000).toISOString();
}

/** Plan limits and what is left: new people this month, contacts. @param {string} biz */
async function limitsFor(biz) {
  const limits = require('./limits.cjs');
  const { limits: l, planName } = await limits.getPlan(biz);
  const r = await dbRequest(`lead_imports?business_id=eq.${biz}&created_at=gte.${encodeURIComponent(monthStart())}&status=in.(running,done,stopped)&select=created_count`);
  const createdThisMonth = (r.ok && Array.isArray(r.data) ? r.data : []).reduce((n, x) => n + (Number(x.created_count) || 0), 0);
  const contacts = await limits.used(biz, 'contacts');
  const monthLeft = l.max_import_rows_month == null ? null : Math.max(l.max_import_rows_month - createdThisMonth, 0);
  const contactsLeft = l.max_contacts == null || contacts == null ? null : Math.max(l.max_contacts - contacts, 0);
  const left = monthLeft == null ? contactsLeft : contactsLeft == null ? monthLeft : Math.min(monthLeft, contactsLeft);
  return {
    planName,
    rowsPerFile: l.max_import_rows_per_file ?? null,
    fileMb: l.max_import_file_mb ?? null,
    rowsMonth: l.max_import_rows_month ?? null,
    createdThisMonth,
    monthLeft,
    contacts: l.max_contacts ?? null,
    contactsLeft,
    newLeft: left,
    newLeftReason: left == null ? '' : left === monthLeft ? `Your ${planName} plan allows ${fmt(l.max_import_rows_month || 0)} new people per month by import.` : `Your ${planName} plan allows ${fmt(l.max_contacts || 0)} contacts in all.`,
    maxColumns: MAX_COLUMNS,
    maxCell: MAX_CELL,
    batch: BATCH,
  };
}
/** @param {number} n */
const fmt = (n) => Number(n).toLocaleString('en-IN');

/** The leads among these numbers. @param {string} biz @param {string[]} phones @returns {Promise<Map<string, Row> | null>} */
async function leadsAmong(biz, phones) {
  /** @type {Map<string, Row>} */
  const out = new Map();
  for (let i = 0; i < phones.length; i += CHUNK) {
    const r = await dbRequest(`whatsapp_leads?business_id=eq.${biz}&phone=in.(${phones.slice(i, i + CHUNK).join(',')})&select=${LEAD_COLS}`);
    if (!r.ok || !Array.isArray(r.data)) return null;
    for (const l of r.data) out.set(String(l.phone), l);
  }
  return out;
}

/**
 * Classify a batch (shared by the dry run and the import). Nothing is saved. Rows over the plan limit (new people
 * beyond `newLeft`) are marked over_limit.
 * @param {string} biz @param {Ctx} ctx @param {any[]} rows @param {{ newLeft: number | null, importId?: string }} o
 */
async function classify(biz, ctx, rows, { newLeft, importId }) {
  /** @type {RowResult[]} */
  const results = [];
  /** @type {Array<{ clean: CleanRow, at: number }>} */
  const good = [];
  const seen = new Set();
  for (const input of rows) {
    const c = cleanRow(ctx, input);
    const row = Number(input?.row) || 0;
    if (c.error !== undefined) { results.push({ row, phone: c.phone, kind: 'invalid', reason: c.error }); continue; }
    if (seen.has(c.clean.phone)) { results.push({ row, phone: c.clean.phone, kind: 'duplicate', reason: 'The same number is on an earlier row of the file.' }); continue; }
    seen.add(c.clean.phone);
    good.push({ clean: c.clean, at: results.length });
    results.push({ row, phone: c.clean.phone, kind: 'new' });
  }
  const phones = good.map(g => g.clean.phone);
  const leads = await leadsAmong(biz, phones);
  if (!leads) return { error: 'Could not read your customers. Has the customer import SQL (20261142) been run?' };
  const stop = await require('./leadsTools.cjs').suppressedAmong(biz, phones);
  let left = newLeft;
  /** @type {Array<{ clean: CleanRow, lead?: Row, change?: any }>} */
  const plan = [];
  for (const g of good) {
    const res = results[g.at];
    const lead = leads.get(g.clean.phone);
    if (lead) {
      // Already created by THIS import (an earlier batch): the same number twice in the file.
      if (importId && lead.import_id === importId && lead.imported_at) { Object.assign(res, { kind: 'duplicate', reason: 'The same number is on an earlier row of the file.' }); continue; }
      if (ctx.mode === 'skip') { Object.assign(res, { kind: 'skip', reason: 'Already in your CRM (skipped).' }); continue; }
      const change = changesFor(lead, g.clean, ctx.mode);
      if (change && 'error' in change) { Object.assign(res, { kind: 'invalid', reason: change.error }); continue; }
      Object.assign(res, { kind: change ? 'existing' : 'unchanged', ...(change ? {} : { reason: 'Already in your CRM, nothing new.' }) });
      if (change) plan.push({ clean: g.clean, lead, change });
      continue;
    }
    if (left !== null && left <= 0) { Object.assign(res, { kind: 'over_limit', reason: 'Over your plan\'s limit for new people.' }); continue; }
    if (left !== null) left--;
    if (stop.has(g.clean.phone)) res.stop = true;
    plan.push({ clean: g.clean });
  }
  return { results, plan, stop };
}

/** Counts of a list of row results. @param {RowResult[]} results */
function countKinds(results) {
  /** @type {Record<string, number>} */
  const n = { new: 0, existing: 0, unchanged: 0, skip: 0, invalid: 0, duplicate: 0, over_limit: 0, stop: 0 };
  for (const r of results) { n[r.kind] = (n[r.kind] || 0) + 1; if (r.stop) n.stop++; }
  return n;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
/** @param {Staff} staff @param {string} action @param {Record<string, unknown>} details */
const audit = (staff, action, details) => dbRequest('audit_log', {
  method: 'POST', prefer: 'return=minimal',
  body: { business_id: staff.businessId, actor_email: staff.email, actor_role: staff.role, action, details },
});

/** @param {any} rows */
const badBatch = (rows) => (!Array.isArray(rows) || !rows.length ? 'No rows.' : rows.length > BATCH ? `At most ${BATCH} rows per request.` : '');

/** Rows from the browser with new-field keys renamed to the server's keys (sentKey -> key). @param {any[]} rows @param {Record<string, string>} map */
function renameKeys(rows, map) {
  if (!Object.keys(map).some(k => map[k] !== k)) return rows;
  return rows.map(r => {
    if (!r?.custom || typeof r.custom !== 'object') return r;
    /** @type {Record<string, unknown>} */
    const custom = {};
    for (const [k, v] of Object.entries(r.custom)) custom[map[k] || k] = v;
    return { ...r, custom };
  });
}

/** Can the extra numbers of a cell be kept ("Other numbers" field exists, or there is room for it)? @param {string} biz @param {number} adding */
async function otherNumbersRoom(biz, adding) {
  const fields = await cf.listFor(biz);
  if (fields.some(f => f.key === OTHER_NUMBERS.key)) return true;
  const { limits } = await require('./limits.cjs').getPlan(biz);
  return limits.max_custom_fields == null || fields.length + adding + 1 <= limits.max_custom_fields;
}

/** Dry run: classify up to 500 rows. Saves nothing. @param {Staff} staff @param {any} body { rows, newFields, options } */
async function check(staff, body = {}) {
  const no = denied(staff); if (no) return no;
  const biz = requireBusinessId(staff.businessId);
  if (!(await cf.importColumnsReady(biz))) return { error: 'Importing needs the database update (SQL 20261142). Ask the platform team.', status: 503 };
  const bad = badBatch(body.rows); if (bad) return { error: bad };
  const existing = await cf.listFor(biz, { fresh: true });
  const drafts = draftFields(existing, body.newFields);
  if (drafts.error !== undefined) return { error: drafts.error };
  const fieldsNew = /** @type {Array<Field & { sentKey: string }>} */ (drafts.fields);
  const ctx = await contextFor(biz, fieldsNew, body.options);
  const lim = await limitsFor(biz);
  const rows = renameKeys(body.rows, Object.fromEntries(fieldsNew.map(f => [f.sentKey, f.key])));
  const got = await classify(biz, ctx, rows, { newLeft: lim.newLeft });
  if (got.error !== undefined) return { error: got.error };
  const results = /** @type {RowResult[]} */ (got.results);
  const plan = /** @type {Array<{ clean: CleanRow }>} */ (got.plan);
  /** @type {string[]} */
  const warnings = [];
  const several = plan.filter(p => p.clean.more.length).length;
  if (several && !(await otherNumbersRoom(biz, fieldsNew.length))) {
    warnings.push(`${fmt(several)} row${several === 1 ? ' has' : 's have'} more than one number. Only the first is imported: your plan's customer-field limit leaves no room for an "Other numbers" field.`);
  }
  return { results, counts: countKinds(results), limits: lim, warnings, extraNumbers: several };
}

/** Running imports idle for 30 minutes are marked stopped (the browser was closed). @param {string} biz */
async function closeStale(biz) {
  const before = new Date(Date.now() - STALE_MS).toISOString();
  await dbRequest(`lead_imports?business_id=eq.${biz}&status=eq.running&updated_at=lt.${encodeURIComponent(before)}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'stopped', finished_at: new Date().toISOString(), batch_started_at: null } });
}

/**
 * Start an import: limits per file, file size (as the browser reports it), the consent tick, one at a time; creates
 * the new custom fields and answers the key of each (keyMap: the browser's key -> the saved key).
 * @param {Staff} staff @param {any} body { fileName, fileRows, fileBytes, rowFrom, rowTo, options: { mode, tag }, consent, newFields }
 */
async function start(staff, body = {}) {
  const no = denied(staff); if (no) return no;
  const biz = requireBusinessId(staff.businessId);
  if (!(await cf.importColumnsReady(biz))) return { error: 'Importing needs the database update (SQL 20261142). Ask the platform team.', status: 503 };
  if (body.consent !== true) return { error: 'Tick the box to confirm these people agreed to hear from your business.' };
  const fileName = String(body.fileName || '').replace(/[\\/]/g, '_').trim().slice(0, 200);
  if (!fileName || !/\.(csv|xlsx)$/i.test(fileName)) return { error: 'Only .csv and .xlsx files can be imported.' };
  const fileRows = Number(body.fileRows), rowFrom = Number(body.rowFrom), rowTo = Number(body.rowTo), fileBytes = Number(body.fileBytes);
  if (![fileRows, rowFrom, rowTo].every(Number.isInteger) || rowFrom < 1 || rowTo < rowFrom || rowTo > fileRows) return { error: 'The rows to import are not valid.' };
  const lim = await limitsFor(biz);
  if (lim.fileMb != null && Number.isFinite(fileBytes) && fileBytes > lim.fileMb * 1024 * 1024) return { error: `The file is bigger than your ${lim.planName} plan allows (${lim.fileMb} MB).`, status: 400 };
  if (lim.rowsPerFile != null && rowTo - rowFrom + 1 > lim.rowsPerFile) return { error: `Your ${lim.planName} plan allows ${fmt(lim.rowsPerFile)} rows per upload. Import rows ${fmt(rowFrom)}–${fmt(rowFrom + lim.rowsPerFile - 1)} now, then upload the same file again and continue from row ${fmt(rowFrom + lim.rowsPerFile)}.`, status: 400, rowsPerFile: lim.rowsPerFile };
  const options = { mode: MODES.includes(body.options?.mode) ? body.options.mode : 'fill', tag: cleanTags(body.options?.tag || '')[0] || '' };

  await closeStale(biz);
  const busy = await dbRequest(`lead_imports?business_id=eq.${biz}&status=eq.running&select=id,created_by`);
  if (busy.ok && Array.isArray(busy.data) && busy.data.length) return { error: `${busy.data[0].created_by} is importing right now. One import at a time: wait for it to finish.`, status: 409 };

  // New fields from the wizard (counted against max_custom_fields).
  const existing = await cf.listFor(biz, { fresh: true });
  const drafts = draftFields(existing, body.newFields);
  if (drafts.error !== undefined) return { error: drafts.error };
  const fieldsNew = /** @type {Array<Field & { sentKey: string }>} */ (drafts.fields);
  /** @type {Record<string, string>} */
  const keyMap = {};
  if (fieldsNew.length) {
    const added = await cf.addMany(staff, fieldsNew.map(f => ({ key: f.key, label: f.label, type: f.type, options: f.options, private: f.private })), { via: 'import' });
    if (added.error !== undefined) return added;
    // Each new field by the server's answer (never the browser's draft key, which someone may have taken meanwhile).
    for (const f of fieldsNew) {
      const saved = added.added.find(a => a.label.toLowerCase() === f.label.toLowerCase());
      if (!saved) return { error: `The field "${f.label}" could not be created. Try again.` };
      keyMap[f.sentKey] = saved.key;
    }
  }
  const r = await dbRequest('lead_imports', {
    method: 'POST', prefer: 'return=representation',
    body: { business_id: biz, file_name: fileName, file_rows: fileRows, row_from: rowFrom, row_to: rowTo, options, consent: true, created_by: staff.email },
  });
  if (!r.ok || !Array.isArray(r.data) || !r.data[0]) {
    return r.status === 409 ? { error: 'Another import is running. One import at a time.', status: 409 } : { error: 'Could not start the import. Try again.' };
  }
  const imp = r.data[0];
  await audit(staff, 'import.started', { importId: imp.id, fileName, rows: rowTo - rowFrom + 1, rowFrom, rowTo, mode: options.mode, tag: options.tag || null, consent: true, newFields: fieldsNew.length });
  return { import: publicImport(imp), keyMap, fields: await cf.listFor(biz, { fresh: true }), limits: lim };
}

/**
 * Write new values for existing people in one request: each row carries every WRITE_COLS column (its current value
 * where nothing changes), so PostgREST can upsert them together. Returns how many were written, or null on failure.
 * @param {string} biz @param {Array<{ lead: Row, set: Record<string, any> }>} items
 */
async function bulkSet(biz, items) {
  if (!items.length) return 0;
  const body = items.map(({ lead, set }) => {
    /** @type {Record<string, any>} */
    const row = { business_id: biz, phone: String(lead.phone) };
    for (const c of WRITE_COLS) row[c] = c in set ? set[c] : (lead[c] ?? (c === 'tags' ? [] : c === 'custom' ? {} : c === 'stage' ? 'new' : null));
    return row;
  });
  const r = await dbRequest('whatsapp_leads?on_conflict=business_id,phone', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body });
  return r.ok ? items.length : null;
}

/** @param {string} biz @param {unknown} id */
async function getImport(biz, id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
  const r = await dbRequest(`lead_imports?business_id=eq.${biz}&id=eq.${id}&select=*`);
  return r.ok && Array.isArray(r.data) ? r.data[0] || null : null;
}

/** "Other numbers" field for cells with several numbers (created on first need, if the plan allows). @param {Staff} staff @param {Ctx} ctx */
async function otherNumbersField(staff, ctx) {
  const have = ctx.fields.find(f => f.key === OTHER_NUMBERS.key);
  if (have) return have;
  const added = await cf.addMany(staff, [OTHER_NUMBERS], { via: 'import' });
  if (added.error !== undefined) return null;
  const f = added.fields.find(x => x.key === OTHER_NUMBERS.key) || null;
  if (f) ctx.fields.push(f);
  return f;
}

/** Atomic database call (SQL 20261142 functions); the first row or null. @param {string} fn @param {Record<string, unknown>} args */
async function rpcRow(fn, args) {
  const r = await dbRequest(`rpc/${fn}`, { method: 'POST', body: args });
  return r.ok && Array.isArray(r.data) && r.data[0] ? r.data[0] : null;
}

/**
 * Import up to 500 rows into a running import. One part at a time per import, never past its row range; counts are
 * added in the database. Re-checks everything; new people beyond the plan limit are refused.
 * @param {Staff} staff @param {unknown} id @param {any} body { rows }
 */
async function batch(staff, id, body = {}) {
  const no = denied(staff); if (no) return no;
  const biz = requireBusinessId(staff.businessId);
  const bad = badBatch(body.rows); if (bad) return { error: bad };
  const imp0 = await getImport(biz, id);
  if (!imp0) return { error: 'Import not found.', status: 404 };
  if (imp0.status !== 'running') return { error: 'This import has finished. Start a new one.', status: 409 };
  const range = imp0.row_to - imp0.row_from + 1;
  if ((imp0.rows_done || 0) + body.rows.length > range) return { error: `This part goes past the rows of this import (${fmt(range)} rows, ${fmt(imp0.rows_done || 0)} done). Start a new import for more rows.`, status: 400 };
  // Claim the import for this part (atomic): refused while another part is being saved or past the range.
  const imp = await rpcRow('lead_import_claim_batch', { p_business: biz, p_import: imp0.id, p_rows: body.rows.length });
  if (!imp) return { error: 'Another part of this import is still being saved. Wait a moment and try again.', status: 409 };

  const tally = { created: 0, updated: 0, skipped: 0, rejected: 0, rows: 0 };
  const release = () => rpcRow('lead_import_end_batch', { p_business: biz, p_import: imp.id, p_rows: tally.rows, p_created: tally.created, p_updated: tally.updated, p_skipped: tally.skipped, p_rejected: tally.rejected });
  try {
    const ctx = await contextFor(biz, [], imp.options);
    // After the claim: the counts of earlier parts are in, so the allowance is right.
    const lim = await limitsFor(biz);
    const got = await classify(biz, ctx, body.rows, { newLeft: lim.newLeft, importId: imp.id });
    if (got.error !== undefined) { await release(); return { error: got.error }; }
    const results = /** @type {RowResult[]} */ (got.results);
    const plan = /** @type {Array<{ clean: CleanRow, lead?: Row, change?: any }>} */ (got.plan);
    const stop = /** @type {Set<string>} */ (got.stop);
    const now = new Date().toISOString();
    const other = plan.some(p => p.clean.more.length) ? await otherNumbersField(staff, ctx) : null;
    const warnings = plan.some(p => p.clean.more.length) && !other ? ['Some rows had more than one number; only the first was imported (no room for an "Other numbers" field).'] : [];

    // New people: one insert (never overwrites: a number added meanwhile is left alone).
    const fresh = plan.filter(p => !p.lead).map(p => {
      const custom = { ...p.clean.custom, ...(other && p.clean.more.length ? { [other.key]: p.clean.more.map(n => `+${n}`).join(', ').slice(0, cf.MAX_VALUE) } : {}) };
      return {
        business_id: biz, phone: p.clean.phone, name: p.clean.name ?? null, name_set_by: p.clean.name ? staff.email : null, name_set_at: p.clean.name ? now : null,
        stage: p.clean.stage || 'new', stage_changed_at: now, source: p.clean.source || 'Imported', tags: p.clean.tags, assigned_to: p.clean.assignedTo ?? null,
        custom, opted_out: stop.has(p.clean.phone), imported_at: now, import_id: imp.id,
      };
    });
    /** @type {Array<{ phone: string, from?: string | null, to: string }>} */
    const statusChanges = [];
    if (fresh.length) {
      const ins = await dbRequest('whatsapp_leads?on_conflict=business_id,phone', { method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation', body: fresh });
      if (!ins.ok) { await release(); return { error: 'Could not save this part of the file. Press Import again to retry it.' }; }
      const made = new Set((Array.isArray(ins.data) ? ins.data : []).map((/** @type {Row} */ l) => String(l.phone)));
      tally.created = made.size;
      for (const r of results) if (r.kind === 'new' && r.phone && !made.has(r.phone)) Object.assign(r, { kind: 'unchanged', reason: 'Added by someone else a moment ago.' });
      for (const f of fresh) if (made.has(f.phone)) statusChanges.push({ phone: f.phone, from: null, to: f.stage });
    }

    // Existing people: old values AND the values written kept for Undo (first change per import wins), then the new values.
    const updates = plan.filter(p => p.lead && p.change);
    if (updates.length) {
      const keep = await dbRequest('lead_import_changes?on_conflict=import_id,phone', {
        method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal',
        body: updates.map(p => ({ import_id: imp.id, business_id: biz, phone: p.clean.phone, before: p.change.before, after: p.change.after })),
      });
      if (!keep.ok) { await release(); return { error: 'Could not keep the old values for Undo, so nothing in this part was changed. Try again.' }; }
      const items = updates.map(p => {
        /** @type {Record<string, any>} */
        let set = p.change.set;
        if (set.name) set = { ...set, name_set_by: staff.email, name_set_at: now };
        return { lead: /** @type {Row} */ (p.lead), set };
      });
      const n = await bulkSet(biz, items);
      if (n === null) { await release(); return { error: 'Could not save the changes to existing customers in this part. Press Import again to retry it.' }; }
      tally.updated = n;
      // A status changed by the import (overwrite mode): its time and the status history (source "import"). Imported
      // statuses are never reported to Meta as bookings: they did not come from an ad.
      const moved = updates.filter(p => p.change.set.stage !== undefined);
      if (moved.length) {
        const phones = moved.map(p => p.clean.phone);
        for (let i = 0; i < phones.length; i += CHUNK) {
          await dbRequest(`whatsapp_leads?business_id=eq.${biz}&phone=in.(${phones.slice(i, i + CHUNK).join(',')})`, { method: 'PATCH', prefer: 'return=minimal', body: { stage_changed_at: now } });
        }
        for (const p of moved) statusChanges.push({ phone: p.clean.phone, from: p.lead?.stage ?? null, to: p.change.set.stage });
      }
    }
    if (statusChanges.length) await require('./statusHistory.cjs').record(biz, statusChanges, { by: staff.email, source: 'import' });

    const counts = countKinds(results);
    const rejected = results.filter(r => ['invalid', 'duplicate', 'over_limit'].includes(r.kind));
    tally.skipped = counts.unchanged + counts.skip;
    tally.rejected = rejected.length;
    tally.rows = body.rows.length;
    await release();
    return { created: tally.created, updated: tally.updated, skipped: tally.skipped, rejected, stop: counts.stop, results, warnings };
  } catch (err) {
    await release();
    throw err;
  }
}

/** Done or stopped. Audited with the counts. @param {Staff} staff @param {unknown} id @param {any} body { stopped } */
async function finish(staff, id, body = {}) {
  const no = denied(staff); if (no) return no;
  const biz = requireBusinessId(staff.businessId);
  const imp = await getImport(biz, id);
  if (!imp) return { error: 'Import not found.', status: 404 };
  if (imp.status !== 'running') return { import: publicImport(imp) };
  const status = body.stopped ? 'stopped' : 'done';
  const r = await dbRequest(`lead_imports?business_id=eq.${biz}&id=eq.${imp.id}&status=eq.running`, { method: 'PATCH', prefer: 'return=representation', body: { status, finished_at: new Date().toISOString(), updated_at: new Date().toISOString(), batch_started_at: null } });
  const row = r.ok && Array.isArray(r.data) && r.data[0] ? r.data[0] : { ...imp, status };
  await audit(staff, 'import.finished', { importId: imp.id, status, created: row.created_count, updated: row.updated_count, skipped: row.skipped_count, rejected: row.rejected_count, rows: row.rows_done });
  return { import: publicImport(row) };
}

/** What the browser sees of an import (no data, counts only). @param {Row} i */
function publicImport(i) {
  const age = Date.now() - Date.parse(i.created_at || new Date().toISOString());
  return {
    id: i.id, fileName: i.file_name, fileRows: i.file_rows, rowFrom: i.row_from, rowTo: i.row_to, status: i.status,
    mode: i.options?.mode || 'fill', tag: i.options?.tag || '', created: i.created_count || 0, updated: i.updated_count || 0,
    skipped: i.skipped_count || 0, rejected: i.rejected_count || 0, rowsDone: i.rows_done || 0, by: i.created_by,
    createdAt: i.created_at, finishedAt: i.finished_at || null, undoneAt: i.undone_at || null, undoneBy: i.undone_by || null, undoResult: i.undo_result || null,
    canUndo: (i.status === 'done' || i.status === 'stopped') && age < UNDO_DAYS * 86400000 && !i.changes_pruned_at,
    undoUntil: new Date(Date.parse(i.created_at || new Date().toISOString()) + UNDO_DAYS * 86400000).toISOString(),
  };
}

/** History (latest 30) + limits. @param {Staff} staff */
async function list(staff) {
  const no = denied(staff); if (no) return no;
  const biz = requireBusinessId(staff.businessId);
  if (!(await cf.importColumnsReady(biz))) return { ready: false, imports: [], limits: null };
  await closeStale(biz);
  const r = await dbRequest(`lead_imports?business_id=eq.${biz}&select=*&order=created_at.desc&limit=30`);
  if (!r.ok) return { error: 'Could not load the imports.' };
  return { ready: true, imports: (Array.isArray(r.data) ? r.data : []).map(publicImport), limits: await limitsFor(biz), undoDays: UNDO_DAYS };
}

/** Same value (arrays and objects compared by content). @param {unknown} a @param {unknown} b */
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * What Undo puts back on one person: a column / custom value only while it still holds what the import wrote (so later
 * edits by the team or by another import stay). Pure.
 * @param {Row} lead @param {{ before?: any, after?: any }} change
 * @returns {{ set: Record<string, any>, keptChanged: boolean }}
 */
function undoSet(lead, change) {
  /** @type {Record<string, any>} */
  const set = {};
  let keptChanged = false;
  const after = change.after || {};
  for (const [k, old] of Object.entries(change.before?.cols || {})) {
    if (!WRITE_COLS.includes(k)) continue;
    if (after.cols && k in after.cols && !same(lead[k], after.cols[k])) { keptChanged = true; continue; }
    set[k] = old;
  }
  /** @type {Record<string, any>} */
  const custom = {};
  for (const [k, old] of Object.entries(change.before?.custom || {})) {
    if (after.custom && k in after.custom && !same(lead.custom?.[k], after.custom[k])) { keptChanged = true; continue; }
    custom[k] = old;
  }
  if (Object.keys(custom).length) set.custom = cf.mergeCustom(lead.custom || {}, custom);
  return { set, keptChanged };
}

/** Of these people, the ones with any message, broadcast, note, query or event (they are kept by Undo). @param {string} biz @param {string[]} phones */
async function withHistory(biz, phones) {
  const out = new Set();
  const checks = [['whatsapp_messages', 'contact_phone'], ['campaign_recipients', 'phone'], ['lead_notes', 'phone'], ['queries', 'contact_phone'], ['whatsapp_calls', 'phone']];
  for (let i = 0; i < phones.length; i += CHUNK) {
    const list = phones.slice(i, i + CHUNK).join(',');
    for (const [table, col] of checks) {
      const r = await dbRequest(`${table}?business_id=eq.${biz}&${col}=in.(${list})&select=${col}`);
      if (!r.ok) return null; // can't tell: keep everyone
      for (const row of Array.isArray(r.data) ? r.data : []) out.add(String(row[col]));
    }
  }
  return out;
}

/**
 * Undo (within 7 days): remove the people this import CREATED who have had no contact at all since (no message either
 * way, broadcast, note, query or call), with all their data; put back the fields it CHANGED on people who already
 * existed, where they still hold what the import wrote. Audited with counts.
 * @param {Staff} staff @param {unknown} id
 */
async function undo(staff, id) {
  const no = denied(staff); if (no) return no;
  const biz = requireBusinessId(staff.businessId);
  const imp = await getImport(biz, id);
  if (!imp) return { error: 'Import not found.', status: 404 };
  const pub = publicImport(imp);
  if (imp.status === 'undone') return { error: 'This import was already undone.', status: 409 };
  if (imp.status === 'running') return { error: 'Wait for the import to finish (or stop it) first.', status: 409 };
  if (!pub.canUndo) return { error: `Undo is possible for ${UNDO_DAYS} days after an import.`, status: 400 };

  // 1. Changed people: old values back, where nothing changed them since.
  const ch = await dbRequest(`lead_import_changes?business_id=eq.${biz}&import_id=eq.${imp.id}&select=phone,before,after`);
  if (!ch.ok) return { error: 'Could not read what the import changed.' };
  const changes = Array.isArray(ch.data) ? ch.data : [];
  let restored = 0, changedSince = 0;
  for (let i = 0; i < changes.length; i += BATCH) {
    const part = changes.slice(i, i + BATCH);
    const leads = await leadsAmong(biz, part.map((/** @type {Row} */ c) => String(c.phone)));
    if (!leads) return { error: 'Could not read your customers.' };
    /** @type {Array<{ lead: Row, set: Record<string, any> }>} */
    const items = [];
    for (const c of part) {
      const lead = leads.get(String(c.phone));
      if (!lead) continue;
      const u = undoSet(lead, c);
      if (u.keptChanged) changedSince++;
      if (Object.keys(u.set).length) items.push({ lead, set: u.set });
    }
    const n = await bulkSet(biz, items);
    if (n === null) return { error: 'Could not put back the changed fields. Try Undo again.' };
    restored += n;
  }
  // 2. Created people: removed with all their data, unless anyone has been in touch with them since.
  const made = await dbRequest(`whatsapp_leads?business_id=eq.${biz}&import_id=eq.${imp.id}&select=phone,last_contacted_at`);
  if (!made.ok) return { error: 'Could not read the imported people.' };
  const created = (Array.isArray(made.data) ? made.data : []);
  const touched = await withHistory(biz, created.map((/** @type {Row} */ l) => String(l.phone)));
  const remove = touched ? created.filter((/** @type {Row} */ l) => !l.last_contacted_at && !touched.has(String(l.phone))).map((/** @type {Row} */ l) => String(l.phone)) : [];
  const purged = await require('./leadsTools.cjs').purgeLeads(biz, remove);
  if (purged.error !== undefined) return { error: 'Could not remove all the imported people. Try Undo again.' };
  // Undo is done: its saved old values go too (they may hold private details).
  await dbRequest(`lead_import_changes?business_id=eq.${biz}&import_id=eq.${imp.id}`, { method: 'DELETE', prefer: 'return=minimal' });
  const now = new Date().toISOString();
  const result = { removed: remove.length, restored, kept: created.length - remove.length, changedSince };
  // created_count stays as history; the month's count leaves out undone imports (limitsFor).
  await dbRequest(`lead_imports?business_id=eq.${biz}&id=eq.${imp.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'undone', undone_at: now, undone_by: staff.email, undo_result: result, updated_at: now, changes_pruned_at: now } });
  await audit(staff, 'import.undone', { importId: imp.id, ...result });
  return { ...result, import: publicImport({ ...imp, status: 'undone', undone_at: now, undone_by: staff.email, undo_result: result }) };
}

/**
 * Worker (hourly): after the 7-day Undo window, an import's saved old values are deleted (they may hold private
 * details) and the import can no longer be undone. Returns how many imports were pruned.
 * @param {{ now?: number }} [o]
 */
async function pruneUndo({ now = Date.now() } = {}) {
  const cutoff = new Date(now - UNDO_DAYS * 86400000).toISOString();
  const r = await dbRequest(`lead_imports?changes_pruned_at=is.null&created_at=lt.${encodeURIComponent(cutoff)}&select=id,business_id&limit=200`);
  if (!r.ok || !Array.isArray(r.data)) return 0;
  let n = 0;
  for (const i of r.data) {
    const biz = requireBusinessId(i.business_id);
    const del = await dbRequest(`lead_import_changes?business_id=eq.${biz}&import_id=eq.${i.id}`, { method: 'DELETE', prefer: 'return=minimal' });
    if (!del.ok) continue;
    await dbRequest(`lead_imports?business_id=eq.${biz}&id=eq.${i.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { changes_pruned_at: new Date(now).toISOString() } });
    n++;
  }
  return n;
}

/**
 * Broadcasts and follow-ups don't move a chat in the Inbox (last_contacted_at), except for an imported person who was
 * never contacted: the first message to them makes them a contacted person (Inbox, Pipeline and Undo then treat them
 * like anyone else). One cheap filtered update; never fails the send.
 * @param {string} biz @param {string} phone
 */
async function markContacted(biz, phone) {
  try {
    if (!/^\d{7,15}$/.test(String(phone))) return;
    await dbRequest(`whatsapp_leads?business_id=eq.${requireBusinessId(biz)}&phone=eq.${phone}&imported_at=not.is.null&last_contacted_at=is.null`, { method: 'PATCH', prefer: 'return=minimal', body: { last_contacted_at: new Date().toISOString() } });
  } catch { /* best effort */ }
}

/**
 * The "Imported customer · <tag or file name>" badge (D3): adds import_name to every lead created by an import. One
 * read of this business's imports. Leads without import_id are returned as they are.
 * @template {Row} T @param {string} biz @param {T[]} leads @returns {Promise<T[]>}
 */
async function withImportNames(biz, leads) {
  const ids = [...new Set(leads.map(l => l.import_id).filter(id => /^[0-9a-f-]{36}$/i.test(String(id || ''))))];
  if (!ids.length) return leads;
  /** @type {Map<string, string>} */
  const names = new Map();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const r = await dbRequest(`lead_imports?business_id=eq.${requireBusinessId(biz)}&id=in.(${ids.slice(i, i + CHUNK).join(',')})&select=id,file_name,options`);
    for (const x of r.ok && Array.isArray(r.data) ? r.data : []) names.set(String(x.id), String(x.options?.tag || x.file_name || ''));
  }
  return leads.map(l => (l.import_id ? { ...l, import_name: names.get(String(l.import_id)) || 'an import' } : l));
}

/**
 * D3: an imported person writes for the first time (before = the lead as it was before this message).
 *   - a timeline note "First message after import", once (import_note_at, SQL 20261143; without it: only when this is
 *     their first message ever, which also happens once)
 *   - "imported customers go to the person named in their import" (Settings -> Lead assignment, off by default): that
 *     person keeps the chat if they can take it (available, on shift, under the cap); otherwise it is unassigned here
 *     and normal assignment runs next (webhook: assignIfDue). Off: as before, the import's owner keeps it.
 * No customer data leaves the server (no alert text). Never throws.
 * @param {string} biz @param {string} phone @param {Row | null} before @param {{ numberId?: string | null }} [o]
 */
async function onFirstMessage(biz, phone, before, { numberId = null } = {}) {
  try {
    if (!before || !before.imported_at || before.last_inbound_at) return { note: false, owner: 'none' };
    const id = requireBusinessId(biz);
    const base = `whatsapp_leads?business_id=eq.${id}&phone=eq.${phone}`;
    const now = new Date().toISOString();
    // Once per person: the first message after the import claims the note.
    const claim = await dbRequest(`${base}&import_note_at=is.null`, { method: 'PATCH', prefer: 'return=representation', body: { import_note_at: now } });
    const first = claim.ok ? Array.isArray(claim.data) && claim.data.length > 0 : true;
    /** @type {string[]} */
    const lines = [];
    let owner = 'none';
    const la = require('./leadAssignment.cjs');
    if (before.assigned_to && (await la.importOwnerFirst(id))) {
      const can = await la.canTake(id, before.assigned_to, numberId ? String(numberId) : '');
      if (can.ok) owner = 'kept';
      else if ((await la.assignmentMode(id)) === 'off') {
        // Automatic assignment is off: releasing would leave the chat with nobody. It stays with the named person.
        owner = 'kept_assignment_off';
        lines.push(`${before.assigned_to} (named in the import) can't take it now; it stays with them because automatic lead assignment is off.`);
      } else {
        await dbRequest(`${base}&assigned_to=eq.${encodeURIComponent(String(before.assigned_to))}`, { method: 'PATCH', prefer: 'return=minimal', body: { assigned_to: null } });
        owner = 'released';
        lines.push(`${before.assigned_to} (named in the import) can't take it now: it goes to the next person by lead assignment.`);
      }
    }
    if (first) {
      const [named] = await withImportNames(id, [before]);
      await dbRequest('lead_notes', { method: 'POST', prefer: 'return=minimal', body: { business_id: id, phone, author: 'import', body: [`First message after import${named.import_name ? ` (${named.import_name})` : ''}.`, ...lines].join(' ') } });
    }
    return { note: first, owner };
  } catch (err) {
    console.warn('[import] first message:', err instanceof Error ? err.message : err);
    return { note: false, owner: 'none' };
  }
}

module.exports = {
  withImportNames, onFirstMessage,
  BATCH, MAX_COLUMNS, MAX_CELL, UNDO_DAYS, MODES,
  cleanPhone, cleanTags, cleanRow, changesFor, draftFields, countKinds, monthStart, undoSet,
  limitsFor, check, start, batch, finish, list, undo, publicImport, pruneUndo, markContacted,
};
