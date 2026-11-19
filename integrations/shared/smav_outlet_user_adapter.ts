/**
 * Generic Multi-Outlet SMAV User Synchronization Adapter
 * File: integrations/shared/smav_outlet_user_adapter.ts
 *
 * Reusable across any salon, restaurant, retail store, or future outlet portal.
 * Supports bidirectional synchronization between an Outlet Admin portal and
 * Central SMAV Supabase Auth (`smav-identity-admin` / SMAV Print Agent Gateway):
 *
 * - Single-source user creation: name, username, email, role, initialPassword (never stored in plaintext)
 * - Idempotent updates matched by existing Central Auth UUID or `(source, external_id)`
 * - Direct server-side password resets enforcing first-login password change (`must_change_password: true`)
 * - Loop prevention via `X-SMAV-Sync-Origin` and `X-Idempotency-Key`
 */

export interface OutletUserSyncPayload {
  userId?: string;
  externalStaffId?: string;
  email: string;
  fullName: string;
  username?: string;
  phone?: string;
  role?: 'OWNER' | 'MANAGER' | 'ADMIN' | 'STAFF' | 'STYLIST' | 'RECEPTIONIST' | 'CASHIER' | string;
  isActive?: boolean;
  initialPassword?: string;
  newPassword?: string;
}

export interface SmavSyncAdapterResponse {
  success: boolean;
  status?: number;
  message: string;
  userId?: string;
  email?: string;
  username?: string;
  role?: 'ADMIN' | 'STAFF';
  isNewUser?: boolean;
  mustChangePassword?: boolean;
  conflict?: boolean;
  details?: any;
}

export class SmavOutletUserAdapter {
  protected readonly outletCode: string;
  protected readonly gatewayOrEdgeUrl: string;
  protected readonly integrationKey: string;
  protected readonly useCentralGateway: boolean;

  constructor(config: {
    outletCode: string;
    integrationKey?: string;
    gatewayUrl?: string;
    edgeFunctionUrl?: string;
  }) {
    this.outletCode = String(config.outletCode || '').trim().toLowerCase();
    this.integrationKey = (config.integrationKey || '').trim();
    if (config.gatewayUrl?.trim()) {
      this.useCentralGateway = true;
      this.gatewayOrEdgeUrl = config.gatewayUrl.trim().replace(/\/+$/, '');
    } else {
      this.useCentralGateway = false;
      this.gatewayOrEdgeUrl = (
        config.edgeFunctionUrl ||
        process.env.SMAV_EDGE_FUNCTION_URL ||
        'https://qykdwswatopylzvqhgog.supabase.co/functions/v1/smav-identity-admin'
      ).trim();
    }
  }

