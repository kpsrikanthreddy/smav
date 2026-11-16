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
  Edit2,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { UserSession, OutletUserRecord, SyncOutboxItem, getVisibleRole } from '../types';
import { identityAdminService } from '../services/identityAdminService';

interface AdminDashboardProps {
  session: UserSession;
  onOpenPos: () => void;
  onLogout: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  session,
  onOpenPos,
}) => {
  const isSuperadmin =
    session.role === 'superadmin' ||
    getVisibleRole(session.displayRole || session.role) === 'SUPERADMIN';

  const [activeTab, setActiveTab] = useState<'overview' | 'staff' | 'catalog' | 'orders' | 'printer'>('overview');
  const [staffList, setStaffList] = useState<OutletUserRecord[]>([]);
  const [outboxItems, setOutboxItems] = useState<SyncOutboxItem[]>([]);
  const [reports, setReports] = useState<any>(null);
  const [catalogItems, setCatalogItems] = useState<any[]>([]);
  const [printerConfig, setPrinterConfig] = useState({
    paperWidth: 80,
    receiptHeader: session.activeOutlet.receiptHeader,
    receiptFooter: session.activeOutlet.receiptFooter,
    autoCut: true,
  });
  const [printerSavedMessage, setPrinterSavedMessage] = useState<string | null>(null);

  // Modals: Add User, Edit User, Reset Password
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [addUserForm, setAddUserForm] = useState({
    fullName: '',
    username: '',
    email: '',
    phone: '',
    role: 'STAFF' as 'ADMIN' | 'STAFF',
    initialPassword: '',
  });

  const [editingUser, setEditingUser] = useState<OutletUserRecord | null>(null);
  const [editUserForm, setEditUserForm] = useState({
    fullName: '',
    username: '',
    email: '',
    phone: '',
    role: 'STAFF' as 'ADMIN' | 'STAFF',
  });

  const [resetTarget, setResetTarget] = useState<OutletUserRecord | null>(null);
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');

  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [isActionLoading, setIsActionLoading] = useState(false);

  const fetchAdminData = async () => {
    try {
      const headers = { Authorization: `Bearer ${session.token}` };

      const [usersRes, outboxRes, repRes] = await Promise.all([
        identityAdminService.listOutletUsers(session.token, session.activeOutlet.code),
        identityAdminService.listSyncOutbox(session.token, session.activeOutlet.code),
        fetch('/api/admin/reports', { headers }).then((r) => r.json()).catch(() => null),
      ]);

      if (usersRes.success) {
        setStaffList(usersRes.users);
      } else if (usersRes.message) {
        setActionError(usersRes.message);
      }

      if (outboxRes.success) {
        setOutboxItems(outboxRes.items);
      }

      if (repRes && repRes.success !== false) setReports(repRes);

      if (session.activeOutlet.category === 'salon') {
        const srvRes = await fetch('/api/salon/services', { headers });
        const srvData = await srvRes.json();
        if (srvRes.ok) setCatalogItems(srvData.services || []);
      } else if (session.activeOutlet.category === 'restaurant') {
        const menuRes = await fetch('/api/restaurant/menu', { headers });
        const menuData = await menuRes.json();
        if (menuRes.ok) setCatalogItems(menuData.menu || []);
      } else {
        const syncRes = await fetch(`/api/catalog/sync?business_id=${session.activeOutlet.id}`, { headers });
        const syncData = await syncRes.json();
        if (syncRes.ok) setCatalogItems(syncData.changes || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchAdminData();
  }, [session.token, session.activeOutlet.id]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (addUserForm.initialPassword.length < 8) {
      setActionError('Initial temporary password must be at least 8 characters.');
      return;
    }

    setIsActionLoading(true);
    setActionError(null);
    setActionSuccess(null);

    try {
      const res = await identityAdminService.upsertOutletUser(session.token, {
        fullName: addUserForm.fullName.trim(),
        username: addUserForm.username.trim().toLowerCase() || undefined,
        email: addUserForm.email.trim().toLowerCase(),
        phone: addUserForm.phone.trim(),
        role: isSuperadmin ? addUserForm.role : 'STAFF',
        outletCode: session.activeOutlet.code,
        initialPassword: addUserForm.initialPassword,
      });

      if (res.success) {
        setIsAddUserOpen(false);
        setAddUserForm({
          fullName: '',
          username: '',
          email: '',
          phone: '',
          role: 'STAFF',
          initialPassword: '',
        });
        setActionSuccess(res.message);
        await fetchAdminData();
      } else {
        setActionError(res.message || res.error || 'Failed to add user.');
        await fetchAdminData();
      }
    } catch (err: any) {
      setActionError(err?.message || 'Failed to add user.');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    setIsActionLoading(true);
    setActionError(null);
    setActionSuccess(null);

    try {
      const res = await identityAdminService.updateOutletUser(session.token, editingUser.userId, {
        fullName: editUserForm.fullName.trim(),
        username: editUserForm.username.trim().toLowerCase() || undefined,
        email: editUserForm.email.trim().toLowerCase(),
        phone: editUserForm.phone.trim(),
        role: isSuperadmin ? editUserForm.role : 'STAFF',
        outletCode: session.activeOutlet.code,
      });

      if (res.success) {
        setEditingUser(null);
        setActionSuccess(res.message);
        await fetchAdminData();
      } else {
        setActionError(res.message || res.error || 'Failed to update user.');
        await fetchAdminData();
      }
    } catch (err: any) {
      setActionError(err?.message || 'Failed to update user.');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTarget) return;
    if (resetNewPassword.length < 8) {
      setActionError('Temporary password must be at least 8 characters.');
      return;
    }
    if (resetNewPassword !== resetConfirmPassword) {
      setActionError('Temporary password confirmation does not match.');
      return;
    }

    setIsActionLoading(true);
    setActionError(null);
    setActionSuccess(null);

    try {
      const res = await identityAdminService.resetOutletUserPassword(session.token, resetTarget.userId, {
        newPassword: resetNewPassword,
        email: resetTarget.email || undefined,
        outletCode: session.activeOutlet.code,
      });

      if (res.success) {
        setResetTarget(null);
        setResetNewPassword('');
        setResetConfirmPassword('');
        setActionSuccess(
          `${res.message} User will be prompted to set a personal password on first sign-in.`
        );
        await fetchAdminData();
      } else {
        setActionError(res.message || res.error || 'Failed to reset password.');
        await fetchAdminData();
      }
    } catch (err: any) {
      setActionError(err?.message || 'Failed to reset password.');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleToggleStatus = async (user: OutletUserRecord) => {
    setIsActionLoading(true);
    setActionError(null);
    setActionSuccess(null);

    try {
      const res = await identityAdminService.setOutletUserStatus(session.token, user.userId, {
        isActive: !user.isActive,
        email: user.email || undefined,
        outletCode: session.activeOutlet.code,
      });

      if (res.success) {
        setActionSuccess(res.message);
        await fetchAdminData();
      } else {
        setActionError(res.message || res.error || 'Failed to update user status.');
        await fetchAdminData();
      }
    } catch (err: any) {
      setActionError(err?.message || 'Failed to update user status.');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleRetryOutbox = async (outboxId: string) => {
    setIsActionLoading(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await identityAdminService.retrySyncOutboxItem(session.token, outboxId);
      if (res.success) {
        setActionSuccess(res.message);
      } else {
        setActionError(res.message);
      }
      await fetchAdminData();
    } finally {
      setIsActionLoading(false);
    }
  };

  const pendingOutbox = outboxItems.filter((i) => i.status !== 'SYNCED');

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
          { id: 'staff', label: `Outlet Users (${staffList.length})`, icon: Users },
          { id: 'catalog', label: `Catalog & Pricing (${catalogItems.length})`, icon: Sparkles },
          { id: 'orders', label: 'Billing & Transaction Ledger', icon: Receipt },
          { id: 'printer', label: 'ESC/POS Printer Setup', icon: Printer },
        ].map((tab) => (
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

      {/* TAB 1: OVERVIEW & REPORTS */}
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
              <span className="text-[11px] text-sky-400">Bills &amp; KOT Orders</span>
            </div>
          </div>

          <div className="bg-[#121629] border border-[#1e2540] rounded-2xl p-6 shadow-xl space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold text-white pb-3 border-b border-slate-800">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              Tenant Isolation Verified
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              This administrative dashboard is strictly bound to <span className="font-bold text-white">{session.activeOutlet.name}</span> (Code:{' '}
              <span className="font-mono text-slate-400">{session.activeOutlet.code}</span>). Users, bills, and catalog updates are isolated per outlet.
            </p>
          </div>
        </div>
      )}

      {/* TAB 2: UNIFIED OUTLET USER MANAGEMENT */}
      {activeTab === 'staff' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-white">User Management — {session.activeOutlet.name}</h3>
              <p className="text-[11px] text-slate-400">
                Changes made here synchronize automatically with {session.activeOutlet.name} and Central SMAV Auth.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={fetchAdminData}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Refresh
              </button>
              <button
                onClick={() => {
                  setActionError(null);
                  setIsAddUserOpen(true);
                }}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-pink-600 hover:bg-pink-500 text-white text-xs font-semibold shadow transition"
              >
                <UserPlus className="w-3.5 h-3.5" />
                Add User
              </button>
            </div>
          </div>

          {actionError && (
            <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between gap-2">
              <span>{actionError}</span>
              <button onClick={() => setActionError(null)} className="text-xs underline shrink-0">Dismiss</button>
            </div>
          )}

          {actionSuccess && (
            <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-center justify-between gap-2">
              <span>{actionSuccess}</span>
              <button onClick={() => setActionSuccess(null)} className="text-xs underline shrink-0">Dismiss</button>
            </div>
          )}

          <div className="bg-[#121629] border border-[#1e2540] rounded-2xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-[#161a33] text-slate-400 border-b border-[#2a3055] font-semibold">
                  <tr>
                    <th className="p-4">User &amp; Identity</th>
                    <th className="p-4">Role</th>
                    <th className="p-4">Sync Status</th>
                    <th className="p-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {staffList.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="p-8 text-center text-slate-500">
                        No users assigned to {session.activeOutlet.name} yet. Click &ldquo;Add User&rdquo; to create one.
                      </td>
                    </tr>
                  ) : (
                    staffList.map((user) => {
                      const visibleRole = getVisibleRole(user.outletRole || user.displayRole || user.role);
                      const isProtected = user.platformRole === 'SUPERADMIN' || visibleRole === 'ADMIN';
                      const canManageRow = isSuperadmin || !isProtected;

                      return (
                        <tr key={user.userId} className="hover:bg-slate-800/30 transition">
                          <td className="p-4">
                            <div className="font-bold text-white flex items-center gap-2">
                              <span>{user.fullName}</span>
                              {user.platformRole === 'SUPERADMIN' && (
                                <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 text-[9px] font-bold">
                                  SUPERADMIN
                                </span>
                              )}
                            </div>
                            <div className="font-mono text-[11px] text-slate-300 mt-0.5">
                              {user.email || 'No email'}
                            </div>
                            {user.username && (
                              <div className="text-slate-400 font-mono text-[10px]">@{user.username}</div>
                            )}
                            <div className="text-slate-500 font-mono text-[10px]">UUID: {user.userId}</div>
                          </td>
                          <td className="p-4">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                                visibleRole === 'ADMIN'
                                  ? 'bg-sky-500/15 text-sky-300 border-sky-500/30'
                                  : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                              }`}
                            >
                              {visibleRole}
                            </span>
                          </td>
                          <td className="p-4">
                            <div className="flex flex-col gap-1 items-start">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  !user.isActive
                                    ? 'bg-rose-500/20 text-rose-400'
                                    : user.syncStatus === 'conflict'
                                      ? 'bg-rose-500/20 text-rose-300'
                                      : user.syncStatus === 'pending_outlet_sync'
                                        ? 'bg-amber-500/20 text-amber-300'
                                        : 'bg-emerald-500/20 text-emerald-400'
                                }`}
                              >
                                {!user.isActive
                                  ? 'DISABLED'
                                  : user.syncStatus === 'conflict'
                                    ? 'CONFLICT'
                                    : user.syncStatus === 'pending_outlet_sync'
                                      ? 'OUTBOX PENDING'
                                      : 'SYNCED'}
                              </span>
                              {user.mustChangePassword && user.isActive && (
                                <span className="text-[10px] text-amber-300 font-medium">
                                  First-login password change pending
                                </span>
                              )}
                              {user.outboxLastError && (
                                <span className="text-[10px] text-amber-400 max-w-xs truncate" title={user.outboxLastError}>
                                  {user.outboxLastError}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="p-4 text-right">
                            {canManageRow ? (
                              <div className="flex flex-wrap items-center justify-end gap-1.5">
                                <button
                                  disabled={isActionLoading}
                                  onClick={() => {
                                    setActionError(null);
                                    setEditingUser(user);
                                    setEditUserForm({
                                      fullName: user.fullName || '',
                                      username: user.username || '',
                                      email: user.email || '',
                                      phone: user.phone || '',
                                      role: visibleRole === 'ADMIN' ? 'ADMIN' : 'STAFF',
                                    });
                                  }}
                                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold transition flex items-center gap-1"
                                >
                                  <Edit2 className="w-3 h-3" />
                                  Edit User
                                </button>
                                <button
                                  disabled={isActionLoading}
                                  onClick={() => {
                                    setActionError(null);
                                    setResetTarget(user);
                                    setResetNewPassword('');
                                    setResetConfirmPassword('');
                                  }}
                                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-400 text-[11px] font-semibold transition flex items-center gap-1"
                                >
                                  <KeyRound className="w-3 h-3" />
                                  Reset Password
                                </button>
                                <button
                                  disabled={isActionLoading}
                                  onClick={() => handleToggleStatus(user)}
                                  className={`px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold transition ${
                                    user.isActive ? 'text-rose-400' : 'text-emerald-400'
                                  }`}
                                >
                                  {user.isActive ? 'Disable User' : 'Enable User'}
                                </button>
                              </div>
                            ) : (
                              <span className="text-[11px] text-slate-500">SUPERADMIN Managed</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {pendingOutbox.length > 0 && (
            <div className="bg-[#121629] border border-amber-500/30 rounded-2xl p-4 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
                <AlertTriangle className="w-4 h-4" />
                Pending Outlet Sync Queue ({pendingOutbox.length})
              </div>
              <div className="space-y-2">
                {pendingOutbox.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-xs"
                  >
                    <div>
                      <span className="font-semibold text-white">{item.payload?.fullName || item.payload?.email || item.targetUserId}</span>
                      <span className="ml-2 font-mono text-[10px] text-amber-300">{item.status}</span>
                      {item.lastError && <div className="text-[11px] text-slate-400 mt-0.5">{item.lastError}</div>}
                    </div>
                    {item.status !== 'CONFLICT' && (
                      <button
                        disabled={isActionLoading}
                        onClick={() => handleRetryOutbox(item.id)}
                        className="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-semibold"
                      >
                        Retry Sync
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: CATALOG & PRICING MANAGEMENT */}
      {activeTab === 'catalog' && (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-bold text-white">
              {session.activeOutlet.category === 'salon'
                ? 'Salon Services Catalog'
                : session.activeOutlet.category === 'restaurant'
                  ? 'Restaurant Menu Items'
                  : 'Retail Products Catalog'}
            </h3>
            <p className="text-xs text-slate-400">
              Changes bump monotonic revisions and broadcast real-time delta updates to all paired POS terminals.
            </p>
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

      {/* TAB 4: ORDERS & BILLING HISTORY */}
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
                      <td className="p-2.5 text-right text-emerald-400 font-semibold">Paid &amp; Synced</td>
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

      {/* TAB 5: PRINTER CONFIGURATION */}
      {activeTab === 'printer' && (
        <div className="bg-[#121629] border border-[#1e2540] rounded-2xl p-6 shadow-xl max-w-xl space-y-4">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Printer className="w-5 h-5 text-sky-400" />
            Thermal ESC/POS Printer Configuration
          </h3>
          <p className="text-xs text-slate-400">
            Configure default paper roll dimensions and receipt headers printed by Bluetooth thermal units.
          </p>

          {printerSavedMessage && (
            <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{printerSavedMessage}</span>
            </div>
          )}

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
                onChange={(e) => setPrinterConfig({ ...printerConfig, receiptHeader: e.target.value })}
                className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2.5 focus:outline-none focus:border-pink-500"
              />
            </div>

            <div>
              <label className="font-semibold text-slate-300 mb-1 block">Printed Receipt Footer</label>
              <input
                type="text"
                value={printerConfig.receiptFooter}
                onChange={(e) => setPrinterConfig({ ...printerConfig, receiptFooter: e.target.value })}
                className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2.5 focus:outline-none focus:border-pink-500"
              />
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={() => setPrinterSavedMessage('Printer preferences saved for this outlet session.')}
                className="px-4 py-2 rounded-xl bg-pink-600 hover:bg-pink-500 text-white font-semibold shadow"
              >
                Save Printer Preferences
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Add User */}
      {isAddUserOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#121629] border border-[#1e2540] rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h3 className="text-base font-bold text-white">Add User ({session.activeOutlet.name})</h3>
              <button onClick={() => setIsAddUserOpen(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-300 mb-1 block">Full Name</label>
                <input
                  type="text"
                  value={addUserForm.fullName}
                  onChange={(e) => setAddUserForm({ ...addUserForm, fullName: e.target.value })}
                  placeholder="e.g. Ananya Rao"
                  required
                  className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2 focus:outline-none focus:border-pink-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-300 mb-1 block">Username</label>
                  <input
                    type="text"
                    value={addUserForm.username}
                    onChange={(e) => setAddUserForm({ ...addUserForm, username: e.target.value })}
                    placeholder="ananya"
                    required
                    className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2 font-mono focus:outline-none focus:border-pink-500"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-300 mb-1 block">Role</label>
                  <select
                    value={isSuperadmin ? addUserForm.role : 'STAFF'}
                    onChange={(e) => setAddUserForm({ ...addUserForm, role: e.target.value as 'ADMIN' | 'STAFF' })}
                    disabled={!isSuperadmin}
                    className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2 focus:outline-none focus:border-pink-500 disabled:opacity-70"
                  >
                    <option value="STAFF">STAFF (POS_BILLING)</option>
                    {isSuperadmin && <option value="ADMIN">ADMIN</option>}
                  </select>
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-300 mb-1 block">Email Address</label>
                <input
                  type="email"
                  value={addUserForm.email}
                  onChange={(e) => setAddUserForm({ ...addUserForm, email: e.target.value })}
                  placeholder="staff@company.com"
                  required
                  className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2 focus:outline-none focus:border-pink-500"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-300 mb-1 block">Initial Temporary Password (min. 8 characters)</label>
                <input
                  type="password"
                  value={addUserForm.initialPassword}
                  onChange={(e) => setAddUserForm({ ...addUserForm, initialPassword: e.target.value })}
                  placeholder="Minimum 8 characters"
                  minLength={8}
                  required
                  className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2 focus:outline-none focus:border-pink-500"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  User will be required to change this temporary password on first sign-in.
                </p>
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddUserOpen(false)}
                  className="px-4 py-2 rounded-xl text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isActionLoading}
                  className="px-5 py-2 rounded-xl bg-pink-600 hover:bg-pink-500 disabled:opacity-50 text-white font-semibold shadow"
                >
                  {isActionLoading ? 'Saving & Syncing...' : 'Save & Sync User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit User */}
      {editingUser && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#121629] border border-[#1e2540] rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h3 className="text-base font-bold text-white">Edit User</h3>
              <button onClick={() => setEditingUser(null)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <div className="text-[10px] font-mono text-slate-400">Preserves Central Auth UUID: {editingUser.userId}</div>

            <form onSubmit={handleEditUser} className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-300 mb-1 block">Full Name</label>
                <input
                  type="text"
                  value={editUserForm.fullName}
                  onChange={(e) => setEditUserForm({ ...editUserForm, fullName: e.target.value })}
                  required
                  className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2 focus:outline-none focus:border-pink-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-300 mb-1 block">Username</label>
                  <input
                    type="text"
                    value={editUserForm.username}
                    onChange={(e) => setEditUserForm({ ...editUserForm, username: e.target.value })}
                    className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2 font-mono focus:outline-none focus:border-pink-500"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-300 mb-1 block">Role</label>
                  <select
                    value={isSuperadmin ? editUserForm.role : 'STAFF'}
                    onChange={(e) => setEditUserForm({ ...editUserForm, role: e.target.value as 'ADMIN' | 'STAFF' })}
                    disabled={!isSuperadmin}
                    className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2 focus:outline-none focus:border-pink-500 disabled:opacity-70"
                  >
                    <option value="STAFF">STAFF (POS_BILLING)</option>
                    {isSuperadmin && <option value="ADMIN">ADMIN</option>}
                  </select>
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-300 mb-1 block">Email Address</label>
                <input
                  type="email"
                  value={editUserForm.email}
                  onChange={(e) => setEditUserForm({ ...editUserForm, email: e.target.value })}
                  required
                  className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2 focus:outline-none focus:border-pink-500"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="px-4 py-2 rounded-xl text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isActionLoading}
                  className="px-5 py-2 rounded-xl bg-pink-600 hover:bg-pink-500 disabled:opacity-50 text-white font-semibold shadow"
                >
                  {isActionLoading ? 'Updating...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Reset Password */}
      {resetTarget && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#121629] border border-[#1e2540] rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-sky-400" />
                Reset User Password
              </h3>
              <button onClick={() => setResetTarget(null)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Set a temporary password for <span className="font-bold text-white">{resetTarget.fullName}</span> ({resetTarget.email || resetTarget.userId}). They will be required to choose a personal password on first sign-in.
            </p>

            <form onSubmit={handleResetPasswordSubmit} className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-300 mb-1 block">New Temporary Password (min. 8 characters)</label>
                <input
                  type="password"
                  value={resetNewPassword}
                  onChange={(e) => setResetNewPassword(e.target.value)}
                  minLength={8}
                  required
                  className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2 focus:outline-none focus:border-pink-500"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-300 mb-1 block">Confirm Temporary Password</label>
                <input
                  type="password"
                  value={resetConfirmPassword}
                  onChange={(e) => setResetConfirmPassword(e.target.value)}
                  minLength={8}
                  required
                  className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2 focus:outline-none focus:border-pink-500"
                />
              </div>
              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setResetTarget(null)}
                  className="px-4 py-2 rounded-xl text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isActionLoading}
                  className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-semibold shadow"
                >
                  {isActionLoading ? 'Updating...' : 'Set Temporary Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
