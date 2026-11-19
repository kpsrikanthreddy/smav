import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export type NotificationEventType = 'receipt' | 'feedback';

export type Job = {
  id: string;
  outlet_id: string;
  source_type: string;
  source_key: string;
  event_type: NotificationEventType;
  bill_id?: string | null;
  bill_number?: string | null;
  payload: Record<string, unknown>;
  scheduled_at: string;
  attempts: number;
};

export interface StepLogEntry {
  id?: string;
  job_id?: string | null;
  event_id?: string | null;
  bill_id?: string | null;
  outlet_id: string;
  bill_number?: string | null;
  event_type?: string | null;
  step: string;
  status: string;
  http_status?: number | null;
  whatsapp_status?: string | null;
  whatsapp_message_id?: string | null;
  masked_phone?: string | null;
  sanitized_error?: string | null;
  response_summary?: Record<string, unknown>;
  created_at: string;
}

export interface InternalDispatcherRuntimeState {
  enabled: boolean;
  intervalSec: number;
  running: boolean;
  lastRunAt: string | null;
  lastRunError: string | null;
  lastProcessed: number;
}

const FEEDBACK_DELAY_MS = 2 * 60_000;
// Allow scheduler polling & retry jitter (3 min past scheduled_at = up to 5 min past billed_at)
const FEEDBACK_GRACE_MS = 3 * 60_000;
const MEMORY_STEP_LOG_LIMIT = 120;
const memoryStepLogs: StepLogEntry[] = [];

export function maskPhone(phone?: string | null): string | null {
  const digits = String(phone || '').replace(/\D+/g, '');
  if (!digits) return null;
  if (digits.length <= 4) return '***';
  return `${'*'.repeat(Math.min(8, digits.length - 4))}${digits.slice(-4)}`;
}

export function sanitizeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? 'Unknown error');
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/(apikey|authorization|x-smav-signature|x-integration-key|secret|token|password)\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
    .replace(/\b[0-9a-f]{48,}\b/gi, '[REDACTED_HEX]')
    .replace(/\+?\d[\d\s-]{8,}\d/g, '[PHONE_REDACTED]')
    .slice(0, 400);
}

export function sanitizeUrlForDisplay(rawUrl?: string | null): string | null {
  const clean = String(rawUrl || '').trim();
  if (!clean) return null;
  try {
    const parsed = new URL(clean);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '[INVALID_URL]';
  }
}

export function sanitizeReceiverResponse(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  const allowedKeys = [
    'success',
    'ok',
    'status',
    'accepted',
    'duplicate',
    'deduplicated',
    'outlet_db_status',
    'db_saved',
    'saved',
    'whatsapp_status',
    'whatsappStatus',
    'whatsapp_message_id',
    'whatsappMessageId',
    'message_id',
    'messageId',
    'template_name',
    'templateName',
    'event_id',
    'bill_id',
    'reason',
    'message',
    'error'
  ];
  for (const key of allowedKeys) {
    if (obj[key] !== undefined && obj[key] !== null) {
      const val = obj[key];
      if (typeof val === 'string') {
        safe[key] = sanitizeErrorMessage(val);
      } else if (typeof val === 'number' || typeof val === 'boolean') {
        safe[key] = val;
      }
    }
  }
  return Object.keys(safe).length > 0 ? safe : null;
}

function extractWhatsAppMetadata(parsed: Record<string, unknown> | null): {
  downstreamStatus: string | null;
  whatsappStatus: string | null;
  whatsappMessageId: string | null;
} {
  if (!parsed) {
    return { downstreamStatus: 'accepted', whatsappStatus: null, whatsappMessageId: null };
  }
  const whatsappObj =
    parsed.whatsapp && typeof parsed.whatsapp === 'object' && !Array.isArray(parsed.whatsapp)
      ? (parsed.whatsapp as Record<string, unknown>)
      : null;
  const rawWaStatus =
    parsed.whatsapp_status ??
    parsed.whatsappStatus ??
    whatsappObj?.status ??
    null;
  const rawWaId =
    parsed.whatsapp_message_id ??
    parsed.whatsappMessageId ??
    parsed.message_id ??
    parsed.messageId ??
    whatsappObj?.message_id ??
    whatsappObj?.messageId ??
    null;
  const rawDownstreamStatus =
    parsed.status ??
    (parsed.duplicate === true || parsed.deduplicated === true ? 'duplicate_accepted' : null) ??
    (parsed.accepted === true || parsed.success === true || parsed.ok === true ? 'accepted' : null);

  return {
    downstreamStatus: rawDownstreamStatus ? String(rawDownstreamStatus).slice(0, 64) : 'accepted',
    whatsappStatus: rawWaStatus ? String(rawWaStatus).slice(0, 64) : null,
    whatsappMessageId: rawWaId ? String(rawWaId).slice(0, 128) : null
  };
}

