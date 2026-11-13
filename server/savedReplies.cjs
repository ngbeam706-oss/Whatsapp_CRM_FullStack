// @ts-check
// Saved replies (SQL 20261132): the team's own quick replies, used in the inbox ("/" in the reply box). Everyone in
// the business uses them; the Business Admin and managers add, change and delete them. Business-scoped, server-only.
const { dbRequest } = require('./db.cjs');
const { requireBusinessId } = require('./tenant.cjs');

/** @typedef {import('./types.cjs').Staff} Staff */

const MAX_REPLIES = 100;
const SHORTCUT_RE = /^[a-z0-9_-]{1,30}$/;
const COLS = 'id,shortcut,title,body,created_by,updated_at';
const NO_TABLE = 'Saved replies need the inbox SQL (20261132). Ask the Business Admin to run it.';

/**
 * Pure: a clean saved reply or { error } (tested). The shortcut is what follows "/" (lowercase, no spaces).
 * @param {unknown} input
 * @returns {{ error: string } | { value: { shortcut: string, title: string, body: string } }}
 */
function cleanReply(input) {
  const src = /** @type {Record<string, unknown>} */ (input && typeof input === 'object' ? input : {});
  const shortcut = String(src.shortcut || '').trim().replace(/^\//, '').toLowerCase().replace(/\s+/g, '-');
  const title = String(src.title || '').trim().replace(/\s+/g, ' ');
  const body = String(src.body || '').replace(/\r\n/g, '\n').trim();
  if (!SHORTCUT_RE.test(shortcut)) return { error: 'Shortcut: 1 to 30 letters, numbers, - or _ (e.g. "timings").' };
  if (!title || title.length > 60) return { error: 'Give it a title (up to 60 characters).' };
  if (!body || body.length > 1000) return { error: 'Write the reply (up to 1000 characters).' };
  if ([title, body].some(v => /[<>]/.test(v))) return { error: '< and > are not allowed.' };
  return { value: { shortcut, title, body } };
}

/** Everyone in the business: the saved replies (by shortcut). @param {Staff} staff */
async function list(staff) {
  const biz = requireBusinessId(staff?.businessId);
  const r = await dbRequest(`saved_replies?business_id=eq.${biz}&select=${COLS}&order=shortcut.asc&limit=${MAX_REPLIES}`);
  if (!r.ok) return { replies: [], ready: false, note: NO_TABLE };
  return { replies: r.data || [], ready: true };
}

/** @param {Staff} staff @param {string} action @param {Record<string, unknown>} details */
const audit = (staff, action, details) => dbRequest('audit_log', {
  method: 'POST', prefer: 'return=minimal',
  body: { business_id: staff.businessId, actor_email: staff.email, actor_role: staff.role, action, details },
});

/** Business Admin / manager: add one. @param {Staff} staff @param {unknown} input */
async function create(staff, input) {
  const biz = requireBusinessId(staff?.businessId);
  const c = cleanReply(input);
  if ('error' in c) return { error: c.error };
  const count = await dbRequest(`saved_replies?business_id=eq.${biz}&select=id&limit=${MAX_REPLIES + 1}`);
  if (!count.ok) return { error: NO_TABLE };
  if ((count.data || []).length >= MAX_REPLIES) return { error: `Up to ${MAX_REPLIES} saved replies. Delete one first.` };
  const r = await dbRequest('saved_replies', { method: 'POST', prefer: 'return=representation', body: { business_id: biz, ...c.value, created_by: staff.email } });
  if (!r.ok) return { error: /duplicate|unique|23505/i.test(JSON.stringify(r.data || '')) || r.status === 409 ? `There is already a "/${c.value.shortcut}".` : 'Could not save.' };
  await audit(staff, 'saved_reply.created', { shortcut: c.value.shortcut });
  return { reply: r.data?.[0] };
}

/** Business Admin / manager: change one of this business's. @param {Staff} staff @param {string} id @param {unknown} input */
async function update(staff, id, input) {
  const biz = requireBusinessId(staff?.businessId);
  if (!/^\d{1,18}$/.test(String(id))) return { error: 'Invalid saved reply.' };
  const c = cleanReply(input);
  if ('error' in c) return { error: c.error };
  const r = await dbRequest(`saved_replies?business_id=eq.${biz}&id=eq.${id}`, { method: 'PATCH', prefer: 'return=representation', body: { ...c.value, updated_at: new Date().toISOString() } });
  if (!r.ok) return { error: /duplicate|unique|23505/i.test(JSON.stringify(r.data || '')) || r.status === 409 ? `There is already a "/${c.value.shortcut}".` : 'Could not save.' };
  if (!r.data?.length) return { error: 'Not found.', status: 404 };
  await audit(staff, 'saved_reply.updated', { shortcut: c.value.shortcut });
  return { reply: r.data[0] };
}

/** Business Admin / manager: delete one of this business's. @param {Staff} staff @param {string} id */
async function remove(staff, id) {
  const biz = requireBusinessId(staff?.businessId);
  if (!/^\d{1,18}$/.test(String(id))) return { error: 'Invalid saved reply.' };
  const r = await dbRequest(`saved_replies?business_id=eq.${biz}&id=eq.${id}`, { method: 'DELETE', prefer: 'return=representation' });
  if (!r.ok) return { error: 'Could not delete.' };
  if (!r.data?.length) return { error: 'Not found.', status: 404 };
  await audit(staff, 'saved_reply.deleted', { shortcut: r.data[0].shortcut });
  return { deleted: true };
}

module.exports = { cleanReply, list, create, update, remove, MAX_REPLIES };
