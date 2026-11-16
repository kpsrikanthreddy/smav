import React, { useState, useEffect } from 'react';
import {
  Users,
  RefreshCw,
  UserPlus,
  Edit2,
  KeyRound,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Play,
  Activity,
} from 'lucide-react';
import { Outlet, OutletUserRecord, SyncOutboxItem, UserSession, getVisibleRole } from '../types';
import { identityAdminService } from '../services/identityAdminService';

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
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Add User Modal
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

  // Edit User Modal
  const [editingUser, setEditingUser] = useState<OutletUserRecord | null>(null);
  const [editForm, setEditForm] = useState({
    outletCode: '',
    fullName: '',
    username: '',
    email: '',
    phone: '',
    role: 'STAFF' as 'ADMIN' | 'STAFF',
  });

  // Reset Password Modal
  const [resetTarget, setResetTarget] = useState<OutletUserRecord | null>(null);
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');

  const loadData = async (filterOutletCode = selectedOutletCode) => {
    setIsLoading(true);
    try {
      const headers = { Authorization: `Bearer ${session.token}` };
      const [outletsRes, usersRes, outboxRes] = await Promise.all([
        fetch('/api/superadmin/outlets', { headers }).then((r) => r.json()).catch(() => ({ outlets: [] })),
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
    loadData(selectedOutletCode);
  }, [session.token, selectedOutletCode]);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addForm.outletCode) {
      setFeedback({ type: 'error', message: 'Select a target outlet first.' });
      return;
    }
    if (addForm.initialPassword.length < 8) {
      setFeedback({ type: 'error', message: 'Initial temporary password must be at least 8 characters.' });
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
      const res = await identityAdminService.resetOutletUserPassword(session.token, resetTarget.userId, {
        newPassword: resetNewPassword,
        email: resetTarget.email || undefined,
        outletCode: resetTarget.outletCode,
      });

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

  const handleToggleStatus = async (user: OutletUserRecord) => {
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
  const pendingOutboxCount = outboxItems.filter((i) => i.status === 'PARTIAL_CENTRAL_ONLY' || i.status === 'PENDING' || i.status === 'FAILED').length;
  const conflictOutboxCount = outboxItems.filter((i) => i.status === 'CONFLICT').length;

  return (
    <div className="space-y-5">
      {/* Header & Controls */}
      <div className="bg-[#121629] border border-[#1e2540] rounded-2xl p-5 shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-white">Multi-Outlet User Management &amp; Bidirectional Sync</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Single-source management synchronized with Central SMAV Auth and each outlet&apos;s isolated database.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          <select
            value={selectedOutletCode}
            onChange={(e) => setSelectedOutletCode(e.target.value)}
            className="rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3 py-2 focus:outline-none focus:border-pink-500"
          >
            <option value="all">All Registered Outlets</option>
            {outlets.map((o) => (
              <option key={o.id} value={o.code}>
                {o.name} ({o.code})
              </option>
            ))}
          </select>

          <button
            onClick={() => loadData(selectedOutletCode)}
            disabled={isLoading}
            className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium flex items-center gap-1.5 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>

          <button
            onClick={() => {
              setFeedback(null);
              if (selectedOutletCode !== 'all') {
                setAddForm((prev) => ({ ...prev, outletCode: selectedOutletCode }));
              }
              setIsAddOpen(true);
            }}
            className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-pink-500 to-orange-500 hover:brightness-110 text-white font-semibold flex items-center gap-1.5 shadow transition"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Add User
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`p-3 rounded-xl border text-xs flex items-center justify-between gap-2 ${
            feedback.type === 'success'
              ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/15 border-rose-500/30 text-rose-300'
          }`}
        >
          <span>{feedback.message}</span>
          <button onClick={() => setFeedback(null)} className="underline text-[11px] shrink-0">Dismiss</button>
        </div>
      )}

      {/* Sub-Navigation */}
      <div className="flex items-center gap-2 text-xs">
        <button
          onClick={() => setActiveSubTab('users')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl font-semibold transition ${
            activeSubTab === 'users'
              ? 'bg-slate-800 text-white border border-slate-700'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          Outlet Users Directory ({users.length})
        </button>
        <button
          onClick={() => setActiveSubTab('outbox')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl font-semibold transition ${
            activeSubTab === 'outbox'
              ? 'bg-slate-800 text-white border border-slate-700'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          Sync Outbox &amp; Status ({outboxItems.length})
          {(pendingOutboxCount > 0 || conflictOutboxCount > 0) && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px]">
              {pendingOutboxCount + conflictOutboxCount}
            </span>
          )}
        </button>
      </div>

      {/* SUB-TAB 1: OUTLET USERS DIRECTORY */}
      {activeSubTab === 'users' && (
        <div className="bg-[#121629] border border-[#1e2540] rounded-2xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-[#161a33] text-slate-400 border-b border-[#2a3055] font-semibold">
                <tr>
                  <th className="p-4">User &amp; Central UUID</th>
                  <th className="p-4">Outlet &amp; Role</th>
                  <th className="p-4">Sync Status</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-slate-500">
                      {isLoading ? 'Loading central users...' : 'No outlet users match the current filter.'}
                    </td>
                  </tr>
                ) : (
                  users.map((user) => {
                    const visibleRole = getVisibleRole(user.outletRole || user.displayRole || user.role);
                    const isProtectedSuper = user.platformRole === 'SUPERADMIN';

                    return (
                      <tr key={user.userId} className="hover:bg-slate-800/30 transition">
                        <td className="p-4">
                          <div className="font-bold text-white flex items-center gap-2">
                            <span>{user.fullName}</span>
                            {isProtectedSuper && (
                              <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 text-[9px] font-bold">
                                SUPERADMIN
                              </span>
                            )}
                          </div>
                          <div className="font-mono text-[11px] text-slate-300 mt-0.5">{user.email || 'No email'}</div>
                          {user.username && (
                            <div className="text-slate-400 font-mono text-[10px]">@{user.username}</div>
                          )}
                          <div className="text-slate-500 font-mono text-[10px]">UUID: {user.userId}</div>
                        </td>
                        <td className="p-4">
                          <div className="space-y-1">
                            {(user.outlets && user.outlets.length > 0 ? user.outlets : [
                              {
                                outletId: user.outletId,
                                outletCode: user.outletCode,
                                outletName: user.outletName,
                                role: user.outletRole,
                                isActive: user.isActive,
                              },
                            ]).map((o) => (
                              <div key={`${user.userId}_${o.outletCode}`} className="flex items-center gap-1.5">
                                <span className="text-slate-200 font-medium">{o.outletName || o.outletCode}</span>
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${
                                    getVisibleRole(o.role) === 'ADMIN'
                                      ? 'bg-sky-500/15 text-sky-300 border-sky-500/30'
                                      : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                  }`}
                                >
                                  {getVisibleRole(o.role)}
                                </span>
                              </div>
                            ))}
                          </div>
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
                                    ? 'PENDING OUTLET'
                                    : 'SYNCED'}
                            </span>
                            {user.mustChangePassword && user.isActive && (
                              <span className="text-[10px] text-amber-300">Temp password change required</span>
                            )}
                            {user.lastSyncedAt && (
                              <span className="text-[10px] text-slate-500">
                                {new Date(user.lastSyncedAt).toLocaleString()}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-4 text-right">
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            {!isProtectedSuper && (
                              <>
                                <button
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
                                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold flex items-center gap-1"
                                >
                                  <Edit2 className="w-3 h-3" />
                                  Edit User
                                </button>
                                <button
                                  disabled={isActionLoading}
                                  onClick={() => {
                                    setFeedback(null);
                                    setResetTarget(user);
                                    setResetNewPassword('');
                                    setResetConfirmPassword('');
                                  }}
                                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-400 text-[11px] font-semibold flex items-center gap-1"
                                >
                                  <KeyRound className="w-3 h-3" />
                                  Reset Password
                                </button>
                                <button
                                  disabled={isActionLoading}
                                  onClick={() => handleToggleStatus(user)}
                                  className={`px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold ${
                                    user.isActive ? 'text-rose-400' : 'text-emerald-400'
                                  }`}
                                >
                                  {user.isActive ? 'Disable User' : 'Enable User'}
                                </button>
                              </>
                            )}
                            {user.outletId && (
                              <button
                                onClick={() => onLaunchOutletPos(user.outletId)}
                                className="px-2.5 py-1.5 rounded-lg bg-pink-600/20 hover:bg-pink-600/30 text-pink-300 border border-pink-500/30 text-[11px] font-semibold flex items-center gap-1"
                              >
                                <Play className="w-3 h-3 fill-current" />
                                Launch POS
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: SYNC OUTBOX & CONFIRMATION MONITOR */}
      {activeSubTab === 'outbox' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-[#121629] border border-[#1e2540] rounded-xl p-4">
              <div className="text-[11px] text-slate-400">Confirmed (Central + Outlet)</div>
              <div className="text-xl font-bold text-emerald-400 mt-1">{syncedOutboxCount}</div>
            </div>
            <div className="bg-[#121629] border border-[#1e2540] rounded-xl p-4">
              <div className="text-[11px] text-slate-400">Pending / Retrying Outlet Sync</div>
              <div className="text-xl font-bold text-amber-400 mt-1">{pendingOutboxCount}</div>
            </div>
            <div className="bg-[#121629] border border-[#1e2540] rounded-xl p-4">
              <div className="text-[11px] text-slate-400">Conflicts Requiring Review</div>
              <div className="text-xl font-bold text-rose-400 mt-1">{conflictOutboxCount}</div>
            </div>
          </div>

          <div className="bg-[#121629] border border-[#1e2540] rounded-2xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-[#161a33] text-slate-400 border-b border-[#2a3055] font-semibold">
                  <tr>
                    <th className="p-3.5">Operation &amp; Target</th>
                    <th className="p-3.5">Outlet &amp; Origin</th>
                    <th className="p-3.5">Confirmations</th>
                    <th className="p-3.5">Status / Error</th>
                    <th className="p-3.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {outboxItems.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-slate-500">
                        No synchronization events recorded in outbox yet.
                      </td>
                    </tr>
                  ) : (
                    outboxItems.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-800/30">
                        <td className="p-3.5">
                          <div className="font-bold text-white uppercase text-[11px]">{item.action}</div>
                          <div className="text-slate-300 mt-0.5">
                            {item.payload?.fullName || item.payload?.email || item.targetUserId || '—'}
                          </div>
                          <div className="font-mono text-[10px] text-slate-500">
                            {new Date(item.updatedAt).toLocaleString()}
                          </div>
                        </td>
                        <td className="p-3.5">
                          <div className="font-mono text-slate-200">{item.outletCode}</div>
                          <div className="text-[10px] text-slate-400">origin: {item.syncOrigin}</div>
                        </td>
                        <td className="p-3.5 space-y-1 text-[11px]">
                          <div className="flex items-center gap-1.5">
                            {item.centralConfirmed ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <XCircle className="w-3.5 h-3.5 text-rose-400" />
                            )}
                            <span>Central SMAV</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {item.outletConfirmed ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                            )}
                            <span>Outlet Database</span>
                          </div>
                        </td>
                        <td className="p-3.5">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              item.status === 'SYNCED'
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : item.status === 'CONFLICT' || item.status === 'FAILED'
                                  ? 'bg-rose-500/20 text-rose-300'
                                  : 'bg-amber-500/20 text-amber-300'
                            }`}
                          >
                            {item.status}
                          </span>
                          {item.lastError && (
                            <div className="text-[11px] text-amber-300 mt-1 max-w-xs">{item.lastError}</div>
                          )}
                        </td>
                        <td className="p-3.5 text-right">
                          {item.status !== 'SYNCED' && item.status !== 'CONFLICT' ? (
                            <button
                              disabled={isActionLoading}
                              onClick={() => handleRetryOutbox(item.id)}
                              className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-semibold"
                            >
                              Retry Sync
                            </button>
                          ) : (
                            <span className="text-[11px] text-slate-500">—</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Add User */}
      {isAddOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#121629] border border-[#1e2540] rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h3 className="text-base font-bold text-white">Add Outlet User</h3>
              <button onClick={() => setIsAddOpen(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <form onSubmit={handleAddUser} className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-300 mb-1 block">Target Outlet</label>
                <select
                  value={addForm.outletCode}
                  onChange={(e) => setAddForm({ ...addForm, outletCode: e.target.value })}
                  required
                  className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2 focus:outline-none focus:border-pink-500"
                >
                  <option value="">-- Select Outlet --</option>
                  {outlets.map((o) => (
                    <option key={o.id} value={o.code}>
                      {o.name} ({o.code})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-semibold text-slate-300 mb-1 block">Full Name</label>
                <input
                  type="text"
                  value={addForm.fullName}
                  onChange={(e) => setAddForm({ ...addForm, fullName: e.target.value })}
                  required
                  className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2 focus:outline-none focus:border-pink-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-300 mb-1 block">Username</label>
                  <input
                    type="text"
                    value={addForm.username}
                    onChange={(e) => setAddForm({ ...addForm, username: e.target.value })}
                    required
                    className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2 font-mono focus:outline-none focus:border-pink-500"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-300 mb-1 block">Role</label>
                  <select
                    value={addForm.role}
                    onChange={(e) => setAddForm({ ...addForm, role: e.target.value as 'ADMIN' | 'STAFF' })}
                    className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2 focus:outline-none focus:border-pink-500"
                  >
                    <option value="STAFF">STAFF (POS_BILLING)</option>
                    <option value="ADMIN">ADMIN</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-300 mb-1 block">Email Address</label>
                <input
                  type="email"
                  value={addForm.email}
                  onChange={(e) => setAddForm({ ...addForm, email: e.target.value })}
                  required
                  className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2 focus:outline-none focus:border-pink-500"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-300 mb-1 block">Initial Temporary Password (min. 8 chars)</label>
                <input
                  type="password"
                  value={addForm.initialPassword}
                  onChange={(e) => setAddForm({ ...addForm, initialPassword: e.target.value })}
                  minLength={8}
                  required
                  className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2 focus:outline-none focus:border-pink-500"
                />
                <p className="text-[10px] text-slate-400 mt-1">User must set a personal password on first sign-in.</p>
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddOpen(false)}
                  className="px-4 py-2 rounded-xl text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isActionLoading}
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-pink-500 to-orange-500 text-white font-semibold shadow disabled:opacity-50"
                >
                  {isActionLoading ? 'Syncing...' : 'Save & Sync User'}
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
            <div className="text-[10px] font-mono text-slate-400">Central Auth UUID: {editingUser.userId}</div>

            <form onSubmit={handleEditUser} className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-300 mb-1 block">Full Name</label>
                <input
                  type="text"
                  value={editForm.fullName}
                  onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })}
                  required
                  className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2 focus:outline-none focus:border-pink-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-300 mb-1 block">Username</label>
                  <input
                    type="text"
                    value={editForm.username}
                    onChange={(e) => setEditForm({ ...editForm, username: e.target.value })}
                    className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2 font-mono focus:outline-none focus:border-pink-500"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-300 mb-1 block">Role</label>
                  <select
                    value={editForm.role}
                    onChange={(e) => setEditForm({ ...editForm, role: e.target.value as 'ADMIN' | 'STAFF' })}
                    className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2 focus:outline-none focus:border-pink-500"
                  >
                    <option value="STAFF">STAFF (POS_BILLING)</option>
                    <option value="ADMIN">ADMIN</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-300 mb-1 block">Email Address</label>
                <input
                  type="email"
                  value={editForm.email}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
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
                  className="px-5 py-2 rounded-xl bg-pink-600 hover:bg-pink-500 text-white font-semibold shadow disabled:opacity-50"
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
              <h3 className="text-base font-bold text-white">Reset User Password</h3>
              <button onClick={() => setResetTarget(null)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Assign a temporary password for <span className="font-bold text-white">{resetTarget.fullName}</span> ({resetTarget.email || resetTarget.userId}). They must change it on first sign-in.
            </p>

            <form onSubmit={handleResetPassword} className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-300 mb-1 block">New Temporary Password (min. 8 chars)</label>
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
                  className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold shadow disabled:opacity-50"
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
