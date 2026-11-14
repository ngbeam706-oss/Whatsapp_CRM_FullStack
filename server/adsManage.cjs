// @ts-check
// Ads → Manage (docs/progress/ads-manage.md, stages M1 + M2): the connected ad account's campaigns, ad sets and ads,
// laid out like Meta Ads Manager, with the CRM's own numbers next to Meta's.
//
//   M1: list each level (all campaigns in the account, also ones made in Ads Manager), drill down campaign → ad sets →
//       ads, search, delivery filter, totals for a date range; On/Off at every level.
//   M2: rename (Business Admin), budget where Meta keeps it (ad set or campaign; daily or lifetime, never switched;
//       managers, at most 5x per change as for ads), end date (Business Admin).
//
// Safety: every id is read back from Meta and must belong to the business's connected ad account (ads.ownedObject);
// managers + Business Admin only (agents never); every change audited old → new.
// Meta is read only when the tab is opened / refreshed and kept 5 minutes per business (no polling).
const { dbRequest } = require('./db.cjs');
const ads = require('./ads.cjs');

/** @typedef {import('./types.cjs').Staff} Staff */
/** @typedef {'campaign' | 'adset' | 'ad'} Level */
/** @typedef {Record<string, any>} Row */

const LEVELS = /** @type {Record<Level, { edge: string, fields: string, label: string }>} */ ({
  campaign: { edge: 'campaigns', label: 'campaign', fields: 'id,name,objective,status,effective_status,daily_budget,lifetime_budget,budget_remaining,start_time,stop_time,created_time' },
  adset: { edge: 'adsets', label: 'ad set', fields: 'id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,budget_remaining,start_time,end_time,destination_type,optimization_goal,created_time' },
  ad: { edge: 'ads', label: 'ad', fields: 'id,name,campaign_id,adset_id,status,effective_status,created_time' },
});
const ID_RE = /^\d{1,25}$/;
const CACHE_MS = 5 * 60 * 1000;
const REFRESH_GAP_MS = 30 * 1000;
const PAGE_LIMIT = 200;
const MAX_PAGES = 3;                 // up to 600 items per level per read
const MAX_BUDGET_INCREASE = 5;
const RUNNING = ['ACTIVE', 'IN_PROCESS', 'WITH_ISSUES', 'PENDING_REVIEW', 'PENDING_BILLING_INFO', 'PREAPPROVED'];
const IST_MS = 330 * 60000;

/** @type {Map<string, { items: Row[], at: number }>} */
const cache = new Map();
/** @param {string} biz */
function forget(biz) { for (const k of cache.keys()) if (k.startsWith(`${biz}|`)) cache.delete(k); }

/** @param {unknown} v @returns {v is Level} */
const isLevel = (v) => v === 'campaign' || v === 'adset' || v === 'ad';
/** Rupees etc. ↔ Meta's smallest unit. @param {string | null | undefined} currency */
const factorOf = (currency) => ads.minorFactor(currency);
/** India-time day for an ISO time. @param {number} ms */
const istDay = (ms) => new Date(ms + IST_MS).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------------------------
// Pure helpers (tested directly)
// ---------------------------------------------------------------------------------------------

/**
 * Totals per campaign / ad set / ad from the synced daily rows (Meta numbers) and the CRM's ad leads.
 * Reach is not added up across days (it would double count people), so it is left out.
 * @param {Row[]} insights rows of ad_insights_daily @param {Row[]} leads whatsapp_leads with first_ad_id
 * @param {(stage: string) => boolean} converted
 */
function totalsByLevel(insights, leads, converted) {
  /** @type {Record<Level, Map<string, { spend: number, impressions: number, clicks: number, metaChats: number, chats: number, booked: number }>>} */
  const out = { campaign: new Map(), adset: new Map(), ad: new Map() };
  const blank = () => ({ spend: 0, impressions: 0, clicks: 0, metaChats: 0, chats: 0, booked: 0 });
  /** @param {Level} level @param {unknown} id */
  const at = (level, id) => { const k = String(id || ''); let t = out[level].get(k); if (!t) { t = blank(); out[level].set(k, t); } return t; };
  /** @type {Map<string, { adset: string, campaign: string }>} */
  const parents = new Map();
  for (const r of insights) {
    parents.set(String(r.ad_id), { adset: String(r.adset_id || ''), campaign: String(r.campaign_id || '') });
    for (const [level, id] of /** @type {Array<[Level, unknown]>} */ ([['ad', r.ad_id], ['adset', r.adset_id], ['campaign', r.campaign_id]])) {
      if (!id) continue;
      const t = at(level, id);
      t.spend += Number(r.spend) || 0; t.impressions += Number(r.impressions) || 0; t.clicks += Number(r.clicks) || 0; t.metaChats += Number(r.conversations) || 0;
    }
  }
  for (const l of leads) {
    const ad = String(l.first_ad_id || '');
    if (!ad) continue;
    const p = parents.get(ad);
    const won = converted(String(l.stage || ''));
    for (const [level, id] of /** @type {Array<[Level, string]>} */ ([['ad', ad], ['adset', p?.adset || ''], ['campaign', p?.campaign || '']])) {
      if (!id) continue;
      const t = at(level, id);
      t.chats += 1; if (won) t.booked += 1;
    }
  }
  for (const m of Object.values(out)) for (const t of m.values()) t.spend = Math.round(t.spend * 100) / 100;
  return out;
}

