-- =====================================================================
-- Ads phase A: which Click-to-WhatsApp ad each contact came from.
--
-- Run once in Supabase -> SQL Editor BEFORE deploying the matching app update
-- (the inbox and analytics read the new columns). Safe to re-run.
--
-- When a customer taps a Click-to-WhatsApp ad, their first message carries a
-- `referral` (ad id, headline, ...). The server already saves it on the contact.
-- This adds:
--   * first_ad_*  : the ad that FIRST brought the contact (never changes once set)
--   * last_ad_*   : the most recent ad they came through
--   * source      : where the contact first came from; later messages no longer
--                   overwrite it (before, an ad lead became "Direct WhatsApp" on
--                   their second message).
-- Rows stay scoped by business_id with the existing RLS; the Platform Admin still
-- cannot read contacts.
-- =====================================================================

alter table public.whatsapp_leads add column if not exists first_ad_id       text;
alter table public.whatsapp_leads add column if not exists first_ad_at       timestamptz;
alter table public.whatsapp_leads add column if not exists first_ad_headline text;
alter table public.whatsapp_leads add column if not exists last_ad_id        text;
alter table public.whatsapp_leads add column if not exists last_ad_at        timestamptz;
alter table public.whatsapp_leads add column if not exists last_ad_headline  text;

create index if not exists whatsapp_leads_first_ad_idx on public.whatsapp_leads (business_id, first_ad_id) where first_ad_id is not null;
create index if not exists whatsapp_leads_last_ad_idx  on public.whatsapp_leads (business_id, last_ad_id)  where last_ad_id  is not null;

-- Backfill from referrals already saved (only rows not filled yet).
update public.whatsapp_leads
   set first_ad_id       = referral->>'source_id',
       first_ad_at       = coalesce(created_at, now()),
       first_ad_headline = left(nullif(referral->>'headline', ''), 200),
       last_ad_id        = referral->>'source_id',
       last_ad_at        = coalesce(last_contacted_at, created_at, now()),
       last_ad_headline  = left(nullif(referral->>'headline', ''), 200)
 where first_ad_id is null
   and nullif(referral->>'source_id', '') is not null
   and coalesce(referral->>'source_type', 'ad') = 'ad';

-- Keep first touch fixed and record each new ad referral.
create or replace function public.whatsapp_leads_ad_touch() returns trigger
language plpgsql set search_path = public as $$
declare
  ad text;
  hl text;
begin
  if tg_op = 'UPDATE' then
    if old.first_ad_id is not null then
      new.first_ad_id       := old.first_ad_id;
      new.first_ad_at       := old.first_ad_at;
      new.first_ad_headline := old.first_ad_headline;
    end if;
    if old.source is not null then
      new.source := old.source;
    end if;
  end if;

  if new.referral is not null and (tg_op = 'INSERT' or new.referral is distinct from old.referral) then
    ad := nullif(new.referral->>'source_id', '');
    if ad is not null and coalesce(new.referral->>'source_type', 'ad') = 'ad' then
      hl := left(nullif(new.referral->>'headline', ''), 200);
      new.last_ad_id       := ad;
      new.last_ad_at       := now();
      new.last_ad_headline := hl;
      if new.first_ad_id is null then
        new.first_ad_id       := ad;
        new.first_ad_at       := now();
        new.first_ad_headline := hl;
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists whatsapp_leads_ad_touch on public.whatsapp_leads;
create trigger whatsapp_leads_ad_touch
  before insert or update on public.whatsapp_leads
  for each row execute function public.whatsapp_leads_ad_touch();

-- Check: contacts that came from an ad, per business.
select business_id, count(*) filter (where first_ad_id is not null) as from_ads
  from public.whatsapp_leads group by business_id;
