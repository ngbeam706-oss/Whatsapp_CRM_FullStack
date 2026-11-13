// @ts-check
// Customers raise a query on WhatsApp:
//   1. They tap "Raise a query" (a bot or AI button) or type a word like "complaint" / "query".
//   2. The bot sends the business's query categories as a list.
//   3. They pick one; the bot asks them to describe it in one message.
//   4. That message becomes the query: they get its number ("Q-1004 is registered").
// "NOT SOLVED" after a resolved query reopens it (handled in the webhook, even if staff paused the bot).
//
// The waiting step is remembered as a contact event ('query_pending'), valid for 30 minutes.
const { dbRequest, digits } = require('./db.cjs');
const queries = require('./queries.cjs');
const { requireBusinessId } = require('./tenant.cjs');

const RAISE_BUTTON = { id: 'btn_raise_query', title: 'Raise a query' };
const CATEGORY_ROW_PREFIX = 'qcat_';
const PENDING_MINUTES = 30;

/** Does this message ask to raise a query? Whole words only, so normal chat isn't caught. @param {unknown} text */
function wantsToRaise(text) {
  const t = String(text || '').trim().toLowerCase().replace(/[.!?]+$/, '');
  if (['query', 'complaint', 'issue', 'problem', 'help', 'support', 'raise query', 'raise a query', 'raise complaint', 'raise a complaint', 'i have a complaint', 'i have a query'].includes(t)) return true;
  return /\b(raise (a )?(query|complaint)|file (a )?complaint|register (a )?complaint)\b/.test(t);
}

/** "NOT SOLVED" / "not resolved" / "still not solved". @param {unknown} text */
function saysNotSolved(text) {
  return /^(still\s+)?not\s+(solved|resolved|fixed)[.!]*$/i.test(String(text || '').trim());
}

/**
 * Step 2: send the categories as a WhatsApp list. `sendList` is provided by the bot.
 * @param {string} biz
 * @param {(body: string, button: string, sections: Array<{ title: string, rows: Array<{ id: string, title: string, description: string }> }>) => Promise<any>} sendList
 * @returns {Promise<any>}
 */
async function start(biz, sendList) {
  /** @type {string[]} */
  const cats = (await queries.categories(biz, 'customer')).slice(0, 10);
  const rows = (cats.length ? cats : ['Other']).map((name, i) => ({ id: `${CATEGORY_ROW_PREFIX}${i}`, title: name.slice(0, 24), description: '' }));
  return sendList('What is your query about? Choose the closest option.', 'Choose', [{ title: 'Query type', rows }]);
}

/**
 * Step 3: they picked a category; remember it and ask for the details.
 * @param {string} biz @param {string} phone @param {unknown} rowId @param {string | undefined} rowTitle
 */
async function picked(biz, phone, rowId, rowTitle) {
  requireBusinessId(biz);
  const cats = await queries.categories(biz, 'customer');
  const idx = Number(String(rowId).slice(CATEGORY_ROW_PREFIX.length));
  const category = cats[idx] || rowTitle || 'Other';
  await dbRequest('contact_events', { method: 'POST', prefer: 'return=minimal', body: { business_id: biz, phone: digits(phone), event_type: 'query_pending', data: { category } } });
  return `Please describe your *${category}* query in one message. Add any details that help, like dates, your order or appointment number.`;
}

/**
 * Is this customer in the middle of raising a query? Returns the chosen category or null.
 * @param {string} biz @param {string} phone @returns {Promise<string | null>}
 */
async function pendingCategory(biz, phone) {
  const since = new Date(Date.now() - PENDING_MINUTES * 60000).toISOString();
  const r = await dbRequest(`contact_events?business_id=eq.${requireBusinessId(biz)}&phone=eq.${digits(phone)}&event_type=in.(query_pending,query_raised)&created_at=gte.${encodeURIComponent(since)}&select=event_type,data,created_at&order=created_at.desc&limit=1`);
  const last = r.ok ? r.data?.[0] : null;
  return last?.event_type === 'query_pending' ? (last.data?.category || 'Other') : null;
}

/**
 * Step 4: their message becomes the query. The customer is told the number by createQuery.
 * @param {string} biz @param {string} phone @param {unknown} text @param {string} category
 */
async function describe(biz, phone, text, category) {
  const body = String(text || '').trim();
  const subject = `${category}: ${body.replace(/\s+/g, ' ').slice(0, 100)}`;
  const r = await queries.createQuery(biz, {
    kind: 'customer', contactPhone: digits(phone), subject, description: body, category,
    priority: category === 'Complaint' ? 'high' : 'normal',
  }, { source: 'bot' });
  await dbRequest('contact_events', { method: 'POST', prefer: 'return=minimal', body: { business_id: biz, phone: digits(phone), event_type: 'query_raised', data: { queryId: r.query?.id || null } } });
  return r;
}

/** The customer says their resolved query isn't solved. Returns the text to reply with. @param {string} biz @param {string} phone */
async function notSolved(biz, phone) {
  const q = await queries.customerReopen(biz, phone);
  if (q) return `Sorry it isn't solved yet. Your query *${q.ref}* is open again and our team will get back to you here.`;
  return 'We couldn\'t find a recently resolved query for you. To raise a new one, reply QUERY.';
}

module.exports = { RAISE_BUTTON, CATEGORY_ROW_PREFIX, wantsToRaise, saysNotSolved, start, picked, pendingCategory, describe, notSolved };
