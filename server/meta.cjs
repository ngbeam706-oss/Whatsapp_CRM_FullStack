// @ts-check
// Meta WhatsApp Cloud API: sending text, quick-reply buttons, lists and templates.
// Every call takes `wa`, the sending business's own connection (server/whatsapp.cjs:
// getWhatsApp(businessId)), so a message always goes out from that business's number.

/** @typedef {import('./types.cjs').MetaSendResult} MetaSendResult */
/** @typedef {{ id?: string, title?: string }} Button */
/** @typedef {{ id?: string, title?: string, description?: string }} ListRow */
/** @typedef {{ title?: string, rows?: ListRow[] }} ListSection */

/** @param {unknown} to */
const cleanPhone = (to) => String(to || '').replace(/[\s\-+()]/g, '');

const notConnected = () => ({ error: { message: 'This business has no WhatsApp number connected yet.' } });

/** @param {unknown} err */
const errText = (err) => (err instanceof Error ? err.message : String(err));

/**
 * @param {any} wa @param {Record<string, unknown>} payload @param {string} label
 * @returns {Promise<MetaSendResult>}
 */
async function postMessage(wa, payload, label) {
  if (!wa?.token || !wa?.phoneNumberId) return notConnected();
  try {
    const endpoint = `https://graph.facebook.com/${wa.graphVersion}/${wa.phoneNumberId}/messages`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${wa.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...payload }),
    });
    /** @type {MetaSendResult} */
    const data = /** @type {any} */ (await response.json());
    if (data?.error) await logSendFailure(wa, data.error, label);
    return data;
  } catch (err) {
    console.error(`[${label} Network Error]`, err);
    await logSendFailure(wa, { message: errText(err), code: 'network' }, label);
    return { error: { message: errText(err) } };
  }
}

// Meta's token errors: the business's saved access token no longer works.
const TOKEN_ERROR_CODES = new Set([190, 102, 104]);

/**
 * Send failures go to the Platform Admin's event log: error code and Meta's short text only.
 * @param {any} wa @param {{ code?: unknown, message?: string, error_subcode?: unknown }} error @param {string} label
 */
async function logSendFailure(wa, error, label) {
  const code = error?.code ?? 'unknown';
  await require('./events.cjs').logEvent({
    level: TOKEN_ERROR_CODES.has(Number(code)) ? 'critical' : 'error',
    source: 'meta',
    businessId: wa?.businessId,
    code: TOKEN_ERROR_CODES.has(Number(code)) ? 'token_invalid' : `send_${code}`,
    message: error?.message || 'Send failed',
    details: { call: label, subcode: Number(error?.error_subcode) || undefined },
  });
}

/**
 * Plain text message.
 * @param {any} wa  The business's WhatsApp connection (whatsapp.getWhatsApp)
 * @param {string} to
 * @param {string} text
 * @returns {Promise<import('./types.cjs').MetaSendResult>}
 */
async function sendTextMessage(wa, to, text) {
  return postMessage(wa, {
    to: cleanPhone(to),
    type: 'text',
    text: { preview_url: false, body: text },
  }, 'sendTextMessage');
}

/**
 * Quick-reply buttons (Meta allows max 3, titles max 20 chars).
 * @param {any} wa @param {string} to @param {string} bodyText @param {Button[]} buttons
 * @param {{ footer?: string }} [options]
 * @returns {Promise<MetaSendResult>}
 */
async function sendInteractiveButtons(wa, to, bodyText, buttons, { footer } = {}) {
  const validButtons = (buttons || [])
    .filter(b => b && (b.title || '').trim())
    .slice(0, 3)
    .map((b, idx) => ({
      type: 'reply',
      reply: {
        id: (b.id || `btn_${idx}`).slice(0, 256),
        title: (b.title || '').trim().slice(0, 20),
      },
    }));

  if (validButtons.length === 0) return sendTextMessage(wa, to, bodyText);

  return postMessage(wa, {
    to: cleanPhone(to),
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: bodyText },
      // Meta allows a footer of up to 60 characters under the message.
      ...(footer ? { footer: { text: String(footer).slice(0, 60) } } : {}),
      action: { buttons: validButtons },
    },
  }, 'sendInteractiveButtons');
}

/**
 * List message. Meta limits: header 60, button label 20, section title 24,
 * row title 24, row description 72 chars, max 10 rows.
 * @param {any} wa @param {string} to @param {string} bodyText @param {string} buttonLabel @param {ListSection[]} sections
 * @returns {Promise<MetaSendResult>}
 */
