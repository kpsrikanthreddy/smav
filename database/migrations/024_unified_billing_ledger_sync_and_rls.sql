-- =============================================================================
-- Migration 024: Unified Billing Ledger Single Source of Truth, Soft-Delete /
-- Restore Tombstones, Monotonic Sync Revisions & Multi-Tenant Role-Based RLS
-- =============================================================================
-- Strictly additive & idempotent. Does NOT create duplicate billing tables,
-- drop existing data, or alter invoice numbers / GST / payment calculations.
-- Run manually in Central SMAV Supabase SQL Editor.
-- =============================================================================

BEGIN;

-- 1. Monotonic sequence for deterministic cross-platform delta & tombstone sync
CREATE SEQUENCE IF NOT EXISTS public.smav_ledger_sync_revision_seq START WITH 1000;

-- 2. Allow server-to-server ingestion of bills originated on external portals
--    (e.g., Glossy Looks Admin Portal) where no SMAV auth.users JWT exists.
ALTER TABLE public.smav_salon_bills
  ALTER COLUMN created_by DROP NOT NULL;

ALTER TABLE public.smav_central_sales
  ALTER COLUMN created_by DROP NOT NULL;

-- 3. Add unified soft-delete, restore, external reference & sync revision columns
ALTER TABLE public.smav_salon_bills
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid,
  ADD COLUMN IF NOT EXISTS deleted_by_name text,
  ADD COLUMN IF NOT EXISTS delete_reason text,
  ADD COLUMN IF NOT EXISTS restored_at timestamptz,
  ADD COLUMN IF NOT EXISTS restored_by uuid,
  ADD COLUMN IF NOT EXISTS restored_by_name text,
  ADD COLUMN IF NOT EXISTS restore_reason text,
  ADD COLUMN IF NOT EXISTS external_bill_id text,
  ADD COLUMN IF NOT EXISTS sync_revision bigint NOT NULL DEFAULT nextval('public.smav_ledger_sync_revision_seq');

ALTER TABLE public.smav_central_sales
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid,
  ADD COLUMN IF NOT EXISTS deleted_by_name text,
  ADD COLUMN IF NOT EXISTS delete_reason text,
  ADD COLUMN IF NOT EXISTS restored_at timestamptz,
  ADD COLUMN IF NOT EXISTS restored_by uuid,
  ADD COLUMN IF NOT EXISTS restored_by_name text,
  ADD COLUMN IF NOT EXISTS restore_reason text,
  ADD COLUMN IF NOT EXISTS external_bill_id text,
  ADD COLUMN IF NOT EXISTS sync_revision bigint NOT NULL DEFAULT nextval('public.smav_ledger_sync_revision_seq');

-- 4. Backfill deleted_* fields from existing Migration 018 voided_* columns
UPDATE public.smav_salon_bills
SET deleted_at = COALESCE(deleted_at, voided_at, updated_at, now()),
    deleted_by = COALESCE(deleted_by, voided_by),
    delete_reason = COALESCE(delete_reason, void_reason)
WHERE is_voided = true
  AND deleted_at IS NULL;

UPDATE public.smav_central_sales
SET deleted_at = COALESCE(deleted_at, voided_at, updated_at, now()),
    deleted_by = COALESCE(deleted_by, voided_by),
    delete_reason = COALESCE(delete_reason, void_reason)
WHERE is_voided = true
  AND deleted_at IS NULL;

-- 5. Keep is_voided <-> deleted_at strictly consistent and bump sync_revision on every mutation
CREATE OR REPLACE FUNCTION public.smav_sync_ledger_row_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.sync_revision := nextval('public.smav_ledger_sync_revision_seq');
  NEW.updated_at := now();

  IF COALESCE(NEW.is_voided, false) = true OR NEW.deleted_at IS NOT NULL THEN
    NEW.is_voided := true;
    NEW.deleted_at := COALESCE(NEW.deleted_at, NEW.voided_at, now());
    NEW.voided_at := COALESCE(NEW.voided_at, NEW.deleted_at);
    NEW.deleted_by := COALESCE(NEW.deleted_by, NEW.voided_by);
    NEW.voided_by := COALESCE(NEW.voided_by, NEW.deleted_by);
    NEW.delete_reason := COALESCE(NEW.delete_reason, NEW.void_reason);
    NEW.void_reason := COALESCE(NEW.void_reason, NEW.delete_reason);
  ELSE
    NEW.is_voided := false;
    NEW.deleted_at := NULL;
    NEW.voided_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_smav_salon_bills_sync_state ON public.smav_salon_bills;
CREATE TRIGGER trg_smav_salon_bills_sync_state
  BEFORE INSERT OR UPDATE ON public.smav_salon_bills
  FOR EACH ROW
  EXECUTE FUNCTION public.smav_sync_ledger_row_state();

DROP TRIGGER IF EXISTS trg_smav_central_sales_sync_state ON public.smav_central_sales;
CREATE TRIGGER trg_smav_central_sales_sync_state
  BEFORE INSERT OR UPDATE ON public.smav_central_sales
  FOR EACH ROW
  EXECUTE FUNCTION public.smav_sync_ledger_row_state();

-- 6. Supporting indexes for fast Today, Historical, Deleted, Branch & Delta Sync queries
CREATE INDEX IF NOT EXISTS idx_smav_salon_bills_outlet_rev
  ON public.smav_salon_bills (outlet_id, sync_revision DESC);

