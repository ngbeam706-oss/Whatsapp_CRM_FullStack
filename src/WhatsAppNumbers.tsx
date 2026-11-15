// Several WhatsApp numbers per business (docs/progress/multi-number.md, N3): the list of numbers on the
// WhatsApp page; the Business Admin adds, renames and removes extra numbers. Managers see the list only.
import { useState, type FormEvent } from 'react';
import { Phone, Plus, Pencil, Trash2, Check, X, Star } from 'lucide-react';
import { api, errorMessage, inputCls, btnPrimary, btnSecondary } from './broadcastUtils';
import { LoadError, SkeletonRows } from './ui';
import { useApi, refreshApi, errorOf } from './queryClient';
import type { ShowToast } from './types';
import MetaSetupGuide from './MetaSetupGuide';
import { EXTRA_NUMBER_GUIDE } from './metaGuides';

interface ExtraNumber {
  id: string; phoneNumber: string; wabaId: string; label: string; ownToken: boolean; tokenLast4: string | null;
  tokenUnreadable: boolean; status: 'active' | 'disabled'; addedBy: string | null; createdAt: string;
  /** This number's own bot welcome ('' = the Bot Flow's welcome). */
  welcomeMessage?: string;
}
interface NumbersResponse {
  main: { id: string; phoneNumber: string; wabaId: string; label: string } | null;
  numbers: ExtraNumber[];
  limit: number | null;
  used: number;
  planName: string;
  tableReady: boolean;
}
interface AddForm { label: string; phoneNumberId: string; wabaId: string; accessToken: string }
const EMPTY: AddForm = { label: '', phoneNumberId: '', wabaId: '', accessToken: '' };

const shown = (digits: string) => (digits ? `+${digits}` : '');

