-- Customer import + custom fields, phases D1 + D2. docs/progress/customer-import.md
--
-- 1. lead_custom_fields: each business's own extra fields for its customers (CIBIL score, loan amount, EMI date…):
--    key, label, type (text / number / amount / date / choice / yesno), choice options, private flag, order, hidden.
-- 2. whatsapp_leads.custom: the values, as one JSON object per customer (GIN index for later filters), at most ~8 KB.
--    Import markers: imported_at / import_id (the import that CREATED the customer).
-- 3. lead_imports: one row per uploaded file (counts, options, consent, who, when, undo status; never the data);
--    lead_import_changes: what an import changed on customers who already existed (old values and the values written, for
--    Undo, 7 days; pruned by the worker after). One part (batch) at a time per import: lead_import_claim_batch /
--    lead_import_end_batch (counts added in SQL). Status history gets the source "import".
-- 4. Plan limits: max_custom_fields, max_import_rows_per_file, max_import_file_mb, max_import_rows_month.
-- Server-only tables (the browser goes through /api). Safe to re-run.

-- 1. Custom fields -----------------------------------------------------------------------------
create table if not exists public.lead_custom_fields (
  business_id  uuid not null references public.businesses(id) on delete cascade,
  key          text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label        text not null check (char_length(label) between 1 and 60),
  type         text not null check (type in ('text', 'number', 'amount', 'date', 'choice', 'yesno')),
  options      jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  private      boolean not null default false,
  hidden       boolean not null default false,
  sort_order   int not null default 0,
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (business_id, key)
);
create index if not exists lead_custom_fields_order_idx on public.lead_custom_fields (business_id, sort_order);
alter table public.lead_custom_fields enable row level security;
revoke all on public.lead_custom_fields from anon, authenticated;

-- 2. Values on each customer + import markers --------------------------------------------------
alter table public.whatsapp_leads add column if not exists custom jsonb not null default '{}'::jsonb;
alter table public.whatsapp_leads add column if not exists imported_at timestamptz;
alter table public.whatsapp_leads add column if not exists import_id uuid;
alter table public.whatsapp_leads drop constraint if exists whatsapp_leads_custom_check;
alter table public.whatsapp_leads add constraint whatsapp_leads_custom_check
  check (jsonb_typeof(custom) = 'object' and octet_length(custom::text) <= 9000);
create index if not exists whatsapp_leads_custom_gin on public.whatsapp_leads using gin (custom jsonb_path_ops);
create index if not exists whatsapp_leads_import_idx on public.whatsapp_leads (business_id, import_id) where import_id is not null;
create index if not exists whatsapp_leads_imported_idx on public.whatsapp_leads (business_id, imported_at) where imported_at is not null;

-- 3. Imports -------------------------------------------------------------------------------------
create table if not exists public.lead_imports (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  file_name      text not null check (char_length(file_name) between 1 and 200),
  file_rows      int  not null check (file_rows >= 0),
  row_from       int  not null check (row_from >= 1),
  row_to         int  not null check (row_to >= row_from - 1),
  status         text not null default 'running' check (status in ('running', 'done', 'stopped', 'undone')),
  options        jsonb not null default '{}'::jsonb,
  consent        boolean not null check (consent),
  created_count  int not null default 0,
  updated_count  int not null default 0,
  skipped_count  int not null default 0,
  rejected_count int not null default 0,
  rows_done      int not null default 0,
  created_by     text not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  finished_at    timestamptz,
  undone_at      timestamptz,
  undone_by      text,
  undo_result    jsonb
);
create index if not exists lead_imports_business_idx on public.lead_imports (business_id, created_at desc);
-- One import at a time per business.
create unique index if not exists lead_imports_one_running on public.lead_imports (business_id) where status = 'running';
alter table public.lead_imports enable row level security;
revoke all on public.lead_imports from anon, authenticated;

