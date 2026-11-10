-- ==============================================================================
-- SMAV Print Agent - Multi-Outlet Superadmin, Admin, Staff & Database Independence
-- Migration: 004_three_level_rbac_and_outlet_registry.sql
-- Description: Establishes authoritative three-tier RBAC (SUPERADMIN, ADMIN, STAFF),
--              dynamic multi-outlet registry, user management, and strict RLS policies.
-- ==============================================================================

-- 1. Enable pgcrypto / uuid extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Business Outlets Registry Table
CREATE TABLE IF NOT EXISTS smav_outlets (
    id VARCHAR(64) PRIMARY KEY,
    business_id VARCHAR(64) NOT NULL,
    business_name VARCHAR(255) NOT NULL,
    business_type VARCHAR(50) NOT NULL, -- 'SALON', 'RESTAURANT', 'RETAIL', 'OTHER'
    outlet_name VARCHAR(255) NOT NULL,
    branch_code VARCHAR(20) NOT NULL,
    address TEXT NOT NULL,
    phone VARCHAR(30) NOT NULL,
    gstin VARCHAR(30) NOT NULL,
    receipt_header TEXT,
    receipt_footer TEXT,
    currency VARCHAR(10) DEFAULT 'INR',
    tax_percent NUMERIC(5, 2) DEFAULT 18.00,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    printer_config JSONB NOT NULL DEFAULT '{"default_paper_width": 80, "print_kot": false}',
    data_connection JSONB NOT NULL DEFAULT '{"provider": "supabase"}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_smav_outlets_biz_type ON smav_outlets(business_type);
CREATE INDEX IF NOT EXISTS idx_smav_outlets_status ON smav_outlets(is_active);

-- 3. Platform Users & Three-Level Roles
CREATE TABLE IF NOT EXISTS smav_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(30),
    role VARCHAR(30) NOT NULL, -- 'SUPERADMIN', 'ADMIN', 'STAFF'
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_smav_users_email ON smav_users(email);
CREATE INDEX IF NOT EXISTS idx_smav_users_role ON smav_users(role);

-- 4. User Outlet Roles & Granular Permissions
CREATE TABLE IF NOT EXISTS smav_user_outlet_roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES smav_users(id) ON DELETE CASCADE,
    outlet_id VARCHAR(64) NOT NULL REFERENCES smav_outlets(id) ON DELETE CASCADE,
    role VARCHAR(30) NOT NULL, -- 'SUPERADMIN', 'ADMIN', 'STAFF'
    permissions TEXT[] NOT NULL DEFAULT ARRAY['pos:create_bill'],
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, outlet_id)
);

CREATE INDEX IF NOT EXISTS idx_uor_user ON smav_user_outlet_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_uor_outlet ON smav_user_outlet_roles(outlet_id);

-- 5. Paired Hardware Devices Table
CREATE TABLE IF NOT EXISTS smav_paired_devices (
    id VARCHAR(64) PRIMARY KEY,
    device_id VARCHAR(128) NOT NULL UNIQUE,
    outlet_id VARCHAR(64) NOT NULL REFERENCES smav_outlets(id) ON DELETE CASCADE,
    device_name VARCHAR(255) NOT NULL,
    model_info VARCHAR(255),
    assigned_role VARCHAR(50) DEFAULT 'STAFF',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    paired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Platform Audit & Security Logs
CREATE TABLE IF NOT EXISTS smav_audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(64) NOT NULL,
    user_email VARCHAR(255) NOT NULL,
    outlet_id VARCHAR(64),
    action VARCHAR(100) NOT NULL, -- 'LOGIN_SUCCESS', 'USER_CREATED', 'PASSWORD_RESET', 'OUTLET_CREATED', 'BILL_SYNCED'
    entity_type VARCHAR(100) NOT NULL,
    entity_id VARCHAR(128) NOT NULL,
    details JSONB,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_outlet ON smav_audit_logs(outlet_id);
CREATE INDEX IF NOT EXISTS idx_audit_time ON smav_audit_logs(timestamp DESC);

-- ==============================================================================
-- Row-Level Security (RLS) Policies
-- ==============================================================================
ALTER TABLE smav_outlets ENABLE ROW LEVEL SECURITY;
ALTER TABLE smav_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE smav_user_outlet_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE smav_paired_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE smav_audit_logs ENABLE ROW LEVEL SECURITY;

-- 1. Superadmin Policy: Unrestricted access across all tables
CREATE POLICY superadmin_all_outlets ON smav_outlets
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM smav_users
            WHERE smav_users.id = auth.uid() AND smav_users.role = 'SUPERADMIN'
        )
    );

-- 2. Admin & Staff Policy: Restricted only to authorized outlets
CREATE POLICY admin_staff_outlet_isolation ON smav_outlets
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM smav_user_outlet_roles uor
            WHERE uor.user_id = auth.uid() AND uor.outlet_id = smav_outlets.id AND uor.is_active = TRUE
        )
    );

-- 3. Users Table Policy
CREATE POLICY superadmin_manage_users ON smav_users
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM smav_users
            WHERE smav_users.id = auth.uid() AND smav_users.role = 'SUPERADMIN'
        )
    );

CREATE POLICY admin_view_outlet_staff ON smav_users
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM smav_user_outlet_roles admin_role
            JOIN smav_user_outlet_roles staff_role ON admin_role.outlet_id = staff_role.outlet_id
            WHERE admin_role.user_id = auth.uid()
              AND admin_role.role = 'ADMIN'
              AND staff_role.user_id = smav_users.id
        )
    );
