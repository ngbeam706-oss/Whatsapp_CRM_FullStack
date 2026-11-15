// @ts-check
// Customer fields, phase D1 (docs/progress/customer-import.md): each business's own extra fields for its customers
// (CIBIL score, loan amount, EMI date…) and their values on each customer (whatsapp_leads.custom, SQL 20261142).
//
// - Settings -> Customer fields (Business Admin + managers): add / rename / reorder / hide; plan limit max_custom_fields.
// - Customer details card (chat side panel, Leads page): everyone sees normal fields; only the Business Admin and
//   managers see PRIVATE values (agents get "hidden") and only they edit, with lead ownership as today (ensureCanAct).
// - Private values are never given to the AI (aiFacts) and never put in alerts or notifications (nothing here sends any).
// - Values are checked by type on the server; at most 500 characters per value and ~8 KB per customer.
// Tenancy: every read and write is scoped to the staff member's business_id; numbers travel in POST bodies, never URLs.
const { dbRequest, digits } = require('./db.cjs');
const { requireBusinessId, isManagerOrOwner } = require('./tenant.cjs');

/** @typedef {import('./types.cjs').Staff} Staff */
/** @typedef {'text' | 'number' | 'amount' | 'date' | 'choice' | 'yesno'} FieldType */
/** @typedef {{ key: string, label: string, type: FieldType, options: string[], private: boolean, hidden: boolean, sort_order: number, show_on_card?: boolean }} Field */
/** @typedef {Record<string, string | number | boolean>} Custom */

const TYPES = /** @type {FieldType[]} */ (['text', 'number', 'amount', 'date', 'choice', 'yesno']);
const TYPE_LABEL = { text: 'Text', number: 'Number', amount: 'Amount (₹)', date: 'Date', choice: 'Choice (list)', yesno: 'Yes / No' };
const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
const MAX_VALUE = 500;          // characters per value
const MAX_CUSTOM_BYTES = 8192;  // per customer (the database allows a little more, as a backstop)
const MAX_OPTIONS = 50;
const MAX_FIELDS_HARD = 200;    // even with an unlimited plan
const PHONE_RE = /^\d{7,15}$/;
/** Column names that usually hold money, credit or ID details: the import wizard suggests "private" for them. */
const SENSITIVE_RE = /cibil|credit|score|income|salary|loan|emi|pan\b|pan[_ ]?(no|number|card)|aadha?ar|aadhar|bank|account|ifsc|insurance|policy|outstanding|dues?\b|balance|net ?worth|diagnos|medicine|prescription|disease|condition/i;

const CACHE_MS = 60 * 1000;
/** @type {Map<string, { at: number, fields: Field[] }>} */
const cache = new Map();
/** Forget cached fields (one business, or all). @param {string} [biz] */
const clearCache = (biz) => (biz ? cache.delete(biz) : cache.clear());

// ---------------------------------------------------------------------------
// Import columns (SQL 20261142) present? Checked once per 5 minutes, so the Inbox keeps working before the SQL.
// ---------------------------------------------------------------------------
let columnsCheckedAt = 0;
let columnsReady = false;
/** @param {string} biz  the asking business (every database call is scoped to one) */
async function importColumnsReady(biz) {
  if (Date.now() - columnsCheckedAt < 5 * 60000) return columnsReady;
  const r = await dbRequest(`whatsapp_leads?business_id=eq.${requireBusinessId(biz)}&select=imported_at,custom&limit=0`);
  columnsReady = !!r.ok;
  columnsCheckedAt = Date.now();
  return columnsReady;
}
/** Tests: forget the check. */
const _resetColumns = () => { columnsCheckedAt = 0; columnsReady = false; };

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------
/** A key from a label: "CIBIL score" -> cibil_score (unique among `taken`). @param {string} label @param {Iterable<string>} [taken] */
function keyFromLabel(label, taken = []) {
  const used = new Set(taken);
  let base = String(label || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 36);
  if (!base || !/^[a-z]/.test(base)) base = `f_${base}`.slice(0, 36).replace(/_+$/, '') || 'field';
  let key = base;
  for (let n = 2; used.has(key); n++) key = `${base}_${n}`;
  return key;
}

/** Does a column name look sensitive (money, credit, IDs, health)? @param {string} name */
const looksSensitive = (name) => SENSITIVE_RE.test(String(name || ''));

