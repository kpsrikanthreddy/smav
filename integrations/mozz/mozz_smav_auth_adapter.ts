/**
 * MOZZ / Starters4U Admin Portal - Central SMAV Auth & Edge Function Adapter
 * File: integrations/mozz/mozz_smav_auth_adapter.ts
 *
 * Use this adapter inside MOZZ / Starters4U Admin Portal codebase (www.starters4u.in).
 * When a restaurant owner or manager creates, updates, deactivates, or resets a staff member,
 * this adapter securely synchronizes their identity with Central SMAV Supabase Auth
 * via the `smav-identity-admin` Supabase Edge Function.
 *
 * Operational rules:
 * 1. Plaintext passwords are NEVER stored in MOZZ database or transmitted insecurely.
 * 2. If a staff user already exists in Central Auth, their identity is linked without duplicate accounts.
 * 3. MOZZ staff are strictly assigned to the active outlet resolved from central smav_outlets using outlet code mozz and restaurant POS.
 * 4. Never exposes or requires Supabase service_role keys in client bundles.
 */

export interface MozzStaffPayload {
  externalStaffId: string;
  email: string;
  fullName: string;
  phone?: string;
  role: 'OWNER' | 'MANAGER' | 'CASHIER' | 'WAITER' | 'ADMIN' | 'STAFF' | string;
  username?: string;
  isActive?: boolean;
  temporaryPassword?: string;
}

export interface CentralAuthResponse {
  success: boolean;
  message: string;
  userId?: string;
  isNewUser?: boolean;
  recoveryLink?: string;
  outletCode?: string;
  results?: any[];
}

export class MozzSmavAuthAdapter {
  private edgeFunctionUrl: string;
  private integrationKey: string;
  private outletCode: string = 'mozz';

  constructor(config?: { edgeFunctionUrl?: string; integrationKey?: string; outletCode?: string }) {
    this.edgeFunctionUrl =
      config?.edgeFunctionUrl ||
      process.env.SMAV_EDGE_FUNCTION_URL ||
      'https://qykdwswatopylzvqhgog.supabase.co/functions/v1/smav-identity-admin';
    this.integrationKey = config?.integrationKey || process.env.MOZZ_INTEGRATION_KEY || '';
    if (config?.outletCode) this.outletCode = config.outletCode;
  }

  /**
   * Synchronize a newly created or updated staff member from MOZZ Admin Portal
   * directly to Central SMAV Supabase Auth and RBAC roles.
   */
  async syncStaffMember(staff: MozzStaffPayload): Promise<CentralAuthResponse> {
    try {
      const response = await fetch(this.edgeFunctionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Business-Source': 'mozz',
          'X-Integration-Key': this.integrationKey,
        },
        body: JSON.stringify({
          action: 'sync-mozz',
          staff: [
            {
              id: staff.externalStaffId,
              email: staff.email.trim().toLowerCase(),
              name: staff.fullName.trim(),
              phone: staff.phone || '',
              role: staff.role || 'CASHIER',
              username: staff.username || staff.email.split('@')[0],
              isActive: staff.isActive !== false,
            },
          ],
        }),
      });

      const data = await response.json();
      return {
        success: data.success,
        message: data.message || (data.success ? 'Staff synchronized successfully' : data.error),
        results: data.results,
      };
    } catch (error: any) {
      console.error('[MOZZ SMAV Adapter] Synchronization failed:', error);
      return {
        success: false,
        message: `Failed to reach Central SMAV Edge Function: ${error.message}`,
      };
    }
  }

  /**
   * Batch synchronize all active staff members from MOZZ / Starters4U.
   */
  async syncAllStaff(staffList: MozzStaffPayload[]): Promise<CentralAuthResponse> {
    try {
      const response = await fetch(this.edgeFunctionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Business-Source': 'mozz',
          'X-Integration-Key': this.integrationKey,
        },
        body: JSON.stringify({
          action: 'sync-mozz',
          staff: staffList.map((st) => ({
            id: st.externalStaffId,
            email: st.email.trim().toLowerCase(),
            name: st.fullName.trim(),
            phone: st.phone || '',
            role: st.role || 'CASHIER',
            username: st.username || st.email.split('@')[0],
            isActive: st.isActive !== false,
          })),
        }),
      });

      return await response.json();
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }

  /**
   * Toggle staff active status in Central SMAV Auth and Outlet Roles.
   */
  async setStaffActiveStatus(emailOrUserId: string, isActive: boolean): Promise<CentralAuthResponse> {
    try {
      const isEmail = emailOrUserId.includes('@');
      const response = await fetch(this.edgeFunctionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Business-Source': 'mozz',
          'X-Integration-Key': this.integrationKey,
        },
        body: JSON.stringify({
          action: 'set-status',
          ...(isEmail ? { email: emailOrUserId } : { userId: emailOrUserId }),
          outletCode: this.outletCode,
          isActive,
        }),
      });

      return await response.json();
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }

  /**
   * Initiate a secure password reset / activation link for a MOZZ staff member.
   */
  async requestPasswordReset(email: string): Promise<CentralAuthResponse> {
    try {
      const response = await fetch(this.edgeFunctionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Business-Source': 'mozz',
          'X-Integration-Key': this.integrationKey,
        },
        body: JSON.stringify({
          action: 'reset-password',
          email: email.trim().toLowerCase(),
          outletCode: this.outletCode,
        }),
      });

      const data = await response.json();
      return {
        success: data.success,
        message: data.message || data.error,
        recoveryLink: data.recoveryLink,
      };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }
}
