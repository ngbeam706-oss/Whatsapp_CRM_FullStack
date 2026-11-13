// Home: "My work" (docs/progress/ui-enhancement.md U2). What needs the signed-in person now, oldest or most
// urgent first; every row opens the chat or the query. Data: GET /api/home (server/home.cjs).
import { useState, type ReactNode } from 'react';
import { Home, MessageSquare, Inbox as InboxIcon, ClipboardList, HelpCircle, Send, AlertTriangle, CheckCircle2, ChevronRight, Users, Clock, Megaphone, ListChecks, Building2, Smartphone } from 'lucide-react';
import { UsageCard, type Usage } from './SetupScreen';
import { useApi, errorOf, refreshApi } from './queryClient';
import { api, errorMessage } from './broadcastUtils';
import { REFRESH } from './usePolling';
import { PageHeader, SkeletonRows, BUTTON } from './ui';
import { avatarBg, displayName, initials, shortTime } from './crmUtils';
import { QUERY_STAGE_INFO, PRIORITY_INFO, dueText } from './queryUtils';
import type { Contact, Me, ShowToast } from './types';

interface HomeQuery {
  id: string; ref: string; subject: string; priority: string; stage: string; due_at?: string | null;
  paused_at?: string | null; overdue?: boolean; contact_phone?: string | null; category?: string | null;
}
export interface HomeData {
  myChats: Contact[]; newChats: Contact[]; myQueries: HomeQuery[]; newQueries: HomeQuery[]; waitingOnMe: HomeQuery[];
  today: { repliesSent: number; myOpenChats: number; overdueQueries: number };
}

interface Props {
  me: Me; onOpenChat: (phone: string) => void; onOpenQuery: (id: string) => void;
  /** Managers: open the Inbox showing one person's chats. */
  onOpenPersonChats?: (email: string) => void;
  showToast?: ShowToast;
  /** Open a screen by its view name (setup steps). */
  onGo?: (view: string) => void;
}

/** GET /api/business/checklist (server/business.cjs; managers and the Business Admin). */
interface Checklist { steps: Array<{ id: string; label: string; done: boolean | null; view: string; who: 'owner' | 'manager' }>; doneCount: number; total: number }
interface WaStatus { connected: boolean; phoneNumber?: string; source?: string }

/** GET /api/home/team (server/home.cjs teamToday; managers and the Business Admin). */
interface TeamToday {
  unassignedWaiting: number; waitingTotal: number; broadcastsSending: number;
  longestWaiting: Contact[]; overdueQueries: HomeQuery[];
  people: Array<{ email: string; role: string; openChats: number; waitingChats: number; oldestWaitingSince: string | null; repliesToday: number; openQueries: number }>;
}

const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
const firstName = (email: string) => {
  const s = String(email || '').split('@')[0].split(/[._-]/)[0];
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
};

