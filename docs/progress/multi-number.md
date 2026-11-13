# Several WhatsApp numbers per business

**Status:** N1–N4 LIVE 2026-11-10 (deploy 6af307e5; SQL 20261122–20261124 checked present first).
Next: try it with a real extra number in Meta (none added yet). N5 (staff per number) optional.
**Last updated:** 2026-11-10

## Goal
A business can connect more than one WhatsApp number (e.g. Reception and Pharmacy) and run them from one
dashboard. **Decision (user, 2026-11-10): one chat per customer** — a customer who writes to two of the
business's numbers is ONE contact with ONE history; every message is marked with the number it went through,
and replies go out from the right number.

## Today (what has to change)
- `business_whatsapp` has `business_id` as primary key: exactly one number per business
  (`supabase/migrations/20261107_m1_multi_business.sql`). `phone_number_id` is already unique.
- `whatsapp.getWhatsApp(biz)` returns "the" connection; 25 calls in 12 server files send through it
  (bot, inbox, campaigns, automations, queries, calls, ads, webhook, meta, tenant, broadcastRoutes, adCreate).
- The webhook resolves the business from `/webhook/<key>` and drops events for a different
  `metadata.phone_number_id` (`webhook.cjs`).
- The 24-hour window is `whatsapp_leads.last_inbound_at`: per (business, customer). Meta's window is per
  (business NUMBER, customer).
- Templates are listed per WABA; calls, ads (`promoted_object.whatsapp_phone_number`) and the status bar
  assume one number.

## Plan

### N1. Numbers table + routing (invisible to users) — DONE 2026-11-10 (local)
Built with a simpler model than first planned (see Decisions): `business_whatsapp` stays the MAIN connection,
`whatsapp_numbers` holds only the EXTRA numbers, and a number is identified by Meta's `phone_number_id`.
- [x] Migration `20261122_multi_number_n1.sql` (safe to re-run, only adds): `whatsapp_numbers` (business_id,
      phone_number_id unique + digits check, phone_number, waba_id, label, access_token_enc (null = main token),
      token_last4, status active/disabled, added_by); `business_whatsapp.label`; trigger: the same Meta number
      can't be a main number and an extra number. `phone_number_id` on `whatsapp_messages` and `whatsapp_calls`,
      `whatsapp_leads.last_phone_number_id` (all backfilled to the main number); `lead_number_windows
      (business_id, phone, phone_number_id, last_inbound_at)` backfilled from `last_inbound_at`; RPC
      `lead_mark_inbound_number` (service role only). All new tables server-only.
