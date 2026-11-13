// Ad previews: thumbnails for the ads on screen come from ONE Meta request on the business's own ad
// account (only ads synced for this business), are cached, never stored; a full preview checks the ad is
// in the account and only embeds Meta's own preview page. Agents and other businesses get nothing.
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
process.env.WHATSAPP_BUSINESS_ID = A;

const secrets = require('../server/secrets.cjs');
const app = require('../server/app.cjs');
const limits = require('../server/limits.cjs');
const ads = require('../server/ads.cjs');
const { _setStaffForToken } = require('../server/auth.cjs');

const TOKEN = 'EAAG-ads-token-preview-1234';
let db, graphCalls, previewHtml;
function seed() {
  db = {
    plans: [{ id: 'pro', name: 'Pro', ads_enabled: true }],
    businesses: [{ id: A, name: 'Mayura', status: 'active', plan_id: 'pro', limit_overrides: {} }, { id: B, name: 'Other', status: 'active', plan_id: 'pro', limit_overrides: {} }],
    business_ad_accounts: [{ business_id: A, ad_account_id: 'act_1111111111', access_token_enc: secrets.encrypt(TOKEN), graph_api_version: 'v26.0' }],
    ad_insights_daily: [{ business_id: A, ad_id: '901' }, { business_id: A, ad_id: '902' }, { business_id: B, ad_id: '903' }],
  };
  graphCalls = [];
  previewHtml = '<iframe src="https://business.facebook.com/ads/api/preview_iframe.php?d=AQ&amp;t=1" width="540" height="690"></iframe>';
  limits.clearCache();
}

const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith('https://graph.facebook.com/')) {
    const path = decodeURIComponent(u.replace(/^https:\/\/graph\.facebook\.com\/[^/]+\//, ''));
    graphCalls.push(path);
    if (path.startsWith('act_1111111111/ads?')) {
      const ids = JSON.parse(path.match(/filtering=(\[.*?\])(&|$)/)[1])[0].value;
      return json({ data: ids.map(id => ({ id, creative: { thumbnail_url: `https://scontent.fbcdn.net/t_${id}.jpg`, object_story_spec: { link_data: { name: `Headline ${id}` } } } })) });
    }
    if (/^90[12]\?fields=account_id/.test(path)) {
      const id = path.slice(0, 3);
      return json({ id, account_id: id === '902' ? '9999999999' : '1111111111', name: `Ad ${id}`, effective_status: 'ACTIVE',
        creative: { object_story_spec: { video_data: { message: 'Book a free consultation.', title: 'Free check-up', image_url: 'https://scontent.fbcdn.net/v.jpg', call_to_action: { type: 'WHATSAPP_MESSAGE' } } } } });
    }
    if (/^90\d\/previews/.test(path)) return json({ data: [{ body: previewHtml }] });
    return json({ error: { message: 'unmocked' } }, 400);
  }
  if (!u.startsWith('http://fake.supabase/rest/v1/')) return json({}, 503);
  const [path, qs = ''] = u.slice('http://fake.supabase/rest/v1/'.length).split('?');
  const p = new URLSearchParams(qs);
  let rows = db[path] || [];
  const biz = (p.get('business_id') || '').replace(/^eq\./, '');
  if (biz) rows = rows.filter(r => r.business_id === biz);
  const id = (p.get('id') || '').replace(/^eq\./, '');
  if (id) rows = rows.filter(r => r.id === id);
  const inIds = (p.get('ad_id') || '').match(/^in\.\((.*)\)$/);
  if (inIds) rows = rows.filter(r => inIds[1].split(',').includes(r.ad_id));
  return json(rows);
};

let server, base;
before(async () => { server = app.listen(0); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
beforeEach(seed);

function get(path, token) {
  return new Promise((resolve, reject) => {
    http.get(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } }, (res) => { let t = ''; res.on('data', c => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, text: t, json: () => JSON.parse(t) })); }).on('error', reject);
  });
}
const who = (n, role, biz = A) => ({ id: `d0000000-0000-4000-8000-00000000000${n}`, email: `${role}${n}@x.test`, role, businessId: biz, businessName: 'x' });
_setStaffForToken('manager', who(1, 'manager'));
_setStaffForToken('agent', who(2, 'agent'));
_setStaffForToken('other', who(3, 'owner', B));

