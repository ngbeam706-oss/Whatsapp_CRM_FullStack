// @ts-check
// Home: "My work" for the signed-in staff member (docs/progress/ui-enhancement.md U2).
// Short lists of what needs this person now, oldest / most urgent first, each opening the right screen.
// Everything is scoped to the caller's business, and uses the same visibility rules as the Inbox and
// Queries (an agent sees unassigned chats they can take; customer queries follow queries.accessFor).
/** @typedef {import('./types.cjs').Staff} Staff */
const { dbRequest, countRows } = require('./db.cjs');
const { requireBusinessId } = require('./tenant.cjs');
const queries = require('./queries.cjs');

const CHAT_FIELDS = 'phone,name,last_message,last_inbound_at,last_contacted_at,unread_count,stage,assigned_to';
const QUERY_FIELDS = 'id,business_id,number,kind,source,contact_phone,raised_by_email,addressed_to,category,subject,priority,stage,assigned_to,escalation_level,due_at,paused_at,created_at';
const LIST = 8;

/** Midnight today, India time (the dashboard's day), as ISO. @param {Date} now */
function startOfDayIst(now) {
  const ist = new Date(now.getTime() + 5.5 * 3600000);
  ist.setUTCHours(0, 0, 0, 0);
  return new Date(ist.getTime() - 5.5 * 3600000).toISOString();
}

/** @param {string} path */
async function rows(path) {
  const r = await dbRequest(path);
  return r.ok && Array.isArray(r.data) ? r.data : [];
}

/**
 * @param {Staff} staff
 * @param {Date} [now]
 */
async function myWork(staff, now = new Date()) {
  const biz = requireBusinessId(staff?.businessId);
  const me = String(staff.email || '').toLowerCase();
  const meQ = encodeURIComponent(me);
  const scope = `business_id=eq.${biz}`;
  const open = queries.OPEN_STAGES.join(',');

  const [myChats, newChats, myQueriesRaw, newQueriesRaw, waitingOnMeRaw, repliesToday, myOpenChats] = await Promise.all([
    // My chats with messages I haven't answered: the longest waiting first.
    rows(`whatsapp_leads?${scope}&assigned_to=eq.${meQ}&unread_count=gt.0&select=${CHAT_FIELDS}&order=last_inbound_at.asc.nullslast&limit=${LIST}`),
    // New chats nobody has taken (anyone may take them: first action claims).
    rows(`whatsapp_leads?${scope}&assigned_to=is.null&unread_count=gt.0&select=${CHAT_FIELDS}&order=last_inbound_at.asc.nullslast&limit=${LIST}`),
    // My customer queries still open: the soonest due first.
    rows(`queries?${scope}&kind=eq.customer&assigned_to=eq.${meQ}&stage=in.(${open})&select=${QUERY_FIELDS}&order=due_at.asc.nullslast&limit=${LIST}`),
    // New customer queries nobody has picked up.
    rows(`queries?${scope}&kind=eq.customer&stage=eq.new&assigned_to=is.null&select=${QUERY_FIELDS}&order=created_at.asc&limit=${LIST}`),
    // Team queries I raised that wait for MY answer.
    rows(`queries?${scope}&kind=eq.internal&raised_by_email=ilike.${meQ}&stage=eq.waiting&select=${QUERY_FIELDS}&order=created_at.asc&limit=${LIST}`),
    countRows('whatsapp_messages', `${scope}&direction=eq.outbound&sent_by=ilike.${meQ}&timestamp=gte.${encodeURIComponent(startOfDayIst(now))}`),
    countRows('whatsapp_leads', `${scope}&assigned_to=eq.${meQ}`),
  ]);

  // Same visibility as the Queries screen (escalated ones may be above an agent's level).
  const visible = (/** @type {Record<string, any>[]} */ list) => list.filter(q => queries.accessFor(q, staff) !== 'none').map(queries.decorate);
  const myQueries = visible(myQueriesRaw);
  return {
    myChats,
    newChats,
    myQueries,
    // Only ones this person can pick up (escalated above an agent's level are view-only for them).
    newQueries: newQueriesRaw.filter(q => queries.accessFor(q, staff) === 'handler').map(queries.decorate),
    waitingOnMe: visible(waitingOnMeRaw),
    today: {
      repliesSent: Number(repliesToday) || 0,
      myOpenChats: Number(myOpenChats) || 0,
      overdueQueries: myQueries.filter(q => q.overdue).length,
    },
  };
}

/**
 * "Team today" for managers and the Business Admin (U3): is the team keeping up?
 * The longest-waiting chats (anyone's), overdue customer queries, each person's load and replies today,
 * and broadcasts sending now. Counts and short lists, all scoped to the business.
 * @param {Staff} staff
 * @param {Date} [now]
 */
async function teamToday(staff, now = new Date()) {
  const biz = requireBusinessId(staff?.businessId);
  const scope = `business_id=eq.${biz}`;
  const nowIso = encodeURIComponent(now.toISOString());
  const dayStart = encodeURIComponent(startOfDayIst(now));
  const running = 'new,assigned,in_progress,escalated,reopened'; // waiting stops the clock

  const [team, waiting, overdueRaw, unassignedCount, waitingCount, sending] = await Promise.all([
    rows(`staff_members?${scope}&select=email,role&order=created_at.asc&limit=50`),
    rows(`whatsapp_leads?${scope}&unread_count=gt.0&select=${CHAT_FIELDS}&order=last_inbound_at.asc.nullslast&limit=${LIST}`),
    rows(`queries?${scope}&kind=eq.customer&stage=in.(${running})&due_at=lt.${nowIso}&select=${QUERY_FIELDS}&order=due_at.asc&limit=${LIST}`),
    countRows('whatsapp_leads', `${scope}&assigned_to=is.null&unread_count=gt.0`),
    countRows('whatsapp_leads', `${scope}&unread_count=gt.0`),
    countRows('campaigns', `${scope}&status=eq.sending`),
  ]);

  const people = await Promise.all(team.map(async (/** @type {{ email: string, role: string }} */ m) => {
    const e = encodeURIComponent(String(m.email).toLowerCase());
    const [openChats, unreadChats, oldest, repliesToday, openQueries] = await Promise.all([
      countRows('whatsapp_leads', `${scope}&assigned_to=eq.${e}`),
      countRows('whatsapp_leads', `${scope}&assigned_to=eq.${e}&unread_count=gt.0`),
      rows(`whatsapp_leads?${scope}&assigned_to=eq.${e}&unread_count=gt.0&select=last_inbound_at&order=last_inbound_at.asc.nullslast&limit=1`),
      countRows('whatsapp_messages', `${scope}&direction=eq.outbound&sent_by=ilike.${e}&timestamp=gte.${dayStart}`),
      countRows('queries', `${scope}&kind=eq.customer&assigned_to=eq.${e}&stage=in.(${queries.OPEN_STAGES.join(',')})`),
    ]);
    return {
      email: String(m.email).toLowerCase(), role: m.role,
      openChats: Number(openChats) || 0, waitingChats: Number(unreadChats) || 0,
      oldestWaitingSince: oldest[0]?.last_inbound_at || null,
      repliesToday: Number(repliesToday) || 0, openQueries: Number(openQueries) || 0,
    };
  }));

  return {
    unassignedWaiting: Number(unassignedCount) || 0,
    waitingTotal: Number(waitingCount) || 0,
    longestWaiting: waiting,
    overdueQueries: overdueRaw.map(queries.decorate),
    people,
    broadcastsSending: Number(sending) || 0,
  };
}

module.exports = { myWork, teamToday, startOfDayIst };
