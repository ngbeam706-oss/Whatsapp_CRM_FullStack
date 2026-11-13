// WhatsApp voice calls (Calling API): Meta's "calls" webhook rings only the right business's dashboard;
// staff answer (pre_accept + accept with the browser's SDP), decline (reject) or hang up (terminate);
// lead ownership decides who may answer; each call ends as one line in the chat.
// Fake database + fake Meta + fake Realtime, plus the real migration on PGlite for the database rules.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-000000000002'; // Mayura

process.env.APP_SECRET = 'server_encryption_secret_long_enough';
process.env.SETTINGS_ENCRYPTION_KEY = '';
process.env.VITE_SUPABASE_URL = 'http://fake.supabase';
process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
process.env.WHATSAPP_BUSINESS_ID = 'c0000000-0000-4000-8000-000000000009';

const secrets = require('../server/secrets.cjs');
const app = require('../server/app.cjs');
const whatsapp = require('../server/whatsapp.cjs');
const { _setStaffForToken } = require('../server/auth.cjs');
const waCalls = require('../server/waCalls.cjs');
const calls = require('../server/calls.cjs');
const { freshDb, asUser } = require('./helpers/pgHarness.cjs');

const CUSTOMER = '919381619750';
const CALL = 'wacid.HBgMOTE5MzgxNjE5NzUwFQIAEhggQTE1QkM2RkY=';
const OFFER = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
const ANSWER = 'v=0\r\no=- 3 4 IN IP4 127.0.0.1\r\ns=-\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';

let db, graph, broadcasts, metaFails;
function seed() {
  db = {
    businesses: [{ id: A, name: 'Arogya', status: 'active' }, { id: B, name: 'Mayura', status: 'active' }],
    business_whatsapp: [B, A].map((id, i) => ({
      business_id: id, phone_number: `91900000020${i}`, phone_number_id: `22${i}`, waba_id: `92${i}`, token_last4: '9876',
      access_token_enc: secrets.encrypt(`EAAG-token-${i}-long-enough`), webhook_key: String(i + 1).repeat(32), graph_api_version: 'v26.0',
    })),
    whatsapp_leads: [],
    whatsapp_calls: [],
    whatsapp_messages: [],
    system_events: [],
  };
  graph = []; broadcasts = []; metaFails = new Set();
  whatsapp.clearCache();
}

const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
function matches(row, params) {
  for (const [k, raw] of params) {
    if (['select', 'order', 'limit', 'on_conflict', 'offset'].includes(k)) continue;
    const i = raw.indexOf('.');
    const op = raw.slice(0, i);
    const val = raw.slice(i + 1);
    const v = row[k];
    if (op === 'eq' && String(v) !== val) return false;
    if (op === 'in' && !val.replace(/^\(|\)$/g, '').split(',').includes(String(v))) return false;
    if (op === 'is' && !(val === 'null' ? v == null : String(v) === val)) return false;
    if (op === 'gte' && !(v && v >= val)) return false;
  }
  return true;
}
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  const body = opts.body ? JSON.parse(opts.body) : null;
  if (u.startsWith('https://graph.facebook.com/')) {
    const path = u.replace(/^https:\/\/graph\.facebook\.com\/[^/]+\//, '');
    graph.push({ path, body, token: String(opts.headers?.Authorization || '') });
    if (body?.action && metaFails.has(body.action)) return json({ error: { message: `(#138000) ${body.action} refused`, code: 138000 } }, 400);
    return json({ messaging_product: 'whatsapp', success: true });
  }
  if (u === 'http://fake.supabase/realtime/v1/api/broadcast') { broadcasts.push(...body.messages); return json({}, 202); }
  const [path, qs = ''] = u.slice('http://fake.supabase/rest/v1/'.length).split('?');
  const params = [...new URLSearchParams(qs).entries()];
  if (path.startsWith('rpc/')) return json([]);
  const rows = (db[path] ||= []);
  if (method === 'GET') return json(rows.filter(r => matches(r, params)));
  if (method === 'POST') {
    const list = (Array.isArray(body) ? body : [body]).map(r => ({ ...r }));
    const out = [];
    for (const r of list) {
      if (path === 'whatsapp_calls') {
        if (rows.some(x => x.business_id === r.business_id && x.id === r.id)) continue; // ignore-duplicates
        r.created_at = new Date().toISOString();
      }
      if (path === 'whatsapp_leads') {
        const ex = rows.find(x => x.business_id === r.business_id && x.phone === r.phone);
        if (ex) { Object.assign(ex, r); out.push(ex); continue; }
      }
      rows.push(r); out.push(r);
    }
    return json(out, 201);
  }
  if (method === 'PATCH') { const hit = rows.filter(r => matches(r, params)); hit.forEach(r => Object.assign(r, body)); return json(hit); }
  return json([]);
};

