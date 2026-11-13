-- Staff onboarding details: the Business Admin or a manager fills them in when adding a team member (and edits
-- them later on the Team page). Adds work and emergency-contact fields to staff_profiles (20261118).
--   Set by the Business Admin / managers only: employee_code, joined_on, work_location.
--   Also editable by the person on "My profile": full_name, phone, job_title, languages, address,
--   emergency_contact_name, emergency_contact_phone.
-- Who sees what is enforced by the API (server/staffStats.cjs): private fields (address, emergency contact,
-- employee details) go only to the person, the Business Admin, and managers for agents. Still server-only.
-- Deliberately no ID-card numbers or dates of birth (keep personal data to what's needed: DPDP Act).
-- Safe to re-run.

alter table public.staff_profiles add column if not exists employee_code text;
alter table public.staff_profiles add column if not exists joined_on date;
alter table public.staff_profiles add column if not exists work_location text;
alter table public.staff_profiles add column if not exists address text;
alter table public.staff_profiles add column if not exists emergency_contact_name text;
alter table public.staff_profiles add column if not exists emergency_contact_phone text;
alter table public.staff_profiles add column if not exists updated_by text;

do $$ begin
  alter table public.staff_profiles add constraint staff_profiles_employee_code_len check (char_length(employee_code) <= 30);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.staff_profiles add constraint staff_profiles_work_location_len check (char_length(work_location) <= 80);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.staff_profiles add constraint staff_profiles_address_len check (char_length(address) <= 200);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.staff_profiles add constraint staff_profiles_emergency_name_len check (char_length(emergency_contact_name) <= 80);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.staff_profiles add constraint staff_profiles_emergency_phone_len check (char_length(emergency_contact_phone) <= 20);
exception when duplicate_object then null; end $$;

-- An employee ID is unique within a business (when given).
create unique index if not exists staff_profiles_employee_code_uniq on public.staff_profiles (business_id, lower(employee_code)) where employee_code is not null;

alter table public.staff_profiles enable row level security;
revoke all on public.staff_profiles from anon, authenticated;
