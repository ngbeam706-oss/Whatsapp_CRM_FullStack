// @ts-check
// Each business's own WhatsApp connection (Meta Cloud API).
//
// A business's Business Admin pastes their Meta details on the WhatsApp page:
//   Phone number ID, WhatsApp Business Account ID, access token, app secret.
// They are checked with Meta, stored ENCRYPTED in business_whatsapp (server-only table),
// and every message for that business is sent with them. Incoming messages arrive on the
// business's own webhook address: <site>/webhook/<webhook_key>.
//
// Arogya Ruchulu (business #1) keeps working from the environment settings until its
// Business Admin saves its details here; a saved connection always wins.
const crypto = require('crypto');
const { config } = require('./config.cjs');
const { dbRequest } = require('./db.cjs');
const secrets = require('./secrets.cjs');
const { requireBusinessId, isBusinessId } = require('./tenant.cjs');

/**
 * A business's WhatsApp connection, with secrets. Never send this to the browser.
 * @typedef {object} WhatsAppConn
 * @property {'saved' | 'env'} source
 * @property {string} businessId
 * @property {string} businessName
 * @property {string} phoneNumber
 * @property {string} phoneNumberId
 * @property {string} wabaId
 * @property {string} token
 * @property {string | null | undefined} appSecret
 * @property {string | null | undefined} verifyToken
 * @property {string | null} webhookKey
 * @property {string} graphVersion
 * @property {string} [label] staff's name for the number ("Reception"), if set
 * @property {string} [welcome] an extra number's own bot welcome text, if set
 */

const CACHE_MS = 60 * 1000;
/** @type {Map<string, { at: number, value: WhatsAppConn | null }>} */
const cache = new Map();
/** @type {Map<string, { at: number, value: WhatsAppConn | null }>} webhook_key -> connection */
const keyCache = new Map();
const KEY_RE = /^[0-9a-f]{32}$/;
const DIGITS_RE = /^\d{5,30}$/;
const ENV_BUSINESS_ID = () => (process.env.WHATSAPP_BUSINESS_ID || 'a0000000-0000-4000-8000-000000000001').trim();

/** Forget cached connections (one business, or all). @param {string} [businessId] */
function clearCache(businessId) {
  if (businessId) cache.delete(businessId); else cache.clear();
  keyCache.clear();
  // numbersCache is declared further down; it exists by the time anything calls this.
  if (businessId) numbersCache.delete(businessId); else numbersCache.clear();
}

/** @param {string} businessId @returns {Promise<{ row: any, business: { name: string, status: string } | null }>} */
async function loadRow(businessId) {
  const [row, biz] = await Promise.all([
    dbRequest(`business_whatsapp?business_id=eq.${businessId}&select=*`),
    dbRequest(`businesses?id=eq.${businessId}&select=name,status`),
  ]);
  return { row: row.ok ? row.data?.[0] || null : null, business: biz.ok ? biz.data?.[0] || null : null };
}

/**
 * The connection from the environment settings (only for the environment's business).
 * @param {string} businessId @param {{ name?: string } | null} business @returns {WhatsAppConn | null}
 */
function fromEnv(businessId, business) {
  if (businessId !== ENV_BUSINESS_ID() || !config.whatsappToken || !config.phoneNumberId) return null;
  return {
    source: 'env',
    businessId,
    businessName: business?.name || '',
    phoneNumber: config.phoneNumber,
    phoneNumberId: config.phoneNumberId,
    wabaId: config.wabaId,
    token: config.whatsappToken,
    appSecret: config.appSecret,
    verifyToken: config.verifyToken,
    webhookKey: null,
    graphVersion: config.graphApiVersion,
  };
}

/**
 * The WhatsApp connection a business sends with, or null if it has none (or is suspended).
 * Contains secrets: never send this object to the browser.
 * @param {unknown} businessId
 * @returns {Promise<WhatsAppConn | null>}
 */
