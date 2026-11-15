// @ts-check
// Automations: automatic follow-up messages.
//
//  1. The webhook records what a customer did as a "contact event"
//     (viewed an item, sent an order enquiry, messaged for the first time).
//  2. Each active automation whose trigger matches schedules one follow-up
//     ("run") for that customer, due after the automation's delay, moved into
//     the sending window (9am-8pm India time).
//  3. 'inactive' automations are checked about once an hour instead: customers
//     whose last chat crossed the inactivity threshold get a run.
//  4. The every-minute worker sends due runs, unless the customer has since
//     replied / ordered (per the automation's settings) or opted out.
const { dbRequest, logMessage } = require('./db.cjs');
const { sendTemplateMessage } = require('./meta.cjs');
const { pushMessage, broadcastEvent } = require('./state.cjs');
const tpl = require('./templates.cjs');
const campaigns = require('./campaigns.cjs');
const { requireBusinessId, NO_WHATSAPP } = require('./tenant.cjs');
const { getWhatsApp, whatsappFor } = require('./whatsapp.cjs');
const { sendWindowFor } = require('./business.cjs');
const limits = require('./limits.cjs');

/** @typedef {import('./types.cjs').Staff} Staff */
/** @typedef {import('./business.cjs').SendWindow} SendWindow */
/** @typedef {Record<string, any>} AutomationRow  a row of `automations` */
/** @typedef {Record<string, any>} RunRow  a row of `automation_runs` */
/** @typedef {Record<string, any>} Input  dashboard form fields (each function checks what it uses) */

/** @type {Record<string, { label: string, eventBased: boolean }>} */
const TRIGGERS = {
  item_viewed: { label: 'after they look at a product but don\'t order', eventBased: true },
  order_enquiry: { label: 'after they place an order enquiry', eventBased: true },
  kit_order: { label: 'after they order a 28-day diet kit', eventBased: true },
  new_contact: { label: 'after they message you for the first time', eventBased: true },
  inactive: { label: 'after they have been quiet for', eventBased: false },
};
const EVENT_TRIGGERS = Object.keys(TRIGGERS).filter(t => TRIGGERS[t].eventBased);

const MAX_DELAY_MIN = 525600; // 1 year
const INACTIVE_WINDOW_MS = 7 * 86400000; // only contacts who crossed the threshold within the last week
const SCAN_EVERY_MS = 55 * 60000;
const IST_OFFSET_MS = 330 * 60000; // India has no daylight saving
const WINDOW_START_HOUR = 9;
const WINDOW_END_HOUR = 20;
/** @param {unknown} id */
const isUuid = (id) => /^[0-9a-f-]{36}$/i.test(String(id));

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Move a time into the business's sending window (India time; default 9:00-20:00):
 * nobody gets a follow-up at 2am. `window` = { start, end } in hours.
 * @param {Date} date @param {SendWindow} [window] @returns {Date}
 */
function intoSendingWindow(date, window = { start: WINDOW_START_HOUR, end: WINDOW_END_HOUR }) {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  const hour = ist.getUTCHours() + ist.getUTCMinutes() / 60;
  if (hour >= window.start && hour < window.end) return date;
  const target = new Date(ist);
  if (hour >= window.end) target.setUTCDate(target.getUTCDate() + 1);
  target.setUTCHours(window.start, 0, 0, 0);
  return new Date(target.getTime() - IST_OFFSET_MS);
}

/** @param {Date} now @param {number} delayMinutes @param {SendWindow} [window] */
function computeDueAt(now, delayMinutes, window) {
  return intoSendingWindow(new Date(now.getTime() + delayMinutes * 60000), window);
}

/** Which automation triggers a contact event fires. @param {string} eventType @param {Record<string, any>} [data] @returns {string[]} */
function triggersForEvent(eventType, data = {}) {
  if (eventType === 'order_enquiry') return data.isKit ? ['order_enquiry', 'kit_order'] : ['order_enquiry'];
  if (eventType === 'item_viewed') return ['item_viewed'];
  if (eventType === 'new_contact') return ['new_contact'];
  return [];
}

