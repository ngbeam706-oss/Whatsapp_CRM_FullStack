// Clinic module (docs/progress/clinic.md): doctors, hours, slots, appointments, desk payments, Razorpay links.
// Part 1: pure rules. Part 2: SQL rules on PGlite (doctor is never staff, server-only tables, one booking per slot).
// Part 3: the API with a fake database and a fake Razorpay (roles, ownership, tenancy, signed webhook, no chats for doctors).
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');

const SUN = 'a0000000-0000-4000-8000-000000000001';
const LOTUS = 'b0000000-0000-4000-8000-000000000002';
process.env.APP_SECRET = 'server_encryption_secret_long_enough';
process.env.VITE_SUPABASE_URL = 'http://fake.supabase';
process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
process.env.PUBLIC_SITE_URL = 'https://crm.sunrise.example';
// Never the developer's real Cloudinary account from .env (dotenv doesn't override variables that are already set);
// the Cloudinary test switches it on with fake keys.
for (const k of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'CLOUDINARY_URL']) process.env[k] = '';

const app = require('../server/app.cjs');
const clinic = require('../server/clinic.cjs');
const { _setStaffForToken } = require('../server/auth.cjs');
const { _resetLimits } = require('../server/security.cjs');

// ---------------------------------------------------------------------------------------------
// Part 1: pure rules
// ---------------------------------------------------------------------------------------------
test('money, times and weekly hours are cleaned', () => {
  assert.equal(clinic.toPaise('1,200.50'), 120050);
  assert.equal(clinic.toPaise(500), 50000);
  assert.equal(clinic.toPaise('₹ 300'), 30000);
  assert.equal(clinic.toPaise('-1'), null);
  assert.equal(clinic.toPaise('abc'), null);
  assert.equal(clinic.toMin('09:30'), 570);
  assert.equal(clinic.toMin('24:00'), 1440);
  assert.equal(clinic.toMin('25:00'), null);
  assert.deepEqual(clinic.cleanHours([{ weekday: 1, start: '14:00', end: '17:00' }, { weekday: 1, start: '09:00', end: '13:00' }]),
    { hours: [{ weekday: 1, start_min: 540, end_min: 780 }, { weekday: 1, start_min: 840, end_min: 1020 }] });
  assert.match(clinic.cleanHours([{ weekday: 1, start: '09:00', end: '13:00' }, { weekday: 1, start: '12:00', end: '14:00' }]).error, /overlap/);
  assert.match(clinic.cleanHours([{ weekday: 1, start: '13:00', end: '09:00' }]).error, /before its end/);
  assert.match(clinic.cleanHours([{ weekday: 9, start: '09:00', end: '10:00' }]).error, /day of the week/);
});

test('free slots: India time, inside the hours, not taken, not on a day off, not in the past', () => {
  // 2026-11-16 is a Monday.
  const hours = [{ weekday: 1, start_min: 9 * 60, end_min: 10 * 60 }];
  const base = { day: '2026-11-16', hours, daysOff: [], taken: [], slotMinutes: 15, now: Date.parse('2026-11-01T00:00:00Z') };
  const all = clinic.freeSlots(base);
  assert.deepEqual(all.map(s => s.time), ['09:00', '09:15', '09:30', '09:45']);
  assert.equal(all[0].startsAt, '2026-11-16T03:30:00.000Z', '09:00 IST = 03:30 UTC');
  const taken = [{ starts_at: '2026-11-16T03:45:00.000Z', ends_at: '2026-11-16T04:00:00.000Z' }];
  assert.deepEqual(clinic.freeSlots({ ...base, taken }).map(s => s.time), ['09:00', '09:30', '09:45']);
  assert.deepEqual(clinic.freeSlots({ ...base, daysOff: ['2026-11-16'] }), []);
  assert.deepEqual(clinic.freeSlots({ ...base, day: '2026-11-17' }), [], 'Tuesday has no hours');
  assert.deepEqual(clinic.freeSlots({ ...base, now: Date.parse('2026-11-16T04:00:00Z') }).map(s => s.time), ['09:45'], 'past slots are gone');
  assert.deepEqual(clinic.freeSlots({ ...base, slotMinutes: 40 }).map(s => s.time), ['09:00'], 'a slot must fit before the end');
});

