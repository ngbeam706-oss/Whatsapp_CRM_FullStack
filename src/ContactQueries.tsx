import React, { useState } from 'react';
import { ClipboardList, Plus, AlertTriangle } from 'lucide-react';
import { api, inputCls, btnPrimary, btnSecondary } from './broadcastUtils';
import { useApi, refreshApi } from './queryClient';
import { QUERY_STAGE_INFO, PRIORITIES, PRIORITY_INFO, dueText, type Priority, type Query, type QueryStage } from './queryUtils';
import QueryDetail from './QueryDetail';
import type { Me, ShowToast } from './types';
import { LoadError, SkeletonRows } from './ui';

const NO_QUERIES: Query[] = [];
const NO_CATS: string[] = [];
const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

interface Props {
  phone: string;
  me: Me;
  showToast: ShowToast;
}

/** Inbox side panel: this customer's queries, and "Raise query" for them. */
export default function ContactQueries({ phone, me, showToast }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ category: '', subject: '', description: '', priority: 'normal' as Priority, notify: true });
  const [busy, setBusy] = useState(false);

  const listQuery = useApi<{ queries?: Query[] }>(`/api/queries?phone=${encodeURIComponent(phone)}`);
  const list = listQuery.data ? listQuery.data.queries || NO_QUERIES : listQuery.error ? NO_QUERIES : null;
  // Categories only when the "Raise query" form opens (shared with the Queries screen).
  const cats = useApi<{ categories?: { customer?: string[] } }>('/api/queries/settings', { enabled: open, staleTime: 5 * 60000 }).data?.categories?.customer || NO_CATS;
  const load = () => refreshApi('/api/queries');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ query: Query }>('/api/queries', {
        method: 'POST',
        body: { kind: 'customer', contactPhone: phone, category: form.category || undefined, subject: form.subject, description: form.description, priority: form.priority, notifyCustomer: form.notify },
      });
      showToast(`Query ${r.query.ref} raised${form.notify ? ' and the customer was told' : ''}`);
      setForm({ category: '', subject: '', description: '', priority: 'normal', notify: true });
      setOpen(false);
      load();
    } catch (err) {
      showToast(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <div className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-1.5 flex items-center gap-1">
        <ClipboardList className="w-3 h-3" /> Queries
        {!open && <button onClick={() => setOpen(true)} className="ml-auto text-xs normal-case font-semibold text-wa-teal flex items-center gap-0.5 cursor-pointer"><Plus className="w-3 h-3" /> Raise query</button>}
      </div>

      {open && (
        <form onSubmit={submit} className="space-y-1.5 mb-2 bg-slate-50 border border-slate-200 rounded-lg p-2">
          <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className={`${inputCls} text-xs`}>
            <option value="">Category…</option>
            {cats.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <input required maxLength={120} value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} placeholder="Short subject, e.g. 'Report not received'" className={`${inputCls} text-xs`} />
          <textarea rows={2} maxLength={4000} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Details (optional)" className={`${inputCls} text-xs`} />
          <div className="flex items-center gap-2">
            <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value as Priority }))} className={`${inputCls} text-xs`}>
              {PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_INFO[p].label} priority</option>)}
            </select>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={form.notify} onChange={e => setForm(f => ({ ...f, notify: e.target.checked }))} /> Send the customer the query number on WhatsApp
          </label>
          <div className="flex gap-1.5">
            <button type="submit" disabled={busy || !form.subject.trim()} className={btnPrimary}>{busy ? 'Raising…' : 'Raise query'}</button>
            <button type="button" onClick={() => setOpen(false)} className={btnSecondary}>Cancel</button>
          </div>
        </form>
      )}

      {listQuery.error ? <LoadError error={listQuery.error.message} onRetry={() => listQuery.refetch()} />
        : list === null ? <SkeletonRows rows={2} label="Loading queries" />
        : list.length === 0 ? <div className="text-xs text-slate-400">No queries for this customer.</div>
        : (
          <div className="space-y-1.5">
            {list.slice(0, 8).map(q => (
              <button key={q.id} onClick={() => setOpenId(q.id)} className="w-full text-left border border-slate-200 rounded-lg p-2 hover:bg-slate-50 cursor-pointer">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-slate-500">{q.ref}</span>
                  <span className={`text-2xs px-1.5 py-px rounded border font-semibold ${QUERY_STAGE_INFO[q.stage as QueryStage]?.cls}`}>{QUERY_STAGE_INFO[q.stage as QueryStage]?.label}</span>
                  {q.overdue && <span title="Overdue"><AlertTriangle className="w-3 h-3 text-red-600" /></span>}
                  <span className={`ml-auto text-xs ${PRIORITY_INFO[q.priority as Priority]?.cls}`}>{PRIORITY_INFO[q.priority as Priority]?.label}</span>
                </div>
                <div className="text-xs text-slate-800 mt-0.5 line-clamp-2">{q.subject}</div>
                <div className="text-xs text-slate-400 mt-0.5">{dueText(q) || (q.created_at ? new Date(q.created_at).toLocaleDateString() : '')}</div>
              </button>
            ))}
          </div>
        )}
      {openId && <QueryDetail id={openId} me={me} showToast={showToast} onChanged={load} onClose={() => setOpenId(null)} />}
    </section>
  );
}
