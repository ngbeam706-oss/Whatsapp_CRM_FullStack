import { useState } from 'react';
import { Shuffle, ArrowUp, ArrowDown, AlertTriangle, Save } from 'lucide-react';
import { api, errorMessage, inputInlineCls } from './broadcastUtils';
import { useApi, refreshApi, errorOf } from './queryClient';
import { BUTTON, Card, LoadError, PageHeader, SkeletonForm } from './ui';
import type { ShowToast } from './types';

type Mode = 'off' | 'round_robin' | 'least_busy';
interface Person { email: string; role: string; available: boolean; onShift: boolean; atCap: boolean; open: number }
interface Team { numberId: string; members: string[]; availableNow: string[] }
interface AssignmentView {
  settings: { mode: Mode; maxOpen: number | null; perNumber: boolean; updatedBy: string | null; updatedAt: string | null };
  teams: Team[]; people: Person[]; numbers: Array<{ id: string; label?: string; phoneNumber?: string; main?: boolean }>;
  sendWindow: { start: number; end: number }; tableReady: boolean;
  returning?: Returning;
}
interface Returning { ready: boolean; enabled: boolean; days: number; statusCustomers: boolean; statusOthers: boolean; owner: 'same' | 'afresh' }
const MODES: Array<[Mode, string, string]> = [
  ['off', 'Off', 'Nobody gets chats automatically: the first person to act on a chat takes it (as now).'],
  ['round_robin', 'Round-robin', 'New chats go to the team in turn: one each.'],
  ['least_busy', 'Least busy', 'New chats go to whoever has the fewest open chats.'],
];
const ROLE: Record<string, string> = { owner: 'Business Admin', manager: 'Manager', agent: 'Agent' };

/**
 * Settings -> Lead assignment (managers and the Business Admin; the server refuses agents too).
 * Only unassigned chats are given out; nobody's chat is ever taken away.
 */
