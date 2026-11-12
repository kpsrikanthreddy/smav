/**
 * The Glossy Looks Admin Portal - Central SMAV Auth & Edge Function Adapter
 * File: integrations/glossylooks/glossylooks_smav_auth_adapter.ts
 *
 * Use this adapter inside The Glossy Looks Admin Portal codebase (www.glossylooks.in).
 * When an owner or manager creates, updates, deactivates, or resets a staff member,
 * this adapter securely synchronizes their identity with Central SMAV Supabase Auth
 * via the `smav-identity-admin` Supabase Edge Function.
 *
 * Operational rules:
 * 1. Plaintext passwords are NEVER stored in The Glossy Looks database or transmitted insecurely.
 * 2. If a staff user already exists in Central Auth, their identity is linked without duplicate accounts.
 * 3. Glossy Looks staff are strictly assigned to outlet_glossy_gach and salon POS.
 * 4. Never exposes or requires Supabase service_role keys in client bundles.
 */

export interface GlossyLooksStaffPayload {
  externalStaffId: string;
  email: string;
  fullName: string;
  phone?: string;
  role: 'OWNER' | 'MANAGER' | 'STYLIST' | 'RECEPTIONIST' | 'ADMIN' | 'STAFF' | string;
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

export class GlossyLooksSmavAuthAdapter {
  private edgeFunctionUrl: string;
  private integrationKey: string;
  private outletCode: string = 'glossylooks';

  constructor(config?: { edgeFunctionUrl?: string; integrationKey?: string; outletCode?: string }) {
    this.edgeFunctionUrl =
      config?.edgeFunctionUrl ||
      process.env.SMAV_EDGE_FUNCTION_URL ||
      'https://qykdwswatopylzvqhgog.supabase.co/functions/v1/smav-identity-admin';
    this.integrationKey = config?.integrationKey || process.env.GLOSSYLOOKS_INTEGRATION_KEY || '';
    if (config?.outletCode) this.outletCode = config.outletCode;
  }

  /**
   * Synchronize a newly created or updated staff member from Glossy Looks Admin Portal
   * directly to Central SMAV Supabase Auth and RBAC roles.
   */
  async syncStaffMember(staff: GlossyLooksStaffPayload): Promise<CentralAuthResponse> {
    try {
      const response = await fetch(this.edgeFunctionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Business-Source': 'glossylooks',
          'X-Integration-Key': this.integrationKey,
        },
        body: JSON.stringify({
          action: 'sync-glossylooks',
          staff: [
            {
              id: staff.externalStaffId,
              email: staff.email.trim().toLowerCase(),
              name: staff.fullName.trim(),
              phone: staff.phone || '',
              role: staff.role || 'STYLIST',
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
      console.error('[Glossy Looks SMAV Adapter] Synchronization failed:', error);
      return {
        success: false,
        message: `Failed to reach Central SMAV Edge Function: ${error.message}`,
      };
    }
  }

  /**
   * Batch synchronize all active staff members from Glossy Looks.
   */
  async syncAllStaff(staffList: GlossyLooksStaffPayload[]): Promise<CentralAuthResponse> {
    try {
      const response = await fetch(this.edgeFunctionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Business-Source': 'glossylooks',
          'X-Integration-Key': this.integrationKey,
        },
        body: JSON.stringify({
          action: 'sync-glossylooks',
          staff: staffList.map((st) => ({
            id: st.externalStaffId,
            email: st.email.trim().toLowerCase(),
            name: st.fullName.trim(),
            phone: st.phone || '',
            role: st.role || 'STYLIST',
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
          'X-Business-Source': 'glossylooks',
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
   * Initiate a secure password reset / activation link for a Glossy Looks staff member.
   */
  async requestPasswordReset(email: string): Promise<CentralAuthResponse> {
    try {
      const response = await fetch(this.edgeFunctionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Business-Source': 'glossylooks',
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

  /**
   * Real-time Event: Notify SMAV when staff member is created in Glossy Looks Admin Portal
   */
  async notifyStaffCreated(staff: GlossyLooksStaffPayload): Promise<CentralAuthResponse> {
    return this.syncStaffMember(staff);
  }

  /**
   * Real-time Event: Notify SMAV when staff member is updated in Glossy Looks Admin Portal
   */
  async notifyStaffUpdated(staff: GlossyLooksStaffPayload): Promise<CentralAuthResponse> {
    return this.syncStaffMember(staff);
  }

  /**
   * Real-time Event: Notify SMAV when staff member is deactivated in Glossy Looks Admin Portal
   */
  async notifyStaffDeactivated(staffId: string, email: string): Promise<CentralAuthResponse> {
    return this.setStaffActiveStatus(email || staffId, false);
  }

  /**
   * Real-time Event: Notify SMAV when staff member role is changed in Glossy Looks Admin Portal
   */
  async notifyRoleChanged(staff: GlossyLooksStaffPayload): Promise<CentralAuthResponse> {
    return this.syncStaffMember(staff);
  }

  /**
   * Trigger immediate full reconciliation between Glossy Looks and SMAV Central Identity
   */
  async triggerFullReconciliation(smavGatewayUrl?: string): Promise<{ success: boolean; message: string }> {
    const targetUrl = smavGatewayUrl || process.env.SMAV_GATEWAY_URL || 'https://www.glossylooks.in';
    try {
      const response = await fetch(`${targetUrl}/api/integrations/glossylooks/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Integration-Key': this.integrationKey,
        },
        body: JSON.stringify({ action: 'staff.sync_all' }),
      });
      return await response.json();
    } catch (error: any) {
      return { success: false, message: `Webhook reconciliation trigger failed: ${error.message}` };
    }
  }
}

