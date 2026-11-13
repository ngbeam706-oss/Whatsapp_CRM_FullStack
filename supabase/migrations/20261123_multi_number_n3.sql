-- Several WhatsApp numbers per business, phase N3: plan limit on how many numbers a business may connect
-- (main + extra). Starter 1, Growth 2, Pro 5; the Platform Admin can change them (Plans) or override per
-- business (limit_overrides.max_whatsapp_numbers). null = unlimited. Safe to re-run: the starting values are
-- only written when the column is first created, so later changes made on the console are kept.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'plans' and column_name = 'max_whatsapp_numbers'
  ) then
    alter table public.plans add column max_whatsapp_numbers int check (max_whatsapp_numbers is null or max_whatsapp_numbers >= 0);
    update public.plans set max_whatsapp_numbers = case id when 'starter' then 1 when 'growth' then 2 when 'pro' then 5 else 1 end;
  end if;
end $$;
