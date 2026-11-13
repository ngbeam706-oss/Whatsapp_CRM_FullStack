import { Radio, X } from 'lucide-react';
import type { ShowToast } from './types';

interface WebhookSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** From /api/status: only the Business Admin gets the address and token. */
  statusInfo?: { webhookUrl?: string; verifyToken?: string } | null;
  showToast: ShowToast;
}

/**
 * Header "Webhook" button: this business's own callback URL and verify token (Business Admin only;
 * the server sends them to the owner, even before the number is connected).
 */
export default function WebhookSetupModal({
  isOpen,
  onClose,
  statusInfo,
  showToast
}: WebhookSetupModalProps) {
  if (!isOpen) return null;

  const url = statusInfo?.webhookUrl || '';
  const token = statusInfo?.verifyToken || '';
  const copyText = (text: string, label: string) => {
    navigator.clipboard?.writeText(text).then(() => showToast(`Copied ${label}!`)).catch(() => showToast('Copy failed: select and copy it by hand'));
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-200">
        <div className="bg-wa-teal text-white px-5 py-3.5 flex items-center justify-between">
          <h3 className="font-bold text-sm flex items-center gap-2">
            <Radio className="w-4 h-4" /> Meta webhook setup
          </h3>
          <button onClick={onClose} className="text-teal-200 hover:text-white cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs text-slate-600">
          {!url || !token ? (
            <p>Only the Business Admin can see the webhook details. Ask them, or open the WhatsApp page if you are the Business Admin.</p>
          ) : (
            <>
              <p>Paste these in <strong>Meta for Developers → your app → WhatsApp → Configuration → Webhook → Edit</strong>, click <strong>Verify and save</strong>, then subscribe to <strong>messages</strong>. You can do this before connecting your number.</p>
              {[['Callback URL', url], ['Verify Token', token]].map(([label, value]) => (
                <div key={label}>
                  <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1">{label}</label>
                  <div className="flex items-center bg-slate-50 border border-slate-300 rounded-lg p-2 font-mono text-teal-800">
                    <input type="text" readOnly className="bg-transparent w-full focus:outline-none select-all text-xs" value={value} onFocus={e => e.target.select()} />
                    <button type="button" onClick={() => copyText(value, label)} className="ml-2 text-wa-teal font-sans font-bold hover:underline cursor-pointer">
                      Copy
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="bg-slate-50 px-5 py-3 border-t border-slate-200 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="bg-slate-700 hover:bg-slate-800 text-white px-4 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
