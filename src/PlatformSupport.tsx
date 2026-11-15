import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { LifeBuoy, X, Send, Lock, AlertTriangle, RefreshCw } from 'lucide-react';
import { api, errorMessage, inputCls, inputInlineCls, btnPrimary } from './broadcastUtils';
import {
  QUERY_STAGES, OPEN_QUERY_STAGES, QUERY_STAGE_INFO, QUERY_MOVES, PRIORITIES, PRIORITY_INFO, dueText, eventText, ago,
  type Priority, type Query, type QueryEvent, type QueryStage,
} from './queryUtils';
import { useVisiblePolling, REFRESH } from './usePolling';
import { LoadError, SkeletonRows, useEscape } from './ui';
import type { ShowToast } from './types';

/** A platform_queries row as the console sees it (the business's name is added by the server). */
interface SupportQuery extends Query {
  business_id: string;
  businessName?: string;
  raised_by_role?: string;
  escalated_from?: string | null;
}
interface SupportDetailData { query: SupportQuery; events?: QueryEvent[] }

const stageInfo = (s: string | undefined) => (s ? QUERY_STAGE_INFO[s as QueryStage] : undefined) as { label: string; cls: string } | undefined;
const priorityInfo = (p: string | undefined) => (p ? PRIORITY_INFO[p as Priority] : undefined) as { label: string; cls: string } | undefined;
const OPEN_STAGE_NAMES: string[] = OPEN_QUERY_STAGES;

/**
 * Platform console, Support tab: what businesses' staff sent to Platform support.
 * Only platform_queries are visible here, never a business's customers, chats or own queries.
 */
