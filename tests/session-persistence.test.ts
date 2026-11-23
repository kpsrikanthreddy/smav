import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  SessionRevocationStore,
  buildClearSessionCookieHeader,
  buildSessionCookieHeader,
  extractRequestSessionToken,
  generateSessionId,
  refreshSupabaseSessionIfNeeded,
  sanitizeSessionForClient,
  sealSessionPayload,
  unsealSessionPayload,
  verifyCookieMutationCsrf,
  type SealedSessionPayload,
} from '../services/sessionPersistence.ts';
import {
  WEB_WORKSPACE_STORAGE_KEY,
  clearWorkspaceSnapshot,
  isConfirmedSessionInvalidation,
  loadWorkspaceSnapshot,
  restoreWebSession,
  revalidateActiveWebSession,
  saveWorkspaceSnapshot,
  signOutWebSession,
  type StorageLike,
} from '../src/lib/sessionPersistence.ts';
import type { OutletBranchOption, UserSession } from '../src/types.ts';

function createMemoryStorage(): StorageLike & { dump(): Record<string, string> } {
  const map = new Map<string, string>();
  return {
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
    removeItem(key: string) {
      map.delete(key);
    },
    dump() {
      return Object.fromEntries(map.entries());
    },
  };
}

function makeFakeResponse(status: number, body: any): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeSampleBranches(): OutletBranchOption[] {
  return [
    {
      id: 'tgl-gachi',
      name: 'Gachibowli',
      outletId: 'outlet-tgl',
      outletCode: 'glossylooks',
      branchCode: 'GACHI',
      branchName: 'Gachibowli',
      billPrefix: 'TGL-GACHI',
      isActive: true,
    },
    {
      id: 'tgl-konda',
      name: 'Kondapur',
      outletId: 'outlet-tgl',
      outletCode: 'glossylooks',
      branchCode: 'KONDA',
      branchName: 'Kondapur',
      billPrefix: 'TGL-KONDA',
      isActive: true,
    },
  ];
}

function makeSampleSession(role: 'superadmin' | 'admin' | 'staff'): UserSession {
  const displayRole = role === 'superadmin' ? 'SUPERADMIN' : role === 'admin' ? 'ADMIN' : 'POS_BILLING';
  return {
    token: 'smav_sess_v2.test_runtime_token',
    sessionId: 'sid_test_123',
    userId: `user-${role}-1`,
    email: `${role}@smav.example`,
    fullName: `Test ${displayRole}`,
    role,
    displayRole,
    activeOutlet: {
      id: role === 'superadmin' ? 'central_smav' : 'outlet-tgl',
      code: role === 'superadmin' ? 'smav' : 'glossylooks',
      name: role === 'superadmin' ? 'SMAV Enterprise Central Headquarters' : 'The Glossy Looks',
      category: role === 'superadmin' ? 'other' : 'salon',
      address: 'Hyderabad',
      phone: '9000000000',
      gstin: '',
      receiptHeader: 'The Glossy Looks',
      receiptFooter: 'Thank you!',
      providerType: role === 'superadmin' ? 'central_smav' : 'supabase_salon',
      isActive: true,
    },
    assignedOutlets: [
      {
        outletId: 'outlet-tgl',
        outletCode: 'glossylooks',
        outletName: 'The Glossy Looks',
        outletCategory: 'salon',
        role,
        displayRole,
        permissions: role === 'superadmin' ? ['*'] : ['pos:bill'],
        isPrimary: true,
      },
    ],
    specificTitle: displayRole,
    permissions: role === 'superadmin' ? ['*'] : ['pos:bill'],
    deviceId: 'SMAV-TEST-01',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    hasSupabaseRefreshSession: true,
    platformRole: displayRole,
  };
}

