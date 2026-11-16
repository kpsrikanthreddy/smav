-- ==============================================================================
-- SMAV Multi-Tenant SaaS Platform — Phase 1 Database Migration
-- Migration: 013_multi_tenant_saas_platform.sql
-- Target Database: CENTRAL SMAV Supabase ONLY (qykdwswatopylzvqhgog)
--
-- IMPORTANT:
--   * Do NOT run this file in Glossy Looks or MOZZ external Supabase projects.
--   * Strictly additive, idempotent, and non-destructive.
--   * Preserves ALL existing Auth users, UUIDs, passwords, smav_profiles,
--     smav_user_outlet_roles, smav_outlets (glossylooks, mozz), smav_salon_bills,
--     smav_sync_outbox rows, and migrations 001–012 behavior.
--   * Browser clients (anon / authenticated) NEVER receive access to
--     smav_outlet_credentials or encrypted/hashed integration secrets.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 0. Compatibility Pre-Flight Checks (Fail fast before starting schema changes)
-- ------------------------------------------------------------------------------
DO $smav_preflight$
DECLARE
  v_outlets_id_type text;
  v_missing_items text[] := ARRAY[]::text[];
BEGIN
  IF to_regclass('public.smav_outlets') IS NULL THEN
    v_missing_items := array_append(v_missing_items, 'table public.smav_outlets (migrations 007/009)');
  END IF;
  IF to_regclass('public.smav_profiles') IS NULL THEN
    v_missing_items := array_append(v_missing_items, 'table public.smav_profiles (migration 006)');
  END IF;
  IF to_regclass('public.smav_user_outlet_roles') IS NULL THEN
    v_missing_items := array_append(v_missing_items, 'table public.smav_user_outlet_roles (migration 004/009)');
  END IF;
  IF to_regclass('public.smav_sync_outbox') IS NULL THEN
    v_missing_items := array_append(v_missing_items, 'table public.smav_sync_outbox (migration 012)');
  END IF;
  IF to_regclass('auth.users') IS NULL THEN
    v_missing_items := array_append(v_missing_items, 'table auth.users');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'smav_is_superadmin'
  ) THEN
    v_missing_items := array_append(v_missing_items, 'function public.smav_is_superadmin() (migration 011)');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'smav_has_outlet_access'
  ) THEN
    v_missing_items := array_append(v_missing_items, 'function public.smav_has_outlet_access(uuid) (migration 011)');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'smav_is_outlet_admin'
  ) THEN
    v_missing_items := array_append(v_missing_items, 'function public.smav_is_outlet_admin(uuid) (migration 011)');
  END IF;

  IF array_length(v_missing_items, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'SMAV 013 pre-flight check failed. Missing prerequisites: %. Run migrations 001-012 in Central SMAV first.',
      array_to_string(v_missing_items, ', ');
  END IF;

  SELECT data_type INTO v_outlets_id_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'smav_outlets' AND column_name = 'id';

  IF v_outlets_id_type IS DISTINCT FROM 'uuid' THEN
    RAISE EXCEPTION 'SMAV 013 pre-flight check failed. public.smav_outlets.id must be uuid (found: %). Align Central SMAV smav_outlets primary key to uuid before migrating.',
      COALESCE(v_outlets_id_type, 'missing');
  END IF;
END
$smav_preflight$;

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Ensure updated_at trigger helper exists cleanly
CREATE OR REPLACE FUNCTION public.smav_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.smav_touch_updated_at() FROM PUBLIC;

-- Generic tenant-identity rebind guard for tenant-scoped tables (catalogs, printers, transactions)
CREATE OR REPLACE FUNCTION public.smav_guard_tenant_row_update()
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
     OR NEW.outlet_id IS DISTINCT FROM OLD.outlet_id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
  THEN
    RAISE EXCEPTION 'Forbidden: Only SUPERADMIN can reassign id, outlet_id, or organization_id.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.smav_guard_tenant_row_update() FROM PUBLIC;

-- Auto-populate organization_id from smav_outlets when omitted on INSERT
CREATE OR REPLACE FUNCTION public.smav_autofill_organization_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  IF NEW.organization_id IS NULL AND NEW.outlet_id IS NOT NULL THEN
    SELECT o.organization_id INTO v_org_id
    FROM public.smav_outlets o
    WHERE o.id = NEW.outlet_id;
    NEW.organization_id := v_org_id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.smav_autofill_organization_id() FROM PUBLIC;

-- ------------------------------------------------------------------------------
-- 1. Multi-Organization Tenant Hierarchy & smav_outlets Additive Extensions
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.smav_organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_code text NOT NULL UNIQUE,
  name text NOT NULL,
  primary_category text NOT NULL DEFAULT 'other',
  plan_tier text NOT NULL DEFAULT 'standard'
    CHECK (plan_tier IN ('starter', 'standard', 'growth', 'enterprise')),
  max_outlets integer NOT NULL DEFAULT 100 CHECK (max_outlets > 0),
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  billing_email text,
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_smav_organizations_code_active
  ON public.smav_organizations(org_code, is_active);

CREATE INDEX IF NOT EXISTS idx_smav_organizations_owner
  ON public.smav_organizations(owner_user_id)
  WHERE owner_user_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_smav_organizations_touch ON public.smav_organizations;
CREATE TRIGGER trg_smav_organizations_touch
  BEFORE UPDATE ON public.smav_organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.smav_touch_updated_at();

-- Additive columns on public.smav_outlets (preserves all existing rows and columns)
ALTER TABLE public.smav_outlets
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.smav_organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS branch_display_name text,
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  ADD COLUMN IF NOT EXISTS currency_code text NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS currency_symbol text NOT NULL DEFAULT '₹',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_smav_outlets_org_active
  ON public.smav_outlets(organization_id, is_active);

CREATE INDEX IF NOT EXISTS idx_smav_outlets_outlet_code
  ON public.smav_outlets(outlet_code)
  WHERE outlet_code IS NOT NULL;

DROP TRIGGER IF EXISTS trg_smav_outlets_touch ON public.smav_outlets;
CREATE TRIGGER trg_smav_outlets_touch
  BEFORE UPDATE ON public.smav_outlets
  FOR EACH ROW
  EXECUTE FUNCTION public.smav_touch_updated_at();

-- Non-recursive SECURITY DEFINER helper for organization membership visibility
CREATE OR REPLACE FUNCTION public.smav_has_organization_access(p_org_id uuid)
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
      FROM public.smav_organizations org
      WHERE org.id = p_org_id
        AND org.owner_user_id = (SELECT auth.uid())
        AND org.is_active = true
    )
    OR EXISTS (
      SELECT 1
      FROM public.smav_outlets o
      JOIN public.smav_user_outlet_roles uor ON uor.outlet_id = o.id
      JOIN public.smav_profiles sp ON sp.id = uor.user_id
      WHERE o.organization_id = p_org_id
        AND uor.user_id = (SELECT auth.uid())
        AND o.is_active = true
        AND uor.is_active = true
        AND sp.is_active = true
    );
