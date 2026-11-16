import React, { useEffect, useState } from 'react';
import type { UserSession } from '../types';

type Outlet = { id: string; name: string; code: string };
type Result = { status: number; outletCode?: string; source?: string; fresh?: boolean; total?: number; nextOffset?: number | null; error?: string };

/** SUPERADMIN troubleshooting only. Catalogs remain in each business system. */
export const CatalogSyncDiagnostics: React.FC<{ session: UserSession }> = ({ session }) => {
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [outletId, setOutletId] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [message, setMessage] = useState('');
  const token = session.token;
  useEffect(() => {
    if (session.role !== 'superadmin') return;
    let cancelled = false;
    fetch('/api/superadmin/outlets', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      .then(async r => { if (!r.ok) throw new Error(`Outlet registry HTTP ${r.status}`); return r.json(); })
      .then(body => {
        if (cancelled) return;
        const list: Outlet[] = (Array.isArray(body.outlets) ? body.outlets : []).filter((o: any) => typeof o.id === 'string')
          .map((o: any) => ({ id: o.id, name: String(o.name || o.outlet_name || o.business_name || o.id), code: String(o.code || o.outlet_code || '') }));
        setOutlets(list); setOutletId(list[0]?.id || '');
      })
      .catch(e => { if (!cancelled) setMessage(String(e.message || e)); });
    return () => { cancelled = true; };
  }, [token, session.role]);
  async function check() {
    if (!outletId || busy) return;
    setBusy(true); setResult(null); setMessage('');
    try {
      const r = await fetch(`/api/pos/outlets/${encodeURIComponent(outletId)}/source-catalog?limit=1&offset=0`,
        { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const body = await r.json().catch(() => null);
      setResult({ status: r.status, outletCode: body?.outletCode, source: body?.source,
        fresh: body?.fresh, total: body?.total, nextOffset: body?.nextOffset,
        error: r.ok ? undefined : String(body?.message || 'Request failed') });
    } catch { setMessage('Network error while checking outlet source.'); }
    finally { setBusy(false); }
  }
  if (session.role !== 'superadmin') return null;
  return <section className="space-y-5 text-slate-100">
    <div className="rounded-2xl border border-slate-800 bg-[#121629] p-6 space-y-4">
      <h2 className="text-xl font-bold">Outlet Catalog Diagnostics</h2>
      <p className="text-sm text-slate-400">Read-only check of the selected outlet's authoritative catalog. No central catalog imports or data writes.</p>
      <div className="flex flex-wrap gap-3 items-end">
        <label className="flex flex-col gap-2 text-sm">Outlet
          <select value={outletId} onChange={e => { setOutletId(e.target.value); setResult(null); }} className="min-w-64 rounded-lg border border-slate-700 bg-slate-900 p-2">
            {outlets.map(o => <option key={o.id} value={o.id}>{o.name} ({o.code})</option>)}
          </select>
        </label>
        <button type="button" disabled={!outletId || busy} onClick={check} className="rounded-lg bg-sky-600 px-5 py-2 font-semibold disabled:opacity-50">{busy ? 'Checking…' : 'Check outlet catalog'}</button>
      </div>
      {message && <p role="alert" className="text-amber-300 text-sm">{message}</p>}
      {result && <div role="status" className="rounded-lg border border-slate-700 p-4 text-sm space-y-2">
        <p>HTTP {result.status} {result.status === 200 ? '· Connected' : '· Unavailable'}</p>
        {result.outletCode && <p>Outlet: {result.outletCode}</p>}
        {result.source && <p>Source: {result.source} · {result.fresh ? 'Fresh source response' : 'Cached source (freshness not verified)'}</p>}
        {typeof result.total === 'number' && <p>Active catalog items: {result.total}</p>}
        {result.error && <p className="text-amber-300">{result.error}</p>}
      </div>}
    </div>
  </section>;
};