export default function HomeScreen({ me, onOpenChat, onOpenQuery, onOpenPersonChats, showToast, onGo }: Props) {
  const isManager = me.role === 'owner' || me.role === 'manager';
  const isOwner = me.role === 'owner';
  const q = useApi<HomeData>('/api/home', { refetchInterval: REFRESH.home });
  const d = q.data;
  const error = errorOf(q);
  const nothing = d && !d.myChats.length && !d.newChats.length && !d.myQueries.length && !d.newQueries.length && !d.waitingOnMe.length;

  return (
    <div className="flex-1 overflow-y-auto bg-slate-100" data-testid="home">
      <div className="max-w-5xl mx-auto px-4 py-5 space-y-4">
        <PageHeader icon={Home} title={`${greeting()}${firstName(me.email) ? `, ${firstName(me.email)}` : ''}`}
          help={isManager ? 'How the team is keeping up today, then your own work.' : 'Your work for today: customers waiting for you first, then new chats and queries to pick up.'} />

        {isManager && <SetupGuide role={me.role} onGo={onGo} />}
        {isManager && <TeamTodayPanel onOpenChat={onOpenChat} onOpenQuery={onOpenQuery} onOpenPersonChats={onOpenPersonChats} showToast={showToast} />}
        {isOwner && <BusinessCard onGo={onGo} />}

        {isManager && <h2 className="text-lg font-bold text-slate-800 pt-2">My work</h2>}
        {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
        {!d && !error && <SkeletonRows rows={4} label="Loading your work" />}

        {d && (
          <>
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              <Tile icon={Send} label="Replies sent today" value={d.today.repliesSent} />
              <Tile icon={MessageSquare} label="Chats assigned to you" value={d.today.myOpenChats} />
              <Tile icon={AlertTriangle} label="Your overdue queries" value={d.today.overdueQueries} warn={d.today.overdueQueries > 0} />
            </div>

            {nothing && (
              <div className="bg-white border border-emerald-200 rounded-xl p-6 text-center" data-testid="all-caught-up">
                <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" aria-hidden="true" />
                <div className="text-base font-semibold text-slate-800 mt-2">All caught up</div>
                <p className="text-sm text-slate-500">Nobody is waiting for you right now. New chats and queries will show up here.</p>
              </div>
            )}

            <div className="grid lg:grid-cols-2 gap-4">
              <Section title="Waiting for your reply" icon={MessageSquare} count={d.myChats.length} tone="urgent" testId="home-my-chats"
                empty="No customer is waiting for you.">
                {d.myChats.map(c => <ChatRow key={c.phone} c={c} onOpen={() => onOpenChat(c.phone)} />)}
              </Section>
              <Section title="New chats nobody has taken" icon={InboxIcon} count={d.newChats.length} testId="home-new-chats"
                empty="Every new chat has someone on it." hint="Open one and reply: it becomes yours.">
                {d.newChats.map(c => <ChatRow key={c.phone} c={c} onOpen={() => onOpenChat(c.phone)} />)}
              </Section>
              <Section title="Your queries" icon={ClipboardList} count={d.myQueries.length} tone={d.today.overdueQueries ? 'urgent' : undefined} testId="home-my-queries"
                empty="No open queries assigned to you.">
                {d.myQueries.map(x => <QueryRow key={x.id} q={x} onOpen={() => onOpenQuery(x.id)} />)}
              </Section>
              <Section title="New queries to pick up" icon={ClipboardList} count={d.newQueries.length} testId="home-new-queries"
                empty="No new customer queries.">
                {d.newQueries.map(x => <QueryRow key={x.id} q={x} onOpen={() => onOpenQuery(x.id)} />)}
              </Section>
              {d.waitingOnMe.length > 0 && (
                <Section title="Waiting for your answer" icon={HelpCircle} count={d.waitingOnMe.length} tone="urgent" testId="home-waiting-on-me"
                  empty="" hint="Questions you raised: the person handling them needs something from you.">
                  {d.waitingOnMe.map(x => <QueryRow key={x.id} q={x} onOpen={() => onOpenQuery(x.id)} />)}
                </Section>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Team today (managers and the Business Admin, U3)
// ---------------------------------------------------------------------------
function TeamTodayPanel({ onOpenChat, onOpenQuery, onOpenPersonChats, showToast }: Pick<Props, 'onOpenChat' | 'onOpenQuery' | 'onOpenPersonChats' | 'showToast'>) {
  const t = useApi<TeamToday>('/api/home/team', { refetchInterval: REFRESH.home });
  const d = t.data;
  const [busy, setBusy] = useState('');
  if (t.error) return <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{errorOf(t)}</div>;
  if (!d) return <SkeletonRows rows={2} label="Loading the team" />;

  // Hand a waiting chat to someone (same rules as the Inbox: managers may transfer any chat).
  const assign = async (phone: string, email: string) => {
    if (!email) return;
    setBusy(phone);
    try {
      await api(`/api/inbox/${phone}`, { method: 'PATCH', body: { assignedTo: email } });
      showToast?.(`Assigned to ${email}`);
      await Promise.all([refreshApi('/api/home'), refreshApi('/api/inbox')]);
    } catch (e) {
      showToast?.(errorMessage(e));
    } finally {
      setBusy('');
    }
  };
  const agents = d.people;

  return (
    <section className="space-y-3" data-testid="team-today">
      <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Users className="w-5 h-5 text-wa-teal" aria-hidden="true" /> Team today</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
        <Tile icon={MessageSquare} label="Chats waiting for a reply" value={d.waitingTotal} warn={d.waitingTotal > 0} />
        <Tile icon={InboxIcon} label="Waiting and nobody's yet" value={d.unassignedWaiting} warn={d.unassignedWaiting > 0} />
        <Tile icon={AlertTriangle} label="Overdue customer queries" value={d.overdueQueries.length} warn={d.overdueQueries.length > 0} />
        <Tile icon={Megaphone} label="Broadcasts sending now" value={d.broadcastsSending} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Section title="Waiting longest" icon={Clock} count={d.longestWaiting.length} tone="urgent" testId="team-longest" empty="No customer is waiting. 🎉"
          hint="Open a chat, or hand it to someone with Assign.">
          {d.longestWaiting.map(c => (
            <div key={c.phone} className="flex items-center gap-2 pr-3">
              <div className="flex-1 min-w-0"><ChatRow c={c} onOpen={() => onOpenChat(c.phone)} /></div>
              <select aria-label={`Assign ${displayName(c)}`} value="" disabled={busy === c.phone} onChange={e => assign(c.phone, e.target.value)}
                className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700 max-w-[9rem] cursor-pointer">
                <option value="">{c.assigned_to ? `${c.assigned_to.split('@')[0]} · move` : 'Assign…'}</option>
                {agents.filter(p => p.email !== String(c.assigned_to || '').toLowerCase()).map(p => <option key={p.email} value={p.email}>{p.email}</option>)}
              </select>
            </div>
          ))}
        </Section>
        <Section title="Overdue customer queries" icon={AlertTriangle} count={d.overdueQueries.length} tone="urgent" testId="team-overdue" empty="Nothing overdue.">
          {d.overdueQueries.map(x => <QueryRow key={x.id} q={x} onOpen={() => onOpenQuery(x.id)} />)}
        </Section>
      </div>

      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden" data-testid="team-people">
        <div className="px-4 py-3 border-b border-slate-100 text-base font-semibold text-slate-800">Who has what</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500 bg-slate-50">
              <tr>
                <th className="text-left font-semibold px-4 py-2">Person</th>
                <th className="text-right font-semibold px-3 py-2">Chats</th>
                <th className="text-right font-semibold px-3 py-2">Waiting</th>
                <th className="text-left font-semibold px-3 py-2">Oldest waiting</th>
                <th className="text-right font-semibold px-3 py-2">Replies today</th>
                <th className="text-right font-semibold px-3 py-2">Open queries</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {agents.map(p => (
                <tr key={p.email}>
                  <td className="px-4 py-2"><div className="text-slate-800 truncate max-w-[14rem]">{p.email}</div><div className="text-xs text-slate-400">{ROLE[p.role] || p.role}</div></td>
                  <td className="px-3 py-2 text-right">{p.openChats}</td>
                  <td className={`px-3 py-2 text-right ${p.waitingChats ? 'text-red-700 font-semibold' : ''}`}>{p.waitingChats}</td>
                  <td className="px-3 py-2 text-slate-500">{p.oldestWaitingSince ? `since ${shortTime(p.oldestWaitingSince)}` : '–'}</td>
                  <td className="px-3 py-2 text-right">{p.repliesToday}</td>
                  <td className="px-3 py-2 text-right">{p.openQueries}</td>
                  <td className="px-3 py-2 text-right">
                    {onOpenPersonChats && p.openChats > 0 && <button onClick={() => onOpenPersonChats(p.email)} className="text-xs font-semibold text-wa-teal hover:underline cursor-pointer whitespace-nowrap">View chats</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
const ROLE: Record<string, string> = { owner: 'Business Admin', manager: 'Manager', agent: 'Agent' };

// ---------------------------------------------------------------------------
// Business Admin (U4): a guided first-run setup, then how the business stands
// ---------------------------------------------------------------------------
const STEP_HELP: Record<string, string> = {
  whatsapp: 'Without it nothing can be sent or received. Start with the webhook (Step 1 on that page).',
  bot: 'What customers see when they first write: a welcome and a short menu.',
  team: 'Add the people who will answer chats. You set agents\' passwords yourself.',
  templates: 'Approved by Meta; needed for broadcasts and for messaging customers after 24 hours.',
  ai: 'Optional: lets the assistant answer simple questions from your own information.',
};

/** "Get set up": shown until every step is done, the next step highlighted. */
function SetupGuide({ role, onGo }: { role: string; onGo?: (view: string) => void }) {
  const q = useApi<Checklist>('/api/business/checklist', { staleTime: 60000 });
  const c = q.data;
  if (!c || c.doneCount >= c.total) return null;
  const next = c.steps.find(s => s.done === false && (s.who === 'manager' || role === 'owner'));
  return (
    <section className="bg-white border-2 border-wa-teal/40 rounded-xl overflow-hidden" data-testid="setup-guide">
      <div className="px-4 py-3 bg-teal-50/70 flex items-center gap-3">
        <ListChecks className="w-5 h-5 text-wa-teal" aria-hidden="true" />
        <div className="flex-1">
          <h2 className="text-base font-bold text-slate-800">Get your business ready</h2>
          <p className="text-xs text-slate-600">{c.doneCount} of {c.total} done. Each step opens the right page; it ticks itself when done.</p>
        </div>
      </div>
      <div className="h-1.5 bg-slate-100"><div className="h-1.5 bg-emerald-500" style={{ width: `${Math.round((c.doneCount / Math.max(c.total, 1)) * 100)}%` }} /></div>
      <ol className="divide-y divide-slate-100">
        {c.steps.map((s, i) => {
          const mine = s.who === 'manager' || role === 'owner';
          const isNext = next?.id === s.id;
          return (
            <li key={s.id} className={`flex items-start gap-3 px-4 py-3 ${isNext ? 'bg-amber-50/50' : ''}`}>
              {s.done ? <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" aria-label="Done" />
                : <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-2xs font-bold flex-shrink-0 mt-0.5 ${isNext ? 'border-amber-500 text-amber-700' : 'border-slate-300 text-slate-400'}`}>{i + 1}</span>}
              <div className="flex-1 min-w-0">
                <div className={`text-sm ${s.done ? 'text-slate-400 line-through' : 'text-slate-800 font-medium'}`}>{s.label}</div>
                {!s.done && <div className="text-xs text-slate-500">{STEP_HELP[s.id] || ''}{!mine ? ' (The Business Admin does this.)' : ''}</div>}
              </div>
              {!s.done && mine && onGo && (
                <button onClick={() => onGo(s.view)} className={isNext ? BUTTON.primary : BUTTON.secondary}>{isNext ? 'Start' : 'Open'}</button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** The Business Admin's view of the business: WhatsApp connection, plan, usage and payment. */
function BusinessCard({ onGo }: { onGo?: (view: string) => void }) {
  const usage = useApi<Usage>('/api/business/usage').data;
  const wa = useApi<WaStatus>('/api/whatsapp', { staleTime: 5 * 60000 }).data;
  if (!usage && !wa) return null;
  return (
    <section className="space-y-3" data-testid="business-card">
      <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2 pt-2"><Building2 className="w-5 h-5 text-wa-teal" aria-hidden="true" /> Your business</h2>
      {wa && (
        <div className={`rounded-xl border p-3 flex items-center gap-3 ${wa.connected ? 'bg-white border-slate-200' : 'bg-amber-50 border-amber-200'}`}>
          <Smartphone className={`w-5 h-5 ${wa.connected ? 'text-emerald-600' : 'text-amber-600'}`} aria-hidden="true" />
          <div className="flex-1 text-sm text-slate-800">
            {wa.connected ? <>WhatsApp connected{wa.phoneNumber ? <>: <strong>+{wa.phoneNumber}</strong></> : ''}</> : 'WhatsApp is not connected yet: nothing can be sent or received.'}
          </div>
          {onGo && <button onClick={() => onGo('whatsapp')} className={BUTTON.secondary}>{wa.connected ? 'Manage' : 'Connect'}</button>}
        </div>
      )}
      {usage && <UsageCard usage={usage} />}
    </section>
  );
}

function Tile({ icon: Icon, label, value, warn }: { icon: typeof Send; label: string; value: number; warn?: boolean }) {
  return (
    <div className={`bg-white border rounded-xl p-3 ${warn ? 'border-red-200' : 'border-slate-200'}`}>
      <Icon className={`w-4 h-4 ${warn ? 'text-red-600' : 'text-wa-teal'}`} aria-hidden="true" />
      <div className={`text-2xl font-bold mt-1 ${warn ? 'text-red-700' : 'text-slate-800'}`}>{value}</div>
      <div className="text-xs text-slate-500 leading-tight">{label}</div>
    </div>
  );
}

function Section({ title, icon: Icon, count, tone, empty, hint, testId, children }: {
  title: string; icon: typeof Send; count: number; tone?: 'urgent'; empty: string; hint?: string; testId: string; children: ReactNode;
}) {
  return (
    <section className="bg-white border border-slate-200 rounded-xl overflow-hidden" data-testid={testId}>
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
        <Icon className="w-4 h-4 text-wa-teal" aria-hidden="true" />
        <h2 className="text-base font-semibold text-slate-800 flex-1">{title}</h2>
        {count > 0 && <span className={`text-xs font-bold rounded-full px-2 py-0.5 ${tone === 'urgent' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>{count}</span>}
      </div>
      {hint && count > 0 && <div className="px-4 pt-2 text-xs text-slate-500">{hint}</div>}
      {count === 0 ? <div className="px-4 py-5 text-sm text-slate-400">{empty}</div> : <div className="divide-y divide-slate-100">{children}</div>}
    </section>
  );
}

function ChatRow({ c, onOpen }: { c: Contact; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-slate-50 cursor-pointer" data-testid="home-chat-row">
      <div className={`w-10 h-10 rounded-full ${avatarBg(c.phone)} text-white flex items-center justify-center font-bold text-sm flex-shrink-0`}>{initials(c)}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-800 truncate">{displayName(c)}</span>
          <span className="ml-auto text-xs text-slate-400 whitespace-nowrap">waiting since {shortTime(c.last_inbound_at || c.last_contacted_at)}</span>
        </div>
        <div className="flex items-center gap-2">
          <p className="text-sm text-slate-500 truncate flex-1">{c.last_message || ' '}</p>
          {(c.unread_count ?? 0) > 0 && <span className="min-w-[1.25rem] text-center rounded-full bg-wa-green text-white text-2xs font-bold px-1">{c.unread_count}</span>}
        </div>
      </div>
      <ChevronRight className="w-4 h-4 text-slate-300 flex-shrink-0" aria-hidden="true" />
    </button>
  );
}

function QueryRow({ q, onOpen }: { q: HomeQuery; onOpen: () => void }) {
  const stage = QUERY_STAGE_INFO[q.stage as keyof typeof QUERY_STAGE_INFO];
  const due = dueText(q as Parameters<typeof dueText>[0]);
  return (
    <button onClick={onOpen} className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-slate-50 cursor-pointer" data-testid="home-query-row">
      <span className="text-xs font-bold text-slate-500 w-14 flex-shrink-0">{q.ref}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-slate-800 truncate">{q.subject}</div>
        <div className="flex items-center gap-2 mt-0.5">
          {stage && <span className={`text-2xs px-1.5 py-px rounded border font-semibold ${stage.cls}`}>{stage.label}</span>}
          <span className={`text-xs ${PRIORITY_INFO[q.priority as keyof typeof PRIORITY_INFO]?.cls || 'text-slate-500'}`}>{PRIORITY_INFO[q.priority as keyof typeof PRIORITY_INFO]?.label}</span>
          {due && <span className={`text-xs ${q.overdue ? 'text-red-700 font-semibold' : 'text-slate-500'}`}>{due}</span>}
        </div>
      </div>
      <ChevronRight className="w-4 h-4 text-slate-300 flex-shrink-0" aria-hidden="true" />
    </button>
  );
}
