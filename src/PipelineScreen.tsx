import { useState } from 'react';
import { RotateCw, Hand, Kanban, Lock, UserPlus } from 'lucide-react';
import AddLeadModal from './AddLeadModal';
import { ImportedBadge, ReturnedBadge, RenameButton } from './leadNames';
import { showCustomValue, type CustomFieldType } from './importUtils';
import { useRenameLead } from './leadNameUtils';
import { api, btnSecondary } from './broadcastUtils';
import { LoadError, SkeletonBoard, EmptyState } from './ui';
import { REFRESH } from './usePolling';
import { useApi, refreshApi, setApiData, errorOf } from './queryClient';
import { avatarBg, displayName, initials, emailInitials, shortTime, accessOf } from './crmUtils';
import { useLeadStatuses, statusLook, type LeadStatus, type StatusType } from './leadStatuses';
import type { Contact, Me, ShowToast, TeamResponse } from './types';

/** GET /api/pipeline: contacts grouped by the business's own statuses (server/inbox.cjs pipeline). */
interface PipelineResponse { stages?: string[]; statuses?: LeadStatus[]; columns: Record<string, Contact[]>; cards?: Record<string, Array<{ label: string; type: CustomFieldType; value: string | number | boolean }>> }

interface Props {
  onOpenChat: (phone: string) => void;
  showToast: ShowToast;
}

