import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export type CentralBillSourceSystem =
  | 'smav_web_pos'
  | 'smav_android_agent'
  | 'glossylooks_admin_portal';

export type CentralBillStatus =
  | 'RESERVED'
  | 'PREALLOCATED'
  | 'FINALIZED'
  | 'VOIDED'
  | 'EXPIRED';

export interface OutletBranchRecord {
  id: string;
  outletId: string;
  branchCode: string;
  branchName: string;
  externalBranchId?: string | null;
  billPrefix: string;
  isActive: boolean;
}

export interface PermittedBranchesResult {
  branches: OutletBranchRecord[];
  autoSelectedBranch: OutletBranchRecord | null;
  requiresManualSelection: boolean;
}

export interface CentralBillReservationResult {
  centralBillId: string;
  centralBillNumber: string;
  outletId: string;
  branchId: string | null;
  branchCode: string;
  branchName: string;
  billingDate: string; // YYYY-MM-DD (Asia/Kolkata)
  sequenceNumber: number;
  sourceSystem: CentralBillSourceSystem;
  status: CentralBillStatus;
  idempotencyKey: string;
  generatedAt: string;
  idempotentReplay: boolean;
  storageMode: 'central_rpc' | 'memory_fallback';
}

export interface PreallocatedBillNumberItem {
  batchId: string;
  centralBillId: string;
  centralBillNumber: string;
  outletId: string;
  branchId: string | null;
  branchCode: string;
  branchName: string;
  billingDate: string;
  sequenceNumber: number;
  idempotencyKey: string;
  expiresAt: string;
}

export interface BillNumberReconciliationReport {
  outletId: string;
  generatedAt: string;
  totalCentralNumbers: number;
  totalSalonBills: number;
  linkedBillsCount: number;
  legacyHistoricalBillsCount: number;
  missingCentralBillNumberCount: number;
  duplicateBillNumbers: Array<{ billNumber: string; count: number; ids: string[] }>;
  missingCentralBills: Array<{ id: string; billNumber: string; createdAt: string; reason: string }>;
  mismatchedBills: Array<{ id: string; billNumber: string; centralBillNumber: string; createdAt: string }>;
  reservedUnfinalizedCount: number;
  preallocatedUnusedCount: number;
  byBranch: Record<string, { total: number; finalized: number; reserved: number; preallocated: number; voided: number }>;
}

export const GLOSSYLOOKS_CANONICAL_BRANCHES: ReadonlyArray<{
  branchCode: 'GACHI' | 'KONDA';
  branchName: 'Gachibowli' | 'Kondapur';
  externalBranchId: string;
  billPrefix: 'TGL';
}> = [
  {
    branchCode: 'GACHI',
    branchName: 'Gachibowli',
    externalBranchId: 'tgl-gachibowli-main',
    billPrefix: 'TGL',
  },
  {
    branchCode: 'KONDA',
    branchName: 'Kondapur',
    externalBranchId: 'tgl-kondapur-main',
    billPrefix: 'TGL',
  },
];

export const CENTRAL_BILL_NUMBER_REGEX = /^TGL-(GACHI|KONDA)-\d{8}-\d{4,}$/;

export function getIndiaDateParts(now = new Date()): { dateIso: string; dateCompact: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = parts.find((p) => p.type === 'year')?.value || '1970';
  const month = parts.find((p) => p.type === 'month')?.value || '01';
  const day = parts.find((p) => p.type === 'day')?.value || '01';
  return {
    dateIso: `${year}-${month}-${day}`,
    dateCompact: `${year}${month}${day}`,
  };
}

export function formatCentralBillNumber(
  branchCode: string,
  dateCompactYYYYMMDD: string,
  sequenceNumber: number,
  billPrefix = 'TGL'
): string {
  const cleanPrefix = String(billPrefix || 'TGL').trim().toUpperCase().replace(/[^A-Z0-9]/g, '') || 'TGL';
  const cleanBranch = normalizeGlossyBranchCode(branchCode);
  if (!cleanBranch) {
    throw new Error('BRANCH_REQUIRED: Valid branch code (GACHI or KONDA) is required.');
  }
  const safeSeq = Math.max(1, Math.floor(Number(sequenceNumber) || 0));
  return `${cleanPrefix}-${cleanBranch}-${dateCompactYYYYMMDD}-${String(safeSeq).padStart(4, '0')}`;
}

