import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Building2,
  CheckCircle2,
  Database,
  Edit2,
  History,
  KeyRound,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Scissors,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  TrendingUp,
  UserPlus,
  Utensils,
} from 'lucide-react';
import {
  AuditLogEntry,
  BusinessCategory,
  Outlet,
  UserSession,
  getVisibleRole,
} from '../types';
import { PortalAuthDashboard } from './PortalAuthDashboard';
import { IntegrationDiagnostics } from './IntegrationDiagnostics';
import { identityAdminService } from '../services/identityAdminService';
import {
  BASE_INPUT_CLASS,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FormField,
  LoadingState,
  PasswordField,
  ResponsiveTable,
  StatusBadge,
} from './ui';

interface SuperadminDashboardProps {
  session: UserSession;
  onLaunchOutletPos: (outletId: string) => void;
  onLogout: () => void;
}

export const SuperadminDashboard: React.FC<SuperadminDashboardProps> = ({
  session,
  onLaunchOutletPos,
}) => {
  const [activeTab, setActiveTab] = useState<
    'outlets' | 'admins' | 'reports' | 'audit' | 'supabase' | 'portal_auth' | 'integrations'
  >('outlets');
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [reportsSummary, setReportsSummary] = useState<any>(null);
  const [adminsList, setAdminsList] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [outletLoadError, setOutletLoadError] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [supabaseStatus, setSupabaseStatus] = useState<any>(null);

  const [isAddOutletOpen, setIsAddOutletOpen] = useState(false);
  const [isEditOutletOpen, setIsEditOutletOpen] = useState(false);
  const [isAddAdminOpen, setIsAddAdminOpen] = useState(false);
  const [isResetPasswordOpen, setIsResetPasswordOpen] = useState(false);
  const [selectedOutlet, setSelectedOutlet] = useState<Outlet | null>(null);
  const [selectedAdmin, setSelectedAdmin] = useState<any | null>(null);
  const [confirmDisableOutlet, setConfirmDisableOutlet] = useState<Outlet | null>(null);

  const [newOutletForm, setNewOutletForm] = useState({
    name: '',
    code: '',
    category: 'restaurant' as BusinessCategory,
    address: '',
    phone: '',
    gstin: '',
    receiptHeader: '',
    receiptFooter: '',
    providerType: 'custom_outlet' as any,
    supabaseUrl: '',
    syncWebhookUrl: '',
  });

  const [editOutletForm, setEditOutletForm] = useState({
    name: '',
    code: '',
    category: 'restaurant' as BusinessCategory,
    address: '',
    phone: '',
    gstin: '',
    receiptHeader: '',
    receiptFooter: '',
    supabaseUrl: '',
    syncWebhookUrl: '',
  });

  const [newAdminForm, setNewAdminForm] = useState({
    email: '',
    username: '',
    fullName: '',
    phone: '',
    outletId: '',
    initialPassword: '',
  });

  const [resetPassFeedback, setResetPassFeedback] = useState<string | null>(null);
  const [resetTempPassword, setResetTempPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const headers = { Authorization: `Bearer ${session.token}` };

      const [outletsRes, reportsRes, adminsRes, auditRes, profileRes, sbStatusRes] =
        await Promise.all([
          fetch('/api/superadmin/outlets', { headers })
            .then((r) => r.json())
            .catch(() => ({ outlets: [] })),
          fetch('/api/superadmin/reports', { headers })
            .then((r) => r.json())
            .catch(() => null),
          fetch('/api/superadmin/admins', { headers })
            .then((r) => r.json())
            .catch(() => ({ admins: [] })),
          fetch('/api/superadmin/audit-logs', { headers })
            .then((r) => r.json())
            .catch(() => ({ logs: [] })),
          fetch('/api/auth/profile', { headers })
            .then((r) => r.json())
            .catch(() => null),
          fetch('/api/central-supabase/status')
            .then((r) => r.json())
            .catch(() => null),
        ]);

      if (outletsRes.success && Array.isArray(outletsRes.outlets)) {
        setOutlets(outletsRes.outlets);
        setOutletLoadError(null);
      } else {
        setOutlets([]);
        setOutletLoadError(outletsRes.message || 'Unable to load central outlet registry.');
      }
      if (reportsRes) setReportsSummary(reportsRes);
      if (adminsRes.admins) setAdminsList(adminsRes.admins);
      if (auditRes.logs) setAuditLogs(auditRes.logs);
      if (profileRes?.profile) setUserProfile(profileRes.profile);
      if (sbStatusRes) setSupabaseStatus(sbStatusRes);
    } catch (e) {
      console.error('Superadmin data fetch error:', e);
      setOutletLoadError('Cannot reach SMAV backend.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, [session.token]);

  const handleCreateOutlet = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/superadmin/outlets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify(newOutletForm),
      });
      if (res.ok) {
        setIsAddOutletOpen(false);
        setNewOutletForm({
          name: '',
          code: '',
          category: 'restaurant',
          address: '',
          phone: '',
          gstin: '',
          receiptHeader: '',
          receiptFooter: '',
          providerType: 'custom_outlet',
          supabaseUrl: '',
          syncWebhookUrl: '',
        });
        void fetchData();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleUpdateOutlet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOutlet) return;
    try {
      const res = await fetch(`/api/superadmin/outlets/${selectedOutlet.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify(editOutletForm),
      });
      if (res.ok) {
        setIsEditOutletOpen(false);
        void fetchData();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const executeToggleOutletStatus = async (outlet: Outlet) => {
    try {
      const res = await fetch(`/api/superadmin/outlets/${outlet.id}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({ isActive: !outlet.isActive }),
      });
      if (res.ok) {
        setOutlets((prev) =>
          prev.map((o) => (o.id === outlet.id ? { ...o, isActive: !outlet.isActive } : o))
        );
      }
    } catch (e) {
      console.error(e);
    } finally {
      setConfirmDisableOutlet(null);
    }
  };

  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetPassFeedback(null);
    if (newAdminForm.initialPassword.length < 8) {
      setResetPassFeedback('Error: Initial temporary password must be at least 8 characters.');
      return;
    }

    try {
      const targetOutlet = outlets.find((o) => o.id === newAdminForm.outletId);
      const outletCode = targetOutlet?.code || newAdminForm.outletId;

      const res = await fetch('/api/superadmin/admins', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({
          email: newAdminForm.email.trim(),
          username: newAdminForm.username.trim().toLowerCase() || undefined,
          fullName: newAdminForm.fullName.trim(),
          phone: newAdminForm.phone.trim(),
          outletId: newAdminForm.outletId,
          outletCode,
          initialPassword: newAdminForm.initialPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setIsAddAdminOpen(false);
        setResetPassFeedback(data.message || 'Outlet administrator provisioned in Central SMAV.');
        setNewAdminForm({
          email: '',
          username: '',
          fullName: '',
          phone: '',
          outletId: '',
          initialPassword: '',
        });
        void fetchData();
      } else {
        setResetPassFeedback(
          `Error: ${data.message || data.error || 'Failed to create administrator'}`
        );
      }
    } catch (e: any) {
      console.error(e);
      setResetPassFeedback(`Error: ${e.message}`);
    }
  };

  const handleResetAdminPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAdmin) return;
    const targetUserId = selectedAdmin.userId || selectedAdmin.id;
    if (!targetUserId) {
      setResetPassFeedback('Error: Target Central Auth UUID is missing for this administrator.');
      return;
    }
    if (resetTempPassword.length < 8) {
      setResetPassFeedback('Error: Temporary password must be at least 8 characters.');
      return;
    }
    if (resetTempPassword !== resetConfirmPassword) {
      setResetPassFeedback('Error: Password confirmation does not match.');
      return;
    }

    try {
      const targetOutletCode =
        selectedAdmin.outletCode || selectedAdmin.memberships?.[0]?.outletCode || 'glossylooks';
      const res = await identityAdminService.resetOutletUserPassword(session.token, targetUserId, {
        newPassword: resetTempPassword,
        email: selectedAdmin.email || undefined,
        outletCode: targetOutletCode,
      });

      if (res.success) {
        setResetTempPassword('');
        setResetConfirmPassword('');
        setResetPassFeedback(
          `${res.message} User must change this temporary password on next sign-in.`
        );
      } else {
        setResetPassFeedback(
          `Error: ${res.message || res.error || 'Failed to set temporary password'}`
        );
      }
    } catch (e: any) {
      console.error(e);
      setResetPassFeedback(`Error: ${e.message}`);
    }
  };

  const filteredOutlets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return outlets.filter((o) => {
      const matchesCat = selectedCategory === 'all' || o.category === selectedCategory;
      // The central registry can contain historical or partially configured
      // outlets. Never let a nullable database field crash the entire
      // superadmin screen after the asynchronous outlet load completes.
      const outletName = String(o.name || '').toLowerCase();
      const outletCode = String(o.code || '').toLowerCase();
      const outletAddress = String(o.address || '').toLowerCase();
      const matchesSearch =
        !q ||
        outletName.includes(q) ||
        outletCode.includes(q) ||
        outletAddress.includes(q);
      return matchesCat && matchesSearch;
    });
  }, [outlets, selectedCategory, searchQuery]);

  const groupedOutlets = useMemo(
    () => ({
      restaurant: filteredOutlets.filter((o) => o.category === 'restaurant'),
      salon: filteredOutlets.filter((o) => o.category === 'salon'),
      retail: filteredOutlets.filter((o) => o.category === 'retail'),
      other: filteredOutlets.filter((o) => o.category === 'other'),
    }),
    [filteredOutlets]
  );

  return (
    <div className="space-y-5">
      {/* Header Summary Card */}
      <Card padding="lg" className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge label="Superadmin Authority" tone="brand" />
            <span className="text-xs text-[#6F737D]">SMAV Central Enterprise Gateway</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-[#2F3033] tracking-tight">
            Enterprise Multi-Outlet Network
          </h1>
          <p className="text-xs text-[#6F737D]">
            Global outlet registry, identity routing, admin access control, and cross-tenant auditing.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            onClick={() => setIsAddOutletOpen(true)}
            leftIcon={<Plus className="w-4 h-4" />}
          >
            Add New Outlet
          </Button>
          <Button
            variant="outline"
            onClick={() => setIsAddAdminOpen(true)}
            leftIcon={<UserPlus className="w-4 h-4 text-[#1D4ED8]" />}
          >
            Add Outlet Admin
          </Button>
        </div>
      </Card>

      {/* Sub-Navigation Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
        {[
          { id: 'outlets', label: `Registered Outlets (${outlets.length})`, icon: Building2 },
          { id: 'portal_auth', label: 'Shared Auth & Sync', icon: Sparkles },
          { id: 'integrations', label: 'Integration Diagnostics', icon: Activity },
          { id: 'admins', label: `Outlet Admins (${adminsList.length})`, icon: KeyRound },
          { id: 'reports', label: 'Network Reports', icon: TrendingUp },
          { id: 'audit', label: `Audit Logs (${auditLogs.length})`, icon: History },
          { id: 'supabase', label: 'Central Supabase & RLS', icon: Database },
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

      {outletLoadError && (
        <ErrorState
          title="Unable to load outlet registry"
          message={outletLoadError}
          onRetry={() => void fetchData()}
        />
      )}

      {/* TAB 1: REGISTERED OUTLETS */}
      {activeTab === 'outlets' && (
        <div className="space-y-5">
          <Card padding="md" className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 text-[#6F737D] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search outlets by name, code, or address..."
                className={`${BASE_INPUT_CLASS} pl-10`}
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
              {[
                { id: 'all', label: 'All Categories' },
                { id: 'restaurant', label: 'Restaurants' },
                { id: 'salon', label: 'Salons' },
                { id: 'retail', label: 'Retail Stores' },
                { id: 'other', label: 'Other' },
              ].map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`min-h-[38px] shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                    selectedCategory === cat.id
                      ? 'bg-[#2F3033] text-white border-[#2F3033]'
                      : 'bg-[#F5F6FA] text-[#6F737D] border-[#E5E7EC] hover:text-[#2F3033]'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </Card>

          {isLoading ? (
            <LoadingState title="Loading registered outlets…" />
          ) : filteredOutlets.length === 0 ? (
            <EmptyState
              icon={<Building2 className="w-5 h-5" />}
              title="No matching outlets found"
              description="Adjust your search query or category filter."
            />
          ) : (
            [
              {
                key: 'restaurant',
                title: 'Restaurants & Cloud Kitchens',
                icon: <Utensils className="w-4 h-4 text-[#FF6A00]" />,
                items: groupedOutlets.restaurant,
              },
              {
                key: 'salon',
                title: 'Salons, Spas & Beauty Studios',
                icon: <Scissors className="w-4 h-4 text-[#FF1B7A]" />,
                items: groupedOutlets.salon,
              },
              {
                key: 'retail',
                title: 'Shopping & Retail Outlets',
                icon: <ShoppingBag className="w-4 h-4 text-[#15803D]" />,
                items: groupedOutlets.retail,
              },
              {
                key: 'other',
                title: 'Other Registered Ventures',
                icon: <Building2 className="w-4 h-4 text-[#1D4ED8]" />,
                items: groupedOutlets.other,
              },
            ].map((group) => {
              if (selectedCategory !== 'all' && selectedCategory !== group.key) return null;
              if (group.items.length === 0) return null;

              return (
                <div key={group.key} className="space-y-3">
                  <div className="flex items-center justify-between border-b border-[#E5E7EC] pb-2">
                    <h3 className="text-sm font-bold text-[#2F3033] flex items-center gap-2">
                      {group.icon}
                      <span>{group.title}</span>
                      <span className="text-xs text-[#6F737D] font-normal tabular-nums">
                        ({group.items.length})
                      </span>
                    </h3>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {group.items.map((outlet) => (
                      <Card
                        key={outlet.id}
                        padding="md"
                        interactive
                        className={`flex flex-col justify-between ${
                          outlet.isActive ? '' : 'opacity-75 border-[#FECACA]'
                        }`}
                      >
                        <div className="space-y-3">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="text-[11px] font-mono font-semibold text-[#6F737D] uppercase">
                              CODE: {outlet.code}
                            </span>
                            <div className="flex items-center gap-1.5">
                              {outlet.supabaseUrl && (
                                <StatusBadge label="Supabase Live" tone="info" />
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  outlet.isActive
                                    ? setConfirmDisableOutlet(outlet)
                                    : void executeToggleOutletStatus(outlet)
                                }
                                title="Click to toggle outlet status"
                                className="cursor-pointer"
                              >
                                <StatusBadge
                                  label={outlet.isActive ? 'Active' : 'Disabled'}
                                  tone={outlet.isActive ? 'success' : 'danger'}
                                  dot
                                />
                              </button>
                            </div>
                          </div>

                          <div>
                            <h4 className="text-base font-bold text-[#2F3033] leading-snug">
                              {outlet.name}
                            </h4>
                            <p className="text-xs text-[#6F737D] mt-1 line-clamp-2">
                              {outlet.address}
                            </p>
                          </div>

                          <div className="pt-2.5 border-t border-[#F0F1F5] text-xs space-y-1 text-[#6F737D]">
                            <div>
                              Phone:{' '}
                              <span className="text-[#2F3033] font-medium">
                                {outlet.phone || 'N/A'}
                              </span>
                            </div>
                            <div>
                              GSTIN:{' '}
                              <span className="text-[#2F3033] font-mono">
                                {outlet.gstin || 'Unregistered'}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 pt-3 border-t border-[#E5E7EC] flex items-center justify-between gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedOutlet(outlet);
                              setEditOutletForm({
                                name: outlet.name,
                                code: outlet.code,
                                category: outlet.category,
                                address: outlet.address,
                                phone: outlet.phone,
                                gstin: outlet.gstin,
                                receiptHeader: outlet.receiptHeader,
                                receiptFooter: outlet.receiptFooter,
                                supabaseUrl: outlet.supabaseUrl || '',
                                syncWebhookUrl: outlet.syncWebhookUrl || '',
                              });
                              setIsEditOutletOpen(true);
                            }}
                            leftIcon={<Edit2 className="w-3.5 h-3.5" />}
                          >
                            Edit
                          </Button>

                          <Button
                            size="sm"
                            onClick={() => onLaunchOutletPos(outlet.id)}
                            leftIcon={<Play className="w-3.5 h-3.5 fill-current" />}
                          >
                            Launch POS
                          </Button>
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* TAB 2: ADMINS */}
      {activeTab === 'admins' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-[#2F3033]">Registered Outlet Administrators</h3>
            <Button
              size="sm"
              onClick={() => {
                setResetPassFeedback(null);
                setIsAddAdminOpen(true);
              }}
              leftIcon={<Plus className="w-3.5 h-3.5" />}
            >
              Create Administrator
            </Button>
          </div>

          {resetPassFeedback && !isResetPasswordOpen && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-center justify-between gap-2 ${
                resetPassFeedback.startsWith('Error:')
                  ? 'bg-[#FEF2F2] border-[#FECACA] text-[#B91C1C]'
                  : 'bg-[#ECFDF5] border-[#BBF7D0] text-[#15803D]'
              }`}
            >
              <span>{resetPassFeedback}</span>
              <button
                type="button"
                onClick={() => setResetPassFeedback(null)}
                className="underline font-semibold shrink-0 cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          <ResponsiveTable
            rows={adminsList}
            keyExtractor={(admin: any) => String(admin.userId || admin.id)}
            emptyState={
              <EmptyState
                title="No outlet administrators linked yet"
                description='Use "Create Administrator" or map an owner via Shared Auth & Sync.'
              />
            }
            columns={[
              {
                key: 'admin',
                header: 'Admin & Identity',
                render: (admin: any) => (
                  <div className="space-y-0.5">
                    <div className="font-bold text-[#2F3033]">
                      {admin.fullName || 'Unnamed Admin'}
                    </div>
                    <div className="font-mono text-[11px] text-[#2F3033]">
                      {admin.email || 'No email'}
                    </div>
                    {admin.username && (
                      <div className="text-[#6F737D] font-mono text-[10px]">
                        username: {admin.username}
                      </div>
                    )}
                    <div className="text-[#8B909C] font-mono text-[10px]">
                      UUID: {admin.userId || admin.id}
                    </div>
                  </div>
                ),
              },
              {
                key: 'outlet',
                header: 'Assigned Outlet',
                render: (admin: any) =>
                  admin.memberships && admin.memberships.length > 0 ? (
                    <div className="space-y-0.5">
                      {admin.memberships.map((m: any, idx: number) => (
                        <div key={idx} className="text-[#2F3033]">
                          {m.outletName}{' '}
                          <span className="text-[10px] text-[#6F737D] font-mono">
                            ({m.outletCode})
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : admin.outletName || admin.outletCode ? (
                    <div className="text-[#2F3033]">
                      {admin.outletName || admin.outletCode}
                      {admin.outletCode && (
                        <span className="text-[10px] text-[#6F737D] font-mono ml-1">
                          ({admin.outletCode})
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-[#6F737D]">Unassigned</span>
                  ),
              },
              {
                key: 'role',
                header: 'Role',
                render: (admin: any) => {
                  const vr = getVisibleRole(admin.displayRole || admin.role);
                  return (
                    <StatusBadge
                      label={vr}
                      tone={vr === 'SUPERADMIN' ? 'brand' : vr === 'ADMIN' ? 'info' : 'success'}
                    />
                  );
                },
              },
              {
                key: 'status',
                header: 'Status',
                render: (admin: any) => (
                  <div className="space-y-1">
                    <StatusBadge
                      label={admin.isActive ? 'ACTIVE' : 'DISABLED'}
                      tone={admin.isActive ? 'success' : 'danger'}
                    />
                    {admin.mustChangePassword && admin.isActive && (
                      <p className="text-[10px] font-medium text-[#B45309]">Temp Password Active</p>
                    )}
                  </div>
                ),
              },
              {
                key: 'actions',
                header: 'Actions',
                align: 'right',
                render: (admin: any) => (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setSelectedAdmin(admin);
                      setResetPassFeedback(null);
                      setResetTempPassword('');
                      setResetConfirmPassword('');
                      setIsResetPasswordOpen(true);
                    }}
                    leftIcon={<KeyRound className="w-3 h-3" />}
                  >
                    Reset Password
                  </Button>
                ),
              },
            ]}
            renderMobileCard={(admin: any) => {
              const vr = getVisibleRole(admin.displayRole || admin.role);
              return (
                <div className="space-y-2.5 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-[#2F3033] truncate">
                        {admin.fullName || 'Unnamed Admin'}
                      </p>
                      <p className="font-mono text-[11px] text-[#6F737D] truncate">
                        {admin.email || 'No email'}
                      </p>
                      <p className="text-[11px] text-[#6F737D]">
                        {admin.outletName || admin.outletCode || 'Unassigned'}
                      </p>
                    </div>
                    <StatusBadge
                      label={vr}
                      tone={vr === 'SUPERADMIN' ? 'brand' : vr === 'ADMIN' ? 'info' : 'success'}
                    />
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-[#F0F1F5]">
                    <StatusBadge
                      label={admin.isActive ? 'ACTIVE' : 'DISABLED'}
                      tone={admin.isActive ? 'success' : 'danger'}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setSelectedAdmin(admin);
                        setResetPassFeedback(null);
                        setResetTempPassword('');
                        setResetConfirmPassword('');
                        setIsResetPasswordOpen(true);
                      }}
                    >
                      Reset Password
                    </Button>
                  </div>
                </div>
              );
            }}
          />
        </div>
      )}

      {/* TAB 3: REPORTS */}
      {activeTab === 'reports' && reportsSummary && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card padding="md" className="space-y-1">
              <span className="text-xs text-[#6F737D]">Registered Outlets</span>
              <div className="text-2xl font-bold text-[#2F3033] tabular-nums">
                {reportsSummary.summary.totalOutlets}
              </div>
              <span className="text-[11px] font-medium text-[#15803D] tabular-nums">
                {reportsSummary.summary.activeOutlets} Active
              </span>
            </Card>
            <Card padding="md" className="space-y-1">
              <span className="text-xs text-[#6F737D]">Aggregated Network Revenue</span>
              <div className="text-2xl font-bold text-[#2F3033] tabular-nums">
                ₹{reportsSummary.summary.totalRevenue.toLocaleString()}
              </div>
              <span className="text-[11px] text-[#6F737D]">Authorized receipts</span>
            </Card>
            <Card padding="md" className="space-y-1">
              <span className="text-xs text-[#6F737D]">Completed Transactions</span>
              <div className="text-2xl font-bold text-[#2F3033] tabular-nums">
                {reportsSummary.summary.totalTransactions}
              </div>
              <span className="text-[11px] font-medium text-[#1D4ED8]">Bills &amp; Orders Synced</span>
            </Card>
            <Card padding="md" className="space-y-1">
              <span className="text-xs text-[#6F737D]">Paired POS Hardware</span>
              <div className="text-2xl font-bold text-[#2F3033] tabular-nums">
                {reportsSummary.summary.pairedDevicesCount}
              </div>
              <span className="text-[11px] font-medium text-[#B45309]">Tablets &amp; Terminals</span>
            </Card>
          </div>

          <div className="space-y-2.5">
            <h3 className="text-sm font-bold text-[#2F3033]">Outlet Performance Ledger</h3>
            <ResponsiveTable
              rows={reportsSummary.outletsBreakdown}
              keyExtractor={(b: any) => String(b.id)}
              columns={[
                {
                  key: 'name',
                  header: 'Outlet Name',
                  render: (b: any) => <span className="font-bold text-[#2F3033]">{b.name}</span>,
                },
                {
                  key: 'cat',
                  header: 'Category',
                  render: (b: any) => <span className="capitalize text-[#6F737D]">{b.category}</span>,
                },
                {
                  key: 'tx',
                  header: 'Transactions',
                  render: (b: any) => <span className="font-mono tabular-nums">{b.transactionCount}</span>,
                },
                {
                  key: 'rev',
                  header: 'Volume',
                  render: (b: any) => (
                    <span className="font-bold text-[#15803D] tabular-nums">
                      ₹{b.revenue.toLocaleString()}
                    </span>
                  ),
                },
                {
                  key: 'sync',
                  header: 'Sync',
                  render: (b: any) => (
                    <StatusBadge
                      label={b.supabaseConnected ? 'Synchronized' : 'Local Central'}
                      tone={b.supabaseConnected ? 'success' : 'neutral'}
                    />
                  ),
                },
                {
                  key: 'action',
                  header: 'Actions',
                  align: 'right',
                  render: (b: any) => (
                    <Button size="sm" variant="outline" onClick={() => onLaunchOutletPos(b.id)}>
                      Inspect POS
                    </Button>
                  ),
                },
              ]}
              renderMobileCard={(b: any) => (
                <div className="flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0">
                    <p className="font-bold text-[#2F3033] truncate">{b.name}</p>
                    <p className="text-[#6F737D] capitalize">
                      {b.category} · {b.transactionCount} txns
                    </p>
                  </div>
                  <div className="text-right space-y-1 shrink-0">
                    <p className="font-bold text-[#15803D] tabular-nums">
                      ₹{b.revenue.toLocaleString()}
                    </p>
                    <Button size="sm" variant="outline" onClick={() => onLaunchOutletPos(b.id)}>
                      POS
                    </Button>
                  </div>
                </div>
              )}
            />
          </div>
        </div>
      )}

      {/* TAB 4: AUDIT LOGS */}
      {activeTab === 'audit' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-[#2F3033]">
              Central Identity &amp; Access Audit Ledger
            </h3>
            <Button
              size="sm"
              variant="outline"
              onClick={fetchData}
              leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
            >
              Refresh Logs
            </Button>
          </div>

          <ResponsiveTable
            rows={auditLogs}
            keyExtractor={(log) => log.id}
            emptyState={<EmptyState title="No audit logs recorded yet" />}
            columns={[
              {
                key: 'time',
                header: 'Timestamp',
                render: (log) => (
                  <span className="font-mono text-[#6F737D]">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                ),
              },
              {
                key: 'type',
                header: 'Event',
                render: (log) => (
                  <StatusBadge
                    label={log.eventType}
                    tone={
                      log.eventType.includes('FAILED') ||
                      log.eventType.includes('DENIED') ||
                      log.eventType.includes('RATE')
                        ? 'danger'
                        : 'info'
                    }
                  />
                ),
              },
              {
                key: 'actor',
                header: 'Actor Email',
                render: (log) => <span>{log.actorEmail || 'System / Unauth'}</span>,
              },
              {
                key: 'ip',
                header: 'IP Address',
                render: (log) => (
                  <span className="font-mono text-[#6F737D]">{log.ipAddress || '127.0.0.1'}</span>
                ),
              },
              {
                key: 'details',
                header: 'Details',
                render: (log) => (
                  <span className="font-mono text-[11px] text-[#6F737D] block max-w-xs truncate">
                    {JSON.stringify(log.details)}
                  </span>
                ),
              },
            ]}
            renderMobileCard={(log) => (
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <StatusBadge
                    label={log.eventType}
                    tone={
                      log.eventType.includes('FAILED') || log.eventType.includes('DENIED')
                        ? 'danger'
                        : 'info'
                    }
                  />
                  <span className="font-mono text-[11px] text-[#6F737D]">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <p className="text-[#2F3033] font-medium">{log.actorEmail || 'System'}</p>
                <p className="font-mono text-[11px] text-[#6F737D] truncate">
                  {JSON.stringify(log.details)}
                </p>
              </div>
            )}
          />
        </div>
      )}

      {/* TAB 5: SUPABASE & RLS */}
      {activeTab === 'supabase' && (
        <div className="space-y-5">
          <Card padding="lg" className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <StatusBadge label="Central SMAV Supabase Active" tone="success" dot />
              <h2 className="text-base sm:text-lg font-bold text-[#2F3033] pt-1">
                Central Identity, Multi-Tenancy &amp; Database Independence
              </h2>
              <p className="text-xs text-[#6F737D] max-w-2xl leading-relaxed">
                Superadmin authentication routes through Central SMAV Supabase Auth. RLS policies restrict profile queries to{' '}
                <code className="font-mono text-[#2F3033]">auth.uid() = id</code> while Superadmin role authorization is verified server-side.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchData}
              leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
            >
              Refresh RLS Profile
            </Button>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Card padding="lg" className="space-y-3">
              <div className="flex items-center justify-between pb-3 border-b border-[#E5E7EC]">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-[#15803D]" />
                  <h3 className="text-sm font-bold text-[#2F3033]">
                    Authenticated Profile (RLS Bound)
                  </h3>
                </div>
                <StatusBadge label="RLS auth.uid() ENFORCED" tone="success" />
              </div>

              <div className="space-y-2 text-xs">
                {[
                  { label: 'User ID', value: userProfile?.id || session.userId, mono: true },
                  { label: 'Registered Email', value: userProfile?.email || session.email },
                  { label: 'Full Name', value: userProfile?.full_name || session.fullName },
                  {
                    label: 'Platform Role',
                    value: userProfile?.platform_role || 'SUPERADMIN',
                    mono: true,
                  },
                  { label: 'Account Active', value: 'true' },
                ].map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-[#F9FAFC] border border-[#E5E7EC]"
                  >
                    <span className="text-[#6F737D]">{row.label}</span>
                    <span
                      className={`text-[#2F3033] font-semibold truncate max-w-[60%] ${
                        row.mono ? 'font-mono' : ''
                      }`}
                    >
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>
            </Card>

            <Card padding="lg" className="space-y-3">
              <div className="flex items-center justify-between pb-3 border-b border-[#E5E7EC]">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-[#FF1B7A]" />
                  <h3 className="text-sm font-bold text-[#2F3033]">
                    Central Project Infrastructure
                  </h3>
                </div>
                <StatusBadge label="PUBLISHABLE ANON KEY" tone="info" />
              </div>

              <div className="p-3 rounded-xl bg-[#F9FAFC] border border-[#E5E7EC] text-xs space-y-1.5">
                <div className="flex justify-between gap-2 text-[#6F737D]">
                  <span>Project URL</span>
                  <span className="font-mono text-[#2F3033] truncate">
                    {supabaseStatus?.projectUrl || 'Configured via SMAV_SUPABASE_URL'}
                  </span>
                </div>
                <div className="flex justify-between gap-2 text-[#6F737D]">
                  <span>Security Model</span>
                  <span className="text-[#15803D] font-semibold">No service-role keys exposed</span>
                </div>
              </div>

              <div className="space-y-1.5">
                {[
                  'smav_outlets',
                  'smav_profiles',
                  'smav_user_outlet_roles',
                  'smav_devices',
                  'smav_audit_logs',
                ].map((tbl) => (
                  <div
                    key={tbl}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-[#F9FAFC] border border-[#E5E7EC] text-xs"
                  >
                    <span className="font-mono text-[#2F3033]">{tbl}</span>
                    <span className="text-[#15803D] font-semibold inline-flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Active
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* TAB 6: SHARED AUTH & SYNC */}
      {activeTab === 'portal_auth' && (
        <PortalAuthDashboard session={session} onLaunchOutletPos={onLaunchOutletPos} />
      )}

      {/* TAB 7: INTEGRATION DIAGNOSTICS */}
      {activeTab === 'integrations' && (
        <IntegrationDiagnostics session={session} outlets={outlets} />
      )}

      {/* MODAL: ADD OUTLET */}
      {isAddOutletOpen && (
        <div className="fixed inset-0 z-50 bg-[#111827]/45 backdrop-blur-[2px] flex items-center justify-center p-4">
          <Card padding="lg" className="max-w-lg w-full shadow-xl space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-2.5 border-b border-[#E5E7EC]">
              <h3 className="text-base font-bold text-[#2F3033]">Add New Enterprise Outlet</h3>
              <button
                type="button"
                onClick={() => setIsAddOutletOpen(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-[#6F737D] hover:bg-[#F5F6FA] cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateOutlet} className="space-y-3">
              <FormField label="Outlet Name" required>
                <input
                  type="text"
                  value={newOutletForm.name}
                  onChange={(e) => setNewOutletForm({ ...newOutletForm, name: e.target.value })}
                  placeholder="e.g. Starters4U Banjara Hills"
                  required
                  className={BASE_INPUT_CLASS}
                />
              </FormField>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="Outlet Code" required>
                  <input
                    type="text"
                    value={newOutletForm.code}
                    onChange={(e) => setNewOutletForm({ ...newOutletForm, code: e.target.value })}
                    placeholder="e.g. banjara_mozz"
                    required
                    className={`${BASE_INPUT_CLASS} font-mono`}
                  />
                </FormField>
                <FormField label="Category">
                  <select
                    value={newOutletForm.category}
                    onChange={(e) =>
                      setNewOutletForm({ ...newOutletForm, category: e.target.value as any })
                    }
                    className={BASE_INPUT_CLASS}
                  >
                    <option value="restaurant">Restaurant</option>
                    <option value="salon">Salon &amp; Spa</option>
                    <option value="retail">Retail Store</option>
                    <option value="other">Other</option>
                  </select>
                </FormField>
              </div>

              <FormField label="Street Address">
                <input
                  type="text"
                  value={newOutletForm.address}
                  onChange={(e) => setNewOutletForm({ ...newOutletForm, address: e.target.value })}
                  placeholder="Street, locality, city"
                  className={BASE_INPUT_CLASS}
                />
              </FormField>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="Phone">
                  <input
                    type="text"
                    value={newOutletForm.phone}
                    onChange={(e) => setNewOutletForm({ ...newOutletForm, phone: e.target.value })}
                    placeholder="+91 98765 00000"
                    className={BASE_INPUT_CLASS}
                  />
                </FormField>
                <FormField label="GSTIN">
                  <input
                    type="text"
                    value={newOutletForm.gstin}
                    onChange={(e) => setNewOutletForm({ ...newOutletForm, gstin: e.target.value })}
                    placeholder="36AABCU0000Z1Z0"
                    className={`${BASE_INPUT_CLASS} font-mono`}
                  />
                </FormField>
              </div>

              <FormField label="Supabase Project URL (Optional)">
                <input
                  type="text"
                  value={newOutletForm.supabaseUrl}
                  onChange={(e) =>
                    setNewOutletForm({ ...newOutletForm, supabaseUrl: e.target.value })
                  }
                  placeholder="https://xyz.supabase.co"
                  className={`${BASE_INPUT_CLASS} font-mono`}
                />
              </FormField>

              <FormField label="Bidirectional Sync Webhook URL (Optional)">
                <input
                  type="text"
                  value={newOutletForm.syncWebhookUrl}
                  onChange={(e) =>
                    setNewOutletForm({ ...newOutletForm, syncWebhookUrl: e.target.value })
                  }
                  placeholder="https://portal.example.com/api/smav-sync-webhook"
                  className={`${BASE_INPUT_CLASS} font-mono`}
                />
              </FormField>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-[#E5E7EC]">
                <Button variant="outline" size="sm" onClick={() => setIsAddOutletOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" size="sm">
                  Save Outlet
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* MODAL: EDIT OUTLET */}
      {isEditOutletOpen && selectedOutlet && (
        <div className="fixed inset-0 z-50 bg-[#111827]/45 backdrop-blur-[2px] flex items-center justify-center p-4">
          <Card padding="lg" className="max-w-lg w-full shadow-xl space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-2.5 border-b border-[#E5E7EC]">
              <h3 className="text-base font-bold text-[#2F3033]">Edit Outlet Details</h3>
              <button
                type="button"
                onClick={() => setIsEditOutletOpen(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-[#6F737D] hover:bg-[#F5F6FA] cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleUpdateOutlet} className="space-y-3">
              <FormField label="Outlet Name" required>
                <input
                  type="text"
                  value={editOutletForm.name}
                  onChange={(e) => setEditOutletForm({ ...editOutletForm, name: e.target.value })}
                  required
                  className={BASE_INPUT_CLASS}
                />
              </FormField>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="Category">
                  <select
                    value={editOutletForm.category}
                    onChange={(e) =>
                      setEditOutletForm({ ...editOutletForm, category: e.target.value as any })
                    }
                    className={BASE_INPUT_CLASS}
                  >
                    <option value="restaurant">Restaurant</option>
                    <option value="salon">Salon &amp; Spa</option>
                    <option value="retail">Retail Store</option>
                    <option value="other">Other</option>
                  </select>
                </FormField>
                <FormField label="Phone">
                  <input
                    type="text"
                    value={editOutletForm.phone}
                    onChange={(e) =>
                      setEditOutletForm({ ...editOutletForm, phone: e.target.value })
                    }
                    className={BASE_INPUT_CLASS}
                  />
                </FormField>
              </div>

              <FormField label="Address">
                <input
                  type="text"
                  value={editOutletForm.address}
                  onChange={(e) =>
                    setEditOutletForm({ ...editOutletForm, address: e.target.value })
                  }
                  className={BASE_INPUT_CLASS}
                />
              </FormField>

              <FormField label="Bidirectional Sync Webhook URL (Optional)">
                <input
                  type="text"
                  value={editOutletForm.syncWebhookUrl}
                  onChange={(e) =>
                    setEditOutletForm({ ...editOutletForm, syncWebhookUrl: e.target.value })
                  }
                  placeholder="https://portal.example.com/api/smav-sync-webhook"
                  className={`${BASE_INPUT_CLASS} font-mono`}
                />
              </FormField>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-[#E5E7EC]">
                <Button variant="outline" size="sm" onClick={() => setIsEditOutletOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" size="sm">
                  Update Outlet
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* MODAL: ADD ADMIN */}
      {isAddAdminOpen && (
        <div className="fixed inset-0 z-50 bg-[#111827]/45 backdrop-blur-[2px] flex items-center justify-center p-4">
          <Card padding="lg" className="max-w-md w-full shadow-xl space-y-4 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-2.5 border-b border-[#E5E7EC]">
              <h3 className="text-base font-bold text-[#2F3033]">Create Outlet Administrator</h3>
              <button
                type="button"
                onClick={() => setIsAddAdminOpen(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-[#6F737D] hover:bg-[#F5F6FA] cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateAdmin} className="space-y-3">
              <FormField label="Full Name" required>
                <input
                  type="text"
                  value={newAdminForm.fullName}
                  onChange={(e) => setNewAdminForm({ ...newAdminForm, fullName: e.target.value })}
                  placeholder="e.g. Ramesh V"
                  required
                  className={BASE_INPUT_CLASS}
                />
              </FormField>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="Username" required>
                  <input
                    type="text"
                    value={newAdminForm.username}
                    onChange={(e) => setNewAdminForm({ ...newAdminForm, username: e.target.value })}
                    placeholder="ramesh"
                    required
                    className={`${BASE_INPUT_CLASS} font-mono`}
                  />
                </FormField>
                <FormField label="Assign to Outlet" required>
                  <select
                    value={newAdminForm.outletId}
                    onChange={(e) => setNewAdminForm({ ...newAdminForm, outletId: e.target.value })}
                    required
                    className={BASE_INPUT_CLASS}
                  >
                    <option value="">-- Select Outlet --</option>
                    {outlets.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name} ({o.code})
                      </option>
                    ))}
                  </select>
                </FormField>
              </div>

              <FormField label="Admin Email" required>
                <input
                  type="email"
                  value={newAdminForm.email}
                  onChange={(e) => setNewAdminForm({ ...newAdminForm, email: e.target.value })}
                  placeholder="admin@outlet.com"
                  required
                  className={BASE_INPUT_CLASS}
                />
              </FormField>

              <PasswordField
                label="Initial Temporary Password (min. 8 characters)"
                hint="Administrator will be prompted to set a personal password on first sign-in."
                value={newAdminForm.initialPassword}
                onChange={(e) =>
                  setNewAdminForm({ ...newAdminForm, initialPassword: e.target.value })
                }
                minLength={8}
                required
              />

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-[#E5E7EC]">
                <Button variant="outline" size="sm" onClick={() => setIsAddAdminOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" size="sm">
                  Create &amp; Sync Admin
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* MODAL: RESET ADMIN PASSWORD */}
      {isResetPasswordOpen && selectedAdmin && (
        <div className="fixed inset-0 z-50 bg-[#111827]/45 backdrop-blur-[2px] flex items-center justify-center p-4">
          <Card padding="lg" className="max-w-md w-full shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-2.5 border-b border-[#E5E7EC]">
              <h3 className="text-base font-bold text-[#2F3033]">Reset Administrator Password</h3>
              <button
                type="button"
                onClick={() => setIsResetPasswordOpen(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-[#6F737D] hover:bg-[#F5F6FA] cursor-pointer"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-[#6F737D] leading-relaxed">
              Set a temporary password for{' '}
              <span className="font-bold text-[#2F3033]">{selectedAdmin.fullName}</span> (
              {selectedAdmin.email || selectedAdmin.userId || selectedAdmin.id}). They must change it on their next login.
            </p>

            {resetPassFeedback && (
              <div
                className={`p-3 rounded-xl border text-xs ${
                  resetPassFeedback.startsWith('Error:')
                    ? 'bg-[#FEF2F2] border-[#FECACA] text-[#B91C1C]'
                    : 'bg-[#ECFDF5] border-[#BBF7D0] text-[#15803D]'
                }`}
              >
                {resetPassFeedback}
              </div>
            )}

            <form onSubmit={handleResetAdminPassword} className="space-y-3">
              <PasswordField
                label="New Temporary Password (min. 8 characters)"
                value={resetTempPassword}
                onChange={(e) => setResetTempPassword(e.target.value)}
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
                <Button variant="outline" size="sm" onClick={() => setIsResetPasswordOpen(false)}>
                  Close
                </Button>
                <Button type="submit" size="sm">
                  Set Temporary Password
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmDisableOutlet)}
        title="Disable Registered Outlet"
        message={
          confirmDisableOutlet
            ? `Disable ${confirmDisableOutlet.name} (${confirmDisableOutlet.code})? POS terminals and outlet logins for this location will be suspended until re-enabled.`
            : ''
        }
        confirmLabel="Disable Outlet"
        onConfirm={() =>
          confirmDisableOutlet && void executeToggleOutletStatus(confirmDisableOutlet)
        }
        onCancel={() => setConfirmDisableOutlet(null)}
      />
    </div>
  );
};