/**
 * Validate the settings part of an automation form. Returns { row } or { error }.
 * @param {Input} [input]
 * @returns {{ error: string, row?: undefined } | { error?: undefined, row: AutomationRow }}
 */
function validateAutomationInput(input = {}) {
  const name = String(input.name || '').trim().slice(0, 120);
  const trigger = String(input.trigger || '');
  const delay = Math.round(Number(input.delayMinutes));
  if (!name) return { error: 'Give the automation a name.' };
  if (!TRIGGERS[trigger]) return { error: 'Choose when the follow-up should be sent.' };
  if (!Number.isFinite(delay) || delay < 0 || delay > MAX_DELAY_MIN) return { error: 'The delay must be between 0 minutes and 1 year.' };
  if (trigger === 'inactive' && delay < 1440) return { error: 'For "quiet for…" follow-ups, use at least 1 day.' };
  if (!input.templateName || !input.language) return { error: 'Pick an approved template.' };
  return {
    row: {
      name,
      trigger,
      delay_minutes: delay,
      stop_if_replied: input.stopIfReplied !== false,
      stop_if_ordered: !!input.stopIfOrdered,
      is_active: input.isActive !== false,
    },
  };
}

/** "2 days", "3 hours", "45 minutes". @param {number} minutes */
function describeDelay(minutes) {
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? '' : 's'}`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? '' : 's'}`;
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------------------
// Active automation cache (60s): every incoming message checks triggers.
// ---------------------------------------------------------------------------
/** @type {Map<string, { at: number, rows: AutomationRow[] }>} */
const cache = new Map(); // businessId -> { at, rows }

/** @param {string} biz @returns {Promise<AutomationRow[]>} */
async function activeAutomations(biz) {
  requireBusinessId(biz);
  const hit = cache.get(biz);
  if (hit && Date.now() - hit.at < 60000) return hit.rows;
  const res = await dbRequest(`automations?is_active=is.true&business_id=eq.${biz}&select=*`);
  const rows = res.ok && Array.isArray(res.data) ? res.data : [];
  cache.set(biz, { at: Date.now(), rows });
  return rows;
}
const clearCache = () => cache.clear();

// ---------------------------------------------------------------------------
// Events -> scheduled runs
// ---------------------------------------------------------------------------

/**
 * @param {AutomationRow} automation
 * @param {{ phone: string, name?: string | null, eventId?: unknown, data?: Record<string, any> }} run
 */
async function scheduleRun(automation, { phone, name, eventId = null, data = {} }) {
  const now = new Date();
  const row = {
    business_id: automation.business_id,
    automation_id: automation.id,
    phone,
    name: name || null,
    event_id: eventId,
    data,
    due_at: computeDueAt(now, automation.delay_minutes, await sendWindowFor(automation.business_id)).toISOString(),
  };
  const ins = await dbRequest('automation_runs', { method: 'POST', prefer: 'return=minimal', body: row });
  if (ins.ok) return 'scheduled';
  if (ins.status === 409) {
    // Already waiting for this customer: restart the timer from this newer event.
    await dbRequest(`automation_runs?business_id=eq.${automation.business_id}&automation_id=eq.${automation.id}&phone=eq.${phone}&status=eq.scheduled`, {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: { due_at: row.due_at, data, event_id: eventId, created_at: now.toISOString(), name: row.name },
    });
    return 'rescheduled';
  }
  return 'error';
}

/**
 * Record what a customer did and schedule any matching follow-ups.
 * @param {string} biz @param {string} phone @param {string | null | undefined} name @param {string} eventType
 * @param {Record<string, any>} [data]
 */