// -------------------------------------------------------------------------------------------------
// 1. Login -> Server Restart / Refresh -> Still Signed In (SUPERADMIN, ADMIN, POS_BILLING)
// -------------------------------------------------------------------------------------------------
test('sealed session token survives server restart for SUPERADMIN, ADMIN, and POS_BILLING without exposing Supabase tokens', () => {
  const secret = 'test-session-secret-material-32bytes-minimum';
  const roles: Array<{ role: 'superadmin' | 'admin' | 'staff'; displayRole: 'SUPERADMIN' | 'ADMIN' | 'POS_BILLING' }> = [
    { role: 'superadmin', displayRole: 'SUPERADMIN' },
    { role: 'admin', displayRole: 'ADMIN' },
    { role: 'staff', displayRole: 'POS_BILLING' },
  ];

  for (const { role, displayRole } of roles) {
    const sid = generateSessionId();
    const payload: SealedSessionPayload = {
      v: 2,
      sid,
      userId: `uid-${role}`,
      email: `${role}@glossylooks.in`,
      fullName: `User ${displayRole}`,
      role,
      displayRole,
      platformRole: displayRole,
      activeOutlet: {
        id: 'outlet-tgl',
        code: 'glossylooks',
        name: 'The Glossy Looks',
        category: 'salon',
        isActive: true,
      },
      assignedOutlets: [
        {
          outletId: 'outlet-tgl',
          outletCode: 'glossylooks',
          outletName: 'The Glossy Looks',
          outletCategory: 'salon',
          role,
          displayRole,
          isPrimary: true,
        },
      ],
      specificTitle: displayRole,
      permissions: role === 'superadmin' ? ['*'] : ['pos:bill'],
      deviceId: 'SMAV-TEST-DEV',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
      supabaseToken: 'eyJhbGciOiJIUzI1NiJ9.mock_access.sig',
      supabaseRefreshToken: 'rt_mock_refresh_token_secret',
      supabaseExpiresAt: Date.now() + 3600_000,
    };

    const sealed = sealSessionPayload(payload, secret);
    assert.ok(sealed.startsWith('smav_sess_v2.'));
    assert.ok(sealed.length < 3500, 'Sealed cookie token must fit safely inside 4KB browser cookie limit');
    assert.ok(!sealed.includes('rt_mock_refresh_token_secret'), 'Refresh token must be encrypted, never plaintext');

    // Simulate server restart: unseal from token alone with empty in-memory map
    const restored = unsealSessionPayload(sealed, secret);
    assert.ok(restored);
    assert.equal(restored.sid, sid);
    assert.equal(restored.userId, `uid-${role}`);
    assert.equal(restored.role, role);
    assert.equal(restored.displayRole, displayRole);
    assert.equal(restored.activeOutlet.id, 'outlet-tgl');
    assert.equal(restored.supabaseRefreshToken, 'rt_mock_refresh_token_secret');

    // Client-sanitized session MUST strip raw Supabase access & refresh tokens
    const clientSafe = sanitizeSessionForClient(restored);
    assert.equal((clientSafe as any).supabaseToken, undefined);
    assert.equal((clientSafe as any).supabaseRefreshToken, undefined);
    assert.equal(clientSafe.hasSupabaseRefreshSession, true);
  }
});

test('Web login -> browser refresh -> still signed in with role, outlet, permitted branches, selected branch, and ZERO tokens in localStorage', async () => {
  const storage = createMemoryStorage();
  const branches = makeSampleBranches();

  for (const role of ['superadmin', 'admin', 'staff'] as const) {
    const initialSession = makeSampleSession(role);
    const outletId = initialSession.activeOutlet.id;
    const expectedTab = role === 'staff' ? 'pos' : 'primary';

    saveWorkspaceSnapshot(
      {
        session: initialSession,
        activeTab: expectedTab,
        permittedBranchesByOutlet: { [outletId]: branches },
        selectedBranchByOutlet: { [outletId]: 'tgl-konda' },
      },
      storage
    );

    // Security assertion: NO bearer/access/refresh token may ever be stored in localStorage
    const rawStored = storage.getItem(WEB_WORKSPACE_STORAGE_KEY) || '';
    assert.ok(rawStored.length > 0);
    assert.ok(!rawStored.includes(initialSession.token), 'Bearer token must NEVER be written to localStorage');
    assert.ok(!rawStored.includes('supabaseToken'));
    assert.ok(!rawStored.includes('supabaseRefreshToken'));

    // Simulate full browser refresh: React memory is wiped; restoreWebSession calls /api/auth/session with HttpOnly cookie
    let calledWithCredentials: RequestCredentials | undefined;
    const restoreResult = await restoreWebSession({
      storage,
      fetchFn: async (_url, init) => {
        calledWithCredentials = init?.credentials;
        return makeFakeResponse(200, {
          success: true,
          token: 'smav_sess_v2.fresh_rotated_token',
          session: { ...initialSession, token: 'smav_sess_v2.fresh_rotated_token' },
          permittedBranches: branches,
        });
      },
    });

    assert.equal(calledWithCredentials, 'include');
    assert.equal(restoreResult.status, 'authenticated');
    if (restoreResult.status === 'authenticated') {
      assert.equal(restoreResult.session.userId, initialSession.userId);
      assert.equal(restoreResult.session.displayRole, initialSession.displayRole);
      assert.equal(restoreResult.session.activeOutlet.id, outletId);
      assert.equal(restoreResult.activeTab, expectedTab);
      assert.equal(restoreResult.permittedBranchesByOutlet[outletId]?.length, 2);
      assert.equal(restoreResult.selectedBranchByOutlet[outletId], 'tgl-konda');
      assert.equal(restoreResult.isOffline, false);
    }
  }
});

