-- Ads phase D1: getting ready to create Click-to-WhatsApp ads from the CRM.
-- The Facebook Page the business advertises as (it must be linked to the business's WhatsApp number), and
-- the most the Business Admin allows one ad to spend per day. Server-only table (no browser access).
-- Safe to re-run.

alter table public.business_ad_accounts add column if not exists page_id text
  check (page_id is null or page_id ~ '^[0-9]{5,25}$');
alter table public.business_ad_accounts add column if not exists page_name text;
-- In the account's currency (e.g. rupees), not paise. Default ₹2,000 per ad per day.
alter table public.business_ad_accounts add column if not exists max_daily_budget numeric(12,2) not null default 2000
  check (max_daily_budget > 0 and max_daily_budget <= 1000000);
