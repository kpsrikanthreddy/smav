import React, { useEffect, useState } from 'react';
import { RefreshCw, SlidersHorizontal } from 'lucide-react';
import type { UserSession } from '../types';
import { BASE_INPUT_CLASS, Button, Card, ErrorState, StatusBadge } from './ui';

type OutletOption = { id: string; name: string; code: string };
type DiagnosticResult = {
  status: number;
  outletCode?: string;
  source?: string;
  fresh?: boolean;
  total?: number;
  nextOffset?: number | null;
  error?: string;
};

/** SUPERADMIN troubleshooting only. Catalogs remain in each business system. */
export const CatalogSyncDiagnostics: React.FC<{ session: UserSession }> = ({ session }) => {
  const [outlets, setOutlets] = useState<OutletOption[]>([]);
  const [outletId, setOutletId] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DiagnosticResult | null>(null);
  const [message, setMessage] = useState('');
  const token = session.token;

  useEffect(() => {
    if (session.role !== 'superadmin') return;
    let cancelled = false;
    fetch('/api/superadmin/outlets', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Outlet registry HTTP ${r.status}`);
        return r.json();
      })
      .then((body) => {
        if (cancelled) return;
        const list: OutletOption[] = (Array.isArray(body.outlets) ? body.outlets : [])
          .filter((o: any) => typeof o.id === 'string')
          .map((o: any) => ({
            id: o.id,
            name: String(o.name || o.outlet_name || o.business_name || o.id),
            code: String(o.code || o.outlet_code || ''),
          }));
        setOutlets(list);
        setOutletId(list[0]?.id || '');
      })
      .catch((e) => {
        if (!cancelled) setMessage(String(e.message || e));
      });
    return () => {
      cancelled = true;
    };
  }, [token, session.role]);

  async function check() {
    if (!outletId || busy) return;
    setBusy(true);
    setResult(null);
    setMessage('');
    try {
      const r = await fetch(
        `/api/pos/outlets/${encodeURIComponent(outletId)}/source-catalog?limit=1&offset=0`,
        { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }
      );
      const body = await r.json().catch(() => null);
      setResult({
        status: r.status,
        outletCode: body?.outletCode,
        source: body?.source,
        fresh: body?.fresh,
        total: body?.total,
        nextOffset: body?.nextOffset,
        error: r.ok ? undefined : String(body?.message || 'Request failed'),
      });
    } catch {
      setMessage('Network error while checking outlet source.');
    } finally {
      setBusy(false);
    }
  }

  if (session.role !== 'superadmin') return null;

  return (
    <section className="space-y-4">
      <Card padding="lg" className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#EFF6FF] border border-[#BFDBFE] flex items-center justify-center text-[#1D4ED8] shrink-0">
            <SlidersHorizontal className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[#2F3033]">Outlet Catalog Diagnostics</h2>
            <p className="text-xs text-[#6F737D] mt-0.5 leading-relaxed">
              Read-only check of the selected outlet&apos;s authoritative catalog. No central catalog imports or data writes.
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1 max-w-md">
            <label htmlFor="diag-outlet-select" className="block text-xs font-semibold text-[#2F3033] mb-1.5">
              Outlet
            </label>
            <select
              id="diag-outlet-select"
              value={outletId}
              onChange={(e) => {
                setOutletId(e.target.value);
                setResult(null);
              }}
              className={BASE_INPUT_CLASS}
            >
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({o.code})
                </option>
              ))}
            </select>
          </div>

          <Button
            type="button"
            disabled={!outletId || busy}
            loading={busy}
            onClick={check}
            leftIcon={<RefreshCw className="w-4 h-4" />}
          >
            {busy ? 'Checking…' : 'Check outlet catalog'}
          </Button>
        </div>

        {message && <ErrorState title="Diagnostic check warning" message={message} />}

        {result && (
          <div
            role="status"
            className="rounded-2xl border border-[#E5E7EC] bg-[#F9FAFC] p-4 text-xs space-y-2"
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="font-bold text-[#2F3033] tabular-nums">
                HTTP {result.status} · {result.status === 200 ? 'Connected' : 'Unavailable'}
              </span>
              <StatusBadge
                label={result.status === 200 ? 'Healthy' : 'Unavailable'}
                tone={result.status === 200 ? 'success' : 'warning'}
                dot
              />
            </div>

            {result.outletCode && (
              <p className="text-[#6F737D]">
                Outlet: <span className="font-mono font-semibold text-[#2F3033]">{result.outletCode}</span>
              </p>
            )}
            {result.source && (
              <p className="text-[#6F737D]">
                Source: <span className="font-medium text-[#2F3033]">{result.source}</span> ·{' '}
                {result.fresh ? 'Fresh source response' : 'Cached source (freshness not verified)'}
              </p>
            )}
            {typeof result.total === 'number' && (
              <p className="text-[#6F737D] tabular-nums">
                Active catalog items: <span className="font-bold text-[#2F3033]">{result.total}</span>
              </p>
            )}
            {result.error && <p className="text-[#B91C1C] font-medium">{result.error}</p>}
          </div>
        )}
      </Card>
    </section>
  );
};
