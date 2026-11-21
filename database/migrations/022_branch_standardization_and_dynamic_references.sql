-- =============================================================================
-- Migration 022: Safe Branch Standardization & Dynamic Branch References
-- =============================================================================
-- Safety-hardened, additive, idempotent migration.
--
-- SAFETY GUARANTEES:
--   1. EXPLICIT REVIEWED ALLOW-LIST ONLY:
--      Only the reviewed Central SMAV branch-reference tables & columns are
--      inspected, altered, or updated:
--        - public.smav_branches                (id, metadata cols)
--        - public.smav_bill_number_batches     (branch_id)
--        - public.smav_central_bill_numbers    (branch_id, branch_name)
--        - public.smav_salon_bills             (branch_id, branch_name)
--        - public.smav_central_sales           (branch_id, branch_name)
--        - public.smav_bill_number_counters    (branch_id)
--        - public.smav_outbound_sale_events    (branch_id, branch_name)
--        - public.smav_user_branch_assignments (branch_id)
--        - public.smav_user_outlet_roles       (assigned_branch_ids)
--      No broad database-wide branch_id UUID-to-text conversion is performed.
--      Unrelated tenant, outlet, restaurant, future-salon, printer/device,
--      catalog, notification, or third-party tables are NEVER altered.
--
--   2. FAIL-CLOSED FOREIGN KEY HANDLING:
--      - If any unreviewed FK outside the allow-list references
--        public.smav_branches, the migration aborts immediately with an error.
--      - Every existing FK on the allow-listed tables is captured verbatim via
--        pg_get_constraintdef(oid) before type conversion and recreated with
--        its exact original constraint name and real definition afterwards.
--
--   3. SINGLE GLOSSYLOOKS OUTLET SCOPING:
--      - Legacy standardization (tgl-gachibowli-main -> tgl-gachi,
--        brn-1793346038689 -> tgl-konda, tgl-kondapur-main -> tgl-konda,
--        plus duplicate Gachibowli/Kondapur rows) applies STRICTLY to the
--        single GlossyLooks outlet (lower(coalesce(outlet_code, code)) =
--        'glossylooks'). Asserts count <= 1.
--      - Future brands/outlets are never touched by any GlossyLooks mapping.
--
--   4. ZERO AUTOMATIC DELETION & IMMUTABLE BILL NUMBERS:
--      - Old/duplicate branch rows in public.smav_branches are NEVER deleted
--        by Migration 022. They are marked is_active = false (with parked
--        uppercase branch_code so active canonical codes never collide) and
--        recorded in public.smav_branch_migration_audit for a separate future
--        manual cleanup action.
--      - Already finalized bill_number and central_bill_number values are NEVER
--        changed, regenerated, or renumbered.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. Branch Migration Audit Table (records all deactivated legacy branches)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.smav_branch_migration_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id uuid REFERENCES public.smav_outlets(id) ON DELETE SET NULL,
  old_branch_id text NOT NULL,
  old_branch_code text,
  old_branch_name text,
  new_branch_id text,
  new_branch_code text,
  action text NOT NULL,
  reference_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  migrated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.smav_branch_migration_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS smav_branch_migration_audit_service_all ON public.smav_branch_migration_audit;
CREATE POLICY smav_branch_migration_audit_service_all
  ON public.smav_branch_migration_audit FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =============================================================================
-- 2. Fail-Closed FK Check & Verbatim Capture on Reviewed Allow-List ONLY
-- =============================================================================
-- FK definitions are recorded in the durable migration audit table rather than
-- a temporary/helper table. This avoids SQL Editor statement/session ordering
-- issues while retaining the exact original definition for recreation.
DELETE FROM public.smav_branch_migration_audit
WHERE action = 'migration_022_saved_fk_capture';

DO $$
DECLARE
  v_allowed_fk_tables CONSTANT text[] := ARRAY[
    'smav_bill_number_batches',
    'smav_central_bill_numbers',
    'smav_salon_bills',
    'smav_central_sales',
    'smav_bill_number_counters',
    'smav_outbound_sale_events',
    'smav_user_branch_assignments'
  ];
  v_unreviewed text;
  v_fk RECORD;
BEGIN
  IF to_regclass('public.smav_branches') IS NULL THEN
    RAISE EXCEPTION 'MISSING_PREREQUISITE: public.smav_branches does not exist. Run Migration 019 first.';
  END IF;

  -- Fail closed if any table outside the explicit reviewed allow-list has an FK referencing public.smav_branches
  SELECT string_agg(
           quote_ident(ns.nspname) || '.' || quote_ident(rel.relname) || ' (' || con.conname || ')',
           ', '
         )
  INTO v_unreviewed
  FROM pg_constraint AS con
  JOIN pg_class AS rel ON rel.oid = con.conrelid
  JOIN pg_namespace AS ns ON ns.oid = rel.relnamespace
  WHERE con.contype = 'f'
    AND con.confrelid = 'public.smav_branches'::regclass
    AND NOT (ns.nspname = 'public' AND rel.relname = ANY(v_allowed_fk_tables));

  IF v_unreviewed IS NOT NULL THEN
    RAISE EXCEPTION 'UNREVIEWED_BRANCH_FK: Found foreign keys referencing public.smav_branches outside the reviewed allow-list: %. Aborting safely without altering schema.', v_unreviewed;
  END IF;

  -- Capture ONLY the existing FKs on the reviewed allow-listed tables with their exact real definitions
  FOR v_fk IN
    SELECT
      rel.relname AS table_name,
      con.conname AS constraint_name,
      pg_get_constraintdef(con.oid) AS constraint_def
    FROM pg_constraint AS con
    JOIN pg_class AS rel ON rel.oid = con.conrelid
    JOIN pg_namespace AS ns ON ns.oid = rel.relnamespace
    WHERE con.contype = 'f'
      AND con.confrelid = 'public.smav_branches'::regclass
      AND ns.nspname = 'public'
      AND rel.relname = ANY(v_allowed_fk_tables)
  LOOP
    INSERT INTO public.smav_branch_migration_audit (
      old_branch_id,
      action,
      reference_counts,
      notes
    )
    VALUES (
      v_fk.table_name || ':' || v_fk.constraint_name,
      'migration_022_saved_fk_capture',
      jsonb_build_object(
        'table_name', v_fk.table_name,
        'constraint_name', v_fk.constraint_name
      ),
      v_fk.constraint_def
    );

    EXECUTE format(
      'ALTER TABLE public.%I DROP CONSTRAINT %I',
      v_fk.table_name,
      v_fk.constraint_name
    );
  END LOOP;
END;
$$;

-- =============================================================================
-- 3. Explicit Allow-List Column Type Migration (uuid -> text) & Additive Columns
-- =============================================================================
-- 3A. public.smav_branches.id (uuid -> text) + canonical metadata columns
DO $$
DECLARE
  v_id_type text;
BEGIN
  SELECT data_type
  INTO v_id_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'smav_branches'
    AND column_name = 'id';

  IF v_id_type = 'uuid' THEN
    ALTER TABLE public.smav_branches ALTER COLUMN id DROP DEFAULT;
    ALTER TABLE public.smav_branches ALTER COLUMN id TYPE text USING id::text;
  END IF;
END;
$$;

ALTER TABLE public.smav_branches
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS gstin text,
  ADD COLUMN IF NOT EXISTS whatsapp_phone text,
  ADD COLUMN IF NOT EXISTS printer_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS legacy_branch_ids text[] NOT NULL DEFAULT '{}'::text[];

-- 3B. Explicit allow-list conversion of the 4 known uuid branch_id columns ONLY
DO $$
DECLARE
  v_col_type text;
BEGIN
  -- 1) public.smav_bill_number_batches.branch_id
  IF to_regclass('public.smav_bill_number_batches') IS NOT NULL THEN
    SELECT data_type INTO v_col_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'smav_bill_number_batches' AND column_name = 'branch_id';
    IF v_col_type = 'uuid' THEN
      ALTER TABLE public.smav_bill_number_batches ALTER COLUMN branch_id TYPE text USING branch_id::text;
    END IF;
  END IF;

  -- 2) public.smav_central_bill_numbers.branch_id
  IF to_regclass('public.smav_central_bill_numbers') IS NOT NULL THEN
    SELECT data_type INTO v_col_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'smav_central_bill_numbers' AND column_name = 'branch_id';
    IF v_col_type = 'uuid' THEN
      ALTER TABLE public.smav_central_bill_numbers ALTER COLUMN branch_id TYPE text USING branch_id::text;
    END IF;
  END IF;

  -- 3) public.smav_salon_bills.branch_id
  IF to_regclass('public.smav_salon_bills') IS NOT NULL THEN
    SELECT data_type INTO v_col_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'smav_salon_bills' AND column_name = 'branch_id';
    IF v_col_type = 'uuid' THEN
      ALTER TABLE public.smav_salon_bills ALTER COLUMN branch_id TYPE text USING branch_id::text;
    END IF;
  END IF;

  -- 4) public.smav_central_sales.branch_id
  IF to_regclass('public.smav_central_sales') IS NOT NULL THEN
    SELECT data_type INTO v_col_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'smav_central_sales' AND column_name = 'branch_id';
    IF v_col_type = 'uuid' THEN
      ALTER TABLE public.smav_central_sales ALTER COLUMN branch_id TYPE text USING branch_id::text;
    END IF;
  END IF;