export default function PlatformSupport({ me, showToast }: { me: { email: string }; showToast: ShowToast }) {
  const [rows, setRows] = useState<SupportQuery[] | null>(null);
  const [error, setError] = useState('');
  const [stage, setStage] = useState('open');
  const [biz, setBiz] = useState('');
  // Mine / Unassigned / everyone's (like the inbox).
  const [who, setWho] = useState<'all' | 'mine' | 'unassigned'>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(() => api<{ queries?: SupportQuery[] }>('/api/platform/support').then(d => { setRows(d.queries || []); setError(''); }).catch(e => setError(errorMessage(e))), []);
  useEffect(() => { load(); }, [load]);
  useVisiblePolling(load, REFRESH.queries);

  const myEmail = String(me.email || '').toLowerCase();
  const businesses = useMemo(() => [...new Map((rows || []).map(q => [q.business_id, q.businessName])).entries()], [rows]);
  const shown = (rows || []).filter(q => (stage === 'all' || (stage === 'open' ? OPEN_STAGE_NAMES.includes(q.stage) : q.stage === stage)) && (!biz || q.business_id === biz)
    && (who === 'all' || (who === 'mine' ? String(q.assigned_to || '').toLowerCase() === myEmail : !q.assigned_to)));
  const overdue = (rows || []).filter(q => q.overdue).length;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2"><LifeBuoy className="w-5 h-5 text-slate-700" /> Support ({(rows || []).filter(q => OPEN_STAGE_NAMES.includes(q.stage)).length} open{overdue ? `, ${overdue} overdue` : ''})</h1>
        <div className="flex-1" />
        <div className="flex rounded-full border border-slate-200 overflow-hidden" role="group" aria-label="Whose queries">
          {([['all', 'All'], ['mine', 'Mine'], ['unassigned', 'Unassigned']] as const).map(([v, l]) => (
            <button key={v} onClick={() => setWho(v)} aria-pressed={who === v}
              className={`px-3 py-1 text-xs font-semibold cursor-pointer ${who === v ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>{l}</button>
          ))}
        </div>
        <select value={stage} onChange={e => setStage(e.target.value)} className={inputInlineCls} aria-label="Stage">
          <option value="open">Open</option><option value="all">All</option>
          {QUERY_STAGES.map(s => <option key={s} value={s}>{QUERY_STAGE_INFO[s].label}</option>)}
        </select>
        <select value={biz} onChange={e => setBiz(e.target.value)} className={inputInlineCls}>
          <option value="">All businesses</option>
          {businesses.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <button onClick={load} className="p-1 text-slate-500 hover:text-slate-800 cursor-pointer" title="Refresh"><RefreshCw className="w-4 h-4" /></button>
      </div>
      {error && <LoadError error={error} onRetry={load} />}
      {!rows && !error && <SkeletonRows rows={4} label="Loading" />}
      {rows && shown.length === 0 && <div className="bg-white border border-slate-200 rounded-xl p-6 text-center text-sm text-slate-500">Nothing here.</div>}
      {shown.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
          {shown.map(q => (
            <button key={q.id} onClick={() => setOpenId(q.id)} className="w-full text-left px-3 py-2.5 hover:bg-slate-50 cursor-pointer flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-1">
              <span className="text-xs font-bold text-slate-500 w-14">{q.ref}</span>
              <span className={`text-xs px-1.5 py-px rounded border font-semibold ${stageInfo(q.stage)?.cls}`}>{stageInfo(q.stage)?.label}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-slate-800 truncate">{q.subject}</span>
                <span className="block text-xs text-slate-500 truncate">{q.businessName} · {q.category} · {q.raised_by_email} ({q.raised_by_role === 'owner' ? 'Admin' : q.raised_by_role}){q.escalated_from ? ' · escalated by the business' : ''}</span>
              </span>
              <span className={`text-xs w-14 text-right ${priorityInfo(q.priority)?.cls}`}>{priorityInfo(q.priority)?.label}</span>
              <span className={`text-xs w-28 text-right ${q.overdue ? 'text-red-700 font-semibold' : 'text-slate-500'}`}>{q.overdue && <AlertTriangle className="w-3 h-3 inline mr-0.5 -mt-0.5" />}{dueText(q) || (q.created_at ? ago(q.created_at) : '')}</span>
            </button>
          ))}
        </div>
      )}
      {openId && <SupportDetail id={openId} me={me} showToast={showToast} onChanged={load} onClose={() => setOpenId(null)} />}
    </>
  );
}

interface SupportDetailProps { id: string; me: { email: string }; showToast: ShowToast; onChanged: () => void; onClose: () => void }

function SupportDetail({ id, me, showToast, onChanged, onClose }: SupportDetailProps) {
  const [d, setD] = useState<SupportDetailData | null>(null);
  const [text, setText] = useState('');
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  // Who it can be assigned to: Platform Owners and Application Managers (the server checks it too).
  const [assignees, setAssignees] = useState<Array<{ email: string; role: string }>>([]);
  const load = useCallback(() => api<SupportDetailData>(`/api/platform/support/${id}`).then(setD).catch(e => { showToast(errorMessage(e)); onClose(); }), [id, showToast, onClose]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api<{ assignees?: Array<{ email: string; role: string }> }>('/api/platform/support-assignees').then(r => setAssignees(r.assignees || [])).catch(() => setAssignees([])); }, []);

  const patch = async (body: Record<string, unknown>, msg?: string) => {
    setBusy(true);
    try { const r = await api<SupportDetailData>(`/api/platform/support/${id}`, { method: 'PATCH', body }); setD(r); onChanged(); if (msg) showToast(msg); return true; } catch (e) { showToast(errorMessage(e)); return false; } finally { setBusy(false); }
  };

  if (!d) return <Panel onClose={onClose}><div className="p-4"><SkeletonRows rows={4} label="Loading the query" /></div></Panel>;
  const q = d.query;
  return (
    <Panel onClose={onClose}>
      <div className="px-5 pt-4 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2 pr-8 text-xs">
          <b className="text-slate-500">{q.ref}</b>
          <span className={`px-1.5 py-0.5 rounded border font-semibold ${stageInfo(q.stage)?.cls}`}>{stageInfo(q.stage)?.label}</span>
          <span className={priorityInfo(q.priority)?.cls}>{priorityInfo(q.priority)?.label}</span>
          <span className={q.overdue ? 'text-red-700 font-semibold' : 'text-slate-500'}>{dueText(q)}</span>
        </div>
        <h2 className="text-base font-bold text-slate-800 mt-1">{q.subject}</h2>
        <div className="text-xs text-slate-500 mt-1">{q.businessName} · {q.category} · {q.raised_by_email} · {q.created_at ? new Date(q.created_at).toLocaleString() : ''}</div>
        {q.description && <p className="mt-2 text-xs text-slate-700 whitespace-pre-wrap bg-slate-50 rounded-lg p-2 border border-slate-100">{q.description}</p>}
        {q.rating && <div className="mt-1 text-xs text-slate-600">Rating: {'★'.repeat(q.rating)}{'☆'.repeat(5 - q.rating)}</div>}
      </div>
      <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap gap-2 text-xs">
        <select value="" disabled={busy} onChange={e => e.target.value && patch({ stage: e.target.value }, `Moved to ${stageInfo(e.target.value)?.label}`)} className={inputInlineCls}>
          <option value="">Move to…</option>
          {(QUERY_MOVES[q.stage as QueryStage] || []).filter(s => s !== 'escalated').map(s => <option key={s} value={s}>{QUERY_STAGE_INFO[s].label}</option>)}
        </select>
        <select value={q.priority} disabled={busy} onChange={e => patch({ priority: e.target.value }, 'Priority changed')} className={inputInlineCls}>
          {PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_INFO[p].label}</option>)}
        </select>
        {q.assigned_to !== String(me.email || '').toLowerCase() && <button disabled={busy} onClick={() => patch({ assignedTo: me.email }, 'Assigned to you')} className="px-2 py-1 border border-slate-200 rounded-md cursor-pointer">Take it</button>}
        <label className="flex items-center gap-1 text-slate-500">Assigned
          <select value={q.assigned_to || ''} disabled={busy} aria-label="Assign to"
            onChange={e => patch({ assignedTo: e.target.value || null }, e.target.value ? `Assigned to ${e.target.value}` : 'Unassigned')} className={inputInlineCls}>
            <option value="">nobody</option>
            {q.assigned_to && !assignees.some(a => a.email === q.assigned_to) && <option value={q.assigned_to}>{q.assigned_to}</option>}
            {assignees.map(a => <option key={a.email} value={a.email}>{a.email}{a.role === 'owner' ? ' (owner)' : ''}</option>)}
          </select>
        </label>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
        {(d.events || []).map(e => (
          <div key={e.id} className={`text-xs rounded-lg ${e.body ? `p-2 border ${e.visibility === 'platform' ? 'bg-amber-50/60 border-amber-200' : 'bg-white border-slate-200'}` : 'px-2'}`}>
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              {e.visibility === 'platform' && <Lock className="w-3 h-3 text-amber-600" />}
              <b className="text-slate-700">{e.author_role === 'platform_admin' ? 'Platform support' : e.author_email || 'System'}</b>
              <span>· {eventText(e)}</span><span className="ml-auto">{e.created_at ? ago(e.created_at) : ''}</span>
            </div>
            {e.body && <div className="mt-1 text-slate-800 whitespace-pre-wrap">{e.body}</div>}
          </div>
        ))}
      </div>
      <form onSubmit={async e => { e.preventDefault(); if (text.trim() && await patch({ body: text, visibility: internal ? 'platform' : 'all' }, internal ? 'Note saved' : 'Reply sent')) setText(''); }} className="border-t border-slate-200 px-5 py-3 space-y-2 bg-slate-50">
        <textarea rows={2} value={text} onChange={e => setText(e.target.value)} placeholder={internal ? 'Only platform admins see this' : 'Reply to the business'} className={`${inputCls} text-xs`} />
        <div className="flex items-center gap-3">
          <button type="submit" disabled={busy || !text.trim()} className={btnPrimary}><Send className="w-3.5 h-3.5" /> Send</button>
          <label className="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" checked={internal} onChange={e => setInternal(e.target.checked)} /> Internal note</label>
        </div>
      </form>
    </Panel>
  );
}

function Panel({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEscape(onClose);
  return (
    <div className="fixed inset-0 bg-black/30 z-40 flex justify-end" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Support query" className="bg-white w-full max-w-xl h-full shadow-2xl flex flex-col relative">
        <button onClick={onClose} className="absolute right-3 top-3 text-slate-400 hover:text-slate-700 cursor-pointer" aria-label="Close"><X className="w-5 h-5" /></button>
        {children}
      </div>
    </div>
  );
}
