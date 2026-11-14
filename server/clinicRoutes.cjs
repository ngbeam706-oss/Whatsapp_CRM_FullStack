// @ts-check
// Clinic module routes (docs/progress/clinic.md).
//   staffRouter  - mounted on /api after requireStaff: settings, doctors, slots, appointments, payments.
//   doctorRouter - mounted on /api/doctor with requireDoctor: a doctor's own hours, days off and queue only.
const express = require('express');
const { requireOwner, requireManager } = require('./tenant.cjs');
const { validate, params } = require('./validate.cjs');
const clinic = require('./clinic.cjs');
const pay = require('./clinicPay.cjs');
const patients = require('./clinicPatients.cjs');

/** @param {import('express').Response} res @param {any} r */
const reply = (res, r) => (r.error ? res.status(r.status || 400).json({ success: false, error: r.error, windowClosed: r.windowClosed }) : res.json({ success: true, ...r }));
const id = validate({ params: params.id });

const staffRouter = express.Router();
staffRouter.get('/clinic/status', async (req, res) => reply(res, await clinic.status(req.staff)));
staffRouter.get('/clinic/settings', requireManager, async (req, res) => reply(res, await pay.view(req.staff)));
staffRouter.put('/clinic/razorpay', requireOwner, async (req, res) => reply(res, await pay.save(req.staff, req.body || {})));
staffRouter.get('/clinic/doctors', async (req, res) => reply(res, await clinic.listDoctors(req.staff)));
staffRouter.post('/clinic/doctors', requireManager, async (req, res) => reply(res, await clinic.addDoctor(req.staff, req.body || {})));
staffRouter.patch('/clinic/doctors/:id', requireManager, id, async (req, res) => reply(res, await clinic.updateDoctor(req.staff, String(req.params.id), req.body || {})));
staffRouter.get('/clinic/doctors/:id/slots', id, async (req, res) => reply(res, await clinic.slots(req.staff, String(req.params.id), req.query.day)));
staffRouter.get('/clinic/appointments', async (req, res) => reply(res, await clinic.listAppointments(req.staff, { day: req.query.day, doctorId: req.query.doctorId, phone: req.query.phone })));
staffRouter.post('/clinic/appointments', async (req, res) => reply(res, await clinic.book(req.staff, req.body || {})));
staffRouter.post('/clinic/appointments/:id/status', id, async (req, res) => reply(res, await clinic.setStatus(req.staff, String(req.params.id), req.body || {})));
staffRouter.post('/clinic/appointments/:id/desk-payment', id, async (req, res) => reply(res, await clinic.recordDeskPayment(req.staff, String(req.params.id), req.body || {})));
staffRouter.post('/clinic/appointments/:id/payment-link', id, async (req, res) => reply(res, await pay.paymentLink(req.staff, String(req.params.id), req.body || {})));
staffRouter.post('/clinic/appointments/:id/check-payment', id, async (req, res) => reply(res, await pay.checkPayment(req.staff, String(req.params.id))));
staffRouter.get('/clinic/patients', async (req, res) => reply(res, await patients.patientsForPhone(req.staff, req.query.phone)));
staffRouter.get('/clinic/follow-ups', async (req, res) => reply(res, await patients.followUps(req.staff, { scope: req.query.scope })));
staffRouter.post('/clinic/appointments/:id/follow-up-done', id, async (req, res) => reply(res, await patients.followUpDone(req.staff, String(req.params.id))));

const doctorRouter = express.Router();
/** @param {import('express').Request} req @returns {any} */
const doc = (req) => /** @type {any} */ (req).doctor;
doctorRouter.get('/me', (req, res) => res.json({ success: true, doctor: { name: doc(req).name, email: doc(req).email } }));
doctorRouter.get('/appointments', async (req, res) => reply(res, await clinic.myQueue(doc(req), req.query.day)));
doctorRouter.post('/appointments/:id/seen', id, async (req, res) => reply(res, await clinic.markSeen(doc(req), String(req.params.id))));
doctorRouter.get('/appointments/:id', id, async (req, res) => reply(res, await patients.visit(doc(req), String(req.params.id))));
doctorRouter.post('/appointments/:id/sheets', id, async (req, res) => reply(res, await patients.addSheet(doc(req), String(req.params.id), req.body || {})));
doctorRouter.delete('/appointments/:id/sheets/:sheetId', id, async (req, res) => reply(res, await patients.removeSheet(doc(req), String(req.params.id), String(req.params.sheetId))));
doctorRouter.put('/appointments/:id/follow-up', id, async (req, res) => reply(res, await patients.setFollowUp(doc(req), String(req.params.id), req.body || {})));
doctorRouter.get('/patients', async (req, res) => reply(res, await patients.myPatients(doc(req), req.query.q)));
doctorRouter.get('/patients/:id', id, async (req, res) => reply(res, await patients.patientDetail(doc(req), String(req.params.id))));
doctorRouter.get('/hours', async (req, res) => reply(res, await clinic.myHours(doc(req))));
doctorRouter.put('/hours', async (req, res) => reply(res, await clinic.saveMyHours(doc(req), req.body || {})));
doctorRouter.post('/days-off', async (req, res) => reply(res, await clinic.setDayOff(doc(req), (req.body || {}).day, true)));
doctorRouter.delete('/days-off/:day', async (req, res) => reply(res, await clinic.setDayOff(doc(req), req.params.day, false)));

module.exports = { staffRouter, doctorRouter };
