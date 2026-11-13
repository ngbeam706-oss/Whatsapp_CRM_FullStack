# Admin console: monitoring, logs and alerts

**Status:** LIVE 2026-11-09 11:33 IST (deploy 6af1620ad21bbaf19a12970f, together with the hardening work); browser check with a real platform-admin login still to do
**Last updated:** 2026-11-09

## Goal
Give the Platform Admin production-level tools to spot and solve problems across all businesses:
health, alerts, an error/event log, worker runs, delivery failures, audit log and a per-business
detail page. Counts, statuses, error codes and short scrubbed error text only. Never chat content.

## Done
- [x] Migration `supabase/migrations/20261115_admin_console.sql`: `system_events`, `worker_runs`,
      `business_health`. All server-only (RLS on, no policies, browser grants revoked). Safe to re-run.
- [x] `server/events.cjs`: `logEvent` (validated level/source, throttled to 1 per minute per
      source+code+business with a `count`), `scrub` (removes phone numbers, emails, tokens, keys),
      `touchWebhook`, `signatureFailed`, `recordWorkerRun`, `prune` (events 30 days, runs 14 days).
- [x] Events written from: webhook (resolve failure, no App secret, bad signature, bot error, handler
      error), Meta sends (`meta.cjs` postMessage: `send_<code>`, `token_invalid` = critical), AI provider
      errors (`ai.cjs` callModel), ads sync failures (`ads.cjs` markFailed), auth lookup failures and
      denied platform-console attempts, billing auto-suspend (`limits.cjs`), worker step failures.
- [x] Worker (`netlify/functions/broadcast-worker.cjs`): each run recorded in `worker_runs` (steps with
      counts only, ms, errors scrubbed). Hourly `prune` step added. `runWorker({ tasks })` for tests.
- [x] `server/monitor.cjs` + routes in `server/platformRoutes.cjs` (platform admin only):
      `GET /health` (health + alerts), `GET /events`, `GET /worker-runs`, `GET /delivery`, `GET /audit`,
      `GET /businesses/:id`, `POST /businesses/:id/check-whatsapp` (quality rating + messaging tier from
      Meta, once a minute per business).
- [x] `platform.updateBusiness` accepts `limitOverrides` (validated, audited).
- [x] UI: `src/PlatformMonitor.jsx` (Health, Logs, Worker, Delivery, Audit tabs, alerts banner on every
      tab, business detail drawer with plan/billing/usage/overrides/connections/recent events/changes),
      wired into `src/PlatformConsole.jsx` (Health is now the first tab; "Details" on each business).
      Health refreshes every 60 s only while its tab is open and visible (`REFRESH.platformHealth`).
- [x] Tests: `tests/adminConsole.test.cjs` (12 tests): every new route 401/403/200, no chat/phone/secret
      in any response, chat tables only counted, alerts, scrub, throttle, filters, webhook logging, Meta
      token failure, WhatsApp check, worker run recording, audit filters, overrides, RLS on PGlite.
      Full suite 213/213, lint exit 0 (warnings only), build OK.

- [x] Live (deployed by the "Feature usage and application integration" session, 2026-11-09 11:33 IST,
      deploy id 6af1620ad21bbaf19a12970f). Before deploying, a read-only check confirmed
      `20261115_admin_console.sql` is on the live database (system_events, worker_runs and business_health
      all answer 200). Live checks: `/api/platform/health` returns 401 without a login; a forged webhook
      returns 401. The new worker ran at 11:35 IST in 2808 ms with 0 errors and recorded itself in worker_runs.

- [x] **Maintenance mode (2026-11-10, DEPLOYED 6af2f234; SQL `20261117_platform_settings.sql` run; tested locally by the user).**
  Console tab **Maintenance**: switch on/off with a message for staff and an optional "expected back by"
  (max 14 days ahead); amber strip on every other tab while on. `server/maintenance.cjs`: one row in
  `platform_settings` (server-only), cached 15 s per instance (cleared at once on the instance that
  switched); audit_log `platform.maintenance_on/off` (business_id null) + system_events. While ON:
  staff API (`/api/*` after the platform routes) answers 503 `{ maintenance, error, until }` + Retry-After;
  public `GET /api/maintenance` (no login); dashboards show `MaintenanceScreen` (from /api/status or any
  request via `apiClient` -> `app-maintenance` event), check every minute while visible and reload when off.
  Still running: Meta webhook + bot replies (messages are never lost), `/api/health`, `/api/call-ring`, the
  console. Worker holds follow-ups, inactive scan, campaigns and ads sync (records `maintenance: on`).
  If the setting can't be read (table missing, DB error) maintenance counts as OFF (never locks everyone out).
  Tests: `tests/maintenance.test.cjs` (8) + 2 e2e (staff screen comes back; console switch on/off).

## Next
- [ ] Open the live console with a real platform-admin login: Health tab, alerts, Logs/Worker/Delivery/Audit,
      a business's Details panel, "Check WhatsApp now" on each business.
- [ ] Optional: move `PlatformMonitor.jsx` polling from `useVisiblePolling` to TanStack Query
      (`src/queryClient.js`), like the business dashboard now uses.
- [ ] Possible: a "Team" list (staff email, role, joined, last sign-in) in the business Details panel.
      Today it only shows counts per role. Asked the user; not started.
- [ ] Optional later: email/WhatsApp notification to the platform admin on critical alerts (needs a
      sender; would add cost); live AI key test from the console (costs AI credit, so left out).

## Decisions and gotchas
- New tables are server-only, not "platform admin may select" RLS: the browser never reads them, and
  the server scrubs before writing, so there is one place to enforce "no chat content".
- AI "reachability" = errors seen in real replies over 24 h; no test calls (they cost the business credit).
- WhatsApp quality/tier is fetched on demand ("Check WhatsApp now"), not on every health load, to avoid
  Graph API calls on each refresh.
- Last-webhook time is written at most once a minute per business per function instance.
- Alerts are computed on request (no scheduled job): worker stale >= 15 min, token unreadable/rejected,
  quality RED/YELLOW, no App secret, >= 5 bad signatures/hour, ads sync error, AI key unreadable or
  >= 5 errors/24 h, payment due/overdue, at/over plan limits, unsigned webhooks on, no APP_SECRET.
- Editing with PowerShell `Get-Content`/`Set-Content` corrupts UTF-8 (emoji in webhook.cjs). Use the
  Edit tool, or .NET with explicit UTF-8.

## Setup / deploy notes
- `supabase/migrations/20261115_admin_console.sql` is on the live database (safe to re-run). No new env vars.
- Shipped in the same deploy (other session's work): `server/security.cjs` (rate limits, sign-in failure
  guard: auth.cjs / platform.cjs set `res.locals.authFailed`), `server/validate.cjs` (zod checks on route
  params and bodies, including platformRoutes.cjs), business dashboard on TanStack Query.
- No new schedules: the worker stays at every 5 minutes.
