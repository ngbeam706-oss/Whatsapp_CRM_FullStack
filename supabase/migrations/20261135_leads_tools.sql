-- Leads tools: inbox date filters, "Add lead", Leads page export / delete. docs/progress/leads-tools.md
--
-- 1. lead_suppressions: when a lead that had replied STOP is deleted, the business keeps a keyed hash of the number
--    (never the number itself), so that number is marked opted out again if it comes back (new message, Add lead,
--    a pasted broadcast list) and is never sent marketing. The customer writing START removes it.
-- 2. Indexes for the date filters (last activity, created).
-- Server-only. Safe to re-run.

create table if not exists public.lead_suppressions (
  business_id  uuid not null references public.businesses(id) on delete cascade,
  phone_hash   text not null check (phone_hash ~ '^[0-9a-f]{64}$'),   -- HMAC-SHA256 of the number (server secret)
  reason       text not null default 'stop' check (reason in ('stop')),
  created_by   text,
  created_at   timestamptz not null default now(),
  primary key (business_id, phone_hash)
);
alter table public.lead_suppressions enable row level security;
revoke all on public.lead_suppressions from anon, authenticated;

create index if not exists whatsapp_leads_business_active_idx  on public.whatsapp_leads (business_id, last_contacted_at desc);
create index if not exists whatsapp_leads_business_created_idx on public.whatsapp_leads (business_id, created_at desc);

-- Check:
select count(*) as suppressed_numbers from public.lead_suppressions;
