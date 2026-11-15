// @ts-check
// Analytics: everything is computed from the existing tables for a date range.
// Volumes for one business are small (thousands of rows), so we read the rows and
// aggregate here instead of maintaining summary tables.
const { dbRequest } = require('./db.cjs');
const { requireBusinessId } = require('./tenant.cjs');

/** @typedef {Record<string, any>} Row  a database row (lead, message, event, campaign...) */
/** @typedef {Record<string, number>} Counts */

const IST_OFFSET_MS = 330 * 60000;
const PAGE = 1000;
const MAX_ROWS = 50000;
const RESPONSE_WINDOW_MS = 24 * 3600 * 1000;
const STAGES = ['new', 'interested', 'ordered', 'completed', 'repeat', 'lost'];

// ---------------------------------------------------------------------------
// Pure helpers (tested)
// ---------------------------------------------------------------------------

/** 'YYYY-MM-DD' of a timestamp in India time. @param {string} ts */
function istDay(ts) {
  return new Date(Date.parse(ts) + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** @param {string} ts */
function istHour(ts) {
  return new Date(Date.parse(ts) + IST_OFFSET_MS).getUTCHours();
}

/** Every IST day from `fromTs` to `toTs` inclusive. @param {string} fromTs @param {string} toTs */
function dayRange(fromTs, toTs) {
  /** @type {string[]} */
  const days = [];
  let d = istDay(fromTs);
  const last = istDay(toTs);
  for (let i = 0; i < 400 && d <= last; i++) {
    days.push(d);
    d = new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  }
  return days;
}

/** @param {number[]} values @returns {number | null} */
function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** The top `n` keys by count; everything else becomes "Other". @param {Counts} counts @param {number} n */
function topKeys(counts, n) {
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}

/** New leads per day, split into the top 4 sources + Other. @param {Row[]} leads @param {string[]} days */
function leadsByDay(leads, days) {
  /** @param {Row} l @returns {string} */
  const sourceOf = (l) => l.source || 'Unknown';
  /** @type {Counts} */
  const totals = {};
  for (const l of leads) totals[sourceOf(l)] = (totals[sourceOf(l)] || 0) + 1;
  const top = topKeys(totals, 4);
  const series = Object.keys(totals).length > top.length ? [...top, 'Other'] : top;
  /** @type {Array<{ day: string, total: number, [source: string]: number | string }>} */
  const rows = days.map(day => ({ day, total: 0, ...Object.fromEntries(series.map(s => [s, 0])) }));
  /** @type {Record<string, Record<string, any>>} */
  const byDay = Object.fromEntries(rows.map(r => [r.day, r]));
  for (const l of leads) {
    const row = byDay[istDay(l.created_at)];
    if (!row) continue;
    const key = top.includes(sourceOf(l)) ? sourceOf(l) : 'Other';
    row[key] += 1;
    row.total += 1;
  }
  return { series, rows, totals };
}

/**
 * Staff response time: for each contact, from the first customer message that is
 * waiting for a person until the next staff (not bot) reply, if within 24h.
 * Bot replies don't stop the clock: they're instant and not what we're measuring.
 * @param {Row[]} messages
 */
function staffResponseTimes(messages) {
  /** @type {Record<string, Row[]>} */
  const byContact = {};
  for (const m of messages) {
    if (!m.contact_phone) continue;
    (byContact[m.contact_phone] ||= []).push(m);
  }
  /** @type {Record<string, number[]>} */
  const perStaff = {};
  /** @type {number[]} */
  const all = [];
  for (const list of Object.values(byContact)) {
    list.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    /** @type {number | null} */
    let waitingSince = null;
    for (const m of list) {
      const t = Date.parse(m.timestamp);
      if (m.direction === 'inbound') {
        if (waitingSince === null) waitingSince = t;
      } else if (m.sent_by && waitingSince !== null) {
        const delta = t - waitingSince;
        if (delta >= 0 && delta <= RESPONSE_WINDOW_MS) {
          const who = String(m.sent_by).toLowerCase();
          (perStaff[who] ||= []).push(delta / 60000);
          all.push(delta / 60000);
        }
        waitingSince = null;
      }
    }
  }
  return {
    overallMedianMin: median(all),
    staff: Object.entries(perStaff)
      .map(([email, mins]) => ({ email, replies: mins.length, medianMin: median(mins) }))
      .sort((a, b) => b.replies - a.replies),
  };
}

/** Customer messages by hour of day (IST). @param {Row[]} messages */
function busiestHours(messages) {
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0 }));
  for (const m of messages) if (m.direction === 'inbound') hours[istHour(m.timestamp)].count += 1;
  return hours;
}

