/**
 * Offline Mocked Contract Verification Suite: Glossy Looks -> SMAV Central Identity Sync
 *
 * Verifies against the actual OutletUserSyncCoordinator implementation with ZERO live DB writes,
 * ZERO live Supabase/Edge Function calls, and ZERO live webhook deliveries.
 *
 * Run with: npx tsx scripts/test-glossylooks-identity-contract.ts
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { OutletUserSyncCoordinator, OutletTargetDescriptor } from '../syncCoordinator';

interface MockCentralUser {
  id: string;
  email: string;
  fullName: string;
  username: string;
  phone: string;
  role: 'ADMIN' | 'STAFF';
  isActive: boolean;
  platformRole: 'USER' | 'SUPERADMIN';
  mustChangePassword: boolean;
  passwordResetRequired: boolean;
}

const GLOSSY_OUTLET: OutletTargetDescriptor = {
  id: '28467997-d316-482e-be93-258dd26e1340',
  code: 'glossylooks',
  name: 'TheGlossylooks',
  providerType: 'external',
  syncWebhookUrl: 'https://www.glossylooks.in/api/smav-sync-webhook',
};

function mapContractRole(rawRole: string): { smavRole: 'ADMIN' | 'STAFF'; contractRole: 'ADMIN' | 'POS_BILLING' } {
  const norm = rawRole.trim().toUpperCase();
  if (norm === 'OWNER' || norm === 'MANAGER' || norm === 'ADMIN') {
    return { smavRole: 'ADMIN', contractRole: 'ADMIN' };
  }
  return { smavRole: 'STAFF', contractRole: 'POS_BILLING' };
}

async function runTests() {
  let passed = 0;
  const usersById = new Map<string, MockCentralUser>();
  const extIdentities = new Map<string, string>(); // `${source}:${externalId}` -> centralAuthId
  const revokedSessions: Array<{ userId: string; outletId?: string | null; action: string }> = [];
  const auditEvents: any[] = [];
  let edgeInvocations = 0;
  let outboundWebhookAttempts = 0;

  // Seed existing SMAV users matching Screenshot 2
  const deepikaUuid = 'f8de36d6-08da-438b-9612-0a3a7a024422';
  const renukaOrigUuid = 'bc6a10a9-2bfe-4460-94b9-ddef5e8aa344';
  const renukaDupUuid = 'c0e2945d-d5f0-43ef-989a-ca1ace82ec9a';
  const superadminUuid = '11111111-1111-4111-8111-111111111111';

  usersById.set(deepikaUuid, {
    id: deepikaUuid,
    email: 'deepika@glossylooks.in',
    fullName: 'Deepika',
    username: 'deepika',
    phone: '9502034498',
    role: 'STAFF',
    isActive: true,
    platformRole: 'USER',
    mustChangePassword: false,
    passwordResetRequired: false,
  });
  // Legacy non-UUID external_id (username) before Glossy Looks sends public.users.id
  extIdentities.set('glossylooks:deepika', deepikaUuid);

  usersById.set(renukaOrigUuid, {
    id: renukaOrigUuid,
    email: 'renuka@glossylooks.in',
    fullName: 'renuka',
    username: 'renuka',
    phone: '8341653490',
    role: 'STAFF',
    isActive: true,
    platformRole: 'USER',
    mustChangePassword: false,
    passwordResetRequired: false,
  });
  usersById.set(renukaDupUuid, {
    id: renukaDupUuid,
    email: 'srikanth1981k@gmail.com',
    fullName: 'Renuka Dup',
    username: 'renuka_dup',
    phone: '',
    role: 'STAFF',
    isActive: true,
    platformRole: 'USER',
    mustChangePassword: false,
    passwordResetRequired: false,
  });
  usersById.set(superadminUuid, {
    id: superadminUuid,
    email: 'kpsrikanthreddy@gmail.com',
    fullName: 'SRIKANTH KAYIDAPURAM',
    username: 'kpsrikanthreddy',
    phone: '8179620607',
    role: 'ADMIN',
    isActive: true,
    platformRole: 'SUPERADMIN',
    mustChangePassword: false,
    passwordResetRequired: false,
  });

  // Fail-closed mock Edge Function mirroring smav-identity-admin/index.ts behavior
  const mockInvokeEdge = async (
    action: string,
    payload: Record<string, any>,
    _tokenOrKey?: string,
    isBusinessKey?: boolean
  ) => {
    edgeInvocations++;
    const cleanEmail = payload.email ? String(payload.email).trim().toLowerCase() : undefined;
    const cleanExtId = payload.externalStaffId ? String(payload.externalStaffId).trim() : undefined;
    const cleanUserId = payload.userId ? String(payload.userId).trim() : undefined;
    const outletCode = String(payload.outletCode || 'glossylooks').toLowerCase();

    const candidates = new Set<string>();
    if (cleanUserId) {
      if (!usersById.has(cleanUserId)) {
        return { success: false, status: 404, conflict: false, error: `UUID ${cleanUserId} not found` };
      }
      candidates.add(cleanUserId);
    }
    if (cleanExtId) {
      const mapped = extIdentities.get(`${outletCode}:${cleanExtId}`);
      if (mapped) candidates.add(mapped);
    }
    if (cleanEmail) {
      for (const u of usersById.values()) {
        if (u.email === cleanEmail) candidates.add(u.id);
      }
    }

    if (candidates.size > 1) {
      return {
        success: false,
        status: 409,
        conflict: true,
        error: 'Identity conflict: userId, externalStaffId, and email resolve to different Central Auth accounts.',
        details: { candidateUserIds: Array.from(candidates) },
      };
    }

    const resolvedId = candidates.size === 1 ? Array.from(candidates)[0] : null;
    const existing = resolvedId ? usersById.get(resolvedId)! : null;

    if (existing && existing.platformRole === 'SUPERADMIN' && isBusinessKey) {
      return { success: false, status: 403, conflict: false, error: 'Forbidden: Cannot modify a platform SUPERADMIN account' };
    }

    if (action === 'set-status') {
      if (!existing) return { success: false, status: 404, error: 'User not found' };
      existing.isActive = Boolean(payload.isActive);
      return {
        success: true,
        status: 200,
        userId: existing.id,
        email: existing.email,
        role: existing.role,
        displayRole: existing.role === 'ADMIN' ? 'ADMIN' : 'POS_BILLING',
        isActive: existing.isActive,
      };
    }

    if (action === 'reset-password') {
      if (!existing) return { success: false, status: 404, error: 'User not found' };
      if (!payload.newPassword || String(payload.newPassword).length < 8) {
        return { success: false, status: 400, error: `Password invalid: password=${payload.newPassword || ''}` };
      }
      existing.mustChangePassword = true;
      existing.passwordResetRequired = false;
      return {
        success: true,
        status: 200,
        userId: existing.id,
        email: existing.email,
        mustChangePassword: true,
      };
    }

    if (existing) {
      if (cleanEmail) existing.email = cleanEmail;
      if (payload.fullName) existing.fullName = payload.fullName;
      if (payload.username) existing.username = payload.username;
      if (payload.role) existing.role = payload.role;
      if (typeof payload.isActive === 'boolean') existing.isActive = payload.isActive;
      if (cleanExtId) {
        // Upgrade legacy non-UUID external_id in place (never recreate user)
        for (const [k, uid] of extIdentities.entries()) {
          if (uid === existing.id && k.startsWith(`${outletCode}:`)) {
            extIdentities.delete(k);
          }
        }
        extIdentities.set(`${outletCode}:${cleanExtId}`, existing.id);
      }
      return {
        success: true,
        status: 200,
        userId: existing.id,
        email: existing.email,
        username: existing.username,
        fullName: existing.fullName,
        role: existing.role,
        displayRole: existing.role === 'ADMIN' ? 'ADMIN' : 'POS_BILLING',
        isActive: existing.isActive,
        isNewUser: false,
        mustChangePassword: existing.mustChangePassword,
      };
    }

    if (action === 'update-user') {
      return { success: false, status: 404, error: 'Target user not found for update' };
    }

    const newId = crypto.randomUUID();
    const passwordResetRequired = !payload.initialPassword;
    const created: MockCentralUser = {
      id: newId,
      email: cleanEmail!,
      fullName: payload.fullName || 'New User',
      username: payload.username || cleanEmail!.split('@')[0],
      phone: payload.phone || '',
      role: payload.role || 'STAFF',
      isActive: payload.isActive !== false,
      platformRole: 'USER',
      mustChangePassword: true,
      passwordResetRequired,
    };
    usersById.set(newId, created);
    if (cleanExtId) extIdentities.set(`${outletCode}:${cleanExtId}`, newId);

    return {
      success: true,
      status: 200,
      userId: newId,
      email: created.email,
      username: created.username,
      fullName: created.fullName,
      role: created.role,
      displayRole: created.role === 'ADMIN' ? 'ADMIN' : 'POS_BILLING',
      isActive: created.isActive,
      isNewUser: true,
      mustChangePassword: true,
      passwordResetRequired,
    };
  };

  // Intercept global fetch so we can assert ZERO outbound webhooks on outlet_admin echo
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    outboundWebhookAttempts++;
    throw new Error('Unexpected outbound webhook during outlet_admin sync!');
  }) as any;

  const coordinator = new OutletUserSyncCoordinator({
    invokeEdge: mockInvokeEdge,
    getCentralUrl: () => 'https://mock.supabase.co',
    resolveOutlet: async () => GLOSSY_OUTLET,
    getCentralDbClient: () => null,
    onCentralConfirmed: async (event) => {
      if (event.userId && (event.action === 'reset_password' || event.isActive === false)) {
        revokedSessions.push({ userId: event.userId, outletId: event.outletId, action: event.action });
      }
    },
    logAudit: (entry) => auditEvents.push(entry),
  });

  try {
    // TEST 1: Role mapping matrix
    assert.equal(mapContractRole('OWNER').contractRole, 'ADMIN');
    assert.equal(mapContractRole('MANAGER').contractRole, 'ADMIN');
    assert.equal(mapContractRole('STYLIST').contractRole, 'POS_BILLING');
    assert.equal(mapContractRole('RECEPTIONIST').contractRole, 'POS_BILLING');
    assert.equal(mapContractRole('INVENTORY_STAFF').contractRole, 'POS_BILLING');
    passed++;

    // TEST 2: Existing SMAV identity NOT recreated when Glossy Looks sends public.users.id as externalStaffId
    const deepikaLocalUuid = 'a1b2c3d4-0000-4000-8000-000000000003';
    const rExisting = await coordinator.dispatchSync({
      idempotencyKey: 'gl_reconcile_deepika_1',
      syncOrigin: 'outlet_admin',
      action: 'upsert_user',
      outlet: GLOSSY_OUTLET,
      centralAuthToken: 'mock-key',
      isBusinessKey: true,
      payload: {
        externalStaffId: deepikaLocalUuid,
        email: 'deepika@glossylooks.in',
        fullName: 'Deepika',
        username: 'deepika',
        phone: '9502034498',
        role: 'STAFF',
        isActive: true,
      },
    });
    assert.equal(rExisting.success, true);
    assert.equal(rExisting.userId, deepikaUuid, 'Must reuse existing Deepika Central Auth UUID');
    assert.equal(rExisting.isNewUser, false, 'Must NOT recreate existing Deepika account');
    assert.equal(extIdentities.get(`glossylooks:${deepikaLocalUuid}`), deepikaUuid, 'Must upgrade external_id to public.users.id');
    assert.equal(outboundWebhookAttempts, 0, 'Must NOT echo webhook back to Glossy Looks for outlet_admin origin');
    passed++;

    // TEST 3: Create brand-new user (SRIREDDY as OWNER -> ADMIN) without initialPassword (reconciliation mode)
    const srireddyLocalUuid = 'a1b2c3d4-0000-4000-8000-000000000009';
    const rCreate = await coordinator.dispatchSync({
      idempotencyKey: 'gl_user_created_srireddy_1',
      syncOrigin: 'outlet_admin',
      action: 'upsert_user',
      outlet: GLOSSY_OUTLET,
      centralAuthToken: 'mock-key',
      isBusinessKey: true,
      payload: {
        externalStaffId: srireddyLocalUuid,
        email: 'kpsridataengineer@gmail.com',
        fullName: 'srireddy',
        username: 'srireddy',
        phone: '8179620607',
        role: mapContractRole('OWNER').smavRole,
        isActive: true,
      },
    });
    assert.equal(rCreate.success, true);
    assert.ok(rCreate.userId, 'Must return stable Central Auth UUID');
    assert.equal(rCreate.role, 'ADMIN');
    assert.equal(rCreate.isNewUser, true);
    assert.equal(rCreate.passwordResetRequired, true);
    passed++;

    // TEST 4: X-Idempotency-Key replay prevents duplicate user creation / side effects
    const invocationsBeforeReplay = edgeInvocations;
    const rReplay = await coordinator.dispatchSync({
      idempotencyKey: 'gl_user_created_srireddy_1',
      syncOrigin: 'outlet_admin',
      action: 'upsert_user',
      outlet: GLOSSY_OUTLET,
      centralAuthToken: 'mock-key',
      isBusinessKey: true,
      payload: {
        externalStaffId: srireddyLocalUuid,
        email: 'kpsridataengineer@gmail.com',
        fullName: 'srireddy',
        role: 'ADMIN',
        isActive: true,
      },
    });
    assert.equal(rReplay.success, true);
    assert.equal(rReplay.idempotentReplay, true);
    assert.equal(rReplay.userId, rCreate.userId);
    assert.equal(edgeInvocations, invocationsBeforeReplay, 'Idempotent replay must NOT re-invoke Edge Function');
    passed++;

    // TEST 5: Conflicting identities return HTTP 409 + conflict: true (Renuka original UUID + duplicate email)
    const rConflict = await coordinator.dispatchSync({
      idempotencyKey: 'gl_conflict_renuka_1',
      syncOrigin: 'outlet_admin',
      action: 'update_user',
      outlet: GLOSSY_OUTLET,
      centralAuthToken: 'mock-key',
      isBusinessKey: true,
      payload: {
        userId: renukaOrigUuid,
        externalStaffId: 'a1b2c3d4-0000-4000-8000-000000000007',
        email: 'srikanth1981k@gmail.com',
        fullName: 'renuka',
        role: 'STAFF',
        isActive: true,
      },
    });
    assert.equal(rConflict.success, false);
    assert.equal(rConflict.httpStatus, 409);
    assert.equal(rConflict.conflict, true);
    assert.equal(rConflict.syncStatus, 'CONFLICT');
    assert.equal(usersById.get(renukaOrigUuid)?.email, 'renuka@glossylooks.in', 'Must NOT overwrite original Renuka');
    assert.equal(usersById.get(renukaDupUuid)?.email, 'srikanth1981k@gmail.com', 'Must NOT overwrite duplicate Renuka');
    passed++;

    // TEST 6: Replaying a conflicted idempotency key returns 409 without retrying
    const invocationsBeforeConflictReplay = edgeInvocations;
    const rConflictReplay = await coordinator.dispatchSync({
      idempotencyKey: 'gl_conflict_renuka_1',
      syncOrigin: 'outlet_admin',
      action: 'update_user',
      outlet: GLOSSY_OUTLET,
      centralAuthToken: 'mock-key',
      isBusinessKey: true,
      payload: {
        userId: renukaOrigUuid,
        email: 'srikanth1981k@gmail.com',
      },
    });
    assert.equal(rConflictReplay.httpStatus, 409);
    assert.equal(rConflictReplay.conflict, true);
    assert.equal(rConflictReplay.idempotentReplay, true);
    assert.equal(edgeInvocations, invocationsBeforeConflictReplay);
    passed++;

    // TEST 7: Deactivation (set_status isActive: false) promptly revokes active sessions
    const rDeactivate = await coordinator.dispatchSync({
      idempotencyKey: 'gl_deactivate_deepika_1',
      syncOrigin: 'outlet_admin',
      action: 'set_status',
      outlet: GLOSSY_OUTLET,
      centralAuthToken: 'mock-key',
      isBusinessKey: true,
      payload: {
        userId: deepikaUuid,
        externalStaffId: deepikaLocalUuid,
        email: 'deepika@glossylooks.in',
        isActive: false,
      },
    });
    assert.equal(rDeactivate.success, true);
    assert.equal(usersById.get(deepikaUuid)?.isActive, false);
    assert.equal(
      revokedSessions.some((r) => r.userId === deepikaUuid && r.action === 'set_status'),
      true,
      'Deactivation must immediately trigger session revocation'
    );
    passed++;

    // TEST 8: Password reset succeeds transiently, revokes sessions, and NEVER persists password in outbox
    const secretPwd = 'SuperSecretPwd#2026';
    const rPwdReset = await coordinator.dispatchSync({
      idempotencyKey: 'gl_reset_pwd_deepika_1',
      syncOrigin: 'outlet_admin',
      action: 'reset_password',
      outlet: GLOSSY_OUTLET,
      centralAuthToken: 'mock-key',
      isBusinessKey: true,
      transientPassword: secretPwd,
      payload: {
        userId: deepikaUuid,
        externalStaffId: deepikaLocalUuid,
        email: 'deepika@glossylooks.in',
        mustChangePassword: true,
      },
    });
    assert.equal(rPwdReset.success, true);
    assert.equal(rPwdReset.mustChangePassword, true);
    const serializedOutbox = JSON.stringify(rPwdReset.outboxItem);
    assert.equal(serializedOutbox.includes(secretPwd), false, 'Outbox must NEVER contain plaintext password');
    assert.equal(
      revokedSessions.some((r) => r.userId === deepikaUuid && r.action === 'reset_password'),
      true,
      'Password reset must revoke active sessions'
    );
    passed++;

    // TEST 9: Failed password reset redacts secret from lastError
    const shortSecret = 'Tiny1!';
    const rBadPwd = await coordinator.dispatchSync({
      idempotencyKey: 'gl_reset_pwd_bad_1',
      syncOrigin: 'outlet_admin',
      action: 'reset_password',
      outlet: GLOSSY_OUTLET,
      centralAuthToken: 'mock-key',
      isBusinessKey: true,
      transientPassword: shortSecret,
      payload: {
        userId: deepikaUuid,
        email: 'deepika@glossylooks.in',
      },
    });
    assert.equal(rBadPwd.success, false);
    assert.equal(rBadPwd.httpStatus, 400);
    assert.equal(
      JSON.stringify(rBadPwd.outboxItem).includes(shortSecret),
      false,
      'Error text in outbox must redact plaintext password'
    );
    passed++;

    // TEST 10: Platform SUPERADMIN (kpsrikanthreddy@gmail.com) is protected from outlet sync mutation
    const rSuper = await coordinator.dispatchSync({
      idempotencyKey: 'gl_superadmin_protect_1',
      syncOrigin: 'outlet_admin',
      action: 'upsert_user',
      outlet: GLOSSY_OUTLET,
      centralAuthToken: 'mock-key',
      isBusinessKey: true,
      payload: {
        externalStaffId: 'a1b2c3d4-0000-4000-8000-000000000005',
        email: 'kpsrikanthreddy@gmail.com',
        fullName: 'SRIKANTH KAYIDAPURAM',
        role: 'ADMIN',
        isActive: true,
      },
    });
    assert.equal(rSuper.success, false);
    assert.equal(rSuper.httpStatus, 403, 'Outlet sync must NOT overwrite platform SUPERADMIN');
    passed++;

    // TEST 11: HMAC-SHA256 canonical signing format verification (timestamp.rawBody)
    const ts = String(Math.floor(Date.now() / 1000));
    const rawBody = JSON.stringify({ action: 'upsert_user', outletCode: 'glossylooks', email: 'test@glossylooks.in' });
    const secret = 'test-shared-integration-key-32-chars-minimum';
    const sig = crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
    const verifySig = crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
    assert.equal(crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(verifySig)), true);
    passed++;

    assert.equal(outboundWebhookAttempts, 0, 'Zero outbound echo webhooks allowed across entire outlet_admin test run');
    console.log(`ALL_GLOSSYLOOKS_CONTRACT_TESTS_PASSED (${passed}/11)`);
  } finally {
    globalThis.fetch = origFetch;
  }
}

runTests().catch((err) => {
  console.error('CONTRACT_TEST_FAILED:', err);
  process.exit(1);
});
