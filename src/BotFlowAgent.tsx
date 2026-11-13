import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, X, ChevronLeft, ChevronRight, PlayCircle, MapPin, HelpCircle, Ruler, Lightbulb, Check } from 'lucide-react';
import { TOUR, TOUR_PARTS, type TourStep } from './botFlowTour';
import { BOT_FLOW_GUIDE } from './botFlowGuideText';

// Bot Flow's floating guide: a round button at the bottom left. It offers a tour that scrolls to each part of
// the page, spotlights it and explains it in a speech bubble next to it (Back / Next, arrow keys, Esc), plus
// "Show me a part" and short help topics. The first visit offers the tour once (remembered in this browser).

const SEEN_KEY = 'bot_flow_agent_seen_v1';
const readSeen = () => { try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return true; } };
const writeSeen = () => { try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* storage blocked */ } };

/** The first element on the page for this step (later names are fallbacks). */
function findTarget(step: TourStep): HTMLElement | null {
  for (const name of step.target) {
    const el = document.querySelector<HTMLElement>(`[data-tour="${name}"]`);
    if (el) return el;
  }
  return null;
}

type Box = { top: number; left: number; width: number; height: number };
const PAD = 8;
const BUBBLE_W = 360;

/** Where the speech bubble goes: below the spotlight, else above, else beside it, kept on screen. */
function bubblePlace(box: Box | null, bubbleH: number): { top: number; left: number } {
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.min(BUBBLE_W, vw - 24);
  if (!box) return { top: Math.max(12, vh / 2 - bubbleH / 2), left: Math.max(12, vw / 2 - w / 2) };
  const left = Math.min(Math.max(12, box.left), vw - w - 12);
  if (box.top + box.height + PAD + 12 + bubbleH < vh) return { top: box.top + box.height + PAD + 12, left };
  if (box.top - PAD - 12 - bubbleH > 0) return { top: box.top - PAD - 12 - bubbleH, left };
  // Tall target: beside it if there is room, else pinned near the bottom.
  if (box.left + box.width + PAD + 12 + w < vw) return { top: Math.min(Math.max(12, box.top), vh - bubbleH - 12), left: box.left + box.width + PAD + 12 };
  if (box.left - PAD - 12 - w > 0) return { top: Math.min(Math.max(12, box.top), vh - bubbleH - 12), left: box.left - PAD - 12 - w };
  return { top: vh - bubbleH - 16, left: vw - w - 16 };
}

