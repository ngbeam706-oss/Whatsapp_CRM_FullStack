// @ts-check
// Ads page API (mounted under /api, staff only).
// Owner + manager: read results, "Sync now", pause/resume ads, change budgets, alert thresholds.
// Owner only: connect / disconnect the ad account.
// Agents get 403 (they only see the "From ad" label on chats). The token is never returned.
const express = require('express');
const ads = require('./ads.cjs');
const { requireOwner, requireManager } = require('./tenant.cjs');
const { validate, params: P, body: B } = require('./validate.cjs');

const router = express.Router();
/** @type {import('./types.cjs').Reply} */
const reply = (res, r) => (r.error ? res.status(400).json({ success: false, error: r.error }) : res.json({ success: true, ...r }));
const NOT_IN_PLAN = 'Your plan does not include the Ads module. Ask the platform to upgrade your plan.';

router.get('/ads', requireManager, async (req, res) => {
  const biz = req.staff.businessId;
  const enabled = await ads.adsEnabled(biz);
  if (!enabled) return res.json({ success: true, adsEnabled: false, account: { connected: false }, report: null, role: req.staff.role });
  const account = await ads.accountStatus(biz);
  const r = account.connected ? await ads.report(biz, { days: Number(req.query.days) || undefined }) : { report: null };
  res.json({ success: true, adsEnabled: true, account, report: r.report || null, reportError: r.error || null, role: req.staff.role });
});

router.put('/ads/account', requireOwner, validate({ body: B.adAccount }), async (req, res) => reply(res, await ads.connect(req.staff, req.body || {})));
router.delete('/ads/account', requireOwner, async (req, res) => reply(res, await ads.disconnect(req.staff)));

router.post('/ads/sync', requireManager, async (req, res) => {
  if (!(await ads.adsEnabled(req.staff.businessId))) return res.status(403).json({ success: false, error: NOT_IN_PLAN });
  reply(res, await ads.manualSync(req.staff.businessId));
});

// ---- Phase C: controls (owner + manager; each change checked against the business's own ad
// account at Meta and written to the audit log) ----
/** Plan gate: 403 unless the plan includes the Ads module. @type {import('./types.cjs').Middleware} */
const gate = async (req, res, next) => {
  if (!(await ads.adsEnabled(req.staff.businessId))) return res.status(403).json({ success: false, error: NOT_IN_PLAN });
  return next();
};

router.post('/ads/ads/:adId/status', requireManager, gate, validate({ params: P.adId, body: B.adStatus }), async (req, res) =>
  reply(res, await ads.setAdStatus(req.staff, req.params.adId, req.body?.status)));

// Previews: thumbnails for the ads on screen (one Meta request), and one ad's full preview.
router.get('/ads/thumbnails', requireManager, gate, async (req, res) =>
  reply(res, await ads.adThumbnails(req.staff.businessId, req.query.ids)));
router.get('/ads/ads/:adId/preview', requireManager, gate, validate({ params: P.adId }), async (req, res) => {
  /** @type {any} */
  const r = await ads.adPreview(req.staff.businessId, req.params.adId, req.query.format);
  if (r.error) return res.status(r.status || 400).json({ success: false, error: r.error });
  res.json({ success: true, ...r });
});

// Phase D1: ready to create ads? Which Page, and the daily budget cap (server/adCreate.cjs).
const adCreate = require('./adCreate.cjs');
router.get('/ads/create/readiness', requireManager, gate, async (req, res) => reply(res, await adCreate.readiness(req.staff)));
router.put('/ads/create/page', requireOwner, gate, validate({ body: B.adPage }), async (req, res) => reply(res, await adCreate.choosePage(req.staff, req.body?.pageId)));
router.put('/ads/create/budget-cap', requireOwner, gate, validate({ body: B.adBudgetCap }), async (req, res) => reply(res, await adCreate.setBudgetCap(req.staff, req.body?.maxDailyBudget)));