/** Products: how often viewed vs ordered (from bot events). @param {Row[]} events @param {number} [limit] */
function topProducts(events, limit = 8) {
  /** @type {Record<string, { item: string, views: number, orders: number }>} */
  const items = {};
  for (const e of events) {
    const name = e.data?.item;
    if (!name) continue;
    const row = (items[name] ||= { item: name, views: 0, orders: 0 });
    if (e.event_type === 'item_viewed') row.views += 1;
    if (e.event_type === 'order_enquiry') row.orders += 1;
  }
  return Object.values(items).sort((a, b) => (b.orders - a.orders) || (b.views - a.views)).slice(0, limit);
}

const CONVERTED = ['ordered', 'completed', 'repeat'];

/**
 * Click-to-WhatsApp ads: per ad, contacts it brought in for the first time in the period,
 * existing contacts who came back through it, and how many of those are now converted
 * (Booked / Completed / Returning). Uses the pipeline stage until there is an Orders module.
 * @param {Row[]} allLeads @param {string} from @param {number} [limit]
 */
function adsPerformance(allLeads, from, limit = 20) {
  /** @typedef {{ adId: string, headline: string | null, headlineAt: string, newLeads: number, returning: number, converted: number }} AdRow */
  /** @type {Record<string, AdRow>} */
  const ads = {};
  /** @param {string} id */
  const row = (id) => (ads[id] ||= { adId: id, headline: null, headlineAt: '', newLeads: 0, returning: 0, converted: 0 });
  /** @param {AdRow} r @param {string | null | undefined} text @param {string | null | undefined} at */
  const seenHeadline = (r, text, at) => {
    if (text && (at || '') >= r.headlineAt) { r.headline = text; r.headlineAt = at || ''; }
  };
  for (const l of allLeads) {
    const converted = CONVERTED.includes(l.stage);
    const isNew = l.first_ad_id && l.first_ad_at && l.first_ad_at >= from;
    if (l.first_ad_id) seenHeadline(row(l.first_ad_id), l.first_ad_headline, l.first_ad_at);
    if (l.last_ad_id) seenHeadline(row(l.last_ad_id), l.last_ad_headline, l.last_ad_at);
    if (isNew) {
      const r = row(l.first_ad_id);
      r.newLeads += 1;
      if (converted) r.converted += 1;
    }
    // Came back through a different ad (or the same ad after the period started as an old contact).
    const isReturning = l.last_ad_id && l.last_ad_at && l.last_ad_at >= from && !(isNew && l.last_ad_id === l.first_ad_id);
    if (isReturning) {
      const r = row(l.last_ad_id);
      r.returning += 1;
      if (converted) r.converted += 1;
    }
  }
  return Object.values(ads)
    .filter(r => r.newLeads || r.returning)
    .map(({ headlineAt: _seenAt, ...r }) => ({ ...r, conversion: (r.newLeads + r.returning) ? r.converted / (r.newLeads + r.returning) : null }))
    .sort((a, b) => (b.newLeads + b.returning) - (a.newLeads + a.returning) || b.converted - a.converted)
    .slice(0, limit);
}

/**
 * Several WhatsApp numbers: per business number, customer messages, chats and replies sent. Messages with no
 * number recorded (from before several numbers) count for the main number (numberId null). Pure.
 * @param {Row[]} messages
 * @returns {Array<{ numberId: string | null, customerMessages: number, activeChats: number, repliesSent: number }>}
 */
function byNumber(messages) {
  /** @type {Map<string, { numberId: string | null, customerMessages: number, chats: Set<string>, repliesSent: number }>} */
  const out = new Map();
  for (const m of messages) {
    const key = m.phone_number_id ? String(m.phone_number_id) : '';
    let r = out.get(key);
    if (!r) { r = { numberId: key || null, customerMessages: 0, chats: new Set(), repliesSent: 0 }; out.set(key, r); }
    if (m.direction === 'inbound') { r.customerMessages += 1; if (m.contact_phone) r.chats.add(m.contact_phone); }
    else r.repliesSent += 1;
  }
  return [...out.values()]
    .map(({ chats, ...r }) => ({ ...r, activeChats: chats.size }))
    .sort((a, b) => b.customerMessages - a.customerMessages || b.repliesSent - a.repliesSent);
}

/**
 * Customer import D3 (pure): people added by imports in the period, and ad chats in the period split into existing
 * customers (imported before the ad chat started) and new people.
 * @param {Row[]} allLeads @param {string} from
 */