export default function WhatsAppNumbers({ isOwner, showToast }: { isOwner: boolean; showToast: ShowToast }) {
  const q = useApi<NumbersResponse>('/api/whatsapp/numbers');
  const data = q.data || null;
  const error = errorOf(q);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<AddForm>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [editing, setEditing] = useState<{ id: string; label: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [welcomeEdit, setWelcomeEdit] = useState<{ id: string; text: string } | null>(null);

  const [savingWelcome, setSavingWelcome] = useState(false);
  const saveWelcome = async () => {
    if (!welcomeEdit) return;
    setSavingWelcome(true);
    try {
      await api(`/api/whatsapp/numbers/${welcomeEdit.id}`, { method: 'PATCH', body: { welcomeMessage: welcomeEdit.text.trim() || null } });
      setWelcomeEdit(null);
      showToast('Welcome message saved');
      await reload();
    } catch (err) {
      showToast(errorMessage(err));
    } finally {
      setSavingWelcome(false);
    }
  };

  const reload = () => Promise.all([refreshApi('/api/whatsapp/numbers'), refreshApi('/api/inbox-numbers')]);
  const active = (data?.numbers || []).filter(n => n.status === 'active');
  const removed = (data?.numbers || []).filter(n => n.status !== 'active');
  const full = !!data && data.limit !== null && data.used >= data.limit;

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    try {
      const r = await api<{ verifiedName?: string; subscribeNote?: string | null }>('/api/whatsapp/numbers', {
        method: 'POST',
        body: { label: form.label.trim(), phoneNumberId: form.phoneNumberId.trim(), ...(form.wabaId.trim() ? { wabaId: form.wabaId.trim() } : {}), ...(form.accessToken.trim() ? { accessToken: form.accessToken.trim() } : {}) },
      });
      showToast(`Added ${form.label.trim()}${r.verifiedName ? ` (${r.verifiedName})` : ''}. Send "hi" to it to check.`);
      if (r.subscribeNote) showToast(r.subscribeNote);
      setForm(EMPTY);
      setAdding(false);
      await reload();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const rename = async () => {
    if (!editing) return;
    try {
      await api(`/api/whatsapp/numbers/${editing.id}`, { method: 'PATCH', body: { label: editing.label.trim() } });
      setEditing(null);
      showToast('Name saved');
      await reload();
    } catch (err) {
      showToast(errorMessage(err));
    }
  };

  const remove = async (id: string) => {
    try {
      await api(`/api/whatsapp/numbers/${id}`, { method: 'DELETE' });
      setRemoving(null);
      showToast('Number removed. Its chat history stays.');
      await reload();
    } catch (err) {
      showToast(errorMessage(err));
    }
  };

  /** Inline rename (Business Admin). */
  const nameCell = (id: string, label: string, fallback: string) => (
    editing?.id === id ? (
      <span className="flex items-center gap-1">
        <input value={editing.label} onChange={e => setEditing({ id, label: e.target.value })} maxLength={40} autoFocus
          onKeyDown={e => { if (e.key === 'Enter') rename(); if (e.key === 'Escape') setEditing(null); }}
          className="border border-slate-300 rounded px-1.5 py-0.5 text-xs w-36" aria-label="Number name" />
        <button onClick={rename} className="p-1 text-emerald-700 cursor-pointer" title="Save name"><Check className="w-3.5 h-3.5" /></button>
        <button onClick={() => setEditing(null)} className="p-1 text-slate-500 cursor-pointer" title="Cancel"><X className="w-3.5 h-3.5" /></button>
      </span>
    ) : (
      <span className="flex items-center gap-1">
        <span className="font-semibold text-slate-800">{label || fallback}</span>
        {isOwner && <button onClick={() => setEditing({ id, label })} className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer" title="Rename"><Pencil className="w-3 h-3" /></button>}
      </span>
    )
  );

  if (!data && !error) return <SkeletonRows rows={2} label="Loading your numbers" />;
  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3" data-testid="wa-numbers">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm font-semibold text-slate-800 flex items-center gap-2"><Phone className="w-4 h-4 text-emerald-600" /> Your WhatsApp numbers</div>
        {data && (
          <span className={`text-xs px-2 py-0.5 rounded-full border ${full ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-slate-50 border-slate-200 text-slate-600'}`} data-testid="numbers-usage">
            {data.used} of {data.limit === null ? 'unlimited' : data.limit} on your {data.planName || ''} plan
          </span>
        )}
        {isOwner && data?.main && !adding && (
          <button onClick={() => { setAdding(true); setFormError(''); }} disabled={full} className={`${btnPrimary} ml-auto`}
            title={full ? 'Your plan\'s number limit is reached. Ask the platform to upgrade.' : 'Connect another number'}>
            <Plus className="w-3.5 h-3.5" /> Add number
          </button>
        )}
      </div>
      <p className="text-xs text-slate-500">
        Customers can write to any of these numbers; each customer is one chat in the Inbox, and replies go from the number they last wrote to.
      </p>
      {error && <LoadError error={error} onRetry={() => q.refetch()} />}
      {data && !data.tableReady && <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">Extra numbers need the database update for several numbers (SQL 20261122). Ask the platform team.</div>}

      {data && (
        <ul className="divide-y divide-slate-100 border border-slate-100 rounded-lg text-xs">
          {data.main ? (
            <li className="flex flex-wrap items-center gap-2 px-3 py-2" data-testid="number-row">
              <Star className="w-3.5 h-3.5 text-amber-500" />
              {nameCell(data.main.id, data.main.label, 'Main number')}
              <span className="font-mono text-slate-600">{shown(data.main.phoneNumber)}</span>
              <span className="text-xs px-1.5 py-px rounded bg-emerald-50 border border-emerald-200 text-emerald-800 font-semibold">Main</span>
              <span className="ml-auto text-xs text-slate-400">Connection details above · broadcasts and follow-ups go from here</span>
            </li>
          ) : <li className="px-3 py-2 text-slate-500">Connect your main number first (above).</li>}
          {active.map(n => (
            <li key={n.id} className="flex flex-wrap items-center gap-2 px-3 py-2" data-testid="number-row">
              <Phone className="w-3.5 h-3.5 text-sky-600" />
              {nameCell(n.id, n.label, 'Extra number')}
              <span className="font-mono text-slate-600">{shown(n.phoneNumber)}</span>
              {n.ownToken
                ? <span className="text-xs text-slate-500">own token ••••{n.tokenLast4}</span>
                : <span className="text-xs text-slate-500">uses the main token</span>}
              {n.tokenUnreadable && <span className="text-xs text-red-700">token can't be read: remove and add again</span>}
              {n.welcomeMessage
                ? <span className="text-xs text-violet-700" title={n.welcomeMessage}>own welcome</span>
                : <span className="text-xs text-slate-400">bot flow welcome</span>}
              {isOwner && (
                <button onClick={() => setWelcomeEdit({ id: n.id, text: n.welcomeMessage || '' })}
                  className="text-xs text-wa-teal hover:underline cursor-pointer" title="Greet customers of this number in its own words">
                  Edit welcome
                </button>
              )}
              {welcomeEdit?.id === n.id && (
                <div className="basis-full space-y-1.5 pt-1" data-testid="welcome-editor">
                  <textarea value={welcomeEdit.text} onChange={e => setWelcomeEdit({ id: n.id, text: e.target.value })} rows={3} maxLength={1024}
                    aria-label="Welcome message for this number"
                    placeholder={`e.g. Welcome to ${n.label || 'our pharmacy'}! 👋 How can we help you today? (Empty = the Bot Flow's welcome.)`}
                    className={`${inputCls} text-xs`} />
                  <div className="flex items-center gap-2">
                    <button onClick={saveWelcome} disabled={savingWelcome} className={btnPrimary}><Check className="w-3.5 h-3.5" /> {savingWelcome ? 'Saving…' : 'Save welcome'}</button>
                    <button onClick={() => setWelcomeEdit(null)} className={btnSecondary}>Cancel</button>
                    <span className="text-xs text-slate-500">Sent above the bot&apos;s menu buttons to customers of this number. No health or cure claims.</span>
                  </div>
                </div>
              )}
              {isOwner && (removing === n.id ? (
                <span className="ml-auto flex items-center gap-1.5">
                  <span className="text-xs text-slate-700">Stop using this number here? History stays.</span>
                  <button onClick={() => remove(n.id)} className="px-2 py-0.5 rounded bg-red-600 text-white text-xs font-semibold cursor-pointer">Remove</button>
                  <button onClick={() => setRemoving(null)} className="px-2 py-0.5 rounded border border-slate-300 text-xs cursor-pointer">Cancel</button>
                </span>
              ) : (
                <button onClick={() => setRemoving(n.id)} className="ml-auto p-1 text-slate-400 hover:text-red-600 cursor-pointer" title="Remove number"><Trash2 className="w-3.5 h-3.5" /></button>
              ))}
            </li>
          ))}
          {removed.map(n => (
            <li key={n.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-slate-400">
              <Phone className="w-3.5 h-3.5" /> {n.label || 'Extra number'} <span className="font-mono">{shown(n.phoneNumber)}</span>
              <span className="text-xs">removed · history kept · add it again to bring it back</span>
            </li>
          ))}
        </ul>
      )}

      {isOwner && adding && (
        <form onSubmit={add} className="border border-slate-200 rounded-lg p-3 space-y-2.5 bg-slate-50" data-testid="add-number-form">
          <div className="grid sm:grid-cols-2 gap-2.5">
            <label className="text-xs font-medium text-slate-700">Name your team will see
              <input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} maxLength={40} placeholder='e.g. Pharmacy' className={`${inputCls} mt-1`} required />
            </label>
            <label className="text-xs font-medium text-slate-700">Phone number ID
              <input value={form.phoneNumberId} onChange={e => setForm(f => ({ ...f, phoneNumberId: e.target.value.trim() }))} inputMode="numeric" placeholder="e.g. 123456789012345" className={`${inputCls} mt-1 font-mono`} required />
            </label>
            <label className="text-xs font-medium text-slate-700">WhatsApp Business Account ID <span className="font-normal text-slate-500">(only if different)</span>
              <input value={form.wabaId} onChange={e => setForm(f => ({ ...f, wabaId: e.target.value.trim() }))} inputMode="numeric" placeholder={data?.main?.wabaId ? `Same as main: ${data.main.wabaId}` : ''} className={`${inputCls} mt-1 font-mono`} />
            </label>
            <label className="text-xs font-medium text-slate-700">Access token <span className="font-normal text-slate-500">(only if needed)</span>
              <input type="password" value={form.accessToken} onChange={e => setForm(f => ({ ...f, accessToken: e.target.value.trim() }))} autoComplete="off" placeholder="Leave empty to use the main token" className={`${inputCls} mt-1 font-mono`} />
            </label>
          </div>
          {formError && <div className="p-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{formError}</div>}
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className={btnPrimary}><Plus className="w-3.5 h-3.5" /> {busy ? 'Checking with Meta…' : 'Add number'}</button>
            <button type="button" onClick={() => { setAdding(false); setForm(EMPTY); setFormError(''); }} className={btnSecondary}>Cancel</button>
          </div>
        </form>
      )}

      {isOwner && data?.main && <MetaSetupGuide guide={EXTRA_NUMBER_GUIDE} defaultOpen={false} />}
    </section>
  );
}
