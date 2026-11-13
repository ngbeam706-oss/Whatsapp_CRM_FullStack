// @ts-check
// The header bell (docs/progress/ui-enhancement.md U1): "what needs me now", as COUNTS only.
// No names, numbers or message text: the bell links to the screen where the work is.
// Scoped to the signed-in staff member's business; what is counted depends on the role:
//   agent   - chats assigned to me with unread messages, unread chats nobody has taken,
//             my customer queries past their due time, new customer queries nobody has taken
//   manager - the same for the whole business, plus team queries addressed to managers
//   owner   - like a manager, plus team queries addressed to the Business Admin
/** @typedef {import('./types.cjs').Staff} Staff */
const { countRows } = require('./db.cjs');
const { requireBusinessId, isManagerOrOwner } = require('./tenant.cjs');

// Open stages whose due time is running ("waiting" stops the clock: server/queries.cjs).
const RUNNING = 'new,assigned,in_progress,escalated,reopened';

/**
 * @typedef {object} Notice
 * @property {string} key
 * @property {number} count
 * @property {string} label   plain words, already for this count
 * @property {'chat'|'queries'} view   the screen to open
 * @property {'urgent'|'normal'} level
 */

/** @param {number} n @param {string} one @param {string} many */
const say = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * @param {Staff} staff
 * @param {Date} [now]
 * @returns {Promise<{ items: Notice[], total: number }>}
 */
async function forStaff(staff, now = new Date()) {
  const biz = requireBusinessId(staff?.businessId);
  const me = encodeURIComponent(String(staff.email || '').toLowerCase());
  const manager = isManagerOrOwner(staff.role);
  const nowIso = encodeURIComponent(now.toISOString());
  const scope = `business_id=eq.${biz}`;

  /** @type {Array<[string, Promise<number|null>]>} */
  const jobs = [
    ['myChats', countRows('whatsapp_leads', `${scope}&assigned_to=eq.${me}&unread_count=gt.0`)],
    ['newChats', countRows('whatsapp_leads', `${scope}&assigned_to=is.null&unread_count=gt.0`)],
    ['overdueQueries', countRows('queries', `${scope}&kind=eq.customer&stage=in.(${RUNNING})&due_at=lt.${nowIso}${manager ? '' : `&assigned_to=eq.${me}`}`)],
    ['newQueries', countRows('queries', `${scope}&kind=eq.customer&stage=eq.new&assigned_to=is.null`)],
  ];
  if (staff.role === 'manager') jobs.push(['teamQueries', countRows('queries', `${scope}&kind=eq.internal&addressed_to=eq.managers&stage=in.(new,reopened)`)]);
  if (staff.role === 'owner') jobs.push(['teamQueries', countRows('queries', `${scope}&kind=eq.internal&addressed_to=eq.owner&stage=in.(new,reopened)`)]);

  const counts = Object.fromEntries(await Promise.all(jobs.map(async ([k, p]) => [k, Number(await p) || 0])));
  /** @type {Notice[]} */
  const items = [];
  const add = (/** @type {string} */ key, /** @type {string} */ label, /** @type {Notice['view']} */ view, /** @type {Notice['level']} */ level) => {
    if (counts[key] > 0) items.push({ key, count: counts[key], label, view, level });
  };
  add('myChats', say(counts.myChats, 'of your chats is waiting for a reply', 'of your chats are waiting for a reply'), 'chat', 'urgent');
  add('newChats', say(counts.newChats, 'new chat nobody has taken yet', 'new chats nobody has taken yet'), 'chat', 'normal');
  add('overdueQueries', say(counts.overdueQueries, manager ? 'customer query is overdue' : 'of your queries is overdue', manager ? 'customer queries are overdue' : 'of your queries are overdue'), 'queries', 'urgent');
  add('newQueries', say(counts.newQueries, 'new customer query to pick up', 'new customer queries to pick up'), 'queries', 'normal');
  add('teamQueries', say(counts.teamQueries || 0, 'team query for you', 'team queries for you'), 'queries', 'normal');
  return { items, total: items.reduce((s, i) => s + i.count, 0) };
}

module.exports = { forStaff };
