import { useEffect, useRef, useState } from 'react';
import { Phone, PhoneOff, Mic, MicOff, PhoneIncoming } from 'lucide-react';
import { api, errorMessage } from './broadcastUtils';
import { startRingtone, stopRingtone, playChime } from './webrtcCallManager';
import { waCallEvents, WhatsAppCallSession, CallRecorder, type WaCallEvent } from './whatsappCall';
import type { ShowToast } from './types';
import { useBusinessNumbers, numberName, findNumber } from './inboxNumbers';

// Incoming WhatsApp voice calls (customer pressed the call button in WhatsApp), shown at the bottom
// right of the dashboard for every staff member of the business. Accept / Decline follow the chat's
// ownership rules on the server (server/waCalls.cjs).

/** numberId: which of the business's WhatsApp numbers was called (several numbers per business). */
interface Ringing { callId: string; phone: string; name: string; at: number; numberId?: string | null }
interface Active { callId: string; phone: string; name: string; state: 'connecting' | 'live'; startedAt: number | null; muted: boolean; recording?: boolean }

const RING_MS = 60 * 1000;      // Meta gives 30-60 s to answer
const CONNECT_WAIT_MS = 8000;   // after pre_accept, how long to wait for the audio link before accepting
const fmtTime = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export default function WhatsAppCallPanel({ showToast }: { showToast: ShowToast }) {
  const [ringing, setRinging] = useState<Ringing[]>([]);
  const [active, setActive] = useState<Active | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const numbers = useBusinessNumbers();
  const session = useRef<WhatsAppCallSession | null>(null);
  const activeId = useRef<string | null>(null);
  const claiming = useRef<string | null>(null);
  const recorder = useRef<CallRecorder | null>(null);

  const removeRinging = (callId: string) => setRinging(list => list.filter(r => r.callId !== callId));
  const endLocal = (message?: string) => {
    // Finish the recording first (it needs the audio graph), then close the call.
    const rec = recorder.current;
    recorder.current = null;
    if (rec) {
      void rec.finish().then(ok => { if (ok) showToast('Call recording saved to the chat'); });
    }
    session.current?.close();
    session.current = null;
    activeId.current = null;
    setActive(null);
    playChime('disconnect');
    if (message) showToast(message);
  };

  // Calls already ringing when the page opens, then live events from the business's channel.
  useEffect(() => {
    api<{ calls?: Array<{ callId: string; phone: string; name: string; since: string; numberId?: string | null }> }>('/api/wa-calls/ringing')
      .then(r => setRinging(list => {
        const known = new Set(list.map(x => x.callId));
        return [...list, ...(r.calls || []).filter(c => !known.has(c.callId)).map(c => ({ callId: c.callId, phone: c.phone, name: c.name, at: Date.parse(c.since) || Date.now(), numberId: c.numberId || null }))];
      }))
      .catch(() => { /* no calls table yet, or offline: live events still work */ });

    const onRing = (e: Event) => {
      const d = (e as CustomEvent<WaCallEvent>).detail;
      if (d.callId === activeId.current) return;
      setRinging(list => (list.some(r => r.callId === d.callId) ? list : [...list, { callId: d.callId, phone: d.phone || '', name: d.name || (d.phone ? `+${d.phone}` : 'Customer'), at: Date.now(), numberId: d.numberId || null }]));
    };
    const onTaken = (e: Event) => {
      const d = (e as CustomEvent<WaCallEvent>).detail;
      if (d.callId !== claiming.current) setRinging(list => list.filter(r => r.callId !== d.callId));
    };
    const onEnd = (e: Event) => {
      const d = (e as CustomEvent<WaCallEvent>).detail;
      setRinging(list => list.filter(r => r.callId !== d.callId));
      if (d.callId === activeId.current) endLocal('The call has ended.');
    };
    waCallEvents.addEventListener('wa_call', onRing);
    waCallEvents.addEventListener('wa_call_taken', onTaken);
    waCallEvents.addEventListener('wa_call_end', onEnd);
    return () => {
      waCallEvents.removeEventListener('wa_call', onRing);
      waCallEvents.removeEventListener('wa_call_taken', onTaken);
      waCallEvents.removeEventListener('wa_call_end', onEnd);
    };
    // endLocal only uses refs and stable setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A clock for the call timer and for dropping calls that rang too long ago.
  const visible = ringing.filter(r => now - r.at < RING_MS);
  const ticking = visible.length > 0 || active !== null;
  useEffect(() => {
    if (!ticking) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ticking]);

  // The ringtone plays while a call is ringing and nobody here is on a call.
  const shouldRing = visible.length > 0 && !active;
  useEffect(() => {
    if (shouldRing) startRingtone(); else stopRingtone();
    return () => stopRingtone();
  }, [shouldRing]);

  // Leaving the page ends the call cleanly on this side.
  useEffect(() => () => session.current?.close(), []);

  const accept = async (c: Ringing) => {
    if (active) return;
    setBusy(c.callId);
    claiming.current = c.callId;
    try {
      const r = await api<{ offer: string; name: string; phone: string }>('/api/wa-calls/claim', { method: 'POST', body: { callId: c.callId } });
      removeRinging(c.callId);
      const s = new WhatsAppCallSession();
      session.current = s;
      activeId.current = c.callId;
      setActive({ callId: c.callId, phone: r.phone || c.phone, name: r.name || c.name, state: 'connecting', startedAt: null, muted: false });
      let answer: string;
      try {
        answer = await s.answer(r.offer);
      } catch (micErr) {
        // Microphone blocked or no device: give the call back so a colleague can take it.
        s.close(); session.current = null; activeId.current = null; setActive(null);
        await api('/api/wa-calls/release', { method: 'POST', body: { callId: c.callId } }).catch(() => {});
        showToast(micErr instanceof DOMException && micErr.name === 'NotAllowedError'
          ? 'Allow the microphone for this site (lock icon in the address bar), then accept again.'
          : `Could not start the call: ${errorMessage(micErr)}`);
        return;
      }
      s.onDropped = () => {
        if (activeId.current !== c.callId) return;
        void api('/api/wa-calls/hangup', { method: 'POST', body: { callId: c.callId } }).catch(() => {});
        endLocal('The call connection dropped.');
      };
      // Meta's order: pre_accept with the answer, wait for the audio link, then accept, then unmute.
      await api('/api/wa-calls/accept', { method: 'POST', body: { callId: c.callId, sdp: answer } });
      await s.waitConnected(CONNECT_WAIT_MS); // accept anyway after the wait: Meta may still connect
      if (activeId.current !== c.callId) return; // hung up or ended meanwhile
      await api('/api/wa-calls/connect', { method: 'POST', body: { callId: c.callId } });
      s.setMuted(false);
      playChime('connect');
      // Record both sides (saved privately; playable from the chat).
      let recording = false;
      if (CallRecorder.supported() && s.micStream) {
        const rec = new CallRecorder(c.callId, api);
        rec.start(s.micStream, s.remoteStream);
        s.onRemoteStream = (stream) => rec.addRemote(stream);
        recorder.current = rec;
        recording = !rec.failed;
      }
      setActive(a => (a && a.callId === c.callId ? { ...a, state: 'live', startedAt: Date.now(), muted: false, recording } : a));
    } catch (e) {
      if (activeId.current === c.callId) { session.current?.close(); session.current = null; activeId.current = null; setActive(null); }
      removeRinging(c.callId);
      showToast(errorMessage(e));
    } finally {
      claiming.current = null;
      setBusy(null);
    }
  };

  const decline = async (c: Ringing) => {
    setBusy(c.callId);
    try {
      await api('/api/wa-calls/hangup', { method: 'POST', body: { callId: c.callId } });
      removeRinging(c.callId);
    } catch (e) {
      showToast(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const hangUp = async () => {
    if (!active) return;
    const id = active.callId;
    endLocal();
    try { await api('/api/wa-calls/hangup', { method: 'POST', body: { callId: id } }); } catch (e) { showToast(errorMessage(e)); }
  };

  const toggleMute = () => {
    if (!active) return;
    session.current?.setMuted(!active.muted);
    setActive({ ...active, muted: !active.muted });
  };

  if (!active && visible.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 space-y-2" aria-live="polite">
      {active && (
        <div className="rounded-2xl shadow-2xl bg-slate-900 text-white p-4" role="dialog" aria-label="WhatsApp call">
          <div className="text-xs uppercase tracking-wider text-emerald-300 font-semibold flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${active.state === 'live' ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
            {active.state === 'live' ? 'WhatsApp call' : 'Connecting…'}
          </div>
          <div className="mt-1 text-base font-bold truncate">{active.name}</div>
          <div className="text-xs text-slate-400">+{active.phone}</div>
          <div className="flex items-center justify-between mt-2">
            <div className="text-2xl font-mono tabular-nums">{active.startedAt ? fmtTime(now - active.startedAt) : '–:––'}</div>
            {active.recording && (
              <span className="flex items-center gap-1 text-xs font-bold text-red-300" title="Both sides are recorded and saved to the chat">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> REC
              </span>
            )}
          </div>
          {active.recording && <div className="text-xs text-slate-400 mt-1">Recorded. Please tell the caller: "This call is recorded for quality."</div>}
          <div className="flex gap-2 mt-3">
            <button onClick={toggleMute} disabled={active.state !== 'live'} aria-pressed={active.muted}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-slate-700 hover:bg-slate-600 disabled:opacity-40 py-2 text-xs font-semibold cursor-pointer">
              {active.muted ? <><MicOff className="w-4 h-4" /> Unmute</> : <><Mic className="w-4 h-4" /> Mute</>}
            </button>
            <button onClick={hangUp} className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-red-600 hover:bg-red-700 py-2 text-xs font-semibold cursor-pointer">
              <PhoneOff className="w-4 h-4" /> Hang up
            </button>
          </div>
        </div>
      )}
      {visible.map(c => (
        <div key={c.callId} className="rounded-2xl shadow-2xl bg-white border border-emerald-200 p-4" role="alertdialog" aria-label={`Incoming WhatsApp call from ${c.name}`}>
          <div className="text-xs uppercase tracking-wider text-emerald-700 font-semibold flex items-center gap-1.5">
            <PhoneIncoming className="w-3.5 h-3.5 animate-pulse" /> Incoming WhatsApp call
          </div>
          <div className="mt-1 text-base font-bold text-slate-800 truncate">{c.name}</div>
          <div className="text-xs text-slate-500">+{c.phone} · ringing {fmtTime(now - c.at)}</div>
          {numbers.length > 1 && (
            <div className="text-xs text-sky-800 font-semibold mt-0.5" data-testid="call-number">📱 Called {numberName(findNumber(numbers, c.numberId))}</div>
          )}
          <div className="flex gap-2 mt-3">
            <button onClick={() => decline(c)} disabled={busy === c.callId}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 py-2 text-xs font-semibold cursor-pointer disabled:opacity-50">
              <PhoneOff className="w-4 h-4" /> Decline
            </button>
            <button onClick={() => accept(c)} disabled={busy === c.callId || !!active}
              title={active ? 'Hang up your current call first' : ''}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white py-2 text-xs font-semibold cursor-pointer disabled:opacity-50">
              <Phone className="w-4 h-4" /> {busy === c.callId ? 'Connecting…' : 'Accept'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
