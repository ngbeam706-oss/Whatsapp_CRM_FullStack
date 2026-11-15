// Shared building blocks for every dashboard screen (docs/progress/ui-enhancement.md, U0).
// New screens and reworked screens use these instead of hand-made headers, pop-ups and empty states,
// so the whole app looks and behaves the same.
import { useEffect, useId, useRef, useState, type ReactNode, type ComponentType } from 'react';
import { X, AlertTriangle, RotateCw, Loader2 } from 'lucide-react';

type IconType = ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;

// ---------------------------------------------------------------------------
// Buttons (same height and shape everywhere). The older btnPrimary / btnSecondary strings in
// broadcastUtils.ts stay valid; these add the danger and quiet kinds.
// ---------------------------------------------------------------------------
const BTN_BASE = 'rounded-lg px-3 py-2 text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer transition disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1';
export const BUTTON = {
  primary: `${BTN_BASE} bg-wa-teal text-white hover:opacity-90 focus-visible:ring-wa-teal`,
  secondary: `${BTN_BASE} bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 focus-visible:ring-wa-teal`,
  danger: `${BTN_BASE} bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600`,
  quiet: `${BTN_BASE} text-slate-600 hover:bg-slate-100 focus-visible:ring-wa-teal`,
} as const;

// ---------------------------------------------------------------------------
// Page header: title, one line of help, actions on the right.
// ---------------------------------------------------------------------------
export function PageHeader({ icon: Icon, title, help, actions }: { icon?: IconType; title: ReactNode; help?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          {Icon && <Icon className="w-5 h-5 text-wa-teal flex-shrink-0" aria-hidden="true" />}{title}
        </h1>
        {help && <p className="text-sm text-slate-500 mt-0.5">{help}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, children, className = '' }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`bg-white border border-slate-200 rounded-xl p-4 ${className}`}>
      {title && <h2 className="text-base font-semibold text-slate-800 mb-2">{title}</h2>}
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Empty state and loading placeholders
// ---------------------------------------------------------------------------
export function EmptyState({ icon: Icon, title, text, action }: { icon?: IconType; title: ReactNode; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="bg-white border border-dashed border-slate-300 rounded-xl px-6 py-10 text-center" data-testid="empty-state">
      {Icon && <Icon className="w-10 h-10 text-slate-300 mx-auto mb-2" aria-hidden="true" />}
      <div className="text-base font-semibold text-slate-700">{title}</div>
      {text && <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">{text}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

// Loading placeholders (docs/progress/ui-enhancement.md, "Loading states"): every screen shows grey shapes
// like its content while data loads, never a blank area or a bare "Loading…". The pulse is off for people who
// ask their system for less motion (motion-safe). Each one is a role="status" with a label for screen readers
// and data-testid="skeleton" for the tests.
const PULSE = 'motion-safe:animate-pulse';

/** One grey block (size it with className, e.g. "h-4 w-1/3"). */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`bg-slate-200 rounded ${PULSE} ${className}`} />;
}

/** Grey placeholder rows while data loads (looks like progress, not "stuck"). */
export function SkeletonRows({ rows = 4, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div className="space-y-2" role="status" aria-label={label} data-testid="skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={`bg-white border border-slate-200 rounded-xl p-3 ${PULSE} flex items-center gap-3`}>
          <div className="w-9 h-9 rounded-full bg-slate-200" />
          <div className="flex-1 space-y-2">
            <div className="h-3 bg-slate-200 rounded w-1/3" />
            <div className="h-3 bg-slate-100 rounded w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Number tiles (dashboards, reports) while they load. */
export function SkeletonCards({ count = 3, label = 'Loading' }: { count?: number; label?: string }) {
  return (
    <div className={`grid gap-2 sm:gap-3 ${count >= 4 ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-3'}`} role="status" aria-label={label} data-testid="skeleton">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`bg-white border border-slate-200 rounded-xl p-3 space-y-2 ${PULSE}`}>
          <div className="h-3 bg-slate-100 rounded w-2/3" />
          <div className="h-6 bg-slate-200 rounded w-1/3" />
        </div>
      ))}
    </div>
  );
}

