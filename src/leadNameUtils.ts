// Lead names the team saves (WhatsApp never overwrites them) and "returning" helpers.
// Server: server/inbox.cjs updateContact { name } (same rules as other chat changes), server/returningLeads.cjs.
import { api, errorMessage } from './broadcastUtils';
import { refreshApi } from './queryClient';
import { useConfirm } from './confirm';
import type { Contact, ShowToast } from './types';

export type Named = Pick<Contact, 'phone' | 'name'> & Partial<Pick<Contact, 'wa_name' | 'name_set_by' | 'returned_at' | 'returned_after_days'>>;

/** "4 months", "45 days", "1 year" (mirrors server/returningLeads.cjs gapText). */
function gapText(days: number): string {
  if (days >= 365) { const y = Math.round(days / 365); return `${y} year${y === 1 ? '' : 's'}`; }
  if (days >= 60) return `${Math.round(days / 30)} months`;
  return `${days} days`;
}
/** Shown for 30 days after the customer came back. */
export function returnedLabel(c: Named | null | undefined): string | null {
  if (!c?.returned_at || !c.returned_after_days) return null;
  if (Date.now() - Date.parse(c.returned_at) > 30 * 86400000) return null;
  return `Back after ${gapText(c.returned_after_days)}`;
}
/** The WhatsApp profile name, when the team saved a different one. */
export const otherWaName = (c: Named | null | undefined) => (c?.wa_name && c.wa_name !== c.name ? c.wa_name : null);

/** Rename a lead (empty = back to the WhatsApp name). Returns a function that asks and saves. */
export function useRenameLead(showToast: ShowToast) {
  const confirm = useConfirm();
  return async (c: Named, onDone?: () => void) => {
    const typed = await confirm.ask({
      title: 'Name this contact',
      body: `Your team sees this name everywhere. WhatsApp won't change it.${c.wa_name ? ` Their WhatsApp name: ${c.wa_name}.` : ''} Leave it empty to use the WhatsApp name.`,
      label: 'Name', placeholder: c.name || '', confirmLabel: 'Save',
    });
    if (typed === null) return;
    try {
      await api(`/api/inbox/${c.phone}`, { method: 'PATCH', body: { name: typed.trim() } });
      showToast(typed.trim() ? 'Name saved' : 'Using the WhatsApp name again');
      await Promise.all([refreshApi('/api/inbox'), refreshApi('/api/pipeline'), refreshApi('/api/leads')]);
      onDone?.();
    } catch (e) { showToast(errorMessage(e)); }
  };
}
