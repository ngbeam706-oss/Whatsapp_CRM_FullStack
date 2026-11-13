-- Inbox essentials: close a chat with a reason, team saved replies, photos / PDFs / voice notes in chats.
-- (New-chat alerts need no table: they go over the business's existing Realtime channel.) Safe to re-run.

-- 1. Closing a chat: why, who, when. A new customer message or a staff reply reopens it (server/inbox.cjs).
alter table public.whatsapp_leads add column if not exists closed_at     timestamptz;
alter table public.whatsapp_leads add column if not exists closed_reason text;
alter table public.whatsapp_leads add column if not exists closed_by     text;
alter table public.whatsapp_leads add column if not exists close_note    text;
do $$ begin
  alter table public.whatsapp_leads add constraint whatsapp_leads_closed_reason_check
    check (closed_reason is null or closed_reason in ('booked', 'resolved', 'not_interested', 'no_response', 'spam', 'other'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.whatsapp_leads add constraint whatsapp_leads_close_note_check check (close_note is null or char_length(close_note) <= 300);
exception when duplicate_object then null; end $$;
create index if not exists whatsapp_leads_open_idx on public.whatsapp_leads (business_id, closed_at, last_contacted_at desc);

-- 2. Saved replies: the team's own quick replies (managers and the Business Admin edit; everyone uses them).
create table if not exists public.saved_replies (
  id          bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  shortcut    text not null check (shortcut ~ '^[a-z0-9_-]{1,30}$'),
  title       text not null check (char_length(title) between 1 and 60),
  body        text not null check (char_length(body) between 1 and 1000),
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (business_id, shortcut)
);
create index if not exists saved_replies_business_idx on public.saved_replies (business_id, shortcut);
alter table public.saved_replies enable row level security;
revoke all on public.saved_replies from anon, authenticated;   -- server-only (business-scoped in server/savedReplies.cjs)

-- 3. Media in chats: Meta's media id, type, file name and size; media_path = our private copy (bucket inbox-media),
--    made when someone first opens it (incoming) or when staff upload it (outgoing).
alter table public.whatsapp_messages add column if not exists media_id   text;
alter table public.whatsapp_messages add column if not exists media_mime text;
alter table public.whatsapp_messages add column if not exists media_name text;
alter table public.whatsapp_messages add column if not exists media_size integer;
alter table public.whatsapp_messages add column if not exists media_path text;
