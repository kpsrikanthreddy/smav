-- Run in SMAV central Supabase ONLY, after reviewing existing policies.
-- No fake outlets or credentials are inserted.
BEGIN;
ALTER TABLE public.smav_outlets
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.smav_outlets ENABLE ROW LEVEL SECURITY;
-- Security definer avoids self-referential RLS recursion on smav_profiles.
CREATE OR REPLACE FUNCTION public.smav_is_superadmin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$ SELECT EXISTS (
  SELECT 1 FROM public.smav_profiles
  WHERE id = (SELECT auth.uid()) AND platform_role = 'SUPERADMIN' AND is_active = true
); $$;
REVOKE ALL ON FUNCTION public.smav_is_superadmin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.smav_is_superadmin() TO authenticated;
DROP POLICY IF EXISTS "superadmin_manage_profiles" ON public.smav_profiles;
DROP POLICY IF EXISTS "smav_superadmin_outlets_select" ON public.smav_outlets;
DROP POLICY IF EXISTS "smav_superadmin_outlets_insert" ON public.smav_outlets;
DROP POLICY IF EXISTS "smav_superadmin_outlets_update" ON public.smav_outlets;
CREATE POLICY "smav_superadmin_outlets_select" ON public.smav_outlets
  FOR SELECT TO authenticated USING ((SELECT public.smav_is_superadmin()));
CREATE POLICY "smav_superadmin_outlets_insert" ON public.smav_outlets
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.smav_is_superadmin()));
CREATE POLICY "smav_superadmin_outlets_update" ON public.smav_outlets
  FOR UPDATE TO authenticated USING ((SELECT public.smav_is_superadmin()))
  WITH CHECK ((SELECT public.smav_is_superadmin()));
COMMIT;
