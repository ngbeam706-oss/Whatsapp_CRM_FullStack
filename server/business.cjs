// @ts-check
// The signed-in business's own profile: name and the hours follow-ups may be sent.
// (Plan, status and payments are set by the Platform Admin, not here.)
const { dbRequest } = require('./db.cjs');
const { requireBusinessId } = require('./tenant.cjs');

/** @typedef {{ start: number, end: number }} SendWindow */
/** @typedef {import('./types.cjs').Staff} Staff */

/** @type {SendWindow} */
const DEFAULT_WINDOW = { start: 9, end: 20 };
const CACHE_MS = 60 * 1000;
/** @type {Map<string, { at: number, value: SendWindow }>} */
const windowCache = new Map(); // businessId -> { at, value }

// ---------------------------------------------------------------------------
// Business details (SQL 20261131): what the business is and how to reach it. The Business Admin edits them on
// My profile. The business type (industry) is set by the platform: it decides Meta's healthcare rules.
// ---------------------------------------------------------------------------
/** @type {Array<{ key: string, max: number, label: string, multiline?: boolean, kind?: 'phone' | 'email' | 'website' | 'pin' | 'gstin' }>} */
const DETAIL_FIELDS = [
  { key: 'about', max: 1000, label: 'About the business', multiline: true },
  { key: 'legalName', max: 120, label: 'Registered name' },
  { key: 'phone', max: 20, label: 'Business phone', kind: 'phone' },
  { key: 'email', max: 120, label: 'Business email', kind: 'email' },
  { key: 'website', max: 200, label: 'Website', kind: 'website' },
  { key: 'address', max: 300, label: 'Address', multiline: true },
  { key: 'city', max: 60, label: 'City' },
  { key: 'state', max: 60, label: 'State' },
  { key: 'pin', max: 6, label: 'PIN code', kind: 'pin' },
  { key: 'gstin', max: 15, label: 'GSTIN', kind: 'gstin' },
  { key: 'registrationNo', max: 60, label: 'Registration / licence number' },
  { key: 'hours', max: 200, label: 'Opening hours' },
];
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/**
 * Pure: check and clean business details (tested). Only known fields; '' clears one; fields not sent are not touched.
 * @param {unknown} input
 * @returns {{ error: string, field: string } | { values: Record<string, string> }}
 */
function cleanDetails(input) {
  const src = /** @type {Record<string, unknown>} */ (input && typeof input === 'object' && !Array.isArray(input) ? input : {});
  /** @type {Record<string, string>} */
  const values = {};
  for (const f of DETAIL_FIELDS) {
    const v = src[f.key];
    if (v === undefined) continue;
    if (v !== null && typeof v !== 'string') return { error: `${f.label} must be text.`, field: f.key };
    let s = f.multiline ? String(v || '').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() : String(v || '').trim().replace(/\s+/g, ' ');
    if (!s) { values[f.key] = ''; continue; }
    if (/[<>]/.test(s)) return { error: `${f.label}: < and > are not allowed.`, field: f.key };
    if (f.kind === 'gstin') s = s.toUpperCase().replace(/\s/g, '');
    if (f.kind === 'website' && !/^https?:\/\//i.test(s)) s = `https://${s}`;
    if (s.length > f.max) return { error: `${f.label} is longer than ${f.max} characters.`, field: f.key };
    if (f.kind === 'phone' && !/^\+?[\d\s-]{7,20}$/.test(s)) return { error: `${f.label}: digits only (a + at the start is fine).`, field: f.key };
    if (f.kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) return { error: `${f.label}: enter a valid email address.`, field: f.key };
    if (f.kind === 'website' && !/^https?:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/[^\s]*)?$/i.test(s)) return { error: `${f.label}: enter an address like www.example.com.`, field: f.key };
    if (f.kind === 'pin' && !/^[1-9]\d{5}$/.test(s)) return { error: `${f.label}: 6 digits.`, field: f.key };
    if (f.kind === 'gstin' && !GSTIN_RE.test(s)) return { error: `${f.label}: 15 characters, like 36ABCDE1234F1Z5.`, field: f.key };
    values[f.key] = s;
  }
  return { values };
}

/** Pure: only known, non-empty details (what is shown and saved). @param {unknown} d */
const detailsView = (d) => {
  const src = /** @type {Record<string, unknown>} */ (d && typeof d === 'object' ? d : {});
  return Object.fromEntries(DETAIL_FIELDS.map(f => [f.key, typeof src[f.key] === 'string' ? String(src[f.key]).slice(0, f.max) : '']));
};

/** @param {unknown} businessId @returns {Promise<{ error: string, business?: undefined } | { error?: undefined, business: Record<string, any> }>} */
async function getProfile(businessId) {
  const id = requireBusinessId(businessId);
  const base = 'id,name,slug,status,plan_id,send_window_start,send_window_end,timezone,created_at';
  let r = await dbRequest(`businesses?id=eq.${id}&select=${base},industry,details`);
  const detailsReady = r.ok;
  if (!r.ok) r = await dbRequest(`businesses?id=eq.${id}&select=${base}`); // before SQL 20261131
  const b = r.ok ? r.data?.[0] : null;
  if (!b) return { error: 'Business not found.' };
  return {
    business: {
      id: b.id, name: b.name, slug: b.slug, status: b.status, planId: b.plan_id, timezone: b.timezone,
      sendWindowStart: b.send_window_start, sendWindowEnd: b.send_window_end, createdAt: b.created_at,
      industry: b.industry || null, details: detailsView(b.details), detailsReady,
    },
  };
}