export default function LeadAssignmentScreen({ showToast }: { showToast: ShowToast }) {
  const q = useApi<AssignmentView>('/api/lead-assignment');
  const error = errorOf(q);
  const data = q.data;
  const [draft, setDraft] = useState<{ mode: Mode; maxOpen: string; perNumber: boolean; teams: Record<string, string[]> } | null>(null);
  const [numberTab, setNumberTab] = useState('');
  const [busy, setBusy] = useState(false);
  if (!data) {
    return (
      <div className="flex-1 overflow-y-auto bg-slate-100"><div className="max-w-4xl mx-auto px-4 py-5 space-y-4">
        <PageHeader icon={Shuffle} title="Lead assignment" />
        {error ? <LoadError error={error} onRetry={() => q.refetch()} /> : <SkeletonForm fields={4} label="Loading lead assignment" />}
      </div></div>
    );
  }
  const saved = { mode: data.settings.mode, maxOpen: data.settings.maxOpen === null ? '' : String(data.settings.maxOpen), perNumber: data.settings.perNumber, teams: Object.fromEntries(data.teams.map(t => [t.numberId, t.members])) };
  const form = draft || saved;
  const set = (patch: Partial<typeof form>) => setDraft({ ...form, ...patch });
  const multi = data.numbers.length > 1;
  const key = form.perNumber && multi ? numberTab : '';
  const team = form.teams[key] || [];
  const byEmail = new Map(data.people.map(p => [p.email, p]));
  const setTeam = (list: string[]) => set({ teams: { ...form.teams, [key]: list } });
  const move = (i: number, d: -1 | 1) => { const l = [...team]; const j = i + d; if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; setTeam(l); };
  const stateOf = (p?: Person) => (!p ? { label: 'Not on the team', cls: 'bg-rose-50 text-rose-700' } : !p.available ? { label: 'Away', cls: 'bg-slate-100 text-slate-600' }
    : !p.onShift ? { label: 'Off shift', cls: 'bg-slate-100 text-slate-600' } : p.atCap ? { label: 'At the limit', cls: 'bg-amber-50 text-amber-800' } : { label: 'Available', cls: 'bg-emerald-50 text-emerald-800' });
  const availableNow = (data.teams.find(t => t.numberId === key)?.availableNow) || [];
  const nobody = form.mode !== 'off' && !draft && team.length > 0 && availableNow.length === 0;
  const numberName = (id: string) => { const n = data.numbers.find(x => x.id === id); return n ? (n.label || (n.phoneNumber ? `+${n.phoneNumber}` : id)) : id; };

  const save = async () => {
    setBusy(true);
    try {
      await api('/api/lead-assignment', { method: 'PUT', body: {
        mode: form.mode, maxOpen: form.maxOpen === '' ? null : Number(form.maxOpen), perNumber: form.perNumber,
        teams: Object.entries(form.teams).filter(([k, m]) => k === '' || (form.perNumber && m.length)).map(([numberId, members]) => ({ numberId, members })),
      } });
      await refreshApi('/api/lead-assignment');
      setDraft(null);
      showToast('Lead assignment saved');
    } catch (e) { showToast(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-100" data-testid="lead-assignment">
      <div className="max-w-4xl mx-auto px-4 py-5 space-y-4">
        <PageHeader icon={Shuffle} title="Lead assignment" help="Give new chats to your team automatically. Only chats that nobody has yet are given out; a chat is never taken away from someone."
          actions={<button onClick={save} disabled={busy || !draft} className={BUTTON.primary}><Save className="w-3.5 h-3.5" /> {busy ? 'Saving…' : 'Save'}</button>} />
        {!data.tableReady && <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">This needs the database update for lead assignment (SQL 20261136). Ask the platform team.</div>}

        <Card title="How new chats are given out">
          <div className="grid sm:grid-cols-3 gap-2" role="radiogroup" aria-label="Mode">
            {MODES.map(([m, label, help]) => (
              <button key={m} role="radio" aria-checked={form.mode === m} onClick={() => set({ mode: m })}
                className={`text-left rounded-lg border p-3 cursor-pointer ${form.mode === m ? 'border-wa-teal bg-teal-50 ring-1 ring-wa-teal' : 'border-slate-200 hover:bg-slate-50'}`}>
                <div className="text-sm font-semibold text-slate-800">{label}</div>
                <div className="text-xs text-slate-500 mt-0.5">{help}</div>
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-2">It assigns a new customer chat, an unassigned chat that becomes active again, and a chat where the customer asks for a person. Leads you add by hand stay with whoever you choose.</p>
        </Card>

        {form.mode !== 'off' && (
          <>
            <Card title="Limits">
              <label className="flex flex-wrap items-center gap-2 text-sm text-slate-700">Skip people who already have
                <input type="number" min={1} value={form.maxOpen} onChange={e => set({ maxOpen: e.target.value })} placeholder="no limit" className={`${inputInlineCls} w-28`} aria-label="Max open chats" />
                open chats
              </label>
              {multi && (
                <label className="flex items-center gap-2 text-sm text-slate-700 mt-3">
                  <input type="checkbox" checked={form.perNumber} onChange={e => set({ perNumber: e.target.checked })} /> Each WhatsApp number has its own team
                </label>
              )}
            </Card>

            <Card title="Who is in the rotation">
              {form.perNumber && multi && (
                <div className="flex flex-wrap gap-1.5 mb-3" role="tablist" aria-label="Team for">
                  {[['', 'All other numbers'] as [string, string], ...data.numbers.map(n => [n.id, numberName(n.id)] as [string, string])].map(([id, label]) => (
                    <button key={id || 'all'} role="tab" aria-selected={numberTab === id} onClick={() => setNumberTab(id)}
                      className={`px-3 py-1 rounded-full text-xs font-semibold border cursor-pointer ${numberTab === id ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200'}`}>{label}</button>
                  ))}
                </div>
              )}
              {nobody && (
                <div className="mb-3 p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 flex items-start gap-1.5" data-testid="nobody-available">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px" /> No one in this team is available right now. New chats stay unassigned (in the Inbox's Unassigned view) until someone is.
                </div>
              )}
              <ol className="space-y-1.5" data-testid="rotation-team">
                {team.map((email, i) => {
                  const p = byEmail.get(email);
                  const st = stateOf(p);
                  return (
                    <li key={email} className="flex items-center gap-2 bg-slate-50 rounded-lg px-2 py-1.5 text-sm">
                      <span className="w-5 text-xs text-slate-400 text-right">{i + 1}.</span>
                      <span className="flex-1 min-w-0 truncate">{email}</span>
                      <span className="text-xs text-slate-500">{p ? `${p.open} open` : ''}</span>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                      <button onClick={() => move(i, -1)} disabled={i === 0} className="p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-30 cursor-pointer" aria-label={`Move ${email} up`}><ArrowUp className="w-3.5 h-3.5" /></button>
                      <button onClick={() => move(i, 1)} disabled={i === team.length - 1} className="p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-30 cursor-pointer" aria-label={`Move ${email} down`}><ArrowDown className="w-3.5 h-3.5" /></button>
                      <button onClick={() => setTeam(team.filter(e => e !== email))} className="text-xs text-red-700 hover:underline cursor-pointer" aria-label={`Take ${email} out`}>Remove</button>
                    </li>
                  );
                })}
                {!team.length && <li className="text-xs text-slate-500">Nobody yet. Add people below.</li>}
              </ol>
              <div className="flex flex-wrap gap-1.5 mt-3">
                {data.people.filter(p => !team.includes(p.email)).map(p => (
                  <button key={p.email} onClick={() => setTeam([...team, p.email])} className="text-xs px-2.5 py-1 rounded-full border border-slate-300 bg-white hover:bg-slate-50 cursor-pointer" aria-label={`Add ${p.email}`}>
                    + {p.email} <span className="text-slate-400">({ROLE[p.role] || p.role})</span>
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-500 mt-3">Each person sets Available / Away in their account menu, and working days and hours on My profile (default: the business's sending hours, {data.sendWindow.start}:00–{data.sendWindow.end}:00).</p>
            </Card>
          </>
        )}
        {data.returning && <ReturningCard key={JSON.stringify(data.returning)} value={data.returning} showToast={showToast} />}
        {data.settings.updatedBy && <p className="text-xs text-slate-500">Last changed by {data.settings.updatedBy}{data.settings.updatedAt ? ` on ${new Date(data.settings.updatedAt).toLocaleString()}` : ''}.</p>}
      </div>
    </div>
  );
}

/** Returning customers: written again after N days of silence (server/returningLeads.cjs). */
function ReturningCard({ value, showToast }: { value: Returning; showToast: ShowToast }) {
  const [f, setF] = useState(value);
  const [busy, setBusy] = useState(false);
  const changed = JSON.stringify(f) !== JSON.stringify(value);
  const set = (patch: Partial<Returning>) => setF(old => ({ ...old, ...patch }));
  const save = async () => {
    setBusy(true);
    try {
      await api('/api/lead-assignment', { method: 'PUT', body: { returning: { enabled: f.enabled, days: Number(f.days), statusCustomers: f.statusCustomers, statusOthers: f.statusOthers, owner: f.owner } } });
      await refreshApi('/api/lead-assignment');
      showToast('Returning customers saved');
    } catch (e) { showToast(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3" data-testid="returning-card">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold text-slate-800 flex-1">Returning customers</h2>
        <button onClick={save} disabled={busy || !changed || !value.ready} className={BUTTON.primary}><Save className="w-3.5 h-3.5" /> Save</button>
      </div>
      {!value.ready && <p className="text-xs text-amber-800">This needs the database update for returning customers (SQL 20261138).</p>}
      <label className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={f.enabled} onChange={e => set({ enabled: e.target.checked })} /> When someone writes again after
        <input type="number" min={7} max={365} value={f.days} onChange={e => set({ days: Number(e.target.value) })} className={`${inputInlineCls} w-20`} aria-label="Days of silence" />
        days of silence:
      </label>
      {f.enabled && (
        <div className="space-y-2 pl-6 text-sm text-slate-700">
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.statusCustomers} onChange={e => set({ statusCustomers: e.target.checked })} /> A past customer (booked, done or returning) moves to your first "Returning" status</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.statusOthers} onChange={e => set({ statusOthers: e.target.checked })} /> Someone who never booked, or was lost, moves to your first "New" status (a re-enquiry)</label>
          <div className="flex flex-wrap items-center gap-3" role="radiogroup" aria-label="Who gets the chat">
            <span>Who gets the chat:</span>
            <label className="flex items-center gap-1.5"><input type="radio" name="return-owner" checked={f.owner === 'same'} onChange={() => set({ owner: 'same' })} /> The same person, if they are available</label>
            <label className="flex items-center gap-1.5"><input type="radio" name="return-owner" checked={f.owner === 'afresh'} onChange={() => set({ owner: 'afresh' })} /> Assign afresh</label>
          </div>
          <p className="text-xs text-slate-500">If the previous person is away, off shift, at their limit or no longer on the team, the chat is unassigned and the rotation above gives it to someone (with rotation Off it waits in Unassigned). The chat shows "Back after …" and can be filtered as Returning.</p>
        </div>
      )}
    </section>
  );
}
