import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  GLOSSYLOOKS_BILL_SYNC_DEFAULT_URL,
  normalizeDynamicBranchCode,
  normalizeSourceSystem,
  type CentralBillSourceSystem,
} from './centralBillNumbering';

export type OutboundSaleEventStatus =
  | 'pending'
  | 'processing'
  | 'sent'
  | 'delivered'
  | 'acknowledged'
  | 'failed';

export interface OutboundSaleItemPayload {
  service_id: string | null;
  service_name: string;
  stylist_id: string | null;
  stylist_name: string | null;
  quantity: number;
  unit_price: number;
  discount_percent: number;
  line_total: number;
}

export type OutboundSaleEventType =
  | 'central_bill_finalized'
  | 'central_bill_updated'
  | 'central_bill_voided'
  | 'central_bill_restored';

export interface CentralBillFinalizedPayload {
  event_id: string;
  event_type: OutboundSaleEventType;
  event_timestamp?: string;
  idempotency_key: string;
  central_bill_id: string | null;
  central_bill_number: string;
  bill_number: string;
  status?: 'FINALIZED' | 'VOIDED';
  outlet_id: string;
  outlet_code: string;
  branch_id: string;
  branch_code: string;
  branch_name: string;
  local_branch_id: string;
  external_branch_id: string;
  external_order_id: string | null;
  customer_name: string;
  customer_phone: string;
  cashier_name: string;
  payment_mode: string;
  payment_status: string;
  subtotal: number;
  discount: number;
  tax_amount: number;
  grand_total: number;
  paid_amount: number;
  due_amount: number;
  billed_at: string;
  source_system: CentralBillSourceSystem;
  items: OutboundSaleItemPayload[];
  is_voided?: boolean;
  deleted_at?: string | null;
  deleted_by?: string | null;
  delete_reason?: string | null;
  restored_at?: string | null;
  restored_by?: string | null;
  restore_reason?: string | null;
  edit_version?: number;
  // Canonical camelCase mirrors for cross-consumer compatibility
  eventId?: string;
  eventType?: OutboundSaleEventType;
  eventTimestamp?: string;
  centralBillId?: string | null;
  billNumber?: string;
  externalOrderId?: string | null;
  outletId?: string;
  outletCode?: string;
}

export interface OutboundSaleEventRecord {
  id: string;
  outlet_id: string;
  outlet_code: string;
  event_type: OutboundSaleEventType;
  idempotency_key: string;
  central_bill_id: string | null;
  central_bill_number: string;
  local_bill_id: string | null;
  branch_id: string | null;
  branch_code: string;
  branch_name: string;
  target_url: string;
  payload: CentralBillFinalizedPayload;
  status: OutboundSaleEventStatus;
  attempts: number;
  max_attempts: number;
  next_retry_at: string;
  last_http_status: number | null;
  last_error: string | null;
  response_summary: Record<string, unknown> | null;
  sent_at: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
}

const DISPATCH_TIMEOUT_MS = 20_000;
const RETRY_BACKOFF_SECONDS = [30, 60, 120, 300, 600, 1200, 1800];

const ALLOWED_OUTBOUND_HOST_PATTERNS = [
  /^www\.glossylooks\.in$/i,
  /^glossylooks\.in$/i,
  /\.glossylooks\.in$/i,
  /\.vercel\.app$/i,
  /\.run\.app$/i,
];

function sanitizeOutboundError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? 'Unknown error');
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(
      /(apikey|authorization|x-smav-signature|x-integration-key|secret|token|password)\s*[:=]\s*\S+/gi,
      '$1=[REDACTED]'
    )
    .replace(/\b[0-9a-f]{48,}\b/gi, '[REDACTED_HEX]')
    .slice(0, 400);
}

function isSafeHttpsWebhookUrl(rawUrl: string): { ok: boolean; normalized?: string; reason?: string } {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return { ok: false, reason: 'Webhook target URL is empty' };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'Webhook target URL is invalid' };
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'Webhook target URL must use HTTPS' };
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '0.0.0.0' ||
    host === '169.254.169.254' ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    return { ok: false, reason: 'Webhook target host is not permitted' };
  }
  const hostAllowed = ALLOWED_OUTBOUND_HOST_PATTERNS.some((rx) => rx.test(host));
  if (!hostAllowed) {
    return { ok: false, reason: `Webhook host "${host}" is outside the permitted allowlist` };
  }
  return { ok: true, normalized: parsed.toString() };
}

