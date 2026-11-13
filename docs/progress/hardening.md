# Production hardening (frontend + backend, no database changes)

**Status:** Round 1 + round 2 (validation, e2e, TanStack Query) **LIVE** since 2026-11-09 (deploy
`6af1620ad21bbaf19a12970f`, shipped together with the admin console). TypeScript not started.
**Last updated:** 2026-11-09

## Goal
Close the production gaps in the frontend and backend stack without changing the database. The user asked
to do database-side work (job queue, direct Postgres, summary tables) later, after these gaps are closed.

## Done (round 1)
- [x] **Error boundaries** (`src/ErrorBoundary.jsx`): one around every screen in `src/App.jsx` (reset on tab
      change) and one around the whole app in `src/main.jsx`. A crash shows "Something went wrong /
      Try again / Reload" instead of a blank page.
- [x] **Crash reports**: the boundary posts `{screen, name, first line of message}` to `POST /api/client-errors`
      (staff only, 10/min per address); saved as a `system` event `frontend_crash_<screen>` (warn), scrubbed by
      `events.logEvent` (no numbers, emails, tokens), so it shows in the Platform console's event log.
      Uses the existing `system` source, so no SQL is needed.
- [x] **Screens load on demand**: every screen except the Inbox is `lazy()` + `Suspense`. After a deploy,
      a stale tab that can't find old screen files reloads once by itself (guarded against loops).
- [x] **Library files split** (`vite.config.js` `codeSplitting`): react / supabase / icons in their own
      files. App code went from 558 kB to 121 kB (31 kB compressed); first load is about 171 kB compressed;
      the size warning is gone. Libraries stay cached across deploys.
- [x] **API security headers** (`server/security.cjs` `securityHeaders`): nosniff, X-Frame-Options DENY,
      Referrer-Policy, COOP, Permissions-Policy (microphone allowed for inbox calls), HSTS on https,
      `Cache-Control: no-store` on `/api/*`.
- [x] **Page headers** (`netlify.toml` `[[headers]]`): same headers for the dashboard files, plus a
      **report-only** Content Security Policy and one-year caching for hashed `/assets/*` files.
