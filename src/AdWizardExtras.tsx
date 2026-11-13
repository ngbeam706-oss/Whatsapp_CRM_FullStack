import { useEffect, useRef, useState } from 'react';
import { MessageCircleQuestion, Plus, Trash2, Smartphone, Loader2, Film, X, Search, Sparkles, MapPinOff, Languages, CheckCircle2, AlertTriangle, RotateCw } from 'lucide-react';
import { api, errorMessage, inputCls, btnSecondary } from './broadcastUtils';
import { prepareImage, Field, type Draft, type SetFn, type Place } from './AdCreateWizard';

// Ads phase H, the wizard's extra parts (server/adCreate.cjs):
//   H1 ChatStartFields .... how the chat starts: a pre-typed message, or up to 4 quick questions (ice breakers)
//   H2 TallPictureField ... a tall 9:16 picture for Stories, Reels and WhatsApp Status
//   H3 VideoField ......... a video (browser -> private storage -> Meta), with the picture as its cover
//   H4 TargetingExtras .... interests, places to leave out, languages

const MAX_ICE = 4;
const MAX_VIDEO_MB = 50;

// ---------------------------------------------------------------------------
// H1
// ---------------------------------------------------------------------------
export function ChatStartFields({ d, set }: { d: Draft; set: SetFn }) {
  const qs = d.iceBreakers.length ? d.iceBreakers : [''];
  const setQ = (i: number, v: string) => set('iceBreakers', qs.map((q, j) => (j === i ? v : q)));
  return (
    <fieldset className="border border-slate-200 rounded-lg p-3 space-y-2" data-testid="ad-chat-start">
      <legend className="text-xs font-semibold text-slate-700 px-1 flex items-center gap-1"><MessageCircleQuestion className="w-3.5 h-3.5" /> How the chat starts</legend>
      <label className="flex items-start gap-2 text-xs cursor-pointer">
        <input type="radio" name="chatStart" checked={d.chatStart === 'prefill'} onChange={() => set('chatStart', 'prefill')} className="mt-0.5" />
        <span><span className="font-semibold text-slate-800">Pre-typed message</span><span className="block text-xs text-slate-500">Filled in for the customer; they just press Send.</span></span>
      </label>
      <label className="flex items-start gap-2 text-xs cursor-pointer">
        <input type="radio" name="chatStart" checked={d.chatStart === 'questions'} onChange={() => { set('chatStart', 'questions'); if (!d.iceBreakers.length) set('iceBreakers', ['Book an appointment', 'What are your timings?']); }} className="mt-0.5" data-testid="ad-chat-questions" />
        <span><span className="font-semibold text-slate-800">Quick questions (tap to send)</span><span className="block text-xs text-slate-500">Your welcome line plus up to {MAX_ICE} questions; they tap one. Usually more people start a chat.</span></span>
      </label>
      <Field label={d.chatStart === 'questions' ? 'Welcome line' : 'Pre-typed message'} count={d.greeting.length} max={160}>
        <input value={d.greeting} onChange={e => set('greeting', e.target.value)} maxLength={160} className={inputCls} aria-label={d.chatStart === 'questions' ? 'Welcome line' : 'Pre-typed message'} />
      </Field>
      {d.chatStart === 'questions' && (
        <div className="space-y-1.5" aria-label="Quick questions">
          {qs.map((q, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="text-xs text-slate-400 w-4">{i + 1}.</span>
              <input value={q} onChange={e => setQ(i, e.target.value)} maxLength={80} placeholder="e.g. What is the consultation fee?" className={inputCls} aria-label={`Quick question ${i + 1}`} />
              {qs.length > 1 && <button type="button" onClick={() => set('iceBreakers', qs.filter((_, j) => j !== i))} className="p-1 text-slate-400 hover:text-red-600 cursor-pointer" aria-label={`Remove question ${i + 1}`}><Trash2 className="w-3.5 h-3.5" /></button>}
            </div>
          ))}
          {qs.length < MAX_ICE && <button type="button" onClick={() => set('iceBreakers', [...qs, ''])} className="text-xs font-semibold text-wa-teal hover:underline cursor-pointer flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Add a question</button>}
          <p className="text-xs text-slate-500">The tapped question arrives in your Inbox like any message; your bot or team answers it. Don&apos;t promise results or prices you can&apos;t keep.</p>
        </div>
      )}
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// H2
// ---------------------------------------------------------------------------
export function TallPictureField({ d, set }: { d: Draft; set: SetFn }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  if (d.cards.length >= 2 || d.videoId || d.videoStatus) return null;
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setErr('');
    try {
      const { base64, dataUrl } = await prepareImage(file);
      const r = await api<{ imageHash: string; imageUrl: string }>('/api/ads/create/image', { method: 'POST', body: { base64 } });
      set('tallImageHash', r.imageHash); set('tallImageUrl', r.imageUrl); set('tallLocal', dataUrl);
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); if (ref.current) ref.current.value = ''; }
  };
  return (
    <div className="mt-3" data-testid="ad-tall-picture">
      <div className="text-xs font-semibold text-slate-700 flex items-center gap-1"><Smartphone className="w-3.5 h-3.5" /> Tall picture for Stories &amp; Status <span className="font-normal text-slate-400">(optional)</span></div>
      <div className="mt-1 flex items-start gap-2">
        <button type="button" onClick={() => ref.current?.click()} disabled={busy} className="w-16 h-28 rounded-lg border-2 border-dashed border-slate-300 hover:border-wa-teal bg-slate-50 flex items-center justify-center overflow-hidden cursor-pointer flex-shrink-0" aria-label="Choose the tall picture">
          {busy ? <Loader2 className="w-4 h-4 animate-spin text-slate-400" /> : d.tallLocal ? <img src={d.tallLocal} alt="Tall picture" className="w-full h-full object-cover" /> : <Plus className="w-4 h-4 text-slate-400" />}
        </button>
        <div className="text-xs text-slate-500 leading-snug">
          9:16 (1080 × 1920 is best). Shown full screen in Stories, Reels and Status; the square picture stays in feeds.
          {d.tallImageHash && <button type="button" onClick={() => { set('tallImageHash', ''); set('tallImageUrl', ''); set('tallLocal', ''); }} className="block mt-1 text-slate-500 hover:text-red-600 cursor-pointer">Remove</button>}
        </div>
      </div>
      <input ref={ref} type="file" accept="image/jpeg,image/png" className="hidden" onChange={e => pick(e.target.files?.[0])} data-testid="ad-tall-input" />
      {err && <p className="text-xs text-red-600 mt-1">{err}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// H3
// ---------------------------------------------------------------------------
export function VideoField({ d, set }: { d: Draft; set: SetFn }) {
  const [err, setErr] = useState('');
  const [progress, setProgress] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const tries = useRef(0);
  const [tick, setTick] = useState(0);

  // While Meta processes the video: check every 10 seconds for up to 3 minutes, then stop ("Check again" restarts).
  useEffect(() => {
    if (d.videoStatus !== 'processing' || !d.videoId || tries.current >= 18) return undefined;
    const t = setTimeout(async () => {
      tries.current += 1;
      try {
        const r = await api<{ status: 'ready' | 'processing' | 'error' }>(`/api/ads/create/video/${d.videoId}/status`);
        if (r.status !== 'processing') { set('videoStatus', r.status); return; }
      } catch { /* keep waiting */ }
      setTick(n => n + 1);
    }, 10000);
    return () => clearTimeout(t);
  }, [d.videoStatus, d.videoId, set, tick]);

  if (d.cards.length >= 2) return null;
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setErr('');
    if (!['video/mp4', 'video/quicktime'].includes(file.type)) { setErr('Use an MP4 or MOV video.'); return; }
    if (file.size > MAX_VIDEO_MB * 1024 * 1024) { setErr(`The video is ${(file.size / 1024 / 1024).toFixed(0)} MB. Use one of at most ${MAX_VIDEO_MB} MB.`); return; }
    set('videoName', file.name); set('videoStatus', 'uploading'); set('tallImageHash', ''); set('tallLocal', '');
    try {
      setProgress('Preparing…');
      const u = await api<{ uploadUrl: string; path: string }>('/api/ads/create/video/upload-url', { method: 'POST', body: { type: file.type, size: file.size } });
      setProgress('Uploading…');
      const form = new FormData();
      form.append('cacheControl', '3600');
      form.append('', file);
      const res = await fetch(u.uploadUrl, { method: 'PUT', headers: { 'x-upsert': 'true' }, body: form });
      if (!res.ok) throw new Error(`The upload failed (${res.status}). Try again.`);
      setProgress('Sending to Meta…');
      const v = await api<{ videoId: string; path: string }>('/api/ads/create/video', { method: 'POST', body: { path: u.path } });
      set('videoId', v.videoId); set('videoPath', v.path); tries.current = 0; set('videoStatus', 'processing');
      setProgress('');
    } catch (e) {
      set('videoStatus', 'error'); setErr(errorMessage(e)); setProgress('');
    } finally {
      if (ref.current) ref.current.value = '';
    }
  };
  const clear = () => { set('videoId', ''); set('videoPath', ''); set('videoName', ''); set('videoStatus', ''); setErr(''); };
  const checkAgain = () => { tries.current = 0; setTick(n => n + 1); };

  return (
    <div className="mt-3" data-testid="ad-video">
      <div className="text-xs font-semibold text-slate-700 flex items-center gap-1"><Film className="w-3.5 h-3.5" /> Video <span className="font-normal text-slate-400">(optional; the picture above becomes its cover)</span></div>
      {!d.videoStatus ? (
        <button type="button" onClick={() => ref.current?.click()} className={`${btnSecondary} mt-1`}><Film className="w-3.5 h-3.5" /> Choose a video</button>
      ) : (
        <div className="mt-1 rounded-lg border border-slate-200 p-2 text-xs flex items-center gap-2" data-testid="ad-video-status">
          {d.videoStatus === 'ready' ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : d.videoStatus === 'error' ? <AlertTriangle className="w-4 h-4 text-red-600" /> : <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
          <span className="flex-1 min-w-0 truncate">
            <strong>{d.videoName || 'Video'}</strong> ·{' '}
            {d.videoStatus === 'uploading' ? progress || 'Uploading…' : d.videoStatus === 'processing' ? 'Meta is processing it (usually under a minute)' : d.videoStatus === 'ready' ? 'Ready' : 'Failed'}
          </span>
          {d.videoStatus === 'processing' && <button type="button" onClick={checkAgain} className="text-wa-teal font-semibold cursor-pointer flex items-center gap-0.5"><RotateCw className="w-3 h-3" /> Check again</button>}
          <button type="button" onClick={clear} className="p-1 text-slate-400 hover:text-red-600 cursor-pointer" aria-label="Remove the video"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}
      <p className="text-xs text-slate-400 mt-1">MP4 or MOV, up to {MAX_VIDEO_MB} MB. Short (under 30 s), vertical or square videos work best.</p>
      <input ref={ref} type="file" accept="video/mp4,video/quicktime" className="hidden" onChange={e => pick(e.target.files?.[0])} data-testid="ad-video-input" />
      {err && <p className="text-xs text-red-600 mt-1">{err}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// H4
// ---------------------------------------------------------------------------
function SearchPicker<T extends { label: string; id: string }>({ label, icon: Icon, placeholder, search, chosen, onAdd, onRemove, max, testId }: {
  label: string; icon: typeof Search; placeholder: string; search: (q: string) => Promise<T[]>;
  chosen: Array<{ id: string; label: string }>; onAdd: (item: T) => void; onRemove: (id: string) => void; max: number; testId: string;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<T[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.trim().length < 2) return undefined;
    const t = setTimeout(async () => {
      setBusy(true);
      try { setResults(await search(q.trim())); } catch { setResults([]); } finally { setBusy(false); }
    }, 400);
    return () => clearTimeout(t);
  }, [q, search]);
  return (
    <div data-testid={testId}>
      <div className="text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1"><Icon className="w-3.5 h-3.5" /> {label} <span className="font-normal text-slate-400">({chosen.length}/{max})</span></div>
      {chosen.length < max && (
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={e => { setQ(e.target.value); if (e.target.value.trim().length < 2) setResults([]); }} placeholder={placeholder} className={`${inputCls} pl-8`} aria-label={`Search ${label.toLowerCase()}`} />
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2" />}
        </div>
      )}
      {results.length > 0 && (
        <ul className="mt-1 border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-40 overflow-y-auto" role="listbox" aria-label={`${label} found`}>
          {results.map(r => (
            <li key={r.id}><button type="button" role="option" aria-selected="false" onClick={() => { if (!chosen.some(c => c.id === r.id)) onAdd(r); setQ(''); setResults([]); }}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 cursor-pointer">{r.label}</button></li>
          ))}
        </ul>
      )}
      {chosen.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5" aria-label={`Chosen ${label.toLowerCase()}`}>
          {chosen.map(c => (
            <span key={c.id} className="inline-flex items-center gap-1 rounded-full bg-teal-50 border border-teal-200 text-teal-900 text-xs px-2 py-0.5">
              {c.label}<button type="button" onClick={() => onRemove(c.id)} className="text-teal-700 hover:text-red-600 cursor-pointer" aria-label={`Remove ${c.label}`}><X className="w-3 h-3" /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

type Found = { id: string; label: string };
const searchInterests = async (q: string) => (await api<{ interests: Array<{ id: string; name: string; path: string[]; size: number | null }> }>(`/api/ads/create/interests?q=${encodeURIComponent(q)}`)).interests
  .map(i => ({ id: i.id, label: i.name, name: i.name, path: i.path, size: i.size }));
const searchPlaces = async (q: string) => (await api<{ locations: Place[] }>(`/api/ads/create/locations?q=${encodeURIComponent(q)}`)).locations
  .map(p => ({ ...p, id: p.key, label: `${p.name}${p.region ? `, ${p.region}` : ''} (${p.type})` }));
const searchLanguages = async (q: string) => (await api<{ languages: Array<{ key: number; name: string }> }>(`/api/ads/create/languages?q=${encodeURIComponent(q)}`)).languages
  .map(l => ({ id: String(l.key), label: l.name, key: l.key, name: l.name }));

export function TargetingExtras({ d, set }: { d: Draft; set: SetFn }) {
  const [open, setOpen] = useState(() => d.interests.length + d.excludedLocations.length + d.languages.length > 0);
  const count = d.interests.length + d.excludedLocations.length + d.languages.length;
  return (
    <fieldset className="border border-slate-200 rounded-lg" data-testid="ad-targeting-extras">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="w-full text-left px-3 py-2 text-xs font-semibold text-slate-700 flex items-center gap-1 cursor-pointer">
        <Sparkles className="w-3.5 h-3.5" /> More targeting (optional){count ? `: ${count} chosen` : ''}<span className="ml-auto text-xs font-normal text-slate-400">{open ? 'Hide' : 'Interests, places to leave out, languages'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-3">
          <SearchPicker<Found & { name: string }> label="Interests" icon={Sparkles} placeholder="e.g. Health & wellness, Yoga, Parenting" testId="ad-interests" max={10}
            search={searchInterests} chosen={d.interests.map(i => ({ id: i.id, label: i.name }))}
            onAdd={i => set('interests', [...d.interests, { id: i.id, name: i.name }])} onRemove={id => set('interests', d.interests.filter(i => i.id !== id))} />
          <p className="text-xs text-slate-500 -mt-2">People interested in any of these. Meta doesn&apos;t offer health-condition interests (by design), and may still show the ad to similar people (Advantage+ audience).</p>
          <SearchPicker<Found & Place> label="Places to leave out" icon={MapPinOff} placeholder="e.g. a city or PIN code you don't serve" testId="ad-excluded" max={10}
            search={searchPlaces} chosen={d.excludedLocations.map(l => ({ id: l.key, label: l.name }))}
            onAdd={p => set('excludedLocations', [...d.excludedLocations, { key: p.key, type: p.type, name: p.name, region: p.region, country: p.country, countryCode: p.countryCode }])}
            onRemove={id => set('excludedLocations', d.excludedLocations.filter(l => l.key !== id))} />
          <SearchPicker<Found & { key: number; name: string }> label="Languages" icon={Languages} placeholder="e.g. Telugu, Hindi" testId="ad-languages" max={5}
            search={searchLanguages} chosen={d.languages.map(l => ({ id: String(l.key), label: l.name }))}
            onAdd={l => set('languages', [...d.languages, { key: l.key, name: l.name }])} onRemove={id => set('languages', d.languages.filter(l => String(l.key) !== id))} />
          <p className="text-xs text-slate-500 -mt-2">The language people use Facebook and Instagram in. Leave empty for everyone.</p>
        </div>
      )}
    </fieldset>
  );
}
