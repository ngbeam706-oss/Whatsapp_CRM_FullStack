import { useState, type FormEvent } from 'react';
import { useConfirm } from './confirm';
import { Wallet, ExternalLink, RotateCw, AlertTriangle, CreditCard, Pencil, X } from 'lucide-react';
import { api, errorMessage, inputCls, btnPrimary, btnSecondary } from './broadcastUtils';
import { useApi, refreshApi } from './queryClient';
import type { ShowToast } from './types';

// Ads page -> Billing card (server/adBilling.cjs): what Meta says about the ad account's payments. Read-only except
// the account spending limit (Business Admin). The CRM never takes or adds money: the buttons open Meta's billing page.

interface Portfolio { id: string; name: string }
/** Who owns the ad account and the WhatsApp account (server/adBilling.cjs parseOwnership). */
interface Ownership { adAccount: Portfolio | null; personal: boolean; adKnown: boolean; whatsapp: Portfolio | null; same: boolean | null }
interface Billing {
  status: number | null; statusLabel: string; problem: 'payment' | 'disabled' | 'review' | 'closed' | null; problemText: string | null;
  prepaid: boolean | null; due: number | null; spent: number | null; spendCap: number | null; method: string | null; currency: string;
  ownership?: Ownership | null;
}

/**
 * Guidance line under the account bar: which business portfolio owns the ad account, and whether it is the same
 * one as the WhatsApp account. Read with the hourly sync / "Check now" (no extra Meta calls on a visit).
 */
export function AdsOwnership({ onGuide }: { onGuide: () => void }) {
  const q = useApi<BillingResponse>('/api/ads/billing', { staleTime: 60000 });
  const o = q.data?.billing?.ownership;
  if (!q.data) return null;
  const guide = <button onClick={onGuide} className="font-semibold text-wa-teal hover:underline cursor-pointer">How Meta is organised</button>;
  if (!o) {
    return <p className="text-xs text-slate-500 px-1" data-testid="ads-ownership">Who owns this ad account is read with the next sync (or press &quot;Check now&quot; on Billing). · {guide}</p>;
  }
  const adOwner = o.adAccount ? <><strong>{o.adAccount.name}</strong> (business portfolio)</> : o.personal ? <><strong>a personal Facebook account</strong>, not a business portfolio</> : <>unknown (the token can&apos;t read it: it needs business_management)</>;
  const warn = o.same === false;
  return (
    <div className={`rounded-lg border px-3 py-2 text-xs ${warn ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white text-slate-700'}`} data-testid="ads-ownership">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span>Ad account owned by: {adOwner}</span>
        {o.whatsapp && <span>WhatsApp account owned by: <strong>{o.whatsapp.name}</strong></span>}
        {o.same === true && <span className="text-emerald-700 font-semibold">✓ Same business portfolio</span>}
        <span className="ml-auto">{guide}</span>
      </div>
      {warn && (
        <p className="mt-1 flex gap-1.5" data-testid="ads-ownership-warning">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
          <span>
            {o.personal ? 'The ad account belongs to a person' : `The ad account is in "${o.adAccount?.name}"`}, not in your WhatsApp account&apos;s portfolio
            {o.whatsapp ? ` ("${o.whatsapp.name}")` : ''}. Ads still run, but that {o.personal ? 'person' : 'portfolio'} controls the payment method and who can use the account, and
            {o.whatsapp ? ` "${o.whatsapp.name}"` : ' your portfolio'} shows &quot;0 ad accounts&quot; in Meta. To keep everything together, add this ad account to {o.whatsapp ? `"${o.whatsapp.name}"` : 'your portfolio'} (Business settings → Ad accounts → Add) or create a new one there.
          </span>
        </p>
      )}
    </div>
  );
}
interface BillingResponse { billing: Billing | null; checkedAt: string | null; billingUrl: string; canEditLimit: boolean; note?: string }

