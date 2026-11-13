# Ads module (Meta Marketing API)

**Status:** Phases A–C **live** (SQL run + deployed 2026-11-07). Waiting for the user to connect Arogya's ad account.
**Last updated:** 2026-11-07

## Goal
Let Business Admins and Managers see and control their **Click-to-WhatsApp (CTWA)** ads inside the CRM:
which ad each chat came from, what each ad cost, how many chats and orders it produced, and pause / budget
changes, without switching to Ads Manager. Not a full Ads Manager copy: billing, payment methods, disabled-account
appeals and advanced targeting stay in Meta.

## Meta app status (checked 2026-11-07, app "Arogya Ruchulu API" 4559165697698584)
- Use cases configured: WhatsApp, Marketing API, App install ads (not needed, remove it).
- App is Live; privacy policy and terms URLs set (arogyaruchulu.com/policies/...).
- `ads_read`, `ads_management`: **Standard access** (works now for people with a role on the app and ad accounts
  they manage). Advanced access requirement: **Business Verification only** (in progress).
  `ads_management` also needs `pages_read_engagement` first.
- API test calls: 0 of 1 for `ads_read` and `ads_management` (also 0 for both WhatsApp permissions;
  the last `whatsapp_business_management` attempt errored). Check that the CRM's token belongs to this app.
- Marketing API Access Tier: Limited (low rate limits; fine for one business syncing hourly).
- The app is a "direct integrator". Onboarding other businesses' ad accounts needs Advanced access and,
  at the Tech Provider stage, possibly full App Review with screencasts.

## Already in the code (Phase A is partly done)
- `server/webhook.cjs` `detectIncomingSource()` reads `msg.referral`, labels the lead "Instagram Ad" / "Meta Ad".
- `server/db.cjs` `logLead()` saves `source` and `referral` (JSONB) on `whatsapp_leads`; `inbox.cjs` returns them.
- Gaps: `referral` is overwritten by later ad clicks (no first-touch record), the ad id is not in its own indexed
  column, and nothing groups chats or orders by ad.

## Phases

### A. Lead source per ad (no Meta permission needed). Size S. **Built 2026-11-07**
- [x] Migration `supabase/migrations/20261112_ads_a_lead_source.sql`: `first_ad_id/at/headline`,
      `last_ad_id/at/headline` on `whatsapp_leads`, partial indexes per business, backfill from saved referrals,
      trigger `whatsapp_leads_ad_touch` (first touch fixed, latest ad updated on each new ad referral, and
      `source` no longer overwritten after it is first set). Safe to re-run.
- [x] `logLead()` unchanged: the trigger does the work, so every write path (webhook, staff) behaves the same.
- [x] Inbox (`src/InboxScreen.jsx`): "From ad: “headline”" in the chat header; First ad / Latest ad in contact
      details. `server/inbox.cjs` returns the new columns.
- [x] Analytics (`server/analytics.cjs` `adsPerformance()`, `src/AnalyticsScreen.jsx` "Chats from ads" card):
      per ad: new contacts, returning contacts, converted (Booked/Completed/Returning stage), conversion %.
- [x] Tests `tests/adsLeadSource.test.cjs` (7): backfill, first touch kept, source kept, non-ad referrals ignored,
      same number per business separate, Platform Admin reads nothing, adsPerformance maths. Full suite 173/173.
- [ ] Run the migration in Supabase, then deploy (with the next phase deploy, to save credits). Check with a real
      CTWA ad click.

### B. Ad results (`ads_read`). Size M. **Built 2026-11-07**
- [x] Migration `supabase/migrations/20261113_ads_b_accounts_insights.sql`: `plans.ads_enabled` (Growth + Pro on
      first run only, so re-runs keep Platform Admin edits), `business_ad_accounts` (one per business, token
      encrypted, `ad_account_id` unique + `act_<digits>` check), `ad_insights_daily` (PK business_id, ad_id, date).
      Both tables server-only (RLS on, browser grants revoked), like `business_whatsapp`.
- [x] `server/ads.cjs`: connect (checks the account AND an insights call so a token without ads_read is refused
      up front), disconnect, `syncAccount` (ad-level daily insights with paging, delivery status per ad,
      30 days first time then last 3 days), `manualSync` (every 10 min max), `syncDue` (worker), `report`
      (`summariseAds()` joins Meta spend with phase-A CRM chats: cost per chat, cost per conversion).
- [x] `server/adsRoutes.cjs`: `GET /api/ads` (owner+manager), `PUT/DELETE /api/ads/account` (owner),
      `POST /api/ads/sync` (owner+manager). Plan-gated. Token never returned.
- [x] Worker (`netlify/functions/broadcast-worker.cjs`): ads sync in the first run of each hour, last in line,
      using leftover time. No new schedule.
- [x] `src/AdsScreen.jsx` + "Ads" button in the header (owner/manager only): connect form, account bar
      (last sync, errors, change token, disconnect), KPI tiles, campaign table, ad table. No polling.
- [x] Plan switch: `limits.cjs` `ads_enabled` (plan or `limit_overrides`), Platform console checkbox
      "Ads module included" (`platform.cjs` `adsEnabled`).
- [x] Tests `tests/adsB.test.cjs` (15): ID format, insights parsing, report maths, plan switch, agents 403,
      Starter refused (no Meta call made), token encrypted + never returned, no-ads_read token refused,
      one ad account per business, manager can't connect, sync throttle, cross-business isolation,
      rate-limit recorded, worker skips suspended / no-Ads businesses, disconnect, migration RLS + re-run.
      Full suite 188/188.
- [ ] Not done: `max_ad_accounts` (one account per business for now); not checked in a browser (needs a login
      and the migrations on the live database).

### C. Quick controls (`ads_management`). Size S–M. **Built 2026-11-07**
- [x] Migration `supabase/migrations/20261114_ads_c_controls.sql`: alert columns on `business_ad_accounts`
      (max cost per chat, max cost per conversion, window 1–14 days, default 3). Safe to re-run.
- [x] `server/ads.cjs`: `setAdStatus` (pause/resume one ad), `getBudget` / `setBudget` (daily budget on the
      ad set, or on the campaign when it uses campaign budget; lifetime budgets refused), `saveAlerts`,
      `evaluateAlerts` (running ads over a limit in the window; spend with no results counts in full).
      Every action reads the object at Meta first and refuses it unless its `account_id` is the business's
      connected ad account. Audit log with before/after for every change.
- [x] Routes (owner + manager, plan-gated): `POST /api/ads/ads/:adId/status`, `GET|PUT /api/ads/adsets/:id/budget`,
      `PUT /api/ads/alerts`. `GET /api/ads` now includes `report.alerts` and `account.alerts`.
