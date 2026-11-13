import { useState } from 'react';
import { Sparkles, CheckCircle2, XCircle, HelpCircle, ExternalLink, RotateCw, Save, Plus } from 'lucide-react';
import { api, errorMessage, inputCls, btnPrimary, btnSecondary } from './broadcastUtils';
import { useApi, refreshApi, errorOf } from './queryClient';
import AdCreateWizard, { LaunchBox, type CreatedLaunch, type AdNumber, type AdTemplate, type AddTo, type Limits } from './AdCreateWizard';
import AdEditDialog, { type LaunchSpec } from './AdEditDialog';
import type { ShowToast } from './types';
import { useConfirm } from './confirm';

// Ads phase D1: "Create ads from the CRM" — is everything ready in Meta? (server/adCreate.cjs)
// Shown as the "Create WhatsApp ads" tab of the Ads page. The check asks Meta a few questions, so it runs
// only when the tab is opened (and on "Check again"). The Business Admin chooses the Facebook Page and the
// daily budget cap; managers see the checklist.

interface Check { key: string; ok: boolean | null; label: string; detail: string; fix?: string[]; link?: { href: string; text: string } }
interface Readiness {
  ready: boolean; checks: Check[]; pages: Array<{ id: string; name: string }>; selectedPageId: string | null;
  currency: string; minDailyBudget: number | null; maxDailyBudget: number; businessNumber: string;
  /** Several WhatsApp numbers: the one the ads open (linked to the Page). */
  adNumber?: { phone: string; label: string } | null;
  /** Ads E2: every business number, for "Opens a chat with". */
  numbers?: AdNumber[];
  /** Ads E3: false for healthcare / pharma (no WhatsApp Status ads). */
  statusAllowed?: boolean;
  /** Ads F2: the Instagram account ads show as on Instagram (null = the Facebook Page). */
  instagram?: { id: string; username: string } | null;
  /** Ads G1: the business's own hours and the ad account's time zone. */
  businessHours?: { start: number; end: number } | null;
  timezone?: string | null;
}
/** What the wizard and the Edit dialog need from the check. */
const limitsOf = (data: Readiness): Limits => ({
  currency: data.currency, minDailyBudget: data.minDailyBudget, maxDailyBudget: data.maxDailyBudget, numbers: data.numbers || [],
  statusAllowed: data.statusAllowed !== false, instagram: data.instagram || null, businessHours: data.businessHours || null, timezone: data.timezone || null,
});