function importSplit(allLeads, from) {
  const imported = allLeads.filter(l => l.imported_at && l.imported_at >= from).length;
  const adChats = allLeads.filter(l => l.first_ad_id && l.first_ad_at && l.first_ad_at >= from);
  const existing = adChats.filter(l => require('./adsFunnel.cjs').isExistingCustomer(l, l.first_ad_at)).length;
  return { importedPeople: imported, adChatsExisting: existing, adChatsNew: adChats.length - existing };
}

/** @param {{ leads: Row[], allLeads: Row[], messages: Row[], events: Row[], from: string, to: string }} data */
function summarise({ leads, allLeads, messages, events, from, to }) {
  const days = dayRange(from, to);
  const inbound = messages.filter(m => m.direction === 'inbound');
  const outbound = messages.filter(m => m.direction === 'outbound');
  const staffReplies = outbound.filter(m => m.sent_by);
  const automated = outbound.filter(m => !m.sent_by);
  const orders = events.filter(e => e.event_type === 'order_enquiry');
  // Converted = booked, completed or returning (appointment/order made).
  const converted = leads.filter(l => CONVERTED.includes(l.stage)).length;
  const response = staffResponseTimes(messages);

  /** @type {Counts} */
  const stageCounts = Object.fromEntries(STAGES.map(s => [s, 0]));
  for (const l of allLeads) stageCounts[STAGES.includes(l.stage) ? l.stage : 'new'] += 1;

  /** @type {Counts} */
  const repliesByStaff = {};
  for (const m of staffReplies) repliesByStaff[String(m.sent_by).toLowerCase()] = (repliesByStaff[String(m.sent_by).toLowerCase()] || 0) + 1;
  /** @type {Counts} */
  const assignedByStaff = {};
  for (const l of allLeads) if (l.assigned_to) assignedByStaff[String(l.assigned_to).toLowerCase()] = (assignedByStaff[String(l.assigned_to).toLowerCase()] || 0) + 1;

  return {
    range: { from, to, days: days.length },
    kpis: {
      newLeads: leads.length,
      activeChats: new Set(inbound.map(m => m.contact_phone)).size,
      customerMessages: inbound.length,
      staffReplies: staffReplies.length,
      automatedReplies: automated.length,
      orderEnquiries: orders.length,
      newLeadConversion: leads.length ? converted / leads.length : null,
      medianStaffResponseMin: response.overallMedianMin,
      unassignedNow: allLeads.filter(l => !l.assigned_to).length,
      unreadNow: allLeads.reduce((n, l) => n + (l.unread_count || 0), 0),
    },
    leadsByDay: leadsByDay(leads, days),
    busiestHours: busiestHours(messages),
    pipeline: STAGES.map(s => ({ stage: s, count: stageCounts[s] })),
    ads: adsPerformance(allLeads, from),
    byNumber: byNumber(messages),
    products: topProducts(events),
    staff: [...new Set([...Object.keys(repliesByStaff), ...Object.keys(assignedByStaff), ...response.staff.map(s => s.email)])]
      .map(email => ({
        email,
        replies: repliesByStaff[email] || 0,
        assigned: assignedByStaff[email] || 0,
        medianResponseMin: response.staff.find(s => s.email === email)?.medianMin ?? null,
      }))
      .sort((a, b) => b.replies - a.replies),
  };
}

// ---------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------

/** @param {string} path @returns {Promise<Row[]>} */
async function fetchAll(path) {
  /** @type {Row[]} */
  const rows = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    const res = await dbRequest(`${path}&limit=${PAGE}&offset=${offset}`);
    if (!res.ok) throw new Error(`Could not read ${path.split('?')[0]}`);
    rows.push(...res.data);
    if (res.data.length < PAGE) break;
  }
  return rows;
}

/**
 * The Analytics page's numbers for the last `days` days, or { error }.
 * @param {string} businessId @param {{ days?: number }} [options]
 * @returns {Promise<{ error?: string, [key: string]: any }>}
 */
