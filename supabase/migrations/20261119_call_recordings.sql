-- WhatsApp call recordings (Phase 1: calls answered by staff in the dashboard).
--
-- The answering browser records both sides and uploads the audio straight to a PRIVATE storage bucket
-- (pieces every 10 s while the call runs, the whole file when it ends). The server hands out short-lived
-- upload and playback links only after checking who is asking; the browser never gets a lasting link.
-- If the browser closes mid-call, the worker joins the uploaded pieces. Recordings are deleted after
-- 90 days. Who may listen: the person who answered, managers and the Business Admin, and the agent the
-- chat is assigned to. Each playback is written to audit_log. Safe to re-run.

alter table public.whatsapp_calls add column if not exists recording_status text
  check (recording_status in ('recording', 'ready', 'failed', 'deleted'));
alter table public.whatsapp_calls add column if not exists recording_path text;     -- object path in the bucket
alter table public.whatsapp_calls add column if not exists recording_bytes bigint;
alter table public.whatsapp_calls add column if not exists recording_seconds integer;
alter table public.whatsapp_calls add column if not exists recording_started_at timestamptz;

create index if not exists whatsapp_calls_recording_idx on public.whatsapp_calls (recording_status, created_at)
  where recording_status in ('recording', 'ready');

-- The private bucket (no public links; no browser policies, so only the server's key can reach it).
-- (The server also creates it on first use if this part could not run.)
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('wa-call-recordings', 'wa-call-recordings', false, 52428800, array['audio/webm', 'audio/ogg', 'audio/mp4'])
    on conflict (id) do update set public = false;
  end if;
end $$;
