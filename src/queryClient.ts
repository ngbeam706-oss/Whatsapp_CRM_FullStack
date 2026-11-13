// Shared data loading for the dashboard (TanStack Query).
//
// One cache for every screen: two screens asking for the same /api address share one request,
// switching tabs shows the last data instantly while it refreshes, and failed requests retry.
//
// Netlify credits rule (see CLAUDE.md): nothing refreshes while the browser tab is hidden
// (refetchIntervalInBackground: false), and coming back to the tab refreshes once
// (refetchOnWindowFocus). Screens pass their refresh interval from REFRESH in usePolling.ts.
import { QueryClient, useQuery, keepPreviousData, type Query, type UseQueryResult } from '@tanstack/react-query';
import { api, ApiError } from './broadcastUtils';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15000,          // data younger than this is shown without asking again
      gcTime: 5 * 60 * 1000,     // unused data is kept 5 minutes for instant tab switches
      // Retry network hiccups and server errors (twice), never "not allowed" / "not found" (4xx).
      retry: (count, err) => count < 2 && !(err instanceof ApiError && err.status >= 400 && err.status < 500),
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      refetchOnWindowFocus: true,
      refetchIntervalInBackground: false,
    },
    mutations: { retry: 0 }, // never repeat a send/save automatically
  },
});

type ApiKey = readonly ['api', string];
const keyFor = (path: string): ApiKey => ['api', path];

export interface UseApiOptions<T> {
  /** ms between refreshes (only while the tab is visible), or a function of the query, or false. */
  refetchInterval?: number | false | ((query: Query<T, Error, T, ApiKey>) => number | false | undefined);
  enabled?: boolean;
  /** Keep showing the previous address's data while a new one loads (e.g. a date-range switch). */
  keepPrevious?: boolean;
  staleTime?: number;
}

/**
 * GET an /api address through the shared cache. `path` null/'' = not yet (e.g. no chat open).
 * The default `any` keeps the not-yet-typed .jsx screens working; typed callers pass their own T.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useApi<T = any>(path: string | null | undefined, { refetchInterval, enabled = true, keepPrevious = false, staleTime }: UseApiOptions<T> = {}): UseQueryResult<T, Error> {
  return useQuery<T, Error, T, ApiKey>({
    queryKey: keyFor(path || ''),
    queryFn: ({ signal }) => api<T>(path as string, { signal }),
    enabled: enabled && !!path,
    refetchInterval,
    placeholderData: keepPrevious ? keepPreviousData : undefined,
    ...(staleTime !== undefined ? { staleTime } : {}),
  });
}

/** Refresh every cached /api address that starts with `prefix` (after a save, send or move). */
export function refreshApi(prefix: string): Promise<void> {
  return queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'api' && String(q.queryKey[1]).startsWith(prefix) });
}

/** Change cached data directly (optimistic updates). */
export function setApiData<T>(path: string, updater: (old: T | undefined) => T | undefined): void {
  queryClient.setQueryData<T>(keyFor(path), updater);
}

/** First error message of one or more query results, or ''. */
export function errorOf(...results: Array<{ error?: Error | null } | null | undefined>): string {
  const e = results.find(r => r?.error)?.error;
  return e ? e.message || 'Something went wrong.' : '';
}
