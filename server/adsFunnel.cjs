// @ts-check
// Ads conversion analytics (docs/progress/ads-module.md, "Funnel", phases A1 + A2). Managers + Business Admin only;
// aggregates only (no customer details); Platform roles never reach it (staff-only /api).
//   A1 (existing data): per campaign -> ad set -> ad: spend -> impressions -> clicks -> chats started (Meta) -> chats in
//      the CRM -> replied by the team -> working -> won -> done -> repeat (+ lost); % between steps; cost per chat /
//      working / won / done; first-ad (default) or last-ad attribution; lost reasons (inbox "Done" reasons); first-reply
//      speed bands; agents' results on ad leads; ads vs other sources; previous-period comparison; CSV.
//   A2 (SQL 20261137): status history -> "ever reached" a step, time to convert, daily trend; booking values -> revenue
//      and return on ad spend (empty value = the business's average from "Bookings to Meta").
// Statuses count by TYPE (each business names its own; server/leadStatuses.cjs).
const { dbRequest } = require('./db.cjs');
const { requireBusinessId } = require('./tenant.cjs');

/** @typedef {Record<string, any>} Row */
const IST_MS = 330 * 60000;
const RANK = { new: 0, working: 1, won: 2, done: 3, repeat: 4 };
const MAX_LEADS = 20000;
const BANDS = [['under5m', 'Under 5 min', 5], ['5to30m', '5–30 min', 30], ['30mto2h', '30 min–2 h', 120], ['over2h', 'Over 2 h', Infinity]];

/** @param {number} a @param {number} b */
const per = (a, b) => (b ? Math.round((a / b) * 100) / 100 : null);
/** @param {number} a @param {number} b */
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
/** @param {number[]} xs */
function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 10) / 10;
}
/** India-time day of an ISO time. @param {string} iso */
const istDay = (iso) => new Date(Date.parse(iso) + IST_MS).toISOString().slice(0, 10);

/**
 * An existing customer (customer import D3): imported BEFORE this ad chat started. Pure.
 * @param {Row} l @param {string | null | undefined} adAt
 */
const isExistingCustomer = (l, adAt) => !!l.imported_at && !!adAt && String(l.imported_at) < String(adAt);

/** Empty metric counters. */
const blank = () => ({ spend: 0, impressions: 0, clicks: 0, metaChats: 0, chats: 0, existing: 0, returning: 0, replied: 0, working: 0, won: 0, done: 0, repeat: 0, lost: 0, revenue: 0, valued: 0 });
/** Derived numbers for one row of counters. @param {ReturnType<typeof blank>} c */
function finish(c) {
  const spend = Math.round(c.spend * 100) / 100;
  return {
    ...c, spend, revenue: Math.round(c.revenue * 100) / 100,
    costPerChat: per(spend, c.chats), costPerWorking: per(spend, c.working), costPerWon: per(spend, c.won), costPerDone: per(spend, c.done),
    // Customer import D3: chats from people already in the business's records (imported before the ad chat) vs new people.
    newPeople: c.chats - c.existing, existingShare: pct(c.existing, c.chats),
    wonRate: pct(c.won, c.chats), roas: c.revenue && spend ? Math.round((c.revenue / spend) * 100) / 100 : null,
  };
}

/**
 * The funnel (pure; tested). leads: CRM leads with ad columns; messages: their messages (contact_phone, direction,
 * sent_by, timestamp); history: status history rows (phone, to_type, changed_at); statuses: the business's list.
 * @param {{ insights: Row[], leads: Row[], messages?: Row[], history?: Row[], statuses: any[], from: string, to: string,
 *   attribution?: 'first' | 'last', avgValue?: number | null, filters?: { campaignId?: string, statusType?: string, agent?: string } }} p
 */