END;
$$;

-- 3C. Additive text branch_id columns ONLY on reviewed central SMAV tables
DO $$
BEGIN
  -- 5) public.smav_bill_number_counters.branch_id
  IF to_regclass('public.smav_bill_number_counters') IS NOT NULL THEN
    ALTER TABLE public.smav_bill_number_counters
      ADD COLUMN IF NOT EXISTS branch_id text;
  END IF;

  -- 6) public.smav_outbound_sale_events.branch_id
  IF to_regclass('public.smav_outbound_sale_events') IS NOT NULL THEN
    ALTER TABLE public.smav_outbound_sale_events
      ADD COLUMN IF NOT EXISTS branch_id text;
  END IF;

  -- 7) public.smav_user_outlet_roles.assigned_branch_ids (canonical text[] alongside assigned_branch_codes)
  IF to_regclass('public.smav_user_outlet_roles') IS NOT NULL THEN
    ALTER TABLE public.smav_user_outlet_roles
      ADD COLUMN IF NOT EXISTS assigned_branch_ids text[] NOT NULL DEFAULT '{}'::text[];
  END IF;
END;
$$;

-- 3D. 8) Explicit user-to-branch assignment join table (dynamic, zero hardcoding)
CREATE TABLE IF NOT EXISTS public.smav_user_branch_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.smav_profiles(id) ON DELETE CASCADE,
  outlet_id uuid NOT NULL REFERENCES public.smav_outlets(id) ON DELETE CASCADE,
  branch_id text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_smav_user_branch_assignment UNIQUE (user_id, outlet_id, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_smav_user_branch_assignments_lookup
  ON public.smav_user_branch_assignments (user_id, outlet_id, is_active);

ALTER TABLE public.smav_user_branch_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS smav_user_branch_assignments_self_read ON public.smav_user_branch_assignments;
CREATE POLICY smav_user_branch_assignments_self_read
  ON public.smav_user_branch_assignments FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS smav_user_branch_assignments_service_all ON public.smav_user_branch_assignments;
CREATE POLICY smav_user_branch_assignments_service_all
  ON public.smav_user_branch_assignments FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =============================================================================
-- 4. One-Time GlossyLooks Standardization (STRICTLY Single GlossyLooks Outlet)
--    - Canonical active branches:
--        1) id: 'tgl-gachi', branch_name: 'Gachibowli', branch_code: 'GACHI', is_active: true
--        2) id: 'tgl-konda', branch_name: 'Kondapur',   branch_code: 'KONDA', is_active: true
--    - Legacy remaps (ONLY for the selected GlossyLooks outlet):
--        tgl-gachibowli-main -> tgl-gachi
--        brn-1793346038689   -> tgl-konda
--        tgl-kondapur-main   -> tgl-konda
--        + any duplicate Gachibowli / Kondapur rows for that same outlet
--    - NEVER alters other outlets/brands.
--    - NEVER modifies bill_number or central_bill_number.
--    - NEVER deletes legacy rows from public.smav_branches; marks them
--      is_active = false and logs them in public.smav_branch_migration_audit.
-- =============================================================================
DO $$
DECLARE
  v_glossy_count integer := 0;
  v_glossy_outlet_id uuid;
  v_branch RECORD;
  v_remap RECORD;
  v_target_id text;
  v_target_code text;
  v_target_name text;
  v_parked_code text;
  v_legacy_ids_gachi text[] := ARRAY['tgl-gachibowli-main'];
  v_legacy_ids_konda text[] := ARRAY['brn-1793346038689', 'tgl-kondapur-main'];
  v_gachi_meta jsonb := '{}'::jsonb;
  v_konda_meta jsonb := '{}'::jsonb;
  v_gachi_addr text := NULL;
  v_konda_addr text := NULL;
  v_gachi_gstin text := NULL;
  v_konda_gstin text := NULL;
  v_gachi_wa text := NULL;
  v_konda_wa text := NULL;
  v_gachi_printer jsonb := '{}'::jsonb;
  v_konda_printer jsonb := '{}'::jsonb;
  v_remaining_refs bigint;
  v_ref_counts jsonb;
  v_cnt bigint;
