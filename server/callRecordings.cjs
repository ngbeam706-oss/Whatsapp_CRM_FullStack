// @ts-check
// Recordings of WhatsApp calls answered in the dashboard (Phase 1). See supabase/migrations/20261119.
//
//   upload link  -> the person on the call gets a signed link for one piece (every 10 s) or the whole file
//   complete     -> the whole file is there: mark it ready, delete the pieces
//   play link    -> someone allowed to listen gets a 5-minute playback link (written to audit_log)
//   sweep        -> worker: join the pieces of calls whose browser closed mid-call; delete recordings
//                   older than RETENTION_DAYS
// Storage: private bucket BUCKET, folder per business: <business>/<call>.webm and <business>/<call>/part-00001.webm
const crypto = require('crypto');
const { dbRequest } = require('./db.cjs');
const { requireBusinessId } = require('./tenant.cjs');
const storage = require('./storage.cjs');
const events = require('./events.cjs');

/** @typedef {import('./types.cjs').Staff} Staff */
/** @typedef {Record<string, any>} Row */

const BUCKET = 'wa-call-recordings';
const MIME = 'audio/webm';
const RETENTION_DAYS = 90;
const MAX_PARTS = 1000;            // 10-second pieces: up to ~2.7 hours
const PLAY_LINK_SECONDS = 300;
const UPLOAD_WINDOW_MS = 30 * 60 * 1000; // the whole file may arrive up to 30 min after the call ends
const ORPHAN_AFTER_MS = 10 * 60 * 1000;  // pieces left 10 min after the call ended: the worker joins them

const CALL_ID_RE = /^wacid\.[A-Za-z0-9_\-=+/.]{4,300}$/;
/** Storage-safe name for a Meta call id. @param {string} callId */
const key = (callId) => crypto.createHash('sha256').update(callId).digest('hex').slice(0, 40);
/** @param {string} biz @param {string} callId */
const finalPath = (biz, callId) => `${biz}/${key(callId)}.webm`;
/** @param {string} biz @param {string} callId */
const partsFolder = (biz, callId) => `${biz}/${key(callId)}`;
/** @param {number} n */
const partName = (n) => `part-${String(n).padStart(5, '0')}.webm`;
const emailOf = (/** @type {Staff} */ s) => String(s?.email || '').toLowerCase();
const isManager = (/** @type {Staff} */ s) => s?.role === 'owner' || s?.role === 'manager';

/** @param {string} biz @param {string} callId @returns {Promise<Row | null>} */
async function loadCall(biz, callId) {
  const r = await dbRequest(`whatsapp_calls?business_id=eq.${biz}&id=eq.${encodeURIComponent(callId)}&select=*`);
  return r.ok ? r.data?.[0] || null : null;
}
/** @param {string} biz @param {string} callId @param {Record<string, unknown>} patch */
async function patchCall(biz, callId, patch) {
  return dbRequest(`whatsapp_calls?business_id=eq.${biz}&id=eq.${encodeURIComponent(callId)}`, {
    method: 'PATCH', prefer: 'return=minimal', body: { ...patch, updated_at: new Date().toISOString() },
  });
}

/**
 * The call this person may record: they answered it, and it is on or ended in the last 30 minutes.
 * @param {Staff} staff @param {unknown} callId
 */
async function myRecordableCall(staff, callId) {
  const biz = requireBusinessId(staff?.businessId);
  if (typeof callId !== 'string' || !CALL_ID_RE.test(callId)) return { biz, error: 'Invalid call.', status: 400 };
  const call = await loadCall(biz, callId);
  if (!call) return { biz, error: 'This call was not found.', status: 404 };
  if (String(call.answered_by || '').toLowerCase() !== emailOf(staff)) return { biz, error: 'Only the person who answered can record this call.', status: 403 };
  if (!['answering', 'answered', 'ended', 'failed'].includes(call.status)) return { biz, error: 'This call was not answered.', status: 409 };
  if (call.ended_at && Date.now() - Date.parse(call.ended_at) > UPLOAD_WINDOW_MS) return { biz, error: 'This call ended too long ago to upload its recording.', status: 409 };
  if (call.recording_status === 'ready' || call.recording_status === 'deleted') return { biz, error: 'This call\'s recording is already saved.', status: 409 };
  return { biz, call };
}

/**
 * A signed link to upload one piece (`part` 1..1000) or the whole file (`final`).
 * @param {Staff} staff @param {{ callId?: unknown, part?: unknown, final?: unknown }} input
 */
async function uploadUrl(staff, input = {}) {
  const m = await myRecordableCall(staff, input.callId);
  if (m.error || !m.call) return m;
  const callId = String(input.callId);
  const final = input.final === true;
  const part = Number(input.part);
  if (!final && !(Number.isInteger(part) && part >= 1 && part <= MAX_PARTS)) return { error: 'Invalid piece number.', status: 400 };
  await storage.ensureBucket(BUCKET, { mimeTypes: ['audio/webm', 'audio/ogg', 'audio/mp4'] });
  const path = final ? finalPath(m.biz, callId) : `${partsFolder(m.biz, callId)}/${partName(part)}`;
  const url = await storage.signedUploadUrl(BUCKET, path);
  if (!url) return { error: 'Could not prepare the upload. Try again.', status: 502 };
  if (m.call.recording_status !== 'recording') {
    await patchCall(m.biz, callId, { recording_status: 'recording', recording_path: finalPath(m.biz, callId), recording_started_at: m.call.recording_started_at || new Date().toISOString() });
  }
  return { url, contentType: MIME };
}

/**
 * The whole file was uploaded: mark the recording ready and remove the pieces.
 * @param {Staff} staff @param {{ callId?: unknown, seconds?: unknown }} input
 */
