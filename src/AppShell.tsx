// The dashboard's frame (docs/progress/ui-enhancement.md U1): side menu on desktop, tab bar on phones,
// profile menu, search (Ctrl+K) and the notification bell. App.tsx decides which items each role gets;
// the server still checks every request on its own.
import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { Bell, ChevronsLeft, ChevronsRight, LogOut, LifeBuoy, Menu, Search, Type, UserCircle2, X, MessageSquare, CornerDownLeft, ClipboardList } from 'lucide-react';
import { useApi } from './queryClient';
import { api } from './broadcastUtils';
import { applyLargeText, readLargeText, Drawer } from './ui';
import { REFRESH } from './usePolling';
import { AvailabilityToggle } from './Availability';

type IconType = ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;

export interface ShellItem {
  key: string;
  label: string;
  to: string;
  icon: IconType;
  /** Small number on the item (unread, ad problems, …). */
  badge?: number;
  badgeTone?: 'red' | 'amber';
  active?: boolean;
}
export interface ShellGroup { title: string; items: ShellItem[] }

const ROLE_LABEL: Record<string, string> = { owner: 'Business Admin', manager: 'Manager', agent: 'Agent' };

function Badge({ n, tone = 'red', testId }: { n?: number; tone?: 'red' | 'amber'; testId?: string }) {
  if (!n) return null;
  return <span data-testid={testId} className={`ml-auto min-w-[1.25rem] text-center font-bold px-1.5 rounded-full text-2xs ${tone === 'amber' ? 'bg-amber-400 text-slate-900' : 'bg-red-500 text-white'}`}>{n > 99 ? '99+' : n}</span>;
}

// ---------------------------------------------------------------------------
// Side menu (desktop): grouped, collapsible to icons, remembered in this browser.
// ---------------------------------------------------------------------------
const COLLAPSE_KEY = 'ui_sidebar_collapsed_v1';
export function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; } });
  const toggle = () => setCollapsed(c => {
    try { localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1'); } catch { /* storage blocked */ }
    return !c;
  });
  return [collapsed, toggle];
}