create table if not exists public.lead_import_changes (
  import_id    uuid not null references public.lead_imports(id) on delete cascade,
  business_id  uuid not null references public.businesses(id) on delete cascade,
  phone        text not null check (phone ~ '^\d{7,15}$'),
  before       jsonb not null,   -- { cols: { name: …, stage: … }, custom: { key: old value or null } }
  created_at   timestamptz not null default now(),
  primary key (import_id, phone)
);
create index if not exists lead_import_changes_business_idx on public.lead_import_changes (business_id, import_id);
alter table public.lead_import_changes enable row level security;
revoke all on public.lead_import_changes from anon, authenticated;
-- What the import WROTE (same shape as before): Undo puts a value back only while it still holds this value, so
-- later edits (a status changed by the team, a second import) are never overwritten.
alter table public.lead_import_changes add column if not exists after jsonb not null default '{}'::jsonb;
-- One part (batch) at a time per import; the old values are deleted after the 7-day Undo window (worker).
alter table public.lead_imports add column if not exists batch_started_at timestamptz;
alter table public.lead_imports add column if not exists changes_pruned_at timestamptz;

-- Start one part of an import: only while it is running, no other part is being saved (a stuck part is released
-- after 2 minutes) and the rows stay inside the import's row range. Returns the import, or nothing when refused.
create or replace function public.lead_import_claim_batch(p_business uuid, p_import uuid, p_rows int)
returns setof public.lead_imports
language sql security definer set search_path = public as $$
  update public.lead_imports
     set batch_started_at = now(), updated_at = now()
   where id = p_import and business_id = p_business and status = 'running'
     and p_rows > 0
     and (batch_started_at is null or batch_started_at < now() - interval '2 minutes')
     and rows_done + p_rows <= row_to - row_from + 1
  returning *;
$$;

-- End one part: add its counts in the database (never read-modify-write) and release the part lock.
create or replace function public.lead_import_end_batch(p_business uuid, p_import uuid, p_rows int, p_created int, p_updated int, p_skipped int, p_rejected int)
returns setof public.lead_imports
language sql security definer set search_path = public as $$
  update public.lead_imports
     set rows_done = rows_done + greatest(p_rows, 0),
         created_count = created_count + greatest(p_created, 0),
         updated_count = updated_count + greatest(p_updated, 0),
         skipped_count = skipped_count + greatest(p_skipped, 0),
         rejected_count = rejected_count + greatest(p_rejected, 0),
         batch_started_at = null, updated_at = now()
   where id = p_import and business_id = p_business
  returning *;
$$;
revoke execute on function public.lead_import_claim_batch(uuid, uuid, int) from public, anon, authenticated;
revoke execute on function public.lead_import_end_batch(uuid, uuid, int, int, int, int, int) from public, anon, authenticated;
grant execute on function public.lead_import_claim_batch(uuid, uuid, int) to service_role;
grant execute on function public.lead_import_end_batch(uuid, uuid, int, int, int, int, int) to service_role;

-- Status history: statuses set by an import ("overwrite" mode, or a status column for new people).
alter table public.lead_status_history drop constraint if exists lead_status_history_source_check;
alter table public.lead_status_history add constraint lead_status_history_source_check
  check (source in ('staff', 'bot', 'added', 'bulk', 'returning', 'import'));

-- 4. Plan limits (starting values only when a column is first created; later console edits are kept) ----------
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'plans' and column_name = 'max_custom_fields') then
    alter table public.plans add column max_custom_fields int check (max_custom_fields is null or max_custom_fields >= 0);
    update public.plans set max_custom_fields = case id when 'starter' then 10 when 'growth' then 25 when 'pro' then 50 else 10 end;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'plans' and column_name = 'max_import_rows_per_file') then
    alter table public.plans add column max_import_rows_per_file int check (max_import_rows_per_file is null or max_import_rows_per_file >= 0);
    update public.plans set max_import_rows_per_file = case id when 'starter' then 2000 when 'growth' then 10000 when 'pro' then 25000 else 2000 end;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'plans' and column_name = 'max_import_file_mb') then
    alter table public.plans add column max_import_file_mb int check (max_import_file_mb is null or max_import_file_mb >= 0);
    update public.plans set max_import_file_mb = case id when 'starter' then 2 when 'growth' then 5 when 'pro' then 10 else 2 end;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'plans' and column_name = 'max_import_rows_month') then
    alter table public.plans add column max_import_rows_month int check (max_import_rows_month is null or max_import_rows_month >= 0);
    update public.plans set max_import_rows_month = case id when 'starter' then 5000 when 'growth' then 25000 when 'pro' then 100000 else 5000 end;
  end if;
end $$;

-- Check:
select (select count(*) from public.lead_custom_fields) as custom_fields,
       (select count(*) from public.lead_imports) as imports,
       (select count(*) from public.plans where max_import_rows_per_file is not null) as plans_with_import_limits;
