-- ==============================================================================
-- SMAV Central Supabase Project: Phase 1 — Central Login, Roles & Non-Recursive RLS
-- Migration: 011_phase1_central_login_roles_rls.sql
-- Project: qykdwswatopylzvqhgog (https://qykdwswatopylzvqhgog.supabase.co)
--
-- Safety Guarantees:
--   * Strictly additive and idempotent.
--   * Preserves all existing Auth users, smav_profiles, smav_user_outlet_roles,
--     and smav_outlets (glossylooks, mozz). Zero DELETE or TRUNCATE statements.
--   * Uses SECURITY DEFINER helpers to prevent infinite RLS recursion.
--   * Enforces the 3 visible SMAV roles at the database RLS layer:
--       - SUPERADMIN (smav_profiles.platform_role = 'SUPERADMIN') -> all outlets
--       - ADMIN      (smav_user_outlet_roles.role = 'ADMIN')      -> assigned active outlets
--       - STAFF      (smav_user_outlet_roles.role = 'STAFF')      -> billing/own read for assigned active outlets (displayed as POS_BILLING)
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Non-Recursive SECURITY DEFINER Helper Functions
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.smav_is_superadmin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.smav_profiles sp
    WHERE sp.id = (SELECT auth.uid())
      AND UPPER(COALESCE(sp.platform_role, '')) = 'SUPERADMIN'
      AND sp.is_active = true
  );
$$;

REVOKE ALL ON FUNCTION public.smav_is_superadmin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.smav_is_superadmin() TO authenticated;

CREATE OR REPLACE FUNCTION public.smav_current_platform_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT sp.platform_role
  FROM public.smav_profiles sp
  WHERE sp.id = (SELECT auth.uid())
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.smav_current_platform_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.smav_current_platform_role() TO authenticated;

CREATE OR REPLACE FUNCTION public.smav_has_outlet_access(p_outlet_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    public.smav_is_superadmin()
    OR EXISTS (
      SELECT 1
      FROM public.smav_user_outlet_roles uor
      JOIN public.smav_outlets o ON o.id = uor.outlet_id
      JOIN public.smav_profiles sp ON sp.id = uor.user_id
      WHERE uor.user_id = (SELECT auth.uid())
        AND uor.outlet_id = p_outlet_id
        AND uor.is_active = true
        AND o.is_active = true
        AND sp.is_active = true
    );
$$;

REVOKE ALL ON FUNCTION public.smav_has_outlet_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.smav_has_outlet_access(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.smav_is_outlet_admin(target_outlet_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    public.smav_is_superadmin()
    OR EXISTS (
      SELECT 1
      FROM public.smav_user_outlet_roles uor
      JOIN public.smav_outlets o ON o.id = uor.outlet_id
      JOIN public.smav_profiles sp ON sp.id = uor.user_id
      WHERE uor.user_id = (SELECT auth.uid())
        AND uor.outlet_id = target_outlet_id
        AND uor.is_active = true
        AND o.is_active = true
        AND sp.is_active = true
        AND UPPER(COALESCE(uor.role, '')) = 'ADMIN'
    );
$$;

REVOKE ALL ON FUNCTION public.smav_is_outlet_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.smav_is_outlet_admin(uuid) TO authenticated;

-- ------------------------------------------------------------------------------
-- 2. RLS Policies & Column Privileges for public.smav_profiles
--    * Users can read only their own profile; SUPERADMIN can read/manage all.
--    * Non-superadmin users cannot self-escalate platform_role or reactivate themselves.
--    * Privilege hardening: revoke table-level UPDATE from anon/authenticated;
--      authenticated may update only full_name (subject to self-profile RLS).
--      SUPERADMIN role-management writes execute via server-side service_role APIs.
-- ------------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.smav_profiles ENABLE ROW LEVEL SECURITY;

-- Table-level grants and column-level grants are independent in PostgreSQL.
-- Revoke both so older column grants cannot bypass this restriction.
REVOKE UPDATE ON public.smav_profiles FROM anon, authenticated;
DO $smav_revoke_profile_update$
DECLARE
  v_columns text;
BEGIN
  SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum)
    INTO v_columns
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = 'public.smav_profiles'::regclass
    AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_columns IS NOT NULL THEN
    EXECUTE format('REVOKE UPDATE (%s) ON TABLE public.smav_profiles FROM anon, authenticated', v_columns);
  END IF;
END
$smav_revoke_profile_update$;
GRANT UPDATE (full_name) ON public.smav_profiles TO authenticated;

DROP POLICY IF EXISTS "users_read_own_profile" ON public.smav_profiles;
DROP POLICY IF EXISTS "users_update_own_profile" ON public.smav_profiles;
DROP POLICY IF EXISTS "superadmin_read_all_profiles" ON public.smav_profiles;
DROP POLICY IF EXISTS "superadmin_read_profiles" ON public.smav_profiles;
DROP POLICY IF EXISTS "superadmin_manage_profiles" ON public.smav_profiles;
DROP POLICY IF EXISTS "smav_profiles_select" ON public.smav_profiles;
DROP POLICY IF EXISTS "smav_profiles_insert" ON public.smav_profiles;
DROP POLICY IF EXISTS "smav_profiles_update" ON public.smav_profiles;
DROP POLICY IF EXISTS "smav_profiles_delete" ON public.smav_profiles;

CREATE POLICY "smav_profiles_select" ON public.smav_profiles
  FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()) OR (SELECT public.smav_is_superadmin()));

