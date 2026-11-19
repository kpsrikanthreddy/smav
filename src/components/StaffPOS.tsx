import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChefHat,
  Package,
  Printer,
  Receipt,
  RefreshCw,
  Scissors,
  Search,
  ShoppingBag,
  Trash2,
  Utensils,
  Wifi,
  WifiOff,
} from 'lucide-react';
import {
  Appointment,
  RestaurantCartItem,
  RestaurantMenuItem,
  RestaurantTable,
  RetailCartItem,
  RetailProduct,
  SalonCartItem,
  SalonService,
  Stylist,
  UserSession,
} from '../types';
import {
  BASE_INPUT_CLASS,
  Button,
  Card,
  CartSummary,
  EmptyState,
  ErrorState,
  FormField,
  ItemCard,
  LoadingState,
  StatusBadge,
  StylistSelector,
} from './ui';

interface StaffPOSProps {
  session: UserSession;
  isOnline: boolean;
  onToggleOnline: () => void;
  isPrinterConnected: boolean;
  onTogglePrinter: () => void;
  paperWidthMm: 58 | 80;
  onChangePaperWidth: (w: 58 | 80) => void;
  serverRevision: number;
  localRevision: number;
  onPerformDeltaSync: () => void;
}

const normalizeGroup = (value?: string | null) => (value || '').trim() || 'General';

const salonSubcategoryLabel = (item: Pick<SalonService, 'name' | 'subcategory'>) => {
  const source = `${item.subcategory || ''} ${item.name || ''}`
    .toLowerCase()
    .replace(/[-_]+/g, ' ');
  if (source.includes('wax')) return 'Waxing';
  if (/hair\s*cut|advance cut/.test(source)) return 'Hair Cuts';
  if (/hair\s*colou?r/.test(source)) return 'Hair Colour';
  if (/blow\s*dry|hair styling/.test(source)) return 'Blow Dry & Styling';
  if (source.includes('hair spa')) return 'Hair Spa';
  if (source.includes('hair makeover')) return 'Hair Makeover';
  if (/hair\s*wash|head massage/.test(source)) return 'Hair Wash & Massage';
  if (/facial|clean\s*up|d\s*tan/.test(source)) return 'Facials & Clean-up';
  if (source.includes('thread')) return 'Threading';
  if (/pedicure|manicure/.test(source)) return 'Nails Care';
  if (source.includes('massage')) return 'Massage';
  if (/mask|masque/.test(source)) return 'Masks';
  return normalizeGroup(item.subcategory)
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
};

const salonBranchCode = (outlet: UserSession['activeOutlet']) => {
  const source = `${outlet.code} ${outlet.name} ${outlet.address}`.toLowerCase();
  if (source.includes('kondapur') || /(^|\W)konda?(\W|$)/.test(source)) return 'KONDA';
  if (source.includes('gachibowli') || /(^|\W)gachi?(\W|$)/.test(source)) return 'GACHI';
  return outlet.code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5) || 'GACHI';
};

