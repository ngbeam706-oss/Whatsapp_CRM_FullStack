// @ts-check
// Ads phase E1: bookings back to Meta (Conversions API for business messaging; docs/progress/ads-module.md).
//
// When a chat that came from a Click-to-WhatsApp ad (its referral has Meta's `ctwa_clid`) reaches Booked,
// Completed or Returning, one event is queued here. The 5-minute worker sends it to the dataset of the WhatsApp
// Business Account the customer wrote to, so Meta learns which ad clicks became bookings and can show the ads
// to people likely to book. Off by default (Business Admin switch on the Ads page). Meta does not deduplicate,
// so the queue does: one event per lead + ad click + event name (unique index).
//
// Nothing here ever blocks or fails a stage change: queueing is one insert inside try/catch, sending is the
// worker's job. Only Meta's click id is sent (no names, numbers or message text).
const { dbRequest } = require('./db.cjs');
const { requireBusinessId } = require('./tenant.cjs');

/** @typedef {import('./types.cjs').Staff} Staff */
/** @typedef {Record<string, any>} Row */

const CONVERTED = ['ordered', 'completed', 'repeat'];   // Booked, Completed, Returning
const MAX_ATTEMPTS = 5;
const MAX_AGE_MS = 7 * 86400000;                        // Meta accepts events up to 7 days old
const DIGITS_RE = /^\d{5,30}$/;

/** @param {unknown} err */
const errText = (err) => (err instanceof Error ? err.message : String(err));

/** The business's settings (defaults when none are saved, or the table isn't there yet). @param {string} biz */
async function getSettings(biz) {
  const r = await dbRequest(`ad_conversion_settings?business_id=eq.${requireBusinessId(biz)}&select=enabled,booking_value,currency,updated_by,updated_at`);
  const row = r.ok && Array.isArray(r.data) ? r.data[0] : null;
  return {
    enabled: !!row?.enabled,
    bookingValue: row?.booking_value != null ? Number(row.booking_value) : null,
    currency: row?.currency || 'INR',
    updatedBy: row?.updated_by || null,
    updatedAt: row?.updated_at || null,
    tableReady: r.ok,
  };
}

/** Pure: which Meta event a booking becomes. With a value: Purchase (Meta can optimise for value). @param {number | null} value */
const eventFor = (value) => (value && value > 0 ? 'Purchase' : 'LeadSubmitted');

/** Pure: Meta's click id from a lead's ad referral, or null. @param {unknown} referral */
function clickIdOf(referral) {
  const r = /** @type {Row | null} */ (referral && typeof referral === 'object' ? referral : null);
  const id = r?.ctwa_clid;
  return typeof id === 'string' && id.length >= 4 && id.length <= 500 ? id : null;
}

/**
 * A lead's stage changed. If it is now a booking and came from a Click-to-WhatsApp ad, queue one event.
 * Never throws (a stage change must never fail because of this).
 * @param {string} biz @param {{ phone?: string, referral?: unknown } | null | undefined} lead @param {string} stage
 */
async function onStage(biz, lead, stage) {
  try {
    // By the status's TYPE (won / done / repeat), never its name: works for each business's own statuses.
    const ls = require('./leadStatuses.cjs');
    if (!lead?.phone || !CONVERTED.includes(ls.canonicalStage(await ls.listFor(biz), stage))) return { queued: false };
    const clid = clickIdOf(lead.referral);
    if (!clid) return { queued: false };
    const s = await getSettings(biz);
    if (!s.enabled) return { queued: false };
    const event = eventFor(s.bookingValue);
    const r = await dbRequest('ad_conversions?on_conflict=business_id,phone,ctwa_clid,event_name', {
      method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal',
      body: { business_id: biz, phone: String(lead.phone), ctwa_clid: clid, event_name: event, stage, value: event === 'Purchase' ? s.bookingValue : null, currency: event === 'Purchase' ? s.currency : null },
    });
    return { queued: r.ok };
  } catch (err) {
    console.warn('[ad-conversions] queue failed:', errText(err));
    return { queued: false };
  }
}

