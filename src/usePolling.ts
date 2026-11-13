import { useEffect } from 'react';

/**
 * Refresh data every `ms` while the browser tab is visible. Nothing is fetched while the tab is
 * hidden (each request is a billed server call on Netlify); coming back to the tab refreshes once.
 * New code uses useApi (queryClient.ts) with `refetchInterval` instead; this remains for the
 * Platform console screens.
 */
export function useVisiblePolling(fn: () => unknown, ms: number, enabled = true): void {
  useEffect(() => {
    if (!enabled) return undefined;
    const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible';
    const timer = setInterval(() => { if (visible()) fn(); }, ms);
    const onVisibility = () => { if (visible()) fn(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fn, ms, enabled]);
}

// How often each screen refreshes while open (milliseconds).
export const REFRESH = {
  inboxList: 15000,
  openChat: 8000,
  pipeline: 30000,
  campaigns: 20000,
  // Header bell (counts only): once a minute while the tab is visible.
  notifications: 60000,
  // Home "My work": every 30 s while visible (same pace as the pipeline).
  home: 30000,
  queries: 30000,
  // Platform console health + alerts (only while the Health tab is open and visible).
  platformHealth: 60000,
} as const;
