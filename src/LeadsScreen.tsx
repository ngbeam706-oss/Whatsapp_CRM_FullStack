import { lazy, Suspense, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Contact, Download, Trash2, Search, X, UserPlus, FileSpreadsheet, IdCard } from 'lucide-react';
import { api, errorMessage, inputInlineCls } from './broadcastUtils';
import { apiFetch } from './apiClient';
import { refreshApi, useApi } from './queryClient';
import { useConfirm } from './confirm';
import { BUTTON, DialogLoading, Drawer, EmptyState, LoadError, Modal, PageHeader, SkeletonTable } from './ui';
import CustomerDetailsCard from './CustomerDetailsCard';
// The import wizard (and the Excel reader it loads) downloads only when opened.
const ImportCustomers = lazy(() => import('./ImportCustomers'));
import { displayName, shortTime } from './crmUtils';
import { useLeadStatuses, statusLook } from './leadStatuses';
import { MoreFilters } from './leadFilters';
import { NO_MORE_FILTERS, moreFilterParams, useStoredState, type MoreFilterValues } from './leadFilterUtils';
import AddLeadModal from './AddLeadModal';
import { ReturnedBadge, RenameButton } from './leadNames';
import { otherWaName, useRenameLead } from './leadNameUtils';
import type { Me, ShowToast, TeamResponse } from './types';

interface LeadRow {
  phone: string; name: string | null; stage: string; source: string | null; tags: string[] | null; assigned_to: string | null;
  created_at: string | null; last_contacted_at: string | null; opted_out: boolean | null; first_ad_headline: string | null; last_ad_headline: string | null;
  wa_name?: string | null; returned_at?: string | null; returned_after_days?: number | null; imported_at?: string | null;
}
interface SearchResult { total: number; leads: LeadRow[]; capped: boolean }
interface Filters extends MoreFilterValues { status: string; assignee: string; unread: boolean; closed: 'any' | 'open' | 'closed'; imported?: boolean }

const COLUMNS: Array<[string, string]> = [
  ['name', 'Name'], ['waName', 'WhatsApp name'], ['phone', 'Phone'], ['status', 'Status'], ['statusType', 'Status type'], ['source', 'Source'], ['ad', 'Ad'],
  ['tags', 'Tags'], ['assigned', 'Assigned to'], ['optedOut', 'Replied STOP'], ['created', 'Created'], ['lastMessage', 'Last message date'], ['notes', 'Notes count'],
];
const MAX_DELETE = 1000;

/**
 * Leads (managers and the Business Admin; the server refuses agents): every lead with the inbox's filters,
 * Excel-friendly CSV export and permanent delete. Numbers only travel in POST bodies, never in addresses.
 */
