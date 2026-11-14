import React, { useState, useEffect } from 'react';
import {
  Printer,
  ShieldCheck,
  Building2,
  Cloud,
  Download,
  LogOut,
  Radio,
  SlidersHorizontal,
  ChevronRight,
  Sparkles,
  Scissors,
  Utensils,
  ShoppingBag
} from 'lucide-react';
import { UserSession, UserOutletMembership, SyncEventItem, getVisibleRole } from './types';
import { LoginScreen } from './components/LoginScreen';
import { OutletSelectionScreen } from './components/OutletSelectionScreen';
import { SuperadminDashboard } from './components/SuperadminDashboard';
import { AdminDashboard } from './components/AdminDashboard';
import { StaffPOS } from './components/StaffPOS';
import { SyncDashboard } from './components/SyncDashboard';

export default function App() {
  // Session is null initially so user lands on the requested login screen
  const [session, setSession] = useState<UserSession | null>(null);
  const [multiBusinessOptions, setMultiBusinessOptions] = useState<UserOutletMembership[] | null>(null);
  const [tempUserId, setTempUserId] = useState<string>('');
  const [tempToken, setTempToken] = useState<string>('');
  const [isSwitchingOutlet, setIsSwitchingOutlet] = useState<boolean>(false);
  const [outletSwitchError, setOutletSwitchError] = useState<string | null>(null);

  // Active top navigation tab
  const [activeTab, setActiveTab] = useState<'primary' | 'pos' | 'sync' | 'whatsapp'>('primary');

  // Terminal hardware simulation states
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [isPrinterConnected, setIsPrinterConnected] = useState<boolean>(true);
  const [paperWidthMm, setPaperWidthMm] = useState<58 | 80>(80);

  // Sync and revision states
  const [serverCatalogRevision, setServerCatalogRevision] = useState<number>(101);
  const [localCatalogRevision, setLocalCatalogRevision] = useState<number>(101);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>('Just now');
  const [isDeltaSyncing, setIsDeltaSyncing] = useState<boolean>(false);
  const [syncEvents, setSyncEvents] = useState<SyncEventItem[]>([
    {
      id: 'evt_init',
      timestamp: new Date().toLocaleTimeString(),
      businessId: 'central_smav',
      revision: 101,
      eventType: 'CONNECTED',
      details: 'Connected to Central SMAV Enterprise Gateway with Tenant Isolation',
      source: 'supabase_realtime'
    }
  ]);

  // Realtime SSE listener when session is active
  useEffect(() => {
    if (!session) return;

    let eventSource: EventSource | null = null;
    try {
      const outletId = session.activeOutlet?.id || 'all';
      eventSource = new EventSource(`/api/realtime/catalog-events?outlet_id=${outletId}`);

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.current_revision || data.revision) {
            const rev = data.current_revision || data.revision;
            setServerCatalogRevision(rev);
            setLocalCatalogRevision(rev);
            setSyncEvents(prev => [
              {
                id: 'evt_' + Math.random().toString(36).substring(2, 9),
                timestamp: new Date().toLocaleTimeString(),
                businessId: outletId,
                revision: rev,
                eventType: 'UPDATE',
                details: `Delta revision #${rev} synchronized for ${session.activeOutlet.name}`,
                source: 'supabase_realtime'
              },
              ...prev.slice(0, 24)
            ]);
          }
        } catch (e) {
          console.error(e);
        }
      };
    } catch (err) {
      console.error('SSE connect error:', err);
    }

    return () => {
      if (eventSource) eventSource.close();
    };
  }, [session?.activeOutlet?.id]);

  // Handle successful login from LoginScreen
  const handleLoginSuccess = (userSession: UserSession, _redirectTo?: string) => {
    setSession(userSession);
    setMultiBusinessOptions(null);
    setTempToken('');
    setTempUserId('');
    setOutletSwitchError(null);

    // Route based on verified role
    if (userSession.role === 'superadmin') {
      setActiveTab('primary'); // Superadmin Dashboard
    } else if (userSession.role === 'admin') {
      setActiveTab('primary'); // Admin Dashboard
    } else {
      setActiveTab('pos'); // POS_BILLING: Billing & printing only
    }
  };

  // Handle multi-outlet detection
  const handleMultiBusinessFound = (outlets: UserOutletMembership[], token: string, userId: string) => {
    setMultiBusinessOptions(outlets);
    setTempToken(token);
    setTempUserId(userId);
  };

  // Handle outlet selection from multi-outlet screen
  const handleSelectOutlet = async (outletId: string, tokenFromScreen?: string) => {
    try {
      const res = await fetch('/api/auth/select-outlet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tempToken: tokenFromScreen || tempToken,
          userId: tempUserId || undefined,
          outletId,
          deviceId: 'SMAV-DEV-MULTI-01'
        })
      });
      const data = await res.json();
      if (data.success && data.session) {
        handleLoginSuccess(data.session, data.redirectTo);
      } else {
        setOutletSwitchError(data.message || 'Failed to select outlet.');
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Switch between assigned outlets when authenticated
  const handleSwitchAssignedOutlet = async (outletId: string) => {
    if (!session || !outletId || outletId === session.activeOutlet.id) return;
    setIsSwitchingOutlet(true);
    setOutletSwitchError(null);
    try {
      const res = await fetch('/api/auth/switch-outlet', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`
        },
        body: JSON.stringify({ outletId })
      });
      const data = await res.json();
      if (res.ok && data.success && data.session) {
        setSession(data.session);
        if (data.session.role === 'staff') {
          setActiveTab('pos');
        } else {
          setActiveTab('primary');
        }
      } else {
        setOutletSwitchError(data.message || 'Unable to switch outlet.');
      }
    } catch (e: any) {
      setOutletSwitchError(e.message || 'Network error switching outlet.');
    } finally {
      setIsSwitchingOutlet(false);
    }
  };

  // Superadmin launches outlet POS context switch
  const handleSuperadminLaunchOutletPos = async (outletId: string) => {
    if (!session) return;
    try {
      const res = await fetch('/api/superadmin/launch-pos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`
        },
        body: JSON.stringify({ outletId })
      });
      const data = await res.json();
      if (data.success && data.session) {
        setSession(data.session);
        setActiveTab('pos');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleLogout = async () => {
    if (session?.token) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.token}` }
        });
      } catch (e) {}
    }
    setSession(null);
    setMultiBusinessOptions(null);
  };

  // 1. If not authenticated and multiple outlets detected, render OutletSelectionScreen
  if (!session && multiBusinessOptions) {
    return (
      <OutletSelectionScreen
        availableOutlets={multiBusinessOptions}
        tempToken={tempToken}
        onSelectOutlet={handleSelectOutlet}
        onLogout={() => {
          setMultiBusinessOptions(null);
          setTempToken('');
          setTempUserId('');
        }}
      />
    );
  }

  // 2. If not authenticated, render LoginScreen (Item 1: Redesigned dark navy login matching screenshot)
  if (!session) {
    return (
      <LoginScreen
        onLoginSuccess={handleLoginSuccess}
        onMultiBusinessFound={handleMultiBusinessFound}
      />
    );
  }

  // 3. Authenticated Application Shell
  return (
    <div className="min-h-screen bg-[#0B0E1B] text-slate-100 flex flex-col font-sans">
      
      {/* Top Header Navigation */}
      <header className="border-b border-slate-800 bg-[#0e1224]/95 backdrop-blur sticky top-0 z-50 px-4 lg:px-8 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          
          {/* Brand & Outlet Context */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-orange-500 flex items-center justify-center shadow-lg shadow-pink-500/20">
              <Printer className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-bold tracking-tight text-white">SMAV Print Agent</h1>
                <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full border ${
                  session.role === 'superadmin'
                    ? 'bg-purple-500/10 text-purple-400 border-purple-500/30'
                    : session.role === 'admin'
                    ? 'bg-sky-500/10 text-sky-400 border-sky-500/30'
                    : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                }`}>
                  {getVisibleRole(session.displayRole || session.role)}
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                  Rev #{localCatalogRevision}
                </span>
              </div>
              <p className="text-xs text-slate-400 truncate max-w-sm sm:max-w-md">
                {session.activeOutlet.name} • <span className="text-slate-300">{session.fullName}</span> ({getVisibleRole(session.displayRole || session.role)})
              </p>
            </div>
          </div>

          {/* Right Header Controls */}
          <div className="flex items-center gap-2 sm:gap-3">
            {session.assignedOutlets && session.assignedOutlets.filter(o => o.outletId !== 'all').length > 1 && (
              <select
                aria-label="Switch assigned outlet"
                value={session.activeOutlet.id}
                disabled={isSwitchingOutlet}
                onChange={(e) => handleSwitchAssignedOutlet(e.target.value)}
                className="bg-[#161a33] border border-[#2a3055] text-slate-200 rounded-xl px-2.5 py-1.5 text-xs focus:outline-none focus:border-pink-500"
              >
                {session.assignedOutlets
                  .filter(o => o.outletId !== 'all')
                  .map(o => (
                    <option key={o.outletId} value={o.outletId}>
                      {o.outletName} ({getVisibleRole(o.displayRole || o.role)})
                    </option>
                  ))}
              </select>
            )}
            <a
              href="/api/download/android-project.zip"
              download="SMAV-Print-Agent-Android.zip"
              className="flex items-center gap-1.5 bg-[#161a33] hover:bg-[#1e2447] border border-[#2a3055] text-white px-3 py-1.5 rounded-xl text-xs font-semibold shadow transition"
              title="Download compiled native Kotlin Android Studio project"
            >
              <Download className="w-3.5 h-3.5 text-pink-400" />
              <span className="hidden md:inline">Download Android App (.ZIP)</span>
              <span className="md:hidden">Android ZIP</span>
            </a>

            <button
              onClick={handleLogout}
              title="Sign Out / Switch Outlet"
              className="flex items-center gap-1.5 text-slate-400 hover:text-rose-400 px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700 text-xs transition"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>

        {/* Dynamic Global Tabs based on Verified Role */}
        <div className="max-w-7xl mx-auto mt-3 flex items-center gap-1 border-t border-slate-800/80 pt-2 overflow-x-auto text-xs">
          
          {/* Primary View Tab */}
          {session.role === 'superadmin' && (
            <button
              onClick={() => setActiveTab('primary')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg font-medium transition ${
                activeTab === 'primary' ? 'bg-slate-800 text-white border border-slate-700 shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Building2 className="w-3.5 h-3.5 text-purple-400" />
              <span>Superadmin Outlets & Admins</span>
            </button>
          )}

          {session.role === 'admin' && (
            <button
              onClick={() => setActiveTab('primary')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg font-medium transition ${
                activeTab === 'primary' ? 'bg-slate-800 text-white border border-slate-700 shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Building2 className="w-3.5 h-3.5 text-sky-400" />
              <span>Outlet Admin Dashboard</span>
            </button>
          )}

          {/* POS Terminal Tab */}
          <button
            onClick={() => setActiveTab('pos')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg font-medium transition ${
              activeTab === 'pos' ? 'bg-slate-800 text-white border border-slate-700 shadow-sm' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {session.activeOutlet.category === 'salon' ? (
              <Scissors className="w-3.5 h-3.5 text-rose-400" />
            ) : session.activeOutlet.category === 'restaurant' ? (
              <Utensils className="w-3.5 h-3.5 text-amber-400" />
            ) : (
              <ShoppingBag className="w-3.5 h-3.5 text-emerald-400" />
            )}
            <span>
              {session.role === 'superadmin' ? `Auditor POS (${session.activeOutlet.name})` : 'Counter POS Terminal'}
            </span>
          </button>

          {/* Realtime Sync Tab (Admin & Superadmin only; POS_BILLING is billing/printing only) */}
          {session.role !== 'staff' && (
            <button
              onClick={() => setActiveTab('sync')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg font-medium transition ${
                activeTab === 'sync' ? 'bg-slate-800 text-white border border-slate-700 shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Radio className="w-3.5 h-3.5 text-emerald-400" />
              <span>Realtime Delta Sync Cursor</span>
            </button>
          )}
        </div>
      </header>

      {outletSwitchError && (
        <div role="alert" className="max-w-7xl mx-auto w-full px-4 lg:px-8 pt-4">
          <div className="rounded-xl border border-rose-500/40 bg-rose-950/40 px-4 py-2.5 text-xs text-rose-200">
            {outletSwitchError}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-4 lg:p-8">
        
        {/* VIEW 1: SUPERADMIN DASHBOARD */}
        {activeTab === 'primary' && session.role === 'superadmin' && (
          <SuperadminDashboard
            session={session}
            onLaunchOutletPos={handleSuperadminLaunchOutletPos}
            onLogout={handleLogout}
          />
        )}

        {/* VIEW 2: OUTLET ADMIN DASHBOARD */}
        {activeTab === 'primary' && session.role === 'admin' && (
          <AdminDashboard
            session={session}
            onOpenPos={() => setActiveTab('pos')}
            onLogout={handleLogout}
          />
        )}

        {/* VIEW 3: STAFF POS */}
        {activeTab === 'pos' && (
          <StaffPOS
            session={session}
            isOnline={isOnline}
            onToggleOnline={() => setIsOnline(!isOnline)}
            isPrinterConnected={isPrinterConnected}
            onTogglePrinter={() => setIsPrinterConnected(!isPrinterConnected)}
            paperWidthMm={paperWidthMm}
            onChangePaperWidth={setPaperWidthMm}
            serverRevision={serverCatalogRevision}
            localRevision={localCatalogRevision}
            onPerformDeltaSync={() => {}}
          />
        )}

        {/* VIEW 4: REALTIME SYNC DASHBOARD (Admin & Superadmin only) */}
        {activeTab === 'sync' && session.role !== 'staff' && (
          <div className="space-y-4">
            <div className="bg-[#121629] border border-[#1e2540] rounded-2xl p-6 shadow-xl space-y-3">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Radio className="w-5 h-5 text-emerald-400" />
                Live Supabase Realtime & Delta Revision Engine
              </h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Monotonically incrementing catalog cursor ensures offline tablets and POS counters only download delta updates since their last cached revision ({localCatalogRevision}).
              </p>
            </div>

            <SyncDashboard
              session={session}
              isOnline={isOnline}
              sseConnected={true}
              localCatalogRevision={localCatalogRevision}
              serverCatalogRevision={serverCatalogRevision}
              cachedCount={session.activeOutlet.category === 'salon' ? 14 : 10}
              offlineQueueCount={0}
              isSyncing={isDeltaSyncing}
              lastSyncTime={lastSyncTime}
              syncEvents={syncEvents}
              onTriggerSync={() => {}}
            />
          </div>
        )}
      </main>
    </div>
  );
}
