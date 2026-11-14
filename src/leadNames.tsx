// The "Back after 4 months" badge and the rename pencil (helpers in src/leadNameUtils.ts).
import { Pencil, RotateCcw } from 'lucide-react';
import { returnedLabel, type Named } from './leadNameUtils';

export function ReturnedBadge({ contact }: { contact: Named | null | undefined }) {
  const label = returnedLabel(contact);
  if (!label) return null;
  return (
    <span className="text-2xs px-1.5 py-px rounded border border-indigo-200 bg-indigo-50 text-indigo-800 font-semibold inline-flex items-center gap-0.5" data-testid="returned-badge" title="Wrote again after a long silence">
      <RotateCcw className="w-2.5 h-2.5" aria-hidden="true" />{label}
    </span>
  );
}

/** A small pencil button. */
export function RenameButton({ onClick, label = 'Rename' }: { onClick: () => void; label?: string }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick(); }} className="p-0.5 text-slate-400 hover:text-slate-700 cursor-pointer flex-shrink-0" aria-label={label} title={label} data-testid="rename-lead">
      <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
    </button>
  );
}
