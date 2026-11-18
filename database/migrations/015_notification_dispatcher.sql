-- Run in SMAV central Supabase AFTER 014. Server-side service-role only.
CREATE TABLE IF NOT EXISTS public.smav_outlet_notification_routes (
 outlet_id uuid PRIMARY KEY REFERENCES public.smav_outlets(id) ON DELETE CASCADE,
 endpoint_url text NOT NULL CHECK (endpoint_url ~ '^https://'),
 enabled boolean NOT NULL DEFAULT false,
 send_receipts boolean NOT NULL DEFAULT true,
 send_feedback boolean NOT NULL DEFAULT true,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.smav_outlet_notification_routes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.smav_outlet_notification_routes FROM anon,authenticated;

-- Atomic claim prevents two cron workers from delivering the same pending job concurrently.
CREATE OR REPLACE FUNCTION public.smav_claim_due_notifications(p_limit integer DEFAULT 20)
RETURNS SETOF public.smav_sale_notification_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'service_role required'; END IF;
 RETURN QUERY WITH claimed AS (
  SELECT j.id FROM public.smav_sale_notification_jobs j
  WHERE j.status='pending' AND j.scheduled_at <= now()
  ORDER BY j.scheduled_at ASC FOR UPDATE SKIP LOCKED LIMIT LEAST(GREATEST(p_limit,1),50)
 )
 UPDATE public.smav_sale_notification_jobs j SET status='processing', attempts=j.attempts+1,updated_at=now()
 FROM claimed WHERE j.id=claimed.id RETURNING j.*;
END $$;
REVOKE ALL ON FUNCTION public.smav_claim_due_notifications(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.smav_claim_due_notifications(integer) TO service_role;
-- Note: configure a trusted cron call to POST /api/internal/notifications/dispatch every minute.
