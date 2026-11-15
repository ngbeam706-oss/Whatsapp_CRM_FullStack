// Settings -> Customer fields (docs/progress/customer-import.md, D1): the business's own extra details for its
// customers (CIBIL score, loan amount, EMI date…). Managers and the Business Admin add, rename, reorder, hide and mark
// fields private (agents then see "Hidden"). Plan limit max_custom_fields; the server checks everything.
import { useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, IdCard, Info, Lock, LockOpen, Plus } from 'lucide-react';
import { api, errorMessage, inputCls, inputInlineCls } from './broadcastUtils';
import { refreshApi, useApi } from './queryClient';
import { BUTTON, EmptyState, LoadError, PageHeader, SkeletonRows } from './ui';
import type { CustomField, CustomFieldType } from './importUtils';
import type { ShowToast } from './types';

interface FieldsResponse { ready: boolean; fields: CustomField[]; types: Array<{ key: CustomFieldType; label: string }>; max: number | null; canEdit: boolean }

const TYPE_HELP: Record<CustomFieldType, string> = {
  text: 'Any short text, e.g. branch, occupation.', number: 'A number, e.g. CIBIL score.', amount: 'Rupees, e.g. loan amount (₹3,00,000).',
  date: 'A date, e.g. EMI date or next visit.', choice: 'One of a list you give, e.g. Loan type: Home / Car / Personal.', yesno: 'Yes or no, e.g. KYC done.',
};

