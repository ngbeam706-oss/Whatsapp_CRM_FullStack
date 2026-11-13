import { useMemo, useState, type ReactNode } from 'react';
import { useConfirm } from './confirm';
import { GitBranch, Plus, Trash2, Edit3, Save, RotateCcw, X, MessageSquare, ListChecks, CheckCircle2, UserRound, ClipboardList, Circle, Smartphone } from 'lucide-react';
import type { BotCatalog, CatalogButton, CatalogItem } from './types';
import BotFlowPhone, { type PhoneDraft } from './BotFlowPhone';
import BotFlowAgent from './BotFlowAgent';

/**
 * Bot Flow editor for every business that doesn't use Arogya Ruchulu's food bot (catalog.foodBuiltIns
 * false). It edits the basic flow the server runs (server/bot.cjs):
 *   welcome message -> [Our services] [Talk to our team] [Raise a query]
 *   Our services -> list of items -> item details -> [Book / Enquire] [Talk to our team]
 * Layout: the three parts as numbered steps on the left, a phone on the right that plays the conversation,
 * and a floating guide (BotFlowAgent) that tours the page. data-tour names are what the guide points at.
 */

interface GenericBotFlowProps {
  catalog: BotCatalog;
  onSaveCatalog: (catalog: BotCatalog) => void;
  onResetCatalog: () => void;
}

// The three things a welcome button can do (ids the server's bot understands).
const ACTIONS = [
  { id: 'btn_menu', defaultTitle: '📋 Our services', name: 'Our services', what: 'Opens your services list (step 2). Hidden until you add a service.' },
  { id: 'btn_talk_staff', defaultTitle: '💬 Talk to our team', name: 'Talk to our team', what: 'Sends your "ask for a person" reply, then the bot stays quiet for 12 hours so your team can answer.' },
  { id: 'btn_raise_query', defaultTitle: '📝 Raise a query', name: 'Raise a query', what: 'Starts the query form: category, one message, a reference number. Shows on the Queries page.' },
] as const;

const MAX_ITEMS = 9; // a WhatsApp list has 10 rows; the last one is "Talk to our team"
const LIMITS = { button: 20, itemTitle: 24, itemDesc: 72, body: 1024 };

interface Draft {
  welcomeMessage: string;
  buttons: Record<string, { on: boolean; title: string }>;
  menuPrompt: string;
  menuButtonLabel: string;
  enquireButtonLabel: string;
  menuItems: CatalogItem[];
  orderConfirmReply: string;
  staffNotificationReply: string;
}

function draftFrom(c: BotCatalog): Draft {
  const current = new Map((c.welcomeButtons || []).map(b => [b.id, b]));
  const buttons: Draft['buttons'] = {};
  for (const a of ACTIONS) {
    const b = current.get(a.id);
    buttons[a.id] = { on: !!b, title: String(b?.title || a.defaultTitle) };
  }
  return {
    welcomeMessage: c.welcomeMessage || '',
    buttons,
    menuPrompt: c.menuPrompt || 'Here is what we offer. Tap an option to see the details:',
    menuButtonLabel: c.menuButtonLabel || 'View options',
    enquireButtonLabel: c.enquireButtonLabel || '✅ Book / Enquire',
    menuItems: Array.isArray(c.menuItems) ? c.menuItems : [],
    orderConfirmReply: c.orderConfirmReply || '',
    staffNotificationReply: c.staffNotificationReply || '',
  };
}

const inputCls = 'w-full bg-slate-50 border border-slate-300 rounded-lg p-2.5 text-xs text-slate-800 focus:bg-white focus:border-wa-teal focus:ring-1 focus:ring-wa-teal';

function Counter({ value, max }: { value: string; max: number }) {
  return <span className={`text-xs font-mono ${value.length > max ? 'text-rose-600 font-bold' : 'text-slate-400'}`}>{value.length}/{max}</span>;
}

function Field({ label, hint, value, max, children, tour }: { label: string; hint?: string; value?: string; max?: number; children: ReactNode; tour?: string }) {
  return (
    <div data-tour={tour}>
      <div className="flex items-center justify-between mb-1">
        <label className="font-bold text-slate-700 text-xs">{label}</label>
        {max !== undefined && value !== undefined && <Counter value={value} max={max} />}
      </div>
      {children}
      {hint && <p className="text-xs text-slate-500 mt-1">{hint}</p>}
    </div>
  );
}

