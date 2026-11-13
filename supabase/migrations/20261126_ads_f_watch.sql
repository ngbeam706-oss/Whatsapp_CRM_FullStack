-- Ads phase F: watching ads for problems. Safe to re-run; only adds.
--   ad_issues: ads Meta rejected / flagged (with Meta's reasons), and ads the CRM paused automatically because
--              they cost too much. Shown on the Ads page and as a badge on the Ads menu until someone
--              acknowledges them. A rejected ad that is fixed is removed on the next sync.
--   business_ad_accounts.auto_pause: off by default; when on, an ACTIVE ad over the alert limits (the same
--              thresholds as the cost alerts) is paused after the hourly sync.
-- Server-only (no browser access).

create table if not exists public.ad_issues (
  business_id      uuid not null references public.businesses(id) on delete cascade,
  ad_id            text not null check (ad_id ~ '^\d{1,25}$'),
  kind             text not null check (kind in ('review', 'auto_paused')),
  ad_name          text,
  status           text,
  reasons          jsonb not null default '[]'::jsonb,
  first_seen_at    timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  acknowledged_at  timestamptz,
  acknowledged_by  text,
  primary key (business_id, ad_id, kind)
);
create index if not exists ad_issues_open_idx on public.ad_issues (business_id) where acknowledged_at is null;
alter table public.ad_issues enable row level security;
revoke all on public.ad_issues from anon, authenticated;

alter table public.business_ad_accounts add column if not exists auto_pause boolean not null default false;
