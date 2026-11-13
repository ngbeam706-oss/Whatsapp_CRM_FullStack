// @ts-check
// WhatsApp message templates: list / create / delete via Meta, plus helpers that
// turn a template + campaign variable settings into the parameters Meta expects.
const { graphRequest } = require('./meta.cjs');

/**
 * What a template needs filled in when sending.
 * @typedef {{ headerFormat: string | null, headerText: string, headerVars: string[], bodyText: string, bodyVars: string[] }} Needs
 * How one variable is filled: the customer's name, the event's item, or fixed text.
 * @typedef {{ type?: string, value?: string, fallback?: string }} VarSpec
 * @typedef {{ header?: VarSpec[], body?: VarSpec[], headerMediaUrl?: string }} Variables
 * @typedef {{ name?: string | null, item?: string }} SendContact
 * Graph API answer: { data, paging } or { error: { message } }.
 * @typedef {{ error?: { message: string, [key: string]: any }, data?: any, [key: string]: any }} GraphResult
 */

const LIMITS ={ name: 512, header: 60, body: 1024, footer: 60, buttonText: 25, buttons: 3 };
const CATEGORIES = ['MARKETING', 'UTILITY'];

// ---------------------------------------------------------------------------
// Pure helpers (no network): easy to test
// ---------------------------------------------------------------------------

/** Placeholders in order of first appearance: "Hi {{1}}, {{2}}" -> ['1', '2']; named ones too. @param {unknown} text @returns {string[]} */
function extractPlaceholders(text) {
  /** @type {string[]} */
  const seen = [];
  for (const m of String(text || '').matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)) {
    if (!seen.includes(m[1])) seen.push(m[1]);
  }
  return seen;
}

/** Positional placeholders must be {{1}}..{{n}} with no gaps. @param {string[]} placeholders @param {string} where @returns {string | null} */
function checkPositional(placeholders, where) {
  const nums = placeholders.map(Number);
  if (nums.some(n => !Number.isInteger(n))) return `${where}: use numbered variables like {{1}}, {{2}}.`;
  const sorted = [...nums].sort((a, b) => a - b);
  if (sorted.some((n, i) => n !== i + 1)) return `${where}: variables must be {{1}}, {{2}}, ... with no gaps.`;
  return null;
}

/**
 * Validate the dashboard's "new template" form and build Meta's create payload.
 * Input: { name, category, language, headerText, bodyText, footerText, bodyExamples[], headerExample, buttons[{type,text,url}] }
 * Returns { payload } or { error }.
 * @param {Record<string, any>} [input]
 * @returns {{ error: string, payload?: undefined } | { error?: undefined, payload: { name: string, language: string, category: string, components: any[] } }}
 */
function buildTemplatePayload(input = {}) {
  const name = String(input.name || '').trim();
  const category = String(input.category || '').toUpperCase();
  const language = String(input.language || '').trim();
  const headerText = String(input.headerText || '').trim();
  const bodyText = String(input.bodyText || '').trim();
  const footerText = String(input.footerText || '').trim();
  /** @type {Array<{ type?: string, text: string, url?: string }>} */
  const buttons = Array.isArray(input.buttons) ? input.buttons.filter((/** @type {any} */ b) => b && String(b.text || '').trim()) : [];

  if (!/^[a-z0-9_]+$/.test(name) || name.length > LIMITS.name) {
    return { error: 'Name: lowercase letters, numbers and underscores only (e.g. diwali_offer_2026).' };
  }
  if (!CATEGORIES.includes(category)) return { error: 'Category must be MARKETING or UTILITY.' };
  if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(language)) return { error: 'Pick a language (e.g. en, en_US, te, hi).' };
  if (!bodyText) return { error: 'Message body is required.' };
  if (bodyText.length > LIMITS.body) return { error: `Body is too long (max ${LIMITS.body} characters).` };
  if (headerText.length > LIMITS.header) return { error: `Header is too long (max ${LIMITS.header} characters).` };
  if (footerText.length > LIMITS.footer) return { error: `Footer is too long (max ${LIMITS.footer} characters).` };
  if (extractPlaceholders(footerText).length) return { error: 'The footer cannot contain variables.' };
  if (buttons.length > LIMITS.buttons) return { error: `At most ${LIMITS.buttons} buttons.` };

  /** @type {any[]} */
  const components = [];

  if (headerText) {
    const hp = extractPlaceholders(headerText);
    if (hp.length > 1) return { error: 'The header can have at most one variable, {{1}}.' };
    const err = checkPositional(hp, 'Header');
    if (err) return { error: err };
    /** @type {Record<string, any>} */
    const header = { type: 'HEADER', format: 'TEXT', text: headerText };
    if (hp.length) {
      const ex = String(input.headerExample || '').trim();
      if (!ex) return { error: 'Give an example value for the header variable {{1}}.' };
      header.example = { header_text: [ex] };
    }
    components.push(header);
  }

  const bp = extractPlaceholders(bodyText);
  const bodyErr = checkPositional(bp, 'Body');
  if (bodyErr) return { error: bodyErr };
  /** @type {Record<string, any>} */
  const body = { type: 'BODY', text: bodyText };
  if (bp.length) {
    /** @type {string[]} */
    const examples = (Array.isArray(input.bodyExamples) ? input.bodyExamples : []).map((/** @type {unknown} */ s) => String(s || '').trim());
    if (examples.length < bp.length || examples.slice(0, bp.length).some(s => !s)) {
      return { error: `Give an example value for each body variable ({{1}} to {{${bp.length}}}). Meta needs them to review the template.` };
    }
    body.example = { body_text: [examples.slice(0, bp.length)] };
  }
  components.push(body);

  if (footerText) components.push({ type: 'FOOTER', text: footerText });

  if (buttons.length) {
    /** @type {Array<{ type: string, text: string, url?: string }>} */
    const out = [];
    for (const b of buttons) {
      const text = String(b.text).trim();
      if (text.length > LIMITS.buttonText) return { error: `Button "${text}" is too long (max ${LIMITS.buttonText}).` };
      if (b.type === 'URL') {
        const url = String(b.url || '').trim();
        if (!/^https:\/\/\S+$/.test(url)) return { error: `Button "${text}" needs a full https:// link.` };
        out.push({ type: 'URL', text, url });
      } else {
        out.push({ type: 'QUICK_REPLY', text });
      }
    }
    components.push({ type: 'BUTTONS', buttons: out });
  }

  return { payload: { name, language, category, components } };
}

