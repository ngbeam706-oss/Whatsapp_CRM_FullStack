// @ts-check
// Platform Admin monitoring: health, alerts, event log, worker runs, delivery failures,
// audit log and a per-business detail view.
//
// Counts, statuses, error codes and short scrubbed error texts only. Chat tables
// (whatsapp_messages, whatsapp_leads, campaign_recipients) are only ever COUNTED here
// (countRows: limit=0), never read. Tokens and secrets are decrypted only to check that
// they are readable; they are never returned.
const { config, missingConfig } = require('./config.cjs');
const { dbRequest, countRows, dbReady } = require('./db.cjs');
const { isBusinessId } = require('./tenant.cjs');
const secrets = require('./secrets.cjs');
const events = require('./events.cjs');
const limitsLib = require('./limits.cjs');

/** @typedef {Record<string, any>} Row  a database row */
/** @typedef {Record<string, any>} Query  URL query parameters (each function checks what it uses) */
/** @typedef {'critical' | 'warn' | 'info'} AlertLevel */
/** @typedef {{ level: AlertLevel, code: string, message: string, businessId: string | null, businessName: string | null }} Alert */
/**
 * @typedef {{ total: number, errors: number, ai: number, meta: number, tokenInvalid: number,
 *   signatureLastHour: number, lastErrorAt: string | null }} BusinessTally
 */

const WORKER_STALE_MIN = 15;
const SIGNATURE_ALERT_PER_HOUR = 5;
const DAY = 86400000;
/** @param {number} ms */
const iso = (ms) => new Date(ms).toISOString();
const enc = encodeURIComponent;
const envBusinessId = () => (process.env.WHATSAPP_BUSINESS_ID || 'a0000000-0000-4000-8000-000000000001').trim();
/** @param {import('./types.cjs').DbResult} r @returns {Row[]} */
const rows = (r) => (r.ok && Array.isArray(r.data) ? r.data : []);
/** @param {unknown} err */
const errText = (err) => (err instanceof Error ? err.message : String(err));

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
/** @returns {Promise<{ ok: boolean, latencyMs: number | null, error?: string }>} */
async function dbPing() {
  if (!dbReady()) return { ok: false, latencyMs: null, error: 'Database settings missing' };
  const t = Date.now();
  try {
    const r = await dbRequest('plans?select=id&limit=1');
    return { ok: !!r.ok, latencyMs: Date.now() - t, ...(r.ok ? {} : { error: `HTTP ${r.status}` }) };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - t, error: events.scrub(errText(err)) };
  }
}

/**
 * @typedef {{ tableMissing?: boolean, last: Row | null, minutesAgo: number | null, runsLastHour: number, runsLastDay: number,
 *   failedLastDay: number, avgDurationMs: number | null, maxDurationMs?: number | null, stale: boolean }} WorkerStatus
 */
/** @param {number} [now] @returns {Promise<WorkerStatus>} */
async function workerStatus(now = Date.now()) {
  const r = await dbRequest(`worker_runs?select=id,started_at,finished_at,duration_ms,ok,error_count&started_at=gte.${enc(iso(now - DAY))}&order=started_at.desc&limit=300`);
  if (!r.ok) return { tableMissing: true, last: null, minutesAgo: null, runsLastHour: 0, runsLastDay: 0, failedLastDay: 0, avgDurationMs: null, stale: true };
  /** @type {Row[]} */
  const list = r.data || [];
  const last = list[0] || null;
  const minutesAgo = last ? Math.floor((now - Date.parse(last.started_at)) / 60000) : null;
  /** @type {number[]} */
  const durations = list.map(x => x.duration_ms).filter(n => Number.isFinite(n));
  return {
    last,
    minutesAgo,
    runsLastHour: list.filter(x => now - Date.parse(x.started_at) < 3600000).length,
    runsLastDay: list.length,
    failedLastDay: list.filter(x => !x.ok).length,
    avgDurationMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
    maxDurationMs: durations.length ? Math.max(...durations) : null,
    stale: minutesAgo === null || minutesAgo >= WORKER_STALE_MIN,
  };
}

