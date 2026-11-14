// Several WhatsApp numbers per business, phase N1 (docs/progress/multi-number.md): one chat per customer,
// every message / call records the number it went through, and replies go out from the number the customer
// wrote to. Another business's number is never accepted or used. Fake database + fake Meta, plus the real
// migration on PGlite for the database rules.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const http = require('node:http');

const A = 'a0000000-0000-4000-8000-000000000001'; // one number
const B = 'b0000000-0000-4000-8000-000000000002'; // main number + two extra numbers

process.env.APP_SECRET = 'server_encryption_secret_long_enough';
process.env.SETTINGS_ENCRYPTION_KEY = '';
process.env.ALLOW_UNSIGNED_WEBHOOKS = '';
process.env.WHATSAPP_TOKEN = '';
process.env.PHONE_NUMBER_ID = '';
process.env.VITE_SUPABASE_URL = 'http://fake.supabase';
process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
process.env.WHATSAPP_BUSINESS_ID = 'c0000000-0000-4000-8000-000000000009';

const secrets = require('../server/secrets.cjs');
const app = require('../server/app.cjs');
const whatsapp = require('../server/whatsapp.cjs');
const inbox = require('../server/inbox.cjs');
const waCalls = require('../server/waCalls.cjs');
const { freshDb, asUser } = require('./helpers/pgHarness.cjs');

const CUSTOMER = '919381619750';
const MAIN_B = '222000000000001';   // Mayura reception (main)
const PHARMACY = '222000000000002'; // Mayura pharmacy (extra, shares the main token)
const LAB = '222000000000003';      // Mayura lab (extra, its own token)
const MAIN_A = '111000000000001';
const NEW_NUM = '222000000000004';  // a fourth Mayura number, in the main account
const CLINIC = '555000000000001';   // a Mayura number in another WhatsApp Business Account
const SECRET = { [A]: '0123456789abcdef0123456789abcdef', [B]: 'fedcba9876543210fedcba9876543210' };
const KEY = { [A]: 'a'.repeat(32), [B]: 'b'.repeat(32) };
const TOKEN = { [A]: 'EAAG-token-arogya-long-1111', [B]: 'EAAG-token-mayura-long-2222', lab: 'EAAG-token-lab-own-3333' };

let db, graph;
function seed() {
  db = {
    businesses: [{ id: A, name: 'Arogya', status: 'active', plan_id: 'starter', limit_overrides: {} }, { id: B, name: 'Mayura', status: 'active', plan_id: 'growth', limit_overrides: {} }],
    plans: [{ id: 'starter', name: 'Starter', max_whatsapp_numbers: 1 }, { id: 'growth', name: 'Growth', max_whatsapp_numbers: 5 }],
    audit_log: [],
    business_whatsapp: [[A, MAIN_A, '919000000100'], [B, MAIN_B, '919000000200']].map(([id, pid, num]) => ({
      business_id: id, phone_number: num, phone_number_id: pid, waba_id: `9${pid}`, token_last4: '1234',
      access_token_enc: secrets.encrypt(TOKEN[id]), app_secret_enc: secrets.encrypt(SECRET[id]),
      webhook_key: KEY[id], graph_api_version: 'v26.0',
    })),
    whatsapp_numbers: [
      { business_id: B, phone_number_id: PHARMACY, phone_number: '919000000201', waba_id: `9${MAIN_B}`, label: 'Pharmacy', access_token_enc: null, status: 'active', created_at: '2026-11-10T00:00:00Z' },
      { business_id: B, phone_number_id: LAB, phone_number: '919000000202', waba_id: '977700000000001', label: 'Lab', access_token_enc: secrets.encrypt(TOKEN.lab), status: 'active', created_at: '2026-11-10T00:01:00Z' },
      { business_id: B, phone_number_id: '222000000000009', phone_number: '919000000209', label: 'Old', status: 'disabled', created_at: '2026-11-10T00:02:00Z' },
    ],
    whatsapp_leads: [],
    whatsapp_messages: [],
    whatsapp_calls: [],
    lead_number_windows: [],
    system_events: [],
  };
  graph = [];
  whatsapp.clearCache();
  require('../server/limits.cjs').clearCache();
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
  }
  return true;
}
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  const body = opts.body ? JSON.parse(opts.body) : null;
  if (u.startsWith('https://graph.facebook.com/')) {
    const path = u.replace(/^https:\/\/graph\.facebook\.com\/[^/]+\//, '');
    graph.push({ path, body, token: String(opts.headers?.Authorization || '').replace('Bearer ', ''), method: opts.method || 'GET' });
    if (/\/messages$/.test(path)) return json({ messages: [{ id: `wamid.out.${graph.length}` }] });
    // Meta's view of the accounts: Mayura's main account holds its numbers + a new one; 955... holds the clinic.
    const ACCOUNTS = { [`9${MAIN_B}`]: [MAIN_B, PHARMACY, LAB, NEW_NUM, '222000000000009'], 955500000000001: [CLINIC] };
    const list = path.match(/^(\d+)\/phone_numbers/);
    if (list) return json({ data: (ACCOUNTS[list[1]] || []).map(id => ({ id })) });
    const phone = path.match(/^(\d+)\?fields=display_phone_number/);
    if (phone) return json({ display_phone_number: `+91 90000 ${phone[1].slice(-5)}`, verified_name: 'Mayura' });
    return json({ success: true });
  }
  if (u.includes('/realtime/v1/')) return json({}, 202);
  const [path, qs = ''] = u.slice('http://fake.supabase/rest/v1/'.length).split('?');
  const params = [...new URLSearchParams(qs).entries()];
  if (path === 'rpc/lead_mark_inbound_in_business') {
    db.whatsapp_leads.filter(l => l.business_id === body.p_business && l.phone === body.p_phone)
      .forEach(l => { l.unread_count = (l.unread_count || 0) + 1; l.last_inbound_at = new Date().toISOString(); });
    return json(null);
  }
  if (path === 'rpc/lead_mark_inbound_number') {
    db.whatsapp_leads.filter(l => l.business_id === body.p_business && l.phone === body.p_phone).forEach(l => { l.last_phone_number_id = body.p_number; });
    const w = db.lead_number_windows.find(x => x.business_id === body.p_business && x.phone === body.p_phone && x.phone_number_id === body.p_number);
    if (w) w.last_inbound_at = new Date().toISOString();
    else db.lead_number_windows.push({ business_id: body.p_business, phone: body.p_phone, phone_number_id: body.p_number, last_inbound_at: new Date().toISOString() });
    return json(null);
  }
  if (path === 'rpc/claim_campaign_recipients') { const batch = db._claim || []; db._claim = []; return json(batch); }
  if (path.startsWith('rpc/')) return json([]);
  const rows = (db[path] ||= []);
  if (method === 'GET' && params.some(([k, v]) => k === 'limit' && v === '0')) {
    const n = rows.filter(r => matches(r, params)).length;
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json', 'Content-Range': `*/${n}` } });
  }
  if (method === 'GET') return json(rows.filter(r => matches(r, params)));
  if (method === 'DELETE') { db[path] = rows.filter(r => !matches(r, params)); return json([]); }
  if (method === 'POST') {
    const list = (Array.isArray(body) ? body : [body]).map(r => ({ ...r }));
    const out = [];
    for (const r of list) {
      if (path === 'whatsapp_calls') {
        if (rows.some(x => x.business_id === r.business_id && x.id === r.id)) continue;
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

function post(path, raw, secret) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(raw), 'X-Hub-Signature-256': 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex') },
    }, (res) => { let t = ''; res.on('data', c => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, text: t })); });
    req.on('error', reject);
    req.write(raw);
    req.end();
  });
}
const inbound = (toNumberId, text) => JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [{ changes: [{ value: {
    metadata: { phone_number_id: toNumberId, display_phone_number: '91900' },
    contacts: [{ profile: { name: 'Lakshmi' }, wa_id: CUSTOMER }],
    messages: [{ id: `wamid.in.${Math.random()}`, from: CUSTOMER, type: 'text', text: { body: text }, timestamp: String(Math.floor(Date.now() / 1000)) }],
  } }] }],
});
/** Customer writes `text` to one of Mayura's numbers (via Mayura's one webhook address). */
const write = (toNumberId, text, biz = B) => post(`/webhook/${KEY[biz]}`, inbound(toNumberId, text), SECRET[biz]);
const sends = () => graph.filter(g => /\/messages$/.test(g.path));
const owner = { id: 'u-owner', email: 'admin@mayura.test', role: 'owner', businessId: B };

