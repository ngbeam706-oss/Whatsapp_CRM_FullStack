import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Lock, LogOut } from 'lucide-react';
import { BrandLogo, useBrandName } from './BrandMark';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';
import type { Role } from './types';

/** This login's staff_members row (RLS lets a login read only its own). */
interface StaffRow { role: Role; business_id: string }
interface StaffCheck { userId: string | null; staff: StaffRow | null; platformAdmin?: boolean; doctor?: boolean }
/** What the signed-in part of the app gets. */
/** doctor: a clinic doctor's login (clinic_doctors, not staff): opens only the doctor area. */
export interface SignedIn { session: Session; staff: StaffRow | null; platformAdmin: boolean; doctor: boolean; signOut: () => void }

/**
 * Shows a staff login screen until someone signs in with a Supabase account
 * that is listed in the staff_members table. Then renders children(session, signOut).
 */
export default function AuthGate({ children }: { children: (signedIn: SignedIn) => ReactNode }) {
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  // Result of the staff lookup, tagged with the user it was made for.
  const [staffCheck, setStaffCheck] = useState<StaffCheck>({ userId: null, staff: null });
  // Arrived from an invite or password-reset email: ask for a new password first.
  // (Read the link type before supabase-js clears it from the address bar.)
  const [needsPassword, setNeedsPassword] = useState(() => /type=(invite|recovery)/.test(window.location.hash));
  // A reset (not a first invite): agents may not use it; their manager sets their password.
  const [isRecovery, setIsRecovery] = useState(() => /type=recovery/.test(window.location.hash));

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionLoaded(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (event === 'PASSWORD_RECOVERY') { setNeedsPassword(true); setIsRecovery(true); }
      setSession(newSession);
      setSessionLoaded(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user?.id;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    // Business staff (one business each), a platform admin, or a clinic doctor (separate logins, never two of these).
    Promise.all([
      supabase.from('staff_members').select('role, business_id').eq('user_id', userId).maybeSingle(),
      supabase.from('platform_admins').select('user_id').eq('user_id', userId).maybeSingle(),
      // RLS: a doctor's login reads only its own row (and only these columns). Before SQL 20261139: an error = not a doctor.
      supabase.from('clinic_doctors').select('id, active').eq('user_id', userId).maybeSingle(),
    ]).then(([s, p, d]) => {
      if (!cancelled) setStaffCheck({ userId, staff: s.error ? null : (s.data as StaffRow | null), platformAdmin: !p.error && !!p.data, doctor: !d.error && !!(d.data as { active?: boolean } | null)?.active });
    });
    return () => { cancelled = true; };
  }, [userId]);

  const signOut = () => { supabase.auth.signOut(); };

  const checking = !sessionLoaded || (!!userId && staffCheck.userId !== userId);
  const staff = staffCheck.userId === userId ? staffCheck.staff : null;
  const platformAdmin = staffCheck.userId === userId && !!staffCheck.platformAdmin;
  const doctor = staffCheck.userId === userId && !!staffCheck.doctor;
  const notStaff = !!userId && !checking && !staff && !platformAdmin && !doctor;

  if (checking) {
    return <CenteredCard><p className="text-sm text-slate-500">Checking your sign-in…</p></CenteredCard>;
  }

  if (!session) return <LoginScreen />;

  if (needsPassword && isRecovery && staff?.role === 'agent') {
    return (
      <CenteredCard>
        <h1 className="text-lg font-bold text-slate-800 mb-2">Ask your manager</h1>
        <p className="text-sm text-slate-600 mb-4">
          Agents' passwords are set by their manager or Business Admin. Ask them to reset yours on the Team page.
        </p>
        <button onClick={() => { window.history.replaceState(null, '', window.location.pathname); setNeedsPassword(false); setIsRecovery(false); signOut(); }}
          className="w-full bg-wa-teal text-white rounded-lg py-2 text-sm font-semibold cursor-pointer">
          OK, sign out
        </button>
      </CenteredCard>
    );
  }

  if (needsPassword) {
    return (
      <SetPasswordScreen
        email={session.user.email}
        onDone={() => {
          window.history.replaceState(null, '', window.location.pathname);
          setNeedsPassword(false);
        }}
      />
    );
  }

  if (notStaff) {
    return (
      <CenteredCard>
        <h1 className="text-lg font-bold text-slate-800 mb-2">No dashboard access</h1>
        <p className="text-sm text-slate-600 mb-4">
          <span className="font-medium">{session.user.email}</span> is signed in but isn't on the staff list.
          Ask your Business Admin to add you.
        </p>
        <button onClick={signOut} className="w-full bg-wa-teal text-white rounded-lg py-2 text-sm font-semibold cursor-pointer">
          Sign out
        </button>
      </CenteredCard>
    );
  }

  return <>{children({ session, staff, platformAdmin: !staff && platformAdmin, doctor: !staff && !platformAdmin && doctor, signOut })}</>;
}