function money(n: number | null | undefined, currency: string) {
  if (n === null || n === undefined) return '–';
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: currency || 'INR', maximumFractionDigits: n % 1 ? 2 : 0 }).format(n); }
  catch { return `${currency} ${n}`; }
}
const ago = (iso: string | null) => {
  if (!iso) return 'not yet';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

export default function AdsBilling({ showToast }: { showToast?: ShowToast }) {
  const confirm = useConfirm();
  const q = useApi<BillingResponse>('/api/ads/billing', { staleTime: 60000 });
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [cap, setCap] = useState('');
  const d = q.data;
  if (!d) return null;
  const b = d.billing;

  const check = async () => {
    setBusy(true);
    try {
      const r = await api<BillingResponse>('/api/ads/billing/check', { method: 'POST' });
      await refreshApi('/api/ads/billing');
      await refreshApi('/api/ads/issues');
      showToast?.(r.note || 'Billing details updated from Meta');
    } catch (e) { showToast?.(errorMessage(e)); } finally { setBusy(false); }
  };
  const saveCap = async (e: FormEvent, remove = false) => {
    e.preventDefault();
    if (remove && !await confirm('Remove the account spending limit? Ads then spend up to their own budgets with no overall cap.')) return;
    setBusy(true);
    try {
      await api('/api/ads/billing/spend-cap', { method: 'PUT', body: { spendCap: remove ? null : cap.trim() } });
      await refreshApi('/api/ads/billing');
      setEditing(false);
      showToast?.(remove ? 'Spending limit removed' : 'Spending limit saved in Meta');
    } catch (err) { showToast?.(errorMessage(err)); } finally { setBusy(false); }
  };

  const capUsed = b?.spendCap && b.spent !== null ? Math.min(100, Math.round((b.spent / b.spendCap) * 100)) : null;
  return (
    <section className={`bg-white border rounded-xl p-4 text-xs ${b?.problem ? 'border-red-300' : 'border-slate-200'}`} data-testid="ads-billing" aria-label="Ad account billing">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2"><Wallet className="w-4 h-4 text-wa-teal" /> Billing</h2>
        {b && (
          <span className={`px-2 py-0.5 rounded-full border font-semibold ${b.problem ? 'bg-red-50 text-red-800 border-red-200' : 'bg-emerald-50 text-emerald-800 border-emerald-200'}`} data-testid="billing-status">{b.statusLabel}</span>
        )}
        {b && b.prepaid !== null && <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-semibold">{b.prepaid ? 'Prepaid' : 'Automatic payments'}</span>}
        <span className="text-slate-400">Checked {ago(d.checkedAt)}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <button onClick={check} disabled={busy} className={btnSecondary}><RotateCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} /> Check now</button>
          <a href={d.billingUrl} target="_blank" rel="noreferrer" className={btnPrimary} data-testid="billing-meta-link">
            <ExternalLink className="w-3.5 h-3.5" /> {b?.prepaid ? 'Add funds in Meta' : b?.problem === 'payment' ? 'Fix payment in Meta' : 'View bills in Meta'}
          </a>
        </div>
      </div>

      {!b && <p className="mt-2 text-slate-500">Not read from Meta yet. It loads with the next hourly sync, or press &quot;Check now&quot;.</p>}

      {b?.problemText && (
        <div role="alert" className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 flex gap-2" data-testid="billing-problem">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" /><span>{b.problemText}</span>
        </div>
      )}

      {b && (
        <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Fact label={b.prepaid ? 'Owed to Meta' : 'Not yet charged'} value={money(b.due, b.currency)} hint={b.prepaid ? 'Usually 0 on prepaid accounts.' : 'Charged at your billing threshold or monthly date.'} />
          <Fact label={b.spendCap ? 'Spent towards the limit' : 'Total spent'} value={money(b.spent, b.currency)} hint="Without GST." />
          <div>
            <dt className="text-slate-500">Account spending limit</dt>
            <dd className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              {b.spendCap ? money(b.spendCap, b.currency) : 'None'}
              {d.canEditLimit && !editing && <button onClick={() => { setCap(b.spendCap ? String(b.spendCap) : ''); setEditing(true); }} className="text-wa-teal cursor-pointer" aria-label="Change the spending limit"><Pencil className="w-3.5 h-3.5" /></button>}
            </dd>
            {capUsed !== null && <div className="mt-1 h-1.5 rounded bg-slate-100 overflow-hidden" title={`${capUsed}% used`}><div className={`h-full ${capUsed >= 90 ? 'bg-red-500' : 'bg-wa-teal'}`} style={{ width: `${capUsed}%` }} /></div>}
          </div>
          <Fact label="Payment method" value={b.method || (b.prepaid ? 'Prepaid funds' : 'See Meta')} icon />
        </dl>
      )}

      {editing && (
        <form onSubmit={e => saveCap(e)} className="mt-3 p-3 rounded-lg bg-slate-50 border border-slate-200 flex flex-wrap items-end gap-2" aria-label="Account spending limit">
          <label className="flex-1 min-w-[180px] text-slate-700">New limit for the whole ad account ({b?.currency || 'INR'})
            <input value={cap} onChange={e => setCap(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" placeholder="e.g. 50000" className={`${inputCls} mt-1`} data-testid="spend-cap-input" />
          </label>
          <button type="submit" disabled={busy || !cap.trim()} className={btnPrimary}>Save limit</button>
          {b?.spendCap && <button type="button" onClick={e => saveCap(e as unknown as FormEvent, true)} disabled={busy} className={btnSecondary}>Remove limit</button>}
          <button type="button" onClick={() => setEditing(false)} className={btnSecondary} aria-label="Cancel"><X className="w-3.5 h-3.5" /></button>
          <p className="w-full text-xs text-slate-500">When the account reaches this amount, Meta stops every ad on it until you raise the limit. It counts spend from when the limit is set.</p>
        </form>
      )}

      <p className="mt-3 text-xs text-slate-400">Payments happen in Meta, never in this CRM. Meta charges what ads actually spend plus 18% GST: prepaid accounts from funds added first, automatic payments at the billing threshold or monthly date.</p>
    </section>
  );
}

function Fact({ label, value, hint, icon = false }: { label: string; value: string; hint?: string; icon?: boolean }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-sm font-bold text-slate-900 flex items-center gap-1.5 break-words">{icon && <CreditCard className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />}{value}</dd>
      {hint && <dd className="text-xs text-slate-400">{hint}</dd>}
    </div>
  );
}
