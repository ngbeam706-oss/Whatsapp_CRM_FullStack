// @ts-check
// Clinic module (hospital / clinic businesses only): doctors, their weekly hours and days off, free slots,
// appointments and desk payments. Razorpay links are in clinicPay.cjs. docs/progress/clinic.md
//
// Who does what:
//   * Business Admin / managers: onboard doctors (invite by email), set each doctor's fee and slot length.
//   * Agents (and managers): book appointments for a chat they can act on (lead ownership), send payment links,
//     record desk payments (cash / UPI / card / other), cancel unpaid ones, mark done / no-show.
//   * Doctors (separate logins, not staff): their own hours, days off and appointment queue. Never chats.
// "Paid" for an online payment comes only from Razorpay (signed webhook or "Check payment").
const { config } = require('./config.cjs');
const { dbRequest, serviceHeaders, dbReady } = require('./db.cjs');
const { requireBusinessId, isBusinessId } = require('./tenant.cjs');

/** @typedef {import('./types.cjs').Staff} Staff */
/** @typedef {{ id: string, userId: string, email: string, name: string, businessId: string }} Doctor */

const IST_MIN = 330;                   // India time = UTC + 5:30
const DAY_MS = 86400000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ACTIVE = ['pending_payment', 'confirmed', 'completed'];
const DESK_METHODS = ['cash', 'upi_desk', 'card_desk', 'other'];
const NOT_CLINIC = 'Appointments are for hospital and clinic businesses only.';
/** @param {unknown} e */
const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || ''));
/** @param {unknown} v @param {number} max */
const cleanText = (v, max) => [...String(v ?? '')].map(ch => (ch.charCodeAt(0) < 32 ? ' ' : ch)).join('').trim().slice(0, max);
/** @param {Staff} s */
const isManager = (s) => s.role === 'owner' || s.role === 'manager';
/** @param {Staff | Doctor | null | undefined} who */
const emailOf = (who) => String(who?.email || '').toLowerCase();

// ---------------------------------------------------------------------------------------------
// Pure helpers (tested directly)
// ---------------------------------------------------------------------------------------------

/** Rupees (number or "1,200.50") -> paise; null when not a valid amount. @param {unknown} v */
function toPaise(v) {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[,\s₹]/g, ''));
  if (!Number.isFinite(n) || n < 0 || n > 1000000) return null;
  return Math.round(n * 100);
}

/** 'YYYY-MM-DD' in India time for a moment. @param {number} ms */
function istDay(ms) {
  return new Date(ms + IST_MIN * 60000).toISOString().slice(0, 10);
}

/** The UTC moment of a day + minutes from midnight, India time. @param {string} day @param {number} min */
function istMoment(day, min) {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d) + (min - IST_MIN) * 60000;
}

/** 0 = Sunday … 6 = Saturday for a 'YYYY-MM-DD' day. @param {string} day */
function weekdayOf(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "HH:MM" -> minutes from midnight; null when not a time. @param {unknown} v */
function toMin(v) {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1440) return v;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]); const mi = Number(m[2]);
  if (h > 24 || mi > 59 || (h === 24 && mi > 0)) return null;
  return h * 60 + mi;
}
/** @param {number} min */
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/**
 * Clean a doctor's weekly hours: [{ weekday, start: "09:00", end: "13:00" }]. Overlaps on one day are refused.
 * @param {unknown} list @returns {{ hours: { weekday: number, start_min: number, end_min: number }[] } | { error: string }}
 */
function cleanHours(list) {
  if (!Array.isArray(list)) return { error: 'Send the weekly hours as a list.' };
  if (list.length > 70) return { error: 'Too many time ranges (at most 70 a week).' };
  /** @type {{ weekday: number, start_min: number, end_min: number }[]} */
  const hours = [];
  for (const raw of list) {
    const r = /** @type {any} */ (raw) || {};
    const weekday = Number(r.weekday);
    const start = toMin(r.start); const end = toMin(r.end);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return { error: 'Each range needs a day of the week.' };
    if (start === null || end === null || end <= start) return { error: 'Each range needs a start time before its end time (HH:MM).' };
    hours.push({ weekday, start_min: start, end_min: end });
  }
  hours.sort((a, b) => a.weekday - b.weekday || a.start_min - b.start_min);
  for (let i = 1; i < hours.length; i++) {
    if (hours[i].weekday === hours[i - 1].weekday && hours[i].start_min < hours[i - 1].end_min) {
      return { error: 'Two time ranges on the same day overlap.' };
    }
  }
  return { hours };
}

