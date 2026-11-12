/**
 * The Glossy Looks Admin Portal - Central SMAV Auth Gateway Adapter
 * File: integrations/glossylooks/glossylooks_smav_auth_adapter.ts
 *
 * Use this adapter inside The Glossy Looks Admin Portal codebase (www.glossylooks.in).
 * When an owner or manager creates, updates, deactivates, or resets a staff member,
 * this adapter securely synchronizes their identity with the Central SMAV Supabase Auth.
 *
 * Operational rules:
 * 1. Plaintext passwords are NEVER stored in The Glossy Looks database or transmitted insecurely.
 * 2. If a staff user already exists in Central Auth, their identity is linked without duplicate accounts.
 * 3. Glossy Looks staff are strictly assigned to outlet_glossy_gach and salon POS.
 */

export interface GlossyLooksStaffPayload {
  externalStaffId: string;
  email: string;
  fullName: string;
  phone?: string;
  role: 'staff' | 'admin';
  temporaryPassword?: string;
}

export interface CentralAuthResponse {
  success: boolean;
  message: string;
  centralUserId?: string;
  isNewUser?: boolean;
  isLinked?: boolean;
  outletCode?: string;
  activationToken?: string;
}

export class GlossyLooksSmavAuthAdapter {
  private centralGatewayUrl: string;
  private gatewaySecret: string;
  private outletCode: string = 'glossylooks';

  constructor(config?: { centralGatewayUrl?: string; gatewaySecret?: string; outletCode?: string }) {
    this.centralGatewayUrl = config?.centralGatewayUrl || process.env.SMAV_GATEWAY_URL || 'https://smav-print-agent.internal';
    this.gatewaySecret = config?.gatewaySecret || process.env.SMAV_GATEWAY_SECRET || '';
    if (config?.outletCode) this.outletCode = config.outletCode;
  }

  /**
   * When an owner/manager adds a staff member in The Glossy Looks Admin Portal,
   * call this method to provision or link the user in Central SMAV Auth.
   */
  async provisionOrLinkStaff(staff: GlossyLooksStaffPayload): Promise<CentralAuthResponse> {
    try {
      const response = await fetch(`${this.centralGatewayUrl}/api/central-auth/staff/provision`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-SMAV-Gateway-Secret': this.gatewaySecret
        },
        body: JSON.stringify({
          email: staff.email.trim().toLowerCase(),
          fullName: staff.fullName.trim(),
          phone: staff.phone || '',
          role: staff.role || 'staff',
          outletCode: this.outletCode,
          businessSource: 'glossylooks',
          externalStaffId: staff.externalStaffId,
          temporaryPassword: staff.temporaryPassword
        })
      });

      const data = await response.json();
      return data;
    } catch (error: any) {
      console.error('[Glossy Looks SMAV Adapter] Provisioning failed:', error);
      return {
        success: false,
        message: `Failed to reach Central SMAV Auth Gateway: ${error.message}`
      };
    }
  }

  /**
   * Toggle staff active status in Central SMAV Auth and Outlet Roles.
   */
  async setStaffActiveStatus(emailOrUserId: string, isActive: boolean): Promise<CentralAuthResponse> {
    try {
      const response = await fetch(`${this.centralGatewayUrl}/api/central-auth/staff/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-SMAV-Gateway-Secret': this.gatewaySecret
        },
        body: JSON.stringify({
          email: emailOrUserId,
          outletCode: this.outletCode,
          isActive
        })
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
      const response = await fetch(`${this.centralGatewayUrl}/api/central-auth/staff/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-SMAV-Gateway-Secret': this.gatewaySecret
        },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          outletCode: this.outletCode
        })
      });

      return await response.json();
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }

  /**
   * Controlled migration for legacy staff who exist in Glossy Looks database
   * but do not yet have a Central Supabase Auth login.
   */
  async migrateLegacyStaff(staff: {
    externalStaffId: string;
    email: string;
    fullName: string;
    phone?: string;
  }): Promise<CentralAuthResponse> {
    try {
      const response = await fetch(`${this.centralGatewayUrl}/api/central-auth/staff/migrate-legacy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-SMAV-Gateway-Secret': this.gatewaySecret
        },
        body: JSON.stringify({
          email: staff.email.trim().toLowerCase(),
          fullName: staff.fullName,
          phone: staff.phone || '',
          outletCode: this.outletCode,
          businessSource: 'glossylooks',
          externalStaffId: staff.externalStaffId
        })
      });

      return await response.json();
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }
}
