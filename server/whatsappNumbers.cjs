// @ts-check
// Several WhatsApp numbers per business, phase N3 (docs/progress/multi-number.md): the Business Admin adds,
// names and removes EXTRA numbers on the WhatsApp page. The main number stays the connection saved at the top
// of that page (server/whatsapp.cjs); extras share its webhook address and, unless given their own, its token.
//
// Rules:
//   * Business Admin only (managers can see the list).
//   * Plan limit max_whatsapp_numbers counts the main number + active extras (null = unlimited), server-side.
//   * A number is checked with Meta before it is saved (the token can see it; it is in the given account).
//   * The same Meta number can't be connected twice, to this or any business (also enforced by the database).
//   * Removing keeps history: the number is disabled, messages keep its id, and it can be added back.
const { dbRequest, countRows } = require('./db.cjs');
const secrets = require('./secrets.cjs');
const { requireBusinessId } = require('./tenant.cjs');
const wa = require('./whatsapp.cjs');
const limits = require('./limits.cjs');

/** @typedef {import('./types.cjs').Staff} Staff */

const DIGITS_RE = /^\d{5,30}$/;
const MAX_LABEL = 40;
const MAX_WELCOME = 1024; // WhatsApp's limit for the text above reply buttons

/** @param {unknown} v */
const cleanLabel = (v) => String(v ?? '').trim().replace(/\s+/g, ' ');
/** @param {Staff} staff @param {string} action @param {Record<string, unknown>} details */
const audit = (staff, action, details) => dbRequest('audit_log', {
  method: 'POST', prefer: 'return=minimal',
  body: { business_id: staff.businessId, actor_email: staff.email, actor_role: staff.role, action, details },
});

/** How many numbers the plan allows and how many are in use (main + active extras). @param {string} biz */
async function usage(biz) {
  const { limits: l, planName } = await limits.getPlan(biz);
  const main = await wa.getWhatsApp(biz);
  const extras = (await countRows('whatsapp_numbers', `business_id=eq.${biz}&status=eq.active`)) ?? (await wa.extraNumbers(biz)).length;
  const limit = l.max_whatsapp_numbers ?? null;
  return { limit, used: (main ? 1 : 0) + extras, planName };
}

/**
 * The business's numbers for the WhatsApp page (no secrets).
 * @param {Staff} staff
 */
async function list(staff) {
  const biz = requireBusinessId(staff?.businessId);
  const main = await wa.getWhatsApp(biz);
  const base = `whatsapp_numbers?business_id=eq.${biz}&order=created_at.asc&select=phone_number_id,phone_number,waba_id,label,token_last4,access_token_enc,status,added_by,created_at`;
  let r = await dbRequest(`${base},welcome_message`);
  if (!r.ok) r = await dbRequest(base); // before SQL 20261124
  const rows = r.ok && Array.isArray(r.data) ? r.data : [];
  const u = await usage(biz);
  return {
    main: main ? { id: String(main.phoneNumberId), phoneNumber: main.phoneNumber, wabaId: main.wabaId, label: main.label || '' } : null,
    numbers: rows.map((/** @type {Record<string, any>} */ n) => ({
      id: String(n.phone_number_id),
      phoneNumber: n.phone_number || '',
      wabaId: n.waba_id || '',
      label: n.label || '',
      ownToken: !!n.access_token_enc,
      tokenLast4: n.access_token_enc ? n.token_last4 || null : null,
      tokenUnreadable: !!(n.access_token_enc && !secrets.decrypt(n.access_token_enc)),
      status: n.status,
      welcomeMessage: n.welcome_message || '',
      addedBy: n.added_by || null,
      createdAt: n.created_at,
    })),
    limit: u.limit,
    used: u.used,
    planName: u.planName,
    tableReady: r.ok,
  };
}

/**
 * Add (or bring back) an extra number.
 * @param {Staff} staff
 * @param {{ phoneNumberId?: unknown, wabaId?: unknown, label?: unknown, accessToken?: unknown }} [input]
 */
