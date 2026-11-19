-- =============================================================================
-- Migration 017 (SCHEMA ONLY): Central Identity Sync & Durable Outbox Indexes
-- Target DB: Central SMAV Supabase (https://qykdwswatopylzvqhgog.supabase.co)
--
-- Safety Guarantees:
--   1. Strictly additive DDL only (CREATE INDEX IF NOT EXISTS).
--   2. ZERO INSERT / UPDATE / DELETE / DROP / ALTER TABLE statements.
--   3. Guarded against schema drift using information_schema column checks so
--      it is safe to re-run and will never fail on missing optional columns.
--   4. Does NOT touch auth.users, smav_profiles, smav_user_outlet_roles, or
--      any existing logins, sessions, bills, or audit logs.
--
-- Companion files (run separately):
--   - Read-only audits: database/audits/017_glossylooks_identity_audit_readonly.sql
--   - Manual data reconciliation (only after reviewing audit output):
--     database/reconciliation/017_glossylooks_identity_reconciliation_manual.sql
-- =============================================================================

BEGIN;

-- 1. Composite indexes on public.smav_sync_outbox for durable DB hydration,
--    post-restart retry lookup, and automatic superseding of stale pending rows
DO $$
BEGIN
  IF to_regclass('public.smav_sync_outbox') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_smav_sync_outbox_outlet_user_status
      ON public.smav_sync_outbox (outlet_code, target_user_id, status);

    CREATE INDEX IF NOT EXISTS idx_smav_sync_outbox_outlet_extstaff_status
      ON public.smav_sync_outbox (outlet_code, external_staff_id, status)
      WHERE external_staff_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_smav_sync_outbox_pending_retry
      ON public.smav_sync_outbox (status, next_retry_at)
      WHERE status IN ('PENDING', 'PARTIAL_CENTRAL_ONLY', 'PARTIAL_OUTLET_ONLY');
  END IF;
END $$;

-- 2. Lookup indexes on public.smav_external_identities using verified production
--    columns: (source, external_id, auth_user_id, email)
DO $$
BEGIN
  IF to_regclass('public.smav_external_identities') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'smav_external_identities'
        AND column_name = 'source'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'smav_external_identities'
        AND column_name = 'external_id'
    ) THEN
      CREATE INDEX IF NOT EXISTS idx_smav_external_identities_source_external_id
        ON public.smav_external_identities (source, external_id);
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'smav_external_identities'
        AND column_name = 'auth_user_id'
    ) THEN
      CREATE INDEX IF NOT EXISTS idx_smav_external_identities_auth_user_id
        ON public.smav_external_identities (auth_user_id);
    END IF;
  END IF;
END $$;

COMMIT;
