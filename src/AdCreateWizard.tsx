import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChatStartFields, TallPictureField, VideoField, TargetingExtras } from './AdWizardExtras';
import AdPostPicker, { type AdPost } from './AdPostPicker';
import { X, ImagePlus, MapPin, Users, Wallet, Eye, Search, Loader2, AlertTriangle, CheckCircle2, Rocket, Trash2 } from 'lucide-react';
import { api, ApiError, errorMessage, inputCls, btnPrimary, btnSecondary } from './broadcastUtils';
import { refreshApi } from './queryClient';
import type { ShowToast } from './types';

// Ads phase D2: create a Click-to-WhatsApp ad in 4 steps (server/adCreate.cjs). The ad is created PAUSED in
// Meta; a separate Launch (typing the daily budget again) switches it on and sends it to Meta's review.

export interface Place { key: string; type: string; name: string; region?: string; country?: string; countryCode?: string; radius?: number | null }
/** One carousel picture (E4). localImage stays in this browser. */
interface Card { imageHash: string; imageUrl: string; localImage: string; headline: string }
export type Placement = 'auto' | 'feeds_stories' | 'with_status';
/** G1: the ad runs only on these days (0 = Sunday) and hours (ad account time). */
export interface Schedule { days: number[]; startHour: number; endHour: number }
export interface Draft {
  draftId: string; name: string; imageHash: string;
  /** Meta's link to the uploaded picture (saved with the ad's record). */
  imageUrl: string;
  /** The picture in this browser, for display only: never sent to the server (too large). */
  localImage: string;
  text: string; headline: string; greeting: string;
  /** E4: 2-10 pictures make a carousel; empty = one picture (as before). */
  cards: Card[];
  /** E2: the business number the ad opens ('' = the one linked to the Page). */
  numberId: string;
  /** E3: where the ad shows. */
  placement: Placement;
  /** F2: show as the Page's Instagram account on Instagram (when it has one). */
  useInstagram: boolean;
  locations: Place[]; ageMin: number; ageMax: number; gender: 'all' | 'male' | 'female';
  dailyBudget: string; startDate: string; endDate: string;
  /** G1: null = all day, every day. */
  schedule: Schedule | null;
  // ---- Phase H ----
  /** H1: how the chat starts: a pre-typed message, or quick questions to tap (ice breakers). */
  chatStart: 'prefill' | 'questions';
  iceBreakers: string[];
  /** H2: a tall (9:16) picture for Stories, Reels and Status (single-picture ads); tallLocal is browser-only. */
  tallImageHash: string; tallImageUrl: string; tallLocal: string;
  /** H3: a video (Meta's id once uploaded); the picture becomes its cover. videoPath = our temporary copy. */
  videoId: string; videoPath: string; videoName: string; videoStatus: '' | 'uploading' | 'processing' | 'ready' | 'error';
  /** H4: interests, places to leave out, languages. */
  interests: Array<{ id: string; name: string }>;
  excludedLocations: Place[];
  languages: Array<{ key: number; name: string }>;
  // ---- Phase I ----
  /** I2: a new picture / video, or an existing Facebook or Instagram post. */
  source: 'new' | 'post';
  post: AdPost | null;
}
/** I1: adding an ad to a campaign made here: the ad it is added to, and how. */
export interface AddTo { id: string; name: string; daily_budget: number; spec: Record<string, unknown> }
export type AddMode = 'same_audience' | 'new_audience';
interface Check { blocks: string[]; warnings: string[] }
export interface CreatedLaunch { id: string; name: string; status: string; daily_budget: number; currency?: string; ad_id?: string }
/** A business number the ad can open (from the readiness check). */
export interface AdNumber { id: string; label: string; phone: string; main: boolean; linked: boolean }
export interface Limits {
  currency: string; minDailyBudget: number | null; maxDailyBudget: number;
  /** G1: the business's own hours (its send window), the default for "only in business hours". */
  businessHours?: { start: number; end: number } | null;
  /** The ad account's time zone (Meta runs the hours in it). */
  timezone?: string | null;
  numbers?: AdNumber[];
  /** Meta doesn't allow WhatsApp Status ads for healthcare / pharma. */
  statusAllowed?: boolean;
  /** F2: the Page's Instagram account (null = ads show as the Facebook Page on Instagram). */
  instagram?: { id: string; username: string } | null;
}
/** F4: an ad made here, as the starting point for a new one (server/adCreate.cjs reuseOf). */
export interface AdTemplate {
  name: string; text: string; headline: string; greeting: string; imageHash: string; imageUrl: string;
  cards: Array<{ imageHash: string; imageUrl: string; headline: string }>;
  locations: Place[]; ageMin: number; ageMax: number; gender: 'all' | 'male' | 'female';
  placement: Placement; number: string; useInstagram: boolean; dailyBudget: number | null;
  schedule?: Schedule | null;
  iceBreakers?: string[]; tallImageHash?: string; tallImageUrl?: string;
  interests?: Array<{ id: string; name: string }>; excludedLocations?: Place[]; languages?: Array<{ key: number; name: string }>;
  post?: AdPost | null;
}

const MAX_IMAGE_BYTES = 1024 * 1024;
const MAX_CARDS = 10;
/** What the server gets: everything but the in-browser pictures; a single picture sends no cards. */
export const payload = ({ localImage: _local, tallLocal: _tall, videoName: _vn, videoStatus: _vs, source, post, chatStart, iceBreakers, cards, numberId, tallImageHash, tallImageUrl, videoId, videoPath, ...rest }: Draft) => {
  // I2: an existing post is the whole creative (its own words and picture).
  if (source === 'post') return { ...rest, text: '', headline: '', greeting: '', imageHash: '', imageUrl: '', iceBreakers: [], post, ...(numberId ? { numberId } : {}) };
  return {
    ...rest,
    ...(cards.length >= 2 ? { cards: cards.map(({ localImage: _l, ...c }) => c), imageHash: cards[0].imageHash, imageUrl: cards[0].imageUrl } : {}),
    ...(numberId ? { numberId } : {}),
    iceBreakers: chatStart === 'questions' ? iceBreakers.map(q => q.trim()).filter(Boolean) : [],
    ...(tallImageHash && cards.length < 2 && !videoId ? { tallImageHash, tallImageUrl } : {}),
    ...(videoId ? { videoId, videoPath } : {}),
  };
};
/** Phase H (and I) fields for a new draft. */
export const H_DEFAULTS = {
  chatStart: 'prefill' as const, iceBreakers: [] as string[], tallImageHash: '', tallImageUrl: '', tallLocal: '',
  videoId: '', videoPath: '', videoName: '', videoStatus: '' as const, interests: [], excludedLocations: [], languages: [],
  source: 'new' as const, post: null,
};
export const PLACEMENT_LABEL: Record<Placement, string> = {
  auto: 'Automatic (Meta chooses)',
  feeds_stories: 'Facebook + Instagram: feeds, Stories, Reels',
  with_status: 'Facebook + Instagram + WhatsApp Status',
};
export const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
export const money = (n: number, c: string) => { try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(n); } catch { return `${c} ${n}`; } };