CREATE POLICY "smav_profiles_insert" ON public.smav_profiles
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.smav_is_superadmin()));

CREATE POLICY "smav_profiles_update" ON public.smav_profiles
  FOR UPDATE TO authenticated
  USING ((id = (SELECT auth.uid()) AND is_active = true) OR (SELECT public.smav_is_superadmin()))
  WITH CHECK (
    (SELECT public.smav_is_superadmin())
    OR (
      id = (SELECT auth.uid())
      AND platform_role IS NOT DISTINCT FROM (SELECT public.smav_current_platform_role())
      AND is_active = true
    )
  );

CREATE POLICY "smav_profiles_delete" ON public.smav_profiles
  FOR DELETE TO authenticated
  USING ((SELECT public.smav_is_superadmin()));

-- ------------------------------------------------------------------------------
-- 3. RLS Policies for public.smav_outlets
--    * SUPERADMIN: full view and write access to all outlets.
--    * ADMIN / STAFF (POS_BILLING): read-only access strictly to assigned active outlets.
-- ------------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.smav_outlets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "superadmin_all_outlets" ON public.smav_outlets;
DROP POLICY IF EXISTS "admin_staff_outlet_isolation" ON public.smav_outlets;
DROP POLICY IF EXISTS "staff_view_assigned_outlets" ON public.smav_outlets;
DROP POLICY IF EXISTS "smav_superadmin_outlets_select" ON public.smav_outlets;
DROP POLICY IF EXISTS "smav_superadmin_outlets_insert" ON public.smav_outlets;
DROP POLICY IF EXISTS "smav_superadmin_outlets_update" ON public.smav_outlets;
DROP POLICY IF EXISTS "smav_outlets_select" ON public.smav_outlets;
DROP POLICY IF EXISTS "smav_outlets_insert" ON public.smav_outlets;
DROP POLICY IF EXISTS "smav_outlets_update" ON public.smav_outlets;
DROP POLICY IF EXISTS "smav_outlets_delete" ON public.smav_outlets;

CREATE POLICY "smav_outlets_select" ON public.smav_outlets
  FOR SELECT TO authenticated
  USING (
    (SELECT public.smav_is_superadmin())
    OR (SELECT public.smav_has_outlet_access(id))
  );

CREATE POLICY "smav_outlets_insert" ON public.smav_outlets
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.smav_is_superadmin()));

CREATE POLICY "smav_outlets_update" ON public.smav_outlets
  FOR UPDATE TO authenticated
  USING ((SELECT public.smav_is_superadmin()))
  WITH CHECK ((SELECT public.smav_is_superadmin()));

CREATE POLICY "smav_outlets_delete" ON public.smav_outlets
  FOR DELETE TO authenticated
  USING ((SELECT public.smav_is_superadmin()));

