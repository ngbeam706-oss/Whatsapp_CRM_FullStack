import { useState, type FormEvent } from 'react';
import { api, errorMessage, inputCls } from './broadcastUtils';
import { refreshApi, useApi } from './queryClient';
import { BUTTON, Modal } from './ui';
import { canManage } from './crmUtils';
import { useLeadStatuses } from './leadStatuses';
import { useFilterOptions } from './leadFilterUtils';
import type { InboxContact, Me, ShowToast, TeamResponse } from './types';

const FALLBACK_SOURCES = ['Phone call', 'Walk-in', 'Referral', 'Website form', 'Other'];

/**
 * "+ Add lead" (a phone call, a walk-in, a referral…), for every role. Nothing is sent on WhatsApp: to start a
 * WhatsApp chat later, staff use "Send template" (the 24-hour rule). An existing number opens that lead instead.
 * Agents add leads for themselves; managers and the Business Admin can assign anyone in the team (the server checks).
 */
export default function AddLeadModal({ me, onClose, onAdded, showToast }: { me: Me; onClose: () => void; onAdded: (phone: string) => void; showToast: ShowToast }) {
  const isManager = canManage(me.role);
  const statuses = useLeadStatuses();
  const sources = useFilterOptions()?.addSources || FALLBACK_SOURCES;
  const staff = useApi<TeamResponse>('/api/team', { enabled: isManager }).data?.staff || [];
  const firstNew = statuses.active.find(s => s.type === 'new')?.key || 'new';
  const [form, setForm] = useState({ phone: '', name: '', source: 'Phone call', status: '', tags: '', note: '', assignedTo: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm(f => ({ ...f, ...patch }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const phone = form.phone.replace(/[^\d]/g, '');
    if (!/^\d{7,15}$/.test(phone)) { setError('Enter the number with country code, digits only, e.g. 919876543210.'); return; }
    setBusy(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        phone, name: form.name.trim(), source: form.source, status: form.status || firstNew,
        tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
        ...(form.note.trim() ? { note: form.note.trim() } : {}),
        ...(isManager ? { assignedTo: form.assignedTo || null } : {}),
      };
      const r = await api<{ contact: InboxContact; existed?: boolean; optedOut?: boolean }>('/api/inbox/start', { method: 'POST', body });
      showToast(r.existed ? 'That number is already a lead: opened it.' : r.optedOut ? 'Lead added. This number replied STOP before, so it stays opted out of offers.' : 'Lead added.');
      await Promise.all([refreshApi('/api/inbox'), refreshApi('/api/pipeline')]);
      onAdded(r.contact?.phone || phone);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Add a lead" onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} className={BUTTON.secondary}>Cancel</button>
        <button type="submit" form="add-lead-form" disabled={busy} className={BUTTON.primary} data-testid="add-lead-save">{busy ? 'Adding…' : 'Add lead'}</button>
      </>}>
      <form id="add-lead-form" onSubmit={submit} className="space-y-3" data-testid="add-lead">
        <label className="block text-xs font-semibold text-slate-700">Phone number (with country code)
          <input className={`${inputCls} mt-1`} value={form.phone} onChange={e => set({ phone: e.target.value })} placeholder="919876543210" inputMode="tel" required />
        </label>
        <label className="block text-xs font-semibold text-slate-700">Name
          <input className={`${inputCls} mt-1`} value={form.name} onChange={e => set({ name: e.target.value })} placeholder="Ravi Kumar" maxLength={80} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs font-semibold text-slate-700">Where from
            <select className={`${inputCls} mt-1`} value={form.source} onChange={e => set({ source: e.target.value })}>
              {sources.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="block text-xs font-semibold text-slate-700">Status
            <select className={`${inputCls} mt-1`} value={form.status || firstNew} onChange={e => set({ status: e.target.value })}>
              {statuses.active.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
        </div>
        <label className="block text-xs font-semibold text-slate-700">Tags (optional, comma separated)
          <input className={`${inputCls} mt-1`} value={form.tags} onChange={e => set({ tags: e.target.value })} placeholder="vip, follow-up" />
        </label>
        <label className="block text-xs font-semibold text-slate-700">Note (optional, e.g. what the call was about)
          <textarea rows={3} className={`${inputCls} mt-1`} value={form.note} onChange={e => set({ note: e.target.value })} maxLength={2000} />
        </label>
        {isManager ? (
          <label className="block text-xs font-semibold text-slate-700">Assigned to
            <select className={`${inputCls} mt-1`} value={form.assignedTo} onChange={e => set({ assignedTo: e.target.value })}>
              <option value="">Nobody yet</option>
              {staff.map(s => <option key={s.email} value={String(s.email).toLowerCase()}>{s.email}</option>)}
            </select>
          </label>
        ) : <p className="text-xs text-slate-500">The lead is assigned to you.</p>}
        <p className="text-xs text-slate-500">No WhatsApp message is sent. To write to them on WhatsApp, open the chat and use "Send template".</p>
        {error && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}
