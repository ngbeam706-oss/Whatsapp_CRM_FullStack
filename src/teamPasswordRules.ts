import type { Role, StaffMember } from './types';

// Rules for team passwords set by the Business Admin / managers (same as server/team.cjs).

/** A random password that's easy to read out: letters (no look-alikes) and digits, 12 characters. */
export function generatePassword() {
  const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const all = letters + digits;
  const rnd = new Uint32Array(12);
  crypto.getRandomValues(rnd);
  return Array.from(rnd, (n, i) => (i === 3 ? digits[n % digits.length] : i === 0 ? letters[n % letters.length] : all[n % all.length])).join('');
}

/** 8+ characters, a letter and a number ('' when fine). */
export const passwordProblem = (p: string) =>
  (p.length < 8 ? 'Use at least 8 characters.' : !/[A-Za-z]/.test(p) || !/\d/.test(p) ? 'Use letters and at least one number.' : '');

/** May I set this member's password? Managers: agents. Business Admin: agents and managers. Never myself. */
export const canSetPassword = (myRole: Role, m: StaffMember, isMe: boolean) =>
  !isMe && ((myRole === 'owner' && (m.role === 'agent' || m.role === 'manager')) || (myRole === 'manager' && m.role === 'agent'));
