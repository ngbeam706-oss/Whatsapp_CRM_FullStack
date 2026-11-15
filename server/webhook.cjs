// @ts-check
// Meta webhook: subscription check (GET) and incoming events (POST).
// Meta's payloads are loosely typed here (`any`): their shape is Meta's, checked field by field below.
/** @typedef {import('express').Request} Request */
/** @typedef {import('express').Response} Response */
/** @typedef {import('express').NextFunction} NextFunction */
const crypto = require('crypto');
const { config } = require('./config.cjs');
const { logMessage, logLead, updateMessageStatus, dbRequest } = require('./db.cjs');
const { pushMessage, pushWebhookLog, findMessage, broadcastEvent } = require('./state.cjs');
const { envWhatsAppBusinessId } = require('./tenant.cjs');
const { whatsappFor, ownsNumber, whatsappForWebhookKey, whatsappForLegacyWebhook, pendingWebhookForKey } = require('./whatsapp.cjs');
const { handleArogyaRuchuluBot, recordBotAction } = require('./bot.cjs');
const { sendTextMessage } = require('./meta.cjs');
const campaigns = require('./campaigns.cjs');
const automations = require('./automations.cjs');
const inbox = require('./inbox.cjs');
const store = require('./botStore.cjs');
const events = require('./events.cjs');

/** Non-empty strings only (drops null/undefined/''). @param {Array<string | null | undefined>} list @returns {string[]} */
const present = (list) => list.filter(/** @returns {s is string} */ (s) => typeof s === 'string' && s !== '');

/** @param {unknown} err */
const errText = (err) => (err instanceof Error ? err.message : String(err));

// Bot buttons that mean "I want a person": the bot steps aside for a while.
/** @type {Set<unknown>} */
const HANDOVER_IDS = new Set(['btn_talk_staff', 'row_talk_nutritionist', 'row_talk_staff']);

/**
 * The contact as stored before this message, or null if new. `ok` false on DB errors.
 * @param {string} biz @param {string} phone
 * @returns {Promise<{ ok: boolean, lead: any }>}
 */
async function loadContact(biz, phone) {
  const path = (/** @type {string} */ cols) => `whatsapp_leads?select=${cols}&business_id=eq.${biz}&phone=eq.${encodeURIComponent(phone)}`;
  const base = 'phone,stage,bot_paused,bot_paused_until,last_inbound_at,assigned_to';
  // With the import markers (SQL 20261142) when they exist.
  let res = await dbRequest(path(`${base},imported_at,last_contacted_at`));
  if (!res.ok) res = await dbRequest(path(base));
  if (!res.ok || !Array.isArray(res.data)) return { ok: false, lead: null };
  return { ok: true, lead: res.data[0] || null };
}

/**
 * A new chat: no contact yet, or an imported person writing for the first time (imported, never contacted). They get
 * what any new chat gets: the "new contact" follow-up event, a new-chat alert, STOP re-check, lead assignment.
 * @param {{ ok: boolean, lead: any }} before
 */
const isNewChat = (before) => before.ok && (!before.lead || (!!before.lead.imported_at && !before.lead.last_contacted_at));

/**
 * Turn what the customer just did into contact events (follow-ups) and pipeline moves.
 * @param {string} biz @param {any} msg @param {string} contactName @param {any} interactiveData @param {boolean} isNew
 */
async function recordContactEvents(biz, msg, contactName, interactiveData, isNew) {
  if (isNew) await automations.recordEvent(biz, msg.from, contactName, 'new_contact', {});
  if (interactiveData) {
    const ev = automations.eventFromInteractive(interactiveData, store.currentCatalog(biz));
    if (ev) {
      await automations.recordEvent(biz, msg.from, contactName, ev.type, ev.data);
      await inbox.applyStageEvent(biz, msg.from, ev.type);
    }
  }
}