/**
 * Strictly normalizes GlossyLooks branch identifiers into canonical codes:
 * - Gachibowli -> GACHI
 * - Kondapur   -> KONDA
 * Returns null if blank or unrecognized (never guesses or silently defaults).
 */
export function normalizeGlossyBranchCode(raw: unknown): 'GACHI' | 'KONDA' | null {
  const token = String(raw || '').trim().toLowerCase();
  if (!token) return null;
  if (
    token === 'gachi' ||
    token === 'gach' ||
    token === 'gachibowli' ||
    token === 'tgl-gachibowli-main' ||
    token.includes('gachibowli')
  ) {
    return 'GACHI';
  }
  if (
    token === 'konda' ||
    token === 'kndp' ||
    token === 'kondapur' ||
    token === 'tgl-kondapur-main' ||
    token.includes('kondapur')
  ) {
    return 'KONDA';
  }
  return null;
}

export function branchNameForCode(branchCode: string | null | undefined): string {
  const canonical = normalizeGlossyBranchCode(branchCode);
  if (canonical === 'GACHI') return 'Gachibowli';
  if (canonical === 'KONDA') return 'Kondapur';
  return String(branchCode || '').trim();
}

export function isValidCentralBillNumber(billNumber: string | null | undefined): boolean {
  return CENTRAL_BILL_NUMBER_REGEX.test(String(billNumber || '').trim().toUpperCase());
}

export function buildDefaultGlossyBranches(outletId: string): OutletBranchRecord[] {
  return GLOSSYLOOKS_CANONICAL_BRANCHES.map((b) => ({
    id: `branch_${b.branchCode.toLowerCase()}_${outletId}`,
    outletId,
    branchCode: b.branchCode,
    branchName: b.branchName,
    externalBranchId: b.externalBranchId,
    billPrefix: b.billPrefix,
    isActive: true,
  }));
}

/**
 * Resolves which branches an authenticated user is permitted to bill under.
 * Business rule:
 * - Owner / Admin / Superadmin can select any active permitted branch (or explicitly restricted ones).
 * - Staff (POS_BILLING / STYLIST / RECEPTIONIST) can select ONLY their assigned branch(es).
 * - Preselect a branch ONLY when the user has exactly ONE permitted branch; otherwise require manual selection.
 */
export function resolvePermittedBranchesForUser(params: {
  allOutletBranches: OutletBranchRecord[];
  userRole: string;
  assignedBranchCodes?: string[] | null;
}): PermittedBranchesResult {
  const activeBranches = params.allOutletBranches.filter((b) => b.isActive !== false);
  const roleLower = String(params.userRole || '').trim().toLowerCase();
  const isPrivileged =
    roleLower === 'superadmin' ||
    roleLower === 'admin' ||
    roleLower === 'owner' ||
    roleLower === 'manager';

  const normalizedAssigned = Array.isArray(params.assignedBranchCodes)
    ? Array.from(
        new Set(
          params.assignedBranchCodes
            .map((code) => normalizeGlossyBranchCode(code) || String(code || '').trim().toUpperCase())
            .filter(Boolean)
        )
      )
    : [];

  let permitted: OutletBranchRecord[];
  if (normalizedAssigned.length > 0) {
    permitted = activeBranches.filter((b) => normalizedAssigned.includes(b.branchCode.toUpperCase()));
  } else if (isPrivileged) {
    permitted = activeBranches;
  } else {
    // Staff with no explicit single-branch restriction can choose among the active outlet branches,
    // but manual selection is still required whenever > 1 branch exists.
    permitted = activeBranches;
  }

  const autoSelectedBranch = permitted.length === 1 ? permitted[0] : null;
  return {
    branches: permitted,
    autoSelectedBranch,
    requiresManualSelection: permitted.length !== 1,
  };
}

