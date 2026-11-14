// Lead filter helpers shared by the Inbox and the Leads page (server/leadsTools.cjs cleanFilters / filterParts).
// Each person's last choice is remembered in this browser (localStorage; never sent anywhere else).
import { useEffect, useState } from 'react';
import { useApi } from './queryClient';
import type { StatusType } from './leadStatuses';

export type DateRange = 'today' | '2d' | '7d' | '30d' | 'custom' | 'all';
export interface MoreFilterValues { range: DateRange; from: string; to: string; statusType: '' | StatusType; source: string; adId: string; tag: string; optedOut: boolean; returning?: boolean }
export const RANGE_LABEL: Record<DateRange, string> = { today: 'Today', '2d': 'Last 2 days', '7d': 'Last 7 days', '30d': 'Last 30 days', custom: 'Dates…', all: 'All time' };
export const NO_MORE_FILTERS: MoreFilterValues = { range: 'all', from: '', to: '', statusType: '', source: '', adId: '', tag: '', optedOut: false };
export const TYPE_FILTER_LABEL: Record<StatusType, string> = { new: 'New', working: 'Working on it', won: 'Booked / ordered', done: 'Done', repeat: 'Returning', lost: 'Lost / closed' };

/** Query-string / body form of the "more" filters (empty values left out). */
export function moreFilterParams(f: MoreFilterValues): Record<string, string> {
  const out: Record<string, string> = { range: f.range };
  if (f.range === 'custom') { if (f.from) out.from = f.from; if (f.to) out.to = f.to; }
  if (f.statusType) out.statusType = f.statusType;
  if (f.source) out.source = f.source;
  if (f.adId) out.adId = f.adId;
  if (f.tag) out.tag = f.tag;
  if (f.optedOut) out.optedOut = 'true';
  if (f.returning) out.returning = 'true';
  return out;
}
/** How many "more" filters are on (the date range not counted). */
export const moreCount = (f: MoreFilterValues) => [f.statusType, f.source, f.adId, f.tag, f.optedOut, f.returning].filter(Boolean).length;

/** State remembered per person in localStorage (falls back to `initial` when storage is unavailable). */
export function useStoredState<T extends object>(key: string, initial: T): [T, (next: T | ((old: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try { const raw = localStorage.getItem(key); return raw ? { ...initial, ...JSON.parse(raw) } : initial; } catch { return initial; }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: not remembered */ } }, [key, value]);
  return [value, setValue];
}

export interface FilterOptions { sources: string[]; tags: string[]; ads: Array<{ id: string; headline: string }>; addSources: string[] }
/** Values for the menus (this business's own sources, tags and ads). */
export function useFilterOptions(enabled = true) {
  return useApi<FilterOptions>('/api/inbox-filter-options', { enabled, staleTime: 5 * 60000 }).data;
}