// Phase D2: the wizard. Creating and launching: Business Admin only; managers see what was created.
/** @param {import('express').Response} res @param {any} r */
const replyS = (res, r) => (r.error ? res.status(r.status || 400).json({ success: false, error: r.error, problems: r.problems, needsConfirm: r.needsConfirm }) : res.json({ success: true, ...r }));
router.post('/ads/create/image', requireOwner, gate, validate({ body: B.adImage }), async (req, res) => replyS(res, await adCreate.uploadImage(req.staff, req.body)));
router.get('/ads/create/locations', requireOwner, gate, async (req, res) => replyS(res, await adCreate.searchLocations(req.staff, req.query.q)));
// Phase H: interests and languages for the audience; video upload (browser -> private storage -> Meta).
router.get('/ads/create/interests', requireOwner, gate, async (req, res) => replyS(res, await adCreate.searchInterests(req.staff, req.query.q)));
router.get('/ads/create/languages', requireOwner, gate, async (req, res) => replyS(res, await adCreate.searchLanguages(req.staff, req.query.q)));
router.post('/ads/create/video/upload-url', requireOwner, gate, async (req, res) => replyS(res, await adCreate.videoUploadUrl(req.staff, req.body || {})));
router.post('/ads/create/video', requireOwner, gate, async (req, res) => replyS(res, await adCreate.registerVideo(req.staff, (req.body || {}).path)));
router.get('/ads/create/video/:id/status', requireOwner, gate, validate({ params: P.numericId }), async (req, res) => replyS(res, await adCreate.videoStatus(req.staff, req.params.id)));
router.post('/ads/create/estimate', requireOwner, gate, async (req, res) => replyS(res, await adCreate.estimate(req.staff, req.body || {})));
router.post('/ads/create/preview', requireOwner, gate, async (req, res) => replyS(res, await adCreate.preview(req.staff, req.body || {})));
router.post('/ads/create', requireOwner, gate, async (req, res) => replyS(res, await adCreate.createAd(req.staff, req.body || {})));
router.post('/ads/launches/:id/launch', requireOwner, gate, validate({ params: P.id, body: B.adLaunch }), async (req, res) => replyS(res, await adCreate.launch(req.staff, req.params.id, req.body?.confirmBudget)));
// G2: edit an ad made here (Business Admin; checked again in adCreate.editAd).
router.put('/ads/launches/:id', requireOwner, gate, validate({ params: P.id }), async (req, res) => replyS(res, await adCreate.editAd(req.staff, req.params.id, req.body || {})));
// Delete an ad made here (in Meta, plus its emptied ad set / campaign), or remove a failed attempt from the list.
router.delete('/ads/launches/:id', requireOwner, gate, validate({ params: P.id }), async (req, res) => replyS(res, await adCreate.deleteLaunch(req.staff, req.params.id)));
// Phase I: one more ad in a campaign made here; existing Facebook / Instagram posts to use as ads.
router.post('/ads/launches/:id/ads', requireOwner, gate, validate({ params: P.id }), async (req, res) => replyS(res, await adCreate.addToCampaign(req.staff, req.params.id, req.body || {})));
router.get('/ads/create/posts', requireOwner, gate, async (req, res) => replyS(res, await adCreate.listPosts(req.staff, req.query.source)));
router.get('/ads/launches', requireManager, gate, async (req, res) => replyS(res, await adCreate.listLaunches(req.staff)));

// Ads F: rejected / auto-paused ads (managers + Business Admin), "Got it", duplicate an ad (paused copy).
const watch = require('./adWatch.cjs');
// (No plan gate: the menu badge asks on every plan, and gets an empty list without the Ads module.)
// Billing card (server/adBilling.cjs): read for managers; the account spending limit is the Business Admin's.
const billing = require('./adBilling.cjs');
router.get('/ads/billing', requireManager, gate, async (req, res) => replyS(res, await billing.status(req.staff)));
router.post('/ads/billing/check', requireManager, gate, async (req, res) => replyS(res, await billing.checkNow(req.staff)));
router.put('/ads/billing/spend-cap', requireOwner, gate, async (req, res) => replyS(res, await billing.setSpendCap(req.staff, (req.body || {}).spendCap)));