$$;

REVOKE ALL ON FUNCTION public.smav_has_organization_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.smav_has_organization_access(uuid) TO authenticated;

ALTER TABLE public.smav_organizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.smav_organizations FROM anon;

DROP POLICY IF EXISTS "smav_organizations_select" ON public.smav_organizations;
DROP POLICY IF EXISTS "smav_organizations_insert" ON public.smav_organizations;
DROP POLICY IF EXISTS "smav_organizations_update" ON public.smav_organizations;
DROP POLICY IF EXISTS "smav_organizations_delete" ON public.smav_organizations;

CREATE POLICY "smav_organizations_select" ON public.smav_organizations
  FOR SELECT TO authenticated
  USING ((SELECT public.smav_has_organization_access(id)));

CREATE POLICY "smav_organizations_insert" ON public.smav_organizations
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.smav_is_superadmin()));

CREATE POLICY "smav_organizations_update" ON public.smav_organizations
  FOR UPDATE TO authenticated
  USING ((SELECT public.smav_is_superadmin()))
  WITH CHECK ((SELECT public.smav_is_superadmin()));

CREATE POLICY "smav_organizations_delete" ON public.smav_organizations
  FOR DELETE TO authenticated
  USING ((SELECT public.smav_is_superadmin()));

-- ------------------------------------------------------------------------------
-- 2. Configurable POS Vertical Templates (public.smav_pos_templates)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.smav_pos_templates (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  category text NOT NULL,
  description text,
  default_tax_rate numeric(5,2) NOT NULL DEFAULT 0.00 CHECK (default_tax_rate >= 0 AND default_tax_rate <= 100),
  default_tax_mode text NOT NULL DEFAULT 'exclusive'
    CHECK (default_tax_mode IN ('exclusive', 'inclusive', 'exempt')),
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  receipt_layout jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_smav_pos_templates_touch ON public.smav_pos_templates;
CREATE TRIGGER trg_smav_pos_templates_touch
  BEFORE UPDATE ON public.smav_pos_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.smav_touch_updated_at();

INSERT INTO public.smav_pos_templates (
  id, display_name, category, description, default_tax_rate, default_tax_mode, features, receipt_layout
) VALUES
  (
    'salon',
    'Salon, Spa & Wellness',
    'salon',
    'Services, packages, stylist commission assignment, GST breakdown, and WhatsApp e-bills.',
    18.00,
    'exclusive',
    '{"stylistAssignment":true,"kotPrinting":false,"tableManagement":false,"weightScale":false,"barcodeScan":false,"variants":false,"discountControl":true,"whatsappReceipt":true,"offlineFirst":true}'::jsonb,
    '{"showStylistColumn":true,"showTaxBreakup":true,"showToken":false,"paperWidthMm":80}'::jsonb
  ),
  (
    'restaurant',
    'Restaurant, Cafe & Cloud Kitchen',
    'restaurant',
    'Menu categories, variants, dine-in/takeaway/delivery modes, token numbers, and dual Bill + KOT printing.',
    5.00,
    'exclusive',
    '{"stylistAssignment":false,"kotPrinting":true,"tableManagement":true,"weightScale":false,"barcodeScan":false,"variants":true,"discountControl":true,"whatsappReceipt":true,"offlineFirst":true}'::jsonb,
    '{"showStylistColumn":false,"showTaxBreakup":true,"showToken":true,"kotPaperWidthMm":80,"paperWidthMm":80}'::jsonb
  ),
  (
    'chocolate_shop',
    'Chocolate, Confectionery & Gift Boutique',
    'chocolate_shop',
    'Weighted grams/kg items, gift box assortments, barcode lookup, batch/expiry tracking, and pack slips.',
    18.00,
    'inclusive',
    '{"stylistAssignment":false,"kotPrinting":false,"tableManagement":false,"weightScale":true,"barcodeScan":true,"boxPacking":true,"variants":true,"discountControl":true,"whatsappReceipt":true,"offlineFirst":true}'::jsonb,
    '{"showStylistColumn":false,"showUnitWeight":true,"showTaxBreakup":true,"paperWidthMm":80}'::jsonb
  ),
  (
    'retail',
    'Retail Store & Mart',
    'retail',
    'SKU/barcode billing, multi-rate GST items, stock quantities, and fast counter thermal receipts.',
    18.00,
    'inclusive',
    '{"stylistAssignment":false,"kotPrinting":false,"tableManagement":false,"weightScale":false,"barcodeScan":true,"stockTracking":true,"variants":true,"discountControl":true,"whatsappReceipt":true,"offlineFirst":true}'::jsonb,
    '{"showStylistColumn":false,"showSku":true,"showTaxBreakup":true,"paperWidthMm":80}'::jsonb
  ),
  (
    'bakery_cafe',
    'Bakery & Patisserie',
    'bakery_cafe',
    'Counter display cakes/pastries, weight-based items, takeaway tokens, and optional kitchen prep slips.',
    5.00,
    'inclusive',
    '{"stylistAssignment":false,"kotPrinting":true,"tableManagement":false,"weightScale":true,"barcodeScan":true,"variants":true,"discountControl":true,"whatsappReceipt":true,"offlineFirst":true}'::jsonb,
    '{"showStylistColumn":false,"showToken":true,"showTaxBreakup":true,"paperWidthMm":80}'::jsonb
  ),
  (
    'custom',
    'General POS Outlet',
    'other',
    'Flexible multi-purpose POS template configurable via outlet template overrides.',
    18.00,
    'exclusive',
    '{"stylistAssignment":false,"kotPrinting":false,"tableManagement":false,"weightScale":false,"barcodeScan":true,"variants":true,"discountControl":true,"whatsappReceipt":true,"offlineFirst":true}'::jsonb,
    '{"showStylistColumn":false,"showTaxBreakup":true,"paperWidthMm":80}'::jsonb
  )
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.smav_pos_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.smav_pos_templates FROM anon;

DROP POLICY IF EXISTS "smav_pos_templates_select" ON public.smav_pos_templates;
DROP POLICY IF EXISTS "smav_pos_templates_insert" ON public.smav_pos_templates;
DROP POLICY IF EXISTS "smav_pos_templates_update" ON public.smav_pos_templates;
DROP POLICY IF EXISTS "smav_pos_templates_delete" ON public.smav_pos_templates;

CREATE POLICY "smav_pos_templates_select" ON public.smav_pos_templates
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "smav_pos_templates_insert" ON public.smav_pos_templates
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.smav_is_superadmin()));

