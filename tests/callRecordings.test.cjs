// WhatsApp call recordings (Phase 1): only the person who answered uploads, into the business's own
// private folder; only allowed people get a short playback link (logged); the worker joins pieces left by
// a closed browser and deletes recordings after 90 days. Fake database + fake Supabase Storage.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-000000000002';
process.env.APP_SECRET = 'server_encryption_secret_long_enough';
process.env.VITE_SUPABASE_URL = 'http://fake.supabase';
process.env.VITE_SUPABASE_ANON_KEY = 'sb_publishable_test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
process.env.WHATSAPP_BUSINESS_ID = A;

const app = require('../server/app.cjs');
const rec = require('../server/callRecordings.cjs');
const storageLib = require('../server/storage.cjs');
const { _setStaffForToken } = require('../server/auth.cjs');
const { freshDb } = require('./helpers/pgHarness.cjs');

const CALL = 'wacid.HBgMOTE5MzgxNjE5NzUwFQIAEhggQTE1/QkM2RkY=';
const PHONE = '919381619750';
let db, objects, buckets;
function seed() {
  db = {
    whatsapp_calls: [{ business_id: A, id: CALL, phone: PHONE, status: 'answered', answered_by: 'ravi@arogya.test', answered_at: new Date().toISOString(), created_at: new Date().toISOString(), duration_sec: null, recording_status: null }],
    whatsapp_leads: [{ business_id: A, phone: PHONE, assigned_to: 'ravi@arogya.test' }],
    audit_log: [], system_events: [],
  };
  objects = new Map(); // "bucket/path" -> Buffer
  buckets = new Set();
  storageLib._resetBuckets();
}

const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
function matches(row, params) {
  for (const [k, raw] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k)) continue;
    const i = raw.indexOf('.'); const op = raw.slice(0, i); const val = raw.slice(i + 1); const v = row[k];
    if (op === 'eq' && String(v) !== val) return false;
    if (op === 'lt' && !(v && String(v) < val)) return false;
  }
  return true;
}
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  const S = 'http://fake.supabase/storage/v1';
  if (u.startsWith(S)) {
    const rest = u.slice(S.length);
    const dec = (p) => p.split('/').map(decodeURIComponent).join('/');
    if (rest.startsWith('/bucket/')) return buckets.has(rest.slice(8)) ? json({ id: rest.slice(8) }) : json({ error: 'not found' }, 404);
    if (rest === '/bucket') { buckets.add(JSON.parse(opts.body).id); return json({ name: 'ok' }); }
    if (rest.startsWith('/object/upload/sign/')) return json({ url: `/object/upload/sign/${rest.slice(20)}?token=up-${rest.length}` });
    if (rest.startsWith('/object/sign/')) return json({ signedURL: `/object/sign/${rest.slice(13)}?token=play-${JSON.parse(opts.body).expiresIn}` });
    if (rest.startsWith('/object/list/')) {
      const bucket = rest.slice(13);
      const prefix = JSON.parse(opts.body).prefix;
      const out = [];
      for (const [k, v] of objects) {
        const path = k.slice(bucket.length + 1);
        if (!k.startsWith(`${bucket}/`) || !path.startsWith(`${prefix}/`)) continue;
        const name = path.slice(prefix.length + 1);
        if (name.includes('/')) continue; // only direct children
        out.push({ id: name, name, metadata: { size: v.length } });
      }
      return json(out);
    }
    if (rest.startsWith('/object/') && method === 'DELETE') { for (const p of JSON.parse(opts.body).prefixes) objects.delete(`${rest.slice(8)}/${p}`); return json([]); }
    if (rest.startsWith('/object/') && method === 'POST') { objects.set(dec(rest.slice(8)), Buffer.from(opts.body)); return json({ Key: 'ok' }); }
    if (rest.startsWith('/object/') && method === 'GET') { const b = objects.get(dec(rest.slice(8))); return b ? new Response(b) : json({}, 404); }
    return json({ error: 'unmocked storage' }, 400);
  }
  if (!u.startsWith('http://fake.supabase/rest/v1/')) return json({}, 503);
  const [path, qs = ''] = u.slice('http://fake.supabase/rest/v1/'.length).split('?');
  const params = [...new URLSearchParams(qs).entries()];
  const body = opts.body ? JSON.parse(opts.body) : null;
  const rows = (db[path] ||= []);
  if (method === 'GET') return json(rows.filter(r => matches(r, params)));
  if (method === 'POST') { rows.push(...(Array.isArray(body) ? body : [body])); return json([], 201); }
  if (method === 'PATCH') { const hit = rows.filter(r => matches(r, params)); hit.forEach(r => Object.assign(r, body)); return json(hit); }
  return json([]);
};

