import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useConfirm } from './confirm';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { Target, RotateCw, Link2, Unlink, AlertTriangle, Pause, Play, Wallet, Bell, X, Search, ChevronLeft, ChevronRight, ChevronDown, Megaphone, LayoutList, ArrowRight, Eye, ExternalLink, Image as ImageIcon, BarChart3, Sparkles, BookOpen, Send, Copy, Phone, type LucideIcon } from 'lucide-react';
import AdConversions from './AdConversions';
import AdsBilling, { AdsOwnership } from './AdsBilling';
import { api, errorMessage, inputCls, btnPrimary, btnSecondary } from './broadcastUtils';
import { useApi, refreshApi, errorOf } from './queryClient';
import type { Role, ShowToast } from './types';
import MetaSetupGuide from './MetaSetupGuide';
import MetaOrgGuide from './MetaOrgGuide';
import AdsCreateReady from './AdsCreateReady';
import { ADS_GUIDE } from './metaGuides';

// Tabs of the Ads page once an ad account is connected.
type PageTab = 'results' | 'create' | 'conversions' | 'guide';
const PAGE_TABS: Array<[PageTab, string, LucideIcon]> = [
  ['results', 'Ad results', BarChart3],
  ['create', 'Create WhatsApp ads', Sparkles],
  ['conversions', 'Bookings to Meta', Send],
  ['guide', 'Setup guide', BookOpen],
];
const VIEW_KEY = 'ads_page_tab_v1';

// ---- What /api/ads returns (server/ads.cjs accountStatus + report) ----
type Num = number | null | undefined;
interface AlertSettings { maxCostPerChat: number | null; maxCostPerConversion: number | null; windowDays: number; autoPause?: boolean }
interface AdAccount {
  connected: boolean; adAccountId?: string; name?: string; currency?: string; timezone?: string;
  tokenLast4?: string | null; tokenUnreadable?: boolean; connectedBy?: string | null; connectedAt?: string | null;
  lastSyncAt?: string | null; lastSyncError?: string | null; alerts?: AlertSettings;
  /** The first 30 days are still loading (server worker). */
  firstSyncPending?: boolean;
}
interface Totals {
  spend: number; impressions: number; clicks: number; metaConversations: number; chats: number; converted: number;
  costPerChat: number | null; costPerConverted: number | null; ctr: number | null; otherAdChats: number;
}
interface CampaignRow {
  campaignId: string | null; campaignName: string; ads: number; activeAds?: number; adsets?: number;
  /** First and last day (YYYY-MM-DD) with results in the period. */
  firstDate?: string; lastDate?: string;
  spend: number; impressions: number; clicks: number; ctr?: number | null;
  metaConversations: number; chats: number; converted: number; costPerChat: number | null; costPerConverted: number | null;
}
interface AdRow {
  adId: string; adName: string | null; campaignId: string | null; campaignName: string | null; adsetId: string | null;
  adsetName: string | null; status: string | null; firstDate?: string; lastDate?: string;
  spend: number; impressions: number; reach: number; clicks: number; ctr?: number | null; costPerClick?: number | null;
  metaConversations: number; newContacts: number; returning: number; chats: number; converted: number;
  costPerChat: number | null; costPerConverted: number | null; costPerMetaConversation: number | null;
}
interface CostAlert { adId: string; adName: string | null; kind: 'chat' | 'conversion'; spend: number; count: number; cost: number; max: number }
/** The WhatsApp number an ad opens (server/ads.cjs adNumbersView): inCrm = one of this business's numbers here. */
interface AdNumber { phone: string | null; viaPage: boolean; label: string | null; inCrm: boolean }
interface AdsReport {
  range: { from: string; days: number; startDay: string }; currency: string;
  totals: Totals; campaigns: CampaignRow[]; ads: AdRow[]; alerts?: CostAlert[]; alertWindowDays: number;
  adNumbers?: Record<string, AdNumber>;
}
/** +91 97011 03222 for Indian numbers, +<digits> otherwise. */
const fmtPhone = (p: string) => (/^91\d{10}$/.test(p) ? `+91 ${p.slice(2, 7)} ${p.slice(7)}` : `+${p}`);

/** The number an ad opens: green when it's one of this business's numbers, amber when its chats go elsewhere. */
function AdNumberLine({ n }: { n?: AdNumber }) {
  if (!n) return <p className="text-xs text-slate-400 flex items-center gap-1" data-testid="ad-number"><Phone className="w-3 h-3" /> WhatsApp number: shown after the next sync</p>;
  if (!n.phone) return <p className="text-xs text-slate-500 flex items-center gap-1" data-testid="ad-number"><Phone className="w-3 h-3" /> Opens the WhatsApp number linked to the Page</p>;
  return n.inCrm
    ? <p className="text-xs text-emerald-800 flex items-center gap-1" data-testid="ad-number"><Phone className="w-3 h-3" /> Opens <strong>{fmtPhone(n.phone)}</strong>{n.label ? ` · ${n.label}` : ''}{n.viaPage ? ' (linked to the Page)' : ''}</p>
    : <p className="text-xs text-amber-800 flex items-center gap-1 flex-wrap" data-testid="ad-number" title="Chats from this ad go to that number, so they don't appear in this CRM's inbox, and CRM chats / conversions stay 0. Use one of this business's numbers for the ad, or add this number on the WhatsApp page.">
        <AlertTriangle className="w-3 h-3" /> Opens <strong>{fmtPhone(n.phone)}</strong>{n.viaPage ? ' (linked to the Page)' : ''} · not connected to this CRM: its chats don&apos;t reach this inbox
      </p>;
}
interface AdsResponse { adsEnabled: boolean; account?: AdAccount; report?: AdsReport | null; reportError?: string }
interface BudgetInfo { level: 'adset' | 'campaign'; id: string; name: string; dailyBudget: number; currency: string; maxAllowed: number }

// Ads page (phase B): Meta's spend and results per Click-to-WhatsApp ad, next to the CRM's own
// chats and conversions from each ad. Owner + manager only; the owner connects the ad account.
// No polling: results change about once an hour (worker sync), so the page loads on open,
// on range change and on "Sync now".

const INK = { primary: '#0b0b0b', secondary: '#52514e', muted: '#898781', grid: '#e1e0d9', surface: '#fcfcfb' };
const fmtNum = (n: Num) => (n === null || n === undefined ? '–' : Number(n).toLocaleString('en-IN'));
const fmtPct = (x: Num) => (x === null || x === undefined ? '–' : `${(x * 100).toFixed(x < 0.1 ? 2 : 1)}%`);
function money(n: Num, currency?: string) {
  if (n === null || n === undefined) return '–';
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: currency || 'INR', maximumFractionDigits: n >= 100 ? 0 : 2 }).format(n);
  } catch {
    return `${currency || ''} ${Number(n).toFixed(2)}`;
  }
}
const when = (ts: string | null | undefined) => (ts ? new Date(ts).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'never');
const STATUS: Record<string, [string, string]> = {
  ACTIVE: ['Active', 'bg-emerald-50 text-emerald-800 border-emerald-200'],
  PAUSED: ['Paused', 'bg-slate-100 text-slate-700 border-slate-200'],
  CAMPAIGN_PAUSED: ['Campaign paused', 'bg-slate-100 text-slate-700 border-slate-200'],
  ADSET_PAUSED: ['Ad set paused', 'bg-slate-100 text-slate-700 border-slate-200'],
  DISAPPROVED: ['Disapproved', 'bg-red-50 text-red-800 border-red-200'],
  PENDING_REVIEW: ['In review', 'bg-amber-50 text-amber-900 border-amber-200'],
  WITH_ISSUES: ['Has issues', 'bg-amber-50 text-amber-900 border-amber-200'],
};

