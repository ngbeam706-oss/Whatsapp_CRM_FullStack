-- WhatsApp voice calls (WhatsApp Business Calling API), per business.
-- A customer taps the call button in WhatsApp -> Meta sends a "calls" webhook (event "connect") with the
-- call's WebRTC offer -> the dashboard rings -> a staff member answers in the browser (pre_accept with the
-- browser's answer, then accept once the audio connection is up) or declines (reject). "terminate" events
-- close the call.
-- Server-only table: the browser reads calls through the API (which checks the staff member's business),
-- never directly. Safe to re-run.

create table if not exists public.whatsapp_calls (
  business_id     uuid not null references public.businesses(id) on delete cascade,
  id              text not null,                       -- Meta's call id (wacid....)
  phone           text not null,                       -- customer's number (digits)
  contact_name    text,
  direction       text not null default 'USER_INITIATED',
  status          text not null default 'ringing'
                  check (status in ('ringing', 'answering', 'answered', 'declined', 'missed', 'ended', 'failed')),
  offer_sdp       text,                                -- Meta's WebRTC offer; cleared when the call ends
  answer_sdp      text,                                -- the browser's answer (pre_accept and accept must match)
  answered_by     text,                                -- staff email
  answered_at     timestamptz,
  ended_at        timestamptz,
  duration_sec    integer,
  end_reason      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (business_id, id)
);

-- (for anyone who ran an earlier copy of this file)
alter table public.whatsapp_calls add column if not exists answer_sdp text;

create index if not exists whatsapp_calls_recent on public.whatsapp_calls (business_id, created_at desc);

alter table public.whatsapp_calls enable row level security;
revoke all on public.whatsapp_calls from anon, authenticated;
