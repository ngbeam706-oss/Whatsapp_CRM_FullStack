import { useEffect, useMemo, useRef, useState } from 'react';
import { useConfirm } from './confirm';
import { Paperclip, X, Loader2, FileText, Image as ImageIcon, Music, Film, Download, CheckCircle2, Archive, RotateCcw, Settings2, Trash2, Plus, Save, Slash, Bell, BellOff } from 'lucide-react';
import { api, errorMessage, inputCls, btnPrimary, btnSecondary } from './broadcastUtils';
import { useApi, refreshApi } from './queryClient';
import { useAlertPrefs } from './inboxAlerts';
import type { ChatMessage, CloseReason, InboxContact, SavedReply, ShowToast } from './types';

// Inbox essentials (server/inboxMedia.cjs, savedReplies.cjs, inbox.cjs closeChat):
//   SavedReplies ...... the team's saved replies: chips, "/shortcut" in the reply box, managers edit them
//   AttachButton ...... send a photo / document / audio / video (browser -> private storage -> WhatsApp)
//   MessageMedia ...... show a message's file (a short-lived private link, asked for when shown)
//   CloseChat ......... close a chat with a reason; a closed chat's banner with "Reopen"

// ---------------------------------------------------------------------------
// Saved replies
// ---------------------------------------------------------------------------
/** Shown until the team adds its own (neutral, any business). */
const STARTER: SavedReply[] = [
  { id: -1, shortcut: 'hello', title: 'Hello', body: 'Hello {name}! How can we help you today?' },
  { id: -2, shortcut: 'thanks', title: 'Thank you', body: 'Thank you! Our team will get back to you shortly.' },
  { id: -3, shortcut: 'call', title: 'Best time to call', body: 'Could you share a convenient time for us to call you?' },
];
/** Fill the placeholders: {name} = the customer's first name. */
export const fillReply = (body: string, name: string) => body.replace(/\{name\}/gi, (name || '').trim().split(/\s+/)[0] || 'there');

export function useSavedReplies() {
  const q = useApi<{ replies: SavedReply[]; ready?: boolean; note?: string }>('/api/saved-replies', { staleTime: 5 * 60000 });
  const own = q.data?.replies || [];
  return { replies: own.length ? own : STARTER, own, ready: q.data?.ready !== false, note: q.data?.note || '' };
}

/** "/tim" at the start of the reply box -> the matching saved replies. */
export function slashQuery(text: string): string | null {
  const m = text.match(/^\/([a-z0-9_-]*)$/i);
  return m ? m[1].toLowerCase() : null;
}

export function SlashPicker({ text, replies, name, onPick }: { text: string; replies: SavedReply[]; name: string; onPick: (body: string) => void }) {
  const q = slashQuery(text);
  const matches = useMemo(() => (q === null ? [] : replies.filter(r => r.shortcut.startsWith(q) || r.title.toLowerCase().includes(q)).slice(0, 8)), [q, replies]);
  if (q === null) return null;
  return (
    <div className="absolute bottom-full left-0 mb-1 w-full max-w-md bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden z-10" role="listbox" aria-label="Saved replies" data-testid="slash-picker">
      {matches.length ? matches.map(r => (
        <button key={r.id} type="button" role="option" aria-selected="false" onMouseDown={e => { e.preventDefault(); onPick(fillReply(r.body, name)); }}
          className="w-full text-left px-3 py-1.5 hover:bg-slate-50 cursor-pointer">
          <span className="text-xs font-mono text-wa-teal font-semibold">/{r.shortcut}</span> <span className="text-xs font-semibold text-slate-700">{r.title}</span>
          <span className="block text-xs text-slate-500 truncate">{r.body}</span>
        </button>
      )) : <div className="px-3 py-2 text-xs text-slate-500">No saved reply starts with “/{q}”.</div>}
    </div>
  );
}

export function SavedReplyChips({ replies, name, canManage, onPick, onManage }: { replies: SavedReply[]; name: string; canManage: boolean; onPick: (body: string) => void; onManage: () => void }) {
  return (
    <>
      {replies.slice(0, 6).map(r => (
        <button key={r.id} type="button" onClick={() => onPick(fillReply(r.body, name))} title={`/${r.shortcut}: ${r.body}`}
          className="bg-white hover:bg-slate-200 border border-slate-200 px-2 py-0.5 rounded-full text-slate-700 whitespace-nowrap cursor-pointer">{r.title}</button>
      ))}
      <span className="text-slate-400 whitespace-nowrap flex items-center gap-0.5" title="Type / in the reply box to pick a saved reply"><Slash className="w-3 h-3" />shortcuts</span>
      {canManage && <button type="button" onClick={onManage} className="text-slate-500 hover:text-wa-teal cursor-pointer whitespace-nowrap flex items-center gap-0.5" data-testid="manage-saved-replies"><Settings2 className="w-3 h-3" /> Edit</button>}
    </>
  );
}