export function normalizeSourceSystem(raw: unknown): CentralBillSourceSystem {
  const token = String(raw || '').trim().toLowerCase();
  if (token === 'smav_android_agent' || token === 'android' || token === 'android_print_agent') {
    return 'smav_android_agent';
  }
  if (token === 'glossylooks_admin_portal' || token === 'glossylooks' || token === 'admin_portal') {
    return 'glossylooks_admin_portal';
  }
  return 'smav_web_pos';
}

interface MemoryBillRecord {
  centralBillId: string;
  centralBillNumber: string;
  outletId: string;
  branchId: string | null;
  branchCode: string;
  branchName: string;
  billingDate: string;
  sequenceNumber: number;
  sourceSystem: CentralBillSourceSystem;
  status: CentralBillStatus;
  idempotencyKey: string;
  deviceId?: string | null;
  batchId?: string | null;
  localBillId?: string | null;
  externalOrderId?: string | null;
  generatedAt: string;
  finalizedAt?: string | null;
}

/**
 * Central Bill Numbering Coordinator.
 * Uses atomic PostgreSQL RPCs (Migration 019) whenever Central Supabase service client is available,
 * and falls back to an atomic in-process mutex registry for local dev/testing without a live DB.
 */
export class CentralBillNumberCoordinator {
  private memCounters = new Map<string, number>();
  private memByIdempotency = new Map<string, MemoryBillRecord>();
  private memByBillNumber = new Map<string, MemoryBillRecord>();

  public async listOutletBranches(
    db: SupabaseClient | null,
    outletId: string
  ): Promise<OutletBranchRecord[]> {
    if (db) {
      try {
        const { data, error } = await db
          .from('smav_branches')
          .select('id, outlet_id, branch_code, branch_name, external_branch_id, bill_prefix, is_active')
          .eq('outlet_id', outletId)
          .eq('is_active', true)
          .order('branch_code', { ascending: true });
        if (!error && Array.isArray(data) && data.length > 0) {
          return data.map((row: any) => ({
            id: String(row.id),
            outletId: String(row.outlet_id),
            branchCode: String(row.branch_code).trim().toUpperCase(),
            branchName: String(row.branch_name).trim(),
            externalBranchId: row.external_branch_id || null,
            billPrefix: String(row.bill_prefix || 'TGL').trim().toUpperCase(),
            isActive: row.is_active !== false,
          }));
        }
      } catch {
        // Table may not yet be migrated in dev; fall through to canonical defaults
      }
    }
    return buildDefaultGlossyBranches(outletId);
  }

