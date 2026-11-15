// Filters by customer fields (docs/progress/customer-import.md, D4), shared by the Leads page, the Inbox and broadcast
// audiences. Several filters are AND-ed. The server checks every filter again (server/customFields.cjs
// cleanCustomFilters): private fields only for managers and the Business Admin, values by type.
import { Lock, Plus, X } from 'lucide-react';
import { inputInlineCls } from './broadcastUtils';
import { useFilterableFields, type CustomFilterValue } from './customFilterUtils';

const PRESETS: Array<[string, string]> = [['', 'Dates…'], ['overdue', 'Overdue'], ['today', 'Today'], ['this_week', 'This week'], ['next_7', 'Next 7 days'], ['next_30', 'Next 30 days']];

export function CustomFieldFilters({ value, onChange, allowText = true, compact = false }: { value: CustomFilterValue[]; onChange: (v: CustomFilterValue[]) => void; allowText?: boolean; compact?: boolean }) {
  const { fields } = useFilterableFields(allowText);
  if (!fields.length) return null;
  const cls = `${inputInlineCls} ${compact ? 'py-1 text-xs' : ''}`;
  const set = (i: number, patch: Partial<CustomFilterValue>) => onChange(value.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const unused = fields.filter(f => !value.some(v => v.key === f.key));
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="custom-filters">
      {value.map((v, i) => {
        const f = fields.find(x => x.key === v.key);
        if (!f) return null;
        return (
          <span key={v.key} className="inline-flex flex-wrap items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg px-1.5 py-1" data-testid="custom-filter">
            <span className="font-semibold text-slate-700 flex items-center gap-0.5">{f.label}{f.private && <Lock className="w-3 h-3 text-slate-400" aria-label="private" />}</span>
            {(f.type === 'number' || f.type === 'amount') && (
              <>
                <input inputMode="decimal" value={v.min ?? ''} onChange={e => set(i, { min: e.target.value })} placeholder="from" className={`${cls} w-20`} aria-label={`${f.label} at least`} />
                <span>–</span>
                <input inputMode="decimal" value={v.max ?? ''} onChange={e => set(i, { max: e.target.value })} placeholder="to" className={`${cls} w-20`} aria-label={`${f.label} at most`} />
              </>
            )}
            {f.type === 'date' && (
              <>
                <select value={v.preset || ''} onChange={e => set(i, { preset: e.target.value, from: '', to: '' })} className={cls} aria-label={`${f.label} when`}>
                  {PRESETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                {!v.preset && (
                  <>
                    <input type="date" value={v.from || ''} onChange={e => set(i, { from: e.target.value })} className={cls} aria-label={`${f.label} from`} />
                    <input type="date" value={v.to || ''} onChange={e => set(i, { to: e.target.value })} className={cls} aria-label={`${f.label} to`} />
                  </>
                )}
              </>
            )}
            {f.type === 'choice' && (
              <select value={v.values?.[0] || ''} onChange={e => set(i, { values: e.target.value ? [e.target.value] : [] })} className={cls} aria-label={`${f.label} is`}>
                <option value="">Any</option>
                {f.options.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            )}
            {f.type === 'yesno' && (
              <select value={v.value === true ? 'yes' : v.value === false ? 'no' : ''} onChange={e => set(i, { value: e.target.value === 'yes' ? true : e.target.value === 'no' ? false : undefined })} className={cls} aria-label={`${f.label} yes or no`}>
                <option value="">Any</option><option value="yes">Yes</option><option value="no">No</option>
              </select>
            )}
            {f.type === 'text' && (
              <input value={v.contains ?? ''} onChange={e => set(i, { contains: e.target.value.slice(0, 40) })} placeholder="contains" className={`${cls} w-28`} aria-label={`${f.label} contains`} />
            )}
            <button onClick={() => onChange(value.filter((_, j) => j !== i))} className="text-slate-400 hover:text-slate-700 cursor-pointer" aria-label={`Remove the ${f.label} filter`}><X className="w-3.5 h-3.5" /></button>
          </span>
        );
      })}
      {value.length > 0 && (
        <button type="button" onClick={() => onChange([])} className="text-wa-teal font-semibold hover:underline cursor-pointer" data-testid="clear-custom-filters">Clear field filters</button>
      )}
      {unused.length > 0 && value.length < 10 && (
        <label className="inline-flex items-center gap-1 text-slate-600">
          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
          <select value="" onChange={e => { if (e.target.value) onChange([...value, { key: e.target.value }]); }} className={cls} aria-label="Filter by a customer field">
            <option value="">Customer field…</option>
            {unused.map(f => <option key={f.key} value={f.key}>{f.label}{f.private ? ' (private)' : ''}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}
