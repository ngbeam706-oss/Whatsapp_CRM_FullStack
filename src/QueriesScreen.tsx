import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardList, Users, LifeBuoy, BarChart3, Settings, AlertTriangle, LayoutList, Columns3, RefreshCw, Plus, Save, type LucideIcon } from 'lucide-react';
import { api, errorMessage, inputCls, inputInlineCls, btnPrimary, btnSecondary } from './broadcastUtils';
import {
  QUERY_STAGES, OPEN_QUERY_STAGES, QUERY_STAGE_INFO, PRIORITIES, PRIORITY_INFO, SOURCE_LABEL, ADDRESSED_LABEL, dueText, ago,
  type Priority, type Query, type QuerySettings as QuerySettingsData, type QueryStage,
} from './queryUtils';
import { REFRESH } from './usePolling';
import { useApi, errorOf } from './queryClient';
import BroadcastGuide from './BroadcastGuide';
import QueryDetail from './QueryDetail';
import type { Me, Role, ShowToast } from './types';

type View = 'customer' | 'team' | 'support' | 'insights' | 'settings';
type ListView = 'customer' | 'team' | 'support';
type CategoryKind = 'customer' | 'internal';
interface Counts { overdue: number; fresh: number }
interface Filters { stage: string; priority: string; category: string; who: string; overdue: boolean; team: string }
/** One kind's numbers from GET /api/queries/stats (server/queries.cjs summarize). */
interface KindStats {
  total: number; open: number; overdue: number; avgFirstResponseHours: number | null; avgResolutionHours: number | null;
  resolvedOnTimePct: number | null; avgRating?: number | null; ratings?: number;
  byCategory: Record<string, number>; byStage: Record<string, number>; bySource: Record<string, number>; byPriority: Record<string, number>;
}
interface QueryStats {
  days: number; customer: KindStats; team: KindStats;
  openNow: { customer: number; team: number }; overdueNow: { customer: number; team: number };
}

const NO_ROWS: Query[] = [];
const LIST_VIEWS: ListView[] = ['customer', 'team', 'support'];
const isListView = (v: View): v is ListView => (LIST_VIEWS as View[]).includes(v);

const isManager = (role: Role | string) => role === 'owner' || role === 'manager';
/** Label + colour for a stage or priority that may be missing or unknown (undefined then). */
const stageInfo = (s: string | undefined) => (s ? QUERY_STAGE_INFO[s as QueryStage] : undefined) as { label: string; cls: string } | undefined;
const priorityInfo = (p: string | undefined) => (p ? PRIORITY_INFO[p as Priority] : undefined) as { label: string; cls: string } | undefined;
const OPEN_STAGE_NAMES: string[] = OPEN_QUERY_STAGES;

interface QueriesScreenProps {
  me: Me; showToast: ShowToast; onOpenChat?: (phone: string) => void; onRaise: () => void;
  /** Open this query's detail (from Home or search); cleared with onOpenQueryHandled. */
  openQueryId?: string | null; onOpenQueryHandled?: () => void;
}

