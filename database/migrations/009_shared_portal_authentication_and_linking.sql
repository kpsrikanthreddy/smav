-- ==============================================================================
-- Migration: 009_shared_portal_authentication_and_linking.sql
-- Run in CENTRAL SMAV Supabase project ONLY.
-- Description: Establishes shared central identity mapping, portal staff linking,
--              external source tracking, and narrow outlet isolation policies.
-- ==============================================================================

BEGIN;

-- 1. Ensure external reference fields exist in smav_user_outlet_roles
ALTER TABLE public.smav_user_outlet_roles
  ADD COLUMN IF NOT EXISTS external_staff_id text,
  ADD COLUMN IF NOT EXISTS business_source text DEFAULT 'central',
  ADD COLUMN IF NOT EXISTS linked_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

-- 2. Indexes for fast identity resolution and tenant boundary enforcement
CREATE INDEX IF NOT EXISTS idx_uor_user_outlet_active 
  ON public.smav_user_outlet_roles(user_id, outlet_id, is_active);

CREATE INDEX IF NOT EXISTS idx_uor_external_staff
  ON public.smav_user_outlet_roles(external_staff_id, business_source);

-- 3. Ensure all compatible columns exist on smav_outlets before inserting/updating
ALTER TABLE public.smav_outlets
  ADD COLUMN IF NOT EXISTS outlet_code text,
  ADD COLUMN IF NOT EXISTS code text,
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS category text DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS branch_code text,
  ADD COLUMN IF NOT EXISTS business_id text,
  ADD COLUMN IF NOT EXISTS business_name text,
  ADD COLUMN IF NOT EXISTS business_type text,
  ADD COLUMN IF NOT EXISTS outlet_name text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS gstin text,
  ADD COLUMN IF NOT EXISTS receipt_header text,
  ADD COLUMN IF NOT EXISTS receipt_footer text,
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

-- Safely relax NOT NULL constraint on outlet_code if it was previously set as strictly required
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'smav_outlets' AND column_name = 'outlet_code' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.smav_outlets ALTER COLUMN outlet_code DROP NOT NULL;
  END IF;
END $$;

-- 4. Dynamically seed/update authoritative outlets supporting existing outlet_code rows
DO $$
DECLARE
  v_id_type text;
  v_glossy_exists boolean;
  v_mozz_exists boolean;
