// In-app "Are you sure?" dialogs (replace window.confirm / window.prompt).
//   const confirm = useConfirm();
//   if (!(await confirm({ title: 'Delete template?', body: '…', confirmLabel: 'Delete', danger: true }))) return;
//   const note = await confirm.ask({ title: 'Decline request?', label: 'Note (optional)' }); // string | null
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal, BUTTON } from './ui';

export interface ConfirmOptions {
  title: ReactNode;
  /** What will happen, and whether it can be undone. */
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red button + warning icon, for deleting, removing, suspending, sending to many people. */
  danger?: boolean;
}
export interface AskOptions extends ConfirmOptions {
  /** A text box in the dialog; the answer is what was typed ('' allowed), or null when cancelled. */
  label: string;
  placeholder?: string;
}

/** A plain sentence is shown as the dialog's text under "Please confirm". */
type ConfirmFn = ((opts: ConfirmOptions | string) => Promise<boolean>) & { ask: (opts: AskOptions) => Promise<string | null> };
const asOptions = (o: ConfirmOptions | string): ConfirmOptions => (typeof o === 'string' ? { title: 'Please confirm', body: o } : o);

const Ctx = createContext<ConfirmFn | null>(null);

interface Pending { opts: AskOptions | ConfirmOptions; withInput: boolean; resolve: (v: boolean | string | null) => void }

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [value, setValue] = useState('');
  // The dialog on screen and the ones waiting behind it (kept in refs: no side effects in state updaters).
  const current = useRef<Pending | null>(null);
  const queue = useRef<Pending[]>([]);

  const open = useCallback((p: Pending) => {
    if (current.current) { queue.current.push(p); return; }
    current.current = p;
    setValue('');
    setPending(p);
  }, []);
  const finish = useCallback((result: boolean | string | null) => {
    const done = current.current;
    current.current = queue.current.shift() || null;
    setValue('');
    setPending(current.current);
    done?.resolve(result);
  }, []);

  const fn = useMemo<ConfirmFn>(() => Object.assign(
    (opts: ConfirmOptions | string) => new Promise<boolean>(resolve => open({ opts: asOptions(opts), withInput: false, resolve: v => resolve(v === true) })),
    { ask: (opts: AskOptions) => new Promise<string | null>(resolve => open({ opts, withInput: true, resolve: v => resolve(typeof v === 'string' ? v : null) })) },
  ), [open]);

  const o = pending?.opts;
  return (
    <Ctx.Provider value={fn}>
      {children}
      {pending && o && (
        <Modal
          title={<span className="flex items-center gap-2">{o.danger && <AlertTriangle className="w-5 h-5 text-red-600" aria-hidden="true" />}{o.title}</span>}
          onClose={() => finish(pending.withInput ? null : false)}
          footer={(
            <>
              <button className={BUTTON.secondary} onClick={() => finish(pending.withInput ? null : false)}>{o.cancelLabel || 'Cancel'}</button>
              <button className={o.danger ? BUTTON.danger : BUTTON.primary} data-testid="confirm-ok"
                onClick={() => finish(pending.withInput ? value : true)}>{o.confirmLabel || 'OK'}</button>
            </>
          )}
        >
          {o.body && <div className="leading-relaxed">{o.body}</div>}
          {pending.withInput && (
            <label className="block mt-3 text-xs font-medium text-slate-700">{(o as AskOptions).label}
              <textarea rows={3} value={value} onChange={e => setValue(e.target.value)} placeholder={(o as AskOptions).placeholder}
                className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-wa-teal" />
            </label>
          )}
        </Modal>
      )}
    </Ctx.Provider>
  );
}

/** The confirm function. Outside the provider (tests, odd mounts) it falls back to the browser's own dialogs. */
export function useConfirm(): ConfirmFn {
  const fn = useContext(Ctx);
  if (fn) return fn;
  return Object.assign(
    async (opts: ConfirmOptions | string) => {
      const o = asOptions(opts);
      return window.confirm([o.title, o.body].filter(x => typeof x === 'string').join('\n\n') || 'Are you sure?');
    },
    { ask: async (opts: AskOptions) => window.prompt(String(typeof opts.title === 'string' ? opts.title : opts.label), '') },
  );
}
