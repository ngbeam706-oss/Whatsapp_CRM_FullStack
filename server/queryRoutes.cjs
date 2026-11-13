// @ts-check
// Queries API (mounted under /api, business staff only). Every call works on the signed-in
// staff member's own business; what each role may see and do is decided in queries.cjs.
const express = require('express');
const queries = require('./queries.cjs');
const { requireOwner, requireManager } = require('./tenant.cjs');
const { validate, params: P, body: B } = require('./validate.cjs');

const router = express.Router();
const id = validate({ params: P.id });
/** @type {import('./types.cjs').Reply} */
const reply = (res, r) => {
  if (!r.error) return res.json({ success: true, ...r });
  const { status = 400, ...rest } = r;
  return res.status(status).json({ success: false, ...rest });
};

// ---- Customer and team queries ------------------------------------------------------
router.get('/queries', async (req, res) => {
  const r = await queries.listQueries(req.staff, {
    view: req.query.view === 'team' ? 'team' : 'customer',
    stage: String(req.query.stage || ''),
    priority: String(req.query.priority || ''),
    category: String(req.query.category || ''),
    mine: req.query.mine === '1',
    overdue: req.query.overdue === '1',
    phone: String(req.query.phone || ''),
  });
  if (r.error) return res.status(500).json({ success: false, error: r.error });
  res.json(r);
});

router.get('/queries/settings', async (req, res) => {
  const biz = req.staff.businessId;
  const [customer, internal] = await Promise.all([queries.categories(biz, 'customer'), queries.categories(biz, 'internal')]);
  const b = await require('./db.cjs').dbRequest(`businesses?id=eq.${biz}&select=query_due_hours,industry`);
  res.json({
    categories: { customer, internal, platform: queries.PLATFORM_CATEGORIES },
    dueHours: b.data?.[0]?.query_due_hours || queries.DEFAULT_DUE_HOURS,
    industry: b.data?.[0]?.industry || 'general',
    stages: queries.STAGES, priorities: queries.PRIORITIES,
    ...(req.staff.role === 'owner' ? { allCategories: await queries.allCategories(biz) } : {}),
  });
});
// Numbers only (managers and the Business Admin), limited to the plan's analytics history.
router.get('/queries/stats', requireManager, async (req, res) => {
  const days = await require('./limits.cjs').clampAnalyticsDays(req.staff.businessId, req.query.days);
  const r = await queries.queryStats(req.staff, days);
  if (r.error) return res.status(500).json({ success: false, error: r.error });
  res.json(r);
});
router.put('/queries/settings/due-hours', requireOwner, async (req, res) => reply(res, await queries.saveDueHours(req.staff, req.body || {})));
router.post('/queries/settings/categories', requireOwner, async (req, res) => reply(res, await queries.saveCategory(req.staff, req.body || {})));

router.post('/queries', validate({ body: B.queryCreate }), async (req, res) => {
  const body = req.body || {};
  reply(res, await queries.createQuery(req.staff.businessId, body, { staff: req.staff, source: 'staff' }));
});
// Search: "Q-1042" -> that query, if this person may see it.
router.get('/queries/by-number/:number', async (req, res) => reply(res, await queries.findByNumber(req.staff, req.params.number)));
router.get('/queries/:id', id, async (req, res) => reply(res, await queries.getQueryDetail(req.staff, req.params.id)));
router.patch('/queries/:id', validate({ params: P.id, body: B.queryUpdate }), async (req, res) => reply(res, await queries.updateQuery(req.staff, req.params.id, req.body || {})));
router.post('/queries/:id/comments', validate({ params: P.id, body: B.queryComment }), async (req, res) => reply(res, await queries.addComment(req.staff, req.params.id, req.body || {})));
router.post('/queries/:id/escalate', validate({ params: P.id, body: B.queryEscalate }), async (req, res) => reply(res, await queries.escalate(req.staff, req.params.id, req.body?.note)));
router.post('/queries/:id/rating', validate({ params: P.id, body: B.queryRating }), async (req, res) => reply(res, await queries.rateQuery(req.staff, req.params.id, req.body || {})));

// ---- Platform support (any staff member raises; the raiser + Business Admin follow it) ----
router.get('/support', async (req, res) => {
  const r = await queries.listPlatformQueriesForBusiness(req.staff);
  if (r.error) return res.status(500).json({ success: false, error: r.error });
  res.json(r);
});
router.post('/support', validate({ body: B.queryCreate }), async (req, res) => reply(res, await queries.createPlatformQuery(req.staff, req.body || {})));
router.get('/support/:id', id, async (req, res) => reply(res, await queries.getPlatformQueryForBusiness(req.staff, req.params.id)));
router.post('/support/:id', validate({ params: P.id, body: B.supportAct }), async (req, res) => reply(res, await queries.businessActOnPlatformQuery(req.staff, req.params.id, req.body || {})));

module.exports = router;
