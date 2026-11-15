import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { useConfirm } from './confirm';
import { Palette, Save, Upload, Trash2, ExternalLink, AlertTriangle, CheckCircle2, Building2, Mail, Scale, ImageIcon, Globe } from 'lucide-react';
import { api, ApiError, errorMessage, inputCls, btnPrimary, btnSecondary } from './broadcastUtils';
import { LoadError, SkeletonForm } from './ui';
import { reloadBranding, REQUIRED_FOR_LEGAL, type BrandField } from './branding';
import { SITE } from './site/siteConfig';
import type { ShowToast } from './types';

// Platform console -> Branding (/platform/branding): the application's own name, logo, company and contact details
// (server/branding.cjs). Shown on the public website, the Privacy Policy and Terms, the sign-in page and the
// dashboard header. Not any business's details: each business sets its own in Settings -> Setup.

interface AdminBranding {
  branding: Partial<Record<BrandField, string>>; logoUrl: string | null; updatedBy: string | null; updatedAt: string | null;
  /** The Application URL ('' = not set), the address in use, and the default (server/siteUrl.cjs). */
  appUrl?: string; appUrlInUse?: string; appUrlDefault?: string;
}

const GROUPS: Array<{ title: string; icon: typeof Palette; text: string; fields: Array<{ key: BrandField; label: string; placeholder: string; hint?: string; multiline?: boolean; type?: string }> }> = [
  {
    title: 'App', icon: Palette, text: 'The name and line people see on the website, the sign-in page and the dashboard.',
    fields: [
      { key: 'brandName', label: 'App name', placeholder: 'e.g. ChatDesk' },
      { key: 'tagline', label: 'Tagline', placeholder: SITE.tagline, hint: 'One short line under the name and in the home page title.' },
    ],
  },
  {
    title: 'Company (legal)', icon: Building2, text: 'The registered business that runs the app. Used in the Privacy Policy (Data Fiduciary) and the Terms.',
    fields: [
      { key: 'companyName', label: 'Registered company name', placeholder: 'e.g. ChatDesk Technologies Private Limited' },
      { key: 'companyAddress', label: 'Registered office address', placeholder: 'Street, area, city, state, PIN', multiline: true },
      { key: 'cin', label: 'CIN (optional)', placeholder: 'U72900TG2024PTC123456', hint: '21 characters, from your incorporation certificate.' },
      { key: 'gstin', label: 'GSTIN (optional)', placeholder: '36ABCDE1234F1Z5', hint: '15 characters.' },
      { key: 'jurisdictionCity', label: 'City for courts', placeholder: 'e.g. Hyderabad', hint: 'Named in the Terms for disputes.' },
    ],
  },
  {
    title: 'Contact', icon: Mail, text: 'Shown on the Contact page, the footer and the policies.',
    fields: [
      { key: 'supportEmail', label: 'Support email', placeholder: 'support@yourdomain.com', type: 'email' },
      { key: 'salesEmail', label: 'Sales email', placeholder: 'sales@yourdomain.com', type: 'email' },
      { key: 'privacyEmail', label: 'Privacy email', placeholder: 'privacy@yourdomain.com', type: 'email', hint: 'Where people send data requests (access, correction, deletion).' },
      { key: 'phone', label: 'Phone', placeholder: '+91 98765 43210', type: 'tel' },
      { key: 'supportHours', label: 'Support hours', placeholder: SITE.supportHours },
    ],
  },
  {
    title: 'Grievance Officer (DPDP Act, 2023)', icon: Scale, text: 'The person who answers privacy complaints. The DPDP Act requires this contact to be published.',
    fields: [
      { key: 'grievanceOfficerName', label: 'Name', placeholder: 'Full name' },
      { key: 'grievanceOfficerEmail', label: 'Email', placeholder: 'grievance@yourdomain.com', type: 'email' },
    ],
  },
];
const LABELS: Record<BrandField, string> = Object.fromEntries(GROUPS.flatMap(g => g.fields.map(f => [f.key, f.label]))) as Record<BrandField, string>;
const MAX_LOGO = 300 * 1024;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

