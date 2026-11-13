-- Several WhatsApp numbers per business, phase N1 (docs/progress/multi-number.md). Safe to re-run.
--
-- Model: business_whatsapp stays the business's MAIN connection (Meta app: webhook address, app secret,
-- verify token, token) and its main number. whatsapp_numbers holds the EXTRA numbers of the same business.
-- They share the main webhook address (one Meta app callback URL serves every number) and, unless they have
-- their own token, the main token. A number is identified everywhere by Meta's phone_number_id.
--
-- One chat per customer (user's decision): the contact stays one row in whatsapp_leads; each message, call and
-- 24-hour window records which number it went through. Only ADDS things: the live server keeps working.

-- 1. Extra numbers --------------------------------------------------------------------------------------
create table if not exists public.whatsapp_numbers (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses(id) on delete cascade,
  phone_number_id   text not null unique check (phone_number_id ~ '^\d{5,30}$'),
  phone_number      text,
  waba_id           text,
  label             text not null default '' check (char_length(label) <= 40),
  access_token_enc  text,                 -- null = use the main connection's token
  token_last4       text,
  status            text not null default 'active' check (status in ('active', 'disabled')),
  added_by          text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists whatsapp_numbers_business_idx on public.whatsapp_numbers (business_id);

alter table public.whatsapp_numbers enable row level security;
revoke all on public.whatsapp_numbers from anon, authenticated;

-- A name for the main number too ("Reception").
alter table public.business_whatsapp add column if not exists label text not null default '';

-- The same Meta number can never be the main number of one business and an extra number of another.
create or replace function public.whatsapp_number_unique_check()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.phone_number_id is null then return new; end if;
  if tg_table_name = 'whatsapp_numbers' then
    if exists (select 1 from public.business_whatsapp w where w.phone_number_id = new.phone_number_id) then
      raise exception 'This WhatsApp number is already connected as a main number' using errcode = '23505';
    end if;
  else
    if exists (select 1 from public.whatsapp_numbers n where n.phone_number_id = new.phone_number_id) then
      raise exception 'This WhatsApp number is already connected as an extra number' using errcode = '23505';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists whatsapp_numbers_unique_check on public.whatsapp_numbers;
create trigger whatsapp_numbers_unique_check before insert or update of phone_number_id on public.whatsapp_numbers
  for each row execute function public.whatsapp_number_unique_check();
drop trigger if exists business_whatsapp_unique_check on public.business_whatsapp;
create trigger business_whatsapp_unique_check before insert or update of phone_number_id on public.business_whatsapp
  for each row execute function public.whatsapp_number_unique_check();

-- 2. Which number each message / call / contact went through (Meta phone_number_id) --------------------
alter table public.whatsapp_messages add column if not exists phone_number_id text;
alter table public.whatsapp_leads    add column if not exists last_phone_number_id text;
alter table public.whatsapp_calls    add column if not exists phone_number_id text;

-- History so far went through each business's main number.
update public.whatsapp_messages m
   set phone_number_id = w.phone_number_id
  from public.business_whatsapp w
 where m.business_id = w.business_id and m.phone_number_id is null and w.phone_number_id is not null;
update public.whatsapp_leads l
   set last_phone_number_id = w.phone_number_id
  from public.business_whatsapp w
 where l.business_id = w.business_id and l.last_phone_number_id is null and w.phone_number_id is not null;
update public.whatsapp_calls c
   set phone_number_id = w.phone_number_id
  from public.business_whatsapp w
 where c.business_id = w.business_id and c.phone_number_id is null and w.phone_number_id is not null;

-- 3. 24-hour window per (customer, number): Meta's window is per number --------------------------------
create table if not exists public.lead_number_windows (
  business_id      uuid not null references public.businesses(id) on delete cascade,
  phone            text not null,
  phone_number_id  text not null,
  last_inbound_at  timestamptz not null,
  primary key (business_id, phone, phone_number_id)
);
alter table public.lead_number_windows enable row level security;
revoke all on public.lead_number_windows from anon, authenticated;

insert into public.lead_number_windows (business_id, phone, phone_number_id, last_inbound_at)
select l.business_id, l.phone, w.phone_number_id, l.last_inbound_at
  from public.whatsapp_leads l
  join public.business_whatsapp w on w.business_id = l.business_id
 where l.last_inbound_at is not null and l.phone is not null and w.phone_number_id is not null
on conflict do nothing;

-- 4. Incoming message on a number: remember the number and open its window (one call from the server) -----
create or replace function public.lead_mark_inbound_number(p_business uuid, p_phone text, p_number text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.whatsapp_leads
     set last_phone_number_id = p_number
   where business_id = p_business and phone = p_phone;
  insert into public.lead_number_windows (business_id, phone, phone_number_id, last_inbound_at)
  values (p_business, p_phone, p_number, now())
  on conflict (business_id, phone, phone_number_id) do update set last_inbound_at = excluded.last_inbound_at;
$$;
revoke all on function public.lead_mark_inbound_number(uuid, text, text) from public, anon, authenticated;
grant execute on function public.lead_mark_inbound_number(uuid, text, text) to service_role;
