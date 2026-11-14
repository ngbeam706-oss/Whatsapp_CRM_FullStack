import { useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import { useApi } from './queryClient';
import BookAppointmentModal from './BookAppointmentModal';
import type { ShowToast } from './types';

/** Inbox chat header: "Book appointment" for this chat (hospitals / clinics only; nothing for other businesses). */
export default function ChatAppointmentButton({ phone, name, disabled, showToast }: { phone: string; name: string; disabled: boolean; showToast: ShowToast }) {
  const on = useApi<{ enabled: boolean }>('/api/clinic/status', { staleTime: 5 * 60000 }).data?.enabled;
  const [open, setOpen] = useState(false);
  if (!on) return null;
  return (
    <>
      <button onClick={() => setOpen(true)} disabled={disabled} className="p-1.5 rounded-lg hover:bg-slate-200 text-sky-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed" title="Book appointment" aria-label="Book appointment">
        <CalendarPlus className="w-4 h-4" />
      </button>
      {open && <BookAppointmentModal phone={phone} patientName={name} onClose={() => setOpen(false)}
        onBooked={(a) => { setOpen(false); showToast(a.status === 'confirmed' ? 'Appointment booked and confirmed' : 'Appointment booked: send the payment link from Appointments'); }} />}
    </>
  );
}
