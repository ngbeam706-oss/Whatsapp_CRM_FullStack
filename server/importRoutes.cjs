// @ts-check
// Customer fields, the customer details card and the customer import (mounted under /api, staff only).
// docs/progress/customer-import.md. Phone numbers travel in POST bodies, never in addresses.
const express = require('express');
const cf = require('./customFields.cjs');
const imports = require('./leadImport.cjs');
const { requireManager } = require('./tenant.cjs');
const { validate, params: P, body: B } = require('./validate.cjs');
const { rateLimit } = require('./security.cjs');

const router = express.Router();

/** @type {import('./types.cjs').Reply} */
const reply = (res, r) => {
  if (!r.error) return res.json({ success: true, ...r });
  const { status = 400, ...rest } = r;
  return res.status(status).json({ success: false, ...rest });
};
/** @param {import('express').Request} req */
const staffOf = (req) => /** @type {import('./types.cjs').Staff} */ (req.staff);

// ---- Customer fields: everyone reads the list (the details card); managers + Business Admin change it ----
const fieldKey = validate({ params: P.statusKey });
router.get('/customer-fields', async (req, res) => reply(res, await cf.view(staffOf(req))));
router.post('/customer-fields', requireManager, validate({ body: B.customField }), async (req, res) => reply(res, await cf.add(staffOf(req), req.body || {})));
router.put('/customer-fields/order', requireManager, validate({ body: B.customFieldOrder }), async (req, res) => reply(res, await cf.reorder(staffOf(req), (req.body || {}).keys)));
router.patch('/customer-fields/:key', requireManager, fieldKey, validate({ body: B.customField }), async (req, res) => reply(res, await cf.update(staffOf(req), String(req.params.key), req.body || {})));

// ---- Customer details card (agents: read-only, private values hidden) ----
router.post('/customer-details', validate({ body: B.customerDetails }), async (req, res) => reply(res, await cf.details(staffOf(req), (req.body || {}).phone)));
router.post('/customer-details/save', requireManager, validate({ body: B.customerDetailsSave }), async (req, res) => reply(res, await cf.saveDetails(staffOf(req), req.body || {})));

// ---- Import (managers + Business Admin). A 25,000-row file is 50 batches: 120 requests a minute is plenty. ----
const importLimit = rateLimit({ name: 'imports', windowMs: 60000, max: 120, message: 'Too many import requests. Wait a minute and press Import again.' });
const importId = validate({ params: P.id });
router.get('/imports', requireManager, async (req, res) => reply(res, await imports.list(staffOf(req))));
router.post('/imports/check', requireManager, importLimit, validate({ body: B.importCheck }), async (req, res) => reply(res, await imports.check(staffOf(req), req.body || {})));
router.post('/imports/start', requireManager, importLimit, validate({ body: B.importStart }), async (req, res) => reply(res, await imports.start(staffOf(req), req.body || {})));
router.post('/imports/:id/batch', requireManager, importLimit, importId, validate({ body: B.importBatch }), async (req, res) => reply(res, await imports.batch(staffOf(req), req.params.id, req.body || {})));
router.post('/imports/:id/finish', requireManager, importLimit, importId, async (req, res) => reply(res, await imports.finish(staffOf(req), req.params.id, req.body || {})));
router.post('/imports/:id/undo', requireManager, importLimit, importId, async (req, res) => reply(res, await imports.undo(staffOf(req), req.params.id)));

module.exports = router;
