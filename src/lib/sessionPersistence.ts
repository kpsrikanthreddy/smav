import { OutletBranchOption, UserSession, VisibleRole, getVisibleRole } from '../types';

export const WEB_WORKSPACE_STORAGE_KEY = 'smav_web_workspace_v1';

export type WebWorkspaceTab = 'primary' | 'pos' | 'sync' | 'diagnostics';

export const CONFIRMED_SESSION_INVALID_CODES = new Set<string>([
  'SESSION_MISSING',
  'SESSION_EXPIRED',
  'SESSION_REVOKED',
  'ACCOUNT_DISABLED',
  'SESSION_INVALIDATED',
]);

/**
 * Non-sensitive UI workspace snapshot cached in browser storage ONLY to restore
 * identity, visible role, outlet, permitted branches, selected branch, and tab
 * across refresh/offline startup.
 *
 * SECURITY: Never stores bearer tokens, access tokens, or refresh tokens.
 * Authentication credentials live exclusively in HttpOnly cookies + React memory.
 */
export interface PersistedWorkspaceSnapshot {
  version: 1;
  userId: string;
  sessionId?: string;
  email: string;
  fullName: string;
  role: UserSession['role'];
  displayRole: VisibleRole;
  specificTitle: string;
  permissions: string[];
  deviceId: string;
  platformRole?: string;
  activeOutlet: UserSession['activeOutlet'];
  assignedOutlets: NonNullable<UserSession['assignedOutlets']>;
  activeTab: WebWorkspaceTab;
  permittedBranchesByOutlet: Record<string, OutletBranchOption[]>;
  selectedBranchByOutlet: Record<string, string>;
  createdAt: string;
  expiresAt?: string;
  hasSupabaseRefreshSession?: boolean;
  lastValidatedAt: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type SessionRestoreResult =
  | {
      status: 'authenticated';
      session: UserSession;
      activeTab: WebWorkspaceTab;
      permittedBranchesByOutlet: Record<string, OutletBranchOption[]>;
      selectedBranchByOutlet: Record<string, string>;
      isOffline: false;
    }
  | {
      status: 'offline_retained';
      session: UserSession;
      activeTab: WebWorkspaceTab;
      permittedBranchesByOutlet: Record<string, OutletBranchOption[]>;
      selectedBranchByOutlet: Record<string, string>;
      isOffline: true;
      offlineMessage: string;
    }
  | {
      status: 'unauthenticated';
      reasonCode?: string;
      message?: string;
    };

export type SessionRevalidationResult =
  | {
      status: 'valid';
      session: UserSession;
      permittedBranches?: OutletBranchOption[];
      isOffline: false;
    }
  | {
      status: 'offline_retained';
      offlineMessage: string;
    }
  | {
      status: 'invalidated';
      reasonCode: string;
      message: string;
    };

function getDefaultStorage(): StorageLike | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Ignore restricted storage contexts
  }
  return null;
}

export function isConfirmedSessionInvalidation(status: number, code?: string | null): boolean {
  if (status !== 401) return false;
  if (!code) return false;
  return CONFIRMED_SESSION_INVALID_CODES.has(String(code).trim().toUpperCase());
}

export function defaultTabForRole(role: UserSession['role']): WebWorkspaceTab {
  return role === 'superadmin' || role === 'admin' ? 'primary' : 'pos';
}

export function sanitizeTabForRole(tab: string | undefined, role: UserSession['role']): WebWorkspaceTab {
  if (tab === 'pos') return 'pos';
  if (tab === 'primary' && (role === 'superadmin' || role === 'admin')) return 'primary';
  if (tab === 'sync' && role !== 'staff') return 'sync';
  if (tab === 'diagnostics' && role === 'superadmin') return 'diagnostics';
  return defaultTabForRole(role);
}

