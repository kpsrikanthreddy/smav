-- ==============================================================================
-- Migration: 012_unified_user_sync_and_outbox.sql
-- Target Database: CENTRAL SMAV Supabase (qykdwswatopylzvqhgog)
--
-- Purpose:
--   1. Adds idempotent sync metadata columns to public.smav_external_identities.
--   2. Creates public.smav_sync_outbox for guaranteed two-system confirmation
--      (Central SMAV + Target Outlet DB), retry tracking, and conflict logging.
--   3. Enforces strict RLS: writes strictly via service_role; read-only inspection
--      for SUPERADMIN and assigned active outlet ADMINs.
--   4. Preserves ALL existing users, UUIDs, outlet roles, triggers, RLS, and bills.
-- ==============================================================================

BEGIN;

-- 1. Additive sync metadata columns on smav_external_identities (zero data changes)
ALTER TABLE public.smav_external_identities
  ADD COLUMN IF NOT EXISTS sync_version bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS sync_origin text DEFAULT 'central';

-- 2. Durable Idempotent Sync Outbox Table (never stores plaintext passwords)
CREATE TABLE IF NOT EXISTS public.smav_sync_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  operation_id text NOT NULL,
  sync_origin text NOT NULL CHECK (sync_origin IN ('outlet_admin', 'smav_portal', 'outbox_retry')),
  action text NOT NULL CHECK (action IN ('upsert_user', 'update_user', 'reset_password', 'set_status')),
  outlet_id uuid REFERENCES public.smav_outlets(id) ON DELETE SET NULL,
  outlet_code text NOT NULL,
  target_user_id uuid,
  external_staff_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  central_confirmed boolean NOT NULL DEFAULT false,
  outlet_confirmed boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PARTIAL_CENTRAL_ONLY', 'PARTIAL_OUTLET_ONLY', 'SYNCED', 'CONFLICT', 'FAILED')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  next_retry_at timestamptz,
  last_error text,
  conflict_details jsonb,
  sync_version bigint NOT NULL DEFAULT 1,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_smav_sync_outbox_outlet_status
  ON public.smav_sync_outbox(outlet_code, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_smav_sync_outbox_target_user
  ON public.smav_sync_outbox(target_user_id);

CREATE INDEX IF NOT EXISTS idx_smav_sync_outbox_retry_queue
  ON public.smav_sync_outbox(next_retry_at)
  WHERE status IN ('PENDING', 'PARTIAL_CENTRAL_ONLY', 'PARTIAL_OUTLET_ONLY');

-- 3. Strict Privilege & RLS Hardening on smav_sync_outbox
ALTER TABLE public.smav_sync_outbox ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.smav_sync_outbox FROM anon, authenticated;
GRANT SELECT ON public.smav_sync_outbox TO authenticated;

DROP POLICY IF EXISTS "smav_sync_outbox_select" ON public.smav_sync_outbox;
CREATE POLICY "smav_sync_outbox_select" ON public.smav_sync_outbox
  FOR SELECT TO authenticated
  USING (
    (SELECT public.smav_is_superadmin())
    OR (
      outlet_id IS NOT NULL
      AND (SELECT public.smav_is_outlet_admin(outlet_id))
    )
  );

-- 4. Guard updated_at timestamp automatically
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

DROP TRIGGER IF EXISTS trg_smav_sync_outbox_touch ON public.smav_sync_outbox;
CREATE TRIGGER trg_smav_sync_outbox_touch
  BEFORE UPDATE ON public.smav_sync_outbox
  FOR EACH ROW
  EXECUTE FUNCTION public.smav_touch_updated_at();

COMMIT;