/** The WABA's dataset id (from our table, else created/fetched in Meta and remembered). @param {string} biz @param {any} wa */
async function datasetFor(biz, wa) {
  const waba = String(wa.wabaId || '');
  if (!DIGITS_RE.test(waba)) return { error: 'This WhatsApp number has no WhatsApp Business Account ID saved.' };
  const saved = await dbRequest(`ad_conversion_datasets?business_id=eq.${biz}&waba_id=eq.${waba}&select=dataset_id`);
  const known = saved.ok && Array.isArray(saved.data) ? saved.data[0]?.dataset_id : null;
  if (known) return { datasetId: String(known), waba };
  const { graph, metaMsg } = require('./whatsapp.cjs');
  // POST creates the dataset, or returns the existing one.
  const made = await graph(wa.graphVersion, wa.token, `${waba}/dataset`, { method: 'POST' });
  const id = made?.id ? String(made.id) : '';
  if (made?.error || !DIGITS_RE.test(id)) return { error: `Meta didn't give a dataset: ${metaMsg(made)}`, permission: isPermissionError(made) };
  await dbRequest('ad_conversion_datasets?on_conflict=business_id,waba_id', { method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal', body: { business_id: biz, waba_id: waba, dataset_id: id } });
  return { datasetId: id, waba };
}

/** Meta's "your token may not do this" errors: retrying won't help. @param {any} r */
function isPermissionError(r) {
  const code = Number(r?.error?.code);
  return [10, 100, 190, 200, 210, 270, 294].includes(code) && /permission|access|token|authori/i.test(String(r?.error?.message || ''));
}

/** Pure: the event Meta gets (only the click id identifies the person). @param {Row} row @param {string} waba */
function eventPayload(row, waba) {
  /** @type {Record<string, any>} */
  const e = {
    event_name: row.event_name,
    event_time: Math.floor(Date.parse(row.event_time || row.created_at) / 1000),
    action_source: 'business_messaging',
    messaging_channel: 'whatsapp',
    user_data: { whatsapp_business_account_id: waba, ctwa_clid: row.ctwa_clid },
  };
  if (row.event_name === 'Purchase' && Number(row.value) > 0) e.custom_data = { currency: row.currency || 'INR', value: Number(row.value) };
  return { data: [e] };
}

/** @param {number} id @param {Record<string, unknown>} body */
const patchRow = (id, body) => dbRequest(`ad_conversions?id=eq.${id}`, { method: 'PATCH', prefer: 'return=minimal', body });

/**
 * Worker: send waiting events (oldest first) until the time runs out. Returns counts only.
 * @param {{ deadlineMs?: number, batch?: number }} [opt]
 */
async function sweep({ deadlineMs = 8000, batch = 50 } = {}) {
  const started = Date.now();
  const totals = { sent: 0, failed: 0, retried: 0 };
  const r = await dbRequest(`ad_conversions?status=eq.pending&select=*&order=created_at.asc&limit=${batch}`);
  if (!r.ok || !Array.isArray(r.data) || !r.data.length) return totals;
  const { whatsappFor, graph, metaMsg } = require('./whatsapp.cjs');
  /** @type {Map<string, boolean>} */
  const enabled = new Map();
  for (const row of /** @type {Row[]} */ (r.data)) {
    if (Date.now() - started > deadlineMs) break;
    const biz = String(row.business_id);
    const fail = async (/** @type {string} */ msg, final = true) => {
      const attempts = Number(row.attempts || 0) + 1;
      const done = final || attempts >= MAX_ATTEMPTS;
      await patchRow(row.id, { status: done ? 'failed' : 'pending', attempts, error: msg.slice(0, 300) });
      if (done) totals.failed++; else totals.retried++;
    };
    try {
      if (!enabled.has(biz)) enabled.set(biz, (await getSettings(biz)).enabled);
      if (!enabled.get(biz)) { await fail('Switched off before it was sent.'); continue; }
      if (Date.now() - Date.parse(row.event_time || row.created_at) > MAX_AGE_MS) { await fail('Older than 7 days: Meta no longer accepts it.'); continue; }
      const wa = await whatsappFor(biz, row.phone);
      if (!wa) { await fail('No WhatsApp number is connected.'); continue; }
      const ds = await datasetFor(biz, wa);
      if (ds.error !== undefined) { await fail(ds.error, !!ds.permission); continue; }
      const sent = await graph(wa.graphVersion, wa.token, `${ds.datasetId}/events`, { method: 'POST', body: eventPayload(row, ds.waba) });
      if (sent?.error || !(Number(sent?.events_received) >= 1)) { await fail(`Meta refused it: ${metaMsg(sent)}`, isPermissionError(sent)); continue; }
      await patchRow(row.id, { status: 'sent', attempts: Number(row.attempts || 0) + 1, error: null, sent_at: new Date().toISOString() });
      totals.sent++;
    } catch (err) {
      await fail(errText(err), false);
    }
  }
  if (totals.failed) {
    await require('./events.cjs').logEvent({ level: 'warn', source: 'ads', code: 'conversion_failed', message: `${totals.failed} booking event(s) could not be sent to Meta` });
  }
  return totals;
}

/** The Conversions tab: settings, what was sent in the last 30 days, the last problem. @param {Staff} staff */
async function status(staff) {
  const biz = requireBusinessId(staff?.businessId);
  const settings = await getSettings(biz);
  const since = encodeURIComponent(new Date(Date.now() - 30 * 86400000).toISOString());
  const r = await dbRequest(`ad_conversions?business_id=eq.${biz}&created_at=gte.${since}&select=status,event_name,error,created_at,sent_at&order=created_at.desc&limit=500`);
  const rows = r.ok && Array.isArray(r.data) ? r.data : [];
  const count = (/** @type {string} */ s) => rows.filter((/** @type {Row} */ x) => x.status === s).length;
  const lastFailed = rows.find((/** @type {Row} */ x) => x.status === 'failed' || (x.status === 'pending' && x.error));
  return {
    settings,
    last30: { sent: count('sent'), waiting: count('pending'), failed: count('failed') },
    lastSentAt: rows.find((/** @type {Row} */ x) => x.status === 'sent')?.sent_at || null,
    lastError: lastFailed ? { message: lastFailed.error, at: lastFailed.created_at } : null,
    eventName: eventFor(settings.bookingValue),
  };
}

/**
 * Business Admin: switch on/off and set the average booking value (empty = no value).
 * @param {Staff} staff @param {{ enabled?: unknown, bookingValue?: unknown }} [input]
 */
async function saveSettings(staff, input = {}) {
  const biz = requireBusinessId(staff?.businessId);
  /** @type {Record<string, unknown>} */
  const body = { business_id: biz, updated_by: staff.email, updated_at: new Date().toISOString() };
  if (input.enabled !== undefined) body.enabled = input.enabled === true;
  if (input.bookingValue !== undefined) {
    const raw = input.bookingValue === null || input.bookingValue === '' ? null : Number(input.bookingValue);
    if (raw !== null && !(Number.isFinite(raw) && raw > 0 && raw <= 10000000)) return { error: 'The booking value must be a positive amount (or empty for no value).' };
    body.booking_value = raw === null ? null : Math.round(raw * 100) / 100;
  }
  const r = await dbRequest('ad_conversion_settings?on_conflict=business_id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body });
  if (!r.ok) return { error: 'Could not save. Has the Ads E SQL (20261125) been run?' };
  await dbRequest('audit_log', { method: 'POST', prefer: 'return=minimal', body: { business_id: biz, actor_email: staff.email, actor_role: staff.role, action: 'ads.conversions_settings', details: { enabled: body.enabled, bookingValue: body.booking_value } } });
  return { saved: true, ...(await status(staff)) };
}

module.exports = { CONVERTED, onStage, sweep, status, saveSettings, eventFor, clickIdOf, eventPayload, isPermissionError };
