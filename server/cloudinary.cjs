// @ts-check
// Cloudinary for private images (clinic case-sheet photos). docs/progress/clinic.md
//
//   * Uploads are SIGNED with the API secret on the server (never an unsigned preset, never the secret in the
//     browser) and stored as type "authenticated": Cloudinary refuses plain public links to them.
//   * Viewing goes through short-lived private download links (Upload API "download", signed, expires_at), so a
//     link that leaks stops working after a few minutes.
//   * Each business has its own folder: case-sheets/<business id>/... ; public ids are random.
// Configure with CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET (or CLOUDINARY_URL).
const crypto = require('crypto');
const { config } = require('./config.cjs');

const API = 'https://api.cloudinary.com/v1_1';
const TIMEOUT_MS = 20000;

/** Is Cloudinary set up? */
const ready = () => !!(config.cloudinaryCloudName && config.cloudinaryApiKey && config.cloudinaryApiSecret);

/**
 * Cloudinary's request signature: the parameters (not file / api_key / resource_type / cloud_name), sorted by name,
 * joined as a=1&b=2, followed by the API secret, SHA-1 hex.
 * @param {Record<string, string | number>} params @param {string} [secret]
 */
function sign(params, secret = config.cloudinaryApiSecret) {
  const skip = new Set(['file', 'api_key', 'resource_type', 'cloud_name', 'signature']);
  const base = Object.keys(params).filter(k => !skip.has(k) && params[k] !== '' && params[k] !== undefined && params[k] !== null)
    .sort().map(k => `${k}=${params[k]}`).join('&');
  return crypto.createHash('sha1').update(base + secret).digest('hex');
}

/** @param {Record<string, string | number>} params */
function signed(params) {
  return { ...params, api_key: config.cloudinaryApiKey, signature: sign(params) };
}

/**
 * Upload a private image. Returns its public id and format, or an error.
 * @param {Buffer} bytes @param {string} mime @param {{ folder: string, publicId: string }} where
 * @returns {Promise<{ publicId: string, format: string, bytes: number } | { error: string }>}
 */
async function uploadPrivate(bytes, mime, { folder, publicId }) {
  if (!ready()) return { error: 'Cloudinary is not configured.' };
  const params = signed({ folder, public_id: publicId, type: 'authenticated', overwrite: 'false', timestamp: Math.floor(Date.now() / 1000) });
  const form = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), file: `data:${mime};base64,${bytes.toString('base64')}` });
  try {
    const res = await fetch(`${API}/${encodeURIComponent(config.cloudinaryCloudName)}/image/upload`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form, signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    /** @type {any} */
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    if (!res.ok || !data?.public_id) return { error: res.status === 401 ? 'Cloudinary refused the server\'s keys.' : `Cloudinary could not store the photo${data?.error?.message ? `: ${String(data.error.message).slice(0, 200)}` : '.'}` };
    if (data.type && data.type !== 'authenticated') return { error: 'Cloudinary stored the photo with the wrong access type.' };
    return { publicId: String(data.public_id), format: String(data.format || 'jpg'), bytes: Number(data.bytes) || bytes.length };
  } catch {
    return { error: 'Could not reach Cloudinary. Try again.' };
  }
}

/**
 * A link that shows a private image for a few minutes (Cloudinary's signed private download URL).
 * @param {string} publicId @param {string} format @param {number} seconds
 */
function privateUrl(publicId, format, seconds) {
  if (!ready()) return null;
  const now = Math.floor(Date.now() / 1000);
  const params = signed({ public_id: publicId, format, type: 'authenticated', timestamp: now, expires_at: now + seconds });
  const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])));
  return `${API}/${encodeURIComponent(config.cloudinaryCloudName)}/image/download?${qs}`;
}

/** Delete a private image. @param {string} publicId */
async function destroy(publicId) {
  if (!ready()) return false;
  const params = signed({ public_id: publicId, type: 'authenticated', invalidate: 'true', timestamp: Math.floor(Date.now() / 1000) });
  try {
    const res = await fetch(`${API}/${encodeURIComponent(config.cloudinaryCloudName)}/image/destroy`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))), signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

module.exports = { ready, sign, uploadPrivate, privateUrl, destroy };
