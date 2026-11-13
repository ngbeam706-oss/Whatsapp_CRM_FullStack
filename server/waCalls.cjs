// @ts-check
// WhatsApp voice calls (WhatsApp Business Calling API): customers call the business's WhatsApp number
// and staff answer in the dashboard.
//
//   1. Customer taps the call button in WhatsApp. Meta sends a "calls" webhook, event "connect", with the
//      call's WebRTC offer (SDP). handleCallEvents() saves the call (status "ringing") and rings ONLY this
//      business's dashboard (its private Realtime channel, server/calls.cjs staffChannel). The offer is
//      not broadcast: the browser fetches it through the API after claiming the call.
//   2. A staff member presses Accept: claim() checks lead ownership (same rules as replying to the chat:
//      inbox.ensureCanAct) and takes the call atomically, so two people can't answer the same call.
//   3. The browser opens the microphone, answers the offer and sends its SDP answer: accept() passes it
//      to Meta with pre_accept. Once the browser's WebRTC connection is up, connect() sends accept (same
//      answer) and only then does the browser unmute the microphone (Meta: no media before accept's 200,
//      or the caller's first words are clipped). Audio flows browser <-> Meta directly.
//   4. Decline -> reject. Hang up -> terminate. Meta's "terminate" event closes the call either way.
//      Each call ends up as one line in the chat ("Missed WhatsApp call", "WhatsApp call, 2 min 5 s").
//
// Needs, in Meta: calling enabled on the phone number, and the app's webhook subscribed to "calls".
const { dbRequest, logMessage, logLead } = require('./db.cjs');
const { requireBusinessId } = require('./tenant.cjs');
const { connectionForNumber } = require('./whatsapp.cjs');
const { graphRequest, sendTextMessage } = require('./meta.cjs');

// Sent to the customer when a call they made is answered (calls are recorded for 90 days).
const RECORDING_NOTICE = '📞 This call is recorded for quality and training. Recordings are kept for 90 days.';
const { pushMessage, broadcastEvent } = require('./state.cjs');
const calls = require('./calls.cjs');
const inbox = require('./inbox.cjs');
const events = require('./events.cjs');

/** @typedef {import('./types.cjs').Staff} Staff */
/** @typedef {Record<string, any>} Row */

const CALL_ID_RE = /^wacid\.[A-Za-z0-9_\-=+/.]{4,300}$/;
const RING_MS = 60 * 1000;        // Meta gives 30-60 s to answer; older "ringing" calls are not offered
const MAX_SDP = 20000;

/** @param {unknown} err */
const errText = (err) => (err instanceof Error ? err.message : String(err));
/** @param {unknown} v */
const digits = (v) => String(v || '').replace(/\D/g, '').slice(0, 15);
/** @param {unknown} id */
const isCallId = (id) => typeof id === 'string' && CALL_ID_RE.test(id);
const emailOf = (/** @type {Staff} */ staff) => String(staff?.email || '').toLowerCase();

/** @param {string} biz @param {string} callId @returns {Promise<Row | null>} */
async function loadCall(biz, callId) {
  const r = await dbRequest(`whatsapp_calls?business_id=eq.${biz}&id=eq.${encodeURIComponent(callId)}&select=*`);
  return r.ok ? r.data?.[0] || null : null;
}

/** @param {string} biz @param {string} callId @param {Record<string, unknown>} patch @param {string} [onlyIf] extra filter */
async function patchCall(biz, callId, patch, onlyIf = '') {
  return dbRequest(`whatsapp_calls?business_id=eq.${biz}&id=eq.${encodeURIComponent(callId)}${onlyIf}`, {
    method: 'PATCH', prefer: 'return=representation', body: { ...patch, updated_at: new Date().toISOString() },
  });
}

