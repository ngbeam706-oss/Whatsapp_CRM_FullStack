import { useRef, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useNavigate, useParams } from 'react-router';
import { CalendarDays, Clock, ChevronLeft, ChevronRight, CheckCircle2, Plus, Trash2, Save, Stethoscope, Users, Camera, CalendarClock, AlertTriangle, Search, ArrowLeft } from 'lucide-react';
import { SignOutButton } from './AuthGate';
import { BrandLogo } from './BrandMark';
import { api, errorMessage, inputCls, inputInlineCls } from './broadcastUtils';
import { useApi, refreshApi, errorOf } from './queryClient';
import { useConfirm } from './confirm';
import { BUTTON, Card, EmptyState, PageHeader, SkeletonRows } from './ui';
import { addDays, APPT_STATUS, dayLabel, patientLine, shrinkPhoto, timeOf, todayIst, WEEKDAYS, type PastVisit, type Patient, type Sheet } from './clinicUtils';

interface QueueItem { id: string; patientName: string; startsAt: string; endsAt: string; status: 'confirmed' | 'completed' | 'no_show'; note: string; reason: string; followUpOn: string | null }
interface Hours { slotMinutes: number; hours: Array<{ weekday: number; start: string; end: string }>; daysOff: string[] }
interface VisitView {
  visit: { id: string; startsAt: string; status: QueueItem['status']; reason: string; note: string; patientName: string; followUpOn: string | null; followUpNote: string; sheets: Sheet[] };
  patient: Patient | null; history: PastVisit[];
}

const istDayOf = (iso: string) => new Date(Date.parse(iso) + 330 * 60000).toISOString().slice(0, 10);

/**
 * The doctor area (/doctor): a clinic doctor's own appointments (with each visit's patient details, case-sheet
 * photos and follow-up date), the patients they have seen, and their weekly hours / days off.
 * Doctors are not staff: the server (/api/doctor, requireDoctor) gives them nothing else, never chats or phone numbers.
 */
export default function DoctorApp({ base, email, onSignOut }: { base: string; email: string; onSignOut: () => void }) {
  const me = useApi<{ doctor: { name: string } }>('/api/doctor/me');
  const tab = (to: string, label: string, Icon: typeof Clock) => (
    <NavLink to={`${base}/${to}`} className={({ isActive }) => `flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold ${isActive ? 'bg-wa-teal text-white' : 'text-slate-600 hover:bg-slate-200'}`}>
      <Icon className="w-4 h-4" /> {label}
    </NavLink>
  );
  return (
    <div className="min-h-screen bg-slate-100" data-testid="doctor-app">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 py-2 flex items-center gap-3 flex-wrap">
          <BrandLogo size={28} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-slate-800 truncate">{me.data?.doctor.name || 'Doctor'}</div>
            <div className="text-xs text-slate-500">Doctor</div>
          </div>
          <SignOutButton email={email} onSignOut={onSignOut} />
        </div>
        <nav className="max-w-4xl mx-auto px-4 pb-2 flex gap-2 overflow-x-auto" aria-label="Doctor menu">
          {tab('appointments', 'My appointments', CalendarDays)}
          {tab('patients', 'My patients', Users)}
          {tab('hours', 'My hours', Clock)}
        </nav>
      </header>
      <Routes>
        <Route path="appointments" element={<Queue base={base} />} />
        <Route path="visit/:id" element={<Visit base={base} />} />
        <Route path="patients" element={<Patients base={base} />} />
        <Route path="patients/:id" element={<PatientFile base={base} />} />
        <Route path="hours" element={<HoursEditor />} />
        <Route path="*" element={<Navigate to={`${base}/appointments`} replace />} />
      </Routes>
    </div>
  );
}

const STATUS: Record<QueueItem['status'], { label: string; cls: string }> = {
  confirmed: { label: 'Waiting', cls: 'bg-sky-50 text-sky-800' },
  completed: { label: 'Seen', cls: 'bg-emerald-50 text-emerald-800' },
  no_show: { label: 'No-show', cls: 'bg-slate-100 text-slate-600' },
};
const Err = ({ text }: { text: string }) => <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700" role="alert">{text}</div>;

