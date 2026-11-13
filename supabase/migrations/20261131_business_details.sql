-- Business details: what the business is and how to reach it (My profile -> Business details, Business Admin).
-- About, registered name, contact phone / email / website, address, GSTIN, registration / licence number, opening
-- hours. One jsonb object on businesses, written only by the server (checked field by field in server/business.cjs);
-- staff of the business can read it (as the rest of their business row). Business information, not personal data.
-- Safe to re-run.

alter table public.businesses add column if not exists details jsonb not null default '{}'::jsonb;

do $$ begin
  alter table public.businesses
    add constraint businesses_details_object check (jsonb_typeof(details) = 'object' and pg_column_size(details) < 16000);
exception when duplicate_object then null;
end $$;