function roundMoney(value: unknown, fallback = 0): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.round(num * 100) / 100;
}

export function buildCentralBillFinalizedPayload(params: {
  eventId: string;
  idempotencyKey: string;
  centralBillId: string | null;
  centralBillNumber: string;
  outletId: string;
  outletCode?: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  externalOrderId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  cashierName?: string | null;
  paymentMode?: string | null;
  paymentStatus?: string | null;
  subtotal?: number | null;
  discount?: number | null;
  taxAmount?: number | null;
  grandTotal: number;
  paidAmount?: number | null;
  dueAmount?: number | null;
  billedAt?: string | null;
  sourceSystem?: string | null;
  items: Array<Record<string, any>>;
}): CentralBillFinalizedPayload {
  const cleanBranchId = String(params.branchId || '').trim();
  const cleanBranchCode = normalizeDynamicBranchCode(params.branchCode);
  const cleanBranchName = String(params.branchName || '').trim();
  if (!cleanBranchId || !cleanBranchCode || !cleanBranchName) {
    throw new Error(
      `BRANCH_REQUIRED: Cannot build finalized sale event without canonical branch_id, branch_code, and branch_name.`
    );
  }

  const normalizedItems: OutboundSaleItemPayload[] = (Array.isArray(params.items) ? params.items : []).map((it) => {
    const qty = Math.max(1, Math.round(Number(it.quantity ?? it.qty ?? 1) || 1));
    const unitPrice = roundMoney(it.unit_price ?? it.unitPrice ?? it.price ?? 0, 0);
    const discountPercent = roundMoney(it.discount_percent ?? it.discountPercent ?? 0, 0);
    const computedLine = roundMoney(qty * unitPrice * (1 - discountPercent / 100), 0);
    const lineTotal = roundMoney(it.line_total ?? it.lineTotal ?? computedLine, computedLine);
    return {
      service_id: String(it.service_id || it.serviceId || it.id || '').trim() || null,
      service_name: String(it.service_name || it.serviceName || it.name || 'Service').trim(),
      stylist_id: String(it.stylist_id || it.stylistId || '').trim() || null,
      stylist_name: String(it.stylist_name || it.stylistName || it.stylist || '').trim() || null,
      quantity: qty,
      unit_price: unitPrice,
      discount_percent: discountPercent,
      line_total: lineTotal,
    };
  });

  const grandTotal = roundMoney(params.grandTotal, 0);
  const itemsSubtotal = roundMoney(
    normalizedItems.reduce((sum, it) => sum + it.unit_price * it.quantity, 0),
    grandTotal
  );
  const subtotal =
    params.subtotal !== undefined && params.subtotal !== null ? roundMoney(params.subtotal, itemsSubtotal) : itemsSubtotal;
  const discount = roundMoney(params.discount ?? 0, 0);
  const taxAmount = roundMoney(params.taxAmount ?? 0, 0);
  const paidAmount =
    params.paidAmount !== undefined && params.paidAmount !== null ? roundMoney(params.paidAmount, grandTotal) : grandTotal;
  const dueAmount =
    params.dueAmount !== undefined && params.dueAmount !== null
      ? roundMoney(params.dueAmount, Math.max(0, roundMoney(grandTotal - paidAmount, 0)))
      : Math.max(0, roundMoney(grandTotal - paidAmount, 0));

  const paymentStatus = String(params.paymentStatus || '').trim().toLowerCase() || (dueAmount > 0 ? 'partial' : 'paid');
  const eventTimestamp = new Date().toISOString();
  const normalizedOutletCode = String(params.outletCode || 'glossylooks').trim().toLowerCase() || 'glossylooks';
  const normalizedExternalOrderId = params.externalOrderId ? String(params.externalOrderId).trim() : null;

  return {
    event_id: params.eventId,
    event_type: 'central_bill_finalized',
    event_timestamp: eventTimestamp,
    idempotency_key: params.idempotencyKey,
    central_bill_id: params.centralBillId,
    central_bill_number: params.centralBillNumber,
    bill_number: params.centralBillNumber,
    status: 'FINALIZED',
    outlet_id: params.outletId,
    outlet_code: normalizedOutletCode,
    branch_id: cleanBranchId,
    branch_code: cleanBranchCode,
    branch_name: cleanBranchName,
    local_branch_id: cleanBranchId,
    external_branch_id: cleanBranchId,
    external_order_id: normalizedExternalOrderId,
    customer_name: String(params.customerName || '').trim() || 'Walk-in Customer',
    customer_phone: String(params.customerPhone || '').trim(),
    cashier_name: String(params.cashierName || '').trim() || 'SMAV Counter',
    payment_mode: String(params.paymentMode || 'upi').trim().toLowerCase(),
    payment_status: paymentStatus,
    subtotal,
    discount,
    tax_amount: taxAmount,
    grand_total: grandTotal,
    paid_amount: paidAmount,
    due_amount: dueAmount,
    billed_at: params.billedAt || eventTimestamp,
    source_system: normalizeSourceSystem(params.sourceSystem),
    items: normalizedItems,
    eventId: params.eventId,
    eventType: 'central_bill_finalized',
    eventTimestamp,
    centralBillId: params.centralBillId,
    billNumber: params.centralBillNumber,
    externalOrderId: normalizedExternalOrderId,
    outletId: params.outletId,
    outletCode: normalizedOutletCode,
  };
}