async function sendInteractiveList(wa, to, bodyText, buttonLabel, sections) {
  const sanitizedSections = (sections || [])
    .map(sec => ({
      title: (sec.title || 'Options').slice(0, 24),
      rows: (sec.rows || [])
        .filter(r => r && (r.title || '').trim())
        .slice(0, 10)
        .map((r, idx) => ({
          id: (r.id || `row_${idx}`).slice(0, 200),
          title: (r.title || '').trim().slice(0, 24),
          description: (r.description || '').slice(0, 72),
        })),
    }))
    .filter(sec => sec.rows.length > 0);

  if (sanitizedSections.length === 0) return sendTextMessage(wa, to, bodyText);

  return postMessage(wa, {
    to: cleanPhone(to),
    type: 'interactive',
    interactive: {
      type: 'list',
      // The sending business's own name at the top of the list.
      ...(wa?.businessName ? { header: { type: 'text', text: String(wa.businessName).slice(0, 60) } } : {}),
      body: { text: bodyText },
      action: {
        button: (buttonLabel || 'Select Item').trim().slice(0, 20),
        sections: sanitizedSections,
      },
    },
  }, 'sendInteractiveList');
}

/**
 * Approved template message (the only kind allowed outside the 24-hour reply window).
 * `components` is Meta's send format, e.g. [{ type: 'body', parameters: [{ type: 'text', text: 'Ravi' }] }].
 * @param {any} wa
 * @param {string} to
 * @param {string} templateName
 * @param {string} languageCode
 * @param {any[]} [components]
 * @returns {Promise<import('./types.cjs').MetaSendResult>}
 */
async function sendTemplateMessage(wa, to, templateName, languageCode, components = []) {
  /** @type {{ name: string, language: { code: string }, components?: any[] }} */
  const template = { name: templateName, language: { code: languageCode } };
  if (components.length) template.components = components;
  return postMessage(wa, { to: cleanPhone(to), type: 'template', template }, 'sendTemplateMessage');
}

/**
 * Upload a file to Meta for sending (WhatsApp media endpoint); returns { id } or { error }.
 * @param {any} wa @param {Buffer} bytes @param {string} mime @param {string} filename
 * @returns {Promise<{ id?: string, error?: { message?: string, code?: unknown } }>}
 */
async function uploadMedia(wa, bytes, mime, filename) {
  if (!wa?.token || !wa?.phoneNumberId) return notConnected();
  try {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', mime);
    form.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), filename);
    const res = await fetch(`https://graph.facebook.com/${wa.graphVersion}/${wa.phoneNumberId}/media`, {
      method: 'POST', headers: { Authorization: `Bearer ${wa.token}` }, body: form, signal: AbortSignal.timeout(30000),
    });
    const data = /** @type {any} */ (await res.json());
    if (data?.error) await logSendFailure(wa, data.error, 'uploadMedia');
    return data;
  } catch (err) {
    return { error: { message: errText(err) } };
  }
}

/**
 * A photo, document, voice note / audio or video already uploaded to Meta (uploadMedia's id).
 * @param {any} wa @param {string} to @param {'image' | 'document' | 'audio' | 'video'} kind @param {string} mediaId
 * @param {{ caption?: string, filename?: string }} [options]  (audio has no caption)
 * @returns {Promise<MetaSendResult>}
 */
async function sendMediaMessage(wa, to, kind, mediaId, { caption, filename } = {}) {
  /** @type {Record<string, string>} */
  const media = { id: mediaId };
  if (caption && kind !== 'audio') media.caption = caption.slice(0, 1024);
  if (kind === 'document' && filename) media.filename = filename.slice(0, 240);
  return postMessage(wa, { to: cleanPhone(to), type: kind, [kind]: media }, 'sendMediaMessage');
}

/**
 * Generic Graph API call for account-level endpoints (templates, phone info).
 * @param {any} wa @param {string} pathAndQuery @param {{ method?: string, body?: unknown }} [options]
 * @returns {Promise<any>}
 */
async function graphRequest(wa, pathAndQuery, { method = 'GET', body } = {}) {
  if (!wa?.token) return notConnected();
  try {
    const res = await fetch(`https://graph.facebook.com/${wa.graphVersion}/${pathAndQuery}`, {
      method,
      headers: { Authorization: `Bearer ${wa.token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return await res.json();
  } catch (err) {
    return { error: { message: errText(err) } };
  }
}

module.exports = { cleanPhone, sendTextMessage, sendInteractiveButtons, sendInteractiveList, sendTemplateMessage, graphRequest, uploadMedia, sendMediaMessage };
