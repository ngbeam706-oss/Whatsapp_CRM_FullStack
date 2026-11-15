# UI enhancement (all roles)

**Status:** U0–U4 LIVE 2026-11-13 (deploy 6af6b305, by another session with the ads retry fix); U5 built 2026-11-13, not deployed; loading states + lazy loading built 2026-11-15, not deployed; U6 optional
**Last updated:** 2026-11-15

## Goal
Make the dashboard comfortable for each role: easier to read, fewer clicks for daily work, clear "what needs me
now" on arrival, and a phone layout agents can work from all day. No change to what each role is allowed to do
(server rules stay as they are); this is layout, wording, components and per-role home screens.

## What the code shows today (scan of `src/**/*.tsx`, 64 files, ~18,000 lines)
| Finding | Evidence | Effect on users |
|---|---|---|
| Text is very small | 519 uses of 9–11 px text + 556 `text-xs` (12 px), only 197 `text-sm` (14 px). Densest: BotFlowScreen 57, InboxScreen 39, AdsScreen 34 | Tiring to read for a full shift; hard on phones and for older staff |
| Header is crowded | Logo + business + role, AI switch, "Supabase", "Webhook", "Raise a query", "New chat", sign-out, and the main menu as a second row (7 items + Settings for managers) | Technical buttons ("Supabase", "Webhook") confuse business users; the menu scrolls sideways on smaller screens |
| No home screen for any role | `/admin`, `/manager`, `/agent` all open the Inbox | Nobody sees "what needs me now" (unassigned chats, overdue queries, follow-ups due, plan limits) in one place |
| Browser pop-ups for important steps | 21 `confirm()` / `alert()` calls | Look out of place, can't explain consequences well, poor on phones |
| Each screen builds its own pieces | 21 hand-made modals/drawers, 28 different "Loading…" texts, only 11 skeletons, 14 hand-written empty states, page titles in different sizes (`text-base` vs `text-lg`) | Screens feel different from each other; waiting looks like "stuck" |
| Platform console has 11 tabs in one strip | `PLATFORM_TABS`: health … maintenance | Hard to scan; related tabs (events, worker, delivery, audit) are not grouped |
| Mobile works but is not designed for | Inbox already switches list/conversation on phones; other screens mostly shrink | Agents on phones get desktop pages squeezed |
| No dark mode, no language choice | 0 `dark:` classes; English only | Optional; some staff may prefer Telugu/Hindi |

## Plan

### U0. Foundation (all roles) — do first, everything else builds on it
1. **Readable type scale**: body 14 px; smallest text 12 px (labels, timestamps only); page title 20 px, section 16 px.
   Replace 9–11 px across screens (biggest offenders first: Bot Flow, Inbox, Ads, Broadcasts, Queries).
2. **Shared components** in `src/ui/` (all `.tsx`): `PageHeader` (title, one-line help, main action on the right),
   `Button` (primary / secondary / danger / quiet; same height everywhere), `Card`, `Drawer` and `Modal`
   (focus trap, Esc, close on backdrop), `ConfirmDialog` (replaces the 21 browser pop-ups; says what will happen and
   whether it can be undone), `EmptyState` (picture + one sentence + the next action), `Skeleton` rows/cards,
   `StatusBadge` (stages, priorities, delivery states in one style), `Toast` (success / error colour, stacks, "Undo"
   where it is safe).
3. **Colours and spacing tokens** in `tailwind.config.js` (brand teal, success, warning, danger, surfaces); one page
   width and padding for all screens.
4. **Accessibility basics**: visible keyboard focus, contrast AA for all text, every icon-only button labelled.

### U1. App shell (all business roles)
1. **Left side menu on desktop** (collapsible to icons), grouped: *Work* (Home, Inbox, Pipeline, Queries),
   *Grow* (Broadcasts, Ads, Analytics; managers+), *Settings* (managers+). Replaces the menu row in the header.
