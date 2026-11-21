import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  CentralBillNumberCoordinator,
  OutletBranchRecord,
  buildBillNumberReconciliationReport,
  deduplicateActiveOutletBranches,
  formatCentralBillNumber,
  getIndiaDateParts,
  isValidCentralBillNumber,
  normalizeDynamicBranchCode,
  resolveBranchFromMaster,
  resolvePermittedBranchesForUser,
  verifyGlossyLooksServerAuth,
} from '../services/centralBillNumbering';
import {
  OutboundOutboxUnavailableError,
  OutboundSaleEventCoordinator,
  type OutboundSaleEventRecord,
} from '../services/outboundSaleSync';

function createFixtureBranches(outletId: string): OutletBranchRecord[] {
  return [
    {
      id: 'tgl-gachi',
      name: 'Gachibowli',
      outletId,
      branchCode: 'GACHI',
      branchName: 'Gachibowli',
      externalBranchId: 'tgl-gachi',
      billPrefix: 'TGL',
      isActive: true,
    },
    {
      id: 'tgl-konda',
      name: 'Kondapur',
      outletId,
      branchCode: 'KONDA',
      branchName: 'Kondapur',
      externalBranchId: 'tgl-konda',
      billPrefix: 'TGL',
      isActive: true,
    },
  ];
}

