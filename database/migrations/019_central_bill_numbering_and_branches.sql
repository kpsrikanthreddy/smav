-- =============================================================================
-- Migration 019: Centralized GlossyLooks Bill Numbering & Mandatory Branches
-- =============================================================================
-- Strictly non-destructive, additive migration.
-- - Does NOT modify or rewrite existing historical bill numbers.
-- - Reuses existing public.smav_outlets and public.smav_user_outlet_roles.
-- - Provides atomic, row-locked RPCs for:
--     1) Single bill-number reservation (idempotent by idempotency_key)
--     2) Branch-specific preallocated range allocation for Android offline use
--     3) Bill-number finalization (immutable once assigned)
-- - Run manually in Central SMAV Supabase SQL Editor during scheduled rollout.
-- =============================================================================

BEGIN;

-- 1. Branch registry per outlet (reuses public.smav_outlets)
CREATE TABLE IF NOT EXISTS public.smav_branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id uuid NOT NULL REFERENCES public.smav_outlets(id) ON DELETE CASCADE,
  branch_code text NOT NULL,
  branch_name text NOT NULL,
  external_branch_id text,
  bill_prefix text NOT NULL DEFAULT 'TGL',
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_smav_branches_outlet_code UNIQUE (outlet_id, branch_code),
  CONSTRAINT chk_smav_branches_code_upper CHECK (branch_code = upper(btrim(branch_code)) AND length(btrim(branch_code)) >= 2)
);

CREATE INDEX IF NOT EXISTS idx_smav_branches_outlet_active
  ON public.smav_branches (outlet_id, is_active);

-- 2. Additive per-user branch assignment on existing smav_user_outlet_roles
--    Empty array = inherit all active branches of the outlet (Owners/Admins/Superadmins).
--    Single-element array = auto-preselect that branch for POS staff.
--    Multi-element array = user must manually select from their assigned branches.
ALTER TABLE public.smav_user_outlet_roles
  ADD COLUMN IF NOT EXISTS assigned_branch_codes text[] NOT NULL DEFAULT '{}'::text[];

-- 3. Seed canonical GlossyLooks branches (idempotent; skips if GlossyLooks outlet is not yet seeded)
INSERT INTO public.smav_branches (outlet_id, branch_code, branch_name, external_branch_id, bill_prefix, is_active, metadata)
SELECT
  o.id,
  v.branch_code,
  v.branch_name,
  v.external_branch_id,
  'TGL',
  true,
  jsonb_build_object('whatsapp_line', '9966970003 (G)  9154744608 (K)', 'timezone', 'Asia/Kolkata')
FROM public.smav_outlets o
CROSS JOIN (
  VALUES
    ('GACHI', 'Gachibowli', 'tgl-gachibowli-main'),
    ('KONDA', 'Kondapur', 'tgl-kondapur-main')
) AS v(branch_code, branch_name, external_branch_id)
WHERE lower(coalesce(o.outlet_code, o.code, '')) = 'glossylooks'
ON CONFLICT (outlet_id, branch_code) DO UPDATE
  SET branch_name = EXCLUDED.branch_name,
      external_branch_id = COALESCE(public.smav_branches.external_branch_id, EXCLUDED.external_branch_id),
      bill_prefix = EXCLUDED.bill_prefix,
      updated_at = now();

-- 4. Atomic sequence counter table: unique per (outlet_id, branch_code, India date)
CREATE TABLE IF NOT EXISTS public.smav_bill_number_counters (
  outlet_id uuid NOT NULL REFERENCES public.smav_outlets(id) ON DELETE CASCADE,
  branch_code text NOT NULL,
  billing_date date NOT NULL,
  last_sequence integer NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (outlet_id, branch_code, billing_date)
);

-- 5. Preallocated offline ranges for Android Print Agent devices
CREATE TABLE IF NOT EXISTS public.smav_bill_number_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id uuid NOT NULL REFERENCES public.smav_outlets(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.smav_branches(id),
  branch_code text NOT NULL,
  branch_name text NOT NULL,
  billing_date date NOT NULL,
  device_id text NOT NULL,
  bill_prefix text NOT NULL DEFAULT 'TGL',
  start_sequence integer NOT NULL,
  end_sequence integer NOT NULL,
  allocated_count integer NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'EXHAUSTED', 'EXPIRED')),
  allocated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_smav_bill_batches_device_date
  ON public.smav_bill_number_batches (outlet_id, branch_code, device_id, billing_date DESC);

