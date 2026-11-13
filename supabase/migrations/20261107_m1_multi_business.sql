-- =====================================================================
-- M1: multi-business foundation (businesses, plans, roles, separation).
--
-- Run once in Supabase -> SQL Editor, AFTER all the 20261106_* files.
-- Safe to re-run. Back up first (done 6 Nov 2026, before M1).
--
-- What it does:
--   * New tables: plans, businesses, business_whatsapp, platform_admins,
--     usage_counters, audit_log.
--   * Arogya Ruchulu becomes business #1, and every existing row is moved into it.
--   * Every data table gets a business_id column.
--   * Database rules (RLS): staff see ONLY their own business. Platform admins
--     can manage businesses and plans but can NEVER read chats, contacts,
--     notes, messages or bot/AI content.
--   * One business per employee: staff_members.user_id stays the primary key.
--   * New role: 'manager' (between 'owner' = Business Admin and 'agent').
--
-- Nothing changes for Arogya's users today: until the M2 server update, new rows
-- get Arogya's business_id automatically (column default).
-- =====================================================================

-- Arogya Ruchulu's fixed business id (used as the temporary default below).
-- a0000000-0000-4000-8000-000000000001

-- 1. Plans ------------------------------------------------------------------
-- null limit = unlimited. Prices and limits can be changed later on the Platform console.
create table if not exists public.plans (
  id                     text primary key check (id ~ '^[a-z0-9_]{2,30}$'),
  name                   text not null,
  price_monthly_inr      numeric(10,2) not null default 0,
  max_staff              int,
  max_contacts           int,
  max_broadcasts_month   int,
  max_automations        int,
  max_ai_replies_month   int,
  max_keyword_rules      int,
  analytics_days         int,
  ai_enabled             boolean not null default true,
  sort_order             int not null default 0,
  updated_at             timestamptz not null default now()
);

insert into public.plans (id, name, max_staff, max_contacts, max_broadcasts_month, max_automations, max_ai_replies_month, max_keyword_rules, analytics_days, ai_enabled, sort_order)
values
  ('starter', 'Starter',  3,  1000,  1000,    2,     0,   10,  30, false, 1),
  ('growth',  'Growth',  10, 10000, 10000,   10,  2000,   50,  90, true,  2),
  ('pro',     'Pro',     30, 50000, 50000, null, 10000, null, 365, true,  3)
on conflict (id) do nothing;

-- 2. Businesses -------------------------------------------------------------------
create table if not exists public.businesses (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (char_length(name) between 2 and 80),
  slug                text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,39}$'),
  status              text not null default 'active' check (status in ('active', 'suspended')),
  plan_id             text not null default 'starter' references public.plans(id),
  limit_overrides     jsonb not null default '{}'::jsonb,   -- per-business changes to the plan limits
  paid_until          date,                                  -- manual payment record (M5)
  timezone            text not null default 'Asia/Kolkata',
  send_window_start   smallint not null default 9  check (send_window_start between 0 and 23),
  send_window_end     smallint not null default 20 check (send_window_end between 1 and 24),
  logo_url            text,
  created_by          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

insert into public.businesses (id, name, slug, status, plan_id)
values ('a0000000-0000-4000-8000-000000000001', 'Arogya Ruchulu', 'arogya-ruchulu', 'active', 'pro')
on conflict (id) do nothing;

-- 3. WhatsApp connection per business (filled by the server in M3) ---------------
-- Token and secrets are stored ENCRYPTED by the server. No browser access at all.
create table if not exists public.business_whatsapp (
  business_id         uuid primary key references public.businesses(id) on delete cascade,
  phone_number        text,
  phone_number_id     text unique,
  waba_id             text,
  access_token_enc    text,
  app_secret_enc      text,
  verify_token_enc    text,
  webhook_key         text not null unique default replace(gen_random_uuid()::text, '-', ''),
  graph_api_version   text not null default 'v26.0',
  connected_at        timestamptz,
  updated_by          text,
  updated_at          timestamptz not null default now()
);

-- 4. Platform admins (separate logins; never members of a business) ---------------
create table if not exists public.platform_admins (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  created_at  timestamptz not null default now()
);

-- 5. Monthly usage counters (for plan limits, M5) ---------------------------------
create table if not exists public.usage_counters (
  business_id      uuid not null references public.businesses(id) on delete cascade,
  period           text not null check (period ~ '^\d{4}-\d{2}$'),   -- e.g. 2026-11
  broadcasts_sent  int not null default 0,
  ai_replies       int not null default 0,
  primary key (business_id, period)
);

