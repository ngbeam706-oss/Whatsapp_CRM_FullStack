# Returning customers + names the team saves

**Status:** In progress (built locally 2026-11-14; NOT deployed; NOT committed; SQL 20261138 not run yet)
**Last updated:** 2026-11-14

## Goal
1. A lead that writes again after a long silence is treated as returning: its status moves by type, its owner is
   re-checked, it is visible ("Back after 4 months", Returning filter) and counted apart from new leads.
2. Names the team saves are never overwritten by WhatsApp profile names; the WhatsApp name is kept alongside.

## Done
- [x] SQL `supabase/migrations/20261138_returning_and_names.sql` (after 20261137; safe to re-run): `whatsapp_leads`
  `wa_name`, `name_set_by`, `name_set_at`, `returned_at`, `returned_after_days` (+ index); backfill `wa_name = name`
  (not for plain numbers); `lead_assignment_settings` `return_enabled` (default on), `return_days` (30, 7–365),
  `return_status_customers`, `return_status_others`, `return_owner` (same|afresh); status history source `returning`.
- [x] Names: `server/db.cjs` `logLead` — a profile name always updates `wa_name`; `name` only while `name_set_by` is
  empty; a new contact gets both (before the SQL: the old upsert). `inbox.updateContact { name }` — same rules as other
  chat changes (`ensureCanAct`: a chat someone else has is view only, managers too; they can reassign it), ≤80 chars, no
  `< >`, trimmed; empty = back to the WhatsApp name. Add lead: a typed name is the saved name. Search looks at both names
  (once the column is known to exist). Leads export: "WhatsApp name" column (+ "Came back (date)").
- [x] Returning: `server/returningLeads.cjs` (new) `apply` — called in `server/webhook.cjs` after `inbox.onInbound` with
  the lead as it was BEFORE this message (`loadContact` now reads `last_inbound_at`, `assigned_to`), before the rotation.
  Silence ≥ N days: marks `returned_at` / `returned_after_days`; status by TYPE (customer -> first visible "repeat";
  new / working / lost -> first visible "new"; each switchable) with a status-history row and the usual bookings-to-Meta
  check; owner: "same person if available" keeps them only if on the team (in the rotation team when rotation is on),
  available, on shift and under the cap (`leadAssignment.canTake`), else (or "assign afresh") unassigned — the
  rotation then assigns it; timeline note. Shorter silence: nothing changes.
- [x] Filters + reports: `returning` in `server/leadsTools.cjs` filters (came back in the date range); Analytics
  `kpis.returningLeads` (shown under New leads); Ads funnel `returning` (ad leads that came back in the period, apart
  from new chats).
- [x] UI: `src/leadNameUtils.ts` (`useRenameLead`, `returnedLabel`, `otherWaName`), `src/leadNames.tsx`
  (`ReturnedBadge`, `RenameButton`); Inbox row badge, chat header (name + ✏️ + "WhatsApp: …" + badge), details panel ✏️,
  Pipeline card ✏️ + badge, Leads page ✏️ + badge + WhatsApp name; Returning checkbox in the shared filters;
  Settings -> Lead assignment "Returning customers" card; Analytics + Funnel counts.
- [x] Tests: `tests/returningAndNames.test.cjs` (webhook never overwrites a saved name / updates wa_name / new contact,
  rename rules, Add lead name, status by type, same agent kept, away / removed / afresh unassigned, switch off, shorter
  silence / rule off / new contact unchanged, tenancy, settings 403 + range, filter + funnel counts, migration);
  `tests/multiNumber.test.cjs` search pattern allows the WhatsApp name; e2e "Inbox: rename a contact …".

## Next
- [ ] User: run `20261138_returning_and_names.sql` (after 20261136 and 20261137).
- [ ] Deploy (ask first) and try: rename a chat, then send a message from that phone; a lead quiet for > 30 days writes.
- [ ] Optional: let managers rename a chat that someone else has (today: view only, like every other chat change).

## Decisions and gotchas
- The rule is ON by default (30 days) once the SQL is run; before it, nothing happens (no columns).
- "Back after …" shows for 30 days after the return.
- Win-back follow-ups stop on a reply as before (`campaigns.trackReply`); nothing extra needed.
- The chat header's name block now keeps a minimum width (it collapsed to nothing with the details panel open).

## Setup / deploy notes
- Run `supabase/migrations/20261138_returning_and_names.sql`. No env vars, no new schedules.
