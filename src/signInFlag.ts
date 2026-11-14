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