function buildFunnel({ insights, leads, messages = [], history = [], statuses, from, to, attribution = 'first', avgValue = null, filters = {} }) {
  const ls = require('./leadStatuses.cjs');
  // Ads, ad sets and campaigns from Meta's rows (names from the latest day).
  /** @type {Map<string, Row>} */
  const adInfo = new Map();
  for (const r of insights) {
    const prev = adInfo.get(r.ad_id);
    if (!prev || r.date >= prev.date) adInfo.set(r.ad_id, { date: r.date, adName: r.ad_name, adsetId: r.adset_id || '', adsetName: r.adset_name, campaignId: r.campaign_id || '', campaignName: r.campaign_name });
  }
  const inPeriod = (/** @type {string | null | undefined} */ at) => !!at && at >= from && at < to;
  const firstDay = istDay(from);
  const lastDay = istDay(new Date(Date.parse(to) - 1).toISOString());
  /** @type {Map<string, ReturnType<typeof blank>>} */
  const byAd = new Map();
  const ad = (/** @type {string} */ id) => { let c = byAd.get(id); if (!c) { c = blank(); byAd.set(id, c); } return c; };
  const wanted = (/** @type {string} */ id) => !filters.campaignId || adInfo.get(id)?.campaignId === filters.campaignId;
  for (const r of insights) {
    if (r.date < firstDay || r.date > lastDay) continue;
    if (!wanted(r.ad_id)) continue;
    const c = ad(r.ad_id);
    c.spend += Number(r.spend) || 0; c.impressions += Number(r.impressions) || 0; c.clicks += Number(r.clicks) || 0; c.metaChats += Number(r.conversations) || 0;
  }

  // Messages per lead (for "replied" and first-reply speed), history per lead (for "ever reached" and time to convert).
  /** @type {Map<string, Row[]>} */
  const msgs = new Map();
  for (const m of messages) { const k = String(m.contact_phone); (msgs.get(k) || msgs.set(k, []).get(k))?.push(m); }
  /** @type {Map<string, Row[]>} */
  const hist = new Map();
  for (const h of history) { const k = String(h.phone); (hist.get(k) || hist.set(k, []).get(k))?.push(h); }

  const total = blank();
  /** @type {Record<string, Record<string, number>>} */
  const lostReasons = {};
  /** @type {Record<string, { chats: number, won: number }>} */
  const bands = Object.fromEntries([...BANDS.map(b => b[0]), 'noReply'].map(k => [k, { chats: 0, won: 0 }]));
  /** @type {Map<string, { chats: number, replied: number, won: number, replyMins: number[] }>} */
  const agents = new Map();
  /** @type {Map<string, number[]>} campaign -> days to won */
  const toWon = new Map();
  /** @type {Map<string, number>} day -> leads that became won that day */
  const wonByDay = new Map();
  /** @type {number[]} */
  const replyMinsAll = [];

  for (const l of leads) {
    const adId = attribution === 'last' ? l.last_ad_id : l.first_ad_id;
    const at = attribution === 'last' ? l.last_ad_at : l.first_ad_at;
    // Returning leads from ads (came back after a long silence in the period): counted apart from new chats.
    if (adId && inPeriod(l.returned_at) && wanted(String(adId))) { ad(String(adId)).returning += 1; total.returning += 1; }
    if (!adId || !inPeriod(at)) continue;
    const id = String(adId);
    if (!wanted(id)) continue;
    const type = ls.typeOf(statuses, l.stage);
    if (filters.statusType && type !== filters.statusType) continue;
    if (filters.agent && String(l.assigned_to || '').toLowerCase() !== filters.agent) continue;
    const c = ad(id);
    const h = (hist.get(String(l.phone)) || []).filter(x => x.changed_at >= at);
    const reached = Math.max(type === 'lost' ? -1 : RANK[/** @type {keyof typeof RANK} */ (type)] ?? 0, ...h.map(x => (x.to_type in RANK ? RANK[/** @type {keyof typeof RANK} */ (x.to_type)] : -1)));
    // Replied: a staff message after the chat started; speed = first inbound -> first staff reply.
    const ms = (msgs.get(String(l.phone)) || []).filter(m => m.timestamp >= at).sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    const firstIn = ms.find(m => m.direction === 'inbound');
    const firstReply = firstIn ? ms.find(m => m.direction !== 'inbound' && m.sent_by && m.timestamp >= firstIn.timestamp) : null;
    const replyMin = firstIn && firstReply ? (Date.parse(firstReply.timestamp) - Date.parse(firstIn.timestamp)) / 60000 : null;
    const won = reached >= RANK.won;
    const existing = isExistingCustomer(l, at);
    for (const t of [c, total]) {
      t.chats += 1;
      if (existing) t.existing += 1;
      if (firstReply) t.replied += 1;
      if (reached >= RANK.working) t.working += 1;
      if (won) t.won += 1;
      if (reached >= RANK.done) t.done += 1;
      if (reached >= RANK.repeat) t.repeat += 1;
      if (type === 'lost') t.lost += 1;
      if (won && type !== 'lost') {
        const v = l.booking_value !== null && l.booking_value !== undefined ? Number(l.booking_value) : avgValue;
        if (v) { t.revenue += v; t.valued += 1; }
      }
    }
    const campaignId = adInfo.get(id)?.campaignId || '';
    if (type === 'lost') {
      const reason = l.closed_reason || 'not_given';
      (lostReasons[campaignId] ||= {})[reason] = (lostReasons[campaignId][reason] || 0) + 1;
    }
    const band = replyMin === null ? 'noReply' : BANDS.find(b => replyMin < Number(b[2]))?.[0] || 'over2h';
    bands[band].chats += 1; if (won) bands[band].won += 1;
    if (replyMin !== null) replyMinsAll.push(replyMin);
    const who = String(l.assigned_to || '').toLowerCase() || '(nobody)';
    const a = agents.get(who) || { chats: 0, replied: 0, won: 0, replyMins: [] };
    a.chats += 1; if (firstReply) a.replied += 1; if (won) a.won += 1; if (replyMin !== null) a.replyMins.push(replyMin);
    agents.set(who, a);
    // A2: time to convert and the trend (first time the lead reached a won-or-later type).
    const firstWon = h.filter(x => x.to_type in RANK && RANK[/** @type {keyof typeof RANK} */ (x.to_type)] >= RANK.won).sort((x, y) => String(x.changed_at).localeCompare(String(y.changed_at)))[0];
    if (firstWon) {
      const days = (Date.parse(firstWon.changed_at) - Date.parse(at)) / 86400000;
      (toWon.get(campaignId) || toWon.set(campaignId, []).get(campaignId))?.push(days);
      const d = istDay(firstWon.changed_at);
      wonByDay.set(d, (wonByDay.get(d) || 0) + 1);
    }
  }
  for (const c of byAd.values()) {
    total.spend += c.spend; total.impressions += c.impressions; total.clicks += c.clicks; total.metaChats += c.metaChats;
  }

  // Campaign -> ad set -> ad.
  /** @type {Map<string, Row>} */
  const campaigns = new Map();
  for (const [id, c] of byAd) {
    const info = adInfo.get(id) || { campaignId: '', campaignName: 'Ads from another account or deleted', adsetId: '', adsetName: '', adName: `Ad ${id}` };
    const cam = campaigns.get(info.campaignId) || { campaignId: info.campaignId || null, name: info.campaignName || 'Unnamed campaign', m: blank(), adsets: new Map() };
    const set = cam.adsets.get(info.adsetId) || { adsetId: info.adsetId || null, name: info.adsetName || 'Ad set', m: blank(), ads: [] };
    for (const [k, v] of Object.entries(c)) { /** @type {any} */ (cam.m)[k] += v; /** @type {any} */ (set.m)[k] += v; }
    set.ads.push({ adId: id, name: info.adName || `Ad ${id}`, ...finish(c) });
    cam.adsets.set(info.adsetId, set);
    campaigns.set(info.campaignId, cam);
  }
  const campaignRows = [...campaigns.values()].map(cam => ({
    campaignId: cam.campaignId, name: cam.name, ...finish(cam.m),
    lostReasons: lostReasons[cam.campaignId || ''] || {},
    medianDaysToWon: median(toWon.get(cam.campaignId || '') || []),
    adsets: [...cam.adsets.values()].map((/** @type {Row} */ s) => ({ adsetId: s.adsetId, name: s.name, ...finish(s.m), ads: s.ads.sort((/** @type {Row} */ x, /** @type {Row} */ y) => y.spend - x.spend) })).sort((x, y) => y.spend - x.spend),
  })).sort((x, y) => y.spend - x.spend);

  const t = finish(total);
  const steps = [
    ['spend', 'Spend', t.spend], ['impressions', 'Impressions', t.impressions], ['clicks', 'Clicks', t.clicks], ['metaChats', 'Chats started (Meta)', t.metaChats],
    ['chats', 'Chats in the CRM', t.chats], ['replied', 'Replied by the team', t.replied], ['working', 'Working', t.working],
    ['won', 'Booked / ordered', t.won], ['done', 'Done', t.done], ['repeat', 'Returning', t.repeat],
  ].map(([key, label, count], i, all) => ({ key, label, count, pctOfPrev: i >= 2 ? pct(Number(count), Number(all[i - 1][2])) : null }));

  // Daily trend: spend (Meta) vs leads that became won (history).
  /** @type {Map<string, { day: string, spend: number, won: number }>} */
  const days = new Map();
  for (const r of insights) {
    if (r.date < firstDay || r.date > lastDay || !wanted(r.ad_id)) continue;
    const d = days.get(r.date) || { day: r.date, spend: 0, won: 0 };
    d.spend += Number(r.spend) || 0; days.set(r.date, d);
  }
  for (const [day, n] of wonByDay) { const d = days.get(day) || { day, spend: 0, won: 0 }; d.won += n; days.set(day, d); }

  return {
    totals: { ...t, medianDaysToWon: median([...toWon.values()].flat()), medianFirstReplyMin: median(replyMinsAll) },
    steps,
    campaigns: campaignRows,
    replyBands: [...BANDS.map(b => ({ key: b[0], label: b[1] })), { key: 'noReply', label: 'No reply yet' }].map(b => ({ ...b, chats: bands[b.key].chats, won: bands[b.key].won, wonRate: pct(bands[b.key].won, bands[b.key].chats) })),
    agents: [...agents.entries()].map(([email, a]) => ({ email, chats: a.chats, replied: a.replied, won: a.won, wonRate: pct(a.won, a.chats), medianFirstReplyMin: median(a.replyMins) })).sort((x, y) => y.won - x.won || y.chats - x.chats),
    trend: [...days.values()].map(d => ({ ...d, spend: Math.round(d.spend * 100) / 100 })).sort((x, y) => x.day.localeCompare(y.day)),
    historyFrom: history.length ? history.map(h => String(h.changed_at)).sort()[0] : null,
  };
}

