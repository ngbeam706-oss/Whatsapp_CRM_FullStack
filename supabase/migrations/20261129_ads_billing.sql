-- Ads billing card: what Meta says about the ad account's payments (prepaid or automatic, amount due, total spent,
-- account spending limit, payment method text, payment problems). Read from Meta with the hourly ads sync (and on
-- "Check now"), kept here so the Ads page and the Ads menu badge don't call Meta on every visit.
-- The CRM never takes or adds money: payments happen in Meta's billing pages.
-- business_ad_accounts stays server-only. Safe to re-run; only adds.

alter table public.business_ad_accounts add column if not exists billing jsonb;
alter table public.business_ad_accounts add column if not exists billing_checked_at timestamptz;

do $$ begin
  alter table public.business_ad_accounts add constraint business_ad_accounts_billing_object check (billing is null or jsonb_typeof(billing) = 'object');
exception when duplicate_object then null; end $$;

-- Also: the WhatsApp number each ad opens ({ "<ad id>": { "n": "919...", "p": "<page id>" } }), read with the hourly
-- sync from the ad set's promoted object, so every ad on the Ads page shows its number.
alter table public.business_ad_accounts add column if not exists ad_numbers jsonb;
do $$ begin
  alter table public.business_ad_accounts add constraint business_ad_accounts_ad_numbers_object check (ad_numbers is null or jsonb_typeof(ad_numbers) = 'object');
exception when duplicate_object then null; end $$;