// -------------------------------------------------------------------------------------------------
// 2. Temporary API / Network Failure -> Still Signed In (Offline / Retry Retained)
// -------------------------------------------------------------------------------------------------
test('temporary network error or 503 during browser refresh or revalidation retains valid session and shows offline banner', async () => {
  const storage = createMemoryStorage();
  const branches = makeSampleBranches();
  const staffSession = makeSampleSession('staff');
  const outletId = staffSession.activeOutlet.id;

  saveWorkspaceSnapshot(
    {
      session: staffSession,
      activeTab: 'pos',
      permittedBranchesByOutlet: { [outletId]: branches },
      selectedBranchByOutlet: { [outletId]: 'tgl-gachi' },
    },
    storage
  );

  // Case A: Network exception (server temporarily unreachable on page refresh)
  const offlineRestore = await restoreWebSession({
    storage,
    fetchFn: async () => {
      throw new TypeError('Failed to fetch');
    },
  });
  assert.equal(offlineRestore.status, 'offline_retained');
  if (offlineRestore.status === 'offline_retained') {
    assert.equal(offlineRestore.session.userId, staffSession.userId);
    assert.equal(offlineRestore.session.displayRole, 'POS_BILLING');
    assert.equal(offlineRestore.selectedBranchByOutlet[outletId], 'tgl-gachi');
    assert.equal(offlineRestore.isOffline, true);
    assert.match(offlineRestore.offlineMessage, /Retry/i);
  }
  assert.ok(loadWorkspaceSnapshot(storage), 'Snapshot must NOT be cleared on network error');

  // Case B: Server returns 503 Service Unavailable during active session revalidation
  const transient503 = await revalidateActiveWebSession(staffSession, {
    storage,
    activeTab: 'pos',
    fetchFn: async () => makeFakeResponse(503, { success: false, message: 'Upstream catalog unavailable' }),
  });
  assert.equal(transient503.status, 'offline_retained');
  assert.ok(loadWorkspaceSnapshot(storage), 'Snapshot must NOT be cleared on 503 error');

  // Case C: Unconfirmed 403 permission error or catalog failure must NEVER clear session
  assert.equal(isConfirmedSessionInvalidation(403, 'NO_ASSIGNED_BRANCH'), false);
  assert.equal(isConfirmedSessionInvalidation(500, 'INTERNAL_ERROR'), false);
  assert.equal(isConfirmedSessionInvalidation(401, 'UPSTREAM_CATALOG_401'), false);

  // Case D: Retry succeeds once server recovers
  const recovered = await revalidateActiveWebSession(staffSession, {
    storage,
    activeTab: 'pos',
    fetchFn: async () =>
      makeFakeResponse(200, {
        success: true,
        token: 'smav_sess_v2.reconnected_token',
        session: { ...staffSession, token: 'smav_sess_v2.reconnected_token' },
        permittedBranches: branches,
      }),
  });
  assert.equal(recovered.status, 'valid');
  if (recovered.status === 'valid') {
    assert.equal(recovered.isOffline, false);
    assert.equal(recovered.session.token, 'smav_sess_v2.reconnected_token');
  }
});

