import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useConfirm } from './confirm';
import { Navigate, NavLink, useLocation, useNavigate } from 'react-router';
import { PLATFORM_TABS, PLATFORM_HOME, PLATFORM_ROLE_LABEL, canOpenPlatformTab, type PlatformRole, type PlatformTab } from './appRoutes';
import { Building2, Plus, Layers, ShieldCheck, ShieldOff, Smartphone, PauseCircle, PlayCircle, Save, RefreshCw, Lock, LifeBuoy, Activity, ScrollText, Cpu, Send, History, Info, Wrench, UserPlus, Palette, UsersRound, ClipboardCheck, LayoutDashboard, type LucideIcon } from 'lucide-react';
import PlatformSignups from './PlatformSignups';
import PlatformBranding from './PlatformBranding';
import PlatformTeam from './PlatformTeam';
import PlatformOnboarding from './PlatformOnboarding';
import { MaintenancePanel, MaintenanceStrip, type MaintenanceState } from './Maintenance';
import { api, errorMessage, inputCls, inputInlineCls, btnPrimary, btnSecondary } from './broadcastUtils';
import PlatformSupport from './PlatformSupport';
import { SignOutButton } from './AuthGate';
import { AlertsBanner, HealthPanel, EventsPanel, WorkerPanel, DeliveryPanel, AuditPanel, BusinessDrawer } from './PlatformMonitor';
import type { HealthWithAlerts, LimitKey, Plan, PlatformBusiness, PlatformOverview } from './platformTypes';
import type { ShowToast } from './types';

type Tab = PlatformTab;

// The console menu in groups (U5): what the Platform Admin looks after, not a strip of 11 tabs.
// Each platform role sees only its own tabs (canOpenPlatformTab); the Platform Owner's Health tab already has the overview.
const GROUPS: Array<[string, Tab[]]> = [
  ['Overview', ['health', 'overview']],
  ['Customers', ['businesses', 'onboarding', 'signups', 'plans', 'support']],
  ['System', ['events', 'worker', 'delivery', 'audit', 'maintenance']],
  ['Brand', ['branding']],
  ['Platform', ['team']],
];
const inMenu = (role: PlatformRole, t: Tab) => canOpenPlatformTab(role, t) && !(role === 'owner' && t === 'overview');
type BizFilter = 'all' | 'active' | 'suspended' | 'due' | 'no_whatsapp';

const TABS: Array<[Tab, string, LucideIcon]> = [
  ['health', 'Health', Activity],
  ['overview', 'Overview', LayoutDashboard],
  ['businesses', 'Businesses', Building2],
  ['onboarding', 'Onboarding', ClipboardCheck],
  ['team', 'Platform team', UsersRound],
  ['signups', 'Sign-ups', UserPlus],
  ['plans', 'Plans', Layers],
  ['branding', 'Branding', Palette],
  ['events', 'Logs', ScrollText],
  ['worker', 'Worker', Cpu],
  ['delivery', 'Delivery', Send],
  ['audit', 'Audit', History],
  ['support', 'Support', LifeBuoy],
  ['maintenance', 'Maintenance', Wrench],
];

const LIMITS: Array<[LimitKey, string]> = [
  ['max_staff', 'Team members'],
  ['max_contacts', 'Contacts'],
  ['max_broadcasts_month', 'Broadcast messages / month'],
  ['max_automations', 'Active follow-ups'],
  ['max_ai_replies_month', 'AI replies / month'],
  ['max_keyword_rules', 'Keyword rules'],
  ['analytics_days', 'Analytics history (days)'],
  ['max_whatsapp_numbers', 'WhatsApp numbers'],
];
const num = (n: number | string | null | undefined) => (n === null || n === undefined ? '–' : Number(n).toLocaleString('en-IN'));

/**
 * The Platform Admin's console: businesses, plans and usage. Counts and settings only:
 * a business's customers and chats are never shown here.
 */