/** A settings form (label + field pairs in a card) while it loads. */
export function SkeletonForm({ fields = 4, label = 'Loading' }: { fields?: number; label?: string }) {
  return (
    <div className={`bg-white border border-slate-200 rounded-xl p-4 space-y-4 ${PULSE}`} role="status" aria-label={label} data-testid="skeleton">
      <div className="h-4 bg-slate-200 rounded w-1/4" />
      {Array.from({ length: fields }, (_, i) => (
        <div key={i} className="space-y-1.5">
          <div className="h-3 bg-slate-100 rounded w-1/5" />
          <div className="h-9 bg-slate-100 border border-slate-200 rounded-lg" />
        </div>
      ))}
    </div>
  );
}

/** Columns of cards (the Pipeline board) while it loads. */
export function SkeletonBoard({ columns = 4, label = 'Loading' }: { columns?: number; label?: string }) {
  return (
    <div className="flex gap-3 p-3 md:p-4 overflow-hidden" role="status" aria-label={label} data-testid="skeleton">
      {Array.from({ length: columns }, (_, c) => (
        <div key={c} className={`w-full md:w-72 flex-shrink-0 bg-slate-50 border border-slate-200 rounded-xl p-2 space-y-2 ${PULSE} ${c > 0 ? 'hidden md:block' : ''}`}>
          <div className="h-4 bg-slate-200 rounded w-1/2 m-1" />
          {Array.from({ length: 3 - (c % 2) }, (_, i) => (
            <div key={i} className="bg-white border border-slate-200 rounded-lg p-3 space-y-2">
              <div className="h-3 bg-slate-200 rounded w-2/3" />
              <div className="h-3 bg-slate-100 rounded w-1/2" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** The Inbox (chat list + conversation) while it loads. */
export function SkeletonChat({ label = 'Loading chats' }: { label?: string }) {
  return (
    <div className="flex-1 min-h-0 flex" role="status" aria-label={label} data-testid="skeleton">
      <div className={`w-full md:w-80 flex-shrink-0 bg-white border-r border-slate-200 p-3 space-y-3 ${PULSE}`}>
        <div className="h-9 bg-slate-100 rounded-lg" />
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-slate-200 flex-shrink-0" />
            <div className="flex-1 space-y-2"><div className="h-3 bg-slate-200 rounded w-1/2" /><div className="h-3 bg-slate-100 rounded w-4/5" /></div>
          </div>
        ))}
      </div>
      <div className="hidden md:flex flex-1"><ConversationShapes /></div>
    </div>
  );
}

function ConversationShapes() {
  return (
    <div className={`flex-1 flex flex-col justify-end gap-3 p-6 bg-slate-50 ${PULSE}`} aria-hidden="true">
      <div className="h-10 bg-white rounded-xl w-1/2" />
      <div className="h-10 bg-teal-50 rounded-xl w-2/5 self-end" />
      <div className="h-10 bg-white rounded-xl w-1/3" />
      <div className="h-11 bg-white border border-slate-200 rounded-xl mt-2" />
    </div>
  );
}

/** One open conversation (message bubbles + reply box) while it loads. */
export function SkeletonConversation({ label = 'Loading the conversation' }: { label?: string }) {
  return <div className="flex-1 flex flex-col" role="status" aria-label={label} data-testid="skeleton"><ConversationShapes /></div>;
}

export type SkeletonKind = 'list' | 'cards' | 'form' | 'board' | 'chat' | 'table';

/**
 * A whole screen while its code or first data loads: a title line, then content shaped like the screen.
 * Used as the Suspense fallback of every lazy screen (ScreenLoading) and by screens with no data yet.
 */
export function SkeletonPage({ kind = 'list', label = 'Loading' }: { kind?: SkeletonKind; label?: string }) {
  if (kind === 'chat') return <SkeletonChat label={label} />;
  if (kind === 'board') {
    return (
      <div className="flex-1 min-h-0 flex flex-col bg-slate-100">
        <div className="px-4 py-3 border-b border-slate-200 bg-white flex items-center gap-3"><Skeleton className="h-5 w-48" /><Skeleton className="h-3 w-40 hidden sm:block" /></div>
        <SkeletonBoard label={label} />
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-hidden bg-slate-100">
      <div className="max-w-5xl mx-auto px-4 py-5 space-y-4">
        <div className="space-y-2"><Skeleton className="h-6 w-56" /><Skeleton className="h-3 w-80 max-w-full bg-slate-100" /></div>
        {kind === 'cards' && <><SkeletonCards count={4} label={label} /><SkeletonRows rows={3} label={label} /></>}
        {kind === 'form' && <SkeletonForm label={label} />}
        {kind === 'table' && <SkeletonTable label={label} />}
        {kind === 'list' && <SkeletonRows rows={5} label={label} />}
      </div>
    </div>
  );
}

/**
 * The whole dashboard frame (top bar, side menu, page) while an area's code downloads: the Platform console,
 * the doctor area, or the dashboard itself on first open. Looks like the app, so nothing flashes white.
 */
export function AppFrameSkeleton({ label = 'Loading the dashboard' }: { label?: string }) {
  return (
    <div className="bg-slate-200 h-screen flex flex-col overflow-hidden" data-testid="app-frame-skeleton">
      <div className="bg-wa-teal h-14 flex-shrink-0 px-4 flex items-center gap-3">
        <div className={`w-8 h-8 rounded-lg bg-white/25 ${PULSE}`} />
        <div className={`h-3 w-32 rounded bg-white/25 ${PULSE}`} />
        <div className={`ml-auto h-8 w-8 rounded-full bg-white/20 ${PULSE}`} />
      </div>
      <div className="flex-1 min-h-0 flex">
        <div className={`hidden md:block w-56 bg-white border-r border-slate-200 p-3 space-y-3 ${PULSE}`} aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => <div key={i} className="h-4 bg-slate-100 rounded w-4/5" />)}
        </div>
        <SkeletonPage kind="list" label={label} />
      </div>
    </div>
  );
}

/** A pop-up whose code is still downloading: the dimmed backdrop and a small card, so the click shows at once. */
export function DialogLoading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-end sm:items-center justify-center sm:p-4" data-testid="dialog-loading">
      <div role="status" aria-label={label} className={`bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 space-y-3 ${PULSE}`}>
        <div className="h-5 bg-slate-200 rounded w-1/2" />
        <div className="h-3 bg-slate-100 rounded w-full" />
        <div className="h-3 bg-slate-100 rounded w-4/5" />
        <div className="h-9 bg-slate-100 rounded-lg w-1/3 ml-auto" />
      </div>
    </div>
  );
}

/** The public website while its code downloads: a header and a hero block, on the site's white page. */
export function SiteSkeleton() {
  return (
    <div className="min-h-screen bg-white flex flex-col" role="status" aria-label="Loading" data-testid="skeleton">
      <div className="border-b border-slate-100 px-4 h-16 flex items-center gap-3 max-w-6xl w-full mx-auto">
        <Skeleton className="w-9 h-9 rounded-lg" /><Skeleton className="h-4 w-32" />
        <Skeleton className="ml-auto h-9 w-24 rounded-lg" />
      </div>
      <div className="max-w-3xl w-full mx-auto px-4 py-16 space-y-4 text-center">
        <Skeleton className="h-8 w-3/4 mx-auto" /><Skeleton className="h-8 w-1/2 mx-auto" />
        <Skeleton className="h-4 w-2/3 mx-auto bg-slate-100" />
        <Skeleton className="h-11 w-44 mx-auto rounded-lg" />
      </div>
    </div>
  );
}

/** A table (Leads, reports) while it loads. */
export function SkeletonTable({ rows = 6, cols = 4, label = 'Loading' }: { rows?: number; cols?: number; label?: string }) {
  return (
    <div className={`bg-white border border-slate-200 rounded-xl overflow-hidden ${PULSE}`} role="status" aria-label={label} data-testid="skeleton">
      <div className="flex gap-4 px-4 py-3 bg-slate-50 border-b border-slate-200">
        {Array.from({ length: cols }, (_, c) => <div key={c} className="h-3 bg-slate-200 rounded flex-1" />)}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-4 px-4 py-3 border-b border-slate-100 last:border-0">
          {Array.from({ length: cols }, (_, c) => <div key={c} className={`h-3 rounded flex-1 ${c === 0 ? 'bg-slate-200' : 'bg-slate-100'}`} />)}
        </div>
      ))}
    </div>
  );
}

