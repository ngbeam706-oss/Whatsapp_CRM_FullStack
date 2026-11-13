import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { CheckCircle2, AlertCircle, Loader2, ShieldCheck } from 'lucide-react';
import { useBranding } from '../branding';
import { Container, Link } from './SiteUi';
import { INDUSTRIES, TEAM_SIZES, checkAll, emailSuggestion, normalizePhone, type SignupErrors, type SignupForm } from './signupRules';

// The public "Get started" form (/signup). It sends a sign-up REQUEST: the Platform Admin approves it, which creates
// the account and emails an invite (server/signupRequests.cjs). Every field is checked as you leave it and again on
// submit (the server checks the same rules). Consent to the Terms and Privacy Policy is required and recorded;
// marketing consent is separate and optional (DPDP Act, 2023).

const EMPTY: SignupForm = {
  businessName: '', contactName: '', email: '', phone: '', industry: '', city: '', teamSize: '', planInterest: '',
  hasWhatsappApi: '', message: '', acceptTerms: false, acceptMarketing: false,
};
const LABELS: Record<keyof SignupForm, string> = {
  businessName: 'Business name', contactName: 'Your full name', email: 'Work email', phone: 'Mobile number', industry: 'Type of business',
  city: 'City', teamSize: 'Team size', planInterest: 'Plan', hasWhatsappApi: 'WhatsApp Business API', message: 'Anything else', acceptTerms: 'Terms and Privacy Policy', acceptMarketing: 'Updates',
};
const field = 'mt-1 w-full rounded-xl border bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2';
const ok = 'border-slate-300 focus:border-emerald-500 focus:ring-emerald-200';
const bad = 'border-rose-400 focus:border-rose-500 focus:ring-rose-200 bg-rose-50/40';

interface PlanOption { id: string; name: string }

