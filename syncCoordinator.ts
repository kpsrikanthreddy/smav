import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

export type SyncOrigin = 'smav_portal' | 'outlet_admin' | 'outbox_retry';
export type SyncAction = 'upsert_user' | 'update_user' | 'reset_password' | 'set_status';
export type OutboxStatus =
  | 'PENDING'
  | 'PARTIAL_CENTRAL_ONLY'
  | 'PARTIAL_OUTLET_ONLY'
  | 'SYNCED'
  | 'CONFLICT'
  | 'FAILED';

export interface OutletTargetDescriptor {
  id: string;
  code: string;
  name: string;
  providerType?: string;
  supabaseUrl?: string;
  syncWebhookUrl?: string;
}

export interface SanitizedUserSyncPayload {
  userId?: string;
  externalStaffId?: string;
  fullName?: string;
  username?: string;
  email?: string;
  phone?: string;
  role?: 'ADMIN' | 'STAFF';
  isActive?: boolean;
  mustChangePassword?: boolean;
  syncVersion?: number;
}

export interface OutboxRecord {
  id: string;
  idempotencyKey: string;
  operationId: string;
  syncOrigin: SyncOrigin;
  action: SyncAction;
  outletId: string | null;
  outletCode: string;
  targetUserId: string | null;
  externalStaffId: string | null;
  payload: SanitizedUserSyncPayload;
  centralConfirmed: boolean;
  outletConfirmed: boolean;
  status: OutboxStatus;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  lastError: string | null;
  conflictDetails: Record<string, any> | null;
  syncVersion: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DispatchSyncInput {
  idempotencyKey?: string;
  operationId?: string;
  syncOrigin: SyncOrigin;
  action: SyncAction;
  outlet: OutletTargetDescriptor;
  actorUserId?: string;
  centralAuthToken: string;
  isBusinessKey?: boolean;
  // Sensitive fields used transiently in-memory ONLY — NEVER stored in outbox or logs
  transientPassword?: string;
  payload: SanitizedUserSyncPayload;
}

export interface DispatchSyncResult {
  success: boolean;
  httpStatus: number;
  message: string;
  userId?: string;
  email?: string;
  username?: string;
  role?: 'ADMIN' | 'STAFF';
  isNewUser?: boolean;
  mustChangePassword?: boolean;
  passwordResetRequired?: boolean;
  conflict?: boolean;
  idempotentReplay?: boolean;
  centralConfirmed: boolean;
  outletConfirmed: boolean;
  syncStatus: OutboxStatus;
  outboxItem: OutboxRecord;
  conflictDetails?: Record<string, any> | null;
}

export interface OutletPushResult {
  ok: boolean;
  skippedCentralOnly?: boolean;
  isConflict?: boolean;
  isConfigMissing?: boolean;
  error?: string;
  conflictDetails?: Record<string, any>;
  externalStaffId?: string;
}

export type EdgeInvokerFn = (
  action: string,
  payload: Record<string, any>,
  tokenOrKey?: string,
  isBusinessKey?: boolean,
  extraHeaders?: Record<string, string>
) => Promise<any>;

export interface SyncCoordinatorDeps {
  invokeEdge: EdgeInvokerFn;
  getCentralUrl: () => string;
  resolveOutlet: (codeOrId: string) => Promise<OutletTargetDescriptor | null>;
  logAudit: (entry: {
    eventType: string;
    actorId?: string;
    outletId?: string;
    details: Record<string, any>;
  }) => void;
  getCentralDbClient?: () => any | null;
  onCentralConfirmed?: (event: {
    action: SyncAction;
    outletCode: string;
    outletId?: string | null;
    userId?: string | null;
    isActive?: boolean;
  }) => void | Promise<void>;
}

function normalizeEnvPrefix(code: string): string {
  return String(code || '')
    .trim()
    .replace(/[^a-z0-9]/gi, '_')
    .toUpperCase();
}

export class OutletUserSyncCoordinator {
  private deps: SyncCoordinatorDeps;
  private outbox = new Map<string, OutboxRecord>();
  private idempotencyIndex = new Map<string, string>();
  private retryTimer: NodeJS.Timeout | null = null;

  constructor(deps: SyncCoordinatorDeps) {
    this.deps = deps;
  }

  public startRetryWorker() {
    if (this.retryTimer) return;
    this.retryTimer = setInterval(() => {
      this.processDueRetries().catch((err) => {
        console.warn('[SyncCoordinator] Scheduled outbox retry note:', err?.message || err);
      });
    }, 30 * 1000);
  }

  public stopRetryWorker() {
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
  }

  public getOutletIntegrationKey(outletCode: string): string {
    const clean = String(outletCode || '').trim().toLowerCase();
    if (clean === 'glossylooks' && process.env.GLOSSYLOOKS_INTEGRATION_KEY) {
      return process.env.GLOSSYLOOKS_INTEGRATION_KEY.trim();
    }
    if (clean === 'mozz' && process.env.MOZZ_INTEGRATION_KEY) {
      return process.env.MOZZ_INTEGRATION_KEY.trim();
    }
    const prefix = normalizeEnvPrefix(clean);
    const dynamicKey = process.env[`OUTLET_${prefix}_INTEGRATION_KEY`];
    if (dynamicKey) return dynamicKey.trim();

    try {
      const jsonRaw = process.env.OUTLET_INTEGRATION_KEYS;
      if (jsonRaw) {
        const parsed = JSON.parse(jsonRaw);
        if (parsed && typeof parsed[clean] === 'string') {
          return parsed[clean].trim();
        }
      }
    } catch (_e) {
      // Ignore malformed optional JSON
    }
    return '';
  }

