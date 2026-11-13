// @ts-check
// Automations (follow-ups) API, mounted under /api (staff only; changes: Business Admin or manager).
// Every call works on the signed-in staff member's own business.
const express = require('express');
const automations = require('./automations.cjs');
const { requireManager } = require('./tenant.cjs');
const { validate, params: P } = require('./validate.cjs');

const router = express.Router();
// Automation bodies are checked in detail by automations.cjs; ids are checked here.
const id = validate({ params: P.id });

/** @param {import('express').Response} res @param {any} r @param {number} [okStatus] */
const reply = (res, r, okStatus = 200) => (r.error ? res.status(400).json({ success: false, error: r.error }) : res.status(okStatus).json({ success: true, ...r }));

// Managers and the Business Admin only (agents don't see automations).
router.get('/automations', requireManager, async (req, res) => {
  const r = await automations.listAutomations(req.staff.businessId);
  if (r.error) return res.status(500).json({ success: false, error: r.error });
  res.json(r);
});

router.get('/automations/:id', requireManager, id, async (req, res) => {
  const r = await automations.getAutomation(req.staff.businessId, req.params.id);
  if (r.error) return res.status(404).json({ success: false, error: r.error });
  res.json(r);
});

router.post('/automations', requireManager, async (req, res) => reply(res, await automations.createAutomation(req.staff, req.body || {})));
router.patch('/automations/:id', requireManager, id, async (req, res) => reply(res, await automations.updateAutomation(req.staff.businessId, req.params.id, req.body || {})));
router.delete('/automations/:id', requireManager, id, async (req, res) => reply(res, await automations.deleteAutomation(req.staff.businessId, req.params.id)));
router.post('/automation-runs/:runId/cancel', requireManager, validate({ params: P.runId }), async (req, res) => reply(res, await automations.cancelRun(req.staff.businessId, req.params.runId)));

module.exports = router;