/** base: '/platform'; each tab has its own address, /platform/<tab> (src/appRoutes.ts PLATFORM_TABS). */
export default function PlatformConsole({ base, email, onSignOut }: { base: string; email: string; onSignOut: () => void }) {
  // The platform role comes from the server (/api/platform/me), which also checks it on every request.
  const [me, setMe] = useState<{ role: PlatformRole } | null>(null);
  const [meError, setMeError] = useState('');
  useEffect(() => {
    api<{ role?: PlatformRole }>('/api/platform/me')
      .then(d => setMe({ role: d.role && d.role in PLATFORM_ROLE_LABEL ? d.role : 'owner' }))
      .catch(e => setMeError(errorMessage(e)));
  }, []);
  if (meError) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
        <div className="bg-white rounded-xl shadow p-6 max-w-sm w-full text-center space-y-3">
          <p className="text-sm text-red-700">{meError}</p>
          <div className="flex justify-center"><SignOutButton email={email} onSignOut={onSignOut} /></div>
        </div>
      </div>
    );
  }
  if (!me) return <div className="min-h-screen bg-slate-100 flex items-center justify-center text-sm text-slate-500">Loading…</div>;
  return <Console base={base} email={email} role={me.role} onSignOut={onSignOut} />;
}

function Console({ base, email, role, onSignOut }: { base: string; email: string; role: PlatformRole; onSignOut: () => void }) {
  const { pathname } = useLocation();
  const goTo = useNavigate();
  const seg = pathname.startsWith(`${base}/`) ? pathname.slice(base.length + 1).split('/')[0] : '';
  const tab: Tab | null = (PLATFORM_TABS as readonly string[]).includes(seg) ? seg as Tab : null;
  const setTab = (t: Tab) => goTo(`${base}/${t}`);
  const can = (t: Tab) => canOpenPlatformTab(role, t);
  const isOwner = role === 'owner';
  const [data, setData] = useState<PlatformOverview | null>(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [health, setHealth] = useState<HealthWithAlerts | null>(null);
  const [healthError, setHealthError] = useState('');
  const [openBusiness, setOpenBusiness] = useState<string | null>(null);

  const showToast: ShowToast = (t) => { setToast(t); setTimeout(() => setToast(''), 3500); };
  const load = useCallback(() => api<PlatformOverview>('/api/platform/overview')
    .then(d => { setData(d); setError(''); })
    .catch(e => setError(errorMessage(e))), []);
  // Health + alerts: loaded once here (for the banner); the Health tab refreshes it every minute while visible.
  // Only roles with the Health tab (owner, developer) load it.
  const seesHealth = canOpenPlatformTab(role, 'health');
  const seesSupport = canOpenPlatformTab(role, 'support');
  const loadHealth = useCallback(() => (seesHealth ? api<HealthWithAlerts>('/api/platform/health')
    .then(d => { setHealth(d); setHealthError(''); })
    .catch(e => setHealthError(errorMessage(e))) : Promise.resolve()), [seesHealth]);
  // Maintenance mode: loaded once (and after each change), for the strip and the Maintenance tab.
  const [maintenance, setMaintenance] = useState<MaintenanceState | null>(null);
  const loadMaintenance = useCallback(() => api<{ maintenance: MaintenanceState }>('/api/platform/maintenance')
    .then(d => setMaintenance(d.maintenance))
    .catch(() => setMaintenance({ on: false, message: null, until: null, startedAt: null })), []);
  // Waiting sign-ups and open support queries: counts for the menu badges and the overview (loaded once; Refresh reloads).
  const [waiting, setWaiting] = useState<{ signups: number; support: number; supportOverdue: number } | null>(null);
  // (Sign-ups and support: only roles that handle them, i.e. the owner and Application Managers.)
  const loadWaiting = useCallback(() => (seesSupport ? Promise.all([
    api<{ requests?: unknown[] }>('/api/platform/signup-requests?status=pending').catch(() => ({ requests: [] })),
    api<{ queries?: Array<{ stage: string; overdue?: boolean }> }>('/api/platform/support').catch(() => ({ queries: [] })),
  ]).then(([s, q]) => {
    const open = (q.queries || []).filter(x => !['resolved', 'closed'].includes(x.stage));
    setWaiting({ signups: (s.requests || []).length, support: open.length, supportOverdue: open.filter(x => x.overdue).length });
  }) : Promise.resolve()), [seesSupport]);
  useEffect(() => { load(); loadHealth(); loadMaintenance(); loadWaiting(); }, [load, loadHealth, loadMaintenance, loadWaiting]);
  const refresh = () => { load(); loadHealth(); loadMaintenance(); loadWaiting(); };
  // Overview tiles open the Businesses list already filtered.
  const [bizFilter, setBizFilter] = useState<BizFilter>('all');
  const openBusinesses = (f: BizFilter) => { setBizFilter(f); setTab('businesses'); };
  const badge: Partial<Record<Tab, number>> = { signups: waiting?.signups || 0, support: waiting?.support || 0 };

  // /platform alone, or an unknown tab: this role's first tab.
  if (!tab) return <Navigate to={`${base}/${PLATFORM_HOME[role]}`} replace />;

  return (
    <div className="bg-slate-100 min-h-screen flex flex-col">
      <header className="bg-slate-900 text-white px-4 h-14 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-emerald-400" />
          <span className="font-bold text-base">Platform console</span>
          <span className="hidden sm:inline text-slate-400" data-testid="platform-role">· {PLATFORM_ROLE_LABEL[role]}</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={refresh} className="p-2 text-slate-300 hover:text-white rounded-lg hover:bg-white/10 cursor-pointer" title="Refresh" aria-label="Refresh"><RefreshCw className="w-4 h-4" /></button>
          <SignOutButton email={email} onSignOut={onSignOut} />
        </div>
      </header>

      <div className="flex-1 flex flex-col md:flex-row min-h-0">
      {/* Grouped menu: a side menu on desktop, a scrolling row on phones. */}
      <nav aria-label="Console menu" className="bg-white border-b md:border-b-0 md:border-r border-slate-200 md:w-56 flex-shrink-0 overflow-x-auto" data-testid="console-menu">
        <div className="flex md:flex-col gap-0.5 p-2 w-max md:w-auto">
          {GROUPS.map(([title, all]) => [title, all.filter(t => inMenu(role, t))] as const).filter(([, ids]) => ids.length > 0).map(([title, ids]) => (
            <div key={title} className="flex md:flex-col gap-0.5 md:mb-3">
              <div className="hidden md:block px-3 pt-2 pb-1 text-xs font-bold uppercase tracking-wider text-slate-400">{title}</div>
              {ids.map(id => {
                const [, label, Icon] = TABS.find(t => t[0] === id) || [id, id, Activity];
                return (
                  <NavLink key={id} to={`${base}/${id}`} aria-label={label}
                    className={`px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 whitespace-nowrap cursor-pointer ${tab === id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                    <Icon className="w-4 h-4" aria-hidden="true" /> {label}
                    {!!badge[id] && <span className={`ml-auto min-w-[1.25rem] text-center rounded-full px-1.5 text-2xs font-bold ${tab === id ? 'bg-white text-slate-900' : 'bg-amber-400 text-slate-900'}`} data-testid={`console-badge-${id}`}>{badge[id]}</span>}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </div>
      </nav>

      <main className="flex-1 min-w-0 max-w-6xl w-full mx-auto px-4 py-5 space-y-4">
        <div className="p-3 bg-white border border-slate-200 rounded-xl text-xs text-slate-600 flex gap-2">
          <Lock className="w-4 h-4 text-slate-500 flex-shrink-0" />
          You see counts and settings only. Each business's customers, chats and messages stay private to that business.
        </div>
        {tab !== 'maintenance' && <MaintenanceStrip state={maintenance} onOpen={() => setTab(can('maintenance') ? 'maintenance' : tab)} />}
        {tab !== 'health' && seesHealth && <AlertsBanner alerts={health?.alerts} onOpenBusiness={setOpenBusiness} />}
        {!can(tab) ? <TabNotAllowed role={role} home={`${base}/${PLATFORM_HOME[role]}`} /> : (
          <>
            {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>}
            {!data && !error && ['overview', 'businesses', 'signups', 'plans'].includes(tab) && <div className="text-sm text-slate-500">Loading…</div>}
            {(tab === 'overview' || (tab === 'health' && isOwner)) && data && <OverviewStrip data={data} waiting={waiting} onBusinesses={openBusinesses} onTab={setTab} />}
            {tab === 'health' && <HealthPanel data={health} error={healthError} reload={loadHealth} onOpenBusiness={setOpenBusiness} />}
            {data && tab === 'businesses' && <Businesses key={bizFilter} data={data} reload={load} showToast={showToast} onOpen={setOpenBusiness} initialFilter={bizFilter} canEdit={isOwner} canCreate={can('signups')} />}
            {tab === 'onboarding' && <PlatformOnboarding showToast={showToast} onOpenBusiness={setOpenBusiness} />}
            {data && tab === 'signups' && <PlatformSignups plans={data.plans} showToast={showToast} onApproved={load} />}
            {data && tab === 'plans' && <Plans plans={data.plans} reload={load} showToast={showToast} />}
            {tab === 'branding' && <PlatformBranding showToast={showToast} />}
            {tab === 'events' && <EventsPanel businesses={data?.businesses} />}
            {tab === 'worker' && <WorkerPanel />}
            {tab === 'delivery' && <DeliveryPanel onOpenBusiness={setOpenBusiness} />}
            {tab === 'audit' && <AuditPanel businesses={data?.businesses} />}
            {tab === 'support' && <PlatformSupport me={{ email }} showToast={showToast} />}
            {tab === 'maintenance' && <MaintenancePanel key={String(maintenance?.on)} state={maintenance} onChanged={setMaintenance} showToast={showToast} />}
            {tab === 'team' && <PlatformTeam me={{ email }} showToast={showToast} />}
          </>
        )}
      </main>
      </div>

      {openBusiness && (
        <BusinessDrawer id={openBusiness} plans={data?.plans || []} onClose={() => setOpenBusiness(null)} onChanged={refresh} showToast={showToast} canEdit={isOwner} canResendInvite={can('onboarding')} />
      )}

      {toast && <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-xs px-4 py-2 rounded-lg shadow-lg">{toast}</div>}
    </div>
  );
}

/** A console tab this platform role may not open (typed address or old bookmark). The server refuses its data too. */
function TabNotAllowed({ role, home }: { role: PlatformRole; home: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 text-center space-y-2" data-testid="platform-tab-not-allowed">
      <ShieldOff className="w-8 h-8 text-slate-400 mx-auto" />
      <h1 className="text-lg font-bold text-slate-800">Not allowed for your role</h1>
      <p className="text-sm text-slate-600">As {PLATFORM_ROLE_LABEL[role]} you can&apos;t open this part of the console. Ask the Platform Owner if you need it.</p>
      <NavLink to={home} className="inline-block text-sm font-semibold text-wa-teal hover:underline">Go to my console</NavLink>
    </div>
  );
}

/** Overview (U5): the platform at a glance; every tile opens the place to act. Counts only. */
function OverviewStrip({ data, waiting, onBusinesses, onTab }: {
  data: PlatformOverview; waiting: { signups: number; support: number; supportOverdue: number } | null;
  onBusinesses: (f: BizFilter) => void; onTab: (t: Tab) => void;
}) {
  const b = data.businesses;
  const tiles: Array<{ label: string; value: number; warn?: boolean; go: () => void; testId: string }> = [
    { label: 'Active businesses', value: b.filter(x => x.status !== 'suspended').length, go: () => onBusinesses('active'), testId: 'ov-active' },
    { label: 'Paused', value: b.filter(x => x.status === 'suspended').length, go: () => onBusinesses('suspended'), testId: 'ov-paused' },
    { label: 'Payment due', value: b.filter(x => x.billing?.state === 'due').length, warn: true, go: () => onBusinesses('due'), testId: 'ov-due' },
    { label: 'WhatsApp not connected', value: b.filter(x => !x.whatsapp.connected).length, warn: true, go: () => onBusinesses('no_whatsapp'), testId: 'ov-no-wa' },
    { label: 'Sign-ups waiting', value: waiting?.signups ?? 0, warn: true, go: () => onTab('signups'), testId: 'ov-signups' },
    { label: waiting?.supportOverdue ? `Open support (${waiting.supportOverdue} overdue)` : 'Open support queries', value: waiting?.support ?? 0, warn: !!waiting?.supportOverdue, go: () => onTab('support'), testId: 'ov-support' },
  ];
  return (
    <section aria-label="Overview" data-testid="console-overview">
      <h1 className="text-xl font-bold text-slate-800 mb-2">Overview</h1>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        {tiles.map(t => (
          <button key={t.label} onClick={t.go} data-testid={t.testId}
            className={`text-left bg-white border rounded-xl p-3 hover:border-slate-400 cursor-pointer ${t.warn && t.value > 0 ? 'border-amber-300' : 'border-slate-200'}`}>
            <div className={`text-2xl font-bold ${t.warn && t.value > 0 ? 'text-amber-700' : 'text-slate-800'}`}>{t.value}</div>
            <div className="text-xs text-slate-500 leading-tight">{t.label}</div>
          </button>
        ))}
      </div>
    </section>
  );
}

/** canEdit: plan, paid-until, suspend (Platform Owner). canCreate: "New business" (owner + Application Managers). */
interface BusinessesProps { data: PlatformOverview; reload: () => void; showToast: ShowToast; onOpen: (id: string) => void; initialFilter?: BizFilter; canEdit?: boolean; canCreate?: boolean }

const BIZ_FILTERS: Array<[BizFilter, string]> = [['all', 'All'], ['active', 'Active'], ['suspended', 'Paused'], ['due', 'Payment due'], ['no_whatsapp', 'No WhatsApp']];
type BizSort = 'newest' | 'name' | 'contacts' | 'messages';

function Businesses({ data, reload, showToast, onOpen, initialFilter = 'all', canEdit = true, canCreate = true }: BusinessesProps) {
  const confirm = useConfirm();
  const [creating, setCreating] = useState(false);
  // Find a business quickly (U5): search, filters and sort, all in the browser (the list is already loaded).
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<BizFilter>(initialFilter);
  const [sort, setSort] = useState<BizSort>('newest');
  const term = search.trim().toLowerCase();
  const shown = data.businesses
    .filter(b => !term || b.name.toLowerCase().includes(term) || String(b.slug || '').toLowerCase().includes(term))
    .filter(b => filter === 'all' || (filter === 'active' && b.status !== 'suspended') || (filter === 'suspended' && b.status === 'suspended')
      || (filter === 'due' && b.billing?.state === 'due') || (filter === 'no_whatsapp' && !b.whatsapp.connected))
    .sort((a, z) => (sort === 'name' ? a.name.localeCompare(z.name)
      : sort === 'contacts' ? Number(z.counts.contacts || 0) - Number(a.counts.contacts || 0)
      : sort === 'messages' ? Number(z.counts.messagesThisMonth || 0) - Number(a.counts.messagesThisMonth || 0)
      : String(z.created_at).localeCompare(String(a.created_at))));
  const [form, setForm] = useState({ name: '', planId: 'starter', adminEmail: '' });
  const [busy, setBusy] = useState('');

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('create');
    try {
      const r = await api<{ business: { name: string }; invited: boolean; adminEmail: string }>('/api/platform/businesses', { method: 'POST', body: form });
      showToast(r.invited ? `${r.business.name} created. Invite sent to ${r.adminEmail}.` : `${r.business.name} created. ${r.adminEmail} already had a login and can sign in now.`);
      setForm({ name: '', planId: 'starter', adminEmail: '' });
      setCreating(false);
      reload();
    } catch (err) {
      showToast(errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  const update = async (b: PlatformBusiness, body: Record<string, unknown>, msg: string) => {
    setBusy(b.id);
    try {
      await api(`/api/platform/businesses/${b.id}`, { method: 'PATCH', body });
      showToast(msg);
      reload();
    } catch (err) {
      showToast(errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Building2 className="w-5 h-5 text-slate-700" /> Businesses ({data.businesses.length})</h1>
        {canCreate && <button onClick={() => setCreating(c => !c)} className={btnPrimary}><Plus className="w-3.5 h-3.5" /> New business</button>}
      </div>

      {creating && canCreate && (
        <form onSubmit={create} className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <div className="text-sm font-semibold text-slate-800">New business</div>
          <div className="grid sm:grid-cols-3 gap-3">
            <label className="text-xs font-medium text-slate-700">Business name
              <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Mayura Hospitals" className={`${inputCls} mt-1`} />
            </label>
            <label className="text-xs font-medium text-slate-700">Plan
              <select value={form.planId} onChange={e => setForm(f => ({ ...f, planId: e.target.value }))} className={`${inputCls} mt-1`}>
                {data.plans.map(p => <option key={p.id} value={p.id}>{p.name}{Number(p.price_monthly_inr) ? ` (₹${num(p.price_monthly_inr)}/month)` : ''}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-700">Business Admin's email
              <input required type="email" value={form.adminEmail} onChange={e => setForm(f => ({ ...f, adminEmail: e.target.value }))} placeholder="admin@business.com" className={`${inputCls} mt-1`} />
            </label>
          </div>
          <div className="text-xs text-slate-500">They get an invite email to set a password. Then they connect their WhatsApp number and set up their bot. Someone who already works for another business can't be the admin.</div>
          <div className="flex gap-2">
            <button type="submit" disabled={busy === 'create'} className={btnPrimary}>{busy === 'create' ? 'Creating…' : 'Create and invite'}</button>
            <button type="button" onClick={() => setCreating(false)} className={btnSecondary}>Cancel</button>
          </div>
        </form>
      )}

      <div className="bg-white border border-slate-200 rounded-xl px-3 py-2 flex flex-wrap items-center gap-2" data-testid="business-filters">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name" aria-label="Search businesses" className={`${inputInlineCls} w-56`} />
        <div className="flex rounded-full border border-slate-200 overflow-hidden" role="group" aria-label="Show">
          {BIZ_FILTERS.map(([v, l]) => (
            <button key={v} onClick={() => setFilter(v)} aria-pressed={filter === v}
              className={`px-3 py-1 text-xs font-semibold cursor-pointer ${filter === v ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>{l}</button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-600">Sort
          <select value={sort} onChange={e => setSort(e.target.value as BizSort)} className={inputInlineCls}>
            <option value="newest">Newest first</option>
            <option value="name">Name</option>
            <option value="contacts">Most contacts</option>
            <option value="messages">Most messages this month</option>
          </select>
        </label>
        <span className="text-xs text-slate-400">{shown.length} shown</span>
      </div>
      {shown.length === 0 && <div className="bg-white border border-dashed border-slate-300 rounded-xl p-6 text-center text-sm text-slate-500">No business matches. Change the search or the filter.</div>}

      <div className="grid gap-3">
        {shown.map(b => {
          const suspended = b.status === 'suspended';
          return (
            <div key={b.id} className={`bg-white border rounded-xl p-4 ${suspended ? 'border-red-200 opacity-80' : 'border-slate-200'}`}>
              <div className="flex flex-wrap items-start gap-3">
                <div className="flex-1 min-w-[200px]">
                  <div className="text-sm font-bold text-slate-800 flex items-center gap-2">
                    <button onClick={() => onOpen(b.id)} className="hover:underline cursor-pointer text-left" title="Details">{b.name}</button>
                    <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded-full ${suspended ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-800'}`}>{b.status}</span>
                    {b.billing?.state === 'due' && <span className="text-xs font-bold uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">payment due · pauses {b.billing.suspendOn}</span>}
                  </div>
                  <div className="text-xs text-slate-500">{b.slug} · since {new Date(b.created_at).toLocaleDateString()}</div>
                  <div className={`text-xs mt-1 flex items-center gap-1 ${b.whatsapp.connected ? 'text-emerald-700' : 'text-amber-700'}`}>
                    <Smartphone className="w-3 h-3" />
                    {b.whatsapp.connected ? `WhatsApp connected${b.whatsapp.phoneNumber ? `: +${b.whatsapp.phoneNumber}` : ''}` : 'WhatsApp not connected yet'}
                    {(b.whatsapp.numbers ?? 0) > 1 && <span className="text-slate-500" data-testid="business-numbers"> · {b.whatsapp.numbers} numbers</span>}
                  </div>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 text-center text-xs text-slate-500">
                  <Stat label="Team" value={b.counts.staff} limit={b.limits?.max_staff} />
                  <Stat label="Contacts" value={b.counts.contacts} limit={b.limits?.max_contacts} />
                  <Stat label="Messages (month)" value={b.counts.messagesThisMonth} />
                  <Stat label="Broadcasts (month)" value={b.usage.broadcastsSent} limit={b.limits?.max_broadcasts_month} />
                  <Stat label={b.limits && !b.limits.ai_enabled ? 'AI (not in plan)' : 'AI replies (month)'} value={b.usage.aiReplies} limit={b.limits?.ai_enabled ? b.limits.max_ai_replies_month : undefined} />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-slate-100 text-xs">
                {canEdit ? (
                  <>
                    <label className="flex items-center gap-1.5 text-slate-600">Plan
                      <select value={b.plan_id} disabled={busy === b.id} onChange={e => update(b, { planId: e.target.value }, `${b.name} is now on ${e.target.value}`)} className={inputInlineCls}>
                        {data.plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </label>
                    <label className="flex items-center gap-1.5 text-slate-600">Paid until
                      <input type="date" defaultValue={b.paid_until || ''} disabled={busy === b.id}
                        onBlur={e => { if ((e.target.value || null) !== (b.paid_until || null)) update(b, { paidUntil: e.target.value || null }, 'Payment date saved'); }}
                        className={inputInlineCls} />
                    </label>
                  </>
                ) : (
                  <span className="text-slate-600">Plan: <b>{data.plans.find(p => p.id === b.plan_id)?.name || b.plan_id}</b>{b.paid_until ? ` · paid until ${b.paid_until}` : ''}</span>
                )}
                <div className="flex-1" />
                <button onClick={() => onOpen(b.id)} className={btnSecondary}><Info className="w-3.5 h-3.5" /> Details</button>
                {!canEdit ? null : suspended
                  ? <button onClick={() => update(b, { status: 'active' }, `${b.name} is active again`)} disabled={busy === b.id} className={btnSecondary}><PlayCircle className="w-3.5 h-3.5 text-emerald-600" /> Resume</button>
                  : <button onClick={async () => { if (await confirm({ title: `Suspend ${b.name}?`, body: 'Their staff are signed out of the dashboard within a minute, and nothing is sent from their number until you resume them.', confirmLabel: 'Suspend', danger: true })) update(b, { status: 'suspended' }, `${b.name} suspended`); }} disabled={busy === b.id} className={btnSecondary}><PauseCircle className="w-3.5 h-3.5 text-red-600" /> Suspend</button>}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function Stat({ label, value, limit }: { label: string; value: number | null; limit?: number | null }) {
  const over = limit !== undefined && limit !== null && Number(value) >= Number(limit);
  const near = limit !== undefined && limit !== null && !over && Number(value) >= 0.8 * Number(limit);
  return (
    <div>
      <div className={`text-base font-bold ${over ? 'text-red-700' : near ? 'text-amber-700' : 'text-slate-800'}`}>
        {num(value)}{limit !== undefined && <span className="text-xs font-normal text-slate-400"> / {limit === null ? '∞' : num(limit)}</span>}
      </div>
      <div>{label}</div>
    </div>
  );
}

interface PlanProps { reload: () => void; showToast: ShowToast }

function Plans({ plans, reload, showToast }: PlanProps & { plans: Plan[] }) {
  return (
    <>
      <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Layers className="w-5 h-5 text-slate-700" /> Plans</h1>
      <p className="text-xs text-slate-500">Empty limit = unlimited. Changes apply to every business on the plan within a minute. Incoming customer messages and staff replies are never blocked by a limit.</p>
      <div className="grid md:grid-cols-3 gap-3">
        {plans.map(p => <PlanCard key={p.id} plan={p} reload={reload} showToast={showToast} />)}
      </div>
    </>
  );
}

/** The plan form: numbers as typed (empty limit = unlimited); the server checks them. */
interface PlanForm {
  name: string;
  priceMonthlyInr: number | string;
  aiEnabled: boolean;
  adsEnabled: boolean;
  limits: Record<string, number | string>;
}

function PlanCard({ plan, reload, showToast }: PlanProps & { plan: Plan }) {
  const [form, setForm] = useState<PlanForm>(() => ({
    name: plan.name,
    priceMonthlyInr: plan.price_monthly_inr ?? 0,
    aiEnabled: !!plan.ai_enabled,
    adsEnabled: !!plan.ads_enabled,
    limits: Object.fromEntries(LIMITS.map(([k]) => [k, plan[k] ?? ''])),
  }));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api(`/api/platform/plans/${plan.id}`, { method: 'PUT', body: form });
      showToast(`${form.name} saved`);
      reload();
    } catch (err) {
      showToast(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
      <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="text-sm font-bold text-slate-800 w-full border-b border-transparent focus:border-slate-300 outline-none" />
      <label className="flex items-center justify-between text-xs text-slate-600 gap-2">Price per month (₹)
        <input type="number" min="0" value={form.priceMonthlyInr} onChange={e => setForm(f => ({ ...f, priceMonthlyInr: e.target.value }))} className={`${inputInlineCls} w-28 text-right`} />
      </label>
      {LIMITS.map(([k, label]) => (
        <label key={k} className="flex items-center justify-between text-xs text-slate-600 gap-2">{label}
          <input type="number" min="0" placeholder="unlimited" value={form.limits[k]} onChange={e => setForm(f => ({ ...f, limits: { ...f.limits, [k]: e.target.value } }))} className={`${inputInlineCls} w-28 text-right`} />
        </label>
      ))}
      <label className="flex items-center gap-2 text-xs text-slate-600">
        <input type="checkbox" checked={form.aiEnabled} onChange={e => setForm(f => ({ ...f, aiEnabled: e.target.checked }))} /> AI replies included
      </label>
      <label className="flex items-center gap-2 text-xs text-slate-600">
        <input type="checkbox" checked={form.adsEnabled} onChange={e => setForm(f => ({ ...f, adsEnabled: e.target.checked }))} /> Ads module included
      </label>
      <button onClick={save} disabled={busy} className={btnPrimary}><Save className="w-3.5 h-3.5" /> {busy ? 'Saving…' : 'Save plan'}</button>
    </div>
  );
}
