import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Play,
  RefreshCw,
  Send,
  ShieldAlert,
  Webhook,
} from 'lucide-react';
import type { Outlet, UserSession } from '../types';
import {
  BASE_INPUT_CLASS,
  Button,
  Card,
  EmptyState,
  ErrorState,
  FormField,
  ResponsiveTable,
  StatusBadge,
} from './ui';

interface IntegrationDiagnosticsProps {
  session: UserSession;
  outlets?: Outlet[];
}

type DiagnosticReport = {
  checkedAt: string;
  backend: {
    connected: boolean;
    centralSupabaseConfigured: boolean;
    supabaseProjectHost?: string | null;
    serviceRoleConfigured: boolean;
    dispatchSecretConfigured: boolean;
    cronSecretConfigured: boolean;
    internalDispatcher: {
      enabled: boolean;
      intervalSec: number;
      running: boolean;
      lastRunAt: string | null;
      lastRunError: string | null;
      lastProcessed: number;
    };
  };
  supabase: {
    connected: boolean;
    error: string | null;
    routesError?: string | null;
    tables: Record<string, { exists: boolean; error?: string }>;
  };
  routesError?: string | null;
  salesSummary: {
    salonBillsCount: number;
    centralSalesCount: number;
    totalSyncedRecords: number;
  };
  queueSummary: {
    pending: number;
    processing: number;
    sent: number;
    failed: number;
    skipped: number;
    total: number;
  };
  routes: Array<{
    outlet_id: string;
    outlet_code: string;
    outlet_name: string;
    category: string;
    configured: boolean;
    status_label?: 'ENABLED' | 'DISABLED' | 'UNSEEDED' | 'ERROR';
    query_error?: string | null;
    endpoint_url: string | null;
    enabled: boolean;
    send_receipts: boolean;
    send_feedback: boolean;
    receipt_template_name: string | null;
    feedback_template_name: string | null;
    last_verified_at: string | null;
    last_http_status: number | null;
    last_error: string | null;
    reachability?: {
      reachable: boolean;
      httpStatus: number | null;
      message: string;
      checkedAt: string;
    } | null;
  }>;
  recentJobs: Array<{
    id: string;
    outlet_id: string;
    source_type: string;
    event_type: string;
    status: string;
    bill_id?: string | null;
    bill_number?: string | null;
    masked_phone?: string | null;
    scheduled_at: string;
    attempts: number;
    last_http_status?: number | null;
    downstream_status?: string | null;
    whatsapp_status?: string | null;
    whatsapp_message_id?: string | null;
    last_error?: string | null;
    updated_at: string;
  }>;
  recentLogs: Array<{
    id?: string;
    job_id?: string | null;
    event_id?: string | null;
    bill_id?: string | null;
    outlet_id: string;
    bill_number?: string | null;
    event_type?: string | null;
    step: string;
    status: string;
    http_status?: number | null;
    whatsapp_status?: string | null;
    whatsapp_message_id?: string | null;
    masked_phone?: string | null;
    sanitized_error?: string | null;
    created_at: string;
  }>;
};

const statusTone = (status?: string | null): 'success' | 'warning' | 'danger' | 'info' | 'neutral' => {
  const s = String(status || '').toLowerCase();
  if (s === 'sent' || s === 'accepted' || s === 'accepted_by_receiver' || s === 'delivered' || s === 'ok') {
    return 'success';
  }
  if (s === 'pending' || s === 'processing' || s === 'retry') return 'info';
  if (s === 'skipped') return 'warning';
  if (s === 'failed' || s === 'error') return 'danger';
  return 'neutral';
};

