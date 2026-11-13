import React, { useEffect, useState } from 'react';
import { X, Send, ArrowUpCircle, MessageSquare, Lock, Star, UserPlus, AlertTriangle, RotateCcw, CheckCircle2 } from 'lucide-react';
import { api, inputCls, inputInlineCls, btnPrimary, btnSecondary } from './broadcastUtils';
import { useApi, refreshApi } from './queryClient';
import { BUTTON, useEscape } from './ui';
import {
  QUERY_STAGE_INFO, QUERY_MOVES, PRIORITIES, PRIORITY_INFO, SOURCE_LABEL, ADDRESSED_LABEL, dueText, eventText, ago,
  type Priority, type QueryDetailResponse, type QueryStage,
} from './queryUtils';
import type { Me, ShowToast, StaffMember, TeamResponse } from './types';

const NO_TEAM: StaffMember[] = [];
/** reply = to the customer on WhatsApp, comment = everyone on the query sees it, note = handlers only */
type WriteMode = 'reply' | 'comment' | 'note';
// Everyday stage moves shown as buttons; the others are under "More stages".
const QUICK_MOVES: QueryStage[] = ['in_progress', 'waiting', 'resolved', 'reopened'];
const QUICK_LABEL: Partial<Record<QueryStage, string>> = { in_progress: 'Working on it', waiting: 'Waiting for reply', resolved: 'Mark resolved', reopened: 'Reopen' };
const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

interface Props {
  id: string;
  kind?: 'query' | 'support';
  me: Me;
  onClose: () => void;
  onChanged?: () => void;
  showToast: ShowToast;
  /** Open the customer's chat (not available inside the Inbox, where it is already open). */
  onOpenChat?: (phone: string) => void;
}

/**
 * One query: details, history and the actions this person may take.
 * kind 'query'   = a customer or team query  (/api/queries/:id)
 * kind 'support' = something this business sent to Platform support (/api/support/:id)
 */
