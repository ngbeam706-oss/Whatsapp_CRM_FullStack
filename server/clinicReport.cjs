// @ts-check
// Clinic → Collections (managers + Business Admin): what came in for a day or a date range, and how the appointments
// went. docs/progress/clinic.md
//   * Money: payments PAID in the range (Razorpay "paid" + desk "recorded"), by payment type, by the staff member who
//     took it (cash to hand over), by doctor; discounts; every payment with its reference.
//   * Appointments: those SCHEDULED in the range, by status and doctor; money still waiting (unpaid bookings); a daily
//     trend (appointments + collected) for the range.
// India-time days. Business-scoped like everything else; agents never reach it (requireManager on the route).
const { dbRequest } = require('./db.cjs');
const { requireBusinessId } = require('./tenant.cjs');
const clinic = require('./clinic.cjs');

/** @typedef {import('./types.cjs').Staff} Staff */
/** @typedef {Record<string, any>} Row */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 92;
const DAY_MS = 86400000;
const PAID = ['paid', 'recorded'];
const r2 = (/** @type {number} */ n) => Math.round(n * 100) / 100;

/** The range asked for (default: today), as India-time days and UTC bounds. @param {{ from?: unknown, to?: unknown }} q */
function rangeOf(q = {}) {
  const today = clinic.istDay(Date.now());
  const from = DAY_RE.test(String(q.from || '')) ? String(q.from) : today;
  const to = DAY_RE.test(String(q.to || '')) ? String(q.to) : from;
  if (to < from) return { error: 'The end date is before the start date.' };
  const days = Math.round((clinic.istMoment(to, 0) - clinic.istMoment(from, 0)) / DAY_MS) + 1;
  if (days > MAX_DAYS) return { error: `Pick at most ${MAX_DAYS} days.` };
  return { from, to, days, start: new Date(clinic.istMoment(from, 0)).toISOString(), end: new Date(clinic.istMoment(to, 0) + DAY_MS).toISOString() };
}

/**
 * Pure: the report from the rows (tested directly).
 * @param {{ from: string, days: number, appointments: Row[], payments: Row[], paidAppointments: Row[], doctors: Map<string, string> }} p
 */