/** Ring / update every open dashboard of this business. @param {string} biz @param {string} event @param {Record<string, unknown>} payload */
async function notify(biz, event, payload) {
  const channel = calls.staffChannel(biz);
  if (!channel) return;
  try { await calls.broadcast(channel, event, payload); } catch (err) { console.warn('[wa-call] broadcast failed:', errText(err)); }
}

/** "2 min 5 s". @param {number} sec */
function duration(sec) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return m ? `${m} min ${s % 60} s` : `${s} s`;
}

/**
 * One line in the customer's chat for a finished call.
 * @param {string} biz @param {Row} call
 */
async function logCallInChat(biz, call) {
  const body = call.status === 'ended'
    ? `📞 WhatsApp call${call.duration_sec ? `, ${duration(call.duration_sec)}` : ''}${call.answered_by ? ` (answered by ${call.answered_by})` : ''}`
    : call.status === 'declined' ? `📞 WhatsApp call declined${call.answered_by ? ` by ${call.answered_by}` : ''}`
      : call.status === 'failed' ? '📞 WhatsApp call could not connect'
        : '📞 Missed WhatsApp call';
  const item = {
    id: `${call.id}_log`, direction: 'inbound', sender: call.phone, senderName: call.contact_name || `+${call.phone}`,
    body, type: 'call', timestamp: new Date().toISOString(), numberId: call.phone_number_id || null,
  };
  pushMessage(item, biz);
  broadcastEvent('message', item, biz);
  await logMessage(biz, item);
  await touchLead(biz, call.phone, call.contact_name || null, body);
}

/**
 * Show the call as the contact's latest activity. An existing contact keeps its name (a call has no
 * reliable name of its own); a new caller becomes a contact.
 * @param {string} biz @param {string} phone @param {string | null} name @param {string} text
 */
async function touchLead(biz, phone, name, text) {
  const upd = await dbRequest(`whatsapp_leads?business_id=eq.${biz}&phone=eq.${encodeURIComponent(phone)}`, {
    method: 'PATCH', prefer: 'return=representation',
    body: { last_message: text, last_contacted_at: new Date().toISOString() },
  });
  if (!(upd.ok && upd.data?.length)) await logLead(biz, phone, name, text);
}

// ---------------------------------------------------------------------------
// Webhook (Meta -> server)
// ---------------------------------------------------------------------------

/**
 * The "calls" part of one webhook change.
 * @param {string} biz @param {any} value  change.value (has .calls) @param {string} contactName
 */
async function handleCallEvents(biz, value, contactName) {
  requireBusinessId(biz);
  for (const c of Array.isArray(value?.calls) ? value.calls : []) {
    if (!isCallId(c?.id)) continue;
    try {
      if (c.event === 'connect') await onConnect(biz, c, contactName, value);
      else if (c.event === 'terminate') await onTerminate(biz, c);
    } catch (err) {
      await events.logEvent({ level: 'error', source: 'webhook', businessId: biz, code: 'call_event_failed', message: errText(err) });
    }
  }
}

/** @param {string} biz @param {any} c @param {string} contactName @param {any} value */
async function onConnect(biz, c, contactName, value) {
  // Only customer-initiated calls are answered here (the dashboard doesn't start WhatsApp calls).
  if (c.direction && c.direction !== 'USER_INITIATED') return;
  // `from` can be missing for customers who use a WhatsApp username: fall back to the contact's wa_id.
  const phone = digits(c.from) || digits(value?.contacts?.[0]?.wa_id);
  const offer = c.session?.sdp_type === 'offer' ? String(c.session.sdp || '') : '';
  if (!phone || !offer) return;
  const name = contactName && contactName !== 'WhatsApp User' ? contactName : null;
  // Same call id twice (Meta retrying the webhook) is stored once and rings once.
  /** @type {Record<string, unknown>} */
  const row = { business_id: biz, id: c.id, phone, contact_name: name, direction: 'USER_INITIATED', status: 'ringing', offer_sdp: offer.slice(0, MAX_SDP) };
  // Which of the business's numbers was called: answering must go through that number.
  const numberId = String(value?.metadata?.phone_number_id || '');
  if (/^\d{5,30}$/.test(numberId)) row.phone_number_id = numberId;
  const insert = () => dbRequest('whatsapp_calls?on_conflict=business_id,id', {
    method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation', body: row,
  });
  let ins = await insert();
  // Before migration 20261122 the column isn't there: the call is answered via the main number.
  if (!ins.ok && row.phone_number_id) { delete row.phone_number_id; ins = await insert(); }
  if (!ins.ok) throw new Error(`Could not save the call (${ins.status}). Has the WhatsApp calls SQL (20261116) been run?`);
  if (!ins.data?.length) return; // a retry of a call we already have
  await touchLead(biz, phone, name, '📞 Incoming WhatsApp call');
  await notify(biz, 'wa_call', { callId: c.id, phone, name: name || `+${phone}`, numberId: row.phone_number_id || null });
}