function computeNextRetryIso(attempts: number, nowMs = Date.now()): string {
  const idx = Math.min(Math.max(attempts - 1, 0), RETRY_BACKOFF_SECONDS.length - 1);
  return new Date(nowMs + RETRY_BACKOFF_SECONDS[idx] * 1000).toISOString();
}

function classifyDeliveryResponse(parsedBody: Record<string, unknown> | null): {
  status: 'delivered' | 'acknowledged' | 'sent';
  summary: Record<string, unknown>;
} {
  if (!parsedBody) {
    return { status: 'sent', summary: {} };
  }
  const summary: Record<string, unknown> = {};
  for (const key of [
    'ok',
    'success',
    'status',
    'acknowledged',
    'duplicate',
    'idempotent',
    'order_id',
    'orderId',
    'payment_id',
    'paymentId',
    'ledger_id',
    'message',
  ]) {
    if (parsedBody[key] !== undefined) {
      summary[key] = parsedBody[key];
    }
  }
  const statusStr = String(parsedBody.status || '').toLowerCase();
  if (parsedBody.acknowledged === true || statusStr === 'acknowledged') {
    return { status: 'acknowledged', summary };
  }
  if (
    parsedBody.ok === true ||
    parsedBody.success === true ||
    parsedBody.order_id ||
    parsedBody.orderId ||
    parsedBody.payment_id ||
    parsedBody.paymentId ||
    parsedBody.duplicate === true
  ) {
    return { status: 'delivered', summary };
  }
  return { status: 'sent', summary };
}

export class OutboundOutboxUnavailableError extends Error {
  public readonly code = 'OUTBOUND_OUTBOX_UNAVAILABLE';
  public readonly retryable = true;

  constructor(message: string) {
    super(message);
    this.name = 'OutboundOutboxUnavailableError';
  }
}

/**
 * Durable-Only Outbound Sale Event Coordinator.
 * Persists `central_bill_finalized` events strictly to public.smav_outbound_sale_events
 * and dispatches strictly via public.smav_claim_due_outbound_sale_events.
 * Never falls back to in-memory queuing so process restarts can never drop finalized sales.
 */
export class OutboundSaleEventCoordinator {
  public async resolveTargetUrl(db: SupabaseClient | null, outletId: string): Promise<string> {
    const envUrl = String(process.env.GLOSSYLOOKS_BILL_SYNC_WEBHOOK_URL || '').trim();
    if (envUrl) return envUrl;
    if (db) {
      try {
        const { data } = await db
          .from('smav_outlet_notification_routes')
          .select('endpoint_url')
          .eq('outlet_id', outletId)
          .maybeSingle();
        const routeUrl = String((data as any)?.endpoint_url || '').trim();
        if (routeUrl) return routeUrl;
      } catch {}
    }
    return GLOSSYLOOKS_BILL_SYNC_DEFAULT_URL;
  }