-- ------------------------------------------------------------------------------
-- 4. RLS Policies, Privileges & Update Guard for public.smav_user_outlet_roles
--    * SUPERADMIN: view and manage all outlet assignments (grant/revoke ADMIN & STAFF).
--    * ADMIN: view assignments in assigned outlets; manage STAFF assignments
--      strictly within assigned active outlets (CANNOT grant, alter, or revoke
--      ADMIN roles).
--    * STAFF (POS_BILLING): read-only access to their own assignments.
--    * Privilege hardening: revoke UPDATE from anon and authenticated so
--      SUPERADMIN and ADMIN role-management writes go through authorized
--      server-side APIs using service_role, while keeping RLS and the
--      BEFORE UPDATE trigger guard intact.
-- ------------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.smav_user_outlet_roles ENABLE ROW LEVEL SECURITY;

REVOKE UPDATE ON public.smav_user_outlet_roles FROM anon, authenticated;
DO $smav_revoke_role_update$
DECLARE
  v_columns text;
BEGIN
  SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum)
    INTO v_columns
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = 'public.smav_user_outlet_roles'::regclass
    AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_columns IS NOT NULL THEN
    EXECUTE format('REVOKE UPDATE (%s) ON TABLE public.smav_user_outlet_roles FROM anon, authenticated', v_columns);
  END IF;
END
$smav_revoke_role_update$;

DROP POLICY IF EXISTS "users_view_own_roles" ON public.smav_user_outlet_roles;
DROP POLICY IF EXISTS "superadmin_manage_outlet_roles" ON public.smav_user_outlet_roles;
DROP POLICY IF EXISTS "admin_manage_assigned_outlet_roles" ON public.smav_user_outlet_roles;
DROP POLICY IF EXISTS "smav_uor_select" ON public.smav_user_outlet_roles;
DROP POLICY IF EXISTS "smav_uor_insert" ON public.smav_user_outlet_roles;
DROP POLICY IF EXISTS "smav_uor_update" ON public.smav_user_outlet_roles;
DROP POLICY IF EXISTS "smav_uor_delete" ON public.smav_user_outlet_roles;

CREATE POLICY "smav_uor_select" ON public.smav_user_outlet_roles
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR (SELECT public.smav_is_outlet_admin(outlet_id))
  );

CREATE POLICY "smav_uor_insert" ON public.smav_user_outlet_roles
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.smav_is_superadmin())
    OR (
      (SELECT public.smav_is_outlet_admin(outlet_id))
      AND UPPER(COALESCE(role, '')) = 'STAFF'
    )
  );

CREATE POLICY "smav_uor_update" ON public.smav_user_outlet_roles
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.smav_is_superadmin())
    OR (
      (SELECT public.smav_is_outlet_admin(outlet_id))
      AND UPPER(COALESCE(role, '')) = 'STAFF'
    )
  )
  WITH CHECK (
    (SELECT public.smav_is_superadmin())
    OR (
      (SELECT public.smav_is_outlet_admin(outlet_id))
      AND UPPER(COALESCE(role, '')) = 'STAFF'
    )
  );

CREATE POLICY "smav_uor_delete" ON public.smav_user_outlet_roles
  FOR DELETE TO authenticated
  USING (
    (SELECT public.smav_is_superadmin())
    OR (
      (SELECT public.smav_is_outlet_admin(outlet_id))
      AND UPPER(COALESCE(role, '')) = 'STAFF'
    )
  );