let server, base;
before(async () => { server = app.listen(0); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
beforeEach(seed);

function request(path, token, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Content-Length': Buffer.byteLength(data) } },
      (res) => { let t = ''; res.on('data', c => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, text: t, json: () => JSON.parse(t) })); });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}
const who = (id, email, role, biz = A) => ({ id: `d0000000-0000-4000-8000-00000000000${id}`, email, role, businessId: biz, businessName: 'x' });
_setStaffForToken('ravi', who(1, 'ravi@arogya.test', 'agent'));
_setStaffForToken('sita', who(2, 'sita@arogya.test', 'agent'));
_setStaffForToken('manager', who(3, 'boss@arogya.test', 'manager'));
_setStaffForToken('mayura', who(4, 'x@mayura.test', 'owner', B));
const folder = `${A}/${rec.key(CALL)}`;

test('only the person who answered gets upload links, into the business\'s own private folder', async () => {
  const r = await request('/api/wa-calls/recording/upload-url', 'ravi', { callId: CALL, part: 1 });
  assert.strictEqual(r.status, 200, r.text);
  assert.match(r.json().url, new RegExp(`^http://fake\\.supabase/storage/v1/object/upload/sign/wa-call-recordings/${A}/[0-9a-f]{40}/part-00001\\.webm\\?token=`));
  assert.ok(!r.json().url.includes('wacid'), 'the Meta call id is not in the storage path');
  assert.ok(buckets.has('wa-call-recordings'), 'the private bucket is created on first use');
  assert.strictEqual(db.whatsapp_calls[0].recording_status, 'recording');
  assert.strictEqual(db.whatsapp_calls[0].recording_path, `${folder}.webm`);

  assert.strictEqual((await request('/api/wa-calls/recording/upload-url', 'sita', { callId: CALL, part: 2 })).status, 403);
  assert.strictEqual((await request('/api/wa-calls/recording/upload-url', 'manager', { callId: CALL, final: true })).status, 403);
  assert.strictEqual((await request('/api/wa-calls/recording/upload-url', 'mayura', { callId: CALL, final: true })).status, 404);
  assert.strictEqual((await request('/api/wa-calls/recording/upload-url', 'ravi', { callId: CALL, part: 0 })).status, 400);
  assert.strictEqual((await request('/api/wa-calls/recording/upload-url', 'ravi', { callId: '../../x', final: true })).status, 400);
});

test('complete: the whole file is there -> ready, pieces deleted; before that it is refused', async () => {
  objects.set(`wa-call-recordings/${folder}/part-00001.webm`, Buffer.from('aa'));
  assert.strictEqual((await request('/api/wa-calls/recording/complete', 'ravi', { callId: CALL, seconds: 65 })).status, 409);
  objects.set(`wa-call-recordings/${folder}.webm`, Buffer.from('aabb'));
  const r = await request('/api/wa-calls/recording/complete', 'ravi', { callId: CALL, seconds: 65 });
  assert.strictEqual(r.status, 200, r.text);
  const c = db.whatsapp_calls[0];
  assert.deepStrictEqual([c.recording_status, c.recording_bytes, c.recording_seconds], ['ready', 4, 65]);
  assert.ok(!objects.has(`wa-call-recordings/${folder}/part-00001.webm`));
  assert.strictEqual((await request('/api/wa-calls/recording/upload-url', 'ravi', { callId: CALL, final: true })).status, 409, 'no overwriting a saved recording');
});

