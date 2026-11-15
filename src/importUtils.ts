// Customer import helpers for the browser (docs/progress/customer-import.md, D2). The file is read HERE: the server
// never receives it, only mapped rows (500 per request), and it checks every value again.
// The Excel reader (read-excel-file, MIT) is downloaded only when an .xlsx file is chosen.

export type CustomFieldType = 'text' | 'number' | 'amount' | 'date' | 'choice' | 'yesno';
export interface CustomField { key: string; label: string; type: CustomFieldType; options: string[]; private: boolean; hidden: boolean; sort_order?: number }

/** Where a column goes. */
export type Target =
  | { kind: 'skip' } | { kind: 'phone' } | { kind: 'name' } | { kind: 'status' } | { kind: 'source' } | { kind: 'tags' } | { kind: 'assignedTo' }
  | { kind: 'field'; key: string }
  | { kind: 'new'; label: string; type: CustomFieldType; private: boolean; options: string[] };

export interface Sheet { headers: string[]; rows: string[][] }

export const MAX_COLUMNS = 60;
export const MAX_CELL = 500;
export const BATCH = 500;
/** A request stays under ~4 MB of JSON (the server takes 6 MB; Netlify's limit is 6 MB too). */
export const MAX_PART_BYTES = 4 * 1024 * 1024;

/** Rows in parts of at most `maxRows` and `maxBytes` of JSON (UTF-8), in order. A single bigger row is a part of its own. */
export function splitParts<T>(rows: T[], maxRows = BATCH, maxBytes = MAX_PART_BYTES): T[][] {
  const enc = new TextEncoder();
  const parts: T[][] = [];
  let part: T[] = [];
  let bytes = 2;
  for (const r of rows) {
    const size = enc.encode(JSON.stringify(r)).length + 1;
    if (part.length && (part.length >= maxRows || bytes + size > maxBytes)) { parts.push(part); part = []; bytes = 2; }
    part.push(r);
    bytes += size;
  }
  if (part.length) parts.push(part);
  return parts;
}

/** Column names that usually hold money, credit, ID or health details: suggested as private. */
const SENSITIVE_RE = /cibil|credit|score|income|salary|loan|emi|pan\b|pan[_ ]?(no|number|card)|aadha?ar|aadhar|bank|account|ifsc|insurance|policy|outstanding|dues?\b|balance|net ?worth|diagnos|medicine|prescription|disease|condition/i;
export const looksSensitive = (name: string) => SENSITIVE_RE.test(name);
/** Health words a hospital should not upload at all. */
export const looksMedical = (name: string) => /diagnos|medicine|prescription|disease|condition|treatment|symptom|report/i.test(name);

// ---------------------------------------------------------------------------
// Reading the file
// ---------------------------------------------------------------------------
/** CSV text -> rows (quotes, commas and new lines inside quotes, ; or tab separators). Pure. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.slice(0, src.indexOf('\n') === -1 ? src.length : src.indexOf('\n'));
  const counts = [',', ';', '\t'].map(sep => [sep, firstLine.split(sep).length] as const);
  const sep = counts.sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false; }
      else cell += ch;
      continue;
    }
    if (ch === '"' && cell === '') { inQuotes = true; continue; }
    if (ch === sep) { row.push(cell); cell = ''; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
      continue;
    }
    cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

/** A spreadsheet cell as text (Excel dates -> 2026-12-05, big numbers without 9.8E9). */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  if (typeof v === 'number') return Number.isInteger(v) ? BigInt(v).toString() : String(v);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return String(v);
}

/** Is it really a CSV / XLSX? (by content, not just the name) */
export async function fileKind(file: File): Promise<'csv' | 'xlsx' | null> {
  const head = new Uint8Array(await file.slice(0, 512).arrayBuffer());
  const zip = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
  if (/\.xlsx$/i.test(file.name)) return zip ? 'xlsx' : null;
  if (/\.csv$/i.test(file.name) || file.type === 'text/csv') {
    // Text: no NUL bytes and not a zip / other binary.
    return !zip && !head.includes(0) ? 'csv' : null;
  }
  return null;
}

/** Read the first sheet of a CSV or XLSX file into headers + rows of text. */
export async function readSheet(file: File): Promise<Sheet | { error: string }> {
  const kind = await fileKind(file);
  if (!kind) return { error: 'Choose a .csv or .xlsx file (Excel: File → Save as → Excel Workbook or CSV UTF-8).' };
  let grid: string[][];
  try {
    if (kind === 'csv') grid = parseCsv(await file.text());
    else {
      const { readSheet: readXlsx } = await import('read-excel-file/browser');
      const data = await readXlsx(file);
      grid = data.map(r => r.map(cellText)).filter(r => r.some(c => c.trim() !== ''));
    }
  } catch {
    return { error: 'This file could not be read. Is it a real Excel or CSV file?' };
  }
  if (grid.length < 2) return { error: 'The file needs a header row and at least one row of customers.' };
  const width = Math.max(...grid.slice(0, 50).map(r => r.length));
  if (width > MAX_COLUMNS) return { error: `The file has ${width} columns; at most ${MAX_COLUMNS}. Remove the ones you don't need.` };
  const headers = Array.from({ length: width }, (_, i) => String(grid[0][i] ?? '').trim() || `Column ${i + 1}`);
  const rows = grid.slice(1).map(r => Array.from({ length: width }, (_, i) => String(r[i] ?? '').trim()));
  return { headers, rows };
}

