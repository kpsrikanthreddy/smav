/**
 * Central SMAV Identity Admin Service
 * Location: src/services/identityAdminService.ts
 *
 * Communicates with the Supabase Edge Function:
 * https://qykdwswatopylzvqhgog.supabase.co/functions/v1/smav-identity-admin
 *
 * Uses the caller's authenticated Supabase JWT Bearer token.
 * Never exposes or transmits the service-role key.
 */

const CENTRAL_SUPABASE_PROJECT_URL =
  import.meta.env.VITE_SMAV_SUPABASE_URL || 'https://qykdwswatopylzvqhgog.supabase.co';

const CENTRAL_SUPABASE_ANON_KEY =
  import.meta.env.VITE_SMAV_SUPABASE_ANON_KEY || '';

export const EDGE_FUNCTION_ENDPOINT = `${CENTRAL_SUPABASE_PROJECT_URL}/functions/v1/smav-identity-admin`;

export interface EdgeFunctionResult<T = any> {
  success: boolean;
  message?: string;
  error?: string;
  userId?: string;
  isNewUser?: boolean;
  recoveryLink?: string;
  activationLink?: string;
  data?: T;
  staff?: any[];
  results?: any[];
  details?: any;
}

export class IdentityAdminService {
  private endpoint: string;

  constructor(endpoint?: string) {
    this.endpoint = endpoint || EDGE_FUNCTION_ENDPOINT;
  }

  private async callEdgeFunction<T = any>(
    token: string,
    action: string,
    payload: Record<string, any> = {}
  ): Promise<EdgeFunctionResult<T>> {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      };
      if (CENTRAL_SUPABASE_ANON_KEY) {
        headers['apikey'] = CENTRAL_SUPABASE_ANON_KEY;
      }

      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action, ...payload }),
      });

      const data = await response.json();
      if (!response.ok) {
        const errorMsg =
          response.status === 401
            ? `Supabase 401 Unauthorized: Invalid or expired Supabase user JWT, or Edge Function requires --no-verify-jwt. (${data.error || data.message || 'Unauthorized'})`
            : data.error || data.message || `HTTP ${response.status}: Action failed`;
        return {
          success: false,
          error: errorMsg,
          details: data,
        };
      }
      return data;
    } catch (err: any) {
      console.error(`[IdentityAdminService] Error calling ${action}:`, err);
      return {
        success: false,
        error: `Network or edge connection failure: ${err.message}`,
      };
    }
  }

  /**
   * Superadmin creates an outlet administrator for any registered outlet.
   */
  async createOutletAdmin(
    token: string,
    payload: {
      email: string;
      fullName: string;
      phone?: string;
      outletCode: string;
      temporaryPassword?: string;
      username?: string;
    }
  ): Promise<EdgeFunctionResult> {
    return this.callEdgeFunction(token, 'create-admin', payload);
  }

  /**
   * Superadmin or assigned Outlet Admin creates a staff member.
   */
  async createOutletStaff(
    token: string,
    payload: {
      email: string;
      fullName: string;
      phone?: string;
      outletCode: string;
      temporaryPassword?: string;
      username?: string;
      externalStaffId?: string;
      externalRole?: string;
    }
  ): Promise<EdgeFunctionResult> {
    return this.callEdgeFunction(token, 'create-staff', payload);
  }

  /**
   * Toggle staff status (activate / deactivate).
   */
  async setStaffStatus(
    token: string,
    payload: {
      userId: string;
      email?: string;
      outletCode?: string;
      isActive: boolean;
    }
  ): Promise<EdgeFunctionResult> {
    return this.callEdgeFunction(token, 'set-status', payload);
  }

  /**
   * Securely reset password for staff or generate recovery link without exposing passwords.
   */
  async resetPassword(
    token: string,
    payload: {
      userId?: string;
      email?: string;
      newPassword?: string;
      outletCode?: string;
    }
  ): Promise<EdgeFunctionResult> {
    return this.callEdgeFunction(token, 'reset-password', payload);
  }

  /**
   * List staff belonging to authorized outlets.
   */
  async listStaff(token: string, outletCode?: string): Promise<EdgeFunctionResult> {
    return this.callEdgeFunction(token, 'list-staff', { outletCode });
  }

  /**
   * Retrieve identity and outlet permissions.
   */
  async getIdentityInfo(token: string): Promise<EdgeFunctionResult> {
    return this.callEdgeFunction(token, 'get-info');
  }

  /**
   * Synchronize staff from The Glossy Looks Admin Portal.
   * Interactive requests use the authenticated Supabase user JWT.
   */
  async syncGlossyLooks(
    userToken: string,
    staff: any[]
  ): Promise<EdgeFunctionResult> {
    return this.callEdgeFunction(userToken, 'sync-glossylooks', { staff });
  }

  /**
   * Synchronize staff from MOZZ / Starters4U Admin Portal.
   * Interactive requests use the authenticated Supabase user JWT.
   */
  async syncMozz(
    userToken: string,
    staff: any[]
  ): Promise<EdgeFunctionResult> {
    return this.callEdgeFunction(userToken, 'sync-mozz', { staff });
  }
}

export const identityAdminService = new IdentityAdminService();