test('a message to an extra number is stored with that number and answered from it, never from the main number', async () => {
  const r = await write(PHARMACY, 'STOP');
  assert.strictEqual(r.status, 200);
  const msg = db.whatsapp_messages.find(m => m.direction === 'inbound');
  assert.strictEqual(msg.business_id, B);
  assert.strictEqual(msg.phone_number_id, PHARMACY);
  const lead = db.whatsapp_leads.find(l => l.business_id === B && l.phone === CUSTOMER);
  assert.strictEqual(lead.last_phone_number_id, PHARMACY);
  assert.deepStrictEqual(db.lead_number_windows.map(w => [w.business_id, w.phone, w.phone_number_id]), [[B, CUSTOMER, PHARMACY]]);

  // The STOP confirmation goes out from the pharmacy number, with the main token (it has none of its own).
  assert.deepStrictEqual(sends().map(s => [s.path, s.token]), [[`${PHARMACY}/messages`, TOKEN[B]]]);
  const out = db.whatsapp_messages.find(m => m.direction === 'outbound');
  assert.strictEqual(out.phone_number_id, PHARMACY);
  assert.strictEqual(out.sender, '919000000201');
});

test('one chat per customer: writing to another number moves the replies there; staff replies follow', async () => {
  await write(PHARMACY, 'STOP');
  await write(LAB, 'START');
  assert.strictEqual(db.whatsapp_leads.filter(l => l.business_id === B && l.phone === CUSTOMER).length, 1, 'still one contact');
  assert.deepStrictEqual(db.lead_number_windows.map(w => w.phone_number_id).sort(), [PHARMACY, LAB].sort(), 'a window per number');
  // START's welcome-back message goes from the lab number with the lab's own token.
  assert.deepStrictEqual([sends().at(-1).path, sends().at(-1).token], [`${LAB}/messages`, TOKEN.lab]);

  const reply = await inbox.sendText(CUSTOMER, 'Your report is ready.', owner);
  assert.strictEqual(reply.sent, true, JSON.stringify(reply));
  assert.strictEqual(sends().at(-1).path, `${LAB}/messages`);
  assert.strictEqual(sends().at(-1).token, TOKEN.lab);
  assert.strictEqual(db.whatsapp_messages.find(m => m.id === reply.id || m.message_id === reply.id).phone_number_id, LAB);
});

test('a number of another business (or a disabled one) is ignored on this address, even when correctly signed', async () => {
  for (const foreign of [MAIN_A, '222000000000009']) {
    const r = await write(foreign, 'STOP');
    assert.strictEqual(r.status, 200);
  }
  assert.strictEqual(db.whatsapp_messages.length, 0);
  assert.strictEqual(graph.length, 0);
  assert.strictEqual(await whatsapp.ownsNumber(A, PHARMACY), false);
  assert.strictEqual(await whatsapp.connectionForNumber(A, PHARMACY), null, 'never send as another business\'s number');
  assert.strictEqual(await whatsapp.connectionForNumber(B, MAIN_A), null);
});

test('a business with one number keeps working exactly as before (main number)', async () => {
  await write(MAIN_A, 'STOP', A);
  assert.deepStrictEqual(sends().map(s => [s.path, s.token]), [[`${MAIN_A}/messages`, TOKEN[A]]]);
  assert.strictEqual(db.whatsapp_messages.find(m => m.direction === 'inbound').phone_number_id, MAIN_A);

  // Main number for a customer who never wrote to an extra number.
  const wa = await whatsapp.whatsappFor(B, '919999999999');
  assert.strictEqual(wa.phoneNumberId, MAIN_B);
  assert.strictEqual((await whatsapp.getWhatsApp(B)).phoneNumberId, MAIN_B, 'getWhatsApp is still the main number');
});

