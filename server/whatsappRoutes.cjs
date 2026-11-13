// @ts-check
// The business's own WhatsApp connection (mounted under /api, staff only).
// Managers can see whether a number is connected (agents don't see this page); only the Business Admin
// sees the webhook address and verify token, and changes or tests the connection.
// The access token and app secret are never sent back to the browser.
const express = require('express');
const wa = require('./whatsapp.cjs');
const { requireOwner, requireManager } = require('./tenant.cjs');
const { validate, body: B, params: P } = require('./validate.cjs');

const router = express.Router();
/** @type {import('./types.cjs').Reply} */
const reply = (res, r) => (r.error ? res.status(400).json({ success: false, error: r.error }) : res.json({ success: true, ...r }));

router.get('/whatsapp', requireManager, async (req, res) => {
  // The Business Admin gets the webhook address + verify token even before connecting a number.
  const s = await wa.connectionStatus(req.staff.businessId, { prepare: req.staff.role === 'owner' });
  if (req.staff.role !== 'owner') {
    return res.json({ connected: s.connected, source: s.source, phoneNumber: s.phoneNumber, role: req.staff.role });
  }
  res.json({ ...s, role: req.staff.role });
});

router.put('/whatsapp', requireOwner, validate({ body: B.whatsapp }), async (req, res) => reply(res, await wa.saveConnection(req.staff, req.body || {})));
router.post('/whatsapp/test', requireOwner, async (req, res) => reply(res, await wa.testConnection(req.staff.businessId)));

// Extra numbers (several WhatsApp numbers per business): managers see them; only the Business Admin changes them.
const numbers = require('./whatsappNumbers.cjs');
/** @type {import('./types.cjs').Reply} */
const replyStatus = (res, r) => (r.error ? res.status(r.status || 400).json({ success: false, ...r, status: undefined }) : res.json({ success: true, ...r }));
router.get('/whatsapp/numbers', requireManager, async (req, res) => res.json(await numbers.list(req.staff)));
router.post('/whatsapp/numbers', requireOwner, validate({ body: B.addNumber }), async (req, res) => replyStatus(res, await numbers.add(req.staff, req.body || {})));
router.patch('/whatsapp/numbers/:numberId', requireOwner, validate({ params: P.numberId, body: B.renameNumber }), async (req, res) => replyStatus(res, await numbers.rename(req.staff, req.params.numberId, req.body || {})));
router.delete('/whatsapp/numbers/:numberId', requireOwner, validate({ params: P.numberId }), async (req, res) => replyStatus(res, await numbers.remove(req.staff, req.params.numberId)));

module.exports = router;
