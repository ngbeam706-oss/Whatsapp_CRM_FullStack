// Helpers for filters by customer fields (D4); the panel is src/customFilters.tsx. The server checks every filter again.
import { useApi } from './queryClient';
import type { CustomField } from './importUtils';

export interface CustomFilterValue {
  key: string;
  min?: string; max?: string;              // number / amount
  from?: string; to?: string; preset?: string; // date
  values?: string[];                        // choice
  value?: boolean;                          // yes / no
  contains?: string;                        // text
}
interface FieldsResponse { ready: boolean; fields: CustomField[]; canEdit: boolean }

/** Only filters that say something (the server ignores empty ones too). */
export function activeCustomFilters(list: CustomFilterValue[] | undefined): CustomFilterValue[] {
  return (list || []).filter(f => (f.min ?? '') !== '' || (f.max ?? '') !== '' || f.from || f.to || f.preset || (f.values && f.values.length) || f.value === true || f.value === false || (f.contains ?? '').trim());
}

/** The fields one may filter by: visible ones; private ones only for managers and the Business Admin. */
export function useFilterableFields(allowText = true) {
  const q = useApi<FieldsResponse>('/api/customer-fields', { staleTime: 5 * 60000 });
  const fields = (q.data?.fields || []).filter(f => !f.hidden && (!f.private || q.data?.canEdit) && (allowText || f.type !== 'text'));
  return { fields, loading: !q.data && !q.error };
}
