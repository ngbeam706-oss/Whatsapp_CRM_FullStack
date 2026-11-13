import { supabase } from './supabaseClient';

/**
 * fetch() for our own /api endpoints: attaches the signed-in staff member's
 * Supabase access token so the server can check who is calling.
 */
export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  const headers = new Headers(options.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(path, { ...options, headers });
  // Platform maintenance (server/maintenance.cjs): tell the app at once, from any request.
  if (res.status === 503 && !path.startsWith('/api/platform')) {
    res.clone().json()
      .then((d: { maintenance?: boolean; error?: string; until?: string | null }) => {
        if (d?.maintenance) window.dispatchEvent(new CustomEvent(MAINTENANCE_EVENT, { detail: { message: d.error || '', until: d.until || null } }));
      })
      .catch(() => { /* not JSON: not maintenance */ });
  }
  return res;
}

/** Fired on window when the server says the platform is under maintenance. detail: { message, until } */
export const MAINTENANCE_EVENT = 'app-maintenance';