/** @param {string} biz @param {any} c */
async function onTerminate(biz, c) {
  const call = await loadCall(biz, c.id);
  if (!call) return;
  if (['ended', 'missed', 'declined', 'failed'].includes(call.status)) { await notify(biz, 'wa_call_end', { callId: c.id }); return; }
  const now = new Date().toISOString();
  const answered = call.status === 'answered';
  const sec = Number(c.duration) || (answered && call.answered_at ? (Date.now() - Date.parse(call.answered_at)) / 1000 : 0);
  const status = answered ? 'ended' : String(c.status || '').toLowerCase() === 'failed' && call.status === 'answering' ? 'failed' : 'missed';
  const upd = await patchCall(biz, c.id, { status, ended_at: now, duration_sec: answered ? Math.round(sec) : null, end_reason: String(c.status || '').slice(0, 40) || null, offer_sdp: null, answer_sdp: null }, '&status=in.(ringing,answering,answered)');
  if (upd.ok && upd.data?.length) await logCallInChat(biz, upd.data[0]);
  await notify(biz, 'wa_call_end', { callId: c.id });
}

// ---------------------------------------------------------------------------
// Dashboard (staff -> server -> Meta)
// ---------------------------------------------------------------------------

/** Calls ringing right now (for a dashboard that opens while a call is ringing). @param {Staff} staff */
async function ringing(staff) {
  const biz = requireBusinessId(staff?.businessId);
  const since = encodeURIComponent(new Date(Date.now() - RING_MS).toISOString());
  // select=* so this keeps working before the number column exists (SQL 20261122).
  const r = await dbRequest(`whatsapp_calls?business_id=eq.${biz}&status=eq.ringing&created_at=gte.${since}&select=*&order=created_at.desc&limit=5`);
  return { calls: (r.ok ? r.data || [] : []).map((/** @type {Row} */ c) => ({ callId: c.id, phone: c.phone, name: c.contact_name || `+${c.phone}`, since: c.created_at, numberId: c.phone_number_id || null })) };
}

/** @param {Row | null} call */
function notRinging(call) {
  if (!call) return { error: 'This call was not found.', status: 404 };
  if (call.status === 'answering' || call.status === 'answered') return { error: `${call.answered_by || 'Someone else'} is already on this call.`, status: 409 };
  if (call.status !== 'ringing') return { error: 'This call has already ended.', status: 409 };
  if (Date.now() - Date.parse(call.created_at) > RING_MS) return { error: 'This call has already ended.', status: 409 };
  return null;
}

/**
 * Take the call (before opening the microphone). Lead ownership: the same rule as replying to the chat.
 * @param {Staff} staff @param {unknown} rawId
 */
