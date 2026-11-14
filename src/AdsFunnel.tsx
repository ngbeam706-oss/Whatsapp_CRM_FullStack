import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Download, Info, TrendingDown, TrendingUp } from 'lucide-react';
import { api, errorMessage, inputInlineCls } from './broadcastUtils';
import { apiFetch } from './apiClient';
import { useApi } from './queryClient';
import { BUTTON, SkeletonRows } from './ui';
import { useFilterOptions } from './leadFilterUtils';
import type { ShowToast, TeamResponse } from './types';

type Num = number | null;
interface Metrics {
  spend: number; impressions: number; clicks: number; metaChats: number; chats: number; returning?: number; replied: number; working: number; won: number; done: number; repeat: number; lost: number;
  revenue: number; valued: number; costPerChat: Num; costPerWorking: Num; costPerWon: Num; costPerDone: Num; wonRate: Num; roas: Num;
}
interface AdRow extends Metrics { adId: string; name: string }
interface AdsetRow extends Metrics { adsetId: string | null; name: string; ads: AdRow[] }
interface CampaignRow extends Metrics { campaignId: string | null; name: string; adsets: AdsetRow[]; lostReasons: Record<string, number>; medianDaysToWon: Num }
interface Funnel {
  range: { from: string; to: string; days: number }; currency: string; attribution: 'first' | 'last'; avgValue: Num;
  totals: Metrics & { medianDaysToWon: Num; medianFirstReplyMin: Num }; previous: Metrics & { medianDaysToWon: Num; medianFirstReplyMin: Num };
  steps: Array<{ key: string; label: string; count: number; pctOfPrev: Num }>;
  campaigns: CampaignRow[];
  replyBands: Array<{ key: string; label: string; chats: number; won: number; wonRate: Num }>;
  agents: Array<{ email: string; chats: number; replied: number; won: number; wonRate: Num; medianFirstReplyMin: Num }>;
  sources: Array<{ source: string; leads: number; won: number; wonRate: Num }>;
  trend: Array<{ day: string; spend: number; won: number }>;
  campaignsList: Array<{ id: string; name: string }>;
  historyFrom: string | null;
}
interface Query { days: number; attribution: 'first' | 'last'; campaignId: string; statusType: string; agent: string; source: string }

const LOST_REASON: Record<string, string> = { booked: 'Booked elsewhere', resolved: 'Resolved', not_interested: 'Not interested', no_response: 'No response', spam: 'Spam', other: 'Other', not_given: 'No reason given' };
const TYPES: Array<[string, string]> = [['', 'Any status'], ['new', 'New'], ['working', 'Working on it'], ['won', 'Booked / ordered'], ['done', 'Done'], ['repeat', 'Returning'], ['lost', 'Lost']];

/**
 * Ads -> Funnel (managers and the Business Admin): from money spent to bookings, per campaign, ad set and ad.
 * Aggregates only. Built from Meta's daily results and the CRM's own chats and statuses (by status TYPE).
 */
