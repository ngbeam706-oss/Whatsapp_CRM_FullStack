import { useState } from 'react';
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Link2, Send, Copy, RefreshCw, Banknote, XCircle, CheckCircle2, UserX, MessageSquare } from 'lucide-react';
import { api, errorMessage, inputCls, inputInlineCls } from './broadcastUtils';
import { useApi, refreshApi, errorOf } from './queryClient';
import { useConfirm } from './confirm';
import { BUTTON, EmptyState, Modal, PageHeader, SkeletonRows } from './ui';
import BookAppointmentModal from './BookAppointmentModal';
import { addDays, APPT_STATUS, dayLabel, PAY_METHOD, rupees, timeOf, todayIst, type Appointment, type Doctor, type FollowUp } from './clinicUtils';
import type { ShowToast } from './types';

/**
 * Appointments (hospitals / clinics): the day's bookings per doctor, with payment actions.
 * Agents act only on their own chats (the server checks lead ownership); a paid booking is cancelled by a manager.
 */
export default function AppointmentsScreen({ isManager, showToast, onOpenChat }: { isManager: boolean; showToast: ShowToast; onOpenChat: (phone: string) => void }) {
  const [day, setDay] = useState(todayIst());
  const [tab, setTab] = useState<'day' | 'followups'>('day');
  const [doctorId, setDoctorId] = useState('');
  const [booking, setBooking] = useState(false);
  const [paying, setPaying] = useState<Appointment | null>(null);
  const [busy, setBusy] = useState('');
  const confirm = useConfirm();
  const status = useApi<{ enabled: boolean; razorpay?: boolean }>('/api/clinic/status');
  const doctors = useApi<{ doctors: Doctor[] }>('/api/clinic/doctors').data?.doctors || [];
  const q = useApi<{ appointments: Appointment[] }>(`/api/clinic/appointments?day=${day}${doctorId ? `&doctorId=${doctorId}` : ''}`, { refetchInterval: 60000 });
  const list = q.data?.appointments;

  const act = async (a: Appointment, fn: () => Promise<unknown>, done?: string) => {
    setBusy(a.id);
    try { await fn(); await refreshApi('/api/clinic/appointments'); if (done) showToast(done); } catch (e) { showToast(errorMessage(e)); } finally { setBusy(''); }
  };
  const sendLink = (a: Appointment) => act(a, async () => {
    const r = await api<{ sent?: boolean; sendError?: string; link: string }>(`/api/clinic/appointments/${a.id}/payment-link`, { method: 'POST', body: { send: true } });
    if (!r.sent) {
      try { await navigator.clipboard.writeText(r.link); } catch { /* not allowed */ }
      throw new Error(`${r.sendError || 'Not sent.'} The link was copied: send it from the chat or a template.`);
    }
  }, 'Payment link sent in the chat');
  const copyLink = (a: Appointment) => act(a, async () => {
    const r = await api<{ link: string; message: string }>(`/api/clinic/appointments/${a.id}/payment-link`, { method: 'POST', body: {} });
    await navigator.clipboard.writeText(r.message);
  }, 'Message with the payment link copied');
  const check = (a: Appointment) => act(a, () => api(`/api/clinic/appointments/${a.id}/check-payment`, { method: 'POST' }));
  const setStatus = async (a: Appointment, to: 'cancelled' | 'completed' | 'no_show') => {
    let reason = '';
    if (to === 'cancelled') {
      const r = await confirm.ask({ title: `Cancel ${a.patientName}'s appointment?`, body: a.status === 'confirmed' ? 'It is paid: refund the patient in Razorpay or at the desk.' : 'Its payment link stops working.', label: 'Reason (optional)', confirmLabel: 'Cancel appointment', cancelLabel: 'Keep it', danger: true });
      if (r === null) return;
      reason = r;
    }
    await act(a, () => api(`/api/clinic/appointments/${a.id}/status`, { method: 'POST', body: { status: to, reason } }), to === 'cancelled' ? 'Appointment cancelled' : 'Saved');
  };

  if (status.data && !status.data.enabled) {
    return <div className="flex-1 overflow-y-auto bg-slate-100"><div className="max-w-5xl mx-auto px-4 py-5"><EmptyState icon={CalendarDays} title="Appointments are for hospitals and clinics" /></div></div>;
  }
  return (
    <div className="flex-1 overflow-y-auto bg-slate-100" data-testid="appointments">
      <div className="max-w-5xl mx-auto px-4 py-5 space-y-4">
        <PageHeader icon={CalendarDays} title="Appointments" help="Book patients with a doctor, take the payment, and the visit appears in the doctor's queue."
          actions={<button className={BUTTON.primary} onClick={() => setBooking(true)}><CalendarPlus className="w-3.5 h-3.5" /> Book</button>} />
        {status.data?.enabled && !status.data.razorpay && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">Online payment links need Razorpay: {isManager ? 'the Business Admin connects it in Settings → Clinic.' : 'ask the Business Admin.'} Desk payments work now.</div>
        )}
        <div className="flex gap-1.5" role="tablist" aria-label="Appointments view">
          {([['day', 'By day'], ['followups', 'Follow-ups']] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold cursor-pointer ${tab === k ? 'bg-wa-teal text-white' : 'bg-white text-slate-600 border border-slate-200'}`}>{l}</button>
          ))}
        </div>
        {tab === 'followups' ? <FollowUps isManager={isManager} showToast={showToast} onOpenChat={onOpenChat} /> : (<>
        <div className="flex items-center gap-2 flex-wrap">
          <button className={BUTTON.secondary} onClick={() => setDay(addDays(day, -1))} aria-label="Previous day"><ChevronLeft className="w-4 h-4" /></button>
          <input type="date" value={day} onChange={e => e.target.value && setDay(e.target.value)} className={inputInlineCls} aria-label="Day" />
          <button className={BUTTON.secondary} onClick={() => setDay(addDays(day, 1))} aria-label="Next day"><ChevronRight className="w-4 h-4" /></button>
          <span className="text-sm text-slate-600">{dayLabel(day)}</span>
          <select value={doctorId} onChange={e => setDoctorId(e.target.value)} className={`${inputInlineCls} ml-auto`} aria-label="Doctor">
            <option value="">All doctors</option>
            {doctors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        {!list ? (errorOf(q) ? <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{errorOf(q)}</div> : <SkeletonRows rows={4} />)
          : !list.length ? <EmptyState icon={CalendarDays} title="No appointments" text="Nothing booked on this day." />
            : (
              <ul className="space-y-2" aria-label="Appointments">
                {list.map(a => {
                  const st = APPT_STATUS[a.status];
                  const paid = a.payments.find(p => p.status === 'paid' || p.status === 'recorded');
                  const open = a.payments.find(p => p.status === 'created');
                  const dis = busy === a.id;
                  return (
                    <li key={a.id} className="bg-white rounded-xl border border-slate-200 p-3 space-y-2" data-testid="appointment">
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="text-sm font-bold text-slate-800 w-16">{timeOf(a.startsAt)}</div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-slate-800 truncate">{a.patientName}</div>
                          <div className="text-xs text-slate-500 truncate">{a.doctorName} · {a.fee ? rupees(a.fee) : 'Free'}{a.reason ? ` · ${a.reason}` : ''}{a.note ? ` · ${a.note}` : ''}</div>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${st.cls}`}>{st.label}</span>
                      </div>
                      {paid && <div className="text-xs text-emerald-800">Paid {rupees(paid.amount)} · {PAY_METHOD[paid.method] || paid.method}{paid.receiptNo ? ` · receipt ${paid.receiptNo}` : ''}{paid.recordedBy && paid.method !== 'razorpay_link' ? ` · taken by ${paid.recordedBy}` : ''}</div>}
                      {a.status === 'cancelled' && a.cancelledReason && <div className="text-xs text-slate-500">Reason: {a.cancelledReason}</div>}
                      <div className="flex flex-wrap gap-1.5">
                        <button className={BUTTON.quiet} onClick={() => onOpenChat(a.phone)}><MessageSquare className="w-3.5 h-3.5" /> Chat</button>
                        {a.status === 'pending_payment' && (
                          <>
                            {status.data?.razorpay && <button className={BUTTON.secondary} disabled={dis} onClick={() => sendLink(a)}><Send className="w-3.5 h-3.5" /> {open ? 'Send link again' : 'Send payment link'}</button>}
                            {status.data?.razorpay && <button className={BUTTON.quiet} disabled={dis} onClick={() => copyLink(a)}><Copy className="w-3.5 h-3.5" /> Copy link</button>}
                            {open && <button className={BUTTON.quiet} disabled={dis} onClick={() => check(a)}><RefreshCw className="w-3.5 h-3.5" /> Check payment</button>}
                            <button className={BUTTON.secondary} disabled={dis} onClick={() => setPaying(a)}><Banknote className="w-3.5 h-3.5" /> Paid at the desk</button>
                          </>
                        )}
                        {a.status === 'confirmed' && (
                          <>
                            <button className={BUTTON.quiet} disabled={dis} onClick={() => setStatus(a, 'completed')}><CheckCircle2 className="w-3.5 h-3.5" /> Seen</button>
                            <button className={BUTTON.quiet} disabled={dis} onClick={() => setStatus(a, 'no_show')}><UserX className="w-3.5 h-3.5" /> No-show</button>
                          </>
                        )}
                        {(a.status === 'pending_payment' || (a.status === 'confirmed' && isManager)) && (
                          <button className={BUTTON.quiet} disabled={dis} onClick={() => setStatus(a, 'cancelled')}><XCircle className="w-3.5 h-3.5" /> Cancel</button>
                        )}
                        {open?.link && <a href={open.link} target="_blank" rel="noreferrer" className={BUTTON.quiet}><Link2 className="w-3.5 h-3.5" /> Open link</a>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
        </>)}
      </div>
      {booking &&<BookAppointmentModal onClose={() => setBooking(false)} onBooked={(a) => { setBooking(false); setDay(new Date(Date.parse(a.startsAt) + 330 * 60000).toISOString().slice(0, 10)); showToast('Appointment booked'); }} />}
      {paying && <DeskPaymentModal appt={paying} isManager={isManager} onClose={() => setPaying(null)} onDone={() => { setPaying(null); refreshApi('/api/clinic/appointments'); showToast('Payment recorded: appointment confirmed'); }} />}
    </div>
  );
}

