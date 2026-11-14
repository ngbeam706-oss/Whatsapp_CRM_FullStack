# Ads → Manage: Campaigns / Ad sets / Ads (plan, 2026-11-14)

The user's ask: Meta Ads Manager has three levels (Campaigns, Ad sets, Ads); the CRM only shows and controls ads.
The CRM already *creates* all three for every ad (campaign "Engagement" → ad set: audience / budget / schedule /
placements / WhatsApp number → ad), and can add ads to a campaign (same or new ad set). What's missing is managing
the campaign and ad set as items of their own.

## What it will look like
New tab **Ads → Manage** (`/<area>/ads/manage`), laid out like Ads Manager:

```
[ Campaigns (12) ] [ Ad sets (18) ] [ Ads (31) ]      Search…   Last 30 days ▾   Delivery: Active / All ▾   ⟳ Refresh
☐  On/Off  Name                         Delivery     Budget        Spend   Chats  Cost/chat  Booked  Results
☐   ●━     New Awareness campaign       Active       ₹500 / day    ₹3,210    84     ₹38.2      9     …
```
- Clicking a campaign opens its ad sets (breadcrumb `All campaigns › New Awareness campaign`); clicking an ad set
  opens its ads. Ticking rows filters the next tab, like Meta.
- Every row has its own **On/Off** switch (turning a campaign off stops everything in it, as in Meta).
- Columns come from data we already have: spend / reach / clicks (hourly sync, `ad_insights_daily`, which already
  carries campaign and ad set ids) and chats / booked / cost per chat (Ads Funnel). Delivery, budget and schedule come
  from Meta live.
- Works for **every campaign in the connected ad account**, also those made in Ads Manager (Leads, Awareness, …).
  Campaigns with another goal can be switched on/off, renamed and have their budget changed; editing their audience
  stays in Ads Manager (a button opens the right page there).

## Stages
| Stage | What | Who |
|---|---|---|
| **M1** | Manage tab: three tabs, drill-down, search, delivery filter, date range, totals; On/Off for campaigns, ad sets and ads; "Open in Ads Manager" per row | read: managers; on/off: managers (as ads today) |
| **M2** | Rename campaign / ad set / ad; budget at the level where Meta keeps it (ad set or campaign budget), daily or lifetime; end date | managers for budget (as today, ≤ the existing increase cap); rename / end date: Business Admin |
| **M3** | Edit a CRM-style (Click-to-WhatsApp) ad set: locations + radius, age, gender, interests, languages, excluded places, placements, business-hours schedule; re-uses the create-wizard pieces (`src/AdWizardExtras.tsx`) and the same checks (healthcare: no WhatsApp Status placement, radius 17–80 km) | Business Admin |
| **M4** | Duplicate a campaign or ad set (paused copy, Meta `/copies`); archive a campaign | Business Admin |

## How it works (server)
- New `server/adsManage.cjs` + routes in `adsRoutes.cjs`:
  - `GET /api/ads/manage?level=campaign|adset|ad&parent=<id>&q=&delivery=&days=` → Meta
    `act_<id>/campaigns | adsets | ads` with only the needed fields (name, status, effective_status, objective,
    daily / lifetime budget, start / stop, campaign_id, adset_id, destination_type), paged, merged with our totals.
  - `POST /api/ads/manage/<level>/<id>/status` (ACTIVE / PAUSED), `PATCH …/<id>` (name, budget, end date, M3 audience).
- **Safety (same rules as today's ad controls):** every id is read back from Meta first and must belong to the
  business's connected ad account (`ownedObject`), Business Admin vs manager per action, "Are you sure?" for turning
  off a whole campaign, budget increase cap, every change audited (old → new). Tenancy as everywhere.
- **Credits / Meta limits:** Meta is read only when the tab is open or Refresh is pressed; kept 5 minutes per
  business in memory; no polling. The hourly sync is unchanged.
- No new SQL for M1–M2 (live from Meta + existing tables). M3/M4 may add an audit-only column; decided then.

## Risks / open points
- Editing an ad set's audience or placements sends its ads back to Meta review and restarts learning: the screen
  says so before saving.
- Meta error 2859024 (non-discrimination certification for the system user) still blocks *creating* ads from the
  CRM. Status, name and budget changes worked before; audience edits (M3) may hit the same rule. M3 is tried only
  after M1–M2 are live and the Meta case is solved.
- Lifetime-budget campaigns: change the amount only, never switch between daily and lifetime (Meta doesn't allow it
  after delivery started).
- 441 campaigns in the screenshot: the list defaults to "Active or delivered in the date range", with search and
  paging, so it stays quick.

## Tests to add
- Ownership: an id from another ad account is refused at every level; another business's staff can't touch it.
- Roles: agents get nothing; managers on/off + budget; rename / audience only the Business Admin.
- Turning a campaign off sends `status=PAUSED` to the campaign id only; audit row old → new.
- Totals per campaign / ad set from `ad_insights_daily` add up to the ads' totals.
- e2e: Manage tab, drill-down campaign → ad sets → ads, switch off a campaign with the confirm dialog.

## Status
M1 + M2 LIVE 2026-11-14 (deploy 6af83f79, commit b629fd0; no SQL). M3 / M4 not started (M3 waits for the Meta 2859024 case).

## Done (M1 + M2)
- `server/adsManage.cjs`:
  - `list`: Meta `<account or parent>/campaigns|adsets|ads` (only the needed fields, up to 600 per level), kept
    5 minutes per business; "Refresh" reads Meta again at most every 30 seconds.
  - Totals per level (`totalsByLevel`): Meta numbers from `ad_insights_daily` (spend, impressions, clicks, Meta chats;
    reach left out because it can't be added up over days) + CRM chats / booked by the chat's first ad.
  - Delivery filter: "Active or had results" (default) / "Active only" / "All"; search by name or ID; a drill-down
    parent must be in the connected account.
  - `setStatus`: On/Off per level; ads reuse `ads.setAdStatus`; only ACTIVE ↔ PAUSED; audited `ads.<level>_paused|resumed`.
  - `update`: one change at a time. `name` (Business Admin, 1–200 chars). `budget` (managers too): changes whichever
    budget Meta keeps on that item (daily stays daily, lifetime stays lifetime); ≤ 5x per change; clear messages when
    the budget lives on the campaign or the ad sets. `endDate` (Business Admin): 11:59 pm India time; not in the past;
    an ad set's end can be removed (`end_time=0`) unless it has a lifetime budget; a campaign's end can only be moved.
    Audited `ads.<level>_changed` with old → new.
- Routes: `GET /api/ads/manage`, `POST /api/ads/manage/:level/:id/status`, `PATCH /api/ads/manage/:level/:id`
  (managers + Business Admin, plan gate; level and id checked).
- UI: Ads → **Manage** tab (`src/AdsManage.tsx`): Campaigns / Ad sets / Ads tabs, drill-down by clicking a name,
  breadcrumb, On/Off switches (turning off a campaign or ad set asks first), budget / rename / end-date dialogs, totals
  row, "Open in Meta Ads Manager" per row.
- Tests: `tests/adsManage.test.cjs` (4: totals, list + filters + drill-down + other account refused + cache, On/Off
  only the right id + audit + archived refused, rename / budget / end-date rules and roles); e2e "Ads Manage: …".