/**
 * Loading failed: the reason and a "Try again" button (busy while it retries).
 * onRetry is usually the query's refetch; without it only the message shows.
 */
export function LoadError({ error, onRetry, className = '' }: { error: ReactNode; onRetry?: () => unknown; className?: string }) {
  const [busy, setBusy] = useState(false);
  const retry = async () => {
    if (!onRetry) return;
    setBusy(true);
    try { await onRetry(); } finally { setBusy(false); }
  };
  return (
    <div role="alert" data-testid="load-error" className={`p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex flex-wrap items-center gap-2 ${className}`}>
      <AlertTriangle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
      <span className="flex-1 min-w-0">{error || 'Could not load this. Check your connection.'}</span>
      {onRetry && (
        <button type="button" onClick={retry} disabled={busy} className={`${BUTTON.secondary} py-1.5`}>
          <RotateCw className={`w-3.5 h-3.5 ${busy ? 'motion-safe:animate-spin' : ''}`} aria-hidden="true" />{busy ? 'Trying again…' : 'Try again'}
        </button>
      )}
    </div>
  );
}

/** Small spinner for buttons while they save (pair with disabled + a "Saving…" label). */
export function Spinner({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return <Loader2 className={`${className} motion-safe:animate-spin`} aria-hidden="true" />;
}

// ---------------------------------------------------------------------------
// Modal (centred) and Drawer (from the right): Esc closes, focus stays inside, backdrop click closes.
// ---------------------------------------------------------------------------
function useDialogBehaviour(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const el = ref.current;
    // Focus the first field or button inside, so keyboard users start in the dialog.
    const first = el?.querySelector<HTMLElement>('input, textarea, select, button:not([data-close]), [href]');
    (first || el)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current(); return; }
      if (e.key !== 'Tab' || !el) return;
      const items = Array.from(el.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (!items.length) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstItem) { e.preventDefault(); lastItem.focus(); }
      else if (!e.shiftKey && document.activeElement === lastItem) { e.preventDefault(); firstItem.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('keydown', onKey, true); before?.focus?.(); };
  }, []);
  return ref;
}