async function runTests() {
  const outletId = 'outlet-glossylooks-test';
  const canonicalBranches = createFixtureBranches(outletId);

  // 1. Dynamic branch code normalization & master lookup (zero hardcoded branch allowlists)
  assert.equal(normalizeDynamicBranchCode('GACHI'), 'GACHI');
  assert.equal(normalizeDynamicBranchCode('konda'), 'KONDA');
  assert.equal(normalizeDynamicBranchCode('madha'), 'MADHA');
  assert.equal(normalizeDynamicBranchCode(''), null);
  assert.equal(normalizeDynamicBranchCode('A'), null);
  assert.equal(normalizeDynamicBranchCode(null), null);

  assert.equal(resolveBranchFromMaster(canonicalBranches, { branchId: 'tgl-gachi' })?.id, 'tgl-gachi');
  assert.equal(resolveBranchFromMaster(canonicalBranches, { branchCode: 'KONDA' })?.id, 'tgl-konda');
  assert.equal(resolveBranchFromMaster(canonicalBranches, { branchName: 'Gachibowli' })?.branchCode, 'GACHI');
  assert.equal(resolveBranchFromMaster(canonicalBranches, { branchCode: 'UNKNOWN' }), null);

  // 2. Active branch deduplication: excludes inactive branches and eliminates duplicates by id/code
  {
    const noisyBranches: OutletBranchRecord[] = [
      { id: 'tgl-gachi', name: 'Gachibowli', outletId, branchCode: 'GACHI', branchName: 'Gachibowli', isActive: true },
      { id: 'tgl-gachi', name: 'Gachibowli Dup', outletId, branchCode: 'GACHI', branchName: 'Gachibowli Dup', isActive: true },
      { id: 'legacy-dup', name: 'Gachibowli Legacy', outletId, branchCode: 'GACHI', branchName: 'Gachibowli Legacy', isActive: true },
      { id: 'tgl-konda', name: 'Kondapur', outletId, branchCode: 'KONDA', branchName: 'Kondapur', isActive: true },
      { id: 'tgl-old', name: 'Old Closed Branch', outletId, branchCode: 'OLD01', branchName: 'Old Closed Branch', isActive: false },
    ];
    const deduped = deduplicateActiveOutletBranches(noisyBranches);
    assert.equal(deduped.length, 2, 'Must exclude inactive branches and deduplicate active branches');
    assert.deepEqual(
      deduped.map((b) => ({ id: b.id, name: b.name, branchCode: b.branchCode, isActive: b.isActive })),
      [
        { id: 'tgl-gachi', name: 'Gachibowli', branchCode: 'GACHI', isActive: true },
        { id: 'tgl-konda', name: 'Kondapur', branchCode: 'KONDA', isActive: true },
      ]
    );
  }

  // 3. Branch permission rules: 1-branch auto-select, multi-branch manual select, 0-branch authorization block
  {
    // 3a. One-branch auto-selection
    const oneBranch = resolvePermittedBranchesForUser({
      allOutletBranches: canonicalBranches,
      userRole: 'pos_billing',
      assignedBranchIds: ['tgl-gachi'],
    });
    assert.equal(oneBranch.branches.length, 1);
    assert.equal(oneBranch.autoSelectedBranch?.id, 'tgl-gachi');
    assert.equal(oneBranch.requiresManualSelection, false);
    assert.equal(oneBranch.billingBlocked, false);

    // 3b. Multi-branch required manual selection
    const multiBranchOwner = resolvePermittedBranchesForUser({
      allOutletBranches: canonicalBranches,
      userRole: 'admin',
      assignedBranchIds: [],
    });
    assert.equal(multiBranchOwner.branches.length, 2);
    assert.equal(multiBranchOwner.autoSelectedBranch, null);
    assert.equal(multiBranchOwner.requiresManualSelection, true);
    assert.equal(multiBranchOwner.billingBlocked, false);

    const multiBranchStaff = resolvePermittedBranchesForUser({
      allOutletBranches: canonicalBranches,
      userRole: 'pos_billing',
      assignedBranchIds: ['tgl-gachi', 'tgl-konda'],
    });
    assert.equal(multiBranchStaff.branches.length, 2);
    assert.equal(multiBranchStaff.autoSelectedBranch, null);
    assert.equal(multiBranchStaff.requiresManualSelection, true);
    assert.equal(multiBranchStaff.billingBlocked, false);

    // 3c. Zero-branch authorization block (explicit assignment points only to disabled/unknown branch or no active branches)
    const zeroAssignedStaff = resolvePermittedBranchesForUser({
      allOutletBranches: canonicalBranches,
      userRole: 'pos_billing',
      assignedBranchIds: ['tgl-disabled'],
      hasExplicitAssignments: true,
    });
    assert.equal(zeroAssignedStaff.branches.length, 0);
    assert.equal(zeroAssignedStaff.autoSelectedBranch, null);
    assert.equal(zeroAssignedStaff.billingBlocked, true);
    assert.ok(zeroAssignedStaff.authorizationMessage && zeroAssignedStaff.authorizationMessage.length > 10);

    const zeroActiveOutlet = resolvePermittedBranchesForUser({
      allOutletBranches: canonicalBranches.map((b) => ({ ...b, isActive: false })),
      userRole: 'admin',
    });
    assert.equal(zeroActiveOutlet.branches.length, 0);
    assert.equal(zeroActiveOutlet.billingBlocked, true);
    assert.ok(zeroActiveOutlet.authorizationMessage && zeroActiveOutlet.authorizationMessage.length > 10);
  }

  // 4. Bill number format & India timezone date calculation (including dynamic future branch codes)
  const fixedDateIst = new Date('2026-11-20T09:30:00.000Z'); // 2026-11-20 15:00 IST
  const istParts = getIndiaDateParts(fixedDateIst);
  assert.equal(istParts.dateIso, '2026-11-20');
  assert.equal(istParts.dateCompact, '20261120');

  const rolloverIst = getIndiaDateParts(new Date('2026-11-20T19:00:00.000Z')); // 2026-11-21 00:30 IST
  assert.equal(rolloverIst.dateIso, '2026-11-21');
  assert.equal(rolloverIst.dateCompact, '20261121');

  assert.equal(formatCentralBillNumber('GACHI', '20261120', 1), 'TGL-GACHI-20261120-0001');
  assert.equal(formatCentralBillNumber('MADHA', '20261120', 1), 'TGL-MADHA-20261120-0001');
  assert.equal(isValidCentralBillNumber('TGL-GACHI-20261120-0001'), true);
  assert.equal(isValidCentralBillNumber('TGL-KONDA-20261120-0002'), true);
  assert.equal(isValidCentralBillNumber('TGL-MADHA-20261120-0001'), true);
  assert.equal(isValidCentralBillNumber('GL-2026-0001'), false);

  // 5. Branch-specific central bill numbering for Gachibowli, Kondapur, and a dynamic future branch (Madhapur)
  const coordinator = new CentralBillNumberCoordinator();
  coordinator.registerMemoryBranches(outletId, canonicalBranches);

  await assert.rejects(
    () =>
      coordinator.reserveCentralBillNumber({
        db: null,
        outletId,
        branchCode: '',
        idempotencyKey: 'idem-missing-branch',
        sourceSystem: 'smav_web_pos',
        now: fixedDateIst,
      }),
    /BRANCH_REQUIRED/
  );

  // Concurrent reservations across Web POS, Android Print Agent, and GlossyLooks Admin Portal for tgl-gachi
  const concurrentGachi = await Promise.all([
    coordinator.reserveCentralBillNumber({
      db: null,
      outletId,
      branchId: 'tgl-gachi',
      branchCode: 'GACHI',
      branchName: 'Gachibowli',
      idempotencyKey: 'idem-gachi-1',
      sourceSystem: 'smav_web_pos',
      now: fixedDateIst,
    }),
    coordinator.reserveCentralBillNumber({
      db: null,
      outletId,
      branchId: 'tgl-gachi',
      branchCode: 'GACHI',
      branchName: 'Gachibowli',
      idempotencyKey: 'idem-gachi-2',
      sourceSystem: 'smav_android_agent',
      deviceId: 'android-dev-01',
      now: fixedDateIst,
    }),
    coordinator.reserveCentralBillNumber({
      db: null,
      outletId,
      branchId: 'tgl-gachi',
      branchCode: 'GACHI',
      branchName: 'Gachibowli',
      idempotencyKey: 'idem-gachi-3',
      sourceSystem: 'glossylooks_admin_portal',
      now: fixedDateIst,
    }),
  ]);

  assert.deepEqual(
    concurrentGachi.map((r) => r.centralBillNumber).sort(),
    ['TGL-GACHI-20261120-0001', 'TGL-GACHI-20261120-0002', 'TGL-GACHI-20261120-0003']
  );
  assert.ok(concurrentGachi.every((r) => r.branchId === 'tgl-gachi' && r.branchName === 'Gachibowli'));

  // Independent Kondapur counter
  const konda1 = await coordinator.reserveCentralBillNumber({
    db: null,
    outletId,
    branchId: 'tgl-konda',
    branchCode: 'KONDA',
    branchName: 'Kondapur',
    idempotencyKey: 'idem-konda-1',
    sourceSystem: 'glossylooks_admin_portal',
    now: fixedDateIst,
  });
  assert.equal(konda1.centralBillNumber, 'TGL-KONDA-20261120-0001');
  assert.equal(konda1.branchId, 'tgl-konda');
  assert.equal(konda1.branchCode, 'KONDA');
  assert.equal(konda1.branchName, 'Kondapur');

  // Dynamic future branch (Madhapur) added strictly in branch master data — works with ZERO code changes
  const madhapurBranch: OutletBranchRecord = {
    id: 'tgl-madhapur',
    name: 'Madhapur',
    outletId,
    branchCode: 'MADHA',
    branchName: 'Madhapur',
    externalBranchId: 'tgl-madhapur',
    billPrefix: 'TGL',
    isActive: true,
  };
  coordinator.registerMemoryBranches(outletId, [...canonicalBranches, madhapurBranch]);
  const dynamicBranches = await coordinator.listOutletBranches(null, outletId);
  assert.equal(dynamicBranches.length, 3);
  assert.ok(dynamicBranches.some((b) => b.id === 'tgl-madhapur' && b.branchCode === 'MADHA'));

  const madhapurBill = await coordinator.reserveCentralBillNumber({
    db: null,
    outletId,
    branchId: 'tgl-madhapur',
    branchCode: 'MADHA',
    branchName: 'Madhapur',
    idempotencyKey: 'idem-madhapur-1',
    sourceSystem: 'smav_web_pos',
    now: fixedDateIst,
  });
  assert.equal(madhapurBill.centralBillNumber, 'TGL-MADHA-20261120-0001');
  assert.equal(madhapurBill.branchId, 'tgl-madhapur');
  assert.equal(madhapurBill.branchName, 'Madhapur');

  // Next IST day resets GACHI sequence back to 0001
  const nextDayGachi = await coordinator.reserveCentralBillNumber({
    db: null,
    outletId,
    branchId: 'tgl-gachi',
    branchCode: 'GACHI',
    branchName: 'Gachibowli',
    idempotencyKey: 'idem-gachi-nextday-1',
    sourceSystem: 'smav_web_pos',
    now: new Date('2026-11-20T19:05:00.000Z'), // 2026-11-21 00:35 IST
  });
  assert.equal(nextDayGachi.centralBillNumber, 'TGL-GACHI-20261121-0001');

  // 6. Idempotent retry returns the exact same central bill number without incrementing sequence
  const replay = await coordinator.reserveCentralBillNumber({
    db: null,
    outletId,
    branchId: 'tgl-gachi',
    branchCode: 'GACHI',
    branchName: 'Gachibowli',
    idempotencyKey: 'idem-gachi-1',
    sourceSystem: 'smav_web_pos',
    now: fixedDateIst,
  });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.centralBillId, concurrentGachi[0].centralBillId);
  assert.equal(replay.centralBillNumber, concurrentGachi[0].centralBillNumber);

  // Outlet mismatch on reused idempotency key is rejected
  await assert.rejects(
    () =>
      coordinator.reserveCentralBillNumber({
        db: null,
        outletId: 'other-outlet',
        branchId: 'tgl-gachi',
        branchCode: 'GACHI',
        idempotencyKey: 'idem-gachi-1',
        sourceSystem: 'smav_web_pos',
        now: fixedDateIst,
      }),
    /OUTLET_MISMATCH/
  );

  // 7. Branch-specific offline preallocated batch allocation (including future branch Madhapur) with zero overlap
  const preallocGachi = await coordinator.allocateOfflineRange({
    db: null,
    outletId,
    branchId: 'tgl-gachi',
    branchCode: 'GACHI',
    branchName: 'Gachibowli',
    deviceId: 'android-dev-01',
    count: 3,
    now: fixedDateIst,
  });
  assert.deepEqual(
    preallocGachi.items.map((i) => i.centralBillNumber),
    ['TGL-GACHI-20261120-0004', 'TGL-GACHI-20261120-0005', 'TGL-GACHI-20261120-0006']
  );
  assert.ok(preallocGachi.items.every((i) => i.branchId === 'tgl-gachi'));

  const preallocMadhapur = await coordinator.allocateOfflineRange({
    db: null,
    outletId,
    branchId: 'tgl-madhapur',
    branchCode: 'MADHA',
    branchName: 'Madhapur',
    deviceId: 'android-dev-02',
    count: 2,
    now: fixedDateIst,
  });
  assert.deepEqual(
    preallocMadhapur.items.map((i) => i.centralBillNumber),
    ['TGL-MADHA-20261120-0002', 'TGL-MADHA-20261120-0003']
  );
  assert.ok(preallocMadhapur.items.every((i) => i.branchId === 'tgl-madhapur'));

  const gachiAfterRange = await coordinator.reserveCentralBillNumber({
    db: null,
    outletId,
    branchId: 'tgl-gachi',
    branchCode: 'GACHI',
    branchName: 'Gachibowli',
    idempotencyKey: 'idem-gachi-after-range',
    sourceSystem: 'smav_web_pos',
    now: fixedDateIst,
  });
  assert.equal(gachiAfterRange.centralBillNumber, 'TGL-GACHI-20261120-0007');

  // 8. Finalization & preservation of already finalized bill numbers
  const finalizedOnline = await coordinator.finalizeCentralBillNumber({
    db: null,
    outletId,
    centralBillNumber: concurrentGachi[0].centralBillNumber,
    idempotencyKey: 'idem-gachi-1',
    localBillId: 'bill-local-001',
    externalOrderId: 'gl-ord-001',
    sourceSystem: 'smav_web_pos',
  });
  assert.equal(finalizedOnline.status, 'FINALIZED');
  assert.equal(finalizedOnline.centralBillNumber, concurrentGachi[0].centralBillNumber);
  assert.equal(finalizedOnline.branchId, 'tgl-gachi');

  // Re-finalizing an already finalized bill preserves the exact same bill number & status
  const finalizedReplay = await coordinator.finalizeCentralBillNumber({
    db: null,
    outletId,
    centralBillNumber: concurrentGachi[0].centralBillNumber,
    idempotencyKey: 'idem-gachi-1',
    localBillId: 'bill-local-001',
    sourceSystem: 'smav_web_pos',
  });
  assert.equal(finalizedReplay.status, 'FINALIZED');
  assert.equal(finalizedReplay.centralBillNumber, concurrentGachi[0].centralBillNumber);

  // Preallocated offline bill number finalizes cleanly on reconnect without changing bill number
  const finalizedOffline = await coordinator.finalizeCentralBillNumber({
    db: null,
    outletId,
    centralBillNumber: preallocGachi.items[0].centralBillNumber,
    idempotencyKey: preallocGachi.items[0].idempotencyKey,
    localBillId: 'android-offline-bill-001',
    sourceSystem: 'smav_android_agent',
  });
  assert.equal(finalizedOffline.status, 'FINALIZED');
  assert.equal(finalizedOffline.centralBillNumber, 'TGL-GACHI-20261120-0004');

  // Unreserved bill number cannot be finalized
  await assert.rejects(
    () =>
      coordinator.finalizeCentralBillNumber({
        db: null,
        outletId,
        centralBillNumber: 'TGL-GACHI-20261120-9999',
        sourceSystem: 'smav_android_agent',
      }),
    /CENTRAL_BILL_NOT_FOUND/
  );

  // 9. Reconciliation report: dynamic branch buckets + legacy historical bill preservation
  const report = buildBillNumberReconciliationReport({
    outletId,
    centralNumbers: [
      { id: 'c1', central_bill_number: 'TGL-GACHI-20261120-0001', branch_code: 'GACHI', status: 'FINALIZED' },
      { id: 'c2', central_bill_number: 'TGL-GACHI-20261120-0002', branch_code: 'GACHI', status: 'RESERVED' },
      { id: 'c3', central_bill_number: 'TGL-MADHA-20261120-0001', branch_code: 'MADHA', status: 'PREALLOCATED' },
      { id: 'c4', central_bill_number: 'TGL-KONDA-20261120-0001', branch_code: 'KONDA', status: 'FINALIZED' },
    ],
    salonBills: [
      { id: 'b1', bill_number: 'TGL-GACHI-20261120-0001', central_bill_number: 'TGL-GACHI-20261120-0001', created_at: '2026-11-20T09:30:00Z' },
      { id: 'b-legacy-1', bill_number: 'TGL-20261015-0012', central_bill_number: null, created_at: '2026-10-15T10:00:00Z' },
      { id: 'b-legacy-2', bill_number: 'INV-GL-8841', central_bill_number: null, created_at: '2026-09-01T12:00:00Z' },
      { id: 'b-dup-1', bill_number: 'TGL-KONDA-20261120-0001', central_bill_number: 'TGL-KONDA-20261120-0001', created_at: '2026-11-20T09:31:00Z' },
      { id: 'b-dup-2', bill_number: 'TGL-KONDA-20261120-0001', central_bill_number: null, created_at: '2026-11-20T09:32:00Z' },
      { id: 'b-mismatch', bill_number: 'TGL-GACHI-20261120-0099', central_bill_number: 'TGL-GACHI-20261120-0002', created_at: '2026-11-20T09:33:00Z' },
    ],
  });
  assert.equal(report.totalCentralNumbers, 4);
  assert.equal(report.legacyHistoricalBillsCount, 2);
  assert.equal(report.duplicateBillNumbers.length, 1);
  assert.equal(report.mismatchedBills.length, 1);
  assert.equal(report.byBranch.GACHI.total, 2);
  assert.equal(report.byBranch.KONDA.finalized, 1);
  assert.equal(report.byBranch.MADHA.preallocated, 1);

  // 10. Strict dual-factor GlossyLooks server-to-server auth (X-Integration-Key + SMAV_DISPATCH_SECRET HMAC)
  {
    const integrationKey = 'gl-integration-key-prod-secret';
    const dispatchSecret = 'smav-dispatch-hmac-secret-32-chars-minimum';
    const nowMs = Date.UTC(2026, 10, 20, 10, 0, 0);
    const tsSec = String(Math.floor(nowMs / 1000));

    const getSig = crypto.createHmac('sha256', dispatchSecret).update(`${tsSec}.`).digest('hex');
    assert.equal(
      verifyGlossyLooksServerAuth({
        providedIntegrationKey: integrationKey,
        configuredIntegrationKey: integrationKey,
        configuredDispatchSecret: dispatchSecret,
        providedTimestamp: tsSec,
        providedSignature: getSig,
        rawBody: '',
        nowMs,
      }).ok,
      true
    );

    const postBody = JSON.stringify({ branchId: 'tgl-konda', branchCode: 'KONDA', idempotencyKey: 'GLPOS_1' });
    const postSig = crypto.createHmac('sha256', dispatchSecret).update(`${tsSec}.${postBody}`).digest('hex');
    assert.equal(
      verifyGlossyLooksServerAuth({
        providedIntegrationKey: integrationKey,
        configuredIntegrationKey: integrationKey,
        configuredDispatchSecret: dispatchSecret,
        providedTimestamp: tsSec,
        providedSignature: `sha256=${postSig}`,
        rawBody: postBody,
        nowMs,
      }).ok,
      true
    );

    // Reject missing integration key or mismatched secret
    assert.equal(
      verifyGlossyLooksServerAuth({
        providedIntegrationKey: '',
        configuredIntegrationKey: integrationKey,
        configuredDispatchSecret: dispatchSecret,
        providedTimestamp: tsSec,
        providedSignature: postSig,
        rawBody: postBody,
        nowMs,
      }).ok,
      false
    );
  }

  // 11. Durable-only outbound finalized-sale outbox: rejects when DB/RPC unavailable & sends canonical branch fields when backed by DB
  {
    const prevUrl = process.env.GLOSSYLOOKS_BILL_SYNC_WEBHOOK_URL;
    const prevKey = process.env.GLOSSYLOOKS_INTEGRATION_KEY;
    const prevSecret = process.env.SMAV_DISPATCH_SECRET;
    try {
      process.env.GLOSSYLOOKS_BILL_SYNC_WEBHOOK_URL = 'https://www.glossylooks.in/api/integrations/smav/sale-event';
      process.env.GLOSSYLOOKS_INTEGRATION_KEY = 'gl-outbound-test-key';
      process.env.SMAV_DISPATCH_SECRET = 'smav-outbound-dispatch-secret-at-least-32-chars';

      const outbound = new OutboundSaleEventCoordinator();

      // 11a. Must fail closed with retryable OutboundOutboxUnavailableError when DB is unavailable (no in-memory fallback)
      await assert.rejects(
        () =>
          outbound.enqueueFinalizedSaleEvent({
            db: null,
            outletId,
            outletCode: 'glossylooks',
            idempotencyKey: 'WEB_NO_DB_001',
            centralBillId: '11111111-2222-3333-4444-555555555555',
            centralBillNumber: 'TGL-MADHA-20261120-0001',
            localBillId: 'local-bill-madha-001',
            branchId: 'tgl-madhapur',
            branchCode: 'MADHA',
            branchName: 'Madhapur',
            grandTotal: 1180,
            sourceSystem: 'smav_web_pos',
            items: [{ serviceId: 'svc-1', name: 'Layer Haircut', stylistId: 'sty-1', stylist: 'Renuka', quantity: 1, price: 1000 }],
          }),
        (err: any) => err instanceof OutboundOutboxUnavailableError && err.retryable === true && err.code === 'OUTBOUND_OUTBOX_UNAVAILABLE'
      );

      await assert.rejects(
        () => outbound.dispatchDueOutboundSaleEvents(null),
        (err: any) => err instanceof OutboundOutboxUnavailableError && err.retryable === true
      );

      // 11b. Durable DB mock: persists to smav_outbound_sale_events and dispatches via smav_claim_due_outbound_sale_events
      const fakeRows: OutboundSaleEventRecord[] = [];
      let rpcAvailable = true;
      const mockDb: any = {
        from: (table: string) => {
          assert.equal(table, 'smav_outbound_sale_events');
          return {
            select: () => {
              const filters: Record<string, any> = {};
              const builder: any = {
                eq: (col: string, val: any) => {
                  filters[col] = val;
                  return builder;
                },
                maybeSingle: async () => {
                  const found = fakeRows.find((r: any) =>
                    Object.entries(filters).every(([k, v]) => r[k] === v)
                  );
                  return { data: found ? { id: found.id, status: found.status } : null, error: null };
                },
              };
              return builder;
            },
            upsert: (row: any) => ({
              select: () => ({
                maybeSingle: async () => {
                  const exists = fakeRows.find(
                    (r) =>
                      r.outlet_id === row.outlet_id &&
                      r.event_type === row.event_type &&
                      r.idempotency_key === row.idempotency_key
                  );
                  if (exists) return { data: null, error: null };
                  const nowIso = new Date().toISOString();
                  const fullRow: OutboundSaleEventRecord = {
                    ...row,
                    last_http_status: null,
                    last_error: null,
                    response_summary: null,
                    sent_at: null,
                    delivered_at: null,
                    created_at: nowIso,
                    updated_at: nowIso,
                  };
                  fakeRows.push(fullRow);
                  return { data: { id: fullRow.id, status: fullRow.status }, error: null };
                },
              }),
            }),
            update: (patch: any) => ({
              eq: async (_col: string, id: string) => {
                const target = fakeRows.find((r) => r.id === id);
                if (target) Object.assign(target, patch);
                return { data: target || null, error: null };
              },
            }),
          };
        },
        rpc: async (fnName: string) => {
          assert.equal(fnName, 'smav_claim_due_outbound_sale_events');
          if (!rpcAvailable) {
            return { data: null, error: { code: '42883', message: 'function smav_claim_due_outbound_sale_events does not exist' } };
          }
          const due = fakeRows.filter((r) => r.status === 'pending' || r.status === 'failed');
          due.forEach((r) => {
            r.status = 'processing';
            r.attempts += 1;
          });
          return { data: due, error: null };
        },
      };

      const queued = await outbound.enqueueFinalizedSaleEvent({
        db: mockDb,
        outletId,
        outletCode: 'glossylooks',
        idempotencyKey: 'WEB_MADHA_OUTBOUND_001',
        centralBillId: '11111111-2222-3333-4444-555555555555',
        centralBillNumber: 'TGL-MADHA-20261120-0001',
        localBillId: 'local-bill-madha-001',
        branchId: 'tgl-madhapur',
        branchCode: 'MADHA',
        branchName: 'Madhapur',
        externalOrderId: null,
        customerName: 'Ananya Rao',
        customerPhone: '9876543210',
        cashierName: 'Renuka',
        paymentMode: 'upi',
        paymentStatus: 'paid',
        subtotal: 1000,
        discount: 0,
        taxAmount: 180,
        grandTotal: 1180,
        paidAmount: 1180,
        dueAmount: 0,
        billedAt: '2026-11-20T06:00:00.000Z',
        sourceSystem: 'smav_web_pos',
        items: [{ serviceId: 'svc-1', name: 'Layer Haircut', stylistId: 'sty-1', stylist: 'Renuka', quantity: 1, price: 1000 }],
      });
      assert.equal(queued.status, 'pending');
      assert.equal(queued.storageMode, 'database');

      let capturedBody = '';
      let capturedHeaders: Record<string, string> = {};
      const dispatch = await outbound.dispatchDueOutboundSaleEvents(mockDb, {
        nowMs: Date.now() + 5_000,
        fetchImpl: (async (_url: any, init: any) => {
          capturedHeaders = init.headers;
          capturedBody = init.body;
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }) as any,
      });
      assert.equal(dispatch.delivered, 1);

      const parsed = JSON.parse(capturedBody);
      assert.equal(parsed.branch_id, 'tgl-madhapur');
      assert.equal(parsed.branch_code, 'MADHA');
      assert.equal(parsed.branch_name, 'Madhapur');
      assert.equal(parsed.local_branch_id, 'tgl-madhapur');
      assert.equal(parsed.external_branch_id, 'tgl-madhapur');
      assert.equal(parsed.central_bill_id, '11111111-2222-3333-4444-555555555555');
      assert.equal(parsed.central_bill_number, 'TGL-MADHA-20261120-0001');
      assert.equal(capturedHeaders['X-Integration-Key'], 'gl-outbound-test-key');

      // 11c. If claim RPC is unavailable, must throw retryable OutboundOutboxUnavailableError
      rpcAvailable = false;
      await assert.rejects(
        () => outbound.dispatchDueOutboundSaleEvents(mockDb),
        (err: any) => err instanceof OutboundOutboxUnavailableError && err.retryable === true
      );
    } finally {
      if (prevUrl === undefined) delete process.env.GLOSSYLOOKS_BILL_SYNC_WEBHOOK_URL;
      else process.env.GLOSSYLOOKS_BILL_SYNC_WEBHOOK_URL = prevUrl;
      if (prevKey === undefined) delete process.env.GLOSSYLOOKS_INTEGRATION_KEY;
      else process.env.GLOSSYLOOKS_INTEGRATION_KEY = prevKey;
      if (prevSecret === undefined) delete process.env.SMAV_DISPATCH_SECRET;
      else process.env.SMAV_DISPATCH_SECRET = prevSecret;
    }
  }

  // 12. Static SQL migration validation: Migration 022 allow-list & safety guarantees
  {
    const sql022 = fs.readFileSync(
      path.resolve(process.cwd(), 'database/migrations/022_branch_standardization_and_dynamic_references.sql'),
      'utf8'
    );
    const executableSql022 = sql022
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');

    assert.ok(sql022.includes("'tgl-gachi'"), 'Migration 022 must standardize Gachibowli to tgl-gachi');
    assert.ok(sql022.includes("'tgl-konda'"), 'Migration 022 must standardize Kondapur to tgl-konda');
    assert.ok(sql022.includes('tgl-gachibowli-main'), 'Migration 022 must migrate legacy tgl-gachibowli-main references');
    assert.ok(sql022.includes('brn-1793346038689'), 'Migration 022 must migrate legacy brn-1793346038689 references');
    assert.ok(sql022.includes('tgl-kondapur-main'), 'Migration 022 must migrate legacy tgl-kondapur-main references');
    assert.ok(sql022.includes('smav_branch_migration_audit'), 'Migration 022 must record migration audit entries');
    assert.ok(sql022.includes('deactivated_migrated_legacy_branch'), 'Migration 022 must deactivate & audit legacy branches');
    assert.ok(sql022.includes('UNREVIEWED_BRANCH_FK'), 'Migration 022 must fail closed on unreviewed FKs');
    assert.ok(sql022.includes('AMBIGUOUS_GLOSSYLOOKS_OUTLET'), 'Migration 022 must assert single GlossyLooks outlet');
    assert.ok(sql022.includes('pg_get_constraintdef'), 'Migration 022 must preserve exact original FK definitions');
    assert.ok(sql022.includes('smav_user_branch_assignments'), 'Migration 022 must create smav_user_branch_assignments');
    assert.ok(sql022.includes('uq_smav_branches_outlet_active_code'), 'Migration 022 must enforce unique active branch code per outlet');
    assert.ok(sql022.includes('uq_smav_branches_outlet_active_name'), 'Migration 022 must enforce unique active branch name per outlet');
    assert.equal(
      /DELETE\s+FROM\s+public\.smav_branches/i.test(executableSql022),
      false,
      'Migration 022 must NEVER automatically delete rows from public.smav_branches'
    );
    assert.equal(
      /(smav_outlet_printers|smav_paired_devices|smav_catalog_items|smav_outlet_configs|smav_outlet_transactions|smav_sale_notification_jobs|restaurant_orders)/i.test(
        executableSql022
      ),
      false,
      'Migration 022 must NEVER alter unrelated tenant, printer/device, catalog, notification, or restaurant tables'
    );
    assert.equal(
      /ON CONFLICT\s*\(\s*outlet_id\s*,\s*branch_code\s*,\s*billing_date\s*\)/i.test(executableSql022),
      false,
      'Migration 022 must never contain unqualified ON CONFLICT (outlet_id, branch_code, billing_date)'
    );
    assert.equal(
      (executableSql022.match(/ON CONFLICT ON CONSTRAINT smav_bill_number_counters_pkey/gi) || []).length,
      2,
      'Migration 022 must use ON CONFLICT ON CONSTRAINT smav_bill_number_counters_pkey in both reserve and allocate RPCs'
    );
    assert.equal(
      (sql022.match(/#variable_conflict use_column/gi) || []).length,
      3,
      'Migration 022 must set #variable_conflict use_column in all 3 RETURNS TABLE RPCs'
    );
    assert.equal(
      /UPDATE\s+public\.smav_salon_bills\s+SET[^;]*\bbill_number\s*=/i.test(executableSql022),
      false,
      'Migration 022 must NEVER modify finalized bill_number values on smav_salon_bills'
    );
    assert.equal(
      /UPDATE\s+public\.smav_central_bill_numbers\s+SET[^;]*\bcentral_bill_number\s*=/i.test(executableSql022),
      false,
      'Migration 022 must NEVER modify central_bill_number values on smav_central_bill_numbers'
    );
  }

  console.log('ALL CENTRAL BILL NUMBERING & DYNAMIC BRANCH TESTS PASSED');
}

runTests().catch((err) => {
  console.error('TEST FAILURE:', err);
  process.exit(1);
});
