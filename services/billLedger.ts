export interface LedgerBillItem {
  id?: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  stylistId?: string | null;
  stylistName?: string | null;
  discountPercent?: number;
  gstPercent?: number;
  variantName?: string | null;
}

export interface BillEditAuditSnapshot {
  version: number;
  editedAt: string;
  editedBy: string;
  editedByName: string;
  reason: string;
  previousPaymentMode: string;
  previousGrandTotal: number;
  previousSubtotal: number;
  previousDiscountAmount: number;
  previousTotalTax: number;
  previousItemCount: number;
  previousItems: LedgerBillItem[];
}

export interface TransactionLedgerEntry {
  id: string;
  sourceTable: 'smav_salon_bills' | 'smav_central_sales' | 'memory';
  outletId: string;
  billNumber: string;
  centralBillId?: string | null;
  centralBillNumber?: string | null;
  branchId?: string | null;
  branchCode?: string | null;
  branchName?: string | null;
  sourceSystem?: string | null;
  isLegacyBill?: boolean;
  idempotencyKey?: string;
  customerName: string;
  customerPhone: string;
  items: LedgerBillItem[];
  paymentMode: string;
  subtotal: number;
  discountAmount: number;
  totalTax: number;
  grandTotal: number;
  createdAt: string;
  stylistNames: string[];
  editVersion: number;
  isVoided: boolean;
  editedAt?: string | null;
  editReason?: string | null;
  voidedAt?: string | null;
  voidReason?: string | null;
  editHistory?: BillEditAuditSnapshot[];
}

export interface OutletDayBounds {
  timezone: string;
  dateKey: string;
  startIso: string;
  endIso: string;
  startMs: number;
  endMs: number;
}

export const DEFAULT_OUTLET_TIMEZONE = 'Asia/Kolkata';

const TAX_RATE_BY_CATEGORY: Record<string, number> = {
  salon: 18,
  restaurant: 5,
  retail: 12,
  other: 0,
};

function roundCurrency(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

/**
 * Returns YYYY-MM-DD in the given IANA timezone. Falls back safely to Asia/Kolkata.
 */
export function formatDateKeyInTimezone(date: Date, timezone = DEFAULT_OUTLET_TIMEZONE): { dateKey: string; resolvedTz: string } {
  let resolvedTz = timezone || DEFAULT_OUTLET_TIMEZONE;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: resolvedTz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const y = parts.find((p) => p.type === 'year')?.value || '1970';
    const m = parts.find((p) => p.type === 'month')?.value || '01';
    const d = parts.find((p) => p.type === 'day')?.value || '01';
    return { dateKey: `${y}-${m}-${d}`, resolvedTz };
  } catch {
    resolvedTz = DEFAULT_OUTLET_TIMEZONE;
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: resolvedTz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const y = parts.find((p) => p.type === 'year')?.value || '1970';
    const m = parts.find((p) => p.type === 'month')?.value || '01';
    const d = parts.find((p) => p.type === 'day')?.value || '01';
    return { dateKey: `${y}-${m}-${d}`, resolvedTz };
  }
}

/**
 * Computes the UTC epoch millisecond offset of `timezone` relative to UTC at `date`.
 */
function getTimezoneOffsetMs(date: Date, timezone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = Number(p.value);
  }
  const hour = map.hour === 24 ? 0 : map.hour;
  const asUtc = Date.UTC(map.year, (map.month || 1) - 1, map.day || 1, hour || 0, map.minute || 0, map.second || 0);
  const truncatedInput = Math.floor(date.getTime() / 1000) * 1000;
  return asUtc - truncatedInput;
}

/**
 * Computes exact UTC start/end timestamps corresponding to 00:00:00.000 .. 23:59:59.999
 * in the outlet's local timezone (defaults to Asia/Kolkata).
 */
export function getOutletLocalDayBounds(timezone = DEFAULT_OUTLET_TIMEZONE, now = new Date()): OutletDayBounds {
  const { dateKey, resolvedTz } = formatDateKeyInTimezone(now, timezone);
  const [y, m, d] = dateKey.split('-').map(Number);

  // Start of day in local wall-clock time converted to UTC epoch ms
  const roughStartUtc = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  const startOffsetMs = getTimezoneOffsetMs(roughStartUtc, resolvedTz);
  const startMs = roughStartUtc.getTime() - startOffsetMs;

  const roughNextDayUtc = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0, 0));
  const nextOffsetMs = getTimezoneOffsetMs(roughNextDayUtc, resolvedTz);
  const endMs = roughNextDayUtc.getTime() - nextOffsetMs - 1;

  return {
    timezone: resolvedTz,
    dateKey,
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
    startMs,
    endMs,
  };
}