-- 6. Central Bill Number Registry (Single Source of Truth)
CREATE TABLE IF NOT EXISTS public.smav_central_bill_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  central_bill_number text NOT NULL UNIQUE,
  outlet_id uuid NOT NULL REFERENCES public.smav_outlets(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.smav_branches(id),
  branch_code text NOT NULL,
  branch_name text NOT NULL,
  billing_date date NOT NULL,
  sequence_number integer NOT NULL CHECK (sequence_number > 0),
  source_system text NOT NULL CHECK (source_system IN ('smav_web_pos', 'smav_android_agent', 'glossylooks_admin_portal')),
  status text NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED', 'PREALLOCATED', 'FINALIZED', 'VOIDED', 'EXPIRED')),
  idempotency_key text NOT NULL UNIQUE,
  device_id text,
  batch_id uuid REFERENCES public.smav_bill_number_batches(id),
  local_bill_id text,
  external_order_id text,
  created_by uuid,
  generated_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT uq_smav_central_bill_seq UNIQUE (outlet_id, branch_code, billing_date, sequence_number)
);

CREATE INDEX IF NOT EXISTS idx_smav_central_bill_numbers_outlet_date
  ON public.smav_central_bill_numbers (outlet_id, branch_code, billing_date DESC);

CREATE INDEX IF NOT EXISTS idx_smav_central_bill_numbers_status
  ON public.smav_central_bill_numbers (outlet_id, status, billing_date DESC);

-- 7. Immutability trigger: a generated central_bill_number must NEVER change once assigned
CREATE OR REPLACE FUNCTION public.smav_prevent_bill_number_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.central_bill_number IS DISTINCT FROM NEW.central_bill_number THEN
    RAISE EXCEPTION 'central_bill_number (%) is immutable once assigned and cannot be changed to %',
      OLD.central_bill_number, NEW.central_bill_number;
  END IF;
  IF OLD.outlet_id IS DISTINCT FROM NEW.outlet_id OR OLD.branch_code IS DISTINCT FROM NEW.branch_code THEN
    RAISE EXCEPTION 'outlet_id and branch_code on central_bill_number (%) are immutable', OLD.central_bill_number;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_smav_central_bill_number_immutable ON public.smav_central_bill_numbers;
CREATE TRIGGER trg_smav_central_bill_number_immutable
  BEFORE UPDATE ON public.smav_central_bill_numbers
  FOR EACH ROW
  EXECUTE FUNCTION public.smav_prevent_bill_number_mutation();

-- 8. Additive central bill & branch columns on existing transaction tables (legacy rows preserved untouched)
ALTER TABLE public.smav_salon_bills
  ADD COLUMN IF NOT EXISTS central_bill_id uuid REFERENCES public.smav_central_bill_numbers(id),
  ADD COLUMN IF NOT EXISTS central_bill_number text,
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.smav_branches(id),
  ADD COLUMN IF NOT EXISTS branch_code text,
  ADD COLUMN IF NOT EXISTS branch_name text,
  ADD COLUMN IF NOT EXISTS source_system text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_smav_salon_bills_central_number
  ON public.smav_salon_bills (outlet_id, central_bill_number)
  WHERE central_bill_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_smav_salon_bills_branch_created
  ON public.smav_salon_bills (outlet_id, branch_code, created_at DESC);

ALTER TABLE public.smav_central_sales
  ADD COLUMN IF NOT EXISTS central_bill_id uuid REFERENCES public.smav_central_bill_numbers(id),
  ADD COLUMN IF NOT EXISTS central_bill_number text,
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.smav_branches(id),
  ADD COLUMN IF NOT EXISTS branch_code text,
  ADD COLUMN IF NOT EXISTS branch_name text,
  ADD COLUMN IF NOT EXISTS source_system text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_smav_central_sales_central_number
  ON public.smav_central_sales (outlet_id, central_bill_number)
  WHERE central_bill_number IS NOT NULL;

