import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  Radio,
  Scissors,
  ShoppingBag,
  SlidersHorizontal,
  Utensils,
} from 'lucide-react';
import {
  OutletBranchOption,
  SyncEventItem,
  UserOutletMembership,
  UserSession,
  getVisibleRole,
} from './types';
import { LoginScreen } from './components/LoginScreen';
import { AppShell, AppShellTab, Card, LoadingState } from './components/ui';
import {
  WebWorkspaceTab,
  defaultTabForRole,
  restoreWebSession,
  revalidateActiveWebSession,
  sanitizeTabForRole,
  saveWorkspaceSnapshot,
  signOutWebSession,
} from './lib/sessionPersistence';

const OutletSelectionScreen = lazy(() =>
  import('./components/OutletSelectionScreen').then((m) => ({ default: m.OutletSelectionScreen }))
);
const SuperadminDashboard = lazy(() =>
  import('./components/SuperadminDashboard').then((m) => ({ default: m.SuperadminDashboard }))
);
const AdminDashboard = lazy(() =>
  import('./components/AdminDashboard').then((m) => ({ default: m.AdminDashboard }))
);
const StaffPOS = lazy(() =>
  import('./components/StaffPOS').then((m) => ({ default: m.StaffPOS }))
);
const SyncDashboard = lazy(() =>
  import('./components/SyncDashboard').then((m) => ({ default: m.SyncDashboard }))
);
const CatalogSyncDiagnostics = lazy(() =>
  import('./components/CatalogSyncDiagnostics').then((m) => ({ default: m.CatalogSyncDiagnostics }))
);

