import { useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import {
  Smartphone, CheckCircle2, AlertTriangle, Save, PlugZap, Copy, KeyRound, ShieldCheck, ExternalLink, Pencil, X, Circle, Lock,
} from 'lucide-react';
import { api, errorMessage, inputCls, btnPrimary, btnSecondary } from './broadcastUtils';
import { useApi, refreshApi, errorOf } from './queryClient';
import type { Role, ShowToast } from './types';
import MetaSetupGuide from './MetaSetupGuide';
import { WHATSAPP_GUIDE } from './metaGuides';
import WhatsAppNumbers from './WhatsAppNumbers';
import { PageHeader, BUTTON, LoadError, SkeletonForm } from './ui';
import { Radio, Database } from 'lucide-react';

/** GET /api/whatsapp (server/whatsapp.cjs connectionStatus; owner-only fields are absent for others). */
interface Connection {
  connected: boolean; source: 'saved' | 'env' | 'none'; phoneNumber?: string; role: Role;
  phoneNumberId?: string; wabaId?: string; tokenLast4?: string | null; tokenUnreadable?: boolean; hasAppSecret?: boolean;
  updatedBy?: string | null; connectedAt?: string | null; webhookUrl?: string; verifyToken?: string;
}
interface ConnectionForm { phoneNumberId: string; wabaId: string; accessToken: string; appSecret: string }
type TestResult = { error: string } | { error?: undefined; verifiedName?: string; displayPhoneNumber?: string; qualityRating?: string; messagingLimit?: string };

// Saved IDs (the token and app secret are never sent back, so those fields start empty).
const fromConnection = (d: Connection | null): ConnectionForm => ({ phoneNumberId: d?.phoneNumberId || '', wabaId: d?.wabaId || '', accessToken: '', appSecret: '' });
const plus = (digits?: string) => (digits ? `+${digits.replace(/\D/g, '')}` : '');
const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

/**
 * The business's WhatsApp connection, as a flow:
 *   not connected: Step 1 webhook in Meta -> Step 2 Meta details -> Step 3 test
 *   connected:     the connected number and every saved detail (read-only), Test, "Change details" on demand,
 *                  then the extra numbers.
 */
/** onShowWebhook / onShowData: the header's old "Webhook" and "Supabase" pop-ups, now opened from here (U1). */
export default function WhatsAppScreen({ showToast, onShowWebhook, onShowData }: { showToast: ShowToast; onShowWebhook?: () => void; onShowData?: () => void }) {
  const connection = useApi<Connection>('/api/whatsapp');
  const data = connection.data || null;
  const error = errorOf(connection);
  // The form opens on demand once connected; a background refresh never overwrites what someone is typing.
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<ConnectionForm | null>(null);
  const form = edits ?? fromConnection(data);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [note, setNote] = useState('');

  const isOwner = data?.role === 'owner';
  const connected = !!data?.connected;
  const showForm = isOwner && (!connected || editing);

  const set = (k: keyof ConnectionForm) => (e: ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value.trim();
    setEdits(prev => ({ ...(prev ?? fromConnection(data)), [k]: v }));
  };
  const closeForm = () => { setEditing(false); setEdits(null); };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setNote('');
    try {
      const r = await api<{ verifiedName?: string; subscribeNote?: string }>('/api/whatsapp', { method: 'PUT', body: form });
      showToast(`Connected${r.verifiedName ? `: ${r.verifiedName}` : ''}. Send a test message to your number to check the webhook.`);
      setNote(r.subscribeNote || '');
      await refreshApi('/api/whatsapp');
      closeForm();
      setTest(null);
    } catch (err) {
      showToast(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      setTest(await api<TestResult>('/api/whatsapp/test', { method: 'POST' }));
    } catch (err) {
      setTest({ error: errorMessage(err) });
    } finally {
      setTesting(false);
    }
  };

  const copy = (text: string, what: string) => {
    navigator.clipboard?.writeText(text).then(() => showToast(`${what} copied`)).catch(() => showToast('Copy failed: select and copy it by hand'));
  };

  const testOk = !!test && test.error === undefined;
  const webhookReady = !!data && data.source !== 'env' && !!data.webhookUrl && !!data.verifyToken;

  return (
    <div className="flex-1 overflow-y-auto bg-slate-100">
      <div className="max-w-3xl mx-auto px-4 py-5 space-y-4">
        <PageHeader icon={Smartphone} title="WhatsApp number"
          help="The WhatsApp Business number your customers message. Broadcasts and follow-ups go out from it; you can add more numbers below (e.g. Pharmacy, Lab)."
          actions={(onShowWebhook || onShowData) && (
            <>
              {onShowWebhook && <button onClick={onShowWebhook} className={BUTTON.secondary}><Radio className="w-4 h-4" aria-hidden="true" /> Webhook details</button>}
              {onShowData && <button onClick={onShowData} className={BUTTON.secondary}><Database className="w-4 h-4" aria-hidden="true" /> Data and sync</button>}
            </>
          )} />

        {error && <LoadError error={error} onRetry={() => connection.refetch()} />}
        {!data && !error && <SkeletonForm fields={4} label="Loading the WhatsApp connection" />}

        {/* Where the setup stands: three steps, each ticked when done. */}
        {data && isOwner && (
          <ol className="grid grid-cols-3 gap-2 text-xs" data-testid="wa-steps" aria-label="Setup steps">
            <StepPill n={1} label="Webhook in Meta" done={connected} active={!connected} />
            <StepPill n={2} label="Your Meta details" done={connected} active={!connected} />
            <StepPill n={3} label="Test the connection" done={testOk} active={connected && !testOk} />
          </ol>
        )}

        {/* ---------- Connected: everything that is saved, read-only ---------- */}
        {data && connected && (
          <section className="bg-white border border-emerald-200 rounded-xl overflow-hidden" data-testid="wa-connected">
            <div className="flex flex-wrap items-center gap-3 px-4 py-3 bg-emerald-50 border-b border-emerald-200">
              <CheckCircle2 className="w-6 h-6 text-emerald-600 flex-shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Connected number</div>
                <div className="text-lg font-bold text-slate-800 font-mono" data-testid="wa-number">{plus(data.phoneNumber) || 'Connected'}</div>
              </div>
              <span className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded-full border ${data.source === 'env' ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-white border-emerald-200 text-emerald-800'}`}>
                {data.source === 'env' ? 'From the server settings' : 'Saved on this page'}
              </span>
            </div>

            {isOwner ? (
              <dl className="divide-y divide-slate-100 text-xs" data-testid="wa-details">
                <Detail label="Phone number">{plus(data.phoneNumber) || '–'}</Detail>
                <Detail label="Phone number ID" copyValue={data.phoneNumberId} onCopy={copy}><span className="font-mono">{data.phoneNumberId || '–'}</span></Detail>
                <Detail label="WhatsApp Business Account ID" copyValue={data.wabaId} onCopy={copy}><span className="font-mono">{data.wabaId || '–'}</span></Detail>
                <Detail label="Access token">
                  {data.tokenUnreadable
                    ? <span className="text-red-700 font-semibold">Saved, but can&apos;t be read any more (the server secret changed). Paste it again under &quot;Change details&quot;.</span>
                    : data.source === 'env'
                      ? <span className="text-slate-600">Set in the server settings</span>
                      : <span><span className="font-mono">••••••••{data.tokenLast4 || ''}</span> <SecretNote /></span>}
                </Detail>
                <Detail label="App secret">
                  {data.hasAppSecret
                    ? <span className="text-emerald-700 font-semibold">Saved ✓ <SecretNote /></span>
                    : <span className="text-amber-700 font-semibold">Missing: incoming messages can&apos;t be checked. Add it under &quot;Change details&quot;.</span>}
                </Detail>
                {data.webhookUrl && <Detail label="Callback URL (in Meta)" copyValue={data.webhookUrl} onCopy={copy}><span className="font-mono break-all">{data.webhookUrl}</span></Detail>}
                {data.verifyToken && <Detail label="Verify token (in Meta)" copyValue={data.verifyToken} onCopy={copy}><span className="font-mono break-all">{data.verifyToken}</span></Detail>}
                {(data.connectedAt || data.updatedBy) && (
                  <Detail label="Last saved">{[fmtDate(data.connectedAt), data.updatedBy ? `by ${data.updatedBy}` : ''].filter(Boolean).join(' ')}</Detail>
                )}
              </dl>
            ) : (
              <div className="px-4 py-3 text-xs text-slate-600 flex items-center gap-2">
                <Lock className="w-3.5 h-3.5 text-slate-400" /> Only the Business Admin sees the Meta IDs and changes the connection.
              </div>
            )}

            {isOwner && (
              <div className="px-4 py-3 border-t border-slate-100 bg-slate-50 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={runTest} disabled={testing} className={btnPrimary}><PlugZap className="w-3.5 h-3.5" /> {testing ? 'Testing…' : 'Test connection'}</button>
                  {!editing && (
                    <button type="button" onClick={() => { setEditing(true); setEdits(null); }} className={btnSecondary}>
                      <Pencil className="w-3.5 h-3.5" /> {data.source === 'env' ? 'Save your own details' : 'Change details'}
                    </button>
                  )}
                  <span className="text-xs text-slate-500">Test asks Meta for the number&apos;s name, quality rating and daily limit.</span>
                </div>
                {test && (test.error !== undefined
                  ? <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{test.error}</div>
                  : <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-900" data-testid="wa-test-ok">
                      Working: <strong>{test.verifiedName}</strong> ({test.displayPhoneNumber}) · quality {test.qualityRating || 'n/a'} · limit {test.messagingLimit || 'n/a'}
                    </div>)}
                {note && <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">{note}</div>}
              </div>
            )}
          </section>
        )}

        {/* ---------- Not connected ---------- */}
        {data && !connected && !isOwner && (
          <section className="border rounded-xl p-4 flex items-start gap-3 bg-amber-50 border-amber-200">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
            <div className="text-sm">
              <div className="font-semibold text-slate-800">No WhatsApp number connected yet</div>
              <div className="text-xs text-slate-600 mt-0.5">Ask your Business Admin to connect the number. Until then, nothing can be sent.</div>
            </div>
          </section>
        )}

        {/* Step 1 (not connected): the webhook, shown BEFORE the details are saved. Meta checks the callback URL
            when it is pasted in, which works even though the number isn't connected yet. */}
        {isOwner && !connected && webhookReady && (
          <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3" data-testid="wa-step1">
            <StepTitle n={1} icon={<ShieldCheck className="w-4 h-4 text-emerald-600" />}>Set up the webhook in Meta</StepTitle>
            <ol className="text-xs text-slate-600 list-decimal pl-4 space-y-1">
              <li>Open <strong>Meta for Developers → your app → WhatsApp → Configuration</strong>, and click <strong>Edit</strong> under Webhook.</li>
              <li>Paste the <strong>Callback URL</strong> and <strong>Verify token</strong> below, then click <strong>Verify and save</strong>. Meta checks them straight away.</li>
              <li>Under Webhook fields, click <strong>Manage</strong> and subscribe to <strong>messages</strong> (and <strong>calls</strong> for WhatsApp calls).</li>
            </ol>
            <CopyRow label="Callback URL" value={data?.webhookUrl} onCopy={() => copy(data?.webhookUrl || '', 'Callback URL')} />
            <CopyRow label="Verify token" value={data?.verifyToken} onCopy={() => copy(data?.verifyToken || '', 'Verify token')} />
            <a href="https://developers.facebook.com/apps/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-wa-teal hover:underline">
              Open Meta for Developers <ExternalLink className="w-3 h-3" />
            </a>
          </section>
        )}

        {/* Step 2 (not connected) or "Change details" (connected). */}
        {showForm && (
          <form onSubmit={save} className="bg-white border border-slate-200 rounded-xl p-4 space-y-3" data-testid="wa-form">
            <div className="flex items-center gap-2">
              {connected
                ? <div className="text-sm font-semibold text-slate-800 flex items-center gap-2"><KeyRound className="w-4 h-4 text-violet-600" /> {data?.source === 'env' ? 'Save your own Meta details' : 'Change the Meta details'}</div>
                : <StepTitle n={2} icon={<KeyRound className="w-4 h-4 text-violet-600" />}>Your Meta details</StepTitle>}
              {connected && <button type="button" onClick={closeForm} className="ml-auto p-1 text-slate-400 hover:text-slate-700 cursor-pointer" title="Close without saving"><X className="w-4 h-4" /></button>}
            </div>
            <div className="text-xs text-slate-500">
              Find these in <strong>Meta for Developers → your app → WhatsApp → API Setup</strong>, and the App secret in <strong>App settings → Basic</strong>.
              They are checked with Meta and stored encrypted. The access token and App secret are never shown again
              {connected && data?.source === 'saved' ? ': leave them empty to keep the saved ones.' : '.'}
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="text-xs font-medium text-slate-700">Phone number ID
                <input value={form.phoneNumberId} onChange={set('phoneNumberId')} inputMode="numeric" placeholder="e.g. 123456789012345" className={`${inputCls} mt-1 font-mono`} required />
              </label>
              <label className="text-xs font-medium text-slate-700">WhatsApp Business Account ID
                <input value={form.wabaId} onChange={set('wabaId')} inputMode="numeric" placeholder="e.g. 100098765432109" className={`${inputCls} mt-1 font-mono`} required />
              </label>
              <label className="text-xs font-medium text-slate-700 sm:col-span-2">Access token
                <input type="password" value={form.accessToken} onChange={set('accessToken')} autoComplete="off"
                  placeholder={data?.tokenLast4 && data.source === 'saved' ? `Saved (••••${data.tokenLast4}). Leave empty to keep it.` : 'A permanent System User token is best'} className={`${inputCls} mt-1 font-mono`} />
              </label>
              <label className="text-xs font-medium text-slate-700 sm:col-span-2">App secret
                <input type="password" value={form.appSecret} onChange={set('appSecret')} autoComplete="off"
                  placeholder={data?.hasAppSecret && data?.source === 'saved' ? 'Saved. Leave empty to keep it.' : '32 letters and numbers'} className={`${inputCls} mt-1 font-mono`} />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="submit" disabled={saving} className={btnPrimary}><Save className="w-3.5 h-3.5" /> {saving ? 'Checking with Meta…' : 'Save and check'}</button>
              {connected && <button type="button" onClick={closeForm} className={btnSecondary}>Cancel</button>}
            </div>
            {!connected && (
              <div className="flex items-start gap-2 pt-2 border-t border-slate-100 text-xs text-slate-600">
                <StepBadge n={3} />
                <span><strong>Then test:</strong> after saving, send &quot;hi&quot; to your number from another phone. It should appear in the Inbox within a few seconds.</span>
              </div>
            )}
          </form>
        )}

        {isOwner && data?.source === 'env' && editing && (
          <div className="p-3 bg-white border border-slate-200 rounded-xl text-xs text-slate-600">
            After you save your own details, this page shows a new webhook address for your business. Paste it into Meta, then
            your number is fully managed here. Until then the old address keeps working.
          </div>
        )}

        {/* Several numbers: the main one plus extras (Business Admin manages them; managers see them). */}
        {connected && <WhatsAppNumbers isOwner={isOwner} showToast={showToast} />}

        {/* How to get each value from Meta (open until a number is connected). */}
        {data && <MetaSetupGuide guide={WHATSAPP_GUIDE} defaultOpen={!connected} />}
      </div>
    </div>
  );
}

function StepPill({ n, label, done, active }: { n: number; label: string; done: boolean; active: boolean }) {
  return (
    <li className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 ${done ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : active ? 'bg-white border-wa-teal text-slate-800' : 'bg-white border-slate-200 text-slate-500'}`}
      aria-current={active ? 'step' : undefined}>
      {done ? <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" /> : <Circle className="w-4 h-4 flex-shrink-0" />}
      <span className="font-semibold">{n}.</span> <span className="truncate">{label}</span>
    </li>
  );
}

function StepBadge({ n }: { n: number }) {
  return <span className="w-5 h-5 rounded-full bg-wa-teal text-white text-xs font-bold flex items-center justify-center flex-shrink-0">{n}</span>;
}

function StepTitle({ n, icon, children }: { n: number; icon: ReactNode; children: ReactNode }) {
  return <div className="text-sm font-semibold text-slate-800 flex items-center gap-2"><StepBadge n={n} /> {icon} Step {n}: {children}</div>;
}

function SecretNote() {
  return <span className="text-xs font-normal text-slate-400">(encrypted; never shown in full)</span>;
}

/** One saved detail: label, value, optional copy button. */
function Detail({ label, children, copyValue, onCopy }: { label: string; children: ReactNode; copyValue?: string; onCopy?: (text: string, what: string) => void }) {
  return (
    <div className="grid sm:grid-cols-[210px_1fr_auto] items-center gap-x-3 gap-y-0.5 px-4 py-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-800 min-w-0">{children}</dd>
      {copyValue && onCopy
        ? <button type="button" onClick={() => onCopy(copyValue, label)} className="justify-self-start sm:justify-self-end p-1 text-slate-400 hover:text-slate-700 cursor-pointer" title={`Copy ${label}`}><Copy className="w-3.5 h-3.5" /></button>
        : <span />}
    </div>
  );
}

function CopyRow({ label, value, onCopy }: { label: string; value?: string; onCopy: () => void }) {
  return (
    <div>
      <div className="text-xs font-medium text-slate-600 mb-1">{label}</div>
      <div className="flex gap-2">
        <input readOnly value={value || ''} className={`${inputCls} font-mono text-xs bg-slate-50`} onFocus={e => e.target.select()} />
        <button type="button" onClick={onCopy} className={btnSecondary} title={`Copy ${label}`}><Copy className="w-3.5 h-3.5" /></button>
      </div>
    </div>
  );
}