- [x] UI (`src/AdsScreen.jsx`): Pause/Resume and Budget buttons per ad (with confirm), budget dialog showing
      where the budget lives, Cost alerts card (settings + red list), warning icon on flagged ads.
- [x] Tests `tests/adsC.test.cjs` (13): agents/Starter 403 with no Meta call, pause/resume + audit, another
      account's ad refused, bad ids/statuses/deleted ads refused, read-only token message, budget in paise,
      campaign-level budget, lifetime refused, 5x/zero guard, alert validation + page alerts, migration limits.
      Full suite 201/201.
- [ ] Ad set pause/resume not built (ad level is enough for now). No auto-pause (see decisions).

### D. Create a Click-to-WhatsApp ad from the CRM. Size L. **PLANNED 2026-11-10, not started**
Goal: a Business Admin creates a simple "message us on WhatsApp" ad from the Ads page in a few steps, instead
of going to Meta Ads Manager. Advanced ads (video, carousels, A/B tests, custom audiences) stay in Ads Manager.

**What Meta needs (docs checked 2026-11-10, Marketing API "Click-to-WhatsApp"):**
- Campaign: `objective=OUTCOME_ENGAGEMENT`, `special_ad_categories=[]` (required field), created PAUSED.
- Ad set: `destination_type=WHATSAPP`, `optimization_goal=CONVERSATIONS`, `billing_event=IMPRESSIONS`,
  `promoted_object={ page_id, whatsapp_phone_number }`, `targeting` (required), `daily_budget` (ad set must run
  over 24 h) or `lifetime_budget` + end time.
- Creative: `object_story_spec.page_id` + `link_data { image_hash, message, name, link:
  "https://api.whatsapp.com/send", call_to_action { type: WHATSAPP_MESSAGE, value: { app_destination:
  WHATSAPP } } }`, optional `page_welcome_message` (the greeting).
- Image first uploaded to `act_X/adimages` -> `image_hash`.
- Ad: `act_X/ads { adset_id, creative: { creative_id }, status }`. `status=ACTIVE` -> Meta review
  (PENDING_REVIEW) -> ACTIVE.
- Prerequisites: a **Facebook Page linked to the business's WhatsApp number**, and a token that can
  advertise for that Page: `ads_management`, `pages_manage_ads`, `pages_read_engagement`, `pages_show_list`.

**Checked on the live accounts 2026-11-10:** Mayura and Arogya tokens have `ads_management` + `ads_read` +
`business_management` but **no Page permissions**, and `act_X/promote_pages` returns **no Pages**. Minimum daily
budget on both: 9567 paise, i.e. about ₹96. So each business first needs (one-time, in Meta):
1. Facebook Page -> Settings -> Linked accounts -> WhatsApp: link the business number (Mayura: +91 97011 03222).
2. Business Settings -> System users -> (the ads system user) -> Assign assets -> Pages -> that Page, with
   "Create ads" (or full control).
3. Generate a new token with the four permissions above (+ ads_read, business_management) and paste it in
   Ads -> Change token. (No App Review needed for the business's own Page/ad account; phase F needs it.)

**Ads page tabs (LIVE 2026-11-11, deploy 6af41d25):** once an ad account is connected the page has three tabs —
"Ad results" (date range + Sync now + alerts + Campaigns/Ads), "Create WhatsApp ads" (`AdsCreateReady`, no
longer a collapsible card; it asks Meta when the tab opens) and "Setup guide" (`ADS_GUIDE`). The chosen tab is
remembered per browser (`ads_page_tab_v1`). Not connected: the guide (open) + connect form, as before.

**D1. Ready-to-create check + Page — LIVE 2026-11-10 (deploy 6af307e5; SQL `20261120_ads_d1_create_ready.sql` run)**
- [x] `business_ad_accounts` + `page_id` (digits check), `page_name`, `max_daily_budget` (numeric, default 2000,
      0 < cap <= 1,000,000). Migration safe to re-run.
- [x] `server/adCreate.cjs`: `readiness` (GET /api/ads/create/readiness, managers + Business Admin, plan-gated):
      `me/permissions`, `act_X?fields=account_status,min_daily_budget,currency`, `act_X/promote_pages`, and the
      chosen Page's `whatsapp_number` compared with the business's WhatsApp number (last 10 digits; unknown if
      Meta errors). Pure `buildChecklist` (tested) -> 5 items, each failing one with numbered fix steps + link.
      The only promotable Page is chosen automatically. Read-only towards Meta.
- [x] `choosePage` (PUT /api/ads/create/page, Business Admin; must be in promote_pages) and `setBudgetCap`
      (PUT /api/ads/create/budget-cap, Business Admin); both in audit_log.
- [x] Ads page card "Create WhatsApp ads from the CRM" (`src/AdsCreateReady.tsx`), closed by default; Meta is
      asked only when opened (and on "Check again"); Page picker (2+ Pages), cap with Meta's minimum shown;
      "Create an ad" disabled ("coming in the next update").
- [x] Live check on Mayura: account active, minimum ₹96, missing pages_manage_ads / pages_read_engagement /
      pages_show_list, no Page -> not ready (as expected until the user does the 3 Meta steps).
- [x] Tests: `tests/adCreateReady.test.cjs` (7) + e2e card.

**D2. The wizard — LIVE 2026-11-10 (deploy 6af307e5; SQL `20261121_ads_d2_launches.sql` run; NOT yet
tried against real Meta: the tokens lack Page permissions until the user does the 3 Meta steps)**
Built as planned below, with these specifics: `server/adCreate.cjs` `textCheck`, `validateDraft`, `targetingFor`,
`storyFor` (pure, tested), `uploadImage` (JPG/PNG magic bytes, <= 1 MB, `act_X/adimages` bytes), `searchLocations`
(`search?type=adgeolocation`, city/region/zip/country), `estimate` (`delivery_estimate`), `preview`
(`generatepreviews` + text check), `createAd` (campaign OUTCOME_ENGAGEMENT + `special_ad_categories=[]` +
`is_adset_budget_sharing_enabled=false` -> ad set WHATSAPP / CONVERSATIONS / IMPRESSIONS / LOWEST_COST_WITHOUT_CAP,
`promoted_object {page_id, whatsapp_phone_number:+number}`, start now+10 min or the date at 00:00 IST, end 23:59 IST
-> creative link_data with WHATSAPP_MESSAGE CTA + `page_welcome_message` -> ad, all PAUSED; rollback deletes in
reverse; idempotent on `ad_launches(business_id, draft_id)`), `launch` (typed budget must match; campaign, ad set,
ad -> ACTIVE), `listLaunches`. Routes: POST /api/ads/create/image (own 2 MB JSON limit; everything else stays 1 MB),
GET /api/ads/create/locations, POST /api/ads/create/estimate, /preview, POST /api/ads/create,
POST /api/ads/launches/:id/launch (all Business Admin), GET /api/ads/launches (managers too). UI:
`src/AdCreateWizard.tsx` (picture resized in the browser to <=1080 px / <=1 MB JPEG, never sent beyond the upload;
4 steps; Launch box), card "Created here" list with Launch, "Created in CRM" badge in the Ads tab.
To verify with the first real ad: `is_adset_budget_sharing_enabled` and `page_welcome_message` are accepted in
v26; start_time format; the `whatsapp_number` Page field (D1). Tests: `tests/adCreateWizard.test.cjs` (12) + e2e.
- [ ] Step 1, Ad: image (JPG/PNG; resized/compressed in the browser to <=1 MB so it fits Netlify's request
      limit, 1080x1080 recommended), primary text (<=125 shown), headline (<=40), WhatsApp greeting (the
      first message the customer sends, prefilled), name. Button fixed: "Send WhatsApp message".
- [ ] Step 2, Who sees it: cities/areas (Meta location search `/search?type=adgeolocation`) with radius,
      age range, gender; estimated audience (`act_X/delivery_estimate`). Advantage+ audience left on.
- [ ] Step 3, Budget and dates: daily budget (>= Meta minimum, <= the business cap), start date, optional
      end date; shows "at most ₹X total" when an end date is set.
- [ ] Step 4, Review: live Meta preview (`act_X/generatepreviews` with the creative spec, shown in the
      existing preview dialog), the text check results, summary. "Create (paused)".
- [ ] Server `server/adCreate.cjs`: pure `validateDraft` + `textCheck` (tested), then image -> campaign ->
      ad set -> creative -> ad, all PAUSED; any failure deletes what was created (no half ads left in Meta).
      Idempotent with a draft id from the browser (a retried request never creates two ads).
- [ ] "Launch" on the created ad (owner confirms the daily budget again) -> ACTIVE -> Meta review. The ad
      then appears in the Ads tab like any other (badge "Created in CRM"), with Pause/Budget/Preview.
- [ ] New table `ad_launches` (business_id, created_by, draft id, Meta campaign/ad set/creative/ad ids,
      spec json without the image, status, error, created_at); server-only; audit_log `ads.ad_created` /
      `ads.ad_launched`.
- [ ] Text check before anything reaches Meta: the same rules as AI/bot text (no cure/treatment/guarantee
      claims, no "100% results", no prices that aren't in the business's catalog when a price is mentioned),
      plus Meta's own rules for health ads: never address personal health conditions ("Are you diabetic?",
      "your PCOS"). Blocks with a clear reason; Meta still reviews every ad.
