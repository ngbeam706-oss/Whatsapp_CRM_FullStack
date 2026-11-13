// @ts-check
// Inbox, pipeline, AI, analytics and team API (mounted under /api, staff only).
// Every call works on the signed-in staff member's own business (req.staff.businessId).
const express = require('express');
const inbox = require('./inbox.cjs');
const team = require('./team.cjs');
const ai = require('./ai.cjs');
const store = require('./botStore.cjs');
const { requireOwner, requireManager } = require('./tenant.cjs');
const { validate, params: P, body: B } = require('./validate.cjs');

const router = express.Router();
const phone = validate({ params: P.phone });

/** @type {import('./types.cjs').Reply} */
const reply = (res, r) => {
  if (!r.error) return res.json({ success: true, ...r });
  const { status = 400, ...rest } = r;
  return res.status(status).json({ success: false, ...rest });
};

// ---- Inbox -------------------------------------------------------------------
router.get('/inbox', async (req, res) => {
  const r = await inbox.listConversations(req.staff.businessId, {
    filter: String(req.query.filter || 'all'),
    stage: String(req.query.stage || ''),
    q: String(req.query.q || ''),
    staffEmail: req.staff.email,
    number: String(req.query.number || ''),
    assignee: String(req.query.assignee || ''),
    // More filters (server/leadsTools.cjs cleans them): range, from, to, statusType, source, adId, tag, optedOut.
    extra: req.query,
  });
  if (r.error) return res.status(500).json({ success: false, error: r.error });
  res.json(r);
});

// ---- Lead statuses (each business's own list; server/leadStatuses.cjs) --------------------------
// Everyone reads (Pipeline, Inbox, Broadcasts, Analytics); managers and the Business Admin change them.
const statuses = require('./leadStatuses.cjs');
const statusKey = validate({ params: P.statusKey });
router.get('/lead-statuses', async (req, res) => reply(res, await statuses.view(req.staff)));
router.post('/lead-statuses', requireManager, validate({ body: B.leadStatus }), async (req, res) => reply(res, await statuses.add(req.staff, req.body || {})));
router.put('/lead-statuses/order', requireManager, validate({ body: B.leadStatusOrder }), async (req, res) => reply(res, await statuses.reorder(req.staff, (req.body || {}).keys)));
router.patch('/lead-statuses/:key', requireManager, statusKey, validate({ body: B.leadStatus }), async (req, res) => reply(res, await statuses.update(req.staff, req.params.key, req.body || {})));
router.delete('/lead-statuses/:key', requireManager, statusKey, async (req, res) => reply(res, await statuses.remove(req.staff, req.params.key, req.query.moveTo ? String(req.query.moveTo) : null)));

// The header bell: counts of what needs this person now (no names or text; server/notifications.cjs).
router.get('/notifications', async (req, res) => {
  const staff = /** @type {import('./types.cjs').Staff} */ (req.staff);
  res.json(await require('./notifications.cjs').forStaff(staff));
});

// Home: "My work" for this person (server/home.cjs).
router.get('/home', async (req, res) => {
  const staff = /** @type {import('./types.cjs').Staff} */ (req.staff);
  res.json(await require('./home.cjs').myWork(staff));
});
// Home "Team today": managers and the Business Admin only.
router.get('/home/team', requireManager, async (req, res) => {
  const staff = /** @type {import('./types.cjs').Staff} */ (req.staff);
  res.json(await require('./home.cjs').teamToday(staff));
});

// The business's WhatsApp numbers (labels only, no secrets) for the inbox badges, filter and "Reply from".
router.get('/inbox-numbers', async (req, res) => {
  res.json({ numbers: await require('./whatsapp.cjs').listNumbers(req.staff.businessId) });
});

// New chat / "Add lead" (a phone call, walk-in…): optional source, status, tags, note, assignedTo. Nothing is sent.
router.post('/inbox/start', validate({ body: B.startChat }), async (req, res) => {
  const { phone: p, name, ...extra } = req.body || {};
  reply(res, await inbox.startConversation(req.staff, p, name, extra));
});
// Values for the inbox / Leads filter menus (this business only).
router.get('/inbox-filter-options', async (req, res) => reply(res, await require('./leadsTools.cjs').filterOptions(req.staff)));