- [x] `whatsapp.cjs`: `extraNumbers(biz)` (cached 60 s), `connectionForNumber(biz, id)` (null if not this
      business's number; an extra with an unreadable own token is never sent with another token),
      `ownsNumber(biz, id)`, `whatsappFor(biz, customerPhone)` (number the customer last wrote to, else main;
      no extra lookup for one-number businesses). `getWhatsApp(biz)` unchanged = main number.
- [x] Webhook: accepts events for the business's main OR extra numbers (others ignored, as before); passes the
      number on; inbound message stored with `phone_number_id`; `inbox.onInbound` also calls
      `lead_mark_inbound_number` (last number + per-number window).
- [x] Sending from the customer's number: inbox text/template replies, bot + AI replies, STOP/START and
      "NOT SOLVED" replies, query notices (`whatsappFor`); WhatsApp calls are pre-accepted/accepted/rejected and
      the recording notice sent through the CALLED number (`whatsapp_calls.phone_number_id`). Every logged
      message carries `numberId`. Broadcasts and automations still send from the main number (N4) but log it.
- [x] 24-hour check: unchanged on purpose — replies go from the number the customer last wrote to, and that
      number's window is exactly `whatsapp_leads.last_inbound_at`. `lead_number_windows` is for N2's
      "reply from another number" picker.
- [x] Fallbacks for deploying before the SQL: `logMessage` and the call insert retry without the new column;
      the missing RPC is harmless. (Still: run the SQL first.)
- [x] Tests `tests/multiNumber.test.cjs` (7): answered from the extra number with the right token; one contact
      across numbers, replies follow the last number (staff too); another business's / disabled number ignored
      and never usable; one-number business unchanged; unreadable own token never falls back; call answered via
      the called number; migration rules on PGlite (server-only, no double connection, RPC, backfill, re-run).
      Full suite 329/329, typecheck clean, no new lint warnings.

### N2. Inbox — DONE 2026-11-10 (local)
Everything below appears only when the business has 2+ numbers; with one number the inbox looks as before (e2e checks it).
- [x] `GET /api/inbox-numbers` (all staff, agents too): `[{ id, label, phoneNumber, main }]`, no secrets
      (`whatsapp.listNumbers`; main label = new `business_whatsapp.label`). Labels are set in N3; until then a
      number shows as its phone number.
- [x] Badge "📱 Pharmacy" on each chat row (number they last wrote to); "Wrote to …" in the chat header;
      "to Lab" / "from Pharmacy" on each message.
- [x] Filter "All numbers / Last wrote to: X" (`GET /api/inbox?number=`; on the main number, contacts with no
      number recorded count too; combined with search via PostgREST `and=(or(..),or(..))`).
- [x] "Reply from" picker (default = the number they last wrote to, and it follows them). Other numbers are
      marked "template only" when their window is closed; the composer is replaced by the per-number
      "24 hours passed / hasn't written to X" prompt. `POST /api/inbox/:phone/messages|template` take
      `fromNumberId` (must be this business's number; the window check uses `lead_number_windows`).
      Templates for a chosen number come from that number's account (`GET /api/templates?number=`).
- [x] Conversation API adds `contact.windows` (per number) and `phone_number_id` on messages;
      `inbox.LEAD_FIELDS` adds `last_phone_number_id`.
- [x] Tests: `tests/multiNumber.test.cjs` +4 (numbers list per business without secrets, filter incl. the
      main-number/null rule and the search combination, per-number window + foreign/malformed number refused,
      template from the lab's own account and token); e2e "several WhatsApp numbers" (badges, filter request,
      default send has no fromNumberId, Lab = template only with the lab's templates, main never written to)
      + the one-number check. Unit 333/333, e2e 28 passed (3 need a real login), typecheck clean.

### N3. WhatsApp settings: manage numbers — DONE 2026-11-10 (local)
- [x] `server/whatsappNumbers.cjs` + routes in `whatsappRoutes.cjs`: `GET /api/whatsapp/numbers` (managers +
      owner; no secrets), `POST` add, `PATCH /:numberId` rename (main or extra), `DELETE /:numberId` remove —
      Business Admin only. Add: name required (≤40), Phone number ID, optional WABA id (default = main's) and
      optional own token (stored encrypted, last 4 shown); checked with Meta (`checkWithMeta`: token sees the
      number AND it is in that account; hint to paste a token if the system user can't see that account);
      another WABA -> `subscribed_apps` POST (best effort, note shown). Refused: the main number, a number
      already added, any number connected to another business (even a removed one). Remove = `status
      disabled` (history kept; webhook then ignores it; can't remove the main number); adding it again
      restores the same row. Audit log: number_added / restored / renamed / removed (no tokens).
- [x] Plan limit `max_whatsapp_numbers` (SQL 20261123: Starter 1, Growth 2, Pro 5, written only when the column
      is first created so console edits survive a re-run). Counts main + active extras; checked before calling
      Meta; per-business override (null = unlimited) via the console. Not a usage "metric" on purpose: a
      one-number Starter business would otherwise always show "100% of your plan".
- [x] Not done on purpose: "set as main/default" — the main number is the connection saved at the top of the
      page (it holds the webhook key/app secret); swapping would move secrets between tables. Rename covers the
      "which is Reception" need. Revisit only if someone asks.
- [x] WhatsApp page: "Your WhatsApp numbers" box (`src/WhatsAppNumbers.tsx`): usage chip "2 of 3 on your
      Growth plan", Add disabled at the limit, inline rename, remove with confirm, removed numbers listed
      greyed; setup guide `EXTRA_NUMBER_GUIDE` (`src/metaGuides.ts`: add + verify in WhatsApp Manager, assign
      the account to the system user — the Mayura lesson —, copy the Phone number ID, add + test).
- [x] Platform console: business card shows "· N numbers" (count only); plan editor + per-business limits
      include "WhatsApp numbers" (`platform.cjs` LIMIT_FIELDS, `PlatformConsole`, `PlatformMonitor`).
- [x] Tests: `tests/multiNumber.test.cjs` +7 (roles; add with main token / own encrypted token + subscribe;
      refusals; plan limit + override; remove/restore/rename + webhook ignores a removed number + other
      business can't touch; platform count without labels; N3 migration re-run). e2e: owner add (Meta error
      shown, then added, limit reached disables Add), rename main, remove; manager read-only.
      Unit 340/340, e2e 30 passed (3 need a real login), typecheck clean.

### N4. The rest follows the number — DONE 2026-11-10 (local)
Everything appears only with 2+ numbers; one-number businesses see no change.
- [x] Broadcasts: "Send from" on New campaign (main or an extra); templates listed from that number's account
      (`/api/templates?number=`); `campaigns.phone_number_id` (SQL 20261124; main stays null, so old rows and a
      not-yet-migrated DB work). `createCampaign` / `sendTest` take `fromNumberId` (`campaigns.sendingNumber`:
      must be this business's number). The sender (`processBatches`) uses `connectionForNumber`: a number
      removed meanwhile (or a foreign id) fails the message, never falls back to another number. List shows
      "📱 from Lab".
- [x] Follow-ups (automations): `automations.followUpNumber` — the number the customer last wrote to IF it is
      in the main number's WhatsApp account (the follow-up's template lives there), else the main number.
- [x] Bot: shared flow; an extra number may have its own welcome text (`whatsapp_numbers.welcome_message`,
      ≤1024, "Edit welcome" on the WhatsApp page, Business Admin; health/cure claims refused with the ad
      `textCheck`; main number = Bot Flow welcome). `bot.cjs` uses `wa.welcome || catalog welcome` for the
      welcome / main-menu / fallback messages. Per-number menus: not built (no one asked; would need a
      catalog per number).
- [x] WhatsApp calls: ring event + `/api/wa-calls/ringing` carry `numberId`; the incoming card shows
      "📱 Called Pharmacy". (Answering via the called number was done in N1.) `ringing` now selects `*`.
- [x] Ads: a click-to-WhatsApp ad opens the number LINKED TO THE PAGE, so "pick the number" = link that
      number to the Page in Facebook. Readiness accepts a Page linked to ANY of the business's numbers
      (`adCreate.matchNumber`), says which one the ads open (`adNumber`, shown on the Ads card), and
      `createAd` sets `promoted_object.whatsapp_phone_number` to that number (main if Meta doesn't say).
- [x] Analytics: "By WhatsApp number" card (chats, customer messages, share, replies sent) from
      `analytics.byNumber`; messages with no number count for the main number; the messages query falls back
      to the old columns before SQL 20261122.
- [x] Tests: `tests/multiNumber.test.cjs` +8 (broadcast send from extra / main / removed / foreign; create +
      test use the number's account + refusals; follow-up number rule; per-number welcome incl. claim check,
      main refused, manager 403, sent from the right number; ringing numberId; ads matchNumber + checklist;
      analytics byNumber; N4 migration). `waCalls` ring payload now has `numberId`. e2e: broadcast "Send from"
      (options, per-account templates, `fromNumberId` sent, list chip) + analytics table.
      Unit 348/348, e2e 31 passed (3 need a real login), typecheck clean.

### N5. Optional: staff per number
- [ ] Restrict agents to some numbers (server-side, like chat ownership). With one chat per customer this
      means: an agent sees a chat if the customer wrote to one of their numbers.

### WhatsApp page redesign (LIVE 2026-11-10, deploy 6af30a11)
User: the page didn't show the connected number, only a pre-filled form. Now (`src/WhatsAppScreen.tsx`):
step pills 1 Webhook · 2 Meta details · 3 Test (ticked when done); when connected a read-only "Connected
number" card with every saved detail (phone number, Phone number ID, WABA ID, token as ••••last4, App secret
saved/missing, callback URL, verify token, last saved by) with copy buttons, "Test connection" and
"Change details" (form opens on demand; token/secret empty = keep). Not connected: Step 1 webhook card,
Step 2 empty form, Step 3 "send hi". Managers: number only, IDs hidden (unchanged server rule). The full access
token is never shown (stored encrypted; only the last 4). e2e "WhatsApp page flow" covers both states.

## Decisions and gotchas
- N1 model (2026-11-10): main number stays in `business_whatsapp` (it also holds the Meta app's webhook key,
  app secret and verify token — one callback URL serves every number of the app); extras in `whatsapp_numbers`.
  No copy of the main row, so there's one source of truth and the 25 existing `getWhatsApp` callers and test
  fixtures were untouched. Numbers are keyed by Meta's `phone_number_id` (globally unique), not a new uuid.
  N3 consequence: "make this the main number" means swapping rows (or just relabelling); decide in N3.
- N2 put `last_phone_number_id` in `inbox.LEAD_FIELDS` and `phone_number_id` in the messages select: from
  this deploy on, the inbox NEEDS SQL 20261122 (run it first).
- Number filter = "the number they LAST wrote to" (one column, scales); not "ever wrote to".
- Route is `/api/inbox-numbers`, not `/api/inbox/numbers`, so it can't clash with `/api/inbox/:phone`.
- One chat per customer (user's choice). Pipeline stage, owner, tags and notes stay per customer, not per number.
- Meta's 24-hour window is per (number, customer): replying from a different number than the one the customer
  wrote to needs a template. Hence `lead_number_windows` and "reply from the last number".
- One Meta app webhook URL can serve several numbers; routing is by `metadata.phone_number_id`.
- Templates are per WABA: numbers in the same WABA share them; numbers in different WABAs don't.
- Keep the default number's webhook key so nothing has to be changed in Meta for existing businesses.

## Setup / deploy notes
- Per extra number, in Meta first: add and verify the number in WhatsApp Manager, assign its Messaging account
  to the system user (full control), token with whatsapp_business_messaging + management.
- Migrations: `20261122_multi_number_n1.sql`, `20261123_multi_number_n3.sql`, `20261124_multi_number_n4.sql`
  (run all three in the Supabase SQL editor, in order, before deploying).
- Deploy N1 + N2 together (N1 alone changes nothing visible). Ads D1/D2 (SQL 20261120, 20261121) are also
  waiting to deploy; one deploy can carry all of it.
