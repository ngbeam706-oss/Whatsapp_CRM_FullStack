// @ts-check
// Photos, documents, voice notes / audio and videos in the inbox (SQL 20261132).
//
// Incoming: the webhook saves Meta's media id with the message. The first time someone opens it, the server
//   downloads it from Meta (Meta keeps media for a limited time) into the private bucket `inbox-media` and gives the
//   browser a short-lived signed link. Later opens use that copy.
// Outgoing: the browser uploads the file straight to private storage (Netlify can't carry big files), then the
//   server checks it, hands it to Meta (WhatsApp media upload) and sends it. Same rules as a text reply: the 24-hour
//   window, lead ownership (ensureCanAct), the business's own number.
// Only this business's staff, only this business's messages and files. Platform Admin never reaches these routes.
const crypto = require('crypto');
const { dbRequest } = require('./db.cjs');
const { requireBusinessId } = require('./tenant.cjs');
const storage = require('./storage.cjs');
const meta = require('./meta.cjs');
const inbox = require('./inbox.cjs');
const { getWhatsApp, connectionForNumber } = require('./whatsapp.cjs');

/** @typedef {import('./types.cjs').Staff} Staff */

const BUCKET = 'inbox-media';
const MAX_BYTES = 16 * 1024 * 1024; // WhatsApp: audio / video 16 MB; we cap documents at the same
const LINK_SECONDS = 3600;
// What staff may send, by type: WhatsApp's kind and its size limit.
/** @type {Record<string, { kind: 'image' | 'document' | 'audio' | 'video', ext: string, max: number }>} */
const SEND_TYPES = {
  'image/jpeg': { kind: 'image', ext: 'jpg', max: 5 * 1024 * 1024 },
  'image/png': { kind: 'image', ext: 'png', max: 5 * 1024 * 1024 },
  'application/pdf': { kind: 'document', ext: 'pdf', max: MAX_BYTES },
  'application/msword': { kind: 'document', ext: 'doc', max: MAX_BYTES },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { kind: 'document', ext: 'docx', max: MAX_BYTES },
  'application/vnd.ms-excel': { kind: 'document', ext: 'xls', max: MAX_BYTES },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { kind: 'document', ext: 'xlsx', max: MAX_BYTES },
  'text/plain': { kind: 'document', ext: 'txt', max: MAX_BYTES },
  'audio/mpeg': { kind: 'audio', ext: 'mp3', max: MAX_BYTES },
  'audio/mp4': { kind: 'audio', ext: 'm4a', max: MAX_BYTES },
  'audio/aac': { kind: 'audio', ext: 'aac', max: MAX_BYTES },
  'audio/ogg': { kind: 'audio', ext: 'ogg', max: MAX_BYTES },
  'video/mp4': { kind: 'video', ext: 'mp4', max: MAX_BYTES },
};
const EXT_TYPE = Object.fromEntries(Object.entries(SEND_TYPES).map(([mime, t]) => [t.ext, mime]));
const OUT_PATH_RE = /^([0-9a-f-]{36})\/out\/[0-9a-f-]{36}\.([a-z0-9]{2,4})$/;
const MESSAGE_ID_RE = /^[A-Za-z0-9._=:+/-]{5,200}$/;
const isPhone = (/** @type {unknown} */ p) => /^\d{7,15}$/.test(String(p || ''));
/** A file name safe to show and to send (no paths, no control characters). @param {unknown} n */
const safeName = (n) => String(n || '').replace(/[\\/\r\n\t<>"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);

/**
 * Pure: may this file be sent? { kind, ext } or { error } (tested).
 * @param {unknown} type @param {unknown} size
 */
function checkUpload(type, size) {
  const t = SEND_TYPES[String(type || '')];
  if (!t) return { error: 'Send a photo (JPG, PNG), a PDF / Word / Excel / text document, an audio file (MP3, M4A, AAC, OGG) or an MP4 video.' };
  const n = Number(size);
  if (!(n > 0)) return { error: 'That file is empty.' };
  if (n > t.max) return { error: `${t.kind === 'image' ? 'Photos' : 'Files'} can be up to ${t.max / 1024 / 1024} MB on WhatsApp.` };
  return { kind: t.kind, ext: t.ext };
}

/**
 * Staff: a one-time link to upload one file for this chat (to the business's own folder).
 * @param {Staff} staff @param {string} phone @param {Record<string, unknown>} input { type, size }
 */
async function uploadUrl(staff, phone, input = {}) {
  const biz = requireBusinessId(staff?.businessId);
  if (!isPhone(phone)) return { error: 'Invalid number.' };
  const ok = checkUpload(input.type, input.size);
  if ('error' in ok) return { error: ok.error };
  if (!(await inbox.getLead(biz, phone))) return { error: 'Contact not found.', status: 404 };
  await storage.ensureBucket(BUCKET, { maxBytes: MAX_BYTES });
  const path = `${biz}/out/${crypto.randomUUID()}.${ok.ext}`;
  const url = await storage.signedUploadUrl(BUCKET, path);
  if (!url) return { error: 'Could not prepare the upload. Try again.', status: 502 };
  return { uploadUrl: url, path };
}

/**
 * Staff: send the uploaded file to the customer (with an optional caption).
 * @param {Staff} staff @param {string} phone @param {Record<string, unknown>} input { path, caption, name, fromNumberId }
 */
async function sendMedia(staff, phone, input = {}) {
  const biz = requireBusinessId(staff?.businessId);
  if (!isPhone(phone)) return { error: 'Invalid number.' };
  const path = String(input.path || '');
  const m = path.match(OUT_PATH_RE);
  // Only a file uploaded for THIS business.
  if (!m || m[1] !== biz || !EXT_TYPE[m[2]]) return { error: 'That upload is not valid. Choose the file again.' };
  const mime = EXT_TYPE[m[2]];
  const { kind } = SEND_TYPES[mime];
  const caption = String(input.caption || '').trim();
  if (caption.length > 1024) return { error: 'The caption can be up to 1024 characters.' };
  const name = safeName(input.name) || `file.${m[2]}`;

  const pre = await inbox.getLead(biz, phone);
  if (!pre) return { error: 'Contact not found.', status: 404 };
  const route = await inbox.replyRoute(biz, phone, pre, input.fromNumberId);
  if (route.error !== undefined) return { error: route.error };
  const wa = route.wa;
  if (!wa) return { error: 'This business has no WhatsApp number connected yet.' };
  if (!inbox.isWindowOpen(route.lastInboundAt)) return { error: 'This customer hasn\'t messaged in the last 24 hours, so WhatsApp only allows an approved template. Files can be sent after they reply.', windowClosed: true };
  const access = await inbox.ensureCanAct(phone, staff);
  if (access.error !== undefined) return access;

  const bytes = await storage.download(BUCKET, path);
  if (!bytes) return { error: 'The uploaded file could not be found. Choose it again.' };
  const check = checkUpload(mime, bytes.length);
  if ('error' in check) return { error: check.error };
  const up = await meta.uploadMedia(wa, bytes, mime, name);
  if (up.error || !up.id) return { error: `WhatsApp didn't accept the file: ${up.error?.message || 'unknown error'}`, status: 502 };
  const res = await meta.sendMediaMessage(wa, phone, kind, String(up.id), { caption, filename: name });
  const wamid = res.messages?.[0]?.id;
  if (res.error || !wamid) return { error: res.error?.error_data?.details || res.error?.message || 'WhatsApp rejected the message.', status: 502 };
  const label = caption || (kind === 'image' ? '📷 Photo' : kind === 'audio' ? '🎵 Audio' : kind === 'video' ? '🎬 Video' : `📄 ${name}`);
  await inbox.recordOutbound(biz, wa, phone, wamid, label, kind, staff.email, { id: String(up.id), mime, name, size: bytes.length, path });
  await inbox.afterStaffSend(biz, access.lead, staff.email, label);
  return { sent: true, id: wamid };
}

/**
 * Staff of the business: a short-lived link to one message's file (downloaded from Meta into private storage the
 * first time). { url, downloadUrl, mime, name } or { error }.
 * @param {Staff} staff @param {string} phone @param {string} messageId
 */
async function mediaLink(staff, phone, messageId) {
  const biz = requireBusinessId(staff?.businessId);
  if (!isPhone(phone) || !MESSAGE_ID_RE.test(String(messageId || ''))) return { error: 'Invalid file.' };
  const r = await dbRequest(`whatsapp_messages?select=message_id,type,media_id,media_mime,media_name,media_path,phone_number_id&business_id=eq.${biz}&contact_phone=eq.${phone}&message_id=eq.${encodeURIComponent(messageId)}`);
  const row = r.ok ? r.data?.[0] : null;
  if (!row || (!row.media_id && !row.media_path)) return { error: 'This message has no file.', status: 404 };
  const name = safeName(row.media_name) || `${row.type || 'file'}`;
  const link = async (/** @type {string} */ p) => {
    const url = await storage.signedDownloadUrl(BUCKET, p, LINK_SECONDS);
    return url ? { url, downloadUrl: `${url}&download=${encodeURIComponent(name)}`, mime: row.media_mime || null, name } : null;
  };
  // Our own copy (sent by staff, or opened before).
  if (row.media_path && String(row.media_path).startsWith(`${biz}/`)) {
    const done = await link(String(row.media_path));
    if (done) return done;
  }
  if (!/^\d{5,30}$/.test(String(row.media_id || ''))) return { error: 'This file is no longer available.', status: 410 };
  // First open: fetch it from Meta with the business's own token (the number the message came through).
  const wa = (row.phone_number_id ? await connectionForNumber(biz, String(row.phone_number_id)) : null) || await getWhatsApp(biz);
  if (!wa) return { error: 'This business has no WhatsApp number connected.' };
  const info = await meta.graphRequest(wa, String(row.media_id));
  if (info?.error || !info?.url) return { error: 'WhatsApp no longer has this file (Meta keeps media for a limited time).', status: 410 };
  if (Number(info.file_size) > MAX_BYTES) return { error: 'This file is too large to open here (over 16 MB). Open it in the WhatsApp Business app.', status: 413 };
  if (!/^https:\/\/[a-z0-9.-]+\.(fbsbx\.com|fbcdn\.net|facebook\.com|whatsapp\.net)\//i.test(String(info.url))) return { error: 'Unexpected file address from WhatsApp.', status: 502 };
  let bytes;
  try {
    const res = await fetch(String(info.url), { headers: { Authorization: `Bearer ${wa.token}` }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) return { error: 'Could not download the file from WhatsApp. Try again.', status: 502 };
    bytes = Buffer.from(await res.arrayBuffer());
  } catch {
    return { error: 'Could not download the file from WhatsApp. Try again.', status: 502 };
  }
  if (bytes.length > MAX_BYTES) return { error: 'This file is too large to open here (over 16 MB).', status: 413 };
  const mime = String(info.mime_type || row.media_mime || 'application/octet-stream').split(';')[0].slice(0, 100);
  const ext = (SEND_TYPES[mime]?.ext) || (mime.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'bin';
  const path = `${biz}/in/${crypto.createHash('sha256').update(String(row.message_id)).digest('hex').slice(0, 40)}.${ext}`;
  await storage.ensureBucket(BUCKET, { maxBytes: MAX_BYTES });
  if (!(await storage.upload(BUCKET, path, bytes, mime))) return { error: 'Could not save the file. Try again.', status: 502 };
  await dbRequest(`whatsapp_messages?business_id=eq.${biz}&message_id=eq.${encodeURIComponent(String(row.message_id))}`, {
    method: 'PATCH', prefer: 'return=minimal', body: { media_path: path, media_mime: mime, media_size: bytes.length },
  });
  return (await link(path)) || { error: 'Could not open the file. Try again.', status: 502 };
}

module.exports = { checkUpload, uploadUrl, sendMedia, mediaLink, BUCKET, SEND_TYPES, MAX_BYTES };
