import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useConfirm } from './confirm';
import {
  Activity, AlertTriangle, AlertOctagon, CheckCircle2, XCircle, Database, Server, Cpu, Smartphone, Megaphone, Bot,
  ScrollText, History, Send, X, RefreshCw, Webhook, Search, Building2, type LucideIcon,
} from 'lucide-react';
import { api, errorMessage, inputInlineCls, btnSecondary } from './broadcastUtils';
import { LoadError, SkeletonCards, SkeletonRows } from './ui';
import { useVisiblePolling, REFRESH } from './usePolling';
import type {
  Alert, AuditEntry, BusinessDetail, DeliveryRow, HealthWithAlerts, LimitKey, Plan, SystemEvent, WorkerRunRow, WorkerStatus,
} from './platformTypes';
import type { ShowToast } from './types';

// Platform Admin monitoring screens. Counts, statuses and error codes only:
// no business's customers, chats or message text are ever shown here.

type OpenBusiness = (id: string) => void;
/** Business names for the filters (from the overview). */
type BusinessNames = Array<{ id: string; name: string }> | undefined;

const num = (n: number | string | null | undefined) => (n === null || n === undefined ? '–' : Number(n).toLocaleString('en-IN'));
const ago = (iso: string | null | undefined) => {
  if (!iso) return 'never';
  const m = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.floor(m / 60)} h ago`;
  return `${Math.floor(m / 1440)} days ago`;
};
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '–');
const qs = (o: Record<string, unknown>) => new URLSearchParams(
  Object.entries(o).filter(([, v]) => v !== '' && v !== null && v !== undefined).map(([k, v]) => [k, String(v)]),
).toString();

const LEVEL_CLS: Record<string, string> = {
  critical: 'bg-red-600 text-white',
  error: 'bg-red-100 text-red-800',
  warn: 'bg-amber-100 text-amber-800',
  info: 'bg-slate-100 text-slate-700',
};
const Level = ({ level }: { level: string }) => <span className={`text-xs font-bold uppercase px-1.5 py-0.5 rounded ${LEVEL_CLS[level] || LEVEL_CLS.info}`}>{level}</span>;
const Dot = ({ ok, warn }: { ok: boolean | undefined; warn?: boolean }) => (ok ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : warn ? <AlertTriangle className="w-4 h-4 text-amber-600" /> : <XCircle className="w-4 h-4 text-red-600" />);
const Card = ({ title, icon: Icon, children, right }: { title: string; icon?: LucideIcon; children: ReactNode; right?: ReactNode }) => (
  <div className="bg-white border border-slate-200 rounded-xl p-4">
    <div className="flex items-center justify-between mb-2">
      <div className="text-sm font-bold text-slate-800 flex items-center gap-2">{Icon && <Icon className="w-4 h-4 text-slate-600" />}{title}</div>
      {right}
    </div>
    {children}
  </div>
);
const Err = ({ msg, onRetry }: { msg: string; onRetry?: () => unknown }) => (msg ? <LoadError error={msg} onRetry={onRetry} /> : null);
const SOURCES = ['webhook', 'worker', 'meta', 'ai', 'ads', 'auth', 'billing', 'system'];

function BusinessSelect({ businesses, value, onChange, allowNone = true }: { businesses: BusinessNames; value: string; onChange: (v: string) => void; allowNone?: boolean }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className={inputInlineCls}>
      <option value="">All businesses</option>
      {allowNone && <option value="none">Platform (no business)</option>}
      {(businesses || []).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
    </select>
  );
}

// ---------------------------------------------------------------------------
// Alerts banner (shown on every console tab)
// ---------------------------------------------------------------------------
export function AlertsBanner({ alerts, onOpenBusiness }: { alerts: Alert[] | undefined; onOpenBusiness: OpenBusiness }) {
  const [open, setOpen] = useState(false);
  if (!alerts?.length) return null;
  const critical = alerts.filter(a => a.level === 'critical').length;
  return (
    <div className={`border rounded-xl p-3 text-xs ${critical ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 font-semibold cursor-pointer text-left">
        {critical ? <AlertOctagon className="w-4 h-4 text-red-600" /> : <AlertTriangle className="w-4 h-4 text-amber-600" />}
        <span className={critical ? 'text-red-800' : 'text-amber-900'}>
          {critical ? `${critical} critical` : ''}{critical && alerts.length > critical ? ' · ' : ''}{alerts.length > critical ? `${alerts.length - critical} warning${alerts.length - critical > 1 ? 's' : ''}` : ''}
        </span>
        <span className="text-slate-500 font-normal">{open ? 'hide' : 'show'}</span>
      </button>
      {open && <AlertList alerts={alerts} onOpenBusiness={onOpenBusiness} />}
    </div>
  );
}

