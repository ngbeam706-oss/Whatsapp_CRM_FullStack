import { useState, type FormEvent, type ReactNode } from 'react';
import { UserCircle2, Save, Trophy, Mail, Briefcase, Phone, Languages, Building2 } from 'lucide-react';
import { api, errorMessage, btnPrimary } from './broadcastUtils';
import { useApi, refreshApi, errorOf } from './queryClient';
import { avatarBg, roleLabel } from './crmUtils';
import { DailyBars, PeriodPicker, StatTiles } from './staffStatsUi';
import { pointsHelp, MEDAL, initials } from './staffFormat';
import type { Role, ShowToast, StaffPoints, StaffStats } from './types';
import { StaffDetailsFields, changedDetails, DETAIL_KEYS, ADMIN_KEYS, type DetailKey, type StaffDetails } from './StaffDetailsFields';
import BusinessDetailsCard from './BusinessDetailsCard';
import { AvailabilityCard } from './Availability';
import { useLocation } from 'react-router';

// "My profile" (every staff member): my personal details, my activity and my place in the team.
// Agents see only their own numbers; the team's ranking is on the Team page (managers).

interface MyProfileResponse {
  from: string; days: number; teamSize: number; points: StaffPoints;
  profile: { email: string; role: Role; businessName?: string } & StaffDetails & { fullName: string; phone: string; jobTitle: string; languages: string };
  stats: StaffStats | null;
}

export default function ProfileScreen({ showToast }: { showToast: ShowToast }) {
  const [days, setDays] = useState(30);
  const q = useApi<MyProfileResponse>(`/api/me/profile?days=${days}`, { keepPrevious: true, staleTime: 60000 });
  const data = q.data || null;
  const error = errorOf(q);
  const area = useLocation().pathname.split('/')[1]; // the role's area (/admin, /manager…)

  return (
    <div className="flex-1 overflow-y-auto bg-slate-100">
      <div className="max-w-5xl mx-auto px-4 py-5 space-y-4">
        <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2"><UserCircle2 className="w-5 h-5 text-wa-teal" /> My profile</h1>
        {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{error}</div>}
        {!data && !error && <div className="text-sm text-slate-500">Loading…</div>}
        {data && (
          <>
            <div className="grid md:grid-cols-[320px_1fr] gap-4 items-start">
              <ProfileCard data={data} />
              <DetailsForm key={JSON.stringify(data.profile)} data={data} showToast={showToast} />
            </div>
            {/* Available / Away and working hours (automatic lead assignment). */}
            <AvailabilityCard showToast={showToast} />
            {/* The Business Admin also keeps the business's own details here. */}
            {data.profile.role === 'owner' && <BusinessDetailsCard showToast={showToast} settingsPath={`/${area || 'admin'}/settings/setup`} />}

            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-slate-800">My performance</h2>
                <PeriodPicker days={days} onChange={setDays} />
              </div>
              {data.stats ? (
                <>
                  <RankCard s={data.stats} teamSize={data.teamSize} points={data.points} days={data.days} />
                  <StatTiles s={data.stats} />
                  <DailyBars daily={data.stats.daily} />
                </>
              ) : <div className="text-sm text-slate-500">No activity yet.</div>}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function ProfileCard({ data }: { data: MyProfileResponse }) {
  const p = data.profile;
  const name = p.fullName || p.email;
  const row = (icon: ReactNode, text: string) => text ? <div className="flex items-center gap-2 text-xs text-slate-600 min-w-0">{icon}<span className="truncate">{text}</span></div> : null;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className={`w-14 h-14 rounded-full ${avatarBg(p.email)} text-white flex items-center justify-center font-bold text-lg flex-shrink-0`}>{initials(p.fullName, p.email)}</div>
        <div className="min-w-0">
          <div className="font-bold text-slate-800 truncate">{name}</div>
          <div className="text-xs text-slate-500 truncate">{p.jobTitle || roleLabel(p.role)}</div>
          <span className="inline-block mt-1 text-xs font-bold uppercase px-2 py-0.5 rounded-full bg-teal-50 text-teal-800">{roleLabel(p.role)}</span>
        </div>
      </div>
      <div className="space-y-1.5 pt-2 border-t border-slate-100">
        {row(<Mail className="w-3.5 h-3.5 text-slate-400" />, p.email)}
        {row(<Phone className="w-3.5 h-3.5 text-slate-400" />, p.phone)}
        {row(<Languages className="w-3.5 h-3.5 text-slate-400" />, p.languages)}
        {row(<Building2 className="w-3.5 h-3.5 text-slate-400" />, p.businessName || '')}
        {data.stats?.joinedAt && row(<Briefcase className="w-3.5 h-3.5 text-slate-400" />, `In the team since ${new Date(data.stats.joinedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`)}
      </div>
    </div>
  );
}

function DetailsForm({ data, showToast }: { data: MyProfileResponse; showToast: ShowToast }) {
  const p = data.profile;
  const initial: StaffDetails = Object.fromEntries(DETAIL_KEYS.map(k => [k, (p as Record<string, unknown>)[k] ? String((p as Record<string, unknown>)[k]) : ''])) as StaffDetails;
  const [form, setForm] = useState<StaffDetails>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // Employee ID, joining date and branch are set by the Business Admin / a manager, never sent from here,
  // except by the Business Admin for themself (nobody above them sets them).
  const owner = p.role === 'owner';
  const changes = Object.fromEntries(Object.entries(changedDetails(initial, form)).filter(([k]) => owner || !ADMIN_KEYS.includes(k as DetailKey)));
  const dirty = Object.keys(changes).length > 0;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await api('/api/me/profile', { method: 'PUT', body: changes });
      showToast('Profile saved');
      await Promise.all([refreshApi('/api/me/profile'), refreshApi('/api/team')]);
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="bg-white border border-slate-200 rounded-xl p-4 space-y-3" aria-label="My personal details">
      <div className="text-sm font-semibold text-slate-800">Personal details</div>
      <StaffDetailsFields value={form} onChange={setForm} adminFields={owner ? 'edit' : 'readonly'} idPrefix="me" withName />
      <div className="text-xs text-slate-400">Your name and job title are shown to your team. Phone, address and emergency contact only to the Business Admin{p.role === 'agent' ? ' and managers' : ''}. Your sign-in email ({p.email}) and role are set by the Business Admin.</div>
      {err && <div className="p-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{err}</div>}
      <button type="submit" disabled={busy || !dirty} className={btnPrimary}><Save className="w-3.5 h-3.5" /> {busy ? 'Saving…' : 'Save details'}</button>
    </form>
  );
}

function RankCard({ s, teamSize, points, days }: { s: StaffStats; teamSize: number; points: StaffPoints; days: number }) {
  return (
    <div className="bg-gradient-to-r from-teal-600 to-emerald-600 text-white rounded-xl p-4 flex flex-wrap items-center gap-4">
      <div className="w-12 h-12 rounded-full bg-white/15 flex items-center justify-center text-2xl">{s.rank <= 3 ? MEDAL[s.rank - 1] : <Trophy className="w-6 h-6" />}</div>
      <div className="flex-1 min-w-[200px]">
        <div className="text-lg font-bold">#{s.rank} of {teamSize} in your team</div>
        <div className="text-xs text-teal-50">{s.points} points in the last {days} days</div>
      </div>
      <div className="text-xs text-teal-50 max-w-sm">{pointsHelp(points)}</div>
    </div>
  );
}