export default function AdsCreateReady({ isOwner, showToast }: { isOwner: boolean; showToast?: ShowToast }) {
  const q = useApi<Readiness>('/api/ads/create/readiness', { staleTime: 5 * 60000 });
  const [wizard, setWizard] = useState(false);
  const [template, setTemplate] = useState<AdTemplate | null>(null); // F4: "Use as a start"
  const [addTo, setAddTo] = useState<AddTo | null>(null); // I1: "Add an ad to this campaign"
  const data = q.data || null;
  const error = errorOf(q);
  const done = data ? data.checks.filter(c => c.ok === true).length : 0;

  return (
    <section className="rounded-xl border bg-white" style={{ borderColor: 'rgba(11,11,11,0.10)' }} data-testid="ads-create-ready">
      <div className="flex items-center gap-2 px-4 py-3">
        <Sparkles className="w-4 h-4 text-violet-600" />
        <span className="text-sm font-semibold text-slate-800">Create WhatsApp ads from the CRM</span>
        {data && (
          <span className={`text-xs ${data.ready ? 'text-emerald-700' : 'text-amber-700'}`} data-testid="ads-ready-count">
            {data.ready ? 'Ready' : `${done} of ${data.checks.length} ready`}
          </span>
        )}
      </div>

      <div className="px-4 pb-4 space-y-3 border-t border-slate-100 pt-3">
          <p className="text-xs text-slate-600">
            Create a simple "message us on WhatsApp" ad here (picture, text, area, daily budget) without opening Meta Ads
            Manager. It's created switched off; you launch it when you're happy. Meta needs a few things first; this checks them.
          </p>
          {error && <div className="p-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>}
          {!data && !error && <div className="text-xs text-slate-500">Asking Meta…</div>}
          {data && (
            <>
              <ul className="space-y-2">
                {data.checks.map(c => <CheckRow key={c.key} c={c} />)}
              </ul>
              {data.adNumber && (
                <div className="text-xs text-slate-700 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2" data-testid="ad-number">
                  📱 Ads open a WhatsApp chat with <strong>{data.adNumber.label || 'your number'}</strong> (+{data.adNumber.phone}), the number linked to the Page.
                  To use another of your numbers, link that one to the Page in Facebook, then press &quot;Check again&quot;.
                </div>
              )}
              <div className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2" data-testid="ad-instagram">
                {data.instagram
                  ? <>📸 On Instagram, ads show as <strong>@{data.instagram.username || data.instagram.id}</strong> (the Instagram account connected to the Page).</>
                  : <>📸 On Instagram, ads show as the Facebook Page: no Instagram account is connected to it (or the token can&apos;t see it). To show as your Instagram account, connect it to the Page in Meta Business settings → Instagram accounts, then press &quot;Check again&quot;.</>}
              </div>
              {data.pages.length > 1 && <PagePicker data={data} isOwner={isOwner} showToast={showToast} />}
              <BudgetCap data={data} isOwner={isOwner} showToast={showToast} />
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button onClick={() => refreshApi('/api/ads/create/readiness')} disabled={q.isFetching} className={btnSecondary}>
                  <RotateCw className={`w-3.5 h-3.5 ${q.isFetching ? 'animate-spin' : ''}`} /> Check again
                </button>
                <button onClick={() => { setTemplate(null); setAddTo(null); setWizard(true); }} disabled={!data.ready || !isOwner} className={btnPrimary}
                  title={!isOwner ? 'Only the Business Admin creates ads' : data.ready ? '' : 'Fix the items marked ✗ first'}>
                  <Sparkles className="w-3.5 h-3.5" /> Create an ad
                </button>
                <span className="text-xs text-slate-500">
                  {!data.ready ? 'Fix the items marked ✗, then press "Check again".' : !isOwner ? 'Only the Business Admin creates and launches ads.' : 'Ready.'}
                </span>
              </div>
              <CreatedList isOwner={isOwner} showToast={showToast} limits={limitsOf(data)}
                onReuse={t => { setAddTo(null); setTemplate(t); setWizard(true); }}
                onAdd={data.ready ? (l => { setTemplate(null); setAddTo(l); setWizard(true); }) : undefined} />
            </>
          )}
      </div>
      {wizard && data && (
        <AdCreateWizard key={addTo?.id || template?.name || 'new'} limits={limitsOf(data)}
          template={template} addTo={addTo}
          onClose={() => { setWizard(false); setAddTo(null); }} showToast={showToast} />
      )}
    </section>
  );
}

interface LaunchRow extends CreatedLaunch {
  error?: string | null; created_by: string; created_at: string; launched_by?: string | null; launched_at?: string | null;
  campaign_id?: string | null; adset_id?: string | null;
  spec?: LaunchSpec;
  /** G1: "Mon, Tue…, 9am–8pm" when it runs only in business hours. */
  scheduleLabel?: string | null;
  /** F4: what a new ad can start from (server/adCreate.cjs reuseOf). */
  template?: AdTemplate;
}
const LAUNCH_STATUS: Record<string, [string, string]> = {
  created: ['Created, switched off', 'bg-slate-100 text-slate-700'],
  launched: ['Launched', 'bg-emerald-50 text-emerald-800'],
  failed: ['Failed', 'bg-red-50 text-red-700'],
  creating: ['Creating…', 'bg-amber-50 text-amber-900'],
};

/**
 * Pure: the ads made here grouped by campaign (I1), each campaign's first ad first, campaigns newest first.
 * Ads that never reached Meta (no campaign) stand alone.
 */
function groupByCampaign<T extends { id: string; campaign_id?: string | null; created_at: string }>(rows: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const key = r.campaign_id || `solo:${r.id}`;
    groups.set(key, [...(groups.get(key) || []), r]);
  }
  return [...groups.values()]
    .map(g => [...g].sort((a, b) => a.created_at.localeCompare(b.created_at)))
    .sort((a, b) => b[b.length - 1].created_at.localeCompare(a[a.length - 1].created_at));
}

