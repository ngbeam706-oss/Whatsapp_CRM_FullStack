-- =====================================================================
-- Ads phase C: alert thresholds per business (pausing ads and changing budgets need no
-- new tables: they go straight to Meta and are written to audit_log).
--
-- Run once in Supabase -> SQL Editor (after 20261113_ads_b_accounts_insights.sql),
-- BEFORE deploying the matching app update. Safe to re-run.
-- business_ad_accounts stays server-only (RLS on, no browser grants).
-- =====================================================================

alter table public.business_ad_accounts add column if not exists alert_max_cost_per_chat       numeric(12,2);
alter table public.business_ad_accounts add column if not exists alert_max_cost_per_conversion numeric(12,2);
alter table public.business_ad_accounts add column if not exists alert_window_days             smallint not null default 3;

alter table public.business_ad_accounts drop constraint if exists business_ad_accounts_alert_window_check;
alter table public.business_ad_accounts add constraint business_ad_accounts_alert_window_check
  check (alert_window_days between 1 and 14);
alter table public.business_ad_accounts drop constraint if exists business_ad_accounts_alert_values_check;
alter table public.business_ad_accounts add constraint business_ad_accounts_alert_values_check
  check (coalesce(alert_max_cost_per_chat, 1) > 0 and coalesce(alert_max_cost_per_conversion, 1) > 0);

-- Repeated on purpose: server-only.
alter table public.business_ad_accounts enable row level security;
revoke all on public.business_ad_accounts from anon, authenticated;

-- Check:
select business_id, ad_account_id, alert_max_cost_per_chat, alert_max_cost_per_conversion, alert_window_days
  from public.business_ad_accounts;