BEGIN
  -- Assert at most one GlossyLooks outlet matches
  SELECT count(*), min(o.id::text)::uuid
  INTO v_glossy_count, v_glossy_outlet_id
  FROM public.smav_outlets AS o
  WHERE lower(btrim(coalesce(o.outlet_code, o.code, ''))) = 'glossylooks';

  IF v_glossy_count > 1 THEN
    RAISE EXCEPTION 'AMBIGUOUS_GLOSSYLOOKS_OUTLET: Expected at most 1 GlossyLooks outlet (code=glossylooks), found %. Aborting safely.', v_glossy_count;
  END IF;

  IF v_glossy_count = 0 OR v_glossy_outlet_id IS NULL THEN
    RAISE NOTICE '[Migration 022] No outlet with code=glossylooks found; skipping GlossyLooks branch data standardization.';
    RETURN;
  END IF;

  -- See the note above: use a short-lived regular table so this migration
  -- remains reliable in the Supabase SQL Editor.
  CREATE TABLE IF NOT EXISTS public.smav_branch_migration_remap (
    outlet_id uuid NOT NULL,
    old_branch_id text NOT NULL,
    old_branch_code text,
    old_branch_name text,
    new_branch_id text NOT NULL,
    new_branch_code text NOT NULL,
    new_branch_name text NOT NULL,
    is_db_row boolean NOT NULL DEFAULT false,
    PRIMARY KEY (outlet_id, old_branch_id)
  );

  TRUNCATE TABLE public.smav_branch_migration_remap;

  -- Seed explicit known GlossyLooks legacy IDs for this single outlet ONLY
  INSERT INTO public.smav_branch_migration_remap (
    outlet_id, old_branch_id, old_branch_code, old_branch_name,
    new_branch_id, new_branch_code, new_branch_name, is_db_row
  )
  VALUES
    (v_glossy_outlet_id, 'tgl-gachibowli-main', 'GACHI', 'Gachibowli', 'tgl-gachi', 'GACHI', 'Gachibowli', false),
    (v_glossy_outlet_id, 'brn-1793346038689',   'KONDA', 'Kondapur',   'tgl-konda', 'KONDA', 'Kondapur',   false),
    (v_glossy_outlet_id, 'tgl-kondapur-main',   'KONDA', 'Kondapur',   'tgl-konda', 'KONDA', 'Kondapur',   false)
  ON CONFLICT (outlet_id, old_branch_id) DO NOTHING;

  -- Inspect existing rows in public.smav_branches strictly for v_glossy_outlet_id
  FOR v_branch IN
    SELECT b.*
    FROM public.smav_branches AS b
    WHERE b.outlet_id = v_glossy_outlet_id
  LOOP
    v_target_id := NULL;
    v_target_code := NULL;
    v_target_name := NULL;

    IF lower(btrim(v_branch.id)) IN ('tgl-gachi', 'tgl-gachibowli-main')
       OR lower(btrim(coalesce(v_branch.external_branch_id, ''))) = 'tgl-gachibowli-main'
       OR upper(btrim(coalesce(v_branch.branch_code, ''))) IN ('GACHI', 'GACH', 'GACHIBOWLI', 'GCB-01')
       OR lower(coalesce(v_branch.branch_name, '')) LIKE '%gachibowli%'
    THEN
      v_target_id := 'tgl-gachi';
      v_target_code := 'GACHI';
      v_target_name := 'Gachibowli';
      v_gachi_meta := v_gachi_meta || coalesce(v_branch.metadata, '{}'::jsonb);
      v_gachi_addr := COALESCE(NULLIF(btrim(v_branch.address), ''), v_gachi_addr);
      v_gachi_gstin := COALESCE(NULLIF(btrim(v_branch.gstin), ''), v_gachi_gstin);
      v_gachi_wa := COALESCE(NULLIF(btrim(v_branch.whatsapp_phone), ''), v_gachi_wa);
      v_gachi_printer := v_gachi_printer || coalesce(v_branch.printer_config, '{}'::jsonb);
      IF v_branch.id <> 'tgl-gachi' THEN
        v_legacy_ids_gachi := array_append(v_legacy_ids_gachi, v_branch.id);
      END IF;
      IF v_branch.external_branch_id IS NOT NULL AND btrim(v_branch.external_branch_id) <> '' THEN
        v_legacy_ids_gachi := array_append(v_legacy_ids_gachi, btrim(v_branch.external_branch_id));
      END IF;

    ELSIF lower(btrim(v_branch.id)) IN ('tgl-konda', 'brn-1793346038689', 'tgl-kondapur-main')
       OR lower(btrim(coalesce(v_branch.external_branch_id, ''))) IN ('brn-1793346038689', 'tgl-kondapur-main')
       OR upper(btrim(coalesce(v_branch.branch_code, ''))) IN ('KONDA', 'KNDP', 'KONDAPUR', 'KND-02')
       OR lower(coalesce(v_branch.branch_name, '')) LIKE '%kondapur%'
    THEN
      v_target_id := 'tgl-konda';
      v_target_code := 'KONDA';
      v_target_name := 'Kondapur';
      v_konda_meta := v_konda_meta || coalesce(v_branch.metadata, '{}'::jsonb);
      v_konda_addr := COALESCE(NULLIF(btrim(v_branch.address), ''), v_konda_addr);
      v_konda_gstin := COALESCE(NULLIF(btrim(v_branch.gstin), ''), v_konda_gstin);
      v_konda_wa := COALESCE(NULLIF(btrim(v_branch.whatsapp_phone), ''), v_konda_wa);
      v_konda_printer := v_konda_printer || coalesce(v_branch.printer_config, '{}'::jsonb);
      IF v_branch.id <> 'tgl-konda' THEN
        v_legacy_ids_konda := array_append(v_legacy_ids_konda, v_branch.id);
      END IF;
      IF v_branch.external_branch_id IS NOT NULL AND btrim(v_branch.external_branch_id) <> '' THEN
        v_legacy_ids_konda := array_append(v_legacy_ids_konda, btrim(v_branch.external_branch_id));
      END IF;

    ELSE
      -- Non-legacy / future branch on GlossyLooks outlet: preserve untouched (never auto-delete or deactivate)
      IF NOT (v_branch.is_active = false AND v_branch.branch_code LIKE 'LEGACY_%') THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.smav_branch_migration_audit a
          WHERE a.outlet_id = v_glossy_outlet_id
            AND a.old_branch_id = v_branch.id
            AND a.action = 'observed_non_legacy_retained'
        ) THEN
          INSERT INTO public.smav_branch_migration_audit (
            outlet_id, old_branch_id, old_branch_code, old_branch_name,
            new_branch_id, new_branch_code, action, notes
          )
          VALUES (
            v_glossy_outlet_id, v_branch.id, v_branch.branch_code, v_branch.branch_name,
            NULL, NULL, 'observed_non_legacy_retained',
            'Row is not a legacy Gachibowli/Kondapur duplicate; retained untouched.'
          );
        END IF;
      END IF;
    END IF;

    IF v_target_id IS NOT NULL AND v_branch.id <> v_target_id THEN
      INSERT INTO public.smav_branch_migration_remap (
        outlet_id, old_branch_id, old_branch_code, old_branch_name,
        new_branch_id, new_branch_code, new_branch_name, is_db_row
      )
      VALUES (
        v_glossy_outlet_id,
        v_branch.id,
        COALESCE(v_branch.metadata->>'legacy_original_branch_code', v_branch.branch_code),
        v_branch.branch_name,
        v_target_id,
        v_target_code,
        v_target_name,
        true
      )
      ON CONFLICT (outlet_id, old_branch_id) DO UPDATE
        SET old_branch_code = EXCLUDED.old_branch_code,
            old_branch_name = EXCLUDED.old_branch_name,
            is_db_row = true;

      -- Park legacy/duplicate row as inactive with deterministic uppercase code so
      -- uq_smav_branches_outlet_code and chk_smav_branches_code_upper remain satisfied
      -- while canonical rows claim GACHI / KONDA (NO DELETE).
      v_parked_code := upper(
        'LEGACY_' ||
        left(regexp_replace(v_branch.id, '[^A-Za-z0-9]', '', 'g'), 16) ||
        '_' ||
        substr(md5(v_branch.id), 1, 6)
      );

      UPDATE public.smav_branches
      SET branch_code = CASE
            WHEN branch_code LIKE 'LEGACY_%' THEN branch_code
            ELSE v_parked_code
          END,
          is_active = false,
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
            'legacy_original_branch_code', COALESCE(metadata->>'legacy_original_branch_code', branch_code),
            'standardized_to_branch_id', v_target_id,
            'deactivated_by_migration', '022'
          ),
          updated_at = now()
      WHERE id = v_branch.id
        AND outlet_id = v_glossy_outlet_id;
    END IF;
  END LOOP;

  -- Deduplicate collected legacy IDs
  SELECT COALESCE(array_agg(DISTINCT x), '{}'::text[])
  INTO v_legacy_ids_gachi
  FROM unnest(v_legacy_ids_gachi) AS x
  WHERE btrim(coalesce(x, '')) <> '' AND x <> 'tgl-gachi';

  SELECT COALESCE(array_agg(DISTINCT x), '{}'::text[])
  INTO v_legacy_ids_konda
  FROM unnest(v_legacy_ids_konda) AS x
  WHERE btrim(coalesce(x, '')) <> '' AND x <> 'tgl-konda';

  -- Upsert canonical branch 1: tgl-gachi (Gachibowli / GACHI)
  INSERT INTO public.smav_branches (
    id, outlet_id, branch_code, branch_name, external_branch_id, bill_prefix,
    is_active, address, gstin, whatsapp_phone, printer_config, legacy_branch_ids, metadata
  )
  VALUES (
    'tgl-gachi',
    v_glossy_outlet_id,
    'GACHI',
    'Gachibowli',
    'tgl-gachi',
    'TGL',
    true,
    v_gachi_addr,
    v_gachi_gstin,
    COALESCE(v_gachi_wa, '9966970003'),
    v_gachi_printer,
    v_legacy_ids_gachi,
    (v_gachi_meta - 'legacy_original_branch_code' - 'standardized_to_branch_id' - 'deactivated_by_migration')
      || jsonb_build_object(
        'timezone', 'Asia/Kolkata',
        'whatsapp_line', '9966970003 (G)  9154744608 (K)',
        'canonical_branch_id', 'tgl-gachi'
      )
  )
  ON CONFLICT (id) DO UPDATE
    SET outlet_id = EXCLUDED.outlet_id,
        branch_code = 'GACHI',
        branch_name = 'Gachibowli',
        external_branch_id = 'tgl-gachi',
        bill_prefix = 'TGL',
        is_active = true,
        address = COALESCE(EXCLUDED.address, public.smav_branches.address),
        gstin = COALESCE(EXCLUDED.gstin, public.smav_branches.gstin),
        whatsapp_phone = COALESCE(EXCLUDED.whatsapp_phone, public.smav_branches.whatsapp_phone),
        printer_config = coalesce(public.smav_branches.printer_config, '{}'::jsonb) || EXCLUDED.printer_config,
        legacy_branch_ids = (
          SELECT COALESCE(array_agg(DISTINCT x), '{}'::text[])
          FROM unnest(coalesce(public.smav_branches.legacy_branch_ids, '{}'::text[]) || EXCLUDED.legacy_branch_ids) AS x
          WHERE btrim(coalesce(x, '')) <> '' AND x <> 'tgl-gachi'
        ),
        metadata = coalesce(public.smav_branches.metadata, '{}'::jsonb) || EXCLUDED.metadata,
        updated_at = now();

  -- Upsert canonical branch 2: tgl-konda (Kondapur / KONDA)
  INSERT INTO public.smav_branches (
    id, outlet_id, branch_code, branch_name, external_branch_id, bill_prefix,
    is_active, address, gstin, whatsapp_phone, printer_config, legacy_branch_ids, metadata
  )
  VALUES (
    'tgl-konda',
    v_glossy_outlet_id,
    'KONDA',
    'Kondapur',
    'tgl-konda',
    'TGL',
    true,
    v_konda_addr,
    v_konda_gstin,
    COALESCE(v_konda_wa, '9154744608'),
    v_konda_printer,
    v_legacy_ids_konda,
    (v_konda_meta - 'legacy_original_branch_code' - 'standardized_to_branch_id' - 'deactivated_by_migration')
      || jsonb_build_object(
        'timezone', 'Asia/Kolkata',
        'whatsapp_line', '9966970003 (G)  9154744608 (K)',
        'canonical_branch_id', 'tgl-konda'
      )
  )
  ON CONFLICT (id) DO UPDATE
    SET outlet_id = EXCLUDED.outlet_id,
        branch_code = 'KONDA',
        branch_name = 'Kondapur',
        external_branch_id = 'tgl-konda',
        bill_prefix = 'TGL',
        is_active = true,
        address = COALESCE(EXCLUDED.address, public.smav_branches.address),
        gstin = COALESCE(EXCLUDED.gstin, public.smav_branches.gstin),
        whatsapp_phone = COALESCE(EXCLUDED.whatsapp_phone, public.smav_branches.whatsapp_phone),
        printer_config = coalesce(public.smav_branches.printer_config, '{}'::jsonb) || EXCLUDED.printer_config,
        legacy_branch_ids = (
          SELECT COALESCE(array_agg(DISTINCT x), '{}'::text[])
          FROM unnest(coalesce(public.smav_branches.legacy_branch_ids, '{}'::text[]) || EXCLUDED.legacy_branch_ids) AS x
          WHERE btrim(coalesce(x, '')) <> '' AND x <> 'tgl-konda'
        ),
        metadata = coalesce(public.smav_branches.metadata, '{}'::jsonb) || EXCLUDED.metadata,
        updated_at = now();

  -- ---------------------------------------------------------------------------
  -- 4A. Migrate references ONLY on the reviewed allow-listed tables for
  --     v_glossy_outlet_id ONLY. NEVER alter bill_number or central_bill_number.
  -- ---------------------------------------------------------------------------

  -- 1. public.smav_central_bill_numbers
  IF to_regclass('public.smav_central_bill_numbers') IS NOT NULL THEN
    UPDATE public.smav_central_bill_numbers AS c
    SET branch_id = m.new_branch_id,
        branch_name = m.new_branch_name
    FROM public.smav_branch_migration_remap AS m
    WHERE c.outlet_id = v_glossy_outlet_id
      AND m.outlet_id = v_glossy_outlet_id
      AND c.branch_id = m.old_branch_id;

    UPDATE public.smav_central_bill_numbers AS c
    SET branch_id = b.id,
        branch_name = COALESCE(NULLIF(btrim(c.branch_name), ''), b.branch_name)
    FROM public.smav_branches AS b
    WHERE c.outlet_id = v_glossy_outlet_id
      AND b.outlet_id = v_glossy_outlet_id
      AND b.is_active = true
      AND upper(btrim(c.branch_code)) = upper(btrim(b.branch_code))
      AND (c.branch_id IS NULL OR c.branch_id <> b.id);
  END IF;

  -- 2. public.smav_salon_bills (NEVER modifies bill_number or central_bill_number)
  IF to_regclass('public.smav_salon_bills') IS NOT NULL THEN
    UPDATE public.smav_salon_bills AS sb
    SET branch_id = m.new_branch_id,
        branch_name = m.new_branch_name
    FROM public.smav_branch_migration_remap AS m
    WHERE sb.outlet_id = v_glossy_outlet_id
      AND m.outlet_id = v_glossy_outlet_id
      AND sb.branch_id = m.old_branch_id;

    UPDATE public.smav_salon_bills AS sb
    SET branch_id = b.id,
        branch_name = COALESCE(NULLIF(btrim(sb.branch_name), ''), b.branch_name)
    FROM public.smav_branches AS b
    WHERE sb.outlet_id = v_glossy_outlet_id
      AND b.outlet_id = v_glossy_outlet_id
      AND b.is_active = true
      AND sb.branch_code IS NOT NULL
      AND upper(btrim(sb.branch_code)) = upper(btrim(b.branch_code))
      AND (sb.branch_id IS NULL OR sb.branch_id <> b.id);
  END IF;

  -- 3. public.smav_central_sales (NEVER modifies bill_number or central_bill_number)
  IF to_regclass('public.smav_central_sales') IS NOT NULL THEN
    UPDATE public.smav_central_sales AS cs
    SET branch_id = m.new_branch_id,
        branch_name = m.new_branch_name
    FROM public.smav_branch_migration_remap AS m
    WHERE cs.outlet_id = v_glossy_outlet_id
      AND m.outlet_id = v_glossy_outlet_id
      AND cs.branch_id = m.old_branch_id;

    UPDATE public.smav_central_sales AS cs
    SET branch_id = b.id,
        branch_name = COALESCE(NULLIF(btrim(cs.branch_name), ''), b.branch_name)
    FROM public.smav_branches AS b
    WHERE cs.outlet_id = v_glossy_outlet_id
      AND b.outlet_id = v_glossy_outlet_id
      AND b.is_active = true
      AND cs.branch_code IS NOT NULL
      AND upper(btrim(cs.branch_code)) = upper(btrim(b.branch_code))
      AND (cs.branch_id IS NULL OR cs.branch_id <> b.id);
  END IF;

  -- 4. public.smav_bill_number_batches
  IF to_regclass('public.smav_bill_number_batches') IS NOT NULL THEN
    UPDATE public.smav_bill_number_batches AS bb
    SET branch_id = m.new_branch_id,
        branch_name = m.new_branch_name
    FROM public.smav_branch_migration_remap AS m
    WHERE bb.outlet_id = v_glossy_outlet_id
      AND m.outlet_id = v_glossy_outlet_id
      AND bb.branch_id = m.old_branch_id;

    UPDATE public.smav_bill_number_batches AS bb
    SET branch_id = b.id,
        branch_name = COALESCE(NULLIF(btrim(bb.branch_name), ''), b.branch_name)
    FROM public.smav_branches AS b
    WHERE bb.outlet_id = v_glossy_outlet_id
      AND b.outlet_id = v_glossy_outlet_id
      AND b.is_active = true
      AND upper(btrim(bb.branch_code)) = upper(btrim(b.branch_code))
      AND (bb.branch_id IS NULL OR bb.branch_id <> b.id);
  END IF;

  -- 5. public.smav_bill_number_counters
  IF to_regclass('public.smav_bill_number_counters') IS NOT NULL THEN
    UPDATE public.smav_bill_number_counters AS cnt
    SET branch_id = m.new_branch_id
    FROM public.smav_branch_migration_remap AS m
    WHERE cnt.outlet_id = v_glossy_outlet_id
      AND m.outlet_id = v_glossy_outlet_id
      AND cnt.branch_id = m.old_branch_id;

    UPDATE public.smav_bill_number_counters AS cnt
    SET branch_id = b.id
    FROM public.smav_branches AS b
    WHERE cnt.outlet_id = v_glossy_outlet_id
      AND b.outlet_id = v_glossy_outlet_id
      AND b.is_active = true
      AND upper(btrim(cnt.branch_code)) = upper(btrim(b.branch_code))
      AND (cnt.branch_id IS NULL OR cnt.branch_id <> b.id);
  END IF;

  -- 6. public.smav_outbound_sale_events
  IF to_regclass('public.smav_outbound_sale_events') IS NOT NULL THEN
    UPDATE public.smav_outbound_sale_events AS ev
    SET branch_id = m.new_branch_id,
        branch_name = m.new_branch_name
    FROM public.smav_branch_migration_remap AS m
    WHERE ev.outlet_id = v_glossy_outlet_id
      AND m.outlet_id = v_glossy_outlet_id
      AND ev.branch_id = m.old_branch_id;

    UPDATE public.smav_outbound_sale_events AS ev
    SET branch_id = b.id,
        branch_name = COALESCE(NULLIF(btrim(ev.branch_name), ''), b.branch_name)
    FROM public.smav_branches AS b
    WHERE ev.outlet_id = v_glossy_outlet_id
      AND b.outlet_id = v_glossy_outlet_id
      AND b.is_active = true
      AND ev.branch_code IS NOT NULL
      AND upper(btrim(ev.branch_code)) = upper(btrim(b.branch_code))
      AND (ev.branch_id IS NULL OR ev.branch_id <> b.id);
  END IF;

  -- 7. public.smav_user_branch_assignments (remapping + backfill from smav_user_outlet_roles)
  IF to_regclass('public.smav_user_branch_assignments') IS NOT NULL THEN
    INSERT INTO public.smav_user_branch_assignments (user_id, outlet_id, branch_id, is_default, is_active)
    SELECT uba.user_id, uba.outlet_id, m.new_branch_id, uba.is_default, uba.is_active
    FROM public.smav_user_branch_assignments AS uba
    JOIN public.smav_branch_migration_remap AS m
      ON m.outlet_id = uba.outlet_id AND m.old_branch_id = uba.branch_id
    WHERE uba.outlet_id = v_glossy_outlet_id
    ON CONFLICT (user_id, outlet_id, branch_id) DO UPDATE
      SET is_active = EXCLUDED.is_active OR public.smav_user_branch_assignments.is_active,
          updated_at = now();

    DELETE FROM public.smav_user_branch_assignments AS uba
    USING public.smav_branch_migration_remap AS m
    WHERE uba.outlet_id = v_glossy_outlet_id
      AND m.outlet_id = v_glossy_outlet_id
      AND uba.branch_id = m.old_branch_id
      AND m.old_branch_id <> m.new_branch_id;
  END IF;

  -- 8. public.smav_user_outlet_roles (normalize assigned_branch_codes & assigned_branch_ids strictly for v_glossy_outlet_id)
  IF to_regclass('public.smav_user_outlet_roles') IS NOT NULL THEN
    UPDATE public.smav_user_outlet_roles AS uor
    SET assigned_branch_codes = COALESCE((
          SELECT array_agg(DISTINCT mapped_code ORDER BY mapped_code)
          FROM (
            SELECT CASE
              WHEN upper(btrim(raw_code)) IN ('GACHI', 'GACH', 'GACHIBOWLI', 'GCB-01') THEN 'GACHI'
              WHEN upper(btrim(raw_code)) IN ('KONDA', 'KNDP', 'KONDAPUR', 'KND-02') THEN 'KONDA'
              ELSE upper(btrim(raw_code))
            END AS mapped_code
            FROM unnest(coalesce(uor.assigned_branch_codes, '{}'::text[])) AS raw_code
            WHERE btrim(coalesce(raw_code, '')) <> ''
          ) AS s
        ), '{}'::text[]),
        assigned_branch_ids = COALESCE((
          SELECT array_agg(DISTINCT mapped_id ORDER BY mapped_id)
          FROM (
            SELECT COALESCE(m.new_branch_id, b.id, raw_id) AS mapped_id
            FROM unnest(
              coalesce(uor.assigned_branch_ids, '{}'::text[]) ||
              COALESCE((
                SELECT array_agg(b2.id)
                FROM unnest(coalesce(uor.assigned_branch_codes, '{}'::text[])) AS c2
                JOIN public.smav_branches AS b2
                  ON b2.outlet_id = uor.outlet_id
                 AND b2.is_active = true
                 AND upper(btrim(b2.branch_code)) = CASE
                       WHEN upper(btrim(c2)) IN ('GACHI', 'GACH', 'GACHIBOWLI', 'GCB-01') THEN 'GACHI'
                       WHEN upper(btrim(c2)) IN ('KONDA', 'KNDP', 'KONDAPUR', 'KND-02') THEN 'KONDA'
                       ELSE upper(btrim(c2))
                     END
              ), '{}'::text[])
            ) AS raw_id
            LEFT JOIN public.smav_branch_migration_remap AS m
              ON m.outlet_id = uor.outlet_id AND m.old_branch_id = raw_id
            LEFT JOIN public.smav_branches AS b
              ON b.outlet_id = uor.outlet_id AND b.is_active = true AND b.id = raw_id
            WHERE btrim(coalesce(raw_id, '')) <> ''
          ) AS ids
        ), '{}'::text[])
    WHERE uor.outlet_id = v_glossy_outlet_id
      AND (
        coalesce(array_length(uor.assigned_branch_codes, 1), 0) > 0
        OR coalesce(array_length(uor.assigned_branch_ids, 1), 0) > 0
      );

    -- Populate smav_user_branch_assignments from normalized assigned_branch_ids for v_glossy_outlet_id
    INSERT INTO public.smav_user_branch_assignments (user_id, outlet_id, branch_id, is_active)
    SELECT uor.user_id, uor.outlet_id, bid, true
    FROM public.smav_user_outlet_roles AS uor
    CROSS JOIN LATERAL unnest(coalesce(uor.assigned_branch_ids, '{}'::text[])) AS bid
    JOIN public.smav_branches AS b
      ON b.id = bid AND b.outlet_id = uor.outlet_id AND b.is_active = true
    WHERE uor.outlet_id = v_glossy_outlet_id
    ON CONFLICT (user_id, outlet_id, branch_id) DO NOTHING;
  END IF;

  -- ---------------------------------------------------------------------------
  -- 4B. Audit every deactivated legacy/duplicate branch row (NEVER DELETE)
  -- ---------------------------------------------------------------------------
  FOR v_remap IN
    SELECT *
    FROM public.smav_branch_migration_remap AS m
    WHERE m.outlet_id = v_glossy_outlet_id
      AND m.is_db_row = true
      AND m.old_branch_id <> m.new_branch_id
  LOOP
    v_remaining_refs := 0;
    v_ref_counts := '{}'::jsonb;

    IF to_regclass('public.smav_central_bill_numbers') IS NOT NULL THEN
      SELECT count(*) INTO v_cnt FROM public.smav_central_bill_numbers WHERE outlet_id = v_glossy_outlet_id AND branch_id = v_remap.old_branch_id;
      v_remaining_refs := v_remaining_refs + COALESCE(v_cnt, 0);
      IF COALESCE(v_cnt, 0) > 0 THEN v_ref_counts := v_ref_counts || jsonb_build_object('smav_central_bill_numbers', v_cnt); END IF;
    END IF;

    IF to_regclass('public.smav_salon_bills') IS NOT NULL THEN
      SELECT count(*) INTO v_cnt FROM public.smav_salon_bills WHERE outlet_id = v_glossy_outlet_id AND branch_id = v_remap.old_branch_id;
      v_remaining_refs := v_remaining_refs + COALESCE(v_cnt, 0);
      IF COALESCE(v_cnt, 0) > 0 THEN v_ref_counts := v_ref_counts || jsonb_build_object('smav_salon_bills', v_cnt); END IF;
    END IF;

    IF to_regclass('public.smav_central_sales') IS NOT NULL THEN
      SELECT count(*) INTO v_cnt FROM public.smav_central_sales WHERE outlet_id = v_glossy_outlet_id AND branch_id = v_remap.old_branch_id;
      v_remaining_refs := v_remaining_refs + COALESCE(v_cnt, 0);
      IF COALESCE(v_cnt, 0) > 0 THEN v_ref_counts := v_ref_counts || jsonb_build_object('smav_central_sales', v_cnt); END IF;
    END IF;

    IF to_regclass('public.smav_bill_number_batches') IS NOT NULL THEN
      SELECT count(*) INTO v_cnt FROM public.smav_bill_number_batches WHERE outlet_id = v_glossy_outlet_id AND branch_id = v_remap.old_branch_id;
      v_remaining_refs := v_remaining_refs + COALESCE(v_cnt, 0);
      IF COALESCE(v_cnt, 0) > 0 THEN v_ref_counts := v_ref_counts || jsonb_build_object('smav_bill_number_batches', v_cnt); END IF;
    END IF;

    IF to_regclass('public.smav_bill_number_counters') IS NOT NULL THEN
      SELECT count(*) INTO v_cnt FROM public.smav_bill_number_counters WHERE outlet_id = v_glossy_outlet_id AND branch_id = v_remap.old_branch_id;
      v_remaining_refs := v_remaining_refs + COALESCE(v_cnt, 0);
      IF COALESCE(v_cnt, 0) > 0 THEN v_ref_counts := v_ref_counts || jsonb_build_object('smav_bill_number_counters', v_cnt); END IF;
    END IF;

    IF to_regclass('public.smav_outbound_sale_events') IS NOT NULL THEN
      SELECT count(*) INTO v_cnt FROM public.smav_outbound_sale_events WHERE outlet_id = v_glossy_outlet_id AND branch_id = v_remap.old_branch_id;
      v_remaining_refs := v_remaining_refs + COALESCE(v_cnt, 0);
      IF COALESCE(v_cnt, 0) > 0 THEN v_ref_counts := v_ref_counts || jsonb_build_object('smav_outbound_sale_events', v_cnt); END IF;
    END IF;

    IF to_regclass('public.smav_user_branch_assignments') IS NOT NULL THEN
      SELECT count(*) INTO v_cnt FROM public.smav_user_branch_assignments WHERE outlet_id = v_glossy_outlet_id AND branch_id = v_remap.old_branch_id;
      v_remaining_refs := v_remaining_refs + COALESCE(v_cnt, 0);
      IF COALESCE(v_cnt, 0) > 0 THEN v_ref_counts := v_ref_counts || jsonb_build_object('smav_user_branch_assignments', v_cnt); END IF;
    END IF;

    IF to_regclass('public.smav_user_outlet_roles') IS NOT NULL THEN
      SELECT count(*) INTO v_cnt FROM public.smav_user_outlet_roles WHERE outlet_id = v_glossy_outlet_id AND v_remap.old_branch_id = ANY(coalesce(assigned_branch_ids, '{}'::text[]));
      v_remaining_refs := v_remaining_refs + COALESCE(v_cnt, 0);
      IF COALESCE(v_cnt, 0) > 0 THEN v_ref_counts := v_ref_counts || jsonb_build_object('smav_user_outlet_roles', v_cnt); END IF;
    END IF;

    -- Always keep legacy branch row inactive in public.smav_branches (manual deletion is a separate future action)
    UPDATE public.smav_branches
    SET is_active = false,
        updated_at = now()
    WHERE id = v_remap.old_branch_id
      AND outlet_id = v_glossy_outlet_id;

    IF NOT EXISTS (
      SELECT 1 FROM public.smav_branch_migration_audit a
      WHERE a.outlet_id = v_glossy_outlet_id
        AND a.old_branch_id = v_remap.old_branch_id
        AND a.new_branch_id = v_remap.new_branch_id
        AND a.action IN ('deactivated_migrated_legacy_branch', 'deactivated_with_remaining_refs')
    ) THEN
      INSERT INTO public.smav_branch_migration_audit (
        outlet_id, old_branch_id, old_branch_code, old_branch_name,
        new_branch_id, new_branch_code, action, reference_counts, notes
      )
      VALUES (
        v_glossy_outlet_id,
        v_remap.old_branch_id,
        v_remap.old_branch_code,
        v_remap.old_branch_name,
        v_remap.new_branch_id,
        v_remap.new_branch_code,
        CASE WHEN v_remaining_refs = 0 THEN 'deactivated_migrated_legacy_branch' ELSE 'deactivated_with_remaining_refs' END,
        v_ref_counts,
        CASE
          WHEN v_remaining_refs = 0 THEN 'All reviewed allow-list references migrated to canonical branch; old branch row marked is_active=false for separate future manual deletion.'
          ELSE 'Marked is_active=false; remaining allow-list references detected and recorded in reference_counts.'
        END
      );
    END IF;
  END LOOP;