export default function LeadsScreen({ me, showToast, onOpenChat }: { me: Me; showToast: ShowToast; onOpenChat: (phone: string) => void }) {
  const confirm = useConfirm();
  const statuses = useLeadStatuses();
  const staff = useApi<TeamResponse>('/api/team').data?.staff || [];
  const [f, setF] = useStoredState<Filters>(`leads-filters:${me.email}`, { ...NO_MORE_FILTERS, status: '', assignee: '', unread: false, closed: 'any' });
  const [q, setQ] = useState('');
  const filters = useMemo(() => ({
    ...moreFilterParams(f), ...(f.status ? { status: f.status } : {}), ...(f.assignee ? { assignee: f.assignee } : {}),
    ...(f.unread ? { unread: true } : {}), ...(f.imported ? { imported: true } : {}), closed: f.closed, ...(q.trim() ? { q: q.trim() } : {}),
  }), [f, q]);
  const result = useQuery<SearchResult, Error>({
    queryKey: ['api', '/api/leads/search', JSON.stringify(filters)],
    queryFn: () => api<SearchResult>('/api/leads/search', { method: 'POST', body: { filters } }),
  });
  const data = result.data;
  const [picked, setPicked] = useState<string[]>([]);
  const [allMatching, setAllMatching] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [detailsOf, setDetailsOf] = useState<LeadRow | null>(null);
  const isHospital = !!useApi<{ enabled: boolean }>('/api/clinic/status', { staleTime: 5 * 60000 }).data?.enabled;
  const [busy, setBusy] = useState('');
  const rename = useRenameLead(showToast);
  const shown = data?.leads || [];
  const count = allMatching ? data?.total || 0 : picked.length;
  const setFilter = (patch: Partial<Filters>) => { setF(old => ({ ...old, ...patch })); setPicked([]); setAllMatching(false); };
  const toggle = (phone: string) => { setAllMatching(false); setPicked(p => (p.includes(phone) ? p.filter(x => x !== phone) : [...p, phone])); };
  const pageAll = shown.length > 0 && shown.every(l => picked.includes(l.phone));
  // What an action works on: the picked numbers, or everything matching the filters.
  const target = () => (allMatching ? { filters } : { phones: picked });

  const exportCsv = async (columns: string[]) => {
    setBusy('export');
    try {
      const res = await apiFetch('/api/leads/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(count ? target() : { filters }), columns }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error((d as { error?: string }).error || `Export failed (${res.status}).`); }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'leads.csv';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      showToast(`Exported ${res.headers.get('X-Lead-Count') || ''} leads`);
      setShowExport(false);
    } catch (e) { showToast(errorMessage(e)); } finally { setBusy(''); }
  };

  const remove = async () => {
    if (!count) return;
    if (count > MAX_DELETE) { showToast(`Delete up to ${MAX_DELETE.toLocaleString('en-IN')} leads at a time. Narrow the filters.`); return; }
    const typed = await confirm.ask({
      title: `Permanently delete ${count} lead${count === 1 ? '' : 's'}?`,
      body: 'Their chats, messages, notes, files and follow-ups are removed and can\'t be brought back. Numbers that replied STOP stay blocked from offers.',
      label: `Type ${count} to confirm`, placeholder: String(count), confirmLabel: 'Delete for ever', danger: true,
    });
    if (typed === null) return;
    if (typed.trim() !== String(count)) { showToast('The number didn\'t match. Nothing was deleted.'); return; }
    setBusy('delete');
    try {
      const r = await api<{ deleted: number; suppressed: number }>('/api/leads/delete', { method: 'POST', body: { ...target(), confirmCount: count } });
      showToast(`${r.deleted} lead${r.deleted === 1 ? '' : 's'} deleted${r.suppressed ? ` (${r.suppressed} STOP number${r.suppressed === 1 ? '' : 's'} kept blocked)` : ''}`);
      setPicked([]); setAllMatching(false);
      await Promise.all([refreshApi('/api/leads'), refreshApi('/api/inbox'), refreshApi('/api/pipeline')]);
    } catch (e) { showToast(errorMessage(e)); } finally { setBusy(''); }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-100" data-testid="leads-screen">
      <div className="max-w-6xl mx-auto px-4 py-5 space-y-3">
        <PageHeader icon={Contact} title="Leads" help="Everyone who has contacted you or that your team added. Export them, or delete leads for good."
          actions={<>
            <button onClick={() => setImporting(true)} className={BUTTON.secondary}><FileSpreadsheet className="w-3.5 h-3.5" /> Import customers</button>
            <button onClick={() => setAdding(true)} className={BUTTON.secondary}><UserPlus className="w-3.5 h-3.5" /> Add lead</button>
          </>} />

        <section className="bg-white border border-slate-200 rounded-xl p-3 space-y-2" aria-label="Filters">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="flex items-center bg-white border border-slate-300 rounded-lg px-2">
              <Search className="w-3.5 h-3.5 text-slate-400" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name or number" aria-label="Search leads" className="py-1.5 px-1.5 text-xs focus:outline-none w-48" />
              {q && <button onClick={() => setQ('')} aria-label="Clear search" className="text-slate-400 cursor-pointer"><X className="w-3.5 h-3.5" /></button>}
            </div>
            <select value={f.status} onChange={e => setFilter({ status: e.target.value })} className={inputInlineCls} aria-label="Status">
              <option value="">Any status</option>
              {statuses.all.map(s => <option key={s.key} value={s.key}>{s.label}{s.active ? '' : ' (hidden)'}</option>)}
            </select>
            <select value={f.assignee} onChange={e => setFilter({ assignee: e.target.value })} className={inputInlineCls} aria-label="Assigned to">
              <option value="">Anyone</option><option value="me">Me</option><option value="unassigned">Nobody</option>
              {staff.map(s => <option key={s.email} value={String(s.email).toLowerCase()}>{s.email}</option>)}
            </select>
            <select value={f.closed} onChange={e => setFilter({ closed: e.target.value as Filters['closed'] })} className={inputInlineCls} aria-label="Done">
              <option value="any">Open and done</option><option value="open">Open chats</option><option value="closed">Done chats</option>
            </select>
            <label className="flex items-center gap-1 text-slate-600"><input type="checkbox" checked={f.unread} onChange={e => setFilter({ unread: e.target.checked })} /> Unread</label>
            <label className="flex items-center gap-1 text-slate-600"><input type="checkbox" checked={!!f.imported} onChange={e => setFilter({ imported: e.target.checked })} /> Imported, not chatted yet</label>
          </div>
          <MoreFilters value={f} onChange={v => setFilter(v)} />
        </section>

        <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="leads-actions">
          <span className="text-slate-600" data-testid="leads-total">{data ? `${data.total.toLocaleString('en-IN')}${data.capped ? '+' : ''} leads match` : ' '}</span>
          {count > 0 && <span className="font-semibold text-slate-800">· {count.toLocaleString('en-IN')} selected</span>}
          {pageAll && data && data.total > shown.length && !allMatching && (
            <button onClick={() => setAllMatching(true)} className="font-semibold text-wa-teal hover:underline cursor-pointer">Select all {data.total.toLocaleString('en-IN')} matching</button>
          )}
          <div className="flex-1" />
          <button onClick={() => setShowExport(true)} disabled={!data?.total || !!busy} className={BUTTON.secondary}><Download className="w-3.5 h-3.5" /> Export CSV{count ? ` (${count})` : ''}</button>
          <button onClick={remove} disabled={!count || !!busy} className={BUTTON.danger}><Trash2 className="w-3.5 h-3.5" /> Delete{count ? ` (${count})` : ''}</button>
        </div>

        {result.error && <LoadError error={errorMessage(result.error)} onRetry={() => result.refetch()} />}
        {result.isLoading && <SkeletonTable rows={6} cols={5} label="Loading leads" />}
        {data && !shown.length && <EmptyState icon={Contact} title="No leads match" text="Change the filters or the dates." />}
        {shown.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500 text-left">
                <tr>
                  <th className="p-2 w-8"><input type="checkbox" aria-label="Select all shown" checked={pageAll} onChange={() => { setAllMatching(false); setPicked(pageAll ? [] : shown.map(l => l.phone)); }} /></th>
                  <th className="p-2">Name</th><th className="p-2">Phone</th><th className="p-2">Status</th><th className="p-2">Source</th>
                  <th className="p-2">Assigned</th><th className="p-2">Last active</th><th className="p-2">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map(l => {
                  const look = statusLook(statuses.all, l.stage);
                  return (
                    <tr key={l.phone} className="hover:bg-slate-50" data-testid="lead-row">
                      <td className="p-2"><input type="checkbox" aria-label={`Select ${displayName(l)}`} checked={allMatching || picked.includes(l.phone)} onChange={() => toggle(l.phone)} /></td>
                      <td className="p-2"><button onClick={() => onOpenChat(l.phone)} className="font-semibold text-slate-800 hover:underline cursor-pointer text-left">{displayName(l)}</button>
                        <RenameButton onClick={() => rename(l, () => { void result.refetch(); })} label={`Rename ${displayName(l)}`} />
                        <ReturnedBadge contact={l} />
                        {otherWaName(l) && <span className="ml-1 text-slate-500">WhatsApp: {otherWaName(l)}</span>}
                        {l.imported_at && !l.last_contacted_at && <span className="ml-1 text-2xs px-1 rounded border border-sky-200 bg-sky-50 text-sky-700 font-semibold">Imported</span>}
                        <button onClick={() => setDetailsOf(l)} className="ml-1 text-slate-400 hover:text-wa-teal cursor-pointer align-middle" aria-label={`Details of ${displayName(l)}`}><IdCard className="w-3.5 h-3.5 inline" /></button>
                        {l.opted_out && <span className="ml-1 text-2xs px-1 rounded border border-rose-200 bg-rose-50 text-rose-700 font-semibold">STOP</span>}
                        {(l.tags || []).slice(0, 2).map(t => <span key={t} className="ml-1 text-2xs bg-slate-100 text-slate-600 rounded-full px-1.5">{t}</span>)}</td>
                      <td className="p-2 font-mono text-slate-600">+{l.phone}</td>
                      <td className="p-2"><span className={`px-1.5 py-px rounded border font-semibold ${look.cls}`}>{look.label}</span></td>
                      <td className="p-2 text-slate-600">{l.source || ''}{l.last_ad_headline || l.first_ad_headline ? ` · ${l.last_ad_headline || l.first_ad_headline}` : ''}</td>
                      <td className="p-2 text-slate-600">{l.assigned_to || '–'}</td>
                      <td className="p-2 text-slate-500">{shortTime(l.last_contacted_at)}</td>
                      <td className="p-2 text-slate-500">{l.created_at ? new Date(l.created_at).toLocaleDateString() : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {data && data.total > shown.length && <div className="p-2 text-xs text-slate-500 border-t border-slate-100">Showing the first {shown.length} of {data.total.toLocaleString('en-IN')}. Export includes all of them.</div>}
          </div>
        )}
      </div>

      {showExport && <ExportDialog count={count || data?.total || 0} busy={busy === 'export'} onClose={() => setShowExport(false)} onExport={exportCsv} />}
      {importing && <Suspense fallback={<DialogLoading label="Loading the import" />}><ImportCustomers onClose={() => { setImporting(false); void result.refetch(); }} showToast={showToast} isHospital={isHospital} /></Suspense>}
      {detailsOf && (
        <Drawer title={displayName(detailsOf)} onClose={() => setDetailsOf(null)}>
          <div className="p-4 space-y-3">
            <div className="text-xs text-slate-500 font-mono">+{detailsOf.phone}</div>
            <CustomerDetailsCard phone={detailsOf.phone} showToast={showToast} compact />
            <button onClick={() => onOpenChat(detailsOf.phone)} className={BUTTON.secondary}>Open the chat</button>
          </div>
        </Drawer>
      )}
      {adding && <AddLeadModal me={me} showToast={showToast} onClose={() => setAdding(false)} onAdded={() => { setAdding(false); refreshApi('/api/leads'); }} />}
    </div>
  );
}

/** Choose the columns, then download (Excel opens it, Telugu and ₹ included). */
function ExportDialog({ count, busy, onClose, onExport }: { count: number; busy: boolean; onClose: () => void; onExport: (columns: string[]) => void }) {
  const [cols, setCols] = useState<string[]>(COLUMNS.map(([k]) => k).filter(k => k !== 'optedOut'));
  return (
    <Modal title={`Export ${count.toLocaleString('en-IN')} leads`} onClose={onClose}
      footer={<>
        <button onClick={onClose} className={BUTTON.secondary}>Cancel</button>
        <button onClick={() => onExport(cols)} disabled={busy || !cols.length} className={BUTTON.primary} data-testid="export-go"><Download className="w-3.5 h-3.5" /> {busy ? 'Preparing…' : 'Download CSV'}</button>
      </>}>
      <p className="text-xs text-slate-500 mb-2">A CSV file that Excel and Google Sheets open. Keep it safe: it has customers' numbers. The export is recorded (who and how many, not the data).</p>
      <div className="grid grid-cols-2 gap-1.5">
        {COLUMNS.map(([k, label]) => (
          <label key={k} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={cols.includes(k)} onChange={e => setCols(c => (e.target.checked ? [...c, k] : c.filter(x => x !== k)))} /> {label}</label>
        ))}
      </div>
    </Modal>
  );
}