export async function recordNotificationStepLog(
  db: SupabaseClient | null,
  entry: Omit<StepLogEntry, 'created_at'> & { created_at?: string }
): Promise<void> {
  const full: StepLogEntry = {
    id: crypto.randomUUID(),
    job_id: entry.job_id ?? null,
    event_id: entry.event_id ?? null,
    bill_id: entry.bill_id ?? null,
    outlet_id: entry.outlet_id,
    bill_number: entry.bill_number ?? null,
    event_type: entry.event_type ?? null,
    step: entry.step,
    status: entry.status,
    http_status: entry.http_status ?? null,
    whatsapp_status: entry.whatsapp_status ?? null,
    whatsapp_message_id: entry.whatsapp_message_id ?? null,
    masked_phone: entry.masked_phone ?? null,
    sanitized_error: entry.sanitized_error ? sanitizeErrorMessage(entry.sanitized_error) : null,
    response_summary: entry.response_summary || {},
    created_at: entry.created_at || new Date().toISOString()
  };

  memoryStepLogs.unshift(full);
  if (memoryStepLogs.length > MEMORY_STEP_LOG_LIMIT) {
    memoryStepLogs.length = MEMORY_STEP_LOG_LIMIT;
  }

  if (!db) return;
  try {
    await db.from('smav_sale_notification_logs').insert({
      job_id: full.job_id,
      event_id: full.event_id,
      bill_id: full.bill_id,
      outlet_id: full.outlet_id,
      bill_number: full.bill_number,
      event_type: full.event_type,
      step: full.step,
      status: full.status,
      http_status: full.http_status,
      whatsapp_status: full.whatsapp_status,
      whatsapp_message_id: full.whatsapp_message_id,
      masked_phone: full.masked_phone,
      sanitized_error: full.sanitized_error,
      response_summary: full.response_summary,
      created_at: full.created_at
    });
  } catch {
    // Non-fatal if migration 016 has not been applied yet
  }
}

export function isFeedbackWithinDeadline(billedAtIso: string | null | undefined, scheduledAtIso?: string | null): boolean {
  const now = Date.now();
  if (scheduledAtIso) {
    const schedMs = Date.parse(scheduledAtIso);
    if (!Number.isNaN(schedMs) && now > schedMs + FEEDBACK_GRACE_MS) {
      return false;
    }
  }
  if (billedAtIso) {
    const billedMs = Date.parse(billedAtIso);
    if (!Number.isNaN(billedMs) && now > billedMs + FEEDBACK_DELAY_MS + FEEDBACK_GRACE_MS) {
      return false;
    }
  }
  return true;
}