END;
$$;

-- =============================================================================
-- 5. Enforce Active Branch Uniqueness & Recreate Exact Original Foreign Keys
-- =============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS uq_smav_branches_outlet_active_code
  ON public.smav_branches (outlet_id, upper(btrim(branch_code)))
  WHERE is_active = true;

CREATE UNIQUE INDEX IF NOT EXISTS uq_smav_branches_outlet_active_name
  ON public.smav_branches (outlet_id, lower(btrim(branch_name)))
  WHERE is_active = true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_smav_branches_id_nonempty'
      AND conrelid = 'public.smav_branches'::regclass
  ) THEN
    ALTER TABLE public.smav_branches
      ADD CONSTRAINT chk_smav_branches_id_nonempty CHECK (length(btrim(id)) >= 2);
  END IF;
END;
$$;

-- 5A. Recreate EVERY originally captured allow-list FK using its exact real definition
DO $$
DECLARE
  v_saved RECORD;
BEGIN
  FOR v_saved IN
    SELECT
      reference_counts->>'table_name' AS table_name,
      reference_counts->>'constraint_name' AS constraint_name,
      notes AS constraint_def
    FROM public.smav_branch_migration_audit
    WHERE action = 'migration_022_saved_fk_capture'
    ORDER BY table_name, constraint_name
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = format('public.%I', v_saved.table_name)::regclass
        AND conname = v_saved.constraint_name
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I %s',
        v_saved.table_name,
        v_saved.constraint_name,
        v_saved.constraint_def
      );
    END IF;
  END LOOP;