  public async enqueueFinalizedSaleEvent(params: {
    db: SupabaseClient | null;
    outletId: string;
    outletCode?: string;
    idempotencyKey: string;
    centralBillId: string | null;
    centralBillNumber: string;
    localBillId?: string | null;
    branchId: string;
    branchCode: string;
    branchName: string;
    externalOrderId?: string | null;
    customerName?: string | null;
    customerPhone?: string | null;
    cashierName?: string | null;
    paymentMode?: string | null;
    paymentStatus?: string | null;
    subtotal?: number | null;
    discount?: number | null;
    taxAmount?: number | null;
    grandTotal: number;
    paidAmount?: number | null;
    dueAmount?: number | null;
    billedAt?: string | null;
    sourceSystem?: string | null;
    items: Array<Record<string, any>>;
    targetUrlOverride?: string;
  }): Promise<{
    eventId: string;
    status: OutboundSaleEventStatus;
    storageMode: 'database';
    duplicate: boolean;
  }> {
    const cleanIdem = String(params.idempotencyKey || '').trim();
    if (!cleanIdem) {
      throw new Error('IDEMPOTENCY_KEY_REQUIRED: idempotencyKey is required to enqueue outbound sale event.');
    }

    if (!params.db) {
      throw new OutboundOutboxUnavailableError(
        'OUTBOUND_OUTBOX_UNAVAILABLE: Central service database is unavailable; durable smav_outbound_sale_events outbox is required.'
      );
    }

    const rawTarget = params.targetUrlOverride || (await this.resolveTargetUrl(params.db, params.outletId));
    const urlCheck = isSafeHttpsWebhookUrl(rawTarget);
    if (!urlCheck.ok || !urlCheck.normalized) {
      throw new Error(`INVALID_WEBHOOK_URL: ${urlCheck.reason || 'Invalid outbound webhook URL'}`);
    }

    const eventId = crypto.randomUUID();
    const payload = buildCentralBillFinalizedPayload({
      eventId,
      idempotencyKey: cleanIdem,
      centralBillId: params.centralBillId,
      centralBillNumber: params.centralBillNumber,
      outletId: params.outletId,
      outletCode: params.outletCode || 'glossylooks',
      branchId: params.branchId,
      branchCode: params.branchCode,
      branchName: params.branchName,
      externalOrderId: params.externalOrderId,
      customerName: params.customerName,
      customerPhone: params.customerPhone,
      cashierName: params.cashierName,
      paymentMode: params.paymentMode,
      paymentStatus: params.paymentStatus,
      subtotal: params.subtotal,
      discount: params.discount,
      taxAmount: params.taxAmount,
      grandTotal: params.grandTotal,
      paidAmount: params.paidAmount,
      dueAmount: params.dueAmount,
      billedAt: params.billedAt,
      sourceSystem: params.sourceSystem,
      items: params.items,
    });

    const validCentralUuid =
      params.centralBillId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.centralBillId)
        ? params.centralBillId
        : null;

    const existingRes = await params.db
      .from('smav_outbound_sale_events')
      .select('id, status')
      .eq('outlet_id', params.outletId)
      .eq('event_type', 'central_bill_finalized')
      .eq('idempotency_key', cleanIdem)
      .maybeSingle();

    if (existingRes.error) {
      const reason = sanitizeOutboundError(existingRes.error);
      throw new OutboundOutboxUnavailableError(
        `OUTBOUND_OUTBOX_UNAVAILABLE: Unable to query durable smav_outbound_sale_events table (${reason}).`
      );
    }

    if (existingRes.data?.id) {
      return {
        eventId: String(existingRes.data.id),
        status: String(existingRes.data.status) as OutboundSaleEventStatus,
        storageMode: 'database',
        duplicate: true,
      };
    }

    const nowIso = new Date().toISOString();
    const baseInsertRow = {
      id: eventId,
      outlet_id: params.outletId,
      outlet_code: payload.outlet_code,
      event_type: 'central_bill_finalized',
      idempotency_key: cleanIdem,
      central_bill_id: validCentralUuid,
      central_bill_number: payload.central_bill_number,
      local_bill_id: params.localBillId || null,
      branch_code: payload.branch_code,
      branch_name: payload.branch_name,
      target_url: urlCheck.normalized,
      payload,
      status: 'pending',
      attempts: 0,
      max_attempts: 8,
      next_retry_at: nowIso,
    };
    const insertRowWithBranchId = {
      ...baseInsertRow,
      branch_id: payload.branch_id,
    };

