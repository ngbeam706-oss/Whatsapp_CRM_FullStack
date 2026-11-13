// @ts-check
// Staff profiles and team performance (mounted under /api, staff only). See server/staffStats.cjs.
//   GET/PUT /me/profile ............ everyone: my own details and my activity (and my place in the team)
//   GET /team/performance .......... Business Admin + managers: everyone's activity and the ranking
//   GET /team/members/:userId ...... Business Admin + managers: one member's details (incl. phone) + activity
const express = require('express');
const stats = require('./staffStats.cjs');
const { requireManager } = require('./tenant.cjs');
const { validate, params: P, body: B } = require('./validate.cjs');

const router = express.Router();

/** @param {import('express').Response} res @param {any} r */
const reply = (res, r) => (r.error ? res.status(r.status || 400).json({ success: false, error: r.error }) : res.json({ success: true, ...r }));
/**
 * @param {(req: import('express').Request) => Promise<any>} fn
 * @returns {(req: import('express').Request, res: import('express').Response) => Promise<void>}
 */
const safe = (fn) => async (req, res) => {
  try {
    reply(res, await fn(req));
  } catch (err) {
    console.error('[staff]', req.path, err);
    res.status(500).json({ success: false, error: 'Could not load team activity. Try again in a minute.' });
  }
};

router.get('/me/profile', safe((req) => stats.myProfile(req.staff, req.query.days)));
router.put('/me/profile', validate({ body: B.myProfile }), safe((req) => stats.saveMyProfile(req.staff, req.body || {})));
router.get('/team/performance', requireManager, safe((req) => stats.teamPerformance(req.staff, req.query.days)));
router.get('/team/members/:userId', requireManager, validate({ params: P.userId }), safe((req) => stats.memberDetail(req.staff, String(req.params.userId), req.query.days)));
// Onboarding details: the Business Admin edits managers and agents, managers edit agents (checked in saveMemberProfile).
router.put('/team/members/:userId/profile', requireManager, validate({ params: P.userId, body: B.memberProfile }), safe((req) => stats.saveMemberProfile(req.staff, String(req.params.userId), req.body || {})));

module.exports = router;
