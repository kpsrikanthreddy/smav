import React from 'react';
import {
  Cloud,
  RefreshCw,
  Clock,
  Radio,
  CheckCircle2,
  AlertTriangle,
  Database,
  ArrowRight,
  ShieldCheck,
  Zap,
  Server,
  ExternalLink,
  Scissors,
  Utensils
} from 'lucide-react';
import { StaffSession, SyncEventItem } from '../types';

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
  onSimulatePriceBump: () => void;
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
  onSimulatePriceBump,
  onPullSupabaseSync
}) => {
  const isStale = localCatalogRevision < serverCatalogRevision;

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-850 to-slate-900 border border-slate-700/80 rounded-2xl p-6 shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2.5 h-2.5 rounded-full bg-sky-400 animate-ping" />
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Cloud className="w-5 h-5 text-sky-400" />
              Unified Supabase Realtime & POS Synchronization Dashboard
            </h3>
          </div>
          <p className="text-xs text-slate-400">
            Authoritative Catalog Source: <span className="font-semibold text-slate-200">{session.business_name}</span> ({session.branch_name}) • Monotonic Cursor Engine
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {onPullSupabaseSync && (
            <button
              onClick={onPullSupabaseSync}
              disabled={isPullingSupabase || !isOnline}
              className="flex items-center gap-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white px-3.5 py-2 rounded-xl text-xs font-semibold shadow-md transition disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isPullingSupabase ? 'animate-spin' : ''}`} />
              {isPullingSupabase ? 'Syncing Supabase...' : 'Pull Live Supabase Catalog'}
            </button>
          )}

          <button
            onClick={onSimulatePriceBump}
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-600/60 px-3.5 py-2 rounded-xl text-xs font-semibold shadow-sm transition"
          >
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            Simulate Cloud Price Update
          </button>

          <button
            onClick={onTriggerSync}
            disabled={isSyncing || !isOnline}
            className="flex items-center gap-2 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-md transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            {isSyncing ? 'Syncing Delta...' : 'Sync Now (Delta Cursor)'}
          </button>
        </div>
      </div>

      {/* Authoritative Supabase Projects Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-emerald-400" />
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">
              Authoritative Supabase Project Connections
            </h4>
          </div>
          <span className="text-[11px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full font-semibold">
            ● Supabase Live Invalidation Active
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Glossy Looks Supabase */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800/80 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-rose-300 flex items-center gap-1.5">
                  <Scissors className="w-3.5 h-3.5 text-rose-400" />
                  The Glossy Looks Salon & Spa
                </span>
                <span className="text-[10px] bg-rose-500/10 text-rose-300 border border-rose-500/20 px-2 py-0.5 rounded-full font-mono">
                  Active Supabase
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mb-2">Authoritative Database URL:</p>
              <div className="bg-slate-900 px-2.5 py-1.5 rounded-lg border border-slate-800 text-[11px] font-mono text-sky-300 break-all select-all">
                https://onswigwiwuvkvoduuhxr.supabase.co
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-center text-xs">
                <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800/60">
                  <div className="font-bold text-white">204 Active Services</div>
                  <div className="text-[10px] text-slate-400">Salon, Makeup, Spa, Nails</div>
                </div>
                <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800/60">
                  <div className="font-bold text-white">4 Live Stylists</div>
                  <div className="text-[10px] text-slate-400">Madu, paleti, Deepika, Deena</div>
                </div>
              </div>
            </div>
            <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
              <span>Upstream: <code className="text-slate-300">glossylooks.in/api</code></span>
              <span className="text-emerald-400 font-medium">Synchronized</span>
            </div>
          </div>

          {/* MOZZ / Starters4U Supabase */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800/80 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                  <Utensils className="w-3.5 h-3.5 text-amber-400" />
                  MOZZ / Starters4U Restaurant
                </span>
                <span className="text-[10px] bg-amber-500/10 text-amber-300 border border-amber-500/20 px-2 py-0.5 rounded-full font-mono">
                  Active Supabase
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mb-2">Authoritative Database URL:</p>
              <div className="bg-slate-900 px-2.5 py-1.5 rounded-lg border border-slate-800 text-[11px] font-mono text-sky-300 break-all select-all">
                https://uyqdnqbadfysnbzbncyj.supabase.co
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-center text-xs">
                <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800/60">
                  <div className="font-bold text-white">73 Menu Items</div>
                  <div className="text-[10px] text-slate-400">Chinese Starters, Pizzas, Momos</div>
                </div>
                <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800/60">
                  <div className="font-bold text-white">Gachibowli Flagship</div>
                  <div className="text-[10px] text-slate-400">Dine-in, Takeaway, KOT</div>
                </div>
              </div>
            </div>
            <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
              <span>Upstream: <code className="text-slate-300">starters4u.in/api</code></span>
              <span className="text-emerald-400 font-medium">Synchronized</span>
            </div>
          </div>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Realtime SSE Channel */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-2">
          <div className="flex justify-between items-center text-xs text-slate-400">
            <span>Supabase Realtime Channel</span>
            <Radio className={`w-4 h-4 ${sseConnected ? 'text-emerald-400 animate-pulse' : 'text-rose-400'}`} />
          </div>
          <div className="flex items-baseline gap-2">
            <span className={`text-lg font-bold ${sseConnected ? 'text-emerald-400' : 'text-rose-400'}`}>
              {sseConnected ? 'CONNECTED' : 'DISCONNECTED'}
            </span>
          </div>
          <p className="text-[11px] text-slate-500">
            Channel: <span className="font-mono text-slate-400">catalog:{session.business_id}</span>
          </p>
        </div>

        {/* Card 2: Monotonic Revision */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-2">
          <div className="flex justify-between items-center text-xs text-slate-400">
            <span>Catalog Revision</span>
            <Server className="w-4 h-4 text-sky-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-white">Rev #{localCatalogRevision}</span>
            {isStale && (
              <span className="text-[10px] bg-amber-500/20 text-amber-400 font-bold px-2 py-0.5 rounded-full border border-amber-500/30">
                Server Rev #{serverCatalogRevision}
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-500">
            {isStale ? 'Pending delta sync cursor update' : 'Local Room cache in sync'}
          </p>
        </div>

        {/* Card 3: Local SQLite Cache */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-2">
          <div className="flex justify-between items-center text-xs text-slate-400">
            <span>Cached Catalog Items</span>
            <Database className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-white">{cachedCount}</span>
            <span className="text-xs text-slate-400 font-medium">active items</span>
          </div>
          <p className="text-[11px] text-slate-500">
            Last sync: {lastSyncTime || 'Just now'}
          </p>
        </div>

        {/* Card 4: Unsynced Bills & Orders */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-2">
          <div className="flex justify-between items-center text-xs text-slate-400">
            <span>Unsynced Offline Queue</span>
            <Clock className={`w-4 h-4 ${offlineQueueCount > 0 ? 'text-amber-400' : 'text-emerald-400'}`} />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-white">{offlineQueueCount}</span>
            <span className="text-xs text-slate-400 font-medium">pending bills</span>
          </div>
          <p className="text-[11px] text-slate-500">
            {offlineQueueCount === 0 ? 'All transactions synced safely' : 'Queued in Room SQLite'}
          </p>
        </div>
      </div>

      {/* Delta Sync Architecture & Realtime Invalidation Explainer */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 space-y-4">
        <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          Production Delta Cursor & Tenant Isolation Rules
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1.5">
            <span className="text-sky-400 font-bold block">1. Monotonic Revision Pointer</span>
            <p className="text-slate-400 leading-relaxed text-[11px]">
              Every edit, price change, or deletion increments <code className="text-sky-300">smav_catalog_revisions</code>.
              Clients send <code className="text-sky-300">since_revision=101</code> and only download mutated rows.
            </p>
          </div>

          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1.5">
            <span className="text-emerald-400 font-bold block">2. Deletion Tombstones</span>
            <p className="text-slate-400 leading-relaxed text-[11px]">
              Deleted services/menu items carry <code className="text-emerald-300">is_deleted = true</code>.
              Clients immediately drop or mark them inactive in Room SQLite without full re-fetching.
            </p>
          </div>

          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1.5">
            <span className="text-amber-400 font-bold block">3. Immutable Price Snapshot</span>
            <p className="text-slate-400 leading-relaxed text-[11px]">
              Finalized bills freeze <code className="text-amber-300">catalog_revision_at_sale</code> and historical unit price. Future menu price hikes never retroactively alter existing bills.
            </p>
          </div>
        </div>
      </div>

      {/* Live Realtime SSE Event Log Stream */}
      <div className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden shadow-lg">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-sky-400 animate-pulse" />
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">
              Authoritative Supabase Realtime Event Stream ({syncEvents.length} events logged)
            </h4>
          </div>
          <span className="text-[11px] text-slate-400 font-mono">
            listening on /api/realtime/catalog-events
          </span>
        </div>

        <div className="p-4 max-h-80 overflow-y-auto space-y-2 font-mono text-xs">
          {syncEvents.length === 0 ? (
            <div className="text-center py-8 text-slate-500">
              No realtime events captured yet. Click "Simulate Cloud Price Update" above or edit an item in the Catalog Editor.
            </div>
          ) : (
            syncEvents.map((evt) => (
              <div
                key={evt.id}
                className="bg-slate-950/80 border border-slate-800/90 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3">
                  <span className="text-slate-500 text-[11px]">{evt.timestamp}</span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      evt.eventType === 'UPDATE'
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        : evt.eventType === 'INSERT'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : evt.eventType === 'DELETE'
                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                        : 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                    }`}
                  >
                    {evt.eventType}
                  </span>
                  <span className="font-bold text-sky-300 text-[11px]">
                    Rev #{evt.revision}
                  </span>
                  <span className="text-slate-300 text-xs">{evt.details}</span>
                </div>

                <span className="text-[10px] text-slate-500 uppercase tracking-wider">
                  {evt.source}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