/** basePath: this screen's address, e.g. /admin/ads; each tab is /admin/ads/results | create | conversions | guide. */
export default function AdsScreen({ userRole, showToast, basePath }: { userRole: Role; showToast?: ShowToast; basePath: string }) {
  const confirm = useConfirm();
  const [days, setDays] = useState(30);
  const [syncing, setSyncing] = useState(false);
  // Which tab: from the address. /…/ads alone opens the tab used last in this browser.
  const { pathname } = useLocation();
  const goTo = useNavigate();
  const sub = pathname.startsWith(`${basePath}/`) ? pathname.slice(basePath.length + 1).split('/')[0] : '';
  const view: PageTab | null = PAGE_TABS.some(t => t[0] === sub) ? sub as PageTab : null;
  const pickView = (v: PageTab) => { try { localStorage.setItem(VIEW_KEY, v); } catch { /* storage blocked */ } goTo(`${basePath}/${v}`); };
  const isOwner = userRole === 'owner';
  const canSee = userRole === 'owner' || userRole === 'manager';

  // Results change about once an hour (worker sync), so no automatic refresh: a minute's cache.
  const adsQuery = useApi<AdsResponse>(`/api/ads?days=${days}`, { enabled: canSee, keepPrevious: true, staleTime: 60000 });
  const data = adsQuery.data || null;
  const error = errorOf(adsQuery);
  const loading = adsQuery.isFetching;
  const load = () => refreshApi('/api/ads?');

  if (!view) {
    let last: PageTab = 'results';
    try { const v = localStorage.getItem(VIEW_KEY); if (PAGE_TABS.some(t => t[0] === v)) last = v as PageTab; } catch { /* storage blocked */ }
    return <Navigate to={`${basePath}/${last}`} replace />;
  }

  if (!canSee) {
    return <Shell><Notice>The Ads page is for managers and the Business Admin.</Notice></Shell>;
  }

  const syncNow = async () => {
    setSyncing(true);
    try {
      const r = await api<{ message?: string }>('/api/ads/sync', { method: 'POST' });
      showToast?.(r.message || 'Sync started. New ad results appear within about 5 minutes.');
      await load();
    } catch (e) {
      showToast?.(errorMessage(e));
    } finally {
      setSyncing(false);
    }
  };

  const disconnect = async () => {
    if (!await confirm('Disconnect this ad account? Ad results already synced stay saved; syncing stops.')) return;
    try {
      await api('/api/ads/account', { method: 'DELETE' });
      showToast?.('Ad account disconnected');
      load();
    } catch (e) {
      showToast?.(errorMessage(e));
    }
  };

  const account = data?.account;
  const report = data?.report;

  return (
    <Shell>
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Target className="w-5 h-5 text-wa-teal" /> Ads</h1>
          <p className="text-xs text-slate-500">Click-to-WhatsApp ads: what Meta charged, and what each ad brought into your inbox.</p>
        </div>
        {data?.adsEnabled && account?.connected && view === 'results' && (
          <div className="ml-auto flex items-center gap-2">
            <div className="bg-white border border-slate-200 p-0.5 rounded-lg flex" role="group" aria-label="Date range">
              {[7, 30, 90].map(d => (
                <button key={d} onClick={() => setDays(d)} aria-pressed={days === d}
                  className={`px-3 py-1 rounded-md text-xs font-semibold cursor-pointer ${days === d ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                  Last {d} days
                </button>
              ))}
            </div>
            <button onClick={syncNow} disabled={syncing} className={btnSecondary} title="Fetch the latest results from Meta (at most every 10 minutes)">
              <RotateCw className={`w-3.5 h-3.5 ${syncing || loading ? 'animate-spin' : ''}`} /> Sync now
            </button>
          </div>
        )}
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>}
      {!data && !error && <div className="text-sm text-slate-500">Loading…</div>}

      {data && !data.adsEnabled && (
        <Notice>Your plan does not include the Ads module. Ask the platform to upgrade your plan to Growth or Pro.</Notice>
      )}

      {/* Not connected yet: how to get the ad account ID and token, then connect. */}
      {data?.adsEnabled && !account?.connected && (
        <>
          <MetaSetupGuide guide={ADS_GUIDE} defaultOpen />
          {isOwner
            ? <ConnectForm onDone={() => load()} showToast={showToast} />
            : <Notice>No ad account is connected yet. The Business Admin connects it on this page.</Notice>}
        </>
      )}

      {/* Connected: the account, then three tabs (results / create WhatsApp ads / setup guide). */}
      {data?.adsEnabled && account?.connected && (
        <>
          <AccountBar account={account} isOwner={isOwner} onDisconnect={disconnect} onReconnected={() => { load(); refreshApi('/api/ads/create/readiness'); }} showToast={showToast} />
          <AdsOwnership onGuide={() => pickView('guide')} />
          <AdsBilling showToast={showToast} />
          <div className="flex flex-wrap gap-1 border-b border-slate-200" role="tablist" aria-label="Ads sections">
            {PAGE_TABS.map(([id, label, Icon]) => (
              <button key={id} role="tab" aria-selected={view === id} onClick={() => pickView(id)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px cursor-pointer ${view === id ? 'border-wa-teal text-wa-teal' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
                <Icon className="w-4 h-4" />{label}
              </button>
            ))}
          </div>
          {view === 'results' && (
            <>
              <NeedsAttention showToast={showToast} numbers={report?.adNumbers} />
              {data.reportError && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{data.reportError}</div>}
              {report && <Results report={report} alertSettings={account.alerts} onChanged={() => load()} showToast={showToast} />}
            </>
          )}
          {view === 'create' && <AdsCreateReady isOwner={isOwner} showToast={showToast} />}
          {view === 'conversions' && <AdConversions isOwner={isOwner} showToast={showToast} />}
          {view === 'guide' && (
            <div className="space-y-3">
              <MetaOrgGuide />
              <MetaSetupGuide guide={ADS_GUIDE} defaultOpen={false} />
            </div>
          )}
        </>
      )}
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// F1/F3: ads Meta rejected or flagged (with Meta's reasons) and ads the CRM paused for cost.
// ---------------------------------------------------------------------------
interface AdIssue { adId: string; kind: 'review' | 'auto_paused'; adName: string | null; status: string | null; reasons: string[]; since: string; acknowledged: boolean; acknowledgedBy: string | null }

const ATTENTION_OPEN_KEY = 'ads_attention_open_v1';

function NeedsAttention({ showToast, numbers }: { showToast?: ShowToast; numbers?: Record<string, AdNumber> }) {
  const q = useApi<{ issues: AdIssue[]; unread: number }>('/api/ads/issues', { staleTime: 60000 });
  const issues = q.data?.issues || [];
  const [busy, setBusy] = useState(false);
  // Collapsed by default (a long list pushes the results down); the choice is remembered in this browser.
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(ATTENTION_OPEN_KEY) === '1'; } catch { return false; } });
  const toggle = () => setOpen(o => { try { localStorage.setItem(ATTENTION_OPEN_KEY, o ? '0' : '1'); } catch { /* storage blocked */ } return !o; });
  if (!issues.length) return null;
  const rejected = issues.filter(i => i.kind === 'review' && i.status === 'DISAPPROVED').length;
  const paused = issues.filter(i => i.kind === 'auto_paused').length;
  const problems = issues.length - rejected - paused;
  const summary = [rejected && `${rejected} rejected`, problems && `${problems} with a Meta problem`, paused && `${paused} paused automatically`].filter(Boolean).join(' · ');
  const ack = async () => {
    setBusy(true);
    try {
      await api('/api/ads/issues/ack', { method: 'POST' });
      await refreshApi('/api/ads/issues');
      showToast?.('Marked as seen');
    } catch (e) {
      showToast?.(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const label = (i: AdIssue) => (i.kind === 'auto_paused'
    ? (i.status === 'PAUSE_FAILED' ? 'Could not pause' : 'Paused automatically')
    : i.status === 'DISAPPROVED' ? 'Rejected by Meta' : 'Meta found a problem');
  return (
    <section className="rounded-xl border border-red-200 bg-red-50 p-3" data-testid="ads-attention">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button onClick={toggle} aria-expanded={open} aria-controls="ads-attention-list" className="flex items-center gap-2 text-left cursor-pointer min-w-0" data-testid="ads-attention-toggle">
          <ChevronDown className={`w-4 h-4 text-red-700 transition-transform ${open ? '' : '-rotate-90'}`} />
          <AlertTriangle className="w-4 h-4 text-red-700" />
          <span className="font-semibold text-red-900">Needs attention ({issues.length})</span>
          {!open && <span className="text-red-800/80 truncate">{summary}</span>}
        </button>
        {q.data?.unread ? <span className="text-red-700 font-semibold">{q.data.unread} new</span> : null}
        <span className="ml-auto flex items-center gap-2">
          {q.data?.unread ? <button onClick={ack} disabled={busy} className="px-2 py-1 rounded-lg border border-red-300 bg-white text-red-800 font-semibold cursor-pointer disabled:opacity-50">Got it</button> : null}
          <button onClick={toggle} className="text-red-800 font-semibold hover:underline cursor-pointer">{open ? 'Hide' : 'Show all'}</button>
        </span>
      </div>
      {open && <ul className="mt-2 space-y-2" id="ads-attention-list">
        {issues.map(i => (
          <li key={`${i.adId}-${i.kind}`} className={`rounded-lg bg-white border p-2 text-xs ${i.acknowledged ? 'border-red-100 opacity-80' : 'border-red-200'}`} data-testid="ads-issue">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`text-xs font-bold uppercase px-1.5 py-0.5 rounded ${i.kind === 'auto_paused' ? 'bg-amber-100 text-amber-900' : 'bg-red-100 text-red-800'}`}>{label(i)}</span>
              <strong className="text-slate-800">{i.adName || `Ad ${i.adId}`}</strong>
              <span className="text-xs text-slate-400">since {new Date(i.since).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            {numbers?.[i.adId] && <div className="mt-0.5"><AdNumberLine n={numbers[i.adId]} /></div>}
            {i.reasons.length > 0
              ? <ul className="mt-1 list-disc pl-4 text-slate-700 space-y-0.5">{i.reasons.map(r => <li key={r}>{r}</li>)}</ul>
              : <p className="mt-1 text-slate-600">Meta didn&apos;t give a reason here. Open the ad in Meta Ads Manager to see it.</p>}
            <p className="mt-1 text-xs text-slate-500">
              {i.kind === 'auto_paused'
                ? 'Check the ad, then lower its budget, change it in Ads Manager, or resume it below when you\'re ready.'
                : 'Fix the ad (text or picture) and send it for review again, or request another review, in Meta Ads Manager. It disappears from here once Meta approves it.'}
              {' '}<a href={`https://adsmanager.facebook.com/adsmanager/manage/ads?selected_ad_ids=${i.adId}`} target="_blank" rel="noreferrer" className="text-wa-teal font-semibold hover:underline inline-flex items-center gap-0.5">Open in Ads Manager <ExternalLink className="w-3 h-3" /></a>
            </p>
          </li>
        ))}
      </ul>}
    </section>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 overflow-y-auto" style={{ background: '#f9f9f7' }}>
      <div className="max-w-6xl mx-auto px-4 py-5 space-y-4">{children}</div>
    </div>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return <div className="p-4 bg-white border border-slate-200 rounded-xl text-sm text-slate-600">{children}</div>;
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border p-4" style={{ background: INK.surface, borderColor: 'rgba(11,11,11,0.10)' }}>
      <h2 className="text-sm font-semibold" style={{ color: INK.primary }}>{title}</h2>
      {subtitle && <p className="text-xs mb-3" style={{ color: INK.secondary }}>{subtitle}</p>}
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Connect (owner)
// ---------------------------------------------------------------------------

interface ConnectFormProps { onDone?: () => void; showToast?: ShowToast; initialId?: string; onCancel?: () => void }

function ConnectForm({ onDone, showToast, initialId = '', onCancel }: ConnectFormProps) {
  const [adAccountId, setAdAccountId] = useState(initialId);
  const [accessToken, setAccessToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await api<{ syncNote?: string | null; account?: AdAccount; accountActive?: boolean }>('/api/ads/account', { method: 'PUT', body: { adAccountId, accessToken } });
      setAccessToken('');
      showToast?.(r.syncNote || `Connected ${r.account?.name || 'ad account'}${r.accountActive === false ? ' (Meta says the account is not active)' : ''}`);
      onDone?.();
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={initialId ? 'Update the ad account' : 'Connect your Meta ad account'} subtitle="Only the Business Admin can do this. The token is stored encrypted and is never shown again.">
      <form onSubmit={save} className="space-y-3 max-w-xl">
        <label className="block text-xs text-slate-600">Ad account ID
          <input value={adAccountId} onChange={e => setAdAccountId(e.target.value)} placeholder="act_1234567890 or 1234567890" className={`${inputCls} mt-1`} autoComplete="off" />
          <span className="text-xs text-slate-500">Meta Ads Manager, account menu (top left): the number under the account name.</span>
        </label>
        <label className="block text-xs text-slate-600">Access token {initialId && <span className="text-slate-400">(leave empty to keep the saved one)</span>}
          <input value={accessToken} onChange={e => setAccessToken(e.target.value)} type="password" placeholder="EAAG…" className={`${inputCls} mt-1 font-mono`} autoComplete="off" />
          <span className="text-xs text-slate-500">Business Settings → System users → Generate token for your app, with <strong>ads_read</strong> (and the ad account assigned to that system user).</span>
        </label>
        {err && <div className="p-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{err}</div>}
        <div className="flex gap-2">
          <button type="submit" disabled={busy || !adAccountId.trim()} className={btnPrimary}><Link2 className="w-3.5 h-3.5" /> {busy ? 'Checking with Meta…' : 'Connect'}</button>
          {onCancel && <button type="button" onClick={onCancel} className={btnSecondary}>Cancel</button>}
        </div>
      </form>
    </Card>
  );
}

interface AccountBarProps {
  account: AdAccount; isOwner: boolean; onDisconnect: () => void; onReconnected: () => void; showToast?: ShowToast;
}

function AccountBar({ account, isOwner, onDisconnect, onReconnected, showToast }: AccountBarProps) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return <ConnectForm initialId={account.adAccountId} showToast={showToast} onCancel={() => setEditing(false)} onDone={() => { setEditing(false); onReconnected(); }} />;
  }
  return (
    <div className="rounded-xl border bg-white p-3 text-xs flex flex-wrap items-center gap-x-4 gap-y-1" style={{ borderColor: 'rgba(11,11,11,0.10)' }}>
      <span className="font-semibold text-slate-800">{account.name || account.adAccountId}</span>
      <span className="text-slate-500 font-mono">{account.adAccountId}</span>
      {account.currency && <span className="text-slate-500">{account.currency}</span>}
      {account.firstSyncPending
        ? <span className="text-amber-700">Loading the last 30 days of results in the background (about 15–30 minutes after connecting)…</span>
        : <span className="text-slate-500">Last synced: {when(account.lastSyncAt)}</span>}
      {account.tokenLast4 && <span className="text-slate-500">Token ••••{account.tokenLast4}</span>}
      {(account.lastSyncError || account.tokenUnreadable) && (
        <span className="flex items-center gap-1 text-amber-800"><AlertTriangle className="w-3.5 h-3.5" /> {account.tokenUnreadable ? 'The saved token can\'t be read. Paste it again.' : account.lastSyncError}</span>
      )}
      {isOwner && (
        <span className="ml-auto flex gap-2">
          <button onClick={() => setEditing(true)} className="text-slate-600 hover:text-slate-900 underline cursor-pointer">Change token</button>
          <button onClick={onDisconnect} className="text-red-600 hover:text-red-800 flex items-center gap-1 cursor-pointer"><Unlink className="w-3 h-3" /> Disconnect</button>
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

interface ResultsProps { report: AdsReport; alertSettings?: AlertSettings; onChanged: () => void; showToast?: ShowToast }

function Results({ report, alertSettings, onChanged, showToast }: ResultsProps) {
  const confirm = useConfirm();
  const { totals: t, currency } = report;
  const [busyAd, setBusyAd] = useState<string | null>(null);
  const [budgetFor, setBudgetFor] = useState<AdRow | null>(null); // ad row whose ad set budget is being edited
  if (!report.ads.length) {
    return (
      <>
        <AlertsCard settings={alertSettings} alerts={[]} currency={currency} onSaved={onChanged} showToast={showToast} />
        <Notice>No ad results for this period yet. If you just connected, wait for the first sync or press Sync now.</Notice>
      </>
    );
  }

  const toggle = async (a: AdRow) => {
    const pause = a.status === 'ACTIVE';
    if (!await confirm(pause ? `Pause "${a.adName || a.adId}"? It stops spending until you resume it.` : `Resume "${a.adName || a.adId}"? It starts spending again.`)) return;
    setBusyAd(a.adId);
    try {
      await api(`/api/ads/ads/${a.adId}/status`, { method: 'POST', body: { status: pause ? 'PAUSED' : 'ACTIVE' } });
      showToast?.(pause ? 'Ad paused' : 'Ad resumed');
      onChanged();
    } catch (e) {
      showToast?.(errorMessage(e));
    } finally {
      setBusyAd(null);
    }
  };
  // F4: a switched-off copy of the ad in the same ad set (Meta's "Duplicate").
  const copy = async (a: AdRow) => {
    if (!await confirm(`Make a copy of "${a.adName || a.adId}"? The copy is created switched off in the same ad set, so nothing spends until you resume it.`)) return;
    setBusyAd(a.adId);
    try {
      const r = await api<{ message?: string }>(`/api/ads/ads/${a.adId}/copy`, { method: 'POST' });
      showToast?.(r.message || 'Copied, switched off.');
    } catch (e) {
      showToast?.(errorMessage(e));
    } finally {
      setBusyAd(null);
    }
  };
  const tiles = [
    ['Spend', money(t.spend, currency), `${fmtNum(t.impressions)} impressions · ${fmtPct(t.ctr)} click rate`],
    ['Chats from ads', fmtNum(t.chats), `CRM count · Meta reports ${fmtNum(t.metaConversations)} conversations`],
    ['Cost per chat', money(t.costPerChat, currency), 'spend ÷ chats in the CRM'],
    ['Converted', fmtNum(t.converted), 'now Booked, Completed or Returning'],
    ['Cost per conversion', money(t.costPerConverted, currency), 'spend ÷ converted'],
  ];
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {tiles.map(([label, value, hint]) => (
          <div key={label} className="rounded-xl border p-3" style={{ background: INK.surface, borderColor: 'rgba(11,11,11,0.10)' }}>
            <div className="text-xs font-medium" style={{ color: INK.secondary }}>{label}</div>
            <div className="text-2xl font-bold mt-0.5" style={{ color: INK.primary }}>{value}</div>
            <div className="text-xs mt-0.5" style={{ color: INK.muted }}>{hint}</div>
          </div>
        ))}
      </div>
      <AlertsCard settings={alertSettings} alerts={report.alerts || []} windowDays={report.alertWindowDays} currency={currency} onSaved={onChanged} showToast={showToast} />
      {budgetFor && <BudgetDialog ad={budgetFor} onClose={() => setBudgetFor(null)} onSaved={() => { setBudgetFor(null); onChanged(); }} showToast={showToast} />}
      {t.otherAdChats > 0 && (
        <p className="text-xs text-slate-500">{fmtNum(t.otherAdChats)} chat{t.otherAdChats === 1 ? '' : 's'} came from ads not in this ad account (another account, or older ads).</p>
      )}

      <ResultTabs report={report} busyAd={busyAd} onToggle={toggle} onBudget={setBudgetFor} onCopy={copy} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Campaigns / Ads tabs: search, status filter, sort (latest first by default), 10 per page
// ---------------------------------------------------------------------------

const PAGE_SIZE = 10;
type Tab = 'campaigns' | 'ads';
type StatusFilter = 'all' | 'active' | 'paused' | 'other';
type SortKey = 'latest' | 'spend' | 'chats' | 'costPerChat';
const SORTS: Record<SortKey, string> = { latest: 'Latest first', spend: 'Highest spend', chats: 'Most chats', costPerChat: 'Lowest cost per chat' };
const PAUSED = new Set(['PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED']);

const statusGroup = (s: string | null | undefined): Exclude<StatusFilter, 'all'> => (s === 'ACTIVE' ? 'active' : s && PAUSED.has(s) ? 'paused' : 'other');
const campaignGroup = (c: CampaignRow): Exclude<StatusFilter, 'all'> => ((c.activeAds || 0) > 0 ? 'active' : 'paused');

/** '2026-11-10' -> '10 Nov'. */
const fmtDay = (d?: string) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '');
const fmtRange = (a?: string, b?: string) => (!a && !b ? '–' : a === b || !a ? fmtDay(b) : `${fmtDay(a)} – ${fmtDay(b)}`);

function sorter<T extends { lastDate?: string; firstDate?: string; spend: number; chats: number; costPerChat: number | null }>(key: SortKey) {
  return (x: T, y: T) => {
    if (key === 'spend') return y.spend - x.spend;
    if (key === 'chats') return y.chats - x.chats || y.spend - x.spend;
    if (key === 'costPerChat') return (x.costPerChat ?? Infinity) - (y.costPerChat ?? Infinity) || y.chats - x.chats;
    return String(y.lastDate || '').localeCompare(String(x.lastDate || '')) || String(y.firstDate || '').localeCompare(String(x.firstDate || '')) || y.spend - x.spend;
  };
}

interface ResultTabsProps { report: AdsReport; busyAd: string | null; onToggle: (a: AdRow) => void; onBudget: (a: AdRow) => void; onCopy: (a: AdRow) => void }

function ResultTabs({ report, busyAd, onToggle, onBudget, onCopy }: ResultTabsProps) {
  const [tab, setTab] = useState<Tab>('campaigns');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<SortKey>('latest');
  const [campaignFilter, setCampaignFilter] = useState<CampaignRow | null>(null);
  const [pages, setPages] = useState<Record<Tab, number>>({ campaigns: 1, ads: 1 });
  const [open, setOpen] = useState<string | null>(null); // ad whose details are shown
  const { currency } = report;
  const flagged = new Set((report.alerts || []).map(x => x.adId));

  // Any change to what is listed starts again at page 1.
  const firstPage = () => setPages({ campaigns: 1, ads: 1 });
  const change = <T,>(set: (v: T) => void) => (v: T) => { set(v); firstPage(); };
  const switchTab = (t: Tab) => { setTab(t); setOpen(null); };
  const viewAds = (c: CampaignRow) => { setCampaignFilter(c); setQuery(''); setStatus('all'); firstPage(); switchTab('ads'); };

  const q = query.trim().toLowerCase();
  const campaigns = report.campaigns
    .filter(c => (status === 'all' || campaignGroup(c) === status) && (!q || c.campaignName.toLowerCase().includes(q)))
    .sort(sorter<CampaignRow>(sort));
  const ads = report.ads
    .filter(a => !campaignFilter || a.campaignId === campaignFilter.campaignId)
    .filter(a => (status === 'all' || statusGroup(a.status) === status) &&
      (!q || [a.adName, a.adId, a.campaignName, a.adsetName].some(v => String(v || '').toLowerCase().includes(q))))
    .sort(sorter<AdRow>(sort));

  const list = tab === 'campaigns' ? campaigns : ads;
  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const page = Math.min(pages[tab], totalPages);
  const setPage = (p: number) => { setPages(s => ({ ...s, [tab]: p })); setOpen(null); };
  const start = (page - 1) * PAGE_SIZE;

  // Thumbnails for the ads on screen: one request per page (Meta's image links expire, so not stored).
  const pageAdIds = tab === 'ads' ? ads.slice(start, start + PAGE_SIZE).map(a => a.adId) : [];
  const thumbsQuery = useApi<{ thumbnails: Record<string, AdThumb> }>(`/api/ads/thumbnails?ids=${pageAdIds.join(',')}`,
    { enabled: pageAdIds.length > 0, staleTime: 40 * 60000 });
  const thumbs = thumbsQuery.data?.thumbnails || {};
  // Ads made with "Create an ad" get a small badge.
  const launches = useApi<{ launches: Array<{ ad_id?: string | null }> }>('/api/ads/launches', { enabled: tab === 'ads', staleTime: 5 * 60000 });
  const crmMade = new Set((launches.data?.launches || []).map(l => String(l.ad_id || '')).filter(Boolean));
  const [previewAd, setPreviewAd] = useState<AdRow | null>(null);

  const tabBtn = (t: Tab, label: string, count: number, icon: ReactNode) => (
    <button role="tab" aria-selected={tab === t} onClick={() => switchTab(t)}
      className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px cursor-pointer ${tab === t ? 'border-wa-teal text-wa-teal' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
      {icon}{label}<span className={`text-xs px-1.5 py-0.5 rounded-full ${tab === t ? 'bg-teal-50 text-teal-800' : 'bg-slate-100 text-slate-600'}`}>{count}</span>
    </button>
  );

  return (
    <section className="rounded-xl border bg-white" style={{ borderColor: 'rgba(11,11,11,0.10)' }}>
      <div className="flex flex-wrap items-end gap-2 px-3 border-b border-slate-200" role="tablist" aria-label="Ad results">
        {tabBtn('campaigns', 'Ad campaigns', report.campaigns.length, <Megaphone className="w-4 h-4" />)}
        {tabBtn('ads', 'Ads', report.ads.length, <LayoutList className="w-4 h-4" />)}
      </div>

      {/* Search, status and sort */}
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-slate-100">
        <label className="relative flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input value={query} onChange={e => change(setQuery)(e.target.value)} placeholder={tab === 'campaigns' ? 'Search campaigns' : 'Search ads, ad sets or campaigns'}
            aria-label="Search" className={`${inputCls} pl-8`} />
        </label>
        <select value={status} onChange={e => change(setStatus)(e.target.value as StatusFilter)} aria-label="Status" className={`${inputCls} !w-auto`}>
          <option value="all">All statuses</option>
          <option value="active">{tab === 'campaigns' ? 'Running' : 'Active'}</option>
          <option value="paused">{tab === 'campaigns' ? 'Not running' : 'Paused'}</option>
          {tab === 'ads' && <option value="other">Other (in review, issues…)</option>}
        </select>
        <select value={sort} onChange={e => change(setSort)(e.target.value as SortKey)} aria-label="Sort" className={`${inputCls} !w-auto`}>
          {(Object.keys(SORTS) as SortKey[]).map(k => <option key={k} value={k}>{SORTS[k]}</option>)}
        </select>
      </div>

      {tab === 'ads' && campaignFilter && (
        <div className="px-3 pt-3">
          <span className="inline-flex items-center gap-1.5 bg-teal-50 border border-teal-200 text-teal-900 rounded-full pl-3 pr-1 py-0.5 text-xs">
            Campaign: <strong className="max-w-[260px] truncate">{campaignFilter.campaignName}</strong>
            <button onClick={() => { setCampaignFilter(null); firstPage(); }} aria-label="Show ads from every campaign" className="p-0.5 rounded-full hover:bg-teal-100 cursor-pointer"><X className="w-3 h-3" /></button>
          </span>
        </div>
      )}

      <div className="p-3">
        {list.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-8">No {tab} match{q ? ` "${query.trim()}"` : ''}{status !== 'all' ? ' with this status' : ''}.</p>
        ) : tab === 'campaigns' ? (
          <ul className="space-y-2">
            {campaigns.slice(start, start + PAGE_SIZE).map(c => <CampaignItem key={c.campaignId || 'none'} c={c} currency={currency} onViewAds={() => viewAds(c)} />)}
          </ul>
        ) : (
          <ul className="space-y-2">
            {ads.slice(start, start + PAGE_SIZE).map(a => (
              <AdItem key={a.adId} a={a} currency={currency} flagged={flagged.has(a.adId)} busy={busyAd === a.adId}
                thumb={thumbs[a.adId]} onPreview={() => setPreviewAd(a)} crmMade={crmMade.has(a.adId)} number={report.adNumbers?.[a.adId]}
                open={open === a.adId} onOpen={() => setOpen(open === a.adId ? null : a.adId)} onToggle={() => onToggle(a)} onBudget={() => onBudget(a)} onCopy={() => onCopy(a)} />
            ))}
          </ul>
        )}
      </div>

      {list.length > 0 && <Pager page={page} totalPages={totalPages} total={list.length} start={start} onPage={setPage} noun={tab === 'campaigns' ? 'campaigns' : 'ads'} />}
      <p className="px-3 pb-3 text-xs" style={{ color: INK.muted }}>
        Meta conversations = chats Meta counted · CRM chats = new + returning contacts in your inbox from the ad · Converted = moved to Booked, Completed or Returning.
      </p>
      {previewAd && <AdPreviewDialog ad={previewAd} currency={currency} onClose={() => setPreviewAd(null)} />}
    </section>
  );
}

// ---------------------------------------------------------------------------
// One ad's preview: Meta's own rendering in a placement, next to its words and button
// ---------------------------------------------------------------------------

interface AdThumb { thumbnailUrl: string | null; headline?: string }
interface AdPreview {
  adId: string; name: string; status: string | null; format: string; formats: string[]; frameUrl: string | null;
  image: string | null; text: string; headline: string; cta: string;
}
const FORMAT_LABEL: Record<string, string> = {
  MOBILE_FEED_STANDARD: 'Facebook mobile', INSTAGRAM_STANDARD: 'Instagram feed', INSTAGRAM_STORY: 'Story', DESKTOP_FEED_STANDARD: 'Facebook desktop',
};
const FRAME_SIZE: Record<string, [number, number]> = {
  MOBILE_FEED_STANDARD: [340, 560], INSTAGRAM_STANDARD: [340, 600], INSTAGRAM_STORY: [320, 600], DESKTOP_FEED_STANDARD: [500, 560],
};

function AdPreviewDialog({ ad, currency, onClose }: { ad: AdRow; currency: string; onClose: () => void }) {
  const [format, setFormat] = useState('MOBILE_FEED_STANDARD');
  const q = useApi<AdPreview>(`/api/ads/ads/${ad.adId}/preview?format=${format}`, { keepPrevious: true, staleTime: 40 * 60000 });
  const p = q.data && q.data.adId === ad.adId ? q.data : null;
  const error = errorOf(q);
  const [w, h] = FRAME_SIZE[format] || FRAME_SIZE.MOBILE_FEED_STANDARD;
  const name = ad.adName || `Ad ${ad.adId}`;

  return (
    <div className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label={`Preview of ${name}`} onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-slate-200 px-4 py-3 flex items-start justify-between gap-3 z-10">
          <div className="min-w-0">
            <div className="flex items-center gap-2"><StatusBadge status={p?.status || ad.status} /><h3 className="text-sm font-bold text-slate-800 truncate">{name}</h3></div>
            <p className="text-xs text-slate-500 truncate">{ad.campaignName}{ad.adsetName ? ` › ${ad.adsetName}` : ''}</p>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-4 pt-3 flex flex-wrap gap-1" role="group" aria-label="Placement">
          {Object.keys(FORMAT_LABEL).map(f => (
            <button key={f} onClick={() => setFormat(f)} aria-pressed={format === f}
              className={`px-3 py-1 rounded-full text-xs font-semibold cursor-pointer border ${format === f ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
              {FORMAT_LABEL[f]}
            </button>
          ))}
        </div>

        <div className="p-4 grid md:grid-cols-[auto_1fr] gap-5 items-start">
          <div className="flex justify-center bg-slate-100 rounded-xl p-3 min-h-[300px] min-w-[300px]">
            {error ? <p className="text-xs text-red-700 self-center max-w-[260px] text-center">{error}</p>
              : !p || q.isFetching && q.data?.format !== format ? <p className="text-xs text-slate-500 self-center">Asking Meta for the preview…</p>
                : p.frameUrl
                  ? <iframe key={p.frameUrl} src={p.frameUrl} title={`Meta preview: ${FORMAT_LABEL[format]}`} width={w} height={h} className="bg-white rounded-lg border-0 max-w-full" referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-popups" />
                  : p.image
                    ? <img src={p.image} alt="" referrerPolicy="no-referrer" className="max-w-[320px] max-h-[500px] rounded-lg object-contain" />
                    : <p className="text-xs text-slate-500 self-center">Meta has no preview for this placement.</p>}
          </div>
          <div className="space-y-3 min-w-0 text-sm">
            {p && (
              <>
                {p.headline && <div><div className="text-xs uppercase tracking-wide text-slate-400 font-semibold">Headline</div><div className="font-semibold text-slate-800">{p.headline}</div></div>}
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-400 font-semibold">Ad text</div>
                  <p className="text-slate-700 whitespace-pre-wrap break-words text-[13px] leading-relaxed">{p.text || '–'}</p>
                </div>
                {p.cta && <div><div className="text-xs uppercase tracking-wide text-slate-400 font-semibold">Button</div><span className="inline-block mt-0.5 px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 text-xs font-semibold capitalize">{p.cta}</span></div>}
              </>
            )}
            <dl className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 text-xs">
              <div><dt className="text-slate-400">Spend</dt><dd className="font-semibold">{money(ad.spend, currency)}</dd></div>
              <div><dt className="text-slate-400">CRM chats</dt><dd className="font-semibold">{fmtNum(ad.chats)}</dd></div>
              <div><dt className="text-slate-400">Cost per chat</dt><dd className="font-semibold">{money(ad.costPerChat, currency)}</dd></div>
              <div><dt className="text-slate-400">Ran</dt><dd className="font-semibold">{fmtRange(ad.firstDate, ad.lastDate)}</dd></div>
            </dl>
            <a href={`https://adsmanager.facebook.com/adsmanager/manage/ads?selected_ad_ids=${ad.adId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-wa-teal hover:underline">
              Open in Meta Ads Manager <ExternalLink className="w-3 h-3" />
            </a>
            <p className="text-xs text-slate-400">The preview is drawn by Meta and may take a few seconds. If it stays blank, check that you're allowed to view this ad account in Meta.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  const [label, cls] = (status && STATUS[status]) || [status ? status.toLowerCase().replace(/_/g, ' ') : 'Unknown', 'bg-slate-50 text-slate-600 border-slate-200'];
  return <span className={`inline-block border rounded px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap ${cls}`}>{label}</span>;
}

function Metric({ label, value, sub, strong }: { label: string; value: ReactNode; sub?: ReactNode; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide" style={{ color: INK.muted }}>{label}</dt>
      <dd className={`tabular-nums truncate ${strong ? 'text-base font-bold' : 'text-sm font-semibold'}`} style={{ color: INK.primary }}>{value}</dd>
      {sub !== undefined && <dd className="text-xs truncate" style={{ color: INK.secondary }}>{sub}</dd>}
    </div>
  );
}

const smallBtn = 'px-2.5 py-1 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed flex items-center gap-1';

function CampaignItem({ c, currency, onViewAds }: { c: CampaignRow; currency: string; onViewAds: () => void }) {
  const running = (c.activeAds || 0) > 0;
  return (
    <li className="rounded-xl border border-slate-200 p-3 hover:border-slate-300 transition">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`inline-block border rounded px-1.5 py-0.5 text-xs font-semibold ${running ? STATUS.ACTIVE[1] : STATUS.PAUSED[1]}`}>
              {running ? `${c.activeAds} of ${c.ads} ads active` : 'Not running'}
            </span>
            <h3 className="text-sm font-semibold text-slate-800 truncate" title={c.campaignName}>{c.campaignName}</h3>
          </div>
          <p className="text-xs mt-0.5" style={{ color: INK.secondary }}>
            Ran {fmtRange(c.firstDate, c.lastDate)} · {fmtNum(c.ads)} ad{c.ads === 1 ? '' : 's'}{c.adsets ? ` in ${c.adsets} ad set${c.adsets === 1 ? '' : 's'}` : ''}
          </p>
        </div>
        <button onClick={onViewAds} className={smallBtn}>View ads <ArrowRight className="w-3 h-3" /></button>
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-3">
        <Metric strong label="Spend" value={money(c.spend, currency)} sub={`${fmtNum(c.impressions)} impressions`} />
        <Metric label="Clicks" value={fmtNum(c.clicks)} sub={`${fmtPct(c.ctr)} click rate`} />
        <Metric label="Meta conversations" value={fmtNum(c.metaConversations)} />
        <Metric label="CRM chats" value={fmtNum(c.chats)} />
        <Metric label="Cost per chat" value={money(c.costPerChat, currency)} />
        <Metric label="Converted" value={fmtNum(c.converted)} sub={c.converted ? `${money(c.costPerConverted, currency)} each` : 'none yet'} />
      </dl>
    </li>
  );
}

interface AdItemProps {
  a: AdRow; currency: string; flagged: boolean; busy: boolean; open: boolean; thumb?: AdThumb; crmMade?: boolean; number?: AdNumber;
  onOpen: () => void; onToggle: () => void; onBudget: () => void; onPreview: () => void; onCopy: () => void;
}

function AdItem({ a, currency, flagged, busy, open, thumb, crmMade, number, onOpen, onToggle, onBudget, onPreview, onCopy }: AdItemProps) {
  const canToggle = a.status === 'ACTIVE' || a.status === 'PAUSED';
  const name = a.adName || `Ad ${a.adId}`;
  return (
    <li className={`rounded-xl border p-3 transition ${flagged ? 'border-red-200 bg-red-50/40' : 'border-slate-200 hover:border-slate-300'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <button onClick={onPreview} className="w-14 h-14 rounded-lg overflow-hidden border border-slate-200 bg-slate-100 flex-shrink-0 cursor-pointer hover:ring-2 hover:ring-wa-teal" title="Preview this ad" aria-label={`Preview ${name}`}>
          {thumb?.thumbnailUrl
            ? <img src={thumb.thumbnailUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
            : <span className="w-full h-full flex items-center justify-center text-slate-400"><ImageIcon className="w-5 h-5" /></span>}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <StatusBadge status={a.status} />
            {flagged && <span className="flex items-center gap-0.5 text-xs font-semibold text-red-700"><AlertTriangle className="w-3 h-3" /> Over cost alert</span>}
            {crmMade && <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-violet-50 text-violet-700">Created in CRM</span>}
            <h3 className="text-sm font-semibold text-slate-800 truncate" title={name}>{name}</h3>
          </div>
          <p className="text-xs mt-0.5 truncate" style={{ color: INK.secondary }} title={`${a.campaignName || ''} › ${a.adsetName || ''}`}>
            {a.campaignName || 'No campaign'}{a.adsetName ? ` › ${a.adsetName}` : ''}
          </p>
          <p className="text-xs" style={{ color: INK.muted }}>Ran {fmtRange(a.firstDate, a.lastDate)}</p>
          <AdNumberLine n={number} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button onClick={onPreview} className={smallBtn}><Eye className="w-3 h-3" /> Preview</button>
          <button onClick={onToggle} disabled={!canToggle || busy} title={canToggle ? '' : 'Change this ad in Meta Ads Manager'} className={smallBtn}>
            {a.status === 'ACTIVE' ? <><Pause className="w-3 h-3" /> Pause</> : <><Play className="w-3 h-3" /> Resume</>}
          </button>
          <button onClick={onBudget} disabled={!a.adsetId} className={smallBtn}><Wallet className="w-3 h-3" /> Budget</button>
          <button onClick={onCopy} disabled={busy} className={smallBtn} title="Make a switched-off copy in the same ad set"><Copy className="w-3 h-3" /> Duplicate</button>
          <button onClick={onOpen} aria-expanded={open} className={smallBtn}>
            Details <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-3">
        <Metric strong label="Spend" value={money(a.spend, currency)} />
        <Metric label="Clicks" value={fmtNum(a.clicks)} sub={`${fmtPct(a.ctr)} click rate`} />
        <Metric label="Meta conversations" value={fmtNum(a.metaConversations)} />
        <Metric label="CRM chats" value={fmtNum(a.chats)} sub={a.chats ? `${fmtNum(a.newContacts)} new · ${fmtNum(a.returning)} returning` : undefined} />
        <Metric label="Cost per chat" value={money(a.costPerChat, currency)} />
        <Metric label="Converted" value={fmtNum(a.converted)} sub={a.converted ? `${money(a.costPerConverted, currency)} each` : 'none yet'} />
      </dl>

      {open && (
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 pt-3 border-t border-slate-100">
          <Metric label="Impressions" value={fmtNum(a.impressions)} />
          <Metric label="Reach (sum of days)" value={fmtNum(a.reach)} sub="people can repeat across days" />
          <Metric label="Cost per click" value={money(a.costPerClick, currency)} />
          <Metric label="Cost per Meta conversation" value={money(a.costPerMetaConversation, currency)} />
          <Metric label="First result" value={fmtDay(a.firstDate) || '–'} />
          <Metric label="Latest result" value={fmtDay(a.lastDate) || '–'} />
          <Metric label="Ad ID" value={<span className="font-mono text-xs">{a.adId}</span>} />
          <Metric label="Ad set" value={<span className="text-xs">{a.adsetName || '–'}</span>} sub={a.adsetId ? <span className="font-mono">{a.adsetId}</span> : undefined} />
        </dl>
      )}
    </li>
  );
}

/** Page numbers to show: 1 … 4 5 6 … 12. */
function pageList(page: number, total: number): Array<number | '…'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set([1, total, page - 1, page, page + 1].filter(p => p >= 1 && p <= total));
  const sorted = [...set].sort((x, y) => x - y);
  const out: Array<number | '…'> = [];
  sorted.forEach((p, i) => { if (i && p - sorted[i - 1] > 1) out.push('…'); out.push(p); });
  return out;
}

interface PagerProps { page: number; totalPages: number; total: number; start: number; noun: string; onPage: (p: number) => void }

function Pager({ page, totalPages, total, start, noun, onPage }: PagerProps) {
  return (
    <nav className="flex flex-wrap items-center justify-between gap-2 px-3 pb-3" aria-label="Pages">
      <span className="text-xs text-slate-500">Showing {start + 1}–{Math.min(start + PAGE_SIZE, total)} of {total} {noun}</span>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button onClick={() => onPage(page - 1)} disabled={page <= 1} className={smallBtn} aria-label="Previous page"><ChevronLeft className="w-3.5 h-3.5" /></button>
          {pageList(page, totalPages).map((p, i) => p === '…'
            ? <span key={`gap${i}`} className="px-1 text-xs text-slate-400">…</span>
            : <button key={p} onClick={() => onPage(p)} aria-current={p === page ? 'page' : undefined}
                className={`min-w-[28px] px-2 py-1 rounded-lg text-xs font-semibold cursor-pointer border ${p === page ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}>{p}</button>)}
          <button onClick={() => onPage(page + 1)} disabled={page >= totalPages} className={smallBtn} aria-label="Next page"><ChevronRight className="w-3.5 h-3.5" /></button>
        </div>
      )}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Budget dialog: the daily budget behind the ad's ad set (or its campaign)
// ---------------------------------------------------------------------------

interface BudgetDialogProps { ad: AdRow; onClose: () => void; onSaved: () => void; showToast?: ShowToast }

function BudgetDialog({ ad, onClose, onSaved, showToast }: BudgetDialogProps) {
  const confirm = useConfirm();
  const [info, setInfo] = useState<BudgetInfo | null>(null);
  const [value, setValue] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<BudgetInfo>(`/api/ads/adsets/${ad.adsetId}/budget`)
      .then(r => { setInfo(r); setValue(String(r.dailyBudget)); })
      .catch(e => setErr(errorMessage(e)));
  }, [ad.adsetId]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!info) return;
    const n = Number(value);
    if (!await confirm(`Change the daily budget of ${info.level === 'campaign' ? 'campaign' : 'ad set'} "${info.name}" from ${money(info.dailyBudget, info.currency)} to ${money(n, info.currency)}?`)) return;
    setBusy(true); setErr('');
    try {
      await api(`/api/ads/adsets/${ad.adsetId}/budget`, { method: 'PUT', body: { dailyBudget: n } });
      showToast?.('Daily budget changed');
      onSaved();
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Change daily budget">
      <form onSubmit={save} className="bg-white rounded-xl shadow-xl w-full max-w-sm p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-800">Daily budget</h3>
            <p className="text-xs text-slate-500">For ad "{ad.adName || ad.adId}"</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        {!info && !err && <div className="text-xs text-slate-500">Asking Meta for the current budget…</div>}
        {info && (
          <>
            <p className="text-xs text-slate-600">
              Set on the {info.level === 'campaign' ? 'campaign' : 'ad set'} <strong>{info.name}</strong>
              {info.level === 'campaign' && ', so it applies to every ad set in that campaign'}.
              Now {money(info.dailyBudget, info.currency)} per day.
            </p>
            <label className="block text-xs text-slate-600">New daily budget ({info.currency})
              <input type="number" min="1" step="any" max={info.maxAllowed} value={value} onChange={e => setValue(e.target.value)} className={`${inputCls} mt-1`} />
              <span className="text-xs text-slate-500">Up to {money(info.maxAllowed, info.currency)} in one change. Meta has its own minimum.</span>
            </label>
          </>
        )}
        {err && <div className="p-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{err}</div>}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
          <button type="submit" disabled={!info || busy || !(Number(value) > 0)} className={btnPrimary}>{busy ? 'Saving…' : 'Change budget'}</button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cost alerts
// ---------------------------------------------------------------------------

interface AlertsCardProps {
  settings?: AlertSettings; alerts: CostAlert[]; windowDays?: number; currency: string; onSaved: () => void; showToast?: ShowToast;
}
/** The alert form: amounts as typed (empty = no limit). */
interface AlertForm { maxCostPerChat: number | string; maxCostPerConversion: number | string; windowDays: number | string; autoPause: boolean }

function AlertsCard({ settings, alerts, windowDays, currency, onSaved, showToast }: AlertsCardProps) {
  const s: Partial<AlertSettings> = settings || {};
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<AlertForm>({ maxCostPerChat: s.maxCostPerChat ?? '', maxCostPerConversion: s.maxCostPerConversion ?? '', windowDays: s.windowDays || 3, autoPause: !!s.autoPause });
  const [busy, setBusy] = useState(false);
  const on = s.maxCostPerChat || s.maxCostPerConversion;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/api/ads/alerts', { method: 'PUT', body: { ...form, windowDays: Number(form.windowDays) } });
      showToast?.('Cost alerts saved');
      setEditing(false);
      onSaved();
    } catch (e2) {
      showToast?.(errorMessage(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`rounded-xl border p-3 ${alerts.length ? 'bg-red-50 border-red-200' : 'bg-white'}`} style={alerts.length ? undefined : { borderColor: 'rgba(11,11,11,0.10)' }}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Bell className={`w-3.5 h-3.5 ${alerts.length ? 'text-red-700' : 'text-slate-500'}`} />
        <span className="font-semibold text-slate-800">Cost alerts</span>
        <span className="text-slate-600">
          {on
            ? <>{s.autoPause ? 'Pause' : 'Flag'} running ads over {[s.maxCostPerChat && `${money(s.maxCostPerChat, currency)} per chat`, s.maxCostPerConversion && `${money(s.maxCostPerConversion, currency)} per conversion`].filter(Boolean).join(' or ')} in the last {s.windowDays} day{s.windowDays === 1 ? '' : 's'}{s.autoPause ? ' (automatically, after each hourly sync)' : ''}.</>
            : 'Off. Set a limit to flag ads that cost too much per chat or per conversion.'}
        </span>
        <button onClick={() => setEditing(v => !v)} className="ml-auto underline text-slate-600 hover:text-slate-900 cursor-pointer">{editing ? 'Close' : 'Edit'}</button>
      </div>
      {alerts.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-red-800">
          {alerts.map(x => (
            <li key={`${x.adId}-${x.kind}`}>
              <strong>{x.adName || x.adId}</strong>: {money(x.spend, currency)} spent, {x.count ? `${money(x.cost, currency)} per ${x.kind}` : `no ${x.kind === 'chat' ? 'chats' : 'conversions'} yet`} (limit {money(x.max, currency)}) in the last {windowDays} day{windowDays === 1 ? '' : 's'}.
            </li>
          ))}
          <li className="text-red-700/80">Check the ad, then pause it or lower its budget from the table below. Conversions are counted when staff move a chat to Booked, so recent days can look worse than they are.</li>
        </ul>
      )}
      {editing && (
        <form onSubmit={save} className="mt-3 flex flex-wrap items-end gap-3 text-xs">
          <label className="text-slate-600">Max cost per chat ({currency})
            <input type="number" min="0" step="any" placeholder="no limit" value={form.maxCostPerChat} onChange={e => setForm(f => ({ ...f, maxCostPerChat: e.target.value }))} className={`${inputCls} mt-1 w-36`} />
          </label>
          <label className="text-slate-600">Max cost per conversion ({currency})
            <input type="number" min="0" step="any" placeholder="no limit" value={form.maxCostPerConversion} onChange={e => setForm(f => ({ ...f, maxCostPerConversion: e.target.value }))} className={`${inputCls} mt-1 w-36`} />
          </label>
          <label className="text-slate-600">Over the last
            <select value={form.windowDays} onChange={e => setForm(f => ({ ...f, windowDays: e.target.value }))} className={`${inputCls} mt-1 w-28`}>
              {[1, 3, 7, 14].map(d => <option key={d} value={d}>{d} day{d === 1 ? '' : 's'}</option>)}
            </select>
          </label>
          <label className="flex items-start gap-1.5 text-slate-700 basis-full cursor-pointer" data-testid="auto-pause">
            <input type="checkbox" checked={form.autoPause} onChange={e => setForm(f => ({ ...f, autoPause: e.target.checked }))} className="mt-0.5" />
            <span>
              <strong>Pause these ads automatically</strong>
              <span className="block text-xs text-slate-500">After each hourly sync, a running ad over a limit above is paused (at most {5} per hour) and listed under &quot;Needs attention&quot;. Nothing is ever switched back on automatically: resume it here when you&apos;re ready.</span>
            </span>
          </label>
          <button type="submit" disabled={busy} className={btnPrimary}>{busy ? 'Saving…' : 'Save alerts'}</button>
        </form>
      )}
    </section>
  );
}