export function Modal({ title, onClose, children, footer, wide = false }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useDialogBehaviour(onClose);
  const titleId = useId();
  return (
    <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-end sm:items-center justify-center sm:p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className={`bg-white w-full ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'} max-h-[92vh] flex flex-col rounded-t-2xl sm:rounded-2xl shadow-2xl outline-none`}>
        <div className="flex items-center gap-2 px-5 pt-4 pb-2">
          <h2 id={titleId} className="text-base font-bold text-slate-800 flex-1">{title}</h2>
          <button data-close onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-5 pb-4 overflow-y-auto text-sm text-slate-700">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-slate-100 flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ title, onClose, children }: { title?: ReactNode; onClose: () => void; children: ReactNode }) {
  const ref = useDialogBehaviour(onClose);
  const titleId = useId();
  return (
    <div className="fixed inset-0 bg-slate-900/40 z-50 flex justify-end" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined} tabIndex={-1} className="bg-white w-full max-w-xl h-full shadow-2xl flex flex-col outline-none">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100">
          <div id={titleId} className="text-base font-bold text-slate-800 flex-1 min-w-0">{title}</div>
          <button data-close onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

/** Esc closes a panel or pop-up that isn't built on Modal / Drawer. */
export function useEscape(onClose: () => void): void {
  const ref = useRef(onClose);
  useEffect(() => { ref.current = onClose; }, [onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') ref.current(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}

// ---------------------------------------------------------------------------
// "Larger text" (My profile menu): scales every rem-based size by 12.5%. Remembered in this browser.
// ---------------------------------------------------------------------------
const TEXT_KEY = 'ui_text_size_v1';
export function readLargeText(): boolean {
  try { return localStorage.getItem(TEXT_KEY) === 'large'; } catch { return false; }
}
export function applyLargeText(on: boolean): void {
  document.documentElement.classList.toggle('text-large', on);
  try { localStorage.setItem(TEXT_KEY, on ? 'large' : 'normal'); } catch { /* storage blocked: only this visit */ }
}
