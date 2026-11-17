import React, { useEffect, useState } from 'react';
import {
  Clock,
  Cloud,
  Database,
  Radio,
  RefreshCw,
  Scissors,
  Server,
  ShieldCheck,
  Utensils,
} from 'lucide-react';
import { StaffSession, SyncEventItem } from '../types';
import { Button, Card, EmptyState, StatusBadge } from './ui';

interface SyncDashboardProps {
  session: StaffSession;
  isOnline: boolean;
  sseConnected: boolean;
  localCatalogRevision: number;
  serverCatalogRevision: number;
  cachedCount: number;
  offlineQueueCount: number;
  isSyncing: boolean;
  isPullingSupabase?: boolean;
  lastSyncTime: string | null;
  syncEvents: SyncEventItem[];
  onTriggerSync: () => void;
  onPullSupabaseSync?: () => void;
}

export const SyncDashboard: React.FC<SyncDashboardProps> = ({
  session,
  isOnline,
  sseConnected,
  localCatalogRevision,
  serverCatalogRevision,
  cachedCount,
  offlineQueueCount,
  isSyncing,
  isPullingSupabase = false,
  lastSyncTime,
  syncEvents,
  onTriggerSync,
  onPullSupabaseSync,
}) => {
  const isStale = localCatalogRevision < serverCatalogRevision;
  const [liveStatus, setLiveStatus] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/supabase/status')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        if (!cancelled) setLiveStatus(data);
      })
      .catch(() => {
        if (!cancelled) setLiveStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [lastSyncTime, isPullingSupabase]);

  return (
    <div className="space-y-5">
      {/* Header Banner */}
      <Card padding="lg" className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Cloud className="w-5 h-5 text-[#1D4ED8]" />
            <h3 className="text-base sm:text-lg font-bold text-[#2F3033]">
              Unified Supabase Realtime &amp; POS Synchronization
            </h3>
          </div>
          <p className="text-xs text-[#6F737D]">
            Authoritative Catalog Source:{' '}
            <span className="font-semibold text-[#2F3033]">
              {session.business_name || session.activeOutlet.name}
            </span>{' '}
            ({session.branch_name || session.activeOutlet.code}) · Monotonic Cursor Engine
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {onPullSupabaseSync && (
            <Button
              variant="success"
              size="sm"
              onClick={onPullSupabaseSync}
              disabled={isPullingSupabase || !isOnline}
              loading={isPullingSupabase}
              leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
            >
              {isPullingSupabase ? 'Syncing Supabase...' : 'Pull Live Supabase Catalog'}
            </Button>
          )}

          <Button
            size="sm"
            onClick={onTriggerSync}
            disabled={isSyncing || !isOnline}
            loading={isSyncing}
            leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
          >
            {isSyncing ? 'Syncing Delta...' : 'Sync Now (Delta Cursor)'}
          </Button>
        </div>
      </Card>

      {/* Authoritative Supabase Projects Card */}
      <Card padding="lg" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-[#15803D]" />
            <h4 className="text-xs font-bold text-[#2F3033] uppercase tracking-wider">
              Authoritative Supabase Project Connections
            </h4>
          </div>
          <StatusBadge
            label={
              liveStatus?.last_sync
                ? `Last pull: ${new Date(liveStatus.last_sync).toLocaleString()}`
                : 'Upstream sync not verified'
            }
            tone={liveStatus?.last_sync ? 'success' : 'neutral'}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Glossy Looks */}
          <div className="bg-[#F9FAFC] p-4 rounded-2xl border border-[#E5E7EC] flex flex-col justify-between space-y-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-[#2F3033] flex items-center gap-1.5">
                  <Scissors className="w-3.5 h-3.5 text-[#FF1B7A]" />
                  The Glossy Looks Salon &amp; Spa
                </span>
                <StatusBadge label="Configured" tone="brand" />
              </div>
              <p className="text-[11px] text-[#6F737D]">Authoritative Database URL:</p>
              <div className="bg-white px-3 py-1.5 rounded-xl border border-[#E5E7EC] text-[11px] font-mono text-[#1D4ED8] break-all select-all">
                https://onswigwiwuvkvoduuhxr.supabase.co
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1 text-center text-xs">
                <div className="bg-white p-2.5 rounded-xl border border-[#E5E7EC]">
                  <div className="font-bold text-[#2F3033] tabular-nums">
                    {liveStatus?.last_sync ? liveStatus.the_glossy_looks?.services_count : '—'} Services
                  </div>
                  <div className="text-[10px] text-[#6F737D]">Salon, Makeup, Spa</div>
                </div>
                <div className="bg-white p-2.5 rounded-xl border border-[#E5E7EC]">
                  <div className="font-bold text-[#2F3033] tabular-nums">
                    {liveStatus?.last_sync ? liveStatus.the_glossy_looks?.stylists_count : '—'} Stylists
                  </div>
                  <div className="text-[10px] text-[#6F737D]">Upstream Staff API</div>
                </div>
              </div>
            </div>
            <div className="pt-2 border-t border-[#E5E7EC] flex items-center justify-between text-[11px] text-[#6F737D]">
              <span>
                Upstream: <code className="text-[#2F3033] font-mono">glossylooks.in/api</code>
              </span>
              <span className="text-[#15803D] font-semibold">
                {liveStatus?.last_sync ? 'Pull recorded' : 'Standby'}
              </span>
            </div>
          </div>

          {/* MOZZ */}
          <div className="bg-[#F9FAFC] p-4 rounded-2xl border border-[#E5E7EC] flex flex-col justify-between space-y-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-[#2F3033] flex items-center gap-1.5">
                  <Utensils className="w-3.5 h-3.5 text-[#FF6A00]" />
                  MOZZ / Starters4U Restaurant
                </span>
                <StatusBadge label="Configured" tone="warning" />
              </div>
              <p className="text-[11px] text-[#6F737D]">Authoritative Database URL:</p>
              <div className="bg-white px-3 py-1.5 rounded-xl border border-[#E5E7EC] text-[11px] font-mono text-[#1D4ED8] break-all select-all">
                https://uyqdnqbadfysnbzbncyj.supabase.co
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1 text-center text-xs">
                <div className="bg-white p-2.5 rounded-xl border border-[#E5E7EC]">
                  <div className="font-bold text-[#2F3033] tabular-nums">
                    {liveStatus?.last_sync ? liveStatus.mozz_starters4u?.menu_items_count : '—'} Menu Items
                  </div>
                  <div className="text-[10px] text-[#6F737D]">Upstream Menu API</div>
                </div>
                <div className="bg-white p-2.5 rounded-xl border border-[#E5E7EC]">
                  <div className="font-bold text-[#2F3033]">Outlet Registry</div>
                  <div className="text-[10px] text-[#6F737D]">Dine-in, Takeaway, KOT</div>
                </div>
              </div>
            </div>
            <div className="pt-2 border-t border-[#E5E7EC] flex items-center justify-between text-[11px] text-[#6F737D]">
              <span>
                Upstream: <code className="text-[#2F3033] font-mono">starters4u.in/api</code>
              </span>
              <span className="text-[#15803D] font-semibold">
                {liveStatus?.last_sync ? 'Pull recorded' : 'Standby'}
              </span>
            </div>
          </div>
        </div>
      </Card>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card padding="md" className="space-y-1.5">
          <div className="flex justify-between items-center text-xs text-[#6F737D]">
            <span>Realtime Channel</span>
            <Radio className={`w-4 h-4 ${sseConnected ? 'text-[#15803D]' : 'text-[#DC2626]'}`} />
          </div>
          <div className={`text-lg font-bold ${sseConnected ? 'text-[#15803D]' : 'text-[#DC2626]'}`}>
            {sseConnected ? 'CONNECTED' : 'DISCONNECTED'}
          </div>
          <p className="text-[11px] text-[#6F737D] font-mono truncate">
            catalog:{session.business_id || session.activeOutlet.id}
          </p>
        </Card>

        <Card padding="md" className="space-y-1.5">
          <div className="flex justify-between items-center text-xs text-[#6F737D]">
            <span>Catalog Revision</span>
            <Server className="w-4 h-4 text-[#1D4ED8]" />
          </div>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-xl font-bold text-[#2F3033] tabular-nums">
              Rev #{localCatalogRevision}
            </span>
            {isStale && (
              <StatusBadge label={`Server #${serverCatalogRevision}`} tone="warning" />
            )}
          </div>
          <p className="text-[11px] text-[#6F737D]">
            {isStale ? 'Pending delta sync update' : 'Local cache synchronized'}
          </p>
        </Card>

        <Card padding="md" className="space-y-1.5">
          <div className="flex justify-between items-center text-xs text-[#6F737D]">
            <span>Cached Catalog Items</span>
            <Database className="w-4 h-4 text-[#FF1B7A]" />
          </div>
          <div className="text-xl font-bold text-[#2F3033] tabular-nums">{cachedCount}</div>
          <p className="text-[11px] text-[#6F737D]">Last sync: {lastSyncTime || 'Just now'}</p>
        </Card>

        <Card padding="md" className="space-y-1.5">
          <div className="flex justify-between items-center text-xs text-[#6F737D]">
            <span>Offline Queue</span>
            <Clock
              className={`w-4 h-4 ${offlineQueueCount > 0 ? 'text-[#D97706]' : 'text-[#15803D]'}`}
            />
          </div>
          <div className="text-xl font-bold text-[#2F3033] tabular-nums">{offlineQueueCount}</div>
          <p className="text-[11px] text-[#6F737D]">
            {offlineQueueCount === 0 ? 'All transactions synced' : 'Pending local upload'}
          </p>
        </Card>
      </div>

      {/* Architecture Rules */}
      <Card padding="md" className="space-y-3">
        <h4 className="text-xs font-bold text-[#2F3033] uppercase tracking-wider flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-[#15803D]" />
          <span>Production Delta Cursor &amp; Tenant Isolation Rules</span>
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div className="bg-[#F9FAFC] p-3.5 rounded-xl border border-[#E5E7EC] space-y-1">
            <span className="text-[#1D4ED8] font-bold block">1. Monotonic Revision Pointer</span>
            <p className="text-[#6F737D] leading-relaxed text-[11px]">
              Clients send <code className="font-mono text-[#2F3033]">since_revision</code> and only download mutated rows.
            </p>
          </div>
          <div className="bg-[#F9FAFC] p-3.5 rounded-xl border border-[#E5E7EC] space-y-1">
            <span className="text-[#15803D] font-bold block">2. Deletion Tombstones</span>
            <p className="text-[#6F737D] leading-relaxed text-[11px]">
              Deleted items carry <code className="font-mono text-[#2F3033]">is_deleted = true</code> so offline caches retire them cleanly.
            </p>
          </div>
          <div className="bg-[#F9FAFC] p-3.5 rounded-xl border border-[#E5E7EC] space-y-1">
            <span className="text-[#B45309] font-bold block">3. Immutable Price Snapshot</span>
            <p className="text-[#6F737D] leading-relaxed text-[11px]">
              Finalized bills freeze historical unit prices so later catalog edits never alter past receipts.
            </p>
          </div>
        </div>
      </Card>

      {/* Realtime Event Log */}
      <Card padding="none" className="overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 border-b border-[#E5E7EC] flex flex-wrap items-center justify-between gap-2 bg-[#F9FAFC]">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-[#15803D]" />
            <h4 className="text-xs font-bold text-[#2F3033] uppercase tracking-wider">
              Realtime Event Stream ({syncEvents.length})
            </h4>
          </div>
          <span className="text-[11px] text-[#6F737D] font-mono">
            /api/realtime/catalog-events
          </span>
        </div>

        <div className="p-4 max-h-80 overflow-y-auto space-y-2 text-xs">
          {syncEvents.length === 0 ? (
            <EmptyState
              title="No realtime events yet"
              description="Catalog updates from Central Supabase will stream here automatically."
            />
          ) : (
            syncEvents.map((evt) => (
              <div
                key={evt.id}
                className="bg-[#F9FAFC] border border-[#E5E7EC] rounded-xl p-3 flex flex-wrap items-center justify-between gap-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[#6F737D] text-[11px] font-mono">{evt.timestamp}</span>
                  <StatusBadge
                    label={evt.eventType}
                    tone={
                      evt.eventType === 'UPDATE'
                        ? 'warning'
                        : evt.eventType === 'INSERT'
                          ? 'success'
                          : evt.eventType === 'DELETE'
                            ? 'danger'
                            : 'info'
                    }
                  />
                  <span className="font-bold text-[#1D4ED8] font-mono text-[11px] tabular-nums">
                    Rev #{evt.revision}
                  </span>
                  <span className="text-[#2F3033] text-xs">{evt.details}</span>
                </div>
                <span className="text-[10px] text-[#6F737D] uppercase tracking-wider font-mono">
                  {evt.source}
                </span>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
};
