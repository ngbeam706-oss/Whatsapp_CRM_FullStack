-- Ads phase D2: Click-to-WhatsApp ads created from the CRM (wizard on the Ads page).
-- One row per ad the Business Admin creates here: what was asked for (without the image itself), the Meta
-- ids of the campaign / ad set / creative / ad, and where it is (created paused -> launched, or failed).
-- draft_id makes a retried "Create" never make two ads. Server-only (no browser access). Safe to re-run.

create table if not exists public.ad_launches (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  draft_id       uuid not null,
  created_by     text not null,
  name           text not null check (char_length(name) between 1 and 120),
  spec           jsonb not null default '{}'::jsonb,   -- text, headline, audience, budget, dates (no image bytes)
  daily_budget   numeric(12,2) not null check (daily_budget > 0),
  currency       text,
  status         text not null default 'creating'
                 check (status in ('creating', 'created', 'launched', 'failed')),
  error          text,
  campaign_id    text,
  adset_id       text,
  creative_id    text,
  ad_id          text,
  launched_by    text,
  launched_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (business_id, draft_id)
);

create index if not exists ad_launches_business_idx on public.ad_launches (business_id, created_at desc);

alter table public.ad_launches enable row level security;
revoke all on public.ad_launches from anon, authenticated;
