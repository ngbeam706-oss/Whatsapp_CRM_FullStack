// @ts-check
// Platform branding: the application's own name, logo, company and contact details, set by the Platform Admin
// (platform console -> Branding) and shown on the public website, the Privacy Policy / Terms, the sign-in page and
// the dashboard header. Public information by nature: GET /api/public/branding and GET /api/public/logo need no
// login. Only the Platform Admin can change it. Stored on the one platform_settings row (migration 20261128).
const crypto = require('crypto');
const { dbRequest } = require('./db.cjs');

const CACHE_MS = 60 * 1000;
const MAX_LOGO_BYTES = 300 * 1024;
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

const EMAIL_RE = /^(?!.*\.\.)[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}$/;
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const CIN_RE = /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;
const PHONE_RE = /^\+?[\d\s\-()]{8,20}$/;
const NO_TAGS = /[<>]/;

/**
 * Every field: label (for messages), max length, and an extra check. Empty = not set (the site then shows a
 * [placeholder] and the legal pages a "draft" note).
 * @type {Record<string, { label: string, max: number, check?: (v: string) => string | null }>}
 */
const FIELDS = {
  brandName: { label: 'App name', max: 40, check: v => (v.length < 2 ? 'Use at least 2 characters.' : null) },
  tagline: { label: 'Tagline', max: 120 },
  companyName: { label: 'Registered company name', max: 120 },
  companyAddress: { label: 'Registered office address', max: 300 },
  cin: { label: 'CIN', max: 21, check: v => (CIN_RE.test(v.toUpperCase()) ? null : 'A CIN has 21 characters, e.g. U72900TG2024PTC123456.') },
  gstin: { label: 'GSTIN', max: 15, check: v => (GSTIN_RE.test(v.toUpperCase()) ? null : 'A GSTIN has 15 characters, e.g. 36ABCDE1234F1Z5.') },
  supportEmail: { label: 'Support email', max: 254, check: v => (EMAIL_RE.test(v) ? null : 'Enter a valid email address.') },
  salesEmail: { label: 'Sales email', max: 254, check: v => (EMAIL_RE.test(v) ? null : 'Enter a valid email address.') },
  privacyEmail: { label: 'Privacy email', max: 254, check: v => (EMAIL_RE.test(v) ? null : 'Enter a valid email address.') },
  phone: { label: 'Phone', max: 20, check: v => (PHONE_RE.test(v) && (v.match(/\d/g) || []).length >= 8 ? null : 'Enter a phone number with the country code, e.g. +91 98765 43210.') },
  supportHours: { label: 'Support hours', max: 80 },
  grievanceOfficerName: { label: 'Grievance Officer name', max: 80, check: v => (/^[\p{L}][\p{L} .'-]*$/u.test(v) ? null : 'Use letters, spaces, dots, hyphens and apostrophes.') },
  grievanceOfficerEmail: { label: 'Grievance Officer email', max: 254, check: v => (EMAIL_RE.test(v) ? null : 'Enter a valid email address.') },
  jurisdictionCity: { label: 'City for courts', max: 60, check: v => (/^[\p{L}][\p{L} .-]*$/u.test(v) ? null : 'Use the city name only.') },
};
const UPPER = new Set(['cin', 'gstin']);

/**
 * Pure: check and clean what the console sent (tested).
 * @param {Record<string, unknown>} input
 * @returns {{ errors: Record<string, string> } | { value: Record<string, string> }}
 */
function validate(input) {
  /** @type {Record<string, string>} */
  const errors = {};
  /** @type {Record<string, string>} */
  const value = {};
  for (const [key, f] of Object.entries(FIELDS)) {
    const raw = input?.[key];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== 'string') { errors[key] = `${f.label}: text only.`; continue; }
    let v = raw.replace(/\s+/g, ' ').trim();
    if (key === 'companyAddress') v = raw.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (UPPER.has(key)) v = v.toUpperCase();
    if (!v) { value[key] = ''; continue; }
    if (v.length > f.max) { errors[key] = `${f.label}: at most ${f.max} characters.`; continue; }
    if (NO_TAGS.test(v)) { errors[key] = `${f.label}: < and > are not allowed.`; continue; }
    const problem = f.check?.(v);
    if (problem) { errors[key] = problem; continue; }
    value[key] = v;
  }
  return Object.keys(errors).length ? { errors } : { value };
}

/**
 * appUrl: the Application URL (server/siteUrl.cjs) — kept in the same `branding` object but outside FIELDS: it has
 * its own save (with a reachability check) and isn't shown on the public site.
 * @typedef {{ fields: Record<string, string>, appUrl: string, logo: { type: string, version: string } | null, updatedBy: string | null, updatedAt: string | null }} BrandingState
 */
/** @type {{ state: BrandingState, expires: number } | null} */
let cache = null;

/** @param {any} row @returns {BrandingState} */
function fromRow(row) {
  const raw = row?.branding && typeof row.branding === 'object' ? row.branding : {};
  /** @type {Record<string, string>} */
  const fields = {};
  for (const key of Object.keys(FIELDS)) if (typeof raw[key] === 'string' && raw[key]) fields[key] = raw[key];
  // The logo itself isn't read here (up to 300 KB); its type says whether there is one, its time is the version.
  const logo = LOGO_TYPES.includes(row?.brand_logo_type)
    ? { type: String(row.brand_logo_type), version: crypto.createHash('sha256').update(String(row.brand_logo_updated_at || '')).digest('hex').slice(0, 12) }
    : null;
  const appUrl = typeof raw.appUrl === 'string' && /^https:\/\/[a-z0-9.-]+$/.test(raw.appUrl) ? raw.appUrl : '';
  return { fields, appUrl, logo, updatedBy: row?.branding_updated_by || null, updatedAt: row?.branding_updated_at || null };
}

/**
 * The saved branding (a minute's cache per server instance). If it can't be read, the site uses its defaults.
 * @param {{ fresh?: boolean }} [options] @returns {Promise<BrandingState>}
 */
async function get({ fresh = false } = {}) {
  if (!fresh && cache && cache.expires > Date.now()) return cache.state;
  /** @type {BrandingState} */
  let state = { fields: {}, appUrl: '', logo: null, updatedBy: null, updatedAt: null };
  try {
    const r = await dbRequest('platform_settings?id=eq.1&select=branding,brand_logo_type,brand_logo_updated_at,branding_updated_by,branding_updated_at');
    if (r.ok && r.data?.[0]) state = fromRow(r.data[0]);
  } catch { /* defaults */ }
  cache = { state, expires: Date.now() + CACHE_MS };
  return state;
}

/** What anyone may read: the details and the logo's address (versioned, so browsers can keep it). */
async function publicBranding() {
  const s = await get();
  return { branding: { ...s.fields, logoUrl: s.logo ? `/api/public/logo?v=${s.logo.version}` : null } };
}

/** For the console: also who changed it last. */
async function adminView() {
  const s = await get({ fresh: true });
  const { defaultSiteUrl } = require('./siteUrl.cjs');
  return {
    branding: s.fields, logoUrl: s.logo ? `/api/public/logo?v=${s.logo.version}` : null, updatedBy: s.updatedBy, updatedAt: s.updatedAt,
    fields: Object.fromEntries(Object.entries(FIELDS).map(([k, f]) => [k, { label: f.label, max: f.max }])),
    // The Application URL: saved value ('' = not set), the one in use, and the default.
    appUrl: s.appUrl, appUrlInUse: s.appUrl || defaultSiteUrl(), appUrlDefault: defaultSiteUrl(),
  };
}

/** The `branding` object to store: the fields plus the Application URL (when set). @param {Record<string, string>} fields @param {string} appUrl */
const stored = (fields, appUrl) => ({ ...fields, ...(appUrl ? { appUrl } : {}) });

/**
 * Platform Owner: set the Application URL ('' = back to the default). Saved only when the app answers at
 * <address>/api/health. Audited with the old and new address.
 * @param {{ email: string }} admin @param {unknown} input
 */
async function saveAppUrl(admin, input) {
  const site = require('./siteUrl.cjs');
  const c = site.cleanAppUrl(input);
  if ('error' in c) return { error: c.error, status: 400 };
  const current = await get({ fresh: true });
  if (c.value === current.appUrl) return adminView();
  if (c.value && !(await site.reachable(c.value))) {
    return { error: `This app doesn't answer at ${c.value}/api/health yet. Add the domain to the Netlify site first (Domain settings), wait for it to work, then save again.`, status: 400 };
  }
  const now = new Date().toISOString();
  const r = await dbRequest('platform_settings?on_conflict=id', {
    method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
    body: { id: 1, branding: stored(current.fields, c.value), branding_updated_by: admin.email, branding_updated_at: now },
  });
  if (!r.ok) return { error: 'Could not save. Has the branding SQL (20261128) been run in Supabase?', status: 500 };
  cache = null;
  await audit(admin, 'platform.app_url_changed', { from: current.appUrl || site.defaultSiteUrl(), to: c.value || site.defaultSiteUrl() });
  return adminView();
}

/** @param {{ email: string }} admin @param {string} action @param {Record<string, unknown>} details */
async function audit(admin, action, details) {
  await require('./platform.cjs').audit(admin, null, action, details);
}

/**
 * Platform Admin saves the details (fields not sent are kept; '' clears one).
 * @param {{ email: string }} admin @param {Record<string, unknown>} input
 */
async function save(admin, input) {
  const checked = validate(input || {});
  if ('errors' in checked) return { error: 'Please fix the highlighted fields.', errors: checked.errors, status: 400 };
  const current = await get({ fresh: true });
  const next = { ...current.fields, ...checked.value };
  for (const k of Object.keys(next)) if (!next[k]) delete next[k];
  const now = new Date().toISOString();
  const r = await dbRequest('platform_settings?on_conflict=id', {
    method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
    // The Application URL is kept as it is (it has its own save).
    body: { id: 1, branding: stored(next, current.appUrl), branding_updated_by: admin.email, branding_updated_at: now },
  });
  if (!r.ok) return { error: 'Could not save. Has the branding SQL (20261128) been run in Supabase?', status: 500 };
  cache = null;
  await audit(admin, 'platform.branding_updated', { fields: Object.keys(checked.value) });
  return adminView();
}

/**
 * Pure: read an uploaded logo (data URL) and check it really is a small PNG / JPEG / WebP (by its first bytes,
 * not just the name it claims). SVG is refused: it can carry scripts.
 * @param {unknown} dataUrl @returns {{ error: string } | { type: string, base64: string }}
 */
function readLogo(dataUrl) {
  const m = typeof dataUrl === 'string' ? dataUrl.match(/^data:(image\/[a-z+.-]+);base64,([A-Za-z0-9+/]+=*)$/) : null;
  if (!m) return { error: 'Choose a PNG, JPG or WebP image.' };
  if (!LOGO_TYPES.includes(m[1])) return { error: 'The logo must be a PNG, JPG or WebP image (SVG is not accepted).' };
  const bytes = Buffer.from(m[2], 'base64');
  if (!bytes.length) return { error: 'The image is empty.' };
  if (bytes.length > MAX_LOGO_BYTES) return { error: `The logo is too large (${Math.ceil(bytes.length / 1024)} KB). Use one of at most 300 KB.` };
  const isPng = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isWebp = bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  const real = isPng ? 'image/png' : isJpeg ? 'image/jpeg' : isWebp ? 'image/webp' : null;
  if (!real) return { error: 'That file is not a valid PNG, JPG or WebP image.' };
  return { type: real, base64: bytes.toString('base64') };
}

/** @param {{ email: string }} admin @param {unknown} dataUrl */
async function saveLogo(admin, dataUrl) {
  const logo = readLogo(dataUrl);
  if ('error' in logo) return { error: logo.error, status: 400 };
  const now = new Date().toISOString();
  const r = await dbRequest('platform_settings?on_conflict=id', {
    method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
    body: { id: 1, brand_logo: logo.base64, brand_logo_type: logo.type, brand_logo_updated_at: now, branding_updated_by: admin.email, branding_updated_at: now },
  });
  if (!r.ok) return { error: 'Could not save the logo. Has the branding SQL (20261128) been run in Supabase?', status: 500 };
  cache = null;
  await audit(admin, 'platform.logo_updated', { type: logo.type, bytes: Buffer.byteLength(logo.base64, 'base64') });
  return adminView();
}

/** @param {{ email: string }} admin */
async function removeLogo(admin) {
  const now = new Date().toISOString();
  const r = await dbRequest('platform_settings?on_conflict=id', {
    method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
    body: { id: 1, brand_logo: null, brand_logo_type: null, brand_logo_updated_at: now, branding_updated_by: admin.email, branding_updated_at: now },
  });
  if (!r.ok) return { error: 'Could not remove the logo.', status: 500 };
  cache = null;
  await audit(admin, 'platform.logo_removed', {});
  return adminView();
}

/** The logo's bytes for GET /api/public/logo (null when none). */
async function logoFile() {
  try {
    const r = await dbRequest('platform_settings?id=eq.1&select=brand_logo,brand_logo_type');
    const row = r.ok ? r.data?.[0] : null;
    if (!row?.brand_logo || !LOGO_TYPES.includes(row.brand_logo_type)) return null;
    return { type: String(row.brand_logo_type), body: Buffer.from(String(row.brand_logo), 'base64') };
  } catch {
    return null;
  }
}

function clearCache() { cache = null; }

module.exports = { FIELDS, validate, readLogo, get, publicBranding, adminView, save, saveAppUrl, saveLogo, removeLogo, logoFile, clearCache, MAX_LOGO_BYTES };
