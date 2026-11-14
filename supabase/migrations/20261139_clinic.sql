-- Clinic module (hospitals / clinics): doctors, their hours, appointments and payments. docs/progress/clinic.md
--
-- A doctor is NOT a staff member: doctors live in clinic_doctors with their login's user_id, so every existing staff
-- rule (chats RLS, the staff API) already refuses them. A login can't be both a doctor and staff / a platform admin.
-- Everything here is server-only (RLS on, no grants), except that a doctor's login may read its own clinic_doctors
-- row (the browser uses it to open the doctor area). Safe to re-run.

create table if not exists public.clinic_settings (
  business_id                  uuid primary key references public.businesses(id) on delete cascade,
  razorpay_key_id              text,
  razorpay_secret_enc          text,           -- encrypted on the server (server/secrets.cjs)
  razorpay_webhook_secret_enc  text,           -- encrypted
  webhook_key                  text not null default replace(gen_random_uuid()::text, '-', ''),
  link_expiry_hours            int not null default 24 check (link_expiry_hours between 1 and 720),
  updated_by                   text,
  updated_at                   timestamptz not null default now()
);
create unique index if not exists clinic_settings_webhook_key on public.clinic_settings (webhook_key);

create table if not exists public.clinic_doctors (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  user_id       uuid unique,                 -- the doctor's login (set when invited)
  email         text not null,
  name          text not null,
  specialty     text,
  fee_paise     int not null default 0 check (fee_paise between 0 and 100000000),
  slot_minutes  int not null default 15 check (slot_minutes between 5 and 240),
  active        boolean not null default true,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (business_id, email)
);

-- Weekly hours (India time): weekday 0 = Sunday … 6 = Saturday; minutes from midnight. Several rows a day allowed.
create table if not exists public.clinic_doctor_hours (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  doctor_id    uuid not null references public.clinic_doctors(id) on delete cascade,
  weekday      int not null check (weekday between 0 and 6),
  start_min    int not null check (start_min between 0 and 1435),
  end_min      int not null check (end_min between 5 and 1440),
  check (end_min > start_min)
);
create index if not exists clinic_doctor_hours_doctor on public.clinic_doctor_hours (doctor_id);

create table if not exists public.clinic_doctor_days_off (
  business_id  uuid not null references public.businesses(id) on delete cascade,
  doctor_id    uuid not null references public.clinic_doctors(id) on delete cascade,
  day          date not null,
  primary key (doctor_id, day)
);

create table if not exists public.clinic_appointments (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses(id) on delete cascade,
  doctor_id         uuid not null references public.clinic_doctors(id) on delete restrict,
  lead_phone        text not null,
  patient_name      text not null,
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,
  status            text not null default 'pending_payment'
                    check (status in ('pending_payment', 'confirmed', 'completed', 'cancelled', 'no_show')),
  fee_paise         int not null check (fee_paise >= 0),
  note              text,                     -- short booking note (no medical details)
  booked_by         text,
  confirmed_at      timestamptz,
  cancelled_reason  text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (ends_at > starts_at)
);
-- One active appointment per doctor per start time (cancelled / no-show free the slot).
create unique index if not exists clinic_appointments_slot
  on public.clinic_appointments (doctor_id, starts_at) where status in ('pending_payment', 'confirmed', 'completed');
create index if not exists clinic_appointments_biz_time on public.clinic_appointments (business_id, starts_at);
create index if not exists clinic_appointments_lead on public.clinic_appointments (business_id, lead_phone);

create table if not exists public.clinic_payments (
  id                   uuid primary key default gen_random_uuid(),
  business_id          uuid not null references public.businesses(id) on delete cascade,
  appointment_id       uuid not null references public.clinic_appointments(id) on delete cascade,
  method               text not null check (method in ('razorpay_link', 'cash', 'upi_desk', 'card_desk', 'other')),
  amount_paise         int not null check (amount_paise > 0),
  status               text not null check (status in ('created', 'paid', 'expired', 'cancelled', 'recorded')),
  razorpay_link_id     text,
  razorpay_payment_id  text,
  short_url            text,
  receipt_no           text,
  note                 text,
  recorded_by          text,
  created_at           timestamptz not null default now(),
  paid_at              timestamptz
);
create unique index if not exists clinic_payments_link on public.clinic_payments (razorpay_link_id) where razorpay_link_id is not null;
create index if not exists clinic_payments_appt on public.clinic_payments (appointment_id);

do $$
declare t text;
begin
  foreach t in array array['clinic_settings', 'clinic_doctors', 'clinic_doctor_hours', 'clinic_doctor_days_off', 'clinic_appointments', 'clinic_payments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- A doctor's login may read its own row (id, business, name, active) to open the doctor area. Nothing else.
grant select (id, business_id, user_id, name, active) on public.clinic_doctors to authenticated;
drop policy if exists clinic_doctors_read_own on public.clinic_doctors;
create policy clinic_doctors_read_own on public.clinic_doctors for select to authenticated using (user_id = auth.uid());

-- One login = one place: a doctor can't also be staff or a platform admin, and the other way round.
create or replace function public.clinic_doctor_login_check()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is not null and (
       exists (select 1 from public.staff_members s where s.user_id = new.user_id)
    or exists (select 1 from public.platform_admins p where p.user_id = new.user_id)
    or exists (select 1 from public.clinic_doctors d where d.user_id = new.user_id and d.id <> new.id)) then
    raise exception 'This login already belongs to someone else (staff, platform or another doctor).';
  end if;
  return new;
end $$;
drop trigger if exists clinic_doctor_login_check on public.clinic_doctors;
create trigger clinic_doctor_login_check before insert or update of user_id on public.clinic_doctors
  for each row execute function public.clinic_doctor_login_check();

create or replace function public.staff_not_doctor_check()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.clinic_doctors d where d.user_id = new.user_id) then
    raise exception 'This login is a doctor and can''t also be staff.';
  end if;
  return new;
end $$;
drop trigger if exists staff_not_doctor_check on public.staff_members;
create trigger staff_not_doctor_check before insert or update of user_id on public.staff_members
  for each row execute function public.staff_not_doctor_check();

-- The login id for an email (inviting a doctor who already has a login). Server only.
create or replace function public.clinic_user_id_for_email(p_email text)
returns uuid language sql security definer set search_path = public as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1
$$;
revoke all on function public.clinic_user_id_for_email(text) from public, anon, authenticated;
grant execute on function public.clinic_user_id_for_email(text) to service_role;
revoke all on function public.clinic_doctor_login_check() from public, anon, authenticated;
revoke all on function public.staff_not_doctor_check() from public, anon, authenticated;

-- Check:
select table_name from information_schema.tables
 where table_schema = 'public' and table_name like 'clinic_%' order by 1;