  private resolveOutletSyncTarget(outlet: OutletTargetDescriptor): {
    centralOnly: boolean;
    webhookUrl?: string;
    integrationKey?: string;
    supabaseUrl?: string;
    serviceRoleKey?: string;
  } {
    const cleanCode = String(outlet.code || '').trim().toLowerCase();
    const prefix = normalizeEnvPrefix(cleanCode);

    const webhookUrl =
      outlet.syncWebhookUrl?.trim() ||
      (cleanCode === 'glossylooks' ? process.env.GLOSSYLOOKS_SYNC_WEBHOOK_URL?.trim() : undefined) ||
      (cleanCode === 'mozz' ? process.env.MOZZ_SYNC_WEBHOOK_URL?.trim() : undefined) ||
      process.env[`OUTLET_${prefix}_SYNC_WEBHOOK_URL`]?.trim();

    const integrationKey = this.getOutletIntegrationKey(cleanCode);

    const supabaseUrl =
      (cleanCode === 'glossylooks' ? process.env.GLOSSYLOOKS_SUPABASE_URL?.trim() : undefined) ||
      (cleanCode === 'mozz' ? process.env.MOZZ_SUPABASE_URL?.trim() : undefined) ||
      process.env[`OUTLET_${prefix}_SUPABASE_URL`]?.trim() ||
      outlet.supabaseUrl?.trim();

    const serviceRoleKey =
      (cleanCode === 'glossylooks' ? process.env.GLOSSYLOOKS_SERVICE_ROLE_KEY?.trim() : undefined) ||
      (cleanCode === 'mozz' ? process.env.MOZZ_SERVICE_ROLE_KEY?.trim() : undefined) ||
      process.env[`OUTLET_${prefix}_SERVICE_ROLE_KEY`]?.trim();

    // Central-only outlets do not maintain a separate database unless webhook or outlet service key is configured
    const isCentralOnly =
      outlet.providerType === 'central_smav' && !webhookUrl && !serviceRoleKey;

    return {
      centralOnly: isCentralOnly,
      webhookUrl,
      integrationKey,
      supabaseUrl,
      serviceRoleKey,
    };
  }

  private sanitizePayload(payload: SanitizedUserSyncPayload): SanitizedUserSyncPayload {
    return {
      ...(payload.userId ? { userId: String(payload.userId) } : {}),
      ...(payload.externalStaffId ? { externalStaffId: String(payload.externalStaffId) } : {}),
      ...(payload.fullName ? { fullName: String(payload.fullName) } : {}),
      ...(payload.username ? { username: String(payload.username).toLowerCase() } : {}),
      ...(payload.email ? { email: String(payload.email).trim().toLowerCase() } : {}),
      ...(payload.phone ? { phone: String(payload.phone) } : {}),
      ...(payload.role ? { role: payload.role } : {}),
      ...(typeof payload.isActive === 'boolean' ? { isActive: payload.isActive } : {}),
      ...(typeof payload.mustChangePassword === 'boolean'
        ? { mustChangePassword: payload.mustChangePassword }
        : {}),
      ...(payload.syncVersion ? { syncVersion: Number(payload.syncVersion) } : {}),
    };
  }

  private sanitizeErrorText(rawError?: string | null, sensitiveValues: Array<string | undefined> = []): string | null {
    if (!rawError) return null;
    let text = String(rawError);
    for (const secret of sensitiveValues) {
      if (secret && secret.length >= 4) {
        text = text.split(secret).join('[REDACTED]');
      }
    }
    text = text
      .replace(/(password|initialPassword|newPassword|temporaryPassword|secret|token|apikey|authorization)\s*[:=]\s*["']?[^\s"',}]+["']?/gi, '$1=[REDACTED]')
      .slice(0, 400);
    return text;
  }

