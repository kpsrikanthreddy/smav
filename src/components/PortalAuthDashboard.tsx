import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Edit2,
  KeyRound,
  Play,
  RefreshCw,
  UserPlus,
  Users,
  XCircle,
} from 'lucide-react';
import { Outlet, OutletUserRecord, SyncOutboxItem, UserSession, getVisibleRole } from '../types';
import { identityAdminService } from '../services/identityAdminService';
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

interface PortalAuthDashboardProps {
  session: UserSession;
  onLaunchOutletPos: (outletId: string) => void;
}

export const PortalAuthDashboard: React.FC<PortalAuthDashboardProps> = ({
  session,
  onLaunchOutletPos,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'users' | 'outbox'>('users');
  const [selectedOutletCode, setSelectedOutletCode] = useState<string>('all');
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [users, setUsers] = useState<OutletUserRecord[]>([]);
  const [outboxItems, setOutboxItems] = useState<SyncOutboxItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({
    outletCode: '',
    fullName: '',
    username: '',
    email: '',
    phone: '',
    role: 'STAFF' as 'ADMIN' | 'STAFF',
    initialPassword: '',
  });

  const [editingUser, setEditingUser] = useState<OutletUserRecord | null>(null);
  const [editForm, setEditForm] = useState({
    outletCode: '',
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

  const loadData = async (filterOutletCode = selectedOutletCode) => {
    setIsLoading(true);
    try {
      const headers = { Authorization: `Bearer ${session.token}` };
      const [outletsRes, usersRes, outboxRes] = await Promise.all([
        fetch('/api/superadmin/outlets', { headers })
          .then((r) => r.json())
          .catch(() => ({ outlets: [] })),
        identityAdminService.listOutletUsers(session.token, filterOutletCode),
        identityAdminService.listSyncOutbox(session.token, filterOutletCode),
      ]);

      if (Array.isArray(outletsRes?.outlets)) {
        setOutlets(outletsRes.outlets);
        if (!addForm.outletCode && outletsRes.outlets[0]?.code) {
          setAddForm((prev) => ({ ...prev, outletCode: outletsRes.outlets[0].code }));
        }
      }

      if (usersRes.success) {
        setUsers(usersRes.users);
      } else if (usersRes.message) {
        setFeedback({ type: 'error', message: usersRes.message });
      }

      if (outboxRes.success) {
        setOutboxItems(outboxRes.items);
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadData(selectedOutletCode);
  }, [session.token, selectedOutletCode]);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addForm.outletCode) {
      setFeedback({ type: 'error', message: 'Select a target outlet first.' });
      return;
    }
    if (addForm.initialPassword.length < 8) {
      setFeedback({
        type: 'error',
        message: 'Initial temporary password must be at least 8 characters.',
      });
      return;
    }

    setIsActionLoading(true);
    setFeedback(null);
    try {
      const res = await identityAdminService.upsertOutletUser(session.token, {
        outletCode: addForm.outletCode,
        fullName: addForm.fullName.trim(),
        username: addForm.username.trim().toLowerCase() || undefined,
        email: addForm.email.trim().toLowerCase(),
        phone: addForm.phone.trim(),
        role: addForm.role,
        initialPassword: addForm.initialPassword,
      });

      if (res.success) {
        setIsAddOpen(false);
        setAddForm((prev) => ({
          ...prev,
          fullName: '',
          username: '',
          email: '',
          phone: '',
          initialPassword: '',
        }));
        setFeedback({ type: 'success', message: res.message });
      } else {
        setFeedback({ type: 'error', message: res.message || 'User synchronization failed.' });
      }
      await loadData();
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    setIsActionLoading(true);
    setFeedback(null);
    try {
      const res = await identityAdminService.updateOutletUser(session.token, editingUser.userId, {
        outletCode: editForm.outletCode || editingUser.outletCode,
        fullName: editForm.fullName.trim(),
        username: editForm.username.trim().toLowerCase() || undefined,
        email: editForm.email.trim().toLowerCase(),
        phone: editForm.phone.trim(),
        role: editForm.role,
      });

      if (res.success) {
        setEditingUser(null);
        setFeedback({ type: 'success', message: res.message });
      } else {
        setFeedback({ type: 'error', message: res.message || 'Failed to update user.' });
      }
      await loadData();
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTarget) return;
    if (resetNewPassword.length < 8) {
      setFeedback({ type: 'error', message: 'Temporary password must be at least 8 characters.' });
      return;
    }
    if (resetNewPassword !== resetConfirmPassword) {
      setFeedback({ type: 'error', message: 'Passwords do not match.' });
      return;
    }

    setIsActionLoading(true);
    setFeedback(null);
    try {
      const res = await identityAdminService.resetOutletUserPassword(
        session.token,
        resetTarget.userId,
        {
          newPassword: resetNewPassword,
          email: resetTarget.email || undefined,
          outletCode: resetTarget.outletCode,
        }
      );

      if (res.success) {
        setResetTarget(null);
        setResetNewPassword('');
        setResetConfirmPassword('');
        setFeedback({
          type: 'success',
          message: `${res.message} User must change this temporary password on next sign-in.`,
        });
      } else {
        setFeedback({ type: 'error', message: res.message || 'Password reset failed.' });
      }
      await loadData();
    } finally {
      setIsActionLoading(false);
    }
  };

  const executeToggleStatus = async (user: OutletUserRecord) => {
    setIsActionLoading(true);
    setFeedback(null);
    try {
      const res = await identityAdminService.setOutletUserStatus(session.token, user.userId, {
        isActive: !user.isActive,
        email: user.email || undefined,
        outletCode: user.outletCode,
      });
      setFeedback({
        type: res.success ? 'success' : 'error',
        message: res.message,
      });
      await loadData();
    } finally {
      setIsActionLoading(false);
      setConfirmToggleUser(null);
    }
  };

  const handleRetryOutbox = async (id: string) => {
    setIsActionLoading(true);
    setFeedback(null);
    try {
      const res = await identityAdminService.retrySyncOutboxItem(session.token, id);
      setFeedback({
        type: res.success ? 'success' : 'error',
        message: res.message,
      });
      await loadData();
    } finally {
      setIsActionLoading(false);
    }
  };

  const syncedOutboxCount = outboxItems.filter((i) => i.status === 'SYNCED').length;
  const pendingOutboxCount = outboxItems.filter(
    (i) => i.status === 'PARTIAL_CENTRAL_ONLY' || i.status === 'PENDING' || i.status === 'FAILED'
  ).length;
  const conflictOutboxCount = outboxItems.filter((i) => i.status === 'CONFLICT').length;

  return (
    <div className="space-y-4">
      <Card padding="md" className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-[#2F3033]">
            Multi-Outlet User Management &amp; Bidirectional Sync
          </h2>
          <p className="text-xs text-[#6F737D] mt-0.5">
            Synchronized with Central SMAV Auth and each outlet&apos;s isolated database.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Filter by outlet"
            value={selectedOutletCode}
            onChange={(e) => setSelectedOutletCode(e.target.value)}
            className="min-h-[40px] rounded-xl bg-white border border-[#E5E7EC] px-3 py-1.5 text-xs font-medium text-[#2F3033] focus:outline-none focus:border-[#FF1B7A]"
          >
            <option value="all">All Registered Outlets</option>
            {outlets.map((o) => (
              <option key={o.id} value={o.code}>
                {o.name} ({o.code})
              </option>
            ))}
          </select>

          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadData(selectedOutletCode)}
            disabled={isLoading}
            leftIcon={<RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />}
          >
            Refresh
          </Button>

          <Button
            size="sm"
            onClick={() => {
              setFeedback(null);
              if (selectedOutletCode !== 'all') {
                setAddForm((prev) => ({ ...prev, outletCode: selectedOutletCode }));
              }
              setIsAddOpen(true);
            }}
            leftIcon={<UserPlus className="w-3.5 h-3.5" />}
          >
            Add User
          </Button>
        </div>
      </Card>

      {feedback && (
        <div
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className={`p-3 rounded-xl border text-xs flex items-center justify-between gap-2 ${
            feedback.type === 'success'
              ? 'bg-[#ECFDF5] border-[#BBF7D0] text-[#15803D]'
              : 'bg-[#FEF2F2] border-[#FECACA] text-[#B91C1C]'
          }`}
        >
          <span>{feedback.message}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="underline font-semibold shrink-0 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
        <button
          type="button"
          onClick={() => setActiveSubTab('users')}
          className={`min-h-[38px] shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer ${
            activeSubTab === 'users'
              ? 'bg-[#2F3033] text-white border-[#2F3033]'
              : 'bg-white text-[#6F737D] border-[#E5E7EC] hover:text-[#2F3033]'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>Users Directory ({users.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab('outbox')}
          className={`min-h-[38px] shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer ${
            activeSubTab === 'outbox'
              ? 'bg-[#2F3033] text-white border-[#2F3033]'
              : 'bg-white text-[#6F737D] border-[#E5E7EC] hover:text-[#2F3033]'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>Sync Outbox ({outboxItems.length})</span>
          {pendingOutboxCount + conflictOutboxCount > 0 && (
            <StatusBadge
              label={String(pendingOutboxCount + conflictOutboxCount)}
              tone="warning"
            />
          )}
        </button>
      </div>

      {activeSubTab === 'users' && (
        <ResponsiveTable
          rows={users}
          keyExtractor={(u) => u.userId}
          emptyState={
            <EmptyState
              title={isLoading ? 'Loading central users…' : 'No outlet users match the filter'}
            />
          }
          columns={[
            {
              key: 'user',
              header: 'User & UUID',
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
              key: 'outlet',
              header: 'Outlet & Role',
              render: (user) => {
                const list =
                  user.outlets && user.outlets.length > 0
                    ? user.outlets
                    : [
                        {
                          outletId: user.outletId,
                          outletCode: user.outletCode,
                          outletName: user.outletName,
                          role: user.outletRole,
                          isActive: user.isActive,
                        },
                      ];
                return (
                  <div className="space-y-1">
                    {list.map((o) => (
                      <div
                        key={`${user.userId}_${o.outletCode}`}
                        className="flex items-center gap-1.5 flex-wrap"
                      >
                        <span className="font-medium text-[#2F3033]">
                          {o.outletName || o.outletCode}
                        </span>
                        <StatusBadge
                          label={getVisibleRole(o.role)}
                          tone={getVisibleRole(o.role) === 'ADMIN' ? 'info' : 'success'}
                        />
                      </div>
                    ))}
                  </div>
                );
              },
            },
            {
              key: 'status',
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
                            ? 'PENDING OUTLET'
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
                      Temp password change required
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
                const isProtectedSuper = user.platformRole === 'SUPERADMIN';
                return (
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    {!isProtectedSuper && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isActionLoading}
                          onClick={() => {
                            setFeedback(null);
                            setEditingUser(user);
                            setEditForm({
                              outletCode: user.outletCode,
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
                            setFeedback(null);
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
                            user.isActive
                              ? setConfirmToggleUser(user)
                              : void executeToggleStatus(user)
                          }
                        >
                          {user.isActive ? 'Disable' : 'Enable'}
                        </Button>
                      </>
                    )}
                    {user.outletId && (
                      <Button
                        size="sm"
                        onClick={() => onLaunchOutletPos(user.outletId)}
                        leftIcon={<Play className="w-3 h-3 fill-current" />}
                      >
                        POS
                      </Button>
                    )}
                  </div>
                );
              },
            },
          ]}
          renderMobileCard={(user) => {
            const visibleRole = getVisibleRole(user.outletRole || user.displayRole || user.role);
            const isProtectedSuper = user.platformRole === 'SUPERADMIN';
            return (
              <div className="space-y-2.5 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-[#2F3033] truncate">{user.fullName}</p>
                    <p className="font-mono text-[11px] text-[#6F737D] truncate">
                      {user.email || 'No email'}
                    </p>
                    <p className="text-[11px] text-[#6F737D]">
                      {user.outletName || user.outletCode}
                    </p>
                  </div>
                  <StatusBadge
                    label={visibleRole}
                    tone={visibleRole === 'ADMIN' ? 'info' : 'success'}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-[#F0F1F5]">
                  {!isProtectedSuper && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setFeedback(null);
                          setEditingUser(user);
                          setEditForm({
                            outletCode: user.outletCode,
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
                          setFeedback(null);
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
                          user.isActive
                            ? setConfirmToggleUser(user)
                            : void executeToggleStatus(user)
                        }
                      >
                        {user.isActive ? 'Disable' : 'Enable'}
                      </Button>
                    </>
                  )}
                  {user.outletId && (
                    <Button size="sm" onClick={() => onLaunchOutletPos(user.outletId)}>
                      Launch POS
                    </Button>
                  )}
                </div>
              </div>
            );
          }}
        />
      )}

      {activeSubTab === 'outbox' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card padding="md">
              <div className="text-xs text-[#6F737D]">Confirmed (Central + Outlet)</div>
              <div className="text-xl font-bold text-[#15803D] mt-1 tabular-nums">
                {syncedOutboxCount}
              </div>
            </Card>
            <Card padding="md">
              <div className="text-xs text-[#6F737D]">Pending / Retrying</div>
              <div className="text-xl font-bold text-[#B45309] mt-1 tabular-nums">
                {pendingOutboxCount}
              </div>
            </Card>
            <Card padding="md">
              <div className="text-xs text-[#6F737D]">Conflicts Requiring Review</div>
              <div className="text-xl font-bold text-[#B91C1C] mt-1 tabular-nums">
                {conflictOutboxCount}
              </div>
            </Card>
          </div>

          <ResponsiveTable
            rows={outboxItems}
            keyExtractor={(item) => item.id}
            emptyState={<EmptyState title="No synchronization events recorded in outbox" />}
            columns={[
              {
                key: 'op',
                header: 'Operation & Target',
                render: (item) => (
                  <div>
                    <div className="font-bold text-[#2F3033] uppercase text-[11px]">
                      {item.action}
                    </div>
                    <div className="text-[#2F3033]">
                      {item.payload?.fullName || item.payload?.email || item.targetUserId || '—'}
                    </div>
                    <div className="font-mono text-[10px] text-[#6F737D]">
                      {new Date(item.updatedAt).toLocaleString()}
                    </div>
                  </div>
                ),
              },
              {
                key: 'origin',
                header: 'Outlet & Origin',
                render: (item) => (
                  <div>
                    <div className="font-mono font-semibold text-[#2F3033]">{item.outletCode}</div>
                    <div className="text-[10px] text-[#6F737D]">origin: {item.syncOrigin}</div>
                  </div>
                ),
              },
              {
                key: 'confirm',
                header: 'Confirmations',
                render: (item) => (
                  <div className="space-y-1 text-[11px]">
                    <div className="flex items-center gap-1.5">
                      {item.centralConfirmed ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#15803D]" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 text-[#DC2626]" />
                      )}
                      <span>Central SMAV</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {item.outletConfirmed ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#15803D]" />
                      ) : (
                        <AlertTriangle className="w-3.5 h-3.5 text-[#D97706]" />
                      )}
                      <span>Outlet Database</span>
                    </div>
                  </div>
                ),
              },
              {
                key: 'status',
                header: 'Status / Error',
                render: (item) => (
                  <div>
                    <StatusBadge
                      label={item.status}
                      tone={
                        item.status === 'SYNCED'
                          ? 'success'
                          : item.status === 'CONFLICT' || item.status === 'FAILED'
                            ? 'danger'
                            : 'warning'
                      }
                    />
                    {item.lastError && (
                      <div className="text-[11px] text-[#B45309] mt-1 max-w-xs">
                        {item.lastError}
                      </div>
                    )}
                  </div>
                ),
              },
              {
                key: 'action',
                header: 'Action',
                align: 'right',
                render: (item) =>
                  item.status !== 'SYNCED' && item.status !== 'CONFLICT' ? (
                    <Button
                      size="sm"
                      disabled={isActionLoading}
                      onClick={() => handleRetryOutbox(item.id)}
                    >
                      Retry Sync
                    </Button>
                  ) : (
                    <span className="text-[#6F737D]">—</span>
                  ),
              },
            ]}
            renderMobileCard={(item) => (
              <div className="space-y-2 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-bold text-[#2F3033] uppercase">{item.action}</p>
                    <p className="text-[#6F737D]">
                      {item.payload?.fullName || item.payload?.email || item.targetUserId || '—'} ·{' '}
                      <span className="font-mono">{item.outletCode}</span>
                    </p>
                  </div>
                  <StatusBadge
                    label={item.status}
                    tone={
                      item.status === 'SYNCED'
                        ? 'success'
                        : item.status === 'CONFLICT' || item.status === 'FAILED'
                          ? 'danger'
                          : 'warning'
                    }
                  />
                </div>
                {item.lastError && <p className="text-[11px] text-[#B45309]">{item.lastError}</p>}
                {item.status !== 'SYNCED' && item.status !== 'CONFLICT' && (
                  <Button
                    size="sm"
                    disabled={isActionLoading}
                    onClick={() => handleRetryOutbox(item.id)}
                  >
                    Retry Sync
                  </Button>
                )}
              </div>
            )}
          />
        </div>
      )}

      {/* Modal: Add User */}
      {isAddOpen && (
        <div className="fixed inset-0 z-50 bg-[#111827]/45 backdrop-blur-[2px] flex items-center justify-center p-4">
          <Card padding="lg" className="max-w-md w-full shadow-xl space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-2.5 border-b border-[#E5E7EC]">
              <h3 className="text-base font-bold text-[#2F3033]">Add Outlet User</h3>
              <button
                type="button"
                onClick={() => setIsAddOpen(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-[#6F737D] hover:bg-[#F5F6FA] cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddUser} className="space-y-3">
              <FormField label="Target Outlet" required>
                <select
                  value={addForm.outletCode}
                  onChange={(e) => setAddForm({ ...addForm, outletCode: e.target.value })}
                  required
                  className={BASE_INPUT_CLASS}
                >
                  <option value="">-- Select Outlet --</option>
                  {outlets.map((o) => (
                    <option key={o.id} value={o.code}>
                      {o.name} ({o.code})
                    </option>
                  ))}
                </select>
              </FormField>

              <FormField label="Full Name" required>
                <input
                  type="text"
                  value={addForm.fullName}
                  onChange={(e) => setAddForm({ ...addForm, fullName: e.target.value })}
                  required
                  className={BASE_INPUT_CLASS}
                />
              </FormField>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="Username" required>
                  <input
                    type="text"
                    value={addForm.username}
                    onChange={(e) => setAddForm({ ...addForm, username: e.target.value })}
                    required
                    className={`${BASE_INPUT_CLASS} font-mono`}
                  />
                </FormField>
                <FormField label="Role">
                  <select
                    value={addForm.role}
                    onChange={(e) =>
                      setAddForm({ ...addForm, role: e.target.value as 'ADMIN' | 'STAFF' })
                    }
                    className={BASE_INPUT_CLASS}
                  >
                    <option value="STAFF">STAFF (POS_BILLING)</option>
                    <option value="ADMIN">ADMIN</option>
                  </select>
                </FormField>
              </div>

              <FormField label="Email Address" required>
                <input
                  type="email"
                  value={addForm.email}
                  onChange={(e) => setAddForm({ ...addForm, email: e.target.value })}
                  required
                  className={BASE_INPUT_CLASS}
                />
              </FormField>

              <PasswordField
                label="Initial Temporary Password (min. 8 chars)"
                hint="User must set a personal password on first sign-in."
                value={addForm.initialPassword}
                onChange={(e) => setAddForm({ ...addForm, initialPassword: e.target.value })}
                minLength={8}
                required
              />

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-[#E5E7EC]">
                <Button variant="outline" size="sm" onClick={() => setIsAddOpen(false)}>
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
                  value={editForm.fullName}
                  onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })}
                  required
                  className={BASE_INPUT_CLASS}
                />
              </FormField>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="Username">
                  <input
                    type="text"
                    value={editForm.username}
                    onChange={(e) => setEditForm({ ...editForm, username: e.target.value })}
                    className={`${BASE_INPUT_CLASS} font-mono`}
                  />
                </FormField>
                <FormField label="Role">
                  <select
                    value={editForm.role}
                    onChange={(e) =>
                      setEditForm({ ...editForm, role: e.target.value as 'ADMIN' | 'STAFF' })
                    }
                    className={BASE_INPUT_CLASS}
                  >
                    <option value="STAFF">STAFF (POS_BILLING)</option>
                    <option value="ADMIN">ADMIN</option>
                  </select>
                </FormField>
              </div>

              <FormField label="Email Address" required>
                <input
                  type="email"
                  value={editForm.email}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
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
              <h3 className="text-base font-bold text-[#2F3033]">Reset User Password</h3>
              <button
                type="button"
                onClick={() => setResetTarget(null)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-[#6F737D] hover:bg-[#F5F6FA] cursor-pointer"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-[#6F737D] leading-relaxed">
              Assign a temporary password for{' '}
              <span className="font-bold text-[#2F3033]">{resetTarget.fullName}</span> (
              {resetTarget.email || resetTarget.userId}). They must change it on first sign-in.
            </p>

            <form onSubmit={handleResetPassword} className="space-y-3">
              <PasswordField
                label="New Temporary Password (min. 8 chars)"
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
            ? `Disable ${confirmToggleUser.fullName}? They will lose access to ${confirmToggleUser.outletName || confirmToggleUser.outletCode} until re-enabled.`
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