function AlertList({ alerts, onOpenBusiness }: { alerts: Alert[]; onOpenBusiness?: OpenBusiness }) {
  if (!alerts.length) return <div className="text-xs text-emerald-700 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> No alerts. Everything looks healthy.</div>;
  return (
    <ul className="mt-2 space-y-1.5">
      {alerts.map((a, i) => (
        <li key={i} className="flex items-start gap-2 text-xs">
          <Level level={a.level} />
          <span className="flex-1 text-slate-700">
            {a.businessName && <button onClick={() => { if (a.businessId) onOpenBusiness?.(a.businessId); }} className="font-semibold text-slate-900 hover:underline cursor-pointer mr-1">{a.businessName}:</button>}
            {a.message}
          </span>
          <code className="text-xs text-slate-400">{a.code}</code>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
interface HealthPanelProps { data: HealthWithAlerts | null; error: string; reload: () => unknown; onOpenBusiness: OpenBusiness }

export function HealthPanel({ data, error, reload, onOpenBusiness }: HealthPanelProps) {
  useVisiblePolling(reload, REFRESH.platformHealth);
  if (error) return <Err msg={error} onRetry={reload} />;
  if (!data) return <><SkeletonCards count={4} label="Loading health" /><SkeletonRows rows={3} label="Loading health" /></>;
  const { health: h, alerts } = data;
  const w = h.worker;
  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Activity className="w-5 h-5 text-slate-700" /> Health</h1>
        <div className="text-xs text-slate-500">Checked {when(h.checkedAt)} · refreshes every minute while open</div>
      </div>

      <Card title={`Alerts (${alerts.length})`} icon={AlertTriangle}><AlertList alerts={alerts} onOpenBusiness={onOpenBusiness} /></Card>

      <div className="grid md:grid-cols-3 gap-3">
        <Card title="API" icon={Server} right={<Dot ok={h.api.ok && !h.api.missingConfig.length} warn={h.api.ok} />}>
          <dl className="text-xs text-slate-600 space-y-1">
            <div>Node {h.api.node} · up {Math.round(h.api.uptimeSec / 60)} min · {h.api.memoryMb} MB</div>
            <div>Encryption secret: {h.api.encryptionReady ? 'set' : <b className="text-red-700">missing</b>}</div>
            <div>Unsigned webhooks: {h.api.unsignedWebhooksAllowed ? <b className="text-red-700">ALLOWED</b> : 'blocked'}</div>
            {h.api.missingConfig.length > 0 && <div className="text-amber-700">Settings not set: {h.api.missingConfig.join(', ')}</div>}
          </dl>
        </Card>
        <Card title="Database" icon={Database} right={<Dot ok={h.database.ok} />}>
          <div className="text-xs text-slate-600">{h.database.ok ? `Answering in ${h.database.latencyMs} ms` : `Not answering: ${h.database.error}`}</div>
          <div className="text-xs text-slate-500 mt-1">Events (24 h): {['critical', 'error', 'warn'].map(l => `${num(h.events24h.byLevel[l])} ${l}`).join(' · ')}</div>
          {h.events24h.tableMissing && <div className="text-xs text-amber-700 mt-1">Run 20261115_admin_console.sql to start recording events.</div>}
        </Card>
        <Card title="Worker" icon={Cpu} right={<Dot ok={!w.stale && w.last?.ok} warn={!w.stale} />}>
          <div className="text-xs text-slate-600 space-y-1">
            <div>Last run: <b>{w.last ? ago(w.last.started_at) : 'none recorded'}</b>{w.last && ` · ${num(w.last.duration_ms)} ms`}</div>
            <div>Last hour: {w.runsLastHour} runs · 24 h: {w.runsLastDay} runs, {w.failedLastDay} with errors</div>
            <div>Average {num(w.avgDurationMs)} ms · slowest {num(w.maxDurationMs)} ms</div>
          </div>
        </Card>
      </div>

      <Card title="Businesses" icon={Smartphone}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-slate-500">
              <tr className="border-b border-slate-100">
                <th className="py-1.5 pr-3">Business</th><th className="pr-3">WhatsApp</th><th className="pr-3">Quality / tier</th>
                <th className="pr-3">Last webhook</th><th className="pr-3">Ads sync</th><th className="pr-3">AI</th><th className="pr-3">Errors 24 h</th>
              </tr>
            </thead>
            <tbody>
              {h.businesses.map(b => (
                <tr key={b.id} className="border-b border-slate-50 align-top">
                  <td className="py-1.5 pr-3">
                    <button onClick={() => onOpenBusiness(b.id)} className="font-semibold text-slate-800 hover:underline cursor-pointer">{b.name}</button>
                    {b.status !== 'active' && <span className="ml-1 text-xs text-red-700 font-bold uppercase">{b.status}</span>}
                  </td>
                  <td className="pr-3">
                    {!b.whatsapp.connected ? <span className="text-slate-400">not connected</span>
                      : !b.whatsapp.tokenReadable ? <span className="text-red-700 font-semibold">token unreadable</span>
                        : b.whatsapp.tokenErrors24h ? <span className="text-red-700 font-semibold">token rejected</span>
                          : <span className="text-emerald-700">connected ({b.whatsapp.source})</span>}
                    {b.whatsapp.connected && !b.whatsapp.hasAppSecret && <div className="text-amber-700">no App secret</div>}
                  </td>
                  <td className="pr-3">
                    {b.whatsapp.qualityRating ? <span className={b.whatsapp.qualityRating === 'GREEN' ? 'text-emerald-700' : b.whatsapp.qualityRating === 'RED' ? 'text-red-700 font-semibold' : 'text-amber-700'}>{b.whatsapp.qualityRating}</span> : <span className="text-slate-400">not checked</span>}
                    {b.whatsapp.messagingTier && <span className="text-slate-500"> · {b.whatsapp.messagingTier}</span>}
                    {b.whatsapp.checkError && <div className="text-red-700">{b.whatsapp.checkError}</div>}
                  </td>
                  <td className="pr-3">
                    {ago(b.webhook.lastReceivedAt)}
                    {b.webhook.signatureFailsLastHour > 0 && <div className="text-amber-700">{b.webhook.signatureFailsLastHour} bad signatures (1 h)</div>}
                  </td>
                  <td className="pr-3">{!b.ads.connected ? <span className="text-slate-400">–</span> : b.ads.lastSyncError ? <span className="text-red-700" title={b.ads.lastSyncError}>error · {ago(b.ads.lastSyncAt)}</span> : <span className="text-emerald-700">ok · {ago(b.ads.lastSyncAt)}</span>}</td>
                  <td className="pr-3">{!b.ai.configured ? <span className="text-slate-400">not set up</span> : <span className={b.ai.keyReadable === false || b.ai.errors24h ? 'text-amber-700' : 'text-emerald-700'}>{b.ai.provider}{b.ai.errors24h ? ` · ${b.ai.errors24h} errors` : ''}{b.ai.keyReadable === false ? ' · key unreadable' : ''}</span>}</td>
                  <td className="pr-3">{b.events24h.errors ? <span className="text-red-700 font-semibold">{b.events24h.errors}</span> : <span className="text-slate-400">0</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-xs text-slate-500 mt-2">Quality and messaging tier come from Meta: open a business and press "Check WhatsApp now". AI shows errors seen in real replies (no test calls are made, so no AI credit is used).</div>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Event log
// ---------------------------------------------------------------------------
export function EventsPanel({ businesses, initialBusinessId = '' }: { businesses: BusinessNames; initialBusinessId?: string }) {
  const [f, setF] = useState({ level: '', source: '', businessId: initialBusinessId, code: '', from: '', to: '' });
  const [list, setList] = useState<SystemEvent[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const names = new Map((businesses || []).map(b => [b.id, b.name]));

  const load = useCallback(async (beforeId?: number) => {
    try {
      const r = await api<{ events: SystemEvent[]; nextBeforeId: number | null }>(`/api/platform/events?${qs({ ...f, beforeId })}`);
      setList(prev => (beforeId ? [...(prev || []), ...r.events] : r.events));
      setNext(r.nextBeforeId);
      setError('');
    } catch (e) { setError(errorMessage(e)); }
  }, [f]);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2"><ScrollText className="w-5 h-5 text-slate-700" /> Event log</h1>
      <p className="text-xs text-slate-500">Errors and warnings from the webhook, worker, Meta sends, AI, ads sync, logins and billing. Kept 30 days. Phone numbers, emails and tokens are removed before saving; message text is never stored.</p>
      <div className="flex flex-wrap gap-2 items-center text-xs">
        <select value={f.level} onChange={e => setF(x => ({ ...x, level: e.target.value }))} className={inputInlineCls}>
          <option value="">All levels</option><option value="critical,error">Errors and critical</option><option value="critical">Critical</option><option value="error">Error</option><option value="warn">Warning</option><option value="info">Info</option>
        </select>
        <select value={f.source} onChange={e => setF(x => ({ ...x, source: e.target.value }))} className={inputInlineCls}>
          <option value="">All sources</option>{SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <BusinessSelect businesses={businesses} value={f.businessId} onChange={v => setF(x => ({ ...x, businessId: v }))} />
        <input placeholder="code" value={f.code} onChange={e => setF(x => ({ ...x, code: e.target.value }))} className={`${inputInlineCls} w-32`} />
        <label className="flex items-center gap-1">From <input type="date" value={f.from} onChange={e => setF(x => ({ ...x, from: e.target.value }))} className={inputInlineCls} /></label>
        <label className="flex items-center gap-1">To <input type="date" value={f.to} onChange={e => setF(x => ({ ...x, to: e.target.value }))} className={inputInlineCls} /></label>
        <button onClick={() => load()} className={btnSecondary}><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
      </div>
      <Err msg={error} onRetry={() => load()} />
      {!list && !error && <SkeletonRows rows={5} label="Loading events" />}
      {list && (
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
          {list.length === 0 && <div className="p-4 text-xs text-slate-500">No events match.</div>}
          {list.map(e => (
            <div key={e.id} className="px-3 py-2 text-xs">
              <button onClick={() => setOpen(open === e.id ? null : e.id)} className="w-full flex flex-wrap items-center gap-2 text-left cursor-pointer">
                <span className="text-slate-400 w-36 shrink-0">{when(e.created_at)}</span>
                <Level level={e.level} />
                <span className="font-semibold text-slate-700 w-16">{e.source}</span>
                <code className="text-slate-500">{e.code || '–'}</code>
                <span className="text-slate-500">{e.business_id ? names.get(e.business_id) || e.business_id.slice(0, 8) : 'platform'}</span>
                <span className="flex-1 min-w-[200px] text-slate-800 truncate">{e.message}</span>
                {e.count > 1 && <span className="text-xs bg-slate-100 rounded px-1.5">×{e.count}</span>}
              </button>
              {open === e.id && (
                <div className="mt-1.5 ml-36 p-2 bg-slate-50 rounded text-xs text-slate-700 whitespace-pre-wrap break-words">
                  {e.message}
                  {e.details && Object.keys(e.details).length > 0 && <div className="mt-1 text-slate-500">{JSON.stringify(e.details)}</div>}
                </div>
              )}
            </div>
          ))}
          {next && <button onClick={() => load(next)} className="w-full p-2 text-xs text-slate-600 hover:bg-slate-50 cursor-pointer">Load older</button>}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Worker runs
// ---------------------------------------------------------------------------
export function WorkerPanel() {
  const [failedOnly, setFailedOnly] = useState(false);
  const [data, setData] = useState<{ runs: WorkerRunRow[]; status: WorkerStatus } | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const load = useCallback(() => api<{ runs: WorkerRunRow[]; status: WorkerStatus }>(`/api/platform/worker-runs?${qs({ limit: 100, failed: failedOnly ? 'true' : '' })}`)
    .then(d => { setData(d); setError(''); }).catch(e => setError(errorMessage(e))), [failedOnly]);
  useEffect(() => { load(); }, [load]);

  const s = data?.status;
  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Cpu className="w-5 h-5 text-slate-700" /> Worker runs</h1>
        <div className="flex items-center gap-2 text-xs">
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={failedOnly} onChange={e => setFailedOnly(e.target.checked)} /> With errors only</label>
          <button onClick={load} className={btnSecondary}><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
        </div>
      </div>
      <p className="text-xs text-slate-500">The background worker runs every 5 minutes: follow-ups, broadcasts, inactive-customer checks, and hourly billing, query auto-close, clean-up and ads sync. Runs are kept 14 days.</p>
      <Err msg={error} onRetry={load} />
      {!data && !error && <SkeletonRows rows={4} label="Loading worker runs" />}
      {s && (
        <div className={`p-3 rounded-xl border text-xs ${s.stale ? 'bg-red-50 border-red-200 text-red-800' : 'bg-white border-slate-200 text-slate-700'}`}>
          Last run {s.last ? ago(s.last.started_at) : 'never'} · {s.runsLastHour} runs in the last hour · {s.runsLastDay} in 24 h ({s.failedLastDay} with errors) · average {num(s.avgDurationMs)} ms
          {s.stale && <b> · The worker looks stopped (expected every 5 minutes). Check Netlify → Functions → broadcast-worker.</b>}
        </div>
      )}
      {data && (
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
          {data.runs.length === 0 && <div className="p-4 text-xs text-slate-500">No runs recorded yet.</div>}
          {data.runs.map(r => {
            const busy = Object.entries(r.steps || {}).filter(([, v]) => v.result && Object.values(v.result).some(Boolean));
            return (
              <div key={r.id} className="px-3 py-2 text-xs">
                <button onClick={() => setOpen(open === r.id ? null : r.id)} className="w-full flex flex-wrap items-center gap-3 text-left cursor-pointer">
                  <Dot ok={r.ok} />
                  <span className="w-36 text-slate-500">{when(r.started_at)}</span>
                  <span className="w-20 text-slate-700">{num(r.duration_ms)} ms</span>
                  <span className="flex-1 text-slate-600">
                    {busy.length ? busy.map(([k, v]) => `${k}: ${Object.entries(v.result || {}).filter(([, x]) => x).map(([a, b]) => `${a} ${b}`).join(', ')}`).join(' · ') : 'nothing to do'}
                  </span>
                  {r.error_count > 0 && <span className="text-red-700 font-semibold">{r.error_count} error(s)</span>}
                </button>
                {open === r.id && (
                  <div className="mt-1.5 p-2 bg-slate-50 rounded text-xs space-y-1">
                    {Object.entries(r.steps || {}).map(([k, v]) => (
                      <div key={k}><b>{k}</b>: {v.skipped ? 'skipped' : v.failed ? <span className="text-red-700">failed</span> : JSON.stringify(v.result)} {v.ms !== undefined && <span className="text-slate-400">({v.ms} ms)</span>}</div>
                    ))}
                    {(r.errors || []).map((e, i) => <div key={i} className="text-red-700">{e.step}: {e.message}</div>)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Delivery and failures
// ---------------------------------------------------------------------------
export function DeliveryPanel({ onOpenBusiness }: { onOpenBusiness: OpenBusiness }) {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<{ days: number; businesses: DeliveryRow[] } | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api<{ days: number; businesses: DeliveryRow[] }>(`/api/platform/delivery?days=${days}`).then(d => { setData(d); setError(''); }).catch(e => setError(errorMessage(e))), [days]);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Send className="w-5 h-5 text-slate-700" /> Delivery and failures</h1>
        <div className="flex items-center gap-2 text-xs">
          <select value={days} onChange={e => setDays(Number(e.target.value))} className={inputInlineCls}>
            <option value={1}>Last 24 hours</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option>
          </select>
          <button onClick={load} className={btnSecondary}><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
        </div>
      </div>
      <p className="text-xs text-slate-500">Counts only. A high failure rate usually means a token problem, low number quality, or sending to numbers that are not on WhatsApp.</p>
      <Err msg={error} onRetry={load} />
      {!data && !error && <SkeletonRows rows={4} label="Loading delivery" />}
      {data && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-slate-500"><tr className="border-b border-slate-100">
              <th className="p-2">Business</th><th className="p-2 text-right">Sent</th><th className="p-2 text-right">Failed</th><th className="p-2 text-right">Fail rate</th>
              <th className="p-2 text-right">Broadcast sent</th><th className="p-2 text-right">Broadcast failed</th><th className="p-2 text-right">Skipped</th>
              <th className="p-2 text-right">Meta errors</th><th className="p-2 text-right">Opt-outs (period)</th><th className="p-2 text-right">Opted out (total)</th>
            </tr></thead>
            <tbody>
              {data.businesses.map(b => (
                <tr key={b.id} className="border-b border-slate-50">
                  <td className="p-2"><button onClick={() => onOpenBusiness(b.id)} className="font-semibold text-slate-800 hover:underline cursor-pointer">{b.name}</button></td>
                  <td className="p-2 text-right">{num(b.outbound)}</td>
                  <td className={`p-2 text-right ${b.failedMessages ? 'text-red-700 font-semibold' : ''}`}>{num(b.failedMessages)}</td>
                  <td className={`p-2 text-right ${(b.failureRate ?? 0) >= 10 ? 'text-red-700 font-semibold' : (b.failureRate ?? 0) >= 3 ? 'text-amber-700' : ''}`}>{b.failureRate === null ? '–' : `${b.failureRate}%`}</td>
                  <td className="p-2 text-right">{num(b.campaignSent)}</td>
                  <td className={`p-2 text-right ${b.campaignFailed ? 'text-red-700 font-semibold' : ''}`}>{num(b.campaignFailed)}</td>
                  <td className="p-2 text-right">{num(b.campaignSkipped)}</td>
                  <td className={`p-2 text-right ${b.metaSendErrors ? 'text-amber-700' : ''}`}>{num(b.metaSendErrors)}</td>
                  <td className="p-2 text-right">{num(b.optOutsInPeriod)}</td>
                  <td className="p-2 text-right">{num(b.optedOutTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------
const AUDIT_ACTIONS = ['business.', 'plan.', 'whatsapp.', 'ads.', 'business.suspended_unpaid', 'business.profile_updated'];

export function AuditPanel({ businesses, initialBusinessId = '' }: { businesses: BusinessNames; initialBusinessId?: string }) {
  const [f, setF] = useState({ businessId: initialBusinessId, actor: '', role: '', action: '', from: '', to: '' });
  const [list, setList] = useState<AuditEntry[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState('');
  const names = new Map((businesses || []).map(b => [b.id, b.name]));
  const load = useCallback(async (beforeId?: number) => {
    try {
      const r = await api<{ entries: AuditEntry[]; nextBeforeId: number | null }>(`/api/platform/audit?${qs({ ...f, beforeId })}`);
      setList(prev => (beforeId ? [...(prev || []), ...r.entries] : r.entries));
      setNext(r.nextBeforeId);
      setError('');
    } catch (e) { setError(errorMessage(e)); }
  }, [f]);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2"><History className="w-5 h-5 text-slate-700" /> Audit log</h1>
      <p className="text-xs text-slate-500">Who changed what: business and plan changes, WhatsApp and ad-account connections, ad controls, automatic suspensions.</p>
      <div className="flex flex-wrap gap-2 items-center text-xs">
        <BusinessSelect businesses={businesses} value={f.businessId} onChange={v => setF(x => ({ ...x, businessId: v }))} />
        <div className="relative"><Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
          <input placeholder="actor email" value={f.actor} onChange={e => setF(x => ({ ...x, actor: e.target.value }))} className={`${inputInlineCls} pl-7 w-44`} /></div>
        <select value={f.role} onChange={e => setF(x => ({ ...x, role: e.target.value }))} className={inputInlineCls}>
          <option value="">All roles</option>{['platform_admin', 'owner', 'manager', 'agent', 'billing'].map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <input list="audit-actions" placeholder="action (e.g. ads.)" value={f.action} onChange={e => setF(x => ({ ...x, action: e.target.value }))} className={`${inputInlineCls} w-40`} />
        <datalist id="audit-actions">{AUDIT_ACTIONS.map(a => <option key={a} value={a} />)}</datalist>
        <label className="flex items-center gap-1">From <input type="date" value={f.from} onChange={e => setF(x => ({ ...x, from: e.target.value }))} className={inputInlineCls} /></label>
        <label className="flex items-center gap-1">To <input type="date" value={f.to} onChange={e => setF(x => ({ ...x, to: e.target.value }))} className={inputInlineCls} /></label>
      </div>
      <Err msg={error} onRetry={() => load()} />
      {!list && !error && <SkeletonRows rows={5} label="Loading the audit log" />}
      {list && (
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
          {list.length === 0 && <div className="p-4 text-xs text-slate-500">No entries match.</div>}
          {list.map(a => (
            <div key={a.id} className="px-3 py-2 text-xs flex flex-wrap gap-2">
              <span className="text-slate-400 w-36 shrink-0">{when(a.created_at)}</span>
              <code className="font-semibold text-slate-800">{a.action}</code>
              <span className="text-slate-600">{a.actor_email} <span className="text-slate-400">({a.actor_role})</span></span>
              <span className="text-slate-500">{a.business_id ? names.get(a.business_id) || a.business_id.slice(0, 8) : 'platform'}</span>
              <span className="basis-full sm:basis-auto sm:flex-1 text-xs text-slate-500 break-all">{a.details && Object.keys(a.details).length ? JSON.stringify(a.details) : ''}</span>
            </div>
          ))}
          {next && <button onClick={() => load(next)} className="w-full p-2 text-xs text-slate-600 hover:bg-slate-50 cursor-pointer">Load older</button>}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// One business (drawer)
// ---------------------------------------------------------------------------
const LIMIT_LABELS: Array<[LimitKey, string]> = [
  ['max_staff', 'Team members'], ['max_contacts', 'Contacts'], ['max_broadcasts_month', 'Broadcasts / month'],
  ['max_automations', 'Active follow-ups'], ['max_ai_replies_month', 'AI replies / month'], ['max_keyword_rules', 'Keyword rules'], ['analytics_days', 'Analytics days'],
  ['max_whatsapp_numbers', 'WhatsApp numbers'], ['max_custom_fields', 'Customer fields'], ['max_import_rows_per_file', 'Import rows / file'],
  ['max_import_file_mb', 'Import file MB'], ['max_import_rows_month', 'Imported / month'],
];

/** canEdit: plan, paid-until, suspend, limit overrides (Platform Owner). canResendInvite: owner + Application Managers. */
interface BusinessDrawerProps { id: string; plans: Plan[]; onClose: () => void; onChanged: () => void; showToast: ShowToast; canEdit?: boolean; canResendInvite?: boolean; canEditDetails?: boolean }

/** Business types (businesses.industry). The type decides the Clinic tools (Healthcare) and Meta's healthcare ad rules. */
const INDUSTRY_LABEL: Record<string, string> = { hospital: 'Healthcare (hospital / clinic)', food: 'Food', retail: 'Retail', services: 'Services', general: 'Other' };

/** Name + business type: Platform Owner and Application Manager. Changing the type asks first and says what changes. */
function DetailsCard({ id, name: savedName, industry: savedIndustry, onSaved, showToast }: { id: string; name: string; industry: string; onSaved: (msg: string) => void; showToast: ShowToast }) {
  const confirm = useConfirm();
  const [name, setName] = useState(savedName);
  const [industry, setIndustry] = useState(savedIndustry);
  const [busy, setBusy] = useState(false);
  const changed = name.trim() !== savedName || industry !== savedIndustry;
  const save = async () => {
    if (industry !== savedIndustry) {
      const toClinic = industry === 'hospital';
      const fromClinic = savedIndustry === 'hospital';
      const ok = await confirm({
        title: `Change the business type to ${INDUSTRY_LABEL[industry]}?`,
        body: toClinic ? 'The business gets the Clinic tools (doctors, appointments, payments) and Meta\'s healthcare rules for its ads.'
          : fromClinic ? 'The Clinic tools disappear for this business and its doctors can no longer sign in. Their appointments and case sheets are kept and come back if you switch it back.'
            : 'Only the label changes; nothing else does.',
        confirmLabel: 'Change type', danger: fromClinic,
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      await api(`/api/platform/businesses/${id}/details`, { method: 'PATCH', body: { name: name.trim(), industry } });
      onSaved('Business details saved');
    } catch (e) { showToast(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Card title="Business details" icon={Building2} right={<button disabled={busy || !changed} onClick={save} className={btnSecondary}>{busy ? 'Saving…' : 'Save'}</button>}>
      <div className="grid sm:grid-cols-2 gap-2 text-xs" data-testid="business-details">
        <label className="flex flex-col gap-1">Business name
          <input value={name} onChange={e => setName(e.target.value)} maxLength={80} className={inputInlineCls} aria-label="Business name" />
        </label>
        <label className="flex flex-col gap-1">Business type
          <select value={industry} onChange={e => setIndustry(e.target.value)} className={inputInlineCls} aria-label="Business type">
            {Object.entries(INDUSTRY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </div>
      <p className="text-xs text-slate-500 mt-2">Healthcare turns on the Clinic tools (doctors, appointments, payments) and Meta's healthcare ad rules.</p>
    </Card>
  );
}

export function BusinessDrawer({ id, plans, onClose, onChanged, showToast, canEdit = true, canResendInvite = false, canEditDetails = canEdit }: BusinessDrawerProps) {
  const confirm = useConfirm();
  const [d, setD] = useState<BusinessDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  // Override inputs as typed: '' = use the plan, 'unlimited', a number, or 'true'/'false' for the switches.
  const [ov, setOv] = useState<Record<string, string> | null>(null);

  const load = useCallback(() => api<BusinessDetail>(`/api/platform/businesses/${id}`)
    .then(r => {
      setD(r); setError('');
      const o: Record<string, unknown> = r.business.limit_overrides || {};
      setOv(Object.fromEntries([...LIMIT_LABELS.map(([k]) => [k, k in o ? (o[k] === null ? 'unlimited' : String(o[k])) : '']), ['ai_enabled', 'ai_enabled' in o ? String(o.ai_enabled) : ''], ['ads_enabled', 'ads_enabled' in o ? String(o.ads_enabled) : '']]));
    })
    .catch(e => setError(errorMessage(e))), [id]);
  useEffect(() => { load(); }, [load]);

  const patch = async (body: Record<string, unknown>, msg: string) => {
    setBusy('patch');
    try { await api(`/api/platform/businesses/${id}`, { method: 'PATCH', body }); showToast(msg); await load(); onChanged(); } catch (e) { showToast(errorMessage(e)); } finally { setBusy(''); }
  };
  const saveOverrides = () => {
    if (!ov) return;
    const out: Record<string, number | boolean | null> = {};
    for (const [k, v] of Object.entries(ov)) {
      if (v === '') continue;
      if (k === 'ai_enabled' || k === 'ads_enabled') out[k] = v === 'true';
      else if (v.toLowerCase() === 'unlimited') out[k] = null;
      else if (/^\d+$/.test(v)) out[k] = Number(v);
      else { showToast(`${LIMIT_LABELS.find(([x]) => x === k)?.[1] || k}: type a whole number or "unlimited".`); return; }
    }
    patch({ limitOverrides: out }, 'Limit overrides saved');
  };
  const checkWa = async () => {
    setBusy('wa');
    try {
      const r = await api<{ ok: boolean; qualityRating?: string | null; messagingTier?: string | null; checkError?: string }>(`/api/platform/businesses/${id}/check-whatsapp`, { method: 'POST' });
      showToast(r.ok ? `Quality ${r.qualityRating || '?'} · tier ${r.messagingTier || '?'}` : `Check failed: ${r.checkError}`);
      await load();
    } catch (e) { showToast(errorMessage(e)); } finally { setBusy(''); }
  };
  const resendInvite = async () => {
    setBusy('invite');
    try {
      const r = await api<{ email: string; kind: 'invite' | 'reset' }>(`/api/platform/businesses/${id}/resend-invite`, { method: 'POST' });
      showToast(r.kind === 'reset' ? `${r.email} already has a login: a "set your password" email was sent.` : `Invite sent again to ${r.email}.`);
      await load();
    } catch (e) { showToast(errorMessage(e)); } finally { setBusy(''); }
  };

  const b = d?.business;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <div className="bg-slate-50 w-full max-w-2xl h-full overflow-y-auto p-4 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="text-base font-bold text-slate-800">{b?.name || 'Business'}</div>
          <button onClick={onClose} className="p-1 text-slate-500 hover:text-slate-900 cursor-pointer"><X className="w-5 h-5" /></button>
        </div>
        <Err msg={error} onRetry={load} />
        {!d && !error && <SkeletonRows rows={4} label="Loading the business" />}
        {d && b && (
          <>
            <div className="text-xs text-slate-500">{b.slug} · {INDUSTRY_LABEL[b.industry || 'general'] || b.industry} · created {new Date(b.created_at).toLocaleDateString()} by {b.created_by || '–'}</div>
            {canEditDetails && <DetailsCard key={`${b.name}|${b.industry}`} id={id} name={b.name} industry={b.industry || 'general'} onSaved={async (msg) => { showToast(msg); await load(); onChanged(); }} showToast={showToast} />}
            {d.alerts.length > 0 && <Card title="Alerts" icon={AlertTriangle}><AlertList alerts={d.alerts} /></Card>}

            <Card title="Plan and billing" icon={ScrollText}>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded-full ${b.status === 'suspended' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-800'}`}>{b.status}</span>
                {canEdit ? (
                  <>
                    <label className="flex items-center gap-1.5">Plan
                      <select value={b.plan_id} disabled={!!busy} onChange={e => patch({ planId: e.target.value }, `Plan changed to ${e.target.value}`)} className={inputInlineCls}>
                        {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </label>
                    <label className="flex items-center gap-1.5">Paid until
                      <input type="date" defaultValue={b.paid_until || ''} disabled={!!busy} onBlur={e => { if ((e.target.value || null) !== (b.paid_until || null)) patch({ paidUntil: e.target.value || null }, 'Payment date saved'); }} className={inputInlineCls} />
                    </label>
                  </>
                ) : <span>Plan: <b>{d.usage.planName}</b>{b.paid_until ? ` · paid until ${b.paid_until}` : ''}</span>}
                <span className="text-slate-500">Billing: <b>{d.usage.billing.state}</b>{d.usage.billing.suspendOn ? ` · pauses ${d.usage.billing.suspendOn}` : ''}</span>
                <div className="flex-1" />
                {canResendInvite && <button disabled={!!busy} onClick={resendInvite} className={btnSecondary}>{busy === 'invite' ? 'Sending…' : 'Resend owner invite'}</button>}
                {!canEdit ? null : b.status === 'suspended'
                  ? <button disabled={!!busy} onClick={() => patch({ status: 'active' }, `${b.name} is active again`)} className={btnSecondary}>Resume</button>
                  : <button disabled={!!busy} onClick={async () => { if (await confirm({ title: `Suspend ${b.name}?`, body: 'Staff are signed out within a minute and nothing is sent from their number until you resume them.', confirmLabel: 'Suspend', danger: true })) patch({ status: 'suspended' }, `${b.name} suspended`); }} className={btnSecondary}>Suspend</button>}
              </div>
            </Card>

            <Card title={`Usage vs limits (${d.usage.planName}, ${d.usage.period})`} icon={Activity}>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                {d.usage.metrics.map(m => (
                  <div key={m.key} className={`p-2 rounded border ${m.reached ? 'border-red-200 bg-red-50' : m.warning ? 'border-amber-200 bg-amber-50' : 'border-slate-100'}`}>
                    <div className="text-slate-500">{m.label}</div>
                    <div className="font-bold text-slate-800">{m.notIncluded ? 'not in plan' : `${num(m.used)} / ${m.limit === null ? '∞' : num(m.limit)}`}</div>
                  </div>
                ))}
              </div>
              <div className="text-xs text-slate-500 mt-2">Team: {d.staff.owner} admin · {d.staff.manager} managers · {d.staff.agent} agents</div>
            </Card>

            {ov && canEdit && (
              <Card title="Limit overrides for this business" icon={Activity} right={<button disabled={!!busy} onClick={saveOverrides} className={btnSecondary}>Save overrides</button>}>
                <p className="text-xs text-slate-500 mb-2">Empty = use the plan's value. Type a number, or "unlimited".</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {LIMIT_LABELS.map(([k, label]) => (
                    <label key={k} className="flex items-center justify-between gap-2">{label}
                      <input value={ov[k]} placeholder="plan" onChange={e => setOv(o => ({ ...o, [k]: e.target.value.trim() }))} className={`${inputInlineCls} w-24 text-right`} />
                    </label>
                  ))}
                  {[['ai_enabled', 'AI replies'], ['ads_enabled', 'Ads module']].map(([k, label]) => (
                    <label key={k} className="flex items-center justify-between gap-2">{label}
                      <select value={ov[k]} onChange={e => setOv(o => ({ ...o, [k]: e.target.value }))} className={inputInlineCls}>
                        <option value="">plan</option><option value="true">on</option><option value="false">off</option>
                      </select>
                    </label>
                  ))}
                </div>
              </Card>
            )}

            <Card title="Connections" icon={Webhook}>
              <div className="space-y-2 text-xs text-slate-700">
                <div className="flex items-start gap-2">
                  <Smartphone className="w-4 h-4 text-slate-500 mt-0.5" />
                  <div className="flex-1">
                    <b>WhatsApp:</b> {d.whatsapp.connected ? `connected (${d.whatsapp.source})${d.whatsapp.phoneNumber ? ` · +${d.whatsapp.phoneNumber}` : ''}` : 'not connected'}
                    {d.whatsapp.connected && <div className="text-slate-500">Token {d.whatsapp.tokenLast4 ? `••••${d.whatsapp.tokenLast4}` : ''} {d.whatsapp.tokenReadable ? 'readable' : <b className="text-red-700">unreadable</b>} · App secret {d.whatsapp.hasAppSecret ? 'saved' : <b className="text-amber-700">missing</b>} · connected {d.whatsapp.connectedAt ? new Date(d.whatsapp.connectedAt).toLocaleDateString() : '–'}</div>}
                    <div className="text-slate-500">Quality {d.whatsapp.qualityRating || '–'} · tier {d.whatsapp.messagingTier || '–'} · checked {ago(d.whatsapp.checkedAt)}{d.whatsapp.checkError && <span className="text-red-700"> · {d.whatsapp.checkError}</span>}</div>
                    <div className="text-slate-500">Webhook last received {ago(d.webhook?.lastReceivedAt)} · last bad signature {ago(d.webhook?.lastSignatureFailAt)} · send errors 24 h: {d.whatsapp.sendErrors24h ?? 0}</div>
                  </div>
                  {d.whatsapp.connected && <button disabled={!!busy} onClick={checkWa} className={btnSecondary}>{busy === 'wa' ? 'Checking…' : 'Check WhatsApp now'}</button>}
                </div>
                <div className="flex items-start gap-2"><Megaphone className="w-4 h-4 text-slate-500 mt-0.5" />
                  <div><b>Ads:</b> {d.ads.connected ? <>last sync {ago(d.ads.lastSyncAt)}{d.ads.lastSyncError ? <span className="text-red-700"> · {d.ads.lastSyncError}</span> : ' · ok'}</> : 'not connected'}</div>
                </div>
                <div className="flex items-start gap-2"><Bot className="w-4 h-4 text-slate-500 mt-0.5" />
                  <div><b>AI:</b> {d.ai.configured ? `${d.ai.provider} · ${d.ai.model}${d.ai.keyReadable === false ? ' · key unreadable' : ''} · ${d.ai.errors24h} errors in 24 h` : 'not set up'}</div>
                </div>
              </div>
            </Card>

            {d.delivery && (
              <Card title="Delivery (7 days)" icon={Send}>
                <div className="text-xs text-slate-700">
                  {num(d.delivery.outbound)} sent · <span className={d.delivery.failedMessages ? 'text-red-700 font-semibold' : ''}>{num(d.delivery.failedMessages)} failed</span>{d.delivery.failureRate !== null && ` (${d.delivery.failureRate}%)`} ·
                  broadcasts {num(d.delivery.campaignSent)} sent, {num(d.delivery.campaignFailed)} failed, {num(d.delivery.campaignSkipped)} skipped ·
                  opt-outs {num(d.delivery.optOutsInPeriod)} (total {num(d.delivery.optedOutTotal)})
                </div>
              </Card>
            )}

            <Card title="Recent events" icon={ScrollText}>
              {d.recentEvents.length === 0 ? <div className="text-xs text-slate-500">None.</div> : (
                <ul className="space-y-1 text-xs">
                  {d.recentEvents.map(e => <li key={e.id} className="flex gap-2"><span className="text-slate-400 w-32 shrink-0">{when(e.created_at)}</span><Level level={e.level} /><code className="text-slate-500">{e.source}/{e.code}</code><span className="flex-1 truncate" title={e.message}>{e.message}</span>{e.count > 1 && <span>×{e.count}</span>}</li>)}
                </ul>
              )}
            </Card>
            <Card title="Recent changes" icon={History}>
              {d.recentAudit.length === 0 ? <div className="text-xs text-slate-500">None.</div> : (
                <ul className="space-y-1 text-xs">
                  {d.recentAudit.map(a => <li key={a.id} className="flex flex-wrap gap-2"><span className="text-slate-400 w-32 shrink-0">{when(a.created_at)}</span><code className="font-semibold">{a.action}</code><span className="text-slate-500">{a.actor_email}</span></li>)}
                </ul>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
