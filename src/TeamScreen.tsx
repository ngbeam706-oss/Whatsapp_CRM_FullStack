import React, { useState, type FormEvent } from 'react';
import { useConfirm } from './confirm';
import { Users, Trash2, ShieldCheck, Mail, Briefcase, Trophy, X, ChevronRight, BarChart3, KeyRound, IdCard, Pencil, Lock } from 'lucide-react';
import { StaffDetailsFields, StaffDetailsView, changedDetails, DETAIL_KEYS, type StaffDetails } from './StaffDetailsFields';
import { api, inputInlineCls } from './broadcastUtils';
import { LoadError, SkeletonCards, SkeletonRows } from './ui';
import { AddMember, SetPasswordDialog } from './TeamPasswords';
import { canSetPassword } from './teamPasswordRules';
import { useApi, refreshApi, errorOf } from './queryClient';
import { avatarBg, roleLabel } from './crmUtils';
import { DailyBars, PeriodPicker, StatTiles } from './staffStatsUi';
import { fmtAgo, fmtMinutes, initials, pointsHelp, MEDAL } from './staffFormat';
import type { Role, ShowToast, StaffMember, StaffPoints, StaffStats, TeamResponse } from './types';

const ROLE_BADGE: Record<Role, string> = {
  owner: 'bg-emerald-100 text-emerald-800',
  manager: 'bg-sky-100 text-sky-800',
  agent: 'bg-slate-100 text-slate-700',
};

const roleAs = (r: Role): string => (r === 'agent' ? 'an agent' : r === 'manager' ? 'a manager' : 'a Business Admin');
const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

interface PerformanceResponse {
  from: string; days: number; members: StaffStats[]; points: StaffPoints;
  team: { repliesSent: number; chatsHandled: number; conversions: number; queriesResolved: number; calls: number; notes: number; medianResponseMin: number | null };
}
interface MemberResponse { days: number; teamSize: number; points: StaffPoints; member: StaffStats; canEdit?: boolean; updatedBy?: string | null }

type Tab = 'members' | 'performance';
type SortKey = 'rank' | 'chatsHandled' | 'repliesSent' | 'medianResponseMin' | 'conversions' | 'queriesResolved' | 'calls';
const SORTS: Record<SortKey, string> = {
  rank: 'Ranking (points)', chatsHandled: 'Chats handled', repliesSent: 'Replies sent', medianResponseMin: 'Fastest response',
  conversions: 'Conversions', queriesResolved: 'Queries resolved', calls: 'Calls answered',
};

