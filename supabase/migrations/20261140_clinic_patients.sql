-- Clinic module, part 2: patient details, case-sheet photos and follow-up dates. docs/progress/clinic.md
--
-- * clinic_patients: one row per patient (several patients can share one WhatsApp number, e.g. a family). The agent
--   fills the details when booking; the doctor sees them (never the phone number).
-- * clinic_appointments gains the patient, the reason for the visit and the doctor's follow-up date.
-- * clinic_case_sheets: photos of the doctor's written case sheet, stored privately in Cloudinary (type
--   "authenticated", server/cloudinary.cjs) or, when Cloudinary isn't configured, the private Supabase bucket
--   "case-sheets"; shown to doctors through short-lived signed links. On a return visit the earlier sheets load.
-- Server-only (RLS on, no grants). Safe to re-run.

create table if not exists public.clinic_patients (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  lead_phone   text not null,
  name         text not null,
  age_years    int check (age_years is null or age_years between 0 and 130),
  age_on       date not null default current_date,       -- the day the age was given (age grows from here)
  gender       text check (gender is null or gender in ('female', 'male', 'other')),
  city         text,
  allergies    text,
  conditions   text,                                      -- existing conditions / regular medicines
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists clinic_patients_phone on public.clinic_patients (business_id, lead_phone);

alter table public.clinic_appointments add column if not exists patient_id uuid references public.clinic_patients(id) on delete set null;
alter table public.clinic_appointments add column if not exists reason text;
alter table public.clinic_appointments add column if not exists follow_up_on date;
alter table public.clinic_appointments add column if not exists follow_up_note text;
alter table public.clinic_appointments add column if not exists follow_up_set_by text;
alter table public.clinic_appointments add column if not exists follow_up_set_at timestamptz;
alter table public.clinic_appointments add column if not exists follow_up_done_at timestamptz;
alter table public.clinic_appointments add column if not exists follow_up_done_by text;
create index if not exists clinic_appointments_patient on public.clinic_appointments (business_id, patient_id);
create index if not exists clinic_appointments_follow_up on public.clinic_appointments (business_id, follow_up_on)
  where follow_up_on is not null and follow_up_done_at is null;

create table if not exists public.clinic_case_sheets (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  appointment_id  uuid not null references public.clinic_appointments(id) on delete cascade,
  patient_id      uuid references public.clinic_patients(id) on delete cascade,
  doctor_id       uuid references public.clinic_doctors(id) on delete set null,
  path            text not null,
  mime            text not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes      int not null check (size_bytes > 0),
  uploaded_by     text,
  created_at      timestamptz not null default now()
);
-- Where the photo is: 'cloudinary' (path = the private Cloudinary public id) or 'supabase' (path in the bucket).
alter table public.clinic_case_sheets add column if not exists provider text not null default 'supabase';
alter table public.clinic_case_sheets drop constraint if exists clinic_case_sheets_provider_check;
alter table public.clinic_case_sheets add constraint clinic_case_sheets_provider_check check (provider in ('supabase', 'cloudinary'));
create index if not exists clinic_case_sheets_appt on public.clinic_case_sheets (appointment_id);
create index if not exists clinic_case_sheets_patient on public.clinic_case_sheets (business_id, patient_id);

do $$
declare t text;
begin
  foreach t in array array['clinic_patients', 'clinic_case_sheets'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Check:
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'clinic_appointments' and column_name in ('patient_id', 'reason', 'follow_up_on') order by 1;