export default function BotFlowAgent() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [offer, setOffer] = useState(() => !readSeen());
  const [step, setStep] = useState<number | null>(null);
  const [topic, setTopic] = useState<'order' | 'behind' | 'limits' | 'tips' | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [bubbleH, setBubbleH] = useState(260);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const current = step === null ? null : TOUR[step];

  const start = (i = 0) => { writeSeen(); setOffer(false); setMenuOpen(false); setTopic(null); setStep(i); };
  const close = useCallback(() => { setStep(null); setBox(null); }, []);
  const next = useCallback(() => setStep(s => (s === null ? s : s + 1 < TOUR.length ? s + 1 : null)), []);
  const back = useCallback(() => setStep(s => (s === null || s === 0 ? s : s - 1)), []);

  // New step: bring its part of the page into view.
  useEffect(() => {
    if (!current) return;
    const el = findTarget(current);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [current]);

  // Follow the target while scrolling / resizing (one cheap measurement per frame, only during the tour).
  useEffect(() => {
    if (!current) return undefined;
    let raf = 0;
    const tick = () => {
      const el = findTarget(current);
      const r = el?.getBoundingClientRect();
      const nextBox = r && r.width > 0 ? { top: r.top, left: r.left, width: r.width, height: r.height } : null;
      setBox(b => (b && nextBox && Math.abs(b.top - nextBox.top) < 0.5 && Math.abs(b.left - nextBox.left) < 0.5 && b.width === nextBox.width && b.height === nextBox.height ? b : nextBox));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [current]);

  // The bubble's height (for placing it above / below the spotlight), kept current as its text changes.
  useEffect(() => {
    const el = bubbleRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setBubbleH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [step]);

  // Keyboard: arrows move, Esc closes.
  useEffect(() => {
    if (step === null) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, close, next, back]);

  const place = bubblePlace(box, bubbleH);
  const decides = BOT_FLOW_GUIDE.sections.find(s => s.title.startsWith('In what order'));
  const behind = BOT_FLOW_GUIDE.sections.find(s => s.title.startsWith('What happens behind'));

  return (
    <>
      {/* ---- The tour: spotlight + speech bubble ---- */}
      {current && (
        <>
          {box
            ? <div aria-hidden data-testid="tour-spotlight" className="fixed z-[60] rounded-xl pointer-events-none transition-all duration-200"
                style={{ top: box.top - PAD, left: box.left - PAD, width: box.width + PAD * 2, height: box.height + PAD * 2, boxShadow: '0 0 0 4px rgb(252, 211, 77), 0 0 0 9999px rgba(15, 23, 42, 0.55)' }} />
            : <div aria-hidden className="fixed inset-0 z-[60] bg-slate-900/55 pointer-events-none" />}
          <div ref={bubbleRef} role="dialog" aria-label={`Guide: ${current.title}`} data-testid="tour-bubble"
            className="fixed z-[61] bg-white rounded-2xl shadow-2xl border border-slate-200 text-slate-700"
            style={{ top: place.top, left: place.left, width: Math.min(BUBBLE_W, window.innerWidth - 24) }}>
            <div className="flex items-start gap-2.5 px-4 pt-3.5">
              <span className="w-8 h-8 rounded-full bg-gradient-to-br from-wa-teal to-emerald-400 text-white flex items-center justify-center flex-shrink-0 shadow"><Sparkles className="w-4 h-4" /></span>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Step {(step ?? 0) + 1} of {TOUR.length} · {current.part}</div>
                <h3 className="text-sm font-bold text-slate-800 leading-snug">{current.title}</h3>
              </div>
              <button onClick={close} className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer" aria-label="Close the guide"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-4 pb-1 pt-1.5 text-[12.5px] leading-relaxed space-y-1.5 max-h-[40vh] overflow-y-auto">
              <p>{current.text}</p>
              {current.points && <ul className="space-y-1">{current.points.map(p => <li key={p} className="flex gap-1.5"><Check className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0 mt-0.5" /><span>{p}</span></li>)}</ul>}
              {current.tip && <p className="text-[12px] text-violet-800 bg-violet-50 border border-violet-100 rounded-lg px-2.5 py-1.5"><strong>Tip:</strong> {current.tip}</p>}
              {!box && <p className="text-xs text-amber-700">This part isn&apos;t on the page right now.</p>}
            </div>
            <div className="flex items-center gap-2 px-4 py-3">
              <div className="flex gap-1 flex-1" aria-hidden>
                {TOUR.map((s, i) => <span key={s.id} className={`h-1.5 rounded-full transition-all ${i === step ? 'w-4 bg-wa-teal' : 'w-1.5 bg-slate-200'}`} />)}
              </div>
              <button onClick={back} disabled={step === 0} className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 cursor-pointer flex items-center gap-0.5"><ChevronLeft className="w-3.5 h-3.5" /> Back</button>
              <button onClick={next} className="px-3 py-1.5 rounded-lg bg-wa-teal text-white text-xs font-semibold hover:bg-teal-700 cursor-pointer flex items-center gap-0.5">
                {step === TOUR.length - 1 ? 'Finish' : <>Next <ChevronRight className="w-3.5 h-3.5" /></>}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ---- The floating guide button, its first-visit offer and its menu ----
          (clear of the side menu on desktop, U1, and above the phone tab bar) */}
      {!current && (
        <div className="fixed left-4 bottom-20 md:left-60 md:bottom-4 z-50 flex flex-col items-start gap-2" data-testid="bot-agent">
          {offer && !menuOpen && (
            <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-3 w-72 text-xs text-slate-700" role="dialog" aria-label="Guide offer">
              <p className="font-semibold text-slate-800">Hi! I&apos;m your Bot Flow guide 👋</p>
              <p className="mt-0.5">New here? I can walk you through this page in about 2 minutes and show what each part does.</p>
              <div className="flex gap-2 mt-2">
                <button onClick={() => start(0)} className="px-3 py-1.5 rounded-lg bg-wa-teal text-white font-semibold cursor-pointer">Show me around</button>
                <button onClick={() => { writeSeen(); setOffer(false); }} className="px-3 py-1.5 rounded-lg border border-slate-200 font-semibold text-slate-600 cursor-pointer">Not now</button>
              </div>
            </div>
          )}
          {menuOpen && (
            <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-80 max-h-[70vh] overflow-y-auto text-xs text-slate-700" role="dialog" aria-label="Bot Flow guide">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
                <span className="w-8 h-8 rounded-full bg-gradient-to-br from-wa-teal to-emerald-400 text-white flex items-center justify-center"><Sparkles className="w-4 h-4" /></span>
                <div className="flex-1"><div className="font-bold text-slate-800 text-sm">Bot Flow guide</div><div className="text-xs text-slate-500">I&apos;ll take you to each part and explain it.</div></div>
                <button onClick={() => setMenuOpen(false)} className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer" aria-label="Close"><X className="w-4 h-4" /></button>
              </div>
              <div className="p-3 space-y-3">
                <button onClick={() => start(0)} className="w-full flex items-center gap-2 rounded-xl bg-teal-50 border border-teal-200 px-3 py-2.5 text-left hover:bg-teal-100 cursor-pointer">
                  <PlayCircle className="w-5 h-5 text-wa-teal" />
                  <span><span className="block font-semibold text-slate-800">Take the full tour</span><span className="text-xs text-slate-500">{TOUR.length} short steps, about 2 minutes</span></span>
                </button>
                <div>
                  <div className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-1.5 flex items-center gap-1"><MapPin className="w-3 h-3" /> Show me a part</div>
                  <div className="space-y-1">
                    {TOUR_PARTS.map(part => {
                      const first = TOUR.findIndex(s => s.part === part);
                      const steps = TOUR.filter(s => s.part === part);
                      return (
                        <button key={part} onClick={() => start(first)} className="w-full text-left rounded-lg px-2.5 py-1.5 hover:bg-slate-50 cursor-pointer">
                          <span className="font-semibold text-slate-800">{part}</span>
                          <span className="text-slate-500"> · {steps.map(s => s.title.replace(/^\d\.\s*/, '')).join(', ')}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-1.5 flex items-center gap-1"><HelpCircle className="w-3 h-3" /> Good to know</div>
                  {([['order', 'In what order the bot decides', HelpCircle], ['behind', 'What happens behind the scenes', Sparkles], ['limits', "WhatsApp's length limits", Ruler], ['tips', 'Good practice', Lightbulb]] as const).map(([id, label, Icon]) => (
                    <div key={id}>
                      <button onClick={() => setTopic(topic === id ? null : id)} aria-expanded={topic === id} className="w-full text-left rounded-lg px-2.5 py-1.5 hover:bg-slate-50 cursor-pointer flex items-center gap-1.5 font-semibold text-slate-800">
                        <Icon className="w-3.5 h-3.5 text-slate-400" /> {label}
                      </button>
                      {topic === id && (
                        <div className="px-2.5 pb-2 pt-0.5 space-y-1 text-xs leading-relaxed" data-testid={`agent-topic-${id}`}>
                          {id === 'order' && decides?.fields?.map(f => <p key={f.name}><strong>{f.name}</strong> {f.does}</p>)}
                          {id === 'behind' && behind?.fields?.map(f => <p key={f.name}><strong>{f.name}:</strong> {f.does}</p>)}
                          {id === 'limits' && BOT_FLOW_GUIDE.limits.map(([what, max]) => <p key={what} className="flex justify-between gap-2"><span>{what}</span><strong className="whitespace-nowrap">{max}</strong></p>)}
                          {id === 'tips' && BOT_FLOW_GUIDE.tips.map(t => <p key={t}>• {t}</p>)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          <button onClick={() => { setMenuOpen(o => !o); setOffer(false); writeSeen(); }} aria-label="Open the Bot Flow guide" aria-expanded={menuOpen}
            className={`flex items-center gap-2 pl-2 pr-4 py-2 rounded-full bg-gradient-to-r from-wa-teal to-emerald-500 text-white shadow-xl hover:shadow-2xl cursor-pointer ${offer ? 'animate-pulse' : ''}`}>
            <span className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center"><Sparkles className="w-4 h-4" /></span>
            <span className="text-xs font-semibold">Guide</span>
          </button>
        </div>
      )}
    </>
  );
}
