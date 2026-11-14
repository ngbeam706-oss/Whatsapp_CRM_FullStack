import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useEscape } from './ui';
import type {
  BusinessNumber, ChatMessage, ContactNote, ContactPatch, Conversation as ConversationData, InboxContact, Me, ShowToast,
  StaffMember, TeamResponse, Template, VariableSpec,
} from './types';
import { useLeadStatuses, statusLook } from './leadStatuses';
import { MoreFilters } from './leadFilters';
import { NO_MORE_FILTERS, RANGE_LABEL, moreCount, moreFilterParams, useStoredState, type MoreFilterValues } from './leadFilterUtils';
import AddLeadModal from './AddLeadModal';
import ChatAppointmentButton from './ChatAppointmentButton';
import { ReturnedBadge, RenameButton } from './leadNames';
import { otherWaName, useRenameLead } from './leadNameUtils';
import { useBusinessNumbers, numberName, findNumber, defaultReplyNumber, windowFor } from './inboxNumbers';
import {
  Search, X, Send, Phone, Copy, CheckCheck, Check, Clock, AlertTriangle, Bot, UserRound, Plus, FileText,
  ArrowLeft, StickyNote, Tag, PanelRightOpen, PanelRightClose, Trash2, MessageSquare, Hand, Lock, Sparkles,
  UserPlus, SlidersHorizontal,
} from 'lucide-react';
import { api, templateNeeds, inputCls, btnPrimary, btnSecondary } from './broadcastUtils';
import CallRecordingPlayer from './CallRecordingPlayer';
import { TemplatePreview, VariableInput } from './BroadcastUi';
import { REFRESH } from './usePolling';
import { useApi, refreshApi, errorOf } from './queryClient';
import ContactQueries from './ContactQueries';
import {
  useSavedReplies, slashQuery, fillReply, SlashPicker, SavedReplyChips, SavedRepliesManager, AttachButton, MessageMedia, hasMedia, isMediaLabel,
  CloseChatButton, ClosedBanner, AlertBell, CLOSE_REASONS,
} from './inboxExtras';
import { useConfirm } from './confirm';
import {
  avatarBg, displayName, initials, emailInitials, shortTime, timeLeft, dayLabel,
  accessOf, assigneeChoices, canManage,
} from './crmUtils';

// Stable empty lists (a new [] each render would re-run effects).
const NO_CONTACTS: InboxContact[] = [];
const NO_STAFF: StaffMember[] = [];
const sameEmail = (a: string | null | undefined, b: string | null | undefined) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
/** Ad headline from the Click-to-WhatsApp referral, or its id when the ad had no headline. */
const adLabel = (headline: string | null | undefined, id: string | null | undefined) => (headline ? `“${headline}”` : id ? `ad ${id}` : '');
const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Save a change to the open contact; `okMsg` is shown when it worked. */
type OnUpdate = (patch: ContactPatch, okMsg?: string) => void;

/** "Assigned to" menu that only offers what the server will allow (see crmUtils.assigneeChoices). */
function AssigneeSelect({ contact, me, staff, onUpdate, className }: { contact: InboxContact; me: Me; staff: StaffMember[]; onUpdate: OnUpdate; className: string }) {
  const choices = assigneeChoices(contact, me, staff);
  const access = accessOf(contact, me);
  const canRelease = canManage(me.role) || access === 'mine';
  const current = contact.assigned_to || '';
  const listed = (choices || []).some(e => sameEmail(e, current));
  return (
    <select value={current} disabled={!choices}
      onChange={e => onUpdate({ assignedTo: e.target.value || null }, e.target.value ? (sameEmail(e.target.value, me.email) ? 'This chat is now yours' : `Transferred to ${e.target.value}`) : 'Released to Unassigned')}
      title={choices ? 'Assigned to' : `Only ${current} or an owner can transfer this chat`}
      className={`${className} disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed`}>
      {(canRelease || !current) && <option value="">Unassigned</option>}
      {current && !listed && <option value={current}>{current}</option>}
      {(choices || []).map(e => <option key={e} value={e}>{sameEmail(e, me.email) ? `Me (${e})` : e}</option>)}
    </select>
  );
}

const FILTERS = [
  ['all', 'All'],
  ['mine', 'Mine'],
  ['unassigned', 'Unassigned'],
  ['unread', 'Unread'],
  // Chats marked done (with a reason). Not the pipeline's "Closed" stage (a lost customer).
  ['closed', 'Done'],
] as const;
type Filter = typeof FILTERS[number][0];

/** What App needs to start an audio call with a contact. */
export interface CallTarget { number: string; name: string; sourceBadge?: string | null }

interface InboxProps {
  me: Me;
  onStartCall?: (target: CallTarget) => void;
  showToast: ShowToast;
  /** Open this chat (from the Pipeline or a query); cleared with onOpenPhoneHandled. */
  openPhone?: string | null;
  onOpenPhoneHandled?: () => void;
  /** Changes when the header's "New Chat" is clicked. */
  newChatSignal?: number;
  /** Managers: show one person's chats (from Home); cleared with onOpenAssigneeHandled. */
  openAssignee?: string | null;
  onOpenAssigneeHandled?: () => void;
}

