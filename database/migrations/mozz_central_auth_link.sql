-- ==============================================================================
-- MOZZ / Starters4U Database: Central SMAV Auth Linkage Migration
-- Target Database: https://uyqdnqbadfysnbzbncyj.supabase.co (MOZZ / Starters4U)
--
-- Instructions:
-- Run this SQL in the SQL Editor of MOZZ / Starters4U Supabase project.
-- This migration PRESERVES all existing tables, menus, tables, orders,
-- and branch data. It only adds central auth federation metadata.
-- ==============================================================================

BEGIN;

-- 1. Ensure staff/users table in MOZZ has central auth linkage columns
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'staff') THEN
    ALTER TABLE public.staff
      ADD COLUMN IF NOT EXISTS central_auth_id UUID,
      ADD COLUMN IF NOT EXISTS central_auth_status TEXT NOT NULL DEFAULT 'PENDING_ACTIVATION',
      ADD COLUMN IF NOT EXISTS central_auth_linked_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS central_outlet_code TEXT DEFAULT 'mozz';

    CREATE INDEX IF NOT EXISTS idx_mozz_staff_central_auth ON public.staff(central_auth_id);
  END IF;

  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users') THEN
    ALTER TABLE public.users
      ADD COLUMN IF NOT EXISTS central_auth_id UUID,
      ADD COLUMN IF NOT EXISTS central_auth_status TEXT NOT NULL DEFAULT 'PENDING_ACTIVATION',
      ADD COLUMN IF NOT EXISTS central_auth_linked_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS central_outlet_code TEXT DEFAULT 'mozz';

    CREATE INDEX IF NOT EXISTS idx_mozz_users_central_auth ON public.users(central_auth_id);
  END IF;
END $$;

-- 2. Dynamically create status view matching whichever table exists in this database
DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users') THEN
    EXECUTE 'CREATE OR REPLACE VIEW public.vw_smav_restaurant_staff_status AS
      SELECT 
        u.id AS local_user_id,
        u.email,
        COALESCE(u.full_name, u.email) AS name,
        u.role,
        COALESCE(u.is_active, true) AS is_active,
        u.central_auth_id,
        u.central_auth_status,
        u.central_auth_linked_at,
        CASE 
          WHEN u.central_auth_id IS NOT NULL AND u.central_auth_status = ''ACTIVE'' THEN ''READY_FOR_SMAV_RESTAURANT_POS''
          WHEN u.central_auth_id IS NOT NULL THEN ''ACTIVATION_PENDING''
          ELSE ''NEEDS_CENTRAL_LINK''
        END AS smav_access_status
      FROM public.users u;';

  ELSIF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'staff') THEN
    EXECUTE 'CREATE OR REPLACE VIEW public.vw_smav_restaurant_staff_status AS
      SELECT 
        s.id AS local_user_id,
        s.email,
        COALESCE(s.name, s.email) AS name,
        s.role,
        COALESCE(s.is_active, true) AS is_active,
        s.central_auth_id,
        s.central_auth_status,
        s.central_auth_linked_at,
        CASE 
          WHEN s.central_auth_id IS NOT NULL AND s.central_auth_status = ''ACTIVE'' THEN ''READY_FOR_SMAV_RESTAURANT_POS''
          WHEN s.central_auth_id IS NOT NULL THEN ''ACTIVATION_PENDING''
          ELSE ''NEEDS_CENTRAL_LINK''
        END AS smav_access_status
      FROM public.staff s;';

  ELSE
    -- If MOZZ uses custom tables or purely central auth, create dedicated tracking table
    CREATE TABLE IF NOT EXISTS public.smav_staff_links (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'staff',
      is_active BOOLEAN NOT NULL DEFAULT true,
      central_auth_id UUID,
      central_auth_status TEXT NOT NULL DEFAULT 'PENDING_ACTIVATION',
      central_auth_linked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    EXECUTE 'CREATE OR REPLACE VIEW public.vw_smav_restaurant_staff_status AS
      SELECT 
        l.id AS local_user_id,
        l.email,
        l.name,
        l.role,
        l.is_active,
        l.central_auth_id,
        l.central_auth_status,
        l.central_auth_linked_at,
        CASE 
          WHEN l.central_auth_id IS NOT NULL AND l.central_auth_status = ''ACTIVE'' THEN ''READY_FOR_SMAV_RESTAURANT_POS''
          WHEN l.central_auth_id IS NOT NULL THEN ''ACTIVATION_PENDING''
          ELSE ''NEEDS_CENTRAL_LINK''
        END AS smav_access_status
      FROM public.smav_staff_links l;';
  END IF;
END $$;

COMMENT ON VIEW public.vw_smav_restaurant_staff_status IS 
'Readiness status of MOZZ restaurant staff for unified Central SMAV Restaurant POS login';

COMMIT;
