// @ts-check
// Supabase Storage from the server (service key): private buckets, short-lived signed links, listing,
// joining and deleting objects. The browser never gets the key; it only gets signed links for one
// object at a time (upload or playback), which expire.
const { config } = require('./config.cjs');
const { serviceHeaders, dbReady } = require('./db.cjs');

const base = () => `${config.supabaseUrl}/storage/v1`;
/** "a/b c.webm" -> "a/b%20c.webm" (each segment encoded, slashes kept). @param {string} path */
const enc = (path) => path.split('/').map(encodeURIComponent).join('/');

/** @param {string} url @param {RequestInit} [opts] */
async function call(url, opts = {}) {
  const res = await fetch(url, opts);
  /** @type {any} */
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  return { ok: res.ok, status: res.status, data };
}

/** @type {Set<string>} */
const ensured = new Set();
/**
 * Make sure a private bucket exists (once per server instance).
 * @param {string} bucket @param {{ maxBytes?: number, mimeTypes?: string[] }} [options]
 */
async function ensureBucket(bucket, { maxBytes = 52428800, mimeTypes } = {}) {
  if (ensured.has(bucket) || !dbReady()) return;
  const got = await call(`${base()}/bucket/${encodeURIComponent(bucket)}`, { headers: serviceHeaders() });
  if (!got.ok) {
    await call(`${base()}/bucket`, {
      method: 'POST', headers: serviceHeaders(),
      body: JSON.stringify({ id: bucket, name: bucket, public: false, file_size_limit: maxBytes, allowed_mime_types: mimeTypes }),
    });
  }
  ensured.add(bucket);
}

/**
 * A link the browser can PUT one file to (valid ~2 hours, Supabase's default), or null.
 * @param {string} bucket @param {string} path
 * @returns {Promise<string | null>}
 */
async function signedUploadUrl(bucket, path) {
  const r = await call(`${base()}/object/upload/sign/${encodeURIComponent(bucket)}/${enc(path)}`, {
    method: 'POST', headers: serviceHeaders({ 'x-upsert': 'true' }), body: '{}',
  });
  const rel = r.data?.url;
  return r.ok && typeof rel === 'string' ? `${base()}${rel.startsWith('/') ? '' : '/'}${rel}` : null;
}

/**
 * A playback/download link valid for `seconds`, or null.
 * @param {string} bucket @param {string} path @param {number} seconds
 * @returns {Promise<string | null>}
 */
async function signedDownloadUrl(bucket, path, seconds) {
  const r = await call(`${base()}/object/sign/${encodeURIComponent(bucket)}/${enc(path)}`, {
    method: 'POST', headers: serviceHeaders(), body: JSON.stringify({ expiresIn: seconds }),
  });
  const rel = r.data?.signedURL || r.data?.signedUrl;
  return r.ok && typeof rel === 'string' ? `${base()}${rel.startsWith('/') ? '' : '/'}${rel}` : null;
}

/**
 * Objects directly inside a folder: [{ name, size }] sorted by name.
 * @param {string} bucket @param {string} folder
 * @returns {Promise<Array<{ name: string, size: number }>>}
 */
async function list(bucket, folder) {
  const r = await call(`${base()}/object/list/${encodeURIComponent(bucket)}`, {
    method: 'POST', headers: serviceHeaders(),
    body: JSON.stringify({ prefix: folder, limit: 1000, offset: 0, sortBy: { column: 'name', order: 'asc' } }),
  });
  if (!r.ok || !Array.isArray(r.data)) return [];
  return r.data
    .filter((/** @type {any} */ o) => o && o.name && o.id !== null)
    .map((/** @type {any} */ o) => ({ name: String(o.name), size: Number(o.metadata?.size) || 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** @param {string} bucket @param {string} path @returns {Promise<Buffer | null>} */
async function download(bucket, path) {
  const res = await fetch(`${base()}/object/${encodeURIComponent(bucket)}/${enc(path)}`, { headers: serviceHeaders() });
  return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
}

/** @param {string} bucket @param {string} path @param {Buffer} body @param {string} contentType */
async function upload(bucket, path, body, contentType) {
  const res = await fetch(`${base()}/object/${encodeURIComponent(bucket)}/${enc(path)}`, {
    method: 'POST', headers: { ...serviceHeaders({ 'x-upsert': 'true' }), 'Content-Type': contentType }, body,
  });
  return res.ok;
}

/** @param {string} bucket @param {string[]} paths */
async function remove(bucket, paths) {
  if (!paths.length) return true;
  const r = await call(`${base()}/object/${encodeURIComponent(bucket)}`, {
    method: 'DELETE', headers: serviceHeaders(), body: JSON.stringify({ prefixes: paths }),
  });
  return r.ok;
}

/** Tests only. */
function _resetBuckets() { ensured.clear(); }

module.exports = { ensureBucket, signedUploadUrl, signedDownloadUrl, list, download, upload, remove, _resetBuckets };
