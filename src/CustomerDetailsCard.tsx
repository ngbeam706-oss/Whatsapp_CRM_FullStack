// Customer details card (docs/progress/customer-import.md, D1): the business's own fields for one customer, in the
// chat's side panel and on the Leads page. Everyone sees normal fields; PRIVATE values only the Business Admin and
// managers (agents see "Hidden"), and only they edit (server/customFields.cjs checks both, plus lead ownership).
// The number is sent in the POST body, never in an address.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { IdCard, Lock, Pencil, Save, X } from 'lucide-react';
import { api, errorMessage, inputCls } from './broadcastUtils';
import { queryClient } from './queryClient';
import { BUTTON, LoadError, SkeletonRows } from './ui';
import type { ShowToast } from './types';
import { showCustomValue, type CustomFieldType } from './importUtils';

export interface DetailField { key: string; label: string; type: CustomFieldType; options: string[]; private: boolean; hidden: boolean; value: string | number | boolean | null }
interface DetailsResponse { fields: DetailField[]; canEdit: boolean; importedAt?: string | null; importName?: string | null }

const keyOf = (phone: string) => ['customer-details', phone];

/** A value as people read it: ₹3,00,000 · 05 Dec 2026 · Yes. */
const showValue = showCustomValue;

export default function CustomerDetailsCard({ phone, showToast, compact = false }: { phone: string; showToast: ShowToast; compact?: boolean }) {
  const q = useQuery<DetailsResponse, Error>({
    queryKey: keyOf(phone),
    queryFn: () => api<DetailsResponse>('/api/customer-details', { method: 'POST', body: { phone } }),
    staleTime: 30000,
  });
  const [editing, setEditing] = useState<Record<string, string> | null>(null);
  const [saving, setSaving] = useState(false);
  const d = q.data ? { ...q.data, fields: Array.isArray(q.data.fields) ? q.data.fields : [] } : undefined;
  // No customer fields set up (or the SQL not run yet): nothing in the chat panel; a short note on the Leads page.
  if (d && !d.fields.length && !d.importName) return compact ? <p className="text-xs text-slate-500" data-testid="customer-details-empty">No customer fields yet. Managers add them in Settings → Customer fields, or while importing a file.</p> : null;
  if (q.error && /SQL 20261142/.test(q.error.message)) return null;

  const startEdit = () => setEditing(Object.fromEntries((d?.fields || []).filter(f => !f.hidden).map(f => [f.key, f.value === null || f.value === undefined ? '' : f.type === 'yesno' ? (f.value ? 'yes' : 'no') : String(f.value)])));
  const save = async () => {
    if (!editing || !d) return;
    const values: Record<string, string | null> = {};
    for (const f of d.fields) {
      if (f.hidden || !(f.key in editing)) continue;
      const before = f.value === null || f.value === undefined ? '' : f.type === 'yesno' ? (f.value ? 'yes' : 'no') : String(f.value);
      if (editing[f.key] !== before) values[f.key] = editing[f.key].trim() === '' ? null : editing[f.key];
    }
    if (!Object.keys(values).length) { setEditing(null); return; }
    setSaving(true);
    try {
      const r = await api<DetailsResponse>('/api/customer-details/save', { method: 'POST', body: { phone, values } });
      queryClient.setQueryData(keyOf(phone), (old: DetailsResponse | undefined) => ({ ...(old || r), ...r }));
      setEditing(null);
      showToast('Customer details saved');
    } catch (e) { showToast(errorMessage(e)); } finally { setSaving(false); }
  };

  return (
    <section className={compact ? 'space-y-2' : 'border-t border-slate-100 pt-3 space-y-2'} data-testid="customer-details" aria-label="Customer details">
      <div className="flex items-center gap-1.5">
        <IdCard className="w-4 h-4 text-wa-teal" aria-hidden="true" />
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 flex-1">Customer details</h3>
        {d?.canEdit && !editing && d.fields.length > 0 && <button onClick={startEdit} className="text-xs font-semibold text-wa-teal flex items-center gap-1 cursor-pointer" aria-label="Edit customer details"><Pencil className="w-3 h-3" /> Edit</button>}
      </div>
      {d?.importName && <div className="text-xs text-slate-500" data-testid="imported-from">Imported · <span className="font-semibold text-slate-700">{d.importName}</span></div>}
      {q.error ? <LoadError error={q.error.message} onRetry={() => q.refetch()} />
        : !d ? <SkeletonRows rows={2} label="Loading customer details" />
          : editing ? (
            <div className="space-y-2">
              {d.fields.filter(f => !f.hidden).map(f => (
                <label key={f.key} className="block">
                  <span className="text-xs font-semibold text-slate-600 flex items-center gap-1">{f.label}{f.private && <Lock className="w-3 h-3 text-slate-400" aria-label="private" />}</span>
                  <FieldInput field={f} value={editing[f.key] ?? ''} onChange={v => setEditing(e => ({ ...(e || {}), [f.key]: v }))} />
                </label>
              ))}
              <div className="flex gap-2">
                <button onClick={save} disabled={saving} className={BUTTON.primary}><Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save'}</button>
                <button onClick={() => setEditing(null)} disabled={saving} className={BUTTON.quiet}><X className="w-3.5 h-3.5" /> Cancel</button>
              </div>
            </div>
          ) : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              {d.fields.map(f => (
                <div key={f.key} className="contents" data-testid="detail-row">
                  <dt className="text-slate-500 flex items-center gap-1">{f.label}{f.private && <Lock className="w-3 h-3 text-slate-400" aria-label="private" />}</dt>
                  <dd className="text-slate-800 font-medium break-words">{f.hidden ? <span className="text-slate-400 italic">Hidden</span> : showValue(f)}</dd>
                </div>
              ))}
            </dl>
          )}
    </section>
  );
}

/** One editable value, shaped by its type. Values are checked again on the server. */
function FieldInput({ field, value, onChange }: { field: DetailField; value: string; onChange: (v: string) => void }) {
  const cls = `${inputCls} mt-0.5`;
  if (field.type === 'choice') {
    return (
      <select value={value} onChange={e => onChange(e.target.value)} className={cls} aria-label={field.label}>
        <option value="">–</option>
        {field.options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (field.type === 'yesno') {
    return (
      <select value={value} onChange={e => onChange(e.target.value)} className={cls} aria-label={field.label}>
        <option value="">–</option><option value="yes">Yes</option><option value="no">No</option>
      </select>
    );
  }
  return (
    <input value={value} onChange={e => onChange(e.target.value)} aria-label={field.label} maxLength={500}
      type={field.type === 'date' ? 'date' : 'text'} inputMode={field.type === 'number' || field.type === 'amount' ? 'decimal' : undefined} className={cls} />
  );
}
