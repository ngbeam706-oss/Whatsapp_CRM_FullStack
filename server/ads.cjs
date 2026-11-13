// @ts-check
// Ads module, phase B: a business's Meta ad account and its Click-to-WhatsApp ad results.
//
// The Business Admin connects ONE ad account (ID + an access token with ads_read). The token is
// checked with Meta, stored ENCRYPTED in business_ad_accounts (server-only table) and never sent
// back to the browser. The worker syncs ad results into ad_insights_daily about once an hour
// (Marketing API "Limited" tier has low rate limits; this also saves Netlify credits).
// The Ads page joins Meta's spend with the CRM's own chats and conversions per ad (phase A).
//
// Who: owner + manager read the Ads page; only the owner connects/disconnects. Agents and the
// Platform Admin never see it. Plan switch: plans.ads_enabled (limits.cjs).
const { config } = require('./config.cjs');
const { dbRequest } = require('./db.cjs');
const secrets = require('./secrets.cjs');
const { requireBusinessId } = require('./tenant.cjs');
const limits = require('./limits.cjs');
const { adsPerformance, istDay } = require('./analytics.cjs');

const SYNC_EVERY_MS = 55 * 60 * 1000;        // worker: at most once an hour per account
const MANUAL_SYNC_GAP_MS = 10 * 60 * 1000;   // "Sync now" button: at most every 10 minutes
const FIRST_SYNC_DAYS = 30;
const RESYNC_DAYS = 3;                        // Meta keeps adjusting the last few days
// The first sync is too slow for one request on a big account (Meta takes ~9s per page of per-ad daily
// results; 30 days can be 4+ pages), so the worker loads it in windows of a few days, newest first,
// over several runs. Each window is assumed to need about WINDOW_EST_MS.
const BACKFILL_WINDOW_DAYS = 3;
const WINDOW_EST_MS = 7000;
const GRAPH_TIMEOUT_MS = 20000;
const MAX_PAGES = 20;
const IST_OFFSET_MS = 330 * 60000;
const CONVERSATION_ACTION = 'onsite_conversion.messaging_conversation_started_7d';
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80000, 80004]);
const INSIGHT_FIELDS = 'ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,reach,clicks,actions,date_start';

/** @typedef {import('./types.cjs').Staff} Staff */
/** @typedef {Record<string, any>} Row  a database row, or an object from Meta */
/** @typedef {Record<string, any>} Input  request body fields (each function checks what it uses) */
/** @typedef {{ id: string, row: Row, token: string, version: string }} ControlCtx */
/**
 * @typedef {{ maxCostPerChat: number | null, maxCostPerConversion: number | null, windowDays: number, autoPause?: boolean }} AlertSettings
 * @typedef {{ level: string, id: string, name?: string, minor: number, factor: number }} BudgetTarget
 */

/** @param {unknown} err */
const errText = (err) => (err instanceof Error ? err.message : String(err));

/** @param {unknown} s */
const last4 = (s) => (s ? String(s).slice(-4) : null);

/** '1234567890' or 'act_1234567890' -> 'act_1234567890'; anything else -> null. @param {unknown} v */
function normalizeAdAccountId(v) {
  const s = String(v || '').trim().replace(/\s+/g, '');
  if (/^\d{5,25}$/.test(s)) return `act_${s}`;
  if (/^act_\d{5,25}$/.test(s)) return s;
  return null;
}

/**
 * One Graph API call. Never throws: errors come back as Meta's `{ error: { message, code } }`.
 * @param {string} version @param {string} token @param {string} pathOrUrl
 * @param {{ method?: string, form?: Record<string, string>, timeoutMs?: number }} [options]
 * @returns {Promise<any>}
 */
async function graph(version, token, pathOrUrl, { method = 'GET', form, timeoutMs = GRAPH_TIMEOUT_MS } = {}) {
  const url = /^https:\/\//.test(pathOrUrl) ? pathOrUrl : `https://graph.facebook.com/${version}/${pathOrUrl}`;
  if (!url.startsWith('https://graph.facebook.com/')) return { error: { message: 'Unexpected paging address from Meta.' } };
  try {
    /** @type {Record<string, string>} */
    const headers = { Authorization: `Bearer ${token}` };
    /** @type {string | undefined} */
    let body;
    if (form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(form).toString();
    }
    const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
    return await res.json();
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return { error: { message: timedOut ? 'Meta took too long to answer. Please try again.' : errText(err) } };
  }
}
/** @param {any} r @returns {string} */
const metaMsg = (r) => r?.error?.error_user_msg || r?.error?.message || 'Meta rejected the request.';
/** @param {any} r */
const isRateLimited = (r) => RATE_LIMIT_CODES.has(Number(r?.error?.code));

/** @param {unknown} businessId @returns {Promise<Row | null>} */
async function loadAccount(businessId) {
  const r = await dbRequest(`business_ad_accounts?business_id=eq.${requireBusinessId(businessId)}&select=*`);
  return r.ok ? r.data?.[0] || null : null;
}

/** @param {string} businessId */
async function adsEnabled(businessId) {
  return !!(await limits.getPlan(businessId)).limits.ads_enabled;
}

