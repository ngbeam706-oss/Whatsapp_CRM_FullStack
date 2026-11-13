import type { ReactNode } from 'react';
import { ArrowRight, ArrowDown, type LucideIcon } from 'lucide-react';

// Simple diagrams for the "How Meta is organised" booklet (src/MetaOrgGuide.tsx): flow charts, org-chart trees,
// a role ladder, a yes/no decision chart and a two-box sharing picture. Plain HTML + Tailwind (no images), so they
// work on phones (flows turn vertical), in print, and for screen readers (each figure has a label and caption).

export type Tone = 'slate' | 'teal' | 'violet' | 'sky' | 'emerald' | 'amber' | 'rose';
const TONES: Record<Tone, { box: string; icon: string; chip: string }> = {
  slate: { box: 'bg-white border-slate-300', icon: 'bg-slate-100 text-slate-600', chip: 'bg-slate-100 text-slate-700' },
  teal: { box: 'bg-teal-50 border-teal-300', icon: 'bg-teal-100 text-teal-700', chip: 'bg-teal-100 text-teal-800' },
  violet: { box: 'bg-violet-50 border-violet-300', icon: 'bg-violet-100 text-violet-700', chip: 'bg-violet-100 text-violet-800' },
  sky: { box: 'bg-sky-50 border-sky-300', icon: 'bg-sky-100 text-sky-700', chip: 'bg-sky-100 text-sky-800' },
  emerald: { box: 'bg-emerald-50 border-emerald-300', icon: 'bg-emerald-100 text-emerald-700', chip: 'bg-emerald-100 text-emerald-800' },
  amber: { box: 'bg-amber-50 border-amber-300', icon: 'bg-amber-100 text-amber-700', chip: 'bg-amber-100 text-amber-800' },
  rose: { box: 'bg-rose-50 border-rose-300', icon: 'bg-rose-100 text-rose-700', chip: 'bg-rose-100 text-rose-800' },
};

/** A captioned picture. */
export function Figure({ label, caption, children }: { label: string; caption?: string; children: ReactNode }) {
  return (
    <figure className="my-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3" role="group" aria-label={label} data-testid="guide-figure">
      {children}
      {caption && <figcaption className="mt-2 text-[11px] text-slate-500 text-center">{caption}</figcaption>}
    </figure>
  );
}