test('thumbnails: one Meta request on our own ad account, only for ads synced for this business, then cached', async () => {
  const r = await get('/api/ads/thumbnails?ids=901,902,903,abc,901', 'manager');
  assert.strictEqual(r.status, 200, r.text);
  assert.deepStrictEqual(Object.keys(r.json().thumbnails).sort(), ['901', '902']);
  assert.strictEqual(r.json().thumbnails['901'].thumbnailUrl, 'https://scontent.fbcdn.net/t_901.jpg');
  assert.strictEqual(r.json().thumbnails['901'].headline, 'Headline 901');
  assert.strictEqual(graphCalls.length, 1);
  assert.match(graphCalls[0], /^act_1111111111\/ads\?fields=id,creative\{/);
  assert.match(graphCalls[0], /"value":\["901","902"\]/, '903 (another business\'s ad) and junk are never asked for');
  await get('/api/ads/thumbnails?ids=901,902', 'manager');
  assert.strictEqual(graphCalls.length, 1, 'served from the cache');
});

test('preview: Meta\'s own frame, the ad\'s words and button; another account\'s ad or a non-Meta frame is refused', async () => {
  const r = await get('/api/ads/ads/901/preview?format=INSTAGRAM_STORY', 'manager');
  assert.strictEqual(r.status, 200, r.text);
  const p = r.json();
  assert.strictEqual(p.frameUrl, 'https://business.facebook.com/ads/api/preview_iframe.php?d=AQ&t=1');
  assert.deepStrictEqual([p.text, p.headline, p.cta, p.format], ['Book a free consultation.', 'Free check-up', 'whatsapp message', 'INSTAGRAM_STORY']);
  assert.ok(graphCalls.some(c => c.startsWith('901/previews?ad_format=INSTAGRAM_STORY')));

  assert.match((await get('/api/ads/ads/902/preview', 'manager')).json().error, /not in your connected ad account/);
  assert.strictEqual((await get('/api/ads/ads/903/preview', 'manager')).status, 404, 'not synced for this business');

  previewHtml = '<iframe src="https://evil.example/steal"></iframe>';
  const bad = await get('/api/ads/ads/901/preview?format=DESKTOP_FEED_STANDARD', 'manager');
  assert.strictEqual(bad.json().frameUrl, null, 'only facebook.com preview pages are embedded');
  assert.strictEqual((await get('/api/ads/ads/901/preview?format=WHATEVER', 'manager')).json().format, 'MOBILE_FEED_STANDARD');
});

test('agents and other businesses get nothing', async () => {
  assert.strictEqual((await get('/api/ads/thumbnails?ids=901', 'agent')).status, 403);
  assert.strictEqual((await get('/api/ads/ads/901/preview', 'agent')).status, 403);
  const other = await get('/api/ads/thumbnails?ids=901', 'other');
  assert.ok(other.status >= 400 || Object.keys(other.json().thumbnails || {}).length === 0);
  assert.notStrictEqual((await get('/api/ads/ads/901/preview', 'other')).status, 200);
});

test('creativeParts finds the words and picture for link, video and multi-asset ads', () => {
  assert.deepStrictEqual(ads.creativeParts({ object_story_spec: { link_data: { message: 'M', name: 'N', picture: 'P', call_to_action: { type: 'LEARN_MORE' } } } }),
    { image: 'P', thumbnail: 'P', text: 'M', headline: 'N', cta: 'learn more' });
  assert.strictEqual(ads.creativeParts({ asset_feed_spec: { bodies: [{ text: 'Body' }], titles: [{ text: 'Title' }] } }).headline, 'Title');
  assert.deepStrictEqual(ads.creativeParts(undefined), { image: null, thumbnail: null, text: '', headline: '', cta: '' });
});
