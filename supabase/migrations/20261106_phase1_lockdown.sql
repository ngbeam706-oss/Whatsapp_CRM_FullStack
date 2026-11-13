-- =====================================================================
-- Phase 1 hardening: lock the database down to signed-in staff only.
--
-- Run once in Supabase -> SQL Editor. Safe to re-run.
--
-- BEFORE running:
--   1. Supabase -> Authentication -> Users -> "Add user" for yourself
--      (email + password). Do the same for each staff member.
--   2. Supabase -> Authentication -> Sign In / Providers -> turn OFF
--      "Allow new users to sign up", so strangers cannot create accounts.
--   3. Replace owner@example.com at the bottom of this file with your email.
--
-- AFTER running:
--   * The browser's public (anon) key can no longer read or change any
--     customer data. Only staff listed in staff_members can, after login.
--   * The server (webhook) writes with SUPABASE_SERVICE_ROLE_KEY, which
--     bypasses RLS, so set that env var in Netlify before deploying.
-- =====================================================================

-- 1. Staff list ---------------------------------------------------------
create table if not exists public.staff_members (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  role       text not null default 'agent' check (role in ('owner', 'agent')),
  created_at timestamptz not null default now()
);

alter table public.staff_members enable row level security;

-- SECURITY DEFINER so policies can call it without recursing into staff_members' own RLS.
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.staff_members where user_id = auth.uid());
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.staff_members where user_id = auth.uid() and role = 'owner');
$$;

revoke all on function public.is_staff() from public, anon;
revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_owner() to authenticated;

drop policy if exists "staff read own row"      on public.staff_members;
drop policy if exists "owners read all staff"   on public.staff_members;
drop policy if exists "owners manage staff"     on public.staff_members;

create policy "staff read own row"    on public.staff_members for select to authenticated using (user_id = auth.uid());
create policy "owners read all staff" on public.staff_members for select to authenticated using (public.is_owner());
create policy "owners manage staff"   on public.staff_members for all    to authenticated using (public.is_owner()) with check (public.is_owner());

revoke all on public.staff_members from anon;

-- 2. Data tables: remove every existing policy (including the old
--    "Allow anon all ..." ones) and allow staff only. Tables that don't
--    exist in your project are skipped.
do $$
declare
  t   text;
  pol record;
begin
  foreach t in array array[
    'whatsapp_leads',
    'whatsapp_messages',
    'whatsapp_bot_rules',
    'whatsapp_catalog',
    'bot_rules',
    'orders_and_enquiries'
  ]
  loop
    if to_regclass('public.' || t) is null then
      raise notice 'Skipping %, table does not exist', t;
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);

    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', pol.policyname, t);
    end loop;

    execute format('revoke all on public.%I from anon', t);
    execute format(
      'create policy "staff full access" on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff())',
      t
    );
    raise notice 'Locked down %', t;
  end loop;
end $$;

-- 3. Call recordings bucket: only staff may upload / change / delete.
--    (Files stay readable by link, because the app currently uses public URLs.
--    Making the bucket private is planned for a later phase.)
do $$
declare
  pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (coalesce(qual, '') like '%call-recordings%' or coalesce(with_check, '') like '%call-recordings%')
  loop
    execute format('drop policy %I on storage.objects', pol.policyname);
  end loop;
end $$;

create policy "staff upload call recordings" on storage.objects for insert to authenticated
  with check (bucket_id = 'call-recordings' and public.is_staff());
create policy "staff update call recordings" on storage.objects for update to authenticated
  using (bucket_id = 'call-recordings' and public.is_staff());
create policy "staff delete call recordings" on storage.objects for delete to authenticated
  using (bucket_id = 'call-recordings' and public.is_staff());

-- 4. Make yourself the owner. Replace the email, then run.
insert into public.staff_members (user_id, email, role)
select id, email, 'owner' from auth.users where email = 'owner@example.com'
on conflict (user_id) do update set role = 'owner';

-- To add another staff member later (after creating their login in Authentication -> Users):
-- insert into public.staff_members (user_id, email, role)
-- select id, email, 'agent' from auth.users where email = 'staff@example.com'
-- on conflict (user_id) do nothing;

-- Check the result:
select email, role from public.staff_members;
