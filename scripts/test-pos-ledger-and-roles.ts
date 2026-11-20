import assert from 'node:assert/strict';
import {
  getOutletLocalDayBounds,
  isTimestampInOutletLocalToday,
  canModifyBills,
  recalculateBillTotals,
  validateBillMutationConflict,
  normalizeLedgerBillRow,
} from '../services/billLedger';
import {
  normalizeUpstreamStaffPayload,
  mapAuthoritativeGlossyRoleToSmav,
  parseCanonicalGlossyUserRole,
  buildAuthoritativeUserRoleIndex,
  resolveAuthoritativeUserRole,
} from '../services/salonStaff';

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    console.error(`FAIL: ${name}`);
    throw err;
  }
}

runTest('1. Today-only ledger filters by outlet-local timezone (Asia/Kolkata) and preserves older bills', () => {
  // 2026-11-20 00:30:00 IST = 2026-11-19T19:00:00.000Z
  const nowIst = new Date('2026-11-19T19:00:00.000Z');
  const bounds = getOutletLocalDayBounds('Asia/Kolkata', nowIst);
  assert.equal(bounds.dateKey, '2026-11-20');

  // 2026-11-20 00:05:00 IST -> today
  assert.equal(isTimestampInOutletLocalToday('2026-11-19T18:35:00.000Z', 'Asia/Kolkata', nowIst), true);
  // 2026-11-19 23:55:00 IST -> yesterday (excluded from Today's Ledger, preserved in DB/reports)
  assert.equal(isTimestampInOutletLocalToday('2026-11-19T18:25:00.000Z', 'Asia/Kolkata', nowIst), false);
});

runTest('2. Edit/Void permissions allow SUPERADMIN, ADMIN, and authorized MANAGER; block POS_BILLING', () => {
  assert.equal(canModifyBills({ role: 'superadmin', displayRole: 'SUPERADMIN' }), true);
  assert.equal(canModifyBills({ role: 'admin', displayRole: 'ADMIN' }), true);
  assert.equal(canModifyBills({ role: 'staff', outletRole: 'MANAGER' }), true);
  assert.equal(canModifyBills({ role: 'staff', outletRole: 'OWNER' }), true);

  assert.equal(canModifyBills({ role: 'staff', displayRole: 'POS_BILLING', outletRole: 'STYLIST' }), false);
  assert.equal(canModifyBills({ role: 'staff', displayRole: 'POS_BILLING', outletRole: 'RECEPTIONIST' }), false);
  assert.equal(canModifyBills({ role: 'pos_billing' }), false);
  assert.equal(canModifyBills(null), false);
});

runTest('3. Bill edit recalculation preserves exact math, GST, discount, and stylist names', () => {
  const recalc = recalculateBillTotals({
    businessType: 'salon',
    items: [
      { id: 'srv-1', name: 'Hair Cut', quantity: 2, unitPrice: 500, stylistName: 'Renuka', gstPercent: 18 },
      { id: 'srv-2', name: 'Hair Spa', quantity: 1, unitPrice: 1000, stylistName: 'Deena', gstPercent: 18 },
    ],
    discountAmount: 200,
  });

  assert.equal(recalc.subtotal, 2000);
  assert.equal(recalc.discountAmount, 200);
  assert.equal(recalc.totalTax, 324);
  assert.equal(recalc.cgst, 162);
  assert.equal(recalc.sgst, 162);
  assert.equal(recalc.grandTotal, 2124);
  assert.deepEqual(recalc.stylistNames, ['Renuka', 'Deena']);
});

runTest('4. Conflict protection detects already-voided bills and version mismatches (HTTP 409)', () => {
  const alreadyVoided = validateBillMutationConflict({
    currentIsVoided: true,
    currentEditVersion: 2,
    expectedEditVersion: 2,
  });
  assert.equal(alreadyVoided.conflict, true);
  if (alreadyVoided.conflict) assert.equal(alreadyVoided.code, 'ALREADY_VOIDED');

  const staleVersion = validateBillMutationConflict({
    currentIsVoided: false,
    currentEditVersion: 3,
    expectedEditVersion: 2,
  });
  assert.equal(staleVersion.conflict, true);
  if (staleVersion.conflict) assert.equal(staleVersion.code, 'VERSION_CONFLICT');

  const ok = validateBillMutationConflict({
    currentIsVoided: false,
    currentEditVersion: 3,
    expectedEditVersion: 3,
  });
  assert.equal(ok.conflict, false);
});

runTest('5. Ledger normalization extracts bill fields, clickable items, and stylist names without status dependency', () => {
  const entry = normalizeLedgerBillRow(
    {
      id: 'bill-uuid-1',
      outlet_id: 'outlet_glossy_gach',
      bill_number: 'TGL-GACHI-20261120-0001',
      customer_name: 'Priya Sharma',
      customer_phone: '9876543210',
      payment_mode: 'UPI',
      subtotal: 1500,
      discount_amount: 0,
      total_tax: 270,
      grand_total: 1770,
      created_at: '2026-11-20T05:30:00.000Z',
      items: [
        { service_name: 'Facial', quantity: 1, unit_price: 1500, line_total: 1500, stylist_name: 'Sharadha' },
      ],
    },
    'smav_salon_bills',
    'outlet_glossy_gach'
  );

  assert.equal(entry.billNumber, 'TGL-GACHI-20261120-0001');
  assert.equal(entry.customerName, 'Priya Sharma');
  assert.equal(entry.customerPhone, '9876543210');
  assert.equal(entry.paymentMode, 'upi');
  assert.equal(entry.grandTotal, 1770);
  assert.deepEqual(entry.stylistNames, ['Sharadha']);
  assert.equal(entry.items.length, 1);
  assert.equal(entry.items[0].stylistName, 'Sharadha');
});

