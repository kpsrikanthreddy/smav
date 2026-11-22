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

function parsePositiveIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = Number((process.env[name] || '').trim());
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(max, Math.max(min, Math.round(raw)));
}

const FEEDBACK_DELAY_MINUTES = parsePositiveIntEnv('SMAV_FEEDBACK_DELAY_MINUTES', 30, 1, 1440);
const FEEDBACK_DELAY_MS = FEEDBACK_DELAY_MINUTES * 60_000;
// Allow Cloud Run cold starts, cron intervals, and transient retries without dropping due feedback jobs
const FEEDBACK_GRACE_MINUTES = parsePositiveIntEnv('SMAV_FEEDBACK_GRACE_MINUTES', 180, 10, 1440);
const FEEDBACK_GRACE_MS = FEEDBACK_GRACE_MINUTES * 60_000;
const DEFAULT_SALON_FEEDBACK_TEMPLATE =
  (process.env.SMAV_FEEDBACK_TEMPLATE_NAME || 'glossylooks_customer_feedback').trim() ||
  'glossylooks_customer_feedback';
const STALE_PROCESSING_RECOVERY_MS = 5 * 60_000;
// Allow downstream serverless cold start + DB persistence + Meta WhatsApp API round-trip
const DISPATCH_TIMEOUT_MS = 25_000;
const MEMORY_STEP_LOG_LIMIT = 120;
const memoryStepLogs: StepLogEntry[] = [];

function resolveIntegrationKeyForEndpoint(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  if (host.includes('glossylooks')) {
    return (process.env.GLOSSYLOOKS_INTEGRATION_KEY || '').trim() || null;
  }
  if (host.includes('starters4u')) {
    return (process.env.MOZZ_INTEGRATION_KEY || '').trim() || null;
  }
  return null;
}

function isMissingColumnError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const code = String(err.code || '').toUpperCase();
  const msg = String(err.message || '');
  return (
    code === '42703' ||
    code === 'PGRST204' ||
    /column .* does not exist/i.test(msg) ||
    /could not find .* column/i.test(msg) ||
    /schema cache/i.test(msg)
  );
}

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

function asPlainObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function sanitizeReceiverResponse(raw: unknown): Record<string, unknown> | null {
  const obj = asPlainObject(raw);
  if (!obj) return null;
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
    'whatsapp_sent',
    'whatsappSent',
    'whatsapp_error',
    'whatsappError',
    'provider_status',
    'providerStatus',
    'delivery_status',
    'deliveryStatus',
    'whatsapp_message_id',
    'whatsappMessageId',
    'provider_message_id',
    'providerMessageId',
    'wamid',
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
  const copySafeFields = (src: Record<string, unknown>, target: Record<string, unknown>) => {
    for (const key of allowedKeys) {
      if (src[key] !== undefined && src[key] !== null) {
        const val = src[key];
        if (typeof val === 'string') {
          target[key] = sanitizeErrorMessage(val);
        } else if (typeof val === 'number' || typeof val === 'boolean') {
          target[key] = val;
        }
      }
    }
  };

  copySafeFields(obj, safe);

  for (const nestedKey of ['whatsapp', 'result', 'data', 'notification', 'delivery', 'provider']) {
    const nested = asPlainObject(obj[nestedKey]);
    if (nested) {
      const safeNested: Record<string, unknown> = {};
      copySafeFields(nested, safeNested);
      if (typeof nested.id === 'string' && nested.id.trim()) {
        safeNested.id = sanitizeErrorMessage(nested.id.trim());
      }
      if (typeof nested.sent === 'boolean') {
        safeNested.sent = nested.sent;
      }
      if (Array.isArray(nested.messages) && nested.messages.length > 0) {
        const firstMsg = asPlainObject(nested.messages[0]);
        if (firstMsg) {
          if (typeof firstMsg.id === 'string') safeNested.message_id = sanitizeErrorMessage(firstMsg.id);
          if (typeof firstMsg.message_status === 'string') {
            safeNested.provider_status = sanitizeErrorMessage(firstMsg.message_status);
          }
        }
      }
      if (Object.keys(safeNested).length > 0) {
        safe[nestedKey] = safeNested;
      }
    }
  }

  return Object.keys(safe).length > 0 ? safe : null;
}

export type NormalizedWhatsAppStatus =
  | 'confirmed_delivered'
  | 'confirmed_read'
  | 'whatsapp_api_accepted'
  | 'downstream_accepted'
  | 'skipped'
  | 'failed';

