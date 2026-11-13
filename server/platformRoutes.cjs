// @ts-check
// Platform console API, mounted at /api/platform (platform staff only, NOT business staff).
// Counts and settings only: no customer, chat or message data is ever returned here.
//
// Platform roles (docs/progress/platform-roles.md): every route names who may use it. The Platform Owner may use
// all of them; `only('manager')` = Owner + Application Manager, `only('developer')` = Owner + Application Developer.
//   Owner only:        plans, business changes (plan, limits, status, paid-until), branding, maintenance switch,
//                      audit log, platform team.
//   + Manager:         sign-ups, new business, onboarding tracker, resend the owner's invite, support queries.
//   + Developer:       health, event log, worker runs, delivery.
//   Every role:        /me, overview (business list, read-only), one business's details, "Check WhatsApp",
//                      maintenance state (read).
const express = require('express');
const platform = require('./platform.cjs');
const monitor = require('./monitor.cjs');
const platformTeam = require('./platformTeam.cjs');
const { validate, params: P, body: B } = require('./validate.cjs');

const router = express.Router();
const id = validate({ params: P.id });
const only = platform.requirePlatformRole;
const ownerOnly = only();
const support = only('manager');
const tech = only('developer');
/** @type {import('./types.cjs').Reply} */
const reply = (res, r) => (r.error ? res.status(r.status || 400).json({ success: false, error: r.error }) : res.json({ success: true, ...r }));
/**
 * Run a monitor call; any thrown error becomes a plain 500 (details only in the server log).
 * @param {(req: import('express').Request) => Promise<any>} fn
 * @returns {(req: import('express').Request, res: import('express').Response) => Promise<void>}
 */
const safe = (fn) => async (req, res) => {
  try {
    reply(res, await fn(req));
  } catch (err) {
    console.error('[platform]', req.path, err);
    res.status(500).json({ success: false, error: 'Something went wrong. See the server log.' });
  }
};

router.use(platform.requirePlatformAdmin);

router.get('/me', (req, res) => res.json({ email: req.platformAdmin.email, role: req.platformAdmin.role, roleLabel: platform.PLATFORM_ROLE_LABEL[req.platformAdmin.role] }));
router.get('/overview', async (req, res) => {
  const r = await platform.overview();
  if (r.error) return res.status(500).json({ success: false, error: r.error });
  res.json(r);
});
router.post('/businesses', support, async (req, res) => reply(res, await platform.createBusiness(req.platformAdmin, req.body || {})));
router.patch('/businesses/:id', ownerOnly, id, async (req, res) => reply(res, await platform.updateBusiness(req.platformAdmin, req.params.id, req.body || {})));
router.put('/plans/:id', ownerOnly, validate({ params: P.planId }), async (req, res) => reply(res, await platform.updatePlan(req.platformAdmin, req.params.id, req.body || {})));

// Onboarding: new businesses with their setup checklist (yes/no per step), and resending the owner's invite.
router.get('/onboarding', support, safe((req) => platform.onboarding(req.query)));
router.post('/businesses/:id/resend-invite', support, id, async (req, res) => reply(res, await platform.resendOwnerInvite(req.platformAdmin, req.params.id)));

// Sign-up requests from the public site (the platform's own prospects, not any business's customers).
const signups = require('./signupRequests.cjs');
router.get('/signup-requests', support, safe((req) => signups.list(req.query)));
router.post('/signup-requests/:id/approve', support, id, async (req, res) => reply(res, await signups.approve(req.platformAdmin, req.params.id, req.body || {})));
router.post('/signup-requests/:id/reject', support, id, async (req, res) => reply(res, await signups.reject(req.platformAdmin, req.params.id, req.body || {})));

// Monitoring: health, alerts, event log, worker runs, delivery failures, audit log.
// Counts, statuses and short scrubbed error texts only (see server/monitor.cjs).
router.get('/health', tech, safe(() => monitor.healthWithAlerts()));
router.get('/events', tech, safe((req) => monitor.listEvents(req.query)));
router.get('/worker-runs', tech, safe((req) => monitor.workerRuns(req.query)));
router.get('/delivery', tech, safe((req) => monitor.deliveryStats(req.query)));
router.get('/audit', ownerOnly, safe((req) => monitor.auditLog(req.query)));
// (The business's audit entries are the Platform Owner's only, like the Audit tab.)
router.get('/businesses/:id', id, safe(async (req) => {
  const r = await monitor.businessDetail(req.params.id);
  return req.platformAdmin.role === 'owner' || 'error' in r ? r : { ...r, recentAudit: [] };
}));
router.post('/businesses/:id/check-whatsapp', id, safe((req) => monitor.checkWhatsApp(req.platformAdmin, req.params.id)));

// Branding: the application's name, logo, company and contact details (server/branding.cjs).
const brandingStore = require('./branding.cjs');
router.get('/branding', ownerOnly, safe(async () => brandingStore.adminView()));
router.put('/branding', ownerOnly, async (req, res) => {
  const r = await brandingStore.save(req.platformAdmin, req.body || {});
  // Problems per field, so the console can show each one next to its box.
  if ('error' in r) { res.status(r.status || 400).json({ success: false, error: r.error, errors: 'errors' in r ? r.errors : undefined }); return; }
  res.json({ success: true, ...r });
});
router.post('/branding/logo', ownerOnly, async (req, res) => reply(res, await brandingStore.saveLogo(req.platformAdmin, (req.body || {}).dataUrl)));
router.delete('/branding/logo', ownerOnly, async (req, res) => reply(res, await brandingStore.removeLogo(req.platformAdmin)));

// Maintenance mode for the whole platform (server/maintenance.cjs). Everyone sees the state; only the owner switches it.
const maintenance = require('./maintenance.cjs');
router.get('/maintenance', safe(async () => ({ maintenance: await maintenance.getState({ fresh: true }) })));
router.put('/maintenance', ownerOnly, validate({ body: B.maintenance }), async (req, res) => reply(res, await maintenance.setState(req.platformAdmin, req.body || {})));

// Platform support queries (raised by any business's staff). Never customer or team queries.
// Owner + Application Managers; "Mine / Unassigned" via ?who=mine|unassigned.
const queries = require('./queries.cjs');
router.get('/support', support, async (req, res) => {
  const r = await queries.platformListAll({ stage: String(req.query.stage || ''), businessId: String(req.query.businessId || ''), who: String(req.query.who || ''), me: req.platformAdmin.email });
  if (r.error) return res.status(500).json({ success: false, error: r.error });
  res.json(r);
});
router.get('/support-assignees', support, safe(() => platformTeam.assignees()));
router.get('/support/:id', support, id, async (req, res) => reply(res, await queries.platformGet(req.params.id)));
router.patch('/support/:id', support, validate({ params: P.id, body: B.supportAct }), async (req, res) => reply(res, await queries.platformUpdate(req.platformAdmin, req.params.id, req.body || {})));

// Platform team (Platform Owner only): add by email with a role, change role, remove. Audited.
router.get('/team', ownerOnly, safe(() => platformTeam.list()));
router.post('/team', ownerOnly, validate({ body: B.platformTeamAdd }), async (req, res) => reply(res, await platformTeam.add(req.platformAdmin, req.body || {})));
router.patch('/team/:id', ownerOnly, validate({ params: P.id, body: B.platformTeamRole }), async (req, res) => reply(res, await platformTeam.changeRole(req.platformAdmin, req.params.id, (req.body || {}).role)));
router.delete('/team/:id', ownerOnly, id, async (req, res) => reply(res, await platformTeam.remove(req.platformAdmin, req.params.id)));

module.exports = router;