BEGIN
  SELECT data_type INTO v_id_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'smav_outlets' AND column_name = 'id';

  -- 4.1 Update or Insert Glossy Looks outlet
  SELECT EXISTS (SELECT 1 FROM public.smav_outlets WHERE outlet_code = 'glossylooks' OR code = 'glossylooks') INTO v_glossy_exists;

  IF v_glossy_exists THEN
    UPDATE public.smav_outlets SET
      outlet_code = 'glossylooks',
      code = COALESCE(code, 'glossylooks'),
      name = COALESCE(name, 'The Glossy Looks Salon & Spa (Gachibowli)'),
      category = COALESCE(category, 'salon'),
      branch_code = COALESCE(branch_code, 'glossylooks'),
      business_id = COALESCE(business_id, 'glossylooks_salon'),
      business_name = COALESCE(business_name, 'The Glossy Looks Salon & Spa'),
      business_type = COALESCE(business_type, 'SALON'),
      outlet_name = COALESCE(outlet_name, 'The Glossy Looks - Gachibowli Branch'),
      address = COALESCE(address, 'Plot 14, Silicon Valley Road, Gachibowli, Hyderabad, Telangana 500032'),
      phone = COALESCE(phone, '+91 98480 11223'),
      gstin = COALESCE(gstin, '36AABCT9988C1Z4'),
      receipt_header = COALESCE(receipt_header, E'The Glossy Looks Luxury Salon & Spa\nTel: +91 98480 11223'),
      receipt_footer = COALESCE(receipt_footer, 'Thank you for styling with us! Visit www.glossylooks.in'),
      is_active = true,
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'address', 'Plot 14, Silicon Valley Road, Gachibowli, Hyderabad, Telangana 500032',
        'phone', '+91 98480 11223',
        'gstin', '36AABCT9988C1Z4',
        'receiptHeader', E'The Glossy Looks Luxury Salon & Spa\nTel: +91 98480 11223',
        'receiptFooter', 'Thank you for styling with us! Visit www.glossylooks.in',
        'providerType', 'glossy_looks',
        'supabaseUrl', 'https://onswigwiwuvkvoduuhxr.supabase.co'
      )
    WHERE outlet_code = 'glossylooks' OR code = 'glossylooks';
  ELSE
    IF v_id_type = 'uuid' THEN
      INSERT INTO public.smav_outlets (
        id, outlet_code, code, name, category, branch_code, business_id, business_name, business_type, outlet_name,
        address, phone, gstin, receipt_header, receipt_footer, is_active, metadata
      ) VALUES (
        gen_random_uuid(), 'glossylooks', 'glossylooks', 'The Glossy Looks Salon & Spa (Gachibowli)',
        'salon', 'glossylooks', 'glossylooks_salon', 'The Glossy Looks Salon & Spa', 'SALON',
        'The Glossy Looks - Gachibowli Branch',
        'Plot 14, Silicon Valley Road, Gachibowli, Hyderabad, Telangana 500032',
        '+91 98480 11223', '36AABCT9988C1Z4',
        E'The Glossy Looks Luxury Salon & Spa\nTel: +91 98480 11223',
        'Thank you for styling with us! Visit www.glossylooks.in',
        true,
        jsonb_build_object(
          'address', 'Plot 14, Silicon Valley Road, Gachibowli, Hyderabad, Telangana 500032',
          'phone', '+91 98480 11223', 'gstin', '36AABCT9988C1Z4',
          'receiptHeader', E'The Glossy Looks Luxury Salon & Spa\nTel: +91 98480 11223',
          'receiptFooter', 'Thank you for styling with us! Visit www.glossylooks.in',
          'providerType', 'glossy_looks',
          'supabaseUrl', 'https://onswigwiwuvkvoduuhxr.supabase.co'
        )
      );
    ELSE
      INSERT INTO public.smav_outlets (
        id, outlet_code, code, name, category, branch_code, business_id, business_name, business_type, outlet_name,
        address, phone, gstin, receipt_header, receipt_footer, is_active, metadata
      ) VALUES (
        'outlet_glossy_gach', 'glossylooks', 'glossylooks', 'The Glossy Looks Salon & Spa (Gachibowli)',
        'salon', 'glossylooks', 'glossylooks_salon', 'The Glossy Looks Salon & Spa', 'SALON',
        'The Glossy Looks - Gachibowli Branch',
        'Plot 14, Silicon Valley Road, Gachibowli, Hyderabad, Telangana 500032',
        '+91 98480 11223', '36AABCT9988C1Z4',
        E'The Glossy Looks Luxury Salon & Spa\nTel: +91 98480 11223',
        'Thank you for styling with us! Visit www.glossylooks.in',
        true,
        jsonb_build_object(
          'address', 'Plot 14, Silicon Valley Road, Gachibowli, Hyderabad, Telangana 500032',
          'phone', '+91 98480 11223', 'gstin', '36AABCT9988C1Z4',
          'receiptHeader', E'The Glossy Looks Luxury Salon & Spa\nTel: +91 98480 11223',
          'receiptFooter', 'Thank you for styling with us! Visit www.glossylooks.in',
          'providerType', 'glossy_looks',
          'supabaseUrl', 'https://onswigwiwuvkvoduuhxr.supabase.co'
        )
      );
    END IF;
  END IF;

  -- 4.2 Update or Insert MOZZ outlet
  SELECT EXISTS (SELECT 1 FROM public.smav_outlets WHERE outlet_code = 'mozz' OR code = 'mozz') INTO v_mozz_exists;

  IF v_mozz_exists THEN
    UPDATE public.smav_outlets SET
      outlet_code = 'mozz',
      code = COALESCE(code, 'mozz'),
      name = COALESCE(name, 'MOZZ / Starters4U Restaurant & Diner (Gachibowli)'),
      category = COALESCE(category, 'restaurant'),
      branch_code = COALESCE(branch_code, 'mozz'),
      business_id = COALESCE(business_id, 'mozz_starters4u'),
      business_name = COALESCE(business_name, 'MOZZ Diner / Starters4U'),
      business_type = COALESCE(business_type, 'RESTAURANT'),
      outlet_name = COALESCE(outlet_name, 'MOZZ Starters4U Diner - Gachibowli'),
      address = COALESCE(address, 'Ground Floor, Cyber Gateway, Gachibowli, Hyderabad 500081'),
      phone = COALESCE(phone, '+91 98480 99887'),
      gstin = COALESCE(gstin, '36AABCS1234F1Z8'),
      receipt_header = COALESCE(receipt_header, E'MOZZ Starters4U Diner & KOT\nFast Casual Dining'),
      receipt_footer = COALESCE(receipt_footer, 'Thank you for dining with MOZZ! Order online at starters4u.in'),
      is_active = true,
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'address', 'Ground Floor, Cyber Gateway, Gachibowli, Hyderabad 500081',
        'phone', '+91 98480 99887',
        'gstin', '36AABCS1234F1Z8',
        'receiptHeader', E'MOZZ Starters4U Diner & KOT\nFast Casual Dining',
        'receiptFooter', 'Thank you for dining with MOZZ! Order online at starters4u.in',
        'providerType', 'starters4u',
        'supabaseUrl', 'https://uyqdnqbadfysnbzbncyj.supabase.co'
      )
    WHERE outlet_code = 'mozz' OR code = 'mozz';
  ELSE
    IF v_id_type = 'uuid' THEN
      INSERT INTO public.smav_outlets (
        id, outlet_code, code, name, category, branch_code, business_id, business_name, business_type, outlet_name,
        address, phone, gstin, receipt_header, receipt_footer, is_active, metadata
      ) VALUES (
        gen_random_uuid(), 'mozz', 'mozz', 'MOZZ / Starters4U Restaurant & Diner (Gachibowli)',
        'restaurant', 'mozz', 'mozz_starters4u', 'MOZZ Diner / Starters4U', 'RESTAURANT',
        'MOZZ Starters4U Diner - Gachibowli',
        'Ground Floor, Cyber Gateway, Gachibowli, Hyderabad 500081',
        '+91 98480 99887', '36AABCS1234F1Z8',
        E'MOZZ Starters4U Diner & KOT\nFast Casual Dining',
        'Thank you for dining with MOZZ! Order online at starters4u.in',
        true,
        jsonb_build_object(
          'address', 'Ground Floor, Cyber Gateway, Gachibowli, Hyderabad 500081',
          'phone', '+91 98480 99887', 'gstin', '36AABCS1234F1Z8',
          'receiptHeader', E'MOZZ Starters4U Diner & KOT\nFast Casual Dining',
          'receiptFooter', 'Thank you for dining with MOZZ! Order online at starters4u.in',
          'providerType', 'starters4u',
          'supabaseUrl', 'https://uyqdnqbadfysnbzbncyj.supabase.co'
        )
      );
    ELSE
      INSERT INTO public.smav_outlets (
        id, outlet_code, code, name, category, branch_code, business_id, business_name, business_type, outlet_name,
        address, phone, gstin, receipt_header, receipt_footer, is_active, metadata
      ) VALUES (
        'outlet_mozz_gach', 'mozz', 'mozz', 'MOZZ / Starters4U Restaurant & Diner (Gachibowli)',
        'restaurant', 'mozz', 'mozz_starters4u', 'MOZZ Diner / Starters4U', 'RESTAURANT',
        'MOZZ Starters4U Diner - Gachibowli',
        'Ground Floor, Cyber Gateway, Gachibowli, Hyderabad 500081',
        '+91 98480 99887', '36AABCS1234F1Z8',
        E'MOZZ Starters4U Diner & KOT\nFast Casual Dining',
        'Thank you for dining with MOZZ! Order online at starters4u.in',
        true,
        jsonb_build_object(
          'address', 'Ground Floor, Cyber Gateway, Gachibowli, Hyderabad 500081',
          'phone', '+91 98480 99887', 'gstin', '36AABCS1234F1Z8',
          'receiptHeader', E'MOZZ Starters4U Diner & KOT\nFast Casual Dining',
          'receiptFooter', 'Thank you for dining with MOZZ! Order online at starters4u.in',
          'providerType', 'starters4u',
          'supabaseUrl', 'https://uyqdnqbadfysnbzbncyj.supabase.co'
        )
      );
    END IF;
  END IF;
