import { useState, type FormEvent } from 'react';
import { Building2, Save, Lock, Clock } from 'lucide-react';
import { Link } from 'react-router';
import { api, errorMessage, inputCls, btnPrimary } from './broadcastUtils';
import { useApi, refreshApi, errorOf } from './queryClient';
import type { ShowToast } from './types';

// "Business details" on the Business Admin's My profile (server/business.cjs, SQL 20261131): what the business is
// and how to reach it. Name and details are saved together; sending hours stay in Settings -> Setup; the business
// type is set by the platform (it decides Meta's healthcare rules).

const KEYS = ['about', 'legalName', 'phone', 'email', 'website', 'address', 'city', 'state', 'pin', 'gstin', 'registrationNo', 'hours'] as const;
type Key = typeof KEYS[number];
type Details = Record<Key, string>;
interface BusinessResponse {
  business: { name: string; industry?: string | null; sendWindowStart: number; sendWindowEnd: number; details?: Partial<Details>; detailsReady?: boolean };
}

const FIELD: Record<Key, { label: string; placeholder: string; max: number; type?: string; wide?: boolean; rows?: number; hint?: string }> = {
  about: { label: 'About the business', placeholder: 'e.g. A 50-bed multi-speciality hospital in Hyderabad. Diabetes care, eye care and pharmacy.', max: 1000, wide: true, rows: 3 },
  legalName: { label: 'Registered name', placeholder: 'e.g. Sunrise Healthcare Pvt Ltd', max: 120 },
  registrationNo: { label: 'Registration / licence number', placeholder: 'e.g. clinic or FSSAI licence', max: 60 },
  phone: { label: 'Business phone', placeholder: '+91 40 1234 5678', max: 20, type: 'tel' },
  email: { label: 'Business email', placeholder: 'contact@example.com', max: 120, type: 'email' },
  website: { label: 'Website', placeholder: 'www.example.com', max: 200 },
  hours: { label: 'Opening hours', placeholder: 'e.g. Mon–Sat 9 am–8 pm, Sun 9 am–1 pm', max: 200 },
  address: { label: 'Address', placeholder: 'Building, street, area', max: 300, wide: true, rows: 2 },
  city: { label: 'City', placeholder: 'Hyderabad', max: 60 },
  state: { label: 'State', placeholder: 'Telangana', max: 60 },
  pin: { label: 'PIN code', placeholder: '500001', max: 6, hint: '6 digits' },
  gstin: { label: 'GSTIN', placeholder: '36ABCDE1234F1Z5', max: 15, hint: 'Optional, 15 characters' },
};
const GROUPS: Array<[string, Key[]]> = [
  ['About', ['about', 'legalName', 'registrationNo']],
  ['Contact', ['phone', 'email', 'website', 'hours']],
  ['Address', ['address', 'city', 'state', 'pin']],
  ['Tax', ['gstin']],
];
const industryLabel = (s?: string | null) => (s ? s.replace(/[_-]+/g, ' ').replace(/^./, c => c.toUpperCase()) : 'Not set');
const hour = (h: number) => (h === 0 || h === 24 ? '12 am' : h === 12 ? '12 pm' : h < 12 ? `${h} am` : `${h - 12} pm`);

export default function BusinessDetailsCard({ showToast, settingsPath }: { showToast: ShowToast; settingsPath: string }) {
  const q = useApi<BusinessResponse>('/api/business', { staleTime: 60000 });
  const b = q.data?.business;
  const error = errorOf(q);
  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3" aria-label="Business details" data-testid="business-details">
      <div className="text-sm font-semibold text-slate-800 flex items-center gap-2"><Building2 className="w-4 h-4 text-wa-teal" /> Business details</div>
      {error && <div className="p-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>}
      {!b && !error && <div className="text-xs text-slate-500">Loading…</div>}
      {b && <BusinessForm key={JSON.stringify(b)} b={b} showToast={showToast} settingsPath={settingsPath} />}
    </section>
  );
}

