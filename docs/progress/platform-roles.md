# Platform roles (Platform Owner / Application Manager / Application Developer)

**Status:** In progress (built locally 2026-11-13; NOT deployed; SQL not run yet)
**Last updated:** 2026-11-13

## Goal
Let the platform owner add staff under them with least privilege: Application Managers handle sign-ups,
business onboarding and platform support queries; Application Developers look after the system. Nobody but the
Platform Owner touches plans, prices, limits, branding, maintenance or the platform team. No role ever sees a
business's chats, contacts, notes or bot/AI content.

| Role (UI) | key | Can | Can't |
|---|---|---|---|
| Platform Owner | `owner` | everything, incl. the Platform team tab (all existing platform admins) | — |
| Application Manager | `manager` | Overview, Businesses (read plan; create a business), Onboarding tracker, Sign-ups (approve/decline), Support (answer, assign, close; Mine/Unassigned), "Check WhatsApp", resend the owner's invite | plans, limits, business status/plan/paid-until, branding, maintenance switch, audit log, platform team, health/logs |
| Application Developer | `developer` | Health, Logs, Worker, Delivery, Businesses read-only + details, "Check WhatsApp" | sign-ups, support, onboarding, plans, branding, maintenance switch, audit, team, creating businesses |

## Done
- [x] SQL `supabase/migrations/20261133_platform_roles.sql` (safe to re-run): `platform_admins.role`
  (`owner|manager|developer`, default owner, check) + `added_by`; helpers `platform_role()`, `is_platform_owner()`;
  RLS: plans and businesses writable by the owner only (every role reads businesses); audit log readable by the
  owner only; platform support queries/events readable by owner + manager only; `platform_staff_add_existing()`
  (service key only; the M1 trigger still refuses business staff).
- [x] Server `server/platform.cjs`: `requirePlatformAdmin` now reads the role from `platform_admins` with the
  server key on EVERY request (only the token -> login check is cached 60 s), so removal / role changes apply at
  once on every instance; falls back to "owner" before the SQL is run. `requirePlatformRole(...roles)` (owner
  always allowed). `req.platformAdmin = { id, email, role }`. `audit()` adds `details.platformRole`.
  `onboarding()` (businesses of the last N days + `business.checklist` yes/no steps + owner email) and
  `resendOwnerInvite()` (invite again, or "set your password" email if the login exists; 10 min gap; audited).
- [x] `server/platformRoutes.cjs`: every route names its roles (see the header comment). Business details drop
  `recentAudit` for non-owners. New routes: `GET /me` (role), `GET /onboarding`, `POST /businesses/:id/resend-invite`,
  `GET /support-assignees`, `GET|POST /team`, `PATCH|DELETE /team/:id`.
- [x] `server/platformTeam.cjs` (new): list / add by email with a role (Supabase invite, or an existing login via the
  SQL helper) / change role / remove. Can't change or remove yourself; last Platform Owner can't be removed or
  demoted; removing someone puts their open support queries back to unassigned. All audited
  (`platform.staff_added|staff_role_changed|staff_removed`).
- [x] Support queries (`server/queries.cjs`): `platformListAll` `who=mine|unassigned`; assigning only to an owner or
  manager (checked); assignment event is platform-only (the business doesn't see which person); replies, notes,
  stage, assignment and priority audited (`support.*`, never the reply text). Sign-up approve/decline audited with
  the role (`signup.approved|rejected`).
- [x] Console UI: `src/appRoutes.ts` (`PLATFORM_TABS` + overview/onboarding/team, `canOpenPlatformTab`,
  `PLATFORM_HOME`), `src/PlatformConsole.tsx` (role from `/api/platform/me`; menu per role; other tabs show "Not
  allowed for your role"; only allowed data is loaded; Businesses/Drawer hide owner-only controls),
  `src/PlatformTeam.tsx` (new, Team tab, with a "use two-factor" recommendation note), `src/PlatformOnboarding.tsx`
  (new, Onboarding tracker), `src/PlatformSupport.tsx` (All / Mine / Unassigned, Assign-to list),
  `src/PlatformMonitor.tsx` (drawer: `canEdit`, "Resend owner invite").
- [x] Tests: `tests/platformRoles.test.cjs` (API per role, chat data never reachable, audit rows, last owner,
  removal stops access on the next request, SQL rules in PGlite); e2e `e2e/mocked.spec.js` "platform roles: …"
  (menus per role, Not allowed pages, no forbidden API calls, Team tab actions).

- [x] Sync pass (2026-11-13, after the SQL was run live and checked: role column, helper functions present, the one
  existing admin is owner): business-side query timeline shows "Platform support" instead of the individual
  platform person's email (`src/QueryDetail.tsx`); branding + maintenance audits go through `platform.audit`
  (with the role); `server/types.cjs` platformAdmin type; "Not allowed" page says "platform staff".
- 2026-11-14 (local, not deployed; no SQL): **Business details** card in Businesses → a business: name + business
  type (Healthcare / Food / Retail / Services / Other) for the Platform Owner **and the Application Manager**
  (`PATCH /api/platform/businesses/:id/details`, `platform.updateDetails`, audited `business.details_changed`
  from → to). Changing the type asks first and says what changes (Healthcare = Clinic tools + Meta's healthcare ad
  rules; leaving Healthcare hides the Clinic tools and blocks doctors' sign-in, data kept). Plan, status, paid-until
  and limits stay Platform Owner only. Test `tests/platformBusinessDetails.test.cjs`.

## Next
- [ ] User: run `20261133_platform_roles.sql` in the Supabase SQL editor (before or with the deploy).
- [ ] Deploy (ask first: Netlify credits), then try each role with a real separate login.
- [ ] Optional: enforce two-factor for platform staff (Supabase MFA) — only a note in the Team tab for now.

## Decisions and gotchas
- Role is read per request (not cached) so "removing a platform staff member stops access immediately" holds across
  Netlify instances; the cost is one small DB read per console request (low traffic).
- Managers may create a business directly ("New business") because approving a sign-up does exactly that; they
  can't change a business's plan, limits, status or paid-until afterwards.
- When approving a sign-up, a manager picks the plan (the prospect's choice by default), like the owner does.
- Known flaky (not this feature): `tests/multiNumber.test.cjs` "N4 bot…" gets ECONNRESET in the full parallel
  `npm test` run but passes alone (2026-11-13).
- Every role can read the maintenance state (the console strip), only the owner switches it.
- `actor_role` in `audit_log` stays `platform_admin` (Audit tab filter); the platform role is in `details.platformRole`.
- No impersonation / "log in as a business" exists or was added.
- Tests: `_setPlatformAdminForToken(token, { id, email, role? })` pins a role (no DB read);
  `_setLoginForToken(token, { id, email })` makes the role come from `platform_admins` like production.

## Setup / deploy notes
- Run `supabase/migrations/20261133_platform_roles.sql`. Existing platform admins become Platform Owners.
- No new env vars. Invites use Supabase Auth (same mailer limits as business invites).
