import type { ReactNode } from 'react';
import { Briefcase, Phone, HeartPulse, Lock } from 'lucide-react';
import { inputCls } from './broadcastUtils';

// Staff onboarding / personal details (server/staffStats.cjs FIELDS), shared by:
//   Team -> Add a team member (filled in by the Business Admin / a manager),
//   Team -> a member -> Edit details, and My profile (the person's own contact details).
// Employee ID, joining date and branch are set by the Business Admin / managers only.

export type DetailKey = 'fullName' | 'jobTitle' | 'employeeCode' | 'joinedOn' | 'workLocation' | 'phone' | 'languages' | 'address' | 'emergencyContactName' | 'emergencyContactPhone';
export type StaffDetails = Partial<Record<DetailKey, string>>;

interface Def { key: DetailKey; label: string; max: number; placeholder?: string; type?: string; admin?: boolean; wide?: boolean; multiline?: boolean; hint?: string }
const GROUPS: Array<{ title: string; icon: typeof Briefcase; defs: Def[] }> = [
  {
    title: 'Work', icon: Briefcase, defs: [
      { key: 'jobTitle', label: 'Job title', max: 60, placeholder: 'e.g. Front desk, Customer support' },
      { key: 'employeeCode', label: 'Employee ID', max: 30, placeholder: 'e.g. SC-0042', admin: true },
      { key: 'joinedOn', label: 'Joining date', max: 10, type: 'date', admin: true },
      { key: 'workLocation', label: 'Branch / location', max: 80, placeholder: 'e.g. Main branch, Kukatpally', admin: true },
    ],
  },
  {
    title: 'Contact', icon: Phone, defs: [
      { key: 'phone', label: 'Phone', max: 20, type: 'tel', placeholder: '+91 98765 43210' },
      { key: 'languages', label: 'Languages', max: 120, placeholder: 'e.g. Telugu, English, Hindi' },
      { key: 'address', label: 'Address', max: 200, placeholder: 'House, street, area, city, PIN', wide: true, multiline: true },
    ],
  },
  {
    title: 'Emergency contact', icon: HeartPulse, defs: [
      { key: 'emergencyContactName', label: 'Name and relation', max: 80, placeholder: 'e.g. Lakshmi (mother)' },
      { key: 'emergencyContactPhone', label: 'Phone', max: 20, type: 'tel', placeholder: '+91 98765 43210' },
    ],
  },
];
export const DETAIL_KEYS: DetailKey[] = ['fullName', ...GROUPS.flatMap(g => g.defs.map(d => d.key))];
export const ADMIN_KEYS: DetailKey[] = GROUPS.flatMap(g => g.defs.filter(d => d.admin).map(d => d.key));
export const DETAIL_LABEL: Record<DetailKey, string> = { fullName: 'Full name', ...Object.fromEntries(GROUPS.flatMap(g => g.defs.map(d => [d.key, d.label]))) } as Record<DetailKey, string>;

/** Only the fields that changed (for saving). */
export function changedDetails(before: StaffDetails, after: StaffDetails): StaffDetails {
  const out: StaffDetails = {};
  for (const k of DETAIL_KEYS) if ((before[k] || '') !== (after[k] || '')) out[k] = (after[k] || '').trim();
  return out;
}

/** The form fields, grouped. adminFields: 'edit' (Business Admin / manager) or 'readonly' (My profile). */
export function StaffDetailsFields({ value, onChange, adminFields, idPrefix = 'sd', withName = false }: {
  value: StaffDetails; onChange: (v: StaffDetails) => void; adminFields: 'edit' | 'readonly'; idPrefix?: string; withName?: boolean;
}) {
  const set = (k: DetailKey, v: string) => onChange({ ...value, [k]: v });
  const field = (d: Def): ReactNode => {
    const id = `${idPrefix}-${d.key}`;
    const locked = d.admin && adminFields === 'readonly';
    return (
      <div key={d.key} className={d.wide ? 'sm:col-span-2' : ''}>
        <label htmlFor={id} className="text-xs text-slate-600 flex items-center gap-1">{d.label}{locked && <Lock className="w-3 h-3 text-slate-400" aria-label="Set by your Business Admin or manager" />}</label>
        {d.multiline
          ? <textarea id={id} rows={2} value={value[d.key] || ''} onChange={e => set(d.key, e.target.value)} maxLength={d.max} placeholder={d.placeholder} className={`${inputCls} mt-1`} />
          : <input id={id} type={d.type || 'text'} value={value[d.key] || ''} onChange={e => set(d.key, e.target.value)} maxLength={d.max} placeholder={locked ? '' : d.placeholder}
              readOnly={locked} disabled={locked} className={`${inputCls} mt-1 ${locked ? 'bg-slate-50 text-slate-500' : ''}`} />}
        {d.hint && <span className="text-xs text-slate-400">{d.hint}</span>}
      </div>
    );
  };
  return (
    <div className="space-y-3" data-testid={`${idPrefix}-fields`}>
      {withName && (
        <div>
          <label htmlFor={`${idPrefix}-fullName`} className="text-xs text-slate-600">Full name</label>
          <input id={`${idPrefix}-fullName`} value={value.fullName || ''} onChange={e => set('fullName', e.target.value)} maxLength={80} placeholder="e.g. Ravi Kumar" className={`${inputCls} mt-1`} />
        </div>
      )}
      {GROUPS.map(g => (
        <fieldset key={g.title} className="border border-slate-200 rounded-lg p-3">
          <legend className="text-xs font-bold uppercase tracking-wide text-slate-500 px-1 flex items-center gap-1"><g.icon className="w-3.5 h-3.5" /> {g.title}</legend>
          <div className="grid sm:grid-cols-2 gap-3">{g.defs.map(field)}</div>
        </fieldset>
      ))}
      {adminFields === 'readonly' && <p className="text-xs text-slate-400 flex items-center gap-1"><Lock className="w-3 h-3" /> Employee ID, joining date and branch are set by your Business Admin or manager.</p>}
    </div>
  );
}

/** Read-only list of the details a viewer may see (empty ones show "–"). */
export function StaffDetailsView({ value }: { value: StaffDetails }) {
  const shown = GROUPS.map(g => ({ ...g, defs: g.defs.filter(d => d.key in value) })).filter(g => g.defs.length);
  const fmt = (d: Def, v: string | undefined) => (!v ? '–' : d.type === 'date' ? new Date(`${v}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : v);
  return (
    <div className="space-y-3" data-testid="staff-details-view">
      {shown.map(g => (
        <div key={g.title}>
          <div className="text-xs font-bold uppercase tracking-wide text-slate-400 flex items-center gap-1 mb-1"><g.icon className="w-3 h-3" /> {g.title}</div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
            {g.defs.map(d => (
              <div key={d.key} className={`min-w-0 ${d.wide ? 'col-span-2' : ''}`}>
                <dt className="text-xs text-slate-400">{d.label}</dt>
                <dd className="text-slate-700 break-words whitespace-pre-line">{fmt(d, value[d.key])}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}
