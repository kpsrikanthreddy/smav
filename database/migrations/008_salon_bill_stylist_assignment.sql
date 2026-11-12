-- ==============================================================================
-- Run in the CENTRAL SMAV Supabase project only.
-- Migration: 008_salon_bill_stylist_assignment.sql
-- Persists stylist ID and name snapshot on each salon bill line.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.smav_salon_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id uuid NOT NULL REFERENCES public.smav_outlets(id),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  bill_number text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  customer_name text,
  customer_phone text,
  payment_mode text,
  grand_total numeric(12,2) NOT NULL,
  items jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.smav_salon_bills ENABLE ROW LEVEL SECURITY;

-- Drop existing policies first to guarantee idempotency and avoid ERROR 42710
DROP POLICY IF EXISTS "smav_salon_bills_insert" ON public.smav_salon_bills;
DROP POLICY IF EXISTS "smav_salon_bills_select_own" ON public.smav_salon_bills;

-- Users can write only their own bills for outlets to which they are actively assigned.
-- Superadmins may write for any registered outlet (auditor POS).
CREATE POLICY "smav_salon_bills_insert" ON public.smav_salon_bills
FOR INSERT TO authenticated WITH CHECK (
  created_by = (select auth.uid()) AND
  (
    EXISTS (SELECT 1 FROM public.smav_user_outlet_roles r
            WHERE r.user_id = (select auth.uid()) AND r.outlet_id = smav_salon_bills.outlet_id AND r.is_active = true)
    OR EXISTS (SELECT 1 FROM public.smav_profiles p
               WHERE p.id = (select auth.uid()) AND p.platform_role = 'SUPERADMIN' AND p.is_active = true)
  )
);

-- Restrict reads to creator (superadmin reporting can use separately authorized backend).
CREATE POLICY "smav_salon_bills_select_own" ON public.smav_salon_bills
FOR SELECT TO authenticated USING (created_by = (select auth.uid()));
