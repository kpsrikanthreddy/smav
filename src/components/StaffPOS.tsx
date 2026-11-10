import React, { useState, useEffect } from 'react';
import {
  Scissors,
  Utensils,
  ShoppingBag,
  Wifi,
  WifiOff,
  Printer,
  Plus,
  Trash2,
  Calendar,
  AlertTriangle,
  Receipt,
  FileCode2,
  CheckCircle2,
  Search,
  Sparkles,
  ChefHat
} from 'lucide-react';
import {
  UserSession,
  SalonService,
  Stylist,
  Appointment,
  RestaurantMenuItem,
  RestaurantTable,
  RetailProduct,
  SalonCartItem,
  RestaurantCartItem,
  RetailCartItem
} from '../types';

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

export const StaffPOS: React.FC<StaffPOSProps> = ({
  session,
  isOnline,
  onToggleOnline,
  isPrinterConnected,
  onTogglePrinter,
  paperWidthMm,
  onChangePaperWidth,
  serverRevision,
  localRevision,
  onPerformDeltaSync
}) => {
  const category = session.activeOutlet.category;
  const [activePosView, setActivePosView] = useState<'billing' | 'catalog' | 'secondary'>('billing');
  const [catalogError, setCatalogError] = useState<string | null>(null);

  // Salon Data
  const [salonServices, setSalonServices] = useState<SalonService[]>([]);
  const [stylists, setStylists] = useState<Stylist[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [salonCart, setSalonCart] = useState<SalonCartItem[]>([]);
  const [customerName, setCustomerName] = useState('Ananya Sharma');
  const [customerPhone, setCustomerPhone] = useState('9848011223');
  const [paymentMode, setPaymentMode] = useState('upi');

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

  // Printing & Previews
  const [activeReceiptPreview, setActiveReceiptPreview] = useState<any | null>(null);
  const [activeKotPreview, setActiveKotPreview] = useState<any | null>(null);
  const [isPrinterBusy, setIsPrinterBusy] = useState(false);
  const [offlineQueue, setOfflineQueue] = useState<any[]>([]);

  // Initialize POS Data for assigned outlet
  useEffect(() => {
    const loadPosData = async () => {
      try {
        const res = await fetch('/api/pos/init', {
          headers: { Authorization: `Bearer ${session.token}` }
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          setCatalogError(data.message || 'Catalog unavailable. Check outlet registration and upstream API.');
          return;
        }
        setCatalogError(null);
        if (data.success) {
          if (data.category === 'salon') {
            setSalonServices(data.services || []);
            setStylists(data.stylists || []);
            setAppointments(data.appointments || []);
            if (data.services && data.services.length >= 2 && salonCart.length === 0) {
              setSalonCart([
                { service: data.services[0], stylist: data.stylists?.[0] || null, quantity: 1, discountPercent: 10, addedPrice: data.services[0].price, addedRevision: data.services[0].revision },
                { service: data.services[1], stylist: data.stylists?.[1] || null, quantity: 1, discountPercent: 0, addedPrice: data.services[1].price, addedRevision: data.services[1].revision }
              ]);
            }
          } else if (data.category === 'restaurant') {
            setRestaurantMenu(data.menu || []);
            setRestaurantTables(data.tables || []);
            if (data.menu && data.menu.length >= 2 && restaurantCart.length === 0) {
              setRestaurantCart([
                { item: data.menu[0], variantName: 'Regular Portion', unitPrice: data.menu[0].basePrice, quantity: 2, notes: 'Medium spicy', addedPrice: data.menu[0].basePrice, addedRevision: data.menu[0].revision },
                { item: data.menu[1], variantName: 'Regular Portion', unitPrice: data.menu[1].basePrice, quantity: 1, notes: 'Extra crispy', addedPrice: data.menu[1].basePrice, addedRevision: data.menu[1].revision }
              ]);
            }
          } else {
            setRetailProducts(data.products || []);
            if (data.products && data.products.length >= 2 && retailCart.length === 0) {
              setRetailCart([
                { product: data.products[0], quantity: 1, discountPercent: 5, addedPrice: data.products[0].price, addedRevision: data.products[0].revision },
                { product: data.products[1], quantity: 1, discountPercent: 0, addedPrice: data.products[1].price, addedRevision: data.products[1].revision }
              ]);
            }
          }
        }
      } catch (e) {
        console.error(e);
        setCatalogError('Could not load POS catalog from SMAV backend.');
      }
    };

    loadPosData();
  }, [session.activeOutlet.id]);

  // Salon Financial Calculations
  const salonSubtotal = salonCart.reduce((sum, i) => sum + i.addedPrice * i.quantity, 0);
  const salonDiscount = salonCart.reduce((sum, i) => sum + (i.addedPrice * i.quantity * (i.discountPercent / 100)), 0);
  const salonTaxable = salonSubtotal - salonDiscount;
  const salonTax = Math.round(salonTaxable * 0.18);
  const salonGrandTotal = salonTaxable + salonTax;

  // Restaurant Financial Calculations
  const restSubtotal = restaurantCart.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
  const restTax = Math.round(restSubtotal * 0.05); // 5% GST on Restaurant
  const restGrandTotal = restSubtotal + restTax;

  // Retail Financial Calculations
  const retailSubtotal = retailCart.reduce((sum, i) => sum + i.addedPrice * i.quantity, 0);
  const retailDiscount = retailCart.reduce((sum, i) => sum + (i.addedPrice * i.quantity * (i.discountPercent / 100)), 0);
  const retailTaxable = retailSubtotal - retailDiscount;
  const retailTax = Math.round(retailTaxable * 0.12); // 12% GST average
  const retailGrandTotal = retailTaxable + retailTax;

  // Print Salon Bill
  const handlePrintSalonBill = () => {
    if (salonCart.length === 0) return;
    const billNumber = `TGL-${session.activeOutlet.code.toUpperCase()}-${Date.now().toString().slice(-6)}`;
    const bill = {
      billNumber,
      outletName: session.activeOutlet.name,
      receiptHeader: session.activeOutlet.receiptHeader,
      receiptFooter: session.activeOutlet.receiptFooter,
      customerName,
      customerPhone,
      paymentMode,
      items: salonCart.map(c => ({
        name: c.service.name,
        price: c.addedPrice,
        quantity: c.quantity,
        stylist: c.stylist?.name || 'Assigned Stylist'
      })),
      subtotal: salonSubtotal,
      discount: salonDiscount,
      tax: salonTax,
      grandTotal: salonGrandTotal,
      paperWidth: paperWidthMm,
      timestamp: new Date().toLocaleString()
    };

    if (isPrinterConnected) {
      setIsPrinterBusy(true);
      setTimeout(() => setIsPrinterBusy(false), 1200);
    }

    setActiveReceiptPreview(bill);

    // Sync or queue
    if (isOnline) {
      fetch('/api/mobile/sync/bills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bills: [{ bill: { ...bill, billNumber, outletId: session.activeOutlet.id }, items: bill.items, idempotency_key: `IDEM_${billNumber}` }]
        })
      });
    } else {
      setOfflineQueue(prev => [...prev, bill]);
    }
  };

  // Print Restaurant Order
  const handlePrintRestaurantOrder = () => {
    if (restaurantCart.length === 0) return;
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
      items: restaurantCart.map(c => ({
        name: c.item.name,
        variant: c.variantName,
        price: c.unitPrice,
        quantity: c.quantity,
        notes: c.notes
      })),
      subtotal: restSubtotal,
      tax: restTax,
      grandTotal: restGrandTotal,
      paperWidth: paperWidthMm,
      timestamp: new Date().toLocaleString()
    };

    if (isPrinterConnected) {
      setIsPrinterBusy(true);
      setTimeout(() => setIsPrinterBusy(false), 1200);
    }

    setActiveReceiptPreview(order);
    setActiveKotPreview(order); // Generates KOT without prices!

    if (isOnline) {
      fetch('/api/mobile/sync/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orders: [{ order: { ...order, orderNumber, tokenNumber, outletId: session.activeOutlet.id }, items: order.items, idempotency_key: `IDEM_${orderNumber}` }]
        })
      });
    } else {
      setOfflineQueue(prev => [...prev, order]);
    }
  };

  // Print Retail Bill
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
      items: retailCart.map(c => ({
        name: c.product.name,
        sku: c.product.sku,
        price: c.addedPrice,
        quantity: c.quantity
      })),
      subtotal: retailSubtotal,
      discount: retailDiscount,
      tax: retailTax,
      grandTotal: retailGrandTotal,
      paperWidth: paperWidthMm,
      timestamp: new Date().toLocaleString()
    };

    if (isPrinterConnected) {
      setIsPrinterBusy(true);
      setTimeout(() => setIsPrinterBusy(false), 1200);
    }

    setActiveReceiptPreview(bill);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {catalogError && <div role="alert" className="lg:col-span-12 rounded-lg border border-red-500/50 bg-red-950/40 p-3 text-red-200">{catalogError}</div>}

      {/* Left 7 Cols: Counter Terminal Frame */}
      <div className="lg:col-span-7 bg-[#121629] border border-[#1e2540] rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        
        {/* Terminal Simulation Bar */}
        <div className="bg-[#0e1222] px-4 py-2.5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-400 font-medium">Device:</span>
            <button
              onClick={onToggleOnline}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-semibold transition ${
                isOnline
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
              }`}
            >
              {isOnline ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
              {isOnline ? 'Online Sync' : 'Offline Mode'}
            </button>

            <button
              onClick={onTogglePrinter}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-semibold transition ${
                isPrinterConnected
                  ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                  : 'bg-slate-800 text-slate-400 border border-slate-700'
              }`}
            >
              <Printer className="w-3.5 h-3.5" />
              {isPrinterConnected ? `BT ESC/POS (${paperWidthMm}mm)` : 'Printer Disconnected'}
            </button>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-800/90 rounded-md p-0.5 border border-slate-700 text-[11px]">
            <span className="text-slate-400 px-1.5">Roll:</span>
            <button
              onClick={() => onChangePaperWidth(80)}
              className={`px-2 py-0.5 rounded font-bold transition ${paperWidthMm === 80 ? 'bg-pink-600 text-white' : 'text-slate-400'}`}
            >
              80mm
            </button>
            <button
              onClick={() => onChangePaperWidth(58)}
              className={`px-2 py-0.5 rounded font-bold transition ${paperWidthMm === 58 ? 'bg-pink-600 text-white' : 'text-slate-400'}`}
            >
              58mm
            </button>
          </div>
        </div>

        {/* Offline Warning Notice */}
        {!isOnline && (
          <div className="bg-amber-500/15 border-b border-amber-500/30 px-4 py-2 flex items-center justify-between">
            <div className="flex items-center gap-2 text-amber-300 text-xs">
              <WifiOff className="w-4 h-4 text-amber-400" />
              <span>Offline: Transactions safely cached locally in SQLite/Room. Will auto-sync when online.</span>
            </div>
            {offlineQueue.length > 0 && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-300">
                {offlineQueue.length} Queued
              </span>
            )}
          </div>
        )}

        {/* Sub-View Navigation Tabs */}
        <div className="bg-slate-900 border-b border-slate-800 px-4 py-2 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActivePosView('billing')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                activePosView === 'billing' ? 'bg-pink-600 text-white shadow' : 'text-slate-400 hover:bg-slate-800'
              }`}
            >
              Active Cart ({category === 'salon' ? salonCart.length : category === 'restaurant' ? restaurantCart.length : retailCart.length})
            </button>
            <button
              onClick={() => setActivePosView('catalog')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                activePosView === 'catalog' ? 'bg-pink-600 text-white shadow' : 'text-slate-400 hover:bg-slate-800'
              }`}
            >
              {category === 'salon' ? 'Catalog Services' : category === 'restaurant' ? 'Menu Items' : 'Products'}
            </button>
            {category === 'salon' && (
              <button
                onClick={() => setActivePosView('secondary')}
                className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                  activePosView === 'secondary' ? 'bg-pink-600 text-white shadow' : 'text-slate-400 hover:bg-slate-800'
                }`}
              >
                Appointments ({appointments.length})
              </button>
            )}
            {category === 'restaurant' && (
              <button
                onClick={() => setActivePosView('secondary')}
                className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                  activePosView === 'secondary' ? 'bg-pink-600 text-white shadow' : 'text-slate-400 hover:bg-slate-800'
                }`}
              >
                Tables & Seating
              </button>
            )}
          </div>

          <span className="text-[11px] font-mono text-sky-400">
            Rev #{localRevision}
          </span>
        </div>

        {/* POS Body Content */}
        <div className="p-5 space-y-4 flex-1">
          
          {/* ============================================================================== */}
          {/* VIEW 1: BILLING CART                                                           */}
          {/* ============================================================================== */}
          {activePosView === 'billing' && (
            <div className="space-y-4">
              
              {/* SALON CART */}
              {category === 'salon' && (
                <div className="space-y-3">
                  <div className="space-y-2">
                    {salonCart.map((item, idx) => (
                      <div key={idx} className="bg-[#161a33] border border-[#2a3055] rounded-xl p-3 flex items-center justify-between gap-3 text-xs">
                        <div className="flex-1">
                          <p className="font-bold text-white">{item.service.name}</p>
                          <p className="text-[11px] text-slate-400">
                            Stylist: {item.stylist?.name || 'Any Available'} • Price: ₹{item.addedPrice}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white font-mono">₹{item.addedPrice * item.quantity}</span>
                          <button
                            onClick={() => setSalonCart(prev => prev.filter((_, i) => i !== idx))}
                            className="text-slate-400 hover:text-rose-400 p-1"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Customer Information */}
                  <div className="grid grid-cols-2 gap-3 text-xs pt-2">
                    <div>
                      <label className="text-slate-400 block mb-1">Customer Name</label>
                      <input
                        type="text"
                        value={customerName}
                        onChange={e => setCustomerName(e.target.value)}
                        className="w-full bg-[#161a33] border border-[#2a3055] rounded-xl px-3 py-2 text-white"
                      />
                    </div>
                    <div>
                      <label className="text-slate-400 block mb-1">Phone (WhatsApp Receipt)</label>
                      <input
                        type="text"
                        value={customerPhone}
                        onChange={e => setCustomerPhone(e.target.value)}
                        className="w-full bg-[#161a33] border border-[#2a3055] rounded-xl px-3 py-2 text-white"
                      />
                    </div>
                  </div>

                  {/* Payment Summary */}
                  <div className="bg-[#0e1222] p-4 rounded-xl border border-slate-800 space-y-1.5 text-xs">
                    <div className="flex justify-between text-slate-400"><span>Subtotal:</span><span>₹{salonSubtotal}</span></div>
                    <div className="flex justify-between text-slate-400"><span>Discount:</span><span className="text-amber-400">-₹{salonDiscount}</span></div>
                    <div className="flex justify-between text-slate-400"><span>GST Tax (18%):</span><span>₹{salonTax}</span></div>
                    <div className="flex justify-between text-sm font-bold text-white pt-2 border-t border-slate-800">
                      <span>Grand Total:</span>
                      <span className="text-emerald-400 font-mono">₹{salonGrandTotal}</span>
                    </div>
                  </div>

                  <button
                    onClick={handlePrintSalonBill}
                    disabled={salonCart.length === 0}
                    className="w-full py-3.5 rounded-xl bg-gradient-to-r from-pink-500 to-orange-500 hover:brightness-110 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg transition"
                  >
                    <Printer className="w-4 h-4" />
                    Print Salon Receipt (ESC/POS)
                  </button>
                </div>
              )}

              {/* RESTAURANT CART */}
              {category === 'restaurant' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-xs pb-1">
                    <div>
                      <label className="text-slate-400 block mb-1">Table / Counter</label>
                      <select
                        value={selectedTable}
                        onChange={e => setSelectedTable(e.target.value)}
                        className="w-full bg-[#161a33] border border-[#2a3055] rounded-xl px-3 py-2 text-white"
                      >
                        <option value="Table 1">Table 1 (2 Pax)</option>
                        <option value="Table 2">Table 2 (4 Pax)</option>
                        <option value="Table 3">Table 3 (4 Pax)</option>
                        <option value="Counter 1">Counter 1 (Fast Bite)</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-slate-400 block mb-1">Order Mode</label>
                      <select
                        value={orderType}
                        onChange={e => setOrderType(e.target.value as any)}
                        className="w-full bg-[#161a33] border border-[#2a3055] rounded-xl px-3 py-2 text-white"
                      >
                        <option value="dine_in">Dine In</option>
                        <option value="takeaway">Takeaway</option>
                        <option value="counter">Express Counter</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {restaurantCart.map((item, idx) => (
                      <div key={idx} className="bg-[#161a33] border border-[#2a3055] rounded-xl p-3 flex items-center justify-between gap-3 text-xs">
                        <div className="flex-1">
                          <p className="font-bold text-white flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full ${item.item.isVeg ? 'bg-emerald-400' : 'bg-rose-500'}`} />
                            {item.item.name}
                          </p>
                          <p className="text-[11px] text-slate-400">{item.variantName} • Qty: {item.quantity}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white font-mono">₹{item.unitPrice * item.quantity}</span>
                          <button
                            onClick={() => setRestaurantCart(prev => prev.filter((_, i) => i !== idx))}
                            className="text-slate-400 hover:text-rose-400 p-1"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="bg-[#0e1222] p-4 rounded-xl border border-slate-800 space-y-1.5 text-xs">
                    <div className="flex justify-between text-slate-400"><span>Food Subtotal:</span><span>₹{restSubtotal}</span></div>
                    <div className="flex justify-between text-slate-400"><span>Restaurant GST (5%):</span><span>₹{restTax}</span></div>
                    <div className="flex justify-between text-sm font-bold text-white pt-2 border-t border-slate-800">
                      <span>Order Total:</span>
                      <span className="text-emerald-400 font-mono">₹{restGrandTotal}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={handlePrintRestaurantOrder}
                      disabled={restaurantCart.length === 0}
                      className="py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs flex items-center justify-center gap-1.5 border border-slate-700 transition"
                    >
                      <ChefHat className="w-4 h-4 text-amber-400" />
                      Print KOT (No Price)
                    </button>
                    <button
                      onClick={handlePrintRestaurantOrder}
                      disabled={restaurantCart.length === 0}
                      className="py-3 rounded-xl bg-gradient-to-r from-pink-500 to-orange-500 hover:brightness-110 text-white font-semibold text-xs flex items-center justify-center gap-1.5 shadow transition"
                    >
                      <Printer className="w-4 h-4" />
                      Print Dine Bill
                    </button>
                  </div>
                </div>
              )}

              {/* RETAIL CART */}
              {category === 'retail' && (
                <div className="space-y-3">
                  <div className="space-y-2">
                    {retailCart.map((item, idx) => (
                      <div key={idx} className="bg-[#161a33] border border-[#2a3055] rounded-xl p-3 flex items-center justify-between gap-3 text-xs">
                        <div className="flex-1">
                          <p className="font-bold text-white">{item.product.name}</p>
                          <p className="text-[11px] text-slate-400">SKU: {item.product.sku} • Price: ₹{item.addedPrice}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white font-mono">₹{item.addedPrice * item.quantity}</span>
                          <button
                            onClick={() => setRetailCart(prev => prev.filter((_, i) => i !== idx))}
                            className="text-slate-400 hover:text-rose-400 p-1"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="bg-[#0e1222] p-4 rounded-xl border border-slate-800 space-y-1.5 text-xs">
                    <div className="flex justify-between text-slate-400"><span>Subtotal:</span><span>₹{retailSubtotal}</span></div>
                    <div className="flex justify-between text-slate-400"><span>Retail GST (12%):</span><span>₹{retailTax}</span></div>
                    <div className="flex justify-between text-sm font-bold text-white pt-2 border-t border-slate-800">
                      <span>Grand Total:</span>
                      <span className="text-emerald-400 font-mono">₹{retailGrandTotal}</span>
                    </div>
                  </div>

                  <button
                    onClick={handlePrintRetailBill}
                    disabled={retailCart.length === 0}
                    className="w-full py-3.5 rounded-xl bg-gradient-to-r from-pink-500 to-orange-500 hover:brightness-110 text-white font-bold text-sm flex items-center justify-center gap-2 shadow"
                  >
                    <Printer className="w-4 h-4" />
                    Print Retail Bill (ESC/POS)
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ============================================================================== */}
          {/* VIEW 2: CATALOG ITEM SELECTION                                                 */}
          {/* ============================================================================== */}
          {activePosView === 'catalog' && (
            <div className="space-y-3">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search catalog items..."
                  className="w-full bg-[#161a33] border border-[#2a3055] rounded-xl pl-10 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-pink-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[460px] overflow-y-auto pr-1">
                {category === 'salon' && salonServices.map(srv => (
                  <div
                    key={srv.id}
                    onClick={() => {
                      setSalonCart(prev => [...prev, { service: srv, stylist: stylists[0] || null, quantity: 1, discountPercent: 0, addedPrice: srv.price, addedRevision: srv.revision }]);
                      setActivePosView('billing');
                    }}
                    className="p-3 bg-[#161a33] border border-[#2a3055] hover:border-pink-500/60 rounded-xl cursor-pointer transition flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-slate-400 font-mono">{srv.category}</span>
                        <span className="text-xs font-bold text-emerald-400 font-mono">₹{srv.price}</span>
                      </div>
                      <p className="text-xs font-bold text-white mt-1">{srv.name}</p>
                    </div>
                    <button className="mt-2 text-[11px] font-semibold text-pink-400 flex items-center gap-1">
                      <Plus className="w-3.5 h-3.5" /> Add to Bill
                    </button>
                  </div>
                ))}

                {category === 'restaurant' && restaurantMenu.map(menuItem => (
                  <div
                    key={menuItem.id}
                    onClick={() => {
                      setRestaurantCart(prev => [...prev, { item: menuItem, variantName: 'Regular', unitPrice: menuItem.basePrice, quantity: 1, notes: '', addedPrice: menuItem.basePrice, addedRevision: menuItem.revision }]);
                      setActivePosView('billing');
                    }}
                    className="p-3 bg-[#161a33] border border-[#2a3055] hover:border-amber-500/60 rounded-xl cursor-pointer transition flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-slate-400 font-mono">{menuItem.category}</span>
                        <span className="text-xs font-bold text-emerald-400 font-mono">₹{menuItem.basePrice}</span>
                      </div>
                      <p className="text-xs font-bold text-white mt-1 flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${menuItem.isVeg ? 'bg-emerald-400' : 'bg-rose-500'}`} />
                        {menuItem.name}
                      </p>
                    </div>
                    <button className="mt-2 text-[11px] font-semibold text-amber-400 flex items-center gap-1">
                      <Plus className="w-3.5 h-3.5" /> Add to Order
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ============================================================================== */}
          {/* VIEW 3: SECONDARY VIEW (APPOINTMENTS OR TABLES)                                */}
          {/* ============================================================================== */}
          {activePosView === 'secondary' && category === 'salon' && (
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-white">Today's Scheduled Appointments</h3>
              <div className="space-y-2">
                {appointments.map(apt => (
                  <div key={apt.id} className="p-3 bg-[#161a33] border border-[#2a3055] rounded-xl flex items-center justify-between text-xs">
                    <div>
                      <p className="font-bold text-white">{apt.customerName} ({apt.customerPhone})</p>
                      <p className="text-slate-400 text-[11px]">{apt.serviceName} • Stylist: {apt.stylistName}</p>
                    </div>
                    <div className="text-right">
                      <span className="font-mono text-pink-400 font-semibold">{apt.appointmentTime}</span>
                      <span className="block text-[10px] uppercase text-emerald-400 font-bold">{apt.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activePosView === 'secondary' && category === 'restaurant' && (
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-white">Restaurant Seating & Tables</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {restaurantTables.map(tbl => (
                  <div
                    key={tbl.tableNumber}
                    onClick={() => {
                      setSelectedTable(tbl.tableNumber);
                      setActivePosView('billing');
                    }}
                    className={`p-4 rounded-xl border cursor-pointer transition text-center ${
                      selectedTable === tbl.tableNumber
                        ? 'border-amber-500 bg-amber-500/10'
                        : 'border-slate-800 bg-[#161a33] hover:border-slate-700'
                    }`}
                  >
                    <p className="font-bold text-white text-sm">{tbl.tableNumber}</p>
                    <p className="text-[11px] text-slate-400 mt-1">{tbl.capacity} Seats</p>
                    <span className={`inline-block mt-2 px-2 py-0.5 rounded text-[10px] font-bold ${
                      tbl.status === 'occupied' ? 'bg-rose-500/20 text-rose-300' : 'bg-emerald-500/20 text-emerald-300'
                    }`}>
                      {tbl.status.toUpperCase()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right 5 Cols: Live ESC/POS Thermal Receipt Paper Simulation */}
      <div className="lg:col-span-5 space-y-4">
        {activeReceiptPreview ? (
          <div className="bg-[#121629] border border-[#1e2540] rounded-2xl p-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <span className="text-xs font-bold text-white flex items-center gap-1.5">
                <Receipt className="w-4 h-4 text-emerald-400" />
                ESC/POS Thermal Paper ({paperWidthMm}mm Roll)
              </span>
              <button
                onClick={() => setActiveReceiptPreview(null)}
                className="text-xs text-slate-400 hover:text-white"
              >
                Clear
              </button>
            </div>

            {/* Thermal Print Slip Mockup */}
            <div className={`mx-auto my-4 bg-white text-slate-900 font-mono text-[11px] p-5 rounded shadow-xl ${
              paperWidthMm === 58 ? 'max-w-[280px]' : 'max-w-[340px]'
            }`}>
              <div className="text-center pb-2 border-b border-dashed border-slate-400">
                <p className="font-bold text-xs uppercase leading-tight">{activeReceiptPreview.outletName}</p>
                <p className="text-[10px] text-slate-600 mt-0.5">{activeReceiptPreview.receiptHeader}</p>
                <p className="text-[10px] text-slate-500 mt-1">Date: {activeReceiptPreview.timestamp}</p>
                <p className="font-bold text-[10px]">No: {activeReceiptPreview.billNumber || activeReceiptPreview.orderNumber}</p>
              </div>

              <div className="py-2.5 border-b border-dashed border-slate-400 space-y-1">
                {activeReceiptPreview.items?.map((it: any, i: number) => (
                  <div key={i} className="flex justify-between">
                    <span className="truncate pr-2">{it.quantity}x {it.name}</span>
                    <span className="font-bold">₹{it.price * it.quantity}</span>
                  </div>
                ))}
              </div>

              <div className="py-2 space-y-0.5">
                <div className="flex justify-between"><span>Subtotal:</span><span>₹{activeReceiptPreview.subtotal}</span></div>
                {activeReceiptPreview.discount > 0 && (
                  <div className="flex justify-between text-slate-600"><span>Discount:</span><span>-₹{activeReceiptPreview.discount}</span></div>
                )}
                <div className="flex justify-between"><span>GST:</span><span>₹{activeReceiptPreview.tax}</span></div>
                <div className="flex justify-between font-bold text-xs pt-1.5 border-t border-slate-400">
                  <span>TOTAL:</span>
                  <span>₹{activeReceiptPreview.grandTotal}</span>
                </div>
              </div>

              <div className="text-center pt-2 border-t border-dashed border-slate-400 text-[9px] text-slate-500">
                <p>{activeReceiptPreview.receiptFooter}</p>
                <p className="mt-1 font-bold text-[8px] uppercase">=== SMAV THERMAL AGENT ===</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-[#121629] border border-[#1e2540] rounded-2xl p-8 text-center text-slate-400 shadow-xl space-y-3">
            <Printer className="w-8 h-8 text-slate-500 mx-auto" />
            <p className="text-xs font-semibold text-white">ESC/POS Thermal Receipt Simulation</p>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              When an order or bill is placed, a simulated 80mm/58mm thermal print receipt will render here matching the native Android Bluetooth thermal output.
            </p>
          </div>
        )}

        {/* KOT Preview if Restaurant Order Placed */}
        {activeKotPreview && (
          <div className="bg-[#121629] border border-[#1e2540] rounded-2xl p-4 shadow-xl">
            <span className="text-xs font-bold text-white flex items-center gap-1.5 mb-2">
              <ChefHat className="w-4 h-4 text-amber-400" />
              Kitchen Order Ticket (KOT - NO PRICES)
            </span>
            <div className="bg-amber-50 text-slate-900 font-mono text-[11px] p-4 rounded border border-amber-200">
              <p className="text-center font-bold text-xs">*** KITCHEN ORDER TICKET ***</p>
              <p className="text-center text-[10px]">Token: #{activeKotPreview.tokenNumber} • {activeKotPreview.tableOrCounter}</p>
              <div className="my-2 border-t border-dashed border-slate-400 pt-1 space-y-1">
                {activeKotPreview.items?.map((it: any, i: number) => (
                  <div key={i} className="flex justify-between font-bold">
                    <span>{it.quantity}x {it.name}</span>
                    <span className="text-[10px] text-slate-600">{it.variant}</span>
                  </div>
                ))}
              </div>
              <p className="text-center text-[9px] text-slate-500 pt-1 border-t border-dashed border-slate-400">
                Time: {activeKotPreview.timestamp}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