-- Database-level guard: RLS cannot compare OLD vs NEW values on UPDATE.
-- Prevent non-SUPERADMIN users (including outlet ADMINs) from reassigning
-- user_id or outlet_id on existing smav_user_outlet_roles rows, or altering
-- non-STAFF roles. Outlet ADMINs may update STAFF status/metadata only within
-- their assigned active outlets; SUPERADMIN and service_role retain full access.
CREATE OR REPLACE FUNCTION public.smav_guard_outlet_role_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE((SELECT auth.role()), '') = 'service_role'
     OR (SELECT public.smav_is_superadmin())
  THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.outlet_id IS DISTINCT FROM OLD.outlet_id
  THEN
    RAISE EXCEPTION 'Forbidden: Only SUPERADMIN can change id, user_id, or outlet_id on an existing outlet role assignment.'
      USING ERRCODE = '42501';
  END IF;

  IF UPPER(COALESCE(OLD.role, '')) <> 'STAFF'
     OR UPPER(COALESCE(NEW.role, '')) <> 'STAFF'
  THEN
    RAISE EXCEPTION 'Forbidden: Outlet ADMINs can only update STAFF assignments within assigned active outlets.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.smav_is_outlet_admin(OLD.outlet_id) THEN
    RAISE EXCEPTION 'Forbidden: Active outlet ADMIN privileges are required to update this STAFF assignment.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.smav_guard_outlet_role_update() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_smav_uor_prevent_identity_rebind ON public.smav_user_outlet_roles;
CREATE TRIGGER trg_smav_uor_prevent_identity_rebind
  BEFORE UPDATE ON public.smav_user_outlet_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.smav_guard_outlet_role_update();

