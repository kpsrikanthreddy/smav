import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  CentralBillNumberCoordinator,
  buildBillNumberReconciliationReport,
  buildDefaultGlossyBranches,
  formatCentralBillNumber,
  getIndiaDateParts,
  isValidCentralBillNumber,
  normalizeGlossyBranchCode,
  resolvePermittedBranchesForUser,
  syncCentralBillNumberToGlossyLooks,
} from '../services/centralBillNumbering';

async function runTests() {
  const outletId = 'outlet-glossylooks-test';
  const branches = buildDefaultGlossyBranches(outletId);

  // 1. Canonical branch normalization (Gachibowli -> GACHI, Kondapur -> KONDA; never guess invalid/blank)
  assert.equal(normalizeGlossyBranchCode('Gachibowli'), 'GACHI');
  assert.equal(normalizeGlossyBranchCode('GACHI'), 'GACHI');
  assert.equal(normalizeGlossyBranchCode('tgl-gachibowli-main'), 'GACHI');
  assert.equal(normalizeGlossyBranchCode('Kondapur'), 'KONDA');
  assert.equal(normalizeGlossyBranchCode('KONDA'), 'KONDA');
  assert.equal(normalizeGlossyBranchCode('tgl-kondapur-main'), 'KONDA');
  assert.equal(normalizeGlossyBranchCode(''), null);
  assert.equal(normalizeGlossyBranchCode('Madhapur'), null);
  assert.equal(normalizeGlossyBranchCode(null), null);

  // 2. Branch permission & mandatory manual selection rules
  // 2a. User with 2 branches -> MUST NOT auto-select
  const ownerTwoBranches = resolvePermittedBranchesForUser({
    allOutletBranches: branches,
    userRole: 'admin',
    assignedBranchCodes: [],
  });
  assert.equal(ownerTwoBranches.branches.length, 2);
  assert.equal(ownerTwoBranches.autoSelectedBranch, null);
  assert.equal(ownerTwoBranches.requiresManualSelection, true);

  // 2b. Staff assigned to exactly 1 branch -> auto-select that single branch only
  const staffSingleBranch = resolvePermittedBranchesForUser({
    allOutletBranches: branches,
    userRole: 'pos_billing',
    assignedBranchCodes: ['GACHI'],
  });
  assert.equal(staffSingleBranch.branches.length, 1);
  assert.equal(staffSingleBranch.autoSelectedBranch?.branchCode, 'GACHI');
  assert.equal(staffSingleBranch.requiresManualSelection, false);

  // 2c. Staff assigned to both branches -> manual selection required
  const staffBothBranches = resolvePermittedBranchesForUser({
    allOutletBranches: branches,
    userRole: 'pos_billing',
    assignedBranchCodes: ['GACHI', 'KONDA'],
  });
  assert.equal(staffBothBranches.branches.length, 2);
  assert.equal(staffBothBranches.autoSelectedBranch, null);
  assert.equal(staffBothBranches.requiresManualSelection, true);

  // 3. Bill number format & India timezone date calculation
  const fixedDateIst = new Date('2026-11-20T09:30:00.000Z'); // 2026-11-20 15:00 IST
  const istParts = getIndiaDateParts(fixedDateIst);
  assert.equal(istParts.dateIso, '2026-11-20');
  assert.equal(istParts.dateCompact, '20261120');

  // Late UTC crossing midnight into next IST day (2026-11-20 19:00 UTC == 2026-11-21 00:30 IST)
  const rolloverIst = getIndiaDateParts(new Date('2026-11-20T19:00:00.000Z'));
  assert.equal(rolloverIst.dateIso, '2026-11-21');
  assert.equal(rolloverIst.dateCompact, '20261121');

  const sampleFormatted = formatCentralBillNumber('GACHI', '20261120', 1);
  assert.equal(sampleFormatted, 'TGL-GACHI-20261120-0001');
  assert.equal(isValidCentralBillNumber('TGL-GACHI-20261120-0001'), true);
  assert.equal(isValidCentralBillNumber('TGL-KONDA-20261120-0002'), true);
  assert.equal(isValidCentralBillNumber('GL-2026-0001'), false);

  // 4. Central coordinator: branch mandatory enforcement, independent per-branch counters, concurrent uniqueness
  const coordinator = new CentralBillNumberCoordinator();

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

  // Concurrent reservations across Web POS, Android Print Agent, and GlossyLooks Admin Portal for GACHI
  const concurrentGachi = await Promise.all([
    coordinator.reserveCentralBillNumber({
      db: null,
      outletId,
      branchCode: 'Gachibowli',
      idempotencyKey: 'idem-gachi-1',
      sourceSystem: 'smav_web_pos',
      now: fixedDateIst,
    }),
    coordinator.reserveCentralBillNumber({
      db: null,
      outletId,
      branchCode: 'GACHI',
      idempotencyKey: 'idem-gachi-2',
      sourceSystem: 'smav_android_agent',
      deviceId: 'android-dev-01',
      now: fixedDateIst,
    }),
    coordinator.reserveCentralBillNumber({
      db: null,
      outletId,
      branchCode: 'GACHI',
      idempotencyKey: 'idem-gachi-3',
      sourceSystem: 'glossylooks_admin_portal',
      now: fixedDateIst,
    }),
  ]);

  const gachiNumbers = concurrentGachi.map((r) => r.centralBillNumber).sort();
  assert.deepEqual(gachiNumbers, [
    'TGL-GACHI-20261120-0001',
    'TGL-GACHI-20261120-0002',
    'TGL-GACHI-20261120-0003',
  ]);
  assert.equal(new Set(gachiNumbers).size, 3);

  // Independent KONDA counter starts at 0001 on the same day
  const konda1 = await coordinator.reserveCentralBillNumber({
    db: null,
    outletId,
    branchCode: 'Kondapur',
    idempotencyKey: 'idem-konda-1',
    sourceSystem: 'glossylooks_admin_portal',
    now: fixedDateIst,
  });
  assert.equal(konda1.centralBillNumber, 'TGL-KONDA-20261120-0001');
  assert.equal(konda1.branchCode, 'KONDA');
  assert.equal(konda1.branchName, 'Kondapur');

  // Next IST day resets GACHI sequence back to 0001
  const nextDayGachi = await coordinator.reserveCentralBillNumber({
    db: null,
    outletId,
    branchCode: 'GACHI',
    idempotencyKey: 'idem-gachi-nextday-1',
    sourceSystem: 'smav_web_pos',
    now: new Date('2026-11-20T19:05:00.000Z'), // 2026-11-21 00:35 IST
  });
  assert.equal(nextDayGachi.centralBillNumber, 'TGL-GACHI-20261121-0001');

  // 5. Idempotent retry returns the exact same central bill number without incrementing sequence
  const replay = await coordinator.reserveCentralBillNumber({
    db: null,
    outletId,
    branchCode: 'GACHI',
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
        branchCode: 'GACHI',
        idempotencyKey: 'idem-gachi-1',
        sourceSystem: 'smav_web_pos',
        now: fixedDateIst,
      }),
    /OUTLET_MISMATCH/
  );

  // 6. Offline Android preallocated range does not overlap online reservations
  const prealloc = await coordinator.allocateOfflineRange({
    db: null,
    outletId,
    branchCode: 'GACHI',
    deviceId: 'android-dev-01',
    count: 5,
    now: fixedDateIst,
  });
  assert.equal(prealloc.items.length, 5);
  assert.deepEqual(
    prealloc.items.map((i) => i.centralBillNumber),
    [
      'TGL-GACHI-20261120-0004',
      'TGL-GACHI-20261120-0005',
      'TGL-GACHI-20261120-0006',
      'TGL-GACHI-20261120-0007',
      'TGL-GACHI-20261120-0008',
    ]
  );

  // Next online reservation after preallocation starts at 0009 (zero overlap)
  const gachiAfterRange = await coordinator.reserveCentralBillNumber({
    db: null,
    outletId,
    branchCode: 'GACHI',
    idempotencyKey: 'idem-gachi-after-range',
    sourceSystem: 'smav_web_pos',
    now: fixedDateIst,
  });
  assert.equal(gachiAfterRange.centralBillNumber, 'TGL-GACHI-20261120-0009');

  // 7. Finalization & immutability
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

  // Preallocated offline bill number finalizes cleanly on reconnect without changing bill number
  const finalizedOffline = await coordinator.finalizeCentralBillNumber({
    db: null,
    outletId,
    centralBillNumber: prealloc.items[0].centralBillNumber,
    idempotencyKey: prealloc.items[0].idempotencyKey,
    localBillId: 'android-offline-bill-001',
    sourceSystem: 'smav_android_agent',
  });
  assert.equal(finalizedOffline.status, 'FINALIZED');
  assert.equal(finalizedOffline.centralBillNumber, 'TGL-GACHI-20261120-0004');

  // Unreserved / fabricated bill number cannot be finalized
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

  // 8. Reconciliation report: detects duplicates, unlinked TGL bills, mismatches, and preserves historical legacy records
  const report = buildBillNumberReconciliationReport({
    outletId,
    centralNumbers: [
      { id: 'c1', central_bill_number: 'TGL-GACHI-20261120-0001', branch_code: 'GACHI', status: 'FINALIZED' },
      { id: 'c2', central_bill_number: 'TGL-GACHI-20261120-0002', branch_code: 'GACHI', status: 'RESERVED' },
      { id: 'c3', central_bill_number: 'TGL-GACHI-20261120-0004', branch_code: 'GACHI', status: 'PREALLOCATED' },
      { id: 'c4', central_bill_number: 'TGL-KONDA-20261120-0001', branch_code: 'KONDA', status: 'FINALIZED' },
    ],
    salonBills: [
      // Properly linked central bill
      { id: 'b1', bill_number: 'TGL-GACHI-20261120-0001', central_bill_number: 'TGL-GACHI-20261120-0001', created_at: '2026-11-20T09:30:00Z' },
      // Historical legacy bills (preserved untouched, NOT flagged as missing)
      { id: 'b-legacy-1', bill_number: 'TGL-20261015-0012', central_bill_number: null, created_at: '2026-10-15T10:00:00Z' },
      { id: 'b-legacy-2', bill_number: 'INV-GL-8841', central_bill_number: null, created_at: '2026-09-01T12:00:00Z' },
      // Duplicate + unlinked TGL bill
      { id: 'b-dup-1', bill_number: 'TGL-KONDA-20261120-0001', central_bill_number: 'TGL-KONDA-20261120-0001', created_at: '2026-11-20T09:31:00Z' },
      { id: 'b-dup-2', bill_number: 'TGL-KONDA-20261120-0001', central_bill_number: null, created_at: '2026-11-20T09:32:00Z' },
      // Mismatched central vs printed bill number
      { id: 'b-mismatch', bill_number: 'TGL-GACHI-20261120-0099', central_bill_number: 'TGL-GACHI-20261120-0002', created_at: '2026-11-20T09:33:00Z' },
    ],
  });

  assert.equal(report.totalCentralNumbers, 4);
  assert.equal(report.totalSalonBills, 6);
  assert.equal(report.linkedBillsCount, 2);
  assert.equal(report.legacyHistoricalBillsCount, 2);
  assert.equal(report.missingCentralBillNumberCount, 1);
  assert.equal(report.duplicateBillNumbers.length, 1);
  assert.equal(report.duplicateBillNumbers[0].billNumber, 'TGL-KONDA-20261120-0001');
  assert.equal(report.mismatchedBills.length, 1);
  assert.equal(report.reservedUnfinalizedCount, 1);
  assert.equal(report.preallocatedUnusedCount, 1);
  assert.equal(report.byBranch.GACHI.total, 3);
  assert.equal(report.byBranch.KONDA.finalized, 1);

  // 9. Outbound sync webhook signs payload when configured and skips cleanly when unset
  const prevUrl = process.env.GLOSSYLOOKS_BILL_SYNC_WEBHOOK_URL;
  const prevKey = process.env.GLOSSYLOOKS_INTEGRATION_KEY;
  const prevDispatchSecret = process.env.SMAV_DISPATCH_SECRET;
  try {
    delete process.env.GLOSSYLOOKS_BILL_SYNC_WEBHOOK_URL;
    const skipped = await syncCentralBillNumberToGlossyLooks({
      centralBillId: finalizedOnline.centralBillId,
      centralBillNumber: finalizedOnline.centralBillNumber,
      outletId,
      branchCode: 'GACHI',
      branchName: 'Gachibowli',
      idempotencyKey: 'idem-gachi-1',
    });
    assert.equal(skipped.skipped, true);
    assert.equal(skipped.synced, false);

    process.env.GLOSSYLOOKS_BILL_SYNC_WEBHOOK_URL = 'https://www.glossylooks.in/api/integrations/smav/sale-event';
    process.env.GLOSSYLOOKS_INTEGRATION_KEY = 'test-shared-secret';
    process.env.SMAV_DISPATCH_SECRET = 'test-dispatch-secret-at-least-32-chars';
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    let capturedBody = '';
    const synced = await syncCentralBillNumberToGlossyLooks({
      centralBillId: finalizedOnline.centralBillId,
      centralBillNumber: finalizedOnline.centralBillNumber,
      outletId,
      branchCode: 'GACHI',
      branchName: 'Gachibowli',
      idempotencyKey: 'idem-gachi-1',
      grandTotal: 1499,
      fetchImpl: (async (url: any, init: any) => {
        capturedUrl = String(url);
        capturedHeaders = init.headers;
        capturedBody = init.body;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as any,
    });
    assert.equal(synced.synced, true);
    assert.equal(capturedUrl, 'https://www.glossylooks.in/api/integrations/smav/sale-event');
    assert.ok(Number(capturedHeaders['X-SMAV-Timestamp']) < 1e12, 'Timestamp should be Unix seconds');
    const expectedSig = crypto
      .createHmac('sha256', 'test-dispatch-secret-at-least-32-chars')
      .update(`${capturedHeaders['X-SMAV-Timestamp']}.${capturedBody}`)
      .digest('hex');
    assert.equal(capturedHeaders['X-SMAV-Signature'], expectedSig);
    assert.equal(JSON.parse(capturedBody).central_bill_number, 'TGL-GACHI-20261120-0001');
  } finally {
    if (prevUrl === undefined) delete process.env.GLOSSYLOOKS_BILL_SYNC_WEBHOOK_URL;
    else process.env.GLOSSYLOOKS_BILL_SYNC_WEBHOOK_URL = prevUrl;
    if (prevKey === undefined) delete process.env.GLOSSYLOOKS_INTEGRATION_KEY;
    else process.env.GLOSSYLOOKS_INTEGRATION_KEY = prevKey;
    if (prevDispatchSecret === undefined) delete process.env.SMAV_DISPATCH_SECRET;
    else process.env.SMAV_DISPATCH_SECRET = prevDispatchSecret;
  }

  // 10. Regression test: Kondapur (KONDA) bill — reserve, save, finalize, and retry with same idempotency key
  {
    const kondaOutletId = '28467997-d316-482e-be93-258dd26e1340';
    const kondaCoordinator = new CentralBillNumberCoordinator();
    const kondaNow = new Date('2026-11-20T06:00:00.000Z'); // 2026-11-20 11:30 IST
    const kondaIdemKey = 'WEB_KONDA_REGRESSION_ATTEMPT_001';

    // Simulated smav_salon_bills persistence table keyed by idempotency_key (mirrors /api/mobile/sync/bills)
    const persistedSalonBills = new Map<
      string,
      {
        id: string;
        outlet_id: string;
        bill_number: string;
        central_bill_id: string;
        central_bill_number: string;
        branch_code: string;
        branch_name: string;
        idempotency_key: string;
        customer_name: string;
        customer_phone: string;
        payment_mode: string;
        subtotal: number;
        discount_amount: number;
        total_tax: number;
        grand_total: number;
        items: Array<{
          service_id: string;
          service_name: string;
          stylist_id: string;
          stylist_name: string;
          quantity: number;
          unit_price: number;
        }>;
      }
    >();

    // Step 1: Reserve central bill number for Kondapur (KONDA)
    const reserved = await kondaCoordinator.reserveCentralBillNumber({
      db: null,
      outletId: kondaOutletId,
      branchCode: 'KONDA',
      idempotencyKey: kondaIdemKey,
      sourceSystem: 'smav_web_pos',
      now: kondaNow,
    });
    assert.equal(reserved.centralBillNumber, 'TGL-KONDA-20261120-0001');
    assert.equal(reserved.branchCode, 'KONDA');
    assert.equal(reserved.branchName, 'Kondapur');
    assert.equal(reserved.status, 'RESERVED');
    assert.equal(reserved.idempotentReplay, false);

    // Step 2: Persist bill with 1 service, stylist, customer, payment, tax, and totals
    const saveAndFinalize = async (resv: typeof reserved) => {
      let existing = persistedSalonBills.get(resv.idempotencyKey);
      if (!existing) {
        existing = {
          id: 'salon-bill-konda-001',
          outlet_id: kondaOutletId,
          bill_number: resv.centralBillNumber,
          central_bill_id: resv.centralBillId,
          central_bill_number: resv.centralBillNumber,
          branch_code: resv.branchCode,
          branch_name: resv.branchName,
          idempotency_key: resv.idempotencyKey,
          customer_name: 'Ananya Rao',
          customer_phone: '9876543210',
          payment_mode: 'upi',
          subtotal: 1000,
          discount_amount: 0,
          total_tax: 180,
          grand_total: 1180,
          items: [
            {
              service_id: 'svc-haircut-01',
              service_name: 'Layer Haircut',
              stylist_id: 'sty-renuka-01',
              stylist_name: 'Renuka',
              quantity: 1,
              unit_price: 1000,
            },
          ],
        };
        persistedSalonBills.set(resv.idempotencyKey, existing);
      }

      const finalized = await kondaCoordinator.finalizeCentralBillNumber({
        db: null,
        outletId: kondaOutletId,
        centralBillNumber: existing.central_bill_number,
        idempotencyKey: existing.idempotency_key,
        localBillId: existing.id,
        sourceSystem: 'smav_web_pos',
      });
      return { savedBill: existing, finalized };
    };

    const firstAttempt = await saveAndFinalize(reserved);
    assert.equal(firstAttempt.finalized.status, 'FINALIZED');
    assert.equal(firstAttempt.finalized.centralBillNumber, 'TGL-KONDA-20261120-0001');
    assert.equal(firstAttempt.savedBill.central_bill_id, reserved.centralBillId);
    assert.equal(firstAttempt.savedBill.central_bill_number, 'TGL-KONDA-20261120-0001');
    assert.equal(firstAttempt.savedBill.outlet_id, kondaOutletId);
    assert.equal(firstAttempt.savedBill.branch_code, 'KONDA');
    assert.equal(firstAttempt.savedBill.branch_name, 'Kondapur');
    assert.equal(firstAttempt.savedBill.customer_name, 'Ananya Rao');
    assert.equal(firstAttempt.savedBill.payment_mode, 'upi');
    assert.equal(firstAttempt.savedBill.total_tax, 180);
    assert.equal(firstAttempt.savedBill.grand_total, 1180);
    assert.equal(firstAttempt.savedBill.items.length, 1);
    assert.equal(firstAttempt.savedBill.items[0].service_name, 'Layer Haircut');
    assert.equal(firstAttempt.savedBill.items[0].stylist_name, 'Renuka');

    // Step 3: Retry the exact same checkout (reserve + save + finalize) with the same idempotency key
    const retriedReserve = await kondaCoordinator.reserveCentralBillNumber({
      db: null,
      outletId: kondaOutletId,
      branchCode: 'KONDA',
      idempotencyKey: kondaIdemKey,
      sourceSystem: 'smav_web_pos',
      now: kondaNow,
    });
    assert.equal(retriedReserve.idempotentReplay, true);
    assert.equal(retriedReserve.centralBillId, reserved.centralBillId);
    assert.equal(retriedReserve.centralBillNumber, 'TGL-KONDA-20261120-0001');

    const retriedSave = await saveAndFinalize(retriedReserve);
    assert.equal(retriedSave.finalized.status, 'FINALIZED');
    assert.equal(retriedSave.finalized.centralBillId, reserved.centralBillId);
    assert.equal(retriedSave.finalized.centralBillNumber, 'TGL-KONDA-20261120-0001');

    // Step 4: Assert ONLY ONE central bill number and ONLY ONE finalized bill exist (and sequence did not skip)
    const allKondaRecords = kondaCoordinator.getMemoryRecordsForOutlet(kondaOutletId);
    assert.equal(allKondaRecords.length, 1, 'Expected exactly 1 central bill number after retry');
    assert.equal(allKondaRecords[0].status, 'FINALIZED');
    assert.equal(persistedSalonBills.size, 1, 'Expected exactly 1 saved salon bill after retry');

    const nextDistinctKonda = await kondaCoordinator.reserveCentralBillNumber({
      db: null,
      outletId: kondaOutletId,
      branchCode: 'KONDA',
      idempotencyKey: 'WEB_KONDA_REGRESSION_ATTEMPT_002',
      sourceSystem: 'smav_web_pos',
      now: kondaNow,
    });
    assert.equal(nextDistinctKonda.centralBillNumber, 'TGL-KONDA-20261120-0002', 'Sequence must not skip after retry');
  }

  // 11. Static SQL regression check: ensure central bill RPCs in migrations 019 & 020 never have unqualified ON CONFLICT (outlet_id, ...)
  {
    const fs = await import('node:fs');
    const path = await import('node:path');
    for (const relPath of [
      'database/migrations/019_central_bill_numbering_and_branches.sql',
      'database/migrations/020_fix_central_bill_rpc_ambiguous_outlet_id.sql',
    ]) {
      const sql = fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf8');
      const executableSql = sql
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('--'))
        .join('\n');
      assert.equal(
        /ON CONFLICT\s*\(\s*outlet_id\s*,\s*branch_code\s*,\s*billing_date\s*\)/i.test(executableSql),
        false,
        `${relPath} must not contain unqualified ON CONFLICT (outlet_id, branch_code, billing_date)`
      );
      const constraintMatches = executableSql.match(/ON CONFLICT ON CONSTRAINT smav_bill_number_counters_pkey/gi) || [];
      assert.equal(
        constraintMatches.length,
        2,
        `${relPath} must use ON CONFLICT ON CONSTRAINT smav_bill_number_counters_pkey in both reserve and allocate RPCs`
      );
      const conflictDirectiveMatches = sql.match(/#variable_conflict use_column/gi) || [];
      assert.equal(
        conflictDirectiveMatches.length,
        3,
        `${relPath} must set #variable_conflict use_column in all 3 RETURNS TABLE RPCs`
      );
    }
  }

  console.log('ALL CENTRAL BILL NUMBERING & BRANCH TESTS PASSED');
}

runTests().catch((err) => {
  console.error('TEST FAILURE:', err);
  process.exit(1);
});