/** One numbered step of the flow, with what it is for and whether it's ready. */
function Step({ n, id, icon, title, what, done, doneLabel = 'Done', children }: { n: number; id: string; icon: ReactNode; title: string; what: string; done: boolean | null; doneLabel?: string; children: ReactNode }) {
  return (
    <section id={id} data-tour={id} className="bg-white rounded-xl border border-slate-200 shadow-xs scroll-mt-4">
      <div className="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-slate-100">
        <span className="w-7 h-7 rounded-full bg-wa-teal text-white text-sm font-bold flex items-center justify-center flex-shrink-0">{n}</span>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-sm text-slate-800 flex items-center gap-2">{icon}<span>{title}</span></h3>
          <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{what}</p>
        </div>
        {done !== null && (
          <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded-full flex-shrink-0 ${done ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-800 border border-amber-200'}`}>
            {done ? doneLabel : 'To do'}
          </span>
        )}
      </div>
      <div className="p-5 space-y-4">{children}</div>
    </section>
  );
}

export default function GenericBotFlow({ catalog, onSaveCatalog, onResetCatalog }: GenericBotFlowProps) {
  const confirm = useConfirm();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(catalog));
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  const [isNew, setIsNew] = useState(false);

  // A save or reset on the server gives a new catalog: start again from it.
  const [shownCatalog, setShownCatalog] = useState(catalog);
  if (shownCatalog !== catalog) {
    setShownCatalog(catalog);
    setDraft(draftFrom(catalog));
  }

  const saved = useMemo(() => JSON.stringify(draftFrom(catalog)), [catalog]);
  const dirty = JSON.stringify(draft) !== saved;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(d => ({ ...d, [key]: value }));
  const setButton = (id: string, patch: Partial<{ on: boolean; title: string }>) =>
    setDraft(d => ({ ...d, buttons: { ...d.buttons, [id]: { ...d.buttons[id], ...patch } } }));

  const welcomeButtons: CatalogButton[] = useMemo(() => ACTIONS
    .filter(a => draft.buttons[a.id]?.on)
    .map(a => ({ id: a.id, title: (draft.buttons[a.id].title.trim() || a.defaultTitle).slice(0, LIMITS.button) })), [draft.buttons]);

  // What the phone plays (a new object only when the text changes, so the preview restarts then).
  const phone: PhoneDraft = useMemo(() => ({
    welcomeMessage: draft.welcomeMessage, welcomeButtons, menuPrompt: draft.menuPrompt, menuButtonLabel: draft.menuButtonLabel,
    enquireButtonLabel: draft.enquireButtonLabel, menuItems: draft.menuItems, orderConfirmReply: draft.orderConfirmReply, staffNotificationReply: draft.staffNotificationReply,
  }), [draft.welcomeMessage, welcomeButtons, draft.menuPrompt, draft.menuButtonLabel, draft.enquireButtonLabel, draft.menuItems, draft.orderConfirmReply, draft.staffNotificationReply]);

  const problems: string[] = [];
  if (!draft.welcomeMessage.trim()) problems.push('Write a welcome message (step 1).');
  if (draft.welcomeMessage.length > LIMITS.body) problems.push(`The welcome message is longer than ${LIMITS.body} characters.`);
  if (!welcomeButtons.length) problems.push('Turn on at least one welcome button (step 1).');
  for (const a of ACTIONS) if (draft.buttons[a.id]?.on && draft.buttons[a.id].title.length > LIMITS.button) problems.push(`Button "${draft.buttons[a.id].title}" is longer than ${LIMITS.button} characters.`);
  if (draft.menuButtonLabel.length > LIMITS.button) problems.push(`The list button text is longer than ${LIMITS.button} characters.`);
  if (draft.enquireButtonLabel.length > LIMITS.button) problems.push(`The enquire button text is longer than ${LIMITS.button} characters.`);

  const save = () => {
    if (problems.length) return;
    onSaveCatalog({
      ...catalog,
      welcomeMessage: draft.welcomeMessage.trim(),
      welcomeButtons,
      menuPrompt: draft.menuPrompt.trim(),
      menuButtonLabel: draft.menuButtonLabel.trim() || 'View options',
      enquireButtonLabel: draft.enquireButtonLabel.trim() || '✅ Book / Enquire',
      menuItems: draft.menuItems,
      orderConfirmReply: draft.orderConfirmReply.trim(),
      staffNotificationReply: draft.staffNotificationReply.trim(),
    });
  };

  const reset = async () => {
    if (await confirm('Put the bot back to the basic starting flow? Your services list and messages will be replaced.')) onResetCatalog();
  };

  const openItem = (item?: CatalogItem) => {
    setIsNew(!item);
    setEditing(item ? { ...item } : { id: `menu_${Date.now()}`, title: '', description: '', price: '', details: '' });
  };
  const saveItem = () => {
    if (!editing || !editing.title.trim()) return;
    const clean: CatalogItem = {
      ...editing,
      title: editing.title.trim().slice(0, LIMITS.itemTitle),
      description: String(editing.description || '').trim().slice(0, LIMITS.itemDesc),
      price: Number(editing.price) > 0 ? Number(editing.price) : '',
      details: String(editing.details || '').trim(),
    };
    set('menuItems', isNew ? [...draft.menuItems, clean] : draft.menuItems.map(i => (i.id === clean.id ? clean : i)));
    setEditing(null);
  };
  const removeItem = async (id: string) => {
    if (await confirm('Remove this item from the services list?')) set('menuItems', draft.menuItems.filter(i => i.id !== id));
  };

  const servicesOn = !!draft.buttons.btn_menu?.on;
  // Ready state of each part (shown on the step chips and the progress strip).
  const ready = {
    welcome: !!draft.welcomeMessage.trim() && welcomeButtons.length > 0,
    services: servicesOn ? draft.menuItems.length > 0 : null,
    replies: !!draft.orderConfirmReply.trim() && !!draft.staffNotificationReply.trim(),
  };
  const parts: Array<[string, string, boolean | null]> = [
    ['bf-welcome', '1. Welcome & buttons', ready.welcome],
    ['bf-services', '2. Services list', ready.services],
    ['bf-replies', '3. Automatic replies', ready.replies],
  ];
  const doneCount = parts.filter(p => p[2] !== false).length;
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="flex-1 bg-slate-50 flex flex-col h-full overflow-hidden select-text">
      <div className="bg-white border-b border-wa-border px-6 py-4 flex flex-wrap items-center justify-between gap-3 shadow-xs" data-tour="bf-header">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-teal-50 text-wa-teal flex items-center justify-center border border-teal-200">
            <GitBranch className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-800">WhatsApp Bot Flow</h2>
            <p className="text-xs text-slate-500">What your bot says when customers message you. Set it up in 3 steps, try it on the phone, then save.</p>
          </div>
        </div>
        <div className="flex items-center gap-2" data-tour="bf-save">
          <button onClick={reset} className="text-slate-500 hover:text-slate-800 text-xs px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 transition cursor-pointer flex items-center gap-1.5" title="Put the bot back to the basic starting flow">
            <RotateCcw className="w-3.5 h-3.5" /><span>Reset to basic flow</span>
          </button>
          <button onClick={save} disabled={!dirty || problems.length > 0} className="bg-wa-teal hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold px-4 py-1.5 rounded-lg shadow-sm transition cursor-pointer flex items-center gap-1.5">
            <Save className="w-3.5 h-3.5" /><span>{dirty ? 'Save changes' : 'Saved'}</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-6 scrollbar-thin">
        <div className="max-w-6xl mx-auto space-y-4">
          {/* Progress: the three parts, click to jump. */}
          <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex flex-wrap items-center gap-2" data-tour="bf-steps">
            <span className="text-xs font-semibold text-slate-700 mr-1">{doneCount} of 3 parts ready</span>
            {parts.map(([id, label, ok]) => (
              <button key={id} onClick={() => jump(id)} className={`text-xs px-2.5 py-1 rounded-full border flex items-center gap-1 cursor-pointer ${ok === false ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
                {ok === false ? <Circle className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />} {label}{ok === null ? ' (not used)' : ''}
              </button>
            ))}
            {dirty && <span className="ml-auto text-xs font-semibold text-amber-700" data-testid="bf-unsaved">Unsaved changes: press Save changes</span>}
          </div>

          {problems.length > 0 && dirty && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 space-y-0.5">
              {problems.map(p => <div key={p}>• {p}</div>)}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-5 items-start">
            <div className="space-y-5 min-w-0">
              {/* 1. Welcome */}
              <Step n={1} id="bf-welcome" icon={<MessageSquare className="w-4 h-4 text-teal-600" />} title="Welcome message and buttons" done={ready.welcome}
                what="The first message every customer gets: for hi, hello, or anything the bot doesn't understand. Up to 3 buttons sit under it.">
                <Field tour="bf-welcome-text" label="Welcome message" value={draft.welcomeMessage} max={LIMITS.body} hint="One or two short lines: who you are and what they can do here.">
                  <textarea rows={3} className={inputCls} value={draft.welcomeMessage} onChange={e => set('welcomeMessage', e.target.value)} placeholder="Welcome to our business! 👋 How can we help you today?" />
                </Field>
                <div className="space-y-2">
                  <div className="font-bold text-slate-700 text-xs">Buttons under the welcome (tick to show, type to rename)</div>
                  {ACTIONS.map(a => {
                    const b = draft.buttons[a.id];
                    return (
                      <div key={a.id} data-tour={`bf-btn-${a.id}`} className={`border rounded-lg p-2.5 ${b.on ? 'border-teal-200 bg-teal-50/30' : 'border-slate-200'}`}>
                        <div className="flex flex-wrap items-center gap-3">
                          <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 w-40 cursor-pointer">
                            <input type="checkbox" checked={b.on} onChange={e => setButton(a.id, { on: e.target.checked })} aria-label={`Show ${a.defaultTitle}`} />
                            <span>{a.name}</span>
                          </label>
                          <input className={`${inputCls} flex-1 min-w-40`} value={b.title} maxLength={LIMITS.button} disabled={!b.on} onChange={e => setButton(a.id, { title: e.target.value })} aria-label={`Button text for ${a.defaultTitle}`} />
                          <Counter value={b.title} max={LIMITS.button} />
                        </div>
                        <p className="text-xs text-slate-500 mt-1.5">{a.what}</p>
                        {a.id === 'btn_menu' && b.on && draft.menuItems.length === 0 && (
                          <p className="text-xs text-amber-700 mt-1">Customers don&apos;t see this button yet: add a service in step 2.</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Step>

              {/* 2. Services */}
              <Step n={2} id="bf-services" icon={<ListChecks className="w-4 h-4 text-indigo-600" />} title={`Services list (${draft.menuItems.length} of ${MAX_ITEMS})`}
                done={ready.services} doneLabel={ready.services === null ? 'Not used' : 'Done'}
                what={servicesOn
                  ? 'What customers see after "Our services" (or when they type menu, services or price). Each item opens its details with your Book / Enquire button.'
                  : 'Not used: the "Our services" button is off in step 1. Turn it on to offer this list.'}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3" data-tour="bf-list-settings">
                  <div className="md:col-span-2">
                    <Field label="Message above the list" value={draft.menuPrompt} max={LIMITS.body}>
                      <input className={inputCls} value={draft.menuPrompt} onChange={e => set('menuPrompt', e.target.value)} />
                    </Field>
                  </div>
                  <Field label="List button text" value={draft.menuButtonLabel} max={LIMITS.button} hint="The button that opens the list.">
                    <input className={inputCls} maxLength={LIMITS.button} value={draft.menuButtonLabel} onChange={e => set('menuButtonLabel', e.target.value)} />
                  </Field>
                  <Field label="Button under an item" value={draft.enquireButtonLabel} max={LIMITS.button} hint={'Sent with each item\'s details, e.g. "📅 Book a visit".'}>
                    <input className={inputCls} maxLength={LIMITS.button} value={draft.enquireButtonLabel} onChange={e => set('enquireButtonLabel', e.target.value)} />
                  </Field>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3" data-tour="bf-items">
                  {draft.menuItems.map(i => (
                    <div key={i.id} className="border border-slate-200 rounded-xl p-3 flex flex-col justify-between hover:border-indigo-300 transition">
                      <div>
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <h4 className="font-bold text-xs text-slate-800">{i.title}</h4>
                          {Number(i.price) > 0 && <span className="bg-emerald-50 text-emerald-800 font-mono font-bold text-xs px-2 py-0.5 rounded border border-emerald-200 flex-shrink-0">₹{i.price}</span>}
                        </div>
                        {i.description && <p className="text-xs text-slate-600 mb-2">{i.description}</p>}
                      </div>
                      <div className="flex justify-end gap-1 border-t border-slate-100 pt-2">
                        <button onClick={() => openItem(i)} className="p-1.5 text-slate-500 hover:text-wa-teal rounded hover:bg-slate-100 cursor-pointer" title="Edit item" aria-label={`Edit ${i.title}`}><Edit3 className="w-3.5 h-3.5" /></button>
                        <button onClick={() => removeItem(i.id)} className="p-1.5 text-slate-400 hover:text-rose-600 rounded hover:bg-slate-100 cursor-pointer" title="Remove item" aria-label={`Remove ${i.title}`}><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                  ))}
                  {draft.menuItems.length < MAX_ITEMS && (
                    <button onClick={() => openItem()} data-tour="bf-add-item" className="border-2 border-dashed border-slate-300 rounded-xl p-4 text-xs font-semibold text-slate-500 hover:border-wa-teal hover:text-wa-teal flex flex-col items-center justify-center gap-1 cursor-pointer min-h-24">
                      <Plus className="w-4 h-4" /><span>Add a service or product</span>
                      <span className="font-normal text-xs text-slate-400">Name, optional price and details</span>
                    </button>
                  )}
                </div>
              </Step>

              {/* 3. Replies */}
              <Step n={3} id="bf-replies" icon={<CheckCircle2 className="w-4 h-4 text-emerald-600" />} title="Automatic replies" done={ready.replies}
                what="The two messages that end the flow: after a customer books or enquires, and when they ask for a person.">
                <Field tour="bf-reply-book" label="After Book / Enquire" value={draft.orderConfirmReply} max={LIMITS.body} hint='Tell them what happens next, e.g. "Our team will call you within 30 minutes to confirm." The chat moves to Booked in your Pipeline.'>
                  <textarea rows={3} className={inputCls} value={draft.orderConfirmReply} onChange={e => set('orderConfirmReply', e.target.value)} />
                </Field>
                <Field tour="bf-reply-person" label="When they ask for a person" value={draft.staffNotificationReply} max={LIMITS.body} hint="Sent for 'Talk to our team'. Then the bot stays quiet in that chat for 12 hours so your team can reply.">
                  <textarea rows={3} className={inputCls} value={draft.staffNotificationReply} onChange={e => set('staffNotificationReply', e.target.value)} />
                </Field>
                <div className="text-xs text-slate-500 flex items-start gap-1.5">
                  <ClipboardList className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  <span>Answers to common questions (&quot;timings&quot;, &quot;location&quot;) go on the <strong>Keywords</strong> page. Don&apos;t promise cures or results, and only quote prices you really charge.</span>
                </div>
              </Step>
            </div>

            {/* The phone: plays the conversation as customers see it. */}
            <aside className="lg:sticky lg:top-0 space-y-2" data-tour="bf-phone">
              <div className="text-xs font-semibold text-slate-700 flex items-center gap-1.5 justify-center"><Smartphone className="w-4 h-4 text-wa-teal" /> What customers see</div>
              <BotFlowPhone draft={phone} />
            </aside>
          </div>
        </div>
      </div>

      <BotFlowAgent />

      {editing && (
        <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true" aria-label={isNew ? 'Add item' : 'Edit item'}>
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-200">
            <div className="bg-wa-teal text-white px-5 py-3.5 flex items-center justify-between">
              <h3 className="font-bold text-sm flex items-center gap-2"><UserRound className="w-4 h-4" /><span>{isNew ? 'Add a service or product' : 'Edit item'}</span></h3>
              <button onClick={() => setEditing(null)} className="text-teal-100 hover:text-white cursor-pointer" aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={e => { e.preventDefault(); saveItem(); }} className="p-5 space-y-4 text-xs">
              <Field label="Name (shown in the list)" value={editing.title} max={LIMITS.itemTitle}>
                <input required autoFocus className={inputCls} maxLength={LIMITS.itemTitle} value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} placeholder="e.g. General consultation" />
              </Field>
              <Field label="Short description (optional)" value={String(editing.description || '')} max={LIMITS.itemDesc}>
                <input className={inputCls} maxLength={LIMITS.itemDesc} value={String(editing.description || '')} onChange={e => setEditing({ ...editing, description: e.target.value })} placeholder="e.g. Mon–Sat, 10am–6pm" />
              </Field>
              <Field label="Price in ₹ (optional, leave empty to not show one)">
                <input type="number" min={0} className={inputCls} value={String(editing.price ?? '')} onChange={e => setEditing({ ...editing, price: e.target.value })} />
              </Field>
              <Field label="Details sent when the customer picks it (optional)" value={String(editing.details || '')} max={LIMITS.body} hint="Leave empty to send the name, price and description.">
                <textarea rows={4} className={inputCls} value={String(editing.details || '')} onChange={e => setEditing({ ...editing, details: e.target.value })} />
              </Field>
              <p className="text-xs text-slate-500">The item is added to the page (and the phone preview); press <strong>Save changes</strong> at the top to make it live.</p>
              <div className="border-t border-slate-200 pt-3 flex justify-end gap-2">
                <button type="button" onClick={() => setEditing(null)} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 cursor-pointer">Cancel</button>
                <button type="submit" className="bg-wa-teal hover:bg-teal-700 text-white font-semibold px-4 py-2 rounded-lg cursor-pointer flex items-center gap-1"><Save className="w-3.5 h-3.5" /><span>{isNew ? 'Add item' : 'Update item'}</span></button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
