// Inbox essentials (SQL 20261132): close a chat with a reason (same ownership rules; a new message or a reply reopens
// it), team saved replies (everyone uses, managers edit, own business only), photos / documents / audio / video
// (only this business's files and messages; the 24-hour window and ownership for sending; Meta's file copied into
// private storage when first opened), new-chat alerts (the business's own channel; no name, number or text).
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-000000000002';
process.env.APP_SECRET = 'server_encryption_secret_long_enough';
process.env.SETTINGS_ENCRYPTION_KEY = '';
process.env.VITE_SUPABASE_URL = 'http://fake.supabase';
process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
process.env.WHATSAPP_BUSINESS_ID = 'c0000000-0000-4000-8000-000000000009';

const secrets = require('../server/secrets.cjs');
const app = require('../server/app.cjs');
const limits = require('../server/limits.cjs');
const whatsapp = require('../server/whatsapp.cjs');
const inbox = require('../server/inbox.cjs');
const saved = require('../server/savedReplies.cjs');
const media = require('../server/inboxMedia.cjs');
const alerts = require('../server/inboxAlerts.cjs');
const calls = require('../server/calls.cjs');
const { mediaOf, describeMessage } = require('../server/webhook.cjs');
const { _setStaffForToken } = require('../server/auth.cjs');