/** Business Admin / managers: the team's saved replies. */
export function SavedRepliesManager({ onClose, showToast }: { onClose: () => void; showToast: ShowToast }) {
  const confirm = useConfirm();
  const { own, ready, note } = useSavedReplies();
  const [edit, setEdit] = useState<Partial<SavedReply> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    if (!edit) return;
    setBusy(true); setErr('');
    try {
      const body = { shortcut: edit.shortcut, title: edit.title, body: edit.body };
      if (edit.id && edit.id > 0) await api(`/api/saved-replies/${edit.id}`, { method: 'PUT', body });
      else await api('/api/saved-replies', { method: 'POST', body });
      await refreshApi('/api/saved-replies');
      showToast('Saved reply saved');
      setEdit(null);
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  const remove = async (r: SavedReply) => {
    if (!await confirm(`Delete "/${r.shortcut}"?`)) return;
    try { await api(`/api/saved-replies/${r.id}`, { method: 'DELETE' }); await refreshApi('/api/saved-replies'); showToast('Deleted'); } catch (e) { showToast(errorMessage(e)); }
  };
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label="Saved replies">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-800">Saved replies</h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 overflow-y-auto space-y-3 text-xs">
          <p className="text-slate-600">Your team picks these in any chat (or types <code>/shortcut</code>). <code>{'{name}'}</code> becomes the customer&apos;s first name. Don&apos;t promise results or prices you can&apos;t keep.</p>
          {!ready && <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg text-amber-900">{note}</div>}
          <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
            {own.map(r => (
              <li key={r.id} className="px-3 py-2 flex items-start gap-2">
                <div className="min-w-0 flex-1"><span className="font-mono text-wa-teal font-semibold">/{r.shortcut}</span> <span className="font-semibold text-slate-800">{r.title}</span><p className="text-slate-500 whitespace-pre-wrap line-clamp-2">{r.body}</p></div>
                <button onClick={() => setEdit(r)} className={btnSecondary}>Edit</button>
                <button onClick={() => remove(r)} className="p-1.5 text-slate-400 hover:text-red-600 cursor-pointer" aria-label={`Delete /${r.shortcut}`}><Trash2 className="w-3.5 h-3.5" /></button>
              </li>
            ))}
            {!own.length && <li className="px-3 py-3 text-slate-500">None yet: the team sees three simple starters until you add your own.</li>}
          </ul>
          {edit ? (
            <div className="border border-slate-200 rounded-lg p-3 space-y-2" data-testid="saved-reply-form">
              <div className="grid grid-cols-[140px_1fr] gap-2">
                <label className="block">Shortcut<input value={edit.shortcut || ''} onChange={e => setEdit({ ...edit, shortcut: e.target.value })} maxLength={30} placeholder="timings" className={`${inputCls} mt-1 font-mono`} aria-label="Shortcut" /></label>
                <label className="block">Title<input value={edit.title || ''} onChange={e => setEdit({ ...edit, title: e.target.value })} maxLength={60} placeholder="Clinic timings" className={`${inputCls} mt-1`} aria-label="Title" /></label>
              </div>
              <label className="block">Reply<textarea rows={4} value={edit.body || ''} onChange={e => setEdit({ ...edit, body: e.target.value })} maxLength={1000} placeholder="Hi {name}, we are open Mon–Sat 9 am to 8 pm." className={`${inputCls} mt-1`} aria-label="Reply" /></label>
              {err && <div role="alert" className="p-2 bg-red-50 border border-red-200 rounded-lg text-red-700">{err}</div>}
              <div className="flex gap-2"><button onClick={save} disabled={busy} className={btnPrimary}><Save className="w-3.5 h-3.5" /> {busy ? 'Saving…' : 'Save'}</button><button onClick={() => { setEdit(null); setErr(''); }} className={btnSecondary}>Cancel</button></div>
            </div>
          ) : (
            <button onClick={() => setEdit({ shortcut: '', title: '', body: '' })} disabled={!ready} className={btnPrimary}><Plus className="w-3.5 h-3.5" /> Add a saved reply</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Attach: send a file
// ---------------------------------------------------------------------------
const ACCEPT = 'image/jpeg,image/png,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,audio/mpeg,audio/mp4,audio/aac,audio/ogg,video/mp4';
const MB = 1024 * 1024;
export function fileProblem(f: File): string {
  if (!ACCEPT.split(',').includes(f.type)) return 'Send a photo (JPG, PNG), a PDF / Word / Excel / text document, an audio file (MP3, M4A, AAC, OGG) or an MP4 video.';
  if (f.type.startsWith('image/') && f.size > 5 * MB) return 'Photos can be up to 5 MB on WhatsApp.';
  if (f.size > 16 * MB) return 'Files can be up to 16 MB on WhatsApp.';
  if (!f.size) return 'That file is empty.';
  return '';
}

export function AttachButton({ phone, fromNumberId, onSent, showToast }: { phone: string; fromNumberId: string | null; onSent: () => void; showToast: ShowToast }) {
  const ref = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [caption, setCaption] = useState('');
  const [step, setStep] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const pick = (f: File | undefined) => {
    if (ref.current) ref.current.value = '';
    if (!f) return;
    const p = fileProblem(f);
    if (p) { showToast(p); return; }
    setFile(f); setErr(''); setCaption('');
    setPreview(f.type.startsWith('image/') ? URL.createObjectURL(f) : '');
  };
  const close = () => { setFile(null); setPreview(''); setStep(''); setErr(''); };
  const send = async () => {
    if (!file) return;
    setErr('');
    try {
      setStep('Uploading…');
      const u = await api<{ uploadUrl: string; path: string }>(`/api/inbox/${phone}/media/upload-url`, { method: 'POST', body: { type: file.type, size: file.size } });
      const form = new FormData();
      form.append('cacheControl', '3600');
      form.append('', file);
      const up = await fetch(u.uploadUrl, { method: 'PUT', headers: { 'x-upsert': 'true' }, body: form });
      if (!up.ok) throw new Error(`The upload failed (${up.status}). Try again.`);
      setStep('Sending on WhatsApp…');
      await api(`/api/inbox/${phone}/media`, { method: 'POST', body: { path: u.path, caption: caption.trim(), name: file.name, ...(fromNumberId ? { fromNumberId } : {}) } });
      close();
      onSent();
      showToast('Sent');
    } catch (e) { setErr(errorMessage(e)); setStep(''); }
  };
  const Icon = !file ? FileText : file.type.startsWith('image/') ? ImageIcon : file.type.startsWith('audio/') ? Music : file.type.startsWith('video/') ? Film : FileText;
  return (
    <>
      <button type="button" onClick={() => ref.current?.click()} className="w-10 h-10 rounded-full bg-white border border-slate-300 text-slate-600 hover:text-wa-teal flex items-center justify-center flex-shrink-0 cursor-pointer" title="Send a photo, document, audio or video" aria-label="Attach a file" data-testid="attach-button">
        <Paperclip className="w-4 h-4" />
      </button>
      <input ref={ref} type="file" accept={ACCEPT} className="hidden" onChange={e => pick(e.target.files?.[0])} data-testid="attach-input" />
      {file && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label="Send a file">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-4 space-y-3 text-xs">
            <div className="flex items-center justify-between"><h3 className="text-sm font-bold text-slate-800">Send a file</h3><button onClick={close} disabled={!!step} className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer" aria-label="Close"><X className="w-4 h-4" /></button></div>
            {preview ? <img src={preview} alt="The photo to send" className="max-h-64 mx-auto rounded-lg" /> : (
              <div className="flex items-center gap-2 p-3 bg-slate-50 border border-slate-200 rounded-lg"><Icon className="w-6 h-6 text-slate-500" /><div className="min-w-0"><div className="font-semibold text-slate-800 truncate">{file.name}</div><div className="text-slate-500">{(file.size / MB).toFixed(1)} MB</div></div></div>
            )}
            {!file.type.startsWith('audio/') && (
              <label className="block text-slate-600">Caption (optional)<textarea rows={2} value={caption} onChange={e => setCaption(e.target.value)} maxLength={1024} className={`${inputCls} mt-1`} aria-label="Caption" /></label>
            )}
            {err && <div role="alert" className="p-2 bg-red-50 border border-red-200 rounded-lg text-red-700">{err}</div>}
            <div className="flex items-center gap-2">
              <button onClick={send} disabled={!!step} className={btnPrimary} data-testid="attach-send">{step ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {step}</> : 'Send'}</button>
              <span className="text-xs text-slate-500">Within the 24-hour window only, like any reply.</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// A message's file
// ---------------------------------------------------------------------------
const MEDIA_TYPES = ['image', 'document', 'audio', 'video', 'sticker'];
export const hasMedia = (m: ChatMessage) => !!m.message_id && (MEDIA_TYPES.includes(String(m.type)) || !!m.media_mime);
/** The server's automatic label for a file without a caption (server/webhook.cjs MEDIA_LABEL, inboxMedia.cjs). */
export const isMediaLabel = (body?: string | null) => !body || /^(📷 Photo|📄 .*|🎤 Voice note|🎵 Audio|🎬 Video|Sticker)$/u.test(body);

export function MessageMedia({ phone, m }: { phone: string; m: ChatMessage }) {
  const [link, setLink] = useState<{ url: string; downloadUrl: string; mime: string | null; name: string } | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const kind = m.media_mime?.startsWith('image/') || m.type === 'image' || m.type === 'sticker' ? 'image'
    : m.media_mime?.startsWith('audio/') || m.type === 'audio' ? 'audio' : m.media_mime?.startsWith('video/') || m.type === 'video' ? 'video' : 'document';
  const load = async () => {
    setBusy(true); setErr('');
    try { setLink(await api(`/api/inbox/${phone}/media?id=${encodeURIComponent(String(m.message_id))}`)); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  // Photos load by themselves (small); audio, video and documents when asked (they may be large).
  useEffect(() => { if (kind === 'image' && !link && !err) void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <p className="text-xs text-red-700 mt-1" data-testid="media-error">{err}</p>;
  if (!link) {
    return (
      <button type="button" onClick={load} disabled={busy} className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-wa-teal hover:underline cursor-pointer" data-testid="media-open">
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : kind === 'audio' ? <Music className="w-3.5 h-3.5" /> : kind === 'video' ? <Film className="w-3.5 h-3.5" /> : kind === 'image' ? <ImageIcon className="w-3.5 h-3.5" /> : <FileText className="w-3.5 h-3.5" />}
        {busy ? 'Opening…' : kind === 'audio' ? 'Play' : kind === 'video' ? 'Play video' : kind === 'image' ? 'Show photo' : `Open ${m.media_name || 'document'}`}
      </button>
    );
  }
  return (
    <div className="mt-1" data-testid="media">
      {kind === 'image' && <a href={link.url} target="_blank" rel="noreferrer"><img src={link.url} alt={m.body || 'Photo'} className="rounded-lg max-h-64 max-w-full" /></a>}
      {kind === 'audio' && <audio controls src={link.url} className="w-full h-8" />}
      {kind === 'video' && <video controls src={link.url} className="rounded-lg max-h-64 max-w-full" />}
      {kind === 'document' && <a href={link.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 p-2 rounded-lg bg-white/70 border border-slate-200 text-slate-800 hover:underline"><FileText className="w-4 h-4 text-slate-500" /> {link.name}</a>}
      <a href={link.downloadUrl} className="mt-0.5 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-wa-teal"><Download className="w-3 h-3" /> Download</a>
    </div>
  );
}

// ---------------------------------------------------------------------------
// New-chat alerts: this person's settings (src/inboxAlerts.ts)
// ---------------------------------------------------------------------------
export function AlertBell() {
  const [p, save] = useAlertPrefs();
  const [open, setOpen] = useState(false);
  const supported = typeof window !== 'undefined' && 'Notification' in window;
  const permission = supported ? Notification.permission : 'denied';
  const setDesktop = async (on: boolean) => {
    if (!on) { save({ ...p, desktop: false }); return; }
    const res = permission === 'granted' ? 'granted' : await Notification.requestPermission();
    save({ ...p, desktop: res === 'granted', on: true });
  };
  const Icon = p.on ? Bell : BellOff;
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(o => !o)} className={`${btnSecondary} px-2`} title="New-chat alerts" aria-label="New-chat alerts" data-testid="alert-bell">
        <Icon className={`w-3.5 h-3.5 ${p.on ? 'text-wa-teal' : 'text-slate-400'}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-64 bg-white border border-slate-200 rounded-lg shadow-lg p-3 z-20 space-y-2 text-xs" role="dialog" aria-label="New-chat alerts">
          <div className="font-semibold text-slate-800">Alerts for new chats</div>
          <p className="text-xs text-slate-500">For unassigned chats and chats assigned to you, while the CRM is open in a tab.</p>
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={p.on} onChange={e => save({ ...p, on: e.target.checked })} /> Alerts on</label>
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={p.sound} disabled={!p.on} onChange={e => save({ ...p, sound: e.target.checked })} /> Sound</label>
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={p.desktop && permission === 'granted'} disabled={!p.on || !supported || permission === 'denied'} onChange={e => void setDesktop(e.target.checked)} /> Desktop notification when the tab is in the background</label>
          {permission === 'denied' && <p className="text-xs text-amber-800">The browser blocks notifications for this site: allow them in the address bar&apos;s site settings.</p>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Closing a chat
// ---------------------------------------------------------------------------
export const CLOSE_REASONS: Array<[CloseReason, string]> = [
  ['booked', 'Booked / ordered'],
  ['resolved', 'Question answered / solved'],
  ['not_interested', 'Not interested'],
  ['no_response', 'No response'],
  ['spam', 'Spam / wrong number'],
  ['other', 'Other'],
];
export const closeReasonLabel = (r?: string | null) => CLOSE_REASONS.find(([k]) => k === r)?.[1] || 'Done';

export function CloseChatButton({ c, disabled, onDone, showToast }: { c: InboxContact; disabled: boolean; onDone: () => void; showToast: ShowToast }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<CloseReason>('resolved');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  if (c.closed_at) return null;
  const close = async () => {
    setBusy(true);
    try {
      await api(`/api/inbox/${c.phone}/close`, { method: 'POST', body: { reason, note: note.trim() } });
      showToast(`Marked done: ${closeReasonLabel(reason)}`);
      setOpen(false); setNote('');
      onDone();
    } catch (e) { showToast(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} disabled={disabled} className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-600 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed" title="Mark this chat done (with a reason)" aria-label="Mark done" data-testid="close-chat">
        <Archive className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-64 bg-white border border-slate-200 rounded-lg shadow-lg p-3 z-20 space-y-2 text-xs" role="dialog" aria-label="Mark this chat done">
          <div className="font-semibold text-slate-800">Mark this chat done: why?</div>
          {CLOSE_REASONS.map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 cursor-pointer"><input type="radio" name="close-reason" checked={reason === k} onChange={() => setReason(k)} /> {label}</label>
          ))}
          <input value={note} onChange={e => setNote(e.target.value)} maxLength={300} placeholder="Note (optional)" className={inputCls} aria-label="Close note" />
          <div className="flex gap-2"><button onClick={close} disabled={busy} className={btnPrimary}>{busy ? 'Saving…' : 'Mark done'}</button><button onClick={() => setOpen(false)} className={btnSecondary}>Cancel</button></div>
          <p className="text-xs text-slate-500">It moves to “Done”. If the customer writes again (or you reply), it comes back. The pipeline stage doesn&apos;t change.</p>
        </div>
      )}
    </div>
  );
}

export function ClosedBanner({ c, canAct, onDone, showToast }: { c: InboxContact; canAct: boolean; onDone: () => void; showToast: ShowToast }) {
  const [busy, setBusy] = useState(false);
  if (!c.closed_at) return null;
  const reopen = async () => {
    setBusy(true);
    try { await api(`/api/inbox/${c.phone}/reopen`, { method: 'POST' }); showToast('Back in the open chats'); onDone(); } catch (e) { showToast(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 bg-slate-100 border-b border-slate-200 px-3 py-1.5 text-xs text-slate-700" data-testid="closed-banner">
      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
      <span>Done: <strong>{closeReasonLabel(c.closed_reason)}</strong>{c.closed_by ? ` by ${c.closed_by}` : ''} · {new Date(c.closed_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}{c.close_note ? ` · “${c.close_note}”` : ''}</span>
      {canAct && <button onClick={reopen} disabled={busy} className="ml-auto flex items-center gap-1 font-semibold text-wa-teal hover:underline cursor-pointer"><RotateCcw className="w-3 h-3" /> Reopen</button>}
    </div>
  );
}
