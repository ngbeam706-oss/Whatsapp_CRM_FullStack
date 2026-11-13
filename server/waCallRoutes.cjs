// @ts-check
// WhatsApp voice calls from the dashboard (mounted under /api, staff only). See server/waCalls.cjs.
// Who may answer or decline: the same rule as replying to that chat (unassigned -> anyone, and it is
// claimed; assigned to someone else -> view only). Only the person on a call can hang it up.
const express = require('express');
const waCalls = require('./waCalls.cjs');
const { validate, body: B } = require('./validate.cjs');

const router = express.Router();

/** @param {import('express').Response} res @param {any} r */
const reply = (res, r) => (r.error ? res.status(r.status || 400).json({ success: false, error: r.error }) : res.json({ success: true, ...r }));

router.get('/wa-calls/ringing', async (req, res) => reply(res, await waCalls.ringing(req.staff)));
router.post('/wa-calls/claim', validate({ body: B.waCall }), async (req, res) => reply(res, await waCalls.claim(req.staff, req.body.callId)));
router.post('/wa-calls/accept', validate({ body: B.waCallAnswer }), async (req, res) => reply(res, await waCalls.accept(req.staff, req.body.callId, req.body.sdp)));
router.post('/wa-calls/connect', validate({ body: B.waCall }), async (req, res) => reply(res, await waCalls.connect(req.staff, req.body.callId)));
router.post('/wa-calls/release', validate({ body: B.waCall }), async (req, res) => reply(res, await waCalls.release(req.staff, req.body.callId)));
router.post('/wa-calls/hangup', validate({ body: B.waCall }), async (req, res) => reply(res, await waCalls.hangUp(req.staff, req.body.callId)));

// Recordings (server/callRecordings.cjs): the person on the call uploads; allowed people play.
const recordings = require('./callRecordings.cjs');
router.post('/wa-calls/recording/upload-url', validate({ body: B.waCallUpload }), async (req, res) => reply(res, await recordings.uploadUrl(req.staff, req.body)));
router.post('/wa-calls/recording/complete', validate({ body: B.waCallDone }), async (req, res) => reply(res, await recordings.complete(req.staff, req.body)));
router.post('/wa-calls/recording/play', validate({ body: B.waCall }), async (req, res) => reply(res, await recordings.playUrl(req.staff, req.body)));

module.exports = router;
