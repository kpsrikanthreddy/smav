/**
 * Central SMAV Unified Identity & Multi-Outlet Sync Service
 * Location: src/services/identityAdminService.ts
 *
 * Uses the caller's authenticated SMAV session token via backend proxy APIs (`/api/outlet-users`, `/api/sync/outbox`).
 * Never exposes or transmits service-role keys. Never logs or stores plaintext passwords.
 */

import { OutletUserRecord, SyncOutboxItem } from '../types';

export interface UnifiedSyncResponse {
  success: boolean;
  httpStatus?: number;
  message: string;
  error?: string;
  userId?: string;
  email?: string;
  username?: string;
  role?: 'ADMIN' | 'STAFF';
  isNewUser?: boolean;
  mustChangePassword?: boolean;
  centralConfirmed?: boolean;
  outletConfirmed?: boolean;
  syncStatus?: string;
  outboxItem?: SyncOutboxItem;
  conflictDetails?: Record<string, any> | null;
}

export class IdentityAdminService {
  async listOutletUsers(
    sessionToken: string,
    outletCode?: string
  ): Promise<{ success: boolean; users: OutletUserRecord[]; message?: string }> {
    try {
      const qs = outletCode && outletCode !== 'all' ? `?outletCode=${encodeURIComponent(outletCode)}` : '';
      const response = await fetch(`/api/outlet-users${qs}`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const data = await response.json().catch(() => ({
        success: false,
        message: `HTTP ${response.status}: Invalid server response`,
        users: [],
      }));
      return {
        success: Boolean(response.ok && data.success !== false),
        users: Array.isArray(data.users) ? data.users : [],
        message: data.message || data.error,
      };
    } catch (err: any) {
      return {
        success: false,
        users: [],
        message: `Network error loading outlet users: ${err?.message || 'Unknown error'}`,
      };
    }
  }

  async upsertOutletUser(
    sessionToken: string,
    payload: {
      userId?: string;
      externalStaffId?: string;
      fullName: string;
      username?: string;
      email: string;
      phone?: string;
      role: 'ADMIN' | 'STAFF';
      outletCode: string;
      initialPassword?: string;
      isActive?: boolean;
      idempotencyKey?: string;
    }
  ): Promise<UnifiedSyncResponse> {
    try {
      const response = await fetch('/api/outlet-users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({
        success: false,
        message: `HTTP ${response.status}: Invalid server response`,
      }));
      return {
        ...data,
        httpStatus: response.status,
        success: Boolean(response.ok && data.success !== false),
        message: data.message || data.error || 'User operation completed.',
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Network error saving user: ${err?.message || 'Unknown error'}`,
      };
    }
  }

  async updateOutletUser(
    sessionToken: string,
    userId: string,
    payload: {
      externalStaffId?: string;
      fullName?: string;
      username?: string;
      email?: string;
      phone?: string;
      role?: 'ADMIN' | 'STAFF';
      outletCode: string;
      isActive?: boolean;
      idempotencyKey?: string;
    }
  ): Promise<UnifiedSyncResponse> {
    try {
      const response = await fetch(`/api/outlet-users/${encodeURIComponent(userId)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({
        success: false,
        message: `HTTP ${response.status}: Invalid server response`,
      }));
      return {
        ...data,
        httpStatus: response.status,
        success: Boolean(response.ok && data.success !== false),
        message: data.message || data.error || 'User updated.',
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Network error updating user: ${err?.message || 'Unknown error'}`,
      };
    }
  }

  async resetOutletUserPassword(
    sessionToken: string,
    userId: string,
    payload: {
      newPassword: string;
      email?: string;
      outletCode: string;
      idempotencyKey?: string;
    }
  ): Promise<UnifiedSyncResponse> {
    try {
      const response = await fetch(`/api/outlet-users/${encodeURIComponent(userId)}/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({
        success: false,
        message: `HTTP ${response.status}: Invalid server response`,
      }));
      return {
        ...data,
        httpStatus: response.status,
        success: Boolean(response.ok && data.success !== false),
        message: data.message || data.error || 'Password updated.',
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Network error resetting password: ${err?.message || 'Unknown error'}`,
      };
    }
  }

  async setOutletUserStatus(
    sessionToken: string,
    userId: string,
    payload: {
      isActive: boolean;
      email?: string;
      outletCode: string;
      idempotencyKey?: string;
    }
  ): Promise<UnifiedSyncResponse> {
    try {
      const response = await fetch(`/api/outlet-users/${encodeURIComponent(userId)}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({
        success: false,
        message: `HTTP ${response.status}: Invalid server response`,
      }));
      return {
        ...data,
        httpStatus: response.status,
        success: Boolean(response.ok && data.success !== false),
        message: data.message || data.error || 'User status updated.',
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Network error updating user status: ${err?.message || 'Unknown error'}`,
      };
    }
  }

  async listSyncOutbox(
    sessionToken: string,
    outletCode?: string
  ): Promise<{ success: boolean; items: SyncOutboxItem[]; message?: string }> {
    try {
      const qs = outletCode && outletCode !== 'all' ? `?outletCode=${encodeURIComponent(outletCode)}` : '';
      const response = await fetch(`/api/sync/outbox${qs}`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const data = await response.json().catch(() => ({
        success: false,
        items: [],
        message: `HTTP ${response.status}: Invalid server response`,
      }));
      return {
        success: Boolean(response.ok && data.success !== false),
        items: Array.isArray(data.items) ? data.items : [],
        message: data.message || data.error,
      };
    } catch (err: any) {
      return {
        success: false,
        items: [],
        message: `Network error loading outbox: ${err?.message || 'Unknown error'}`,
      };
    }
  }

  async retrySyncOutboxItem(
    sessionToken: string,
    outboxId: string
  ): Promise<{ success: boolean; message: string; item?: SyncOutboxItem }> {
    try {
      const response = await fetch(`/api/sync/outbox/${encodeURIComponent(outboxId)}/retry`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      const data = await response.json().catch(() => ({
        success: false,
        message: `HTTP ${response.status}: Invalid server response`,
      }));
      return {
        success: Boolean(response.ok && data.success !== false),
        message: data.message || data.error || 'Retry attempted.',
        item: data.item,
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Network error retrying sync item: ${err?.message || 'Unknown error'}`,
      };
    }
  }
}

export const identityAdminService = new IdentityAdminService();
