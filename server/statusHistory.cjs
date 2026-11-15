// @ts-check
// Lead status history (SQL 20261137): every status change of a lead, with the TYPE of both statuses, when, by whom
// and how (staff, bot, added by hand, chats moved when a status was removed). Feeds "time to convert" and the daily
// trend in the Ads funnel (server/adsFunnel.cjs). Best effort: recording never fails the change itself, and before
// the SQL is run there is simply no history. Server-only table; scoped by business_id.
const { dbRequest } = require('./db.cjs');
const { requireBusinessId } = require('./tenant.cjs');

/**
 * Record status changes (one row each; unchanged ones are skipped).
 * @param {string} biz
 * @param {Array<{ phone: string, from?: string | null, to: string }>} changes
 * @param {{ by?: string | null, source?: 'staff' | 'bot' | 'added' | 'bulk' | 'returning' | 'import' }} [meta]
 */
async function record(biz, changes, { by = null, source = 'staff' } = {}) {
  try {
    requireBusinessId(biz);
    const list = changes.filter(c => c.to && c.to !== c.from && /^\d{7,15}$/.test(String(c.phone)));
    if (!list.length) return false;
    const ls = require('./leadStatuses.cjs');
    const statuses = await ls.listFor(biz);
    const now = new Date().toISOString();
    const rows = list.map(c => ({
      business_id: biz, phone: String(c.phone),
      from_key: c.from || null, from_type: c.from ? ls.typeOf(statuses, c.from) : null,
      to_key: c.to, to_type: ls.typeOf(statuses, c.to), changed_by: by ? String(by).slice(0, 254) : null, source, changed_at: now,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      await dbRequest('lead_status_history', { method: 'POST', prefer: 'return=minimal', body: rows.slice(i, i + 500) });
    }
    return true;
  } catch (err) {
    console.warn('[status history] not recorded:', err instanceof Error ? err.message : err);
    return false;
  }
}

module.exports = { record };