/** Group a word for a lead's source: any ad = "Ads". @param {Row} l */
const sourceGroup = (l) => (l.first_ad_id ? 'Ads' : String(l.source || 'Unknown'));
/**
 * Ads vs other sources (pure): leads created in the period, and how many reached a won-or-later type.
 * @param {Row[]} leads @param {any[]} statuses @param {string} [only]  one source group only
 */
function bySource(leads, statuses, only = '') {
  const ls = require('./leadStatuses.cjs');
  /** @type {Map<string, { source: string, leads: number, won: number }>} */
  const out = new Map();
  for (const l of leads) {
    const s = sourceGroup(l);
    if (only && s !== only) continue;
    const r = out.get(s) || { source: s, leads: 0, won: 0 };
    r.leads += 1;
    if (['won', 'done', 'repeat'].includes(ls.typeOf(statuses, l.stage))) r.won += 1;
    out.set(s, r);
  }
  return [...out.values()].map(r => ({ ...r, wonRate: pct(r.won, r.leads) })).sort((a, b) => b.leads - a.leads);
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
/** @param {string} path @param {number} [max] */
async function readAll(path, max = MAX_LEADS) {
  /** @type {Row[]} */
  const out = [];
  for (let offset = 0; offset < max; offset += 1000) {
    const r = await dbRequest(`${path}&limit=1000&offset=${offset}`);
    if (!r.ok || !Array.isArray(r.data)) return { error: true, rows: out };
    out.push(...r.data);
    if (r.data.length < 1000) break;
  }
  return { error: false, rows: out };
}

/** The period: `days` (1–365) ending today (IST), or from/to dates; plus the equal period before it. @param {Row} q */
function period(q = {}) {
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const istStart = (/** @type {string} */ d) => new Date(Date.parse(`${d}T00:00:00Z`) - IST_MS).toISOString();
  let from;
  let to;
  if (dateRe.test(String(q.from || '')) && dateRe.test(String(q.to || '')) && q.from <= q.to) {
    from = istStart(String(q.from));
    to = new Date(Date.parse(istStart(String(q.to))) + 86400000).toISOString();
  } else {
    const days = Math.min(Math.max(Number(q.days) || 30, 1), 365);
    const today = istDay(new Date().toISOString());
    to = new Date(Date.parse(istStart(today)) + 86400000).toISOString();
    from = new Date(Date.parse(to) - days * 86400000).toISOString();
  }
  const span = Date.parse(to) - Date.parse(from);
  return { from, to, prevFrom: new Date(Date.parse(from) - span).toISOString(), prevTo: from, days: Math.round(span / 86400000) };
}

/**
 * The Funnel tab: { funnel: null } when no ad account is connected.
 * q: days | from+to, attribution (first|last), campaignId, statusType, agent, source.
 * @param {string} businessId @param {Row} [q]
 */
async function report(businessId, q = {}) {
  const biz = requireBusinessId(businessId);
  const acc = await dbRequest(`business_ad_accounts?business_id=eq.${biz}&select=ad_account_id,currency`);
  const account = acc.ok && Array.isArray(acc.data) ? acc.data[0] : null;
  if (!account) return { funnel: null };
  const p = period(q);
  const attribution = q.attribution === 'last' ? 'last' : 'first';
  const filters = {
    campaignId: /^\d{1,30}$/.test(String(q.campaignId || '')) ? String(q.campaignId) : '',
    statusType: ['new', 'working', 'won', 'done', 'repeat', 'lost'].includes(q.statusType) ? String(q.statusType) : '',
    agent: /^[^\s@,()]+@[^\s@,()]+$/.test(String(q.agent || '')) ? String(q.agent).toLowerCase() : '',
  };
  const source = String(q.source || '').slice(0, 80);
  const ls = require('./leadStatuses.cjs');
  const leadCols = 'phone,stage,source,assigned_to,created_at,first_ad_id,first_ad_at,last_ad_id,last_ad_at';
  const [insights, adLeads, allLeads, statuses, settings] = await Promise.all([
    readAll(`ad_insights_daily?select=date,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,clicks,conversations&business_id=eq.${biz}&ad_account_id=eq.${account.ad_account_id}&date=gte.${istDay(p.prevFrom)}&order=date.asc`, 50000),
    // With the inbox "Done" reason and the booking value when those columns exist.
    // With the import marker (SQL 20261142) when it exists, else without it.
    readAll(`whatsapp_leads?select=${leadCols},closed_reason,booking_value,returned_at,imported_at&business_id=eq.${biz}&or=(first_ad_id.not.is.null,last_ad_id.not.is.null)`)
      .then(r => (r.error ? readAll(`whatsapp_leads?select=${leadCols},closed_reason,booking_value,returned_at&business_id=eq.${biz}&or=(first_ad_id.not.is.null,last_ad_id.not.is.null)`) : r))
      .then(r => (r.error ? readAll(`whatsapp_leads?select=${leadCols}&business_id=eq.${biz}&or=(first_ad_id.not.is.null,last_ad_id.not.is.null)`) : r)),
    readAll(`whatsapp_leads?select=stage,source,first_ad_id,created_at&business_id=eq.${biz}&created_at=gte.${encodeURIComponent(p.from)}&created_at=lt.${encodeURIComponent(p.to)}`),
    ls.listFor(biz),
    dbRequest(`ad_conversion_settings?business_id=eq.${biz}&select=booking_value`),
  ]);
  if (insights.error) return { error: 'Could not read ad results. Has the Ads SQL been run?' };
  const avgValue = settings.ok && settings.data?.[0]?.booking_value != null ? Number(settings.data[0].booking_value) : null;
  // Only the leads that started from an ad in either period (messages + history for those).
  const inEither = adLeads.rows.filter(l => {
    const at = attribution === 'last' ? l.last_ad_at : l.first_ad_at;
    return (at && at >= p.prevFrom && at < p.to) || (l.returned_at && l.returned_at >= p.prevFrom && l.returned_at < p.to);
  });
  const phones = [...new Set(inEither.map(l => String(l.phone)))];
  /** @type {Row[]} */
  const messages = [];
  /** @type {Row[]} */
  const history = [];
  for (let i = 0; i < phones.length; i += 100) {
    const list = phones.slice(i, i + 100).join(',');
    const [m, h] = await Promise.all([
      readAll(`whatsapp_messages?select=contact_phone,direction,sent_by,timestamp&business_id=eq.${biz}&contact_phone=in.(${list})&timestamp=gte.${encodeURIComponent(p.prevFrom)}&order=timestamp.asc`, 5000),
      readAll(`lead_status_history?select=phone,to_type,changed_at&business_id=eq.${biz}&phone=in.(${list})&changed_at=gte.${encodeURIComponent(p.prevFrom)}&order=changed_at.asc`, 5000),
    ]);
    messages.push(...m.rows);
    history.push(...h.rows);
  }
  const common = { insights: insights.rows, leads: inEither, messages, history, statuses, attribution: /** @type {'first' | 'last'} */ (attribution), avgValue, filters };
  const now = buildFunnel({ ...common, from: p.from, to: p.to });
  const before = buildFunnel({ ...common, from: p.prevFrom, to: p.prevTo });
  const campaignsList = [...new Map(insights.rows.map(r => [String(r.campaign_id || ''), r.campaign_name || 'Unnamed campaign'])).entries()].filter(([id]) => id).map(([id, name]) => ({ id, name }));
  return {
    funnel: {
      range: { from: p.from, to: p.to, days: p.days, previousFrom: p.prevFrom, previousTo: p.prevTo },
      currency: account.currency || 'INR', attribution, filters: { ...filters, source }, avgValue,
      ...now,
      previous: before.totals,
      sources: bySource(allLeads.rows, statuses, source),
      campaignsList,
    },
  };
}

// ---- CSV ------------------------------------------------------------------------------------
/** One row per campaign, ad set and ad. @param {Row} funnel */
function csvOf(funnel) {
  const { toCsv } = require('./leadsTools.cjs');
  const head = ['Level', 'Campaign', 'Ad set', 'Ad', 'Spend', 'Impressions', 'Clicks', 'Chats started (Meta)', 'Chats in CRM', 'Existing customers', 'New people', 'Existing customers %', 'Replied', 'Working', 'Won', 'Done', 'Repeat', 'Lost',
    'Cost per chat', 'Cost per working', 'Cost per won', 'Cost per done', 'Won rate %', 'Revenue', 'ROAS'];
  const line = (/** @type {string} */ level, /** @type {string} */ c, /** @type {string} */ s, /** @type {string} */ a, /** @type {Row} */ m) => [level, c, s, a, m.spend, m.impressions, m.clicks, m.metaChats, m.chats, m.existing, m.newPeople, m.existingShare, m.replied, m.working, m.won, m.done, m.repeat, m.lost,
    m.costPerChat, m.costPerWorking, m.costPerWon, m.costPerDone, m.wonRate, m.revenue, m.roas];
  /** @type {unknown[][]} */
  const rows = [];
  for (const c of funnel.campaigns || []) {
    rows.push(line('Campaign', c.name, '', '', c));
    for (const s of c.adsets) {
      rows.push(line('Ad set', c.name, s.name, '', s));
      for (const a of s.ads) rows.push(line('Ad', c.name, s.name, a.name, a));
    }
  }
  rows.push(line('Total', '', '', '', funnel.totals || {}));
  return toCsv(head, rows);
}

module.exports = { buildFunnel, bySource, period, report, csvOf, median, isExistingCustomer };
