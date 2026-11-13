import { useRef, useState } from 'react';
import { X, Loader2, ImagePlus, AlertTriangle, Type, Users, Wallet } from 'lucide-react';
import { api, ApiError, errorMessage, inputCls, btnPrimary, btnSecondary } from './broadcastUtils';
import { refreshApi } from './queryClient';
import {
  Field, StepAudience, ScheduleFields, BudgetSummary, prepareImage, money, today, scheduleProblem, H_DEFAULTS,
  type Draft, type Limits, type Place, type Placement, type Schedule, type SetFn,
} from './AdCreateWizard';
import { ChatStartFields, TallPictureField } from './AdWizardExtras';
import type { AdPost } from './AdPostPicker';
import type { ShowToast } from './types';

// Ads G2: edit an ad made in the CRM (server/adCreate.cjs editAd). Words / picture changes go to Meta's review again;
// audience, budget, end date and hours change the running ad directly. The number it opens and "all day" vs "business
// hours" stay as created (Meta's rules): "Use as a start" makes a new ad for those.

/** The saved settings of an ad made here (ad_launches.spec). */
export interface LaunchSpec {
  text?: string; headline?: string; greeting?: string; imageHash?: string; imageUrl?: string;
  cards?: Array<{ imageHash: string; imageUrl?: string; headline?: string }>;
  locations?: Place[]; ageMin?: number; ageMax?: number; gender?: 'all' | 'male' | 'female'; placement?: Placement;
  startDate?: string; endDate?: string | null; schedule?: Schedule | null; number?: string; useInstagram?: boolean;
  // Phase H
  iceBreakers?: string[]; tallImageHash?: string | null; tallImageUrl?: string; videoId?: string | null;
  interests?: Array<{ id: string; name: string }>; excludedLocations?: Place[]; languages?: Array<{ key: number; name: string }>;
  // Phase I
  post?: AdPost | null; addedTo?: string; sharedAdset?: boolean;
}
export interface EditableLaunch { id: string; name: string; status: string; daily_budget: number; currency?: string; spec: LaunchSpec }

const toDraft = (l: EditableLaunch): Draft => {
  const s = l.spec || {};
  return {
    draftId: l.id, name: l.name, imageHash: s.imageHash || '', imageUrl: s.imageUrl || '', localImage: s.imageUrl || '',
    text: s.text || '', headline: s.headline || '', greeting: s.greeting || '',
    cards: (s.cards || []).map(c => ({ imageHash: c.imageHash, imageUrl: c.imageUrl || '', localImage: c.imageUrl || '', headline: c.headline || '' })),
    numberId: '', placement: s.placement || 'auto', useInstagram: s.useInstagram !== false,
    locations: s.locations || [], ageMin: s.ageMin ?? 18, ageMax: s.ageMax ?? 65, gender: s.gender || 'all',
    dailyBudget: String(l.daily_budget), startDate: s.startDate || today(), endDate: s.endDate || '', schedule: s.schedule || null,
    ...H_DEFAULTS,
    chatStart: s.iceBreakers?.length ? 'questions' : 'prefill', iceBreakers: s.iceBreakers || [],
    tallImageHash: s.tallImageHash || '', tallImageUrl: s.tallImageUrl || '', tallLocal: s.tallImageUrl || '',
    videoId: s.videoId || '', videoStatus: s.videoId ? 'ready' : '', videoName: s.videoId ? 'Video' : '',
    interests: s.interests || [], excludedLocations: s.excludedLocations || [], languages: s.languages || [],
    source: s.post ? 'post' : 'new', post: s.post || null,
  };
};