END;
$$;

-- 5B. Add named FKs ONLY for newly introduced allow-listed branch_id columns
--     (if no FK on that column referencing public.smav_branches already exists)
DO $$
DECLARE
  v_spec RECORD;
  v_has_fk boolean;
BEGIN
  FOR v_spec IN
    SELECT *
    FROM (
      VALUES
        ('smav_bill_number_counters',    'branch_id', 'fk_smav_bill_number_counters_branch'),
        ('smav_outbound_sale_events',    'branch_id', 'fk_smav_outbound_sale_events_branch'),
        ('smav_user_branch_assignments', 'branch_id', 'fk_smav_user_branch_assignments_branch')
    ) AS t(tbl, col, cname)
  LOOP
    IF to_regclass('public.' || v_spec.tbl) IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1
        FROM pg_constraint AS con
        JOIN pg_attribute AS att
          ON att.attrelid = con.conrelid
         AND att.attnum = ANY(con.conkey)
        WHERE con.contype = 'f'
          AND con.conrelid = format('public.%I', v_spec.tbl)::regclass
          AND con.confrelid = 'public.smav_branches'::regclass
          AND att.attname = v_spec.col
      ) INTO v_has_fk;

      IF NOT v_has_fk THEN
        EXECUTE format(
          'ALTER TABLE public.%I
           ADD CONSTRAINT %I FOREIGN KEY (%I)
           REFERENCES public.smav_branches(id)
           ON UPDATE CASCADE ON DELETE RESTRICT',
          v_spec.tbl,
          v_spec.cname,
          v_spec.col
        );
      END IF;
    END IF;
  END LOOP;
