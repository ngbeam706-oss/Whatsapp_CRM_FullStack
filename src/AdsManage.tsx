import { useState } from 'react';
import { Layers, RefreshCw, Search, ChevronRight, ExternalLink, Pencil, Wallet, CalendarX } from 'lucide-react';
import { api, errorMessage, inputCls, inputInlineCls } from './broadcastUtils';
import { useApi, refreshApi, errorOf, setApiData } from './queryClient';
import { useConfirm } from './confirm';
import { BUTTON, EmptyState, Modal, SkeletonRows, LoadError } from './ui';
import type { ShowToast } from './types';

type Level = 'campaign' | 'adset' | 'ad';
interface Row {
  id: string; level: Level; name: string; status: string; delivery: string; objective: string | null; campaignId: string | null; adsetId: string | null;
  dailyBudget: number | null; lifetimeBudget: number | null; budgetRemaining: number | null; start: string | null; end: string | null; created: string | null;
  whatsapp: boolean | null; canToggle: boolean; spend: number; impressions: number; clicks: number; metaChats: number; chats: number; booked: number;
  costPerChat: number | null; metaUrl: string;
}
interface ManageView {
  level: Level; parent: string | null; days: number; delivery: string; currency: string; rows: Row[];
  totals: { spend: number; impressions: number; clicks: number; metaChats: number; chats: number; booked: number; costPerChat: number | null };
  total: number; truncated: boolean; canEditAll: boolean;
}
const LEVEL_TABS: Array<[Level, string]> = [['campaign', 'Campaigns'], ['adset', 'Ad sets'], ['ad', 'Ads']];
const LABEL: Record<Level, string> = { campaign: 'campaign', adset: 'ad set', ad: 'ad' };
const RUNNING = ['ACTIVE', 'IN_PROCESS', 'WITH_ISSUES', 'PENDING_REVIEW', 'PENDING_BILLING_INFO', 'PREAPPROVED'];
const DELIVERY: Record<string, string> = {
  ACTIVE: 'Active', PAUSED: 'Off', CAMPAIGN_PAUSED: 'Campaign off', ADSET_PAUSED: 'Ad set off', IN_PROCESS: 'Processing', WITH_ISSUES: 'Has issues',
  PENDING_REVIEW: 'In review', DISAPPROVED: 'Rejected', PENDING_BILLING_INFO: 'Billing needed', ARCHIVED: 'Archived', DELETED: 'Deleted', PREAPPROVED: 'Approved',
};
const OBJECTIVE: Record<string, string> = {
  OUTCOME_ENGAGEMENT: 'Engagement', OUTCOME_LEADS: 'Leads', OUTCOME_AWARENESS: 'Awareness', OUTCOME_TRAFFIC: 'Traffic', OUTCOME_SALES: 'Sales', OUTCOME_APP_PROMOTION: 'App',
};
const deliveryCls = (d: string) => (RUNNING.includes(d) ? 'bg-emerald-50 text-emerald-800' : d === 'DISAPPROVED' || d === 'WITH_ISSUES' ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600');
const dateOf = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/**
 * Ads → Manage (server/adsManage.cjs): the ad account's campaigns, ad sets and ads like Meta Ads Manager, with the
 * CRM's chats and bookings next to Meta's spend. On/Off at every level; rename / end date (Business Admin) and
 * budget (managers too).
 */
export default function AdsManage({ showToast }: { showToast: ShowToast }) {
  const [level, setLevel] = useState<Level>('campaign');
  const [campaign, setCampaign] = useState<{ id: string; name: string } | null>(null);
  const [adset, setAdset] = useState<{ id: string; name: string } | null>(null);
  const [q, setQ] = useState('');
  const [delivery, setDelivery] = useState<'recent' | 'active' | 'all'>('recent');
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState('');
  const [editing, setEditing] = useState<{ row: Row; what: 'name' | 'budget' | 'endDate' } | null>(null);
  const confirm = useConfirm();
  const parent = level === 'ad' ? (adset?.id || campaign?.id || '') : level === 'adset' ? (campaign?.id || '') : '';
  const params = new URLSearchParams({ level, days: String(days), delivery, ...(parent ? { parent } : {}), ...(q.trim() ? { q: q.trim() } : {}) });
  const path = `/api/ads/manage?${params}`;
  const query = useApi<ManageView>(path, { keepPrevious: true, staleTime: 60000 });
  const data = query.data;
  const money = (n: number | null | undefined) => (n === null || n === undefined ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: data?.currency || 'INR', maximumFractionDigits: 0 }).format(n));

  const go = (l: Level) => { setLevel(l); if (l === 'campaign') { setCampaign(null); setAdset(null); } if (l === 'adset') setAdset(null); };
  const open = (r: Row) => {
    if (r.level === 'campaign') { setCampaign({ id: r.id, name: r.name }); setAdset(null); setLevel('adset'); }
    else if (r.level === 'adset') { setAdset({ id: r.id, name: r.name }); setLevel('ad'); }
  };
  // Refresh: ask the server to read Meta again (it allows that every 30 seconds), then show it.
  const refresh = async () => { const fresh = await api<ManageView>(`${path}&refresh=1`); setApiData<ManageView>(path, () => fresh); };
  const toggle = async (r: Row) => {
    const off = r.status === 'ACTIVE';
    if (off && r.level !== 'ad' && !(await confirm({ title: `Turn off the ${LABEL[r.level]} "${r.name}"?`, body: r.level === 'campaign' ? 'Every ad set and ad in it stops showing until you turn it on again.' : 'Every ad in it stops showing until you turn it on again.', confirmLabel: 'Turn off', danger: true }))) return;
    setBusy(r.id);
    try {
      await api(`/api/ads/manage/${r.level}/${r.id}/status`, { method: 'POST', body: { status: off ? 'PAUSED' : 'ACTIVE' } });
      await refreshApi('/api/ads/manage');
      showToast(`${r.name}: ${off ? 'off' : 'on'}`);
    } catch (e) { showToast(errorMessage(e)); } finally { setBusy(''); }
  };

  return (
    <div className="space-y-3" data-testid="ads-manage">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 bg-white rounded-lg border border-slate-200 p-1" role="tablist" aria-label="Level">
          {LEVEL_TABS.map(([l, label]) => (
            <button key={l} role="tab" aria-selected={level === l} onClick={() => go(l)}
              className={`px-3 py-1.5 rounded-md text-sm font-semibold cursor-pointer ${level === l ? 'bg-wa-teal text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{label}</button>
          ))}
        </div>
        <label className="flex items-center gap-2 bg-white border border-slate-300 rounded-lg px-2 flex-1 min-w-[10rem]">
          <Search className="w-4 h-4 text-slate-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name or ID" className="flex-1 py-2 text-sm outline-none" aria-label="Search" />
        </label>
        <select value={delivery} onChange={e => setDelivery(e.target.value as typeof delivery)} className={inputInlineCls} aria-label="Delivery">
          <option value="recent">Active or had results</option>
          <option value="active">Active only</option>
          <option value="all">All</option>
        </select>
        <select value={days} onChange={e => setDays(Number(e.target.value))} className={inputInlineCls} aria-label="Date range">
          {[7, 14, 30, 90].map(d => <option key={d} value={d}>Last {d} days</option>)}
        </select>
        <button className={BUTTON.secondary} onClick={() => refresh().catch(e => showToast(errorMessage(e)))} title="Get the latest from Meta"><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
      </div>

      {(campaign || adset) && (
        <nav className="flex items-center gap-1 text-sm flex-wrap" aria-label="Breadcrumb">
          <button className="text-wa-teal font-semibold cursor-pointer" onClick={() => go('campaign')}>All campaigns</button>
          {campaign && <><ChevronRight className="w-4 h-4 text-slate-400" /><button className="text-wa-teal font-semibold cursor-pointer truncate max-w-[16rem]" onClick={() => { setAdset(null); setLevel('adset'); }}>{campaign.name}</button></>}
          {adset && <><ChevronRight className="w-4 h-4 text-slate-400" /><span className="text-slate-700 font-semibold truncate max-w-[16rem]">{adset.name}</span></>}
        </nav>
      )}

      {!data ? (errorOf(query) ? <LoadError error={errorOf(query)} onRetry={() => query.refetch()} /> : <SkeletonRows rows={5} />)
        : !data.rows.length ? <EmptyState icon={Layers} title={`No ${LABEL[level]}s here`} text={delivery !== 'all' ? 'Try "All" to see ones that are off or old.' : 'Nothing in this ad account yet.'} />
          : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
              <table className="w-full text-sm min-w-[56rem]" aria-label={LEVEL_TABS.find(t => t[0] === level)?.[1]}>
                <thead className="bg-slate-50 text-xs text-slate-500 text-left">
                  <tr>
                    <th className="px-3 py-2 w-14">On/Off</th>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Delivery</th>
                    {level !== 'ad' && <th className="px-3 py-2">Budget</th>}
                    {level !== 'ad' && <th className="px-3 py-2">Ends</th>}
                    <th className="px-3 py-2 text-right">Spend</th>
                    <th className="px-3 py-2 text-right" title="Chats started, as Meta counts them">Meta chats</th>
                    <th className="px-3 py-2 text-right" title="New chats in the CRM from these ads">CRM chats</th>
                    <th className="px-3 py-2 text-right">Cost / chat</th>
                    <th className="px-3 py-2 text-right" title="Chats that reached a booked / done / returning status">Booked</th>
                    <th className="px-3 py-2 w-28"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.rows.map(r => (
                    <tr key={r.id} data-testid="manage-row">
                      <td className="px-3 py-2">
                        <button role="switch" aria-checked={r.status === 'ACTIVE'} aria-label={`${r.name} on or off`} disabled={!r.canToggle || busy === r.id} onClick={() => toggle(r)}
                          className={`w-10 h-6 rounded-full relative cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${r.status === 'ACTIVE' ? 'bg-wa-teal' : 'bg-slate-300'}`}>
                          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${r.status === 'ACTIVE' ? 'left-[1.125rem]' : 'left-0.5'}`} />
                        </button>
                      </td>
                      <td className="px-3 py-2 max-w-[18rem]">
                        {r.level === 'ad' ? <span className="font-semibold text-slate-800 block truncate" title={r.name}>{r.name}</span>
                          : <button className="font-semibold text-wa-teal hover:underline text-left block truncate max-w-full cursor-pointer" title={r.name} onClick={() => open(r)}>{r.name}</button>}
                        <span className="text-xs text-slate-500">{[r.objective ? OBJECTIVE[r.objective] || r.objective : '', r.whatsapp ? 'WhatsApp' : '', `ID ${r.id}`].filter(Boolean).join(' · ')}</span>
                      </td>
                      <td className="px-3 py-2"><span className={`text-xs px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${deliveryCls(r.delivery)}`}>{DELIVERY[r.delivery] || r.delivery.toLowerCase()}</span></td>
                      {level !== 'ad' && (
                        <td className="px-3 py-2 whitespace-nowrap">
                          {r.dailyBudget !== null ? <>{money(r.dailyBudget)} <span className="text-xs text-slate-500">/ day</span></>
                            : r.lifetimeBudget !== null ? <>{money(r.lifetimeBudget)} <span className="text-xs text-slate-500">total</span></>
                              : <span className="text-xs text-slate-500">{level === 'adset' ? 'Campaign budget' : 'On ad sets'}</span>}
                        </td>
                      )}
                      {level !== 'ad' && <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">{dateOf(r.end) || 'No end'}</td>}
                      <td className="px-3 py-2 text-right tabular-nums">{money(r.spend)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.metaChats}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.chats}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(r.costPerChat)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.booked}</td>
                      <td className="px-3 py-2">
                        <div className="flex gap-0.5 justify-end">
                          {level !== 'ad' && (r.dailyBudget !== null || r.lifetimeBudget !== null) && <button className={BUTTON.quiet} title="Change budget" aria-label={`Change budget of ${r.name}`} onClick={() => setEditing({ row: r, what: 'budget' })}><Wallet className="w-4 h-4" /></button>}
                          {data.canEditAll && <button className={BUTTON.quiet} title="Rename" aria-label={`Rename ${r.name}`} onClick={() => setEditing({ row: r, what: 'name' })}><Pencil className="w-4 h-4" /></button>}
                          {data.canEditAll && level !== 'ad' && <button className={BUTTON.quiet} title="End date" aria-label={`End date of ${r.name}`} onClick={() => setEditing({ row: r, what: 'endDate' })}><CalendarX className="w-4 h-4" /></button>}
                          <a className={BUTTON.quiet} href={r.metaUrl} target="_blank" rel="noreferrer" title="Open in Meta Ads Manager" aria-label={`Open ${r.name} in Meta Ads Manager`}><ExternalLink className="w-4 h-4" /></a>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 font-semibold text-slate-700">
                  <tr>
                    <td className="px-3 py-2" colSpan={level !== 'ad' ? 5 : 3}>{data.rows.length} {LABEL[level]}{data.rows.length === 1 ? '' : 's'} · last {data.days} days</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(data.totals.spend)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{data.totals.metaChats}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{data.totals.chats}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(data.totals.costPerChat)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{data.totals.booked}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
      {data?.truncated && <p className="text-xs text-slate-500">Showing the first {data.total} from Meta. Search by name to find others.</p>}
      <p className="text-xs text-slate-500">Spend and Meta chats update about once an hour; CRM chats and bookings are counted by the ad the chat first came from. On/Off and budgets change in Meta straight away.</p>
      {editing && <EditDialog row={editing.row} what={editing.what} currency={data?.currency || 'INR'} onClose={() => setEditing(null)}
        onSaved={(msg) => { setEditing(null); refreshApi('/api/ads/manage'); showToast(msg); }} />}
    </div>
  );
}

/** Rename / budget / end date for one campaign, ad set or ad. */
function EditDialog({ row, what, currency, onClose, onSaved }: { row: Row; what: 'name' | 'budget' | 'endDate'; currency: string; onClose: () => void; onSaved: (msg: string) => void }) {
  const lifetime = row.dailyBudget === null && row.lifetimeBudget !== null;
  const [value, setValue] = useState(what === 'name' ? row.name : what === 'budget' ? String(row.dailyBudget ?? row.lifetimeBudget ?? '') : (row.end ? new Date(Date.parse(row.end) + 330 * 60000).toISOString().slice(0, 10) : ''));
  const [busy, setBusy] = useState(false);
  const [today] = useState(() => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10));
  const [error, setError] = useState('');
  const title = what === 'name' ? `Rename ${LABEL[row.level]}` : what === 'budget' ? `${lifetime ? 'Total' : 'Daily'} budget` : 'End date';
  const save = async (clear = false) => {
    setBusy(true); setError('');
    try {
      const body = what === 'name' ? { name: value } : what === 'budget' ? { budget: Number(value) } : { endDate: clear ? null : value };
      await api(`/api/ads/manage/${row.level}/${row.id}`, { method: 'PATCH', body });
      onSaved(what === 'name' ? 'Renamed' : what === 'budget' ? 'Budget changed' : clear ? 'End date removed' : 'End date saved');
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onClose}
      footer={<>
        {what === 'endDate' && row.level === 'adset' && row.end && !lifetime && <button className={BUTTON.quiet} disabled={busy} onClick={() => save(true)}>Remove end date</button>}
        <button className={BUTTON.secondary} onClick={onClose}>Close</button>
        <button className={BUTTON.primary} disabled={busy || !value} onClick={() => save()}>{busy ? 'Saving…' : 'Save'}</button>
      </>}>
      <div className="space-y-2">
        <div className="text-xs text-slate-500 truncate">{row.name}</div>
        {what === 'name' && <input value={value} onChange={e => setValue(e.target.value)} maxLength={200} className={inputCls} aria-label="New name" />}
        {what === 'budget' && (
          <>
            <label className="block"><span className="text-xs font-semibold text-slate-600">{lifetime ? 'Total for the whole run' : 'Per day'} ({currency})</span>
              <input value={value} onChange={e => setValue(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" className={inputCls} aria-label="Budget" /></label>
            <p className="text-xs text-slate-500">One change can raise it at most 5 times. {lifetime ? 'It can\'t go below what is already spent.' : ''}</p>
          </>
        )}
        {what === 'endDate' && (
          <>
            <input type="date" value={value} min={today} onChange={e => setValue(e.target.value)} className={inputCls} aria-label="End date" />
            <p className="text-xs text-slate-500">It stops at 11:59 pm India time that day.</p>
          </>
        )}
        {error && <div className="p-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700" role="alert">{error}</div>}
      </div>
    </Modal>
  );
}