test('an extra number whose own token cannot be read is never used with another token', async () => {
  db.whatsapp_numbers.find(n => n.phone_number_id === LAB).access_token_enc = 'v1:garbage';
  assert.strictEqual(await whatsapp.connectionForNumber(B, LAB), null);
  db.whatsapp_leads.push({ business_id: B, phone: CUSTOMER, name: 'Lakshmi', last_phone_number_id: LAB, last_inbound_at: new Date().toISOString() });
  // The chat falls back to the main number rather than sending as the lab with a wrong token.
  assert.strictEqual((await whatsapp.whatsappFor(B, CUSTOMER)).phoneNumberId, MAIN_B);
});

test('a WhatsApp call to an extra number is answered through that number', async () => {
  const CALL = 'wacid.HBgMOTE5MzgxNjE5NzUwFQIAEhggQTE1QkM2RkY=';
  const offer = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
  const raw = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'calls', value: {
    metadata: { phone_number_id: PHARMACY }, contacts: [{ profile: { name: 'Lakshmi' }, wa_id: CUSTOMER }],
    calls: [{ id: CALL, event: 'connect', direction: 'USER_INITIATED', from: CUSTOMER, session: { sdp_type: 'offer', sdp: offer } }],
  } }] }] });
  assert.strictEqual((await post(`/webhook/${KEY[B]}`, raw, SECRET[B])).status, 200);
  assert.strictEqual(db.whatsapp_calls[0].phone_number_id, PHARMACY);

  const took = await waCalls.claim(owner, CALL);
  assert.ok(!took.error, JSON.stringify(took));
  const pre = await waCalls.accept(owner, CALL, offer.replace('o=- 1 2', 'o=- 3 4'));
  assert.ok(!pre.error, JSON.stringify(pre));
  assert.deepStrictEqual(graph.filter(g => g.path.endsWith('/calls')).map(g => [g.path, g.body.action]), [[`${PHARMACY}/calls`, 'pre_accept']]);
});

