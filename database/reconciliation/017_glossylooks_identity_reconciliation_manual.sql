-- =============================================================================
-- MANUAL USER-DATA RECONCILIATION TEMPLATES (DO NOT RUN AUTOMATICALLY)
--
-- Prerequisites BEFORE executing ANY block below:
--   1. Deploy updated Edge Function `smav-identity-admin` and SMAV Cloud Run backend.
--   2. Run schema migration `database/migrations/017_central_identity_sync_reconciliation.sql`.
--   3. Run read-only audit `database/audits/017_glossylooks_identity_audit_readonly.sql`
--      in BOTH Central SMAV Supabase and Glossy Looks Supabase.
--   4. Take a manual Supabase backup / point-in-time snapshot first.
--
-- Safety Rules:
--   - ZERO DELETE statements.
--   - Preserves ALL existing Central Auth UUIDs, outlet assignments, billing
--     records (`smav_salon_bills`, `smav_central_sales`), and audit logs.
--   - Uses verified production column names on `smav_external_identities`:
--     `(source, external_id, auth_user_id, username, email)`.
-- =============================================================================


-- =============================================================================
-- TEMPLATE 1: RENUKA SAFE RELINK & DEACTIVATION (NO DELETION)
-- Target: Central SMAV Supabase (Step 1A via Edge Function, Step 1B SQL)
--         + Glossy Looks Supabase (Step 1C SQL)
-- =============================================================================
-- Known Central Auth records:
--   ORIGINAL  UUID: bc6a10a9-2bfe-4460-94b9-ddef5e8aa344 (renuka@glossylooks.in)
--   DUPLICATE UUID: c0e2945d-d5f0-43ef-989a-ca1ace82ec9a (srikanth1981k@gmail.com)
--
-- STEP 1A (Edge Function `smav-identity-admin` as SUPERADMIN JWT — staged email move):
--   1) Preflight (read-only):
--      POST /functions/v1/smav-identity-admin
--      { "action": "reconcile-renuka", "stage": "preflight" }
--
--   2) Release email from DUPLICATE UUID (only if preflight confirms safeForStagedEmailChange=true):
--      {
--        "action": "reconcile-renuka",
--        "stage": "release-email",
--        "confirm": "I_HAVE_BACKED_UP_AND_VERIFIED_RENUKA",
--        "temporaryEmail": "archived.renuka.dup.c0e2945d@glossylooks.in"
--      }
--
--   3) Assign target email onto ORIGINAL UUID:
--      {
--        "action": "reconcile-renuka",
--        "stage": "assign-email",
--        "confirm": "I_HAVE_BACKED_UP_AND_VERIFIED_RENUKA"
--      }
--
-- STEP 1B (Central SMAV SQL — link immutable Glossy Looks staff ID & mirror deactivated state):
--   Replace '<RENUKA_GLOSSYLOOKS_STAFF_ID>' with verified local ID from Audit Part B.
/*
BEGIN;

-- Upsert external identity mapping using verified production columns (source, external_id, auth_user_id)
UPDATE public.smav_external_identities
SET
  auth_user_id = 'bc6a10a9-2bfe-4460-94b9-ddef5e8aa344',
  email = 'srikanth1981k@gmail.com',
  last_synced_at = NOW(),
  sync_origin = 'manual_reconciliation'
WHERE source = 'glossylooks'
  AND external_id = '<RENUKA_GLOSSYLOOKS_STAFF_ID>';

INSERT INTO public.smav_external_identities (
  source,
  external_id,
  auth_user_id,
  username,
  email,
  sync_origin,
  last_synced_at
)
SELECT
  'glossylooks',
  '<RENUKA_GLOSSYLOOKS_STAFF_ID>',
  'bc6a10a9-2bfe-4460-94b9-ddef5e8aa344',
  'renuka',
  'srikanth1981k@gmail.com',
  'manual_reconciliation',
  NOW()
WHERE NOT EXISTS (
  SELECT 1
  FROM public.smav_external_identities
  WHERE source = 'glossylooks'
    AND external_id = '<RENUKA_GLOSSYLOOKS_STAFF_ID>'
);

-- Mirror Glossy Looks deactivated status cleanly (NO user deletion)
UPDATE public.smav_user_outlet_roles
SET is_active = FALSE
WHERE user_id IN (
    'bc6a10a9-2bfe-4460-94b9-ddef5e8aa344',
    'c0e2945d-d5f0-43ef-989a-ca1ace82ec9a'
  )
  AND outlet_id = '28467997-d316-482e-be93-258dd26e1340';

UPDATE public.smav_profiles
SET is_active = FALSE
WHERE id IN (
  'bc6a10a9-2bfe-4460-94b9-ddef5e8aa344',
  'c0e2945d-d5f0-43ef-989a-ca1ace82ec9a'
)
AND UPPER(COALESCE(platform_role, 'USER')) <> 'SUPERADMIN';

COMMIT;
*/