const indiaDatePart = () => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}${values.month}${values.day}`;
};

const nextOfflineSalonBillNumber = (outlet: UserSession['activeOutlet']) => {
  const branch = salonBranchCode(outlet);
  const datePart = indiaDatePart();
  const key = `smav:salon-sequence:${outlet.id}:${datePart}`;
  const previous = Number.parseInt(window.localStorage.getItem(key) || '0', 10);
  const next = (Number.isFinite(previous) ? previous : 0) + 1;
  window.localStorage.setItem(key, String(next));
  return `TGL-${branch}-${datePart}-${String(next).padStart(4, '0')}`;
};

export const StaffPOS: React.FC<StaffPOSProps> = ({
  session,
  isOnline,
  onToggleOnline,
  isPrinterConnected,
  onTogglePrinter,
  paperWidthMm,
  onChangePaperWidth,
  localRevision,
}) => {
  const category = session.activeOutlet.category;
  const [activePosView, setActivePosView] = useState<'billing' | 'catalog' | 'secondary'>('billing');
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [isCatalogLoading, setIsCatalogLoading] = useState<boolean>(true);

  // Salon Data
  const [salonServices, setSalonServices] = useState<SalonService[]>([]);
  const [stylists, setStylists] = useState<Stylist[]>([]);
  const [isLoadingStylists, setIsLoadingStylists] = useState(false);
  const [stylistError, setStylistError] = useState<string | null>(null);
  const [stylistUpstreamStatus, setStylistUpstreamStatus] = useState<number | null>(null);
  const [billSaveError, setBillSaveError] = useState<string | null>(null);
  const [billSuccessMessage, setBillSuccessMessage] = useState<string | null>(null);
  const [missingStylistIdx, setMissingStylistIdx] = useState<number | null>(null);
  const [isProcessingBill, setIsProcessingBill] = useState(false);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [salonCart, setSalonCart] = useState<SalonCartItem[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [paymentMode, setPaymentMode] = useState('upi');

  const stylistSelectRefs = useRef<Record<number, HTMLSelectElement | null>>({});
  const isSubmittingBillRef = useRef(false);
  const prevOutletIdRef = useRef(session.activeOutlet.id);
  const pendingCheckoutRef = useRef<{
    fingerprint: string;
    billNumber: string;
    idempotencyKey: string;
  } | null>(null);

  // Restaurant Data
  const [restaurantMenu, setRestaurantMenu] = useState<RestaurantMenuItem[]>([]);
  const [restaurantTables, setRestaurantTables] = useState<RestaurantTable[]>([]);
  const [restaurantCart, setRestaurantCart] = useState<RestaurantCartItem[]>([]);
  const [selectedTable, setSelectedTable] = useState('Table 2');
  const [orderType, setOrderType] = useState<'dine_in' | 'takeaway' | 'counter'>('dine_in');

  // Retail Data
  const [retailProducts, setRetailProducts] = useState<RetailProduct[]>([]);
  const [retailCart, setRetailCart] = useState<RetailCartItem[]>([]);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState('All');
  const [selectedSubcategoryFilter, setSelectedSubcategoryFilter] = useState('All');

  // Printing & Previews
  const [activeReceiptPreview, setActiveReceiptPreview] = useState<any | null>(null);
  const [activeKotPreview, setActiveKotPreview] = useState<any | null>(null);
  const [isPrinterBusy, setIsPrinterBusy] = useState(false);
  const [offlineQueue, setOfflineQueue] = useState<
    Array<{ kind: 'bills' | 'orders'; outletId: string; payload: any }>
  >(() => {
    try {
      const raw = window.localStorage.getItem(`smav:offline-queue:${session.activeOutlet.id}`);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [isFlushingOffline, setIsFlushingOffline] = useState(false);

  // Catalog derived filters (memoized)
  const catalogItems = useMemo(
    () =>
      category === 'salon'
        ? salonServices
        : category === 'restaurant'
          ? restaurantMenu
          : retailProducts,
    [category, salonServices, restaurantMenu, retailProducts]
  );

  const catalogCategories = useMemo(
    () =>
      Array.from(new Set(catalogItems.map((item) => normalizeGroup(item.category)))).sort((a, b) =>
        a.localeCompare(b)
      ),
    [catalogItems]
  );

  const categoryItems = useMemo(
    () =>
      catalogItems.filter(
        (item) =>
          selectedCategoryFilter === 'All' || normalizeGroup(item.category) === selectedCategoryFilter
      ),
    [catalogItems, selectedCategoryFilter]
  );

  const catalogSubcategories = useMemo(
    () =>
      Array.from(new Set(categoryItems.map((item) =>
        category === 'salon' ? salonSubcategoryLabel(item as SalonService) : normalizeGroup(item.subcategory)
      ))).sort(
        (a, b) => a.localeCompare(b)
      ),
    [categoryItems, category]
  );

  const visibleCatalogItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return categoryItems.filter(
      (item) =>
        (selectedSubcategoryFilter === 'All' ||
          (category === 'salon'
            ? salonSubcategoryLabel(item as SalonService)
            : normalizeGroup(item.subcategory)) === selectedSubcategoryFilter) &&
        (!q ||
          item.name.toLowerCase().includes(q) ||
          normalizeGroup(item.category).toLowerCase().includes(q) ||
          normalizeGroup(item.subcategory).toLowerCase().includes(q))
    );
  }, [categoryItems, selectedSubcategoryFilter, searchQuery, category]);

  useEffect(() => {
    setSelectedCategoryFilter('All');
    setSelectedSubcategoryFilter('All');
    setSearchQuery('');
    if (prevOutletIdRef.current !== session.activeOutlet.id) {
      prevOutletIdRef.current = session.activeOutlet.id;
      setSalonCart([]);
      setRestaurantCart([]);
      setRetailCart([]);
      setActiveReceiptPreview(null);
      setActiveKotPreview(null);
      setBillSaveError(null);
      setBillSuccessMessage(null);
      setMissingStylistIdx(null);
      pendingCheckoutRef.current = null;
      try {
        const raw = window.localStorage.getItem(`smav:offline-queue:${session.activeOutlet.id}`);
        const parsed = raw ? JSON.parse(raw) : [];
        setOfflineQueue(Array.isArray(parsed) ? parsed : []);
      } catch {
        setOfflineQueue([]);
      }
    }
  }, [session.activeOutlet.id]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        `smav:offline-queue:${session.activeOutlet.id}`,
        JSON.stringify(offlineQueue)
      );
    } catch {}
  }, [offlineQueue, session.activeOutlet.id]);

  const flushOfflineQueue = useCallback(async () => {
    if (!isOnline || isFlushingOffline || offlineQueue.length === 0) return;
    setIsFlushingOffline(true);
    const remaining: Array<{ kind: 'bills' | 'orders'; outletId: string; payload: any }> = [];
    let syncedCount = 0;

    for (const entry of offlineQueue) {
      if (entry.outletId !== session.activeOutlet.id) {
        remaining.push(entry);
        continue;
      }
      const endpoint =
        entry.kind === 'bills' ? '/api/mobile/sync/bills' : '/api/mobile/sync/orders';
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.token}`,
          },
          body: JSON.stringify(entry.payload),
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data?.success) {
          syncedCount += 1;
        } else {
          remaining.push(entry);
        }
      } catch {
        remaining.push(entry);
      }
    }

    setOfflineQueue(remaining);
    if (syncedCount > 0) {
      setBillSuccessMessage(
        `Synced ${syncedCount} offline transaction(s) to central SMAV database.`
      );
    }
    setIsFlushingOffline(false);
  }, [isOnline, isFlushingOffline, offlineQueue, session.activeOutlet.id, session.token]);

  useEffect(() => {
    if (isOnline && offlineQueue.length > 0 && !isFlushingOffline) {
      void flushOfflineQueue();
    }
  }, [isOnline, offlineQueue.length, isFlushingOffline, flushOfflineQueue]);

  useEffect(() => {
    if (selectedCategoryFilter !== 'All' && !catalogCategories.includes(selectedCategoryFilter)) {
      setSelectedCategoryFilter('All');
    }
  }, [selectedCategoryFilter, catalogCategories]);

  useEffect(() => {
    if (
      selectedSubcategoryFilter !== 'All' &&
      !catalogSubcategories.includes(selectedSubcategoryFilter)
    ) {
      setSelectedSubcategoryFilter('All');
    }
  }, [selectedSubcategoryFilter, catalogSubcategories]);

  const loadStylists = useCallback(async () => {
    if (category !== 'salon') {
      setStylists([]);
      setStylistError(null);
      setStylistUpstreamStatus(null);
      setIsLoadingStylists(false);
      return;
    }

    setIsLoadingStylists(true);
    setStylistError(null);
    setStylistUpstreamStatus(null);
    try {
      const res = await fetch(
        `/api/salon/stylists?outletId=${encodeURIComponent(session.activeOutlet.id)}`,
        { headers: { Authorization: `Bearer ${session.token}` } }
      );
      let data: any = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (!res.ok || !data?.success) {
        const upstreamStatus =
          typeof data?.upstreamStatus === 'number' ? data.upstreamStatus : res.status;
        setStylistUpstreamStatus(upstreamStatus);
        setStylists([]);
        setStylistError(
          data?.message ||
            `Could not load active stylists from the Glossy Looks staff API (HTTP ${upstreamStatus}).`
        );
        return;
      }

      const activeList: Stylist[] = (Array.isArray(data.stylists) ? data.stylists : []).filter(
        (st: Stylist) =>
          st && st.id && st.name && st.available !== false && st.isAvailable !== false
      );
      setStylists(activeList);
      if (activeList.length === 0) {
        setStylistError(
          data?.message || 'No active stylists returned for this outlet from the Glossy Looks staff API.'
        );
      } else {
        setStylistError(null);
      }
    } catch {
      setStylists([]);
      setStylistUpstreamStatus(null);
      setStylistError('Could not reach SMAV server to load active stylists. Please retry.');
    } finally {
      setIsLoadingStylists(false);
    }
  }, [category, session.activeOutlet.id, session.token]);

  useEffect(() => {
    if (category !== 'salon' || isLoadingStylists || stylistError) return;
    setSalonCart((prev) => {
      let changed = false;
      const next = prev.map((line) => {
        if (!line.stylist?.id) return line;
        const matched = stylists.find((st) => st.id === line.stylist?.id);
        if (!matched) {
          changed = true;
          return { ...line, stylist: null };
        }
        if (matched.name !== line.stylist.name || matched.role !== line.stylist.role) {
          changed = true;
          return { ...line, stylist: matched };
        }
        return line;
      });
      return changed ? next : prev;
    });
  }, [category, isLoadingStylists, stylistError, stylists]);

  const loadPosData = useCallback(async () => {
    setIsCatalogLoading(true);
    try {
      const res = await fetch('/api/pos/init', {
        headers: { Authorization: `Bearer ${session.token}` },
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setCatalogError(
          data.message || 'Catalog unavailable. Check outlet registration and upstream API.'
        );
        return;
      }
      setCatalogError(null);
      if (data.category === 'salon') {
        setSalonServices(data.services || []);
        setAppointments(data.appointments || []);
      } else if (data.category === 'restaurant') {
        setRestaurantMenu(data.menu || []);
        setRestaurantTables(data.tables || []);
      } else {
        setRetailProducts(data.products || []);
      }
    } catch (e) {
      console.error(e);
      setCatalogError('Could not load POS catalog from SMAV backend.');
    } finally {
      setIsCatalogLoading(false);
    }
  }, [session.token]);

  useEffect(() => {
    void loadPosData();
    void loadStylists();
  }, [session.activeOutlet.id, loadPosData, loadStylists]);

  // Cart Quantity Helpers
  const salonQtyById = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of salonCart) {
      map[item.service.id] = (map[item.service.id] || 0) + item.quantity;
    }
    return map;
  }, [salonCart]);

  const restaurantQtyById = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of restaurantCart) {
      map[item.item.id] = (map[item.item.id] || 0) + item.quantity;
    }
    return map;
  }, [restaurantCart]);

  const retailQtyById = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of retailCart) {
      map[item.product.id] = (map[item.product.id] || 0) + item.quantity;
    }
    return map;
  }, [retailCart]);

  const handleCatalogSalonIncrement = useCallback((srv: SalonService) => {
    setSalonCart((prev) => {
      const existingIdx = prev.findIndex((line) => line.service.id === srv.id);
      if (existingIdx >= 0) {
        return prev.map((line, i) =>
          i === existingIdx ? { ...line, quantity: line.quantity + 1 } : line
        );
      }
      return [
        ...prev,
        {
          service: srv,
          stylist: null,
          quantity: 1,
          discountPercent: 0,
          addedPrice: srv.price,
          addedRevision: srv.revision,
        },
      ];
    });
    setBillSuccessMessage(null);
    setBillSaveError(null);
  }, []);

  const handleCatalogSalonDecrement = useCallback((srvId: string) => {
    setSalonCart((prev) => {
      let idx = -1;
      for (let i = prev.length - 1; i >= 0; i -= 1) {
        if (prev[i].service.id === srvId) {
          idx = i;
          break;
        }
      }
      if (idx < 0) return prev;
      if (prev[idx].quantity <= 1) {
        return prev.filter((_, i) => i !== idx);
      }
      return prev.map((line, i) => (i === idx ? { ...line, quantity: line.quantity - 1 } : line));
    });
    setMissingStylistIdx(null);
  }, []);

  const handleCatalogRestaurantIncrement = useCallback((menuItem: RestaurantMenuItem) => {
    setRestaurantCart((prev) => {
      const existingIdx = prev.findIndex(
        (line) => line.item.id === menuItem.id && line.variantName === 'Regular'
      );
      if (existingIdx >= 0) {
        return prev.map((line, i) =>
          i === existingIdx ? { ...line, quantity: line.quantity + 1 } : line
        );
      }
      return [
        ...prev,
        {
          item: menuItem,
          variantName: 'Regular',
          unitPrice: menuItem.basePrice,
          quantity: 1,
          notes: '',
          addedPrice: menuItem.basePrice,
          addedRevision: menuItem.revision,
        },
      ];
    });
  }, []);

  const handleCatalogRestaurantDecrement = useCallback((itemId: string) => {
    setRestaurantCart((prev) => {
      let idx = -1;
      for (let i = prev.length - 1; i >= 0; i -= 1) {
        if (prev[i].item.id === itemId) {
          idx = i;
          break;
        }
      }
      if (idx < 0) return prev;
      if (prev[idx].quantity <= 1) {
        return prev.filter((_, i) => i !== idx);
      }
      return prev.map((line, i) => (i === idx ? { ...line, quantity: line.quantity - 1 } : line));
    });
  }, []);

  const handleCatalogRetailIncrement = useCallback((product: RetailProduct) => {
    setRetailCart((prev) => {
      const existingIdx = prev.findIndex((line) => line.product.id === product.id);
      if (existingIdx >= 0) {
        return prev.map((line, i) =>
          i === existingIdx ? { ...line, quantity: line.quantity + 1 } : line
        );
      }
      return [
        ...prev,
        {
          product,
          quantity: 1,
          discountPercent: 0,
          addedPrice: product.price,
          addedRevision: product.revision,
        },
      ];
    });
  }, []);

  const handleCatalogRetailDecrement = useCallback((productId: string) => {
    setRetailCart((prev) => {
      let idx = -1;
      for (let i = prev.length - 1; i >= 0; i -= 1) {
        if (prev[i].product.id === productId) {
          idx = i;
          break;
        }
      }
      if (idx < 0) return prev;
      if (prev[idx].quantity <= 1) {
        return prev.filter((_, i) => i !== idx);
      }
      return prev.map((line, i) => (i === idx ? { ...line, quantity: line.quantity - 1 } : line));
    });
  }, []);

  // Financial Calculations (preserved identically)
  const salonSubtotal = salonCart.reduce((sum, i) => sum + i.addedPrice * i.quantity, 0);
  const salonDiscount = salonCart.reduce(
    (sum, i) => sum + i.addedPrice * i.quantity * (i.discountPercent / 100),
    0
  );
  const salonTaxable = salonSubtotal - salonDiscount;
  const salonTax = Math.round(salonTaxable * 0.18);
  const salonGrandTotal = salonTaxable + salonTax;

  const restSubtotal = restaurantCart.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
  const restTax = Math.round(restSubtotal * 0.05);
  const restGrandTotal = restSubtotal + restTax;

  const retailSubtotal = retailCart.reduce((sum, i) => sum + i.addedPrice * i.quantity, 0);
  const retailDiscount = retailCart.reduce(
    (sum, i) => sum + i.addedPrice * i.quantity * (i.discountPercent / 100),
    0
  );
  const retailTaxable = retailSubtotal - retailDiscount;
  const retailTax = Math.round(retailTaxable * 0.12);
  const retailGrandTotal = retailTaxable + retailTax;

  const openBrowserPrintDialog = () => {
    try {
      if (typeof window !== 'undefined' && typeof window.print === 'function') {
        setIsPrinterBusy(true);
        window.setTimeout(() => {
          try {
            window.print();
          } catch (printErr) {
            setBillSaveError(
              `Bill saved, but browser print dialog could not be opened: ${
                printErr instanceof Error ? printErr.message : 'Print unavailable'
              }. Use "Print Copy" in the receipt panel without recreating the bill.`
            );
          } finally {
            setIsPrinterBusy(false);
          }
        }, 60);
      }
    } catch {
      setIsPrinterBusy(false);
    }
  };

  // Print Salon Bill (validation, idempotency, persistence preserved identically)
  const handlePrintSalonBill = async () => {
    if (isSubmittingBillRef.current || isProcessingBill) return;
    if (salonCart.length === 0) return;

    if (!customerName.trim()) {
      setBillSaveError('Customer name is required.');
      document.getElementById('pos-customer-name')?.focus();
      return;
    }
    if (!customerPhone.trim()) {
      setBillSaveError('Customer phone is required.');
      document.getElementById('pos-customer-phone')?.focus();
      return;
    }

    if (isLoadingStylists) {
      setBillSaveError('Stylist data is still loading. Please wait.');
      return;
    }
    if (stylistError || stylists.length === 0) {
      setBillSaveError(
        stylistError || 'Stylists are unavailable. Retry loading stylists before printing.'
      );
      return;
    }

    const firstMissingIdx = salonCart.findIndex((item) => !item.stylist?.id);
    if (firstMissingIdx >= 0) {
      setMissingStylistIdx(firstMissingIdx);
      setBillSuccessMessage(null);
      setBillSaveError('Select a stylist for every salon service before printing.');
      const selectEl = stylistSelectRefs.current[firstMissingIdx];
      if (selectEl) {
        selectEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        selectEl.focus();
      }
      return;
    }

    isSubmittingBillRef.current = true;
    setIsProcessingBill(true);
    setMissingStylistIdx(null);
    setBillSaveError(null);
    setBillSuccessMessage(null);

    try {
      const fingerprint = JSON.stringify({
        outletId: session.activeOutlet.id,
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        paymentMode,
        items: salonCart.map((c) => ({
          id: c.service.id,
          q: c.quantity,
          p: c.addedPrice,
          d: c.discountPercent,
          s: c.stylist!.id,
        })),
      });

      if (!pendingCheckoutRef.current || pendingCheckoutRef.current.fingerprint !== fingerprint) {
        let billNumber: string;
        if (isOnline) {
          const numberResponse = await fetch('/api/pos/salon/next-bill-number', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.token}`,
            },
            body: JSON.stringify({ outletId: session.activeOutlet.id }),
          });
          const numberResult = await numberResponse.json().catch(() => null);
          if (!numberResponse.ok || !numberResult?.billNumber) {
            throw new Error(numberResult?.message || 'Could not reserve the next bill number.');
          }
          billNumber = numberResult.billNumber;
        } else {
          billNumber = nextOfflineSalonBillNumber(session.activeOutlet);
        }
        pendingCheckoutRef.current = {
          fingerprint,
          billNumber,
          idempotencyKey: `IDEM_${billNumber}`,
        };
      }

      const { billNumber, idempotencyKey } = pendingCheckoutRef.current;
      const createdAtIso = new Date().toISOString();
      const bill = {
        billNumber,
        outletName: session.activeOutlet.name,
        outletAddress: session.activeOutlet.address,
        outletPhone: session.activeOutlet.phone,
        outletGstin: session.activeOutlet.gstin,
        receiptHeader: session.activeOutlet.receiptHeader,
        receiptFooter: session.activeOutlet.receiptFooter,
        branchCode: salonBranchCode(session.activeOutlet),
        businessType: 'salon',
        customerName: customerName.trim() || 'Walk-in Customer',
        customerPhone: customerPhone.trim(),
        paymentMode,
        items: salonCart.map((c) => ({
          name: c.service.name,
          price: c.addedPrice,
          quantity: c.quantity,
          discountPercent: c.discountPercent,
          serviceId: c.service.id,
          stylistId: c.stylist!.id,
          stylist: c.stylist!.name,
        })),
        subtotal: salonSubtotal,
        discount: salonDiscount,
        tax: salonTax,
        grandTotal: salonGrandTotal,
        paperWidth: paperWidthMm,
        createdAt: createdAtIso,
        timestamp: new Date(createdAtIso).toLocaleString(),
      };

      const payload = {
        bills: [
          {
            bill: {
              ...bill,
              id: billNumber,
              outletId: session.activeOutlet.id,
              createdAt: createdAtIso,
            },
            items: bill.items,
            idempotency_key: idempotencyKey,
          },
        ],
      };

      if (isOnline) {
        const response = await fetch('/api/mobile/sync/bills', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.token}`,
          },
          body: JSON.stringify(payload),
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.success) {
          throw new Error(result?.message || `Bill could not be saved (HTTP ${response.status})`);
        }
      } else {
        setOfflineQueue((prev) => [
          ...prev,
          { kind: 'bills', outletId: session.activeOutlet.id, payload },
        ]);
      }

      pendingCheckoutRef.current = null;
      setActiveReceiptPreview(bill);
      setSalonCart([]);
      setCustomerName('');
      setCustomerPhone('');
      setBillSuccessMessage(
        isOnline
          ? `Bill ${bill.billNumber} saved. Opening ${paperWidthMm}mm browser print dialog.`
          : `Bill ${bill.billNumber} queued locally offline. Opening ${paperWidthMm}mm browser print dialog.`
      );
      openBrowserPrintDialog();
    } catch (error) {
      setBillSaveError(
        `Bill not saved to database: ${
          error instanceof Error ? error.message : 'Unknown error'
        }. Retry without changing cart to avoid duplicates.`
      );
    } finally {
      isSubmittingBillRef.current = false;
      setIsProcessingBill(false);
    }
  };

  // Print Restaurant Order
  const handlePrintRestaurantOrder = async () => {
    if (restaurantCart.length === 0 || isProcessingBill) return;
    setIsProcessingBill(true);
    setBillSaveError(null);
    setBillSuccessMessage(null);

    const createdAtIso = new Date().toISOString();
    const orderNumber = `MOZZ-${session.activeOutlet.code.toUpperCase()}-${Date.now().toString().slice(-6)}`;
    const tokenNumber = String(Math.floor(Math.random() * 90) + 10);

    const order = {
      orderNumber,
      tokenNumber,
      outletName: session.activeOutlet.name,
      receiptHeader: session.activeOutlet.receiptHeader,
      receiptFooter: session.activeOutlet.receiptFooter,
      tableOrCounter: selectedTable,
      orderType,
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim(),
      paymentMode,
      items: restaurantCart.map((c) => ({
        name: c.item.name,
        variant: c.variantName,
        price: c.unitPrice,
        quantity: c.quantity,
        notes: c.notes,
      })),
      subtotal: restSubtotal,
      tax: restTax,
      grandTotal: restGrandTotal,
      paperWidth: paperWidthMm,
      createdAt: createdAtIso,
      timestamp: new Date(createdAtIso).toLocaleString(),
    };

    const payload = {
      orders: [
        {
          order: {
            ...order,
            orderNumber,
            tokenNumber,
            outletId: session.activeOutlet.id,
            createdAt: createdAtIso,
          },
          items: order.items,
          idempotency_key: `IDEM_${orderNumber}`,
        },
      ],
    };

    try {
      if (isOnline) {
        const response = await fetch('/api/mobile/sync/orders', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.token}`,
          },
          body: JSON.stringify(payload),
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.success) {
          throw new Error(result?.message || `Order could not be saved (HTTP ${response.status})`);
        }
        setBillSuccessMessage(`Order ${orderNumber} saved to central SMAV database.`);
      } else {
        setOfflineQueue((prev) => [
          ...prev,
          { kind: 'orders', outletId: session.activeOutlet.id, payload },
        ]);
        setBillSuccessMessage(`Order ${orderNumber} queued locally offline.`);
      }

      if (isPrinterConnected) {
        setIsPrinterBusy(true);
        setTimeout(() => setIsPrinterBusy(false), 1200);
      }

      setActiveReceiptPreview(order);
      setActiveKotPreview(order);
      setRestaurantCart([]);
      setCustomerName('');
      setCustomerPhone('');
    } catch (error) {
      setBillSaveError(
        `Order sync error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } finally {
      setIsProcessingBill(false);
    }
  };

  // Print Retail Bill (preserved)
  const handlePrintRetailBill = () => {
    if (retailCart.length === 0) return;
    const billNumber = `RET-${session.activeOutlet.code.toUpperCase()}-${Date.now().toString().slice(-6)}`;
    const bill = {
      billNumber,
      outletName: session.activeOutlet.name,
      receiptHeader: session.activeOutlet.receiptHeader,
      receiptFooter: session.activeOutlet.receiptFooter,
      customerName,
      customerPhone,
      paymentMode,
      items: retailCart.map((c) => ({
        name: c.product.name,
        sku: c.product.sku,
        price: c.addedPrice,
        quantity: c.quantity,
      })),
      subtotal: retailSubtotal,
      discount: retailDiscount,
      tax: retailTax,
      grandTotal: retailGrandTotal,
      paperWidth: paperWidthMm,
      timestamp: new Date().toLocaleString(),
    };

    if (isPrinterConnected) {
      setIsPrinterBusy(true);
      setTimeout(() => setIsPrinterBusy(false), 1200);
    }

    setActiveReceiptPreview(bill);
  };

  const activeCartCount =
    category === 'salon'
      ? salonCart.reduce((s, i) => s + i.quantity, 0)
      : category === 'restaurant'
        ? restaurantCart.reduce((s, i) => s + i.quantity, 0)
        : retailCart.reduce((s, i) => s + i.quantity, 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
      {catalogError && (
        <div className="lg:col-span-12">
          <ErrorState
            title="Catalog unavailable"
            message={catalogError}
            onRetry={() => void loadPosData()}
          />
        </div>
      )}

      {/* Left 7 Cols: Counter POS Terminal */}
      <Card padding="none" className="lg:col-span-7 overflow-hidden flex flex-col">
        {/* Hardware & Connectivity Toolbar */}
        <div className="bg-[#F9FAFC] px-4 py-2.5 border-b border-[#E5E7EC] flex flex-wrap items-center justify-between gap-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onToggleOnline}
              className={`min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1 rounded-xl font-semibold border transition cursor-pointer ${
                isOnline
                  ? 'bg-[#ECFDF5] text-[#15803D] border-[#BBF7D0]'
                  : 'bg-[#FEF2F2] text-[#B91C1C] border-[#FECACA]'
              }`}
            >
              {isOnline ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
              <span>{isOnline ? 'Online Sync' : 'Offline Mode'}</span>
            </button>

            <button
              type="button"
              onClick={onTogglePrinter}
              className={`min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1 rounded-xl font-semibold border transition cursor-pointer ${
                isPrinterConnected
                  ? 'bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE]'
                  : 'bg-white text-[#6F737D] border-[#E5E7EC]'
              }`}
            >
              <Printer className="w-3.5 h-3.5" />
              <span>{isPrinterConnected ? `Print Ready (${paperWidthMm}mm)` : 'Print Standby'}</span>
            </button>
          </div>

          <div className="flex items-center gap-1 bg-white rounded-xl p-1 border border-[#E5E7EC]">
            <span className="text-[11px] font-medium text-[#6F737D] px-1.5">Roll</span>
            {([80, 58] as const).map((width) => (
              <button
                key={width}
                type="button"
                onClick={() => onChangePaperWidth(width)}
                className={`min-h-[28px] px-2.5 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                  paperWidthMm === width
                    ? 'bg-[#2F3033] text-white'
                    : 'text-[#6F737D] hover:text-[#2F3033]'
                }`}
              >
                {width}mm
              </button>
            ))}
          </div>
        </div>

        {/* Offline Queue Notice */}
        {!isOnline && (
          <div className="bg-[#FFFBEB] border-b border-[#FDE68A] px-4 py-2 flex items-center justify-between gap-2 text-xs text-[#92400E]">
            <div className="flex items-center gap-2">
              <WifiOff className="w-4 h-4 text-[#D97706] shrink-0" />
              <span>Offline mode: bills are queued locally and sync once connected.</span>
            </div>
            {offlineQueue.length > 0 && (
              <StatusBadge label={`${offlineQueue.length} Queued`} tone="warning" />
            )}
          </div>
        )}

        {/* POS View Navigation */}
        <div className="bg-white border-b border-[#E5E7EC] px-4 py-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => setActivePosView('billing')}
              className={`min-h-[38px] shrink-0 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
                activePosView === 'billing'
                  ? 'bg-[#2F3033] text-white shadow-xs'
                  : 'bg-[#F5F6FA] text-[#6F737D] hover:text-[#2F3033]'
              }`}
            >
              Active Cart ({activeCartCount})
            </button>
            <button
              type="button"
              onClick={() => setActivePosView('catalog')}
              className={`min-h-[38px] shrink-0 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
                activePosView === 'catalog'
                  ? 'bg-[#2F3033] text-white shadow-xs'
                  : 'bg-[#F5F6FA] text-[#6F737D] hover:text-[#2F3033]'
              }`}
            >
              {category === 'salon'
                ? 'Catalog Services'
                : category === 'restaurant'
                  ? 'Menu Items'
                  : 'Products'}
            </button>
            {category === 'salon' && (
              <button
                type="button"
                onClick={() => setActivePosView('secondary')}
                className={`min-h-[38px] shrink-0 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
                  activePosView === 'secondary'
                    ? 'bg-[#2F3033] text-white shadow-xs'
                    : 'bg-[#F5F6FA] text-[#6F737D] hover:text-[#2F3033]'
                }`}
              >
                Appointments ({appointments.length})
              </button>
            )}
            {category === 'restaurant' && (
              <button
                type="button"
                onClick={() => setActivePosView('secondary')}
                className={`min-h-[38px] shrink-0 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
                  activePosView === 'secondary'
                    ? 'bg-[#2F3033] text-white shadow-xs'
                    : 'bg-[#F5F6FA] text-[#6F737D] hover:text-[#2F3033]'
                }`}
              >
                Tables &amp; Seating
              </button>
            )}
          </div>

          <span className="hidden sm:inline-block text-[11px] font-medium text-[#6F737D] tabular-nums shrink-0">
            Rev #{localRevision}
          </span>
        </div>

        {/* Body Content */}
        <div className="p-4 sm:p-5 space-y-4 flex-1 bg-white">
          {/* VIEW 1: ACTIVE CART */}
          {activePosView === 'billing' && (
            <div className="space-y-4">
              {/* SALON CART */}
              {category === 'salon' && (
                <div className="space-y-4">
                  {isLoadingStylists && (
                    <div className="rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] px-3.5 py-2.5 text-xs text-[#1D4ED8] flex items-center gap-2">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
                      <span>Loading active stylists from Glossy Looks staff API...</span>
                    </div>
                  )}

                  {!isLoadingStylists && stylistError && (
                    <ErrorState
                      title="Stylists unavailable"
                      message={`${stylistError}${stylistUpstreamStatus ? ` (HTTP ${stylistUpstreamStatus})` : ''}`}
                      onRetry={() => void loadStylists()}
                    />
                  )}

                  {salonCart.length === 0 ? (
                    <EmptyState
                      icon={<Scissors className="w-5 h-5" />}
                      title="Your salon cart is empty"
                      description="Browse salon services from the catalog and assign a stylist to each service before printing."
                      action={
                        <Button size="sm" onClick={() => setActivePosView('catalog')}>
                          Browse Services
                        </Button>
                      }
                    />
                  ) : (
                    <div className="space-y-2.5">
                      {salonCart.map((item, idx) => (
                        <ItemCard
                          key={`${item.service.id}-${idx}`}
                          title={item.service.name}
                          subtitle={`${normalizeGroup(item.service.category)} · ${salonSubcategoryLabel(item.service)}`}
                          meta={
                            item.service.durationMinutes
                              ? `${item.service.durationMinutes} min`
                              : undefined
                          }
                          price={item.addedPrice}
                          lineTotal={item.addedPrice * item.quantity}
                          quantity={item.quantity}
                          onIncrement={() =>
                            setSalonCart((prev) =>
                              prev.map((line, i) =>
                                i === idx ? { ...line, quantity: line.quantity + 1 } : line
                              )
                            )
                          }
                          onDecrement={() => {
                            if (item.quantity <= 1) {
                              setSalonCart((prev) => prev.filter((_, i) => i !== idx));
                              setMissingStylistIdx(null);
                            } else {
                              setSalonCart((prev) =>
                                prev.map((line, i) =>
                                  i === idx ? { ...line, quantity: line.quantity - 1 } : line
                                )
                              );
                            }
                          }}
                          fallbackIcon={<Scissors className="w-4 h-4 text-[#FF1B7A]" />}
                          footer={
                            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2.5">
                              <div className="flex-1 min-w-0">
                                <StylistSelector
                                  index={idx}
                                  serviceName={item.service.name}
                                  stylists={stylists}
                                  selectedStylistId={item.stylist?.id || ''}
                                  isLoadingStylists={isLoadingStylists}
                                  isMissingHighlight={missingStylistIdx === idx}
                                  selectRef={(el) => {
                                    stylistSelectRefs.current[idx] = el;
                                  }}
                                  onChange={(chosen) => {
                                    setSalonCart((prev) =>
                                      prev.map((line, i) =>
                                        i === idx ? { ...line, stylist: chosen } : line
                                      )
                                    );
                                    if (chosen && missingStylistIdx === idx) {
                                      setMissingStylistIdx(null);
                                    }
                                    setBillSaveError(null);
                                  }}
                                />
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setSalonCart((prev) => prev.filter((_, i) => i !== idx));
                                  setMissingStylistIdx(null);
                                }}
                                aria-label={`Remove ${item.service.name}`}
                                className="min-h-[40px] px-2.5 rounded-xl text-xs font-semibold text-[#6F737D] hover:text-[#B91C1C] hover:bg-[#FEF2F2] inline-flex items-center gap-1 self-end transition cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span className="sm:hidden">Remove</span>
                              </button>
                            </div>
                          }
                        />
                      ))}
                    </div>
                  )}

                  {billSaveError && (
                    <div
                      role="alert"
                      className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3.5 py-2.5 text-xs text-[#B91C1C] font-medium"
                    >
                      {billSaveError}
                    </div>
                  )}
                  {billSuccessMessage && (
                    <div
                      role="status"
                      className="rounded-xl border border-[#BBF7D0] bg-[#ECFDF5] px-3.5 py-2.5 text-xs text-[#15803D] font-medium flex items-center gap-2"
                    >
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>{billSuccessMessage}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <FormField label="Customer Name *" htmlFor="pos-customer-name">
                      <input
                        id="pos-customer-name"
                        type="text"
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        placeholder="Enter customer name"
                        required
                        className={BASE_INPUT_CLASS}
                      />
                    </FormField>
                    <FormField label="Phone (WhatsApp) *" htmlFor="pos-customer-phone">
                      <input
                        id="pos-customer-phone"
                        type="tel"
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(e.target.value)}
                        placeholder="Enter mobile number"
                        required
                        className={BASE_INPUT_CLASS}
                      />
                    </FormField>
                    <FormField label="Payment Mode" htmlFor="pos-payment-mode">
                      <select
                        id="pos-payment-mode"
                        value={paymentMode}
                        onChange={(e) => setPaymentMode(e.target.value)}
                        className={BASE_INPUT_CLASS}
                      >
                        <option value="upi">UPI</option>
                        <option value="cash">Cash</option>
                        <option value="card">Card</option>
                      </select>
                    </FormField>
                  </div>

                  <CartSummary
                    lines={[
                      { label: 'Subtotal', value: `₹${salonSubtotal}` },
                      { label: 'Discount', value: `-₹${salonDiscount}`, tone: 'discount' },
                      { label: 'GST (18%)', value: `₹${salonTax}` },
                    ]}
                    grandTotalValue={`₹${salonGrandTotal}`}
                    itemCountLabel={`${activeCartCount} service${activeCartCount === 1 ? '' : 's'}`}
                    action={
                      <div className="space-y-2">
                        {salonCart.length > 0 &&
                          (isLoadingStylists || Boolean(stylistError) || stylists.length === 0) && (
                            <p className="text-[11px] text-[#B45309] font-medium">
                              {isLoadingStylists
                                ? 'Printing disabled until active stylists finish loading.'
                                : 'Printing disabled while active stylists are unavailable. Click Retry above to reload stylists.'}
                            </p>
                          )}
                        <Button
                          fullWidth
                          size="lg"
                          onClick={() => void handlePrintSalonBill()}
                          disabled={
                            salonCart.length === 0 ||
                            isLoadingStylists ||
                            Boolean(stylistError) ||
                            stylists.length === 0 ||
                            isProcessingBill
                          }
                          loading={isProcessingBill}
                          leftIcon={<Printer className="w-4 h-4" />}
                        >
                          {isProcessingBill
                            ? 'Saving Bill & Opening Print Dialog...'
                            : 'Print Salon Receipt (Browser Print)'}
                        </Button>
                      </div>
                    }
                  />
                </div>
              )}

              {/* RESTAURANT CART */}
              {category === 'restaurant' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <FormField label="Table / Counter" htmlFor="pos-table-select">
                      <select
                        id="pos-table-select"
                        value={selectedTable}
                        onChange={(e) => setSelectedTable(e.target.value)}
                        className={BASE_INPUT_CLASS}
                      >
                        <option value="Table 1">Table 1 (2 Pax)</option>
                        <option value="Table 2">Table 2 (4 Pax)</option>
                        <option value="Table 3">Table 3 (4 Pax)</option>
                        <option value="Counter 1">Counter 1 (Fast Bite)</option>
                      </select>
                    </FormField>
                    <FormField label="Order Mode" htmlFor="pos-order-mode">
                      <select
                        id="pos-order-mode"
                        value={orderType}
                        onChange={(e) => setOrderType(e.target.value as any)}
                        className={BASE_INPUT_CLASS}
                      >
                        <option value="dine_in">Dine In</option>
                        <option value="takeaway">Takeaway</option>
                        <option value="counter">Express Counter</option>
                      </select>
                    </FormField>
                  </div>

                  {restaurantCart.length === 0 ? (
                    <EmptyState
                      icon={<Utensils className="w-5 h-5" />}
                      title="No dishes in order"
                      description="Add items from the restaurant menu to print a KOT or dine-in bill."
                      action={
                        <Button size="sm" onClick={() => setActivePosView('catalog')}>
                          Open Menu
                        </Button>
                      }
                    />
                  ) : (
                    <div className="space-y-2.5">
                      {restaurantCart.map((item, idx) => (
                        <ItemCard
                          key={`${item.item.id}-${idx}`}
                          title={item.item.name}
                          subtitle={`${item.variantName || 'Regular'} · ${normalizeGroup(item.item.category)}`}
                          leadingIndicator={
                            <span
                              title={item.item.isVeg ? 'Vegetarian' : 'Non-Vegetarian'}
                              className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                                item.item.isVeg ? 'bg-[#15803D]' : 'bg-[#DC2626]'
                              }`}
                            />
                          }
                          price={item.unitPrice}
                          lineTotal={item.unitPrice * item.quantity}
                          quantity={item.quantity}
                          onIncrement={() =>
                            setRestaurantCart((prev) =>
                              prev.map((line, i) =>
                                i === idx ? { ...line, quantity: line.quantity + 1 } : line
                              )
                            )
                          }
                          onDecrement={() => {
                            if (item.quantity <= 1) {
                              setRestaurantCart((prev) => prev.filter((_, i) => i !== idx));
                            } else {
                              setRestaurantCart((prev) =>
                                prev.map((line, i) =>
                                  i === idx ? { ...line, quantity: line.quantity - 1 } : line
                                )
                              );
                            }
                          }}
                          fallbackIcon={<Utensils className="w-4 h-4 text-[#FF6A00]" />}
                        />
                      ))}
                    </div>
                  )}

                  {billSaveError && (
                    <div
                      role="alert"
                      className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3.5 py-2.5 text-xs text-[#B91C1C] font-medium"
                    >
                      {billSaveError}
                    </div>
                  )}
                  {billSuccessMessage && (
                    <div
                      role="status"
                      className="rounded-xl border border-[#BBF7D0] bg-[#ECFDF5] px-3.5 py-2.5 text-xs text-[#15803D] font-medium flex items-center gap-2"
                    >
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>{billSuccessMessage}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <FormField label="Customer Name (optional)" htmlFor="rest-customer-name">
                      <input
                        id="rest-customer-name"
                        type="text"
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        placeholder="Optional guest name"
                        className={BASE_INPUT_CLASS}
                      />
                    </FormField>
                    <FormField label="Phone (WhatsApp, optional)" htmlFor="rest-customer-phone">
                      <input
                        id="rest-customer-phone"
                        type="tel"
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(e.target.value)}
                        placeholder="Optional mobile number"
                        className={BASE_INPUT_CLASS}
                      />
                    </FormField>
                    <FormField label="Payment Mode" htmlFor="rest-payment-mode">
                      <select
                        id="rest-payment-mode"
                        value={paymentMode}
                        onChange={(e) => setPaymentMode(e.target.value)}
                        className={BASE_INPUT_CLASS}
                      >
                        <option value="upi">UPI</option>
                        <option value="cash">Cash</option>
                        <option value="card">Card</option>
                      </select>
                    </FormField>
                  </div>

                  <CartSummary
                    lines={[
                      { label: 'Food Subtotal', value: `₹${restSubtotal}` },
                      { label: 'Restaurant GST (5%)', value: `₹${restTax}` },
                    ]}
                    grandTotalLabel="Order Total"
                    grandTotalValue={`₹${restGrandTotal}`}
                    itemCountLabel={`${activeCartCount} item${activeCartCount === 1 ? '' : 's'} · ${selectedTable}`}
                    action={
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <Button
                          variant="outline"
                          onClick={() => void handlePrintRestaurantOrder()}
                          disabled={restaurantCart.length === 0 || isProcessingBill}
                          loading={isProcessingBill}
                          leftIcon={<ChefHat className="w-4 h-4 text-[#D97706]" />}
                        >
                          Print KOT (No Price)
                        </Button>
                        <Button
                          onClick={() => void handlePrintRestaurantOrder()}
                          disabled={restaurantCart.length === 0 || isProcessingBill}
                          loading={isProcessingBill}
                          leftIcon={<Printer className="w-4 h-4" />}
                        >
                          Print Dine Bill
                        </Button>
                      </div>
                    }
                  />
                </div>
              )}

              {/* RETAIL / OTHER CART */}
              {category !== 'salon' && category !== 'restaurant' && (
                <div className="space-y-4">
                  {retailCart.length === 0 ? (
                    <EmptyState
                      icon={<ShoppingBag className="w-5 h-5" />}
                      title="No products in cart"
                      description="Select products from the catalog to build a retail bill."
                      action={
                        <Button size="sm" onClick={() => setActivePosView('catalog')}>
                          Browse Products
                        </Button>
                      }
                    />
                  ) : (
                    <div className="space-y-2.5">
                      {retailCart.map((item, idx) => (
                        <ItemCard
                          key={`${item.product.id}-${idx}`}
                          title={item.product.name}
                          subtitle={`SKU: ${item.product.sku}`}
                          price={item.addedPrice}
                          lineTotal={item.addedPrice * item.quantity}
                          quantity={item.quantity}
                          onIncrement={() =>
                            setRetailCart((prev) =>
                              prev.map((line, i) =>
                                i === idx ? { ...line, quantity: line.quantity + 1 } : line
                              )
                            )
                          }
                          onDecrement={() => {
                            if (item.quantity <= 1) {
                              setRetailCart((prev) => prev.filter((_, i) => i !== idx));
                            } else {
                              setRetailCart((prev) =>
                                prev.map((line, i) =>
                                  i === idx ? { ...line, quantity: line.quantity - 1 } : line
                                )
                              );
                            }
                          }}
                          fallbackIcon={<Package className="w-4 h-4 text-[#15803D]" />}
                        />
                      ))}
                    </div>
                  )}

                  <CartSummary
                    lines={[
                      { label: 'Subtotal', value: `₹${retailSubtotal}` },
                      { label: 'Retail GST (12%)', value: `₹${retailTax}` },
                    ]}
                    grandTotalValue={`₹${retailGrandTotal}`}
                    itemCountLabel={`${activeCartCount} item${activeCartCount === 1 ? '' : 's'}`}
                    action={
                      <Button
                        fullWidth
                        size="lg"
                        onClick={handlePrintRetailBill}
                        disabled={retailCart.length === 0}
                        leftIcon={<Printer className="w-4 h-4" />}
                      >
                        Print Retail Bill (ESC/POS)
                      </Button>
                    }
                  />
                </div>
              )}
            </div>
          )}

          {/* VIEW 2: CATALOG ITEM SELECTION */}
          {activePosView === 'catalog' && (
            <div className="space-y-4">
              <div className="relative">
                <Search className="w-4 h-4 text-[#6F737D] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search services, dishes, or categories..."
                  className={`${BASE_INPUT_CLASS} pl-10`}
                />
              </div>

              <div className="space-y-2.5" aria-label="Catalog category navigation">
                <div className="flex items-center justify-between text-[11px] font-semibold text-[#6F737D]">
                  <span>Categories</span>
                  <span className="tabular-nums">
                    Showing {visibleCatalogItems.length} of {catalogItems.length}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                  {['All', ...catalogCategories].map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      aria-pressed={selectedCategoryFilter === cat}
                      onClick={() => {
                        setSelectedCategoryFilter(cat);
                        setSelectedSubcategoryFilter('All');
                      }}
                      className={`min-h-[36px] shrink-0 rounded-xl border px-3 py-1 text-xs font-semibold transition cursor-pointer ${
                        selectedCategoryFilter === cat
                          ? 'border-[#2F3033] bg-[#2F3033] text-white'
                          : 'border-[#E5E7EC] bg-white text-[#6F737D] hover:text-[#2F3033] hover:border-[#D3D7E0]'
                      }`}
                    >
                      {cat === 'All' ? 'All Categories' : cat}
                    </button>
                  ))}
                </div>

                {catalogSubcategories.length > 1 && (
                  <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                    {['All', ...catalogSubcategories].map((sub) => (
                      <button
                        key={sub}
                        type="button"
                        aria-pressed={selectedSubcategoryFilter === sub}
                        onClick={() => setSelectedSubcategoryFilter(sub)}
                        className={`min-h-[34px] shrink-0 rounded-xl border px-3 py-1 text-[11px] font-semibold transition cursor-pointer ${
                          selectedSubcategoryFilter === sub
                            ? 'border-[#FF1B7A] bg-[#FFF1F5] text-[#D81B60]'
                            : 'border-[#E5E7EC] bg-[#F9FAFC] text-[#6F737D] hover:text-[#2F3033]'
                        }`}
                      >
                        {sub === 'All' ? 'All Subcategories' : sub}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {isCatalogLoading ? (
                <LoadingState compact title="Loading outlet catalog…" />
              ) : visibleCatalogItems.length === 0 ? (
                <EmptyState
                  title="No matching catalog items"
                  description="Try clearing your search or category filter, or verify outlet catalog sync."
                  action={
                    searchQuery || selectedCategoryFilter !== 'All' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSearchQuery('');
                          setSelectedCategoryFilter('All');
                          setSelectedSubcategoryFilter('All');
                        }}
                      >
                        Reset Filters
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[520px] overflow-y-auto pr-0.5">
                  {category === 'salon' &&
                    (visibleCatalogItems as SalonService[]).map((srv) => (
                      <ItemCard
                        key={srv.id}
                        title={srv.name}
                        subtitle={`${normalizeGroup(srv.category)} · ${salonSubcategoryLabel(srv)}`}
                        meta={srv.durationMinutes ? `${srv.durationMinutes} min` : undefined}
                        price={srv.price}
                        quantity={salonQtyById[srv.id] || 0}
                        disabled={srv.isActive === false}
                        disabledReason={srv.isActive === false ? 'Service disabled' : undefined}
                        onIncrement={() => handleCatalogSalonIncrement(srv)}
                        onDecrement={() => handleCatalogSalonDecrement(srv.id)}
                        fallbackIcon={<Scissors className="w-4 h-4 text-[#FF1B7A]" />}
                      />
                    ))}

                  {category === 'restaurant' &&
                    (visibleCatalogItems as RestaurantMenuItem[]).map((menuItem) => (
                      <ItemCard
                        key={menuItem.id}
                        title={menuItem.name}
                        subtitle={`${normalizeGroup(menuItem.category)} · ${normalizeGroup(menuItem.subcategory)}`}
                        leadingIndicator={
                          <span
                            className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                              menuItem.isVeg ? 'bg-[#15803D]' : 'bg-[#DC2626]'
                            }`}
                          />
                        }
                        price={menuItem.basePrice}
                        quantity={restaurantQtyById[menuItem.id] || 0}
                        onIncrement={() => handleCatalogRestaurantIncrement(menuItem)}
                        onDecrement={() => handleCatalogRestaurantDecrement(menuItem.id)}
                        fallbackIcon={<Utensils className="w-4 h-4 text-[#FF6A00]" />}
                      />
                    ))}

                  {category !== 'salon' &&
                    category !== 'restaurant' &&
                    (visibleCatalogItems as RetailProduct[]).map((product) => (
                      <ItemCard
                        key={product.id}
                        title={product.name}
                        subtitle={`${normalizeGroup(product.category)} · SKU ${product.sku}`}
                        price={product.price}
                        quantity={retailQtyById[product.id] || 0}
                        disabled={product.isActive === false || product.stockQty <= 0}
                        disabledReason={
                          product.stockQty <= 0 ? 'Out of stock' : 'Product inactive'
                        }
                        onIncrement={() => handleCatalogRetailIncrement(product)}
                        onDecrement={() => handleCatalogRetailDecrement(product.id)}
                        fallbackIcon={<Package className="w-4 h-4 text-[#15803D]" />}
                      />
                    ))}
                </div>
              )}

              {activeCartCount > 0 && (
                <div className="pt-2 border-t border-[#E5E7EC] flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold text-[#2F3033] tabular-nums">
                    {activeCartCount} item{activeCartCount === 1 ? '' : 's'} in cart
                  </span>
                  <Button size="sm" onClick={() => setActivePosView('billing')}>
                    Go to Cart &amp; Print
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* VIEW 3: SECONDARY (APPOINTMENTS / TABLES) */}
          {activePosView === 'secondary' && category === 'salon' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-[#2F3033] flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-[#FF1B7A]" />
                  <span>Scheduled Appointments</span>
                </h3>
                <span className="text-xs text-[#6F737D] tabular-nums">
                  {appointments.length} total
                </span>
              </div>
              {appointments.length === 0 ? (
                <EmptyState
                  icon={<Calendar className="w-5 h-5" />}
                  title="No scheduled appointments"
                  description="New salon appointments will appear here once synced."
                />
              ) : (
                <div className="space-y-2.5">
                  {appointments.map((apt) => (
                    <div
                      key={apt.id}
                      className="p-3.5 bg-[#F9FAFC] border border-[#E5E7EC] rounded-2xl flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-[#2F3033] truncate">
                          {apt.customerName} ({apt.customerPhone})
                        </p>
                        <p className="text-[#6F737D] mt-0.5 truncate">
                          {apt.serviceName} · Stylist: {apt.stylistName}
                        </p>
                      </div>
                      <div className="text-right shrink-0 space-y-1">
                        <span className="font-mono text-[#FF1B7A] font-semibold block">
                          {apt.appointmentTime}
                        </span>
                        <StatusBadge label={apt.status.toUpperCase()} tone="success" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activePosView === 'secondary' && category === 'restaurant' && (
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-[#2F3033]">Restaurant Seating &amp; Tables</h3>
              {restaurantTables.length === 0 ? (
                <EmptyState title="No table layout configured" />
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {restaurantTables.map((tbl) => (
                    <button
                      key={tbl.tableNumber}
                      type="button"
                      onClick={() => {
                        setSelectedTable(tbl.tableNumber);
                        setActivePosView('billing');
                      }}
                      className={`p-4 rounded-2xl border text-center transition cursor-pointer ${
                        selectedTable === tbl.tableNumber
                          ? 'border-[#FF6A00] bg-[#FFF7ED]'
                          : 'border-[#E5E7EC] bg-white hover:border-[#D3D7E0]'
                      }`}
                    >
                      <p className="font-bold text-[#2F3033] text-sm">{tbl.tableNumber}</p>
                      <p className="text-[11px] text-[#6F737D] mt-0.5">{tbl.capacity} Seats</p>
                      <div className="mt-2">
                        <StatusBadge
                          label={tbl.status.toUpperCase()}
                          tone={tbl.status === 'occupied' ? 'danger' : 'success'}
                        />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      {/* Right 5 Cols: Thermal Receipt & KOT Preview */}
      <div className="lg:col-span-5 space-y-4">
        {activeReceiptPreview ? (
          <Card padding="md">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E5E7EC]">
              <span className="text-xs font-bold text-[#2F3033] flex items-center gap-1.5">
                <Receipt className="w-4 h-4 text-[#15803D]" />
                <span>Thermal Receipt Preview ({paperWidthMm}mm)</span>
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="success"
                  size="sm"
                  onClick={openBrowserPrintDialog}
                  disabled={isPrinterBusy}
                  leftIcon={<Printer className="w-3.5 h-3.5" />}
                >
                  Print Copy
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setActiveReceiptPreview(null)}
                >
                  Clear
                </Button>
              </div>
            </div>

            <ThermalReceiptSlip receipt={activeReceiptPreview} paperWidthMm={paperWidthMm} />
          </Card>
        ) : (
          <Card padding="lg" className="text-center space-y-2.5">
            <div className="w-11 h-11 rounded-2xl bg-[#F5F6FA] border border-[#E5E7EC] flex items-center justify-center mx-auto text-[#6F737D]">
              <Printer className="w-5 h-5" />
            </div>
            <p className="text-sm font-bold text-[#2F3033]">
              Thermal Receipt Preview ({paperWidthMm}mm)
            </p>
            <p className="text-xs text-[#6F737D] leading-relaxed max-w-sm mx-auto">
              When a bill is created, a {paperWidthMm}mm print-ready receipt renders here and opens the browser print dialog. Native Bluetooth ESC/POS printing runs in the Android app.
            </p>
          </Card>
        )}

        {/* Print-only Portal (PRESERVED IDENTICALLY) */}
        {activeReceiptPreview &&
          typeof document !== 'undefined' &&
          createPortal(
            <div
              id="smav-print-portal"
              className={paperWidthMm === 58 ? 'paper-58mm' : 'paper-80mm'}
            >
              <ThermalReceiptSlip
                receipt={activeReceiptPreview}
                paperWidthMm={paperWidthMm}
                printOnly
              />
            </div>,
            document.body
          )}

        {activeKotPreview && (
          <Card padding="md">
            <span className="text-xs font-bold text-[#2F3033] flex items-center gap-1.5 mb-3">
              <ChefHat className="w-4 h-4 text-[#D97706]" />
              <span>Kitchen Order Ticket (KOT - NO PRICES)</span>
            </span>
            <div className="bg-[#FFFBEB] text-[#111827] font-mono text-[11px] p-4 rounded-xl border border-[#FDE68A]">
              <p className="text-center font-bold text-xs">*** KITCHEN ORDER TICKET ***</p>
              <p className="text-center text-[10px]">
                Token: #{activeKotPreview.tokenNumber} · {activeKotPreview.tableOrCounter}
              </p>
              <div className="my-2 border-t border-dashed border-[#9CA3AF] pt-1 space-y-1">
                {activeKotPreview.items?.map((it: any, i: number) => (
                  <div key={i} className="flex justify-between font-bold">
                    <span>
                      {it.quantity}x {it.name}
                    </span>
                    <span className="text-[10px] text-[#4B5563]">{it.variant}</span>
                  </div>
                ))}
              </div>
              <p className="text-center text-[9px] text-[#6B7280] pt-1 border-t border-dashed border-[#9CA3AF]">
                Time: {activeKotPreview.timestamp}
              </p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
};

interface ThermalReceiptSlipProps {
  receipt: any;
  paperWidthMm: 58 | 80;
  printOnly?: boolean;
}

const WhatsAppMark = () => (
  <svg viewBox="0 0 24 24" aria-label="WhatsApp" className="w-3 h-3 shrink-0" fill="none">
    <path d="M20 11.7a8 8 0 0 1-11.8 7L4 20l1.3-4.1A8 8 0 1 1 20 11.7Z" stroke="currentColor" strokeWidth="1.8" />
    <path d="M8.3 7.7c.4 3.8 2.4 5.8 6.1 6.4l1.4-1.5-2.1-1-1 1c-1.5-.6-2.5-1.6-3.1-3.1l1-1-1-2.1-1.3 1.3Z" fill="currentColor" />
  </svg>
);

const ThermalReceiptSlip: React.FC<ThermalReceiptSlipProps> = ({
  receipt,
  paperWidthMm,
  printOnly = false,
}) => (
  <div
    className={`bg-white text-[#111827] font-mono text-[11px] ${
      printOnly
        ? 'w-full p-2'
        : `mx-auto mt-4 p-5 rounded-xl border border-[#E5E7EC] shadow-sm ${
            paperWidthMm === 58 ? 'max-w-[280px]' : 'max-w-[340px]'
          }`
    }`}
  >
    <div className="text-center pb-2 border-b border-dashed border-[#9CA3AF] space-y-0.5">
      <p className="font-bold text-xs uppercase leading-tight">
        {receipt.businessType === 'salon' ? 'THE GLOSSY LOOKS' : receipt.outletName}
      </p>
      {receipt.businessType === 'salon' ? (
        <>
          <p className="text-[10px] text-[#374151]">Professional Womens Salon</p>
          <p className="text-[9px] text-[#111827] inline-flex items-center justify-center gap-1">
            <WhatsAppMark />
            <span>9966970003 (G) · 9154744608 (K)</span>
          </p>
        </>
      ) : receipt.receiptHeader ? (
        <p className="text-[10px] text-[#374151]">{receipt.receiptHeader}</p>
      ) : null}
      {receipt.outletAddress && <p className="text-[10px] text-[#4B5563]">{receipt.outletAddress}</p>}
      {receipt.businessType !== 'salon' && receipt.outletPhone && (
        <p className="text-[10px] text-[#4B5563]">Tel: {receipt.outletPhone}</p>
      )}
      {receipt.outletGstin && <p className="text-[10px] text-[#4B5563]">GSTIN: {receipt.outletGstin}</p>}
      <p className="text-[10px] text-[#4B5563] pt-1">Date: {receipt.timestamp}</p>
      <p className="font-bold text-[10px]">Bill No: {receipt.billNumber || receipt.orderNumber}</p>
      {receipt.paymentMode && <p className="text-[10px] uppercase">Mode: {receipt.paymentMode}</p>}
    </div>

    {(receipt.customerName || receipt.customerPhone) && (
      <div className="py-1.5 border-b border-dashed border-[#9CA3AF] text-[10px] space-y-0.5">
        <div className="flex justify-between gap-2">
          <span>Customer:</span>
          <span className="font-semibold text-right">
            {receipt.customerName || 'Walk-in Customer'}
          </span>
        </div>
        {receipt.customerPhone && (
          <div className="flex justify-between gap-2">
            <span>Phone:</span>
            <span className="text-right">{receipt.customerPhone}</span>
          </div>
        )}
      </div>
    )}

    <div className="py-2.5 border-b border-dashed border-[#9CA3AF] space-y-1.5">
      {receipt.items?.map((it: any, i: number) => (
        <div key={i}>
          <div className="flex justify-between gap-2">
            <span className="truncate">
              {it.quantity}x {it.name}
            </span>
            <span className="font-bold shrink-0">₹{it.price * it.quantity}</span>
          </div>
          {it.stylist && (
            <p className="text-[10px] text-[#4B5563] pl-3">Stylist: {it.stylist}</p>
          )}
        </div>
      ))}
    </div>

    <div className="py-2 space-y-0.5">
      <div className="flex justify-between">
        <span>Subtotal:</span>
        <span>₹{receipt.subtotal}</span>
      </div>
      <div className="flex justify-between text-[#374151]">
        <span>Discount:</span>
        <span>-₹{receipt.discount ?? 0}</span>
      </div>
      <div className="flex justify-between">
        <span>GST:</span>
        <span>₹{receipt.tax}</span>
      </div>
      <div className="flex justify-between font-bold text-xs pt-1.5 border-t border-[#9CA3AF]">
        <span>GRAND TOTAL:</span>
        <span>₹{receipt.grandTotal}</span>
      </div>
    </div>

    <div className="text-center pt-2 border-t border-dashed border-[#9CA3AF] text-[9px] text-[#4B5563]">
      <p>{receipt.receiptFooter || 'Thank you! Visit us again.'}</p>
    </div>
  </div>
);
