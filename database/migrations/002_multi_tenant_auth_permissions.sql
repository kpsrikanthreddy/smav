-- ==============================================================================
-- SMAV Print Agent - Multi-Tenant Authentication & Strict Isolation
-- Migration: 002_multi_tenant_auth_permissions.sql
-- Description: Adds staff credentials, business memberships, appointments,
--              table allocations, and tenant-scoped security policies.
-- ==============================================================================

-- 1. Staff Users Table
CREATE TABLE IF NOT EXISTS smav_staff_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL, -- PBKDF2 / Bcrypt / Secure token
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Staff Business & Branch Memberships (Enforces zero leakage between Salon & Restaurant)
CREATE TABLE IF NOT EXISTS smav_user_business_memberships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES smav_staff_users(id) ON DELETE CASCADE,
    business_id VARCHAR(64) NOT NULL REFERENCES smav_businesses(id) ON DELETE CASCADE,
    branch_id VARCHAR(64) NOT NULL REFERENCES smav_branches(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL, -- 'owner', 'manager', 'cashier', 'salon_receptionist'
    permissions JSONB NOT NULL DEFAULT '[]', -- array of granted permission strings
    is_primary BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, business_id, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_user ON smav_user_business_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_business_branch ON smav_user_business_memberships(business_id, branch_id);

-- 3. Salon Appointments (Glossy Looks specific)
CREATE TABLE IF NOT EXISTS salon_appointments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id VARCHAR(64) NOT NULL DEFAULT 'the_glossy_looks' REFERENCES smav_businesses(id),
    branch_id VARCHAR(64) NOT NULL REFERENCES smav_branches(id),
    customer_name VARCHAR(255) NOT NULL,
    customer_phone VARCHAR(20) NOT NULL,
    service_id VARCHAR(128) NOT NULL,
    service_name VARCHAR(255) NOT NULL,
    stylist_id VARCHAR(128),
    stylist_name VARCHAR(255),
    appointment_time TIMESTAMPTZ NOT NULL,
    status VARCHAR(50) DEFAULT 'confirmed', -- 'confirmed', 'in_service', 'completed', 'cancelled'
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_salon_appts_branch ON salon_appointments(branch_id);
CREATE INDEX IF NOT EXISTS idx_salon_appts_time ON salon_appointments(appointment_time);

-- 4. Restaurant Tables & Status (MOZZ / Starters4U specific)
CREATE TABLE IF NOT EXISTS restaurant_tables (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id VARCHAR(64) NOT NULL DEFAULT 'mozz_starters4u' REFERENCES smav_businesses(id),
    branch_id VARCHAR(64) NOT NULL REFERENCES smav_branches(id),
    table_number VARCHAR(50) NOT NULL, -- 'Table 1', 'Table 2', 'Counter 1'
    capacity INT DEFAULT 4,
    status VARCHAR(50) DEFAULT 'available', -- 'available', 'occupied', 'billed'
    current_order_id UUID REFERENCES restaurant_orders(id) ON DELETE SET NULL,
    UNIQUE(branch_id, table_number)
);

CREATE INDEX IF NOT EXISTS idx_tables_branch ON restaurant_tables(branch_id);

-- 5. Seed Staff Accounts
INSERT INTO smav_staff_users (id, email, password_hash, full_name, phone)
VALUES
    ('a1111111-1111-1111-1111-111111111111', 'ananya@glossylooks.com', 'scrypt_hashed_salon123', 'Ananya Rao', '+91 98765 43210'),
    ('a2222222-2222-2222-2222-222222222222', 'ramesh@glossylooks.com', 'scrypt_hashed_manager123', 'Ramesh V', '+91 98765 43211'),
    ('b1111111-1111-1111-1111-111111111111', 'vikram@starters4u.in', 'scrypt_hashed_mozz123', 'Vikram Reddy', '+91 98765 11223'),
    ('f9999999-9999-9999-9999-999999999999', 'kpsrikanthreddy@gmail.com', 'scrypt_hashed_owner123', 'Srikanth Reddy', '+91 98765 00000')
ON CONFLICT (email) DO NOTHING;

-- Seed Memberships
INSERT INTO smav_user_business_memberships (user_id, business_id, branch_id, role, permissions, is_primary)
VALUES
    -- Ananya: Salon Receptionist at Gachibowli
    ('a1111111-1111-1111-1111-111111111111', 'the_glossy_looks', 'branch_gl_gach', 'salon_receptionist', '["pos:create_bill", "pos:view_services", "pos:print_receipt", "pos:view_appointments", "printer:manage"]'::jsonb, true),
    -- Ramesh: Salon Manager at Gachibowli
    ('a2222222-2222-2222-2222-222222222222', 'the_glossy_looks', 'branch_gl_gach', 'manager', '["pos:create_bill", "pos:view_services", "pos:print_receipt", "pos:refund", "reports:view", "printer:manage", "devices:manage"]'::jsonb, true),
    -- Vikram: Restaurant Cashier at Gachibowli
    ('b1111111-1111-1111-1111-111111111111', 'mozz_starters4u', 'branch_mozz_gach', 'cashier', '["pos:create_order", "pos:print_kot", "pos:print_bill", "orders:view_pending", "tables:manage", "printer:manage"]'::jsonb, true),
    -- Srikanth (Owner): Access to both Salon and Restaurant!
    ('f9999999-9999-9999-9999-999999999999', 'the_glossy_looks', 'branch_gl_gach', 'owner', '["*"]'::jsonb, true),
    ('f9999999-9999-9999-9999-999999999999', 'mozz_starters4u', 'branch_mozz_gach', 'owner', '["*"]'::jsonb, false)
ON CONFLICT (user_id, business_id, branch_id) DO NOTHING;
