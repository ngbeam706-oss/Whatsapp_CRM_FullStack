import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useConfirm } from './confirm';
import { Wrench, Power, Clock, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { api, errorMessage, inputCls, btnPrimary } from './broadcastUtils';
import { MAINTENANCE_EVENT } from './apiClient';
import type { ShowToast } from './types';

// Platform maintenance mode (server/maintenance.cjs).
//  - MaintenanceScreen: what business staff see while it is on (checks every minute and comes back by itself).
//  - MaintenancePanel: the Platform Admin's switch in the platform console.
//  - MaintenanceStrip: the console's reminder that it is on.

export interface MaintenanceInfo { message: string; until: string | null }
export interface MaintenanceState { on: boolean; message: string | null; until: string | null; startedAt: string | null; updatedBy?: string | null; updatedAt?: string | null }

const CHECK_MS = 60 * 1000;
const fmtWhen = (iso: string | null | undefined) =>
  (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');

/** The maintenance answer from any API request (apiClient), or null. */
export function useMaintenanceSignal(): [MaintenanceInfo | null, () => void] {
  const [info, setInfo] = useState<MaintenanceInfo | null>(null);
  useEffect(() => {
    const on = (e: Event) => setInfo((e as CustomEvent<MaintenanceInfo>).detail);
    window.addEventListener(MAINTENANCE_EVENT, on);
    return () => window.removeEventListener(MAINTENANCE_EVENT, on);
  }, []);
  return [info, () => setInfo(null)];
}

// ---------------------------------------------------------------------------
// Staff: the maintenance screen
// ---------------------------------------------------------------------------

export function MaintenanceScreen({ info, onBack, footer }: { info: MaintenanceInfo; onBack: () => void; footer?: ReactNode }) {
  const [checking, setChecking] = useState(false);

  // Ask (public, no login needed) whether maintenance is over: every minute while the tab is visible.
  const check = async () => {
    setChecking(true);
    try {
      const r = await fetch('/api/maintenance');
      const d = await r.json();
      if (r.ok && d && d.on === false) onBack();
    } catch { /* offline: try again later */ }
    finally { setChecking(false); }
  };
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') void check(); }, CHECK_MS);
    return () => clearInterval(t);
    // check only uses stable values
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-md p-6 text-center space-y-3" role="alert">
        <div className="w-14 h-14 mx-auto rounded-full bg-amber-100 text-amber-700 flex items-center justify-center">
          <Wrench className="w-7 h-7" />
        </div>
        <h1 className="text-lg font-bold text-slate-800">Under maintenance</h1>
        <p className="text-sm text-slate-600 whitespace-pre-wrap">{info.message || 'The platform is under maintenance. Please check back in a little while.'}</p>
        {info.until && (
          <p className="text-xs text-slate-500 flex items-center justify-center gap-1"><Clock className="w-3.5 h-3.5" /> Expected back by {fmtWhen(info.until)}</p>
        )}
        <p className="text-xs text-slate-400">Customers' WhatsApp messages are still received and saved. You'll see them when we're back.</p>
        <button onClick={check} disabled={checking} className={`${btnPrimary} mx-auto`}>{checking ? 'Checking…' : 'Check again'}</button>
        <p className="text-xs text-slate-400">This page checks by itself every minute.</p>
        {footer && <div className="flex justify-center pt-1">{footer}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Platform Admin: the switch
// ---------------------------------------------------------------------------

export function MaintenanceStrip({ state, onOpen }: { state: MaintenanceState | null; onOpen: () => void }) {
  if (!state?.on) return null;
  return (
    <button onClick={onOpen} className="w-full text-left p-3 bg-amber-50 border border-amber-300 rounded-xl text-xs text-amber-900 flex items-center gap-2 cursor-pointer">
      <Wrench className="w-4 h-4 flex-shrink-0" />
      <span><strong>Maintenance mode is ON</strong> since {fmtWhen(state.startedAt)}{state.updatedBy ? ` (${state.updatedBy})` : ''}. Business dashboards are closed. <span className="underline">Manage</span></span>
    </button>
  );
}

/** 'YYYY-MM-DDTHH:mm' in local time, for a datetime-local input. */
const localInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function MaintenancePanel({ state, onChanged, showToast }: { state: MaintenanceState | null; onChanged: (s: MaintenanceState) => void; showToast: ShowToast }) {
  const confirm = useConfirm();
  const [message, setMessage] = useState(state?.message || '');
  const [until, setUntil] = useState(localInput(state?.until || null));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const on = !!state?.on;

  const save = async (next: boolean, e?: FormEvent) => {
    e?.preventDefault();
    const sure = next
      ? 'Switch maintenance ON? Every business dashboard closes right away (customers\' WhatsApp messages are still received, and the bot keeps answering).'
      : 'Switch maintenance OFF? Business dashboards open again, and held broadcasts and follow-ups continue.';
    if (!await confirm(sure)) return;
    setBusy(true); setErr('');
    try {
      const r = await api<{ maintenance: MaintenanceState }>('/api/platform/maintenance', {
        method: 'PUT',
        body: { on: next, message: message.trim() || null, until: next && until ? new Date(until).toISOString() : null },
      });
      onChanged(r.maintenance);
      showToast(next ? 'Maintenance mode is ON' : 'Maintenance mode is OFF: dashboards are open again');
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 max-w-2xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Wrench className="w-5 h-5 text-slate-700" /> Maintenance mode</h1>
          <p className="text-xs text-slate-500 mt-0.5">Close every business dashboard while you update or fix the platform.</p>
        </div>
        <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${on ? 'bg-amber-100 text-amber-900' : 'bg-emerald-50 text-emerald-800'}`}>
          {on ? <AlertTriangle className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />} {on ? 'Under maintenance' : 'Normal'}
        </span>
      </div>

      {on && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 space-y-0.5">
          <div>On since <strong>{fmtWhen(state?.startedAt)}</strong>{state?.updatedBy ? <> by <strong>{state.updatedBy}</strong></> : null}.</div>
          {state?.until && <div>Staff are told: back by {fmtWhen(state.until)}.</div>}
        </div>
      )}

      <ul className="text-xs text-slate-600 space-y-1 list-disc pl-5">
        <li>Staff of every business see a maintenance screen with your message. It reopens by itself when you switch off.</li>
        <li>Customers' WhatsApp messages are still received and saved, and the bot keeps answering.</li>
        <li>Broadcasts and follow-ups wait, and continue after maintenance.</li>
        <li>This console keeps working.</li>
      </ul>

      <form onSubmit={(e) => save(!on, e)} className="space-y-3">
        <label className="block text-xs text-slate-600">Message for staff
          <textarea rows={3} maxLength={500} value={message} onChange={e => setMessage(e.target.value)} className={`${inputCls} mt-1`}
            placeholder="We're upgrading the platform. Back in about 30 minutes." />
        </label>
        {!on && (
          <label className="block text-xs text-slate-600">Expected back by (optional)
            <input type="datetime-local" value={until} onChange={e => setUntil(e.target.value)} className={`${inputCls} mt-1 max-w-xs`} />
          </label>
        )}
        {err && <div className="p-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{err}</div>}
        <button type="submit" disabled={busy || !state}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white cursor-pointer disabled:opacity-50 ${on ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-600 hover:bg-amber-700'}`}>
          <Power className="w-4 h-4" /> {busy ? 'Saving…' : on ? 'Switch maintenance off' : 'Switch maintenance on'}
        </button>
      </form>
    </section>
  );
}
