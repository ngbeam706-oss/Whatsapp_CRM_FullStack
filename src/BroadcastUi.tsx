// Shared UI pieces for the Broadcasts / Automations screens.
import React from 'react';
import { STATUS_STYLES, inputCls, inputInlineCls } from './broadcastUtils';
import type { TemplateComponent, VariableSpec } from './types';

export function Badge({ value }: { value: string }) {
  return <span className={`px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide ${STATUS_STYLES[value] || 'bg-slate-100 text-slate-700'}`}>{value}</span>;
}

export function Field({ label, hint, children }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-700">{label}</span>
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      <div className="mt-1">{children}</div>
    </label>
  );
}

interface TemplatePreviewProps {
  headerText?: string;
  headerFormat?: string | null;
  bodyText?: string;
  footerText?: string;
  buttons?: NonNullable<TemplateComponent['buttons']>;
}

/** WhatsApp-style preview bubble for a template. */
export function TemplatePreview({ headerText, headerFormat, bodyText, footerText, buttons = [] }: TemplatePreviewProps) {
  const renderText = (t: string) => String(t || '').split('\n').map((line, i) => (
    <React.Fragment key={i}>
      {i > 0 && <br />}
      {line.split(/(\*[^*]+\*)/g).map((part, j) => (part.startsWith('*') && part.endsWith('*') && part.length > 2
        ? <strong key={j}>{part.slice(1, -1)}</strong>
        : <span key={j}>{part}</span>))}
    </React.Fragment>
  ));
  return (
    <div className="bg-wa-chatBg rounded-xl p-4">
      <div className="max-w-[300px] bg-white rounded-lg shadow-sm overflow-hidden text-[13px] text-wa-textPrimary">
        <div className="p-2.5 space-y-1">
          {headerFormat && headerFormat !== 'TEXT' && (
            <div className="h-28 bg-slate-200 rounded flex items-center justify-center text-xs text-slate-500 uppercase">{headerFormat}</div>
          )}
          {headerText && <div className="font-bold">{headerText}</div>}
          <div className="whitespace-pre-wrap break-words">{bodyText ? renderText(bodyText) : <span className="text-slate-400">Message body…</span>}</div>
          {footerText && <div className="text-xs text-wa-textSecondary">{footerText}</div>}
          <div className="text-xs text-wa-textSecondary text-right">12:00</div>
        </div>
        {buttons.filter(b => b.text).map((b, i) => (
          <div key={i} className="border-t border-slate-100 py-2 text-center text-[13px] text-sky-600 font-medium">{b.text}</div>
        ))}
      </div>
    </div>
  );
}

interface VariableInputProps {
  label: string;
  spec?: VariableSpec;
  onChange: (spec: VariableSpec) => void;
  /** Offer "Item they ordered / viewed" (automations triggered by an item). */
  allowItem?: boolean;
}

export function VariableInput({ label, spec, onChange, allowItem = false }: VariableInputProps) {
  const type = spec?.type || 'contact_name';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-mono text-xs text-slate-500 w-20">{label}</span>
      <select className={`${inputInlineCls} w-60`} value={type}
        onChange={e => onChange({ type: e.target.value, value: '', fallback: e.target.value === 'event_item' ? 'your order' : 'there' })}>
        <option value="contact_name">Customer's first name</option>
        {allowItem && <option value="event_item">Item they ordered / viewed</option>}
        <option value="text">Same text for everyone</option>
      </select>
      {type === 'contact_name' || type === 'event_item' ? (
        <label className="flex-1 min-w-[180px] flex items-center gap-2">
          <span className="text-xs text-slate-500 whitespace-nowrap">{type === 'event_item' ? 'If unknown:' : 'If name unknown:'}</span>
          <input className={inputCls} value={spec?.fallback ?? (type === 'event_item' ? 'your order' : 'there')}
            onChange={e => onChange({ ...spec, type, fallback: e.target.value })} />
        </label>
      ) : (
        <input className={`${inputInlineCls} flex-1 min-w-[140px]`} value={spec?.value || ''} onChange={e => onChange({ ...spec, type, value: e.target.value })} placeholder="e.g. 20% off" />
      )}
    </div>
  );
}