    let insRes = await params.db
      .from('smav_outbound_sale_events')
      .upsert(insertRowWithBranchId, {
        onConflict: 'outlet_id,event_type,idempotency_key',
        ignoreDuplicates: true,
      })
      .select('id, status')
      .maybeSingle();

    // Compatibility fallback if Migration 022 branch_id column is not yet added to smav_outbound_sale_events
    if (insRes.error && /column .*branch_id.* does not exist/i.test(String(insRes.error.message || ''))) {
      insRes = await params.db
        .from('smav_outbound_sale_events')
        .upsert(baseInsertRow, {
          onConflict: 'outlet_id,event_type,idempotency_key',
          ignoreDuplicates: true,
        })
        .select('id, status')
        .maybeSingle();
    }

    if (insRes.error) {
      const reason = sanitizeOutboundError(insRes.error);
      console.error('[SMAV Outbound Sale Sync] Durable outbox persistence failed:', reason);
      throw new OutboundOutboxUnavailableError(
        `OUTBOUND_OUTBOX_UNAVAILABLE: Durable persistence to smav_outbound_sale_events failed (${reason}).`
      );
    }

    if (insRes.data?.id) {
      return {
        eventId: String(insRes.data.id),
        status: String(insRes.data.status) as OutboundSaleEventStatus,
        storageMode: 'database',
        duplicate: false,
      };
    }

    const racedRes = await params.db
      .from('smav_outbound_sale_events')
      .select('id, status')
      .eq('outlet_id', params.outletId)
      .eq('event_type', 'central_bill_finalized')
      .eq('idempotency_key', cleanIdem)
      .maybeSingle();

    if (racedRes.error || !racedRes.data?.id) {
      const reason = sanitizeOutboundError(racedRes.error || 'Row not found after idempotent upsert');
      throw new OutboundOutboxUnavailableError(
        `OUTBOUND_OUTBOX_UNAVAILABLE: Unable to confirm durable outbox row in smav_outbound_sale_events (${reason}).`
      );
    }

