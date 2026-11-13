# Queries (raising and tracking queries at every level)

**Status:** In progress (Q1). Decisions 1–8 = the recommended answers (user: "Yes, start Q1", 2026-11-07):
8 stages; customers can raise from the bot; hospital/food/general default categories; due times 2/8/24/72 h;
rating after Resolved: yes; agents SEE all customer queries but WORK only on own/unassigned; agents may address
Platform support directly (Business Admin still sees it); internal categories as in the table.
**Last updated:** 2026-11-07

## Goal
Any question, request or complaint that can't be answered on the spot becomes a **query** with a number, a
category, a priority, an owner and a stage, and is tracked until it is solved. Three levels:

| Level | Who raises it | Who handles it | Examples |
|---|---|---|---|
| 1. Customer -> Business | A customer on WhatsApp (bot button/keyword), the AI (handover), or staff from a chat | The business's team | Hospital: report not received, bill correction, appointment change, complaint about wait time. Food: wrong/late order, refund. |
| 2. Inside the business | An agent escalates a query | Manager -> Business Admin | Agent can't approve a refund; complaint needs the admin. |
| 3. Business -> Platform | Business Admin (or manager) on a "Help & support" page | Platform Admin | WhatsApp not connecting, plan/billing question, bug report. |

### Staff can raise queries too (user, 2026-11-07)
Not only customers: **agents, managers and the Business Admin can raise a query** — about the application, or
to their manager / Business Admin — and it is shown to, and resolved by, the right person for that query.

| Raised by | Can address it to | Typical categories | Resolved by |
|---|---|---|---|
| Agent | Managers, Business Admin, or Platform support (app problems) | How do I…?, App problem / bug, Access or permission, Approval needed (refund, discount, slot), Customer escalation, Other | The person/role it is addressed to (any manager if "Managers") |
| Manager | Business Admin, or Platform support | same + Plan / limits | Business Admin / Platform Admin |
| Business Admin | Platform support | App problem / bug, WhatsApp connection, Plan / billing, Feature request, Other | Platform Admin |

