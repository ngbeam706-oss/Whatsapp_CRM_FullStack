-- =====================================================================
-- M3: each business connects its own WhatsApp number. Safe to re-run.
-- Run BEFORE deploying the M3 server (it only adds a column).
--
-- business_whatsapp (made in M1) holds each business's Meta details, ENCRYPTED by the
-- server. It has no browser access at all (RLS on, no policies).
-- =====================================================================

-- Last 4 characters of the access token, shown as ••••1234 so the admin can tell which one is saved.
alter table public.business_whatsapp add column if not exists token_last4 text;

-- Make sure nobody but the server can touch it (repeated from M1 on purpose).
alter table public.business_whatsapp enable row level security;
revoke all on public.business_whatsapp from anon, authenticated;

-- Check (shows no secrets):
select b.name, w.phone_number, w.phone_number_id is not null as has_number, w.access_token_enc is not null as has_token
  from public.businesses b
  left join public.business_whatsapp w on w.business_id = b.id;