/** Choice options: trimmed, unique, at most 50 of up to 60 characters. @param {unknown} input @returns {string[]} */
function cleanOptions(input) {
  const list = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/[\n,]/) : [];
  /** @type {string[]} */
  const out = [];
  for (const o of list) {
    const s = String(o ?? '').trim().slice(0, 60);
    if (s && !out.some(x => x.toLowerCase() === s.toLowerCase())) out.push(s);
    if (out.length >= MAX_OPTIONS) break;
  }
  return out;
}

/** Parse a date written as 2026-12-05, 05/12/2026, 5-12-2026 or 05.12.26 (day first, India). @param {string} s @returns {string | null} */
function parseDate(s) {
  const t = String(s).trim();
  // An Excel date serial (a date cell that wasn't formatted as a date): days since 30 Dec 1899. 20000–80000 covers
  // 1954–2119, so ordinary numbers are not mistaken for dates.
  if (/^\d{5}(\.\d+)?$/.test(t) && Number(t) >= 20000 && Number(t) <= 80000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(t)) * 86400000).toISOString().slice(0, 10);
  }
  let y, m, d;
  let x = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  if (x) { y = +x[1]; m = +x[2]; d = +x[3]; }
  else if ((x = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/))) { d = +x[1]; m = +x[2]; y = +x[3]; if (y < 100) y += 2000; }
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d || y < 1900 || y > 2200) return null;
  return dt.toISOString().slice(0, 10);
}

