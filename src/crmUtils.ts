// Shared helpers for the Inbox, Pipeline and Team screens (no components here).
import type { Access, Contact, Me, Role, Stage, StaffMember } from './types';

// Pipeline stages, worded to fit any business: a hospital (enquiry -> appointment -> visit -> follow-up),
// a food business (enquiry -> order -> delivered -> reorder), a shop, a service... The internal keys stay
// the same as before (mirrors server/inbox.cjs), so existing contacts keep their stage.
export const STAGES: Stage[] = ['new', 'interested', 'ordered', 'completed', 'repeat', 'lost'];

export interface StageInfo { label: string; hint: string; cls: string; dot: string }

export const STAGE_INFO: Record<Stage, StageInfo> = {
  new: { label: 'New enquiry', hint: 'Just reached out', cls: 'bg-slate-100 text-slate-700 border-slate-200', dot: 'bg-slate-400' },
  interested: { label: 'In discussion', hint: 'Asking about services, doctors, prices or timings', cls: 'bg-amber-50 text-amber-800 border-amber-200', dot: 'bg-amber-400' },
  ordered: { label: 'Booked', hint: 'Appointment booked or order placed', cls: 'bg-sky-50 text-sky-800 border-sky-200', dot: 'bg-sky-500' },
  completed: { label: 'Completed', hint: 'Visited, treated or delivered', cls: 'bg-violet-50 text-violet-800 border-violet-200', dot: 'bg-violet-500' },
  repeat: { label: 'Returning', hint: 'Came back for a follow-up, another visit or another order', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200', dot: 'bg-emerald-500' },
  lost: { label: 'Closed', hint: 'Not going ahead, or gone quiet', cls: 'bg-rose-50 text-rose-700 border-rose-200', dot: 'bg-rose-400' },
};

/**
 * Roles (mirrors server/tenant.cjs):
 *   owner   = Business Admin: everything, incl. team, WhatsApp and AI keys
 *   manager = bot, keywords, AI switch/knowledge, broadcasts, follow-ups, reassigning chats, analytics
 *   agent   = own and unassigned chats
 */
export const canManage = (role: string | null | undefined): boolean => role === 'owner' || role === 'manager';
export const ROLE_LABELS: Record<Role, string> = { owner: 'Business Admin', manager: 'Manager', agent: 'Agent' };
export const roleLabel = (role: string): string => ROLE_LABELS[role as Role] || role;

/**
 * Ownership (mirrors server/inbox.cjs):
 *   'unassigned' - anyone may act; acting makes it theirs
 *   'mine'       - full control, incl. transfer
 *   'other'      - view only (owners may still reassign)
 */
export function accessOf(contact: Pick<Contact, 'assigned_to'> | null | undefined, me: Partial<Me> | null | undefined): Access {
  if (!contact?.assigned_to) return 'unassigned';
  return String(contact.assigned_to).toLowerCase() === String(me?.email || '').toLowerCase() ? 'mine' : 'other';
}

/** Who `me` may pick in the "Assigned to" menu for this contact. null = menu disabled. */
export function assigneeChoices(contact: Pick<Contact, 'assigned_to'> | null | undefined, me: Partial<Me> | null | undefined, staff: StaffMember[]): string[] | null {
  const access = accessOf(contact, me);
  if (canManage(me?.role) || access === 'mine') return staff.map(s => s.email);
  if (access === 'unassigned') return staff.filter(s => s.email.toLowerCase() === String(me?.email).toLowerCase()).map(s => s.email);
  return null;
}

const AVATAR_COLORS = ['bg-emerald-600', 'bg-teal-600', 'bg-blue-600', 'bg-indigo-600', 'bg-purple-600', 'bg-cyan-700', 'bg-amber-600'];

export function avatarBg(str: string | null | undefined): string {
  let hash = 0;
  for (let i = 0; i < String(str || '').length; i++) hash = String(str).charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

type Named = Pick<Contact, 'name' | 'phone'> | null | undefined;

export function displayName(contact: Named): string {
  const n = String(contact?.name || '').trim();
  return n && n !== 'WhatsApp User' && n !== 'WhatsApp Contact' ? n : `+${contact?.phone || ''}`;
}

export function initials(contact: Named): string {
  const n = displayName(contact);
  if (n.startsWith('+')) return n.slice(-2);
  return n.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

export function emailInitials(email: string | null | undefined): string {
  const local = String(email || '').split('@')[0];
  const parts = local.split(/[._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || parts[0]?.[1] || '')).toUpperCase() || '?';
}

/** "now", "5m", "3h", "Tue", "4 Nov" */
export function shortTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = new Date(iso);
  const diff = Date.now() - t.getTime();
  if (diff < 60000) return 'now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diff < 6 * 86400000) return t.toLocaleDateString([], { weekday: 'short' });
  return t.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export function timeLeft(iso: string | null | undefined): string | null {
  const ms = Date.parse(iso || '') - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
}
