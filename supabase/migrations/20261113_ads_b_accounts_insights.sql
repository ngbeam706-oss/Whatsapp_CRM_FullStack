-- =====================================================================
-- Ads phase B: each business connects its Meta ad account; the server syncs ad results
-- (spend, impressions, clicks, conversations) about once an hour.
--
-- Run once in Supabase -> SQL Editor (after 20261112_ads_a_lead_source.sql),
-- BEFORE deploying the matching app update. Safe to re-run.
--
-- Both tables are SERVER-ONLY (RLS on, no policies, no browser grants), like
-- business_whatsapp: the ad-account token is stored encrypted, and staff read results
-- only through the server, which checks role (owner/manager) and plan.
-- The Platform Admin cannot read them either.
-- =====================================================================

-- 1. Plan switch: Ads module included? (Growth and Pro on the first run only, so a
--    Platform Admin's later edits are not undone when this file is run again.)
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'plans' and column_name = 'ads_enabled') then
    alter table public.plans add column ads_enabled boolean not null default false;
    update public.plans set ads_enabled = true where id in ('growth', 'pro');
  end if;
end $$;

-- 2. One ad account per business ------------------------------------------------------
create table if not exists public.business_ad_accounts (
  business_id        uuid primary key references public.businesses(id) on delete cascade,
  ad_account_id      text not null unique check (ad_account_id ~ '^act_[0-9]{5,25}$'),
  name               text,
  currency           text,
  timezone_name      text,
  access_token_enc   text not null,
  token_last4        text,
  graph_api_version  text,
  connected_by       text,
  connected_at       timestamptz not null default now(),
  last_sync_at       timestamptz,
  last_sync_error    text,
  updated_at         timestamptz not null default now()
);

alter table public.business_ad_accounts enable row level security;
revoke all on public.business_ad_accounts from anon, authenticated;

-- 3. Ad results per ad per day ---------------------------------------------------------
create table if not exists public.ad_insights_daily (
  business_id      uuid not null references public.businesses(id) on delete cascade,
  ad_account_id    text not null,
  date             date not null,
  ad_id            text not null,
  ad_name          text,
  adset_id         text,
  adset_name       text,
  campaign_id      text,
  campaign_name    text,
  effective_status text,
  spend            numeric(14,2) not null default 0,
  impressions      bigint not null default 0,
  reach            bigint not null default 0,
  clicks           bigint not null default 0,
  conversations    int not null default 0,   -- Meta: messaging conversations started (7-day)
  currency         text,
  updated_at       timestamptz not null default now(),
  primary key (business_id, ad_id, date)
);
create index if not exists ad_insights_daily_business_date_idx on public.ad_insights_daily (business_id, date);

alter table public.ad_insights_daily enable row level security;
revoke all on public.ad_insights_daily from anon, authenticated;

-- Check (no secrets):
select p.id, p.ads_enabled from public.plans p order by p.sort_order;
select b.name, a.ad_account_id, a.name as ad_account, a.last_sync_at, a.last_sync_error
  from public.businesses b left join public.business_ad_accounts a on a.business_id = b.id;