export function isTimestampInOutletLocalToday(
  timestamp: string | number | Date | null | undefined,
  timezone = DEFAULT_OUTLET_TIMEZONE,
  now = new Date()
): boolean {
  if (timestamp === null || timestamp === undefined) return false;
  const parsed = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return false;
  const bounds = getOutletLocalDayBounds(timezone, now);
  const ms = parsed.getTime();
  return ms >= bounds.startMs && ms <= bounds.endMs;
}

/**
 * RBAC check for Edit / Void bill operations.
 * Allowed: SUPERADMIN, ADMIN, and authorized MANAGER / OWNER (mapped to ADMIN in SMAV).
 * Blocked: POS_BILLING, STAFF, STYLIST, RECEPTIONIST, INVENTORY_STAFF.
 */
export function canModifyBills(session?: {
  role?: string | null;
  displayRole?: string | null;
  outletRole?: string | null;
  sourceRole?: string | null;
} | null): boolean {
  if (!session) return false;
  const role = String(session.role || '').trim().toLowerCase();
  const displayRole = String(session.displayRole || '').trim().toUpperCase();
  const outletRole = String(session.outletRole || '').trim().toUpperCase();

  if (role === 'superadmin' || displayRole === 'SUPERADMIN') return true;
  if (role === 'admin' || displayRole === 'ADMIN' || outletRole === 'ADMIN') return true;
  if (outletRole === 'MANAGER' || outletRole === 'OWNER' || displayRole === 'MANAGER') return true;
  return false;
}

export function extractStylistNames(items: LedgerBillItem[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const item of items) {
    const raw = String(item.stylistName || '').trim();
    if (!raw || raw.toLowerCase() === 'unassigned') continue;
    const key = raw.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      names.push(raw);
    }
  }
  return names;
}

export function normalizeRawBillItems(rawItems: unknown): LedgerBillItem[] {
  if (!Array.isArray(rawItems)) return [];
  const normalized: LedgerBillItem[] = [];
  for (const entry of rawItems) {
    if (!entry || typeof entry !== 'object') continue;
    const obj = entry as Record<string, unknown>;
    const name = String(
      obj.service_name || obj.serviceName || obj.name || obj.item_name || obj.itemName || 'Item'
    ).trim();
    const qtyRaw = Number(obj.quantity ?? obj.qty ?? 1);
    const quantity = Number.isFinite(qtyRaw) && qtyRaw > 0 ? Math.round(qtyRaw) : 1;
    const unitPriceRaw = Number(obj.unit_price ?? obj.unitPrice ?? obj.price ?? obj.basePrice ?? 0);
    const unitPrice = Number.isFinite(unitPriceRaw) && unitPriceRaw >= 0 ? roundCurrency(unitPriceRaw) : 0;
    const discountPercentRaw = Number(obj.discount_percent ?? obj.discountPercent ?? 0);
    const discountPercent =
      Number.isFinite(discountPercentRaw) && discountPercentRaw >= 0 && discountPercentRaw <= 100
        ? roundCurrency(discountPercentRaw)
        : 0;
    const computedLine = roundCurrency(quantity * unitPrice * (1 - discountPercent / 100));
    const explicitLineRaw = Number(obj.line_total ?? obj.lineTotal ?? obj.total);
    const lineTotal =
      Number.isFinite(explicitLineRaw) && explicitLineRaw >= 0 ? roundCurrency(explicitLineRaw) : computedLine;

    const stylistId = String(obj.stylist_id || obj.stylistId || '').trim() || null;
    const stylistName = String(obj.stylist_name || obj.stylistName || '').trim() || null;
    const variantName = String(obj.variant_name || obj.variantName || '').trim() || null;
    const gstRaw = Number(obj.gst_percent ?? obj.gstPercent);

    normalized.push({
      id: String(obj.service_id || obj.serviceId || obj.menu_item_id || obj.product_id || obj.id || '').trim() || undefined,
      name,
      quantity,
      unitPrice,
      lineTotal,
      stylistId,
      stylistName,
      discountPercent: discountPercent || undefined,
      gstPercent: Number.isFinite(gstRaw) && gstRaw >= 0 ? gstRaw : undefined,
      variantName,
    });
  }
  return normalized;
}

export interface RecalculatedBillTotals {
  items: LedgerBillItem[];
  subtotal: number;
  discountAmount: number;
  totalTax: number;
  cgst: number;
  sgst: number;
  grandTotal: number;
  stylistNames: string[];
}