let server, base;
before(async () => {
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
beforeEach(seed);

function request(method, path, { body, token } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
    }, (res) => { let t = ''; res.on('data', c => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, json: () => JSON.parse(t), text: t })); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const staff = (id, biz, role, email) => ({ id: `d0000000-0000-4000-8000-0000000000${id}`, email, role, businessId: biz, businessName: 'x' });
_setStaffForToken('b-agent1', staff('b1', B, 'agent', 'ravi@mayura.test'));
_setStaffForToken('b-agent2', staff('b2', B, 'agent', 'sita@mayura.test'));
_setStaffForToken('a-owner', staff('a1', A, 'owner', 'owner@arogya.test'));

const connect = (biz = B, id = CALL) => waCalls.handleCallEvents(biz, {
  messaging_product: 'whatsapp', metadata: { phone_number_id: '220' }, contacts: [{ profile: { name: 'Lakshmi' }, wa_id: CUSTOMER }],
  calls: [{ id, from: CUSTOMER, to: '919000000200', event: 'connect', direction: 'USER_INITIATED', timestamp: '1731222000', session: { sdp_type: 'offer', sdp: OFFER } }],
}, 'Lakshmi');
const terminate = (extra = {}) => waCalls.handleCallEvents(B, {
  calls: [{ id: CALL, from: CUSTOMER, to: '919000000200', event: 'terminate', direction: 'USER_INITIATED', status: 'Completed', ...extra }],
}, '');
const post = (path, token, body) => request('POST', `/api/wa-calls/${path}`, { token, body });

test('a customer\'s WhatsApp call rings only that business\'s dashboard, once, without the offer', async () => {
  await connect();
  await connect(); // Meta retries the webhook
  assert.strictEqual(db.whatsapp_calls.length, 1);
  const call = db.whatsapp_calls[0];
  assert.deepStrictEqual([call.business_id, call.phone, call.contact_name, call.status, call.offer_sdp], [B, CUSTOMER, 'Lakshmi', 'ringing', OFFER]);
  assert.strictEqual(broadcasts.length, 1);
  assert.strictEqual(broadcasts[0].topic, calls.staffChannel(B));
  assert.notStrictEqual(broadcasts[0].topic, calls.staffChannel(A));
  // numberId: which business number was called (null here: the test's short id "220" isn't a real Meta id).
  assert.deepStrictEqual(broadcasts[0].payload, { callId: CALL, phone: CUSTOMER, name: 'Lakshmi', numberId: null });
  assert.ok(!JSON.stringify(broadcasts).includes('v=0'), 'the WebRTC offer is never broadcast');
  assert.ok(db.whatsapp_leads.some(l => l.business_id === B && l.phone === CUSTOMER), 'the caller is a contact');

  const list = (await request('GET', '/api/wa-calls/ringing', { token: 'b-agent1' })).json();
  assert.deepStrictEqual(list.calls.map(c => c.callId), [CALL]);
  assert.deepStrictEqual((await request('GET', '/api/wa-calls/ringing', { token: 'a-owner' })).json().calls, []);
});

test('answer: claim gives the offer, accept sends pre_accept then accept with the browser\'s answer', async () => {
  await connect();
  const c = await post('claim', 'b-agent1', { callId: CALL });
  assert.strictEqual(c.status, 200, c.text);
  assert.strictEqual(c.json().offer, OFFER);
  assert.strictEqual(db.whatsapp_leads.find(l => l.phone === CUSTOMER).assigned_to, 'ravi@mayura.test', 'answering claims the unassigned chat');
  assert.ok(broadcasts.some(b => b.event === 'wa_call_taken' && b.payload.by === 'ravi@mayura.test'));

  // Meta's order: pre_accept first (call still ringing for the customer) ...
  const a = await post('accept', 'b-agent1', { callId: CALL, sdp: ANSWER });
  assert.strictEqual(a.status, 200, a.text);
  assert.deepStrictEqual(graph.map(g => [g.path, g.body.action, g.body.call_id, g.body.session?.sdp_type, g.body.session?.sdp]),
    [['220/calls', 'pre_accept', CALL, 'answer', ANSWER]]);
  assert.strictEqual(db.whatsapp_calls[0].status, 'answering');
  // ... then accept, with the same answer, once the browser's audio link is up.
  assert.strictEqual((await post('connect', 'b-agent2', { callId: CALL })).status, 403, 'only the person answering');
  const k = await post('connect', 'b-agent1', { callId: CALL });
  assert.strictEqual(k.status, 200, k.text);
  const callActions = graph.filter(g => g.path.endsWith('/calls'));
  assert.deepStrictEqual(callActions.slice(1).map(g => [g.body.action, g.body.session?.sdp]), [['accept', ANSWER]]);
  // The customer is told the call is recorded (best effort).
  const notice = graph.find(g => g.path.endsWith('/messages'));
  assert.strictEqual(notice.body.to, CUSTOMER);
  assert.match(notice.body.text.body, /recorded/);
  assert.match(k.json().notice, /recorded/);
  assert.ok(graph.every(g => g.token.includes('EAAG-token-0')), 'Mayura\'s own token and number');
  assert.strictEqual(db.whatsapp_calls[0].status, 'answered');

  // The customer hangs up: the call is logged in the chat and the dashboard is told.
  db.whatsapp_calls[0].answered_at = new Date(Date.now() - 125000).toISOString();
  await terminate({ duration: 125 });
  const call = db.whatsapp_calls[0];
  assert.deepStrictEqual([call.status, call.duration_sec, call.offer_sdp, call.answer_sdp], ['ended', 125, null, null]);
  assert.match(db.whatsapp_messages.at(-1).body, /WhatsApp call, 2 min 5 s \(answered by ravi@mayura\.test\)/);
  assert.ok(broadcasts.some(b => b.event === 'wa_call_end'));
});

test('two people press Accept: only the first gets the call', async () => {
  await connect();
  const [x, y] = await Promise.all([post('claim', 'b-agent1', { callId: CALL }), post('claim', 'b-agent2', { callId: CALL })]);
  assert.strictEqual([x, y].filter(r => r.status === 200).length, 1, 'exactly one person gets the call');
  assert.ok([x, y].every(r => r.status === 200 || r.status === 403 || r.status === 409));
  // The loser can't send an answer for it either.
  const loser = x.status === 200 ? 'b-agent2' : 'b-agent1';
  assert.strictEqual((await post('accept', loser, { callId: CALL, sdp: ANSWER })).status, 403);
  assert.strictEqual(graph.length, 0);
});

test('a chat assigned to a colleague: others can see the call but not answer or decline it', async () => {
  db.whatsapp_leads.push({ business_id: B, phone: CUSTOMER, name: 'Lakshmi', assigned_to: 'sita@mayura.test' });
  await connect();
  const r = await post('claim', 'b-agent1', { callId: CALL });
  assert.strictEqual(r.status, 403);
  assert.match(r.json().error, /belongs to sita@mayura\.test/);
  assert.strictEqual((await post('hangup', 'b-agent1', { callId: CALL })).status, 403);
  assert.strictEqual((await post('claim', 'b-agent2', { callId: CALL })).status, 200);
});

test('another business can never touch the call', async () => {
  await connect();
  assert.strictEqual((await post('claim', 'a-owner', { callId: CALL })).status, 404);
  assert.strictEqual((await post('hangup', 'a-owner', { callId: CALL })).status, 404);
  assert.strictEqual(db.whatsapp_calls[0].status, 'ringing');
});

test('decline sends reject and logs "declined"; a call nobody answers is logged as missed', async () => {
  await connect();
  const d = await post('hangup', 'b-agent1', { callId: CALL });
  assert.strictEqual(d.status, 200, d.text);
  assert.deepStrictEqual(graph.map(g => g.body.action), ['reject']);
  assert.strictEqual(db.whatsapp_calls[0].status, 'declined');
  assert.match(db.whatsapp_messages.at(-1).body, /declined by ravi@mayura\.test/);

  seed();
  await connect();
  await terminate({ status: 'Failed' });
  assert.strictEqual(db.whatsapp_calls[0].status, 'missed');
  assert.match(db.whatsapp_messages.at(-1).body, /Missed WhatsApp call/);
  assert.strictEqual((await post('claim', 'b-agent1', { callId: CALL })).json().error, 'This call has already ended.');
});

test('staff hang up: terminate is sent; microphone trouble gives the call back to ring for others', async () => {
  await connect();
  await post('claim', 'b-agent1', { callId: CALL });
  const rel = await post('release', 'b-agent1', { callId: CALL });
  assert.strictEqual(rel.status, 200);
  assert.strictEqual(db.whatsapp_calls[0].status, 'ringing');

  await post('claim', 'b-agent1', { callId: CALL });
  await post('accept', 'b-agent1', { callId: CALL, sdp: ANSWER });
  await post('connect', 'b-agent1', { callId: CALL });
  assert.strictEqual((await post('hangup', 'b-agent2', { callId: CALL })).status, 403, 'only the person on the call hangs it up');
  const h = await post('hangup', 'b-agent1', { callId: CALL });
  assert.strictEqual(h.status, 200);
  assert.strictEqual(graph.at(-1).body.action, 'terminate');
  assert.strictEqual(db.whatsapp_calls[0].status, 'ended');
});

test('Meta refusing the answer puts the call back to ringing; bad input is refused', async () => {
  await connect();
  await post('claim', 'b-agent1', { callId: CALL });
  metaFails.add('pre_accept');
  const r = await post('accept', 'b-agent1', { callId: CALL, sdp: ANSWER });
  assert.strictEqual(r.status, 502);
  assert.match(r.json().error, /didn't accept the answer/);
  assert.strictEqual(db.whatsapp_calls[0].status, 'ringing');
  assert.ok(db.system_events.some(e => e.code === 'call_pre_accept_failed'));

  // accept refused after pre_accept worked: the call fails, is logged, and the dashboards are told.
  metaFails.clear();
  await post('claim', 'b-agent1', { callId: CALL });
  await post('accept', 'b-agent1', { callId: CALL, sdp: ANSWER });
  metaFails.add('accept');
  const k = await post('connect', 'b-agent1', { callId: CALL });
  assert.strictEqual(k.status, 502);
  assert.strictEqual(db.whatsapp_calls[0].status, 'failed');
  assert.match(db.whatsapp_messages.at(-1).body, /could not connect/);
  metaFails.clear();
  seed();
  await connect();

  assert.strictEqual((await post('claim', 'b-agent1', { callId: '../../etc' })).status, 400);
  await post('claim', 'b-agent1', { callId: CALL });
  assert.strictEqual((await post('accept', 'b-agent1', { callId: CALL, sdp: 'not sdp' })).status, 400);
  assert.strictEqual((await request('POST', '/api/wa-calls/claim', { body: { callId: CALL } })).status, 401, 'login required');
});

test('a call keeps the contact\'s saved name; a username caller (no "from") is found by wa_id; old calls stop ringing', async () => {
  db.whatsapp_leads.push({ business_id: B, phone: CUSTOMER, name: 'Lakshmi Devi (VIP)', source: 'Instagram Ad' });
  await waCalls.handleCallEvents(B, {
    contacts: [{ wa_id: CUSTOMER }], // no profile name, and no "from" on the call
    calls: [{ id: CALL, to: '919000000200', event: 'connect', direction: 'USER_INITIATED', session: { sdp_type: 'offer', sdp: OFFER } }],
  }, 'WhatsApp User');
  assert.strictEqual(db.whatsapp_calls[0].phone, CUSTOMER);
  await terminate({ status: 'COMPLETED' }); // unanswered calls end as COMPLETED without a duration
  const lead = db.whatsapp_leads.find(l => l.phone === CUSTOMER);
  assert.strictEqual(lead.name, 'Lakshmi Devi (VIP)', 'the saved name is not replaced by "+91…"');
  assert.match(lead.last_message, /Missed WhatsApp call/);
  assert.strictEqual(db.whatsapp_calls[0].status, 'missed');

  seed();
  await connect();
  db.whatsapp_calls[0].created_at = new Date(Date.now() - 61000).toISOString();
  assert.deepStrictEqual((await request('GET', '/api/wa-calls/ringing', { token: 'b-agent1' })).json().calls, []);
  assert.strictEqual((await post('claim', 'b-agent1', { callId: CALL })).json().error, 'This call has already ended.');
});

test('the webhook passes call events to the call handler and skips call statuses', async () => {
  const src = require('fs').readFileSync(require.resolve('../server/webhook.cjs'), 'utf8');
  assert.match(src, /value\.calls/);
  assert.match(src, /status\?\.type === 'call'/);
  assert.strictEqual(waCalls.duration(65), '1 min 5 s');
});

test('migration: whatsapp_calls is server-only and safe to re-run', async () => {
  const pg = await freshDb();
  await pg.exec(require('fs').readFileSync(require('path').join(__dirname, '..', 'supabase', 'migrations', '20261116_whatsapp_calls.sql'), 'utf8'));
  const u = await pg.query("insert into auth.users (email) values ('ravi@mayura.test') returning id");
  await pg.query("insert into public.staff_members (user_id, email, role, business_id) values ($1, 'ravi@mayura.test', 'agent', $2)", [u.rows[0].id, A]);
  await pg.query("insert into public.whatsapp_calls (business_id, id, phone) values ($1, 'wacid.x1', '919000000001')", [A]);
  await assert.rejects(asUser(pg, u.rows[0].id, () => pg.query('select * from public.whatsapp_calls')), /permission denied/);
  await assert.rejects(pg.query("insert into public.whatsapp_calls (business_id, id, phone, status) values ($1, 'wacid.x2', '1', 'weird')", [A]));
});