/** Only what changed is sent (the server works out what to change in Meta). */
function changesOf(a: Draft, b: Draft) {
  const out: Record<string, unknown> = {};
  for (const k of ['text', 'headline', 'greeting', 'endDate'] as const) if (a[k] !== b[k]) out[k] = b[k];
  if (a.imageHash !== b.imageHash) { out.imageHash = b.imageHash; out.imageUrl = b.imageUrl; }
  if (JSON.stringify(a.cards.map(c => c.headline)) !== JSON.stringify(b.cards.map(c => c.headline))) out.cards = b.cards.map(c => ({ headline: c.headline }));
  for (const k of ['locations', 'ageMin', 'ageMax', 'gender', 'placement', 'schedule', 'interests', 'excludedLocations', 'languages'] as const) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out[k] = b[k];
  if (Number(a.dailyBudget) !== Number(b.dailyBudget)) out.dailyBudget = Number(b.dailyBudget);
  // Phase H: quick questions (empty = back to a pre-typed message) and the tall picture.
  const ice = (x: Draft) => (x.chatStart === 'questions' ? x.iceBreakers.map(q => q.trim()).filter(Boolean) : []);
  if (JSON.stringify(ice(a)) !== JSON.stringify(ice(b))) out.iceBreakers = ice(b);
  if (a.tallImageHash !== b.tallImageHash) { out.tallImageHash = b.tallImageHash; out.tallImageUrl = b.tallImageUrl; }
  return out;
}

