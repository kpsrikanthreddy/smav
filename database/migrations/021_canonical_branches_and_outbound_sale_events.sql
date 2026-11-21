-- =============================================================================
-- Migration 021: Canonical GlossyLooks Branches & Durable Outbound Sale Events
-- =============================================================================
-- Strictly non-destructive, additive migration.
-- 1. Deactivates any non-canonical GlossyLooks rows in public.smav_branches
--    (e.g., GACHIBOWLI, KONDAPUR, GCB-01, KND-02) without deleting rows that
--    historical bills might reference, and upserts the exact two active branches:
--      - GACHI  / Gachibowli -> external_branch_id = 'tgl-gachi'
--      - KONDA  / Kondapur   -> external_branch_id = 'tgl-konda'
-- 2. Creates public.smav_outbound_sale_events for durable, retryable
--    `central_bill_finalized` webhook delivery from SMAV to GlossyLooks.
-- 3. Creates atomic claim RPC public.smav_claim_due_outbound_sale_events.
-- Run manually in Central SMAV Supabase SQL Editor.
-- =============================================================================

BEGIN;

-- 1. Canonicalize GlossyLooks rows in public.smav_branches (sole POS branch source)
UPDATE public.smav_branches AS b
SET is_active = false,
    updated_at = now()
FROM public.smav_outlets AS o
WHERE b.outlet_id = o.id
  AND lower(coalesce(o.outlet_code, o.code, '')) = 'glossylooks'
  AND upper(btrim(b.branch_code)) NOT IN ('GACHI', 'KONDA');

INSERT INTO public.smav_branches (
  outlet_id,
  branch_code,
  branch_name,
  external_branch_id,
  bill_prefix,
  is_active,
  metadata
)
SELECT
  o.id,
  v.branch_code,
  v.branch_name,
  v.external_branch_id,
  'TGL',
  true,
  jsonb_build_object(
    'whatsapp_line', '9966970003 (G)  9154744608 (K)',
    'timezone', 'Asia/Kolkata',
    'local_branch_id', v.external_branch_id
  )
FROM public.smav_outlets AS o
CROSS JOIN (
  VALUES
    ('GACHI', 'Gachibowli', 'tgl-gachi'),
    ('KONDA', 'Kondapur', 'tgl-konda')
) AS v(branch_code, branch_name, external_branch_id)
WHERE lower(coalesce(o.outlet_code, o.code, '')) = 'glossylooks'
ON CONFLICT (outlet_id, branch_code) DO UPDATE
  SET branch_name = EXCLUDED.branch_name,
      external_branch_id = EXCLUDED.external_branch_id,
      bill_prefix = 'TGL',
      is_active = true,
      metadata = coalesce(public.smav_branches.metadata, '{}'::jsonb) || EXCLUDED.metadata,
      updated_at = now();

-- 2. Durable outbound finalized-sale event queue (SMAV -> GlossyLooks Payment Ledger)
CREATE TABLE IF NOT EXISTS public.smav_outbound_sale_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id uuid NOT NULL REFERENCES public.smav_outlets(id) ON DELETE CASCADE,
  outlet_code text NOT NULL,
  event_type text NOT NULL DEFAULT 'central_bill_finalized'
    CHECK (event_type IN ('central_bill_finalized')),
  idempotency_key text NOT NULL,
  central_bill_id uuid REFERENCES public.smav_central_bill_numbers(id),
  central_bill_number text NOT NULL,
  local_bill_id text,
  branch_code text NOT NULL,
  branch_name text NOT NULL,
  target_url text NOT NULL CHECK (target_url ~ '^https://'),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'delivered', 'acknowledged', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 8 CHECK (max_attempts >= 1),
  next_retry_at timestamptz NOT NULL DEFAULT now(),
  last_http_status integer,
  last_error text,
  response_summary jsonb,
  sent_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_smav_outbound_sale_event_idem UNIQUE (outlet_id, event_type, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_smav_outbound_sale_events_due
  ON public.smav_outbound_sale_events (status, next_retry_at ASC)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS idx_smav_outbound_sale_events_outlet_created
  ON public.smav_outbound_sale_events (outlet_id, created_at DESC);

ALTER TABLE public.smav_outbound_sale_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.smav_outbound_sale_events FROM anon, authenticated;

-- 3. Atomic claim RPC for durable outbound sale event delivery & retry
CREATE OR REPLACE FUNCTION public.smav_claim_due_outbound_sale_events(p_limit integer DEFAULT 20)
RETURNS SETOF public.smav_outbound_sale_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required';
  END IF;

  RETURN QUERY
  WITH claimed AS (
    SELECT e.id
    FROM public.smav_outbound_sale_events AS e
    WHERE (
      (e.status IN ('pending', 'failed') AND e.next_retry_at <= now() AND e.attempts < e.max_attempts)
      OR (e.status = 'processing' AND e.updated_at <= now() - interval '5 minutes' AND e.attempts < e.max_attempts)
    )
    ORDER BY e.next_retry_at ASC, e.created_at ASC
    LIMIT LEAST(GREATEST(coalesce(p_limit, 20), 1), 50)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.smav_outbound_sale_events AS e
  SET status = 'processing',
      attempts = e.attempts + 1,
      updated_at = now()
  FROM claimed
  WHERE e.id = claimed.id
  RETURNING e.*;
END;
$$;

REVOKE ALL ON FUNCTION public.smav_claim_due_outbound_sale_events(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.smav_claim_due_outbound_sale_events(integer) TO service_role;

COMMIT;