/** Service-role only. Downstream endpoint must verify HMAC and deduplicate event_id. */
export async function dispatchDueSaleNotifications(db: SupabaseClient, limit = 20) {
  const secret = (process.env.SMAV_DISPATCH_SECRET || '').trim();
  if (secret.length < 32) {
    throw new Error('SMAV_DISPATCH_SECRET must be at least 32 characters');
  }

  const { data, error } = await db.rpc('smav_claim_due_notifications', {
    p_limit: Math.min(Math.max(limit, 1), 50)
  });
  if (error) throw new Error(error.message);

  const results: Array<{
    id: string;
    outlet_id: string;
    event_type: NotificationEventType;
    status: string;
    http_status?: number | null;
    whatsapp_status?: string | null;
    error?: string | null;
  }> = [];

  for (const job of (data || []) as Job[]) {
    const billNumber = String(job.bill_number || job.payload?.bill_number || '').trim() || null;
    const billId =
      (job.bill_id && String(job.bill_id)) ||
      (typeof job.payload?.bill_id === 'string' ? job.payload.bill_id : null);
    const maskedPhone = maskPhone(
      typeof job.payload?.customer_phone === 'string' ? job.payload.customer_phone : null
    );

    try {
      const { data: route, error: routeError } = await db
        .from('smav_outlet_notification_routes')
        .select('endpoint_url,enabled,send_receipts,send_feedback,receipt_template_name,feedback_template_name')
        .eq('outlet_id', job.outlet_id)
        .maybeSingle();

      if (routeError) throw new Error(routeError.message);

      let skipReason: string | null = null;
      if (!route || !route.enabled || !route.endpoint_url) {
        skipReason = 'Outlet route missing or disabled';
      } else if (job.event_type === 'receipt' && !route.send_receipts) {
        skipReason = 'Receipt notifications disabled for outlet';
      } else if (job.event_type === 'feedback' && !route.send_feedback) {
        skipReason = 'Feedback notifications disabled for outlet';
      }

      if (skipReason) {
        const nowIso = new Date().toISOString();
        await db
          .from('smav_sale_notification_jobs')
          .update({
            status: 'skipped',
            last_error: skipReason,
            downstream_status: 'skipped',
            completed_at: nowIso,
            updated_at: nowIso
          })
          .eq('id', job.id)
          .eq('status', 'processing');

        await recordNotificationStepLog(db, {
          job_id: job.id,
          event_id: job.id,
          bill_id: billId,
          outlet_id: job.outlet_id,
          bill_number: billNumber,
          event_type: job.event_type,
          step: 'skipped',
          status: 'skipped',
          masked_phone: maskedPhone,
          sanitized_error: skipReason
        });

        results.push({
          id: job.id,
          outlet_id: job.outlet_id,
          event_type: job.event_type,
          status: 'skipped',
          error: skipReason
        });
        continue;
      }

      const billedAtRaw = typeof job.payload?.billed_at === 'string' ? job.payload.billed_at : null;
      if (job.event_type === 'feedback' && !isFeedbackWithinDeadline(billedAtRaw, job.scheduled_at)) {
        const reason = 'Overdue feedback deadline passed';
        const nowIso = new Date().toISOString();
        await db
          .from('smav_sale_notification_jobs')
          .update({
            status: 'skipped',
            last_error: reason,
            downstream_status: 'skipped',
            completed_at: nowIso,
            updated_at: nowIso
          })
          .eq('id', job.id)
          .eq('status', 'processing');

        await recordNotificationStepLog(db, {
          job_id: job.id,
          event_id: job.id,
          bill_id: billId,
          outlet_id: job.outlet_id,
          bill_number: billNumber,
          event_type: job.event_type,
          step: 'skipped',
          status: 'skipped',
          masked_phone: maskedPhone,
          sanitized_error: reason
        });

        results.push({
          id: job.id,
          outlet_id: job.outlet_id,
          event_type: job.event_type,
          status: 'skipped',
          error: reason
        });
        continue;
      }

      const url = new URL(route!.endpoint_url);
      if (url.protocol !== 'https:') throw new Error('HTTPS endpoint required');

      const configuredTemplateName =
        job.event_type === 'receipt'
          ? route!.receipt_template_name || null
          : route!.feedback_template_name || null;

      const body = JSON.stringify({
        event_id: job.id,
        outlet_id: job.outlet_id,
        source_type: job.source_type,
        source_key: job.source_key,
        event_type: job.event_type,
        ...(billId ? { bill_id: billId } : {}),
        ...(configuredTemplateName ? { template_hint: configuredTemplateName } : {}),
        payload: job.payload
      });

      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = crypto
        .createHmac('sha256', secret)
        .update(`${timestamp}.${body}`)
        .digest('hex');

      const dispatchedAt = new Date().toISOString();
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-smav-timestamp': timestamp,
          'x-smav-signature': signature,
          'x-smav-event-id': job.id
        },
        body,
        signal: AbortSignal.timeout(12000)
      });

      const rawText = await response.text().catch(() => '');
      let parsedBody: Record<string, unknown> | null = null;
      if (rawText) {
        try {
          const jsonVal = JSON.parse(rawText);
          if (jsonVal && typeof jsonVal === 'object' && !Array.isArray(jsonVal)) {
            parsedBody = jsonVal as Record<string, unknown>;
          }
        } catch {
          parsedBody = null;
        }
      }

      const sanitizedBody = sanitizeReceiverResponse(parsedBody);
      const waMeta = extractWhatsAppMetadata(parsedBody);

      if (!response.ok) {
        const downstreamErr =
          (sanitizedBody?.error && String(sanitizedBody.error)) ||
          (sanitizedBody?.message && String(sanitizedBody.message)) ||
          sanitizeErrorMessage(rawText.slice(0, 200)) ||
          '';
        const errMessage = `Downstream HTTP ${response.status}${downstreamErr ? `: ${downstreamErr}` : ''}`;

        await db
          .from('smav_outlet_notification_routes')
          .update({
            last_verified_at: dispatchedAt,
            last_http_status: response.status,
            last_error: sanitizeErrorMessage(errMessage),
            updated_at: dispatchedAt
          })
          .eq('outlet_id', job.outlet_id);

        const nonRetryableClientError =
          response.status >= 400 &&
          response.status < 500 &&
          response.status !== 408 &&
          response.status !== 429;
        const retry = !nonRetryableClientError && job.attempts < 5;
        const nextSchedule = new Date(Date.now() + Math.min(60, 2 ** job.attempts) * 60000).toISOString();

        await db
          .from('smav_sale_notification_jobs')
          .update({
            status: retry ? 'pending' : 'failed',
            scheduled_at: retry ? nextSchedule : job.scheduled_at,
            last_error: sanitizeErrorMessage(errMessage),
            last_http_status: response.status,
            downstream_status: 'error',
            whatsapp_status: waMeta.whatsappStatus,
            receiver_response: sanitizedBody,
            dispatched_at: dispatchedAt,
            completed_at: retry ? null : dispatchedAt,
            updated_at: dispatchedAt
          })
          .eq('id', job.id)
          .eq('status', 'processing');

        await recordNotificationStepLog(db, {
          job_id: job.id,
          event_id: job.id,
          bill_id: billId,
          outlet_id: job.outlet_id,
          bill_number: billNumber,
          event_type: job.event_type,
          step: retry ? 'retry_scheduled' : 'failed',
          status: retry ? 'retry' : 'failed',
          http_status: response.status,
          whatsapp_status: waMeta.whatsappStatus,
          whatsapp_message_id: waMeta.whatsappMessageId,
          masked_phone: maskedPhone,
          sanitized_error: errMessage,
          response_summary: sanitizedBody || {}
        });

        results.push({
          id: job.id,
          outlet_id: job.outlet_id,
          event_type: job.event_type,
          status: retry ? 'retry' : 'failed',
          http_status: response.status,
          whatsapp_status: waMeta.whatsappStatus,
          error: sanitizeErrorMessage(errMessage)
        });
        continue;
      }

      const completedAt = new Date().toISOString();
      const explicitWaFailed = waMeta.whatsappStatus?.toLowerCase() === 'failed';
      const explicitDownstreamSkipped = waMeta.downstreamStatus?.toLowerCase() === 'skipped';
      const finalJobStatus = explicitWaFailed
        ? 'failed'
        : explicitDownstreamSkipped
          ? 'skipped'
          : 'sent';

      await db
        .from('smav_outlet_notification_routes')
        .update({
          last_verified_at: completedAt,
          last_http_status: response.status,
          last_error: explicitWaFailed
            ? sanitizeErrorMessage(String(sanitizedBody?.error || sanitizedBody?.message || 'Downstream WhatsApp failure'))
            : null,
          updated_at: completedAt
        })
        .eq('outlet_id', job.outlet_id);

      const { error: markError } = await db
        .from('smav_sale_notification_jobs')
        .update({
          status: finalJobStatus,
          last_error: explicitWaFailed
            ? sanitizeErrorMessage(String(sanitizedBody?.error || sanitizedBody?.message || 'WhatsApp delivery failed'))
            : null,
          last_http_status: response.status,
          downstream_status: waMeta.downstreamStatus,
          whatsapp_status: waMeta.whatsappStatus || (finalJobStatus === 'sent' ? 'accepted_by_receiver' : 'skipped'),
          whatsapp_message_id: waMeta.whatsappMessageId,
          receiver_response: sanitizedBody,
          dispatched_at: dispatchedAt,
          completed_at: completedAt,
          updated_at: completedAt
        })
        .eq('id', job.id)
        .eq('status', 'processing');

      if (markError) throw new Error(markError.message);

      await recordNotificationStepLog(db, {
        job_id: job.id,
        event_id: job.id,
        bill_id: billId,
        outlet_id: job.outlet_id,
        bill_number: billNumber,
        event_type: job.event_type,
        step: explicitWaFailed ? 'whatsapp_failed' : 'downstream_accepted',
        status: finalJobStatus,
        http_status: response.status,
        whatsapp_status: waMeta.whatsappStatus || (finalJobStatus === 'sent' ? 'accepted_by_receiver' : 'skipped'),
        whatsapp_message_id: waMeta.whatsappMessageId,
        masked_phone: maskedPhone,
        sanitized_error: explicitWaFailed
          ? sanitizeErrorMessage(String(sanitizedBody?.error || sanitizedBody?.message || 'WhatsApp failure'))
          : null,
        response_summary: sanitizedBody || {}
      });

      results.push({
        id: job.id,
        outlet_id: job.outlet_id,
        event_type: job.event_type,
        status: finalJobStatus === 'sent' ? 'accepted' : finalJobStatus,
        http_status: response.status,
        whatsapp_status: waMeta.whatsappStatus || (finalJobStatus === 'sent' ? 'accepted_by_receiver' : 'skipped')
      });
    } catch (err: any) {
      const safeErr = sanitizeErrorMessage(err);
      const retry = job.attempts < 5;
      const nowIso = new Date().toISOString();
      await db
        .from('smav_sale_notification_jobs')
        .update({
          status: retry ? 'pending' : 'failed',
          scheduled_at: new Date(Date.now() + Math.min(60, 2 ** job.attempts) * 60000).toISOString(),
          last_error: safeErr,
          downstream_status: 'network_error',
          updated_at: nowIso
        })
        .eq('id', job.id)
        .eq('status', 'processing');

      await recordNotificationStepLog(db, {
        job_id: job.id,
        event_id: job.id,
        bill_id: billId,
        outlet_id: job.outlet_id,
        bill_number: billNumber,
        event_type: job.event_type,
        step: retry ? 'retry_scheduled' : 'failed',
        status: retry ? 'retry' : 'failed',
        masked_phone: maskedPhone,
        sanitized_error: safeErr
      });

      results.push({
        id: job.id,
        outlet_id: job.outlet_id,
        event_type: job.event_type,
        status: retry ? 'retry' : 'failed',
        error: safeErr
      });
    }
  }

  return { processed: results.length, results };
}

