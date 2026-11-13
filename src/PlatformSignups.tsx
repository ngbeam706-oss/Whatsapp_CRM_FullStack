import { useCallback, useEffect, useState } from 'react';
import { useConfirm } from './confirm';
import { UserPlus, Check, X, Mail, Phone, MapPin, Users, MessageSquare } from 'lucide-react';
import { api, errorMessage, btnPrimary, btnSecondary, inputCls } from './broadcastUtils';
import type { Plan } from './platformTypes';
import type { ShowToast } from './types';

// Platform console: sign-up requests from the public site (server/signupRequests.cjs). Approving creates the
// business on the chosen plan and emails the contact an invite as Business Admin; declining keeps nothing.
// These are the platform's own prospects, not any business's customers.

interface SignupRequest {
  id: string; business_name: string; contact_name: string; email: string; phone: string; industry: string;
  city: string | null; team_size: string | null; plan_interest: string | null; has_whatsapp_api: string | null; message: string | null;
  consent_marketing: boolean; consent_at: string; policy_version: string; status: 'pending' | 'approved' | 'rejected';
  decided_by: string | null; decided_at: string | null; decision_note: string | null; created_at: string;
}
const INDUSTRY: Record<string, string> = { hospital: 'Healthcare', food: 'Food', retail: 'Retail', services: 'Services', general: 'Other' };
const API_LABEL: Record<string, string> = { yes: 'Already on the API', no: 'Uses the WhatsApp app', not_sure: 'Not sure' };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '–');

export default function PlatformSignups({ plans, showToast, onApproved }: { plans: Plan[]; showToast: ShowToast; onApproved: () => void }) {
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const confirm = useConfirm();
  const [rows, setRows] = useState<SignupRequest[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [planFor, setPlanFor] = useState<Record<string, string>>({});

  const load = useCallback(() => api<{ requests: SignupRequest[] }>(`/api/platform/signup-requests?status=${status}`)
    .then(d => { setRows(d.requests); setError(''); })
    .catch(e => setError(errorMessage(e))), [status]);
  useEffect(() => { load(); }, [load]);

  const approve = async (r: SignupRequest) => {
    const planId = planFor[r.id] || r.plan_interest || plans[0]?.id || 'starter';
    if (!await confirm(`Create "${r.business_name}" on the ${plans.find(p => p.id === planId)?.name || planId} plan and email ${r.email} an invite as Business Admin?`)) return;
    setBusy(r.id);
    try {
      await api(`/api/platform/signup-requests/${r.id}/approve`, { method: 'POST', body: { planId } });
      showToast(`Created ${r.business_name}; invite sent to ${r.email}`);
      onApproved();
      await load();
    } catch (e) {
      showToast(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const reject = async (r: SignupRequest) => {
    const note = await confirm.ask({ title: `Decline the request from ${r.business_name}?`, label: 'Note for your records (optional)', confirmLabel: 'Decline', danger: true });
    if (note === null) return;
    setBusy(r.id);
    try {
      await api(`/api/platform/signup-requests/${r.id}/reject`, { method: 'POST', body: { note } });
      showToast('Declined');
      await load();
    } catch (e) {
      showToast(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-3" data-testid="platform-signups">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2"><UserPlus className="w-4 h-4 text-emerald-600" /> Sign-up requests</h2>
        <div className="ml-auto bg-white border border-slate-200 p-0.5 rounded-lg flex text-xs">
          {(['pending', 'approved', 'rejected'] as const).map(s => (
            <button key={s} onClick={() => setStatus(s)} className={`px-3 py-1 rounded-md font-semibold capitalize cursor-pointer ${status === s ? 'bg-slate-800 text-white' : 'text-slate-600'}`}>{s === 'rejected' ? 'Declined' : s}</button>
          ))}
        </div>
      </div>
      <p className="text-xs text-slate-500">From the public &quot;Get started&quot; page. Approving creates the business and emails the contact an invite to set their password. Requests are deleted automatically 30 days after approval and 90 days after declining.</p>
      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>}
      {!rows && !error && <div className="text-sm text-slate-500">Loading…</div>}
      {rows && rows.length === 0 && <div className="p-6 bg-white border border-slate-200 rounded-xl text-sm text-slate-500 text-center">No {status === 'rejected' ? 'declined' : status} requests.</div>}
      <ul className="space-y-3">
        {(rows || []).map(r => (
          <li key={r.id} className="bg-white border border-slate-200 rounded-xl p-4 text-xs" data-testid="signup-request">
            <div className="flex flex-wrap items-start gap-3">
              <div className="flex-1 min-w-[220px]">
                <div className="text-sm font-bold text-slate-900">{r.business_name}</div>
                <div className="text-slate-500">{INDUSTRY[r.industry] || r.industry}{r.city ? ` · ${r.city}` : ''} · received {when(r.created_at)}</div>
                <div className="mt-2 grid sm:grid-cols-2 gap-x-4 gap-y-1 text-slate-700">
                  <span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5 text-slate-400" />{r.contact_name}{r.team_size ? ` · team ${r.team_size}` : ''}</span>
                  <a href={`mailto:${r.email}`} className="flex items-center gap-1.5 text-emerald-700"><Mail className="w-3.5 h-3.5" />{r.email}</a>
                  <a href={`tel:+${r.phone}`} className="flex items-center gap-1.5 text-emerald-700"><Phone className="w-3.5 h-3.5" />+{r.phone}</a>
                  <span className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 text-slate-400" />{r.has_whatsapp_api ? API_LABEL[r.has_whatsapp_api] : 'WhatsApp setup not given'}</span>
                </div>
                {r.message && <p className="mt-2 p-2 bg-slate-50 rounded-lg text-slate-700 flex gap-1.5"><MessageSquare className="w-3.5 h-3.5 text-slate-400 flex-shrink-0 mt-0.5" />{r.message}</p>}
                <p className="mt-2 text-xs text-slate-400">Consent to Terms and Privacy Policy (v{r.policy_version}) on {when(r.consent_at)} · marketing: {r.consent_marketing ? 'yes' : 'no'}</p>
                {r.status !== 'pending' && <p className="mt-1 text-xs text-slate-500">{r.status === 'approved' ? 'Approved' : 'Declined'} by {r.decided_by} on {when(r.decided_at)}{r.decision_note ? `: ${r.decision_note}` : ''}</p>}
              </div>
              {r.status === 'pending' && (
                <div className="flex flex-col gap-2 w-56">
                  <label className="text-slate-600">Plan
                    <select value={planFor[r.id] || r.plan_interest || plans[0]?.id || ''} onChange={e => setPlanFor(p => ({ ...p, [r.id]: e.target.value }))} className={`${inputCls} mt-1`}>
                      {plans.map(p => <option key={p.id} value={p.id}>{p.name}{p.id === r.plan_interest ? ' (asked for)' : ''}</option>)}
                    </select>
                  </label>
                  <button onClick={() => approve(r)} disabled={busy === r.id} className={btnPrimary}><Check className="w-3.5 h-3.5" /> Approve and invite</button>
                  <button onClick={() => reject(r)} disabled={busy === r.id} className={btnSecondary}><X className="w-3.5 h-3.5" /> Decline</button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