CREATE POLICY "smav_pos_templates_update" ON public.smav_pos_templates
  FOR UPDATE TO authenticated
  USING ((SELECT public.smav_is_superadmin()))
  WITH CHECK ((SELECT public.smav_is_superadmin()));

CREATE POLICY "smav_pos_templates_delete" ON public.smav_pos_templates
  FOR DELETE TO authenticated
  USING ((SELECT public.smav_is_superadmin()));

-- ------------------------------------------------------------------------------
-- 3. Dynamic Outlet Configuration (public.smav_outlet_configs)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.smav_outlet_configs (
  outlet_id uuid PRIMARY KEY REFERENCES public.smav_outlets(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.smav_organizations(id) ON DELETE SET NULL,
  hosting_mode text NOT NULL DEFAULT 'smav_hosted'
    CHECK (hosting_mode IN ('smav_hosted', 'external_supabase', 'external_api', 'hybrid')),
  pos_template_id text NOT NULL DEFAULT 'custom' REFERENCES public.smav_pos_templates(id),
  template_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  tax_config jsonb NOT NULL DEFAULT '{"gstEnabled":true,"defaultRate":18,"cgstSplit":0.5,"sgstSplit":0.5,"pricesIncludeTax":false}'::jsonb,
  receipt_config jsonb NOT NULL DEFAULT '{"paperWidthMm":80,"showTaxBreakup":true,"autoPrintOnCheckout":true,"copies":1}'::jsonb,
  external_supabase_url text,
  external_api_base_url text,
  external_catalog_endpoint text,
  external_staff_endpoint text,
  external_webhook_url text,
  catalog_revision bigint NOT NULL DEFAULT 1 CHECK (catalog_revision >= 1),
  whatsapp_config jsonb NOT NULL DEFAULT '{"enabled":false,"provider":"meta_cloud"}'::jsonb,
  offline_sync_policy jsonb NOT NULL DEFAULT '{"enabled":true,"maxQueueSize":500,"retryIntervalSec":30}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_smav_outlet_configs_org
  ON public.smav_outlet_configs(organization_id);

CREATE INDEX IF NOT EXISTS idx_smav_outlet_configs_mode_template
  ON public.smav_outlet_configs(hosting_mode, pos_template_id);

DROP TRIGGER IF EXISTS trg_smav_outlet_configs_touch ON public.smav_outlet_configs;
CREATE TRIGGER trg_smav_outlet_configs_touch
  BEFORE UPDATE ON public.smav_outlet_configs
  FOR EACH ROW
  EXECUTE FUNCTION public.smav_touch_updated_at();

-- Prevent outlet ADMINs from changing infrastructure routing, external URLs,
-- tenant ownership, or tampering with catalog_revision directly.
CREATE OR REPLACE FUNCTION public.smav_guard_outlet_config_update()
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

  IF NOT (SELECT public.smav_is_outlet_admin(OLD.outlet_id)) THEN
    RAISE EXCEPTION 'Forbidden: Active outlet ADMIN privileges are required to update outlet configuration.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.outlet_id IS DISTINCT FROM OLD.outlet_id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.hosting_mode IS DISTINCT FROM OLD.hosting_mode
     OR NEW.pos_template_id IS DISTINCT FROM OLD.pos_template_id
     OR NEW.external_supabase_url IS DISTINCT FROM OLD.external_supabase_url
     OR NEW.external_api_base_url IS DISTINCT FROM OLD.external_api_base_url
     OR NEW.external_catalog_endpoint IS DISTINCT FROM OLD.external_catalog_endpoint
     OR NEW.external_staff_endpoint IS DISTINCT FROM OLD.external_staff_endpoint
     OR NEW.external_webhook_url IS DISTINCT FROM OLD.external_webhook_url
  THEN
    RAISE EXCEPTION 'Forbidden: Only SUPERADMIN can modify hosting mode, POS template binding, organization, or external integration endpoints.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.catalog_revision IS DISTINCT FROM OLD.catalog_revision
     AND COALESCE(current_setting('smav.internal_revision_bump', true), '0') <> '1'
  THEN
    RAISE EXCEPTION 'Forbidden: catalog_revision is managed automatically by catalog mutations.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.smav_guard_outlet_config_update() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_smav_outlet_configs_autofill_org ON public.smav_outlet_configs;
CREATE TRIGGER trg_smav_outlet_configs_autofill_org
  BEFORE INSERT ON public.smav_outlet_configs
  FOR EACH ROW
  EXECUTE FUNCTION public.smav_autofill_organization_id();

DROP TRIGGER IF EXISTS trg_smav_outlet_configs_guard ON public.smav_outlet_configs;
CREATE TRIGGER trg_smav_outlet_configs_guard
  BEFORE UPDATE ON public.smav_outlet_configs
  FOR EACH ROW
  EXECUTE FUNCTION public.smav_guard_outlet_config_update();

ALTER TABLE public.smav_outlet_configs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.smav_outlet_configs FROM anon;

DROP POLICY IF EXISTS "smav_outlet_configs_select" ON public.smav_outlet_configs;
DROP POLICY IF EXISTS "smav_outlet_configs_insert" ON public.smav_outlet_configs;
DROP POLICY IF EXISTS "smav_outlet_configs_update" ON public.smav_outlet_configs;
DROP POLICY IF EXISTS "smav_outlet_configs_delete" ON public.smav_outlet_configs;

CREATE POLICY "smav_outlet_configs_select" ON public.smav_outlet_configs
  FOR SELECT TO authenticated
  USING ((SELECT public.smav_has_outlet_access(outlet_id)));

CREATE POLICY "smav_outlet_configs_insert" ON public.smav_outlet_configs
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.smav_is_superadmin()));

CREATE POLICY "smav_outlet_configs_update" ON public.smav_outlet_configs
  FOR UPDATE TO authenticated
  USING ((SELECT public.smav_is_outlet_admin(outlet_id)))
  WITH CHECK ((SELECT public.smav_is_outlet_admin(outlet_id)));

CREATE POLICY "smav_outlet_configs_delete" ON public.smav_outlet_configs
  FOR DELETE TO authenticated
  USING ((SELECT public.smav_is_superadmin()));