END $$;

-- 5. Enable RLS and refine policies for smav_user_outlet_roles
ALTER TABLE public.smav_user_outlet_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_view_own_roles" ON public.smav_user_outlet_roles;
CREATE POLICY "users_view_own_roles" ON public.smav_user_outlet_roles
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Superadmins have full authority to manage outlet roles
DROP POLICY IF EXISTS "superadmin_manage_outlet_roles" ON public.smav_user_outlet_roles;
CREATE POLICY "superadmin_manage_outlet_roles" ON public.smav_user_outlet_roles
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.smav_profiles sp
      WHERE sp.id = (SELECT auth.uid())
        AND UPPER(sp.platform_role) = 'SUPERADMIN'
        AND sp.is_active = true
    )
  );

-- Outlet Administrators can view and manage roles only for their assigned outlet
DROP POLICY IF EXISTS "admin_manage_assigned_outlet_roles" ON public.smav_user_outlet_roles;
CREATE POLICY "admin_manage_assigned_outlet_roles" ON public.smav_user_outlet_roles
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.smav_user_outlet_roles admin_role
      WHERE admin_role.user_id = (SELECT auth.uid())
        AND admin_role.outlet_id = smav_user_outlet_roles.outlet_id
        AND UPPER(admin_role.role) IN ('ADMIN', 'OWNER')
        AND admin_role.is_active = true
    )
  );