export function recalculateBillTotals(params: {
  businessType?: string;
  items: Array<{
    id?: string;
    name: string;
    quantity: number;
    unitPrice: number;
    stylistId?: string | null;
    stylistName?: string | null;
    discountPercent?: number;
    gstPercent?: number;
    variantName?: string | null;
  }>;
  discountAmount?: number;
}): RecalculatedBillTotals {
  if (!Array.isArray(params.items) || params.items.length === 0) {
    throw new Error('At least one line item is required when editing a bill.');
  }

  const category = String(params.businessType || 'salon').trim().toLowerCase();
  const defaultGstPercent = TAX_RATE_BY_CATEGORY[category] ?? 18;

  let grossSubtotal = 0;
  let itemDiscountTotal = 0;
  let totalTax = 0;

  const cleanItems: LedgerBillItem[] = params.items.map((item) => {
    const name = String(item.name || '').trim();
    if (!name) throw new Error('Every line item must have a valid name.');
    const quantity = Math.round(Number(item.quantity));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`Invalid quantity for "${name}". Must be at least 1.`);
    }
    const unitPrice = roundCurrency(Number(item.unitPrice));
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new Error(`Invalid unit price for "${name}". Must be 0 or greater.`);
    }
    const discountPercent =
      item.discountPercent !== undefined && Number.isFinite(Number(item.discountPercent))
        ? Math.min(100, Math.max(0, roundCurrency(Number(item.discountPercent))))
        : 0;

    const lineGross = roundCurrency(quantity * unitPrice);
    const lineDisc = roundCurrency(lineGross * (discountPercent / 100));
    const lineNet = roundCurrency(lineGross - lineDisc);
    const gstPercent =
      item.gstPercent !== undefined && Number.isFinite(Number(item.gstPercent)) && Number(item.gstPercent) >= 0
        ? Number(item.gstPercent)
        : defaultGstPercent;

    grossSubtotal = roundCurrency(grossSubtotal + lineGross);
    itemDiscountTotal = roundCurrency(itemDiscountTotal + lineDisc);

    return {
      id: item.id ? String(item.id).trim() : undefined,
      name,
      quantity,
      unitPrice,
      lineTotal: lineNet,
      stylistId: item.stylistId ? String(item.stylistId).trim() : null,
      stylistName: item.stylistName ? String(item.stylistName).trim() : null,
      discountPercent: discountPercent || undefined,
      gstPercent,
      variantName: item.variantName ? String(item.variantName).trim() : null,
    };
  });

  const billLevelDiscount =
    params.discountAmount !== undefined && Number.isFinite(Number(params.discountAmount))
      ? Math.max(0, roundCurrency(Number(params.discountAmount)))
      : 0;

  const netAfterLineDiscounts = roundCurrency(Math.max(0, grossSubtotal - itemDiscountTotal));
  const cappedBillDiscount = Math.min(netAfterLineDiscounts, billLevelDiscount);
  const totalDiscountAmount = roundCurrency(itemDiscountTotal + cappedBillDiscount);
  const taxableTotal = roundCurrency(Math.max(0, grossSubtotal - totalDiscountAmount));

  // Distribute bill-level discount proportionally across lines when computing GST
  const discountRatio = netAfterLineDiscounts > 0 ? taxableTotal / netAfterLineDiscounts : 1;
  for (const line of cleanItems) {
    const lineTaxable = roundCurrency(line.lineTotal * discountRatio);
    const rate = line.gstPercent ?? defaultGstPercent;
    totalTax = roundCurrency(totalTax + lineTaxable * (rate / 100));
  }

  const cgst = roundCurrency(totalTax / 2);
  const sgst = roundCurrency(totalTax - cgst);
  const grandTotal = roundCurrency(taxableTotal + totalTax);

  return {
    items: cleanItems,
    subtotal: grossSubtotal,
    discountAmount: totalDiscountAmount,
    totalTax,
    cgst,
    sgst,
    grandTotal,
    stylistNames: extractStylistNames(cleanItems),
  };
}

