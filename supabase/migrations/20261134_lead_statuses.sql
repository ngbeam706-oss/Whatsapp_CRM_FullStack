-- Lead statuses per business (replaces the six fixed pipeline stages). docs/progress/lead-statuses.md
--
-- Each business has its own list (up to 12): label, colour, order, active/hidden and a fixed TYPE:
--   new | working | won | done | repeat | lost
-- Everything automatic (bot moves, bookings to Meta, analytics, team ranking) uses the TYPE, never the label.
-- whatsapp_leads.stage keeps the status KEY. Existing keys stay as they are, so no contact moves:
--   new -> type new, interested -> working, ordered -> won, completed -> done, repeat -> repeat, lost -> lost.
-- Every existing business gets its current six (same names). New businesses get a starting list for their
-- industry from the server on first use. Server-only table (the browser goes through /api/lead-statuses).
-- Safe to re-run.

-- 1. The list --------------------------------------------------------------------------------
create table if not exists public.lead_statuses (
  business_id  uuid not null references public.businesses(id) on delete cascade,
  key          text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label        text not null check (char_length(label) between 1 and 30),
  hint         text check (char_length(hint) <= 120),
  color        text not null default 'slate',
  type         text not null check (type in ('new', 'working', 'won', 'done', 'repeat', 'lost')),
  sort_order   int  not null default 0,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (business_id, key)
);
create index if not exists lead_statuses_order_idx on public.lead_statuses (business_id, sort_order);
-- The built-in "new" status is where every new chat starts: always type new.
alter table public.lead_statuses drop constraint if exists lead_statuses_new_is_new;
alter table public.lead_statuses add constraint lead_statuses_new_is_new check (key <> 'new' or (type = 'new' and active));

alter table public.lead_statuses enable row level security;
revoke all on public.lead_statuses from anon, authenticated;

-- 2. Contacts may now hold any status key of their business (custom keys look like s_ab12cd) --------
alter table public.whatsapp_leads drop constraint if exists whatsapp_leads_stage_check;
alter table public.whatsapp_leads add constraint whatsapp_leads_stage_check
  check (stage ~ '^[a-z][a-z0-9_]{0,39}$');

-- 3. Existing businesses: today's six, same names and hints -----------------------------------
insert into public.lead_statuses (business_id, key, label, hint, color, type, sort_order)
select b.id, s.key, s.label, s.hint, s.color, s.type, s.sort_order
  from public.businesses b
  cross join (values
    ('new',        'New enquiry',   'Just reached out',                                         'slate',   'new',     1),
    ('interested', 'In discussion', 'Asking about services, doctors, prices or timings',        'amber',   'working', 2),
    ('ordered',    'Booked',        'Appointment booked or order placed',                       'sky',     'won',     3),
    ('completed',  'Completed',     'Visited, treated or delivered',                            'violet',  'done',    4),
    ('repeat',     'Returning',     'Came back for a follow-up, another visit or another order', 'emerald', 'repeat',  5),
    ('lost',       'Closed',        'Not going ahead, or gone quiet',                           'rose',    'lost',    6)
  ) as s(key, label, hint, color, type, sort_order)
 where not exists (select 1 from public.lead_statuses x where x.business_id = b.id)
on conflict (business_id, key) do nothing;

-- Check:
select count(distinct business_id) as businesses, count(*) as statuses from public.lead_statuses;
