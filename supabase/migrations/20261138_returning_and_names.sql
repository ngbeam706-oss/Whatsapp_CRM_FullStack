-- Returning customers + names the team saves. docs/progress/returning-leads.md
--
-- 1. Names: `name` = the name shown everywhere. Once staff save a name (name_set_by / name_set_at) WhatsApp never
--    overwrites it; `wa_name` = the WhatsApp profile name, updated on every customer message.
-- 2. Returning: a lead that writes again after N days of silence (default 30) is marked returned_at /
--    returned_after_days; its status moves by TYPE and its owner is re-checked (lead_assignment_settings return_*).
-- Run after 20261137. Safe to re-run.

alter table public.whatsapp_leads add column if not exists wa_name text;
alter table public.whatsapp_leads add column if not exists name_set_by text;
alter table public.whatsapp_leads add column if not exists name_set_at timestamptz;
alter table public.whatsapp_leads add column if not exists returned_at timestamptz;
alter table public.whatsapp_leads add column if not exists returned_after_days int;
create index if not exists whatsapp_leads_business_returned_idx on public.whatsapp_leads (business_id, returned_at desc) where returned_at is not null;

-- The WhatsApp name we have today is the stored name (staff couldn't edit names before this).
update public.whatsapp_leads set wa_name = name
 where wa_name is null and name is not null and name !~ '^\+?\d+$' and name not in ('WhatsApp User', 'WhatsApp Contact');

-- The returning rule's settings (Settings -> Lead assignment). On by default, 30 days.
alter table public.lead_assignment_settings add column if not exists return_enabled boolean not null default true;
alter table public.lead_assignment_settings add column if not exists return_days int not null default 30;
alter table public.lead_assignment_settings add column if not exists return_status_customers boolean not null default true;
alter table public.lead_assignment_settings add column if not exists return_status_others boolean not null default true;
alter table public.lead_assignment_settings add column if not exists return_owner text not null default 'same';
alter table public.lead_assignment_settings drop constraint if exists lead_assignment_settings_return_days_check;
alter table public.lead_assignment_settings add constraint lead_assignment_settings_return_days_check check (return_days between 7 and 365);
alter table public.lead_assignment_settings drop constraint if exists lead_assignment_settings_return_owner_check;
alter table public.lead_assignment_settings add constraint lead_assignment_settings_return_owner_check check (return_owner in ('same', 'afresh'));

-- Status history: changes made by the returning rule.
alter table public.lead_status_history drop constraint if exists lead_status_history_source_check;
alter table public.lead_status_history add constraint lead_status_history_source_check
  check (source in ('staff', 'bot', 'added', 'bulk', 'returning'));

-- Check:
select count(*) filter (where wa_name is not null) as with_whatsapp_name, count(*) as leads from public.whatsapp_leads;