export default function AdEditDialog({ launch, limits, onClose, showToast }: { launch: EditableLaunch; limits: Limits; onClose: () => void; showToast?: ShowToast }) {
  const [original] = useState(() => toDraft(launch));
  const [d, setD] = useState<Draft>(original);
  const post = launch.spec.post || null;
  const shared = launch.spec.sharedAdset === true; // I1: audience, budget and dates belong to the ad it was added to
  const [tab, setTab] = useState<'words' | 'audience' | 'budget'>(post && !shared ? 'audience' : 'words');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirm, setConfirm] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const set: SetFn = (k, v) => setD(x => ({ ...x, [k]: v }));
  const carousel = d.cards.length >= 2;
  const changes = changesOf(original, d);
  const changedWords = ['text', 'headline', 'greeting', 'imageHash', 'cards', 'iceBreakers', 'tallImageHash'].some(k => k in changes);
  const raising = Number(d.dailyBudget) > Number(original.dailyBudget);
  const launched = launch.status === 'launched';

  const pickPicture = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setErr('');
    try {
      const { base64, dataUrl } = await prepareImage(file);
      const r = await api<{ imageHash: string; imageUrl: string }>('/api/ads/create/image', { method: 'POST', body: { base64 } });
      setD(x => ({ ...x, imageHash: r.imageHash, imageUrl: r.imageUrl, localImage: dataUrl }));
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const save = async () => {
    setErr('');
    if (!post && !d.text.trim()) { setTab('words'); setErr('Write the ad text.'); return; }
    if (!d.locations.length) { setTab('audience'); setErr('Choose at least one place.'); return; }
    if (!(Number(d.dailyBudget) > 0)) { setTab('budget'); setErr('Enter a daily budget.'); return; }
    if (Number(d.dailyBudget) > limits.maxDailyBudget) { setTab('budget'); setErr(`The most one ad may spend per day is ${money(limits.maxDailyBudget, limits.currency)}.`); return; }
    const sp = scheduleProblem(d.schedule, d.startDate, d.endDate);
    if (sp) { setTab('budget'); setErr(sp); return; }
    if (raising && Number(confirm) !== Number(d.dailyBudget)) { setTab('budget'); setErr(`Type the new daily amount (${d.dailyBudget}) to confirm the increase.`); return; }
    setBusy(true);
    try {
      const r = await api<{ changed: string[]; review?: boolean; unchanged?: boolean }>(`/api/ads/launches/${launch.id}`, { method: 'PUT', body: { ...changes, ...(raising ? { confirmBudget: Number(confirm) } : {}) } });
      await refreshApi('/api/ads/launches');
      showToast?.(r.unchanged ? 'Nothing changed' : `Saved in Meta: ${r.changed.join(', ')}${r.review ? '. Meta reviews the new words / picture (usually within a few hours).' : ''}`);
      onClose();
    } catch (e) {
      const more = e instanceof ApiError && Array.isArray(e.data?.problems) && e.data.problems.length > 1 ? ` (${e.data.problems.length - 1} more)` : '';
      setErr(errorMessage(e) + more);
    } finally { setBusy(false); }
  };

  const TABS = ([['words', 'Words and picture', Type], ['audience', 'Who sees it', Users], ['budget', 'Budget and dates', Wallet]] as const)
    .filter(([id]) => !(shared && id !== 'words'));
  return (
    <div className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label={`Edit ${launch.name}`}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[94vh] flex flex-col" data-testid="ad-edit">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-800">Edit “{launch.name}”</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 cursor-pointer" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-4 pt-3 flex flex-wrap gap-1 border-b border-slate-100" role="tablist">
          {TABS.map(([id, label, Icon]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
              className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px flex items-center gap-1.5 cursor-pointer ${tab === id ? 'border-wa-teal text-wa-teal' : 'border-transparent text-slate-500'}`}>
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>
        <div className="p-4 overflow-y-auto flex-1 space-y-3">
          {shared && (
            <p className="text-xs text-slate-600 p-2 bg-violet-50 border border-violet-200 rounded-lg" data-testid="ad-edit-shared">
              This ad shares its audience, budget and dates with the first ad of the campaign. Change those on that ad; they apply to both.
            </p>
          )}
          {tab === 'words' && post && (
            <div className="flex gap-3 items-start text-xs" data-testid="ad-edit-post">
              {post.pictureUrl && <img src={post.pictureUrl} alt="The post" className="w-28 h-28 rounded-lg object-cover" referrerPolicy="no-referrer" />}
              <div className="space-y-1 min-w-0">
                <p className="font-semibold text-slate-800">{post.source === 'instagram' ? 'Instagram' : 'Facebook'} post</p>
                <p className="text-slate-600 whitespace-pre-wrap line-clamp-5">{post.caption || 'No caption'}</p>
                <p className="text-xs text-slate-500">The words and picture are the post&apos;s own and can&apos;t be changed here. To promote another post, use &quot;Add an ad to this campaign&quot;.</p>
              </div>
            </div>
          )}
          {tab === 'words' && !post && (
            <div className="grid md:grid-cols-[200px_1fr] gap-4">
              <div>
                {carousel ? (
                  <div className="space-y-1.5">
                    <div className="text-xs font-semibold text-slate-700">Carousel: {d.cards.length} pictures</div>
                    {d.cards.map((c, i) => (
                      <div key={`${c.imageHash}-${i}`} className="flex gap-2 items-center">
                        {c.localImage ? <img src={c.localImage} alt={`Picture ${i + 1}`} className="w-10 h-10 rounded object-cover" /> : <div className="w-10 h-10 rounded bg-slate-100" />}
                        <input value={c.headline} onChange={e => set('cards', d.cards.map((x, j) => (j === i ? { ...x, headline: e.target.value } : x)))} maxLength={40}
                          placeholder={`Headline ${i + 1}`} className="flex-1 border border-slate-200 rounded px-1.5 py-1 text-xs" aria-label={`Headline for picture ${i + 1}`} />
                      </div>
                    ))}
                    <p className="text-xs text-slate-400">Carousel pictures can&apos;t be swapped here; &quot;Use as a start&quot; makes a new ad.</p>
                  </div>
                ) : (
                  <>
                    <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="w-full aspect-square rounded-xl border-2 border-dashed border-slate-300 hover:border-wa-teal bg-slate-50 flex items-center justify-center overflow-hidden cursor-pointer" aria-label="Change the picture">
                      {busy ? <Loader2 className="w-6 h-6 animate-spin text-slate-400" /> : d.localImage ? <img src={d.localImage} alt="Ad picture" className="w-full h-full object-cover" /> : <ImagePlus className="w-6 h-6 text-slate-400" />}
                    </button>
                    <input ref={fileRef} type="file" accept="image/jpeg,image/png" className="hidden" onChange={e => pickPicture(e.target.files?.[0])} data-testid="ad-edit-image" />
                    <p className="text-xs text-slate-400 mt-1">{d.videoId ? 'Click to change the video\'s cover picture. The video itself can\'t be swapped here ("Use as a start" makes a new ad).' : 'Click to change the picture.'}</p>
                    <TallPictureField d={d} set={set} />
                  </>
                )}
              </div>
              <div className="space-y-3">
                <Field label="Ad text" count={d.text.length} max={1000}><textarea rows={4} value={d.text} onChange={e => set('text', e.target.value)} maxLength={1000} className={inputCls} aria-label="Ad text" /></Field>
                {!carousel && <Field label="Headline (optional)" count={d.headline.length} max={40}><input value={d.headline} onChange={e => set('headline', e.target.value)} maxLength={40} className={inputCls} aria-label="Headline" /></Field>}
                <ChatStartFields d={d} set={set} />
                {launched && changedWords && (
                  <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 flex gap-1.5" data-testid="ad-edit-review-note">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px" /> New words or a new picture go to Meta&apos;s review again. The ad may stop showing until it&apos;s approved (usually a few hours).
                  </div>
                )}
              </div>
            </div>
          )}
          {tab === 'audience' && <StepAudience d={d} set={set} statusAllowed={limits.statusAllowed !== false} />}
          {tab === 'budget' && (
            <div className="space-y-4 max-w-md">
              {d.schedule ? (
                <fieldset className="border border-slate-200 rounded-lg p-3 space-y-2">
                  <legend className="text-xs font-semibold text-slate-700 px-1">Runs only during these hours</legend>
                  <ScheduleFields schedule={d.schedule} onChange={s => set('schedule', s)} timezone={limits.timezone} />
                </fieldset>
              ) : <p className="text-xs text-slate-500">This ad runs all day, every day. Meta doesn&apos;t let it switch to set hours; use &quot;Use as a start&quot; for a business-hours copy.</p>}
              <Field label={`Daily budget (${limits.currency})`} hint={`At most ${money(limits.maxDailyBudget, limits.currency)} (your Business Admin's limit).`}>
                <input type="number" min={limits.minDailyBudget || 1} max={limits.maxDailyBudget} value={d.dailyBudget} onChange={e => set('dailyBudget', e.target.value)} className={inputCls} aria-label="Daily budget" />
              </Field>
              {raising && (
                <Field label={`Type the new daily amount (${d.dailyBudget}) to confirm the increase`}>
                  <input value={confirm} onChange={e => setConfirm(e.target.value)} inputMode="decimal" className={inputCls} aria-label="Confirm the new daily amount" />
                </Field>
              )}
              <Field label={d.schedule ? 'End' : 'End (optional)'} hint={original.endDate ? 'Can be moved, not removed.' : 'Leave empty to run until you pause it.'}>
                <input type="date" min={today()} value={d.endDate} onChange={e => set('endDate', e.target.value)} className={inputCls} aria-label="End date" />
              </Field>
              <BudgetSummary d={d} currency={limits.currency} />
              <p className="text-xs text-slate-500">Started {d.startDate}. The number the ad opens can&apos;t change after creation.</p>
            </div>
          )}
          {err && <div role="alert" className="p-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{err}</div>}
        </div>
        <div className="px-4 py-3 border-t border-slate-200 flex items-center gap-2">
          <span className="text-xs text-slate-500">{Object.keys(changes).length ? `${Object.keys(changes).length} change${Object.keys(changes).length === 1 ? '' : 's'} not saved` : 'No changes yet'}</span>
          <button onClick={onClose} className={`${btnSecondary} ml-auto`}>Cancel</button>
          <button onClick={save} disabled={busy || !Object.keys(changes).length} className={btnPrimary}>{busy ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving in Meta…</> : 'Save changes'}</button>
        </div>
      </div>
    </div>
  );
}