/** One box in a diagram: an icon, a title and a line of text. */
export function Node({ icon: Icon, title, text, tone = 'slate', small = false }: { icon?: LucideIcon; title: string; text?: string; tone?: Tone; small?: boolean }) {
  const t = TONES[tone];
  return (
    <div className={`rounded-xl border-2 ${t.box} ${small ? 'px-2 py-1.5' : 'px-3 py-2'} shadow-sm h-full`}>
      <div className="flex items-center gap-2">
        {Icon && <span className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${t.icon}`}><Icon className="w-4 h-4" /></span>}
        <span className="font-bold text-slate-800 text-xs leading-tight">{title}</span>
      </div>
      {text && <p className="mt-1 text-[11px] text-slate-600 leading-snug">{text}</p>}
    </div>
  );
}

/** Steps joined by arrows: across on wide screens, down on phones. */
export function Flow({ steps }: { steps: Array<{ icon?: LucideIcon; title: string; text?: string; tone?: Tone }> }) {
  return (
    <ol className="flex flex-col md:flex-row md:items-stretch gap-1 md:gap-0">
      {steps.map((s, i) => (
        <li key={s.title} className="flex flex-col md:flex-row md:items-center md:flex-1 min-w-0">
          <div className="md:flex-1 min-w-0 relative">
            <span className="absolute -top-2 -left-2 w-5 h-5 rounded-full bg-slate-800 text-white text-[10px] font-bold flex items-center justify-center z-10">{i + 1}</span>
            <Node {...s} />
          </div>
          {i < steps.length - 1 && (
            <span className="flex justify-center md:px-1 py-0.5 md:py-0 text-slate-400" aria-hidden="true">
              <ArrowDown className="w-4 h-4 md:hidden" /><ArrowRight className="w-4 h-4 hidden md:block" />
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

/** An org chart: a box with its children below, joined by lines. */
export interface TreeNode { icon?: LucideIcon; title: string; text?: string; tone?: Tone; children?: TreeNode[] }
export function OrgTree({ root }: { root: TreeNode }) {
  return <div className="overflow-x-auto"><div className="min-w-[280px]"><Branch node={root} top /></div></div>;
}
function Branch({ node, top = false }: { node: TreeNode; top?: boolean }) {
  return (
    <div className={top ? '' : 'relative pl-5'}>
      {!top && <span className="absolute left-0 top-5 w-5 border-t-2 border-slate-300" aria-hidden="true" />}
      <div className="max-w-md"><Node icon={node.icon} title={node.title} text={node.text} tone={node.tone} small /></div>
      {node.children && node.children.length > 0 && (
        <div className="relative ml-4 mt-1 space-y-1.5 pt-0.5">
          {/* the vertical line from the parent down to the last child */}
          <span className="absolute left-0 top-0 bottom-4 border-l-2 border-slate-300" aria-hidden="true" />
          {node.children.map(c => <Branch key={c.title} node={c} />)}
        </div>
      )}
    </div>
  );
}

/** Roles from most to least power, as a ladder (widest = most power). */
export function RoleLadder({ rungs }: { rungs: Array<{ title: string; text: string; tone: Tone; width: number }> }) {
  return (
    <div className="space-y-1.5">
      {rungs.map(r => (
        <div key={r.title} className="flex justify-center">
          <div className={`rounded-xl border-2 ${TONES[r.tone].box} px-3 py-2 text-center`} style={{ width: `${r.width}%` }}>
            <div className="font-bold text-slate-800 text-xs">{r.title}</div>
            <div className="text-[11px] text-slate-600 leading-snug">{r.text}</div>
          </div>
        </div>
      ))}
      <div className="flex justify-between text-[10px] text-slate-400 px-1"><span>▲ more power</span><span>fewer people should have it ▲</span></div>
    </div>
  );
}

/** A yes/no decision chart: questions down the left, the answer for "yes" on the right. */
export function Decision({ items, otherwise }: { items: Array<{ q: string; yes: string; tone?: Tone }>; otherwise: string }) {
  return (
    <div className="space-y-1">
      {items.map((it, i) => (
        <div key={it.q}>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <div className="rounded-xl border-2 border-slate-400 bg-white px-3 py-2 text-xs font-semibold text-slate-800 text-center">{it.q}</div>
            <span className="text-[10px] font-bold text-emerald-700 flex items-center gap-0.5">Yes <ArrowRight className="w-3.5 h-3.5" /></span>
            <div className={`rounded-xl border-2 ${TONES[it.tone || 'emerald'].box} px-3 py-2 text-xs font-bold text-slate-800 text-center`}>{it.yes}</div>
          </div>
          <div className="grid grid-cols-[1fr_auto_1fr]" data-step={i}><span className="flex justify-center text-[10px] font-bold text-rose-700 items-center gap-0.5 py-0.5"><ArrowDown className="w-3.5 h-3.5" /> No</span></div>
        </div>
      ))}
      <div className="grid grid-cols-[1fr_auto_1fr] gap-2"><div className="rounded-xl border-2 border-slate-300 bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 text-center">{otherwise}</div></div>
    </div>
  );
}

/** Two portfolios side by side, with what one shares with the other. */
export function TwoBoxes({ left, right, middle }: {
  left: { title: string; tone: Tone; items: string[] }; right: { title: string; tone: Tone; items: string[] }; middle: string[];
}) {
  const box = (b: { title: string; tone: Tone; items: string[] }) => (
    <div className={`rounded-xl border-2 border-dashed ${TONES[b.tone].box} p-2`}>
      <div className="font-bold text-slate-800 text-xs mb-1">{b.title}</div>
      <ul className="space-y-1">{b.items.map(i => <li key={i} className="rounded-lg bg-white border border-slate-200 px-2 py-1 text-[11px]">{i}</li>)}</ul>
    </div>
  );
  return (
    <div className="grid md:grid-cols-[1fr_auto_1fr] gap-2 items-center">
      {box(left)}
      <div className="flex md:flex-col items-center justify-center gap-1 text-[11px] text-slate-600">
        {middle.map(m => <span key={m} className="flex items-center gap-1 whitespace-nowrap"><ArrowRight className="w-3.5 h-3.5 text-amber-600 rotate-90 md:rotate-0" />{m}</span>)}
      </div>
      {box(right)}
    </div>
  );
}

/** A funnel: each bar narrower than the one above (e.g. sent -> delivered -> read -> replied). */
export function Funnel({ rows }: { rows: Array<{ label: string; value: number; tone: Tone; note?: string }> }) {
  const max = Math.max(...rows.map(r => r.value), 1);
  return (
    <div className="space-y-1">
      {rows.map(r => (
        <div key={r.label} className="flex justify-center">
          <div className={`rounded-lg border-2 ${TONES[r.tone].box} px-3 py-1.5 text-center`} style={{ width: `${Math.max(28, (r.value / max) * 100)}%` }}>
            <span className="font-bold text-slate-800 text-xs">{r.value.toLocaleString('en-IN')} {r.label}</span>
            {r.note && <span className="block text-[10px] text-slate-600">{r.note}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

/** A phone showing one WhatsApp template message as the customer receives it (optionally with labels). */
export function PhoneMessage({ business, header, body, footer, buttons = [], labels = false }: {
  business: string; header?: string; body: ReactNode; footer?: string; buttons?: string[]; labels?: boolean;
}) {
  const tag = (t: string) => (labels ? <span className="ml-1 rounded bg-amber-200 text-amber-900 text-[9px] font-bold px-1 py-px align-middle">{t}</span> : null);
  return (
    <div className="mx-auto w-full max-w-[260px] rounded-[1.6rem] border-[6px] border-slate-800 bg-[#ece5dd] overflow-hidden shadow">
      <div className="bg-[#075e54] text-white text-[11px] font-semibold px-3 py-2">{business}</div>
      <div className="p-2 min-h-[120px]">
        <div className="rounded-lg bg-white shadow-sm text-[11px] text-slate-800 max-w-[92%]">
          {header && <div className="px-2.5 pt-2 font-bold">{header}{tag('Header')}</div>}
          <div className="px-2.5 py-1.5 leading-snug whitespace-pre-line">{body}{tag('Body')}</div>
          {footer && <div className="px-2.5 pb-1.5 text-[10px] text-slate-500">{footer}{tag('Footer')}</div>}
          {buttons.length > 0 && (
            <div className="border-t border-slate-100">
              {buttons.map((b, i) => <div key={b} className="text-center text-[11px] text-sky-600 font-semibold py-1.5 border-b border-slate-100 last:border-b-0">{b}{i === 0 ? tag('Buttons') : null}</div>)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** A filled blank in an example message: shows what {{1}} became. */
export function Blank({ n, children }: { n: number; children: ReactNode }) {
  return <span className="rounded bg-emerald-100 text-emerald-900 font-semibold px-0.5" title={`{{${n}}}`}>{children}</span>;
}

/** A horizontal timeline with coloured stretches (e.g. the WhatsApp 24-hour window). */
export function Timeline({ segments }: { segments: Array<{ label: string; text: string; tone: Tone; grow: number }> }) {
  return (
    <div>
      <div className="flex rounded-xl overflow-hidden border-2 border-slate-300">
        {segments.map(s => (
          <div key={s.label} className={`${TONES[s.tone].box} border-0 px-2 py-2 border-r last:border-r-0 border-slate-300`} style={{ flexGrow: s.grow, flexBasis: 0 }}>
            <div className="font-bold text-slate-800 text-[11px]">{s.label}</div>
            <div className="text-[10px] text-slate-600 leading-snug">{s.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Small coloured label. */
export function Chip({ tone = 'slate', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${TONES[tone].chip}`}>{children}</span>;
}