  public async getUserAssignedBranchCodes(
    db: SupabaseClient | null,
    userId: string,
    outletId: string
  ): Promise<string[]> {
    if (!db || !userId || !outletId) return [];
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId);
    if (!isUuid) return [];
    try {
      const { data, error } = await db
        .from('smav_user_outlet_roles')
        .select('assigned_branch_codes')
        .eq('user_id', userId)
        .eq('outlet_id', outletId)
        .eq('is_active', true)
        .maybeSingle();
      if (!error && Array.isArray((data as any)?.assigned_branch_codes)) {
        return (data as any).assigned_branch_codes.map((v: unknown) => String(v || '').trim().toUpperCase()).filter(Boolean);
      }
    } catch {
      // Column not yet migrated — return empty array
    }
    return [];
  }

  public async reserveCentralBillNumber(params: {
    db: SupabaseClient | null;
    outletId: string;
    branchCode: string;
    idempotencyKey: string;
    sourceSystem: CentralBillSourceSystem;
    createdBy?: string | null;
    deviceId?: string | null;
    billPrefix?: string;
    now?: Date;
  }): Promise<CentralBillReservationResult> {
    const canonicalBranch = normalizeGlossyBranchCode(params.branchCode);
    if (!canonicalBranch) {
      throw new Error('BRANCH_REQUIRED: Branch selection (Gachibowli / GACHI or Kondapur / KONDA) is mandatory.');
    }
    const cleanIdem = String(params.idempotencyKey || '').trim();
    if (!cleanIdem) {
      throw new Error('IDEMPOTENCY_KEY_REQUIRED: idempotencyKey is required.');
    }

    const validActorUuid =
      params.createdBy && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.createdBy)
        ? params.createdBy
        : null;

    // 1. Primary path: atomic PostgreSQL RPC (Migration 019)
    if (params.db) {
      const { data, error } = await params.db.rpc('smav_reserve_central_bill_number', {
        p_outlet_id: params.outletId,
        p_branch_code: canonicalBranch,
        p_idempotency_key: cleanIdem,
        p_source_system: params.sourceSystem,
        p_created_by: validActorUuid,
        p_device_id: params.deviceId || null,
        p_bill_prefix: params.billPrefix || 'TGL',
      });

      if (!error && Array.isArray(data) && data.length > 0) {
        const row = data[0];
        return {
          centralBillId: String(row.central_bill_id),
          centralBillNumber: String(row.central_bill_number),
          outletId: String(row.outlet_id),
          branchId: row.branch_id ? String(row.branch_id) : null,
          branchCode: String(row.branch_code),
          branchName: String(row.branch_name),
          billingDate: String(row.billing_date),
          sequenceNumber: Number(row.sequence_number),
          sourceSystem: normalizeSourceSystem(row.source_system),
          status: String(row.status) as CentralBillStatus,
          idempotencyKey: String(row.idempotency_key),
          generatedAt: String(row.generated_at),
          idempotentReplay: Boolean(row.idempotent_replay),
          storageMode: 'central_rpc',
        };
      }

      if (error) {
        const msg = String(error.message || '');
        const rpcMissing =
          error.code === '42883' ||
          error.code === 'PGRST202' ||
          /could not find the function|does not exist/i.test(msg);
        if (!rpcMissing) {
          throw new Error(msg);
        }
      }
    }

    // 2. Fallback path (dev/offline test harness before Migration 019 is applied)
    const existing = this.memByIdempotency.get(cleanIdem);
    if (existing) {
      if (existing.outletId !== params.outletId) {
        throw new Error('OUTLET_MISMATCH: Idempotency key belongs to another outlet.');
      }
      return {
        ...existing,
        idempotentReplay: true,
        storageMode: 'memory_fallback',
      };
    }

    const { dateIso, dateCompact } = getIndiaDateParts(params.now);
    const counterKey = `${params.outletId}:${canonicalBranch}:${dateCompact}`;

    // If db exists (pre-migration 019), seed from existing smav_salon_bills for this branch+date
    let currentMax = this.memCounters.get(counterKey) || 0;
    if (params.db && currentMax === 0) {
      try {
        const prefix = `${(params.billPrefix || 'TGL').toUpperCase()}-${canonicalBranch}-${dateCompact}-`;
        const { data: rows } = await params.db
          .from('smav_salon_bills')
          .select('bill_number')
          .eq('outlet_id', params.outletId)
          .like('bill_number', `${prefix}%`)
          .limit(2000);
        if (Array.isArray(rows)) {
          for (const r of rows) {
            const parsed = Number.parseInt(String((r as any)?.bill_number || '').split('-').pop() || '0', 10);
            if (Number.isFinite(parsed) && parsed > currentMax) currentMax = parsed;
          }
        }
      } catch {
        // Ignore seed lookup error in fallback mode
      }
    }

    const nextSeq = currentMax + 1;
    this.memCounters.set(counterKey, nextSeq);

    const centralBillNumber = formatCentralBillNumber(
      canonicalBranch,
      dateCompact,
      nextSeq,
      params.billPrefix || 'TGL'
    );
    const record: MemoryBillRecord = {
      centralBillId: crypto.randomUUID(),
      centralBillNumber,
      outletId: params.outletId,
      branchId: `branch_${canonicalBranch.toLowerCase()}_${params.outletId}`,
      branchCode: canonicalBranch,
      branchName: branchNameForCode(canonicalBranch),
      billingDate: dateIso,
      sequenceNumber: nextSeq,
      sourceSystem: params.sourceSystem,
      status: 'RESERVED',
      idempotencyKey: cleanIdem,
      deviceId: params.deviceId || null,
      generatedAt: (params.now || new Date()).toISOString(),
    };

    this.memByIdempotency.set(cleanIdem, record);
    this.memByBillNumber.set(centralBillNumber.toUpperCase(), record);

    return {
      ...record,
      idempotentReplay: false,
      storageMode: 'memory_fallback',
    };
  }

  public async allocateOfflineRange(params: {
    db: SupabaseClient | null;
    outletId: string;
    branchCode: string;
    deviceId: string;
    count?: number;
    allocatedBy?: string | null;
    billPrefix?: string;
    now?: Date;
  }): Promise<{
    batchId: string;
    outletId: string;
    branchCode: string;
    branchName: string;
    billingDate: string;
    items: PreallocatedBillNumberItem[];
    storageMode: 'central_rpc' | 'memory_fallback';
  }> {
    const canonicalBranch = normalizeGlossyBranchCode(params.branchCode);
    if (!canonicalBranch) {
      throw new Error('BRANCH_REQUIRED: Valid branchCode (GACHI or KONDA) is required.');
    }
    const cleanDevice = String(params.deviceId || '').trim();
    if (!cleanDevice) {
      throw new Error('DEVICE_ID_REQUIRED: deviceId is required.');
    }
    const safeCount = Math.min(100, Math.max(1, Math.floor(Number(params.count) || 20)));
    const validActorUuid =
      params.allocatedBy && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.allocatedBy)
        ? params.allocatedBy
        : null;

    if (params.db) {
      const { data, error } = await params.db.rpc('smav_allocate_bill_number_range', {
        p_outlet_id: params.outletId,
        p_branch_code: canonicalBranch,
        p_device_id: cleanDevice,
        p_count: safeCount,
        p_allocated_by: validActorUuid,
        p_bill_prefix: params.billPrefix || 'TGL',
      });

      if (!error && Array.isArray(data) && data.length > 0) {
        const first = data[0];
        const items: PreallocatedBillNumberItem[] = data.map((row: any) => ({
          batchId: String(row.batch_id),
          centralBillId: String(row.central_bill_id),
          centralBillNumber: String(row.central_bill_number),
          outletId: String(row.outlet_id),
          branchId: row.branch_id ? String(row.branch_id) : null,
          branchCode: String(row.branch_code),
          branchName: String(row.branch_name),
          billingDate: String(row.billing_date),
          sequenceNumber: Number(row.sequence_number),
          idempotencyKey: String(row.idempotency_key),
          expiresAt: String(row.expires_at),
        }));
        return {
          batchId: String(first.batch_id),
          outletId: String(first.outlet_id),
          branchCode: String(first.branch_code),
          branchName: String(first.branch_name),
          billingDate: String(first.billing_date),
          items,
          storageMode: 'central_rpc',
        };
      }

      if (error) {
        const msg = String(error.message || '');
        const rpcMissing =
          error.code === '42883' ||
          error.code === 'PGRST202' ||
          /could not find the function|does not exist/i.test(msg);
        if (!rpcMissing) {
          throw new Error(msg);
        }
      }
    }

    // Memory fallback for local testing / pre-migration dev
    const { dateIso, dateCompact } = getIndiaDateParts(params.now);
    const counterKey = `${params.outletId}:${canonicalBranch}:${dateCompact}`;
    const startSeq = (this.memCounters.get(counterKey) || 0) + 1;
    const endSeq = startSeq + safeCount - 1;
    this.memCounters.set(counterKey, endSeq);

    const batchId = crypto.randomUUID();
    const expiresAt = new Date((params.now || new Date()).getTime() + 24 * 60 * 60 * 1000).toISOString();
    const cleanDeviceTail = cleanDevice.replace(/[^A-Za-z0-9]/g, '').slice(-12);
    const items: PreallocatedBillNumberItem[] = [];

    for (let seq = startSeq; seq <= endSeq; seq++) {
      const centralBillNumber = formatCentralBillNumber(canonicalBranch, dateCompact, seq, params.billPrefix || 'TGL');
      const idempotencyKey = `PREALLOC_${centralBillNumber}_${cleanDeviceTail}`;
      const centralBillId = crypto.randomUUID();
      const record: MemoryBillRecord = {
        centralBillId,
        centralBillNumber,
        outletId: params.outletId,
        branchId: `branch_${canonicalBranch.toLowerCase()}_${params.outletId}`,
        branchCode: canonicalBranch,
        branchName: branchNameForCode(canonicalBranch),
        billingDate: dateIso,
        sequenceNumber: seq,
        sourceSystem: 'smav_android_agent',
        status: 'PREALLOCATED',
        idempotencyKey,
        deviceId: cleanDevice,
        batchId,
        generatedAt: (params.now || new Date()).toISOString(),
      };
      this.memByIdempotency.set(idempotencyKey, record);
      this.memByBillNumber.set(centralBillNumber.toUpperCase(), record);
      items.push({
        batchId,
        centralBillId,
        centralBillNumber,
        outletId: params.outletId,
        branchId: record.branchId,
        branchCode: canonicalBranch,
        branchName: record.branchName,
        billingDate: dateIso,
        sequenceNumber: seq,
        idempotencyKey,
        expiresAt,
      });
    }

    return {
      batchId,
      outletId: params.outletId,
      branchCode: canonicalBranch,
      branchName: branchNameForCode(canonicalBranch),
      billingDate: dateIso,
      items,
      storageMode: 'memory_fallback',
    };
  }

  public async finalizeCentralBillNumber(params: {
    db: SupabaseClient | null;
    outletId: string;
    centralBillNumber: string;
    idempotencyKey?: string | null;
    localBillId?: string | null;
    externalOrderId?: string | null;
    sourceSystem?: CentralBillSourceSystem;
  }): Promise<{
    centralBillId: string;
    centralBillNumber: string;
    outletId: string;
    branchId: string | null;
    branchCode: string;
    branchName: string;
    status: CentralBillStatus;
    finalizedAt: string;
    storageMode: 'central_rpc' | 'memory_fallback';
  }> {
    const cleanNo = String(params.centralBillNumber || '').trim().toUpperCase();
    if (!cleanNo) {
      throw new Error('CENTRAL_BILL_NUMBER_REQUIRED: centralBillNumber is required to finalize.');
    }

    if (params.db) {
      const { data, error } = await params.db.rpc('smav_finalize_central_bill_number', {
        p_outlet_id: params.outletId,
        p_central_bill_number: cleanNo,
        p_idempotency_key: params.idempotencyKey || null,
        p_local_bill_id: params.localBillId || null,
        p_external_order_id: params.externalOrderId || null,
        p_source_system: params.sourceSystem || null,
      });

      if (!error && Array.isArray(data) && data.length > 0) {
        const row = data[0];
        return {
          centralBillId: String(row.central_bill_id),
          centralBillNumber: String(row.central_bill_number),
          outletId: String(row.outlet_id),
          branchId: row.branch_id ? String(row.branch_id) : null,
          branchCode: String(row.branch_code),
          branchName: String(row.branch_name),
          status: String(row.status) as CentralBillStatus,
          finalizedAt: String(row.finalized_at),
          storageMode: 'central_rpc',
        };
      }

      if (error) {
        const msg = String(error.message || '');
        const rpcMissing =
          error.code === '42883' ||
          error.code === 'PGRST202' ||
          /could not find the function|does not exist/i.test(msg);
        if (!rpcMissing) {
          throw new Error(msg);
        }
      }
    }

    const record =
      this.memByBillNumber.get(cleanNo) ||
      (params.idempotencyKey ? this.memByIdempotency.get(String(params.idempotencyKey).trim()) : undefined);

    if (!record) {
      throw new Error(`CENTRAL_BILL_NOT_FOUND: Central bill number "${cleanNo}" was not reserved.`);
    }
    if (record.outletId !== params.outletId) {
      throw new Error('OUTLET_MISMATCH: Central bill number belongs to another outlet.');
    }
    if (record.centralBillNumber.toUpperCase() !== cleanNo) {
      throw new Error('IMMUTABLE_BILL_NUMBER: Assigned central bill number cannot be altered.');
    }
    if (record.status === 'VOIDED') {
      throw new Error(`CENTRAL_BILL_VOIDED: Central bill number "${cleanNo}" is already voided.`);
    }

    record.status = 'FINALIZED';
    record.finalizedAt = record.finalizedAt || new Date().toISOString();
    if (params.localBillId) record.localBillId = params.localBillId;
    if (params.externalOrderId) record.externalOrderId = params.externalOrderId;

    return {
      centralBillId: record.centralBillId,
      centralBillNumber: record.centralBillNumber,
      outletId: record.outletId,
      branchId: record.branchId,
      branchCode: record.branchCode,
      branchName: record.branchName,
      status: record.status,
      finalizedAt: record.finalizedAt,
      storageMode: 'memory_fallback',
    };
  }

  public getMemoryRecordsForOutlet(outletId: string): MemoryBillRecord[] {
    return Array.from(this.memByBillNumber.values()).filter((r) => r.outletId === outletId);
  }
}