// ---- Leads page (managers + Business Admin): list, CSV export, permanent delete. POST: numbers never in URLs ----
const leadsTools = require('./leadsTools.cjs');
router.post('/leads/search', requireManager, validate({ body: B.leadsQuery }), async (req, res) => reply(res, await leadsTools.search(req.staff, req.body || {})));
router.post('/leads/export', requireManager, validate({ body: B.leadsQuery }), async (req, res) => {
  const r = await leadsTools.exportCsv(req.staff, req.body || {});
  if ('error' in r && r.error) return reply(res, r);
  const day = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="leads-${day}.csv"`);
  res.set('X-Lead-Count', String('count' in r ? r.count : 0));
  res.send('csv' in r ? r.csv : '');
});
router.post('/leads/delete', requireManager, validate({ body: B.leadsQuery }), async (req, res) => reply(res, await leadsTools.deleteLeads(req.staff, req.body || {})));
router.get('/inbox/:phone', phone, async (req, res) => {
  const r = await inbox.getConversation(req.staff.businessId, String(req.params.phone));
  if (r.error) return res.status(404).json({ success: false, error: r.error });
  res.json(r);
});
router.post('/inbox/:phone/messages', validate({ params: P.phone, body: B.sendText }), async (req, res) => reply(res, await inbox.sendText(String(req.params.phone), req.body?.text, req.staff, req.body?.fromNumberId)));
router.post('/inbox/:phone/template', validate({ params: P.phone, body: B.sendTemplate }), async (req, res) => reply(res, await inbox.sendTemplate(String(req.params.phone), req.body || {}, req.staff)));
router.post('/inbox/:phone/read', phone, async (req, res) => reply(res, await inbox.markRead(String(req.params.phone), req.staff)));
router.patch('/inbox/:phone', validate({ params: P.phone, body: B.updateContact }), async (req, res) => reply(res, await inbox.updateContact(String(req.params.phone), req.body || {}, req.staff)));
router.post('/inbox/:phone/notes', validate({ params: P.phone, body: B.note }), async (req, res) => reply(res, await inbox.addNote(String(req.params.phone), req.body?.body, req.staff)));
// Inbox essentials: close / reopen a chat (with a reason).
router.post('/inbox/:phone/close', phone, async (req, res) => reply(res, await inbox.closeChat(String(req.params.phone), req.body || {}, req.staff)));
router.post('/inbox/:phone/reopen', phone, async (req, res) => reply(res, await inbox.reopenChat(String(req.params.phone), req.staff)));
// Photos, documents, voice notes / audio, videos (server/inboxMedia.cjs).
const media = require('./inboxMedia.cjs');
router.post('/inbox/:phone/media/upload-url', phone, async (req, res) => reply(res, await media.uploadUrl(req.staff, String(req.params.phone), req.body || {})));
router.post('/inbox/:phone/media', phone, async (req, res) => reply(res, await media.sendMedia(req.staff, String(req.params.phone), req.body || {})));
// The message id goes in the query (Meta's ids contain characters that don't belong in a path).
router.get('/inbox/:phone/media', phone, async (req, res) => reply(res, await media.mediaLink(req.staff, String(req.params.phone), String(req.query.id || ''))));
// Saved replies: everyone uses them; the Business Admin and managers manage them.
const saved = require('./savedReplies.cjs');
router.get('/saved-replies', async (req, res) => reply(res, await saved.list(req.staff)));
router.post('/saved-replies', requireManager, async (req, res) => reply(res, await saved.create(req.staff, req.body || {})));
router.put('/saved-replies/:id', requireManager, validate({ params: P.numericId }), async (req, res) => reply(res, await saved.update(req.staff, String(req.params.id), req.body || {})));
router.delete('/saved-replies/:id', requireManager, validate({ params: P.numericId }), async (req, res) => reply(res, await saved.remove(req.staff, String(req.params.id))));
router.delete('/notes/:id', validate({ params: P.numericId }), async (req, res) => reply(res, await inbox.deleteNote(String(req.params.id), req.staff)));

// ---- Pipeline ----------------------------------------------------------------
router.get('/pipeline', async (req, res) => {
  const r = await inbox.pipeline(req.staff.businessId);
  if (r.error) return res.status(500).json({ success: false, error: r.error });
  res.json(r);
});

// ---- AI assistant ----------------------------------------------------------------
router.get('/ai/settings', async (req, res) => {
  const biz = req.staff.businessId;
  const settings = await ai.getSettings(biz, { fresh: true });
  // Agents only see whether AI replies are on (for the header badge): not the knowledge, instructions
  // or provider details, which belong to the AI page.
  if (!['owner', 'manager'].includes(req.staff.role)) {
    return res.json({ settings: { auto_reply: !!settings?.auto_reply }, status: { configured: false }, role: req.staff.role });
  }
  res.json({ settings, status: await ai.providerStatus(biz), role: req.staff.role });
});
// The AI switch, knowledge and instructions: Business Admin or manager.
router.put('/ai/settings', requireManager, validate({ body: B.aiSettings }), async (req, res) => reply(res, await ai.saveSettings(req.body || {}, req.staff)));
// Provider + model + API key: Business Admin only. The key is encrypted server-side and never returned.
router.put('/ai/provider', requireOwner, validate({ body: B.aiProvider }), async (req, res) => reply(res, await ai.saveProvider(req.body || {}, req.staff)));
router.post('/ai/provider/test', requireOwner, validate({ body: B.aiProvider }), async (req, res) => reply(res, await ai.testProvider(req.staff.businessId, req.body || {})));
router.post('/ai/test', requireManager, validate({ body: B.aiQuestion }), async (req, res) => {
  const biz = req.staff.businessId;
  reply(res, await ai.testQuestion({ businessId: biz, question: req.body?.question, catalog: await store.getActiveCatalog(biz) }));
});
// Draft a reply for the agent to review (only on chats they may work on).
router.post('/inbox/:phone/suggest', phone, async (req, res) => {
  const biz = req.staff.businessId;
  const lead = await inbox.getLead(biz, String(req.params.phone));
  if (!lead) return res.status(404).json({ success: false, error: 'Contact not found.' });
  if (inbox.accessFor(lead, req.staff) === 'other') {
    return res.status(403).json({ success: false, error: `This chat belongs to ${lead.assigned_to}.` });
  }
  reply(res, await ai.draftReply({ businessId: biz, phone: String(req.params.phone), catalog: await store.getActiveCatalog(biz) }));
});

// ---- Analytics (Business Admin and managers) ---------------------------------------
router.get('/analytics', requireManager, async (req, res) => {
  // Plan limit: how far back analytics may look.
  const days = await require('./limits.cjs').clampAnalyticsDays(req.staff.businessId, req.query.days);
  const r = await require('./analytics.cjs').report(req.staff.businessId, { days });
  if (r.error) return res.status(500).json({ success: false, error: r.error });
  res.json(r);
});

// ---- Business profile (name, follow-up sending hours) ------------------------------
const business = require('./business.cjs');
// The Setup page: managers and the Business Admin.
router.get('/business', requireManager, async (req, res) => reply(res, await business.getProfile(req.staff.businessId)));
router.get('/business/checklist', requireManager, async (req, res) => reply(res, await business.checklist(req.staff.businessId)));
// Plan, usage against the limits, and payment state (counts only).
router.get('/business/usage', requireManager, async (req, res) => reply(res, await require('./limits.cjs').usageReport(req.staff.businessId)));
router.put('/business', requireOwner, async (req, res) => reply(res, await business.saveProfile(req.staff, req.body || {})));

// ---- Team ----------------------------------------------------------------------
router.get('/team', async (req, res) => {
  const r = await team.listStaff(req.staff.businessId);
  if (r.error) return res.status(500).json({ success: false, error: r.error });
  res.json({ ...r, me: { id: req.staff.id, email: req.staff.email, role: req.staff.role } });
});
// Passwords set by the Business Admin / managers (agents can't reset their own): server/team.cjs.
router.post('/team/members', requireManager, validate({ body: B.addMember }), async (req, res) => {
  /** @type {any} */
  const r = await team.addWithPassword(req.staff, req.body || {});
  return r.error ? res.status(r.status || 400).json({ success: false, error: r.error }) : res.json({ success: true, ...r });
});
router.put('/team/:userId/password', requireManager, validate({ params: P.userId, body: B.setPassword }), async (req, res) => {
  const r = await team.setPassword(req.staff, req.params.userId, req.body?.password);
  return r.error ? res.status(r.status || 400).json({ success: false, error: r.error }) : res.json({ success: true, ...r });
});
router.post('/team/invite', requireOwner, validate({ body: B.invite }), async (req, res) => reply(res, await team.inviteStaff(req.staff, req.body?.email, req.body?.role || 'agent')));
router.patch('/team/:userId', requireOwner, validate({ params: P.userId, body: B.changeRole }), async (req, res) => reply(res, await team.updateRole(req.params.userId, req.body?.role, req.staff)));
router.delete('/team/:userId', requireOwner, validate({ params: P.userId }), async (req, res) => reply(res, await team.removeStaff(req.params.userId, req.staff)));

module.exports = router;