/** @param {Staff | null | undefined} staff @param {string} businessId @param {string} action @param {Record<string, unknown>} details */
async function audit(staff, businessId, action, details) {
  await dbRequest('audit_log', {
    method: 'POST', prefer: 'return=minimal',
    body: { business_id: businessId, actor_email: staff?.email || 'system', actor_role: staff?.role || 'system', action, details },
  });
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

/** What staff may see about the connection. Never includes the token. @param {string} businessId */
async function accountStatus(businessId) {
  const row = await loadAccount(businessId);
  if (!row) return { connected: false };
  return {
    connected: true,
    adAccountId: row.ad_account_id,
    name: row.name || '',
    currency: row.currency || '',
    timezone: row.timezone_name || '',
    tokenLast4: row.token_last4 || null,
    tokenUnreadable: !secrets.decrypt(row.access_token_enc),
    connectedBy: row.connected_by || null,
    connectedAt: row.connected_at || null,
    lastSyncAt: row.last_sync_at || null,
    lastSyncError: row.last_sync_error || null,
    // The first 30 days are still loading in the background (worker, every 5 minutes).
    firstSyncPending: !row.last_sync_at,
    alerts: alertSettings(row),
  };
}

/** @param {Row | null | undefined} row @returns {AlertSettings} */
function alertSettings(row) {
  /** @param {unknown} v */
  const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
  return {
    maxCostPerChat: num(row?.alert_max_cost_per_chat),
    maxCostPerConversion: num(row?.alert_max_cost_per_conversion),
    windowDays: Number(row?.alert_window_days) || 3,
    // Phase F: pause ACTIVE ads over these limits automatically after the hourly sync (off by default).
    autoPause: row?.auto_pause === true,
  };
}

/**
 * Business Admin connects (or updates) the ad account. Blank token = keep the saved one (same account only).
 * @param {Staff} staff @param {Input} [input]
 */
async function connect(staff, input = {}) {
  const id = requireBusinessId(staff?.businessId);
  if (!(await adsEnabled(id))) return { error: 'Your plan does not include the Ads module. Ask the platform to upgrade your plan.' };
  if (!secrets.canEncrypt()) return { error: 'The server has no encryption secret (APP_SECRET), so the token can\'t be stored safely.' };
  const adAccountId = normalizeAdAccountId(input.adAccountId);
  if (!adAccountId) return { error: 'Enter the ad account ID (digits, from Meta Ads Manager -> Account overview, or act_1234...).' };
  const typed = String(input.accessToken || '').trim();
  if (typed && (typed.length < 20 || typed.length > 1000 || /\s/.test(typed))) return { error: 'That access token doesn\'t look right.' };

  const existing = await loadAccount(id);
  const token = typed || (existing && existing.ad_account_id === adAccountId ? secrets.decrypt(existing.access_token_enc) : null);
  if (!token) return { error: 'Paste an access token with the ads_read permission (a System User token from your Meta app is best).' };
  const version = existing?.graph_api_version || config.graphApiVersion;

  // Two quick checks only: this runs inside a web request (Netlify stops it after ~10 seconds).
  const acct = await graph(version, token, `${adAccountId}?fields=name,currency,account_status,timezone_name`, { timeoutMs: 4000 });
  if (acct.error) return { error: `Meta didn't accept the token or ad account ID: ${metaMsg(acct)}` };
  // Insights need ads_read: check now rather than failing silently at the first sync.
  const probe = await graph(version, token, `${adAccountId}/insights?fields=spend&date_preset=last_7d&limit=1`, { timeoutMs: 4000 });
  if (probe.error) return { error: `The token can open the ad account but can't read ad results (it needs ads_read): ${metaMsg(probe)}` };

  const now = new Date().toISOString();
  /** @type {Record<string, unknown>} */
  const body = {
    business_id: id,
    ad_account_id: adAccountId,
    name: String(acct.name || '').slice(0, 120),
    currency: acct.currency || null,
    timezone_name: acct.timezone_name || null,
    graph_api_version: version,
    connected_by: staff.email,
    connected_at: now,
    updated_at: now,
    last_sync_error: null,
  };
  if (typed) { body.access_token_enc = secrets.encrypt(typed); body.token_last4 = last4(typed); }
  else body.access_token_enc = existing?.access_token_enc;
  // New account: the worker loads its first 30 days in the background (see syncAccount).
  const isNew = !existing || existing.ad_account_id !== adAccountId;
  if (isNew) body.last_sync_at = null;

  const res = await dbRequest('business_ad_accounts?on_conflict=business_id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body });
  if (!res.ok) {
    if (res.status === 409 || /ad_account_id/.test(JSON.stringify(res.data || ''))) return { error: 'This ad account is already connected to another business.' };
    return { error: 'Could not save. Has the Ads (phase B) SQL been run?' };
  }
  await audit(staff, id, 'ads.connected', { adAccountId, tokenChanged: !!typed });

  // No sync here: a big account's results take far longer than one web request may run.
  const account = await accountStatus(id);
  return {
    account,
    accountActive: Number(acct.account_status) === 1,
    syncNote: account.connected && account.firstSyncPending
      ? `Connected ${acct.name || 'the ad account'}. The last ${FIRST_SYNC_DAYS} days of results load in the background over the next 15–30 minutes.`
      : null,
  };
}

/** @param {Staff} staff */
async function disconnect(staff) {
  const id = requireBusinessId(staff?.businessId);
  const row = await loadAccount(id);
  if (!row) return { error: 'No ad account is connected.' };
  const res = await dbRequest(`business_ad_accounts?business_id=eq.${id}`, { method: 'DELETE', prefer: 'return=minimal' });
  if (!res.ok) return { error: 'Could not disconnect.' };
  await audit(staff, id, 'ads.disconnected', { adAccountId: row.ad_account_id });
  return { account: { connected: false } };
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

/**
 * Meta insights rows -> ad_insights_daily rows. Pure (tested).
 * @param {Row[] | null | undefined} data
 * @param {{ businessId: string, adAccountId: string, currency?: string | null, statuses?: Record<string, string>, now?: string }} options
 */
function parseInsights(data, { businessId, adAccountId, currency = null, statuses = {}, now = new Date().toISOString() }) {
  /** @param {unknown} v */
  const int = (v) => Math.max(0, Math.round(Number(v) || 0));
  return (data || [])
    .filter(r => r && r.ad_id && r.date_start)
    .map(r => ({
      business_id: businessId,
      ad_account_id: adAccountId,
      date: r.date_start,
      ad_id: String(r.ad_id),
      ad_name: r.ad_name || null,
      adset_id: r.adset_id || null,
      adset_name: r.adset_name || null,
      campaign_id: r.campaign_id || null,
      campaign_name: r.campaign_name || null,
      effective_status: statuses[r.ad_id] || null,
      spend: Math.max(0, Math.round((Number(r.spend) || 0) * 100) / 100),
      impressions: int(r.impressions),
      reach: int(r.reach),
      clicks: int(r.clicks),
      conversations: int((r.actions || []).filter((/** @type {Row} */ a) => a.action_type === CONVERSATION_ACTION).reduce((/** @type {number} */ n, /** @type {Row} */ a) => n + (Number(a.value) || 0), 0)),
      currency,
      updated_at: now,
    }));
}

/**
 * Follow Meta's paging (at most MAX_PAGES pages).
 * @param {string} version @param {string} token @param {string} firstPath
 * @returns {Promise<{ error: any, data?: undefined } | { error?: undefined, data: Row[] }>}
 */
async function allPages(version, token, firstPath) {
  /** @type {Row[]} */
  const out = [];
  /** @type {string | null} */
  let next = firstPath;
  for (let i = 0; next && i < MAX_PAGES; i++) {
    const r = await graph(version, token, next);
    if (r.error) return { error: r };
    out.push(...(r.data || []));
    next = r.paging?.next || null;
  }
  return { data: out };
}

/** @param {number} ms */
const istDate = (ms) => new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);

/** 'YYYY-MM-DD' plus n days. @param {string} day @param {number} n */
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/**
 * Pull ad results from Meta for one business, within a time budget.
 *  - Normal (hourly) sync: the last RESYNC_DAYS days in one go.
 *  - First sync (last_sync_at is null): the last FIRST_SYNC_DAYS days in windows of BACKFILL_WINDOW_DAYS,
 *    newest first, as many as fit before `deadline`. The next run carries on from the oldest day saved
 *    since the account was connected; last_sync_at is set only when all days are in.
 * @param {unknown} businessId
 * @param {{ deadline?: number }} [options]  Date.now() value by which to stop starting new Meta calls
 * @returns {Promise<{ error: string, ok?: undefined } | { error?: undefined, ok: true, rows: number, since: string, until: string, pending?: boolean }>}
 */
async function syncAccount(businessId, { deadline = Date.now() + 60000 } = {}) {
  const id = requireBusinessId(businessId);
  const row = await loadAccount(id);
  if (!row) return { error: 'No ad account is connected.' };
  const token = secrets.decrypt(row.access_token_enc);
  const firstSync = !row.last_sync_at;
  /** @param {string} msg @returns {Promise<{ error: string }>} */
  const markFailed = async (msg) => {
    // A failed first sync keeps last_sync_at empty so the history still loads later; updated_at
    // makes the worker wait an hour before trying again (syncDue).
    const now = new Date().toISOString();
    await dbRequest(`business_ad_accounts?business_id=eq.${id}`, {
      method: 'PATCH', prefer: 'return=minimal',
      body: firstSync ? { updated_at: now, last_sync_error: msg.slice(0, 500) } : { last_sync_at: now, last_sync_error: msg.slice(0, 500) },
    });
    await require('./events.cjs').logEvent({ level: 'warn', source: 'ads', businessId: id, code: 'sync_failed', message: msg });
    return { error: msg };
  };
  if (!token) return markFailed('The saved token can\'t be read (was the server secret changed?). Paste the token again.');
  const version = row.graph_api_version || config.graphApiVersion;
  const today = istDate(Date.now());
  const oldest = istDate(Date.now() - ((firstSync ? FIRST_SYNC_DAYS : RESYNC_DAYS) - 1) * 86400000);

  // Where to start: today, or (first sync, later runs) the day before the oldest day already saved.
  let end = today;
  if (firstSync && row.connected_at) {
    const done = await dbRequest(`ad_insights_daily?business_id=eq.${id}&ad_account_id=eq.${row.ad_account_id}&updated_at=gte.${encodeURIComponent(row.connected_at)}&select=date&order=date.asc&limit=1`);
    const oldestSaved = done.ok ? done.data?.[0]?.date : null;
    if (oldestSaved) end = addDays(oldestSaved, -1);
  }
  const windowDays = firstSync ? BACKFILL_WINDOW_DAYS : RESYNC_DAYS;

  /** @type {Row[]} */
  const fetched = [];
  let since = end;
  while (end >= oldest) {
    if (fetched.length && Date.now() + WINDOW_EST_MS > deadline) break; // always do at least one window
    const start = [addDays(end, -(windowDays - 1)), oldest].sort()[1]; // the later of the two
    const range = encodeURIComponent(JSON.stringify({ since: start, until: end }));
    const insights = await allPages(version, token, `${row.ad_account_id}/insights?level=ad&time_increment=1&fields=${INSIGHT_FIELDS}&time_range=${range}&limit=500`);
    if (insights.error !== undefined) {
      return markFailed(isRateLimited(insights.error)
        ? 'Meta\'s rate limit was reached; the next sync will try again in about an hour.'
        : `Meta says: ${metaMsg(insights.error)}`);
    }
    fetched.push(...(insights.data || []));
    since = start;
    end = addDays(start, -1);
    if (Date.now() > deadline) break;
  }
  const finished = end < oldest;

  // Current delivery status per ad (best effort, and only with time to spare): without it the
  // saved status is left as it was.
  /** @type {Record<string, string> | null} */
  let statuses = null;
  if (Date.now() + 3000 < deadline) {
    // Phase F: with Meta's review feedback, so rejected ads (and why) can be shown; and the WhatsApp number each ad
    // opens (its ad set's promoted object). If Meta refuses a field, fall back to what worked before.
    let ads = await allPages(version, token, `${row.ad_account_id}/ads?fields=id,name,effective_status,ad_review_feedback,issues_info,adset{promoted_object}&limit=500`);
    if (ads.error) ads = await allPages(version, token, `${row.ad_account_id}/ads?fields=id,name,effective_status,ad_review_feedback,issues_info&limit=500`);
    if (ads.error) ads = await allPages(version, token, `${row.ad_account_id}/ads?fields=id,effective_status&limit=500`);
    if (!ads.error) {
      statuses = Object.fromEntries((ads.data || []).map(a => [String(a.id), a.effective_status]));
      try { await require('./adWatch.cjs').recordIssues(id, ads.data || []); } catch (err) { console.warn('[ads] review issues not saved:', errText(err)); }
      try { await saveAdNumbers(id, row, version, token, ads.data || []); } catch (err) { console.warn('[ads] ad numbers not saved:', errText(err)); }
    }
  }

  // Billing card (prepaid / automatic, amount due, payment problems): one small read, best effort.
  if (Date.now() + 2000 < deadline) {
    try { await require('./adBilling.cjs').refresh(id, row, version, token); } catch (err) { console.warn('[ads] billing not read:', errText(err)); }
  }

  /** @type {Row[]} */
  const rows = parseInsights(fetched, { businessId: id, adAccountId: row.ad_account_id, currency: row.currency, statuses: statuses || {} });
  if (!statuses) for (const r of rows) delete r.effective_status;
  for (let i = 0; i < rows.length; i += 500) {
    const res = await dbRequest('ad_insights_daily?on_conflict=business_id,ad_id,date', {
      method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: rows.slice(i, i + 500),
    });
    if (!res.ok) return markFailed('Could not save ad results. Has the Ads (phase B) SQL been run?');
  }
  const now = new Date().toISOString();
  await dbRequest(`business_ad_accounts?business_id=eq.${id}`, {
    method: 'PATCH', prefer: 'return=minimal',
    body: finished ? { last_sync_at: now, last_sync_error: null } : { updated_at: now, last_sync_error: null },
  });
  return finished ? { ok: true, rows: rows.length, since, until: today } : { ok: true, rows: rows.length, since, until: today, pending: true };
}

// ---------------------------------------------------------------------------
// The WhatsApp number each ad opens. Click-to-WhatsApp ad sets name it in promoted_object.whatsapp_phone_number;
// older ones only name the Page (the ad then opens the Page's WhatsApp number, read once per Page per sync).
// Saved as business_ad_accounts.ad_numbers = { adId: { n: digits | null, p: pageId | null } }.
// ---------------------------------------------------------------------------
const MAX_AD_NUMBERS = 3000;
/** @param {unknown} v */
const onlyDigits = (v) => String(v || '').replace(/\D/g, '');

/**
 * Pure: the ad -> number map from Meta's ads (tested). Ads without a promoted object are left out.
 * @param {Row[]} ads @param {Record<string, string>} [pageNumbers]  pageId -> digits
 * @returns {Record<string, { n: string | null, p: string | null }>}
 */
function adNumbersOf(ads, pageNumbers = {}) {
  /** @type {Record<string, { n: string | null, p: string | null }>} */
  const out = {};
  for (const a of ads || []) {
    const po = a?.adset?.promoted_object;
    if (!po || !/^\d{1,25}$/.test(String(a.id || ''))) continue;
    const own = onlyDigits(po.whatsapp_phone_number);
    const page = /^\d{1,25}$/.test(String(po.page_id || '')) ? String(po.page_id) : null;
    const n = own.length >= 8 && own.length <= 15 ? own : page && pageNumbers[page] ? pageNumbers[page] : null;
    if (n || page) out[String(a.id)] = { n, p: own.length >= 8 ? null : page };
  }
  return out;
}

/** @param {string} businessId @param {Row} row @param {string} version @param {string} token @param {Row[]} ads */
async function saveAdNumbers(businessId, row, version, token, ads) {
  // Pages named without a number: their linked WhatsApp number (at most 5 Pages per sync).
  const pages = [...new Set(ads.map(a => a?.adset?.promoted_object).filter(po => po && !onlyDigits(po.whatsapp_phone_number) && /^\d{1,25}$/.test(String(po.page_id || ''))).map(po => String(po.page_id)))].slice(0, 5);
  /** @type {Record<string, string>} */
  const pageNumbers = {};
  for (const p of pages) {
    const r = await graph(version, token, `${p}?fields=whatsapp_number`);
    const n = r.error ? '' : onlyDigits(r.whatsapp_number);
    if (n.length >= 8) pageNumbers[p] = n;
  }
  const fresh = adNumbersOf(ads, pageNumbers);
  if (!Object.keys(fresh).length) return;
  const merged = { ...(row.ad_numbers && typeof row.ad_numbers === 'object' ? row.ad_numbers : {}), ...fresh };
  const keys = Object.keys(merged);
  if (keys.length > MAX_AD_NUMBERS) for (const k of keys.slice(0, keys.length - MAX_AD_NUMBERS)) delete merged[k];
  await dbRequest(`business_ad_accounts?business_id=eq.${businessId}`, { method: 'PATCH', prefer: 'return=minimal', body: { ad_numbers: merged } });
}

/**
 * For the Ads page: each ad's number, with the business's own label, or a warning when it isn't one of this
 * business's numbers in the CRM (its chats then never reach this inbox).
 * @param {string} businessId @param {Row} row @param {string[]} adIds
 */
async function adNumbersView(businessId, row, adIds) {
  const map = row.ad_numbers && typeof row.ad_numbers === 'object' ? row.ad_numbers : {};
  if (!adIds.some(a => map[a])) return {};
  const numbers = await require('./whatsapp.cjs').listNumbers(businessId).catch(() => []);
  const ours = numbers.map(n => ({ phone: onlyDigits(n.phoneNumber), label: n.label || (n.main ? 'Main number' : '') })).filter(n => n.phone);
  /** @type {Record<string, { phone: string | null, viaPage: boolean, label: string | null, inCrm: boolean }>} */
  const out = {};
  for (const a of adIds) {
    const m = map[a];
    if (!m) continue;
    const phone = m.n ? String(m.n) : null;
    const hit = phone ? ours.find(o => o.phone.slice(-10) === phone.slice(-10)) : null;
    out[a] = { phone, viaPage: !!m.p, label: hit ? hit.label || 'Business number' : null, inCrm: !!hit };
  }
  return out;
}

/** "Sync now" from the Ads page (owner or manager), at most every 10 minutes. @param {unknown} businessId */
async function manualSync(businessId) {
  const id = requireBusinessId(businessId);
  if (!(await adsEnabled(id))) return { error: 'Your plan does not include the Ads module.' };
  const row = await loadAccount(id);
  if (!row) return { error: 'No ad account is connected.' };
  if (!row.last_sync_at) return { error: `The first ${FIRST_SYNC_DAYS} days of results are still loading in the background. They appear here within about 30 minutes of connecting.` };
  const ago = Date.now() - Date.parse(row.last_sync_at);
  if (ago < MANUAL_SYNC_GAP_MS) return { error: `Synced ${Math.max(1, Math.round(ago / 60000))} min ago. Try again in a few minutes (Meta limits how often ad results can be read).` };
  // Queued, not run here: on a big account even 3 days of results take ~8s at Meta, and Netlify stops a
  // web request after ~10s. Marking the account as due makes the next worker run (within 5 minutes)
  // sync it. Pressing again before then only re-marks it (no extra Meta calls).
  const queuedAt = new Date(Date.now() - SYNC_EVERY_MS - 1000).toISOString();
  const res = await dbRequest(`business_ad_accounts?business_id=eq.${id}`, { method: 'PATCH', prefer: 'return=minimal', body: { last_sync_at: queuedAt } });
  if (!res.ok) return { error: 'Could not queue the sync. Please try again.' };
  return { queued: true, message: 'Sync started. New ad results appear here within about 5 minutes.' };
}

/**
 * Worker (every 5 minutes): accounts still loading their first results, then accounts not synced in
 * the last hour (active businesses whose plan includes Ads). A first sync that failed waits an hour.
 * @param {{ deadlineMs?: number }} [options]
 */
async function syncDue({ deadlineMs = 8000 } = {}) {
  const stop = Date.now() + deadlineMs;
  const cutoffIso = new Date(Date.now() - SYNC_EVERY_MS).toISOString();
  const cutoff = encodeURIComponent(cutoffIso);
  const r = await dbRequest(`business_ad_accounts?or=(last_sync_at.is.null,last_sync_at.lt.${cutoff})&select=business_id,last_sync_at,last_sync_error,updated_at&order=last_sync_at.asc.nullsfirst&limit=20`);
  if (!r.ok || !r.data?.length) return { synced: 0 };
  const due = r.data.filter((/** @type {Row} */ a) => a.last_sync_at || !a.last_sync_error || !a.updated_at || a.updated_at < cutoffIso);
  let synced = 0, failed = 0, pending = 0;
  for (const { business_id } of due) {
    if (Date.now() + 3000 > stop) break;
    const biz = await dbRequest(`businesses?id=eq.${business_id}&select=status`);
    if (!(biz.ok && biz.data?.[0]?.status === 'active')) continue;
    if (!(await adsEnabled(business_id))) continue;
    /** @type {{ error?: string, pending?: boolean }} */
    const out = await syncAccount(business_id, { deadline: stop }).catch(err => ({ error: errText(err) }));
    if (out.error) failed++; else if (out.pending) pending++; else synced++;
    // Phase F: with fresh results, pause ads over the cost limits (only if the business switched it on).
    if (!out.error && !out.pending && Date.now() + 2000 < stop) {
      await require('./adWatch.cjs').autoPause(business_id).catch(err => console.warn('[ads] auto-pause failed:', errText(err)));
    }
  }
  return pending ? { synced, failed, pending } : { synced, failed };
}

// ---------------------------------------------------------------------------
// Controls (phase C): pause / resume an ad, change an ad set's (or campaign's) daily budget.
// Owner + manager. Every change is checked against the business's own ad account at Meta and
// written to audit_log with before/after. Needs a token with ads_management.
// ---------------------------------------------------------------------------

// Path safety only (digits); ownership is checked with Meta's account_id in ownedObject().
const OBJECT_ID_RE = /^\d{1,25}$/;
// Meta budgets are in the currency's smallest unit (paise for INR); these currencies have none.
const NO_MINOR_UNIT = new Set(['JPY', 'KRW', 'CLP', 'COP', 'CRC', 'HUF', 'ISK', 'IDR', 'PYG', 'TWD', 'VND']);
/** @param {unknown} currency */
const minorFactor = (currency) => (NO_MINOR_UNIT.has(String(currency || '').toUpperCase()) ? 1 : 100);
const MAX_BUDGET_INCREASE = 5; // a single change may at most 5x the budget (typo guard: 500 vs 5000)

const NEEDS_MANAGEMENT = 'The saved token can read ad results but cannot change ads. Generate a token with the ads_management permission and paste it under "Change token".';
/** @param {any} r */
const actionError = (r) => ([10, 200, 294].includes(Number(r?.error?.code)) || /permission/i.test(r?.error?.message || '')
  ? NEEDS_MANAGEMENT
  : `Meta says: ${metaMsg(r)}`);

/**
 * The business's connection with a readable token, or { error }.
 * @param {unknown} businessId
 * @returns {Promise<({ error: string } & { [K in keyof ControlCtx]?: undefined }) | (ControlCtx & { error?: undefined })>}
 */
async function controlContext(businessId) {
  const id = requireBusinessId(businessId);
  if (!(await adsEnabled(id))) return { error: 'Your plan does not include the Ads module.' };
  const row = await loadAccount(id);
  if (!row) return { error: 'No ad account is connected.' };
  const token = secrets.decrypt(row.access_token_enc);
  if (!token) return { error: 'The saved token can\'t be read. Paste it again under "Change token".' };
  return { id, row, token, version: row.graph_api_version || config.graphApiVersion };
}

/**
 * Read a Meta object and make sure it belongs to this business's ad account.
 * @param {ControlCtx} ctx @param {unknown} objectId @param {string} fields
 * @returns {Promise<{ error: string, obj?: undefined } | { error?: undefined, obj: Row }>}
 */
async function ownedObject(ctx, objectId, fields) {
  if (!OBJECT_ID_RE.test(String(objectId || ''))) return { error: 'Unknown ad.' };
  const obj = await graph(ctx.version, ctx.token, `${objectId}?fields=account_id,${fields}`);
  if (obj.error) return { error: Number(obj.error.code) === 100 ? 'Meta could not find that ad (it may have been deleted).' : actionError(obj) };
  if (`act_${obj.account_id}` !== ctx.row.ad_account_id) return { error: 'That ad is not in your connected ad account.' };
  return { obj };
}

// ---------------------------------------------------------------------------
// Previews: a thumbnail next to each ad's name, and Meta's own preview on demand. Meta's image and
// preview links expire, so they are fetched when the page asks (kept in memory for PREVIEW_CACHE_MS),
// never stored. Only ads synced for this business, and only in its connected ad account.
// ---------------------------------------------------------------------------

const PREVIEW_CACHE_MS = 50 * 60 * 1000;
const MAX_THUMBNAILS = 10;
const PREVIEW_FORMATS = ['MOBILE_FEED_STANDARD', 'INSTAGRAM_STANDARD', 'INSTAGRAM_STORY', 'DESKTOP_FEED_STANDARD'];
/** @type {Map<string, { data: Row, expires: number }>} */
const previewCache = new Map();
/** @param {string} k */
const cached = (k) => { const h = previewCache.get(k); return h && h.expires > Date.now() ? h.data : null; };
/** @param {string} k @param {Row} data */
const remember = (k, data) => { if (previewCache.size > 5000) previewCache.clear(); previewCache.set(k, { data, expires: Date.now() + PREVIEW_CACHE_MS }); };

/** The creative's words and picture, wherever Meta keeps them for this kind of ad. @param {Row} c */
function creativeParts(c = {}) {
  const spec = c.object_story_spec || {};
  const link = spec.link_data || {};
  const video = spec.video_data || {};
  const feed = c.asset_feed_spec || {};
  return {
    image: c.image_url || link.picture || video.image_url || c.thumbnail_url || null,
    thumbnail: c.thumbnail_url || c.image_url || link.picture || video.image_url || null,
    text: c.body || link.message || video.message || feed.bodies?.[0]?.text || '',
    headline: c.title || link.name || video.title || feed.titles?.[0]?.text || '',
    cta: String(c.call_to_action_type || link.call_to_action?.type || video.call_to_action?.type || '').replace(/_/g, ' ').toLowerCase(),
  };
}

/** Of these ad ids, the ones synced for this business. @param {string} biz @param {string[]} ids */
async function ownSyncedAds(biz, ids) {
  if (!ids.length) return new Set();
  const r = await dbRequest(`ad_insights_daily?business_id=eq.${biz}&ad_id=in.(${ids.join(',')})&select=ad_id`);
  return new Set(r.ok ? (r.data || []).map((/** @type {Row} */ x) => String(x.ad_id)) : []);
}

/**
 * Thumbnails for up to 10 ads (the page on screen), in one Meta request.
 * @param {string} businessId @param {unknown} rawIds  comma-separated ad ids
 */
async function adThumbnails(businessId, rawIds) {
  const ctx = await controlContext(businessId);
  if (ctx.error !== undefined) return { error: ctx.error };
  const ids = [...new Set(String(rawIds || '').split(',').map(s => s.trim()).filter(s => OBJECT_ID_RE.test(s)))].slice(0, MAX_THUMBNAILS);
  const own = await ownSyncedAds(ctx.id, ids);
  /** @type {Record<string, Row>} */
  const out = {};
  const missing = [];
  for (const id of ids) {
    if (!own.has(id)) continue;
    const hit = cached(`${ctx.id}:t:${id}`);
    if (hit) out[id] = hit; else missing.push(id);
  }
  if (missing.length) {
    // One request on the account's own ads list (Meta dropped "?ids=" in v26), filtered to these ads:
    // anything returned is in this business's ad account by definition.
    const filtering = encodeURIComponent(JSON.stringify([{ field: 'id', operator: 'IN', value: missing }]));
    const r = await graph(ctx.version, ctx.token, `${ctx.row.ad_account_id}/ads?fields=id,creative{thumbnail_url,image_url,title,body,object_story_spec}&thumbnail_width=160&thumbnail_height=160&filtering=${filtering}&limit=${MAX_THUMBNAILS}`);
    if (!r.error) {
      for (const ad of Array.isArray(r.data) ? r.data : []) {
        const id = String(ad.id);
        if (!missing.includes(id)) continue;
        const p = creativeParts(ad.creative);
        out[id] = { thumbnailUrl: p.thumbnail, headline: p.headline };
        remember(`${ctx.id}:t:${id}`, out[id]);
      }
    }
  }
  return { thumbnails: out };
}

/**
 * One ad's full preview: its picture, text, headline and button, plus Meta's own rendered preview
 * (a business.facebook.com / www.facebook.com frame, valid about a day) in the chosen placement.
 * @param {string} businessId @param {unknown} adId @param {unknown} format
 */
async function adPreview(businessId, adId, format) {
  const ctx = await controlContext(businessId);
  if (ctx.error !== undefined) return { error: ctx.error };
  const fmt = PREVIEW_FORMATS.includes(String(format)) ? String(format) : PREVIEW_FORMATS[0];
  const key = `${ctx.id}:p:${adId}:${fmt}`;
  const hit = cached(key);
  if (hit) return hit;
  const own = await ownSyncedAds(ctx.id, [String(adId)].filter(s => OBJECT_ID_RE.test(s)));
  if (!own.size) return { error: 'That ad is not in your ad results.', status: 404 };
  const owned = await ownedObject(ctx, adId, 'name,effective_status,creative{thumbnail_url,image_url,title,body,call_to_action_type,object_story_spec,asset_feed_spec}');
  if (owned.error !== undefined) return owned;
  const prev = await graph(ctx.version, ctx.token, `${adId}/previews?ad_format=${fmt}`);
  const html = String(prev?.data?.[0]?.body || '');
  const src = (html.match(/src="([^"]+)"/) || [])[1]?.replace(/&amp;/g, '&') || null;
  const frameUrl = src && /^https:\/\/(www|business)\.facebook\.com\//.test(src) ? src : null; // only Meta's own preview page
  const result = { adId: String(adId), name: owned.obj.name || '', status: owned.obj.effective_status || null, format: fmt, formats: PREVIEW_FORMATS, frameUrl, ...creativeParts(owned.obj.creative) };
  remember(key, result);
  return result;
}

/** Pause or resume one ad. @param {Staff} staff @param {unknown} adId @param {unknown} status */
async function setAdStatus(staff, adId, status) {
  const want = String(status || '').toUpperCase();
  if (!['PAUSED', 'ACTIVE'].includes(want)) return { error: 'Status must be PAUSED or ACTIVE.' };
  const ctx = await controlContext(staff?.businessId);
  if (ctx.error !== undefined) return { error: ctx.error };
  const owned = await ownedObject(ctx, adId, 'name,status,effective_status');
  if (owned.error !== undefined) return owned;
  const before = owned.obj.status;
  if (before === want) return { ok: true, adId: String(adId), status: want, unchanged: true };
  if (!['ACTIVE', 'PAUSED'].includes(before)) return { error: `This ad is ${String(before || 'not editable').toLowerCase()}; change it in Meta Ads Manager.` };

  const r = await graph(ctx.version, ctx.token, String(adId), { method: 'POST', form: { status: want } });
  if (r.error || r.success === false) return { error: actionError(r) };
  // Show the change at once; the next sync brings Meta's full effective status.
  await dbRequest(`ad_insights_daily?business_id=eq.${ctx.id}&ad_id=eq.${adId}`, { method: 'PATCH', prefer: 'return=minimal', body: { effective_status: want } });
  await audit(staff, ctx.id, want === 'PAUSED' ? 'ads.ad_paused' : 'ads.ad_resumed', { adId: String(adId), adName: owned.obj.name || null, before, after: want });
  return { ok: true, adId: String(adId), status: want };
}

/**
 * Where an ad set's daily budget lives: the ad set itself, or its campaign (campaign budget).
 * @param {ControlCtx} ctx @param {unknown} adsetId
 * @returns {Promise<({ error: string } & { [K in keyof BudgetTarget]?: undefined }) | (BudgetTarget & { error?: undefined })>}
 */
async function budgetTarget(ctx, adsetId) {
  const owned = await ownedObject(ctx, adsetId, 'name,daily_budget,lifetime_budget,campaign_id');
  if (owned.error !== undefined) return { error: owned.error };
  const a = owned.obj;
  const factor = minorFactor(ctx.row.currency);
  if (Number(a.daily_budget) > 0) return { level: 'adset', id: String(adsetId), name: a.name, minor: Number(a.daily_budget), factor };
  if (Number(a.lifetime_budget) > 0) return { error: 'This ad has one budget for its whole run (for example an ad that runs only in business hours). Ads made in the CRM: change it with "Edit" under Create WhatsApp ads. Others: in Meta Ads Manager.' };
  if (!OBJECT_ID_RE.test(String(a.campaign_id || ''))) return { error: 'Meta did not say where this ad set\'s budget is set.' };
  const camp = await ownedObject(ctx, a.campaign_id, 'name,daily_budget,lifetime_budget');
  if (camp.error !== undefined) return { error: camp.error };
  if (Number(camp.obj.daily_budget) > 0) return { level: 'campaign', id: String(a.campaign_id), name: camp.obj.name, minor: Number(camp.obj.daily_budget), factor };
  return { error: 'This campaign has a lifetime budget. Change it in Meta Ads Manager.' };
}

/** @param {BudgetTarget} t */
const majorOf = (t) => Math.round((t.minor / t.factor) * 100) / 100;

/** @param {unknown} businessId @param {unknown} adsetId */
async function getBudget(businessId, adsetId) {
  const ctx = await controlContext(businessId);
  if (ctx.error !== undefined) return { error: ctx.error };
  const t = await budgetTarget(ctx, adsetId);
  if (t.error !== undefined) return { error: t.error };
  return { level: t.level, id: t.id, name: t.name || '', dailyBudget: majorOf(t), currency: ctx.row.currency || 'INR', maxAllowed: majorOf(t) * MAX_BUDGET_INCREASE };
}

/** Change the daily budget behind an ad set (major units, e.g. rupees). @param {Staff} staff @param {unknown} adsetId @param {unknown} dailyBudget */
async function setBudget(staff, adsetId, dailyBudget) {
  const value = Number(dailyBudget);
  if (!Number.isFinite(value) || value <= 0) return { error: 'Enter a daily budget above zero.' };
  const ctx = await controlContext(staff?.businessId);
  if (ctx.error !== undefined) return { error: ctx.error };
  const t = await budgetTarget(ctx, adsetId);
  if (t.error !== undefined) return { error: t.error };
  const before = majorOf(t);
  const minor = Math.round(value * t.factor);
  if (minor > t.minor * MAX_BUDGET_INCREASE) {
    return { error: `That is more than ${MAX_BUDGET_INCREASE}x the current budget (${before}). Raise it in steps, or change it in Meta Ads Manager.` };
  }
  if (minor === t.minor) return { ok: true, level: t.level, id: t.id, dailyBudget: before, unchanged: true };
  const r = await graph(ctx.version, ctx.token, t.id, { method: 'POST', form: { daily_budget: String(minor) } });
  if (r.error || r.success === false) return { error: actionError(r) };
  await audit(staff, ctx.id, 'ads.budget_changed', { level: t.level, id: t.id, name: t.name || null, adsetId: String(adsetId), currency: ctx.row.currency, before, after: minor / t.factor });
  return { ok: true, level: t.level, id: t.id, dailyBudget: minor / t.factor };
}

/** Alert thresholds (owner + manager). Empty = off. @param {Staff} staff @param {Input} [input] */
async function saveAlerts(staff, input = {}) {
  const ctx = await controlContext(staff?.businessId);
  if (ctx.error !== undefined) return { error: ctx.error };
  /** @param {unknown} v @param {string} label @returns {{ error: string, v?: undefined } | { error?: undefined, v: number | null }} */
  const money = (v, label) => {
    if (v === null || v === undefined || v === '') return { v: null };
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0 || n > 10000000) return { error: `${label} must be an amount above zero (or empty for no alert).` };
    return { v: Math.round(n * 100) / 100 };
  };
  const chat = money(input.maxCostPerChat, 'Cost per chat');
  if (chat.error !== undefined) return { error: chat.error };
  const conv = money(input.maxCostPerConversion, 'Cost per conversion');
  if (conv.error !== undefined) return { error: conv.error };
  const days = Number(input.windowDays ?? 3);
  if (!Number.isInteger(days) || days < 1 || days > 14) return { error: 'Check the last 1 to 14 days.' };
  /** @type {Record<string, unknown>} */
  const body = { alert_max_cost_per_chat: chat.v, alert_max_cost_per_conversion: conv.v, alert_window_days: days, updated_at: new Date().toISOString() };
  // Phase F: only sent when the page asks for it (before SQL 20261126 the column doesn't exist).
  if (input.autoPause !== undefined) body.auto_pause = input.autoPause === true;
  if (body.auto_pause && !chat.v && !conv.v) return { error: 'Set a cost per chat or cost per conversion limit first: auto-pause uses those limits.' };
  const res = await dbRequest(`business_ad_accounts?business_id=eq.${ctx.id}`, { method: 'PATCH', prefer: 'return=minimal', body });
  if (!res.ok) return { error: body.auto_pause !== undefined ? 'Could not save. Has the Ads (phase F) SQL (20261126) been run?' : 'Could not save. Has the Ads (phase C) SQL been run?' };
  await audit(staff, ctx.id, 'ads.alerts_changed', { maxCostPerChat: chat.v, maxCostPerConversion: conv.v, windowDays: days, ...(body.auto_pause !== undefined ? { autoPause: body.auto_pause } : {}) });
  return { alerts: alertSettings(body) };
}

/**
 * Ads that cost too much over the alert window. Pure (tested).
 * Only running ads with spend; an ad with spend but no chats/conversions yet counts its whole spend.
 * @param {Row[]} adRows @param {AlertSettings} settings
 */
function evaluateAlerts(adRows, settings) {
  /** @type {Array<{ adId: string, adName: string, kind: string, spend: number, count: number, cost: number, max: number }>} */
  const out = [];
  for (const a of adRows) {
    if (!(a.spend > 0)) continue;
    if (a.status && a.status !== 'ACTIVE') continue;
    /** @param {number | null} max @param {number} count @param {string} kind */
    const check = (max, count, kind) => {
      if (!max) return;
      const cost = count ? a.spend / count : a.spend;
      if (cost > max) out.push({ adId: a.adId, adName: a.adName, kind, spend: a.spend, count, cost: Math.round(cost * 100) / 100, max });
    };
    check(settings.maxCostPerChat, a.chats, 'chat');
    check(settings.maxCostPerConversion, a.converted, 'conversion');
  }
  return out.sort((x, y) => y.spend - x.spend);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/** @param {number} a @param {number} b */
const ratio = (a, b) => (b ? Math.round((a / b) * 100) / 100 : null);

/**
 * Meta's numbers per ad joined with the CRM's chats and conversions per ad. Pure (tested).
 * insights: ad_insights_daily rows in the period; leads: contacts with ad columns; from: ISO start.
 * @param {{ insights: Row[], leads: Row[], from: string }} data
 */
function summariseAds({ insights, leads, from }) {
  const crm = new Map(adsPerformance(leads, from, Infinity).map(r => [r.adId, r]));
  /** @type {Record<string, Row>} */
  const ads = {};
  for (const r of insights) {
    const a = (ads[r.ad_id] ||= {
      adId: r.ad_id, adName: r.ad_name, campaignId: r.campaign_id, campaignName: r.campaign_name, adsetId: r.adset_id || null, adsetName: r.adset_name,
      status: r.effective_status, firstDate: r.date, lastDate: '', spend: 0, impressions: 0, reach: 0, clicks: 0, metaConversations: 0,
    });
    if (r.date < a.firstDate) a.firstDate = r.date;
    if (r.date >= a.lastDate) {
      a.lastDate = r.date;
      a.adName = r.ad_name || a.adName;
      a.campaignName = r.campaign_name || a.campaignName;
      a.status = r.effective_status || a.status;
      a.adsetId = r.adset_id || a.adsetId;
      a.adsetName = r.adset_name || a.adsetName;
    }
    a.spend += Number(r.spend) || 0;
    a.impressions += Number(r.impressions) || 0;
    a.reach += Number(r.reach) || 0; // summed daily reach: an upper bound, shown as such
    a.clicks += Number(r.clicks) || 0;
    a.metaConversations += Number(r.conversations) || 0;
  }
  /** @type {Row[]} */
  // Latest first: the ads that ran most recently (then started most recently, then spent most).
  /** @param {Row} x @param {Row} y */
  const latestFirst = (x, y) => String(y.lastDate).localeCompare(String(x.lastDate)) || String(y.firstDate).localeCompare(String(x.firstDate)) || y.spend - x.spend;
  /** @type {Row[]} */
  const rows = Object.values(ads).map((a) => {
    const c = crm.get(a.adId) || { newLeads: 0, returning: 0, converted: 0 };
    const chats = c.newLeads + c.returning;
    const spend = Math.round(a.spend * 100) / 100;
    return {
      ...a, spend,
      newContacts: c.newLeads, returning: c.returning, chats, converted: c.converted,
      ctr: a.impressions ? a.clicks / a.impressions : null, costPerClick: ratio(spend, a.clicks),
      costPerChat: ratio(spend, chats), costPerConverted: ratio(spend, c.converted), costPerMetaConversation: ratio(spend, a.metaConversations),
    };
  }).sort(latestFirst);

  /** @type {Record<string, Row>} */
  const campaigns = {};
  for (const a of rows) {
    const k = a.campaignId || 'none';
    const c = (campaigns[k] ||= {
      campaignId: a.campaignId, campaignName: a.campaignName || 'Unnamed campaign', ads: 0, activeAds: 0, adsets: new Set(),
      firstDate: a.firstDate, lastDate: a.lastDate, spend: 0, impressions: 0, clicks: 0, metaConversations: 0, chats: 0, converted: 0,
    });
    c.ads += 1; c.spend += a.spend; c.impressions += a.impressions; c.clicks += a.clicks;
    c.metaConversations += a.metaConversations; c.chats += a.chats; c.converted += a.converted;
    if (a.status === 'ACTIVE') c.activeAds += 1;
    if (a.adsetId) c.adsets.add(a.adsetId);
    if (a.firstDate < c.firstDate) c.firstDate = a.firstDate;
    if (a.lastDate > c.lastDate) c.lastDate = a.lastDate;
  }
  const campaignRows = Object.values(campaigns).map(({ adsets, ...c }) => ({
    ...c, adsets: adsets.size, spend: Math.round(c.spend * 100) / 100,
    ctr: c.impressions ? c.clicks / c.impressions : null,
    costPerChat: ratio(c.spend, c.chats), costPerConverted: ratio(c.spend, c.converted),
  })).sort(latestFirst);

  const t = rows.reduce((s, a) => ({
    spend: s.spend + a.spend, impressions: s.impressions + a.impressions, clicks: s.clicks + a.clicks,
    metaConversations: s.metaConversations + a.metaConversations, chats: s.chats + a.chats, converted: s.converted + a.converted,
  }), { spend: 0, impressions: 0, clicks: 0, metaConversations: 0, chats: 0, converted: 0 });
  t.spend = Math.round(t.spend * 100) / 100;
  // Chats that came from ads this account doesn't show (another account, or deleted ads).
  const known = new Set(rows.map(a => a.adId));
  const otherAdChats = [...crm.values()].filter(c => !known.has(c.adId)).reduce((n, c) => n + c.newLeads + c.returning, 0);

  return {
    totals: { ...t, costPerChat: ratio(t.spend, t.chats), costPerConverted: ratio(t.spend, t.converted), ctr: t.impressions ? t.clicks / t.impressions : null, otherAdChats },
    campaigns: campaignRows,
    ads: rows,
  };
}

/** @param {string} path @returns {Promise<Row[]>} */
async function readAll(path) {
  /** @type {Row[]} */
  const out = [];
  for (let offset = 0; offset < 20000; offset += 1000) {
    const r = await dbRequest(`${path}&limit=1000&offset=${offset}`);
    if (!r.ok) throw new Error('Could not read ad results. Has the Ads (phase B) SQL been run?');
    out.push(...r.data);
    if (r.data.length < 1000) break;
  }
  return out;
}

/** Ads page data for the last `days` days (owner/manager; plan-gated by the caller). @param {unknown} businessId @param {{ days?: number }} [options] */
async function report(businessId, { days = 30 } = {}) {
  const id = requireBusinessId(businessId);
  const row = await loadAccount(id);
  if (!row) return { report: null };
  const span = await limits.clampAnalyticsDays(id, days);
  /** @param {number} n */
  const dayStart = (n) => {
    const day = istDay(new Date(Date.now() - (n - 1) * 86400000).toISOString());
    return { day, from: new Date(Date.parse(`${day}T00:00:00Z`) - IST_OFFSET_MS).toISOString() };
  };
  const { day: startDay, from } = dayStart(span);
  const settings = alertSettings(row);
  const win = dayStart(settings.windowDays);
  const readFrom = win.day < startDay ? win.day : startDay;
  try {
    const [insights, rawLeads, statusList] = await Promise.all([
      readAll(`ad_insights_daily?select=date,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,effective_status,spend,impressions,reach,clicks,conversations&business_id=eq.${id}&ad_account_id=eq.${row.ad_account_id}&date=gte.${readFrom}&order=date.asc`),
      readAll(`whatsapp_leads?select=stage,first_ad_id,first_ad_at,first_ad_headline,last_ad_id,last_ad_at,last_ad_headline&business_id=eq.${id}&or=(first_ad_id.not.is.null,last_ad_id.not.is.null)`),
      require('./leadStatuses.cjs').listFor(id),
    ]);
    // Conversions by the business's own status TYPES (won / done / repeat), not their names.
    const leads = require('./leadStatuses.cjs').byType(statusList, rawLeads);
    const summary = summariseAds({ insights: insights.filter(r => r.date >= startDay), leads, from });
    const alertOn = settings.maxCostPerChat || settings.maxCostPerConversion;
    const alerts = alertOn
      ? evaluateAlerts(summariseAds({ insights: insights.filter(r => r.date >= win.day), leads, from: win.from }).ads, settings)
      : [];
    // The WhatsApp number each ad opens (from the hourly sync).
    const adNumbers = await adNumbersView(id, row, summary.ads.map((/** @type {Row} */ a) => String(a.adId))).catch(() => ({}));
    return { report: { range: { from, days: span, startDay }, currency: row.currency || 'INR', ...summary, alerts, alertWindowDays: settings.windowDays, adNumbers } };
  } catch (err) {
    return { error: errText(err) };
  }
}

module.exports = {
  normalizeAdAccountId,
  parseInsights,
  adNumbersOf,
  summariseAds,
  evaluateAlerts,
  minorFactor,
  setAdStatus,
  adThumbnails,
  adPreview,
  creativeParts,
  getBudget,
  setBudget,
  saveAlerts,
  accountStatus,
  adsEnabled,
  connect,
  disconnect,
  syncAccount,
  manualSync,
  syncDue,
  report,
  CONVERSATION_ACTION,
  // For server/adCreate.cjs (phase D): the business's Meta connection and Graph calls.
  controlContext,
  graph,
  metaMsg,
  audit,
  // For server/adWatch.cjs (phase F): ownership check and Meta's "can't change ads" message.
  ownedObject,
  actionError,
};
