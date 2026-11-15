import { useState, type FormEvent } from 'react';
import { ListChecks, CheckCircle2, Circle, ArrowRight, Building2, Save, Clock, Gauge, AlertTriangle } from 'lucide-react';
import { api, errorMessage, inputCls, inputInlineCls, btnPrimary, btnSecondary } from './broadcastUtils';
import { LoadError, SkeletonRows } from './ui';
import { useApi, refreshApi, errorOf } from './queryClient';
import { roleLabel } from './crmUtils';
import type { Role, ShowToast } from './types';

// ---- Shapes (server/business.cjs, limits.cjs usageReport) ----
export interface UsageMetric {
  key: string; label: string; used: number; limit: number | null; percent?: number;
  reached?: boolean; warning?: boolean; notIncluded?: boolean;
}
export interface Usage {
  planId: string; planName?: string; analyticsDays?: number | null; metrics: UsageMetric[];
  billing?: { state?: 'ok' | 'due' | 'overdue' | string; paidUntil?: string | null; suspendOn?: string | null };
}
interface ChecklistStep { id: string; label: string; done: boolean | null; view: string; who: 'owner' | 'manager' }
interface Checklist { steps: ChecklistStep[]; doneCount: number; total: number }
export interface BusinessProfile {
  id: string; name: string; slug?: string; status?: string; planId?: string; timezone?: string;
  sendWindowStart: number; sendWindowEnd: number; createdAt?: string;
}
/** The profile form: hours are kept as the <select> gives them until saved. */
interface ProfileForm { name: string; sendWindowStart: number | string; sendWindowEnd: number | string }

const HOURS = Array.from({ length: 25 }, (_, h) => h);
const hourLabel = (h: number) => (h === 0 || h === 24 ? '12 am' : h === 12 ? '12 pm' : h < 12 ? `${h} am` : `${h - 12} pm`);

const fmtNum = (n: number | null | undefined) => Number(n || 0).toLocaleString('en-IN');

