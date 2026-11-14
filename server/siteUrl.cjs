// @ts-check
// The application's own address, used wherever the app builds a link to itself: each business's WhatsApp webhook
// URL (<address>/webhook/<key>), customers' call links, and the redirect in invite / password emails.
// The Platform Owner sets it once (Platform console -> Branding -> Application URL, e.g. a custom domain); empty =
// the PUBLIC_SITE_URL setting (default: the Netlify address). It is saved only after the app answers at
// <address>/api/health, so a typo can't break every business's links.
const { config } = require('./config.cjs');

const HEALTH_TIMEOUT_MS = 8000;
// Never an internal address: this is a public site, and the server must not be pointed at its own network.
const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[)/i;

/**
 * Pure: a clean application address ("https://host", no path / port / query) or { error } (tested).
 * '' = not set (the default address is used).
 * @param {unknown} input @returns {{ error: string } | { value: string }}
 */
function cleanAppUrl(input) {
  const s = String(input ?? '').trim();
  if (!s) return { value: '' };
  if (/^http:\/\//i.test(s)) return { error: 'Use an https:// address (WhatsApp needs a secure address).' };
  /** @type {URL} */
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`); } catch { return { error: 'Enter an address like https://crm.example.com.' }; }
  if (u.protocol !== 'https:') return { error: 'Use an https:// address (WhatsApp needs a secure address).' };
  if (u.username || u.password || u.search || u.hash || u.port || (u.pathname && u.pathname !== '/')) {
    return { error: 'Only the address itself, e.g. https://crm.example.com (no path, port or ?…).' };
  }
  const host = u.hostname.toLowerCase();
  if (PRIVATE_HOST.test(host) || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) || /^\d+(\.\d+)+$/.test(host)) {
    return { error: 'Use the public web address of the app (a domain name, not an IP or a local address).' };
  }
  return { value: `https://${host}` };
}

/** The address links are built from: the saved Application URL, else PUBLIC_SITE_URL / the Netlify address. */
async function siteUrl() {
  try {
    const s = await require('./branding.cjs').get();
    if (s.appUrl) return s.appUrl;
  } catch { /* the default below */ }
  return config.publicSiteUrl;
}

/** Does this address answer as this app (GET <address>/api/health -> { ok: true })? @param {string} url */
async function reachable(url) {
  try {
    const res = await fetch(`${url}/api/health`, { redirect: 'manual', signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    if (!res.ok) return false;
    const body = /** @type {any} */ (await res.json().catch(() => null));
    return body?.ok === true;
  } catch {
    return false;
  }
}

module.exports = { cleanAppUrl, siteUrl, reachable, defaultSiteUrl: () => config.publicSiteUrl };