export function loadWorkspaceSnapshot(storage: StorageLike | null = getDefaultStorage()): PersistedWorkspaceSnapshot | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(WEB_WORKSPACE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedWorkspaceSnapshot;
    if (!parsed || parsed.version !== 1 || !parsed.userId || !parsed.activeOutlet?.id) {
      return null;
    }
    return {
      ...parsed,
      displayRole: parsed.displayRole || getVisibleRole(parsed.role),
      assignedOutlets: Array.isArray(parsed.assignedOutlets) ? parsed.assignedOutlets : [],
      permittedBranchesByOutlet:
        parsed.permittedBranchesByOutlet && typeof parsed.permittedBranchesByOutlet === 'object'
          ? parsed.permittedBranchesByOutlet
          : {},
      selectedBranchByOutlet:
        parsed.selectedBranchByOutlet && typeof parsed.selectedBranchByOutlet === 'object'
          ? parsed.selectedBranchByOutlet
          : {},
      activeTab: sanitizeTabForRole(parsed.activeTab, parsed.role),
    };
  } catch {
    return null;
  }
}

export function saveWorkspaceSnapshot(
  params: {
    session: UserSession;
    activeTab: WebWorkspaceTab;
    permittedBranchesByOutlet?: Record<string, OutletBranchOption[]>;
    selectedBranchByOutlet?: Record<string, string>;
    lastValidatedAt?: number;
  },
  storage: StorageLike | null = getDefaultStorage()
): PersistedWorkspaceSnapshot {
  const existing = loadWorkspaceSnapshot(storage);
  const { session, activeTab } = params;

  const snapshot: PersistedWorkspaceSnapshot = {
    version: 1,
    userId: session.userId,
    sessionId: session.sessionId,
    email: session.email,
    fullName: session.fullName,
    role: session.role,
    displayRole: getVisibleRole(session.displayRole || session.role),
    specificTitle: session.specificTitle,
    permissions: Array.isArray(session.permissions) ? session.permissions : [],
    deviceId: session.deviceId,
    platformRole: session.platformRole,
    activeOutlet: session.activeOutlet,
    assignedOutlets: Array.isArray(session.assignedOutlets)
      ? session.assignedOutlets
      : existing?.assignedOutlets || [],
    activeTab: sanitizeTabForRole(activeTab, session.role),
    permittedBranchesByOutlet:
      params.permittedBranchesByOutlet ?? existing?.permittedBranchesByOutlet ?? {},
    selectedBranchByOutlet:
      params.selectedBranchByOutlet ?? existing?.selectedBranchByOutlet ?? {},
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    hasSupabaseRefreshSession: session.hasSupabaseRefreshSession,
    lastValidatedAt: params.lastValidatedAt ?? Date.now(),
  };

  if (storage) {
    try {
      storage.setItem(WEB_WORKSPACE_STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // Ignore quota / storage errors
    }
  }
  return snapshot;
}

export function clearWorkspaceSnapshot(storage: StorageLike | null = getDefaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(WEB_WORKSPACE_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

export function buildOfflineSessionFromSnapshot(
  snapshot: PersistedWorkspaceSnapshot,
  inMemoryToken = ''
): UserSession {
  return {
    token: inMemoryToken,
    sessionId: snapshot.sessionId,
    userId: snapshot.userId,
    email: snapshot.email,
    fullName: snapshot.fullName,
    role: snapshot.role,
    displayRole: snapshot.displayRole || getVisibleRole(snapshot.role),
    activeOutlet: snapshot.activeOutlet,
    assignedOutlets: snapshot.assignedOutlets || [],
    specificTitle: snapshot.specificTitle,
    permissions: snapshot.permissions || [],
    deviceId: snapshot.deviceId,
    createdAt: snapshot.createdAt,
    expiresAt: snapshot.expiresAt,
    hasSupabaseRefreshSession: snapshot.hasSupabaseRefreshSession,
    platformRole: snapshot.platformRole,
  };
}

function mergeBranchState(
  existingBranches: Record<string, OutletBranchOption[]>,
  existingSelected: Record<string, string>,
  outletId: string,
  incomingBranches?: OutletBranchOption[]
): {
  permittedBranchesByOutlet: Record<string, OutletBranchOption[]>;
  selectedBranchByOutlet: Record<string, string>;
} {
  const nextBranches = { ...existingBranches };
  const nextSelected = { ...existingSelected };

  if (Array.isArray(incomingBranches)) {
    const active = incomingBranches.filter((b) => b && b.isActive !== false && b.id);
    nextBranches[outletId] = active;
    const prevSel = nextSelected[outletId];
    if (prevSel && !active.some((b) => b.id === prevSel)) {
      delete nextSelected[outletId];
    } else if (!prevSel && active.length === 1) {
      nextSelected[outletId] = active[0].id;
    }
  }

  return {
    permittedBranchesByOutlet: nextBranches,
    selectedBranchByOutlet: nextSelected,
  };
}

export async function restoreWebSession(options?: {
  fetchFn?: FetchLike;
  storage?: StorageLike | null;
  inMemoryToken?: string;
}): Promise<SessionRestoreResult> {
  const fetchFn: FetchLike = options?.fetchFn || fetch;
  const storage = options?.storage === undefined ? getDefaultStorage() : options.storage;
  const cached = loadWorkspaceSnapshot(storage);

  const headers: Record<string, string> = {
    'X-Requested-With': 'SMAV-Web',
  };
  if (options?.inMemoryToken) {
    headers.Authorization = `Bearer ${options.inMemoryToken}`;
  }

  try {
    const res = await fetchFn('/api/auth/session', {
      method: 'GET',
      credentials: 'include',
      headers,
    });

    const data = await res.json().catch(() => null);

    if (res.ok && data?.success && data?.session) {
      const serverSession: UserSession = {
        ...data.session,
        token: data.token || data.session.token || options?.inMemoryToken || '',
        displayRole: getVisibleRole(data.session.displayRole || data.session.role),
      };

      const { permittedBranchesByOutlet, selectedBranchByOutlet } = mergeBranchState(
        cached?.permittedBranchesByOutlet || {},
        cached?.selectedBranchByOutlet || {},
        serverSession.activeOutlet.id,
        Array.isArray(data.permittedBranches) ? data.permittedBranches : undefined
      );

      const activeTab = sanitizeTabForRole(cached?.activeTab, serverSession.role);
      saveWorkspaceSnapshot(
        {
          session: serverSession,
          activeTab,
          permittedBranchesByOutlet,
          selectedBranchByOutlet,
          lastValidatedAt: Date.now(),
        },
        storage
      );

      return {
        status: 'authenticated',
        session: serverSession,
        activeTab,
        permittedBranchesByOutlet,
        selectedBranchByOutlet,
        isOffline: false,
      };
    }

    if (isConfirmedSessionInvalidation(res.status, data?.code)) {
      clearWorkspaceSnapshot(storage);
      return {
        status: 'unauthenticated',
        reasonCode: data?.code,
        message:
          data?.code === 'SESSION_MISSING'
            ? undefined
            : data?.message || 'Your session has expired. Please sign in again.',
      };
    }

    // Transient server error (5xx / gateway timeout / unexpected non-401 failure): retain cached session!
    if (cached) {
      return {
        status: 'offline_retained',
        session: buildOfflineSessionFromSnapshot(cached, options?.inMemoryToken || ''),
        activeTab: sanitizeTabForRole(cached.activeTab, cached.role),
        permittedBranchesByOutlet: cached.permittedBranchesByOutlet || {},
        selectedBranchByOutlet: cached.selectedBranchByOutlet || {},
        isOffline: true,
        offlineMessage:
          'SMAV server is temporarily unreachable. Your session is retained — click Retry to reconnect.',
      };
    }

    return { status: 'unauthenticated' };
  } catch {
    // Network unreachable: retain cached valid workspace and show offline/retry banner
    if (cached) {
      return {
        status: 'offline_retained',
        session: buildOfflineSessionFromSnapshot(cached, options?.inMemoryToken || ''),
        activeTab: sanitizeTabForRole(cached.activeTab, cached.role),
        permittedBranchesByOutlet: cached.permittedBranchesByOutlet || {},
        selectedBranchByOutlet: cached.selectedBranchByOutlet || {},
        isOffline: true,
        offlineMessage:
          'Connection temporarily unavailable. Your session is retained — click Retry to reconnect.',
      };
    }
    return { status: 'unauthenticated' };
  }
}

export async function revalidateActiveWebSession(
  currentSession: UserSession,
  options?: {
    fetchFn?: FetchLike;
    storage?: StorageLike | null;
    activeTab?: WebWorkspaceTab;
    permittedBranchesByOutlet?: Record<string, OutletBranchOption[]>;
    selectedBranchByOutlet?: Record<string, string>;
  }
): Promise<SessionRevalidationResult> {
  const fetchFn: FetchLike = options?.fetchFn || fetch;
  const storage = options?.storage === undefined ? getDefaultStorage() : options.storage;

  const headers: Record<string, string> = {
    'X-Requested-With': 'SMAV-Web',
  };
  if (currentSession.token) {
    headers.Authorization = `Bearer ${currentSession.token}`;
  }

  try {
    let res = await fetchFn('/api/auth/session', {
      method: 'GET',
      credentials: 'include',
      headers,
    });
    let data = await res.json().catch(() => null);

    // Before declaring an active session expired, try explicit server-side refresh once
    if (res.status === 401 && data?.code === 'SESSION_EXPIRED') {
      const refreshRes = await fetchFn('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers,
      });
      const refreshData = await refreshRes.json().catch(() => null);
      res = refreshRes;
      data = refreshData;
    }

    if (res.ok && data?.success && data?.session) {
      const updatedSession: UserSession = {
        ...data.session,
        token: data.token || data.session.token || currentSession.token,
        displayRole: getVisibleRole(data.session.displayRole || data.session.role),
      };

      const { permittedBranchesByOutlet, selectedBranchByOutlet } = mergeBranchState(
        options?.permittedBranchesByOutlet || {},
        options?.selectedBranchByOutlet || {},
        updatedSession.activeOutlet.id,
        Array.isArray(data.permittedBranches) ? data.permittedBranches : undefined
      );

      saveWorkspaceSnapshot(
        {
          session: updatedSession,
          activeTab: sanitizeTabForRole(options?.activeTab, updatedSession.role),
          permittedBranchesByOutlet,
          selectedBranchByOutlet,
          lastValidatedAt: Date.now(),
        },
        storage
      );

      return {
        status: 'valid',
        session: updatedSession,
        permittedBranches: Array.isArray(data.permittedBranches) ? data.permittedBranches : undefined,
        isOffline: false,
      };
    }

    if (isConfirmedSessionInvalidation(res.status, data?.code)) {
      clearWorkspaceSnapshot(storage);
      return {
        status: 'invalidated',
        reasonCode: data?.code || 'SESSION_INVALIDATED',
        message: data?.message || 'Your session has expired or your account was disabled. Please sign in again.',
      };
    }

    // Any 5xx / transient error retains the active session
    return {
      status: 'offline_retained',
      offlineMessage: 'SMAV server is temporarily unreachable. Your session is retained — click Retry to reconnect.',
    };
  } catch {
    return {
      status: 'offline_retained',
      offlineMessage: 'Connection temporarily unavailable. Your session is retained — click Retry to reconnect.',
    };
  }
}

export async function signOutWebSession(
  currentSession: UserSession | null,
  options?: {
    fetchFn?: FetchLike;
    storage?: StorageLike | null;
  }
): Promise<void> {
  const fetchFn: FetchLike = options?.fetchFn || fetch;
  const storage = options?.storage === undefined ? getDefaultStorage() : options.storage;

  const headers: Record<string, string> = {
    'X-Requested-With': 'SMAV-Web',
  };
  if (currentSession?.token) {
    headers.Authorization = `Bearer ${currentSession.token}`;
  }

  try {
    await fetchFn('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers,
    });
  } catch {
    // Always clear local workspace on explicit Sign Out even if server is unreachable
  } finally {
    clearWorkspaceSnapshot(storage);
  }
}
