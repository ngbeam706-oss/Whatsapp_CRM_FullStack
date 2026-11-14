// @ts-check
// Clinic payments through the hospital's OWN Razorpay account (Payment Links API). docs/progress/clinic.md
//
//   * Only the Business Admin saves the keys (Key ID + Key Secret + Webhook Secret); secrets are encrypted
//     (server/secrets.cjs) and never sent back to the browser. The keys are checked with Razorpay before saving.
//   * An agent creates a payment link for an unpaid appointment (amount = the appointment's fee, never typed) and the
//     server sends it in the chat (WhatsApp 24-hour rule and lead ownership apply, via inbox.sendText).
//   * "Paid" comes only from Razorpay: the signed webhook (POST /webhook/razorpay/<key>, X-Razorpay-Signature =
//     HMAC-SHA256 of the raw body with the webhook secret) or "Check payment" (asks Razorpay for the link's status).
//   * The money goes straight to the hospital's Razorpay account; the CRM never holds it or sees card details.
const crypto = require('crypto');
const { dbRequest } = require('./db.cjs');
const { requireBusinessId } = require('./tenant.cjs');
const secrets = require('./secrets.cjs');
const clinic = require('./clinic.cjs');

/** @typedef {import('./types.cjs').Staff} Staff */

const API = 'https://api.razorpay.com/v1';
const KEY_ID_RE = /^rzp_(test|live)_[A-Za-z0-9]{8,32}$/;
const TIMEOUT_MS = 10000;

/** @param {string} biz */
async function settingsRow(biz) {
  const r = await dbRequest(`clinic_settings?business_id=eq.${biz}&select=*`);
  return r.ok && Array.isArray(r.data) ? r.data[0] || null : null;
}

/** Basic-auth header for Razorpay. @param {string} keyId @param {string} secret */
const authHeader = (keyId, secret) => `Basic ${Buffer.from(`${keyId}:${secret}`).toString('base64')}`;

/**
 * One Razorpay API call. Never throws.
 * @param {{ keyId: string, secret: string }} keys @param {string} path @param {{ method?: string, body?: unknown }} [opts]
 * @returns {Promise<{ ok: boolean, status: number, data: any }>}
 */