export async function probeOutletEndpointReachability(endpointUrl: string): Promise<{
  reachable: boolean;
  httpStatus: number | null;
  message: string;
  checkedAt: string;
}> {
  const checkedAt = new Date().toISOString();
  try {
    const parsed = new URL(endpointUrl);
    if (parsed.protocol !== 'https:') {
      return { reachable: false, httpStatus: null, message: 'HTTPS required', checkedAt };
    }
    const resp = await fetch(parsed.toString(), {
      method: 'OPTIONS',
      signal: AbortSignal.timeout(6000)
    });
    const redirectNote = resp.redirected
      ? ` -> ${sanitizeUrlForDisplay(resp.url) || resp.url}`
      : '';
    return {
      reachable: true,
      httpStatus: resp.status,
      message: `HTTPS reachable (OPTIONS HTTP ${resp.status}${redirectNote})`,
      checkedAt
    };
  } catch (err: any) {
    return {
      reachable: false,
      httpStatus: null,
      message: sanitizeErrorMessage(err),
      checkedAt
    };
  }
}

export async function runSafeIntegrationDiagnostics(params: {
  db: SupabaseClient | null;
  outlets: Array<{ id: string; code: string; name: string; category: string }>;
  outletId?: string | null;
  centralSupabaseConfigured: boolean;
  supabaseProjectHost?: string | null;
  internalDispatcherState: InternalDispatcherRuntimeState;
  probeEndpoints?: boolean;
}) {
  const {
    db,
    outlets,
    outletId,
    centralSupabaseConfigured,
    supabaseProjectHost = null,
    internalDispatcherState,
    probeEndpoints
  } = params;
  const dispatchSecret = (process.env.SMAV_DISPATCH_SECRET || '').trim();
  const cronSecret = (process.env.SMAV_DISPATCH_CRON_SECRET || '').trim();
  const scopedOutlets = outletId ? outlets.filter((o) => o.id === outletId) : outlets;
  const scopedIds = scopedOutlets.map((o) => o.id);

  const tableProbeColumns: Record<string, string> = {
    smav_salon_bills: 'id',
    smav_central_sales: 'id',
    smav_sale_notification_jobs: 'id',
    smav_outlet_notification_routes: 'outlet_id',
    smav_sale_notification_logs: 'id'
  };

  const tablesStatus: Record<string, { exists: boolean; error?: string }> = {
    smav_salon_bills: { exists: false },
    smav_central_sales: { exists: false },
    smav_sale_notification_jobs: { exists: false },
    smav_outlet_notification_routes: { exists: false },
    smav_sale_notification_logs: { exists: false }
  };

  let supabaseConnected = false;
  let supabaseError: string | null = null;
  let routesError: string | null = null;
  let salonBillsCount = 0;
  let centralSalesCount = 0;
  const jobCounts = { pending: 0, processing: 0, sent: 0, failed: 0, skipped: 0, total: 0 };
  let routesData: any[] | null = null;
  let recentJobs: any[] = [];
  let recentLogs: StepLogEntry[] = [];

  const isMissingColumnError = (err: { code?: string; message?: string } | null | undefined) => {
    if (!err) return false;
    const code = String(err.code || '').toUpperCase();
    const msg = String(err.message || '');
    return (
      code === '42703' ||
      code === 'PGRST204' ||
      /column .* does not exist/i.test(msg) ||
      /could not find .* column/i.test(msg)
    );
  };

  if (db) {
    for (const [table, probeCol] of Object.entries(tableProbeColumns)) {
      try {
        // Never use head: true on diagnostic probes because PostgREST suppresses JSON error bodies on HEAD
        const { error } = await db.from(table).select(probeCol, { count: 'exact' }).limit(1);
        if (!error) {
          tablesStatus[table] = { exists: true };
          supabaseConnected = true;
        } else {
          const safeMsg = sanitizeErrorMessage(error.message || error.code || `Query failed on ${table}`);
          tablesStatus[table] = { exists: false, error: safeMsg };
        }
      } catch (e: any) {
        tablesStatus[table] = { exists: false, error: sanitizeErrorMessage(e) };
      }
    }

    if (scopedIds.length > 0) {
      // Load smav_outlet_notification_routes directly and explicitly report any DB/RLS error
      try {
        const fullSelect =
          'outlet_id,endpoint_url,enabled,send_receipts,send_feedback,receipt_template_name,feedback_template_name,last_verified_at,last_http_status,last_error,updated_at';
        const baseSelect = 'outlet_id,endpoint_url,enabled,send_receipts,send_feedback,updated_at';

        let { data: rRows, error: rErr } = await db
          .from('smav_outlet_notification_routes')
          .select(fullSelect)
          .in('outlet_id', scopedIds);

        if (rErr && isMissingColumnError(rErr)) {
          const fallback = await db
            .from('smav_outlet_notification_routes')
            .select(baseSelect)
            .in('outlet_id', scopedIds);
          rRows = fallback.data as any;
          rErr = fallback.error;
        }

        if (rErr) {
          routesError = sanitizeErrorMessage(
            `${rErr.code ? `[${rErr.code}] ` : ''}${rErr.message || 'Failed to query smav_outlet_notification_routes'}`
          );
          tablesStatus.smav_outlet_notification_routes = {
            exists: tablesStatus.smav_outlet_notification_routes.exists,
            error: routesError
          };
          supabaseError = supabaseError || `Route query failed: ${routesError}`;
        } else {
          routesData = Array.isArray(rRows) ? rRows : [];
          tablesStatus.smav_outlet_notification_routes = { exists: true };
          supabaseConnected = true;
        }
      } catch (e: any) {
        routesError = sanitizeErrorMessage(e);
        tablesStatus.smav_outlet_notification_routes = { exists: false, error: routesError };
        supabaseError = supabaseError || `Route query failed: ${routesError}`;
      }

      if (tablesStatus.smav_salon_bills.exists) {
        try {
          const { count } = await db
            .from('smav_salon_bills')
            .select('id', { count: 'exact' })
            .in('outlet_id', scopedIds)
            .limit(1);
          salonBillsCount = count || 0;
        } catch {}
      }

      if (tablesStatus.smav_central_sales.exists) {
        try {
          const { count } = await db
            .from('smav_central_sales')
            .select('id', { count: 'exact' })
            .in('outlet_id', scopedIds)
            .limit(1);
          centralSalesCount = count || 0;
        } catch {}
      }

      if (tablesStatus.smav_sale_notification_jobs.exists) {
        try {
          const fullJobsSelect =
            'id,outlet_id,source_type,source_key,event_type,status,scheduled_at,attempts,last_error,bill_id,bill_number,last_http_status,downstream_status,whatsapp_status,whatsapp_message_id,receiver_response,dispatched_at,completed_at,created_at,updated_at,payload';
          const legacyJobsSelect =
            'id,outlet_id,source_type,source_key,event_type,status,scheduled_at,attempts,last_error,created_at,updated_at,payload';

          let { data: jRows, error: jErr } = await db
            .from('smav_sale_notification_jobs')
            .select(fullJobsSelect)
            .in('outlet_id', scopedIds)
            .order('updated_at', { ascending: false })
            .limit(100);

          if (jErr && isMissingColumnError(jErr)) {
            const fallbackJobs = await db
              .from('smav_sale_notification_jobs')
              .select(legacyJobsSelect)
              .in('outlet_id', scopedIds)
              .order('updated_at', { ascending: false })
              .limit(100);
            jRows = fallbackJobs.data as any;
            jErr = fallbackJobs.error;
          }

          if (jErr) {
            const jobErrMsg = sanitizeErrorMessage(jErr.message || 'Failed to query notification jobs');
            supabaseError = supabaseError || `Notification jobs query failed: ${jobErrMsg}`;
          } else if (Array.isArray(jRows)) {
            for (const j of jRows) {
              const st = String(j.status || 'pending') as keyof typeof jobCounts;
              if (st in jobCounts) jobCounts[st] += 1;
              jobCounts.total += 1;
            }
            recentJobs = jRows.slice(0, 25).map((j) => ({
              id: j.id,
              outlet_id: j.outlet_id,
              source_type: j.source_type,
              event_type: j.event_type,
              status: j.status,
              bill_id: j.bill_id || (j.payload?.bill_id ?? null),
              bill_number: j.bill_number || (j.payload?.bill_number ?? null),
              masked_phone: maskPhone(j.payload?.customer_phone),
              scheduled_at: j.scheduled_at,
              attempts: j.attempts,
              last_http_status: j.last_http_status ?? null,
              downstream_status: j.downstream_status ?? null,
              whatsapp_status: j.whatsapp_status ?? null,
              whatsapp_message_id: j.whatsapp_message_id ?? null,
              receiver_response: sanitizeReceiverResponse(j.receiver_response),
              last_error: j.last_error ? sanitizeErrorMessage(j.last_error) : null,
              dispatched_at: j.dispatched_at ?? null,
              completed_at: j.completed_at ?? null,
              updated_at: j.updated_at
            }));
          }
        } catch (err: any) {
          supabaseError = supabaseError || sanitizeErrorMessage(err);
        }
      }

      if (tablesStatus.smav_sale_notification_logs.exists) {
        try {
          const { data: lRows } = await db
            .from('smav_sale_notification_logs')
            .select('*')
            .in('outlet_id', scopedIds)
            .order('created_at', { ascending: false })
            .limit(40);
          if (Array.isArray(lRows)) {
            recentLogs = lRows;
          }
        } catch {}
      }
    }
  } else {
    const missingCfgMsg = 'SMAV_SERVICE_ROLE_KEY or central Supabase URL is not configured on this server.';
    supabaseError = missingCfgMsg;
    routesError = missingCfgMsg;
  }

  if (recentLogs.length === 0) {
    recentLogs = memoryStepLogs
      .filter((l) => scopedIds.length === 0 || scopedIds.includes(l.outlet_id))
      .slice(0, 40);
  }

  const routes = await Promise.all(
    scopedOutlets.map(async (outlet) => {
      const normalizedOutletId = outlet.id.trim().toLowerCase();
      const r =
        routesData !== null
          ? routesData.find((row) => String(row.outlet_id || '').trim().toLowerCase() === normalizedOutletId)
          : undefined;
      const endpointUrl = r?.endpoint_url || null;
      const reachability =
        probeEndpoints && endpointUrl ? await probeOutletEndpointReachability(endpointUrl) : null;
      const queryFailed = routesData === null;
      const statusLabel: 'ENABLED' | 'DISABLED' | 'UNSEEDED' | 'ERROR' = queryFailed
        ? 'ERROR'
        : r
          ? r.enabled
            ? 'ENABLED'
            : 'DISABLED'
          : 'UNSEEDED';

      return {
        outlet_id: outlet.id,
        outlet_code: outlet.code,
        outlet_name: outlet.name,
        category: outlet.category,
        configured: queryFailed ? false : Boolean(r),
        status_label: statusLabel,
        query_error: queryFailed ? routesError || supabaseError || 'Route query failed' : null,
        endpoint_url: sanitizeUrlForDisplay(endpointUrl),
        enabled: Boolean(r?.enabled),
        send_receipts: Boolean(r?.send_receipts),
        send_feedback: Boolean(r?.send_feedback),
        receipt_template_name: r?.receipt_template_name || null,
        feedback_template_name: r?.feedback_template_name || null,
        last_verified_at: r?.last_verified_at || null,
        last_http_status: r?.last_http_status ?? null,
        last_error: r?.last_error ? sanitizeErrorMessage(r.last_error) : null,
        reachability
      };
    })
  );

  return {
    checkedAt: new Date().toISOString(),
    backend: {
      connected: true,
      centralSupabaseConfigured,
      supabaseProjectHost,
      serviceRoleConfigured: Boolean(db),
      dispatchSecretConfigured: dispatchSecret.length >= 32,
      cronSecretConfigured: cronSecret.length >= 32,
      internalDispatcher: internalDispatcherState
    },
    supabase: {
      connected: supabaseConnected,
      error: supabaseError,
      routesError,
      tables: tablesStatus
    },
    routesError,
    salesSummary: {
      salonBillsCount,
      centralSalesCount,
      totalSyncedRecords: salonBillsCount + centralSalesCount
    },
    queueSummary: jobCounts,
    routes,
    recentJobs,
    recentLogs
  };
}