async function add(staff, input = {}) {
  const biz = requireBusinessId(staff?.businessId);
  if (!secrets.canEncrypt()) return { error: 'The server has no encryption secret (APP_SECRET), so numbers can\'t be stored safely.' };
  const phoneNumberId = String(input.phoneNumberId ?? '').trim();
  const label = cleanLabel(input.label);
  const accessToken = String(input.accessToken ?? '').trim();
  if (!DIGITS_RE.test(phoneNumberId)) return { error: 'Enter the Phone number ID (digits only) from Meta -> WhatsApp -> API Setup.' };
  if (!label) return { error: 'Give the number a name your team will recognise, like "Pharmacy".' };
  if (label.length > MAX_LABEL) return { error: `Keep the name to ${MAX_LABEL} characters.` };
  if (accessToken && (accessToken.length < 20 || accessToken.length > 1000 || /\s/.test(accessToken))) return { error: 'That access token doesn\'t look right.' };

  const main = await wa.getWhatsApp(biz);
  if (!main) return { error: 'Connect your main WhatsApp number first (top of this page).' };
  const wabaId = String(input.wabaId ?? '').trim() || main.wabaId;
  if (!DIGITS_RE.test(wabaId)) return { error: 'Enter the WhatsApp Business Account ID (digits only).' };
  if (phoneNumberId === String(main.phoneNumberId)) return { error: 'That is already your main number.' };

  // Already connected? This business's disabled number can be brought back; anyone else's can't be taken.
  const [mainClash, extraRow] = await Promise.all([
    dbRequest(`business_whatsapp?phone_number_id=eq.${phoneNumberId}&select=business_id`),
    dbRequest(`whatsapp_numbers?phone_number_id=eq.${phoneNumberId}&select=business_id,status`),
  ]);
  if (mainClash.ok && mainClash.data?.length) return { error: 'This WhatsApp number is already connected to another business.' };
  const existing = extraRow.ok ? extraRow.data?.[0] || null : null;
  if (existing && existing.business_id !== biz) return { error: 'This WhatsApp number is already connected to another business.' };
  if (existing && existing.status === 'active') return { error: 'This number is already added.' };

  const u = await usage(biz);
  if (u.limit !== null && u.used + 1 > u.limit) {
    return { error: `Your ${u.planName || 'current'} plan allows ${u.limit} WhatsApp number${u.limit === 1 ? '' : 's'}, and you have ${u.used}. Ask the platform to upgrade your plan.`, limitReached: true };
  }

  // Check with Meta: the token (own, else the main one) can see the number, and it is in that account.
  const token = accessToken || main.token;
  const checked = await wa.checkWithMeta(main.graphVersion, token, phoneNumberId, wabaId);
  if (checked.error !== undefined) {
    return { error: accessToken ? checked.error : `${checked.error} If this number's account is not shared with your main token's system user, paste a token for it.` };
  }

  /** @type {Record<string, unknown>} */
  const body = {
    business_id: biz,
    phone_number_id: phoneNumberId,
    phone_number: String(checked.phone.display_phone_number || '').replace(/[^\d]/g, ''),
    waba_id: wabaId,
    label,
    status: 'active',
    added_by: staff.email,
    updated_at: new Date().toISOString(),
    access_token_enc: accessToken ? secrets.encrypt(accessToken) : null,
    token_last4: accessToken ? accessToken.slice(-4) : null,
  };
  const res = existing
    ? await dbRequest(`whatsapp_numbers?business_id=eq.${biz}&phone_number_id=eq.${phoneNumberId}`, { method: 'PATCH', prefer: 'return=minimal', body })
    : await dbRequest('whatsapp_numbers', { method: 'POST', prefer: 'return=minimal', body });
  if (!res.ok) {
    if (res.status === 409 || /already connected|duplicate/i.test(JSON.stringify(res.data || ''))) return { error: 'This WhatsApp number is already connected to another business.' };
    return { error: 'Could not save the number. Has the SQL for several numbers (20261122) been run?' };
  }
  wa.clearCache(biz);

  // A number in another WhatsApp Business Account: ask Meta to send that account's messages to our app.
  let subscribeNote = null;
  if (wabaId !== main.wabaId) {
    const sub = await wa.graph(main.graphVersion, token, `${wabaId}/subscribed_apps`, { method: 'POST' });
    if (sub?.error) subscribeNote = `Meta didn't subscribe the app to this number's account automatically (${wa.metaMsg(sub)}). Subscribe it in Meta -> WhatsApp -> Configuration.`;
  }
  await audit(staff, existing ? 'whatsapp.number_restored' : 'whatsapp.number_added', { phoneNumberId, wabaId, label, ownToken: !!accessToken });
  return { added: true, phoneNumberId, verifiedName: checked.phone.verified_name || '', subscribeNote };
}