export default function PlatformBranding({ showToast }: { showToast: ShowToast }) {
  const confirm = useConfirm();
  const [saved, setSaved] = useState<AdminBranding | null>(null);
  const [form, setForm] = useState<Partial<Record<BrandField, string>>>({});
  const [errors, setErrors] = useState<Partial<Record<BrandField, string>>>({});
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState<'' | 'save' | 'logo'>('');
  const fileRef = useRef<HTMLInputElement>(null);

  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    api<AdminBranding>('/api/platform/branding')
      .then(d => { setSaved(d); setForm(d.branding || {}); setLoadError(''); })
      .catch(e => setLoadError(errorMessage(e)));
  }, [attempt]);

  const changed = !!saved && (Object.keys(LABELS) as BrandField[]).some(k => (form[k] || '') !== (saved.branding[k] || ''));
  const missing = REQUIRED_FOR_LEGAL.filter(k => !(form[k] || '').trim());
  const set = (k: BrandField, v: string) => { setForm(f => ({ ...f, [k]: v })); if (errors[k]) setErrors(e => ({ ...e, [k]: undefined })); };

  const done = (d: AdminBranding, message: string) => { setSaved(d); setForm(d.branding || {}); setErrors({}); reloadBranding(); showToast(message); };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('save');
    try {
      // Send every field ('' clears one).
      const body = Object.fromEntries((Object.keys(LABELS) as BrandField[]).map(k => [k, form[k] || '']));
      done(await api<AdminBranding>('/api/platform/branding', { method: 'PUT', body }), 'Branding saved. The website shows it within about 2 minutes.');
    } catch (err) {
      if (err instanceof ApiError && err.data?.errors && typeof err.data.errors === 'object') {
        setErrors(err.data.errors as Partial<Record<BrandField, string>>);
        const first = Object.keys(err.data.errors)[0];
        document.getElementById(`brand-${first}`)?.focus();
      }
      showToast(errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  const pickLogo = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { showToast('Choose a PNG, JPG or WebP image (SVG is not accepted).'); return; }
    if (file.size > MAX_LOGO) { showToast(`The logo is ${Math.ceil(file.size / 1024)} KB. Use one of at most 300 KB.`); return; }
    setBusy('logo');
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error('Could not read the file.'));
        r.readAsDataURL(file);
      });
      done(await api<AdminBranding>('/api/platform/branding/logo', { method: 'POST', body: { dataUrl } }), 'Logo saved');
    } catch (err) {
      showToast(errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  const removeLogo = async () => {
    if (!await confirm('Remove the logo? The website and dashboard show the default icon instead.')) return;
    setBusy('logo');
    try {
      done(await api<AdminBranding>('/api/platform/branding/logo', { method: 'DELETE' }), 'Logo removed');
    } catch (err) {
      showToast(errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  if (loadError) return <LoadError error={loadError} onRetry={() => setAttempt(n => n + 1)} />;
  if (!saved) return <SkeletonForm fields={6} label="Loading branding" />;

  return (
    <section className="space-y-4" data-testid="platform-branding">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-[240px]">
          <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2"><Palette className="w-4 h-4 text-emerald-600" /> Branding</h2>
          <p className="text-xs text-slate-500 mt-1">The application&apos;s own name, logo, company and contact details: shown on the public website, the Privacy Policy and Terms, the sign-in page and the dashboard. Each business&apos;s own details are set by that business (Settings → Setup).</p>
        </div>
        <a href="/" target="_blank" rel="noreferrer" className={btnSecondary}><ExternalLink className="w-3.5 h-3.5" /> Open the website</a>
      </div>

      {missing.length > 0 ? (
        <div role="note" className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 flex gap-2" data-testid="branding-missing">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>The Privacy Policy and Terms show a <strong>Draft</strong> note until these are filled in: {missing.map(k => LABELS[k]).join(', ')}.</span>
        </div>
      ) : (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-900 flex gap-2">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          <span>Everything the policies need is filled in. Have a lawyer review the Privacy Policy and Terms before relying on them.</span>
        </div>
      )}

      {/* Logo: saved on its own (no need to press Save). */}
      <Card icon={ImageIcon} title="Logo" text="Square works best (at least 128 × 128 pixels). PNG, JPG or WebP, at most 300 KB.">
        <div className="flex flex-wrap items-center gap-4">
          <div className="w-20 h-20 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden">
            {saved.logoUrl ? <img src={saved.logoUrl} alt="Current logo" className="w-full h-full object-contain" data-testid="branding-logo-preview" /> : <span className="text-xs text-slate-400 text-center px-2">No logo yet</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={pickLogo} aria-label="Logo file" data-testid="branding-logo-input" />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy !== ''} className={btnPrimary}><Upload className="w-3.5 h-3.5" /> {saved.logoUrl ? 'Replace logo' : 'Upload logo'}</button>
            {saved.logoUrl && <button type="button" onClick={removeLogo} disabled={busy !== ''} className={btnSecondary}><Trash2 className="w-3.5 h-3.5" /> Remove</button>}
          </div>
        </div>
      </Card>

      <AppUrlCard saved={saved} onSaved={d => { setSaved(d); showToast('Application URL saved. Every business now sees its new webhook URL on Settings → WhatsApp.'); }} showToast={showToast} />

      <form onSubmit={save} noValidate className="space-y-4" aria-label="Branding details">
        {GROUPS.map(g => (
          <Card key={g.title} icon={g.icon} title={g.title} text={g.text}>
            <div className="grid sm:grid-cols-2 gap-3">
              {g.fields.map(f => {
                const err = errors[f.key];
                const required = REQUIRED_FOR_LEGAL.includes(f.key);
                const common = {
                  id: `brand-${f.key}`, value: form[f.key] || '', placeholder: f.placeholder,
                  'aria-invalid': !!err, 'aria-describedby': `brand-${f.key}-msg`,
                  className: `${inputCls} mt-1 ${err ? 'border-red-400 bg-red-50/40' : ''}`,
                };
                return (
                  <div key={f.key} className={f.multiline ? 'sm:col-span-2' : ''}>
                    <label htmlFor={`brand-${f.key}`} className="text-xs font-semibold text-slate-700">{f.label}{required && <span className="text-red-600"> *</span>}</label>
                    {f.multiline
                      ? <textarea rows={3} {...common} onChange={e => set(f.key, e.target.value)} />
                      : <input type={f.type || 'text'} {...common} onChange={e => set(f.key, e.target.value)} />}
                    <p id={`brand-${f.key}-msg`} className={`mt-1 text-xs ${err ? 'text-red-700' : 'text-slate-500'}`}>{err || f.hint || ''}</p>
                  </div>
                );
              })}
            </div>
          </Card>
        ))}
        <div className="sticky bottom-0 bg-slate-100/95 py-3 flex flex-wrap items-center gap-3 border-t border-slate-200">
          <button type="submit" disabled={busy !== '' || !changed} className={btnPrimary}><Save className="w-3.5 h-3.5" /> {busy === 'save' ? 'Saving…' : 'Save branding'}</button>
          {changed && <button type="button" onClick={() => { setForm(saved.branding || {}); setErrors({}); }} className={btnSecondary}>Undo changes</button>}
          <span className="text-xs text-slate-500">{required()} required for the policies.{saved.updatedAt ? ` Last changed by ${saved.updatedBy} on ${when(saved.updatedAt)}.` : ''}</span>
        </div>
      </form>
    </section>
  );
}

const required = () => <><span className="text-red-600">*</span></>;

/**
 * The Application URL (server/siteUrl.cjs): every business's WhatsApp webhook URL, customers' call links and the
 * invite / password email links start with it. Saved on its own, after an "Are you sure?" (each business must then
 * update Meta); the server only saves it when the app answers there.
 */
function AppUrlCard({ saved, onSaved, showToast }: { saved: AdminBranding; onSaved: (d: AdminBranding) => void; showToast: ShowToast }) {
  const confirm = useConfirm();
  const [value, setValue] = useState(saved.appUrl || '');
  const [busy, setBusy] = useState(false);
  const inUse = saved.appUrlInUse || saved.appUrlDefault || '';
  const next = value.trim().replace(/\/+$/, '');
  const changed = next !== (saved.appUrl || '');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const target = next || saved.appUrlDefault || '';
    const ok = await confirm({
      title: 'Change the Application URL?',
      body: `Every business's WhatsApp webhook URL will start with ${target}. Each Business Admin must paste the new URL into their Meta app (WhatsApp → Configuration), and the address must be added in Supabase (Authentication → URL Configuration) for sign-in emails. Messages keep arriving at the old address until they do.`,
      confirmLabel: 'Change it', danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      onSaved(await api<AdminBranding>('/api/platform/branding/app-url', { method: 'PUT', body: { appUrl: next } }));
    } catch (err) {
      showToast(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card icon={Globe} title="Application URL" text="The web address of this app. Each business's WhatsApp webhook URL, customers' call links and the links in invite / password emails are built from it.">
      <form onSubmit={submit} className="space-y-2" aria-label="Application URL" data-testid="branding-app-url">
        <p className="text-xs text-slate-600">In use now: <strong className="font-mono">{inUse}</strong>{!saved.appUrl && ' (the default)'}</p>
        <div className="flex flex-wrap gap-2">
          <input value={value} onChange={e => setValue(e.target.value)} placeholder={saved.appUrlDefault || 'https://crm.example.com'} className={`${inputCls} flex-1 min-w-[240px] font-mono`} aria-label="Application URL" />
          <button type="submit" disabled={busy || !changed} className={btnPrimary}><Save className="w-3.5 h-3.5" /> {busy ? 'Checking…' : 'Save'}</button>
        </div>
        <p className="text-xs text-slate-500">
          Only https, no path (e.g. <span className="font-mono">https://crm.yourcompany.com</span>). Leave empty to use the default. For your own domain, first add it to the Netlify site (Domain settings);
          it is saved only when this app answers at that address.
        </p>
        <p className="text-xs text-amber-800 flex gap-1.5"><AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px" /> Changing it changes every business&apos;s webhook URL: they must update it in Meta.</p>
      </form>
    </Card>
  );
}

function Card({ icon: Icon, title, text, children }: { icon: typeof Palette; title: string; text: string; children: ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2"><Icon className="w-4 h-4 text-slate-500" /> {title}</h3>
      <p className="text-xs text-slate-500 mt-0.5 mb-3">{text}</p>
      {children}
    </div>
  );
}