// ---- G1: business hours ----
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const hourLabel = (h: number) => (h === 0 || h === 24 ? '12 am' : h === 12 ? '12 pm' : h < 12 ? `${h} am` : `${h - 12} pm`);
/** "Mon–Sat, 9 am–8 pm" */
export const scheduleText = (s: Schedule) => `${s.days.length === 7 ? 'Every day' : s.days.map(d => DAY_NAMES[d]).join(', ')}, ${hourLabel(s.startHour)}–${hourLabel(s.endHour)}`;
/** Days in [start, end] that are scheduled days (same count as the server). */
export function scheduledDays(start: string, end: string, days: number[]) {
  let n = 0;
  for (let t = Date.parse(`${start}T00:00:00Z`), last = Date.parse(`${end}T00:00:00Z`); t <= last; t += 86400000) if (days.includes(new Date(t).getUTCDay())) n++;
  return n;
}
/** Default schedule: the business's own hours, Monday to Saturday. */
export const defaultSchedule = (hours?: { start: number; end: number } | null): Schedule => ({ days: [1, 2, 3, 4, 5, 6], startHour: hours?.start ?? 9, endHour: hours?.end ?? 20 });
export function scheduleProblem(s: Schedule | null, startDate: string, endDate: string): string {
  if (!s) return '';
  if (!s.days.length) return 'Choose at least one day.';
  if (s.startHour >= s.endHour) return 'The end hour must be after the start hour.';
  if (!endDate) return 'An ad that runs only in set hours needs an end date (Meta gives it one budget for the whole run).';
  if (endDate > startDate && !scheduledDays(startDate, endDate, s.days)) return 'None of the chosen days fall between the start and end dates.';
  return '';
}