runTest('6. Authoritative Glossy Looks public.users.role overrides public.staff.role job titles without hardcoding names', () => {
  const outlet = { id: 'outlet_glossy_gach', code: 'glossylooks', name: 'The Glossy Looks' };
  const upstreamStaffPayload = {
    staff: [
      { id: 'st-1', name: 'Renuka', email: 'renuka@glossylooks.in', role: 'Senior Hair Artist', is_active: true, branch_id: 'tgl-gachibowli-main' },
      { id: 'st-2', name: 'Sharadha', email: 'sharadha@glossylooks.in', role: 'Skin Specialist', is_active: true, branch_id: 'tgl-gachibowli-main' },
      { id: 'st-3', name: 'Deena', email: 'deena@glossylooks.in', role: 'Front Desk / Reception', is_active: true, branch_id: 'tgl-gachibowli-main' },
      { id: 'st-4', name: 'Paleti Mounika', email: 'paletimounika@glossylooks.in', role: 'Salon Floor Lead', is_active: true, branch_id: 'tgl-gachibowli-main' },
    ],
  };

  // Authoritative public.users rows
  const authoritativeUsers = [
    { id: 'u-1', staff_id: 'st-1', email: 'renuka@glossylooks.in', full_name: 'Renuka', role: 'STYLIST', is_active: true },
    { id: 'u-2', staff_id: 'st-2', email: 'sharadha@glossylooks.in', full_name: 'Sharadha', role: 'STYLIST', is_active: true },
    { id: 'u-3', staff_id: 'st-3', email: 'deena@glossylooks.in', full_name: 'Deena', role: 'STYLIST', is_active: true },
    { id: 'u-4', staff_id: 'st-4', email: 'paletimounika@glossylooks.in', full_name: 'Paleti Mounika', role: 'MANAGER', is_active: true },
  ];

  const normalized = normalizeUpstreamStaffPayload(upstreamStaffPayload, outlet, authoritativeUsers);
  assert.equal(normalized.success, true);
  // Only authoritative STYLIST records appear in POS stylist selection (Manager Paleti Mounika excluded from stylist picker)
  assert.equal(normalized.stylists.length, 3);

  const byName = new Map(normalized.stylists.map((s) => [s.name, s]));
  assert.equal(byName.get('Renuka')?.role, 'Stylist');
  assert.equal(byName.get('Renuka')?.sourceRole, 'STYLIST');
  assert.equal(byName.get('Renuka')?.smavRole, 'POS_BILLING');

  assert.equal(byName.get('Sharadha')?.role, 'Stylist');
  assert.equal(byName.get('Sharadha')?.sourceRole, 'STYLIST');
  assert.equal(byName.get('Sharadha')?.smavRole, 'POS_BILLING');

  assert.equal(byName.get('Deena')?.role, 'Stylist');
  assert.equal(byName.get('Deena')?.sourceRole, 'STYLIST');
  assert.equal(byName.get('Deena')?.smavRole, 'POS_BILLING');

  // Verify authoritative user role resolution for Manager (overrides job title "Salon Floor Lead")
  const userIndex = buildAuthoritativeUserRoleIndex(authoritativeUsers);
  const managerResolved = resolveAuthoritativeUserRole(upstreamStaffPayload.staff[3], userIndex);
  assert.equal(managerResolved.canonicalRole, 'MANAGER');
  assert.equal(managerResolved.displayRole, 'Manager');
  assert.equal(managerResolved.smavRole, 'ADMIN');

  // Verify no hardcoding: changing source public.users.role for Renuka dynamically updates output
  const updatedRoleUsers = authoritativeUsers.map((u) =>
    u.id === 'u-1' ? { ...u, role: 'MANAGER' } : u
  );
  const dynamicIndex = buildAuthoritativeUserRoleIndex(updatedRoleUsers);
  const renukaAfter = resolveAuthoritativeUserRole(upstreamStaffPayload.staff[0], dynamicIndex);
  assert.equal(renukaAfter.displayRole, 'Manager');
  assert.equal(renukaAfter.smavRole, 'ADMIN');
  const dynamicStylists = normalizeUpstreamStaffPayload(upstreamStaffPayload, outlet, updatedRoleUsers);
  assert.equal(dynamicStylists.stylists.length, 2);
  assert.equal(dynamicStylists.stylists.some((s) => s.name === 'Renuka'), false);

  // Verify job title strings are rejected as canonical user roles
  assert.equal(parseCanonicalGlossyUserRole('Senior Hair Artist'), null);
  assert.equal(parseCanonicalGlossyUserRole('Front Desk / Reception'), null);

  // Verify SUPERADMIN protection & SMAV RBAC mapping
  const superCheck = mapAuthoritativeGlossyRoleToSmav('SUPERADMIN');
  assert.equal(superCheck.isProtectedSuperadmin, true);
  assert.equal(mapAuthoritativeGlossyRoleToSmav('OWNER').contractRole, 'ADMIN');
  assert.equal(mapAuthoritativeGlossyRoleToSmav('STYLIST').contractRole, 'POS_BILLING');
  assert.equal(mapAuthoritativeGlossyRoleToSmav('RECEPTIONIST').contractRole, 'POS_BILLING');
});

console.log('ALL 6 POS LEDGER, RBAC, AND AUTHORITATIVE STAFF ROLE TESTS PASSED.');