// ---- N2: Inbox (numbers list, filter, per-number windows, "Reply from") -----------------------------------
const { _setStaffForToken } = require('../server/auth.cjs');
function api(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request(`${base}${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
    }, (res) => { let t = ''; res.on('data', c => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, body: t ? JSON.parse(t) : null })); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
_setStaffForToken('mn-agent-b', { id: 'u-agent-b', email: 'ravi@mayura.test', role: 'agent', businessId: B });
_setStaffForToken('mn-agent-a', { id: 'u-agent-a', email: 'sita@arogya.test', role: 'agent', businessId: A });
const hoursAgo = (h) => new Date(Date.now() - h * 3600000).toISOString();

test('N2: staff see their own business\'s numbers (labels only, no tokens), agents included', async () => {
  db.business_whatsapp.find(w => w.business_id === B).label = 'Reception';
  const r = await api('GET', '/api/inbox-numbers', 'mn-agent-b');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.numbers.map(n => [n.id, n.label, n.main]), [[MAIN_B, 'Reception', true], [PHARMACY, 'Pharmacy', false], [LAB, 'Lab', false]]);
  assert.doesNotMatch(JSON.stringify(r.body), /EAAG|token|secret/i);
  const a = await api('GET', '/api/inbox-numbers', 'mn-agent-a');
  assert.deepStrictEqual(a.body.numbers.map(n => n.id), [MAIN_A], 'another business sees only its own number');
});

test('N2: the inbox filters by the number the customer last wrote to (old contacts count as the main number)', async () => {
  db.whatsapp_leads.push(
    { business_id: B, phone: '919000000011', name: 'P', last_phone_number_id: PHARMACY, last_contacted_at: hoursAgo(1) },
    { business_id: B, phone: '919000000012', name: 'L', last_phone_number_id: LAB, last_contacted_at: hoursAgo(2) },
    { business_id: B, phone: '919000000013', name: 'Old', last_phone_number_id: null, last_contacted_at: hoursAgo(3) },
  );
  const urls = [];
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => { urls.push(String(url)); return realFetch(url, opts); };
  try {
    const all = await api('GET', '/api/inbox?filter=all', 'mn-agent-b');
    assert.strictEqual(all.body.conversations.length, 3);
    const pharmacy = await api('GET', `/api/inbox?filter=all&number=${PHARMACY}`, 'mn-agent-b');
    assert.deepStrictEqual(pharmacy.body.conversations.map(c => c.phone), ['919000000011']);
    await api('GET', `/api/inbox?filter=all&number=${MAIN_B}&q=old`, 'mn-agent-b');
  } finally { global.fetch = realFetch; }
  // Main number: contacts with no number recorded count too; with a search both groups must match.
  const mainQuery = decodeURIComponent(urls.filter(u => u.includes('whatsapp_leads?')).at(-1));
  // (The WhatsApp name is searched too once that column exists: SQL 20261138.)
  assert.match(mainQuery, /and=\(or\(name\.ilike\.\*old\*,(wa_name\.ilike\.\*old\*,)?phone\.ilike\.\*old\*\),or\(last_phone_number_id\.eq\.222000000000001,last_phone_number_id\.is\.null\)\)/);
});

test('N2: "Reply from" another number uses THAT number\'s 24-hour window; a foreign number is refused', async () => {
  db.whatsapp_leads.push({ business_id: B, phone: CUSTOMER, name: 'Lakshmi', last_phone_number_id: PHARMACY, last_inbound_at: hoursAgo(1) });
  db.lead_number_windows.push(
    { business_id: B, phone: CUSTOMER, phone_number_id: PHARMACY, last_inbound_at: hoursAgo(1) },
    { business_id: B, phone: CUSTOMER, phone_number_id: LAB, last_inbound_at: hoursAgo(30) },
  );
  const convo = await api('GET', `/api/inbox/${CUSTOMER}`, 'mn-agent-b');
  assert.deepStrictEqual(convo.body.contact.windows.map(w => [w.numberId, w.open]).sort(), [[PHARMACY, true], [LAB, false]]);

  // Default: from the pharmacy (they wrote there an hour ago).
  const ok = await api('POST', `/api/inbox/${CUSTOMER}/messages`, 'mn-agent-b', { text: 'Hello' });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
  assert.strictEqual(sends().at(-1).path, `${PHARMACY}/messages`);
  // Lab: their last message there is 30 hours old -> template only.
  const lab = await api('POST', `/api/inbox/${CUSTOMER}/messages`, 'mn-agent-b', { text: 'Hello', fromNumberId: LAB });
  assert.strictEqual(lab.status, 400);
  assert.strictEqual(lab.body.windowClosed, true);
  // Main number: never written to -> template only.
  const main = await api('POST', `/api/inbox/${CUSTOMER}/messages`, 'mn-agent-b', { text: 'Hello', fromNumberId: MAIN_B });
  assert.strictEqual(main.body.windowClosed, true);
  // Pharmacy explicitly: allowed, sent from it.
  const ph = await api('POST', `/api/inbox/${CUSTOMER}/messages`, 'mn-agent-b', { text: 'Hi again', fromNumberId: PHARMACY });
  assert.strictEqual(ph.status, 200);
  assert.strictEqual(sends().at(-1).path, `${PHARMACY}/messages`);
  // Another business's number, or a malformed id: refused before anything is sent.
  const before = sends().length;
  const foreign = await api('POST', `/api/inbox/${CUSTOMER}/messages`, 'mn-agent-b', { text: 'x', fromNumberId: MAIN_A });
  assert.strictEqual(foreign.status, 400);
  assert.match(foreign.body.error, /isn't connected to this business/);
  assert.strictEqual((await api('POST', `/api/inbox/${CUSTOMER}/messages`, 'mn-agent-b', { text: 'x', fromNumberId: 'abc' })).status, 400);
  assert.strictEqual((await api('GET', `/api/templates?number=${MAIN_A}`, 'mn-agent-b')).status, 400, 'no templates of another business\'s account');
  assert.strictEqual(sends().length, before);
});

test('N2: a template from a chosen number is sent from it, using that number\'s account', async () => {
  db.whatsapp_leads.push({ business_id: B, phone: CUSTOMER, name: 'Lakshmi', last_phone_number_id: PHARMACY, last_inbound_at: hoursAgo(1) });
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    if (String(url).includes('/message_templates')) {
      graph.push({ path: String(url).replace(/^https:\/\/graph\.facebook\.com\/[^/]+\//, '').split('?')[0], token: String(opts?.headers?.Authorization || '').replace('Bearer ', '') });
      return json({ data: [{ name: 'report_ready', language: 'en', status: 'APPROVED', category: 'UTILITY', components: [{ type: 'BODY', text: 'Your report is ready.' }] }] });
    }
    return realFetch(url, opts);
  };
  try {
    const r = await api('POST', `/api/inbox/${CUSTOMER}/template`, 'mn-agent-b', { templateName: 'report_ready', language: 'en', fromNumberId: LAB });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  } finally { global.fetch = realFetch; }
  const lookup = graph.find(g => g.path.endsWith('/message_templates'));
  assert.strictEqual(lookup.path, '977700000000001/message_templates', 'the lab\'s own WhatsApp account');
  assert.strictEqual(lookup.token, TOKEN.lab);
  assert.deepStrictEqual([sends().at(-1).path, sends().at(-1).token], [`${LAB}/messages`, TOKEN.lab]);
});

// ---- N3: manage numbers on the WhatsApp page (Business Admin), plan limit, platform counts -------------
_setStaffForToken('mn-owner-b', { id: 'u-owner-b', email: 'admin@mayura.test', role: 'owner', businessId: B });
_setStaffForToken('mn-manager-b', { id: 'u-manager-b', email: 'lead@mayura.test', role: 'manager', businessId: B });
_setStaffForToken('mn-owner-a', { id: 'u-owner-a', email: 'admin@arogya.test', role: 'owner', businessId: A });

test('N3: only the Business Admin adds numbers; managers see the list; agents see nothing', async () => {
  const list = await api('GET', '/api/whatsapp/numbers', 'mn-manager-b');
  assert.strictEqual(list.status, 200);
  assert.strictEqual(list.body.main.id, MAIN_B);
  assert.deepStrictEqual(list.body.numbers.map(n => [n.id, n.status, n.ownToken]), [[PHARMACY, 'active', false], [LAB, 'active', true], ['222000000000009', 'disabled', false]]);
  assert.deepStrictEqual([list.body.used, list.body.limit], [3, 5]);
  assert.doesNotMatch(JSON.stringify(list.body), /EAAG|access_token_enc|v1:/);
  assert.strictEqual((await api('GET', '/api/whatsapp/numbers', 'mn-agent-b')).status, 403);
  for (const token of ['mn-manager-b', 'mn-agent-b']) {
    assert.strictEqual((await api('POST', '/api/whatsapp/numbers', token, { label: 'X', phoneNumberId: NEW_NUM })).status, 403);
    assert.strictEqual((await api('PATCH', `/api/whatsapp/numbers/${PHARMACY}`, token, { label: 'X' })).status, 403);
    assert.strictEqual((await api('DELETE', `/api/whatsapp/numbers/${PHARMACY}`, token)).status, 403);
  }
  assert.strictEqual(db.whatsapp_numbers.length, 3);
});

test('N3: adding a number checks it with Meta, uses the main token unless one is given, and stores a token encrypted', async () => {
  const r = await api('POST', '/api/whatsapp/numbers', 'mn-owner-b', { label: '  Branch   2 ', phoneNumberId: NEW_NUM });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const row = db.whatsapp_numbers.find(n => n.phone_number_id === NEW_NUM);
  assert.deepStrictEqual([row.business_id, row.label, row.status, row.waba_id, row.access_token_enc, row.phone_number], [B, 'Branch 2', 'active', `9${MAIN_B}`, null, '919000000004']);
  assert.ok(graph.some(g => g.path.startsWith(`9${MAIN_B}/phone_numbers`) && g.token === TOKEN[B]), 'checked with Meta using the main token');
  assert.ok(db.audit_log.some(a => a.action === 'whatsapp.number_added' && a.business_id === B));
  // Customers can now write to it at once (cache cleared).
  assert.strictEqual(await whatsapp.ownsNumber(B, NEW_NUM), true);

  // A number in another account with its own token: the token is stored encrypted, the app is subscribed.
  const own = 'EAAG-clinic-own-token-5555';
  const c = await api('POST', '/api/whatsapp/numbers', 'mn-owner-b', { label: 'Clinic', phoneNumberId: CLINIC, wabaId: '955500000000001', accessToken: own });
  assert.strictEqual(c.status, 200, JSON.stringify(c.body));
  const clinic = db.whatsapp_numbers.find(n => n.phone_number_id === CLINIC);
  assert.notStrictEqual(clinic.access_token_enc, own);
  assert.strictEqual(secrets.decrypt(clinic.access_token_enc), own);
  assert.strictEqual(clinic.token_last4, '5555');
  assert.ok(graph.some(g => g.path === '955500000000001/subscribed_apps' && g.method === 'POST' && g.token === own));
  assert.doesNotMatch(JSON.stringify(db.audit_log), /EAAG/);
});

test('N3: wrong account, a number already connected anywhere, the main number, or bad input are refused', async () => {
  const wrongAccount = await api('POST', '/api/whatsapp/numbers', 'mn-owner-b', { label: 'Clinic', phoneNumberId: CLINIC });
  assert.strictEqual(wrongAccount.status, 400);
  assert.match(wrongAccount.body.error, /not in this WhatsApp Business Account.*paste a token/s);
  for (const [phoneNumberId, re] of [[MAIN_A, /another business/], [MAIN_B, /already your main number/], [PHARMACY, /already added/]]) {
    const r = await api('POST', '/api/whatsapp/numbers', 'mn-owner-b', { label: 'X', phoneNumberId });
    assert.strictEqual(r.status, 400);
    assert.match(r.body.error, re);
  }
  db.whatsapp_numbers.push({ business_id: A, phone_number_id: '111000000000002', label: 'Arogya 2', status: 'disabled' });
  assert.match((await api('POST', '/api/whatsapp/numbers', 'mn-owner-b', { label: 'X', phoneNumberId: '111000000000002' })).body.error, /another business/, 'even another business\'s REMOVED number');
  assert.strictEqual((await api('POST', '/api/whatsapp/numbers', 'mn-owner-b', { label: '', phoneNumberId: NEW_NUM })).status, 400);
  assert.strictEqual((await api('POST', '/api/whatsapp/numbers', 'mn-owner-b', { label: 'X', phoneNumberId: '12ab' })).status, 400);
  assert.strictEqual((await api('POST', '/api/whatsapp/numbers', 'mn-owner-b', { label: 'x'.repeat(41), phoneNumberId: NEW_NUM })).status, 400);
  assert.strictEqual(db.whatsapp_numbers.filter(n => n.business_id === B).length, 3, 'nothing saved');
});

test('N3: the plan limit counts the main number and active extras; overrides and unlimited work', async () => {
  // Arogya on Starter (1 number): its main number already uses it.
  db.whatsapp_leads.length = 0;
  const a = await api('POST', '/api/whatsapp/numbers', 'mn-owner-a', { label: 'Second', phoneNumberId: '111000000000005' });
  assert.strictEqual(a.status, 400);
  assert.match(a.body.error, /Starter plan allows 1 WhatsApp number, and you have 1/);
  assert.strictEqual(a.body.limitReached, true);
  assert.ok(!graph.some(g => g.path.includes('111000000000005')), 'not even sent to Meta');

  // Mayura on Growth (5): main + 2 active = 3 -> two more fit, the third doesn't.
  db.plans.find(p => p.id === 'growth').max_whatsapp_numbers = 4;
  require('../server/limits.cjs').clearCache();
  assert.strictEqual((await api('POST', '/api/whatsapp/numbers', 'mn-owner-b', { label: 'Branch', phoneNumberId: NEW_NUM })).status, 200);
  const over = await api('POST', '/api/whatsapp/numbers', 'mn-owner-b', { label: 'Old', phoneNumberId: '222000000000009' });
  assert.match(over.body.error, /Growth plan allows 4 WhatsApp numbers, and you have 4/);
  // A per-business override (null = unlimited) lifts it.
  db.businesses.find(b => b.id === B).limit_overrides = { max_whatsapp_numbers: null };
  require('../server/limits.cjs').clearCache();
  assert.strictEqual((await api('POST', '/api/whatsapp/numbers', 'mn-owner-b', { label: 'Old', phoneNumberId: '222000000000009' })).status, 200);
});

test('N3: remove keeps history and stops the number; adding it again brings it back; rename main and extras', async () => {
  const rm = await api('DELETE', `/api/whatsapp/numbers/${LAB}`, 'mn-owner-b');
  assert.strictEqual(rm.status, 200);
  assert.strictEqual(db.whatsapp_numbers.find(n => n.phone_number_id === LAB).status, 'disabled');
  // Customers writing to it are no longer received or answered here.
  await write(LAB, 'STOP');
  assert.strictEqual(db.whatsapp_messages.length, 0);
  assert.strictEqual(graph.filter(g => /\/messages$/.test(g.path)).length, 0);
  assert.strictEqual(await whatsapp.connectionForNumber(B, LAB), null);
  assert.strictEqual((await api('DELETE', `/api/whatsapp/numbers/${LAB}`, 'mn-owner-b')).status, 404, 'already removed');
  assert.strictEqual((await api('DELETE', `/api/whatsapp/numbers/${MAIN_B}`, 'mn-owner-b')).status, 400, 'main number can\'t be removed');
  assert.strictEqual((await api('DELETE', `/api/whatsapp/numbers/${PHARMACY}`, 'mn-owner-a')).status, 404, 'another business can\'t remove it');
  assert.strictEqual(db.whatsapp_numbers.find(n => n.phone_number_id === PHARMACY).status, 'active');

  // Back again (same row, its old token replaced by "use the main token").
  const back = await api('POST', '/api/whatsapp/numbers', 'mn-owner-b', { label: 'Lab', phoneNumberId: LAB });
  assert.strictEqual(back.status, 200, JSON.stringify(back.body));
  assert.strictEqual(db.whatsapp_numbers.filter(n => n.phone_number_id === LAB).length, 1);
  assert.strictEqual(db.whatsapp_numbers.find(n => n.phone_number_id === LAB).status, 'active');

  assert.strictEqual((await api('PATCH', `/api/whatsapp/numbers/${MAIN_B}`, 'mn-owner-b', { label: 'Reception' })).status, 200);
  assert.strictEqual(db.business_whatsapp.find(w => w.business_id === B).label, 'Reception');
  assert.strictEqual((await api('PATCH', `/api/whatsapp/numbers/${PHARMACY}`, 'mn-owner-b', { label: 'Medicines' })).status, 200);
  const shownToInbox = await api('GET', '/api/inbox-numbers', 'mn-agent-b');
  assert.deepStrictEqual(shownToInbox.body.numbers.slice(0, 2).map(n => n.label), ['Reception', 'Medicines'], 'the inbox sees new names at once');
  assert.strictEqual((await api('PATCH', `/api/whatsapp/numbers/${PHARMACY}`, 'mn-owner-a', { label: 'Mine now' })).status, 404);
  assert.strictEqual(db.whatsapp_numbers.find(n => n.phone_number_id === PHARMACY).label, 'Medicines');
});

test('N3: the Platform Admin sees how many numbers each business has (a count, nothing else) and can set the limit', async () => {
  const { _setPlatformAdminForToken } = require('../server/platform.cjs');
  _setPlatformAdminForToken('mn-platform', { id: 'p1', email: 'root@platform.test' });
  const r = await api('GET', '/api/platform/overview', 'mn-platform');
  assert.strictEqual(r.status, 200);
  const byId = Object.fromEntries(r.body.businesses.map(b => [b.id, b]));
  assert.strictEqual(byId[B].whatsapp.numbers, 3, 'main + 2 active (the removed one is not counted)');
  assert.strictEqual(byId[A].whatsapp.numbers, 1);
  assert.strictEqual(byId[B].limits.max_whatsapp_numbers, 5);
  assert.doesNotMatch(JSON.stringify(r.body), /Pharmacy|Lab|222000000000002/);
  const set = await api('PATCH', `/api/platform/businesses/${B}`, 'mn-platform', { limitOverrides: { max_whatsapp_numbers: 2 } });
  assert.strictEqual(set.status, 200, JSON.stringify(set.body));
  assert.deepStrictEqual(db.businesses.find(b => b.id === B).limit_overrides, { max_whatsapp_numbers: 2 });
});

test('migration N3: plan limits start at Starter 1 / Growth 2 / Pro 5, and a re-run keeps console changes', async () => {
  const pg = await freshDb();
  const read = async () => Object.fromEntries((await pg.query('select id, max_whatsapp_numbers from public.plans')).rows.map(r => [r.id, r.max_whatsapp_numbers]));
  assert.deepStrictEqual(await read(), { starter: 1, growth: 2, pro: 5 });
  await pg.query("update public.plans set max_whatsapp_numbers = null where id = 'pro'");
  await pg.query("update public.plans set max_whatsapp_numbers = 3 where id = 'growth'");
  await pg.exec(require('fs').readFileSync(require('path').join(__dirname, '..', 'supabase', 'migrations', '20261123_multi_number_n3.sql'), 'utf8'));
  assert.deepStrictEqual(await read(), { starter: 1, growth: 3, pro: null });
  await assert.rejects(pg.query("update public.plans set max_whatsapp_numbers = -1 where id = 'starter'"), /check/);
});

// ---- N4: the rest follows the number --------------------------------------------------------------------
const CAMPAIGN = 'c4000000-0000-4000-8000-000000000001';
const templateFetch = (realFetch, seen) => async (url, opts) => {
  if (String(url).includes('/message_templates')) {
    seen.push({ path: String(url).replace(/^https:\/\/graph\.facebook\.com\/[^/]+\//, '').split('?')[0], token: String(opts?.headers?.Authorization || '').replace('Bearer ', '') });
    return json({ data: [{ name: 'offer', language: 'en', status: 'APPROVED', category: 'MARKETING', components: [{ type: 'BODY', text: 'Our offer is here.' }] }] });
  }
  return realFetch(url, opts);
};

test('N4 broadcasts: a campaign sent from an extra number goes out from it; a removed or foreign number never sends', async () => {
  const queue = (campaignNumber) => {
    db.campaigns = [{ id: CAMPAIGN, business_id: B, name: 'Lab offer', status: 'sending', template_name: 'offer', template_language: 'en', variables: { header: [], body: [], headerMediaUrl: '', needs: { headerVars: [], bodyVars: [], headerFormat: null } }, phone_number_id: campaignNumber }];
    db.campaign_recipients = [{ id: 1, campaign_id: CAMPAIGN, business_id: B, phone: CUSTOMER, name: 'Lakshmi', status: 'sending', attempts: 0 }];
    db._claim = [{ id: 1, campaign_id: CAMPAIGN, business_id: B, phone: CUSTOMER, name: 'Lakshmi', attempts: 0 }];
  };
  const campaigns = require('../server/campaigns.cjs');
  queue(LAB);
  await campaigns.processBatches({ deadlineMs: 6000 });
  assert.deepStrictEqual([sends().at(-1).path, sends().at(-1).token], [`${LAB}/messages`, TOKEN.lab]);
  assert.strictEqual(db.campaign_recipients[0].status, 'sent');
  assert.strictEqual(db.whatsapp_messages.at(-1).phone_number_id, LAB);

  // No number chosen = the main number, as before.
  queue(null);
  await campaigns.processBatches({ deadlineMs: 6000 });
  assert.strictEqual(sends().at(-1).path, `${MAIN_B}/messages`);

  // The number was removed meanwhile, or (tampered row) belongs to another business: the message fails, nothing sent.
  for (const n of [MAIN_A, '222000000000009']) {
    const before = sends().length;
    queue(n);
    await campaigns.processBatches({ deadlineMs: 6000 });
    assert.strictEqual(sends().length, before);
    assert.strictEqual(db.campaign_recipients[0].status, 'failed');
  }
});

test('N4 broadcasts: creating or testing uses the chosen number\'s account; another business\'s number is refused', async () => {
  const campaigns = require('../server/campaigns.cjs');
  const seen = [];
  const realFetch = global.fetch;
  global.fetch = templateFetch(realFetch, seen);
  try {
    const t = await campaigns.sendTest(B, { to: CUSTOMER, templateName: 'offer', language: 'en', variables: {}, fromNumberId: LAB });
    assert.strictEqual(t.sent, true, JSON.stringify(t));
    assert.deepStrictEqual(seen.at(-1), { path: '977700000000001/message_templates', token: TOKEN.lab });
    assert.strictEqual(sends().at(-1).path, `${LAB}/messages`);

    db.whatsapp_leads.push({ business_id: B, phone: CUSTOMER, name: 'Lakshmi', opted_out: false, last_contacted_at: hoursAgo(1) });
    const owner = { id: 'u-owner-b', email: 'admin@mayura.test', role: 'owner', businessId: B };
    const c = await campaigns.createCampaign(owner, { name: 'Lab', templateName: 'offer', language: 'en', segment: { mode: 'list', phones: CUSTOMER }, fromNumberId: LAB });
    assert.ok(!c.error, JSON.stringify(c));
    assert.strictEqual(db.campaigns.at(-1).phone_number_id, LAB);
    const mainOne = await campaigns.createCampaign(owner, { name: 'Main', templateName: 'offer', language: 'en', segment: { mode: 'list', phones: CUSTOMER } });
    assert.ok(!mainOne.error, JSON.stringify(mainOne));
    assert.strictEqual(db.campaigns.at(-1).phone_number_id, undefined, 'main number stored as before (no column needed)');

    const before = db.campaigns.length;
    for (const fromNumberId of [MAIN_A, 'abc']) {
      assert.match((await campaigns.createCampaign(owner, { name: 'X', templateName: 'offer', language: 'en', segment: { mode: 'list', phones: CUSTOMER }, fromNumberId })).error, /isn't connected|Choose one/);
      assert.match((await campaigns.sendTest(B, { to: CUSTOMER, templateName: 'offer', language: 'en', fromNumberId })).error, /isn't connected|Choose one/);
    }
    assert.strictEqual(db.campaigns.length, before);
  } finally { global.fetch = realFetch; }
});

test('N4 follow-ups: from the number the customer last wrote to when it shares the main account, else the main number', async () => {
  const { followUpNumber } = require('../server/automations.cjs');
  db.whatsapp_leads.push({ business_id: B, phone: CUSTOMER, name: 'Lakshmi', last_phone_number_id: PHARMACY });
  assert.strictEqual((await followUpNumber(B, CUSTOMER)).phoneNumberId, PHARMACY, 'same account: their number');
  db.whatsapp_leads[0].last_phone_number_id = LAB; // the lab is in another WhatsApp account (no such template there)
  whatsapp.clearCache();
  assert.strictEqual((await followUpNumber(B, CUSTOMER)).phoneNumberId, MAIN_B);
  assert.strictEqual((await followUpNumber(B, '919999999999')).phoneNumberId, MAIN_B, 'never wrote to an extra number');
  db.businesses.find(b => b.id === B).status = 'suspended';
  whatsapp.clearCache();
  assert.strictEqual(await followUpNumber(B, CUSTOMER), null);
});

test('N4 bot: an extra number greets in its own words; the claim check and the main number are respected', async () => {
  const set = (body) => api('PATCH', `/api/whatsapp/numbers/${PHARMACY}`, 'mn-owner-b', body);
  assert.strictEqual((await set({ welcomeMessage: 'Welcome to Mayura Pharmacy! 💊 How can we help?' })).status, 200);
  assert.strictEqual(db.whatsapp_numbers.find(n => n.phone_number_id === PHARMACY).welcome_message, 'Welcome to Mayura Pharmacy! 💊 How can we help?');
  const claim = await set({ welcomeMessage: 'Our tablets cure diabetes, guaranteed!' });
  assert.strictEqual(claim.status, 400);
  assert.match(claim.body.error, /can't be saved/);
  assert.strictEqual((await api('PATCH', `/api/whatsapp/numbers/${MAIN_B}`, 'mn-owner-b', { welcomeMessage: 'x' })).status, 400, 'main number: Bot Flow page');
  assert.strictEqual((await api('PATCH', `/api/whatsapp/numbers/${PHARMACY}`, 'mn-manager-b', { welcomeMessage: 'x' })).status, 403);
  assert.strictEqual((await set({ welcomeMessage: 'x'.repeat(1025) })).status, 400);

  await write(PHARMACY, 'hi');
  const greet = sends().at(-1);
  assert.strictEqual(greet.path, `${PHARMACY}/messages`);
  assert.strictEqual(greet.body.interactive?.body?.text, 'Welcome to Mayura Pharmacy! 💊 How can we help?');

  // The main number keeps the Bot Flow's welcome.
  await post(`/webhook/${KEY[B]}`, inbound(MAIN_B, 'hello').replace(CUSTOMER, '919000000077').replace(CUSTOMER, '919000000077'), SECRET[B]);
  const mainGreet = sends().at(-1);
  assert.strictEqual(mainGreet.path, `${MAIN_B}/messages`);
  assert.notStrictEqual(mainGreet.body.interactive?.body?.text, 'Welcome to Mayura Pharmacy! 💊 How can we help?');

  // Cleared: back to the Bot Flow's welcome.
  assert.strictEqual((await set({ welcomeMessage: null })).status, 200);
  assert.strictEqual(db.whatsapp_numbers.find(n => n.phone_number_id === PHARMACY).welcome_message, null);
});

test('N4 calls: the ringing card is told which number was called', async () => {
  db.whatsapp_calls.push({ business_id: B, id: 'wacid.N4TESTCALL', phone: CUSTOMER, contact_name: 'Lakshmi', status: 'ringing', created_at: new Date().toISOString(), phone_number_id: PHARMACY });
  const r = await api('GET', '/api/wa-calls/ringing', 'mn-agent-b');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.calls.map(c => [c.callId, c.numberId]), [['wacid.N4TESTCALL', PHARMACY]]);
});

test('N4 ads: the ad opens whichever of the business\'s numbers the Page is linked to', () => {
  const { matchNumber, buildChecklist } = require('../server/adCreate.cjs');
  const numbers = [{ phone: '919000000200', label: 'Reception', main: true }, { phone: '919000000201', label: 'Pharmacy', main: false }];
  assert.strictEqual(matchNumber('+91 90000 00201', numbers).label, 'Pharmacy');
  assert.strictEqual(matchNumber('+91 90000 00299', numbers), null);
  assert.strictEqual(matchNumber(null, numbers), null);
  const base = { permissions: [], accountStatus: 1, minDailyBudget: 96, pages: [{ id: '5', name: 'P' }], selectedPageId: '5', businessNumber: '919000000200', currency: 'INR', numbers };
  const ok = buildChecklist({ ...base, pageWhatsApp: '+91 90000 00201' }).find(c => c.key === 'whatsapp');
  assert.strictEqual(ok.ok, true);
  assert.match(ok.detail, /Pharmacy.*open a chat with this number/);
  const bad = buildChecklist({ ...base, pageWhatsApp: '+91 90000 00299' }).find(c => c.key === 'whatsapp');
  assert.strictEqual(bad.ok, null, 'warning: Meta only reports the primary number');
  assert.match(bad.fix.join(' '), /\+919000000200 \(Reception\), \+919000000201 \(Pharmacy\)/);
  // One number: same rule, single-number wording.
  const one = buildChecklist({ ...base, numbers: undefined, pageWhatsApp: '+91 90000 00201' }).find(c => c.key === 'whatsapp');
  assert.strictEqual(one.ok, null);
  assert.match(one.detail, /isn't this business's number \(\+919000000200\)/);
});

test('N4 analytics: activity per number; older messages without a number count for the main number', () => {
  const { byNumber } = require('../server/analytics.cjs');
  const rows = byNumber([
    { direction: 'inbound', contact_phone: '1', phone_number_id: PHARMACY },
    { direction: 'inbound', contact_phone: '1', phone_number_id: PHARMACY },
    { direction: 'inbound', contact_phone: '2', phone_number_id: PHARMACY },
    { direction: 'outbound', contact_phone: '2', phone_number_id: PHARMACY },
    { direction: 'inbound', contact_phone: '3', phone_number_id: null },
    { direction: 'outbound', contact_phone: '3' },
  ]);
  assert.deepStrictEqual(rows, [
    { numberId: PHARMACY, customerMessages: 3, repliesSent: 1, activeChats: 2 },
    { numberId: null, customerMessages: 1, repliesSent: 1, activeChats: 1 },
  ]);
});

test('migration N4: campaign sender and per-number welcome columns, checked and safe to re-run', async () => {
  const pg = await freshDb();
  await pg.exec(require('fs').readFileSync(require('path').join(__dirname, '..', 'supabase', 'migrations', '20261124_multi_number_n4.sql'), 'utf8'));
  await pg.query("insert into public.businesses (id, name, slug) values ($1, 'Mayura', 'n4-mayura') on conflict do nothing", [B]);
  await pg.query("insert into public.whatsapp_numbers (business_id, phone_number_id, label, welcome_message) values ($1, $2, 'Pharmacy', 'Hi')", [B, PHARMACY]);
  await assert.rejects(pg.query('update public.whatsapp_numbers set welcome_message = $1', ['x'.repeat(1025)]), /check/);
  const cols = await pg.query("select column_name from information_schema.columns where table_name = 'campaigns' and column_name = 'phone_number_id'");
  assert.strictEqual(cols.rows.length, 1);
});

test('migration: numbers are server-only, can\'t be connected twice, windows per number, safe to re-run', async () => {
  const pg = await freshDb();
  const sql = require('fs').readFileSync(require('path').join(__dirname, '..', 'supabase', 'migrations', '20261122_multi_number_n1.sql'), 'utf8');
  await pg.query("insert into public.businesses (id, name, slug) values ($1, 'Arogya', 'n1-arogya'), ($2, 'Mayura', 'n1-mayura') on conflict do nothing", [A, B]);
  await pg.query("insert into public.business_whatsapp (business_id, phone_number_id) values ($1, $2), ($3, $4)", [A, MAIN_A, B, MAIN_B]);
  await pg.query("insert into public.whatsapp_leads (business_id, phone, name, last_inbound_at) values ($1, $2, 'Lakshmi', now())", [B, CUSTOMER]);
  await pg.query("insert into public.whatsapp_messages (business_id, message_id, direction, body) values ($1, 'wamid.old', 'inbound', 'hi')", [B]);
  await pg.exec(sql); // re-run on top of the run done by freshDb: backfills what was added since
  await pg.exec(sql);

  const msg = await pg.query("select phone_number_id from public.whatsapp_messages where message_id = 'wamid.old'");
  assert.strictEqual(msg.rows[0].phone_number_id, MAIN_B, 'old history belongs to the main number');
  const win = await pg.query('select phone_number_id from public.lead_number_windows where business_id = $1 and phone = $2', [B, CUSTOMER]);
  assert.deepStrictEqual(win.rows.map(r => r.phone_number_id), [MAIN_B]);

  await pg.query("insert into public.whatsapp_numbers (business_id, phone_number_id, label) values ($1, $2, 'Pharmacy')", [B, PHARMACY]);
  await assert.rejects(pg.query("insert into public.whatsapp_numbers (business_id, phone_number_id) values ($1, $2)", [B, MAIN_A]), /already connected as a main number/);
  await assert.rejects(pg.query("insert into public.whatsapp_numbers (business_id, phone_number_id) values ($1, $2)", [A, PHARMACY]), /duplicate key|unique/);
  await assert.rejects(pg.query('update public.business_whatsapp set phone_number_id = $1 where business_id = $2', [PHARMACY, A]), /already connected as an extra number/);
  await assert.rejects(pg.query("insert into public.whatsapp_numbers (business_id, phone_number_id) values ($1, 'abc')", [B]), /check/);

  await pg.query('select public.lead_mark_inbound_number($1, $2, $3)', [B, CUSTOMER, PHARMACY]);
  const lead = await pg.query('select last_phone_number_id from public.whatsapp_leads where business_id = $1 and phone = $2', [B, CUSTOMER]);
  assert.strictEqual(lead.rows[0].last_phone_number_id, PHARMACY);
  const wins = await pg.query('select phone_number_id from public.lead_number_windows where business_id = $1 and phone = $2 order by phone_number_id', [B, CUSTOMER]);
  assert.deepStrictEqual(wins.rows.map(r => r.phone_number_id), [MAIN_B, PHARMACY]);

  // No browser access to numbers, windows or the helper.
  const u = await pg.query("insert into auth.users (email) values ('admin@mayura.test') returning id");
  await pg.query("insert into public.staff_members (user_id, email, role, business_id) values ($1, 'admin@mayura.test', 'owner', $2)", [u.rows[0].id, B]);
  await assert.rejects(asUser(pg, u.rows[0].id, () => pg.query('select * from public.whatsapp_numbers')));
  await assert.rejects(asUser(pg, u.rows[0].id, () => pg.query('select * from public.lead_number_windows')));
  await assert.rejects(asUser(pg, u.rows[0].id, () => pg.query('select public.lead_mark_inbound_number($1, $2, $3)', [B, CUSTOMER, LAB])));
});
