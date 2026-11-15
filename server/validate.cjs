// @ts-check
// Request validation at the edge of the API (zod).
//
// What it adds on top of the checks inside each service:
//   * types: a field that must be text can't arrive as an object or a list (no "[object Object]"
//     surprises), numbers and flags are what they claim to be
//   * size limits on every free-text field
//   * URL parameters (ids, phone numbers, template names) have the expected shape before any
//     database or Meta call
//   * one consistent 400 answer: { success: false, error: "<field>: <what is wrong>" }
//
// Body schemas are LOOSE on purpose: they check the fields they know and let other fields through
// unchanged, so nothing a screen sends is silently dropped. The services keep their own business
// rules (who may do what, plan limits, 24-hour window).
const { z } = require('zod');

/** @typedef {import('./types.cjs').Middleware} Middleware */
/** @typedef {{ params?: z.ZodType, query?: z.ZodType, body?: z.ZodType }} Schemas */

// ---- building blocks -----------------------------------------------------------------
/** @param {number} max */
const text = (max) => z.string().max(max, `must be at most ${max} characters`);
/** @param {number} max */
const textOrNumber = (max) => z.union([z.string().max(max), z.number().finite()]);
const numberLike = z.union([z.number().finite(), z.string().max(30)]);
const optionalMoney = z.union([z.number().finite(), z.string().max(30), z.null()]).optional();
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'is not a valid id');
const digitsId = z.string().regex(/^\d{1,25}$/, 'is not a valid id');
const phoneParam = z.string().regex(/^\d{7,15}$/, 'must be the number with country code, digits only');
const role = z.enum(['owner', 'manager', 'agent']);
/** "Reply from" one of the business's WhatsApp numbers (Meta phone_number_id); optional. */
const numberIdField = z.union([z.string().regex(/^\d{5,30}$/, 'is not a WhatsApp number id'), z.null()]).optional();

/** Staff profile fields (text or null to clear), as in staffStats.FIELDS. */
const profileShape = () => z.looseObject({
  fullName: z.union([text(80), z.null()]).optional(),
  phone: z.union([text(20), z.null()]).optional(),
  jobTitle: z.union([text(60), z.null()]).optional(),
  languages: z.union([text(120), z.null()]).optional(),
  employeeCode: z.union([text(30), z.null()]).optional(),
  joinedOn: z.union([text(10), z.null()]).optional(),
  workLocation: z.union([text(80), z.null()]).optional(),
  address: z.union([text(200), z.null()]).optional(),
  emergencyContactName: z.union([text(80), z.null()]).optional(),
  emergencyContactPhone: z.union([text(20), z.null()]).optional(),
});

// ---- URL parameters --------------------------------------------------------------------
const params = {
  phone: z.object({ phone: phoneParam }),
  id: z.object({ id: uuid }),
  numericId: z.object({ id: digitsId }),
  runId: z.object({ runId: digitsId }),
  userId: z.object({ userId: uuid }),
  templateName: z.object({ name: z.string().regex(/^[a-z0-9_]{1,512}$/, 'must be a template name (lowercase letters, numbers, _)') }),
  adId: z.object({ adId: digitsId }),
  adsetId: z.object({ adsetId: digitsId }),
  numberId: z.object({ numberId: z.string().regex(/^\d{5,30}$/, 'is not a WhatsApp number id') }),
  planId: z.object({ id: z.string().regex(/^[a-z0-9_]{2,30}$/, 'is not a valid plan') }),
  statusKey: z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, 'is not a valid status') }),
};

