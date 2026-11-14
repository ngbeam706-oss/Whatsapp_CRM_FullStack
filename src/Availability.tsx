// Available / Away and working hours for automatic lead assignment (server/leadAssignment.cjs).
// Everyone sets their own: a quick switch in the account menu, and days + hours on My profile.
import { useState } from 'react';
import { CircleDot, Clock } from 'lucide-react';
import { api, errorMessage, inputInlineCls } from './broadcastUtils';
import { useApi, refreshApi } from './queryClient';
import { BUTTON } from './ui';
import type { ShowToast } from './types';

interface MyAvailability { availability: { available: boolean; days: number[]; startHour: number | null; endHour: number | null; onShift: boolean }; sendWindow: { start: number; end: number } }
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PATH = '/api/me/availability';

/** Account-menu switch: Available (new chats can be assigned to me) / Away. */
export function AvailabilityToggle() {
  const q = useApi<MyAvailability>(PATH);
  const [busy, setBusy] = useState(false);
  const a = q.data?.availability;
  if (!a) return null;
  const flip = async () => {
    setBusy(true);
    try { await api(PATH, { method: 'PUT', body: { available: !a.available } }); await refreshApi(PATH); } catch { /* shown on My profile */ } finally { setBusy(false); }
  };
  return (
    <button role="menuitemcheckbox" aria-checked={a.available} onClick={flip} disabled={busy} data-testid="availability-toggle"
      className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50 cursor-pointer">
      <CircleDot className={`w-4 h-4 ${a.available ? 'text-emerald-600' : 'text-slate-400'}`} aria-hidden="true" />
      <span className="flex-1 text-left">{a.available ? 'Available for new chats' : 'Away: no new chats'}</span>
      <span className={`text-xs font-semibold ${a.available ? 'text-emerald-700' : 'text-slate-500'}`}>{a.available ? 'On' : 'Off'}</span>
    </button>
  );
}

/** My profile: Available / Away, working days and hours (India time; empty = the business's sending hours). */
export function AvailabilityCard({ showToast }: { showToast: ShowToast }) {
  const q = useApi<MyAvailability>(PATH);
  const [draft, setDraft] = useState<{ days: number[]; start: string; end: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const d = q.data;
  if (!d) return null;
  const a = d.availability;
  const form = draft || { days: a.days, start: a.startHour === null ? '' : String(a.startHour), end: a.endHour === null ? '' : String(a.endHour) };
  const save = async (body: Record<string, unknown>, done: string) => {
    setBusy(true);
    try { await api(PATH, { method: 'PUT', body }); await refreshApi(PATH); setDraft(null); showToast(done); } catch (e) { showToast(errorMessage(e)); } finally { setBusy(false); }
  };
  const hours = Array.from({ length: 25 }, (_, h) => h);
  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3" data-testid="availability-card">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2"><Clock className="w-4 h-4 text-wa-teal" /> New chats for me</h2>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${a.available && a.onShift ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
          {!a.available ? 'Away' : a.onShift ? 'Available now' : 'Off shift now'}
        </span>
        <div className="flex-1" />
        <button onClick={() => save({ available: !a.available }, a.available ? 'You are away: no new chats for you' : 'You are available for new chats')} disabled={busy} className={BUTTON.secondary}>
          {a.available ? 'Go away' : 'Become available'}
        </button>
      </div>
      <p className="text-xs text-slate-500">When your business assigns new chats automatically, you only get them while you are available and on shift.</p>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Working days">
        {DAY.map((name, i) => (
          <button key={name} aria-pressed={form.days.includes(i)} onClick={() => setDraft({ ...form, days: form.days.includes(i) ? form.days.filter(x => x !== i) : [...form.days, i].sort() })}
            className={`px-2.5 py-1 rounded-full text-xs font-semibold border cursor-pointer ${form.days.includes(i) ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200'}`}>{name}</button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
        From
        <select value={form.start} onChange={e => setDraft({ ...form, start: e.target.value })} className={inputInlineCls} aria-label="Start hour">
          <option value="">{d.sendWindow.start}:00 (sending hours)</option>
          {hours.slice(0, 24).map(h => <option key={h} value={h}>{h}:00</option>)}
        </select>
        to
        <select value={form.end} onChange={e => setDraft({ ...form, end: e.target.value })} className={inputInlineCls} aria-label="End hour">
          <option value="">{d.sendWindow.end}:00 (sending hours)</option>
          {hours.slice(1).map(h => <option key={h} value={h}>{h}:00</option>)}
        </select>
        <span>India time</span>
        {draft && <button onClick={() => save({ days: form.days, startHour: form.start === '' ? null : Number(form.start), endHour: form.end === '' ? null : Number(form.end) }, 'Working hours saved')} disabled={busy || !form.days.length} className={BUTTON.primary}>Save hours</button>}
      </div>
    </section>
  );
}
