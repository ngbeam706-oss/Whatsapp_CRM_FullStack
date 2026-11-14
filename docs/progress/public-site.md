# Public website, legal pages and sign-up requests

## Status
LIVE 2026-11-11, deploy 6af44563.
- SQL 20261127 and 20261128 were already run (checked read-only before the deploy).
- The same deploy shipped: the Bot Flow redesign and guide, the ads Page-number check fix, the per-screen
  addresses / role areas / Settings area, and the Branding tab.
- Before the deploy: 381 unit tests and 48 e2e passed (3 skipped: need a real login).
- After the deploy (live): /, /privacy, /signup, /admin/ads (sign-in when signed out), /platform/branding,
  /api/public/plans and /api/public/branding answer 200; /api/inbox answers 401 without login.
- Plans' prices are 0 on live, so Pricing shows "Talk to us": set the prices in Platform console -> Plans.

## Done
- Addresses: public site at `/`, `/features`, `/pricing`, `/contact`, `/signup`, `/privacy`, `/terms`,
  `/refund-policy`, `/data-deletion`. The dashboard moved to **`/app`** (`src/main.tsx` picks which to load).
  - A signed-in visitor at `/` is sent to `/app`.
  - Supabase invite / reset links that land on a public page (`#access_token=…`, `?code=`) are moved to `/app`
    first, so old links keep working.
  - Netlify already serves index.html for every path.
- Files:
  - `src/site/`: `PublicSite.tsx` (header/footer, page titles), `MarketingPages.tsx`, `SignupPage.tsx`,
    `LegalPages.tsx`, `signupRules.ts`, `siteConfig.ts`, `siteNav.ts`, `SiteUi.tsx`.
  - Loaded lazily, so the dashboard bundle doesn't grow.
- **Placeholders:** brand, company, address, CIN/GSTIN, emails, phone, Grievance Officer and court city are
  `[...]` values in `src/site/siteConfig.ts`. While any remain, legal pages show a yellow "draft" banner.
- Privacy Policy (DPDP Act 2023): fiduciary vs processor roles, data collected, purposes, consent and
  withdrawal, sharing (Meta, Supabase, Netlify, AI providers), cross-border transfers, retention periods, security,
  breach notice, rights (access, correction, erasure, grievance, nominate), children, Grievance Officer and the
  Data Protection Board. Also Terms, Refund policy, Data deletion page.
- Sign-up = **request, not instant account**: `POST /api/public/signup-requests` (`server/signupRequests.cjs`).
  - The Platform Admin approves in the console's new **Sign-ups** tab (`src/PlatformSignups.tsx`). Approving
    creates the business on the chosen plan and emails the contact a Business Admin invite; declining keeps a note.
  - Validation is the same in the browser (`signupRules.ts`) and on the server; one test runs the same cases
    against both.
  - Phone is normalised (Indian 10-digit -> 91…, other countries need +). The form suggests fixes for email typos.
  - Consent to the Terms and the Privacy Policy is required, with the time and policy version stored.
    Marketing consent is optional.
  - Spam protection:
    - a hidden honeypot field, and a minimum of 3 s to fill the form; both get a silent "thank you"
    - 5 requests an hour per network
    - a repeat request for an email that is still open gets the same "thank you", so the form never reveals
      who applied
  - Retention: the worker deletes approved requests after 30 days and declined ones after 90 days (hourly).
  - Table `signup_requests` is server-only (RLS on, no grants).
- `GET /api/public/plans`: plan names, prices and limits from the `plans` table, no login needed.
- Tests: `tests/signupRequests.test.cjs` (9), `e2e/public.spec.js` (6), plus a CSP test for the public pages.
  Dashboard e2e tests now open `/app`.

- 2026-11-11: React Router for the whole app.
  - Every dashboard screen has its own URL (`src/appRoutes.ts`), so a refresh / Back / bookmark keeps the screen
    (the user's report: a refresh on Ads went back to the Inbox).
  - `/app/*` needs sign-in (AuthGate). Managers' screens show "Not available for your role" to agents.
  - Unknown addresses get "Page not found" (public and dashboard).
  - Menu items are links (open in a new tab works).
  - e2e: "each screen has its own address…", "protected routes…".
- 2026-11-11 (later): role areas instead of one /app.
  - Addresses are `/platform/<tab>`, `/admin/...`, `/manager/...` and `/agent/...`. Another role's area shows
    "Not allowed for your role" (`src/Dashboard.tsx`). Old `/app/...` links move to your own area.
  - New Settings area with a side menu: Setup, WhatsApp, Team, Bot Flow, Keywords, AI.
  - Ads tabs have their own addresses; `/…/ads` opens the tab used last.
  - Platform console tabs have their own addresses; `/platform` opens Health.
  - e2e: role-area tests (agent, manager, platform admin), Settings menu, console links. The e2e helper is
    `openScreen(page, name)`.
  - Invite and reset emails still land on the site root -> /app -> the role's area.

- 2026-11-11: Branding tab in the Platform console (`/platform/branding`).
  - Fields: app name, tagline, logo, registered company, address, CIN, GSTIN, court city, support / sales /
    privacy emails, phone, hours, Grievance Officer.
  - Stored on `platform_settings` (SQL 20261128); `server/branding.cjs`.
  - Shown on: the public site (header, footer, titles, contact page), the legal pages (the "draft" note goes once
    the required fields are set), the sign-in page, and the dashboard header (app logo + the business's name).
  - The logo is served from our own address with a versioned, year-long cache; only PNG, JPEG and WebP are
    accepted, checked by their bytes (no SVG), at most 300 KB.
  - Public read is cached for 60 s in browsers and 120 s on Netlify's CDN.
  - Tests: `tests/branding.test.cjs` (6), e2e "platform console Branding", "branding from the console shows
    everywhere".
  - `src/site/siteConfig.ts` now holds only defaults.
- **Application URL (2026-11-14, local, not deployed; no SQL):**
  - **What it is:** Platform console → Branding → "Application URL" card, Platform Owner only. Every link the app
    builds to itself starts with it (`server/siteUrl.cjs` `siteUrl()`):
    - each business's WhatsApp webhook URL `<url>/webhook/<key>` (the key itself never changes),
    - customers' call links,
    - invite and password-reset email redirects.
  - **Checks when saving:** https domain only (no path, port, IP or local address), and it is saved only when this
    app answers at `<url>/api/health`. An "Are you sure?" explains that every business must paste its new webhook
    URL into Meta and that the domain must be added in Supabase. Audited old → new.
  - **Where it is stored:** `platform_settings.branding.appUrl`. The details save keeps it. Empty means
    `PUBLIC_SITE_URL` (default: the Netlify address).
  - **Not built:** a list of the businesses whose Meta app still calls the old address.
  - **Tests:** `tests/siteUrl.test.cjs`.

## Next
- User: run SQL 20261128, fill in Platform console -> Branding, have the legal text reviewed by a lawyer, decide
  the refund terms.
- Run SQL 20261127, deploy (ask first).
- Account deletion within 90 days of closure (promised in the Privacy Policy) is a manual step today; automate
  later if needed.

## Decisions
- Request-and-approve sign-up (user's choice), so no self-serve accounts and no payment flow yet.
- Placeholders instead of invented company details.
- Bug found by the tests: `logEvent` source `platform` doesn't exist; it uses `system`.
