-- =====================================================================
-- Phase 6b: choose the AI provider + API key in the dashboard.
--
-- Run once in Supabase -> SQL Editor, AFTER 20261106_phase5b6_analytics_ai.sql.
-- Safe to re-run.
--
-- The API key is stored ENCRYPTED by the server (AES-256-GCM), and this table
-- has Row Level Security ON with NO policies: browser logins (staff included)
-- cannot read it at all. Only the server, using the secret service key, can.
-- =====================================================================

create table if not exists public.ai_provider (
  id           text primary key default 'main' check (id = 'main'),
  provider     text not null default 'anthropic'
               check (provider in ('anthropic', 'openai', 'gemini', 'openai_compatible')),
  model        text not null default '',
  base_url     text,                 -- only for 'openai_compatible'
  api_key_enc  text,                 -- encrypted; never sent to the browser
  key_last4    text,                 -- shown as ••••1234 so you can tell which key is saved
  updated_by   text,
  updated_at   timestamptz not null default now()
);

alter table public.ai_provider enable row level security;
-- No policies on purpose: only the service role (server) can read or write.
revoke all on public.ai_provider from anon, authenticated;

insert into public.ai_provider (id) values ('main') on conflict (id) do nothing;

-- Check (shows no key):
select provider, model, key_last4 is not null as has_key from public.ai_provider;