-- STEP 1C (Glossy Looks Supabase DB — https://onswigwiwuvkvoduuhxr.supabase.co):
--   Link Renuka's local staff row to ORIGINAL Central Auth UUID so future email edits succeed:
/*
UPDATE public.staff
SET
  central_auth_id = 'bc6a10a9-2bfe-4460-94b9-ddef5e8aa344',
  central_auth_status = 'DISABLED',
  central_auth_linked_at = NOW()
WHERE id = '<RENUKA_GLOSSYLOOKS_STAFF_ID>';
*/


-- =============================================================================
-- TEMPLATE 2: RESTORE MISSING OWNER & SHARADHA OUTLET ASSIGNMENTS IN SMAV
-- =============================================================================
-- Preferred path: Once Glossy Looks backend integration is deployed, trigger
-- `POST /api/integrations/glossylooks/users/sync` for Owner & Sharadha.
--
-- Manual SQL fallback (Central SMAV Supabase) ONLY if both users already exist
-- in `auth.users` (verify UUIDs from Audit A1 first):
--   - OWNER / MANAGER        -> role = 'ADMIN'
--   - STYLIST / RECEPTIONIST -> role = 'STAFF' (displayed as POS_BILLING)
/*
BEGIN;

INSERT INTO public.smav_user_outlet_roles (user_id, outlet_id, role, is_active)
VALUES
  ('<OWNER_CENTRAL_AUTH_UUID>',    '28467997-d316-482e-be93-258dd26e1340', 'ADMIN', TRUE),
  ('<SHARADHA_CENTRAL_AUTH_UUID>', '28467997-d316-482e-be93-258dd26e1340', '<ADMIN_OR_STAFF>', TRUE)
ON CONFLICT (user_id, outlet_id)
DO UPDATE SET
  role = EXCLUDED.role,
  is_active = EXCLUDED.is_active;

COMMIT;
*/


-- =============================================================================
-- TEMPLATE 3: RESOLVE MADU MOUNIKA'S STALE PENDING OUTBOX ROW
-- =============================================================================
-- Preferred path:
--   Option A (Automatic): Send an authoritative sync from Glossy Looks for Madu Mounika
--     -> `OutletUserSyncCoordinator` automatically supersedes stale pending rows to SYNCED.
--   Option B (SMAV UI): Click "Resolve Stale" as SUPERADMIN in PortalAuthDashboard -> Sync Outbox
--     (records `SUPERADMIN_OUTBOX_ITEM_RESOLVED` in audit logs).
--
-- Manual SQL fallback (Central SMAV Supabase) — inspect Audit A4 first and replace '<OUTBOX_ROW_UUID>':
/*
BEGIN;

UPDATE public.smav_sync_outbox
SET
  status = 'SYNCED',
  central_confirmed = TRUE,
  outlet_confirmed = TRUE,
  next_retry_at = NULL,
  last_error = NULL,
  conflict_details = COALESCE(conflict_details, '{}'::jsonb) || jsonb_build_object(
    'resolvedManuallyAt', NOW(),
    'note', 'Reconciled stale PARTIAL_CENTRAL_ONLY outbox row after verifying authoritative Glossy Looks link.'
  )
WHERE id = '<OUTBOX_ROW_UUID>'
  AND LOWER(outlet_code) = 'glossylooks'
  AND status IN ('PENDING', 'PARTIAL_CENTRAL_ONLY', 'FAILED');

COMMIT;
*/
