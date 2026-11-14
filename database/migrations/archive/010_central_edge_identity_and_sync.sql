-- ==============================================================================
-- Migration: 010_central_edge_identity_and_sync.sql
-- Run in CENTRAL SMAV Supabase project ONLY (qykdwswatopylzvqhgog.supabase.co).
-- Description: Creates smav_external_identities for secure username resolution,
--              external portal identity federation, and Edge Function support.
-- ==============================================================================

BEGIN;

-- 1. Create smav_external_identities table for username-to-email mapping
CREATE TABLE IF NOT EXISTS public.smav_external_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  email text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source text NOT NULL, -- e.g. 'glossylooks', 'mozz', 'retail1', 'central'
  outlet_code text NOT NULL,
  external_staff_id text,
  external_role text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Indexes for fast, enumeration-safe identity lookup
CREATE UNIQUE INDEX IF NOT EXISTS idx_smav_ext_ident_username_source 
  ON public.smav_external_identities (LOWER(username), LOWER(source));

CREATE INDEX IF NOT EXISTS idx_smav_ext_ident_email 
  ON public.smav_external_identities (LOWER(email));

CREATE INDEX IF NOT EXISTS idx_smav_ext_ident_external_id 
  ON public.smav_external_identities (external_staff_id, source);

CREATE INDEX IF NOT EXISTS idx_smav_ext_ident_outlet 
  ON public.smav_external_identities (LOWER(outlet_code));

-- 3. Row Level Security policies
ALTER TABLE public.smav_external_identities ENABLE ROW LEVEL SECURITY;

-- Superadmins can view and manage all external identities
DROP POLICY IF EXISTS "superadmin_all_external_identities" ON public.smav_external_identities;
CREATE POLICY "superadmin_all_external_identities" ON public.smav_external_identities
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.smav_profiles sp
      WHERE sp.id = (SELECT auth.uid())
        AND UPPER(sp.platform_role) = 'SUPERADMIN'
        AND sp.is_active = true
    )
  );

-- Admins can view external identities for their assigned outlet
DROP POLICY IF EXISTS "admin_view_assigned_external_identities" ON public.smav_external_identities;
CREATE POLICY "admin_view_assigned_external_identities" ON public.smav_external_identities
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.smav_user_outlet_roles uor
      JOIN public.smav_outlets o ON o.id = uor.outlet_id
      WHERE uor.user_id = (SELECT auth.uid())
        AND uor.is_active = true
        AND UPPER(uor.role) IN ('ADMIN', 'OWNER')
        AND (
          LOWER(o.code) = LOWER(smav_external_identities.outlet_code)
          OR LOWER(COALESCE(o.outlet_code, '')) = LOWER(smav_external_identities.outlet_code)
          OR LOWER(COALESCE(o.branch_code, '')) = LOWER(smav_external_identities.outlet_code)
        )
    )
  );

-- Users can view their own identity mapping
DROP POLICY IF EXISTS "users_view_own_external_identity" ON public.smav_external_identities;
CREATE POLICY "users_view_own_external_identity" ON public.smav_external_identities
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- 4. Initial Seed for known business usernames (Idempotent)
INSERT INTO public.smav_external_identities (username, email, source, outlet_code, external_staff_id, external_role)
VALUES 
  ('superadmin', 'superadmin@smav.io', 'central', 'smav', 'sa_01', 'SUPERADMIN'),
  ('srikanth_owner', 'kpsrikanthreddy@gmail.com', 'glossylooks', 'glossylooks', 'gl_owner_01', 'OWNER'),
  ('srikanth_owner', 'kpsrikanthreddy@gmail.com', 'mozz', 'mozz', 'mozz_owner_01', 'OWNER'),
  ('ramesh_gl', 'ramesh@glossylooks.com', 'glossylooks', 'glossylooks', 'gl_mgr_01', 'MANAGER'),
  ('ananya_reception', 'ananya@glossylooks.com', 'glossylooks', 'glossylooks', 'gl_rec_01', 'RECEPTIONIST'),
  ('manager_mozz', 'manager@starters4u.in', 'mozz', 'mozz', 'mozz_mgr_01', 'MANAGER'),
  ('vikram_cashier', 'vikram@starters4u.in', 'mozz', 'mozz', 'mozz_cashier_01', 'CASHIER')
ON CONFLICT (LOWER(username), LOWER(source)) DO UPDATE SET
  email = EXCLUDED.email,
  outlet_code = EXCLUDED.outlet_code,
  external_staff_id = EXCLUDED.external_staff_id,
  external_role = EXCLUDED.external_role,
  updated_at = now();

COMMIT;
