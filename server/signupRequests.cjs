// @ts-check
// Public sign-up requests ("Get started" on the public site) and the plans shown on the pricing page.
//
// A visitor asks for an account; nothing is created until the Platform Admin approves the request in the
// console, which creates the business (platform.createBusiness) and emails the Business Admin an invite.
// Validation here mirrors src/site/signupRules.ts (the form checks the same things as you type).
// Bots: a hidden "website" field must stay empty and the form must have been open for a few seconds; both
// fail silently (the bot sees the normal "thank you"). One open request per email (the same thank-you).
// Personal data (DPDP Act 2023): only what's needed to set up the account; consent is recorded; requests are
// deleted after 90 days (rejected) or 30 days (approved: the business then holds the details).
const { dbRequest } = require('./db.cjs');

/** @typedef {Record<string, any>} Row */

// Bump when the Privacy Policy or Terms change (stored with each consent).
const POLICY_VERSION = '2026-11-11';
const INDUSTRIES = ['hospital', 'food', 'retail', 'services', 'general'];
const TEAM_SIZES = ['1-5', '6-20', '21-50', '50+'];
const HAS_API = ['yes', 'no', 'not_sure'];
const MIN_FORM_MS = 3000;
const THANKS = 'Thank you! We have your request and will contact you within 1–2 working days.';

/** @param {unknown} v */
const str = (v) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));
/** @param {unknown} v */
const tidy = (v) => str(v).replace(/\s+/g, ' ').trim();

/**
 * Pure: a phone number as digits with the country code, or null. Indian mobiles may be typed without +91
 * (10 digits starting 6-9); other countries need their code (+, 8-15 digits).
 * @param {unknown} raw
 */
function normalizePhone(raw) {
  const s = str(raw).trim();
  if (!/^\+?[\d\s\-().]{8,22}$/.test(s)) return null;
  const d = s.replace(/\D/g, '');
  if (/^[6-9]\d{9}$/.test(d)) return `91${d}`;                     // 98765 43210
  if (/^0[6-9]\d{9}$/.test(d)) return `91${d.slice(1)}`;            // 098765 43210
  if (/^91[6-9]\d{9}$/.test(d)) return d;                           // +91 98765 43210
  if (d.startsWith('91')) return null;                              // +91 but not a valid mobile
  if (s.startsWith('+') && /^[1-9]\d{7,14}$/.test(d)) return d;     // other countries, with their code
  return null;
}

/**
 * Pure: check the form. Returns { errors } (field -> message) or { value } (cleaned).
 * @param {Row} input @param {{ planIds?: string[] }} [opt]
 */