/**
 * Pure reconciliation report builder for duplicate/missing bill numbers.
 * Preserves legacy historical bills cleanly without mutating them.
 */
export function buildBillNumberReconciliationReport(params: {
  outletId: string;
  centralNumbers: Array<{
    id: string;
    central_bill_number: string;
    branch_code: string;
    status: string;
  }>;
  salonBills: Array<{
    id: string;
    bill_number: string;
    central_bill_number?: string | null;
    created_at?: string;
    is_voided?: boolean;
  }>;
}): BillNumberReconciliationReport {
  const byBillNumber = new Map<string, string[]>();
  const missingCentralBills: BillNumberReconciliationReport['missingCentralBills'] = [];
  const mismatchedBills: BillNumberReconciliationReport['mismatchedBills'] = [];
  let linkedBillsCount = 0;
  let legacyHistoricalBillsCount = 0;

  for (const bill of params.salonBills) {
    const billNo = String(bill.bill_number || '').trim();
    const centralNo = bill.central_bill_number ? String(bill.central_bill_number).trim() : null;

    if (billNo) {
      const key = billNo.toUpperCase();
      const ids = byBillNumber.get(key) || [];
      ids.push(String(bill.id));
      byBillNumber.set(key, ids);
    }

    if (!centralNo) {
      if (isValidCentralBillNumber(billNo)) {
        missingCentralBills.push({
          id: String(bill.id),
          billNumber: billNo,
          createdAt: String(bill.created_at || ''),
          reason: 'UNLINKED_TGL_FORMAT',
        });
      } else {
        legacyHistoricalBillsCount += 1;
      }
    } else if (centralNo.toUpperCase() !== billNo.toUpperCase()) {
      mismatchedBills.push({
        id: String(bill.id),
        billNumber: billNo,
        centralBillNumber: centralNo,
        createdAt: String(bill.created_at || ''),
      });
    } else {
      linkedBillsCount += 1;
    }
  }

  const duplicateBillNumbers: BillNumberReconciliationReport['duplicateBillNumbers'] = [];
  for (const [billNumber, ids] of byBillNumber.entries()) {
    if (ids.length > 1) {
      duplicateBillNumbers.push({ billNumber, count: ids.length, ids });
    }
  }

  const byBranch: BillNumberReconciliationReport['byBranch'] = {};
  let reservedUnfinalizedCount = 0;
  let preallocatedUnusedCount = 0;

  for (const cn of params.centralNumbers) {
    const bc = String(cn.branch_code || 'UNKNOWN').toUpperCase();
    if (!byBranch[bc]) {
      byBranch[bc] = { total: 0, finalized: 0, reserved: 0, preallocated: 0, voided: 0 };
    }
    byBranch[bc].total += 1;
    const st = String(cn.status || '').toUpperCase();
    if (st === 'FINALIZED') byBranch[bc].finalized += 1;
    else if (st === 'RESERVED') {
      byBranch[bc].reserved += 1;
      reservedUnfinalizedCount += 1;
    } else if (st === 'PREALLOCATED') {
      byBranch[bc].preallocated += 1;
      preallocatedUnusedCount += 1;
    } else if (st === 'VOIDED') {
      byBranch[bc].voided += 1;
    }
  }

  return {
    outletId: params.outletId,
    generatedAt: new Date().toISOString(),
    totalCentralNumbers: params.centralNumbers.length,
    totalSalonBills: params.salonBills.length,
    linkedBillsCount,
    legacyHistoricalBillsCount,
    missingCentralBillNumberCount: missingCentralBills.length,
    duplicateBillNumbers,
    missingCentralBills,
    mismatchedBills,
    reservedUnfinalizedCount,
    preallocatedUnusedCount,
    byBranch,
  };
}

