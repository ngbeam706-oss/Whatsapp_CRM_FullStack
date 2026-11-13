import { useSyncExternalStore } from 'react';
import { SITE } from './site/siteConfig';

// The application's name, logo, company and contact details, as set by the Platform Admin (console -> Branding,
// server/branding.cjs). Loaded once per page load from GET /api/public/branding (public, no login); until it
// arrives, and for anything not set yet, the [placeholder] defaults in src/site/siteConfig.ts are used.

export type BrandField =
  | 'brandName' | 'tagline' | 'companyName' | 'companyAddress' | 'cin' | 'gstin' | 'supportEmail' | 'salesEmail'
  | 'privacyEmail' | 'phone' | 'supportHours' | 'grievanceOfficerName' | 'grievanceOfficerEmail' | 'jurisdictionCity';
export type Branding = Record<BrandField, string> & { logoUrl: string | null; policyVersion: string; policyEffectiveDate: string };

const DEFAULTS: Branding = { ...SITE, logoUrl: null };
/** A [square-bracket] value is a placeholder not filled in yet. */
export const isPlaceholder = (v: string) => /^\[.*\]$/.test(v);
/** Needed before the Privacy Policy and Terms are final (else the legal pages show a "draft" note). */
export const REQUIRED_FOR_LEGAL: BrandField[] = ['brandName', 'companyName', 'companyAddress', 'supportEmail', 'privacyEmail', 'phone', 'grievanceOfficerName', 'grievanceOfficerEmail', 'jurisdictionCity'];
export const isDraft = (b: Branding) => REQUIRED_FOR_LEGAL.some(k => !b[k] || isPlaceholder(b[k]));

let current: Branding = DEFAULTS;
let started = false;
const listeners = new Set<() => void>();

/** Merge what the server sent over the defaults (only known, non-empty text fields). */
export function applyBranding(data: Partial<Record<string, unknown>> | null | undefined) {
  const next: Branding = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS) as Array<keyof Branding>) {
    if (key === 'logoUrl' || key === 'policyVersion' || key === 'policyEffectiveDate') continue;
    const v = data?.[key];
    if (typeof v === 'string' && v.trim()) (next as Record<string, unknown>)[key] = v;
  }
  const logo = data?.logoUrl;
  next.logoUrl = typeof logo === 'string' && logo.startsWith('/api/public/logo') ? logo : null;
  current = next;
  listeners.forEach(l => l());
}

function load(fresh = false) {
  if (started && !fresh) return;
  started = true;
  fetch('/api/public/branding', fresh ? { cache: 'no-store' } : undefined)
    .then(r => (r.ok ? r.json() : null))
    .then((d: { branding?: Record<string, unknown> } | null) => { if (d?.branding) applyBranding(d.branding); })
    .catch(() => { /* keep the defaults */ });
}

/** Load the branding again (the console calls this after saving, so the change shows at once). */
export function reloadBranding() { load(true); }

function subscribe(l: () => void) {
  load();
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** The current branding; components re-render when it arrives or changes. */
export function useBranding(): Branding {
  return useSyncExternalStore(subscribe, () => current, () => current);
}