async function report(businessId, { days = 30 } = {}) {
  const b = `business_id=eq.${requireBusinessId(businessId)}`;
  const span = Math.min(Math.max(Number(days) || 30, 1), 365);
  const to = new Date().toISOString();
  // Start at IST midnight `span - 1` days ago, so "7 days" means today + the 6 before.
  const startDay = istDay(new Date(Date.now() - (span - 1) * 86400000).toISOString());
  const from = new Date(Date.parse(`${startDay}T00:00:00Z`) - IST_OFFSET_MS).toISOString();
  const f = encodeURIComponent(from);

  try {
    const [allLeads, messages, events, campaigns, automations] = await Promise.all([
      // With returned_at (SQL 20261138: returning customers) when the column exists.
      // With imported_at (SQL 20261142: customer import) when it exists.
      fetchAll(`whatsapp_leads?select=phone,source,created_at,stage,assigned_to,unread_count,first_ad_id,first_ad_at,first_ad_headline,last_ad_id,last_ad_at,last_ad_headline,returned_at,imported_at&${b}&order=created_at.asc`)
        .catch(() => fetchAll(`whatsapp_leads?select=phone,source,created_at,stage,assigned_to,unread_count,first_ad_id,first_ad_at,first_ad_headline,last_ad_id,last_ad_at,last_ad_headline,returned_at&${b}&order=created_at.asc`))
        .catch(() => fetchAll(`whatsapp_leads?select=phone,source,created_at,stage,assigned_to,unread_count,first_ad_id,first_ad_at,first_ad_headline,last_ad_id,last_ad_at,last_ad_headline&${b}&order=created_at.asc`)),
      // phone_number_id: the "by number" breakdown; before SQL 20261122 the column is missing, so read without it.
      fetchAll(`whatsapp_messages?select=contact_phone,direction,sent_by,timestamp,phone_number_id&${b}&timestamp=gte.${f}&order=timestamp.asc`)
        .catch(() => fetchAll(`whatsapp_messages?select=contact_phone,direction,sent_by,timestamp&${b}&timestamp=gte.${f}&order=timestamp.asc`)),
      fetchAll(`contact_events?select=phone,event_type,data,created_at&${b}&created_at=gte.${f}&event_type=in.(item_viewed,order_enquiry)&order=created_at.asc`),
      dbRequest(`campaigns?select=id,name,status,template_name,started_at,created_at&${b}&created_at=gte.${f}&order=created_at.desc&limit=50`),
      dbRequest(`automations?select=id,name,trigger,is_active&${b}&order=created_at.desc`),
    ]);
    // Stats only for this business's campaigns and automations.
    /** @type {Row[]} */
    const campaignRows = campaigns.ok ? campaigns.data : [];
    /** @type {Row[]} */
    const automationRows = automations.ok ? automations.data : [];
    const cIds = campaignRows.map(c => c.id);
    const aIds = automationRows.map(a => a.id);
    const [campaignStats, automationStats] = await Promise.all([
      cIds.length ? dbRequest(`campaign_stats?select=*&campaign_id=in.(${cIds.join(',')})`) : { ok: true, data: [] },
      aIds.length ? dbRequest(`automation_stats?select=*&automation_id=in.(${aIds.join(',')})`) : { ok: true, data: [] },
    ]);
    // The business's own statuses: conversions count by TYPE (won / done / repeat); the pipeline shows its own list.
    const ls = require('./leadStatuses.cjs');
    const statusList = await ls.listFor(businessId);
    const typed = ls.byType(statusList, allLeads);
    // New leads: people who appeared in the period, not people added by a customer import (counted apart).
    const leads = typed.filter(l => l.created_at && l.created_at >= from && !l.imported_at);
    const base = summarise({ leads, allLeads: typed, messages, events, from, to });
    // Returning leads (came back after a long silence in this period), counted apart from new leads.
    const returningLeads = allLeads.filter(l => l.returned_at && l.returned_at >= from && l.returned_at < to).length;
    const summary = { ...base, kpis: { ...base.kpis, returningLeads, ...importSplit(typed, from) }, pipeline: ls.pipelineCounts(statusList, allLeads) };

    /** @type {Map<string, Row>} */
    const cStats = new Map((campaignStats.ok ? campaignStats.data : []).map((/** @type {Row} */ s) => [s.campaign_id, s]));
    /** @type {Map<string, Row>} */
    const aStats = new Map((automationStats.ok ? automationStats.data : []).map((/** @type {Row} */ s) => [s.automation_id, s]));
    return {
      ...summary,
      campaigns: campaignRows.map(c => ({ ...c, stats: cStats.get(c.id) || null })),
      automations: automationRows.map(a => ({ ...a, stats: aStats.get(a.id) || null })),
    };
  } catch (err) {
    return { error: (err instanceof Error && err.message) || 'Could not build the report.' };
  }
}

module.exports = { importSplit, istDay, dayRange, median, leadsByDay, staffResponseTimes, busiestHours, topProducts, adsPerformance, byNumber, summarise, report };