  private buildHeaders(idempotencyKey?: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'X-Business-Source': this.outletCode,
      'X-Integration-Key': this.integrationKey,
      'X-SMAV-Sync-Origin': 'outlet_admin',
      'X-Idempotency-Key': idempotencyKey || `${this.outletCode}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    };
  }

  private async postSync(
    edgeAction: string,
    gatewayAction: 'upsert_user' | 'update_user' | 'reset_password' | 'set_status',
    body: Record<string, any>,
    idempotencyKey?: string
  ): Promise<SmavSyncAdapterResponse> {
    if (!this.integrationKey) {
      return {
        success: false,
        message: `Integration key not configured for outlet "${this.outletCode}".`,
      };
    }

    try {
      const targetUrl = this.useCentralGateway
        ? `${this.gatewayOrEdgeUrl}/api/integrations/outlets/${encodeURIComponent(this.outletCode)}/users/sync`
        : this.gatewayOrEdgeUrl;

      const payload = this.useCentralGateway
        ? {
            action: gatewayAction,
            syncOrigin: 'outlet_admin',
            outletCode: this.outletCode,
            ...body,
          }
        : {
            action: edgeAction,
            outletCode: this.outletCode,
            businessSource: this.outletCode,
            syncOrigin: 'outlet_admin',
            ...body,
          };

      const res = await fetch(targetUrl, {
        method: 'POST',
        headers: this.buildHeaders(idempotencyKey),
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      return {
        success: Boolean(res.ok && data?.success !== false),
        status: res.status,
        message: data?.message || data?.error || (res.ok ? 'Synchronized' : `HTTP ${res.status}`),
        userId: data?.centralUserId || data?.userId,
        email: data?.email,
        username: data?.username,
        role: data?.role,
        isNewUser: Boolean(data?.isNewUser),
        mustChangePassword: data?.mustChangePassword,
        conflict: res.status === 409,
        details: data,
      };
    } catch (err: any) {
      return {
        success: false,
        message: `SMAV synchronization failed: ${err?.message || 'Network error'}`,
      };
    }
  }

  /**
   * Create or update a staff/admin user from the Outlet Admin page.
   * For new users, supply `initialPassword` (>= 8 chars). Passwords are never saved locally in plaintext.
   * When updating an existing user without specifying `role`, the user's current SMAV role is preserved.
   */
  public upsertUser(user: OutletUserSyncPayload, idempotencyKey?: string): Promise<SmavSyncAdapterResponse> {
    const isUpdate = Boolean(user.userId);
    return this.postSync(
      isUpdate ? 'update-user' : 'upsert-user',
      isUpdate ? 'update_user' : 'upsert_user',
      {
        ...(user.userId ? { userId: user.userId, centralUserId: user.userId } : {}),
        ...(user.externalStaffId ? { externalStaffId: user.externalStaffId } : {}),
        ...(user.email ? { email: user.email.trim().toLowerCase() } : {}),
        ...(user.fullName ? { fullName: user.fullName.trim() } : {}),
        ...(user.username ? { username: user.username.trim().toLowerCase() } : {}),
        ...(typeof user.phone === 'string' ? { phone: user.phone.trim() } : {}),
        ...(user.role ? { role: user.role } : !isUpdate ? { role: 'STAFF' } : {}),
        ...(typeof user.isActive === 'boolean' ? { isActive: user.isActive } : !isUpdate ? { isActive: true } : {}),
        ...(user.initialPassword ? { initialPassword: user.initialPassword } : {}),
      },
      idempotencyKey
    );
  }

  /**
   * Update a user's email address on their existing Central Auth UUID (resolved by userId or externalStaffId)
   * without creating a duplicate Auth account or downgrading their role.
   */
  public updateEmail(params: {
    userId?: string;
    externalStaffId?: string;
    newEmail: string;
  }, idempotencyKey?: string): Promise<SmavSyncAdapterResponse> {
    return this.postSync(
      'update-email',
      'update_user',
      {
        ...(params.userId ? { userId: params.userId, centralUserId: params.userId } : {}),
        ...(params.externalStaffId ? { externalStaffId: params.externalStaffId } : {}),
        email: params.newEmail.trim().toLowerCase(),
        newEmail: params.newEmail.trim().toLowerCase(),
      },
      idempotencyKey
    );
  }

  /**
   * Directly set a temporary password for an existing staff member through Central Auth.
   * Forces password update on their first sign-in (`must_change_password: true`).
   */
  public resetPassword(params: {
    userId?: string;
    externalStaffId?: string;
    email?: string;
    newPassword: string;
  }): Promise<SmavSyncAdapterResponse> {
    return this.postSync('reset-password', 'reset_password', {
      ...(params.userId ? { userId: params.userId, centralUserId: params.userId } : {}),
      ...(params.externalStaffId ? { externalStaffId: params.externalStaffId } : {}),
      ...(params.email ? { email: params.email.trim().toLowerCase() } : {}),
      newPassword: params.newPassword,
    });
  }

  /**
   * Enable or disable an outlet user across the outlet and Central SMAV.
   */
  public setUserStatus(params: {
    userId?: string;
    externalStaffId?: string;
    email?: string;
    isActive: boolean;
  }): Promise<SmavSyncAdapterResponse> {
    return this.postSync('set-status', 'set_status', {
      userId: params.userId,
      externalStaffId: params.externalStaffId,
      email: params.email?.trim().toLowerCase(),
      isActive: params.isActive,
    });
  }

  /**
   * Helper for the Outlet Portal webhook route receiving updates FROM SMAV Print Agent (`smav_portal`).
   * Enforces `X-Integration-Key` verification and prevents echo loops when origin is already `outlet_admin`.
   */
  public verifyIncomingSmavWebhook(headers: Record<string, string | string[] | undefined>, body: any): {
    authorized: boolean;
    shouldApply: boolean;
    skipReason?: string;
  } {
    const rawKey = headers['x-integration-key'] || headers['X-Integration-Key'];
    const providedKey = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    if (!this.integrationKey || providedKey !== this.integrationKey) {
      return { authorized: false, shouldApply: false, skipReason: 'Invalid X-Integration-Key' };
    }

    const rawOrigin = headers['x-smav-sync-origin'] || headers['X-SMAV-Sync-Origin'] || body?.syncOrigin;
    const origin = String(Array.isArray(rawOrigin) ? rawOrigin[0] : rawOrigin || '').toLowerCase();
    if (origin === 'outlet_admin') {
      return {
        authorized: true,
        shouldApply: false,
        skipReason: 'Loop prevention: skipped echo of outlet_admin event',
      };
    }

    return { authorized: true, shouldApply: true };
  }
}
