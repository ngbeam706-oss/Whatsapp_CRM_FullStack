import type { ReactNode } from 'react';
import { MessagesSquare, Reply, Timer, TrendingUp, ClipboardCheck, PhoneCall, StickyNote, Inbox, CalendarCheck, Star } from 'lucide-react';
import { PERIODS, fmtAgo, fmtMinutes } from './staffFormat';
import type { StaffStats } from './types';

// Shared components for "My profile" and the Team page's performance views (helpers: staffFormat.ts).

export function PeriodPicker({ days, onChange }: { days: number; onChange: (d: number) => void }) {
  return (
    <div className="bg-white border border-slate-200 p-0.5 rounded-lg flex" role="group" aria-label="Period">
      {PERIODS.map(d => (
        <button key={d} onClick={() => onChange(d)} aria-pressed={days === d}
          className={`px-3 py-1 rounded-md text-xs font-semibold cursor-pointer ${days === d ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
          Last {d} days
        </button>
      ))}
    </div>
  );
}

function Tile({ icon, label, value, sub }: { icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 min-w-0">
      <div className="text-xs font-medium text-slate-500 flex items-center gap-1.5">{icon}{label}</div>
      <div className="text-xl font-bold text-slate-800 mt-0.5 tabular-nums truncate">{value}</div>
      {sub !== undefined && <div className="text-xs text-slate-500 truncate">{sub}</div>}
    </div>
  );
}

/** The activity tiles for one person. */
export function StatTiles({ s, compact = false }: { s: StaffStats; compact?: boolean }) {
  const ic = 'w-3.5 h-3.5';
  return (
    <div className={`grid grid-cols-2 sm:grid-cols-3 ${compact ? '' : 'lg:grid-cols-5'} gap-2.5`}>
      <Tile icon={<MessagesSquare className={`${ic} text-teal-600`} />} label="Chats handled" value={s.chatsHandled} sub={`${s.repliesSent} replies sent`} />
      <Tile icon={<Timer className={`${ic} text-sky-600`} />} label="Typical response" value={fmtMinutes(s.medianResponseMin)} sub="median, to a customer's message" />
      <Tile icon={<TrendingUp className={`${ic} text-emerald-600`} />} label="Conversions" value={s.conversions} sub="chats moved to Booked or later" />
      <Tile icon={<ClipboardCheck className={`${ic} text-violet-600`} />} label="Queries resolved" value={s.queriesResolved}
        sub={s.avgRating ? <span className="inline-flex items-center gap-0.5"><Star className="w-3 h-3 text-amber-500 fill-amber-400" /> {s.avgRating} average rating</span> : `${s.openQueries} open`} />
      <Tile icon={<PhoneCall className={`${ic} text-rose-600`} />} label="Calls answered" value={s.calls} sub={`${s.talkMin} min talk time`} />
      <Tile icon={<Inbox className={`${ic} text-slate-600`} />} label="Open chats now" value={s.openChats} sub="assigned, not Completed or Lost" />
      <Tile icon={<StickyNote className={`${ic} text-amber-600`} />} label="Notes written" value={s.notes} />
      <Tile icon={<CalendarCheck className={`${ic} text-teal-700`} />} label="Active days" value={s.activeDays} sub={`last active ${fmtAgo(s.lastActive)}`} />
      <Tile icon={<Reply className={`${ic} text-indigo-600`} />} label="Replies sent" value={s.repliesSent} />
    </div>
  );
}

/** Replies per day as small bars. */
export function DailyBars({ daily }: { daily: StaffStats['daily'] }) {
  const max = Math.max(1, ...daily.map(d => d.replies));
  const total = daily.reduce((n, d) => n + d.replies, 0);
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3">
      <div className="flex items-center justify-between text-xs mb-2">
        <span className="font-semibold text-slate-700">Replies per day</span>
        <span className="text-slate-500">{total} in {daily.length} days</span>
      </div>
      {total === 0 ? <div className="text-xs text-slate-400 py-6 text-center">No replies in this period yet.</div> : (
        <div className="flex items-end gap-[2px] h-24" role="img" aria-label={`Replies per day, ${total} in total`}>
          {daily.map(d => (
            <div key={d.day} className="flex-1 min-w-[2px] bg-teal-500/80 hover:bg-teal-600 rounded-t" style={{ height: `${Math.max(d.replies ? 6 : 1, (d.replies / max) * 100)}%`, opacity: d.replies ? 1 : 0.25 }}
              title={`${new Date(`${d.day}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}: ${d.replies} replies`} />
          ))}
        </div>
      )}
    </div>
  );
}