const NO_ME: Me = { email: '', role: 'agent' };
const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Customers by status. Drag a card to another column (or use its menu) to move it; click to open the chat. */
export default function PipelineScreen({ onOpenChat, showToast }: Props) {
  const pipeline = useApi<PipelineResponse>('/api/pipeline', { refetchInterval: REFRESH.pipeline });
  const team = useApi<TeamResponse>('/api/team'); // shared with the Inbox and Team screens
  const statuses = useLeadStatuses();
  const data = pipeline.data || null;
  const error = errorOf(pipeline);
  const me: Me = team.data?.me ? { email: team.data.me.email || '', role: team.data.me.role || 'agent' } : NO_ME;
  const load = () => pipeline.refetch();
  // The business's own list (from the pipeline answer, else the shared cache).
  const list = data?.statuses?.length ? data.statuses : statuses.all;
  const keys = data ? (data.stages?.length ? data.stages : Object.keys(data.columns)) : [];
  const movable = list.filter(s => s.active);
  const firstOf = (t: StatusType) => list.find(s => s.active && s.type === t)?.label;
  const [dragging, setDragging] = useState<{ phone: string; stage: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [mine, setMine] = useState(false);
  const [adding, setAdding] = useState(false);
  const rename = useRenameLead(showToast);
  const [phoneStage, setPhoneStage] = useState<string>('new'); // phones show one status at a time
  const shownStage = keys.includes(phoneStage) ? phoneStage : keys[0];

  const move = async (phone: string, stage: string) => {
    // Optimistic: move the card now, then save.
    setApiData<PipelineResponse>('/api/pipeline', d => {
      if (!d) return d;
      const columns = Object.fromEntries(Object.entries(d.columns).map(([s, cards]) => [s, cards.filter(c => c.phone !== phone)]));
      const card = Object.values(d.columns).flat().find(c => c.phone === phone);
      if (card) columns[stage] = [{ ...card, stage }, ...(columns[stage] || [])];
      return { ...d, columns };
    });
    try {
      await api(`/api/inbox/${phone}`, { method: 'PATCH', body: { stage } });
      showToast(`Moved to ${statusLook(list, stage).label}`);
      refreshApi('/api/inbox'); // the Inbox shows the status too
    } catch (e) {
      showToast(message(e));
      load();
    }
  };

  const total = data ? keys.reduce((n, s) => n + (data.columns[s]?.length || 0), 0) : 0;

  return (
    <div className="flex-1 overflow-hidden flex flex-col bg-slate-100">
      <div className="px-4 py-3 flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white">
        <h1 className="text-base font-bold text-slate-800 flex items-center gap-2"><Kanban className="w-5 h-5 text-wa-teal" /> Customer pipeline</h1>
        <span className="text-xs text-slate-500">{total} contacts · <span className="hidden md:inline">drag a card or </span>use its menu to change the status · tap to open the chat · 🔒 = someone else's (view only)</span>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
          <input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)} /> Only mine
        </label>
        <button onClick={() => setAdding(true)} className={btnSecondary}><UserPlus className="w-3.5 h-3.5" /> Add lead</button>
        <button onClick={load} className={btnSecondary}><RotateCw className="w-3.5 h-3.5" /> Refresh</button>
      </div>
      {adding && <AddLeadModal me={me} showToast={showToast} onClose={() => setAdding(false)} onAdded={(phone) => { setAdding(false); onOpenChat(phone); }} />}

      {error && <LoadError className="m-4" error={error} onRetry={load} />}
      {!data && !error && <SkeletonBoard label="Loading the pipeline" />}

      {data && total === 0 && (
        <div className="p-4"><EmptyState icon={Kanban} title="No contacts yet" text="New WhatsApp chats and the leads you add show here, one column per status." action={<button onClick={() => setAdding(true)} className={btnSecondary}><UserPlus className="w-3.5 h-3.5" /> Add lead</button>} /></div>
      )}
      {data && total > 0 && (
        // Phones: one status at a time (chips above); dragging is replaced by each card's "Move to" menu.
        <nav aria-label="Stages" className="md:hidden flex gap-1.5 overflow-x-auto px-3 pt-3" data-testid="stage-chips">
          {keys.map(s => {
            const n = (data.columns[s] || []).filter(c => !mine || accessOf(c, me) === 'mine').length;
            const look = statusLook(list, s);
            return (
              <button key={s} onClick={() => setPhoneStage(s)} aria-pressed={shownStage === s}
                className={`flex-shrink-0 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold cursor-pointer ${shownStage === s ? 'bg-slate-800 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>
                <span className={`w-2 h-2 rounded-full ${look.dot}`} />{look.label}<span className="opacity-70">{n}</span>
              </button>
            );
          })}
        </nav>
      )}
      {data && total > 0 && (
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex gap-3 p-3 md:p-4 h-full md:min-w-max">
            {keys.map(stage => {
              const cards = (data.columns[stage] || []).filter(c => !mine || accessOf(c, me) === 'mine');
              const look = statusLook(list, stage);
              const hidden = list.find(s => s.key === stage)?.active === false;
              return (
                <div key={stage} data-stage={stage}
                  onDragOver={e => { if (hidden) return; e.preventDefault(); setOver(stage); }}
                  onDragLeave={() => setOver(o => (o === stage ? null : o))}
                  onDrop={e => { e.preventDefault(); setOver(null); if (dragging && dragging.stage !== stage && !hidden) move(dragging.phone, stage); setDragging(null); }}
                  className={`w-full md:w-[270px] flex-shrink-0 rounded-xl flex-col max-h-full ${stage === shownStage ? 'flex' : 'hidden md:flex'} ${over === stage ? 'bg-teal-50 ring-2 ring-wa-teal' : 'bg-slate-200/60'}`}>
                  <div className="px-3 pt-3 pb-2">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${look.dot}`} />
                      <span className="text-sm font-bold text-slate-800">{look.label}</span>
                      {hidden && <span className="text-xs text-slate-500">(hidden)</span>}
                      <span className="ml-auto text-xs font-semibold text-slate-500 bg-white rounded-full px-2">{cards.length}</span>
                    </div>
                    {look.hint && <div className="text-xs text-slate-500 mt-0.5">{look.hint}</div>}
                  </div>
                  <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2">
                    {cards.map(c => {
                      const locked = accessOf(c, me) === 'other';
                      return (
                      <div key={c.phone} draggable={!locked}
                        onDragStart={() => setDragging({ phone: c.phone, stage })}
                        onDragEnd={() => setDragging(null)}
                        title={locked ? `Belongs to ${c.assigned_to}: view only` : undefined}
                        className={`bg-white rounded-lg shadow-sm border p-2.5 ${locked ? 'border-slate-200 opacity-75' : 'border-slate-200 cursor-grab active:cursor-grabbing'} ${dragging?.phone === c.phone ? 'opacity-50' : ''}`}>
                        <button onClick={() => onOpenChat(c.phone)} className="w-full text-left cursor-pointer">
                          <div className="flex items-center gap-2">
                            <div className={`w-7 h-7 rounded-full ${avatarBg(c.phone)} text-white flex items-center justify-center font-bold text-xs flex-shrink-0`}>{initials(c)}</div>
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-semibold text-slate-800 truncate">{displayName(c)}</div>
                              <ReturnedBadge contact={c} />
                              <ImportedBadge contact={c} />
                              <div className="text-xs text-slate-400">{shortTime(c.last_contacted_at)}{c.source ? ` · ${c.source}` : ''}</div>
                            </div>
                            {(c.unread_count ?? 0) > 0 && <span className="min-w-[16px] h-4 px-1 rounded-full bg-wa-green text-white text-2xs font-bold flex items-center justify-center">{c.unread_count}</span>}
                          </div>
                          <div className="text-xs text-slate-500 mt-1.5 line-clamp-2">{c.last_message}</div>
                          {/* Up to 2 customer fields (Settings -> Customer fields, "Show on Pipeline card"). */}
                          {(data.cards?.[c.phone] || []).map(x => (
                            <div key={x.label} className="text-xs text-slate-600 truncate" data-testid="card-field"><span className="text-slate-400">{x.label}:</span> {showCustomValue(x)}</div>
                          ))}
                        </button>
                        <div className="flex items-center gap-1.5 mt-2">
                          {(c.tags || []).slice(0, 2).map(t => <span key={t} className="text-2xs bg-slate-100 text-slate-600 rounded-full px-1.5">{t}</span>)}
                          {c.bot_paused && <span title="Bot paused: staff handling"><Hand className="w-3 h-3 text-amber-600" /></span>}
                          {!locked && <RenameButton onClick={() => rename(c)} label={`Rename ${displayName(c)}`} />}
                          {locked && <Lock className="w-3 h-3 text-slate-400 ml-auto" />}
                          <select value={stage} disabled={locked} onChange={e => move(c.phone, e.target.value)} onClick={e => e.stopPropagation()}
                            className={`text-xs border border-slate-200 rounded px-1 py-0.5 bg-white text-slate-600 cursor-pointer disabled:cursor-not-allowed disabled:bg-slate-50 ${locked ? '' : 'ml-auto'}`} title={locked ? 'View only' : 'Move to status'} aria-label="Move to stage">
                            {hidden && <option value={stage}>{look.label}</option>}
                            {movable.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                          </select>
                          {c.assigned_to && (
                            <span className="w-5 h-5 rounded-full bg-slate-700 text-white text-2xs font-bold flex items-center justify-center" title={`Assigned to ${c.assigned_to}`}>{emailInitials(c.assigned_to)}</span>
                          )}
                        </div>
                      </div>
                      );
                    })}
                    {cards.length === 0 && <div className="text-xs text-slate-400 text-center py-6">Nobody here</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="px-4 py-2 text-xs text-slate-500 bg-white border-t border-slate-200">
        Some moves happen automatically:
        {firstOf('working') && <> looking at a service or product in the bot → <strong>{firstOf('working')}</strong>,</>}
        {firstOf('won') && <> a booking or order request → <strong>{firstOf('won')}</strong>,</>}
        {firstOf('repeat') && <> booking again later → <strong>{firstOf('repeat')}</strong>.</>}
        {firstOf('done') && <> Move a contact to <strong>{firstOf('done')}</strong> after the visit or delivery.</>}
      </div>
    </div>
  );
}
