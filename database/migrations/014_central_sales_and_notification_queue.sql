-- Apply ONLY to central SMAV Supabase after migrations 008 and 013.
-- Durable multi-outlet sales and pending notification ledger.
CREATE TABLE IF NOT EXISTS public.smav_central_sales (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 outlet_id uuid NOT NULL REFERENCES public.smav_outlets(id),
 created_by uuid NOT NULL REFERENCES auth.users(id),
 sale_kind text NOT NULL CHECK (sale_kind IN ('restaurant','salon','retail','other')),
 idempotency_key text NOT NULL,
 bill_number text NOT NULL,
 customer_name text, customer_phone text, payment_mode text,
 grand_total numeric(12,2) NOT NULL CHECK (grand_total >= 0),
 items jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array'),
 details jsonb NOT NULL DEFAULT '{}'::jsonb,
 billed_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(outlet_id,idempotency_key)
);
ALTER TABLE public.smav_central_sales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS smav_central_sales_insert ON public.smav_central_sales;
CREATE POLICY smav_central_sales_insert ON public.smav_central_sales FOR INSERT TO authenticated
WITH CHECK (created_by = (select auth.uid()) AND
 (EXISTS (SELECT 1 FROM public.smav_user_outlet_roles r WHERE r.user_id = (select auth.uid()) AND r.outlet_id = smav_central_sales.outlet_id AND r.is_active)
 OR EXISTS (SELECT 1 FROM public.smav_profiles p WHERE p.id = (select auth.uid()) AND p.platform_role = 'SUPERADMIN' AND p.is_active)));
DROP POLICY IF EXISTS smav_central_sales_read ON public.smav_central_sales;
CREATE POLICY smav_central_sales_read ON public.smav_central_sales FOR SELECT TO authenticated
USING (created_by = (select auth.uid()));

CREATE TABLE IF NOT EXISTS public.smav_sale_notification_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 outlet_id uuid NOT NULL REFERENCES public.smav_outlets(id),
 source_type text NOT NULL, source_key text NOT NULL,
 event_type text NOT NULL CHECK (event_type IN ('receipt','feedback')),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','sent','failed','skipped')),
 scheduled_at timestamptz NOT NULL,
 payload jsonb NOT NULL DEFAULT '{}'::jsonb,
 attempts integer NOT NULL DEFAULT 0,
 last_error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(outlet_id,source_type,source_key,event_type)
);
ALTER TABLE public.smav_sale_notification_jobs ENABLE ROW LEVEL SECURITY;
-- Authenticated POS users may enqueue only their own assigned outlet jobs.
-- No browser/Android user can read or mark notification jobs as sent.
DROP POLICY IF EXISTS smav_sale_notification_enqueue ON public.smav_sale_notification_jobs;
CREATE POLICY smav_sale_notification_enqueue ON public.smav_sale_notification_jobs FOR INSERT TO authenticated
WITH CHECK (status = 'pending' AND attempts = 0 AND
 (EXISTS (SELECT 1 FROM public.smav_user_outlet_roles r WHERE r.user_id = (select auth.uid()) AND r.outlet_id = smav_sale_notification_jobs.outlet_id AND r.is_active)
 OR EXISTS (SELECT 1 FROM public.smav_profiles p WHERE p.id = (select auth.uid()) AND p.platform_role = 'SUPERADMIN' AND p.is_active)));
-- A trusted server-side dispatcher with service_role must claim and process jobs.
CREATE INDEX IF NOT EXISTS idx_smav_sale_notification_due ON public.smav_sale_notification_jobs(status,scheduled_at);