/** Queries: customer queries, team queries, Platform support, numbers and settings. */
export default function QueriesScreen({ me, showToast, onOpenChat, onRaise, openQueryId, onOpenQueryHandled }: QueriesScreenProps) {
  const [view, setView] = useState<View>('customer');
  const [open, setOpen] = useState<{ id: string; kind: 'query' | 'support' } | null>(null);
  useEffect(() => {
    if (!openQueryId) return undefined;
    const t = setTimeout(() => { setOpen({ id: openQueryId, kind: 'query' }); onOpenQueryHandled?.(); }, 0);
    return () => clearTimeout(t);
  }, [openQueryId, onOpenQueryHandled]);
  const [counts, setCounts] = useState<Partial<Record<View, Counts>>>({});

  const views: Array<[View, string, LucideIcon]> = [
    ['customer', 'Customer queries', ClipboardList],
    ['team', 'Team queries', Users],
    ['support', 'Platform support', LifeBuoy],
    ...(isManager(me.role) ? [['insights', 'Numbers', BarChart3] as [View, string, LucideIcon]] : []),
    ...(me.role === 'owner' ? [['settings', 'Settings', Settings] as [View, string, LucideIcon]] : []),
  ];

  return (
    <div className="flex-1 overflow-y-auto bg-slate-100">
      <div className="max-w-6xl mx-auto px-4 py-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2 mr-2"><ClipboardList className="w-5 h-5 text-wa-teal" /> Queries</h1>
          <div className="bg-white border border-slate-200 p-0.5 rounded-lg flex flex-wrap">
            {views.map(([id, label, Icon]) => (
              <button key={id} onClick={() => setView(id)} className={`px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${view === id ? 'bg-wa-teal text-white' : 'text-slate-600 hover:text-slate-900'}`}>
                <Icon className="w-3.5 h-3.5" /> {label}
                {(counts[id]?.overdue ?? 0) > 0 && <span className="bg-red-600 text-white rounded-full px-1.5 text-2xs" title="Overdue">{counts[id]?.overdue}</span>}
                {!counts[id]?.overdue && (counts[id]?.fresh ?? 0) > 0 && <span className="bg-sky-600 text-white rounded-full px-1.5 text-2xs" title="New">{counts[id]?.fresh}</span>}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <button onClick={onRaise} className={btnPrimary}><Plus className="w-3.5 h-3.5" /> Raise a query</button>
        </div>

        <BroadcastGuide topic="queries" />

        {isListView(view) && (
          <QueryList key={view} view={view} me={me} onOpen={(id) => setOpen({ id, kind: view === 'support' ? 'support' : 'query' })}
            onCounts={(c) => setCounts(prev => ({ ...prev, [view]: c }))} reloadSignal={open} />
        )}
        {view === 'insights' && <Insights />}
        {view === 'settings' && <QuerySettings showToast={showToast} />}
      </div>

      {open && (
        <QueryDetail id={open.id} kind={open.kind} me={me} showToast={showToast}
          onOpenChat={onOpenChat ? (phone) => { setOpen(null); onOpenChat(phone); } : undefined}
          onClose={() => setOpen(null)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
interface QueryListProps {
  view: ListView; me: Me; onOpen: (id: string) => void; onCounts: (c: Counts) => void; reloadSignal: unknown;
}

function QueryList({ view, me, onOpen, onCounts, reloadSignal }: QueryListProps) {
  const [layout, setLayout] = useState<'list' | 'board'>('list');
  const [f, setF] = useState<Filters>({ stage: 'open', priority: '', category: '', who: '', overdue: false, team: 'all' });

  const listQuery = useApi<{ queries?: Query[] }>(view === 'support' ? '/api/support' : `/api/queries?view=${view}`, { refetchInterval: REFRESH.queries });
  const rows = listQuery.data ? listQuery.data.queries || NO_ROWS : null;
  const error = errorOf(listQuery);
  const { refetch } = listQuery;
  const load = () => refetch();
  // Closing a query's detail panel may have changed it: refresh the list (not on first load).
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && reloadSignal === null) refetch();
    wasOpen.current = reloadSignal !== null;
  }, [reloadSignal, refetch]);

  useEffect(() => {
    if (!rows) return;
    onCounts({
      overdue: rows.filter(q => q.overdue).length,
      fresh: rows.filter(q => q.stage === 'new' || q.stage === 'reopened').length,
    });
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const meEmail = String(me.email || '').toLowerCase();
  const categories = useMemo(() => [...new Set((rows || []).map(q => q.category).filter((c): c is string => !!c))].sort(), [rows]);
  const shown = useMemo(() => (rows || []).filter(q => {
    if (f.stage === 'open' && !OPEN_STAGE_NAMES.includes(q.stage)) return false;
    if (f.stage && f.stage !== 'open' && f.stage !== 'all' && q.stage !== f.stage) return false;
    if (f.priority && q.priority !== f.priority) return false;
    if (f.category && q.category !== f.category) return false;
    if (f.overdue && !q.overdue) return false;
    if (f.who === 'mine' && String(q.assigned_to || '').toLowerCase() !== meEmail) return false;
    if (f.who === 'unassigned' && q.assigned_to) return false;
    if (view === 'team' && f.team === 'raised' && String(q.raised_by_email || '').toLowerCase() !== meEmail) return false;
    if (view === 'team' && f.team === 'forme' && String(q.raised_by_email || '').toLowerCase() === meEmail) return false;
    return true;
  }), [rows, f, meEmail, view]);

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF(prev => ({ ...prev, [k]: v }));
  const intro = {
    customer: 'Questions and complaints from your customers: raised by them on WhatsApp, by the AI handing a chat to staff, or by your team from a chat.',
    team: me.role === 'owner' ? 'Questions your team raised for managers or for you.' : me.role === 'manager' ? 'Questions raised for managers, and the ones you raised for the Business Admin.' : 'Questions you raised for managers or the Business Admin.',
    support: me.role === 'owner' ? 'Everything your business sent to Platform support (problems with the app, WhatsApp connection, plan).' : 'What you sent to Platform support. Your Business Admin sees these too.',
  }[view];

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">{intro}</p>
      <div className="bg-white border border-slate-200 rounded-xl px-3 py-2 flex flex-wrap items-center gap-2 text-xs">
        <select value={f.stage} onChange={e => set('stage', e.target.value)} className={inputInlineCls}>
          <option value="open">Open</option>
          <option value="all">All stages</option>
          {QUERY_STAGES.map(s => <option key={s} value={s}>{QUERY_STAGE_INFO[s].label}</option>)}
        </select>
        <select value={f.priority} onChange={e => set('priority', e.target.value)} className={inputInlineCls}>
          <option value="">Any priority</option>
          {PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_INFO[p].label}</option>)}
        </select>
        <select value={f.category} onChange={e => set('category', e.target.value)} className={inputInlineCls}>
          <option value="">Any category</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {view !== 'support' && (
          // Quick chips (U2): one tap to "mine" or "nobody's yet".
          <div className="flex rounded-full border border-slate-200 overflow-hidden" role="group" aria-label="Whose queries">
            {([['', 'Anyone'], ['mine', 'Mine'], ['unassigned', 'Unassigned']] as const).map(([v, l]) => (
              <button key={v} onClick={() => set('who', v)} aria-pressed={f.who === v}
                className={`px-3 py-1 text-xs font-semibold cursor-pointer ${f.who === v ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>{l}</button>
            ))}
          </div>
        )}
        {view === 'team' && me.role !== 'agent' && (
          <select value={f.team} onChange={e => set('team', e.target.value)} className={inputInlineCls}>
            <option value="all">Raised by me + for me</option>
            <option value="forme">For me / my role</option>
            <option value="raised">Raised by me</option>
          </select>
        )}
        <label className="flex items-center gap-1 text-slate-600"><input type="checkbox" checked={f.overdue} onChange={e => set('overdue', e.target.checked)} /> Overdue only</label>
        <div className="flex-1" />
        <span className="text-slate-400">{shown.length} shown</span>
        <div className="flex border border-slate-200 rounded-md overflow-hidden">
          <button onClick={() => setLayout('list')} title="List" className={`p-1 cursor-pointer ${layout === 'list' ? 'bg-slate-200' : ''}`}><LayoutList className="w-4 h-4" /></button>
          <button onClick={() => setLayout('board')} title="Board by stage" className={`p-1 cursor-pointer ${layout === 'board' ? 'bg-slate-200' : ''}`}><Columns3 className="w-4 h-4" /></button>
        </div>
        <button onClick={load} title="Refresh" className="p-1 text-slate-500 hover:text-slate-800 cursor-pointer"><RefreshCw className="w-4 h-4" /></button>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>}
      {!rows && !error && <div className="text-sm text-slate-500">Loading…</div>}
      {rows && shown.length === 0 && <div className="bg-white border border-slate-200 rounded-xl p-6 text-center text-sm text-slate-500">No queries here. {f.stage === 'open' ? 'Nothing open: well done!' : ''}</div>}

      {rows && shown.length > 0 && layout === 'list' && (
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
          {shown.map(q => <Row key={q.id} q={q} view={view} onOpen={onOpen} />)}
        </div>
      )}
      {rows && shown.length > 0 && layout === 'board' && (
        <div className="flex gap-2 overflow-x-auto pb-2">
          {(f.stage === 'open' ? OPEN_QUERY_STAGES : QUERY_STAGES).map(s => {
            const col = shown.filter(q => q.stage === s);
            return (
              <div key={s} className="w-56 flex-shrink-0 bg-slate-50 border border-slate-200 rounded-xl p-2">
                <div className="text-xs font-bold text-slate-600 mb-2 flex items-center gap-1">
                  <span className={`px-1.5 py-px rounded border ${QUERY_STAGE_INFO[s].cls}`}>{QUERY_STAGE_INFO[s].label}</span>
                  <span className="text-slate-400">{col.length}</span>
                </div>
                <div className="space-y-1.5">
                  {col.map(q => (
                    <button key={q.id} onClick={() => onOpen(q.id)} className="w-full text-left bg-white border border-slate-200 rounded-lg p-2 hover:border-wa-teal cursor-pointer">
                      <div className="flex items-center gap-1 text-xs">
                        <b className="text-slate-500">{q.ref}</b>
                        {q.overdue && <AlertTriangle className="w-3 h-3 text-red-600" />}
                        <span className={`ml-auto ${priorityInfo(q.priority)?.cls}`}>{priorityInfo(q.priority)?.label}</span>
                      </div>
                      <div className="text-xs text-slate-800 mt-0.5 line-clamp-2">{q.subject}</div>
                      <div className="text-xs text-slate-400 mt-0.5">{q.assigned_to || 'unassigned'}</div>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Row({ q, view, onOpen }: { q: Query; view: ListView; onOpen: (id: string) => void }) {
  const due = dueText(q);
  return (
    <button onClick={() => onOpen(q.id)} className="w-full text-left px-3 py-2.5 hover:bg-slate-50 cursor-pointer flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-1">
      <span className="text-xs font-bold text-slate-500 w-14 flex-shrink-0">{q.ref}</span>
      <span className={`text-xs px-1.5 py-px rounded border font-semibold flex-shrink-0 ${stageInfo(q.stage)?.cls}`}>{stageInfo(q.stage)?.label}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm text-slate-800 truncate">{q.subject}</span>
        <span className="block text-xs text-slate-500 truncate">
          {[q.category,
            view === 'customer' && q.contact_phone ? `+${q.contact_phone}` : null,
            view === 'customer' && q.source ? SOURCE_LABEL[q.source] : null,
            view === 'team' ? `${q.raised_by_email} → ${q.addressed_to ? ADDRESSED_LABEL[q.addressed_to] : undefined}` : null,
            view !== 'support' ? (q.assigned_to || 'unassigned') : null,
          ].filter(Boolean).join(' · ')}
        </span>
      </span>
      <span className={`text-xs w-14 text-right flex-shrink-0 ${priorityInfo(q.priority)?.cls}`}>{priorityInfo(q.priority)?.label}</span>
      <span className={`text-xs w-28 text-right flex-shrink-0 ${q.overdue ? 'text-red-700 font-semibold' : 'text-slate-500'}`}>
        {q.overdue && <AlertTriangle className="w-3 h-3 inline mr-0.5 -mt-0.5" />}{due || (q.created_at ? ago(q.created_at) : '')}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
function Insights() {
  const [days, setDays] = useState(30);
  const stats = useApi<QueryStats>(`/api/queries/stats?days=${days}`, { keepPrevious: true, staleTime: 60000 });
  const d = stats.data || null;
  const error = errorOf(stats);

  if (error) return <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>;
  if (!d) return <div className="text-sm text-slate-500">Loading…</div>;
  const hrs = (h: number | null | undefined) => (h === null || h === undefined ? '–' : h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${h} h` : `${Math.round(h / 24 * 10) / 10} days`);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-slate-600">
        Queries raised in the last
        <select value={days} onChange={e => setDays(Number(e.target.value))} className={inputInlineCls}>
          {[7, 30, 90, 365].map(n => <option key={n} value={n}>{n} days</option>)}
        </select>
        {d.days < days && <span className="text-amber-700">(your plan shows up to {d.days} days)</span>}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Tile label="Open customer queries now" value={d.openNow.customer} />
        <Tile label="Overdue now" value={d.overdueNow.customer + d.overdueNow.team} warn={d.overdueNow.customer + d.overdueNow.team > 0} />
        <Tile label="Open team queries now" value={d.openNow.team} />
        <Tile label="Customer satisfaction" value={d.customer.avgRating ? `${d.customer.avgRating}/5` : '–'} hint={`${d.customer.ratings} ratings`} />
      </div>
      {([['customer', 'Customer queries'], ['team', 'Team queries']] as const).map(([k, title]) => {
        const s = d[k];
        return (
          <div key={k} className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="text-sm font-semibold text-slate-800">{title}: {s.total} raised</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Tile small label="Average first response" value={hrs(s.avgFirstResponseHours)} />
              <Tile small label="Average time to resolve" value={hrs(s.avgResolutionHours)} />
              <Tile small label="Resolved on time" value={s.resolvedOnTimePct === null ? '–' : `${s.resolvedOnTimePct}%`} />
              <Tile small label="Still open" value={s.open} hint={s.overdue ? `${s.overdue} overdue` : ''} warn={s.overdue > 0} />
            </div>
            <div className="grid md:grid-cols-3 gap-3">
              <Bars title="By category" data={s.byCategory} />
              <Bars title="By stage" data={Object.fromEntries(Object.entries(s.byStage).map(([st, n]) => [QUERY_STAGE_INFO[st as QueryStage]?.label || st, n]))} />
              {k === 'customer'
                ? <Bars title="Raised through" data={Object.fromEntries(Object.entries(s.bySource).map(([st, n]) => [SOURCE_LABEL[st] || st, n]))} />
                : <Bars title="By priority" data={Object.fromEntries(Object.entries(s.byPriority).map(([st, n]) => [PRIORITY_INFO[st as Priority]?.label || st, n]))} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface TileProps { label: string; value: string | number; hint?: string; warn?: boolean; small?: boolean }

function Tile({ label, value, hint, warn, small }: TileProps) {
  return (
    <div className={`bg-white border rounded-xl ${small ? 'p-2.5' : 'p-3'} ${warn ? 'border-red-200' : 'border-slate-200'}`}>
      <div className={`${small ? 'text-base' : 'text-xl'} font-bold ${warn ? 'text-red-700' : 'text-slate-800'}`}>{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
      {hint && <div className="text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

function Bars({ title, data }: { title: string; data: Record<string, number> | null | undefined }) {
  const entries = Object.entries(data || {}).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, n]) => n));
  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-1.5">{title}</div>
      {entries.length === 0 && <div className="text-xs text-slate-400">No data yet</div>}
      <div className="space-y-1">
        {entries.map(([k, n]) => (
          <div key={k} className="text-xs">
            <div className="flex justify-between text-slate-600"><span className="truncate">{k === 'none' ? 'None' : k}</span><b className="text-slate-800">{n}</b></div>
            <div className="h-1.5 bg-slate-100 rounded"><div className="h-1.5 bg-wa-teal rounded" style={{ width: `${(n / max) * 100}%` }} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function QuerySettings({ showToast }: { showToast: ShowToast }) {
  const [s, setS] = useState<QuerySettingsData | null>(null);
  // Hours per priority, as typed (the server checks and converts them).
  const [hours, setHours] = useState<Record<Priority, number | string> | null>(null);
  const [newCat, setNewCat] = useState<Record<CategoryKind, string>>({ customer: '', internal: '' });
  const [busy, setBusy] = useState('');

  const load = useCallback(() => api<QuerySettingsData>('/api/queries/settings').then(r => { setS(r); setHours(r.dueHours); }).catch(e => showToast(errorMessage(e))), [showToast]);
  useEffect(() => { load(); }, [load]);

  const saveHours = async () => {
    setBusy('hours');
    try { await api('/api/queries/settings/due-hours', { method: 'PUT', body: hours }); showToast('Due times saved. They apply to new queries and priority changes.'); } catch (e) { showToast(errorMessage(e)); } finally { setBusy(''); }
  };
  const saveCat = async (kind: CategoryKind, name: string, active: boolean) => {
    setBusy(`${kind}:${name}`);
    try { await api('/api/queries/settings/categories', { method: 'POST', body: { kind, name, active } }); await load(); showToast(active ? `"${name}" is on` : `"${name}" switched off`); } catch (e) { showToast(errorMessage(e)); } finally { setBusy(''); }
  };

  if (!s || !hours) return <div className="text-sm text-slate-500">Loading…</div>;
  return (
    <div className="grid md:grid-cols-2 gap-3">
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
        <div className="text-sm font-semibold text-slate-800">Due times</div>
        <p className="text-xs text-slate-500">How soon a query must be resolved, by priority. After that it shows as overdue. While a query is "Waiting" (for the customer or someone else) the clock stops.</p>
        {PRIORITIES.slice().reverse().map(p => (
          <label key={p} className="flex items-center justify-between text-xs text-slate-700">{PRIORITY_INFO[p].label}
            <span className="flex items-center gap-1"><input type="number" min="0.5" max="720" step="0.5" value={hours[p]} onChange={e => setHours(h => (h ? { ...h, [p]: e.target.value } : h))} className={`${inputInlineCls} w-20 text-right`} /> hours</span>
          </label>
        ))}
        <button onClick={saveHours} disabled={busy === 'hours'} className={btnPrimary}><Save className="w-3.5 h-3.5" /> Save due times</button>
      </div>
      {([['customer', 'Customer query categories', 'Customers pick one of these on WhatsApp (up to 10 are shown).'], ['internal', 'Team query categories', 'Your staff pick one when they raise a query for managers or you.']] as const).map(([kind, title, hint]) => (
        <div key={kind} className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
          <div className="text-sm font-semibold text-slate-800">{title}</div>
          <p className="text-xs text-slate-500">{hint}</p>
          <div className="space-y-1">
            {(s.allCategories || []).filter(c => c.kind === kind).map(c => (
              <label key={c.name} className="flex items-center gap-2 text-xs text-slate-700">
                <input type="checkbox" checked={c.is_active} disabled={busy === `${kind}:${c.name}`} onChange={e => saveCat(kind, c.name, e.target.checked)} />
                <span className={c.is_active ? '' : 'text-slate-400 line-through'}>{c.name}</span>
              </label>
            ))}
          </div>
          <form onSubmit={e => { e.preventDefault(); if (newCat[kind].trim()) { saveCat(kind, newCat[kind].trim(), true); setNewCat(n => ({ ...n, [kind]: '' })); } }} className="flex gap-2">
            <input maxLength={40} value={newCat[kind]} onChange={e => setNewCat(n => ({ ...n, [kind]: e.target.value }))} placeholder="New category" className={`${inputCls} text-xs`} />
            <button type="submit" className={btnSecondary}><Plus className="w-3.5 h-3.5" /> Add</button>
          </form>
        </div>
      ))}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1 text-xs text-slate-600">
        <div className="text-sm font-semibold text-slate-800">Messages to customers outside 24 hours</div>
        <p>WhatsApp only allows free messages within 24 hours of the customer's last message. To tell customers about their query later (registered, replies, resolved), create a Utility template named <b>query_update</b> with one blank, for example: "Update on your query: {'{{1}}'}". Make it in Broadcasts, Templates. Without it, the query notes "customer not told" and you can reply when they next write.</p>
      </div>
    </div>
  );
}
