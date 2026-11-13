// Several WhatsApp numbers per business (docs/progress/multi-number.md, N2): names and 24-hour windows
// for the Inbox's number badges, number filter and "Reply from" picker.
import type { BusinessNumber, InboxContact } from './types';
import { useApi } from './queryClient';

const NO_NUMBERS: BusinessNumber[] = [];

/** The business's numbers (main first). Changes rarely: fetched once per few minutes. */
export function useBusinessNumbers(): BusinessNumber[] {
  return useApi<{ numbers?: BusinessNumber[] }>('/api/inbox-numbers', { staleTime: 5 * 60 * 1000 }).data?.numbers || NO_NUMBERS;
}

/** "Pharmacy", else "+91 90000 00201", else "Main number". */
export function numberName(n: BusinessNumber | null | undefined): string {
  if (!n) return 'Unknown number';
  if (n.label) return n.label;
  if (n.phoneNumber) return `+${n.phoneNumber.replace(/\D/g, '')}`;
  return n.main ? 'Main number' : 'Other number';
}

/** The number with this id; a missing id means the main number (history from before several numbers). */
export function findNumber(numbers: BusinessNumber[], id: string | null | undefined): BusinessNumber | null {
  if (!id) return numbers.find(n => n.main) || null;
  return numbers.find(n => n.id === String(id)) || null;
}

/** The number replies go out from by default: the one the customer last wrote to. */
export function defaultReplyNumber(numbers: BusinessNumber[], contact: Pick<InboxContact, 'last_phone_number_id'>): BusinessNumber | null {
  return findNumber(numbers, contact.last_phone_number_id) || numbers.find(n => n.main) || null;
}

/**
 * Is a free-form reply allowed from this number? The number the customer last wrote to uses the contact's
 * window; any other number its own window (closed if they never wrote to it).
 */
export function windowFor(contact: InboxContact, numbers: BusinessNumber[], numberId: string | null): { open: boolean; closesAt: string | null; everWrote: boolean } {
  const last = defaultReplyNumber(numbers, contact);
  if (!numberId || (last && last.id === numberId)) {
    return { open: !!contact.windowOpen, closesAt: contact.windowClosesAt || null, everWrote: !!contact.last_inbound_at };
  }
  const w = (contact.windows || []).find(x => x.numberId === numberId);
  return { open: !!w?.open, closesAt: w?.closesAt || null, everWrote: !!w };
}
