-- Platform-wide settings, set by the Platform Admin. First setting: maintenance mode.
--
-- Maintenance ON: every business dashboard shows a "under maintenance" screen and the staff API answers
-- 503. Customers' WhatsApp messages are still received and stored, and the bot keeps answering, so
-- nothing is lost. Broadcasts and follow-ups wait until maintenance is switched off. The Platform
-- console keeps working (to switch it off again).
--
-- One row (id = 1). Server-only table: the browser reads the state through the API. Safe to re-run.

create table if not exists public.platform_settings (
  id                    smallint primary key default 1 check (id = 1),
  maintenance_on        boolean not null default false,
  maintenance_message   text,
  maintenance_until     timestamptz,            -- optional "expected back by", shown to staff
  maintenance_started   timestamptz,
  updated_by            text,
  updated_at            timestamptz not null default now()
);

insert into public.platform_settings (id) values (1) on conflict (id) do nothing;

alter table public.platform_settings enable row level security;
revoke all on public.platform_settings from anon, authenticated;
