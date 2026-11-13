// Phase 2 logic tests: templates, variables, opt-out keywords, audience filters.
const { test } = require('node:test');
const assert = require('node:assert');

process.env.SUPABASE_SERVICE_ROLE_KEY = '';
const tpl = require('../server/templates.cjs');
const campaigns = require('../server/campaigns.cjs');

test('buildTemplatePayload: valid marketing template with variables, footer and buttons', () => {
  const r = tpl.buildTemplatePayload({
    name: 'diwali_offer_2026',
    category: 'marketing',
    language: 'en',
    headerText: 'Hi {{1}}',
    headerExample: 'Ravi',
    bodyText: 'Get {{1}} off on {{2}} this week!',
    bodyExamples: ['20%', 'Lean Well Kit'],
    footerText: 'Reply STOP to unsubscribe',
    buttons: [{ type: 'QUICK_REPLY', text: 'Order now' }, { type: 'URL', text: 'See menu', url: 'https://example.com/menu' }],
  });
  assert.ifError(r.error);
  assert.strictEqual(r.payload.category, 'MARKETING');
  const [header, body, footer, buttons] = r.payload.components;
  assert.deepStrictEqual(header, { type: 'HEADER', format: 'TEXT', text: 'Hi {{1}}', example: { header_text: ['Ravi'] } });
  assert.deepStrictEqual(body.example, { body_text: [['20%', 'Lean Well Kit']] });
  assert.strictEqual(footer.type, 'FOOTER');
  assert.deepStrictEqual(buttons.buttons.map(b => b.type), ['QUICK_REPLY', 'URL']);
});

test('buildTemplatePayload: rejects bad input with a clear message', () => {
  const base = { name: 'ok_name', category: 'UTILITY', language: 'en', bodyText: 'Hello' };
  assert.match(tpl.buildTemplatePayload({ ...base, name: 'Bad Name' }).error, /lowercase/);
  assert.match(tpl.buildTemplatePayload({ ...base, category: 'AUTH' }).error, /MARKETING or UTILITY/);
  assert.match(tpl.buildTemplatePayload({ ...base, bodyText: '' }).error, /required/);
  assert.match(tpl.buildTemplatePayload({ ...base, bodyText: 'Hi {{1}} and {{3}}', bodyExamples: ['a', 'b'] }).error, /no gaps/);
  assert.match(tpl.buildTemplatePayload({ ...base, bodyText: 'Hi {{1}}' }).error, /example value/);
  assert.match(tpl.buildTemplatePayload({ ...base, footerText: 'Bye {{1}}' }).error, /footer cannot/);
  assert.match(tpl.buildTemplatePayload({ ...base, buttons: [{ type: 'URL', text: 'Go', url: 'http://x.com' }] }).error, /https/);
  assert.ifError(tpl.buildTemplatePayload(base).error);
});

const approved = {
  name: 'offer', language: 'en', status: 'APPROVED',
  components: [
    { type: 'HEADER', format: 'TEXT', text: 'Hello {{1}}' },
    { type: 'BODY', text: 'Dear {{1}}, enjoy {{2}} today.' },
  ],
};

test('templateNeeds + buildSendComponents fill contact name and fixed text', () => {
  const needs = tpl.templateNeeds(approved);
  assert.deepStrictEqual(needs.headerVars, ['1']);
  assert.deepStrictEqual(needs.bodyVars, ['1', '2']);
  const vars = { header: [{ type: 'contact_name', fallback: 'friend' }], body: [{ type: 'contact_name', fallback: 'friend' }, { type: 'text', value: '20% off' }] };
  assert.strictEqual(tpl.checkVariables(needs, vars), null);
  const comps = tpl.buildSendComponents(needs, vars, { name: 'Lakshmi Devi' });
  assert.deepStrictEqual(comps, [
    { type: 'header', parameters: [{ type: 'text', text: 'Lakshmi' }] },
    { type: 'body', parameters: [{ type: 'text', text: 'Lakshmi' }, { type: 'text', text: '20% off' }] },
  ]);
  assert.strictEqual(tpl.renderPreview(needs, vars, { name: '+919000000000' }), '*Hello friend*\nDear friend, enjoy 20% off today.');
});

test('checkVariables reports missing values and media links', () => {
  const needs = tpl.templateNeeds(approved);
  assert.match(tpl.checkVariables(needs, { header: [{ type: 'contact_name' }], body: [{ type: 'contact_name' }] }), /\{\{2\}\}/);
  const imageNeeds = tpl.templateNeeds({ components: [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'Hi' }] });
  assert.match(tpl.checkVariables(imageNeeds, {}), /image header/);
  assert.strictEqual(tpl.checkVariables(imageNeeds, { headerMediaUrl: 'https://cdn.example.com/a.jpg' }), null);
  assert.deepStrictEqual(tpl.buildSendComponents(imageNeeds, { headerMediaUrl: 'https://cdn.example.com/a.jpg' }), [
    { type: 'header', parameters: [{ type: 'image', image: { link: 'https://cdn.example.com/a.jpg' } }] },
  ]);
});

test('named template variables are sent with parameter_name', () => {
  const needs = tpl.templateNeeds({ components: [{ type: 'BODY', text: 'Hi {{first_name}}' }] });
  const comps = tpl.buildSendComponents(needs, { body: [{ type: 'text', value: 'Asha' }] });
  assert.deepStrictEqual(comps[0].parameters[0], { type: 'text', parameter_name: 'first_name', text: 'Asha' });
});

test('optKeyword only matches whole-message keywords', () => {
  assert.strictEqual(campaigns.optKeyword('STOP'), 'stop');
  assert.strictEqual(campaigns.optKeyword('  Unsubscribe. '), 'stop');
  assert.strictEqual(campaigns.optKeyword('start'), 'start');
  assert.strictEqual(campaigns.optKeyword('please stop the delivery tomorrow'), null);
  assert.strictEqual(campaigns.optKeyword('cancel'), null);
  assert.strictEqual(campaigns.optKeyword(''), null);
});

test('cleanPhoneList normalises and de-duplicates pasted numbers', () => {
  assert.deepStrictEqual(
    campaigns.cleanPhoneList('+91 97011 01555, 919701101555\n12; 447911123456'),
    ['919701101555', '447911123456']
  );
});

test('segmentFilter builds safe PostgREST filters', () => {
  assert.strictEqual(campaigns.segmentFilter({}), '');
  const f = campaigns.segmentFilter({ sources: ['Instagram Ad', 'Website'], activeWithinDays: 30, tags: ['vip'] });
  assert.match(f, /^source=in\.\(%22Instagram%20Ad%22,%22Website%22\)/);
  assert.match(f, /last_contacted_at=gte\./);
  assert.match(f, /tags=ov\.%7B%22vip%22%7D/);
});

test('classifyError retries rate limits but not permanent failures', () => {
  assert.strictEqual(campaigns.classifyError({ code: 130429, message: 'Rate limit' }, 1).retry, true);
  assert.strictEqual(campaigns.classifyError({ code: 130429, message: 'Rate limit' }, 3).retry, false);
  assert.strictEqual(campaigns.classifyError({ code: 131026, message: 'Undeliverable' }, 1).retry, false);
  assert.match(campaigns.classifyError({ code: 131026, message: 'Undeliverable' }, 1).message, /code 131026/);
});
