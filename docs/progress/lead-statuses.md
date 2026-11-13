# Lead statuses per business

**Status:** In progress (built locally 2026-11-13; NOT deployed; SQL not run yet)
**Last updated:** 2026-11-13

## Goal
Replace the six fixed pipeline stages with each business's OWN list of lead statuses (up to 12): label, colour,
order, visible/hidden and a fixed TYPE. Managers and the Business Admin edit them in Settings -> Lead statuses;
everything automatic keeps working because it uses the TYPE, never the name.

| Type | Meaning | Automatic |
|---|---|---|
| `new` | where new chats start | the built-in `new` status (renamable; can't be hidden, retyped or removed) |
| `working` | talking to them | bot: a new chat that views an item moves to the first visible `working` status |
| `won` | booked / ordered | bot "Book" / "Enquire" -> first visible `won`; conversion; bookings to Meta |
| `done` | visited / delivered | conversion; bookings to Meta |
| `repeat` | booked again | bot: booking again later -> first visible `repeat`; conversion; bookings to Meta |
| `lost` | not going ahead | — |

## Done
- [x] SQL `supabase/migrations/20261134_lead_statuses.sql` (safe to re-run): `lead_statuses` (business_id, key,
  label, hint, color, type, sort_order, active; PK business_id+key; server-only, RLS on with no policies);
  `whatsapp_leads_stage_check` now allows any key `^[a-z][a-z0-9_]{0,39}$`; check: key `new` is always type new
  and visible; every existing business gets today's six with the same names/hints/colours (so nothing changes
  until they edit). Stored values unchanged: `whatsapp_leads.stage` keeps the key; old keys keep their meaning.
- [x] `server/leadStatuses.cjs` (new): types, starting lists per `businesses.industry` (hospital / food / retail /
  services / general; same six keys, words that fit), `listFor(biz)` (cached 60 s; a business without a list gets
  its industry's list saved on first use; before the SQL: the original six, not saved), pure mapping helpers
  (`typeOf`, `canonicalStage`, `firstOfType`, `byType`, `pipelineCounts`), and the edits: add / update / reorder /
  remove (remove needs `moveTo` while chats are in it -> 409 with the count; moves them, then removes). Max 12,
  unique names, at least one visible `new`. Audited (`lead_status.added|updated|reordered|removed`, labels / field
  names only). Managers + Business Admin only.
- [x] Routes (`server/inboxRoutes.cjs`): `GET /api/lead-statuses` (all staff; chat counts for managers),
  `POST`, `PUT /order`, `PATCH /:key`, `DELETE /:key?moveTo=` (requireManager). zod: `params.statusKey`,
  `body.leadStatus`, `body.leadStatusOrder`.
- [x] By TYPE everywhere: `inbox.nextStatus` (automatic moves; `nextStage` kept as the pure core), `updateContact`
  accepts only the business's own visible statuses, Pipeline columns = the business's visible statuses (+ hidden
  ones still holding chats), inbox filter accepts any key; `adConversions.onStage` (bookings to Meta by type),
  `analytics.report` (conversion by type; pipeline = own list with labels), `staffStats` (team ranking
  conversions / open chats by type), `ads.cjs` Ads page conversions by type (2-line change).
- [x] UI: `src/leadStatuses.ts` (one cached `useApi('/api/lead-statuses')`, colours, defaults), new
  `src/LeadStatusesScreen.tsx` (Settings -> Lead statuses at `/<area>/settings/lead-statuses`: preview, rename,
  colour, kind, hide/show, up/down, add, remove with "move its N chats to…"), `src/PipelineScreen.tsx`,
  `src/InboxScreen.tsx` (filter, badge, details panel), `src/AnalyticsScreen.tsx` (labels from the server),
  `src/appRoutes.ts` + `src/App.tsx` (SCREENS + NAV + screenRoute, Business settings group).
- [x] Tests: `tests/leadStatuses.test.cjs` (type mapping incl. hidden/missing types, analytics/ads by type,
  industry lists, agents can't edit, rename never moves chats, start status rules, max 12, delete-with-chats
  refused then moved, tenancy (can't see/edit/use another business's keys), bookings to Meta by type, lazy
  seeding, migration safe to re-run + server-only + constraints); e2e `e2e/mocked.spec.js` "lead statuses: …".

## Next
- [ ] User: run `20261134_lead_statuses.sql` in Supabase (with the deploy; the old app also works after it, as
  long as nobody adds custom statuses before the new app is live).
- [ ] Deploy (ask first: Netlify credits); try renaming / adding / removing with a real business.
- [ ] Optional: Platform Owner edits the industry starting lists (today code defaults in `server/leadStatuses.cjs`).
- [ ] Optional: broadcasts / automations by status or "any status of type X" — today neither filters by stage at
  all (checked 2026-11-13), so nothing needed switching.

## Decisions and gotchas
- Keys, not labels, are stored; the six original keys stay with their meaning, so old data, tests and the
  `ad_conversions.stage` column keep working. Custom keys: `s_` + 6 hex.
- Type logic reuses the original rules: a status's type maps to the original key of that type (`canonicalStage`),
  the old rules run, and the result type lands in the business's first VISIBLE status of that type; if there is
  none, the chat stays where it is.
- An unknown / deleted key counts as type `new` and shows in the start column.
- Changing a status's type is allowed (affects analytics/ranking from then on; past Meta events are not resent).
- Re-running the old `20261110_pipeline_stages_all_businesses.sql` after custom statuses exist would fail (it
  re-adds the strict six-key check) — don't.

## Setup / deploy notes
- Run `supabase/migrations/20261134_lead_statuses.sql`. No env vars.