export default function InboxScreen({ me, onStartCall, showToast, openPhone, onOpenPhoneHandled, newChatSignal, openAssignee, onOpenAssigneeHandled }: InboxProps) {
  const isManager = canManage(me.role);
  const [filter, setFilter] = useState<Filter>('all');
  // Managers (U3): chats of one person, and several chats at once (assign / mark done).
  const [assignee, setAssignee] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const confirm = useConfirm();
  useEffect(() => {
    if (!openAssignee) return undefined;
    const t = setTimeout(() => { setAssignee(openAssignee); setFilter('all'); onOpenAssigneeHandled?.(); }, 0);
    return () => clearTimeout(t);
  }, [openAssignee, onOpenAssigneeHandled]);
  const [stage, setStage] = useState<string>('');
  const leadStatuses = useLeadStatuses(); // the business's own statuses (shared cache)
  // Date range (default: active in the last 2 days) and more filters, remembered per person in this browser.
  const [more, setMore] = useStoredState<MoreFilterValues>(`inbox-filters:${me.email}`, { ...NO_MORE_FILTERS, range: '2d' });
  const [showMore, setShowMore] = useState(false);
  const [showAddLead, setShowAddLead] = useState(false);
  const [q, setQ] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [activePhone, setActivePhone] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(true);
  const [showNewChat, setShowNewChat] = useState(false);
  // Several WhatsApp numbers: badges, a number filter and "Reply from" appear only when there are 2+.
  const numbers = useBusinessNumbers();
  const multi = numbers.length > 1;
  const [numberFilter, setNumberFilter] = useState('');
  const activeNumberFilter = multi && numbers.some(n => n.id === numberFilter) ? numberFilter : '';

  // ---- data loading (shared cache; refreshes only while the tab is visible) ----------
  useEffect(() => {
    const t = setTimeout(() => setSearchQ(q), 250); // wait until typing pauses
    return () => clearTimeout(t);
  }, [q]);
  const byPerson = isManager && filter !== 'mine' && filter !== 'unassigned' ? assignee : '';
  // A search looks through every date (the range would hide an older chat someone is looking for).
  const moreParams = moreFilterParams(searchQ ? { ...more, range: 'all' } : more);
  const listPath = `/api/inbox?${new URLSearchParams({ filter, stage, q: searchQ, ...(activeNumberFilter ? { number: activeNumberFilter } : {}), ...(byPerson ? { assignee: byPerson } : {}), ...moreParams })}`;
  const listQuery = useApi<{ conversations?: InboxContact[] }>(listPath, { refetchInterval: REFRESH.inboxList, keepPrevious: true });
  const list = listQuery.data?.conversations || NO_CONTACTS;
  const listError = errorOf(listQuery);

  const convoQuery = useApi<ConversationData>(activePhone ? `/api/inbox/${activePhone}` : null, { refetchInterval: REFRESH.openChat, staleTime: 0 });
  const convo = convoQuery.data || null;
  const staff = useApi<TeamResponse>('/api/team').data?.staff || NO_STAFF;

  const loadList = () => refreshApi('/api/inbox?');
  const loadConvo = (phone: string) => refreshApi(`/api/inbox/${phone}`);

  useEffect(() => {
    if (!activePhone) return;
    api(`/api/inbox/${activePhone}/read`, { method: 'POST' }).then(() => refreshApi('/api/inbox?')).catch(() => {});
  }, [activePhone]);

  // Opened from the Pipeline or the header's "New Chat".
  useEffect(() => {
    if (!openPhone) return;
    const t = setTimeout(() => { setActivePhone(openPhone); onOpenPhoneHandled?.(); }, 0);
    return () => clearTimeout(t);
  }, [openPhone, onOpenPhoneHandled]);
  useEffect(() => {
    if (!newChatSignal) return;
    const t = setTimeout(() => setShowNewChat(true), 0);
    return () => clearTimeout(t);
  }, [newChatSignal]);

  const openChat = (phone: string) => setActivePhone(phone);

  // Keyboard (U2): J / K next / previous chat, R reply, / search, Esc back to the list.
  // Never while typing in a field or while a dialog is open.
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      // Not while typing, and not for a key meant for a pop-up: Esc that closes "Send template" must not
      // also close the chat (the pop-up may already be gone, so its own element is checked too).
      if (t?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"], [role="menu"], .fixed')) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return;
      const at = list.findIndex(c => c.phone === activePhone);
      if (e.key === 'j' || e.key === 'k') {
        if (!list.length) return;
        const next = at < 0 ? 0 : Math.min(Math.max(at + (e.key === 'j' ? 1 : -1), 0), list.length - 1);
        e.preventDefault();
        setActivePhone(list[next].phone);
        document.querySelector(`[data-testid="chat-row"][data-phone="${list[next].phone}"]`)?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'r') {
        const box = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Reply"]');
        if (box) { e.preventDefault(); box.focus(); }
      } else if (e.key === 'Escape' && activePhone) {
        setActivePhone(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [list, activePhone]);

  const contact = convo?.contact?.phone === activePhone ? convo.contact : null;

  const updateContact: OnUpdate = async (patch, okMsg) => {
    if (!activePhone) return;
    try {
      await api(`/api/inbox/${activePhone}`, { method: 'PATCH', body: patch });
      if (okMsg) showToast(okMsg);
      loadConvo(activePhone);
      loadList();
    } catch (e) {
      showToast(message(e));
    }
  };

  // ---- several chats at once (managers): each chat goes through the normal rules on the server ----
  const togglePick = (phone: string) => setPicked(p => (p.includes(phone) ? p.filter(x => x !== phone) : [...p, phone]));
  const stopSelecting = () => { setSelecting(false); setPicked([]); };
  const runBulk = async (done: string, one: (phone: string) => Promise<unknown>) => {
    setBulkBusy(true);
    const failed: string[] = [];
    for (const phone of picked) {
      try { await one(phone); } catch (e) { failed.push(message(e)); }
    }
    setBulkBusy(false);
    const ok = picked.length - failed.length;
    showToast(failed.length ? `${ok} ${done}; ${failed.length} not changed (${failed[0]})` : `${ok} ${ok === 1 ? 'chat' : 'chats'} ${done}`);
    stopSelecting();
    loadList();
    refreshApi('/api/home');
  };
  const bulkAssign = (email: string) => runBulk(email ? `assigned to ${email}` : 'unassigned',
    phone => api(`/api/inbox/${phone}`, { method: 'PATCH', body: { assignedTo: email || null } }));
  const bulkDone = async (reason: string) => {
    if (!reason) return;
    const label = CLOSE_REASONS.find(([k]) => k === reason)?.[1] || reason;
    if (!(await confirm({ title: `Mark ${picked.length} ${picked.length === 1 ? 'chat' : 'chats'} done?`, body: `Reason: ${label}. They move to "Done" and open again by themselves when the customer writes.`, confirmLabel: 'Mark done' }))) return;
    runBulk('marked done', phone => api(`/api/inbox/${phone}/close`, { method: 'POST', body: { reason, note: '' } }));
  };

  return (
    <div className="flex-1 flex overflow-hidden max-w-[1800px] w-full mx-auto border-x border-slate-300 bg-white">
      {/* ---------------- Conversation list ---------------- */}
      <aside className={`w-full md:w-[340px] lg:w-[360px] border-r border-wa-border flex flex-col flex-shrink-0 ${activePhone ? 'hidden md:flex' : 'flex'}`}>
        <div className="p-2.5 border-b border-wa-border space-y-2 bg-slate-50">
          <div className="flex gap-2">
            <div className="relative flex-1 flex items-center bg-white border border-slate-200 rounded-lg px-2.5">
              <Search className="w-3.5 h-3.5 text-slate-400 mr-2" />
              <input ref={searchRef} value={q} onChange={e => setQ(e.target.value)} placeholder="Search name or number" aria-label="Search chats"
                className="w-full py-1.5 text-xs bg-transparent focus:outline-none" />
              {q && <button onClick={() => setQ('')} className="text-slate-400 cursor-pointer"><X className="w-3.5 h-3.5" /></button>}
            </div>
            <AlertBell />
            <button onClick={() => setShowAddLead(true)} className={btnSecondary} title="Add a lead (a phone call, a walk-in…)" aria-label="Add lead"><UserPlus className="w-3.5 h-3.5" /></button>
            <button onClick={() => setShowNewChat(true)} className={btnPrimary} title="Message a new number"><Plus className="w-3.5 h-3.5" /></button>
          </div>
          {/* Which dates: the last 2 days by default (remembered per person). */}
          <div className="flex items-center gap-1.5 text-xs text-slate-600" data-testid="inbox-range">
            {searchQ ? <span>Searching all dates</span> : more.range === 'all' ? <span>Showing all chats</span> : <span>Showing {RANGE_LABEL[more.range].replace(/^Last/, 'the last').replace(/^Dates…$/, 'the chosen dates').replace(/^Today$/, 'today')}</span>}
            {!searchQ && more.range !== 'all' && <>· <button onClick={() => setMore(m => ({ ...m, range: 'all' }))} className="font-semibold text-wa-teal hover:underline cursor-pointer">Show all</button></>}
            <button onClick={() => setShowMore(s => !s)} aria-expanded={showMore} className="ml-auto font-semibold text-slate-600 hover:text-slate-900 cursor-pointer flex items-center gap-1">
              <SlidersHorizontal className="w-3.5 h-3.5" /> Filters{moreCount(more) ? ` (${moreCount(more)})` : ''}
            </button>
          </div>
          {showMore && <MoreFilters value={more} onChange={setMore} compact />}
          <div className="flex items-center gap-1 flex-wrap">
            {FILTERS.map(([id, label]) => (
              <button key={id} onClick={() => setFilter(id)}
                className={`px-2.5 py-0.5 rounded-full text-xs font-semibold cursor-pointer ${filter === id ? 'bg-slate-800 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'}`}>
                {label}
              </button>
            ))}
            <select value={stage} onChange={e => setStage(e.target.value)} aria-label="Status"
              className="ml-auto text-xs border border-slate-200 rounded-full px-2 py-0.5 bg-white text-slate-600 cursor-pointer">
              <option value="">All stages</option>
              {leadStatuses.active.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          {isManager && (
            <div className="flex items-center gap-2">
              <select value={assignee} onChange={e => setAssignee(e.target.value)} aria-label="Chats of" data-testid="assignee-filter"
                disabled={filter === 'mine' || filter === 'unassigned'}
                className="flex-1 min-w-0 text-xs border border-slate-200 rounded-full px-2 py-0.5 bg-white text-slate-600 cursor-pointer disabled:opacity-50">
                <option value="">Everyone's chats</option>
                {staff.map(s => <option key={s.email} value={String(s.email).toLowerCase()}>{sameEmail(s.email, me.email) ? `Me (${s.email})` : s.email}</option>)}
              </select>
              <button onClick={() => (selecting ? stopSelecting() : setSelecting(true))} aria-pressed={selecting} data-testid="select-chats"
                className={`text-xs font-semibold rounded-full px-2.5 py-0.5 border cursor-pointer ${selecting ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'}`}>
                {selecting ? 'Cancel' : 'Select'}
              </button>
            </div>
          )}
          {multi && (
            <select value={activeNumberFilter} onChange={e => setNumberFilter(e.target.value)} data-testid="number-filter"
              title="Show chats by the business number the customer last wrote to"
              className="w-full text-xs border border-slate-200 rounded-full px-2 py-0.5 bg-white text-slate-600 cursor-pointer">
              <option value="">All numbers</option>
              {numbers.map(n => <option key={n.id} value={n.id}>Last wrote to: {numberName(n)}</option>)}
            </select>
          )}
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {listError && <div className="m-3 p-2.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">{listError}</div>}
          {!listError && list.length === 0 && (
            <div className="p-8 text-center text-xs text-slate-400">
              <MessageSquare className="w-6 h-6 mx-auto mb-2 text-slate-300" />
              {filter === 'mine' ? 'No chats assigned to you.' : filter === 'unread' ? 'All caught up! 🎉' : filter === 'closed' ? 'No chats marked done.' : 'No conversations here.'}
            </div>
          )}
          {list.map(c => (
            <button key={c.phone} onClick={() => (selecting ? togglePick(c.phone) : openChat(c.phone))} data-testid="chat-row" data-phone={c.phone}
              aria-pressed={selecting ? picked.includes(c.phone) : undefined}
              className={`w-full text-left flex items-start gap-2.5 px-3 py-2.5 cursor-pointer ${selecting && picked.includes(c.phone) ? 'bg-teal-50' : activePhone === c.phone ? 'bg-wa-activeChat' : 'hover:bg-wa-hoverChat'}`}>
              {selecting && (
                <span className={`mt-2.5 w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${picked.includes(c.phone) ? 'bg-wa-teal border-wa-teal text-white' : 'border-slate-300 bg-white'}`} aria-hidden="true">
                  {picked.includes(c.phone) && <Check className="w-3.5 h-3.5" />}
                </span>
              )}
              <div className={`w-10 h-10 rounded-full ${avatarBg(c.phone)} text-white flex items-center justify-center font-bold text-xs flex-shrink-0`}>{initials(c)}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className={`text-xs truncate ${(c.unread_count ?? 0) > 0 ? 'font-bold text-slate-900' : 'font-semibold text-slate-800'}`}>{displayName(c)}</span>
                  {c.botPaused && <span title="Staff handling: bot paused" className="flex-shrink-0"><Hand className="w-3 h-3 text-amber-600" /></span>}
                  <span className="ml-auto text-xs text-slate-400 whitespace-nowrap">{shortTime(c.last_contacted_at)}</span>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <p className="text-xs text-slate-500 truncate flex-1">{c.last_message || ' '}</p>
                  {(c.unread_count ?? 0) > 0 && (
                    <span className="min-w-[16px] h-4 px-1 rounded-full bg-wa-green text-white text-2xs font-bold flex items-center justify-center">{c.unread_count}</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className={`text-2xs px-1.5 py-px rounded border font-semibold ${statusLook(leadStatuses.all, c.stage).cls}`}>{statusLook(leadStatuses.all, c.stage).label}</span>
                  <ReturnedBadge contact={c} />
                  {c.opted_out && <span className="text-2xs px-1.5 py-px rounded border border-rose-200 bg-rose-50 text-rose-700 font-semibold">STOP</span>}
                  {multi && <NumberBadge n={findNumber(numbers, c.last_phone_number_id)} title="The number they last wrote to" />}
                  {c.assigned_to ? (
                    <span className="ml-auto flex items-center gap-1">
                      {accessOf(c, me) === 'other' && <span title="Someone else's chat: view only"><Lock className="w-3 h-3 text-slate-400" /></span>}
                      <span className={`w-5 h-5 rounded-full text-white text-2xs font-bold flex items-center justify-center ${accessOf(c, me) === 'mine' ? 'bg-wa-teal' : 'bg-slate-700'}`} title={`Assigned to ${c.assigned_to}`}>
                        {emailInitials(c.assigned_to)}
                      </span>
                    </span>
                  ) : <span className="ml-auto text-2xs text-slate-400">Unassigned</span>}
                </div>
              </div>
            </button>
          ))}
        </div>
        {selecting && (
          <div className="px-3 py-2 border-t border-wa-border bg-teal-50 space-y-2" data-testid="bulk-bar">
            <div className="flex items-center gap-2 text-xs">
              <strong className="text-slate-800">{picked.length} selected</strong>
              <button onClick={() => setPicked(picked.length === list.length ? [] : list.map(c => c.phone))} className="text-wa-teal font-semibold cursor-pointer">
                {picked.length === list.length ? 'Clear' : 'Select all'}
              </button>
              {bulkBusy && <span className="text-slate-500">Working…</span>}
            </div>
            <div className="flex gap-2">
              <select value="" disabled={!picked.length || bulkBusy} onChange={e => e.target.value && bulkAssign(e.target.value === '-' ? '' : e.target.value)} aria-label="Assign selected chats"
                className="flex-1 min-w-0 text-xs border border-slate-300 rounded-lg px-2 py-1.5 bg-white cursor-pointer disabled:opacity-50">
                <option value="">Assign to…</option>
                {staff.map(s => <option key={s.email} value={String(s.email).toLowerCase()}>{s.email}</option>)}
                <option value="-">Nobody (unassign)</option>
              </select>
              <select value="" disabled={!picked.length || bulkBusy} onChange={e => bulkDone(e.target.value)} aria-label="Mark selected chats done"
                className="flex-1 min-w-0 text-xs border border-slate-300 rounded-lg px-2 py-1.5 bg-white cursor-pointer disabled:opacity-50">
                <option value="">Mark done…</option>
                {CLOSE_REASONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </div>
          </div>
        )}
        <div className="px-3 py-2 border-t border-wa-border bg-slate-50 text-xs text-slate-500">
          {list.length} conversation{list.length === 1 ? '' : 's'} · updates every few seconds
          <span className="hidden lg:inline" title="Keyboard shortcuts"> · <kbd className="font-sans">J</kbd>/<kbd className="font-sans">K</kbd> next/previous · <kbd className="font-sans">R</kbd> reply · <kbd className="font-sans">/</kbd> search</span>
        </div>
      </aside>

      {/* ---------------- Conversation ---------------- */}
      <main className={`flex-1 flex flex-col min-w-0 bg-wa-chatBg ${activePhone ? 'flex' : 'hidden md:flex'}`}>
        {!activePhone ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <div className="w-16 h-16 rounded-full bg-white shadow flex items-center justify-center mb-3"><MessageSquare className="w-8 h-8 text-wa-teal" /></div>
            <h2 className="text-base font-semibold text-slate-800">Team inbox</h2>
            <p className="text-xs text-slate-500 max-w-sm mt-1">Pick a conversation. Replies come from your business number, and the bot steps aside while your team is chatting.</p>
          </div>
        ) : !contact || !convo ? (
          <div className="flex-1 flex items-center justify-center text-xs text-slate-500">Loading…</div>
        ) : (
          <Conversation
            key={contact.phone}
            convo={convo}
            me={me}
            staff={staff}
            numbers={numbers}
            showDetails={showDetails}
            onToggleDetails={() => setShowDetails(v => !v)}
            onBack={() => setActivePhone(null)}
            onStartCall={() => onStartCall?.({ number: contact.phone, name: displayName(contact), sourceBadge: contact.source })}
            onSent={() => { loadConvo(contact.phone); loadList(); }}
            onUpdate={updateContact}
            showToast={showToast}
          />
        )}
      </main>

      {/* ---------------- Details ---------------- */}
      {contact && convo && showDetails && (
        <DetailsPanel
          contact={contact}
          notes={convo.notes}
          me={me}
          staff={staff}
          onUpdate={updateContact}
          onNotesChanged={() => loadConvo(contact.phone)}
          showToast={showToast}
        />
      )}

      {showNewChat && (
        <NewChatModal
          onClose={() => setShowNewChat(false)}
          onStarted={(phone: string) => { setShowNewChat(false); loadList(); openChat(phone); }}
        />
      )}
      {showAddLead && (
        <AddLeadModal me={me} showToast={showToast} onClose={() => setShowAddLead(false)}
          onAdded={(phone: string) => { setShowAddLead(false); loadList(); openChat(phone); }} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conversation pane
// ---------------------------------------------------------------------------

interface ConversationProps {
  convo: ConversationData;
  me: Me;
  staff: StaffMember[];
  numbers: BusinessNumber[];
  showDetails: boolean;
  onToggleDetails: () => void;
  onBack: () => void;
  onStartCall: () => void;
  onSent: () => void;
  onUpdate: OnUpdate;
  showToast: ShowToast;
}

/** A row in the message list: a message, or a day divider. */
type Row = ChatMessage | { divider: string; key: string };

/** Small "📱 Pharmacy" chip for a business number. */
function NumberBadge({ n, title }: { n: BusinessNumber | null; title?: string }) {
  if (!n) return null;
  return (
    <span title={title} data-testid="number-badge"
      className="text-2xs px-1.5 py-px rounded border border-sky-200 bg-sky-50 text-sky-800 font-semibold whitespace-nowrap truncate max-w-[110px]">
      📱 {numberName(n)}
    </span>
  );
}

function Conversation({ convo, me, staff, numbers, showDetails, onToggleDetails, onBack, onStartCall, onSent, onUpdate, showToast }: ConversationProps) {
  const c = convo.contact;
  const access = accessOf(c, me);
  const canAct = access !== 'other';
  const rename = useRenameLead(showToast);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);
  // "Reply from": null = the number the customer last wrote to (follows them if they write to another one).
  const multi = numbers.length > 1;
  const [replyFrom, setReplyFrom] = useState<string | null>(null);
  const lastNumber = defaultReplyNumber(numbers, c);
  const fromId = multi ? (replyFrom && numbers.some(n => n.id === replyFrom) ? replyFrom : null) : null;
  const fromNumber = fromId ? findNumber(numbers, fromId) : lastNumber;
  const win = multi ? windowFor(c, numbers, fromId) : { open: !!c.windowOpen, closesAt: c.windowClosesAt || null, everWrote: !!c.last_inbound_at };
  const endRef = useRef<HTMLDivElement>(null);
  const count = convo.messages.length;

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [count]);

  // Saved replies: chips, and "/shortcut" in the reply box.
  const saved = useSavedReplies();
  const [managing, setManaging] = useState(false);
  const firstName = c.name && !c.name.startsWith('+') ? c.name : '';
  const slash = slashQuery(text);
  const slashFirst = slash === null ? null : saved.replies.find(r => r.shortcut.startsWith(slash) || r.title.toLowerCase().includes(slash)) || null;

  const [suggesting, setSuggesting] = useState(false);
  const suggest = async () => {
    setSuggesting(true);
    try {
      const d = await api<{ draft: string }>(`/api/inbox/${c.phone}/suggest`, { method: 'POST' });
      setText(d.draft);
      showToast('Draft ready. Check and edit it before sending.');
    } catch (err) {
      showToast(message(err));
    } finally {
      setSuggesting(false);
    }
  };

  // Called by the form (with its submit event) and by Enter in the box (without one).
  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await api(`/api/inbox/${c.phone}/messages`, { method: 'POST', body: { text: body, ...(fromId ? { fromNumberId: fromId } : {}) } });
      setText('');
      onSent();
    } catch (err) {
      showToast(message(err));
    } finally {
      setSending(false);
    }
  };

  const left = timeLeft(win.closesAt);
  const replyFromPicker = multi && canAct && (
    <label className="flex items-center gap-1.5 text-xs text-slate-600" data-testid="reply-from">
      <span className="font-semibold">Reply from</span>
      <select value={fromId || ''} onChange={e => setReplyFrom(e.target.value || null)}
        className="border border-slate-200 rounded-full px-2 py-0.5 bg-white cursor-pointer max-w-[220px]">
        <option value="">{numberName(lastNumber)} (they last wrote here)</option>
        {numbers.filter(n => n.id !== lastNumber?.id).map(n => {
          const w = (c.windows || []).find(x => x.numberId === n.id);
          return <option key={n.id} value={n.id}>{numberName(n)}{w?.open ? '' : ' · template only'}</option>;
        })}
      </select>
    </label>
  );
  const grouped = useMemo(() => {
    const out: Row[] = [];
    let lastDay = '';
    for (const m of convo.messages) {
      const day = dayLabel(m.timestamp);
      if (day !== lastDay) { out.push({ divider: day, key: `d-${m.id}` }); lastDay = day; }
      out.push(m);
    }
    return out;
  }, [convo.messages]);

  return (
    <>
      <div className="bg-slate-50 px-3 py-2 border-b border-wa-border flex items-center gap-2.5" data-testid="chat-header">
        <button onClick={onBack} className="md:hidden p-1 text-slate-600 cursor-pointer"><ArrowLeft className="w-4 h-4" /></button>
        <div className={`w-9 h-9 rounded-full ${avatarBg(c.phone)} text-white flex items-center justify-center font-bold text-xs flex-shrink-0`}>{initials(c)}</div>
        <div className="min-w-[9rem] flex-1">
          <div className="text-sm font-bold text-slate-800 truncate flex items-center gap-1.5">
            <span className="truncate" data-testid="chat-name">{displayName(c)}</span>
            {canAct && <RenameButton onClick={() => rename(c)} label="Rename contact" />}
            <ReturnedBadge contact={c} />
          </div>
          <div className="text-xs text-slate-500 font-mono truncate">+{c.phone}{otherWaName(c) && <span className="font-sans" data-testid="wa-name"> · WhatsApp: {otherWaName(c)}</span>}{c.source ? <span className="font-sans"> · {c.source}</span> : null}
            {multi && lastNumber && <span className="font-sans" title="The business number they last wrote to"> · Wrote to {numberName(lastNumber)}</span>}
            {adLabel(c.last_ad_headline, c.last_ad_id) && <span className="font-sans" title="The ad they last came through"> · From ad: {adLabel(c.last_ad_headline, c.last_ad_id)}</span>}
          </div>
        </div>

        <AssigneeSelect contact={c} me={me} staff={staff} onUpdate={onUpdate}
          className="hidden sm:block text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white max-w-[170px] cursor-pointer" />

        {c.botPaused ? (
          <button onClick={() => onUpdate({ botPaused: false }, 'Bot is back on for this chat')} disabled={!canAct}
            className="text-xs font-semibold px-2 py-1 rounded-lg bg-amber-100 text-amber-900 border border-amber-200 flex items-center gap-1 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            title={c.bot_paused_until ? `Bot paused until ${new Date(c.bot_paused_until).toLocaleString()}` : 'Bot paused until you resume it'}>
            <Hand className="w-3.5 h-3.5" /> <span className="hidden sm:inline">You're chatting · Resume bot</span>
          </button>
        ) : (
          <button onClick={() => onUpdate({ botPaused: true, pauseHours: 12 }, 'Bot paused for 12 hours for this chat')} disabled={!canAct}
            className="text-xs font-semibold px-2 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 flex items-center gap-1 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
            title="The bot is answering this customer. Click to take over.">
            <Bot className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Bot on · Take over</span>
          </button>
        )}

        <CloseChatButton c={c} disabled={!canAct} onDone={onSent} showToast={showToast} />
        <ChatAppointmentButton phone={c.phone} name={c.name && !/^\+?\d+$/.test(c.name) ? c.name : ''} disabled={!canAct} showToast={showToast} />
        <button onClick={onStartCall} className="p-1.5 rounded-lg hover:bg-slate-200 text-emerald-700 cursor-pointer" title="Audio call"><Phone className="w-4 h-4" /></button>
        <button onClick={() => { navigator.clipboard?.writeText(`+${c.phone}`); showToast('Number copied'); }} className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-500 cursor-pointer" title="Copy number"><Copy className="w-4 h-4" /></button>
        <button onClick={onToggleDetails} className="hidden lg:block p-1.5 rounded-lg hover:bg-slate-200 text-slate-500 cursor-pointer" title={showDetails ? 'Hide details' : 'Show details'}>
          {showDetails ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
        </button>
      </div>

      <ClosedBanner c={c} canAct={canAct} onDone={onSent} showToast={showToast} />
      <div className="flex-1 overflow-y-auto p-4 space-y-2 whatsapp-bg">
        {grouped.length === 0 && <div className="text-center text-xs text-slate-500 mt-6">No messages yet.</div>}
        {grouped.map(m => 'divider' in m ? (
          <div key={m.key} className="flex justify-center my-2"><span className="bg-white/90 text-slate-500 text-xs font-semibold px-2.5 py-0.5 rounded-full shadow-sm">{m.divider}</span></div>
        ) : (
          <MessageBubble key={m.id} m={m} me={me} phone={c.phone} via={multi ? findNumber(numbers, m.phone_number_id) : null} />
        ))}
        <div ref={endRef} />
      </div>

      <div className="bg-slate-100 border-t border-wa-border px-3 py-2.5 space-y-2">
        {!canAct ? (
          <div className="flex flex-wrap items-center gap-2 bg-slate-200/70 border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-700">
            <Lock className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1 min-w-[200px]">
              This chat belongs to <strong>{c.assigned_to}</strong>. You can read it, but only they can reply or make changes.
              {canManage(me.role)
                ? ` As ${me.role === 'owner' ? 'the Business Admin' : 'a manager'}, you can reassign it (to yourself or someone else) from the "Assigned to" menu.`
                : ' Ask them, a manager or the Business Admin to transfer it to you.'}
            </span>
          </div>
        ) : win.open ? (
          <>
            {replyFromPicker}
            <div className="flex items-center gap-1.5 overflow-x-auto text-xs" data-testid="saved-reply-chips">
              <SavedReplyChips replies={saved.replies} name={firstName} canManage={canManage(me.role)} onPick={setText} onManage={() => setManaging(true)} />
              <button onClick={suggest} disabled={suggesting} title="AI drafts a reply from this chat; you review it before sending"
                className="ml-auto bg-violet-50 hover:bg-violet-100 border border-violet-200 px-2 py-0.5 rounded-full text-violet-800 font-semibold whitespace-nowrap cursor-pointer flex items-center gap-1 disabled:opacity-60">
                <Sparkles className={`w-3 h-3 ${suggesting ? 'animate-pulse' : ''}`} /> {suggesting ? 'Drafting…' : 'Suggest reply'}
              </button>
              <button onClick={() => setShowTemplate(true)} className="bg-white hover:bg-slate-200 border border-slate-200 px-2 py-0.5 rounded-full text-slate-700 whitespace-nowrap cursor-pointer flex items-center gap-1"><FileText className="w-3 h-3" /> Template</button>
            </div>
            <form onSubmit={send} className="flex items-end gap-2" data-testid="chat-composer">
              <AttachButton phone={c.phone} fromNumberId={fromId} onSent={onSent} showToast={showToast} />
              <div className="relative flex-1 flex">
                <SlashPicker text={text} replies={saved.replies} name={firstName} onPick={setText} />
                <textarea value={text} onChange={e => setText(e.target.value)} rows={1}
                  onKeyDown={e => {
                    if (e.key !== 'Enter' || e.shiftKey) return;
                    e.preventDefault();
                    // "/time" + Enter picks the first matching saved reply instead of sending "/time".
                    if (slashFirst) { setText(fillReply(slashFirst.body, firstName)); return; }
                    send();
                  }}
                  placeholder="Type a reply… (/ for saved replies · Enter to send · Shift+Enter for a new line)" aria-label="Reply"
                  className="flex-1 resize-none bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs max-h-32 focus:outline-none focus:ring-2 focus:ring-wa-teal" />
              </div>
              <button type="submit" disabled={sending || !text.trim() || slash !== null} className="w-10 h-10 rounded-full bg-wa-teal disabled:opacity-50 text-white flex items-center justify-center flex-shrink-0 cursor-pointer" aria-label="Send"><Send className="w-4 h-4" /></button>
            </form>
            <div className="text-xs text-slate-500 flex items-center gap-1">
              <Clock className="w-3 h-3" /> Free replies allowed for {left || 'a little longer'}. Sending a reply pauses the bot for 12 hours.
              {access === 'unassigned' && <strong className="text-wa-teal ml-1">Not assigned yet: replying or changing anything makes this chat yours.</strong>}
            </div>
          </>
        ) : (
          <>
            {replyFromPicker}
            <div className="flex flex-wrap items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-900" data-testid="window-closed">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1 min-w-[200px]">
                {multi && fromId
                  ? (win.everWrote
                    ? `It's been more than 24 hours since this customer wrote to ${numberName(fromNumber)}.`
                    : `This customer hasn't written to ${numberName(fromNumber)}.`)
                  : (c.last_inbound_at ? 'It\'s been more than 24 hours since this customer\'s last message.' : 'This customer hasn\'t messaged you yet.')}
                {' '}WhatsApp only allows an approved template{multi && fromId ? ' from this number' : ''} until they reply{multi && fromId && c.windowOpen ? `, or reply from ${numberName(lastNumber)}` : ''}.
              </span>
              <button onClick={() => setShowTemplate(true)} className={btnPrimary}><FileText className="w-3.5 h-3.5" /> Send template</button>
            </div>
          </>
        )}
      </div>

      {showTemplate && <TemplateModal contact={c} fromNumberId={fromId} fromLabel={multi ? numberName(fromNumber) : ''}
        onClose={() => setShowTemplate(false)} onSent={() => { setShowTemplate(false); onSent(); showToast('Template sent'); }} />}
      {managing && <SavedRepliesManager onClose={() => setManaging(false)} showToast={showToast} />}
    </>
  );
}

function MessageBubble({ m, me, via, phone }: { m: ChatMessage; me: Me; via?: BusinessNumber | null; phone: string }) {
  const out = m.direction === 'outbound';
  const byStaff = out && m.sent_by;
  const byBot = out && !m.sent_by;
  // AI answers are saved with the sender name "AI Assistant ✨"; everything else automatic is the bot flow.
  const byAi = byBot && /AI Assistant/i.test(m.sender_name || '');
  const ticks = m.delivery_status === 'read'
    ? <CheckCheck className="w-3 h-3 text-sky-500" />
    : m.delivery_status === 'delivered' ? <CheckCheck className="w-3 h-3 text-slate-400" />
      : m.delivery_status === 'failed' ? <AlertTriangle className="w-3 h-3 text-red-500" />
        : <Check className="w-3 h-3 text-slate-400" />;
  return (
    <div className={`flex ${out ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] sm:max-w-[70%] ${out ? 'bubble-out' : 'bubble-in'} ${byAi ? 'ring-1 ring-violet-300' : ''} px-3 py-1.5 text-xs text-wa-textPrimary`}
        style={byAi ? { background: '#f3edff' } : undefined}>
        {out && (
          <div className="mb-0.5">
            {byAi ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-600 text-white text-2xs font-semibold px-1.5 py-0.5">✨ AI Assistant</span>
            ) : byBot ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-teal-600 text-white text-2xs font-semibold px-1.5 py-0.5">🤖 Bot flow</span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-600 text-white text-2xs font-semibold px-1.5 py-0.5">👤 {byStaff === me.email ? 'You' : m.sent_by}</span>
            )}
          </div>
        )}
        {hasMedia(m) && <MessageMedia phone={phone} m={m} />}
        {/* A file's automatic label ("📷 Photo", "📄 report.pdf") isn't repeated under it; a caption is shown. */}
        {!(hasMedia(m) && isMediaLabel(m.body)) && <div className="whitespace-pre-wrap break-words leading-relaxed">{m.body}</div>}
        {m.audio_url && <audio controls src={m.audio_url} className="w-full h-8 mt-1.5" />}
        {/* A WhatsApp call's line ("📞 WhatsApp call, 2 min 5 s"): its recording, if answered and recorded. */}
        {m.type === 'call' && m.message_id?.endsWith('_log') && /answered by/.test(m.body || '') && (
          <CallRecordingPlayer callId={m.message_id.slice(0, -'_log'.length)} />
        )}
        <div className="flex items-center justify-end gap-1 mt-0.5 text-2xs text-slate-400">
          {via && <span className="text-sky-700 font-semibold" data-testid="message-number" title={out ? 'Sent from this number' : 'Sent to this number'}>{out ? 'from' : 'to'} {numberName(via)} ·</span>}
          <span>{new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          {out && ticks}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Right-hand details: stage, assignee, bot, tags, notes
// ---------------------------------------------------------------------------

interface DetailsProps {
  contact: InboxContact;
  notes: ContactNote[];
  me: Me;
  staff: StaffMember[];
  onUpdate: OnUpdate;
  onNotesChanged: () => void;
  showToast: ShowToast;
}

function DetailsPanel({ contact: c, notes, me, staff, onUpdate, onNotesChanged, showToast }: DetailsProps) {
  const leadStatuses = useLeadStatuses();
  const askValue = useConfirm();
  const renameLead = useRenameLead(showToast);
  // Moving to a booked / done kind of status: an optional amount for the Ads funnel's revenue (Cancel keeps the chat where it is).
  const moveTo = async (key: string, label: string) => {
    const type = leadStatuses.all.find(x => x.key === key)?.type;
    if (type !== 'won' && type !== 'done') { onUpdate({ stage: key }, `Moved to ${label}`); return; }
    const typed = await askValue.ask({ title: `Move to ${label}`, body: 'Booking amount, if you know it (used for revenue and return on ad spend). Leave it empty to use your usual amount.', label: 'Amount (optional)', placeholder: 'e.g. 1500', confirmLabel: 'Move' });
    if (typed === null) return;
    const amount = typed.replace(/[^d.]/g, '');
    onUpdate(amount ? { stage: key, bookingValue: Number(amount) } : { stage: key }, `Moved to ${label}`);
  };
  const [tagInput, setTagInput] = useState('');
  const [note, setNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const tags = c.tags || [];
  const access = accessOf(c, me);
  const canAct = access !== 'other';

  const addTag = (e: React.FormEvent) => {
    e.preventDefault();
    const t = tagInput.trim();
    if (!t) return;
    onUpdate({ tags: [...tags, t] });
    setTagInput('');
  };

  const saveNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return;
    setSavingNote(true);
    try {
      await api(`/api/inbox/${c.phone}/notes`, { method: 'POST', body: { body: note } });
      setNote('');
      onNotesChanged();
    } catch (err) {
      showToast(message(err));
    } finally {
      setSavingNote(false);
    }
  };

  const removeNote = async (id: string | number) => {
    try {
      await api(`/api/notes/${id}`, { method: 'DELETE' });
      onNotesChanged();
    } catch (err) {
      showToast(message(err));
    }
  };

  return (
    <aside className="hidden lg:flex w-[300px] flex-shrink-0 border-l border-wa-border bg-white flex-col overflow-y-auto">
      <div className="p-4 border-b border-slate-100 text-center">
        <div className={`w-14 h-14 rounded-full ${avatarBg(c.phone)} text-white flex items-center justify-center font-bold mx-auto`}>{initials(c)}</div>
        <div className="text-sm font-bold text-slate-800 mt-2 flex items-center justify-center gap-1">{displayName(c)}{canAct && <RenameButton onClick={() => renameLead(c)} label="Rename contact" />}</div>
        {otherWaName(c) && <div className="text-xs text-slate-500">WhatsApp: {otherWaName(c)}</div>}
        <div className="text-xs text-slate-500 font-mono">+{c.phone}</div>
        {c.opted_out && <div className="mt-2 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-0.5 inline-block">Replied STOP: no marketing messages</div>}
      </div>

      <div className="p-4 space-y-4 text-xs">
        <section>
          <div className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-1.5">Stage</div>
          <div className="grid grid-cols-2 gap-1.5">
            {/* The business's own statuses (Settings -> Lead statuses); a hidden one still shows while the chat is in it. */}
            {leadStatuses.all.filter(s => s.active || s.key === c.stage).map(({ key: s }) => {
              const look = statusLook(leadStatuses.all, s);
              return (
                <button key={s} disabled={!canAct} onClick={() => { if (s !== c.stage) void moveTo(s, look.label); }}
                  className={`text-xs px-2 py-1 rounded-md border font-semibold text-left flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed ${c.stage === s ? look.cls + ' ring-1 ring-offset-1 ring-slate-300' : 'border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:hover:bg-transparent'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${look.dot}`} /> {look.label}
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <div className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-1.5 flex items-center gap-1"><UserRound className="w-3 h-3" /> Assigned to</div>
          <AssigneeSelect contact={c} me={me} staff={staff} onUpdate={onUpdate} className={inputCls} />
          {(access === 'unassigned' || (access === 'other' && canManage(me.role))) && (
            <button onClick={() => onUpdate({ assignedTo: me.email }, 'This chat is now yours')} className="text-xs text-wa-teal font-semibold mt-1 cursor-pointer">
              {access === 'unassigned' ? 'Take this chat' : 'Reassign to me (owner)'}
            </button>
          )}
          <div className="text-xs text-slate-500 mt-1">
            {access === 'unassigned' && 'Anyone can pick this up. The first person to reply or change anything gets it.'}
            {access === 'mine' && 'Yours. Only you (or an owner) can transfer it.'}
            {access === 'other' && `View only. Only ${c.assigned_to}${canManage(me.role) ? ' or you' : ', a manager or the Business Admin'} can transfer it.`}
          </div>
        </section>

        <section>
          <div className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-1.5 flex items-center gap-1"><Bot className="w-3 h-3" /> Bot</div>
          {c.botPaused ? (
            <div className="space-y-1.5">
              <div className="text-slate-700">Paused {c.bot_paused_until ? <>until <strong>{new Date(c.bot_paused_until).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</strong></> : <strong>until you resume it</strong>}. Your team is handling this chat.</div>
              <div className="flex gap-1.5">
                <button disabled={!canAct} onClick={() => onUpdate({ botPaused: false }, 'Bot resumed')} className={btnSecondary}>Resume bot</button>
                {c.bot_paused_until && <button disabled={!canAct} onClick={() => onUpdate({ botPaused: true }, 'Bot paused until you resume it')} className={btnSecondary}>Keep paused</button>}
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="text-slate-700">The bot answers this customer automatically.</div>
              <div className="flex gap-1.5">
                <button disabled={!canAct} onClick={() => onUpdate({ botPaused: true, pauseHours: 12 }, 'Bot paused for 12 hours')} className={btnSecondary}>Pause 12h</button>
                <button disabled={!canAct} onClick={() => onUpdate({ botPaused: true }, 'Bot paused until you resume it')} className={btnSecondary}>Pause</button>
              </div>
            </div>
          )}
        </section>

        <section>
          <div className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-1.5 flex items-center gap-1"><Tag className="w-3 h-3" /> Tags</div>
          <div className="flex flex-wrap gap-1 mb-1.5">
            {tags.length === 0 && <span className="text-slate-400">No tags yet</span>}
            {tags.map(t => (
              <span key={t} className="bg-slate-100 text-slate-700 rounded-full pl-2 pr-1 py-0.5 text-xs flex items-center gap-1">
                {t}
                {canAct && <button onClick={() => onUpdate({ tags: tags.filter(x => x !== t) })} className="text-slate-400 hover:text-red-600 cursor-pointer"><X className="w-3 h-3" /></button>}
              </span>
            ))}
          </div>
          {canAct && (
            <form onSubmit={addTag} className="flex gap-1.5">
              <input value={tagInput} onChange={e => setTagInput(e.target.value)} placeholder="e.g. vip, diabetes, weekly" className={inputCls} />
              <button type="submit" className={btnSecondary}>Add</button>
            </form>
          )}
          <div className="text-xs text-slate-400 mt-1">Tags can be used to target broadcasts.</div>
        </section>

        <section>
          <div className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-1.5 flex items-center gap-1"><StickyNote className="w-3 h-3" /> Notes</div>
          {canAct ? (
            <form onSubmit={saveNote} className="space-y-1.5">
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Only your team sees notes, e.g. 'prefers delivery after 6pm'"
                className={`${inputCls} text-xs`} />
              <button type="submit" disabled={savingNote || !note.trim()} className={btnSecondary}>{savingNote ? 'Saving…' : 'Add note'}</button>
            </form>
          ) : <div className="text-xs text-slate-500">Only {c.assigned_to} can add notes to this chat.</div>}
          <div className="space-y-2 mt-2">
            {(notes || []).map(n => (
              <div key={n.id} className="bg-amber-50 border border-amber-100 rounded-lg p-2">
                <div className="whitespace-pre-wrap text-slate-800">{n.body}</div>
                <div className="flex items-center text-xs text-slate-500 mt-1">
                  <span>{n.author === me.email ? 'You' : n.author} · {new Date(n.created_at).toLocaleDateString([], { day: 'numeric', month: 'short' })}</span>
                  {(canManage(me.role) || (sameEmail(n.author, me.email) && canAct)) && (
                    <button onClick={() => removeNote(n.id)} className="ml-auto text-slate-400 hover:text-red-600 cursor-pointer" title="Delete note"><Trash2 className="w-3 h-3" /></button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        <ContactQueries key={c.phone} phone={c.phone} me={me} showToast={showToast} />

        <section className="text-xs text-slate-500 space-y-0.5 border-t border-slate-100 pt-3">
          <div>Source: <span className="text-slate-700">{c.source || '–'}</span></div>
          {c.first_ad_id && (
            <div>First ad: <span className="text-slate-700">{adLabel(c.first_ad_headline, c.first_ad_id)}</span>
              {c.first_ad_at && <span> ({new Date(c.first_ad_at).toLocaleDateString()})</span>}</div>
          )}
          {c.last_ad_id && (c.last_ad_id !== c.first_ad_id || c.last_ad_at !== c.first_ad_at) && (
            <div>Latest ad: <span className="text-slate-700">{adLabel(c.last_ad_headline, c.last_ad_id)}</span>
              {c.last_ad_at && <span> ({new Date(c.last_ad_at).toLocaleDateString()})</span>}</div>
          )}
          <div>First contact: <span className="text-slate-700">{c.created_at ? new Date(c.created_at).toLocaleDateString() : '–'}</span></div>
          <div>Last customer message: <span className="text-slate-700">{c.last_inbound_at ? new Date(c.last_inbound_at).toLocaleString() : '–'}</span></div>
        </section>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------

function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEscape(onClose);
  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`bg-white rounded-xl shadow-xl w-full ${wide ? 'max-w-3xl' : 'max-w-md'} max-h-[90vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <div className="text-sm font-semibold text-slate-800">{title}</div>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700 cursor-pointer"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

interface TemplateVariables { header: VariableSpec[]; body: VariableSpec[]; headerMediaUrl: string }

interface TemplateModalProps {
  contact: InboxContact;
  /** Send from this business number (its account's templates); null = the number they last wrote to. */
  fromNumberId?: string | null;
  /** Shown in the title when the business has several numbers. */
  fromLabel?: string;
  onClose: () => void;
  onSent: () => void;
}

function TemplateModal({ contact, fromNumberId = null, fromLabel = '', onClose, onSent }: TemplateModalProps) {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [error, setError] = useState('');
  const [key, setKey] = useState('');
  const [variables, setVariables] = useState<TemplateVariables>({ header: [], body: [], headerMediaUrl: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ templates?: Template[] }>(`/api/templates${fromNumberId ? `?number=${fromNumberId}` : ''}`)
      .then(d => setTemplates((d.templates || []).filter(t => t.status === 'APPROVED')))
      .catch(e => { setTemplates([]); setError(message(e)); });
  }, [fromNumberId]);

  const template = (templates || []).find(t => `${t.name}|${t.language}` === key);
  const needs = template ? templateNeeds(template) : null;
  const blockedMarketing = !!contact.opted_out && template?.category === 'MARKETING';

  const pick = (k: string) => {
    setKey(k);
    const t = (templates || []).find(x => `${x.name}|${x.language}` === k);
    const n = t ? templateNeeds(t) : null;
    setVariables({
      header: (n?.headerVars || []).map(() => ({ type: 'contact_name', fallback: 'there' })),
      body: (n?.bodyVars || []).map((_, i) => (i === 0 ? { type: 'contact_name', fallback: 'there' } : { type: 'text', value: '' })),
      headerMediaUrl: '',
    });
  };

  const name = displayName(contact).startsWith('+') ? 'there' : displayName(contact).split(/\s+/)[0];
  const sample = (s: VariableSpec | undefined, k: string) => (!s ? `{{${k}}}` : s.type === 'contact_name' ? name : (s.value || `{{${k}}}`));
  const fill = (text: string, vars: string[], specs: VariableSpec[]) => vars.reduce((acc, k, i) => acc.split(`{{${k}}}`).join(sample(specs[i], k)), text);

  const send = async () => {
    if (!template) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/inbox/${contact.phone}/template`, { method: 'POST', body: { templateName: template.name, language: template.language, variables, ...(fromNumberId ? { fromNumberId } : {}) } });
      onSent();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Send a template to ${displayName(contact)}${fromLabel ? ` from ${fromLabel}` : ''}`} onClose={onClose} wide>
      {templates === null ? <div className="text-xs text-slate-500">Loading templates…</div> : (
        <div className="grid md:grid-cols-[1fr_300px] gap-4">
          <div className="space-y-3">
            {templates.length === 0 && !error && <div className="text-xs text-slate-600">No approved templates yet. Create one under Broadcasts → Templates.</div>}
            {templates.length > 0 && (
              <select className={inputCls} value={key} onChange={e => pick(e.target.value)}>
                <option value="">Choose an approved template…</option>
                {templates.map(t => <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>{t.name} ({t.language}, {t.category.toLowerCase()})</option>)}
              </select>
            )}
            {needs?.headerFormat && needs.headerFormat !== 'TEXT' && (
              <input className={inputCls} value={variables.headerMediaUrl} onChange={e => setVariables(v => ({ ...v, headerMediaUrl: e.target.value }))} placeholder={`https:// link to the header ${needs.headerFormat.toLowerCase()}`} />
            )}
            {needs?.headerVars.map((k, i) => (
              <VariableInput key={`h${k}`} label={`Header {{${k}}}`} spec={variables.header[i]}
                onChange={s => setVariables(v => { const h = [...v.header]; h[i] = s; return { ...v, header: h }; })} />
            ))}
            {needs?.bodyVars.map((k, i) => (
              <VariableInput key={`b${k}`} label={`Body {{${k}}}`} spec={variables.body[i]}
                onChange={s => setVariables(v => { const b = [...v.body]; b[i] = s; return { ...v, body: b }; })} />
            ))}
            {blockedMarketing && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2">This customer replied STOP. Only utility templates (like order updates) can be sent to them.</div>}
            {error && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{error}</div>}
            <div className="flex gap-2">
              <button onClick={send} disabled={!template || busy || blockedMarketing} className={btnPrimary}><Send className="w-3.5 h-3.5" /> {busy ? 'Sending…' : 'Send'}</button>
              <button onClick={onClose} className={btnSecondary}>Cancel</button>
            </div>
          </div>
          {needs ? (
            <TemplatePreview headerFormat={needs.headerFormat} headerText={fill(needs.headerText, needs.headerVars, variables.header)}
              bodyText={fill(needs.bodyText, needs.bodyVars, variables.body)} footerText={needs.footerText} buttons={needs.buttons} />
          ) : <div className="bg-slate-50 rounded-xl p-6 text-xs text-slate-400 text-center">Preview appears here</div>}
        </div>
      )}
    </Modal>
  );
}

function NewChatModal({ onClose, onStarted }: { onClose: () => void; onStarted: (phone: string) => void }) {
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const d = await api<{ contact: InboxContact }>('/api/inbox/start', { method: 'POST', body: { phone, name } });
      onStarted(d.contact.phone);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Message a new number" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-xs font-semibold text-slate-700">WhatsApp number (with country code)
          <input className={`${inputCls} mt-1`} value={phone} onChange={e => setPhone(e.target.value)} placeholder="919876543210" autoFocus required />
        </label>
        <label className="block text-xs font-semibold text-slate-700">Name (optional)
          <input className={`${inputCls} mt-1`} value={name} onChange={e => setName(e.target.value)} placeholder="Ravi Kumar" />
        </label>
        <div className="text-xs text-slate-500">WhatsApp requires an approved template for the first message to someone who hasn't written to you. You'll pick one next. Only message people who asked to hear from you.</div>
        {error && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{error}</div>}
        <div className="flex gap-2">
          <button type="submit" disabled={busy} className={btnPrimary}>{busy ? 'Opening…' : 'Open chat'}</button>
          <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}