async function claim(staff, rawId) {
  const biz = requireBusinessId(staff?.businessId);
  if (!isCallId(rawId)) return { error: 'Invalid call.', status: 400 };
  const callId = String(rawId);
  const call = await loadCall(biz, callId);
  const bad = notRinging(call);
  if (bad || !call) return bad || { error: 'This call was not found.', status: 404 };
  const can = await inbox.ensureCanAct(call.phone, staff);
  if (can.error) return can;
  const took = await patchCall(biz, callId, { status: 'answering', answered_by: emailOf(staff) }, '&status=eq.ringing');
  if (!took.ok || !took.data?.length) {
    const now = await loadCall(biz, callId);
    return notRinging(now) || { error: 'Could not take the call. Try again.', status: 409 };
  }
  await notify(biz, 'wa_call_taken', { callId, by: emailOf(staff) });
  return { callId, phone: call.phone, name: call.contact_name || `+${call.phone}`, offer: call.offer_sdp };
}

/** The call this staff member is answering (status answering/answered, by them). @param {Staff} staff @param {unknown} callId */
async function mine(staff, callId) {
  const biz = requireBusinessId(staff?.businessId);
  if (!isCallId(callId)) return { biz, error: 'Invalid call.', status: 400 };
  const call = await loadCall(biz, String(callId));
  if (!call) return { biz, error: 'This call was not found.', status: 404 };
  if (call.answered_by !== emailOf(staff)) return { biz, error: 'This call is not yours.', status: 403 };
  return { biz, call };
}

/** @param {string} biz @param {Row} call @param {string} action @param {string} [sdp] */
async function tellMeta(biz, call, action, sdp) {
  const wa = await connectionForNumber(biz, call.phone_number_id);
  if (!wa) return { error: { message: 'This business has no WhatsApp number connected.' } };
  /** @type {Record<string, unknown>} */
  const body = { messaging_product: 'whatsapp', call_id: call.id, action };
  if (sdp) body.session = { sdp_type: 'answer', sdp };
  const r = await graphRequest(wa, `${wa.phoneNumberId}/calls`, { method: 'POST', body });
  if (r?.error) await events.logEvent({ level: 'warn', source: 'meta', businessId: biz, code: `call_${action}_failed`, message: r.error.message || 'Meta refused' });
  return r;
}

/**
 * Step 1 of answering (Meta's order): send the browser's WebRTC answer with pre_accept, so the audio
 * connection can be set up while the call is still ringing for the customer. The answer is kept: accept
 * must send the same one.
 * @param {Staff} staff @param {unknown} callId @param {unknown} sdp
 */
async function accept(staff, callId, sdp) {
  const m = await mine(staff, callId);
  if (m.error || !m.call) return m;
  if (m.call.status !== 'answering') return { error: m.call.status === 'answered' ? 'Already connected.' : 'This call has already ended.', status: 409 };
  const answer = String(sdp || '');
  if (!answer.startsWith('v=0') || answer.length > MAX_SDP) return { error: 'The browser\'s call answer is not valid.', status: 400 };
  const pre = await tellMeta(m.biz, m.call, 'pre_accept', answer);
  if (pre?.error) {
    await patchCall(m.biz, m.call.id, { status: 'ringing', answered_by: null }, '&status=eq.answering');
    return { error: `WhatsApp didn't accept the answer: ${pre.error.message || 'unknown error'}`, status: 502 };
  }
  await patchCall(m.biz, m.call.id, { answer_sdp: answer }, '&status=eq.answering');
  return { preAccepted: true };
}

/**
 * Step 2: the browser's audio connection is up (or it waited long enough): accept the call. Only after
 * this does the customer see the call as answered, and the browser starts sending the microphone.
 * @param {Staff} staff @param {unknown} callId
 */