/** Ads created from the CRM, grouped by campaign; paused ones can be launched here, and campaigns get more ads (I1). */
function CreatedList({ isOwner, showToast, onReuse, onAdd, limits }: { isOwner: boolean; showToast?: ShowToast; onReuse?: (t: AdTemplate) => void; onAdd?: (l: AddTo) => void; limits: Limits }) {
  const q = useApi<{ launches: LaunchRow[] }>('/api/ads/launches', { staleTime: 60000 });
  const rows = q.data?.launches || [];
  const [launching, setLaunching] = useState<string | null>(null);
  const [editing, setEditing] = useState<LaunchRow | null>(null); // G2
  if (!rows.length) return null;
  const groups = groupByCampaign(rows);
  const rowProps = { isOwner, showToast, onReuse, launching, setLaunching, setEditing };

  return (
    <div className="pt-2 border-t border-slate-100">
      <div className="text-xs font-semibold text-slate-700 mb-1.5">Created here</div>
      <ul className="space-y-2">
        {groups.map(g => {
          const first = g[0];
          const ok = g.filter(l => l.status === 'created' || l.status === 'launched');
          const canAdd = isOwner && !!onAdd && !!first.campaign_id && ok.length > 0 && ok.length < MAX_ADS_PER_CAMPAIGN;
          // Add to the campaign's first complete ad (its audience is the one "same audience" shares).
          const base = ok.find(l => !l.spec?.sharedAdset) || ok[0];
          return (
            <li key={first.campaign_id || first.id} data-testid="ad-campaign-group">
              {g.length > 1 && <div className="text-xs font-semibold text-slate-500 mb-1">Campaign “{first.name}” · {g.length} ads</div>}
              <ul className="space-y-1.5">
                {g.map(l => <LaunchItem key={l.id} l={l} inGroup={g.length > 1} {...rowProps} />)}
              </ul>
              {canAdd && base && (
                <button onClick={() => onAdd?.({ id: base.id, name: base.name, daily_budget: base.daily_budget, spec: (base.spec || {}) as Record<string, unknown> })}
                  className="mt-1 text-xs font-semibold text-wa-teal hover:underline cursor-pointer flex items-center gap-1" data-testid="ad-add-to-campaign">
                  <Plus className="w-3.5 h-3.5" /> Add an ad to this campaign
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {editing?.spec && <AdEditDialog launch={{ ...editing, spec: editing.spec }} limits={limits} onClose={() => setEditing(null)} showToast={showToast} />}
    </div>
  );
}
const MAX_ADS_PER_CAMPAIGN = 10; // same as the server (adCreate.cjs)

/** One ad made here, with Edit / Use as a start / Launch. */
function LaunchItem({ l, inGroup, isOwner, showToast, onReuse, launching, setLaunching, setEditing }: {
  l: LaunchRow; inGroup: boolean; isOwner: boolean; showToast?: ShowToast; onReuse?: (t: AdTemplate) => void;
  launching: string | null; setLaunching: (id: string | null) => void; setEditing: (l: LaunchRow) => void;
}) {
    const [label, cls] = LAUNCH_STATUS[l.status] || [l.status, 'bg-slate-100 text-slate-700'];
    const pic = l.spec?.post?.pictureUrl || l.spec?.imageUrl;
    const confirm = useConfirm();
    const [deleting, setDeleting] = useState(false);
    const inMeta = (l.status === 'created' || l.status === 'launched') && !!l.ad_id;
    const remove = async () => {
      const ok = await confirm(inMeta ? {
        title: `Delete “${l.name}”?`,
        body: `${l.status === 'launched' ? 'It stops running and ' : ''}it is deleted in Meta, with its audience and campaign when no other ad uses them. Other ads in the same campaign stay. Money already spent stays in the results. This can't be undone.`,
        confirmLabel: 'Delete ad', danger: true,
      } : {
        title: 'Remove from the list?', body: 'This attempt never became an ad in Meta, so nothing else changes.', confirmLabel: 'Remove',
      });
      if (!ok) return;
      setDeleting(true);
      try {
        await api(`/api/ads/launches/${l.id}`, { method: 'DELETE' });
        showToast?.(inMeta ? 'Ad deleted in Meta' : 'Removed from the list');
        await refreshApi('/api/ads/launches');
      } catch (e) {
        showToast?.(errorMessage(e));
      } finally {
        setDeleting(false);
      }
    };
    return (
      <li className={`rounded-lg border border-slate-100 p-2 text-xs ${inGroup ? 'bg-slate-50/60' : ''}`} data-testid="ad-launch-row">
        <div className="flex flex-wrap items-center gap-2">
          {pic && !pic.startsWith('data:') && <img src={pic} alt="" className="w-8 h-8 rounded object-cover" referrerPolicy="no-referrer" />}
          <span className="font-semibold text-slate-800">{l.name}</span>
          <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${cls}`}>{label}</span>
          {l.spec?.post && <span className="px-1.5 py-0.5 rounded text-xs font-semibold bg-sky-50 text-sky-800">{l.spec.post.source === 'instagram' ? 'Instagram post' : 'Facebook post'}</span>}
          {l.spec?.addedTo && <span className="px-1.5 py-0.5 rounded text-xs font-semibold bg-violet-50 text-violet-800">{l.spec.sharedAdset ? 'Same audience & budget' : 'Own audience & budget'}</span>}
          <span className="text-slate-500">
            {l.spec?.sharedAdset ? 'shares the budget above' : `${l.currency || ''} ${l.daily_budget}/day`}{l.scheduleLabel && !l.spec?.sharedAdset ? ` · ${l.scheduleLabel}` : ''}{l.spec?.endDate && !l.spec?.sharedAdset ? ` · until ${l.spec.endDate}` : ''} · by {l.created_by} · {new Date(l.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          </span>
          <span className="ml-auto flex gap-1.5">
            {isOwner && (l.status === 'created' || l.status === 'launched') && l.spec && (
              <button onClick={() => setEditing(l)} className={btnSecondary} title={l.spec.post ? 'Change the audience, budget, end date or hours' : 'Change the words, picture, audience, budget, end date or hours'}>Edit</button>
            )}
            {isOwner && onReuse && l.template && (l.template.imageHash || l.template.cards.length >= 2 || l.template.post) && (
              <button onClick={() => l.template && onReuse(l.template)} className={btnSecondary} title="Open the wizard with this ad's text, pictures, audience and budget">Use as a start</button>
            )}
            {l.status === 'created' && isOwner && launching !== l.id && (
              <button onClick={() => setLaunching(l.id)} className={btnSecondary}>Launch…</button>
            )}
            {isOwner && (
              <button onClick={remove} disabled={deleting} className={`${btnSecondary} text-red-700`} data-testid="ad-delete"
                title={inMeta ? 'Delete this ad in Meta' : 'Remove this attempt from the list'}>
                {deleting ? 'Deleting…' : inMeta ? 'Delete' : 'Remove'}
              </button>
            )}
          </span>
        </div>
        {l.status === 'failed' && l.error && <div className="text-red-700 mt-1">{l.error}</div>}
        {launching === l.id && (
          <div className="mt-2">
            {l.spec?.sharedAdset && <p className="text-xs text-slate-500 mb-1">This ad shares the audience and budget of the first ad; launching it also switches that audience on.</p>}
            <LaunchBox launch={l} showToast={showToast} onLaunched={() => setLaunching(null)} />
          </div>
        )}
      </li>
    );
}

function CheckRow({ c }: { c: Check }) {
  const Icon = c.ok === true ? CheckCircle2 : c.ok === null ? HelpCircle : XCircle;
  const tone = c.ok === true ? 'text-emerald-600' : c.ok === null ? 'text-slate-400' : 'text-red-600';
  return (
    <li className={`rounded-lg border p-2.5 ${c.ok === false ? 'border-red-100 bg-red-50/40' : 'border-slate-100'}`}>
      <div className="flex items-start gap-2">
        <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${tone}`} aria-label={c.ok === true ? 'Done' : c.ok === null ? 'Unknown' : 'To do'} />
        <div className="min-w-0 text-xs">
          <div className="font-semibold text-slate-800">{c.label}</div>
          <div className="text-slate-600">{c.detail}</div>
          {c.fix && (
            <ol className="list-decimal pl-4 mt-1.5 space-y-0.5 text-slate-700">
              {c.fix.map((f, i) => <li key={i}>{f}</li>)}
            </ol>
          )}
          {c.link && (
            <a href={c.link.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 mt-1.5 text-wa-teal font-semibold hover:underline">
              {c.link.text} <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>
    </li>
  );
}

function PagePicker({ data, isOwner, showToast }: { data: Readiness; isOwner: boolean; showToast?: ShowToast }) {
  const [busy, setBusy] = useState(false);
  const choose = async (pageId: string) => {
    setBusy(true);
    try {
      await api('/api/ads/create/page', { method: 'PUT', body: { pageId } });
      showToast?.('Page saved');
      await refreshApi('/api/ads/create/readiness');
    } catch (e) {
      showToast?.(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <label className="block text-xs text-slate-600">Facebook Page the ads run as
      <select value={data.selectedPageId || ''} disabled={!isOwner || busy} onChange={e => e.target.value && choose(e.target.value)} className={`${inputCls} mt-1 max-w-sm`}>
        <option value="">Choose a Page…</option>
        {data.pages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {!isOwner && <span className="text-xs text-slate-400">Only the Business Admin can change this.</span>}
    </label>
  );
}

function BudgetCap({ data, isOwner, showToast }: { data: Readiness; isOwner: boolean; showToast?: ShowToast }) {
  const [value, setValue] = useState(String(data.maxDailyBudget));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api('/api/ads/create/budget-cap', { method: 'PUT', body: { maxDailyBudget: Number(value) } });
      showToast?.('Daily budget cap saved');
      await refreshApi('/api/ads/create/readiness');
    } catch (e) {
      showToast?.(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const tooLow = data.minDailyBudget !== null && Number(value) < data.minDailyBudget;
  return (
    <div className="text-xs text-slate-600">
      <label className="block">Most one ad may spend per day ({data.currency})
        <div className="flex gap-2 mt-1 max-w-sm">
          <input type="number" min={1} step="any" value={value} onChange={e => setValue(e.target.value)} disabled={!isOwner || busy} className={inputCls} />
          {isOwner && <button type="button" onClick={save} disabled={busy || Number(value) === data.maxDailyBudget || !(Number(value) > 0)} className={btnSecondary}><Save className="w-3.5 h-3.5" /> Save</button>}
        </div>
      </label>
      <span className="text-xs text-slate-400">
        A safety limit for ads created here (you can still set any budget in Meta). {data.minDailyBudget !== null && `Meta's minimum is ${data.currency} ${data.minDailyBudget}.`}
        {tooLow && <span className="text-amber-700"> This is below Meta's minimum, so no ad could run.</span>}
        {!isOwner && ' Only the Business Admin can change it.'}
      </span>
    </div>
  );
}