test('Supabase access token auto-refreshes when near expiry and retains session on transient refresh failures', async () => {
  // Near expiry -> refreshes seamlessly
  const refreshed = await refreshSupabaseSessionIfNeeded({
    supabaseToken: 'old_access_jwt',
    supabaseRefreshToken: 'valid_refresh_token',
    supabaseExpiresAt: Date.now() + 60_000, // 1 min left (< 5 min leeway)
    refreshFn: async () => ({
      data: {
        session: {
          access_token: 'new_access_jwt',
          refresh_token: 'rotated_refresh_token',
          expires_at: Math.floor((Date.now() + 3600_000) / 1000),
        },
      },
      error: null,
    }),
  });
  assert.equal(refreshed.status, 'refreshed');
  assert.equal(refreshed.accessToken, 'new_access_jwt');
  assert.equal(refreshed.refreshToken, 'rotated_refresh_token');

  // Transient network outage during refresh -> transient_error (must NOT invalidate session)
  const transient = await refreshSupabaseSessionIfNeeded({
    supabaseToken: 'old_access_jwt',
    supabaseRefreshToken: 'valid_refresh_token',
    supabaseExpiresAt: Date.now() - 10_000,
    refreshFn: async () => {
      throw new Error('fetch failed: ECONNRESET');
    },
  });
  assert.equal(transient.status, 'transient_error');

  // Confirmed revoked/invalid refresh token -> invalid
  const invalid = await refreshSupabaseSessionIfNeeded({
    supabaseToken: 'old_access_jwt',
    supabaseRefreshToken: 'revoked_refresh_token',
    supabaseExpiresAt: Date.now() - 10_000,
    refreshFn: async () => ({
      data: { session: null },
      error: { status: 400, code: 'refresh_token_not_found', message: 'Invalid Refresh Token: Refresh Token Not Found' },
    }),
  });
  assert.equal(invalid.status, 'invalid');
  assert.equal(invalid.code, 'SESSION_EXPIRED');
});

// -------------------------------------------------------------------------------------------------
// 3. Explicit Sign Out -> Session Cleared
// -------------------------------------------------------------------------------------------------
test('explicit Sign Out revokes server session ID and clears Web workspace snapshot', async () => {
  const storage = createMemoryStorage();
  const revocationStore = new SessionRevocationStore();
  const adminSession = makeSampleSession('admin');

  saveWorkspaceSnapshot(
    {
      session: adminSession,
      activeTab: 'primary',
      permittedBranchesByOutlet: { [adminSession.activeOutlet.id]: makeSampleBranches() },
      selectedBranchByOutlet: { [adminSession.activeOutlet.id]: 'tgl-gachi' },
    },
    storage
  );
  assert.ok(loadWorkspaceSnapshot(storage));

  let logoutEndpointCalled = false;
  await signOutWebSession(adminSession, {
    storage,
    fetchFn: async (url, init) => {
      assert.equal(url, '/api/auth/logout');
      assert.equal(init?.method, 'POST');
      assert.equal(init?.credentials, 'include');
      logoutEndpointCalled = true;
      revocationStore.revokeSessionId(adminSession.sessionId!);
      return makeFakeResponse(200, { success: true });
    },
  });

  assert.equal(logoutEndpointCalled, true);
  assert.equal(loadWorkspaceSnapshot(storage), null, 'Explicit Sign Out must clear persisted workspace');
  assert.equal(
    revocationStore.isSessionRevoked(adminSession.sessionId, adminSession.userId, adminSession.createdAt),
    true
  );
});