/** One Meta object as the screen shows it. @param {Level} level @param {Row} o @param {number} factor @param {any} t */
function rowView(level, o, factor, t) {
  const daily = Number(o.daily_budget) > 0 ? Number(o.daily_budget) / factor : null;
  const lifetime = Number(o.lifetime_budget) > 0 ? Number(o.lifetime_budget) / factor : null;
  const totals = t || { spend: 0, impressions: 0, clicks: 0, metaChats: 0, chats: 0, booked: 0 };
  return {
    id: String(o.id), level, name: String(o.name || ''), status: String(o.status || ''), delivery: String(o.effective_status || o.status || ''),
    objective: o.objective || null, campaignId: o.campaign_id ? String(o.campaign_id) : null, adsetId: o.adset_id ? String(o.adset_id) : null,
    dailyBudget: daily, lifetimeBudget: lifetime, budgetRemaining: Number(o.budget_remaining) > 0 ? Number(o.budget_remaining) / factor : null,
    start: o.start_time || null, end: o.stop_time || o.end_time || null, created: o.created_time || null,
    whatsapp: level === 'adset' ? o.destination_type === 'WHATSAPP' : null,
    canToggle: ['ACTIVE', 'PAUSED'].includes(String(o.status || '')),
    ...totals,
    costPerChat: totals.chats ? Math.round((totals.spend / totals.chats) * 100) / 100 : null,
  };
}

/** Ads Manager's address for one item. @param {string} account act_… @param {Level} level @param {string} id */
function adsManagerUrl(account, level, id) {
  const act = account.replace(/^act_/, '');
  const tab = level === 'campaign' ? 'campaigns' : level === 'adset' ? 'adsets' : 'ads';
  const key = level === 'campaign' ? 'selected_campaign_ids' : level === 'adset' ? 'selected_adset_ids' : 'selected_ad_ids';
  return `https://adsmanager.facebook.com/adsmanager/manage/${tab}?act=${act}&${key}=${id}`;
}

// ---------------------------------------------------------------------------------------------
// M1: list
// ---------------------------------------------------------------------------------------------