export default function AdsFunnel({ showToast }: { showToast: ShowToast }) {
  const [q, setQ] = useState<Query>({ days: 30, attribution: 'first', campaignId: '', statusType: '', agent: '', source: '' });
  const body = useMemo(() => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== '')), [q]);
  const result = useQuery<{ funnel: Funnel | null }, Error>({
    queryKey: ['api', '/api/ads/funnel', JSON.stringify(body)],
    queryFn: () => api<{ funnel: Funnel | null }>('/api/ads/funnel', { method: 'POST', body }),
    staleTime: 5 * 60000,
  });
  const staff = useApi<TeamResponse>('/api/team').data?.staff || [];
  const opts = useFilterOptions();
  const f = result.data?.funnel;
  const money = (n: Num) => (n === null || n === undefined ? '–' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: f?.currency || 'INR', maximumFractionDigits: 0 }).format(n));
  const set = (patch: Partial<Query>) => setQ(old => ({ ...old, ...patch }));
  const [busy, setBusy] = useState(false);

  const exportCsv = async () => {
    setBusy(true);
    try {
      const res = await apiFetch('/api/ads/funnel/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error((d as { error?: string }).error || `Export failed (${res.status}).`); }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url; a.download = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'ads-funnel.csv';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { showToast(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3" data-testid="ads-funnel">
      <section className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center gap-2 text-xs" aria-label="Funnel filters">
        <select value={q.days} onChange={e => set({ days: Number(e.target.value) })} className={inputInlineCls} aria-label="Period">
          {[7, 30, 90, 180].map(d => <option key={d} value={d}>Last {d} days</option>)}
        </select>
        <div className="flex rounded-full border border-slate-200 overflow-hidden" role="group" aria-label="Credit the chat to">
          {(['first', 'last'] as const).map(a => (
            <button key={a} onClick={() => set({ attribution: a })} aria-pressed={q.attribution === a}
              className={`px-3 py-1 font-semibold cursor-pointer ${q.attribution === a ? 'bg-slate-800 text-white' : 'bg-white text-slate-600'}`}>{a === 'first' ? 'First ad' : 'Last ad'}</button>
          ))}
        </div>
        <select value={q.campaignId} onChange={e => set({ campaignId: e.target.value })} className={inputInlineCls} aria-label="Campaign">
          <option value="">All campaigns</option>
          {(f?.campaignsList || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={q.statusType} onChange={e => set({ statusType: e.target.value })} className={inputInlineCls} aria-label="Status now">
          {TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select value={q.agent} onChange={e => set({ agent: e.target.value })} className={inputInlineCls} aria-label="Handled by">
          <option value="">Everyone</option>
          {staff.map(s => <option key={s.email} value={String(s.email).toLowerCase()}>{s.email}</option>)}
        </select>
        <select value={q.source} onChange={e => set({ source: e.target.value })} className={inputInlineCls} aria-label="Source (comparison)">
          <option value="">All sources</option>
          {['Ads', ...(opts?.sources || [])].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="flex-1" />
        <button onClick={exportCsv} disabled={busy || !f} className={BUTTON.secondary}><Download className="w-3.5 h-3.5" /> Export CSV</button>
      </section>

      {result.error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{errorMessage(result.error)}</div>}
      {result.isLoading && <SkeletonRows rows={4} label="Loading the funnel" />}
      {result.data && !f && <div className="p-3 bg-white border border-slate-200 rounded-xl text-sm text-slate-600">Connect an ad account to see the funnel.</div>}
      {f && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2" data-testid="funnel-kpis">
            <Kpi label="Spend" value={money(f.totals.spend)} now={f.totals.spend} before={f.previous.spend} neutral />
            <Kpi label="Chats in the CRM" value={String(f.totals.chats)} now={f.totals.chats} before={f.previous.chats} />
            <Kpi label="Booked / ordered" value={String(f.totals.won)} now={f.totals.won} before={f.previous.won} />
            <Kpi label="Cost per booking" value={money(f.totals.costPerWon)} now={f.totals.costPerWon} before={f.previous.costPerWon} lowerIsBetter />
            <Kpi label="Revenue" value={f.totals.revenue ? money(f.totals.revenue) : '–'} now={f.totals.revenue} before={f.previous.revenue} hint={f.avgValue ? `Bookings without an amount count as ${money(f.avgValue)} (Bookings to Meta).` : 'Add a booking amount when you mark a chat booked.'} />
            <Kpi label="Return on ad spend" value={f.totals.roas === null ? '–' : `${f.totals.roas}×`} now={f.totals.roas} before={f.previous.roas} />
            <Kpi label="Days to book (median)" value={f.totals.medianDaysToWon === null ? '–' : String(f.totals.medianDaysToWon)} now={f.totals.medianDaysToWon} before={f.previous.medianDaysToWon} lowerIsBetter />
            <Kpi label="First reply (median)" value={f.totals.medianFirstReplyMin === null ? '–' : `${f.totals.medianFirstReplyMin} min`} now={f.totals.medianFirstReplyMin} before={f.previous.medianFirstReplyMin} lowerIsBetter />
          </div>
          <p className="text-xs text-slate-500 flex items-start gap-1.5"><Info className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
            Compared with the {f.range.days} days before. Chats are credited to the {f.attribution} ad the customer came from. Steps count by status kind (your own status names).
            Time to book and the daily trend use the status history, which starts from the day this update was installed{f.historyFrom ? ` (first record ${new Date(f.historyFrom).toLocaleDateString()})` : ''}.
          </p>

          <Section title="From spend to bookings">
            <div className="space-y-1.5" data-testid="funnel-steps">
              {f.steps.slice(1).map(s => {
                const max = Math.max(1, ...f.steps.slice(1).map(x => x.count));
                return (
                  <div key={s.key} className="flex items-center gap-2 text-xs">
                    <span className="w-40 text-slate-600">{s.label}</span>
                    <div className="flex-1 h-4 bg-slate-100 rounded"><div className="h-4 rounded bg-wa-teal/70" style={{ width: `${(s.count / max) * 100}%`, minWidth: s.count ? 3 : 0 }} /></div>
                    <span className="w-20 text-right font-semibold text-slate-800">{s.count.toLocaleString('en-IN')}</span>
                    <span className="w-16 text-right text-slate-500">{s.pctOfPrev === null ? '' : `${s.pctOfPrev}%`}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-4 mt-3 text-xs text-slate-600">
              <span>Cost per chat <b>{money(f.totals.costPerChat)}</b></span><span>per working lead <b>{money(f.totals.costPerWorking)}</b></span>
              <span>per booking <b>{money(f.totals.costPerWon)}</b></span>{!!f.totals.returning && <span data-testid="funnel-returning">Returning from ads <b>{f.totals.returning}</b></span>}<span>per done <b>{money(f.totals.costPerDone)}</b></span><span>Lost <b>{f.totals.lost}</b></span>
            </div>
          </Section>

          <Section title="By campaign, ad set and ad">
            <CampaignTable rows={f.campaigns} money={money} />
          </Section>

          <div className="grid md:grid-cols-2 gap-3">
            <Section title="First reply speed and bookings">
              <SmallTable head={['First reply', 'Chats', 'Booked', 'Rate']} rows={f.replyBands.map(b => [b.label, b.chats, b.won, b.wonRate === null ? '–' : `${b.wonRate}%`])} />
            </Section>
            <Section title="Ads vs other sources (new leads)">
              <SmallTable head={['Source', 'Leads', 'Booked', 'Rate']} rows={f.sources.map(s => [s.source, s.leads, s.won, s.wonRate === null ? '–' : `${s.wonRate}%`])} />
            </Section>
            <Section title="Team results on ad leads">
              <SmallTable head={['Handled by', 'Chats', 'Replied', 'Booked', 'Rate', 'First reply']} rows={f.agents.map(a => [a.email, a.chats, a.replied, a.won, a.wonRate === null ? '–' : `${a.wonRate}%`, a.medianFirstReplyMin === null ? '–' : `${a.medianFirstReplyMin} min`])} />
            </Section>
            <Section title="Daily: spend and bookings">
              <Trend rows={f.trend} money={money} />
            </Section>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Short summary on the Analytics page (managers): ad spend -> chats -> bookings, cost per booking and return on ad
 * spend for the same period. Hidden when the business has no ad account (or no Ads module).
 */
export function AdsFunnelSummary({ days }: { days: number }) {
  const body = { days: Math.max(days, 1) };
  const r = useQuery<{ funnel: Funnel | null }, Error>({
    queryKey: ['api', '/api/ads/funnel', JSON.stringify(body)],
    queryFn: () => api<{ funnel: Funnel | null }>('/api/ads/funnel', { method: 'POST', body }),
    staleTime: 5 * 60000, retry: false,
  });
  const f = r.data?.funnel;
  if (!f || (!f.totals.spend && !f.totals.chats)) return null;
  const money = (n: Num) => (n === null ? '–' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: f.currency || 'INR', maximumFractionDigits: 0 }).format(n));
  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm" data-testid="ads-funnel-summary">
      <span className="font-bold text-slate-800">Ads</span>
      <span>{money(f.totals.spend)} spent</span>
      <span>{f.totals.chats} chats</span>
      <span>{f.totals.won} booked</span>
      <span>{money(f.totals.costPerWon)} per booking</span>
      {f.totals.roas !== null && <span>{f.totals.roas}× return on ad spend</span>}
      <span className="text-xs text-slate-500 ml-auto">Details: Ads → Funnel</span>
    </section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="bg-white border border-slate-200 rounded-xl p-4"><h3 className="text-sm font-bold text-slate-800 mb-2">{title}</h3>{children}</section>;
}

function Kpi({ label, value, now, before, lowerIsBetter = false, neutral = false, hint }: { label: string; value: string; now: Num; before: Num; lowerIsBetter?: boolean; neutral?: boolean; hint?: string }) {
  const change = now !== null && before !== null && before !== 0 ? Math.round(((now - before) / Math.abs(before)) * 100) : null;
  const good = change !== null && (lowerIsBetter ? change < 0 : change > 0);
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3" title={hint}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-bold text-slate-800">{value}</div>
      {change !== null && change !== 0 && (
        <div className={`text-xs flex items-center gap-1 ${neutral ? 'text-slate-500' : good ? 'text-emerald-700' : 'text-rose-700'}`}>
          {change > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}{change > 0 ? '+' : ''}{change}% vs before
        </div>
      )}
    </div>
  );
}

function SmallTable({ head, rows }: { head: string[]; rows: Array<Array<string | number>> }) {
  if (!rows.length) return <p className="text-xs text-slate-500">Nothing in this period.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-slate-500 text-left"><tr>{head.map(h => <th key={h} className="py-1 pr-2 font-semibold">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={`py-1 pr-2 ${j ? 'text-slate-700' : 'text-slate-800 font-medium'}`}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function Trend({ rows, money }: { rows: Funnel['trend']; money: (n: Num) => string }) {
  if (!rows.length) return <p className="text-xs text-slate-500">No days with spend or bookings yet.</p>;
  const maxSpend = Math.max(1, ...rows.map(r => r.spend));
  const maxWon = Math.max(1, ...rows.map(r => r.won));
  return (
    <div className="flex items-end gap-0.5 h-28 overflow-x-auto" aria-label="Spend and bookings per day">
      {rows.map(r => (
        <div key={r.day} className="flex flex-col items-center justify-end gap-0.5 h-full min-w-[10px]" title={`${r.day}: ${money(r.spend)} spent, ${r.won} booked`}>
          <div className="w-1.5 bg-emerald-500 rounded-t" style={{ height: `${(r.won / maxWon) * 40}%` }} />
          <div className="w-1.5 bg-sky-400 rounded-t" style={{ height: `${(r.spend / maxSpend) * 55}%` }} />
        </div>
      ))}
    </div>
  );
}

function CampaignTable({ rows, money }: { rows: CampaignRow[]; money: (n: Num) => string }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (!rows.length) return <p className="text-xs text-slate-500">No ad results or ad chats in this period.</p>;
  const cells = (m: Metrics) => [money(m.spend), m.chats, m.working, m.won, m.done, m.lost, money(m.costPerChat), money(m.costPerWon), m.wonRate === null ? '–' : `${m.wonRate}%`, m.revenue ? money(m.revenue) : '–', m.roas === null ? '–' : `${m.roas}×`];
  const head = ['', 'Spend', 'Chats', 'Working', 'Booked', 'Done', 'Lost', 'Per chat', 'Per booking', 'Rate', 'Revenue', 'ROAS'];
  const row = (key: string, label: ReactNode, m: Metrics, depth: number, toggle?: () => void, isOpen?: boolean) => (
    <tr key={key} className={depth === 0 ? 'bg-slate-50 font-semibold' : ''} data-testid={depth === 0 ? 'funnel-campaign' : undefined}>
      <td className="py-1.5 pr-2" style={{ paddingLeft: depth * 16 }}>
        {toggle ? <button onClick={toggle} className="flex items-center gap-1 cursor-pointer text-left">{isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}{label}</button> : label}
      </td>
      {cells(m).map((c, i) => <td key={i} className="py-1.5 pr-2 text-right">{c}</td>)}
    </tr>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-slate-500"><tr>{head.map((h, i) => <th key={i} className={`py-1 pr-2 font-semibold ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">
          {rows.flatMap(c => {
            const ck = `c-${c.campaignId}`;
            const out = [row(ck, <span>{c.name}{Object.keys(c.lostReasons).length > 0 && <span className="ml-2 font-normal text-slate-500">lost: {Object.entries(c.lostReasons).map(([r, n]) => `${LOST_REASON[r] || r} ${n}`).join(', ')}</span>}{c.medianDaysToWon !== null && <span className="ml-2 font-normal text-slate-500">· {c.medianDaysToWon} days to book</span>}</span>, c, 0, () => setOpen(o => ({ ...o, [ck]: !o[ck] })), open[ck])];
            if (open[ck]) {
              for (const s of c.adsets) {
                const sk = `${ck}-s-${s.adsetId}`;
                out.push(row(sk, s.name, s, 1, () => setOpen(o => ({ ...o, [sk]: !o[sk] })), open[sk]));
                if (open[sk]) for (const a of s.ads) out.push(row(`${sk}-a-${a.adId}`, a.name, a, 2));
              }
            }
            return out;
          })}
        </tbody>
      </table>
    </div>
  );
}
