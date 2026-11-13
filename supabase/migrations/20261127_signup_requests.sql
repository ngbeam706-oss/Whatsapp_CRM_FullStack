-- Public sign-up requests (the "Get started" form on the public site). A visitor asks for an account; the
-- Platform Admin approves it in the console, which creates the business and emails the Business Admin an
-- invite (no account exists until then). Personal data (DPDP Act 2023): kept only as long as needed: rejected
-- requests are deleted after 90 days, approved ones after 30 days (the business then holds the details).
-- Server-only (no browser access). Safe to re-run.

create table if not exists public.signup_requests (
  id                 uuid primary key default gen_random_uuid(),
  business_name      text not null check (char_length(business_name) between 2 and 80),
  contact_name       text not null check (char_length(contact_name) between 2 and 80),
  email              text not null check (char_length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone              text not null check (phone ~ '^\d{8,15}$'),
  industry           text not null check (industry in ('hospital', 'food', 'retail', 'services', 'general')),
  city               text check (city is null or char_length(city) <= 60),
  team_size          text check (team_size is null or team_size in ('1-5', '6-20', '21-50', '50+')),
  plan_interest      text check (plan_interest is null or plan_interest ~ '^[a-z0-9_]{2,30}$'),
  has_whatsapp_api   text check (has_whatsapp_api is null or has_whatsapp_api in ('yes', 'no', 'not_sure')),
  message            text check (message is null or char_length(message) <= 1000),
  consent_at         timestamptz not null,               -- agreed to the Terms and the Privacy Policy
  consent_marketing  boolean not null default false,     -- optional, separate (DPDP: specific consent)
  policy_version     text not null,
  status             text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  business_id        uuid references public.businesses(id) on delete set null,
  decided_by         text,
  decided_at         timestamptz,
  decision_note      text check (decision_note is null or char_length(decision_note) <= 500),
  created_at         timestamptz not null default now()
);
-- One open request per email address.
create unique index if not exists signup_requests_pending_email_idx on public.signup_requests (lower(email)) where status = 'pending';
create index if not exists signup_requests_status_idx on public.signup_requests (status, created_at desc);

alter table public.signup_requests enable row level security;
revoke all on public.signup_requests from anon, authenticated;
