// @ts-check
// Clinic module, part 2 (docs/progress/clinic.md): patient details, case-sheet photos, follow-up dates.
//
//   * Agents fill the patient's details when booking (name, age, gender required; city, allergies, existing
//     conditions optional) and the reason for the visit. Several patients can share one WhatsApp number.
//   * The doctor opens a visit: the patient's details, this visit's case-sheet photos (uploaded by the doctor) and
//     every earlier visit of the patient at this hospital with its sheets; sets the follow-up date.
//   * A doctor can open a patient only after they have had an appointment with that patient. Never the phone number.
//   * Follow-ups land in the agents' list (their own chats; managers see all) until a new visit is booked or it is
//     marked done.
//   * Photos: JPEG / PNG / WebP only (checked by their bytes), at most 4 MB, stored privately in Cloudinary
//     (server/cloudinary.cjs; the private Supabase bucket "case-sheets" when Cloudinary is not configured),
//     shown through signed links that expire after 10 minutes.
const crypto = require('crypto');
const { dbRequest } = require('./db.cjs');
const { requireBusinessId } = require('./tenant.cjs');
const storage = require('./storage.cjs');
const cloudinary = require('./cloudinary.cjs');
const clinic = require('./clinic.cjs');

/** @typedef {import('./types.cjs').Staff} Staff */
/** @typedef {{ id: string, userId: string, email: string, name: string, businessId: string }} Doctor */

const BUCKET = 'case-sheets';
const MAX_BYTES = 4 * 1024 * 1024;   // Netlify functions take ~6 MB per request: 4 MB of photo is ~5.4 MB of JSON
const MAX_SHEETS_PER_VISIT = 12;
const LINK_SECONDS = 600;
const GENDERS = ['female', 'male', 'other'];
const UUID_RE = clinic.UUID_RE;
/** @param {unknown} v @param {number} max */
const cleanText = (v, max) => [...String(v ?? '')].map(ch => (ch.charCodeAt(0) < 32 ? ' ' : ch)).join('').trim().slice(0, max);
/** @param {Staff} s */
const isManager = (s) => s.role === 'owner' || s.role === 'manager';

// ---------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------

/**
 * The patient's details from the booking form. Name, age and gender are required.
 * @param {any} input @returns {{ fields: Record<string, unknown> } | { error: string }}
 */
function cleanPatient(input) {
  const p = input || {};
  const name = cleanText(p.name, 80);
  if (name.length < 2) return { error: 'Enter the patient\'s full name.' };
  const age = Number(p.age);
  if (p.age === '' || p.age === null || p.age === undefined || !Number.isInteger(age) || age < 0 || age > 130) return { error: 'Enter the patient\'s age in years (0 to 130).' };
  const gender = String(p.gender || '');
  if (!GENDERS.includes(gender)) return { error: 'Pick the patient\'s gender.' };
  return {
    fields: {
      name, age_years: age, age_on: new Date().toISOString().slice(0, 10), gender,
      city: cleanText(p.city, 60) || null, allergies: cleanText(p.allergies, 300) || null, conditions: cleanText(p.conditions, 300) || null,
    },
  };
}

/** Age today, from the age given on age_on. @param {any} row @param {number} [now] */
function currentAge(row, now = Date.now()) {
  if (row?.age_years === null || row?.age_years === undefined) return null;
  const given = Date.parse(String(row.age_on || '')) || now;
  return row.age_years + Math.max(0, Math.floor((now - given) / (365.25 * 86400000)));
}

/** @param {any} row @param {boolean} [withPhone] */
function patientView(row, withPhone = false) {
  return {
    id: row.id, name: row.name, age: currentAge(row), gender: row.gender || null, city: row.city || '',
    allergies: row.allergies || '', conditions: row.conditions || '',
    ...(withPhone ? { phone: row.lead_phone } : {}),
  };
}

/**
 * A data URL (or bare base64) of a photo -> its bytes and type, checked by the bytes themselves.
 * @param {unknown} input @returns {{ bytes: Buffer, mime: string, ext: string } | { error: string }}
 */
