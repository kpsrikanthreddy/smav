-- ==============================================================================
-- Reusable Outlet Database: Central SMAV Auth Linkage Migration Template
-- Target Database: Any new Salon, Restaurant, Retail Store, or Future Outlet DB
--
-- Instructions:
--   1. Replace 'OUTLET_CODE_HERE' (e.g. 'glossylooks', 'mozz', 'trends_retail')
--      with the exact outlet_code registered in Central smav_outlets.
--   2. Run in the target outlet's Supabase SQL Editor.
--   3. Preserves all existing operational tables, menus, services, bills, and orders.
--   4. Never stores plaintext passwords in outlet tables.
-- ==============================================================================

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'staff') THEN
    ALTER TABLE public.staff
      ADD COLUMN IF NOT EXISTS central_auth_id UUID,
      ADD COLUMN IF NOT EXISTS username TEXT,
      ADD COLUMN IF NOT EXISTS central_auth_status TEXT NOT NULL DEFAULT 'ACTIVE',
      ADD COLUMN IF NOT EXISTS central_auth_linked_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS central_outlet_code TEXT DEFAULT 'OUTLET_CODE_HERE',
      ADD COLUMN IF NOT EXISTS central_sync_version BIGINT NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS central_last_synced_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS central_sync_origin TEXT DEFAULT 'outlet_admin';

    CREATE INDEX IF NOT EXISTS idx_staff_central_auth_id ON public.staff(central_auth_id);
    CREATE INDEX IF NOT EXISTS idx_staff_username ON public.staff(username);
  END IF;

  IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users') THEN
    ALTER TABLE public.users
      ADD COLUMN IF NOT EXISTS central_auth_id UUID,
      ADD COLUMN IF NOT EXISTS username TEXT,
      ADD COLUMN IF NOT EXISTS central_auth_status TEXT NOT NULL DEFAULT 'ACTIVE',
      ADD COLUMN IF NOT EXISTS central_auth_linked_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS central_outlet_code TEXT DEFAULT 'OUTLET_CODE_HERE',
      ADD COLUMN IF NOT EXISTS central_sync_version BIGINT NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS central_last_synced_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS central_sync_origin TEXT DEFAULT 'outlet_admin';

    CREATE INDEX IF NOT EXISTS idx_users_central_auth_id ON public.users(central_auth_id);
    CREATE INDEX IF NOT EXISTS idx_users_username ON public.users(username);
  END IF;

  IF NOT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'staff')
     AND NOT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users') THEN
    CREATE TABLE IF NOT EXISTS public.smav_staff_links (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT NOT NULL UNIQUE,
      username TEXT,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'staff',
      is_active BOOLEAN NOT NULL DEFAULT true,
      central_auth_id UUID,
      central_auth_status TEXT NOT NULL DEFAULT 'ACTIVE',
      central_auth_linked_at TIMESTAMPTZ,
      central_outlet_code TEXT DEFAULT 'OUTLET_CODE_HERE',
      central_sync_version BIGINT NOT NULL DEFAULT 1,
      central_last_synced_at TIMESTAMPTZ,
      central_sync_origin TEXT DEFAULT 'outlet_admin',
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_smav_staff_links_central_auth ON public.smav_staff_links(central_auth_id);
  END IF;
END $$;

COMMIT;
