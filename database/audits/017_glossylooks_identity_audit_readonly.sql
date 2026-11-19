-- =============================================================================
-- READ-ONLY AUDIT & VERIFICATION QUERIES (ZERO DATA MODIFICATIONS)
--
-- Contains SELECT-only queries to compare all 8 Glossy Looks users across:
--   A. Central SMAV Supabase (https://qykdwswatopylzvqhgog.supabase.co)
--   B. Glossy Looks Supabase (https://onswigwiwuvkvoduuhxr.supabase.co)
--
-- Safe to run at any time before AND after deployment.
-- =============================================================================


-- =============================================================================
-- PART A: RUN IN CENTRAL SMAV SUPABASE (qykdwswatopylzvqhgog)
-- =============================================================================

-- A1. All Central Auth users linked to Glossy Looks, matching @glossylooks.in,
--     or matching Renuka's original/duplicate UUIDs (for side-by-side 8-user diff)
SELECT
  u.id AS central_auth_uuid,
  u.email AS auth_email,
  u.email_confirmed_at IS NOT NULL AS email_confirmed,
  u.banned_until,
  (u.banned_until IS NOT NULL AND u.banned_until > NOW()) AS is_auth_banned,
  u.last_sign_in_at,
  p.full_name,
  p.platform_role,
  p.is_active AS profile_is_active,
  r.role AS glossy_outlet_role,
  CASE
    WHEN UPPER(COALESCE(r.role, '')) = 'ADMIN' THEN 'ADMIN'
    WHEN r.role IS NOT NULL THEN 'POS_BILLING'
    ELSE 'MISSING_OUTLET_ROLE'
  END AS smav_display_role,
  r.is_active AS glossy_outlet_role_active,
  ei.source AS ext_source,
  ei.external_id AS external_staff_id,
  ei.username AS ext_username,
  ei.email AS ext_email,
  ei.last_synced_at,
  ei.sync_origin
FROM auth.users u
LEFT JOIN public.smav_profiles p
  ON p.id = u.id
LEFT JOIN public.smav_user_outlet_roles r
  ON r.user_id = u.id
  AND r.outlet_id = '28467997-d316-482e-be93-258dd26e1340'
LEFT JOIN public.smav_external_identities ei
  ON ei.auth_user_id = u.id
  AND LOWER(COALESCE(ei.source, '')) = 'glossylooks'
WHERE r.outlet_id IS NOT NULL
   OR ei.auth_user_id IS NOT NULL
   OR LOWER(COALESCE(u.email, '')) LIKE '%glossylooks%'
   OR LOWER(COALESCE(p.full_name, '')) LIKE '%renuka%'
   OR LOWER(COALESCE(p.full_name, '')) LIKE '%sharadha%'
   OR LOWER(COALESCE(p.full_name, '')) LIKE '%mounika%'
   OR u.id IN (
     'bc6a10a9-2bfe-4460-94b9-ddef5e8aa344', -- Renuka ORIGINAL
     'c0e2945d-d5f0-43ef-989a-ca1ace82ec9a'  -- Renuka DUPLICATE
   )
ORDER BY
  CASE WHEN r.outlet_id IS NOT NULL THEN 0 ELSE 1 END,
  p.full_name NULLS LAST,
  u.email;


-- A2. Focused READ-ONLY dependency audit of BOTH Renuka UUIDs
--     (Checks auth.users, smav_profiles, ALL outlet memberships, external identities,
--      identity links, salon bills, central sales, audit logs, and sync outbox)
WITH renuka_ids(label, uid) AS (
  VALUES
    ('ORIGINAL_RENUKA',  'bc6a10a9-2bfe-4460-94b9-ddef5e8aa344'::uuid),
    ('DUPLICATE_RENUKA', 'c0e2945d-d5f0-43ef-989a-ca1ace82ec9a'::uuid)
)
SELECT
  ri.label,
  ri.uid AS central_auth_uuid,
  u.email AS auth_email,
  u.created_at AS auth_created_at,
  u.last_sign_in_at,
  u.banned_until,
  p.full_name,
  p.platform_role,
  p.is_active AS profile_is_active,
  (
    SELECT jsonb_agg(jsonb_build_object(
      'outlet_id', r.outlet_id,
      'outlet_code', COALESCE(o.code, o.outlet_code),
      'role', r.role,
      'is_active', r.is_active
    ))
    FROM public.smav_user_outlet_roles r
    LEFT JOIN public.smav_outlets o ON o.id = r.outlet_id
    WHERE r.user_id = ri.uid
  ) AS outlet_memberships,
  (
    SELECT jsonb_agg(jsonb_build_object(
      'source', ei.source,
      'external_id', ei.external_id,
      'username', ei.username,
      'email', ei.email
    ))
    FROM public.smav_external_identities ei
    WHERE ei.auth_user_id = ri.uid
  ) AS external_identities,
  (SELECT COUNT(*) FROM public.smav_salon_bills b WHERE b.created_by = ri.uid) AS salon_bills_created,
  (SELECT COUNT(*) FROM public.smav_audit_logs a WHERE a.actor_user_id = ri.uid) AS audit_logs_as_actor,
  (SELECT COUNT(*) FROM public.smav_sync_outbox so WHERE so.target_user_id = ri.uid) AS outbox_rows
FROM renuka_ids ri
LEFT JOIN auth.users u ON u.id = ri.uid
LEFT JOIN public.smav_profiles p ON p.id = ri.uid;


-- A3. Check smav_identity_links (if table exists in Central Supabase) for both Renuka UUIDs
SELECT *
FROM public.smav_identity_links
WHERE smav_user_id IN (
  'bc6a10a9-2bfe-4460-94b9-ddef5e8aa344',
  'c0e2945d-d5f0-43ef-989a-ca1ace82ec9a'
);


-- A4. Inspect ALL Glossy Looks sync outbox entries (specifically Madu Mounika's stale row)
SELECT
  id AS outbox_id,
  idempotency_key,
  action,
  sync_origin,
  outlet_code,
  target_user_id,
  external_staff_id,
  status,
  central_confirmed,
  outlet_confirmed,
  attempts,
  max_attempts,
  next_retry_at,
  last_error,
  payload->>'fullName' AS payload_full_name,
  payload->>'email' AS payload_email,
  payload->>'role' AS payload_role,
  created_at,
  updated_at
FROM public.smav_sync_outbox
WHERE LOWER(outlet_code) = 'glossylooks'
ORDER BY
  CASE WHEN status <> 'SYNCED' THEN 0 ELSE 1 END,
  updated_at DESC
LIMIT 50;


-- A5. Verify migration 017 additive indexes exist after deployment
SELECT
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('smav_sync_outbox', 'smav_external_identities')
ORDER BY tablename, indexname;


-- A6. Post-reconciliation count check (Target: all 8 Glossy Looks users represented,
--     0 stale non-SYNCED outbox items, active count matches Glossy Looks active count)
SELECT
  COUNT(*) AS total_glossylooks_roles,
  COUNT(*) FILTER (WHERE r.is_active = TRUE) AS active_glossylooks_roles,
  COUNT(*) FILTER (WHERE r.is_active = FALSE) AS inactive_glossylooks_roles,
  COUNT(*) FILTER (WHERE UPPER(r.role) = 'ADMIN') AS admin_count,
  COUNT(*) FILTER (WHERE UPPER(r.role) = 'STAFF') AS pos_billing_count
FROM public.smav_user_outlet_roles r
WHERE r.outlet_id = '28467997-d316-482e-be93-258dd26e1340';


-- =============================================================================
-- PART B: RUN IN GLOSSY LOOKS SUPABASE (onswigwiwuvkvoduuhxr)
-- =============================================================================
-- Copy and execute ONLY Part B inside the Glossy Looks Supabase SQL Editor
-- (https://onswigwiwuvkvoduuhxr.supabase.co) to export all 8 authoritative users.

/*
-- B1. Inspect authoritative Glossy Looks staff / user records (adjust table name if `users` vs `staff`)
SELECT
  id AS local_staff_id,
  name,
  email,
  role AS glossylooks_role,
  CASE
    WHEN UPPER(COALESCE(role, '')) IN ('OWNER', 'DIRECTOR', 'FOUNDER', 'MANAGER', 'ADMIN') THEN 'ADMIN'
    ELSE 'POS_BILLING (DB: STAFF)'
  END AS expected_smav_role,
  is_active,
  central_auth_id,
  central_auth_status,
  central_auth_linked_at
FROM public.staff
ORDER BY is_active DESC, role, name;

-- B2. If Glossy Looks also stores login users in public.users / public.profiles, inspect those too:
SELECT * FROM public.vw_smav_staff_auth_status ORDER BY is_active DESC, name;
*/