/** Days and hours the ad runs (wizard and Edit). */
export function ScheduleFields({ schedule, onChange, timezone }: { schedule: Schedule; onChange: (s: Schedule) => void; timezone?: string | null }) {
  const toggle = (d: number) => onChange({ ...schedule, days: schedule.days.includes(d) ? schedule.days.filter(x => x !== d) : [...schedule.days, d].sort() });
  return (
    <div className="space-y-2" data-testid="ad-schedule">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Days the ad runs">
        {DAY_NAMES.map((n, d) => (
          <button key={n} type="button" onClick={() => toggle(d)} aria-pressed={schedule.days.includes(d)}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold border cursor-pointer ${schedule.days.includes(d) ? 'bg-wa-teal text-white border-wa-teal' : 'bg-white text-slate-600 border-slate-300'}`}>{n}</button>
        ))}
      </div>
      <div className="flex items-center gap-2 text-xs">
        <select value={schedule.startHour} onChange={e => onChange({ ...schedule, startHour: Number(e.target.value) })} className={inputCls} aria-label="From">
          {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
        </select>
        <span>to</span>
        <select value={schedule.endHour} onChange={e => onChange({ ...schedule, endHour: Number(e.target.value) })} className={inputCls} aria-label="Until">
          {Array.from({ length: 24 }, (_, h) => h + 1).map(h => <option key={h} value={h}>{hourLabel(h)}</option>)}
        </select>
      </div>
      <p className="text-xs text-slate-500">Whole hours{timezone ? `, ${timezone} time (your ad account's time zone)` : ', in your ad account\'s time zone'}. Outside these hours the ad doesn&apos;t show, so nobody messages while your team is away.</p>
    </div>
  );
}

/** Resize a photo to at most 1080 px and <= 1 MB JPEG (PNG kept if already small), as base64. */
export async function prepareImage(file: File): Promise<{ base64: string; dataUrl: string }> {
  if (!/^image\/(jpeg|png)$/.test(file.type)) throw new Error('Use a JPG or PNG picture.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('That picture could not be opened.')); i.src = url; });
    if (img.width < 400 || img.height < 400) throw new Error('Use a picture at least 400 × 400 pixels (1080 × 1080 is best).');
    const scale = Math.min(1, 1080 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const g = canvas.getContext('2d');
    if (!g) throw new Error('This browser cannot prepare the picture.');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const q of [0.9, 0.82, 0.74, 0.66, 0.58]) {
      const dataUrl = canvas.toDataURL('image/jpeg', q);
      const base64 = dataUrl.split(',')[1];
      if (base64.length * 0.75 <= MAX_IMAGE_BYTES) return { base64, dataUrl };
    }
    throw new Error('The picture is too detailed to make small enough. Try a simpler one.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

const STEPS = [
  { n: 1, label: 'Ad', icon: ImagePlus },
  { n: 2, label: 'Who sees it', icon: Users },
  { n: 3, label: 'Budget', icon: Wallet },
  { n: 4, label: 'Review', icon: Eye },
];

export default function AdCreateWizard({ limits, onClose, showToast, template = null, addTo = null }: {
  limits: Limits; onClose: () => void; showToast?: ShowToast; template?: AdTemplate | null;
  /** I1: add the new ad to this ad's campaign (the wizard first asks: same audience and budget, or a new audience). */
  addTo?: AddTo | null;
}) {
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<AddMode | null>(null);
  const [d, setD] = useState<Draft>(() => {
    const fresh: Draft = {
      draftId: crypto.randomUUID(), name: '', imageHash: '', imageUrl: '', localImage: '', text: '', headline: '',
      greeting: 'Hi! I saw your ad and would like to know more.', cards: [], numberId: '', placement: 'auto', useInstagram: true,
      locations: [], ageMin: 18, ageMax: 65, gender: 'all',
      dailyBudget: String(Math.max(limits.minDailyBudget || 0, Math.min(500, limits.maxDailyBudget))), startDate: today(), endDate: '',
      schedule: null, ...H_DEFAULTS,
    };
    if (addTo) {
      // I1: start from the campaign's audience (a new audience can change it; the same audience keeps it).
      const s = addTo.spec as Partial<Draft> & { ageMin?: number; ageMax?: number };
      return {
        ...fresh, locations: s.locations || [], ageMin: s.ageMin ?? 18, ageMax: s.ageMax ?? 65, gender: s.gender || 'all',
        placement: s.placement === 'with_status' && limits.statusAllowed === false ? 'auto' : s.placement || 'auto',
        interests: s.interests || [], excludedLocations: s.excludedLocations || [], languages: s.languages || [],
        dailyBudget: String(addTo.daily_budget),
      };
    }
    if (!template) return fresh;
    // F4 "Use as a start": everything but the dates; pictures are reused (shown from Meta's link).
    const numberId = (limits.numbers || []).find(n => n.phone === template.number && !n.linked)?.id || '';
    const budget = template.dailyBudget && template.dailyBudget <= limits.maxDailyBudget ? String(template.dailyBudget) : fresh.dailyBudget;
    return {
      ...fresh, name: template.name, text: template.text, headline: template.headline, greeting: template.greeting || fresh.greeting,
      imageHash: template.imageHash, imageUrl: template.imageUrl, localImage: template.imageUrl,
      cards: template.cards.map(c => ({ ...c, localImage: c.imageUrl })),
      locations: template.locations, ageMin: template.ageMin, ageMax: template.ageMax, gender: template.gender,
      placement: template.placement === 'with_status' && limits.statusAllowed === false ? 'auto' : template.placement,
      numberId, useInstagram: template.useInstagram, dailyBudget: budget, schedule: template.schedule || null,
      chatStart: template.iceBreakers?.length ? 'questions' : 'prefill', iceBreakers: template.iceBreakers || [],
      tallImageHash: template.tallImageHash || '', tallImageUrl: template.tallImageUrl || '', tallLocal: template.tallImageUrl || '',
      interests: template.interests || [], excludedLocations: template.excludedLocations || [], languages: template.languages || [],
      ...(template.post ? { source: 'post' as const, post: template.post } : {}),
    };
  });
  const [err, setErr] = useState('');
  const [created, setCreated] = useState<CreatedLaunch | null>(null);
  // Stable, so effects in the steps (e.g. the video status check) don't restart on every keystroke.
  const set: SetFn = useCallback((k, v) => setD(x => ({ ...x, [k]: v })), []);
  // I1: "same audience and budget" skips Who sees it and Budget (they're the campaign's).
  const order = addTo && mode === 'same_audience' ? [1, 4] : [1, 2, 3, 4];
  const shown = STEPS.filter(s => order.includes(s.n));

  const stepProblem = (n: number): string => {
    if (n === 1 && d.source === 'post') {
      if (!d.post) return 'Choose a post.';
      if (!d.name.trim()) return 'Give the ad a name (only you see it).';
      return '';
    }
    if (n === 1) {
      if (!d.imageHash && d.cards.length < 2) return d.videoId || d.videoStatus ? 'Add a cover picture for the video.' : 'Add a picture.';
      if (d.videoStatus === 'uploading') return 'Wait for the video to finish uploading.';
      if (d.videoStatus === 'error') return 'The video failed. Remove it or choose another.';
      if (!d.text.trim()) return 'Write the ad text.';
      if (!d.name.trim()) return 'Give the ad a name (only you see it).';
      if (d.chatStart === 'questions' && !d.iceBreakers.some(q => q.trim())) return 'Add at least one quick question, or choose "Pre-typed message".';
    }
    if (n === 2 && !d.locations.length) return 'Choose at least one place.';
    if (n === 3) {
      const b = Number(d.dailyBudget);
      if (!(b > 0)) return 'Enter a daily budget.';
      if (limits.minDailyBudget !== null && b < limits.minDailyBudget) return `Meta's minimum is ${money(limits.minDailyBudget, limits.currency)} per day.`;
      if (b > limits.maxDailyBudget) return `The most one ad may spend per day is ${money(limits.maxDailyBudget, limits.currency)}.`;
      if (d.endDate && d.endDate <= d.startDate) return 'The end date must be after the start date.';
      const sp = scheduleProblem(d.schedule, d.startDate, d.endDate);
      if (sp) return sp;
    }
    return '';
  };
  const next = () => { const p = stepProblem(step); if (p) { setErr(p); return; } setErr(''); setStep(s => order[Math.min(order.length - 1, order.indexOf(s) + 1)]); };
  const back = () => { setErr(''); if (addTo && step === 1) { setMode(null); return; } setStep(s => order[Math.max(0, order.indexOf(s) - 1)]); };
  const choosing = !!addTo && !mode && !created;

  return (
    <div className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label={addTo ? 'Add an ad to the campaign' : 'Create a WhatsApp ad'}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[94vh] flex flex-col">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-800">{addTo ? `Add an ad to “${addTo.name}”` : 'Create a WhatsApp ad'}</h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        {!created && !choosing && (
          <ol className="flex gap-1 px-4 pt-3" aria-label="Steps">
            {shown.map(({ n, label, icon: Icon }, i) => (
              <li key={n} className={`flex-1 flex items-center gap-1.5 text-xs font-semibold px-2 py-1.5 rounded-lg ${step === n ? 'bg-teal-50 text-wa-teal' : step > n ? 'text-emerald-700' : 'text-slate-400'}`} aria-current={step === n ? 'step' : undefined}>
                {step > n ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />} {i + 1}. {label}
              </li>
            ))}
          </ol>
        )}
        <div className="p-4 overflow-y-auto flex-1">
          {created ? <Created launch={created} showToast={showToast} onClose={onClose} />
            : choosing && addTo ? <AddModePicker addTo={addTo} currency={limits.currency} onPick={setMode} />
              : step === 1 ? <StepAd d={d} set={set} numbers={addTo ? [] : limits.numbers || []} instagram={limits.instagram || null} />
                : step === 2 ? <StepAudience d={d} set={set} statusAllowed={limits.statusAllowed !== false} />
                  : step === 3 ? <StepBudget d={d} set={set} limits={limits} />
                    : <StepReview d={d} limits={limits} addTo={addTo && mode ? { ...addTo, mode } : null} onCreated={(l) => { setCreated(l); refreshApi('/api/ads/launches'); }} />}
          {err && <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700" role="alert">{err}</div>}
        </div>
        {!created && !choosing && (
          <div className="px-4 py-3 border-t border-slate-200 flex justify-between">
            <button onClick={back} disabled={step === 1 && !addTo} className={btnSecondary}>Back</button>
            {step < 4 && <button onClick={next} className={btnPrimary}>Next</button>}
          </div>
        )}
      </div>
    </div>
  );
}

export type SetFn = <K extends keyof Draft>(k: K, v: Draft[K]) => void;

/** I1: how the new ad joins the campaign. */
function ModeOption({ title, text, testId, onClick }: { title: string; text: string; testId: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} data-testid={testId}
      className="w-full text-left rounded-xl border border-slate-200 hover:border-wa-teal hover:bg-teal-50/40 p-3 cursor-pointer">
      <div className="text-sm font-semibold text-slate-800">{title}</div>
      <div className="text-xs text-slate-600 mt-0.5">{text}</div>
    </button>
  );
}
function AddModePicker({ addTo, currency, onPick }: { addTo: AddTo; currency: string; onPick: (m: AddMode) => void }) {
  return (
    <div className="space-y-3 max-w-xl" data-testid="ad-add-mode">
      <p className="text-xs text-slate-600">The new ad goes into the same campaign as “{addTo.name}” and opens the same WhatsApp chat. How should it run?</p>
      <ModeOption testId="ad-add-same" title="Same audience and budget (another picture, text or post)" onClick={() => onPick('same_audience')}
        text={`Shares “${addTo.name}”'s audience, dates and ${money(Number(addTo.daily_budget), currency)}/day budget. Meta shows the better ad more often; nothing extra is spent.`} />
      <ModeOption testId="ad-add-new" title="A new audience with its own budget" onClick={() => onPick('new_audience')}
        text="E.g. another city or age group. It gets its own daily budget and dates, so the campaign spends more in total." />
    </div>
  );
}

export function Field({ label, hint, count, max, children }: { label: string; hint?: string; count?: number; max?: number; children: ReactNode }) {
  return (
    <label className="block text-xs text-slate-600">
      <span className="flex justify-between"><span className="font-semibold text-slate-700">{label}</span>{max !== undefined && <span className={count !== undefined && count > max ? 'text-red-600' : 'text-slate-400'}>{count}/{max}</span>}</span>
      <span className="block mt-1">{children}</span>
      {hint && <span className="text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

function StepAd({ d, set, numbers, instagram }: { d: Draft; set: SetFn; numbers: AdNumber[]; instagram: { id: string; username: string } | null }) {
  const [busy, setBusy] = useState(false);
  const [imgErr, setImgErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const moreRef = useRef<HTMLInputElement>(null);
  const carousel = d.cards.length >= 2;

  /** Resize + upload one picture to Meta. */
  const upload = async (file: File) => {
    const { base64, dataUrl } = await prepareImage(file);
    const r = await api<{ imageHash: string; imageUrl: string }>('/api/ads/create/image', { method: 'POST', body: { base64 } });
    return { imageHash: r.imageHash, imageUrl: r.imageUrl, localImage: dataUrl };
  };
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setImgErr('');
    try {
      const img = await upload(file);
      set('imageHash', img.imageHash);
      set('imageUrl', img.imageUrl);
      set('localImage', img.localImage);
      if (!d.name) set('name', file.name.replace(/\.[a-z]+$/i, '').slice(0, 60));
    } catch (e) {
      setImgErr(errorMessage(e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  // E4: "Add another picture" turns the ad into a carousel (the first picture becomes card 1).
  const addCard = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setImgErr('');
    try {
      const img = await upload(file);
      const first: Card[] = d.cards.length ? d.cards : [{ imageHash: d.imageHash, imageUrl: d.imageUrl, localImage: d.localImage, headline: d.headline }];
      set('cards', [...first, { ...img, headline: '' }].slice(0, MAX_CARDS));
    } catch (e) {
      setImgErr(errorMessage(e));
    } finally {
      setBusy(false);
      if (moreRef.current) moreRef.current.value = '';
    }
  };
  const removeCard = (i: number) => {
    const left = d.cards.filter((_, j) => j !== i);
    if (left.length >= 2) { set('cards', left); return; }
    // Back to one picture: a normal single-image ad again.
    const only = left[0];
    set('cards', []);
    if (only) { set('imageHash', only.imageHash); set('imageUrl', only.imageUrl); set('localImage', only.localImage); set('headline', only.headline); }
  };
  const setCardHeadline = (i: number, v: string) => set('cards', d.cards.map((c, j) => (j === i ? { ...c, headline: v } : c)));
  const linked = numbers.find(n => n.linked);

  // I2: a new picture / video, or an existing post.
  const sourcePicker = (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="What the ad shows" data-testid="ad-source">
      {([['new', 'New picture or video'], ['post', 'Use an existing post']] as const).map(([v, label]) => (
        <button key={v} type="button" role="radio" aria-checked={d.source === v} onClick={() => set('source', v)}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer ${d.source === v ? 'bg-wa-teal text-white border-wa-teal' : 'bg-white text-slate-600 border-slate-300'}`}>{label}</button>
      ))}
    </div>
  );
  if (d.source === 'post') {
    return (
      <div className="space-y-3">
        {sourcePicker}
        <AdPostPicker value={d.post} hasInstagram={!!instagram}
          onPick={p => { set('post', p); if (!d.name) set('name', (p.caption.split('\n')[0] || `${p.source === 'instagram' ? 'Instagram' : 'Facebook'} post`).slice(0, 60)); }} />
        <Field label="Name (only you see it)" count={d.name.length} max={80}>
          <input value={d.name} onChange={e => set('name', e.target.value)} maxLength={80} className={inputCls} placeholder="e.g. Eye camp post – boost" />
        </Field>
        {numbers.length > 1 && (
          <Field label="Opens a chat with" hint="Meta must have the number connected to your Facebook Page.">
            <select value={d.numberId} onChange={e => set('numberId', e.target.value)} className={inputCls} data-testid="ad-number-select">
              <option value="">{linked ? `${linked.label || 'Linked number'} (+${linked.phone}) – linked to the Page` : 'The number linked to the Page'}</option>
              {numbers.filter(n => !n.linked).map(n => <option key={n.id} value={n.id}>{n.label || 'Number'} (+{n.phone})</option>)}
            </select>
          </Field>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
    {sourcePicker}
    <div className="grid md:grid-cols-[220px_1fr] gap-4">
      <div>
        {!carousel ? (
          <>
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
              className="w-full aspect-square rounded-xl border-2 border-dashed border-slate-300 hover:border-wa-teal bg-slate-50 flex items-center justify-center overflow-hidden cursor-pointer" aria-label="Choose the ad picture">
              {busy ? <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                : d.localImage ? <img src={d.localImage} alt="Ad picture" className="w-full h-full object-cover" />
                  : <span className="text-xs text-slate-500 flex flex-col items-center gap-1"><ImagePlus className="w-6 h-6" /> Choose a picture</span>}
            </button>
            <p className="text-xs text-slate-400 mt-1">JPG or PNG, square works best (1080 × 1080). It's made smaller automatically.</p>
          </>
        ) : (
          <div className="space-y-2" data-testid="carousel-cards">
            <div className="text-xs font-semibold text-slate-700">Carousel: {d.cards.length} pictures</div>
            {d.cards.map((c, i) => (
              <div key={`${c.imageHash}-${i}`} className="flex gap-2 items-start border border-slate-200 rounded-lg p-1.5">
                {c.localImage ? <img src={c.localImage} alt={`Picture ${i + 1}`} className="w-14 h-14 rounded object-cover flex-shrink-0" /> : <div className="w-14 h-14 rounded bg-slate-100 flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <input value={c.headline} onChange={e => setCardHeadline(i, e.target.value)} maxLength={40} placeholder={`Headline ${i + 1} (optional)`}
                    className="w-full border border-slate-200 rounded px-1.5 py-1 text-xs" aria-label={`Headline for picture ${i + 1}`} />
                  <button type="button" onClick={() => removeCard(i)} className="mt-1 text-xs text-slate-500 hover:text-red-600 cursor-pointer flex items-center gap-1" aria-label={`Remove picture ${i + 1}`}><Trash2 className="w-3 h-3" /> Remove</button>
                </div>
              </div>
            ))}
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/jpeg,image/png" className="hidden" onChange={e => pick(e.target.files?.[0])} data-testid="ad-image-input" />
        <input ref={moreRef} type="file" accept="image/jpeg,image/png" className="hidden" onChange={e => addCard(e.target.files?.[0])} data-testid="ad-more-image-input" />
        {(d.imageHash || carousel) && d.cards.length < MAX_CARDS && (
          <button type="button" onClick={() => moreRef.current?.click()} disabled={busy} className="mt-2 text-xs font-semibold text-wa-teal hover:underline cursor-pointer flex items-center gap-1 disabled:opacity-50">
            <ImagePlus className="w-3.5 h-3.5" /> {busy ? 'Uploading…' : carousel ? 'Add another picture' : 'Add another picture (carousel)'}
          </button>
        )}
        {carousel && <p className="text-xs text-slate-400 mt-1">People swipe through the pictures; each opens the same WhatsApp chat. Up to {MAX_CARDS}.</p>}
        {imgErr && <p className="text-xs text-red-600 mt-1">{imgErr}</p>}
        {/* Phase H: a tall picture for Stories / Status, or a video (the picture becomes its cover). */}
        <TallPictureField d={d} set={set} />
        <VideoField d={d} set={set} />
      </div>
      <div className="space-y-3">
        <Field label="Ad text" count={d.text.length} max={1000} hint="The words above the picture. The first ~125 characters show before 'See more'.">
          <textarea rows={4} value={d.text} onChange={e => set('text', e.target.value)} maxLength={1000} className={inputCls} placeholder="e.g. Free eye check-up camp this weekend at Mayura Hospitals. Message us on WhatsApp to book your slot." />
        </Field>
        {!carousel && (
          <Field label="Headline (optional)" count={d.headline.length} max={40}>
            <input value={d.headline} onChange={e => set('headline', e.target.value)} maxLength={40} className={inputCls} placeholder="e.g. Book your free check-up" />
          </Field>
        )}
        {numbers.length > 1 && (
          <Field label="Opens a chat with" hint={linked ? `Default: ${linked.label || `+${linked.phone}`}, the number linked to your Facebook Page. Another number works only if Meta has it connected to the Page too; otherwise Meta refuses and nothing is created.` : 'Meta must have the number connected to your Facebook Page.'}>
            <select value={d.numberId} onChange={e => set('numberId', e.target.value)} className={inputCls} data-testid="ad-number-select">
              <option value="">{linked ? `${linked.label || 'Linked number'} (+${linked.phone}) – linked to the Page` : 'The number linked to the Page'}</option>
              {numbers.filter(n => !n.linked).map(n => <option key={n.id} value={n.id}>{n.label || 'Number'} (+{n.phone})</option>)}
            </select>
          </Field>
        )}
        <ChatStartFields d={d} set={set} />
        <Field label="Name (only you see it)" count={d.name.length} max={80}>
          <input value={d.name} onChange={e => set('name', e.target.value)} maxLength={80} className={inputCls} placeholder="e.g. Eye camp – November" />
        </Field>
        {instagram && (
          <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer" data-testid="ad-use-instagram">
            <input type="checkbox" checked={d.useInstagram} onChange={e => set('useInstagram', e.target.checked)} className="mt-0.5" />
            <span>Show as <strong>@{instagram.username || instagram.id}</strong> on Instagram <span className="block text-xs text-slate-500">Off: on Instagram the ad shows as your Facebook Page.</span></span>
          </label>
        )}
        <p className="text-xs text-slate-500">The button is always "Send WhatsApp message" and opens a chat with {numbers.length > 1 ? 'the number above' : 'your business number'}.</p>
      </div>
    </div>
    </div>
  );
}

export function StepAudience({ d, set, statusAllowed }: { d: Draft; set: SetFn; statusAllowed: boolean }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [reach, setReach] = useState<string>('');
  useEffect(() => {
    if (q.trim().length < 2) return undefined;
    const t = setTimeout(async () => {
      setSearching(true);
      try { setResults((await api<{ locations: Place[] }>(`/api/ads/create/locations?q=${encodeURIComponent(q.trim())}`)).locations); } catch { setResults([]); } finally { setSearching(false); }
    }, 400);
    return () => clearTimeout(t);
  }, [q]);
  const add = (p: Place) => { if (!d.locations.some(x => x.key === p.key)) set('locations', [...d.locations, { ...p, radius: p.type === 'city' ? 25 : null }]); setQ(''); setResults([]); };
  const estimate = async () => {
    setReach('Asking Meta…');
    try {
      const r = await api<{ estimate: { lower: number | null; upper: number | null } | null; note?: string }>('/api/ads/create/estimate', { method: 'POST', body: payload(d) });
      setReach(r.estimate?.lower ? `About ${r.estimate.lower.toLocaleString('en-IN')}–${(r.estimate.upper || r.estimate.lower).toLocaleString('en-IN')} people` : r.note || 'Meta could not estimate this audience.');
    } catch (e) { setReach(errorMessage(e)); }
  };
  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> Where</div>
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={e => { setQ(e.target.value); if (e.target.value.trim().length < 2) setResults([]); }} placeholder="Search a city, area, state or PIN code" className={`${inputCls} pl-8`} aria-label="Search places" />
          {searching && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2" />}
        </div>
        {results.length > 0 && (
          <ul className="mt-1 border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-48 overflow-y-auto" role="listbox" aria-label="Places found">
            {results.map(p => (
              <li key={p.key}><button type="button" onClick={() => add(p)} className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 cursor-pointer" role="option" aria-selected="false">
                <span className="font-semibold">{p.name}</span> <span className="text-slate-500">{[p.region, p.country].filter(Boolean).join(', ')} · {p.type}</span>
              </button></li>
            ))}
          </ul>
        )}
        <ul className="mt-2 space-y-1.5" aria-label="Chosen places">
          {d.locations.map(l => (
            <li key={l.key} className="flex flex-wrap items-center gap-2 text-xs bg-teal-50 border border-teal-200 rounded-lg px-2.5 py-1.5">
              <span className="font-semibold text-teal-900">{l.name}</span>
              <span className="text-teal-700">{[l.region, l.country].filter(Boolean).join(', ')}</span>
              {l.type === 'city' && (
                <select value={String(l.radius ?? '')} onChange={e => set('locations', d.locations.map(x => (x.key === l.key ? { ...x, radius: e.target.value ? Number(e.target.value) : null } : x)))}
                  className="border border-teal-200 rounded px-1 py-0.5 bg-white" aria-label={`Area around ${l.name}`}>
                  <option value="">city only</option>
                  {/* Meta allows 17-80 km around a city. */}
                  {[17, 25, 40, 80].map(k => <option key={k} value={k}>+{k} km</option>)}
                </select>
              )}
              <button type="button" onClick={() => set('locations', d.locations.filter(x => x.key !== l.key))} className="ml-auto text-teal-700 hover:text-red-600 cursor-pointer" aria-label={`Remove ${l.name}`}><Trash2 className="w-3.5 h-3.5" /></button>
            </li>
          ))}
        </ul>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Ages">
          <span className="flex items-center gap-2">
            <select value={d.ageMin} onChange={e => set('ageMin', Number(e.target.value))} className={inputCls} aria-label="Youngest age">{Array.from({ length: 48 }, (_, i) => i + 18).map(a => <option key={a} value={a}>{a}</option>)}</select>
            <span>to</span>
            <select value={d.ageMax} onChange={e => set('ageMax', Number(e.target.value))} className={inputCls} aria-label="Oldest age">{Array.from({ length: 48 }, (_, i) => i + 18).map(a => <option key={a} value={a}>{a === 65 ? '65+' : a}</option>)}</select>
          </span>
        </Field>
        <Field label="Who">
          <span className="flex gap-3 text-xs pt-2">
            {(['all', 'female', 'male'] as const).map(g => (
              <label key={g} className="flex items-center gap-1 cursor-pointer"><input type="radio" checked={d.gender === g} onChange={() => set('gender', g)} /> {g === 'all' ? 'Everyone' : g === 'female' ? 'Women' : 'Men'}</label>
            ))}
          </span>
        </Field>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={estimate} disabled={!d.locations.length} className={btnSecondary}><Users className="w-3.5 h-3.5" /> Estimate reach</button>
        <span className="text-xs text-slate-600">{reach}</span>
      </div>
      <TargetingExtras d={d} set={set} />
      <p className="text-xs text-slate-400">Meta also finds similar people nearby on its own (Advantage+ audience). Custom and lookalike audiences are in Meta Ads Manager.</p>

      {/* E3: where the ad shows. */}
      <fieldset className="border border-slate-200 rounded-lg p-3" data-testid="ad-placement">
        <legend className="text-xs font-semibold text-slate-700 px-1">Where the ad shows</legend>
        <div className="space-y-1.5 text-xs">
          {(['auto', 'feeds_stories', 'with_status'] as Placement[]).map(p => {
            const off = p === 'with_status' && !statusAllowed;
            return (
              <label key={p} className={`flex items-start gap-2 ${off ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                <input type="radio" name="placement" checked={d.placement === p} disabled={off} onChange={() => set('placement', p)} className="mt-0.5" />
                <span>
                  <span className="font-semibold text-slate-800">{PLACEMENT_LABEL[p]}</span>
                  <span className="block text-xs text-slate-500">
                    {p === 'auto' && 'Recommended. Meta puts the ad where it gets the most chats for the money (feeds, Stories, Reels, Marketplace…).'}
                    {p === 'feeds_stories' && 'Only the main spots people scroll through on Facebook and Instagram.'}
                    {p === 'with_status' && (off
                      ? 'Not available: Meta doesn\'t allow WhatsApp Status ads for healthcare and pharma businesses.'
                      : 'Also between people\'s WhatsApp Status updates (Updates tab). Meta shows Status only together with Instagram Stories; not in the EU/UK. Tall (9:16) pictures look best there.')}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}

function StepBudget({ d, set, limits }: { d: Draft; set: SetFn; limits: Limits }) {
  return (
    <div className="space-y-4 max-w-md">
      <fieldset className="border border-slate-200 rounded-lg p-3 space-y-2">
        <legend className="text-xs font-semibold text-slate-700 px-1">When the ad runs</legend>
        <label className="flex items-start gap-2 text-xs cursor-pointer">
          <input type="radio" name="when" checked={!d.schedule} onChange={() => set('schedule', null)} className="mt-0.5" />
          <span><span className="font-semibold text-slate-800">All day, every day</span><span className="block text-xs text-slate-500">A daily budget; the end date is optional.</span></span>
        </label>
        <label className="flex items-start gap-2 text-xs cursor-pointer">
          <input type="radio" name="when" checked={!!d.schedule} onChange={() => set('schedule', defaultSchedule(limits.businessHours))} className="mt-0.5" data-testid="ad-when-hours" />
          <span><span className="font-semibold text-slate-800">Only during business hours</span><span className="block text-xs text-slate-500">Chats come in when your team can answer. Needs an end date; can&apos;t be switched to all day later.</span></span>
        </label>
        {d.schedule && <ScheduleFields schedule={d.schedule} onChange={s => set('schedule', s)} timezone={limits.timezone} />}
      </fieldset>
      <Field label={`Daily budget (${limits.currency})`} hint={`Between ${limits.minDailyBudget !== null ? money(limits.minDailyBudget, limits.currency) : 'Meta\'s minimum'} and ${money(limits.maxDailyBudget, limits.currency)} (your Business Admin's limit). ${d.schedule ? 'Spent only in the hours above, on the chosen days.' : 'Meta may spend up to ~75% more on a good day, but not more than 7× per week.'}`}>
        <input type="number" min={limits.minDailyBudget || 1} max={limits.maxDailyBudget} step="1" value={d.dailyBudget} onChange={e => set('dailyBudget', e.target.value)} className={inputCls} aria-label="Daily budget" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start"><input type="date" min={today()} value={d.startDate} onChange={e => set('startDate', e.target.value)} className={inputCls} aria-label="Start date" /></Field>
        <Field label={d.schedule ? 'End' : 'End (optional)'} hint={d.schedule ? 'Needed for ads that run in set hours.' : 'Leave empty to run until you pause it.'}><input type="date" min={d.startDate} value={d.endDate} onChange={e => set('endDate', e.target.value)} className={inputCls} aria-label="End date" /></Field>
      </div>
      <BudgetSummary d={d} currency={limits.currency} />
    </div>
  );
}

/** What the ad may spend in total, for daily and business-hours ads. */
export function BudgetSummary({ d, currency }: { d: Pick<Draft, 'dailyBudget' | 'startDate' | 'endDate' | 'schedule'>; currency: string }) {
  const b = Number(d.dailyBudget) || 0;
  const days = d.endDate && d.endDate > d.startDate ? Math.round((Date.parse(d.endDate) - Date.parse(d.startDate)) / 86400000) + 1 : 0;
  const onDays = d.schedule && days ? scheduledDays(d.startDate, d.endDate, d.schedule.days) : 0;
  return (
    <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700" data-testid="ad-budget-summary">
      {d.schedule
        ? (onDays ? <>Runs on {onDays} of {days} days ({scheduleText(d.schedule)}). Budget for the whole run: <strong>{money(b * onDays, currency)}</strong> ({money(b, currency)} × {onDays} days).</> : <>Choose an end date to see the budget for the whole run.</>)
        : days ? <>Runs {days} day{days === 1 ? '' : 's'}: at most about <strong>{money(b * days, currency)}</strong> in total.</> : <>About <strong>{money(b * 30, currency)}</strong> a month until you pause it.</>}
    </div>
  );
}

function StepReview({ d, limits, onCreated, addTo = null }: { d: Draft; limits: Limits; onCreated: (l: CreatedLaunch) => void; addTo?: (AddTo & { mode: AddMode }) | null }) {
  const shared = addTo?.mode === 'same_audience';
  const [check, setCheck] = useState<Check | null>(null);
  const [frame, setFrame] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    let cancelled = false;
    api<{ check: Check; frameUrl: string | null; note?: string | null }>('/api/ads/create/preview', { method: 'POST', body: payload(d) })
      .then(r => { if (!cancelled) { setCheck(r.check); setFrame(r.frameUrl); setNote(r.note || ''); } })
      .catch(e => { if (!cancelled) setNote(errorMessage(e)); });
    return () => { cancelled = true; };
  }, [d]);
  const create = async () => {
    setBusy(true); setErr('');
    try {
      const r = addTo
        ? await api<{ launch: CreatedLaunch }>(`/api/ads/launches/${addTo.id}/ads`, { method: 'POST', body: { ...payload(d), mode: addTo.mode } })
        : await api<{ launch: CreatedLaunch }>('/api/ads/create', { method: 'POST', body: payload(d) });
      onCreated(r.launch);
    } catch (e) {
      const extra = e instanceof ApiError && Array.isArray(e.data?.problems) && e.data.problems.length > 1 ? ` (${e.data.problems.length - 1} more)` : '';
      setErr(errorMessage(e) + extra);
    } finally {
      setBusy(false);
    }
  };
  const blocked = !!check?.blocks.length;
  return (
    <div className="grid md:grid-cols-[auto_1fr] gap-4 items-start">
      <div className="bg-slate-100 rounded-xl p-2 flex justify-center min-w-[300px] min-h-[300px]">
        {frame ? <iframe src={frame} title="Meta preview of the new ad" width={320} height={540} className="bg-white rounded-lg border-0" referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin" />
          : d.source === 'post' && d.post ? <div className="w-[300px] bg-white rounded-lg overflow-hidden text-xs" data-testid="ad-review-post">
            <p className="p-2 whitespace-pre-wrap line-clamp-6">{d.post.caption}</p>
            {d.post.pictureUrl && <img src={d.post.pictureUrl} alt="" className="w-full" referrerPolicy="no-referrer" />}
            <div className="p-2 flex justify-end border-t"><span className="px-2 py-1 rounded bg-slate-100 font-semibold">Send WhatsApp message</span></div>
          </div>
          : <div className="w-[300px] bg-white rounded-lg overflow-hidden text-xs">
            <p className="p-2 whitespace-pre-wrap">{d.text}</p>
            {d.cards.length >= 2
              ? <div className="flex gap-1 overflow-x-auto">{d.cards.map((c, i) => <img key={i} src={c.localImage} alt="" className="w-40 h-40 object-cover flex-shrink-0" />)}</div>
              : d.localImage && <img src={d.localImage} alt="" className="w-full" />}
            <div className="p-2 flex justify-between items-center border-t"><span className="font-semibold">{d.headline}</span><span className="px-2 py-1 rounded bg-slate-100 font-semibold">Send WhatsApp message</span></div>
          </div>}
      </div>
      <div className="space-y-3 text-xs">
        {!check && <p className="text-slate-500 flex items-center gap-1"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking the ad…</p>}
        {check?.blocks.map(b => <div key={b} className="p-2 bg-red-50 border border-red-200 rounded-lg text-red-800 flex gap-1.5"><AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px" /> {b}</div>)}
        {check?.warnings.map(w => <div key={w} className="p-2 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 flex gap-1.5"><AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px" /> {w}</div>)}
        {check && !check.blocks.length && <div className="p-2 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 flex gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 mt-px" /> The text check passed. Meta still reviews every ad.</div>}
        {note && <p className="text-xs text-slate-500">{note}</p>}
        <dl className="grid grid-cols-[110px_1fr] gap-y-1">
          <dt className="text-slate-400">Name</dt><dd className="font-semibold">{d.name}</dd>
          {addTo && <><dt className="text-slate-400">Campaign</dt><dd>Added to “{addTo.name}”{shared ? ', sharing its audience, dates and budget' : ', with its own audience and budget'}</dd></>}
          {shared ? (
            <><dt className="text-slate-400">Audience, budget</dt><dd data-testid="ad-review-shared">Same as “{addTo?.name}” ({money(Number(addTo?.daily_budget), limits.currency)}/day, shared). Change them on that ad.</dd></>
          ) : (
            <>
              <dt className="text-slate-400">Places</dt><dd>{d.locations.map(l => `${l.name}${l.radius ? ` +${l.radius} km` : ''}`).join(', ')}</dd>
              <dt className="text-slate-400">People</dt><dd>{d.gender === 'all' ? 'Everyone' : d.gender === 'female' ? 'Women' : 'Men'}, {d.ageMin}–{d.ageMax === 65 ? '65+' : d.ageMax}</dd>
            </>
          )}
          <dt className="text-slate-400">Pictures</dt><dd>{d.source === 'post' && d.post ? `Existing ${d.post.source === 'instagram' ? 'Instagram' : 'Facebook'} post (its own words and picture)` : d.videoId ? `Video (${d.videoName || 'uploaded'}) with a cover picture` : d.cards.length >= 2 ? `Carousel of ${d.cards.length}` : d.tallImageHash ? 'Square picture + tall picture for Stories / Status' : 'One picture'}</dd>
          <dt className="text-slate-400">Chat starts with</dt><dd>{d.source === 'post' ? 'The customer taps "Send WhatsApp message"' : d.chatStart === 'questions' && d.iceBreakers.some(q => q.trim()) ? `${d.iceBreakers.filter(q => q.trim()).length} quick question(s): ${d.iceBreakers.filter(q => q.trim()).join(' · ')}` : `"${d.greeting}"`}</dd>
          {!shared && (d.interests.length > 0 || d.excludedLocations.length > 0 || d.languages.length > 0) && (
            <><dt className="text-slate-400">More targeting</dt><dd>{[d.interests.length ? `Interests: ${d.interests.map(i => i.name).join(', ')}` : '', d.excludedLocations.length ? `Not in: ${d.excludedLocations.map(l => l.name).join(', ')}` : '', d.languages.length ? `Languages: ${d.languages.map(l => l.name).join(', ')}` : ''].filter(Boolean).join(' · ')}</dd></>
          )}
          {!shared && <><dt className="text-slate-400">Shows on</dt><dd>{PLACEMENT_LABEL[d.placement]}</dd></>}
          {!addTo && (limits.numbers || []).length > 1 && (
            <><dt className="text-slate-400">Opens chat with</dt><dd>{(() => {
              const n = (limits.numbers || []).find(x => (d.numberId ? x.id === d.numberId : x.linked));
              return n ? `${n.label || 'Number'} (+${n.phone})` : 'The number linked to the Page';
            })()}</dd></>
          )}
          {!shared && (
            <>
              <dt className="text-slate-400">Daily budget</dt><dd className="font-semibold">{money(Number(d.dailyBudget), limits.currency)}</dd>
              <dt className="text-slate-400">Dates</dt><dd>{d.startDate}{d.endDate ? ` → ${d.endDate}` : ' → until paused'}</dd>
              <dt className="text-slate-400">Runs</dt><dd>{d.schedule ? scheduleText(d.schedule) : 'All day, every day'}</dd>
            </>
          )}
        </dl>
        {err && <div className="p-2 bg-red-50 border border-red-200 rounded-lg text-red-700" role="alert">{err}</div>}
        <button onClick={create} disabled={busy || blocked || !check} className={btnPrimary}>{busy ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Creating in Meta…</> : 'Create (paused)'}</button>
        <p className="text-xs text-slate-500">Nothing is spent yet: the ad is created switched off. You launch it on the next screen (or later from the list).</p>
      </div>
    </div>
  );
}

/** After "Create": launch now (type the daily budget to confirm) or later. Also used from the list. */
export function LaunchBox({ launch, showToast, onLaunched }: { launch: CreatedLaunch; showToast?: ShowToast; onLaunched?: () => void }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => {
    setBusy(true); setErr('');
    try {
      await api(`/api/ads/launches/${launch.id}/launch`, { method: 'POST', body: { confirmBudget: Number(typed) } });
      showToast?.('Launched: Meta is reviewing the ad (usually within a few hours)');
      await refreshApi('/api/ads/launches');
      onLaunched?.();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2 text-xs">
      <label className="block text-slate-600">To launch, type the daily budget ({launch.daily_budget}):
        <span className="flex gap-2 mt-1 max-w-xs">
          <input value={typed} onChange={e => setTyped(e.target.value)} inputMode="decimal" className={inputCls} aria-label="Type the daily budget to confirm" />
          <button onClick={go} disabled={busy || Number(typed) !== Number(launch.daily_budget)} className={btnPrimary}><Rocket className="w-3.5 h-3.5" /> {busy ? 'Launching…' : 'Launch'}</button>
        </span>
      </label>
      {err && <div className="p-2 bg-red-50 border border-red-200 rounded-lg text-red-700">{err}</div>}
    </div>
  );
}

function Created({ launch, showToast, onClose }: { launch: CreatedLaunch; showToast?: ShowToast; onClose: () => void }) {
  const [launched, setLaunched] = useState(launch.status === 'launched');
  return (
    <div className="space-y-4 max-w-lg">
      <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-900 flex gap-2">
        <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
        <div><strong>"{launch.name}" is created in Meta, switched off.</strong> Nothing has been spent.</div>
      </div>
      {launched
        ? <p className="text-sm text-slate-700">Launched. Meta is reviewing it; once approved it starts running and appears in the Ads tab with its results.</p>
        : <LaunchBox launch={launch} showToast={showToast} onLaunched={() => setLaunched(true)} />}
      <button onClick={onClose} className={btnSecondary}>{launched ? 'Done' : 'Launch later'}</button>
    </div>
  );
}