// -------------------------------------------------------------------------------------------------
// 4. Confirmed Revoked / Expired / Disabled Account -> Session Cleared
// -------------------------------------------------------------------------------------------------
test('confirmed revoked, expired, or disabled session clears persisted workspace and requires re-login', async () => {
  const confirmedCases = [
    { code: 'SESSION_EXPIRED', message: 'Your session has expired. Please sign in again.' },
    { code: 'SESSION_REVOKED', message: 'Your session was signed out or revoked. Please sign in again.' },
    { code: 'ACCOUNT_DISABLED', message: 'Your account has been deactivated. Please contact your administrator.' },
  ] as const;

  for (const tc of confirmedCases) {
    const storage = createMemoryStorage();
    const session = makeSampleSession('staff');
    saveWorkspaceSnapshot({ session, activeTab: 'pos' }, storage);

    const result = await revalidateActiveWebSession(session, {
      storage,
      fetchFn: async (url) => {
        if (url === '/api/auth/refresh') {
          return makeFakeResponse(401, { success: false, code: tc.code, message: tc.message });
        }
        return makeFakeResponse(401, { success: false, code: tc.code, message: tc.message });
      },
    });

    assert.equal(result.status, 'invalidated');
    if (result.status === 'invalidated') {
      assert.equal(result.reasonCode, tc.code);
      assert.equal(result.message, tc.message);
    }
    assert.equal(loadWorkspaceSnapshot(storage), null, `Confirmed ${tc.code} must clear cached workspace`);
  }

  // Verify user-level revocation rejects all pre-revocation sessions
  const revocationStore = new SessionRevocationStore();
  const createdBefore = new Date(Date.now() - 10_000).toISOString();
  const createdAfter = new Date(Date.now() + 10_000).toISOString();
  revocationStore.revokeUserBefore('user-disabled-1', Date.now());
  assert.equal(revocationStore.isSessionRevoked('sid_old', 'user-disabled-1', createdBefore), true);
  assert.equal(revocationStore.isSessionRevoked('sid_new', 'user-disabled-1', createdAfter), false);
});

// -------------------------------------------------------------------------------------------------
// 5. Security Controls: HttpOnly Partitioned Cookie + CSRF Guard
// -------------------------------------------------------------------------------------------------
test('HttpOnly cookie attributes and CSRF guard protect cookie-authenticated mutations', () => {
  const httpsReq = {
    secure: true,
    headers: { 'x-forwarded-proto': 'https', host: 'smav.example.com' },
  };
  const cookieHeader = buildSessionCookieHeader('smav_sess_v2.abc', httpsReq);
  assert.match(cookieHeader, new RegExp(`^${SESSION_COOKIE_NAME}=`));
  assert.match(cookieHeader, /HttpOnly/);
  assert.match(cookieHeader, /Secure/);
  assert.match(cookieHeader, /SameSite=None/);
  assert.match(cookieHeader, /Partitioned/);

  const clearHeader = buildClearSessionCookieHeader(httpsReq);
  assert.match(clearHeader, /Max-Age=0/);
  assert.match(clearHeader, /HttpOnly/);

  // Extract token prefers Bearer over cookie, falls back to cookie
  assert.deepEqual(
    extractRequestSessionToken({
      headers: { cookie: `${SESSION_COOKIE_NAME}=smav_sess_v2.from_cookie` },
    }),
    { token: 'smav_sess_v2.from_cookie', source: 'cookie' }
  );
  assert.deepEqual(
    extractRequestSessionToken({
      headers: {
        authorization: 'Bearer smav_sess_v2.from_bearer',
        cookie: `${SESSION_COOKIE_NAME}=smav_sess_v2.from_cookie`,
      },
    }),
    { token: 'smav_sess_v2.from_bearer', source: 'bearer' }
  );

  // CSRF check blocks cross-origin cookie POST without X-Requested-With
  assert.equal(
    verifyCookieMutationCsrf({
      method: 'POST',
      headers: { host: 'smav.example.com', origin: 'https://evil.example.org' },
    }),
    false
  );
  // Same-origin or explicit X-Requested-With passes
  assert.equal(
    verifyCookieMutationCsrf({
      method: 'POST',
      headers: { host: 'smav.example.com', origin: 'https://smav.example.com' },
    }),
    true
  );
  assert.equal(
    verifyCookieMutationCsrf({
      method: 'POST',
      headers: { host: 'smav.example.com', 'x-requested-with': 'SMAV-Web' },
    }),
    true
  );
  // Cleanup helper smoke test
  const mem = createMemoryStorage();
  clearWorkspaceSnapshot(mem);
});
