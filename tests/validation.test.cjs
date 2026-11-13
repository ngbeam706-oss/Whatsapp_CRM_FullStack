// Request validation at the API edge (server/validate.cjs, zod).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const A = 'a0000000-0000-4000-8000-000000000001';
process.env.VITE_SUPABASE_URL = 'http://fake.supabase';
process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
process.env.WHATSAPP_BUSINESS_ID = A;

const app = require('../server/app.cjs');
const { _setStaffForToken } = require('../server/auth.cjs');
const { body: B, params: P } = require('../server/validate.cjs');
const inbox = require('../server/inbox.cjs');

let dbCalls = 0;
global.fetch = async (url) => {
  if (String(url).startsWith('http://fake.supabase/')) dbCalls++;
  return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
};

let server;
let base;
before(async () => {
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

function request(method, path, { body, raw, token = 'owner' } = {}) {
  return new Promise((resolve, reject) => {
    const data = raw !== undefined ? raw : body === undefined ? null : JSON.stringify(body);
    const req = http.request(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-nf-client-connection-ip': `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
    }, (res) => { let t = ''; res.on('data', c => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, text: t, json: () => JSON.parse(t) })); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

_setStaffForToken('owner', { id: 'f0000000-0000-4000-8000-0000000000a1', email: 'owner@a.test', role: 'owner', businessId: A, businessName: 'Arogya' });
_setStaffForToken('agent', { id: 'f0000000-0000-4000-8000-0000000000a2', email: 'agent@a.test', role: 'agent', businessId: A, businessName: 'Arogya' });

// ---- schemas ---------------------------------------------------------------------------------
test('body schemas are loose: known fields are type-checked, other fields pass through untouched', () => {
  const r = B.updateContact.parse({ stage: 'ordered', somethingNew: { a: 1 } });
  assert.deepStrictEqual(r, { stage: 'ordered', somethingNew: { a: 1 } });
  assert.strictEqual(B.updateContact.safeParse({ tags: 'vip' }).success, false);
  assert.strictEqual(B.updateContact.safeParse({ botPaused: 'yes' }).success, false);
  assert.strictEqual(B.updateContact.safeParse({ assignedTo: null }).success, true);
});

test('URL parameters have the expected shape', () => {
  assert.strictEqual(P.phone.safeParse({ phone: '919876543210' }).success, true);
  assert.strictEqual(P.phone.safeParse({ phone: '91987&x=1' }).success, false);
  assert.strictEqual(P.id.safeParse({ id: 'a0000000-0000-4000-8000-000000000001' }).success, true);
  assert.strictEqual(P.id.safeParse({ id: '1,2' }).success, false);
  assert.strictEqual(P.templateName.safeParse({ name: 'diwali_offer' }).success, true);
  assert.strictEqual(P.templateName.safeParse({ name: 'Diwali Offer' }).success, false);
  assert.strictEqual(P.adId.safeParse({ adId: '120200001' }).success, true);
});

// ---- routes ---------------------------------------------------------------------------------------
test('a body that is a list or a bare value is refused', async () => {
  const r = await request('POST', '/api/inbox/919000000001/notes', { raw: '[{"body":"x"}]' });
  assert.strictEqual(r.status, 400);
  assert.match(r.json().error, /JSON object/);
});

test('text that arrives as an object is refused with the field name, before any database call', async () => {
  await require('../server/maintenance.cjs').getState(); // the platform-wide maintenance flag (cached), not business data
  const before = dbCalls;
  const r = await request('POST', '/api/inbox/919000000001/messages', { body: { text: { evil: true } } });
  assert.strictEqual(r.status, 400);
  assert.match(r.json().error, /^Invalid request\. text: /);
  assert.strictEqual(dbCalls, before);
});

test('size limits: a note over 2000 characters is refused', async () => {
  const r = await request('POST', '/api/inbox/919000000001/notes', { body: { body: 'x'.repeat(2001) } });
  assert.strictEqual(r.status, 400);
  assert.match(r.json().error, /body: must be at most 2000 characters/);
});

test('a bad phone or id in the address is refused', async () => {
  assert.match((await request('GET', '/api/inbox/abc')).json().error, /phone: must be the number with country code/);
  assert.strictEqual((await request('DELETE', '/api/notes/1;drop')).status, 400);
  assert.strictEqual((await request('GET', '/api/queries/not-a-uuid')).status, 400);
  assert.strictEqual((await request('POST', '/api/campaigns/123/start')).status, 400);
  assert.strictEqual((await request('PATCH', '/api/team/xyz', { body: { role: 'manager' } })).status, 400);
});

test('roles are checked before validation: an agent always gets 403, never a hint about the body', async () => {
  const r = await request('PUT', '/api/ai/provider', { token: 'agent', body: { apiKey: { x: 1 } } });
  assert.strictEqual(r.status, 403);
  const t = await request('PATCH', '/api/team/xyz', { token: 'agent', body: { role: 'boss' } });
  assert.strictEqual(t.status, 403);
});

test('unknown roles are refused at the edge', async () => {
  const r = await request('POST', '/api/team/invite', { body: { email: 'a@b.test', role: 'superadmin' } });
  assert.strictEqual(r.status, 400);
  assert.match(r.json().error, /role/);
});

test('valid requests still reach the service with the full body', async () => {
  const orig = inbox.updateContact;
  let got;
  inbox.updateContact = async (phone, input) => { got = [phone, input]; return { contact: { phone } }; };
  try {
    const r = await request('PATCH', '/api/inbox/919000000001', { body: { stage: 'ordered', tags: ['vip'], extra: 'kept' } });
    assert.strictEqual(r.status, 200, r.text);
    assert.deepStrictEqual(got, ['919000000001', { stage: 'ordered', tags: ['vip'], extra: 'kept' }]);
  } finally {
    inbox.updateContact = orig;
  }
});