function Queue({ base }: { base: string }) {
  const [day, setDay] = useState(todayIst());
  const q = useApi<{ appointments: QueueItem[] }>(`/api/doctor/appointments?day=${day}`, { refetchInterval: 60000 });
  const list = q.data?.appointments;
  return (
    <main className="max-w-4xl mx-auto px-4 py-5 space-y-4">
      <PageHeader icon={Stethoscope} title="My appointments" help="Paid appointments with you. Open one to see the patient, add the case sheet and set a follow-up." />
      <div className="flex items-center gap-2">
        <button className={BUTTON.secondary} onClick={() => setDay(addDays(day, -1))} aria-label="Previous day"><ChevronLeft className="w-4 h-4" /></button>
        <input type="date" value={day} onChange={e => e.target.value && setDay(e.target.value)} className={inputInlineCls} aria-label="Day" />
        <button className={BUTTON.secondary} onClick={() => setDay(addDays(day, 1))} aria-label="Next day"><ChevronRight className="w-4 h-4" /></button>
        <span className="text-sm text-slate-600">{dayLabel(day)}</span>
      </div>
      {!list ? (errorOf(q) ? <Err text={errorOf(q)} /> : <SkeletonRows rows={3} />)
        : !list.length ? <EmptyState icon={CalendarDays} title="No appointments" text="Nobody is booked with you on this day yet." />
          : (
            <ul className="space-y-2" aria-label="Appointments">
              {list.map(a => (
                <li key={a.id}>
                  <Link to={`${base}/visit/${a.id}`} className="bg-white rounded-xl border border-slate-200 p-3 flex items-center gap-3 hover:border-wa-teal">
                    <div className="text-sm font-bold text-slate-800 w-16 shrink-0">{timeOf(a.startsAt)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-800 truncate">{a.patientName}</div>
                      <div className="text-xs text-slate-500 truncate">{[a.reason, a.note].filter(Boolean).join(' · ')}</div>
                    </div>
                    {a.followUpOn && <span className="text-xs text-violet-700 hidden sm:inline">Follow-up {dayLabel(a.followUpOn)}</span>}
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${STATUS[a.status].cls}`}>{STATUS[a.status].label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
    </main>
  );
}

/** The patient's details card (no phone number). */
function PatientCard({ p, name }: { p: Patient | null; name: string }) {
  return (
    <Card title="Patient">
      <div className="text-base font-bold text-slate-800">{p?.name || name}</div>
      {p ? (
        <dl className="mt-2 grid sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <div className="text-slate-600">{patientLine(p) || '—'}</div>
          <div><dt className="inline text-slate-500">Allergies: </dt><dd className={`inline ${p.allergies && !/^none$/i.test(p.allergies) ? 'text-red-700 font-semibold' : 'text-slate-700'}`}>{p.allergies || 'Not given'}</dd></div>
          <div className="sm:col-span-2"><dt className="inline text-slate-500">Existing conditions / medicines: </dt><dd className="inline text-slate-700">{p.conditions || 'Not given'}</dd></div>
        </dl>
      ) : <p className="text-xs text-slate-500 mt-1">Booked before patient details were collected.</p>}
    </Card>
  );
}

/** Case-sheet photos: thumbnails that open full size in a new tab (short-lived links). */
function SheetStrip({ sheets, onRemove, busy }: { sheets: Sheet[]; onRemove?: (id: string) => void; busy?: boolean }) {
  if (!sheets.length) return <p className="text-xs text-slate-500">No case-sheet photos.</p>;
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Case-sheet photos">
      {sheets.map((s, i) => (
        <li key={s.id} className="relative">
          {s.url ? (
            <a href={s.url} target="_blank" rel="noreferrer" title="Open full size">
              <img src={s.url} alt={`Case sheet ${i + 1}`} className="w-28 h-36 object-cover rounded-lg border border-slate-200 bg-white" />
            </a>
          ) : <div className="w-28 h-36 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-500 flex items-center justify-center p-2 text-center">Photo unavailable</div>}
          {onRemove && <button className="absolute top-1 right-1 bg-white/90 rounded-full p-1 cursor-pointer" aria-label={`Remove case sheet ${i + 1}`} disabled={busy} onClick={() => onRemove(s.id)}><Trash2 className="w-3.5 h-3.5 text-red-600" /></button>}
        </li>
      ))}
    </ul>
  );
}

/** Earlier visits of the patient at this hospital, newest first, each with its case sheets. */
function History({ visits, title = 'Earlier visits' }: { visits: PastVisit[]; title?: string }) {
  return (
    <Card title={title}>
      {!visits.length ? <p className="text-sm text-slate-500">No other visits.</p> : (
        <ol className="space-y-4" aria-label={title}>
          {visits.map(v => (
            <li key={v.id} className="border-l-2 border-slate-200 pl-3">
              <div className="text-sm font-semibold text-slate-800">{dayLabel(istDayOf(v.startsAt))} · {v.doctorName} <span className={`ml-1 text-xs px-2 py-0.5 rounded-full ${APPT_STATUS[v.status]?.cls || ''}`}>{APPT_STATUS[v.status]?.label || v.status}</span></div>
              {v.reason && <div className="text-xs text-slate-600">Reason: {v.reason}</div>}
              {v.followUpOn && <div className="text-xs text-violet-700">Follow-up set for {dayLabel(v.followUpOn)}{v.followUpNote ? ` · ${v.followUpNote}` : ''}</div>}
              <div className="mt-2"><SheetStrip sheets={v.sheets} /></div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function Visit({ base }: { base: string }) {
  const { id = '' } = useParams();
  const path = `/api/doctor/appointments/${id}`;
  const q = useApi<VisitView>(path);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [fu, setFu] = useState<{ date: string; note: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const confirm = useConfirm();
  const navigate = useNavigate();
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); await refreshApi(path); await refreshApi('/api/doctor/appointments?'); setMsg({ ok: true, text: ok }); } catch (e) { setMsg({ ok: false, text: errorMessage(e) }); } finally { setBusy(false); }
  };
  if (!q.data) return <main className="max-w-4xl mx-auto px-4 py-5">{errorOf(q) ? <Err text={errorOf(q)} /> : <SkeletonRows rows={5} />}</main>;
  const { visit: v, patient, history } = q.data;
  const form = fu || { date: v.followUpOn || '', note: v.followUpNote || '' };
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    await run(async () => {
      for (const f of Array.from(files)) await api(`${path}/sheets`, { method: 'POST', body: { image: await shrinkPhoto(f) } });
    }, files.length > 1 ? 'Case sheets added' : 'Case sheet added');
    if (fileRef.current) fileRef.current.value = '';
  };
  const remove = async (sheetId: string) => {
    if (!(await confirm({ title: 'Remove this photo?', body: 'It is deleted for good.', confirmLabel: 'Remove', danger: true }))) return;
    await run(() => api(`${path}/sheets/${sheetId}`, { method: 'DELETE' }), 'Photo removed');
  };
  const saveFollowUp = () => run(async () => { await api(`${path}/follow-up`, { method: 'PUT', body: form }); setFu(null); }, form.date ? 'Follow-up saved' : 'Follow-up removed');
  return (
    <main className="max-w-4xl mx-auto px-4 py-5 space-y-4" data-testid="doctor-visit">
      <button className={BUTTON.quiet} onClick={() => navigate(`${base}/appointments`)}><ArrowLeft className="w-4 h-4" /> My appointments</button>
      <PageHeader icon={Stethoscope} title={`${v.patientName} · ${timeOf(v.startsAt)}, ${dayLabel(istDayOf(v.startsAt))}`}
        actions={v.status === 'confirmed' ? <button className={BUTTON.primary} disabled={busy} onClick={() => run(() => api(`/api/doctor/appointments/${v.id}/seen`, { method: 'POST' }), 'Marked as seen')}><CheckCircle2 className="w-3.5 h-3.5" /> Mark seen</button>
          : <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${STATUS[v.status].cls}`}>{STATUS[v.status].label}</span>} />
      {msg && <div className={`p-3 rounded-lg text-xs border ${msg.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-700'}`} role="status">{msg.text}</div>}
      <PatientCard p={patient} name={v.patientName} />
      <Card title="This visit">
        <div className="text-sm text-slate-700"><span className="text-slate-500">Reason: </span>{v.reason || 'Not given'}</div>
        {v.note && <div className="text-sm text-slate-700"><span className="text-slate-500">Note from the front desk: </span>{v.note}</div>}
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-700">Case sheet</span>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={e => upload(e.target.files)} aria-label="Case-sheet photo" />
          <button className={BUTTON.secondary} disabled={busy} onClick={() => fileRef.current?.click()}><Camera className="w-3.5 h-3.5" /> {busy ? 'Uploading…' : 'Add photo'}</button>
        </div>
        <div className="mt-2"><SheetStrip sheets={v.sheets} onRemove={remove} busy={busy} /></div>
      </Card>
      <Card title={<span className="flex items-center gap-2"><CalendarClock className="w-4 h-4" /> Follow-up</span>}>
        <div className="flex items-center gap-2 flex-wrap">
          <input type="date" value={form.date} min={todayIst()} onChange={e => setFu({ ...form, date: e.target.value })} className={inputInlineCls} aria-label="Follow-up date" />
          {[7, 14, 30].map(n => <button key={n} className={BUTTON.quiet} onClick={() => setFu({ ...form, date: addDays(todayIst(), n) })}>+{n} days</button>)}
        </div>
        <input value={form.note} onChange={e => setFu({ ...form, note: e.target.value })} maxLength={200} placeholder="Note for the front desk (optional), e.g. bring blood report" className={`${inputCls} mt-2`} aria-label="Follow-up note" />
        <div className="mt-2 flex gap-2">
          <button className={BUTTON.primary} disabled={busy || !fu} onClick={saveFollowUp}><Save className="w-3.5 h-3.5" /> Save follow-up</button>
          {v.followUpOn && <button className={BUTTON.quiet} disabled={busy} onClick={() => run(async () => { await api(`${path}/follow-up`, { method: 'PUT', body: { date: null } }); setFu(null); }, 'Follow-up removed')}>Remove</button>}
        </div>
        <p className="text-xs text-slate-500 mt-1">The front desk sees it in their follow-up list and books the visit.</p>
      </Card>
      {patient && <History visits={history} />}
    </main>
  );
}

function Patients({ base }: { base: string }) {
  const [term, setTerm] = useState('');
  const q = useApi<{ patients: Patient[] }>(`/api/doctor/patients${term.trim() ? `?q=${encodeURIComponent(term.trim())}` : ''}`, { keepPrevious: true });
  const list = q.data?.patients;
  return (
    <main className="max-w-4xl mx-auto px-4 py-5 space-y-4">
      <PageHeader icon={Users} title="My patients" help="Patients you have seen, newest visit first." />
      <label className="flex items-center gap-2 bg-white border border-slate-300 rounded-lg px-3">
        <Search className="w-4 h-4 text-slate-400" />
        <input value={term} onChange={e => setTerm(e.target.value)} placeholder="Search by name" className="flex-1 py-2 text-sm outline-none" aria-label="Search patients" />
      </label>
      {!list ? (errorOf(q) ? <Err text={errorOf(q)} /> : <SkeletonRows rows={4} />)
        : !list.length ? <EmptyState icon={Users} title={term ? 'No match' : 'No patients yet'} text={term ? 'Try another name.' : 'Patients appear here after their first paid visit with you.'} />
          : (
            <ul className="space-y-2" aria-label="Patients">
              {list.map(p => (
                <li key={p.id}>
                  <Link to={`${base}/patients/${p.id}`} className="bg-white rounded-xl border border-slate-200 p-3 flex items-center gap-3 hover:border-wa-teal">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-800 truncate">{p.name}</div>
                      <div className="text-xs text-slate-500 truncate">{patientLine(p)}</div>
                    </div>
                    {p.allergies && !/^none$/i.test(p.allergies) && <span className="text-xs text-red-700 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Allergy</span>}
                    <div className="text-xs text-slate-500 text-right">{p.visits} {p.visits === 1 ? 'visit' : 'visits'}{p.lastVisit ? <><br />last {dayLabel(istDayOf(p.lastVisit))}</> : null}</div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
    </main>
  );
}

function PatientFile({ base }: { base: string }) {
  const { id = '' } = useParams();
  const q = useApi<{ patient: Patient; visits: PastVisit[] }>(`/api/doctor/patients/${id}`);
  const navigate = useNavigate();
  return (
    <main className="max-w-4xl mx-auto px-4 py-5 space-y-4" data-testid="patient-file">
      <button className={BUTTON.quiet} onClick={() => navigate(`${base}/patients`)}><ArrowLeft className="w-4 h-4" /> My patients</button>
      {!q.data ? (errorOf(q) ? <Err text={errorOf(q)} /> : <SkeletonRows rows={5} />) : (
        <>
          <PatientCard p={q.data.patient} name={q.data.patient.name} />
          <History visits={q.data.visits} title="Visits" />
        </>
      )}
    </main>
  );
}

function HoursEditor() {
  const q = useApi<Hours>('/api/doctor/hours');
  const [draft, setDraft] = useState<Hours | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [offDay, setOffDay] = useState('');
  if (!q.data) {
    return <main className="max-w-4xl mx-auto px-4 py-5"><PageHeader icon={Clock} title="My hours" />{errorOf(q) ? <Err text={errorOf(q)} /> : <SkeletonRows rows={4} />}</main>;
  }
  const form = draft || q.data;
  const set = (patch: Partial<Hours>) => setDraft({ ...form, ...patch });
  const setRange = (i: number, patch: Partial<Hours['hours'][number]>) => set({ hours: form.hours.map((h, j) => (j === i ? { ...h, ...patch } : h)) });
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); await refreshApi('/api/doctor/hours'); setDraft(null); setMsg({ ok: true, text: ok }); } catch (e) { setMsg({ ok: false, text: errorMessage(e) }); } finally { setBusy(false); }
  };
  const save = () => run(() => api('/api/doctor/hours', { method: 'PUT', body: { hours: form.hours, slotMinutes: form.slotMinutes } }), 'Hours saved');
  return (
    <main className="max-w-4xl mx-auto px-4 py-5 space-y-4">
      <PageHeader icon={Clock} title="My hours" help="When patients can be booked with you (India time). The front desk books only these slots."
        actions={<button className={BUTTON.primary} onClick={save} disabled={busy || !draft}><Save className="w-3.5 h-3.5" /> {busy ? 'Saving…' : 'Save'}</button>} />
      {msg && <div className={`p-3 rounded-lg text-xs border ${msg.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-700'}`} role="status">{msg.text}</div>}
      <Card title="Weekly hours">
        <label className="flex items-center gap-2 text-sm text-slate-700 mb-3">
          Each appointment is
          <select value={form.slotMinutes} onChange={e => set({ slotMinutes: Number(e.target.value) })} className={inputInlineCls} aria-label="Slot length">
            {[10, 15, 20, 30, 45, 60].map(m => <option key={m} value={m}>{m} minutes</option>)}
          </select>
        </label>
        {!form.hours.length && <p className="text-sm text-slate-500 mb-2">No hours yet: nobody can be booked with you.</p>}
        <ul className="space-y-2" aria-label="Time ranges">
          {form.hours.map((h, i) => (
            <li key={i} className="flex items-center gap-2 flex-wrap">
              <select value={h.weekday} onChange={e => setRange(i, { weekday: Number(e.target.value) })} className={inputInlineCls} aria-label="Day of the week">
                {WEEKDAYS.map((d, n) => <option key={d} value={n}>{d}</option>)}
              </select>
              <input type="time" value={h.start} onChange={e => setRange(i, { start: e.target.value })} className={inputInlineCls} aria-label="From" />
              <span className="text-sm text-slate-500">to</span>
              <input type="time" value={h.end} onChange={e => setRange(i, { end: e.target.value })} className={inputInlineCls} aria-label="To" />
              <button className={BUTTON.quiet} onClick={() => set({ hours: form.hours.filter((_, j) => j !== i) })} aria-label="Remove this time range"><Trash2 className="w-4 h-4" /></button>
            </li>
          ))}
        </ul>
        <button className={`${BUTTON.secondary} mt-3`} onClick={() => set({ hours: [...form.hours, { weekday: 1, start: '09:00', end: '13:00' }] })}><Plus className="w-3.5 h-3.5" /> Add time range</button>
      </Card>
      <Card title="Days off">
        <div className="flex items-center gap-2 flex-wrap">
          <input type="date" value={offDay} min={todayIst()} onChange={e => setOffDay(e.target.value)} className={inputInlineCls} aria-label="Day off" />
          <button className={BUTTON.secondary} disabled={busy || !offDay} onClick={() => run(() => api('/api/doctor/days-off', { method: 'POST', body: { day: offDay } }), 'Day off added')}><Plus className="w-3.5 h-3.5" /> Add day off</button>
        </div>
        {q.data.daysOff.length ? (
          <ul className="mt-3 flex flex-wrap gap-2" aria-label="Days off">
            {q.data.daysOff.map(d => (
              <li key={d} className="flex items-center gap-1 bg-slate-100 rounded-full pl-3 pr-1 py-0.5 text-sm text-slate-700">
                {dayLabel(d)}
                <button className="p-1 rounded-full hover:bg-slate-200 cursor-pointer" aria-label={`Remove day off ${d}`} disabled={busy} onClick={() => run(() => api(`/api/doctor/days-off/${d}`, { method: 'DELETE' }), 'Day off removed')}><Trash2 className="w-3.5 h-3.5" /></button>
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-sm text-slate-500">No days off planned.</p>}
      </Card>
    </main>
  );
}
