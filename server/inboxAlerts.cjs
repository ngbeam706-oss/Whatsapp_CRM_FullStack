// @ts-check
// New-chat alerts for staff: when a customer writes, or a chat is handed to someone, the business's open dashboards
// hear it on the business's own Realtime channel (server/calls.cjs staffChannel: a secret name given only to signed-in
// staff of that business). The alert carries NO name, number or message text, only whose chat it is; each browser
// decides whether it is for its person (unassigned or theirs) and shows a notification. No polling, no table.
const calls = require('./calls.cjs');

/**
 * Pure: the alert for a customer message (tested).
 * @param {{ assigned_to?: string | null } | null} lead @param {boolean} isNew
 */
const messageAlert = (lead, isNew) => ({ assignedTo: lead?.assigned_to ? String(lead.assigned_to).toLowerCase() : null, newChat: !!isNew, at: Date.now() });

/** A customer wrote (webhook). @param {string} biz @param {string} phone @param {boolean} isNew */
async function onInbound(biz, phone, isNew) {
  const channel = calls.staffChannel(biz);
  if (!channel) return false;
  const lead = await require('./inbox.cjs').getLead(biz, phone);
  return calls.broadcast(channel, 'inbox_message', messageAlert(lead, isNew));
}

/** A chat was handed to someone (not by themself). @param {string} biz @param {string} toEmail */
async function onAssigned(biz, toEmail) {
  const channel = calls.staffChannel(biz);
  if (!channel || !toEmail) return false;
  return calls.broadcast(channel, 'inbox_assigned', { to: String(toEmail).toLowerCase(), at: Date.now() });
}

module.exports = { messageAlert, onInbound, onAssigned };
