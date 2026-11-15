// Addresses of the signed-in app. Each login type has its own area, named after the role:
//   /platform/...  Platform Admin (console)      /admin/...    Business Admin (owner)
//   /manager/...   Manager                       /agent/...    Agent
// A login can open only its own area (src/main.tsx AreaGate shows "not allowed" for another role's address), and
// inside a business area the managers' screens are guarded again (App.tsx ManagersOnly). The server checks every
// request on its own as well (requireStaff / requireManager / platform admin), so the address is never the security.
import type { Role } from './types';

export type View =
  | 'home' | 'chat' | 'pipeline' | 'queries' | 'broadcasts' | 'flow' | 'bot_config' | 'analytics' | 'ads' | 'ai' | 'team' | 'whatsapp' | 'setup' | 'profile'
  | 'lead_statuses' | 'leads' | 'lead_assignment' | 'appointments' | 'clinic' | 'custom_fields' | 'activity';

/** 'doctor': clinic doctors (separate logins, not staff): their own appointments and hours only (src/DoctorApp.tsx). */
export type Area = 'platform' | 'admin' | 'manager' | 'agent' | 'doctor';
export const AREAS: readonly Area[] = ['platform', 'admin', 'manager', 'agent', 'doctor'];
export const AREA_OF_ROLE: Record<Role, Area> = { owner: 'admin', manager: 'manager', agent: 'agent' };
export const AREA_LABEL: Record<Area, string> = { platform: 'platform staff', admin: 'the Business Admin', manager: 'managers', agent: 'agents', doctor: 'doctors' };
/** Old addresses (before role areas): /app/... is moved to the signed-in role's own area. */
export const LEGACY_BASE = '/app';

/**
 * Screen -> its path inside the area, whether only managers and the Business Admin may open it, and its group:
 * 'work' screens are in the main menu; 'settings' screens (how the business is configured) are in the Settings area.
 */
export const SCREENS: Record<View, { path: string; managers: boolean; group: 'work' | 'settings' }> = {
  home: { path: 'home', managers: false, group: 'work' },
  chat: { path: 'inbox', managers: false, group: 'work' },
  pipeline: { path: 'pipeline', managers: false, group: 'work' },
  queries: { path: 'queries', managers: false, group: 'work' },
  leads: { path: 'leads', managers: true, group: 'work' },
  broadcasts: { path: 'broadcasts', managers: true, group: 'work' },
  analytics: { path: 'analytics', managers: true, group: 'work' },
  ads: { path: 'ads', managers: true, group: 'work' },
  // Hospitals / clinics only (shown when /api/clinic/status says enabled).
  appointments: { path: 'appointments', managers: false, group: 'work' },
  profile: { path: 'profile', managers: false, group: 'work' },
  setup: { path: 'settings/setup', managers: true, group: 'settings' },
  whatsapp: { path: 'settings/whatsapp', managers: true, group: 'settings' },
  team: { path: 'settings/team', managers: true, group: 'settings' },
  lead_statuses: { path: 'settings/lead-statuses', managers: true, group: 'settings' },
  lead_assignment: { path: 'settings/lead-assignment', managers: true, group: 'settings' },
  custom_fields: { path: 'settings/customer-fields', managers: true, group: 'settings' },
  // The Activity log: the Business Admin only (OWNER_ONLY below; the server refuses everyone else too).
  activity: { path: 'settings/activity', managers: true, group: 'settings' },
  clinic: { path: 'settings/clinic', managers: true, group: 'settings' },
  flow: { path: 'settings/bot-flow', managers: true, group: 'settings' },
  bot_config: { path: 'settings/keywords', managers: true, group: 'settings' },
  ai: { path: 'settings/ai', managers: true, group: 'settings' },
};
export const SETTINGS_PATH = 'settings';

/** Full address of a screen in an area, e.g. urlOf('/admin', 'ads') = '/admin/ads'. */
export const urlOf = (base: string, view: View) => `${base}/${SCREENS[view].path}`;

/** Which screen an address is (null when it isn't one, e.g. /admin or /admin/unknown). */
export function viewOf(pathname: string, base: string): View | null {
  if (!pathname.startsWith(`${base}/`)) return null;
  const rest = pathname.slice(base.length + 1).replace(/\/+$/, '');
  const hit = (Object.keys(SCREENS) as View[]).find(v => rest === SCREENS[v].path || rest.startsWith(`${SCREENS[v].path}/`));
  return hit || null;
}

/** Screens for the Business Admin only (not managers). */
export const OWNER_ONLY: readonly View[] = ['activity'];

/** May this role open this screen? (role: for the Business Admin's own screens) */
export const canOpen = (view: View, isManager: boolean, role?: string) => (!SCREENS[view].managers || isManager) && (!OWNER_ONLY.includes(view) || role === 'owner');

/** The area named by an address (/admin/ads -> 'admin'), 'legacy' for /app/..., null for anything else. */
export function areaOf(pathname: string): Area | 'legacy' | null {
  const seg = pathname.split('/')[1] || '';
  if (`/${seg}` === LEGACY_BASE) return 'legacy';
  return (AREAS as readonly string[]).includes(seg) ? seg as Area : null;
}

/** Platform console tabs: /platform/<tab>. */
export const PLATFORM_TABS = ['health', 'overview', 'businesses', 'onboarding', 'signups', 'plans', 'branding', 'events', 'worker', 'delivery', 'audit', 'support', 'maintenance', 'team'] as const;
export type PlatformTab = typeof PLATFORM_TABS[number];

/**
 * Platform roles (docs/progress/platform-roles.md). The server checks every request on its own
 * (server/platformRoutes.cjs); this only decides which tabs each role sees.
 */
export type PlatformRole = 'owner' | 'manager' | 'developer';
export const PLATFORM_ROLE_LABEL: Record<PlatformRole, string> = { owner: 'Platform Owner', manager: 'Application Manager', developer: 'Application Developer' };
const MANAGER_TABS: readonly PlatformTab[] = ['overview', 'businesses', 'onboarding', 'signups', 'support'];
const DEVELOPER_TABS: readonly PlatformTab[] = ['health', 'businesses', 'events', 'worker', 'delivery'];
/** May this platform role open this console tab? */
export const canOpenPlatformTab = (role: PlatformRole, tab: PlatformTab) =>
  role === 'owner' || (role === 'manager' ? MANAGER_TABS : DEVELOPER_TABS).includes(tab);
/** Where each role lands on /platform. */
export const PLATFORM_HOME: Record<PlatformRole, PlatformTab> = { owner: 'health', manager: 'overview', developer: 'health' };
