// Lead ownership: claim on first activity, view-only for others, transfer rules.
// Uses an in-memory fake of the Supabase REST API (no network).
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

process.env.VITE_SUPABASE_URL = 'http://fake.supabase';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
const inbox = require('../server/inbox.cjs');

const BIZ = 'a0000000-0000-4000-8000-000000000001';
const OTHER = 'b0000000-0000-4000-8000-000000000002';
const asha = { id: 'u1', email: 'asha@arogya.in', role: 'agent', businessId: BIZ };
const ravi = { id: 'u2', email: 'Ravi@Arogya.in', role: 'agent', businessId: BIZ };   // mixed case on purpose
const boss = { id: 'u3', email: 'owner@arogya.in', role: 'owner', businessId: BIZ };
const mona = { id: 'u4', email: 'mona@arogya.in', role: 'manager', businessId: BIZ };
const outsider = { id: 'u5', email: 'admin@mayura.in', role: 'owner', businessId: OTHER };

// ---- fake database -----------------------------------------------------------
let leads;
let notes;
beforeEach(() => {
  leads = {
    '919000000001': { business_id: BIZ, phone: '919000000001', name: 'A', assigned_to: null, stage: 'new', tags: [] },
    '919000000002': { business_id: BIZ, phone: '919000000002', name: 'B', assigned_to: 'asha@arogya.in', stage: 'new', tags: [] },
  };
  notes = [];
});

