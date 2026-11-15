import { useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { BarChart3, RotateCw, Table2, Download, Lightbulb } from 'lucide-react';
import { useApi, errorOf } from './queryClient';
import { STAGE_INFO } from './crmUtils';
import { AdsFunnelSummary } from './AdsFunnel';
import type { BusinessNumber, Stage } from './types';
import { useBusinessNumbers, numberName } from './inboxNumbers';
import { LoadError, SkeletonCards, SkeletonRows } from './ui';

// ---- What /api/analytics returns (server/analytics.cjs report) ----
type Num = number | null | undefined;
interface Kpis {
  newLeads: number; returningLeads?: number; importedPeople?: number; adChatsExisting?: number; adChatsNew?: number; activeChats: number; customerMessages: number; staffReplies: number; automatedReplies: number;
  orderEnquiries: number; newLeadConversion: number | null; medianStaffResponseMin: number | null;
  unassignedNow: number; unreadNow: number;
}
/** One day of the leads chart: `day`, `total` and one count per source name. */
type LeadsDay = { day: string; total: number } & Record<string, number | string>;
interface LeadsByDay { series: string[]; rows: LeadsDay[]; totals: Record<string, number> }
interface HourRow { hour: number; count: number }
/** One of the business's own statuses (label from the server; older servers sent the key only). */
interface PipelineRow { stage: string; label?: string; count: number }
interface ProductRow { item: string; views: number; orders: number }
interface StaffRow { email: string; replies: number; assigned: number; medianResponseMin: number | null }
interface AdRow { adId: string; headline: string | null; newLeads: number; returning: number; converted: number; conversion: number | null }
/** Several WhatsApp numbers: activity per business number (numberId null = main, older messages). */
interface NumberRow { numberId: string | null; customerMessages: number; activeChats: number; repliesSent: number }
interface ResultRow { id: string; name: string; stats: { sent?: number; delivered?: number; read?: number; replied?: number } | null }
interface AnalyticsReport {
  range: { from: string; to: string; days: number };
  kpis: Kpis; leadsByDay: LeadsByDay; busiestHours: HourRow[]; pipeline: PipelineRow[];
  ads?: AdRow[]; byNumber?: NumberRow[]; products: ProductRow[]; staff: StaffRow[]; campaigns: ResultRow[]; automations: ResultRow[];
}
type Cell = ReactNode;

// Reference data-viz palette (validated: adjacent CVD ΔE ≥ 9.1, normal-vision ≥ 19.6).
// Slots 3-5 are under 3:1 contrast on the surface, so every chart has a legend and a table view.
const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'];
const OTHER = '#898781';
const INK = { primary: '#0b0b0b', secondary: '#52514e', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7', surface: '#fcfcfb' };

const fmtNum = (n: Num) => (n === null || n === undefined ? '–' : Number(n).toLocaleString());
const fmtPct = (x: Num) => (x === null || x === undefined ? '–' : `${Math.round(x * 100)}%`);
function fmtMinutes(m: Num) {
  if (m === null || m === undefined) return '–';
  if (m < 1) return '< 1 min';
  if (m < 60) return `${Math.round(m)} min`;
  return `${(m / 60).toFixed(1)} h`;
}
const shortDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString([], { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Nice axis max + 3-4 ticks. */
function niceTicks(max: number) {
  if (max <= 0) return { top: 4, ticks: [0, 1, 2, 3, 4] };
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map(s => s * mag).find(s => s >= raw) || raw;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
  return { top, ticks };
}

/** Rect with 4px rounded top corners (the data end), square at the baseline. */
function topRounded(x: number, y: number, w: number, h: number, r = 4) {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

// ---------------------------------------------------------------------------

export default function AnalyticsScreen() {
  const [days, setDays] = useState(30);
  // Analytics reads many rows: keep it a minute before asking again (no automatic refresh).
  const report = useApi<AnalyticsReport>(`/api/analytics?days=${days}`, { keepPrevious: true, staleTime: 60000 });
  const data = report.data || null;
  const error = errorOf(report);
  const loading = report.isFetching;
  const load = () => report.refetch();

  const pick = (d: number) => { if (d !== days) setDays(d); };
  const numbers = useBusinessNumbers();

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: '#f9f9f7' }}>
      <div className="max-w-6xl mx-auto px-4 py-5 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2"><BarChart3 className="w-5 h-5 text-wa-teal" /> Analytics</h1>
            <p className="text-xs text-slate-500">Leads, conversations, team response times and results. Times are India time.</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="bg-white border border-slate-200 p-0.5 rounded-lg flex" role="group" aria-label="Date range">
              {[1, 7, 30, 90].map(d => (
                <button key={d} onClick={() => pick(d)} aria-pressed={days === d}
                  className={`px-3 py-1 rounded-md text-xs font-semibold cursor-pointer ${days === d ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                  {d === 1 ? 'Today' : `Last ${d} days`}
                </button>
              ))}
            </div>
            <button onClick={() => data && downloadCsv(data)} disabled={!data} data-testid="analytics-csv"
              className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-50 flex items-center gap-1.5">
              <Download className="w-3.5 h-3.5" aria-hidden="true" /> Download CSV
            </button>
            <button onClick={load} className="p-2 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer" title="Refresh">
              <RotateCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {error && <LoadError error={error} onRetry={load} />}
        {!data && !error && <><SkeletonCards count={4} label="Loading analytics" /><SkeletonRows rows={3} label="Loading analytics" /></>}

        {data && (
          <>
            <KpiGrid k={data.kpis} days={data.range.days} />
            <AdsFunnelSummary days={data.range.days} />
            <div className="grid lg:grid-cols-[2fr_1fr] gap-4">
              <Card title="New leads per day" subtitle="By where they came from" means="Which sources bring new customers. A source that grows after a campaign or ad is working; a sudden drop is worth checking.">
                <LeadsChart d={data.leadsByDay} />
              </Card>
              <Card title="Pipeline now" subtitle="All contacts by stage" means="Many contacts stuck in New enquiry or In discussion means follow-ups are needed.">
                <PipelineBars rows={data.pipeline} />
              </Card>
            </div>
            <div className="grid lg:grid-cols-2 gap-4">
              <Card title="When customers message" subtitle="Customer messages by hour of day" means="Plan who is on shift for the busiest hours, and send broadcasts just before them.">
                <HoursChart rows={data.busiestHours} />
              </Card>
              <Card title="Products" subtitle="Looked at vs ordered in the bot" means="Looked at a lot but rarely ordered: check the price, the photo or the description.">
                <ProductsTable rows={data.products} />
              </Card>
            </div>
            {numbers.length > 1 && (
              <Card title="By WhatsApp number" subtitle="In this period · chats = customers who wrote to the number · replies = bot, AI, staff, broadcasts and follow-ups sent from it">
                <NumbersTable rows={data.byNumber || []} numbers={numbers} />
              </Card>
            )}
            <Card title="Chats from ads" subtitle="Click-to-WhatsApp ads · new = first came through this ad in this period · returning = an existing contact who came back through it · converted = now Booked, Completed or Returning">
              <AdsTable rows={data.ads || []} />
            </Card>
            <Card title="Team" subtitle="Replies sent in this period · chats assigned now · median time to reply to a waiting customer (within 24h)" means="A long reply time or many assigned chats for one person means the work should be shared out.">
              <StaffTable rows={data.staff} />
            </Card>
            <div className="grid lg:grid-cols-2 gap-4">
              <Card title="Broadcast campaigns" subtitle="Started in this period" means="Read but few replies: try a clearer call to action, like 'Reply BOOK'.">
                <ResultsTable rows={data.campaigns} kind="campaign" />
              </Card>
              <Card title="Automatic follow-ups" subtitle="All time">
                <ResultsTable rows={data.automations} kind="automation" />
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** means: one line of "what this tells you" in plain words (U3). */
function Card({ title, subtitle, means, children }: { title: string; subtitle?: string; means?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border p-4" style={{ background: INK.surface, borderColor: 'rgba(11,11,11,0.10)' }}>
      <h2 className="text-sm font-semibold" style={{ color: INK.primary }}>{title}</h2>
      {subtitle && <p className="text-xs mb-3" style={{ color: INK.secondary }}>{subtitle}</p>}
      {children}
      {means && <p className="text-xs mt-3 flex gap-1.5" style={{ color: INK.secondary }}><Lightbulb className="w-3.5 h-3.5 flex-shrink-0 text-amber-500" aria-hidden="true" /><span>{means}</span></p>}
    </section>
  );
}

/** The report as a CSV file (made in the browser, nothing extra is fetched): headline numbers, leads per day, team. */
function downloadCsv(d: AnalyticsReport) {
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? '' : String(v);
    // Text from customers/ads (source names) must never run as a spreadsheet formula.
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines: unknown[][] = [
    [`Analytics, ${d.range.days === 1 ? 'today' : `last ${d.range.days} days`} (India time)`, d.range.from.slice(0, 10), d.range.to.slice(0, 10)],
    [],
    ['Headline', 'Value'],
    ['New leads', d.kpis.newLeads], ['Active chats', d.kpis.activeChats], ['Customer messages', d.kpis.customerMessages],
    ['Staff replies', d.kpis.staffReplies], ['Automated replies', d.kpis.automatedReplies], ['Order enquiries', d.kpis.orderEnquiries],
    ['New-lead conversion %', d.kpis.newLeadConversion === null ? '' : Math.round(d.kpis.newLeadConversion * 100)],
    ['Median staff response (min)', d.kpis.medianStaffResponseMin ?? ''], ['Unassigned now', d.kpis.unassignedNow], ['Unread now', d.kpis.unreadNow],
    [],
    ['Day', 'Total new leads', ...d.leadsByDay.series],
    ...d.leadsByDay.rows.map(r => [r.day, r.total, ...d.leadsByDay.series.map(s => r[s] ?? 0)]),
    [],
    ['Team member', 'Replies sent', 'Chats assigned now', 'Median response (min)'],
    ...d.staff.map(s => [s.email, s.replies, s.assigned, s.medianResponseMin ?? '']),
  ];
  const csv = '\ufeff' + lines.map(l => l.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `analytics-${d.range.days === 1 ? 'today' : `${d.range.days}-days`}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// KPI tiles (a number is the right form for a single headline value)
// ---------------------------------------------------------------------------

function KpiGrid({ k, days }: { k: Kpis; days: number }) {
  const tiles = [
    ['New leads', fmtNum(k.newLeads), k.returningLeads ? `in ${days} days · ${fmtNum(k.returningLeads)} returning after a long silence` : `in ${days} days`],
    ['Active chats', fmtNum(k.activeChats), 'customers who wrote in'],
    ['Customer messages', fmtNum(k.customerMessages), `${fmtNum(k.automatedReplies)} automated · ${fmtNum(k.staffReplies)} staff replies`],
    ['Order enquiries', fmtNum(k.orderEnquiries), 'from the bot menu'],
    ['New-lead conversion', fmtPct(k.newLeadConversion), 'new leads now Booked, Completed or Returning'],
    ['Staff response time', fmtMinutes(k.medianStaffResponseMin), 'median, to a waiting customer'],
    ['Unassigned now', fmtNum(k.unassignedNow), 'chats nobody has picked up'],
    ['Unread now', fmtNum(k.unreadNow), 'customer messages not yet opened'],
    // Customer import D3: ad chats from people already in your records vs new people (shown once there is an import or an ad chat).
    ...((k.importedPeople || k.adChatsExisting || k.adChatsNew) ? [['Ad chats: existing vs new', `${fmtNum(k.adChatsExisting || 0)} / ${fmtNum(k.adChatsNew || 0)}`, `existing customers / new people${k.importedPeople ? ` · ${fmtNum(k.importedPeople)} imported in ${days} days` : ''}`]] : []),
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {tiles.map(([label, value, hint]) => (
        <div key={label} className="rounded-xl border p-3" style={{ background: INK.surface, borderColor: 'rgba(11,11,11,0.10)' }}>
          <div className="text-xs font-medium" style={{ color: INK.secondary }}>{label}</div>
          <div className="text-2xl font-bold mt-0.5" style={{ color: INK.primary }}>{value}</div>
          <div className="text-xs mt-0.5" style={{ color: INK.muted }}>{hint}</div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stacked columns: new leads per day by source
// ---------------------------------------------------------------------------

interface Tip { x: number; y: number; content: ReactNode }

function useTooltip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const show = (e: MouseEvent<SVGRectElement>, content: ReactNode) => {
    const box = e.currentTarget.ownerSVGElement?.parentElement?.getBoundingClientRect() || { left: 0, top: 0 };
    setTip({ x: e.clientX - box.left, y: e.clientY - box.top, content });
  };
  return { tip, show, hide: () => setTip(null) };
}

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return (
    <div className="absolute pointer-events-none z-10 rounded-lg shadow-lg px-2.5 py-1.5 text-xs whitespace-nowrap"
      style={{ left: tip.x + 12, top: tip.y - 10, background: '#0b0b0b', color: '#f0efec' }}>
      {tip.content}
    </div>
  );
}

function Legend({ items }: { items: Array<[string, string]> }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2">
      {items.map(([name, color]) => (
        <span key={name} className="flex items-center gap-1.5 text-xs" style={{ color: INK.secondary }}>
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} /> {name}
        </span>
      ))}
    </div>
  );
}

function TableToggle({ showTable, onToggle }: { showTable: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} className="text-xs font-semibold flex items-center gap-1 cursor-pointer" style={{ color: INK.secondary }} aria-pressed={showTable}>
      <Table2 className="w-3 h-3" /> {showTable ? 'Show chart' : 'Show table'}
    </button>
  );
}

function LeadsChart({ d }: { d: LeadsByDay }) {
  const [showTable, setShowTable] = useState(false);
  const { tip, show, hide } = useTooltip();
  const colorOf = useMemo(() => {
    const map: Record<string, string> = {};
    let slot = 0;
    for (const s of d.series) map[s] = s === 'Other' ? OTHER : SERIES[slot++ % SERIES.length];
    return map;
  }, [d.series]);
  const total = d.rows.reduce((n, r) => n + r.total, 0);
  /** One source's count on a day (0 when that source had none). */
  const count = (r: LeadsDay, s: string) => Number(r[s]) || 0;

  if (!total) return <Empty text="No new leads in this period." />;

  const W = 640, H = 220, padL = 28, padB = 22, padT = 6;
  const plotW = W - padL, plotH = H - padB - padT;
  const { top, ticks } = niceTicks(Math.max(...d.rows.map(r => r.total)));
  const band = plotW / d.rows.length;
  const barW = Math.max(3, Math.min(18, band * 0.6));
  const y = (v: number) => padT + plotH - (v / top) * plotH;
  const labelEvery = Math.ceil(d.rows.length / 8);

  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <Legend items={d.series.map(s => [`${s} (${fmtNum(d.totals[s] ?? d.rows.reduce((n, r) => n + count(r, s), 0))})`, colorOf[s]])} />
        <TableToggle showTable={showTable} onToggle={() => setShowTable(v => !v)} />
      </div>
      {showTable ? (
        <DataTable head={['Day', ...d.series, 'Total']} rows={d.rows.filter(r => r.total).map(r => [shortDay(r.day), ...d.series.map(s => r[s]), r.total])} />
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`New leads per day, ${total} in total`}>
            {ticks.map(t => (
              <g key={t}>
                <line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke={t === 0 ? INK.axis : INK.grid} strokeWidth="1" />
                <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill={INK.muted}>{t}</text>
              </g>
            ))}
            {d.rows.map((r, i) => {
              const cx = padL + band * i + band / 2;
              const segs = d.series.filter(s => count(r, s) > 0);
              // Where each stacked segment starts (running total of the ones below it).
              const starts = segs.reduce<number[]>((acc, _s, j) => [...acc, j === 0 ? 0 : acc[j - 1] + count(r, segs[j - 1])], []);
              return (
                <g key={r.day}>
                  {segs.map((s, j) => {
                    const y0 = y(starts[j]), y1 = y(starts[j] + count(r, s));
                    const h = Math.max(0, y0 - y1 - (j < segs.length - 1 ? 2 : 0)); // 2px surface gap between segments
                    const isTop = j === segs.length - 1;
                    return isTop
                      ? <path key={s} d={topRounded(cx - barW / 2, y1, barW, Math.max(h, 1))} fill={colorOf[s]} />
                      : <rect key={s} x={cx - barW / 2} y={y1 + 2} width={barW} height={h} fill={colorOf[s]} />;
                  })}
                  {/* Hit target bigger than the mark */}
                  <rect x={padL + band * i} y={padT} width={band} height={plotH} fill="transparent"
                    onMouseMove={e => show(e, (
                      <div>
                        <div className="font-semibold mb-0.5">{shortDay(r.day)} · {r.total} new</div>
                        {segs.map(s => <div key={s} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: colorOf[s] }} />{s}: {r[s]}</div>)}
                      </div>
                    ))}
                    onMouseLeave={hide} />
                  {i % labelEvery === 0 && <text x={cx} y={H - 6} textAnchor="middle" fontSize="10" fill={INK.muted}>{shortDay(r.day)}</text>}
                </g>
              );
            })}
          </svg>
          <Tooltip tip={tip} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hour-of-day columns (single series: no legend box, the title names it)
// ---------------------------------------------------------------------------

function HoursChart({ rows }: { rows: HourRow[] }) {
  const [showTable, setShowTable] = useState(false);
  const { tip, show, hide } = useTooltip();
  const total = rows.reduce((n, r) => n + r.count, 0);
  if (!total) return <Empty text="No customer messages in this period." />;
  const peak = rows.reduce((a, b) => (b.count > a.count ? b : a));
  const W = 480, H = 170, padL = 26, padB = 20, padT = 6;
  const plotW = W - padL, plotH = H - padB - padT;
  const { top, ticks } = niceTicks(peak.count);
  const band = plotW / 24;
  const barW = Math.min(12, band * 0.65);
  const y = (v: number) => padT + plotH - (v / top) * plotH;
  const label = (h: number) => `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs" style={{ color: INK.secondary }}>Busiest: <strong style={{ color: INK.primary }}>{label(peak.hour)}–{label((peak.hour + 1) % 24)}</strong> ({peak.count} messages)</span>
        <TableToggle showTable={showTable} onToggle={() => setShowTable(v => !v)} />
      </div>
      {showTable ? (
        <DataTable head={['Hour', 'Customer messages']} rows={rows.filter(r => r.count).map(r => [`${label(r.hour)}–${label((r.hour + 1) % 24)}`, r.count])} />
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Customer messages by hour of day">
            {ticks.map(t => (
              <g key={t}>
                <line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke={t === 0 ? INK.axis : INK.grid} strokeWidth="1" />
                <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill={INK.muted}>{t}</text>
              </g>
            ))}
            {rows.map((r, i) => {
              const cx = padL + band * i + band / 2;
              const h = (r.count / top) * plotH;
              return (
                <g key={r.hour}>
                  {r.count > 0 && <path d={topRounded(cx - barW / 2, y(r.count), barW, h)} fill={SERIES[0]} />}
                  <rect x={padL + band * i} y={padT} width={band} height={plotH} fill="transparent"
                    onMouseMove={e => show(e, <span><strong>{label(r.hour)}–{label((r.hour + 1) % 24)}</strong>: {r.count} message{r.count === 1 ? '' : 's'}</span>)} onMouseLeave={hide} />
                  {i % 3 === 0 && <text x={cx} y={H - 5} textAnchor="middle" fontSize="10" fill={INK.muted}>{label(r.hour)}</text>}
                </g>
              );
            })}
          </svg>
          <Tooltip tip={tip} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pipeline: horizontal bars, one hue, value labelled at the end
// ---------------------------------------------------------------------------

function PipelineBars({ rows }: { rows: PipelineRow[] }) {
  const max = Math.max(1, ...rows.map(r => r.count));
  const total = rows.reduce((n, r) => n + r.count, 0);
  return (
    <div className="space-y-2.5">
      {rows.map(r => (
        <div key={r.stage}>
          <div className="flex justify-between text-xs mb-1">
            <span style={{ color: INK.secondary }}>{r.label || STAGE_INFO[r.stage as Stage]?.label || r.stage}</span>
            <span style={{ color: INK.primary }} className="font-semibold">{r.count} <span style={{ color: INK.muted }} className="font-normal">({total ? Math.round((r.count / total) * 100) : 0}%)</span></span>
          </div>
          <div className="h-2 rounded-r" style={{ background: INK.grid }}>
            <div className="h-2 rounded-r" style={{ width: `${(r.count / max) * 100}%`, background: SERIES[0], minWidth: r.count ? 3 : 0 }} title={`${r.label || STAGE_INFO[r.stage as Stage]?.label || r.stage}: ${r.count}`} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

function Empty({ text }: { text: string }) {
  return <div className="text-xs py-8 text-center" style={{ color: INK.muted }}>{text}</div>;
}

function DataTable({ head, rows }: { head: string[]; rows: Cell[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead><tr>{head.map((h, i) => <th key={h} className={`py-1.5 px-2 font-medium ${i ? 'text-right' : 'text-left'}`} style={{ color: INK.secondary }}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t" style={{ borderColor: INK.grid }}>
              {r.map((c, j) => <td key={j} className={`py-1.5 px-2 ${j ? 'text-right tabular-nums' : ''}`} style={{ color: INK.primary }}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One row per business number (main first), with its share of customer messages. */
function NumbersTable({ rows, numbers }: { rows: NumberRow[]; numbers: BusinessNumber[] }) {
  const mainId = numbers.find(n => n.main)?.id || null;
  const of = (id: string) => rows.filter(r => (r.numberId || mainId) === id);
  const list = numbers.map(n => {
    const mine = of(n.id);
    return {
      n,
      chats: mine.reduce((s, r) => s + r.activeChats, 0),
      messages: mine.reduce((s, r) => s + r.customerMessages, 0),
      replies: mine.reduce((s, r) => s + r.repliesSent, 0),
    };
  });
  const total = list.reduce((s, r) => s + r.messages, 0);
  if (!total && !list.some(r => r.replies)) return <Empty text="No messages on any number in this period." />;
  return (
    <div data-testid="by-number">
      <DataTable
        head={['Number', 'Chats', 'Customer messages', 'Share', 'Replies sent']}
        rows={list.map(r => [
          <span key="n">{numberName(r.n)}{r.n.main ? <span style={{ color: INK.muted }}> · main</span> : null}</span>,
          fmtNum(r.chats), fmtNum(r.messages), total ? fmtPct(r.messages / total) : '–', fmtNum(r.replies),
        ])}
      />
    </div>
  );
}

function ProductsTable({ rows }: { rows: ProductRow[] }) {
  if (!rows.length) return <Empty text="No product views yet. They appear when customers open items in the bot menu." />;
  const max = Math.max(1, ...rows.map(r => r.views));
  return (
    <div className="space-y-2">
      <div className="flex text-xs font-medium" style={{ color: INK.secondary }}>
        <span className="flex-1">Item</span><span className="w-16 text-right">Looked at</span><span className="w-16 text-right">Booked</span>
      </div>
      {rows.map(r => (
        <div key={r.item} className="flex items-center gap-2 text-xs">
          <div className="flex-1 min-w-0">
            <div className="truncate" style={{ color: INK.primary }}>{r.item}</div>
            <div className="h-1.5 rounded-r mt-1" style={{ width: `${(r.views / max) * 100}%`, background: SERIES[0], minWidth: 3 }} />
          </div>
          <span className="w-16 text-right tabular-nums" style={{ color: INK.primary }}>{r.views}</span>
          <span className="w-16 text-right tabular-nums font-semibold" style={{ color: INK.primary }}>{r.orders}</span>
        </div>
      ))}
    </div>
  );
}

function StaffTable({ rows }: { rows: StaffRow[] }) {
  if (!rows.length) return <Empty text="No staff activity yet." />;
  return <DataTable head={['Staff', 'Replies sent', 'Chats assigned now', 'Median response']} rows={rows.map(r => [r.email, r.replies, r.assigned, fmtMinutes(r.medianResponseMin)])} />;
}

function AdsTable({ rows }: { rows: AdRow[] }) {
  if (!rows.length) return <Empty text="No chats from Click-to-WhatsApp ads in this period." />;
  return (
    <DataTable
      head={['Ad', 'New contacts', 'Returning', 'Converted', 'Conversion']}
      rows={rows.map(r => [
        <span key="ad" title={`Ad id ${r.adId}`}>{r.headline || <span className="font-mono">{r.adId}</span>}</span>,
        fmtNum(r.newLeads), fmtNum(r.returning), fmtNum(r.converted), fmtPct(r.conversion),
      ])}
    />
  );
}

function ResultsTable({ rows, kind }: { rows: ResultRow[]; kind: 'campaign' | 'automation' }) {
  if (!rows.length) return <Empty text={kind === 'campaign' ? 'No campaigns in this period.' : 'No automations yet.'} />;
  return (
    <DataTable
      head={[kind === 'campaign' ? 'Campaign' : 'Automation', 'Sent', 'Delivered', 'Read', 'Replied']}
      rows={rows.map(r => {
        const s: NonNullable<ResultRow['stats']> = r.stats || {};
        const read = Number(s.read || 0), sent = Number(s.sent || 0);
        return [r.name, fmtNum(sent), fmtNum(s.delivered || 0), `${fmtNum(read)}${sent ? ` (${Math.round((read / sent) * 100)}%)` : ''}`, fmtNum(s.replied || 0)];
      })}
    />
  );
}