-- ------------------------------------------------------------------------------
-- 5. RLS Policies for smav_devices, smav_audit_logs, smav_salon_bills,
--    and smav_external_identities
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  v_devices_outlet_type text;
BEGIN
  -- 5A. public.smav_devices
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'smav_devices') THEN
    ALTER TABLE public.smav_devices ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "superadmin_all_devices" ON public.smav_devices;
    DROP POLICY IF EXISTS "staff_view_outlet_devices" ON public.smav_devices;
    DROP POLICY IF EXISTS "smav_devices_select" ON public.smav_devices;
    DROP POLICY IF EXISTS "smav_devices_manage" ON public.smav_devices;
    DROP POLICY IF EXISTS "smav_devices_insert" ON public.smav_devices;
    DROP POLICY IF EXISTS "smav_devices_update" ON public.smav_devices;
    DROP POLICY IF EXISTS "smav_devices_delete" ON public.smav_devices;

    SELECT data_type INTO v_devices_outlet_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'smav_devices' AND column_name = 'outlet_id';

    IF v_devices_outlet_type = 'uuid' THEN
      CREATE POLICY "smav_devices_select" ON public.smav_devices
        FOR SELECT TO authenticated
        USING ((SELECT public.smav_has_outlet_access(outlet_id)));

      CREATE POLICY "smav_devices_insert" ON public.smav_devices
        FOR INSERT TO authenticated
        WITH CHECK ((SELECT public.smav_is_outlet_admin(outlet_id)));

      CREATE POLICY "smav_devices_update" ON public.smav_devices
        FOR UPDATE TO authenticated
        USING ((SELECT public.smav_is_outlet_admin(outlet_id)))
        WITH CHECK ((SELECT public.smav_is_outlet_admin(outlet_id)));

      CREATE POLICY "smav_devices_delete" ON public.smav_devices
        FOR DELETE TO authenticated
        USING ((SELECT public.smav_is_outlet_admin(outlet_id)));
    ELSE
      CREATE POLICY "smav_devices_select" ON public.smav_devices
        FOR SELECT TO authenticated
        USING (
          (SELECT public.smav_is_superadmin())
          OR (
            outlet_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            AND (SELECT public.smav_has_outlet_access(outlet_id::uuid))
          )
        );

      CREATE POLICY "smav_devices_insert" ON public.smav_devices
        FOR INSERT TO authenticated
        WITH CHECK (
          (SELECT public.smav_is_superadmin())
          OR (
            outlet_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            AND (SELECT public.smav_is_outlet_admin(outlet_id::uuid))
          )
        );

      CREATE POLICY "smav_devices_update" ON public.smav_devices
        FOR UPDATE TO authenticated
        USING (
          (SELECT public.smav_is_superadmin())
          OR (
            outlet_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            AND (SELECT public.smav_is_outlet_admin(outlet_id::uuid))
          )
        )
        WITH CHECK (
          (SELECT public.smav_is_superadmin())
          OR (
            outlet_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            AND (SELECT public.smav_is_outlet_admin(outlet_id::uuid))
          )
        );

      CREATE POLICY "smav_devices_delete" ON public.smav_devices
        FOR DELETE TO authenticated
        USING (
          (SELECT public.smav_is_superadmin())
          OR (
            outlet_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            AND (SELECT public.smav_is_outlet_admin(outlet_id::uuid))
          )
        );
    END IF;
  END IF;

  -- 5B. public.smav_audit_logs
  --     * Prevent authenticated/anon clients from forging, modifying, or deleting audit logs.
  --     * Only trusted server-side writes via service_role bypass RLS.
  --     * Only SUPERADMIN can read audit logs.
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'smav_audit_logs') THEN
    ALTER TABLE public.smav_audit_logs ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "authenticated_insert_audit_logs" ON public.smav_audit_logs;
    DROP POLICY IF EXISTS "superadmin_view_audit_logs" ON public.smav_audit_logs;
    DROP POLICY IF EXISTS "smav_audit_logs_insert" ON public.smav_audit_logs;
    DROP POLICY IF EXISTS "smav_audit_logs_select" ON public.smav_audit_logs;

    REVOKE INSERT, UPDATE, DELETE ON public.smav_audit_logs FROM anon, authenticated;

    CREATE POLICY "smav_audit_logs_select" ON public.smav_audit_logs
      FOR SELECT TO authenticated
      USING ((SELECT public.smav_is_superadmin()));
  END IF;

  -- 5C. public.smav_salon_bills (preserves all existing bills)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'smav_salon_bills') THEN
    ALTER TABLE public.smav_salon_bills ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "smav_salon_bills_insert" ON public.smav_salon_bills;
    DROP POLICY IF EXISTS "smav_salon_bills_select_own" ON public.smav_salon_bills;
    DROP POLICY IF EXISTS "smav_salon_bills_select" ON public.smav_salon_bills;

    -- SUPERADMIN, assigned ADMIN, and assigned STAFF (POS_BILLING) can generate bills for assigned active outlets
    CREATE POLICY "smav_salon_bills_insert" ON public.smav_salon_bills
      FOR INSERT TO authenticated
      WITH CHECK (
        created_by = (SELECT auth.uid())
        AND (SELECT public.smav_has_outlet_access(outlet_id))
      );

    -- SUPERADMIN and assigned outlet ADMIN can read outlet bills for reports;
    -- STAFF (POS_BILLING) can only read bills they created themselves.
    CREATE POLICY "smav_salon_bills_select" ON public.smav_salon_bills
      FOR SELECT TO authenticated
      USING (
        (SELECT public.smav_is_outlet_admin(outlet_id))
        OR (
          created_by = (SELECT auth.uid())
          AND (SELECT public.smav_has_outlet_access(outlet_id))
        )
      );
  END IF;

  -- 5D. public.smav_external_identities (ensure non-recursive active-outlet checks)
  --     Actual schema: source, external_id, auth_user_id, username, email, created_at
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'smav_external_identities') THEN
    ALTER TABLE public.smav_external_identities ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "superadmin_all_external_identities" ON public.smav_external_identities;
    DROP POLICY IF EXISTS "admin_view_assigned_external_identities" ON public.smav_external_identities;
    DROP POLICY IF EXISTS "users_view_own_external_identity" ON public.smav_external_identities;

    CREATE POLICY "superadmin_all_external_identities" ON public.smav_external_identities
      FOR ALL TO authenticated
      USING ((SELECT public.smav_is_superadmin()))
      WITH CHECK ((SELECT public.smav_is_superadmin()));

    CREATE POLICY "admin_view_assigned_external_identities" ON public.smav_external_identities
      FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.smav_user_outlet_roles uor
          JOIN public.smav_outlets o ON o.id = uor.outlet_id
          WHERE uor.user_id = smav_external_identities.auth_user_id
            AND uor.is_active = true
            AND o.is_active = true
            AND (SELECT public.smav_is_outlet_admin(o.id))
        )
      );

    CREATE POLICY "users_view_own_external_identity" ON public.smav_external_identities
      FOR SELECT TO authenticated
      USING (auth_user_id = (SELECT auth.uid()));
  END IF;
END $$;

COMMIT;