-- 6. Audit log (who did what; never message content) -------------------------------
create table if not exists public.audit_log (
  id           bigint generated by default as identity primary key,
  business_id  uuid references public.businesses(id) on delete set null,
  actor_email  text,
  actor_role   text,
  action       text not null,
  details      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists audit_log_business_idx on public.audit_log (business_id, created_at desc);

-- 7. business_id on every data table ------------------------------------------------
do $$
declare
  t text;
  arogya constant uuid := 'a0000000-0000-4000-8000-000000000001';
begin
  foreach t in array array[
    'staff_members',
    'whatsapp_leads', 'whatsapp_messages', 'whatsapp_bot_rules', 'whatsapp_catalog',
    'lead_notes', 'contact_events',
    'campaigns', 'campaign_recipients', 'automations', 'automation_runs',
    'ai_settings', 'ai_provider'
  ]
  loop
    if to_regclass('public.' || t) is null then
      raise notice 'Skipping %, table does not exist', t;
      continue;
    end if;
    execute format('alter table public.%I add column if not exists business_id uuid', t);
    execute format('update public.%I set business_id = %L where business_id is null', t, arogya);
    -- Temporary default until the M2 server update sets business_id itself.
    execute format('alter table public.%I alter column business_id set default %L', t, arogya);
    execute format('alter table public.%I alter column business_id set not null', t);
    if not exists (select 1 from pg_constraint where conname = t || '_business_fk') then
      execute format('alter table public.%I add constraint %I foreign key (business_id) references public.businesses(id) on delete cascade', t, t || '_business_fk');
    end if;
    execute format('create index if not exists %I on public.%I (business_id)', t || '_business_idx', t);
    raise notice 'business_id added to %', t;
  end loop;
end $$;

-- Per-business uniqueness for later phases (the old single-business keys stay until M2).
create unique index if not exists whatsapp_leads_business_phone_key on public.whatsapp_leads (business_id, phone);
create unique index if not exists ai_settings_business_key          on public.ai_settings (business_id);
create unique index if not exists ai_provider_business_key          on public.ai_provider (business_id);

-- 8. Roles: owner (= Business Admin), manager, agent --------------------------------
alter table public.staff_members drop constraint if exists staff_members_role_check;
alter table public.staff_members add constraint staff_members_role_check
  check (role in ('owner', 'manager', 'agent'));

-- A platform admin can't also be business staff, and the other way round.
create or replace function public.keep_platform_and_staff_apart()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'staff_members' and exists (select 1 from public.platform_admins where user_id = new.user_id) then
    raise exception 'This login is a platform admin and cannot be added to a business.';
  end if;
  if tg_table_name = 'platform_admins' and exists (select 1 from public.staff_members where user_id = new.user_id) then
    raise exception 'This login already works for a business. Use a separate login for the platform admin.';
  end if;
  return new;
end;
$$;

drop trigger if exists staff_not_platform on public.staff_members;
create trigger staff_not_platform before insert or update of user_id on public.staff_members
  for each row execute function public.keep_platform_and_staff_apart();
drop trigger if exists platform_not_staff on public.platform_admins;
create trigger platform_not_staff before insert or update of user_id on public.platform_admins
  for each row execute function public.keep_platform_and_staff_apart();

-- 9. Helper functions used by the rules ------------------------------------------
-- The signed-in person's business (only if that business is active).
create or replace function public.current_business_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.business_id
    from public.staff_members s
    join public.businesses b on b.id = s.business_id
   where s.user_id = auth.uid() and b.status = 'active';
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;

-- Staff of an ACTIVE business (a suspended business's staff are locked out).
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_business_id() is not null;
$$;

-- Business Admin of their (active) business.
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff_members s join public.businesses b on b.id = s.business_id
     where s.user_id = auth.uid() and s.role = 'owner' and b.status = 'active');
$$;

revoke all on function public.current_business_id() from public, anon;
revoke all on function public.is_platform_admin()  from public, anon;
revoke all on function public.is_staff()           from public, anon;
revoke all on function public.is_owner()           from public, anon;
grant execute on function public.current_business_id() to authenticated;
grant execute on function public.is_platform_admin()  to authenticated;
grant execute on function public.is_staff()           to authenticated;
grant execute on function public.is_owner()           to authenticated;

-- 10. Rules (RLS) on the data tables: own business only --------------------------
-- Platform admins get no policy here, so they can't read any of it.
do $$
declare
  t   text;
  pol record;
begin
  foreach t in array array[
    'whatsapp_leads', 'whatsapp_messages', 'whatsapp_bot_rules', 'whatsapp_catalog',
    'lead_notes', 'contact_events',
    'campaigns', 'campaign_recipients', 'automations', 'automation_runs',
    'ai_settings'
  ]
  loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('alter table public.%I enable row level security', t);
    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', pol.policyname, t);
    end loop;
    execute format('revoke all on public.%I from anon', t);
    execute format(
      'create policy "own business only" on public.%I for all to authenticated using (business_id = public.current_business_id()) with check (business_id = public.current_business_id())',
      t
    );
  end loop;
end $$;

-- ai_provider keeps NO policies (server only). Make sure nobody else can read it.
alter table public.ai_provider enable row level security;
revoke all on public.ai_provider from anon, authenticated;

-- Staff list: everyone reads their own row; the Business Admin reads and manages their business's staff.
drop policy if exists "staff read own row"    on public.staff_members;
drop policy if exists "owners read all staff" on public.staff_members;
drop policy if exists "owners manage staff"   on public.staff_members;
create policy "staff read own row" on public.staff_members for select to authenticated
  using (user_id = auth.uid());
create policy "owners read all staff" on public.staff_members for select to authenticated
  using (public.is_owner() and business_id = public.current_business_id());
create policy "owners manage staff" on public.staff_members for all to authenticated
  using (public.is_owner() and business_id = public.current_business_id())
  with check (public.is_owner() and business_id = public.current_business_id());
revoke all on public.staff_members from anon;

-- Plans: any signed-in person may read them; only platform admins change them.
alter table public.plans enable row level security;
drop policy if exists "signed in read plans" on public.plans;
drop policy if exists "platform manage plans" on public.plans;
create policy "signed in read plans"  on public.plans for select to authenticated using (true);
create policy "platform manage plans" on public.plans for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
revoke all on public.plans from anon;

-- Businesses: staff read their own business; platform admins manage all businesses.
alter table public.businesses enable row level security;
drop policy if exists "staff read own business"    on public.businesses;
drop policy if exists "platform manage businesses" on public.businesses;
create policy "staff read own business" on public.businesses for select to authenticated
  using (id = public.current_business_id());
create policy "platform manage businesses" on public.businesses for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
revoke all on public.businesses from anon;

-- WhatsApp secrets: server only (no policies).
alter table public.business_whatsapp enable row level security;
revoke all on public.business_whatsapp from anon, authenticated;

-- Platform admins: each reads only their own row (to know they are one). Added via SQL only.
alter table public.platform_admins enable row level security;
drop policy if exists "read own platform row" on public.platform_admins;
create policy "read own platform row" on public.platform_admins for select to authenticated
  using (user_id = auth.uid());
revoke all on public.platform_admins from anon;
revoke insert, update, delete on public.platform_admins from authenticated;

-- Usage: staff read their business's usage; platform admins read all. Written by the server only.
alter table public.usage_counters enable row level security;
drop policy if exists "staff read own usage"   on public.usage_counters;
drop policy if exists "platform read usage"    on public.usage_counters;
create policy "staff read own usage" on public.usage_counters for select to authenticated
  using (business_id = public.current_business_id());
create policy "platform read usage" on public.usage_counters for select to authenticated
  using (public.is_platform_admin());
revoke all on public.usage_counters from anon;
revoke insert, update, delete on public.usage_counters from authenticated;

-- Audit log: the Business Admin reads their business's entries; platform admins read all.
alter table public.audit_log enable row level security;
drop policy if exists "owner read own audit"  on public.audit_log;
drop policy if exists "platform read audit"   on public.audit_log;
create policy "owner read own audit" on public.audit_log for select to authenticated
  using (public.is_owner() and business_id = public.current_business_id());
create policy "platform read audit" on public.audit_log for select to authenticated
  using (public.is_platform_admin());
revoke all on public.audit_log from anon;
revoke insert, update, delete on public.audit_log from authenticated;

-- Server helper: add to a monthly usage counter (service key only).
create or replace function public.add_usage(p_business uuid, p_metric text, p_amount int default 1)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p text := to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM');
begin
  if p_metric not in ('broadcasts_sent', 'ai_replies') then
    raise exception 'Unknown usage metric %', p_metric;
  end if;
  insert into public.usage_counters (business_id, period) values (p_business, p)
  on conflict (business_id, period) do nothing;
  execute format('update public.usage_counters set %I = %I + $1 where business_id = $2 and period = $3', p_metric, p_metric)
    using greatest(p_amount, 0), p_business, p;
end;
$$;
revoke all on function public.add_usage(uuid, text, int) from public, anon, authenticated;
grant execute on function public.add_usage(uuid, text, int) to service_role;

-- 11. Make yourself the platform admin (OPTIONAL, use a SEPARATE login) ------------
-- Create a new login first (Authentication -> Users -> Add user), NOT your Arogya
-- owner login, then replace the email and run this line:
-- insert into public.platform_admins (user_id, email)
-- select id, email from auth.users where email = 'platform-admin@example.com'
-- on conflict (user_id) do nothing;

-- Check:
select b.name, b.plan_id, b.status,
       (select count(*) from public.staff_members  s where s.business_id = b.id) as staff,
       (select count(*) from public.whatsapp_leads l where l.business_id = b.id) as contacts,
       (select count(*) from public.whatsapp_messages m where m.business_id = b.id) as messages
  from public.businesses b;