function buildReport({ from, days, appointments, payments, paidAppointments, doctors }) {
  const apptById = new Map([...paidAppointments, ...appointments].map(a => [a.id, a]));
  /** @type {string[]} */
  const dayList = [];
  for (let i = 0; i < days; i++) dayList.push(clinic.istDay(clinic.istMoment(from, 0) + i * DAY_MS + 12 * 3600000));
  /** @type {Map<string, { day: string, appointments: number, collected: number }>} */
  const daily = new Map(dayList.map(d => [d, { day: d, appointments: 0, collected: 0 }]));

  // Appointments scheduled in the range.
  const status = { booked: 0, pending_payment: 0, confirmed: 0, completed: 0, no_show: 0, cancelled: 0 };
  let waitingAmount = 0;
  /** @type {Map<string, { doctorId: string, doctor: string, booked: number, seen: number, noShow: number, cancelled: number, collected: number }>} */
  const byDoctor = new Map();
  const doc = (/** @type {string} */ id) => {
    let d = byDoctor.get(id);
    if (!d) { d = { doctorId: id, doctor: doctors.get(id) || 'Doctor', booked: 0, seen: 0, noShow: 0, cancelled: 0, collected: 0 }; byDoctor.set(id, d); }
    return d;
  };
  for (const a of appointments) {
    const s = /** @type {keyof typeof status} */ (String(a.status));
    if (s in status) status[s] += 1;
    const d = doc(a.doctor_id);
    if (a.status === 'cancelled') { d.cancelled += 1; continue; }
    status.booked += 1; d.booked += 1;
    if (a.status === 'completed') d.seen += 1;
    if (a.status === 'no_show') d.noShow += 1;
    if (a.status === 'pending_payment') waitingAmount += Number(a.fee_paise) || 0;
    const day = daily.get(clinic.istDay(Date.parse(a.starts_at)));
    if (day) day.appointments += 1;
  }

  // Money paid in the range.
  /** @type {Record<string, { method: string, count: number, amount: number }>} */
  const byMethod = {};
  /** @type {Map<string, { person: string, count: number, amount: number, cash: number }>} */
  const byPerson = new Map();
  let collected = 0; let discount = 0;
  const list = [];
  for (const p of payments.filter(x => PAID.includes(x.status))) {
    const amount = Number(p.amount_paise) || 0;
    collected += amount;
    const m = (byMethod[p.method] ||= { method: p.method, count: 0, amount: 0 });
    m.count += 1; m.amount += amount;
    const online = p.method === 'razorpay_link';
    const who = online ? 'Online (Razorpay)' : String(p.recorded_by || 'unknown');
    let per = byPerson.get(who);
    if (!per) { per = { person: who, count: 0, amount: 0, cash: 0 }; byPerson.set(who, per); }
    per.count += 1; per.amount += amount; if (p.method === 'cash') per.cash += amount;
    const a = apptById.get(p.appointment_id);
    if (a) {
      doc(a.doctor_id).collected += amount;
      if (amount < Number(a.fee_paise)) discount += Number(a.fee_paise) - amount;
    }
    const day = daily.get(clinic.istDay(Date.parse(p.paid_at || p.created_at)));
    if (day) day.collected += amount;
    list.push({
      id: p.id, paidAt: p.paid_at || p.created_at, method: p.method, amount: amount / 100, reference: p.receipt_no || p.razorpay_payment_id || '',
      takenBy: online ? 'Razorpay' : p.recorded_by || '', patientName: a?.patient_name || '', doctor: a ? doctors.get(a.doctor_id) || '' : '', fee: a ? Number(a.fee_paise) / 100 : null,
    });
  }
  list.sort((x, y) => String(y.paidAt).localeCompare(String(x.paidAt)));
  const money = (/** @type {number} */ paise) => r2(paise / 100);
  return {
    totals: {
      collected: money(collected), payments: list.length, discount: money(discount), waiting: money(waitingAmount),
      appointments: status.booked, waitingPayment: status.pending_payment, confirmed: status.confirmed, seen: status.completed,
      noShow: status.no_show, cancelled: status.cancelled,
      showRate: status.completed + status.no_show ? Math.round((status.completed / (status.completed + status.no_show)) * 100) : null,
    },
    byMethod: Object.values(byMethod).map(m => ({ ...m, amount: money(m.amount) })).sort((a, b) => b.amount - a.amount),
    byPerson: [...byPerson.values()].map(p => ({ ...p, amount: money(p.amount), cash: money(p.cash) })).sort((a, b) => b.amount - a.amount),
    byDoctor: [...byDoctor.values()].map(d => ({ ...d, collected: money(d.collected) })).sort((a, b) => b.collected - a.collected || b.booked - a.booked),
    daily: [...daily.values()].map(d => ({ ...d, collected: money(d.collected) })),
    payments: list.slice(0, 500),
  };
}

/** @param {string} path */
async function rows(path) {
  const r = await dbRequest(path);
  return r.ok && Array.isArray(r.data) ? r.data : [];
}

/** Collections + appointment numbers for a range (default today). @param {Staff} staff @param {{ from?: unknown, to?: unknown }} q */
async function report(staff, q = {}) {
  const biz = requireBusinessId(staff.businessId);
  if (!(await clinic.isClinic(biz))) return { error: clinic.NOT_CLINIC, status: 403 };
  const range = rangeOf(q);
  if ('error' in range) return { error: range.error };
  const [appointments, payments, doctorRows] = await Promise.all([
    rows(`clinic_appointments?business_id=eq.${biz}&starts_at=gte.${range.start}&starts_at=lt.${range.end}&select=id,doctor_id,patient_name,starts_at,status,fee_paise&limit=10000`),
    rows(`clinic_payments?business_id=eq.${biz}&status=in.(paid,recorded)&paid_at=gte.${range.start}&paid_at=lt.${range.end}&select=id,appointment_id,method,amount_paise,status,receipt_no,razorpay_payment_id,recorded_by,paid_at,created_at&limit=10000`),
    rows(`clinic_doctors?business_id=eq.${biz}&select=id,name`),
  ]);
  // Payments in the range can be for appointments on other days (paid in advance).
  const known = new Set(appointments.map(a => a.id));
  const missing = [...new Set(payments.map(p => p.appointment_id).filter(id => !known.has(id)))];
  const paidAppointments = missing.length ? await rows(`clinic_appointments?business_id=eq.${biz}&id=in.(${missing.slice(0, 500).join(',')})&select=id,doctor_id,patient_name,starts_at,status,fee_paise`) : [];
  const doctors = new Map(doctorRows.map(d => [String(d.id), String(d.name)]));
  return { from: range.from, to: range.to, days: range.days, ...buildReport({ from: range.from, days: range.days, appointments, payments, paidAppointments, doctors }) };
}

module.exports = { rangeOf, buildReport, report };
