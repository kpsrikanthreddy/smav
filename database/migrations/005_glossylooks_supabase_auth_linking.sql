-- ==============================================================================
-- SMAV Print Agent - Glossy Looks Supabase Auth & Legacy Account Linking
-- Migration: 005_glossylooks_supabase_auth_linking.sql
-- Description: Establishes secure identity federation between Supabase Auth (auth.users),
--              existing Glossy Looks public.users/staff, and SMAV multi-outlet RBAC.
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Supabase Auth Account Linking & Identity Federation Table
CREATE TABLE IF NOT EXISTS smav_auth_account_links (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    supabase_auth_id UUID UNIQUE, -- references auth.users(id) when provisioned
    legacy_user_id UUID,          -- references public.users(id) or public.staff(user_id)
    email VARCHAR(255) NOT NULL UNIQUE,
    account_source VARCHAR(64) NOT NULL DEFAULT 'glossylooks_public_users',
    resolved_role VARCHAR(30) NOT NULL DEFAULT 'STAFF', -- 'SUPERADMIN', 'ADMIN', 'STAFF'
    migration_state VARCHAR(50) NOT NULL DEFAULT 'ACTIVE', -- 'PENDING_MIGRATION', 'ACTIVE', 'LOCKED'
    linked_at TIMESTAMPTZ DEFAULT NOW(),
    last_login_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_smav_auth_links_email ON smav_auth_account_links(email);
CREATE INDEX IF NOT EXISTS idx_smav_auth_links_auth_id ON smav_auth_account_links(supabase_auth_id);
CREATE INDEX IF NOT EXISTS idx_smav_auth_links_legacy_id ON smav_auth_account_links(legacy_user_id);

-- 2. Secure Password Reset & Migration Tokens Table
CREATE TABLE IF NOT EXISTS smav_auth_reset_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    is_used BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_smav_reset_email ON smav_auth_reset_tokens(email);
CREATE INDEX IF NOT EXISTS idx_smav_reset_token ON smav_auth_reset_tokens(token_hash);

-- 3. Server-Side Role Resolution Function
CREATE OR REPLACE FUNCTION resolve_smav_user_role(p_email TEXT, p_legacy_role TEXT)
RETURNS TEXT AS $$
BEGIN
    -- Superadmin check: Designated owner email or salon director
    IF LOWER(p_email) IN ('kpsrikanthreddy@gmail.com', 'owner@theglossylooks.com') OR
       LOWER(p_legacy_role) IN ('owner', 'salon director & master stylist', 'superadmin', 'director') THEN
        RETURN 'SUPERADMIN';
    END IF;

    -- Admin check: Managerial roles
    IF LOWER(p_legacy_role) IN ('manager', 'admin', 'branch_manager', 'general_manager') THEN
        RETURN 'ADMIN';
    END IF;

    -- Staff check: Stylists, cashiers, receptionists
    RETURN 'STAFF';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Initial Seed for Known Authorized Staff Accounts (From Glossy Looks public.staff & public.branches)
INSERT INTO smav_auth_account_links (email, legacy_user_id, account_source, resolved_role, migration_state, metadata)
VALUES
    -- Srikanth Kayidapuram (Platform Owner / Superadmin)
    ('kpsrikanthreddy@gmail.com', '08f14160-4ff8-4f06-b4e6-0170f5f99216', 'glossylooks_public_users', 'SUPERADMIN', 'ACTIVE', '{"name": "SRIKANTH KAYIDAPURAM", "branch_id": "tgl-gachibowli-main", "admin_user_id": "kpsrikanthreddy"}'::jsonb),
    -- Madu Mounika (Salon Director / Superadmin)
    ('owner@theglossylooks.com', '00000000-0000-0000-0000-000000000001', 'glossylooks_public_users', 'SUPERADMIN', 'ACTIVE', '{"name": "Madu Mounika", "branch_id": "tgl-gachibowli-main", "admin_user_id": "madumounika"}'::jsonb),
    -- Ramesh V (Branch Manager / Admin)
    ('ramesh@glossylooks.com', 'a2222222-2222-2222-2222-222222222222', 'glossylooks_public_users', 'ADMIN', 'ACTIVE', '{"name": "Ramesh V", "branch_id": "tgl-gachibowli-main", "admin_user_id": "rameshv"}'::jsonb),
    -- Deepika (Stylist / Staff)
    ('deepika@theglossylooks.com', '364ab6c3-2f38-43fc-8245-6906967ba56e', 'glossylooks_public_users', 'STAFF', 'ACTIVE', '{"name": "Deepika", "branch_id": "tgl-gachibowli-main", "admin_user_id": "Deepika"}'::jsonb),
    -- Paleti Mounika (Stylist / Staff)
    ('paletimounika@theglossylooks.com', '6da70878-4254-4e08-a156-dfdf822fe40c', 'glossylooks_public_users', 'STAFF', 'ACTIVE', '{"name": "paleti mounika", "branch_id": "tgl-gachibowli-main", "admin_user_id": "paletimounika"}'::jsonb),
    -- Deena (Senior Bridal Stylist / Staff)
    ('staff@glossylooks.in', '2b533a81-9384-462f-9730-a67860b667a8', 'glossylooks_public_users', 'STAFF', 'ACTIVE', '{"name": "Deena", "branch_id": "tgl-gachibowli-main", "admin_user_id": "Deena"}'::jsonb),
    -- Vikram Reddy (Restaurant Cashier / Staff)
    ('vikram@starters4u.in', 'b1111111-1111-1111-1111-111111111111', 'starters4u_users', 'STAFF', 'ACTIVE', '{"name": "Vikram Reddy", "branch_id": "b0000000-0000-0000-0000-000000000001", "role": "cashier"}'::jsonb)
ON CONFLICT (email) DO UPDATE SET
    resolved_role = EXCLUDED.resolved_role,
    metadata = EXCLUDED.metadata;

-- 5. Row-Level Security for Auth Linking
ALTER TABLE smav_auth_account_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE smav_auth_reset_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY superadmin_all_auth_links ON smav_auth_account_links
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM smav_auth_account_links a
            WHERE a.supabase_auth_id = auth.uid() AND a.resolved_role = 'SUPERADMIN'
        )
    );

CREATE POLICY users_view_own_auth_link ON smav_auth_account_links
    FOR SELECT
    USING (
        supabase_auth_id = auth.uid() OR
        email = auth.jwt() ->> 'email'
    );