/**
 * Rename a number (main or extra), and/or set an extra number's own bot welcome (N4; '' or null = use the
 * Bot Flow's welcome). The main number's welcome is the Bot Flow's.
 * @param {Staff} staff @param {unknown} rawId @param {{ label?: unknown, welcomeMessage?: unknown }} [input]
 */
async function rename(staff, rawId, input = {}) {
  const biz = requireBusinessId(staff?.businessId);
  const id = String(rawId ?? '');
  if (!DIGITS_RE.test(id)) return { error: 'Invalid number.' };
  const main = await wa.getWhatsApp(biz);
  const isMain = !!main && String(main.phoneNumberId) === id;
  /** @type {Record<string, unknown>} */
  const body = { updated_at: new Date().toISOString() };
  if (input.label !== undefined) {
    const label = cleanLabel(input.label);
    if (label.length > MAX_LABEL) return { error: `Keep the name to ${MAX_LABEL} characters.` };
    if (!isMain && !label) return { error: 'Give the number a name.' };
    body.label = label;
  }
  if (input.welcomeMessage !== undefined) {
    if (isMain) return { error: 'The main number uses the welcome message on the Bot Flow page.' };
    const text = input.welcomeMessage === null ? '' : String(input.welcomeMessage).trim();
    if (text.length > MAX_WELCOME) return { error: `Keep the welcome message to ${MAX_WELCOME} characters (WhatsApp's limit).` };
    // Bot text never makes health or cure claims (same check as ad text).
    const claims = require('./adCreate.cjs').textCheck({ text }).blocks;
    if (claims.length) return { error: `The welcome message can't be saved: ${claims[0]}` };
    body.welcome_message = text || null;
  }
  if (Object.keys(body).length === 1) return { error: 'Nothing to change.' };
  const res = isMain
    ? await dbRequest(`business_whatsapp?business_id=eq.${biz}&phone_number_id=eq.${id}`, { method: 'PATCH', prefer: 'return=representation', body })
    : await dbRequest(`whatsapp_numbers?business_id=eq.${biz}&phone_number_id=eq.${id}`, { method: 'PATCH', prefer: 'return=representation', body });
  if (!res.ok || !res.data?.length) {
    if (!res.ok && 'welcome_message' in body) return { error: 'Could not save. Has the SQL for several numbers (20261124) been run?' };
    return { error: 'That number isn\'t connected to this business.', status: 404 };
  }
  wa.clearCache(biz);
  await audit(staff, 'whatsapp.number_renamed', { phoneNumberId: id, ...('label' in body ? { label: body.label } : {}), ...('welcome_message' in body ? { welcomeChanged: true } : {}) });
  return { renamed: true };
}

/**
 * Remove an extra number: it stops receiving and sending here; its history stays.
 * @param {Staff} staff @param {unknown} rawId
 */
async function remove(staff, rawId) {
  const biz = requireBusinessId(staff?.businessId);
  const id = String(rawId ?? '');
  if (!DIGITS_RE.test(id)) return { error: 'Invalid number.' };
  const main = await wa.getWhatsApp(biz);
  if (main && String(main.phoneNumberId) === id) return { error: 'The main number can\'t be removed here. Change it in "Your Meta details" above.' };
  const res = await dbRequest(`whatsapp_numbers?business_id=eq.${biz}&phone_number_id=eq.${id}&status=eq.active`, {
    method: 'PATCH', prefer: 'return=representation', body: { status: 'disabled', updated_at: new Date().toISOString() },
  });
  if (!res.ok || !res.data?.length) return { error: 'That number isn\'t connected to this business.', status: 404 };
  wa.clearCache(biz);
  await audit(staff, 'whatsapp.number_removed', { phoneNumberId: id });
  return { removed: true };
}

module.exports = { list, add, rename, remove, usage };
