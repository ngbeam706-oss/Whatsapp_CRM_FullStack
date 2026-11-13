-- Staff personal details (the "My profile" page; the Business Admin and managers see them on the Team page).
-- One row per staff member, removed with them. Server-only: the browser reads and saves through the API,
-- which shows a colleague's phone number only to managers and the Business Admin. Safe to re-run.

create table if not exists public.staff_profiles (
  user_id      uuid primary key references public.staff_members(user_id) on delete cascade,
  business_id  uuid not null references public.businesses(id) on delete cascade,
  full_name    text check (char_length(full_name) <= 80),
  phone        text check (char_length(phone) <= 20),
  job_title    text check (char_length(job_title) <= 60),
  languages    text check (char_length(languages) <= 120),
  updated_at   timestamptz not null default now()
);

create index if not exists staff_profiles_business_idx on public.staff_profiles (business_id);

alter table public.staff_profiles enable row level security;
revoke all on public.staff_profiles from anon, authenticated;