// ---------------------------------------------------------------------------------------------
// Part 2: SQL rules
// ---------------------------------------------------------------------------------------------
test('SQL: a doctor is never staff (and back), reads only their own row, everything else server-only; one booking per slot', async () => {
  const { freshDb, migrationSql, asUser } = require('./helpers/pgHarness.cjs');
  const pg = await freshDb();
  await pg.exec(migrationSql('20261139_clinic.sql')); // safe to re-run
  const biz = (await pg.query("insert into public.businesses (name, slug, plan_id) values ('Sunrise Clinic', 'sunrise-clinic', 'growth') returning id")).rows[0].id;
  const docUser = (await pg.query("insert into auth.users (email) values ('doc@sun.test') returning id")).rows[0].id;
  const doc2User = (await pg.query("insert into auth.users (email) values ('doc2@sun.test') returning id")).rows[0].id;
  const staffUser = (await pg.query("insert into auth.users (email) values ('agent@sun.test') returning id")).rows[0].id;
  await pg.query("insert into public.staff_members (user_id, email, role, business_id) values ($1, 'agent@sun.test', 'agent', $2)", [staffUser, biz]);
  const d = (await pg.query("insert into public.clinic_doctors (business_id, user_id, email, name, fee_paise) values ($1, $2, 'doc@sun.test', 'Dr Rao', 50000) returning id", [biz, docUser])).rows[0].id;
  await pg.query("insert into public.clinic_doctors (business_id, user_id, email, name) values ($1, $2, 'doc2@sun.test', 'Dr Iyer')", [biz, doc2User]);

  await assert.rejects(pg.query("insert into public.staff_members (user_id, email, role, business_id) values ($1, 'doc@sun.test', 'agent', $2)", [docUser, biz]), /doctor/);
  await assert.rejects(pg.query("insert into public.clinic_doctors (business_id, user_id, email, name) values ($1, $2, 'agent@sun.test', 'Not a doctor')", [biz, staffUser]), /belongs to someone else/);

  const own = await asUser(pg, docUser, () => pg.query('select id, name, business_id from public.clinic_doctors'));
  assert.deepEqual(own.rows.map(r => r.name), ['Dr Rao'], 'only their own row');
  await assert.rejects(asUser(pg, docUser, () => pg.query('select fee_paise from public.clinic_doctors')), 'the fee is not readable from the browser');
  for (const t of ['clinic_settings', 'clinic_appointments', 'clinic_payments', 'clinic_doctor_hours', 'clinic_doctor_days_off', 'clinic_patients', 'clinic_case_sheets']) {
    await assert.rejects(asUser(pg, docUser, () => pg.query(`select * from public.${t}`)), t);
    await assert.rejects(asUser(pg, staffUser, () => pg.query(`select * from public.${t}`)), t);
  }
  assert.equal((await asUser(pg, staffUser, () => pg.query('select id from public.clinic_doctors'))).rows.length, 0, 'staff read no doctor rows from the browser');
  await assert.rejects(asUser(pg, staffUser, () => pg.query("select public.clinic_user_id_for_email('doc@sun.test')")));

  const appt = (s) => pg.query("insert into public.clinic_appointments (business_id, doctor_id, lead_phone, patient_name, starts_at, ends_at, status, fee_paise) values ($1, $2, '919000000001', 'P', '2026-11-16T03:30:00Z', '2026-11-16T03:45:00Z', $3, 50000) returning id", [biz, d, s]);
  const first = (await appt('pending_payment')).rows[0].id;
  await assert.rejects(appt('confirmed'), /duplicate|unique/i, 'the same slot can\'t be booked twice');
  await pg.query("update public.clinic_appointments set status = 'cancelled' where id = $1", [first]);
  await appt('pending_payment'); // a cancelled slot is free again
});

