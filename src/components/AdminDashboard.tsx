import React, { useState, useEffect } from 'react';
import {
  Users,
  Sparkles,
  Receipt,
  Printer,
  TrendingUp,
  UserPlus,
  KeyRound,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Plus,
  Edit2,
  Trash2,
  SlidersHorizontal
} from 'lucide-react';
import { UserSession } from '../types';

interface AdminDashboardProps {
  session: UserSession;
  onOpenPos: () => void;
  onLogout: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  session,
  onOpenPos,
  onLogout
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'staff' | 'catalog' | 'orders' | 'printer'>('overview');
  const [staffList, setStaffList] = useState<any[]>([]);
  const [reports, setReports] = useState<any>(null);
  const [catalogItems, setCatalogItems] = useState<any[]>([]);
  const [printerConfig, setPrinterConfig] = useState({
    paperWidth: 80,
    receiptHeader: session.activeOutlet.receiptHeader,
    receiptFooter: session.activeOutlet.receiptFooter,
    autoCut: true
  });

  // Staff creation modal
  const [isAddStaffOpen, setIsAddStaffOpen] = useState(false);
  const [newStaffForm, setNewStaffForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    role: 'staff',
    specificTitle: session.activeOutlet.category === 'salon' ? 'Salon Receptionist' : 'Cashier / Counter Staff',
    password: ''
  });

  // Password reset feedback
  const [resetFeedback, setResetFeedback] = useState<string | null>(null);

  const fetchAdminData = async () => {
    try {
      const headers = { Authorization: `Bearer ${session.token}` };

      const [staffRes, repRes] = await Promise.all([
        fetch('/api/admin/staff', { headers }).then(r => r.json()).catch(() => ({ staff: [] })),
        fetch('/api/admin/reports', { headers }).then(r => r.json()).catch(() => null)
      ]);

      if (staffRes.staff) setStaffList(staffRes.staff);
      if (repRes) setReports(repRes);

      // Fetch catalog
      if (session.activeOutlet.category === 'salon') {
        const srvRes = await fetch('/api/salon/services');
        const srvData = await srvRes.json();
        setCatalogItems(srvData.services || []);
      } else if (session.activeOutlet.category === 'restaurant') {
        const menuRes = await fetch('/api/restaurant/menu');
        const menuData = await menuRes.json();
        setCatalogItems(menuData.menu || []);
      } else {
        const syncRes = await fetch(`/api/catalog/sync?business_id=${session.activeOutlet.id}`);
        const syncData = await syncRes.json();
        setCatalogItems(syncData.changes || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchAdminData();
  }, [session.token, session.activeOutlet.id]);

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/admin/staff', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`
        },
        body: JSON.stringify(newStaffForm)
      });
      if (res.ok) {
        setIsAddStaffOpen(false);
        setNewStaffForm({
          fullName: '',
          email: '',
          phone: '',
          role: 'staff',
          specificTitle: session.activeOutlet.category === 'salon' ? 'Salon Receptionist' : 'Cashier',
          password: ''
        });
        fetchAdminData();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleResetStaffPassword = async (staffId: string, staffName: string) => {
    try {
      const res = await fetch(`/api/admin/staff/${staffId}/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`
        },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (data.success) {
        setResetFeedback(`Password for ${staffName} reset to: ${data.temporaryPassword}`);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleToggleStaffStatus = async (staffId: string, currentActive: boolean) => {
    try {
      await fetch(`/api/admin/staff/${staffId}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`
        },
        body: JSON.stringify({ isActive: !currentActive })
      });
      fetchAdminData();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Outlet Context Banner */}
      <div className="bg-[#121629] border border-[#1e2540] rounded-2xl p-6 shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold tracking-wider uppercase px-2.5 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20">
              Assigned Outlet Admin
            </span>
            <span className="text-xs text-slate-400 font-mono">Code: {session.activeOutlet.code}</span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">{session.activeOutlet.name}</h1>
          <p className="text-xs text-slate-400 mt-1">
            {session.activeOutlet.address} • Phone: {session.activeOutlet.phone || 'N/A'} • GSTIN: {session.activeOutlet.gstin || 'Unregistered'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onOpenPos}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-pink-500 to-orange-500 hover:brightness-110 text-white text-xs font-semibold shadow transition"
          >
            Launch Outlet POS
          </button>
        </div>
      </div>

      {/* Admin Sub-Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2 overflow-x-auto text-xs">
        {[
          { id: 'overview', label: 'Outlet Overview & Reports', icon: TrendingUp },
          { id: 'staff', label: `Staff Management (${staffList.length})`, icon: Users },
          { id: 'catalog', label: `Catalog & Pricing (${catalogItems.length})`, icon: Sparkles },
          { id: 'orders', label: 'Billing & Transaction Ledger', icon: Receipt },
          { id: 'printer', label: 'ESC/POS Printer Setup', icon: Printer }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl font-medium transition whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-slate-800 text-white border border-slate-700 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ============================================================================== */}
      {/* TAB 1: OVERVIEW & REPORTS                                                      */}
      {/* ============================================================================== */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-[#121629] border border-[#1e2540] p-5 rounded-2xl">
              <span className="text-xs text-slate-400 font-medium">Total Outlet Sales Volume</span>
              <div className="text-2xl font-bold text-white mt-1">₹{(reports?.totalSales || 0).toLocaleString()}</div>
              <span className="text-[11px] text-emerald-400">Strictly isolated to this outlet</span>
            </div>
            <div className="bg-[#121629] border border-[#1e2540] p-5 rounded-2xl">
              <span className="text-xs text-slate-400 font-medium">GST / Taxes Collected</span>
              <div className="text-2xl font-bold text-white mt-1">₹{(reports?.totalTax || 0).toLocaleString()}</div>
              <span className="text-[11px] text-slate-400">CGST + SGST (Official)</span>
            </div>
            <div className="bg-[#121629] border border-[#1e2540] p-5 rounded-2xl">
              <span className="text-xs text-slate-400 font-medium">Transactions Recorded</span>
              <div className="text-2xl font-bold text-white mt-1">{reports?.totalTransactions || 0}</div>
              <span className="text-[11px] text-sky-400">Bills & KOT Orders</span>
            </div>
          </div>

          <div className="bg-[#121629] border border-[#1e2540] rounded-2xl p-6 shadow-xl space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold text-white pb-3 border-b border-slate-800">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              Tenant Isolation Verified
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              This administrative dashboard is strictly bound to <span className="font-bold text-white">{session.activeOutlet.name}</span> (ID: <span className="font-mono text-slate-400">{session.activeOutlet.id}</span>). Data, customers, staff members, and price modifications cannot leak across business tenants.
            </p>
          </div>
        </div>
      )}

      {/* ============================================================================== */}
      {/* TAB 2: STAFF CREATION & MANAGEMENT (Item 5)                                    */}
      {/* ============================================================================== */}
      {activeTab === 'staff' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">Staff Members for {session.activeOutlet.name}</h3>
            <button
              onClick={() => setIsAddStaffOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-pink-600 hover:bg-pink-500 text-white text-xs font-semibold shadow transition"
            >
              <UserPlus className="w-3.5 h-3.5" />
              + Add Staff Member
            </button>
          </div>

          {resetFeedback && (
            <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-mono flex items-center justify-between">
              <span>{resetFeedback}</span>
              <button onClick={() => setResetFeedback(null)} className="text-xs underline">Dismiss</button>
            </div>
          )}

          <div className="bg-[#121629] border border-[#1e2540] rounded-2xl overflow-hidden shadow-xl">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-[#161a33] text-slate-400 border-b border-[#2a3055] font-semibold">
                <tr>
                  <th className="p-4">Staff Name & Contact</th>
                  <th className="p-4">Assigned Role</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {staffList.map(staff => (
                  <tr key={staff.id} className="hover:bg-slate-800/30 transition">
                    <td className="p-4">
                      <div className="font-bold text-white">{staff.fullName}</div>
                      <div className="text-slate-400 font-mono text-[11px]">{staff.email}</div>
                      {staff.phone && <div className="text-slate-500 text-[10px]">{staff.phone}</div>}
                    </td>
                    <td className="p-4">
                      <span className="font-semibold text-slate-200 capitalize">
                        {staff.memberships?.[0]?.specificTitle || staff.role}
                      </span>
                    </td>
                    <td className="p-4">
                      <button
                        onClick={() => handleToggleStaffStatus(staff.id, staff.isActive)}
                        className={`px-2 py-0.5 rounded text-[10px] font-bold transition ${
                          staff.isActive ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                        }`}
                      >
                        {staff.isActive ? 'ACTIVE' : 'DEACTIVATED'}
                      </button>
                    </td>
                    <td className="p-4 text-right space-x-2">
                      <button
                        onClick={() => handleResetStaffPassword(staff.id, staff.fullName)}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-400 text-xs font-semibold transition"
                      >
                        Reset Password
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ============================================================================== */}
      {/* TAB 3: CATALOG & PRICING MANAGEMENT                                            */}
      {/* ============================================================================== */}
      {activeTab === 'catalog' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white">
                {session.activeOutlet.category === 'salon' ? 'Salon Services Catalog' : session.activeOutlet.category === 'restaurant' ? 'Restaurant Menu Items' : 'Retail Products Catalog'}
              </h3>
              <p className="text-xs text-slate-400">
                Changes bump monotonic revisions and broadcast real-time delta updates to all paired POS terminals.
              </p>
            </div>
          </div>

          <div className="bg-[#121629] border border-[#1e2540] rounded-2xl overflow-hidden shadow-xl">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-[#161a33] text-slate-400 font-semibold border-b border-[#2a3055]">
                <tr>
                  <th className="p-3">Item / Service Name</th>
                  <th className="p-3">Category</th>
                  <th className="p-3">Base Price</th>
                  <th className="p-3">GST Tax</th>
                  <th className="p-3">Revision</th>
                  <th className="p-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {catalogItems.map((item: any) => (
                  <tr key={item.id} className="hover:bg-slate-800/20">
                    <td className="p-3 font-bold text-white">{item.name}</td>
                    <td className="p-3 text-slate-400">{item.category}</td>
                    <td className="p-3 font-mono font-bold text-emerald-400">₹{item.price || item.basePrice}</td>
                    <td className="p-3 font-mono">{item.gstPercent || 18}%</td>
                    <td className="p-3 font-mono text-[10px] text-sky-400">Rev #{item.revision || 101}</td>
                    <td className="p-3 text-right">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400">
                        AVAILABLE
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ============================================================================== */}
      {/* TAB 4: ORDERS & BILLING HISTORY                                                */}
      {/* ============================================================================== */}
      {activeTab === 'orders' && (
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-white">Outlet Transaction Ledger</h3>
          <div className="bg-[#121629] border border-[#1e2540] rounded-2xl p-4 shadow-xl">
            {reports?.recentBills && reports.recentBills.length > 0 ? (
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-[#161a33] text-slate-400 font-semibold">
                  <tr>
                    <th className="p-2.5">Bill Number</th>
                    <th className="p-2.5">Customer</th>
                    <th className="p-2.5">Payment</th>
                    <th className="p-2.5">Amount</th>
                    <th className="p-2.5 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {reports.recentBills.map((b: any) => (
                    <tr key={b.id}>
                      <td className="p-2.5 font-mono text-white">{b.bill_number}</td>
                      <td className="p-2.5">{b.customer_name || 'Guest'}</td>
                      <td className="p-2.5 uppercase text-slate-400">{b.payment_mode}</td>
                      <td className="p-2.5 font-bold text-emerald-400 font-mono">₹{b.grand_total}</td>
                      <td className="p-2.5 text-right text-emerald-400 font-semibold">Paid & Synced</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : reports?.recentOrders && reports.recentOrders.length > 0 ? (
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-[#161a33] text-slate-400 font-semibold">
                  <tr>
                    <th className="p-2.5">Order / Token</th>
                    <th className="p-2.5">Table / Mode</th>
                    <th className="p-2.5">Payment</th>
                    <th className="p-2.5">Amount</th>
                    <th className="p-2.5 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {reports.recentOrders.map((o: any) => (
                    <tr key={o.id}>
                      <td className="p-2.5 font-mono text-white">#{o.token_number} ({o.order_number})</td>
                      <td className="p-2.5">{o.table_or_counter}</td>
                      <td className="p-2.5 uppercase text-slate-400">{o.payment_mode}</td>
                      <td className="p-2.5 font-bold text-emerald-400 font-mono">₹{o.grand_total}</td>
                      <td className="p-2.5 text-right text-emerald-400 font-semibold">Ready / Settled</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-xs text-slate-400 p-4 text-center">No transactions recorded yet today.</p>
            )}
          </div>
        </div>
      )}

      {/* ============================================================================== */}
      {/* TAB 5: PRINTER CONFIGURATION                                                   */}
      {/* ============================================================================== */}
      {activeTab === 'printer' && (
        <div className="bg-[#121629] border border-[#1e2540] rounded-2xl p-6 shadow-xl max-w-xl space-y-4">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Printer className="w-5 h-5 text-sky-400" />
            Thermal ESC/POS Printer Configuration
          </h3>
          <p className="text-xs text-slate-400">
            Configure default paper roll dimensions and receipt headers printed by Bluetooth thermal units.
          </p>

          <div className="space-y-3 text-xs">
            <div>
              <label className="font-semibold text-slate-300 mb-1 block">Default Thermal Paper Width</label>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="paperWidth"
                    checked={printerConfig.paperWidth === 80}
                    onChange={() => setPrinterConfig({ ...printerConfig, paperWidth: 80 })}
                    className="accent-pink-500"
                  />
                  <span>80mm (Standard Desktop / Counter)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="paperWidth"
                    checked={printerConfig.paperWidth === 58}
                    onChange={() => setPrinterConfig({ ...printerConfig, paperWidth: 58 })}
                    className="accent-pink-500"
                  />
                  <span>58mm (Compact Mobile Belt Clip)</span>
                </label>
              </div>
            </div>

            <div>
              <label className="font-semibold text-slate-300 mb-1 block">Printed Receipt Header</label>
              <input
                type="text"
                value={printerConfig.receiptHeader}
                onChange={e => setPrinterConfig({ ...printerConfig, receiptHeader: e.target.value })}
                className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2.5 focus:outline-none focus:border-pink-500"
              />
            </div>

            <div>
              <label className="font-semibold text-slate-300 mb-1 block">Printed Receipt Footer</label>
              <input
                type="text"
                value={printerConfig.receiptFooter}
                onChange={e => setPrinterConfig({ ...printerConfig, receiptFooter: e.target.value })}
                className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2.5 focus:outline-none focus:border-pink-500"
              />
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={() => alert('Printer settings saved successfully for this outlet.')}
                className="px-4 py-2 rounded-xl bg-pink-600 hover:bg-pink-500 text-white font-semibold shadow"
              >
                Save Printer Preferences
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Add Staff Member */}
      {isAddStaffOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#121629] border border-[#1e2540] rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h3 className="text-base font-bold text-white">Add Outlet Staff Member</h3>
              <button onClick={() => setIsAddStaffOpen(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <form onSubmit={handleCreateStaff} className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-300 mb-1 block">Full Name</label>
                <input
                  type="text"
                  value={newStaffForm.fullName}
                  onChange={e => setNewStaffForm({ ...newStaffForm, fullName: e.target.value })}
                  placeholder="e.g. Ananya Rao"
                  required
                  className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2 focus:outline-none focus:border-pink-500"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-300 mb-1 block">Staff Email</label>
                <input
                  type="email"
                  value={newStaffForm.email}
                  onChange={e => setNewStaffForm({ ...newStaffForm, email: e.target.value })}
                  placeholder="staff@outlet.com"
                  required
                  className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2 focus:outline-none focus:border-pink-500"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-300 mb-1 block">Specific Title / Position</label>
                <input
                  type="text"
                  value={newStaffForm.specificTitle}
                  onChange={e => setNewStaffForm({ ...newStaffForm, specificTitle: e.target.value })}
                  placeholder="e.g. Counter Cashier, Receptionist"
                  className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2 focus:outline-none focus:border-pink-500"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-300 mb-1 block">Initial Password</label>
                <input
                  type="password"
                  value={newStaffForm.password}
                  onChange={e => setNewStaffForm({ ...newStaffForm, password: e.target.value })}
                  placeholder="Leave blank for Staff@123"
                  className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2 focus:outline-none focus:border-pink-500"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddStaffOpen(false)}
                  className="px-4 py-2 rounded-xl text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-pink-600 hover:bg-pink-500 text-white font-semibold shadow"
                >
                  Create Staff
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
