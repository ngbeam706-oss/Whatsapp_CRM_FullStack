// @ts-check
// Dashboard API. Every route here requires a signed-in staff member (see auth.cjs).
const express = require('express');
const { config, missingConfig } = require('./config.cjs');
const { cleanPhone } = require('./meta.cjs');
const { sseClients, recentFor, clearMessages } = require('./state.cjs');
const store = require('./botStore.cjs');
const limits = require('./limits.cjs');
const { requireManager } = require('./tenant.cjs');
const { connectionStatus } = require('./whatsapp.cjs');
const { validate, body: B } = require('./validate.cjs');

const router = express.Router();

/** @param {string} n */
const isValidPhone = (n) => /^\d{7,15}$/.test(n);
/** @param {any} r @returns {boolean} */
const isValidRule = (r) => r && typeof r === 'object' && typeof r.id === 'string' && r.id.length > 0 && r.id.length <= 200;

// Send a text from the dashboard (used for the call link). It goes through the Inbox's own send, so
// the same rules apply as typing in a chat: the contact must exist, the chat must not belong to
// someone else, WhatsApp's 24-hour window must be open, and the message is logged to the chat.
// (Before 2026-11-09 this route skipped those checks and renamed the contact to "+<number>".)
router.post('/send', validate({ body: B.callLink }), async (req, res) => {
  const { to, message, type } = req.body || {};
  if (type && type !== 'text') {
    return res.status(400).json({ success: false, error: 'Only text can be sent here. Use the Inbox for templates.' });
  }
  const cleanNumber = cleanPhone(to);
  if (!isValidPhone(cleanNumber) || !message) {
    return res.status(400).json({
      success: false,
      error: 'A valid recipient number ("to", digits with country code) and a message are required.',
    });
  }
  const r = await require('./inbox.cjs').sendText(cleanNumber, message, req.staff);
  if (r.error) return res.status(r.status || 400).json({ success: false, error: r.error, windowClosed: r.windowClosed || undefined });
  return res.json({ success: true, messageId: r.id });
});

router.get('/status', async (req, res) => {
  // This business's own WhatsApp connection (never the token or app secret).
  const isOwner = req.staff.role === 'owner';
  const wa = await connectionStatus(req.staff.businessId, { prepare: isOwner });
  res.json({
    // Owner-only: the webhook address and verify token are pasted into Meta.
    verifyToken: isOwner ? wa.verifyToken : undefined,
    webhookUrl: isOwner ? wa.webhookUrl : undefined,
    connectionSource: wa.source,
    isTokenConfigured: wa.connected,
    isPhoneIdConfigured: !!wa.phoneNumberId,
    isAppSecretConfigured: wa.hasAppSecret,
    isServiceKeyConfigured: !!config.supabaseServiceKey,
    missingConfig: [...(wa.connected ? [] : ['WHATSAPP_CONNECTION']), ...missingConfig().filter(k => k.startsWith('SUPABASE'))],
    phoneNumber: wa.phoneNumber,
    phoneNumberId: wa.phoneNumberId || null,
    apiVersion: config.graphApiVersion,
    totalMessages: recentFor(req.staff.businessId).messages.length,
    staff: { email: req.staff.email, role: req.staff.role },
    business: { id: req.staff.businessId, name: req.staff.businessName },
    // Staff only: the Realtime channel where this business's incoming calls ring (server/calls.cjs).
    callChannel: require('./calls.cjs').staffChannel(req.staff.businessId),
  });
});

// A signed call link for one customer (the dashboard's call button). Staff are already waiting in
// the room, so opening it doesn't ring anyone. The link is sent with POST /send (ownership rules apply).
router.post('/calls/link', async (req, res) => {
  const phone = cleanPhone(req.body?.phone);
  if (!isValidPhone(phone)) return res.status(400).json({ success: false, error: 'A valid customer number is required.' });
  try {
    const link = require('./calls.cjs').createCallLink({
      businessId: req.staff.businessId,
      businessName: req.staff.businessName,
      phone,
      name: typeof req.body?.name === 'string' ? req.body.name : '',
      outbound: true,
    });
    return res.json({ success: true, ...link });
  } catch (err) {
    console.error('[calls] link failed:', err);
    return res.status(503).json({ success: false, error: 'Calls are not set up on this server.' });
  }
});

