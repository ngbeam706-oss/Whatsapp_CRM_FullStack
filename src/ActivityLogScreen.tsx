// Settings -> Activity log (docs/progress/activity-log.md, L3): who did what in the business, one plain sentence each.
// The Business Admin only (the server refuses everyone else: POST /api/activity/list; filters go in the body, never in the address). Customers are shown by name (the server
// turns its private customer column into the current name), never by number. A Security tab lists sign-ins with the
// device and an approximate network. No automatic refresh: "Refresh" or "Load more".
import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Download, History, RotateCw, Search, ShieldCheck, ShieldAlert, X } from 'lucide-react';
import { api, errorMessage, inputInlineCls } from './broadcastUtils';
import { apiFetch } from './apiClient';
import { useApi } from './queryClient';
import { BUTTON, EmptyState, LoadError, PageHeader, SkeletonRows } from './ui';
import type { Me, ShowToast, TeamResponse } from './types';

interface Entry { id: number; at: string; action: string; area: string; actor: string | null; person: string; sentence: string; security?: { device: string; network: string; newDevice: boolean } }
interface Page { entries: Entry[]; nextBeforeId: number | null; areas: Record<string, string> }
type Tab = 'activity' | 'security';

const AREAS: Array<[string, string]> = [['', 'Every area'], ['team', 'Team'], ['chats', 'Chats'], ['leads', 'Leads'], ['broadcasts', 'Broadcasts'], ['ads', 'Ads'], ['clinic', 'Clinic'], ['settings', 'Settings'], ['security', 'Security']];
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export default function ActivityLogScreen({ me, showToast }: { me: Me; showToast: ShowToast }) {
  const [tab, setTab] = useState<Tab>('activity');
  const [person, setPerson] = useState('');
  const [area, setArea] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { const t = setTimeout(() => setQ(typed.trim()), 300); return () => clearTimeout(t); }, [typed]);
  const team = useApi<TeamResponse>('/api/team').data?.staff || [];

  // Filters (sent in the request body, so search words never end up in an address or a server log).
  const filters = useMemo(() => {
    const f: Record<string, string> = {};
    if (tab === 'security') f.tab = 'security';
    if (person) f.person = person;
    if (area && tab === 'activity') f.area = area;
    if (from) f.from = from;
    if (to) f.to = to;
    if (q) f.q = q;
    return f;
  }, [tab, person, area, from, to, q]);

  const log = useInfiniteQuery<Page, Error>({
    queryKey: ['api', '/api/activity', JSON.stringify(filters)],
    queryFn: ({ pageParam }) => api<Page>('/api/activity/list', { method: 'POST', body: { ...filters, ...(pageParam ? { beforeId: pageParam } : {}) } }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextBeforeId || undefined,
    staleTime: 30000,
  });
  const entries = log.data?.pages.flatMap(p => p.entries) || [];

  const download = async () => {
    setBusy(true);
    try {
      const res = await apiFetch('/api/activity/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(filters) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error((d as { error?: string }).error || `Download failed (${res.status}).`); }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url; a.download = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'activity.csv';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      showToast(res.headers.get('X-Entry-Capped') === '1'
        ? `Downloaded the newest ${res.headers.get('X-Entry-Count') || ''} entries. Narrow the dates for older ones.`
        : `Downloaded ${res.headers.get('X-Entry-Count') || ''} entries`);
    } catch (e) { showToast(errorMessage(e)); } finally { setBusy(false); }
  };
  const filtered = !!(person || area || from || to || q);
  const clear = () => { setPerson(''); setArea(''); setFrom(''); setTo(''); setTyped(''); };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-100" data-testid="activity-log">
      <div className="max-w-5xl mx-auto px-4 py-5 space-y-3">
        <PageHeader icon={History} title="Activity log" help="Who did what in your business: team, chats, leads, broadcasts, ads, clinic and settings. Kept for 1 year. Only you see it here; the platform team sees only the actions, never customer names or numbers. A download holds the newest 5,000 entries."
          actions={<>
            <button onClick={() => void log.refetch()} className={BUTTON.secondary} disabled={log.isFetching}><RotateCw className={`w-3.5 h-3.5 ${log.isFetching ? 'motion-safe:animate-spin' : ''}`} /> Refresh</button>
            <button onClick={() => void download()} className={BUTTON.secondary} disabled={busy || !entries.length} data-testid="activity-download"><Download className="w-3.5 h-3.5" /> {busy ? 'Preparing…' : 'Download CSV'}</button>
          </>} />

        <div className="flex gap-1.5" role="tablist" aria-label="Activity log">
          {([['activity', 'Activity', History], ['security', 'Security (sign-ins)', ShieldCheck]] as const).map(([k, l, Icon]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-1.5 cursor-pointer ${tab === k ? 'bg-wa-teal text-white' : 'bg-white text-slate-600 border border-slate-200'}`}><Icon className="w-3.5 h-3.5" />{l}</button>
          ))}
        </div>

        <section className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center gap-2 text-xs" aria-label="Filters">
          <select value={person} onChange={e => setPerson(e.target.value)} className={inputInlineCls} aria-label="Person">
            <option value="">Everyone</option>
            {team.map(m => <option key={m.email} value={String(m.email).toLowerCase()}>{m.full_name || m.email}</option>)}
          </select>
          {tab === 'activity' && (
            <select value={area} onChange={e => setArea(e.target.value)} className={inputInlineCls} aria-label="Area">
              {AREAS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          )}
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputInlineCls} aria-label="From" />
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className={inputInlineCls} aria-label="To" />
          <div className="flex items-center bg-white border border-slate-300 rounded-lg px-2">
            <Search className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
            <input value={typed} onChange={e => setTyped(e.target.value.slice(0, 60))} placeholder="Search" aria-label="Search the activity" className="py-1.5 px-1.5 text-xs focus:outline-none w-40" />
          </div>
          {filtered && <button onClick={clear} className="text-wa-teal font-semibold flex items-center gap-1 cursor-pointer"><X className="w-3.5 h-3.5" /> Clear</button>}
        </section>

        {log.error ? <LoadError error={log.error.message} onRetry={() => log.refetch()} />
          : log.isLoading ? <SkeletonRows rows={6} label="Loading the activity log" />
            : !entries.length ? <EmptyState icon={tab === 'security' ? ShieldCheck : History} title={filtered ? 'Nothing matches' : tab === 'security' ? 'No sign-ins recorded yet' : 'Nothing recorded yet'} text={filtered ? 'Change the filters or clear them.' : 'Actions appear here as your team works.'} />
              : tab === 'security' ? (
                <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
                  <table className="w-full text-xs" data-testid="signins">
                    <thead className="bg-slate-50 text-slate-500 text-left"><tr><th className="p-2">When</th><th className="p-2">Who</th><th className="p-2">Device</th><th className="p-2">Approximate network</th><th className="p-2" /></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {entries.map(e => (
                        <tr key={e.id} data-testid="signin-row">
                          <td className="p-2 text-slate-500 whitespace-nowrap">{when(e.at)}</td>
                          <td className="p-2 font-semibold text-slate-800">{e.actor && e.actor === me.email.toLowerCase() ? 'You' : e.person}</td>
                          <td className="p-2 text-slate-700">{e.security?.device || '–'}</td>
                          <td className="p-2 font-mono text-slate-600">{e.security?.network || '–'}</td>
                          <td className="p-2">{e.security?.newDevice && <span className="inline-flex items-center gap-1 text-2xs px-1.5 py-px rounded border border-amber-200 bg-amber-50 text-amber-800 font-semibold" data-testid="new-device"><ShieldAlert className="w-3 h-3" /> New device</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <ul className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100" aria-label="Activity">
                  {entries.map(e => (
                    <li key={e.id} className="px-3 py-2 flex items-start gap-3 text-sm" data-testid="activity-row">
                      <span className="text-xs text-slate-500 whitespace-nowrap w-28 flex-shrink-0 pt-0.5">{when(e.at)}</span>
                      <span className="flex-1 min-w-0 text-slate-800">{e.sentence}</span>
                      <span className="text-2xs uppercase tracking-wide text-slate-400 flex-shrink-0 pt-1">{log.data?.pages[0]?.areas?.[e.area] || e.area}</span>
                    </li>
                  ))}
                </ul>
              )}
        {log.hasNextPage && (
          <div className="flex justify-center">
            <button onClick={() => void log.fetchNextPage()} disabled={log.isFetchingNextPage} className={BUTTON.secondary}>{log.isFetchingNextPage ? 'Loading…' : 'Load more'}</button>
          </div>
        )}
      </div>
    </div>
  );
}