export default function SignupPage() {
  const SITE = useBranding();
  const [form, setForm] = useState<SignupForm>(() => {
    const plan = new URLSearchParams(window.location.search).get('plan') || '';
    return { ...EMPTY, planInterest: /^[a-z0-9_]{2,30}$/.test(plan) ? plan : '' };
  });
  const [touched, setTouched] = useState<Partial<Record<keyof SignupForm, boolean>>>({});
  const [serverErrors, setServerErrors] = useState<SignupErrors>({});
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const [failure, setFailure] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [startedAt] = useState(() => Date.now()); // when the form opened (bots fill it in instantly)
  const website = useRef<HTMLInputElement>(null); // honeypot: people never see or fill it
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let off = false;
    fetch('/api/public/plans').then(r => (r.ok ? r.json() : null)).then((d: { plans?: PlanOption[] } | null) => { if (!off && d?.plans) setPlans(d.plans); }).catch(() => {});
    return () => { off = true; };
  }, []);

  const planIds = plans.map(p => p.id);
  const errors: SignupErrors = { ...checkAll(form, planIds), ...serverErrors };
  const shown = (k: keyof SignupForm) => ((touched[k] || submitted) && errors[k]) || '';
  const set = <K extends keyof SignupForm>(k: K, v: SignupForm[K]) => {
    setForm(f => ({ ...f, [k]: v }));
    if (serverErrors[k]) setServerErrors(s => ({ ...s, [k]: undefined }));
  };
  const blur = (k: keyof SignupForm) => setTouched(t => ({ ...t, [k]: true }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setFailure('');
    const problems = checkAll(form, planIds);
    if (Object.keys(problems).length) {
      // Move to the first problem, and announce the summary.
      const first = (Object.keys(LABELS) as Array<keyof SignupForm>).find(k => problems[k]);
      if (first) document.getElementById(`su-${first}`)?.focus();
      summaryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/public/signup-requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, website: website.current?.value || '', startedAt, policyVersion: SITE.policyVersion }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.success) { setDone(d.message || 'Thank you! We will contact you soon.'); window.scrollTo({ top: 0 }); return; }
      if (d.errors) setServerErrors(d.errors as SignupErrors);
      setFailure(d.error || 'Something went wrong. Please try again in a minute.');
    } catch {
      setFailure('You seem to be offline. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Container className="py-20">
        <div className="max-w-lg mx-auto text-center rounded-3xl border border-emerald-200 bg-emerald-50 p-10" role="status" data-testid="signup-done">
          <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
          <h1 className="mt-4 text-2xl font-extrabold text-slate-900">Request received</h1>
          <p className="mt-2 text-slate-700">{done}</p>
          <p className="mt-4 text-sm text-slate-500">Once your account is ready you&apos;ll get an email to set your password. Meanwhile, see how the <Link to="/features" className="text-emerald-700 font-semibold">features</Link> work.</p>
        </div>
      </Container>
    );
  }

  const visibleProblems = (Object.keys(LABELS) as Array<keyof SignupForm>).filter(k => submitted && errors[k]);
  const suggestion = emailSuggestion(form.email);
  const phoneOk = form.phone.trim() && normalizePhone(form.phone);

  return (
    <section className="bg-gradient-to-b from-emerald-50 to-white">
      <Container className="py-12 grid lg:grid-cols-[1fr_380px] gap-10 items-start">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Get started with {SITE.brandName}</h1>
          <p className="mt-2 text-slate-600">Tell us about your business. We&apos;ll contact you within 1–2 working days, set up your account and help you connect your WhatsApp number. Fields marked <span className="text-rose-600">*</span> are required.</p>

          <form onSubmit={submit} noValidate className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-5" aria-label="Sign-up request" data-testid="signup-form">
            {visibleProblems.length > 0 && (
              <div ref={summaryRef} role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800" data-testid="signup-summary">
                <div className="font-semibold flex items-center gap-1.5"><AlertCircle className="w-4 h-4" /> Please fix {visibleProblems.length === 1 ? 'this' : `these ${visibleProblems.length}`}:</div>
                <ul className="mt-1.5 list-disc pl-5 space-y-0.5">
                  {visibleProblems.map(k => <li key={k}><a href={`#su-${k}`} className="underline" onClick={e => { e.preventDefault(); document.getElementById(`su-${k}`)?.focus(); }}>{LABELS[k]}</a>: {errors[k]}</li>)}
                </ul>
              </div>
            )}

            <div className="grid sm:grid-cols-2 gap-5">
              <Field id="businessName" label={LABELS.businessName} required error={shown('businessName')} hint={`${form.businessName.trim().length}/80`}>
                <input id="su-businessName" value={form.businessName} onChange={e => set('businessName', e.target.value)} onBlur={() => blur('businessName')} maxLength={80} autoComplete="organization" placeholder="e.g. Sunrise Clinic" aria-invalid={!!shown('businessName')} aria-describedby="su-businessName-msg" className={`${field} ${shown('businessName') ? bad : ok}`} />
              </Field>
              <Field id="contactName" label={LABELS.contactName} required error={shown('contactName')}>
                <input id="su-contactName" value={form.contactName} onChange={e => set('contactName', e.target.value)} onBlur={() => blur('contactName')} maxLength={80} autoComplete="name" placeholder="e.g. Priya Sharma" aria-invalid={!!shown('contactName')} aria-describedby="su-contactName-msg" className={`${field} ${shown('contactName') ? bad : ok}`} />
              </Field>
              <Field id="email" label={LABELS.email} required error={shown('email')} hint={!shown('email') && suggestion ? undefined : 'We send your login invite here.'}>
                <input id="su-email" type="email" inputMode="email" value={form.email} onChange={e => set('email', e.target.value)} onBlur={() => { blur('email'); set('email', form.email.trim()); }} maxLength={254} autoComplete="email" placeholder="name@business.com" aria-invalid={!!shown('email')} aria-describedby="su-email-msg" className={`${field} ${shown('email') ? bad : ok}`} />
                {suggestion && !shown('email') && (
                  <p className="mt-1 text-xs text-amber-700">Did you mean <button type="button" onClick={() => set('email', suggestion)} className="font-semibold underline cursor-pointer">{suggestion}</button>?</p>
                )}
              </Field>
              <Field id="phone" label={LABELS.phone} required error={shown('phone')} hint={phoneOk ? `We'll use +${phoneOk}` : 'Indian mobile: 10 digits. Other countries: + and the country code.'}>
                <input id="su-phone" type="tel" inputMode="tel" value={form.phone} onChange={e => set('phone', e.target.value.replace(/[^\d+\s\-().]/g, ''))} onBlur={() => blur('phone')} maxLength={22} autoComplete="tel" placeholder="98765 43210" aria-invalid={!!shown('phone')} aria-describedby="su-phone-msg" className={`${field} ${shown('phone') ? bad : ok}`} />
              </Field>
              <Field id="industry" label={LABELS.industry} required error={shown('industry')}>
                <select id="su-industry" value={form.industry} onChange={e => set('industry', e.target.value)} onBlur={() => blur('industry')} aria-invalid={!!shown('industry')} aria-describedby="su-industry-msg" className={`${field} ${shown('industry') ? bad : ok}`}>
                  <option value="">Choose…</option>
                  {INDUSTRIES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </Field>
              <Field id="city" label={LABELS.city} error={shown('city')}>
                <input id="su-city" value={form.city} onChange={e => set('city', e.target.value)} onBlur={() => blur('city')} maxLength={60} autoComplete="address-level2" placeholder="e.g. Hyderabad" aria-invalid={!!shown('city')} aria-describedby="su-city-msg" className={`${field} ${shown('city') ? bad : ok}`} />
              </Field>
              <Field id="teamSize" label={LABELS.teamSize} error={shown('teamSize')}>
                <select id="su-teamSize" value={form.teamSize} onChange={e => set('teamSize', e.target.value)} className={`${field} ${ok}`}>
                  <option value="">Choose…</option>
                  {TEAM_SIZES.map(s => <option key={s} value={s}>{s} people</option>)}
                </select>
              </Field>
              <Field id="planInterest" label={LABELS.planInterest} error={shown('planInterest')}>
                <select id="su-planInterest" value={form.planInterest} onChange={e => set('planInterest', e.target.value)} className={`${field} ${ok}`}>
                  <option value="">Not sure yet</option>
                  {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              <Field id="hasWhatsappApi" label="Do you already use the WhatsApp Business API?" error="">
                <select id="su-hasWhatsappApi" value={form.hasWhatsappApi} onChange={e => set('hasWhatsappApi', e.target.value)} className={`${field} ${ok}`}>
                  <option value="">Choose…</option>
                  <option value="no">No, we use the WhatsApp app today</option>
                  <option value="yes">Yes, we have a number on the API</option>
                  <option value="not_sure">Not sure</option>
                </select>
              </Field>
            </div>
            <Field id="message" label={LABELS.message} error={shown('message')} hint={`${form.message.trim().length}/1000`}>
              <textarea id="su-message" rows={4} value={form.message} onChange={e => set('message', e.target.value)} onBlur={() => blur('message')} maxLength={1100} placeholder="What would you like to use it for? How many WhatsApp numbers?" aria-invalid={!!shown('message')} aria-describedby="su-message-msg" className={`${field} ${shown('message') ? bad : ok}`} />
            </Field>

            {/* Honeypot for bots: hidden from people and screen readers. */}
            <div aria-hidden="true" className="absolute -left-[9999px] w-px h-px overflow-hidden">
              <label>Website<input ref={website} name="website" type="text" tabIndex={-1} autoComplete="off" /></label>
            </div>

            <div className="space-y-3 rounded-xl bg-slate-50 border border-slate-200 p-4">
              <label className="flex items-start gap-2.5 text-sm text-slate-700 cursor-pointer">
                <input id="su-acceptTerms" type="checkbox" checked={form.acceptTerms} onChange={e => { set('acceptTerms', e.target.checked); blur('acceptTerms'); }} aria-invalid={!!shown('acceptTerms')} aria-describedby="su-acceptTerms-msg" className="mt-0.5 w-4 h-4 accent-emerald-600" />
                <span>I have read and agree to the <Link to="/terms" className="text-emerald-700 font-semibold underline">Terms and Conditions</Link> and the <Link to="/privacy" className="text-emerald-700 font-semibold underline">Privacy Policy</Link>, and I consent to {SITE.brandName} processing the details above to contact me and set up my account. <span className="text-rose-600">*</span></span>
              </label>
              {shown('acceptTerms') && <p id="su-acceptTerms-msg" className="text-xs text-rose-700 ml-7">{shown('acceptTerms')}</p>}
              <label className="flex items-start gap-2.5 text-sm text-slate-700 cursor-pointer">
                <input id="su-acceptMarketing" type="checkbox" checked={form.acceptMarketing} onChange={e => set('acceptMarketing', e.target.checked)} className="mt-0.5 w-4 h-4 accent-emerald-600" />
                <span>Send me product news and offers by email or WhatsApp (optional, you can stop any time).</span>
              </label>
            </div>

            {failure && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{failure}</div>}
            <button type="submit" disabled={busy} className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-semibold px-6 py-3 cursor-pointer">
              {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</> : 'Send request'}
            </button>
            <p className="text-xs text-slate-500">You can withdraw your consent or ask us to delete these details at any time: write to <a href={`mailto:${SITE.privacyEmail}`} className="text-emerald-700">{SITE.privacyEmail}</a>.</p>
          </form>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24">
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <h2 className="font-bold text-slate-900">What happens next</h2>
            <ol className="mt-3 space-y-3 text-sm text-slate-600">
              {['We review your request and call you to understand your needs.', 'We set up your account on the right plan and email you a login invite.', 'Our guide walks you through connecting your WhatsApp number in Meta.'].map((t, i) => (
                <li key={t} className="flex gap-2.5"><span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 font-bold text-xs flex items-center justify-center flex-shrink-0">{i + 1}</span>{t}</li>
              ))}
            </ol>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
            <p className="mt-2">We use these details only to contact you and set up your account. They are deleted if no account is created. <Link to="/privacy" className="text-emerald-700 font-semibold">Privacy Policy</Link></p>
          </div>
          <p className="text-sm text-slate-500 px-1">Already a customer? <a href="/app" className="text-emerald-700 font-semibold">Sign in</a></p>
        </aside>
      </Container>
    </section>
  );
}

function Field({ id, label, required = false, error, hint, children }: { id: keyof SignupForm; label: string; required?: boolean; error: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={`su-${id}`} className="text-sm font-semibold text-slate-800">{label}{required && <span className="text-rose-600"> *</span>}</label>
      {children}
      {error
        ? <p id={`su-${id}-msg`} className="mt-1 text-xs text-rose-700 flex items-start gap-1"><AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-px" />{error}</p>
        : hint ? <p id={`su-${id}-msg`} className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}