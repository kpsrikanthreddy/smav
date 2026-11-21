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
  name: string;
  branchCode: string;
  branchName: string;
  isActive: boolean;
  outletId: string;
  billPrefix: string;
  externalBranchId?: string | null;
  address?: string | null;
  gstin?: string | null;
  whatsappPhone?: string | null;
  printerConfig?: Record<string, unknown> | null;
}

export interface PermittedBranchesResult {
  branches: OutletBranchRecord[];
  autoSelectedBranch: OutletBranchRecord | null;
  requiresManualSelection: boolean;
  billingBlocked: boolean;
  authorizationMessage: string | null;
}

export interface UserBranchAssignments {
  branchIds: string[];
  branchCodes: string[];
  hasExplicitAssignments: boolean;
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

/**
 * Dynamic central bill number format:
 *   {PREFIX}-{BRANCH_CODE}-{YYYYMMDD}-{4+_DIGIT_SEQUENCE}
 * Works for all active branches managed in public.smav_branches without hardcoded branch codes.
 */
export const CENTRAL_BILL_NUMBER_REGEX = /^[A-Z0-9]{2,8}-[A-Z0-9]{2,12}-\d{8}-\d{4,}$/;

const BRANCH_CODE_REGEX = /^[A-Z0-9]{2,12}$/;

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

/**
 * Validates and normalizes any dynamic branch code from central branch master.
 * Never hardcodes branch names or codes.
 */
export function normalizeDynamicBranchCode(raw: unknown): string | null {
  const token = String(raw ?? '').trim().toUpperCase();
  if (!token || !BRANCH_CODE_REGEX.test(token)) return null;
  return token;
}

export function formatCentralBillNumber(
  branchCode: string,
  dateCompactYYYYMMDD: string,
  sequenceNumber: number,
  billPrefix = 'TGL'
): string {
  const cleanPrefix = String(billPrefix || 'TGL').trim().toUpperCase().replace(/[^A-Z0-9]/g, '') || 'TGL';
  const cleanBranch = normalizeDynamicBranchCode(branchCode);
  if (!cleanBranch) {
    throw new Error('BRANCH_REQUIRED: A valid active branch code is required.');
  }
  const safeSeq = Math.max(1, Math.floor(Number(sequenceNumber) || 0));
  return `${cleanPrefix}-${cleanBranch}-${dateCompactYYYYMMDD}-${String(safeSeq).padStart(4, '0')}`;
}

export function isValidCentralBillNumber(billNumber: string | null | undefined): boolean {
  return CENTRAL_BILL_NUMBER_REGEX.test(String(billNumber || '').trim().toUpperCase());
}

/**
 * Normalizes and deduplicates active branches returned by central public.smav_branches.
 * Inactive/disabled branches are excluded so they never appear in new billing dropdowns.
 */
export function deduplicateActiveOutletBranches(rows: OutletBranchRecord[]): OutletBranchRecord[] {
  const seenIds = new Set<string>();
  const seenCodes = new Set<string>();
  const result: OutletBranchRecord[] = [];

  for (const row of rows) {
    if (row.isActive === false) continue;
    const id = String(row.id || '').trim();
    const branchCode = normalizeDynamicBranchCode(row.branchCode);
    const displayName = String(row.name || row.branchName || '').trim();
    if (!id || !branchCode || !displayName) continue;

    const idKey = id.toLowerCase();
    if (seenIds.has(idKey) || seenCodes.has(branchCode)) continue;

    seenIds.add(idKey);
    seenCodes.add(branchCode);
    result.push({
      id,
      name: displayName,
      branchCode,
      branchName: displayName,
      isActive: true,
      outletId: String(row.outletId || '').trim(),
      billPrefix: String(row.billPrefix || 'TGL').trim().toUpperCase().replace(/[^A-Z0-9]/g, '') || 'TGL',
      externalBranchId: row.externalBranchId ?? id,
      address: row.address ?? null,
      gstin: row.gstin ?? null,
      whatsappPhone: row.whatsappPhone ?? null,
      printerConfig: row.printerConfig ?? null,
    });
  }

  return result.sort((a, b) => a.name.localeCompare(b.name) || a.branchCode.localeCompare(b.branchCode));
}

/**
 * Resolves a requested branch dynamically against active branches from public.smav_branches.
 * Matches by canonical branch id, branchCode, name/branchName, or externalBranchId — never hardcoded.
 */
export function resolveBranchFromMaster(
  branches: OutletBranchRecord[],
  input: {
    branchId?: unknown;
    branchCode?: unknown;
    branchName?: unknown;
    rawToken?: unknown;
  }
): OutletBranchRecord | null {
  const active = branches.filter((b) => b.isActive !== false);
  if (active.length === 0) return null;

  const idToken = String(input.branchId ?? '').trim().toLowerCase();
  const codeToken = String(input.branchCode ?? '').trim().toUpperCase();
  const nameToken = String(input.branchName ?? '').trim().toLowerCase();
  const rawToken = String(input.rawToken ?? '').trim();

  if (idToken) {
    const byId = active.find(
      (b) =>
        b.id.toLowerCase() === idToken ||
        (b.externalBranchId && b.externalBranchId.toLowerCase() === idToken)
    );
    if (byId) return byId;
  }

  if (codeToken) {
    const byCode = active.find((b) => b.branchCode.toUpperCase() === codeToken);
    if (byCode) return byCode;
  }

  if (nameToken) {
    const byName = active.find(
      (b) => b.name.toLowerCase() === nameToken || b.branchName.toLowerCase() === nameToken
    );
    if (byName) return byName;
  }

  if (rawToken) {
    const lower = rawToken.toLowerCase();
    const upper = rawToken.toUpperCase();
    const byAny = active.find(
      (b) =>
        b.id.toLowerCase() === lower ||
        b.branchCode.toUpperCase() === upper ||
        b.name.toLowerCase() === lower ||
        b.branchName.toLowerCase() === lower ||
        (b.externalBranchId && b.externalBranchId.toLowerCase() === lower)
    );
    if (byAny) return byAny;
  }

  return null;
}

function timingSafeHexOrStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Strict dual-factor server-to-server authentication verifier for GlossyLooks -> SMAV endpoints:
 * 1) X-Integration-Key must match GLOSSYLOOKS_INTEGRATION_KEY (timing-safe).
 * 2) X-SMAV-Signature must match HMAC-SHA256(SMAV_DISPATCH_SECRET, "${timestamp}.${rawBody}")
 *    with X-SMAV-Timestamp within ±5 minutes.
 * Never requires an SMAV user Bearer token. Returns safe diagnostic reason codes for server logs only.
 */