-- 6. Helper Function: Link verified identity without duplicate user creation
CREATE OR REPLACE FUNCTION public.smav_link_verified_staff(
  p_email text,
  p_full_name text,
  p_outlet_code text,
  p_role text,
  p_external_staff_id text DEFAULT '',
  p_business_source text DEFAULT 'central'
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid;
  v_outlet_id_text text;
  v_is_new_user boolean := false;
BEGIN
  -- 1. Find existing user in auth.users by email (case-insensitive)
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE LOWER(email) = LOWER(TRIM(p_email))
  LIMIT 1;

  -- 2. Resolve outlet by outlet_code, branch_code, code, name, or id
  SELECT id::text INTO v_outlet_id_text
  FROM public.smav_outlets
  WHERE LOWER(COALESCE(outlet_code, branch_code, code, '')) = LOWER(TRIM(p_outlet_code))
     OR LOWER(COALESCE(outlet_name, name, '')) ILIKE '%' || LOWER(TRIM(p_outlet_code)) || '%'
     OR id::text = TRIM(p_outlet_code)
  LIMIT 1;

  IF v_outlet_id_text IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Outlet code "' || p_outlet_code || '" not found in central registry.'
    );
  END IF;

  -- 3. If user doesn't exist yet in auth.users, return instruction for central provisioning
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'requires_auth_provision', true,
      'email', LOWER(TRIM(p_email)),
      'outlet_id', v_outlet_id_text
    );
  END IF;

  -- 4. Upsert into public.smav_profiles
  INSERT INTO public.smav_profiles (id, email, full_name, platform_role, is_active)
  VALUES (v_user_id, LOWER(TRIM(p_email)), p_full_name, 'OUTLET_USER', true)
  ON CONFLICT (id) DO UPDATE SET
    full_name = COALESCE(NULLIF(p_full_name, ''), smav_profiles.full_name),
    is_active = true;

  -- 5. Upsert role in public.smav_user_outlet_roles (no duplicate links!)
  INSERT INTO public.smav_user_outlet_roles (
    user_id,
    outlet_id,
    role,
    permissions,
    is_active,
    external_staff_id,
    business_source,
    linked_at
  ) VALUES (
    v_user_id,
    (SELECT id FROM public.smav_outlets WHERE id::text = v_outlet_id_text LIMIT 1),
    UPPER(TRIM(p_role)),
    CASE WHEN UPPER(TRIM(p_role)) = 'ADMIN' THEN ARRAY['*'] ELSE ARRAY['pos:create_bill', 'pos:print_receipt'] END,
    true,
    p_external_staff_id,
    p_business_source,
    now()
  )
  ON CONFLICT (user_id, outlet_id) DO UPDATE SET
    role = EXCLUDED.role,
    is_active = true,
    external_staff_id = COALESCE(EXCLUDED.external_staff_id, smav_user_outlet_roles.external_staff_id),
    business_source = COALESCE(EXCLUDED.business_source, smav_user_outlet_roles.business_source),
    linked_at = now();

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_user_id,
    'outlet_id', v_outlet_id_text,
    'role', UPPER(TRIM(p_role)),
    'is_new_user', false,
    'is_linked', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.smav_link_verified_staff FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.smav_link_verified_staff TO authenticated;
GRANT EXECUTE ON FUNCTION public.smav_link_verified_staff TO service_role;

COMMIT;