-- ------------------------------------------------------------------------------
-- 4. Encrypted Per-Outlet Integration Credentials (Server/Edge-Only Access)
--    * NEVER readable or writable by anon or authenticated browser clients.
--    * Incoming scoped API keys stored strictly as SHA-256 hashes + key prefix.
--    * Outbound service/API/HMAC/WhatsApp secrets stored encrypted at rest.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.smav_outlet_credentials (
  outlet_id uuid PRIMARY KEY REFERENCES public.smav_outlets(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.smav_organizations(id) ON DELETE SET NULL,
  auth_scheme text NOT NULL DEFAULT 'x_integration_key'
    CHECK (auth_scheme IN ('x_integration_key', 'bearer_token', 'hmac_sha256')),
  integration_key_hash text,
  integration_key_prefix text,
  external_supabase_service_key_enc text,
  external_api_key_enc text,
  webhook_hmac_secret_enc text,
  whatsapp_api_token_enc text,
  key_version integer NOT NULL DEFAULT 1 CHECK (key_version >= 1),
  is_active boolean NOT NULL DEFAULT true,
  last_used_at timestamptz,
  rotated_at timestamptz,
  rotated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_smav_outlet_credentials_key_hash
  ON public.smav_outlet_credentials(integration_key_hash)
  WHERE integration_key_hash IS NOT NULL AND is_active = true;

DROP TRIGGER IF EXISTS trg_smav_outlet_credentials_touch ON public.smav_outlet_credentials;
CREATE TRIGGER trg_smav_outlet_credentials_touch
  BEFORE UPDATE ON public.smav_outlet_credentials
  FOR EACH ROW
  EXECUTE FUNCTION public.smav_touch_updated_at();

ALTER TABLE public.smav_outlet_credentials ENABLE ROW LEVEL SECURITY;

-- Zero client privileges and zero client RLS policies = strict server-only (service_role) table.
REVOKE ALL ON public.smav_outlet_credentials FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 5. Tenant-Scoped Catalogs & Automatic Per-Outlet Revision Tracking
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.smav_catalog_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id uuid NOT NULL REFERENCES public.smav_outlets(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.smav_organizations(id) ON DELETE SET NULL,
  external_item_id text,
  item_type text NOT NULL DEFAULT 'product'
    CHECK (item_type IN ('service', 'menu_item', 'product', 'package', 'weight_item', 'custom')),
  name text NOT NULL,
  category text NOT NULL DEFAULT 'General',
  subcategory text NOT NULL DEFAULT '',
  sku text,
  barcode text,
  unit_type text NOT NULL DEFAULT 'unit'
    CHECK (unit_type IN ('unit', 'kg', 'g', 'box', 'pack', 'session', 'plate', 'ml', 'l')),
  unit_step numeric(10,3) NOT NULL DEFAULT 1.000 CHECK (unit_step > 0),
  price numeric(12,2) NOT NULL DEFAULT 0.00 CHECK (price >= 0),
  tax_percent numeric(5,2) NOT NULL DEFAULT 0.00 CHECK (tax_percent >= 0 AND tax_percent <= 100),
  is_tax_inclusive boolean NOT NULL DEFAULT false,
  is_discount_eligible boolean NOT NULL DEFAULT true,
  duration_minutes integer CHECK (duration_minutes IS NULL OR duration_minutes >= 0),
  is_veg boolean,
  stock_qty numeric(12,3),
  variants jsonb NOT NULL DEFAULT '[]'::jsonb,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  is_deleted boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_smav_catalog_outlet_external_id
  ON public.smav_catalog_items(outlet_id, external_item_id)
  WHERE external_item_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_smav_catalog_outlet_sku
  ON public.smav_catalog_items(outlet_id, sku)
  WHERE sku IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_smav_catalog_delta_sync
  ON public.smav_catalog_items(outlet_id, revision, is_active, is_deleted);

CREATE INDEX IF NOT EXISTS idx_smav_catalog_org_outlet_cat
  ON public.smav_catalog_items(organization_id, outlet_id, category);

CREATE INDEX IF NOT EXISTS idx_smav_catalog_barcode
  ON public.smav_catalog_items(outlet_id, barcode)
  WHERE barcode IS NOT NULL;

-- Atomic per-outlet catalog revision bump + tenant isolation guard
CREATE OR REPLACE FUNCTION public.smav_bump_outlet_catalog_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org_id uuid;
  v_next_rev bigint;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF COALESCE((SELECT auth.role()), '') <> 'service_role'
       AND NOT (SELECT public.smav_is_superadmin())
       AND (
         NEW.id IS DISTINCT FROM OLD.id
         OR NEW.outlet_id IS DISTINCT FROM OLD.outlet_id
         OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
       )
    THEN
      RAISE EXCEPTION 'Forbidden: Only SUPERADMIN can reassign catalog item id, outlet_id, or organization_id.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.organization_id IS NULL THEN
    SELECT o.organization_id INTO v_org_id
    FROM public.smav_outlets o
    WHERE o.id = NEW.outlet_id;
    NEW.organization_id := v_org_id;
  END IF;

  -- Ensure outlet config row exists before bumping revision
  INSERT INTO public.smav_outlet_configs (outlet_id, organization_id)
  VALUES (NEW.outlet_id, NEW.organization_id)
  ON CONFLICT (outlet_id) DO NOTHING;

  PERFORM set_config('smav.internal_revision_bump', '1', true);

  UPDATE public.smav_outlet_configs
  SET catalog_revision = catalog_revision + 1
  WHERE outlet_id = NEW.outlet_id
  RETURNING catalog_revision INTO v_next_rev;

  PERFORM set_config('smav.internal_revision_bump', '0', true);

  NEW.revision := COALESCE(v_next_rev, 1);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.smav_bump_outlet_catalog_revision() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_smav_catalog_items_revision ON public.smav_catalog_items;
CREATE TRIGGER trg_smav_catalog_items_revision
  BEFORE INSERT OR UPDATE ON public.smav_catalog_items
  FOR EACH ROW
  EXECUTE FUNCTION public.smav_bump_outlet_catalog_revision();

ALTER TABLE public.smav_catalog_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.smav_catalog_items FROM anon;

DROP POLICY IF EXISTS "smav_catalog_items_select" ON public.smav_catalog_items;
DROP POLICY IF EXISTS "smav_catalog_items_insert" ON public.smav_catalog_items;
DROP POLICY IF EXISTS "smav_catalog_items_update" ON public.smav_catalog_items;
DROP POLICY IF EXISTS "smav_catalog_items_delete" ON public.smav_catalog_items;

CREATE POLICY "smav_catalog_items_select" ON public.smav_catalog_items
  FOR SELECT TO authenticated
  USING ((SELECT public.smav_has_outlet_access(outlet_id)));

CREATE POLICY "smav_catalog_items_insert" ON public.smav_catalog_items
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.smav_is_outlet_admin(outlet_id)));

CREATE POLICY "smav_catalog_items_update" ON public.smav_catalog_items
  FOR UPDATE TO authenticated
  USING ((SELECT public.smav_is_outlet_admin(outlet_id)))
  WITH CHECK ((SELECT public.smav_is_outlet_admin(outlet_id)));

CREATE POLICY "smav_catalog_items_delete" ON public.smav_catalog_items
  FOR DELETE TO authenticated
  USING ((SELECT public.smav_is_outlet_admin(outlet_id)));

-- ------------------------------------------------------------------------------
-- 6. Tenant-Scoped Printers (public.smav_outlet_printers)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.smav_outlet_printers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id uuid NOT NULL REFERENCES public.smav_outlets(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.smav_organizations(id) ON DELETE SET NULL,
  printer_name text NOT NULL,
  connection_type text NOT NULL DEFAULT 'bluetooth'
    CHECK (connection_type IN ('bluetooth', 'usb', 'network_ip', 'system')),
  mac_or_ip text,
  network_port integer NOT NULL DEFAULT 9100 CHECK (network_port > 0 AND network_port <= 65535),
  paper_width_mm integer NOT NULL DEFAULT 80 CHECK (paper_width_mm IN (58, 80)),
  purpose text NOT NULL DEFAULT 'customer_bill'
    CHECK (purpose IN ('customer_bill', 'kitchen_kot', 'pack_slip', 'all')),
  auto_print boolean NOT NULL DEFAULT true,
  copies integer NOT NULL DEFAULT 1 CHECK (copies >= 1 AND copies <= 10),
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_smav_outlet_printers_lookup
  ON public.smav_outlet_printers(outlet_id, is_active, purpose);

CREATE UNIQUE INDEX IF NOT EXISTS idx_smav_outlet_printers_default_purpose
  ON public.smav_outlet_printers(outlet_id, purpose)
  WHERE is_default = true AND is_active = true;

DROP TRIGGER IF EXISTS trg_smav_outlet_printers_touch ON public.smav_outlet_printers;
CREATE TRIGGER trg_smav_outlet_printers_touch
  BEFORE UPDATE ON public.smav_outlet_printers
  FOR EACH ROW
  EXECUTE FUNCTION public.smav_touch_updated_at();

DROP TRIGGER IF EXISTS trg_smav_outlet_printers_autofill_org ON public.smav_outlet_printers;
CREATE TRIGGER trg_smav_outlet_printers_autofill_org
  BEFORE INSERT ON public.smav_outlet_printers
  FOR EACH ROW
  EXECUTE FUNCTION public.smav_autofill_organization_id();

DROP TRIGGER IF EXISTS trg_smav_outlet_printers_guard ON public.smav_outlet_printers;
CREATE TRIGGER trg_smav_outlet_printers_guard
  BEFORE UPDATE ON public.smav_outlet_printers
  FOR EACH ROW
  EXECUTE FUNCTION public.smav_guard_tenant_row_update();

ALTER TABLE public.smav_outlet_printers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.smav_outlet_printers FROM anon;

DROP POLICY IF EXISTS "smav_outlet_printers_select" ON public.smav_outlet_printers;
DROP POLICY IF EXISTS "smav_outlet_printers_insert" ON public.smav_outlet_printers;
DROP POLICY IF EXISTS "smav_outlet_printers_update" ON public.smav_outlet_printers;
DROP POLICY IF EXISTS "smav_outlet_printers_delete" ON public.smav_outlet_printers;

CREATE POLICY "smav_outlet_printers_select" ON public.smav_outlet_printers
  FOR SELECT TO authenticated
  USING ((SELECT public.smav_has_outlet_access(outlet_id)));

CREATE POLICY "smav_outlet_printers_insert" ON public.smav_outlet_printers
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.smav_is_outlet_admin(outlet_id)));