export function extractWhatsAppMetadata(
  parsed: Record<string, unknown> | null,
  httpOk = true
): {
  downstreamStatus: string;
  whatsappStatus: NormalizedWhatsAppStatus;
  rawProviderStatus: string | null;
  whatsappMessageId: string | null;
  whatsappFailed: boolean;
  whatsappError: string | null;
  downstreamSkipped: boolean;
} {
  if (!parsed) {
    return {
      downstreamStatus: httpOk ? 'accepted' : 'error',
      whatsappStatus: httpOk ? 'downstream_accepted' : 'failed',
      rawProviderStatus: null,
      whatsappMessageId: null,
      whatsappFailed: !httpOk,
      whatsappError: null,
      downstreamSkipped: false
    };
  }

  const nestedData = asPlainObject(parsed.data) || asPlainObject(parsed.result);
  const whatsappObj =
    asPlainObject(parsed.whatsapp) ||
    asPlainObject(nestedData?.whatsapp) ||
    asPlainObject(parsed.notification) ||
    asPlainObject(nestedData?.notification) ||
    asPlainObject(parsed.delivery) ||
    asPlainObject(nestedData?.delivery) ||
    asPlainObject(parsed.provider) ||
    asPlainObject(nestedData?.provider);

  const metaMessages =
    (Array.isArray(whatsappObj?.messages) ? whatsappObj.messages : null) ||
    (Array.isArray(parsed.messages) ? parsed.messages : null);
  const firstMetaMsg = metaMessages && metaMessages.length > 0 ? asPlainObject(metaMessages[0]) : null;

  const pickString = (...vals: unknown[]): string | null => {
    for (const v of vals) {
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return null;
  };

  const rawWaId = pickString(
    parsed.whatsapp_message_id,
    parsed.whatsappMessageId,
    parsed.provider_message_id,
    parsed.providerMessageId,
    parsed.wamid,
    parsed.message_id,
    parsed.messageId,
    nestedData?.whatsapp_message_id,
    nestedData?.whatsappMessageId,
    nestedData?.provider_message_id,
    nestedData?.wamid,
    nestedData?.message_id,
    nestedData?.messageId,
    whatsappObj?.whatsapp_message_id,
    whatsappObj?.whatsappMessageId,
    whatsappObj?.provider_message_id,
    whatsappObj?.providerMessageId,
    whatsappObj?.wamid,
    whatsappObj?.message_id,
    whatsappObj?.messageId,
    whatsappObj?.id,
    firstMetaMsg?.id
  );

  const rawProviderStatus = pickString(
    parsed.delivery_status,
    parsed.deliveryStatus,
    parsed.whatsapp_status,
    parsed.whatsappStatus,
    parsed.provider_status,
    parsed.providerStatus,
    nestedData?.delivery_status,
    nestedData?.deliveryStatus,
    nestedData?.whatsapp_status,
    nestedData?.whatsappStatus,
    nestedData?.provider_status,
    whatsappObj?.delivery_status,
    whatsappObj?.deliveryStatus,
    whatsappObj?.provider_status,
    whatsappObj?.providerStatus,
    whatsappObj?.status,
    firstMetaMsg?.message_status
  );

  const whatsappError = pickString(
    parsed.whatsapp_error,
    parsed.whatsappError,
    nestedData?.whatsapp_error,
    nestedData?.whatsappError,
    whatsappObj?.error,
    whatsappObj?.error_message,
    whatsappObj?.message && whatsappObj?.ok === false ? whatsappObj.message : null
  );

  const explicitWaSentTrue =
    parsed.whatsapp_sent === true ||
    parsed.whatsappSent === true ||
    nestedData?.whatsapp_sent === true ||
    nestedData?.whatsappSent === true ||
    whatsappObj?.sent === true ||
    whatsappObj?.accepted === true ||
    whatsappObj?.ok === true ||
    whatsappObj?.success === true;

  const explicitWaSentFalse =
    parsed.whatsapp_sent === false ||
    parsed.whatsappSent === false ||
    nestedData?.whatsapp_sent === false ||
    nestedData?.whatsappSent === false ||
    whatsappObj?.sent === false ||
    whatsappObj?.ok === false ||
    whatsappObj?.success === false;

  const isDuplicate =
    parsed.duplicate === true ||
    parsed.deduplicated === true ||
    nestedData?.duplicate === true ||
    nestedData?.deduplicated === true;

  const rawDownstreamStatus =
    pickString(parsed.status, nestedData?.status) ||
    (isDuplicate ? 'duplicate_accepted' : null) ||
    (parsed.accepted === true || parsed.success === true || parsed.ok === true ? 'accepted' : null) ||
    (httpOk ? 'accepted' : 'error');

  const downstreamLower = rawDownstreamStatus.toLowerCase();
  const providerLower = (rawProviderStatus || '').toLowerCase();
  const downstreamSkipped =
    downstreamLower === 'skipped' ||
    downstreamLower === 'ignored' ||
    providerLower === 'skipped';

  const explicitProviderFailed =
    providerLower === 'failed' ||
    providerLower === 'error' ||
    providerLower === 'rejected' ||
    providerLower === 'undeliverable' ||
    (explicitWaSentFalse && !downstreamSkipped && !isDuplicate) ||
    Boolean(whatsappError && !rawWaId && !explicitWaSentTrue);

  const whatsappFailed = !httpOk || explicitProviderFailed;

  let normalizedWaStatus: NormalizedWhatsAppStatus;
  if (whatsappFailed) {
    normalizedWaStatus = 'failed';
  } else if (downstreamSkipped) {
    normalizedWaStatus = 'skipped';
  } else if (providerLower === 'read' || providerLower === 'confirmed_read') {
    normalizedWaStatus = 'confirmed_read';
  } else if (
    providerLower === 'delivered' ||
    providerLower === 'confirmed_delivered' ||
    providerLower === 'delivery_confirmed'
  ) {
    normalizedWaStatus = 'confirmed_delivered';
  } else if (
    rawWaId ||
    explicitWaSentTrue ||
    providerLower === 'whatsapp_api_accepted' ||
    providerLower === 'api_accepted' ||
    providerLower === 'accepted' ||
    providerLower === 'sent' ||
    providerLower === 'queued' ||
    providerLower === 'submitted' ||
    providerLower === 'dispatched' ||
    providerLower === 'enqueued' ||
    providerLower === 'ok' ||
    providerLower === 'success'
  ) {
    normalizedWaStatus = 'whatsapp_api_accepted';
  } else {
    normalizedWaStatus = 'downstream_accepted';
  }

  return {
    downstreamStatus: rawDownstreamStatus.slice(0, 64),
    whatsappStatus: normalizedWaStatus,
    rawProviderStatus: rawProviderStatus ? rawProviderStatus.slice(0, 64) : null,
    whatsappMessageId: rawWaId ? rawWaId.slice(0, 128) : null,
    whatsappFailed,
    whatsappError: whatsappError ? sanitizeErrorMessage(whatsappError) : null,
    downstreamSkipped
  };
}

type NotificationJobPatch = {
  status: 'pending' | 'processing' | 'sent' | 'failed' | 'skipped';
  scheduled_at?: string;
  last_error?: string | null;
  last_http_status?: number | null;
  downstream_status?: string | null;
  whatsapp_status?: string | null;
  whatsapp_message_id?: string | null;
  receiver_response?: Record<string, unknown> | null;
  dispatched_at?: string | null;
  completed_at?: string | null;
  updated_at: string;
};

async function updateNotificationJobSafe(
  db: SupabaseClient,
  jobId: string,
  patch: NotificationJobPatch,
  onlyIfProcessing = false
): Promise<{ ok: boolean; error: string | null; usedLegacyFallback: boolean }> {
  const buildQuery = (payload: Record<string, unknown>) => {
    let q = db.from('smav_sale_notification_jobs').update(payload).eq('id', jobId);
    if (onlyIfProcessing) {
      q = q.eq('status', 'processing');
    }
    return q;
  };

  const attemptUpdate = async (payload: Record<string, unknown>) => {
    try {
      const { error } = await buildQuery(payload);
      return error || null;
    } catch (e: any) {
      return { message: sanitizeErrorMessage(e) };
    }
  };

  let err = await attemptUpdate(patch as unknown as Record<string, unknown>);
  if (!err) {
    return { ok: true, error: null, usedLegacyFallback: false };
  }

  // Fallback to base 014 columns if any 016 diagnostic column is missing or uncached
  if (isMissingColumnError(err)) {
    const legacyPatch: Record<string, unknown> = {
      status: patch.status,
      last_error: patch.last_error ?? null,
      updated_at: patch.updated_at
    };
    if (patch.scheduled_at !== undefined) {
      legacyPatch.scheduled_at = patch.scheduled_at;
    }
    const legacyErr = await attemptUpdate(legacyPatch);
    if (!legacyErr) {
      return { ok: true, error: null, usedLegacyFallback: true };
    }
    err = legacyErr;
  }

  // Single short retry for transient Supabase/network errors so jobs never stall in processing
  await new Promise((resolve) => setTimeout(resolve, 250));
  const retryErr = await attemptUpdate(patch as unknown as Record<string, unknown>);
  if (!retryErr) {
    return { ok: true, error: null, usedLegacyFallback: false };
  }

  return {
    ok: false,
    error: sanitizeErrorMessage(retryErr.message || (retryErr as any).code || 'Failed to update notification job'),
    usedLegacyFallback: false
  };
}

async function selectNotificationRouteSafe(db: SupabaseClient, outletId: string): Promise<{
  route: {
    endpoint_url: string;
    enabled: boolean;
    send_receipts: boolean;
    send_feedback: boolean;
    receipt_template_name?: string | null;
    feedback_template_name?: string | null;
  } | null;
  error: string | null;
}> {
  let { data, error } = await db
    .from('smav_outlet_notification_routes')
    .select('endpoint_url,enabled,send_receipts,send_feedback,receipt_template_name,feedback_template_name')
    .eq('outlet_id', outletId)
    .maybeSingle();

  if (error && isMissingColumnError(error)) {
    const fallback = await db
      .from('smav_outlet_notification_routes')
      .select('endpoint_url,enabled,send_receipts,send_feedback')
      .eq('outlet_id', outletId)
      .maybeSingle();
    data = fallback.data as any;
    error = fallback.error;
  }

  if (error) {
    return { route: null, error: sanitizeErrorMessage(error.message || error.code || 'Route lookup failed') };
  }
  return { route: (data as any) || null, error: null };
}

async function updateNotificationRouteSafe(
  db: SupabaseClient,
  outletId: string,
  patch: {
    last_verified_at: string;
    last_http_status: number | null;
    last_error: string | null;
    updated_at: string;
  }
): Promise<void> {
  try {
    const { error } = await db
      .from('smav_outlet_notification_routes')
      .update(patch)
      .eq('outlet_id', outletId);
    if (error && isMissingColumnError(error)) {
      await db
        .from('smav_outlet_notification_routes')
        .update({ updated_at: patch.updated_at })
        .eq('outlet_id', outletId);
    }
  } catch {
    // Non-fatal metadata update on route row
  }
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

export function normalizeNotificationPhone(phone?: string | null): string {
  const trimmed = String(phone || '').trim();
  const digits = trimmed.replace(/\D+/g, '');
  if (digits.length >= 10 && digits.length <= 15) return digits;
  return trimmed;
}

async function upsertNotificationJobRow(
  db: SupabaseClient,
  row: {
    outlet_id: string;
    source_type: string;
    source_key: string;
    event_type: NotificationEventType;
    status: 'pending';
    scheduled_at: string;
    payload: Record<string, unknown>;
    bill_id?: string | null;
    bill_number?: string | null;
  }
): Promise<{ error: { code?: string; message: string } | null }> {
  const with016 = {
    outlet_id: row.outlet_id,
    source_type: row.source_type,
    source_key: row.source_key,
    event_type: row.event_type,
    status: row.status,
    attempts: 0,
    scheduled_at: row.scheduled_at,
    payload: row.payload,
    ...(row.bill_id ? { bill_id: row.bill_id } : {}),
    ...(row.bill_number ? { bill_number: row.bill_number } : {})
  };

  const first = await db
    .from('smav_sale_notification_jobs')
    .upsert(with016, { onConflict: 'outlet_id,source_type,source_key,event_type', ignoreDuplicates: true });

  if (first.error && isMissingColumnError(first.error)) {
    const fallback = await db
      .from('smav_sale_notification_jobs')
      .upsert(
        {
          outlet_id: row.outlet_id,
          source_type: row.source_type,
          source_key: row.source_key,
          event_type: row.event_type,
          status: row.status,
          attempts: 0,
          scheduled_at: row.scheduled_at,
          payload: row.payload
        },
        { onConflict: 'outlet_id,source_type,source_key,event_type', ignoreDuplicates: true }
      );
    return { error: fallback.error ? { code: fallback.error.code, message: fallback.error.message } : null };
  }

  return { error: first.error ? { code: first.error.code, message: first.error.message } : null };
}

/**
 * Unified central notification queueing for Web POS, Android POS, and offline sync.
 * Idempotently queues one immediate 'receipt' job and one 2-minute delayed 'feedback' job
 * using UNIQUE(outlet_id, source_type, source_key, event_type).
 */
export async function enqueueSaleNotificationJobs(params: {
  db: SupabaseClient;
  logDb?: SupabaseClient | null;
  outlet: { id: string; code: string; name: string; branchCode?: string | null; branchName?: string | null };
  sourceType: 'salon' | 'restaurant' | 'retail';
  sourceKey: string;
  billId: string | null;
  billNumber: string;
  centralBillId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  paymentMode?: string | null;
  grandTotal: number;
  subtotal?: number | null;
  discount?: number | null;
  tax?: number | null;
  items: Array<Record<string, unknown>>;
  billedAtIso: string;
  orderType?: string | null;
  sendReceipts: boolean;
  sendFeedback: boolean;
}): Promise<{
  receiptQueued: boolean;
  receiptError: string | null;
  feedbackQueued: boolean;
  feedbackScheduledAt: string | null;
  feedbackSkippedOverdue: boolean;
  feedbackError: string | null;
}> {
  const {
    db,
    logDb = db,
    outlet,
    sourceType,
    sourceKey,
    billId,
    billNumber,
    centralBillId = null,
    customerName,
    customerPhone,
    paymentMode,
    grandTotal,
    subtotal,
    discount,
    tax,
    items,
    billedAtIso,
    orderType,
    sendReceipts,
    sendFeedback
  } = params;

  const cleanPhone = normalizeNotificationPhone(customerPhone);
  const cleanName = String(customerName || '').trim();
  const cleanPaymentMode = String(paymentMode || '').trim().toLowerCase() || null;
  const branchCode = String(outlet.branchCode || outlet.code || '').trim() || null;
  const branchName = String(outlet.branchName || '').trim() || null;
  const maskedPhone = maskPhone(cleanPhone);

  if (!cleanPhone) {
    return {
      receiptQueued: false,
      receiptError: null,
      feedbackQueued: false,
      feedbackScheduledAt: null,
      feedbackSkippedOverdue: false,
      feedbackError: null
    };
  }

  const normalizedItems = items.map((item) => {
    const name = String(item.service_name ?? item.name ?? '').trim();
    const qty = Number(item.quantity ?? 1);
    const price = Number(item.unit_price ?? item.price ?? 0);
    const stylistName = item.stylist_name ?? item.stylist ?? null;
    const serviceId = item.service_id ?? item.serviceId ?? item.itemId ?? null;
    const stylistId = item.stylist_id ?? item.stylistId ?? null;
    const discountPercent = item.discount_percent ?? item.discountPercent ?? null;
    return {
      ...item,
      name,
      service_name: name,
      quantity: Number.isFinite(qty) ? qty : 1,
      price: Number.isFinite(price) ? price : 0,
      unit_price: Number.isFinite(price) ? price : 0,
      ...(serviceId ? { service_id: serviceId } : {}),
      ...(stylistId ? { stylist_id: stylistId } : {}),
      ...(stylistName ? { stylist: stylistName, stylist_name: stylistName } : {}),
      ...(discountPercent !== null && discountPercent !== undefined ? { discount_percent: Number(discountPercent) } : {})
    };
  });

  const basePayload: Record<string, unknown> = {
    bill_id: billId,
    bill_number: billNumber,
    central_bill_number: billNumber,
    ...(centralBillId ? { central_bill_id: centralBillId } : {}),
    outlet_id: outlet.id,
    outlet_code: outlet.code,
    outlet_name: outlet.name,
    ...(branchCode ? { branch_code: branchCode } : {}),
    ...(branchName ? { branch_name: branchName } : {}),
    customer_name: cleanName,
    customer_phone: cleanPhone,
    payment_mode: cleanPaymentMode,
    grand_total: Number(grandTotal),
    ...(typeof subtotal === 'number' && Number.isFinite(subtotal) ? { subtotal } : {}),
    ...(typeof discount === 'number' && Number.isFinite(discount) ? { discount } : {}),
    ...(typeof tax === 'number' && Number.isFinite(tax) ? { tax } : {}),
    items: normalizedItems,
    billed_at: billedAtIso,
    ...(orderType ? { order_type: orderType } : {})
  };

  let receiptQueued = false;
  let receiptError: string | null = null;
  if (sendReceipts) {
    const { error } = await upsertNotificationJobRow(db, {
      outlet_id: outlet.id,
      source_type: sourceType,
      source_key: sourceKey,
      event_type: 'receipt',
      status: 'pending',
      scheduled_at: new Date().toISOString(),
      payload: basePayload,
      bill_id: billId,
      bill_number: billNumber
    });
    if (error) {
      receiptError = sanitizeErrorMessage(error.message);
      console.error('[SMAV notification queue][receipt]', receiptError);
      await recordNotificationStepLog(logDb, {
        bill_id: billId,
        outlet_id: outlet.id,
        bill_number: billNumber,
        event_type: 'receipt',
        step: 'stage2_receipt_enqueue_failed',
        status: 'failed',
        masked_phone: maskedPhone,
        sanitized_error: receiptError
      });
    } else {
      receiptQueued = true;
    }
  }

  let feedbackQueued = false;
  let feedbackScheduledAt: string | null = null;
  let feedbackSkippedOverdue = false;
  let feedbackError: string | null = null;

  if (sendFeedback) {
    const billedMs = Date.parse(billedAtIso);
    const baseMs = Number.isNaN(billedMs) ? Date.now() : billedMs;
    const feedbackDueMs = baseMs + FEEDBACK_DELAY_MS;
    const nowMs = Date.now();
    const resolvedFeedbackTemplate = sourceType === 'salon' ? DEFAULT_SALON_FEEDBACK_TEMPLATE : null;
    if (feedbackDueMs + FEEDBACK_GRACE_MS > nowMs) {
      feedbackScheduledAt = new Date(Math.max(feedbackDueMs, nowMs)).toISOString();
      const feedbackPayload: Record<string, unknown> = {
        bill_id: billId,
        bill_number: billNumber,
        central_bill_number: billNumber,
        ...(centralBillId ? { central_bill_id: centralBillId } : {}),
        outlet_id: outlet.id,
        outlet_code: outlet.code,
        outlet_name: outlet.name,
        ...(branchCode ? { branch_code: branchCode } : {}),
        ...(branchName ? { branch_name: branchName } : {}),
        customer_name: cleanName,
        customer_phone: cleanPhone,
        payment_mode: cleanPaymentMode,
        grand_total: Number(grandTotal),
        billed_at: billedAtIso,
        ...(resolvedFeedbackTemplate
          ? {
              template_name: resolvedFeedbackTemplate,
              template_language: 'en'
            }
          : {})
      };

      const { error } = await upsertNotificationJobRow(db, {
        outlet_id: outlet.id,
        source_type: sourceType,
        source_key: sourceKey,
        event_type: 'feedback',
        status: 'pending',
        scheduled_at: feedbackScheduledAt,
        payload: feedbackPayload,
        bill_id: billId,
        bill_number: billNumber
      });
      if (error) {
        feedbackError = sanitizeErrorMessage(error.message);
        console.error(
          `[SMAV notification][feedback][enqueue_failed] bill=${billNumber} phone=${maskedPhone || 'n/a'} error=${feedbackError}`
        );
        await recordNotificationStepLog(logDb, {
          bill_id: billId,
          outlet_id: outlet.id,
          bill_number: billNumber,
          event_type: 'feedback',
          step: 'stage2_feedback_enqueue_failed',
          status: 'failed',
          masked_phone: maskedPhone,
          sanitized_error: feedbackError
        });
      } else {
        feedbackQueued = true;
        console.info(
          `[SMAV notification][feedback][scheduled] bill=${billNumber} phone=${maskedPhone || 'n/a'} scheduledAt=${feedbackScheduledAt} delayMin=${FEEDBACK_DELAY_MINUTES} template=${resolvedFeedbackTemplate || 'route_default'}`
        );
        await recordNotificationStepLog(logDb, {
          bill_id: billId,
          outlet_id: outlet.id,
          bill_number: billNumber,
          event_type: 'feedback',
          step: 'stage2_feedback_scheduled',
          status: 'pending',
          whatsapp_status: 'pending',
          masked_phone: maskedPhone,
          response_summary: {
            scheduled_at: feedbackScheduledAt,
            delay_minutes: FEEDBACK_DELAY_MINUTES,
            template_name: resolvedFeedbackTemplate || 'route_default'
          }
        });
      }
    } else {
      feedbackSkippedOverdue = true;
      console.warn(
        `[SMAV notification][feedback][skipped_overdue] bill=${billNumber} phone=${maskedPhone || 'n/a'} billedAt=${billedAtIso}`
      );
      await recordNotificationStepLog(logDb, {
        bill_id: billId,
        outlet_id: outlet.id,
        bill_number: billNumber,
        event_type: 'feedback',
        step: 'stage2_feedback_skipped_overdue',
        status: 'skipped',
        whatsapp_status: 'skipped',
        masked_phone: maskedPhone,
        sanitized_error: `Offline bill synced after ${FEEDBACK_DELAY_MINUTES}-minute feedback window expired`
      });
    }
  }

  await recordNotificationStepLog(logDb, {
    bill_id: billId,
    outlet_id: outlet.id,
    bill_number: billNumber,
    event_type: receiptQueued ? 'receipt' : feedbackQueued ? 'feedback' : sendReceipts ? 'receipt' : 'feedback',
    step: sourceType === 'salon' ? 'stage1_bill_persisted_and_enqueued' : 'stage1_order_persisted_and_enqueued',
    status: receiptQueued || feedbackQueued ? 'pending' : receiptError || feedbackError ? 'failed' : 'skipped',
    masked_phone: maskedPhone,
    sanitized_error: receiptError || feedbackError || null,
    response_summary: {
      receipt_queued: receiptQueued,
      feedback_queued: feedbackQueued,
      feedback_skipped_overdue: feedbackSkippedOverdue
    }
  });

  return {
    receiptQueued,
    receiptError,
    feedbackQueued,
    feedbackScheduledAt,
    feedbackSkippedOverdue,
    feedbackError
  };
}

/** Service-role only. Downstream endpoint must verify HMAC and deduplicate event_id. */
export async function dispatchDueSaleNotifications(db: SupabaseClient, limit = 20) {
  const secret = (process.env.SMAV_DISPATCH_SECRET || '').trim();
  if (secret.length < 32) {
    throw new Error('SMAV_DISPATCH_SECRET must be at least 32 characters');
  }

  // Safely recover jobs interrupted mid-claim (before HTTP dispatch) so Cloud Run restarts never stall feedback delivery
  try {
    const staleBeforeIso = new Date(Date.now() - STALE_PROCESSING_RECOVERY_MS).toISOString();
    await db
      .from('smav_sale_notification_jobs')
      .update({ status: 'pending', updated_at: new Date().toISOString() })
      .eq('status', 'processing')
      .is('dispatched_at', null)
      .lt('attempts', 5)
      .lt('updated_at', staleBeforeIso);
  } catch {
    // Non-fatal on schemas without dispatched_at
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
    downstream_status?: string | null;
    whatsapp_status?: string | null;
    whatsapp_message_id?: string | null;
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
    let dispatchedAt: string | null = null;
    let downstreamAccepted = false;

    try {
      const { route, error: routeError } = await selectNotificationRouteSafe(db, job.outlet_id);
      if (routeError) throw new Error(routeError);

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
        await updateNotificationJobSafe(
          db,
          job.id,
          {
            status: 'skipped',
            last_error: skipReason,
            downstream_status: 'skipped',
            whatsapp_status: 'skipped',
            completed_at: nowIso,
            updated_at: nowIso
          },
          true
        );

        await recordNotificationStepLog(db, {
          job_id: job.id,
          event_id: job.id,
          bill_id: billId,
          outlet_id: job.outlet_id,
          bill_number: billNumber,
          event_type: job.event_type,
          step: 'skipped',
          status: 'skipped',
          whatsapp_status: 'skipped',
          masked_phone: maskedPhone,
          sanitized_error: skipReason
        });

        results.push({
          id: job.id,
          outlet_id: job.outlet_id,
          event_type: job.event_type,
          status: 'skipped',
          downstream_status: 'skipped',
          whatsapp_status: 'skipped',
          error: skipReason
        });
        continue;
      }

      const billedAtRaw = typeof job.payload?.billed_at === 'string' ? job.payload.billed_at : null;
      if (job.event_type === 'feedback' && !isFeedbackWithinDeadline(billedAtRaw, job.scheduled_at)) {
        const reason = 'Overdue feedback deadline passed';
        const nowIso = new Date().toISOString();
        await updateNotificationJobSafe(
          db,
          job.id,
          {
            status: 'skipped',
            last_error: reason,
            downstream_status: 'skipped',
            whatsapp_status: 'skipped',
            completed_at: nowIso,
            updated_at: nowIso
          },
          true
        );

        await recordNotificationStepLog(db, {
          job_id: job.id,
          event_id: job.id,
          bill_id: billId,
          outlet_id: job.outlet_id,
          bill_number: billNumber,
          event_type: job.event_type,
          step: 'skipped',
          status: 'skipped',
          whatsapp_status: 'skipped',
          masked_phone: maskedPhone,
          sanitized_error: reason
        });

        results.push({
          id: job.id,
          outlet_id: job.outlet_id,
          event_type: job.event_type,
          status: 'skipped',
          downstream_status: 'skipped',
          whatsapp_status: 'skipped',
          error: reason
        });
        continue;
      }

      const url = new URL(route!.endpoint_url);
      if (url.protocol !== 'https:') throw new Error('HTTPS endpoint required');

      const configuredTemplateName =
        job.event_type === 'receipt'
          ? route!.receipt_template_name || null
          : route!.feedback_template_name ||
            (job.source_type === 'salon' ? DEFAULT_SALON_FEEDBACK_TEMPLATE : null);

      const outboundPayload =
        job.event_type === 'feedback'
          ? {
              ...job.payload,
              ...(configuredTemplateName && !job.payload?.template_name
                ? { template_name: configuredTemplateName }
                : {}),
              ...(configuredTemplateName && !job.payload?.template_language
                ? { template_language: 'en' }
                : {})
            }
          : job.payload;

      const body = JSON.stringify({
        event_id: job.id,
        outlet_id: job.outlet_id,
        source_type: job.source_type,
        source_key: job.source_key,
        event_type: job.event_type,
        ...(billId ? { bill_id: billId } : {}),
        ...(configuredTemplateName ? { template_hint: configuredTemplateName } : {}),
        ...(job.event_type === 'feedback' && configuredTemplateName
          ? { template_name: configuredTemplateName, template_language: 'en' }
          : {}),
        payload: outboundPayload
      });

      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = crypto
        .createHmac('sha256', secret)
        .update(`${timestamp}.${body}`)
        .digest('hex');

      const integrationKey = resolveIntegrationKeyForEndpoint(url);
      const requestHeaders: Record<string, string> = {
        'content-type': 'application/json',
        'x-smav-timestamp': timestamp,
        'x-smav-signature': signature,
        'x-smav-event-id': job.id,
        ...(integrationKey ? { 'x-integration-key': integrationKey } : {})
      };

      if (job.event_type === 'feedback') {
        console.info(
          `[SMAV notification][feedback][dispatching] job=${job.id} bill=${billNumber || 'n/a'} phone=${maskedPhone || 'n/a'} template=${configuredTemplateName || 'none'} attempt=${job.attempts} endpoint=${sanitizeUrlForDisplay(route!.endpoint_url)}`
        );
      }

      dispatchedAt = new Date().toISOString();
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: requestHeaders,
        body,
        signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS)
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
      const waMeta = extractWhatsAppMetadata(parsedBody, response.ok);

      if (!response.ok) {
        const downstreamErr =
          (sanitizedBody?.error && String(sanitizedBody.error)) ||
          (sanitizedBody?.message && String(sanitizedBody.message)) ||
          sanitizeErrorMessage(rawText.slice(0, 200)) ||
          '';
        const errMessage = `Downstream HTTP ${response.status}${downstreamErr ? `: ${downstreamErr}` : ''}`;
        const failedAt = new Date().toISOString();

        await updateNotificationRouteSafe(db, job.outlet_id, {
          last_verified_at: failedAt,
          last_http_status: response.status,
          last_error: sanitizeErrorMessage(errMessage),
          updated_at: failedAt
        });

        const nonRetryableClientError =
          response.status >= 400 &&
          response.status < 500 &&
          response.status !== 408 &&
          response.status !== 429;
        const retry = !nonRetryableClientError && job.attempts < 5;
        const nextSchedule = new Date(Date.now() + Math.min(60, 2 ** job.attempts) * 60000).toISOString();

        await updateNotificationJobSafe(
          db,
          job.id,
          {
            status: retry ? 'pending' : 'failed',
            scheduled_at: retry ? nextSchedule : job.scheduled_at,
            last_error: sanitizeErrorMessage(errMessage),
            last_http_status: response.status,
            downstream_status: 'error',
            whatsapp_status: 'failed',
            whatsapp_message_id: waMeta.whatsappMessageId,
            receiver_response: sanitizedBody,
            dispatched_at: dispatchedAt,
            completed_at: retry ? null : failedAt,
            updated_at: failedAt
          },
          true
        );

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
          whatsapp_status: 'failed',
          whatsapp_message_id: waMeta.whatsappMessageId,
          masked_phone: maskedPhone,
          sanitized_error: errMessage,
          response_summary: sanitizedBody || {}
        });

        if (job.event_type === 'feedback') {
          console.error(
            `[SMAV notification][feedback][http_error] job=${job.id} bill=${billNumber || 'n/a'} phone=${maskedPhone || 'n/a'} http=${response.status} retry=${retry} error=${sanitizeErrorMessage(errMessage)}`
          );
        }

        results.push({
          id: job.id,
          outlet_id: job.outlet_id,
          event_type: job.event_type,
          status: retry ? 'retry' : 'failed',
          http_status: response.status,
          downstream_status: 'error',
          whatsapp_status: 'failed',
          error: sanitizeErrorMessage(errMessage)
        });
        continue;
      }

      // Downstream returned HTTP 2xx: never fall into retry catch block after acceptance
      downstreamAccepted = true;
      const completedAt = new Date().toISOString();
      const explicitWaFailed = waMeta.whatsappFailed;
      const explicitDownstreamSkipped = waMeta.downstreamSkipped;
      const finalJobStatus: 'sent' | 'failed' | 'skipped' = explicitWaFailed
        ? 'failed'
        : explicitDownstreamSkipped
          ? 'skipped'
          : 'sent';
      const finalErrMsg = explicitWaFailed
        ? sanitizeErrorMessage(
            waMeta.whatsappError ||
              String(sanitizedBody?.error || sanitizedBody?.message || 'Downstream WhatsApp failure')
          )
        : null;

      await updateNotificationRouteSafe(db, job.outlet_id, {
        last_verified_at: completedAt,
        last_http_status: response.status,
        last_error: finalErrMsg,
        updated_at: completedAt
      });

      const jobUpdate = await updateNotificationJobSafe(
        db,
        job.id,
        {
          status: finalJobStatus,
          last_error: finalErrMsg,
          last_http_status: response.status,
          downstream_status: waMeta.downstreamStatus,
          whatsapp_status: waMeta.whatsappStatus,
          whatsapp_message_id: waMeta.whatsappMessageId,
          receiver_response: sanitizedBody,
          dispatched_at: dispatchedAt,
          completed_at: completedAt,
          updated_at: completedAt
        },
        true
      );

      if (!jobUpdate.ok) {
        console.error(
          `[SMAV notification dispatcher] Job ${job.id} accepted by downstream (HTTP ${response.status}) but status persistence failed: ${jobUpdate.error}`
        );
      }

      const stepName = explicitWaFailed
        ? 'whatsapp_failed'
        : waMeta.whatsappStatus === 'confirmed_delivered' || waMeta.whatsappStatus === 'confirmed_read'
          ? 'whatsapp_delivery_confirmed'
          : waMeta.whatsappStatus === 'whatsapp_api_accepted'
            ? 'whatsapp_api_accepted'
            : explicitDownstreamSkipped
              ? 'downstream_skipped'
              : 'downstream_accepted';

      await recordNotificationStepLog(db, {
        job_id: job.id,
        event_id: job.id,
        bill_id: billId,
        outlet_id: job.outlet_id,
        bill_number: billNumber,
        event_type: job.event_type,
        step: stepName,
        status: finalJobStatus,
        http_status: response.status,
        whatsapp_status: waMeta.whatsappStatus,
        whatsapp_message_id: waMeta.whatsappMessageId,
        masked_phone: maskedPhone,
        sanitized_error: finalErrMsg || (jobUpdate.ok ? null : `Job update failed: ${jobUpdate.error}`),
        response_summary: sanitizedBody || {}
      });

      if (job.event_type === 'feedback') {
        console.info(
          `[SMAV notification][feedback][result] job=${job.id} bill=${billNumber || 'n/a'} phone=${maskedPhone || 'n/a'} status=${finalJobStatus} http=${response.status} waStatus=${waMeta.whatsappStatus} waMsgId=${waMeta.whatsappMessageId || 'none'}${finalErrMsg ? ` error=${finalErrMsg}` : ''}`
        );
      }

      results.push({
        id: job.id,
        outlet_id: job.outlet_id,
        event_type: job.event_type,
        status: finalJobStatus,
        http_status: response.status,
        downstream_status: waMeta.downstreamStatus,
        whatsapp_status: waMeta.whatsappStatus,
        whatsapp_message_id: waMeta.whatsappMessageId,
        ...(finalErrMsg ? { error: finalErrMsg } : {})
      });
    } catch (err: any) {
      const safeErr = sanitizeErrorMessage(err);
      const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError' || /timeout|aborted/i.test(safeErr);
      const nowIso = new Date().toISOString();

      if (downstreamAccepted) {
        // Never reset an already-accepted job back to pending
        results.push({
          id: job.id,
          outlet_id: job.outlet_id,
          event_type: job.event_type,
          status: 'sent',
          error: safeErr
        });
        continue;
      }

      const retry = job.attempts < 5;
      const nextSchedule = new Date(Date.now() + Math.min(60, 2 ** job.attempts) * 60000).toISOString();
      await updateNotificationJobSafe(
        db,
        job.id,
        {
          status: retry ? 'pending' : 'failed',
          scheduled_at: retry ? nextSchedule : job.scheduled_at,
          last_error: safeErr,
          downstream_status: isTimeout ? 'timeout' : 'network_error',
          whatsapp_status: retry ? 'pending' : 'failed',
          dispatched_at: dispatchedAt,
          completed_at: retry ? null : nowIso,
          updated_at: nowIso
        },
        true
      );

      await recordNotificationStepLog(db, {
        job_id: job.id,
        event_id: job.id,
        bill_id: billId,
        outlet_id: job.outlet_id,
        bill_number: billNumber,
        event_type: job.event_type,
        step: retry ? 'retry_scheduled' : 'failed',
        status: retry ? 'retry' : 'failed',
        whatsapp_status: retry ? 'pending' : 'failed',
        masked_phone: maskedPhone,
        sanitized_error: safeErr
      });

      results.push({
        id: job.id,
        outlet_id: job.outlet_id,
        event_type: job.event_type,
        status: retry ? 'retry' : 'failed',
        downstream_status: isTimeout ? 'timeout' : 'network_error',
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

  const dispatchedAt = new Date().toISOString();
  let { data: jobRow, error: jobErr } = await db
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
      bill_number: billNumber,
      dispatched_at: dispatchedAt
    })
    .select('id')
    .single();

  if (jobErr && isMissingColumnError(jobErr)) {
    const legacyInsert = await db
      .from('smav_sale_notification_jobs')
      .insert({
        outlet_id: outlet.id,
        source_type: outlet.category === 'salon' ? 'salon' : outlet.category === 'restaurant' ? 'restaurant' : 'retail',
        source_key: idempotencyKey,
        event_type: eventType,
        status: 'processing',
        scheduled_at: nowIso,
        attempts: 1,
        payload
      })
      .select('id')
      .single();
    jobRow = legacyInsert.data as any;
    jobErr = legacyInsert.error;
  }

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

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-smav-timestamp': timestamp,
        'x-smav-signature': signature,
        'x-smav-event-id': eventId
      },
      body,
      signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS)
    });
  } catch (fetchErr: any) {
    const failedAt = new Date().toISOString();
    const safeErr = sanitizeErrorMessage(fetchErr);
    const isTimeout =
      fetchErr?.name === 'TimeoutError' ||
      fetchErr?.name === 'AbortError' ||
      /timeout|aborted/i.test(safeErr);
    const downstreamErrStatus = isTimeout ? 'timeout' : 'network_error';
    const detailErr = isTimeout
      ? `Downstream request timed out after ${DISPATCH_TIMEOUT_MS / 1000}s (${safeErr})`
      : safeErr;

    await updateNotificationJobSafe(db, eventId, {
      status: 'failed',
      last_error: detailErr,
      last_http_status: null,
      downstream_status: downstreamErrStatus,
      whatsapp_status: 'failed',
      dispatched_at: dispatchedAt,
      completed_at: failedAt,
      updated_at: failedAt
    });

    await updateNotificationRouteSafe(db, outlet.id, {
      last_verified_at: failedAt,
      last_http_status: null,
      last_error: detailErr,
      updated_at: failedAt
    });

    await recordNotificationStepLog(db, {
      job_id: eventId,
      event_id: eventId,
      bill_id: billId,
      outlet_id: outlet.id,
      bill_number: billNumber,
      event_type: eventType,
      step: isTimeout ? 'e2e_test_timeout' : 'e2e_test_network_error',
      status: 'failed',
      whatsapp_status: 'failed',
      masked_phone: maskedPhone,
      sanitized_error: detailErr
    });

    steps.push({
      step: 'stage3_downstream_and_whatsapp',
      status: 'failed',
      timestamp: failedAt,
      detail: detailErr
    });

    return {
      success: false,
      outlet_id: outlet.id,
      outlet_name: outlet.name,
      bill_id: billId,
      bill_number: billNumber,
      event_id: eventId,
      event_type: eventType,
      masked_phone: maskedPhone,
      http_status: null,
      downstream_status: downstreamErrStatus,
      whatsapp_status: 'failed',
      whatsapp_message_id: null,
      receiver_response: null,
      sanitized_error: detailErr,
      steps
    };
  }

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
  const waMeta = extractWhatsAppMetadata(parsedBody, response.ok);
  const completedAt = new Date().toISOString();
  const ok = response.ok && !waMeta.whatsappFailed;
  const finalStatus: 'sent' | 'failed' | 'skipped' = !ok
    ? 'failed'
    : waMeta.downstreamSkipped
      ? 'skipped'
      : 'sent';
  const errMsg = ok
    ? null
    : sanitizeErrorMessage(
        waMeta.whatsappError ||
          String(sanitizedBody?.error || sanitizedBody?.message || `HTTP ${response.status}`)
      );

  const jobUpdate = await updateNotificationJobSafe(db, eventId, {
    status: finalStatus,
    last_error: errMsg,
    last_http_status: response.status,
    downstream_status: waMeta.downstreamStatus,
    whatsapp_status: waMeta.whatsappStatus,
    whatsapp_message_id: waMeta.whatsappMessageId,
    receiver_response: sanitizedBody,
    dispatched_at: dispatchedAt,
    completed_at: completedAt,
    updated_at: completedAt
  });

  await updateNotificationRouteSafe(db, outlet.id, {
    last_verified_at: completedAt,
    last_http_status: response.status,
    last_error: errMsg,
    updated_at: completedAt
  });

  await recordNotificationStepLog(db, {
    job_id: eventId,
    event_id: eventId,
    bill_id: billId,
    outlet_id: outlet.id,
    bill_number: billNumber,
    event_type: eventType,
    step: 'e2e_test_completed',
    status: finalStatus,
    http_status: response.status,
    whatsapp_status: waMeta.whatsappStatus,
    whatsapp_message_id: waMeta.whatsappMessageId,
    masked_phone: maskedPhone,
    sanitized_error: errMsg || (jobUpdate.ok ? null : `Job update failed: ${jobUpdate.error}`),
    response_summary: sanitizedBody || {}
  });

  steps.push({
    step: 'stage3_downstream_and_whatsapp',
    status: ok ? 'ok' : 'failed',
    timestamp: completedAt,
    detail: `HTTP ${response.status} · downstream=${waMeta.downstreamStatus} · whatsapp=${waMeta.whatsappStatus}${waMeta.whatsappMessageId ? ` · id=${waMeta.whatsappMessageId}` : ''}${!jobUpdate.ok ? ` · job_update_warning=${jobUpdate.error}` : ''}`
  });

  let feedbackJobId: string | null = null;
  let feedbackScheduledAt: string | null = null;
  if (ok && eventType === 'receipt' && route.send_feedback) {
    feedbackScheduledAt = new Date(Date.parse(nowIso) + FEEDBACK_DELAY_MS).toISOString();
    const feedbackSourceType =
      outlet.category === 'salon' ? 'salon' : outlet.category === 'restaurant' ? 'restaurant' : 'retail';
    const feedbackPayload = {
      bill_id: billId,
      bill_number: billNumber,
      customer_name: 'SMAV Integration Test',
      customer_phone: digits,
      billed_at: nowIso,
      diagnostic_e2e_test: true
    };

    let { data: fbRow, error: fbErr } = await db
      .from('smav_sale_notification_jobs')
      .upsert(
        {
          outlet_id: outlet.id,
          source_type: feedbackSourceType,
          source_key: idempotencyKey,
          event_type: 'feedback',
          status: 'pending',
          scheduled_at: feedbackScheduledAt,
          attempts: 0,
          payload: feedbackPayload,
          bill_id: billId,
          bill_number: billNumber
        },
        { onConflict: 'outlet_id,source_type,source_key,event_type', ignoreDuplicates: true }
      )
      .select('id')
      .maybeSingle();

    if (fbErr && isMissingColumnError(fbErr)) {
      const legacyFb = await db
        .from('smav_sale_notification_jobs')
        .upsert(
          {
            outlet_id: outlet.id,
            source_type: feedbackSourceType,
            source_key: idempotencyKey,
            event_type: 'feedback',
            status: 'pending',
            scheduled_at: feedbackScheduledAt,
            attempts: 0,
            payload: feedbackPayload
          },
          { onConflict: 'outlet_id,source_type,source_key,event_type', ignoreDuplicates: true }
        )
        .select('id')
        .maybeSingle();
      fbRow = legacyFb.data as any;
      fbErr = legacyFb.error;
    }

    if (fbErr) {
      const fbErrMsg = sanitizeErrorMessage(fbErr.message || 'Failed to schedule feedback job');
      steps.push({
        step: 'stage2_feedback_scheduled',
        status: 'failed',
        timestamp: new Date().toISOString(),
        detail: `Feedback queue insert failed: ${fbErrMsg}`
      });
    } else {
      feedbackJobId = fbRow?.id ? String(fbRow.id) : null;
      await recordNotificationStepLog(db, {
        job_id: feedbackJobId,
        event_id: feedbackJobId,
        bill_id: billId,
        outlet_id: outlet.id,
        bill_number: billNumber,
        event_type: 'feedback',
        step: 'e2e_feedback_scheduled',
        status: 'pending',
        masked_phone: maskedPhone
      });
      steps.push({
        step: 'stage2_feedback_scheduled',
        status: 'ok',
        timestamp: new Date().toISOString(),
        detail: `Scheduled feedback job${feedbackJobId ? ` (${feedbackJobId})` : ''} for ${feedbackScheduledAt} (+2m delay)`
      });
    }
  }

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
    whatsapp_status: waMeta.whatsappStatus,
    whatsapp_message_id: waMeta.whatsappMessageId,
    receiver_response: sanitizedBody,
    sanitized_error: errMsg,
    job_status_persisted: jobUpdate.ok,
    ...(jobUpdate.error ? { job_update_error: jobUpdate.error } : {}),
    feedback_job_id: feedbackJobId,
    feedback_scheduled_at: feedbackScheduledAt,
    steps
  };
}