/** The plan, how much of each limit is used, and the payment state. */
export function UsageCard({ usage }: { usage: Usage }) {
  const b = usage.billing || {};
  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
      <div className="text-sm font-semibold text-slate-800 flex items-center gap-2">
        <Gauge className="w-4 h-4 text-violet-600" /> Plan and usage
        <span className="ml-auto text-xs font-bold uppercase bg-violet-100 text-violet-800 px-2 py-0.5 rounded-full">{usage.planName || usage.planId}</span>
      </div>
      {b.state === 'due' && (
        <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 flex gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          Your plan was paid until {b.paidUntil}. Please renew: on {b.suspendOn} the account will be paused until payment is recorded.
        </div>
      )}
      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
        {usage.metrics.map(m => (
          <div key={m.key}>
            <div className="flex justify-between text-xs text-slate-600">
              <span>{m.label}</span>
              <span className={m.reached ? 'text-red-700 font-semibold' : m.warning ? 'text-amber-700 font-semibold' : ''}>
                {m.notIncluded ? 'not in your plan' : m.limit === null ? `${fmtNum(m.used)} (unlimited)` : `${fmtNum(m.used)} / ${fmtNum(m.limit)}`}
              </span>
            </div>
            {m.limit !== null && !m.notIncluded && (
              <div className="h-1.5 bg-slate-100 rounded-full mt-1">
                <div className={`h-1.5 rounded-full ${m.reached ? 'bg-red-500' : m.warning ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(m.percent || 0, 100)}%` }} />
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="text-xs text-slate-500">
        Monthly counts reset on the 1st (India time). Analytics shows up to {usage.analyticsDays ? `${usage.analyticsDays} days` : 'a year'} of history.
        Customers can always message you and your team can always reply, even at a limit. To upgrade, contact the platform team.
      </div>
    </section>
  );
}

/** A business's getting-started checklist and its profile (name, sending hours). */
interface SetupScreenProps {
  userRole: Role; onGo: (view: string) => void; onProfileSaved?: (business: BusinessProfile) => void; showToast: ShowToast;
}

export default function SetupScreen({ userRole, onGo, onProfileSaved, showToast }: SetupScreenProps) {
  const checklistQuery = useApi<Checklist>('/api/business/checklist');
  const profileQuery = useApi<{ business: BusinessProfile }>('/api/business');
  const usageQuery = useApi<Usage>('/api/business/usage'); // shared with the plan banner in the header
  const checks = checklistQuery.data || null;
  const usage = usageQuery.data || null; // optional: the page works without it
  const profile = profileQuery.data?.business || null;
  const error = errorOf(checklistQuery, profileQuery);
  // Unsaved edits; a background refresh never overwrites what someone is typing.
  const [edits, setEdits] = useState<ProfileForm | null>(null);
  const form: ProfileForm | null = edits ?? (profile ? { name: profile.name, sendWindowStart: profile.sendWindowStart, sendWindowEnd: profile.sendWindowEnd } : null);
  // Only called from the form, which is shown only once `form` exists.
  const setForm = (fn: (f: ProfileForm) => ProfileForm) => setEdits(prev => {
    const base = prev ?? form;
    return base ? fn(base) : prev;
  });
  const [saving, setSaving] = useState(false);
  const isOwner = userRole === 'owner';

  const load = async () => {
    await refreshApi('/api/business');
    setEdits(null);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    try {
      const r = await api<{ business: BusinessProfile }>('/api/business', { method: 'PUT', body: { ...form, sendWindowStart: Number(form.sendWindowStart), sendWindowEnd: Number(form.sendWindowEnd) } });
      showToast('Saved');
      onProfileSaved?.(r.business);
      load();
    } catch (err) {
      showToast(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-100">
      <div className="max-w-3xl mx-auto px-4 py-5 space-y-4">
        <div>
          <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2"><ListChecks className="w-5 h-5 text-wa-teal" /> Setup</h1>
          <p className="text-xs text-slate-500">Get your business ready on WhatsApp, step by step.</p>
        </div>
        {error && <LoadError error={error} onRetry={() => { checklistQuery.refetch(); profileQuery.refetch(); }} />}
        {!checks && !error && <SkeletonRows rows={5} label="Loading the setup checklist" />}

        {checks && (
          <section className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
            <div className="px-4 py-3 text-sm font-semibold text-slate-800">
              {checks.doneCount} of {checks.total} done
              <div className="h-1.5 bg-slate-100 rounded-full mt-2"><div className="h-1.5 bg-emerald-500 rounded-full" style={{ width: `${Math.round((checks.doneCount / Math.max(checks.total, 1)) * 100)}%` }} /></div>
            </div>
            {checks.steps.map(s => {
              const canDo = s.who === 'manager' ? ['owner', 'manager'].includes(userRole) : userRole === 'owner';
              return (
                <div key={s.id} className="flex items-center gap-3 px-4 py-3">
                  {s.done ? <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" /> : <Circle className="w-5 h-5 text-slate-300 flex-shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm ${s.done ? 'text-slate-500 line-through' : 'text-slate-800'}`}>{s.label}</div>
                    {!canDo && !s.done && <div className="text-xs text-slate-400">Done by the {s.who === 'owner' ? roleLabel('owner') : 'Business Admin or a manager'}</div>}
                  </div>
                  <button onClick={() => onGo(s.view)} className={btnSecondary}>{s.done ? 'Open' : 'Go'} <ArrowRight className="w-3.5 h-3.5" /></button>
                </div>
              );
            })}
          </section>
        )}

        {usage && <UsageCard usage={usage} />}

        {profile && form && (
          <form onSubmit={save} className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="text-sm font-semibold text-slate-800 flex items-center gap-2"><Building2 className="w-4 h-4 text-slate-600" /> Business profile</div>
            <label className="block text-xs font-medium text-slate-700">Business name (customers see it on WhatsApp menus)
              <input value={form.name} disabled={!isOwner} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={`${inputCls} mt-1 disabled:bg-slate-50`} />
            </label>
            <div className="text-xs font-medium text-slate-700 flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> Follow-ups are sent only between (India time)</div>
            <div className="flex items-center gap-2 text-xs">
              <select value={form.sendWindowStart} disabled={!isOwner} onChange={e => setForm(f => ({ ...f, sendWindowStart: e.target.value }))} className={inputInlineCls}>
                {HOURS.slice(0, 24).map(h => <option key={h} value={h}>{hourLabel(h)}</option>)}
              </select>
              and
              <select value={form.sendWindowEnd} disabled={!isOwner} onChange={e => setForm(f => ({ ...f, sendWindowEnd: e.target.value }))} className={inputInlineCls}>
                {HOURS.slice(1).map(h => <option key={h} value={h}>{hourLabel(h)}</option>)}
              </select>
            </div>
            <div className="text-xs text-slate-500">Replies to customers are not limited by these hours.</div>
            {isOwner
              ? <button type="submit" disabled={saving} className={btnPrimary}><Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save'}</button>
              : <div className="text-xs text-slate-500">Only the Business Admin can change these.</div>}
          </form>
        )}
      </div>
    </div>
  );
}
