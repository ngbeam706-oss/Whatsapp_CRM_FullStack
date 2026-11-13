// Shared building blocks for every dashboard screen (docs/progress/ui-enhancement.md, U0).
// New screens and reworked screens use these instead of hand-made headers, pop-ups and empty states,
// so the whole app looks and behaves the same.
import { useEffect, useId, useRef, type ReactNode, type ComponentType } from 'react';
import { X } from 'lucide-react';

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

/** Grey placeholder rows while data loads (looks like progress, not "stuck"). */
export function SkeletonRows({ rows = 4, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div className="space-y-2" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="bg-white border border-slate-200 rounded-xl p-3 animate-pulse flex items-center gap-3">
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
