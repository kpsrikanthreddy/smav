import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Edit2,
  Eye,
  Printer,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  Stylist,
  TransactionLedgerEntry,
  TransactionLedgerItem,
  UserSession,
  getVisibleRole,
} from '../types';
import { BASE_INPUT_CLASS, Button, Card, EmptyState, ResponsiveTable } from './ui';

interface TransactionLedgerProps {
  session: UserSession;
  refreshTrigger?: number;
  stylists?: Stylist[];
  onPrintCopy?: (entry: TransactionLedgerEntry) => void;
  onLedgerMutated?: () => void;
  compact?: boolean;
}

interface EditableItemDraft {
  id?: string;
  name: string;
  quantity: number;
  unitPrice: number;
  stylistId: string;
  stylistName: string;
  discountPercent: number;
  gstPercent?: number;
  variantName?: string | null;
}

const DEFAULT_GST_BY_CATEGORY: Record<string, number> = {
  salon: 18,
  restaurant: 5,
  retail: 12,
  other: 0,
};

function round2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

function formatOutletDateTime(iso: string, timezone = 'Asia/Kolkata'): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso || '—';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: timezone,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

export const TransactionLedger: React.FC<TransactionLedgerProps> = ({
  session,
  refreshTrigger = 0,
  stylists = [],
  onPrintCopy,
  onLedgerMutated,
  compact = false,
}) => {
  const [entries, setEntries] = useState<TransactionLedgerEntry[]>([]);
  const [timezone, setTimezone] = useState<string>('Asia/Kolkata');
  const [dateKey, setDateKey] = useState<string>('');
  const [serverCanModify, setServerCanModify] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Clickable Services / Items Detail Modal
  const [detailEntry, setDetailEntry] = useState<TransactionLedgerEntry | null>(null);

  // Authorized Edit Modal state
  const [editTarget, setEditTarget] = useState<TransactionLedgerEntry | null>(null);
  const [editCustomerName, setEditCustomerName] = useState('');
  const [editCustomerPhone, setEditCustomerPhone] = useState('');
  const [editPaymentMode, setEditPaymentMode] = useState('upi');
  const [editDiscountAmount, setEditDiscountAmount] = useState('0');
  const [editReason, setEditReason] = useState('');
  const [editItems, setEditItems] = useState<EditableItemDraft[]>([]);
  const [editError, setEditError] = useState<string | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Authorized Void (Audited Soft-Delete) Modal state
  const [voidTarget, setVoidTarget] = useState<TransactionLedgerEntry | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidConfirmed, setVoidConfirmed] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);
  const [isVoiding, setIsVoiding] = useState(false);

  // Role check: SUPERADMIN, ADMIN, and authorized MANAGER (mapped to admin) can edit/void. POS_BILLING cannot.
  const roleAllowedInUi =
    session.role === 'superadmin' ||
    session.role === 'admin' ||
    getVisibleRole(session.displayRole || session.role) === 'SUPERADMIN' ||
    getVisibleRole(session.displayRole || session.role) === 'ADMIN';
  const canModify = roleAllowedInUi && serverCanModify;

  const loadLedger = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/pos/ledger/today?timezone=Asia%2FKolkata', {
        headers: { Authorization: `Bearer ${session.token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        throw new Error(data.message || `Failed to load today's ledger (HTTP ${res.status})`);
      }
      setEntries(Array.isArray(data.bills) ? data.bills : []);
      if (data.timezone) setTimezone(data.timezone);
      if (data.dateKey) setDateKey(data.dateKey);
      setServerCanModify(Boolean(data.canModifyBills));
    } catch (err: any) {
      setError(err?.message || "Could not load today's transaction ledger.");
    } finally {
      setLoading(false);
    }
  }, [session.token, session.activeOutlet.id]);

  useEffect(() => {
    void loadLedger();
  }, [loadLedger, refreshTrigger]);

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((row) => {
      const itemsText = row.items.map((i) => i.name).join(' ').toLowerCase();
      const stylistsText = row.stylistNames.join(' ').toLowerCase();
      return (
        row.billNumber.toLowerCase().includes(q) ||
        (row.centralBillNumber || '').toLowerCase().includes(q) ||
        (row.branchName || '').toLowerCase().includes(q) ||
        (row.branchCode || '').toLowerCase().includes(q) ||
        row.customerName.toLowerCase().includes(q) ||
        row.customerPhone.toLowerCase().includes(q) ||
        row.paymentMode.toLowerCase().includes(q) ||
        itemsText.includes(q) ||
        stylistsText.includes(q)
      );
    });
  }, [entries, searchQuery]);

  const todayTotal = useMemo(
    () => round2(filteredEntries.reduce((acc, e) => acc + (Number(e.grandTotal) || 0), 0)),
    [filteredEntries]
  );

  const openEditModal = (entry: TransactionLedgerEntry) => {
    if (!canModify) return;
    setEditTarget(entry);
    setEditCustomerName(entry.customerName);
    setEditCustomerPhone(entry.customerPhone || '');
    setEditPaymentMode(entry.paymentMode || 'upi');
    setEditDiscountAmount(String(entry.discountAmount || 0));
    setEditReason('');
    setEditError(null);
    setEditItems(
      entry.items.map((it) => ({
        id: it.id,
        name: it.name,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        stylistId: it.stylistId || '',
        stylistName: it.stylistName || '',
        discountPercent: it.discountPercent || 0,
        gstPercent: it.gstPercent,
        variantName: it.variantName,
      }))
    );
  };

  const editPreviewTotals = useMemo(() => {
    const defaultGst = DEFAULT_GST_BY_CATEGORY[session.activeOutlet.category] ?? 18;
    let gross = 0;
    let lineDiscount = 0;
    const lineNets: Array<{ net: number; gst: number }> = [];

    for (const it of editItems) {
      const qty = Math.max(1, Math.round(Number(it.quantity) || 1));
      const price = Math.max(0, Number(it.unitPrice) || 0);
      const discPct = Math.min(100, Math.max(0, Number(it.discountPercent) || 0));
      const lineGross = round2(qty * price);
      const disc = round2(lineGross * (discPct / 100));
      const net = round2(lineGross - disc);
      gross = round2(gross + lineGross);
      lineDiscount = round2(lineDiscount + disc);
      lineNets.push({ net, gst: it.gstPercent ?? defaultGst });
    }

    const billDiscInput = Math.max(0, Number(editDiscountAmount) || 0);
    const netAfterLine = round2(Math.max(0, gross - lineDiscount));
    const appliedBillDisc = Math.min(netAfterLine, billDiscInput);
    const totalDiscount = round2(lineDiscount + appliedBillDisc);
    const taxable = round2(Math.max(0, gross - totalDiscount));
    const ratio = netAfterLine > 0 ? taxable / netAfterLine : 1;

    let totalTax = 0;
    for (const ln of lineNets) {
      totalTax = round2(totalTax + round2(ln.net * ratio) * (ln.gst / 100));
    }
    const grandTotal = round2(taxable + totalTax);
    return { subtotal: gross, discountAmount: totalDiscount, totalTax, grandTotal };
  }, [editItems, editDiscountAmount, session.activeOutlet.category]);

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget || !canModify) return;
    if (editItems.length === 0) {
      setEditError('At least one service or item is required.');
      return;
    }
    if (editReason.trim().length < 5) {
      setEditError('Please enter an audit reason (at least 5 characters).');
      return;
    }

    setIsSavingEdit(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/pos/bills/${encodeURIComponent(editTarget.id || editTarget.billNumber)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({
          customerName: editCustomerName.trim() || 'Walk-in Guest',
          customerPhone: editCustomerPhone.trim(),
          paymentMode: editPaymentMode,
          discountAmount: Math.max(0, Number(editDiscountAmount) || 0),
          reason: editReason.trim(),
          expectedEditVersion: editTarget.editVersion,
          items: editItems.map((it) => ({
            id: it.id,
            name: it.name,
            quantity: Math.max(1, Math.round(Number(it.quantity) || 1)),
            unitPrice: Math.max(0, Number(it.unitPrice) || 0),
            stylistId: it.stylistId || null,
            stylistName: it.stylistName || null,
            discountPercent: it.discountPercent || 0,
            gstPercent: it.gstPercent,
            variantName: it.variantName,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        throw new Error(data.message || `Failed to edit bill (HTTP ${res.status})`);
      }
      setEditTarget(null);
      setBannerMessage(data.message || `Bill ${editTarget.billNumber} updated.`);
      await loadLedger();
      onLedgerMutated?.();
    } catch (err: any) {
      setEditError(err?.message || 'Could not update bill.');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleConfirmVoid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!voidTarget || !canModify) return;
    if (!voidConfirmed) {
      setVoidError('Please confirm that you want to void this bill.');
      return;
    }
    if (voidReason.trim().length < 5) {
      setVoidError('Please enter a mandatory void reason (at least 5 characters).');
      return;
    }

    setIsVoiding(true);
    setVoidError(null);
    try {
      const res = await fetch(`/api/pos/bills/${encodeURIComponent(voidTarget.id || voidTarget.billNumber)}/void`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({
          reason: voidReason.trim(),
          expectedEditVersion: voidTarget.editVersion,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        throw new Error(data.message || `Failed to void bill (HTTP ${res.status})`);
      }
      setVoidTarget(null);
      setVoidReason('');
      setVoidConfirmed(false);
      setBannerMessage(data.message || `Bill ${voidTarget.billNumber} voided.`);
      await loadLedger();
      onLedgerMutated?.();
    } catch (err: any) {
      setVoidError(err?.message || 'Could not void bill.');
    } finally {
      setIsVoiding(false);
    }
  };

  const renderItemsSummaryButton = (entry: TransactionLedgerEntry) => {
    const firstItem = entry.items[0]?.name || 'View details';
    const extraCount = Math.max(0, entry.items.length - 1);
    return (
      <button
        type="button"
        onClick={() => setDetailEntry(entry)}
        className="inline-flex items-center gap-1.5 text-left rounded-lg border border-[#E5E7EC] bg-[#F5F6FA] hover:bg-[#FFF1F7] hover:border-[#FF1B7A]/40 px-2.5 py-1.5 text-xs font-medium text-[#2F3033] transition cursor-pointer max-w-[240px]"
        title="Click to inspect item quantity, price, and stylist details"
      >
        <Eye className="w-3.5 h-3.5 text-[#FF1B7A] shrink-0" />
        <span className="truncate">
          {firstItem}
          {extraCount > 0 ? ` +${extraCount} more` : ''}
        </span>
      </button>
    );
  };

  return (
    <Card padding={compact ? 'sm' : 'md'} className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-[#2F3033]">
            Transaction Ledger — Today Only
          </h3>
          <p className="text-xs text-[#6F737D]">
            {dateKey ? `${dateKey} (${timezone})` : timezone} · {filteredEntries.length} bill
            {filteredEntries.length === 1 ? '' : 's'} · ₹{todayTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            <span className="ml-1.5 text-[#8A8F99]">· Historical bills remain preserved in Reports.</span>
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#8A8F99] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search bill, guest, phone, stylist…"
              className="min-h-[38px] pl-8 pr-3 rounded-xl bg-[#F5F6FA] border border-[#E5E7EC] text-xs text-[#2F3033] focus:outline-none focus:bg-white focus:border-[#FF1B7A] w-56 sm:w-64"
            />
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void loadLedger()}
            disabled={loading}
            leftIcon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
          >
            Refresh
          </Button>
        </div>
      </div>

      {bannerMessage && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-[#BBF7D0] bg-[#ECFDF5] px-3.5 py-2.5 text-xs font-medium text-[#15803D]">
          <span>{bannerMessage}</span>
          <button
            type="button"
            onClick={() => setBannerMessage(null)}
            className="text-[#15803D] hover:opacity-75 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3.5 py-2.5 text-xs font-medium text-[#B91C1C]">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && entries.length === 0 ? (
        <div className="py-10 text-center text-xs text-[#6F737D]">Loading today&apos;s bills…</div>
      ) : filteredEntries.length === 0 ? (
        <EmptyState
          title="No bills recorded for today yet"
          description="Bills generated today in this outlet's local timezone will appear here automatically."
        />
      ) : (
        <ResponsiveTable
          columns={[
            {
              key: 'billNumber',
              header: 'Bill No',
              render: (row) => (
                <div className="space-y-0.5 whitespace-nowrap">
                  <div className="font-mono font-bold text-xs text-[#2F3033]">
                    {row.centralBillNumber || row.billNumber}
                    {row.editVersion > 1 && (
                      <span className="ml-1.5 text-[10px] font-sans font-semibold text-[#6F737D]">
                        (v{row.editVersion})
                      </span>
                    )}
                  </div>
                  {(row.branchName || row.branchCode || row.isLegacyBill) && (
                    <div className="flex items-center gap-1.5 text-[10px] text-[#6F737D]">
                      {(row.branchName || row.branchCode) && (
                        <span>{row.branchName || row.branchCode}</span>
                      )}
                      {row.isLegacyBill && (
                        <span className="font-semibold text-[#B45309]">· Legacy</span>
                      )}
                    </div>
                  )}
                </div>
              ),
            },
            {
              key: 'customerName',
              header: 'Customer Name',
              render: (row) => (
                <span className="font-medium text-xs text-[#2F3033]">{row.customerName}</span>
              ),
            },
            {
              key: 'customerPhone',
              header: 'Phone',
              render: (row) => (
                <span className="text-xs text-[#6F737D] tabular-nums whitespace-nowrap">
                  {row.customerPhone || '—'}
                </span>
              ),
            },
            {
              key: 'items',
              header: 'Services / Items',
              render: (row) => renderItemsSummaryButton(row),
            },
            {
              key: 'paymentMode',
              header: 'Payment Mode',
              render: (row) => (
                <span className="text-xs font-semibold uppercase text-[#2F3033] whitespace-nowrap">
                  {row.paymentMode}
                </span>
              ),
            },
            {
              key: 'grandTotal',
              header: 'Amount',
              align: 'right',
              render: (row) => (
                <span className="text-xs font-bold text-[#2F3033] tabular-nums whitespace-nowrap">
                  ₹{Number(row.grandTotal || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              ),
            },
            {
              key: 'createdAt',
              header: 'Date / Time',
              render: (row) => (
                <span className="text-xs text-[#6F737D] whitespace-nowrap">
                  {formatOutletDateTime(row.createdAt, timezone)}
                </span>
              ),
            },
            {
              key: 'stylistNames',
              header: 'Stylist Names',
              render: (row) => (
                <span className="text-xs text-[#2F3033]">
                  {row.stylistNames.length > 0 ? row.stylistNames.join(', ') : '—'}
                </span>
              ),
            },
            {
              key: 'actions',
              header: 'Actions',
              align: 'right',
              render: (row) => (
                <div className="inline-flex items-center justify-end gap-1.5">
                  {onPrintCopy && (
                    <button
                      type="button"
                      onClick={() => onPrintCopy(row)}
                      title="Print Copy"
                      className="min-h-[32px] inline-flex items-center gap-1 rounded-lg border border-[#E5E7EC] bg-white hover:bg-[#F5F6FA] px-2 py-1 text-[11px] font-semibold text-[#2F3033] transition cursor-pointer"
                    >
                      <Printer className="w-3.5 h-3.5 text-[#FF1B7A]" />
                      <span className="hidden xl:inline">Print</span>
                    </button>
                  )}
                  {canModify && (
                    <>
                      <button
                        type="button"
                        onClick={() => openEditModal(row)}
                        title="Edit Bill"
                        className="min-h-[32px] inline-flex items-center gap-1 rounded-lg border border-[#E5E7EC] bg-white hover:bg-[#EFF6FF] hover:border-[#BFDBFE] hover:text-[#1D4ED8] px-2 py-1 text-[11px] font-semibold text-[#2F3033] transition cursor-pointer"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        <span className="hidden xl:inline">Edit</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setVoidTarget(row);
                          setVoidReason('');
                          setVoidConfirmed(false);
                          setVoidError(null);
                        }}
                        title="Void Bill (Audited Soft-Delete)"
                        className="min-h-[32px] inline-flex items-center gap-1 rounded-lg border border-[#FECACA] bg-[#FEF2F2] hover:bg-[#FEE2E2] px-2 py-1 text-[11px] font-semibold text-[#B91C1C] transition cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span className="hidden xl:inline">Void</span>
                      </button>
                    </>
                  )}
                </div>
              ),
            },
          ]}
          rows={filteredEntries}
          keyExtractor={(row) => `${row.id}-${row.billNumber}`}
          renderMobileCard={(row) => (
            <div className="space-y-2.5 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-mono font-bold text-[#2F3033]">
                    {row.centralBillNumber || row.billNumber}
                  </div>
                  {(row.branchName || row.branchCode) && (
                    <div className="text-[11px] text-[#6F737D]">
                      Branch: {row.branchName || row.branchCode}
                      {row.isLegacyBill ? ' · Legacy' : ''}
                    </div>
                  )}
                  <div className="text-[#2F3033] font-medium mt-0.5">{row.customerName}</div>
                  {row.customerPhone && (
                    <div className="text-[#6F737D] tabular-nums">{row.customerPhone}</div>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold text-[#2F3033] tabular-nums">
                    ₹{Number(row.grandTotal || 0).toFixed(2)}
                  </div>
                  <div className="text-[11px] font-semibold uppercase text-[#6F737D]">
                    {row.paymentMode}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2">
                {renderItemsSummaryButton(row)}
                <span className="text-[11px] text-[#6F737D]">
                  {formatOutletDateTime(row.createdAt, timezone)}
                </span>
              </div>

              {row.stylistNames.length > 0 && (
                <div className="text-[11px] text-[#6F737D]">
                  Stylists: <span className="font-medium text-[#2F3033]">{row.stylistNames.join(', ')}</span>
                </div>
              )}

              <div className="flex items-center gap-2 pt-1 border-t border-[#F0F1F5]">
                {onPrintCopy && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onPrintCopy(row)}
                    leftIcon={<Printer className="w-3.5 h-3.5" />}
                  >
                    Print Copy
                  </Button>
                )}
                {canModify && (
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => openEditModal(row)}
                      leftIcon={<Edit2 className="w-3.5 h-3.5" />}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => {
                        setVoidTarget(row);
                        setVoidReason('');
                        setVoidConfirmed(false);
                        setVoidError(null);
                      }}
                      leftIcon={<Trash2 className="w-3.5 h-3.5" />}
                    >
                      Void
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
        />
      )}

      {/* Clickable Services/Items Detail Modal */}
      {detailEntry && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px] flex items-center justify-center p-4"
          onClick={() => setDetailEntry(null)}
        >
          <div
            className="bg-white rounded-2xl border border-[#E5E7EC] shadow-xl max-w-xl w-full p-5 space-y-4 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-[#F0F1F5] pb-3">
              <div>
                <h4 className="text-base font-bold text-[#2F3033]">
                  Bill Details · {detailEntry.centralBillNumber || detailEntry.billNumber}
                </h4>
                <p className="text-xs text-[#6F737D] mt-0.5">
                  {detailEntry.branchName || detailEntry.branchCode
                    ? `Branch: ${detailEntry.branchName || detailEntry.branchCode} · `
                    : ''}
                  {detailEntry.customerName}
                  {detailEntry.customerPhone ? ` · ${detailEntry.customerPhone}` : ''} ·{' '}
                  {formatOutletDateTime(detailEntry.createdAt, timezone)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailEntry(null)}
                className="p-1.5 rounded-lg text-[#6F737D] hover:bg-[#F5F6FA] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-x-auto border border-[#E5E7EC] rounded-xl">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#F5F6FA] text-[#6F737D] font-semibold">
                  <tr>
                    <th className="px-3 py-2">Service / Item</th>
                    <th className="px-3 py-2 text-center">Qty</th>
                    <th className="px-3 py-2 text-right">Unit Price</th>
                    <th className="px-3 py-2">Stylist</th>
                    <th className="px-3 py-2 text-right">Line Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F0F1F5]">
                  {detailEntry.items.map((item: TransactionLedgerItem, idx: number) => (
                    <tr key={`${item.name}-${idx}`}>
                      <td className="px-3 py-2 font-medium text-[#2F3033]">
                        {item.name}
                        {item.variantName ? (
                          <span className="text-[11px] text-[#6F737D] ml-1">({item.variantName})</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums">{item.quantity}</td>
                      <td className="px-3 py-2 text-right tabular-nums">₹{item.unitPrice.toFixed(2)}</td>
                      <td className="px-3 py-2 text-[#6F737D]">{item.stylistName || '—'}</td>
                      <td className="px-3 py-2 text-right font-semibold text-[#2F3033] tabular-nums">
                        ₹{item.lineTotal.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bg-[#F5F6FA] rounded-xl p-3 text-xs space-y-1">
              <div className="flex justify-between text-[#6F737D]">
                <span>Subtotal</span>
                <span className="tabular-nums">₹{detailEntry.subtotal.toFixed(2)}</span>
              </div>
              {detailEntry.discountAmount > 0 && (
                <div className="flex justify-between text-[#15803D]">
                  <span>Discount</span>
                  <span className="tabular-nums">-₹{detailEntry.discountAmount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-[#6F737D]">
                <span>Tax (GST)</span>
                <span className="tabular-nums">₹{detailEntry.totalTax.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-bold text-[#2F3033] pt-1.5 border-t border-[#E5E7EC] text-sm">
                <span>Grand Total ({detailEntry.paymentMode.toUpperCase()})</span>
                <span className="tabular-nums">₹{detailEntry.grandTotal.toFixed(2)}</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              {onPrintCopy && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onPrintCopy(detailEntry)}
                  leftIcon={<Printer className="w-3.5 h-3.5" />}
                >
                  Print Copy
                </Button>
              )}
              <Button size="sm" onClick={() => setDetailEntry(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Authorized Edit Bill Modal */}
      {editTarget && canModify && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px] flex items-center justify-center p-4"
          onClick={() => !isSavingEdit && setEditTarget(null)}
        >
          <form
            onSubmit={handleSaveEdit}
            className="bg-white rounded-2xl border border-[#E5E7EC] shadow-xl max-w-2xl w-full p-5 space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-[#F0F1F5] pb-3">
              <div>
                <h4 className="text-base font-bold text-[#2F3033]">
                  Edit Bill · {editTarget.billNumber}
                </h4>
                <p className="text-xs text-[#6F737D]">
                  Original bill number, payment history, and prior audit snapshot will be preserved.
                </p>
              </div>
              <button
                type="button"
                disabled={isSavingEdit}
                onClick={() => setEditTarget(null)}
                className="p-1.5 rounded-lg text-[#6F737D] hover:bg-[#F5F6FA] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {editError && (
              <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-xs font-medium text-[#B91C1C]">
                {editError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-[#6F737D] mb-1">
                  Customer Name
                </label>
                <input
                  type="text"
                  value={editCustomerName}
                  onChange={(e) => setEditCustomerName(e.target.value)}
                  className={BASE_INPUT_CLASS}
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#6F737D] mb-1">
                  Phone
                </label>
                <input
                  type="text"
                  value={editCustomerPhone}
                  onChange={(e) => setEditCustomerPhone(e.target.value)}
                  className={BASE_INPUT_CLASS}
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#6F737D] mb-1">
                  Payment Mode
                </label>
                <select
                  value={editPaymentMode}
                  onChange={(e) => setEditPaymentMode(e.target.value)}
                  className={BASE_INPUT_CLASS}
                >
                  <option value="upi">UPI</option>
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="split">Split</option>
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-bold text-[#2F3033]">Line Items</div>
              <div className="space-y-2">
                {editItems.map((item, idx) => (
                  <div
                    key={`${item.name}-${idx}`}
                    className="grid grid-cols-12 gap-2 items-center bg-[#F5F6FA] border border-[#E5E7EC] rounded-xl p-2.5"
                  >
                    <div className="col-span-12 sm:col-span-4">
                      <div className="text-xs font-semibold text-[#2F3033] truncate">{item.name}</div>
                    </div>
                    <div className="col-span-4 sm:col-span-2">
                      <label className="block text-[10px] text-[#6F737D]">Qty</label>
                      <input
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(e) => {
                          const qty = Math.max(1, Number(e.target.value) || 1);
                          setEditItems((prev) =>
                            prev.map((p, i) => (i === idx ? { ...p, quantity: qty } : p))
                          );
                        }}
                        className="w-full rounded-lg border border-[#E5E7EC] bg-white px-2 py-1 text-xs"
                      />
                    </div>
                    <div className="col-span-4 sm:col-span-2">
                      <label className="block text-[10px] text-[#6F737D]">Unit ₹</label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={item.unitPrice}
                        onChange={(e) => {
                          const price = Math.max(0, Number(e.target.value) || 0);
                          setEditItems((prev) =>
                            prev.map((p, i) => (i === idx ? { ...p, unitPrice: price } : p))
                          );
                        }}
                        className="w-full rounded-lg border border-[#E5E7EC] bg-white px-2 py-1 text-xs"
                      />
                    </div>
                    <div className="col-span-4 sm:col-span-3">
                      <label className="block text-[10px] text-[#6F737D]">Stylist</label>
                      {stylists.length > 0 ? (
                        <select
                          value={item.stylistId || ''}
                          onChange={(e) => {
                            const selected = stylists.find((s) => s.id === e.target.value);
                            setEditItems((prev) =>
                              prev.map((p, i) =>
                                i === idx
                                  ? {
                                      ...p,
                                      stylistId: selected?.id || '',
                                      stylistName: selected?.name || '',
                                    }
                                  : p
                              )
                            );
                          }}
                          className="w-full rounded-lg border border-[#E5E7EC] bg-white px-2 py-1 text-xs"
                        >
                          <option value="">Unassigned</option>
                          {stylists.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={item.stylistName}
                          onChange={(e) => {
                            const val = e.target.value;
                            setEditItems((prev) =>
                              prev.map((p, i) => (i === idx ? { ...p, stylistName: val } : p))
                            );
                          }}
                          placeholder="Stylist"
                          className="w-full rounded-lg border border-[#E5E7EC] bg-white px-2 py-1 text-xs"
                        />
                      )}
                    </div>
                    <div className="col-span-12 sm:col-span-1 flex justify-end">
                      {editItems.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setEditItems((prev) => prev.filter((_, i) => i !== idx))}
                          className="p-1.5 rounded-lg text-[#B91C1C] hover:bg-[#FEE2E2] cursor-pointer"
                          title="Remove item"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
              <div>
                <label className="block text-[11px] font-semibold text-[#6F737D] mb-1">
                  Bill Discount (₹)
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={editDiscountAmount}
                  onChange={(e) => setEditDiscountAmount(e.target.value)}
                  className={BASE_INPUT_CLASS}
                />
              </div>
              <div className="bg-[#F5F6FA] rounded-xl p-3 text-xs space-y-1">
                <div className="flex justify-between text-[#6F737D]">
                  <span>Recalculated Subtotal</span>
                  <span className="tabular-nums">₹{editPreviewTotals.subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-[#6F737D]">
                  <span>Discount</span>
                  <span className="tabular-nums">-₹{editPreviewTotals.discountAmount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-[#6F737D]">
                  <span>Tax (GST)</span>
                  <span className="tabular-nums">₹{editPreviewTotals.totalTax.toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-bold text-[#2F3033] pt-1 border-t border-[#E5E7EC]">
                  <span>New Grand Total</span>
                  <span className="tabular-nums">₹{editPreviewTotals.grandTotal.toFixed(2)}</span>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-[#6F737D] mb-1">
                Audit Reason (required, min 5 characters)
              </label>
              <input
                type="text"
                required
                minLength={5}
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                placeholder="e.g., Corrected payment mode from Cash to UPI per guest receipt"
                className={BASE_INPUT_CLASS}
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#F0F1F5]">
              <Button
                type="button"
                variant="secondary"
                disabled={isSavingEdit}
                onClick={() => setEditTarget(null)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSavingEdit}>
                {isSavingEdit ? 'Saving…' : 'Save Audited Edit'}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Authorized Void (Audited Soft-Delete) Confirmation Modal */}
      {voidTarget && canModify && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px] flex items-center justify-center p-4"
          onClick={() => !isVoiding && setVoidTarget(null)}
        >
          <form
            onSubmit={handleConfirmVoid}
            className="bg-white rounded-2xl border border-[#FECACA] shadow-xl max-w-md w-full p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 className="text-base font-bold text-[#B91C1C]">
                  Void Bill · {voidTarget.billNumber}
                </h4>
                <p className="text-xs text-[#6F737D] mt-1">
                  This performs an audited soft-delete. The bill is removed from today&apos;s active
                  ledger and sales totals while preserving payment and item history in the audit log.
                </p>
              </div>
              <button
                type="button"
                disabled={isVoiding}
                onClick={() => setVoidTarget(null)}
                className="p-1.5 rounded-lg text-[#6F737D] hover:bg-[#F5F6FA] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {voidError && (
              <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-xs font-medium text-[#B91C1C]">
                {voidError}
              </div>
            )}

            <div className="bg-[#F5F6FA] rounded-xl p-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-[#6F737D]">Customer</span>
                <span className="font-semibold text-[#2F3033]">{voidTarget.customerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#6F737D]">Amount</span>
                <span className="font-bold text-[#2F3033] tabular-nums">
                  ₹{voidTarget.grandTotal.toFixed(2)} ({voidTarget.paymentMode.toUpperCase()})
                </span>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-[#6F737D] mb-1">
                Mandatory Void Reason (min 5 characters)
              </label>
              <textarea
                required
                minLength={5}
                rows={2}
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="e.g., Duplicate bill created in error"
                className={BASE_INPUT_CLASS}
              />
            </div>

            <label className="flex items-start gap-2 text-xs text-[#2F3033] cursor-pointer">
              <input
                type="checkbox"
                checked={voidConfirmed}
                onChange={(e) => setVoidConfirmed(e.target.checked)}
                className="mt-0.5 accent-[#B91C1C]"
              />
              <span>
                I confirm voiding bill <span className="font-mono font-bold">{voidTarget.billNumber}</span> and recording my user ID in the audit trail.
              </span>
            </label>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#F0F1F5]">
              <Button
                type="button"
                variant="secondary"
                disabled={isVoiding}
                onClick={() => setVoidTarget(null)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="danger" disabled={isVoiding}>
                {isVoiding ? 'Voiding…' : 'Confirm Void Bill'}
              </Button>
            </div>
          </form>
        </div>
      )}
    </Card>
  );
};