export function verifyGlossyLooksServerAuth(params: {
  providedIntegrationKey: string;
  configuredIntegrationKey: string;
  providedTimestamp: string;
  providedSignature: string;
  configuredDispatchSecret: string;
  rawBody: string;
  nowMs?: number;
}): { ok: true } | { ok: false; diagnosticReason: string } {
  const configuredKey = String(params.configuredIntegrationKey || '').trim();
  const configuredSecret = String(params.configuredDispatchSecret || '').trim();
  const providedKey = String(params.providedIntegrationKey || '').trim();
  const providedTs = String(params.providedTimestamp || '').trim();
  const providedSig = String(params.providedSignature || '').trim().replace(/^sha256=/i, '');

  if (!configuredKey) {
    return { ok: false, diagnosticReason: 'missing_server_env_GLOSSYLOOKS_INTEGRATION_KEY' };
  }
  if (!configuredSecret) {
    return { ok: false, diagnosticReason: 'missing_server_env_SMAV_DISPATCH_SECRET' };
  }
  if (!providedKey) {
    return { ok: false, diagnosticReason: 'missing_header_X-Integration-Key' };
  }
  if (!timingSafeHexOrStringEqual(providedKey, configuredKey)) {
    return { ok: false, diagnosticReason: 'invalid_X-Integration-Key' };
  }
  if (!providedTs || !providedSig) {
    return {
      ok: false,
      diagnosticReason: !providedTs ? 'missing_header_X-SMAV-Timestamp' : 'missing_header_X-SMAV-Signature',
    };
  }

  const tsNum = Number(providedTs);
  if (!Number.isFinite(tsNum) || tsNum <= 0) {
    return { ok: false, diagnosticReason: 'malformed_X-SMAV-Timestamp' };
  }
  const tsMs = tsNum > 1e12 ? tsNum : tsNum * 1000;
  const nowMs = params.nowMs ?? Date.now();
  if (Math.abs(nowMs - tsMs) > 5 * 60 * 1000) {
    return { ok: false, diagnosticReason: 'expired_or_skewed_X-SMAV-Timestamp' };
  }

  const expectedSig = crypto
    .createHmac('sha256', configuredSecret)
    .update(`${providedTs}.${params.rawBody}`)
    .digest('hex');

  if (!timingSafeHexOrStringEqual(providedSig.toLowerCase(), expectedSig.toLowerCase())) {
    return { ok: false, diagnosticReason: 'hmac_signature_mismatch' };
  }

  return { ok: true };
}