async function getWhatsApp(businessId) {
  const id = requireBusinessId(businessId);
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const { row, business } = await loadRow(id);
  /** @type {WhatsAppConn | null} */
  let value = null;
  if (business && business.status === 'active') {
    const token = row?.access_token_enc ? secrets.decrypt(row.access_token_enc) : null;
    if (row && token && row.phone_number_id) {
      value = {
        source: 'saved',
        businessId: id,
        businessName: business.name,
        phoneNumber: row.phone_number || '',
        phoneNumberId: row.phone_number_id,
        wabaId: row.waba_id || '',
        token,
        appSecret: row.app_secret_enc ? secrets.decrypt(row.app_secret_enc) : null,
        verifyToken: row.verify_token_enc ? secrets.decrypt(row.verify_token_enc) : null,
        webhookKey: row.webhook_key,
        graphVersion: row.graph_api_version || config.graphApiVersion,
        label: row.label || '',
      };
    } else {
      value = fromEnv(id, business);
    }
  }
  cache.set(id, { at: Date.now(), value });
  return value;
}

/** For the webhook: which business owns this webhook address, with its secrets. @param {unknown} key @returns {Promise<WhatsAppConn | null>} */
async function whatsappForWebhookKey(key) {
  const k = String(key || '').toLowerCase();
  if (!KEY_RE.test(k)) return null;
  const hit = keyCache.get(k);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const res = await dbRequest(`business_whatsapp?webhook_key=eq.${k}&select=business_id`);
  const businessId = res.ok ? res.data?.[0]?.business_id : null;
  const value = isBusinessId(businessId) ? await getWhatsApp(businessId) : null;
  // Only a saved connection has a webhook key; the environment one uses the old /webhook address.
  const usable = value && value.source === 'saved' ? value : null;
  keyCache.set(k, { at: Date.now(), value: usable });
  return usable;
}

/**
 * For Meta's verification call (GET) only: a webhook address whose business has not saved its
 * Meta details yet. Meta checks the address as soon as it is pasted in, which the Business Admin
 * may do before connecting the number. Messages (POST) are still refused until the details,
 * including the App secret, are saved: there is nothing to check their signature with.
 * @param {unknown} key
 * @returns {Promise<{ businessId: string, verifyToken: string } | null>}
 */
async function pendingWebhookForKey(key) {
  const k = String(key || '').toLowerCase();
  if (!KEY_RE.test(k)) return null;
  const res = await dbRequest(`business_whatsapp?webhook_key=eq.${k}&select=business_id,verify_token_enc,access_token_enc,phone_number_id`);
  const row = res.ok ? res.data?.[0] : null;
  if (!row || !isBusinessId(row.business_id) || !row.verify_token_enc) return null;
  if (row.access_token_enc && row.phone_number_id) return null; // connected: the normal path handles it
  const biz = await dbRequest(`businesses?id=eq.${row.business_id}&select=status`);
  if (!(biz.ok && biz.data?.[0]?.status === 'active')) return null;
  const verifyToken = secrets.decrypt(row.verify_token_enc);
  return verifyToken ? { businessId: row.business_id, verifyToken } : null;
}

/**
 * Give a business its webhook address and verify token before it connects a number, so the
 * Business Admin can set up the webhook in Meta first. Creates the (empty) connection row once.
 * @param {string} businessId
 */