// Agents work in the Inbox, Pipeline and Queries only: the bot setup, broadcasts, automations, analytics,
// AI, team, WhatsApp and setup pages (and their data) are for managers and the Business Admin.
router.get('/messages', requireManager, (req, res) => {
  res.json(recentFor(req.staff.businessId));
});

router.get('/bot-rules', requireManager, async (req, res) => {
  res.json({ rules: await store.getActiveBotRules(req.staff.businessId) });
});

router.post('/bot-rules', requireManager, async (req, res) => {
  const biz = req.staff.businessId;
  const { rules, rule } = req.body || {};
  // Start from what is saved for this business, so one edit never brings back deleted rules.
  const saved = await store.getActiveBotRules(biz);
  // Plan limit: number of keyword rules.
  const maxRules = (await limits.getPlan(biz)).limits.max_keyword_rules;
  if (Array.isArray(rules)) {
    if (!rules.every(isValidRule)) return res.status(400).json({ success: false, error: 'Invalid rules payload.' });
    if (maxRules !== null && rules.length > maxRules) return res.status(400).json({ success: false, limitReached: true, error: `Your plan allows ${maxRules} keyword rules. Ask the platform to upgrade your plan.` });
    store.setBotRules(biz, rules);
  } else if (isValidRule(rule)) {
    if (!saved.some((/** @type {{ id: string }} */ r) => r.id === rule.id)) {
      const room = await limits.check(biz, 'keywordRules', 1);
      if (room.error) return res.status(400).json({ success: false, limitReached: true, error: room.error });
    }
    store.upsertBotRule(biz, rule);
  } else {
    return res.status(400).json({ success: false, error: 'Send { rules: [...] } or { rule: {...} }.' });
  }
  const current = store.currentBotRules(biz);
  await store.syncRulesToSupabase(biz, current);
  res.json({ success: true, count: current.length, rules: current });
});

router.get('/bot-catalog', requireManager, async (req, res) => {
  res.json({ catalog: await store.getActiveCatalog(req.staff.businessId) });
});

router.delete('/bot-rules/:id', requireManager, async (req, res) => {
  const id = String(req.params.id || '');
  if (!id || id.length > 200) return res.status(400).json({ success: false, error: 'Invalid rule.' });
  const ok = await store.deleteBotRule(req.staff.businessId, id);
  if (!ok) return res.status(500).json({ success: false, error: 'Could not delete the rule.' });
  res.json({ success: true, rules: store.currentBotRules(req.staff.businessId) });
});

router.post('/bot-catalog', requireManager, async (req, res) => {
  const biz = req.staff.businessId;
  // { reset: true } puts the menus back to this business's starting bot.
  if (req.body?.reset === true) {
    await store.syncCatalogToSupabase(biz, store.resetCatalog(biz));
    return res.json({ success: true, catalog: store.currentCatalog(biz) });
  }
  const catalog = req.body?.catalog;
  if (catalog && typeof catalog === 'object' && !Array.isArray(catalog)) {
    await store.syncCatalogToSupabase(biz, store.mergeCatalog(biz, catalog));
  }
  res.json({ success: true, catalog: store.currentCatalog(biz) });
});

router.post('/clear', requireManager, (req, res) => {
  clearMessages(req.staff.businessId);
  res.json({ success: true, message: 'Message history cleared.' });
});

router.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const client = { res, businessId: req.staff.businessId };
  sseClients.add(client);
  req.on('close', () => sseClients.delete(client));
});

module.exports = router;
