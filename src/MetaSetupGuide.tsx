import { useState } from 'react';
import { BookOpen, ChevronDown, ChevronUp, ExternalLink, ListOrdered, KeyRound, ThumbsUp, ThumbsDown, Info, ClipboardCheck } from 'lucide-react';
import type { SetupGuide } from './metaGuides';

// A collapsible, step-by-step "how to set this up in Meta" guide (WhatsApp page, Ads page).
// Open or closed is remembered per guide in this browser.

const STORAGE_KEY = 'meta_setup_guides_open_v1';
function readOpen(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; } catch { return {}; }
}
function writeOpen(v: Record<string, boolean>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(v)); } catch { /* storage blocked: just don't remember */ }
}

function Links({ links }: { links?: SetupGuide['steps'][number]['links'] }) {
  if (!links?.length) return null;
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
      {links.map(l => (
        <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-wa-teal font-semibold hover:underline">
          {l.label} <ExternalLink className="w-3 h-3" />
        </a>
      ))}
    </span>
  );
}

function Heading({ icon: Icon, children }: { icon: typeof Info; children: string }) {
  return <div className="text-xs font-bold uppercase tracking-wide text-slate-500 flex items-center gap-1.5"><Icon className="w-3.5 h-3.5" /> {children}</div>;
}

/** `defaultOpen`: open the first time (e.g. while nothing is connected yet). */
export default function MetaSetupGuide({ guide, defaultOpen = false }: { guide: SetupGuide; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(() => readOpen()[guide.id] ?? defaultOpen);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    writeOpen({ ...readOpen(), [guide.id]: next });
  };

  return (
    <section className="bg-white border border-teal-200 rounded-xl overflow-hidden" data-testid={`guide-${guide.id}`}>
      <button onClick={toggle} className="w-full flex items-center gap-2 px-4 py-3 text-left bg-teal-50/60 hover:bg-teal-50 cursor-pointer" aria-expanded={open}>
        <BookOpen className="w-4 h-4 text-wa-teal flex-shrink-0" />
        <span className="text-sm font-semibold text-slate-800 flex-1">{guide.title}</span>
        <span className="text-xs text-slate-500">{open ? 'Hide guide' : 'Show guide'}</span>
        {open ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
      </button>

      {open && (
        <div className="p-4 space-y-5 text-xs text-slate-700">
          <p className="leading-relaxed">{guide.intro}</p>

          {guide.before.length > 0 && (
            <div>
              <Heading icon={ClipboardCheck}>Before you start</Heading>
              <ul className="mt-2 space-y-1.5 list-disc pl-4 marker:text-slate-400">
                {guide.before.map(b => <li key={b} className="leading-relaxed">{b}</li>)}
              </ul>
            </div>
          )}

          <div>
            <Heading icon={ListOrdered}>Step by step</Heading>
            <ol className="mt-2 space-y-3">
              {guide.steps.map((s, i) => (
                <li key={s.title} className="flex gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-wa-teal text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-px">{i + 1}</span>
                  <span className="flex-1">
                    <span className="block font-semibold text-slate-800">{s.title}</span>
                    <span className="block leading-relaxed mt-0.5">{s.text}</span>
                    {s.path && <span className="block mt-1 font-mono text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded px-1.5 py-0.5">{s.path}</span>}
                    <Links links={s.links} />
                  </span>
                </li>
              ))}
            </ol>
          </div>

          {guide.values.length > 0 && (
            <div>
              <Heading icon={KeyRound}>Where to find each value</Heading>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-xs border border-slate-200 rounded-lg">
                  <thead className="bg-slate-50 text-left text-slate-600">
                    <tr><th className="px-2.5 py-1.5 font-semibold">Value</th><th className="px-2.5 py-1.5 font-semibold">Where in Meta</th><th className="px-2.5 py-1.5 font-semibold">Looks like</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {guide.values.map(v => (
                      <tr key={v.name} className="align-top">
                        <td className="px-2.5 py-1.5 font-semibold text-slate-800 whitespace-nowrap">{v.name}</td>
                        <td className="px-2.5 py-1.5">{v.where}<Links links={v.link ? [v.link] : undefined} /></td>
                        <td className="px-2.5 py-1.5 font-mono text-xs text-slate-500">{v.looksLike}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            <div className="border border-emerald-200 bg-emerald-50/50 rounded-lg p-3">
              <Heading icon={ThumbsUp}>{guide.prosTitle}</Heading>
              <ul className="mt-2 space-y-1.5 list-disc pl-4 marker:text-emerald-500">
                {guide.pros.map(p => <li key={p} className="leading-relaxed">{p}</li>)}
              </ul>
            </div>
            <div className="border border-amber-200 bg-amber-50/50 rounded-lg p-3">
              <Heading icon={ThumbsDown}>{guide.consTitle}</Heading>
              <ul className="mt-2 space-y-1.5 list-disc pl-4 marker:text-amber-500">
                {guide.cons.map(c => <li key={c} className="leading-relaxed">{c}</li>)}
              </ul>
            </div>
          </div>

          {guide.notes.length > 0 && (
            <div>
              <Heading icon={Info}>Good to know</Heading>
              <ul className="mt-2 space-y-1.5 list-disc pl-4 marker:text-slate-400">
                {guide.notes.map(n => <li key={n} className="leading-relaxed">{n}</li>)}
              </ul>
            </div>
          )}

          {guide.docs.length > 0 && (
            <div className="pt-1 border-t border-slate-100">
              <span className="text-xs text-slate-500">Meta's own help:</span>
              <Links links={guide.docs} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