async function rzp(keys, path, { method = 'GET', body } = {}) {
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: authHeader(keys.keyId, keys.secret), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

/** The business's keys, decrypted; null when not set up. @param {any} row */
function keysOf(row) {
  if (!row?.razorpay_key_id) return null;
  const secret = secrets.decrypt(row.razorpay_secret_enc);
  return secret ? { keyId: row.razorpay_key_id, secret } : null;
}

/** Webhook address of a business. @param {string} key */
async function webhookUrlFor(key) {
  return `${await require('./siteUrl.cjs').siteUrl()}/webhook/razorpay/${key}`;
}

/** Settings as managers see them (no secrets). @param {Staff} staff */
async function view(staff) {
  const biz = requireBusinessId(staff.businessId);
  if (!(await clinic.isClinic(biz))) return { error: clinic.NOT_CLINIC, status: 403 };
  let row = await settingsRow(biz);
  if (!row) {
    const ins = await dbRequest('clinic_settings?on_conflict=business_id', { method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal', body: { business_id: biz } });
    if (!ins.ok) return { error: 'Could not load the payment settings. Has SQL 20261139 been run?' };
    row = await settingsRow(biz);
  }
  if (!row) return { error: 'Could not load the payment settings.' };
  const keyId = String(row.razorpay_key_id || '');
  return {
    razorpay: {
      connected: !!keyId,
      keyId: keyId ? `${keyId.slice(0, 9)}…${keyId.slice(-4)}` : '',
      mode: keyId.startsWith('rzp_live_') ? 'live' : keyId ? 'test' : '',
      webhookSecretSet: !!row.razorpay_webhook_secret_enc,
      webhookUrl: await webhookUrlFor(row.webhook_key),
      linkExpiryHours: row.link_expiry_hours,
    },
    canEdit: staff.role === 'owner',
  };
}

/**
 * Business Admin saves (or removes) the Razorpay keys. A new Key ID / Secret is checked with Razorpay first.
 * Empty secret fields keep the saved ones.
 * @param {Staff} staff @param {any} input
 */
async function save(staff, input = {}) {
  const biz = requireBusinessId(staff.businessId);
  if (staff.role !== 'owner') return { error: 'Only the Business Admin can change the payment settings.', status: 403 };
  if (!(await clinic.isClinic(biz))) return { error: clinic.NOT_CLINIC, status: 403 };
  if (!secrets.canEncrypt()) return { error: 'The server encryption secret (APP_SECRET) is not set.' };
  await view(staff); // makes sure the row exists
  const row = await settingsRow(biz);
  if (!row) return { error: 'Could not load the payment settings.' };

  if (input.disconnect === true) {
    await dbRequest(`clinic_settings?business_id=eq.${biz}`, { method: 'PATCH', prefer: 'return=minimal', body: { razorpay_key_id: null, razorpay_secret_enc: null, razorpay_webhook_secret_enc: null, updated_by: staff.email, updated_at: new Date().toISOString() } });
    await clinic.audit(staff, biz, 'clinic.razorpay_disconnected', {});
    return view(staff);
  }

  /** @type {Record<string, unknown>} */
  const patch = { updated_by: staff.email, updated_at: new Date().toISOString() };
  const keyId = String(input.keyId ?? '').trim();
  const keySecret = String(input.keySecret ?? '').trim();
  const webhookSecret = String(input.webhookSecret ?? '').trim();
  if (keyId || keySecret) {
    if (!KEY_ID_RE.test(keyId)) return { error: 'The Key ID looks like rzp_live_… or rzp_test_… (Razorpay Dashboard → Account & Settings → API Keys).' };
    const secret = keySecret || (keyId === row.razorpay_key_id ? secrets.decrypt(row.razorpay_secret_enc) : '');
    if (!secret || secret.length < 10 || secret.length > 100) return { error: 'Enter the Key Secret that goes with this Key ID.' };
    const check = await rzp({ keyId, secret }, '/payment_links?count=1');
    if (check.status === 401) return { error: 'Razorpay refused these keys. Check the Key ID and Key Secret.' };
    if (!check.ok) return { error: 'Could not reach Razorpay to check the keys. Try again.' };
    patch.razorpay_key_id = keyId;
    patch.razorpay_secret_enc = secrets.encrypt(secret);
  }
  if (webhookSecret) {
    if (webhookSecret.length < 8 || webhookSecret.length > 100) return { error: 'The webhook secret must be 8 to 100 characters.' };
    patch.razorpay_webhook_secret_enc = secrets.encrypt(webhookSecret);
  }
  if (input.linkExpiryHours !== undefined) {
    const h = Number(input.linkExpiryHours);
    if (!Number.isInteger(h) || h < 1 || h > 720) return { error: 'Links can stay open 1 to 720 hours.' };
    patch.link_expiry_hours = h;
  }
  const r = await dbRequest(`clinic_settings?business_id=eq.${biz}`, { method: 'PATCH', prefer: 'return=minimal', body: patch });
  if (!r.ok) return { error: 'Could not save the payment settings.' };
  await clinic.audit(staff, biz, 'clinic.razorpay_saved', { keys: 'razorpay_key_id' in patch, webhookSecret: !!webhookSecret, linkExpiryHours: patch.link_expiry_hours ?? null });
  return view(staff);
}

/** "₹1,200" @param {number} paise */
const rupees = (paise) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** The chat message with the link. @param {any} appt @param {string} doctorName @param {string} url */
function linkMessage(appt, doctorName, url) {
  const when = new Date(appt.starts_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  return `Your appointment with ${doctorName} is on ${when}.\nConsultation fee: ${rupees(appt.fee_paise)}.\nPlease pay here to confirm it: ${url}`;
}

/**
 * Create (or reuse) a payment link for an unpaid appointment; with send = true, send it in the chat too.
 * @param {Staff} staff @param {string} id @param {{ send?: unknown }} input
 */
async function paymentLink(staff, id, input = {}) {
  const biz = requireBusinessId(staff.businessId);
  if (!(await clinic.isClinic(biz))) return { error: clinic.NOT_CLINIC, status: 403 };
  const appt = await clinic.appointmentRow(biz, id);
  if (!appt) return { error: 'Appointment not found.', status: 404 };
  if (appt.status !== 'pending_payment') return { error: 'This appointment is not waiting for a payment.' };
  const access = await require('./inbox.cjs').ensureCanAct(appt.lead_phone, staff);
  if (access.error !== undefined) return access;
  const row = await settingsRow(biz);
  const keys = keysOf(row);
  if (!keys) return { error: 'Razorpay is not connected. The Business Admin can add the keys in Settings → Clinic.' };
  const doctor = await clinic.doctorRow(biz, appt.doctor_id);
  const doctorName = doctor?.name || 'the doctor';

  // An open link that hasn't expired is reused (one link per booking at a time).
  const open = await dbRequest(`clinic_payments?business_id=eq.${biz}&appointment_id=eq.${appt.id}&method=eq.razorpay_link&status=eq.created&select=*&order=created_at.desc&limit=1`);
  let pay = open.ok && Array.isArray(open.data) ? open.data[0] : null;
  if (pay && pay.amount_paise !== appt.fee_paise) pay = null;
  if (!pay) {
    const ins = await dbRequest('clinic_payments', {
      method: 'POST', prefer: 'return=representation',
      body: { business_id: biz, appointment_id: appt.id, method: 'razorpay_link', amount_paise: appt.fee_paise, status: 'created', recorded_by: String(staff.email || '').toLowerCase() },
    });
    if (!ins.ok || !ins.data?.length) return { error: 'Could not create the payment.' };
    pay = ins.data[0];
    const hours = Number(row?.link_expiry_hours) || 24;
    const made = await rzp(keys, '/payment_links', {
      method: 'POST',
      body: {
        amount: appt.fee_paise, currency: 'INR', accept_partial: false,
        reference_id: pay.id, description: `Consultation with ${doctorName}`.slice(0, 2048),
        expire_by: Math.floor(Date.now() / 1000) + Math.max(hours * 3600, 20 * 60),
        notify: { sms: false, email: false }, reminder_enable: false,
        notes: { appointment_id: appt.id },
      },
    });
    if (!made.ok || !made.data?.id || !made.data?.short_url) {
      await dbRequest(`clinic_payments?business_id=eq.${biz}&id=eq.${pay.id}`, { method: 'DELETE', prefer: 'return=minimal' });
      const why = made.data?.error?.description;
      return { error: made.status === 401 ? 'Razorpay refused the saved keys. Ask the Business Admin to check them.' : `Razorpay could not create the link${why ? `: ${String(why).slice(0, 200)}` : '.'}` };
    }
    const upd = await dbRequest(`clinic_payments?business_id=eq.${biz}&id=eq.${pay.id}`, { method: 'PATCH', prefer: 'return=representation', body: { razorpay_link_id: String(made.data.id), short_url: String(made.data.short_url) } });
    pay = upd.ok && upd.data?.length ? upd.data[0] : { ...pay, razorpay_link_id: made.data.id, short_url: made.data.short_url };
    await clinic.audit(staff, biz, 'clinic.payment_link_created', { appointment: appt.id, amount_paise: appt.fee_paise });
  }
  const message = linkMessage(appt, doctorName, pay.short_url);
  /** @type {Record<string, unknown>} */
  const out = { link: pay.short_url, message };
  if (input.send === true) {
    const sent = await require('./inbox.cjs').sendText(appt.lead_phone, message, staff);
    if (sent.error) out.sendError = sent.error; else out.sent = true;
    if (sent.windowClosed) out.windowClosed = true;
  }
  out.appointment = await clinic.oneView(staff, biz, appt.id);
  return out;
}

/**
 * A payment link was paid: mark the payment paid and confirm the appointment. Idempotent.
 * @param {string} biz @param {string} linkId @param {string | null} paymentId @param {number | null} amountPaid
 */
async function markLinkPaid(biz, linkId, paymentId, amountPaid) {
  const p = await dbRequest(`clinic_payments?business_id=eq.${biz}&razorpay_link_id=eq.${encodeURIComponent(linkId)}&select=*`);
  const pay = p.ok && Array.isArray(p.data) ? p.data[0] : null;
  if (!pay) return { unknown: true };
  if (pay.status === 'paid') return { already: true };
  if (amountPaid !== null && amountPaid < pay.amount_paise) return { short: true };
  const now = new Date().toISOString();
  await dbRequest(`clinic_payments?business_id=eq.${biz}&id=eq.${pay.id}&status=neq.paid`, {
    method: 'PATCH', prefer: 'return=minimal', body: { status: 'paid', razorpay_payment_id: paymentId ? String(paymentId).slice(0, 60) : null, paid_at: now },
  });
  // Paid after a cancel (rare): the appointment stays cancelled; the payment shows as paid so it can be refunded.
  await dbRequest(`clinic_appointments?business_id=eq.${biz}&id=eq.${pay.appointment_id}&status=eq.pending_payment`, {
    method: 'PATCH', prefer: 'return=minimal', body: { status: 'confirmed', confirmed_at: now, updated_at: now },
  });
  await clinic.audit(null, biz, 'clinic.payment_paid', { appointment: pay.appointment_id, amount_paise: pay.amount_paise, via: 'razorpay' });
  return { paid: true };
}

/** "Check payment": ask Razorpay about the open links of an appointment. @param {Staff} staff @param {string} id */
async function checkPayment(staff, id) {
  const biz = requireBusinessId(staff.businessId);
  if (!(await clinic.isClinic(biz))) return { error: clinic.NOT_CLINIC, status: 403 };
  const appt = await clinic.appointmentRow(biz, id);
  if (!appt) return { error: 'Appointment not found.', status: 404 };
  const keys = keysOf(await settingsRow(biz));
  if (!keys) return { error: 'Razorpay is not connected.' };
  const open = await dbRequest(`clinic_payments?business_id=eq.${biz}&appointment_id=eq.${appt.id}&method=eq.razorpay_link&status=eq.created&select=*`);
  for (const pay of (open.ok && Array.isArray(open.data) ? open.data : [])) {
    if (!pay.razorpay_link_id) continue;
    const r = await rzp(keys, `/payment_links/${encodeURIComponent(pay.razorpay_link_id)}`);
    if (!r.ok) continue;
    const st = String(r.data?.status || '');
    if (st === 'paid') {
      const paymentId = Array.isArray(r.data?.payments) && r.data.payments[0]?.payment_id ? r.data.payments[0].payment_id : null;
      await markLinkPaid(biz, pay.razorpay_link_id, paymentId, Number(r.data?.amount_paid ?? pay.amount_paise));
    } else if (st === 'expired' || st === 'cancelled') {
      await dbRequest(`clinic_payments?business_id=eq.${biz}&id=eq.${pay.id}&status=eq.created`, { method: 'PATCH', prefer: 'return=minimal', body: { status: st } });
    }
  }
  return { appointment: await clinic.oneView(staff, biz, appt.id) };
}

/** The booking was cancelled or paid at the desk: cancel its open links at Razorpay too. @param {string} biz @param {string} apptId */
async function cancelOpenLinks(biz, apptId) {
  const open = await dbRequest(`clinic_payments?business_id=eq.${biz}&appointment_id=eq.${apptId}&method=eq.razorpay_link&status=eq.created&select=id,razorpay_link_id`);
  const list = open.ok && Array.isArray(open.data) ? open.data : [];
  if (!list.length) return;
  const keys = keysOf(await settingsRow(biz));
  for (const pay of list) {
    if (keys && pay.razorpay_link_id) await rzp(keys, `/payment_links/${encodeURIComponent(pay.razorpay_link_id)}/cancel`, { method: 'POST' });
    await dbRequest(`clinic_payments?business_id=eq.${biz}&id=eq.${pay.id}&status=eq.created`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'cancelled' } });
  }
}

/** Constant-time compare of two hex signatures. @param {string} a @param {string} b */
function sameHex(a, b) {
  if (!/^[a-f0-9]{64}$/i.test(a) || !/^[a-f0-9]{64}$/i.test(b)) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/**
 * Razorpay webhook: POST /webhook/razorpay/<key>. 404 unknown key, 401 bad signature, else 200.
 * @param {string} key @param {Buffer | undefined} rawBody @param {string} signature
 * @returns {Promise<{ status: number, body: Record<string, unknown> }>}
 */
async function handleWebhook(key, rawBody, signature) {
  if (!/^[a-f0-9]{32}$/.test(String(key || ''))) return { status: 404, body: { error: 'Not found.' } };
  const r = await dbRequest(`clinic_settings?webhook_key=eq.${key}&select=business_id,razorpay_webhook_secret_enc`);
  const row = r.ok && Array.isArray(r.data) ? r.data[0] : null;
  if (!row) return { status: 404, body: { error: 'Not found.' } };
  const secret = secrets.decrypt(row.razorpay_webhook_secret_enc);
  if (!secret || !rawBody) return { status: 401, body: { error: 'Webhook secret not set.' } };
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  if (!sameHex(String(signature || ''), expected)) return { status: 401, body: { error: 'Bad signature.' } };
  /** @type {any} */
  let event;
  try { event = JSON.parse(rawBody.toString('utf8')); } catch { return { status: 400, body: { error: 'Bad body.' } }; }
  const biz = row.business_id;
  const link = event?.payload?.payment_link?.entity;
  if (event?.event === 'payment_link.paid' && link?.id) {
    const payment = event?.payload?.payment?.entity;
    const res = await markLinkPaid(biz, String(link.id), payment?.id ? String(payment.id) : null, Number(link.amount_paid ?? payment?.amount ?? NaN) || null);
    return { status: 200, body: { ok: true, ...res } };
  }
  if ((event?.event === 'payment_link.expired' || event?.event === 'payment_link.cancelled') && link?.id) {
    const st = event.event === 'payment_link.expired' ? 'expired' : 'cancelled';
    await dbRequest(`clinic_payments?business_id=eq.${biz}&razorpay_link_id=eq.${encodeURIComponent(String(link.id))}&status=eq.created`, { method: 'PATCH', prefer: 'return=minimal', body: { status: st } });
    return { status: 200, body: { ok: true } };
  }
  return { status: 200, body: { ok: true, ignored: true } };
}

module.exports = { view, save, paymentLink, checkPayment, cancelOpenLinks, handleWebhook, markLinkPaid, linkMessage, KEY_ID_RE };