- [ ] Endpoints (Business Admin only to create and launch; managers see the drafts): POST
      /api/ads/create/image, GET /api/ads/create/locations, POST /api/ads/create/estimate, POST
      /api/ads/create/preview, POST /api/ads/create, POST /api/ads/launches/:id/launch.
- [ ] Tests: validation and text check (pure), creation order + rollback + idempotency + paused-first with a
      fake Graph, owner-only, budget limits, tenancy; e2e: the wizard with mocked Meta, preview, launch.

**D3. Later (only if asked):** video ads, several images (carousel), "Duplicate this ad" from an existing one,
Instagram-only placement, scheduling a stop when a cost alert fires.

**Decisions to confirm before building (defaults in brackets):**
- Who may create and launch ads: [Business Admin only; managers can see them, pause and change budgets as now].
- Budget cap per ad per day: [₹2,000, changeable by the Business Admin].
- Ads are created paused and need a separate "Launch" click: [yes].
- Health businesses (Mayura): Meta limits some health & wellness ad options and reviews health ads more
  strictly; check Meta's current health-ads policy for India before launch [verify at build time; I have
  not confirmed the current restrictions].

**Risks:** Meta review can reject or delay (hours); Page-WhatsApp linking is done by the user in Meta; the
Marketing API's standard access has low rate limits (creating one ad is ~6-8 calls, fine); image upload size vs
Netlify's 6 MB request limit (solved by resizing in the browser).

### E. Closing the gap with Meta Ads Manager — E1–E4 LIVE 2026-11-11 (deploy 6af41d25; SQL 20261125 run)
Built: `server/adConversions.cjs` (queue `onStage` hooked into `inbox.updateContact` + `applyStageEvent`;
worker step `adConversions` in `broadcast-worker.cjs`; `GET/PUT /api/ads/conversions`), SQL
`20261125_ads_e_conversions.sql` (settings / datasets / queue, server-only, unique per lead+click+event),
Ads tab "Bookings to Meta" (`src/AdConversions.tsx`); wizard: carousel (2–10 pictures, own headlines),
"Opens a chat with" (E2), "Where the ad shows" (E3; Status disabled for `industry = hospital`), readiness
returns `numbers` + `statusAllowed`; `adCreate.storyFor` / `targetingFor` / `validateDraft` / `createAd`
extended (spec stores `placement`, `number`, `cards`). Defaults keep old behaviour: automatic placements, one
picture, Page-linked number, conversions off. Safe to deploy before the SQL (no table → treated as off).
Tests: `tests/adsPhaseE.test.cjs` (9) + e2e "Ads E" + updated tab test. Unit 357/357, e2e 34 passed.
Still to verify with real Meta: dataset creation + event accepted with the system user token (needs
`whatsapp_business_manage_events`); carousel `child_attachments` + `page_welcome_message` on CTWA; Status
placement + `wamo_whatsapp_identity_spec` for a non-healthcare business (Arogya); a chosen non-linked number.
Rule (user): everything plugs into what exists — same ad account, same wizard, same results; nothing that works
today changes behaviour unless the Business Admin switches the new thing on.