- [x] **Rate limits** (in memory, per server instance, no packages):
      `/api` 600 requests/min per address (about 40 staff behind one office address at today's polling);
      sign-in failure guard: 30 refused logins/min per address -> 429 before any Supabase lookup.
      Only real login refusals count (`res.locals.authFailed` in `auth.cjs` / `platform.cjs`, plus 401s);
      a role refusal (agent on a manager page) never counts. Meta's webhook is NOT rate limited.
- [x] **JSON error handler** (`errorHandler`): broken JSON 400, too large 413, anything else a generic 500.
      Never a stack trace. Logged as `system/unhandled_error` (scrubbed).
- [x] Tests `tests/hardening.test.cjs` (10). Full suite 223/223, build OK, lint clean for changed files.
      Production build checked in the browser: sign-in page renders, no console errors, only the vendor
      files and app code load.

## Done (round 2, part 1: 2026-11-09)
- [x] **Fixed `POST /api/send`** (the call-link send in `src/App.jsx`). It skipped the Inbox rules: an agent
      could send to a chat owned by someone else, to any number (creating a contact past the plan limit),
      and it **renamed the contact to "+<number>"** every time. Now it calls `inbox.sendText` (contact must
      exist, ownership, 24-hour window, logged to the chat). The unused button/list modes are removed.
      Test in `tests/hardening.test.cjs`.
- [x] **Request validation** (`server/validate.cjs`, zod 4): `validate({ params, body })` middleware.
      Every POST/PUT/PATCH body under `/api` must be a JSON object (`requireObjectBody` in `app.cjs`).
      URL params checked on all routes with ids: phone, uuid ids, numeric note/run ids, template names,
      ad/ad set ids, plan ids. Body schemas on inbox, AI, team, queries, platform support, ads,
      WhatsApp connection and the call-link send. Schemas are LOOSE (known fields type/size-checked,
      unknown fields passed through unchanged) so no screen breaks; services keep their own rules.
      Role checks run first, so a refused role always gets 403. Template, campaign, automation, bot and
      business-profile bodies are left to their services (nested; already checked in detail).
      Tests `tests/validation.test.cjs` (8). `adsC` test updated for the earlier id refusal.
- [x] **Playwright smoke tests** (`e2e/smoke.spec.js`, `playwright.config.js`, `npm run e2e`): uses the Edge
      that ships with Windows (no browser download). Starts the API + production build itself. Signed-out
      tests (sign-in page clean, API 401 + headers) pass. Signed-in tests (every tab opens without a crash,
      inbox opens a chat) need `E2E_EMAIL`/`E2E_PASSWORD` of a TEST login in `.env`; the sending test
      also needs `E2E_SEND_TO` and sends a real WhatsApp message. `data-testid` hooks added to the inbox
      (chat-row, chat-header, chat-composer). See `e2e/README.md`.
- [x] `npm audit --omit=dev`: 0 vulnerabilities in production dependencies (the install warnings are in
      dev-only tools).
- Full suite 233/233, build OK, lint clean for changed files.

## Done (round 2, part 2: TanStack Query, 2026-11-09)
- [x] `@tanstack/react-query` 5 + `src/queryClient.js`: one shared cache. `useApi(path, { refetchInterval,
      keepPrevious, staleTime, enabled })`, `refreshApi(prefix)` after saves, `setApiData` for optimistic
      updates, `errorOf`. Defaults: 15 s fresh, retry twice on network/5xx only (never 4xx), never retry
      sends/saves, **no refresh while the tab is hidden**, one refresh on return (same rule as before).
      `api()` errors now carry `.status`. Cache cleared when the signed-in user changes (`main.jsx`).
- [x] Converted: **Inbox** (list with debounced search + open chat), **Pipeline** (optimistic move now
      in the cache), **Queries** list + Numbers, **Analytics** (1-minute cache, keeps old data while the range
      changes), **Ads** (1-minute cache), **Team**. `/api/team` is one shared request for Inbox, Pipeline, Team.
- [x] Library split: `query-vendor` file; app code stays 122 kB (32 kB compressed).
- [x] Browser tests with a fake backend (`e2e/mocked.spec.js`, no login needed, run in Edge): all converted
      screens render signed in; team list fetched once across three screens; the inbox refreshes every 15 s
      while visible, makes **zero** requests in 10 minutes hidden, and refreshes once on return.
- [x] 233/233 unit tests, 5 e2e pass (3 skipped until a test login is set), build OK.

## Done (round 2, part 3: the rest of the dashboard on TanStack Query, 2026-11-09)
- [x] **Broadcasts**: account, templates, campaign list + detail (refresh every 20 s only while a campaign is
      sending, as before), audience options. **Automations**: list + detail.
- [x] **AI page + header AI switch**: both read one cached `/api/ai/settings`, so the old window-event sync is
      gone. Saving the provider no longer throws away unsaved knowledge edits.
- [x] **WhatsApp page, Setup page**: forms show saved values until someone edits ("edits" state); a background
      refresh never overwrites typing. Setup's usage card shares the header plan banner's request.
- [x] **Contact queries panel, query detail, raise-query form**: categories and team list from the shared
      cache; raising a query refreshes the open Queries lists.
- [x] **App shell**: business name/number (`/api/status`, 5-minute cache), "account paused" from its 403, and
      the plan banner from the shared usage request. A profile save updates the header at once.
- [x] Left as is on purpose: the bot rules and menus in `App.jsx` are the Keywords/Bot Flow editors' working
      copy (edited, then saved); they load once per visit and must not be refreshed under the editor.
      Platform console files (`PlatformMonitor.jsx`, `PlatformSupport.jsx`) still use `useVisiblePolling`:
      that is the admin-console session's area.
- [x] `e2e/mocked.spec.js` now also covers: Broadcasts (3 tabs), Automations, AI, WhatsApp (form filled from
      cache), Setup, plan banner, inbox query panel, raise-query form, and **typing survives a background
      refresh**. 5 mocked + 2 signed-out e2e pass; 233/233 unit tests; build OK (app code 117 kB).

## Done (TypeScript round 2, 2026-11-09, not deployed)
- [x] `src/queryUtils.ts` (QueryStage, Priority, Query, QueryEvent types), `src/TeamScreen.tsx`,
      `src/PipelineScreen.tsx` (typed props, typed `/api/team` and `/api/pipeline` answers). `types.ts` gained
      `TeamResponse`, `ShowToast`.
- [x] Server `// @ts-check`: `inbox.cjs`, `auth.cjs`, `limits.cjs`. Shared typedefs in `server/types.cjs`:
      `DbResult`, `Lead`, `MetaSendResult`. JSDoc on `db.dbRequest` (its options were inferred as `{method}`
      only, so every `prefer`/`body` call looked wrong) and `meta.sendTextMessage/sendTemplateMessage`.
- [x] Ownership is now type-enforced: `ensureCanAct` returns `ActResult` (refused with status, or allowed
      with the lead); callers use `if (access.error !== undefined) return access;` and TypeScript then proves
      the lead exists. `limits.check` returns `CheckResult` the same way. Limit names and metric names are
      checked (a typo like `max_contact` fails the type check).
- [x] Small fixes the types found: Team "Added" showed "Invalid Date" with no creation date (now "–");
      the Pipeline "bot paused" tooltip sat on the icon (now on a wrapper, so it shows); `usageReport`
      guarded a `find()` that could in theory be empty; unused `config` import in `inbox.cjs` removed.
- [x] Typecheck clean, 233/233 unit tests, 7 e2e pass, build OK.

## Done (TypeScript round 3, 2026-11-09, not deployed)
- [x] Frontend to `.tsx`: `ContactQueries`, `QueryDetail`, `InboxScreen` (733 lines: list, conversation,
      message bubbles, details panel, template and new-chat dialogs all typed), `BroadcastUi` (shared
      TemplatePreview / VariableInput, so Broadcasts get typed props too). `types.ts` gained InboxContact,
      ChatMessage, ContactNote, Conversation, ContactPatch, VariableSpec; `queryUtils.ts` gained the full
      Query / QueryEvent / QueryDetailResponse shapes.
- [x] Server `// @ts-check`: `whatsapp.cjs` (WhatsAppConn typedef; `checkWithMeta` and `validateInput` return
      typed "error or value" results), `campaigns.cjs` (Segment / Recipient / CampaignInput; batch sender typed),
      `queries.cjs` (717 lines, 203 errors -> 0).
- [x] Real fix found by the types in `queries.cjs`: after a database save, several paths used the result
      straight away (`decorate(moved)`, `q.id`). If the save failed, that crashed the request with a 500 and
      no message. Each path now returns `{ error: 'Could not save the query. Try again.', status: 500 }`.
      Test `tests/queriesSave.test.cjs` (fails on the old code).
- [x] Small UI fixes from the types: Inbox and query-panel icon tooltips moved to a wrapper so they show;
      query dates guarded when missing.
- [x] Incident + guard: adding `// @ts-check` with PowerShell `Get-Content`/`Set-Content` garbled the two 📣
      emoji in `campaigns.cjs` and added BOMs (Windows PowerShell 5.1 reads UTF-8 as ANSI). Reversed exactly
      (code page 1252 round trip, verified); new `tests/encoding.test.cjs` fails on garbled text or a BOM
      anywhere in the source (proved with a probe file); CLAUDE.md warns against it.
- [x] Unused `config` imports removed from `inbox.cjs`, `campaigns.cjs`.
- [x] Typecheck clean, 236/236 unit tests, 7 e2e pass, build OK.

## Done (TypeScript round 4, 2026-11-09, not deployed)
- [x] `server/express.d.ts`: Express's `req` now knows `staff`, `platformAdmin`, `rawBody`, `wa`, `webhook`
      (with the exact webhook shape: businessId, phoneNumberId, appSecrets[], verifyTokens[]). `tsconfig.server.json`
      includes `server/**/*.d.ts`. `@types/cors` added (dev only).
- [x] Every route file is `// @ts-check`: `app`, `routes`, `inboxRoutes`, `queryRoutes`, `broadcastRoutes`,
      `automationRoutes`, `adsRoutes`, `platformRoutes`, `whatsappRoutes`; plus `templates.cjs` fully typed.
      Route params are passed as `String(req.params.x)`; every `reply` helper uses the shared `Reply` type.
- [x] Core modules `// @ts-check`: `config`, `db`, `secrets`, `state`, `meta`, `team`, `business`, `llm`, `webhook`.
      `llm.complete` returns a typed `{ text } | { refusal } | { error }`; `team` checks roles with a type guard.
- [x] Behaviour unchanged: only types, `err instanceof Error` for error texts, and in `webhook.cjs` a small
      `present()` helper in place of `.filter(Boolean)` (same result: drops empty/null secrets and tokens).
- [x] Typecheck clean, 236/236 unit tests, 7 e2e pass (3 skipped: need a test login), lint 0 errors, build OK.
- Still unchecked on the server: `ads`, `ai`, `analytics`, `automations`, `bot`, `botStore`, `defaults`,
  `events`, `monitor`, `platform`, `queryBot`. Two lint warnings there wait for round 5
  (`automations.cjs` unused `config`, `bot.cjs` unused `buttonTitle`).

## Done (TypeScript round 5, 2026-11-09, not deployed): the whole server is type-checked
- [x] The last 11 server files are `// @ts-check` (about 580 errors -> 0): `events`, `defaults`, `botStore`,
      `queryBot`, `automations`, `ai`, `analytics`, `platform`, `monitor`, `bot`, `ads`. Every file in
      `server/` now starts with `// @ts-check`.
- [x] Shared typedefs added to `server/types.cjs`: `BotRule`, `Catalog`. `ai.cjs` decisions are a typed
      `{ reply } | { handover, reason } | { skip, reason }`; `ads.cjs` control results (`controlContext`,
      `ownedObject`, `budgetTarget`) are typed "error or value" unions.
- [x] Small hardening found by the types (no visible behaviour change in normal use):
      - `bot.cjs`: catalog lists go through `items()`, so a malformed list in a saved catalog no longer crashes
        the bot reply (it is treated as empty).
      - `monitor.cjs`: the over-limit alert checks the plan limit isn't "unlimited" before comparing.
      - `automations.cjs`: a run whose business checks are missing is cancelled instead of crashing the batch.
      - `queries.cjs` `decorate()` now keeps its row type, so `query.id` / `query.ref` are known to callers.
      - `team.inviteStaff` only needs `{ businessId }`; the platform no longer passes a fake staff object.
- [x] Lint: the two server warnings are gone (unused `config` import, unused `buttonTitle`).
- [x] Every server module and both Netlify functions load (`node -e require(...)`).
- [x] Typecheck clean, 236/236 unit tests, 7 e2e pass (3 skipped: need a test login), lint 0 errors, build OK.

## Done (TypeScript round 6, 2026-11-09, not deployed): Broadcasts, Automations, Ads, Analytics
- [x] To `.tsx` (renamed with `Move-Item`, so the bytes and the ₹/emoji text are untouched, then typed with
      the editor): `BroadcastsScreen`, `AutomationsTab`, `AdsScreen`, `AnalyticsScreen` (~1,950 lines,
      ~340 errors -> 0). Each now types its own API answers (campaigns, recipients, audience preview,
      automations + runs, ad account + report + budget, the analytics report).
- [x] Shared helpers: `errorMessage(err)` in `broadcastUtils.ts` (text for anything a `catch` got);
      `pct()` treats a missing count as 0 (before, a missing value gave `NaN%` widths in the stats bar);
      `Template` gained `id` and `rejected_reason`.
- [x] Small fixes from the types: Ads page called `load(days)` on a function that takes no arguments
      (harmless, removed); the budget dialog's save waits for the budget to load; deleting an automation
      waits for its data; the Broadcasts tab list is a typed constant.
- [x] Typecheck clean, 236/236 unit tests, 7 e2e pass (the mocked tests open all four screens), lint 0 errors, build OK.
- Still `.jsx`: App, BotFlowScreen, StepBuilderTab, BotConfigScreen, PlatformMonitor, PlatformConsole,
  PlatformSupport, QueriesScreen, AiAssistantScreen, WhatsAppScreen, SetupScreen, AuthGate, CallModal,
  BroadcastGuide, DbSyncModal, BotFlowTutorialModal, RaiseQueryModal, AiModeToggle, ErrorBoundary,
  WebhookSetupModal, main; and `.js`: supabaseClient, webrtcCallManager, flowPresets.

## Done (TypeScript round 7, 2026-11-09, not deployed): 8 more screens
- [x] To `.tsx` (same rename-then-type method): `ErrorBoundary` (typed props/state; a thrown value that is
      not an Error is handled), `AiModeToggle` (exports the shared `AiSettingsResponse` / `AiProviderStatus`),
      `WebhookSetupModal`, `RaiseQueryModal`, `WhatsAppScreen`, `SetupScreen` (exports `Usage`, `UsageCard`,
      `BusinessProfile`), `AiAssistantScreen`, `QueriesScreen` (~1,300 lines, ~195 errors -> 0).
- [x] `queryUtils.ts` gained `QuerySettings` / `QueryCategoryRow` (GET /api/queries/settings), now used by the
      Raise-a-query form, the Queries settings and (typed) stats.
- [x] Small fixes from the types: the AI and Setup forms can't build an edit from settings that haven't
      loaded; the Queries settings page waits for the due hours too; a query with no source, addressee or
      creation time shows blank instead of "undefined"; WhatsApp test results are a typed "error or result".
- [x] Typecheck clean, 236/236 unit tests, 7 e2e pass, lint 0 errors, build OK.
- Still `.jsx`/`.js`: App, main, AuthGate, CallModal, BroadcastGuide, DbSyncModal, BotFlowTutorialModal,
  BotFlowScreen, StepBuilderTab, BotConfigScreen, PlatformConsole, PlatformMonitor, PlatformSupport;
  supabaseClient, webrtcCallManager, flowPresets.

## Done (TypeScript round 8, 2026-11-09, not deployed): helpers, sign-in and pop-ups
- [x] To `.ts`: `supabaseClient`, `flowPresets`, `webrtcCallManager` (typed call session: signals between the
      two browsers are a typed union; the Realtime channel, peer connection and recorder are typed).
- [x] To `.tsx`: `AuthGate` (exports `SignedIn`: session, staff row, platformAdmin, signOut), `BroadcastGuide`,
      `DbSyncModal`, `BotFlowTutorialModal`, `CallModal` (exports `CallState`, `CallerInfo`).
- [x] Removed 7 unused functions from `supabaseClient` (single-business leftovers that read/wrote leads, bot
      rules and the catalog straight from the browser; nothing imported them). Kept `saveCallRecording`.
      Its chat-log insert gets `business_id` from the column default `current_business_id()` (migration
      20261108), so it stays within the signed-in business.
- [x] `main.jsx` imports without file extensions (it still named `./ErrorBoundary.jsx`, renamed in round 7).
- [x] Removed unused icon imports in `CallModal`.
- [x] Typecheck clean, 236/236 unit tests, 7 e2e pass, lint 0 errors, build OK.
- Still `.jsx`: App, main, BotFlowScreen (1,034 lines), StepBuilderTab, BotConfigScreen, PlatformConsole,
  PlatformMonitor, PlatformSupport.

## Done (TypeScript round 9, 2026-11-09, not deployed): the platform console
- [x] To `.tsx`: `PlatformConsole`, `PlatformMonitor`, `PlatformSupport` (~950 lines, ~250 errors -> 0).
- [x] New `src/platformTypes.ts`: every `/api/platform/*` answer (overview, plans, health + alerts, events,
      worker runs, delivery, audit, one business's detail). Counts and settings only, like the server.
- [x] Small fixes from the types: an alert without a business no longer tries to open a drawer; the
      worker-run summary copes with a step that has no result; a missing failure rate isn't compared as a
      number; a support query without a creation time shows blank instead of "Invalid Date".
- [x] New browser test (`e2e/mocked.spec.js`): a fake platform admin opens every console tab (Health,
      Businesses, Plans, Logs, Worker, Delivery, Audit, Support) and a business drawer, with no errors.
      Before this, no test opened the console.
- [x] Typecheck clean, 236/236 unit tests, 8 e2e pass (3 skipped: need a test login), lint 0 errors, build OK.
- Still `.jsx`: App, main, BotFlowScreen (1,034 lines), StepBuilderTab, BotConfigScreen.

## Done (TypeScript round 10, 2026-11-09, not deployed): the whole dashboard is TypeScript
- [x] To `.tsx`: `main` (index.html now loads `/src/main.tsx`), `App` (views, call state, bot rule/catalog
      handlers typed), `BotConfigScreen`, `StepBuilderTab`, `BotFlowScreen`. **No `.js`/`.jsx` is left in
      `src/`**, and every `server/*.cjs` is `// @ts-check`.
- [x] `types.ts` gained the bot shapes (`BotRule`, `BotCatalog`, `CatalogItem`, `ItemNextStep`, `StepButton`);
      `flowPresets.ts` types its presets.
- [x] Small fixes from the types: a paused business is detected through `ApiError` (not any error with a
      `data` field); a call answered without a room id gets `room_<phone>` like the incoming-call listener;
      a declined call only sends the "missed your call" text when there is a number; editing a menu item
      with no description no longer makes its input uncontrolled; unused icon imports removed.
- [x] `main`: a staff login whose role is somehow missing is treated as an agent (least privilege), as the
      untyped code effectively did.
- [x] Browser test now also opens Bot Flow (incl. the step builder) and Keywords.
- [x] CLAUDE.md and tsconfig.json say the codebase is fully typed; new files must be `.ts/.tsx` / `// @ts-check`.
- [x] Typecheck clean, 236/236 unit tests, 8 e2e pass (3 skipped: need a test login), lint 0 errors, build OK.

## Done (2026-11-09, not deployed): customer call page rebuilt, CSP enforced
- [x] `public/call.html` -> `call.html` (project root), a second Vite entry (`vite.config.js` `input`), with its
      code in `src/call/callPage.ts` (TypeScript, same signalling as before) and styles in `src/call/call.css`
      (this build's Tailwind + the ring animation). No CDN and no inline script any more; supabase-js comes from
      the app bundle (`src/supabaseClient.ts`, same project URL/key as before).
- [x] Multi-business: the page no longer says "Arogya Ruchulu". It shows `?business=<name>` from the link (or a
      neutral "Voice call" / "our team"). Both link builders add it: the dashboard's call button (`App.tsx`)
      and the bot's "call" keyword reply (`server/bot.cjs`).
- [x] `netlify.toml`: `Content-Security-Policy` is now ENFORCED (same policy as the report-only one).
- [x] New `e2e/csp.spec.js`: both pages with the netlify.toml policy enforced, fake microphone, Supabase
      websocket cut off (never rings a real dashboard). Proved it bites: against the OLD live call page it
      records 3 blocked scripts (Tailwind CDN, supabase-js CDN, inline). The mocked dashboard and platform
      console tests now also run under the enforced policy (a violation fails them).
- [x] Typecheck clean, 236/236 unit tests, 12 e2e pass (3 skipped: need a test login), lint 0 errors, build OK.
- [x] **Fixed (tenancy): incoming-call alerts were shared by every business.** The customer page used to
      broadcast every call (customer name + number) on ONE Realtime channel, `whatsapp_incoming_calls`, that
      every business's dashboard listened to. Now (new `server/calls.cjs`):
      - The server makes every call link (`POST /api/calls/link` for the dashboard's call button; the bot's
        "call" reply): a random room `room_<32 hex>` (was `room_<phone>`, guessable) and a signed token
        (HMAC, server-only key via `secrets.subKey('call-links')`; business, room, phone, name, outbound,
        24 h expiry). The customer's number is no longer in the link.
      - The page sends the token to the new public `POST /api/call-ring` (20/min per address). The server
        checks it and broadcasts (Supabase Realtime REST API, server key) only to that business's channel,
        `incoming_calls_<hmac(business)>`, whose name only that business's signed-in staff get (`/api/status`
        `callChannel`). Name/number come from the token, never from the page. Calls staff started don't ring.
      - The dashboard listens on its own channel only; the page never broadcasts the alert itself.
      - Verified against the real Supabase project with a throwaway channel: a server REST broadcast
        reaches a browser-style subscriber.
      - Tests: `tests/calls.test.cjs` (10: unguessable per-business channel, random rooms, no phone in link,
        forged/altered/expired tokens refused, ring reaches ONLY its business, outbound doesn't ring,
        Realtime down -> 502, rate limit, `/api/status` gives only your own channel, `/api/calls/link` signs
        for your own business). `e2e/csp.spec.js`: a forged link is refused and the customer is told.
      - Links sent before this deploy can't ring any more (no token); they expire with use anyway.
      - Still true: Realtime broadcast channels are public to anyone who knows the name; the names are now
        unguessable. Stronger later: Supabase Realtime private channels with RLS (DB work, deferred).
- [x] Typecheck clean, 246/246 unit tests, 13 e2e pass (3 skipped), lint 0 errors, build OK.
- [x] **Meta setup guides on the WhatsApp and Ads pages** (user request, 2026-11-09). New
      `src/MetaSetupGuide.tsx` (collapsible, open until connected, remembered per browser) with the content in
      `src/metaGuides.ts`: before-you-start, numbered steps with the Meta menu path and direct links (Meta for
      Developers, System users, WhatsApp Manager, Ads Manager, Ad accounts, Security Centre, Access Token
      Debugger), a "where to find each value" table (Phone number ID, WhatsApp Business Account ID, token, App
      secret, ad account ID), pros and cons of connecting the number / the ad account, and good-to-know notes.
      Browser test opens both and checks the links. No server change. Menu names follow Meta as of late 2026:
      if Meta renames a screen, update `metaGuides.ts`.
- [ ] **Found, not fixed: calls probably don't connect** (user: calls are not important for now; tracked
      as P3 in `Pending Implementation List.md`) (older bug, not caused by this work; not yet
      tested with two real devices). Each side sends its WebRTC offer ONCE, when it joins the room, and
      Realtime broadcast doesn't keep messages: (a) customer calls in: the page sends its offer at once; staff
      join only after pressing Accept, so they miss it and wait forever; (b) staff call out: the dashboard
      sends its offer before the customer opens the link (lost), then ignores the customer's offer (as
      initiator it only accepts answers). Fix idea: a "ready" handshake (whoever joins second says "ready";
      the initiator then sends the offer), and test it with two browser pages + fake microphones.

