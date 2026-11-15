// "Signed in on this page just now": the sign-in page keeps the address it was opened on (often the previous
// person's, e.g. /agent/inbox after an agent signed out). Right after signing in, an address of another role's area
// takes you to your own area instead of "Not allowed" (Dashboard.tsx AreaGate). Kept for this tab only, used once.
const JUST_SIGNED_IN = 'crm_just_signed_in';

/** The sign-in form succeeded (AuthGate). */
export function markJustSignedIn(): void {
  try { sessionStorage.setItem(JUST_SIGNED_IN, '1'); } catch { /* storage blocked */ }
}

/** True once right after a sign-in on this tab (then forgotten). */
export function takeJustSignedIn(): boolean {
  try {
    const v = sessionStorage.getItem(JUST_SIGNED_IN) === '1';
    sessionStorage.removeItem(JUST_SIGNED_IN);
    return v;
  } catch { return false; }
}

/**
 * Activity log (server/activity.cjs): tell the server about a sign-in / sign-out / own password change. The server
 * checks the token, records it (a sign-in once per session) and never fails anything here. Best effort.
 */
export function reportAuthEvent(kind: 'signed-in' | 'signed-out' | 'password-changed', accessToken: string | null | undefined): Promise<void> {
  if (!accessToken) return Promise.resolve();
  return fetch(`/api/auth/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }, body: '{}', keepalive: kind === 'signed-out' })
    .then(() => undefined).catch(() => undefined);
}

const REPORTED = 'crm_signin_reported';

/** The Supabase session a token belongs to (its session_id claim), or the token itself. */
function sessionOf(accessToken: string): string {
  try {
    const part = accessToken.split('.')[1] || '';
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as { session_id?: unknown };
    if (typeof json.session_id === 'string' && json.session_id) return json.session_id;
  } catch { /* not a JWT */ }
  return accessToken.slice(-24);
}

/**
 * A real sign-in happened (the sign-in form, or an emailed invite / reset link): report it once for this session from
 * this tab. The server also keeps one entry per session.
 */
export function reportSignInOnce(accessToken: string | null | undefined): Promise<void> {
  if (!accessToken) return Promise.resolve();
  const id = sessionOf(accessToken);
  try {
    if (sessionStorage.getItem(REPORTED) === id) return Promise.resolve();
    sessionStorage.setItem(REPORTED, id);
  } catch { /* storage blocked: the server still records it once */ }
  return reportAuthEvent('signed-in', accessToken);
}
