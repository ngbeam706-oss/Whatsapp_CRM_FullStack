// Each business's own lead statuses (server/leadStatuses.cjs, GET /api/lead-statuses), one cached copy for the
// Pipeline, Inbox, Analytics and Settings -> Lead statuses. Before it loads (or before the SQL is run) the
// original six are used, so screens never flash empty.
import { useApi } from './queryClient';
import { STAGES, STAGE_INFO } from './crmUtils';
import type { Stage } from './types';

export type StatusType = 'new' | 'working' | 'won' | 'done' | 'repeat' | 'lost';
export interface LeadStatus { key: string; label: string; hint: string | null; color: string; type: StatusType; sort_order: number; active: boolean }
export interface LeadStatusesResponse {
  statuses: LeadStatus[];
  types: Array<{ key: StatusType; label: string }>;
  colors: string[];
  max: number;
  /** Chats per status key (managers and the Business Admin only). */
  counts?: Record<string, number>;
}

/** Tailwind classes per colour name (written out in full so the build keeps them). */
export const COLOR_CLS: Record<string, { cls: string; dot: string }> = {
  slate: { cls: 'bg-slate-100 text-slate-700 border-slate-200', dot: 'bg-slate-400' },
  amber: { cls: 'bg-amber-50 text-amber-800 border-amber-200', dot: 'bg-amber-400' },
  sky: { cls: 'bg-sky-50 text-sky-800 border-sky-200', dot: 'bg-sky-500' },
  violet: { cls: 'bg-violet-50 text-violet-800 border-violet-200', dot: 'bg-violet-500' },
  emerald: { cls: 'bg-emerald-50 text-emerald-800 border-emerald-200', dot: 'bg-emerald-500' },
  rose: { cls: 'bg-rose-50 text-rose-700 border-rose-200', dot: 'bg-rose-400' },
  teal: { cls: 'bg-teal-50 text-teal-800 border-teal-200', dot: 'bg-teal-500' },
  indigo: { cls: 'bg-indigo-50 text-indigo-800 border-indigo-200', dot: 'bg-indigo-500' },
  orange: { cls: 'bg-orange-50 text-orange-800 border-orange-200', dot: 'bg-orange-500' },
  pink: { cls: 'bg-pink-50 text-pink-800 border-pink-200', dot: 'bg-pink-500' },
  lime: { cls: 'bg-lime-50 text-lime-800 border-lime-200', dot: 'bg-lime-500' },
  cyan: { cls: 'bg-cyan-50 text-cyan-800 border-cyan-200', dot: 'bg-cyan-500' },
};
const LEGACY_COLOR: Record<Stage, string> = { new: 'slate', interested: 'amber', ordered: 'sky', completed: 'violet', repeat: 'emerald', lost: 'rose' };
const LEGACY_TYPE: Record<Stage, StatusType> = { new: 'new', interested: 'working', ordered: 'won', completed: 'done', repeat: 'repeat', lost: 'lost' };

/** The original six (used until the business's list has loaded). */
export const DEFAULT_STATUSES: LeadStatus[] = STAGES.map((s, i) => ({
  key: s, label: STAGE_INFO[s].label, hint: STAGE_INFO[s].hint, color: LEGACY_COLOR[s], type: LEGACY_TYPE[s], sort_order: i + 1, active: true,
}));

/** What each type means, in plain words (Settings -> Lead statuses). */
export const TYPE_HELP: Record<StatusType, string> = {
  new: 'Where new chats start.',
  working: 'You are talking to them. The bot moves a new chat here when they look at your services or menu.',
  won: 'Booked or ordered. The bot\'s "Book" moves chats here; counts as a conversion and is sent to Meta for ad chats (if switched on).',
  done: 'Visited, treated or delivered. Counts as a conversion.',
  repeat: 'Came back and booked or ordered again. Counts as a conversion.',
  lost: 'Not going ahead.',
};

/** The business's statuses (cached; one request shared by every screen). */
export function useLeadStatuses() {
  const q = useApi<LeadStatusesResponse>('/api/lead-statuses', { staleTime: 60000 });
  const all = q.data?.statuses?.length ? q.data.statuses : DEFAULT_STATUSES;
  return { all, active: all.filter(s => s.active), data: q.data, loading: q.isLoading, error: q.error };
}

/** Label and colours for a status key (an unknown key shows as itself, in grey). */
export function statusLook(list: LeadStatus[], key: string | null | undefined): { label: string; hint: string; cls: string; dot: string } {
  const s = list.find(x => x.key === key) || (key ? undefined : list.find(x => x.key === 'new'));
  const c = COLOR_CLS[s?.color || 'slate'] || COLOR_CLS.slate;
  return { label: s?.label || (key ? String(key) : 'New'), hint: s?.hint || '', cls: c.cls, dot: c.dot };
}