CREATE INDEX IF NOT EXISTS idx_smav_salon_bills_outlet_branch_created
  ON public.smav_salon_bills (outlet_id, branch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_smav_salon_bills_outlet_deleted
  ON public.smav_salon_bills (outlet_id, deleted_at DESC)
  WHERE is_voided = true;

CREATE UNIQUE INDEX IF NOT EXISTS uq_smav_salon_bills_outlet_external_id
  ON public.smav_salon_bills (outlet_id, external_bill_id)
  WHERE external_bill_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_smav_central_sales_outlet_rev
  ON public.smav_central_sales (outlet_id, sync_revision DESC);

CREATE INDEX IF NOT EXISTS idx_smav_central_sales_outlet_deleted
  ON public.smav_central_sales (outlet_id, deleted_at DESC)
  WHERE is_voided = true;

CREATE UNIQUE INDEX IF NOT EXISTS uq_smav_central_sales_outlet_external_id
  ON public.smav_central_sales (outlet_id, external_bill_id)
  WHERE external_bill_id IS NOT NULL;

-- 7. Widen outbound sale event types so edits, soft-deletes & restores propagate durably
ALTER TABLE public.smav_outbound_sale_events
  DROP CONSTRAINT IF EXISTS smav_outbound_sale_events_event_type_check;

ALTER TABLE public.smav_outbound_sale_events
  ADD CONSTRAINT smav_outbound_sale_events_event_type_check
  CHECK (event_type IN (
    'central_bill_finalized',
    'central_bill_updated',
    'central_bill_voided',
    'central_bill_restored'
  ));

-- 8. Multi-tenant RLS helper functions (Asia/Kolkata day boundaries & role mapping)
CREATE OR REPLACE FUNCTION public.smav_asia_kolkata_today_start()
RETURNS timestamptz
LANGUAGE sql
STABLE
AS $$
  SELECT (date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata');
$$;

CREATE OR REPLACE FUNCTION public.smav_user_is_superadmin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.smav_profiles p
    WHERE p.id = (SELECT auth.uid())
      AND UPPER(COALESCE(p.platform_role, '')) = 'SUPERADMIN'
      AND COALESCE(p.is_active, true) = true
  );
$$;

CREATE OR REPLACE FUNCTION public.smav_user_is_outlet_admin(p_outlet_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.smav_user_is_superadmin()
    OR EXISTS (
      SELECT 1
      FROM public.smav_user_outlet_roles r
      WHERE r.user_id = (SELECT auth.uid())
        AND r.outlet_id = p_outlet_id
        AND COALESCE(r.is_active, true) = true
        AND UPPER(COALESCE(r.role, '')) IN ('ADMIN', 'OWNER')
    );
$$;

CREATE OR REPLACE FUNCTION public.smav_user_is_outlet_member(p_outlet_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.smav_user_is_superadmin()
    OR EXISTS (
      SELECT 1
      FROM public.smav_user_outlet_roles r
      WHERE r.user_id = (SELECT auth.uid())
        AND r.outlet_id = p_outlet_id
        AND COALESCE(r.is_active, true) = true
    );
$$;

-- 9. Enforce Multi-Tenant, Role-Based & Today-vs-History RLS on smav_salon_bills
DROP POLICY IF EXISTS "smav_salon_bills_select_own" ON public.smav_salon_bills;
DROP POLICY IF EXISTS "smav_salon_bills_select_role_scoped" ON public.smav_salon_bills;
DROP POLICY IF EXISTS "smav_salon_bills_update_admin" ON public.smav_salon_bills;

CREATE POLICY "smav_salon_bills_select_role_scoped" ON public.smav_salon_bills
FOR SELECT TO authenticated
USING (
  -- SUPERADMIN & outlet ADMIN / OWNER: full active, historical & deleted access within authorized outlet
  public.smav_user_is_outlet_admin(outlet_id)
  OR (
    -- POS_BILLING / MANAGER / STAFF: today's active bills only (Asia/Kolkata) within assigned outlet
    public.smav_user_is_outlet_member(outlet_id)
    AND COALESCE(is_voided, false) = false
    AND deleted_at IS NULL
    AND created_at >= public.smav_asia_kolkata_today_start()
  )
);

-- Only SUPERADMIN & authorized outlet ADMIN / OWNER can edit, soft-delete, or restore
CREATE POLICY "smav_salon_bills_update_admin" ON public.smav_salon_bills
FOR UPDATE TO authenticated
USING (public.smav_user_is_outlet_admin(outlet_id))
WITH CHECK (public.smav_user_is_outlet_admin(outlet_id));

-- 10. Enforce identical Multi-Tenant, Role-Based & Today-vs-History RLS on smav_central_sales
DROP POLICY IF EXISTS smav_central_sales_read ON public.smav_central_sales;
DROP POLICY IF EXISTS smav_central_sales_select_role_scoped ON public.smav_central_sales;
DROP POLICY IF EXISTS smav_central_sales_update_admin ON public.smav_central_sales;

CREATE POLICY smav_central_sales_select_role_scoped ON public.smav_central_sales
FOR SELECT TO authenticated
USING (
  public.smav_user_is_outlet_admin(outlet_id)
  OR (
    public.smav_user_is_outlet_member(outlet_id)
    AND COALESCE(is_voided, false) = false
    AND deleted_at IS NULL
    AND billed_at >= public.smav_asia_kolkata_today_start()
  )
);

CREATE POLICY smav_central_sales_update_admin ON public.smav_central_sales
FOR UPDATE TO authenticated
USING (public.smav_user_is_outlet_admin(outlet_id))
WITH CHECK (public.smav_user_is_outlet_admin(outlet_id));

-- 11. Add billing tables to Supabase Realtime publication if not already registered
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'smav_salon_bills'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.smav_salon_bills;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'smav_central_sales'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.smav_central_sales;
    END IF;
  END IF;
END $$;

COMMIT;
