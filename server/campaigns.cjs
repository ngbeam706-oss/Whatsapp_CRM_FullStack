// @ts-check
// Broadcast campaigns: audience selection, campaign creation, and the batch sender.
//
// Sending model: recipients are queued in Supabase. Senders "claim" small batches
// with claim_campaign_recipients() (SKIP LOCKED, so no one is messaged twice) and
// work until a time budget runs out. Two places run the sender:
//   * POST /api/campaigns/:id/start  - sends the first batches right away
//   * netlify/functions/broadcast-worker.cjs - every minute until the queue is empty
const { dbRequest, logMessage } = require('./db.cjs');
const { sendTemplateMessage } = require('./meta.cjs');
const { pushMessage, broadcastEvent } = require('./state.cjs');
const tpl = require('./templates.cjs');
const { requireBusinessId, NO_WHATSAPP } = require('./tenant.cjs');
const { getWhatsApp } = require('./whatsapp.cjs');
const limits = require('./limits.cjs');

/**
 * Who a campaign goes to: pasted numbers (mode 'list') or a filter on contacts.
 * @typedef {{ mode?: string, phones?: unknown, sources?: string[], activeWithinDays?: number | string, tags?: string[] }} Segment
 * @typedef {{ phone: string, name: string | null }} Recipient
 * @typedef {{ header?: any[], body?: any[], headerMediaUrl?: string }} TemplateVariables
 * @typedef {{ name?: string, templateName?: string, language?: string, variables?: TemplateVariables, segment?: Segment, sendNow?: boolean, fromNumberId?: unknown }} CampaignInput
 *   fromNumberId: send from this business number (default: the main number)
 * @typedef {import('./types.cjs').Staff} Staff
 */

const PAGE = 1000;
const MAX_AUDIENCE = 20000;
/** PostgREST quoted list item. @param {unknown} s */
const q = (s) => `"${String(s).replace(/"/g, '')}"`;

// Meta error codes worth retrying (rate limits / temporary problems).
const RETRYABLE_CODES = new Set([1, 2, 4, 80007, 130429, 131000, 131016, 131048, 131056, 133004]);
// "This user has stopped receiving marketing messages from you."
const USER_OPTED_OUT_CODE = 131050;

// ---------------------------------------------------------------------------
// Audience
// ---------------------------------------------------------------------------

/** @param {unknown} phones  a list, or text with numbers separated by spaces/commas @returns {string[]} */
function cleanPhoneList(phones) {
  return [...new Set((Array.isArray(phones) ? phones : String(phones || '').split(/[\s,;]+/))
    .map(p => String(p).replace(/[^\d]/g, ''))
    .filter(p => /^\d{7,15}$/.test(p)))];
}

/** Build the PostgREST filter for a segment: { sources[], activeWithinDays, tags[] }. @param {Segment} [segment] @returns {string} */
function segmentFilter(segment = {}) {
  const parts = [];
  const sources = (segment.sources || []).filter(Boolean);
  if (sources.length) parts.push(`source=in.(${sources.map(s => encodeURIComponent(q(s))).join(',')})`);
  const days = Number(segment.activeWithinDays);
  if (Number.isFinite(days) && days > 0) {
    parts.push(`last_contacted_at=gte.${encodeURIComponent(new Date(Date.now() - days * 86400000).toISOString())}`);
  }
  const tags = (segment.tags || []).filter(Boolean);
  if (tags.length) parts.push(`tags=ov.${encodeURIComponent(`{${tags.map(q).join(',')}}`)}`);
  return parts.join('&');
}

/** @param {string} biz @param {string} filter @returns {Promise<Array<{ phone: string, name: string | null, opted_out?: boolean }>>} */
async function fetchLeads(biz, filter) {
  requireBusinessId(biz);
  /** @type {Array<{ phone: string, name: string | null, opted_out?: boolean }>} */
  const rows = [];
  for (let offset = 0; offset < MAX_AUDIENCE; offset += PAGE) {
    const res = await dbRequest(
      `whatsapp_leads?select=phone,name,opted_out&business_id=eq.${biz}&order=phone.asc&limit=${PAGE}&offset=${offset}${filter ? '&' + filter : ''}`
    );
    if (!res.ok) throw new Error('Could not read contacts from the database.');
    rows.push(...res.data);
    if (res.data.length < PAGE) break;
  }
  return rows;
}