/**
 * Resolves which active branches an authenticated user is permitted to bill under.
 * Dynamic branch rules:
 * - Disabled branches (isActive === false) are never returned for new billing.
 * - If user has access to exactly 1 active branch -> auto-select it.
 * - If user has access to 2+ active branches -> require explicit manual selection.
 * - If user has 0 assigned active branches -> block billing with clear authorization message.
 */
export function resolvePermittedBranchesForUser(params: {
  allOutletBranches: OutletBranchRecord[];
  userRole: string;
  assignedBranchIds?: string[] | null;
  assignedBranchCodes?: string[] | null;
  hasExplicitAssignments?: boolean;
}): PermittedBranchesResult {
  const activeBranches = deduplicateActiveOutletBranches(params.allOutletBranches);
  const roleLower = String(params.userRole || '').trim().toLowerCase();
  const isPrivileged =
    roleLower === 'superadmin' ||
    roleLower === 'admin' ||
    roleLower === 'owner' ||
    roleLower === 'manager';

  const normalizedAssignedIds = Array.isArray(params.assignedBranchIds)
    ? Array.from(
        new Set(params.assignedBranchIds.map((id) => String(id || '').trim().toLowerCase()).filter(Boolean))
      )
    : [];
  const normalizedAssignedCodes = Array.isArray(params.assignedBranchCodes)
    ? Array.from(
        new Set(params.assignedBranchCodes.map((code) => String(code || '').trim().toUpperCase()).filter(Boolean))
      )
    : [];

  const hasFilter =
    Boolean(params.hasExplicitAssignments) ||
    normalizedAssignedIds.length > 0 ||
    normalizedAssignedCodes.length > 0;

  let permitted: OutletBranchRecord[];
  if (hasFilter) {
    if (normalizedAssignedIds.length === 0 && normalizedAssignedCodes.length === 0) {
      // Explicit assignment records exist (e.g., all assigned branches were deactivated)
      permitted = [];
    } else {
      permitted = activeBranches.filter(
        (b) =>
          normalizedAssignedIds.includes(b.id.toLowerCase()) ||
          normalizedAssignedCodes.includes(b.branchCode.toUpperCase())
      );
    }
  } else if (isPrivileged) {
    permitted = activeBranches;
  } else {
    // Staff without explicit per-branch restriction rows inherit active outlet branches
    // (still requires manual selection whenever 2+ active branches exist, and blocks if 0 active branches exist).
    permitted = activeBranches;
  }

  if (permitted.length === 0) {
    const authorizationMessage =
      activeBranches.length === 0
        ? 'No active branches are configured for this outlet. Contact an administrator to activate a branch before billing.'
        : 'You have no assigned active branch for billing. Contact an administrator to assign an active branch to your account.';
    return {
      branches: [],
      autoSelectedBranch: null,
      requiresManualSelection: true,
      billingBlocked: true,
      authorizationMessage,
    };
  }

  const autoSelectedBranch = permitted.length === 1 ? permitted[0] : null;
  return {
    branches: permitted,
    autoSelectedBranch,
    requiresManualSelection: permitted.length !== 1,
    billingBlocked: false,
    authorizationMessage: null,
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
 * Reads branches dynamically from public.smav_branches and uses atomic PostgreSQL RPCs
 * whenever Central Supabase service client is available (with an in-process registry for
 * local dev/unit tests). Zero hardcoded branch IDs, names, or codes.
 */
export class CentralBillNumberCoordinator {
  private memCounters = new Map<string, number>();
  private memByIdempotency = new Map<string, MemoryBillRecord>();
  private memByBillNumber = new Map<string, MemoryBillRecord>();
  private memBranchesByOutlet = new Map<string, OutletBranchRecord[]>();

  /**
   * Registers outlet branches in memory for local/offline unit tests when no live Supabase DB is attached.
   */
  public registerMemoryBranches(outletId: string, branches: OutletBranchRecord[]): void {
    this.memBranchesByOutlet.set(
      outletId,
      branches.map((b) => ({
        ...b,
        outletId: b.outletId || outletId,
        name: b.name || b.branchName,
        branchName: b.branchName || b.name,
        branchCode: String(b.branchCode || '').trim().toUpperCase(),
        billPrefix: String(b.billPrefix || 'TGL').trim().toUpperCase(),
        isActive: b.isActive !== false,
      }))
    );
  }

  public async listOutletBranches(
    db: SupabaseClient | null,
    outletId: string
  ): Promise<OutletBranchRecord[]> {
    if (db) {
      let queryRes = await db
        .from('smav_branches')
        .select(
          'id, outlet_id, branch_code, branch_name, external_branch_id, bill_prefix, is_active, address, gstin, whatsapp_phone, printer_config'
        )
        .eq('outlet_id', outletId)
        .eq('is_active', true)
        .order('branch_name', { ascending: true });

      // Backward-compatible select if Migration 022 extended columns are not yet applied in a dev DB
      if (queryRes.error && /column .* does not exist/i.test(String(queryRes.error.message || ''))) {
        queryRes = await db
          .from('smav_branches')
          .select('id, outlet_id, branch_code, branch_name, external_branch_id, bill_prefix, is_active')
          .eq('outlet_id', outletId)
          .eq('is_active', true)
          .order('branch_name', { ascending: true });
      }

      if (!queryRes.error && Array.isArray(queryRes.data)) {
        const mapped: OutletBranchRecord[] = queryRes.data.map((row: any) => {
          const displayName = String(row.branch_name || row.name || '').trim();
          const id = String(row.id || '').trim();
          return {
            id,
            name: displayName,
            branchName: displayName,
            outletId: String(row.outlet_id || outletId),
            branchCode: String(row.branch_code || '').trim().toUpperCase(),
            externalBranchId: row.external_branch_id ? String(row.external_branch_id) : id,
            billPrefix: String(row.bill_prefix || 'TGL').trim().toUpperCase(),
            isActive: row.is_active !== false,
            address: row.address ?? null,
            gstin: row.gstin ?? null,
            whatsappPhone: row.whatsapp_phone ?? null,
            printerConfig: row.printer_config && typeof row.printer_config === 'object' ? row.printer_config : null,
          };
        });
        return deduplicateActiveOutletBranches(mapped);
      }

      const msg = String(queryRes.error?.message || '');
      if (queryRes.error && !/does not exist|could not find the table/i.test(msg)) {
        console.error('[SMAV Branches] Failed reading smav_branches:', msg);
      }
      return [];
    }

    return deduplicateActiveOutletBranches(this.memBranchesByOutlet.get(outletId) || []);
  }

  public async getUserBranchAssignments(
    db: SupabaseClient | null,
    userId: string,
    outletId: string
  ): Promise<UserBranchAssignments> {
    if (!db || !userId || !outletId) {
      return { branchIds: [], branchCodes: [], hasExplicitAssignments: false };
    }
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId);
    if (!isUuid) {
      return { branchIds: [], branchCodes: [], hasExplicitAssignments: false };
    }

    const branchIds = new Set<string>();
    const branchCodes = new Set<string>();
    let hasExplicitAssignments = false;

    // 1. Primary normalized join table: public.smav_user_branch_assignments (Migration 022)
    try {
      const { data: assignRows, error: assignErr } = await db
        .from('smav_user_branch_assignments')
        .select('branch_id, is_active')
        .eq('user_id', userId)
        .eq('outlet_id', outletId);
      if (!assignErr && Array.isArray(assignRows) && assignRows.length > 0) {
        hasExplicitAssignments = true;
        for (const r of assignRows as any[]) {
          if (r.is_active !== false && r.branch_id) {
            branchIds.add(String(r.branch_id).trim());
          }
        }
      }
    } catch {
      // Table not yet migrated
    }

    // 2. Fallback / companion columns on public.smav_user_outlet_roles
    try {
      let roleRes = await db
        .from('smav_user_outlet_roles')
        .select('assigned_branch_ids, assigned_branch_codes')
        .eq('user_id', userId)
        .eq('outlet_id', outletId)
        .eq('is_active', true)
        .maybeSingle();

      if (roleRes.error && /column .* does not exist/i.test(String(roleRes.error.message || ''))) {
        roleRes = await db
          .from('smav_user_outlet_roles')
          .select('assigned_branch_codes')
          .eq('user_id', userId)
          .eq('outlet_id', outletId)
          .eq('is_active', true)
          .maybeSingle();
      }

      if (!roleRes.error && roleRes.data) {
        const rawIds = (roleRes.data as any).assigned_branch_ids;
        const rawCodes = (roleRes.data as any).assigned_branch_codes;
        if (Array.isArray(rawIds) && rawIds.length > 0) {
          hasExplicitAssignments = true;
          for (const id of rawIds) {
            const clean = String(id || '').trim();
            if (clean) branchIds.add(clean);
          }
        }
        if (Array.isArray(rawCodes) && rawCodes.length > 0) {
          hasExplicitAssignments = true;
          for (const code of rawCodes) {
            const clean = String(code || '').trim().toUpperCase();
            if (clean) branchCodes.add(clean);
          }
        }
      }
    } catch {
      // Column not yet migrated
    }

    return {
      branchIds: Array.from(branchIds),
      branchCodes: Array.from(branchCodes),
      hasExplicitAssignments,
    };
  }

  public async reserveCentralBillNumber(params: {
    db: SupabaseClient | null;
    outletId: string;
    branchId?: string | null;
    branchCode: string;
    branchName?: string | null;
    idempotencyKey: string;
    sourceSystem: CentralBillSourceSystem;
    createdBy?: string | null;
    deviceId?: string | null;
    billPrefix?: string;
    /** YYYY-MM-DD business date; only privileged callers may request a past date. */
    billingDate?: string | null;
    now?: Date;
  }): Promise<CentralBillReservationResult> {
    const cleanBranchCode = normalizeDynamicBranchCode(params.branchCode);
    const cleanBranchId = String(params.branchId || '').trim() || null;
    if (!cleanBranchCode) {
      throw new Error('BRANCH_REQUIRED: A valid active branch selection is mandatory.');
    }
    const cleanIdem = String(params.idempotencyKey || '').trim();
    if (!cleanIdem) {
      throw new Error('IDEMPOTENCY_KEY_REQUIRED: idempotencyKey is required.');
    }

    const validActorUuid =
      params.createdBy && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.createdBy)
        ? params.createdBy
        : null;

    const todayIndia = getIndiaDateParts(params.now).dateIso;
    const requestedBillingDate = String(params.billingDate || todayIndia).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedBillingDate) || requestedBillingDate > todayIndia) {
      throw new Error('INVALID_BILLING_DATE: billingDate must be today or an earlier Asia/Kolkata date.');
    }

    // 1. Primary path: atomic PostgreSQL RPC. A past date deliberately fails
    // closed until Migration 023 is applied; silently issuing a current-date
    // bill number would break central numbering.
    if (params.db) {
      let rpcRes = await params.db.rpc('smav_reserve_central_bill_number', {
        p_outlet_id: params.outletId,
        p_branch_code: cleanBranchCode,
        p_idempotency_key: cleanIdem,
        p_source_system: params.sourceSystem,
        p_created_by: validActorUuid,
        p_device_id: params.deviceId || null,
        p_bill_prefix: params.billPrefix || 'TGL',
        p_branch_id: cleanBranchId,
        p_billing_date: requestedBillingDate,
      });

      if (
        rpcRes.error &&
        (rpcRes.error.code === 'PGRST202' || /could not find the function/i.test(String(rpcRes.error.message || '')))
      ) {
        if (requestedBillingDate !== todayIndia) {
          throw new Error('BACKDATED_BILLING_MIGRATION_REQUIRED: Apply SMAV Migration 023 before creating backdated bills.');
        }
        rpcRes = await params.db.rpc('smav_reserve_central_bill_number', {
          p_outlet_id: params.outletId,
          p_branch_code: cleanBranchCode,
          p_idempotency_key: cleanIdem,
          p_source_system: params.sourceSystem,
          p_created_by: validActorUuid,
          p_device_id: params.deviceId || null,
          p_bill_prefix: params.billPrefix || 'TGL',
        });
      }

      if (!rpcRes.error && Array.isArray(rpcRes.data) && rpcRes.data.length > 0) {
        const row = rpcRes.data[0];
        return {
          centralBillId: String(row.central_bill_id),
          centralBillNumber: String(row.central_bill_number),
          outletId: String(row.outlet_id),
          branchId: row.branch_id ? String(row.branch_id) : cleanBranchId,
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

      if (rpcRes.error) {
        const msg = String(rpcRes.error.message || '');
        const rpcMissing =
          rpcRes.error.code === '42883' ||
          rpcRes.error.code === 'PGRST202' ||
          /could not find the function|does not exist/i.test(msg);
        if (!rpcMissing) {
          throw new Error(msg);
        }
      }
    }

    // 2. Fallback path (in-process registry for unit tests / local dev without DB RPC)
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

    const memBranches = this.memBranchesByOutlet.get(params.outletId) || [];
    const matchedMemBranch = resolveBranchFromMaster(memBranches, {
      branchId: cleanBranchId,
      branchCode: cleanBranchCode,
      branchName: params.branchName,
    });
    if (memBranches.length > 0 && !matchedMemBranch) {
      throw new Error(`INVALID_BRANCH: Branch "${cleanBranchId || cleanBranchCode}" is not configured or active for this outlet.`);
    }

    const resolvedBranchId = matchedMemBranch?.id || cleanBranchId || `brn-${cleanBranchCode.toLowerCase()}`;
    const resolvedBranchCode = matchedMemBranch?.branchCode || cleanBranchCode;
    const resolvedBranchName =
      matchedMemBranch?.name || String(params.branchName || '').trim() || resolvedBranchCode;
    const resolvedPrefix = matchedMemBranch?.billPrefix || params.billPrefix || 'TGL';

    const { dateIso, dateCompact } = getIndiaDateParts(new Date(`${requestedBillingDate}T12:00:00+05:30`));
    const counterKey = `${params.outletId}:${resolvedBranchCode}:${dateCompact}`;

    let currentMax = this.memCounters.get(counterKey) || 0;
    if (params.db && currentMax === 0) {
      try {
        const prefix = `${resolvedPrefix.toUpperCase()}-${resolvedBranchCode}-${dateCompact}-`;
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
      resolvedBranchCode,
      dateCompact,
      nextSeq,
      resolvedPrefix
    );
    const record: MemoryBillRecord = {
      centralBillId: crypto.randomUUID(),
      centralBillNumber,
      outletId: params.outletId,
      branchId: resolvedBranchId,
      branchCode: resolvedBranchCode,
      branchName: resolvedBranchName,
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
    branchId?: string | null;
    branchCode: string;
    branchName?: string | null;
    deviceId: string;
    count?: number;
    allocatedBy?: string | null;
    billPrefix?: string;
    now?: Date;
  }): Promise<{
    batchId: string;
    outletId: string;
    branchId: string | null;
    branchCode: string;
    branchName: string;
    billingDate: string;
    items: PreallocatedBillNumberItem[];
    storageMode: 'central_rpc' | 'memory_fallback';
  }> {
    const cleanBranchCode = normalizeDynamicBranchCode(params.branchCode);
    const cleanBranchId = String(params.branchId || '').trim() || null;
    if (!cleanBranchCode) {
      throw new Error('BRANCH_REQUIRED: A valid active branchCode is required.');
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
      let rpcRes = await params.db.rpc('smav_allocate_bill_number_range', {
        p_outlet_id: params.outletId,
        p_branch_code: cleanBranchCode,
        p_device_id: cleanDevice,
        p_count: safeCount,
        p_allocated_by: validActorUuid,
        p_bill_prefix: params.billPrefix || 'TGL',
        p_branch_id: cleanBranchId,
      });

      if (
        rpcRes.error &&
        (rpcRes.error.code === 'PGRST202' || /could not find the function/i.test(String(rpcRes.error.message || '')))
      ) {
        rpcRes = await params.db.rpc('smav_allocate_bill_number_range', {
          p_outlet_id: params.outletId,
          p_branch_code: cleanBranchCode,
          p_device_id: cleanDevice,
          p_count: safeCount,
          p_allocated_by: validActorUuid,
          p_bill_prefix: params.billPrefix || 'TGL',
        });
      }

      if (!rpcRes.error && Array.isArray(rpcRes.data) && rpcRes.data.length > 0) {
        const first = rpcRes.data[0];
        const items: PreallocatedBillNumberItem[] = rpcRes.data.map((row: any) => ({
          batchId: String(row.batch_id),
          centralBillId: String(row.central_bill_id),
          centralBillNumber: String(row.central_bill_number),
          outletId: String(row.outlet_id),
          branchId: row.branch_id ? String(row.branch_id) : cleanBranchId,
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
          branchId: first.branch_id ? String(first.branch_id) : cleanBranchId,
          branchCode: String(first.branch_code),
          branchName: String(first.branch_name),
          billingDate: String(first.billing_date),
          items,
          storageMode: 'central_rpc',
        };
      }

      if (rpcRes.error) {
        const msg = String(rpcRes.error.message || '');
        const rpcMissing =
          rpcRes.error.code === '42883' ||
          rpcRes.error.code === 'PGRST202' ||
          /could not find the function|does not exist/i.test(msg);
        if (!rpcMissing) {
          throw new Error(msg);
        }
      }
    }

    // Memory fallback for local testing / pre-migration dev
    const memBranches = this.memBranchesByOutlet.get(params.outletId) || [];
    const matchedMemBranch = resolveBranchFromMaster(memBranches, {
      branchId: cleanBranchId,
      branchCode: cleanBranchCode,
      branchName: params.branchName,
    });
    if (memBranches.length > 0 && !matchedMemBranch) {
      throw new Error(`INVALID_BRANCH: Branch "${cleanBranchId || cleanBranchCode}" is not configured or active for this outlet.`);
    }

    const resolvedBranchId = matchedMemBranch?.id || cleanBranchId || `brn-${cleanBranchCode.toLowerCase()}`;
    const resolvedBranchCode = matchedMemBranch?.branchCode || cleanBranchCode;
    const resolvedBranchName =
      matchedMemBranch?.name || String(params.branchName || '').trim() || resolvedBranchCode;
    const resolvedPrefix = matchedMemBranch?.billPrefix || params.billPrefix || 'TGL';

    const { dateIso, dateCompact } = getIndiaDateParts(params.now);
    const counterKey = `${params.outletId}:${resolvedBranchCode}:${dateCompact}`;
    const startSeq = (this.memCounters.get(counterKey) || 0) + 1;
    const endSeq = startSeq + safeCount - 1;
    this.memCounters.set(counterKey, endSeq);

    const batchId = crypto.randomUUID();
    const expiresAt = new Date((params.now || new Date()).getTime() + 24 * 60 * 60 * 1000).toISOString();
    const cleanDeviceTail = cleanDevice.replace(/[^A-Za-z0-9]/g, '').slice(-12);
    const items: PreallocatedBillNumberItem[] = [];

    for (let seq = startSeq; seq <= endSeq; seq++) {
      const centralBillNumber = formatCentralBillNumber(resolvedBranchCode, dateCompact, seq, resolvedPrefix);
      const idempotencyKey = `PREALLOC_${centralBillNumber}_${cleanDeviceTail}`;
      const centralBillId = crypto.randomUUID();
      const record: MemoryBillRecord = {
        centralBillId,
        centralBillNumber,
        outletId: params.outletId,
        branchId: resolvedBranchId,
        branchCode: resolvedBranchCode,
        branchName: resolvedBranchName,
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
        branchId: resolvedBranchId,
        branchCode: resolvedBranchCode,
        branchName: resolvedBranchName,
        billingDate: dateIso,
        sequenceNumber: seq,
        idempotencyKey,
        expiresAt,
      });
    }

    return {
      batchId,
      outletId: params.outletId,
      branchId: resolvedBranchId,
      branchCode: resolvedBranchCode,
      branchName: resolvedBranchName,
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
          reason: 'UNLINKED_CENTRAL_FORMAT',
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
