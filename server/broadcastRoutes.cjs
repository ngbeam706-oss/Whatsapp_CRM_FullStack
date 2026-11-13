// @ts-check
// Templates + broadcast campaigns API (mounted under /api, staff only).
// Anything that sends to customers or changes templates: Business Admin or manager.
// Templates live in the WhatsApp account, so a business only sees and changes its own
// account's templates (until M3 only the business that owns the environment's number has one).
const express = require('express');
const tpl = require('./templates.cjs');
const campaigns = require('./campaigns.cjs');
const { requireManager, NO_WHATSAPP } = require('./tenant.cjs');
const { getWhatsApp } = require('./whatsapp.cjs');
const { validate, params: P } = require('./validate.cjs');

const router = express.Router();
// Template and campaign bodies are nested; templates.cjs / campaigns.cjs check them in detail.
const campaignId = validate({ params: P.id });

/** @param {import('express').Response} res @param {string} error @param {number} [status] */
const fail = (res, error, status = 400) => res.status(status).json({ success: false, error });
/** Meta's error text for people. @param {any} r */
const metaError = (r) => r.error?.error_user_msg || r.error?.error_user_title || r.error?.message || 'Meta rejected the request.';

/** The business's WhatsApp connection on req.wa, or 400. @type {import('./types.cjs').Middleware} */
async function requireWhatsApp(req, res, next) {
  req.wa = await getWhatsApp(req.staff.businessId);
  if (!req.wa) return fail(res, NO_WHATSAPP);
  return next();
}

// ---- Account ---------------------------------------------------------------
// Broadcasts are for managers and the Business Admin. Agents may still list templates: the Inbox sends
// them when a chat's 24-hour window has closed.
router.get('/broadcast/account', requireManager, async (req, res) => {
  const wa = await getWhatsApp(req.staff.businessId);
  if (!wa) {
    return res.json({ wabaConfigured: false, phone: null, phoneError: NO_WHATSAPP, dailyLimit: null, role: req.staff.role });
  }
  const info = await tpl.phoneAccountInfo(wa);
  res.json({
    wabaConfigured: !!wa.wabaId,
    phone: info.error ? null : info,
    phoneError: info.error ? metaError(info) : null,
    // Meta's limit on business-started conversations per 24h, e.g. TIER_250 -> 250.
    dailyLimit: Number(String(info.messaging_limit_tier || '').replace(/\D/g, '')) || null,
    role: req.staff.role,
  });
});

// ---- Templates -------------------------------------------------------------
router.get('/templates', requireWhatsApp, async (req, res) => {
  // ?number=<id>: templates of that business number's account (the Inbox's "Reply from"); never another business's.
  const number = String(req.query.number || '');
  let wa = req.wa;
  if (number) {
    wa = /^\d{5,30}$/.test(number) ? await require('./whatsapp.cjs').connectionForNumber(req.staff.businessId, number) : null;
    if (!wa) return fail(res, 'That WhatsApp number isn\'t connected to this business.');
  }
  const r = await tpl.listTemplates(wa);
  if (r.error) return fail(res, metaError(r), 502);
  res.json({ templates: r.data });
});

router.post('/templates', requireManager, requireWhatsApp, async (req, res) => {
  const r = await tpl.createTemplate(req.wa, req.body || {});
  if (r.error) return fail(res, metaError(r));
  res.json({ success: true, id: r.id, status: r.status, category: r.category });
});

router.delete('/templates/:name', requireManager, validate({ params: P.templateName }), requireWhatsApp, async (req, res) => {
  const r = await tpl.deleteTemplate(req.wa, req.params.name);
  if (r.error) return fail(res, metaError(r));
  res.json({ success: true });
});

// ---- Audience --------------------------------------------------------------
router.get('/audience/options', requireManager, async (req, res) => {
  res.json(await campaigns.audienceOptions(req.staff.businessId));
});

router.post('/audience/preview', requireManager, async (req, res) => {
  try {
    const a = await campaigns.resolveAudience(req.staff.businessId, req.body?.segment || {});
    res.json({
      count: a.recipients.length,
      optedOutExcluded: a.optedOut,
      notInContacts: a.unknown,
      sample: a.recipients.slice(0, 5),
    });
  } catch (err) {
    fail(res, err instanceof Error ? err.message : String(err), 500);
  }
});

// ---- Campaigns -------------------------------------------------------------
router.get('/campaigns', requireManager, async (req, res) => {
  const r = await campaigns.listCampaigns(req.staff.businessId);
  if (r.error) return fail(res, r.error, 500);
  res.json(r);
});

router.get('/campaigns/:id', requireManager, campaignId, async (req, res) => {
  const r = await campaigns.getCampaign(req.staff.businessId, req.params.id);
  if (r.error) return fail(res, r.error, 404);
  res.json(r);
});

router.post('/campaigns', requireManager, async (req, res) => {
  const r = await campaigns.createCampaign(req.staff, req.body || {});
  if (r.error) return fail(res, r.error);
  let start = null;
  if (req.body?.sendNow) start = await campaigns.startCampaign(req.staff.businessId, r.campaign.id);
  res.json({ success: true, ...r, start });
});

router.post('/campaigns/test', requireManager, async (req, res) => {
  const r = await campaigns.sendTest(req.staff.businessId, req.body || {});
  if (r.error) return fail(res, r.error);
  res.json({ success: true, ...r });
});

router.post('/campaigns/:id/start', requireManager, campaignId, async (req, res) => {
  const r = await campaigns.startCampaign(req.staff.businessId, req.params.id);
  if (r.error) return fail(res, r.error);
  res.json({ success: true, ...r });
});

router.post('/campaigns/:id/cancel', requireManager, campaignId, async (req, res) => {
  const r = await campaigns.cancelCampaign(req.staff.businessId, req.params.id);
  if (r.error) return fail(res, r.error);
  res.json({ success: true, ...r });
});

module.exports = router;