export async function runConfirmedE2EIntegrationTest(params: {
  db: SupabaseClient;
  userId: string;
  outlet: { id: string; code: string; name: string; category: string };
  testPhone: string;
  confirmed: boolean;
}) {
  const { db, userId, outlet, testPhone, confirmed } = params;
  if (!confirmed) {
    throw new Error('Explicit confirmation (confirmed: true) is required to run the live end-to-end test.');
  }

  const secret = (process.env.SMAV_DISPATCH_SECRET || '').trim();
  if (secret.length < 32) {
    throw new Error('SMAV_DISPATCH_SECRET (>= 32 chars) must be configured before running E2E dispatch.');
  }

  const digits = String(testPhone || '').replace(/\D+/g, '');
  if (digits.length < 10 || digits.length > 15) {
    throw new Error('Provide a valid authorized test WhatsApp number (10-15 digits).');
  }
  const maskedPhone = maskPhone(digits);

  const { data: route, error: routeErr } = await db
    .from('smav_outlet_notification_routes')
    .select('*')
    .eq('outlet_id', outlet.id)
    .maybeSingle();

  if (routeErr) throw new Error(sanitizeErrorMessage(routeErr.message));
  if (!route || !route.enabled || !route.endpoint_url) {
    throw new Error(
      `Notification route for ${outlet.name} is missing or disabled (enabled=${Boolean(route?.enabled)}). Enable it in smav_outlet_notification_routes before running E2E test.`
    );
  }

  const eventType: NotificationEventType | null = route.send_receipts
    ? 'receipt'
    : route.send_feedback
      ? 'feedback'
      : null;
  if (!eventType) {
    throw new Error(`Both send_receipts and send_feedback are disabled for ${outlet.name}.`);
  }

  const nowIso = new Date().toISOString();
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  const billNumber = `DIAG-${outlet.code.toUpperCase().slice(0, 6)}-${Date.now().toString().slice(-6)}-${suffix}`;
  const idempotencyKey = `E2E_DIAG_${outlet.id}_${Date.now()}_${suffix}`;

  let billId: string | null = null;
  const steps: Array<{ step: string; status: string; timestamp: string; detail?: string }> = [];

  if (outlet.category === 'salon') {
    const { data: billRow, error: billErr } = await db
      .from('smav_salon_bills')
      .insert({
        outlet_id: outlet.id,
        created_by: userId,
        bill_number: billNumber,
        idempotency_key: idempotencyKey,
        customer_name: 'SMAV Integration Test',
        customer_phone: digits,
        payment_mode: 'upi',
        grand_total: 1,
        items: [
          {
            service_id: 'diag_test_service',
            service_name: 'SMAV Diagnostic Verification',
            stylist_id: userId,
            stylist_name: 'Diagnostic Runner',
            quantity: 1,
            unit_price: 1
          }
        ]
      })
      .select('id')
      .single();
    if (billErr) throw new Error(`Stage 1 DB write failed: ${sanitizeErrorMessage(billErr.message)}`);
    billId = billRow?.id || null;
  } else {
    const { data: saleRow, error: saleErr } = await db
      .from('smav_central_sales')
      .insert({
        outlet_id: outlet.id,
        created_by: userId,
        sale_kind: outlet.category === 'restaurant' ? 'restaurant' : 'retail',
        idempotency_key: idempotencyKey,
        bill_number: billNumber,
        customer_name: 'SMAV Integration Test',
        customer_phone: digits,
        payment_mode: 'upi',
        grand_total: 1,
        billed_at: nowIso,
        items: [
          {
            itemId: 'diag_test_item',
            name: 'SMAV Diagnostic Verification',
            quantity: 1,
            price: 1
          }
        ],
        details: { diagnostic_e2e_test: true }
      })
      .select('id')
      .single();
    if (saleErr) throw new Error(`Stage 1 DB write failed: ${sanitizeErrorMessage(saleErr.message)}`);
    billId = saleRow?.id || null;
  }

  steps.push({
    step: 'stage1_central_supabase_saved',
    status: 'ok',
    timestamp: new Date().toISOString(),
    detail: `Saved test bill ${billNumber} (bill_id=${billId})`
  });

  const payload = {
    bill_id: billId,
    bill_number: billNumber,
    customer_name: 'SMAV Integration Test',
    customer_phone: digits,
    payment_mode: 'upi',
    grand_total: 1,
    billed_at: nowIso,
    diagnostic_e2e_test: true,
    items: [{ name: 'SMAV Diagnostic Verification', quantity: 1, price: 1 }]
  };

  const { data: jobRow, error: jobErr } = await db
    .from('smav_sale_notification_jobs')
    .insert({
      outlet_id: outlet.id,
      source_type: outlet.category === 'salon' ? 'salon' : outlet.category === 'restaurant' ? 'restaurant' : 'retail',
      source_key: idempotencyKey,
      event_type: eventType,
      status: 'processing',
      scheduled_at: nowIso,
      attempts: 1,
      payload,
      bill_id: billId,
      bill_number: billNumber
    })
    .select('id')
    .single();

  if (jobErr || !jobRow?.id) {
    throw new Error(`Stage 2 queue insert failed: ${sanitizeErrorMessage(jobErr?.message || 'Missing job ID')}`);
  }

  const eventId = String(jobRow.id);
  await recordNotificationStepLog(db, {
    job_id: eventId,
    event_id: eventId,
    bill_id: billId,
    outlet_id: outlet.id,
    bill_number: billNumber,
    event_type: eventType,
    step: 'e2e_test_enqueued',
    status: 'processing',
    masked_phone: maskedPhone
  });

  steps.push({
    step: 'stage2_job_queued',
    status: 'ok',
    timestamp: new Date().toISOString(),
    detail: `Queued event_type=${eventType} event_id=${eventId}`
  });

  const url = new URL(route.endpoint_url);
  if (url.protocol !== 'https:') throw new Error('HTTPS endpoint required');

  const templateHint =
    eventType === 'receipt'
      ? route.receipt_template_name || null
      : route.feedback_template_name || null;

  const body = JSON.stringify({
    event_id: eventId,
    outlet_id: outlet.id,
    source_type: outlet.category === 'salon' ? 'salon' : outlet.category === 'restaurant' ? 'restaurant' : 'retail',
    source_key: idempotencyKey,
    event_type: eventType,
    ...(billId ? { bill_id: billId } : {}),
    ...(templateHint ? { template_hint: templateHint } : {}),
    payload
  });

  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  const dispatchedAt = new Date().toISOString();

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-smav-timestamp': timestamp,
      'x-smav-signature': signature,
      'x-smav-event-id': eventId
    },
    body,
    signal: AbortSignal.timeout(12000)
  });

  const rawText = await response.text().catch(() => '');
  let parsedBody: Record<string, unknown> | null = null;
  if (rawText) {
    try {
      const jsonVal = JSON.parse(rawText);
      if (jsonVal && typeof jsonVal === 'object' && !Array.isArray(jsonVal)) {
        parsedBody = jsonVal as Record<string, unknown>;
      }
    } catch {
      parsedBody = null;
    }
  }
  const sanitizedBody = sanitizeReceiverResponse(parsedBody);
  const waMeta = extractWhatsAppMetadata(parsedBody);
  const completedAt = new Date().toISOString();
  const ok = response.ok && waMeta.whatsappStatus?.toLowerCase() !== 'failed';
  const errMsg = ok
    ? null
    : sanitizeErrorMessage(
        String(sanitizedBody?.error || sanitizedBody?.message || `HTTP ${response.status}`)
      );

  await db
    .from('smav_sale_notification_jobs')
    .update({
      status: ok ? 'sent' : 'failed',
      last_error: errMsg,
      last_http_status: response.status,
      downstream_status: waMeta.downstreamStatus,
      whatsapp_status: waMeta.whatsappStatus || (ok ? 'accepted_by_receiver' : 'failed'),
      whatsapp_message_id: waMeta.whatsappMessageId,
      receiver_response: sanitizedBody,
      dispatched_at: dispatchedAt,
      completed_at: completedAt,
      updated_at: completedAt
    })
    .eq('id', eventId);

  await db
    .from('smav_outlet_notification_routes')
    .update({
      last_verified_at: completedAt,
      last_http_status: response.status,
      last_error: errMsg,
      updated_at: completedAt
    })
    .eq('outlet_id', outlet.id);

  await recordNotificationStepLog(db, {
    job_id: eventId,
    event_id: eventId,
    bill_id: billId,
    outlet_id: outlet.id,
    bill_number: billNumber,
    event_type: eventType,
    step: 'e2e_test_completed',
    status: ok ? 'sent' : 'failed',
    http_status: response.status,
    whatsapp_status: waMeta.whatsappStatus || (ok ? 'accepted_by_receiver' : 'failed'),
    whatsapp_message_id: waMeta.whatsappMessageId,
    masked_phone: maskedPhone,
    sanitized_error: errMsg,
    response_summary: sanitizedBody || {}
  });

  steps.push({
    step: 'stage3_downstream_and_whatsapp',
    status: ok ? 'ok' : 'failed',
    timestamp: completedAt,
    detail: `HTTP ${response.status} · downstream=${waMeta.downstreamStatus} · whatsapp=${waMeta.whatsappStatus || 'unknown'}`
  });

  return {
    success: ok,
    outlet_id: outlet.id,
    outlet_name: outlet.name,
    bill_id: billId,
    bill_number: billNumber,
    event_id: eventId,
    event_type: eventType,
    masked_phone: maskedPhone,
    http_status: response.status,
    downstream_status: waMeta.downstreamStatus,
    whatsapp_status: waMeta.whatsappStatus || (ok ? 'accepted_by_receiver' : 'failed'),
    whatsapp_message_id: waMeta.whatsappMessageId,
    receiver_response: sanitizedBody,
    sanitized_error: errMsg,
    steps
  };
}
