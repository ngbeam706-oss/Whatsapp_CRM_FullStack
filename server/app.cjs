// @ts-check
// Express app: webhook (public, signature-checked) + dashboard API (staff only).
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { resolveWebhookBusiness, verifyMetaSignature, handleWebhookVerification, handleWebhookEvent } = require('./webhook.cjs');
const { requireStaff } = require('./auth.cjs');
const apiRoutes = require('./routes.cjs');
const broadcastRoutes = require('./broadcastRoutes.cjs');
const automationRoutes = require('./automationRoutes.cjs');
const inboxRoutes = require('./inboxRoutes.cjs');
const whatsappRoutes = require('./whatsappRoutes.cjs');
const queryRoutes = require('./queryRoutes.cjs');
const adsRoutes = require('./adsRoutes.cjs');
const { securityHeaders, rateLimit, authFailureGuard, clientErrorRoute, errorHandler } = require('./security.cjs');

const ROOT = path.join(__dirname, '..');
const app = express();

app.disable('x-powered-by');
app.use(securityHeaders);

// The dashboard is served from the same origin, so cross-origin access is off unless
// ALLOWED_ORIGINS lists extra origins (comma-separated).
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : false }));

// The ad picture (Ads -> Create an ad) arrives as base64 text: up to 1 MB of image is ~1.4 MB of JSON.
// Only this route gets the larger limit (parsed here first, so the parser below skips it).
app.use('/api/ads/create/image', express.json({ limit: '2mb' }));
// A doctor's case-sheet photo (server/clinicPatients.cjs, at most 4 MB of image): only the upload route.
app.post('/api/doctor/appointments/:id/sheets', express.json({ limit: '6mb' }));
// Keep the raw body: the webhook signature is computed over the exact bytes Meta sent.
app.use(express.json({
  limit: '1mb',
  verify: (req, res, buf) => { /** @type {import('express').Request} */ (/** @type {unknown} */ (req)).rawBody = buf; },
}));
app.use(express.static(path.join(ROOT, 'public')));

// ---- Limits per address for the dashboard API (not the webhook: Meta sends delivery receipts in
// big bursts from a few addresses, and every webhook call is signature-checked anyway) ----------
// ~12 requests/min per open dashboard, so 600/min leaves room for ~40 staff behind one office address.
const apiLimit = rateLimit({ name: 'api', windowMs: 60000, max: 600 });
const apiAuthGuard = authFailureGuard({ windowMs: 60000, max: 30 });
app.use('/api', (req, res, next) => (req.path.startsWith('/webhook') || req.path.startsWith('/whatsapp/webhook') ? next() : apiLimit(req, res, next)));
// Every POST/PUT/PATCH body must be a JSON object (routes add their own schemas, server/validate.cjs).
app.use('/api', require('./validate.cjs').requireObjectBody);

// ---- Public: Meta webhook --------------------------------------------------
// Each business has its own address, /webhook/<key> (shown on its WhatsApp page). The old
// /webhook address keeps working for the business whose number is in the environment settings.
const WEBHOOK_PATHS = ['/webhook', '/api/webhook', '/api/whatsapp/webhook'];
const BUSINESS_WEBHOOK_PATHS = ['/webhook/:key', '/api/webhook/:key'];
app.get([...WEBHOOK_PATHS, ...BUSINESS_WEBHOOK_PATHS], resolveWebhookBusiness, handleWebhookVerification);
app.post([...WEBHOOK_PATHS, ...BUSINESS_WEBHOOK_PATHS], resolveWebhookBusiness, verifyMetaSignature, handleWebhookEvent);

// ---- Public: liveness check (reveals nothing) ------------------------------
app.get('/api/health', (req, res) => res.json({ ok: true }));

// ---- Public: "Forgot password?" (agents get no reset email: their manager sets it; same answer always) ----
app.post('/api/auth/forgot-password', rateLimit({ name: 'forgot_password', windowMs: 15 * 60000, max: 5 }),
  require('./validate.cjs').validate({ body: require('./validate.cjs').body.forgotPassword }),
  async (req, res) => res.json(await require('./team.cjs').forgotPassword(req.body?.email)));

// ---- Public: is the platform under maintenance? (the sign-in page and the maintenance screen ask) ----
const maintenance = require('./maintenance.cjs');
app.get('/api/maintenance', async (req, res) => res.json(maintenance.publicView(await maintenance.getState())));

