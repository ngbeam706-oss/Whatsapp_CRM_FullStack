// @ts-check
// Voice-call links and "incoming call" alerts, per business.
//
// The customer's call page (call.html) and the dashboard talk through Supabase Realtime broadcast.
// Those channels are public to anyone with the site's publishable key, so channel NAMES are the secret:
//
//  - Each call gets a random room (`room_<32 hex>`), so nobody can guess another call's room.
//  - A call link carries a signed token: { business, room, phone, name, outbound, expiry }. The page
//    sends it to POST /api/call-ring; the server checks the signature and only then rings the dashboard.
//  - Each business's dashboard listens on its own channel, `incoming_calls_<hmac(business)>`, whose name
//    is derived from a server secret and given only to signed-in staff of that business (/api/status).
//    A customer never learns it, and one business can never see another business's incoming calls.
//
// No database table is needed. (Later: Supabase Realtime private channels with RLS.)
const crypto = require('crypto');
const { config } = require('./config.cjs');
const { serviceHeaders, dbReady } = require('./db.cjs');
const { subKey } = require('./secrets.cjs');
const { isBusinessId } = require('./tenant.cjs');

const LINK_TTL_MS = 24 * 3600 * 1000; // a call link works for a day
const MAX_NAME = 60;

/**
 * @typedef {{ b: string, r: string, p: string, n: string, o: boolean, e: number }} CallTokenData
 *   b = business id, r = room, p = customer phone (digits), n = customer name, o = outbound (staff is
 *   already waiting in the room, so don't ring), e = expiry (ms since epoch)
 */

/** @param {Buffer} key @param {string} text */
const hmac = (key, text) => crypto.createHmac('sha256', key).update(text).digest('base64url');

function linkKey() {
  const key = subKey('call-links');
  if (!key) throw new Error('Server secret (APP_SECRET) is not configured: call links cannot be signed.');
  return key;
}

/**
 * The Realtime channel this business's dashboard listens on for incoming calls. Staff only.
 * @param {string} businessId
 */
function staffChannel(businessId) {
  const key = subKey('call-staff-channel');
  if (!key || !isBusinessId(businessId)) return null;
  return `incoming_calls_${hmac(key, businessId).slice(0, 32)}`;
}

/** @param {CallTokenData} data */
function signToken(data) {
  const body = Buffer.from(JSON.stringify(data)).toString('base64url');
  return `${body}.${hmac(linkKey(), body)}`;
}

/**
 * The token's data if its signature is valid and it hasn't expired; otherwise null.
 * @param {unknown} token @param {number} [now]
 * @returns {CallTokenData | null}
 */
function verifyToken(token, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 2000) return null;
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return null;
  let expected;
  try { expected = hmac(linkKey(), body); } catch { return null; }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!data || !isBusinessId(data.b) || !/^room_[0-9a-f]{32}$/.test(String(data.r)) || !(Number(data.e) > now)) return null;
    return { b: data.b, r: data.r, p: String(data.p || ''), n: String(data.n || ''), o: !!data.o, e: Number(data.e) };
  } catch {
    return null;
  }
}

/**
 * A call link for one customer of one business.
 * @param {{ businessId: string, businessName?: string | null, phone: string, name?: string | null, outbound: boolean, now?: number, baseUrl?: string }} input
 *   baseUrl: the app's address (server/siteUrl.cjs siteUrl()); default PUBLIC_SITE_URL
 * @returns {{ url: string, roomId: string }}
 */
function createCallLink({ businessId, businessName, phone, name, outbound, now = Date.now(), baseUrl = config.publicSiteUrl }) {
  if (!isBusinessId(businessId)) throw new Error('createCallLink: invalid business');
  const roomId = `room_${crypto.randomBytes(16).toString('hex')}`;
  const token = signToken({
    b: businessId,
    r: roomId,
    p: String(phone || '').replace(/\D/g, '').slice(0, 15),
    n: String(name || '').trim().slice(0, MAX_NAME),
    o: !!outbound,
    e: now + LINK_TTL_MS,
  });
  const params = new URLSearchParams({ room: roomId, t: token });
  const biz = String(businessName || '').trim().slice(0, 80);
  if (biz) params.set('business', biz);
  return { url: `${baseUrl}/call.html?${params.toString()}`, roomId };
}

/**
 * Send one Realtime broadcast from the server (Supabase Realtime REST API, server key).
 * @param {string} topic @param {string} event @param {Record<string, unknown>} payload
 */
async function broadcast(topic, event, payload) {
  if (!dbReady()) return false;
  const res = await fetch(`${config.supabaseUrl}/realtime/v1/api/broadcast`, {
    method: 'POST',
    headers: serviceHeaders(),
    body: JSON.stringify({ messages: [{ topic, event, payload }] }),
  });
  return res.ok;
}

/**
 * The customer opened a call link: ring that business's dashboard (only that business's).
 * @param {unknown} token
 * @returns {Promise<{ error: string, status: number } | { ok: true, rang: boolean }>}
 */
async function ring(token) {
  const data = verifyToken(token);
  if (!data) return { error: 'This call link is not valid or has expired. Ask the team for a new one.', status: 400 };
  // Staff started this call and are already waiting in the room: nothing to ring.
  if (data.o) return { ok: true, rang: false };
  const channel = staffChannel(data.b);
  if (!channel) return { error: 'Calls are not set up on this server.', status: 503 };
  const sent = await broadcast(channel, 'incoming_call', {
    name: data.n || (data.p ? `+${data.p}` : 'Customer'),
    phone: data.p,
    roomId: data.r,
  });
  if (!sent) return { error: 'Could not reach the team right now. Try again in a minute.', status: 502 };
  return { ok: true, rang: true };
}

module.exports = { staffChannel, createCallLink, verifyToken, signToken, ring, broadcast, LINK_TTL_MS };
