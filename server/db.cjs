// @ts-check
// Server-side Supabase access through the REST API, using the secret service key.
// The service key bypasses RLS, so it must never be sent to the browser.
const { config } = require('./config.cjs');
const { requireBusinessId } = require('./tenant.cjs');

// New-style keys (sb_secret_..., sb_publishable_...) go only in the `apikey` header;
// legacy JWT keys (eyJ...) are also sent as a Bearer token.
/** @param {Record<string, string>} [extra] @returns {Record<string, string>} */
function serviceHeaders(extra = {}) {
  const key = config.supabaseServiceKey;
  /** @type {Record<string, string>} */
  const headers = { apikey: key, 'Content-Type': 'application/json', ...extra };
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  return headers;
}

let warnedMissingKey = false;
function dbReady() {
  if (config.supabaseUrl && config.supabaseServiceKey) return true;
  if (!warnedMissingKey) {
    console.warn('[DB] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing: database writes are disabled.');
    warnedMissingKey = true;
  }
  return false;
}

/**
 * One Supabase REST call with the server key. Never throws for HTTP errors: check `ok`.
 * @param {string} pathAndQuery  e.g. `whatsapp_leads?business_id=eq.<id>&select=phone`
 * @param {{ method?: string, body?: unknown, prefer?: string }} [options]
 * @returns {Promise<import('./types.cjs').DbResult>}
 */