    return {
      eventId: String(racedRes.data.id),
      status: String(racedRes.data.status) as OutboundSaleEventStatus,
      storageMode: 'database',
      duplicate: true,
    };
  }

  /**
   * Best-effort durable enqueue for bill edit, soft-delete (void), and restore lifecycle
   * events so external admin portals (e.g. Glossy Looks Admin) stay synchronized.
   */
  public async enqueueBillLifecycleEvent(params: {
    db: SupabaseClient | null;
    eventType: 'central_bill_updated' | 'central_bill_voided' | 'central_bill_restored';
    outletId: string;
    outletCode: string;
    idempotencyKey: string;
    centralBillId?: string | null;
    centralBillNumber: string;
    localBillId?: string | null;
    externalOrderId?: string | null;
    branchId?: string | null;
    branchCode?: string | null;
    branchName?: string | null;
    customerName?: string | null;
    customerPhone?: string | null;
    paymentMode?: string | null;
    subtotal?: number | null;
    discount?: number | null;
    taxAmount?: number | null;
    grandTotal?: number;
    billedAt?: string | null;
    items?: Array<Record<string, any>>;
    isVoided: boolean;
    deletedAt?: string | null;
    deletedBy?: string | null;
    deleteReason?: string | null;
    restoredAt?: string | null;
    restoredBy?: string | null;
    restoreReason?: string | null;
    editVersion?: number;
  }): Promise<{ enqueued: boolean; eventId?: string; skippedReason?: string }> {
    if (!params.db) return { enqueued: false, skippedReason: 'service_db_unavailable' };
    const targetUrl = await this.resolveTargetUrl(params.db, params.outletId);
    const urlCheck = isSafeHttpsWebhookUrl(targetUrl);
    if (!urlCheck.ok || !urlCheck.normalized) {
      return { enqueued: false, skippedReason: urlCheck.reason || 'no_valid_webhook_url' };
    }

    const eventId = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const cleanBranchCode = normalizeDynamicBranchCode(params.branchCode || '') || 'MAIN';
    const cleanBranchId = String(params.branchId || '').trim();
    const canonicalPayloadCentralId =
      String(params.centralBillId || params.localBillId || '').trim() || null;
    const basePayload = buildCentralBillFinalizedPayload({
      eventId,
      idempotencyKey: params.idempotencyKey,
      centralBillId: canonicalPayloadCentralId,
      centralBillNumber: params.centralBillNumber,
      outletId: params.outletId,
      outletCode: params.outletCode || 'glossylooks',
      branchId: cleanBranchId || cleanBranchCode,
      branchCode: cleanBranchCode,
      branchName: params.branchName || cleanBranchCode,
      externalOrderId: params.externalOrderId || null,
      customerName: params.customerName,
      customerPhone: params.customerPhone,
      paymentMode: params.paymentMode,
      subtotal: params.subtotal,
      discount: params.discount,
      taxAmount: params.taxAmount,
      grandTotal: params.grandTotal ?? 0,
      billedAt: params.billedAt,
      sourceSystem: 'smav_web_pos',
      items: Array.isArray(params.items) ? params.items : [],
    });

    const payload: CentralBillFinalizedPayload = {
      ...basePayload,
      event_type: params.eventType,
      eventType: params.eventType,
      event_timestamp: nowIso,
      eventTimestamp: nowIso,
      status: params.isVoided ? 'VOIDED' : 'FINALIZED',
      is_voided: params.isVoided,
      deleted_at: params.deletedAt || null,
      deleted_by: params.deletedBy || null,
      delete_reason: params.deleteReason || null,
      restored_at: params.restoredAt || null,
      restored_by: params.restoredBy || null,
      restore_reason: params.restoreReason || null,
      edit_version: params.editVersion,
    };

    const candidateCentralUuid =
      params.centralBillId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.centralBillId)
        ? params.centralBillId
        : null;

    // smav_outbound_sale_events.central_bill_id references smav_central_bill_numbers(id).
    // Only populate the FK column when the UUID exists in smav_central_bill_numbers; payload always retains canonical ID.
    let dbFkCentralUuid: string | null = null;
    if (candidateCentralUuid) {
      const checkFk = await params.db
        .from('smav_central_bill_numbers')
        .select('id')
        .eq('id', candidateCentralUuid)
        .maybeSingle();
      if (!checkFk.error && checkFk.data?.id) {
        dbFkCentralUuid = candidateCentralUuid;
      }
    }

    const insertRow = {
      id: eventId,
      outlet_id: params.outletId,
      outlet_code: payload.outlet_code,
      event_type: params.eventType,
      idempotency_key: params.idempotencyKey,
      central_bill_id: dbFkCentralUuid,
      central_bill_number: payload.central_bill_number,
      local_bill_id: params.localBillId || null,
      branch_id: cleanBranchId || null,
      branch_code: payload.branch_code,
      branch_name: payload.branch_name,
      target_url: urlCheck.normalized,
      payload,
      status: 'pending',
      attempts: 0,
      max_attempts: 8,
      next_retry_at: nowIso,
    };

    const insRes = await params.db
      .from('smav_outbound_sale_events')
      .upsert(insertRow, {
        onConflict: 'outlet_id,event_type,idempotency_key',
        ignoreDuplicates: true,
      })
      .select('id')
      .maybeSingle();

    if (insRes.error) {
      // Non-fatal if Migration 024 hasn't widened the event_type check constraint yet
      console.warn(
        `[SMAV Outbound Lifecycle Sync] Unable to enqueue ${params.eventType} for ${params.centralBillNumber}: ${sanitizeOutboundError(insRes.error)}`
      );
      return { enqueued: false, skippedReason: sanitizeOutboundError(insRes.error) };
    }

    return { enqueued: true, eventId: String(insRes.data?.id || eventId) };
  }

  public async dispatchDueOutboundSaleEvents(
    db: SupabaseClient | null,
    options?: { limit?: number; fetchImpl?: typeof fetch; nowMs?: number }
  ): Promise<{
    processed: number;
    delivered: number;
    sent: number;
    failed: number;
  }> {
    if (!db) {
      throw new OutboundOutboxUnavailableError(
        'OUTBOUND_OUTBOX_UNAVAILABLE: Central service database is unavailable; cannot claim durable outbound sale events.'
      );
    }

    const limit = Math.min(50, Math.max(1, options?.limit || 20));
    const fetchFn = options?.fetchImpl || fetch;
    const nowMs = options?.nowMs ?? Date.now();
    const integrationKey = String(process.env.GLOSSYLOOKS_INTEGRATION_KEY || '').trim();
    const dispatchSecret = String(process.env.SMAV_DISPATCH_SECRET || '').trim();

    const { data, error } = await db.rpc('smav_claim_due_outbound_sale_events', {
      p_limit: limit,
    });

    if (error || !Array.isArray(data)) {
      const reason = sanitizeOutboundError(error || 'smav_claim_due_outbound_sale_events returned non-array payload');
      console.error('[SMAV Outbound Sale Sync] Durable claim RPC unavailable/failed:', reason);
      throw new OutboundOutboxUnavailableError(
        `OUTBOUND_OUTBOX_UNAVAILABLE: smav_claim_due_outbound_sale_events RPC unavailable or failed (${reason}).`
      );
    }

    const claimedDbEvents = data as OutboundSaleEventRecord[];

    let delivered = 0;
    let sent = 0;
    let failed = 0;

    for (const rec of claimedDbEvents) {
      const urlCheck = isSafeHttpsWebhookUrl(rec.target_url);
      if (!urlCheck.ok || !urlCheck.normalized) {
        failed += 1;
        await this.markFailed(db, rec, {
          httpStatus: null,
          errorMessage: urlCheck.reason || 'Invalid webhook URL',
          nowMs,
        });
        continue;
      }

      if (!integrationKey || !dispatchSecret) {
        failed += 1;
        await this.markFailed(db, rec, {
          httpStatus: null,
          errorMessage: !integrationKey
            ? 'Server missing GLOSSYLOOKS_INTEGRATION_KEY for outbound sale sync'
            : 'Server missing SMAV_DISPATCH_SECRET for outbound HMAC signing',
          nowMs,
        });
        continue;
      }

      const resolvedBranchId = rec.branch_id || rec.payload.branch_id || rec.payload.local_branch_id || '';
      const resolvedEventType: OutboundSaleEventType = rec.event_type || rec.payload.event_type || 'central_bill_finalized';
      const resolvedCentralBillId =
        rec.central_bill_id ?? rec.payload.central_bill_id ?? rec.local_bill_id ?? null;
      const resolvedEventTimestamp = rec.payload.event_timestamp || rec.created_at || new Date(nowMs).toISOString();
      const resolvedStatus: 'FINALIZED' | 'VOIDED' =
        resolvedEventType === 'central_bill_voided' || rec.payload.is_voided ? 'VOIDED' : 'FINALIZED';
      const bodyObj: CentralBillFinalizedPayload = {
        ...rec.payload,
        event_id: rec.id,
        event_type: resolvedEventType,
        event_timestamp: resolvedEventTimestamp,
        idempotency_key: rec.idempotency_key,
        central_bill_id: resolvedCentralBillId,
        central_bill_number: rec.central_bill_number,
        bill_number: rec.central_bill_number,
        status: resolvedStatus,
        outlet_id: rec.outlet_id,
        outlet_code: rec.outlet_code || rec.payload.outlet_code || 'glossylooks',
        branch_id: resolvedBranchId,
        branch_code: rec.branch_code || rec.payload.branch_code,
        branch_name: rec.branch_name || rec.payload.branch_name,
        local_branch_id: resolvedBranchId,
        external_branch_id: resolvedBranchId,
        eventId: rec.id,
        eventType: resolvedEventType,
        eventTimestamp: resolvedEventTimestamp,
        centralBillId: resolvedCentralBillId,
        billNumber: rec.central_bill_number,
        externalOrderId: rec.payload.external_order_id ?? null,
        outletId: rec.outlet_id,
        outletCode: rec.outlet_code || rec.payload.outlet_code || 'glossylooks',
      };
      const rawBody = JSON.stringify(bodyObj);
      const timestamp = String(Math.floor(nowMs / 1000));
      const signature = crypto
        .createHmac('sha256', dispatchSecret)
        .update(`${timestamp}.${rawBody}`)
        .digest('hex');

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Integration-Key': integrationKey,
        'X-SMAV-Source': 'smav_central_billing',
        'X-SMAV-Event-Id': rec.id,
        'X-Idempotency-Key': rec.idempotency_key,
        'X-SMAV-Timestamp': timestamp,
        'X-SMAV-Signature': signature,
      };

      try {
        const resp = await fetchFn(urlCheck.normalized, {
          method: 'POST',
          headers,
          body: rawBody,
          signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
        });
        const rawText = await resp.text().catch(() => '');
        let parsedBody: Record<string, unknown> | null = null;
        if (rawText) {
          try {
            const parsed = JSON.parse(rawText);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              parsedBody = parsed as Record<string, unknown>;
            }
          } catch {
            parsedBody = null;
          }
        }

        if (!resp.ok) {
          failed += 1;
          const downstreamMsg =
            (parsedBody && typeof parsedBody.message === 'string' && parsedBody.message) ||
            (parsedBody && typeof parsedBody.error === 'string' && parsedBody.error) ||
            `HTTP ${resp.status}`;
          await this.markFailed(db, rec, {
            httpStatus: resp.status,
            errorMessage: sanitizeOutboundError(`GlossyLooks webhook rejected event: ${downstreamMsg}`),
            responseSummary: parsedBody ? classifyDeliveryResponse(parsedBody).summary : null,
            nowMs,
          });
          continue;
        }

        const classified = classifyDeliveryResponse(parsedBody);
        const nowIso = new Date(nowMs).toISOString();
        if (classified.status === 'delivered' || classified.status === 'acknowledged') {
          delivered += 1;
        } else {
          sent += 1;
        }

        rec.status = classified.status;
        rec.last_http_status = resp.status;
        rec.last_error = null;
        rec.response_summary = classified.summary;
        rec.sent_at = rec.sent_at || nowIso;
        rec.delivered_at = classified.status === 'sent' ? null : nowIso;
        rec.updated_at = nowIso;

        await db
          .from('smav_outbound_sale_events')
          .update({
            status: rec.status,
            last_http_status: rec.last_http_status,
            last_error: null,
            response_summary: rec.response_summary,
            sent_at: rec.sent_at,
            delivered_at: rec.delivered_at,
            updated_at: nowIso,
          })
          .eq('id', rec.id);
      } catch (err) {
        failed += 1;
        await this.markFailed(db, rec, {
          httpStatus: null,
          errorMessage: sanitizeOutboundError(err),
          nowMs,
        });
      }
    }

    return {
      processed: claimedDbEvents.length,
      delivered,
      sent,
      failed,
    };
  }

  private async markFailed(
    db: SupabaseClient,
    rec: OutboundSaleEventRecord,
    details: {
      httpStatus: number | null;
      errorMessage: string;
      responseSummary?: Record<string, unknown> | null;
      nowMs: number;
    }
  ): Promise<void> {
    const nowIso = new Date(details.nowMs).toISOString();
    const nextRetryAt = computeNextRetryIso(rec.attempts, details.nowMs);
    rec.status = 'failed';
    rec.last_http_status = details.httpStatus;
    rec.last_error = sanitizeOutboundError(details.errorMessage);
    rec.response_summary = details.responseSummary ?? rec.response_summary;
    rec.next_retry_at = nextRetryAt;
    rec.updated_at = nowIso;

    await db
      .from('smav_outbound_sale_events')
      .update({
        status: 'failed',
        last_http_status: rec.last_http_status,
        last_error: rec.last_error,
        response_summary: rec.response_summary,
        next_retry_at: nextRetryAt,
        updated_at: nowIso,
      })
      .eq('id', rec.id);
  }

  public async listEventsForOutlet(
    db: SupabaseClient | null,
    outletId: string,
    limit = 50
  ): Promise<OutboundSaleEventRecord[]> {
    if (!db) {
      throw new OutboundOutboxUnavailableError(
        'OUTBOUND_OUTBOX_UNAVAILABLE: Central service database is unavailable; cannot list durable outbound sale events.'
      );
    }

    const { data, error } = await db
      .from('smav_outbound_sale_events')
      .select('*')
      .eq('outlet_id', outletId)
      .order('created_at', { ascending: false })
      .limit(Math.min(100, Math.max(1, limit)));

    if (error) {
      const reason = sanitizeOutboundError(error);
      throw new OutboundOutboxUnavailableError(
        `OUTBOUND_OUTBOX_UNAVAILABLE: Unable to read durable smav_outbound_sale_events (${reason}).`
      );
    }

    return (Array.isArray(data) ? data : []) as OutboundSaleEventRecord[];
  }
}
