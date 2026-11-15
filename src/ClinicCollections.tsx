import { useState } from 'react';
import { IndianRupee, CalendarCheck, UserCheck, UserX, Clock, XCircle, Percent } from 'lucide-react';
import { inputInlineCls } from './broadcastUtils';
import { useApi, errorOf } from './queryClient';
import { Card, EmptyState, SkeletonRows, LoadError } from './ui';
import { addDays, dayLabel, PAY_METHOD, rupees, timeOf, todayIst } from './clinicUtils';

interface Report {
  from: string; to: string; days: number;
  totals: { collected: number; payments: number; discount: number; waiting: number; appointments: number; waitingPayment: number; confirmed: number; seen: number; noShow: number; cancelled: number; showRate: number | null };
  byMethod: Array<{ method: string; count: number; amount: number }>;
  byPerson: Array<{ person: string; count: number; amount: number; cash: number }>;
  byDoctor: Array<{ doctorId: string; doctor: string; booked: number; seen: number; noShow: number; cancelled: number; collected: number }>;
  daily: Array<{ day: string; appointments: number; collected: number }>;
  payments: Array<{ id: string; paidAt: string; method: string; amount: number; reference: string; takenBy: string; patientName: string; doctor: string; fee: number | null }>;
}
type Preset = 'today' | 'yesterday' | '7' | '30' | 'custom';

/**
 * Appointments → Collections (managers + Business Admin; the server refuses agents): money in for a day or a range
 * (by payment type, by who took it, by doctor, every payment with its reference) and how the appointments went.
 */