async function connect(staff, callId) {
  const m = await mine(staff, callId);
  if (m.error || !m.call) return m;
  if (m.call.status === 'answered') return { connected: true };
  if (m.call.status !== 'answering' || !m.call.answer_sdp) return { error: 'This call has already ended.', status: 409 };
  const acc = await tellMeta(m.biz, m.call, 'accept', m.call.answer_sdp);
  if (acc?.error) {
    const upd = await patchCall(m.biz, m.call.id, { status: 'failed', ended_at: new Date().toISOString(), offer_sdp: null, answer_sdp: null, end_reason: 'accept_failed' }, '&status=eq.answering');
    if (upd.ok && upd.data?.length) await logCallInChat(m.biz, upd.data[0]);
    await notify(m.biz, 'wa_call_end', { callId: m.call.id });
    return { error: `WhatsApp didn't connect the call: ${acc.error.message || 'unknown error'}`, status: 502 };
  }
  await patchCall(m.biz, m.call.id, { status: 'answered', answered_at: new Date().toISOString() }, '&status=eq.answering');
  // The call is recorded (server/callRecordings.cjs): tell the customer in the chat too. Best effort:
  // WhatsApp may refuse a free-text message outside the 24-hour window; the agent is also reminded to say it.
  try {
    const wa = await connectionForNumber(m.biz, m.call.phone_number_id);
    if (wa) await sendTextMessage(wa, m.call.phone, RECORDING_NOTICE);
  } catch (err) {
    console.warn('[wa-call] recording notice not sent:', errText(err));
  }
  return { connected: true, recording: true, notice: RECORDING_NOTICE };
}

/**
 * Give the call back (e.g. the microphone was blocked) so someone else can answer it.
 * @param {Staff} staff @param {unknown} callId
 */
async function release(staff, callId) {
  const m = await mine(staff, callId);
  if (m.error || !m.call) return m;
  await patchCall(m.biz, m.call.id, { status: 'ringing', answered_by: null, answer_sdp: null }, '&status=eq.answering');
  await notify(m.biz, 'wa_call', { callId: m.call.id, phone: m.call.phone, name: m.call.contact_name || `+${m.call.phone}`, numberId: m.call.phone_number_id || null });
  return { released: true };
}

/**
 * Decline a ringing call (anyone who may act on the chat), or end the call I'm on.
 * @param {Staff} staff @param {unknown} callId
 */
async function hangUp(staff, callId) {
  const biz = requireBusinessId(staff?.businessId);
  if (!isCallId(callId)) return { error: 'Invalid call.', status: 400 };
  const call = await loadCall(biz, String(callId));
  if (!call) return { error: 'This call was not found.', status: 404 };
  if (['ended', 'missed', 'declined', 'failed'].includes(call.status)) return { ended: true };
  const ringingNow = call.status === 'ringing';
  if (ringingNow) {
    const can = await inbox.ensureCanAct(call.phone, staff);
    if (can.error) return can;
  } else if (call.answered_by !== emailOf(staff)) {
    return { error: `${call.answered_by} is on this call.`, status: 403 };
  }
  const r = await tellMeta(biz, call, ringingNow ? 'reject' : 'terminate');
  const now = new Date().toISOString();
  const answered = call.status === 'answered';
  const upd = await patchCall(biz, call.id, {
    status: ringingNow ? 'declined' : answered ? 'ended' : 'missed',
    answered_by: ringingNow ? emailOf(staff) : call.answered_by,
    ended_at: now,
    duration_sec: answered && call.answered_at ? Math.round((Date.now() - Date.parse(call.answered_at)) / 1000) : null,
    end_reason: ringingNow ? 'declined' : 'hung_up',
    offer_sdp: null,
    answer_sdp: null,
  }, '&status=in.(ringing,answering,answered)');
  if (upd.ok && upd.data?.length) await logCallInChat(biz, upd.data[0]);
  await notify(biz, 'wa_call_end', { callId: call.id });
  // The call is closed here even if Meta refused (it may have ended on its side already).
  return r?.error ? { ended: true, note: r.error.message || '' } : { ended: true };
}

module.exports = { handleCallEvents, ringing, claim, accept, connect, release, hangUp, isCallId, duration, RING_MS };