/**
 * Resolve a segment to recipients.
 * segment.mode === 'list' uses segment.phones (pasted numbers); otherwise filters contacts.
 * Returns { recipients: [{phone,name}], optedOut: n, unknown: n }.
 * @param {string} biz
 * @param {Segment} [segment]
 * @returns {Promise<{ recipients: Recipient[], optedOut: number, unknown: number }>}
 */
async function resolveAudience(biz, segment = {}) {
  requireBusinessId(biz);
  if (segment.mode === 'list') {
    const phones = cleanPhoneList(segment.phones);
    /** @type {Map<string, { phone: string, name: string | null, opted_out?: boolean }>} */
    const known = new Map();
    for (let i = 0; i < phones.length; i += 200) {
      const chunk = phones.slice(i, i + 200);
      const res = await dbRequest(`whatsapp_leads?select=phone,name,opted_out&business_id=eq.${biz}&phone=in.(${chunk.join(',')})`);
      if (!res.ok) throw new Error('Could not read contacts from the database.');
      res.data.forEach((/** @type {{ phone: string, name: string | null, opted_out?: boolean }} */ r) => known.set(r.phone, r));
    }
    // Numbers whose lead was deleted after they replied STOP (server/leadsTools.cjs) are never sent to either.
    const suppressed = await require('./leadsTools.cjs').suppressedAmong(biz, phones.filter(p => !known.has(p)));
    const blocked = (/** @type {string} */ p) => !!known.get(p)?.opted_out || suppressed.has(p);
    const optedOut = phones.filter(blocked).length;
    const recipients = phones.filter(p => !blocked(p)).map(p => ({ phone: p, name: known.get(p)?.name || null }));
    return { recipients, optedOut, unknown: phones.filter(p => !known.has(p) && !suppressed.has(p)).length };
  }

  const leads = await fetchLeads(biz, segmentFilter(segment));
  const recipients = leads.filter(l => !l.opted_out && /^\d{7,15}$/.test(String(l.phone))).map(l => ({ phone: l.phone, name: l.name }));
  return { recipients, optedOut: leads.filter(l => l.opted_out).length, unknown: 0 };
}