async function dbRequest(pathAndQuery, { method = 'GET', body, prefer } = {}) {
  if (!dbReady()) return { ok: false, status: 0, data: null };
  const headers = serviceHeaders(prefer ? { Prefer: prefer } : {});
  const res = await fetch(`${config.supabaseUrl}/rest/v1/${pathAndQuery}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!res.ok) console.warn(`[DB] ${method} ${pathAndQuery.split('?')[0]} -> ${res.status}`, data);
  return { ok: res.ok, status: res.status, data };
}

/** @param {unknown} v */
const digits = (v) => String(v || '').replace(/[^\d]/g, '');

/**
 * Number of rows matching a filter, using PostgREST's exact count (no rows are fetched). null on error.
 * @param {string} table @param {string} filter
 * @returns {Promise<number | null>}
 */
async function countRows(table, filter) {
  if (!dbReady()) return null;
  try {
    const res = await fetch(`${config.supabaseUrl}/rest/v1/${table}?select=*&limit=0&${filter}`, {
      headers: serviceHeaders({ Prefer: 'count=exact' }),
    });
    const range = res.headers.get('content-range') || '';
    const total = Number(range.split('/')[1]);
    return Number.isFinite(total) ? total : null;
  } catch {
    return null;
  }
}

/**
 * @typedef {{ id: string, direction: string, sender?: string, senderName?: string, recipient?: string,
 *   body?: string, type?: string, sentBy?: string | null, deliveryStatus?: string, timestamp?: string,
 *   numberId?: string | null, media?: { id?: string | null, mime?: string | null, name?: string | null, size?: number | null, path?: string | null } | null }} LoggedMessage
 *   numberId: Meta phone_number_id of the business number the message went through (several numbers per business).
 *   media: a photo / document / voice note / video (SQL 20261132): Meta's media id, type, file name, size, our copy.
 */

/** @param {string} businessId @param {LoggedMessage} msg */
async function logMessage(businessId, msg) {
  requireBusinessId(businessId);
  try {
    // Same WhatsApp message id twice (e.g. Meta retrying a webhook) is stored once.
    /** @type {Record<string, unknown>} */
    const row = {
      business_id: businessId,
      message_id: msg.id,
      direction: msg.direction,
      sender: msg.sender,
      sender_name: msg.senderName,
      recipient: msg.recipient,
      contact_phone: digits(msg.direction === 'inbound' ? msg.sender : msg.recipient) || null,
      body: msg.body,
      type: msg.type || 'text',
      sent_by: msg.sentBy || null,
      delivery_status: msg.direction === 'outbound' ? (msg.deliveryStatus || 'sent') : null,
      timestamp: msg.timestamp || new Date().toISOString(),
    };
    if (msg.numberId) row.phone_number_id = String(msg.numberId);
    const m = msg.media;
    if (m) {
      if (m.id) row.media_id = String(m.id).slice(0, 200);
      if (m.mime) row.media_mime = String(m.mime).slice(0, 100);
      if (m.name) row.media_name = String(m.name).slice(0, 240);
      if (Number.isFinite(Number(m.size)) && Number(m.size) > 0) row.media_size = Math.round(Number(m.size));
      if (m.path) row.media_path = String(m.path).slice(0, 300);
    }
    const save = () => dbRequest('whatsapp_messages?on_conflict=message_id', {
      method: 'POST',
      prefer: 'resolution=ignore-duplicates,return=minimal',
      body: row,
    });
    let res = await save();
    // Before migration 20261132 the media columns aren't there: store the message without them.
    const mediaCols = ['media_id', 'media_mime', 'media_name', 'media_size', 'media_path'];
    if (!res.ok && mediaCols.some(k => k in row)) { for (const k of mediaCols) delete row[k]; res = await save(); }
    // Before migration 20261122 the column isn't there: store the message without it.
    if (!res.ok && row.phone_number_id) { delete row.phone_number_id; await save(); }
  } catch (err) {
    console.warn('[DB] logMessage failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * @param {string} businessId @param {string} phone @param {string | null | undefined} name
 * @param {string | null | undefined} lastMessage @param {string | null} [source] @param {unknown} [referral]
 */
async function logLead(businessId, phone, name, lastMessage, source = 'Direct WhatsApp', referral = null) {
  requireBusinessId(businessId);
  /** @type {Record<string, unknown>} */
  const payload = {
    business_id: businessId,
    phone,
    name: name || `+${phone}`,
    last_message: lastMessage || '',
    last_contacted_at: new Date().toISOString(),
    status: 'active',
  };
  if (source) payload.source = source;
  if (referral) payload.referral = referral;

  // The same customer number is a separate contact in each business.
  const upsert = (/** @type {Record<string, unknown>} */ body) => dbRequest('whatsapp_leads?on_conflict=business_id,phone', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body,
  });

  try {
    // No name given (bot replies, calls): an existing contact keeps its name; only a new one gets "+<number>".
    if (!name) {
      const upd = await dbRequest(`whatsapp_leads?business_id=eq.${businessId}&phone=eq.${encodeURIComponent(phone)}`, {
        method: 'PATCH',
        prefer: 'return=representation',
        body: { last_message: payload.last_message, last_contacted_at: payload.last_contacted_at, status: 'active', ...(referral ? { referral } : {}) },
      });
      if (upd.ok && Array.isArray(upd.data) && upd.data.length) return;
    }
    const res = await upsert(payload);
    // Older schemas may not have the source/referral columns yet.
    if (!res.ok && (payload.source || payload.referral)) {
      delete payload.source;
      delete payload.referral;
      await upsert(payload);
    }
  } catch (err) {
    console.warn('[DB] logLead failed:', err instanceof Error ? err.message : err);
  }
}

/** Delivery receipts (sent -> delivered -> read, or failed) for the chat view's ticks. */
/** @type {Record<string, number>} */
const STATUS_ORDER = { sent: 1, delivered: 2, read: 3 };
/** @param {string} businessId @param {string | undefined} messageId @param {string | undefined} status */
async function updateMessageStatus(businessId, messageId, status) {
  requireBusinessId(businessId);
  if (!messageId || !status) return;
  // Only move forward: a late "delivered" must not overwrite "read".
  const allowedFrom = status === 'failed'
    ? ['sent']
    : Object.keys(STATUS_ORDER).filter(s => STATUS_ORDER[s] < (STATUS_ORDER[status] || 0));
  if (!allowedFrom.length) return;
  await dbRequest(
    `whatsapp_messages?business_id=eq.${businessId}&message_id=eq.${encodeURIComponent(messageId)}&or=(delivery_status.is.null,delivery_status.in.(${allowedFrom.join(',')}))`,
    { method: 'PATCH', prefer: 'return=minimal', body: { delivery_status: status } }
  );
}

module.exports = { dbRequest, logMessage, logLead, updateMessageStatus, digits, serviceHeaders, dbReady, countRows };