/** A number written with Indian grouping, ₹, "Rs", spaces: "₹3,00,000" -> 300000. @param {unknown} v @returns {number | null} */
function parseNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v ?? '').trim().replace(/^(₹|rs\.?|inr)\s*/i, '').replace(/[,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && Math.abs(n) < 1e15 ? n : null;
}

/**
 * One value checked against its field's type. Empty = no value (null). Pure.
 * @param {Field} field @param {unknown} raw
 * @returns {{ value: string | number | boolean | null, error?: undefined } | { error: string, value?: undefined }}
 */
function cleanValue(field, raw) {
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return { value: null };
  const s = String(raw).trim();
  if (s.length > MAX_VALUE) return { error: `${field.label}: at most ${MAX_VALUE} characters.` };
  switch (field.type) {
    case 'text': return { value: s };
    case 'number': {
      const n = parseNumber(raw);
      return n === null ? { error: `${field.label}: "${s.slice(0, 30)}" is not a number.` } : { value: n };
    }
    case 'amount': {
      const n = parseNumber(raw);
      if (n === null || n < 0) return { error: `${field.label}: "${s.slice(0, 30)}" is not an amount in rupees.` };
      return { value: Math.round(n * 100) / 100 };
    }
    case 'date': {
      const d = parseDate(s);
      return d ? { value: d } : { error: `${field.label}: "${s.slice(0, 30)}" is not a date (use 05/12/2026 or 2026-12-05).` };
    }
    case 'choice': {
      const hit = (field.options || []).find(o => o.toLowerCase() === s.toLowerCase());
      return hit ? { value: hit } : { error: `${field.label}: "${s.slice(0, 30)}" is not one of its choices.` };
    }
    case 'yesno': {
      if (typeof raw === 'boolean') return { value: raw };
      if (/^(yes|y|true|1|haan|ha)$/i.test(s)) return { value: true };
      if (/^(no|n|false|0|nahi|kaadu)$/i.test(s)) return { value: false };
      return { error: `${field.label}: "${s.slice(0, 30)}" is not yes or no.` };
    }
    default: return { error: `${field.label}: unknown type.` };
  }
}

/** Size of the custom JSON in bytes. @param {Custom} custom */
const customBytes = (custom) => Buffer.byteLength(JSON.stringify(custom || {}), 'utf8');

/**
 * Values from the browser checked against the fields: { custom: only known keys with good values, errors }.
 * `values[key] = null / ''` clears it. Keys of fields not in `fields` are refused. Pure.
 * @param {Field[]} fields @param {Record<string, unknown>} values
 */
function cleanValues(fields, values) {
  /** @type {Record<string, string | number | boolean | null>} */
  const out = {};
  /** @type {string[]} */
  const errors = [];
  const byKey = new Map(fields.map(f => [f.key, f]));
  for (const [k, raw] of Object.entries(values && typeof values === 'object' ? values : {})) {
    const f = byKey.get(k);
    if (!f) { errors.push(`Unknown field: ${String(k).slice(0, 40)}.`); continue; }
    const r = cleanValue(f, raw);
    if (r.error !== undefined) errors.push(r.error); else out[k] = r.value;
  }
  return { values: out, errors };
}

/** Old custom + changes (null removes a key). Pure. @param {Custom} old @param {Record<string, unknown>} changes @returns {Custom} */
function mergeCustom(old, changes) {
  /** @type {Custom} */
  const out = { ...(old && typeof old === 'object' ? old : {}) };
  for (const [k, v] of Object.entries(changes)) {
    if (v === null || v === undefined || v === '') delete out[k];
    else out[k] = /** @type {string | number | boolean} */ (v);
  }
  return out;
}

/**
 * The details card for one person: every visible field with its value; PRIVATE values only for managers and the
 * Business Admin (agents get { hidden: true }). Pure.
 * @param {Field[]} fields @param {Custom} custom @param {string} role
 */
function detailsFor(fields, custom, role) {
  const seesPrivate = isManagerOrOwner(role);
  return fields.filter(f => !f.hidden).map(f => {
    const base = { key: f.key, label: f.label, type: f.type, options: f.type === 'choice' ? f.options : [], private: f.private };
    if (f.private && !seesPrivate) return { ...base, hidden: true, value: null };
    const v = custom && Object.prototype.hasOwnProperty.call(custom, f.key) ? custom[f.key] : null;
    return { ...base, hidden: false, value: v ?? null };
  });
}

/**
 * What the AI may know about this customer: normal (never private, never hidden) fields with a value. Pure.
 * @param {Field[]} fields @param {Custom} custom @returns {string}
 */
function aiFacts(fields, custom) {
  const lines = [];
  for (const f of fields) {
    if (f.private || f.hidden) continue;
    const v = custom?.[f.key];
    if (v === undefined || v === null || v === '') continue;
    const shown = f.type === 'yesno' ? (v ? 'yes' : 'no') : f.type === 'amount' ? `₹${Number(v).toLocaleString('en-IN')}` : String(v);
    lines.push(`- ${f.label.replace(/[\r\n]+/g, ' ')}: ${shown.replace(/[\r\n]+/g, ' ').slice(0, 200)}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Filters by custom fields (D4): Leads page, Inbox, broadcast audiences. AND-ed. PostgREST on the jsonb column:
//   number / amount: custom->key=gte.N (jsonb compares numbers as numbers; strings and booleans never match a range)
//   date: custom->>key=gte.YYYY-MM-DD (dates are saved as YYYY-MM-DD, so text order is date order)
//   choice (one value) / yes-no: custom=cs.{"key":value} (uses the GIN index); several choices: custom->>key=in.(…)
//   text: custom->>key=ilike.*term*
// Private fields: managers and the Business Admin only (the server refuses them for agents).
// ---------------------------------------------------------------------------
const MAX_FILTERS = 10;
/** Fields shown on a Pipeline card. */
const MAX_CARD_FIELDS = 2;
const DATE_PRESETS = ['overdue', 'today', 'this_week', 'next_7', 'next_30'];
/** Lowest number a field can hold: a lower bound that also makes sure the value IS a number (jsonb orders strings below numbers). */
const NUM_FLOOR = -1e15;

/**
 * @typedef {{ key: string, type: FieldType, min?: number, max?: number, from?: string, to?: string, preset?: string,
 *   values?: string[], value?: boolean, contains?: string }} CustomFilter
 */

/** India date (YYYY-MM-DD), `add` days from today. @param {number} [add] @param {number} [now] */
function istDate(add = 0, now = Date.now()) {
  return new Date(now + 330 * 60000 + add * 86400000).toISOString().slice(0, 10);
}

/** A date preset as from / to (India days, inclusive). Pure. @param {string} preset @param {number} [now] */
function presetRange(preset, now = Date.now()) {
  if (preset === 'overdue') return { to: istDate(-1, now) };
  if (preset === 'today') return { from: istDate(0, now), to: istDate(0, now) };
  if (preset === 'next_7') return { from: istDate(0, now), to: istDate(6, now) };
  if (preset === 'next_30') return { from: istDate(0, now), to: istDate(29, now) };
  if (preset === 'this_week') {
    const dow = new Date(now + 330 * 60000).getUTCDay(); // 0 = Sunday
    const back = (dow + 6) % 7;                          // Monday starts the week
    return { from: istDate(-back, now), to: istDate(6 - back, now) };
  }
  return {};
}

/**
 * Filters from the browser checked against this business's fields. Private fields need a manager or the Business
 * Admin; unknown fields, bad values and too many filters are refused (never silently dropped). Pure.
 * @param {Field[]} fields @param {unknown} input @param {{ seesPrivate: boolean, allowText?: boolean }} who
 * @returns {{ filters: CustomFilter[], error?: undefined, status?: undefined } | { error: string, status: number, filters?: undefined }}
 */
function cleanCustomFilters(fields, input, { seesPrivate, allowText = true }) {
  let list = input;
  if (typeof list === 'string') { try { list = JSON.parse(list); } catch { return { error: 'The customer-field filters are not valid.', status: 400 }; } }
  if (list === undefined || list === null || list === '') return { filters: [] };
  if (!Array.isArray(list)) return { error: 'The customer-field filters are not valid.', status: 400 };
  if (list.length > MAX_FILTERS) return { error: `At most ${MAX_FILTERS} customer-field filters.`, status: 400 };
  /** @type {CustomFilter[]} */
  const out = [];
  for (const raw of list) {
    const f = fields.find(x => x.key === raw?.key);
    if (!f) return { error: 'Unknown customer field in the filters.', status: 400 };
    // Hidden fields are refused for everyone: they are shown nowhere, so a filter on one would narrow lists unseen.
    if (f.hidden) return { error: `"${f.label}" is hidden, so it can't be used as a filter.`, status: 400 };
    if (f.private && !seesPrivate) return { error: 'Only managers and the Business Admin can filter by private fields.', status: 403 };
    const num = (/** @type {unknown} */ v) => (v === undefined || v === null || v === '' ? undefined : parseNumber(v));
    if (f.type === 'number' || f.type === 'amount') {
      const min = num(raw.min), max = num(raw.max);
      if (min === null || max === null) return { error: `${f.label}: the range must be numbers.`, status: 400 };
      if (min === undefined && max === undefined) continue;
      out.push({ key: f.key, type: f.type, ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) });
    } else if (f.type === 'date') {
      const preset = DATE_PRESETS.includes(raw.preset) ? raw.preset : '';
      const range = preset ? presetRange(preset) : { from: raw.from ? parseDate(String(raw.from)) : undefined, to: raw.to ? parseDate(String(raw.to)) : undefined };
      if (range.from === null || range.to === null) return { error: `${f.label}: not a date.`, status: 400 };
      if (!range.from && !range.to) continue;
      out.push({ key: f.key, type: 'date', ...(preset ? { preset } : {}), ...(range.from ? { from: range.from } : {}), ...(range.to ? { to: range.to } : {}) });
    } else if (f.type === 'choice') {
      const values = (Array.isArray(raw.values) ? raw.values : raw.value !== undefined ? [raw.value] : []).map(String);
      const ok = values.map((/** @type {string} */ v) => f.options.find(o => o.toLowerCase() === v.toLowerCase())).filter(Boolean);
      if (ok.length !== values.length) return { error: `${f.label}: not one of its choices.`, status: 400 };
      if (!ok.length) continue;
      out.push({ key: f.key, type: 'choice', values: /** @type {string[]} */ ([...new Set(ok)]) });
    } else if (f.type === 'yesno') {
      if (raw.value !== true && raw.value !== false) continue;
      out.push({ key: f.key, type: 'yesno', value: raw.value });
    } else {
      if (!allowText) return { error: 'Text filters are only on the Leads page.', status: 400 };
      const term = String(raw.contains ?? '').replace(/[^\p{L}\p{N} @.\-_]/gu, '').trim().slice(0, 40);
      if (!term) continue;
      out.push({ key: f.key, type: 'text', contains: term });
    }
  }
  return { filters: out };
}

/** PostgREST query params for checked filters (AND-ed; every key is a checked field key). Pure. @param {CustomFilter[]} filters */
function customFilterParts(filters) {
  /** @type {string[]} */
  const parts = [];
  const enc = encodeURIComponent;
  for (const f of filters) {
    if (!KEY_RE.test(f.key)) continue;
    if (f.type === 'number' || f.type === 'amount') {
      parts.push(`custom->${f.key}=gte.${f.min !== undefined ? f.min : NUM_FLOOR}`);
      if (f.max !== undefined) parts.push(`custom->${f.key}=lte.${f.max}`);
    } else if (f.type === 'date') {
      if (f.from) parts.push(`custom->>${f.key}=gte.${f.from}`);
      if (f.to) parts.push(`custom->>${f.key}=lte.${f.to}`);
    } else if (f.type === 'choice' && f.values?.length) {
      if (f.values.length === 1) parts.push(`custom=cs.${enc(JSON.stringify({ [f.key]: f.values[0] }))}`);
      else parts.push(`custom->>${f.key}=in.(${f.values.map(v => enc(`"${v.replace(/"/g, '')}"`)).join(',')})`);
    } else if (f.type === 'yesno') {
      parts.push(`custom=cs.${enc(JSON.stringify({ [f.key]: !!f.value }))}`);
    } else if (f.type === 'text' && f.contains) {
      parts.push(`custom->>${f.key}=ilike.${enc(`*${f.contains}*`)}`);
    }
  }
  return parts;
}