/** @param {string} biz */
async function audienceOptions(biz) {
  const res = await dbRequest(`whatsapp_leads?select=source,tags,opted_out&business_id=eq.${requireBusinessId(biz)}&limit=20000`);
  if (!res.ok) return { sources: [], tags: [], total: 0, optedOut: 0 };
  /** @type {Array<{ source: string | null, tags: string[] | null, opted_out: boolean }>} */
  const rows = res.data;
  const sources = [...new Set(rows.map(r => r.source).filter(Boolean))].sort();
  const tags = [...new Set(rows.flatMap(r => r.tags || []))].sort();
  return { sources, tags, total: rows.length, optedOut: rows.filter(r => r.opted_out).length };
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

/**
 * The template, if it exists in the WhatsApp account and is APPROVED.
 * @param {any} wa @param {string | undefined} name @param {string | undefined} language
 * @returns {Promise<{ error: string, template?: undefined } | { error?: undefined, template: any }>}
 */
async function loadApprovedTemplate(wa, name, language) {
  const found = /** @type {{ error?: { message: string }, data?: any }} */ (await tpl.findTemplate(wa, name, language));
  if (found.error) return { error: found.error.message };
  if (!found.data) return { error: `Template "${name}" (${language}) was not found in your WhatsApp account.` };
  if (found.data.status !== 'APPROVED') return { error: `Template "${name}" is ${found.data.status}, not APPROVED yet.` };
  return { template: found.data };
}

/**
 * The number a broadcast / test goes out from: the main number, or one of THIS business's extra numbers.
 * Templates are then read from that number's WhatsApp Business Account.
 * @param {string} biz @param {unknown} fromNumberId
 * @returns {Promise<{ error: string, wa?: undefined, extra?: undefined } | { error?: undefined, wa: import('./whatsapp.cjs').WhatsAppConn, extra: boolean }>}
 */
async function sendingNumber(biz, fromNumberId) {
  const main = await getWhatsApp(biz);
  if (!main) return { error: NO_WHATSAPP };
  const want = fromNumberId == null ? '' : String(fromNumberId).trim();
  if (!want || want === String(main.phoneNumberId)) return { wa: main, extra: false };
  if (!/^\d{5,30}$/.test(want)) return { error: 'Choose one of your WhatsApp numbers.' };
  const wa = await require('./whatsapp.cjs').connectionForNumber(biz, want);
  if (!wa) return { error: 'That WhatsApp number isn\'t connected to this business.' };
  return { wa, extra: true };
}

/** @param {Staff} staff @param {CampaignInput} [input] */
async function createCampaign(staff, input = {}) {
  const biz = requireBusinessId(staff?.businessId);
  const staffEmail = staff.email;
  const from = await sendingNumber(biz, input.fromNumberId);
  if (from.error !== undefined) return { error: from.error };
  const wa = from.wa;
  const name = String(input.name || '').trim().slice(0, 120);
  if (!name) return { error: 'Give the campaign a name.' };

  const loaded = await loadApprovedTemplate(wa, input.templateName, input.language);
  if (loaded.error !== undefined) return { error: loaded.error };
  const needs = tpl.templateNeeds(loaded.template);
  const variables = { header: input.variables?.header || [], body: input.variables?.body || [], headerMediaUrl: input.variables?.headerMediaUrl || '' };
  const varError = tpl.checkVariables(needs, variables);
  if (varError) return { error: varError };

  const audience = await resolveAudience(biz, input.segment);
  if (!audience.recipients.length) return { error: 'No one matches this audience (opted-out contacts are excluded).' };
  // Plan limit: broadcast messages this month.
  const room = await limits.check(biz, 'broadcasts', audience.recipients.length);
  if (room.error) return { error: room.error, limitReached: true };

  const created = await dbRequest('campaigns', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      business_id: biz,
      name,
      template_name: loaded.template.name,
      template_language: loaded.template.language,
      template_category: loaded.template.category,
      variables: { ...variables, needs }, // template snapshot so the sender needn't call Meta
      segment: input.segment || {},
      created_by: staffEmail,
      // An extra number chosen as the sender (the main number is stored as null, as before).
      ...(from.extra ? { phone_number_id: wa.phoneNumberId } : {}),
    },
  });
  if (!created.ok || !created.data?.[0]) return { error: 'Could not save the campaign. Has the Phase 2 SQL been run?' };
  const campaign = created.data[0];

  for (let i = 0; i < audience.recipients.length; i += 500) {
    const rows = audience.recipients.slice(i, i + 500).map((r) => ({ business_id: biz, campaign_id: campaign.id, phone: r.phone, name: r.name }));
    const ins = await dbRequest('campaign_recipients', { method: 'POST', prefer: 'return=minimal', body: rows });
    if (!ins.ok) {
      await dbRequest(`campaigns?id=eq.${campaign.id}&business_id=eq.${biz}`, { method: 'DELETE' });
      return { error: 'Could not save the recipient list.' };
    }
  }

  return { campaign, recipients: audience.recipients.length, optedOutExcluded: audience.optedOut };
}

/** @param {string} biz */
async function listCampaigns(biz) {
  requireBusinessId(biz);
  const c = await dbRequest(`campaigns?select=*&business_id=eq.${biz}&order=created_at.desc&limit=100`);
  if (!c.ok) return { error: 'Could not load campaigns. Has the Phase 2 SQL been run?' };
  /** @type {Array<{ id: string } & Record<string, unknown>>} */
  const list = c.data;
  // Stats only for this business's campaigns.
  const ids = list.map(x => x.id);
  const s = ids.length ? await dbRequest(`campaign_stats?select=*&campaign_id=in.(${ids.join(',')})`) : { ok: true, data: [] };
  /** @type {Map<string, unknown>} */
  const stats = new Map((s.ok ? s.data : []).map((/** @type {{ campaign_id: string }} */ r) => [r.campaign_id, r]));
  return { campaigns: list.map(x => ({ ...x, stats: stats.get(x.id) || null })) };
}

