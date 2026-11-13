import { useMemo, useState, type FormEvent } from 'react';
import { X, Send, Users, ShieldCheck, LifeBuoy, type LucideIcon } from 'lucide-react';
import { api, errorMessage, inputCls, btnPrimary, btnSecondary } from './broadcastUtils';
import { useApi, refreshApi } from './queryClient';
import { PRIORITIES, PRIORITY_INFO, type Priority, type Query, type QuerySettings } from './queryUtils';
import type { Role, ShowToast } from './types';

type Target = 'managers' | 'owner' | 'platform';

// Who each role can send a query to.
const TARGETS: Record<Role, Target[]> = {
  agent: ['managers', 'owner', 'platform'],
  manager: ['owner', 'platform'],
  owner: ['platform'],
};
const TARGET_INFO: Record<Target, { label: string; hint: string; icon: LucideIcon }> = {
  managers: { label: 'Managers', hint: 'Any manager (or the Business Admin) can pick it up. Good for approvals, customer escalations and "how do I…?".', icon: Users },
  owner: { label: 'Business Admin', hint: 'Only the Business Admin sees it. Good for access, plan or sensitive matters.', icon: ShieldCheck },
  platform: { label: 'Platform support', hint: 'For problems with the app itself, the WhatsApp connection or billing. Your Business Admin can see it too.', icon: LifeBuoy },
};

/** "Raise a query" for any staff member: to Managers, the Business Admin, or Platform support. */
interface RaiseForm { category: string; subject: string; description: string; priority: Priority; contactPhone: string }

export default function RaiseQueryModal({ role = 'agent', onClose, showToast }: { role?: Role; onClose: () => void; showToast: ShowToast }) {
  const targets = TARGETS[role] || TARGETS.agent;
  const [to, setTo] = useState<Target>(targets[0]);
  const [form, setForm] = useState<RaiseForm>({ category: '', subject: '', description: '', priority: 'normal', contactPhone: '' });
  const [busy, setBusy] = useState(false);

  // Categories (shared with the Queries screen and the inbox panel). Without them the form still works.
  const settings = useApi<QuerySettings>('/api/queries/settings', { staleTime: 5 * 60000 }).data || null;
  const cats = useMemo(() => (to === 'platform' ? settings?.categories?.platform : settings?.categories?.internal) || [], [to, settings]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { category: form.category || undefined, subject: form.subject, description: form.description, priority: form.priority };
      const r = to === 'platform'
        ? await api<{ query: Query }>('/api/support', { method: 'POST', body })
        : await api<{ query: Query }>('/api/queries', { method: 'POST', body: { ...body, kind: 'internal', addressedTo: to, contactPhone: form.contactPhone || undefined } });
      showToast(`Query ${r.query.ref} sent to ${TARGET_INFO[to].label}. You'll see updates under Queries.`);
      refreshApi(to === 'platform' ? '/api/support' : '/api/queries'); // show it in the open lists
      onClose();
    } catch (err) {
      showToast(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5 space-y-3">
        <div className="flex items-center">
          <h2 className="text-base font-bold text-slate-800">Raise a query</h2>
          <button type="button" onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-700 cursor-pointer"><X className="w-5 h-5" /></button>
        </div>

        <div>
          <div className="text-xs font-medium text-slate-700 mb-1">Send it to</div>
          <div className="grid gap-1.5">
            {targets.map(t => {
              const Icon = TARGET_INFO[t].icon;
              return (
                <label key={t} className={`flex gap-2 border rounded-lg p-2 cursor-pointer ${to === t ? 'border-wa-teal bg-teal-50/50' : 'border-slate-200'}`}>
                  <input type="radio" name="to" checked={to === t} onChange={() => { setTo(t); setForm(f => ({ ...f, category: '' })); }} className="mt-0.5" />
                  <span>
                    <span className="text-sm font-semibold text-slate-800 flex items-center gap-1.5"><Icon className="w-4 h-4 text-wa-teal" /> {TARGET_INFO[t].label}</span>
                    <span className="text-xs text-slate-500">{TARGET_INFO[t].hint}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        <label className="block text-xs font-medium text-slate-700">Category
          <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className={`${inputCls} mt-1`}>
            <option value="">Choose…</option>
            {cats.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="block text-xs font-medium text-slate-700">Subject
          <input required maxLength={120} value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} placeholder="One line, e.g. 'Refund approval for order 1042'" className={`${inputCls} mt-1`} />
        </label>
        <label className="block text-xs font-medium text-slate-700">Details
          <textarea rows={4} maxLength={4000} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            placeholder={to === 'platform' ? 'What happened, on which page, and when. A screenshot link helps.' : 'What you need and why.'} className={`${inputCls} mt-1`} />
        </label>
        <div className="grid sm:grid-cols-2 gap-2">
          <label className="block text-xs font-medium text-slate-700">Priority
            <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value as Priority }))} className={`${inputCls} mt-1`}>
              {PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_INFO[p].label}</option>)}
            </select>
          </label>
          {to !== 'platform' && (
            <label className="block text-xs font-medium text-slate-700">Customer number (optional)
              <input inputMode="numeric" value={form.contactPhone} onChange={e => setForm(f => ({ ...f, contactPhone: e.target.value }))} placeholder="Links the chat, e.g. 919876543210" className={`${inputCls} mt-1`} />
            </label>
          )}
        </div>
        {to === 'platform' && <div className="text-xs text-slate-500">Don't paste customers' personal details here: Platform support only needs to know about the app.</div>}

        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={busy || !form.subject.trim()} className={btnPrimary}><Send className="w-3.5 h-3.5" /> {busy ? 'Sending…' : 'Send query'}</button>
          <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
