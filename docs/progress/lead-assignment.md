# Automatic lead assignment (round-robin / least busy)

**Status:** In progress (built locally 2026-11-14; NOT deployed; NOT committed; SQL not run yet)
**Last updated:** 2026-11-14

## Goal
New chats go to the team automatically instead of "first action claims": Round-robin (take turns) or Least busy
(fewest open, not-Done chats). Off by default. Only unassigned chats are ever given out.

## Done
- [x] SQL `supabase/migrations/20261136_lead_assignment.sql` (safe to re-run, server-only): `lead_assignment_settings`
  (mode off|round_robin|least_busy, max_open, per_number), `lead_assignment_members` (team per number; '' = all
  numbers; order), `lead_assignment_pointers` (whose turn it was), `staff_availability` (available, days, start/end
  hour, India time), function `assign_lead_by_rotation` (locks the business's settings row, conditional update
  `assigned_to is null`, moves the pointer; service key only).
- [x] `server/leadAssignment.cjs` (new): pure rules `onShift` (own days/hours, else the business's send window; night
  shifts wrap) and `pickCandidates` (skips Away, off shift, at the cap, people no longer on the team; least busy sorts
  by open chats), `teamFor` (per-number team, else the default team), `assignIfDue` (never throws; timeline note
  "Assigned to X by rotation"; the person's existing `inbox_assigned` alert), `view` / `save` (managers + Business
  Admin; audited with field names), `myAvailability` / `setMyAvailability` (everyone, for themselves).
- [x] When it assigns: every customer message on an unassigned chat (new chat, chat reopened from Done, chat from an
  ad) — `server/webhook.cjs` after `inbox.onInbound`; a bot "talk to staff" handover — `inbox.pauseForHandover`.
  "Add lead" by hand is unchanged (the person who adds it, or whom they pick).
- [x] Routes (`server/inboxRoutes.cjs`): `GET|PUT /api/lead-assignment` (requireManager), `GET|PUT /api/me/availability`.
- [x] UI: new `src/LeadAssignmentScreen.tsx` (Settings -> Lead assignment, `/<area>/settings/lead-assignment`: mode,
  max open chats, per-number teams, rotation team with order and each person's state, "No one in this team is
  available right now"), `src/Availability.tsx` (account-menu Available / Away switch; My profile card with days and
  hours), `src/AppShell.tsx`, `src/ProfileScreen.tsx`, `src/appRoutes.ts` + `src/App.tsx`.
- [x] Tests: `tests/leadAssignment.test.cjs` (on shift, candidates, per-number teams, the SQL function on PGlite:
  fair turns, never reassigns, one assignee when two messages race, server-only; API: Off unchanged, agents 403,
  Available / Away, round-robin with Away skipped, nobody available, cap + least busy, per-number teams, tenancy);
  e2e "Lead assignment: …" and "Available / Away: …".

## Next
- [ ] User: run `20261136_lead_assignment.sql`.
- [ ] Deploy (ask first) and try with two staff logins.
- [ ] Optional: "reassign if no reply in N minutes" in the existing 5-minute worker (never a faster schedule).

## Decisions and gotchas
- Nobody available (all Away / off shift / at the cap / empty team): the chat stays unassigned, as before; the
  settings screen shows "No one … is available right now".
- The SQL function takes the whole team (rotation order) and the people who may get a chat now; the pointer advances
  to the next available person after the last one assigned, so turns stay fair when someone is away.
- Least busy counts open (not Done) chats; before the inbox SQL (20261132) every assigned chat counts.
- Timeline note author is `rotation` (a lead note), so it shows in the chat's notes.

## Setup / deploy notes
- Run `supabase/migrations/20261136_lead_assignment.sql`. No env vars. No new schedules.
