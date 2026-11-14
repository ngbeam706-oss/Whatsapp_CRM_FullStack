# Ads conversion analytics (Funnel tab), phases A1 + A2

**Status:** In progress (A1 + A2 built locally 2026-11-14; NOT deployed; NOT committed; SQL 20261137 not run yet)
**Last updated:** 2026-11-14
Part of the Ads module (`docs/progress/ads-module.md`). Builds on `server/ads.cjs` (Meta's daily insights in
`ad_insights_daily`) and the CRM's own leads (`first_ad_id` / `last_ad_id`, statuses by TYPE).

## Goal
For managers and the Business Admin: from money spent to bookings, per campaign -> ad set -> ad, with costs per step,
what is lost and why, how fast the team replies, and (A2) how long it takes to convert and the money it brings back.

## Done
- [x] A1 (no new data) — `server/adsFunnel.cjs` (new), pure `buildFunnel`:
  spend -> impressions -> clicks -> chats started (Meta) -> chats in the CRM -> replied by the team (a staff message;
  the bot doesn't count) -> working -> won -> done -> repeat (+ lost), % between steps; cost per chat / working /
  won / done; first-ad (default) or last-ad attribution; lost reasons per campaign (inbox "Done" reasons); first-reply
  speed bands with booking rates; team results on ad leads; ads vs other sources (`bySource`, new leads in the
  period); previous-period comparison; filters campaign / status type / handled by / source (source applies to the
  comparison table); CSV per campaign, ad set and ad (`csvOf`: BOM + formula guard via `leadsTools.toCsv`).
- [x] A2 (SQL `supabase/migrations/20261137_ads_funnel.sql`, safe to re-run, server-only): `lead_status_history`
  (from / to key + TYPE, when, by, source staff|bot|added|bulk) written by `server/statusHistory.cjs` from
  `inbox.updateContact`, `inbox.applyStageEvent` (bot), `inbox.startConversation` (Add lead with a status) and
  `leadStatuses.remove` (chats moved); steps count "ever reached" (history) or the current type; median days to book
  per campaign; daily trend (spend vs bookings). `whatsapp_leads.booking_value` (asked, optional, when a chat moves
  to a Booked / Done kind of status in the Inbox; PATCH `bookingValue`) -> revenue per campaign and return on ad
  spend; an empty value uses the business's average from "Bookings to Meta" (`ad_conversion_settings.booking_value`).
- [x] Routes (`server/adsRoutes.cjs`): `POST /api/ads/funnel`, `POST /api/ads/funnel/export` (requireManager + the
  plan's Ads gate; POST so filters like a person's email stay out of addresses). Aggregates only; Platform roles never
  reach `/api` business routes.
- [x] UI: new `src/AdsFunnel.tsx` (Ads -> Funnel tab, `/<area>/ads/funnel`; KPIs with change vs the previous period,
  steps, campaign -> ad set -> ad table with lost reasons and days to book, reply speed, sources, team, daily trend,
  CSV; "history starts from the day this update was installed"), `AdsFunnelSummary` card on Analytics,
  `src/AdsScreen.tsx` (tab), `src/InboxScreen.tsx` (booking amount prompt), `src/types.ts`.
- [x] Tests: `tests/adsFunnel.test.cjs` (funnel math with custom statuses, ever-reached from history, reply speed,
  agents, attribution toggle, filters, average value, zero divisions, sources, period, CSV, agents 403, tenancy, no
  numbers in the answer, history on every change path, booking value checks, migration); e2e "Ads Funnel tab: …".

## Next
- [ ] User: run `20261137_ads_funnel.sql` (history starts that day).
- [ ] Deploy (ask first) and check with the real ad account once Meta data is synced.
- [ ] A3: Meta breakdowns (age, gender, region, placement) per ad.
- [ ] A4: pause / scale suggestions from cost per booking and trends.
- [ ] Optional: ask the booking amount on the Pipeline too (today: Inbox details panel only).

## Decisions and gotchas
- Status steps count by TYPE (each business names its own statuses). "Reached" = the highest of the current type and
  any history entry after the chat started; a lead that was booked and then lost counts in both Booked and Lost.
- A chat is credited to the ad by the chosen attribution and is in the period when that ad's time (`first_ad_at` /
  `last_ad_at`) falls in it; spend is by Meta's day (India time).
- Revenue counts booked-or-later leads that are not lost; no value and no average = not counted (ROAS shows "–").
- Ads from another ad account or deleted ads show as "Ads from another account or deleted".

## Setup / deploy notes
- Run `supabase/migrations/20261137_ads_funnel.sql`. No env vars, no new schedules, nothing asked of Meta.
