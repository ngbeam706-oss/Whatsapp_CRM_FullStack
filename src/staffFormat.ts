import { emailInitials } from './crmUtils';
import type { StaffPoints } from './types';

// Formatting helpers for "My profile" and the Team page's performance views (components: staffStatsUi.tsx).

export const PERIODS = [7, 30, 90] as const;

/** 3.4 -> "3 min", 75 -> "1 h 15 min", 0.4 -> "under 1 min". */
export function fmtMinutes(m: number | null | undefined) {
  if (m === null || m === undefined) return '–';
  if (m < 1) return 'under 1 min';
  if (m < 60) return `${Math.round(m)} min`;
  const h = Math.floor(m / 60);
  const rest = Math.round(m % 60);
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

export function fmtAgo(iso: string | null | undefined) {
  if (!iso) return 'no activity yet';
  const mins = (Date.now() - Date.parse(iso)) / 60000;
  if (mins < 2) return 'just now';
  if (mins < 60) return `${Math.round(mins)} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** "Ravi Kumar" -> "RK"; falls back to the email's initials. */
export function initials(name: string | null | undefined, email: string) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length) return ((parts[0][0] || '') + (parts[1]?.[0] || parts[0][1] || '')).toUpperCase();
  return emailInitials(email);
}

export const pointsHelp = (p: StaffPoints) =>
  `Points: chats handled ×${p.chats}, conversions ×${p.conversions}, queries resolved ×${p.queriesResolved}, calls ×${p.calls}, notes ×${p.notes}.`;

export const MEDAL = ['🥇', '🥈', '🥉'];