export const GLOSSYLOOKS_BILL_SYNC_DEFAULT_URL =
  'https://www.glossylooks.in/api/integrations/smav/sale-event';

/**
 * Best-effort outbound sync of central_bill_number back to GlossyLooks
 * (https://www.glossylooks.in/api/integrations/smav/sale-event) when
 * GLOSSYLOOKS_BILL_SYNC_WEBHOOK_URL is configured. Never throws to avoid failing saved bills.
 */
export async function syncCentralBillNumberToGlossyLooks(params: {
  centralBillId: string | null;
  centralBillNumber: string;
  outletId: string;
  branchCode: string;
  branchName: string;
  idempotencyKey: string;
  externalOrderId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  paymentMode?: string | null;
  grandTotal?: number;
  billedAt?: string;
  sourceSystem?: CentralBillSourceSystem;
  fetchImpl?: typeof fetch;
}): Promise<{ synced: boolean; skipped?: boolean; error?: string }> {
  const webhookUrl = String(process.env.GLOSSYLOOKS_BILL_SYNC_WEBHOOK_URL || '').trim();
  const integrationKey = String(process.env.GLOSSYLOOKS_INTEGRATION_KEY || '').trim();
  const signingSecret = String(process.env.SMAV_DISPATCH_SECRET || '').trim() || integrationKey;
  if (!webhookUrl) {
    return { synced: false, skipped: true };
  }

  const eventId = params.centralBillId || params.idempotencyKey;
  const bodyObj = {
    event_id: eventId,
    event_type: 'central_bill_finalized',
    event: 'central_bill_finalized',
    central_bill_id: params.centralBillId,
    central_bill_number: params.centralBillNumber,
    bill_number: params.centralBillNumber,
    outlet_id: params.outletId,
    branch_code: params.branchCode,
    branch_name: params.branchName,
    idempotency_key: params.idempotencyKey,
    external_order_id: params.externalOrderId || null,
    customer_name: params.customerName || null,
    customer_phone: params.customerPhone || null,
    payment_mode: params.paymentMode || null,
    grand_total: params.grandTotal ?? null,
    billed_at: params.billedAt || new Date().toISOString(),
    source_system: params.sourceSystem || 'smav_web_pos',
  };
  const rawBody = JSON.stringify(bodyObj);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-SMAV-Source': 'smav_central_billing',
    'X-SMAV-Event-Id': eventId,
    'X-SMAV-Timestamp': timestamp,
  };
  if (integrationKey) {
    headers['X-Integration-Key'] = integrationKey;
  }
  if (signingSecret) {
    headers['X-SMAV-Signature'] = crypto
      .createHmac('sha256', signingSecret)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');
  }

  try {
    const fetchFn = params.fetchImpl || fetch;
    const resp = await fetchFn(webhookUrl, {
      method: 'POST',
      headers,
      body: rawBody,
    });
    if (!resp.ok) {
      return { synced: false, error: `GlossyLooks bill sync returned HTTP ${resp.status}` };
    }
    return { synced: true };
  } catch (err: any) {
    return { synced: false, error: err?.message || 'Network error syncing central bill to GlossyLooks' };
  }
}
