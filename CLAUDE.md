# CLAUDE.md

WhatsApp CRM for the Meta WhatsApp Business Cloud API. Built first for **Arogya Ruchulu** (healthy-food business);
now being turned into a **multi-business platform** (phases M1–M6). Live at monumental-semolina-e9f403.netlify.app.

## Start of every session
1. Read this file.
2. Read the progress file for the feature you are working on in `docs/progress/` (index: `docs/progress/README.md`).
3. Before ending a session or switching task, update that progress file (Done / Next / Decisions).

## Stack
- Frontend: React 19 + Vite + Tailwind 3 in `src/` (one file per screen, e.g. `InboxScreen.tsx`). All
  TypeScript (`.ts/.tsx`); shared shapes in `src/types.ts`, platform console shapes in `src/platformTypes.ts`.
  New files must be `.ts/.tsx`. In `catch`, use `errorMessage(err)` from `broadcastUtils.ts`.
  `src/apiClient.js` -> `apiFetch()` adds the Supabase login token to `/api` calls.
  Routing: React Router (`react-router` v7) in `src/main.tsx`; public site at `/...`. Signed-in areas per role
  (`src/appRoutes.ts`, guards in `src/Dashboard.tsx`): `/platform/<tab>` Platform Admin, `/admin/...` Business Admin,
  `/manager/...`, `/agent/...`. `AuthGate` = sign-in guard; `AreaGate` = only your own role's area ("Not allowed"
  otherwise); `ManagersOnly` in `App.tsx` guards managers' screens (plus `requireManager` on the server).
  Configuration screens live in the Settings area (`/<area>/settings/setup|whatsapp|team|lead-statuses|lead-assignment|bot-flow|keywords|ai`);
  Ads tabs are `/<area>/ads/results|manage|funnel|create|conversions|guide`. Old `/app/...` links move to the role's area.
  New screens: add to `SCREENS` + `NAV` + a `screenRoute(...)`. Never put phone numbers or other personal data in URLs.
  UI kit (`docs/progress/ui-enhancement.md`): frame in `src/AppShell.tsx` (side menu, phone tab bar, search, bell
  `/api/notifications`); building blocks in `src/ui.tsx` (`PageHeader`, `BUTTON`, `Modal`, `Drawer`, `EmptyState`,
  `SkeletonRows`); "Are you sure?" via `useConfirm()` from `src/confirm.tsx` (never `window.confirm/prompt`).
  Text: `text-xs` (13 px) is the smallest normal size; `text-2xs` only for count badges; no `text-[Npx]`.
  Data loading: `src/queryClient.js` (TanStack Query) -> `useApi(path, { refetchInterval })`, `refreshApi(prefix)`;
  never refreshes while the tab is hidden. New screens use it, not `useEffect` fetches.
- Backend: Express 5, **CommonJS `.cjs`** in `server/` (runs as-is on Netlify, no build step). Types are JSDoc:
  every `server/*.cjs` starts with `// @ts-check` and is type-checked (keep it that way for new files);
  shared typedefs in `server/types.cjs`, Express `req` additions in `server/express.d.ts`. Entry: `server.cjs` (local) and
  `netlify/functions/api.cjs` (same app on Netlify). Scheduled worker: `netlify/functions/broadcast-worker.cjs` (every minute).
- Database/Auth: Supabase (Postgres + RLS + Auth). Server writes with the service-role key (`server/db.cjs`), never sent to the browser.
- AI: provider chosen on the AI page (Claude default, also OpenAI/Gemini/compatible), keys stored encrypted (`server/secrets.cjs`, `server/llm.cjs`).