/**
 * Checked PostgREST params for one business's request (loads its fields). seesPrivate: a manager or the Business Admin.
 * @param {string} biz @param {unknown} input @param {{ seesPrivate: boolean, allowText?: boolean }} who
 */
async function filterPartsFor(biz, input, who) {
  if (input === undefined || input === null || input === '' || (Array.isArray(input) && !input.length)) return { parts: [] };
  const c = cleanCustomFilters(await listFor(biz), input, who);
  if (c.error !== undefined) return { error: c.error, status: c.status };
  return { parts: customFilterParts(c.filters) };
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------
/** @param {any} r @returns {Field} */
const toField = (r) => ({ key: r.key, label: r.label, type: r.type, options: Array.isArray(r.options) ? r.options.map(String) : [], private: !!r.private, hidden: !!r.hidden, sort_order: Number(r.sort_order) || 0, show_on_card: !!r.show_on_card });

/** This business's fields in order (cached a minute). [] before the SQL. @param {string} biz @param {{ fresh?: boolean }} [o] @returns {Promise<Field[]>} */
async function listFor(biz, { fresh = false } = {}) {
  const id = requireBusinessId(biz);
  const hit = cache.get(id);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.fields;
  const path = (/** @type {string} */ cols) => `lead_custom_fields?business_id=eq.${id}&select=${cols}&order=sort_order.asc,created_at.asc`;
  // show_on_card (SQL 20261143) when the column exists.
  let r = await dbRequest(path('key,label,type,options,private,hidden,sort_order,show_on_card'));
  if (!r.ok) r = await dbRequest(path('key,label,type,options,private,hidden,sort_order'));
  const fields = r.ok && Array.isArray(r.data) ? r.data.map(toField) : [];
  cache.set(id, { at: Date.now(), fields });
  return fields;
}

/** @param {Staff} staff @param {string} action @param {Record<string, unknown>} details */
const audit = (staff, action, details) => dbRequest('audit_log', {
  method: 'POST', prefer: 'return=minimal',
  body: { business_id: staff.businessId, actor_email: staff.email, actor_role: staff.role, action, details },
});

/** @param {Staff} staff */
const managersOnly = (staff) => (isManagerOrOwner(staff?.role) ? null : { error: 'Only managers and the Business Admin can change customer fields.', status: 403 });

/** Settings screen + details card labels: the fields (everyone reads; agents see which are private, never values). @param {Staff} staff */
async function view(staff) {
  const biz = requireBusinessId(staff?.businessId);
  const ready = await importColumnsReady(biz);
  const fields = await listFor(biz, { fresh: true });
  const { limits } = await require('./limits.cjs').getPlan(biz);
  return { ready, fields, types: TYPES.map(t => ({ key: t, label: TYPE_LABEL[t] })), max: limits.max_custom_fields ?? null, canEdit: isManagerOrOwner(staff.role) };
}

/** Field input (label, type, options, private, hidden) checked. @param {any} body @param {boolean} isNew */
function cleanFieldInput(body, isNew) {
  /** @type {Record<string, unknown>} */
  const out = {};
  if (isNew || 'label' in body) {
    const label = String(body.label ?? '').replace(/\s+/g, ' ').trim();
    if (!label || label.length > 60) return { error: 'Give the field a name (up to 60 characters).' };
    out.label = label;
  }
  if (isNew) {
    if (!TYPES.includes(body.type)) return { error: 'Choose a type.' };
    out.type = body.type;
  }
  if ('options' in body) out.options = cleanOptions(body.options);
  if ('private' in body) out.private = !!body.private;
  if ('hidden' in body) out.hidden = !!body.hidden;
  if ('showOnCard' in body) out.show_on_card = !!body.showOnCard;
  return { fields: out };
}

/**
 * Add fields (one, or several from the import wizard). Plan limit max_custom_fields. Audited (labels and types only).
 * @param {Staff} staff @param {any[]} inputs @param {{ via?: string }} [o]
 * @returns {Promise<{ error: string, status?: number } | { error?: undefined, fields: Field[], added: Field[] }>}
 */
async function addMany(staff, inputs, { via = 'settings' } = {}) {
  const no = managersOnly(staff); if (no) return no;
  const biz = requireBusinessId(staff.businessId);
  if (!(await importColumnsReady(biz))) return { error: 'Customer fields need the database update (SQL 20261142). Ask the platform team.', status: 503 };
  const current = await listFor(biz, { fresh: true });
  const { limits, planName } = await require('./limits.cjs').getPlan(biz);
  const max = Math.min(limits.max_custom_fields ?? MAX_FIELDS_HARD, MAX_FIELDS_HARD);
  if (current.length + inputs.length > max) return { error: `Your ${planName || ''} plan allows ${max} customer fields; you have ${current.length}. Remove or reuse one, or ask the platform to upgrade your plan.`.replace('  ', ' '), status: 400 };
  const taken = new Set(current.map(f => f.key));
  const labels = new Set(current.map(f => f.label.toLowerCase()));
  /** @type {Record<string, unknown>[]} */
  const rows = [];
  let order = current.reduce((m, f) => Math.max(m, f.sort_order), 0);
  for (const input of inputs) {
    const c = cleanFieldInput(input || {}, true);
    if (c.error) return { error: c.error };
    const f = /** @type {Record<string, any>} */ (c.fields);
    if (labels.has(String(f.label).toLowerCase())) return { error: `There is already a field called "${f.label}".` };
    if (f.type === 'choice' && !(f.options || []).length) return { error: `"${f.label}": add at least one choice.` };
    const key = input.key && KEY_RE.test(input.key) && !taken.has(input.key) ? input.key : keyFromLabel(String(f.label), taken);
    taken.add(key); labels.add(String(f.label).toLowerCase());
    rows.push({ business_id: biz, key, label: f.label, type: f.type, options: f.options || [], private: !!f.private, hidden: false, sort_order: ++order, created_by: staff.email });
  }
  if (!rows.length) return { fields: current, added: [] };
  const r = await dbRequest('lead_custom_fields', { method: 'POST', prefer: 'return=representation', body: rows });
  if (!r.ok) return { error: 'Could not add the field. Try again.' };
  cache.delete(biz);
  await audit(staff, 'custom_field.added', { via, fields: rows.map(x => ({ key: x.key, label: x.label, type: x.type, private: x.private })) });
  return { fields: await listFor(biz, { fresh: true }), added: (Array.isArray(r.data) ? r.data : []).map(toField) };
}
/** @param {Staff} staff @param {any} body */
const add = async (staff, body) => {
  const r = await addMany(staff, [body || {}]);
  return r.error !== undefined ? r : { fields: r.fields, field: r.added[0] };
};

/** Rename, change choices, private / hidden. The type never changes (values would no longer fit). @param {Staff} staff @param {string} key @param {any} body */
async function update(staff, key, body = {}) {
  const no = managersOnly(staff); if (no) return no;
  const biz = requireBusinessId(staff.businessId);
  if (!KEY_RE.test(String(key))) return { error: 'Unknown field.', status: 404 };
  const current = await listFor(biz, { fresh: true });
  const before = current.find(f => f.key === key);
  if (!before) return { error: 'Unknown field.', status: 404 };
  const c = cleanFieldInput(body, false);
  if (c.error) return { error: c.error };
  const changes = /** @type {Record<string, any>} */ (c.fields);
  if (changes.label && current.some(f => f.key !== key && f.label.toLowerCase() === String(changes.label).toLowerCase())) return { error: `There is already a field called "${changes.label}".` };
  if (before.type === 'choice' && 'options' in changes && !changes.options.length) return { error: 'A choice field needs at least one choice.' };
  if (!Object.keys(changes).length) return { fields: current };
  if (changes.show_on_card && !before.show_on_card && current.filter(f => f.show_on_card).length >= MAX_CARD_FIELDS) return { error: `At most ${MAX_CARD_FIELDS} fields can show on Pipeline cards. Turn one off first.` };
  const r = await dbRequest(`lead_custom_fields?business_id=eq.${biz}&key=eq.${key}`, { method: 'PATCH', prefer: 'return=minimal', body: { ...changes, updated_at: new Date().toISOString() } });
  if (!r.ok) return { error: 'Could not save the field.' };
  cache.delete(biz);
  /** @type {Record<string, unknown>} */
  const details = { key };
  for (const k of Object.keys(changes)) details[k] = k === 'options' ? { count: changes.options.length } : { from: /** @type {any} */ (before)[k], to: changes[k] };
  await audit(staff, 'custom_field.changed', details);
  return { fields: await listFor(biz, { fresh: true }) };
}

/** New order (every key once). @param {Staff} staff @param {unknown} keys */
async function reorder(staff, keys) {
  const no = managersOnly(staff); if (no) return no;
  const biz = requireBusinessId(staff.businessId);
  const current = await listFor(biz, { fresh: true });
  const list = Array.isArray(keys) ? keys.map(String) : [];
  if (list.length !== current.length || new Set(list).size !== list.length || !list.every(k => current.some(f => f.key === k))) return { error: 'Send every field once, in the new order.' };
  for (let i = 0; i < list.length; i++) {
    const r = await dbRequest(`lead_custom_fields?business_id=eq.${biz}&key=eq.${list[i]}`, { method: 'PATCH', prefer: 'return=minimal', body: { sort_order: i + 1, updated_at: new Date().toISOString() } });
    if (!r.ok) return { error: 'Could not save the order.' };
  }
  cache.delete(biz);
  await audit(staff, 'custom_field.reordered', { count: list.length });
  return { fields: await listFor(biz, { fresh: true }) };
}

// ---------------------------------------------------------------------------
// Customer details card (one person; the number comes in the POST body)
// ---------------------------------------------------------------------------
/** @param {string} biz @param {string} phone */
async function leadCustom(biz, phone) {
  const r = await dbRequest(`whatsapp_leads?business_id=eq.${biz}&phone=eq.${phone}&select=phone,custom,imported_at,import_id`);
  if (!r.ok) return { error: 'Customer details need the database update (SQL 20261142).', status: 503 };
  const lead = Array.isArray(r.data) ? r.data[0] : null;
  if (!lead) return { error: 'Contact not found.', status: 404 };
  return { lead };
}

/** The card for one person (agents: private values hidden). @param {Staff} staff @param {unknown} phoneInput */
async function details(staff, phoneInput) {
  const biz = requireBusinessId(staff?.businessId);
  const phone = digits(phoneInput);
  if (!PHONE_RE.test(phone)) return { error: 'Invalid number.' };
  const fields = await listFor(biz);
  const got = await leadCustom(biz, phone);
  if (got.error !== undefined) return got;
  const lead = /** @type {any} */ (got.lead);
  let importName = null;
  if (lead.import_id) {
    const imp = await dbRequest(`lead_imports?business_id=eq.${biz}&id=eq.${lead.import_id}&select=options,file_name`);
    const row = imp.ok && Array.isArray(imp.data) ? imp.data[0] : null;
    importName = row ? String(row.options?.tag || row.file_name || '') : null;
  }
  return {
    fields: detailsFor(fields, lead.custom || {}, staff.role),
    canEdit: isManagerOrOwner(staff.role),
    importedAt: lead.imported_at || null,
    importName,
  };
}

/**
 * Save values on one person (Business Admin + managers, with lead ownership as today: an unassigned chat is claimed,
 * someone else's chat is refused). Audited with the field keys only, never the values.
 * @param {Staff} staff @param {any} body { phone, values: { key: value | null } }
 */
async function saveDetails(staff, body = {}) {
  if (!isManagerOrOwner(staff?.role)) return { error: 'Only managers and the Business Admin can change customer details.', status: 403 };
  const biz = requireBusinessId(staff.businessId);
  const phone = digits(body.phone);
  if (!PHONE_RE.test(phone)) return { error: 'Invalid number.' };
  const fields = await listFor(biz, { fresh: true });
  const { values, errors } = cleanValues(fields, body.values || {});
  if (errors.length) return { error: errors.join(' ') };
  if (!Object.keys(values).length) return { error: 'Nothing to save.' };
  const can = await require('./inbox.cjs').ensureCanAct(phone, staff);
  if (can.error !== undefined) return can;
  const got = await leadCustom(biz, phone);
  if (got.error !== undefined) return got;
  const custom = mergeCustom(/** @type {any} */ (got.lead).custom || {}, values);
  if (customBytes(custom) > MAX_CUSTOM_BYTES) return { error: 'Too much detail for one customer (about 8 KB). Shorten some values.' };
  const r = await dbRequest(`whatsapp_leads?business_id=eq.${biz}&phone=eq.${phone}`, { method: 'PATCH', prefer: 'return=minimal', body: { custom } });
  if (!r.ok) return { error: 'Could not save the details.' };
  await audit(staff, 'customer_details.changed', { keys: Object.keys(values), privateKeys: Object.keys(values).filter(k => fields.find(f => f.key === k)?.private) });
  return { fields: detailsFor(fields, custom, staff.role), canEdit: true };
}

/**
 * The Pipeline card lines for these people: the fields marked "show on card" (at most 2) with a value. Private fields
 * only for managers and the Business Admin. { phone: [{ label, type, value }] }. [] before the SQL.
 * @param {string} biz @param {string[]} phones @param {string} role
 */
async function cardValues(biz, phones, role) {
  const id = requireBusinessId(biz);
  const seesPrivate = isManagerOrOwner(role);
  const shown = (await listFor(id)).filter(f => f.show_on_card && !f.hidden && (!f.private || seesPrivate)).slice(0, MAX_CARD_FIELDS);
  /** @type {Record<string, Array<{ label: string, type: FieldType, value: string | number | boolean }>>} */
  const out = {};
  if (!shown.length || !phones.length) return out;
  for (let i = 0; i < phones.length; i += 100) {
    const r = await dbRequest(`whatsapp_leads?business_id=eq.${id}&phone=in.(${phones.slice(i, i + 100).join(',')})&select=phone,custom`);
    if (!r.ok) return out;
    for (const l of Array.isArray(r.data) ? r.data : []) {
      const lines = shown.map(f => ({ label: f.label, type: f.type, value: l.custom?.[f.key] })).filter(x => x.value !== undefined && x.value !== null && x.value !== '');
      if (lines.length) out[String(l.phone)] = lines;
    }
  }
  return out;
}

/** For the AI: normal fields of one customer as short lines ('' when none, or before the SQL). @param {string} biz @param {string} phone */
async function aiFactsFor(biz, phone) {
  try {
    const fields = await listFor(biz);
    if (!fields.some(f => !f.private && !f.hidden)) return '';
    const got = await leadCustom(requireBusinessId(biz), digits(phone));
    return got.error !== undefined ? '' : aiFacts(fields, /** @type {any} */ (got.lead).custom || {});
  } catch { return ''; }
}

module.exports = {
  TYPES, KEY_RE, MAX_VALUE, MAX_CUSTOM_BYTES,
  keyFromLabel, looksSensitive, cleanOptions, parseDate, parseNumber, cleanValue, cleanValues, mergeCustom, customBytes,
  detailsFor, aiFacts, aiFactsFor, importColumnsReady, _resetColumns,
  cleanCustomFilters, customFilterParts, filterPartsFor, presetRange, MAX_FILTERS, MAX_CARD_FIELDS, cardValues,
  listFor, clearCache, view, add, addMany, update, reorder, details, saveDetails,
};
