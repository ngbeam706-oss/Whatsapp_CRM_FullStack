-- =====================================================================
-- M2 part A: run BEFORE deploying the M2 server. Safe to re-run.
-- Only ADDS things (new keys and server helpers), so the current live
-- server keeps working until the new one is deployed.
-- =====================================================================

-- 1. Per-business keys the M2 server writes with ---------------------------
-- (whatsapp_leads (business_id, phone), ai_settings (business_id) and
--  ai_provider (business_id) were added in M1.)
create unique index if not exists whatsapp_bot_rules_business_id_key on public.whatsapp_bot_rules (business_id, id);
create unique index if not exists whatsapp_catalog_business_id_key   on public.whatsapp_catalog (business_id, id);

-- 2. Incoming message: unread +1 and open the 24-hour window, in ONE business --
create or replace function public.lead_mark_inbound_in_business(p_business uuid, p_phone text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.whatsapp_leads
     set unread_count = unread_count + 1,
         last_inbound_at = now()
   where business_id = p_business and phone = p_phone;
$$;

-- 3. Give an existing login access to a business (Team page) -----------------
-- Never moves someone out of another business: one login = one business.
create or replace function public.staff_add_existing_to_business(p_email text, p_role text, p_business uuid)
returns setof public.staff_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  uuid;
  v_email text;
  v_other uuid;
begin
  select id, email into v_user, v_email from auth.users where lower(email) = lower(p_email);
  if v_user is null then
    return;  -- no account with that email
  end if;
  select business_id into v_other from public.staff_members where user_id = v_user;
  if v_other is not null and v_other <> p_business then
    raise exception 'This login already works for another business.';
  end if;
  return query
    insert into public.staff_members (user_id, email, role, business_id)
    values (v_user, v_email, p_role, p_business)
    on conflict (user_id) do update set role = excluded.role
      where public.staff_members.business_id = p_business
    returning *;
end;
$$;

revoke all on function public.lead_mark_inbound_in_business(uuid, text) from public, anon, authenticated;
revoke all on function public.staff_add_existing_to_business(text, text, uuid) from public, anon, authenticated;
grant execute on function public.lead_mark_inbound_in_business(uuid, text) to service_role;
grant execute on function public.staff_add_existing_to_business(text, text, uuid) to service_role;

-- Check:
select indexname from pg_indexes
 where schemaname = 'public' and indexname in ('whatsapp_bot_rules_business_id_key', 'whatsapp_catalog_business_id_key', 'whatsapp_leads_business_phone_key');