export default function QueryDetail({ id, kind = 'query', me, onClose, onChanged, showToast, onOpenChat }: Props) {
  const base = kind === 'support' ? `/api/support/${id}` : `/api/queries/${id}`;
  const detail = useApi<QueryDetailResponse>(base, { staleTime: 0 }); // always fresh when opened
  const d = detail.data || null;
  // The assignee menu (managers and the Business Admin): the shared team list.
  const team = useApi<TeamResponse>('/api/team', { enabled: kind === 'query' && me.role !== 'agent' }).data?.staff || NO_TEAM;
  const [busy, setBusy] = useState('');
  const [text, setText] = useState('');
  const [pickedMode, setMode] = useState<WriteMode | null>(null);
  const [escalateNote, setEscalateNote] = useState<string | null>(null);

  // Not found / no longer allowed: say so and close the panel.
  const failed = detail.error?.message;
  useEffect(() => {
    if (!failed) return;
    showToast(failed);
    onClose();
  }, [failed, showToast, onClose]);

  // After a change: this query and the lists it appears in.
  const load = () => refreshApi(kind === 'support' ? '/api/support' : '/api/queries');

  const q = d?.query;
  const access = kind === 'support' ? 'requester' : d?.access;
  const isHandler = access === 'handler';
  const canWork = kind === 'query' && isHandler && d?.canWork;
  const isCustomer = q?.kind === 'customer';
  // Until the person picks: reply to the customer if they can, otherwise a comment.
  const mode: WriteMode = pickedMode || (isCustomer && canWork ? 'reply' : 'comment');

  // The server's answer to an action; the fields used for the toast message.
  type ActResult = { customerMessage?: { sent?: boolean; reason?: string }; platformQuery?: { ref: string } };

  const act = async (label: string, path: string, method: string, body: unknown, done?: string | ((r: ActResult) => string)): Promise<ActResult | null> => {
    setBusy(label);
    try {
      const r = await api<ActResult>(path, { method, body });
      if (done) showToast(typeof done === 'function' ? done(r) : done);
      await load();
      onChanged?.();
      return r;
    } catch (err) {
      showToast(message(err));
      return null;
    } finally {
      setBusy('');
    }
  };
  const patch = (body: Record<string, unknown>, msg: string) => (kind === 'support'
    ? act('patch', base, 'POST', body, msg)
    : act('patch', base, 'PATCH', body, msg));

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    const r = kind === 'support'
      ? await act('send', base, 'POST', { body: text }, 'Sent to Platform support')
      : await act('send', `${base}/comments`, 'POST', {
        body: text,
        visibility: mode === 'note' ? 'handlers' : 'all',
        toCustomer: mode === 'reply',
      }, (res) => (mode === 'reply'
        ? (res.customerMessage?.sent === false ? `Saved, but the customer was not told: ${res.customerMessage.reason}` : 'Reply sent to the customer on WhatsApp')
        : mode === 'note' ? 'Internal note saved' : 'Comment added'));
    if (r) setText('');
  };

  if (!d || !q) {
    return <Shell onClose={onClose}><div className="text-sm text-slate-500 p-6">Loading…</div></Shell>;
  }

  const stage: { label?: string; cls?: string } = QUERY_STAGE_INFO[q.stage as QueryStage] || {};
  const moves: QueryStage[] = (QUERY_MOVES[q.stage as QueryStage] || []).filter(s => s !== 'escalated');
  const due = dueText(q);
  const canRate = access === 'requester' && (q.stage === 'resolved' || q.stage === 'closed') && !q.rating;

  return (
    <Shell onClose={onClose}>
      {/* Header */}
      <div className="px-5 pt-4 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2 flex-wrap pr-8">
          <span className="text-xs font-bold text-slate-500">{q.ref}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded border font-semibold ${stage.cls}`}>{stage.label}</span>
          <span className={`text-xs ${PRIORITY_INFO[q.priority as Priority]?.cls}`}>{PRIORITY_INFO[q.priority as Priority]?.label} priority</span>
          {q.overdue && <span className="text-xs text-red-700 font-semibold flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {due}</span>}
          {!q.overdue && due && <span className="text-xs text-slate-500">{due}</span>}
        </div>
        <h2 className="text-base font-bold text-slate-800 mt-1">{q.subject}</h2>
        <div className="text-xs text-slate-500 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
          {q.category && <span>Category: <b className="text-slate-700">{q.category}</b></span>}
          {kind === 'query' && isCustomer && <span>From: <b className="text-slate-700">{SOURCE_LABEL[q.source || ''] || q.source}</b></span>}
          {kind === 'query' && !isCustomer && <span>For: <b className="text-slate-700">{ADDRESSED_LABEL[q.addressed_to || '']}</b></span>}
          {q.raised_by_email && <span>Raised by: <b className="text-slate-700">{q.raised_by_email}</b></span>}
          <span>Assigned: <b className="text-slate-700">{q.assigned_to || 'nobody yet'}</b></span>
          {q.created_at && <span>{new Date(q.created_at).toLocaleString()}</span>}
        </div>
        {q.contact_phone && (
          <button onClick={() => q.contact_phone && onOpenChat?.(q.contact_phone)} disabled={!onOpenChat} className="mt-2 text-xs text-wa-teal font-semibold flex items-center gap-1 cursor-pointer disabled:cursor-default disabled:text-slate-500">
            <MessageSquare className="w-3.5 h-3.5" /> +{q.contact_phone}{onOpenChat ? ' · open chat' : ''}
          </button>
        )}
        {q.description && <p className="mt-2 text-xs text-slate-700 whitespace-pre-wrap bg-slate-50 rounded-lg p-2 border border-slate-100">{q.description}</p>}
        {access === 'viewer' && <div className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">View only: this query has been escalated above your role.</div>}
        {isHandler && !d.canWork && <div className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">This query belongs to {q.assigned_to}. Ask a manager or the Business Admin to transfer it.</div>}
      </div>

      {/* Actions */}
      {canWork && moves.some(s => QUICK_MOVES.includes(s)) && (
        // The everyday moves as big buttons (U2); the rest stay in "More stages".
        <div className="px-5 pt-3 flex flex-wrap gap-2" role="group" aria-label="Move this query" data-testid="quick-stages">
          {QUICK_MOVES.filter(s => moves.includes(s)).map(s => (
            <button key={s} disabled={!!busy} onClick={() => patch({ stage: s }, `Moved to ${QUERY_STAGE_INFO[s].label}`)}
              className={`${s === 'resolved' ? BUTTON.primary : BUTTON.secondary} py-2.5 px-4 text-sm`}>
              {QUICK_LABEL[s] || QUERY_STAGE_INFO[s].label}
            </button>
          ))}
        </div>
      )}
      {canWork && (
        <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2 text-xs">
          {moves.some(s => !QUICK_MOVES.includes(s)) && (
            <label className="flex items-center gap-1 text-slate-600">More stages
              <select value="" disabled={!!busy} onChange={e => e.target.value && patch({ stage: e.target.value }, `Moved to ${QUERY_STAGE_INFO[e.target.value as QueryStage].label}`)} className={inputInlineCls}>
                <option value="">Move to…</option>
                {moves.filter(s => !QUICK_MOVES.includes(s)).map(s => <option key={s} value={s}>{QUERY_STAGE_INFO[s].label}</option>)}
              </select>
            </label>
          )}
          <label className="flex items-center gap-1 text-slate-600">Priority
            <select value={q.priority} disabled={!!busy} onChange={e => patch({ priority: e.target.value }, 'Priority changed; due time updated')} className={inputInlineCls}>
              {PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_INFO[p].label}</option>)}
            </select>
          </label>
          {me.role === 'agent'
            ? (!q.assigned_to && <button onClick={() => patch({ assignedTo: me.email }, 'Assigned to you')} disabled={!!busy} className={btnSecondary}><UserPlus className="w-3.5 h-3.5" /> Take it</button>)
            : (
              <label className="flex items-center gap-1 text-slate-600">Assign
                <select value={q.assigned_to || ''} disabled={!!busy} onChange={e => patch({ assignedTo: e.target.value || null }, e.target.value ? `Assigned to ${e.target.value}` : 'Unassigned')} className={inputInlineCls}>
                  <option value="">Nobody</option>
                  {team.filter(t => isCustomer || t.role !== 'agent').map(t => <option key={t.email} value={t.email.toLowerCase()}>{t.email} ({t.role === 'owner' ? 'Admin' : t.role})</option>)}
                </select>
              </label>
            )}
          {q.stage !== 'resolved' && q.stage !== 'closed' && !(isCustomer && (q.escalation_level || 0) >= 2) && !(!isCustomer && me.role !== 'owner' && q.addressed_to === 'owner') && (
            <button onClick={() => setEscalateNote(escalateNote === null ? '' : null)} className={btnSecondary}><ArrowUpCircle className="w-3.5 h-3.5 text-orange-600" /> Escalate</button>
          )}
        </div>
      )}
      {escalateNote !== null && (
        <div className="px-5 py-3 border-b border-slate-100 bg-orange-50/50 space-y-2">
          <div className="text-xs text-slate-700">
            {isCustomer
              ? ((q.escalation_level || 0) === 0 ? 'Escalate to managers. Agents can still see it but not work on it.' : 'Escalate to the Business Admin.')
              : (q.addressed_to === 'managers' ? 'Escalate to the Business Admin.' : 'Send to Platform support (for problems with the app itself). Don\'t include customers\' personal details.')}
          </div>
          <textarea rows={2} value={escalateNote} onChange={e => setEscalateNote(e.target.value)} placeholder="Why? (optional)" className={`${inputCls} text-xs`} />
          <div className="flex gap-2">
            <button onClick={async () => { const r = await act('esc', `${base}/escalate`, 'POST', { note: escalateNote }, (res) => (res.platformQuery ? `Sent to Platform support as ${res.platformQuery.ref}` : 'Escalated')); if (r) setEscalateNote(null); }} disabled={busy === 'esc'} className={btnPrimary}>Escalate</button>
            <button onClick={() => setEscalateNote(null)} className={btnSecondary}>Cancel</button>
          </div>
        </div>
      )}
      {access === 'requester' && (q.stage === 'resolved' || q.stage === 'closed') && (
        <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-600">{q.stage === 'resolved' ? 'Is it solved?' : 'Closed.'}</span>
          {q.stage === 'resolved' && <button onClick={() => patch({ stage: 'closed' }, 'Thanks! Query closed')} disabled={!!busy} className={btnPrimary}><CheckCircle2 className="w-3.5 h-3.5" /> Yes, close it</button>}
          <button onClick={() => patch({ stage: 'reopened' }, 'Reopened')} disabled={!!busy} className={btnSecondary}><RotateCcw className="w-3.5 h-3.5" /> Not solved, reopen</button>
        </div>
      )}
      {canRate && (
        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-1 text-xs">
          <span className="text-slate-600 mr-1">Rate the help you got:</span>
          {[1, 2, 3, 4, 5].map(n => (
            <button key={n} title={`${n}/5`} disabled={!!busy} onClick={() => (kind === 'support'
              ? act('rate', base, 'POST', { rating: n }, 'Thanks for rating')
              : act('rate', `${base}/rating`, 'POST', { rating: n }, 'Thanks for rating'))} className="cursor-pointer">
              <Star className="w-5 h-5 text-amber-400 hover:fill-amber-400" />
            </button>
          ))}
        </div>
      )}
      {q.rating && <div className="px-5 py-2 border-b border-slate-100 text-xs text-slate-600">Rating: {'★'.repeat(q.rating)}{'☆'.repeat(5 - q.rating)}{q.rating_comment ? ` · "${q.rating_comment}"` : ''}</div>}

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
        <div className="text-xs font-bold uppercase tracking-wide text-slate-500">History</div>
        {(d.events || []).map(e => {
          const hidden = e.visibility === 'handlers' || e.visibility === 'platform';
          const hasBody = e.body && ['comment', 'reply', 'note', 'escalated', 'created'].includes(e.type) && !(e.type === 'created' && e.body === q.description);
          return (
            <div key={e.id} className={`text-xs rounded-lg ${hasBody ? `p-2 border ${hidden ? 'bg-amber-50/60 border-amber-200' : e.type === 'reply' ? 'bg-emerald-50/60 border-emerald-200' : 'bg-white border-slate-200'}` : 'px-2'}`}>
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                {hidden && <Lock className="w-3 h-3 text-amber-600" />}
                <span className="font-semibold text-slate-700">{e.author_role === 'platform_admin' ? 'Platform support' : e.author_email || (e.author_role === 'customer' ? 'Customer' : 'System')}</span>
                <span>· {eventText(e)}</span>
                <span className="ml-auto">{e.created_at ? ago(e.created_at) : ''}</span>
              </div>
              {hasBody && <div className="mt-1 text-slate-800 whitespace-pre-wrap">{e.body}</div>}
            </div>
          );
        })}
      </div>

      {/* Write */}
      {(canWork || access === 'requester') && q.stage !== 'closed' && (
        <form onSubmit={send} className="border-t border-slate-200 px-5 py-3 space-y-2 bg-slate-50">
          {canWork && (
            <div className="flex gap-1 text-xs">
              {(isCustomer
            ? [['reply', 'Reply to customer'], ['comment', 'Comment'], ['note', 'Internal note']] as const
            : [['comment', 'Reply'], ['note', 'Internal note']] as const).map(([m, l]) => (
                <button type="button" key={m} onClick={() => setMode(m)} className={`px-2 py-1 rounded-md font-semibold cursor-pointer ${mode === m ? 'bg-wa-teal text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>{l}</button>
              ))}
            </div>
          )}
          <textarea rows={2} maxLength={4000} value={text} onChange={e => setText(e.target.value)}
            placeholder={mode === 'reply' && canWork ? 'Goes to the customer on WhatsApp with the query number' : mode === 'note' ? 'Only handlers see this' : 'Write a message'} className={`${inputCls} text-xs`} />
          <div className="flex items-center gap-2">
            <button type="submit" disabled={busy === 'send' || !text.trim()} className={btnPrimary}><Send className="w-3.5 h-3.5" /> {busy === 'send' ? 'Sending…' : 'Send'}</button>
            {mode === 'reply' && canWork && <span className="text-xs text-slate-500">Outside 24 h, WhatsApp needs your approved "query_update" template.</span>}
          </div>
        </form>
      )}
    </Shell>
  );
}

function Shell({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEscape(onClose);
  return (
    <div className="fixed inset-0 bg-black/30 z-40 flex justify-end" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Query" className="bg-white w-full max-w-xl h-full shadow-2xl flex flex-col relative">
        <button onClick={onClose} className="absolute right-3 top-3 text-slate-400 hover:text-slate-700 cursor-pointer" aria-label="Close"><X className="w-5 h-5" /></button>
        {children}
      </div>
    </div>
  );
}
