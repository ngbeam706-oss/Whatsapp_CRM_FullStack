import { useState } from 'react';
import { Stethoscope, UserPlus, Save, CreditCard, Copy, PlugZap } from 'lucide-react';
import { api, errorMessage, inputCls, inputInlineCls } from './broadcastUtils';
import { useApi, refreshApi, errorOf } from './queryClient';
import { useConfirm } from './confirm';
import { BUTTON, Card, PageHeader, SkeletonRows } from './ui';
import { rupees, type Doctor } from './clinicUtils';
import type { ShowToast } from './types';

/** A copy of the object without one key. */
const withoutKey = <T,>(o: Record<string, T>, k: string): Record<string, T> => Object.fromEntries(Object.entries(o).filter(([x]) => x !== k));

interface RazorpayView { connected: boolean; keyId: string; mode: '' | 'test' | 'live'; webhookSecretSet: boolean; webhookUrl: string; linkExpiryHours: number }

/**
 * Settings -> Clinic (hospitals / clinics; managers and the Business Admin).
 * Doctors: onboarded here (they get an email to set their password and then see only their own queue and hours);
 * the fee and slot length are set here. Razorpay keys: Business Admin only.
 */
export default function ClinicSettingsScreen({ isOwner, showToast }: { isOwner: boolean; showToast: ShowToast }) {
  const status = useApi<{ enabled: boolean }>('/api/clinic/status');
  if (status.data && !status.data.enabled) {
    return <Shell><div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-600">The clinic tools are for hospital and clinic businesses. Ask the platform team if your business type is wrong.</div></Shell>;
  }
  return (
    <Shell>
      <Doctors showToast={showToast} />
      <Razorpay isOwner={isOwner} showToast={showToast} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 overflow-y-auto bg-slate-100" data-testid="clinic-settings">
      <div className="max-w-4xl mx-auto px-4 py-5 space-y-4">
        <PageHeader icon={Stethoscope} title="Clinic" help="Doctors, their consultation fees, and online payments for appointments." />
        {children}
      </div>
    </div>
  );
}

