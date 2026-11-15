-- Activity log, phases L1 + L2 + L3 (docs/progress/activity-log.md).
--
-- 1. audit_log.subject_phone: the customer an entry is about (a chat transfer, a renamed lead…). Only the server reads it:
--    the Business Admin's screen shows the customer's name (server-side), and the Platform console never gets it.
-- 2. audit_log.private_details: server-only details (sign-ins: device, approximate network, session, new-device flag).
-- 3. Column-level protection: signed-in browsers (role authenticated) may select only the original columns, so neither
--    the "owner read own audit" nor the "platform read audit" policy can expose the two new ones.
-- 4. One sign-in entry per session (unique on the session key), indexes for the Activity log screen and "last signed in".
-- Add-only as before (no insert / update / delete for browsers). Safe to re-run.

alter table public.audit_log add column if not exists subject_phone text check (subject_phone is null or subject_phone ~ '^\d{7,15}$');
alter table public.audit_log add column if not exists private_details jsonb;

-- 3. Browsers read only these columns (RLS still decides which rows). The server uses the service role.
revoke select on public.audit_log from authenticated;
grant select (id, business_id, actor_email, actor_role, action, details, created_at) on public.audit_log to authenticated;
revoke all on public.audit_log from anon;
revoke insert, update, delete on public.audit_log from authenticated;

-- 4. Activity log screen: one business, newest first, by action; sign-ins per person; one sign-in per session.
-- The screen pages newest-first by id inside one business (order=id.desc, id=lt.<last>).
drop index if exists public.audit_log_business_action_idx;
drop index if exists public.audit_log_signins_idx;
create index if not exists audit_log_business_id_idx on public.audit_log (business_id, id desc);
-- Security tab / "last signed in" (business, newest first) and "new device?" (this person's earlier sign-ins).
create index if not exists audit_log_signins_biz_idx on public.audit_log (business_id, id desc) where action = 'auth.signed_in';
create index if not exists audit_log_signins_person_idx on public.audit_log (actor_email, id desc) where action = 'auth.signed_in';
-- One sign-out entry per session (looked up by the session key).
create index if not exists audit_log_signout_session_idx on public.audit_log ((private_details->>'session')) where action = 'auth.signed_out';
-- The worker's 1-year prune (created_at < now - 365 days, every business).
create index if not exists audit_log_created_idx on public.audit_log (created_at);
create unique index if not exists audit_log_signin_session_key on public.audit_log ((private_details->>'session')) where action = 'auth.signed_in';

-- Check:
select count(*) filter (where subject_phone is not null) as entries_about_a_customer,
       count(*) filter (where action = 'auth.signed_in') as sign_ins
  from public.audit_log;
