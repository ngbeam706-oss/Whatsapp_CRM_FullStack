# Multi-business platform (M1–M6)

**Status:** In progress
**Last updated:** 2026-11-06 (M1 live)

## Goal
Run the CRM for several businesses (Arogya Ruchulu, Mayura Hospitals, ...) on one platform, each with its own
WhatsApp number, staff and data, strictly separated, on paid plans.

## Done
- [x] **M1 — database foundation** — `supabase/migrations/20261107_m1_multi_business.sql`
  - New tables: `plans`, `businesses`, `business_whatsapp`, `platform_admins`, `usage_counters`, `audit_log`.
  - Arogya Ruchulu = business #1 (`a0000000-0000-4000-8000-000000000001`, plan `pro`); all existing rows moved into it.
  - `business_id` on every data table; column default = Arogya until M2.
  - RLS: staff see only their business; platform admins manage businesses/plans but cannot read content.
  - New role `manager`.
  - Tests: `tests/m1Tenancy.test.cjs` (re-run safety, cross-business isolation).
  - Backup before M1: `C:\Users\genai\Backups\whatsapp-crm-db\20261106-before-M1` (all tables + login list).
  - **Run on live Supabase 2026-11-06 and verified:** 1 business (Arogya, pro, active); every row in every table
    has Arogya's business_id (7 leads, 111 messages, 5 rules, 1 catalog, 3 staff, AI settings/provider);
    anon key gets 401 on leads/businesses/ai_provider/business_whatsapp; server inbox, pipeline, rules,
    catalog and AI reads all still work. No platform admin login created yet (needs a separate login).

