// @ts-check
// Encrypts secrets (like a customer's AI API key) before they are stored in the database.
// AES-256-GCM with a key derived from a server-only secret:
//   SETTINGS_ENCRYPTION_KEY if set, otherwise APP_SECRET (already required for webhooks).
// If that secret changes, stored keys can't be decrypted and must be entered again.
const crypto = require('crypto');

const VERSION = 'v1';

function masterSecret() {
  return (process.env.SETTINGS_ENCRYPTION_KEY || process.env.APP_SECRET || '').trim();
}

/** @param {string} secret */
function deriveKey(secret) {
  return Buffer.from(crypto.hkdfSync('sha256', secret, 'arogya-crm-settings', 'ai-provider-key', 32));
}

function canEncrypt() {
  return masterSecret().length >= 16;
}

/** @param {unknown} plain @returns {string} */
function encrypt(plain) {
  const secret = masterSecret();
  if (secret.length < 16) throw new Error('Server encryption secret is not configured (APP_SECRET).');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

/**
 * Returns the plain text, or null if it can't be decrypted (missing, tampered, or secret changed).
 * @param {unknown} stored
 * @returns {string | null}
 */
function decrypt(stored) {
  try {
    const [v, iv, tag, ct] = String(stored || '').split(':');
    if (v !== VERSION || !iv || !tag || !ct) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(masterSecret()), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/**
 * A server-only key for one purpose (e.g. signing call links), derived from the same server secret.
 * Each label gives a different key, so one use can't be turned into another. null if no secret is set.
 * @param {string} label @returns {Buffer | null}
 */
function subKey(label) {
  const secret = masterSecret();
  if (secret.length < 16) return null;
  return Buffer.from(crypto.hkdfSync('sha256', secret, 'arogya-crm-subkeys', label, 32));
}

module.exports = { encrypt, decrypt, canEncrypt, subKey };
