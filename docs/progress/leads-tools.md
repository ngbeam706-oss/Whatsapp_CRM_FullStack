# Leads tools: inbox filters, Add lead, Leads page (export / delete)

**Status:** In progress (built locally 2026-11-13; NOT deployed; NOT committed; SQL not run yet)
**Last updated:** 2026-11-13

## Goal
The inbox opens on the last 2 days with more filters; every role can add a lead by hand (a phone call, walk-in…);
managers and the Business Admin get a Leads page to export (CSV) and permanently delete leads, with numbers that
replied STOP staying blocked after deletion.

## Done
- [x] SQL `supabase/migrations/20261135_leads_tools.sql` (safe to re-run): `lead_suppressions` (business_id +
  HMAC-SHA256 hash of the number, server-only), indexes `whatsapp_leads (business_id, last_contacted_at desc)` and
  `(business_id, created_at desc)`.
- [x] `server/leadsTools.cjs` (new): shared filters (`cleanFilters`, `rangeBounds` in India-time days, `filterParts`:
  range by last activity, status / status type, source, ad (first or last), tag, assignee (me / unassigned / a person
  for managers), unread, WhatsApp number, Done, STOP, search), `filterOptions` (this business's sources, tags, ads),
  Leads page `search` / `exportCsv` / `deleteLeads`, STOP suppression (`phoneHash`, `isSuppressed`, `suppressedAmong`,
  `reapply`, `unsuppress`), CSV helpers (`csvCell`: quotes, new lines, formula guard `= + - @` -> `'`; `toCsv`: UTF-8 BOM).
- [x] Inbox (`server/inbox.cjs` `listConversations` `extra` filters; `/api/inbox?range=…&source=…`), `GET /api/inbox-filter-options`.
- [x] Add lead: `/api/inbox/start` now takes source (Phone call, Walk-in, Referral, Website form, Other), status, tags,
  note (saved as a lead note), assignedTo (agents: only themselves, default themselves; managers: anyone on the team).
  Existing number -> `existed: true` (opens it). Plan contact limit. Event `contact_events.lead_added` (by, source).
  No WhatsApp message is sent. A suppressed number comes back opted out.
- [x] Leads page API (requireManager): `POST /api/leads/search`, `POST /api/leads/export` (selected `phones` or
  `filters`; columns; max 50,000; CSV download; `leads.exported` audit = who, count, filters (search shown only as
  "(search)"), columns), `POST /api/leads/delete` (`confirmCount` must equal the count; max 1,000; removes messages,
  notes, events, follow-up runs, broadcast recipients, number windows, calls, ad conversions, files in `inbox-media` and
  call recordings (this business's folder only); unlinks queries; suppression for STOP numbers first; `leads.deleted`
  audit with count + filters).
- [x] Suppression checked in: webhook (a new lead from a suppressed number -> opted out), Add lead, broadcasts with a
  pasted list (`campaigns.resolveAudience`), `campaigns.isOptedOut` (manual / follow-up checks); START (`setOptOut(false)`)
  removes it. Follow-ups and broadcasts by filter only ever use existing leads (deleted ones have no rows left).
- [x] UI: `src/leadFilterUtils.ts` (types, `useStoredState` in localStorage per person, `useFilterOptions`),
  `src/leadFilters.tsx` (`MoreFilters`), `src/AddLeadModal.tsx` (Inbox + Pipeline + Leads), `src/InboxScreen.tsx`
  ("Showing the last 2 days · Show all", Filters panel, Add lead button; a search looks at all dates),
  `src/PipelineScreen.tsx` (Add lead), new `src/LeadsScreen.tsx` (`/<area>/leads`, managers only: filters, select some /
  all matching, Export dialog with columns, Delete with "type the number" confirmation), `src/appRoutes.ts` + `src/App.tsx`.
- [x] Tests: `tests/leadsTools.test.cjs` (CSV escaping + formula guard + BOM, date ranges, agents 403, inbox filters,
  export own business only + audit without data, delete removes related data + files, other business untouched, STOP
  suppression blocks sending / comes back on Add lead / START lifts it, 1,000 cap, Add lead dedup / agent self only /
  plan limit / bad source, migration server-only); e2e "inbox: last 2 days…", "Leads page (managers)…", "Leads page: agents…".

## Next
- [ ] User: run `20261135_leads_tools.sql` (after 20261133 and 20261134).
- [ ] Deploy (ask first: Netlify credits) and try with real data: export opens in Excel with Telugu, delete a test lead.
- [ ] Optional: share the date filter with the Pipeline.

## Decisions and gotchas
- Suppression stores an HMAC of business_id + number keyed with `SETTINGS_ENCRYPTION_KEY` / `APP_SECRET` (a plain hash
  of a 10-digit number is easy to reverse). Changing that secret makes old suppressions unmatched — keep it stable.
- Date range = last activity (`last_contacted_at`) in India-time calendar days ("last 2 days" = today + yesterday).
- The inbox's range is ignored while searching (an old chat must still be findable).
- Export is a POST that returns the CSV; filters and selected numbers are in the body, never the address.
- Queries are the team's record: deleting a lead unlinks them (contact_phone = null) rather than deleting them.

## Setup / deploy notes
- Run `supabase/migrations/20261135_leads_tools.sql`. No env vars.