/** @param {string} biz @param {unknown} id  checked here */
async function getCampaign(biz, id) {
  requireBusinessId(biz);
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return { error: 'Invalid campaign id.' };
  const [c, s, r] = await Promise.all([
    dbRequest(`campaigns?id=eq.${id}&business_id=eq.${biz}&select=*`),
    dbRequest(`campaign_stats?campaign_id=eq.${id}&select=*`),
    dbRequest(`campaign_recipients?campaign_id=eq.${id}&business_id=eq.${biz}&select=phone,name,status,error,sent_at,delivered_at,read_at,replied_at&order=id.asc&limit=2000`),
  ]);
  if (!c.ok || !c.data?.[0]) return { error: 'Campaign not found.' };
  return { campaign: { ...c.data[0], stats: s.data?.[0] || null }, recipients: r.ok ? r.data : [] };
}

/** @param {string} biz @param {unknown} id  checked here @param {{ deadlineMs?: number }} [options] */
async function startCampaign(biz, id, { deadlineMs = 7000 } = {}) {
  requireBusinessId(biz);
  if (!(await getWhatsApp(biz))) return { error: NO_WHATSAPP };
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return { error: 'Invalid campaign id.' };
  const upd = await dbRequest(`campaigns?id=eq.${id}&business_id=eq.${biz}&status=eq.draft`, {
    method: 'PATCH',
    prefer: 'return=representation',
    body: { status: 'sending', started_at: new Date().toISOString() },
  });
  if (!upd.ok || !upd.data?.length) return { error: 'Only draft campaigns can be started.' };
  const progress = await processBatches({ deadlineMs });
  return { started: true, progress };
}

/** @param {string} biz @param {unknown} id  checked here */
async function cancelCampaign(biz, id) {
  requireBusinessId(biz);
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return { error: 'Invalid campaign id.' };
  const upd = await dbRequest(`campaigns?id=eq.${id}&business_id=eq.${biz}&status=in.(draft,sending)`, {
    method: 'PATCH',
    prefer: 'return=representation',
    body: { status: 'cancelled', completed_at: new Date().toISOString() },
  });
  if (!upd.ok || !upd.data?.length) return { error: 'This campaign is already finished.' };
  await dbRequest(`campaign_recipients?campaign_id=eq.${id}&business_id=eq.${biz}&status=eq.queued`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: { status: 'skipped', error: 'Campaign cancelled' },
  });
  return { cancelled: true };
}

/**
 * Send one template to one number without creating a campaign (for testing).
 * @param {string} biz
 * @param {{ to?: unknown, templateName?: string, language?: string, variables?: TemplateVariables, contactName?: string, fromNumberId?: unknown }} [input]
 */
async function sendTest(biz, input = {}) {
  requireBusinessId(biz);
  const from = await sendingNumber(biz, input.fromNumberId);
  if (from.error !== undefined) return { error: from.error };
  const wa = from.wa;
  const to = String(input.to || '').replace(/[^\d]/g, '');
  if (!/^\d{7,15}$/.test(to)) return { error: 'Enter a valid number with country code.' };
  const loaded = await loadApprovedTemplate(wa, input.templateName, input.language);
  if (loaded.error !== undefined) return { error: loaded.error };
  const needs = tpl.templateNeeds(loaded.template);
  const variables = input.variables || {};
  const varError = tpl.checkVariables(needs, variables);
  if (varError) return { error: varError };
  const contact = { name: input.contactName || '' };
  const room = await limits.check(biz, 'broadcasts', 1);
  if (room.error) return { error: room.error, limitReached: true };
  const res = await sendTemplateMessage(wa, to, loaded.template.name, loaded.template.language, tpl.buildSendComponents(needs, variables, contact));
  if (res.error) return { error: res.error.error_user_msg || res.error.message || 'Meta rejected the message.' };
  await limits.addUsage(biz, 'broadcasts', 1);
  return { sent: true, wamid: res.messages?.[0]?.id, preview: tpl.renderPreview(needs, variables, contact) };
}