export default function CustomerFieldsScreen({ showToast }: { showToast: ShowToast }) {
  const q = useApi<FieldsResponse>('/api/customer-fields');
  const d = q.data;
  const fields = d?.fields || [];
  const [busy, setBusy] = useState('');
  const [adding, setAdding] = useState<{ label: string; type: CustomFieldType; options: string; private: boolean }>({ label: '', type: 'text', options: '', private: false });
  const full = d?.max != null && fields.length >= d.max;

  const run = async (id: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(id);
    try { await fn(); showToast(done); await refreshApi('/api/customer-fields'); return true; } catch (e) { showToast(errorMessage(e)); return false; } finally { setBusy(''); }
  };
  const patch = (f: CustomField, body: Record<string, unknown>, done: string) => run(f.key, () => api(`/api/customer-fields/${f.key}`, { method: 'PATCH', body }), done);
  const moveBy = (i: number, dir: -1 | 1) => {
    const keys = fields.map(f => f.key);
    const j = i + dir;
    if (j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    void run('order', () => api('/api/customer-fields/order', { method: 'PUT', body: { keys } }), 'Order saved');
  };
  const add = async (e: FormEvent) => {
    e.preventDefault();
    const body = { label: adding.label.trim(), type: adding.type, private: adding.private, ...(adding.type === 'choice' ? { options: adding.options.split(/[\n,]/).map(s => s.trim()).filter(Boolean) } : {}) };
    if (await run('add', () => api('/api/customer-fields', { method: 'POST', body }), `"${body.label}" added`)) setAdding({ label: '', type: 'text', options: '', private: false });
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-100" data-testid="customer-fields">
      <div className="max-w-4xl mx-auto px-4 py-5 space-y-4">
        <PageHeader icon={IdCard} title="Customer fields" help="Extra details you keep about each customer. They show on the chat's side panel and come from imports or your team." />
        {q.error && <LoadError error={q.error.message} onRetry={() => q.refetch()} />}
        {!d && !q.error && <SkeletonRows rows={4} label="Loading customer fields" />}
        {d && !d.ready && <EmptyState icon={IdCard} title="Not ready yet" text="Customer fields need a database update (SQL 20261142). Ask the platform team." />}
        {d && d.ready && (
          <>
            {!fields.length ? <EmptyState icon={IdCard} title="No customer fields yet" text="Add one below, or create them while importing a customer file (Leads → Import customers)." />
              : (
                <section className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100" aria-label="Fields">
                  {fields.map((f, i) => (
                    <div key={f.key} className={`p-3 flex flex-wrap items-center gap-2 ${f.hidden ? 'bg-slate-50' : ''}`} data-testid="field-row">
                      <div className="flex flex-col">
                        <button onClick={() => moveBy(i, -1)} disabled={i === 0 || !!busy} className="p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-30 cursor-pointer" aria-label={`Move ${f.label} up`}><ArrowUp className="w-3.5 h-3.5" /></button>
                        <button onClick={() => moveBy(i, 1)} disabled={i === fields.length - 1 || !!busy} className="p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-30 cursor-pointer" aria-label={`Move ${f.label} down`}><ArrowDown className="w-3.5 h-3.5" /></button>
                      </div>
                      <input defaultValue={f.label} key={`${f.key}-${f.label}`} maxLength={60} aria-label={`Name of ${f.label}`}
                        onBlur={e => { const v = e.target.value.trim(); if (v && v !== f.label) void patch(f, { label: v }, `Renamed to "${v}"`); else e.target.value = f.label; }}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                        className={`${inputInlineCls} w-48 font-semibold`} />
                      <span className="text-xs text-slate-500">{d.types.find(t => t.key === f.type)?.label || f.type}{f.type === 'choice' ? `: ${f.options.join(', ')}` : ''}</span>
                      <div className="flex-1" />
                      <button onClick={() => void patch(f, { private: !f.private }, f.private ? `"${f.label}" visible to agents` : `"${f.label}" is private`)} disabled={!!busy} className={BUTTON.quiet} aria-label={f.private ? `Make ${f.label} visible to agents` : `Make ${f.label} private`}>
                        {f.private ? <><Lock className="w-3.5 h-3.5" /> Private</> : <><LockOpen className="w-3.5 h-3.5" /> Everyone</>}
                      </button>
                      <button onClick={() => void patch(f, { hidden: !f.hidden }, f.hidden ? `"${f.label}" shown` : `"${f.label}" hidden`)} disabled={!!busy} className={BUTTON.quiet} aria-label={f.hidden ? `Show ${f.label}` : `Hide ${f.label}`}>
                        {f.hidden ? <><Eye className="w-3.5 h-3.5" /> Show</> : <><EyeOff className="w-3.5 h-3.5" /> Hide</>}
                      </button>
                    </div>
                  ))}
                </section>
              )}

            <form onSubmit={add} className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
              <div className="text-sm font-semibold text-slate-800 flex items-center gap-2"><Plus className="w-4 h-4" /> Add a field</div>
              <div className="grid sm:grid-cols-[1fr_auto_auto] gap-2 items-end">
                <label className="text-xs font-medium text-slate-700">Name
                  <input required maxLength={60} value={adding.label} onChange={e => setAdding(a => ({ ...a, label: e.target.value }))} placeholder="e.g. CIBIL score" className={`${inputCls} mt-1`} />
                </label>
                <label className="text-xs font-medium text-slate-700">Type
                  <select value={adding.type} onChange={e => setAdding(a => ({ ...a, type: e.target.value as CustomFieldType }))} className={`${inputCls} mt-1`} aria-label="Type of the new field">
                    {(d.types || []).map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </select>
                </label>
                <button type="submit" disabled={busy === 'add' || full || !adding.label.trim() || (adding.type === 'choice' && !adding.options.trim())} className={BUTTON.primary}>
                  {busy === 'add' ? 'Adding…' : full ? `Up to ${d.max}` : 'Add'}
                </button>
              </div>
              {adding.type === 'choice' && (
                <label className="block text-xs font-medium text-slate-700">Choices (comma or one per line)
                  <textarea value={adding.options} onChange={e => setAdding(a => ({ ...a, options: e.target.value }))} rows={2} placeholder="Home, Car, Personal" className={`${inputCls} mt-1`} />
                </label>
              )}
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={adding.private} onChange={e => setAdding(a => ({ ...a, private: e.target.checked }))} /> <Lock className="w-3.5 h-3.5" /> Private: only managers and the Business Admin see it</label>
              <p className="text-xs text-slate-500">{TYPE_HELP[adding.type]}</p>
            </form>

            <div className="text-xs text-slate-500 flex items-start gap-1.5"><Info className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
              Mark money, credit, ID and health details private. Private values are never shown to agents and never given to the AI assistant.
              {d.max != null && ` Your plan allows ${d.max} fields (${fields.length} used).`}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
