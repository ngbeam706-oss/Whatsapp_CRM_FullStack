# WhatsApp CRM

A multi-business WhatsApp CRM built on Meta's **WhatsApp Business Platform (Cloud API)**. Each business connects
its own WhatsApp number and gets a shared team inbox, a pipeline, a bot with an optional AI assistant, broadcasts,
automatic follow-ups, query (ticket) tracking, analytics and Click-to-WhatsApp ad results. A Platform Admin runs
the platform: businesses, plans, limits and monitoring, but **never** sees any business's chats or customers.

It was built first for **Arogya Ruchulu** (a healthy-food business) and is now a platform for many businesses
(hospitals, food, shops, services).

- **Live:** https://monumental-semolina-e9f403.netlify.app (Netlify)
- **Stack:** React 19 + Vite + Tailwind 3 (TypeScript) · Express 5 (CommonJS, type-checked with JSDoc) ·
  Supabase (Postgres, Row Level Security, Auth, Realtime) · Netlify Functions
- **Status:** in production. See [Recent changes](#recent-changes) and [Known issues and roadmap](#known-issues-and-roadmap).

---

## Contents

- [Features](#features)
- [Roles](#roles)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Getting started (local)](#getting-started-local)
- [Environment variables](#environment-variables)
- [Database migrations](#database-migrations)
- [Connecting a business to Meta](#connecting-a-business-to-meta)
- [Security and privacy](#security-and-privacy)
- [Tests and quality checks](#tests-and-quality-checks)
- [Deploying to Netlify](#deploying-to-netlify)
- [Recent changes](#recent-changes)
- [Known issues and roadmap](#known-issues-and-roadmap)
- [More documentation](#more-documentation)

---

## Features

### For a business (the dashboard)

| Screen | What it does |
|---|---|
| **Inbox** | Shared team inbox for the business's number. Filters (All / Mine / Unassigned / Unread, stage, search), replies, approved templates, tags, private notes, "Suggest reply" (AI). WhatsApp's 24-hour rule is enforced: outside 24 hours only an approved template can be sent. Replying pauses the bot for that chat. |
| **Pipeline** | Board of contacts by stage: New enquiry → In discussion → Booked → Completed → Returning (and Closed). Drag cards; some moves happen automatically from what customers do in the bot. |
| **Queries** | Questions and complaints tracked until solved, with a number (Q-1001), priority, due time and stages. Customers raise them on WhatsApp ("QUERY", "COMPLAINT"), the AI raises one when it hands a chat over, staff raise them from a chat. Staff can also raise team queries to managers / the Business Admin, and anyone can contact Platform support. Numbers page and settings (due times, categories). |
| **Broadcasts** | **Campaigns:** send an approved template to a group (by lead source, tag, last chatted, or pasted numbers), test first, track sent / delivered / read / replied / failed per contact. **Templates:** create and submit templates to Meta. **Automations:** timed follow-ups after something a customer did (looked at an item, order enquiry, first message, quiet for N days), only inside the business's sending hours. Built-in "How this works" guides. |
| **Bot Flow** | Every business gets a basic flow: welcome message → *Our services* / *Talk to our team* / *Raise a query*; the services list (up to 9 items with optional price and details) → *Book / Enquire* → confirmation. Arogya Ruchulu keeps its own food bot editor (diet kits, RTE/RTC menus, "next step" after an item, guided tutorial). |
| **Keywords** | Keyword rules: when a customer types a word, the bot replies with text or buttons. |
| **AI** | Optional AI replies to typed messages, built only from the bot menu, keyword replies and the business's own information. Hands over complaints, refunds, medical questions and anything unknown to staff. Never makes health or cure claims or invents prices. Provider is chosen by the business: Anthropic Claude (default), OpenAI, Google Gemini or any OpenAI-compatible service; the key is stored encrypted. |
| **Analytics** | Last 7 / 30 / 90 days (India time): new leads by source, active chats, conversions, staff response times, busiest hours, pipeline, products, chats from ads, campaign and follow-up results. Every chart has a table view. |
| **Ads** | Connect the business's Meta ad account: spend per Click-to-WhatsApp ad next to the real chats and conversions each ad brought, cost per chat / per conversion, pause or resume ads, change daily budgets, cost alerts. Hourly sync. Plan-gated. |
| **Team** | The Business Admin invites staff by email, sets roles, removes access. |
| **WhatsApp** | Connect the business's own number (Phone number ID, WhatsApp Business Account ID, token, App secret) and its own webhook address. Step-by-step Meta guide with links, and the pros and cons of connecting a number. |
| **Setup** | Getting-started checklist, plan and usage, business name and follow-up sending hours. |
| **Voice calls** | Staff can send a customer a call link; the customer talks from the browser (WebRTC). See [Known issues](#known-issues-and-roadmap). |

### For the Platform Admin (platform console)

Businesses (create, suspend, change plan, paid-until date), plans and limits (Starter / Growth / Pro, editable;
per-business overrides), and monitoring: health and alerts, event log, background worker runs, delivery and
failures, audit log, support queries and a per-business detail view. **Counts, statuses and settings only:** the
console never shows a business's customers, chats, messages, notes or bot/AI content (enforced in the database,
not just the screen).

### Plans and limits

Each business is on a plan (Starter, Growth or Pro) with limits on team size, contacts, broadcast messages per
month, active follow-ups, AI replies per month, keyword rules and analytics history, plus switches for the AI and
Ads modules. Limits are enforced on the server. Incoming customer messages and staff replies are never blocked
by a limit. Payment is recorded manually (paid-until date); after a 7-day grace period an unpaid business is paused.

---

## Roles

| Role | Who | Can |
|---|---|---|
| **Platform Admin** | Runs the platform (separate login) | Businesses, plans, limits, monitoring, platform support. Never chat content. |
| **Business Admin** (`owner`) | One or more per business | Everything in their business: team, WhatsApp connection, AI provider, Ads connection, settings, all chats. |
| **Manager** | Business staff | Bot, broadcasts, automations, AI settings, analytics, ads, all chats and queries. |
| **Agent** | Business staff | Inbox, pipeline and queries for chats they own or that are unassigned. |

One login belongs to exactly one business. **Lead ownership:** an unassigned chat can be worked on by anyone (the
first action claims it, atomically); a chat assigned to someone else is view-only; the Business Admin can reassign.
Enforced on the server (`server/inbox.cjs`: `ensureCanAct`, `transferDenied`).

---

## Tech stack

| Part | Technology |
|---|---|
| Dashboard | React 19, Vite (Rolldown), Tailwind CSS 3, TypeScript (`.ts/.tsx`), TanStack Query for data loading, lucide-react icons. Two pages: the dashboard (`index.html`) and the customer call page (`call.html`). |
| API + webhook | Express 5, CommonJS `.cjs`. Runs as-is on Netlify (no build step); type-checked with JSDoc + `// @ts-check` (every server file), shared types in `server/types.cjs`. Request validation with zod. |
| Database / auth | Supabase: Postgres with Row Level Security, Auth (staff logins, invites), Realtime (call signalling). The server writes with the service key, which never reaches the browser. |
| Hosting | Netlify: static site + `api` function (the Express app) + `broadcast-worker` scheduled function (every 5 minutes). |
| Messaging | Meta Graph API (WhatsApp Cloud API, Marketing API for ads). |
| AI | Provider chosen per business (Claude default, OpenAI, Gemini, OpenAI-compatible), called from the server. |
| Tests | Node's test runner with PGlite (an in-process Postgres, no real database), Playwright in Microsoft Edge, oxlint, tsc. |

---

## Project structure

```
whatsapp-react/
├── index.html                 # Dashboard page (loads src/main.tsx)
├── call.html                  # Customer voice-call page (loads src/call/callPage.ts)
├── src/                       # Dashboard (React + TypeScript)
│   ├── main.tsx, App.tsx      # Entry and app shell (header, screens, calls)
│   ├── AuthGate.tsx           # Staff / platform-admin sign-in
│   ├── InboxScreen.tsx, PipelineScreen.tsx, QueriesScreen.tsx, BroadcastsScreen.tsx, AutomationsTab.tsx,
│   ├── BotFlowScreen.tsx, BotConfigScreen.tsx, AiAssistantScreen.tsx, AnalyticsScreen.tsx, AdsScreen.tsx,
│   ├── TeamScreen.tsx, WhatsAppScreen.tsx, SetupScreen.tsx       # One file per screen
│   ├── PlatformConsole.tsx, PlatformMonitor.tsx, PlatformSupport.tsx   # Platform console
│   ├── MetaSetupGuide.tsx, metaGuides.ts   # Step-by-step Meta guides (WhatsApp, Ads)
│   ├── call/                  # Customer call page script + styles
│   ├── types.ts, platformTypes.ts         # Shared data shapes
│   ├── apiClient.ts, broadcastUtils.ts    # apiFetch()/api(): /api calls with the login token; errorMessage()
│   ├── queryClient.ts         # useApi(): cached data, never refreshes while the tab is hidden
│   └── supabaseClient.ts, webrtcCallManager.ts
├── server/                    # API + webhook (Express, CommonJS, // @ts-check)
│   ├── app.cjs                # Routes: public webhook + call-ring, staff /api, platform /api/platform
│   ├── auth.cjs, tenant.cjs   # Staff check (req.staff), roles, business scoping
│   ├── webhook.cjs            # Meta webhook, X-Hub-Signature-256 check, per-business routing
│   ├── whatsapp.cjs, meta.cjs # Per-business WhatsApp connection; send text/buttons/lists/templates
│   ├── inbox.cjs, inboxRoutes.cjs         # Team inbox, 24h rule, lead ownership
│   ├── bot.cjs, botStore.cjs, defaults.cjs, queryBot.cjs   # Keyword bot, catalog, query raising on WhatsApp
│   ├── campaigns.cjs, templates.cjs, broadcastRoutes.cjs   # Broadcasts and templates
│   ├── automations.cjs, automationRoutes.cjs               # Timed follow-ups
│   ├── queries.cjs, queryRoutes.cjs       # Queries (customer, team, platform support)
│   ├── ai.cjs, llm.cjs, secrets.cjs       # AI assistant, providers, encryption of keys/tokens
│   ├── analytics.cjs, ads.cjs, adsRoutes.cjs              # Analytics, Ads module
│   ├── limits.cjs, business.cjs, team.cjs # Plans/usage/billing, business profile, team invites
│   ├── platform.cjs, monitor.cjs, events.cjs, platformRoutes.cjs   # Platform console + monitoring
│   ├── calls.cjs              # Signed call links; rings only the right business's dashboard
│   ├── security.cjs, validate.cjs         # Headers, rate limits, crash reports, errors; zod validation
│   └── config.cjs, db.cjs, state.cjs, types.cjs, express.d.ts
├── server.cjs                 # Local server entry (npm run server)
├── netlify/functions/
│   ├── api.cjs                # The same Express app on Netlify
│   └── broadcast-worker.cjs   # Every 5 min: broadcasts, follow-ups, billing, auto-close, ads sync, clean-up
├── supabase/migrations/       # SQL, run in order (all safe to re-run)
├── tests/                     # Unit + tenancy + security tests (npm test)
├── e2e/                       # Browser tests (npm run e2e), see e2e/README.md
├── docs/progress/             # Live status of each feature
├── netlify.toml               # Build, functions, worker schedule, security headers (CSP), redirects
└── .env.example               # Every environment variable, documented
```

---

## Getting started (local)

**You need:** Node.js 20 or newer (developed on Node 24), a Supabase project, and (to message real customers) a
Meta developer app with WhatsApp. Windows + PowerShell is the main development setup.

```bash
npm install
```

```bash
cp .env.example .env
```

Fill in `.env` (see [Environment variables](#environment-variables)), run the database migrations in your Supabase
project (see [Database migrations](#database-migrations)), then:

```bash
npm run server
```

```bash
npm run dev
```

- `npm run server`: API + webhook on http://localhost:3000
- `npm run dev`: dashboard on http://localhost:5173 (forwards `/api` and `/webhook` to port 3000); the call page is at `/call.html`

To receive real WhatsApp messages locally, expose port 3000 with a tunnel and use that address as the webhook in
Meta. For hand-written test webhooks only, `ALLOW_UNSIGNED_WEBHOOKS=true` (never in production).

**Note for Windows:** never rewrite source files with PowerShell `Get-Content`/`Set-Content`: Windows PowerShell
5.1 reads UTF-8 as ANSI and garbles ₹, emoji and Telugu. `tests/encoding.test.cjs` catches it.

---

## Environment variables

Set them in `.env` locally and in **Netlify → Site configuration → Environment variables** in production.
`.env.example` documents the app's variables (the test-only `E2E_*` ones are in `e2e/README.md`). Never put real
values in code or in deploy zips.

| Variable | Needed | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | Yes | Supabase project URL (public). |
| `VITE_SUPABASE_ANON_KEY` | Yes | Supabase publishable / anon key (public by design). |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase secret key. **Server only**, bypasses RLS; never in the browser. |
| `APP_SECRET` | Yes | Meta App secret for the environment's number (webhook signatures). Also the default encryption secret. |
| `SETTINGS_ENCRYPTION_KEY` | Recommended | Secret used to encrypt saved tokens and AI keys and to sign call links (falls back to `APP_SECRET`). If it changes, saved tokens must be pasted again. |
| `PUBLIC_SITE_URL` | Yes | The dashboard address, used in links sent to customers. |
| `VERIFY_TOKEN` | For the env number | Webhook verify token for the legacy `/webhook` address. |
| `WHATSAPP_TOKEN`, `PHONE_NUMBER`, `PHONE_NUMBER_ID`, `WABA_ID` | Optional | The first business's number set in the environment. New businesses save their own details on the WhatsApp page instead. |
| `GRAPH_API_VERSION` | Optional | Meta Graph API version (default in `server/config.cjs`). |
| `ALLOWED_ORIGINS` | Optional | Extra origins allowed to call the API (comma-separated). Default: same origin only. |
| `ALLOW_UNSIGNED_WEBHOOKS` | Local tests only | Accept unsigned webhooks. **Never in production.** |
| `ALLOW_PRIVATE_AI_URL` | Local only | Allow an `http://` / private-network AI base URL. |
| `PORT` | Optional | Local server port (default 3000). |
| `E2E_EMAIL`, `E2E_PASSWORD`, `E2E_BASE_URL` | Tests only | A **test** login for the signed-in browser tests, and an address to test against. See `e2e/README.md`. |

---

## Database migrations

Run the files in `supabase/migrations/` **in this order** in the Supabase SQL editor. Every file is safe to re-run.
Back up before each `m1`/`m2` migration.

| File | Adds |
|---|---|
| `20261106_phase1_lockdown.sql` | Staff-only access (`staff_members`, `is_staff()`), Row Level Security |
| `20261106_phase2_broadcasts.sql` | Campaigns, recipients, opt-out |
| `20261106_phase3_automations.sql` | Automations, runs, contact events |
| `20261106_phase4_inbox_crm.sql` | Inbox, stages, notes, ownership |
| `20261106_phase5b6_analytics_ai.sql`, `20261106_phase6b_ai_provider.sql` | Analytics fields, AI settings, AI provider (encrypted key) |
| `20261107_m1_multi_business.sql` | Businesses, `business_id` on every table, plans, platform admins |
| `20261108_m2a_before_deploy.sql`, `20261108_m2b_after_deploy.sql` | Per-business server access and RLS (run `m2a`, deploy, then `m2b`) |
| `20261109_m3_whatsapp_per_business.sql` | Each business's own WhatsApp connection (encrypted) |
| `20261110_pipeline_stages_all_businesses.sql` | Stage labels for every kind of business (adds "Completed") |
| `20261111_q1_queries.sql` | Queries, events, categories, platform support |
| `20261112_ads_a_lead_source.sql`, `20261113_ads_b_accounts_insights.sql`, `20261114_ads_c_controls.sql` | Ads: lead source per ad, ad account + daily insights, alerts and controls |
| `20261115_admin_console.sql` | System events, worker runs, business health (server-only) |

The tests load the same files into PGlite (`tests/helpers/pgHarness.cjs`), so a migration that doesn't run fails `npm test`.

---

## Connecting a business to Meta

Each business connects its own number and (optionally) its own ad account. Both pages in the dashboard have a
**step-by-step guide** with direct links to the right Meta screens, a table of where each value is found, and the
pros and cons:

- **WhatsApp page** (Business Admin): Phone number ID, WhatsApp Business Account ID, a permanent system-user access
  token, the App secret, and this business's own Callback URL + Verify token to paste into Meta.
- **Ads page** (Business Admin connects; managers view): ad account ID and a system-user token with `ads_read`
  (plus `ads_management` to pause ads and change budgets).

Tokens and secrets are checked with Meta, stored encrypted, and never shown again.

---

## Security and privacy

- **Tenancy:** every table and query is scoped by `business_id`; staff only ever see their own business. Tested
  route by route (`tests/m2Routes.test.cjs`, `tests/m1Tenancy.test.cjs`).
- **Platform Admin never sees chat content** (messages, contacts, notes, bot/AI content): enforced in RLS.
- **Webhooks:** every POST must carry Meta's `X-Hub-Signature-256` made with the business's App secret, or it is
  rejected (401). Each business has its own webhook address; messages for another number are ignored.
- **Secrets:** the Supabase service key, WhatsApp tokens, App secrets and AI keys stay on the server. Saved tokens
  and keys are encrypted (AES-256-GCM).
- **Browser:** security headers on every page, and an **enforced Content Security Policy** (`netlify.toml`): only
  this site's own scripts run, and the browser may only talk to this site and Supabase.
- **API:** per-address rate limits, a sign-in failure guard, zod validation of request bodies, JSON errors without
  stack traces, crash reports scrubbed of personal data.
- **Calls:** call links are signed by the server, use random rooms and contain no phone number; opening one rings
  only that business's dashboard, on a private channel name only its staff receive (`server/calls.cjs`).
- **Customer rules:** WhatsApp's 24-hour rule, STOP/START opt-out, follow-ups only inside the business's sending
  hours (default 9am–8pm India time), and AI/bot text that never makes health or cure claims or invents prices.

---

## Tests and quality checks

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm run build
```

```bash
npm run e2e
```

| Check | Covers |
|---|---|
| `npm test` | ~250 tests on PGlite (no real database): tenancy, ownership, security, limits, queries, ads, AI, calls, migrations, file encoding. |
| `npm run typecheck` | `tsc` on the dashboard (`src/`) and on every server file. Must be clean. |
| `npm run lint` | oxlint (0 errors required). |
| `npm run e2e` | Playwright in Microsoft Edge against a local build (or `E2E_BASE_URL`): signed-out checks, every dashboard and platform-console screen with a fake backend, the Content Security Policy enforced on both pages, the Meta guides, and "nothing refreshes while the tab is hidden". Signed-in checks against a real backend need a test login (see `e2e/README.md`). |

Every security, tenancy or ownership change gets a test.

---

## Deploying to Netlify

- Site: `monumental-semolina-e9f403` (team `itzvijay406`, Free plan, since 2026-11-12). Production visibility must be
  **Public** (otherwise Meta's webhooks get 401). New teams protect new sites with "Netlify login" for all deploys:
  switch that off for production (Project configuration -> General -> Visitor access).
- Moving to another account: `netlify logout`, `netlify login`, `netlify unlink`,
  `netlify sites:create --name monumental-semolina-e9f403 --account-slug <team>` (the name is free once the old site
  is deleted), set the environment variables (`netlify env:set`), then deploy.
- Deploy with the Netlify CLI from this folder: `netlify deploy --prod --build`. Never drag-and-drop a zip that
  contains `.env`.
- **Save Netlify credits:** deploy once per finished phase (not per fix), the background worker runs every 5
  minutes (`netlify.toml`), and the dashboard only refreshes while the tab is visible. Never add every-minute
  schedules or fast polling.
- Run any new SQL migration in Supabase **before** deploying code that needs it.
- After a deploy: the site returns 200, `/api/health` returns 200, `/api/inbox` returns 401 without a login,
  a forged webhook gets 401, and `E2E_BASE_URL=<live address> npx playwright test` passes.

---

## Recent changes

**November 2026**

- **Not deployed yet (local, all checks pass):**
  - **Customer call page rebuilt:** now a second Vite page in TypeScript (`call.html`, `src/call/`), no CDN or
    inline scripts, shows the calling business's own name instead of one brand.
  - **Content Security Policy enforced** on the whole site (was report-only), with browser tests that load both
    pages under the policy.
  - **Incoming-call alerts per business:** before, every business's dashboard received every business's
    incoming-call pop-up. Now call links are signed by the server and ring only the right business
    (`server/calls.cjs`, `tests/calls.test.cjs`).
  - **Meta setup guides** on the WhatsApp and Ads pages: where to find each ID and token in Meta, with links, and
    the pros and cons of connecting a number or an ad account.
- **Live:**
  - **TypeScript migration complete:** every dashboard file is `.ts/.tsx`; every server file is type-checked.
    Found and fixed several small bugs along the way (unsafe save results, unchecked errors, "Invalid Date").
  - **Production hardening:** error boundaries per screen, screens load on demand, security headers, rate
    limits, a sign-in failure guard, JSON error handling, zod request validation, Playwright browser tests,
    shared data cache (TanStack Query) that never refreshes while the tab is hidden, `/api/send` now follows the
    inbox's ownership and 24-hour rules.
  - **Platform console monitoring:** health and alerts, event log, worker runs, delivery and failures, audit log,
    per-business detail.
  - **Ads module (phases A–C):** lead source per Click-to-WhatsApp ad, ad account connection with hourly results
    sync, cost per chat / conversion, pause/resume and budget controls, cost alerts.
  - **Queries (Q1–Q4)**, **pipeline stages for every kind of business**, and **plans, limits and payments (M5)**.

Detailed history: `docs/progress/` (one file per feature).

---

## Known issues and roadmap

- **Voice calls probably don't connect** (P3, calls are not a priority for now). Each side sends its WebRTC offer
  only once, before the other side has joined. Fix planned (a short "ready" handshake + a two-page browser
  test); never tested with two real devices. See `Pending Implementation List.md`.
- **Second business end to end (M6):** a test business exists; its WhatsApp details are not saved yet.
- **Database work deferred by choice:** a job queue for webhook replies and broadcasts, and daily analytics
  summary tables; Supabase Realtime private channels (with RLS) for calls.
- **Housekeeping:** rotate the WhatsApp token, reword health claims in the bot menu, custom SMTP for Supabase
  emails, Meta business verification. Full list with priorities: `Pending Implementation List.md`.

---

## More documentation

| File | What |
|---|---|
| `CLAUDE.md` | Working rules for this codebase (tenancy, security, deploy, encoding). |
| `docs/progress/README.md` | Status of every feature, with one progress file each. |
| `Pending Implementation List.md` | Backlog with priorities (P1/P2/P3) and open housekeeping. |
| `e2e/README.md` | How to run the browser tests and set up a test login. |
| `.env.example` | Every environment variable, documented. |