2. **Bottom tab bar on phones**: Home, Inbox, Pipeline, Queries, More.
3. **Calmer header**: business name, a search box, a bell, and a profile menu (My profile, Raise a query,
   Sign out). Move "Supabase" and "Webhook" into Settings → WhatsApp (they are setup tools, not daily work).
   "New chat" stays as the one main action.
4. **Global search (Ctrl+K)**: find a contact by name/number, a query by Q-number, a screen by name.
5. **Bell (notifications)**: new chats assigned to me, query replies, overdue items, ad problems, plan limits —
   one list instead of scattered badges (counts only, no polling faster than today's rules).

### U2. Agent — "my day, fast replies, works on a phone"
1. **Home: "My work"**: my open chats waiting for a reply (oldest first), unassigned chats I can take, my queries
   due today / overdue, follow-ups due. One tap opens each.
2. **Inbox**: filter chips (Mine, Unassigned, Waiting for us, Done); larger message text; customer details as a
   slide-in panel; saved replies on `/` with preview; keyboard shortcuts (J/K next/previous chat, R reply, E done);
   clear "24-hour window closes in 3 h" banner with the template button next to it.
3. **Pipeline on phones**: a list per stage with a "Move to…" button instead of drag-and-drop.
4. **Queries**: "Mine" as the default view; big stage buttons (In progress, Waiting, Resolved) instead of a dropdown.
5. **My profile**: my numbers for this week (chats handled, average reply time) shown as simple cards.

### U3. Manager — "is the team keeping up?"
1. **Home: "Team today"**: unassigned chats, chats waiting longest, overdue queries, each agent's open load
   and reply time, follow-ups and broadcasts running today; one-click "Assign" from the list.
2. **Inbox**: bulk select → assign / mark done; filter by agent.
3. **Broadcasts**: step-by-step wizard (Message → Who → When → Check and send) with a phone preview and the cost
   / daily-limit check on the last step; the existing guides become a "Help" side panel instead of blocks on top.
4. **Analytics**: date presets (Today, 7 days, 30 days), each chart with one-line "what this means", export CSV.

### U4. Business Admin — "set up once, then see the business"
1. **First-run onboarding**: until setup is finished, Home shows the checklist as a guided path (Business details →
   WhatsApp webhook + number → Team → Bot welcome → First template); each step opens the right screen and ticks itself.
2. **Home after setup**: everything the manager sees, plus plan usage (messages, contacts, AI replies against limits),
   payment status, WhatsApp number quality, ads spend today.
3. **Settings regrouped** with a search box: *Business* (details, branding of messages), *WhatsApp* (numbers,
   webhook, templates), *Team* (members, roles, passwords), *Bot and AI*, *Plan and billing*.
4. **Plain words**: rename technical labels ("Supabase" → "Data", "Webhook" → "Connection check", "Keywords" →
   "Auto-replies"); every settings page gets a one-line explanation under the title.
5. **Ads**: the long Ads screen split into the existing tabs with a summary card on top (spend, chats, cost per chat).

### U5. Platform Admin — "health and customers at a glance"
1. **Grouped side menu** for the 11 tabs: *Overview* (Health), *Customers* (Businesses, Sign-ups, Plans, Support),
   *System* (Events, Worker, Delivery, Audit, Maintenance), *Brand* (Branding).
2. **Overview home**: businesses active / paused / payment due, open sign-ups, open support queries (overdue first),
   alerts from health checks, worker last run.
3. **Tables**: search, sort, filters and paging on Businesses, Events, Audit, Support; a business opens in a side
   drawer (plan, usage, health) — still counts only, never chat content.

### U6. Polish (optional, later)
- Dark mode (tokens from U0 make it cheap).
- Telugu / Hindi for the staff dashboard (agents first).
- Small onboarding tour for new staff on first sign-in.

## Order, size and deploys (save Netlify credits: one deploy per phase)
| Phase | Size | Depends on | Deploy |
|---|---|---|---|
| U0 Foundation | Medium (shared components + text sizes in the 10 densest screens) | – | with U1 |
| U1 App shell | Medium | U0 | 1 deploy (U0+U1) |
| U2 Agent | Medium | U1 (Home route, bottom bar) | 1 deploy |
| U3 Manager | Medium–large | U1, U2's Home pieces | 1 deploy |
| U4 Business Admin | Medium | U3 Home | 1 deploy |
| U5 Platform Admin | Medium | U0 | can go with U4 |
| U6 Polish | Optional | U0 | later |

Server work is small: one `GET /api/home` per role (counts and short lists, scoped by business and role, same
rules as today; agents only their own and unassigned), and a notifications list. Everything else is front end.
Every phase: tests for the new routes (tenancy + role), Playwright smoke per role (`npm run e2e`), typecheck,
screenshots at desktop and phone width checked before deploy.

## Decisions needed from the user
1. **Menu**: left side menu on desktop + bottom bar on phones (recommended), or keep the top menu and only tidy it?
2. **Home screen per role** (recommended), or keep the Inbox as the first screen?
3. **Text size**: 14 px body as default (recommended); add a "Larger text" switch in My profile?
4. **Phones**: should agents be able to work fully from a phone (recommended), or is desktop the main device?
5. **Dark mode and Telugu/Hindi**: now, later (recommended: later, U6), or not needed?
6. Start with **U0 + U1** together?

## Decisions taken (2026-11-13, user: "Yes, start U0 + U1" = the recommended choices)
Side menu + phone tab bar; home screen per role (U2–U4); readable text + a "Larger text" switch; agents can work
from a phone; dark mode and Telugu/Hindi later (U6).

## Done
- [x] Plan written from a code scan.
- [x] **U0 (2026-11-13, not deployed)**
  - Text: `tailwind.config.js` `xs` = 13 px (was 12), new `2xs` = 11 px for count badges only. 492 tiny sizes in
    dashboard files changed (9/8 px -> `text-2xs`, 10–11.5 px -> `text-xs`) by a UTF-8-safe node script; picture
    files keep theirs on purpose (`guideVisuals`, `BotFlowPhone`, `MetaOrgGuide`, public site `src/site/`).
  - "Larger text" (+12.5%, all rem sizes): `html.text-large` in `src/index.css`, `applyLargeText` in `src/ui.tsx`,
    applied before first paint in `src/main.tsx`; switch in the account menu / phone "More".
  - Removed `user-select: none` from `body` (staff could not copy numbers or messages). Visible keyboard focus.
  - Shared kit `src/ui.tsx`: `BUTTON` (primary/secondary/danger/quiet), `PageHeader`, `Card`, `EmptyState`,
    `SkeletonRows`, `Modal` and `Drawer` (Esc, focus kept inside, focus returns after).
  - `src/confirm.tsx`: `ConfirmProvider` (in `main.tsx`) + `useConfirm()` / `confirm.ask()`; all 21 browser
    `confirm`/`prompt` pop-ups replaced (Broadcasts, Automations, AI key, Team, Ads x5, Ads billing, Bot Flow x3,
    saved replies, Maintenance, Branding, Sign-ups x2, console suspend x2). Test id `confirm-ok`.
- [x] **U1 (2026-11-13, not deployed)** — `src/AppShell.tsx`, `App.tsx`
  - Desktop: side menu `nav "Main menu"` grouped Work (Inbox, Pipeline, Queries) / Grow (Broadcasts, Ads,
    Analytics) / Settings (the settings pages themselves) / You (My profile); narrow-to-icons toggle
    (remembered). The Settings area's own menu now shows on phones only.
  - Phones: bottom tab bar (Inbox, Pipeline, Queries, More); "More" drawer has the rest + Raise a query, Larger
    text, Sign out. Page content keeps room (`pb-16`), toasts sit above the bar.
  - Header: business + role, search button, AI switch/badge, bell, New chat, account menu (My profile, Raise a
    query, Larger text, Sign out). "Supabase" and "Webhook" left the header: now "Data and sync" and "Webhook
    details" buttons on Settings → WhatsApp (and in search).
  - Search (Ctrl+K / Cmd+K): contacts by name or number (inbox search, 2+ letters, opens the chat without
    putting the number in the address), pages for this role, actions.
  - Bell: `GET /api/notifications` (`server/notifications.cjs`): counts only, per role (agent: own chats with
    unread + unassigned unread, own overdue queries, new unassigned queries; manager/owner: whole business +
    team queries addressed to them), plus ad problems and plan notices. Refreshes every 60 s while visible
    (`REFRESH.notifications`). Badges on Inbox / Queries / Ads menu items.
  - Found by the browser tests: the Bot Flow guide (fixed bottom-left) covered the side menu -> moved to
    `md:left-60` (and above the phone tab bar); on phones the header's New chat is hidden (Inbox has "+").
  - Checked: 451 unit tests, typecheck, build, mocked e2e 43/43 (screenshots in `test-results/`).
  - Tests: `tests/notifications.test.cjs` (scoping, counts only, per-role filters, waiting never overdue),
    `/api/notifications` in the m2Routes cross-business list; e2e `mocked.spec.js` + `smoke.spec.js` updated
    for the side menu, account menu and in-app confirmations.

- [x] **U2 Agent (2026-11-13, not deployed)**
  - **Home "My work"** for every role (`src/HomeScreen.tsx`, view `home` at `/<area>/home`, first menu item,
    the area's start page; `/app` now lands there). `GET /api/home` (`server/home.cjs`): my chats waiting
    for a reply (longest first), unread chats nobody has taken, my open customer queries (soonest due),
    new queries I can pick up (escalated-above-my-level ones left out), team queries I raised that wait
    for MY answer, and today's numbers (replies sent since midnight IST, chats assigned to me, my overdue
    queries). Refresh 30 s while visible (`REFRESH.home`). Rows open the chat (no number in the address)
    or the query (Queries screen `openQueryId`).
  - **Search "Q-1042"** (Ctrl+K): `GET /api/queries/by-number/:n` (`queries.findByNumber`, same
    visibility as the list) -> opens the query.
  - **Inbox keys**: J/K next/previous chat, R reply box, / search box, Esc back to the list (ignored while
    typing or when a pop-up is open). Fixed on the way: the Inbox's own pop-ups (Send template, New chat)
    never closed with Esc; now they do (`useEscape` in `src/ui.tsx`), as do the query and support panels.
  - **Pipeline on phones**: stage chips, one stage at a time at full width (desktop board unchanged).
  - **Queries**: Anyone / Mine / Unassigned chips; query detail has one-tap buttons Working on it /
    Waiting for reply / Mark resolved / Reopen (the rest under "More stages").
  - Tests: `tests/home.test.cjs` (scoping, own items only, escalated not offered, IST day start, Q-number
    search visibility), `/api/home` + `/api/queries/by-number` in m2Routes; e2e: new "U2 Home" test (home
    rows, quick stage buttons, Q-number search, inbox keys, phone pipeline); landing-page expectations
    moved from Inbox to Home. 454 unit tests, mocked e2e 44/44.

- [x] **U3 Manager (2026-11-13, not deployed)**
  - **Home "Team today"** (managers + Business Admin, above "My work"): `GET /api/home/team` (`requireManager`,
    `server/home.cjs teamToday`): chats waiting for a reply, waiting and nobody's yet, overdue customer queries,
    broadcasts sending now; "Waiting longest" list (anyone's) with an **Assign** menu per chat (normal
    `PATCH /api/inbox/:phone`, so ownership rules apply); "Who has what" table per person (chats, waiting,
    oldest waiting, replies today, open queries) with **View chats** -> the Inbox filtered to that person.
  - **Inbox (managers)**: "Everyone's chats / <person>" filter (`GET /api/inbox?assignee=`, server-side) and
    **Select** mode: tick chats (or Select all) -> Assign to… / Nobody, or Mark done… with a reason (asks
    first). Each chat goes through the normal routes one by one; failures are reported, not hidden.
  - **Broadcasts**: new campaign is 3 steps (Message -> Who gets it -> Check and send) with the phone preview
    always on the right; step 3 shows name, from-number, template, how many people, rough cost, daily-limit
    warning, test send, then Send / Save as draft. Next is disabled with the reason shown until a step is done.
  - **Analytics**: "Today" preset, a plain "what this tells you" line under each chart, **Download CSV**
    (headline numbers, leads per day, team; made in the browser; text cells that start with = + - @ are
    neutralised so they can't run as spreadsheet formulas).
  - Tests: `home.test.cjs` (+Team today: per-person counts, longest waiting, overdue, this business only),
    m2Routes (`/api/home/team` refused to agents; `/api/home/team` and `/api/inbox?assignee=` in the
    cross-business list); e2e new "U3 managers" test, broadcast multi-number test walks the 3 steps.
    455 unit tests, mocked e2e 45/45.

- [x] **U4 Business Admin (2026-11-13, not deployed)**
  - **Home "Get your business ready"** (managers + Business Admin) until every step of the existing checklist
    (`/api/business/checklist`) is done: progress bar, each step with a plain reason, the next one highlighted
    with **Start**, the rest **Open**; steps the Business Admin must do are marked for managers. Hidden once done.
  - **Home "Your business"** (Business Admin): WhatsApp connected (+number) / not connected (Connect button), and
    the plan / usage / payment card (`UsageCard` from SetupScreen).
  - **Settings**: side menu groups "Business settings" (Setup, WhatsApp, Team) and "Bot & AI" (Bot Flow,
    Auto-replies, AI assistant). Renamed "Keywords" -> **Auto-replies** (page title + plain help line, guide
    texts updated) and "AI" -> **AI assistant**. Every settings page has a one-line explanation.
  - **Guides aside**: while a create form is open on Broadcasts (new campaign, template, follow-up), the long
    "How this works" guide shrinks to a **How this works** button that opens it in a side panel (`BroadcastGuide
    compact`, `GuideBody`). Lists still show the full guide.
  - Accessibility: `Modal` / `Drawer` now named by their title (`aria-labelledby`).
  - Decision: no number-quality check on Home (it calls Meta each time); "Test connection" on the WhatsApp page
    does that on demand. No separate Settings search: Ctrl+K search already finds every settings page.
  - Gotcha: while working, `src/BroadcastsScreen.tsx` was overwritten on disk once after an edit (an editor with
    the file open?): the lost prop was found by the browser test and put back.
  - Tests: e2e new "U4 Business Admin" test (setup guide Start -> next step's page, business card, settings
    groups, Auto-replies page, guide side panel opens/closes with Esc); renamed pages updated in all e2e tests.
    455 unit tests, mocked e2e 46/46.

- [x] **U5 Platform Admin (2026-11-13, not deployed)** — `src/PlatformConsole.tsx` only, no server change
  - **Grouped menu** (`nav "Console menu"`): side menu on desktop, scrolling row on phones; groups Overview
    (Health), Customers (Businesses, Sign-ups, Plans, Support), System (Logs, Worker, Delivery, Audit,
    Maintenance), Brand (Branding). Badges: sign-ups waiting, open support queries (loaded once; Refresh reloads).
  - **Overview** tiles on Health: active, paused, payment due, WhatsApp not connected, sign-ups waiting, open
    support (+ overdue); each opens the place to act (Businesses opens pre-filtered). Counts only.
  - **Businesses**: search by name/slug, filter chips (All / Active / Paused / Payment due / No WhatsApp), sort
    (newest, name, most contacts, most messages this month); the business name opens the details drawer.
  - Not done (decided): Events / Audit already have their own business + level filters and paging ("older"), so
    no extra search was added there.
  - Tests: e2e new "U5 Platform console" test (groups, badges, tiles, filter from a tile, search, sort, name ->
    drawer). 456 unit tests, mocked e2e 47/47.

### Loading states and lazy loading (built 2026-11-15, not deployed, not committed)
Goal: no screen ever shows a blank area while loading; every load has a skeleton shaped like its content,
a visible error with "Try again", and an empty state where relevant.
- **UI kit** (`src/ui.tsx`): `Skeleton`, `SkeletonRows` (now with `data-testid="skeleton"`), `SkeletonCards`
  (number tiles), `SkeletonForm` (settings forms), `SkeletonTable`, `SkeletonBoard` (Pipeline), `SkeletonChat` /
  `SkeletonConversation` (Inbox), `SkeletonPage({ kind })` (whole screen: list / cards / form / table / board /
  chat), `AppFrameSkeleton` (top bar + side menu, for whole areas), `SiteSkeleton` (public site),
  `DialogLoading` (pop-up whose code is downloading), `LoadError({ error, onRetry })` (reason + "Try again",
  busy while retrying, `data-testid="load-error"`), `Spinner`. Every skeleton is `role="status"` with a label
  and pulses only with `motion-safe:` (off when the system asks for less motion).
- **Route fallbacks**: no `fallback={null}` left. `main.tsx`: the dashboard is lazy now (visitors of the public
  site never download it), fallback `AppFrameSkeleton`; public site fallback `SiteSkeleton`. `Dashboard.tsx`:
  Platform console and doctor area fall back to `AppFrameSkeleton`. `App.tsx`: each screen route has its own
  Suspense with a skeleton shaped like the screen (`SKELETON_OF`: Home / Analytics / Ads = cards, Inbox = chat,
  Pipeline = board, Leads = table, settings forms = form, others = rows). `ScreenLoading` (ErrorBoundary.tsx) is
  now `SkeletonPage`.
- **Sign-in** (`AuthGate.tsx`): "Checking your sign-in…" shows inside the app frame skeleton with a spinner. A
  failed staff lookup (network) now shows "Could not check your sign-in" + "Try again" instead of the wrong
  "No dashboard access".
- **Bot pages** (App.tsx): a failed `/api/bot-catalog` or `/api/bot-rules` load shows "Try again" instead of an
  empty editor (which could have saved over the real bot); Auto-replies waits for the rules (skeleton).
- **Lazy loading** (build sizes, `npm run build`, before -> after):

  | Chunk | Before | After |
  |---|---|---|
  | `main` (first download on every page) | 267.8 kB (gzip 74.6) | 65.5 kB (gzip 21.7) |
  | `Dashboard` (signed-in areas, new chunk) | in main | 91.3 kB (gzip 26.6) |
  | `InboxScreen` (was in main) | in main | 69.8 kB (gzip 18.8) |
  | `AdsScreen` | 193.7 kB (gzip 50.2) | 54.6 kB (gzip 15.1) |
  | `AdsCreateReady` + wizard / `MetaOrgGuide` / `AdsManage` / `AdConversions` (Ads tabs, lazy) | in AdsScreen | 83.8 / 36.0 / 13.8 / 7.3 kB |
  | `PlatformConsole` | 96.5 kB (gzip 23.3) | 61.9 kB (gzip 15.2) |
  | Platform tabs Signups / Branding / Team / Onboarding / Support (lazy) | in console | 6.0 / 12.0 / 5.0 / 4.4 / 9.7 kB |
  | Raise a query / Data and sync / Webhook pop-ups (lazy, `DialogLoading`) | in main | 5.3 / 6.8 / 2.6 kB |

  Kept eager on purpose: `CallModal` and `WhatsAppCallPanel` (an incoming call must ring at once).

Per role, what changed:

| Role / area | Screens | Loading | Error + retry | Empty state |
|---|---|---|---|---|
| Sign-in | AuthGate | app frame + "Checking your sign-in…" | network failure -> "Try again" | – |
| Agent | Home | tiles + rows (team panel rows) | `LoadError` (both panels) | "All caught up" (existing) |
| | Inbox | chat-list rows (was "No conversations here" while loading), conversation bubbles (was "Loading…") | list + open chat | existing per filter |
| | Pipeline | column board (was "Loading…") | yes | new "No contacts yet" + Add lead |
| | Queries | rows, insights tiles, settings form (was "Loading…"; settings never left "Loading…" on failure) | list, insights, settings | `EmptyState` "No queries here" |
| | Query panel, customer queries in chat | rows (was "Loading…") | panel closes with the reason (existing); chat card retries | existing |
| | Appointments (hospitals) | rows (existing) | `LoadError` now with retry | existing |
| | My profile | tiles + form (was "Loading…") | yes | – |
| Manager / Business Admin | Leads | table skeleton | yes | existing "No leads match" |
| | Broadcasts (campaigns, templates, automations, details) | rows (list was blank while loading) | yes (details also keep "Back") | existing texts |
| | Analytics | tiles + rows (was "Loading…") | yes | – |
| | Ads (results, manage, funnel, create, conversions, guide) | tiles + rows; each tab lazy with rows | yes on every tab | new "No ad results yet" |
| | Settings: setup, WhatsApp (+ numbers), team (+ performance, member), lead statuses, lead assignment, clinic, AI, business details | rows / form skeletons (numbers card was blank) | yes | existing |
| | Settings: bot flow, auto-replies | form / rows while the bot loads | yes (new) | existing |
| Doctor | My appointments, visit page, My patients, patient file, My hours | rows; hours = form | `LoadError` with retry everywhere (was text only) | existing |
| Platform (all roles) | console frame, Health/overview, Businesses, Sign-ups, Onboarding, Plans, Support (+ query panel), Events, Worker, Delivery, Audit, Branding, Maintenance, Team, business drawer | app frame while the role loads; tiles / rows / forms (Events, Worker, Delivery, Audit, Maintenance were blank) | every panel, and the console's own role check | existing |

- **Busy buttons**: almost every save already showed "Saving…" + disabled; fixed WhatsApp numbers "Save welcome".
  Not changed: the Bot Flow editors save through App's fire-and-forget handlers (toast on result).
- **Tests**: e2e `mocked.spec.js` "loading states" × 5 (agent: sign-in check, Home, Inbox list, open chat,
  Pipeline; manager: lazy screen code fallback, failed load -> "Try again" works, Leads table + empty state,
  WhatsApp settings form; sign-in check failure -> retry; doctor; platform console). They hold an address
  with `holdRoute()` and assert the skeleton, then release it. The "every tab" smoke test and the settings-area
  test also wait for skeletons to finish.

## Next
- [ ] Deploy U5 + loading states (ask first).
- [ ] Optional: Bot Flow save buttons with a busy state (needs the save handlers in App.tsx to return promises).
- [ ] User report 2026-11-13: "navigating to another page opens a new tab". Not reproduced: app links have no
      new-tab target (only links to Meta / files do), live public pages and every e2e menu click stay in one
      tab, no service worker. Waiting for which page / link / browser.
- [ ] U6 (optional): dark mode, Telugu/Hindi, first sign-in tour.
- [ ] Home greeting uses the email's first part; could use the profile's full name later.

## Decisions and gotchas
- Never rewrite source with PowerShell (encoding); bulk edits go through node scripts or exact swaps.
- Both the side menu and the phone tab bar are labelled "Main menu": only one is visible at a time, and
  Playwright / screen readers ignore the hidden one.
- The bell never shows names or message text (counts only), same as the rule for alerts.