async function complete(staff, input = {}) {
  const m = await myRecordableCall(staff, input.callId);
  if (m.error || !m.call) return m;
  const callId = String(input.callId);
  const file = (await storage.list(BUCKET, m.biz)).find(o => o.name === `${key(callId)}.webm`);
  if (!file) return { error: 'The recording has not arrived yet.', status: 409 };
  const parts = await storage.list(BUCKET, partsFolder(m.biz, callId));
  await storage.remove(BUCKET, parts.map(p => `${partsFolder(m.biz, callId)}/${p.name}`));
  const seconds = Math.max(0, Math.min(6 * 3600, Math.round(Number(input.seconds) || 0)));
  await patchCall(m.biz, callId, { recording_status: 'ready', recording_path: finalPath(m.biz, callId), recording_bytes: file.size || null, recording_seconds: seconds || m.call.duration_sec || null });
  return { ready: true };
}

/**
 * Who may listen: managers and the Business Admin; the person who answered; the agent the chat is
 * assigned to. Gives a 5-minute playback link and writes it to the audit log.
 * @param {Staff} staff @param {{ callId?: unknown }} input
 */
async function playUrl(staff, input = {}) {
  const biz = requireBusinessId(staff?.businessId);
  const callId = input.callId;
  if (typeof callId !== 'string' || !CALL_ID_RE.test(callId)) return { error: 'Invalid call.', status: 400 };
  const call = await loadCall(biz, callId);
  if (!call) return { error: 'This call was not found.', status: 404 };
  if (call.recording_status !== 'ready' || !call.recording_path) {
    return { error: call.recording_status === 'recording' ? 'The recording is still being saved. Try again in a few minutes.' : call.recording_status === 'deleted' ? `This recording was deleted after ${RETENTION_DAYS} days.` : 'There is no recording of this call.', status: 404 };
  }
  if (!isManager(staff) && String(call.answered_by || '').toLowerCase() !== emailOf(staff)) {
    const lead = await dbRequest(`whatsapp_leads?business_id=eq.${biz}&phone=eq.${encodeURIComponent(call.phone)}&select=assigned_to`);
    const owner = lead.ok ? String(lead.data?.[0]?.assigned_to || '').toLowerCase() : '';
    if (owner !== emailOf(staff)) return { error: 'Only the person who answered, the chat\'s owner, managers and the Business Admin can listen to this call.', status: 403 };
  }
  const url = await storage.signedDownloadUrl(BUCKET, call.recording_path, PLAY_LINK_SECONDS);
  if (!url) return { error: 'Could not open the recording. Try again.', status: 502 };
  await dbRequest('audit_log', {
    method: 'POST', prefer: 'return=minimal',
    body: { business_id: biz, actor_email: staff.email, actor_role: staff.role, action: 'call.recording_played', details: { call: key(callId), phone: call.phone } },
  });
  return { url, seconds: call.recording_seconds || call.duration_sec || null, expiresIn: PLAY_LINK_SECONDS };
}

/**
 * Worker: join the pieces of recordings whose browser closed before uploading the whole file, and
 * delete recordings older than RETENTION_DAYS. Stops starting new work at the deadline.
 * @param {{ deadlineMs?: number }} [options]
 */
async function sweep({ deadlineMs = 8000 } = {}) {
  const stop = Date.now() + deadlineMs;
  let joined = 0, failed = 0, deleted = 0;
  const orphanBefore = encodeURIComponent(new Date(Date.now() - ORPHAN_AFTER_MS).toISOString());
  const pending = await dbRequest(`whatsapp_calls?recording_status=eq.recording&ended_at=lt.${orphanBefore}&select=business_id,id,duration_sec&limit=10`);
  for (const c of pending.ok ? pending.data || [] : []) {
    if (Date.now() > stop) break;
    const folder = partsFolder(c.business_id, c.id);
    const parts = (await storage.list(BUCKET, folder)).filter(p => /^part-\d{5}\.webm$/.test(p.name));
    if (!parts.length) { await patchCall(c.business_id, c.id, { recording_status: 'failed' }); failed++; continue; }
    /** @type {Buffer[]} */
    const buffers = [];
    for (const p of parts) {
      const b = await storage.download(BUCKET, `${folder}/${p.name}`);
      if (b) buffers.push(b);
    }
    const whole = Buffer.concat(buffers);
    if (!whole.length || !(await storage.upload(BUCKET, finalPath(c.business_id, c.id), whole, MIME))) {
      await events.logEvent({ level: 'warn', source: 'worker', businessId: c.business_id, code: 'recording_join_failed', message: 'Could not join a call recording' });
      failed++;
      continue;
    }
    await storage.remove(BUCKET, parts.map(p => `${folder}/${p.name}`));
    await patchCall(c.business_id, c.id, { recording_status: 'ready', recording_path: finalPath(c.business_id, c.id), recording_bytes: whole.length, recording_seconds: c.duration_sec || null });
    joined++;
  }
  const oldBefore = encodeURIComponent(new Date(Date.now() - RETENTION_DAYS * 86400000).toISOString());
  const old = await dbRequest(`whatsapp_calls?recording_status=eq.ready&created_at=lt.${oldBefore}&select=business_id,id,recording_path&limit=50`);
  const rows = old.ok ? old.data || [] : [];
  if (rows.length && Date.now() < stop) {
    await storage.remove(BUCKET, rows.map((/** @type {Row} */ r) => r.recording_path).filter(Boolean));
    for (const r of rows) await patchCall(r.business_id, r.id, { recording_status: 'deleted', recording_path: null });
    deleted = rows.length;
  }
  return { joined, failed, deleted };
}

module.exports = { uploadUrl, complete, playUrl, sweep, BUCKET, RETENTION_DAYS, key, finalPath, partsFolder };
