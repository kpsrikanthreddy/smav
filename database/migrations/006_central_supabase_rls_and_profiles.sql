-- ==============================================================================
-- SMAV Central Supabase Project: RLS Policies & Table Schemas
-- Migration: 006_central_supabase_rls_and_profiles.sql
-- Description: Configures narrow RLS policies on smav_profiles, smav_outlets,
--              smav_user_outlet_roles, smav_devices, and smav_audit_logs.
-- ==============================================================================

-- 1. Enable Row Level Security (RLS) on all Central SMAV tables
ALTER TABLE IF EXISTS public.smav_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.smav_outlets ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.smav_user_outlet_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.smav_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.smav_audit_logs ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 2. Policies for public.smav_profiles
-- Requirement 6: Narrowly scoped policy so users can read only their own profile
-- ------------------------------------------------------------------------------

-- Drop existing policies if they exist to avoid conflicts
DROP POLICY IF EXISTS "users_read_own_profile" ON public.smav_profiles;
DROP POLICY IF EXISTS "users_update_own_profile" ON public.smav_profiles;
DROP POLICY IF EXISTS "superadmin_read_all_profiles" ON public.smav_profiles;
DROP POLICY IF EXISTS "superadmin_manage_profiles" ON public.smav_profiles;

-- Narrowly scoped RLS policy: users can read only their own profile
CREATE POLICY "users_read_own_profile" ON public.smav_profiles
    FOR SELECT
    USING (auth.uid() = id);

-- Users can update only their own profile
CREATE POLICY "users_update_own_profile" ON public.smav_profiles
    FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- Superadmins can read and manage all profiles
CREATE POLICY "superadmin_manage_profiles" ON public.smav_profiles
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.smav_profiles sp
            WHERE sp.id = auth.uid()
              AND UPPER(sp.platform_role) = 'SUPERADMIN'
              AND sp.is_active = TRUE
        )
    );

-- ------------------------------------------------------------------------------
-- 3. Policies for public.smav_outlets
-- Superadmins can view and manage all outlets.
-- Admins and Staff can only view outlets they have active roles for.
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "superadmin_all_outlets" ON public.smav_outlets;
DROP POLICY IF EXISTS "staff_view_assigned_outlets" ON public.smav_outlets;

CREATE POLICY "superadmin_all_outlets" ON public.smav_outlets
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.smav_profiles sp
            WHERE sp.id = auth.uid()
              AND UPPER(sp.platform_role) = 'SUPERADMIN'
              AND sp.is_active = TRUE
        )
    );

CREATE POLICY "staff_view_assigned_outlets" ON public.smav_outlets
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.smav_user_outlet_roles uor
            WHERE uor.user_id = auth.uid()
              AND uor.outlet_id = smav_outlets.id
              AND uor.is_active = TRUE
        )
    );

-- ------------------------------------------------------------------------------
-- 4. Policies for public.smav_user_outlet_roles
-- Users can view their own roles. Superadmins can manage all roles.
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "users_view_own_roles" ON public.smav_user_outlet_roles;
DROP POLICY IF EXISTS "superadmin_manage_outlet_roles" ON public.smav_user_outlet_roles;

CREATE POLICY "users_view_own_roles" ON public.smav_user_outlet_roles
    FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "superadmin_manage_outlet_roles" ON public.smav_user_outlet_roles
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.smav_profiles sp
            WHERE sp.id = auth.uid()
              AND UPPER(sp.platform_role) = 'SUPERADMIN'
              AND sp.is_active = TRUE
        )
    );

-- ------------------------------------------------------------------------------
-- 5. Policies for public.smav_devices
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "superadmin_all_devices" ON public.smav_devices;
DROP POLICY IF EXISTS "staff_view_outlet_devices" ON public.smav_devices;

CREATE POLICY "superadmin_all_devices" ON public.smav_devices
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.smav_profiles sp
            WHERE sp.id = auth.uid()
              AND UPPER(sp.platform_role) = 'SUPERADMIN'
              AND sp.is_active = TRUE
        )
    );

CREATE POLICY "staff_view_outlet_devices" ON public.smav_devices
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.smav_user_outlet_roles uor
            WHERE uor.user_id = auth.uid()
              AND uor.outlet_id = smav_devices.outlet_id
              AND uor.is_active = TRUE
        )
    );

-- ------------------------------------------------------------------------------
-- 6. Policies for public.smav_audit_logs
-- Authenticated users can insert audit logs for their own actions.
-- Superadmins can read all audit logs.
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "authenticated_insert_audit_logs" ON public.smav_audit_logs;
DROP POLICY IF EXISTS "superadmin_view_audit_logs" ON public.smav_audit_logs;

CREATE POLICY "authenticated_insert_audit_logs" ON public.smav_audit_logs
    FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "superadmin_view_audit_logs" ON public.smav_audit_logs
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.smav_profiles sp
            WHERE sp.id = auth.uid()
              AND UPPER(sp.platform_role) = 'SUPERADMIN'
              AND sp.is_active = TRUE
        )
    );
