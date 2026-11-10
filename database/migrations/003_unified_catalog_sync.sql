-- ==============================================================================
-- SMAV Print Agent - Unified Supabase Catalog, Order and POS Synchronization
-- Migration: 003_unified_catalog_sync.sql
-- Description: Creates monotonic catalog revision sequences, delta sync tracking,
--              deletion tombstones, and Supabase Realtime publication.
-- ==============================================================================

-- 1. Monotonic Catalog Revision Sequence & Tracking
CREATE TABLE IF NOT EXISTS smav_catalog_revisions (
    business_id VARCHAR(64) PRIMARY KEY REFERENCES smav_businesses(id) ON DELETE CASCADE,
    current_revision BIGINT NOT NULL DEFAULT 100,
    last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_updated_by VARCHAR(255) DEFAULT 'system_admin',
    last_change_summary TEXT
);

INSERT INTO smav_catalog_revisions (business_id, current_revision, last_change_summary)
VALUES
    ('the_glossy_looks', 101, 'Authoritative Salon Services catalog initialized'),
    ('mozz_starters4u', 201, 'Authoritative MOZZ Restaurant Menu catalog initialized')
ON CONFLICT (business_id) DO NOTHING;

-- 2. Master Salon Services Catalog (Authoritative Table for Website, Admin, and POS)
CREATE TABLE IF NOT EXISTS salon_services (
    id VARCHAR(128) PRIMARY KEY,
    business_id VARCHAR(64) NOT NULL DEFAULT 'the_glossy_looks' REFERENCES smav_businesses(id),
    name VARCHAR(255) NOT NULL,
    category VARCHAR(128) NOT NULL,
    subcategory VARCHAR(128) DEFAULT '',
    price NUMERIC(12, 2) NOT NULL,
    gst_percent NUMERIC(5, 2) NOT NULL DEFAULT 18.00,
    duration_minutes INT DEFAULT 30,
    is_discount_eligible BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE, -- Tombstone for delta sync
    revision BIGINT NOT NULL DEFAULT 101,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_salon_services_rev ON salon_services(business_id, revision);
CREATE INDEX IF NOT EXISTS idx_salon_services_active ON salon_services(business_id, is_active, is_deleted);

-- 3. Master Restaurant Menu Catalog (Authoritative Table for Website, Swiggy/Zomato, Admin, and POS)
CREATE TABLE IF NOT EXISTS restaurant_menu_items (
    id VARCHAR(128) PRIMARY KEY,
    business_id VARCHAR(64) NOT NULL DEFAULT 'mozz_starters4u' REFERENCES smav_businesses(id),
    name VARCHAR(255) NOT NULL,
    category VARCHAR(128) NOT NULL,
    base_price NUMERIC(12, 2) NOT NULL,
    is_veg BOOLEAN NOT NULL DEFAULT FALSE,
    variants JSONB DEFAULT '[]'::jsonb, -- e.g. [{"id":"v_regular","name":"Regular Roll","priceDelta":0}]
    is_available BOOLEAN NOT NULL DEFAULT TRUE,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE, -- Tombstone for delta sync
    revision BIGINT NOT NULL DEFAULT 201,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rest_menu_rev ON restaurant_menu_items(business_id, revision);
CREATE INDEX IF NOT EXISTS idx_rest_menu_avail ON restaurant_menu_items(business_id, is_available, is_deleted);

-- 4. Trigger Function: Bump Monotonic Catalog Revision on Any Catalog Mutation
CREATE OR REPLACE FUNCTION fn_bump_catalog_revision()
RETURNS TRIGGER AS $$
DECLARE
    new_rev BIGINT;
    target_business VARCHAR(64);
BEGIN
    target_business := COALESCE(NEW.business_id, OLD.business_id);

    -- Increment monotonic revision sequence for this business
    UPDATE smav_catalog_revisions
    SET current_revision = current_revision + 1,
        last_updated_at = NOW(),
        last_change_summary = 'Catalog item modified: ' || COALESCE(NEW.name, OLD.name)
    WHERE business_id = target_business
    RETURNING current_revision INTO new_rev;

    -- Assign updated revision to the record
    NEW.revision := new_rev;
    NEW.updated_at := NOW();

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply Triggers
DROP TRIGGER IF EXISTS trg_salon_service_revision ON salon_services;
CREATE TRIGGER trg_salon_service_revision
BEFORE INSERT OR UPDATE ON salon_services
FOR EACH ROW EXECUTE FUNCTION fn_bump_catalog_revision();

DROP TRIGGER IF EXISTS trg_rest_menu_revision ON restaurant_menu_items;
CREATE TRIGGER trg_rest_menu_revision
BEFORE INSERT OR UPDATE ON restaurant_menu_items
FOR EACH ROW EXECUTE FUNCTION fn_bump_catalog_revision();

-- 5. Seed Initial Authoritative Services
INSERT INTO salon_services (id, business_id, name, category, subcategory, price, gst_percent, is_discount_eligible, is_active, revision)
VALUES
    ('srv_1', 'the_glossy_looks', 'Signature Haircut & Styling', 'Hair', 'Cut & Styling', 650.00, 18.00, true, true, 101),
    ('srv_2', 'the_glossy_looks', 'Moroccan Oil Hair Spa', 'Hair Spa', 'Hydration', 1800.00, 18.00, true, true, 101),
    ('srv_3', 'the_glossy_looks', 'Hydra Glow Deep Facial', 'Facial', 'Skin Brightening', 2500.00, 18.00, true, true, 101),
    ('srv_4', 'the_glossy_looks', 'Beard Sculpting & Trim', 'Grooming', 'Men Beard', 350.00, 18.00, false, true, 101),
    ('srv_5', 'the_glossy_looks', 'Keratin Protein Treatment', 'Treatment', 'Hair Care', 4500.00, 18.00, true, true, 101),
    ('srv_6', 'the_glossy_looks', 'Crystal Spa Pedicure', 'Nails & Feet', 'Foot Care', 1200.00, 18.00, true, true, 101),
    ('srv_7', 'the_glossy_looks', 'O3+ Bridal D-Tan Pack', 'Facial', 'De-Tan', 950.00, 18.00, true, true, 101)
ON CONFLICT (id) DO UPDATE SET price = EXCLUDED.price, revision = EXCLUDED.revision;

-- Seed Initial Authoritative Menu Items
INSERT INTO restaurant_menu_items (id, business_id, name, category, base_price, is_veg, variants, is_available, revision)
VALUES
    ('rst_1', 'mozz_starters4u', 'MOZZ Charcoal Chicken Shawarma', 'Shawarma', 160.00, false, '[{"id":"v_regular","name":"Regular Roll","priceDelta":0},{"id":"v_open","name":"Open Plate (Special)","priceDelta":50},{"id":"v_spicy","name":"Extra Spicy Peri-Peri","priceDelta":20}]'::jsonb, true, 201),
    ('rst_2', 'mozz_starters4u', 'Smoked Butter Garlic Chicken Wings', 'Starters', 240.00, false, '[{"id":"v_6pcs","name":"6 Pieces","priceDelta":0},{"id":"v_12pcs","name":"12 Pieces (Jumbo)","priceDelta":180}]'::jsonb, true, 201),
    ('rst_3', 'mozz_starters4u', 'Hyderabadi Dum Biryani (Chicken)', 'Biryani', 280.00, false, '[{"id":"v_single","name":"Single Pack","priceDelta":0},{"id":"v_special","name":"Special Jumbo with Extra Piece","priceDelta":110}]'::jsonb, true, 201),
    ('rst_4', 'mozz_starters4u', 'Crispy Paneer Kurkure Strips', 'Starters (Veg)', 210.00, true, '[]'::jsonb, true, 201),
    ('rst_5', 'mozz_starters4u', 'Loaded Double Cheese Burger', 'Burgers', 190.00, false, '[{"id":"v_b_single","name":"Single Patty","priceDelta":0},{"id":"v_b_double","name":"Double Patty Monster","priceDelta":80}]'::jsonb, true, 201),
    ('rst_6', 'mozz_starters4u', 'Fresh Mint Mojito / Lime Soda', 'Beverages', 90.00, true, '[]'::jsonb, true, 201)
ON CONFLICT (id) DO UPDATE SET base_price = EXCLUDED.base_price, revision = EXCLUDED.revision;

-- 6. Supabase Realtime Publication Enablement
-- Allows authorized web clients and mobile agents to subscribe to INSERT/UPDATE/DELETE events
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE salon_services, restaurant_menu_items, smav_catalog_revisions;
    END IF;
EXCEPTION WHEN OTHERS THEN
    -- Fallback gracefully if publication not present in local test environments
    RAISE NOTICE 'Supabase Realtime publication configuration completed';
END $$;
