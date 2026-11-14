import React, { useState, useEffect } from 'react';
import {
  Users,
  Scissors,
  Utensils,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Sparkles,
  Code2,
  Copy,
  Check
} from 'lucide-react';
import { UserSession, getVisibleRole } from '../types';

interface PortalAuthDashboardProps {
  session: UserSession;
  onLaunchOutletPos: (outletId: string) => void;
}

export const PortalAuthDashboard: React.FC<PortalAuthDashboardProps> = ({
  session,
  onLaunchOutletPos
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'directory' | 'migrations'>('directory');
  const [staffList, setStaffList] = useState<any[]>([]);
  const [isLoadingStaff, setIsLoadingStaff] = useState(false);
  const [copiedMigration, setCopiedMigration] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Fetch Central Staff list
  const fetchStaffList = async () => {
    setIsLoadingStaff(true);
    try {
      const authHeader = session.supabaseToken || session.token;
      const res = await fetch('/api/central-auth/staff/list', {
        headers: { Authorization: `Bearer ${authHeader}` }
      });
      const data = await res.json();
      if (data.success && data.staff) {
        setStaffList(data.staff);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingStaff(false);
    }
  };

  useEffect(() => {
    fetchStaffList();
  }, []);

  // Toggle staff status
  const handleToggleStaffStatus = async (staff: any) => {
    try {
      const authHeader = session.supabaseToken || session.token;
      await fetch('/api/central-auth/staff/status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authHeader}`
        },
        body: JSON.stringify({
          userId: staff.id,
          isActive: !staff.isActive
        })
      });
      fetchStaffList();
    } catch (e) {
      console.error(e);
    }
  };

  // Password reset action
  const handleResetPassword = async (email: string) => {
    setFeedback(null);
    try {
      const authHeader = session.supabaseToken || session.token;
      const res = await fetch('/api/central-auth/staff/reset-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authHeader}`
        },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (res.ok && data.success !== false) {
        setFeedback({ type: 'success', message: data.message || `Password reset initiated for ${email}.` });
      } else {
        setFeedback({ type: 'error', message: data.message || 'Failed to initiate password reset.' });
      }
    } catch (e: any) {
      setFeedback({ type: 'error', message: e.message || 'Failed to initiate password reset.' });
    }
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedMigration(key);
    setTimeout(() => setCopiedMigration(null), 2500);
  };

  return (
    <div className="space-y-6">
      {/* Overview Card */}
      <div className="bg-[#121629] border border-[#1e2540] rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-full bg-pink-500/10 text-pink-400 border border-pink-500/30">
                Shared Enterprise Authentication
              </span>
              <span className="text-xs text-slate-400">Single Central Provider</span>
            </div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-pink-400" />
              SMAV Central Auth Gateway & Multi-Portal Bridge
            </h2>
            <p className="text-xs text-slate-400 mt-1 max-w-3xl leading-relaxed">
              Central SMAV Supabase Auth operates as the authoritative identity provider for SMAV Print Agent,
              The Glossy Looks Admin Portal (<code className="text-pink-300">glossylooks.in</code>), and MOZZ / Starters4U Admin Portal (<code className="text-orange-300">starters4u.in</code>).
              Each portal maintains its own operational database while federating user IDs and verified outlet roles here.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchStaffList}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200 transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingStaff ? 'animate-spin' : ''}`} />
              Refresh Staff Directory
            </button>
          </div>
        </div>

        {/* 3 Portal Architecture Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
          {/* Card 1: Central SMAV */}
          <div className="p-4 rounded-xl bg-gradient-to-br from-[#161a33] to-[#121629] border border-pink-500/30 space-y-2">
            <div className="flex items-center justify-between">
              <div className="w-8 h-8 rounded-lg bg-pink-500/20 text-pink-400 flex items-center justify-center font-bold">
                1
              </div>
              <span className="text-[10px] uppercase font-bold text-pink-400 tracking-wider">Authoritative Identity</span>
            </div>
            <h3 className="text-sm font-bold text-white">Central SMAV Auth Gateway</h3>
            <p className="text-[11px] text-slate-400">
              Stores authoritative <code className="text-pink-300">auth.users</code>, <code className="text-pink-300">smav_profiles</code>, and <code className="text-pink-300">smav_user_outlet_roles</code>.
            </p>
            <div className="text-[10px] text-slate-400 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              Strict tenant boundary & RLS enabled
            </div>
          </div>

          {/* Card 2: Glossy Looks */}
          <div className="p-4 rounded-xl bg-gradient-to-br from-[#161a33] to-[#121629] border border-rose-500/20 space-y-2">
            <div className="flex items-center justify-between">
              <div className="w-8 h-8 rounded-lg bg-rose-500/20 text-rose-400 flex items-center justify-center font-bold">
                2
              </div>
              <span className="text-[10px] uppercase font-bold text-rose-400 tracking-wider">Salon Portal</span>
            </div>
            <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
              <Scissors className="w-3.5 h-3.5 text-rose-400" />
              The Glossy Looks
            </h3>
            <p className="text-[11px] text-slate-400">
              Supabase database: <code className="text-rose-300">onswigwiwuvkvoduuhxr</code>.
              Staff records link to Central Auth ID; salon operational data stays untouched.
            </p>
            <div className="text-[10px] text-slate-400 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              Locked strictly to Salon POS (/pos)
            </div>
          </div>

          {/* Card 3: MOZZ / Starters4U */}
          <div className="p-4 rounded-xl bg-gradient-to-br from-[#161a33] to-[#121629] border border-amber-500/20 space-y-2">
            <div className="flex items-center justify-between">
              <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold">
                3
              </div>
              <span className="text-[10px] uppercase font-bold text-amber-400 tracking-wider">Restaurant Portal</span>
            </div>
            <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
              <Utensils className="w-3.5 h-3.5 text-amber-400" />
              MOZZ / Starters4U
            </h3>
            <p className="text-[11px] text-slate-400">
              Supabase database: <code className="text-amber-300">uyqdnqbadfysnbzbncyj</code>.
              Staff records link to Central Auth ID; menu, tables, and KOT stay untouched.
            </p>
            <div className="text-[10px] text-slate-400 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              Locked strictly to Restaurant POS (/pos)
            </div>
          </div>
        </div>
      </div>

      {feedback && (
        <div
          role="alert"
          className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
            feedback.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
              : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
          }`}
        >
          {feedback.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Sub-Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2 text-xs">
        {[
          { id: 'directory', label: `Federated Central Staff Directory (${staffList.length})`, icon: Users },
          { id: 'migrations', label: 'SQL Migrations & Adapters', icon: Code2 }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id as any)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl font-medium transition whitespace-nowrap ${
              activeSubTab === tab.id
                ? 'bg-slate-800 text-white border border-slate-700 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <tab.icon className="w-3.5 h-3.5 text-pink-400" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* SUB-TAB 1: FEDERATED STAFF DIRECTORY */}
      {activeSubTab === 'directory' && (
        <div className="bg-[#121629] border border-[#1e2540] rounded-2xl p-6 shadow-xl space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-white">Central Federated Staff Directory</h3>
              <p className="text-xs text-slate-400">
                Staff members provisioned or linked across all outlets. Authoritative state resides in Central SMAV Auth.
              </p>
            </div>
            <span className="text-xs font-mono text-slate-400 bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-800">
              Total Central Staff: {staffList.length}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900/80 text-slate-400 border-b border-slate-800 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="py-3 px-4">Staff Member</th>
                  <th className="py-3 px-4">Central Role</th>
                  <th className="py-3 px-4">Authorized Outlets & POS Access</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {staffList.map((st: any) => (
                  <tr key={st.id} className="hover:bg-slate-800/30 transition">
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-white">{st.fullName || st.email}</div>
                      <div className="font-mono text-[11px] text-slate-400">{st.email}</div>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        getVisibleRole(st.displayRole || st.role) === 'ADMIN'
                          ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                          : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      }`}>
                        {getVisibleRole(st.displayRole || st.role)}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex flex-wrap gap-1.5">
                        {st.outlets?.map((o: any) => (
                          <span
                            key={o.outletId}
                            className={`px-2 py-0.5 rounded-md text-[10px] font-medium border flex items-center gap-1 ${
                              o.category === 'salon'
                                ? 'bg-rose-500/10 text-rose-300 border-rose-500/30'
                                : o.category === 'restaurant'
                                ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                                : 'bg-slate-800 text-slate-300 border-slate-700'
                            }`}
                          >
                            {o.category === 'salon' ? <Scissors className="w-2.5 h-2.5" /> : <Utensils className="w-2.5 h-2.5" />}
                            {o.outletName}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${
                        st.isActive ? 'text-emerald-400' : 'text-slate-500'
                      }`}>
                        {st.isActive ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                        {st.isActive ? 'Active' : 'Deactivated'}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right space-x-2">
                      {st.outlets && st.outlets.length > 0 && (
                        <button
                          onClick={() => onLaunchOutletPos(st.outlets[0].outletId)}
                          className="px-2.5 py-1 rounded-lg bg-gradient-to-r from-pink-500 to-orange-500 text-white font-semibold text-[11px] shadow transition hover:brightness-110"
                          title="Open assigned POS to verify category isolation"
                        >
                          Launch POS
                        </button>
                      )}
                      <button
                        onClick={() => handleResetPassword(st.email)}
                        className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-[11px] transition"
                        title="Initiate secure password reset"
                      >
                        Reset Password
                      </button>
                      <button
                        onClick={() => handleToggleStaffStatus(st)}
                        className={`px-2 py-1 rounded-lg text-[11px] transition ${
                          st.isActive ? 'text-rose-400 hover:bg-rose-500/10' : 'text-emerald-400 hover:bg-emerald-500/10'
                        }`}
                      >
                        {st.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: SQL MIGRATIONS & ADAPTERS */}
      {activeSubTab === 'migrations' && (
        <div className="bg-[#121629] border border-[#1e2540] rounded-2xl p-6 shadow-xl space-y-6">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Code2 className="w-5 h-5 text-pink-400" />
              SQL Migrations & Portal Integration Adapters
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Active SQL migrations and TypeScript adapters for each respective project database.
              Operational data and tables remain 100% intact.
            </p>
          </div>

          <div className="space-y-4 text-xs">
            {/* Migration 1 */}
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-bold text-white">1. Central SMAV Supabase Project RLS Migration (Phase 1)</div>
                  <div className="text-[11px] text-slate-400 font-mono">database/migrations/011_phase1_central_login_roles_rls.sql</div>
                </div>
                <button
                  onClick={() => copyToClipboard(`database/migrations/011_phase1_central_login_roles_rls.sql`, 'm1')}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] flex items-center gap-1.5"
                >
                  {copiedMigration === 'm1' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  {copiedMigration === 'm1' ? 'Copied' : 'Copy Path'}
                </button>
              </div>
              <p className="text-[11px] text-slate-400">
                Configures non-recursive <code className="text-pink-300">SECURITY DEFINER</code> RLS helpers, <code className="text-pink-300">STAFF</code>-only management by outlet <code className="text-pink-300">ADMIN</code>s, trusted audit writes, and <code className="text-pink-300">smav_external_identities</code> access.
              </p>
            </div>

            {/* Migration 2 */}
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-bold text-rose-300">2. The Glossy Looks Database Migration (onswigwiwuvkvoduuhxr)</div>
                  <div className="text-[11px] text-slate-400 font-mono">database/migrations/glossylooks_central_auth_link.sql</div>
                </div>
                <button
                  onClick={() => copyToClipboard(`ALTER TABLE public.staff ADD COLUMN IF NOT EXISTS central_auth_id UUID;`, 'm2')}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] flex items-center gap-1.5"
                >
                  {copiedMigration === 'm2' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  {copiedMigration === 'm2' ? 'Copied' : 'Copy SQL'}
                </button>
              </div>
              <p className="text-[11px] text-slate-400">
                Adds <code className="text-rose-300">central_auth_id</code> to <code className="text-white">public.staff</code>. All salon tables (services, categories, appointments) remain completely untouched.
              </p>
            </div>

            {/* Migration 3 */}
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-bold text-amber-300">3. MOZZ / Starters4U Database Migration (uyqdnqbadfysnbzbncyj)</div>
                  <div className="text-[11px] text-slate-400 font-mono">database/migrations/mozz_central_auth_link.sql</div>
                </div>
                <button
                  onClick={() => copyToClipboard(`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS central_auth_id UUID;`, 'm3')}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] flex items-center gap-1.5"
                >
                  {copiedMigration === 'm3' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  {copiedMigration === 'm3' ? 'Copied' : 'Copy SQL'}
                </button>
              </div>
              <p className="text-[11px] text-slate-400">
                Adds <code className="text-amber-300">central_auth_id</code> to restaurant staff/users. All restaurant tables (menu_items, orders, tables) remain completely untouched.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