test('listening: the answerer, the chat\'s owner and managers get a 5-minute link (logged); others do not', async () => {
  assert.match((await request('/api/wa-calls/recording/play', 'ravi', { callId: CALL })).json().error, /no recording/);
  Object.assign(db.whatsapp_calls[0], { recording_status: 'ready', recording_path: `${folder}.webm`, recording_seconds: 65 });

  const r = await request('/api/wa-calls/recording/play', 'ravi', { callId: CALL });
  assert.strictEqual(r.status, 200, r.text);
  assert.match(r.json().url, /\/object\/sign\/wa-call-recordings\/.+\.webm\?token=play-300$/);
  assert.strictEqual((await request('/api/wa-calls/recording/play', 'manager', { callId: CALL })).status, 200);
  assert.strictEqual((await request('/api/wa-calls/recording/play', 'sita', { callId: CALL })).status, 403, 'another agent');
  assert.strictEqual((await request('/api/wa-calls/recording/play', 'mayura', { callId: CALL })).status, 404, 'another business');
  // The chat moved to Sita: now she may listen (she owns the conversation).
  db.whatsapp_leads[0].assigned_to = 'sita@arogya.test';
  db.whatsapp_calls[0].answered_by = 'someone@arogya.test';
  assert.strictEqual((await request('/api/wa-calls/recording/play', 'sita', { callId: CALL })).status, 200);
  assert.strictEqual((await request('/api/wa-calls/recording/play', 'ravi', { callId: CALL })).status, 403);

  const plays = db.audit_log.filter(a => a.action === 'call.recording_played');
  assert.deepStrictEqual(plays.map(p => p.actor_email), ['ravi@arogya.test', 'boss@arogya.test', 'sita@arogya.test']);
  assert.ok(plays.every(p => p.business_id === A));
});

test('worker: joins the pieces of a call whose browser closed, in order; nothing uploaded -> failed', async () => {
  const ended = new Date(Date.now() - 20 * 60000).toISOString();
  Object.assign(db.whatsapp_calls[0], { recording_status: 'recording', status: 'ended', ended_at: ended, duration_sec: 31 });
  objects.set(`wa-call-recordings/${folder}/part-00002.webm`, Buffer.from('BB'));
  objects.set(`wa-call-recordings/${folder}/part-00001.webm`, Buffer.from('AA'));
  objects.set(`wa-call-recordings/${folder}/part-00010.webm`, Buffer.from('CC'));
  db.whatsapp_calls.push({ business_id: A, id: 'wacid.NOTHING_UPLOADED', phone: PHONE, status: 'ended', ended_at: ended, recording_status: 'recording', created_at: ended });

  const out = await rec.sweep({ deadlineMs: 5000 });
  assert.deepStrictEqual(out, { joined: 1, failed: 1, deleted: 0 });
  assert.strictEqual(objects.get(`wa-call-recordings/${folder}.webm`).toString(), 'AABBCC');
  assert.ok(![...objects.keys()].some(k => k.includes('/part-')), 'pieces removed');
  assert.deepStrictEqual([db.whatsapp_calls[0].recording_status, db.whatsapp_calls[0].recording_seconds], ['ready', 31]);
  assert.strictEqual(db.whatsapp_calls[1].recording_status, 'failed');
});

test('worker: recordings older than 90 days are deleted', async () => {
  const old = new Date(Date.now() - 91 * 86400000).toISOString();
  Object.assign(db.whatsapp_calls[0], { recording_status: 'ready', recording_path: `${folder}.webm`, created_at: old });
  objects.set(`wa-call-recordings/${folder}.webm`, Buffer.from('x'));
  const out = await rec.sweep({ deadlineMs: 5000 });
  assert.strictEqual(out.deleted, 1);
  assert.ok(!objects.has(`wa-call-recordings/${folder}.webm`));
  assert.deepStrictEqual([db.whatsapp_calls[0].recording_status, db.whatsapp_calls[0].recording_path], ['deleted', null]);
  assert.match((await request('/api/wa-calls/recording/play', 'ravi', { callId: CALL })).json().error, /deleted after 90 days/);
});

test('migration: recording columns, allowed states, safe to re-run', async () => {
  const pg = await freshDb();
  const sql = require('fs').readFileSync(require('path').join(__dirname, '..', 'supabase', 'migrations', '20261119_call_recordings.sql'), 'utf8');
  await pg.exec(sql);
  await pg.query("insert into public.whatsapp_calls (business_id, id, phone, recording_status, recording_path) values ($1, 'wacid.a1', '1', 'ready', 'x/y.webm')", [A]);
  await assert.rejects(pg.query("insert into public.whatsapp_calls (business_id, id, phone, recording_status) values ($1, 'wacid.a2', '1', 'weird')", [A]));
});