## Deployed: TypeScript rounds 1-10 (2026-11-09, deploy 6af175202fafa1b9f69c3280)
- User approved ("Deploy now"). Before: typecheck clean, 236/236 unit tests, 8 e2e, lint, build.
  One `netlify deploy --prod --build`. No SQL changes in these rounds.
- Live checks: site 200 (built bundle), nosniff / X-Frame-Options DENY / CSP report-only; `/api/health` 200
  `no-store`; `/api/inbox` and `/api/platform/health` 401 without login; forged webhook 401; `/call.html` 200.
- **All 8 browser tests passed against the live site** (`E2E_BASE_URL=<live> npx playwright test`), incl. the
  platform console and Bot Flow / Keywords.
- **CSP NOT switched to enforcing** (it was planned for this deploy). Found while reviewing: the customer
  call page `public/call.html` loads `cdn.tailwindcss.com` and `cdn.jsdelivr.net` scripts and has an inline
  `<script>`. The site-wide policy (`script-src 'self'`) would block all three and break every customer call
  link. The report-only warnings never showed it because only the dashboard was checked. See Next.

## Deployed (2026-11-09, 11:33 IST)
- Admin-console SQL (`20261115`) confirmed on the live database first (read-only check).
- Before: 233/233 unit tests, 7 e2e pass. One `netlify deploy --prod --build` (20 files + api and worker).
- Live checks: site 200 with nosniff / X-Frame-Options DENY / HSTS / CSP report-only; `/assets/*` cached
  `public,max-age=31536000,immutable`; `/api/health` 200 with `no-store`; `/api/inbox` and
  `/api/platform/health` 401 without login; forged webhook 401; broken JSON 400 with a JSON message.
