// Shared labels and colours for queries (mirrors server/queries.cjs).

export type QueryStage = 'new' | 'assigned' | 'in_progress' | 'waiting' | 'escalated' | 'resolved' | 'closed' | 'reopened';
export type Priority = 'low' | 'normal' | 'high' | 'urgent';

/** A query as the list and detail screens receive it (GET /api/queries, /api/support). */
export interface Query {
  id: string;
  ref?: string;
  kind?: 'customer' | 'internal' | string;
  stage: QueryStage | string;
  priority?: Priority | string;
  subject?: string;
  description?: string | null;
  category?: string | null;
  due_at?: string | null;
  overdue?: boolean;
  contact_phone?: string | null;
  assigned_to?: string | null;
  created_at?: string;
  updated_at?: string;
  source?: string;
  addressed_to?: string;
  raised_by_email?: string | null;
  escalation_level?: number;
  rating?: number | null;
  rating_comment?: string | null;
}

/** One line in a query's timeline. */
export interface QueryEvent {
  id?: string | number;
  type: string;
  body?: string | null;
  visibility?: 'all' | 'handlers' | 'platform' | string;
  author_email?: string | null;
  author_role?: string | null;
  created_at?: string;
  data?: { source?: string; to?: string; from?: string; reason?: string; rating?: number | string } | null;
}

/** GET /api/queries/:id and /api/support/:id */
export interface QueryDetailResponse {
  query: Query;
  /** handler = may work on it, viewer = escalated above this role, requester = raised it */
  access?: 'handler' | 'viewer' | 'requester';
  canWork?: boolean;
  events?: QueryEvent[];
}

/** GET /api/queries/settings (categories, due times; `allCategories` only for the Business Admin). */
export interface QueryCategoryRow { kind: 'customer' | 'internal'; name: string; is_active: boolean; sort_order?: number }
export interface QuerySettings {
  categories: { customer: string[]; internal: string[]; platform: string[] };
  dueHours: Record<Priority, number>;
  industry: string;
  stages: QueryStage[];
  priorities: Priority[];
  allCategories?: QueryCategoryRow[];
}

export const QUERY_STAGES: QueryStage[] = ['new', 'assigned', 'in_progress', 'waiting', 'escalated', 'resolved', 'closed', 'reopened'];
export const OPEN_QUERY_STAGES: QueryStage[] = ['new', 'assigned', 'in_progress', 'waiting', 'escalated', 'reopened'];

export const QUERY_STAGE_INFO: Record<QueryStage, { label: string; cls: string }> = {
  new: { label: 'New', cls: 'bg-slate-100 text-slate-700 border-slate-200' },
  assigned: { label: 'Assigned', cls: 'bg-sky-50 text-sky-800 border-sky-200' },
  in_progress: { label: 'In progress', cls: 'bg-blue-50 text-blue-800 border-blue-200' },
  waiting: { label: 'Waiting', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  escalated: { label: 'Escalated', cls: 'bg-orange-50 text-orange-800 border-orange-200' },
  resolved: { label: 'Resolved', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  closed: { label: 'Closed', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
  reopened: { label: 'Reopened', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
};

export const PRIORITIES: Priority[] = ['low', 'normal', 'high', 'urgent'];
export const PRIORITY_INFO: Record<Priority, { label: string; cls: string }> = {
  low: { label: 'Low', cls: 'text-slate-500' },
  normal: { label: 'Normal', cls: 'text-slate-700' },
  high: { label: 'High', cls: 'text-orange-700 font-semibold' },
  urgent: { label: 'Urgent', cls: 'text-red-700 font-bold' },
};

// Allowed manual stage moves (same table as the server's MOVES).
export const QUERY_MOVES: Record<QueryStage, QueryStage[]> = {
  new: ['assigned', 'in_progress', 'waiting', 'escalated', 'resolved', 'closed'],
  assigned: ['in_progress', 'waiting', 'escalated', 'resolved', 'closed'],
  in_progress: ['waiting', 'escalated', 'resolved', 'closed'],
  waiting: ['in_progress', 'escalated', 'resolved', 'closed'],
  escalated: ['assigned', 'in_progress', 'waiting', 'resolved', 'closed'],
  resolved: ['closed', 'reopened'],
  closed: ['reopened'],
  reopened: ['assigned', 'in_progress', 'waiting', 'escalated', 'resolved', 'closed'],
};

export const SOURCE_LABEL: Record<string, string> = { bot: 'WhatsApp bot', ai: 'AI handover', staff: 'Staff' };
export const ADDRESSED_LABEL: Record<string, string> = { team: 'Team', managers: 'Managers', owner: 'Business Admin' };

const stageName = (s: string | undefined): string => QUERY_STAGE_INFO[s as QueryStage]?.label || s || '';

/** One line for the timeline. */
export function eventText(e: QueryEvent): string {
  const d = e.data || {};
  switch (e.type) {
    case 'created': return d.source === 'bot' ? 'Customer raised it on WhatsApp' : d.source === 'ai' ? 'Created from the AI handover' : 'Raised';
    case 'assigned': return d.to ? `Assigned to ${d.to}` : 'Unassigned';
    case 'stage': return `${stageName(d.from)} → ${stageName(d.to)}${d.reason ? ` (${d.reason})` : ''}`;
    case 'priority': return `Priority set to ${PRIORITY_INFO[d.to as Priority]?.label || d.to}`;
    case 'escalated': return d.to === 'platform' ? 'Sent to Platform support' : `Escalated to ${d.to === 'owner' ? 'the Business Admin' : 'managers'}`;
    case 'rating': return `Rated ${d.rating}/5`;
    case 'reply': return 'Reply sent to the customer';
    case 'note': return 'Internal note';
    case 'comment': return 'Comment';
    case 'customer_not_told': return 'Customer not told';
    default: return e.type;
  }
}

export const ago = (iso: string): string => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return new Date(iso).toLocaleDateString();
};

const isOpen = (stage: string): boolean => (OPEN_QUERY_STAGES as string[]).includes(stage);

/** "in 3 h", "2 h overdue", "–". */
export function dueText(q: Pick<Query, 'due_at' | 'stage'> | null | undefined): string {
  if (!q?.due_at || !isOpen(q.stage)) return '';
  if (q.stage === 'waiting') return 'clock paused';
  const ms = Date.parse(q.due_at) - Date.now();
  const h = Math.abs(ms) / 3600000;
  const span = h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`;
  return ms < 0 ? `${span} overdue` : `due in ${span}`;
}
