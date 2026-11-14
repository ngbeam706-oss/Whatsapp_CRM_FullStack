# Progress files

One file per feature or phase that takes more than one session. Claude reads the relevant file at the start
of a session and updates it before ending or switching task.

| File | Feature | Status |
|---|---|---|
| [multi-business.md](multi-business.md) | Multi-business platform (M1–M6) | In progress; basic bot flow for non-Arogya businesses LIVE 2026-11-10 (deploy 6af2b590) |
| [ads-module.md](ads-module.md) | Ads module: CTWA ad results and controls via Marketing API (phases A–F) | A–D LIVE; E (bookings to Meta, number per ad, placements incl. Status, carousel) + F′ (rejections + badge, Instagram account, auto-pause, duplicate) LIVE 2026-11-11 (deploy 6af41d25); G (billing card, business hours, edit ads, each ad's number, collapsible Needs attention) LIVE 2026-11-11 (deploy 6af45853; rerun SQL 20261129 for ad numbers); ad-account owner line + illustrated "How Meta is organised" booklet LIVE 2026-11-11 (deploy 6af46720); not yet tried against real Meta |
| [admin-console.md](admin-console.md) | Platform console monitoring: health, alerts, event log, worker runs, delivery, audit, business detail | LIVE 2026-11-09 (deploy 6af1620a); browser check with a platform-admin login next; maintenance mode built 2026-11-10 (local, needs SQL 20261117) |
| [hardening.md](hardening.md) | Production hardening: error boundaries, lazy screens, headers, rate limits (no DB) | Round 1 + round 2 (validation, e2e, /api/send fix, TanStack Query for the whole business dashboard) LIVE 2026-11-09; TypeScript migration complete in 10 rounds (every `server/*.cjs` type-checked, every `src/` file .ts/.tsx) and LIVE 2026-11-09; call page rebuilt + CSP enforced + incoming-call alerts per business (signed links, server/calls.cjs), + Meta setup guides on the WhatsApp and Ads pages; LIVE 2026-11-10 (deploy 6af2b590); OPEN (P3): calls likely don't connect (signalling timing) |
| [multi-number.md](multi-number.md) | Several WhatsApp numbers per business (one chat per customer) | N1–N4 LIVE 2026-11-10 (deploy 6af307e5): routing, inbox, manage numbers + plan limit, broadcasts/follow-ups/bot welcome/calls/ads/analytics by number; real extra number not tried yet; N5 optional |
| [public-site.md](public-site.md) | Public website (landing, pricing, sign-up requests) + Privacy (DPDP Act) / Terms / Refund / Data deletion; dashboard moved to /app | LIVE 2026-11-11 (deploy 6af44563; SQL 20261127 + 20261128 run), with role areas (/platform, /admin, /manager, /agent), Settings area and the Branding tab; Branding still to be filled in by the user |
| [inbox-essentials.md](inbox-essentials.md) | Inbox: files (photos, PDFs, audio, video), new-chat alerts, saved replies, "Done" with a reason | LIVE 2026-11-12 (deploy 6af5a812; SQL 20261132 run); real files / notifications not tried yet |
| [ui-enhancement.md](ui-enhancement.md) | UI for all roles: readable text, shared components, side menu + phone bar, home screen per role, console grouping | U0–U4 built 2026-11-13 (readable text, shared kit, in-app confirmations, side menu + phone bar, search, bell, Home "My work" + "Team today" + guided setup, inbox keys / by person / bulk, phone pipeline, campaign steps, analytics CSV, plain settings names); LIVE 2026-11-13 (deploy 6af6b305, shipped with the ads retry fix); U5 (console menu groups, overview, business search/filters) LIVE 2026-11-13 (deploy 6af6dae0, with ads Delete) |
| [queries.md](queries.md) | Query raising + stages (customer, staff, platform levels) | Q1–Q4 deployed 2026-11-07; live test with real logins next; Q5 optional |
| [returning-leads.md](returning-leads.md) | Returning customers (back after N days: status by type, owner re-checked, badge, filter, counts) + names the team saves that WhatsApp never overwrites | Built locally 2026-11-14; SQL 20261138 not run; NOT deployed |
| [lead-assignment.md](lead-assignment.md) | Automatic lead assignment: round-robin / least busy, Available / Away, working hours, per-number teams | Built locally 2026-11-14; SQL 20261136 not run; NOT deployed |
| [ads-analytics.md](ads-analytics.md) | Ads Funnel tab (A1 + A2): spend -> chats -> bookings per campaign / ad set / ad, costs, lost reasons, reply speed, time to convert, revenue and ROAS | Built locally 2026-11-14; SQL 20261137 not run; NOT deployed; A3/A4 next |
| [leads-tools.md](leads-tools.md) | Inbox last-2-days default + filters, "Add lead" by hand, Leads page with CSV export and permanent delete (STOP numbers stay blocked) | LIVE 2026-11-13 (deploy 6af711fd, commit 8a25dea; SQL 20261135 run) |
| [lead-statuses.md](lead-statuses.md) | Each business's own lead statuses (types new/working/won/done/repeat/lost) replacing the six fixed stages; Settings -> Lead statuses | LIVE 2026-11-13 (deploy 6af711fd; SQL 20261134 run) |
| [platform-roles.md](platform-roles.md) | Platform staff roles: Platform Owner / Application Manager / Application Developer, Team + Onboarding tabs | LIVE 2026-11-13 (deploy 6af711fd; SQL 20261133 run) |

## How to use
- New feature: copy `_template.md` to `<feature-name>.md` and add a row above.
- Starting a session: "Read docs/progress/<feature>.md and continue."
- Ending a session: "Update the progress file."
- Finished: set status to Done here; keep the file as a record of decisions.
