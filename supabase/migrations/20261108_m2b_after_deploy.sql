-- =====================================================================
-- M2 part B: run AFTER the M2 server is deployed. Safe to re-run.
-- Removes the old "one business" keys, so the same customer number,
-- bot rule id, catalog or AI settings can exist in every business.
-- =====================================================================

-- 1. New rows must say which business they belong to ------------------------
-- Browser logins: filled in from their own business automatically.
-- The server (service key) has no "own business", so a server row without
-- business_id fails loudly instead of landing in the wrong business.
do $$
declare
  t text;
begin
  foreach t in array array[
    'staff_members',
    'whatsapp_leads', 'whatsapp_messages', 'whatsapp_bot_rules', 'whatsapp_catalog',
    'lead_notes', 'contact_events',
    'campaigns', 'campaign_recipients', 'automations', 'automation_runs',
    'ai_settings', 'ai_provider'
  ]
  loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('alter table public.%I alter column business_id set default public.current_business_id()', t);
  end loop;
end $$;

-- 2. Contacts: one per (business, phone) instead of one per phone ---------------
do $$
declare
  c record;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
     where rel.relname = 'whatsapp_leads' and rel.relnamespace = 'public'::regnamespace
       and con.contype = 'u'
       and (select array_agg(att.attname::text order by att.attname)
              from unnest(con.conkey) k join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k) = array['phone']
  loop
    execute format('alter table public.whatsapp_leads drop constraint %I', c.conname);
    raise notice 'Dropped %', c.conname;
  end loop;
  -- A unique INDEX on phone alone (not tied to a constraint) works the same way: drop it too.
  for c in
    select i.relname as conname
      from pg_index x
      join pg_class i on i.oid = x.indexrelid
     where x.indrelid = 'public.whatsapp_leads'::regclass and x.indisunique and not x.indisprimary
       and x.indnkeyatts = 1
       and (select att.attname from pg_attribute att where att.attrelid = x.indrelid and att.attnum = x.indkey[0]) = 'phone'
       and not exists (select 1 from pg_constraint con where con.conindid = x.indexrelid)
  loop
    execute format('drop index public.%I', c.conname);
    raise notice 'Dropped index %', c.conname;
  end loop;
end $$;

-- 3. Bot rules and catalog: primary key (business_id, id) ---------------------
do $$
declare
  t text;
  pk text;
  cols text;
begin
  foreach t in array array['whatsapp_bot_rules', 'whatsapp_catalog'] loop
    select con.conname,
           (select string_agg(att.attname::text, ',' order by att.attname)
              from unnest(con.conkey) k join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k)
      into pk, cols
      from pg_constraint con
     where con.conrelid = ('public.' || t)::regclass and con.contype = 'p';
    if cols is distinct from 'business_id,id' then
      if pk is not null then execute format('alter table public.%I drop constraint %I', t, pk); end if;
      execute format('alter table public.%I add primary key (business_id, id)', t);
      raise notice '% primary key is now (business_id, id)', t;
    end if;
  end loop;
end $$;
drop index if exists public.whatsapp_bot_rules_business_id_key;
drop index if exists public.whatsapp_catalog_business_id_key;

-- 4. AI settings and AI provider: one row per business ------------------------
do $$
declare
  t text;
  pk text;
  cols text;
  ck record;
begin
  foreach t in array array['ai_settings', 'ai_provider'] loop
    for ck in
      select conname from pg_constraint
       where conrelid = ('public.' || t)::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%''main''%'
    loop
      execute format('alter table public.%I drop constraint %I', t, ck.conname);
    end loop;
    select con.conname,
           (select string_agg(att.attname::text, ',' order by att.attname)
              from unnest(con.conkey) k join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k)
      into pk, cols
      from pg_constraint con
     where con.conrelid = ('public.' || t)::regclass and con.contype = 'p';
    if cols is distinct from 'business_id' then
      if pk is not null then execute format('alter table public.%I drop constraint %I', t, pk); end if;
      execute format('alter table public.%I add primary key (business_id)', t);
      raise notice '% primary key is now (business_id)', t;
    end if;
  end loop;
end $$;
drop index if exists public.ai_settings_business_key;
drop index if exists public.ai_provider_business_key;

-- 5. Setup tables: everyone in the business may read; only the Business Admin and
--    managers may change them (matches the server's rules). Agents work on chats only.
create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff_members s join public.businesses b on b.id = s.business_id
     where s.user_id = auth.uid() and s.role in ('owner', 'manager') and b.status = 'active');
$$;
revoke all on function public.is_manager() from public, anon;
grant execute on function public.is_manager() to authenticated;

do $$
declare
  t   text;
  pol record;
begin
  foreach t in array array['whatsapp_bot_rules', 'whatsapp_catalog', 'ai_settings', 'campaigns', 'campaign_recipients', 'automations', 'automation_runs'] loop
    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', pol.policyname, t);
    end loop;
    execute format('create policy "business reads" on public.%I for select to authenticated using (business_id = public.current_business_id())', t);
    execute format('create policy "managers change" on public.%I for all to authenticated using (business_id = public.current_business_id() and public.is_manager()) with check (business_id = public.current_business_id() and public.is_manager())', t);
  end loop;
end $$;

-- 6. Old single-business server helpers are no longer used --------------------
drop function if exists public.lead_mark_inbound(text);
drop function if exists public.staff_add_existing(text, text);

-- Check:
select 'contacts' as what, count(*) from public.whatsapp_leads
union all select 'businesses', count(*) from public.businesses
union all select 'ai_settings rows', count(*) from public.ai_settings;
