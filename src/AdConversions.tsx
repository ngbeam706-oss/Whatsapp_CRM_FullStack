import { useState } from 'react';
import { Send, CheckCircle2, AlertTriangle, Clock, ExternalLink, Save } from 'lucide-react';
import { api, errorMessage, inputCls, btnPrimary } from './broadcastUtils';
import { LoadError, SkeletonRows } from './ui';
import { useApi, refreshApi, errorOf } from './queryClient';
import type { ShowToast } from './types';

// Ads phase E1 (server/adConversions.cjs): tell Meta which chats from Click-to-WhatsApp ads became bookings, so
// it shows the ads to people likely to book. Off until the Business Admin switches it on.

interface ConversionStatus {
  settings: { enabled: boolean; bookingValue: number | null; currency: string; updatedBy: string | null; updatedAt: string | null; tableReady: boolean };
  last30: { sent: number; waiting: number; failed: number };
  lastSentAt: string | null;
  lastError: { message: string; at: string } | null;
  eventName: 'Purchase' | 'LeadSubmitted';
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '–');

export default function AdConversions({ isOwner, showToast }: { isOwner: boolean; showToast?: ShowToast }) {
  const q = useApi<ConversionStatus>('/api/ads/conversions', { staleTime: 60000 });
  const data = q.data || null;
  const error = errorOf(q);
  const [value, setValue] = useState<string | null>(null); // null = not edited
  const [busy, setBusy] = useState(false);
  const shownValue = value ?? (data?.settings.bookingValue != null ? String(data.settings.bookingValue) : '');

  const save = async (patch: { enabled?: boolean; bookingValue?: number | null }) => {
    setBusy(true);
    try {
      await api('/api/ads/conversions', { method: 'PUT', body: patch });
      await refreshApi('/api/ads/conversions');
      setValue(null);
      showToast?.(patch.enabled === undefined ? 'Booking value saved' : patch.enabled ? 'Bookings will be sent to Meta' : 'Stopped sending bookings to Meta');
    } catch (e) {
      showToast?.(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border bg-white" style={{ borderColor: 'rgba(11,11,11,0.10)' }} data-testid="ad-conversions">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-slate-100">
        <Send className="w-4 h-4 text-violet-600" />
        <span className="text-sm font-semibold text-slate-800">Send bookings to Meta</span>
        {data && (
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${data.settings.enabled ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-slate-50 border-slate-200 text-slate-600'}`} data-testid="conversions-state">
            {data.settings.enabled ? 'On' : 'Off'}
          </span>
        )}
      </div>
      <div className="p-4 space-y-4 text-xs text-slate-700">
        <p className="leading-relaxed">
          When a chat that came from a Click-to-WhatsApp ad is moved to <strong>Booked</strong>, <strong>Completed</strong> or
          {' '}<strong>Returning</strong> (by your team, on the Pipeline, or by the bot&apos;s Book / Enquire button), the CRM tells Meta
          that this ad click became a booking. Meta then learns which people book, not just chat, and shows your ads to more people
          like them. Only Meta&apos;s own ad-click id is sent: no names, phone numbers or messages.
        </p>
        {error && <LoadError error={error} onRetry={() => q.refetch()} />}
        {!data && !error && <SkeletonRows rows={3} label="Loading bookings to Meta" />}
        {data && !data.settings.tableReady && (
          <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-amber-900">This needs the database update for Ads E (SQL 20261125). Ask the platform team.</div>
        )}

        {data && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              {isOwner ? (
                <button onClick={() => save({ enabled: !data.settings.enabled })} disabled={busy || !data.settings.tableReady}
                  className={data.settings.enabled ? 'px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold hover:bg-slate-50 cursor-pointer disabled:opacity-50' : btnPrimary}>
                  {data.settings.enabled ? 'Switch off' : 'Switch on'}
                </button>
              ) : <span className="text-slate-500">Only the Business Admin switches this on or off.</span>}
              <span className="text-slate-500">
                Sent as Meta&apos;s <strong className="font-mono">{data.eventName}</strong> event
                {data.eventName === 'Purchase' ? ` worth ${data.settings.currency} ${data.settings.bookingValue}` : ' (no value)'}.
              </span>
            </div>

            <label className="block max-w-sm">
              <span className="font-semibold text-slate-700">Average booking value ({data.settings.currency}, optional)</span>
              <span className="flex gap-2 mt-1">
                <input type="number" min={1} step="1" value={shownValue} disabled={!isOwner} onChange={e => setValue(e.target.value)}
                  placeholder="e.g. 800" className={inputCls} aria-label="Average booking value" />
                {isOwner && (
                  <button onClick={() => save({ bookingValue: shownValue.trim() ? Number(shownValue) : null })} disabled={busy || value === null} className={btnPrimary}>
                    <Save className="w-3.5 h-3.5" /> Save
                  </button>
                )}
              </span>
              <span className="block text-xs text-slate-500 mt-1">
                With a value, bookings go to Meta as purchases worth this much, so Meta can aim for more valuable customers. Empty: sent as
                leads, without an amount. Use a real average; leave it empty if you&apos;re not sure.
              </span>
            </label>

            <div className="grid grid-cols-3 gap-2 max-w-md" data-testid="conversions-counts">
              <Stat icon={<CheckCircle2 className="w-4 h-4 text-emerald-600" />} label="Sent (30 days)" value={data.last30.sent} />
              <Stat icon={<Clock className="w-4 h-4 text-slate-500" />} label="Waiting" value={data.last30.waiting} />
              <Stat icon={<AlertTriangle className="w-4 h-4 text-amber-600" />} label="Not sent" value={data.last30.failed} />
            </div>
            <div className="text-xs text-slate-500">Last sent: {when(data.lastSentAt)}. Sending happens every few minutes in the background.</div>
            {data.lastError && (
              <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-amber-900" data-testid="conversions-error">
                <strong>Last problem ({when(data.lastError.at)}):</strong> {data.lastError.message}
                {/permission|access|token/i.test(data.lastError.message) && (
                  <span className="block mt-1">
                    Fix: Business settings → System users → your CRM user → Generate new token with <strong>whatsapp_business_manage_events</strong>
                    {' '}(plus the WhatsApp permissions it has now), then paste it on the WhatsApp page.
                  </span>
                )}
              </div>
            )}

            <div className="border-t border-slate-100 pt-3 space-y-1.5">
              <div className="font-semibold text-slate-700">Good to know</div>
              <ul className="list-disc pl-4 space-y-1 text-slate-600">
                <li>Only chats that started from a Click-to-WhatsApp ad are sent (other chats have no ad click to report).</li>
                <li>Each ad click is reported once, even if the chat moves between Booked, Completed and Returning.</li>
                <li>The WhatsApp access token needs Meta&apos;s <span className="font-mono">whatsapp_business_manage_events</span> permission. If it&apos;s missing, the problem shows here.</li>
                <li>See what arrived in Meta: Events Manager → your WhatsApp dataset. In Ads Manager you can then choose to optimise for these bookings.</li>
              </ul>
              <a href="https://business.facebook.com/events_manager2/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-wa-teal font-semibold hover:underline">
                Open Events Manager <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="border border-slate-200 rounded-lg px-3 py-2">
      <div className="flex items-center gap-1.5 text-xs text-slate-500">{icon}{label}</div>
      <div className="text-lg font-bold text-slate-800 tabular-nums">{value}</div>
    </div>
  );
}