/**
 * What a template needs filled in when sending: { headerFormat, headerVars, bodyVars, bodyText, headerText }.
 * @param {{ components?: Array<{ type: string, format?: string, text?: string }> } | null | undefined} template
 * @returns {Needs}
 */
function templateNeeds(template) {
  const comps = template?.components || [];
  const header = comps.find(c => String(c.type).toUpperCase() === 'HEADER');
  const body = comps.find(c => String(c.type).toUpperCase() === 'BODY');
  const headerFormat = header ? String(header.format || 'TEXT').toUpperCase() : null;
  return {
    headerFormat,
    headerText: headerFormat === 'TEXT' ? header?.text || '' : '',
    headerVars: headerFormat === 'TEXT' ? extractPlaceholders(header?.text) : [],
    bodyText: body?.text || '',
    bodyVars: extractPlaceholders(body?.text),
  };
}

const VARIABLE_TYPES = ['contact_name', 'text', 'event_item'];

/**
 * Resolve one variable setting for a contact:
 *   {type:'contact_name', fallback} | {type:'text', value} | {type:'event_item', fallback}
 * `contact` may carry `item`: the product from the event that triggered a follow-up.
 * @param {VarSpec | undefined} spec @param {SendContact | undefined} contact @returns {string}
 */
function resolveValue(spec, contact) {
  if (spec?.type === 'event_item') {
    const item = String(contact?.item || '').trim();
    return item || String(spec.fallback || 'your order');
  }
  if (spec?.type === 'contact_name') {
    const name = String(contact?.name || '').trim();
    // Leads without a real name are stored as "+91..." or "WhatsApp Contact".
    const usable = name && !name.startsWith('+') && name !== 'WhatsApp Contact' && name !== 'WhatsApp User';
    return usable ? name.split(/\s+/)[0] : String(spec.fallback || 'there');
  }
  return String(spec?.value ?? '').trim();
}

/** @param {string} key @param {string} text */
const toParam = (key, text) => (/^\d+$/.test(key) ? { type: 'text', text } : { type: 'text', parameter_name: key, text });

/**
 * Build Meta's send `components` for one contact.
 * variables: { header: [spec], body: [spec], headerMediaUrl }
 * @param {Needs} needs @param {Variables} [variables] @param {SendContact} [contact]
 */
function buildSendComponents(needs, variables = {}, contact = {}) {
  /** @type {any[]} */
  const components = [];
  if (needs.headerFormat === 'TEXT' && needs.headerVars.length) {
    components.push({
      type: 'header',
      parameters: needs.headerVars.map((k, i) => toParam(k, resolveValue(variables.header?.[i], contact))),
    });
  } else if (needs.headerFormat && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(needs.headerFormat)) {
    const kind = needs.headerFormat.toLowerCase();
    components.push({ type: 'header', parameters: [{ type: kind, [kind]: { link: variables.headerMediaUrl } }] });
  }
  if (needs.bodyVars.length) {
    components.push({
      type: 'body',
      parameters: needs.bodyVars.map((k, i) => toParam(k, resolveValue(variables.body?.[i], contact))),
    });
  }
  return components;
}

/**
 * Problems with variable settings for this template, or null if OK.
 * allowEventItem: only automations triggered by an order/view know the item.
 * @param {Needs} needs @param {Variables} [variables] @param {{ allowEventItem?: boolean }} [options]
 * @returns {string | null}
 */
