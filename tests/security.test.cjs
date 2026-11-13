// Security smoke tests: run with `npm test`. No network calls to Meta or Supabase.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

// Configure before the app is loaded. Empty strings stop dotenv from filling these from .env.
process.env.APP_SECRET = 'test_app_secret';
process.env.VERIFY_TOKEN = 'test_verify_token';
process.env.ALLOW_UNSIGNED_WEBHOOKS = '';
process.env.WHATSAPP_TOKEN = '';
process.env.PHONE_NUMBER_ID = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.VITE_SUPABASE_URL = 'http://127.0.0.1:9'; // unreachable on purpose
process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_test';

const app = require('../server/app.cjs');
const { isValidSignature } = require('../server/webhook.cjs');

let server;
let base;

before(async () => {
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const sign = (body, secret = 'test_app_secret') =>
  'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');

// A status-only payload: exercises the handler without triggering bot replies.
const statusPayload = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.TEST', status: 'delivered', recipient_id: '919000000000' }] } }] }],
});

test('isValidSignature accepts a correct HMAC and rejects others', () => {
  const body = Buffer.from(statusPayload);
  assert.strictEqual(isValidSignature(body, sign(statusPayload)), true);
  assert.strictEqual(isValidSignature(body, sign(statusPayload, 'wrong_secret')), false);
  assert.strictEqual(isValidSignature(body, 'sha256=abc'), false);
  assert.strictEqual(isValidSignature(body, undefined), false);
  assert.strictEqual(isValidSignature(Buffer.from(statusPayload + ' '), sign(statusPayload)), false);
});

test('webhook POST without a signature is rejected', async () => {
  const res = await fetch(`${base}/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: statusPayload });
  assert.strictEqual(res.status, 401);
});

test('webhook POST with a forged signature is rejected', async () => {
  const res = await fetch(`${base}/api/whatsapp/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sign(statusPayload, 'attacker') },
    body: statusPayload,
  });
  assert.strictEqual(res.status, 401);
});

test('webhook POST with a valid signature is accepted', async () => {
  const res = await fetch(`${base}/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sign(statusPayload) },
    body: statusPayload,
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(await res.text(), 'EVENT_RECEIVED');
});

test('webhook GET verification only succeeds with the right token', async () => {
  const ok = await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=test_verify_token&hub.challenge=12345`);
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(await ok.text(), '12345');

  const bad = await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=guess&hub.challenge=12345`);
  assert.strictEqual(bad.status, 403);
});

test('dashboard API requires sign-in', async () => {
  for (const [method, path] of [
    ['GET', '/api/status'],
    ['GET', '/api/messages'],
    ['POST', '/api/send'],
    ['POST', '/api/bot-rules'],
    ['POST', '/api/bot-catalog'],
    ['POST', '/api/clear'],
    ['GET', '/api/events'],
    ['GET', '/api/templates'],
    ['POST', '/api/templates'],
    ['GET', '/api/campaigns'],
    ['POST', '/api/campaigns'],
    ['POST', '/api/campaigns/test'],
    ['POST', '/api/audience/preview'],
    ['GET', '/api/inbox'],
    ['GET', '/api/inbox/919000000000'],
    ['POST', '/api/inbox/919000000000/messages'],
    ['PATCH', '/api/inbox/919000000000'],
    ['GET', '/api/pipeline'],
    ['GET', '/api/team'],
    ['POST', '/api/team/invite'],
    ['GET', '/api/automations'],
  ]) {
    const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
    assert.strictEqual(res.status, 401, `${method} ${path} should be 401`);
  }
});

test('a token that Supabase does not accept gets 403', async () => {
  const res = await fetch(`${base}/api/status`, { headers: { Authorization: 'Bearer not-a-real-token' } });
  assert.strictEqual(res.status, 403);
});

test('health check is public and reveals nothing', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(await res.json(), { ok: true });
});
