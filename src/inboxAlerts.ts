// New-chat alerts (server/inboxAlerts.cjs): a customer wrote, or a chat was handed to someone. The server sends them
// on the business's own Realtime channel (App.tsx passes them here); the alert has no name, number or text. This
// browser shows it only to its person (unassigned chats, or theirs): a sound, and a desktop notification while the
// tab is in the background (plus "(2) …" in the tab title). Nothing polls: hidden tabs still don't refresh.
import { useEffect, useRef, useState } from 'react';
import { refreshApi } from './queryClient';

export interface AlertPrefs { on: boolean; sound: boolean; desktop: boolean }
export type InboxAlert = { kind: 'message'; assignedTo: string | null; newChat: boolean } | { kind: 'assigned'; to: string };

const KEY = 'inbox_alerts_v1';
const PREFS_EVENT = 'inbox-alert-prefs';
const ALERT_EVENT = 'inbox-alert';
const DEFAULT: AlertPrefs = { on: true, sound: true, desktop: false };

export function readPrefs(): AlertPrefs {
  try { return { ...DEFAULT, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return DEFAULT; }
}
export function savePrefs(p: AlertPrefs) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage blocked: this session only */ }
  window.dispatchEvent(new CustomEvent(PREFS_EVENT, { detail: p }));
}
export function useAlertPrefs(): [AlertPrefs, (p: AlertPrefs) => void] {
  const [p, setP] = useState(readPrefs);
  useEffect(() => {
    const on = (e: Event) => setP((e as CustomEvent<AlertPrefs>).detail);
    window.addEventListener(PREFS_EVENT, on);
    return () => window.removeEventListener(PREFS_EVENT, on);
  }, []);
  return [p, savePrefs];
}

/** Pure: is this alert for me? Unassigned chats (anyone can take them) and my own (tested). */
export function isForMe(a: InboxAlert, myEmail: string): boolean {
  const me = String(myEmail || '').toLowerCase();
  if (!me) return false;
  if (a.kind === 'assigned') return a.to === me;
  return !a.assignedTo || a.assignedTo === me;
}
/** Pure: the notification's words (no customer details: the alert has none). */
export function alertText(a: InboxAlert): string {
  if (a.kind === 'assigned') return 'A chat was assigned to you';
  if (a.newChat) return 'New WhatsApp chat';
  return a.assignedTo ? 'New message in your chat' : 'New message in an unassigned chat';
}

/** From the Realtime channel (App.tsx). */
export function emitInboxAlert(event: 'inbox_message' | 'inbox_assigned', payload: unknown) {
  const p = (payload || {}) as Record<string, unknown>;
  const a: InboxAlert | null = event === 'inbox_assigned'
    ? (typeof p.to === 'string' ? { kind: 'assigned', to: p.to.toLowerCase() } : null)
    : { kind: 'message', assignedTo: typeof p.assignedTo === 'string' ? p.assignedTo.toLowerCase() : null, newChat: !!p.newChat };
  if (a) window.dispatchEvent(new CustomEvent(ALERT_EVENT, { detail: a }));
}

let audio: AudioContext | null = null;
/** Two short soft beeps (no sound file to load). */
function beep() {
  try {
    audio ||= new AudioContext();
    const ctx = audio;
    [0, 0.18].forEach(t => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.14);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.15);
    });
  } catch { /* no audio */ }
}

/**
 * Listen for alerts for this person. `openInbox` brings the inbox up when a notification is clicked.
 * @param myEmail the signed-in staff member's email
 */
export function useInboxAlerts(myEmail: string, openInbox: () => void) {
  const [prefs] = useAlertPrefs();
  const unseen = useRef(0);
  const baseTitle = useRef(document.title);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      unseen.current = 0;
      document.title = baseTitle.current;
    };
    const onAlert = (e: Event) => {
      const a = (e as CustomEvent<InboxAlert>).detail;
      if (!prefs.on || !isForMe(a, myEmail)) return;
      const hidden = document.visibilityState !== 'visible';
      if (!hidden) void refreshApi('/api/inbox?'); // the list catches up now instead of at the next refresh
      if (prefs.sound) beep();
      if (hidden) {
        if (!unseen.current) baseTitle.current = document.title;
        unseen.current += 1;
        document.title = `(${unseen.current}) ${baseTitle.current}`;
        if (prefs.desktop && 'Notification' in window && Notification.permission === 'granted') {
          const n = new Notification(alertText(a), { body: 'Open the inbox to reply.', tag: 'inbox-alert', icon: '/favicon.ico' });
          n.onclick = () => { window.focus(); openInbox(); n.close(); };
        }
      }
    };
    window.addEventListener(ALERT_EVENT, onAlert);
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.removeEventListener(ALERT_EVENT, onAlert); document.removeEventListener('visibilitychange', onVisible); };
  }, [prefs, myEmail, openInbox]);
}
