import { useEffect, useMemo, useState } from 'react';
import { useConfirm } from './confirm';
import { Plus, RotateCw, ArrowLeft, Trash2, Pencil, X, Clock, Check, CheckCheck, Eye, Reply, Ban, Copy, Zap, AlertTriangle } from 'lucide-react';
import { api, errorMessage, templateNeeds, fmtDate, inputCls, inputInlineCls, btnPrimary, btnSecondary } from './broadcastUtils';
import { LoadError, SkeletonRows } from './ui';
import { Badge, Field, TemplatePreview, VariableInput } from './BroadcastUi';
import { useApi, refreshApi, errorOf } from './queryClient';
import type { ShowToast, Template, VariableSpec } from './types';

// ---- Shapes (server/automations.cjs) ----
type Trigger = 'item_viewed' | 'order_enquiry' | 'kit_order' | 'new_contact' | 'inactive';
type Unit = 'minutes' | 'hours' | 'days';
interface RunStatsRow {
  scheduled?: number; sent?: number; delivered?: number; read?: number; replied?: number; cancelled?: number; failed?: number;
}
interface Variables { header: VariableSpec[]; body: VariableSpec[]; headerMediaUrl: string }
interface Automation {
  id: string; name: string; trigger: Trigger | string; delay_minutes: number; is_active: boolean;
  stop_if_replied: boolean; stop_if_ordered: boolean; template_name: string; template_language: string;
  variables?: Partial<Variables> | null; stats?: RunStatsRow | null;
}
interface AutomationRun {
  id: number; phone: string; name: string | null; data?: { item?: string } | null; status: string; reason: string | null;
  due_at: string; sent_at: string | null; read_at: string | null; replied_at: string | null; created_at: string;
}
interface FormState { name: string; trigger: string; delay: number | string; unit: Unit; stopIfReplied: boolean; stopIfOrdered: boolean }
interface Preset { key: string; emoji: string; title: string; blurb: string; form: Partial<FormState> & { trigger: Trigger }; wording: string }
type View =
  | { mode: 'list' }
  | { mode: 'pick' }
  | { mode: 'form'; preset?: Preset | null; existing?: Automation }
  | { mode: 'detail'; id: string };

const NONE: Automation[] = [];

// ---------------------------------------------------------------------------
// Triggers and ready-made presets
// ---------------------------------------------------------------------------

const TRIGGERS: Record<Trigger, { label: string; short: string }> = {
  item_viewed: { label: 'after they look at a service or product but don\'t book or order', short: 'Looked, no booking' },
  order_enquiry: { label: 'after they send a booking or order enquiry', short: 'Booking / order enquiry' },
  kit_order: { label: 'after they order a 28-day diet kit', short: 'Diet kit order' },
  new_contact: { label: 'after they message you for the first time', short: 'First message' },
  inactive: { label: 'when they\'ve been quiet for', short: 'Quiet customer' },
};
const ITEM_TRIGGERS: string[] = ['item_viewed', 'order_enquiry', 'kit_order'];

