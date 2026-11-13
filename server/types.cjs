// @ts-check
// Shared JSDoc types for the server (type checking only; nothing here runs).
// Use in a file with:  /** @typedef {import('./types.cjs').Staff} Staff */

/**
 * @typedef {'owner' | 'manager' | 'agent'} Role
 *
 * @typedef {object} Staff  The signed-in business staff member (set by auth.requireStaff).
 * @property {string} id
 * @property {string} email
 * @property {Role} role
 * @property {string} businessId
 * @property {string} [businessName]
 *
 * @typedef {import('express').Request & { staff?: Staff, platformAdmin?: { id: string, email: string, role: 'owner' | 'manager' | 'developer' }, rawBody?: Buffer }} AppRequest
 * @typedef {import('express').Response} AppResponse
 * @typedef {import('express').NextFunction} NextFunction
 * @typedef {(req: AppRequest, res: AppResponse, next: NextFunction) => any} Middleware
 *   (Express ignores the return value; `any` lets a guard `return res.status(...)` or `return next()`.)
 *
 * @typedef {{ error: string, status?: number, [key: string]: unknown }} ErrorResult
 *
 * @typedef {object} DbResult  Answer from db.dbRequest (Supabase REST). `data` is the parsed JSON.
 * @property {boolean} ok
 * @property {number} status
 * @property {any} data
 *
 * @typedef {object} Lead  A row of whatsapp_leads (one customer contact in one business).
 * @property {string} phone
 * @property {string} [name]
 * @property {string | null} [assigned_to]
 * @property {string} [stage]
 * @property {string | null} [last_inbound_at]
 * @property {string | null} [last_phone_number_id]  business number the customer last wrote to (Meta id)
 * @property {boolean} [bot_paused]
 * @property {string | null} [bot_paused_until]
 * @property {boolean} [opted_out]
 * @property {string[]} [tags]
 *
 * @typedef {(res: import('express').Response, result: any) => unknown} Reply  turn a service result into JSON
 *
 * @typedef {object} MetaSendResult  Graph API answer to a send.
 * @property {Array<{ id: string }>} [messages]
 * @property {any} [error]
 *
 * @typedef {object} BotRule  One keyword rule of the bot (camelCase, as the dashboard and bot use it).
 * @property {string} id
 * @property {string} keyword
 * @property {string} [matchType]     'contains' | 'exact' | ...
 * @property {string} [responseType]  'text' | 'buttons' | ...
 * @property {string} [responseText]
 * @property {Array<{ id?: string, title?: string }>} [buttons]
 * @property {boolean} [isActive]
 *
 * @typedef {Record<string, any>} Catalog  The bot's flow catalog (menus, products, steps); free-form JSON.
 */

module.exports = {};