export default function ClinicCollections() {
  const today = todayIst();
  const [preset, setPreset] = useState<Preset>('today');
  const [custom, setCustom] = useState({ from: today, to: today });
  const range = preset === 'today' ? { from: today, to: today } : preset === 'yesterday' ? { from: addDays(today, -1), to: addDays(today, -1) }
    : preset === '7' ? { from: addDays(today, -6), to: today } : preset === '30' ? { from: addDays(today, -29), to: today } : custom;
  const q = useApi<Report>(`/api/clinic/report?from=${range.from}&to=${range.to}`, { keepPrevious: true, refetchInterval: 5 * 60000 });
  const r = q.data;
  const maxDay = Math.max(1, ...(r?.daily.map(d => d.collected) || [0]));
  const stat = (Icon: typeof Clock, label: string, value: string, tone = 'text-slate-800', hint?: string) => (
    <div className="bg-white rounded-xl border border-slate-200 p-3">
      <div className="text-xs text-slate-500 flex items-center gap-1"><Icon className="w-3.5 h-3.5" /> {label}</div>
      <div className={`text-xl font-bold ${tone}`}>{value}</div>
      {hint && <div className="text-xs text-slate-500">{hint}</div>}
    </div>
  );

  return (
    <div className="space-y-3" data-testid="clinic-collections">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 bg-white rounded-lg border border-slate-200 p-1" role="radiogroup" aria-label="Period">
          {([['today', 'Today'], ['yesterday', 'Yesterday'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['custom', 'Pick dates']] as const).map(([k, l]) => (
            <button key={k} role="radio" aria-checked={preset === k} onClick={() => setPreset(k)}
              className={`px-3 py-1.5 rounded-md text-sm font-semibold cursor-pointer ${preset === k ? 'bg-wa-teal text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{l}</button>
          ))}
        </div>
        {preset === 'custom' && (
          <>
            <input type="date" value={custom.from} max={custom.to} onChange={e => e.target.value && setCustom({ ...custom, from: e.target.value })} className={inputInlineCls} aria-label="From" />
            <input type="date" value={custom.to} min={custom.from} onChange={e => e.target.value && setCustom({ ...custom, to: e.target.value })} className={inputInlineCls} aria-label="To" />
          </>
        )}
        <span className="text-sm text-slate-600">{range.from === range.to ? dayLabel(range.from) : `${dayLabel(range.from)} – ${dayLabel(range.to)}`}</span>
      </div>

      {/* A refused range (e.g. over 92 days) shows its error, never the previous range's figures. */}
      {errorOf(q) ? <LoadError error={errorOf(q)} onRetry={() => q.refetch()} /> : !r ? <SkeletonRows rows={4} /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {stat(IndianRupee, 'Collected', rupees(r.totals.collected), 'text-emerald-700', `${r.totals.payments} payment${r.totals.payments === 1 ? '' : 's'}${r.totals.discount ? ` · ${rupees(r.totals.discount)} discount` : ''}`)}
            {stat(Clock, 'Waiting for payment', rupees(r.totals.waiting), r.totals.waiting ? 'text-amber-700' : 'text-slate-800', `${r.totals.waitingPayment} booking${r.totals.waitingPayment === 1 ? '' : 's'}`)}
            {stat(CalendarCheck, 'Appointments', String(r.totals.appointments), 'text-slate-800', `${r.totals.confirmed} confirmed, not seen yet`)}
            {stat(UserCheck, 'Seen', String(r.totals.seen), 'text-slate-800', r.totals.showRate === null ? undefined : `${r.totals.showRate}% showed up`)}
            {stat(UserX, 'No-shows', String(r.totals.noShow), r.totals.noShow ? 'text-red-700' : 'text-slate-800')}
            {stat(XCircle, 'Cancelled', String(r.totals.cancelled))}
          </div>

          <div className="grid lg:grid-cols-2 gap-3">
            <Card title="By payment type">
              {!r.byMethod.length ? <p className="text-sm text-slate-500">Nothing collected.</p> : (
                <table className="w-full text-sm" aria-label="By payment type">
                  <tbody className="divide-y divide-slate-100">
                    {r.byMethod.map(m => (
                      <tr key={m.method}><td className="py-1.5">{PAY_METHOD[m.method] || m.method}</td><td className="py-1.5 text-right text-slate-500">{m.count}</td><td className="py-1.5 text-right font-semibold tabular-nums">{rupees(m.amount)}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
            <Card title="Taken by (cash to hand over)">
              {!r.byPerson.length ? <p className="text-sm text-slate-500">Nothing collected.</p> : (
                <table className="w-full text-sm" aria-label="Taken by">
                  <thead className="text-xs text-slate-500"><tr><th className="text-left font-normal">Who</th><th className="text-right font-normal">Cash</th><th className="text-right font-normal">All</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {r.byPerson.map(p => (
                      <tr key={p.person}><td className="py-1.5 truncate max-w-[12rem]">{p.person}</td><td className="py-1.5 text-right tabular-nums">{rupees(p.cash)}</td><td className="py-1.5 text-right font-semibold tabular-nums">{rupees(p.amount)}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>

          <Card title="By doctor">
            {!r.byDoctor.length ? <p className="text-sm text-slate-500">No appointments.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[32rem]" aria-label="By doctor">
                  <thead className="text-xs text-slate-500 text-left"><tr><th className="font-normal py-1">Doctor</th><th className="font-normal text-right">Booked</th><th className="font-normal text-right">Seen</th><th className="font-normal text-right">No-show</th><th className="font-normal text-right">Cancelled</th><th className="font-normal text-right">Collected</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {r.byDoctor.map(d => (
                      <tr key={d.doctorId}><td className="py-1.5 font-semibold">{d.doctor}</td><td className="text-right tabular-nums">{d.booked}</td><td className="text-right tabular-nums">{d.seen}</td><td className="text-right tabular-nums">{d.noShow}</td><td className="text-right tabular-nums">{d.cancelled}</td><td className="text-right font-semibold tabular-nums">{rupees(d.collected)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {r.days > 1 && (
            <Card title="Day by day">
              <ul className="space-y-1" aria-label="Day by day">
                {r.daily.map(d => (
                  <li key={d.day} className="flex items-center gap-2 text-xs">
                    <span className="w-24 shrink-0 text-slate-600">{dayLabel(d.day)}</span>
                    <span className="flex-1 bg-slate-100 rounded h-4 overflow-hidden"><span className="block h-4 bg-emerald-500 rounded" style={{ width: `${Math.round((d.collected / maxDay) * 100)}%` }} /></span>
                    <span className="w-20 text-right font-semibold tabular-nums">{rupees(d.collected)}</span>
                    <span className="w-16 text-right text-slate-500">{d.appointments} appt</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title={<span className="flex items-center gap-2"><Percent className="w-4 h-4" /> Payments</span>}>
            {!r.payments.length ? <EmptyState icon={IndianRupee} title="No payments" text="Payments marked paid or paid online show here." /> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[44rem]" aria-label="Payments">
                  <thead className="text-xs text-slate-500 text-left"><tr><th className="font-normal py-1">When</th><th className="font-normal">Patient</th><th className="font-normal">Doctor</th><th className="font-normal">Type</th><th className="font-normal">Reference</th><th className="font-normal">Taken by</th><th className="font-normal text-right">Amount</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {r.payments.map(p => (
                      <tr key={p.id}>
                        <td className="py-1.5 whitespace-nowrap">{r.days > 1 ? `${dayLabel(new Date(Date.parse(p.paidAt) + 330 * 60000).toISOString().slice(0, 10))}, ` : ''}{timeOf(p.paidAt)}</td>
                        <td>{p.patientName}</td><td>{p.doctor}</td><td>{PAY_METHOD[p.method] || p.method}</td>
                        <td className="font-mono text-xs">{p.reference || '—'}</td><td className="truncate max-w-[10rem]">{p.takenBy}</td>
                        <td className="text-right font-semibold tabular-nums">{rupees(p.amount)}{p.fee !== null && p.amount < p.fee ? <span className="block text-xs text-amber-700 font-normal">fee {rupees(p.fee)}</span> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
