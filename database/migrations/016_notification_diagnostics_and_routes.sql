-- ==============================================================================
-- Apply ONLY to central SMAV Supabase AFTER migrations 008, 013, 014, and 015.
-- Migration: 016_notification_diagnostics_and_routes.sql
-- Purpose:
--   1. Add safe diagnostic & template metadata columns to notification routes/jobs.
--   2. Seed Glossy Looks & MOZZ notification routes idempotently (enabled = false
--      by default, never overwriting existing route configuration).
--   3. Create append-only sanitized step logs table (smav_sale_notification_logs)
--      restricted strictly to service_role.
-- ==============================================================================

BEGIN;

-- 1. Additive diagnostic & template metadata columns on smav_outlet_notification_routes
ALTER TABLE public.smav_outlet_notification_routes
  ADD COLUMN IF NOT EXISTS receipt_template_name text,
  ADD COLUMN IF NOT EXISTS feedback_template_name text,
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_http_status integer,
  ADD COLUMN IF NOT EXISTS last_error text;

-- Idempotent seed for Glossy Looks & MOZZ routes (ONLY if outlet exists, NEVER overwrites existing row)
-- Note: MOZZ sets send_receipts = false and receipt_template_name = NULL to avoid inventing unapproved templates.
INSERT INTO public.smav_outlet_notification_routes (
  outlet_id,
  endpoint_url,
  enabled,
  send_receipts,
  send_feedback,
  receipt_template_name,
  feedback_template_name
)
SELECT
  o.id,
  'https://www.glossylooks.in/api/integrations/smav/sale-event',
  false,
  true,
  true,
  'gl_bill_receipt',
  'glossylooks_customer_feedback'
FROM public.smav_outlets o
WHERE o.id = '28467997-d316-482e-be93-258dd26e1340'::uuid
ON CONFLICT (outlet_id) DO NOTHING;

INSERT INTO public.smav_outlet_notification_routes (
  outlet_id,
  endpoint_url,
  enabled,
  send_receipts,
  send_feedback,
  receipt_template_name,
  feedback_template_name
)
SELECT
  o.id,
  'https://www.starters4u.in/api/integrations/smav/sale-event',
  false,
  false,
  true,
  NULL,
  NULL
FROM public.smav_outlets o
WHERE o.id = 'df74f58a-a147-4a0d-94e9-413935ddc723'::uuid
ON CONFLICT (outlet_id) DO NOTHING;

-- 2. Additive diagnostic & delivery status columns on smav_sale_notification_jobs
ALTER TABLE public.smav_sale_notification_jobs
  ADD COLUMN IF NOT EXISTS bill_id uuid,
  ADD COLUMN IF NOT EXISTS bill_number text,
  ADD COLUMN IF NOT EXISTS last_http_status integer,
  ADD COLUMN IF NOT EXISTS downstream_status text,
  ADD COLUMN IF NOT EXISTS whatsapp_status text,
  ADD COLUMN IF NOT EXISTS whatsapp_message_id text,
  ADD COLUMN IF NOT EXISTS receiver_response jsonb,
  ADD COLUMN IF NOT EXISTS dispatched_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_smav_sale_notification_outlet_status
  ON public.smav_sale_notification_jobs(outlet_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_smav_sale_notification_bill_id
  ON public.smav_sale_notification_jobs(bill_id)
  WHERE bill_id IS NOT NULL;

-- 3. Sanitized Stage 1-3 step logging table (service_role only; no client access)
CREATE TABLE IF NOT EXISTS public.smav_sale_notification_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES public.smav_sale_notification_jobs(id) ON DELETE SET NULL,
  event_id uuid,
  bill_id uuid,
  outlet_id uuid NOT NULL REFERENCES public.smav_outlets(id) ON DELETE CASCADE,
  bill_number text,
  event_type text,
  step text NOT NULL,
  status text NOT NULL,
  http_status integer,
  whatsapp_status text,
  whatsapp_message_id text,
  masked_phone text,
  sanitized_error text,
  response_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_smav_sale_notification_logs_outlet_created
  ON public.smav_sale_notification_logs(outlet_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_smav_sale_notification_logs_bill
  ON public.smav_sale_notification_logs(bill_id, created_at DESC)
  WHERE bill_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_smav_sale_notification_logs_event
  ON public.smav_sale_notification_logs(event_id, created_at DESC)
  WHERE event_id IS NOT NULL;

ALTER TABLE public.smav_sale_notification_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.smav_sale_notification_logs FROM PUBLIC, anon, authenticated;

COMMIT;