// ---- request bodies ----------------------------------------------------------------------
const body = {
  // Inbox
  startChat: z.looseObject({
    phone: textOrNumber(30), name: text(120).optional(),
    // "Add lead" (server/inbox.cjs startConversation checks the values)
    source: text(40).optional(), status: text(40).optional(), tags: z.array(text(40)).max(20).optional(),
    note: text(2000).optional(), assignedTo: z.union([text(254), z.null()]).optional(),
  }),
  sendText: z.looseObject({ text: text(4096), fromNumberId: numberIdField }),
  sendTemplate: z.looseObject({
    fromNumberId: numberIdField,
    templateName: text(512),
    language: text(20),
    variables: z.record(z.string().max(60), textOrNumber(1024)).optional(),
  }),
  updateContact: z.looseObject({
    assignedTo: z.union([text(254), z.null()]).optional(),
    stage: text(30).optional(),
    botPaused: z.boolean().optional(),
    pauseHours: z.union([z.number().finite(), z.string().max(10), z.null()]).optional(),
    tags: z.array(text(40)).max(30).optional(),
    name: text(120).optional(),
  }),
  note: z.looseObject({ body: text(2000) }),
  callLink: z.looseObject({ to: textOrNumber(30), message: text(4096), type: text(20).optional() }),

  // Team
  // The email format itself is checked by team.inviteStaff (which also trims spaces).
  invite: z.looseObject({ email: text(254), role: role.optional() }),
  changeRole: z.looseObject({ role }),

  // Ads
  adAccount: z.looseObject({ adAccountId: textOrNumber(40), accessToken: text(1000).optional() }),
  adStatus: z.looseObject({ status: text(20) }),
  // Team passwords (never logged; Supabase's maximum is 72)
  addMember: z.looseObject({ email: text(254), password: text(72), role: text(20).optional(), fullName: text(80).optional(), profile: z.looseObject({}).optional() }),
  setPassword: z.looseObject({ password: text(72) }),
  forgotPassword: z.looseObject({ email: text(254) }),
  // My profile (personal details); the full checks are in staffStats.cleanProfile.
  myProfile: profileShape(),
  // A team member's details, filled in by the Business Admin / a manager (onboarding).
  memberProfile: profileShape(),
  // Platform maintenance mode
  maintenance: z.looseObject({ on: z.boolean(), message: z.union([text(500), z.null()]).optional(), until: z.union([text(40), z.null()]).optional() }),
  // WhatsApp voice calls (the SDP answer is the browser's WebRTC description)
  waCall: z.looseObject({ callId: text(320) }),
  waCallAnswer: z.looseObject({ callId: text(320), sdp: text(20000) }),
  waCallUpload: z.looseObject({ callId: text(320), part: z.number().int().optional(), final: z.boolean().optional() }),
  waCallDone: z.looseObject({ callId: text(320), seconds: z.number().finite().optional() }),
  adBudget: z.looseObject({ dailyBudget: numberLike }),
  adPage: z.looseObject({ pageId: text(25) }),
  adImage: z.looseObject({ base64: text(1500000) }),
  adLaunch: z.looseObject({ confirmBudget: numberLike }),
  adBudgetCap: z.looseObject({ maxDailyBudget: numberLike }),
  adConversions: z.looseObject({ enabled: z.boolean().optional(), bookingValue: z.union([numberLike, z.null()]).optional() }),
  adAlerts: z.looseObject({ maxCostPerChat: optionalMoney, maxCostPerConversion: optionalMoney, windowDays: numberLike.optional(), autoPause: z.boolean().optional() }),

  // WhatsApp connection and AI provider (secrets: length-capped, never echoed back)
  whatsapp: z.looseObject({
    phoneNumberId: textOrNumber(40),
    wabaId: textOrNumber(40),
    accessToken: text(1000).optional(),
    appSecret: text(100).optional(),
  }),
  // Extra WhatsApp numbers (server/whatsappNumbers.cjs checks the details and Meta)
  addNumber: z.looseObject({
    phoneNumberId: textOrNumber(40),
    wabaId: textOrNumber(40).optional(),
    label: text(80),
    accessToken: text(1000).optional(),
  }),
  renameNumber: z.looseObject({ label: text(80).optional(), welcomeMessage: z.union([text(2000), z.null()]).optional() }),
  aiProvider: z.looseObject({
    provider: text(40).optional(), model: text(120).optional(), baseUrl: text(500).optional(),
    apiKey: text(500).optional(), removeKey: z.boolean().optional(),
  }),
  aiQuestion: z.looseObject({ question: text(2000) }),
  // The service trims knowledge to 20,000 and instructions to 4,000; this only stops absurd sizes.
  aiSettings: z.looseObject({ autoReply: z.boolean().optional(), knowledge: text(100000).optional(), instructions: text(20000).optional() }),

  // Queries (the service trims subject to 120, text to 4000; these limits only stop absurd sizes)
  queryCreate: z.looseObject({
    kind: text(20).optional(), subject: text(500).optional(), description: text(10000).optional(),
    category: text(100).optional(), priority: text(20).optional(), contactPhone: z.union([textOrNumber(30), z.null()]).optional(),
    addressedTo: z.union([text(30), z.null()]).optional(), notifyCustomer: z.boolean().optional(),
  }),
  queryUpdate: z.looseObject({
    stage: text(30).optional(), assignedTo: z.union([text(254), z.null()]).optional(),
    priority: text(20).optional(), category: z.union([text(100), z.null()]).optional(),
  }),
  queryComment: z.looseObject({ body: text(10000).optional(), visibility: text(20).optional(), toCustomer: z.boolean().optional() }),
  queryEscalate: z.looseObject({ note: z.union([text(5000), z.null()]).optional() }),
  queryRating: z.looseObject({ rating: numberLike, comment: z.union([text(5000), z.null()]).optional() }),
  supportAct: z.looseObject({ body: text(10000).optional(), stage: text(30).optional(), rating: numberLike.optional() }),
  // Platform team (server/platformTeam.cjs checks the values)
  platformTeamAdd: z.looseObject({ email: text(200), role: text(20).optional() }),
  platformTeamRole: z.looseObject({ role: text(20) }),
  // Lead statuses (server/leadStatuses.cjs checks the values)
  leadStatus: z.looseObject({ label: text(60).optional(), hint: z.union([text(200), z.null()]).optional(), color: text(20).optional(), type: text(20).optional(), active: z.boolean().optional() }),
  leadStatusOrder: z.looseObject({ keys: z.array(text(40)).max(50) }),
  // Customer fields + import (server/customFields.cjs, server/leadImport.cjs re-check every value).
  customField: z.looseObject({ label: text(60).optional(), type: text(20).optional(), options: z.array(text(60)).max(50).optional(), private: z.boolean().optional(), hidden: z.boolean().optional() }),
  customFieldOrder: z.looseObject({ keys: z.array(text(40)).max(200) }),
  customerDetails: z.looseObject({ phone: textOrNumber(30) }),
  customerDetailsSave: z.looseObject({ phone: textOrNumber(30), values: z.record(z.string(), z.unknown()) }),
  importCheck: z.looseObject({ rows: z.array(z.looseObject({})).min(1).max(500), newFields: z.array(z.looseObject({})).max(60).optional() }),
  importStart: z.looseObject({ fileName: text(200), fileRows: z.number().int().min(0), rowFrom: z.number().int().min(1), rowTo: z.number().int().min(0), consent: z.boolean(), newFields: z.array(z.looseObject({})).max(60).optional() }),
  importBatch: z.looseObject({ rows: z.array(z.looseObject({})).min(1).max(500) }),
  // Ads funnel (server/adsFunnel.cjs cleans the values)
  adsFunnel: z.looseObject({
    days: numberLike.optional(), from: text(10).optional(), to: text(10).optional(), attribution: text(10).optional(),
    campaignId: text(30).optional(), statusType: text(20).optional(), agent: text(254).optional(), source: text(80).optional(),
  }),
  // Lead assignment (server/leadAssignment.cjs checks the values)
  leadAssignment: z.looseObject({
    mode: text(20).optional(), maxOpen: z.union([numberLike, z.null()]).optional(), perNumber: z.boolean().optional(),
    teams: z.array(z.looseObject({ numberId: z.union([text(30), z.null()]).optional(), members: z.array(text(254)).max(200) })).max(20).optional(),
  }),
  availability: z.looseObject({
    available: z.boolean().optional(), days: z.array(numberLike).max(7).optional(),
    startHour: z.union([numberLike, z.null()]).optional(), endHour: z.union([numberLike, z.null()]).optional(),
  }),
  // Leads page (server/leadsTools.cjs cleans the filters)
  leadsQuery: z.looseObject({
    filters: z.looseObject({}).optional(), phones: z.array(textOrNumber(30)).max(1000).optional(),
    columns: z.array(text(30)).max(20).optional(), confirmCount: numberLike.optional(),
  }),
};