function param(url, key) {
  const m = url.match(new RegExp(`[?&]${key}=([^&]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

global.fetch = async (url, opts = {}) => {
  const u = String(url).replace('http://fake.supabase/rest/v1/', '');
  const method = opts.method || 'GET';
  const body = opts.body ? JSON.parse(opts.body) : null;
  // Every query must be scoped to one business; an unscoped one is a bug.
  const biz = (param(u, 'business_id') || '').replace('eq.', '') || (method === 'POST' ? body?.business_id : '');
  if (!biz) return json({ message: `unscoped ${method} ${u}` }, 500);
  if (u.startsWith('staff_members')) return json(biz === BIZ ? [{ email: 'asha@arogya.in' }, { email: 'ravi@arogya.in' }, { email: 'owner@arogya.in' }, { email: 'mona@arogya.in' }] : []);
  if (u.startsWith('whatsapp_leads')) {
    const phone = (param(u, 'phone') || '').replace('eq.', '');
    const lead = leads[phone]?.business_id === biz ? leads[phone] : undefined;
    if (method === 'GET') return json(lead ? [lead] : []);
    if (method === 'PATCH') {
      if (!lead) return json([]);
      if (param(u, 'assigned_to') === 'is.null' && lead.assigned_to) return json([]); // claim lost
      Object.assign(lead, body);
      return json([lead]);
    }
  }
  if (u.startsWith('lead_notes')) {
    if (method === 'POST') { const n = { id: notes.length + 1, ...body }; notes.push(n); return json([n], 201); }
    const id = Number((param(u, 'id') || '').replace('eq.', ''));
    const match = (n) => n.id === id && n.business_id === biz;
    if (method === 'GET') return json(notes.filter(match));
    if (method === 'DELETE') { const gone = notes.filter(match); notes = notes.filter(n => !match(n)); return json(gone); }
  }
  return json({ message: `unmocked ${method} ${u}` }, 500);
};

// ---- pure rules ------------------------------------------------------------------
test('accessFor: unassigned / mine / other (case-insensitive)', () => {
  assert.strictEqual(inbox.accessFor({ assigned_to: null }, asha), 'unassigned');
  assert.strictEqual(inbox.accessFor({ assigned_to: 'ASHA@arogya.in' }, asha), 'mine');
  assert.strictEqual(inbox.accessFor({ assigned_to: 'ravi@arogya.in' }, ravi), 'mine');
  assert.strictEqual(inbox.accessFor({ assigned_to: 'asha@arogya.in' }, ravi), 'other');
});

test('transferDenied: who may change the assignee', () => {
  const mine = { assigned_to: 'asha@arogya.in' };
  const open = { assigned_to: null };
  assert.strictEqual(inbox.transferDenied(mine, asha, 'ravi@arogya.in'), null);   // assignee transfers
  assert.strictEqual(inbox.transferDenied(mine, asha, null), null);               // assignee releases
  assert.match(inbox.transferDenied(mine, ravi, 'ravi@arogya.in'), /belongs to asha/); // can't grab someone else's
  assert.strictEqual(inbox.transferDenied(mine, boss, 'ravi@arogya.in'), null);   // owner override
  assert.strictEqual(inbox.transferDenied(open, ravi, 'ravi@arogya.in'), null);   // take an unassigned chat
  assert.match(inbox.transferDenied(open, ravi, 'asha@arogya.in'), /only the Business Admin or a manager/); // can't push to others
  assert.strictEqual(inbox.transferDenied(open, boss, 'asha@arogya.in'), null);   // owner distributes
});

// ---- behaviour against the fake database -------------------------------------------
test('first activity on an unassigned lead claims it', async () => {
  const r = await inbox.updateContact('919000000001', { stage: 'interested' }, ravi);
  assert.ifError(r.error);
  assert.strictEqual(leads['919000000001'].assigned_to, 'ravi@arogya.in');
  assert.strictEqual(leads['919000000001'].stage, 'interested');
});

test('adding a note to an unassigned lead claims it', async () => {
  const r = await inbox.addNote('919000000001', 'Called the shop', asha);
  assert.ifError(r.error);
  assert.strictEqual(leads['919000000001'].assigned_to, 'asha@arogya.in');
});

test('someone else\'s lead is view-only: edits, notes and transfers are refused with 403', async () => {
  const edit = await inbox.updateContact('919000000002', { stage: 'lost' }, ravi);
  assert.strictEqual(edit.status, 403);
  assert.match(edit.error, /belongs to asha/);
  assert.strictEqual(leads['919000000002'].stage, 'new');

  const note = await inbox.addNote('919000000002', 'hi', ravi);
  assert.strictEqual(note.status, 403);
  assert.strictEqual(notes.length, 0);

  const grab = await inbox.updateContact('919000000002', { assignedTo: 'ravi@arogya.in' }, ravi);
  assert.strictEqual(grab.status, 403);
  assert.strictEqual(leads['919000000002'].assigned_to, 'asha@arogya.in');
});

test('assignee can transfer; owner can reassign; owner still can\'t edit someone else\'s lead', async () => {
  assert.ifError((await inbox.updateContact('919000000002', { assignedTo: 'ravi@arogya.in' }, asha)).error);
  assert.strictEqual(leads['919000000002'].assigned_to, 'ravi@arogya.in');

  const ownerEdit = await inbox.updateContact('919000000002', { tags: ['vip'] }, boss);
  assert.strictEqual(ownerEdit.status, 403);

  assert.ifError((await inbox.updateContact('919000000002', { assignedTo: 'owner@arogya.in' }, boss)).error);
  assert.ifError((await inbox.updateContact('919000000002', { tags: ['vip'] }, boss)).error);
  assert.deepStrictEqual(leads['919000000002'].tags, ['vip']);
});

test('two people acting on the same unassigned lead: only one gets it', async () => {
  const [a, b] = await Promise.all([
    inbox.updateContact('919000000001', { stage: 'interested' }, asha),
    inbox.updateContact('919000000001', { stage: 'lost' }, ravi),
  ]);
  const winners = [a, b].filter(r => !r.error);
  assert.strictEqual(winners.length, 1);
  assert.strictEqual([a, b].filter(r => r.status === 403).length, 1);
});

test('mark-read does not claim, and is skipped on someone else\'s lead', async () => {
  leads['919000000002'].unread_count = 3;
  await inbox.markRead('919000000002', ravi);
  assert.strictEqual(leads['919000000002'].unread_count, 3);
  await inbox.markRead('919000000001', ravi);
  assert.strictEqual(leads['919000000001'].assigned_to, null);
});

test('assignee change and other edits must be separate requests', async () => {
  const r = await inbox.updateContact('919000000002', { assignedTo: 'ravi@arogya.in', stage: 'lost' }, asha);
  assert.match(r.error, /on its own/);
});

test('notes: only the author deletes their own (on a chat they own); owners can delete any', async () => {
  await inbox.addNote('919000000002', 'mine', asha);
  const id = notes[0].id;
  assert.strictEqual((await inbox.deleteNote(id, ravi)).status, 403);
  assert.ifError((await inbox.deleteNote(id, asha)).error);
  await inbox.addNote('919000000002', 'again', asha);
  assert.ifError((await inbox.deleteNote(notes[0].id, boss)).error);
});

// ---- M2: roles and businesses ------------------------------------------------------
test('a manager can reassign any chat, like the Business Admin', async () => {
  assert.strictEqual(inbox.transferDenied({ assigned_to: 'asha@arogya.in' }, mona, 'ravi@arogya.in'), null);
  assert.ifError((await inbox.updateContact('919000000002', { assignedTo: 'mona@arogya.in' }, mona)).error);
  assert.strictEqual(leads['919000000002'].assigned_to, 'mona@arogya.in');
});

test('staff of another business can\'t see, claim, note or change these chats', async () => {
  assert.strictEqual((await inbox.updateContact('919000000001', { stage: 'lost' }, outsider)).status, 404);
  assert.strictEqual((await inbox.addNote('919000000001', 'hi', outsider)).status, 404);
  assert.match((await inbox.markRead('919000000001', outsider)).error, /not found/);
  assert.match((await inbox.updateContact('919000000001', { assignedTo: null }, outsider)).error, /not found/);
  assert.strictEqual(leads['919000000001'].assigned_to, null);
  assert.strictEqual(leads['919000000001'].stage, 'new');
  assert.strictEqual(notes.length, 0);
  // Notes of this business can't be deleted from another business.
  await inbox.addNote('919000000002', 'private', asha);
  assert.strictEqual((await inbox.deleteNote(notes[0].id, outsider)).status, 404);
  assert.strictEqual(notes.length, 1);
});

test('a staff object without a business is refused before any query', async () => {
  await assert.rejects(() => inbox.updateContact('919000000001', { stage: 'lost' }, { id: 'x', email: 'x@y.z', role: 'owner' }), /business id/);
});