export const IntegrationDiagnostics: React.FC<IntegrationDiagnosticsProps> = ({
  session,
  outlets = [],
}) => {
  const isSuperadmin = session.role === 'superadmin';
  const isAdmin = session.role === 'admin' || isSuperadmin;
  const [selectedOutletId, setSelectedOutletId] = useState<string>(
    isSuperadmin ? '' : session.activeOutlet.id
  );
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [runningProbe, setRunningProbe] = useState<boolean>(false);
  const [dispatchingNow, setDispatchingNow] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [actionBanner, setActionBanner] = useState<string | null>(null);

  // Guarded Confirmed E2E Test state
  const [e2eOutletId, setE2eOutletId] = useState<string>(
    isSuperadmin ? outlets[0]?.id || '' : session.activeOutlet.id
  );
  const [testPhone, setTestPhone] = useState<string>('');
  const [confirmedE2E, setConfirmedE2E] = useState<boolean>(false);
  const [runningE2E, setRunningE2E] = useState<boolean>(false);
  const [e2eResult, setE2eResult] = useState<any | null>(null);

  useEffect(() => {
    if (!isSuperadmin) {
      setSelectedOutletId(session.activeOutlet.id);
      setE2eOutletId(session.activeOutlet.id);
    } else if (!e2eOutletId && outlets.length > 0) {
      setE2eOutletId(outlets[0].id);
    }
  }, [isSuperadmin, session.activeOutlet.id, outlets, e2eOutletId]);

  const loadDiagnostics = useCallback(
    async (probeEndpoints = false) => {
      if (!isAdmin) return;
      if (probeEndpoints) setRunningProbe(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/admin/integration-diagnostics/run', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.token}`,
          },
          body: JSON.stringify({
            ...(selectedOutletId ? { outletId: selectedOutletId } : {}),
            probeEndpoints,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          throw new Error(data?.message || `Diagnostics failed (HTTP ${res.status})`);
        }
        setReport(data);
      } catch (err: any) {
        setError(err?.message || 'Unable to load integration diagnostics.');
      } finally {
        setLoading(false);
        setRunningProbe(false);
      }
    },
    [isAdmin, session.token, selectedOutletId]
  );

  useEffect(() => {
    void loadDiagnostics(false);
  }, [loadDiagnostics]);

  const handleDispatchNow = async () => {
    setDispatchingNow(true);
    setActionBanner(null);
    setError(null);
    try {
      const res = await fetch('/api/admin/integration-diagnostics/dispatch-now', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || `Dispatch failed (HTTP ${res.status})`);
      }
      setActionBanner(`Dispatcher tick completed: ${data.processed ?? 0} due job(s) processed.`);
      await loadDiagnostics(false);
    } catch (err: any) {
      setError(err?.message || 'Unable to trigger dispatcher.');
    } finally {
      setDispatchingNow(false);
    }
  };

  const handleRunConfirmedE2E = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmedE2E) {
      setError('Confirm the checkbox before running an E2E test.');
      return;
    }
    setRunningE2E(true);
    setError(null);
    setE2eResult(null);
    try {
      const res = await fetch('/api/admin/integration-diagnostics/test-e2e', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({
          confirmed: true,
          outletId: isSuperadmin ? e2eOutletId : session.activeOutlet.id,
          testPhone: testPhone.trim(),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!data) throw new Error(`HTTP ${res.status}`);
      setE2eResult(data);
      if (!res.ok && data.message) {
        setError(data.message);
      }
      await loadDiagnostics(false);
    } catch (err: any) {
      setError(err?.message || 'Confirmed E2E test failed.');
    } finally {
      setRunningE2E(false);
    }
  };

  if (!isAdmin) return null;

  return (
    <div className="space-y-4">
      <Card padding="lg" className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#FDF2F8] border border-[#FBCFE8] flex items-center justify-center text-[#FF1B7A] shrink-0">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-[#2F3033]">
                Central Billing &amp; WhatsApp Integration Diagnostics
              </h2>
              <p className="text-xs text-[#6F737D] mt-0.5 leading-relaxed">
                Verify Stage 1 persistence, Stage 2 notification queue &amp; HMAC dispatch, and Stage 3 downstream outlet receiver &amp; WhatsApp status.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              loading={runningProbe}
              onClick={() => void loadDiagnostics(true)}
              leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
            >
              Run Diagnostics (with HTTPS Probe)
            </Button>
            <Button
              size="sm"
              loading={dispatchingNow}
              onClick={() => void handleDispatchNow()}
              leftIcon={<Play className="w-3.5 h-3.5" />}
            >
              Dispatch Due Queue Now
            </Button>
          </div>
        </div>

        {isSuperadmin && outlets.length > 0 && (
          <div className="max-w-md">
            <FormField label="Scope Outlet" htmlFor="integration-outlet-filter">
              <select
                id="integration-outlet-filter"
                value={selectedOutletId}
                onChange={(e) => setSelectedOutletId(e.target.value)}
                className={BASE_INPUT_CLASS}
              >
                <option value="">All Registered Outlets ({outlets.length})</option>
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} ({o.code})
                  </option>
                ))}
              </select>
            </FormField>
          </div>
        )}
      </Card>

      {error && (
        <ErrorState
          title="Integration diagnostic alert"
          message={error}
          onRetry={() => void loadDiagnostics(false)}
        />
      )}

      {actionBanner && (
        <div
          role="status"
          className="p-3 rounded-xl bg-[#ECFDF5] border border-[#BBF7D0] text-[#15803D] text-xs flex items-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{actionBanner}</span>
        </div>
      )}

      {loading && !report ? (
        <Card padding="lg" className="text-xs text-[#6F737D]">
          Loading integration health checks…
        </Card>
      ) : report ? (
        <>
          {/* Summary KPI Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card padding="md" className="space-y-1">
              <span className="text-xs text-[#6F737D] font-medium">Central Backend &amp; Secrets</span>
              <div className="flex items-center gap-2">
                <StatusBadge
                  label={
                    report.backend.serviceRoleConfigured && report.backend.dispatchSecretConfigured
                      ? 'READY'
                      : 'INCOMPLETE'
                  }
                  tone={
                    report.backend.serviceRoleConfigured && report.backend.dispatchSecretConfigured
                      ? 'success'
                      : 'warning'
                  }
                />
              </div>
              <p className="text-[11px] text-[#6F737D]">
                Service Key: {report.backend.serviceRoleConfigured ? 'Set' : 'Missing'} · HMAC:{' '}
                {report.backend.dispatchSecretConfigured ? 'Set' : 'Missing'}
              </p>
            </Card>

            <Card padding="md" className="space-y-1">
              <span className="text-xs text-[#6F737D] font-medium">Central Supabase</span>
              <div>
                <StatusBadge
                  label={report.supabase.connected ? 'CONNECTED' : 'UNAVAILABLE'}
                  tone={report.supabase.connected ? 'success' : 'danger'}
                />
              </div>
              <p className="text-[11px] text-[#6F737D] truncate" title={report.backend.supabaseProjectHost || undefined}>
                {report.supabase.error ||
                  (report.backend.supabaseProjectHost
                    ? `${report.backend.supabaseProjectHost} · ${Object.keys(report.supabase.tables).length} tables`
                    : `Checked ${Object.keys(report.supabase.tables).length} core tables`)}
              </p>
            </Card>

            <Card padding="md" className="space-y-1">
              <span className="text-xs text-[#6F737D] font-medium">Synced Bills &amp; Sales</span>
              <div className="text-xl font-bold text-[#2F3033] tabular-nums">
                {report.salesSummary.totalSyncedRecords}
              </div>
              <p className="text-[11px] text-[#6F737D] tabular-nums">
                Salon: {report.salesSummary.salonBillsCount} · Central Sales: {report.salesSummary.centralSalesCount}
              </p>
            </Card>

            <Card padding="md" className="space-y-1">
              <span className="text-xs text-[#6F737D] font-medium">Notification Jobs</span>
              <div className="text-xl font-bold text-[#2F3033] tabular-nums">
                {report.queueSummary.sent} sent / {report.queueSummary.total}
              </div>
              <p className="text-[11px] text-[#6F737D] tabular-nums">
                Pending: {report.queueSummary.pending} · Failed: {report.queueSummary.failed} · Skipped:{' '}
                {report.queueSummary.skipped}
              </p>
            </Card>
          </div>

          {/* Configured Outlet Notification Routes */}
          <Card padding="lg" className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Webhook className="w-4 h-4 text-[#1D4ED8]" />
                <h3 className="text-sm font-bold text-[#2F3033]">
                  Configured Outlet Notification Routes
                </h3>
              </div>
              <span className="text-[11px] text-[#6F737D]">
                Auto-dispatcher: {report.backend.internalDispatcher.enabled ? `Every ${report.backend.internalDispatcher.intervalSec}s` : 'Disabled'}
                {report.backend.internalDispatcher.lastRunAt
                  ? ` · Last run ${new Date(report.backend.internalDispatcher.lastRunAt).toLocaleTimeString()}`
                  : ''}
              </span>
            </div>

            {(report.routesError || report.supabase.routesError) && (
              <div className="p-3 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-[#B91C1C] text-xs">
                Route query error: {report.routesError || report.supabase.routesError}
              </div>
            )}

            <ResponsiveTable
              rows={report.routes}
              keyExtractor={(r) => r.outlet_id}
              emptyState={<EmptyState title="No outlets in scope" />}
              columns={[
                {
                  key: 'outlet',
                  header: 'Outlet',
                  render: (r) => (
                    <div>
                      <div className="font-semibold text-[#2F3033] text-xs">{r.outlet_name}</div>
                      <div className="font-mono text-[11px] text-[#6F737D]">
                        {r.outlet_code} · {r.category}
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'endpoint',
                  header: 'Receiver Endpoint',
                  render: (r) => (
                    <div className="space-y-0.5">
                      <div className="font-mono text-[11px] text-[#2F3033] break-all">
                        {r.query_error
                          ? `Query failed: ${r.query_error}`
                          : r.endpoint_url || 'Not seeded in smav_outlet_notification_routes'}
                      </div>
                      {r.reachability && (
                        <div className="text-[11px] text-[#6F737D]">
                          Probe: {r.reachability.message}
                        </div>
                      )}
                    </div>
                  ),
                },
                {
                  key: 'templates',
                  header: 'Workflow & Templates',
                  render: (r) => (
                    <div className="text-[11px] text-[#6F737D] space-y-0.5">
                      <div>
                        Receipt: {r.send_receipts ? 'Enabled' : 'Disabled'}
                        {r.receipt_template_name ? ` (${r.receipt_template_name})` : ''}
                      </div>
                      <div>
                        Feedback: {r.send_feedback ? 'Enabled (2m)' : 'Disabled'}
                        {r.feedback_template_name ? ` (${r.feedback_template_name})` : ''}
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'status',
                  header: 'Route State',
                  align: 'right',
                  render: (r) => (
                    <div className="space-y-1 text-right">
                      <StatusBadge
                        label={
                          r.query_error || r.status_label === 'ERROR'
                            ? 'QUERY ERROR'
                            : r.enabled
                              ? 'ENABLED'
                              : r.configured
                                ? 'DISABLED'
                                : 'UNSEEDED'
                        }
                        tone={
                          r.query_error || r.status_label === 'ERROR'
                            ? 'danger'
                            : r.enabled
                              ? 'success'
                              : 'warning'
                        }
                      />
                      {r.last_http_status !== null && (
                        <div className="text-[11px] font-mono text-[#6F737D]">
                          Last HTTP {r.last_http_status}
                        </div>
                      )}
                      {r.last_error && (
                        <div className="text-[11px] text-[#B91C1C] max-w-[220px] ml-auto truncate">
                          {r.last_error}
                        </div>
                      )}
                    </div>
                  ),
                },
              ]}
              renderMobileCard={(r) => (
                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-[#2F3033]">{r.outlet_name}</span>
                    <StatusBadge
                      label={
                        r.query_error || r.status_label === 'ERROR'
                          ? 'QUERY ERROR'
                          : r.enabled
                            ? 'ENABLED'
                            : r.configured
                              ? 'DISABLED'
                              : 'UNSEEDED'
                      }
                      tone={
                        r.query_error || r.status_label === 'ERROR'
                          ? 'danger'
                          : r.enabled
                            ? 'success'
                            : 'warning'
                      }
                    />
                  </div>
                  <div className="font-mono text-[11px] text-[#6F737D] break-all">
                    {r.query_error ? `Query failed: ${r.query_error}` : r.endpoint_url || 'No route configured'}
                  </div>
                  <div className="text-[11px] text-[#6F737D]">
                    Receipt: {r.send_receipts ? 'On' : 'Off'} · Feedback: {r.send_feedback ? 'On' : 'Off'}
                    {r.last_http_status !== null ? ` · HTTP ${r.last_http_status}` : ''}
                  </div>
                  {r.reachability && (
                    <div className="text-[11px] text-[#1D4ED8]">{r.reachability.message}</div>
                  )}
                </div>
              )}
            />
          </Card>

          {/* Guarded Confirmed End-to-End Test */}
          <Card padding="lg" className="space-y-3">
            <div className="flex items-start gap-2.5">
              <ShieldAlert className="w-4 h-4 text-[#D97706] mt-0.5 shrink-0" />
              <div>
                <h3 className="text-sm font-bold text-[#2F3033]">
                  Confirmed End-to-End Integration Test (Optional)
                </h3>
                <p className="text-xs text-[#6F737D] mt-0.5">
                  Executes one real Stage 1 -&gt; Stage 2 -&gt; Stage 3 flow using a test record and an authorized test WhatsApp number. Never runs automatically or sends to real customers.
                </p>
              </div>
            </div>

            <form onSubmit={handleRunConfirmedE2E} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              {isSuperadmin && (
                <FormField label="Target Outlet" htmlFor="e2e-outlet">
                  <select
                    id="e2e-outlet"
                    value={e2eOutletId}
                    onChange={(e) => setE2eOutletId(e.target.value)}
                    className={BASE_INPUT_CLASS}
                  >
                    {outlets.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name} ({o.code})
                      </option>
                    ))}
                  </select>
                </FormField>
              )}

              <FormField label="Authorized Test WhatsApp Phone" htmlFor="e2e-phone">
                <input
                  id="e2e-phone"
                  type="tel"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  placeholder="e.g. 9198XXXXXXXX"
                  className={BASE_INPUT_CLASS}
                  required
                />
              </FormField>

              <div className="space-y-2">
                <label className="flex items-start gap-2 text-[11px] text-[#2F3033] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmedE2E}
                    onChange={(e) => setConfirmedE2E(e.target.checked)}
                    className="mt-0.5 accent-[#FF1B7A]"
                  />
                  <span>I confirm this is an authorized test phone number.</span>
                </label>
                <Button
                  type="submit"
                  size="sm"
                  loading={runningE2E}
                  disabled={!confirmedE2E || !testPhone.trim()}
                  leftIcon={<Send className="w-3.5 h-3.5" />}
                >
                  Run Confirmed E2E Test
                </Button>
              </div>
            </form>

            {e2eResult && (
              <div className="p-3 rounded-xl bg-[#F9FAFC] border border-[#E5E7EC] text-xs space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-[#2F3033]">
                    Test Bill: {e2eResult.bill_number} · Event {e2eResult.event_type}
                  </span>
                  <StatusBadge
                    label={e2eResult.success ? 'PASSED' : 'FAILED'}
                    tone={e2eResult.success ? 'success' : 'danger'}
                  />
                </div>
                <div className="text-[11px] text-[#6F737D] font-mono">
                  bill_id={e2eResult.bill_id || 'n/a'} · event_id={e2eResult.event_id} · HTTP{' '}
                  {e2eResult.http_status} · WhatsApp={e2eResult.whatsapp_status}
                </div>
                {Array.isArray(e2eResult.steps) &&
                  e2eResult.steps.map((st: any, idx: number) => (
                    <div key={idx} className="text-[11px] text-[#2F3033] flex items-center gap-2">
                      <StatusBadge label={st.status} tone={statusTone(st.status)} />
                      <span className="font-mono">{st.step}</span>
                      <span className="text-[#6F737D]">{st.detail}</span>
                    </div>
                  ))}
              </div>
            )}
          </Card>

          {/* Recent Notification Jobs & Delivery Status */}
          <Card padding="lg" className="space-y-3">
            <h3 className="text-sm font-bold text-[#2F3033]">
              Recent Sale Notification Jobs &amp; WhatsApp Status
            </h3>
            <ResponsiveTable
              rows={report.recentJobs}
              keyExtractor={(j) => j.id}
              emptyState={<EmptyState title="No notification jobs recorded yet" />}
              columns={[
                {
                  key: 'bill',
                  header: 'Bill / Event',
                  render: (j) => (
                    <div>
                      <div className="font-mono text-xs font-semibold text-[#2F3033]">
                        {j.bill_number || j.id.slice(0, 8)}
                      </div>
                      <div className="text-[11px] text-[#6F737D]">
                        {j.source_type} · {j.event_type} · {j.masked_phone || 'No phone'}
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'status',
                  header: 'Queue Status',
                  render: (j) => <StatusBadge label={j.status} tone={statusTone(j.status)} />,
                },
                {
                  key: 'http',
                  header: 'Downstream / HTTP',
                  render: (j) => (
                    <div className="text-[11px] font-mono text-[#2F3033]">
                      {j.last_http_status ? `HTTP ${j.last_http_status}` : 'Not dispatched'}
                      {j.downstream_status ? ` · ${j.downstream_status}` : ''}
                    </div>
                  ),
                },
                {
                  key: 'wa',
                  header: 'WhatsApp Delivery',
                  render: (j) => (
                    <div>
                      <StatusBadge
                        label={j.whatsapp_status || 'pending'}
                        tone={statusTone(j.whatsapp_status || j.status)}
                      />
                      {j.whatsapp_message_id && (
                        <div className="text-[10px] font-mono text-[#6F737D] mt-0.5 truncate max-w-[160px]">
                          {j.whatsapp_message_id}
                        </div>
                      )}
                    </div>
                  ),
                },
                {
                  key: 'err',
                  header: 'Error / Updated',
                  align: 'right',
                  render: (j) => (
                    <div className="text-right text-[11px]">
                      {j.last_error ? (
                        <span className="text-[#B91C1C] font-medium">{j.last_error}</span>
                      ) : (
                        <span className="text-[#6F737D] tabular-nums">
                          {new Date(j.updated_at).toLocaleString()}
                        </span>
                      )}
                    </div>
                  ),
                },
              ]}
              renderMobileCard={(j) => (
                <div className="space-y-1 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-bold text-[#2F3033]">
                      {j.bill_number || j.id.slice(0, 8)}
                    </span>
                    <StatusBadge label={j.status} tone={statusTone(j.status)} />
                  </div>
                  <div className="text-[11px] text-[#6F737D]">
                    {j.event_type} · {j.masked_phone || 'No phone'} ·{' '}
                    {j.last_http_status ? `HTTP ${j.last_http_status}` : 'Pending'}
                  </div>
                  {j.last_error && <div className="text-[11px] text-[#B91C1C]">{j.last_error}</div>}
                </div>
              )}
            />
          </Card>

          {/* Sanitized Step Logs */}
          <Card padding="lg" className="space-y-3">
            <h3 className="text-sm font-bold text-[#2F3033]">Recent Sanitized Pipeline Logs</h3>
            {report.recentLogs.length === 0 ? (
              <EmptyState
                icon={<AlertTriangle className="w-5 h-5" />}
                title="No step logs yet"
                description="Step logs appear after bills/orders are synced or dispatched."
              />
            ) : (
              <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                {report.recentLogs.map((log, idx) => (
                  <div
                    key={log.id || `${log.created_at}-${idx}`}
                    className="p-2.5 rounded-xl bg-[#F9FAFC] border border-[#E5E7EC] text-[11px] flex flex-wrap items-center justify-between gap-2"
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <StatusBadge label={log.status} tone={statusTone(log.status)} />
                        <span className="font-mono font-semibold text-[#2F3033]">{log.step}</span>
                        {log.bill_number && (
                          <span className="font-mono text-[#1D4ED8]">{log.bill_number}</span>
                        )}
                      </div>
                      <div className="text-[#6F737D] font-mono">
                        event={log.event_id ? log.event_id.slice(0, 8) : 'n/a'} · bill=
                        {log.bill_id ? log.bill_id.slice(0, 8) : 'n/a'}
                        {log.http_status ? ` · HTTP ${log.http_status}` : ''}
                        {log.whatsapp_status ? ` · WA=${log.whatsapp_status}` : ''}
                        {log.masked_phone ? ` · ${log.masked_phone}` : ''}
                      </div>
                      {log.sanitized_error && (
                        <div className="text-[#B91C1C]">{log.sanitized_error}</div>
                      )}
                    </div>
                    <span className="text-[#6F737D] tabular-nums shrink-0">
                      {new Date(log.created_at).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
};