export default function App() {
  const [session, setSession] = useState<UserSession | null>(null);
  const [isRestoringSession, setIsRestoringSession] = useState<boolean>(true);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [offlineBannerMessage, setOfflineBannerMessage] = useState<string | null>(null);
  const [isRetryingSession, setIsRetryingSession] = useState<boolean>(false);

  const [multiBusinessOptions, setMultiBusinessOptions] = useState<UserOutletMembership[] | null>(null);
  const [tempUserId, setTempUserId] = useState<string>('');
  const [tempToken, setTempToken] = useState<string>('');
  const [isSwitchingOutlet, setIsSwitchingOutlet] = useState<boolean>(false);
  const [outletSwitchError, setOutletSwitchError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<WebWorkspaceTab>('primary');
  const [permittedBranchesByOutlet, setPermittedBranchesByOutlet] = useState<
    Record<string, OutletBranchOption[]>
  >({});
  const [selectedBranchByOutlet, setSelectedBranchByOutlet] = useState<Record<string, string>>({});

  const lastRevalidationAtRef = useRef<number>(0);

  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine !== false : true
  );
  const [isPrinterConnected, setIsPrinterConnected] = useState<boolean>(true);
  const [paperWidthMm, setPaperWidthMm] = useState<58 | 80>(() => {
    try {
      const stored = window.localStorage.getItem('smav_paper_width_mm');
      return stored === '58' ? 58 : 80;
    } catch {
      return 80;
    }
  });
  const [cartSummary, setCartSummary] = useState<{ itemCount: number; grandTotal: number }>({
    itemCount: 0,
    grandTotal: 0,
  });
  const [openCartSignal, setOpenCartSignal] = useState<number>(0);

  // Persist non-sensitive workspace metadata (identity, visible role, outlet, branches, active tab — NEVER tokens)
  useEffect(() => {
    if (!session) return;
    saveWorkspaceSnapshot({
      session,
      activeTab,
      permittedBranchesByOutlet,
      selectedBranchByOutlet,
    });
  }, [session, activeTab, permittedBranchesByOutlet, selectedBranchByOutlet]);

  // Restore session on startup / browser refresh (shows loading UI; never a blank screen)
  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      setIsRestoringSession(true);
      const restored = await restoreWebSession();
      if (cancelled) return;

      if (restored.status === 'authenticated') {
        setSession(restored.session);
        setActiveTab(restored.activeTab);
        setPermittedBranchesByOutlet(restored.permittedBranchesByOutlet);
        setSelectedBranchByOutlet(restored.selectedBranchByOutlet);
        setOfflineBannerMessage(null);
        setSessionNotice(null);
        setIsOnline(true);
        lastRevalidationAtRef.current = Date.now();
      } else if (restored.status === 'offline_retained') {
        setSession(restored.session);
        setActiveTab(restored.activeTab);
        setPermittedBranchesByOutlet(restored.permittedBranchesByOutlet);
        setSelectedBranchByOutlet(restored.selectedBranchByOutlet);
        setOfflineBannerMessage(restored.offlineMessage);
        setIsOnline(false);
      } else {
        setSession(null);
        setOfflineBannerMessage(null);
        if (restored.message) {
          setSessionNotice(restored.message);
        }
      }
      setIsRestoringSession(false);
    };
    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRetrySessionConnection = useCallback(async () => {
    if (!session) return;
    setIsRetryingSession(true);
    try {
      const result = await revalidateActiveWebSession(session, {
        activeTab,
        permittedBranchesByOutlet,
        selectedBranchByOutlet,
      });
      lastRevalidationAtRef.current = Date.now();

      if (result.status === 'valid') {
        setSession(result.session);
        setOfflineBannerMessage(null);
        setIsOnline(true);
        if (Array.isArray(result.permittedBranches)) {
          const outletId = result.session.activeOutlet.id;
          setPermittedBranchesByOutlet((prev) => ({
            ...prev,
            [outletId]: result.permittedBranches!,
          }));
        }
      } else if (result.status === 'offline_retained') {
        // Retain valid session; keep offline/retry banner visible
        setOfflineBannerMessage(result.offlineMessage);
        setIsOnline(false);
      } else if (result.status === 'invalidated') {
        // Clear ONLY on confirmed expired/revoked/disabled session
        setSession(null);
        setMultiBusinessOptions(null);
        setOfflineBannerMessage(null);
        setSessionNotice(result.message);
      }
    } finally {
      setIsRetryingSession(false);
    }
  }, [session, activeTab, permittedBranchesByOutlet, selectedBranchByOutlet]);

  // Listen for browser online/offline transitions & tab visibility to silently keep Supabase session fresh
  useEffect(() => {
    const onOffline = () => {
      setIsOnline(false);
      if (session) {
        setOfflineBannerMessage(
          'You appear to be offline. Your session is retained — reconnect and click Retry to sync.'
        );
      }
    };
    const onOnline = () => {
      setIsOnline(true);
      if (session) {
        void handleRetrySessionConnection();
      }
    };
    const onVisibility = () => {
      if (
        document.visibilityState === 'visible' &&
        session &&
        Date.now() - lastRevalidationAtRef.current > 60 * 1000
      ) {
        void handleRetrySessionConnection();
      }
    };

    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [session, handleRetrySessionConnection]);

  const handleChangePaperWidth = (width: 58 | 80) => {
    setPaperWidthMm(width);
    try {
      window.localStorage.setItem('smav_paper_width_mm', String(width));
    } catch {
      // Ignore storage restrictions
    }
  };

  const handleOpenSelectedCart = () => {
    setActiveTab('pos');
    setOpenCartSignal((prev) => prev + 1);
  };

  const handlePermittedBranchesChange = useCallback(
    (outletId: string, branches: OutletBranchOption[]) => {
      if (!outletId) return;
      setPermittedBranchesByOutlet((prev) => {
        const existing = prev[outletId];
        if (
          existing &&
          existing.length === branches.length &&
          existing.every((b, idx) => b.id === branches[idx]?.id && b.branchCode === branches[idx]?.branchCode)
        ) {
          return prev;
        }
        return { ...prev, [outletId]: branches };
      });
    },
    []
  );

  const handleSelectedBranchChange = useCallback((outletId: string, branchId: string) => {
    if (!outletId) return;
    setSelectedBranchByOutlet((prev) => {
      if ((prev[outletId] || '') === branchId) return prev;
      return { ...prev, [outletId]: branchId };
    });
  }, []);

  const [serverCatalogRevision, setServerCatalogRevision] = useState<number>(101);
  const [localCatalogRevision, setLocalCatalogRevision] = useState<number>(101);
  const [syncEvents, setSyncEvents] = useState<SyncEventItem[]>([
    {
      id: 'evt_init',
      timestamp: new Date().toLocaleTimeString(),
      businessId: 'central_smav',
      revision: 101,
      eventType: 'CONNECTED',
      details: 'Connected to Central SMAV Enterprise Gateway with Tenant Isolation',
      source: 'supabase_realtime',
    },
  ]);

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
            setSyncEvents((prev) => [
              {
                id: 'evt_' + Math.random().toString(36).substring(2, 9),
                timestamp: new Date().toLocaleTimeString(),
                businessId: outletId,
                revision: rev,
                eventType: 'UPDATE',
                details: `Delta revision #${rev} synchronized for ${session.activeOutlet.name}`,
                source: 'supabase_realtime',
              },
              ...prev.slice(0, 24),
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

  const handleLoginSuccess = (userSession: UserSession, _redirectTo?: string) => {
    const nextTab = defaultTabForRole(userSession.role);
    setSession(userSession);
    setMultiBusinessOptions(null);
    setTempToken('');
    setTempUserId('');
    setOutletSwitchError(null);
    setSessionNotice(null);
    setOfflineBannerMessage(null);
    setIsOnline(true);
    setActiveTab(nextTab);
    lastRevalidationAtRef.current = Date.now();
    saveWorkspaceSnapshot({
      session: userSession,
      activeTab: nextTab,
      permittedBranchesByOutlet,
      selectedBranchByOutlet,
      lastValidatedAt: Date.now(),
    });
  };

  const handleMultiBusinessFound = (outlets: UserOutletMembership[], token: string, userId: string) => {
    setMultiBusinessOptions(outlets);
    setTempToken(token);
    setTempUserId(userId);
  };

  const handleSelectOutlet = async (outletId: string, tokenFromScreen?: string) => {
    try {
      const res = await fetch('/api/auth/select-outlet', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'SMAV-Web',
        },
        body: JSON.stringify({
          tempToken: tokenFromScreen || tempToken,
          userId: tempUserId || undefined,
          outletId,
          deviceId: 'SMAV-DEV-MULTI-01',
        }),
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

  const handleSwitchAssignedOutlet = async (outletId: string) => {
    if (!session || !outletId || outletId === session.activeOutlet.id) return;
    setIsSwitchingOutlet(true);
    setOutletSwitchError(null);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Requested-With': 'SMAV-Web',
      };
      if (session.token) {
        headers.Authorization = `Bearer ${session.token}`;
      }
      const res = await fetch('/api/auth/switch-outlet', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({ outletId }),
      });
      const data = await res.json();
      if (res.ok && data.success && data.session) {
        const nextTab = sanitizeTabForRole(
          data.session.role === 'staff' ? 'pos' : 'primary',
          data.session.role
        );
        setSession(data.session);
        setActiveTab(nextTab);
        setOfflineBannerMessage(null);
      } else {
        setOutletSwitchError(data.message || 'Unable to switch outlet.');
      }
    } catch (e: any) {
      setOutletSwitchError(e.message || 'Network error switching outlet.');
    } finally {
      setIsSwitchingOutlet(false);
    }
  };

  const handleSuperadminLaunchOutletPos = async (outletId: string) => {
    if (!session) return;
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Requested-With': 'SMAV-Web',
      };
      if (session.token) {
        headers.Authorization = `Bearer ${session.token}`;
      }
      const res = await fetch('/api/superadmin/launch-pos', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({ outletId }),
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
    await signOutWebSession(session);
    setSession(null);
    setMultiBusinessOptions(null);
    setPermittedBranchesByOutlet({});
    setSelectedBranchByOutlet({});
    setOfflineBannerMessage(null);
    setOutletSwitchError(null);
    setSessionNotice(null);
  };

  const tabs: AppShellTab[] = useMemo(() => {
    if (!session) return [];
    const list: AppShellTab[] = [];

    if (session.role === 'superadmin') {
      list.push({
        id: 'primary',
        label: 'Outlets & Admins',
        icon: <Building2 className="w-3.5 h-3.5" />,
      });
      list.push({
        id: 'diagnostics',
        label: 'Catalog Diagnostics',
        icon: <SlidersHorizontal className="w-3.5 h-3.5" />,
      });
    } else if (session.role === 'admin') {
      list.push({
        id: 'primary',
        label: 'Outlet Dashboard',
        icon: <Building2 className="w-3.5 h-3.5" />,
      });
    }

    const posIcon =
      session.activeOutlet.category === 'salon' ? (
        <Scissors className="w-3.5 h-3.5" />
      ) : session.activeOutlet.category === 'restaurant' ? (
        <Utensils className="w-3.5 h-3.5" />
      ) : (
        <ShoppingBag className="w-3.5 h-3.5" />
      );

    list.push({
      id: 'pos',
      label:
        session.role === 'superadmin'
          ? `Auditor POS (${session.activeOutlet.name})`
          : 'Counter POS',
      icon: posIcon,
    });

    if (session.role !== 'staff') {
      list.push({
        id: 'sync',
        label: 'Realtime Sync',
        icon: <Radio className="w-3.5 h-3.5" />,
      });
    }

    return list;
  }, [session]);

  // Never show a blank screen while restoring a persisted session
  if (isRestoringSession) {
    return (
      <div className="min-h-screen bg-[#F5F6FA] flex items-center justify-center p-4">
        <Card padding="lg" className="w-full max-w-sm">
          <LoadingState
            title="Restoring your SMAV session…"
            subtitle="Verifying outlet access, role, and permitted branches."
          />
        </Card>
      </div>
    );
  }

  if (!session && multiBusinessOptions) {
    return (
      <Suspense
        fallback={
          <div className="min-h-screen bg-[#F5F6FA] flex items-center justify-center p-4">
            <LoadingState title="Loading outlets…" />
          </div>
        }
      >
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
      </Suspense>
    );
  }

  if (!session) {
    return (
      <LoginScreen
        onLoginSuccess={handleLoginSuccess}
        onMultiBusinessFound={handleMultiBusinessFound}
        noticeMessage={sessionNotice}
      />
    );
  }

  const visibleRole = getVisibleRole(session.displayRole || session.role);
  const roleTone =
    session.role === 'superadmin'
      ? 'brand'
      : session.role === 'admin'
        ? 'info'
        : 'success';

  const outletOptions =
    session.assignedOutlets
      ?.filter((o) => o.outletId !== 'all')
      .map((o) => ({
        id: o.outletId,
        label: `${o.outletName} (${getVisibleRole(o.displayRole || o.role)})`,
      })) || [];

  const activeOutletId = session.activeOutlet.id;

  return (
    <AppShell
      roleLabel={visibleRole}
      roleTone={roleTone}
      revision={localCatalogRevision}
      outletName={session.activeOutlet.name}
      userFullName={session.fullName}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={(id) => setActiveTab(sanitizeTabForRole(id, session.role))}
      outletOptions={outletOptions}
      selectedOutletId={activeOutletId}
      onOutletChange={handleSwitchAssignedOutlet}
      isSwitchingOutlet={isSwitchingOutlet}
      onLogout={handleLogout}
      cartItemCount={cartSummary.itemCount}
      cartTotalAmount={cartSummary.grandTotal}
      onOpenSelectedCart={handleOpenSelectedCart}
      bannerError={outletSwitchError}
      offlineBanner={
        offlineBannerMessage
          ? {
              message: offlineBannerMessage,
              isRetrying: isRetryingSession,
              onRetry: () => {
                void handleRetrySessionConnection();
              },
            }
          : null
      }
    >
      <Suspense fallback={<LoadingState title="Loading workspace…" />}>
        {activeTab === 'diagnostics' && session.role === 'superadmin' && (
          <CatalogSyncDiagnostics session={session} />
        )}

        {activeTab === 'primary' && session.role === 'superadmin' && (
          <SuperadminDashboard
            session={session}
            onLaunchOutletPos={handleSuperadminLaunchOutletPos}
            onLogout={handleLogout}
          />
        )}

        {activeTab === 'primary' && session.role === 'admin' && (
          <AdminDashboard
            session={session}
            onOpenPos={() => setActiveTab('pos')}
            onLogout={handleLogout}
            paperWidthMm={paperWidthMm}
            onChangePaperWidth={handleChangePaperWidth}
          />
        )}

        {activeTab === 'pos' && (
          <StaffPOS
            session={session}
            isOnline={isOnline}
            onToggleOnline={() => setIsOnline((prev) => !prev)}
            isPrinterConnected={isPrinterConnected}
            onTogglePrinter={() => setIsPrinterConnected((prev) => !prev)}
            paperWidthMm={paperWidthMm}
            onChangePaperWidth={handleChangePaperWidth}
            serverRevision={serverCatalogRevision}
            localRevision={localCatalogRevision}
            onPerformDeltaSync={() => {}}
            onCartSummaryChange={setCartSummary}
            openCartSignal={openCartSignal}
            initialPermittedBranches={permittedBranchesByOutlet[activeOutletId]}
            initialSelectedBranchId={selectedBranchByOutlet[activeOutletId] || ''}
            onPermittedBranchesChange={handlePermittedBranchesChange}
            onSelectedBranchChange={handleSelectedBranchChange}
          />
        )}

        {activeTab === 'sync' && session.role !== 'staff' && (
          <div className="space-y-4">
            <Card>
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#ECFDF5] border border-[#BBF7D0] flex items-center justify-center text-[#15803D] shrink-0">
                  <Radio className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-[#2F3033]">
                    Live Supabase Realtime & Delta Revision Engine
                  </h2>
                  <p className="text-xs text-[#6F737D] mt-0.5 leading-relaxed">
                    Monotonically incrementing catalog cursor ensures offline tablets and POS counters only download delta updates since their last cached revision ({localCatalogRevision}).
                  </p>
                </div>
              </div>
            </Card>

            <SyncDashboard
              session={session}
              isOnline={isOnline}
              sseConnected={true}
              localCatalogRevision={localCatalogRevision}
              serverCatalogRevision={serverCatalogRevision}
              cachedCount={session.activeOutlet.category === 'salon' ? 14 : 10}
              offlineQueueCount={0}
              isSyncing={false}
              lastSyncTime="Just now"
              syncEvents={syncEvents}
              onTriggerSync={() => {}}
            />
          </div>
        )}
      </Suspense>
    </AppShell>
  );
}