- **All 7 browser tests passed against the live site** (`E2E_BASE_URL=<live> npx playwright test`):
  every dashboard screen renders, typing survives refresh, shared cache, no requests while hidden.
- New worker ran at 11:35 IST, 2.8 s, 0 errors, and recorded itself in `worker_runs`.

## Done (round 2, part 4: TypeScript started, 2026-11-09, not deployed)
- [x] TypeScript 7 + `@types/node`, `@types/express` (dev only). `npm run typecheck` runs two configs:
      `tsconfig.json` (dashboard `src/`: `.ts/.tsx` fully checked, `.js/.jsx` read but not checked) and
      `tsconfig.server.json` (server `.cjs`: only files starting with `// @ts-check`). No emit: Vite builds the
      frontend as before; the server still runs its `.cjs` files directly on Netlify.
- [x] Why JSDoc on the server instead of `.ts`: Netlify runs `server/*.cjs` as they are, with no build step.
      JSDoc + `@ts-check` gives the same checking with zero change to how the live functions run.
- [x] Frontend converted to `.ts`: `types.ts` (Role, Stage, Contact, StaffMember, Me, Template),
      `crmUtils.ts`, `broadcastUtils.ts` (`api<T>()` now throws a typed `ApiError` with `status`/`data`),
      `apiClient.ts`, `queryClient.ts` (`useApi<T>()`), `usePolling.ts`. Old `.js` files removed.