/** Events of the last 24 hours, added up per business / source / code (no rows returned). @param {Row[]} list */
function tallyEvents(list) {
  /** @type {Record<string, number>} */
  const byLevel = { info: 0, warn: 0, error: 0, critical: 0 };
  /** @type {Record<string, number>} */
  const bySource = {};
  /** @type {Map<string, BusinessTally>} */
  const byBusiness = new Map();
  for (const e of list) {
    const n = Number(e.count) || 1;
    byLevel[e.level] = (byLevel[e.level] || 0) + n;
    bySource[e.source] = (bySource[e.source] || 0) + n;
    if (e.business_id) {
      /** @type {BusinessTally} */
      const b = byBusiness.get(e.business_id) || { total: 0, errors: 0, ai: 0, meta: 0, tokenInvalid: 0, signatureLastHour: 0, lastErrorAt: null };
      b.total += n;
      if (e.level === 'error' || e.level === 'critical') { b.errors += n; if (!b.lastErrorAt || e.created_at > b.lastErrorAt) b.lastErrorAt = e.created_at; }
      if (e.source === 'ai') b.ai += n;
      if (e.source === 'meta') b.meta += n;
      if (e.code === 'token_invalid') b.tokenInvalid += n;
      if (e.code === 'signature_invalid' && Date.now() - Date.parse(e.created_at) < 3600000) b.signatureLastHour += n;
      byBusiness.set(e.business_id, b);
    }
  }
  return { byLevel, bySource, byBusiness };
}

/** @param {number} [now] */
async function health(now = Date.now()) {
  const [db, worker, biz, wa, hl, ads, ai, ev] = await Promise.all([
    dbPing(),
    workerStatus(now),
    dbRequest('businesses?select=id,name,slug,status,plan_id,limit_overrides,paid_until&order=created_at.asc'),
    dbRequest('business_whatsapp?select=business_id,phone_number,phone_number_id,token_last4,access_token_enc,app_secret_enc,connected_at'),
    dbRequest('business_health?select=*'),
    dbRequest('business_ad_accounts?select=business_id,connected_at,last_sync_at,last_sync_error'),
    dbRequest('ai_provider?select=business_id,provider,model,key_last4,api_key_enc'),
    dbRequest(`system_events?select=business_id,level,source,code,count,created_at&created_at=gte.${enc(iso(now - DAY))}&order=created_at.desc&limit=5000`),
  ]);
  const waBy = new Map(rows(wa).map(w => [w.business_id, w]));
  const hlBy = new Map(rows(hl).map(h => [h.business_id, h]));
  const adsBy = new Map(rows(ads).map(a => [a.business_id, a]));
  const aiBy = new Map(rows(ai).map(a => [a.business_id, a]));
  const tally = tallyEvents(rows(ev));
  const envBiz = envBusinessId();

  const businesses = rows(biz).map(b => {
    const w = waBy.get(b.id);
    /** @type {Row} */
    const h = hlBy.get(b.id) || {};
    const a = adsBy.get(b.id);
    const p = aiBy.get(b.id);
    /** @type {BusinessTally} */
    const t = tally.byBusiness.get(b.id) || { total: 0, errors: 0, ai: 0, meta: 0, tokenInvalid: 0, signatureLastHour: 0, lastErrorAt: null };
    const saved = !!(w && w.phone_number_id && w.access_token_enc);
    const env = !saved && b.id === envBiz && !!config.whatsappToken;
    return {
      id: b.id, name: b.name, slug: b.slug, status: b.status, plan_id: b.plan_id,
      whatsapp: {
        connected: saved || env,
        source: saved ? 'saved' : env ? 'env' : 'none',
        tokenReadable: saved ? !!secrets.decrypt(w?.access_token_enc) : env,
        hasAppSecret: saved ? !!w?.app_secret_enc : env && !!config.appSecret,
        qualityRating: h.wa_quality_rating || null,
        messagingTier: h.wa_messaging_tier || null,
        checkedAt: h.wa_checked_at || null,
        checkError: h.wa_check_error || null,
        tokenErrors24h: t.tokenInvalid,
        sendErrors24h: t.meta,
      },
      webhook: { lastReceivedAt: h.last_webhook_at || null, lastSignatureFailAt: h.last_signature_fail_at || null, signatureFailsLastHour: t.signatureLastHour },
      /** @type {{ connected: boolean, lastSyncAt?: string | null, lastSyncError?: string | null }} */
      ads: a ? { connected: true, lastSyncAt: a.last_sync_at || null, lastSyncError: a.last_sync_error ? events.scrub(a.last_sync_error, 300) : null } : { connected: false },
      ai: { configured: !!(p && p.api_key_enc && p.model), provider: p?.provider || null, model: p?.model || null, keyReadable: p?.api_key_enc ? !!secrets.decrypt(p.api_key_enc) : null, errors24h: t.ai },
      events24h: { total: t.total, errors: t.errors, lastErrorAt: t.lastErrorAt },
      paid_until: b.paid_until,
      limit_overrides: b.limit_overrides,
    };
  });

  return {
    checkedAt: iso(now),
    api: {
      ok: true,
      node: process.version,
      uptimeSec: Math.round(process.uptime()),
      memoryMb: Math.round(process.memoryUsage().rss / 1048576),
      missingConfig: missingConfig(),           // names of missing settings only, never values
      encryptionReady: secrets.canEncrypt(),
      unsignedWebhooksAllowed: config.allowUnsignedWebhooks,
    },
    database: db,
    worker,
    events24h: { byLevel: tally.byLevel, bySource: tally.bySource, tableMissing: !ev.ok },
    businesses,
  };
}

