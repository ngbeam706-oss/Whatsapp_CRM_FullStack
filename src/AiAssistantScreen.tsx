import { useState, type FormEvent } from 'react';
import { useConfirm } from './confirm';
import { Sparkles, Save, Send, AlertTriangle, ShieldCheck, Hand, MessageSquare, KeyRound, PlugZap, Trash2, CheckCircle2 } from 'lucide-react';
import { api, errorMessage, inputCls, btnPrimary, btnSecondary } from './broadcastUtils';
import { LoadError, SkeletonForm } from './ui';
import { useApi, refreshApi, errorOf } from './queryClient';
import AiModeToggle, { type AiProviderStatus, type AiSettingsResponse } from './AiModeToggle';
import type { ShowToast } from './types';

interface AiForm { autoReply: boolean; knowledge: string; instructions: string }
/** POST /api/ai/test: the assistant's decision for a sample question (server/ai.cjs interpret). */
type TestAnswer =
  | { error: string; reply?: undefined; handover?: undefined; reason?: undefined }
  | { error?: undefined; reply?: string; handover?: boolean; reason?: string };

const fromSettings = (d: AiSettingsResponse): AiForm => ({ autoReply: !!d.settings?.auto_reply, knowledge: d.settings?.knowledge || '', instructions: d.settings?.instructions || '' });

const KNOWLEDGE_PLACEHOLDER = `Write the facts customers ask about, in plain sentences. For example:
- Opening hours, holidays and address
- How booking or ordering works, and cut-off times
- Delivery or service areas and charges
- Payment options
- What to bring or how to prepare
- Cancellation and refund policy

The assistant already knows your bot menu and prices. Only write what is true: it will repeat it to customers.`;

