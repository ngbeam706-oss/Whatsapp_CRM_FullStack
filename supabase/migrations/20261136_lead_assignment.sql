-- Automatic lead assignment: round-robin or least busy. docs/progress/lead-assignment.md
--
-- Only ever assigns UNASSIGNED chats (a new customer chat, an unassigned chat that becomes active again, a bot
-- "talk to staff" handover); never takes a chat away from someone. Off by default (first action claims, as today).
-- The rotation pointer lives here and the assignment is one conditional update inside a function that locks the
-- business's settings row, so two messages arriving at once give one assignee and the turns stay fair.
-- Server-only tables. Safe to re-run.

create table if not exists public.lead_assignment_settings (
  business_id  uuid primary key references public.businesses(id) on delete cascade,
  mode         text not null default 'off' check (mode in ('off', 'round_robin', 'least_busy')),
  max_open     int check (max_open is null or max_open between 1 and 10000),   -- skip people at this many open chats
  per_number   boolean not null default false,                                  -- each WhatsApp number its own team
  updated_by   text,
  updated_at   timestamptz not null default now()
);

-- Who is in the rotation. phone_number_id '' = every number (the default team).
create table if not exists public.lead_assignment_members (
  business_id      uuid not null references public.businesses(id) on delete cascade,
  phone_number_id  text not null default '' check (phone_number_id = '' or phone_number_id ~ '^\d{5,30}$'),
  email            text not null,
  sort_order       int not null default 0,
  primary key (business_id, phone_number_id, email)
);

-- Whose turn it was last (per team).
create table if not exists public.lead_assignment_pointers (
  business_id      uuid not null references public.businesses(id) on delete cascade,
  phone_number_id  text not null default '',
  last_email       text,
  updated_at       timestamptz not null default now(),
  primary key (business_id, phone_number_id)
);

-- Each person's Available / Away switch and optional working days + hours (India time).
-- days: 0 = Sunday … 6 = Saturday; no hours = the business's send window.
create table if not exists public.staff_availability (
  business_id  uuid not null references public.businesses(id) on delete cascade,
  email        text not null,
  available    boolean not null default true,
  days         int[] not null default '{0,1,2,3,4,5,6}',
  start_hour   int check (start_hour is null or start_hour between 0 and 23),
  end_hour     int check (end_hour is null or end_hour between 1 and 24),
  updated_at   timestamptz not null default now(),
  primary key (business_id, email)
);

do $$
declare t text;
begin
  foreach t in array array['lead_assignment_settings', 'lead_assignment_members', 'lead_assignment_pointers', 'staff_availability'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Assign one unassigned chat. p_team: the whole team in rotation order; p_candidates: who may get it now
-- (available, on shift, under the cap; least busy first for 'least_busy'). Returns the email, or null when the chat
-- already has someone or nobody is available. Locks the settings row, so turns are taken one at a time.
create or replace function public.assign_lead_by_rotation(
  p_business uuid, p_phone text, p_number text, p_team text[], p_candidates text[], p_mode text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last text;
  v_pick text;
  v_idx  int;
  n      int := coalesce(array_length(p_team, 1), 0);
  k      int;
begin
  if coalesce(array_length(p_candidates, 1), 0) = 0 or p_mode not in ('round_robin', 'least_busy') then
    return null;
  end if;
  perform 1 from public.lead_assignment_settings where business_id = p_business for update;
  if exists (select 1 from public.whatsapp_leads where business_id = p_business and phone = p_phone and assigned_to is not null) then
    return null;
  end if;
  if p_mode = 'round_robin' and n > 0 then
    select last_email into v_last from public.lead_assignment_pointers
     where business_id = p_business and phone_number_id = coalesce(p_number, '');
    v_idx := coalesce(array_position(p_team, v_last), 0);
    for k in 1..n loop
      if p_team[((v_idx + k - 1) % n) + 1] = any (p_candidates) then
        v_pick := p_team[((v_idx + k - 1) % n) + 1];
        exit;
      end if;
    end loop;
  end if;
  v_pick := coalesce(v_pick, p_candidates[1]);
  update public.whatsapp_leads set assigned_to = v_pick
   where business_id = p_business and phone = p_phone and assigned_to is null;
  if not found then
    return null;
  end if;
  insert into public.lead_assignment_pointers (business_id, phone_number_id, last_email, updated_at)
  values (p_business, coalesce(p_number, ''), v_pick, now())
  on conflict (business_id, phone_number_id) do update set last_email = excluded.last_email, updated_at = now();
  return v_pick;
end;
$$;
revoke all on function public.assign_lead_by_rotation(uuid, text, text, text[], text[], text) from public, anon, authenticated;
grant execute on function public.assign_lead_by_rotation(uuid, text, text, text[], text[], text) to service_role;

-- Check:
select count(*) as businesses_with_rotation from public.lead_assignment_settings where mode <> 'off';