async function recordEvent(biz, phone, name, eventType, data = {}) {
  requireBusinessId(biz);
  if (!/^\d{7,15}$/.test(String(phone))) return;
  const ins = await dbRequest('contact_events', {
    method: 'POST',
    prefer: 'return=representation',
    body: { business_id: biz, phone, event_type: eventType, data },
  });
  const eventId = ins.ok ? ins.data?.[0]?.id ?? null : null;

  const triggers = triggersForEvent(eventType, data);
  if (!triggers.length) return;
  const matching = (await activeAutomations(biz)).filter(a => triggers.includes(a.trigger));
  for (const a of matching) await scheduleRun(a, { phone, name, eventId, data });
}

/**
 * Turn a bot button / list click into a contact event, using the bot catalog for item names.
 * @param {any} interactive  Meta's `interactive` object
 * @param {import('./types.cjs').Catalog} [catalog]
 * @returns {{ type: string, data: Record<string, any> } | null}
 */
function eventFromInteractive(interactive, catalog = {}) {
  /** @type {string | undefined} */
  const id = interactive?.button_reply?.id || interactive?.list_reply?.id;
  if (!id) return null;
  /** @type {Array<{ id: string, title?: string }>} */
  const kits = catalog.dietKits || [];
  /** @type {Array<{ id: string, title?: string }>} */
  const dishes = [
    ...(catalog.menuItems || []), // the basic flow's "Our services" list
    ...(catalog.rteVegItems || []), ...(catalog.rteNonVegItems || []),
    ...(catalog.rtcVegItems || []), ...(catalog.rtcNonVegItems || []),
  ];
  /** @param {string} itemId */
  const find = (itemId) => {
    const kit = kits.find(k => k.id === itemId);
    if (kit) return { itemId, item: cleanTitle(kit.title), isKit: true };
    const dish = dishes.find(d => d.id === itemId);
    if (dish) return { itemId, item: cleanTitle(dish.title), isKit: false };
    return null;
  };

  if (id.startsWith('btn_confirm_')) {
    const data = find(id.slice('btn_confirm_'.length));
    return data ? { type: 'order_enquiry', data } : null;
  }
  if (id.startsWith('btn_step_')) {
    // btn_step_<buttonIndex>_<dishId>
    const data = find(id.split('_').slice(3).join('_'));
    return data ? { type: 'order_enquiry', data: { ...data, choice: interactive.button_reply?.title || '' } } : null;
  }
  const viewed = find(id) || find(id.replace(/^btn_/, ''));
  return viewed ? { type: 'item_viewed', data: viewed } : null;
}