// ---------------------------------------------------------------------------
// Alerts (computed from health + limits + billing)
// ---------------------------------------------------------------------------
/** @typedef {Awaited<ReturnType<typeof health>>} Health */

/** @param {Health} h @param {number} [now] @returns {Promise<Alert[]>} */
async function alerts(h, now = Date.now()) {
  /** @type {Alert[]} */
  const out = [];
  /** @param {AlertLevel} level @param {string} code @param {string} message @param {{ id: string, name?: string } | null} [b] */
  const add = (level, code, message, b = null) => out.push({ level, code, message, businessId: b?.id || null, businessName: b?.name || null });

  if (!h.database.ok) add('critical', 'db_down', `The database is not answering (${h.database.error || 'error'}).`);
  if (!h.api.encryptionReady) add('critical', 'no_encryption', 'APP_SECRET is not set: saved tokens and keys cannot be read or stored.');
  if (h.api.unsignedWebhooksAllowed) add('critical', 'unsigned_webhooks', 'ALLOW_UNSIGNED_WEBHOOKS is on: anyone can post fake messages. Turn it off in production.');
  if (h.worker.tableMissing) add('warn', 'worker_table_missing', 'Worker runs are not recorded yet. Run 20261115_admin_console.sql.');
  else if (h.worker.stale) add('critical', 'worker_stale', h.worker.minutesAgo === null ? 'The worker has not run in the last 24 hours.' : `The worker last ran ${h.worker.minutesAgo} minutes ago (expected every 5).`);
  else if (h.worker.last && !h.worker.last.ok) add('warn', 'worker_errors', `The last worker run had ${h.worker.last.error_count} failed step(s). See Worker runs.`);

  const [plans, usage] = await Promise.all([
    dbRequest('plans?select=*'),
    dbRequest(`usage_counters?select=business_id,broadcasts_sent,ai_replies&period=eq.${limitsLib.currentPeriod(now)}`),
  ]);
  const planBy = new Map(rows(plans).map(p => [p.id, p]));
  const usageBy = new Map(rows(usage).map(u => [u.business_id, u]));

  for (const b of h.businesses) {
    if (b.status !== 'active') continue;
    const w = b.whatsapp;
    if (w.connected && !w.tokenReadable) add('critical', 'wa_token_unreadable', 'The saved WhatsApp token cannot be read (server secret changed?). Nothing can be sent.', b);
    if (w.tokenErrors24h) add('critical', 'wa_token_invalid', `Meta rejected the WhatsApp token ${w.tokenErrors24h} time(s) in 24 hours. The Business Admin must paste a new token.`, b);
    if (w.checkError) add('warn', 'wa_check_failed', `Last WhatsApp check failed: ${w.checkError}`, b);
    if (w.qualityRating === 'RED') add('critical', 'wa_quality_red', 'WhatsApp number quality is RED: Meta may limit or block it.', b);
    else if (w.qualityRating === 'YELLOW') add('warn', 'wa_quality_yellow', 'WhatsApp number quality is YELLOW.', b);
    if (w.connected && !w.hasAppSecret) add('warn', 'no_app_secret', 'No App secret saved: incoming messages are rejected.', b);
    if (b.webhook.signatureFailsLastHour >= SIGNATURE_ALERT_PER_HOUR) add(b.webhook.signatureFailsLastHour >= 50 ? 'critical' : 'warn', 'signature_failures', `${b.webhook.signatureFailsLastHour} webhook calls failed the signature check in the last hour (wrong App secret, or someone probing the address).`, b);
    if (b.ads.connected && b.ads.lastSyncError) add('warn', 'ads_sync_error', `Ads sync: ${b.ads.lastSyncError}`, b);
    if (b.ai.configured && b.ai.keyReadable === false) add('warn', 'ai_key_unreadable', 'The saved AI key cannot be read. AI replies are off until it is pasted again.', b);
    if (b.ai.errors24h >= 5) add('warn', 'ai_errors', `${b.ai.errors24h} AI provider errors in 24 hours.`, b);

    const bill = limitsLib.billingState(b.paid_until, now);
    if (bill.state === 'due') add('warn', 'payment_due', `Payment due (paid until ${bill.paidUntil}); pauses on ${bill.suspendOn}.`, b);
    if (bill.state === 'overdue') add('critical', 'payment_overdue', `Payment overdue (paid until ${bill.paidUntil}).`, b);

    const lim = limitsLib.effectiveLimits(planBy.get(b.plan_id) || {}, b.limit_overrides || {});
    /** @type {Row} */
    const u = usageBy.get(b.id) || {};
    const [staff, contacts] = await Promise.all([
      lim.max_staff === null ? null : countRows('staff_members', `business_id=eq.${b.id}`),
      lim.max_contacts === null ? null : countRows('whatsapp_leads', `business_id=eq.${b.id}`),
    ]);
    /** @type {string[]} */
    const over = [];
    if (staff !== null && lim.max_staff !== null && staff > lim.max_staff) over.push(`team ${staff}/${lim.max_staff}`);
    if (contacts !== null && lim.max_contacts !== null && contacts >= lim.max_contacts) over.push(`contacts ${contacts}/${lim.max_contacts}`);
    if (lim.max_broadcasts_month !== null && (u.broadcasts_sent || 0) >= lim.max_broadcasts_month) over.push(`broadcasts ${u.broadcasts_sent}/${lim.max_broadcasts_month}`);
    if (lim.ai_enabled && lim.max_ai_replies_month !== null && (u.ai_replies || 0) >= lim.max_ai_replies_month) over.push(`AI replies ${u.ai_replies}/${lim.max_ai_replies_month}`);
    if (over.length) add('warn', 'over_limits', `At or over plan limits: ${over.join(', ')}.`, b);
  }
  /** @type {Record<AlertLevel, number>} */
  const rank = { critical: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

async function healthWithAlerts() {
  const h = await health();
  return { health: h, alerts: await alerts(h) };
}

// ---------------------------------------------------------------------------
// Event log
// ---------------------------------------------------------------------------
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** @param {Query} [q] */
async function listEvents(q = {}) {
  const f = ['select=id,created_at,level,source,business_id,code,message,count,details', 'order=id.desc'];
  if (q.level) {
    const lv = String(q.level).split(',').filter(l => events.LEVELS.includes(l));
    if (!lv.length) return { error: 'Unknown level.' };
    f.push(`level=in.(${lv.join(',')})`);
  }
  if (q.source) {
    if (!events.SOURCES.includes(String(q.source))) return { error: 'Unknown source.' };
    f.push(`source=eq.${q.source}`);
  }
  if (q.businessId) {
    if (q.businessId === 'none') f.push('business_id=is.null');
    else if (isBusinessId(q.businessId)) f.push(`business_id=eq.${q.businessId}`);
    else return { error: 'Invalid business.' };
  }
  if (q.code) f.push(`code=eq.${enc(String(q.code).replace(/[^\w.:-]/g, '').slice(0, 60))}`);
  if (q.from) { if (!DATE_RE.test(q.from)) return { error: 'From must be a date.' }; f.push(`created_at=gte.${q.from}T00:00:00Z`); }
  if (q.to) { if (!DATE_RE.test(q.to)) return { error: 'To must be a date.' }; f.push(`created_at=lte.${q.to}T23:59:59Z`); }
  if (q.beforeId) { const n = Number(q.beforeId); if (!Number.isInteger(n) || n < 1) return { error: 'Invalid page.' }; f.push(`id=lt.${n}`); }
  const limit = Math.min(Math.max(Number(q.limit) || 100, 1), 200);
  f.push(`limit=${limit}`);
  const r = await dbRequest(`system_events?${f.join('&')}`);
  if (!r.ok) return { error: 'Could not load events. Has 20261115_admin_console.sql been run?', status: 500 };
  return { events: r.data, nextBeforeId: r.data.length === limit ? r.data[r.data.length - 1].id : null };
}

// ---------------------------------------------------------------------------
// Worker runs
// ---------------------------------------------------------------------------
/** @param {Query} [q] */
async function workerRuns(q = {}) {
  const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
  const failedOnly = q.failed === 'true' || q.failed === true ? '&ok=is.false' : '';
  const r = await dbRequest(`worker_runs?select=*&order=started_at.desc&limit=${limit}${failedOnly}`);
  if (!r.ok) return { error: 'Could not load worker runs. Has 20261115_admin_console.sql been run?', status: 500 };
  return { runs: r.data, status: await workerStatus() };
}

// ---------------------------------------------------------------------------
// Delivery and failures (counts only)
// ---------------------------------------------------------------------------
/** @param {Query} [q] */
async function deliveryStats(q = {}) {
  const days = [1, 7, 30].includes(Number(q.days)) ? Number(q.days) : 7;
  const since = enc(iso(Date.now() - days * DAY));
  const biz = await dbRequest('businesses?select=id,name,status&order=created_at.asc');
  if (!biz.ok) return { error: 'Could not load businesses.', status: 500 };
  const ev = await dbRequest(`system_events?select=business_id,count&source=eq.meta&created_at=gte.${since}&limit=10000`);
  /** @type {Map<string, number>} */
  const metaBy = new Map();
  for (const e of rows(ev)) if (e.business_id) metaBy.set(e.business_id, (metaBy.get(e.business_id) || 0) + (Number(e.count) || 1));
  const businesses = await Promise.all(rows(biz).map(async (b) => {
    const id = b.id;
    const [outbound, failedMessages, campaignSent, campaignFailed, campaignSkipped, optedOutTotal, optOutsInPeriod] = await Promise.all([
      countRows('whatsapp_messages', `business_id=eq.${id}&direction=eq.outbound&timestamp=gte.${since}`),
      countRows('whatsapp_messages', `business_id=eq.${id}&direction=eq.outbound&delivery_status=eq.failed&timestamp=gte.${since}`),
      countRows('campaign_recipients', `business_id=eq.${id}&sent_at=gte.${since}`),
      countRows('campaign_recipients', `business_id=eq.${id}&status=eq.failed&claimed_at=gte.${since}`),
      countRows('campaign_recipients', `business_id=eq.${id}&status=eq.skipped&claimed_at=gte.${since}`),
      countRows('whatsapp_leads', `business_id=eq.${id}&opted_out=is.true`),
      countRows('whatsapp_leads', `business_id=eq.${id}&opted_out_at=gte.${since}`),
    ]);
    return {
      id, name: b.name, status: b.status,
      outbound, failedMessages,
      failureRate: outbound ? Math.round(((failedMessages || 0) / outbound) * 1000) / 10 : null,
      campaignSent, campaignFailed, campaignSkipped,
      optedOutTotal, optOutsInPeriod,
      metaSendErrors: metaBy.get(id) || 0,
    };
  }));
  return { days, businesses };
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------
/** @param {Query} [q] */
async function auditLog(q = {}) {
  const f = ['select=id,created_at,business_id,actor_email,actor_role,action,details', 'order=id.desc'];
  if (q.businessId) {
    if (q.businessId === 'none') f.push('business_id=is.null');
    else if (isBusinessId(q.businessId)) f.push(`business_id=eq.${q.businessId}`);
    else return { error: 'Invalid business.' };
  }
  if (q.actor) {
    const a = String(q.actor).replace(/[^\w@.+-]/g, '').slice(0, 80);
    if (a) f.push(`actor_email=ilike.*${enc(a)}*`);
  }
  if (q.role) {
    if (!['owner', 'manager', 'agent', 'platform_admin', 'billing', 'system'].includes(q.role)) return { error: 'Unknown role.' };
    f.push(`actor_role=eq.${q.role}`);
  }
  if (q.action) {
    const a = String(q.action).replace(/[^\w.]/g, '').slice(0, 60);
    if (a) f.push(`action=like.${enc(a)}*`);
  }
  if (q.from) { if (!DATE_RE.test(q.from)) return { error: 'From must be a date.' }; f.push(`created_at=gte.${q.from}T00:00:00Z`); }
  if (q.to) { if (!DATE_RE.test(q.to)) return { error: 'To must be a date.' }; f.push(`created_at=lte.${q.to}T23:59:59Z`); }
  if (q.beforeId) { const n = Number(q.beforeId); if (!Number.isInteger(n) || n < 1) return { error: 'Invalid page.' }; f.push(`id=lt.${n}`); }
  const limit = Math.min(Math.max(Number(q.limit) || 100, 1), 200);
  f.push(`limit=${limit}`);
  const r = await dbRequest(`audit_log?${f.join('&')}`);
  if (!r.ok) return { error: 'Could not load the audit log.', status: 500 };
  return { entries: r.data, nextBeforeId: r.data.length === limit ? r.data[r.data.length - 1].id : null };
}

// ---------------------------------------------------------------------------
// One business
// ---------------------------------------------------------------------------
/** @param {unknown} rawId */
async function businessDetail(rawId) {
  if (!isBusinessId(rawId)) return { error: 'Invalid business.' };
  const id = String(rawId);
  const b = await dbRequest(`businesses?id=eq.${id}&select=id,name,slug,status,industry,plan_id,limit_overrides,paid_until,send_window_start,send_window_end,created_at,created_by,updated_at`);
  const business = rows(b)[0];
  if (!business) return { error: 'Business not found.', status: 404 };
  const whatsapp = require('./whatsapp.cjs');
  const [usage, wa, h, recentEvents, recentAudit, staffByRole, delivery] = await Promise.all([
    limitsLib.usageReport(id),
    whatsapp.connectionStatus(id),
    health(),
    dbRequest(`system_events?select=id,created_at,level,source,code,message,count&business_id=eq.${id}&order=id.desc&limit=20`),
    dbRequest(`audit_log?select=id,created_at,actor_email,actor_role,action,details&business_id=eq.${id}&order=id.desc&limit=20`),
    Promise.all(['owner', 'manager', 'agent'].map(r => countRows('staff_members', `business_id=eq.${id}&role=eq.${r}`))),
    deliveryStats({ days: 7 }),
  ]);
  /** @type {Partial<Health['businesses'][number]>} */
  const hb = h.businesses.find(x => x.id === id) || {};
  /** @type {Row[]} */
  const deliveryRows = 'businesses' in delivery && delivery.businesses ? delivery.businesses : [];
  return {
    business,
    usage,
    // Only what the platform needs: never the token, app secret or verify token.
    whatsapp: {
      connected: wa.connected, source: wa.source, phoneNumber: wa.phoneNumber, phoneNumberId: wa.phoneNumberId, wabaId: wa.wabaId,
      tokenLast4: wa.tokenLast4, tokenReadable: !wa.tokenUnreadable && wa.connected, hasAppSecret: wa.hasAppSecret, connectedAt: wa.connectedAt,
      ...(hb.whatsapp ? { qualityRating: hb.whatsapp.qualityRating, messagingTier: hb.whatsapp.messagingTier, checkedAt: hb.whatsapp.checkedAt, checkError: hb.whatsapp.checkError, sendErrors24h: hb.whatsapp.sendErrors24h, tokenErrors24h: hb.whatsapp.tokenErrors24h } : {}),
    },
    webhook: hb.webhook || null,
    ads: hb.ads || { connected: false },
    ai: hb.ai || { configured: false },
    staff: { owner: staffByRole[0], manager: staffByRole[1], agent: staffByRole[2] },
    delivery: deliveryRows.find(x => x.id === id) || null,
    recentEvents: rows(recentEvents),
    recentAudit: rows(recentAudit),
    alerts: (await alerts(h)).filter(a => a.businessId === id),
  };
}

/** @type {Map<string, number>} */
const lastCheck = new Map(); // businessId -> ms
/**
 * Ask Meta for the number's quality rating and messaging tier (at most once a minute per business).
 * @param {unknown} admin  (who asked; not used yet) @param {unknown} rawId
 */
async function checkWhatsApp(admin, rawId) {
  if (!isBusinessId(rawId)) return { error: 'Invalid business.' };
  const id = String(rawId);
  const prev = lastCheck.get(id) || 0;
  if (Date.now() - prev < 60000) return { error: 'Checked less than a minute ago. Try again shortly.', status: 429 };
  lastCheck.set(id, Date.now());
  const r = await require('./whatsapp.cjs').testConnection(id);
  if (r.error) {
    const msg = events.scrub(r.error, 300);
    await events.upsertHealth(id, { wa_checked_at: new Date().toISOString(), wa_check_error: msg });
    await events.logEvent({ level: 'warn', source: 'meta', businessId: id, code: 'wa_check_failed', message: msg });
    return { ok: false, checkError: msg };
  }
  await events.upsertHealth(id, { wa_checked_at: new Date().toISOString(), wa_check_error: null, wa_quality_rating: r.qualityRating || null, wa_messaging_tier: r.messagingLimit || null });
  return { ok: true, qualityRating: r.qualityRating || null, messagingTier: r.messagingLimit || null };
}

/** Tests only. */
function _resetChecks() { lastCheck.clear(); }

module.exports = {
  WORKER_STALE_MIN,
  health, alerts, healthWithAlerts, listEvents, workerRuns, deliveryStats, auditLog, businessDetail, checkWhatsApp, tallyEvents, _resetChecks,
};
