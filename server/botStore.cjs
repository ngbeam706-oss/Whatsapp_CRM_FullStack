// @ts-check
// Bot keyword rules and the flow catalog, per business: a short in-memory copy backed by the database.
// A business that hasn't saved anything yet gets its starting bot from defaults.cjs (Arogya keeps its
// original bot; every other business starts with the neutral starter bot).
const { dbRequest } = require('./db.cjs');
const { defaultsFor } = require('./defaults.cjs');
const { requireBusinessId } = require('./tenant.cjs');

/** @typedef {import('./types.cjs').BotRule} BotRule */
/** @typedef {import('./types.cjs').Catalog} Catalog */
/** @typedef {{ rules: BotRule[], catalog: Catalog }} BotCache */

/** @param {unknown} err */
const errText = (err) => (err instanceof Error ? err.message : String(err));

// businessId -> { rules, catalog }
/** @type {Map<string, BotCache>} */
const caches = new Map();
/** @param {unknown} businessId @returns {BotCache} */
function cacheFor(businessId) {
  const id = requireBusinessId(businessId);
  let c = caches.get(id);
  if (!c) {
    const d = defaultsFor(id);
    c = { rules: [...d.rules], catalog: { ...d.catalog } };
    caches.set(id, c);
  }
  return c;
}

/** @param {any} r A whatsapp_bot_rules row. @returns {BotRule} */
const fromDbRule = (r) => ({
  id: r.id,
  keyword: r.keyword,
  matchType: r.match_type || 'contains',
  responseType: r.response_type || 'text',
  responseText: r.response_text || '',
  buttons: r.buttons || [],
  isActive: r.is_active !== false,
});

/** @param {BotRule} r @param {string} businessId */
const toDbRule = (r, businessId) => ({
  business_id: businessId,
  id: r.id,
  keyword: r.keyword,
  match_type: r.matchType || 'contains',
  response_type: r.responseType || 'text',
  response_text: r.responseText || '',
  buttons: r.buttons || [],
  is_active: r.isActive !== false,
  updated_at: new Date().toISOString(),
});

const CATALOG_ID = 'main_catalog';

/** @param {string} businessId @returns {Promise<BotRule[]>} */
async function getActiveBotRules(businessId) {
  const c = cacheFor(businessId);
  try {
    const res = await dbRequest(`whatsapp_bot_rules?select=*&business_id=eq.${businessId}`);
    if (res.ok && Array.isArray(res.data) && res.data.length > 0) c.rules = res.data.map(fromDbRule);
  } catch {
    // Fall back to the in-memory copy.
  }
  return c.rules;
}

/** @param {string} businessId @param {BotRule[]} rules */
function setBotRules(businessId, rules) {
  cacheFor(businessId).rules = rules;
}

/** @param {string} businessId @param {BotRule} rule */
function upsertBotRule(businessId, rule) {
  const c = cacheFor(businessId);
  const idx = c.rules.findIndex(r => r.id === rule.id);
  if (idx >= 0) c.rules[idx] = rule;
  else c.rules.unshift(rule);
}

/** @param {string} businessId */
function currentBotRules(businessId) {
  return cacheFor(businessId).rules;
}

/** @param {string} businessId @param {BotRule[]} rules */
async function syncRulesToSupabase(businessId, rules) {
  requireBusinessId(businessId);
  if (!rules.length) return;
  try {
    await dbRequest('whatsapp_bot_rules?on_conflict=business_id,id', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: rules.map(r => toDbRule(r, businessId)),
    });
  } catch (err) {
    console.warn('[DB] syncRulesToSupabase failed:', errText(err));
  }
}

/** Delete one keyword rule of this business. @param {string} businessId @param {string} ruleId */
async function deleteBotRule(businessId, ruleId) {
  const c = cacheFor(businessId);
  c.rules = c.rules.filter(r => r.id !== ruleId);
  const res = await dbRequest(`whatsapp_bot_rules?business_id=eq.${businessId}&id=eq.${encodeURIComponent(ruleId)}`, { method: 'DELETE', prefer: 'return=minimal' });
  return res.ok;
}

/** @param {string} businessId @returns {Promise<Catalog>} */
async function getActiveCatalog(businessId) {
  const c = cacheFor(businessId);
  const base = defaultsFor(businessId).catalog;
  try {
    const res = await dbRequest(`whatsapp_catalog?id=eq.${CATALOG_ID}&business_id=eq.${businessId}&select=*`);
    if (res.ok && Array.isArray(res.data) && res.data.length > 0 && res.data[0].data) {
      c.catalog = { ...base, ...res.data[0].data };
    }
  } catch {
    // Fall back to the in-memory copy.
  }
  return c.catalog;
}

/** @param {string} businessId @param {Catalog} partial */
function mergeCatalog(businessId, partial) {
  const c = cacheFor(businessId);
  c.catalog = { ...c.catalog, ...partial };
  return c.catalog;
}

/** Put the business's bot menus back to its starting bot. @param {string} businessId */
function resetCatalog(businessId) {
  const c = cacheFor(businessId);
  c.catalog = { ...defaultsFor(businessId).catalog };
  return c.catalog;
}

/** @param {string} businessId */
function currentCatalog(businessId) {
  return cacheFor(businessId).catalog;
}

/** @param {string} businessId @param {Catalog} catalog */
async function syncCatalogToSupabase(businessId, catalog) {
  requireBusinessId(businessId);
  try {
    await dbRequest('whatsapp_catalog?on_conflict=business_id,id', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: { business_id: businessId, id: CATALOG_ID, data: catalog, updated_at: new Date().toISOString() },
    });
  } catch (err) {
    console.warn('[DB] syncCatalogToSupabase failed:', errText(err));
  }
}

module.exports = {
  getActiveBotRules,
  setBotRules,
  upsertBotRule,
  currentBotRules,
  syncRulesToSupabase,
  deleteBotRule,
  getActiveCatalog,
  mergeCatalog,
  resetCatalog,
  currentCatalog,
  syncCatalogToSupabase,
};