export default function AiAssistantScreen({ showToast }: { showToast: ShowToast }) {
  const settings = useApi<AiSettingsResponse>('/api/ai/settings'); // shared with the header's AI switch
  const data = settings.data || null;
  const error = errorOf(settings);
  // Unsaved edits. While null the form shows the saved values; a background refresh never
  // overwrites what someone is typing because typing creates `edits`.
  const [edits, setEdits] = useState<AiForm | null>(null);
  const form = edits ?? (data ? fromSettings(data) : null);
  // Only called from the form, which is shown only once the settings have loaded.
  const setForm = (fn: (f: AiForm) => AiForm) => setEdits(prev => {
    const base = prev ?? (data ? fromSettings(data) : null);
    return base ? fn(base) : prev;
  });
  const [saving, setSaving] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<TestAnswer | null>(null);
  const [asking, setAsking] = useState(false);

  const load = async () => {
    await refreshApi('/api/ai/settings');
    setEdits(null); // show what was saved
  };

  const isOwner = data?.role === 'owner';          // AI provider + key
  const canEdit = isOwner || data?.role === 'manager'; // switch, knowledge, instructions, test
  const configured = data?.status?.configured;
  const dirty = data && form && (form.knowledge !== (data.settings.knowledge || '') || form.instructions !== (data.settings.instructions || ''));

  const save = async (patch: Partial<AiForm>, msg: string) => {
    setSaving(true);
    try {
      await api('/api/ai/settings', { method: 'PUT', body: patch });
      showToast(msg);
      await load();
    } catch (e) {
      showToast(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const ask = async (e: FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;
    setAsking(true);
    setAnswer(null);
    try {
      setAnswer(await api<TestAnswer>('/api/ai/test', { method: 'POST', body: { question } }));
    } catch (err) {
      setAnswer({ error: errorMessage(err) });
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-100">
      <div className="max-w-4xl mx-auto px-4 py-5 space-y-4">
        <div>
          <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Sparkles className="w-5 h-5 text-violet-600" /> AI Assistant</h1>
          <p className="text-xs text-slate-500">When switched on, answers customers' typed messages on WhatsApp using your menu, keyword replies, bot flow messages and the information below, and hands anything tricky to your team.</p>
        </div>

        {error && <LoadError error={error} onRetry={() => settings.refetch()} />}
        {!data && !error && <SkeletonForm fields={4} label="Loading AI settings" />}

        {data && !configured && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 flex gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span><strong>Not connected yet.</strong> {data.status.tableMissing ? 'Run the Phase 6b SQL in Supabase first.' : data.status.keyUnreadable ? 'The saved API key can no longer be read (the server secret changed). Paste it again below.' : 'Choose an AI provider below and save its API key.'} Until then, customers keep getting the normal menu.</span>
          </div>
        )}

        {data && form && (
          <>
            <AiModeToggle key={data.status?.configured ? 'ready' : 'setup'} variant="card" showToast={showToast} />

            <ProviderSection status={data.status} isOwner={isOwner} showToast={showToast} onSaved={() => refreshApi('/api/ai/settings')} />

            <section className="grid md:grid-cols-3 gap-3 text-xs">
              <div className="bg-white border border-slate-200 rounded-xl p-3">
                <div className="font-semibold text-slate-800 flex items-center gap-1.5 mb-1"><MessageSquare className="w-3.5 h-3.5 text-violet-600" /> Answers</div>
                <div className="text-slate-600">Questions about your menu, prices, kits, delivery and ordering, in English, Telugu or Hindi. Short replies, only facts you've given it.</div>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-3">
                <div className="font-semibold text-slate-800 flex items-center gap-1.5 mb-1"><Hand className="w-3.5 h-3.5 text-amber-600" /> Hands over</div>
                <div className="text-slate-600">Complaints, refunds, order problems, bulk orders, medical questions, or anything it doesn't know. It tells the customer the team will reply, pauses the bot, and leaves a note in the chat saying why.</div>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-3">
                <div className="font-semibold text-slate-800 flex items-center gap-1.5 mb-1"><ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> Never</div>
                <div className="text-slate-600">Makes health or cure claims, invents prices or offers, or takes payments and addresses. If it can't answer within a few seconds, the customer gets the normal menu.</div>
              </div>
            </section>

            <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
              <div>
                <div className="text-sm font-semibold text-slate-800">Business information</div>
                <div className="text-xs text-slate-500">What the assistant may tell customers, beyond your menu and prices (it reads those from the bot automatically).</div>
              </div>
              <textarea value={form.knowledge} onChange={e => setForm(f => ({ ...f, knowledge: e.target.value }))} disabled={!canEdit}
                rows={10} maxLength={20000} placeholder={KNOWLEDGE_PLACEHOLDER} className={`${inputCls} text-xs font-mono disabled:bg-slate-50`} />
              <div>
                <div className="text-sm font-semibold text-slate-800">Extra instructions (optional)</div>
                <div className="text-xs text-slate-500">Tone or style, e.g. "Use 'Namaste' as the greeting" or "Always mention our free delivery above ₹500".</div>
              </div>
              <textarea value={form.instructions} onChange={e => setForm(f => ({ ...f, instructions: e.target.value }))} disabled={!canEdit}
                rows={3} maxLength={4000} className={`${inputCls} text-xs disabled:bg-slate-50`} />
              {canEdit ? (
                <div className="flex items-center gap-2">
                  <button onClick={() => save({ knowledge: form.knowledge, instructions: form.instructions }, 'Saved. The assistant uses it from the next message.')} disabled={!dirty || saving} className={btnPrimary}>
                    <Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save'}
                  </button>
                  {dirty && <span className="text-xs text-amber-700">Unsaved changes</span>}
                  {data.settings.updated_by && <span className="text-xs text-slate-400 ml-auto">Last saved by {data.settings.updated_by}</span>}
                </div>
              ) : <div className="text-xs text-slate-500">Only the Business Admin or a manager can change these settings.</div>}
            </section>

            {canEdit && (
              <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                <div>
                  <div className="text-sm font-semibold text-slate-800">Try it</div>
                  <div className="text-xs text-slate-500">Ask what a customer might ask. Nothing is sent to anyone. Uses your saved information (save first).</div>
                </div>
                <form onSubmit={ask} className="flex gap-2">
                  <input value={question} onChange={e => setQuestion(e.target.value)} placeholder="e.g. Do you deliver to Kukatpally? / Sugar Shield lo emi untayi?"
                    className={inputCls} disabled={!configured} />
                  <button type="submit" disabled={asking || !question.trim() || !configured} className={btnSecondary}><Send className="w-3.5 h-3.5" /> {asking ? 'Thinking…' : 'Ask'}</button>
                </form>
                {answer && (
                  answer.error !== undefined ? <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">{answer.error}</div>
                    : answer.handover ? (
                      <div className="text-xs bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-900">
                        <div className="font-semibold flex items-center gap-1.5"><Hand className="w-3.5 h-3.5" /> Would hand over to your team</div>
                        <div className="mt-1">Reason: {answer.reason}</div>
                        <div className="mt-1 text-amber-800">The customer would get your "talk to staff" message, and the bot would pause for this chat.</div>
                      </div>
                    ) : (
                      <div className="bg-wa-chatBg rounded-xl p-3">
                        <div className="max-w-md bubble-out px-3 py-2 text-xs whitespace-pre-wrap ml-auto">{answer.reply}</div>
                      </div>
                    )
                )}
              </section>
            )}

            <p className="text-xs text-slate-500 px-1">
              {configured ? <>Using <strong>{data.status.providerLabel}</strong> · <code>{data.status.model}</code>. </> : null}Usage is billed by your AI provider to the account that owns the API key. Cost per answer depends on the model and how much business information you add.
            </p>
          </>
        )}
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// AI provider: which service, which model, and the API key (owner only)
// ---------------------------------------------------------------------------

const MODEL_HINTS: Record<string, { placeholder: string; where: string }> = {
  anthropic: { placeholder: 'claude-opus-5-5', where: 'console.anthropic.com → API keys' },
  openai: { placeholder: 'model name, as listed in your OpenAI account', where: 'platform.openai.com → API keys' },
  gemini: { placeholder: 'model name, as listed in Google AI Studio', where: 'aistudio.google.com → Get API key' },
  openai_compatible: { placeholder: "model name from your provider's docs", where: "your provider's dashboard" },
};

interface ProviderSectionProps { status: AiProviderStatus; isOwner: boolean; showToast: ShowToast; onSaved: () => Promise<unknown> }

function ProviderSection({ status, isOwner, showToast, onSaved }: ProviderSectionProps) {
  const confirm = useConfirm();
  const [provider, setProvider] = useState(status.provider || 'anthropic');
  const [model, setModel] = useState(status.model || (status.provider === 'anthropic' || !status.provider ? 'claude-opus-5-5' : ''));
  const [baseUrl, setBaseUrl] = useState(status.baseUrl || '');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const sameProvider = provider === status.provider;
  const hasSavedKey = sameProvider && !!status.keyLast4 && !status.keyUnreadable;
  const hint = MODEL_HINTS[provider] || MODEL_HINTS.openai_compatible;
  const body = () => ({ provider, model: model.trim(), baseUrl: baseUrl.trim(), apiKey: apiKey.trim() });

  const pickProvider = (p: string) => {
    setProvider(p);
    setResult(null);
    const def = status.providers?.find(x => x.id === p)?.defaultModel || '';
    setModel(p === status.provider ? status.model : def);
  };

  const run = async (kind: 'test' | 'save' | 'remove') => {
    setBusy(kind);
    setResult(null);
    try {
      if (kind === 'test') {
        const r = await api<{ note?: string; sample?: string }>('/api/ai/provider/test', { method: 'POST', body: body() });
        setResult({ ok: true, text: r.note || `Connected. The model replied: "${r.sample || 'OK'}"` });
      } else if (kind === 'save') {
        await api('/api/ai/provider', { method: 'PUT', body: body() });
        setApiKey('');
        showToast('AI provider saved');
        await onSaved();
      } else if (kind === 'remove') {
        if (!(await confirm({ title: 'Remove the saved API key?', body: 'AI replies and drafts stop until a new key is saved.', confirmLabel: 'Remove key', danger: true }))) return;
        await api('/api/ai/provider', { method: 'PUT', body: { removeKey: true } });
        showToast('API key removed');
        await onSaved();
      }
    } catch (e) {
      setResult({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy('');
    }
  };

  if (!isOwner) {
    return (
      <section className="bg-white border border-slate-200 rounded-xl p-4 text-xs text-slate-600 flex items-center gap-2">
        <PlugZap className="w-4 h-4 text-violet-600" />
        {status.configured ? <>AI provider: <strong>{status.providerLabel}</strong> · <code>{status.model}</code></> : 'No AI provider set up yet. Only the owner can set it up.'}
      </section>
    );
  }

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <PlugZap className="w-4 h-4 text-violet-600" />
        <div className="text-sm font-semibold text-slate-800">AI provider</div>
        {status.configured && <span className="ml-auto text-xs font-semibold text-emerald-700 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Connected: {status.providerLabel}</span>}
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block text-xs font-semibold text-slate-700">Provider
          <select value={provider} onChange={e => pickProvider(e.target.value)} className={`${inputCls} mt-1`}>
            {(status.providers || []).map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <label className="block text-xs font-semibold text-slate-700">Model
          <input value={model} onChange={e => setModel(e.target.value)} placeholder={hint.placeholder} className={`${inputCls} mt-1 font-mono`} />
        </label>
      </div>

      {provider === 'openai_compatible' && (
        <label className="block text-xs font-semibold text-slate-700">API base URL
          <input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" className={`${inputCls} mt-1 font-mono`} />
          <span className="block text-xs font-normal text-slate-500 mt-1">For services with an OpenAI-style API (Groq, OpenRouter, Mistral, DeepSeek, Together, your own server…). The address that ends just before /chat/completions.</span>
        </label>
      )}

      <label className="block text-xs font-semibold text-slate-700">API key
        <div className="relative mt-1">
          <KeyRound className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input type="password" autoComplete="off" spellCheck={false} value={apiKey} onChange={e => setApiKey(e.target.value)}
            placeholder={hasSavedKey ? `Saved key ••••${status.keyLast4}: leave blank to keep it` : 'Paste your API key'}
            className={`${inputCls} pl-8 font-mono`} />
        </div>
        <span className="block text-xs font-normal text-slate-500 mt-1">
          Get it from {hint.where}. It's encrypted before it's stored, only the server can read it, and it's never shown again here.
        </span>
      </label>

      {result && (
        <div className={`text-xs rounded-lg p-2.5 border ${result.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-700'}`}>{result.text}</div>
      )}

      <div className="flex flex-wrap gap-2">
        <button onClick={() => run('test')} disabled={!!busy || !model.trim() || (!apiKey.trim() && !hasSavedKey)} className={btnSecondary}>
          <PlugZap className="w-3.5 h-3.5" /> {busy === 'test' ? 'Testing…' : 'Test connection'}
        </button>
        <button onClick={() => run('save')} disabled={!!busy || !model.trim() || (!apiKey.trim() && !hasSavedKey)} className={btnPrimary}>
          <Save className="w-3.5 h-3.5" /> {busy === 'save' ? 'Saving…' : 'Save'}
        </button>
        {status.keyLast4 && (
          <button onClick={() => run('remove')} disabled={!!busy} className={`${btnSecondary} ml-auto`}>
            <Trash2 className="w-3.5 h-3.5" /> Remove key
          </button>
        )}
      </div>
      {!status.encryptionReady && <div className="text-xs text-red-700">The server has no encryption secret (APP_SECRET), so keys can't be saved.</div>}
    </section>
  );
}
