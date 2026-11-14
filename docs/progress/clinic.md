# Clinic module: appointments, payments, doctors, patient details, case sheets, follow-ups

For hospital / clinic businesses only (`businesses.industry = 'hospital'`). Other businesses never see it.

## The flow
Interested patient (chat) -> agent books an appointment: the **patient's details** (name, age, gender required;
city, allergies, existing conditions optional), the **reason for the visit**, a doctor and a free slot (fee from the
doctor's profile)
-> payment: Razorpay link sent in the chat, or cash / UPI / card at the desk recorded by the agent
-> paid -> appointment Confirmed -> it appears in the doctor's queue
-> the doctor opens the visit: patient details + reason + **earlier visits with their case-sheet photos**; uploads the
   photo of today's written case sheet; sets the **follow-up date**
-> the follow-up lands in the agent's **Follow-ups** list (Appointments → Follow-ups) -> "Book visit" books the return
   visit for the same patient and doctor (the follow-up closes by itself) -> on that visit the doctor sees the old sheet.

## Decisions (user, 2026-11-14)
- **Doctors log in** with their own role: their appointments, their patients, their hours. No inbox, chats or leads.
- **Doctors set their own available time slots** (weekly hours + days off).
- **The Business Admin or a manager onboards doctors** (invite by email) and sets each doctor's consultation fee.
  Agents can't change the fee.
- **The agent fills the patient's details when booking**; the **doctor** uploads the case-sheet photo and sets the
  follow-up date; a return visit shows the earlier sheets; the doctor has a list of patients they have seen.

## Design choices
- A doctor is **not** a `staff_members` row. Doctors live in `clinic_doctors` (with their login's `user_id`), so every
  existing staff rule (RLS on chats, `requireStaff`, the `/api` routes) already refuses them. Their API is
  `/api/doctor/...` (`requireDoctor`). Area `/doctor` in the browser.
- One login = one place: a login can't be both a doctor and staff / a platform admin (database triggers).
- **Razorpay's signed webhook decides "paid"**, never an agent. Money goes straight to the hospital's own Razorpay
  account; the CRM only creates payment links and stores no card details. Keys are stored encrypted
  (`secrets.cjs`); only the Business Admin sets them. "Check payment" asks Razorpay directly if the webhook is not set.
- Desk payments (cash / UPI at the counter / card machine / other) are recorded with who collected, amount and
  receipt number; audited.
- Patients: one WhatsApp number can have several patients (family); the booking form lists the chat's patients.
  Age is stored with the day it was given and grows from there.
- The doctor never sees the phone number. A doctor can open a patient's file only after having had an appointment
  with that patient; the file then shows all visits at this hospital (any doctor) with their sheets.
- Case sheets are photos, not typed records (no diagnoses / prescriptions typed in the CRM, no AI on medical content).
  JPEG / PNG / WebP checked by their bytes, ≤ 4 MB (the browser shrinks photos first; Netlify's request limit is
  ~6 MB), ≤ 12 per visit, audited (added / removed). Agents don't see the sheets.
- **Stored in Cloudinary** (user, 2026-11-14; `server/cloudinary.cjs`): signed uploads from the server only (API
  secret in `CLOUDINARY_API_SECRET`, never in the browser or git), type `authenticated` (no public link works),
  folder `case-sheets/<business id>/<patient>/<visit>/<random>`, viewed through Cloudinary's signed private download
  links that expire after 10 minutes, deleted in Cloudinary when the doctor removes a photo. Without the Cloudinary
  variables (local dev, tests) the private Supabase bucket `case-sheets` is used. `clinic_case_sheets.provider` says
  which. Not yet tried against the real Cloudinary account (needs the keys).
- Cloudinary is a new processor of patient data: list it in the Privacy Policy (processors / cross-border transfer).
- Follow-ups: agents see those of their own chats (or bookings they made on unassigned chats); managers can see all.
  Booking a new visit for the patient closes their open follow-ups; "Done" closes one by hand.
- Double booking: one active appointment per doctor per start time (unique index) + overlap check on the server.

## Stages
| Stage | What | Status |
|---|---|---|
| C1 | Doctors (onboarding, fee, slot length), doctor hours + days off, free slots, book / cancel / done / no-show, doctor area | built locally |
| C2 | Razorpay: keys, payment links sent in the chat, signed webhook, "Check payment" | built locally |
| C3 | Desk payments (cash, UPI, card, other) + manager's collection list | recording built; daily list next |
| C4 | Patient details at booking, case-sheet photos by the doctor, earlier sheets on return visits, My patients | built locally |
| C5 | Follow-up date by the doctor -> agents' Follow-ups list -> book the return visit | built locally (WhatsApp reminder next) |

## Done (LIVE 2026-11-14, deploy 6af83f79; SQL 20261139 + 20261140 run; Cloudinary tested with the real account)
- **SQL `20261139_clinic.sql`:** `clinic_settings` (Razorpay keys encrypted, webhook key, link hours), `clinic_doctors`,
  `clinic_doctor_hours`, `clinic_doctor_days_off`, `clinic_appointments` (unique active slot per doctor),
  `clinic_payments`. All server-only; a doctor's login may read only its own row's id / business / name / active.
  Triggers: a login can't be both a doctor and staff / a platform admin. `clinic_user_id_for_email` server-only.
- **SQL `20261140_clinic_patients.sql`:** `clinic_patients`; `clinic_appointments` + patient_id, reason, follow_up_*;
  `clinic_case_sheets`. Server-only.
- **Server:**
  - `server/clinic.cjs`: hospital check, doctors (invite, fee + slot length, audited fee changes, turn off),
    `requireDoctor`, the doctor's hours / days off / queue / "Seen", free slots (India time), booking (lead ownership
    via `inbox.ensureCanAct`, fee from the doctor, slot re-checked, patient + reason required), cancel / done /
    no-show, desk payments.
  - `server/clinicPay.cjs`: Razorpay keys, payment links (amount = fee, sent with `inbox.sendText`), signed webhook
    `POST /webhook/razorpay/<key>`, "Check payment", cancelling open links.
  - `server/clinicPatients.cjs`: patient details (clean / reuse / update), case-sheet photos (add / remove, bytes
    checked, private bucket), the doctor's visit view (patient, sheets, earlier visits), follow-up date, My patients,
    patient file, agents' follow-up list, follow-up done, auto-close on the next booking.
  - `server/clinicRoutes.cjs`: `/api/clinic/...` (staff) and `/api/doctor/...` (doctors). `app.cjs`: a 6 MB body limit
    only for `POST /api/doctor/appointments/:id/sheets`.
- **Screens:**
  - Work menu → **Appointments** (`src/AppointmentsScreen.tsx`): By day (book, payment link, desk payment, seen,
    no-show, cancel) and **Follow-ups** (due / today / overdue, Chat, Book visit, Done; managers: everyone's).
  - **Booking form** (`src/BookAppointmentModal.tsx`): the chat's patients or "New patient" (name, age, gender *,
    city, allergies, existing conditions), reason for the visit *, doctor, free time, note.
  - Settings → **Clinic** (`src/ClinicSettingsScreen.tsx`): doctors, Razorpay card with the webhook URL.
  - Inbox chat header → **Book appointment** (`src/ChatAppointmentButton.tsx`).
  - Doctor area **`/doctor`** (`src/DoctorApp.tsx`): My appointments → **visit** page (patient card with allergies in
    red, reason, case-sheet photos from the camera / gallery, follow-up date with +7 / +14 / +30 days, earlier visits
    with their sheets, Mark seen); **My patients** (search, visits count) → patient file; My hours.
  - Shown only for hospital businesses (`/api/clinic/status`). Shared helpers in `src/clinicUtils.ts`
    (`shrinkPhoto` makes photos ≤ 2000 px JPEG before upload).
- **Tests:** `tests/clinic.test.cjs` (13: pure rules, SQL rules, roles, ownership, tenancy, Razorpay, signed webhook,
  patient details, photos checked by bytes, other doctors refused, follow-ups per agent, return visit shows the old
  sheet); e2e "Clinic: an agent books…" (patient form + follow-ups tab) and "Clinic: a doctor signs in…" (visit page,
  photo upload, follow-up, earlier sheet, hours).

## Payment type at booking (LIVE 2026-11-14, deploy 6af867d7; SQL 20261141 run)
- Booking form → **Payment**: Online payment (Razorpay) / Cash / PhonePe / UPI / Card / Other (only when the fee is
  above 0). Saved as `clinic_appointments.payment_method` (SQL `20261141_clinic_payment_method.sql`; booking still
  works without the column).
- **Online:** only when Razorpay is connected; the link is created and sent in the chat right after booking; Razorpay
  confirms it by itself (webhook / "Check payment").
- **Desk ways:** the appointment waits for payment ("Will pay by …"), and staff press **Mark as paid** when it comes
  in (the chosen way is preselected). "Already paid now" in the booking form records it at once.
- **Reference ID required** for every way except cash (PhonePe / UPI transaction ID, card slip number, bank UTR…,
  at least 4 characters; "Other" also needs how it was paid). Stored on the payment (`receipt_no`), shown as
  "ref …" in the list.
- Tests: `tests/clinic.test.cjs` (+ payment-type test, reference rules); e2e "Clinic: an agent books…, picks PhonePe /
  UPI and marks it paid with the transaction ID".

## Collections + booking hints (LIVE 2026-11-14, deploy 6af867d7; no SQL)
- **Appointments → Collections** (managers + Business Admin; `server/clinicReport.cjs`, `GET /api/clinic/report`,
  `src/ClinicCollections.tsx`): Today / Yesterday / Last 7 / Last 30 days / pick dates (≤ 92 days).
  - Money paid in the range: collected, discounts, by payment type, by who took it (cash to hand over), by doctor,
    every payment with patient, doctor, type, reference and who took it. A payment counts on the day it was paid
    (an advance for a later visit counts today).
  - Appointments scheduled in the range: booked, confirmed-not-seen, seen, no-shows (show rate), cancelled, money
    still waiting; day-by-day bars for ranges.
- **Booking form:** "Still needed: …" next to Book (so it's clear why it's off); when a day has no free times it
  says whether the doctor has no hours at all, else jumps to the **next free day** (looks 60 days ahead).
- Tests: `tests/clinic.test.cjs` (report math + roles + tenancy, next free day); e2e "Clinic Collections (managers)".

## Next
- User: run SQL 20261139 then 20261140; set CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET in
  Netlify (and `.env` for local); then (Business Admin) Settings → Clinic: add doctors, Razorpay **test** keys + webhook.
- After the deploy: upload one test case sheet and check it opens, and that the plain Cloudinary address of the photo
  does not open.
- C3 list: manager's "collected today" per person and method.
- When an appointment is confirmed, move the lead to the first "won" status (status history).
- Optional WhatsApp reminder to the patient before the follow-up date (approved template, send window).
- Retention rule for case sheets (how long the hospital keeps them) once the hospital decides.

## Decisions log
- 2026-11-14: Doctor role = separate table, not a staff role (keeps chat RLS untouched and safe).
- 2026-11-14: The doctor (not the agent) uploads the case sheet; agents don't see the sheets.
