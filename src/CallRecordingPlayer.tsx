import { useState } from 'react';
import { Play, Loader2, AlertCircle } from 'lucide-react';
import { api, errorMessage } from './broadcastUtils';

// The recording of a WhatsApp call, under its line in the chat ("📞 WhatsApp call, 2 min 5 s").
// The audio is private: pressing Play asks the server for a 5-minute link (only for people allowed to
// listen; each playback is logged). Nothing is loaded until someone presses Play.

type State = { kind: 'idle' } | { kind: 'loading' } | { kind: 'ready'; url: string } | { kind: 'error'; message: string };

export default function CallRecordingPlayer({ callId }: { callId: string }) {
  const [state, setState] = useState<State>({ kind: 'idle' });

  const load = async () => {
    setState({ kind: 'loading' });
    try {
      const r = await api<{ url: string }>('/api/wa-calls/recording/play', { method: 'POST', body: { callId } });
      setState({ kind: 'ready', url: r.url });
    } catch (e) {
      setState({ kind: 'error', message: errorMessage(e) });
    }
  };

  if (state.kind === 'ready') {
    // The link expires after 5 minutes: if playback fails later, go back to the Play button.
    return <audio controls autoPlay src={state.url} onError={() => setState({ kind: 'idle' })} className="w-full min-w-[220px] h-8 mt-1.5" aria-label="Call recording" />;
  }
  if (state.kind === 'error') {
    return (
      <div className="mt-1.5 flex items-start gap-1 text-xs text-slate-500">
        <AlertCircle className="w-3 h-3 mt-px flex-shrink-0" /> <span>{state.message}</span>
      </div>
    );
  }
  return (
    <button onClick={load} disabled={state.kind === 'loading'}
      className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-white/80 border border-slate-200 hover:border-wa-teal hover:text-wa-teal px-2.5 py-1 text-xs font-semibold text-slate-700 cursor-pointer disabled:opacity-60">
      {state.kind === 'loading' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />} Play recording
    </button>
  );
}
