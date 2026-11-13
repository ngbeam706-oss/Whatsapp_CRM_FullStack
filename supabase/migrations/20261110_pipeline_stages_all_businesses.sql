-- =====================================================================
-- Pipeline stages for every kind of business (hospitals, food, shops, services).
-- Run BEFORE deploying the matching app update. Safe to re-run.
--
-- Internal keys stay the same, so no contact changes stage. Only one stage is added:
--   new        -> "New enquiry"
--   interested -> "In discussion"
--   ordered    -> "Booked"      (appointment booked / order placed)
--   completed  -> "Completed"   (visited, treated or delivered)   <- NEW
--   repeat     -> "Returning"   (follow-up visit / another order)
--   lost       -> "Closed"
-- =====================================================================

alter table public.whatsapp_leads drop constraint if exists whatsapp_leads_stage_check;
alter table public.whatsapp_leads add constraint whatsapp_leads_stage_check
  check (stage in ('new', 'interested', 'ordered', 'completed', 'repeat', 'lost'));

-- Check: how many contacts are in each stage.
select stage, count(*) from public.whatsapp_leads group by stage order by stage;
