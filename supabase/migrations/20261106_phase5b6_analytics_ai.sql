-- =====================================================================
-- Phase 5b (analytics) + Phase 6 (AI assistant).
--
-- Run once in Supabase -> SQL Editor, AFTER the Phase 1-4 files. Safe to re-run.
-- =====================================================================

-- 1. Faster date-range reads for the analytics dashboard -------------------
create index if not exists whatsapp_leads_created_idx   on public.whatsapp_leads (created_at);
create index if not exists whatsapp_messages_time_idx   on public.whatsapp_messages ("timestamp");
create index if not exists contact_events_time_idx      on public.contact_events (created_at, event_type);

-- 2. AI assistant settings (one row, id = 'main') ---------------------------
create table if not exists public.ai_settings (
  id             text primary key default 'main' check (id = 'main'),
  -- Answer free-text customer questions automatically (instead of showing the menu).
  auto_reply     boolean not null default false,
  -- Knowledge the assistant may use besides the bot menu/catalog: delivery areas,
  -- timings, how ordering works, payment options, FAQs. Plain text.
  knowledge      text not null default '',
  -- Extra instructions on tone/language, e.g. "Reply in Telugu if the customer writes Telugu".
  instructions   text not null default '',
  updated_by     text,
  updated_at     timestamptz not null default now()
);

-- Starts empty and switched off: fill in your real details in the dashboard
-- (AI Assistant screen) before turning auto-replies on.
insert into public.ai_settings (id) values ('main') on conflict (id) do nothing;

alter table public.ai_settings enable row level security;
drop policy if exists "staff full access" on public.ai_settings;
create policy "staff full access" on public.ai_settings
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
revoke all on public.ai_settings from anon;

-- Check:
select id, auto_reply, length(knowledge) as knowledge_chars from public.ai_settings;