async function ensureWebhookDetails(businessId) {
  const id = requireBusinessId(businessId);
  if (!secrets.canEncrypt()) return;
  const { row } = await loadRow(id);
  if (row?.verify_token_enc) return;
  const verify_token_enc = secrets.encrypt(crypto.randomBytes(18).toString('base64url'));
  if (row) {
    await dbRequest(`business_whatsapp?business_id=eq.${id}&verify_token_enc=is.null`, { method: 'PATCH', prefer: 'return=minimal', body: { verify_token_enc } });
  } else {
    // Two tabs at once: the second insert is ignored and both read the same row afterwards.
    await dbRequest('business_whatsapp?on_conflict=business_id', { method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal', body: { business_id: id, verify_token_enc } });
  }
}

/** The business whose environment connection serves the old /webhook address. */
async function whatsappForLegacyWebhook() {
  return getWhatsApp(ENV_BUSINESS_ID());
}

// ---------------------------------------------------------------------------
// Dashboard: status, save, test
// ---------------------------------------------------------------------------

/** @param {string | null | undefined} s */
const last4 = (s) => (s ? String(s).slice(-4) : null);
/** @param {string | null | undefined} key @param {string} [base] the app's address (server/siteUrl.cjs) */
const webhookUrl = (key, base = config.publicSiteUrl) => (key ? `${base}/webhook/${key}` : `${base}/webhook`);

/**
 * What the Business Admin may see. The access token and app secret are never returned.
 * prepare: create the webhook address and verify token if the business has none yet (owner view),
 * so they can be pasted into Meta before the number is connected.
 * @param {string} businessId
 * @param {{ prepare?: boolean }} [options]
 */
async function connectionStatus(businessId, { prepare = false } = {}) {
  const id = requireBusinessId(businessId);
  const loaded = await loadRow(id);
  const business = loaded.business;
  let row = loaded.row;
  const saved = row && row.access_token_enc && row.phone_number_id;
  const env = !saved ? fromEnv(id, business) : null;
  if (prepare && !saved && !env && !row?.verify_token_enc) {
    await ensureWebhookDetails(id);
    row = (await loadRow(id)).row;
  }
  // The address webhook URLs start with: the Application URL (Platform -> Branding), else the default.
  const base = await require('./siteUrl.cjs').siteUrl();
  return {
    connected: !!(saved || env),
    source: saved ? 'saved' : env ? 'env' : 'none',
    phoneNumber: saved ? row.phone_number || '' : env?.phoneNumber || '',
    phoneNumberId: saved ? row.phone_number_id : env?.phoneNumberId || '',
    wabaId: saved ? row.waba_id || '' : env?.wabaId || '',
    tokenLast4: saved ? row.token_last4 || null : null,
    hasAppSecret: saved ? !!row.app_secret_enc : !!env?.appSecret,
    // Owners paste these two into Meta (App Dashboard -> WhatsApp -> Configuration).
    // Environment connection: the old /webhook address and token. Otherwise the business's own
    // address, which exists before the number is connected (see ensureWebhookDetails).
    webhookUrl: env ? webhookUrl(null, base) : (row?.webhook_key ? webhookUrl(row.webhook_key, base) : ''),
    verifyToken: env ? env.verifyToken || '' : (row?.verify_token_enc ? secrets.decrypt(row.verify_token_enc) || '' : ''),
    tokenUnreadable: !!(row?.access_token_enc && !secrets.decrypt(row.access_token_enc)),
    connectedAt: row?.connected_at || null,
    updatedBy: row?.updated_by || null,
    encryptionReady: secrets.canEncrypt(),
  };
}

/**
 * One Graph API call. Never throws: network failures come back as { error: { message } }.
 * @param {string} version @param {string} token @param {string} pathAndQuery
 * @param {{ method?: string, body?: unknown }} [options]
 * @returns {Promise<any>}
 */
async function graph(version, token, pathAndQuery, { method = 'GET', body } = {}) {
  try {
    const res = await fetch(`https://graph.facebook.com/${version}/${pathAndQuery}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return await res.json();
  } catch (err) {
    return { error: { message: err instanceof Error ? err.message : String(err) } };
  }
}
/** Meta's error text for people. @param {any} r */
const metaMsg = (r) => r?.error?.error_user_msg || r?.error?.message || 'Meta rejected the request.';

/**
 * @param {{ phoneNumberId?: unknown, wabaId?: unknown, accessToken?: unknown, appSecret?: unknown }} [input]
 * @returns {{ error: string } | { error?: undefined, phoneNumberId: string, wabaId: string, accessToken: string, appSecret: string }}
 */
function validateInput(input = {}) {
  const phoneNumberId = String(input.phoneNumberId || '').trim();
  const wabaId = String(input.wabaId || '').trim();
  const accessToken = String(input.accessToken || '').trim();
  const appSecret = String(input.appSecret || '').trim();
  if (!DIGITS_RE.test(phoneNumberId)) return { error: 'Enter the Phone number ID (digits only) from Meta -> WhatsApp -> API Setup.' };
  if (!DIGITS_RE.test(wabaId)) return { error: 'Enter the WhatsApp Business Account ID (digits only) from the same page.' };
  if (accessToken && (accessToken.length < 20 || accessToken.length > 1000 || /\s/.test(accessToken))) return { error: 'That access token doesn\'t look right.' };
  if (appSecret && !/^[0-9a-f]{32}$/i.test(appSecret)) return { error: 'The App secret is 32 letters and numbers (Meta App Dashboard -> App settings -> Basic).' };
  return { phoneNumberId, wabaId, accessToken, appSecret };
}

/**
 * Check the details with Meta: the token can see the number, and the number belongs to the
 * WhatsApp Business Account (the classic mix-up when one portfolio has two accounts).
 * @param {string} version @param {string} token @param {string} phoneNumberId @param {string} wabaId
 * @returns {Promise<{ error: string, phone?: undefined } | { error?: undefined, phone: any }>}
 */
async function checkWithMeta(version, token, phoneNumberId, wabaId) {
  const phone = await graph(version, token, `${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,messaging_limit_tier`);
  if (phone.error) return { error: `Meta didn't accept the token or Phone number ID: ${metaMsg(phone)}` };
  const list = await graph(version, token, `${wabaId}/phone_numbers?fields=id,display_phone_number&limit=100`);
  if (list.error) return { error: `Meta didn't accept the WhatsApp Business Account ID: ${metaMsg(list)}` };
  if (!(list.data || []).some((/** @type {{ id: string }} */ p) => String(p.id) === phoneNumberId)) {
    return { error: 'That phone number is not in this WhatsApp Business Account. Check you copied both IDs from the same account.' };
  }
  return { phone };
}

/**
 * Business Admin saves (or updates) the connection. Blank token / app secret = keep the saved one.
 * @param {import('./types.cjs').Staff} staff
 * @param {Parameters<typeof validateInput>[0]} [input]
 */
async function saveConnection(staff, input = {}) {
  const id = requireBusinessId(staff?.businessId);
  if (!secrets.canEncrypt()) return { error: 'The server has no encryption secret (APP_SECRET), so the details can\'t be stored safely.' };
  const v = validateInput(input);
  if (v.error !== undefined) return v;

  const { row } = await loadRow(id);
  const token = v.accessToken || (row?.access_token_enc ? secrets.decrypt(row.access_token_enc) : null);
  if (!token) return { error: 'Paste the access token (a permanent System User token is best).' };
  if (!v.appSecret && !row?.app_secret_enc) return { error: 'Paste the App secret: it proves incoming messages really come from Meta.' };

  const version = row?.graph_api_version || config.graphApiVersion;
  const checked = await checkWithMeta(version, token, v.phoneNumberId, v.wabaId);
  if (checked.error !== undefined) return checked;

  /** @type {Record<string, unknown>} */
  const body = {
    business_id: id,
    phone_number: String(checked.phone.display_phone_number || '').replace(/[^\d]/g, ''),
    phone_number_id: v.phoneNumberId,
    waba_id: v.wabaId,
    graph_api_version: version,
    connected_at: new Date().toISOString(),
    updated_by: staff.email,
    updated_at: new Date().toISOString(),
  };
  if (v.accessToken) {
    body.access_token_enc = secrets.encrypt(v.accessToken);
    body.token_last4 = last4(v.accessToken);
  }
  if (v.appSecret) body.app_secret_enc = secrets.encrypt(v.appSecret);
  if (!row?.verify_token_enc) body.verify_token_enc = secrets.encrypt(crypto.randomBytes(18).toString('base64url'));

  const res = await dbRequest('business_whatsapp?on_conflict=business_id', {
    method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body,
  });
  if (!res.ok) {
    if (res.status === 409 || /phone_number_id/.test(JSON.stringify(res.data || ''))) {
      return { error: 'This WhatsApp number is already connected to another business.' };
    }
    return { error: 'Could not save. Has the M3 SQL been run?' };
  }
  clearCache(id);

  // Ask Meta to send this account's messages to our app (best effort; needs the app's token).
  const sub = await graph(version, token, `${v.wabaId}/subscribed_apps`, { method: 'POST' });
  await dbRequest('audit_log', {
    method: 'POST', prefer: 'return=minimal',
    body: { business_id: id, actor_email: staff.email, actor_role: staff.role, action: 'whatsapp.connected', details: { phoneNumberId: v.phoneNumberId, wabaId: v.wabaId, tokenChanged: !!v.accessToken } },
  });
  return {
    status: await connectionStatus(id),
    verifiedName: checked.phone.verified_name || '',
    subscribed: !sub?.error,
    subscribeNote: sub?.error ? `Meta didn't subscribe the app automatically (${metaMsg(sub)}). Subscribe it in Meta -> WhatsApp -> Configuration.` : null,
  };
}

/** Business Admin checks the saved connection with Meta. @param {string} businessId */
async function testConnection(businessId) {
  const wa = await getWhatsApp(businessId);
  if (!wa) return { error: 'No WhatsApp number is connected yet.' };
  const phone = await graph(wa.graphVersion, wa.token, `${wa.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,messaging_limit_tier`);
  if (phone.error) return { error: `Meta says: ${metaMsg(phone)}` };
  return {
    ok: true,
    displayPhoneNumber: phone.display_phone_number,
    verifiedName: phone.verified_name,
    qualityRating: phone.quality_rating,
    messagingLimit: phone.messaging_limit_tier,
  };
}

// -------------------------------------------------------------
// Several numbers per business (docs/progress/multi-number.md, N1)
//   business_whatsapp = the MAIN connection and main number; whatsapp_numbers = EXTRA numbers that share
//   the main webhook address and (unless they have their own) the main token. A number is known by Meta's
//   phone_number_id. getWhatsApp(biz) stays "the main number", so callers that don't care keep working.
// -------------------------------------------------------------

/**
 * @typedef {object} ExtraNumber
 * @property {string} phoneNumberId
 * @property {string} phoneNumber
 * @property {string} wabaId
 * @property {string} label
 * @property {string | null} tokenEnc
 * @property {string} welcome  this number's own bot welcome text ('' = the bot flow's welcome)
 */

/** @type {Map<string, { at: number, value: ExtraNumber[] }>} */
const numbersCache = new Map();

/** A business's active extra numbers ([] when it has none, or the table isn't there yet). @param {unknown} businessId */
async function extraNumbers(businessId) {
  const id = requireBusinessId(businessId);
  const hit = numbersCache.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  /** @type {ExtraNumber[]} */
  let value = [];
  try {
    const base = `whatsapp_numbers?business_id=eq.${id}&status=eq.active&order=created_at.asc&select=phone_number_id,phone_number,waba_id,label,access_token_enc`;
    let res = await dbRequest(`${base},welcome_message`);
    // Before SQL 20261124 there is no welcome_message column: still load the numbers.
    if (!res.ok) res = await dbRequest(base);
    if (res.ok && Array.isArray(res.data)) {
      value = res.data
        .filter((/** @type {any} */ r) => r && DIGITS_RE.test(String(r.phone_number_id || '')))
        .map((/** @type {any} */ r) => ({
          phoneNumberId: String(r.phone_number_id),
          phoneNumber: r.phone_number || '',
          wabaId: r.waba_id || '',
          label: r.label || '',
          tokenEnc: r.access_token_enc || null,
          welcome: typeof r.welcome_message === 'string' && r.welcome_message.trim() ? r.welcome_message.trim() : '',
        }));
    }
  } catch { value = []; }
  numbersCache.set(id, { at: Date.now(), value });
  return value;
}

/**
 * The business's connection for one of ITS numbers (main or extra), or null if that number isn't the
 * business's. An empty id means the main number.
 * @param {unknown} businessId @param {unknown} phoneNumberId @returns {Promise<WhatsAppConn | null>}
 */
async function connectionForNumber(businessId, phoneNumberId) {
  const main = await getWhatsApp(businessId);
  if (!main) return null;
  const want = String(phoneNumberId ?? '').trim();
  if (!want || want === String(main.phoneNumberId)) return main;
  const extra = (await extraNumbers(businessId)).find(n => n.phoneNumberId === want);
  if (!extra) return null;
  let token = main.token;
  if (extra.tokenEnc) {
    const own = secrets.decrypt(extra.tokenEnc);
    if (!own) return null; // unreadable token: never fall back to sending as another number
    token = own;
  }
  return { ...main, phoneNumberId: extra.phoneNumberId, phoneNumber: extra.phoneNumber, wabaId: extra.wabaId || main.wabaId, token, label: extra.label, welcome: extra.welcome };
}

/** Whether a Meta phone_number_id is one of this business's numbers. @param {unknown} businessId @param {unknown} phoneNumberId */
async function ownsNumber(businessId, phoneNumberId) {
  const want = String(phoneNumberId ?? '').trim();
  if (!want) return false;
  const main = await getWhatsApp(businessId);
  if (main && String(main.phoneNumberId) === want) return true;
  return (await extraNumbers(businessId)).some(n => n.phoneNumberId === want);
}

/**
 * The connection to answer a customer with: the number they last wrote to (Meta's 24-hour window is per
 * number), else the main number. Businesses with one number never pay for the extra lookup.
 * @param {unknown} businessId @param {unknown} customerPhone @returns {Promise<WhatsAppConn | null>}
 */
async function whatsappFor(businessId, customerPhone) {
  const id = requireBusinessId(businessId);
  const main = await getWhatsApp(id);
  if (!main) return null;
  if (!(await extraNumbers(id)).length) return main;
  const phone = String(customerPhone ?? '').replace(/\D/g, '');
  if (!phone) return main;
  let last = null;
  try {
    const res = await dbRequest(`whatsapp_leads?business_id=eq.${id}&phone=eq.${phone}&select=last_phone_number_id`);
    last = res.ok && Array.isArray(res.data) ? res.data[0]?.last_phone_number_id || null : null;
  } catch { last = null; }
  return (last && await connectionForNumber(id, last)) || main;
}

/**
 * The business's numbers for staff screens (no secrets): main first, then extras.
 * @param {unknown} businessId
 * @returns {Promise<Array<{ id: string, label: string, phoneNumber: string, main: boolean }>>}
 */
async function listNumbers(businessId) {
  const main = await getWhatsApp(businessId);
  if (!main) return [];
  const extras = await extraNumbers(businessId);
  return [
    { id: String(main.phoneNumberId), label: main.label || '', phoneNumber: main.phoneNumber || '', main: true },
    ...extras.map(n => ({ id: n.phoneNumberId, label: n.label, phoneNumber: n.phoneNumber, main: false })),
  ];
}

module.exports = {
  graph,
  metaMsg,
  checkWithMeta,
  listNumbers,
  extraNumbers,
  connectionForNumber,
  ownsNumber,
  whatsappFor,
  getWhatsApp,
  whatsappForWebhookKey,
  whatsappForLegacyWebhook,
  pendingWebhookForKey,
  ensureWebhookDetails,
  connectionStatus,
  saveConnection,
  testConnection,
  validateInput,
  clearCache,
  webhookUrl,
};