// ---------------------------------------------------------------------------------------------
// Part 3: the API (fake database, fake Supabase Auth, fake Razorpay)
// ---------------------------------------------------------------------------------------------
let db, rzp, invites, files;
const cloud = { calls: [], files: new Map() };
/** The patient's details and the reason for the visit (required when booking). */
const PATIENT = { reason: 'Fever for 3 days', patient: { name: 'Asha', age: 34, gender: 'female', city: 'Guntur', allergies: 'Penicillin' } };
function seed() {
  db = {
    businesses: [{ id: SUN, name: 'Sunrise Clinic', status: 'active', industry: 'hospital' }, { id: LOTUS, name: 'Lotus Foods', status: 'active', industry: 'food' }],
    staff_members: [{ user_id: 'u-staff-a', email: 'a@sun.test', business_id: SUN }],
    whatsapp_leads: [
      { business_id: SUN, phone: '919000000001', name: 'Asha', assigned_to: null },
      { business_id: SUN, phone: '919000000002', name: 'Ravi', assigned_to: 'b@sun.test' },
      { business_id: LOTUS, phone: '919000000009', name: 'Lotus customer', assigned_to: null },
    ],
    clinic_settings: [], clinic_doctors: [], clinic_doctor_hours: [], clinic_doctor_days_off: [], clinic_appointments: [], clinic_payments: [],
    audit_log: [],
  };
  rzp = { links: new Map(), keysOk: true, made: [] };
  invites = [];
  files = new Map();
  _resetLimits();
}
const SKIP = new Set(['select', 'order', 'limit', 'offset', 'on_conflict']);
function matcher(u) {
  const filters = [...new URL(u).searchParams.entries()].filter(([k]) => !SKIP.has(k));
  return (r) => filters.every(([k, v]) => {
    const val = r[k] === undefined || r[k] === null ? null : String(r[k]);
    if (v.startsWith('eq.')) return val === v.slice(3);
    if (v.startsWith('neq.')) return val !== v.slice(4);
    if (v === 'is.null') return val === null;
    if (v === 'not.is.null') return val !== null;
    if (v.startsWith('in.(')) return v.slice(4, -1).split(',').includes(val);
    if (v.startsWith('gte.')) return val !== null && val >= v.slice(4);
    if (v.startsWith('gt.')) return val !== null && val > v.slice(3);
    if (v.startsWith('lt.')) return val !== null && val < v.slice(3);
    return true;
  });
}
// The query string can repeat a key (starts_at=gte...&starts_at=lt...): URLSearchParams.entries() keeps both.
const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
const ACTIVE = ['pending_payment', 'confirmed', 'completed'];
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  if (u.startsWith('https://api.cloudinary.com/v1_1/')) {
    const form = Object.fromEntries(new URLSearchParams(String(opts.body || '')));
    cloud.calls.push({ url: u, form });
    if (u.endsWith('/image/upload')) { const id = `${form.folder}/${form.public_id}`; cloud.files.set(id, form); return json({ public_id: id, format: 'jpg', type: form.type, bytes: 68 }); }
    if (u.endsWith('/image/destroy')) { cloud.files.delete(form.public_id); return json({ result: 'ok' }); }
    return json({}, 404);
  }
  if (u.startsWith('http://fake.supabase/storage/v1/')) {
    const rest = u.slice('http://fake.supabase/storage/v1'.length);
    if (rest.startsWith('/bucket')) return json({ name: 'case-sheets' });
    if (rest.startsWith('/object/sign/')) return json({ signedURL: rest.replace('/object/sign/', '/object/sign/') + '?token=t' });
    if (method === 'POST' && rest.startsWith('/object/')) { files.set(decodeURIComponent(rest.slice('/object/case-sheets/'.length)), opts.body); return json({ Key: rest }); }
    if (method === 'DELETE') { for (const k of JSON.parse(opts.body).prefixes) files.delete(k); return json([]); }
    return json({}, 404);
  }
  const body = opts.body ? JSON.parse(opts.body) : null;
  if (u.startsWith('https://api.razorpay.com/v1/')) {
    const auth = String(opts.headers?.Authorization || '');
    if (!rzp.keysOk || !auth.startsWith('Basic ')) return json({ error: { description: 'Authentication failed' } }, 401);
    const path = u.slice('https://api.razorpay.com/v1'.length).split('?')[0];
    if (path === '/payment_links' && method === 'GET') return json({ payment_links: [] });
    if (path === '/payment_links' && method === 'POST') {
      const id = `plink_${crypto.randomBytes(5).toString('hex')}`;
      const link = { id, short_url: `https://rzp.io/i/${id}`, status: 'created', amount: body.amount, amount_paid: 0, reference_id: body.reference_id, payments: [] };
      rzp.links.set(id, link); rzp.made.push(body);
      return json(link);
    }
    const m = /^\/payment_links\/(plink_[a-f0-9]+)(\/cancel)?$/.exec(path);
    if (m && rzp.links.has(m[1])) {
      const link = rzp.links.get(m[1]);
      if (m[2]) link.status = 'cancelled';
      return json(link);
    }
    return json({ error: { description: 'not found' } }, 404);
  }
  if (u.startsWith('http://fake.supabase/auth/v1/invite')) {
    invites.push(body.email);
    return json({ id: crypto.randomUUID(), email: body.email });
  }
  if (!u.startsWith('http://fake.supabase/rest/v1/')) return json({}, 503);
  const table = u.slice('http://fake.supabase/rest/v1/'.length).split('?')[0];
  if (table.startsWith('rpc/')) return json(null);
  const rows = db[table] || (db[table] = []);
  const match = matcher(u);
  if (method === 'GET') return json(rows.filter(match));
  if (method === 'POST') {
    const list = (Array.isArray(body) ? body : [body]).map(r => ({ ...r }));
    for (const r of list) {
      if (table === 'clinic_settings') {
        if (rows.some(x => x.business_id === r.business_id)) continue;
        r.webhook_key ||= crypto.randomBytes(16).toString('hex'); r.link_expiry_hours ||= 24;
      }
      if (table === 'clinic_doctors') { r.id ||= crypto.randomUUID(); r.slot_minutes ??= 15; r.active ??= true; r.fee_paise ??= 0; }
      if (table === 'clinic_appointments') {
        r.id ||= crypto.randomUUID();
        if (ACTIVE.includes(r.status) && rows.some(x => x.doctor_id === r.doctor_id && x.starts_at === r.starts_at && ACTIVE.includes(x.status))) return json({ code: '23505', message: 'duplicate key' }, 409);
      }
      if (table === 'clinic_patients' || table === 'clinic_case_sheets') { r.id ||= crypto.randomUUID(); r.created_at ||= new Date().toISOString(); r.updated_at ||= r.created_at; }
      if (table === 'clinic_payments') { r.id ||= crypto.randomUUID(); r.created_at ||= new Date().toISOString(); }
      rows.push(r);
    }
    return json(list, 201);
  }
  if (method === 'PATCH') { const hit = rows.filter(match); hit.forEach(r => Object.assign(r, body)); return json(hit); }
  if (method === 'DELETE') { const hit = rows.filter(match); db[table] = rows.filter(r => !hit.includes(r)); return json(hit); }
  return json([]);
};

