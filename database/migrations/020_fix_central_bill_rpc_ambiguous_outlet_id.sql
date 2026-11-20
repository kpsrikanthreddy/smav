-- =============================================================================
-- Migration 020: Fix Ambiguous "outlet_id" Column Reference in Central Bill RPCs
-- =============================================================================
-- Strictly non-destructive function-only update (CREATE OR REPLACE FUNCTION).
-- - Does NOT drop or alter any tables, bills, counters, branches, or data.
-- - Fixes PostgreSQL ERROR 42702: column reference "outlet_id" is ambiguous
--   caused by RETURNS TABLE output column names colliding with unqualified
--   ON CONFLICT (outlet_id, branch_code, billing_date) clauses inside:
--     1) public.smav_reserve_central_bill_number
--     2) public.smav_allocate_bill_number_range
--     3) public.smav_finalize_central_bill_number
-- - Run manually in Central SMAV Supabase SQL Editor.
-- =============================================================================

BEGIN;

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
#variable_conflict use_column
DECLARE
  v_clean_branch text := upper(btrim(coalesce(p_branch_code, '')));
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

  -- Validate branch exists and is active for the outlet
  SELECT b.* INTO v_branch
  FROM public.smav_branches AS b
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

  -- Seed counter safely from any pre-migration bills or existing central numbers for this branch+date
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
    branch_code,
    billing_date,
    last_sequence,
    updated_at
  )
  VALUES (
    p_outlet_id,
    v_branch.branch_code,
    v_billing_date,
    v_seed_seq + 1,
    now()
  )
  ON CONFLICT ON CONSTRAINT smav_bill_number_counters_pkey DO UPDATE
    SET last_sequence = GREATEST(cnt.last_sequence, v_seed_seq) + 1,
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
#variable_conflict use_column
DECLARE
  v_clean_branch text := upper(btrim(coalesce(p_branch_code, '')));
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
  IF v_clean_branch = '' THEN
    RAISE EXCEPTION 'BRANCH_REQUIRED: branch_code is required to allocate an offline range.';
  END IF;
  IF v_clean_device = '' THEN
    RAISE EXCEPTION 'DEVICE_ID_REQUIRED: device_id is required to allocate an offline range.';
  END IF;

  SELECT b.* INTO v_branch
  FROM public.smav_branches AS b
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
    branch_code,
    billing_date,
    last_sequence,
    updated_at
  )
  VALUES (
    p_outlet_id,
    v_branch.branch_code,
    v_billing_date,
    v_seed_seq + v_safe_count,
    now()
  )
  ON CONFLICT ON CONSTRAINT smav_bill_number_counters_pkey DO UPDATE
    SET last_sequence = GREATEST(cnt.last_sequence, v_seed_seq) + v_safe_count,
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

REVOKE ALL ON FUNCTION public.smav_reserve_central_bill_number(uuid, text, text, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.smav_allocate_bill_number_range(uuid, text, text, integer, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.smav_finalize_central_bill_number(uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.smav_reserve_central_bill_number(uuid, text, text, text, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.smav_allocate_bill_number_range(uuid, text, text, integer, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.smav_finalize_central_bill_number(uuid, text, text, text, text, text) TO service_role;

COMMIT;