router.get('/ads/issues', requireManager, async (req, res) => replyS(res, await watch.listIssues(req.staff)));
router.post('/ads/issues/ack', requireManager, gate, async (req, res) => replyS(res, await watch.acknowledge(req.staff)));
router.post('/ads/ads/:adId/copy', requireManager, gate, validate({ params: P.adId }), async (req, res) => replyS(res, await watch.copyAd(req.staff, req.params.adId)));

// Ads E1: bookings back to Meta (Conversions API). Managers see it; the Business Admin switches it.
const conversions = require('./adConversions.cjs');
router.get('/ads/conversions', requireManager, gate, async (req, res) => replyS(res, await conversions.status(req.staff)));
router.put('/ads/conversions', requireOwner, gate, validate({ body: B.adConversions }), async (req, res) => replyS(res, await conversions.saveSettings(req.staff, req.body || {})));

router.get('/ads/adsets/:adsetId/budget', requireManager, gate, validate({ params: P.adsetId }), async (req, res) =>
  reply(res, await ads.getBudget(req.staff.businessId, req.params.adsetId)));

router.put('/ads/adsets/:adsetId/budget', requireManager, gate, validate({ params: P.adsetId, body: B.adBudget }), async (req, res) =>
  reply(res, await ads.setBudget(req.staff, req.params.adsetId, req.body?.dailyBudget)));

router.put('/ads/alerts', requireManager, gate, validate({ body: B.adAlerts }), async (req, res) =>
  reply(res, await ads.saveAlerts(req.staff, req.body || {})));

// ---- Funnel (A1 + A2; server/adsFunnel.cjs): managers + Business Admin; aggregates only. POST: the filters (an
// agent's email, a campaign) stay out of addresses. ----
const funnel = require('./adsFunnel.cjs');
router.post('/ads/funnel', requireManager, gate, validate({ body: B.adsFunnel }), async (req, res) => {
  try { reply(res, await funnel.report(req.staff.businessId, req.body || {})); } catch (err) { reply(res, { error: err instanceof Error ? err.message : 'Could not build the funnel.' }); }
});
router.post('/ads/funnel/export', requireManager, gate, validate({ body: B.adsFunnel }), async (req, res) => {
  const r = await funnel.report(req.staff.businessId, req.body || {});
  if ('error' in r && r.error) return reply(res, r);
  if (!('funnel' in r) || !r.funnel) return reply(res, { error: 'Connect an ad account first.' });
  const day = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="ads-funnel-${day}.csv"`);
  res.send(funnel.csvOf(r.funnel));
});

// ---- Manage (M1 + M2; server/adsManage.cjs): campaigns / ad sets / ads like Ads Manager. Managers + Business Admin;
// rename and end dates: Business Admin only (checked inside). ----
const manage = require('./adsManage.cjs');
const manageParams = validate({ params: require('zod').z.object({ level: require('zod').z.enum(['campaign', 'adset', 'ad']), id: require('zod').z.string().regex(/^\d{1,25}$/, 'is not a valid id') }) });
/** @param {import('express').Response} res @param {any} r */
const replyM = (res, r) => (r.error ? res.status(r.status || 400).json({ success: false, error: r.error }) : res.json({ success: true, ...r }));
router.get('/ads/manage', requireManager, gate, async (req, res) => replyM(res, await manage.list(req.staff, {
  level: req.query.level, parent: req.query.parent, q: req.query.q, delivery: req.query.delivery, days: req.query.days, refresh: req.query.refresh,
})));
router.post('/ads/manage/:level/:id/status', requireManager, gate, manageParams, async (req, res) =>
  replyM(res, await manage.setStatus(req.staff, req.params.level, req.params.id, (req.body || {}).status)));
router.patch('/ads/manage/:level/:id', requireManager, gate, manageParams, async (req, res) =>
  replyM(res, await manage.update(req.staff, req.params.level, req.params.id, req.body || {})));

module.exports = router;
