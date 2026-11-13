-- Platform branding: the application's own name, logo, company and contact details (Platform console ->
-- Branding). Used by the public website, the Privacy Policy / Terms, the sign-in page and the dashboard header.
-- Stored on the one platform_settings row (server-only: RLS on, no grants; the server reads it with the service
-- key and publishes only these public details at GET /api/public/branding and the logo at GET /api/public/logo).
-- Safe to re-run.

alter table public.platform_settings add column if not exists branding jsonb not null default '{}'::jsonb;
alter table public.platform_settings add column if not exists brand_logo text;              -- base64 (PNG / JPEG / WebP, at most 300 KB)
alter table public.platform_settings add column if not exists brand_logo_type text;
alter table public.platform_settings add column if not exists brand_logo_updated_at timestamptz;
alter table public.platform_settings add column if not exists branding_updated_by text;
alter table public.platform_settings add column if not exists branding_updated_at timestamptz;

do $$ begin
  alter table public.platform_settings add constraint platform_settings_branding_object check (jsonb_typeof(branding) = 'object');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.platform_settings add constraint platform_settings_brand_logo_type check (brand_logo_type is null or brand_logo_type in ('image/png', 'image/jpeg', 'image/webp'));
exception when duplicate_object then null; end $$;
do $$ begin
  -- 300 KB of image is at most 409,600 base64 characters.
  alter table public.platform_settings add constraint platform_settings_brand_logo_size check (brand_logo is null or length(brand_logo) <= 409600);
exception when duplicate_object then null; end $$;

-- Still server-only (as created in 20261117).
alter table public.platform_settings enable row level security;
revoke all on public.platform_settings from anon, authenticated;
