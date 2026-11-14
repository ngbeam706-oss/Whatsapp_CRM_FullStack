// The "more filters" row shared by the Inbox and the Leads page (helpers in src/leadFilterUtils.ts).
import { inputInlineCls } from './broadcastUtils';
import { RANGE_LABEL, TYPE_FILTER_LABEL, useFilterOptions, type DateRange, type MoreFilterValues } from './leadFilterUtils';
import type { StatusType } from './leadStatuses';

/** Date range + status type, source, ad, tag, STOP. */
export function MoreFilters({ value, onChange, compact = false }: { value: MoreFilterValues; onChange: (v: MoreFilterValues) => void; compact?: boolean }) {
  const opts = useFilterOptions();
  const set = (patch: Partial<MoreFilterValues>) => onChange({ ...value, ...patch });
  const cls = `${inputInlineCls} ${compact ? 'py-1 text-xs' : ''}`;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="more-filters">
      <select value={value.range} onChange={e => set({ range: e.target.value as DateRange })} className={cls} aria-label="Active in">
        {(Object.keys(RANGE_LABEL) as DateRange[]).map(r => <option key={r} value={r}>{RANGE_LABEL[r]}</option>)}
      </select>
      {value.range === 'custom' && (
        <>
          <input type="date" value={value.from} onChange={e => set({ from: e.target.value })} className={cls} aria-label="From" />
          <input type="date" value={value.to} onChange={e => set({ to: e.target.value })} className={cls} aria-label="To" />
        </>
      )}
      <select value={value.statusType} onChange={e => set({ statusType: e.target.value as MoreFilterValues['statusType'] })} className={cls} aria-label="Kind of status">
        <option value="">Any kind of status</option>
        {(Object.keys(TYPE_FILTER_LABEL) as StatusType[]).map(t => <option key={t} value={t}>{TYPE_FILTER_LABEL[t]}</option>)}
      </select>
      <select value={value.source} onChange={e => set({ source: e.target.value })} className={cls} aria-label="Source">
        <option value="">Any source</option>
        {(opts?.sources || []).map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      {!!opts?.ads.length && (
        <select value={value.adId} onChange={e => set({ adId: e.target.value })} className={cls} aria-label="Ad">
          <option value="">Any ad</option>
          {opts.ads.map(a => <option key={a.id} value={a.id}>{a.headline}</option>)}
        </select>
      )}
      {!!opts?.tags.length && (
        <select value={value.tag} onChange={e => set({ tag: e.target.value })} className={cls} aria-label="Tag">
          <option value="">Any tag</option>
          {opts.tags.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      )}
      <label className="flex items-center gap-1 text-slate-600" title="Wrote again after a long silence (Settings -> Lead assignment)"><input type="checkbox" checked={!!value.returning} onChange={e => set({ returning: e.target.checked })} /> Returning</label>
      <label className="flex items-center gap-1 text-slate-600"><input type="checkbox" checked={value.optedOut} onChange={e => set({ optedOut: e.target.checked })} /> Replied STOP</label>
    </div>
  );
}
