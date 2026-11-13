import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { api, errorMessage } from './broadcastUtils';
import { useApi, refreshApi, setApiData } from './queryClient';
import type { Role, ShowToast } from './types';

/** The AI provider as the dashboard may see it (server/ai.cjs providerStatus): never the key itself. */
export interface AiProviderStatus {
  configured: boolean; provider: string; providerLabel: string; model: string; baseUrl: string;
  keyLast4: string | null; keyUnreadable: boolean; updatedBy: string | null; tableMissing: boolean; encryptionReady: boolean;
  providers: Array<{ id: string; label: string; defaultModel: string }>;
}
/** GET /api/ai/settings (shared by this switch and the AI page). */
export interface AiSettingsResponse {
  settings: { auto_reply?: boolean; knowledge?: string; instructions?: string; updated_by?: string | null; business_name?: string };
  status: AiProviderStatus;
  role: Role;
}

// One "AI replies" switch, shown in the header and at the top of the AI page.
// On:  the AI answers every message the customer types (button taps still use the flow).
// Off: only the bot flow and keyword replies are sent.
// Both copies read the same cached /api/ai/settings, so they always agree.
const FAILED = { on: false, configured: false, isOwner: false, failed: true };

export default function AiModeToggle({ variant = 'header', showToast }: { variant?: 'header' | 'card'; showToast?: ShowToast }) {
  const [saving, setSaving] = useState(false);
  const settings = useApi<AiSettingsResponse>('/api/ai/settings');
  const d = settings.data;
  const state = d
    ? { on: !!d.settings?.auto_reply, configured: !!d.status?.configured, isOwner: d.role === 'owner' || d.role === 'manager' }
    : settings.error ? FAILED : null;

  if (!state) return null;
  const { on, configured, isOwner } = state;
  const disabled = !isOwner || saving || (!on && !configured);
  const why = !isOwner ? 'Only the Business Admin or a manager can change this' : !configured && !on ? 'Connect an AI provider on the AI page first' : '';

  const toggle = async () => {
    if (disabled) return;
    const next = !on;
    setSaving(true);
    try {
      await api('/api/ai/settings', { method: 'PUT', body: { autoReply: next } });
      // Both switches update at once from the cache; then confirm with the server.
      setApiData<AiSettingsResponse>('/api/ai/settings', old => (old ? { ...old, settings: { ...old.settings, auto_reply: next } } : old));
      refreshApi('/api/ai/settings');
      showToast?.(next ? 'AI replies are ON: the AI answers typed messages' : 'AI replies are OFF: the bot flow answers');
    } catch (e) {
      showToast?.(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const knob = (
    <span role="switch" aria-checked={on}
      className={`w-9 h-5 rounded-full relative transition flex-shrink-0 ${on ? 'bg-violet-500' : 'bg-slate-400'}`}>
      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
    </span>
  );

  if (variant === 'header' && !isOwner && d) {
    // Agents: just which mode is answering customers (only managers and the Business Admin switch it).
    return (
      <span title={on ? 'The AI is answering typed messages' : 'The bot flow is answering'}
        className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap ${on ? 'bg-violet-600/90 text-white' : 'bg-teal-800/70 text-teal-50'}`}>
        <Sparkles className="w-3.5 h-3.5" /> AI {on ? 'on' : 'off'}
      </span>
    );
  }

  if (variant === 'header') {
    return (
      <button onClick={toggle} disabled={disabled} title={why || (on ? 'AI is answering typed messages. Click to switch to the bot flow.' : 'The bot flow is answering. Click to let the AI answer.')}
        className={`flex items-center gap-1.5 px-2 py-1 rounded border transition cursor-pointer disabled:cursor-not-allowed ${on ? 'bg-violet-600/90 border-violet-300/50 text-white' : 'bg-teal-800/90 border-teal-500/40 text-teal-100'} ${disabled ? 'opacity-70' : 'hover:brightness-110'}`}>
        <Sparkles className="w-3.5 h-3.5" />
        <span className="text-xs font-semibold whitespace-nowrap">AI {on ? 'ON' : 'OFF'}</span>
        {knob}
      </button>
    );
  }

  return (
    <section className={`border rounded-xl p-4 flex flex-wrap items-center gap-3 ${on ? 'bg-violet-50 border-violet-200' : 'bg-white border-slate-200'}`}>
      <div className="flex-1 min-w-[240px]">
        <div className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
          <Sparkles className="w-4 h-4 text-violet-600" /> AI replies: {on ? 'ON' : 'OFF'}
        </div>
        <div className="text-xs text-slate-600 mt-0.5">
          {on
            ? 'The AI answers every message customers type, using your menu, keyword replies, bot flow messages and the information below. Menu button taps still follow your bot flow. Each AI reply has "Main menu" and "Connect with staff" buttons.'
            : 'Customers get your bot flow and keyword replies only. Staff can still use "Suggest reply" in the inbox.'}
        </div>
        {why && <div className="text-xs text-amber-700 mt-1">{why}</div>}
      </div>
      <button onClick={toggle} disabled={disabled} className="cursor-pointer disabled:cursor-not-allowed disabled:opacity-50" aria-label="AI replies">
        <span className="scale-125 inline-block">{knob}</span>
      </button>
    </section>
  );
}
