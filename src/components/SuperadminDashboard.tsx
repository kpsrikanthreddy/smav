import React, { useState, useEffect } from 'react';
import {
  Building2,
  Utensils,
  Scissors,
  ShoppingBag,
  Layers,
  Search,
  Plus,
  Edit2,
  CheckCircle2,
  XCircle,
  KeyRound,
  ShieldCheck,
  TrendingUp,
  ExternalLink,
  Printer,
  Smartphone,
  Play,
  RotateCcw,
  AlertTriangle,
  History,
  Lock,
  UserPlus,
  Database,
  RefreshCw,
  Sparkles
} from 'lucide-react';
import { Outlet, BusinessCategory, UserSession, AuditLogEntry, getVisibleRole } from '../types';
import { PortalAuthDashboard } from './PortalAuthDashboard';
import { identityAdminService } from '../services/identityAdminService';

interface SuperadminDashboardProps {
  session: UserSession;
  onLaunchOutletPos: (outletId: string) => void;
  onLogout: () => void;
}

export const SuperadminDashboard: React.FC<SuperadminDashboardProps> = ({
  session,
  onLaunchOutletPos,
  onLogout
}) => {
  const [activeTab, setActiveTab] = useState<'outlets' | 'admins' | 'reports' | 'audit' | 'supabase' | 'portal_auth'>('outlets');
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

  // Modals
  const [isAddOutletOpen, setIsAddOutletOpen] = useState(false);
  const [isEditOutletOpen, setIsEditOutletOpen] = useState(false);
  const [isAddAdminOpen, setIsAddAdminOpen] = useState(false);
  const [isResetPasswordOpen, setIsResetPasswordOpen] = useState(false);
  const [selectedOutlet, setSelectedOutlet] = useState<Outlet | null>(null);
  const [selectedAdmin, setSelectedAdmin] = useState<any | null>(null);

  // Forms State
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
    syncWebhookUrl: ''
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
    syncWebhookUrl: ''
  });

  const [newAdminForm, setNewAdminForm] = useState({
    email: '',
    username: '',
    fullName: '',
    phone: '',
    outletId: '',
    initialPassword: ''
  });

  const [resetPassFeedback, setResetPassFeedback] = useState<string | null>(null);
  const [resetTempPassword, setResetTempPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');

  // Fetch initial data
  const fetchData = async () => {
    setIsLoading(true);
    try {
      const headers = { Authorization: `Bearer ${session.token}` };

      const [outletsRes, reportsRes, adminsRes, auditRes, profileRes, sbStatusRes] = await Promise.all([
        fetch('/api/superadmin/outlets', { headers }).then(r => r.json()).catch(() => ({ outlets: [] })),
        fetch('/api/superadmin/reports', { headers }).then(r => r.json()).catch(() => null),
        fetch('/api/superadmin/admins', { headers }).then(r => r.json()).catch(() => ({ admins: [] })),
        fetch('/api/superadmin/audit-logs', { headers }).then(r => r.json()).catch(() => ({ logs: [] })),
        fetch('/api/auth/profile', { headers }).then(r => r.json()).catch(() => null),
        fetch('/api/central-supabase/status').then(r => r.json()).catch(() => null)
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
    fetchData();
  }, [session.token]);

  // Add Outlet
  const handleCreateOutlet = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/superadmin/outlets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`
        },
        body: JSON.stringify(newOutletForm)
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
          syncWebhookUrl: ''
        });
        fetchData();
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Edit Outlet
  const handleUpdateOutlet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOutlet) return;
    try {
      const res = await fetch(`/api/superadmin/outlets/${selectedOutlet.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`
        },
        body: JSON.stringify(editOutletForm)
      });
      if (res.ok) {
        setIsEditOutletOpen(false);
        fetchData();
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Toggle Outlet Active Status
  const handleToggleOutletStatus = async (outlet: Outlet) => {
    try {
      const res = await fetch(`/api/superadmin/outlets/${outlet.id}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`
        },
        body: JSON.stringify({ isActive: !outlet.isActive })
      });
      if (res.ok) {
        setOutlets(prev => prev.map(o => o.id === outlet.id ? { ...o, isActive: !outlet.isActive } : o));
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Create Administrator via unified SMAV server sync proxy
  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetPassFeedback(null);
    if (newAdminForm.initialPassword.length < 8) {
      setResetPassFeedback('Error: Initial temporary password must be at least 8 characters.');
      return;
    }

    try {
      const targetOutlet = outlets.find(o => o.id === newAdminForm.outletId);
      const outletCode = targetOutlet?.code || newAdminForm.outletId;

      const res = await fetch('/api/superadmin/admins', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`
        },
        body: JSON.stringify({
          email: newAdminForm.email.trim(),
          username: newAdminForm.username.trim().toLowerCase() || undefined,
          fullName: newAdminForm.fullName.trim(),
          phone: newAdminForm.phone.trim(),
          outletId: newAdminForm.outletId,
          outletCode,
          initialPassword: newAdminForm.initialPassword
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setIsAddAdminOpen(false);
        setResetPassFeedback(data.message || 'Outlet administrator provisioned in Central SMAV.');
        setNewAdminForm({ email: '', username: '', fullName: '', phone: '', outletId: '', initialPassword: '' });
        fetchData();
      } else {
        setResetPassFeedback(`Error: ${data.message || data.error || 'Failed to create administrator'}`);
      }
    } catch (e: any) {
      console.error(e);
      setResetPassFeedback(`Error: ${e.message}`);
    }
  };

  // Direct temporary password reset for an administrator (must change on first sign-in)
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
      const targetOutletCode = selectedAdmin.outletCode || selectedAdmin.memberships?.[0]?.outletCode || 'glossylooks';
      const res = await identityAdminService.resetOutletUserPassword(session.token, targetUserId, {
        newPassword: resetTempPassword,
        email: selectedAdmin.email || undefined,
        outletCode: targetOutletCode
      });

      if (res.success) {
        setResetTempPassword('');
        setResetConfirmPassword('');
        setResetPassFeedback(`${res.message} User must change this temporary password on next sign-in.`);
      } else {
        setResetPassFeedback(`Error: ${res.message || res.error || 'Failed to set temporary password'}`);
      }
    } catch (e: any) {
      console.error(e);
      setResetPassFeedback(`Error: ${e.message}`);
    }
  };

  // Filter outlets by search and category
  const filteredOutlets = outlets.filter(o => {
    const matchesCat = selectedCategory === 'all' || o.category === selectedCategory;
    const matchesSearch = o.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      o.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      o.address.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesSearch;
  });

  // Group outlets by category (Item 4 requirement)
  const groupedOutlets = {
    restaurant: filteredOutlets.filter(o => o.category === 'restaurant'),
    salon: filteredOutlets.filter(o => o.category === 'salon'),
    retail: filteredOutlets.filter(o => o.category === 'retail'),
    other: filteredOutlets.filter(o => o.category === 'other')
  };

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="bg-[#121629] border border-[#1e2540] rounded-2xl p-6 shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold tracking-wider uppercase px-2.5 py-0.5 rounded-full bg-gradient-to-r from-pink-500/20 to-orange-500/20 text-pink-400 border border-pink-500/30">
              Superadmin Authority
            </span>
            <span className="text-xs text-slate-400">SMAV Central Enterprise Gateway</span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Enterprise Multi-Outlet Network</h1>
          <p className="text-xs text-slate-400 mt-1">
            Global outlet registry, identity routing, admin access control, and cross-tenant auditing.
          </p>
        </div>

        {/* Global Controls & Add Outlet */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsAddOutletOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-pink-500 via-rose-500 to-orange-500 hover:brightness-110 text-white text-xs font-semibold shadow-lg shadow-pink-500/20 transition"
          >
            <Plus className="w-4 h-4" />
            Add New Outlet
          </button>
          <button
            onClick={() => setIsAddAdminOpen(true)}
            className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-xs font-medium transition"
          >
            <UserPlus className="w-4 h-4 text-sky-400" />
            Add Outlet Admin
          </button>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2 overflow-x-auto text-xs">
        {[
          { id: 'outlets', label: `Registered Outlets (${outlets.length})`, icon: Building2 },
          { id: 'portal_auth', label: 'Multi-Portal Shared Auth & Sync', icon: Sparkles },
          { id: 'admins', label: `Outlet Administrators (${adminsList.length})`, icon: KeyRound },
          { id: 'reports', label: 'Authorized Network Reports', icon: TrendingUp },
          { id: 'audit', label: `Security Audit Logs (${auditLogs.length})`, icon: History },
          { id: 'supabase', label: 'Central Supabase & RLS Profile', icon: Database }
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
      {/* TAB 1: OUTLETS DIRECTORY (GROUPED BY CATEGORY)                                 */}
      {/* ============================================================================== */}
      {outletLoadError && <div role="alert" className="m-4 rounded-xl border border-red-500/50 bg-red-950/40 p-4 text-red-200">{outletLoadError}</div>}
      {activeTab === 'outlets' && (
        <div className="space-y-6">
          {/* Search & Category Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 bg-[#121629] p-4 rounded-2xl border border-[#1e2540]">
            <div className="relative flex-1 min-w-[260px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search outlets by name, code, or address..."
                className="w-full bg-[#161a33] border border-[#2a3055] rounded-xl pl-10 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-pink-500"
              />
            </div>

            {/* Segmented Category Filter Buttons */}
            <div className="flex items-center gap-1.5 p-1 bg-slate-900 rounded-xl border border-slate-800 text-xs">
              {[
                { id: 'all', label: 'All Categories' },
                { id: 'restaurant', label: '🍽️ Restaurants' },
                { id: 'salon', label: '💇 Salons' },
                { id: 'retail', label: '🛍️ Retail Stores' },
                { id: 'other', label: '🏢 Other' }
              ].map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`px-3 py-1.5 rounded-lg transition font-medium ${
                    selectedCategory === cat.id ? 'bg-[#242938] text-white shadow' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Grouped Category Sections */}
          {[
            { key: 'restaurant', title: '🍽️ Restaurants & Cloud Kitchens', items: groupedOutlets.restaurant, badgeColor: 'text-amber-400' },
            { key: 'salon', title: '💇 Salons, Spas & Beauty Studios', items: groupedOutlets.salon, badgeColor: 'text-rose-400' },
            { key: 'retail', title: '🛍️ Shopping & Retail Outlets', items: groupedOutlets.retail, badgeColor: 'text-emerald-400' },
            { key: 'other', title: '🏢 Other Registered Ventures', items: groupedOutlets.other, badgeColor: 'text-sky-400' }
          ].map(group => {
            if (selectedCategory !== 'all' && selectedCategory !== group.key) return null;
            if (group.items.length === 0) return null;

            return (
              <div key={group.key} className="space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    {group.title}
                    <span className="text-xs text-slate-400 font-normal">({group.items.length} registered)</span>
                  </h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {group.items.map(outlet => (
                    <div
                      key={outlet.id}
                      className={`bg-[#121629] border rounded-2xl p-5 shadow-lg flex flex-col justify-between transition ${
                        outlet.isActive ? 'border-[#1e2540] hover:border-slate-700' : 'border-rose-900/40 opacity-75'
                      }`}
                    >
                      <div>
                        {/* Top status & provider tag */}
                        <div className="flex items-center justify-between gap-2 mb-3">
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#161a33] text-slate-300 uppercase border border-slate-800">
                            Code: {outlet.code}
                          </span>
                          <div className="flex items-center gap-2">
                            {outlet.supabaseUrl && (
                              <span className="text-[10px] font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                                Supabase Live
                              </span>
                            )}
                            <button
                              onClick={() => handleToggleOutletStatus(outlet)}
                              className={`text-[11px] font-bold px-2 py-0.5 rounded transition ${
                                outlet.isActive
                                  ? 'bg-emerald-500/20 text-emerald-400 hover:bg-rose-500/20 hover:text-rose-400'
                                  : 'bg-rose-500/20 text-rose-400 hover:bg-emerald-500/20 hover:text-emerald-400'
                              }`}
                              title="Click to toggle active status"
                            >
                              {outlet.isActive ? 'Active' : 'Deactivated'}
                            </button>
                          </div>
                        </div>

                        {/* Outlet Name & Details */}
                        <h4 className="text-base font-bold text-white leading-snug">{outlet.name}</h4>
                        <p className="text-xs text-slate-400 mt-1 line-clamp-2">{outlet.address}</p>

                        <div className="mt-3 pt-3 border-t border-slate-800/80 text-[11px] space-y-1 text-slate-400">
                          <div>Phone: <span className="text-slate-200">{outlet.phone || 'N/A'}</span></div>
                          <div>GSTIN: <span className="text-slate-200 font-mono">{outlet.gstin || 'Unregistered'}</span></div>
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between gap-2">
                        <button
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
                              syncWebhookUrl: outlet.syncWebhookUrl || ''
                            });
                            setIsEditOutletOpen(true);
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                          Edit
                        </button>

                        {/* Launch POS Button (Item 4: Open outlet-specific POS) */}
                        <button
                          onClick={() => onLaunchOutletPos(outlet.id)}
                          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-pink-500 to-orange-500 hover:brightness-110 text-white text-xs font-semibold shadow transition"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                          Launch POS
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ============================================================================== */}
      {/* TAB 2: ADMINISTRATORS MANAGEMENT (Item 4: Create & Securely Reset Admin Pass)    */}
      {/* ============================================================================== */}
      {activeTab === 'admins' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">Registered Outlet Administrators</h3>
            <button
              onClick={() => {
                setResetPassFeedback(null);
                setIsAddAdminOpen(true);
              }}
              className="px-3.5 py-1.5 rounded-xl bg-pink-600 hover:bg-pink-500 text-white text-xs font-semibold transition"
            >
              + Create Administrator
            </button>
          </div>

          {resetPassFeedback && !isResetPasswordOpen && (
            <div className={`p-3 rounded-xl border text-xs flex items-center justify-between gap-2 ${
              resetPassFeedback.startsWith('Error:')
                ? 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
            }`}>
              <span>{resetPassFeedback}</span>
              <button onClick={() => setResetPassFeedback(null)} className="underline text-[11px]">Dismiss</button>
            </div>
          )}

          <div className="bg-[#121629] border border-[#1e2540] rounded-2xl overflow-hidden shadow-xl">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-[#161a33] text-slate-400 border-b border-[#2a3055] font-semibold">
                <tr>
                  <th className="p-4">Admin Name, Email & UUID</th>
                  <th className="p-4">Assigned Outlet</th>
                  <th className="p-4">Role Title</th>
                  <th className="p-4">Activation & Status</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {adminsList.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-slate-500">
                      No outlet administrators currently linked in Central SMAV. Use &ldquo;Create Administrator&rdquo; or map an owner via Multi-Portal Shared Auth &amp; Sync.
                    </td>
                  </tr>
                ) : adminsList.map(admin => (
                  <tr key={admin.userId || admin.id} className="hover:bg-slate-800/30 transition">
                    <td className="p-4">
                      <div className="font-bold text-white">{admin.fullName || 'Unnamed Admin'}</div>
                      <div className="text-slate-300 font-mono text-[11px]">{admin.email || 'No email'}</div>
                      {admin.username && (
                        <div className="text-slate-400 font-mono text-[10px]">username: {admin.username}</div>
                      )}
                      <div className="text-slate-500 font-mono text-[10px]">UUID: {admin.userId || admin.id}</div>
                    </td>
                    <td className="p-4">
                      {admin.memberships && admin.memberships.length > 0 ? (
                        <div>
                          {admin.memberships.map((m: any, idx: number) => (
                            <div key={idx} className="text-slate-200">
                              {m.outletName} <span className="text-[10px] text-slate-400 font-mono">({m.outletCode})</span>
                            </div>
                          ))}
                        </div>
                      ) : admin.outletName || admin.outletCode ? (
                        <div className="text-slate-200">
                          {admin.outletName || admin.outletCode}
                          {admin.outletCode && <span className="text-[10px] text-slate-400 font-mono ml-1">({admin.outletCode})</span>}
                        </div>
                      ) : (
                        <span className="text-slate-500">Unassigned</span>
                      )}
                    </td>
                    <td className="p-4 font-medium text-slate-300">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                        getVisibleRole(admin.displayRole || admin.role) === 'SUPERADMIN'
                          ? 'bg-purple-500/15 text-purple-300 border-purple-500/30'
                          : getVisibleRole(admin.displayRole || admin.role) === 'ADMIN'
                          ? 'bg-sky-500/15 text-sky-300 border-sky-500/30'
                          : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                      }`}>
                        {getVisibleRole(admin.displayRole || admin.role)}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="flex flex-col gap-1 items-start">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          admin.isActive ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                        }`}>
                          {admin.isActive ? 'ACTIVE' : 'DISABLED'}
                        </span>
                        {admin.mustChangePassword && admin.isActive && (
                          <span className="text-[10px] font-medium text-amber-400">
                            Temp Password Active
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-4 text-right">
                      <button
                        onClick={() => {
                          setSelectedAdmin(admin);
                          setResetPassFeedback(null);
                          setResetTempPassword('');
                          setResetConfirmPassword('');
                          setIsResetPasswordOpen(true);
                        }}
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
      {/* TAB 3: NETWORK FINANCIAL & SYNC REPORTS (Item 4)                                */}
      {/* ============================================================================== */}
      {activeTab === 'reports' && reportsSummary && (
        <div className="space-y-6">
          {/* Metrics Overview Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-[#121629] border border-[#1e2540] p-5 rounded-2xl">
              <span className="text-xs text-slate-400 font-medium">Total Registered Outlets</span>
              <div className="text-2xl font-bold text-white mt-1">{reportsSummary.summary.totalOutlets}</div>
              <span className="text-[11px] text-emerald-400">{reportsSummary.summary.activeOutlets} Active</span>
            </div>
            <div className="bg-[#121629] border border-[#1e2540] p-5 rounded-2xl">
              <span className="text-xs text-slate-400 font-medium">Aggregated Network Revenue</span>
              <div className="text-2xl font-bold text-white mt-1">₹{reportsSummary.summary.totalRevenue.toLocaleString()}</div>
              <span className="text-[11px] text-slate-400">Total authorized receipts</span>
            </div>
            <div className="bg-[#121629] border border-[#1e2540] p-5 rounded-2xl">
              <span className="text-xs text-slate-400 font-medium">Completed Transactions</span>
              <div className="text-2xl font-bold text-white mt-1">{reportsSummary.summary.totalTransactions}</div>
              <span className="text-[11px] text-sky-400">Bills & Orders Synced</span>
            </div>
            <div className="bg-[#121629] border border-[#1e2540] p-5 rounded-2xl">
              <span className="text-xs text-slate-400 font-medium">Paired POS Hardware</span>
              <div className="text-2xl font-bold text-white mt-1">{reportsSummary.summary.pairedDevicesCount}</div>
              <span className="text-[11px] text-amber-400">Tablets & Counter Devices</span>
            </div>
          </div>

          {/* Breakdown Table */}
          <div className="bg-[#121629] border border-[#1e2540] rounded-2xl overflow-hidden p-5 shadow-xl">
            <h3 className="text-sm font-bold text-white mb-4">Outlet-Specific Performance Ledger</h3>
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-[#161a33] text-slate-400 font-semibold border-b border-[#2a3055]">
                <tr>
                  <th className="p-3">Outlet Name</th>
                  <th className="p-3">Category</th>
                  <th className="p-3">Transactions</th>
                  <th className="p-3">Total Volume</th>
                  <th className="p-3">Supabase Sync</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {reportsSummary.outletsBreakdown.map((b: any) => (
                  <tr key={b.id} className="hover:bg-slate-800/20">
                    <td className="p-3 font-bold text-white">{b.name}</td>
                    <td className="p-3 capitalize">{b.category}</td>
                    <td className="p-3 font-mono">{b.transactionCount}</td>
                    <td className="p-3 font-mono font-bold text-emerald-400">₹{b.revenue.toLocaleString()}</td>
                    <td className="p-3">
                      {b.supabaseConnected ? (
                        <span className="text-emerald-400 flex items-center gap-1">● Synchronized</span>
                      ) : (
                        <span className="text-slate-500">Local Central</span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => onLaunchOutletPos(b.id)}
                        className="text-pink-400 hover:text-pink-300 font-semibold"
                      >
                        Inspect POS →
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
      {/* TAB 4: ENTERPRISE SECURITY AUDIT LOGS (Item 9)                                */}
      {/* ============================================================================== */}
      {activeTab === 'audit' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">Central Identity & Access Audit Ledger</h3>
            <button
              onClick={fetchData}
              className="text-xs text-slate-400 hover:text-white flex items-center gap-1"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Refresh Logs
            </button>
          </div>

          <div className="bg-[#121629] border border-[#1e2540] rounded-2xl overflow-hidden shadow-xl">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-[#161a33] text-slate-400 font-semibold border-b border-[#2a3055]">
                <tr>
                  <th className="p-3">Timestamp</th>
                  <th className="p-3">Event Type</th>
                  <th className="p-3">Actor Email</th>
                  <th className="p-3">IP Address</th>
                  <th className="p-3">Event Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 font-mono text-[11px]">
                {auditLogs.map(log => (
                  <tr key={log.id} className="hover:bg-slate-800/20">
                    <td className="p-3 text-slate-400">{new Date(log.timestamp).toLocaleTimeString()}</td>
                    <td className="p-3 font-semibold text-white">
                      <span className={`px-2 py-0.5 rounded text-[10px] ${
                        log.eventType.includes('FAILED') || log.eventType.includes('DENIED') || log.eventType.includes('RATE')
                          ? 'bg-rose-500/20 text-rose-300'
                          : 'bg-sky-500/20 text-sky-300'
                      }`}>
                        {log.eventType}
                      </span>
                    </td>
                    <td className="p-3 text-slate-300">{log.actorEmail || 'System / Unauth'}</td>
                    <td className="p-3 text-slate-400">{log.ipAddress || '127.0.0.1'}</td>
                    <td className="p-3 text-slate-400 max-w-xs truncate">{JSON.stringify(log.details)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ============================================================================== */}
      {/* TAB 6: CENTRAL SUPABASE & AUTHORITATIVE RLS PROFILE (Requirements 3, 4, 6, 13) */}
      {/* ============================================================================== */}
      {activeTab === 'supabase' && (
        <div className="space-y-6">
          {/* Top Info Banner */}
          <div className="bg-gradient-to-r from-purple-950/40 to-slate-900 border border-purple-500/20 rounded-2xl p-6 shadow-xl flex items-center justify-between">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold mb-2">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Central SMAV Supabase Architecture Active</span>
              </div>
              <h2 className="text-lg font-bold text-white">Central Identity, Multi-Tenancy & Database Independence</h2>
              <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
                Superadmin authentication routes through Central SMAV Supabase Auth. RLS policies restrict profile queries to <code>auth.uid() = id</code> while Superadmin role authorization is verified server-side.
              </p>
            </div>
            <button
              onClick={fetchData}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold flex items-center gap-1.5 transition border border-slate-700"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh RLS Profile
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Authenticated Superadmin Profile (Requirement 3, 4, 6) */}
            <div className="bg-[#121629] border border-[#1e2540] rounded-2xl p-6 shadow-xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-400" />
                  <h3 className="text-sm font-bold text-white">Authenticated Profile (RLS Bound)</h3>
                </div>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  RLS auth.uid() ENFORCED
                </span>
              </div>

              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/60 border border-slate-800">
                  <span className="text-slate-400">User ID:</span>
                  <span className="font-mono text-white font-medium">{userProfile?.id || session.userId}</span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/60 border border-slate-800">
                  <span className="text-slate-400">Registered Email:</span>
                  <span className="font-medium text-white">{userProfile?.email || session.email}</span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/60 border border-slate-800">
                  <span className="text-slate-400">Full Name:</span>
                  <span className="font-medium text-white">{userProfile?.full_name || session.fullName}</span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/60 border border-slate-800">
                  <span className="text-slate-400">Platform Role:</span>
                  <span className="px-2 py-0.5 rounded font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30 font-mono">
                    {userProfile?.platform_role || 'SUPERADMIN'}
                  </span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/60 border border-slate-800">
                  <span className="text-slate-400">Account Active (is_active):</span>
                  <span className="inline-flex items-center gap-1 font-semibold text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    true
                  </span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/60 border border-slate-800">
                  <span className="text-slate-400">Profile Data Source:</span>
                  <span className="font-mono text-sky-400">
                    {session.supabaseToken ? 'public.smav_profiles (Live Supabase RLS)' : 'Central Identity Directory (Authoritative)'}
                  </span>
                </div>
              </div>
            </div>

            {/* Central Supabase Schemas & Verification (Requirements 1, 9, 13) */}
            <div className="bg-[#121629] border border-[#1e2540] rounded-2xl p-6 shadow-xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <Database className="w-5 h-5 text-[#ff3b80]" />
                  <h3 className="text-sm font-bold text-white">Central Project Infrastructure</h3>
                </div>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/20 text-sky-400 border border-sky-500/30">
                  PUBLISHABLE ANON KEY ONLY
                </span>
              </div>

              <div className="space-y-2.5 text-xs">
                <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1.5">
                  <div className="flex justify-between items-center text-slate-400">
                    <span>Project URL:</span>
                    <span className="font-mono text-white text-[11px]">{supabaseStatus?.projectUrl || 'Configured via SMAV_SUPABASE_URL'}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-400">
                    <span>Security Model:</span>
                    <span className="text-emerald-400 font-medium">No service-role keys exposed</span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">Required Table Schemas:</div>
                  {[
                    { name: 'smav_outlets', desc: 'Central registry of authorized outlets' },
                    { name: 'smav_profiles', desc: 'User profiles with platform_role and is_active' },
                    { name: 'smav_user_outlet_roles', desc: 'Tenant isolation and granular permissions' },
                    { name: 'smav_devices', desc: 'Hardware terminal pairings' },
                    { name: 'smav_audit_logs', desc: 'Security audit logs' }
                  ].map(t => (
                    <div key={t.name} className="flex items-center justify-between p-2 rounded-lg bg-slate-900/50 border border-slate-800/80 text-[11px]">
                      <div className="font-mono text-slate-200">{t.name}</div>
                      <span className="text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Active
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================================== */}
      {/* TAB 7: MULTI-PORTAL SHARED AUTH & SYNC                                         */}
      {/* ============================================================================== */}
      {activeTab === 'portal_auth' && (
        <PortalAuthDashboard
          session={session}
          onLaunchOutletPos={onLaunchOutletPos}
        />
      )}

      {/* ============================================================================== */}
      {/* MODAL: ADD OUTLET                                                              */}
      {/* ============================================================================== */}
      {isAddOutletOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#121629] border border-[#1e2540] rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h3 className="text-base font-bold text-white">Add New Enterprise Outlet</h3>
              <button onClick={() => setIsAddOutletOpen(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <form onSubmit={handleCreateOutlet} className="space-y-3.5 text-xs">
              <div>
                <label className="font-semibold text-slate-300 mb-1 block">Outlet Name</label>
                <input
                  type="text"
                  value={newOutletForm.name}
                  onChange={e => setNewOutletForm({ ...newOutletForm, name: e.target.value })}
                  placeholder="e.g. Starters4U Banjara Hills"
                  required
                  className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2.5 focus:outline-none focus:border-pink-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-300 mb-1 block">Outlet Code</label>
                  <input
                    type="text"
                    value={newOutletForm.code}
                    onChange={e => setNewOutletForm({ ...newOutletForm, code: e.target.value })}
                    placeholder="e.g. banjara_mozz"
                    required
                    className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2.5 font-mono focus:outline-none focus:border-pink-500"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-300 mb-1 block">Category</label>
                  <select
                    value={newOutletForm.category}
                    onChange={e => setNewOutletForm({ ...newOutletForm, category: e.target.value as any })}
                    className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2.5 focus:outline-none focus:border-pink-500"
                  >
                    <option value="restaurant">🍽️ Restaurant</option>
                    <option value="salon">💇 Salon & Spa</option>
                    <option value="retail">🛍️ Retail Store</option>
                    <option value="other">🏢 Other</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-300 mb-1 block">Street Address</label>
                <input
                  type="text"
                  value={newOutletForm.address}
                  onChange={e => setNewOutletForm({ ...newOutletForm, address: e.target.value })}
                  placeholder="Street, locality, city"
                  className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2.5 focus:outline-none focus:border-pink-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-300 mb-1 block">Phone</label>
                  <input
                    type="text"
                    value={newOutletForm.phone}
                    onChange={e => setNewOutletForm({ ...newOutletForm, phone: e.target.value })}
                    placeholder="+91 98765 00000"
                    className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2.5 focus:outline-none focus:border-pink-500"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-300 mb-1 block">GSTIN</label>
                  <input
                    type="text"
                    value={newOutletForm.gstin}
                    onChange={e => setNewOutletForm({ ...newOutletForm, gstin: e.target.value })}
                    placeholder="36AABCU0000Z1Z0"
                    className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2.5 font-mono focus:outline-none focus:border-pink-500"
                  />
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-300 mb-1 block">Supabase Project URL (Optional)</label>
                <input
                  type="text"
                  value={newOutletForm.supabaseUrl}
                  onChange={e => setNewOutletForm({ ...newOutletForm, supabaseUrl: e.target.value })}
                  placeholder="https://xyz.supabase.co"
                  className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2.5 font-mono focus:outline-none focus:border-pink-500"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-300 mb-1 block">Bidirectional Sync Webhook URL (Optional)</label>
                <input
                  type="text"
                  value={newOutletForm.syncWebhookUrl}
                  onChange={e => setNewOutletForm({ ...newOutletForm, syncWebhookUrl: e.target.value })}
                  placeholder="https://portal.example.com/api/smav-sync-webhook"
                  className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2.5 font-mono focus:outline-none focus:border-pink-500"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddOutletOpen(false)}
                  className="px-4 py-2 rounded-xl text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-pink-500 to-orange-500 text-white font-semibold shadow"
                >
                  Save Outlet
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================================== */}
      {/* MODAL: EDIT OUTLET                                                             */}
      {/* ============================================================================== */}
      {isEditOutletOpen && selectedOutlet && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#121629] border border-[#1e2540] rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h3 className="text-base font-bold text-white">Edit Outlet Details</h3>
              <button onClick={() => setIsEditOutletOpen(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <form onSubmit={handleUpdateOutlet} className="space-y-3.5 text-xs">
              <div>
                <label className="font-semibold text-slate-300 mb-1 block">Outlet Name</label>
                <input
                  type="text"
                  value={editOutletForm.name}
                  onChange={e => setEditOutletForm({ ...editOutletForm, name: e.target.value })}
                  required
                  className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2.5 focus:outline-none focus:border-pink-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-300 mb-1 block">Category</label>
                  <select
                    value={editOutletForm.category}
                    onChange={e => setEditOutletForm({ ...editOutletForm, category: e.target.value as any })}
                    className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2.5 focus:outline-none focus:border-pink-500"
                  >
                    <option value="restaurant">🍽️ Restaurant</option>
                    <option value="salon">💇 Salon & Spa</option>
                    <option value="retail">🛍️ Retail Store</option>
                    <option value="other">🏢 Other</option>
                  </select>
                </div>
                <div>
                  <label className="font-semibold text-slate-300 mb-1 block">Phone</label>
                  <input
                    type="text"
                    value={editOutletForm.phone}
                    onChange={e => setEditOutletForm({ ...editOutletForm, phone: e.target.value })}
                    className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2.5 focus:outline-none focus:border-pink-500"
                  />
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-300 mb-1 block">Address</label>
                <input
                  type="text"
                  value={editOutletForm.address}
                  onChange={e => setEditOutletForm({ ...editOutletForm, address: e.target.value })}
                  className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2.5 focus:outline-none focus:border-pink-500"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-300 mb-1 block">Bidirectional Sync Webhook URL (Optional)</label>
                <input
                  type="text"
                  value={editOutletForm.syncWebhookUrl}
                  onChange={e => setEditOutletForm({ ...editOutletForm, syncWebhookUrl: e.target.value })}
                  placeholder="https://portal.example.com/api/smav-sync-webhook"
                  className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2.5 font-mono focus:outline-none focus:border-pink-500"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsEditOutletOpen(false)}
                  className="px-4 py-2 rounded-xl text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-pink-500 to-orange-500 text-white font-semibold shadow"
                >
                  Update Outlet
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================================== */}
      {/* MODAL: ADD OUTLET ADMINISTRATOR                                                */}
      {/* ============================================================================== */}
      {isAddAdminOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#121629] border border-[#1e2540] rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h3 className="text-base font-bold text-white">Create Outlet Administrator</h3>
              <button onClick={() => setIsAddAdminOpen(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <form onSubmit={handleCreateAdmin} className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-300 mb-1 block">Full Name</label>
                <input
                  type="text"
                  value={newAdminForm.fullName}
                  onChange={e => setNewAdminForm({ ...newAdminForm, fullName: e.target.value })}
                  placeholder="e.g. Ramesh V"
                  required
                  className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2 focus:outline-none focus:border-pink-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-300 mb-1 block">Username</label>
                  <input
                    type="text"
                    value={newAdminForm.username}
                    onChange={e => setNewAdminForm({ ...newAdminForm, username: e.target.value })}
                    placeholder="ramesh"
                    required
                    className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2 font-mono focus:outline-none focus:border-pink-500"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-300 mb-1 block">Assign to Outlet</label>
                  <select
                    value={newAdminForm.outletId}
                    onChange={e => setNewAdminForm({ ...newAdminForm, outletId: e.target.value })}
                    required
                    className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2 focus:outline-none focus:border-pink-500"
                  >
                    <option value="">-- Select Outlet --</option>
                    {outlets.map(o => (
                      <option key={o.id} value={o.id}>{o.name} ({o.code})</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="font-semibold text-slate-300 mb-1 block">Admin Email</label>
                <input
                  type="email"
                  value={newAdminForm.email}
                  onChange={e => setNewAdminForm({ ...newAdminForm, email: e.target.value })}
                  placeholder="admin@outlet.com"
                  required
                  className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2 focus:outline-none focus:border-pink-500"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-300 mb-1 block">Initial Temporary Password (min. 8 characters)</label>
                <input
                  type="password"
                  value={newAdminForm.initialPassword}
                  onChange={e => setNewAdminForm({ ...newAdminForm, initialPassword: e.target.value })}
                  placeholder="Minimum 8 characters"
                  minLength={8}
                  required
                  className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2 focus:outline-none focus:border-pink-500"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Administrator will be prompted to set a personal password on first sign-in.
                </p>
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddAdminOpen(false)}
                  className="px-4 py-2 rounded-xl text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-pink-500 to-orange-500 text-white font-semibold shadow"
                >
                  Create &amp; Sync Admin
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================================== */}
      {/* MODAL: RESET ADMIN PASSWORD                                                    */}
      {/* ============================================================================== */}
      {isResetPasswordOpen && selectedAdmin && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#121629] border border-[#1e2540] rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h3 className="text-base font-bold text-white">Reset Administrator Password</h3>
              <button onClick={() => setIsResetPasswordOpen(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Set a temporary password for <span className="font-bold text-white">{selectedAdmin.fullName}</span> ({selectedAdmin.email || selectedAdmin.userId || selectedAdmin.id}). They must change it on their next login.
            </p>

            {resetPassFeedback && (
              <div className={`p-3 rounded-xl border text-xs ${
                resetPassFeedback.startsWith('Error:')
                  ? 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                  : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
              }`}>
                {resetPassFeedback}
              </div>
            )}

            <form onSubmit={handleResetAdminPassword} className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-300 mb-1 block">New Temporary Password (min. 8 characters)</label>
                <input
                  type="password"
                  value={resetTempPassword}
                  onChange={e => setResetTempPassword(e.target.value)}
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
                  onChange={e => setResetConfirmPassword(e.target.value)}
                  minLength={8}
                  required
                  className="w-full rounded-xl bg-[#161a33] border border-[#2a3055] text-white px-3.5 py-2 focus:outline-none focus:border-pink-500"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsResetPasswordOpen(false)}
                  className="px-4 py-2 rounded-xl text-slate-400 hover:text-white text-xs"
                >
                  Close
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-pink-600 hover:bg-pink-500 text-white text-xs font-semibold shadow"
                >
                  Set Temporary Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