/**
 * Free slots of one doctor on one day (India time).
 * @param {{ day: string, hours: { weekday: number, start_min: number, end_min: number }[], daysOff: string[],
 *   taken: { starts_at: string, ends_at: string }[], slotMinutes: number, now: number }} p
 * @returns {{ startsAt: string, time: string }[]}
 */
function freeSlots({ day, hours, daysOff, taken, slotMinutes, now }) {
  if (!DAY_RE.test(day) || daysOff.includes(day)) return [];
  const wd = weekdayOf(day);
  const busy = taken.map(t => [Date.parse(t.starts_at), Date.parse(t.ends_at)]);
  /** @type {{ startsAt: string, time: string }[]} */
  const out = [];
  for (const h of hours.filter(x => x.weekday === wd).sort((a, b) => a.start_min - b.start_min)) {
    for (let m = h.start_min; m + slotMinutes <= h.end_min; m += slotMinutes) {
      const s = istMoment(day, m); const e = s + slotMinutes * 60000;
      if (s <= now) continue;
      if (busy.some(([bs, be]) => s < be && bs < e)) continue;
      out.push({ startsAt: new Date(s).toISOString(), time: hhmm(m) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Shared lookups
// ---------------------------------------------------------------------------------------------

/** Is this a hospital / clinic business? @param {string} biz */
async function isClinic(biz) {
  const r = await dbRequest(`businesses?id=eq.${biz}&select=industry`);
  return r.ok && Array.isArray(r.data) && r.data[0]?.industry === 'hospital';
}

/** @param {Staff | Doctor | null} who @param {string} biz @param {string} action @param {Record<string, unknown>} details */
async function audit(who, biz, action, details) {
  await dbRequest('audit_log', {
    method: 'POST', prefer: 'return=minimal',
    body: { business_id: biz, actor_email: who?.email || 'system', actor_role: who && 'role' in who ? who.role : (who ? 'doctor' : 'system'), action, details },
  });
}

/** @param {string} biz @param {string} id */
async function doctorRow(biz, id) {
  if (!UUID_RE.test(id)) return null;
  const r = await dbRequest(`clinic_doctors?business_id=eq.${biz}&id=eq.${id}&select=*`);
  return r.ok && Array.isArray(r.data) ? r.data[0] || null : null;
}

/** @param {string} biz @param {string} id */
async function appointmentRow(biz, id) {
  if (!UUID_RE.test(id)) return null;
  const r = await dbRequest(`clinic_appointments?business_id=eq.${biz}&id=eq.${id}&select=*`);
  return r.ok && Array.isArray(r.data) ? r.data[0] || null : null;
}

/** What staff see about a doctor (fee in rupees). @param {any} d */
const doctorView = (d) => ({
  id: d.id, name: d.name, email: d.email, specialty: d.specialty || '', fee: d.fee_paise / 100,
  slotMinutes: d.slot_minutes, active: d.active, loginReady: !!d.user_id,
});

// ---------------------------------------------------------------------------------------------
// Status for the dashboard (menu + settings)
// ---------------------------------------------------------------------------------------------

/** @param {Staff} staff */
async function status(staff) {
  const biz = requireBusinessId(staff.businessId);
  const enabled = await isClinic(biz);
  if (!enabled) return { enabled: false };
  const s = await dbRequest(`clinic_settings?business_id=eq.${biz}&select=razorpay_key_id`);
  return { enabled: true, razorpay: !!(s.ok && s.data?.[0]?.razorpay_key_id) };
}

// ---------------------------------------------------------------------------------------------
// Doctors (Business Admin / managers)
// ---------------------------------------------------------------------------------------------

/** @param {Staff} staff */
async function listDoctors(staff) {
  const biz = requireBusinessId(staff.businessId);
  if (!(await isClinic(biz))) return { error: NOT_CLINIC, status: 403 };
  const r = await dbRequest(`clinic_doctors?business_id=eq.${biz}&select=*&order=name.asc`);
  if (!r.ok) return { error: 'Could not load the doctors. Has SQL 20261139 been run?' };
  const list = (r.data || []).map(doctorView);
  return { doctors: isManager(staff) ? list : list.filter((/** @type {any} */ d) => d.active).map((/** @type {any} */ d) => ({ ...d, email: undefined })) };
}

/** @param {any} input @param {boolean} creating */
function cleanDoctor(input, creating) {
  /** @type {Record<string, unknown>} */
  const out = {};
  if (creating || input.name !== undefined) {
    const name = cleanText(input.name, 80);
    if (name.length < 2) return { error: 'Enter the doctor\'s name.' };
    out.name = name;
  }
  if (input.specialty !== undefined) out.specialty = cleanText(input.specialty, 80) || null;
  if (creating || input.fee !== undefined) {
    const fee = toPaise(input.fee);
    if (fee === null) return { error: 'Enter the consultation fee in rupees (0 for free).' };
    out.fee_paise = fee;
  }
  if (input.slotMinutes !== undefined) {
    const s = Number(input.slotMinutes);
    if (!Number.isInteger(s) || s < 5 || s > 240) return { error: 'Slot length must be 5 to 240 minutes.' };
    out.slot_minutes = s;
  }
  if (input.active !== undefined) {
    if (typeof input.active !== 'boolean') return { error: 'Say whether the doctor is active.' };
    out.active = input.active;
  }
  return { fields: out };
}

/**
 * Invite the doctor's login (Supabase invite email) or find their existing login. Returns its user id.
 * @param {string} email @returns {Promise<{ userId: string } | { error: string }>}
 */
async function doctorLogin(email) {
  const siteUrl = await require('./siteUrl.cjs').siteUrl();
  const res = await fetch(`${config.supabaseUrl}/auth/v1/invite?redirect_to=${encodeURIComponent(siteUrl)}`, {
    method: 'POST', headers: serviceHeaders(), body: JSON.stringify({ email }),
  });
  /** @type {any} */
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  if (res.ok && data?.id) return { userId: data.id };
  const msg = String(data?.msg || data?.message || data?.error_description || '');
  if (res.status === 422 || /already/i.test(msg)) {
    const r = await dbRequest('rpc/clinic_user_id_for_email', { method: 'POST', body: { p_email: email } });
    if (r.ok && typeof r.data === 'string' && UUID_RE.test(r.data)) return { userId: r.data };
    return { error: 'That email has a login, but it could not be found.' };
  }
  if (res.status === 429 || /rate limit/i.test(msg)) return { error: 'Supabase\'s email limit was reached. Try again later.' };
  return { error: msg || `Invite failed (${res.status}).` };
}

/** @param {Staff} staff @param {any} input */
async function addDoctor(staff, input = {}) {
  const biz = requireBusinessId(staff.businessId);
  if (!(await isClinic(biz))) return { error: NOT_CLINIC, status: 403 };
  if (!dbReady()) return { error: 'Server database access is not configured.' };
  const email = String(input.email || '').trim().toLowerCase();
  if (!isEmail(email)) return { error: 'Enter the doctor\'s email address (they sign in with it).' };
  const c = cleanDoctor(input, true);
  if ('error' in c) return { error: c.error };
  const dup = await dbRequest(`clinic_doctors?business_id=eq.${biz}&email=eq.${encodeURIComponent(email)}&select=id`);
  if (dup.ok && dup.data?.length) return { error: 'This doctor is already on the list.' };
  // A staff member (any business) or a platform admin can't be a doctor: checked before any invite email goes out.
  const staffRow = await dbRequest(`staff_members?email=eq.${encodeURIComponent(email)}&select=user_id`);
  if (staffRow.ok && staffRow.data?.length) return { error: 'That email is a staff login. A doctor needs their own email.' };
  const login = await doctorLogin(email);
  if ('error' in login) return { error: login.error };
  const ins = await dbRequest('clinic_doctors', {
    method: 'POST', prefer: 'return=representation',
    body: { business_id: biz, user_id: login.userId, email, ...c.fields, created_by: emailOf(staff) },
  });
  if (!ins.ok || !ins.data?.length) {
    const msg = String(ins.data?.message || '');
    if (/belongs to someone else/i.test(msg)) return { error: 'That login already belongs to staff, the platform or another doctor.' };
    return { error: 'Could not add the doctor. Has SQL 20261139 been run?' };
  }
  await audit(staff, biz, 'clinic.doctor_added', { doctor: ins.data[0].id, fee_paise: ins.data[0].fee_paise });
  return { doctor: doctorView(ins.data[0]) };
}

/** @param {Staff} staff @param {string} id @param {any} input */
async function updateDoctor(staff, id, input = {}) {
  const biz = requireBusinessId(staff.businessId);
  if (!(await isClinic(biz))) return { error: NOT_CLINIC, status: 403 };
  const d = await doctorRow(biz, id);
  if (!d) return { error: 'Doctor not found.', status: 404 };
  const c = cleanDoctor(input, false);
  if ('error' in c) return { error: c.error };
  if (!Object.keys(c.fields).length) return { doctor: doctorView(d) };
  const r = await dbRequest(`clinic_doctors?business_id=eq.${biz}&id=eq.${d.id}`, {
    method: 'PATCH', prefer: 'return=representation', body: { ...c.fields, updated_at: new Date().toISOString() },
  });
  if (!r.ok || !r.data?.length) return { error: 'Could not save the doctor.' };
  /** @type {Record<string, unknown>} */
  const changed = { doctor: d.id, fields: Object.keys(c.fields) };
  if ('fee_paise' in c.fields) { changed.fee_from = d.fee_paise; changed.fee_to = c.fields.fee_paise; }
  await audit(staff, biz, 'clinic.doctor_updated', changed);
  forgetDoctorLogins(d.user_id);
  return { doctor: doctorView(r.data[0]) };
}

// ---------------------------------------------------------------------------------------------
// Doctor logins (requireDoctor) and the doctor's own screens
// ---------------------------------------------------------------------------------------------

const CACHE_MS = 60000;
/** @type {Map<string, { doctor: Doctor | null, expires: number }>} */
const doctorCache = new Map();

/** @param {string} token @returns {Promise<Doctor | null>} */
async function lookupDoctor(token) {
  const u = await fetch(`${config.supabaseUrl}/auth/v1/user`, { headers: { apikey: config.supabaseAnonKey, Authorization: `Bearer ${token}` } });
  if (!u.ok) return null;
  const user = /** @type {{ id?: string, email?: string }} */ (await u.json());
  if (!user?.id || !UUID_RE.test(user.id)) return null;
  const r = await dbRequest(`clinic_doctors?user_id=eq.${user.id}&select=id,business_id,email,name,active,businesses(status,industry)`);
  const row = r.ok && Array.isArray(r.data) ? r.data[0] : null;
  if (!row || !row.active || !isBusinessId(row.business_id)) return null;
  if (row.businesses?.status !== 'active' || row.businesses?.industry !== 'hospital') return null;
  return { id: row.id, userId: user.id, email: user.email || row.email, name: row.name, businessId: row.business_id };
}

/**
 * Route guard: a signed-in, active doctor of an active hospital business, or 401/403.
 * @type {import('./types.cjs').Middleware}
 */
async function requireDoctor(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!token) return res.status(401).json({ error: 'Sign in required.' });
  const hit = doctorCache.get(token);
  let doctor = hit && hit.expires > Date.now() ? hit.doctor : undefined;
  if (doctor === undefined) {
    try { doctor = await lookupDoctor(token); } catch { return res.status(503).json({ error: 'Could not check your login.' }); }
    doctorCache.set(token, { doctor, expires: Date.now() + CACHE_MS });
    if (doctorCache.size > 1000) for (const [k, v] of doctorCache) if (v.expires <= Date.now()) doctorCache.delete(k);
  }
  if (!doctor) {
    res.locals.authFailed = true;
    return res.status(403).json({ error: 'This login is not an active doctor.' });
  }
  /** @type {any} */ (req).doctor = doctor;
  return next();
}

/** A doctor was changed (e.g. made inactive): forget their cached logins. @param {string | null | undefined} userId */
function forgetDoctorLogins(userId) {
  if (!userId) return;
  for (const [k, v] of doctorCache) if (v.doctor?.userId === userId) doctorCache.delete(k);
}

/** Tests only. @param {string} token @param {Doctor | null} doctor */
function _setDoctorForToken(token, doctor) { doctorCache.set(token, { doctor, expires: Date.now() + CACHE_MS }); }

/** @param {string} biz @param {string} doctorId */
async function hoursOf(biz, doctorId) {
  const [h, off] = await Promise.all([
    dbRequest(`clinic_doctor_hours?business_id=eq.${biz}&doctor_id=eq.${doctorId}&select=weekday,start_min,end_min&order=weekday.asc,start_min.asc`),
    dbRequest(`clinic_doctor_days_off?business_id=eq.${biz}&doctor_id=eq.${doctorId}&day=gte.${istDay(Date.now())}&select=day&order=day.asc`),
  ]);
  return {
    hours: h.ok && Array.isArray(h.data) ? h.data : [],
    daysOff: off.ok && Array.isArray(off.data) ? off.data.map((/** @type {any} */ x) => String(x.day).slice(0, 10)) : [],
  };
}

/** The doctor's own hours. @param {Doctor} doctor */
async function myHours(doctor) {
  const d = await doctorRow(doctor.businessId, doctor.id);
  if (!d) return { error: 'Doctor not found.', status: 404 };
  const { hours, daysOff } = await hoursOf(doctor.businessId, doctor.id);
  return {
    slotMinutes: d.slot_minutes,
    hours: hours.map((/** @type {any} */ h) => ({ weekday: h.weekday, start: hhmm(h.start_min), end: hhmm(h.end_min) })),
    daysOff,
  };
}

/** The doctor saves their weekly hours (and slot length). @param {Doctor} doctor @param {any} input */
async function saveMyHours(doctor, input = {}) {
  const biz = doctor.businessId;
  const c = cleanHours(input.hours);
  if ('error' in c) return { error: c.error };
  if (input.slotMinutes !== undefined) {
    const s = Number(input.slotMinutes);
    if (!Number.isInteger(s) || s < 5 || s > 240) return { error: 'Slot length must be 5 to 240 minutes.' };
    await dbRequest(`clinic_doctors?business_id=eq.${biz}&id=eq.${doctor.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { slot_minutes: s, updated_at: new Date().toISOString() } });
  }
  const del = await dbRequest(`clinic_doctor_hours?business_id=eq.${biz}&doctor_id=eq.${doctor.id}`, { method: 'DELETE', prefer: 'return=minimal' });
  if (!del.ok) return { error: 'Could not save your hours.' };
  if (c.hours.length) {
    const ins = await dbRequest('clinic_doctor_hours', { method: 'POST', prefer: 'return=minimal', body: c.hours.map(h => ({ ...h, business_id: biz, doctor_id: doctor.id })) });
    if (!ins.ok) return { error: 'Could not save your hours.' };
  }
  return myHours(doctor);
}

/** @param {Doctor} doctor @param {unknown} day @param {boolean} off */
async function setDayOff(doctor, day, off) {
  const d = String(day || '');
  if (!DAY_RE.test(d) || Number.isNaN(Date.parse(d))) return { error: 'Pick a date.' };
  if (off) {
    if (d < istDay(Date.now())) return { error: 'Pick today or a later date.' };
    await dbRequest('clinic_doctor_days_off?on_conflict=doctor_id,day', { method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal', body: { business_id: doctor.businessId, doctor_id: doctor.id, day: d } });
  } else {
    await dbRequest(`clinic_doctor_days_off?business_id=eq.${doctor.businessId}&doctor_id=eq.${doctor.id}&day=eq.${d}`, { method: 'DELETE', prefer: 'return=minimal' });
  }
  return myHours(doctor);
}

/** What a doctor sees of an appointment: name, time, status, note. Never the phone number. @param {any} a */
const doctorApptView = (a) => ({
  id: a.id, patientName: a.patient_name, startsAt: a.starts_at, endsAt: a.ends_at, status: a.status, note: a.note || '',
  reason: a.reason || '', followUpOn: a.follow_up_on || null, hasPatient: !!a.patient_id,
});

/** The doctor's queue for a day (paid and done ones; unpaid bookings aren't theirs yet). @param {Doctor} doctor @param {unknown} day */
async function myQueue(doctor, day) {
  const d = DAY_RE.test(String(day || '')) ? String(day) : istDay(Date.now());
  const from = new Date(istMoment(d, 0)).toISOString(); const to = new Date(istMoment(d, 0) + DAY_MS).toISOString();
  const r = await dbRequest(`clinic_appointments?business_id=eq.${doctor.businessId}&doctor_id=eq.${doctor.id}&status=in.(confirmed,completed,no_show)&starts_at=gte.${from}&starts_at=lt.${to}&select=*&order=starts_at.asc`);
  if (!r.ok) return { error: 'Could not load your appointments.' };
  return { day: d, appointments: (r.data || []).map(doctorApptView) };
}

/** The doctor marks a confirmed appointment as seen. @param {Doctor} doctor @param {string} id */
async function markSeen(doctor, id) {
  const a = await appointmentRow(doctor.businessId, id);
  if (!a || a.doctor_id !== doctor.id) return { error: 'Appointment not found.', status: 404 };
  if (a.status !== 'confirmed') return { error: 'Only a confirmed appointment can be marked as seen.' };
  const r = await dbRequest(`clinic_appointments?business_id=eq.${doctor.businessId}&id=eq.${a.id}&status=eq.confirmed`, { method: 'PATCH', prefer: 'return=representation', body: { status: 'completed', updated_at: new Date().toISOString() } });
  if (!r.ok || !r.data?.length) return { error: 'Could not update the appointment.' };
  return { appointment: doctorApptView(r.data[0]) };
}

// ---------------------------------------------------------------------------------------------
// Slots and appointments (staff)
// ---------------------------------------------------------------------------------------------

/** @param {string} biz @param {any} doctor @param {string} day */
async function slotsFor(biz, doctor, day) {
  const from = new Date(istMoment(day, 0)).toISOString(); const to = new Date(istMoment(day, 0) + DAY_MS).toISOString();
  const [{ hours, daysOff }, taken] = await Promise.all([
    hoursOf(biz, doctor.id),
    dbRequest(`clinic_appointments?business_id=eq.${biz}&doctor_id=eq.${doctor.id}&status=in.(${ACTIVE.join(',')})&starts_at=lt.${to}&ends_at=gt.${from}&select=starts_at,ends_at`),
  ]);
  return freeSlots({ day, hours, daysOff, taken: taken.ok && Array.isArray(taken.data) ? taken.data : [], slotMinutes: doctor.slot_minutes, now: Date.now() });
}

/** @param {Staff} staff @param {string} doctorId @param {unknown} day */
async function slots(staff, doctorId, day) {
  const biz = requireBusinessId(staff.businessId);
  if (!(await isClinic(biz))) return { error: NOT_CLINIC, status: 403 };
  const d = String(day || '');
  if (!DAY_RE.test(d)) return { error: 'Pick a date.' };
  const doctor = await doctorRow(biz, doctorId);
  if (!doctor || !doctor.active) return { error: 'Doctor not found.', status: 404 };
  return { day: d, slots: await slotsFor(biz, doctor, d) };
}

/** What staff see of an appointment, with its payments. @param {any} a @param {any[]} payments @param {Map<string, string>} names */
const apptView = (a, payments, names) => ({
  id: a.id, doctorId: a.doctor_id, doctorName: names.get(a.doctor_id) || '', phone: a.lead_phone, patientName: a.patient_name,
  startsAt: a.starts_at, endsAt: a.ends_at, status: a.status, fee: a.fee_paise / 100, note: a.note || '', bookedBy: a.booked_by,
  confirmedAt: a.confirmed_at, cancelledReason: a.cancelled_reason || '', patientId: a.patient_id || null, reason: a.reason || '',
  followUpOn: a.follow_up_on || null, followUpNote: a.follow_up_note || '',
  payments: payments.filter(p => p.appointment_id === a.id).map(p => ({
    id: p.id, method: p.method, amount: p.amount_paise / 100, status: p.status, link: p.status === 'created' ? p.short_url : null,
    receiptNo: p.receipt_no || '', recordedBy: p.recorded_by || '', paidAt: p.paid_at, createdAt: p.created_at,
  })),
});

/** @param {string} biz @param {any[]} rows */
async function withPayments(biz, rows) {
  if (!rows.length) return [];
  const ids = rows.map(a => a.id).join(',');
  const doctorIds = [...new Set(rows.map(a => a.doctor_id))].join(',');
  const [p, d] = await Promise.all([
    dbRequest(`clinic_payments?business_id=eq.${biz}&appointment_id=in.(${ids})&select=*&order=created_at.asc`),
    dbRequest(`clinic_doctors?business_id=eq.${biz}&id=in.(${doctorIds})&select=id,name`),
  ]);
  const payments = p.ok && Array.isArray(p.data) ? p.data : [];
  const names = new Map((d.ok && Array.isArray(d.data) ? d.data : []).map((/** @type {any} */ x) => [x.id, x.name]));
  return rows.map(a => apptView(a, payments, names));
}

/** @param {Staff} staff @param {{ day?: unknown, doctorId?: unknown, phone?: unknown }} q */
async function listAppointments(staff, q = {}) {
  const biz = requireBusinessId(staff.businessId);
  if (!(await isClinic(biz))) return { error: NOT_CLINIC, status: 403 };
  const parts = [`business_id=eq.${biz}`];
  const phone = String(q.phone || '');
  if (phone) {
    if (!/^\d{7,15}$/.test(phone)) return { error: 'Invalid number.' };
    parts.push(`lead_phone=eq.${phone}`);
  } else {
    const day = DAY_RE.test(String(q.day || '')) ? String(q.day) : istDay(Date.now());
    parts.push(`starts_at=gte.${new Date(istMoment(day, 0)).toISOString()}`, `starts_at=lt.${new Date(istMoment(day, 0) + DAY_MS).toISOString()}`);
  }
  if (q.doctorId) {
    if (!UUID_RE.test(String(q.doctorId))) return { error: 'Invalid doctor.' };
    parts.push(`doctor_id=eq.${q.doctorId}`);
  }
  const r = await dbRequest(`clinic_appointments?${parts.join('&')}&select=*&order=starts_at.${phone ? 'desc' : 'asc'}&limit=500`);
  if (!r.ok) return { error: 'Could not load appointments. Has SQL 20261139 been run?' };
  return { appointments: await withPayments(biz, r.data || []) };
}

/** @param {Staff} staff @param {string} biz @param {string} id */
async function oneView(staff, biz, id) {
  const a = await appointmentRow(biz, id);
  return a ? (await withPayments(biz, [a]))[0] : null;
}

/**
 * Book an appointment for a chat the staff member may act on. The fee comes from the doctor; the slot must be free
 * and inside the doctor's hours. A free consultation (fee 0) is confirmed at once.
 * @param {Staff} staff @param {any} input
 */
async function book(staff, input = {}) {
  const biz = requireBusinessId(staff.businessId);
  if (!(await isClinic(biz))) return { error: NOT_CLINIC, status: 403 };
  const phone = String(input.phone || '');
  if (!/^\d{7,15}$/.test(phone)) return { error: 'Pick the patient\'s chat.' };
  const doctor = await doctorRow(biz, String(input.doctorId || ''));
  if (!doctor || !doctor.active) return { error: 'Pick a doctor.' };
  const startsMs = Date.parse(String(input.startsAt || ''));
  if (!Number.isFinite(startsMs)) return { error: 'Pick a time slot.' };
  const reason = cleanText(input.reason, 300);
  if (reason.length < 3) return { error: 'Enter the reason for the visit (what the patient wants to see the doctor about).' };
  const access = await require('./inbox.cjs').ensureCanAct(phone, staff);
  if (access.error !== undefined) return access;
  const day = istDay(startsMs);
  const free = await slotsFor(biz, doctor, day);
  if (!free.some(s => Date.parse(s.startsAt) === startsMs)) return { error: 'That time is not free any more. Pick another slot.' };
  // The patient's details (name, age, gender required): an existing patient of this chat, or a new one.
  const pr = await require('./clinicPatients.cjs').resolvePatient(staff, biz, phone, input);
  if ('error' in pr) return { error: pr.error };
  const patient = pr.patient;
  const patientName = patient.name;
  const free0 = doctor.fee_paise === 0;
  const now = new Date().toISOString();
  const ins = await dbRequest('clinic_appointments', {
    method: 'POST', prefer: 'return=representation',
    body: {
      business_id: biz, doctor_id: doctor.id, lead_phone: phone, patient_name: patientName,
      starts_at: new Date(startsMs).toISOString(), ends_at: new Date(startsMs + doctor.slot_minutes * 60000).toISOString(),
      status: free0 ? 'confirmed' : 'pending_payment', fee_paise: doctor.fee_paise, note: cleanText(input.note, 300) || null,
      booked_by: emailOf(staff), confirmed_at: free0 ? now : null, patient_id: patient.id, reason,
    },
  });
  if (!ins.ok || !ins.data?.length) {
    if (ins.status === 409) return { error: 'That time was just booked by someone else. Pick another slot.' };
    return { error: 'Could not book the appointment.' };
  }
  // A return visit: the patient's open follow-ups are now booked.
  await require('./clinicPatients.cjs').closeFollowUpsOf(biz, patient.id, emailOf(staff));
  await audit(staff, biz, 'clinic.appointment_booked', { appointment: ins.data[0].id, doctor: doctor.id, fee_paise: doctor.fee_paise });
  return { appointment: await oneView(staff, biz, ins.data[0].id) };
}

/**
 * Cancel / mark done / no-show. Agents cancel only unpaid bookings; cancelling a paid one is for managers
 * (the refund itself is done in Razorpay or at the desk).
 * @param {Staff} staff @param {string} id @param {{ status?: unknown, reason?: unknown }} input
 */
async function setStatus(staff, id, input = {}) {
  const biz = requireBusinessId(staff.businessId);
  if (!(await isClinic(biz))) return { error: NOT_CLINIC, status: 403 };
  const a = await appointmentRow(biz, id);
  if (!a) return { error: 'Appointment not found.', status: 404 };
  const to = String(input.status || '');
  if (!['cancelled', 'completed', 'no_show'].includes(to)) return { error: 'Unknown status.' };
  if (!isManager(staff)) {
    const access = await require('./inbox.cjs').ensureCanAct(a.lead_phone, staff);
    if (access.error !== undefined) return access;
  }
  /** @type {Record<string, string[]>} */
  const from = { cancelled: ['pending_payment', 'confirmed'], completed: ['confirmed'], no_show: ['confirmed'] };
  if (!from[to].includes(a.status)) return { error: `A ${a.status.replace('_', ' ')} appointment can't be marked ${to.replace('_', ' ')}.` };
  if (to === 'cancelled' && a.status === 'confirmed' && !isManager(staff)) return { error: 'This appointment is paid. Ask a manager to cancel it (and refund the payment).', status: 403 };
  /** @type {Record<string, unknown>} */
  const body = { status: to, updated_at: new Date().toISOString() };
  if (to === 'cancelled') body.cancelled_reason = cleanText(input.reason, 200) || null;
  const r = await dbRequest(`clinic_appointments?business_id=eq.${biz}&id=eq.${a.id}&status=eq.${a.status}`, { method: 'PATCH', prefer: 'return=representation', body });
  if (!r.ok || !r.data?.length) return { error: 'The appointment changed meanwhile. Refresh and try again.' };
  if (to === 'cancelled') {
    // Open payment links are no longer valid for this booking (Razorpay is told in clinicPay).
    await require('./clinicPay.cjs').cancelOpenLinks(biz, a.id);
  }
  await audit(staff, biz, `clinic.appointment_${to}`, { appointment: a.id, from: a.status });
  return { appointment: await oneView(staff, biz, a.id) };
}

/**
 * Record a payment taken at the desk (cash / UPI at the counter / card machine / other). The appointment is then
 * confirmed. Less than the fee (a discount) is for managers only.
 * @param {Staff} staff @param {string} id @param {any} input
 */
async function recordDeskPayment(staff, id, input = {}) {
  const biz = requireBusinessId(staff.businessId);
  if (!(await isClinic(biz))) return { error: NOT_CLINIC, status: 403 };
  const a = await appointmentRow(biz, id);
  if (!a) return { error: 'Appointment not found.', status: 404 };
  if (a.status !== 'pending_payment') return { error: 'This appointment is not waiting for a payment.' };
  const method = String(input.method || '');
  if (!DESK_METHODS.includes(method)) return { error: 'Pick how the patient paid (cash, UPI at the desk, card or other).' };
  const amount = input.amount === undefined || input.amount === '' ? a.fee_paise : toPaise(input.amount);
  if (amount === null || amount <= 0) return { error: 'Enter the amount received in rupees.' };
  if (amount > a.fee_paise) return { error: `The amount is more than the fee (₹${a.fee_paise / 100}).` };
  if (amount < a.fee_paise && !isManager(staff)) return { error: 'Only a manager can take less than the fee (a discount).', status: 403 };
  const note = cleanText(input.note, 200);
  if (method === 'other' && !note) return { error: 'Say how it was paid.' };
  if (!isManager(staff)) {
    const access = await require('./inbox.cjs').ensureCanAct(a.lead_phone, staff);
    if (access.error !== undefined) return access;
  }
  const now = new Date().toISOString();
  // Confirm first (only from pending), so two people recording at once give one payment.
  const conf = await dbRequest(`clinic_appointments?business_id=eq.${biz}&id=eq.${a.id}&status=eq.pending_payment`, {
    method: 'PATCH', prefer: 'return=representation', body: { status: 'confirmed', confirmed_at: now, updated_at: now },
  });
  if (!conf.ok || !conf.data?.length) return { error: 'This appointment was just paid or changed. Refresh to see it.' };
  const ins = await dbRequest('clinic_payments', {
    method: 'POST', prefer: 'return=minimal',
    body: { business_id: biz, appointment_id: a.id, method, amount_paise: amount, status: 'recorded', receipt_no: cleanText(input.receiptNo, 40) || null, note: note || null, recorded_by: emailOf(staff), paid_at: now },
  });
  if (!ins.ok) {
    await dbRequest(`clinic_appointments?business_id=eq.${biz}&id=eq.${a.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'pending_payment', confirmed_at: null } });
    return { error: 'Could not record the payment.' };
  }
  await require('./clinicPay.cjs').cancelOpenLinks(biz, a.id);
  await audit(staff, biz, 'clinic.desk_payment', { appointment: a.id, method, amount_paise: amount, fee_paise: a.fee_paise });
  return { appointment: await oneView(staff, biz, a.id) };
}

module.exports = {
  // pure
  toPaise, istDay, istMoment, weekdayOf, toMin, hhmm, cleanHours, freeSlots,
  // shared
  isClinic, audit, appointmentRow, doctorRow, oneView, NOT_CLINIC, UUID_RE,
  // staff
  status, listDoctors, addDoctor, updateDoctor, slots, listAppointments, book, setStatus, recordDeskPayment,
  // doctors
  requireDoctor, forgetDoctorLogins, _setDoctorForToken, myHours, saveMyHours, setDayOff, myQueue, markSeen,
};