export function validateBillMutationConflict(params: {
  currentIsVoided: boolean;
  currentEditVersion: number;
  expectedEditVersion?: number | null;
}): { conflict: false } | { conflict: true; code: 'ALREADY_VOIDED' | 'VERSION_CONFLICT'; message: string } {
  if (params.currentIsVoided) {
    return {
      conflict: true,
      code: 'ALREADY_VOIDED',
      message: 'Conflict: This bill has already been voided and cannot be modified.',
    };
  }
  if (
    params.expectedEditVersion !== undefined &&
    params.expectedEditVersion !== null &&
    Number.isFinite(Number(params.expectedEditVersion)) &&
    Number(params.expectedEditVersion) !== params.currentEditVersion
  ) {
    return {
      conflict: true,
      code: 'VERSION_CONFLICT',
      message: `Conflict: Bill was updated remotely (server version v${params.currentEditVersion}, expected v${params.expectedEditVersion}). Refresh ledger and review before retrying.`,
    };
  }
  return { conflict: false };
}

export function normalizeLedgerBillRow(
  row: Record<string, any>,
  sourceTable: 'smav_salon_bills' | 'smav_central_sales' | 'memory',
  fallbackOutletId: string
): TransactionLedgerEntry {
  const details = row.details && typeof row.details === 'object' ? row.details : {};
  const items = normalizeRawBillItems(row.items ?? details.items ?? []);
  const grandTotal = roundCurrency(Number(row.grand_total ?? row.grandTotal ?? 0));
  const rawSubtotal = row.subtotal !== undefined && row.subtotal !== null ? Number(row.subtotal) : NaN;
  const computedItemsSum = roundCurrency(items.reduce((acc, i) => acc + i.lineTotal, 0));
  const subtotal = Number.isFinite(rawSubtotal) ? roundCurrency(rawSubtotal) : computedItemsSum || grandTotal;
  const discountAmount = roundCurrency(Number(row.discount_amount ?? row.discountAmount ?? details.discount ?? 0));
  const totalTax = roundCurrency(
    Number(
      row.total_tax ??
        row.totalTax ??
        details.total_tax ??
        details.totalTax ??
        Math.max(0, grandTotal - Math.max(0, subtotal - discountAmount))
    )
  );

  const rawCustomerName = String(
    row.customer_name || row.customerName || row.table_or_counter || details.customerName || 'Walk-in Guest'
  ).trim();
  const rawCustomerPhone = String(
    row.customer_phone || row.customerPhone || details.customerPhone || ''
  ).trim();
  const createdAt = String(
    row.created_at || row.billed_at || row.createdAt || row.created_at_server || new Date().toISOString()
  );

  const rawBillNumber = String(row.central_bill_number || row.centralBillNumber || row.bill_number || row.billNumber || row.order_number || row.orderNumber || row.id || '');
  const centralBillNumber = row.central_bill_number || row.centralBillNumber || null;
  const branchCode = String(row.branch_code || row.branchCode || details.branch_code || details.branchCode || '').trim().toUpperCase() || null;
  const branchName =
    String(row.branch_name || row.branchName || details.branch_name || details.branchName || '').trim() ||
    (branchCode === 'GACHI' ? 'Gachibowli' : branchCode === 'KONDA' ? 'Kondapur' : null);

  return {
    id: String(row.id || rawBillNumber || ''),
    sourceTable,
    outletId: String(row.outlet_id || row.outletId || fallbackOutletId),
    billNumber: rawBillNumber,
    centralBillId: row.central_bill_id || row.centralBillId || null,
    centralBillNumber: centralBillNumber ? String(centralBillNumber) : null,
    branchId: row.branch_id || row.branchId || null,
    branchCode,
    branchName,
    sourceSystem: row.source_system || row.sourceSystem || null,
    isLegacyBill: !centralBillNumber && !/^TGL-(GACHI|KONDA)-\d{8}-\d{4,}$/i.test(rawBillNumber),
    idempotencyKey: row.idempotency_key || row.idempotencyKey || undefined,
    customerName: rawCustomerName || 'Walk-in Guest',
    customerPhone: rawCustomerPhone,
    items,
    paymentMode: String(row.payment_mode || row.paymentMode || 'cash').trim().toLowerCase(),
    subtotal,
    discountAmount,
    totalTax,
    grandTotal,
    createdAt,
    stylistNames: extractStylistNames(items),
    editVersion: Math.max(1, Number(row.edit_version ?? row.editVersion ?? 1)),
    isVoided: Boolean(row.is_voided ?? row.isVoided ?? false),
    editedAt: row.edited_at || row.editedAt || null,
    editReason: row.edit_reason || row.editReason || null,
    voidedAt: row.voided_at || row.voidedAt || null,
    voidReason: row.void_reason || row.voidReason || null,
    editHistory: Array.isArray(row.edit_history)
      ? row.edit_history
      : Array.isArray(row.editHistory)
        ? row.editHistory
        : undefined,
  };
}
