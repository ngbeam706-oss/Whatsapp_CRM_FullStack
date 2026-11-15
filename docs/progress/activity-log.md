# Activity log: complete user-action logging + Business Admin's Activity log screen

Status: **L1 + L2 + L3 BUILT 2026-11-15, not deployed, not committed.** SQL to run first:
**`supabase/migrations/20261144_activity_log.sql`** (it goes out with the customer import D3 + D4 SQL `20261143`). L4 + L5 next.

## Done (L1 + L2 + L3, 2026-11-15)
- **SQL `20261144_activity_log.sql`** (safe to re-run): `audit_log.subject_phone` (the customer an entry is about) and
  `audit_log.private_details` (sign-in device / network / session), both **unreadable by browsers**: SELECT is revoked from
  `authenticated` and granted back on the original 7 columns only, so neither "owner read own audit" nor "platform read audit" can
  expose them (and `select *` fails for browsers). Indexes for the screen and "last signed in"; a unique index makes a sign-in one
  row per session.
- **`server/activity.cjs`**: `record` / `byStaff` (forbidden keys are dropped with a warning; before SQL 20261144 it writes
  without the two new columns), `maskIp` (49.37.12.x, IPv6 /48), `deviceOf` ("Chrome on Android"), `sessionKey` (Supabase
  `session_id` after the token is checked), `whoIs` (staff / doctor / platform staff), `signedIn` (once per session, "new device" =
  a device not seen in this person's earlier sign-ins; the first ever is not flagged), `selfEvent`, `lastSignedIn`, the screen
  (`listActivity`, `exportActivity`, one sentence per action with `phrase` / `sentence`, areas).
- **Routes** (`server/activityRoutes.cjs`): `POST /api/auth/signed-in | signed-out | password-changed` (any signed-in person; the
  failed-sign-in guard + 30/min per address), `GET /api/activity` and `/api/activity/export` (Business Admin only, `requireOwner`).
  Small exports added for this: `auth.verifyStaffToken` / `extractToken`, `clinic.doctorForToken`, `platform.platformAdminForToken`.
- **L1 logged**: `team.invited` / `team.role_changed` / `team.removed` (chats returned, counted), `ai.provider_changed` (provider,
  model, key changed + last 4, key removed), `ai.settings_changed` (AI replies on/off, which parts changed; never the text),
  `whatsapp.token_changed` (access token / app secret, token last 4), `auth.signed_in` / `auth.signed_out` / `auth.password_changed`.
  The add-with-password path keeps its existing `team.member_added_with_password`. Browser: `reportAuthEvent` in
  `src/signInFlag.ts`, called from `src/AuthGate.tsx` (SIGNED_IN, before sign-out, after setting a password).
  "Last signed in" per member on the Team page (`/api/team` adds `last_signed_in` for managers and the Business Admin only).
- **L2 logged**: `chat.claimed`, `chat.transferred` (from → to; bulk = one entry per chat), `chat.done` (reason, whether a note was
  given), `chat.reopened`, `chat.bot_paused` (on/off, hours), `lead.renamed` (no name), `lead.tags_changed` (added / removed tag
  names), `lead.note_added` (no text), `broadcast.created` / `sent` / `cancelled` (name, template, sender number, audience size; no
  recipients), `automation.created` / `changed` / `toggled` / `deleted` (name, trigger, on/off), `bot.flow_changed` (part names only),
  `bot.flow_reset`, `bot.rule_saved` / `bot.rule_deleted` (counts only, no keyword), `template.created` / `deleted`,
  `ads.funnel_exported` (period, rows), `clinic.patient_changed` (field names only), `clinic.follow_up_done`. Customer = `subject_phone`.
- **L3 screen**: Settings → Activity log (`/admin/settings/activity`, `src/ActivityLogScreen.tsx`; `OWNER_ONLY` in
  `src/appRoutes.ts` hides it from managers' menus and shows "This page is for the Business Admin."). Sentences; filters (person,
  area, dates, search); 50 per page with "Load more"; CSV (`activity.exported`, audited with counts / filters); **Security** tab
  (sign-ins with device, approximate network, "New device"). Customers appear by their current name ("a deleted customer" when
  gone), never by number. Skeleton, LoadError, EmptyState; no automatic refresh.
- **Platform console**: `monitor.auditLog` selects explicit columns, so it never returns `subject_phone` / `private_details`
  (tested); sign-in network details live only in `private_details`.
- **Tests**: `tests/activityLog.test.cjs` (14): helpers; each new action written once, own business, no forbidden keys, no
  content (note text, names, numbers, keys, bot / AI text); sign-in dedupe, masking, new device, doctors and platform staff, 401;
  Team "last signed in" by role; `/api/activity` owner only, scoped, names not numbers, filters, Security tab, CSV + audit, paging;
  the console reader; SQL 20261144 column protection + one sign-in per session (PGlite). e2e: the screen (sentences, filters, CSV,
  Security tab) and a manager's "not allowed".

## Review fixes (2026-11-15, before deploy)
1. **Sign-in reported only after a real sign-in**: the sign-in form (with the returned session) or an emailed invite / reset link
   (`ARRIVED_BY_LINK` in `src/AuthGate.tsx`), once per session per tab (`reportSignInOnce` in `src/signInFlag.ts`, session id from
   the token kept in sessionStorage). Supabase's repeated `SIGNED_IN` on refocus no longer calls the server.
2. **Permanent lead delete** (`purgeLeads`, also the import Undo) clears `audit_log.subject_phone` for those numbers in that business:
   entries stay, shown as "a deleted customer".
3. **CSV export** reads in pages of 1,000, looks names up once for the whole file, holds at most the newest **5,000** entries
   (`EXPORT_MAX`; header `X-Entry-Capped`, the toast and the page help say so; the audit records `capped`).
4. **Missing columns** (before SQL 20261144) are re-checked after 5 minutes instead of latching until restart.
5. **SQL 20261144 changed (still not run)**: indexes match the queries (`order=id.desc`): `audit_log_business_id_idx (business_id, id desc)`,
   sign-ins `(business_id, id desc)` and `(actor_email, id desc)` (partial), sign-out session lookup, `created_at` for the prune;
   the earlier `audit_log_business_action_idx` / `audit_log_signins_idx` dropped `if exists`. Safe to re-run (tested).
6. **Filters in the body**: `POST /api/activity/list` and `POST /api/activity/export` (the GET routes are gone), so search words
   never sit in an address or a server log.
7. `area` checked with `Object.hasOwn` (`constructor` / `toString` no longer crash); sign-out once per session; sign-out and own
   password change share a tighter limit (5 a minute); **1-year prune** (`activity.prune`, hourly worker step `activityPrune`, every
   business and the platform's own entries); help text: the platform team sees only the actions, never customer names or numbers.
Tests: `tests/activityLog.test.cjs` (19: POST filters + odd areas, delete clears the customer, 5-minute re-check, export pages + cap,
prune, sign-out dedupe, PGlite indexes + re-run). e2e: filters in the body (no `?` in the address), refocus doesn't report a sign-in,
the sign-in form reports exactly once.

## Decisions while building
- **"scheduled" broadcasts and WhatsApp "disconnected"**: the app has neither action today (no scheduled broadcasts, no disconnect
  button), so nothing to log yet; `broadcast.scheduled` / `whatsapp.disconnected` have sentences ready for when they exist.
- **Bulk transfers** are one entry per chat (the Inbox moves several chats as single requests).
- **Own password change** is recorded after the browser's successful `updateUser` (the server checks the token; it can't see the
  password change itself). Agents can't change their own password.
- **Searching** looks at the sentences on the server (up to 2,000 entries back per page), so customer names are searchable without
  ever putting a number in the address.
- The forbidden-keys test covers every action written by the new tests (all L1 + L2 actions). Older actions (D1 / D2, platform)
  use keys like `fields[].key` (a field id, not a secret); they were not changed.

## Next
- [ ] User runs SQL `20261144_activity_log.sql` (with `20261143`), then deploy (ask first).
- [ ] CLAUDE.md: key files row (`activity.cjs`, `activityRoutes.cjs`, `src/ActivityLogScreen.tsx`) + latest migration `20261144`
      (left to the main session).
- [ ] L4 (doctor actions), L5 (a retention setting for the Platform Owner; the 1-year prune itself is done).

**User's answers (2026-11-15):**
1. Who sees the Activity log: **Business Admin only.**
2. Keep logs **1 year.**
3. Sign-ins: **store the device + approximate network (masked IP)**, as recommended.
4. Who viewed private fields: **not now** (maybe later for loan businesses), as recommended.

## 1. Where we are
- **Already logged (~80 actions)** in `audit_log`:
  - ads
  - clinic
  - customer fields / imports
  - lead statuses / assignment
  - leads export / delete
  - passwords
  - staff profiles
  - business details
  - WhatsApp numbers
  - saved replies
  - the whole Platform console
  - call recordings played
- **The table is add-only:** the browser can't insert, change or delete. Each row holds actor email + role, business, action, details (JSON) and time.
- **Missing:**
  - team invites, role changes and removals
  - AI and WhatsApp key changes
  - sign-ins
  - chat claims and transfers
  - broadcasts
  - automations
  - bot flow / keyword / template changes
  - doctor actions
  - a few smaller ones
- **No business can read its own log**: only the Platform Owner has an Audit screen.

## 2. Rules for every log entry
- **Who:** actor email + role (staff role, `doctor`, or platform role).
- **What:** business, action (`area.verb`), time, and **old → new** for settings.
- **Never the content:** no message text, no customer details, no private field values, no passwords or keys ("key changed", last 4 characters at most), no bot or AI text (the Platform Admin never sees bot content).
- **The customer a log is about** (a chat transfer, a booking…) goes in a **new column `subject_phone`** that only the server can read:
  - The Business Admin's screen shows it as the customer's name.
  - The Platform console never gets it.
  - This keeps "the Platform Admin never sees contacts".
- **Add-only** (as today). A test scans every action's details for forbidden keys (phone, body, text, value, key, token, password).

## 3. Phases

### L1: Security essentials
| Action | Logged as | Details |
|---|---|---|
| Staff invited / added | `team.invited` | email, role |
| Role changed | `team.role_changed` | email, from → to |
| Staff removed | `team.removed` | email, role, chats returned to the queue (count) |
| AI provider / model / key changed, AI auto-reply on/off | `ai.provider_changed`, `ai.settings_changed` | provider, model, "key changed", on/off; never the key or the AI instructions text |
| WhatsApp token changed / disconnected / app secret changed | `whatsapp.token_changed`, `whatsapp.disconnected` | last 4 characters only |
| **Sign-in** (staff, doctors, platform staff) | `auth.signed_in` | device (browser + OS), **approximate network (masked IP)**, first sign-in from a new device = flag |
| Sign-out | `auth.signed_out` | – |
| Password changed by the person themselves | `auth.password_changed` | – |

- **Sign-in:** recorded once per new session (the browser tells the server right after signing in; the server checks the token). The Team page shows **"Last signed in"** per member.
- **Failed sign-ins** stay in Supabase's own auth log and the existing "too many failed attempts from one address" event. No per-email failure log, because it would let someone check which emails exist.

### L2: Business accountability
| Action | Logged as | Details |
|---|---|---|
| Chat claimed / transferred / reassigned (single + bulk) | `chat.claimed`, `chat.transferred` | from → to, bulk count, subject (server-only column) |
| Chat marked Done / reopened | `chat.done`, `chat.reopened` | reason |
| Bot paused / resumed for a chat | `chat.bot_paused` | hours |
| Broadcast created / sent / scheduled / cancelled | `broadcast.*` | template name, audience size, sender number; no recipient list |
| Follow-up automation created / changed / off | `automation.*` | name, trigger, on/off |
| Bot flow / welcome / menu changed | `bot.flow_changed` | which parts changed (names only, no text) |
| Keyword rule added / changed / removed | `bot.rule_*` | keyword count, rule id |
| Message template created / deleted | `template.*` | template name, category |
| Ads Funnel CSV exported | `ads.funnel_exported` | date range, row count |
| Clinic: patient details edited, follow-up done | `clinic.patient_changed`, `clinic.follow_up_done` | field names only |
| Lead renamed, tags changed, note added | `lead.renamed`, `lead.tags_changed`, `lead.note_added` | old → new name length only (not the name), tag names, no note text |

### L3: Activity log screen (Business Admin)
- **Settings → Activity log** (`/admin/settings/activity`).
- **One sentence per action**, e.g.:
  - "Priya (manager) transferred the chat with Ravi Kumar to Arjun"
  - "Agent Arjun marked ₹500 paid by PhonePe, ref T26…"
  - "You changed Dr Rao's fee ₹500 → ₹700"
- **Filters:** person, area (Team / Chats / Leads / Broadcasts / Ads / Clinic / Settings / Security), date range, search.
- **Paging:** 50 at a time, "Load more".
- **CSV download** (audited as `activity.exported`).
- **Security tab:** sign-ins per person with device + approximate network; "new device" flagged.
- **Server route only** (`GET /api/activity`, Business Admin only), scoped by `business_id`. The `subject_phone` column is shown as the customer's current name, never the number.
- Managers: see section 5, question 1.

### L4: Doctors and the smaller items
- **Doctor:**
  - marked seen
  - follow-up date set / removed
  - hours changed
  - day off added / removed
  - signed in
- **Appointment rescheduled** (if added later), **Razorpay link resent**, **customer details viewed with private fields** (optional: who looked at a CIBIL score).

### L5: Retention and safety
- **Keep for 1 year** (setting for the Platform Owner, per plan). A daily prune runs in the existing 5-minute worker (no new schedule).
- **Platform console Audit:** keeps working, never sees `subject_phone`, and filters out sign-in network details for business staff.
- **Tests:**
  - the forbidden-keys scan
  - every new action is written exactly once
  - the Business Admin sees only their business
  - managers / agents refused
  - the Platform console never receives `subject_phone`
  - prune
  - sign-in recorded once per session

## 4. Order and size
| Phase | SQL | Size | Why this order |
|---|---|---|---|
| L1 Security essentials | 1 small migration (`subject_phone` column + its read-protection, index for activity queries) | small–medium | biggest risk first |
| L2 Business accountability | none | medium | most day-to-day value |
| L3 Activity log screen | none | medium | makes L1 + L2 visible to the business |
| L4 Doctors + small items | none | small | |
| L5 Retention + console safety | none (setting on platform settings) | small | |

Suggested: **L1 + L2 + L3 together** (the core), then L4 + L5. One deploy.

## 5. Questions for the user
1. **Who sees the Activity log?** Business Admin only (recommended), or managers too (read-only, without the Security tab)?
2. **How long to keep logs?** 1 year (recommended), 6 months, or 2 years?
3. **Sign-ins:** store device + **approximate network** (masked IP, e.g. 49.37.12.x)? Recommended yes; it helps spot a shared or stolen login.
4. **Log who viewed private fields** (e.g. who opened a CIBIL score)? Recommended: not now (it would be a lot of entries); maybe later for loans.
