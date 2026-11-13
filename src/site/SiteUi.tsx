import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router';

// Small building blocks shared by the public pages.

/** An internal link: same-tab navigation without reloading the app (React Router). */
export function Link({ to, className, children, onClick }: { to: string; className?: string; children: ReactNode; onClick?: () => void }) {
  return <RouterLink to={to} onClick={onClick} className={className}>{children}</RouterLink>;
}

export function Container({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`max-w-6xl mx-auto px-4 sm:px-6 ${className}`}>{children}</div>;
}

export function SectionTitle({ eyebrow, title, text }: { eyebrow?: string; title: string; text?: string }) {
  return (
    <div className="max-w-2xl mx-auto text-center mb-10">
      {eyebrow && <div className="text-xs font-bold uppercase tracking-widest text-emerald-600 mb-2">{eyebrow}</div>}
      <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">{title}</h2>
      {text && <p className="mt-3 text-slate-600 leading-relaxed">{text}</p>}
    </div>
  );
}

export function PrimaryButton({ to, children }: { to: string; children: ReactNode }) {
  return <Link to={to} className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-5 py-3 shadow-sm transition">{children}</Link>;
}

export function SecondaryButton({ to, children }: { to: string; children: ReactNode }) {
  return <Link to={to} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-semibold px-5 py-3 transition">{children}</Link>;
}