function BusinessForm({ b, showToast, settingsPath }: { b: BusinessResponse['business']; showToast: ShowToast; settingsPath: string }) {
  const initial = Object.fromEntries(KEYS.map(k => [k, b.details?.[k] || ''])) as Details;
  const [name, setName] = useState(b.name || '');
  const [form, setForm] = useState<Details>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const changed = Object.fromEntries(KEYS.filter(k => form[k].trim() !== initial[k]).map(k => [k, form[k].trim()]));
  const nameChanged = name.trim() !== (b.name || '');
  const dirty = nameChanged || Object.keys(changed).length > 0;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    if (nameChanged && (name.trim().length < 2 || name.trim().length > 80)) { setErr('Business name must be 2 to 80 characters.'); return; }
    setBusy(true);
    try {
      await api('/api/business', { method: 'PUT', body: { ...(nameChanged ? { name: name.trim() } : {}), ...(Object.keys(changed).length ? { details: changed } : {}) } });
      showToast('Business details saved');
      await Promise.all([refreshApi('/api/business'), refreshApi('/api/me/profile'), refreshApi('/api/status')]);
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-3">
      {b.detailsReady === false && (
        <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">The database isn&apos;t ready for business details yet: run the SQL file <code>20261131_business_details.sql</code> in Supabase. The business name can still be changed.</div>
      )}
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block text-xs text-slate-600">
          <span className="font-semibold text-slate-700">Business name</span>
          <input value={name} onChange={e => setName(e.target.value)} maxLength={80} className={`${inputCls} mt-1`} aria-label="Business name" />
          <span className="text-xs text-slate-400">Shown in the CRM and on your WhatsApp list messages.</span>
        </label>
        <div className="text-xs text-slate-600">
          <span className="font-semibold text-slate-700 flex items-center gap-1">Type of business <Lock className="w-3 h-3 text-slate-400" /></span>
          <div className="mt-1 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-700" data-testid="business-industry">{industryLabel(b.industry)}</div>
          <span className="text-xs text-slate-400">Set by the platform (it decides which Meta ad rules apply). Ask through &quot;Raise a query&quot; to change it.</span>
        </div>
      </div>
      {GROUPS.map(([title, keys]) => (
        <fieldset key={title} className="border border-slate-200 rounded-lg p-3">
          <legend className="text-xs font-bold uppercase tracking-wide text-slate-500 px-1">{title}</legend>
          <div className="grid sm:grid-cols-2 gap-3">
            {keys.map(k => {
              const f = FIELD[k];
              const common = { value: form[k], maxLength: f.max, placeholder: f.placeholder, 'aria-label': f.label, disabled: b.detailsReady === false, className: `${inputCls} mt-1`,
                onChange: (e: { target: { value: string } }) => setForm(x => ({ ...x, [k]: e.target.value })) };
              return (
                <label key={k} className={`block text-xs text-slate-600 ${f.wide ? 'sm:col-span-2' : ''}`}>
                  <span className="flex justify-between"><span className="font-semibold text-slate-700">{f.label}</span>{f.rows && <span className="text-slate-400">{form[k].length}/{f.max}</span>}</span>
                  {f.rows ? <textarea rows={f.rows} {...common} /> : <input type={f.type || 'text'} {...common} />}
                  {f.hint && <span className="text-xs text-slate-400">{f.hint}</span>}
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
      <p className="text-xs text-slate-500 flex items-center gap-1 flex-wrap">
        <Clock className="w-3 h-3" /> Follow-ups are sent {hour(b.sendWindowStart)}–{hour(b.sendWindowEnd)}. Change the sending hours in <Link to={settingsPath} className="text-wa-teal font-semibold hover:underline">Settings → Setup</Link>.
      </p>
      <p className="text-xs text-slate-400">Your team can see these details. They are about the business, not about a person.</p>
      {err && <div role="alert" className="p-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{err}</div>}
      <button type="submit" disabled={busy || !dirty} className={btnPrimary}><Save className="w-3.5 h-3.5" /> {busy ? 'Saving…' : 'Save business details'}</button>
    </form>
  );
}
