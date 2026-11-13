// @ts-check
// In-memory runtime state: recent messages, webhook log and live (SSE) listeners, per business.
// Note: on Netlify each function instance has its own memory, so this is a short-lived
// cache only. The database is the source of truth.
const MAX_ITEMS = 500;

/** @typedef {{ id?: string, businessId: string | null, [key: string]: any }} CachedItem */
/** @typedef {{ res: { write: (chunk: string) => unknown }, businessId: string }} SseClient */

/** @type {CachedItem[]} */
const messagesStore = [];   // items carry businessId
/** @type {CachedItem[]} */
const webhookLogs = [];     // items carry businessId (null = not tied to a business)
/** @type {Set<SseClient>} */
const sseClients = new Set(); // { res, businessId }

/** @param {Record<string, any>} item @param {string} businessId */
function pushMessage(item, businessId) {
  messagesStore.unshift({ ...item, businessId });
  if (messagesStore.length > MAX_ITEMS) messagesStore.length = MAX_ITEMS;
}

/** @param {Record<string, any>} entry @param {string | null} [businessId] */
function pushWebhookLog(entry, businessId = null) {
  webhookLogs.unshift({ timestamp: new Date().toISOString(), ...entry, businessId });
  if (webhookLogs.length > MAX_ITEMS) webhookLogs.length = MAX_ITEMS;
}

/** Recent messages and webhook logs for one business only. @param {string} businessId */
function recentFor(businessId) {
  return {
    messages: messagesStore.filter(m => m.businessId === businessId),
    logs: webhookLogs.filter(l => l.businessId === businessId),
  };
}

/** @param {string} businessId */
function clearMessages(businessId) {
  for (let i = messagesStore.length - 1; i >= 0; i--) {
    if (messagesStore[i].businessId === businessId) messagesStore.splice(i, 1);
  }
}

/** Find a cached message of this business by WhatsApp id (for delivery ticks). @param {string} businessId @param {string} id */
function findMessage(businessId, id) {
  return messagesStore.find(m => m.businessId === businessId && m.id === id);
}

/** Send a live event to the dashboards of one business only. @param {string} type @param {unknown} data @param {string | null | undefined} businessId */
function broadcastEvent(type, data, businessId) {
  if (!businessId) return; // never broadcast to everyone
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    if (client.businessId !== businessId) continue;
    try {
      client.res.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

module.exports = { messagesStore, webhookLogs, sseClients, pushMessage, pushWebhookLog, recentFor, clearMessages, findMessage, broadcastEvent };