// ---------------------------------------------------------------------------
// Guessing what a column is
// ---------------------------------------------------------------------------
const NUM_RE = /^-?(₹|rs\.?|inr)?\s*[\d,]+(\.\d+)?$/i;
const DATE_RE = /^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.-](\d{2}|\d{4}))$/;
const YESNO_RE = /^(yes|no|y|n|true|false)$/i;

/** The likely type of a column from its name and some values. Pure. */
export function guessType(header: string, values: string[]): CustomFieldType {
  const v = values.map(x => x.trim()).filter(Boolean).slice(0, 200);
  if (!v.length) return 'text';
  const all = (re: RegExp) => v.every(x => re.test(x));
  if (all(YESNO_RE)) return 'yesno';
  if (all(DATE_RE)) return 'date';
  if (all(NUM_RE)) return /amount|loan|emi|price|fee|salary|income|balance|outstanding|₹|rs\b|inr/i.test(header) || v.some(x => /₹|rs/i.test(x)) ? 'amount' : 'number';
  const distinct = new Set(v.map(x => x.toLowerCase()));
  if (v.length >= 6 && distinct.size <= 8 && distinct.size < v.length / 2 && v.every(x => x.length <= 40)) return 'choice';
  return 'text';
}

/** Distinct values (for a new choice field's options). */
export const distinctValues = (values: string[]) => {
  const out: string[] = [];
  for (const x of values) { const t = x.trim(); if (t && !out.some(o => o.toLowerCase() === t.toLowerCase())) out.push(t.slice(0, 60)); if (out.length >= 50) break; }
  return out;
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** A first guess for every column: phone / name / status… / an existing field / a new field. Pure. */
export function autoMap(sheet: Sheet, fields: CustomField[]): Target[] {
  const used = new Set<string>();
  const take = (k: string) => { if (used.has(k)) return false; used.add(k); return true; };
  return sheet.headers.map((h, i) => {
    const n = norm(h);
    if (/^(phone|mobile|mobile no|mobile number|phone number|whatsapp|whatsapp number|contact|contact number|cell|number|ph|mob)$/.test(n) && take('phone')) return { kind: 'phone' as const };
    if (/^(name|customer name|full name|patient name|client name|customer)$/.test(n) && take('name')) return { kind: 'name' as const };
    if (/^(status|stage|lead status)$/.test(n) && take('status')) return { kind: 'status' as const };
    if (/^(source|lead source)$/.test(n) && take('source')) return { kind: 'source' as const };
    if (/^(tags?|labels?)$/.test(n) && take('tags')) return { kind: 'tags' as const };
    if (/^(assigned to|owner|agent|assigned)$/.test(n) && take('assignedTo')) return { kind: 'assignedTo' as const };
    const existing = fields.find(f => norm(f.label) === n || f.key === n.replace(/ /g, '_'));
    if (existing && take(`field:${existing.key}`)) return { kind: 'field' as const, key: existing.key };
    const values = sheet.rows.slice(0, 200).map(r => r[i] || '');
    if (!values.some(v => v.trim())) return { kind: 'skip' as const };
    const type = guessType(h, values);
    // Choice options come from the whole column when the import starts (the wizard), not just these first rows.
    return { kind: 'new' as const, label: h.slice(0, 60), type, private: looksSensitive(h), options: [] };
  });
}

/** One file row as the server expects it ({ row, phone, name, …, custom }). row = customer row number (the header is not counted). */
export function toPayload(sheet: Sheet, map: Target[], index: number, keyOf: (t: Target, col: number) => string | null) {
  const r = sheet.rows[index];
  const out: { row: number; phone: string; name?: string; status?: string; source?: string; tags?: string; assignedTo?: string; custom: Record<string, string> } = { row: index + 1, phone: '', custom: {} };
  map.forEach((t, col) => {
    const v = (r[col] || '').slice(0, MAX_CELL + 1);
    if (!v) return;
    if (t.kind === 'phone') out.phone = v;
    else if (t.kind === 'name') out.name = v;
    else if (t.kind === 'status') out.status = v;
    else if (t.kind === 'source') out.source = v;
    else if (t.kind === 'tags') out.tags = v;
    else if (t.kind === 'assignedTo') out.assignedTo = v;
    else if (t.kind === 'field' || t.kind === 'new') { const k = keyOf(t, col); if (k) out.custom[k] = v; }
  });
  return out;
}

/** A key for a new field's label (the server makes the final one and tells us). */
export function draftKey(label: string, taken: Set<string>): string {
  let base = label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 36);
  if (!base || !/^[a-z]/.test(base)) base = `f_${base}`.slice(0, 36).replace(/_+$/, '') || 'field';
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}_${n}`;
  taken.add(key);
  return key;
}

/** CSV of rejected rows with their reasons (Excel-safe: formulas guarded, UTF-8 BOM). */
export function rejectedCsv(headers: string[], rows: Array<{ cells: string[]; reason: string }>): string {
  const cell = (v: string) => {
    let s = v ?? '';
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `﻿${[[...headers, 'Reason'], ...rows.map(r => [...r.cells, r.reason])].map(r => r.map(cell).join(',')).join('\r\n')}\r\n`;
}