END;
$$;

-- Supporting indexes for branch-scoped queries
CREATE INDEX IF NOT EXISTS idx_smav_salon_bills_outlet_branch_id
  ON public.smav_salon_bills (outlet_id, branch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_smav_central_bill_numbers_outlet_branch_id
  ON public.smav_central_bill_numbers (outlet_id, branch_id, billing_date DESC);

-- =============================================================================
-- 6. Dynamic Branch-Agnostic Central Bill-Numbering RPCs (text branch_id)
-- =============================================================================
DROP FUNCTION IF EXISTS public.smav_reserve_central_bill_number(uuid, text, text, text, uuid, text, text);
DROP FUNCTION IF EXISTS public.smav_reserve_central_bill_number(uuid, text, text, text, uuid, text, text, text);
DROP FUNCTION IF EXISTS public.smav_allocate_bill_number_range(uuid, text, text, integer, uuid, text);
DROP FUNCTION IF EXISTS public.smav_allocate_bill_number_range(uuid, text, text, integer, uuid, text, text);
DROP FUNCTION IF EXISTS public.smav_finalize_central_bill_number(uuid, text, text, text, text, text);

-- RPC #1: Atomic per-(outlet, branch, India date) reservation with dynamic branch lookup by id or code
CREATE OR REPLACE FUNCTION public.smav_reserve_central_bill_number(
  p_outlet_id uuid,
  p_branch_code text,
  p_idempotency_key text,
  p_source_system text,
  p_created_by uuid DEFAULT NULL,
  p_device_id text DEFAULT NULL,
  p_bill_prefix text DEFAULT 'TGL',
  p_branch_id text DEFAULT NULL
)
RETURNS TABLE (
  central_bill_id uuid,
  central_bill_number text,
  outlet_id uuid,
  branch_id text,
  branch_code text,
  branch_name text,
  billing_date date,
  sequence_number integer,
  source_system text,
  status text,
  idempotency_key text,
  generated_at timestamptz,
  idempotent_replay boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_clean_branch_id text := btrim(coalesce(p_branch_id, ''));
  v_clean_branch_code text := upper(btrim(coalesce(p_branch_code, '')));
  v_clean_idem text := btrim(coalesce(p_idempotency_key, ''));
  v_clean_source text := lower(btrim(coalesce(p_source_system, '')));
  v_clean_prefix text := upper(btrim(coalesce(NULLIF(p_bill_prefix, ''), 'TGL')));
  v_branch public.smav_branches%ROWTYPE;
  v_existing public.smav_central_bill_numbers%ROWTYPE;
  v_billing_date date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_date_str text := to_char((now() AT TIME ZONE 'Asia/Kolkata')::date, 'YYYYMMDD');
  v_seed_bills_seq integer := 0;
  v_seed_central_seq integer := 0;
  v_seed_seq integer := 0;
  v_next_seq integer;
  v_bill_no text;
  v_inserted public.smav_central_bill_numbers%ROWTYPE;
BEGIN
  IF v_clean_branch_id = '' AND v_clean_branch_code = '' THEN
    RAISE EXCEPTION 'BRANCH_REQUIRED: Branch selection is mandatory before generating a bill number.';
  END IF;
  IF v_clean_idem = '' THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED: idempotency_key is required.';
  END IF;
  IF v_clean_source NOT IN ('smav_web_pos', 'smav_android_agent', 'glossylooks_admin_portal') THEN
    RAISE EXCEPTION 'INVALID_SOURCE_SYSTEM: Unsupported source_system "%".', v_clean_source;
  END IF;

  -- Idempotent retry check: always return the exact existing bill number
  SELECT c.* INTO v_existing
  FROM public.smav_central_bill_numbers AS c
  WHERE c.idempotency_key = v_clean_idem
  LIMIT 1;

  IF FOUND THEN
    IF v_existing.outlet_id IS DISTINCT FROM p_outlet_id THEN
      RAISE EXCEPTION 'OUTLET_MISMATCH: Idempotency key belongs to another outlet.';
    END IF;
    RETURN QUERY SELECT
      v_existing.id,
      v_existing.central_bill_number,
      v_existing.outlet_id,
      v_existing.branch_id,
      v_existing.branch_code,
      v_existing.branch_name,
      v_existing.billing_date,
      v_existing.sequence_number,
      v_existing.source_system,
      v_existing.status,
      v_existing.idempotency_key,
      v_existing.generated_at,
      true;
    RETURN;
  END IF;

  -- Dynamically resolve active branch from central public.smav_branches (by id or branch_code)
  SELECT b.* INTO v_branch
  FROM public.smav_branches AS b
  WHERE b.outlet_id = p_outlet_id
    AND b.is_active = true
    AND (
      (v_clean_branch_id <> '' AND b.id = v_clean_branch_id)
      OR (v_clean_branch_id = '' AND upper(btrim(b.branch_code)) = v_clean_branch_code)
    )
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_BRANCH: Branch "%" is not configured or active for this outlet.',
      COALESCE(NULLIF(v_clean_branch_id, ''), v_clean_branch_code);
  END IF;

  v_clean_prefix := upper(coalesce(NULLIF(btrim(v_branch.bill_prefix), ''), v_clean_prefix));

  -- Advisory transaction lock scoped to (outlet_id, canonical branch_code, India billing_date)
  PERFORM pg_advisory_xact_lock(hashtext(p_outlet_id::text || ':' || v_branch.branch_code || ':' || v_date_str));

  -- Re-check idempotency inside lock
  SELECT c.* INTO v_existing
  FROM public.smav_central_bill_numbers AS c
  WHERE c.idempotency_key = v_clean_idem
  LIMIT 1;

  IF FOUND THEN
    IF v_existing.outlet_id IS DISTINCT FROM p_outlet_id THEN
      RAISE EXCEPTION 'OUTLET_MISMATCH: Idempotency key belongs to another outlet.';
    END IF;
    RETURN QUERY SELECT
      v_existing.id,
      v_existing.central_bill_number,
      v_existing.outlet_id,
      v_existing.branch_id,
      v_existing.branch_code,
      v_existing.branch_name,
      v_existing.billing_date,
      v_existing.sequence_number,
      v_existing.source_system,
      v_existing.status,
      v_existing.idempotency_key,
      v_existing.generated_at,
      true;
    RETURN;
  END IF;

  SELECT COALESCE(MAX(
    CASE
      WHEN split_part(sb.bill_number, '-', 4) ~ '^[0-9]+$'
      THEN split_part(sb.bill_number, '-', 4)::integer
      ELSE 0
    END
  ), 0)
  INTO v_seed_bills_seq
  FROM public.smav_salon_bills AS sb
  WHERE sb.outlet_id = p_outlet_id
    AND sb.bill_number LIKE (v_clean_prefix || '-' || v_branch.branch_code || '-' || v_date_str || '-%');

  SELECT COALESCE(MAX(cn.sequence_number), 0)
  INTO v_seed_central_seq
  FROM public.smav_central_bill_numbers AS cn
  WHERE cn.outlet_id = p_outlet_id
    AND cn.branch_code = v_branch.branch_code
    AND cn.billing_date = v_billing_date;

  v_seed_seq := GREATEST(v_seed_bills_seq, v_seed_central_seq);

  INSERT INTO public.smav_bill_number_counters AS cnt (
    outlet_id,
    branch_id,
    branch_code,
    billing_date,
    last_sequence,
    updated_at
  )
  VALUES (
    p_outlet_id,
    v_branch.id,
    v_branch.branch_code,
    v_billing_date,
    v_seed_seq + 1,
    now()
  )
  ON CONFLICT ON CONSTRAINT smav_bill_number_counters_pkey DO UPDATE
    SET last_sequence = GREATEST(cnt.last_sequence, v_seed_seq) + 1,
        branch_id = v_branch.id,
        updated_at = now()
  RETURNING cnt.last_sequence INTO v_next_seq;

  v_bill_no := v_clean_prefix || '-' || v_branch.branch_code || '-' || v_date_str || '-' || lpad(v_next_seq::text, 4, '0');

  INSERT INTO public.smav_central_bill_numbers AS c (
    central_bill_number,
    outlet_id,
    branch_id,
    branch_code,
    branch_name,
    billing_date,
    sequence_number,
    source_system,
    status,
    idempotency_key,
    device_id,
    created_by
  )
  VALUES (
    v_bill_no,
    p_outlet_id,
    v_branch.id,
    v_branch.branch_code,
    v_branch.branch_name,
    v_billing_date,
    v_next_seq,
    v_clean_source,
    'RESERVED',
    v_clean_idem,
    NULLIF(btrim(coalesce(p_device_id, '')), ''),
    p_created_by
  )
  RETURNING c.* INTO v_inserted;

  RETURN QUERY SELECT
    v_inserted.id,
    v_inserted.central_bill_number,
    v_inserted.outlet_id,
    v_inserted.branch_id,
    v_inserted.branch_code,
    v_inserted.branch_name,
    v_inserted.billing_date,
    v_inserted.sequence_number,
    v_inserted.source_system,
    v_inserted.status,
    v_inserted.idempotency_key,
    v_inserted.generated_at,
    false;
END;
$$;

-- RPC #2: Dynamic branch-specific offline range allocation
CREATE OR REPLACE FUNCTION public.smav_allocate_bill_number_range(
  p_outlet_id uuid,
  p_branch_code text,
  p_device_id text,
  p_count integer DEFAULT 20,
  p_allocated_by uuid DEFAULT NULL,
  p_bill_prefix text DEFAULT 'TGL',
  p_branch_id text DEFAULT NULL
)
RETURNS TABLE (
  batch_id uuid,
  central_bill_id uuid,
  central_bill_number text,
  outlet_id uuid,
  branch_id text,
  branch_code text,
  branch_name text,
  billing_date date,
  sequence_number integer,
  idempotency_key text,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_clean_branch_id text := btrim(coalesce(p_branch_id, ''));
  v_clean_branch_code text := upper(btrim(coalesce(p_branch_code, '')));
  v_clean_device text := btrim(coalesce(p_device_id, ''));
  v_safe_count integer := LEAST(GREATEST(coalesce(p_count, 20), 1), 100);
  v_branch public.smav_branches%ROWTYPE;
  v_billing_date date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_date_str text := to_char((now() AT TIME ZONE 'Asia/Kolkata')::date, 'YYYYMMDD');
  v_expires_at timestamptz := (((now() AT TIME ZONE 'Asia/Kolkata')::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata');
  v_clean_prefix text;
  v_seed_bills_seq integer := 0;
  v_seed_central_seq integer := 0;
  v_seed_seq integer := 0;
  v_end_seq integer;
  v_start_seq integer;
  v_batch_id uuid;
  v_seq integer;
  v_bill_no text;
  v_idem text;
  v_row public.smav_central_bill_numbers%ROWTYPE;
BEGIN
  IF v_clean_branch_id = '' AND v_clean_branch_code = '' THEN
    RAISE EXCEPTION 'BRANCH_REQUIRED: branch_id or branch_code is required to allocate an offline range.';
  END IF;
  IF v_clean_device = '' THEN
    RAISE EXCEPTION 'DEVICE_ID_REQUIRED: device_id is required to allocate an offline range.';
  END IF;

  SELECT b.* INTO v_branch
  FROM public.smav_branches AS b
  WHERE b.outlet_id = p_outlet_id
    AND b.is_active = true
    AND (
      (v_clean_branch_id <> '' AND b.id = v_clean_branch_id)
      OR (v_clean_branch_id = '' AND upper(btrim(b.branch_code)) = v_clean_branch_code)
    )
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_BRANCH: Branch "%" is not configured or active for this outlet.',
      COALESCE(NULLIF(v_clean_branch_id, ''), v_clean_branch_code);
  END IF;

  v_clean_prefix := upper(coalesce(NULLIF(btrim(v_branch.bill_prefix), ''), NULLIF(p_bill_prefix, ''), 'TGL'));

  PERFORM pg_advisory_xact_lock(hashtext(p_outlet_id::text || ':' || v_branch.branch_code || ':' || v_date_str));

  SELECT COALESCE(MAX(
    CASE
      WHEN split_part(sb.bill_number, '-', 4) ~ '^[0-9]+$'
      THEN split_part(sb.bill_number, '-', 4)::integer
      ELSE 0
    END
  ), 0)
  INTO v_seed_bills_seq
  FROM public.smav_salon_bills AS sb
  WHERE sb.outlet_id = p_outlet_id
    AND sb.bill_number LIKE (v_clean_prefix || '-' || v_branch.branch_code || '-' || v_date_str || '-%');

  SELECT COALESCE(MAX(cn.sequence_number), 0)
  INTO v_seed_central_seq
  FROM public.smav_central_bill_numbers AS cn
  WHERE cn.outlet_id = p_outlet_id
    AND cn.branch_code = v_branch.branch_code
    AND cn.billing_date = v_billing_date;

  v_seed_seq := GREATEST(v_seed_bills_seq, v_seed_central_seq);

  INSERT INTO public.smav_bill_number_counters AS cnt (
    outlet_id,
    branch_id,
    branch_code,
    billing_date,
    last_sequence,
    updated_at
  )
  VALUES (
    p_outlet_id,
    v_branch.id,
    v_branch.branch_code,
    v_billing_date,
    v_seed_seq + v_safe_count,
    now()
  )
  ON CONFLICT ON CONSTRAINT smav_bill_number_counters_pkey DO UPDATE
    SET last_sequence = GREATEST(cnt.last_sequence, v_seed_seq) + v_safe_count,
        branch_id = v_branch.id,
        updated_at = now()
  RETURNING cnt.last_sequence INTO v_end_seq;

  v_start_seq := v_end_seq - v_safe_count + 1;

  INSERT INTO public.smav_bill_number_batches AS batch (
    outlet_id, branch_id, branch_code, branch_name, billing_date, device_id,
    bill_prefix, start_sequence, end_sequence, allocated_count, status, allocated_by, expires_at
  )
  VALUES (
    p_outlet_id, v_branch.id, v_branch.branch_code, v_branch.branch_name, v_billing_date, v_clean_device,
    v_clean_prefix, v_start_seq, v_end_seq, v_safe_count, 'ACTIVE', p_allocated_by, v_expires_at
  )
  RETURNING batch.id INTO v_batch_id;

  FOR v_seq IN v_start_seq..v_end_seq LOOP
    v_bill_no := v_clean_prefix || '-' || v_branch.branch_code || '-' || v_date_str || '-' || lpad(v_seq::text, 4, '0');
    v_idem := 'PREALLOC_' || v_bill_no || '_' || right(regexp_replace(v_clean_device, '[^A-Za-z0-9]', '', 'g'), 12);

    INSERT INTO public.smav_central_bill_numbers AS c (
      central_bill_number, outlet_id, branch_id, branch_code, branch_name,
      billing_date, sequence_number, source_system, status, idempotency_key,
      device_id, batch_id, created_by
    )
    VALUES (
      v_bill_no, p_outlet_id, v_branch.id, v_branch.branch_code, v_branch.branch_name,
      v_billing_date, v_seq, 'smav_android_agent', 'PREALLOCATED', v_idem,
      v_clean_device, v_batch_id, p_allocated_by
    )
    RETURNING c.* INTO v_row;

    RETURN QUERY SELECT
      v_batch_id,
      v_row.id,
      v_row.central_bill_number,
      v_row.outlet_id,
      v_row.branch_id,
      v_row.branch_code,
      v_row.branch_name,
      v_row.billing_date,
      v_row.sequence_number,
      v_row.idempotency_key,
      v_expires_at;
  END LOOP;
END;
$$;

-- RPC #3: Finalize central bill number (returns text branch_id)
CREATE OR REPLACE FUNCTION public.smav_finalize_central_bill_number(
  p_outlet_id uuid,
  p_central_bill_number text,
  p_idempotency_key text DEFAULT NULL,
  p_local_bill_id text DEFAULT NULL,
  p_external_order_id text DEFAULT NULL,
  p_source_system text DEFAULT NULL
)
RETURNS TABLE (
  central_bill_id uuid,
  central_bill_number text,
  outlet_id uuid,
  branch_id text,
  branch_code text,
  branch_name text,
  status text,
  finalized_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_clean_no text := upper(btrim(coalesce(p_central_bill_number, '')));
  v_clean_idem text := btrim(coalesce(p_idempotency_key, ''));
  v_row public.smav_central_bill_numbers%ROWTYPE;
BEGIN
  SELECT c.* INTO v_row
  FROM public.smav_central_bill_numbers AS c
  WHERE c.outlet_id = p_outlet_id
    AND (
      (v_clean_no <> '' AND upper(c.central_bill_number) = v_clean_no)
      OR (v_clean_idem <> '' AND c.idempotency_key = v_clean_idem)
    )
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CENTRAL_BILL_NOT_FOUND: Central bill number "%" was not reserved for this outlet.', v_clean_no;
  END IF;

  IF v_clean_no <> '' AND upper(v_row.central_bill_number) <> v_clean_no THEN
    RAISE EXCEPTION 'IMMUTABLE_BILL_NUMBER: Idempotency key is already bound to central bill number "%" and cannot be finalized as "%".',
      v_row.central_bill_number, v_clean_no;
  END IF;

  IF v_row.status = 'VOIDED' THEN
    RAISE EXCEPTION 'CENTRAL_BILL_VOIDED: Central bill number "%" is already voided.', v_row.central_bill_number;
  END IF;

  UPDATE public.smav_central_bill_numbers AS c
  SET status = 'FINALIZED',
      local_bill_id = COALESCE(NULLIF(btrim(coalesce(p_local_bill_id, '')), ''), c.local_bill_id),
      external_order_id = COALESCE(NULLIF(btrim(coalesce(p_external_order_id, '')), ''), c.external_order_id),
      source_system = COALESCE(
        CASE WHEN lower(btrim(coalesce(p_source_system, ''))) IN ('smav_web_pos', 'smav_android_agent', 'glossylooks_admin_portal')
             THEN lower(btrim(p_source_system)) ELSE NULL END,
        c.source_system
      ),
      finalized_at = COALESCE(c.finalized_at, now())
  WHERE c.id = v_row.id
  RETURNING c.* INTO v_row;

  RETURN QUERY SELECT
    v_row.id,
    v_row.central_bill_number,
    v_row.outlet_id,
    v_row.branch_id,
    v_row.branch_code,
    v_row.branch_name,
    v_row.status,
    v_row.finalized_at;
END;
$$;

REVOKE ALL ON FUNCTION public.smav_reserve_central_bill_number(uuid, text, text, text, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.smav_allocate_bill_number_range(uuid, text, text, integer, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.smav_finalize_central_bill_number(uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.smav_reserve_central_bill_number(uuid, text, text, text, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.smav_allocate_bill_number_range(uuid, text, text, integer, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.smav_finalize_central_bill_number(uuid, text, text, text, text, text) TO service_role;

-- =============================================================================
-- 7. Dynamic Branch-Agnostic Reconciliation View
-- =============================================================================
DROP VIEW IF EXISTS public.smav_bill_number_reconciliation_v;
CREATE VIEW public.smav_bill_number_reconciliation_v AS
SELECT
  sb.outlet_id,
  sb.id AS bill_id,
  sb.bill_number,
  sb.central_bill_id,
  sb.central_bill_number,
  sb.branch_id,
  sb.branch_code,
  sb.branch_name,
  sb.source_system,
  sb.created_at,
  CASE
    WHEN sb.central_bill_number IS NULL AND sb.bill_number ~ '^[A-Z0-9]{2,8}-[A-Z0-9]{2,12}-[0-9]{8}-[0-9]{4,}$' THEN 'UNLINKED_CENTRAL_FORMAT'
    WHEN sb.central_bill_number IS NULL THEN 'LEGACY_HISTORICAL'
    WHEN sb.central_bill_number <> sb.bill_number THEN 'MISMATCHED_BILL_NUMBER'
    ELSE 'LINKED_OK'
  END AS reconciliation_status
FROM public.smav_salon_bills AS sb;

-- Migration-only helpers: remove them after all references and FKs have been
-- recreated successfully. A failed transaction rolls this creation back.
DROP TABLE IF EXISTS public.smav_branch_migration_remap;

COMMIT;
