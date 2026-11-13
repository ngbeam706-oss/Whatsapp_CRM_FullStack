import React, { type ReactNode } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { apiFetch } from './apiClient';

interface ErrorBoundaryProps {
  /** Which screen this guards (shown in the report). */
  name?: string;
  /** Whole-page fallback (the app root) instead of one screen. */
  fullPage?: boolean;
  /** false = don't send a crash report (e.g. the login screen). */
  report?: boolean;
  children?: ReactNode;
}
interface ErrorBoundaryState { error: unknown }

/** The parts of a thrown value we read (it may not be an Error). */
const errorParts = (error: unknown): { name?: unknown; message?: unknown } =>
  (error && typeof error === 'object' ? (error as { name?: unknown; message?: unknown }) : {});

// Catches a crash inside one screen so the rest of the app (header, other tabs) keeps working.
// Without it, any render error turns the whole dashboard into a blank white page.
//
// The crash is reported to the server (POST /api/client-errors) as a short, scrubbed note for the
// Platform Admin's event log: error type + first line of the message + which screen. Never props,
// state or chat content.

const reported = new Set<string>(); // one report per screen + message per page load

function report(screen: string, error: unknown) {
  try {
    const message = String(errorParts(error).message || error || 'Unknown error').split('\n')[0].slice(0, 200);
    const key = `${screen}|${message}`;
    if (reported.has(key)) return;
    reported.add(key);
    apiFetch('/api/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ screen, name: String(errorParts(error).name || 'Error').slice(0, 60), message, path: window.location.pathname }),
    }).catch(() => { /* reporting must never cause another error */ });
  } catch { /* ignore */ }
}

// After a deploy, a tab opened before it asks for screen files that no longer exist. Reloading
// once fetches the new version; the timestamp stops a reload loop if the files are really missing.
const STALE_CHUNK_RE = /dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk .* failed/i;
function reloadOnceForNewVersion(error: unknown) {
  if (!STALE_CHUNK_RE.test(String(errorParts(error).message || ''))) return false;
  try {
    const last = Number(sessionStorage.getItem('reloadedForNewVersionAt') || 0);
    if (Date.now() - last < 60000) return false;
    sessionStorage.setItem('reloadedForNewVersionAt', String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: unknown) {
    if (reloadOnceForNewVersion(error)) return;
    console.error(`[${this.props.name || 'app'}] crashed:`, error);
    if (this.props.report !== false) report(this.props.name || 'app', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const full = this.props.fullPage;
    return (
      <div className={`${full ? 'min-h-screen' : 'flex-1'} flex items-center justify-center p-6 bg-slate-50`} role="alert">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-5 text-center space-y-3 shadow-sm">
          <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto" />
          <h2 className="text-base font-bold text-slate-800">Something went wrong{this.props.name && !full ? ` on this page` : ''}</h2>
          <p className="text-sm text-slate-600">
            {full
              ? 'The dashboard hit an unexpected error. Reloading usually fixes it.'
              : 'This page hit an unexpected error. Your other tabs still work. Try again, or reload the dashboard.'}
            {' '}The problem has been reported.
          </p>
          <div className="flex justify-center gap-2">
            {!full && (
              <button onClick={() => this.setState({ error: null })} className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg px-3 py-2 text-xs font-semibold cursor-pointer">
                Try again
              </button>
            )}
            <button onClick={() => window.location.reload()} className="bg-wa-teal hover:opacity-90 text-white rounded-lg px-3 py-2 text-xs font-semibold flex items-center gap-1.5 cursor-pointer">
              <RotateCw className="w-3.5 h-3.5" /> Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}

/** Shown while a screen's code is downloading (screens load on first open). */
export function ScreenLoading() {
  return <div className="flex-1 flex items-center justify-center text-sm text-slate-500">Loading…</div>;
}