/**
 * Business Admin edits the name, sending hours and the business details.
 * @param {Staff} staff @param {{ name?: unknown, sendWindowStart?: unknown, sendWindowEnd?: unknown, details?: unknown }} [input]
 */
async function saveProfile(staff, input = {}) {
  const id = requireBusinessId(staff?.businessId);
  /** @type {Record<string, unknown>} */
  const body = { updated_at: new Date().toISOString() };
  if ('name' in input) {
    const name = String(input.name || '').trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 80) return { error: 'Business name must be 2 to 80 characters.' };
    body.name = name;
  }
  if ('sendWindowStart' in input || 'sendWindowEnd' in input) {
    const start = Number(input.sendWindowStart);
    const end = Number(input.sendWindowEnd);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > 23 || end < 1 || end > 24 || end <= start) {
      return { error: 'Sending hours: the end must be after the start (for example 9 to 20).' };
    }
    if (end - start < 2) return { error: 'Allow at least 2 hours for sending follow-ups.' };
    body.send_window_start = start;
    body.send_window_end = end;
  }
  /** @type {string[]} */
  let detailKeys = [];
  if ('details' in input) {
    const checked = cleanDetails(input.details);
    if ('error' in checked) return { error: checked.error, field: checked.field };
    detailKeys = Object.keys(checked.values);
    if (detailKeys.length) {
      // Merge with what is saved: fields not sent stay as they are; '' removes one.
      const cur = await dbRequest(`businesses?id=eq.${id}&select=details`);
      if (!cur.ok) return { error: 'Could not save the business details. Has the business details SQL (20261131) been run?' };
      const merged = { ...detailsView(cur.data?.[0]?.details), ...checked.values };
      body.details = Object.fromEntries(Object.entries(merged).filter(([, v]) => v));
    }
  }
  if (Object.keys(body).length === 1) return { error: 'Nothing to change.' };
  const res = await dbRequest(`businesses?id=eq.${id}`, { method: 'PATCH', prefer: 'return=minimal', body });
  if (!res.ok) return { error: body.details ? 'Could not save the business details. Has the business details SQL (20261131) been run?' : 'Could not save.' };
  windowCache.delete(id);
  require('./whatsapp.cjs').clearCache(id); // the name appears on list messages
  await dbRequest('audit_log', {
    method: 'POST', prefer: 'return=minimal',
    // The changed values for name / hours (as before); for the details only which fields changed.
    body: { business_id: id, actor_email: staff.email, actor_role: staff.role, action: 'business.profile_updated', details: { ...Object.fromEntries(Object.entries(body).filter(([k]) => k !== 'updated_at' && k !== 'details')), ...(detailKeys.length ? { detailFields: detailKeys } : {}) } },
  });
  return getProfile(id);
}

/** The hours (India time) this business's follow-ups may go out. @param {unknown} businessId @returns {Promise<SendWindow>} */
async function sendWindowFor(businessId) {
  const id = requireBusinessId(businessId);
  const hit = windowCache.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  let value = DEFAULT_WINDOW;
  try {
    const r = await dbRequest(`businesses?id=eq.${id}&select=send_window_start,send_window_end`);
    const b = r.ok ? r.data?.[0] : null;
    if (b && Number.isInteger(b.send_window_start) && Number.isInteger(b.send_window_end) && b.send_window_end > b.send_window_start) {
      value = { start: b.send_window_start, end: b.send_window_end };
    }
  } catch { /* keep the default */ }
  windowCache.set(id, { at: Date.now(), value });
  return value;
}

/** The onboarding checklist for a new business: what is done and what is left. @param {unknown} businessId */
async function checklist(businessId) {
  const id = requireBusinessId(businessId);
  const [wa, rules, catalog, staff, ai, aiSettings] = await Promise.all([
    require('./whatsapp.cjs').connectionStatus(id),
    dbRequest(`whatsapp_bot_rules?business_id=eq.${id}&select=id&limit=1`),
    dbRequest(`whatsapp_catalog?business_id=eq.${id}&select=id&limit=1`),
    dbRequest(`staff_members?business_id=eq.${id}&select=user_id&limit=2`),
    require('./ai.cjs').providerStatus(id),
    dbRequest(`ai_settings?business_id=eq.${id}&select=knowledge`),
  ]);
  const has = (/** @type {import('./types.cjs').DbResult} */ r) => !!(r.ok && r.data?.length);
  const steps = [
    { id: 'whatsapp', label: 'Connect your WhatsApp number', done: wa.connected, view: 'whatsapp', who: 'owner' },
    { id: 'bot', label: 'Set up your bot welcome message and menus', done: has(catalog) || has(rules), view: 'flow', who: 'manager' },
    { id: 'team', label: 'Invite your team', done: !!(staff.ok && staff.data.length > 1), view: 'team', who: 'owner' },
    { id: 'templates', label: 'Create a message template (for broadcasts and follow-ups)', done: null, view: 'broadcasts', who: 'manager' },
    { id: 'ai', label: 'Optional: connect an AI assistant and add your business information', done: !!(ai.configured && aiSettings.ok && String(aiSettings.data?.[0]?.knowledge || '').trim()), view: 'ai', who: 'owner' },
  ];
  return { steps, doneCount: steps.filter(s => s.done).length, total: steps.filter(s => s.done !== null).length };
}

module.exports = { getProfile, saveProfile, sendWindowFor, checklist, DEFAULT_WINDOW, cleanDetails, DETAIL_FIELDS };