const PRESETS: Preset[] = [
  {
    key: 'reorder', emoji: '🔁', title: 'Diet kit reorder reminder',
    blurb: 'Day 21 of a 28-day kit: remind them to reorder before it runs out.',
    form: { name: 'Diet kit reorder reminder', trigger: 'kit_order', delay: 21, unit: 'days', stopIfReplied: false, stopIfOrdered: true },
    wording: 'Hi {{1}}! 🌿 You\'re 3 weeks into your {{2}}. Reorder now so your next kit arrives before this one runs out. Reply ORDER and we\'ll set it up.',
  },
  {
    key: 'abandoned', emoji: '🛒', title: 'Didn\'t finish ordering',
    blurb: 'They looked at a service or product but didn\'t book or order: a gentle nudge the next day.',
    form: { name: 'Didn\'t finish ordering', trigger: 'item_viewed', delay: 1, unit: 'days', stopIfReplied: true, stopIfOrdered: true },
    wording: 'Hi {{1}}, you were checking out our {{2}} yesterday. Any questions? Reply here and our team will help you. 🙂',
  },
  {
    key: 'feedback', emoji: '⭐', title: 'How was your order?',
    blurb: 'Two days after an order enquiry, ask how it went.',
    form: { name: 'How was your order?', trigger: 'order_enquiry', delay: 2, unit: 'days', stopIfReplied: true, stopIfOrdered: false },
    wording: 'Hi {{1}}! How was your {{2}}? Reply with a quick rating from 1 to 5. Your feedback helps us improve. 🙏',
  },
  {
    key: 'winback', emoji: '👋', title: 'Win back quiet customers',
    blurb: 'Customers who haven\'t chatted for 30 days get a friendly check-in.',
    form: { name: 'Win back quiet customers', trigger: 'inactive', delay: 30, unit: 'days', stopIfReplied: true, stopIfOrdered: false },
    wording: 'Hi {{1}}, we miss you! 👋 Reply MENU to see what we offer, or just ask us anything here.',
  },
  {
    key: 'welcome', emoji: '🙌', title: 'Welcome follow-up',
    blurb: 'New contact who hasn\'t ordered after a day: share what you offer.',
    form: { name: 'Welcome follow-up', trigger: 'new_contact', delay: 1, unit: 'days', stopIfReplied: true, stopIfOrdered: true },
    wording: 'Hi {{1}}, thanks for reaching out to us! 👋 Reply MENU to see what we offer, or ask us anything here.',
  },
];

// The diet-kit preset and trigger only make sense for a bot with Arogya's food menus (28-day kits).
const KIT_ONLY_PRESETS = new Set(['reorder']);
function useHasKits() {
  const q = useApi<{ catalog?: { foodBuiltIns?: boolean } }>('/api/bot-catalog');
  return !!q.data?.catalog?.foodBuiltIns;
}

const UNIT_MIN: Record<Unit, number> = { minutes: 1, hours: 60, days: 1440 };

function splitDelay(minutes: number): { delay: number; unit: Unit } {
  if (minutes % 1440 === 0) return { delay: minutes / 1440, unit: 'days' };
  if (minutes % 60 === 0) return { delay: minutes / 60, unit: 'hours' };
  return { delay: minutes, unit: 'minutes' };
}

function describeDelay(minutes: number) {
  const { delay, unit } = splitDelay(minutes);
  return `${delay} ${delay === 1 ? unit.replace(/s$/, '') : unit}`;
}

function describeAutomation(a: { trigger: string; delay_minutes: number }) {
  const d = describeDelay(a.delay_minutes);
  return a.trigger === 'inactive' ? `${TRIGGERS.inactive.label} ${d}` : `${d} ${TRIGGERS[a.trigger as Trigger]?.label || a.trigger}`;
}

// ---------------------------------------------------------------------------
// Tab
// ---------------------------------------------------------------------------

interface AutomationsTabProps { templates: Template[]; isOwner: boolean; showToast: ShowToast; goToTemplates: () => void; onForm?: (open: boolean) => void }