/**
 * Turn zod's first problem into one plain sentence.
 * @param {z.ZodError} error
 * @param {string} where  'params' | 'query' | 'body' (used when the problem is the whole value)
 * @returns {string}
 */
function describe(error, where) {
  const issue = error.issues[0];
  const field = issue.path.length ? issue.path.join('.') : where;
  let msg = issue.message;
  if (issue.code === 'invalid_type') msg = issue.input === undefined ? 'is required' : `must be ${issue.expected}`;
  if (issue.code === 'invalid_union') msg = 'has the wrong type';
  return `${field}: ${msg}`;
}

/**
 * Route middleware: validate({ params, body, query }) with zod schemas.
 * Bodies are parsed but not replaced, except that a missing body counts as {}.
 * @param {Schemas} [schemas]
 * @returns {Middleware}
 */
function validate(schemas = {}) {
  return (req, res, next) => {
    for (const where of /** @type {const} */ (['params', 'query', 'body'])) {
      const schema = schemas[where];
      if (!schema) continue;
      const value = where === 'body' ? (req.body ?? {}) : req[where];
      const r = schema.safeParse(value);
      if (!r.success) return res.status(400).json({ success: false, error: `Invalid request. ${describe(r.error, where)}` });
    }
    return next();
  };
}

/**
 * Every POST/PUT/PATCH body under /api must be a JSON object (not a list, string or number).
 * @type {Middleware}
 */
function requireObjectBody(req, res, next) {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method) || req.body === undefined) return next();
  if (req.body === null || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ success: false, error: 'Invalid request. The body must be a JSON object.' });
  }
  return next();
}

module.exports = { validate, requireObjectBody, params, body, describe };