Routing and visibility:
- **Addressed to Managers** -> every manager and the Business Admin see it; the first to pick it up owns it.
- **Addressed to the Business Admin** -> the Business Admin(s) see it (managers don't).
- **Addressed to Platform support** -> stored in `platform_queries`; the Platform Admin sees it, and so does the
  raiser and their Business Admin (the admin always sees every query from their business, so nothing reaches
  the platform behind their back). The Platform Admin still never sees customer chats.
- The raiser always sees their own queries and every update; the person handling it can ask back
  ("Waiting on requester" = the "Waiting" stage), reassign, or escalate one level up
  (Managers -> Business Admin -> Platform support).
- An agent can't read other agents' internal queries unless they were added to it.
- A query can link a customer chat (e.g. "Approval needed" for Ravi's refund): the link opens the chat for
  people who may see that chat; the platform never gets the link.

Today: nothing like this exists. The AI only "hands over" (pauses the bot + a note). Backlog lists "Support
tickets" (P3) and "Close chats with a reason" (P2) — this plan covers both.

## Query stages (proposed)
| Stage | Meaning | Who moves it here |
|---|---|---|
| **New** | Just raised, nobody has picked it up | automatic on creation |
| **Assigned** | Someone owns it | auto when a staff member takes/gets it |
| **In progress** | Being worked on | staff |
| **Waiting** (on customer / on requester) | We asked the customer (or the staff member who raised it) something; the due-time clock pauses | handler; back to In progress automatically when they reply |
| **Escalated** | Passed up (agent -> manager -> Business Admin; or business -> platform) | staff / automatic when overdue (optional) |
| **Resolved** | Solved; the customer is told | staff |
| **Closed** | Final: confirmed by the customer, or automatically 3 days after Resolved with no reply | automatic / staff |
| (**Reopened**) | Customer says it is not solved within 7 days | automatic on "not solved" reply -> back to In progress |

Also on each query: **number** (Q-1001, per business), **category** (per business, editable; hospital and food
defaults), **priority** (Low / Normal / High / Urgent), **due time** from priority (e.g. Urgent 2 h, High 8 h,
Normal 24 h, Low 72 h, editable), first-response time, resolution time, and an optional **satisfaction rating**
(1–5) asked after Resolved.

## Done
- [x] **Q1 (2026-11-07):** `supabase/migrations/20261111_q1_queries.sql` (NOT yet run on live) —
  `businesses.industry` (Arogya = food) + `query_due_hours`; `query_categories` + `seed_query_categories(biz)`
  (hospital/food/retail/general + 7 internal); `query_counters` + `next_query_number(biz)` (Q-1001...);
  `queries` (kind customer|internal, addressed_to team|managers|owner, 8 stages, priority, due/paused/first
  response/resolved/closed, rating), `query_events` (visibility all|handlers); `platform_queries` (global number
  from 5001, optional `escalated_from`) + `platform_query_events` (visibility all|platform).
  Helpers `current_staff_email/role`, `query_access(id)` = requester|handler|none. RLS: browsers READ only, all
  writes by the server. Tests `tests/q1Queries.test.cjs` (10, mutation-checked). 138 tests pass.

- [x] **Q1 SQL run on live** (verified 2026-11-07: 26 categories, Arogya = food, test mayura = general).
- [x] **Q2 (2026-11-07, not deployed):** `server/queries.cjs` (engine), `server/queryRoutes.cjs`
  (`/api/queries`, `/api/queries/:id` + `/comments` `/escalate` `/rating`, `/api/queries/settings`
  (+ due-hours, categories: owner), `/api/support` for Platform support), platform routes
  `/api/platform/support[/:id]`. Rules: `MOVES` table of allowed stage moves; due time from the business's
  hours; "waiting" pauses the clock (due moves on by the time waited); agents see all customer queries but
  work only on own/unassigned (first action claims atomically); escalation customer team->managers(level 1)
  ->owner(level 2), team query managers->owner->Platform support (linked platform query, `escalated_from`);
  requester (raiser of a team query) can comment/answer (waiting->in_progress), close when resolved,
  reopen, rate; handler-only notes hidden from requesters; platform notes hidden from businesses.
  Customer messages: registered / resolved / replies — free text inside 24 h, else approved `query_update`
  template, else a handler note "customer not told". Webhook: customer reply -> their waiting queries
  move on. Worker (hourly block): auto-close resolved > 3 days. New businesses get default categories
  (console create takes `industry`). Tests `tests/q2Queries.test.cjs` (17, mutation-checked) + 13 query
  routes added to `m2Routes` cross-business test. 155 tests pass.
- [x] **Q3 (2026-11-07, not deployed):** `server/queryBot.cjs` — customer types QUERY / COMPLAINT / HELP /
  "raise a query" (or taps the new "📝 Raise a query" button: neutral welcome + every AI answer) -> category
  list (`qcat_<n>` rows) -> one message description (pending 30 min via `contact_events`) -> query created
  (source bot; "Complaint" category = high priority) and "Q-#### registered" reply. "NOT SOLVED" (webhook,
  works even when the bot is paused) reopens their query resolved in the last days. AI handover creates a query
  (source ai, the AI's reason as subject) and adds "Your reference: Q-####" to the one handover message.
  UI: `src/ContactQueries.jsx` (Inbox side panel: the contact's queries + "Raise query", optional WhatsApp
  notice), `src/RaiseQueryModal.jsx` + header "Raise a query" button (agent -> Managers / Business Admin /
  Platform support; manager -> Business Admin / Platform; owner -> Platform). Shared labels `src/queryUtils.js`.
  Tests `tests/q3RaiseQuery.test.cjs` (5) + `aiReply` updated to 3 AI buttons. 160 tests pass, build OK,
  panel + modal checked in the browser with fake data. Item (e) "My queries" moved to Q4 (Team queries view).
- [x] **Q4 (2026-11-07, not deployed):** header tab **Queries** (`src/QueriesScreen.jsx`): views Customer
  queries / Team queries (filter "Raised by me" / "For me") / Platform support / Numbers (managers+) /
  Settings (owner); list or board by stage; filters stage (default Open), priority, category, assignee,
  overdue; overdue/new badges on the view tabs; polling 30 s only while visible (`REFRESH.queries`).
  `src/QueryDetail.jsx` (side panel, also opened from the Inbox query cards): details, open chat, stage
  (allowed moves only), priority, assign (agents "Take it"), escalate with note, reply to customer /
  comment / internal note, requester close / reopen / rate 1-5, timeline (internal notes marked).
  Server: `GET /api/queries/stats` (managers+, plan's analytics days; counts and times only:
  `summarize()`), settings returns `allCategories` to the owner (switch categories on/off).
  Platform console **Support** tab (`src/PlatformSupport.jsx`): all businesses' platform queries, filter by
  stage/business, reply or platform-only note, stage, priority, take it. Guide "How this works: Queries"
  (`BroadcastGuide` topic `queries`). Fix: outside 24 h, query updates are not sent to customers who replied
  STOP. Tests: m2Routes (+stats, categories routes, role checks, owner-only allCategories), q3 file (+STOP,
  +summarize). 163 tests pass, build OK, screens checked in the browser with fake data.

## Phases (each ends with tests; ONE deploy at the end of Q4 to save Netlify credits)
- [x] **Q1 Database + rules:** tables `queries` (business_id, number, **kind = customer | internal**,
      **raised_by_email + role, addressed_to = managers | owner** (internal), contact_phone (customer / linked chat), source, category, subject,
      description, priority, stage, assigned_to, escalation level, due_at, first_response_at, resolved_at,
      closed_at, rating), `query_events` (timeline: stage changes, internal notes, customer-visible replies),
      `query_categories` (per business, separate lists for customer and internal queries), `platform_queries` +
      `platform_query_events` (anything addressed to Platform support, raised by any staff role; separate so RLS
      stays simple). RLS: customer queries as decided below; internal queries visible to the raiser, the role
      they are addressed to and the Business Admin; platform admin sees ONLY platform_queries (never customer
      queries or chats); a business sees only its own platform_queries. Per-business query numbers without gaps (counter row + function).
      Re-runnable SQL + PGlite tests (cross-business, platform cannot read level-1 queries).
- [x] **Q2 Server:** create/list/get/update/assign/escalate/comment APIs, stage rules (allowed moves, Waiting
      pauses the clock, customer reply -> In progress, "not solved" -> Reopened), due-time + overdue, ownership
      (same rules as chats: agents work on own/unassigned, managers/admin on all), escalation by role.
      Customer messages: "Your query Q-1042 is registered", "...is resolved" (free text inside 24 h, an approved
      Utility template outside it). Worker (every 5 min): auto-close after 3 days resolved, overdue flags.
      Audit log. Plan limit hook (optional). Tests for every route incl. cross-business.
- [x] **Q3 Raising points** ((e) moved to Q4): (a) bot: "Raise a query" button + keyword ("complaint", "query", "help"), asks
      category (list) then a one-line description, replies with the number; (b) AI handover creates a query with
      the AI's reason; (c) Inbox side panel: "Raise query" from a chat + the contact's queries listed;
      (d) "Raise a query" button for every staff member (header): choose who it goes to (Managers / Business
      Admin / Platform support), category, subject, details, optional screenshot link and linked chat;
      (e) "My queries" list for every staff member (what I raised + what is addressed to me).
- [x] **Q4 Screens** (done, waiting for the deploy): "Queries" tab with three views — **Customer queries**, **Team queries** (internal:
      "Raised by me", "For me / my role"), **Platform support** (what my business sent to the platform) — each a
      list + board by stage (filters: stage, priority, category, assignee,
      overdue; detail with timeline, reply to customer, internal note, change stage/priority, assign, escalate),
      badges for overdue/new, Setup: categories + due times; Platform console "Support" tab (level 3 only);
      Analytics: open/overdue, average first response + resolution time, by category, satisfaction.
      "How this works" guide like Broadcasts. Then one deploy + live checks.
- [ ] **Q5 (optional) Follow-ups:** automation trigger "query resolved" (feedback request), "query overdue"
      alert to the manager.

## Decisions needed from the user (before Q1)
1. Stage names above OK? (or simpler: New / In progress / Waiting / Resolved / Closed)
2. Can customers raise a query themselves from the bot (button + keyword), or only staff/AI?
3. Default categories: hospital (Appointment, Reports, Billing, Doctor/treatment, Complaint, Other) and
   food (Order, Delivery, Payment/refund, Quality, Complaint, Other) — OK? Businesses can edit them.
4. Due times per priority (Urgent 2 h / High 8 h / Normal 24 h / Low 72 h) OK?
5. Ask customers for a 1–5 satisfaction rating after Resolved? (yes/no)
6. Should agents see all customer queries of the business, or only their own + unassigned (like chats)?
7. Internal queries: may an agent address Platform support directly for app problems, or must app problems go
   to the Business Admin first (who forwards them)? (Recommended: directly, the Business Admin still sees it.)
8. Internal categories as listed in the table above OK?

## Decisions and gotchas
- Level-3 queries live in separate tables so the platform admin never needs any access to customer data.
- Messages to customers outside WhatsApp's 24-hour window need an approved Utility template
  (e.g. `query_update`): each business must create it once (guide will explain).
- Keep Netlify credits low: no fast polling (use `useVisiblePolling`), one deploy at the end.

## Setup / deploy notes
- Q1 SQL already run on live. Next deploy (after Q4) also ships the Broadcast guides; remove `WHATSAPP_TOKEN` /
  `VERIFY_TOKEN` from Netlify once the old token is revoked in Meta.
- DEPLOYED 2026-11-07 (Broadcast guides + Q1–Q4, one deploy). Checked live: new query/support/platform
  routes answer 401 without login, forged webhook 401, dashboard and Platform console files contain the new
  screens. Still to do by the user, with real logins: raise a query from WhatsApp (QUERY), see it in
  Queries, reply, resolve, NOT SOLVED, a team query agent -> managers, a Platform support query seen in the
  console. Each business should create the `query_update` Utility template (explained in Settings).