  private getCentralServiceDb(): any | null {
    if (this.deps.getCentralDbClient) {
      return this.deps.getCentralDbClient();
    }
    const centralUrl = this.deps.getCentralUrl();
    const serviceKey = process.env.SMAV_SERVICE_ROLE_KEY?.trim();
    if (!centralUrl || !serviceKey) return null;
    return createClient(centralUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  private rowToOutboxRecord(row: any): OutboxRecord {
    const rawPayload = (row?.payload && typeof row.payload === 'object') ? row.payload : {};
    return {
      id: String(row.id),
      idempotencyKey: String(row.idempotency_key || row.id),
      operationId: String(row.operation_id || row.id),
      syncOrigin: row.sync_origin || 'smav_portal',
      action: row.action || 'upsert_user',
      outletId: row.outlet_id || null,
      outletCode: String(row.outlet_code || '').toLowerCase(),
      targetUserId: row.target_user_id || null,
      externalStaffId: row.external_staff_id || null,
      payload: this.sanitizePayload(rawPayload),
      centralConfirmed: Boolean(row.central_confirmed),
      outletConfirmed: Boolean(row.outlet_confirmed),
      status: row.status || 'PENDING',
      attempts: Number(row.attempts || 0),
      maxAttempts: Number(row.max_attempts || 5),
      nextRetryAt: row.next_retry_at || null,
      lastError: row.last_error || null,
      conflictDetails: row.conflict_details || null,
      syncVersion: Number(row.sync_version || 1),
      createdBy: row.created_by || null,
      createdAt: row.created_at || new Date().toISOString(),
      updatedAt: row.updated_at || row.created_at || new Date().toISOString(),
    };
  }

  private async persistOutboxToCentralDb(record: OutboxRecord) {
    const client = this.getCentralServiceDb();
    if (!client) return;

    try {
      await client.from('smav_sync_outbox').upsert(
        {
          id: record.id,
          idempotency_key: record.idempotencyKey,
          operation_id: record.operationId,
          sync_origin: record.syncOrigin,
          action: record.action,
          outlet_id: record.outletId,
          outlet_code: record.outletCode,
          target_user_id: record.targetUserId,
          external_staff_id: record.externalStaffId,
          payload: this.sanitizePayload(record.payload),
          central_confirmed: record.centralConfirmed,
          outlet_confirmed: record.outletConfirmed,
          status: record.status,
          attempts: record.attempts,
          max_attempts: record.maxAttempts,
          next_retry_at: record.nextRetryAt,
          last_error: record.lastError,
          conflict_details: record.conflictDetails,
          sync_version: record.syncVersion,
          created_by: record.createdBy,
          updated_at: record.updatedAt,
        },
        { onConflict: 'idempotency_key' }
      );
    } catch (_e) {
      // Safe fallback to in-memory outbox if migration 012 hasn't been executed yet
    }
  }

  private async hydrateOutboxItemFromDb(
    outboxId: string,
    callerSupabaseJwt?: string
  ): Promise<OutboxRecord | null> {
    const cached = this.outbox.get(outboxId);
    if (cached) return cached;

    let client = this.getCentralServiceDb();
    if (!client && callerSupabaseJwt) {
      const centralUrl = this.deps.getCentralUrl();
      const anonKey = process.env.SMAV_SUPABASE_ANON_KEY || process.env.VITE_SMAV_SUPABASE_ANON_KEY || '';
      if (centralUrl && anonKey) {
        client = createClient(centralUrl, anonKey, {
          auth: { autoRefreshToken: false, persistSession: false },
          global: { headers: { Authorization: `Bearer ${callerSupabaseJwt}` } },
        });
      }
    }
    if (!client) return null;

    try {
      const { data, error } = await client
        .from('smav_sync_outbox')
        .select('*')
        .eq('id', outboxId)
        .maybeSingle();
      if (!error && data) {
        const hydrated = this.rowToOutboxRecord(data);
        this.outbox.set(hydrated.id, hydrated);
        this.idempotencyIndex.set(hydrated.idempotencyKey, hydrated.id);
        return hydrated;
      }
    } catch (_e) {
      // Non-fatal
    }
    return null;
  }

  private async findByIdempotencyKeyInDb(idempotencyKey: string): Promise<OutboxRecord | null> {
    const existingId = this.idempotencyIndex.get(idempotencyKey);
    if (existingId && this.outbox.has(existingId)) {
      return this.outbox.get(existingId)!;
    }

    const client = this.getCentralServiceDb();
    if (!client) return null;

    try {
      const { data, error } = await client
        .from('smav_sync_outbox')
        .select('*')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      if (!error && data) {
        const hydrated = this.rowToOutboxRecord(data);
        this.outbox.set(hydrated.id, hydrated);
        this.idempotencyIndex.set(hydrated.idempotencyKey, hydrated.id);
        return hydrated;
      }
    } catch (_e) {
      // Non-fatal
    }
    return null;
  }

  /**
   * When an authoritative outlet_admin sync succeeds for a user, automatically resolve older
   * stale PENDING / PARTIAL_CENTRAL_ONLY / FAILED outbox items for the same (outlet, user)
   * so the user does not stay stuck showing PENDING OUTLET / OUTBOX PENDING.
   */
  private async supersedeStaleOutboxForUser(params: {
    outletCode: string;
    targetUserId?: string | null;
    externalStaffId?: string | null;
    excludeOutboxId: string;
  }) {
    const cleanOutlet = params.outletCode.trim().toLowerCase();
    const nowIso = new Date().toISOString();
    const staleStatuses: OutboxStatus[] = ['PENDING', 'PARTIAL_CENTRAL_ONLY', 'PARTIAL_OUTLET_ONLY', 'FAILED'];

    // 1. Update in-memory outbox entries
    for (const item of this.outbox.values()) {
      if (item.id === params.excludeOutboxId) continue;
      if (item.outletCode.toLowerCase() !== cleanOutlet) continue;
      if (!staleStatuses.includes(item.status)) continue;

      const matchesUser = Boolean(params.targetUserId && item.targetUserId === params.targetUserId);
      const matchesExternal = Boolean(params.externalStaffId && item.externalStaffId === params.externalStaffId);
      if (matchesUser || matchesExternal) {
        item.centralConfirmed = true;
        item.outletConfirmed = true;
        item.status = 'SYNCED';
        item.lastError = null;
        item.nextRetryAt = null;
        item.updatedAt = nowIso;
      }
    }

    // 2. Update Central DB smav_sync_outbox entries durably
    const client = this.getCentralServiceDb();
    if (!client) return;

    const patch = {
      central_confirmed: true,
      outlet_confirmed: true,
      status: 'SYNCED',
      last_error: null,
      next_retry_at: null,
      updated_at: nowIso,
    };

    try {
      if (params.targetUserId) {
        await client
          .from('smav_sync_outbox')
          .update(patch)
          .eq('outlet_code', cleanOutlet)
          .eq('target_user_id', params.targetUserId)
          .neq('id', params.excludeOutboxId)
          .in('status', staleStatuses);
      }
      if (params.externalStaffId) {
        await client
          .from('smav_sync_outbox')
          .update(patch)
          .eq('outlet_code', cleanOutlet)
          .eq('external_staff_id', params.externalStaffId)
          .neq('id', params.excludeOutboxId)
          .in('status', staleStatuses);
      }
    } catch (_e) {
      // Non-fatal
    }
  }

  public async listOutbox(params?: {
    outletCode?: string;
    allowedOutletCodes?: string[];
    callerSupabaseJwt?: string;
    limit?: number;
  }): Promise<OutboxRecord[]> {
    const merged = new Map<string, OutboxRecord>();

    for (const item of this.outbox.values()) {
      merged.set(item.id, item);
    }

    let client = this.getCentralServiceDb();
    if (!client && params?.callerSupabaseJwt) {
      const centralUrl = this.deps.getCentralUrl();
      const anonKey = process.env.SMAV_SUPABASE_ANON_KEY || process.env.VITE_SMAV_SUPABASE_ANON_KEY || '';
      if (centralUrl && anonKey) {
        client = createClient(centralUrl, anonKey, {
          auth: { autoRefreshToken: false, persistSession: false },
          global: { headers: { Authorization: `Bearer ${params.callerSupabaseJwt}` } },
        });
      }
    }

    if (client) {
      try {
        let q = client
          .from('smav_sync_outbox')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(params?.limit || 100);
        if (params?.outletCode) {
          q = q.eq('outlet_code', params.outletCode.toLowerCase());
        }
        const { data, error } = await q;
        if (!error && Array.isArray(data)) {
          for (const row of data) {
            const mapped = this.rowToOutboxRecord(row);
            merged.set(mapped.id, mapped);
            // Hydrate DB rows into memory so retryOutboxItem() always finds active DB items after restarts
            this.outbox.set(mapped.id, mapped);
            this.idempotencyIndex.set(mapped.idempotencyKey, mapped.id);
          }
        }
      } catch (_e) {
        // Ignore when DB table doesn't exist yet
      }
    }

    let items = Array.from(merged.values());
    if (params?.outletCode) {
      const codeLower = params.outletCode.toLowerCase();
      items = items.filter((i) => i.outletCode.toLowerCase() === codeLower);
    }
    if (params?.allowedOutletCodes) {
      const allowed = new Set(params.allowedOutletCodes.map((c) => c.toLowerCase()));
      items = items.filter((i) => allowed.has(i.outletCode.toLowerCase()));
    }

    items.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return items.slice(0, params?.limit || 100);
  }

  public async dispatchSync(input: DispatchSyncInput): Promise<DispatchSyncResult> {
    const cleanOutletCode = String(input.outlet.code || '').trim().toLowerCase();
    const idempotencyKey =
      input.idempotencyKey?.trim() ||
      `smav_${input.action}_${cleanOutletCode}_${crypto.randomUUID()}`;
    const operationId = input.operationId?.trim() || crypto.randomUUID();

    // Return cached/DB idempotent result if already processed cleanly (prevent duplicate work / sync loops)
    const existing = await this.findByIdempotencyKeyInDb(idempotencyKey);
    const existingId = existing?.id;
    if (existing && existing.status === 'SYNCED') {
      return {
        success: true,
        httpStatus: 200,
        message: 'Idempotent replay: already synchronized across Central SMAV and outlet.',
        userId: existing.targetUserId || undefined,
        email: existing.payload.email,
        username: existing.payload.username,
        role: existing.payload.role,
        mustChangePassword: existing.payload.mustChangePassword,
        conflict: false,
        idempotentReplay: true,
        centralConfirmed: existing.centralConfirmed,
        outletConfirmed: existing.outletConfirmed,
        syncStatus: existing.status,
        outboxItem: existing,
      };
    }
    if (existing && existing.status === 'CONFLICT') {
      return {
        success: false,
        httpStatus: 409,
        message: existing.lastError || 'Idempotent replay: identity conflict requires manual reconciliation.',
        userId: existing.targetUserId || undefined,
        email: existing.payload.email,
        username: existing.payload.username,
        role: existing.payload.role,
        conflict: true,
        idempotentReplay: true,
        centralConfirmed: existing.centralConfirmed,
        outletConfirmed: existing.outletConfirmed,
        syncStatus: existing.status,
        outboxItem: existing,
        conflictDetails: existing.conflictDetails,
      };
    }

    const nowIso = new Date().toISOString();
    const sanitized = this.sanitizePayload(input.payload);

    const record: OutboxRecord = {
      id: existingId || crypto.randomUUID(),
      idempotencyKey,
      operationId,
      syncOrigin: input.syncOrigin,
      action: input.action,
      outletId: input.outlet.id || null,
      outletCode: cleanOutletCode,
      targetUserId: sanitized.userId || null,
      externalStaffId: sanitized.externalStaffId || null,
      payload: sanitized,
      centralConfirmed: false,
      outletConfirmed: input.syncOrigin === 'outlet_admin', // Originating outlet already performed its local write
      status: 'PENDING',
      attempts: 1,
      maxAttempts: 5,
      nextRetryAt: null,
      lastError: null,
      conflictDetails: null,
      syncVersion: Number(sanitized.syncVersion || 1),
      createdBy: input.actorUserId || null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    this.outbox.set(record.id, record);
    this.idempotencyIndex.set(idempotencyKey, record.id);

    // -------------------------------------------------------------------------
    // STEP 1: Confirm Central SMAV Edge Function write (NO passwords in outbox)
    // -------------------------------------------------------------------------
    const edgeAction =
      input.action === 'reset_password'
        ? 'reset-password'
        : input.action === 'set_status'
          ? 'set-status'
          : input.action === 'update_user'
            ? 'update-user'
            : 'upsert-user';

    const edgeBody: Record<string, any> = {
      outletCode: cleanOutletCode,
      businessSource: cleanOutletCode,
      syncOrigin: input.syncOrigin,
      ...sanitized,
      ...(input.transientPassword
        ? input.action === 'reset_password'
          ? { newPassword: input.transientPassword }
          : { initialPassword: input.transientPassword }
        : {}),
    };

    const edgeRes = await this.deps.invokeEdge(
      edgeAction,
      edgeBody,
      input.centralAuthToken,
      Boolean(input.isBusinessKey),
      {
        'X-Idempotency-Key': idempotencyKey,
        'X-SMAV-Sync-Origin': input.syncOrigin,
        'X-Operation-Id': operationId,
      }
    );

    if (!edgeRes?.success) {
      const httpStatus = Number(edgeRes?.status || 400);
      const isConflict = httpStatus === 409 || edgeRes?.conflict === true;
      record.centralConfirmed = false;
      record.status = isConflict ? 'CONFLICT' : 'FAILED';
      record.lastError = this.sanitizeErrorText(
        edgeRes?.error || edgeRes?.message || 'Central SMAV update rejected',
        [input.transientPassword, input.centralAuthToken]
      );
      record.conflictDetails = isConflict ? edgeRes?.details || { error: record.lastError } : null;
      record.updatedAt = new Date().toISOString();
      await this.persistOutboxToCentralDb(record);

      return {
        success: false,
        httpStatus: isConflict ? 409 : httpStatus,
        message: record.lastError || 'Failed to update Central SMAV',
        conflict: isConflict,
        centralConfirmed: false,
        outletConfirmed: record.outletConfirmed,
        syncStatus: record.status,
        outboxItem: record,
        conflictDetails: record.conflictDetails,
      };
    }

    // Central confirmed! Capture authoritative UUID & metadata
    record.centralConfirmed = true;
    record.targetUserId = edgeRes.userId || record.targetUserId;
    if (edgeRes.externalStaffId && !record.externalStaffId) {
      record.externalStaffId = String(edgeRes.externalStaffId);
    }
    record.payload = this.sanitizePayload({
      ...record.payload,
      userId: record.targetUserId || undefined,
      externalStaffId: record.externalStaffId || undefined,
      email: edgeRes.email || record.payload.email,
      username: edgeRes.username || record.payload.username,
      fullName: edgeRes.fullName || record.payload.fullName,
      role: edgeRes.role || record.payload.role,
      isActive: typeof edgeRes.isActive === 'boolean' ? edgeRes.isActive : record.payload.isActive,
      mustChangePassword:
        typeof edgeRes.mustChangePassword === 'boolean'
          ? edgeRes.mustChangePassword
          : record.payload.mustChangePassword,
    });

    if (this.deps.onCentralConfirmed) {
      try {
        await this.deps.onCentralConfirmed({
          action: input.action,
          outletCode: cleanOutletCode,
          outletId: input.outlet.id || null,
          userId: record.targetUserId,
          isActive: record.payload.isActive,
        });
      } catch (_e) {
        // Non-fatal
      }
    }

    // -------------------------------------------------------------------------
    // STEP 2: Push to Target Outlet DB ONLY if sync did NOT originate from that outlet
    // Loop prevention: outlet_admin -> Central does NOT echo back to outlet_admin
    // -------------------------------------------------------------------------
    if (input.syncOrigin === 'outlet_admin') {
      record.outletConfirmed = true;
      record.status = 'SYNCED';
      record.lastError = null;
      record.nextRetryAt = null;
      record.updatedAt = new Date().toISOString();
      await this.persistOutboxToCentralDb(record);

      // Automatically clear any older stale PARTIAL_CENTRAL_ONLY / PENDING outbox items for this user
      await this.supersedeStaleOutboxForUser({
        outletCode: cleanOutletCode,
        targetUserId: record.targetUserId,
        externalStaffId: record.externalStaffId,
        excludeOutboxId: record.id,
      });

      return {
        success: true,
        httpStatus: 200,
        message: edgeRes.message || 'Synchronized user from Outlet Admin to Central SMAV.',
        userId: record.targetUserId || undefined,
        email: record.payload.email,
        username: record.payload.username,
        role: record.payload.role,
        isNewUser: Boolean(edgeRes.isNewUser),
        mustChangePassword: record.payload.mustChangePassword,
        passwordResetRequired: Boolean(edgeRes.passwordResetRequired),
        conflict: false,
        centralConfirmed: true,
        outletConfirmed: true,
        syncStatus: 'SYNCED',
        outboxItem: record,
      };
    }

    // Origin was smav_portal or outbox_retry -> Push metadata/status to target outlet DB
    const outletPush = await this.pushToOutletTarget(input.outlet, record);
    if (outletPush.ok) {
      record.outletConfirmed = true;
      if (outletPush.externalStaffId) {
        record.externalStaffId = outletPush.externalStaffId;
      }
      record.status = 'SYNCED';
      record.lastError = null;
      record.nextRetryAt = null;
      record.updatedAt = new Date().toISOString();
      await this.persistOutboxToCentralDb(record);

      return {
        success: true,
        httpStatus: 200,
        message: outletPush.skippedCentralOnly
          ? `${edgeRes.message || 'User updated in Central SMAV.'}`
          : `${edgeRes.message || 'User updated.'} Confirmed in both Central SMAV and ${input.outlet.name}.`,
        userId: record.targetUserId || undefined,
        email: record.payload.email,
        username: record.payload.username,
        role: record.payload.role,
        isNewUser: Boolean(edgeRes.isNewUser),
        mustChangePassword: record.payload.mustChangePassword,
        centralConfirmed: true,
        outletConfirmed: true,
        syncStatus: 'SYNCED',
        outboxItem: record,
      };
    }

    // Target outlet push failed or detected conflict -> Do NOT falsely claim full sync!
    record.outletConfirmed = false;
    record.status = outletPush.isConflict ? 'CONFLICT' : 'PARTIAL_CENTRAL_ONLY';
    record.lastError = outletPush.error || 'Target outlet database did not confirm synchronization.';
    record.conflictDetails = outletPush.conflictDetails || null;
    record.nextRetryAt = outletPush.isConflict
      ? null
      : new Date(Date.now() + 60 * 1000).toISOString();
    record.updatedAt = new Date().toISOString();
    await this.persistOutboxToCentralDb(record);

    this.deps.logAudit({
      eventType: outletPush.isConflict ? 'OUTLET_SYNC_CONFLICT' : 'OUTLET_SYNC_QUEUED_IN_OUTBOX',
      actorId: input.actorUserId,
      outletId: input.outlet.id,
      details: {
        outboxId: record.id,
        outletCode: cleanOutletCode,
        targetUserId: record.targetUserId,
        status: record.status,
        error: record.lastError,
      },
    });

    return {
      // Central updated, but outlet failed: clearly surface partial sync status & 207/409
      success: false,
      httpStatus: outletPush.isConflict ? 409 : 207,
      message: outletPush.isConflict
        ? `Sync conflict in ${input.outlet.name}: ${record.lastError}`
        : `Updated in Central SMAV, but ${input.outlet.name} could not confirm sync yet (queued in outbox for retry): ${record.lastError}`,
      userId: record.targetUserId || undefined,
      email: record.payload.email,
      username: record.payload.username,
      role: record.payload.role,
      isNewUser: Boolean(edgeRes.isNewUser),
      mustChangePassword: record.payload.mustChangePassword,
      conflict: Boolean(outletPush.isConflict),
      centralConfirmed: true,
      outletConfirmed: false,
      syncStatus: record.status,
      outboxItem: record,
      conflictDetails: record.conflictDetails,
    };
  }

  public async retryOutboxItem(
    outboxId: string,
    callerSupabaseJwt?: string
  ): Promise<{
    success: boolean;
    message: string;
    item?: OutboxRecord;
  }> {
    const item = await this.hydrateOutboxItemFromDb(outboxId, callerSupabaseJwt);
    if (!item) {
      return {
        success: false,
        message: `Outbox item "${outboxId}" was not found in memory or smav_sync_outbox.`,
      };
    }
    if (item.status === 'SYNCED') {
      return { success: true, message: 'Already synchronized across both systems.', item };
    }
    if (item.status === 'CONFLICT') {
      return {
        success: false,
        message: `Resolve conflict before retrying: ${item.lastError || 'Conflict flagged'}`,
        item,
      };
    }

    const outlet = await this.deps.resolveOutlet(item.outletCode);
    if (!outlet) {
      return { success: false, message: `Outlet "${item.outletCode}" not found or inactive.`, item };
    }

    item.attempts += 1;
    const pushRes = await this.pushToOutletTarget(outlet, item);
    item.updatedAt = new Date().toISOString();

    if (pushRes.ok) {
      item.outletConfirmed = true;
      if (pushRes.externalStaffId) {
        item.externalStaffId = pushRes.externalStaffId;
      }
      item.status = item.centralConfirmed ? 'SYNCED' : 'PARTIAL_OUTLET_ONLY';
      item.lastError = null;
      item.nextRetryAt = null;
      await this.persistOutboxToCentralDb(item);
      return {
        success: item.status === 'SYNCED',
        message:
          item.status === 'SYNCED'
            ? `Synchronization confirmed with ${outlet.name}.`
            : 'Outlet confirmed, awaiting Central SMAV.',
        item,
      };
    }

    item.status = pushRes.isConflict
      ? 'CONFLICT'
      : item.attempts >= item.maxAttempts
        ? 'FAILED'
        : 'PARTIAL_CENTRAL_ONLY';
    item.lastError = pushRes.error || 'Outlet retry failed';
    item.conflictDetails = pushRes.conflictDetails || null;
    item.nextRetryAt =
      item.status === 'PARTIAL_CENTRAL_ONLY'
        ? new Date(Date.now() + Math.min(15 * 60 * 1000, item.attempts * 60 * 1000)).toISOString()
        : null;
    await this.persistOutboxToCentralDb(item);

    return {
      success: false,
      message: item.lastError,
      item,
    };
  }

  /**
   * SUPERADMIN emergency recovery helper: marks a stale/orphaned outbox item as SYNCED
   * after administrator verification (e.g. when the authoritative outlet portal already holds
   * the latest record and a legacy smav_portal outbox row remained stuck in PARTIAL_CENTRAL_ONLY).
   */
  public async resolveOutboxItem(params: {
    outboxId: string;
    actorUserId: string;
    reason?: string;
    callerSupabaseJwt?: string;
  }): Promise<{ success: boolean; message: string; item?: OutboxRecord }> {
    const item = await this.hydrateOutboxItemFromDb(params.outboxId, params.callerSupabaseJwt);
    if (!item) {
      return {
        success: false,
        message: `Outbox item "${params.outboxId}" was not found in memory or smav_sync_outbox.`,
      };
    }

    const nowIso = new Date().toISOString();
    item.centralConfirmed = true;
    item.outletConfirmed = true;
    item.status = 'SYNCED';
    item.lastError = null;
    item.nextRetryAt = null;
    item.conflictDetails = null;
    item.updatedAt = nowIso;
    await this.persistOutboxToCentralDb(item);

    this.deps.logAudit({
      eventType: 'SUPERADMIN_OUTBOX_ITEM_RESOLVED',
      actorId: params.actorUserId,
      outletId: item.outletId || undefined,
      details: {
        outboxId: item.id,
        outletCode: item.outletCode,
        targetUserId: item.targetUserId,
        reason: params.reason || 'Manually verified and resolved by SUPERADMIN',
      },
    });

    return {
      success: true,
      message: `Outbox item ${item.id} marked SYNCED by SUPERADMIN.`,
      item,
    };
  }

  public async processDueRetries() {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    // Hydrate due DB-persisted PARTIAL_CENTRAL_ONLY rows so container restarts never orphan retries
    const client = this.getCentralServiceDb();
    if (client) {
      try {
        const { data, error } = await client
          .from('smav_sync_outbox')
          .select('*')
          .eq('status', 'PARTIAL_CENTRAL_ONLY')
          .lte('next_retry_at', nowIso)
          .limit(25);
        if (!error && Array.isArray(data)) {
          for (const row of data) {
            const hydrated = this.rowToOutboxRecord(row);
            this.outbox.set(hydrated.id, hydrated);
            this.idempotencyIndex.set(hydrated.idempotencyKey, hydrated.id);
          }
        }
      } catch (_e) {
        // Non-fatal
      }
    }

    for (const item of this.outbox.values()) {
      if (
        item.status === 'PARTIAL_CENTRAL_ONLY' &&
        item.nextRetryAt &&
        new Date(item.nextRetryAt).getTime() <= now &&
        item.attempts < item.maxAttempts
      ) {
        await this.retryOutboxItem(item.id);
      }
    }
  }

  private async pushToOutletTarget(
    outlet: OutletTargetDescriptor,
    record: OutboxRecord
  ): Promise<OutletPushResult> {
    const target = this.resolveOutletSyncTarget(outlet);
    if (target.centralOnly) {
      return { ok: true, skippedCentralOnly: true };
    }

    // Mode A: Signed webhook directly to outlet portal backend
    if (target.webhookUrl) {
      try {
        const res = await fetch(target.webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-SMAV-Sync-Origin': 'smav_portal',
            'X-Idempotency-Key': record.idempotencyKey,
            'X-Operation-Id': record.operationId,
            ...(target.integrationKey ? { 'X-Integration-Key': target.integrationKey } : {}),
          },
          body: JSON.stringify({
            syncOrigin: 'smav_portal',
            action: record.action,
            outletCode: record.outletCode,
            userId: record.targetUserId,
            externalStaffId: record.externalStaffId,
            fullName: record.payload.fullName,
            username: record.payload.username,
            email: record.payload.email,
            phone: record.payload.phone,
            role: record.payload.role,
            isActive: record.payload.isActive,
            mustChangePassword: record.payload.mustChangePassword,
            syncVersion: record.syncVersion,
          }),
          signal: AbortSignal.timeout(7000),
        });

        const data = await res.json().catch(() => ({}));
        if (res.status === 409) {
          return {
            ok: false,
            isConflict: true,
            error: data?.message || data?.error || 'Outlet webhook reported an identity conflict',
            conflictDetails: data,
          };
        }
        if (!res.ok || data?.success === false) {
          return {
            ok: false,
            error: data?.message || data?.error || `Outlet webhook HTTP ${res.status}`,
          };
        }
        return {
          ok: true,
          externalStaffId: data?.externalStaffId || record.externalStaffId || undefined,
        };
      } catch (err: any) {
        return {
          ok: false,
          error: `Outlet webhook unreachable: ${err?.message || 'Timeout'}`,
        };
      }
    }

    // Mode B: Direct Outlet Supabase Service-Role Database Sync (preserves existing tables/records)
    if (target.supabaseUrl && target.serviceRoleKey && record.targetUserId) {
      try {
        const outletDb = createClient(target.supabaseUrl, target.serviceRoleKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        const cleanEmail = record.payload.email?.trim().toLowerCase();
        const centralUserId = record.targetUserId;
        const linkTimestamp = new Date().toISOString();

        // 1. Check/Upsert smav_staff_links (canonical linkage table from template & outlet migrations)
        const { data: existingLinks, error: linkLookupErr } = await outletDb
          .from('smav_staff_links')
          .select('id, central_auth_id, email, external_staff_id')
          .or(
            [
              `central_auth_id.eq.${centralUserId}`,
              ...(cleanEmail ? [`email.ilike.${cleanEmail}`] : []),
            ].join(',')
          );

        if (!linkLookupErr && Array.isArray(existingLinks)) {
          const conflictLink = existingLinks.find(
            (l: any) => l.central_auth_id && l.central_auth_id !== centralUserId
          );
          if (conflictLink) {
            return {
              ok: false,
              isConflict: true,
              error: `Outlet smav_staff_links already binds email "${cleanEmail}" to a different central_auth_id (${conflictLink.central_auth_id}).`,
              conflictDetails: conflictLink,
            };
          }

          const linkPayload = {
            external_staff_id:
              record.externalStaffId || existingLinks[0]?.external_staff_id || centralUserId,
            central_auth_id: centralUserId,
            central_auth_status: record.payload.isActive === false ? 'DISABLED' : 'ACTIVE',
            central_auth_linked_at: linkTimestamp,
            email: cleanEmail || null,
            full_name: record.payload.fullName || null,
            role: record.payload.role || 'STAFF',
            is_active: record.payload.isActive !== false,
            updated_at: linkTimestamp,
          };

          if (existingLinks[0]?.id) {
            const { error: updLinkErr } = await outletDb
              .from('smav_staff_links')
              .update(linkPayload)
              .eq('id', existingLinks[0].id);
            if (updLinkErr) {
              return { ok: false, error: `Failed updating smav_staff_links: ${updLinkErr.message}` };
            }
          } else {
            const { error: insLinkErr } = await outletDb
              .from('smav_staff_links')
              .insert(linkPayload);
            if (insLinkErr) {
              return { ok: false, error: `Failed inserting smav_staff_links: ${insLinkErr.message}` };
            }
          }
        }

        // 2. Also update public.staff when present in the target outlet database
        const { data: staffRows, error: staffCheckErr } = await outletDb
          .from('staff')
          .select('id, central_auth_id, email')
          .or(
            [
              `central_auth_id.eq.${centralUserId}`,
              ...(cleanEmail ? [`email.ilike.${cleanEmail}`] : []),
              ...(record.externalStaffId ? [`id.eq.${record.externalStaffId}`] : []),
            ].join(',')
          );

        if (!staffCheckErr && Array.isArray(staffRows)) {
          const staffConflict = staffRows.find(
            (s: any) => s.central_auth_id && s.central_auth_id !== centralUserId
          );
          if (staffConflict) {
            return {
              ok: false,
              isConflict: true,
              error: `Outlet staff record already linked to a different central_auth_id (${staffConflict.central_auth_id}).`,
              conflictDetails: staffConflict,
            };
          }

          if (staffRows[0]?.id) {
            const { error: updStaffErr } = await outletDb
              .from('staff')
              .update({
                ...(record.payload.fullName ? { name: record.payload.fullName } : {}),
                ...(cleanEmail ? { email: cleanEmail } : {}),
                ...(typeof record.payload.isActive === 'boolean'
                  ? { is_active: record.payload.isActive }
                  : {}),
                central_auth_id: centralUserId,
                central_auth_status: record.payload.isActive === false ? 'DISABLED' : 'ACTIVE',
                central_auth_linked_at: linkTimestamp,
              })
              .eq('id', staffRows[0].id);
            if (updStaffErr) {
              return { ok: false, error: `Failed updating outlet staff row: ${updStaffErr.message}` };
            }
            return { ok: true, externalStaffId: String(staffRows[0].id) };
          }
        }

        // If smav_staff_links succeeded, confirm
        if (!linkLookupErr) {
          return { ok: true };
        }

        return {
          ok: false,
          error: `Target outlet database missing smav_staff_links and staff sync tables (${linkLookupErr?.message || staffCheckErr?.message})`,
        };
      } catch (err: any) {
        return { ok: false, error: `Outlet Supabase sync error: ${err?.message || 'Unknown error'}` };
      }
    }

    // Mode C: Target outlet webhook/service credentials are not configured in server env yet
    return {
      ok: false,
      isConfigMissing: true,
      error: `Outlet "${outlet.code}" write webhook or Supabase service credentials not configured; queued in smav_sync_outbox.`,
    };
  }
}