// "🏋️ Lean Well (28 Days)" -> "Lean Well (28 Days)": emojis read badly inside a sentence.
/** @param {unknown} title */
function cleanTitle(title) {
  return String(title || '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
}

// ---------------------------------------------------------------------------
// Inactive contacts scan (about hourly per automation)
// ---------------------------------------------------------------------------

async function scanInactive() {
  // Every business's 'quiet for…' automations (the worker runs this for the whole platform).
  const all = await dbRequest('automations?is_active=is.true&trigger=eq.inactive&select=*');
  /** @type {AutomationRow[]} */
  const due = (all.ok && Array.isArray(all.data) ? all.data : []).filter((/** @type {AutomationRow} */ a) => (!a.last_scan_at || Date.now() - Date.parse(a.last_scan_at) > SCAN_EVERY_MS));
  let scheduled = 0;

  for (const a of due) {
    // Claim the scan so two workers running at once don't both do it.
    const staleBefore = new Date(Date.now() - SCAN_EVERY_MS).toISOString();
    const claim = await dbRequest(
      `automations?id=eq.${a.id}&or=(last_scan_at.is.null,last_scan_at.lt.${encodeURIComponent(staleBefore)})`,
      { method: 'PATCH', prefer: 'return=representation', body: { last_scan_at: new Date().toISOString() } }
    );
    if (!claim.ok || !claim.data?.length) continue;
    clearCache();

    const cutoff = Date.now() - a.delay_minutes * 60000;
    const from = new Date(cutoff - INACTIVE_WINDOW_MS).toISOString();
    const to = new Date(cutoff).toISOString();
    const leads = await dbRequest(
      `whatsapp_leads?select=phone,name&business_id=eq.${a.business_id}&opted_out=is.false&last_contacted_at=gte.${encodeURIComponent(from)}&last_contacted_at=lt.${encodeURIComponent(to)}&limit=500`
    );
    if (!leads.ok || !leads.data.length) continue;

    // Skip anyone this automation already messaged for this quiet spell.
    const recent = await dbRequest(
      `automation_runs?select=phone&automation_id=eq.${a.id}&created_at=gte.${encodeURIComponent(from)}&limit=5000`
    );
    const already = new Set(recent.ok ? recent.data.map((/** @type {RunRow} */ r) => r.phone) : []);
    const window = await sendWindowFor(a.business_id);
    for (const l of leads.data) {
      if (already.has(l.phone) || !/^\d{7,15}$/.test(String(l.phone))) continue;
      // "Quiet for N days" means: send now (within the sending window).
      const row = {
        business_id: a.business_id, automation_id: a.id, phone: l.phone, name: l.name, data: {},
        due_at: intoSendingWindow(new Date(), window).toISOString(),
      };
      const ins = await dbRequest('automation_runs', { method: 'POST', prefer: 'return=minimal', body: row });
      if (ins.ok) scheduled++;
    }
  }
  return scheduled;
}

// ---------------------------------------------------------------------------
// Sending due runs
// ---------------------------------------------------------------------------

/** @param {string} path @param {string[]} phones @param {string} timeField @returns {Promise<Map<string, number>>} */
async function latestByPhone(path, phones, timeField) {
  if (!phones.length) return new Map();
  const res = await dbRequest(`${path}&order=${timeField}.desc&limit=1000`);
  /** @type {Map<string, number>} */
  const map = new Map();
  for (const row of res.ok ? res.data : []) {
    const key = row.sender || row.phone;
    if (!map.has(key)) map.set(key, Date.parse(row[timeField]));
  }
  return map;
}

/**
 * The number a follow-up goes out from. With several numbers: the one this customer last wrote to, if it is
 * in the same WhatsApp Business Account as the main number (where the follow-up's template was chosen);
 * otherwise the main number. null if the business can't send.
 * @param {string} biz @param {string} phone
 */
async function followUpNumber(biz, phone) {
  const main = await getWhatsApp(biz);
  if (!main) return null;
  const theirs = await whatsappFor(biz, phone);
  return theirs && theirs.wabaId === main.wabaId ? theirs : main;
}

/** @param {{ deadlineMs?: number, batchSize?: number, concurrency?: number }} [options] */
async function processDueRuns({ deadlineMs = 10000, batchSize = 25, concurrency = 5 } = {}) {
  const started = Date.now();
  const totals = { claimed: 0, sent: 0, cancelled: 0, failed: 0, skipped: 0, retried: 0 };
  /** @type {Map<string, AutomationRow>} */
  const automations = new Map();

  while (Date.now() - started < deadlineMs - 3000) {
    const claim = await dbRequest('rpc/claim_due_automation_runs', { method: 'POST', body: { batch_size: batchSize } });
    if (!claim.ok || !Array.isArray(claim.data) || !claim.data.length) break;
    /** @type {RunRow[]} */
    const batch = claim.data;
    totals.claimed += batch.length;

    const missing = [...new Set(batch.map(r => String(r.automation_id)))].filter(id => !automations.has(id));
    if (missing.length) {
      const res = await dbRequest(`automations?id=in.(${missing.join(',')})&select=*`);
      (res.ok ? res.data : []).forEach((/** @type {AutomationRow} */ a) => automations.set(a.id, a));
    }

    // A batch can hold runs of several businesses: check replies, orders and STOPs per business.
    /** @type {Map<string, RunRow[]>} */
    const byBusiness = new Map();
    for (const r of batch) {
      const list = byBusiness.get(r.business_id) || [];
      list.push(r);
      byBusiness.set(r.business_id, list);
    }
    /** @type {Map<string, { optedOut: Set<string>, lastInbound: Map<string, number>, lastOrder: Map<string, number> }>} */
    const checks = new Map(); // businessId -> { optedOut, lastInbound, lastOrder }
    for (const [biz, runs] of byBusiness) {
      /** @type {string[]} */
      const phones = [...new Set(runs.map(r => r.phone))];
      const list = phones.join(',');
      const oldest = new Date(Math.min(...runs.map(r => Date.parse(r.created_at)))).toISOString();
      const [oo, lastInbound, lastOrder] = await Promise.all([
        dbRequest(`whatsapp_leads?select=phone&business_id=eq.${biz}&opted_out=is.true&phone=in.(${list})`),
        latestByPhone(`whatsapp_messages?select=sender,timestamp&business_id=eq.${biz}&direction=eq.inbound&sender=in.(${list})&timestamp=gte.${encodeURIComponent(oldest)}`, phones, 'timestamp'),
        latestByPhone(`contact_events?select=phone,created_at&business_id=eq.${biz}&event_type=eq.order_enquiry&phone=in.(${list})&created_at=gte.${encodeURIComponent(oldest)}`, phones, 'created_at'),
      ]);
      checks.set(biz, { optedOut: new Set(oo.ok ? oo.data.map((/** @type {RunRow} */ r) => r.phone) : []), lastInbound, lastOrder });
    }

    await campaigns.mapLimit(batch, concurrency, async (/** @type {RunRow} */ r) => {
      const a = automations.get(String(r.automation_id));
      const biz = r.business_id;
      const check = checks.get(biz);
      /** @param {Record<string, unknown>} body */
      const patch = (body) => dbRequest(`automation_runs?id=eq.${r.id}`, { method: 'PATCH', prefer: 'return=minimal', body });
      const createdAt = Date.parse(r.created_at);

      if (!a || !a.is_active || a.business_id !== biz || !check) { totals.cancelled++; return patch({ status: 'cancelled', reason: 'Automation paused' }); }
      const { optedOut, lastInbound, lastOrder } = check;
      // Never send one business's follow-up from another business's WhatsApp number.
      const wa = await followUpNumber(biz, r.phone);
      if (!wa) { totals.failed++; return patch({ status: 'failed', reason: NO_WHATSAPP }); }
      if (optedOut.has(r.phone)) { totals.skipped++; return patch({ status: 'skipped', reason: 'Customer opted out' }); }
      // A few seconds' grace: the click that triggered the event is itself an inbound message.
      if (a.stop_if_replied && (lastInbound.get(r.phone) || 0) > createdAt + 5000) {
        totals.cancelled++; return patch({ status: 'cancelled', reason: 'Customer replied before it was due' });
      }
      if (a.stop_if_ordered && (lastOrder.get(r.phone) || 0) > createdAt + 1000) {
        totals.cancelled++; return patch({ status: 'cancelled', reason: 'Customer ordered before it was due' });
      }

      const needs = a.variables?.needs || {};
      const contact = { name: r.name, item: r.data?.item };
      const res = await sendTemplateMessage(wa, r.phone, a.template_name, a.template_language, tpl.buildSendComponents(needs, a.variables, contact));

      if (res.error || !res.messages?.[0]?.id) {
        const e = campaigns.classifyError(res.error, r.attempts);
        if (Number(e.code) === campaigns.USER_OPTED_OUT_CODE) await campaigns.setOptOut(biz, r.phone, true);
        if (e.retry) { totals.retried++; return patch({ status: 'scheduled', reason: e.message }); }
        totals.failed++;
        return patch({ status: 'failed', reason: e.message });
      }

      totals.sent++;
      const wamid = res.messages[0].id;
      await patch({ status: 'sent', wamid, reason: null, sent_at: new Date().toISOString() });

      const item = {
        id: wamid,
        direction: 'outbound',
        sender: wa.phoneNumber,
        senderName: `🔁 ${a.name}`,
        recipient: r.phone,
        body: `[🔁 Follow-up: ${a.name}]\n${tpl.renderPreview(needs, a.variables, contact)}`,
        type: 'template',
        timestamp: new Date().toISOString(),
        deliveryStatus: 'sent',
        numberId: wa.phoneNumberId || null,
      };
      pushMessage(item, biz);
      broadcastEvent('message', item, biz);
      await logMessage(biz, item);
      // An imported person who was never contacted counts as contacted from now on (server/leadImport.cjs).
      await require('./leadImport.cjs').markContacted(biz, String(r.phone));
    });

    if (batch.length < batchSize) break;
  }
  return totals;
}

// ---------------------------------------------------------------------------
// CRUD for the dashboard
// ---------------------------------------------------------------------------

/**
 * @param {string} biz @param {Input} input
 * @returns {Promise<{ error: string, row?: undefined } | { error?: undefined, row: AutomationRow }>}
 */
async function buildAutomationRow(biz, input) {
  const wa = await getWhatsApp(biz);
  if (!wa) return { error: NO_WHATSAPP };
  const v = validateAutomationInput(input);
  if (v.error !== undefined) return v;
  const loaded = await campaigns.loadApprovedTemplate(wa, input.templateName, input.language);
  if (loaded.error) return { error: loaded.error };
  const needs = tpl.templateNeeds(loaded.template);
  const variables = { header: input.variables?.header || [], body: input.variables?.body || [], headerMediaUrl: input.variables?.headerMediaUrl || '' };
  const varError = tpl.checkVariables(needs, variables, { allowEventItem: TRIGGERS[v.row.trigger].eventBased && v.row.trigger !== 'new_contact' });
  if (varError) return { error: varError };
  return {
    row: {
      ...v.row,
      template_name: loaded.template.name,
      template_language: loaded.template.language,
      template_category: loaded.template.category,
      variables: { ...variables, needs },
    },
  };
}

/** @param {string} biz */
async function listAutomations(biz) {
  requireBusinessId(biz);
  const a = await dbRequest(`automations?select=*&business_id=eq.${biz}&order=created_at.desc`);
  if (!a.ok) return { error: 'Could not load automations. Has the Phase 3 SQL been run?' };
  /** @type {AutomationRow[]} */
  const rows = a.data;
  const ids = rows.map(x => x.id);
  const s = ids.length ? await dbRequest(`automation_stats?select=*&automation_id=in.(${ids.join(',')})`) : { ok: true, data: [] };
  /** @type {Map<string, Record<string, any>>} */
  const stats = new Map((s.ok ? s.data : []).map((/** @type {Record<string, any>} */ x) => [x.automation_id, x]));
  return { automations: rows.map(x => ({ ...x, stats: stats.get(x.id) || null })) };
}

/** @param {string} biz @param {unknown} id */
async function getAutomation(biz, id) {
  requireBusinessId(biz);
  if (!isUuid(id)) return { error: 'Invalid automation id.' };
  const [a, s, r] = await Promise.all([
    dbRequest(`automations?id=eq.${id}&business_id=eq.${biz}&select=*`),
    dbRequest(`automation_stats?automation_id=eq.${id}&select=*`),
    dbRequest(`automation_runs?automation_id=eq.${id}&business_id=eq.${biz}&select=id,phone,name,data,status,reason,due_at,sent_at,read_at,replied_at,created_at&order=created_at.desc&limit=300`),
  ]);
  if (!a.ok || !a.data?.[0]) return { error: 'Automation not found.' };
  return { automation: { ...a.data[0], stats: s.data?.[0] || null }, runs: r.ok ? r.data : [] };
}

/** @param {Staff} staff @param {Input} input */
async function createAutomation(staff, input) {
  const biz = requireBusinessId(staff?.businessId);
  const staffEmail = staff.email;
  const built = await buildAutomationRow(biz, input);
  if (built.error !== undefined) return built;
  if (built.row.is_active) {
    const room = await limits.check(biz, 'automations', 1);
    if (room.error) return { error: room.error, limitReached: true };
  }
  const res = await dbRequest('automations', {
    method: 'POST',
    prefer: 'return=representation',
    body: { ...built.row, business_id: biz, created_by: staffEmail },
  });
  if (!res.ok || !res.data?.[0]) return { error: 'Could not save the automation. Has the Phase 3 SQL been run?' };
  clearCache();
  return { automation: res.data[0] };
}

/** @param {string} biz @param {unknown} id @param {string} reason */
async function cancelPending(biz, id, reason) {
  await dbRequest(`automation_runs?business_id=eq.${biz}&automation_id=eq.${id}&status=eq.scheduled`, {
    method: 'PATCH', prefer: 'return=minimal', body: { status: 'cancelled', reason },
  });
}

/** @param {string} biz @param {unknown} id @param {Input} [input] */
async function updateAutomation(biz, id, input = {}) {
  requireBusinessId(biz);
  if (!isUuid(id)) return { error: 'Invalid automation id.' };
  /** @type {AutomationRow} */
  let body;
  const keys = Object.keys(input);
  if (keys.length === 1 && keys[0] === 'isActive') {
    body = { is_active: !!input.isActive };
  } else {
    const built = await buildAutomationRow(biz, input);
    if (built.error !== undefined) return built;
    body = built.row;
  }
  body.updated_at = new Date().toISOString();
  // Plan limit: switching a paused follow-up on counts as one more active follow-up.
  if (body.is_active === true) {
    const cur = await dbRequest(`automations?id=eq.${id}&business_id=eq.${biz}&select=is_active`);
    if (cur.ok && cur.data?.[0] && !cur.data[0].is_active) {
      const room = await limits.check(biz, 'automations', 1);
      if (room.error) return { error: room.error, limitReached: true };
    }
  }
  const res = await dbRequest(`automations?id=eq.${id}&business_id=eq.${biz}`, { method: 'PATCH', prefer: 'return=representation', body });
  if (!res.ok || !res.data?.[0]) return { error: 'Could not update the automation.' };
  // Paused: drop what was waiting, so re-enabling later doesn't send stale follow-ups.
  if (body.is_active === false) await cancelPending(biz, id, 'Automation paused');
  clearCache();
  return { automation: res.data[0] };
}

/** @param {string} biz @param {unknown} id */
async function deleteAutomation(biz, id) {
  requireBusinessId(biz);
  if (!isUuid(id)) return { error: 'Invalid automation id.' };
  const res = await dbRequest(`automations?id=eq.${id}&business_id=eq.${biz}`, { method: 'DELETE', prefer: 'return=representation' });
  if (!res.ok || !res.data?.length) return { error: 'Automation not found.' };
  clearCache();
  return { deleted: true };
}

/** @param {string} biz @param {unknown} runId */
async function cancelRun(biz, runId) {
  requireBusinessId(biz);
  if (!/^\d+$/.test(String(runId))) return { error: 'Invalid id.' };
  const res = await dbRequest(`automation_runs?id=eq.${runId}&business_id=eq.${biz}&status=eq.scheduled`, {
    method: 'PATCH', prefer: 'return=representation', body: { status: 'cancelled', reason: 'Cancelled by staff' },
  });
  if (!res.ok || !res.data?.length) return { error: 'This follow-up is no longer waiting.' };
  return { cancelled: true };
}

module.exports = {
  TRIGGERS,
  EVENT_TRIGGERS,
  intoSendingWindow,
  computeDueAt,
  triggersForEvent,
  validateAutomationInput,
  describeDelay,
  eventFromInteractive,
  cleanTitle,
  recordEvent,
  scanInactive,
  followUpNumber,
  processDueRuns,
  listAutomations,
  getAutomation,
  createAutomation,
  updateAutomation,
  deleteAutomation,
  cancelRun,
};