## Commands
```
npm run server   # API + webhook on :3000
npm run dev      # dashboard on :5173 (proxies /api to :3000)
npm test         # node --test tests/*.test.cjs (uses PGlite, no real DB needed)
npm run typecheck # tsc: src .ts/.tsx + server files with // @ts-check (must be clean)
npm run e2e      # Playwright smoke tests in Edge (e2e/README.md; signed-in tests need E2E_EMAIL/E2E_PASSWORD)
npm run lint     # oxlint
npm run build
```
Never rewrite source files with PowerShell `Get-Content`/`Set-Content`: Windows PowerShell 5.1 reads UTF-8 as
ANSI and garbles ₹, emoji and Telugu (and adds a BOM). Use the editor tools; `tests/encoding.test.cjs` catches it.
Windows + PowerShell environment. Git since 2026-11-13: branch `main`, remote `origin` =
github.com/ngbeam706-oss/Whatsapp_CRM_FullStack (**public**: never commit `.env`, tokens, zips or personal data;
`.gitignore` covers them). Git is at `C:\Program Files\Git\cmd\git.exe`; pushing needs the user's GitHub sign-in
(run it in the user's terminal). Commit/push only when the user asks.

## Key server files
| File | Purpose |
|---|---|
| `app.cjs` | Routes: public `/webhook` + staff-only `/api` |
| `auth.cjs` | `requireStaff`: Supabase token -> `staff_members` row -> `req.staff` {id,email,role} |
| `webhook.cjs` | Meta webhook, `X-Hub-Signature-256` check with `APP_SECRET` |
| `meta.cjs` | Send text/buttons/lists/templates via Graph API |
| `bot.cjs`, `botStore.cjs`, `defaults.cjs` | Keyword bot + catalog |
| `inbox.cjs`, `inboxRoutes.cjs` | Team inbox, 24h rule, lead ownership (`ensureCanAct`, `transferDenied`); "Done" with a reason (`closeChat`, reopens on a new message or reply) |
| `inboxMedia.cjs`, `savedReplies.cjs`, `inboxAlerts.cjs` | Inbox essentials: photos / documents / audio / video in and out (private bucket `inbox-media`, copied from Meta on first open), the team's saved replies (`/shortcut`), new-chat alerts on the business's Realtime channel (no customer details in the alert). UI `src/inboxExtras.tsx`, `src/inboxAlerts.ts` |
| `campaigns.cjs`, `broadcastRoutes.cjs`, `templates.cjs` | Broadcasts + Meta templates |
| `automations.cjs`, `automationRoutes.cjs` | Timed follow-ups |
| `analytics.cjs`, `ai.cjs`, `team.cjs`, `config.cjs` | Analytics, AI assistant, team invites, env config |
| `validate.cjs` | zod request validation: `validate({ params, body })` per route, loose body schemas, `requireObjectBody` |
| `security.cjs` | Security headers, per-address rate limits, sign-in failure guard, crash reports, JSON error handler (`docs/progress/hardening.md`) |
| `events.cjs`, `monitor.cjs` | Platform event log (`logEvent`, scrubbed, throttled), worker runs, health/alerts for the console (`docs/progress/admin-console.md`) |
| `adCreate.cjs` | Ads phase D: ready-to-create check (D1) and the create-paused / launch wizard for Click-to-WhatsApp ads (D2), Business Admin only; phase E: number per ad, placements (WhatsApp Status not for healthcare), carousel; phase G: "only during business hours" (lifetime budget + `adset_schedule`) and `editAd` (Edit dialog `src/AdEditDialog.tsx`); phase H: quick questions (ice breakers, `welcomeOf`), a tall 9:16 picture (`placementFeedFor`, falls back to one picture), video (browser -> private bucket `ad-videos` -> Meta `file_url`, own business's folder only), interests / excluded places / languages (UI `src/AdWizardExtras.tsx`); phase I: `addToCampaign` (more ads in one campaign: same ad set = shared audience/budget, or a new ad set) and existing Facebook / Instagram posts as ads (`listPosts`, `postCreativeFor`; UI `src/AdPostPicker.tsx`) |
| `adWatch.cjs` | Ads F: rejected / flagged ads with Meta's reasons (from the sync) + Ads menu badge, opt-in auto-pause over the cost limits after the hourly sync, duplicate an ad (paused copy) |
| `adConversions.cjs` | Ads E1: bookings from Click-to-WhatsApp ads sent to Meta (Conversions API for business messaging): `onStage` queue (from inbox stage changes), worker `sweep`, Ads tab "Bookings to Meta"; off by default |
| `adBilling.cjs` | Ads Billing card: Meta's payment type (prepaid / automatic), amount due, total spent, account spending limit (Business Admin sets it, audited), payment method text, payment problems (Ads badge). Read with the hourly sync + "Check now" (≤1/min), saved on `business_ad_accounts.billing`. The CRM never takes or adds money; buttons open Meta's billing page. UI `src/AdsBilling.tsx` |
| `callRecordings.cjs`, `storage.cjs` | WhatsApp call recordings: private bucket, signed upload/play links, who may listen, worker join + 90-day delete |
| `staffStats.cjs`, `staffRoutes.cjs` | My profile (personal details, own activity + rank) and team performance/ranking/member detail (managers). Onboarding details (`FIELDS`, `cleanProfile`): the Business Admin edits managers + agents, managers edit agents (`canEditProfile`, same as passwords; `PUT /team/members/:userId/profile`, audited by field name only); private fields only to the person, the Business Admin and managers for agents (`canSeeFull`); employee ID / joining date / branch not settable from My profile (except the Business Admin's own). The Business Admin's My profile also has the business details card (`src/BusinessDetailsCard.tsx`, `PUT /api/business` `details`). UI `src/StaffDetailsFields.tsx` |
| `maintenance.cjs` | Platform maintenance mode (Platform Admin switch): staff API 503 + maintenance screen; webhook/bot keep running; worker holds sending |
| `ads.cjs`, `adsRoutes.cjs`, `adsManage.cjs` | `adsManage.cjs`: Ads → Manage tab (`src/AdsManage.tsx`; campaigns / ad sets / ads from Meta live, 5-min cache, On/Off per level, rename + end date Business Admin, budget managers; `docs/progress/ads-manage.md`). Ads module: Meta ad account, hourly insights sync, cost per chat (`docs/progress/ads-module.md`) |
| `calls.cjs` | Voice calls: signed call links (random room), public `POST /api/call-ring` rings only that business's private Realtime channel |
| `whatsapp.cjs` | Each business's WhatsApp connection: `getWhatsApp(biz)` = main number; extra numbers (`whatsapp_numbers`): `whatsappFor(biz, phone)` replies from the number the customer last wrote to, `connectionForNumber`, `ownsNumber` (`docs/progress/multi-number.md`) |
| `whatsappNumbers.cjs` | Extra numbers on the WhatsApp page: add (checked with Meta) / rename / remove (history kept), Business Admin only; plan limit `max_whatsapp_numbers` |
| `signupRequests.cjs` | Public site: `GET /api/public/plans`, `POST /api/public/signup-requests` (validated, honeypot, rate limit, consent + policy version), Platform Admin approve (creates business + invite) / decline, worker prune. Pages in `src/site/` (landing at `/`, dashboard at `/app`; placeholders in `src/site/siteConfig.ts`) (`docs/progress/public-site.md`) |
| `branding.cjs` | The app's own name, logo, company and contact details (Platform console -> Branding, `/platform/branding`, `src/PlatformBranding.tsx`). Public: `GET /api/public/branding`, `GET /api/public/logo?v=` (PNG/JPEG/WebP only, checked by bytes, ≤300 KB, cached). Browser: `useBranding()` in `src/branding.ts` (defaults in `src/site/siteConfig.ts`), `BrandLogo` in `src/BrandMark.tsx`. **Application URL** (`server/siteUrl.cjs`, Branding card, owner only, `PUT /api/platform/branding/app-url`): every link the app builds to itself uses `await siteUrl()` (webhook URLs `<url>/webhook/<key>`, call links, invite / reset emails), never `config.publicSiteUrl` directly; https domain only, saved only if `<url>/api/health` answers, audited; empty = `PUBLIC_SITE_URL` |
| `returningLeads.cjs` | Returning customers: a lead writing after N days of silence (webhook, using the lead as stored before the message) gets `returned_at`, a status by TYPE (customer -> "repeat", else -> "new"), its owner re-checked (`leadAssignment.canTake`; same if available / afresh) and a timeline note; Returning filter, Analytics + Funnel counts. Names: `logLead` keeps `wa_name` and never overwrites a staff-saved `name` (`name_set_by`); rename via `inbox.updateContact { name }` (UI `src/leadNameUtils.ts`, `src/leadNames.tsx`) |
| `leadAssignment.cjs` | Automatic lead assignment (Settings -> Lead assignment, `src/LeadAssignmentScreen.tsx`): Off / Round-robin / Least busy; only unassigned chats (customer message in `webhook.cjs`, bot handover in `inbox.pauseForHandover`); skips Away / off shift / at the cap; per-number teams; one locked SQL function `assign_lead_by_rotation`; Available / Away + working hours for everyone (`/api/me/availability`, `src/Availability.tsx`) |
| `adsFunnel.cjs`, `statusHistory.cjs` | Ads -> Funnel tab (`src/AdsFunnel.tsx`, `POST /api/ads/funnel` + `/export`, managers): spend -> chats -> replied -> working -> won -> done -> repeat per campaign / ad set / ad, costs, lost reasons, reply speed, team, sources, previous period, first/last-ad attribution; status history (written on every status change) for time to convert + trend; `booking_value` for revenue / ROAS. Summary card on Analytics |
| `leadsTools.cjs` | Lead filters shared by the Inbox and the Leads page (date range by last activity in IST days, status / type, source, ad, tag, assignee, unread, number, Done, STOP), "Add lead" options (via `inbox.startConversation`), Leads page (managers only): search, CSV export (BOM, formula guard, ≤50,000, audited without data), permanent delete (typed count, ≤1,000, related data + files, audited). STOP suppression (`lead_suppressions`, HMAC of the number) re-applied on new lead / Add lead / pasted broadcast list, lifted by START. UI `src/LeadsScreen.tsx`, `src/AddLeadModal.tsx`, `src/leadFilters.tsx` + `src/leadFilterUtils.ts` |
| `leadStatuses.cjs` | Each business's own lead statuses (`whatsapp_leads.stage` = status key): label, colour, order, hidden, TYPE (`new|working|won|done|repeat|lost`). Everything automatic uses the TYPE (`inbox.nextStatus`, bookings to Meta, analytics, team ranking, Ads conversions) via `byType` / `firstOfType`; starting lists per industry; managers edit (`/api/lead-statuses`), removal needs moving its chats. UI `src/LeadStatusesScreen.tsx` (Settings -> Lead statuses), shared `src/leadStatuses.ts` (`useLeadStatuses`, `statusLook`) |
| `platform.cjs`, `platformRoutes.cjs`, `platformTeam.cjs` | Platform console API. `requirePlatformAdmin` reads the platform role from `platform_admins` on every request (removal applies at once); `requirePlatformRole(...)` per route; onboarding tracker + resend owner invite; Platform team tab (owner only: add by email with a role, change, remove; last owner protected; audited). UI `src/PlatformConsole.tsx` (tabs per role via `canOpenPlatformTab` in `src/appRoutes.ts`), `src/PlatformTeam.tsx`, `src/PlatformOnboarding.tsx` |
| `clinic.cjs`, `clinicPay.cjs`, `clinicPatients.cjs`, `clinicRoutes.cjs` | Clinic module, hospital businesses only. `clinicPatients.cjs`: patient details filled by the agent at booking (name / age / gender required), the doctor's visit page (patient, reason, case-sheet photos checked by bytes, stored private in Cloudinary (`cloudinary.cjs`: signed server uploads, type authenticated, 10-minute signed links; env CLOUDINARY_*) or the private Supabase bucket `case-sheets` without it, earlier visits with their sheets), follow-up date -> agents' Follow-ups list, My patients. Rest: (`industry = 'hospital'`; `docs/progress/clinic.md`). Managers onboard **doctors**: separate logins in `clinic_doctors`, NOT staff (`requireDoctor`, `/api/doctor/...`, area `/doctor` = `src/DoctorApp.tsx`: own queue without phone numbers + own hours / days off); managers set fees. Agents book from the chat (`ensureCanAct`, fee from the doctor, free slots only) and take payment: Razorpay payment links (Business Admin's keys, encrypted; the signed webhook `/webhook/razorpay/<key>` or "Check payment" decides paid) or desk payments (cash / UPI / card / other; discounts managers only). UI `src/AppointmentsScreen.tsx`, `src/ClinicSettingsScreen.tsx`, `src/BookAppointmentModal.tsx` |
| `waCalls.cjs`, `waCallRoutes.cjs` | WhatsApp voice calls (Calling API): webhook `calls` events -> ring the business's channel; claim (lead ownership) / accept (pre_accept + accept with browser SDP) / reject / terminate. Browser: `src/WhatsAppCallPanel.tsx`, `src/whatsappCall.ts` |

## Database migrations
`supabase/migrations/` — run in order in the Supabase SQL editor. Every migration must be **safe to re-run**
(`if not exists`, `on conflict do nothing`). Tests load them via `tests/helpers/pgHarness.cjs`.
Latest: `20261141_clinic_payment_method.sql` (clinic_appointments.payment_method: online / cash / PhonePe-UPI / card / other chosen at booking; `docs/progress/clinic.md`). Before it: `20261140_clinic_patients.sql` (clinic_patients; clinic_appointments + patient_id / reason / follow_up_*; clinic_case_sheets (photos in Cloudinary or the private bucket `case-sheets`, column provider); server-only; `docs/progress/clinic.md`). Before it: `20261139_clinic.sql` (clinic module: clinic_settings, clinic_doctors (a doctor's login reads only its own row), doctor hours / days off, clinic_appointments (one active booking per doctor slot), clinic_payments; triggers keep doctors and staff apart; server-only; `docs/progress/clinic.md`). Before it: `20261138_returning_and_names.sql` (whatsapp_leads wa_name / name_set_by / name_set_at / returned_at / returned_after_days; returning-rule settings on lead_assignment_settings; history source `returning`; `docs/progress/returning-leads.md`). Before it: `20261137_ads_funnel.sql` (lead_status_history: every status change with types, server-only; whatsapp_leads.booking_value; `docs/progress/ads-analytics.md`). Before it: `20261136_lead_assignment.sql` (rotation settings, teams per number, pointers, staff_availability, `assign_lead_by_rotation` locked function; server-only; `docs/progress/lead-assignment.md`). Before it: `20261135_leads_tools.sql` (lead_suppressions: HMAC of the number for deleted leads that replied STOP, server-only; whatsapp_leads date indexes; `docs/progress/leads-tools.md`). Before it: `20261134_lead_statuses.sql` (lead_statuses per business, server-only; whatsapp_leads.stage accepts any status key; existing businesses get today's six; `docs/progress/lead-statuses.md`). Before it: `20261133_platform_roles.sql` (platform_admins.role owner|manager|developer + added_by; owner-only writes on plans/businesses, owner-only audit read, support queries owner+manager; `platform_staff_add_existing` server-only; `docs/progress/platform-roles.md`). Before it: `20261132_inbox_essentials.sql` (whatsapp_leads closed_* "Done" columns, saved_replies table (server-only), whatsapp_messages media_* columns; `docs/progress/inbox-essentials.md`). Before it: `20261131_business_details.sql` (businesses.details jsonb: about, registered name, contact, address, GSTIN, registration no., hours; edited by the Business Admin on My profile via `server/business.cjs` `cleanDetails`; industry stays platform-set). Before it: `20261130_staff_onboarding.sql` (staff onboarding details on staff_profiles: employee ID, joining date, branch, address, emergency contact; server-only). Before it: `20261129_ads_billing.sql` (ads billing snapshot + each ad's WhatsApp number `ad_numbers` on business_ad_accounts; server-only). Before it: `20261128_platform_branding.sql` (app name, logo, company + contact details on platform_settings; server-only). Before it: `20261127_signup_requests.sql` (public sign-up requests; server-only). Before it: `20261126_ads_f_watch.sql` (ad_issues: rejected / auto-paused ads; auto_pause switch). Before it: `20261125_ads_e_conversions.sql` (bookings back to Meta: settings, datasets, event queue). Before it: `20261124_multi_number_n4.sql` (broadcast sender number, per-number bot welcome). Before it: `20261123_multi_number_n3.sql` (plan limit max_whatsapp_numbers). Before it: `20261122_multi_number_n1.sql` (extra WhatsApp numbers per business + per-number routing). Before it: `20261121_ads_d2_launches.sql` (ads created from the CRM). Before it: `20261120_ads_d1_create_ready.sql` (ad account Page + daily budget cap). Before it: `20261119_call_recordings.sql` (call recording columns + private bucket). Before it: `20261118_staff_profiles.sql` (staff personal details; server-only). Before it: `20261117_platform_settings.sql` (maintenance mode; server-only). Before it: `20261116_whatsapp_calls.sql` (whatsapp_calls; server-only). Before it: `20261115_admin_console.sql` (system_events, worker_runs, business_health; server-only). Ads files: 20261112 (A), 20261113 (B), 20261114 (C).

## Rules (do not break)
- **Tenancy:** every data table/query is scoped by `business_id`. Staff see only their own business.
- **Platform Admin never sees chat content** (messages, contacts, notes, bot/AI content) — counts/usage only. Enforce in RLS, not just UI.
  This holds for every platform role: `owner` (Platform Owner, everything) > `manager` (Application Manager: sign-ups,
  onboarding, support) / `developer` (Application Developer: health, logs, worker, delivery). Each `/api/platform`
  route names its roles (`requirePlatformRole`); plans, limits, branding, maintenance, audit and the platform team
  are owner-only; no impersonation (`docs/progress/platform-roles.md`).
- One employee = one business (`staff_members.user_id` is the primary key). Roles: `owner` (Business Admin) > `manager` > `agent`.
- Agents' passwords are set by the Business Admin or a manager (Team page); agents can't change or reset
  them ("Forgot password?" goes through `/api/auth/forgot-password`, which never emails agents).
- Doctors (clinic module) are not staff: they see only their own appointments and hours, never chats or phone numbers.
- Agents see only Inbox, Pipeline, Queries and My profile, plus Appointments in hospital businesses (not even read-only admin pages): `NAV` in `src/App.tsx`, and
  every admin page's GET route uses `requireManager` (test: `m2Routes` "agents only reach…").
- Plans: Starter / Growth / Pro (`plans` table); limits enforced **server-side**, editable by Platform Admin; per-business `limit_overrides`.
- Lead ownership: unassigned = anyone can act (first action claims it atomically); assigned to someone else = view only.
- WhatsApp 24-hour rule: outside 24h only approved templates can be sent. Follow-ups only within the business send window (default 9am–8pm IST). Respect STOP/START opt-out.
- No secrets in code, deploy zips or the browser. Webhooks must be signed (`ALLOW_UNSIGNED_WEBHOOKS` only for local tests).
- AI/bot text must never make health or cure claims or invent prices.
- Add/extend a test in `tests/` for every security, tenancy or ownership change.
- **Save Netlify credits** (Free credit plan): deploy once per finished phase, not per fix; ask before deploying.
  Worker runs every 5 minutes (`netlify.toml`); dashboard refresh only via `src/usePolling.js` (paused when the
  tab is hidden). Never add every-minute schedules or fast polling. Hosted on Netlify team `itzvijay406` (moved 2026-11-12; same site name/address).

## Reference docs
- `README.md` — features per phase and setup steps.
- `Pending Implementation List.md` — backlog with priorities (P1/P2/P3) and open housekeeping.
- `docs/progress/` — live status of in-progress work.
