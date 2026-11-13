// Shared helpers for the Broadcasts / Automations screens (no components here), and api(): the JSON
// helper every screen uses for /api calls.
import { apiFetch } from './apiClient';
import type { Template, TemplateComponent } from './types';

/** An /api answer that was not 2xx. `status` lets the data cache skip retries on 4xx (queryClient.ts). */
export class ApiError extends Error {
  status: number;
  data: Record<string, unknown> & { error?: string; paused?: boolean };
  constructor(message: string, status: number, data: ApiError['data']) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

/** The text to show for anything a `catch` received (an ApiError, another Error, or a thrown value). */
export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export interface ApiOptions extends Omit<RequestInit, 'body'> {
  /** Sent as JSON. */
  body?: unknown;
}

/** Call our /api with the signed-in user's token; JSON in, JSON out. Throws ApiError on 4xx/5xx. */
// The default `any` keeps the not-yet-typed .jsx screens working; typed callers pass their own T.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function api<T = any>(path: string, options: ApiOptions = {}): Promise<T> {
  const res = await apiFetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...((options.headers as Record<string, string>) || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let data: ApiError['data'] = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, res.status, data);
  return data as T;
}

/** Variable names in a template text: "Hi {{1}}, {{name}}" -> ['1', 'name']. */
export const placeholders = (text: string | null | undefined): string[] => {
  const seen: string[] = [];
  for (const m of String(text || '').matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)) if (!seen.includes(m[1])) seen.push(m[1]);
  return seen;
};

export interface TemplateNeeds {
  headerFormat: string | null;
  headerText: string;
  headerVars: string[];
  bodyText: string;
  bodyVars: string[];
  footerText: string;
  buttons: NonNullable<TemplateComponent['buttons']>;
}

/** What a template needs filled in before it can be sent. */
export function templateNeeds(t: Template | null | undefined): TemplateNeeds {
  const comps = t?.components || [];
  const header = comps.find(c => c.type === 'HEADER');
  const body = comps.find(c => c.type === 'BODY');
  const headerFormat = header ? (header.format || 'TEXT') : null;
  return {
    headerFormat,
    headerText: headerFormat === 'TEXT' ? header?.text || '' : '',
    headerVars: headerFormat === 'TEXT' ? placeholders(header?.text) : [],
    bodyText: body?.text || '',
    bodyVars: placeholders(body?.text),
    footerText: comps.find(c => c.type === 'FOOTER')?.text || '',
    buttons: comps.find(c => c.type === 'BUTTONS')?.buttons || [],
  };
}

export const fmtDate = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '–');
/** Whole percent of n out of d; a missing n counts as 0, a missing or zero d gives 0. */
export const pct = (n: number | string | null | undefined, d: number | string | null | undefined): number =>
  (Number(d) ? Math.round(((Number(n) || 0) / Number(d)) * 100) : 0);

export const STATUS_STYLES: Record<string, string> = {
  APPROVED: 'bg-emerald-100 text-emerald-800',
  PENDING: 'bg-amber-100 text-amber-800',
  REJECTED: 'bg-red-100 text-red-700',
  PAUSED: 'bg-slate-200 text-slate-700',
  DISABLED: 'bg-slate-200 text-slate-700',
  draft: 'bg-slate-100 text-slate-700',
  sending: 'bg-blue-100 text-blue-800',
  completed: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-slate-200 text-slate-600',
  queued: 'bg-slate-100 text-slate-600',
  sent: 'bg-sky-100 text-sky-800',
  delivered: 'bg-teal-100 text-teal-800',
  read: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-red-100 text-red-700',
  skipped: 'bg-slate-100 text-slate-500',
  on: 'bg-emerald-100 text-emerald-800',
  paused: 'bg-slate-200 text-slate-600',
  waiting: 'bg-blue-100 text-blue-800',
};

export const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-wa-teal';
// Same look without full width, for controls sized with w-20 / w-48 etc.
export const inputInlineCls = inputCls.replace('w-full ', '');
export const btnPrimary = 'bg-wa-teal hover:opacity-90 disabled:opacity-50 text-white rounded-lg px-3 py-2 text-xs font-semibold flex items-center gap-1.5 cursor-pointer';
export const btnSecondary = 'bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 text-slate-700 rounded-lg px-3 py-2 text-xs font-semibold flex items-center gap-1.5 cursor-pointer';
