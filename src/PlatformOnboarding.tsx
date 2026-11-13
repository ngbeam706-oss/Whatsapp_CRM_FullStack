import { useCallback, useEffect, useState } from 'react';
import { ClipboardCheck, CheckCircle2, Circle, MinusCircle, Mail, Info } from 'lucide-react';
import { api, errorMessage, inputInlineCls, btnSecondary } from './broadcastUtils';
import type { ShowToast } from './types';

interface Step { id: string; label: string; done: boolean | null }
interface OnboardingBusiness {
  id: string; name: string; slug: string; status: string; plan_id: string; created_at: string; created_by?: string | null;
  ownerEmail: string | null; steps: Step[]; doneCount: number; total: number;
}

/** Short names for the business's own checklist steps (server/business.cjs checklist). */
const STEP_SHORT: Record<string, string> = { whatsapp: 'WhatsApp', bot: 'Bot', team: 'Team', templates: 'Templates', ai: 'AI (optional)' };

/**
 * Platform console, Onboarding tab (Platform Owner + Application Managers): new businesses and how far their
 * setup is. Yes/no per step only, never chats or bot text. "Resend invite" emails the Business Admin again.
 */
export default function PlatformOnboarding({ showToast, onOpenBusiness }: { showToast: ShowToast; onOpenBusiness: (id: string) => void }) {
  const [days, setDays] = useState(90);
  const [rows, setRows] = useState<OnboardingBusiness[] | null>(null);
  const [error, setError] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [busy, setBusy] = useState('');

  const load = useCallback(() => api<{ businesses: OnboardingBusiness[] }>(`/api/platform/onboarding?days=${days}`)
    .then(d => { setRows(d.businesses || []); setError(''); })
    .catch(e => setError(errorMessage(e))), [days]);
  useEffect(() => { load(); }, [load]);

  const resend = async (b: OnboardingBusiness) => {
    setBusy(b.id);
    try {
      const r = await api<{ email: string; kind: 'invite' | 'reset' }>(`/api/platform/businesses/${b.id}/resend-invite`, { method: 'POST' });
      showToast(r.kind === 'reset' ? `${r.email} already has a login: a "set your password" email was sent.` : `Invite sent again to ${r.email}.`);
    } catch (e) { showToast(errorMessage(e)); } finally { setBusy(''); }
  };

  const shown = (rows || []).filter(b => !onlyOpen || b.doneCount < b.total);
  return (
    <section data-testid="platform-onboarding" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2"><ClipboardCheck className="w-5 h-5 text-slate-700" /> Onboarding</h1>
        <div className="flex-1" />
        <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={onlyOpen} onChange={e => setOnlyOpen(e.target.checked)} /> Still setting up only</label>
        <select value={days} onChange={e => setDays(Number(e.target.value))} className={inputInlineCls} aria-label="Created in the last">
          <option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={365}>Last year</option>
        </select>
      </div>
      <p className="text-xs text-slate-500 flex items-start gap-1.5"><Info className="w-3.5 h-3.5 flex-shrink-0 mt-px" /> Each business's setup steps, done or not. You never see their chats, contacts or bot text.</p>
      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>}
      {!rows && !error && <div className="text-sm text-slate-500">Loading…</div>}
      {rows && shown.length === 0 && <div className="bg-white border border-dashed border-slate-300 rounded-xl p-6 text-center text-sm text-slate-500">{onlyOpen ? 'Every new business has finished setting up.' : 'No business was created in this period.'}</div>}
      <div className="grid gap-2">
        {shown.map(b => (
          <div key={b.id} className="bg-white border border-slate-200 rounded-xl p-3" data-testid="onboarding-row">
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => onOpenBusiness(b.id)} className="text-sm font-bold text-slate-800 hover:underline cursor-pointer text-left">{b.name}</button>
              {b.status === 'suspended' && <span className="text-xs font-bold uppercase px-2 py-0.5 rounded-full bg-red-100 text-red-700">suspended</span>}
              <span className="text-xs text-slate-500">{b.plan_id} · since {new Date(b.created_at).toLocaleDateString()}</span>
              <div className="flex-1" />
              <span className={`text-xs font-semibold ${b.doneCount >= b.total ? 'text-emerald-700' : 'text-amber-700'}`}>{b.doneCount} of {b.total} done</span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs">
              {b.steps.map(s => (
                <span key={s.id} className={`flex items-center gap-1 ${s.done ? 'text-emerald-700' : s.done === null ? 'text-slate-400' : 'text-slate-600'}`} title={s.label} data-testid={`step-${s.id}-${s.done === null ? 'na' : s.done ? 'done' : 'todo'}`}>
                  {s.done ? <CheckCircle2 className="w-3.5 h-3.5" /> : s.done === null ? <MinusCircle className="w-3.5 h-3.5" /> : <Circle className="w-3.5 h-3.5" />}
                  {STEP_SHORT[s.id] || s.label}
                </span>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-slate-100 text-xs text-slate-500">
              Business Admin: {b.ownerEmail || 'none yet'}
              <div className="flex-1" />
              {b.ownerEmail && <button onClick={() => resend(b)} disabled={busy === b.id} className={btnSecondary}><Mail className="w-3.5 h-3.5" /> {busy === b.id ? 'Sending…' : 'Resend invite'}</button>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
