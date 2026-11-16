-- ==============================================================================
-- MOZZ / Starters4U Database: Central SMAV Auth Linkage Migration
-- Target Database: https://uyqdnqbadfysnbzbncyj.supabase.co (MOZZ / Starters4U)
--
-- Instructions:
-- Run this SQL in the SQL Editor of MOZZ / Starters4U Supabase project.
-- This migration PRESERVES all existing tables, menus, tables, orders,
-- staff, users, passwords, Central Auth UUIDs, POS data, and dependent
-- views/objects. Safe to rerun after partial execution.
-- ==============================================================================

BEGIN;

-- 1. Idempotently ensure Central SMAV Auth linkage columns exist
DO $$
BEGIN
  IF to_regclass('public.staff') IS NOT NULL THEN
    ALTER TABLE public.staff
      ADD COLUMN IF NOT EXISTS central_auth_id UUID,
      ADD COLUMN IF NOT EXISTS central_auth_status TEXT NOT NULL DEFAULT 'ACTIVE',
      ADD COLUMN IF NOT EXISTS central_auth_linked_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS central_outlet_code TEXT DEFAULT 'mozz';

    CREATE INDEX IF NOT EXISTS idx_mozz_staff_central_auth ON public.staff(central_auth_id);
  END IF;

  IF to_regclass('public.users') IS NOT NULL THEN
    ALTER TABLE public.users
      ADD COLUMN IF NOT EXISTS central_auth_id UUID,
      ADD COLUMN IF NOT EXISTS central_auth_status TEXT NOT NULL DEFAULT 'ACTIVE',
      ADD COLUMN IF NOT EXISTS central_auth_linked_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS central_outlet_code TEXT DEFAULT 'mozz';

    CREATE INDEX IF NOT EXISTS idx_mozz_users_central_auth ON public.users(central_auth_id);
  END IF;

  IF to_regclass('public.users') IS NULL AND to_regclass('public.staff') IS NULL THEN
    CREATE TABLE IF NOT EXISTS public.smav_staff_links (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'staff',
      is_active BOOLEAN NOT NULL DEFAULT true,
      central_auth_id UUID,
      central_auth_status TEXT NOT NULL DEFAULT 'ACTIVE',
      central_auth_linked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    ALTER TABLE public.smav_staff_links
      ADD COLUMN IF NOT EXISTS central_auth_id UUID,
      ADD COLUMN IF NOT EXISTS central_auth_status TEXT NOT NULL DEFAULT 'ACTIVE',
      ADD COLUMN IF NOT EXISTS central_auth_linked_at TIMESTAMPTZ;

    CREATE INDEX IF NOT EXISTS idx_smav_staff_links_central_auth ON public.smav_staff_links(central_auth_id);
  END IF;
END $$;

-- 2. Safely create or replace vw_smav_restaurant_staff_status using only actual
--    schema columns while preserving existing view column order/types and
--    dependent objects (avoids 42703 and 42P16)
DO $$
DECLARE
  v_source_table TEXT;
  v_alias TEXT;
  v_has_name BOOLEAN := false;
  v_has_full_name BOOLEAN := false;
  v_has_email BOOLEAN := false;
  v_has_username BOOLEAN := false;
  v_has_role BOOLEAN := false;
  v_has_is_active BOOLEAN := false;
  v_has_central_auth_id BOOLEAN := false;
  v_has_central_auth_status BOOLEAN := false;
  v_has_central_auth_linked_at BOOLEAN := false;
  v_has_central_sync_version BOOLEAN := false;
  v_has_central_last_synced_at BOOLEAN := false;

  v_view_exists BOOLEAN := false;
  v_can_replace BOOLEAN := true;
  v_select_items TEXT[] := ARRAY[]::TEXT[];
  v_expr TEXT;
  v_col RECORD;

  v_name_expr TEXT;
  v_is_active_expr TEXT;
  v_access_status_expr TEXT;
BEGIN
  IF to_regclass('public.users') IS NOT NULL THEN
    v_source_table := 'users';
    v_alias := 'u';
  ELSIF to_regclass('public.staff') IS NOT NULL THEN
    v_source_table := 'staff';
    v_alias := 's';
  ELSE
    v_source_table := 'smav_staff_links';
    v_alias := 'l';
  END IF;

  SELECT
    COALESCE(BOOL_OR(column_name = 'name'), false),
    COALESCE(BOOL_OR(column_name = 'full_name'), false),
    COALESCE(BOOL_OR(column_name = 'email'), false),
    COALESCE(BOOL_OR(column_name = 'username'), false),
    COALESCE(BOOL_OR(column_name = 'role'), false),
    COALESCE(BOOL_OR(column_name = 'is_active'), false),
    COALESCE(BOOL_OR(column_name = 'central_auth_id'), false),
    COALESCE(BOOL_OR(column_name = 'central_auth_status'), false),
    COALESCE(BOOL_OR(column_name = 'central_auth_linked_at'), false),
    COALESCE(BOOL_OR(column_name = 'central_sync_version'), false),
    COALESCE(BOOL_OR(column_name = 'central_last_synced_at'), false)
  INTO
    v_has_name,
    v_has_full_name,
    v_has_email,
    v_has_username,
    v_has_role,
    v_has_is_active,
    v_has_central_auth_id,
    v_has_central_auth_status,
    v_has_central_auth_linked_at,
    v_has_central_sync_version,
    v_has_central_last_synced_at
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = v_source_table;

  IF v_source_table = 'users' AND v_has_full_name THEN
    v_name_expr := CASE
      WHEN v_has_email THEN format('COALESCE(%I.full_name, %I.email)', v_alias, v_alias)
      ELSE format('%I.full_name', v_alias)
    END;
  ELSIF v_has_name THEN
    v_name_expr := CASE
      WHEN v_source_table = 'staff' AND v_has_email THEN format('COALESCE(%I.name, %I.email)', v_alias, v_alias)
      ELSE format('%I.name', v_alias)
    END;
  ELSIF v_has_full_name THEN
    v_name_expr := CASE
      WHEN v_has_email THEN format('COALESCE(%I.full_name, %I.email)', v_alias, v_alias)
      ELSE format('%I.full_name', v_alias)
    END;
  ELSIF v_has_email THEN
    v_name_expr := format('%I.email', v_alias);
  ELSE
    v_name_expr := 'NULL::text';
  END IF;

  v_is_active_expr := CASE
    WHEN v_has_is_active THEN format('COALESCE(%I.is_active, true)', v_alias)
    ELSE 'true'
  END;

  v_access_status_expr := CASE
    WHEN v_has_central_auth_id AND v_has_is_active THEN
      format(
        'CASE WHEN %I.central_auth_id IS NOT NULL AND COALESCE(%I.is_active, true) = true THEN ''SYNCED_READY'' WHEN %I.central_auth_id IS NOT NULL THEN ''DISABLED'' ELSE ''NEEDS_CENTRAL_SYNC'' END',
        v_alias, v_alias, v_alias
      )
    WHEN v_has_central_auth_id THEN
      format(
        'CASE WHEN %I.central_auth_id IS NOT NULL THEN ''SYNCED_READY'' ELSE ''NEEDS_CENTRAL_SYNC'' END',
        v_alias
      )
    ELSE
      '''NEEDS_CENTRAL_SYNC''::text'
  END;

  SELECT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'vw_smav_restaurant_staff_status'
      AND c.relkind = 'v'
  ) INTO v_view_exists;

  IF v_view_exists THEN
    -- Preserve exact existing column order, names, and data types so dependent objects remain intact
    FOR v_col IN
      SELECT
        a.attname::text AS col_name,
        pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'vw_smav_restaurant_staff_status'
        AND c.relkind = 'v'
        AND a.attnum > 0
        AND NOT a.attisdropped
      ORDER BY a.attnum
    LOOP
      v_expr := NULL;

      IF v_col.col_name = 'local_user_id' THEN
        v_expr := format('%I.id', v_alias);
      ELSIF v_col.col_name = 'email' AND v_has_email THEN
        v_expr := format('%I.email', v_alias);
      ELSIF v_col.col_name = 'name' THEN
        v_expr := v_name_expr;
      ELSIF v_col.col_name = 'role' AND v_has_role THEN
        v_expr := format('%I.role', v_alias);
      ELSIF v_col.col_name = 'is_active' THEN
        v_expr := v_is_active_expr;
      ELSIF v_col.col_name = 'central_auth_id' AND v_has_central_auth_id THEN
        v_expr := format('%I.central_auth_id', v_alias);
      ELSIF v_col.col_name = 'central_auth_status' AND v_has_central_auth_status THEN
        v_expr := format('%I.central_auth_status', v_alias);
      ELSIF v_col.col_name = 'central_auth_linked_at' AND v_has_central_auth_linked_at THEN
        v_expr := format('%I.central_auth_linked_at', v_alias);
      ELSIF v_col.col_name = 'smav_access_status' THEN
        v_expr := v_access_status_expr;
      ELSIF v_col.col_name = 'username' AND v_has_username THEN
        v_expr := format('%I.username', v_alias);
      ELSIF v_col.col_name = 'central_sync_version' AND v_has_central_sync_version THEN
        v_expr := format('%I.central_sync_version', v_alias);
      ELSIF v_col.col_name = 'central_last_synced_at' AND v_has_central_last_synced_at THEN
        v_expr := format('%I.central_last_synced_at', v_alias);
      END IF;

      IF v_expr IS NULL THEN
        v_can_replace := false;
        EXIT;
      END IF;

      v_select_items := array_append(
        v_select_items,
        format('(%s)::%s AS %I', v_expr, v_col.data_type, v_col.col_name)
      );
    END LOOP;

    IF v_can_replace AND COALESCE(array_length(v_select_items, 1), 0) > 0 THEN
      EXECUTE format(
        'CREATE OR REPLACE VIEW public.vw_smav_restaurant_staff_status AS SELECT %s FROM public.%I %I;',
        array_to_string(v_select_items, ', '),
        v_source_table,
        v_alias
      );
    ELSE
      RAISE NOTICE 'Preserving existing public.vw_smav_restaurant_staff_status definition and dependent objects because its existing columns do not match public.%', v_source_table;
    END IF;
  ELSE
    v_select_items := array_append(v_select_items, format('%I.id AS local_user_id', v_alias));
    IF v_has_email THEN
      v_select_items := array_append(v_select_items, format('%I.email', v_alias));
    END IF;
    v_select_items := array_append(v_select_items, format('%s AS name', v_name_expr));
    IF v_has_role THEN
      v_select_items := array_append(v_select_items, format('%I.role', v_alias));
    END IF;
    v_select_items := array_append(v_select_items, format('%s AS is_active', v_is_active_expr));
    IF v_has_central_auth_id THEN
      v_select_items := array_append(v_select_items, format('%I.central_auth_id', v_alias));
    END IF;
    IF v_has_central_auth_status THEN
      v_select_items := array_append(v_select_items, format('%I.central_auth_status', v_alias));
    END IF;
    IF v_has_central_auth_linked_at THEN
      v_select_items := array_append(v_select_items, format('%I.central_auth_linked_at', v_alias));
    END IF;
    v_select_items := array_append(v_select_items, format('%s AS smav_access_status', v_access_status_expr));

    EXECUTE format(
      'CREATE OR REPLACE VIEW public.vw_smav_restaurant_staff_status AS SELECT %s FROM public.%I %I;',
      array_to_string(v_select_items, ', '),
      v_source_table,
      v_alias
    );
  END IF;
END $$;

COMMENT ON VIEW public.vw_smav_restaurant_staff_status IS
'Readiness status of MOZZ restaurant staff for unified Central SMAV Restaurant POS login';

COMMIT;