/** All items of one level (paged, capped), from cache when fresh. @param {any} ctx @param {Level} level @param {string} parent @param {boolean} refresh */
async function fetchLevel(ctx, level, parent, refresh) {
  const key = `${ctx.id}|${level}|${parent}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < (refresh ? REFRESH_GAP_MS : CACHE_MS)) return { items: hit.items };
  const base = parent ? parent : ctx.row.ad_account_id;
  /** @type {Row[]} */
  const items = [];
  let next = `${base}/${LEVELS[level].edge}?fields=${LEVELS[level].fields}&limit=${PAGE_LIMIT}`;
  for (let page = 0; page < MAX_PAGES && next; page++) {
    const r = await ads.graph(ctx.version, ctx.token, next);
    if (r.error) return { error: ads.actionError(r) };
    items.push(...(Array.isArray(r.data) ? r.data : []));
    next = r.paging?.next || '';
  }
  cache.set(key, { items, at: Date.now() });
  if (cache.size > 2000) cache.clear();
  return { items, more: !!next };
}

/**
 * One level of the Manage tab.
 * @param {Staff} staff
 * @param {{ level?: unknown, parent?: unknown, q?: unknown, delivery?: unknown, days?: unknown, refresh?: unknown }} q
 */
async function list(staff, q = {}) {
  const level = isLevel(q.level) ? q.level : 'campaign';
  const ctx = await ads.controlContext(staff?.businessId);
  if (ctx.error !== undefined) return { error: ctx.error };
  const parent = String(q.parent || '');
  if (parent) {
    if (level === 'campaign' || !ID_RE.test(parent)) return { error: 'Unknown campaign or ad set.' };
    const owned = await ads.ownedObject(ctx, parent, 'name');
    if (owned.error !== undefined) return { error: owned.error };
  }
  const days = [7, 14, 30, 90].includes(Number(q.days)) ? Number(q.days) : 30;
  const got = await fetchLevel(ctx, level, parent, q.refresh === '1' || q.refresh === true);
  if ('error' in got) return { error: got.error };
  const from = istDay(Date.now() - (days - 1) * 86400000);
  const [ins, leads, statuses] = await Promise.all([
    dbRequest(`ad_insights_daily?business_id=eq.${ctx.id}&date=gte.${from}&select=ad_id,adset_id,campaign_id,spend,impressions,clicks,conversations&limit=50000`),
    dbRequest(`whatsapp_leads?business_id=eq.${ctx.id}&first_ad_id=not.is.null&first_ad_at=gte.${from}&select=first_ad_id,stage&limit=50000`),
    require('./leadStatuses.cjs').listFor(ctx.id),
  ]);
  const ls = require('./leadStatuses.cjs');
  const totals = totalsByLevel(ins.ok && Array.isArray(ins.data) ? ins.data : [], leads.ok && Array.isArray(leads.data) ? leads.data : [],
    (stage) => ls.CONVERTED_TYPES.includes(ls.typeOf(statuses, stage)));
  const factor = factorOf(ctx.row.currency);
  const term = String(q.q || '').trim().toLowerCase().slice(0, 80);
  const delivery = q.delivery === 'all' ? 'all' : q.delivery === 'active' ? 'active' : 'recent';
  const rows = got.items
    .map(o => rowView(level, o, factor, totals[level].get(String(o.id))))
    .filter(r => !term || r.name.toLowerCase().includes(term) || r.id === term)
    .filter(r => delivery === 'all'
      || (delivery === 'active' ? RUNNING.includes(r.delivery) : RUNNING.includes(r.delivery) || r.spend > 0 || r.chats > 0 || (r.created && r.created >= from)))
    .sort((a, b) => Number(RUNNING.includes(b.delivery)) - Number(RUNNING.includes(a.delivery)) || b.spend - a.spend || String(b.created).localeCompare(String(a.created)));
  /** @type {Record<string, number>} */
  const sum = { spend: 0, impressions: 0, clicks: 0, metaChats: 0, chats: 0, booked: 0 };
  for (const r of rows) for (const k of Object.keys(sum)) sum[k] += Number(/** @type {any} */ (r)[k]) || 0;
  sum.spend = Math.round(sum.spend * 100) / 100;
  return {
    level, parent: parent || null, days, delivery, currency: ctx.row.currency || 'INR',
    rows: rows.map(r => ({ ...r, metaUrl: adsManagerUrl(ctx.row.ad_account_id, level, r.id) })),
    totals: { ...sum, costPerChat: sum.chats ? Math.round((sum.spend / sum.chats) * 100) / 100 : null },
    total: got.items.length, truncated: !!got.more,
    canEditAll: staff.role === 'owner',
  };
}

// ---------------------------------------------------------------------------------------------
// M1: On / Off ; M2: rename, budget, end date
// ---------------------------------------------------------------------------------------------

/** Read an object of this level and make sure it is in the connected account. @param {any} ctx @param {Level} level @param {unknown} id */
async function owned(ctx, level, id) {
  if (!ID_RE.test(String(id || ''))) return { error: `Unknown ${LEVELS[level].label}.` };
  return ads.ownedObject(ctx, id, LEVELS[level].fields.replace(/^id,/, ''));
}

/** On / Off for a campaign, ad set or ad. @param {Staff} staff @param {unknown} level @param {unknown} id @param {unknown} status */
async function setStatus(staff, level, id, status) {
  if (!isLevel(level)) return { error: 'Unknown level.' };
  const want = String(status || '').toUpperCase();
  if (!['PAUSED', 'ACTIVE'].includes(want)) return { error: 'Status must be PAUSED or ACTIVE.' };
  if (level === 'ad') { const r = await ads.setAdStatus(staff, id, want); if (!('error' in r && r.error)) forget(String(staff.businessId)); return r; }
  const ctx = await ads.controlContext(staff?.businessId);
  if (ctx.error !== undefined) return { error: ctx.error };
  const o = await owned(ctx, level, id);
  if (o.error !== undefined) return o;
  const before = String(o.obj.status || '');
  if (before === want) return { ok: true, id: String(id), status: want, unchanged: true };
  if (!['ACTIVE', 'PAUSED'].includes(before)) return { error: `This ${LEVELS[level].label} is ${before.toLowerCase() || 'not editable'}; change it in Meta Ads Manager.` };
  const r = await ads.graph(ctx.version, ctx.token, String(id), { method: 'POST', form: { status: want } });
  if (r.error || r.success === false) return { error: ads.actionError(r) };
  forget(ctx.id);
  await ads.audit(staff, ctx.id, `ads.${level}_${want === 'PAUSED' ? 'paused' : 'resumed'}`, { id: String(id), name: o.obj.name || null, before, after: want });
  return { ok: true, id: String(id), status: want };
}

/**
 * Change one thing about a campaign / ad set / ad: { name } (Business Admin), { budget } (managers; the daily or
 * lifetime amount Meta keeps on this item), { endDate: 'YYYY-MM-DD' | null } (Business Admin; campaigns + ad sets).
 * @param {Staff} staff @param {unknown} level @param {unknown} id @param {Row} input
 */
async function update(staff, level, id, input = {}) {
  if (!isLevel(level)) return { error: 'Unknown level.' };
  const keys = ['name', 'budget', 'endDate'].filter(k => input[k] !== undefined);
  if (keys.length !== 1) return { error: 'Change one thing at a time: the name, the budget or the end date.' };
  const isOwner = staff.role === 'owner';
  if ((keys[0] === 'name' || keys[0] === 'endDate') && !isOwner) return { error: 'Only the Business Admin can rename or change end dates.', status: 403 };
  const ctx = await ads.controlContext(staff?.businessId);
  if (ctx.error !== undefined) return { error: ctx.error };
  const o = await owned(ctx, level, id);
  if (o.error !== undefined) return o;
  const obj = o.obj;
  const label = LEVELS[level].label;
  /** @type {Record<string, string>} */
  let form;
  /** @type {Record<string, unknown>} */
  let details;

  if (keys[0] === 'name') {
    const name = String(input.name || '').replace(/\s+/g, ' ').trim();
    if (name.length < 1 || name.length > 200) return { error: 'Enter a name of 1 to 200 characters.' };
    if (name === obj.name) return { ok: true, unchanged: true };
    form = { name };
    details = { field: 'name', before: obj.name || null, after: name };
  } else if (keys[0] === 'budget') {
    if (level === 'ad') return { error: 'Ads have no budget of their own: change it on the ad set or campaign.' };
    const value = Number(input.budget);
    if (!Number.isFinite(value) || value <= 0) return { error: 'Enter a budget above zero.' };
    const factor = factorOf(ctx.row.currency);
    const field = Number(obj.daily_budget) > 0 ? 'daily_budget' : Number(obj.lifetime_budget) > 0 ? 'lifetime_budget' : '';
    if (!field) return { error: level === 'adset' ? 'This ad set uses its campaign\'s budget: change it on the campaign.' : 'This campaign\'s budget is set on its ad sets: change it there.' };
    const current = Number(obj[field]);
    const minor = Math.round(value * factor);
    if (minor > current * MAX_BUDGET_INCREASE) return { error: `That is more than ${MAX_BUDGET_INCREASE}x the current budget (${current / factor}). Raise it in steps, or change it in Meta Ads Manager.` };
    if (minor === current) return { ok: true, unchanged: true };
    form = { [field]: String(minor) };
    details = { field, currency: ctx.row.currency, before: current / factor, after: minor / factor };
  } else {
    if (level === 'ad') return { error: 'Ads end with their ad set: change the ad set\'s end date.' };
    const field = level === 'campaign' ? 'stop_time' : 'end_time';
    const raw = input.endDate;
    if (raw === null || raw === '') {
      if (Number(obj.lifetime_budget) > 0) return { error: `A ${label} with one budget for its whole run needs an end date.` };
      // Meta clears an ad set's end with end_time=0; a campaign's stop date is removed in Ads Manager only.
      if (level === 'campaign') return { error: 'To remove a campaign\'s end date, use Meta Ads Manager (or set a later date here).' };
      form = { [field]: '0' };
      details = { field, before: obj[field] || null, after: null };
    } else {
      const d = String(raw);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) return { error: 'Pick the end date.' };
      if (d < istDay(Date.now())) return { error: 'The end date can\'t be in the past.' };
      const iso = `${d}T23:59:00+0530`;
      form = { [field]: iso };
      details = { field, before: obj[field] || null, after: iso };
    }
  }
  const r = await ads.graph(ctx.version, ctx.token, String(id), { method: 'POST', form });
  if (r.error || r.success === false) return { error: ads.actionError(r) };
  forget(ctx.id);
  await ads.audit(staff, ctx.id, `ads.${level}_changed`, { id: String(id), name: obj.name || null, ...details });
  return { ok: true, id: String(id) };
}

/** Tests only. */
function _clearCache() { cache.clear(); }

module.exports = { totalsByLevel, rowView, adsManagerUrl, list, setStatus, update, LEVELS, _clearCache };
