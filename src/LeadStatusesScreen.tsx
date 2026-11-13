import { useState, type FormEvent } from 'react';
import { Tags, Plus, ArrowUp, ArrowDown, Trash2, Eye, EyeOff, Info } from 'lucide-react';
import { api, errorMessage, inputCls, inputInlineCls } from './broadcastUtils';
import { refreshApi } from './queryClient';
import { BUTTON, Card, Modal, PageHeader, SkeletonRows } from './ui';
import { COLOR_CLS, TYPE_HELP, useLeadStatuses, type LeadStatus, type StatusType } from './leadStatuses';
import type { ShowToast } from './types';

/**
 * Settings -> Lead statuses (managers and the Business Admin; the server refuses agents too).
 * The business's own pipeline statuses: add, rename, recolour, reorder, hide, choose the type, remove (after
 * moving its chats). Automatic moves, bookings to Meta, analytics and team ranking use the TYPE, never the name.
 */
export default function LeadStatusesScreen({ showToast }: { showToast: ShowToast }) {
  const { all, data, loading, error } = useLeadStatuses();
  const [busy, setBusy] = useState('');
  const [adding, setAdding] = useState<{ label: string; type: StatusType; color: string }>({ label: '', type: 'working', color: 'teal' });
  const [removing, setRemoving] = useState<LeadStatus | null>(null);
  const types = data?.types || [];
  const colors = data?.colors || Object.keys(COLOR_CLS);
  const counts = data?.counts || {};
  const typeLabel = (t: StatusType) => types.find(x => x.key === t)?.label || t;

  const run = async (id: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(id);
    try { await fn(); showToast(done); await Promise.all([refreshApi('/api/lead-statuses'), refreshApi('/api/pipeline'), refreshApi('/api/inbox')]); return true; } catch (e) { showToast(errorMessage(e)); return false; } finally { setBusy(''); }
  };
  const patch = (s: LeadStatus, body: Partial<LeadStatus>, done: string) => run(s.key, () => api(`/api/lead-statuses/${s.key}`, { method: 'PATCH', body }), done);
  const moveBy = (i: number, d: -1 | 1) => {
    const keys = all.map(s => s.key);
    const j = i + d;
    if (j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    run('order', () => api('/api/lead-statuses/order', { method: 'PUT', body: { keys } }), 'Order saved');
  };
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (await run('add', () => api('/api/lead-statuses', { method: 'POST', body: adding }), `"${adding.label.trim()}" added`)) setAdding(a => ({ ...a, label: '' }));
  };
  const full = all.length >= (data?.max || 12);

  return (
    <div className="flex-1 overflow-y-auto bg-slate-100" data-testid="lead-statuses">
      <div className="max-w-4xl mx-auto px-4 py-5 space-y-4">
        <PageHeader icon={Tags} title="Lead statuses" help="Your own pipeline steps, in your words. Only your business sees them." />

        {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{errorMessage(error)}</div>}
        {loading && <SkeletonRows rows={4} label="Loading statuses" />}

        {!loading && (
          <>
            <Card title="Pipeline preview">
              <div className="flex gap-2 overflow-x-auto pb-1" data-testid="status-preview">
                {all.filter(s => s.active).map(s => (
                  <div key={s.key} className={`flex-shrink-0 rounded-lg border px-3 py-2 text-xs font-semibold flex items-center gap-1.5 ${COLOR_CLS[s.color]?.cls || COLOR_CLS.slate.cls}`}>
                    <span className={`w-2 h-2 rounded-full ${COLOR_CLS[s.color]?.dot || COLOR_CLS.slate.dot}`} />{s.label}
                    <span className="opacity-60 font-normal">{counts[s.key] ?? ''}</span>
                  </div>
                ))}
              </div>
            </Card>

            <section className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100" aria-label="Statuses">
              {all.map((s, i) => (
                <div key={s.key} className={`p-3 flex flex-wrap items-center gap-2 ${s.active ? '' : 'bg-slate-50'}`} data-testid="status-row">
                  <div className="flex flex-col">
                    <button onClick={() => moveBy(i, -1)} disabled={i === 0 || !!busy} className="p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-30 cursor-pointer" aria-label={`Move ${s.label} up`}><ArrowUp className="w-3.5 h-3.5" /></button>
                    <button onClick={() => moveBy(i, 1)} disabled={i === all.length - 1 || !!busy} className="p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-30 cursor-pointer" aria-label={`Move ${s.label} down`}><ArrowDown className="w-3.5 h-3.5" /></button>
                  </div>
                  <span className={`w-3 h-3 rounded-full flex-shrink-0 ${COLOR_CLS[s.color]?.dot || COLOR_CLS.slate.dot}`} />
                  <input defaultValue={s.label} key={`${s.key}-${s.label}`} maxLength={30} aria-label={`Name of ${s.label}`}
                    onBlur={e => { const v = e.target.value.trim(); if (v && v !== s.label) patch(s, { label: v }, `Renamed to "${v}"`); else e.target.value = s.label; }}
                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    className={`${inputInlineCls} w-44 font-semibold`} />
                  <select value={s.color} disabled={!!busy} onChange={e => patch(s, { color: e.target.value }, 'Colour changed')} className={inputInlineCls} aria-label={`Colour of ${s.label}`}>
                    {colors.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <select value={s.type} disabled={!!busy || s.key === 'new'} onChange={e => patch(s, { type: e.target.value as StatusType }, `"${s.label}" now counts as ${typeLabel(e.target.value as StatusType)}`)} className={inputInlineCls} aria-label={`Type of ${s.label}`}
                    title={s.key === 'new' ? 'New chats start here, so this is always of type New.' : TYPE_HELP[s.type]}>
                    {types.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </select>
                  <span className="text-xs text-slate-500">{counts[s.key] ?? 0} chats</span>
                  <div className="flex-1" />
                  {s.key !== 'new' && (
                    <button onClick={() => patch(s, { active: !s.active }, s.active ? `"${s.label}" hidden` : `"${s.label}" shown`)} disabled={!!busy} className={BUTTON.quiet} aria-label={s.active ? `Hide ${s.label}` : `Show ${s.label}`}>
                      {s.active ? <><EyeOff className="w-3.5 h-3.5" /> Hide</> : <><Eye className="w-3.5 h-3.5" /> Show</>}
                    </button>
                  )}
                  {s.key !== 'new' && <button onClick={() => setRemoving(s)} disabled={!!busy} className={BUTTON.quiet} aria-label={`Remove ${s.label}`}><Trash2 className="w-3.5 h-3.5 text-red-600" /></button>}
                  {s.key === 'new' && <span className="text-xs text-slate-400" title="New chats start here">start</span>}
                </div>
              ))}
            </section>

            <form onSubmit={add} className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
              <div className="text-sm font-semibold text-slate-800 flex items-center gap-2"><Plus className="w-4 h-4" /> Add a status</div>
              <div className="grid sm:grid-cols-[1fr_auto_auto_auto] gap-2 items-end">
                <label className="text-xs font-medium text-slate-700">Name
                  <input required maxLength={30} value={adding.label} onChange={e => setAdding(a => ({ ...a, label: e.target.value }))} placeholder="e.g. Called back" className={`${inputCls} mt-1`} />
                </label>
                <label className="text-xs font-medium text-slate-700">Kind
                  <select value={adding.type} onChange={e => setAdding(a => ({ ...a, type: e.target.value as StatusType }))} className={`${inputCls} mt-1`} aria-label="Kind of the new status">
                    {types.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </select>
                </label>
                <label className="text-xs font-medium text-slate-700">Colour
                  <select value={adding.color} onChange={e => setAdding(a => ({ ...a, color: e.target.value }))} className={`${inputCls} mt-1`}>
                    {colors.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <button type="submit" disabled={busy === 'add' || full || !adding.label.trim()} className={BUTTON.primary}>{full ? `Up to ${data?.max || 12}` : 'Add'}</button>
              </div>
              <p className="text-xs text-slate-500">{TYPE_HELP[adding.type]}</p>
            </form>

            <div className="text-xs text-slate-500 flex items-start gap-1.5"><Info className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
              The kind decides what happens automatically: the bot moves chats to your first visible status of the needed kind,
              and Booked / Done / Returning kinds count as conversions (analytics, team ranking, bookings to Meta). Renaming never changes a chat.
            </div>
          </>
        )}
      </div>

      {removing && (
        <RemoveDialog status={removing} chats={counts[removing.key] ?? 0} others={all.filter(s => s.key !== removing.key && s.active)}
          onClose={() => setRemoving(null)}
          onRemove={async (moveTo) => {
            const q = moveTo ? `?moveTo=${encodeURIComponent(moveTo)}` : '';
            if (await run('remove', () => api(`/api/lead-statuses/${removing.key}${q}`, { method: 'DELETE' }), `"${removing.label}" removed`)) setRemoving(null);
          }} busy={busy === 'remove'} />
      )}
    </div>
  );
}

/** "Remove a status": its chats must move to another status first (nothing is lost). */
function RemoveDialog({ status, chats, others, onClose, onRemove, busy }: { status: LeadStatus; chats: number; others: LeadStatus[]; onClose: () => void; onRemove: (moveTo: string | null) => void; busy: boolean }) {
  const [moveTo, setMoveTo] = useState(others.find(s => s.type === status.type)?.key || others[0]?.key || '');
  return (
    <Modal title={`Remove "${status.label}"?`} onClose={onClose}
      footer={<>
        <button onClick={onClose} className={BUTTON.secondary}>Cancel</button>
        <button onClick={() => onRemove(chats ? moveTo : null)} disabled={busy || (chats > 0 && !moveTo)} className={BUTTON.danger} data-testid="remove-status-ok">
          {chats ? `Move ${chats} chat${chats === 1 ? '' : 's'} and remove` : 'Remove'}
        </button>
      </>}>
      {chats > 0 ? (
        <label className="block text-sm">{chats} chat{chats === 1 ? ' is' : 's are'} in this status. Move {chats === 1 ? 'it' : 'them'} to
          <select value={moveTo} onChange={e => setMoveTo(e.target.value)} className={`${inputCls} mt-1`} aria-label="Move its chats to">
            {others.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
      ) : <p>No chats are in this status. You can also just hide it.</p>}
    </Modal>
  );
}