// ---------------------------------------------------------------------------
// Batch sender
// ---------------------------------------------------------------------------

/**
 * Run `fn` over `items`, at most `limit` at a time.
 * @template T
 * @param {T[]} items @param {number} limit @param {(item: T) => Promise<unknown>} fn
 */
async function mapLimit(items, limit, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/**
 * Retry or give up after a failed send?
 * @param {any} err  Meta's error object
 * @param {number} attempts
 * @returns {{ code: number, message: string, retry: boolean }}
 */
function classifyError(err, attempts) {
  const code = Number(err?.code);
  const message = String(err?.error_data?.details || err?.error_user_msg || err?.message || 'Send failed').slice(0, 300);
  const retry = (!err?.code || RETRYABLE_CODES.has(code)) && attempts < 3;
  return { code, message: code ? `${message} (code ${code})` : message, retry };
}

async function finishSendingCampaigns() {
  const sending = await dbRequest('campaigns?status=eq.sending&select=id');
  if (!sending.ok || !sending.data.length) return;
  const ids = sending.data.map((/** @type {{ id: string }} */ c) => c.id);
  const stats = await dbRequest(`campaign_stats?campaign_id=in.(${ids.join(',')})&select=campaign_id,pending`);
  if (!stats.ok) return;
  for (const s of stats.data) {
    if (Number(s.pending) === 0) {
      await dbRequest(`campaigns?id=eq.${s.campaign_id}&status=eq.sending`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: { status: 'completed', completed_at: new Date().toISOString() },
      });
    }
  }
}

/**
 * Send queued campaign messages until the time budget runs out or the queue is empty.
 * Returns counts for this run.
 * @param {{ deadlineMs?: number, batchSize?: number, concurrency?: number }} [options]
 */
