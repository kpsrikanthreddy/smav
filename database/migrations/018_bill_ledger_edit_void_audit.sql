-- =============================================================================
-- Migration 018: Additive Bill Ledger, Edit Audit & Soft-Delete (Void) Columns
-- =============================================================================
-- Strictly additive migration. Does NOT drop, truncate, or modify existing
-- bill numbers, historical bills, WhatsApp notification queues, or Migration 024.
-- Run manually in Central SMAV Supabase SQL Editor during scheduled rollout.
-- =============================================================================

-- 1. Salon Bills (public.smav_salon_bills)
ALTER TABLE public.smav_salon_bills
  ADD COLUMN IF NOT EXISTS subtotal numeric(12,2),
  ADD COLUMN IF NOT EXISTS discount_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_tax numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_voided boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by uuid,
  ADD COLUMN IF NOT EXISTS void_reason text,
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS edited_by uuid,
  ADD COLUMN IF NOT EXISTS edit_reason text,
  ADD COLUMN IF NOT EXISTS edit_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS edit_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_smav_salon_bills_outlet_active_created
  ON public.smav_salon_bills (outlet_id, created_at DESC)
  WHERE is_voided = false;

-- 2. Central Sales (public.smav_central_sales — restaurant / retail / general)
ALTER TABLE public.smav_central_sales
  ADD COLUMN IF NOT EXISTS subtotal numeric(12,2),
  ADD COLUMN IF NOT EXISTS discount_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_tax numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_voided boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by uuid,
  ADD COLUMN IF NOT EXISTS void_reason text,
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS edited_by uuid,
  ADD COLUMN IF NOT EXISTS edit_reason text,
  ADD COLUMN IF NOT EXISTS edit_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS edit_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_smav_central_sales_outlet_active_billed
  ON public.smav_central_sales (outlet_id, billed_at DESC)
  WHERE is_voided = false;
