// @ts-check
// Activity log routes (docs/progress/activity-log.md).
//   authRoutes(app): sign-in / sign-out / own password change, for staff, doctors and platform staff (the token is checked
//                    and its owner worked out in server/activity.cjs; rate-limited per address).
//   staffRouter:     POST /activity/list and /activity/export (filters in the body, so search words never sit in an
//                    address or a server log): the Business Admin only.
const express = require('express');
const activity = require('./activity.cjs');
const { requireOwner } = require('./tenant.cjs');
const { rateLimit } = require('./security.cjs');

/** @type {import('./types.cjs').Reply} */
const reply = (res, r) => {
  if (!r.error) return res.json({ success: true, ...r });
  const { status = 400, ...rest } = r;
  return res.status(status).json({ success: false, ...rest });
};

/** @param {import('express').Express} app @param {import('./types.cjs').Middleware} guard  the failed-sign-in guard */
function authRoutes(app, guard) {
  const limit = rateLimit({ name: 'auth_events', windowMs: 60000, max: 30 });
  /** @param {(req: any) => Promise<any>} fn @returns {import('./types.cjs').Middleware} */
  const handle = (fn) => async (req, res) => {
    const r = await fn(req);
    if (r.error) res.locals.authFailed = true;
    reply(res, r);
  };
  app.post('/api/auth/signed-in', guard, limit, handle(req => activity.signedIn(req)));
  // Signing out and changing your own password: a few a minute is plenty (each is also once per session / audited).
  const few = rateLimit({ name: 'auth_events_few', windowMs: 60000, max: 5 });
  app.post('/api/auth/signed-out', guard, few, handle(req => activity.selfEvent(req, 'auth.signed_out')));
  app.post('/api/auth/password-changed', guard, few, handle(req => activity.selfEvent(req, 'auth.password_changed')));
}

const staffRouter = express.Router();
/** @param {import('express').Request} req */
const staffOf = (req) => /** @type {import('./types.cjs').Staff} */ (req.staff);
/** The filters from a JSON body (strings / numbers only). @param {import('express').Request} req */
const filtersOf = (req) => {
  const b = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  /** @type {Record<string, string>} */
  const out = {};
  for (const k of ['person', 'area', 'from', 'to', 'q', 'tab', 'beforeId']) if (typeof b[k] === 'string' || typeof b[k] === 'number') out[k] = String(b[k]).slice(0, 200);
  return out;
};
staffRouter.post('/activity/list', requireOwner, async (req, res) => reply(res, await activity.listActivity(staffOf(req), filtersOf(req))));
staffRouter.post('/activity/export', requireOwner, async (req, res) => {
  const r = await activity.exportActivity(staffOf(req), filtersOf(req));
  if ('error' in r) return reply(res, r);
  const day = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="activity-${day}.csv"`);
  res.set('X-Entry-Count', String(r.count));
  res.set('X-Entry-Capped', r.capped ? '1' : '0');
  res.send(r.csv);
});

module.exports = { authRoutes, staffRouter };