- [x] Server checked: `server/types.cjs` (Staff, AppRequest, Middleware typedefs), `tenant.cjs`,
      `security.cjs`, `validate.cjs`; `events.cjs` `logEvent` got a JSDoc param type (its `code = null`
      default made TypeScript think `code` could only be null).
- [x] Proved the checker bites: a probe file with three deliberate mistakes failed on all three (deleted).
- [x] 233/233 unit tests, 7 e2e pass, build OK, typecheck clean.

## Next
- [x] User checked the live dashboard with real logins on 2026-11-09: working, no issues in the browser console
      (no CSP report-only warnings).
- [x] CSP enforcing (call page made self-contained first). Deploy, then test a real call.
- [x] Incoming-call tenancy leak fixed (see "customer call page rebuilt" above). Not deployed yet.
- [ ] Calls probably don't connect (offer sent once, before the other side joins): fix + two-page test.
- [ ] After a few days without CSP warnings: change `Content-Security-Policy-Report-Only` to
      `Content-Security-Policy` in `netlify.toml`.
- [ ] User: create a test staff login (Team -> invite, owner or manager) and put `E2E_EMAIL` / `E2E_PASSWORD`
      in `.env`, then `npm run e2e` runs the signed-in checks too.
- [ ] Round 2 remaining (still no database changes):
      3. TanStack Query: done for the business dashboard. Platform console screens can switch when the
         admin-console work is finished; then `useVisiblePolling` can be removed.
      4. TypeScript, continued file by file. Done (2026-11-09, round 2): `queryUtils.ts`, `TeamScreen.tsx`,
         `PipelineScreen.tsx`; server `inbox.cjs`, `auth.cjs`, `limits.cjs` (+ JSDoc on `db.dbRequest`,
         `meta.send*`). Round 3 done: query panels, Inbox, BroadcastUi; server whatsapp/campaigns/queries.
         Round 4 done: all route files + core modules (config, db, secrets, state, meta, team, business,
         llm, webhook). Round 5 done: the rest of the server (every `server/*.cjs` is checked).
         Round 6 done: Broadcasts, Automations, Ads, Analytics screens. Round 7 done: ErrorBoundary,
         AiModeToggle, WebhookSetupModal, RaiseQueryModal, Queries, WhatsApp, Setup, AI. Round 8 done:
         helpers, sign-in and pop-ups. Round 9 done: the platform console (+ a browser test for it).
         Round 10 done: App, main and the Bot Flow screens. **TypeScript migration complete.**
         Optional later: `netlify/functions/*.cjs` and `tests/*.cjs` (the call page is TypeScript now).
      5. Schemas for the remaining nested bodies (templates, campaigns, automations, bot rules/catalog,
         business profile, platform businesses/plans) if wanted.
- [ ] Later, with database work (user's choice to wait): job queue for webhook replies and broadcasts,
      direct Postgres for heavy jobs, daily analytics summary tables.

## Decisions and gotchas
- No new npm packages: headers and limiter are a few lines each, and fewer packages = less to patch.
- Rate limits are per instance. On Netlify several instances can run, so this is a brake on one abusive
  address, not an exact quota. A shared store (database/Redis) would make it exact; that's database work.
- Webhook not rate limited on purpose: big broadcasts make Meta send many delivery receipts from a few
  addresses, and every webhook call is already signature-checked.
- The sign-in guard blocks a whole address for up to a minute after 30 refused logins. A real user behind
  the same office address as an attacker would wait a minute. Acceptable trade-off.
- CSP starts report-only so a missed source can't break the live dashboard.
- Error boundary messages only report the first line of the error, never props or state.

## Setup / deploy notes
- No SQL. No new env vars.
- `.claude/launch.json` has `vite-preview` (port 4173) to check the production build locally.