CREATE POLICY "smav_outlet_printers_update" ON public.smav_outlet_printers
  FOR UPDATE TO authenticated
  USING ((SELECT public.smav_is_outlet_admin(outlet_id)))
  WITH CHECK ((SELECT public.smav_is_outlet_admin(outlet_id)));

CREATE POLICY "smav_outlet_printers_delete" ON public.smav_outlet_printers
  FOR DELETE TO authenticated
  USING ((SELECT public.smav_is_outlet_admin(outlet_id)));

-- ------------------------------------------------------------------------------
-- 7. Unified Tenant-Scoped Transactions (public.smav_outlet_transactions)
--    * Complements legacy smav_salon_bills without altering or replacing it.
--    * Mirrors 011 Section 5C permissions:
--        - SUPERADMIN / ADMIN: view all outlet transactions
--        - STAFF (POS_BILLING): create in assigned outlets; read own transactions
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.smav_outlet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id uuid NOT NULL REFERENCES public.smav_outlets(id) ON DELETE RESTRICT,
  organization_id uuid REFERENCES public.smav_organizations(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  device_id text,
  transaction_number text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  template_type text NOT NULL DEFAULT 'custom',
  order_type text NOT NULL DEFAULT 'counter'
    CHECK (order_type IN ('counter', 'appointment', 'dine_in', 'takeaway', 'delivery', 'online')),
  table_or_counter text,
  token_number text,
  customer_name text,
  customer_phone text,
  payment_mode text NOT NULL DEFAULT 'cash'
    CHECK (payment_mode IN ('cash', 'upi', 'card', 'split', 'credit', 'other')),
  subtotal numeric(12,2) NOT NULL DEFAULT 0.00,
  discount_amount numeric(12,2) NOT NULL DEFAULT 0.00,
  tax_amount numeric(12,2) NOT NULL DEFAULT 0.00,
  tax_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  round_off numeric(6,2) NOT NULL DEFAULT 0.00,
  grand_total numeric(12,2) NOT NULL DEFAULT 0.00,
  items jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array'),
  catalog_revision_at_sale bigint,
  kot_status text NOT NULL DEFAULT 'none'
    CHECK (kot_status IN ('none', 'pending', 'printed', 'skipped')),
  print_status text NOT NULL DEFAULT 'pending'
    CHECK (print_status IN ('pending', 'printed', 'offline', 'failed', 'skipped')),
  whatsapp_status text NOT NULL DEFAULT 'none'
    CHECK (whatsapp_status IN ('none', 'queued', 'sent', 'delivered', 'failed')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at_local timestamptz NOT NULL DEFAULT now(),
  created_at_server timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_smav_outlet_tx_outlet_created
  ON public.smav_outlet_transactions(outlet_id, created_at_server DESC);

CREATE INDEX IF NOT EXISTS idx_smav_outlet_tx_org_created
  ON public.smav_outlet_transactions(organization_id, created_at_server DESC);

CREATE INDEX IF NOT EXISTS idx_smav_outlet_tx_number
  ON public.smav_outlet_transactions(outlet_id, transaction_number);

CREATE INDEX IF NOT EXISTS idx_smav_outlet_tx_phone
  ON public.smav_outlet_transactions(outlet_id, customer_phone)
  WHERE customer_phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_smav_outlet_tx_creator
  ON public.smav_outlet_transactions(created_by, created_at_server DESC);

CREATE OR REPLACE FUNCTION public.smav_enrich_and_guard_transaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.organization_id IS NULL THEN
      SELECT o.organization_id INTO v_org_id
      FROM public.smav_outlets o
      WHERE o.id = NEW.outlet_id;
      NEW.organization_id := v_org_id;
    END IF;
    RETURN NEW;
  END IF;

  IF COALESCE((SELECT auth.role()), '') = 'service_role'
     OR (SELECT public.smav_is_superadmin())
  THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.outlet_id IS DISTINCT FROM OLD.outlet_id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
  THEN
    RAISE EXCEPTION 'Forbidden: Immutable transaction identity fields cannot be modified.'
      USING ERRCODE = '42501';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.smav_enrich_and_guard_transaction() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_smav_outlet_tx_guard ON public.smav_outlet_transactions;
CREATE TRIGGER trg_smav_outlet_tx_guard
  BEFORE INSERT OR UPDATE ON public.smav_outlet_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.smav_enrich_and_guard_transaction();

ALTER TABLE public.smav_outlet_transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.smav_outlet_transactions FROM anon;

DROP POLICY IF EXISTS "smav_outlet_tx_select" ON public.smav_outlet_transactions;
DROP POLICY IF EXISTS "smav_outlet_tx_insert" ON public.smav_outlet_transactions;
DROP POLICY IF EXISTS "smav_outlet_tx_update" ON public.smav_outlet_transactions;
DROP POLICY IF EXISTS "smav_outlet_tx_delete" ON public.smav_outlet_transactions;

CREATE POLICY "smav_outlet_tx_select" ON public.smav_outlet_transactions
  FOR SELECT TO authenticated
  USING (
    (SELECT public.smav_is_outlet_admin(outlet_id))
    OR (
      created_by = (SELECT auth.uid())
      AND (SELECT public.smav_has_outlet_access(outlet_id))
    )
  );

CREATE POLICY "smav_outlet_tx_insert" ON public.smav_outlet_transactions
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND (SELECT public.smav_has_outlet_access(outlet_id))
  );

CREATE POLICY "smav_outlet_tx_update" ON public.smav_outlet_transactions
  FOR UPDATE TO authenticated
  USING ((SELECT public.smav_is_outlet_admin(outlet_id)))
  WITH CHECK ((SELECT public.smav_is_outlet_admin(outlet_id)));

CREATE POLICY "smav_outlet_tx_delete" ON public.smav_outlet_transactions
  FOR DELETE TO authenticated
  USING ((SELECT public.smav_is_superadmin()));

-- ------------------------------------------------------------------------------
-- 8. Durable WhatsApp Jobs & Offline Sync Storage + Outbox Tenant Indexing
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.smav_whatsapp_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id uuid NOT NULL REFERENCES public.smav_outlets(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.smav_organizations(id) ON DELETE SET NULL,
  transaction_id uuid REFERENCES public.smav_outlet_transactions(id) ON DELETE SET NULL,
  legacy_bill_id uuid,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL UNIQUE,
  recipient_phone text NOT NULL,
  template_name text NOT NULL,
  template_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'sent', 'delivered', 'read', 'failed', 'cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  next_retry_at timestamptz,
  provider_message_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Conditionally attach FK to smav_salon_bills if present (safe across branches)
DO $smav_wa_fk$
BEGIN
  IF to_regclass('public.smav_salon_bills') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = 'fk_smav_whatsapp_jobs_legacy_bill'
         AND conrelid = 'public.smav_whatsapp_jobs'::regclass
     )
  THEN
    ALTER TABLE public.smav_whatsapp_jobs
      ADD CONSTRAINT fk_smav_whatsapp_jobs_legacy_bill
      FOREIGN KEY (legacy_bill_id) REFERENCES public.smav_salon_bills(id) ON DELETE SET NULL;
  END IF;
END
$smav_wa_fk$;

CREATE INDEX IF NOT EXISTS idx_smav_whatsapp_jobs_outlet_status
  ON public.smav_whatsapp_jobs(outlet_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_smav_whatsapp_jobs_retry
  ON public.smav_whatsapp_jobs(next_retry_at)
  WHERE status IN ('queued', 'failed');

DROP TRIGGER IF EXISTS trg_smav_whatsapp_jobs_touch ON public.smav_whatsapp_jobs;
CREATE TRIGGER trg_smav_whatsapp_jobs_touch
  BEFORE UPDATE ON public.smav_whatsapp_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.smav_touch_updated_at();

DROP TRIGGER IF EXISTS trg_smav_whatsapp_jobs_autofill_org ON public.smav_whatsapp_jobs;
CREATE TRIGGER trg_smav_whatsapp_jobs_autofill_org
  BEFORE INSERT ON public.smav_whatsapp_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.smav_autofill_organization_id();

DROP TRIGGER IF EXISTS trg_smav_whatsapp_jobs_guard ON public.smav_whatsapp_jobs;
CREATE TRIGGER trg_smav_whatsapp_jobs_guard
  BEFORE UPDATE ON public.smav_whatsapp_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.smav_guard_tenant_row_update();

ALTER TABLE public.smav_whatsapp_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.smav_whatsapp_jobs FROM anon;

DROP POLICY IF EXISTS "smav_whatsapp_jobs_select" ON public.smav_whatsapp_jobs;
DROP POLICY IF EXISTS "smav_whatsapp_jobs_insert" ON public.smav_whatsapp_jobs;
DROP POLICY IF EXISTS "smav_whatsapp_jobs_update" ON public.smav_whatsapp_jobs;
DROP POLICY IF EXISTS "smav_whatsapp_jobs_delete" ON public.smav_whatsapp_jobs;

CREATE POLICY "smav_whatsapp_jobs_select" ON public.smav_whatsapp_jobs
  FOR SELECT TO authenticated
  USING (
    (SELECT public.smav_is_outlet_admin(outlet_id))
    OR (
      created_by = (SELECT auth.uid())
      AND (SELECT public.smav_has_outlet_access(outlet_id))
    )
  );

CREATE POLICY "smav_whatsapp_jobs_insert" ON public.smav_whatsapp_jobs
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND (SELECT public.smav_has_outlet_access(outlet_id))
  );

CREATE POLICY "smav_whatsapp_jobs_update" ON public.smav_whatsapp_jobs
  FOR UPDATE TO authenticated
  USING ((SELECT public.smav_is_outlet_admin(outlet_id)))
  WITH CHECK ((SELECT public.smav_is_outlet_admin(outlet_id)));

CREATE POLICY "smav_whatsapp_jobs_delete" ON public.smav_whatsapp_jobs
  FOR DELETE TO authenticated
  USING ((SELECT public.smav_is_superadmin()));

CREATE TABLE IF NOT EXISTS public.smav_offline_sync_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id uuid NOT NULL REFERENCES public.smav_outlets(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.smav_organizations(id) ON DELETE SET NULL,
  device_id text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL UNIQUE,
  entity_type text NOT NULL
    CHECK (entity_type IN ('transaction', 'salon_bill', 'restaurant_order', 'print_job', 'whatsapp_job', 'catalog_ack')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'synced', 'conflict', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at_local timestamptz NOT NULL DEFAULT now(),
  synced_at_server timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_smav_offline_sync_outlet_status
  ON public.smav_offline_sync_queue(outlet_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_smav_offline_sync_device
  ON public.smav_offline_sync_queue(device_id, status);

DROP TRIGGER IF EXISTS trg_smav_offline_sync_touch ON public.smav_offline_sync_queue;
CREATE TRIGGER trg_smav_offline_sync_touch
  BEFORE UPDATE ON public.smav_offline_sync_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.smav_touch_updated_at();

DROP TRIGGER IF EXISTS trg_smav_offline_sync_autofill_org ON public.smav_offline_sync_queue;
CREATE TRIGGER trg_smav_offline_sync_autofill_org
  BEFORE INSERT ON public.smav_offline_sync_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.smav_autofill_organization_id();

DROP TRIGGER IF EXISTS trg_smav_offline_sync_guard ON public.smav_offline_sync_queue;
CREATE TRIGGER trg_smav_offline_sync_guard
  BEFORE UPDATE ON public.smav_offline_sync_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.smav_guard_tenant_row_update();

ALTER TABLE public.smav_offline_sync_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.smav_offline_sync_queue FROM anon;

DROP POLICY IF EXISTS "smav_offline_sync_select" ON public.smav_offline_sync_queue;
DROP POLICY IF EXISTS "smav_offline_sync_insert" ON public.smav_offline_sync_queue;
DROP POLICY IF EXISTS "smav_offline_sync_update" ON public.smav_offline_sync_queue;
DROP POLICY IF EXISTS "smav_offline_sync_delete" ON public.smav_offline_sync_queue;

CREATE POLICY "smav_offline_sync_select" ON public.smav_offline_sync_queue
  FOR SELECT TO authenticated
  USING (
    (SELECT public.smav_is_outlet_admin(outlet_id))
    OR (
      created_by = (SELECT auth.uid())
      AND (SELECT public.smav_has_outlet_access(outlet_id))
    )
  );

CREATE POLICY "smav_offline_sync_insert" ON public.smav_offline_sync_queue
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND (SELECT public.smav_has_outlet_access(outlet_id))
  );

CREATE POLICY "smav_offline_sync_update" ON public.smav_offline_sync_queue
  FOR UPDATE TO authenticated
  USING ((SELECT public.smav_is_outlet_admin(outlet_id)))
  WITH CHECK ((SELECT public.smav_is_outlet_admin(outlet_id)));

CREATE POLICY "smav_offline_sync_delete" ON public.smav_offline_sync_queue
  FOR DELETE TO authenticated
  USING ((SELECT public.smav_is_superadmin()));

-- Additive organization scoping on existing migration-012 sync outbox
ALTER TABLE public.smav_sync_outbox
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.smav_organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_smav_sync_outbox_org_outlet_status
  ON public.smav_sync_outbox(organization_id, outlet_id, status, created_at DESC);

-- ------------------------------------------------------------------------------
-- 9. Non-Destructive Backfill for Existing Organizations, Glossy Looks & MOZZ
--    * Only fills missing organization_id and inserts missing smav_outlet_configs.
--    * Never deletes, resets, or overwrites existing outlet data or users.
-- ------------------------------------------------------------------------------
DO $smav_backfill$
DECLARE
  v_outlet RECORD;
  v_org_code text;
  v_org_name text;
  v_org_cat text;
  v_org_id uuid;
  v_template_id text;
  v_hosting_mode text;
  v_ext_supabase text;
  v_ext_api text;
  v_ext_staff text;
  v_ext_webhook text;
BEGIN
  FOR v_outlet IN
    SELECT
      id,
      outlet_code,
      code,
      branch_code,
      business_id,
      business_name,
      business_type,
      category,
      name,
      outlet_name,
      organization_id,
      metadata
    FROM public.smav_outlets
  LOOP
    -- Determine canonical org_code and metadata
    IF LOWER(COALESCE(v_outlet.outlet_code, v_outlet.code, v_outlet.branch_code, '')) = 'glossylooks' THEN
      v_org_code := 'the_glossy_looks';
      v_org_name := COALESCE(NULLIF(TRIM(v_outlet.business_name), ''), 'The Glossy Looks Salon & Spa');
      v_org_cat := 'salon';
      v_template_id := 'salon';
      v_hosting_mode := 'hybrid';
      v_ext_supabase := COALESCE(NULLIF(TRIM(v_outlet.metadata->>'supabaseUrl'), ''), 'https://onswigwiwuvkvoduuhxr.supabase.co');
      v_ext_api := COALESCE(NULLIF(TRIM(v_outlet.metadata->>'apiBaseUrl'), ''), 'https://www.glossylooks.in/api');
      v_ext_staff := COALESCE(NULLIF(TRIM(v_outlet.metadata->>'staffEndpoint'), ''), 'https://www.glossylooks.in/api/staff');
      v_ext_webhook := COALESCE(NULLIF(TRIM(v_outlet.metadata->>'webhookUrl'), ''), 'https://www.glossylooks.in/api/webhooks/smav');
    ELSIF LOWER(COALESCE(v_outlet.outlet_code, v_outlet.code, v_outlet.branch_code, '')) = 'mozz' THEN
      v_org_code := 'mozz_starters4u';
      v_org_name := COALESCE(NULLIF(TRIM(v_outlet.business_name), ''), 'MOZZ / Starters4U');
      v_org_cat := 'restaurant';
      v_template_id := 'restaurant';
      v_hosting_mode := 'hybrid';
      v_ext_supabase := COALESCE(NULLIF(TRIM(v_outlet.metadata->>'supabaseUrl'), ''), 'https://uyqdnqbadfysnbzbncyj.supabase.co');
      v_ext_api := COALESCE(NULLIF(TRIM(v_outlet.metadata->>'apiBaseUrl'), ''), 'https://www.starters4u.in/api');
      v_ext_staff := NULLIF(TRIM(v_outlet.metadata->>'staffEndpoint'), '');
      v_ext_webhook := NULLIF(TRIM(v_outlet.metadata->>'webhookUrl'), '');
    ELSE
      v_org_code := LOWER(REGEXP_REPLACE(
        COALESCE(
          NULLIF(TRIM(v_outlet.business_id), ''),
          NULLIF(TRIM(v_outlet.outlet_code), ''),
          NULLIF(TRIM(v_outlet.code), ''),
          v_outlet.id::text
        ),
        '[^a-zA-Z0-9_]+', '_', 'g'
      ));
      v_org_name := COALESCE(
        NULLIF(TRIM(v_outlet.business_name), ''),
        NULLIF(TRIM(v_outlet.name), ''),
        NULLIF(TRIM(v_outlet.outlet_name), ''),
        'SMAV Organization'
      );
      v_org_cat := LOWER(COALESCE(NULLIF(TRIM(v_outlet.category), ''), NULLIF(TRIM(v_outlet.business_type), ''), 'other'));
      v_template_id := CASE
        WHEN v_org_cat IN ('salon', 'spa', 'wellness') THEN 'salon'
        WHEN v_org_cat IN ('restaurant', 'diner', 'cloud_kitchen') THEN 'restaurant'
        WHEN v_org_cat IN ('chocolate_shop', 'chocolate', 'confectionery') THEN 'chocolate_shop'
        WHEN v_org_cat IN ('retail', 'mart', 'store') THEN 'retail'
        WHEN v_org_cat IN ('bakery', 'bakery_cafe', 'cafe') THEN 'bakery_cafe'
        ELSE 'custom'
      END;
      v_ext_supabase := NULLIF(TRIM(v_outlet.metadata->>'supabaseUrl'), '');
      v_ext_api := NULLIF(TRIM(v_outlet.metadata->>'apiBaseUrl'), '');
      v_ext_staff := NULLIF(TRIM(v_outlet.metadata->>'staffEndpoint'), '');
      v_ext_webhook := NULLIF(TRIM(v_outlet.metadata->>'webhookUrl'), '');
      v_hosting_mode := CASE
        WHEN v_ext_supabase IS NOT NULL OR v_ext_api IS NOT NULL THEN 'hybrid'
        ELSE 'smav_hosted'
      END;
    END IF;

    -- Ensure organization exists without modifying existing rows
    INSERT INTO public.smav_organizations (org_code, name, primary_category)
    VALUES (v_org_code, v_org_name, v_org_cat)
    ON CONFLICT (org_code) DO NOTHING;

    SELECT id INTO v_org_id
    FROM public.smav_organizations
    WHERE org_code = v_org_code
    LIMIT 1;

    -- Attach organization_id to outlet only if currently NULL
    IF v_outlet.organization_id IS NULL AND v_org_id IS NOT NULL THEN
      UPDATE public.smav_outlets
      SET organization_id = v_org_id
      WHERE id = v_outlet.id
        AND organization_id IS NULL;
    END IF;

    -- Seed smav_outlet_configs non-destructively (no overwrite if already configured)
    INSERT INTO public.smav_outlet_configs (
      outlet_id,
      organization_id,
      hosting_mode,
      pos_template_id,
      external_supabase_url,
      external_api_base_url,
      external_staff_endpoint,
      external_webhook_url
    ) VALUES (
      v_outlet.id,
      COALESCE(v_outlet.organization_id, v_org_id),
      v_hosting_mode,
      v_template_id,
      v_ext_supabase,
      v_ext_api,
      v_ext_staff,
      v_ext_webhook
    )
    ON CONFLICT (outlet_id) DO NOTHING;
  END LOOP;

  -- Backfill organization_id on existing smav_sync_outbox rows where NULL
  UPDATE public.smav_sync_outbox ob
  SET organization_id = o.organization_id
  FROM public.smav_outlets o
  WHERE ob.outlet_id = o.id
    AND ob.organization_id IS NULL
    AND o.organization_id IS NOT NULL;
END
$smav_backfill$;

COMMIT;

-- ==============================================================================
-- Post-Migration Verification Queries (Read-Only — Run After Execution)
-- ==============================================================================
-- 1. Confirm all existing outlets have an organization and config:
--    SELECT o.id, o.outlet_code, o.name, o.organization_id, org.org_code,
--           cfg.hosting_mode, cfg.pos_template_id, cfg.catalog_revision
--    FROM public.smav_outlets o
--    LEFT JOIN public.smav_organizations org ON org.id = o.organization_id
--    LEFT JOIN public.smav_outlet_configs cfg ON cfg.outlet_id = o.id;
--
-- 2. Confirm 6 POS templates exist:
--    SELECT id, display_name, default_tax_rate, default_tax_mode FROM public.smav_pos_templates ORDER BY id;
--
-- 3. Confirm smav_outlet_credentials has ZERO grants for anon/authenticated:
--    SELECT grantee, privilege_type
--    FROM information_schema.role_table_grants
--    WHERE table_schema = 'public' AND table_name = 'smav_outlet_credentials';
--
-- ==============================================================================
-- Rollback Guidance (ONLY if Phase 1 must be reverted before Phase 2 rollout)
-- ==============================================================================
-- Note: Because Phase 1 is strictly additive, existing features keep working
-- without rolling back. If you must drop Phase 1 tables in reverse dependency
-- order (NO impact on 001–012 tables, auth.users, roles, or smav_salon_bills):
--
-- BEGIN;
--   DROP INDEX IF EXISTS public.idx_smav_sync_outbox_org_outlet_status;
--   ALTER TABLE public.smav_sync_outbox DROP COLUMN IF EXISTS organization_id;
--   DROP TABLE IF EXISTS public.smav_offline_sync_queue;
--   DROP TABLE IF EXISTS public.smav_whatsapp_jobs;
--   DROP TABLE IF EXISTS public.smav_outlet_transactions;
--   DROP TABLE IF EXISTS public.smav_outlet_printers;
--   DROP TABLE IF EXISTS public.smav_catalog_items;
--   DROP TABLE IF EXISTS public.smav_outlet_credentials;
--   DROP TABLE IF EXISTS public.smav_outlet_configs;
--   DROP TABLE IF EXISTS public.smav_pos_templates;
--   DROP TRIGGER IF EXISTS trg_smav_outlets_touch ON public.smav_outlets;
--   DROP INDEX IF EXISTS public.idx_smav_outlets_outlet_code;
--   DROP INDEX IF EXISTS public.idx_smav_outlets_org_active;
--   ALTER TABLE public.smav_outlets
--     DROP COLUMN IF EXISTS updated_at,
--     DROP COLUMN IF EXISTS currency_symbol,
--     DROP COLUMN IF EXISTS currency_code,
--     DROP COLUMN IF EXISTS timezone,
--     DROP COLUMN IF EXISTS branch_display_name,
--     DROP COLUMN IF EXISTS organization_id;
--   DROP FUNCTION IF EXISTS public.smav_has_organization_access(uuid);
--   DROP TABLE IF EXISTS public.smav_organizations;
--   DROP FUNCTION IF EXISTS public.smav_enrich_and_guard_transaction();
--   DROP FUNCTION IF EXISTS public.smav_bump_outlet_catalog_revision();
--   DROP FUNCTION IF EXISTS public.smav_guard_outlet_config_update();
--   DROP FUNCTION IF EXISTS public.smav_autofill_organization_id();
--   DROP FUNCTION IF EXISTS public.smav_guard_tenant_row_update();
-- COMMIT;
