-- Customer import, phases D3 + D4 (docs/progress/customer-import.md).
--
-- 1. lead_custom_fields.show_on_card: up to 2 fields shown on Pipeline cards (private ones only to managers and the
--    Business Admin; the server decides).
-- 2. lead_assignment_settings.import_owner_first: "imported customers go to the person named in their import" (off by
--    default). When on, an imported customer's first message stays with that person if they can take it; otherwise
--    normal assignment applies.
-- 3. whatsapp_leads.import_note_at: when the "First message after import" note was written (once per person).
-- Server-only tables, as before. Safe to re-run.

alter table public.lead_custom_fields add column if not exists show_on_card boolean not null default false;

alter table public.lead_assignment_settings add column if not exists import_owner_first boolean not null default false;

alter table public.whatsapp_leads add column if not exists import_note_at timestamptz;

-- Check:
select (select count(*) from public.lead_custom_fields where show_on_card) as card_fields,
       (select count(*) from public.lead_assignment_settings where import_owner_first) as import_owner_first_on;