// ---- Public: a customer opened a call link -> ring that business's dashboard ----
// Only a link the server signed can ring, and only its own business (server/calls.cjs).
app.post('/api/call-ring', rateLimit({ name: 'call_ring', windowMs: 60000, max: 20 }), async (req, res) => {
  const r = await require('./calls.cjs').ring(req.body?.t);
  if ('error' in r) return res.status(r.status).json({ success: false, error: r.error });
  return res.json({ success: true, rang: r.rang });
});

// ---- Public: the public site's pricing page and "Get started" sign-up requests ----
const signups = require('./signupRequests.cjs');
app.get('/api/public/plans', rateLimit({ name: 'public_plans', windowMs: 60000, max: 60 }), async (req, res) => res.json(await signups.publicPlans()));
// The application's name, logo and contact details (server/branding.cjs): public, so browsers and Netlify's CDN may
// keep them a little while (fewer function calls). The logo address carries a version, so it can be kept long.
const branding = require('./branding.cjs');
app.get('/api/public/branding', rateLimit({ name: 'public_branding', windowMs: 60000, max: 120 }), async (req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  res.set('Netlify-CDN-Cache-Control', 'public, max-age=120');
  res.json(await branding.publicBranding());
});
app.get('/api/public/logo', rateLimit({ name: 'public_logo', windowMs: 60000, max: 120 }), async (req, res) => {
  const file = await branding.logoFile();
  if (!file) { res.status(404).json({ error: 'No logo.' }); return; }
  const long = typeof req.query.v === 'string' && /^[a-f0-9]{12}$/.test(req.query.v);
  res.set('Cache-Control', long ? 'public, max-age=31536000, immutable' : 'public, max-age=300');
  res.set('Netlify-CDN-Cache-Control', long ? 'public, max-age=31536000, immutable' : 'public, max-age=300');
  res.set('Content-Disposition', 'inline; filename="logo"');
  res.type(file.type).send(file.body);
});
app.post('/api/public/signup-requests', rateLimit({ name: 'signup_request', windowMs: 60 * 60000, max: 5, message: 'Too many requests from this network. Please try again in an hour, or write to us.' }),
  async (req, res) => {
    const r = await signups.submit(req.body || {});
    if ('error' in r) return res.status(r.status).json({ success: false, error: r.error, errors: r.errors });
    return res.json({ success: true, message: r.message });
  });

// ---- Public: Razorpay webhook for a clinic's payment links (signed with the clinic's webhook secret; server/clinicPay.cjs) ----
app.post('/webhook/razorpay/:key', rateLimit({ name: 'razorpay_webhook', windowMs: 60000, max: 120 }), async (req, res) => {
  const r = await require('./clinicPay.cjs').handleWebhook(String(req.params.key), /** @type {any} */ (req).rawBody, String(req.get('x-razorpay-signature') || ''));
  res.status(r.status).json(r.body);
});

// ---- Doctors only (clinic module): their own hours and appointment queue, never chats ----
const clinicRoutes = require('./clinicRoutes.cjs');
app.use('/api/doctor', apiAuthGuard, maintenance.gate, require('./clinic.cjs').requireDoctor, clinicRoutes.doctorRouter);

// ---- Platform admins only: the platform console (counts and settings, never chats) ----
app.use('/api/platform', apiAuthGuard, require('./platformRoutes.cjs'));

// ---- Staff only: the dashboard's crash reports (scrubbed, counts toward the event log) ----
app.post('/api/client-errors', apiAuthGuard, rateLimit({ name: 'client_errors', windowMs: 60000, max: 10 }), requireStaff, clientErrorRoute);

// ---- Staff only: dashboard API (closed while the platform is under maintenance) ----
app.use('/api', apiAuthGuard, maintenance.gate, requireStaff, apiRoutes, broadcastRoutes, automationRoutes, inboxRoutes, whatsappRoutes, queryRoutes, adsRoutes, require('./waCallRoutes.cjs'), require('./staffRoutes.cjs'), clinicRoutes.staffRouter);

// ---- Fallbacks -------------------------------------------------------------
app.use((req, res) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/webhook')) {
    return res.status(404).json({ error: 'Endpoint not found' });
  }
  for (const candidate of [path.join(ROOT, 'dist', 'index.html'), path.join(ROOT, 'public', 'index.html')]) {
    if (fs.existsSync(candidate)) return res.sendFile(candidate);
  }
  return res.status(404).send('Web interface not found. Run `npm run build` first.');
});

// ---- Errors: JSON, never a stack trace (must be last) ----------------------
app.use(errorHandler);

module.exports = app;