function Doctors({ showToast }: { showToast: ShowToast }) {
  const q = useApi<{ doctors: Doctor[] }>('/api/clinic/doctors');
  const [form, setForm] = useState({ name: '', email: '', specialty: '', fee: '', slotMinutes: '15' });
  const [edit, setEdit] = useState<Record<string, { fee: string; slotMinutes: string }>>({});
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const add = async () => {
    setBusy(true);
    try {
      await api('/api/clinic/doctors', { method: 'POST', body: { ...form, slotMinutes: Number(form.slotMinutes) } });
      setForm({ name: '', email: '', specialty: '', fee: '', slotMinutes: '15' });
      await refreshApi('/api/clinic/doctors');
      showToast('Doctor added: they got an email to set their password');
    } catch (e) { showToast(errorMessage(e)); } finally { setBusy(false); }
  };
  const save = async (d: Doctor, patch: Record<string, unknown>, done: string) => {
    setBusy(true);
    try { await api(`/api/clinic/doctors/${d.id}`, { method: 'PATCH', body: patch }); await refreshApi('/api/clinic/doctors'); setEdit(e0 => withoutKey(e0, d.id)); showToast(done); } catch (e) { showToast(errorMessage(e)); } finally { setBusy(false); }
  };
  const toggle = async (d: Doctor) => {
    if (d.active && !(await confirm({ title: `Turn off ${d.name}?`, body: 'They can\'t sign in and no new appointments can be booked with them. Existing bookings stay.', confirmLabel: 'Turn off', danger: true }))) return;
    await save(d, { active: !d.active }, d.active ? 'Doctor turned off' : 'Doctor turned on');
  };
  return (
    <Card title="Doctors">
      {!q.data ? (errorOf(q) ? <p className="text-xs text-red-700">{errorOf(q)}</p> : <SkeletonRows rows={2} />) : (
        <ul className="divide-y divide-slate-100" aria-label="Doctors">
          {!q.data.doctors.length && <li className="py-2 text-sm text-slate-500">No doctors yet.</li>}
          {q.data.doctors.map(d => {
            const e = edit[d.id];
            return (
              <li key={d.id} className="py-2 flex items-center gap-2 flex-wrap">
                <div className="flex-1 min-w-[12rem]">
                  <div className={`text-sm font-semibold ${d.active ? 'text-slate-800' : 'text-slate-400 line-through'}`}>{d.name}{d.specialty ? <span className="font-normal text-slate-500"> · {d.specialty}</span> : null}</div>
                  <div className="text-xs text-slate-500">{d.email}</div>
                </div>
                {e ? (
                  <>
                    <label className="text-xs text-slate-600 flex items-center gap-1">Fee ₹<input value={e.fee} onChange={ev => setEdit({ ...edit, [d.id]: { ...e, fee: ev.target.value } })} inputMode="decimal" className={`${inputInlineCls} w-24`} aria-label={`Fee for ${d.name}`} /></label>
                    <select value={e.slotMinutes} onChange={ev => setEdit({ ...edit, [d.id]: { ...e, slotMinutes: ev.target.value } })} className={inputInlineCls} aria-label={`Slot length for ${d.name}`}>
                      {[10, 15, 20, 30, 45, 60].map(m => <option key={m} value={m}>{m} min</option>)}
                    </select>
                    <button className={BUTTON.primary} disabled={busy} onClick={() => save(d, { fee: e.fee, slotMinutes: Number(e.slotMinutes) }, 'Saved')}><Save className="w-3.5 h-3.5" /> Save</button>
                    <button className={BUTTON.quiet} onClick={() => setEdit(e0 => withoutKey(e0, d.id))}>Cancel</button>
                  </>
                ) : (
                  <>
                    <span className="text-sm text-slate-700">{d.fee ? rupees(d.fee) : 'Free'} · {d.slotMinutes} min</span>
                    <button className={BUTTON.quiet} onClick={() => setEdit({ ...edit, [d.id]: { fee: String(d.fee), slotMinutes: String(d.slotMinutes) } })}>Edit fee</button>
                    <button className={BUTTON.quiet} disabled={busy} onClick={() => toggle(d)}>{d.active ? 'Turn off' : 'Turn on'}</button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <form className="mt-4 pt-4 border-t border-slate-100 grid sm:grid-cols-2 gap-2" aria-label="Add a doctor" onSubmit={e => { e.preventDefault(); add(); }}>
        <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Doctor's name" maxLength={80} className={inputCls} aria-label="Doctor's name" />
        <input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="Email (they sign in with it)" type="email" className={inputCls} aria-label="Doctor's email" />
        <input value={form.specialty} onChange={e => setForm({ ...form, specialty: e.target.value })} placeholder="Speciality (optional)" maxLength={80} className={inputCls} aria-label="Speciality" />
        <div className="flex gap-2">
          <input value={form.fee} onChange={e => setForm({ ...form, fee: e.target.value })} placeholder="Fee in ₹" inputMode="decimal" className={inputCls} aria-label="Consultation fee" />
          <select value={form.slotMinutes} onChange={e => setForm({ ...form, slotMinutes: e.target.value })} className={inputInlineCls} aria-label="Slot length">
            {[10, 15, 20, 30, 45, 60].map(m => <option key={m} value={m}>{m} min</option>)}
          </select>
        </div>
        <div className="sm:col-span-2 flex items-center gap-2">
          <button type="submit" className={BUTTON.primary} disabled={busy || !form.name || !form.email || form.fee === ''}><UserPlus className="w-3.5 h-3.5" /> Add doctor</button>
          <span className="text-xs text-slate-500">They get an email to set a password, then set their own hours.</span>
        </div>
      </form>
    </Card>
  );
}

function Razorpay({ isOwner, showToast }: { isOwner: boolean; showToast: ShowToast }) {
  const q = useApi<{ razorpay: RazorpayView }>('/api/clinic/settings');
  const [f, setF] = useState({ keyId: '', keySecret: '', webhookSecret: '', linkExpiryHours: '' });
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const r = q.data?.razorpay;
  const save = async (body: Record<string, unknown>, done: string) => {
    setBusy(true);
    try { await api('/api/clinic/razorpay', { method: 'PUT', body }); setF({ keyId: '', keySecret: '', webhookSecret: '', linkExpiryHours: '' }); await refreshApi('/api/clinic/'); showToast(done); } catch (e) { showToast(errorMessage(e)); } finally { setBusy(false); }
  };
  const disconnect = async () => {
    if (!(await confirm({ title: 'Disconnect Razorpay?', body: 'No new payment links can be sent. Links already sent still take payments in Razorpay, but the CRM won\'t hear about them.', confirmLabel: 'Disconnect', danger: true }))) return;
    await save({ disconnect: true }, 'Razorpay disconnected');
  };
  return (
    <Card title={<span className="flex items-center gap-2"><CreditCard className="w-4 h-4" /> Online payments (Razorpay)</span>}>
      {!r ? (errorOf(q) ? <p className="text-xs text-red-700">{errorOf(q)}</p> : <SkeletonRows rows={2} />) : (
        <div className="space-y-3 text-sm">
          <p className="text-slate-600">Patients pay into your own Razorpay account. The CRM only creates the link and hears back when it is paid; it never holds the money or sees card details.</p>
          <div className={`p-2 rounded-lg text-xs ${r.connected ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-50 text-slate-600'}`}>
            {r.connected ? <>Connected · {r.mode === 'live' ? 'Live' : 'Test'} key {r.keyId}{r.webhookSecretSet ? ' · webhook secret set' : ' · webhook secret missing (use "Check payment")'}</> : 'Not connected.'}
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-600 mb-1">Webhook URL (Razorpay Dashboard → Webhooks → Add, event <code>payment_link.paid</code>; also <code>payment_link.expired</code>, <code>payment_link.cancelled</code>)</div>
            <div className="flex gap-2">
              <input readOnly value={r.webhookUrl} className={inputCls} aria-label="Razorpay webhook URL" />
              <button className={BUTTON.secondary} onClick={async () => { try { await navigator.clipboard.writeText(r.webhookUrl); showToast('Copied'); } catch { showToast('Copy it by hand'); } }}><Copy className="w-3.5 h-3.5" /></button>
            </div>
          </div>
          {isOwner ? (
            <form className="grid sm:grid-cols-2 gap-2" aria-label="Razorpay keys" onSubmit={e => { e.preventDefault(); save({ ...f, linkExpiryHours: f.linkExpiryHours ? Number(f.linkExpiryHours) : undefined }, 'Razorpay saved'); }}>
              <input value={f.keyId} onChange={e => setF({ ...f, keyId: e.target.value })} placeholder="Key ID (rzp_live_… / rzp_test_…)" autoComplete="off" className={inputCls} aria-label="Key ID" />
              <input value={f.keySecret} onChange={e => setF({ ...f, keySecret: e.target.value })} placeholder={r.connected ? 'Key Secret (leave empty to keep)' : 'Key Secret'} type="password" autoComplete="new-password" className={inputCls} aria-label="Key Secret" />
              <input value={f.webhookSecret} onChange={e => setF({ ...f, webhookSecret: e.target.value })} placeholder={r.webhookSecretSet ? 'Webhook secret (leave empty to keep)' : 'Webhook secret (you choose it in Razorpay)'} type="password" autoComplete="new-password" className={inputCls} aria-label="Webhook secret" />
              <input value={f.linkExpiryHours} onChange={e => setF({ ...f, linkExpiryHours: e.target.value })} placeholder={`Links stay open ${r.linkExpiryHours} hours`} inputMode="numeric" className={inputCls} aria-label="Link open hours" />
              <div className="sm:col-span-2 flex gap-2 flex-wrap">
                <button type="submit" className={BUTTON.primary} disabled={busy || (!f.keyId && !f.keySecret && !f.webhookSecret && !f.linkExpiryHours)}><Save className="w-3.5 h-3.5" /> {busy ? 'Checking…' : 'Save'}</button>
                {r.connected && <button type="button" className={BUTTON.quiet} disabled={busy} onClick={disconnect}><PlugZap className="w-3.5 h-3.5" /> Disconnect</button>}
                <span className="text-xs text-slate-500 self-center">Keys are checked with Razorpay and stored encrypted. Try test keys first.</span>
              </div>
            </form>
          ) : <p className="text-xs text-slate-500">Only the Business Admin can change the Razorpay keys.</p>}
        </div>
      )}
    </Card>
  );
}