let server, base;
before(async () => { server = app.listen(0); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
beforeEach(seed);
function request(method, path, token, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}), ...headers } },
      (res) => { let t = ''; res.on('data', c => { t += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch { /* text */ } resolve({ status: res.statusCode, text: t, json: j }); }); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const staff = (token, email, role, biz = SUN) => _setStaffForToken(token, { id: `u-${token}`, email, role, businessId: biz, businessName: '' });
staff('c-owner', 'owner@sun.test', 'owner');
staff('c-manager', 'manager@sun.test', 'manager');
staff('c-agent', 'a@sun.test', 'agent');
staff('c-agent-b', 'b@sun.test', 'agent');
staff('c-lotus', 'owner@lotus.test', 'owner', LOTUS);

/** A future Monday (India time) and its 09:00 slot. */
function nextMonday() {
  let t = Date.now() + 2 * 86400000;
  while (clinic.weekdayOf(clinic.istDay(t)) !== 1) t += 86400000;
  const day = clinic.istDay(t);
  return { day, nine: new Date(clinic.istMoment(day, 540)).toISOString(), nineFifteen: new Date(clinic.istMoment(day, 555)).toISOString() };
}
/** Manager adds a doctor with a fee; the doctor sets Monday 09:00-10:00. Returns the doctor id and its token. */
async function setUpDoctor(fee = 500) {
  const add = await request('POST', '/api/clinic/doctors', 'c-manager', { name: 'Dr Rao', email: 'rao@sun.test', specialty: 'General', fee });
  assert.equal(add.status, 200, add.text);
  const id = add.json.doctor.id;
  clinic._setDoctorForToken('c-doctor', { id, userId: db.clinic_doctors[0].user_id, email: 'rao@sun.test', name: 'Dr Rao', businessId: SUN });
  const h = await request('PUT', '/api/doctor/hours', 'c-doctor', { hours: [{ weekday: 1, start: '09:00', end: '10:00' }], slotMinutes: 15 });
  assert.equal(h.status, 200, h.text);
  return id;
}

test('only hospital businesses; only managers onboard doctors and set the fee (audited); agents see no emails', async () => {
  assert.equal((await request('GET', '/api/clinic/doctors', 'c-lotus')).status, 403, 'a food business has no clinic');
  assert.deepEqual((await request('GET', '/api/clinic/status', 'c-lotus')).json, { success: true, enabled: false });
  assert.equal((await request('POST', '/api/clinic/doctors', 'c-agent', { name: 'Dr X', email: 'x@sun.test', fee: 100 })).status, 403);
  const id = await setUpDoctor();
  assert.deepEqual(invites, ['rao@sun.test'], 'the doctor gets an invite email');
  assert.equal(db.clinic_doctors[0].fee_paise, 50000);
  assert.equal((await request('PATCH', `/api/clinic/doctors/${id}`, 'c-agent', { fee: 1 })).status, 403, 'agents can\'t change the fee');
  const fee = await request('PATCH', `/api/clinic/doctors/${id}`, 'c-manager', { fee: 700 });
  assert.equal(fee.json.doctor.fee, 700);
  const a = db.audit_log.find(x => x.action === 'clinic.doctor_updated');
  assert.deepEqual([a.details.fee_from, a.details.fee_to], [50000, 70000]);
  const seen = await request('GET', '/api/clinic/doctors', 'c-agent');
  assert.equal(seen.json.doctors[0].email, undefined, 'agents see name, fee and slot length, not the doctor\'s email');
  assert.match((await request('POST', '/api/clinic/doctors', 'c-manager', { name: 'Dr A', email: 'a@sun.test', fee: 1 })).json.error, /staff login/, 'a staff email can\'t be a doctor');
});

test('doctors: only their own area; no chats or staff API; staff can\'t use the doctor API', async () => {
  await setUpDoctor();
  assert.equal((await request('GET', '/api/doctor/appointments', 'c-doctor')).status, 200);
  for (const p of ['/api/inbox', '/api/clinic/appointments', '/api/clinic/doctors', '/api/leads']) {
    assert.equal((await request('GET', p, 'c-doctor')).status, 403, p);
  }
  assert.equal((await request('GET', '/api/doctor/appointments', 'c-agent')).status, 403);
  assert.equal((await request('GET', '/api/doctor/appointments')).status, 401);
});

test('booking: own chats only, fee from the doctor, only free slots, no double booking, tenancy', async () => {
  const id = await setUpDoctor();
  const { day, nine, nineFifteen } = nextMonday();
  const slots = await request('GET', `/api/clinic/doctors/${id}/slots?day=${day}`, 'c-agent');
  assert.deepEqual(slots.json.slots.map(s => s.time), ['09:00', '09:15', '09:30', '09:45']);
  assert.equal((await request('POST', '/api/clinic/appointments', 'c-agent', { phone: '919000000002', doctorId: id, startsAt: nine, ...PATIENT })).status, 403, 'Ravi\'s chat belongs to b@');
  assert.match((await request('POST', '/api/clinic/appointments', 'c-agent', { phone: '919000000001', doctorId: id, startsAt: new Date(Date.parse(nine) + 7 * 60000).toISOString(), ...PATIENT })).json.error, /not free/, 'not a slot start');
  const ok = await request('POST', '/api/clinic/appointments', 'c-agent', { phone: '919000000001', doctorId: id, startsAt: nine, fee: 1, note: 'First visit', ...PATIENT });
  assert.equal(ok.status, 200, ok.text);
  assert.deepEqual([ok.json.appointment.status, ok.json.appointment.fee, ok.json.appointment.patientName], ['pending_payment', 500, 'Asha'], 'the fee is the doctor\'s, not typed');
  assert.equal(db.whatsapp_leads[0].assigned_to, 'a@sun.test', 'booking claims an unassigned chat');
  assert.match((await request('POST', '/api/clinic/appointments', 'c-agent', { phone: '919000000001', doctorId: id, startsAt: nine, ...PATIENT })).json.error, /not free/);
  assert.equal((await request('POST', '/api/clinic/appointments', 'c-manager', { phone: '919000000001', doctorId: id, startsAt: nineFifteen, ...PATIENT })).status, 403, 'the chat is now a@\'s');
  const after = await request('GET', `/api/clinic/doctors/${id}/slots?day=${day}`, 'c-agent');
  assert.ok(!after.json.slots.some(s => s.startsAt === nine) && after.json.slots.some(s => s.startsAt === nineFifteen));
  // Another business sees nothing of it.
  const apptId = ok.json.appointment.id;
  assert.equal((await request('POST', `/api/clinic/appointments/${apptId}/desk-payment`, 'c-lotus', { method: 'cash' })).status, 403);
  db.businesses[1].industry = 'hospital';
  assert.equal((await request('POST', `/api/clinic/appointments/${apptId}/desk-payment`, 'c-lotus', { method: 'cash' })).status, 404);
  assert.deepEqual((await request('GET', `/api/clinic/appointments?day=${day}`, 'c-lotus')).json.appointments, []);
});

test('desk payments: full fee confirms; a discount is for managers; doctor\'s queue shows it without the phone number', async () => {
  const id = await setUpDoctor();
  const { day, nine } = nextMonday();
  const appt = (await request('POST', '/api/clinic/appointments', 'c-agent', { phone: '919000000001', doctorId: id, startsAt: nine, ...PATIENT })).json.appointment;
  assert.deepEqual((await request('GET', `/api/doctor/appointments?day=${day}`, 'c-doctor')).json.appointments, [], 'unpaid bookings aren\'t in the queue');
  assert.equal((await request('POST', `/api/clinic/appointments/${appt.id}/desk-payment`, 'c-agent', { method: 'cash', amount: 300 })).status, 403, 'agent discount refused');
  assert.match((await request('POST', `/api/clinic/appointments/${appt.id}/desk-payment`, 'c-agent', { method: 'cash', amount: 900 })).json.error, /more than the fee/);
  assert.match((await request('POST', `/api/clinic/appointments/${appt.id}/desk-payment`, 'c-agent', { method: 'other' })).json.error, /how it was paid/);
  const paid = await request('POST', `/api/clinic/appointments/${appt.id}/desk-payment`, 'c-agent', { method: 'cash', receiptNo: 'R-101' });
  assert.equal(paid.status, 200, paid.text);
  assert.equal(paid.json.appointment.status, 'confirmed');
  assert.deepEqual(paid.json.appointment.payments.map(p => [p.method, p.amount, p.status, p.receiptNo, p.recordedBy]), [['cash', 500, 'recorded', 'R-101', 'a@sun.test']]);
  assert.match((await request('POST', `/api/clinic/appointments/${appt.id}/desk-payment`, 'c-agent', { method: 'cash' })).json.error, /not waiting/, 'paid once');
  assert.equal((await request('POST', `/api/clinic/appointments/${appt.id}/status`, 'c-agent', { status: 'cancelled' })).status, 403, 'a paid booking is cancelled by a manager');
  const q = await request('GET', `/api/doctor/appointments?day=${day}`, 'c-doctor');
  assert.deepEqual(q.json.appointments.map(a => [a.patientName, a.status, a.phone]), [['Asha', 'confirmed', undefined]]);
  assert.ok(!q.text.includes('919000000001'), 'no phone number anywhere in the doctor\'s answer');
  assert.equal((await request('POST', `/api/doctor/appointments/${appt.id}/seen`, 'c-doctor')).json.appointment.status, 'completed');
});

test('Razorpay: Business Admin only, keys checked and encrypted; link amount = fee; signed webhook confirms; bad signature or key refused', async () => {
  const id = await setUpDoctor();
  const { nine } = nextMonday();
  const keys = { keyId: 'rzp_test_AbCdEf123456', keySecret: 'secret_value_123', webhookSecret: 'whsec_sunrise' };
  assert.equal((await request('PUT', '/api/clinic/razorpay', 'c-manager', keys)).status, 403);
  rzp.keysOk = false;
  assert.match((await request('PUT', '/api/clinic/razorpay', 'c-owner', keys)).json.error, /refused these keys/);
  rzp.keysOk = true;
  const saved = await request('PUT', '/api/clinic/razorpay', 'c-owner', keys);
  assert.equal(saved.status, 200, saved.text);
  assert.ok(!saved.text.includes('secret_value_123') && !saved.text.includes('whsec_sunrise'), 'secrets never come back');
  const row = db.clinic_settings[0];
  assert.ok(!JSON.stringify(row).includes('secret_value_123') && !JSON.stringify(row).includes('whsec_sunrise'), 'stored encrypted');
  assert.equal(saved.json.razorpay.webhookUrl, `https://crm.sunrise.example/webhook/razorpay/${row.webhook_key}`);

  const appt = (await request('POST', '/api/clinic/appointments', 'c-agent', { phone: '919000000001', doctorId: id, startsAt: nine, ...PATIENT })).json.appointment;
  assert.equal((await request('POST', `/api/clinic/appointments/${appt.id}/payment-link`, 'c-agent-b', {})).status, 403, 'only whoever can act on the chat');
  const link = await request('POST', `/api/clinic/appointments/${appt.id}/payment-link`, 'c-agent', { amount: 1 });
  assert.equal(link.status, 200, link.text);
  assert.equal(rzp.made[0].amount, 50000, 'the amount is the fee');
  assert.match(link.json.message, /Consultation fee: ₹500/);
  const again = await request('POST', `/api/clinic/appointments/${appt.id}/payment-link`, 'c-agent', {});
  assert.equal(again.json.link, link.json.link, 'an open link is reused');
  const plink = db.clinic_payments[0].razorpay_link_id;

  const event = JSON.stringify({ event: 'payment_link.paid', payload: { payment_link: { entity: { id: plink, amount_paid: 50000 } }, payment: { entity: { id: 'pay_123', amount: 50000 } } } });
  const sign = (secret, b) => crypto.createHmac('sha256', secret).update(b).digest('hex');
  assert.equal((await request('POST', `/webhook/razorpay/${row.webhook_key}`, null, event, { 'X-Razorpay-Signature': sign('wrong', event) })).status, 401);
  assert.equal(db.clinic_appointments[0].status, 'pending_payment');
  assert.equal((await request('POST', `/webhook/razorpay/${'0'.repeat(32)}`, null, event, { 'X-Razorpay-Signature': sign('whsec_sunrise', event) })).status, 404);
  const ok = await request('POST', `/webhook/razorpay/${row.webhook_key}`, null, event, { 'X-Razorpay-Signature': sign('whsec_sunrise', event) });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(db.clinic_appointments[0].status, 'confirmed');
  assert.deepEqual([db.clinic_payments[0].status, db.clinic_payments[0].razorpay_payment_id], ['paid', 'pay_123']);
  const replay = await request('POST', `/webhook/razorpay/${row.webhook_key}`, null, event, { 'X-Razorpay-Signature': sign('whsec_sunrise', event) });
  assert.equal(replay.json.already, true, 'a repeated webhook changes nothing');
});

test('"Check payment" asks Razorpay; cancelling an unpaid booking cancels its link and frees the slot', async () => {
  const id = await setUpDoctor();
  const { day, nine } = nextMonday();
  await request('PUT', '/api/clinic/razorpay', 'c-owner', { keyId: 'rzp_test_AbCdEf123456', keySecret: 'secret_value_123' });
  const a1 = (await request('POST', '/api/clinic/appointments', 'c-agent', { phone: '919000000001', doctorId: id, startsAt: nine, ...PATIENT })).json.appointment;
  await request('POST', `/api/clinic/appointments/${a1.id}/payment-link`, 'c-agent', {});
  const plink = db.clinic_payments[0].razorpay_link_id;
  const c = await request('POST', `/api/clinic/appointments/${a1.id}/status`, 'c-agent', { status: 'cancelled', reason: 'Patient busy' });
  assert.equal(c.json.appointment.status, 'cancelled');
  assert.equal(rzp.links.get(plink).status, 'cancelled', 'Razorpay link cancelled');
  assert.equal(db.clinic_payments[0].status, 'cancelled');
  assert.ok((await request('GET', `/api/clinic/doctors/${id}/slots?day=${day}`, 'c-agent')).json.slots.some(s => s.startsAt === nine), 'slot free again');

  const a2 = (await request('POST', '/api/clinic/appointments', 'c-agent', { phone: '919000000001', doctorId: id, startsAt: nine, ...PATIENT })).json.appointment;
  await request('POST', `/api/clinic/appointments/${a2.id}/payment-link`, 'c-agent', {});
  const l2 = rzp.links.get(db.clinic_payments[1].razorpay_link_id);
  Object.assign(l2, { status: 'paid', amount_paid: 50000, payments: [{ payment_id: 'pay_999' }] });
  const chk = await request('POST', `/api/clinic/appointments/${a2.id}/check-payment`, 'c-agent');
  assert.equal(chk.json.appointment.status, 'confirmed');
});

// ---------------------------------------------------------------------------------------------
// Part 2: patient details, case sheets, follow-ups (SQL 20261140)
// ---------------------------------------------------------------------------------------------
const pat = require('../server/clinicPatients.cjs');
const JPEG = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]).toString('base64')}`;

test('pure: patient details required, age grows, photos checked by their bytes, follow-up dates', () => {
  assert.match(pat.cleanPatient({ age: 30, gender: 'male' }).error, /full name/);
  assert.match(pat.cleanPatient({ name: 'Ravi', gender: 'male' }).error, /age/);
  assert.match(pat.cleanPatient({ name: 'Ravi', age: 30 }).error, /gender/);
  assert.match(pat.cleanPatient({ name: 'Ravi', age: 131, gender: 'male' }).error, /age/);
  const ok = pat.cleanPatient({ name: ' Ravi Kumar ', age: '30', gender: 'male', allergies: 'None' });
  assert.deepEqual([ok.fields.name, ok.fields.age_years, ok.fields.gender, ok.fields.allergies, ok.fields.city], ['Ravi Kumar', 30, 'male', 'None', null]);
  assert.equal(pat.currentAge({ age_years: 30, age_on: '2024-01-01' }, Date.parse('2026-06-01')), 32);
  assert.equal(pat.readImage(JPEG).mime, 'image/jpeg');
  assert.match(pat.readImage(`data:image/jpeg;base64,${Buffer.from('<svg onload=alert(1)>').toString('base64')}`).error, /Only JPEG/, 'a fake "jpeg" is refused');
  assert.match(pat.readImage('not base64 !!').error, /photo/);
  assert.match(pat.cleanFollowUpDate('2020-01-01').error, /past/);
  assert.ok('day' in pat.cleanFollowUpDate(clinic.istDay(Date.now() + 14 * 86400000)));
});

/** Book Monday 09:00 for Asha (agent a), pay at the desk. */
async function paidVisit(id, startsAt, extra = PATIENT) {
  const b = await request('POST', '/api/clinic/appointments', 'c-agent', { phone: '919000000001', doctorId: id, startsAt, ...extra });
  assert.equal(b.status, 200, b.text);
  await request('POST', `/api/clinic/appointments/${b.json.appointment.id}/desk-payment`, 'c-agent', { method: 'cash' });
  return b.json.appointment;
}

test('booking needs the patient\'s details and the reason; a chat\'s patients are listed and reused', async () => {
  const id = await setUpDoctor();
  const { nine, nineFifteen } = nextMonday();
  assert.match((await request('POST', '/api/clinic/appointments', 'c-agent', { phone: '919000000001', doctorId: id, startsAt: nine, patient: PATIENT.patient })).json.error, /reason/);
  assert.match((await request('POST', '/api/clinic/appointments', 'c-agent', { phone: '919000000001', doctorId: id, startsAt: nine, reason: 'Fever' })).json.error, /patient's details/);
  assert.match((await request('POST', '/api/clinic/appointments', 'c-agent', { phone: '919000000001', doctorId: id, startsAt: nine, reason: 'Fever', patient: { name: 'Asha' } })).json.error, /age/);
  const a = await paidVisit(id, nine);
  assert.deepEqual([a.patientName, a.reason], ['Asha', 'Fever for 3 days']);
  const list = await request('GET', '/api/clinic/patients?phone=919000000001', 'c-agent');
  assert.deepEqual(list.json.patients.map(p => [p.name, p.age, p.gender, p.allergies]), [['Asha', 34, 'female', 'Penicillin']]);
  // A second visit for the same patient reuses her record; another business can't use it.
  const again = await request('POST', '/api/clinic/appointments', 'c-agent', { phone: '919000000001', doctorId: id, startsAt: nineFifteen, reason: 'Review', patientId: list.json.patients[0].id });
  assert.equal(again.status, 200, again.text);
  assert.equal(db.clinic_patients.length, 1);
  db.whatsapp_leads.push({ business_id: SUN, phone: '919000000005', name: 'Other', assigned_to: null });
  assert.match((await request('POST', '/api/clinic/appointments', 'c-agent', { phone: '919000000005', doctorId: id, startsAt: new Date(Date.parse(nine) + 30 * 60000).toISOString(), reason: 'x-ray', patientId: list.json.patients[0].id })).json.error, /not on this chat/);
});

test('doctor: visit with the patient\'s details (no phone), case-sheet photos, follow-up date; only their own visits', async () => {
  const id = await setUpDoctor();
  const { nine } = nextMonday();
  const a = await paidVisit(id, nine);
  const v = await request('GET', `/api/doctor/appointments/${a.id}`, 'c-doctor');
  assert.equal(v.status, 200, v.text);
  assert.deepEqual([v.json.patient.name, v.json.patient.age, v.json.patient.allergies, v.json.visit.reason], ['Asha', 34, 'Penicillin', 'Fever for 3 days']);
  assert.ok(!v.text.includes('919000000001'), 'no phone number for the doctor');
  const up = await request('POST', `/api/doctor/appointments/${a.id}/sheets`, 'c-doctor', { image: JPEG });
  assert.equal(up.status, 200, up.text);
  assert.equal(up.json.visit.sheets.length, 1);
  assert.match(up.json.visit.sheets[0].url, /^http:\/\/fake\.supabase\/storage\/v1\/object\/sign\/case-sheets\//);
  assert.equal(files.size, 1);
  assert.ok([...files.keys()][0].startsWith(`${SUN}/`), 'stored under the business\'s folder');
  assert.equal(db.audit_log.filter(x => x.action === 'clinic.case_sheet_added').length, 1);
  // Another doctor of the same hospital can't open or add to it.
  clinic._setDoctorForToken('c-doctor2', { id: crypto.randomUUID(), userId: crypto.randomUUID(), email: 'iyer@sun.test', name: 'Dr Iyer', businessId: SUN });
  assert.equal((await request('GET', `/api/doctor/appointments/${a.id}`, 'c-doctor2')).status, 404);
  assert.equal((await request('POST', `/api/doctor/appointments/${a.id}/sheets`, 'c-doctor2', { image: JPEG })).status, 404);
  // Follow-up date.
  assert.match((await request('PUT', `/api/doctor/appointments/${a.id}/follow-up`, 'c-doctor', { date: '2020-01-01' })).json.error, /past/);
  const due = clinic.istDay(Date.now() + 14 * 86400000);
  const fu = await request('PUT', `/api/doctor/appointments/${a.id}/follow-up`, 'c-doctor', { date: due, note: 'Review blood report' });
  assert.deepEqual([fu.json.visit.followUpOn, fu.json.visit.followUpNote], [due, 'Review blood report']);
  // Remove the photo.
  const sheetId = up.json.visit.sheets[0].id;
  assert.equal((await request('DELETE', `/api/doctor/appointments/${a.id}/sheets/${sheetId}`, 'c-doctor')).json.visit.sheets.length, 0);
  assert.equal(files.size, 0);
});

test('follow-ups go to the chat\'s agent (managers see all); booking the return visit closes it; the old sheet loads on the return visit', async () => {
  const id = await setUpDoctor();
  const { nine } = nextMonday();
  const a = await paidVisit(id, nine);
  await request('POST', `/api/doctor/appointments/${a.id}/sheets`, 'c-doctor', { image: JPEG });
  const due = clinic.istDay(Date.now() + 14 * 86400000);
  await request('PUT', `/api/doctor/appointments/${a.id}/follow-up`, 'c-doctor', { date: due });
  const mine = await request('GET', '/api/clinic/follow-ups', 'c-agent');
  assert.deepEqual(mine.json.followUps.map(f => [f.patientName, f.due, f.doctorName]), [['Asha', due, 'Dr Rao']]);
  assert.deepEqual((await request('GET', '/api/clinic/follow-ups', 'c-agent-b')).json.followUps, [], 'not b\'s chat');
  assert.equal((await request('GET', '/api/clinic/follow-ups?scope=all', 'c-manager')).json.followUps.length, 1);
  assert.equal((await request('GET', '/api/clinic/follow-ups?scope=all', 'c-agent-b')).json.followUps.length, 0, 'agents can\'t ask for all');
  // The return visit.
  const later = new Date(Date.parse(nine) + 7 * 86400000).toISOString();
  const r = await paidVisit(id, later, { reason: 'Follow-up', patientId: mine.json.followUps[0].patientId });
  assert.deepEqual((await request('GET', '/api/clinic/follow-ups', 'c-agent')).json.followUps, [], 'booked: off the list');
  const v = await request('GET', `/api/doctor/appointments/${r.id}`, 'c-doctor');
  assert.equal(v.json.history.length, 1, 'the earlier visit');
  assert.equal(v.json.history[0].sheets.length, 1, 'with its case-sheet photo');
  // My patients + one patient's file; a doctor who never saw her gets nothing.
  clinic._setDoctorForToken('c-doctor2', { id: crypto.randomUUID(), userId: crypto.randomUUID(), email: 'iyer@sun.test', name: 'Dr Iyer', businessId: SUN });
  const list = await request('GET', '/api/doctor/patients?q=ash', 'c-doctor');
  assert.deepEqual(list.json.patients.map(p => [p.name, p.visits]), [['Asha', 2]]);
  const file = await request('GET', `/api/doctor/patients/${list.json.patients[0].id}`, 'c-doctor');
  assert.equal(file.json.visits.length, 2);
  assert.equal((await request('GET', `/api/doctor/patients/${list.json.patients[0].id}`, 'c-doctor2')).status, 404);
  assert.equal((await request('GET', '/api/clinic/follow-ups', 'c-lotus')).status, 403, 'not a clinic');
});

// ---------------------------------------------------------------------------------------------
// Case sheets in Cloudinary (server/cloudinary.cjs)
// ---------------------------------------------------------------------------------------------
const cld = require('../server/cloudinary.cjs');
const { config } = require('../server/config.cjs');

test('Cloudinary signature matches Cloudinary\'s documented example', () => {
  // docs: "Generating authentication signatures" (api_secret abcd).
  assert.equal(cld.sign({ eager: 'w_400,h_300,c_pad|w_260,h_200,c_crop', public_id: 'sample_image', timestamp: 1315060510 }, 'abcd'), 'bfd09f95f331f558cbd1320e67aa8d488770583e');
  assert.equal(cld.sign({ public_id: 'x', timestamp: 1, file: 'ignored', api_key: 'ignored' }, 's'), cld.sign({ public_id: 'x', timestamp: 1 }, 's'), 'file and api_key are not signed');
});

test('case sheets go to Cloudinary when configured: signed private upload, expiring links, delete; the secret never leaves the server', async () => {
  Object.assign(config, { cloudinaryCloudName: 'sunrisecloud', cloudinaryApiKey: '123456789012345', cloudinaryApiSecret: 'cld_secret_value' });
  cloud.calls = []; cloud.files.clear();
  try {
    const id = await setUpDoctor();
    const { nine } = nextMonday();
    const a = await paidVisit(id, nine);
    const up = await request('POST', `/api/doctor/appointments/${a.id}/sheets`, 'c-doctor', { image: JPEG });
    assert.equal(up.status, 200, up.text);
    assert.equal(files.size, 0, 'nothing in the Supabase bucket');
    const call = cloud.calls.find(c => c.url.endsWith('/image/upload'));
    assert.equal(call.url, 'https://api.cloudinary.com/v1_1/sunrisecloud/image/upload');
    assert.equal(call.form.type, 'authenticated', 'private: no public link works');
    assert.ok(call.form.folder.startsWith(`case-sheets/${SUN}/`), 'the business\'s own folder');
    assert.match(call.form.file, /^data:image\/jpeg;base64,/);
    const { file, api_key: key, signature, ...signedParams } = call.form;
    assert.equal(key, '123456789012345');
    assert.equal(signature, cld.sign(signedParams, 'cld_secret_value'), 'a valid signature');
    assert.ok(!JSON.stringify(cloud.calls).includes('cld_secret_value'), 'the secret is never sent');
    assert.equal(db.clinic_case_sheets[0].provider, 'cloudinary');
    // The doctor gets a short-lived private download link.
    const link = new URL(up.json.visit.sheets[0].url);
    assert.equal(`${link.origin}${link.pathname}`, 'https://api.cloudinary.com/v1_1/sunrisecloud/image/download');
    const q = Object.fromEntries(link.searchParams);
    assert.equal(q.type, 'authenticated');
    assert.ok(Number(q.expires_at) - Number(q.timestamp) === 600, 'expires after 10 minutes');
    const { signature: s2, api_key: k2, ...p2 } = q;
    assert.equal(s2, cld.sign(p2, 'cld_secret_value'));
    assert.ok(!up.text.includes('cld_secret_value'));
    // Remove: deleted in Cloudinary too.
    const del = await request('DELETE', `/api/doctor/appointments/${a.id}/sheets/${up.json.visit.sheets[0].id}`, 'c-doctor');
    assert.equal(del.json.visit.sheets.length, 0);
    assert.equal(cloud.files.size, 0);
  } finally {
    Object.assign(config, { cloudinaryCloudName: '', cloudinaryApiKey: '', cloudinaryApiSecret: '' });
  }
});