function checkVariables(needs, variables = {}, { allowEventItem = false } = {}) {
  const allowed = allowEventItem ? VARIABLE_TYPES : VARIABLE_TYPES.filter(t => t !== 'event_item');
  /** @param {string[]} list @param {VarSpec[] | undefined} specs @param {string} where */
  const check = (list, specs, where) => {
    for (let i = 0; i < list.length; i++) {
      const s = specs?.[i];
      if (!s || !allowed.includes(s.type || '')) return `${where} variable {{${list[i]}}} needs a value.`;
      if (s.type === 'text' && !String(s.value || '').trim()) return `${where} variable {{${list[i]}}} needs a value.`;
    }
    return null;
  };
  if (needs.headerFormat && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(needs.headerFormat) && !/^https:\/\/\S+$/.test(String(variables.headerMediaUrl || ''))) {
    return `This template has a ${needs.headerFormat.toLowerCase()} header: give a public https:// link to the file.`;
  }
  return check(needs.headerVars, variables.header, 'Header') || check(needs.bodyVars, variables.body, 'Body');
}

/** The message text a contact will see (for the chat log). @param {Needs} needs @param {Variables} [variables] @param {SendContact} [contact] */
function renderPreview(needs, variables = {}, contact = {}) {
  /** @param {string} text @param {string[]} keys @param {VarSpec[] | undefined} specs */
  const fill = (text, keys, specs) => keys.reduce(
    (t, k, i) => t.split(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, 'g')).join(resolveValue(specs?.[i], contact)),
    text
  );
  const header = needs.headerVars.length ? fill(needs.headerText, needs.headerVars, variables.header) : needs.headerText;
  const body = fill(needs.bodyText, needs.bodyVars, variables.body);
  return [header && `*${header}*`, body].filter(Boolean).join('\n');
}

// ---------------------------------------------------------------------------
// Meta API calls
// ---------------------------------------------------------------------------

// Templates belong to a WhatsApp Business Account: each business works with its own (`wa.wabaId`).
/** @param {any} wa  the business's WhatsApp connection @returns {GraphResult | null} */
function wabaMissing(wa) {
  if (!wa) return { error: { message: 'This business has no WhatsApp number connected yet.' } };
  return wa.wabaId ? null : { error: { message: 'The WhatsApp Business Account ID is missing. Add it on the WhatsApp page.' } };
}

/** All templates in the business's WhatsApp account (up to 10 pages). @param {any} wa @returns {Promise<GraphResult>} */
async function listTemplates(wa) {
  const missing = wabaMissing(wa);
  if (missing) return missing;
  /** @type {any[]} */
  const all = [];
  /** @type {string | null} */
  let path =`${wa.wabaId}/message_templates?fields=id,name,status,category,language,components,rejected_reason,quality_score&limit=100`;
  for (let page = 0; page < 10 && path; page++) {
    const res = await graphRequest(wa, /** @type {string} */ (path));
    if (res.error) return res;
    all.push(...(res.data || []));
    const next = res.paging?.next;
    path = next ? next.replace(/^https:\/\/graph\.facebook\.com\/[^/]+\//, '') : null;
  }
  return { data: all };
}

/** @param {any} wa @param {string | undefined} name @param {string | undefined} language @returns {Promise<GraphResult>} */
async function findTemplate(wa, name, language) {
  const res = await listTemplates(wa);
  if (res.error) return res;
  return { data: res.data.find((/** @type {{ name: string, language: string }} */ t) => t.name === name && t.language === language) || null };
}

/** @param {any} wa @param {Record<string, any>} input @returns {Promise<GraphResult>} */
async function createTemplate(wa, input) {
  const missing = wabaMissing(wa);
  if (missing) return missing;
  const built = buildTemplatePayload(input);
  if (built.error !== undefined) return { error: { message: built.error } };
  return graphRequest(wa, `${wa.wabaId}/message_templates`, { method: 'POST', body: built.payload });
}

/** @param {any} wa @param {unknown} name @returns {Promise<GraphResult>} */
async function deleteTemplate(wa, name) {
  const missing = wabaMissing(wa);
  if (missing) return missing;
  if (!/^[a-z0-9_]+$/.test(String(name || ''))) return { error: { message: 'Invalid template name.' } };
  return graphRequest(wa, `${wa.wabaId}/message_templates?name=${encodeURIComponent(String(name))}`, { method: 'DELETE' });
}

/** @param {any} wa @returns {Promise<GraphResult>} */
async function phoneAccountInfo(wa) {
  if (!wa?.phoneNumberId) return { error: { message: 'This business has no WhatsApp number connected yet.' } };
  return graphRequest(wa, `${wa.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,messaging_limit_tier`);
}

module.exports = {
  extractPlaceholders,
  buildTemplatePayload,
  templateNeeds,
  resolveValue,
  buildSendComponents,
  checkVariables,
  renderPreview,
  listTemplates,
  findTemplate,
  createTemplate,
  deleteTemplate,
  phoneAccountInfo,
};