- [x] **M2 — server per business (code done 2026-11-06, NOT deployed yet)**
  - `server/tenant.cjs`: business id checks, roles (`owner` > `manager` > `agent`), `requireOwner/requireManager`,
    `canUseWhatsApp(biz)` (until M3 only the env number's business, `WHATSAPP_BUSINESS_ID`, default Arogya, may send).
  - `auth.cjs` puts `businessId` + `businessName` on `req.staff` (suspended business => 403).
  - Every module takes the business id first: db, botStore (per-business caches), bot, ai (per-business settings/
    provider, prompt uses the business name), inbox, team (never moves staff between businesses), campaigns,
    automations (worker groups runs per business), analytics, state (SSE + recent cache per business).
  - Manager role: bot/keywords/catalog, AI switch+knowledge, templates, broadcasts, follow-ups, reassign, analytics.
    Owner only: team, AI provider/key. Screens updated (Team page has Manager; agents see a view-only banner).
  - SQL: `20261108_m2a_before_deploy.sql` (new keys + helpers, additive) and `20261108_m2b_after_deploy.sql`
    (drop old one-business keys, default `current_business_id()`, setup tables writable by managers only).
  - Tests: `m2Routes.test.cjs` (Mayura owner calls all ~48 routes with Arogya ids: no leak, no change, every DB call
    scoped; mutation-checked), `m2Sql.test.cjs`, updated ownership/ai/inbox tests. 93 tests pass.
  - Gotcha: PowerShell `@(@(a,b))` flattens to `@(a,b)` — never pass a single replacement pair that way
    (it corrupted BroadcastsScreen.jsx once; restored from ~/.claude/file-history).

- [x] **Webhook first (2026-11-07, DEPLOYED + checked live: /api/whatsapp 401 without login, unknown
  webhook keys 404, forged /webhook POST 401, wrong verify token 403, new page in the bundle):** the WhatsApp page shows Step 1 "Set up the webhook in
  Meta" (Callback URL + Verify token) BEFORE the Meta details are saved; Step 2 is the details form.
  Server: owner opening `/api/whatsapp` or `/api/status` creates an empty `business_whatsapp` row with an
  encrypted verify token (`ensureWebhookDetails`; webhook_key from the DB default). Meta's GET verification
  on `/webhook/<key>` works for that pending row (`pendingWebhookForKey`, active businesses only); POSTs
  stay 404 until the details + App secret are saved; saving keeps the same key and token. Environment
  business (Arogya on env) still shows `/webhook` + env token, no row made. Fixed the header "Webhook"
  window: it showed `/webhook` with the business's own token (wrong for every non-env business); now
  shows the business's own address. Tests in `m3WhatsApp.test.cjs` (+3). 166 tests pass.
- [x] **Basic bot flow for every non-Arogya business (2026-11-10, DEPLOYED 6af2b5902aaa153f6a2261da):** Mayura saw Arogya's
  food labels on Bot Flow (its saved data was clean: no `whatsapp_catalog` row, so it ran `NEUTRAL_CATALOG`;
  the food words came from the Bot Flow screen itself). Now `NEUTRAL_CATALOG` has a generic services list:
  welcome -> [📋 Our services] [💬 Talk to our team] [📝 Raise a query]; `btn_menu` -> list of `menuItems`
  (max 9 + row `row_talk_staff`) -> item details -> [`enquireButtonLabel` = btn_confirm_<id>] [Talk to our team]
  -> `orderConfirmReply`. "Our services" is hidden while `menuItems` is empty. Typed "menu/services/price"
  opens the list. `row_talk_staff` is a handover id (webhook). `menuItems` count for item_viewed /
  order_enquiry events and the AI's catalog text. Frontend: `src/GenericBotFlow.tsx` is the Bot Flow page
  when `catalog.foodBuiltIns` is false (Arogya keeps `BotFlowScreen`). Arogya wording removed from shared
  screens (missed-call text, call modal, AI knowledge placeholder, automation presets + kit preset/trigger
  hidden without kits, broadcast/keyword placeholders, AI prompt "nutritionist" -> "a person from our team").
  Tests: `tests/genericBot.test.cjs` (12), mocked e2e checks the new editor. 258 unit + 14 e2e pass.
  - **Bot Flow redesign + floating guide (LIVE 2026-11-11, deploy 6af44563; now at /<area>/settings/bot-flow):** user wasn't satisfied with the page
    or the collapsible guide. Now: the three parts as numbered steps with Done / To do chips and a "N of 3 parts
    ready" strip (click to jump), an "Unsaved changes" note; a sticky phone on the right (`src/BotFlowPhone.tsx`)
    that plays the conversation exactly as `server/bot.cjs` sends it (welcome + buttons, services list sheet,
    item details with `menuItemDetails` wording, both replies, "bot paused" after Talk to our team) using the
    unsaved text; a floating "Guide" button bottom-left (`src/BotFlowAgent.tsx`, script `src/botFlowTour.ts`):
    first-visit offer (once per browser), 12-step tour that scrolls to each part and spotlights it with the
    explanation next to it (Back/Next, arrow keys, Esc), "Show me a part", and "Good to know" topics (order
    the bot decides, behind the scenes, limits, good practice — from `botFlowGuideText.ts`). The old
    `BotFlowGuide.tsx` is removed. Tour targets are `data-tour` names on the page. e2e: "Bot Flow guide agent"
    + "Bot Flow phone preview". Unit 366, e2e 36 passed.
  - **Bot Flow guide (LIVE 2026-11-11, deploy 6af41d25; replaced by the redesign above):** user asked for a tutorial explaining every section.
    `src/BotFlowGuide.tsx` (text in `src/botFlowGuideText.ts`; the name differs from the component because
    Windows treats `botFlowGuide.ts`/`BotFlowGuide.tsx` as one file) at the top of `GenericBotFlow`: tabs
    "First-time setup" (6 steps with "Show me" scroll + highlight) and "Every section explained" (top bar,
    preview, welcome + each button's action, services list + every item field, automatic replies, what
    happens behind the scenes (pipeline/inbox/follow-ups/analytics), the order the bot decides in), plus
    WhatsApp's length limits and good practice (no health/cure claims, real prices). Open the first time,
    remembered per browser. Each card got an id and a one-line "what this is for". Keep the text in step
    with `server/bot.cjs` when the bot changes. e2e "Bot Flow guide". Arogya's food `BotFlowScreen` has no guide.

- [x] **WhatsApp voice calls (Calling API) answered in the dashboard (2026-11-10, DEPLOYED 6af2c569fb7e260aed1b4f53;
  SQL 20261116 run incl. answer_sdp; live checks: /api/wa-calls/* 401 without login, unsigned webhook 401,
  bundle has the two-step answer). NEXT: user subscribes "calls" in Meta + one real phone call test.**
  Cause of "call rings, nothing in Chrome": webhook.cjs ignored `value.calls`. Now: `connect` event -> row in
  `whatsapp_calls` (SQL `20261116_whatsapp_calls.sql`, server-only), contact created, `wa_call` broadcast on the
  business's private channel (callId/phone/name only, never the SDP). Panel (bottom right, every staff member)
  shows Accept/Decline; ringing calls are also fetched on page load (`GET /api/wa-calls/ringing`, 2 min).
  Accept = `claim` (inbox.ensureCanAct, atomic ringing->answering, `wa_call_taken` closes others' cards) ->
  browser mic + RTCPeerConnection answers Meta's offer (waits ICE gathering, max 2.5s) -> `accept` sends
  `pre_accept` then `accept` with the SDP to `/{phone-number-id}/calls`. Mic blocked -> `release` (rings again).
  Decline = `reject`; Hang up = `terminate` (only the person on the call). `terminate` webhook -> ended /
  missed / failed + one chat line ("WhatsApp call, 2 min 5 s (answered by …)", "Missed WhatsApp call").
  Meta errors -> system_events `call_<action>_failed`. Tests: `tests/waCalls.test.cjs` (10) + e2e with a fake
  mic where a second in-page peer plays Meta and reaches `connected`. NOT yet tested with a real phone.
  Setup per business: run the SQL once; Meta app -> WhatsApp -> Configuration -> Webhook fields -> subscribe
  **calls**; calling enabled on the number (Mayura: done by the user).
  **Pre-deploy review vs Meta's docs (2026-11-10):** answering is now two steps as Meta requires:
  `/accept` = pre_accept (answer saved in `answer_sdp`), browser waits for the WebRTC link (max 8s), then
  `/connect` = accept with the same answer; the mic stays muted until accept succeeds. Ring window 60s (Meta:
  30-60s). `from` can be missing (username users): falls back to `contacts[0].wa_id`. Unanswered calls end
  as status COMPLETED without duration -> "missed". Calls no longer overwrite contact names (`touchLead`).
- [x] **Contact names no longer become "+91…" after bot replies (2026-11-10, DEPLOYED 6af2c569).** `db.logLead` without a
  name used to upsert `name: "+<phone>"` over the real name on every bot reply (6 of 9 live contacts showed
  this); now it only updates last message/time of an existing contact. Names come back on the customer's
  next message. Test in `genericBot.test.cjs`.

- [x] **Agents see only Inbox, Pipeline and Queries (2026-11-10, DEPLOYED 6af2f234).** Menu is one list
  (`NAV` in App.tsx, `managers: true` items hidden from agents; an agent can't land on a managers' view).
  Agents' header: business + "Agent" label, AI on/off badge (not a switch), Raise a query, New chat, Sign
  out; no Supabase/Webhook buttons, no "view only" banners, no bot catalog/rules loading. Managers' 12-item
  menu sits on its own row (it was cut off at 1280px); on phones every menu gets its own row. Server now
  refuses agents (403): GET bot-rules, bot-catalog, messages, broadcast/account, audience/*, campaigns(/:id),
  automations(/:id), whatsapp, business, business/checklist, business/usage, POST clear. GET /ai/settings
  gives agents only `{ auto_reply }`. Agents keep: inbox, notes, team list, templates (Inbox sends them),
  queries, support, pipeline, status, calls. Tests: m2Routes "agents only reach…", e2e agent + owner menus.
  Note: database RLS still lets an agent's login SELECT bot rules directly (no screen uses it).

- [x] **My profile + team performance and ranking (2026-11-10, DEPLOYED 6af2f234; SQL run:
  `20261118_staff_profiles.sql`).** Everyone gets **My profile** (menu, last item): personal details (full
  name, phone, job title, languages; table `staff_profiles`, server-only, deleted with the staff row), and
  their own performance for 7/30/90 days: chats handled, replies, typical (median) response time,
  conversions, open chats, queries resolved + average rating, calls + talk time, notes, active days, replies
  per day, and "#2 of 5 in your team" (no colleague data). Team page (managers + Business Admin): tabs
  **Members** (names/titles, click for details) and **Performance & ranking** (team totals, top 3, ranking
  table sortable by points/chats/replies/response/conversions/queries/calls) + member drawer (personal
  details incl. phone, rank, all tiles, daily bars). Points = chats x2 + conversions x10 + queries resolved
  x5 + calls x3 + notes x1; equal results share a rank. `server/staffStats.cjs` (`computeStats` is pure),
  `server/staffRoutes.cjs`: GET/PUT /api/me/profile (everyone), GET /api/team/performance and
  /api/team/members/:userId (requireManager). /api/team now includes full_name + job_title (never phone).
  Period clamped to the plan's analytics history. Tests: `tests/staffStats.test.cjs` (6) + 2 e2e.

- [x] **WhatsApp call recordings, Phase 1 (2026-11-10, DEPLOYED 6af2f234; SQL run:
  `20261119_call_recordings.sql`).** The answering browser records both sides (`CallRecorder` in
  `src/whatsappCall.ts`: Web Audio mix of mic + customer -> MediaRecorder webm/opus 32 kbps, a piece every
  10 s, the whole file at the end) and uploads straight to the PRIVATE bucket `wa-call-recordings` with
  one-object signed upload links (`server/storage.cjs`, `server/callRecordings.cjs`). Path
  `<business>/<sha256(callId)>.webm` (+ `/part-NNNNN.webm`). Only the person who answered may upload, until
  30 min after the call. Chat: under "📞 WhatsApp call, … (answered by …)" a **Play recording** button
  (`src/CallRecordingPlayer.tsx`) asks `POST /api/wa-calls/recording/play` for a 5-minute link: allowed =
  managers/Business Admin, the answerer, the agent the chat is assigned to; each play -> audit_log
  `call.recording_played`. Worker step `callRecordings`: joins pieces 10 min after a call whose browser
  closed (status ready, or failed if none), deletes recordings older than 90 days (status deleted). Notice:
  on connect the customer gets "📞 This call is recorded for quality and training…" (best effort, may be
  refused outside the 24h window) and the call box shows REC + "please tell the caller". Decisions taken by
  default (user did not choose): text notice (spoken announcement needs an audio file), 90 days,
  agents only on their own chats. Old `call-recordings` bucket (call links) never existed on the live
  project: nothing to clean up. Tests: `tests/callRecordings.test.cjs` (6), e2e: fake-mic call uploads
  pieces + whole file + complete; chat Play fetches the private link. NOT yet tested with a real phone.
  Phase 2 (AI agents answering calls) needs an always-on voice server; first check Meta's SIP option.

- [x] **Agents' passwords are set by the Business Admin / managers (2026-11-10, DEPLOYED 6af2f234; no SQL).**
  User's choice: admin sets, agent can't change or reset; admin AND managers may set. Team page -> "Add a
  team member": agent (or, for the Business Admin, a manager) gets a login email + password (a strong one is
  pre-filled; shown once with Copy; nothing emailed); Business Admins (and optionally managers) are still
  invited by email. Each row: key icon "Set password" (managers -> agents; Business Admin -> agents and
  managers; never a Business Admin or yourself). Server `team.cjs`: `addWithPassword` (Supabase Admin API,
  email_confirm, plan staff limit, existing login added never moved), `setPassword`, `forgotPassword`;
  routes POST /api/team/members, PUT /api/team/:userId/password (requireManager), public
  POST /api/auth/forgot-password (5 per 15 min per address; same answer for everyone; no email for agents;
  nothing sent if the staff list can't be read). Sign-in "Forgot password?" now uses that route; an agent who
  opens an old reset link sees "Ask your manager" and is signed out. Passwords never returned or logged
  (audit_log `team.member_added_with_password` / `team.password_set`, member email only). Rule: 8-72 chars,
  a letter and a number. Limit (documented to the user): Supabase lets any signed-in user change their own
  password through its API directly; no screen offers it, but a fully hard lock needs a Supabase Auth hook.
  Tests: `tests/teamPasswords.test.cjs` (6), e2e Team add/set + smoke "Forgot password? goes through our server".
- **Staff onboarding details (2026-11-12, local; needs SQL `20261130_staff_onboarding.sql`):** user asked that the
  Business Admin and managers fill in an agent's personal details when onboarding them, not only email and
  password.
  - New fields on `staff_profiles`: employee ID (unique per business), joining date, branch / location, address,
    emergency contact name and phone, and `updated_by`. Deliberately no ID-card numbers or dates of birth (DPDP
    data minimisation).
  - **Add a team member** has an "Onboarding details" section. The details are checked before the login is
    created, then saved with `updated_by`.
  - **Member panel:** "Personal and onboarding details" with **Edit details**.
  - **Who edits:** the Business Admin edits managers and agents; managers edit agents (same rule as passwords).
    Never another Business Admin, never yourself (use My profile), never another business.
  - **Who sees private fields:** the person, the Business Admin, and managers for agents. Managers still see
    other managers' phone, name and job title as before.
  - **My profile:** the person edits name, job title, phone, languages, address and emergency contact. Employee
    ID, joining date and branch are locked (ignored by the server).
  - Audit `team.profile_updated` records the field names only.
  - Before the SQL is run, the original four fields still read and save.
  - **Tests:** `tests/staffOnboarding.test.cjs` (8); e2e "Team onboarding…".
- **Broadcasts naming and guides in pictures (2026-11-11, local):**
  - Renamed "Campaigns" to **"Broadcast campaigns"** (button "New broadcast", plus a "not ads" note) and the Ads
    results tab to **"Ad campaigns"**.
  - The "How this works" guides on Broadcasts got an **"In pictures"** section (`src/broadcastGuidePictures.tsx`,
    building blocks in `src/guideVisuals.tsx`: `Funnel`, `PhoneMessage`, `Blank`, `Timeline` added).
    - **Campaigns:** the flow from template to replies; broadcast versus ad campaign; a phone preview with the
      filled blanks; a sent / delivered / read / replied funnel; who is left out.
    - **Templates:** the 24-hour rule timeline; the labelled parts of a template next to the filled version;
      "which category?"; the review lifecycle (approved / rejected / paused); where templates are used.
    - **Automations:** the follow-up flow.
  - Examples use "Sunrise Clinic".
  - The batch wording matches the real sender: 25 per batch, a few seconds per worker run.
  - e2e "Broadcasts guides in pictures…".
- **Business Admin's My profile (LIVE 2026-11-12, deploy 6af59c0747fd46d8e9b0d7a5; SQL `20261131_business_details.sql` run by the user):**
  - **Own work details:** the Business Admin can set their own employee ID, joining date and branch, because nobody
    above them can. `saveMyProfile` uses `admin: role === 'owner'`. Managers and agents still can't set their own.
  - **Business details card** (`src/BusinessDetailsCard.tsx`, Business Admin only), saved with `PUT /api/business`
    `details`. Fields:
    - about, registered name, registration / licence number
    - phone, email, website, opening hours
    - address, city, state, PIN
    - GSTIN
  - **Checks:** each field is checked by `cleanDetails` (PIN = 6 digits, GSTIN pattern, email, website normalised to
    https, no `<` or `>`). The new values are merged with what is saved.
  - **Audit:** names the changed fields only, never the values.
  - **Shown on the card but not editable:**
    - Business type (`industry`) is read-only: the platform sets it, and it decides Meta's healthcare rules.
    - Sending hours: a link to Settings → Setup.
  - **Before the SQL is run:** the page still works, the fields are greyed out and a note names the SQL file.
  - **Tests:** `tests/businessDetails.test.cjs` (5), one more in `staffOnboarding`, e2e "My profile (Business
    Admin)…" and "My profile (agent)…".

## Next
- [x] **M2 rollout (2026-11-06):** `m2a` run + verified; deployed + verified (screens live, API 401 without login,
      signed webhook 200); `m2b` run + verified (PKs now (business_id,id) / (business_id); old helpers gone;
      server insert without business_id -> 23502; anon 401; inbox/pipeline/rules/catalog/AI/team/campaigns/
      automations/analytics all load for Arogya with the new code).
- [x] User confirmed by hand (2026-11-07, on the new Netlify site): owner login + pages, a real WhatsApp message
      + bot/AI reply in the Inbox, agent sees view-only on Keywords.
- [x] **M3 — per-business WhatsApp (code done 2026-11-06, NOT deployed yet)**
  - `server/whatsapp.cjs`: `getWhatsApp(biz)` = the business's saved connection (decrypted, 60s cache) or, for the
    env business only, the env settings; null if none or suspended. `saveConnection` checks with Meta (token sees
    the number AND the number is in the WABA), encrypts token/app secret, generates a verify token, subscribes the
    app (best effort), audit-logs. `connectionStatus` never returns the token or app secret.
  - `meta.cjs` + `templates.cjs`: every call takes `wa` first (number, token, WABA of that business). List header
    = business name (Arogya's old "🌿" header and "Healthy • Wholesome" footer are gone).
  - Webhook: `/webhook/:key` per business (own app secret + verify token); old `/webhook` = env business, accepts
    env or saved secret. Events for a different `phone_number_id` than the address's are ignored.
    netlify.toml routes `/webhook/*`. STOP/START replies name the business.
  - Routes: `GET /api/whatsapp` (owner sees webhook URL + verify token; others only status), `PUT` + `POST /test`
    owner only. Screen: `src/WhatsAppScreen.jsx`, header tab "WhatsApp".
  - SQL: `20261109_m3_whatsapp_per_business.sql` (adds `token_last4`; run BEFORE deploy).
  - Tests: `m3WhatsApp.test.cjs` (11, mutation-checked). 104 tests pass.
- [x] **M3 rollout (2026-11-06):** SQL run (token_last4 present); deployed; verified: WhatsApp page in bundle,
      /api/whatsapp + /api/status 401 without login, unknown /webhook/<key> 404, old /webhook valid sig 200,
      forged 401. Arogya still sends via env settings.
- [ ] Optional: Arogya's admin saves its own details on the WhatsApp page and moves Meta's callback to the new
      address (old `/webhook` keeps working meanwhile). Rotate the old leaked WhatsApp token at the same time.
- [x] **M4 — Platform console + onboarding (code done 2026-11-06, NOT deployed yet; no SQL needed)**
  - `server/platform.cjs` + `platformRoutes.cjs` at `/api/platform/*` (mounted BEFORE requireStaff; own
    `requirePlatformAdmin` via the user's token + RLS-readable own `platform_admins` row). Overview = counts via
    PostgREST `count=exact` with `limit=0` (never rows), WhatsApp connected/number, monthly usage. Create business
    (+ ai_settings row + invite Business Admin; rolled back if the invite fails, e.g. email in another business),
    suspend/resume (clears WhatsApp cache), change plan, paid-until, edit plan price/limits. All audit-logged.
  - Neutral starter bot: `defaults.cjs` `NEUTRAL_CATALOG` + `defaultsFor(biz)` (Arogya keeps its bot). Arogya's
    hardcoded food keywords in bot.cjs only run when `catalog.foodBuiltIns` (true only in Arogya's defaults).
  - FIXED a real leak: App.jsx kept bot rules/menus in localStorage and merged+pushed them to the server on load
    (would copy one business's rules into another in a shared browser). Now the server is the only source; legacy
    localStorage keys are deleted on load; new routes `DELETE /api/bot-rules/:id`, `POST /api/bot-catalog {reset}`.
  - Business profile `GET/PUT /api/business` (name, follow-up hours, India time) + `GET /api/business/checklist`;
    automations use per-business `sendWindowFor(biz)`. Screens: `PlatformConsole.jsx` (AuthGate routes platform
    admins there), `SetupScreen.jsx` (checklist + profile), header shows the business name.
  - Tests: `m4Platform.test.cjs` (10, mutation-checked); m2Routes extended (new routes, Arogya id may not appear in
    any DB call made for Mayura). 114 tests pass. Live read-only check of overview/checklist OK.
- [x] **M4 deployed (2026-11-06):** Setup page + old-copy cleanup in the live bundle, PlatformConsole chunk served;
      /api/platform/overview, /api/business, /api/business/checklist 401 without login, platform route 403 for a bad token.
- [ ] User: create the platform admin login (separate email) + insert into `platform_admins`; try the console.
- [x] **M5 — plan limits + usage + payments (code done 2026-11-06, NOT deployed yet; no SQL needed)**
  - `server/limits.cjs`: effective limits = plan + `limit_overrides` (null = unlimited, 60s cache, fails open if
    the plan can't be read); `check(biz, metric, n)`; `addUsage` (rpc add_usage, India-time month);
    `usageReport`; `clampAnalyticsDays`; `billingState` + `enforceBilling` (7-day grace after `paid_until`,
    then suspend + audit; null paid_until = never auto-paused). `db.countRows` (count=exact, limit=0) shared.
  - Enforced at: team invite (staff), staff-added contact (contacts), campaign create + test send + sender
    (broadcasts, per-business quota per batch, rest skipped "limit reached", usage counted), follow-up create /
    switch-on (automations), new keyword rule (rules), AI (plan has AI + replies left; else bot flow; counted on
    reply/handover; can't switch AI on without it), analytics days. Never blocked: incoming messages, staff replies.
  - Worker runs `enforceBilling` every minute. Paused business: API answers 403 `{paused:true}`, the app shows an
    "Account paused" page. Banner for owner/manager at >=80% / limit reached / payment due; Setup page "Plan and
    usage" card; console shows used / limit and a "payment due" badge.
  - Tests: `m5Limits.test.cjs` (13, mutation-checked). 127 tests pass. Live read-only usage report OK.
  - Deploy was blocked on the old Netlify team (Free plan credits used up, "Forbidden").
  - **Moved + deployed 2026-11-07:** user deleted the old site; new Netlify team `vinay-vinu-gngz4e` (the
    owner's personal account, Free plan), site id `41a683e8-1731-436c-abbe-91618c5d82d2`, SAME name/URL
    monumental-semolina-e9f403. 11 env vars copied from local .env (+ PUBLIC_SITE_URL). Production visibility had
    to be set to Public (new teams default to team-login protection = 401 for everyone incl. Meta).
  - **Moved again 2026-11-12** (that team's credits ran out): team `itzvijay406`, site id
    `51c3a9be-8f92-4d75-8675-21bbe0a91845`, same name/URL. 10 env vars from local .env (not PORT / NEXT_PUBLIC_*;
    PUBLIC_SITE_URL defaults to this address). Netlify-login protection switched off for production by the user.
    Deploy `6af54d3cefb5764229285b4c` (Phase H, staff onboarding, Broadcasts pictures, campaign renames).
    Verified: site 200, /api/health 200, API 401 without login, Arogya's /webhook/<key> verify 200 + signed 200 +
    forged 401, old /webhook signed 200. M5 is live.
- [ ] M6 — second business live end to end. "test mayura" created (owner invited, separate login OK); its
      WhatsApp details NOT saved yet, so no messages yet. AI outage on 2026-11-07 was the dead trycloudflare
      address on Arogya's AI page (user fixed it).
- [x] **Pipeline stages for all businesses (code done 2026-11-07, NOT deployed; needs SQL first):** keys unchanged,
      labels New enquiry / In discussion / Booked / **Completed (new key)** / Returning / Closed (`src/crmUtils.js`);
      server `STAGES` + `nextStage` (completed + booking again -> repeat), analytics "converted" includes
      completed. SQL `20261110_pipeline_stages_all_businesses.sql` run by user; **deployed 2026-11-07** at the
      user's request (not batched). Verified: Completed allowed in DB, new labels in live bundle, API 401, webhooks 200.
- [x] **Broadcasts "How this works" guides (code done 2026-11-07, NOT deployed):** `src/BroadcastGuide.jsx`, one
      collapsible guide per tab (Campaigns, Templates, Automations): what it is, how it helps (hospitals / food /
      shops), steps, good to know, tips; hidden state remembered per browser. Automation trigger labels made
      generic (service/product, booking/order); "WABA_ID not set" banner now points to the WhatsApp page.
      Checked visually on a temporary preview page (desktop + phone), then removed it. Waiting for the next deploy.
- [ ] **M3 — per-business WhatsApp**: each business pastes its own Meta details; tokens/secrets stored encrypted in
      `business_whatsapp`; per-business webhook URL; webhook routes incoming messages by `phone_number_id`.
- [ ] **M4** — scope to be confirmed (likely Platform Admin console: businesses, plans, usage counts only).
- [ ] **M5** — plan limits enforced server-side + manual payment record (`businesses.paid_until`).
- [ ] **M6** — scope to be confirmed.

## Decisions and gotchas
- Three levels: Platform Admin -> Business Admin (`owner`) -> employees (`manager`, `agent`).
- One business per employee; no business switcher.
- Platform Admin can NEVER read chats/contacts/notes/bot/AI content — no "support mode". Enforce in RLS.
- Onboarding: businesses paste their own Meta details now; Meta Embedded Signup maybe later.
- Plans Starter / Growth / Pro; limits editable by Platform Admin; `null` limit = unlimited; per-business `limit_overrides`.
- Send window and timezone are per business (`send_window_start/end`, `timezone`), default 9–20 Asia/Kolkata.

## Setup / deploy notes
- Run migrations in order, M1 only after all `20261106_*` files. Back up before each M-migration.
