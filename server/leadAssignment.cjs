// @ts-check
// Automatic lead assignment (docs/progress/lead-assignment.md): Off (first action claims, as before), Round-robin
// (take turns) or Least busy (fewest open, not-Done chats). Only UNASSIGNED chats are ever assigned: a new customer
// chat, an unassigned chat that becomes active again (reopened from Done), a bot "talk to staff" handover. A chat that
// has someone is never taken away. People in the rotation can be Away, off shift (working days + hours, India time;
// default the business's send window) or at the cap of open chats: then they are skipped; if nobody is left the chat
// stays unassigned (today's behaviour). The pick itself is one locked SQL function (assign_lead_by_rotation), so two
// messages at once give one assignee. Tenancy: everything is scoped to the business.
const { dbRequest, countRows } = require('./db.cjs');
const { requireBusinessId, isManagerOrOwner } = require('./tenant.cjs');

/** @typedef {import('./types.cjs').Staff} Staff */
/** @typedef {'off' | 'round_robin' | 'least_busy'} Mode */
/** @typedef {{ email: string, available: boolean, days: number[], start_hour: number | null, end_hour: number | null }} Availability */

const MODES = ['off', 'round_robin', 'least_busy'];
const MODE_LABEL = { off: 'Off', round_robin: 'Round-robin', least_busy: 'Least busy' };
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const IST_MS = 330 * 60000;
const NUMBER_RE = /^\d{5,30}$/;
/** @param {unknown} e */
const lower = (e) => String(e || '').trim().toLowerCase();

// ---------------------------------------------------------------------------
// Pure rules (tested)
// ---------------------------------------------------------------------------
/** Default availability for someone with no row. @param {string} email @returns {Availability} */
const defaultAvailability = (email) => ({ email, available: true, days: ALL_DAYS, start_hour: null, end_hour: null });

/**
 * Is this person on shift now? India-time day of week and hour; their own hours, else the business's send window.
 * @param {Availability} a @param {{ start: number, end: number }} window @param {number} [now]
 */
function onShift(a, window, now = Date.now()) {
  const ist = new Date(now + IST_MS);
  const day = ist.getUTCDay();
  const hour = ist.getUTCHours() + ist.getUTCMinutes() / 60;
  if (!(a.days || ALL_DAYS).includes(day)) return false;
  const start = a.start_hour ?? window.start;
  const end = a.end_hour ?? window.end;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end; // a night shift wraps midnight
}

/**
 * Who may get a chat now, in the order the SQL function should use: the team order (round-robin) or least open chats
 * first (least busy; ties keep the team order). Skips Away, off shift, at the cap, and people no longer on the team.
 * @param {{ mode: Mode, team: string[], staff: Set<string>, availability: Map<string, Availability>, open: Map<string, number>,
 *   maxOpen: number | null, window: { start: number, end: number }, now?: number }} p
 * @returns {{ candidates: string[], skipped: Array<{ email: string, why: 'away' | 'off_shift' | 'at_cap' | 'not_staff' }> }}
 */