/**
 * Follow-ups the doctors set: the agent's own chats (managers can switch to everyone's). "Book visit" opens the
 * booking form for the same patient and doctor; booking it (or "Done") takes it off the list.
 */
function FollowUps({ isManager, showToast, onOpenChat }: { isManager: boolean; showToast: ShowToast; onOpenChat: (phone: string) => void }) {
  const [all, setAll] = useState(isManager);
  const q = useApi<{ followUps: FollowUp[] }>(`/api/clinic/follow-ups${all ? '?scope=all' : ''}`, { refetchInterval: 5 * 60000 });
  const [booking, setBooking] = useState<FollowUp | null>(null);
  const [busy, setBusy] = useState('');
  const confirm = useConfirm();
  const done = async (f: FollowUp) => {
    if (!(await confirm({ title: `Close ${f.patientName}'s follow-up?`, body: 'Use this when the patient won\'t come back for it (booking the visit closes it by itself).', confirmLabel: 'Close follow-up' }))) return;
    setBusy(f.appointmentId);
    try { await api(`/api/clinic/appointments/${f.appointmentId}/follow-up-done`, { method: 'POST' }); await refreshApi('/api/clinic/follow-ups'); showToast('Follow-up closed'); } catch (e) { showToast(errorMessage(e)); } finally { setBusy(''); }
  };
  const list = q.data?.followUps;
  return (
    <div className="space-y-2" data-testid="follow-ups">
      {isManager && (
        <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /> Everyone's follow-ups</label>
      )}
      {!list ? (errorOf(q) ? <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{errorOf(q)}</div> : <SkeletonRows rows={3} />)
        : !list.length ? <EmptyState icon={CalendarDays} title="No follow-ups" text="When a doctor sets a follow-up date, the patient shows here." />
          : (
            <ul className="space-y-2" aria-label="Follow-ups">
              {list.map(f => (
                <li key={f.appointmentId} className="bg-white rounded-xl border border-slate-200 p-3 flex items-center gap-3 flex-wrap" data-testid="follow-up">
                  <div className="flex-1 min-w-[12rem]">
                    <div className="text-sm font-semibold text-slate-800">{f.patientName}</div>
                    <div className="text-xs text-slate-500">{f.doctorName} · last visit {dayLabel(new Date(Date.parse(f.lastVisit) + 330 * 60000).toISOString().slice(0, 10))}{f.note ? ` · ${f.note}` : ''}</div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${f.overdue ? 'bg-red-50 text-red-700' : f.dueToday ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>
                    {f.overdue ? 'Overdue · ' : f.dueToday ? 'Today · ' : 'Due '}{dayLabel(f.due)}
                  </span>
                  <div className="flex gap-1.5">
                    <button className={BUTTON.quiet} onClick={() => onOpenChat(f.phone)}><MessageSquare className="w-3.5 h-3.5" /> Chat</button>
                    <button className={BUTTON.secondary} onClick={() => setBooking(f)}><CalendarPlus className="w-3.5 h-3.5" /> Book visit</button>
                    <button className={BUTTON.quiet} disabled={busy === f.appointmentId} onClick={() => done(f)}><CheckCircle2 className="w-3.5 h-3.5" /> Done</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
      {booking && <BookAppointmentModal phone={booking.phone} patientId={booking.patientId || undefined} doctorId={booking.doctorId}
        onClose={() => setBooking(null)} onBooked={() => { setBooking(null); refreshApi('/api/clinic/follow-ups'); showToast('Follow-up visit booked'); }} />}
    </div>
  );
}

/** Record a payment taken at the desk. Less than the fee is a discount: managers only (the server checks too). */
function DeskPaymentModal({ appt, isManager, onClose, onDone }: { appt: Appointment; isManager: boolean; onClose: () => void; onDone: () => void }) {
  const [method, setMethod] = useState('cash');
  const [amount, setAmount] = useState(String(appt.fee));
  const [receiptNo, setReceiptNo] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    setBusy(true); setError('');
    try { await api(`/api/clinic/appointments/${appt.id}/desk-payment`, { method: 'POST', body: { method, amount, receiptNo, note } }); onDone(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Paid at the desk: ${appt.patientName}`} onClose={onClose}
      footer={<><button className={BUTTON.secondary} onClick={onClose}>Close</button><button className={BUTTON.primary} onClick={save} disabled={busy}><Banknote className="w-3.5 h-3.5" /> {busy ? 'Saving…' : 'Record payment'}</button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="How they paid">
          {['cash', 'upi_desk', 'card_desk', 'other'].map(m => (
            <button key={m} role="radio" aria-checked={method === m} onClick={() => setMethod(m)}
              className={`px-2 py-2 rounded-lg text-xs font-semibold border cursor-pointer ${method === m ? 'bg-wa-teal text-white border-wa-teal' : 'bg-white text-slate-700 border-slate-300'}`}>{PAY_METHOD[m]}</button>
          ))}
        </div>
        <label className="block">
          <span className="text-xs font-semibold text-slate-600">Amount received (₹) · fee {rupees(appt.fee)}</span>
          <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" className={inputCls} disabled={!isManager} />
          {!isManager && <span className="text-xs text-slate-500">Only a manager can take less than the fee.</span>}
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-slate-600">Receipt number (optional)</span>
          <input value={receiptNo} onChange={e => setReceiptNo(e.target.value)} maxLength={40} className={inputCls} />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-slate-600">Note{method === 'other' ? '' : ' (optional)'}</span>
          <input value={note} onChange={e => setNote(e.target.value)} maxLength={200} placeholder={method === 'other' ? 'How was it paid?' : ''} className={inputCls} />
        </label>
        {error && <div className="p-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700" role="alert">{error}</div>}
      </div>
    </Modal>
  );
}
