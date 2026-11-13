-- Platform roles: staff under the Platform Owner, each with least privilege.
--   owner     = Platform Owner (everything, incl. the platform team). Every existing platform admin.
--   manager   = Application Manager: sign-ups, business onboarding, platform support queries.
--   developer = Application Developer: health, logs, worker runs, delivery; businesses read-only.
-- No platform role ever reads a business's chats, contacts, notes or bot/AI content (unchanged: those
-- tables have no platform policy). The server checks the role on every /api/platform route.
-- Safe to re-run. docs/progress/platform-roles.md

-- 1. The role ---------------------------------------------------------------------------------
alter table public.platform_admins add column if not exists role text not null default 'owner';
alter table public.platform_admins add column if not exists added_by text;
alter table public.platform_admins drop constraint if exists platform_admins_role_check;
alter table public.platform_admins add constraint platform_admins_role_check
  check (role in ('owner', 'manager', 'developer'));
-- platform_admins stays server-only for changes: a login still reads only its own row (M1 policy).

-- 2. Helpers for the rules ----------------------------------------------------------------------
create or replace function public.platform_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.platform_admins where user_id = auth.uid();
$$;

create or replace function public.is_platform_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid() and role = 'owner');
$$;

revoke all on function public.platform_role()     from public, anon;
revoke all on function public.is_platform_owner() from public, anon;
grant execute on function public.platform_role()     to authenticated;
grant execute on function public.is_platform_owner() to authenticated;

-- 3. Rules: every platform role may read; only the Platform Owner changes plans and businesses ----
drop policy if exists "platform manage plans" on public.plans;
create policy "platform manage plans" on public.plans for all to authenticated
  using (public.is_platform_owner()) with check (public.is_platform_owner());

drop policy if exists "platform manage businesses" on public.businesses;
drop policy if exists "platform read businesses"   on public.businesses;
create policy "platform read businesses" on public.businesses for select to authenticated
  using (public.is_platform_admin());
create policy "platform manage businesses" on public.businesses for all to authenticated
  using (public.is_platform_owner()) with check (public.is_platform_owner());

-- The audit log is the Platform Owner's (managers and developers don't read who did what).
drop policy if exists "platform read audit" on public.audit_log;
create policy "platform read audit" on public.audit_log for select to authenticated
  using (public.is_platform_owner());

-- Platform support queries: the Platform Owner and Application Managers (not developers).
drop policy if exists "see platform queries" on public.platform_queries;
create policy "see platform queries" on public.platform_queries for select to authenticated
  using (
    public.platform_role() in ('owner', 'manager')
    or (business_id = public.current_business_id()
        and (public.current_staff_role() = 'owner' or lower(raised_by_email) = public.current_staff_email()))
  );

drop policy if exists "see platform query events" on public.platform_query_events;
create policy "see platform query events" on public.platform_query_events for select to authenticated
  using (
    public.platform_role() in ('owner', 'manager')
    or (visibility = 'all' and exists (
          select 1 from public.platform_queries p
           where p.id = platform_query_id
             and p.business_id = public.current_business_id()
             and (public.current_staff_role() = 'owner' or lower(p.raised_by_email) = public.current_staff_email())))
  );

-- 4. Server helper: add an existing login to the platform team (service key only) ---------------
-- (A brand-new login is invited by the server first; this covers someone who already has a login.)
-- The M1 trigger still refuses a login that works for a business.
create or replace function public.platform_staff_add_existing(p_email text, p_role text, p_added_by text)
returns setof public.platform_admins
language plpgsql
security definer
set search_path = public
as $$
declare
  u record;
begin
  if p_role not in ('owner', 'manager', 'developer') then
    raise exception 'Unknown platform role %', p_role;
  end if;
  select id, email into u from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if u.id is null then
    return;
  end if;
  return query
    insert into public.platform_admins (user_id, email, role, added_by)
    values (u.id, lower(u.email), p_role, p_added_by)
    on conflict (user_id) do update set role = excluded.role
    returning *;
end;
$$;
revoke all on function public.platform_staff_add_existing(text, text, text) from public, anon, authenticated;
grant execute on function public.platform_staff_add_existing(text, text, text) to service_role;

-- Check:
select role, count(*) from public.platform_admins group by role;