// -------------------------------------------------------------
// Which business a webhook call is for
//   /webhook/<key>  -> the business that owns that webhook key (its own app secret + verify token)
//   /webhook        -> the old address: the business whose number is in the environment settings
// -------------------------------------------------------------
/** @param {Request} req @param {Response} res @param {NextFunction} next */
async function resolveWebhookBusiness(req, res, next) {
  try {
    if (req.params.key) {
      const wa = await whatsappForWebhookKey(req.params.key);
      if (!wa) {
        // Meta's verification may come before the business has saved its Meta details.
        // Only the GET check is answered; messages need the saved App secret to be trusted.
        const pending = req.method === 'GET' ? await pendingWebhookForKey(req.params.key) : null;
        if (!pending) return res.status(404).send('Unknown webhook address');
        req.webhook = { businessId: pending.businessId, appSecrets: [], verifyTokens: [pending.verifyToken], phoneNumberId: null };
        return next();
      }
      req.webhook = {
        businessId: wa.businessId,
        appSecrets: present([wa.appSecret]),
        verifyTokens: present([wa.verifyToken]),
        phoneNumberId: wa.phoneNumberId,
      };
      return next();
    }
    let saved = null;
    try { saved = await whatsappForLegacyWebhook(); } catch { saved = null; }
    req.webhook = {
      businessId: envWhatsAppBusinessId(),
      // The environment settings, plus the business's saved ones if it has saved its own.
      appSecrets: [...new Set(present([config.appSecret, saved?.appSecret]))],
      verifyTokens: [...new Set(present([config.verifyToken, saved?.verifyToken]))],
      phoneNumberId: saved?.phoneNumberId || config.phoneNumberId || null,
    };
    return next();
  } catch (err) {
    console.error('[Webhook] could not resolve business:', err);
    await events.logEvent({ level: 'error', source: 'webhook', code: 'resolve_failed', message: errText(err) });
    return res.status(503).send('Temporarily unavailable');
  }
}

/**
 * Handle STOP / START replies. Returns true if the message was an opt keyword and was handled.
 * @param {string} biz @param {any} wa @param {any} msg
 */
async function handleOptKeywords(biz, wa, msg) {
  if (msg.type !== 'text') return false;
  const kw = campaigns.optKeyword(msg.text?.body);
  const name = wa?.businessName || 'our';
  if (kw === 'stop') {
    await campaigns.setOptOut(biz, msg.from, true);
    const text = `You have been unsubscribed from ${name} offers and updates. You can still message us any time. Reply START to subscribe again.`;
    if (wa) await recordBotAction(biz, msg.from, text, 'text', await sendTextMessage(wa, msg.from, text));
    return true;
  }
  if (kw === 'start' && await campaigns.isOptedOut(biz, msg.from)) {
    await campaigns.setOptOut(biz, msg.from, false);
    const text = `Welcome back! You will receive ${name} offers and updates again. Reply STOP at any time to unsubscribe.`;
    if (wa) await recordBotAction(biz, msg.from, text, 'text', await sendTextMessage(wa, msg.from, text));
    return true;
  }
  return false;
}

