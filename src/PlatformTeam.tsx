import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { UsersRound, UserPlus, Trash2, ShieldAlert } from 'lucide-react';
import { useConfirm } from './confirm';
import { api, errorMessage, inputCls, inputInlineCls, btnPrimary, btnSecondary } from './broadcastUtils';
import { PLATFORM_ROLE_LABEL, type PlatformRole } from './appRoutes';
import type { ShowToast } from './types';

interface Member { user_id: string; email: string; role: PlatformRole; added_by?: string | null; created_at?: string }

const ROLE_HELP: Record<PlatformRole, string> = {
  owner: 'Everything, including plans, prices, branding, maintenance and this team.',
  manager: 'Sign-up requests, business onboarding (invites, setup progress) and support queries.',
  developer: 'Health, logs, worker runs and delivery; the business list read-only.',
};
const ROLES: PlatformRole[] = ['manager', 'developer', 'owner'];

/**
 * Platform console, Team tab (Platform Owner only): who works on the platform and with which role.
 * The server enforces every rule (server/platformTeam.cjs): no changes to yourself, at least one Platform Owner,
 * every change audited, removed people lose access on their next request.
 */
export default function PlatformTeam({ me, showToast }: { me: { email: string }; showToast: ShowToast }) {
  const confirm = useConfirm();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState<{ email: string; role: PlatformRole }>({ email: '', role: 'manager' });
  const [busy, setBusy] = useState('');

  const load = useCallback(() => api<{ members: Member[] }>('/api/platform/team')
    .then(d => { setMembers(d.members || []); setError(''); })
    .catch(e => setError(errorMessage(e))), []);
  useEffect(() => { load(); }, [load]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('add');
    try {
      const r = await api<{ invited: boolean; member: Member }>('/api/platform/team', { method: 'POST', body: form });
      showToast(r.invited ? `Invite sent to ${r.member.email}.` : `${r.member.email} already had a login and can sign in now.`);
      setForm({ email: '', role: 'manager' });
      load();
    } catch (err) { showToast(errorMessage(err)); } finally { setBusy(''); }
  };
  const changeRole = async (m: Member, role: PlatformRole) => {
    setBusy(m.user_id);
    try { await api(`/api/platform/team/${m.user_id}`, { method: 'PATCH', body: { role } }); showToast(`${m.email} is now ${PLATFORM_ROLE_LABEL[role]}.`); load(); } catch (err) { showToast(errorMessage(err)); } finally { setBusy(''); }
  };
  const remove = async (m: Member) => {
    if (!(await confirm({ title: `Remove ${m.email}?`, body: 'They lose access to the platform console at once. Their open support queries go back to the shared queue.', confirmLabel: 'Remove', danger: true }))) return;
    setBusy(m.user_id);
    try { await api(`/api/platform/team/${m.user_id}`, { method: 'DELETE' }); showToast(`${m.email} removed.`); load(); } catch (err) { showToast(errorMessage(err)); } finally { setBusy(''); }
  };
  const myEmail = me.email.toLowerCase();

  return (
    <section data-testid="platform-team" className="space-y-3">
      <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2"><UsersRound className="w-5 h-5 text-slate-700" /> Platform team</h1>
      <p className="text-xs text-slate-500">People who run the platform itself. Nobody here ever sees a business's chats, contacts or bot text. Every change is in the Audit tab.</p>

      <form onSubmit={add} className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="text-sm font-semibold text-slate-800 flex items-center gap-2"><UserPlus className="w-4 h-4" /> Add someone</div>
        <div className="grid sm:grid-cols-[1fr_auto_auto] gap-3 items-end">
          <label className="text-xs font-medium text-slate-700">Email
            <input required type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="name@yourcompany.com" className={`${inputCls} mt-1`} />
          </label>
          <label className="text-xs font-medium text-slate-700">Role
            <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value as PlatformRole }))} className={`${inputCls} mt-1`} aria-label="Role for the new person">
              {ROLES.map(r => <option key={r} value={r}>{PLATFORM_ROLE_LABEL[r]}</option>)}
            </select>
          </label>
          <button type="submit" disabled={busy === 'add'} className={btnPrimary}>{busy === 'add' ? 'Adding…' : 'Invite'}</button>
        </div>
        <div className="text-xs text-slate-500">{ROLE_HELP[form.role]} They get an email to set a password. Use a separate login: someone who works for a business can't also be platform staff.</div>
        <div className="text-xs text-amber-800 flex items-start gap-1.5"><ShieldAlert className="w-3.5 h-3.5 flex-shrink-0 mt-px" /> Recommended: everyone on the platform team turns on two-factor sign-in for their email account (not yet enforced here).</div>
      </form>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>}
      {!members && !error && <div className="text-sm text-slate-500">Loading…</div>}
      {members && (
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100" data-testid="platform-team-list">
          {members.map(m => {
            const self = m.email.toLowerCase() === myEmail;
            return (
              <div key={m.user_id} className="px-4 py-3 flex flex-wrap items-center gap-3" data-testid="platform-team-row">
                <div className="flex-1 min-w-[200px]">
                  <div className="text-sm font-medium text-slate-800">{m.email}{self && <span className="text-xs text-slate-500"> (you)</span>}</div>
                  <div className="text-xs text-slate-500">{ROLE_HELP[m.role]}{m.added_by ? ` · added by ${m.added_by}` : ''}</div>
                </div>
                <select value={m.role} disabled={self || busy === m.user_id} onChange={e => changeRole(m, e.target.value as PlatformRole)} className={inputInlineCls} aria-label={`Role of ${m.email}`}>
                  {ROLES.map(r => <option key={r} value={r}>{PLATFORM_ROLE_LABEL[r]}</option>)}
                </select>
                {!self && <button onClick={() => remove(m)} disabled={busy === m.user_id} className={btnSecondary} aria-label={`Remove ${m.email}`}><Trash2 className="w-3.5 h-3.5 text-red-600" /> Remove</button>}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
