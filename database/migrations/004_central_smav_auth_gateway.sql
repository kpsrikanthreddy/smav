-- ==============================================================================
-- SMAV Enterprise Authentication Gateway & Central Outlet Registry
-- Migration: 004_central_smav_auth_gateway.sql
-- Description: Creates central multi-outlet directory, tenant isolation policies,
--              audit logging, secure password reset tokens, and multi-business roles.
-- ==============================================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Central SMAV Outlet Registry (Item 4 & 7)
CREATE TABLE IF NOT EXISTS smav_outlet_registry (
    id VARCHAR(64) PRIMARY KEY,
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(50) NOT NULL CHECK (category IN ('restaurant', 'salon', 'retail', 'other')),
    address TEXT,
    phone VARCHAR(30),
    gstin VARCHAR(30),
    receipt_header TEXT,
    receipt_footer TEXT,
    provider_type VARCHAR(50) NOT NULL DEFAULT 'custom_outlet',
    supabase_url TEXT,
    supabase_anon_key TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_smav_outlets_code ON smav_outlet_registry(code);
CREATE INDEX IF NOT EXISTS idx_smav_outlets_category ON smav_outlet_registry(category);
CREATE INDEX IF NOT EXISTS idx_smav_outlets_active ON smav_outlet_registry(is_active);

-- 2. Central Identity Directory (Item 2 & 9)
CREATE TABLE IF NOT EXISTS smav_identity_directory (
    id VARCHAR(64) PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    username VARCHAR(100) UNIQUE,
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(30),
    password_hash VARCHAR(255) NOT NULL,
    salt VARCHAR(64) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('superadmin', 'admin', 'staff')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_legacy_migration_required BOOLEAN NOT NULL DEFAULT FALSE,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_smav_identity_email ON smav_identity_directory(email);
CREATE INDEX IF NOT EXISTS idx_smav_identity_role ON smav_identity_directory(role);

-- 3. User Outlet Memberships (Strict Tenant Boundaries)
CREATE TABLE IF NOT EXISTS smav_user_outlet_memberships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(64) NOT NULL REFERENCES smav_identity_directory(id) ON DELETE CASCADE,
    outlet_id VARCHAR(64) NOT NULL REFERENCES smav_outlet_registry(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL CHECK (role IN ('superadmin', 'admin', 'staff')),
    specific_title VARCHAR(100),
    permissions JSONB NOT NULL DEFAULT '[]',
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, outlet_id)
);

CREATE INDEX IF NOT EXISTS idx_smav_memberships_user ON smav_user_outlet_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_smav_memberships_outlet ON smav_user_outlet_memberships(outlet_id);

-- 4. Secure Password Reset Tokens Table (Item 9)
CREATE TABLE IF NOT EXISTS smav_password_resets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(64) NOT NULL REFERENCES smav_identity_directory(id) ON DELETE CASCADE,
    reset_token VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    requested_ip VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_smav_pwd_reset_token ON smav_password_resets(reset_token);

-- 5. Enterprise Security Audit Logs Table (Item 9)
CREATE TABLE IF NOT EXISTS smav_audit_logs (
    id VARCHAR(64) PRIMARY KEY,
    event_type VARCHAR(100) NOT NULL,
    actor_id VARCHAR(64),
    actor_email VARCHAR(255),
    outlet_id VARCHAR(64),
    ip_address VARCHAR(64),
    details JSONB NOT NULL DEFAULT '{}',
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_smav_audit_timestamp ON smav_audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_smav_audit_outlet ON smav_audit_logs(outlet_id);
CREATE INDEX IF NOT EXISTS idx_smav_audit_event ON smav_audit_logs(event_type);

-- 6. Row-Level Security (RLS) Policies
ALTER TABLE smav_outlet_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE smav_identity_directory ENABLE ROW LEVEL SECURITY;
ALTER TABLE smav_user_outlet_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE smav_audit_logs ENABLE ROW LEVEL SECURITY;

-- Service role has full access; client-side users restricted via gateway session
CREATE POLICY "Superadmin full access to outlets" ON smav_outlet_registry
    FOR ALL
    USING (auth.jwt() ->> 'role' = 'superadmin');

CREATE POLICY "Outlet admin read own outlet" ON smav_outlet_registry
    FOR SELECT
    USING (id IN (
        SELECT outlet_id FROM smav_user_outlet_memberships
        WHERE user_id = auth.jwt() ->> 'sub'
    ));

-- 7. Seed Authoritative Outlets
INSERT INTO smav_outlet_registry (id, code, name, category, address, phone, gstin, receipt_header, receipt_footer, provider_type, supabase_url, is_active)
VALUES
    ('outlet_glossy_gach', 'glossylooks', 'The Glossy Looks Salon & Spa (Gachibowli)', 'salon', 'Plot 42, Telecom Nagar, Gachibowli, Hyderabad, Telangana 500032', '+91 91547 44608', '36AABCU9603R1ZM', 'The Glossy Looks Salon & Spa', 'Radiate Elegance. Appointments: +91 91547 44608', 'supabase_salon', 'https://onswigwiwuvkvoduuhxr.supabase.co', true),
    ('outlet_glossy_kokapet', 'glossy_kokapet', 'The Glossy Looks Salon & Spa (Kokapet)', 'salon', 'Shop 12, Kokapet One Commercial Hub, Hyderabad 500075', '+91 98765 43211', '36AABCU9603R1ZM', 'The Glossy Looks - Kokapet One', 'Thank you for visiting! WhatsApp +91 98765 43211', 'supabase_salon', 'https://onswigwiwuvkvoduuhxr.supabase.co', true),
    ('outlet_mozz_gach', 'mozz', 'MOZZ / Starters4U Restaurant & Diner (Gachibowli)', 'restaurant', 'Opp DLF Cyber City Gate 2, Gachibowli, Hyderabad 500032', '+91 98765 11223', '36AAECM4412K1ZQ', 'MOZZ Starters4U - Authentic Flavors', 'Taste The Flame! WhatsApp: 9876511223', 'supabase_restaurant', 'https://uyqdnqbadfysnbzbncyj.supabase.co', true),
    ('outlet_mozz_kndp', 'mozz_kndp', 'MOZZ Starters4U Express (Kondapur)', 'restaurant', 'Near RTO Office, Kondapur, Hyderabad 500084', '+91 98765 11224', '36AAECM4412K1ZQ', 'MOZZ Express Kitchen - Kondapur', 'Order online at starters4u.in', 'supabase_restaurant', 'https://uyqdnqbadfysnbzbncyj.supabase.co', true),
    ('outlet_trends_threads', 'retail1', 'Trends & Threads Lifestyle & Apparel Store', 'retail', 'Inorbit Mall Ground Floor, Hitec City, Hyderabad 500081', '+91 98765 99881', '36AABCT8899M1ZT', 'Trends & Threads Lifestyle Store', 'Exchange within 14 days with original bill and tag intact.', 'custom_outlet', NULL, true)
ON CONFLICT (id) DO NOTHING;
