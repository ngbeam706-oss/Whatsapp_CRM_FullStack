import { useState, type FormEvent } from 'react';
import { UserPlus, Mail, KeyRound, Copy, X, Eye, EyeOff, Wand2, IdCard, ChevronDown } from 'lucide-react';
import { StaffDetailsFields, changedDetails, type StaffDetails } from './StaffDetailsFields';
import { api, errorMessage, inputCls, btnPrimary, btnSecondary } from './broadcastUtils';
import { refreshApi } from './queryClient';
import { generatePassword, passwordProblem } from './teamPasswordRules';
import type { Role, ShowToast, StaffMember } from './types';

// Team logins whose passwords the Business Admin / managers set (server/team.cjs). Agents can't reset or
// change their own. Managers add and reset agents; the Business Admin also managers, and invites
// Business Admins (and managers, if preferred) by email.

function PasswordInput({ value, onChange, id }: { value: string; onChange: (v: string) => void; id: string }) {
  const [show, setShow] = useState(true);
  return (
    <div className="flex gap-1.5">
      <div className="relative flex-1">
        <input id={id} type={show ? 'text' : 'password'} value={value} onChange={e => onChange(e.target.value)} autoComplete="new-password" maxLength={72}
          className={`${inputCls} pr-8 font-mono`} placeholder="8+ characters, with a number" />
        <button type="button" onClick={() => setShow(s => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 cursor-pointer" aria-label={show ? 'Hide password' : 'Show password'}>
          {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
      </div>
      <button type="button" onClick={() => onChange(generatePassword())} className={btnSecondary} title="Make a strong password"><Wand2 className="w-3.5 h-3.5" /> Generate</button>
    </div>
  );
}

/** Shown once after a password is set: the admin copies it and gives it to the person privately. */
function ShareOnce({ email, password, onClose }: { email: string; password: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = `Login: ${email}\nPassword: ${password}\nSign in at ${window.location.origin}`;
  return (
    <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-900 space-y-2" role="status">
      <div className="font-semibold">Done. Give these to them privately (in person or a direct message):</div>
      <pre className="bg-white border border-emerald-200 rounded p-2 font-mono text-xs whitespace-pre-wrap">{text}</pre>
      <div className="flex gap-2">
        <button type="button" onClick={() => { void navigator.clipboard?.writeText(text); setCopied(true); }} className={btnSecondary}><Copy className="w-3.5 h-3.5" /> {copied ? 'Copied' : 'Copy'}</button>
        <button type="button" onClick={onClose} className={btnSecondary}>Close</button>
      </div>
      <div className="text-xs text-emerald-800">This is the only time it's shown. They can't change it themselves; set a new one here if they forget it.</div>
    </div>
  );
}

/** "Add a team member": agents (and, for the Business Admin, managers) with a password; Business Admins by invite. */
export function AddMember({ myRole, showToast }: { myRole: Role; showToast: ShowToast }) {
  const isOwner = myRole === 'owner';
  const [role, setRole] = useState<Role>('agent');
  const [mode, setMode] = useState<'password' | 'invite'>('password');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState(() => generatePassword());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [shared, setShared] = useState<{ email: string; password: string } | null>(null);
  // Onboarding details, filled in by the Business Admin / manager (optional, editable later from their row).
  const [details, setDetails] = useState<StaffDetails>({});
  const [showDetails, setShowDetails] = useState(true);
  // Business Admins are always invited by email (they manage their own password).
  const byInvite = role === 'owner' || (isOwner && role === 'manager' && mode === 'invite');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    if (!byInvite) {
      const bad = passwordProblem(password);
      if (bad) return setErr(bad);
    }
    setBusy(true);
    try {
      if (byInvite) {
        const d = await api<{ invited?: boolean }>('/api/team/invite', { method: 'POST', body: { email, role } });
        showToast(d.invited ? `Invite email sent to ${email}` : `${email} already had a login and now has access`);
      } else {
        const profile = changedDetails({}, details);
        const r = await api<{ profileWarning?: string }>('/api/team/members', { method: 'POST', body: { email, password, role, fullName: fullName || undefined, ...(Object.keys(profile).length ? { profile } : {}) } });
        setShared({ email: email.trim().toLowerCase(), password });
        showToast(r.profileWarning || `${fullName || email} can now sign in`);
      }
      setEmail(''); setFullName(''); setPassword(generatePassword()); setDetails({});
      await refreshApi('/api/team');
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
      <div className="text-sm font-semibold text-slate-800 flex items-center gap-2"><UserPlus className="w-4 h-4" /> Add a team member</div>
      {shared && <ShareOnce email={shared.email} password={shared.password} onClose={() => setShared(null)} />}
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block text-xs text-slate-600">Role
          <select value={role} onChange={e => setRole(e.target.value as Role)} className={`${inputCls} mt-1`} disabled={!isOwner}>
            <option value="agent">Agent: inbox, pipeline, queries</option>
            {isOwner && <option value="manager">Manager: also bot, AI, broadcasts, analytics, team</option>}
            {isOwner && <option value="owner">Business Admin: everything, incl. team and keys</option>}
          </select>
        </label>
        <label className="block text-xs text-slate-600">{byInvite ? 'Their email' : 'Login email'}
          <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder={byInvite ? 'name@example.com' : 'e.g. ravi@yourbusiness.in'} className={`${inputCls} mt-1`} autoComplete="off" />
        </label>
        {!byInvite && (
          <>
            <label className="block text-xs text-slate-600">Full name (optional)
              <input value={fullName} onChange={e => setFullName(e.target.value)} maxLength={80} placeholder="e.g. Ravi Kumar" className={`${inputCls} mt-1`} />
            </label>
            <label className="block text-xs text-slate-600" htmlFor="new-member-password">Password
              <div className="mt-1"><PasswordInput id="new-member-password" value={password} onChange={setPassword} /></div>
            </label>
          </>
        )}
      </div>
      {!byInvite && (
        <div className="rounded-lg border border-slate-200" data-testid="onboarding-details">
          <button type="button" onClick={() => setShowDetails(s => !s)} aria-expanded={showDetails} className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-700 cursor-pointer hover:bg-slate-50">
            <IdCard className="w-3.5 h-3.5 text-slate-500" /> Onboarding details <span className="font-normal text-slate-400">(optional: job, employee ID, joining date, contact, emergency contact)</span>
            <ChevronDown className={`w-3.5 h-3.5 ml-auto text-slate-400 transition-transform ${showDetails ? 'rotate-180' : ''}`} />
          </button>
          {showDetails && (
            <div className="px-3 pb-3">
              <StaffDetailsFields value={details} onChange={setDetails} adminFields="edit" idPrefix="new-member" />
              <p className="mt-2 text-xs text-slate-400">Seen only by the Business Admin{role === 'agent' ? ', managers' : ''} and the person. You can change them later from their row.</p>
            </div>
          )}
        </div>
      )}
      {isOwner && role === 'manager' && (
        <div className="flex gap-3 text-xs text-slate-600">
          <label className="flex items-center gap-1.5 cursor-pointer"><input type="radio" checked={mode === 'password'} onChange={() => setMode('password')} /> I set their password</label>
          <label className="flex items-center gap-1.5 cursor-pointer"><input type="radio" checked={mode === 'invite'} onChange={() => setMode('invite')} /> Email them an invite (they set it)</label>
        </div>
      )}
      <div className="text-xs text-slate-500">
        {byInvite
          ? 'They get an email with a link to set their own password. Someone who already works for another business can\'t be added.'
          : 'Nothing is emailed: you give them the login and password. Agents can\'t change or reset their password; you can set a new one any time from their row.'}
      </div>
      {err && <div className="p-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{err}</div>}
      <button type="submit" disabled={busy} className={btnPrimary}>
        {byInvite ? <><Mail className="w-3.5 h-3.5" /> {busy ? 'Sending…' : 'Send invite'}</> : <><KeyRound className="w-3.5 h-3.5" /> {busy ? 'Creating…' : 'Create login'}</>}
      </button>
    </form>
  );
}

/** "Set password" for one member. */
export function SetPasswordDialog({ member, onClose, showToast }: { member: StaffMember; onClose: () => void; showToast: ShowToast }) {
  const [password, setPassword] = useState(() => generatePassword());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const name = member.full_name || member.email;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const bad = passwordProblem(password);
    if (bad) return setErr(bad);
    setBusy(true); setErr('');
    try {
      await api(`/api/team/${member.user_id}/password`, { method: 'PUT', body: { password } });
      setDone(true);
      showToast(`New password set for ${name}`);
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Set password">
      <form onSubmit={save} className="bg-white rounded-xl shadow-xl w-full max-w-md p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5"><KeyRound className="w-4 h-4" /> Set password</h3>
            <p className="text-xs text-slate-500">For {name}{member.full_name ? ` (${member.email})` : ''}. Their old password stops working.</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        {done ? <ShareOnce email={member.email} password={password} onClose={onClose} /> : (
          <>
            <PasswordInput id="set-member-password" value={password} onChange={setPassword} />
            {err && <div className="p-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{err}</div>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
              <button type="submit" disabled={busy} className={btnPrimary}>{busy ? 'Saving…' : 'Set password'}</button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

