import { useEffect, useMemo, useState, type FormEvent, type ReactElement } from 'react';
import { useConfirm } from './confirm';
import {
  Megaphone, FileText, Plus, RotateCw, Send, X, Trash2, CheckCheck, Check, AlertTriangle,
  Eye, Reply, Users, ArrowLeft, Ban, Play, FlaskConical, Zap, type LucideIcon
} from 'lucide-react';
import { canManage } from './crmUtils';
import { REFRESH } from './usePolling';
import { useApi, refreshApi, errorOf } from './queryClient';
import { api, errorMessage, placeholders, templateNeeds, fmtDate, pct, inputCls, inputInlineCls, btnPrimary, btnSecondary } from './broadcastUtils';
import { LoadError, SkeletonRows } from './ui';
import { Badge, Field, TemplatePreview, VariableInput } from './BroadcastUi';
import AutomationsTab from './AutomationsTab';
import BroadcastGuide from './BroadcastGuide';
import type { Role, ShowToast, Template, TemplateComponent, VariableSpec } from './types';
import { useBusinessNumbers, numberName, findNumber } from './inboxNumbers';

// ---- Shapes (server/broadcastRoutes.cjs, campaigns.cjs) ----
type Tab = 'campaigns' | 'automations' | 'templates';
interface BroadcastAccount {
  role?: Role; wabaConfigured?: boolean; dailyLimit?: number | null;
  phone?: { verified_name?: string; display_phone_number?: string; quality_rating?: string; messaging_limit_tier?: string } | null;
}
interface CampaignStats {
  total?: number | string; sent?: number | string; delivered?: number | string; read?: number | string;
  replied?: number | string; failed?: number | string; pending?: number | string;
}
interface Campaign {
  id: string; name: string; status: string; template_name: string; template_language: string;
  created_by?: string | null; created_at: string; started_at?: string | null; completed_at?: string | null; stats?: CampaignStats | null;
  /** Sent from this extra number (null = the main number). */
  phone_number_id?: string | null;
}
interface Recipient {
  phone: string; name: string | null; status: string; sent_at: string | null; read_at: string | null; replied_at: string | null; error: string | null;
}
interface AudienceOptions { sources: string[]; tags: string[]; total: number; optedOut: number }
interface AudiencePreview { count: number; optedOutExcluded?: number; notInContacts?: number }
interface Variables { header: VariableSpec[]; body: VariableSpec[]; headerMediaUrl: string }
interface Segment { mode: 'filter' | 'list'; sources: string[]; activeWithinDays: string; tags: string[]; phones: string }
type TemplateButton = NonNullable<TemplateComponent['buttons']>[number];
interface TemplateForm {
  name: string; category: string; language: string; headerText: string; headerExample: string;
  bodyText: string; bodyExamples: string[]; footerText: string; buttons: TemplateButton[];
}
type CampaignView = { mode: 'list' } | { mode: 'new' } | { mode: 'detail'; id: string };

const NONE: never[] = [];
const NO_TEMPLATES: Template[] = [];
const NO_OPTIONS: AudienceOptions = { sources: [], tags: [], total: 0, optedOut: 0 };
// "Broadcast campaigns" (WhatsApp messages to your own contacts), named so they aren't confused with Ad campaigns.
const TABS: Array<[Tab, string, LucideIcon]> = [['campaigns', 'Broadcast campaigns', Megaphone], ['automations', 'Automations', Zap], ['templates', 'Templates', FileText]];


// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function BroadcastsScreen({ showToast }: { showToast: ShowToast }) {
  const [tab, setTabState] = useState<Tab>('campaigns');
  // A create form is open (new campaign / template / follow-up): the guide shrinks to a "How this works" button.
  const [formOpen, setFormOpen] = useState(false);
  const setTab = (t: Tab) => { setFormOpen(false); setTabState(t); };
  // The WhatsApp account (role, daily limit) changes rarely: keep it 5 minutes.
  const account = useApi<BroadcastAccount>('/api/broadcast/account', { staleTime: 5 * 60000 }).data || null;
  const templatesQuery = useApi<{ templates: Template[] }>('/api/templates');
  const templates: Template[] = templatesQuery.data?.templates || NONE;
  const templatesError = errorOf(templatesQuery);
  const loadingTemplates = templatesQuery.isFetching;
  const loadTemplates = () => refreshApi('/api/templates');

  // Broadcasts, templates and follow-ups: the Business Admin or a manager.
  const isOwner = canManage(account?.role);

  return (
    <div className="flex-1 overflow-y-auto bg-slate-100">
      <div className="max-w-6xl mx-auto px-4 py-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Megaphone className="w-5 h-5 text-wa-teal" /> Broadcasts &amp; Follow-ups</h1>
            <p className="text-xs text-slate-500">Send approved WhatsApp templates to groups of customers, set up automatic follow-ups, and track delivery, reads and replies.</p>
          </div>
          <div className="bg-white border border-slate-200 p-0.5 rounded-lg flex">
            {TABS.map(([id, label, Icon]) => (
              <button key={id} onClick={() => setTab(id)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${tab === id ? 'bg-wa-teal text-white' : 'text-slate-600 hover:text-slate-900'}`}>
                <Icon className="w-3.5 h-3.5" /> {label}
              </button>
            ))}
          </div>
        </div>

        <AccountBanner account={account} />

        <BroadcastGuide key={tab} topic={tab} compact={formOpen} />

        {tab === 'automations' ? (
          <AutomationsTab templates={templates} isOwner={isOwner} showToast={showToast} goToTemplates={() => setTab('templates')} onForm={setFormOpen} />
        ) : tab === 'templates' ? (
          <TemplatesTab
            templates={templates}
            error={templatesError}
            loading={loadingTemplates}
            reload={loadTemplates}
            isOwner={isOwner}
            showToast={showToast}
            onForm={setFormOpen}
          />
        ) : (
          <CampaignsTab
            templates={templates}
            account={account}
            isOwner={isOwner}
            showToast={showToast}
            goToTemplates={() => setTab('templates')}
            onForm={setFormOpen}
          />
        )}
      </div>
    </div>
  );
}

function AccountBanner({ account }: { account: BroadcastAccount | null }) {
  if (!account) return null;
  const items: ReactElement[] = [];
  if (!account.wabaConfigured) {
    items.push(
      <div key="waba" className="flex gap-2 text-amber-900">
        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span><strong>No WhatsApp Business Account connected.</strong> The Business Admin connects the number and its WhatsApp Business Account ID on the <strong>WhatsApp</strong> page. Templates, campaigns and follow-ups work once it is connected.</span>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {items.length > 0 && <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs">{items}</div>}
      {account.phone && (
        <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-600 flex flex-wrap gap-x-5 gap-y-1">
          <span><strong className="text-slate-800">{account.phone.verified_name}</strong> · {account.phone.display_phone_number}</span>
          <span>Quality: <strong className={account.phone.quality_rating === 'GREEN' ? 'text-emerald-700' : 'text-amber-700'}>{account.phone.quality_rating}</strong></span>
          {account.dailyLimit && <span>Daily limit: <strong className="text-slate-800">{account.dailyLimit.toLocaleString()}</strong> new customer conversations per 24h</span>}
          {!account.dailyLimit && account.phone.messaging_limit_tier && <span>Tier: {account.phone.messaging_limit_tier}</span>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

interface TemplatesTabProps {
  templates: Template[]; error: string | null; loading: boolean; reload: () => void; isOwner: boolean; showToast: ShowToast;
  onForm?: (open: boolean) => void;
}

function TemplatesTab({ templates, error, loading, reload, isOwner, showToast, onForm }: TemplatesTabProps) {
  const confirm = useConfirm();
  const [creating, setCreating] = useState(false);
  useEffect(() => { onForm?.(creating); }, [creating, onForm]);

  const handleDelete = async (name: string) => {
    if (!(await confirm({ title: `Delete template "${name}"?`, body: 'All its languages are deleted. This can\'t be undone, and Meta won\'t let you reuse the name for 30 days.', confirmLabel: 'Delete template', danger: true }))) return;
    try {
      await api(`/api/templates/${encodeURIComponent(name)}`, { method: 'DELETE' });
      showToast(`Template "${name}" deleted`);
      reload();
    } catch (e) {
      showToast(errorMessage(e));
    }
  };

  if (creating) {
    return <NewTemplateForm onCancel={() => setCreating(false)} onCreated={() => { setCreating(false); reload(); }} showToast={showToast} />;
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <div className="text-sm font-semibold text-slate-800">Message templates <span className="text-slate-400 font-normal">({templates.length})</span></div>
        <div className="flex gap-2">
          <button onClick={reload} className={btnSecondary} disabled={loading}><RotateCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
          {isOwner && <button onClick={() => setCreating(true)} className={btnPrimary}><Plus className="w-3.5 h-3.5" /> New template</button>}
        </div>
      </div>

      {error && <LoadError className="m-4" error={error} onRetry={reload} />}
      {!error && loading && templates.length === 0 && <div className="p-4"><SkeletonRows rows={3} label="Loading templates" /></div>}

      {!error && templates.length === 0 && !loading && (
        <div className="p-8 text-center text-sm text-slate-500">
          No templates yet. Templates are messages Meta approves in advance. You need one to message customers who haven't written to you in the last 24 hours.
        </div>
      )}

      <div className="divide-y divide-slate-100">
        {templates.map(t => {
          const n = templateNeeds(t);
          return (
            <div key={t.id} className="px-4 py-3 flex flex-col md:flex-row md:items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-slate-800">{t.name}</span>
                  <Badge value={t.status} />
                  <span className="text-xs text-slate-500 uppercase">{t.category} · {t.language}</span>
                </div>
                {n.headerText && <div className="text-xs font-semibold text-slate-700 mt-1">{n.headerText}</div>}
                <div className="text-xs text-slate-600 mt-1 whitespace-pre-wrap line-clamp-3">{n.bodyText}</div>
                {t.status === 'REJECTED' && t.rejected_reason && t.rejected_reason !== 'NONE' && (
                  <div className="text-xs text-red-600 mt-1">Rejected: {t.rejected_reason}</div>
                )}
              </div>
              {isOwner && (
                <button onClick={() => handleDelete(t.name)} className="text-slate-400 hover:text-red-600 p-1 cursor-pointer self-start" title="Delete template">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NewTemplateForm({ onCancel, onCreated, showToast }: { onCancel: () => void; onCreated: () => void; showToast: ShowToast }) {
  const [form, setForm] = useState<TemplateForm>({
    name: '', category: 'MARKETING', language: 'en',
    headerText: '', headerExample: '', bodyText: '', bodyExamples: [], footerText: 'Reply STOP to unsubscribe',
    buttons: [],
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof TemplateForm>(k: K, v: TemplateForm[K]) => setForm(f => ({ ...f, [k]: v }));

  const bodyVars = placeholders(form.bodyText);
  const headerVars = placeholders(form.headerText);

  const addVariable = () => set('bodyText', `${form.bodyText}{{${bodyVars.length + 1}}}`);

  const exampleFill = (text: string, vars: string[], examples: string[]) => vars.reduce((t, k, i) => t.split(`{{${k}}}`).join(examples[i] || `{{${k}}}`), text);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const d = await api<{ status?: string }>('/api/templates', { method: 'POST', body: form });
      showToast(`Template submitted to Meta (${d.status || 'PENDING'}). Approval usually takes minutes, sometimes up to 24h.`);
      onCreated();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="bg-white border border-slate-200 rounded-xl">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <div className="text-sm font-semibold text-slate-800">New template</div>
        <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-700 cursor-pointer"><X className="w-4 h-4" /></button>
      </div>
      <div className="grid md:grid-cols-[1fr_340px] gap-6 p-4">
        <div className="space-y-4">
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="Name" hint="lowercase_with_underscores">
              <input className={inputCls} value={form.name} onChange={e => set('name', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))} placeholder="weekend_offer" required />
            </Field>
            <Field label="Category" hint="Offers = Marketing">
              <select className={inputCls} value={form.category} onChange={e => set('category', e.target.value)}>
                <option value="MARKETING">Marketing (offers, news)</option>
                <option value="UTILITY">Utility (order updates)</option>
              </select>
            </Field>
            <Field label="Language" hint="Must match the text">
              <select className={inputCls} value={form.language} onChange={e => set('language', e.target.value)}>
                <option value="en">English</option>
                <option value="en_US">English (US)</option>
                <option value="te">Telugu</option>
                <option value="hi">Hindi</option>
              </select>
            </Field>
          </div>

          <Field label="Header (optional)" hint="Bold first line, max 60 characters. May contain one variable {{1}}.">
            <input className={inputCls} maxLength={60} value={form.headerText} onChange={e => set('headerText', e.target.value)} placeholder="This weekend only ✨" />
          </Field>
          {headerVars.length > 0 && (
            <Field label="Example for header {{1}}">
              <input className={inputCls} value={form.headerExample} onChange={e => set('headerExample', e.target.value)} placeholder="Ravi" />
            </Field>
          )}

          <Field label="Body" hint="Use {{1}}, {{2}}… for parts that change per customer (like their name). *bold* works.">
            <textarea className={`${inputCls} min-h-[120px]`} maxLength={1024} value={form.bodyText} onChange={e => set('bodyText', e.target.value)}
              placeholder={'Hi {{1}}! Our new offer is here. Book this weekend and get {{2}} off.'} required />
          </Field>
          <div className="flex items-center justify-between -mt-2">
            <button type="button" onClick={addVariable} className="text-xs text-wa-teal font-semibold cursor-pointer">+ Add variable {`{{${bodyVars.length + 1}}}`}</button>
            <span className="text-xs text-slate-400">{form.bodyText.length}/1024</span>
          </div>
          {bodyVars.length > 0 && (
            <div className="bg-slate-50 rounded-lg p-3 space-y-2">
              <div className="text-xs text-slate-600">Meta needs a sample value for each variable to review the template.</div>
              {bodyVars.map((v, i) => (
                <div key={v} className="flex items-center gap-2">
                  <span className="font-mono text-xs text-slate-500 w-10">{`{{${v}}}`}</span>
                  <input className={inputCls} value={form.bodyExamples[i] || ''} placeholder={i === 0 ? 'Ravi' : '20%'}
                    onChange={e => { const ex = [...form.bodyExamples]; ex[i] = e.target.value; set('bodyExamples', ex); }} />
                </div>
              ))}
            </div>
          )}

          <Field label="Footer (optional)" hint="Small grey text. Including STOP instructions helps keep your quality rating high.">
            <input className={inputCls} maxLength={60} value={form.footerText} onChange={e => set('footerText', e.target.value)} />
          </Field>

          <div>
            <div className="text-xs font-semibold text-slate-700 mb-1">Buttons (optional, max 3)</div>
            <div className="space-y-2">
              {form.buttons.map((b, i) => (
                <div key={i} className="flex flex-wrap gap-2 items-center">
                  <select className={`${inputInlineCls} w-36`} value={b.type} onChange={e => { const bs = [...form.buttons]; bs[i] = { ...b, type: e.target.value }; set('buttons', bs); }}>
                    <option value="QUICK_REPLY">Quick reply</option>
                    <option value="URL">Website link</option>
                  </select>
                  <input className={`${inputInlineCls} flex-1 min-w-[120px]`} maxLength={25} placeholder="Button text" value={b.text}
                    onChange={e => { const bs = [...form.buttons]; bs[i] = { ...b, text: e.target.value }; set('buttons', bs); }} />
                  {b.type === 'URL' && (
                    <input className={`${inputInlineCls} flex-1 min-w-[160px]`} placeholder="https://…" value={b.url || ''}
                      onChange={e => { const bs = [...form.buttons]; bs[i] = { ...b, url: e.target.value }; set('buttons', bs); }} />
                  )}
                  <button type="button" onClick={() => set('buttons', form.buttons.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-600 cursor-pointer"><X className="w-4 h-4" /></button>
                </div>
              ))}
              {form.buttons.length < 3 && (
                <button type="button" onClick={() => set('buttons', [...form.buttons, { type: 'QUICK_REPLY', text: '' }])} className="text-xs text-wa-teal font-semibold cursor-pointer">+ Add button</button>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="text-xs font-semibold text-slate-700">Preview</div>
          <TemplatePreview
            headerFormat={form.headerText ? 'TEXT' : null}
            headerText={exampleFill(form.headerText, headerVars, [form.headerExample])}
            bodyText={exampleFill(form.bodyText, bodyVars, form.bodyExamples)}
            footerText={form.footerText}
            buttons={form.buttons}
          />
          <div className="text-xs text-slate-500 leading-relaxed">
            Meta reviews every template. Avoid health or cure claims, ALL CAPS and misleading urgency, which are common reasons for rejection.
          </div>
          {error && <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>}
          <div className="flex gap-2">
            <button type="submit" className={btnPrimary} disabled={busy}><Send className="w-3.5 h-3.5" /> {busy ? 'Submitting…' : 'Submit for approval'}</button>
            <button type="button" onClick={onCancel} className={btnSecondary}>Cancel</button>
          </div>
        </div>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

interface CampaignsTabProps {
  templates: Template[]; account: BroadcastAccount | null; isOwner: boolean; showToast: ShowToast; goToTemplates: () => void;
  /** Tells the page a create form is open (the guide then shrinks). */
  onForm?: (open: boolean) => void;
}

function CampaignsTab({ templates, account, isOwner, showToast, goToTemplates, onForm }: CampaignsTabProps) {
  const [view, setView] = useState<CampaignView>({ mode: 'list' }); // list | new | detail
  useEffect(() => { onForm?.(view.mode === 'new'); }, [view.mode, onForm]);
  // Refresh (while visible) only when something is sending.
  const listQuery = useApi<{ campaigns: Campaign[] }>('/api/campaigns', {
    refetchInterval: (q) => (view.mode === 'list' && (q.state.data?.campaigns || []).some(c => c.status === 'sending') ? REFRESH.campaigns : false),
  });
  const campaigns: Campaign[] = listQuery.data?.campaigns || NONE;
  const error = errorOf(listQuery);
  const loading = listQuery.isFetching;
  const load = () => refreshApi('/api/campaigns');
  const numbers = useBusinessNumbers();

  if (view.mode === 'new') {
    return (
      <NewCampaignForm
        templates={templates}
        account={account}
        showToast={showToast}
        goToTemplates={goToTemplates}
        onCancel={() => setView({ mode: 'list' })}
        onCreated={(id) => { load(); setView({ mode: 'detail', id }); }}
      />
    );
  }
  if (view.mode === 'detail') {
    return <CampaignDetail id={view.id} isOwner={isOwner} showToast={showToast} onBack={() => { setView({ mode: 'list' }); load(); }} />;
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <div>
          <div className="text-sm font-semibold text-slate-800">Broadcast campaigns <span className="text-slate-400 font-normal">({campaigns.length})</span></div>
          <div className="text-xs text-slate-500">WhatsApp messages you send to your own contacts. Not ads: those are on the Ads page.</div>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className={btnSecondary} disabled={loading}><RotateCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
          {isOwner && <button onClick={() => setView({ mode: 'new' })} className={btnPrimary}><Plus className="w-3.5 h-3.5" /> New broadcast</button>}
        </div>
      </div>

      {error && <LoadError className="m-4" error={error} onRetry={() => listQuery.refetch()} />}
      {!error && !listQuery.data && <div className="p-4"><SkeletonRows rows={3} label="Loading broadcasts" /></div>}
      {!error && campaigns.length === 0 && !loading && (
        <div className="p-8 text-center text-sm text-slate-500">No broadcast campaigns yet.{isOwner ? ' Click "New broadcast" to send your first message to your contacts.' : ''}</div>
      )}

      <div className="divide-y divide-slate-100">
        {campaigns.map(c => {
          const s = c.stats || {};
          return (
            <button key={c.id} onClick={() => setView({ mode: 'detail', id: c.id })} className="w-full text-left px-4 py-3 hover:bg-slate-50 cursor-pointer">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-slate-800">{c.name}</span>
                <Badge value={c.status} />
                <span className="text-xs text-slate-500 font-mono">{c.template_name}</span>
                {numbers.length > 1 && <span className="text-xs px-1.5 py-px rounded border border-sky-200 bg-sky-50 text-sky-800 font-semibold" data-testid="campaign-from">📱 from {numberName(findNumber(numbers, c.phone_number_id))}</span>}
                <span className="ml-auto text-xs text-slate-400">{fmtDate(c.started_at || c.created_at)}</span>
              </div>
              <StatsLine s={s} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StatsLine({ s }: { s: CampaignStats }) {
  const total = Number(s.total || 0);
  return (
    <div className="mt-2">
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden flex">
        <div className="bg-emerald-500" style={{ width: `${pct(s.read, total)}%` }} />
        <div className="bg-teal-400" style={{ width: `${pct(Number(s.delivered) - Number(s.read), total)}%` }} />
        <div className="bg-sky-300" style={{ width: `${pct(Number(s.sent) - Number(s.delivered), total)}%` }} />
        <div className="bg-red-400" style={{ width: `${pct(s.failed, total)}%` }} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5 text-xs text-slate-600">
        <span><Users className="w-3 h-3 inline -mt-0.5" /> {total} recipients</span>
        <span><Check className="w-3 h-3 inline -mt-0.5" /> {s.sent || 0} sent</span>
        <span><CheckCheck className="w-3 h-3 inline -mt-0.5" /> {s.delivered || 0} delivered ({pct(s.delivered, s.sent)}%)</span>
        <span className="text-emerald-700"><Eye className="w-3 h-3 inline -mt-0.5" /> {s.read || 0} read ({pct(s.read, s.delivered)}%)</span>
        <span className="text-indigo-700"><Reply className="w-3 h-3 inline -mt-0.5" /> {s.replied || 0} replied</span>
        {Number(s.failed) > 0 && <span className="text-red-600"><AlertTriangle className="w-3 h-3 inline -mt-0.5" /> {s.failed} failed</span>}
        {Number(s.pending) > 0 && <span className="text-blue-700">{s.pending} waiting to send</span>}
      </div>
    </div>
  );
}

function CampaignDetail({ id, isOwner, showToast, onBack }: { id: string; isOwner: boolean; showToast: ShowToast; onBack: () => void }) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('all');
  const detail = useApi<{ campaign: Campaign; recipients: Recipient[] }>(`/api/campaigns/${id}`, {
    refetchInterval: (q) => (q.state.data?.campaign?.status === 'sending' ? REFRESH.campaigns : false),
  });
  const data = detail.data || null;
  const error = errorOf(detail);
  const load = () => refreshApi('/api/campaigns'); // this campaign and the list

  const act = async (action: 'start' | 'cancel') => {
    if (!data) return;
    const c = data.campaign;
    const total = c.stats?.total || 0;
    const ok = await confirm(action === 'start'
      ? { title: `Send "${c.name}" now?`, body: `It goes to ${total} contacts. Each message is charged by Meta.`, confirmLabel: 'Send now' }
      : { title: `Cancel "${c.name}"?`, body: 'Messages already sent can\'t be recalled; the rest won\'t be sent.', confirmLabel: 'Cancel campaign', cancelLabel: 'Keep sending', danger: true });
    if (!ok) return;
    setBusy(true);
    try {
      await api(`/api/campaigns/${id}/${action}`, { method: 'POST' });
      showToast(action === 'start' ? 'Campaign started' : 'Campaign cancelled');
      load();
    } catch (e) {
      showToast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <div className="space-y-2"><LoadError error={error} onRetry={() => detail.refetch()} /><button onClick={onBack} className={btnSecondary}>Back</button></div>;
  if (!data) return <SkeletonRows rows={5} label="Loading" />;

  const c = data.campaign;
  const s = c.stats || {};
  const rows = data.recipients.filter(r => filter === 'all' ? true : filter === 'replied' ? r.replied_at : r.status === filter);

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <button onClick={onBack} className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1 mb-2 cursor-pointer"><ArrowLeft className="w-3.5 h-3.5" /> All campaigns</button>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-bold text-slate-800">{c.name}</h2>
          <Badge value={c.status} />
          <div className="ml-auto flex gap-2">
            {isOwner && c.status === 'draft' && <button onClick={() => act('start')} disabled={busy} className={btnPrimary}><Play className="w-3.5 h-3.5" /> Send now</button>}
            {isOwner && ['draft', 'sending'].includes(c.status) && <button onClick={() => act('cancel')} disabled={busy} className={btnSecondary}><Ban className="w-3.5 h-3.5" /> Cancel</button>}
            <button onClick={load} className={btnSecondary}><RotateCw className="w-3.5 h-3.5" /></button>
          </div>
        </div>
        <div className="text-xs text-slate-500 mt-1">
          Template <span className="font-mono">{c.template_name}</span> ({c.template_language}) · created by {c.created_by || '–'} {fmtDate(c.created_at)}
          {c.started_at && <> · started {fmtDate(c.started_at)}</>}{c.completed_at && <> · finished {fmtDate(c.completed_at)}</>}
        </div>
        {c.status === 'sending' && <div className="text-xs text-blue-700 mt-2">Sending in batches. The first batch went out straight away, and the rest go out about every minute. You can close this page.</div>}
        <StatsLine s={s} />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl">
        <div className="flex flex-wrap gap-1 px-4 py-2 border-b border-slate-100">
          {['all', 'queued', 'sent', 'delivered', 'read', 'replied', 'failed', 'skipped'].map(f => (
            <button key={f} onClick={() => setFilter(f)} className={`px-2.5 py-1 rounded-md text-xs font-semibold capitalize cursor-pointer ${filter === f ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{f}</button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-slate-500">
              <tr><th className="px-4 py-2 font-medium">Contact</th><th className="px-4 py-2 font-medium">Status</th><th className="px-4 py-2 font-medium">Sent</th><th className="px-4 py-2 font-medium">Read</th><th className="px-4 py-2 font-medium">Replied</th><th className="px-4 py-2 font-medium">Error</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(r => (
                <tr key={r.phone}>
                  <td className="px-4 py-2"><div className="font-medium text-slate-800">{r.name || '–'}</div><div className="text-slate-500 font-mono">+{r.phone}</div></td>
                  <td className="px-4 py-2"><Badge value={r.status} /></td>
                  <td className="px-4 py-2 text-slate-600">{fmtDate(r.sent_at)}</td>
                  <td className="px-4 py-2 text-slate-600">{fmtDate(r.read_at)}</td>
                  <td className="px-4 py-2 text-slate-600">{fmtDate(r.replied_at)}</td>
                  <td className="px-4 py-2 text-red-600 max-w-[260px]">{r.error || ''}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">Nothing here.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}


interface NewCampaignFormProps {
  templates: Template[]; account: BroadcastAccount | null; showToast: ShowToast; goToTemplates: () => void;
  onCancel: () => void; onCreated: (id: string) => void;
}

function NewCampaignForm({ templates, account, showToast, goToTemplates, onCancel, onCreated }: NewCampaignFormProps) {
  const confirm = useConfirm();
  // Several WhatsApp numbers: choose the sender; its WhatsApp Business Account's templates are offered.
  const numbers = useBusinessNumbers();
  const [fromId, setFromId] = useState('');
  const fromExtra = numbers.length > 1 && numbers.some(n => n.id === fromId && !n.main) ? fromId : '';
  const fromTemplates = useApi<{ templates: Template[] }>(fromExtra ? `/api/templates?number=${fromExtra}` : null).data?.templates;
  const source = fromExtra ? (fromTemplates || NO_TEMPLATES) : templates;
  const approved = useMemo(() => source.filter(t => t.status === 'APPROVED'), [source]);
  const [name, setName] = useState('');
  const [templateKey, setTemplateKey] = useState('');
  const [variables, setVariables] = useState<Variables>({ header: [], body: [], headerMediaUrl: '' });
  const [segment, setSegment] = useState<Segment>({ mode: 'filter', sources: [], activeWithinDays: '', tags: [], phones: '' });
  const [preview, setPreview] = useState<AudiencePreview | null>(null);
  const [testTo, setTestTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const template = approved.find(t => `${t.name}|${t.language}` === templateKey);
  const needs = template ? templateNeeds(template) : null;

  const options = useApi<AudienceOptions>('/api/audience/options').data || NO_OPTIONS;

  // Live audience count.
  useEffect(() => {
    const t = setTimeout(() => {
      api<AudiencePreview>('/api/audience/preview', { method: 'POST', body: { segment } })
        .then(setPreview)
        .catch(() => setPreview(null));
    }, 400);
    return () => clearTimeout(t);
  }, [segment]);

  const pickTemplate = (key: string) => {
    setTemplateKey(key);
    const t = approved.find(x => `${x.name}|${x.language}` === key);
    const n = t ? templateNeeds(t) : null;
    setVariables({
      header: (n?.headerVars || []).map(() => ({ type: 'contact_name', fallback: 'there' })),
      body: (n?.bodyVars || []).map((_, i) => (i === 0 ? { type: 'contact_name', fallback: 'there' } : { type: 'text', value: '' })),
      headerMediaUrl: '',
    });
  };

  const fill = (text: string, vars: string[], specs: VariableSpec[]) => vars.reduce((acc, k, i) => {
    const s = specs[i];
    const v = !s ? `{{${k}}}` : s.type === 'contact_name' ? 'Ravi' : (s.value || `{{${k}}}`);
    return acc.split(`{{${k}}}`).join(v);
  }, text);

  const payload = (sendNow: boolean) => ({
    name: name.trim(),
    templateName: template?.name,
    language: template?.language,
    variables,
    segment: segment.mode === 'list' ? { mode: 'list', phones: segment.phones } : {
      mode: 'filter',
      sources: segment.sources,
      tags: segment.tags,
      activeWithinDays: segment.activeWithinDays ? Number(segment.activeWithinDays) : null,
    },
    sendNow,
    ...(fromExtra ? { fromNumberId: fromExtra } : {}),
  });

  const sendTest = async () => {
    setError('');
    try {
      await api('/api/campaigns/test', { method: 'POST', body: { to: testTo, templateName: template?.name, language: template?.language, variables, ...(fromExtra ? { fromNumberId: fromExtra } : {}) } });
      showToast(`Test sent to +${testTo.replace(/\D/g, '')}`);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const submit = async (sendNow: boolean) => {
    setError('');
    if (!template) return setError('Pick an approved template.');
    if (sendNow && !(await confirm({ title: `Send "${name}" now?`, body: `It goes to ${preview?.count ?? '?'} contacts. Each message is charged by Meta.`, confirmLabel: 'Send now' }))) return;
    setBusy(true);
    try {
      const d = await api<{ recipients: number; campaign: Campaign }>('/api/campaigns', { method: 'POST', body: payload(sendNow) });
      showToast(sendNow ? `Sending to ${d.recipients} contacts…` : `Draft saved with ${d.recipients} recipients`);
      onCreated(d.campaign.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (key: 'sources' | 'tags', value: string) => setSegment(s => ({ ...s, [key]: s[key].includes(value) ? s[key].filter(v => v !== value) : [...s[key], value] }));
  const overLimit = !!account?.dailyLimit && (preview?.count ?? 0) > account.dailyLimit;

  // Step by step (U3): 1 Message, 2 Who gets it, 3 Check and send. The phone preview stays on the right.
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const stepOk = { 1: !!name.trim() && !!template, 2: !!preview?.count, 3: true };
  const stepWhy: Record<1 | 2 | 3, string> = { 1: !name.trim() ? 'Give the campaign a name.' : !template ? 'Choose an approved template.' : '', 2: preview && !preview.count ? 'Nobody matches yet: change who gets it.' : '', 3: '' };
  const STEPS = [[1, 'Message'], [2, 'Who gets it'], [3, 'Check and send']] as const;

  if (approved.length === 0 && !fromExtra) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6 text-sm text-slate-600 space-y-3">
        <div>You need at least one <strong>approved</strong> template before you can send a campaign.</div>
        <div className="flex gap-2">
          <button onClick={goToTemplates} className={btnPrimary}><FileText className="w-3.5 h-3.5" /> Go to templates</button>
          <button onClick={onCancel} className={btnSecondary}>Back</button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <div className="text-sm font-semibold text-slate-800">New broadcast campaign</div>
        <button onClick={onCancel} aria-label="Close" className="text-slate-400 hover:text-slate-700 cursor-pointer"><X className="w-4 h-4" /></button>
      </div>
      <ol className="flex items-center gap-2 px-4 pt-3 text-xs" aria-label="Steps" data-testid="campaign-steps">
        {STEPS.map(([n, label], i) => {
          const reachable = n === 1 || (n === 2 && stepOk[1]) || (n === 3 && stepOk[1] && stepOk[2]);
          return (
            <li key={n} className="flex items-center gap-2">
              {i > 0 && <span className="w-6 h-px bg-slate-300" aria-hidden="true" />}
              <button type="button" disabled={!reachable} onClick={() => setStep(n)} aria-current={step === n ? 'step' : undefined}
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold cursor-pointer disabled:cursor-not-allowed ${step === n ? 'bg-wa-teal text-white' : reachable ? 'bg-teal-50 text-wa-teal' : 'bg-slate-100 text-slate-400'}`}>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-2xs ${step === n ? 'bg-white/25' : 'bg-white'}`}>{n}</span>{label}
              </button>
            </li>
          );
        })}
      </ol>
      <div className="grid md:grid-cols-[1fr_340px] gap-6 p-4">
        <div className="space-y-5">
          {step === 1 && (<>
          <Field label="Campaign name" hint="Only you see this">
            <input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="Weekend offer – Nov" />
          </Field>

          {numbers.length > 1 && (
            <Field label="Send from" hint="Customers see this number; their replies arrive in its chat">
              <select className={inputCls} value={fromExtra} data-testid="broadcast-from"
                onChange={e => { setFromId(e.target.value); setTemplateKey(''); }}>
                {numbers.map(n => <option key={n.id} value={n.main ? '' : n.id}>{numberName(n)}{n.main ? ' (main number)' : ''}</option>)}
              </select>
            </Field>
          )}

          <Field label="Template">
            <select className={inputCls} value={templateKey} onChange={e => pickTemplate(e.target.value)}>
              <option value="">Choose an approved template…</option>
              {approved.map(t => <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>{t.name} ({t.language}, {t.category.toLowerCase()})</option>)}
            </select>
            {fromExtra && fromTemplates && approved.length === 0 && (
              <div className="text-xs text-amber-800 mt-1">This number&apos;s WhatsApp account has no approved templates yet. Create them in Meta for that account, or send from another number.</div>
            )}
          </Field>

          {needs && (needs.headerVars.length > 0 || needs.bodyVars.length > 0 || (needs.headerFormat && needs.headerFormat !== 'TEXT')) && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-700">Fill in the blanks</div>
              {needs.headerFormat && needs.headerFormat !== 'TEXT' && (
                <Field label={`Header ${needs.headerFormat.toLowerCase()} link`} hint="A public https:// link to the file">
                  <input className={inputCls} value={variables.headerMediaUrl} onChange={e => setVariables(v => ({ ...v, headerMediaUrl: e.target.value }))} placeholder="https://…" />
                </Field>
              )}
              {needs.headerVars.map((k, i) => (
                <VariableInput key={`h${k}`} label={`Header {{${k}}}`} spec={variables.header[i]}
                  onChange={s => setVariables(v => { const h = [...v.header]; h[i] = s; return { ...v, header: h }; })} />
              ))}
              {needs.bodyVars.map((k, i) => (
                <VariableInput key={`b${k}`} label={`Body {{${k}}}`} spec={variables.body[i]}
                  onChange={s => setVariables(v => { const b = [...v.body]; b[i] = s; return { ...v, body: b }; })} />
              ))}
            </div>
          )}
          </>)}

          {step === 2 && (
          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-700">Who gets it</div>
            <div className="flex gap-2">
              {([['filter', 'From my contacts'], ['list', 'Paste numbers']] as const).map(([m, label]) => (
                <button key={m} type="button" onClick={() => setSegment(s => ({ ...s, mode: m }))}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer ${segment.mode === m ? 'bg-wa-teal text-white border-wa-teal' : 'bg-white text-slate-600 border-slate-300'}`}>{label}</button>
              ))}
            </div>

            {segment.mode === 'filter' ? (
              <div className="bg-slate-50 rounded-lg p-3 space-y-3">
                <div>
                  <div className="text-xs font-semibold text-slate-600 mb-1">Where they came from <span className="font-normal text-slate-400">(none ticked = everyone)</span></div>
                  <div className="flex flex-wrap gap-2">
                    {options.sources.length === 0 && <span className="text-xs text-slate-400">No sources recorded yet</span>}
                    {options.sources.map(src => (
                      <label key={src} className="flex items-center gap-1.5 text-xs bg-white border border-slate-200 rounded-md px-2 py-1 cursor-pointer">
                        <input type="checkbox" checked={segment.sources.includes(src)} onChange={() => toggle('sources', src)} /> {src}
                      </label>
                    ))}
                  </div>
                </div>
                {options.tags.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-slate-600 mb-1">Tags</div>
                    <div className="flex flex-wrap gap-2">
                      {options.tags.map(tag => (
                        <label key={tag} className="flex items-center gap-1.5 text-xs bg-white border border-slate-200 rounded-md px-2 py-1 cursor-pointer">
                          <input type="checkbox" checked={segment.tags.includes(tag)} onChange={() => toggle('tags', tag)} /> {tag}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <div className="text-xs font-semibold text-slate-600 mb-1">Last chatted</div>
                  <select className={`${inputInlineCls} w-56`} value={segment.activeWithinDays} onChange={e => setSegment(s => ({ ...s, activeWithinDays: e.target.value }))}>
                    <option value="">Any time</option>
                    <option value="7">In the last 7 days</option>
                    <option value="30">In the last 30 days</option>
                    <option value="90">In the last 90 days</option>
                  </select>
                </div>
              </div>
            ) : (
              <textarea className={`${inputCls} min-h-[100px] font-mono`} value={segment.phones} onChange={e => setSegment(s => ({ ...s, phones: e.target.value }))}
                placeholder={'One number per line, with country code\n919876543210\n919123456789'} />
            )}

            <div className={`rounded-lg px-3 py-2 text-xs ${overLimit ? 'bg-amber-50 text-amber-900 border border-amber-200' : 'bg-emerald-50 text-emerald-900'}`}>
              {preview ? (
                <>
                  <strong>{preview.count}</strong> {preview.count === 1 ? 'person' : 'people'} will get this.
                  {(preview.optedOutExcluded ?? 0) > 0 && <> {preview.optedOutExcluded} opted-out contact{preview.optedOutExcluded === 1 ? '' : 's'} excluded.</>}
                  {(preview.notInContacts ?? 0) > 0 && <> {preview.notInContacts} pasted number{preview.notInContacts === 1 ? ' is' : 's are'} not in your contacts. Only message people who agreed to hear from you.</>}
                  {overLimit && <div className="mt-1">⚠️ That's more than your current daily limit of {account.dailyLimit}. Messages over the limit will fail. Send to a smaller group, or split it across days.</div>}
                </>
              ) : 'Counting…'}
            </div>
          </div>
          )}

          {step === 3 && (
            <div className="space-y-3" data-testid="campaign-summary">
              <div className="text-xs font-semibold text-slate-700">Check before sending</div>
              <dl className="bg-slate-50 rounded-lg p-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                <dt className="text-slate-500">Name</dt><dd className="text-slate-800">{name}</dd>
                {numbers.length > 1 && <><dt className="text-slate-500">From</dt><dd className="text-slate-800">{numberName(numbers.find(n => (n.main ? '' : n.id) === fromExtra) || numbers[0])}</dd></>}
                <dt className="text-slate-500">Template</dt><dd className="text-slate-800">{template?.name} ({template?.language})</dd>
                <dt className="text-slate-500">Goes to</dt><dd className="text-slate-800"><strong>{preview?.count ?? 0}</strong> {preview?.count === 1 ? 'person' : 'people'}{segment.mode === 'list' ? ' (pasted numbers)' : ''}</dd>
                <dt className="text-slate-500">Cost</dt><dd className="text-slate-800">about ₹{((preview?.count ?? 0) * 1.05).toFixed(0)} (Meta, ~₹1.05 per delivered marketing message in India)</dd>
              </dl>
              {overLimit && <div className="rounded-lg px-3 py-2 text-xs bg-amber-50 text-amber-900 border border-amber-200">⚠️ More than your daily limit of {account.dailyLimit}. Messages over the limit will fail.</div>}
              <div className="bg-slate-50 rounded-lg p-3 space-y-2">
                <div className="text-xs font-semibold text-slate-600 flex items-center gap-1"><FlaskConical className="w-3.5 h-3.5" /> Send yourself a test first</div>
                <div className="flex gap-2">
                  <input className={inputCls} value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="919876543210" aria-label="Test number" />
                  <button type="button" onClick={sendTest} className={btnSecondary} disabled={!testTo}>Test</button>
                </div>
              </div>
            </div>
          )}

          {error && <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>}

          {/* Step buttons */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {step > 1 && <button type="button" onClick={() => setStep(s => (s - 1) as 1 | 2 | 3)} className={btnSecondary}>Back</button>}
            {step < 3 && (
              <button type="button" onClick={() => setStep(s => (s + 1) as 1 | 2 | 3)} disabled={!stepOk[step]} className={btnPrimary}>Next</button>
            )}
            {step < 3 && !stepOk[step] && stepWhy[step] && <span className="text-xs text-slate-500">{stepWhy[step]}</span>}
            {step === 3 && (
              <>
                <button onClick={() => submit(true)} disabled={busy || !preview?.count || !name.trim() || !template} className={btnPrimary}>
                  <Send className="w-3.5 h-3.5" /> {busy ? 'Working…' : `Send to ${preview?.count ?? 0}`}
                </button>
                <button onClick={() => submit(false)} disabled={busy || !preview?.count || !name.trim() || !template} className={btnSecondary}>Save as draft</button>
              </>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <div className="text-xs font-semibold text-slate-700">What the customer sees</div>
          {needs ? (
            <TemplatePreview
              headerFormat={needs.headerFormat}
              headerText={fill(needs.headerText, needs.headerVars, variables.header)}
              bodyText={fill(needs.bodyText, needs.bodyVars, variables.body)}
              footerText={needs.footerText}
              buttons={needs.buttons}
            />
          ) : <div className="bg-slate-50 rounded-xl p-6 text-xs text-slate-400 text-center">Pick a template to preview</div>}

          <div className="text-xs text-slate-500 leading-relaxed">
            Contacts who reply STOP are unsubscribed automatically and are never included. Meta charges per delivered template message (about ₹1.05 each for marketing in India).
          </div>
        </div>
      </div>
    </div>
  );
}