export function SideNav({ groups, collapsed, onToggle }: { groups: ShellGroup[]; collapsed: boolean; onToggle: () => void }) {
  return (
    <nav aria-label="Main menu" data-testid="side-nav"
      className={`hidden md:flex flex-col bg-white border-r border-slate-200 flex-shrink-0 transition-[width] ${collapsed ? 'w-16' : 'w-56'}`}>
      <div className="flex-1 overflow-y-auto py-3">
        {groups.filter(g => g.items.length).map(g => (
          <div key={g.title} className="mb-3">
            {!collapsed && <div className="px-4 pb-1 text-xs font-bold uppercase tracking-wider text-slate-400">{g.title}</div>}
            {collapsed && <div className="mx-3 mb-1 border-t border-slate-100" />}
            <div className="px-2 space-y-0.5">
              {g.items.map(it => {
                const Icon = it.icon;
                return (
                  <NavLink key={it.key} to={it.to} aria-label={it.label} title={collapsed ? it.label : undefined}
                    className={() => `relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium ${it.active ? 'bg-teal-50 text-wa-teal font-semibold' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'} ${collapsed ? 'justify-center' : ''}`}>
                    <Icon className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
                    {!collapsed && <span className="truncate">{it.label}</span>}
                    {!collapsed && <Badge n={it.badge} tone={it.badgeTone} testId={`${it.key}-badge`} />}
                    {collapsed && !!it.badge && <span className={`absolute top-1 right-2 w-2 h-2 rounded-full ${it.badgeTone === 'amber' ? 'bg-amber-400' : 'bg-red-500'}`} />}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <button onClick={onToggle} className="m-2 p-2 rounded-lg text-slate-500 hover:bg-slate-100 flex items-center gap-2 text-xs cursor-pointer"
        aria-label={collapsed ? 'Show menu names' : 'Make the menu narrow'} title={collapsed ? 'Show menu names' : 'Make the menu narrow'}>
        {collapsed ? <ChevronsRight className="w-4 h-4 mx-auto" /> : <><ChevronsLeft className="w-4 h-4" /> Narrow menu</>}
      </button>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Tab bar (phones): the first items, then "More" with everything else.
// ---------------------------------------------------------------------------
export function BottomBar({ main, more, extra }: { main: ShellItem[]; more: ShellGroup[]; extra: ReactNode }) {
  const [open, setOpen] = useState(false);
  const moreActive = more.some(g => g.items.some(i => i.active));
  const moreBadge = more.reduce((s, g) => s + g.items.reduce((t, i) => t + (i.badge || 0), 0), 0);
  return (
    <>
      <nav aria-label="Main menu" data-testid="bottom-bar" className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200 flex pb-[env(safe-area-inset-bottom)]">
        {main.map(it => {
          const Icon = it.icon;
          return (
            <NavLink key={it.key} to={it.to} aria-label={it.label}
              className={() => `relative flex-1 flex flex-col items-center gap-0.5 py-2 text-2xs font-semibold ${it.active ? 'text-wa-teal' : 'text-slate-500'}`}>
              <Icon className="w-6 h-6" aria-hidden="true" />
              <span>{it.label}</span>
              {!!it.badge && <span className="absolute top-1 left-1/2 ml-2 min-w-[1.1rem] text-center bg-red-500 text-white rounded-full px-1 text-2xs font-bold">{it.badge > 99 ? '99+' : it.badge}</span>}
            </NavLink>
          );
        })}
        <button onClick={() => setOpen(true)} aria-label="More"
          className={`relative flex-1 flex flex-col items-center gap-0.5 py-2 text-2xs font-semibold cursor-pointer ${moreActive ? 'text-wa-teal' : 'text-slate-500'}`}>
          <Menu className="w-6 h-6" aria-hidden="true" />
          <span>More</span>
          {moreBadge > 0 && <span className="absolute top-1.5 left-1/2 ml-2 w-2 h-2 bg-red-500 rounded-full" />}
        </button>
      </nav>
      {open && (
        <Drawer title="Menu" onClose={() => setOpen(false)}>
          <div className="p-3 space-y-4" onClick={e => { if ((e.target as HTMLElement).closest('a,button[data-closes]')) setOpen(false); }}>
            {more.filter(g => g.items.length).map(g => (
              <div key={g.title}>
                <div className="px-2 pb-1 text-xs font-bold uppercase tracking-wider text-slate-400">{g.title}</div>
                {g.items.map(it => {
                  const Icon = it.icon;
                  return (
                    <NavLink key={it.key} to={it.to} className={() => `flex items-center gap-3 rounded-lg px-3 py-3 text-base ${it.active ? 'bg-teal-50 text-wa-teal font-semibold' : 'text-slate-700'}`}>
                      <Icon className="w-5 h-5" aria-hidden="true" /><span className="flex-1">{it.label}</span><Badge n={it.badge} tone={it.badgeTone} />
                    </NavLink>
                  );
                })}
              </div>
            ))}
            <div className="border-t border-slate-100 pt-3">{extra}</div>
          </div>
        </Drawer>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Profile menu: who is signed in, My profile, Raise a query, Larger text, Sign out.
// ---------------------------------------------------------------------------
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return { open, setOpen, ref };
}

export function LargeTextToggle() {
  const [large, setLarge] = useState(readLargeText);
  return (
    <button onClick={() => { applyLargeText(!large); setLarge(!large); }} role="switch" aria-checked={large}
      className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50 cursor-pointer">
      <Type className="w-4 h-4" aria-hidden="true" /><span className="flex-1 text-left">Larger text</span>
      <span className={`w-9 h-5 rounded-full p-0.5 transition ${large ? 'bg-wa-teal' : 'bg-slate-300'}`}><span className={`block w-4 h-4 bg-white rounded-full transition ${large ? 'translate-x-4' : ''}`} /></span>
    </button>
  );
}

export function ProfileMenu({ email, role, profileTo, onRaiseQuery, onSignOut }: { email: string; role: string; profileTo: string; onRaiseQuery: () => void; onSignOut: () => void }) {
  const { open, setOpen, ref } = usePopover();
  const navigate = useNavigate();
  const initial = (email || '?').trim().charAt(0).toUpperCase();
  const row = 'w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50 cursor-pointer';
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open} aria-label="Your account"
        className="w-9 h-9 rounded-full bg-white/20 hover:bg-white/30 text-white font-bold text-sm flex items-center justify-center cursor-pointer">{initial}</button>
      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-64 bg-white text-slate-800 rounded-xl shadow-2xl border border-slate-200 p-2 z-40">
          <div className="px-3 py-2 border-b border-slate-100 mb-1">
            <div className="text-sm font-semibold truncate">{email}</div>
            <div className="text-xs text-slate-500">{ROLE_LABEL[role] || role}</div>
          </div>
          <button role="menuitem" className={row} onClick={() => { setOpen(false); navigate(profileTo); }}><UserCircle2 className="w-4 h-4" aria-hidden="true" /> My profile</button>
          <button role="menuitem" className={row} onClick={() => { setOpen(false); onRaiseQuery(); }}><LifeBuoy className="w-4 h-4" aria-hidden="true" /> Raise a query</button>
          <LargeTextToggle />
          <AvailabilityToggle />
          <div className="border-t border-slate-100 mt-1 pt-1">
            <button role="menuitem" className={`${row} text-red-700`} onClick={() => { setOpen(false); onSignOut(); }}><LogOut className="w-4 h-4" aria-hidden="true" /> Sign out</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bell: counts from /api/notifications (+ ad problems and plan notices the app already knows).
// ---------------------------------------------------------------------------
export interface BellItem { key: string; count?: number; label: string; to: string; level: 'urgent' | 'normal' }
interface NotificationsResponse { items: Array<{ key: string; count: number; label: string; view: 'chat' | 'queries'; level: 'urgent' | 'normal' }>; total: number }

export function useNotifications(viewUrl: (view: 'chat' | 'queries') => string): BellItem[] {
  // Every minute while the tab is visible (never while hidden: Netlify credits).
  const q = useApi<NotificationsResponse>('/api/notifications', { refetchInterval: REFRESH.notifications });
  return useMemo(() => (q.data?.items || []).map(i => ({ key: i.key, count: i.count, label: i.label, to: viewUrl(i.view), level: i.level })), [q.data, viewUrl]);
}

export function NotificationBell({ items }: { items: BellItem[] }) {
  const { open, setOpen, ref } = usePopover();
  const navigate = useNavigate();
  const total = items.reduce((s, i) => s + (i.count || 1), 0);
  const urgent = items.some(i => i.level === 'urgent');
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open} aria-label={total ? `${total} things need you` : 'Nothing needs you right now'} data-testid="bell"
        className="relative w-9 h-9 rounded-full hover:bg-white/15 flex items-center justify-center cursor-pointer">
        <Bell className="w-5 h-5" aria-hidden="true" />
        {total > 0 && <span className={`absolute -top-0.5 -right-0.5 min-w-[1.15rem] text-center rounded-full px-1 text-2xs font-bold ${urgent ? 'bg-red-500 text-white' : 'bg-amber-400 text-slate-900'}`}>{total > 99 ? '99+' : total}</span>}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-1.5rem)] bg-white text-slate-800 rounded-xl shadow-2xl border border-slate-200 p-2 z-40">
          <div className="px-3 py-2 text-sm font-semibold">Needs your attention</div>
          {items.length === 0 && <div className="px-3 pb-3 text-sm text-slate-500">All caught up. Nothing is waiting for you.</div>}
          {items.map(i => (
            <button key={i.key} role="menuitem" onClick={() => { setOpen(false); navigate(i.to); }}
              className="w-full text-left flex items-start gap-3 rounded-lg px-3 py-2.5 hover:bg-slate-50 cursor-pointer">
              <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${i.level === 'urgent' ? 'bg-red-500' : 'bg-amber-400'}`} />
              <span className="text-sm">{i.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Search (Ctrl+K): screens, actions and contacts by name or number.
// ---------------------------------------------------------------------------
export interface PaletteAction { key: string; label: string; hint?: string; icon: IconType; run: () => void }
interface ContactHit { phone: string; name?: string | null }

export function useCommandShortcut(onOpen: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); onOpen(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onOpen]);
}

export function SearchButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button onClick={onOpen} aria-label="Search (Ctrl+K)" data-testid="search-button"
      className="flex items-center gap-2 bg-white/15 hover:bg-white/25 rounded-lg px-3 h-9 text-sm text-teal-50 cursor-pointer md:w-72">
      <Search className="w-4 h-4" aria-hidden="true" />
      <span className="hidden md:inline flex-1 text-left">Search contacts and pages</span>
      <kbd className="hidden lg:inline text-2xs bg-white/20 rounded px-1.5 py-0.5">Ctrl K</kbd>
    </button>
  );
}

export function CommandPalette({ actions, onOpenContact, onOpenQuery, onClose }: { actions: PaletteAction[]; onOpenContact: (phone: string) => void; onOpenQuery?: (id: string) => void; onClose: () => void }) {
  const [text, setText] = useState('');
  const [hits, setHits] = useState<ContactHit[]>([]);
  const [queryHit, setQueryHit] = useState<{ id: string; ref: string; subject: string; forTerm: string } | null>(null);
  const [searching, setSearching] = useState(false);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Contacts: after a short pause in typing, from the inbox search (same rules as the Inbox).
  const term = text.trim();
  useEffect(() => {
    if (term.length < 2) return undefined;
    const t = setTimeout(() => {
      setSearching(true);
      api<{ conversations?: ContactHit[] }>(`/api/inbox?q=${encodeURIComponent(term)}`)
        .then(d => setHits((d.conversations || []).slice(0, 6)))
        .catch(() => setHits([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(t);
  }, [term]);

  // "Q-1042" (or "q1042"): that query, if this person may see it.
  const isQueryRef = /^q-?\d{1,9}$/i.test(term);
  useEffect(() => {
    if (!isQueryRef || !onOpenQuery) return undefined;
    const t = setTimeout(() => {
      api<{ query: { id: string; ref: string; subject: string } }>(`/api/queries/by-number/${encodeURIComponent(term.replace(/^q-?/i, ''))}`)
        .then(d => setQueryHit({ ...d.query, forTerm: term }))
        .catch(() => setQueryHit(null));
    }, 250);
    return () => clearTimeout(t);
  }, [term, isQueryRef, onOpenQuery]);

  const lower = term.toLowerCase();
  const pages = actions.filter(a => !lower || a.label.toLowerCase().includes(lower) || (a.hint || '').toLowerCase().includes(lower)).slice(0, 8);
  // Contacts only for a search of 2+ letters (older results are dropped when the text gets shorter).
  const shownHits = term.length >= 2 ? hits : [];
  const shownQuery = queryHit && isQueryRef && queryHit.forTerm === term && onOpenQuery ? queryHit : null;
  const rows: Array<{ key: string; label: string; hint?: string; icon: IconType; run: () => void }> = [
    ...(shownQuery ? [{ key: `q-${shownQuery.id}`, label: `${shownQuery.ref} · ${shownQuery.subject}`, hint: 'Query', icon: ClipboardList, run: () => onOpenQuery?.(shownQuery.id) }] : []),
    ...shownHits.map(h => ({ key: `c-${h.phone}`, label: h.name || `+${h.phone}`, hint: h.name ? `+${h.phone}` : 'Contact', icon: MessageSquare, run: () => onOpenContact(h.phone) })),
    ...pages,
  ];
  const pick = (i: number) => { const r = rows[i]; if (r) { onClose(); r.run(); } };

  return (
    <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-start justify-center p-3 pt-[10vh]" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Search" className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 border-b border-slate-100">
          <Search className="w-5 h-5 text-slate-400" aria-hidden="true" />
          <input ref={inputRef} value={text} onChange={e => { setText(e.target.value); setSel(0); }} placeholder="A name, a phone number, Q-1042 or a page…"
            className="flex-1 py-3.5 text-base outline-none bg-transparent" aria-label="Search"
            onKeyDown={e => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, rows.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
              else if (e.key === 'Enter') { e.preventDefault(); pick(sel); }
            }} />
          <button onClick={onClose} aria-label="Close" className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"><X className="w-5 h-5" /></button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {searching && <div className="px-3 py-2 text-xs text-slate-400">Looking for contacts…</div>}
          {rows.length === 0 && !searching && <div className="px-3 py-6 text-center text-sm text-slate-500">Nothing found. Try another name or number.</div>}
          {rows.map((r, i) => {
            const Icon = r.icon;
            return (
              <button key={r.key} onMouseEnter={() => setSel(i)} onClick={() => pick(i)}
                className={`w-full text-left flex items-center gap-3 rounded-lg px-3 py-2.5 cursor-pointer ${i === sel ? 'bg-teal-50' : ''}`}>
                <Icon className="w-4 h-4 text-slate-500 flex-shrink-0" aria-hidden="true" />
                <span className="flex-1 min-w-0 truncate text-sm text-slate-800">{r.label}</span>
                {r.hint && <span className="text-xs text-slate-400 truncate">{r.hint}</span>}
                {i === sel && <CornerDownLeft className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