Checked in Meta's docs (2026-11-11):
- Conversions API for business messaging: `POST /{WABA_ID}/dataset` (create or return the WABA's dataset),
  `POST /{DATASET_ID}/events` with `action_source: business_messaging`, `messaging_channel: whatsapp`,
  `user_data: { whatsapp_business_account_id, ctwa_clid }`, `event_name` one of Purchase / LeadSubmitted /
  QualifiedLead / …, `custom_data { currency, value }`. The `ctwa_clid` comes in the message webhook's
  `referral`. Meta does NOT deduplicate: we must. Token needs `whatsapp_business_manage_events` (+
  `whatsapp_business_management`). One dataset per Page.
- Placements: `publisher_platforms` / `facebook_positions` / `instagram_positions` / `whatsapp_positions`.
  WhatsApp **Status** = `whatsapp_positions: ["status"]`, only together with Instagram `story`; creative may
  carry `wamo_whatsapp_identity_spec { whatsapp_phone_number }`. Formats: single image/video, carousel (≤10).
  NOT allowed: EU/UK (+ sanctioned countries), **Pharma / Healthcare** verticals, special ad categories, A/B
  tests, dynamic creative. → Status is offered only to non-healthcare businesses.

Order (value first):
- **E1. Bookings back to Meta (Conversions API)** — Ads → "Conversions" tab: switch on/off (off by default),
  optional average booking value (₹; with a value → `Purchase`, without → `LeadSubmitted`). When a chat that
  came from a Click-to-WhatsApp ad (has `ctwa_clid` in its referral) moves to Booked / Completed / Returning
  (staff, pipeline drag, or the bot's Book / Enquire), one event is queued (deduped per lead + click + event);
  the 5-minute worker sends it with the WhatsApp token to the WABA's dataset (created on first use). Status
  card: sent / waiting / failed + the last Meta error (e.g. missing permission). Nothing in the stage change
  itself waits for Meta.
- **E2. Choose the WhatsApp number per ad** — wizard step 1: "Opens a chat with" (default: the number linked
  to the Page; other business numbers listed with a note that Meta must have them connected to the Page).
  Stored in the launch spec; Meta refuses unlinked numbers and the create rolls back as today.
- **E3. Where the ad shows** — wizard step 2: Automatic (today's default) / Feeds, Stories and Reels on
  Facebook + Instagram / + WhatsApp Status (non-healthcare only; adds the WhatsApp identity spec).
- **E4. Carousel** — wizard step 1: "Add another picture" (2–10 cards, each with its own headline); one
  picture stays a single-image ad exactly as today.
- Later (backlog, not built): video ads (needs a larger upload path than Netlify's 6 MB request), interests /
  custom audiences / lookalikes (custom audiences upload customer phone numbers to Meta: needs a consent
  decision), A/B variants and more ads per campaign, editing a created ad's text/picture, lifetime budget,
  other objectives.

### F′. Watching ads — F1–F4 LIVE 2026-11-11 (deploy 6af41d25; SQL `20261126_ads_f_watch.sql` run)
(Named F′ to avoid clashing with "F. Multi-business onboarding" below.) `server/adWatch.cjs`:
- **F1 rejected / flagged ads:** the hourly sync now reads `ad_review_feedback` + `issues_info` with the
  statuses (falls back to status-only if Meta refuses the fields, so the status update never breaks);
  DISAPPROVED / WITH_ISSUES saved in `ad_issues` with Meta's reasons (`reasonsOf`, shape-tolerant);
  unchanged = stays seen, changed = announced again, fixed = removed. Ads → Ad results: "Needs attention"
  panel (reason + Open in Ads Manager); red badge on the Ads menu (managers, `GET /api/ads/issues`, no plan
  gate → empty without Ads); "Got it" (`POST /api/ads/issues/ack`).
- **F2 Instagram account:** readiness shows the Page's `instagram_business_account`; new ads set
  `object_story_spec.instagram_user_id` (Meta's replacement for `instagram_actor_id`) unless "Show as
  @name" is unticked; no IG account = the Page, as before.
- **F3 auto-pause:** "Pause these ads automatically" in Cost alerts (`business_ad_accounts.auto_pause`, off by
  default, needs a limit). After a business's hourly sync (`ads.syncDue`), ACTIVE ads over the limits are
  paused (re-checked at Meta: own account + still ACTIVE; at most 5 per run; never resumes), audited as
  `ads.ad_auto_paused` (actor system) and listed under Needs attention with the numbers.
- **F4 duplicate:** "Duplicate" on every ad in Ad results (`POST /api/ads/ads/:adId/copy` → Meta `/copies`,
  `status_option: PAUSED`, same ad set; own account only; managers+); "Use as a start" on ads created here
  (wizard filled from `adCreate.reuseOf`, no dates, pictures reused by hash).
Tests: `tests/adsPhaseF.test.cjs` (9) + e2e "Ads F"; `adsC` expects `autoPause: false` in alert settings.
Unit 366/366, e2e 35 passed. Still to see with real Meta: the exact `ad_review_feedback` text, `/copies` on a
CTWA ad, `instagram_user_id` accepted with a Page token, `instagram_business_account` readable.

### G. Billing card — built 2026-11-11, local (needs SQL `20261129_ads_billing.sql`)
User asked to show the ad account's money side (and to "add more amount" from the CRM).
- **Decision:** the CRM never takes or adds money. Meta's Marketing API has no endpoint to pay or add funds. The
  buttons open Meta's billing page instead:
  - **Add funds in Meta** for prepaid accounts
  - **Fix payment in Meta** when a payment fails
  - **View bills in Meta** otherwise
  - the link is `business.facebook.com/billing_hub/accounts/details/?asset_id=…`
- **What's read** (`server/adBilling.cjs`):
  - Ad account fields: `account_status`, `disable_reason`, `balance` (amount due), `amount_spent`, `spend_cap`,
    `is_prepay_account`.
  - `funding_source_details.display_string` needs the token's Manage task; without it the rest still loads.
  - Money comes in paise and is converted with `minorFactor`.
  - Meta doesn't document a prepaid "available balance" field, so it isn't shown or guessed.
- **When it's read:** with the hourly sync (best effort), plus **Check now** (at most once a minute). It's saved on
  `business_ad_accounts.billing`, so page visits don't call Meta.
- **Who sees what:**
  - Managers and the Business Admin see the card; agents get 403, and a plan without Ads is refused.
  - Only the Business Admin sets or removes the account spending limit (`spend_cap`, or `spend_cap_action=delete`).
    The value is checked (at least 100, typo guard), read back from Meta and audited (`ads.spend_cap_changed`).
- **Payment and account problems:**
  - Statuses 3 / 8 / 9 (payment), 2 (disabled, with Meta's reason), 7 (review), 100 / 101 (closed).
  - The problem adds 1 to the Ads menu badge (via `/api/ads/issues` `billingProblem`) until Meta reports it fixed.
  - It's logged once when it starts (`billing_<problem>`).
- **Tests:** `tests/adsBilling.test.cjs` (8); e2e "Ads billing card…" (2).
- **Not verified yet against a real ad account:** the exact amount fields and the billing hub link.

**G (billing card, G1 business hours, G2 edit, G3 ad numbers) LIVE 2026-11-11, deploy 6af45853.** SQL 20261129:
billing columns run; `ad_numbers` was added to the file afterwards, so the user must run the file again
(it's safe to re-run). Until then, ad cards say "shown after the next sync".

### G4. Who owns the ad account + "How Meta is organised" guide — LIVE 2026-11-11 (deploy 6af46720; no SQL)
The user's portfolio "Mayurahospitals" showed 0 ad accounts, yet ads appeared in the CRM. The connected account
(act_995251931856907, "vanguardmayura") belongs to another portfolio or a person.
- **Server:** `adBilling.refresh` also reads the ad account's `business{id,name},owner` and the WABA's
  `owner_business_info` (with the WhatsApp token, server-side).
  - `parseOwnership` produces `{ adAccount, personal, adKnown, whatsapp, same }`, stored inside the billing
    snapshot (`billing.ownership`).
  - A refused field leaves that part unknown; billing still loads.
- **Ads page:** an owner line under the account bar (`AdsOwnership`).
  - Green "✓ Same business portfolio", or an amber warning: a different portfolio or a personal account, why the
    portfolio shows "0 ad accounts", who controls payment, and how to fix it.
  - It links to the guide.
- **Setup guide tab:** `src/MetaOrgGuide.tsx` comes first:
  - the portfolio and what's inside it
  - campaign → ad set → ads with the eye-camp example
  - why "0 ad accounts" can happen
  - the clean-setup steps
  
  The connection guide (`ADS_GUIDE`) is now collapsed below it, and its outdated "you still create ads in Ads
  Manager" line has been updated.
- **Tests:** 2 more in `tests/adsBilling.test.cjs`; e2e prepaid billing test checks the owner line and the guide.
- **Booklet (same day, user request):** `MetaOrgGuide.tsx` is now a 14-chapter booklet with a contents list,
  "Open all" and jump-to-chapter. Chapter 1 is open.
  - Chapters:
    1. Meta's apps and tools
    2. The hierarchy: person → portfolio → assets
    3. Assets
    4. People and roles (Full control / Partial access / Finance / Developer; approvals)
    5. Asset tasks, and what the CRM needs
    6. System users and tokens
    7. Partners and agencies, incl. "0 ad accounts"
    8. Developer apps
    9. WhatsApp: Business app vs Platform
    10. Ads hierarchy
    11. Who pays
    12. Meta's roles vs the CRM's roles
    13. Setup checklist
    14. Glossary
  - The examples use a made-up business ("Sunrise Clinic"), because every business on the platform sees this
    guide. The e2e test checks no customer name appears.
  - Meta's role names change over time; the booklet gives today's and older names. Review it when Meta renames
    things.
- **Pictures (same day, user request):** `src/guideVisuals.tsx`, plain HTML + Tailwind, with no images or
  libraries.
  - Pieces: `Figure` (captioned, labelled group), `Flow` (numbered steps with arrows; vertical on phones),
    `OrgTree` (org chart with connector lines), `RoleLadder`, `Decision` (yes/no chart), `TwoBoxes` (two portfolios
    sharing), `Node`, `Chip`.
  - 20 figures across the chapters. For example:
    - who talks to whom
    - apps versus tools
    - the person → portfolio → assets tree
    - owned versus shared
    - the role ladder, "which role should I give?" and adding a person
    - the two layers of access
    - system user → token → CRM
    - agency-owned versus you-own-and-share
    - how a message reaches the CRM
    - the customer journey from ad to booking
    - the ad structure tree
    - money flows for ads and WhatsApp
    - Meta versus CRM roles (two worlds, CRM role ladder)
    - the six-step setup
  - The e2e test checks at least 15 figures, the decision chart, the agency picture, and no sideways scroll at
    390 px.

### G3. Each ad's WhatsApp number + collapsible "Needs attention" — built 2026-11-11
User asked to show the number linked to each ad. The live account showed 358 Meta conversations but 0 CRM chats,
which is what happens when ads open a number that isn't in the CRM.
- **Reading the number:** the hourly sync asks for `adset{promoted_object}` on the ads list, falling back to the
  older field lists if Meta refuses it.
  - `promoted_object.whatsapp_phone_number` is the number.
  - Page-only ads use the Page's `whatsapp_number` (at most 5 Pages per sync).
  - Saved as `business_ad_accounts.ad_numbers` (`{ adId: { n, p } }`, at most 3000). The column is added in the
    same, not-yet-run `20261129_ads_billing.sql`.
- **Report:** `report.adNumbers` gives `{ phone, viaPage, label, inCrm }`.
- **Ad cards:** green "Opens +91 97011 03222 · Main number". Amber "… not connected to this CRM: its chats don't
  reach this inbox". Grey "shown after the next sync".
- **Needs attention:**
  - Collapsed by default, with a one-line summary ("38 with a Meta problem · 2 rejected").
  - "Show all" / "Hide" is remembered in the browser (`ads_attention_open_v1`). Issues also show the ad's number.
- **Tests:** 3 more in `tests/adsBilling.test.cjs`; e2e Ads F checks collapsed / expanded and the numbers.

### G1/G2. Business hours + editing — built 2026-11-11, local (no SQL: stored in `ad_launches.spec`)
- **G1, "Only during business hours"** (wizard, Budget step):
  - You choose days and whole hours. The default is the business's send window (`sendWindowFor`), Monday to
    Saturday, in the ad account's time zone.
  - Meta's ad-set schedule needs a lifetime budget and an end date. The CRM still asks for a daily amount and
    sends `lifetime_budget = daily × scheduled days`, `pacing_type=["day_parting"]` and `adset_schedule`
    (`timezone_type: ADVERTISER`).
  - Validation:
    - an end date is required
    - at least one chosen day must fall inside the run
    - the whole-run amount must reach Meta's minimum: min daily budget × all days in the run (a conservative
      guess at Meta's rule)
  - All-day ads are unchanged (`daily_budget`). "Use as a start" copies the schedule.
- **G2, Edit** (`PUT /api/ads/launches/:id`, Business Admin only, own business only; `adCreate.editAd`):
  - Words or picture (single-picture ads; carousel headlines only): a new creative is put on the same ad, and Meta
    reviews it again. The dialog says so.
  - Audience, daily amount, end date and hours: one POST to the ad set. Scheduled ads get a recomputed lifetime
    budget.
  - More money needs the new amount typed again (`needsConfirm`), within the daily cap.
  - Not changeable (Meta's rules); the user is pointed to "Use as a start":
    - the number the ad opens
    - all day ↔ business hours
    - removing an end date
    - swapping carousel pictures
  - Partial failure: the ad-set part is saved, the creative part is not, and the message says so.
  - Audited as `ads.ad_edited` (changed parts, budget before and after).
  - The Results budget control now explains whole-run budgets ("Edit" for ads made here).
- **UI:** `src/AdEditDialog.tsx` (tabs: words and picture / who sees it / budget and dates; sends only what
  changed). `AdCreateWizard` exports `StepAudience`, `ScheduleFields`, `BudgetSummary`, `prepareImage` and helpers.
- **Tests:** `tests/adsPhaseG.test.cjs` (11), e2e "Ads G…". `adsC` expects the new whole-run budget message.
- **Not verified against real Meta yet:** `adset_schedule` + `lifetime_budget` updates on a running ad set, and
  swapping the creative on a live ad.

### H. Ads Manager fields we were missing ("Top 4") — LIVE 2026-11-12, deploy 6af54d3cefb5764229285b4c (no SQL: stored in `ad_launches.spec`)
The user compared the wizard with Meta Ads Manager and picked these 4. Server: `server/adCreate.cjs`; UI:
`src/AdWizardExtras.tsx` (used by the wizard and the Edit dialog).
- **H1, quick questions (ice breakers):** "How the chat starts" lets the user choose a pre-typed message (as before)
  or a welcome line plus up to 4 questions (1–80 characters each, no duplicates).
  - `welcomeOf(d)` builds Meta's `page_welcome_message` JSON (VISUAL_EDITOR v2, `customer_action_type: ice_breakers`).
  - The questions go through `textCheck` (no health/cure claims, no "Are you diabetic?").
  - Editable in the Edit dialog (a new creative).
- **H2, tall 9:16 picture** (single-picture ads only): `placementFeedFor` builds an `asset_feed_spec` with
  `optimization_type: PLACEMENT`.
  - The square picture is labelled for feeds; the tall one for FB/IG Stories and Reels, plus WhatsApp Status when
    "with Status" is chosen.
  - `createCreative` tries the tall version first. **If Meta refuses it, it falls back to one picture**, saves
    `tallImageHash: null` and returns a `note` that tells the user.
  - Choosing a video removes the tall picture.
- **H3, video:** this needs a browser upload, because Netlify can't carry big files.
  1. `POST /ads/create/video/upload-url` returns a signed upload link to the private bucket `ad-videos` (MP4/MOV,
     ≤50 MB). The path is `<business_id>/<uuid>.mp4|mov`. Only the newest 5 uploads per business are kept.
  2. The browser PUTs the file to that link.
  3. `POST /ads/create/video` hands Meta a 1-hour signed download link (`advideos` `file_url`). Only paths in the
     business's own folder are accepted.
  4. `GET /ads/create/video/:id/status`: the browser checks every 10 s, for up to 3 minutes ("Check again" restarts).

  `createAd` refuses with a 409 until Meta says `ready`. The creative uses `video_data`, with the picture as its
  cover. The storage copy is deleted once the ad is made. The video can't be swapped in Edit ("Use as a start").
- **H4, more targeting** (Who sees it, under "More targeting", collapsed by default):
  - interests: `search?type=adinterest`, up to 10, sent as `flexible_spec`
  - places to leave out: location search, up to 10, sent as `excluded_geo_locations`
  - languages: `search?type=adlocale`, up to 5, sent as `locales`

  All three are editable (ad set only).
- **Routes:** these are all Business Admin only and plan-gated:
  - `GET /ads/create/interests`
  - `GET /ads/create/languages`
  - `POST /ads/create/video/upload-url`
  - `POST /ads/create/video`
  - `GET /ads/create/video/:id/status`
- **Tests:** `tests/adsPhaseH.test.cjs` (12), e2e "Ads H…" (tall picture, video upload with a mocked storage and
  Meta, quick questions, targeting, Review, payload).
- **Not verified against real Meta yet (tell the user before relying on it):**
  - Whether Meta accepts placement asset customization for Click-to-WhatsApp. There is a fallback to one picture.
  - The ice-breaker limits (not documented; we use 4 × 80 characters).
  - The `file_url` video upload.

### I. More ads per campaign + existing posts — LIVE 2026-11-12, deploy 6af557276a6659db4c990a70 (no SQL: rows in `ad_launches`, grouped by `campaign_id`)
The user's two gaps compared with Ads Manager. Server: `server/adCreate.cjs`. UI: `src/AdPostPicker.tsx`, the
wizard's `addTo` mode, and the "Created here" list grouped by campaign (`src/AdsCreateReady.tsx`).

**I1, "Add an ad to this campaign"** (`POST /api/ads/launches/:id/ads`, Business Admin only, own business only).
`createAd` and `addToCampaign` share `makeAd`.
- **Two modes:**
  - **Same audience and budget:** a new creative and ad in the *same ad set*. The wizard has 2 steps (Ad → Review).
    The server takes the audience, dates and budget from the first ad, whatever the browser sends.
  - **New audience:** a new ad set (its own audience, budget and dates) in the *same campaign*.
- **Rules:**
  - The ad always opens the campaign's own WhatsApp number.
  - At most 10 ads per campaign (`MAX_ADS_PER_CAMPAIGN`).
  - Only campaigns whose ads were created completely can get more ads.
- **If Meta refuses:** only what was just made is deleted (never the existing campaign or ad set).
- **Records:** the new row's `spec` keeps `addedTo` and `sharedAdset`. Audited as `ads.ad_added`.
- **Editing:**
  - A shared ad changes only its own words. Its audience, budget and dates are refused ("change them on that ad"),
    and the Edit dialog shows only the words tab.
  - Editing the first ad's audience, budget or dates copies them to the shared ads' records (`syncShared`).
- **Launching** works as before (campaign, ad set, ad switched on). The list says that launching a shared ad also
  switches on the shared audience.

**I2, "Use an existing post"** (wizard step 1, also when adding to a campaign).
- **Listing:** `GET /api/ads/create/posts?source=facebook|instagram` (Business Admin).
  - Facebook: `{page}/published_posts` with `is_eligible_for_promotion`. If the system user token is refused, the
    Page's own token is fetched and used once. It is never stored or returned (test checks this).
  - Instagram: `{ig}/media` with `boost_eligibility_info`.
  - Posts that can't be promoted are shown greyed, with Meta's reason.
- **Creative** (`postCreativeFor`):
  - Instagram (from Meta's click-to-WhatsApp guide): `source_instagram_media_id`, `instagram_user_id`, `object_id`
    (the Page), and a `WHATSAPP_MESSAGE` button.
  - Facebook: `object_story_id` (must be this Page's post) plus the same button, and `instagram_user_id` only when
    `is_instagram_eligible`.
- **Checks:**
  - No extra pictures, video, Stories picture or quick questions with a post.
  - The caption goes through `textCheck` (health-claim block).
  - Instagram posts need the Page's Instagram account.
  - In Edit, the words and picture of a post ad can't change (audience and budget can).
- "Use as a start" keeps the post.
- **"Already in an ad"** (LIVE 2026-11-12, deploy 6af55c161aee78e4526354fc):
  - The picker marks posts that ads in this ad account already use, including ads made in Ads Manager, with each
    ad's name and status.
  - Choosing such a post shows a warning about audience overlap. It doesn't block.
  - How: `postUsage` reads `act_X/ads` (statuses ACTIVE / paused / in review / with issues / disapproved; not
    deleted or archived), up to 3 pages of 200. `postUsageOf` matches the creative's `effective_object_story_id` /
    `object_story_id` or `effective_instagram_media_id` / `source_instagram_media_id`.
  - Meta's Page post object has no promotion-status field, so boosts made from a *different* ad account are not seen.
  - If the read fails, the posts still list and a `usageNote` says the check couldn't be done.

- **Fixes after the first real try (LIVE 2026-11-13, deploy 6af6b305cfad7b7b0e13031b, together with UI U0–U4):**
  - Meta refused "Hyderabad +40 km" ("radius isn't within the specified bounds"). The cause is unclear: Meta allows
    17–80 km around a city, and the ad also had WhatsApp Status on for a hospital.
  - Pressing Create (paused) again on a refused draft used to repeat the old error. It now tries again with the
    current settings, in the same record.
  - The "+10 km" option was removed: it is below Meta's 17 km minimum. The server checks 17–80 km.

- **Delete (LIVE 2026-11-13, deploy 6af6dae0b78189d3ada066c3, with console U5):** `DELETE /api/ads/launches/:id` (Business Admin, own business;
  `adCreate.deleteLaunch`). A "Delete" or "Remove" button in "Created here", with the in-app confirmation.
  - **Never in Meta** (failed, or "creating" for 10+ minutes): only removed from the list.
  - **In Meta:** the ad is deleted, then its ad set if Meta lists no ad left in it, then the campaign if no ad set is
    left. Ads made in Ads Manager are never lost. An ad that shared the deleted ad's audience and budget becomes the
    ad set's own (editable).
  - Audited as `ads.ad_deleted` / `ads.ad_removed_from_list`.
- **Open:** creating an ad (the last step) is refused with error 2859024, "non-discrimination policy", for both
  system users, although the admins accepted. Next test: a new-picture ad. If that is refused too, Meta support.

**Tests:** `tests/adsPhaseI.test.cjs` (13), e2e "Ads I…" (post picker with an ineligible post, create from a post,
add with the same audience in 2 steps, grouped list, Edit of a shared ad).

**Not verified against real Meta yet:**
- Facebook Page posts with `object_story_id` plus a WhatsApp button. Meta documents this only for Instagram posts;
  if it refuses, the reason is shown and nothing is left behind.
- Whether the token can list Instagram media: it may need `instagram_basic`, and the error says so.
- The shape of `boost_eligibility_info`: we read `eligible_to_boost` and `boost_ineligible_reason`.

### F. Multi-business onboarding. Size M (after Business Verification + Advanced access)
- [ ] "Connect Meta Ads" button using Facebook Login for Business; each business picks its own ad account.
- [ ] Request Advanced access for `ads_read`, `ads_management`, `business_management`, `pages_show_list`,
      `pages_read_engagement`; screencasts of phases B and C.

## Next
- [ ] Remove the "App install ads" use case from the Meta app.
- [ ] Confirm the CRM's WhatsApp token belongs to app 4559165697698584 (Access Token Debugger).
- [x] Build phase A (needs no Meta approval).
- [ ] Run `20261112_ads_a_lead_source.sql` then `20261113_ads_b_accounts_insights.sql` in Supabase **before**
      deploying (inbox and analytics select the new columns and would error without them).
- [ ] Generate a System User token on app 4559165697698584 with `ads_read`, assign Arogya's ad account to that
      system user, then connect it on the Ads page (Business Admin login).
- [ ] Deploy A + B together (one deploy; ask first). Then check one real ad shows spend and CRM chats.
- [ ] Run `20261114_ads_c_controls.sql` too (after the B file).
- [ ] For pause/budget the token also needs **ads_management** (same System User token, add the permission).
- [ ] Next: phase D (create ads) is planned (2026-11-10, see D above): first the user does the 3 Meta steps
      (link Page to WhatsApp, assign Page to the system user, new token with Page permissions), then D1 -> D2.
- [ ] After Business Verification passes: request Advanced access for the WhatsApp permissions first.

## Go-live checklist for A–C (prepared 2026-11-07)
Pre-flight done: 201/201 tests, lint clean for Ads files, build OK; the three SQL files applied in order
**twice** on a copy built from all migrations up to Q1 (= live today) with sample leads: ad lead backfilled,
"post" referral ignored, Growth/Pro get Ads, Starter not, a later non-ad message keeps source "Instagram Ad".

**Order matters: SQL first, then deploy.** The new Inbox/Analytics code reads the new columns; deploying
before step 2 would break the Inbox.

1. [x] (User) Supabase -> Database -> Backups: confirm a recent backup exists.
2. [x] (User, 2026-11-07) Supabase -> SQL Editor, run each file whole, in this order. Claude confirmed read-only
   with the server key: all new columns/tables answer 200; plans starter false / growth true / pro true;
   0 contacts with a first ad yet (no saved referrals on live before this).
   - `20261112_ads_a_lead_source.sql`: shows contacts from ads per business.
   - `20261113_ads_b_accounts_insights.sql`: plans list (starter false, growth true, pro true); no ad accounts yet.
   - `20261114_ads_c_controls.sql`: empty list (no ad accounts yet).
3. [x] (Claude, 2026-11-07) One production deploy: `netlify deploy --prod --build`, deploy id
   `6aef0ddd32a740bbaf02a9d1` (2 functions re-uploaded: api + broadcast-worker). No new env vars.
4. [x] (Claude) Live checks without logging in: site 200, `/api/health` 200, `GET /api/ads`, `PUT /api/ads/alerts`,
   `POST /api/ads/ads/:id/status` all 401, forged webhook 401; live bundle contains "Chats from ads",
   "Cost alerts", "Connect your Meta ad account", "From ad:"; PlatformConsole chunk has "Ads module included".
5. [ ] (User) Meta Business Settings -> System users -> (system user) -> Assign assets: Arogya's **ad account**
   (Manage campaigns). Generate token -> app **Arogya Ruchulu API** -> tick `ads_read` + `ads_management`
   (+ `business_management`). Copy it; do not paste it in chat.
6. [ ] (User, Business Admin login) Ads tab -> Connect -> ad account ID + token. First sync runs straight away.
7. [ ] (User) Check: Ads page shows spend for the last 30 days; Inbox shows "From ad" after a real CTWA tap;
   Analytics "Chats from ads" counts it; set a cost alert; try Budget (open dialog, cancel) and Pause/Resume
   on a test ad.
8. [ ] (User) Platform console -> Plans: "Ads module included" ticked for Growth/Pro as wanted.

Rollback: redeploy the previous Netlify deploy from the Netlify UI (Deploys -> previous -> Publish). The SQL is
additive (new columns/tables + one trigger) and can stay with the old code. Dropping the trigger
(`drop trigger if exists whatsapp_leads_ad_touch on public.whatsapp_leads;`) stops both the first-touch source
rule and first/last ad tracking, so only do that if the trigger itself causes a problem.

## Ads page layout (2026-11-10, DEPLOYED 6af2c569)
- Results split into **Campaigns** and **Ads** tabs (counts on the tabs), each with search, a status filter
  and sort (default **Latest first** = last day with results, then first day, then spend; also highest spend,
  most chats, lowest cost per chat). 10 per page with numbered pages ("Showing 11–20 of 57").
- Each row is a card: status, name, campaign › ad set, "Ran 1 Nov – 9 Nov", six key numbers (spend, clicks +
  click rate, Meta conversations, CRM chats new/returning, cost per chat, converted + cost each). Ads have
  Pause/Resume, Budget and **Details** (impressions, summed reach, cost per click, cost per Meta conversation,
  first/latest day, ad ID, ad set + ID). Campaign cards show "x of y ads active", ad set count and
  **View ads** (opens the Ads tab filtered to that campaign, removable chip).
- Server `summariseAds` now returns per ad `firstDate`, `lastDate`, `adsetName`, `ctr`, `costPerClick`, and per
  campaign `firstDate`, `lastDate`, `activeAds`, `adsets`, `ctr`; both lists come latest first.
- Tests: adsB "latest first, with the days they ran"; mocked e2e "Ads page: Campaigns and Ads tabs…".

## Ad previews (2026-11-10, DEPLOYED 6af2f23469f84fdbf56c9e79; no SQL)
- Each ad in the Ads tab has its creative's thumbnail (56 px) next to the name and a **Preview** button
  (the thumbnail opens it too). Thumbnails: `GET /api/ads/thumbnails?ids=` (max 10 = the page on screen)
  -> ONE Graph call `act_X/ads?fields=id,creative{thumbnail_url,...}&filtering=[id IN ...]` (Meta removed
  `?ids=` in v26: "The ids query parameter is deprecated in v26.0+"), only for ad ids synced for this
  business; cached in memory 50 min (fbcdn links expire), never stored. Preview: `GET
  /api/ads/ads/:adId/preview?format=` (MOBILE_FEED_STANDARD, INSTAGRAM_STANDARD, INSTAGRAM_STORY,
  DESKTOP_FEED_STANDARD) -> ownership check (`ownedObject`) + `/{ad}/previews`; the iframe src is accepted
  only from `https://business.facebook.com` or `https://www.facebook.com` (Meta returns business.*). Dialog:
  placement buttons, Meta's frame, headline / ad text / button (`creativeParts`: link, video, asset-feed
  ads), spend/chats/cost, "Open in Meta Ads Manager". CSP: `frame-src https://business.facebook.com
  https://www.facebook.com` added (img-src already allowed https:). Managers + Business Admin only.
  Live check on Mayura: 10/10 thumbnails in one call (1.7 s), preview frame for mobile + Instagram.
  Tests: `tests/adsPreview.test.cjs` (4) + the Ads page e2e (thumbnails, Preview, placement switch).

## Decisions and gotchas
- **No Meta sync inside a web request (2026-11-10, DEPLOYED 6af2b5902aaa153f6a2261da; worker run 06:15 UTC ran
  adsSync outside the hourly slot: synced 1, failed 0).** Mayura's Connect gave 504: its
  account (act_995251931856907, ~1,250 ads) takes ~9s per page of per-ad daily insights, 4 pages for 30 days
  (~36s), and Connect ran that first sync inline (Netlify stops requests at ~10s). The row WAS saved.
  Now: Connect only checks the account + ads_read (4s timeouts) and returns; the worker loads the first 30
  days in 3-day windows, newest first, as many as fit its budget, resuming from the oldest day saved since
  `connected_at` (no new column); `last_sync_at` is set only when done (UI shows "Loading the last 30
  days…" via `firstSyncPending`). A failed first sync keeps `last_sync_at` null and waits an hour (via
  `updated_at`). "Sync now" only marks the account due (3-day re-sync measured 8.4s on Mayura); the worker
  syncs it within 5 min. `adsSync` now runs every worker run (syncDue still limits each account to hourly).
  Graph calls have a 20s timeout. Ran the new first sync locally for Mayura: 3 runs (19s, 19s, 10s), all 30
  days saved (1,839 rows), so its Ads page already has data.
- Focus on CTWA ads only. Full Ads Manager is too large, changes often, and billing/appeals cannot be done by API.
- Standard access is enough to build and run B–E for Arogya's own ad account; verification is only needed for
  other businesses (phase F).
- Platform Admin sees counts only (e.g. businesses with ads connected, total sync calls), never ad leads or
  referral content, enforced in RLS.
- "Orders" depends on the Orders module (P1 backlog). Until then use the pipeline stage as the order signal.
- Insights sync hourly at most; no new schedules (reuse the 5-minute worker).
- Phase A uses a DB trigger rather than server code for first/last ad, so the rule holds for any writer and
  PostgREST's merge-upsert (which overwrites every sent column) cannot undo it.
- `source` is now first-touch: an ad lead used to turn into "Direct WhatsApp" on their next message, which hid
  ad leads in "New leads per day". A contact who first came directly and later via an ad keeps
  "Direct WhatsApp" as source but gets `first_ad_id` / `last_ad_id` set.
- Phase B tables are server-only (not RLS-per-business readable) so the token never reaches a browser and role
  + plan checks live in one place (adsRoutes). The Platform Admin has no route to them.
- Connecting runs the first sync straight away; if that request times out on Netlify the account is still saved
  with `last_sync_at` null, so the next hourly worker run does the first sync.
- Meta "conversations" (7-day messaging conversations started) and CRM chats are both shown: Meta's count is
  what Meta bills against; the CRM count is what reached the inbox. Cost per chat uses the CRM count.
- Summed daily reach overstates unique reach, so the UI shows impressions and clicks, not reach.
- No auto-pause: conversions are recorded when staff move a chat to Booked, often a day or more after the spend,
  so an automatic rule would pause ads that are actually working. Alerts flag; a person decides.
- Budget changes are capped at 5x the current budget per change (typo guard: 5000 instead of 500). Meta's own
  minimum budget still applies and its error is passed through.
- Meta budgets are in minor units (paise); currencies without minor units (JPY, KRW, ...) use factor 1.
- "Returning" = an existing contact (first ad before the period, or no ad) whose latest ad click is in the period.

## Setup / deploy notes
- Migrations to add: `2026111x_ads_a_lead_source.sql`, `2026111x_ads_b_accounts_insights.sql` (safe to re-run).
- No new env vars: ad tokens are stored per business, encrypted, like `business_whatsapp`.
- Deploy once per finished phase; ask before deploying.
