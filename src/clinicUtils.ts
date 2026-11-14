// Clinic module helpers shared by the staff screens and the doctor area (India time, rupees).

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const IST_MS = 330 * 60000;

/** Today as 'YYYY-MM-DD' in India time. */
export const todayIst = (): string => new Date(Date.now() + IST_MS).toISOString().slice(0, 10);

/** 'YYYY-MM-DD' plus n days. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** "Mon, 16 Nov" for a 'YYYY-MM-DD' day. */
export function dayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
}

/** "9:30 am" (India time) for an ISO moment. */
export const timeOf = (iso: string): string => new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' });

/** "₹1,200" */
export const rupees = (n: number): string => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export type ApptStatus = 'pending_payment' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
export const APPT_STATUS: Record<ApptStatus, { label: string; cls: string }> = {
  pending_payment: { label: 'Waiting for payment', cls: 'bg-amber-50 text-amber-800' },
  confirmed: { label: 'Confirmed', cls: 'bg-sky-50 text-sky-800' },
  completed: { label: 'Seen', cls: 'bg-emerald-50 text-emerald-800' },
  cancelled: { label: 'Cancelled', cls: 'bg-slate-100 text-slate-500' },
  no_show: { label: 'No-show', cls: 'bg-slate-100 text-slate-600' },
};

export const PAY_METHOD: Record<string, string> = {
  razorpay_link: 'Online payment (Razorpay)', cash: 'Cash', upi_desk: 'PhonePe / UPI', card_desk: 'Card', other: 'Other',
};

export const GENDER_LABEL: Record<string, string> = { female: 'Female', male: 'Male', other: 'Other' };

export interface Patient { id: string; name: string; age: number | null; gender: string | null; city: string; allergies: string; conditions: string; lastVisit?: string | null; visits?: number }
export interface Sheet { id: string; url: string | null; addedAt: string }
export interface PastVisit { id: string; startsAt: string; status: ApptStatus; doctorName: string; reason: string; followUpOn: string | null; followUpNote: string; sheets: Sheet[] }
export interface FollowUp { appointmentId: string; patientId: string | null; phone: string; patientName: string; doctorId: string; doctorName: string; lastVisit: string; due: string; note: string; overdue: boolean; dueToday: boolean }

/** "Asha · 34 · Female · Guntur" */
export const patientLine = (p: Pick<Patient, 'age' | 'gender' | 'city'>): string =>
  [p.age !== null ? `${p.age} yrs` : '', p.gender ? GENDER_LABEL[p.gender] || p.gender : '', p.city].filter(Boolean).join(' · ');

/**
 * A photo from the camera / gallery, made smaller in the browser (at most 2000 px, JPEG) so it uploads quickly and
 * stays under the server's 4 MB limit. Returns a data URL.
 */
export async function shrinkPhoto(file: File): Promise<string> {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type) && !/\.(jpe?g|png|webp)$/i.test(file.name)) throw new Error('Pick a photo (JPEG, PNG or WebP).');
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('This photo can\'t be opened here. Try a JPEG or PNG.'); });
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser can\'t prepare the photo.');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  for (const q of [0.85, 0.7, 0.55]) {
    const url = canvas.toDataURL('image/jpeg', q);
    if (url.length < 5_000_000) return url;
  }
  throw new Error('The photo is too large. Try a smaller one.');
}

export interface Doctor { id: string; name: string; email?: string; specialty: string; fee: number; slotMinutes: number; active: boolean; loginReady: boolean }
export interface Payment { id: string; method: string; amount: number; status: string; link: string | null; receiptNo: string; recordedBy: string; paidAt: string | null; createdAt: string }
export interface Appointment {
  id: string; doctorId: string; doctorName: string; phone: string; patientName: string; startsAt: string; endsAt: string;
  status: ApptStatus; fee: number; note: string; bookedBy: string; confirmedAt: string | null; cancelledReason: string; payments: Payment[];
  patientId: string | null; reason: string; followUpOn: string | null; followUpNote: string; paymentMethod?: string | null;
}
