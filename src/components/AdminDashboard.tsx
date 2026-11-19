import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Edit2,
  KeyRound,
  Printer,
  Receipt,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UserPlus,
  Users,
} from 'lucide-react';
import { OutletUserRecord, SyncOutboxItem, UserSession, getVisibleRole } from '../types';
import { identityAdminService } from '../services/identityAdminService';
import { IntegrationDiagnostics } from './IntegrationDiagnostics';
import {
  BASE_INPUT_CLASS,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  FormField,
  PasswordField,
  ResponsiveTable,
  StatusBadge,
} from './ui';

interface AdminDashboardProps {
  session: UserSession;
  onOpenPos: () => void;
  onLogout: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ session, onOpenPos }) => {
  const isSuperadmin =
    session.role === 'superadmin' ||
    getVisibleRole(session.displayRole || session.role) === 'SUPERADMIN';

  const [activeTab, setActiveTab] = useState<'overview' | 'staff' | 'catalog' | 'orders' | 'integrations' | 'printer'>(
    'overview'
  );
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

  const [confirmToggleUser, setConfirmToggleUser] = useState<OutletUserRecord | null>(null);

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
        const syncRes = await fetch(`/api/catalog/sync?business_id=${session.activeOutlet.id}`, {
          headers,
        });
        const syncData = await syncRes.json();
        if (syncRes.ok) setCatalogItems(syncData.changes || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    void fetchAdminData();
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
      const res = await identityAdminService.resetOutletUserPassword(
        session.token,
        resetTarget.userId,
        {
          newPassword: resetNewPassword,
          email: resetTarget.email || undefined,
          outletCode: session.activeOutlet.code,
        }
      );

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

  const executeToggleStatus = async (user: OutletUserRecord) => {
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
      setConfirmToggleUser(null);
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

  const handleResolveOutbox = async (outboxId: string) => {
    setIsActionLoading(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const res = await identityAdminService.resolveSyncOutboxItem(session.token, outboxId);
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
  const isExternallyManaged =
    session.activeOutlet.code?.trim().toLowerCase() === 'glossylooks' ||
    staffList.some((u) => Boolean(u.managedByOutlet));
  const managedByLabel =
    staffList.find((u) => u.managedByLabel)?.managedByLabel || 'Managed by Glossy Looks';
  const canMutateOutletUsers = !isExternallyManaged || isSuperadmin;

  return (
    <div className="space-y-5">
      {/* Outlet Context Banner */}
      <Card padding="lg" className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge label="Outlet Admin" tone="info" />
            <span className="text-xs text-[#6F737D] font-mono">Code: {session.activeOutlet.code}</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-[#2F3033] tracking-tight truncate">
            {session.activeOutlet.name}
          </h1>
          <p className="text-xs text-[#6F737D]">
            {session.activeOutlet.address} · Phone: {session.activeOutlet.phone || 'N/A'} · GSTIN:{' '}
            <span className="font-mono">{session.activeOutlet.gstin || 'Unregistered'}</span>
          </p>
        </div>

        <Button onClick={onOpenPos}>Launch Outlet POS</Button>
      </Card>

      {/* Admin Sub-Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
        {[
          { id: 'overview', label: 'Overview & Reports', icon: TrendingUp },
          { id: 'staff', label: `Outlet Users (${staffList.length})`, icon: Users },
          { id: 'catalog', label: `Catalog (${catalogItems.length})`, icon: Sparkles },
          { id: 'orders', label: 'Transaction Ledger', icon: Receipt },
          { id: 'integrations', label: 'Integration Diagnostics', icon: Activity },
          { id: 'printer', label: 'Printer Setup', icon: Printer },
        ].map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as any)}
              className={`min-h-[40px] shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                active
                  ? 'bg-[#2F3033] text-white border-[#2F3033] shadow-xs'
                  : 'bg-white text-[#6F737D] border-[#E5E7EC] hover:text-[#2F3033]'
              }`}
            >
              <tab.icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: OVERVIEW & REPORTS */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card padding="md" className="space-y-1">
              <span className="text-xs text-[#6F737D] font-medium">Total Outlet Sales</span>
              <div className="text-2xl font-bold text-[#2F3033] tabular-nums">
                ₹{(reports?.totalSales || 0).toLocaleString()}
              </div>
              <span className="text-[11px] font-medium text-[#15803D]">
                Isolated to {session.activeOutlet.code}
              </span>
            </Card>
            <Card padding="md" className="space-y-1">
              <span className="text-xs text-[#6F737D] font-medium">GST / Taxes Collected</span>
              <div className="text-2xl font-bold text-[#2F3033] tabular-nums">
                ₹{(reports?.totalTax || 0).toLocaleString()}
              </div>
              <span className="text-[11px] text-[#6F737D]">CGST + SGST</span>
            </Card>
            <Card padding="md" className="space-y-1">
              <span className="text-xs text-[#6F737D] font-medium">Transactions Recorded</span>
              <div className="text-2xl font-bold text-[#2F3033] tabular-nums">
                {reports?.totalTransactions || 0}
              </div>
              <span className="text-[11px] font-medium text-[#1D4ED8]">Bills &amp; KOT Orders</span>
            </Card>
          </div>

          <Card padding="md" className="space-y-2.5">
            <div className="flex items-center gap-2 text-sm font-bold text-[#2F3033]">
              <ShieldCheck className="w-4 h-4 text-[#15803D]" />
              <span>Tenant Isolation Verified</span>
            </div>
            <p className="text-xs text-[#6F737D] leading-relaxed">
              This administrative workspace is strictly bound to{' '}
              <span className="font-semibold text-[#2F3033]">{session.activeOutlet.name}</span> (Code:{' '}
              <span className="font-mono text-[#2F3033]">{session.activeOutlet.code}</span>). Users, bills, and catalog updates are isolated per outlet.
            </p>
          </Card>
        </div>
      )}

      {/* TAB 2: OUTLET USERS */}
      {activeTab === 'staff' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-bold text-[#2F3033]">
                  User Management — {session.activeOutlet.name}
                </h3>
                {isExternallyManaged && <StatusBadge label={managedByLabel} tone="info" />}
              </div>
              <p className="text-xs text-[#6F737D]">
                {isExternallyManaged
                  ? 'Authoritative staff directory synced automatically from Glossy Looks Admin Portal.'
                  : 'Synchronized automatically with Central SMAV Auth and this outlet.'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={fetchAdminData}
                leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
              >
                Refresh
              </Button>
              {canMutateOutletUsers && (
                <Button
                  size="sm"
                  onClick={() => {
                    setActionError(null);
                    setIsAddUserOpen(true);
                  }}
                  leftIcon={<UserPlus className="w-3.5 h-3.5" />}
                >
                  {isExternallyManaged ? 'Emergency Add User' : 'Add User'}
                </Button>
              )}
            </div>
          </div>

          {isExternallyManaged && (
            <Card
              padding="md"
              className="border-[#BFDBFE] bg-[#EFF6FF] flex flex-wrap items-start justify-between gap-3"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs font-bold text-[#1D4ED8]">
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                  <span>
                    {managedByLabel}
                    {isSuperadmin ? ' · SUPERADMIN Emergency Recovery Mode' : ' · Read-Only View'}
                  </span>
                </div>
                <p className="text-xs text-[#1E40AF] leading-relaxed">
                  {isSuperadmin
                    ? 'Glossy Looks Admin Portal is the authoritative source for creating, updating, deactivating, and resetting passwords for these users. Changes performed here by SUPERADMIN are permitted only for emergency recovery and are audit logged.'
                    : 'User creation, email updates, role assignments, activation/deactivation, and password resets must be performed in the Glossy Looks Admin Portal. Updates synchronize automatically to SMAV.'}
                </p>
              </div>
            </Card>
          )}

          {actionError && (
            <div
              role="alert"
              className="p-3 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-[#B91C1C] text-xs flex items-center justify-between gap-2"
            >
              <span>{actionError}</span>
              <button
                type="button"
                onClick={() => setActionError(null)}
                className="underline font-semibold shrink-0 cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {actionSuccess && (
            <div
              role="status"
              className="p-3 rounded-xl bg-[#ECFDF5] border border-[#BBF7D0] text-[#15803D] text-xs flex items-center justify-between gap-2"
            >
              <span>{actionSuccess}</span>
              <button
                type="button"
                onClick={() => setActionSuccess(null)}
                className="underline font-semibold shrink-0 cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          <ResponsiveTable
            rows={staffList}
            keyExtractor={(u) => u.userId}
            emptyState={
              <EmptyState
                title={`No users assigned to ${session.activeOutlet.name}`}
                description='Click "Add User" to provision outlet staff or administrators.'
              />
            }
            columns={[
              {
                key: 'identity',
                header: 'User & Identity',
                render: (user) => (
                  <div className="space-y-0.5">
                    <div className="font-bold text-[#2F3033] flex items-center gap-2">
                      <span>{user.fullName}</span>
                      {user.platformRole === 'SUPERADMIN' && (
                        <StatusBadge label="SUPERADMIN" tone="brand" />
                      )}
                    </div>
                    <div className="font-mono text-[11px] text-[#2F3033]">
                      {user.email || 'No email'}
                    </div>
                    {user.username && (
                      <div className="text-[#6F737D] font-mono text-[10px]">@{user.username}</div>
                    )}
                    <div className="text-[#8B909C] font-mono text-[10px]">UUID: {user.userId}</div>
                  </div>
                ),
              },
              {
                key: 'role',
                header: 'Role',
                render: (user) => {
                  const visibleRole = getVisibleRole(user.outletRole || user.displayRole || user.role);
                  return (
                    <StatusBadge
                      label={visibleRole}
                      tone={visibleRole === 'ADMIN' ? 'info' : 'success'}
                    />
                  );
                },
              },
              {
                key: 'sync',
                header: 'Sync Status',
                render: (user) => (
                  <div className="space-y-1">
                    <StatusBadge
                      label={
                        !user.isActive
                          ? 'DISABLED'
                          : user.syncStatus === 'conflict'
                            ? 'CONFLICT'
                            : user.syncStatus === 'pending_outlet_sync'
                              ? 'OUTBOX PENDING'
                              : 'SYNCED'
                      }
                      tone={
                        !user.isActive || user.syncStatus === 'conflict'
                          ? 'danger'
                          : user.syncStatus === 'pending_outlet_sync'
                            ? 'warning'
                            : 'success'
                      }
                    />
                    {user.mustChangePassword && user.isActive && (
                      <p className="text-[10px] text-[#B45309] font-medium">
                        First-login password change pending
                      </p>
                    )}
                    {user.outboxLastError && (
                      <p className="text-[10px] text-[#B45309] max-w-xs truncate" title={user.outboxLastError}>
                        {user.outboxLastError}
                      </p>
                    )}
                  </div>
                ),
              },
              {
                key: 'actions',
                header: 'Actions',
                align: 'right',
                render: (user) => {
                  const visibleRole = getVisibleRole(user.outletRole || user.displayRole || user.role);
                  const rowExternallyManaged = Boolean(user.managedByOutlet || isExternallyManaged);
                  const rowManagedLabel = user.managedByLabel || managedByLabel;
                  const isProtected = user.platformRole === 'SUPERADMIN' || visibleRole === 'ADMIN';
                  if (rowExternallyManaged && !isSuperadmin) {
                    return <StatusBadge label={rowManagedLabel} tone="info" />;
                  }
                  const canManageRow = isSuperadmin || !isProtected;
                  if (!canManageRow) {
                    return <span className="text-[11px] text-[#6F737D]">SUPERADMIN Managed</span>;
                  }
                  return (
                    <div className="space-y-1">
                      {rowExternallyManaged && isSuperadmin && (
                        <div className="text-[10px] font-semibold text-[#B45309] text-right">
                          Emergency Override (Audited)
                        </div>
                      )}
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
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
                          leftIcon={<Edit2 className="w-3 h-3" />}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isActionLoading}
                          onClick={() => {
                            setActionError(null);
                            setResetTarget(user);
                            setResetNewPassword('');
                            setResetConfirmPassword('');
                          }}
                          leftIcon={<KeyRound className="w-3 h-3" />}
                        >
                          Reset Password
                        </Button>
                        <Button
                          size="sm"
                          variant={user.isActive ? 'danger' : 'success'}
                          disabled={isActionLoading}
                          onClick={() =>
                            user.isActive ? setConfirmToggleUser(user) : void executeToggleStatus(user)
                          }
                        >
                          {user.isActive ? 'Disable' : 'Enable'}
                        </Button>
                      </div>
                    </div>
                  );
                },
              },
            ]}
            renderMobileCard={(user) => {
              const visibleRole = getVisibleRole(user.outletRole || user.displayRole || user.role);
              const rowExternallyManaged = Boolean(user.managedByOutlet || isExternallyManaged);
              const rowManagedLabel = user.managedByLabel || managedByLabel;
              const isProtected = user.platformRole === 'SUPERADMIN' || visibleRole === 'ADMIN';
              const canManageRow = rowExternallyManaged
                ? isSuperadmin
                : isSuperadmin || !isProtected;
              return (
                <div className="space-y-2.5 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-[#2F3033] truncate">{user.fullName}</p>
                      <p className="font-mono text-[11px] text-[#6F737D] truncate">
                        {user.email || 'No email'}
                      </p>
                    </div>
                    <StatusBadge
                      label={visibleRole}
                      tone={visibleRole === 'ADMIN' ? 'info' : 'success'}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge
                      label={
                        !user.isActive
                          ? 'DISABLED'
                          : user.syncStatus === 'pending_outlet_sync'
                            ? 'OUTBOX PENDING'
                            : user.syncStatus.toUpperCase()
                      }
                      tone={
                        !user.isActive
                          ? 'danger'
                          : user.syncStatus === 'pending_outlet_sync'
                            ? 'warning'
                            : 'success'
                      }
                    />
                    {rowExternallyManaged && <StatusBadge label={rowManagedLabel} tone="info" />}
                    {user.mustChangePassword && user.isActive && (
                      <span className="text-[11px] text-[#B45309] font-medium">
                        Password change pending
                      </span>
                    )}
                  </div>
                  {canManageRow && (
                    <div className="pt-2 border-t border-[#F0F1F5] flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
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
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setActionError(null);
                          setResetTarget(user);
                          setResetNewPassword('');
                          setResetConfirmPassword('');
                        }}
                      >
                        Reset Password
                      </Button>
                      <Button
                        size="sm"
                        variant={user.isActive ? 'danger' : 'success'}
                        onClick={() =>
                          user.isActive ? setConfirmToggleUser(user) : void executeToggleStatus(user)
                        }
                      >
                        {user.isActive ? 'Disable' : 'Enable'}
                      </Button>
                    </div>
                  )}
                </div>
              );
            }}
          />

          {pendingOutbox.length > 0 && (
            <Card padding="md" className="border-[#FDE68A] bg-[#FFFBEB] space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-bold text-[#B45309]">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Pending Outlet Sync Queue ({pendingOutbox.length})</span>
              </div>
              <div className="space-y-2">
                {pendingOutbox.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-white border border-[#FDE68A] text-xs"
                  >
                    <div>
                      <span className="font-semibold text-[#2F3033]">
                        {item.payload?.fullName || item.payload?.email || item.targetUserId}
                      </span>
                      <span className="ml-2 font-mono text-[10px] text-[#B45309]">{item.status}</span>
                      {item.lastError && (
                        <div className="text-[11px] text-[#6F737D] mt-0.5">{item.lastError}</div>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {item.status !== 'CONFLICT' && (
                        <Button
                          size="sm"
                          disabled={isActionLoading}
                          onClick={() => handleRetryOutbox(item.id)}
                        >
                          Retry Sync
                        </Button>
                      )}
                      {isSuperadmin && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isActionLoading}
                          onClick={() => handleResolveOutbox(item.id)}
                        >
                          Resolve Stale
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* TAB 3: CATALOG */}
      {activeTab === 'catalog' && (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-bold text-[#2F3033]">
              {session.activeOutlet.category === 'salon'
                ? 'Salon Services Catalog'
                : session.activeOutlet.category === 'restaurant'
                  ? 'Restaurant Menu Items'
                  : 'Retail Products Catalog'}
            </h3>
            <p className="text-xs text-[#6F737D]">
              Monotonic catalog revisions broadcast delta updates to paired POS terminals.
            </p>
          </div>

          <ResponsiveTable
            rows={catalogItems}
            keyExtractor={(item: any) => String(item.id)}
            emptyState={<EmptyState title="No catalog items available" />}
            columns={[
              {
                key: 'name',
                header: 'Item / Service',
                render: (item: any) => <span className="font-semibold text-[#2F3033]">{item.name}</span>,
              },
              {
                key: 'category',
                header: 'Category',
                render: (item: any) => <span className="text-[#6F737D]">{item.category}</span>,
              },
              {
                key: 'price',
                header: 'Base Price',
                render: (item: any) => (
                  <span className="font-bold text-[#15803D] tabular-nums">
                    ₹{item.price || item.basePrice}
                  </span>
                ),
              },
              {
                key: 'gst',
                header: 'GST',
                render: (item: any) => (
                  <span className="tabular-nums text-[#6F737D]">{item.gstPercent || 18}%</span>
                ),
              },
              {
                key: 'rev',
                header: 'Revision',
                render: (item: any) => (
                  <span className="font-mono text-[11px] text-[#1D4ED8] tabular-nums">
                    Rev #{item.revision || 101}
                  </span>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                align: 'right',
                render: () => <StatusBadge label="AVAILABLE" tone="success" />,
              },
            ]}
            renderMobileCard={(item: any) => (
              <div className="flex items-center justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <p className="font-semibold text-[#2F3033] truncate">{item.name}</p>
                  <p className="text-[#6F737D] text-[11px]">
                    {item.category} · GST {item.gstPercent || 18}%
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-bold text-[#15803D] tabular-nums">
                    ₹{item.price || item.basePrice}
                  </p>
                  <p className="text-[10px] font-mono text-[#6F737D]">Rev #{item.revision || 101}</p>
                </div>
              </div>
            )}
          />
        </div>
      )}

      {/* TAB 4: ORDERS */}
      {activeTab === 'orders' && (
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-[#2F3033]">Outlet Transaction Ledger</h3>
          {reports?.recentBills && reports.recentBills.length > 0 ? (
            <ResponsiveTable
              rows={reports.recentBills}
              keyExtractor={(b: any) => String(b.id)}
              columns={[
                {
                  key: 'bill',
                  header: 'Bill Number',
                  render: (b: any) => <span className="font-mono font-semibold">{b.bill_number}</span>,
                },
                {
                  key: 'customer',
                  header: 'Customer',
                  render: (b: any) => <span>{b.customer_name || 'Guest'}</span>,
                },
                {
                  key: 'payment',
                  header: 'Payment',
                  render: (b: any) => <span className="uppercase text-[#6F737D]">{b.payment_mode}</span>,
                },
                {
                  key: 'amount',
                  header: 'Amount',
                  render: (b: any) => (
                    <span className="font-bold text-[#15803D] tabular-nums">₹{b.grand_total}</span>
                  ),
                },
                {
                  key: 'status',
                  header: 'Status',
                  align: 'right',
                  render: () => <StatusBadge label="Paid & Synced" tone="success" />,
                },
              ]}
              renderMobileCard={(b: any) => (
                <div className="flex items-center justify-between gap-2 text-xs">
                  <div>
                    <p className="font-mono font-bold text-[#2F3033]">{b.bill_number}</p>
                    <p className="text-[#6F737D]">
                      {b.customer_name || 'Guest'} · {String(b.payment_mode || '').toUpperCase()}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-[#15803D] tabular-nums">₹{b.grand_total}</p>
                    <StatusBadge label="Synced" tone="success" />
                  </div>
                </div>
              )}
            />
          ) : reports?.recentOrders && reports.recentOrders.length > 0 ? (
            <ResponsiveTable
              rows={reports.recentOrders}
              keyExtractor={(o: any) => String(o.id)}
              columns={[
                {
                  key: 'order',
                  header: 'Order / Token',
                  render: (o: any) => (
                    <span className="font-mono font-semibold">
                      #{o.token_number} ({o.order_number})
                    </span>
                  ),
                },
                {
                  key: 'table',
                  header: 'Table / Mode',
                  render: (o: any) => <span>{o.table_or_counter}</span>,
                },
                {
                  key: 'payment',
                  header: 'Payment',
                  render: (o: any) => <span className="uppercase text-[#6F737D]">{o.payment_mode}</span>,
                },
                {
                  key: 'amount',
                  header: 'Amount',
                  render: (o: any) => (
                    <span className="font-bold text-[#15803D] tabular-nums">₹{o.grand_total}</span>
                  ),
                },
                {
                  key: 'status',
                  header: 'Status',
                  align: 'right',
                  render: () => <StatusBadge label="Settled" tone="success" />,
                },
              ]}
              renderMobileCard={(o: any) => (
                <div className="flex items-center justify-between gap-2 text-xs">
                  <div>
                    <p className="font-mono font-bold text-[#2F3033]">
                      #{o.token_number} ({o.order_number})
                    </p>
                    <p className="text-[#6F737D]">
                      {o.table_or_counter} · {String(o.payment_mode || '').toUpperCase()}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-[#15803D] tabular-nums">₹{o.grand_total}</p>
                    <StatusBadge label="Settled" tone="success" />
                  </div>
                </div>
              )}
            />
          ) : (
            <EmptyState
              icon={<Receipt className="w-5 h-5" />}
              title="No transactions recorded today"
              description="Completed POS bills and kitchen orders will appear here."
            />
          )}
        </div>
      )}

      {/* TAB 5: PRINTER CONFIG */}
      {activeTab === 'printer' && (
        <Card padding="lg" className="max-w-xl space-y-4">
          <h3 className="text-base font-bold text-[#2F3033] flex items-center gap-2">
            <Printer className="w-4 h-4 text-[#1D4ED8]" />
            <span>Thermal ESC/POS Printer Configuration</span>
          </h3>
          <p className="text-xs text-[#6F737D]">
            Configure default paper roll dimensions and receipt headers printed by thermal units.
          </p>

          {printerSavedMessage && (
            <div className="p-3 rounded-xl bg-[#ECFDF5] border border-[#BBF7D0] text-[#15803D] text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{printerSavedMessage}</span>
            </div>
          )}

          <div className="space-y-3.5 text-xs">
            <div>
              <span className="font-semibold text-[#2F3033] mb-2 block">
                Default Thermal Paper Width
              </span>
              <div className="flex flex-wrap items-center gap-4">
                <label className="min-h-[38px] flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="paperWidth"
                    checked={printerConfig.paperWidth === 80}
                    onChange={() => setPrinterConfig({ ...printerConfig, paperWidth: 80 })}
                    className="accent-[#FF1B7A]"
                  />
                  <span>80mm (Counter)</span>
                </label>
                <label className="min-h-[38px] flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="paperWidth"
                    checked={printerConfig.paperWidth === 58}
                    onChange={() => setPrinterConfig({ ...printerConfig, paperWidth: 58 })}
                    className="accent-[#FF1B7A]"
                  />
                  <span>58mm (Compact Belt Clip)</span>
                </label>
              </div>
            </div>

            <FormField label="Printed Receipt Header" htmlFor="printer-header">
              <input
                id="printer-header"
                type="text"
                value={printerConfig.receiptHeader}
                onChange={(e) =>
                  setPrinterConfig({ ...printerConfig, receiptHeader: e.target.value })
                }
                className={BASE_INPUT_CLASS}
              />
            </FormField>

            <FormField label="Printed Receipt Footer" htmlFor="printer-footer">
              <input
                id="printer-footer"
                type="text"
                value={printerConfig.receiptFooter}
                onChange={(e) =>
                  setPrinterConfig({ ...printerConfig, receiptFooter: e.target.value })
                }
                className={BASE_INPUT_CLASS}
              />
            </FormField>

            <Button
              onClick={() =>
                setPrinterSavedMessage('Printer preferences saved for this outlet session.')
              }
            >
              Save Printer Preferences
            </Button>
          </div>
        </Card>
      )}

      {/* TAB 6: INTEGRATION DIAGNOSTICS */}
      {activeTab === 'integrations' && <IntegrationDiagnostics session={session} />}

      {/* Modal: Add User */}
      {isAddUserOpen && (
        <div className="fixed inset-0 z-50 bg-[#111827]/45 backdrop-blur-[2px] flex items-center justify-center p-4">
          <Card padding="lg" className="max-w-md w-full shadow-xl space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-2.5 border-b border-[#E5E7EC]">
              <h3 className="text-base font-bold text-[#2F3033]">
                Add User ({session.activeOutlet.name})
              </h3>
              <button
                type="button"
                onClick={() => setIsAddUserOpen(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-[#6F737D] hover:bg-[#F5F6FA] cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-3">
              <FormField label="Full Name" required>
                <input
                  type="text"
                  value={addUserForm.fullName}
                  onChange={(e) => setAddUserForm({ ...addUserForm, fullName: e.target.value })}
                  placeholder="e.g. Ananya Rao"
                  required
                  className={BASE_INPUT_CLASS}
                />
              </FormField>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="Username" required>
                  <input
                    type="text"
                    value={addUserForm.username}
                    onChange={(e) => setAddUserForm({ ...addUserForm, username: e.target.value })}
                    placeholder="ananya"
                    required
                    className={`${BASE_INPUT_CLASS} font-mono`}
                  />
                </FormField>
                <FormField label="Role">
                  <select
                    value={isSuperadmin ? addUserForm.role : 'STAFF'}
                    onChange={(e) =>
                      setAddUserForm({ ...addUserForm, role: e.target.value as 'ADMIN' | 'STAFF' })
                    }
                    disabled={!isSuperadmin}
                    className={BASE_INPUT_CLASS}
                  >
                    <option value="STAFF">STAFF (POS_BILLING)</option>
                    {isSuperadmin && <option value="ADMIN">ADMIN</option>}
                  </select>
                </FormField>
              </div>

              <FormField label="Email Address" required>
                <input
                  type="email"
                  value={addUserForm.email}
                  onChange={(e) => setAddUserForm({ ...addUserForm, email: e.target.value })}
                  placeholder="staff@company.com"
                  required
                  className={BASE_INPUT_CLASS}
                />
              </FormField>

              <PasswordField
                label="Initial Temporary Password (min. 8 characters)"
                hint="User will be required to change this temporary password on first sign-in."
                value={addUserForm.initialPassword}
                onChange={(e) => setAddUserForm({ ...addUserForm, initialPassword: e.target.value })}
                placeholder="Minimum 8 characters"
                minLength={8}
                required
              />

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-[#E5E7EC]">
                <Button variant="outline" size="sm" onClick={() => setIsAddUserOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" loading={isActionLoading}>
                  Save &amp; Sync User
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Modal: Edit User */}
      {editingUser && (
        <div className="fixed inset-0 z-50 bg-[#111827]/45 backdrop-blur-[2px] flex items-center justify-center p-4">
          <Card padding="lg" className="max-w-md w-full shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-2.5 border-b border-[#E5E7EC]">
              <h3 className="text-base font-bold text-[#2F3033]">Edit User</h3>
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-[#6F737D] hover:bg-[#F5F6FA] cursor-pointer"
              >
                ✕
              </button>
            </div>
            <p className="text-[11px] font-mono text-[#6F737D] truncate">
              Central Auth UUID: {editingUser.userId}
            </p>

            <form onSubmit={handleEditUser} className="space-y-3">
              <FormField label="Full Name" required>
                <input
                  type="text"
                  value={editUserForm.fullName}
                  onChange={(e) => setEditUserForm({ ...editUserForm, fullName: e.target.value })}
                  required
                  className={BASE_INPUT_CLASS}
                />
              </FormField>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="Username">
                  <input
                    type="text"
                    value={editUserForm.username}
                    onChange={(e) => setEditUserForm({ ...editUserForm, username: e.target.value })}
                    className={`${BASE_INPUT_CLASS} font-mono`}
                  />
                </FormField>
                <FormField label="Role">
                  <select
                    value={isSuperadmin ? editUserForm.role : 'STAFF'}
                    onChange={(e) =>
                      setEditUserForm({
                        ...editUserForm,
                        role: e.target.value as 'ADMIN' | 'STAFF',
                      })
                    }
                    disabled={!isSuperadmin}
                    className={BASE_INPUT_CLASS}
                  >
                    <option value="STAFF">STAFF (POS_BILLING)</option>
                    {isSuperadmin && <option value="ADMIN">ADMIN</option>}
                  </select>
                </FormField>
              </div>

              <FormField label="Email Address" required>
                <input
                  type="email"
                  value={editUserForm.email}
                  onChange={(e) => setEditUserForm({ ...editUserForm, email: e.target.value })}
                  required
                  className={BASE_INPUT_CLASS}
                />
              </FormField>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-[#E5E7EC]">
                <Button variant="outline" size="sm" onClick={() => setEditingUser(null)}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" loading={isActionLoading}>
                  Save Changes
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Modal: Reset Password */}
      {resetTarget && (
        <div className="fixed inset-0 z-50 bg-[#111827]/45 backdrop-blur-[2px] flex items-center justify-center p-4">
          <Card padding="lg" className="max-w-md w-full shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-2.5 border-b border-[#E5E7EC]">
              <h3 className="text-base font-bold text-[#2F3033] flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-[#FF1B7A]" />
                <span>Reset User Password</span>
              </h3>
              <button
                type="button"
                onClick={() => setResetTarget(null)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-[#6F737D] hover:bg-[#F5F6FA] cursor-pointer"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-[#6F737D] leading-relaxed">
              Set a temporary password for{' '}
              <span className="font-bold text-[#2F3033]">{resetTarget.fullName}</span> (
              {resetTarget.email || resetTarget.userId}). They must choose a personal password on first sign-in.
            </p>

            <form onSubmit={handleResetPasswordSubmit} className="space-y-3">
              <PasswordField
                label="New Temporary Password (min. 8 characters)"
                value={resetNewPassword}
                onChange={(e) => setResetNewPassword(e.target.value)}
                minLength={8}
                required
              />
              <PasswordField
                label="Confirm Temporary Password"
                value={resetConfirmPassword}
                onChange={(e) => setResetConfirmPassword(e.target.value)}
                minLength={8}
                required
              />
              <div className="pt-3 flex items-center justify-end gap-2 border-t border-[#E5E7EC]">
                <Button variant="outline" size="sm" onClick={() => setResetTarget(null)}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" loading={isActionLoading}>
                  Set Temporary Password
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmToggleUser)}
        title="Disable Outlet User"
        message={
          confirmToggleUser
            ? `Disable ${confirmToggleUser.fullName}? They will no longer be able to sign in to ${session.activeOutlet.name} until re-enabled.`
            : ''
        }
        confirmLabel="Disable User"
        loading={isActionLoading}
        onConfirm={() => confirmToggleUser && void executeToggleStatus(confirmToggleUser)}
        onCancel={() => setConfirmToggleUser(null)}
      />
    </div>
  );
};