function validateSignup(input = {}, { planIds = [] } = {}) {
  /** @type {Record<string, string>} */
  const errors = {};
  const businessName = tidy(input.businessName);
  if (businessName.length < 2 || businessName.length > 80) errors.businessName = 'Enter your business name (2 to 80 characters).';
  else if (!/\p{L}/u.test(businessName)) errors.businessName = 'The business name needs at least one letter.';

  const contactName = tidy(input.contactName);
  if (contactName.length < 2 || contactName.length > 80) errors.contactName = 'Enter your full name (2 to 80 characters).';
  else if (!/^[\p{L}][\p{L}\p{M} .'-]*$/u.test(contactName)) errors.contactName = 'Use letters, spaces, dots, apostrophes or hyphens only.';

  const email = str(input.email).trim().toLowerCase();
  if (!email) errors.email = 'Enter your work email.';
  else if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,}$/.test(email) || email.includes('..')) {
    errors.email = 'Enter a valid email address, like name@business.com.';
  }

  const phone = normalizePhone(input.phone);
  if (!str(input.phone).trim()) errors.phone = 'Enter a mobile number we can call or WhatsApp.';
  else if (!phone) errors.phone = 'Enter a valid mobile number: 10 digits for India (e.g. 98765 43210), or + and the country code.';

  const industry = str(input.industry);
  if (!INDUSTRIES.includes(industry)) errors.industry = 'Choose your type of business.';

  const city = tidy(input.city);
  if (city && (city.length > 60 || !/^[\p{L}][\p{L}\p{M} .,'-]*$/u.test(city))) errors.city = 'Enter a city name (letters only, up to 60 characters).';

  const teamSize = str(input.teamSize);
  if (teamSize && !TEAM_SIZES.includes(teamSize)) errors.teamSize = 'Choose a team size.';
  const planInterest = str(input.planInterest);
  if (planInterest && !(planIds.length ? planIds.includes(planInterest) : /^[a-z0-9_]{2,30}$/.test(planInterest))) errors.planInterest = 'Choose a plan.';
  const hasWhatsappApi = str(input.hasWhatsappApi);
  if (hasWhatsappApi && !HAS_API.includes(hasWhatsappApi)) errors.hasWhatsappApi = 'Choose an answer.';

  const message = str(input.message).trim();
  if (message.length > 1000) errors.message = 'Keep the message to 1,000 characters.';

  if (input.acceptTerms !== true) errors.acceptTerms = 'Please accept the Terms and the Privacy Policy to continue.';

  if (Object.keys(errors).length) return { errors };
  return {
    value: {
      business_name: businessName, contact_name: contactName, email, phone, industry,
      city: city || null, team_size: teamSize || null, plan_interest: planInterest || null, has_whatsapp_api: hasWhatsappApi || null,
      message: message || null, consent_marketing: input.acceptMarketing === true,
    },
  };
}

/** The plans for the public pricing page (no limits_overrides, nothing per business). */
async function publicPlans() {
  const r = await dbRequest('plans?select=*&order=sort_order.asc');
  if (!r.ok || !Array.isArray(r.data)) return { plans: [] };
  return {
    plans: r.data.map((/** @type {Row} */ p) => ({
      id: p.id, name: p.name, priceMonthlyInr: Number(p.price_monthly_inr) || 0,
      limits: {
        staff: p.max_staff ?? null, contacts: p.max_contacts ?? null, broadcastsMonth: p.max_broadcasts_month ?? null,
        automations: p.max_automations ?? null, aiRepliesMonth: p.max_ai_replies_month ?? null, keywordRules: p.max_keyword_rules ?? null,
        analyticsDays: p.analytics_days ?? null, whatsappNumbers: p.max_whatsapp_numbers ?? null,
      },
      aiEnabled: p.ai_enabled !== false, adsEnabled: p.ads_enabled === true,
    })),
  };
}

/**
 * The public form posts here.
 * @param {Row} input
 * @returns {Promise<{ ok: true, message: string } | { error: string, errors?: Record<string, string>, status: number }>}
 */
async function submit(input = {}) {
  // Bots: answered like a person, but nothing is saved.
  if (str(input.website).trim()) return { ok: true, message: THANKS };
  const openedAt = Number(input.startedAt);
  if (Number.isFinite(openedAt) && openedAt > 0 && Date.now() - openedAt < MIN_FORM_MS) return { ok: true, message: THANKS };

  const plans = (await publicPlans()).plans.map(p => p.id);
  const v = validateSignup(input, { planIds: plans });
  if (v.errors) return { error: 'Please check the highlighted fields.', errors: v.errors, status: 400 };
  const row = { ...v.value, consent_at: new Date().toISOString(), policy_version: POLICY_VERSION };
  const r = await dbRequest('signup_requests', { method: 'POST', prefer: 'return=minimal', body: row });
  if (!r.ok) {
    // An open request with this email already exists: same answer (nothing about who has applied).
    if (r.status === 409) return { ok: true, message: THANKS };
    return { error: 'We could not send your request just now. Please try again in a minute, or write to us.', status: 503 };
  }
  await require('./events.cjs').logEvent({ level: 'info', source: 'system', code: 'signup_request', message: `New sign-up request (${row.industry})` });
  return { ok: true, message: THANKS };
}

/** Platform console: requests, newest first. @param {Row} [query] */
async function list(query = {}) {
  const status = ['pending', 'approved', 'rejected'].includes(str(query.status)) ? str(query.status) : 'pending';
  const r = await dbRequest(`signup_requests?status=eq.${status}&select=*&order=created_at.desc&limit=200`);
  if (!r.ok) return { error: 'Could not load sign-up requests. Has the SQL (20261127) been run?' };
  const pending = await dbRequest('signup_requests?status=eq.pending&select=id');
  return { requests: r.data || [], pendingCount: pending.ok && Array.isArray(pending.data) ? pending.data.length : 0 };
}

/** @param {unknown} id */
const isId = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str(id));

/**
 * Approve: create the business on the chosen plan and invite the contact as its Business Admin.
 * @param {{ email: string }} admin @param {unknown} id @param {Row} [input]
 */
async function approve(admin, id, input = {}) {
  if (!isId(id)) return { error: 'Invalid request.' };
  const got = await dbRequest(`signup_requests?id=eq.${id}&select=*`);
  const req = got.ok ? got.data?.[0] : null;
  if (!req) return { error: 'Request not found.', status: 404 };
  if (req.status !== 'pending') return { error: `This request was already ${req.status}.` };
  const platform = require('./platform.cjs');
  const made = await platform.createBusiness(admin, {
    name: str(input.name) || req.business_name, slug: str(input.slug) || undefined,
    planId: str(input.planId) || req.plan_interest || 'starter', adminEmail: req.email, industry: req.industry,
  });
  if ('error' in made && made.error) return { error: made.error };
  const businessId = /** @type {any} */ (made).business?.id || null;
  await dbRequest(`signup_requests?id=eq.${id}&status=eq.pending`, {
    method: 'PATCH', prefer: 'return=minimal',
    body: { status: 'approved', business_id: businessId, decided_by: admin.email, decided_at: new Date().toISOString(), decision_note: str(input.note).slice(0, 500) || null },
  });
  await platform.audit(admin, businessId, 'signup.approved', { requestId: id });
  return { approved: true, businessId, invited: /** @type {any} */ (made).invited };
}

/** @param {{ email: string }} admin @param {unknown} id @param {Row} [input] */
async function reject(admin, id, input = {}) {
  if (!isId(id)) return { error: 'Invalid request.' };
  const r = await dbRequest(`signup_requests?id=eq.${id}&status=eq.pending`, {
    method: 'PATCH', prefer: 'return=representation',
    body: { status: 'rejected', decided_by: admin.email, decided_at: new Date().toISOString(), decision_note: str(input.note).slice(0, 500) || null },
  });
  if (!r.ok || !r.data?.length) return { error: 'Request not found, or already decided.', status: 404 };
  await require('./platform.cjs').audit(admin, null, 'signup.rejected', { requestId: id });
  return { rejected: true };
}

/** Worker (hourly): delete decided requests once they're no longer needed (DPDP: storage limitation). */
async function prune() {
  const day = 86400000;
  const rejectedBefore = encodeURIComponent(new Date(Date.now() - 90 * day).toISOString());
  const approvedBefore = encodeURIComponent(new Date(Date.now() - 30 * day).toISOString());
  await dbRequest(`signup_requests?status=eq.rejected&decided_at=lt.${rejectedBefore}`, { method: 'DELETE', prefer: 'return=minimal' });
  await dbRequest(`signup_requests?status=eq.approved&decided_at=lt.${approvedBefore}`, { method: 'DELETE', prefer: 'return=minimal' });
  return { pruned: true };
}

module.exports = { POLICY_VERSION, INDUSTRIES, TEAM_SIZES, normalizePhone, validateSignup, publicPlans, submit, list, approve, reject, prune };