-- 9. Enable RLS on new tables (server-side service_role executes RPCs; authenticated users may read branches of assigned outlets)
ALTER TABLE public.smav_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smav_bill_number_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smav_bill_number_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smav_central_bill_numbers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS smav_branches_read_assigned ON public.smav_branches;
CREATE POLICY smav_branches_read_assigned ON public.smav_branches
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.smav_user_outlet_roles r
      WHERE r.user_id = (SELECT auth.uid())
        AND r.outlet_id = smav_branches.outlet_id
        AND r.is_active = true
    )
    OR EXISTS (
      SELECT 1 FROM public.smav_profiles p
      WHERE p.id = (SELECT auth.uid())
        AND p.platform_role = 'SUPERADMIN'
        AND p.is_active = true
    )
  );

-- 10. Atomic RPC #1: Reserve a single central bill number (idempotent by idempotency_key)
CREATE OR REPLACE FUNCTION public.smav_reserve_central_bill_number(
  p_outlet_id uuid,
  p_branch_code text,
  p_idempotency_key text,
  p_source_system text,
  p_created_by uuid DEFAULT NULL,
  p_device_id text DEFAULT NULL,
  p_bill_prefix text DEFAULT 'TGL'
)
RETURNS TABLE (
  central_bill_id uuid,
  central_bill_number text,
  outlet_id uuid,
  branch_id uuid,
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
DECLARE
  v_clean_branch text := upper(btrim(coalesce(p_branch_code, '')));
  v_clean_idem text := btrim(coalesce(p_idempotency_key, ''));
  v_clean_source text := lower(btrim(coalesce(p_source_system, '')));
  v_clean_prefix text := upper(btrim(coalesce(NULLIF(p_bill_prefix, ''), 'TGL')));
  v_branch public.smav_branches%ROWTYPE;
  v_existing public.smav_central_bill_numbers%ROWTYPE;
  v_billing_date date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_date_str text := to_char((now() AT TIME ZONE 'Asia/Kolkata')::date, 'YYYYMMDD');
  v_seed_seq integer := 0;
  v_next_seq integer;
  v_bill_no text;
  v_inserted public.smav_central_bill_numbers%ROWTYPE;
BEGIN
  IF v_clean_branch = '' THEN
    RAISE EXCEPTION 'BRANCH_REQUIRED: Branch selection is mandatory before generating a bill number.';
  END IF;
  IF v_clean_idem = '' THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED: idempotency_key is required.';
  END IF;
  IF v_clean_source NOT IN ('smav_web_pos', 'smav_android_agent', 'glossylooks_admin_portal') THEN
    RAISE EXCEPTION 'INVALID_SOURCE_SYSTEM: Unsupported source_system "%".', v_clean_source;
  END IF;

  -- Idempotent retry check: always return the exact existing bill number
  SELECT * INTO v_existing
  FROM public.smav_central_bill_numbers c
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

  -- Validate branch exists and is active for the outlet
  SELECT * INTO v_branch
  FROM public.smav_branches b
  WHERE b.outlet_id = p_outlet_id
    AND upper(b.branch_code) = v_clean_branch
    AND b.is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_BRANCH: Branch "%" is not configured or active for this outlet.', v_clean_branch;
  END IF;

  v_clean_prefix := upper(coalesce(NULLIF(v_branch.bill_prefix, ''), v_clean_prefix));

  -- Advisory transaction lock scoped to (outlet_id, branch_code, India billing_date)
  PERFORM pg_advisory_xact_lock(hashtext(p_outlet_id::text || ':' || v_branch.branch_code || ':' || v_date_str));

  -- Re-check idempotency inside lock to eliminate concurrent double-clicks
  SELECT * INTO v_existing
  FROM public.smav_central_bill_numbers c
  WHERE c.idempotency_key = v_clean_idem
  LIMIT 1;

  IF FOUND THEN
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

  -- Seed counter safely from any pre-migration bills created earlier today for this branch
  SELECT COALESCE(MAX(
    CASE
      WHEN split_part(sb.bill_number, '-', 4) ~ '^[0-9]+$'
      THEN split_part(sb.bill_number, '-', 4)::integer
      ELSE 0
    END
  ), 0)
  INTO v_seed_seq
  FROM public.smav_salon_bills sb
  WHERE sb.outlet_id = p_outlet_id
    AND sb.bill_number LIKE (v_clean_prefix || '-' || v_branch.branch_code || '-' || v_date_str || '-%');

  INSERT INTO public.smav_bill_number_counters (outlet_id, branch_code, billing_date, last_sequence, updated_at)
  VALUES (p_outlet_id, v_branch.branch_code, v_billing_date, v_seed_seq + 1, now())
  ON CONFLICT (outlet_id, branch_code, billing_date) DO UPDATE
    SET last_sequence = GREATEST(public.smav_bill_number_counters.last_sequence, v_seed_seq) + 1,
        updated_at = now()
  RETURNING last_sequence INTO v_next_seq;

  v_bill_no := v_clean_prefix || '-' || v_branch.branch_code || '-' || v_date_str || '-' || lpad(v_next_seq::text, 4, '0');

  INSERT INTO public.smav_central_bill_numbers (
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
  RETURNING * INTO v_inserted;

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

-- 11. Atomic RPC #2: Preallocate a branch-specific range for offline Android devices
CREATE OR REPLACE FUNCTION public.smav_allocate_bill_number_range(
  p_outlet_id uuid,
  p_branch_code text,
  p_device_id text,
  p_count integer DEFAULT 20,
  p_allocated_by uuid DEFAULT NULL,
  p_bill_prefix text DEFAULT 'TGL'
)
RETURNS TABLE (
  batch_id uuid,
  central_bill_id uuid,
  central_bill_number text,
  outlet_id uuid,
  branch_id uuid,
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
DECLARE
  v_clean_branch text := upper(btrim(coalesce(p_branch_code, '')));
  v_clean_device text := btrim(coalesce(p_device_id, ''));
  v_safe_count integer := LEAST(GREATEST(coalesce(p_count, 20), 1), 100);
  v_branch public.smav_branches%ROWTYPE;
  v_billing_date date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_date_str text := to_char((now() AT TIME ZONE 'Asia/Kolkata')::date, 'YYYYMMDD');
  v_expires_at timestamptz := (((now() AT TIME ZONE 'Asia/Kolkata')::date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata');
  v_clean_prefix text;
  v_seed_seq integer := 0;
  v_end_seq integer;
  v_start_seq integer;
  v_batch_id uuid;
  v_seq integer;
  v_bill_no text;
  v_idem text;
  v_row public.smav_central_bill_numbers%ROWTYPE;
BEGIN
  IF v_clean_branch = '' THEN
    RAISE EXCEPTION 'BRANCH_REQUIRED: branch_code is required to allocate an offline range.';
  END IF;
  IF v_clean_device = '' THEN
    RAISE EXCEPTION 'DEVICE_ID_REQUIRED: device_id is required to allocate an offline range.';
  END IF;

  SELECT * INTO v_branch
  FROM public.smav_branches b
  WHERE b.outlet_id = p_outlet_id
    AND upper(b.branch_code) = v_clean_branch
    AND b.is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_BRANCH: Branch "%" is not configured or active for this outlet.', v_clean_branch;
  END IF;

  v_clean_prefix := upper(coalesce(NULLIF(v_branch.bill_prefix, ''), NULLIF(p_bill_prefix, ''), 'TGL'));

  PERFORM pg_advisory_xact_lock(hashtext(p_outlet_id::text || ':' || v_branch.branch_code || ':' || v_date_str));

  SELECT COALESCE(MAX(
    CASE
      WHEN split_part(sb.bill_number, '-', 4) ~ '^[0-9]+$'
      THEN split_part(sb.bill_number, '-', 4)::integer
      ELSE 0
    END
  ), 0)
  INTO v_seed_seq
  FROM public.smav_salon_bills sb
  WHERE sb.outlet_id = p_outlet_id
    AND sb.bill_number LIKE (v_clean_prefix || '-' || v_branch.branch_code || '-' || v_date_str || '-%');

  INSERT INTO public.smav_bill_number_counters (outlet_id, branch_code, billing_date, last_sequence, updated_at)
  VALUES (p_outlet_id, v_branch.branch_code, v_billing_date, v_seed_seq + v_safe_count, now())
  ON CONFLICT (outlet_id, branch_code, billing_date) DO UPDATE
    SET last_sequence = GREATEST(public.smav_bill_number_counters.last_sequence, v_seed_seq) + v_safe_count,
        updated_at = now()
  RETURNING last_sequence INTO v_end_seq;

  v_start_seq := v_end_seq - v_safe_count + 1;

  INSERT INTO public.smav_bill_number_batches (
    outlet_id, branch_id, branch_code, branch_name, billing_date, device_id,
    bill_prefix, start_sequence, end_sequence, allocated_count, status, allocated_by, expires_at
  )
  VALUES (
    p_outlet_id, v_branch.id, v_branch.branch_code, v_branch.branch_name, v_billing_date, v_clean_device,
    v_clean_prefix, v_start_seq, v_end_seq, v_safe_count, 'ACTIVE', p_allocated_by, v_expires_at
  )
  RETURNING id INTO v_batch_id;

  FOR v_seq IN v_start_seq..v_end_seq LOOP
    v_bill_no := v_clean_prefix || '-' || v_branch.branch_code || '-' || v_date_str || '-' || lpad(v_seq::text, 4, '0');
    v_idem := 'PREALLOC_' || v_bill_no || '_' || right(regexp_replace(v_clean_device, '[^A-Za-z0-9]', '', 'g'), 12);

    INSERT INTO public.smav_central_bill_numbers (
      central_bill_number, outlet_id, branch_id, branch_code, branch_name,
      billing_date, sequence_number, source_system, status, idempotency_key,
      device_id, batch_id, created_by
    )
    VALUES (
      v_bill_no, p_outlet_id, v_branch.id, v_branch.branch_code, v_branch.branch_name,
      v_billing_date, v_seq, 'smav_android_agent', 'PREALLOCATED', v_idem,
      v_clean_device, v_batch_id, p_allocated_by
    )
    RETURNING * INTO v_row;

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

-- 12. Atomic RPC #3: Finalize a reserved or preallocated central bill number
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
  branch_id uuid,
  branch_code text,
  branch_name text,
  status text,
  finalized_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean_no text := upper(btrim(coalesce(p_central_bill_number, '')));
  v_row public.smav_central_bill_numbers%ROWTYPE;
BEGIN
  SELECT * INTO v_row
  FROM public.smav_central_bill_numbers c
  WHERE c.outlet_id = p_outlet_id
    AND (
      (v_clean_no <> '' AND upper(c.central_bill_number) = v_clean_no)
      OR (p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' AND c.idempotency_key = btrim(p_idempotency_key))
    )
  FOR UPDATE
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CENTRAL_BILL_NOT_FOUND: Central bill number "%" was not reserved for this outlet.', v_clean_no;
  END IF;

  IF v_row.status = 'VOIDED' THEN
    RAISE EXCEPTION 'CENTRAL_BILL_VOIDED: Central bill number "%" is already voided.', v_row.central_bill_number;
  END IF;

  UPDATE public.smav_central_bill_numbers c
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
  RETURNING * INTO v_row;

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

-- Restrict direct public execution of security-definer RPCs; invoke via server-side service_role
REVOKE ALL ON FUNCTION public.smav_reserve_central_bill_number(uuid, text, text, text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.smav_allocate_bill_number_range(uuid, text, text, integer, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.smav_finalize_central_bill_number(uuid, text, text, text, text, text) FROM PUBLIC;

-- 13. Non-destructive Reconciliation View for duplicate/missing bill numbers
CREATE OR REPLACE VIEW public.smav_bill_number_reconciliation_v AS
SELECT
  sb.outlet_id,
  sb.id AS bill_id,
  sb.bill_number,
  sb.central_bill_id,
  sb.central_bill_number,
  sb.branch_code,
  sb.branch_name,
  sb.source_system,
  sb.created_at,
  CASE
    WHEN sb.central_bill_number IS NULL AND sb.bill_number ~ '^TGL-(GACHI|KONDA)-[0-9]{8}-[0-9]{4}$' THEN 'UNLINKED_TGL_FORMAT'
    WHEN sb.central_bill_number IS NULL THEN 'LEGACY_HISTORICAL'
    WHEN sb.central_bill_number <> sb.bill_number THEN 'MISMATCHED_BILL_NUMBER'
    ELSE 'LINKED_OK'
  END AS reconciliation_status
FROM public.smav_salon_bills sb;

COMMIT;