/** The team: members (invite, roles), each person's details and activity, and the team ranking. */
export default function TeamScreen({ showToast }: { showToast: ShowToast }) {
  const teamQuery = useApi<TeamResponse>('/api/team'); // shared with the Inbox (assignee menu) and Pipeline
  const team = teamQuery.data || null;
  const error = errorOf(teamQuery);
  const [tab, setTab] = useState<Tab>('members');
  const [days, setDays] = useState(30);
  const [openId, setOpenId] = useState<string | null>(null);

  const tabBtn = (t: Tab, label: string, icon: React.ReactNode) => (
    <button role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
      className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px cursor-pointer ${tab === t ? 'border-wa-teal text-wa-teal' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
      {icon}{label}
    </button>
  );

  return (
    <div className="flex-1 overflow-y-auto bg-slate-100">
      <div className="max-w-5xl mx-auto px-4 py-5 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Users className="w-5 h-5 text-wa-teal" /> Team</h1>
            <p className="text-xs text-slate-500">Who can sign in to this business's dashboard, their details and how each person is doing.</p>
          </div>
          {tab === 'performance' && <PeriodPicker days={days} onChange={setDays} />}
        </div>

        <div className="flex gap-1 border-b border-slate-200" role="tablist" aria-label="Team">
          {tabBtn('members', `Members${team ? ` (${team.staff.length})` : ''}`, <Users className="w-4 h-4" />)}
          {tabBtn('performance', 'Performance & ranking', <BarChart3 className="w-4 h-4" />)}
        </div>

        {error && <LoadError error={error} onRetry={() => teamQuery.refetch()} />}
        {tab === 'members' && <Members team={team} error={error} showToast={showToast} onOpen={setOpenId} />}
        {tab === 'performance' && <Performance days={days} onOpen={setOpenId} />}
      </div>
      {openId && <MemberDrawer userId={openId} days={days} onDays={setDays} onClose={() => setOpenId(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Members: invite, roles, remove
// ---------------------------------------------------------------------------

function Members({ team, error, showToast, onOpen }: { team: TeamResponse | null; error: string; showToast: ShowToast; onOpen: (id: string) => void }) {
  const load = () => refreshApi('/api/team');
  const confirm = useConfirm();
  const myRole = (team?.me?.role || 'agent') as Role;
  const isOwner = myRole === 'owner';
  const [passwordFor, setPasswordFor] = useState<StaffMember | null>(null);

  const changeRole = async (m: StaffMember, newRole: Role) => {
    try {
      await api(`/api/team/${m.user_id}`, { method: 'PATCH', body: { role: newRole } });
      showToast(`${m.full_name || m.email} is now ${roleAs(newRole)}`);
      load();
    } catch (err) {
      showToast(message(err));
    }
  };

  const remove = async (m: StaffMember) => {
    if (!(await confirm({ title: `Remove ${m.full_name || m.email}?`, body: 'They lose access within a minute and their chats go back to "Unassigned".', confirmLabel: 'Remove', danger: true }))) return;
    try {
      await api(`/api/team/${m.user_id}`, { method: 'DELETE' });
      showToast(`${m.full_name || m.email} removed`);
      load();
    } catch (err) {
      showToast(message(err));
    }
  };

  return (
    <>
      {(myRole === 'owner' || myRole === 'manager') && <AddMember myRole={myRole} showToast={showToast} />}
      {passwordFor && <SetPasswordDialog member={passwordFor} onClose={() => setPasswordFor(null)} showToast={showToast} />}

      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {!team && !error && <div className="p-4"><SkeletonRows rows={4} label="Loading the team" /></div>}
        {team?.staff.map(m => {
          const isMe = m.user_id === team.me.id;
          return (
            <div key={m.user_id} className="flex items-center gap-3 px-4 py-3">
              <button onClick={() => m.user_id && onOpen(m.user_id)} className="flex items-center gap-3 flex-1 min-w-0 text-left cursor-pointer group" title="Details and activity">
                <div className={`w-10 h-10 rounded-full ${avatarBg(m.email)} text-white flex items-center justify-center font-bold text-xs flex-shrink-0`}>{initials(m.full_name, m.email)}</div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-800 truncate group-hover:text-wa-teal">{m.full_name || m.email}{isMe && <span className="text-slate-400 font-normal"> (you)</span>}</div>
                  <div className="text-xs text-slate-500 truncate">{[m.full_name ? m.email : null, m.job_title, `added ${m.created_at ? new Date(m.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '–'}`].filter(Boolean).join(' · ')}</div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-wa-teal flex-shrink-0" />
              </button>
              {canSetPassword(myRole, m, isMe) && (
                <button onClick={() => setPasswordFor(m)} className="p-1.5 text-slate-400 hover:text-wa-teal cursor-pointer" title="Set a new password" aria-label={`Set password for ${m.email}`}>
                  <KeyRound className="w-4 h-4" />
                </button>
              )}
              {isOwner && !isMe ? (
                <>
                  <select value={m.role} onChange={e => changeRole(m, e.target.value as Role)} aria-label={`Role of ${m.email}`} className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white cursor-pointer">
                    <option value="agent">Agent</option>
                    <option value="manager">Manager</option>
                    <option value="owner">Business Admin</option>
                  </select>
                  <button onClick={() => remove(m)} className="p-1.5 text-slate-400 hover:text-red-600 cursor-pointer" title="Remove access" aria-label={`Remove ${m.email}`}><Trash2 className="w-4 h-4" /></button>
                </>
              ) : (
                <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded-full flex items-center gap-1 ${ROLE_BADGE[m.role] || ROLE_BADGE.agent}`}>
                  {m.role === 'owner' && <ShieldCheck className="w-3 h-3" />}
                  {m.role === 'manager' && <Briefcase className="w-3 h-3" />}
                  {roleLabel(m.role)}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 text-xs text-slate-600 space-y-1.5">
        <div className="font-semibold text-slate-800">What each role can do</div>
        <div><strong>Agent:</strong> the Inbox, Pipeline and Queries: reply to their own and unassigned chats, take unassigned chats, move customers between stages, add notes and tags, answer WhatsApp calls. Plus their own profile and performance. Their password is set by a manager or the Business Admin (they can't change or reset it).</div>
        <div><strong>Manager:</strong> everything above on all chats, plus reassigning chats, the bot flow and keywords, the AI switch and knowledge, templates, broadcasts, follow-ups, analytics, ads and team performance.</div>
        <div><strong>Business Admin:</strong> everything above, plus the team (invite, roles, remove), the AI provider and key, the WhatsApp connection and setup.</div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Performance: team totals and the ranking
// ---------------------------------------------------------------------------

function Performance({ days, onOpen }: { days: number; onOpen: (id: string) => void }) {
  const q = useApi<PerformanceResponse>(`/api/team/performance?days=${days}`, { keepPrevious: true, staleTime: 60000 });
  const data = q.data || null;
  const error = errorOf(q);
  const [sort, setSort] = useState<SortKey>('rank');

  if (error) return <LoadError error={error} onRetry={() => q.refetch()} />;
  if (!data) return <><SkeletonCards count={4} label="Loading team performance" /><SkeletonRows rows={4} label="Loading team performance" /></>;

  const rows = [...data.members].sort((a, b) => {
    if (sort === 'rank') return a.rank - b.rank;
    if (sort === 'medianResponseMin') return (a.medianResponseMin ?? Infinity) - (b.medianResponseMin ?? Infinity);
    return (b[sort] as number) - (a[sort] as number) || a.rank - b.rank;
  });
  const t = data.team;
  const totals: Array<[string, string | number]> = [
    ['Chats handled', t.chatsHandled], ['Replies sent', t.repliesSent], ['Typical response', fmtMinutes(t.medianResponseMin)],
    ['Conversions', t.conversions], ['Queries resolved', t.queriesResolved], ['Calls answered', t.calls],
  ];
  const top = data.members.slice(0, 3).filter(m => m.points > 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        {totals.map(([label, value]) => (
          <div key={label} className="bg-white border border-slate-200 rounded-xl p-3">
            <div className="text-xs font-medium text-slate-500">{label}</div>
            <div className="text-xl font-bold text-slate-800 tabular-nums">{value}</div>
          </div>
        ))}
      </div>

      {top.length > 0 && (
        <div className="grid sm:grid-cols-3 gap-2.5">
          {top.map(m => (
            <button key={m.userId} onClick={() => onOpen(m.userId)} className="bg-white border border-slate-200 hover:border-wa-teal rounded-xl p-3 flex items-center gap-3 text-left cursor-pointer">
              <span className="text-2xl" aria-hidden>{MEDAL[m.rank - 1] || '🏅'}</span>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-800 truncate">{m.fullName || m.email}</div>
                <div className="text-xs text-slate-500">#{m.rank} · {m.points} points · {m.chatsHandled} chats</div>
              </div>
            </button>
          ))}
        </div>
      )}

      <section className="bg-white border border-slate-200 rounded-xl">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-100">
          <div className="text-sm font-semibold text-slate-800 flex items-center gap-1.5"><Trophy className="w-4 h-4 text-amber-500" /> Team ranking, last {data.days} days</div>
          <select value={sort} onChange={e => setSort(e.target.value as SortKey)} aria-label="Sort by" className={inputInlineCls}>
            {(Object.keys(SORTS) as SortKey[]).map(k => <option key={k} value={k}>Sort: {SORTS[k]}</option>)}
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 text-left">
                {['#', 'Member', 'Points', 'Chats', 'Replies', 'Typical response', 'Conversions', 'Queries resolved', 'Calls', 'Last active'].map((h, i) => (
                  <th key={h} className={`px-3 py-2 font-medium whitespace-nowrap ${i > 1 ? 'text-right' : ''}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(m => (
                <tr key={m.userId} onClick={() => onOpen(m.userId)} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer">
                  <td className="px-3 py-2.5 font-bold text-slate-700 whitespace-nowrap">{m.rank <= 3 && m.points > 0 ? MEDAL[m.rank - 1] : `#${m.rank}`}</td>
                  <td className="px-3 py-2.5 min-w-[180px]">
                    <div className="flex items-center gap-2">
                      <div className={`w-7 h-7 rounded-full ${avatarBg(m.email)} text-white flex items-center justify-center font-bold text-xs flex-shrink-0`}>{initials(m.fullName, m.email)}</div>
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-800 truncate">{m.fullName || m.email}</div>
                        <div className="text-xs text-slate-500 truncate">{roleLabel(m.role)}{m.jobTitle ? ` · ${m.jobTitle}` : ''}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right font-bold tabular-nums">{m.points}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{m.chatsHandled}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{m.repliesSent}</td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">{fmtMinutes(m.medianResponseMin)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{m.conversions}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{m.queriesResolved}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{m.calls}</td>
                  <td className="px-3 py-2.5 text-right text-slate-500 whitespace-nowrap">{fmtAgo(m.lastActive)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-2.5 text-xs text-slate-500 border-t border-slate-100">{pointsHelp(data.points)} Click a member for their details.</p>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One member: personal details and activity
// ---------------------------------------------------------------------------

/** A member's details (what this viewer may see), and "Edit details" for those who manage them. */
function MemberDetails({ member, canEdit, updatedBy }: { member: StaffStats; canEdit: boolean; updatedBy: string | null }) {
  const current: StaffDetails = Object.fromEntries(DETAIL_KEYS.filter(k => k in member).map(k => [k, (member as unknown as Record<string, string>)[k] || ''])) as StaffDetails;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<StaffDetails>(current);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const changes = changedDetails(current, form);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await api(`/api/team/members/${member.userId}/profile`, { method: 'PUT', body: changes });
      await Promise.all([refreshApi(`/api/team/members/${member.userId}`), refreshApi('/api/team')]);
      setEditing(false);
    } catch (e2) {
      setErr(message(e2));
    } finally {
      setBusy(false);
    }
  };
  const empty = !DETAIL_KEYS.some(k => k !== 'fullName' && current[k]);
  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4" data-testid="member-details" aria-label="Personal and onboarding details">
      <div className="flex items-center gap-2 mb-3">
        <IdCard className="w-4 h-4 text-wa-teal" />
        <h3 className="text-sm font-bold text-slate-800 flex-1">Personal and onboarding details</h3>
        {canEdit && !editing && <button onClick={() => { setForm(current); setEditing(true); }} className="text-xs font-semibold text-wa-teal hover:underline cursor-pointer flex items-center gap-1"><Pencil className="w-3.5 h-3.5" /> Edit details</button>}
      </div>
      {editing ? (
        <form onSubmit={save} className="space-y-3" aria-label="Edit details">
          <StaffDetailsFields value={form} onChange={setForm} adminFields="edit" idPrefix="edit-member" withName />
          {err && <div className="p-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700" role="alert">{err}</div>}
          <div className="flex gap-2">
            <button type="submit" disabled={busy || !Object.keys(changes).length} className="bg-wa-teal hover:opacity-90 disabled:opacity-50 text-white rounded-lg px-3 py-2 text-xs font-semibold cursor-pointer">{busy ? 'Saving…' : 'Save details'}</button>
            <button type="button" onClick={() => setEditing(false)} className="bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs font-semibold text-slate-700 cursor-pointer">Cancel</button>
          </div>
        </form>
      ) : (
        <>
          <StaffDetailsView value={current} />
          {empty && <p className="text-xs text-slate-400 mt-2">{canEdit ? 'Nothing filled in yet. Press "Edit details" to add them.' : 'Nothing filled in yet.'}</p>}
          {!('address' in member) && <p className="text-xs text-slate-400 mt-2 flex items-center gap-1"><Lock className="w-3 h-3" /> Private details (address, emergency contact, employee details) are shown only to the Business Admin{member.role === 'manager' ? '' : ' and managers'}.</p>}
          {updatedBy && <p className="text-xs text-slate-400 mt-2">Last changed by {updatedBy}.</p>}
        </>
      )}
    </section>
  );
}

function MemberDrawer({ userId, days, onDays, onClose }: { userId: string; days: number; onDays: (d: number) => void; onClose: () => void }) {
  const q = useApi<MemberResponse>(`/api/team/members/${userId}?days=${days}`, { keepPrevious: true, staleTime: 60000 });
  const data = q.data && q.data.member.userId === userId ? q.data : null;
  const error = errorOf(q);
  const m = data?.member;
  const detail = (icon: React.ReactNode, label: string, value: string | undefined) => (
    <div className="flex items-start gap-2 text-xs min-w-0">
      <span className="text-slate-400 mt-0.5">{icon}</span>
      <div className="min-w-0"><div className="text-xs text-slate-400">{label}</div><div className="text-slate-700 truncate">{value || '–'}</div></div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <aside role="dialog" aria-modal="true" aria-label="Team member" onClick={e => e.stopPropagation()}
        className="w-full max-w-2xl h-full bg-slate-50 shadow-2xl overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between gap-2 z-10">
          <div className="text-sm font-bold text-slate-800">Team member</div>
          <div className="flex items-center gap-2">
            <PeriodPicker days={days} onChange={onDays} />
            <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 cursor-pointer" aria-label="Close"><X className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="p-4 space-y-4">
          {error && <LoadError error={error} onRetry={() => q.refetch()} />}
          {!m && !error && <SkeletonRows rows={4} label="Loading" />}
          {m && data && (
            <>
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="flex items-center gap-3">
                  <div className={`w-14 h-14 rounded-full ${avatarBg(m.email)} text-white flex items-center justify-center font-bold text-lg flex-shrink-0`}>{initials(m.fullName, m.email)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-slate-800 truncate">{m.fullName || m.email}</div>
                    <div className="text-xs text-slate-500 truncate">{m.jobTitle || roleLabel(m.role)}</div>
                    <span className={`inline-block mt-1 text-xs font-bold uppercase px-2 py-0.5 rounded-full ${ROLE_BADGE[m.role] || ROLE_BADGE.agent}`}>{roleLabel(m.role)}</span>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl">{m.rank <= 3 && m.points > 0 ? MEDAL[m.rank - 1] : <Trophy className="w-6 h-6 text-amber-500 inline" />}</div>
                    <div className="text-xs font-bold text-slate-700">#{m.rank} of {data.teamSize}</div>
                    <div className="text-xs text-slate-500">{m.points} points</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-4 pt-3 border-t border-slate-100">
                  {detail(<Mail className="w-3.5 h-3.5" />, 'Login email', m.email)}
                  {detail(<Briefcase className="w-3.5 h-3.5" />, 'Dashboard access since', m.joinedAt ? new Date(m.joinedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : undefined)}
                </div>
              </div>
              <MemberDetails member={m} canEdit={!!data.canEdit} updatedBy={data.updatedBy || null} />

<StatTiles s={m} compact />
              <DailyBars daily={m.daily} />
              <p className="text-xs text-slate-500">{pointsHelp(data.points)}</p>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