function pickCandidates({ mode, team, staff, availability, open, maxOpen, window, now = Date.now() }) {
  /** @type {Array<{ email: string, why: 'away' | 'off_shift' | 'at_cap' | 'not_staff' }>} */
  const skipped = [];
  const ok = team.filter((email) => {
    const a = availability.get(email) || defaultAvailability(email);
    if (!staff.has(email)) { skipped.push({ email, why: 'not_staff' }); return false; }
    if (!a.available) { skipped.push({ email, why: 'away' }); return false; }
    if (!onShift(a, window, now)) { skipped.push({ email, why: 'off_shift' }); return false; }
    if (maxOpen && (open.get(email) || 0) >= maxOpen) { skipped.push({ email, why: 'at_cap' }); return false; }
    return true;
  });
  const candidates = mode === 'least_busy'
    ? ok.map((e, i) => ({ e, i, n: open.get(e) || 0 })).sort((x, y) => x.n - y.n || x.i - y.i).map(x => x.e)
    : ok;
  return { candidates, skipped };
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
/** @param {string} biz */
async function loadSettings(biz) {
  const r = await dbRequest(`lead_assignment_settings?business_id=eq.${biz}&select=mode,max_open,per_number,updated_by,updated_at`);
  const row = r.ok && Array.isArray(r.data) ? r.data[0] : null;
  return { ready: r.ok, mode: /** @type {Mode} */ (MODES.includes(row?.mode) ? row.mode : 'off'), maxOpen: row?.max_open ?? null, perNumber: !!row?.per_number, updatedBy: row?.updated_by || null, updatedAt: row?.updated_at || null };
}
/**
 * The returning-customer rule (SQL 20261138). No row: on, 30 days. Before that SQL: off (the columns don't exist).
 * @param {string} biz
 * @returns {Promise<{ ready: boolean, enabled: boolean, days: number, statusCustomers: boolean, statusOthers: boolean, owner: 'same' | 'afresh' }>}
 */
async function loadReturning(biz) {
  const r = await dbRequest(`lead_assignment_settings?business_id=eq.${biz}&select=return_enabled,return_days,return_status_customers,return_status_others,return_owner`);
  if (!r.ok) return { ready: false, enabled: false, days: 30, statusCustomers: true, statusOthers: true, owner: 'same' };
  const row = Array.isArray(r.data) ? r.data[0] : null;
  return {
    ready: true, enabled: row ? row.return_enabled !== false : true, days: Number(row?.return_days) || 30,
    statusCustomers: row ? row.return_status_customers !== false : true, statusOthers: row ? row.return_status_others !== false : true,
    owner: row?.return_owner === 'afresh' ? 'afresh' : 'same',
  };
}

/**
 * May this person keep a chat that came back? On the business's team, (in the rotation team when rotation is on),
 * available, on shift and under the cap (this chat not counted). Returns why not.
 * @param {string} biz @param {string} email @param {string} [numberId]
 * @returns {Promise<{ ok: boolean, why?: 'away' | 'off_shift' | 'at_cap' | 'not_staff' | 'not_in_team' }>}
 */
async function canTake(biz, email, numberId = '') {
  const who = lower(email);
  const [settings, staffRoles, availability, window] = await Promise.all([loadSettings(biz), loadStaff(biz), loadAvailability(biz), require('./business.cjs').sendWindowFor(biz)]);
  if (!staffRoles.has(who)) return { ok: false, why: 'not_staff' };
  if (settings.mode !== 'off') {
    const { team } = teamFor(await loadMembers(biz), settings.perNumber, numberId);
    if (!team.includes(who)) return { ok: false, why: 'not_in_team' };
  }
  const open = settings.maxOpen ? await openCounts(biz, [who]) : new Map();
  if (open.has(who)) open.set(who, Math.max((open.get(who) || 0) - 1, 0)); // this chat is already theirs
  const { candidates, skipped } = pickCandidates({ mode: 'round_robin', team: [who], staff: new Set(staffRoles.keys()), availability, open, maxOpen: settings.maxOpen, window });
  return candidates.length ? { ok: true } : { ok: false, why: skipped[0]?.why === 'not_staff' ? 'not_staff' : skipped[0]?.why || 'away' };
}

/** Lead assignment mode (off / round_robin / least_busy). @param {string} biz */
async function assignmentMode(biz) {
  return (await loadSettings(requireBusinessId(biz))).mode;
}

/** "Imported customers go to the person named in their import" (SQL 20261143; off before it). @param {string} biz @returns {Promise<boolean | null>} null = not available yet */
async function importOwnerFirst(biz) {
  const r = await dbRequest(`lead_assignment_settings?business_id=eq.${requireBusinessId(biz)}&select=import_owner_first`);
  if (!r.ok) return null;
  return !!(Array.isArray(r.data) && r.data[0]?.import_owner_first);
}

/** @param {string} biz @returns {Promise<Array<{ email: string, phone_number_id: string, sort_order: number }>>} */
async function loadMembers(biz) {
  const r = await dbRequest(`lead_assignment_members?business_id=eq.${biz}&select=email,phone_number_id,sort_order&order=sort_order.asc`);
  return r.ok && Array.isArray(r.data) ? r.data.map((/** @type {any} */ m) => ({ email: lower(m.email), phone_number_id: String(m.phone_number_id || ''), sort_order: Number(m.sort_order) || 0 })) : [];
}
/** @param {string} biz @returns {Promise<Map<string, Availability>>} */
async function loadAvailability(biz) {
  const r = await dbRequest(`staff_availability?business_id=eq.${biz}&select=email,available,days,start_hour,end_hour`);
  return new Map((r.ok && Array.isArray(r.data) ? r.data : []).map((/** @type {any} */ a) => [lower(a.email), { email: lower(a.email), available: a.available !== false, days: Array.isArray(a.days) ? a.days.map(Number) : ALL_DAYS, start_hour: a.start_hour ?? null, end_hour: a.end_hour ?? null }]));
}
/** The business's staff who can take chats (email -> role). @param {string} biz */
async function loadStaff(biz) {
  const r = await dbRequest(`staff_members?business_id=eq.${biz}&select=email,role`);
  return new Map((r.ok && Array.isArray(r.data) ? r.data : []).map((/** @type {any} */ s) => [lower(s.email), String(s.role)]));
}
/** Open (not Done) chats per person. @param {string} biz @param {string[]} emails */
async function openCounts(biz, emails) {
  const inbox = require('./inbox.cjs');
  const done = inbox.closeColumnsReady() ? '&closed_at=is.null' : '';
  const counts = await Promise.all(emails.map(e => countRows('whatsapp_leads', `business_id=eq.${biz}&assigned_to=eq.${encodeURIComponent(e)}${done}`)));
  return new Map(emails.map((e, i) => [e, counts[i] ?? 0]));
}
/** The rotation team for a number: its own team when "per number" is on and it has one, else the default team. */
function teamFor(/** @type {Array<{ email: string, phone_number_id: string }>} */ members, /** @type {boolean} */ perNumber, /** @type {string} */ numberId) {
  const own = perNumber && numberId ? members.filter(m => m.phone_number_id === numberId) : [];
  const list = own.length ? own : members.filter(m => m.phone_number_id === '');
  return { team: list.map(m => m.email), key: own.length ? numberId : '' };
}

// ---------------------------------------------------------------------------
// Assigning
// ---------------------------------------------------------------------------
/**
 * If rotation is on and this chat has nobody, give it to the next person. Never throws (a customer message must never
 * fail because of this). reason: 'message' | 'handover'.
 * @param {string} biz @param {string} phone @param {{ numberId?: string | null, reason?: string }} [options]
 * @returns {Promise<{ assigned: string | null, nobody?: boolean }>}
 */
async function assignIfDue(biz, phone, { numberId = null, reason = 'message' } = {}) {
  try {
    requireBusinessId(biz);
    const settings = await loadSettings(biz);
    if (!settings.ready || settings.mode === 'off') return { assigned: null };
    const inbox = require('./inbox.cjs');
    const lead = await inbox.getLead(biz, phone);
    if (!lead || lead.assigned_to) return { assigned: null };
    const number = numberId && NUMBER_RE.test(String(numberId)) ? String(numberId) : (lead.last_phone_number_id ? String(lead.last_phone_number_id) : '');
    const members = await loadMembers(biz);
    const { team, key } = teamFor(members, settings.perNumber, number);
    if (!team.length) return { assigned: null, nobody: true };
    const [staffRoles, availability, window] = await Promise.all([loadStaff(biz), loadAvailability(biz), require('./business.cjs').sendWindowFor(biz)]);
    const staff = new Set([...staffRoles.keys()]);
    const open = settings.mode === 'least_busy' || settings.maxOpen ? await openCounts(biz, team) : new Map();
    const { candidates } = pickCandidates({ mode: settings.mode, team, staff, availability, open, maxOpen: settings.maxOpen, window });
    if (!candidates.length) return { assigned: null, nobody: true };
    const r = await dbRequest('rpc/assign_lead_by_rotation', {
      method: 'POST', body: { p_business: biz, p_phone: phone, p_number: key, p_team: team, p_candidates: candidates, p_mode: settings.mode },
    });
    const picked = r.ok && typeof r.data === 'string' && r.data ? lower(r.data) : null;
    if (!picked) return { assigned: null };
    // Timeline note + the person's dashboard alert (both best effort).
    const how = settings.mode === 'least_busy' ? 'least busy' : 'round-robin';
    await dbRequest('lead_notes', { method: 'POST', prefer: 'return=minimal', body: { business_id: biz, phone, author: 'rotation', body: `Assigned to ${picked} by rotation (${how}${reason === 'handover' ? ', asked for a person' : ''}).` } });
    try { await require('./inboxAlerts.cjs').onAssigned(biz, picked); } catch { /* alerts are best effort */ }
    return { assigned: picked };
  } catch (err) {
    console.warn('[assignment] skipped:', err instanceof Error ? err.message : err);
    return { assigned: null };
  }
}

// ---------------------------------------------------------------------------
// Settings -> Lead assignment (managers + Business Admin edit; agents can't)
// ---------------------------------------------------------------------------
/** @param {Staff} staff */
const denied = (staff) => (isManagerOrOwner(staff?.role) ? null : { error: 'Only managers and the Business Admin can change lead assignment.', status: 403 });

/** Settings, teams and everyone's state now (available / away / off shift / at cap; open chats). @param {Staff} staff */
async function view(staff) {
  const no = denied(staff); if (no) return no;
  const biz = requireBusinessId(staff.businessId);
  const [settings, returning, members, staffRoles, availability, window, numbers] = await Promise.all([
    loadSettings(biz), loadReturning(biz), loadMembers(biz), loadStaff(biz), loadAvailability(biz), require('./business.cjs').sendWindowFor(biz),
    require('./whatsapp.cjs').listNumbers(biz).catch(() => []),
  ]);
  const people = [...staffRoles.entries()].filter(([, role]) => role === 'agent' || role === 'manager' || role === 'owner').map(([email]) => email);
  const open = await openCounts(biz, people);
  const now = Date.now();
  const state = people.map((email) => {
    const a = availability.get(email) || defaultAvailability(email);
    const atCap = !!settings.maxOpen && (open.get(email) || 0) >= settings.maxOpen;
    return { email, role: staffRoles.get(email), available: a.available, onShift: onShift(a, window, now), atCap, open: open.get(email) || 0, days: a.days, startHour: a.start_hour, endHour: a.end_hour };
  });
  /** @param {string} key */
  const teamState = (key) => {
    const team = members.filter(m => m.phone_number_id === key).map(m => m.email);
    const { candidates } = pickCandidates({ mode: settings.mode === 'off' ? 'round_robin' : settings.mode, team, staff: new Set(people), availability, open, maxOpen: settings.maxOpen, window, now });
    return { numberId: key, members: team, availableNow: candidates };
  };
  const keys = ['', ...new Set(members.map(m => m.phone_number_id).filter(Boolean))];
  return {
    settings: { mode: settings.mode, maxOpen: settings.maxOpen, perNumber: settings.perNumber, updatedBy: settings.updatedBy, updatedAt: settings.updatedAt },
    returning,
    importOwnerFirst: await importOwnerFirst(biz),
    teams: keys.map(teamState),
    people: state,
    numbers,
    sendWindow: window,
    tableReady: settings.ready,
  };
}

/**
 * Save the mode, cap, per-number switch and teams. Audited (field names only).
 * @param {Staff} staff @param {{ mode?: unknown, maxOpen?: unknown, perNumber?: unknown, teams?: unknown, returning?: any, importOwnerFirst?: unknown }} input
 */
async function save(staff, input = {}) {
  const no = denied(staff); if (no) return no;
  const biz = requireBusinessId(staff.businessId);
  const mode = input.mode === undefined ? undefined : String(input.mode);
  if (mode !== undefined && !MODES.includes(mode)) return { error: 'Choose Off, Round-robin or Least busy.' };
  let maxOpen;
  if (input.maxOpen !== undefined) {
    if (input.maxOpen === null || input.maxOpen === '') maxOpen = null;
    else {
      const n = Number(input.maxOpen);
      if (!Number.isInteger(n) || n < 1 || n > 10000) return { error: 'Max open chats must be a whole number from 1, or empty for no limit.' };
      maxOpen = n;
    }
  }
  /** The returning-customer rule (Settings -> Lead assignment). @type {Record<string, unknown>} */
  const ret = {};
  if (input.returning !== undefined) {
    const x = input.returning && typeof input.returning === 'object' ? input.returning : {};
    if ('enabled' in x) ret.return_enabled = !!x.enabled;
    if ('days' in x) {
      const d = Number(x.days);
      if (!Number.isInteger(d) || d < 7 || d > 365) return { error: 'Returning after: 7 to 365 days.' };
      ret.return_days = d;
    }
    if ('statusCustomers' in x) ret.return_status_customers = !!x.statusCustomers;
    if ('statusOthers' in x) ret.return_status_others = !!x.statusOthers;
    if ('owner' in x) {
      if (x.owner !== 'same' && x.owner !== 'afresh') return { error: 'Choose "same person if available" or "assign afresh".' };
      ret.return_owner = x.owner;
    }
  }
  const staffRoles = await loadStaff(biz);
  /** @type {Array<{ business_id: string, phone_number_id: string, email: string, sort_order: number }> | undefined} */
  let rows;
  if (input.teams !== undefined) {
    if (!Array.isArray(input.teams)) return { error: 'Teams must be a list.' };
    rows = [];
    const owned = new Set((await require('./whatsapp.cjs').listNumbers(biz).catch(() => [])).map((/** @type {any} */ n) => String(n.id)));
    for (const t of input.teams.slice(0, 20)) {
      const numberId = String(t?.numberId || '');
      if (numberId && !owned.has(numberId)) return { error: 'That WhatsApp number is not one of this business\'s numbers.' };
      const emails = [...new Set((Array.isArray(t?.members) ? t.members : []).map(lower))];
      for (const e of emails) if (!staffRoles.has(e)) return { error: `${String(e).slice(0, 60)} is not on this business's team.` };
      emails.forEach((email, i) => rows?.push({ business_id: biz, phone_number_id: numberId, email, sort_order: i + 1 }));
    }
  }
  const body = {
    business_id: biz, updated_by: staff.email, updated_at: new Date().toISOString(),
    ...(mode !== undefined ? { mode } : {}), ...(maxOpen !== undefined ? { max_open: maxOpen } : {}),
    ...(input.perNumber !== undefined ? { per_number: !!input.perNumber } : {}),
    ...ret,
    // Customer import D3 (SQL 20261143): an imported customer's first message stays with the person named in the import.
    ...(input.importOwnerFirst !== undefined ? { import_owner_first: !!input.importOwnerFirst } : {}),
  };
  const s = await dbRequest('lead_assignment_settings?on_conflict=business_id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body });
  if (!s.ok) return { error: 'Could not save. Has the lead assignment SQL (20261136) been run?' };
  if (rows) {
    await dbRequest(`lead_assignment_members?business_id=eq.${biz}`, { method: 'DELETE', prefer: 'return=minimal' });
    if (rows.length) {
      const ins = await dbRequest('lead_assignment_members', { method: 'POST', prefer: 'return=minimal', body: rows });
      if (!ins.ok) return { error: 'Could not save the team.' };
    }
  }
  const fields = [...(mode !== undefined ? ['mode'] : []), ...(maxOpen !== undefined ? ['maxOpen'] : []), ...(input.perNumber !== undefined ? ['perNumber'] : []), ...(rows ? ['teams'] : []), ...Object.keys(ret), ...(input.importOwnerFirst !== undefined ? ['importOwnerFirst'] : [])];
  await dbRequest('audit_log', { method: 'POST', prefer: 'return=minimal', body: { business_id: biz, actor_email: staff.email, actor_role: staff.role, action: 'lead_assignment.updated', details: { fields, ...(mode ? { mode } : {}) } } });
  return view(staff);
}

// ---------------------------------------------------------------------------
// Available / Away (everyone, for themselves)
// ---------------------------------------------------------------------------
/** @param {Staff} staff */
async function myAvailability(staff) {
  const biz = requireBusinessId(staff?.businessId);
  const me = lower(staff.email);
  const [all, window] = await Promise.all([loadAvailability(biz), require('./business.cjs').sendWindowFor(biz)]);
  const a = all.get(me) || defaultAvailability(me);
  return { availability: { available: a.available, days: a.days, startHour: a.start_hour, endHour: a.end_hour, onShift: onShift(a, window) }, sendWindow: window };
}

/** @param {Staff} staff @param {{ available?: unknown, days?: unknown, startHour?: unknown, endHour?: unknown }} input */
async function setMyAvailability(staff, input = {}) {
  const biz = requireBusinessId(staff?.businessId);
  /** @type {Record<string, unknown>} */
  const body = { business_id: biz, email: lower(staff.email), updated_at: new Date().toISOString() };
  if (input.available !== undefined) body.available = !!input.available;
  if (input.days !== undefined) {
    const days = Array.isArray(input.days) ? [...new Set(input.days.map(Number))].filter(d => Number.isInteger(d) && d >= 0 && d <= 6).sort() : null;
    if (!days || !days.length) return { error: 'Choose at least one working day.' };
    body.days = days;
  }
  for (const [k, col, lo, hi] of /** @type {Array<[string, string, number, number]>} */ ([['startHour', 'start_hour', 0, 23], ['endHour', 'end_hour', 1, 24]])) {
    const v = /** @type {Record<string, unknown>} */ (input)[k];
    if (v === undefined) continue;
    if (v === null || v === '') { body[col] = null; continue; }
    const n = Number(v);
    if (!Number.isInteger(n) || n < lo || n > hi) return { error: 'Hours must be whole hours (0–24).' };
    body[col] = n;
  }
  const r = await dbRequest('staff_availability?on_conflict=business_id,email', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body });
  if (!r.ok) return { error: 'Could not save. Has the lead assignment SQL (20261136) been run?' };
  return myAvailability(staff);
}

module.exports = { importOwnerFirst, assignmentMode, loadReturning, canTake, MODES, MODE_LABEL, onShift, pickCandidates, teamFor, defaultAvailability, assignIfDue, view, save, myAvailability, setMyAvailability };