async function processBatches({ deadlineMs = 8000, batchSize = 25, concurrency = 5 } = {}) {
  const started = Date.now();
  const totals = { claimed: 0, sent: 0, failed: 0, skipped: 0, retried: 0 };
  /** @type {Map<string, any>} campaign id -> campaigns row */
  const campaigns = new Map();

  while (Date.now() - started < deadlineMs - 3000) {
    const claim = await dbRequest('rpc/claim_campaign_recipients', { method: 'POST', body: { batch_size: batchSize } });
    if (!claim.ok || !Array.isArray(claim.data) || !claim.data.length) break;
    /** @type {Array<{ id: number, campaign_id: string, business_id: string, phone: string, name: string | null, attempts: number }>} */
    const batch = claim.data;
    totals.claimed += batch.length;

    const missing = [...new Set(batch.map(r => r.campaign_id))].filter(id => !campaigns.has(id));
    if (missing.length) {
      const res = await dbRequest(`campaigns?id=in.(${missing.join(',')})&select=*`);
      (res.ok ? res.data : []).forEach((/** @type {{ id: string }} */ c) => campaigns.set(c.id, c));
    }

    // Respect STOP replies that arrived after the campaign was created (per business: the same
    // number may be opted out of one business and not another).
    const phones = [...new Set(batch.map(r => r.phone))];
    const oo = await dbRequest(`whatsapp_leads?select=phone,business_id&opted_out=is.true&phone=in.(${phones.join(',')})`);
    const optedOut = new Set(oo.ok ? oo.data.map((/** @type {{ business_id: string, phone: string }} */ r) => `${r.business_id}:${r.phone}`) : []);

    // Plan limit: broadcast messages left this month, per business in this batch.
    /** @type {Map<string, number>} */
    const left = new Map();
    /** @type {Map<string, number>} */
    const sentBy = new Map();
    for (const biz of new Set(batch.map(r => r.business_id))) {
      const { limits: l } = await limits.getPlan(biz);
      const max = l.max_broadcasts_month;
      const usedSoFar = max === null ? 0 : await limits.used(biz, 'broadcasts');
      left.set(biz, max === null || usedSoFar === null ? Infinity : Math.max(max - usedSoFar, 0));
    }

    await mapLimit(batch, concurrency, async (r) => {
      const campaign = campaigns.get(r.campaign_id);
      const biz = r.business_id;
      const patch = (/** @type {Record<string, unknown>} */ body) => dbRequest(`campaign_recipients?id=eq.${r.id}`, { method: 'PATCH', prefer: 'return=minimal', body });

      if (!campaign || campaign.status === 'cancelled' || campaign.business_id !== biz) {
        totals.skipped++;
        return patch({ status: 'skipped', error: 'Campaign cancelled' });
      }
      // Never send one business's broadcast from another business's WhatsApp number: the chosen number
      // must still be one of this business's (connectionForNumber checks), else the message fails.
      const wa = campaign.phone_number_id
        ? await require('./whatsapp.cjs').connectionForNumber(biz, campaign.phone_number_id)
        : await getWhatsApp(biz);
      if (!wa) {
        totals.failed++;
        return patch({ status: 'failed', error: campaign.phone_number_id ? 'The number this broadcast was sent from has been removed.' : NO_WHATSAPP });
      }
      if (optedOut.has(`${biz}:${r.phone}`)) {
        totals.skipped++;
        return patch({ status: 'skipped', error: 'Contact opted out' });
      }
      const remaining = left.get(biz) ?? 0;
      if (!(remaining > 0)) {
        totals.skipped++;
        return patch({ status: 'skipped', error: 'Monthly broadcast limit of your plan reached' });
      }
      left.set(biz, remaining - 1);

      const needs = campaign.variables?.needs || {};
      const contact = { name: r.name };
      const res = await sendTemplateMessage(
        wa,
        r.phone,
        campaign.template_name,
        campaign.template_language,
        tpl.buildSendComponents(needs, campaign.variables, contact)
      );

      if (res.error || !res.messages?.[0]?.id) {
        const e = classifyError(res.error, r.attempts);
        if (Number(e.code) === USER_OPTED_OUT_CODE) {
          await dbRequest(`whatsapp_leads?business_id=eq.${biz}&phone=eq.${r.phone}`, {
            method: 'PATCH', prefer: 'return=minimal', body: { opted_out: true, opted_out_at: new Date().toISOString() },
          });
        }
        if (e.retry) {
          totals.retried++;
          return patch({ status: 'queued', error: e.message });
        }
        totals.failed++;
        return patch({ status: 'failed', error: e.message });
      }

      totals.sent++;
      sentBy.set(biz, (sentBy.get(biz) || 0) + 1);
      const wamid = /** @type {string} */ (res.messages?.[0]?.id);
      await patch({ status: 'sent', wamid, error: null, sent_at: new Date().toISOString() });

      // Show it in the chat log as well.
      const item = {
        id: wamid,
        direction: 'outbound',
        sender: wa.phoneNumber,
        senderName: `📣 ${campaign.name}`,
        recipient: r.phone,
        body: `[📣 Broadcast: ${campaign.name}]\n${tpl.renderPreview(needs, campaign.variables, contact)}`,
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
    for (const [biz, n] of sentBy) await limits.addUsage(biz, 'broadcasts', n);

    if (batch.length < batchSize) break;
  }

  await finishSendingCampaigns();
  return totals;
}

// ---------------------------------------------------------------------------
// Webhook hooks: delivery receipts, replies, opt-outs
// ---------------------------------------------------------------------------

// Each status only moves forward: sent -> delivered -> read. "failed" can follow sent.
/** @type {Record<string, { from: string[], stamp: string | null }>} */
const STATUS_RULES = {
  delivered: { from: ['sending', 'sent'], stamp: 'delivered_at' },
  read: { from: ['sending', 'sent', 'delivered'], stamp: 'read_at' },
  failed: { from: ['sending', 'sent'], stamp: null },
};

/**
 * A delivery receipt from Meta's webhook (sent / delivered / read / failed).
 * @param {string} biz
 * @param {{ id?: string, status?: string, timestamp?: string, errors?: Array<{ title?: string, message?: string, code?: number }> }} status
 */
async function trackDeliveryStatus(biz, status) {
  requireBusinessId(biz);
  const rule = STATUS_RULES[status?.status || ''];
  if (!rule || !status.id) return;
  const at = status.timestamp ? new Date(parseInt(status.timestamp, 10) * 1000).toISOString() : new Date().toISOString();
  /** @type {Record<string, unknown>} */
  const body = { status: status.status };
  if (rule.stamp) body[rule.stamp] = at;
  if (status.status === 'failed') {
    const e = status.errors?.[0];
    body.error = e ? `${e.title || e.message || 'Failed'}${e.code ? ` (code ${e.code})` : ''}`.slice(0, 300) : 'Failed';
  }
  // The same message id lives in either a campaign or an automation follow-up.
  for (const table of ['campaign_recipients', 'automation_runs']) {
    await dbRequest(
      `${table}?business_id=eq.${biz}&wamid=eq.${encodeURIComponent(status.id)}&status=in.(${rule.from.join(',')})`,
      { method: 'PATCH', prefer: 'return=minimal', body }
    );
  }
}

/** @param {string} biz @param {string} phone @returns {Promise<boolean>} */
async function isOptedOut(biz, phone) {
  requireBusinessId(biz);
  if (!/^\d{7,15}$/.test(String(phone))) return false;
  const res = await dbRequest(`whatsapp_leads?select=opted_out&business_id=eq.${biz}&phone=eq.${phone}`);
  if (res.ok && res.data?.[0]?.opted_out) return true;
  // No lead (deleted after STOP): the suppression list still says no.
  return !(res.ok && res.data?.[0]) && require('./leadsTools.cjs').isSuppressed(biz, String(phone));
}

/** A customer replied: mark recent campaign / follow-up messages as replied. @param {string} biz @param {string} phone */
async function trackReply(biz, phone) {
  requireBusinessId(biz);
  if (!/^\d{7,15}$/.test(String(phone))) return;
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  for (const table of ['campaign_recipients', 'automation_runs']) {
    await dbRequest(
      `${table}?business_id=eq.${biz}&phone=eq.${phone}&replied_at=is.null&sent_at=gte.${encodeURIComponent(since)}`,
      { method: 'PATCH', prefer: 'return=minimal', body: { replied_at: new Date().toISOString() } }
    );
  }
}

// Only exact, whole-message keywords. ("cancel" is deliberately excluded: it usually means an order.)
const STOP_WORDS = new Set(['stop', 'unsubscribe', 'stop all', 'opt out', 'optout', 'stop promotions']);
// Resubscribe words. Callers apply them only to contacts who are currently opted out,
// because "start" is also a normal greeting for the bot.
const START_WORDS = new Set(['start', 'subscribe', 'unstop', 'resume']);

/** 'stop' | 'start' | null for an incoming text. @param {unknown} text @returns {'stop' | 'start' | null} */
function optKeyword(text) {
  const t = String(text || '').trim().toLowerCase().replace(/[.!]+$/, '');
  if (STOP_WORDS.has(t)) return 'stop';
  if (START_WORDS.has(t)) return 'start';
  return null;
}

/** @param {string} biz @param {string} phone @param {boolean} optedOut */
async function setOptOut(biz, phone, optedOut) {
  requireBusinessId(biz);
  if (!/^\d{7,15}$/.test(String(phone))) return;
  await dbRequest(`whatsapp_leads?business_id=eq.${biz}&phone=eq.${phone}`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: { opted_out: optedOut, opted_out_at: optedOut ? new Date().toISOString() : null },
  });
  // START: they want messages again, also after their lead was deleted.
  if (!optedOut) await require('./leadsTools.cjs').unsuppress(biz, String(phone));
}

module.exports = {
  cleanPhoneList,
  segmentFilter,
  resolveAudience,
  audienceOptions,
  createCampaign,
  listCampaigns,
  getCampaign,
  startCampaign,
  cancelCampaign,
  sendTest,
  processBatches,
  classifyError,
  trackDeliveryStatus,
  trackReply,
  optKeyword,
  setOptOut,
  isOptedOut,
  loadApprovedTemplate,
  mapLimit,
  RETRYABLE_CODES,
  USER_OPTED_OUT_CODE,
};
