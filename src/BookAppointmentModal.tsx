import { useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import { api, errorMessage, inputCls } from './broadcastUtils';
import { useApi, refreshApi } from './queryClient';
import { BUTTON, Modal } from './ui';
import { addDays, dayLabel, GENDER_LABEL, rupees, todayIst, type Appointment, type Doctor, type Patient } from './clinicUtils';

const EMPTY = { name: '', age: '', gender: '', city: '', allergies: '', conditions: '' };
type PatientForm = typeof EMPTY;
const formOf = (p: Patient): PatientForm => ({ name: p.name, age: p.age === null ? '' : String(p.age), gender: p.gender || '', city: p.city, allergies: p.allergies, conditions: p.conditions });

/**
 * Book an appointment for a chat (Inbox chat header, the Appointments screen, or a follow-up).
 * The agent picks the chat's patient (or adds a new one: name, age, gender required; city, allergies, existing
 * conditions optional) and writes the reason for the visit; the doctor sees these. The fee is the doctor's; only
 * the doctor's free times can be picked. The server checks everything again, including that you may act on this chat.
 */
export default function BookAppointmentModal({ phone: fixedPhone, patientName, patientId: fixedPatientId, doctorId: fixedDoctorId, onClose, onBooked }: {
  phone?: string; patientName?: string; patientId?: string; doctorId?: string; onClose: () => void; onBooked: (a: Appointment) => void;
}) {
  const doctors = useApi<{ doctors: Doctor[] }>('/api/clinic/doctors').data?.doctors.filter(d => d.active) || [];
  const [phone, setPhone] = useState(fixedPhone || '');
  const digits = phone.replace(/\D/g, '');
  const known = useApi<{ patients: Patient[] }>(digits.length >= 7 ? `/api/clinic/patients?phone=${digits}` : null).data?.patients;
  // '' = not chosen yet, 'new' = a new patient, else an existing patient's id.
  const [pick, setPick] = useState<string>(fixedPatientId || '');
  const [form, setForm] = useState<PatientForm>({ ...EMPTY, name: patientName || '' });
  const [edited, setEdited] = useState(false);
  const [reason, setReason] = useState('');
  const [doctorId, setDoctorId] = useState(fixedDoctorId || '');
  const [day, setDay] = useState(todayIst());
  const [slot, setSlot] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const doctor = doctors.find(d => d.id === doctorId);
  const slots = useApi<{ slots: Array<{ startsAt: string; time: string }> }>(doctorId ? `/api/clinic/doctors/${doctorId}/slots?day=${day}` : null);
  // No patients on this chat yet: straight to the new-patient form.
  const choice = pick || (known && !known.length ? 'new' : '');
  const existing = known?.find(p => p.id === choice);
  const shown = existing && !edited ? formOf(existing) : form;
  const set = (patch: Partial<PatientForm>) => { setForm({ ...shown, ...patch }); setEdited(true); };
  const choose = (id: string) => { setPick(id); setEdited(false); setForm(id === 'new' ? { ...EMPTY, name: patientName || '' } : form); };
  const ready = !!choice && !!shown.name.trim() && shown.age !== '' && !!shown.gender && reason.trim().length >= 3 && !!slot && !!doctorId && digits.length >= 7;

  const book = async () => {
    setBusy(true); setError('');
    const patient = { ...shown, age: Number(shown.age) };
    try {
      const r = await api<{ appointment: Appointment }>('/api/clinic/appointments', { method: 'POST', body: {
        phone: digits, doctorId, startsAt: slot, reason: reason.trim(), note: note.trim(),
        ...(choice === 'new' ? { patient } : { patientId: choice, ...(edited ? { patient } : {}) }),
      } });
      await refreshApi('/api/clinic/');
      onBooked(r.appointment);
    } catch (e) { setError(errorMessage(e)); await refreshApi(`/api/clinic/doctors/${doctorId}/slots`); setSlot(''); } finally { setBusy(false); }
  };

  const label = 'text-xs font-semibold text-slate-600';
  return (
    <Modal title="Book appointment" onClose={onClose} wide
      footer={<>
        <button className={BUTTON.secondary} onClick={onClose}>Close</button>
        <button className={BUTTON.primary} onClick={book} disabled={busy || !ready}><CalendarPlus className="w-3.5 h-3.5" /> {busy ? 'Booking…' : 'Book'}</button>
      </>}>
      <div className="space-y-4">
        {!fixedPhone && (
          <label className="block">
            <span className={label}>Patient's WhatsApp number (with country code)</span>
            <input value={phone} onChange={e => { setPhone(e.target.value); setPick(''); }} inputMode="tel" placeholder="91…" className={inputCls} />
            <span className="text-xs text-slate-500">The patient must already have a chat with you.</span>
          </label>
        )}

        <fieldset className="space-y-2">
          <legend className="text-sm font-bold text-slate-800 mb-1">Patient</legend>
          {!!known?.length && (
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Which patient">
              {known.map(p => (
                <button key={p.id} type="button" role="radio" aria-checked={choice === p.id} onClick={() => choose(p.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold border cursor-pointer ${choice === p.id ? 'bg-wa-teal text-white border-wa-teal' : 'bg-white text-slate-700 border-slate-300'}`}>
                  {p.name}{p.age !== null ? `, ${p.age}` : ''}
                </button>
              ))}
              <button type="button" role="radio" aria-checked={choice === 'new'} onClick={() => choose('new')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold border cursor-pointer ${choice === 'new' ? 'bg-wa-teal text-white border-wa-teal' : 'bg-white text-slate-700 border-slate-300'}`}>+ New patient</button>
            </div>
          )}
          {choice && (
            <div className="grid sm:grid-cols-2 gap-2" aria-label="Patient details">
              <label className="block sm:col-span-2"><span className={label}>Full name *</span>
                <input value={shown.name} onChange={e => set({ name: e.target.value })} maxLength={80} className={inputCls} /></label>
              <label className="block"><span className={label}>Age (years) *</span>
                <input value={shown.age} onChange={e => set({ age: e.target.value.replace(/\D/g, '').slice(0, 3) })} inputMode="numeric" className={inputCls} /></label>
              <label className="block"><span className={label}>Gender *</span>
                <select value={shown.gender} onChange={e => set({ gender: e.target.value })} className={inputCls}>
                  <option value="">Pick</option>
                  {Object.entries(GENDER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select></label>
              <label className="block"><span className={label}>City / area</span>
                <input value={shown.city} onChange={e => set({ city: e.target.value })} maxLength={60} className={inputCls} /></label>
              <label className="block"><span className={label}>Allergies</span>
                <input value={shown.allergies} onChange={e => set({ allergies: e.target.value })} maxLength={300} placeholder="e.g. Penicillin, or None" className={inputCls} /></label>
              <label className="block sm:col-span-2"><span className={label}>Existing conditions / regular medicines</span>
                <input value={shown.conditions} onChange={e => set({ conditions: e.target.value })} maxLength={300} placeholder="e.g. Diabetes, BP tablets" className={inputCls} /></label>
            </div>
          )}
          {!choice && digits.length >= 7 && known && <p className="text-xs text-slate-500">Pick the patient, or add a new one.</p>}
        </fieldset>

        <label className="block">
          <span className={label}>Reason for the visit *</span>
          <input value={reason} onChange={e => setReason(e.target.value)} maxLength={300} placeholder="What the patient wants to see the doctor about" className={inputCls} />
        </label>

        <fieldset className="space-y-2">
          <legend className="text-sm font-bold text-slate-800 mb-1">Doctor and time</legend>
          <select value={doctorId} onChange={e => { setDoctorId(e.target.value); setSlot(''); }} className={inputCls} aria-label="Doctor">
            <option value="">Pick a doctor</option>
            {doctors.map(d => <option key={d.id} value={d.id}>{d.name}{d.specialty ? ` · ${d.specialty}` : ''} · {d.fee ? rupees(d.fee) : 'Free'}</option>)}
          </select>
          {!doctors.length && <span className="text-xs text-slate-500">No doctors yet. A manager adds them in Settings → Clinic.</span>}
          {doctor && (
            <>
              <input type="date" value={day} min={todayIst()} onChange={e => { if (e.target.value) { setDay(e.target.value); setSlot(''); } }} className={inputCls} aria-label="Day" />
              <div>
                <div className="text-xs font-semibold text-slate-600 mb-1">Free times on {dayLabel(day)}</div>
                {!slots.data ? <p className="text-xs text-slate-500">Loading…</p>
                  : !slots.data.slots.length ? <p className="text-xs text-slate-500">No free times on this day. <button type="button" className="underline cursor-pointer" onClick={() => setDay(addDays(day, 1))}>Next day</button></p>
                    : (
                      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Time">
                        {slots.data.slots.map(s => (
                          <button key={s.startsAt} type="button" role="radio" aria-checked={slot === s.startsAt} onClick={() => setSlot(s.startsAt)}
                            className={`px-2.5 py-1 rounded-lg text-xs font-semibold border cursor-pointer ${slot === s.startsAt ? 'bg-wa-teal text-white border-wa-teal' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}>{s.time}</button>
                        ))}
                      </div>
                    )}
              </div>
              <div className="text-xs text-slate-600">Fee: <span className="font-semibold">{doctor.fee ? rupees(doctor.fee) : 'Free (confirmed at once)'}</span></div>
            </>
          )}
        </fieldset>

        <label className="block">
          <span className={label}>Note for the doctor (optional)</span>
          <input value={note} onChange={e => setNote(e.target.value)} maxLength={300} placeholder="e.g. First visit, bring old reports" className={inputCls} />
        </label>
        {error && <div className="p-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700" role="alert">{error}</div>}
      </div>
    </Modal>
  );
}