function LoginScreen() {
  const appName = useBrandName();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (signInError) setError(signInError.message === 'Invalid login credentials' ? 'Wrong email or password.' : signInError.message);
    setBusy(false);
  };

  const [resetSent, setResetSent] = useState('');
  const sendReset = async () => {
    setError('');
    if (!email.trim()) return setError('Type your email above first.');
    // Through our server: agents get no reset email (their manager sets their password).
    // The answer is the same either way, so it doesn't reveal who has an account.
    try {
      const r = await fetch('/api/auth/forgot-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim() }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return setError(d.error || 'Please wait a few minutes and try again.');
      setResetSent(d.message || 'If this login can reset its own password, a reset link is on its way.');
    } catch {
      setError('Could not reach the server. Try again.');
    }
  };

  return (
    <CenteredCard>
      <div className="flex items-center gap-2 mb-5">
        <BrandLogo size={36} tone="bg-wa-green" />
        <div>
          <h1 className="text-base font-bold text-slate-800 leading-tight">{appName}</h1>
          <p className="text-xs text-slate-500">Staff sign-in</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <label className="block">
          <span className="text-xs font-medium text-slate-600">Email</span>
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-wa-teal"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-600">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-wa-teal"
          />
        </label>
        {error && <p className="text-xs text-red-600" role="alert">{error}</p>}
        {resetSent && <p className="text-xs text-emerald-700" role="status">{resetSent}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full bg-wa-teal hover:opacity-90 disabled:opacity-60 text-white rounded-lg py-2 text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer"
        >
          <Lock className="w-4 h-4" />
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <button type="button" onClick={sendReset} className="w-full text-xs text-wa-teal font-semibold cursor-pointer">Forgot password?</button>
      </form>
      <p className="text-xs text-slate-400 mt-4">Staff accounts are created by your Business Admin (Team page). Agents: your manager or Business Admin sets and resets your password.</p>
      <p className="text-xs text-slate-500 mt-3">New business? <a href="/signup" className="text-wa-teal font-semibold">Request an account</a> · <a href="/" className="text-slate-500 hover:text-slate-700">Home</a> · <a href="/privacy" className="text-slate-500 hover:text-slate-700">Privacy</a> · <a href="/terms" className="text-slate-500 hover:text-slate-700">Terms</a></p>
    </CenteredCard>
  );
}

function SetPasswordScreen({ email, onDone }: { email?: string; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) return setError('Use at least 8 characters.');
    if (password !== confirm) return setError('The two passwords don\'t match.');
    setBusy(true);
    const { error: updErr } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updErr) return setError(updErr.message);
    onDone();
  };

  const field = 'mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-wa-teal';
  return (
    <CenteredCard>
      <h1 className="text-base font-bold text-slate-800">Set your password</h1>
      <p className="text-xs text-slate-500 mb-4">For {email}. You'll use it to sign in from now on.</p>
      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className="text-xs font-medium text-slate-600">New password</span>
          <input type="password" autoComplete="new-password" required value={password} onChange={e => setPassword(e.target.value)} className={field} />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-600">Repeat it</span>
          <input type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} className={field} />
        </label>
        {error && <p className="text-xs text-red-600" role="alert">{error}</p>}
        <button type="submit" disabled={busy} className="w-full bg-wa-teal disabled:opacity-60 text-white rounded-lg py-2 text-sm font-semibold cursor-pointer">
          {busy ? 'Saving…' : 'Save password'}
        </button>
      </form>
    </CenteredCard>
  );
}

function CenteredCard({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-200 flex items-center justify-center px-4">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-sm p-6">{children}</div>
    </div>
  );
}

export function SignOutButton({ email, onSignOut }: { email?: string; onSignOut: () => void }) {
  return (
    <button
      onClick={onSignOut}
      title={email ? `Signed in as ${email}` : 'Sign out'}
      className="bg-teal-700/80 hover:bg-teal-700 px-2.5 py-1 rounded text-teal-100 flex items-center gap-1 transition cursor-pointer"
    >
      <LogOut className="w-3 h-3" />
      <span className="hidden sm:inline">Sign out</span>
    </button>
  );
}