// -------------------------------------------------------------
// Signature check: Meta signs every POST with HMAC-SHA256 of the raw body,
// keyed with the App Secret, in the X-Hub-Signature-256 header.
// -------------------------------------------------------------
/** @param {Buffer | undefined} rawBody @param {string | undefined} signatureHeader @param {string} [secret] */
function isValidSignature(rawBody, signatureHeader, secret = config.appSecret) {
  if (!secret || !rawBody || !signatureHeader) return false;
  const [algo, received] = String(signatureHeader).split('=');
  if (algo !== 'sha256' || !received) return false;

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(received, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** @param {Request} req @param {Response} res @param {NextFunction} next */
async function verifyMetaSignature(req, res, next) {
  if (config.allowUnsignedWebhooks) return next();

  /** @type {string[]} */
  const secrets = req.webhook?.appSecrets || [];
  if (!secrets.length) {
    console.error('[Webhook] No app secret for this webhook address: rejecting.');
    await events.logEvent({ level: 'error', source: 'webhook', businessId: req.webhook?.businessId, code: 'no_app_secret', message: 'Webhook POST rejected: no App secret saved for this address.' });
    return res.status(503).send('Webhook signature secret not configured');
  }
  const header = req.get('x-hub-signature-256');
  if (!secrets.some(s => isValidSignature(req.rawBody, header, s))) {
    console.warn('[Webhook] Rejected POST with missing or invalid X-Hub-Signature-256.');
    pushWebhookLog({ type: 'SIGNATURE_REJECTED', details: 'Webhook POST rejected: invalid signature' });
    await events.signatureFailed(req.webhook?.businessId);
    return res.status(401).send('Invalid signature');
  }
  return next();
}

// -------------------------------------------------------------
// GET: Meta subscription verification
// -------------------------------------------------------------
/** @param {Request} req @param {Response} res */
function handleWebhookVerification(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  /** @type {unknown[]} */
  const tokens = req.webhook?.verifyTokens || [];

  if (mode === 'subscribe' && token && tokens.includes(token)) {
    console.log('[Webhook Verification] SUCCESS');
    const biz = req.webhook?.businessId;
    pushWebhookLog({ type: 'VERIFICATION_SUCCESS', details: 'Meta successfully verified your webhook callback URL!' }, biz);
    broadcastEvent('log', { message: 'Webhook URL verified successfully by Meta!' }, biz);
    return res.status(200).type('text/plain').send(String(challenge ?? ''));
  }

  console.warn('[Webhook Verification] FAILED - token mismatch, invalid mode, or no verify token set.');
  pushWebhookLog({ type: 'VERIFICATION_FAILED', details: 'Verify token mismatch or invalid mode' });
  return res.status(403).json({ error: 'Verification token mismatch' });
}

// -------------------------------------------------------------
// POST: incoming messages, button/list clicks and delivery statuses
// -------------------------------------------------------------
/** @param {any} msg @returns {{ text: string, interactive: any }} */
function describeMessage(msg) {
  if (msg.type === 'text' && msg.text) return { text: msg.text.body, interactive: null };
  if (msg.type === 'interactive' && msg.interactive) {
    const i = msg.interactive;
    if (i.type === 'button_reply') return { text: `[Button Clicked: ${i.button_reply?.title}]`, interactive: i };
    if (i.type === 'list_reply') return { text: `[List Selected: ${i.list_reply?.title}]`, interactive: i };
    return { text: '', interactive: i };
  }
  if (msg.type === 'button' && msg.button) return { text: `[Button Response: ${msg.button.text}]`, interactive: null };
  // Photos, documents, voice notes, videos, stickers: the caption (or a label); the file itself is in mediaOf().
  const m = mediaOf(msg);
  if (m) return { text: m.caption || MEDIA_LABEL[msg.type](m), interactive: null };
  return { text: `[Message type: ${msg.type}]`, interactive: null };
}

/** @type {Record<string, (m: { name: string | null, voice: boolean }) => string>} */
const MEDIA_LABEL = {
  image: () => '📷 Photo',
  document: (m) => `📄 ${m.name || 'Document'}`,
  audio: (m) => (m.voice ? '🎤 Voice note' : '🎵 Audio'),
  video: () => '🎬 Video',
  sticker: () => 'Sticker',
};
/**
 * Pure: the file in an incoming media message (Meta's media id, type, file name, caption), or null (tested).
 * @param {any} msg
 * @returns {{ id: string, mime: string | null, name: string | null, caption: string, voice: boolean } | null}
 */
function mediaOf(msg) {
  if (!msg || !MEDIA_LABEL[msg.type]) return null;
  const x = msg[msg.type];
  if (!x || !/^\d{5,30}$/.test(String(x.id || ''))) return null;
  return {
    id: String(x.id),
    mime: x.mime_type ? String(x.mime_type).slice(0, 100) : null,
    name: x.filename ? String(x.filename).replace(/[\r\n<>]/g, '').slice(0, 240) : null,
    caption: x.caption ? String(x.caption).slice(0, 1024) : '',
    voice: !!x.voice,
  };
}

// Guess where the customer came from (Instagram ad, bio link, website, packaging QR...).
/** @param {any} msg */
function detectIncomingSource(msg) {
  if (msg.referral) {
    const srcType = msg.referral.source_type || 'ad';
    const srcUrl = (msg.referral.source_url || '').toLowerCase();
    const isInsta = srcUrl.includes('instagram.com') || (srcType === 'ad' && !srcUrl.includes('facebook.com'));
    return {
      source: isInsta ? 'Instagram Ad' : 'Meta Ad',
      sourceType: 'ad',
      badge: isInsta ? '📸 Instagram Ad' : '📢 Meta Ad',
      referral: msg.referral,
    };
  }

  const body = (msg.text?.body || '').trim().toLowerCase();
  if (body.includes('instagram') || body.includes('from ig') || body.includes('[ig]') || body.includes('ig story') || body.includes('saw your story')) {
    return { source: 'Instagram Bio', sourceType: 'organic_instagram', badge: '📷 Instagram Bio', referral: null };
  }
  if (body.includes('website') || body.includes('from web') || body.includes('[web]') || body.includes('site')) {
    return { source: 'Website', sourceType: 'website', badge: '🌐 Website', referral: null };
  }
  if (body.includes('qr') || body.includes('box') || body.includes('pack')) {
    return { source: 'Packaging QR', sourceType: 'packaging_qr', badge: '📦 Food Pack QR', referral: null };
  }
  return { source: 'Direct WhatsApp', sourceType: 'direct', badge: '💬 Direct WhatsApp', referral: null };
}

/**
 * @param {string} biz @param {any} msg @param {any} value @param {string} contactName @param {string} receivedAt
 * @param {string | null} [numberId] which of the business's numbers it was sent to (Meta phone_number_id)
 */
async function handleIncomingMessage(biz, msg, value, contactName, receivedAt, numberId = null) {
  const { text: messageText, interactive: interactiveData } = describeMessage(msg);
  const sourceInfo = detectIncomingSource(msg);
  const file = mediaOf(msg);

  const item = {
    media: file ? { id: file.id, mime: file.mime, name: file.name } : null,
    id: msg.id || 'msg_' + Date.now(),
    direction: 'inbound',
    sender: msg.from,
    senderName: contactName,
    recipient: value.metadata?.display_phone_number || '',
    body: messageText,
    type: msg.type,
    interactiveData,
    source: sourceInfo.source,
    sourceType: sourceInfo.sourceType,
    badge: sourceInfo.badge,
    referral: sourceInfo.referral,
    timestamp: msg.timestamp ? new Date(parseInt(msg.timestamp, 10) * 1000).toISOString() : receivedAt,
    raw: msg,
    numberId,
  };

  pushMessage(item, biz);
  console.log(`[Incoming WhatsApp Message] [Source: ${item.source}] from ${item.sender}: "${item.body}"`);
  broadcastEvent('message', item, biz);
  let before = { ok: false, lead: null };
  try { before = await loadContact(biz, msg.from); } catch { /* treat as existing */ }
  const isNew = isNewChat(before);
  await logMessage(biz, item);
  await logLead(biz, item.sender, item.senderName, item.body, item.source, item.referral);
  // A number whose lead was deleted after it replied STOP comes back opted out (server/leadsTools.cjs).
  if (isNew) await require('./leadsTools.cjs').reapply(biz, msg.from);
  // Also records the number the customer wrote to: every reply below (whatsappFor) goes out from it.
  try { await inbox.onInbound(biz, msg.from, numberId); } catch (err) { console.error('[Inbox unread error]', err); }
  // Back after a long silence (server/returningLeads.cjs): status by type, owner re-checked. Uses the lead as it was
  // BEFORE this message (its previous customer message).
  if (before.ok && before.lead && !isNew) await require('./returningLeads.cjs').apply(biz, msg.from, before.lead, { numberId });
  // Rotation (server/leadAssignment.cjs): an unassigned chat goes to the next available person. Off = no change.
  await require('./leadAssignment.cjs').assignIfDue(biz, msg.from, { numberId });
  // Alert the team's open dashboards (no name, number or text in the alert; never stops the message).
  try { await require('./inboxAlerts.cjs').onInbound(biz, msg.from, isNew); } catch (err) { console.error('[Inbox alert error]', errText(err)); }

  try {
    await campaigns.trackReply(biz, msg.from);
    // A customer reply restarts any of their queries that were waiting on them.
    try { await require('./queries.cjs').onCustomerMessage(biz, msg.from); } catch (err) { console.error('[Queries] reply hook failed:', errText(err)); }
    // "NOT SOLVED" reopens their resolved query - even while staff have paused the bot.
    const qb = require('./queryBot.cjs');
    if (msg.type === 'text' && qb.saysNotSolved(msg.text?.body)) {
      let wa = null;
      try { wa = await whatsappFor(biz, msg.from); } catch { wa = null; }
      const text = await qb.notSolved(biz, msg.from);
      if (wa) await recordBotAction(biz, msg.from, text, 'text', await sendTextMessage(wa, msg.from, text));
      return;
    }
    let wa = null;
    try { wa = await whatsappFor(biz, msg.from); } catch { wa = null; }
    if (await handleOptKeywords(biz, wa, msg)) return;
  } catch (optErr) {
    console.error('[Opt-out / reply tracking error]', optErr);
  }

  // Staff have taken over this chat: the bot stays quiet (the message still shows in the inbox).
  if (inbox.isBotPaused(before.lead)) {
    console.log(`[Bot Engine] Paused for ${msg.from}: staff are handling this chat.`);
  } else {
    try {
      await handleArogyaRuchuluBot(biz, msg.from, contactName, messageText, interactiveData);
    } catch (botErr) {
      console.error('[Bot Engine Error]', botErr);
      await events.logEvent({ level: 'error', source: 'webhook', businessId: biz, code: 'bot_error', message: errText(botErr) });
    }
  }

  const clickedId = interactiveData?.button_reply?.id || interactiveData?.list_reply?.id;
  if (HANDOVER_IDS.has(clickedId)) {
    try { await inbox.pauseForHandover(biz, msg.from); } catch (err) { console.error('[Handover error]', err); }
  }

  // After the bot: it has just refreshed the catalog we use to name items.
  try {
    await recordContactEvents(biz, msg, contactName, interactiveData, isNew);
  } catch (evErr) {
    console.error('[Automation event error]', evErr);
  }
}

/** @param {string} biz @param {any} status @param {string} receivedAt */
async function handleStatusUpdate(biz, status, receivedAt) {
  const statusUpdate = {
    id: status.id,
    recipient: status.recipient_id,
    status: status.status,
    timestamp: status.timestamp ? new Date(parseInt(status.timestamp, 10) * 1000).toISOString() : receivedAt,
    errors: status.errors || null,
  };
  const existing = findMessage(biz, status.id);
  if (existing) existing.deliveryStatus = status.status;
  broadcastEvent('status', statusUpdate, biz);
  try {
    await campaigns.trackDeliveryStatus(biz, status);
    await updateMessageStatus(biz, status.id, status.status);
  } catch (err) {
    console.error('[Delivery status tracking error]', err);
  }
}

/** @param {Request} req @param {Response} res */
async function handleWebhookEvent(req, res) {
  const body = req.body || {};
  const hook = req.webhook;
  const receivedAt = new Date().toISOString();
  // Health: when this business last got a signed webhook call (at most one write a minute).
  await events.touchWebhook(req.webhook?.businessId);

  try {
    if (body.object === 'whatsapp_business_account' && hook) {
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          const value = change.value;
          if (!value) continue;
          const biz = hook.businessId;
          // An event for a number that isn't one of THIS business's numbers (main or extra) is ignored,
          // so one business can never receive (or answer) another business's customers.
          const toNumberId = value.metadata?.phone_number_id ? String(value.metadata.phone_number_id) : null;
          if (toNumberId && hook.phoneNumberId && toNumberId !== String(hook.phoneNumberId) && !(await ownsNumber(biz, toNumberId))) {
            console.warn(`[Webhook] Event for number ${toNumberId} arrived on the address of ${biz}; ignored.`);
            continue;
          }
          const numberId = toNumberId || (hook.phoneNumberId ? String(hook.phoneNumberId) : null);

          const firstContact = value.contacts?.[0];
          const contactName = firstContact?.profile?.name || firstContact?.wa_id || 'WhatsApp User';

          for (const msg of Array.isArray(value.messages) ? value.messages : []) {
            await handleIncomingMessage(biz, msg, value, contactName, receivedAt, numberId);
          }
          for (const status of Array.isArray(value.statuses) ? value.statuses : []) {
            if (status?.type === 'call') continue; // call progress, not a message delivery
            await handleStatusUpdate(biz, status, receivedAt);
          }
          // WhatsApp voice calls (Calling API, webhook field "calls"): ring this business's dashboard.
          if (Array.isArray(value.calls) && value.calls.length) {
            await require('./waCalls.cjs').handleCallEvents(biz, value, contactName);
          }
        }
      }
    }
  } catch (handlerErr) {
    console.error('[Webhook Event Handler Error]', handlerErr);
    await events.logEvent({ level: 'error', source: 'webhook', businessId: req.webhook?.businessId, code: 'handler_error', message: errText(handlerErr) });
  } finally {
    // Respond only after the bot and Supabase logging finish: serverless functions
    // may be frozen as soon as the response is sent.
    res.status(200).send('EVENT_RECEIVED');
  }
}

module.exports = { resolveWebhookBusiness, verifyMetaSignature, isValidSignature, handleWebhookVerification, handleWebhookEvent, mediaOf, describeMessage, isNewChat };