export default function AutomationsTab({ templates, isOwner, showToast, goToTemplates, onForm }: AutomationsTabProps) {
  const [view, setView] = useState<View>({ mode: 'list' }); // list | pick | form | detail
  // Picking an idea or filling the form: the page's guide shrinks to a "How this works" button.
  useEffect(() => { onForm?.(view.mode === 'pick' || view.mode === 'form'); }, [view.mode, onForm]);
  const listQuery = useApi<{ automations: Automation[] }>('/api/automations');
  const list = listQuery.data?.automations || NONE;
  const error = errorOf(listQuery);
  const loading = listQuery.isFetching;
  const load = () => refreshApi('/api/automations');

  const toggle = async (a: Automation) => {
    try {
      await api(`/api/automations/${a.id}`, { method: 'PATCH', body: { isActive: !a.is_active } });
      showToast(a.is_active ? `Paused "${a.name}". Waiting follow-ups were cancelled.` : `"${a.name}" is on`);
      load();
    } catch (e) {
      showToast(errorMessage(e));
    }
  };

  if (view.mode === 'pick') {
    return <PresetPicker onPick={(preset) => setView({ mode: 'form', preset })} onCancel={() => setView({ mode: 'list' })} />;
  }
  if (view.mode === 'form') {
    const { existing } = view;
    return (
      <AutomationForm
        templates={templates}
        preset={view.preset}
        existing={existing}
        showToast={showToast}
        goToTemplates={goToTemplates}
        onCancel={() => setView(existing ? { mode: 'detail', id: existing.id } : { mode: 'list' })}
        onSaved={(id) => { load(); setView({ mode: 'detail', id }); }}
      />
    );
  }
  if (view.mode === 'detail') {
    return (
      <AutomationDetail
        id={view.id}
        isOwner={isOwner}
        showToast={showToast}
        onBack={() => { setView({ mode: 'list' }); load(); }}
        onEdit={(existing) => setView({ mode: 'form', existing })}
        onToggle={toggle}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="bg-white border border-slate-200 rounded-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <div className="text-sm font-semibold text-slate-800">Automatic follow-ups <span className="text-slate-400 font-normal">({list.length})</span></div>
          <div className="flex gap-2">
            <button onClick={load} className={btnSecondary} disabled={loading}><RotateCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
            {isOwner && <button onClick={() => setView({ mode: 'pick' })} className={btnPrimary}><Plus className="w-3.5 h-3.5" /> New automation</button>}
          </div>
        </div>

        {error && <LoadError className="m-4" error={error} onRetry={() => listQuery.refetch()} />}
        {!error && !listQuery.data && <div className="p-4"><SkeletonRows rows={3} label="Loading automations" /></div>}
        {!error && !loading && list.length === 0 && (
          <div className="p-8 text-center text-sm text-slate-500 space-y-2">
            <div>No automations yet. Set one up once and it keeps working by itself.</div>
            {isOwner && <button onClick={() => setView({ mode: 'pick' })} className={`${btnPrimary} mx-auto`}><Zap className="w-3.5 h-3.5" /> Start from a ready-made idea</button>}
          </div>
        )}

        <div className="divide-y divide-slate-100">
          {list.map(a => {
            const s = a.stats || {};
            return (
              <div key={a.id} className="px-4 py-3 flex items-start gap-3">
                {isOwner && (
                  <button onClick={() => toggle(a)} role="switch" aria-checked={a.is_active} title={a.is_active ? 'On: click to pause' : 'Paused: click to turn on'}
                    className={`mt-0.5 w-9 h-5 rounded-full relative flex-shrink-0 transition cursor-pointer ${a.is_active ? 'bg-wa-teal' : 'bg-slate-300'}`}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${a.is_active ? 'left-[18px]' : 'left-0.5'}`} />
                  </button>
                )}
                <button onClick={() => setView({ mode: 'detail', id: a.id })} className="flex-1 text-left min-w-0 cursor-pointer">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-800">{a.name}</span>
                    {!a.is_active && <Badge value="paused" />}
                  </div>
                  <div className="text-xs text-slate-600 mt-0.5">
                    Sends <span className="font-mono">{a.template_name}</span> {describeAutomation(a)}
                  </div>
                  <RunStats s={s} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <p className="text-xs text-slate-500 px-1">
        Follow-ups are only sent between 9am and 8pm India time, never to customers who replied STOP, and at most one waiting follow-up per customer per automation.
      </p>
    </div>
  );
}

function RunStats({ s }: { s: RunStatsRow }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5 text-xs text-slate-600">
      <span className="text-blue-700"><Clock className="w-3 h-3 inline -mt-0.5" /> {s.scheduled || 0} waiting</span>
      <span><Check className="w-3 h-3 inline -mt-0.5" /> {s.sent || 0} sent</span>
      <span><CheckCheck className="w-3 h-3 inline -mt-0.5" /> {s.delivered || 0} delivered</span>
      <span className="text-emerald-700"><Eye className="w-3 h-3 inline -mt-0.5" /> {s.read || 0} read</span>
      <span className="text-indigo-700"><Reply className="w-3 h-3 inline -mt-0.5" /> {s.replied || 0} replied</span>
      <span className="text-slate-500"><Ban className="w-3 h-3 inline -mt-0.5" /> {s.cancelled || 0} not needed</span>
      {Number(s.failed) > 0 && <span className="text-red-600"><AlertTriangle className="w-3 h-3 inline -mt-0.5" /> {s.failed} failed</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preset picker
// ---------------------------------------------------------------------------

function PresetPicker({ onPick, onCancel }: { onPick: (preset: Preset | null) => void; onCancel: () => void }) {
  const hasKits = useHasKits();
  return (
    <div className="bg-white border border-slate-200 rounded-xl">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <div className="text-sm font-semibold text-slate-800">What should happen automatically?</div>
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-700 cursor-pointer"><X className="w-4 h-4" /></button>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
        {PRESETS.filter(p => hasKits || !KIT_ONLY_PRESETS.has(p.key)).map(p => (
          <button key={p.key} onClick={() => onPick(p)} className="text-left border border-slate-200 hover:border-wa-teal hover:shadow-sm rounded-xl p-3 transition cursor-pointer">
            <div className="text-xl">{p.emoji}</div>
            <div className="text-sm font-semibold text-slate-800 mt-1">{p.title}</div>
            <div className="text-xs text-slate-500 mt-1">{p.blurb}</div>
          </button>
        ))}
        <button onClick={() => onPick(null)} className="text-left border border-dashed border-slate-300 hover:border-wa-teal rounded-xl p-3 cursor-pointer">
          <div className="text-xl">✏️</div>
          <div className="text-sm font-semibold text-slate-800 mt-1">Start from scratch</div>
          <div className="text-xs text-slate-500 mt-1">Choose your own trigger, timing and message.</div>
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create / edit form
// ---------------------------------------------------------------------------

interface AutomationFormProps {
  templates: Template[]; preset?: Preset | null; existing?: Automation; showToast: ShowToast; goToTemplates: () => void;
  onCancel: () => void; onSaved: (id: string) => void;
}

function AutomationForm({ templates, preset, existing, showToast, goToTemplates, onCancel, onSaved }: AutomationFormProps) {
  const approved = useMemo(() => templates.filter(t => t.status === 'APPROVED'), [templates]);
  const hasKits = useHasKits();
  const initial: FormState = existing
    ? {
      name: existing.name, trigger: existing.trigger, ...splitDelay(existing.delay_minutes),
      stopIfReplied: existing.stop_if_replied, stopIfOrdered: existing.stop_if_ordered,
    }
    : { name: '', trigger: 'order_enquiry', delay: 2, unit: 'days', stopIfReplied: true, stopIfOrdered: false, ...(preset?.form || {}) };
  const [form, setForm] = useState(initial);
  const [templateKey, setTemplateKey] = useState(existing ? `${existing.template_name}|${existing.template_language}` : '');
  const [variables, setVariables] = useState<Variables>(existing?.variables
    ? { header: existing.variables.header || [], body: existing.variables.body || [], headerMediaUrl: existing.variables.headerMediaUrl || '' }
    : { header: [], body: [], headerMediaUrl: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm(f => ({ ...f, [k]: v }));

  const template = approved.find(t => `${t.name}|${t.language}` === templateKey);
  const needs = template ? templateNeeds(template) : null;
  const allowItem = ITEM_TRIGGERS.includes(form.trigger);

  const pickTemplate = (key: string) => {
    setTemplateKey(key);
    const t = approved.find(x => `${x.name}|${x.language}` === key);
    const n = t ? templateNeeds(t) : null;
    setVariables({
      header: (n?.headerVars || []).map(() => ({ type: 'contact_name', fallback: 'there' })),
      body: (n?.bodyVars || []).map((_, i) => (i === 0
        ? { type: 'contact_name', fallback: 'there' }
        : allowItem && i === 1 ? { type: 'event_item', fallback: 'your order' } : { type: 'text', value: '' })),
      headerMediaUrl: '',
    });
  };

  const sample = (s: VariableSpec | undefined, k: string) => (!s ? `{{${k}}}` : s.type === 'contact_name' ? 'Ravi' : s.type === 'event_item' ? 'General consultation' : (s.value || `{{${k}}}`));
  const fill = (text: string, vars: string[], specs: VariableSpec[]) => vars.reduce((acc, k, i) => acc.split(`{{${k}}}`).join(sample(specs[i], k)), text);

  const save = async () => {
    setError('');
    if (!template) return setError('Pick an approved template.');
    const minutes = Math.round(Number(form.delay) * UNIT_MIN[form.unit]);
    const body = {
      name: form.name, trigger: form.trigger, delayMinutes: minutes,
      stopIfReplied: form.stopIfReplied, stopIfOrdered: form.stopIfOrdered,
      templateName: template.name, language: template.language, variables,
    };
    setBusy(true);
    try {
      const d = existing
        ? await api<{ automation: Automation }>(`/api/automations/${existing.id}`, { method: 'PATCH', body })
        : await api<{ automation: Automation }>('/api/automations', { method: 'POST', body });
      showToast(existing ? 'Automation updated' : `"${form.name}" is on. It runs automatically from now on.`);
      onSaved(d.automation.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const copyWording = () => {
    if (!preset) return;
    navigator.clipboard?.writeText(preset.wording);
    showToast('Wording copied. Paste it into a new template.');
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <div className="text-sm font-semibold text-slate-800">{existing ? `Edit "${existing.name}"` : preset ? `${preset.emoji} ${preset.title}` : 'New automation'}</div>
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-700 cursor-pointer"><X className="w-4 h-4" /></button>
      </div>
      <div className="grid md:grid-cols-[1fr_340px] gap-6 p-4">
        <div className="space-y-5">
          <Field label="1. Name" hint="Only you see this">
            <input className={inputCls} value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Follow-up after an enquiry" />
          </Field>

          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-700">2. When to send</div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-slate-600">Send</span>
              <input type="number" min={0} className={`${inputInlineCls} w-20`} value={form.delay} onChange={e => set('delay', e.target.value)} />
              <select className={`${inputInlineCls} w-28`} value={form.unit} onChange={e => set('unit', e.target.value as Unit)}>
                <option value="minutes">minutes</option>
                <option value="hours">hours</option>
                <option value="days">days</option>
              </select>
              <select className={`${inputInlineCls} flex-1 min-w-[220px]`} value={form.trigger} onChange={e => set('trigger', e.target.value)}>
                {Object.entries(TRIGGERS).filter(([k]) => k !== 'kit_order' || hasKits || form.trigger === 'kit_order').map(([k, t]) => <option key={k} value={k}>{k === 'inactive' ? 'after they\'ve been quiet (no chat) that long' : t.label}</option>)}
              </select>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 space-y-1.5">
              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input type="checkbox" checked={form.stopIfReplied} onChange={e => set('stopIfReplied', e.target.checked)} />
                Don't send if they message us before then
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input type="checkbox" checked={form.stopIfOrdered} onChange={e => set('stopIfOrdered', e.target.checked)} />
                Don't send if they place an order before then
              </label>
              <div className="text-xs text-slate-500">Times outside 9am-8pm India time move to the next 9am.</div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-700">3. Message</div>
            {approved.length === 0 ? (
              <div className="text-xs text-slate-600 bg-amber-50 border border-amber-200 rounded-lg p-3">
                You need an approved template first. <button onClick={goToTemplates} className="underline font-semibold cursor-pointer">Go to templates</button>
              </div>
            ) : (
              <select className={inputCls} value={templateKey} onChange={e => pickTemplate(e.target.value)}>
                <option value="">Choose an approved template…</option>
                {approved.map(t => <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>{t.name} ({t.language}, {t.category.toLowerCase()})</option>)}
              </select>
            )}
            {preset?.wording && (
              <div className="bg-sky-50 border border-sky-100 rounded-lg p-3 text-xs text-slate-700">
                <div className="font-semibold mb-1">No template for this yet? Suggested wording:</div>
                <div className="italic">"{preset.wording}"</div>
                <div className="flex gap-3 mt-2">
                  <button onClick={copyWording} className="text-wa-teal font-semibold flex items-center gap-1 cursor-pointer"><Copy className="w-3 h-3" /> Copy</button>
                  <button onClick={goToTemplates} className="text-wa-teal font-semibold cursor-pointer">Create it in Templates →</button>
                </div>
                <div className="text-xs text-slate-500 mt-1">{'{{1}}'} = customer's name{ITEM_TRIGGERS.includes(preset.form.trigger) ? ', {{2}} = the item they ordered or viewed' : ''}. Meta approval usually takes minutes.</div>
              </div>
            )}
            {needs && (needs.headerVars.length > 0 || needs.bodyVars.length > 0) && (
              <div className="space-y-2 pt-1">
                {needs.headerVars.map((k, i) => (
                  <VariableInput key={`h${k}`} label={`Header {{${k}}}`} spec={variables.header[i]} allowItem={allowItem}
                    onChange={s => setVariables(v => { const h = [...v.header]; h[i] = s; return { ...v, header: h }; })} />
                ))}
                {needs.bodyVars.map((k, i) => (
                  <VariableInput key={`b${k}`} label={`Body {{${k}}}`} spec={variables.body[i]} allowItem={allowItem}
                    onChange={s => setVariables(v => { const b = [...v.body]; b[i] = s; return { ...v, body: b }; })} />
                ))}
              </div>
            )}
            {needs?.headerFormat && needs.headerFormat !== 'TEXT' && (
              <Field label={`Header ${needs.headerFormat.toLowerCase()} link`} hint="A public https:// link to the file">
                <input className={inputCls} value={variables.headerMediaUrl} onChange={e => setVariables(v => ({ ...v, headerMediaUrl: e.target.value }))} placeholder="https://…" />
              </Field>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <div className="text-xs font-semibold text-slate-700">Preview</div>
          {needs ? (
            <TemplatePreview
              headerFormat={needs.headerFormat}
              headerText={fill(needs.headerText, needs.headerVars, variables.header)}
              bodyText={fill(needs.bodyText, needs.bodyVars, variables.body)}
              footerText={needs.footerText}
              buttons={needs.buttons}
            />
          ) : <div className="bg-slate-50 rounded-xl p-6 text-xs text-slate-400 text-center">Pick a template to preview</div>}
          <div className="text-xs text-slate-600 bg-slate-50 rounded-lg p-3">
            <strong>Summary:</strong> send {template ? <span className="font-mono">{template.name}</span> : 'the message'}{' '}
            {describeAutomation({ trigger: form.trigger, delay_minutes: Math.round(Number(form.delay || 0) * UNIT_MIN[form.unit]) })}.
          </div>
          {error && <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>}
          <div className="flex gap-2">
            <button onClick={save} disabled={busy || !form.name.trim() || !template} className={btnPrimary}>
              <Zap className="w-3.5 h-3.5" /> {busy ? 'Saving…' : existing ? 'Save changes' : 'Turn on'}
            </button>
            <button onClick={onCancel} className={btnSecondary}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

interface AutomationDetailProps {
  id: string; isOwner: boolean; showToast: ShowToast; onBack: () => void;
  onEdit: (a: Automation) => void; onToggle: (a: Automation) => Promise<void>;
}

function AutomationDetail({ id, isOwner, showToast, onBack, onEdit, onToggle }: AutomationDetailProps) {
  const confirm = useConfirm();
  const [filter, setFilter] = useState('all');
  const detail = useApi<{ automation: Automation; runs: AutomationRun[] }>(`/api/automations/${id}`);
  const data = detail.data || null;
  const error = errorOf(detail);
  const load = () => refreshApi('/api/automations'); // this one and the list

  const remove = async () => {
    if (!data || !(await confirm({ title: `Delete "${data.automation.name}"?`, body: 'Waiting follow-ups are cancelled and its history is removed. This can\'t be undone.', confirmLabel: 'Delete', danger: true }))) return;
    try {
      await api(`/api/automations/${id}`, { method: 'DELETE' });
      showToast('Automation deleted');
      onBack();
    } catch (e) {
      showToast(errorMessage(e));
    }
  };

  const cancelRun = async (runId: number) => {
    try {
      await api(`/api/automation-runs/${runId}/cancel`, { method: 'POST' });
      load();
    } catch (e) {
      showToast(errorMessage(e));
    }
  };

  if (error) return <div className="space-y-2"><LoadError error={error} onRetry={() => detail.refetch()} /><button onClick={onBack} className={btnSecondary}>Back</button></div>;
  if (!data) return <SkeletonRows rows={5} label="Loading" />;

  const a = data.automation;
  const rows = data.runs.filter(r => filter === 'all' ? true : filter === 'waiting' ? ['scheduled', 'sending'].includes(r.status)
    : filter === 'replied' ? r.replied_at : filter === 'not sent' ? ['cancelled', 'skipped', 'failed'].includes(r.status) : r.status === filter);

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <button onClick={onBack} className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1 mb-2 cursor-pointer"><ArrowLeft className="w-3.5 h-3.5" /> All automations</button>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-bold text-slate-800">{a.name}</h2>
          <Badge value={a.is_active ? 'on' : 'paused'} />
          {isOwner && (
            <div className="ml-auto flex gap-2">
              <button onClick={() => onToggle(a).then(load)} className={btnSecondary}>{a.is_active ? 'Pause' : 'Turn on'}</button>
              <button onClick={() => onEdit(a)} className={btnSecondary}><Pencil className="w-3.5 h-3.5" /> Edit</button>
              <button onClick={remove} className={btnSecondary}><Trash2 className="w-3.5 h-3.5" /></button>
              <button onClick={load} className={btnSecondary}><RotateCw className="w-3.5 h-3.5" /></button>
            </div>
          )}
        </div>
        <div className="text-xs text-slate-600 mt-1">
          Sends <span className="font-mono">{a.template_name}</span> ({a.template_language}) {describeAutomation(a)}.
          {a.stop_if_replied && ' Skipped if they message first.'}{a.stop_if_ordered && ' Skipped if they order first.'}
        </div>
        <RunStats s={a.stats || {}} />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl">
        <div className="flex flex-wrap gap-1 px-4 py-2 border-b border-slate-100">
          {['all', 'waiting', 'sent', 'delivered', 'read', 'replied', 'not sent'].map(f => (
            <button key={f} onClick={() => setFilter(f)} className={`px-2.5 py-1 rounded-md text-xs font-semibold capitalize cursor-pointer ${filter === f ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{f}</button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-slate-500">
              <tr><th className="px-4 py-2 font-medium">Customer</th><th className="px-4 py-2 font-medium">Item</th><th className="px-4 py-2 font-medium">Status</th><th className="px-4 py-2 font-medium">Due / sent</th><th className="px-4 py-2 font-medium">Note</th><th /></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(r => (
                <tr key={r.id}>
                  <td className="px-4 py-2"><div className="font-medium text-slate-800">{r.name || '–'}</div><div className="text-slate-500 font-mono">+{r.phone}</div></td>
                  <td className="px-4 py-2 text-slate-600">{r.data?.item || '–'}</td>
                  <td className="px-4 py-2"><Badge value={r.status === 'scheduled' ? 'waiting' : r.status} /></td>
                  <td className="px-4 py-2 text-slate-600">{r.sent_at ? fmtDate(r.sent_at) : fmtDate(r.due_at)}{r.replied_at && <div className="text-indigo-700">replied {fmtDate(r.replied_at)}</div>}</td>
                  <td className="px-4 py-2 text-slate-500 max-w-[240px]">{r.reason || ''}</td>
                  <td className="px-4 py-2 text-right">
                    {isOwner && r.status === 'scheduled' && <button onClick={() => cancelRun(r.id)} className="text-xs text-slate-500 hover:text-red-600 underline cursor-pointer">Cancel</button>}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">Nothing here yet. Follow-ups appear as customers trigger them.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