const PNID = '555000000000001';
const RAVI = '919000000001';   // unassigned, wrote 1 hour ago
const SITA = '919000000002';   // assigned to agent 2
const OLD = '919000000003';    // wrote 3 days ago (window closed)
const hoursAgo = (h) => new Date(Date.now() - h * 3600000).toISOString();
let db, graph, store, rt, flags;
function seed() {
  db = {
    plans: [{ id: 'pro', name: 'Pro' }],
    businesses: [{ id: A, name: 'Sunrise Clinic', status: 'active', plan_id: 'pro', limit_overrides: {} }, { id: B, name: 'Other', status: 'active', plan_id: 'pro', limit_overrides: {} }],
    business_whatsapp: [{ business_id: A, phone_number: '919000000500', phone_number_id: PNID, waba_id: '955000000000001', token_last4: '1234', access_token_enc: secrets.encrypt('EAAG-wa-token-inbox-long'), webhook_key: 'i'.repeat(32), graph_api_version: 'v26.0' }],
    whatsapp_numbers: [],
    staff_members: [
      { business_id: A, user_id: 'u1', email: 'owner1@sunrise.test', role: 'owner' }, { business_id: A, user_id: 'u2', email: 'manager1@sunrise.test', role: 'manager' },
      { business_id: A, user_id: 'u3', email: 'agent1@sunrise.test', role: 'agent' }, { business_id: A, user_id: 'u4', email: 'agent2@sunrise.test', role: 'agent' },
    ],
    whatsapp_leads: [
      { business_id: A, phone: RAVI, name: 'Ravi Kumar', assigned_to: null, last_inbound_at: hoursAgo(1), stage: 'new', unread_count: 2 },
      { business_id: A, phone: SITA, name: 'Sita', assigned_to: 'agent2@sunrise.test', last_inbound_at: hoursAgo(1), stage: 'new' },
      { business_id: A, phone: OLD, name: 'Old', assigned_to: null, last_inbound_at: hoursAgo(72), stage: 'new' },
      { business_id: B, phone: RAVI, name: 'Theirs', assigned_to: null, last_inbound_at: hoursAgo(1), stage: 'new' },
    ],
    whatsapp_messages: [
      { business_id: A, contact_phone: RAVI, message_id: 'wamid.IN-PHOTO', type: 'image', direction: 'inbound', body: '📷 Photo', media_id: '880000000001', media_mime: 'image/jpeg', phone_number_id: PNID },
      { business_id: B, contact_phone: RAVI, message_id: 'wamid.THEIRS', type: 'document', direction: 'inbound', body: 'secret.pdf', media_id: '880000000009', media_mime: 'application/pdf' },
    ],
    saved_replies: [], audit_log: [], lead_number_windows: [],
  };
  graph = []; store = []; rt = [];
  flags = { closeColumns: true, mediaUrlHost: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1', mediaSize: 1234 };
  limits.clearCache(); whatsapp.clearCache(); inbox._resetCloseColumns();
}

const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
const STORED = new Map(); // storage objects
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  if (u.startsWith('https://graph.facebook.com/')) {
    const path = u.replace(/^https:\/\/graph\.facebook\.com\/[^/]+\//, '');
    const body = opts.body instanceof FormData ? Object.fromEntries([...opts.body.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : `<file ${v.type} ${v.size}>`])) : (opts.body ? JSON.parse(String(opts.body)) : null);
    graph.push({ method, path, body });
    if (method === 'POST' && path === `${PNID}/media`) return json({ id: '770000000001' });
    if (method === 'POST' && path === `${PNID}/messages`) return json({ messages: [{ id: `wamid.OUT${graph.length}` }] });
    if (method === 'GET' && /^\d+$/.test(path)) return json({ url: flags.mediaUrlHost, mime_type: 'image/jpeg', file_size: flags.mediaSize });
    return json({ success: true });
  }
  if (u.startsWith('https://lookaside.fbsbx.com/') || u.startsWith('https://evil.example/')) { graph.push({ method, path: u, body: null }); return new Response(Buffer.from('jpeg-bytes'), { status: 200 }); }
  if (u === 'http://fake.supabase/realtime/v1/api/broadcast') { rt.push(JSON.parse(String(opts.body)).messages[0]); return json({}, 202); }
  if (u.startsWith('http://fake.supabase/storage/v1/')) {
    const p = u.slice('http://fake.supabase/storage/v1/'.length);
    store.push({ method, path: p });
    if (p.startsWith('object/upload/sign/')) return json({ url: `/object/upload/sign/${p.slice('object/upload/sign/'.length)}?token=up` });
    if (p.startsWith('object/sign/')) return json({ signedURL: `/object/sign/${p.slice('object/sign/'.length)}?token=dl` });
    if (p.startsWith('bucket')) return json({});
    const key = p.replace(/^object\//, '');
    if (method === 'GET') return STORED.has(key) ? new Response(STORED.get(key), { status: 200 }) : json({}, 404);
    if (method === 'POST') { STORED.set(key, Buffer.from('saved')); return json({ Key: key }); }
    return json({});
  }
  if (!u.startsWith('http://fake.supabase/rest/v1/')) return json({}, 503);
  const [path, qs = ''] = u.slice('http://fake.supabase/rest/v1/'.length).split('?');
  const p = [...new URLSearchParams(qs).entries()];
  const body = opts.body ? JSON.parse(String(opts.body)) : null;
  // Before the SQL: asking for the close columns fails, as in Postgres.
  if (!flags.closeColumns && path === 'whatsapp_leads' && (/closed_at|close_note/.test(qs) || /closed_at/.test(String(opts.body || '')))) return json({ message: 'column whatsapp_leads.closed_at does not exist' }, 400);
  const rows = (db[path] ||= []);
  const filt = (r) => p.every(([k, v]) => {
    if (['select', 'order', 'limit', 'on_conflict', 'offset', 'or', 'and'].includes(k)) return true;
    if (v.startsWith('eq.')) return String(r[k]) === v.slice(3);
    if (v === 'is.null') return r[k] === null || r[k] === undefined;
    if (v === 'not.is.null') return r[k] !== null && r[k] !== undefined;
    if (v.startsWith('gt.')) return Number(r[k]) > Number(v.slice(3));
    return true;
  });
  if (method === 'GET') return json(rows.filter(filt));
  if (method === 'POST') {
    if (path.startsWith('rpc/')) return json(null);
    const list = (Array.isArray(body) ? body : [body]).map(x => ({ ...x }));
    if (path === 'saved_replies' && list.some(x => rows.some(r => r.business_id === x.business_id && r.shortcut === x.shortcut))) return json({ code: '23505', message: 'duplicate key' }, 409);
    for (const r of list) { if (path === 'saved_replies') r.id = rows.length + 1; rows.push(r); }
    return json(list, 201);
  }
  if (method === 'PATCH') { const hit = rows.filter(filt); hit.forEach(r => Object.assign(r, body)); return json(hit); }
  if (method === 'DELETE') { const hit = rows.filter(filt); db[path] = rows.filter(r => !hit.includes(r)); return json(hit); }
  return json([]);
};

let server, base;
before(async () => { server = app.listen(0); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
beforeEach(() => { seed(); STORED.clear(); });
function request(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } },
      (res) => { let t = ''; res.on('data', ch => { t += ch; }); res.on('end', () => resolve({ status: res.statusCode, text: t, json: () => (t ? JSON.parse(t) : null) })); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const staff = (n, role, biz = A) => ({ id: `u${n}`, email: `${role}${role === 'agent' ? n - 2 : 1}@sunrise.test`, role, businessId: biz, businessName: 'x' });
_setStaffForToken('ie-owner', staff(1, 'owner'));
_setStaffForToken('ie-manager', staff(2, 'manager'));
_setStaffForToken('ie-agent1', staff(3, 'agent'));
_setStaffForToken('ie-agent2', staff(4, 'agent'));
_setStaffForToken('ie-other', { id: 'ub', email: 'owner@other.test', role: 'owner', businessId: B, businessName: 'y' });
const lead = (phone, biz = A) => db.whatsapp_leads.find(l => l.phone === phone && l.business_id === biz);

// ---- closing chats ---------------------------------------------------------------------------------------------
test('close: a reason is needed; closing claims an unassigned chat; someone else\'s chat can\'t be closed; reopen', async () => {
  assert.match((await request('POST', `/api/inbox/${RAVI}/close`, 'ie-agent1', { reason: 'bored' })).json().error, /Choose why/);
  assert.match((await request('POST', `/api/inbox/${RAVI}/close`, 'ie-agent1', { reason: 'resolved', note: '<b>' })).json().error, /< or >/);
  const r = await request('POST', `/api/inbox/${RAVI}/close`, 'ie-agent1', { reason: 'booked', note: ' Sunday 10 am ' });
  assert.strictEqual(r.status, 200, r.text);
  assert.deepStrictEqual([lead(RAVI).closed_reason, lead(RAVI).closed_by, lead(RAVI).close_note, lead(RAVI).assigned_to, lead(RAVI).unread_count], ['booked', 'agent1@sunrise.test', 'Sunday 10 am', 'agent1@sunrise.test', 0]);
  assert.ok(lead(RAVI).closed_at);
  assert.strictEqual(lead(RAVI, B).closed_at, undefined, 'the other business\'s contact with the same number is untouched');
  assert.strictEqual((await request('POST', `/api/inbox/${SITA}/close`, 'ie-agent1', { reason: 'spam' })).status, 403);
  assert.strictEqual((await request('POST', `/api/inbox/${RAVI}/reopen`, 'ie-agent2', {})).status, 403, 'now agent 1\'s chat');
  assert.strictEqual((await request('POST', `/api/inbox/${RAVI}/reopen`, 'ie-agent1', {})).status, 200);
  assert.strictEqual(lead(RAVI).closed_at, null);
});

test('close: the views hide closed chats except "Closed"; a customer message and a staff reply reopen it', async () => {
  lead(RAVI).closed_at = hoursAgo(1); lead(RAVI).closed_reason = 'resolved';
  const all = (await request('GET', '/api/inbox?filter=all', 'ie-manager')).json().conversations.map(c => c.phone);
  assert.ok(!all.includes(RAVI) && all.includes(SITA));
  assert.deepStrictEqual((await request('GET', '/api/inbox?filter=closed', 'ie-manager')).json().conversations.map(c => c.phone), [RAVI]);
  await inbox.onInbound(A, RAVI, PNID);
  assert.strictEqual(lead(RAVI).closed_at, null, 'reopened by the customer\'s message');
  lead(SITA).closed_at = hoursAgo(1); lead(SITA).closed_reason = 'booked';
  const sent = await request('POST', `/api/inbox/${SITA}/messages`, 'ie-agent2', { text: 'See you on Sunday!' });
  assert.strictEqual(sent.status, 200, sent.text);
  assert.deepStrictEqual([lead(SITA).closed_at, lead(SITA).closed_reason], [null, null], 'reopened by the reply');
});

test('close: before the SQL is run the inbox still works (no close columns asked for again for a while)', async () => {
  flags.closeColumns = false;
  const r = await request('GET', '/api/inbox?filter=all', 'ie-agent1');
  assert.strictEqual(r.status, 200, r.text);
  assert.ok(r.json().conversations.length >= 3);
  assert.strictEqual((await request('GET', `/api/inbox/${RAVI}`, 'ie-agent1')).status, 200);
  assert.match((await request('POST', `/api/inbox/${RAVI}/close`, 'ie-agent1', { reason: 'resolved' })).json().error, /inbox SQL \(20261132\)/);
});

// ---- saved replies ----------------------------------------------------------------------------------------------
test('saved replies: cleaned; everyone lists, only managers / the Business Admin edit; own business only; no duplicates', async () => {
  assert.deepStrictEqual(saved.cleanReply({ shortcut: '/Clinic Timings', title: ' Timings ', body: 'Hi {name}, we open at 9.' }).value, { shortcut: 'clinic-timings', title: 'Timings', body: 'Hi {name}, we open at 9.' });
  assert.match(saved.cleanReply({ shortcut: 'a b!', title: 'x', body: 'y' }).error, /Shortcut/);
  assert.match(saved.cleanReply({ shortcut: 'x', title: 'x', body: '<script>' }).error, /not allowed/);
  assert.strictEqual((await request('POST', '/api/saved-replies', 'ie-agent1', { shortcut: 'hi', title: 'Hi', body: 'Hello' })).status, 403);
  const c = await request('POST', '/api/saved-replies', 'ie-manager', { shortcut: 'timings', title: 'Timings', body: 'Mon–Sat 9 am to 8 pm.' });
  assert.strictEqual(c.status, 200, c.text);
  assert.match((await request('POST', '/api/saved-replies', 'ie-owner', { shortcut: 'timings', title: 'Again', body: 'x' })).json().error, /already a "\/timings"/);
  const list = await request('GET', '/api/saved-replies', 'ie-agent1');
  assert.deepStrictEqual(list.json().replies.map(r => r.shortcut), ['timings']);
  assert.deepStrictEqual((await request('GET', '/api/saved-replies', 'ie-other')).json().replies, [], 'another business sees none of them');
  const id = c.json().reply.id;
  assert.strictEqual((await request('PUT', `/api/saved-replies/${id}`, 'ie-other', { shortcut: 'x', title: 'x', body: 'x' })).status, 404);
  assert.strictEqual((await request('DELETE', `/api/saved-replies/${id}`, 'ie-other')).status, 404);
  assert.strictEqual((await request('PUT', `/api/saved-replies/${id}`, 'ie-manager', { shortcut: 'hours', title: 'Hours', body: 'Mon–Sat 9–8.' })).status, 200);
  assert.strictEqual((await request('DELETE', `/api/saved-replies/${id}`, 'ie-owner')).status, 200);
  assert.deepStrictEqual(db.audit_log.map(a => a.action), ['saved_reply.created', 'saved_reply.updated', 'saved_reply.deleted']);
});

// ---- media ----------------------------------------------------------------------------------------------------
test('media pure: incoming files read from Meta\'s webhook; labels for the list; what may be sent', () => {
  assert.deepStrictEqual(mediaOf({ type: 'document', document: { id: '880000000002', mime_type: 'application/pdf', filename: 'report<1>.pdf', caption: 'My report' } }),
    { id: '880000000002', mime: 'application/pdf', name: 'report1.pdf', caption: 'My report', voice: false });
  assert.strictEqual(mediaOf({ type: 'image', image: { id: '../etc' } }), null);
  assert.strictEqual(describeMessage({ type: 'audio', audio: { id: '880000000003', voice: true } }).text, '🎤 Voice note');
  assert.strictEqual(describeMessage({ type: 'image', image: { id: '880000000004', caption: 'Is this rash serious?' } }).text, 'Is this rash serious?');
  assert.deepStrictEqual(media.checkUpload('application/pdf', 2 * 1024 * 1024), { kind: 'document', ext: 'pdf' });
  assert.match(media.checkUpload('image/png', 6 * 1024 * 1024).error, /up to 5 MB/);
  assert.match(media.checkUpload('application/x-msdownload', 10).error, /Send a photo/);
});

test('media send: a one-time upload into this business\'s folder, then Meta upload + message; window, ownership and own files only', async () => {
  const u = await request('POST', `/api/inbox/${RAVI}/media/upload-url`, 'ie-agent1', { type: 'application/pdf', size: 20000 });
  assert.strictEqual(u.status, 200, u.text);
  assert.match(u.json().path, new RegExp(`^${A}/out/[0-9a-f-]{36}\\.pdf$`));
  STORED.set(`inbox-media/${u.json().path}`, Buffer.from('%PDF-1.4 fake'));
  for (const bad of [`${B}/out/12345678-1234-4234-8234-123456789abc.pdf`, `${A}/in/x.pdf`, `${A}/out/../../x.pdf`]) {
    assert.match((await request('POST', `/api/inbox/${RAVI}/media`, 'ie-agent1', { path: bad })).json().error, /not valid/, bad);
  }
  assert.strictEqual((await request('POST', `/api/inbox/${SITA}/media`, 'ie-agent1', { path: u.json().path })).status, 403, 'someone else\'s chat');
  assert.match((await request('POST', `/api/inbox/${OLD}/media`, 'ie-agent1', { path: u.json().path })).json().error, /24 hours/);
  assert.strictEqual(graph.length, 0, 'nothing went to Meta');
  const r = await request('POST', `/api/inbox/${RAVI}/media`, 'ie-agent1', { path: u.json().path, caption: 'Your lab report', name: 'Lab report.pdf' });
  assert.strictEqual(r.status, 200, r.text);
  assert.deepStrictEqual([graph[0].path, graph[0].body.type, graph[0].body.file], [`${PNID}/media`, 'application/pdf', '<file application/pdf 13>']);
  assert.deepStrictEqual(graph[1].body.document, { id: '770000000001', caption: 'Your lab report', filename: 'Lab report.pdf' });
  const saved = db.whatsapp_messages.at(-1);
  assert.deepStrictEqual([saved.type, saved.media_mime, saved.media_name, saved.media_path, saved.body], ['document', 'application/pdf', 'Lab report.pdf', u.json().path, 'Your lab report']);
  assert.strictEqual(lead(RAVI).assigned_to, 'agent1@sunrise.test', 'sending claims the unassigned chat');
});

test('media open: copied from Meta into private storage the first time, then from the copy; never another business\'s', async () => {
  const theirs = await request('GET', `/api/inbox/${RAVI}/media?id=wamid.THEIRS`, 'ie-owner');
  assert.strictEqual(theirs.status, 404, 'a message of another business');
  const r = await request('GET', `/api/inbox/${RAVI}/media?id=wamid.IN-PHOTO`, 'ie-agent2');
  assert.strictEqual(r.status, 200, r.text);
  assert.match(r.json().url, /\/object\/sign\/inbox-media\/a0000000-0000-4000-8000-000000000001\/in\/[0-9a-f]{40}\.jpg\?token=dl$/);
  assert.match(r.json().downloadUrl, /&download=image$/);
  assert.deepStrictEqual(graph.map(g => g.path), ['880000000001', flags.mediaUrlHost]);
  const row = db.whatsapp_messages.find(m => m.message_id === 'wamid.IN-PHOTO');
  assert.match(row.media_path, /^a0000000-0000-4000-8000-000000000001\/in\//);
  graph = [];
  assert.strictEqual((await request('GET', `/api/inbox/${RAVI}/media?id=wamid.IN-PHOTO`, 'ie-agent1')).status, 200);
  assert.strictEqual(graph.length, 0, 'the second open uses our copy');
  // Meta pointing somewhere unexpected, or a file too big: refused.
  row.media_path = null; flags.mediaUrlHost = 'https://evil.example/x';
  assert.strictEqual((await request('GET', `/api/inbox/${RAVI}/media?id=wamid.IN-PHOTO`, 'ie-agent1')).status, 502);
  flags.mediaUrlHost = 'https://lookaside.fbsbx.com/x'; flags.mediaSize = 40 * 1024 * 1024;
  assert.strictEqual((await request('GET', `/api/inbox/${RAVI}/media?id=wamid.IN-PHOTO`, 'ie-agent1')).status, 413);
});

// ---- alerts ----------------------------------------------------------------------------------------------------
test('alerts: on the business\'s own channel, saying only whose chat it is (no name, number or text)', async () => {
  assert.ok(await alerts.onInbound(A, SITA, false));
  const m = rt.at(-1);
  assert.strictEqual(m.topic, calls.staffChannel(A));
  assert.notStrictEqual(m.topic, calls.staffChannel(B));
  assert.deepStrictEqual([m.event, m.payload.assignedTo, m.payload.newChat], ['inbox_message', 'agent2@sunrise.test', false]);
  assert.deepStrictEqual(Object.keys(m.payload).sort(), ['assignedTo', 'at', 'newChat']);
  assert.doesNotMatch(JSON.stringify(rt), /919000000002|Sita/);
  // A manager hands a chat to agent 1: agent 1 hears it; taking it yourself sends nothing.
  rt = [];
  assert.strictEqual((await request('PATCH', `/api/inbox/${RAVI}`, 'ie-manager', { assignedTo: 'agent1@sunrise.test' })).status, 200);
  assert.deepStrictEqual(rt.map(x => [x.event, x.payload.to]), [['inbox_assigned', 'agent1@sunrise.test']]);
  rt = [];
  await request('PATCH', `/api/inbox/${OLD}`, 'ie-agent2', { assignedTo: 'agent2@sunrise.test' });
  assert.strictEqual(rt.length, 0);
});
