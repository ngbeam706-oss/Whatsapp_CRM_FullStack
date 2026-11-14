// @ts-check
// Returning customers (docs/progress/returning-leads.md): a lead that writes again after N days of silence (default 30,
// measured from its previous customer message, read BEFORE this message updates it) is marked returned_at /
// returned_after_days, and (each switchable on Settings -> Lead assignment):
//   - status by TYPE: was a customer (won / done / repeat) -> first visible "repeat" status; never converted or lost
//     (new / working / lost) -> first visible "new" status (a re-enquiry). Written to the status history ("returning").
//   - owner: "same person if available" (default) keeps the old assignee only while they are on the team, available,
//     on shift and under the cap; otherwise (or "assign afresh") the chat is unassigned, and the rotation (if on) gives
//     it to the next person right after (server/leadAssignment.cjs, called next in the webhook).
// A shorter silence changes nothing. Never throws (a customer message must never fail because of this).
const { dbRequest } = require('./db.cjs');
const { requireBusinessId } = require('./tenant.cjs');

const DAY_MS = 86400000;

/** "4 months", "45 days", "1 year". Pure. @param {number} days */
function gapText(days) {
  if (days >= 365) { const y = Math.round(days / 365); return `${y} year${y === 1 ? '' : 's'}`; }
  if (days >= 60) { const m = Math.round(days / 30); return `${m} months`; }
  return `${days} days`;
}

/**
 * The status a returning lead moves to (pure): a customer -> first visible "repeat"; otherwise -> first visible "new".
 * null = no move (switched off, no such status, or already there).
 * @param {any[]} statuses @param {string} current @param {{ statusCustomers: boolean, statusOthers: boolean }} rule
 */
function returningStatus(statuses, current, rule) {
  const ls = require('./leadStatuses.cjs');
  const type = ls.typeOf(statuses, current);
  const customer = ['won', 'done', 'repeat'].includes(type);
  if (customer ? !rule.statusCustomers : !rule.statusOthers) return null;
  const target = ls.firstOfType(statuses, customer ? 'repeat' : 'new');
  return target && target !== current ? target : null;
}

/**
 * A customer message arrived. `before`: the lead as stored before this message (null = new contact).
 * @param {string} biz @param {string} phone @param {{ last_inbound_at?: string | null, stage?: string | null, assigned_to?: string | null } | null} before
 * @param {{ numberId?: string | null, now?: number }} [options]
 */
async function apply(biz, phone, before, { numberId = null, now = Date.now() } = {}) {
  try {
    requireBusinessId(biz);
    if (!before?.last_inbound_at) return { returned: false };
    const gapMs = now - Date.parse(before.last_inbound_at);
    if (!Number.isFinite(gapMs)) return { returned: false };
    const la = require('./leadAssignment.cjs');
    const rule = await la.loadReturning(biz);
    if (!rule.enabled || gapMs < rule.days * DAY_MS) return { returned: false };
    const days = Math.floor(gapMs / DAY_MS);
    const at = new Date(now).toISOString();
    const base = `whatsapp_leads?business_id=eq.${biz}&phone=eq.${encodeURIComponent(phone)}`;
    const mark = await dbRequest(base, { method: 'PATCH', prefer: 'return=representation', body: { returned_at: at, returned_after_days: days } });
    if (!mark.ok || !Array.isArray(mark.data) || !mark.data.length) return { returned: false }; // before SQL 20261138
    /** @type {string[]} */
    const notes = [`Came back after ${gapText(days)} (last message ${new Date(before.last_inbound_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}).`];

    // Status, by type.
    const ls = require('./leadStatuses.cjs');
    const statuses = await ls.listFor(biz);
    const current = String(mark.data[0].stage || before.stage || 'new');
    const target = returningStatus(statuses, current, rule);
    if (target) {
      await dbRequest(base, { method: 'PATCH', prefer: 'return=minimal', body: { stage: target, stage_changed_at: at } });
      await require('./statusHistory.cjs').record(biz, [{ phone, from: current, to: target }], { by: 'returning', source: 'returning' });
      await require('./adConversions.cjs').onStage(biz, mark.data[0], target);
      notes.push(`Status: ${ls.typeOf(statuses, current) === 'lost' || !['won', 'done', 'repeat'].includes(ls.typeOf(statuses, current)) ? 're-enquiry' : 'returning customer'} → ${statuses.find(s => s.key === target)?.label || target}.`);
    }

    // Owner: keep the same person only if they can take it now (or "assign afresh").
    const owner = String(mark.data[0].assigned_to || '').toLowerCase();
    /** @type {string | null} */
    let unassigned = null;
    if (owner) {
      const check = rule.owner === 'afresh' ? { ok: false, why: 'afresh' } : await la.canTake(biz, owner, numberId ? String(numberId) : String(mark.data[0].last_phone_number_id || ''));
      if (!check.ok) {
        const un = await dbRequest(`${base}&assigned_to=eq.${encodeURIComponent(owner)}`, { method: 'PATCH', prefer: 'return=representation', body: { assigned_to: null } });
        if (un.ok && Array.isArray(un.data) && un.data.length) {
          unassigned = owner;
          const why = { afresh: 'assigning afresh', away: 'they are away', off_shift: 'they are off shift', at_cap: 'they have too many open chats', not_staff: 'they are no longer on the team', not_in_team: 'they are not in the rotation' }[String(check.why)] || 'not available';
          notes.push(`Taken off ${owner} (${why}).`);
        }
      }
    }
    await dbRequest('lead_notes', { method: 'POST', prefer: 'return=minimal', body: { business_id: biz, phone, author: 'returning', body: notes.join(' ') } });
    return { returned: true, days, status: target, unassigned };
  } catch (err) {
    console.warn('[returning] skipped:', err instanceof Error ? err.message : err);
    return { returned: false };
  }
}

module.exports = { apply, returningStatus, gapText };