function readImage(input) {
  const s = String(input || '');
  const m = /^data:([a-z/+-]+);base64,(.*)$/i.exec(s);
  const b64 = (m ? m[2] : s).replace(/\s/g, '');
  if (!b64 || b64.length > Math.ceil(MAX_BYTES * 4 / 3) + 8 || !/^[A-Za-z0-9+/]+=*$/.test(b64)) return { error: 'Send a photo (JPEG, PNG or WebP) of at most 4 MB.' };
  const bytes = Buffer.from(b64, 'base64');
  if (!bytes.length || bytes.length > MAX_BYTES) return { error: 'The photo is larger than 4 MB.' };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { bytes, mime: 'image/jpeg', ext: 'jpg' };
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { bytes, mime: 'image/png', ext: 'png' };
  if (bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return { bytes, mime: 'image/webp', ext: 'webp' };
  return { error: 'Only JPEG, PNG or WebP photos can be added.' };
}

/** 'YYYY-MM-DD' follow-up date: today or later, within 2 years. @param {unknown} v */
function cleanFollowUpDate(v) {
  const d = String(v || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) return { error: 'Pick the follow-up date.' };
  const today = clinic.istDay(Date.now());
  if (d < today) return { error: 'The follow-up date can\'t be in the past.' };
  if (d > clinic.istDay(Date.now() + 730 * 86400000)) return { error: 'Pick a follow-up date within 2 years.' };
  return { day: d };
}

// ---------------------------------------------------------------------------------------------
// Patients (staff)
// ---------------------------------------------------------------------------------------------

/** @param {string} biz @param {string} id */
async function patientRow(biz, id) {
  if (!UUID_RE.test(String(id || ''))) return null;
  const r = await dbRequest(`clinic_patients?business_id=eq.${biz}&id=eq.${id}&select=*`);
  return r.ok && Array.isArray(r.data) ? r.data[0] || null : null;
}

/** The patients booked from one chat (for the booking form). @param {Staff} staff @param {unknown} phone */
async function patientsForPhone(staff, phone) {
  const biz = requireBusinessId(staff.businessId);
  if (!(await clinic.isClinic(biz))) return { error: clinic.NOT_CLINIC, status: 403 };
  const p = String(phone || '');
  if (!/^\d{7,15}$/.test(p)) return { error: 'Invalid number.' };
  const r = await dbRequest(`clinic_patients?business_id=eq.${biz}&lead_phone=eq.${p}&select=*&order=updated_at.desc&limit=20`);
  if (!r.ok) return { error: 'Could not load the patients. Has SQL 20261140 been run?' };
  return { patients: (r.data || []).map((/** @type {any} */ x) => patientView(x)) };
}

/**
 * For a booking: the chosen existing patient of this chat (details updated if sent), or a new one.
 * @param {Staff} staff @param {string} biz @param {string} phone @param {any} input
 * @returns {Promise<{ patient: any } | { error: string }>}
 */
async function resolvePatient(staff, biz, phone, input) {
  const sent = input.patient && typeof input.patient === 'object' ? input.patient : null;
  if (input.patientId) {
    const row = await patientRow(biz, String(input.patientId));
    if (!row || row.lead_phone !== phone) return { error: 'That patient is not on this chat.' };
    if (!sent) return { patient: row };
    const c = cleanPatient(sent);
    if ('error' in c) return { error: c.error };
    const r = await dbRequest(`clinic_patients?business_id=eq.${biz}&id=eq.${row.id}`, { method: 'PATCH', prefer: 'return=representation', body: { ...c.fields, updated_at: new Date().toISOString() } });
    if (!(r.ok && r.data?.length)) return { error: 'Could not save the patient\'s details.' };
    // Activity log: which details changed, by field name only (never the values).
    const changed = Object.keys(c.fields).filter(k => JSON.stringify(/** @type {any} */ (c.fields)[k] ?? null) !== JSON.stringify(row[k] ?? null));
    if (changed.length) await require('./activity.cjs').byStaff(staff, 'clinic.patient_changed', { fields: changed }, { subjectPhone: phone });
    return { patient: r.data[0] };
  }
  if (!sent) return { error: 'Fill in the patient\'s details.' };
  const c = cleanPatient(sent);
  if ('error' in c) return { error: c.error };
  const ins = await dbRequest('clinic_patients', { method: 'POST', prefer: 'return=representation', body: { business_id: biz, lead_phone: phone, ...c.fields, created_by: String(staff.email || '').toLowerCase() } });
  return ins.ok && ins.data?.length ? { patient: ins.data[0] } : { error: 'Could not save the patient. Has SQL 20261140 been run?' };
}

// ---------------------------------------------------------------------------------------------
// Case sheets
// ---------------------------------------------------------------------------------------------

const EXT = /** @type {Record<string, string>} */ ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' });

/**
 * Store a photo: in Cloudinary (private, "authenticated") when it is configured, else the private Supabase bucket.
 * Each business has its own folder; names are random.
 * @param {string} biz @param {any} a the appointment @param {{ bytes: Buffer, mime: string, ext: string }} img
 * @returns {Promise<{ provider: 'cloudinary' | 'supabase', path: string } | { error: string }>}
 */
async function store(biz, a, img) {
  const folder = `${biz}/${a.patient_id || 'no-patient'}/${a.id}`;
  const name = crypto.randomUUID();
  if (cloudinary.ready()) {
    const up = await cloudinary.uploadPrivate(img.bytes, img.mime, { folder: `${BUCKET}/${folder}`, publicId: name });
    return 'error' in up ? { error: up.error } : { provider: 'cloudinary', path: up.publicId };
  }
  await storage.ensureBucket(BUCKET, { maxBytes: MAX_BYTES, mimeTypes: ['image/jpeg', 'image/png', 'image/webp'] });
  const path = `${folder}/${name}.${img.ext}`;
  return (await storage.upload(BUCKET, path, img.bytes, img.mime)) ? { provider: 'supabase', path } : { error: 'Could not store the photo. Try again.' };
}

/** A short-lived link to one stored photo. @param {{ path: string, mime?: string, provider?: string }} s */
async function linkFor(s) {
  if (s.provider === 'cloudinary') return cloudinary.privateUrl(s.path, EXT[String(s.mime)] || 'jpg', LINK_SECONDS);
  return storage.signedDownloadUrl(BUCKET, s.path, LINK_SECONDS);
}

/** Delete one stored photo. @param {{ path: string, provider?: string }} s */
async function removeStored(s) {
  if (s.provider === 'cloudinary') await cloudinary.destroy(s.path);
  else await storage.remove(BUCKET, [s.path]);
}

/** Sheets of some appointments, with short-lived links. @param {string} biz @param {string[]} apptIds */
async function sheetsFor(biz, apptIds) {
  if (!apptIds.length) return new Map();
  let r = await dbRequest(`clinic_case_sheets?business_id=eq.${biz}&appointment_id=in.(${apptIds.join(',')})&select=id,appointment_id,path,mime,provider,created_at&order=created_at.asc`);
  // A database from before the provider column: every photo is in the Supabase bucket.
  if (!r.ok) r = await dbRequest(`clinic_case_sheets?business_id=eq.${biz}&appointment_id=in.(${apptIds.join(',')})&select=id,appointment_id,path,mime,created_at&order=created_at.asc`);
  /** @type {Map<string, any[]>} */
  const by = new Map();
  for (const s of (r.ok && Array.isArray(r.data) ? r.data : [])) {
    const url = await linkFor(s);
    const list = by.get(s.appointment_id) || [];
    list.push({ id: s.id, url, addedAt: s.created_at });
    by.set(s.appointment_id, list);
  }
  return by;
}

/** The doctor's own appointment (any status), or null. @param {Doctor} doctor @param {string} id */
async function ownAppointment(doctor, id) {
  const a = await clinic.appointmentRow(doctor.businessId, id);
  return a && a.doctor_id === doctor.id ? a : null;
}

/** The doctor adds a photo of the written case sheet to their visit. @param {Doctor} doctor @param {string} id @param {any} input */
async function addSheet(doctor, id, input = {}) {
  const biz = doctor.businessId;
  const a = await ownAppointment(doctor, id);
  if (!a) return { error: 'Appointment not found.', status: 404 };
  if (!['confirmed', 'completed'].includes(a.status)) return { error: 'Case sheets can be added to paid or seen visits only.' };
  const img = readImage(input.image);
  if ('error' in img) return { error: img.error };
  const count = await dbRequest(`clinic_case_sheets?business_id=eq.${biz}&appointment_id=eq.${a.id}&select=id`);
  if (count.ok && Array.isArray(count.data) && count.data.length >= MAX_SHEETS_PER_VISIT) return { error: `At most ${MAX_SHEETS_PER_VISIT} photos per visit.` };
  const stored = await store(biz, a, img);
  if ('error' in stored) return { error: stored.error };
  const ins = await dbRequest('clinic_case_sheets', {
    method: 'POST', prefer: 'return=minimal',
    body: { business_id: biz, appointment_id: a.id, patient_id: a.patient_id || null, doctor_id: doctor.id, path: stored.path, provider: stored.provider, mime: img.mime, size_bytes: img.bytes.length, uploaded_by: doctor.email },
  });
  if (!ins.ok) { await removeStored({ path: stored.path, provider: stored.provider }); return { error: 'Could not save the photo. Has SQL 20261140 been run?' }; }
  await clinic.audit(doctor, biz, 'clinic.case_sheet_added', { appointment: a.id });
  return visit(doctor, a.id);
}

/** The doctor removes a photo from their own visit. @param {Doctor} doctor @param {string} id @param {string} sheetId */
async function removeSheet(doctor, id, sheetId) {
  const biz = doctor.businessId;
  const a = await ownAppointment(doctor, id);
  if (!a || !UUID_RE.test(sheetId)) return { error: 'Not found.', status: 404 };
  const r = await dbRequest(`clinic_case_sheets?business_id=eq.${biz}&appointment_id=eq.${a.id}&id=eq.${sheetId}`, { method: 'DELETE', prefer: 'return=representation' });
  if (!r.ok || !r.data?.length) return { error: 'Not found.', status: 404 };
  await removeStored(r.data[0]);
  await clinic.audit(doctor, biz, 'clinic.case_sheet_removed', { appointment: a.id });
  return visit(doctor, a.id);
}

// ---------------------------------------------------------------------------------------------
// Doctor: a visit, the patient's history, my patients, follow-up date
// ---------------------------------------------------------------------------------------------

/** Earlier and later visits of a patient at this hospital, with their sheets. @param {string} biz @param {string} patientId */
async function historyOf(biz, patientId) {
  const r = await dbRequest(`clinic_appointments?business_id=eq.${biz}&patient_id=eq.${patientId}&status=in.(confirmed,completed,no_show)&select=*&order=starts_at.desc&limit=100`);
  const rows = r.ok && Array.isArray(r.data) ? r.data : [];
  const sheets = await sheetsFor(biz, rows.map((/** @type {any} */ x) => x.id));
  const doctorIds = [...new Set(rows.map((/** @type {any} */ x) => x.doctor_id))];
  const d = doctorIds.length ? await dbRequest(`clinic_doctors?business_id=eq.${biz}&id=in.(${doctorIds.join(',')})&select=id,name`) : { ok: true, data: [] };
  const names = new Map((d.ok && Array.isArray(d.data) ? d.data : []).map((/** @type {any} */ x) => [x.id, x.name]));
  return rows.map((/** @type {any} */ x) => ({
    id: x.id, startsAt: x.starts_at, status: x.status, doctorName: names.get(x.doctor_id) || '', reason: x.reason || '',
    followUpOn: x.follow_up_on || null, followUpNote: x.follow_up_note || '', sheets: sheets.get(x.id) || [],
  }));
}

/** Everything the doctor needs for one of their visits. @param {Doctor} doctor @param {string} id */
async function visit(doctor, id) {
  const biz = doctor.businessId;
  const a = await ownAppointment(doctor, id);
  if (!a || a.status === 'pending_payment' || a.status === 'cancelled') return { error: 'Appointment not found.', status: 404 };
  const patient = a.patient_id ? await patientRow(biz, a.patient_id) : null;
  const sheets = await sheetsFor(biz, [a.id]);
  const history = patient ? (await historyOf(biz, patient.id)).filter(v => v.id !== a.id) : [];
  return {
    visit: {
      id: a.id, startsAt: a.starts_at, status: a.status, reason: a.reason || '', note: a.note || '',
      patientName: a.patient_name, followUpOn: a.follow_up_on || null, followUpNote: a.follow_up_note || '',
      sheets: sheets.get(a.id) || [],
    },
    patient: patient ? patientView(patient) : null,
    history,
  };
}

/** The doctor sets (or clears) the follow-up date of their visit. @param {Doctor} doctor @param {string} id @param {any} input */
async function setFollowUp(doctor, id, input = {}) {
  const biz = doctor.businessId;
  const a = await ownAppointment(doctor, id);
  if (!a || !['confirmed', 'completed'].includes(a.status)) return { error: 'Appointment not found.', status: 404 };
  /** @type {Record<string, unknown>} */
  let body;
  if (input.date === null || input.date === '') {
    body = { follow_up_on: null, follow_up_note: null, follow_up_set_by: doctor.email, follow_up_set_at: new Date().toISOString(), follow_up_done_at: null, follow_up_done_by: null };
  } else {
    const d = cleanFollowUpDate(input.date);
    if ('error' in d) return { error: d.error };
    body = { follow_up_on: d.day, follow_up_note: cleanText(input.note, 200) || null, follow_up_set_by: doctor.email, follow_up_set_at: new Date().toISOString(), follow_up_done_at: null, follow_up_done_by: null };
  }
  const r = await dbRequest(`clinic_appointments?business_id=eq.${biz}&id=eq.${a.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { ...body, updated_at: new Date().toISOString() } });
  if (!r.ok) return { error: 'Could not save the follow-up. Has SQL 20261140 been run?' };
  return visit(doctor, a.id);
}

/** Patients this doctor has seen (searchable by name). @param {Doctor} doctor @param {unknown} q */
async function myPatients(doctor, q) {
  const biz = doctor.businessId;
  const r = await dbRequest(`clinic_appointments?business_id=eq.${biz}&doctor_id=eq.${doctor.id}&status=in.(confirmed,completed)&patient_id=not.is.null&select=patient_id,starts_at,status&order=starts_at.desc&limit=2000`);
  if (!r.ok) return { error: 'Could not load your patients. Has SQL 20261140 been run?' };
  /** @type {Map<string, { last: string, visits: number }>} */
  const seen = new Map();
  for (const x of (r.data || [])) {
    const s = seen.get(x.patient_id);
    if (s) s.visits += 1; else seen.set(x.patient_id, { last: x.starts_at, visits: 1 });
  }
  if (!seen.size) return { patients: [] };
  const ids = [...seen.keys()].slice(0, 500);
  const p = await dbRequest(`clinic_patients?business_id=eq.${biz}&id=in.(${ids.join(',')})&select=*`);
  const term = cleanText(q, 60).toLowerCase();
  const list = (p.ok && Array.isArray(p.data) ? p.data : [])
    .filter((/** @type {any} */ x) => !term || String(x.name).toLowerCase().includes(term))
    .map((/** @type {any} */ x) => ({ ...patientView(x), lastVisit: seen.get(x.id)?.last || null, visits: seen.get(x.id)?.visits || 0 }))
    .sort((/** @type {any} */ a, /** @type {any} */ b) => String(b.lastVisit).localeCompare(String(a.lastVisit)));
  return { patients: list };
}

/** One patient's details and every visit at this hospital: only for a doctor who has seen them. @param {Doctor} doctor @param {string} id */
async function patientDetail(doctor, id) {
  const biz = doctor.businessId;
  const row = await patientRow(biz, id);
  if (!row) return { error: 'Patient not found.', status: 404 };
  const mine = await dbRequest(`clinic_appointments?business_id=eq.${biz}&doctor_id=eq.${doctor.id}&patient_id=eq.${row.id}&status=in.(confirmed,completed,no_show)&select=id&limit=1`);
  if (!(mine.ok && Array.isArray(mine.data) && mine.data.length)) return { error: 'Patient not found.', status: 404 };
  return { patient: patientView(row), visits: await historyOf(biz, row.id) };
}

// ---------------------------------------------------------------------------------------------
// Follow-ups (staff)
// ---------------------------------------------------------------------------------------------

/**
 * Due follow-ups: agents see those of their own chats (or that they booked); managers see all.
 * @param {Staff} staff @param {{ scope?: unknown }} q
 */
async function followUps(staff, q = {}) {
  const biz = requireBusinessId(staff.businessId);
  if (!(await clinic.isClinic(biz))) return { error: clinic.NOT_CLINIC, status: 403 };
  const r = await dbRequest(`clinic_appointments?business_id=eq.${biz}&follow_up_on=not.is.null&follow_up_done_at=is.null&select=id,doctor_id,patient_id,lead_phone,patient_name,starts_at,follow_up_on,follow_up_note,booked_by&order=follow_up_on.asc&limit=500`);
  if (!r.ok) return { error: 'Could not load follow-ups. Has SQL 20261140 been run?' };
  let rows = r.data || [];
  const me = String(staff.email || '').toLowerCase();
  const all = isManager(staff) && q.scope === 'all';
  if (!all) {
    const phones = [...new Set(rows.map((/** @type {any} */ x) => x.lead_phone))];
    const leads = phones.length ? await dbRequest(`whatsapp_leads?business_id=eq.${biz}&phone=in.(${phones.join(',')})&select=phone,assigned_to`) : { ok: true, data: [] };
    const owner = new Map((leads.ok && Array.isArray(leads.data) ? leads.data : []).map((/** @type {any} */ l) => [l.phone, String(l.assigned_to || '').toLowerCase()]));
    rows = rows.filter((/** @type {any} */ x) => owner.get(x.lead_phone) === me || (!owner.get(x.lead_phone) && String(x.booked_by || '').toLowerCase() === me));
  }
  const doctorIds = [...new Set(rows.map((/** @type {any} */ x) => x.doctor_id))];
  const d = doctorIds.length ? await dbRequest(`clinic_doctors?business_id=eq.${biz}&id=in.(${doctorIds.join(',')})&select=id,name`) : { ok: true, data: [] };
  const names = new Map((d.ok && Array.isArray(d.data) ? d.data : []).map((/** @type {any} */ x) => [x.id, x.name]));
  const today = clinic.istDay(Date.now());
  return {
    followUps: rows.map((/** @type {any} */ x) => ({
      appointmentId: x.id, patientId: x.patient_id, phone: x.lead_phone, patientName: x.patient_name, doctorId: x.doctor_id,
      doctorName: names.get(x.doctor_id) || '', lastVisit: x.starts_at, due: x.follow_up_on, note: x.follow_up_note || '',
      overdue: x.follow_up_on < today, dueToday: x.follow_up_on === today,
    })),
  };
}

/** Mark a follow-up done (patient called / not coming). @param {Staff} staff @param {string} id */
async function followUpDone(staff, id) {
  const biz = requireBusinessId(staff.businessId);
  if (!(await clinic.isClinic(biz))) return { error: clinic.NOT_CLINIC, status: 403 };
  const a = await clinic.appointmentRow(biz, id);
  if (!a || !a.follow_up_on) return { error: 'Follow-up not found.', status: 404 };
  if (!isManager(staff)) {
    const access = await require('./inbox.cjs').ensureCanAct(a.lead_phone, staff);
    if (access.error !== undefined) return access;
  }
  const upd = await dbRequest(`clinic_appointments?business_id=eq.${biz}&id=eq.${a.id}&follow_up_done_at=is.null`, { method: 'PATCH', prefer: 'return=representation', body: { follow_up_done_at: new Date().toISOString(), follow_up_done_by: String(staff.email || '').toLowerCase() } });
  if (upd.ok && Array.isArray(upd.data) && upd.data.length) await require('./activity.cjs').byStaff(staff, 'clinic.follow_up_done', { appointment: a.id }, { subjectPhone: a.lead_phone });
  return { done: true };
}

/** A new visit was booked for a patient: their open follow-ups are done. @param {string} biz @param {string} patientId @param {string} by */
async function closeFollowUpsOf(biz, patientId, by) {
  await dbRequest(`clinic_appointments?business_id=eq.${biz}&patient_id=eq.${patientId}&follow_up_on=not.is.null&follow_up_done_at=is.null`, {
    method: 'PATCH', prefer: 'return=minimal', body: { follow_up_done_at: new Date().toISOString(), follow_up_done_by: by },
  });
}

module.exports = {
  cleanPatient, currentAge, patientView, readImage, cleanFollowUpDate, MAX_BYTES, BUCKET,
  patientRow, patientsForPhone, resolvePatient,
  addSheet, removeSheet, visit, setFollowUp, myPatients, patientDetail,
  followUps, followUpDone, closeFollowUpsOf,
};
