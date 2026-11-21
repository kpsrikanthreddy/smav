-- Controlled backdated central bill-number reservation.
-- Adds a 9-argument overload; the prior 8-argument function remains intact for existing clients.
-- New bill numbers are sequenced by (outlet, branch, selected IST billing date).

BEGIN;

DROP FUNCTION IF EXISTS public.smav_reserve_central_bill_number(uuid, text, text, text, uuid, text, text, text, date);

CREATE FUNCTION public.smav_reserve_central_bill_number(
  p_outlet_id uuid,
  p_branch_code text,
  p_idempotency_key text,
  p_source_system text,
  p_created_by uuid DEFAULT NULL,
  p_device_id text DEFAULT NULL,
  p_bill_prefix text DEFAULT 'TGL',
  p_branch_id text DEFAULT NULL,
  p_billing_date date DEFAULT NULL
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
  v_billing_date date := coalesce(p_billing_date, (now() AT TIME ZONE 'Asia/Kolkata')::date);
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_date_str text;
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
  IF v_billing_date > v_today THEN
    RAISE EXCEPTION 'INVALID_BILLING_DATE: billing_date cannot be in the future.';
  END IF;
  v_date_str := to_char(v_billing_date, 'YYYYMMDD');

  SELECT c.* INTO v_existing
  FROM public.smav_central_bill_numbers AS c
  WHERE c.idempotency_key = v_clean_idem
  LIMIT 1;
  IF FOUND THEN
    IF v_existing.outlet_id IS DISTINCT FROM p_outlet_id THEN
      RAISE EXCEPTION 'OUTLET_MISMATCH: Idempotency key belongs to another outlet.';
    END IF;
    RETURN QUERY SELECT v_existing.id, v_existing.central_bill_number, v_existing.outlet_id,
      v_existing.branch_id, v_existing.branch_code, v_existing.branch_name, v_existing.billing_date,
      v_existing.sequence_number, v_existing.source_system, v_existing.status, v_existing.idempotency_key,
      v_existing.generated_at, true;
    RETURN;
  END IF;

  SELECT b.* INTO v_branch
  FROM public.smav_branches AS b
  WHERE b.outlet_id = p_outlet_id AND b.is_active = true
    AND ((v_clean_branch_id <> '' AND b.id = v_clean_branch_id)
      OR (v_clean_branch_id = '' AND upper(btrim(b.branch_code)) = v_clean_branch_code))
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_BRANCH: Branch "%" is not configured or active for this outlet.',
      coalesce(nullif(v_clean_branch_id, ''), v_clean_branch_code);
  END IF;
  v_clean_prefix := upper(coalesce(nullif(btrim(v_branch.bill_prefix), ''), v_clean_prefix));

  PERFORM pg_advisory_xact_lock(hashtext(p_outlet_id::text || ':' || v_branch.branch_code || ':' || v_date_str));

  SELECT c.* INTO v_existing
  FROM public.smav_central_bill_numbers AS c
  WHERE c.idempotency_key = v_clean_idem
  LIMIT 1;
  IF FOUND THEN
    IF v_existing.outlet_id IS DISTINCT FROM p_outlet_id THEN
      RAISE EXCEPTION 'OUTLET_MISMATCH: Idempotency key belongs to another outlet.';
    END IF;
    RETURN QUERY SELECT v_existing.id, v_existing.central_bill_number, v_existing.outlet_id,
      v_existing.branch_id, v_existing.branch_code, v_existing.branch_name, v_existing.billing_date,
      v_existing.sequence_number, v_existing.source_system, v_existing.status, v_existing.idempotency_key,
      v_existing.generated_at, true;
    RETURN;
  END IF;

  SELECT coalesce(max(CASE WHEN split_part(sb.bill_number, '-', 4) ~ '^[0-9]+$'
    THEN split_part(sb.bill_number, '-', 4)::integer ELSE 0 END), 0)
  INTO v_seed_bills_seq
  FROM public.smav_salon_bills AS sb
  WHERE sb.outlet_id = p_outlet_id
    AND sb.bill_number LIKE (v_clean_prefix || '-' || v_branch.branch_code || '-' || v_date_str || '-%');

  SELECT coalesce(max(cn.sequence_number), 0)
  INTO v_seed_central_seq
  FROM public.smav_central_bill_numbers AS cn
  WHERE cn.outlet_id = p_outlet_id
    AND cn.branch_code = v_branch.branch_code
    AND cn.billing_date = v_billing_date;
  v_seed_seq := greatest(v_seed_bills_seq, v_seed_central_seq);

  INSERT INTO public.smav_bill_number_counters AS cnt (
    outlet_id, branch_id, branch_code, billing_date, last_sequence, updated_at
  ) VALUES (
    p_outlet_id, v_branch.id, v_branch.branch_code, v_billing_date, v_seed_seq + 1, now()
  )
  ON CONFLICT ON CONSTRAINT smav_bill_number_counters_pkey DO UPDATE
    SET last_sequence = greatest(cnt.last_sequence, v_seed_seq) + 1,
        branch_id = v_branch.id,
        updated_at = now()
  RETURNING cnt.last_sequence INTO v_next_seq;

  v_bill_no := v_clean_prefix || '-' || v_branch.branch_code || '-' || v_date_str || '-' || lpad(v_next_seq::text, 4, '0');

  INSERT INTO public.smav_central_bill_numbers AS c (
    central_bill_number, outlet_id, branch_id, branch_code, branch_name, billing_date,
    sequence_number, source_system, status, idempotency_key, device_id, created_by
  ) VALUES (
    v_bill_no, p_outlet_id, v_branch.id, v_branch.branch_code, v_branch.branch_name, v_billing_date,
    v_next_seq, v_clean_source, 'RESERVED', v_clean_idem,
    nullif(btrim(coalesce(p_device_id, '')), ''), p_created_by
  ) RETURNING c.* INTO v_inserted;

  RETURN QUERY SELECT v_inserted.id, v_inserted.central_bill_number, v_inserted.outlet_id,
    v_inserted.branch_id, v_inserted.branch_code, v_inserted.branch_name, v_inserted.billing_date,
    v_inserted.sequence_number, v_inserted.source_system, v_inserted.status, v_inserted.idempotency_key,
    v_inserted.generated_at, false;
END;
$$;

REVOKE ALL ON FUNCTION public.smav_reserve_central_bill_number(uuid, text, text, text, uuid, text, text, text, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.smav_reserve_central_bill_number(uuid, text, text, text, uuid, text, text, text, date)
  TO service_role;

COMMIT;
