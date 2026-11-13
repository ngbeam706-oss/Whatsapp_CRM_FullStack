// @ts-check
// Ads phase F (docs/progress/ads-module.md): watching ads for problems, on top of the existing Ads module.
//   F1  Rejected / flagged ads with Meta's reasons (from the hourly sync), shown on the Ads page and as a
//       badge on the Ads menu until a manager acknowledges them.
//   F3  Auto-pause: after the hourly sync, ACTIVE ads over the cost-alert limits are paused (only if the
//       business switched it on; at most MAX_PAUSES per run; never resumes anything).
//   F4  Duplicate an ad (Meta's /copies): a PAUSED copy in the same ad set.
// (F2, the Instagram account on new ads, lives in server/adCreate.cjs.)
const { dbRequest } = require('./db.cjs');
const { requireBusinessId } = require('./tenant.cjs');
const ads = require('./ads.cjs');

/** @typedef {import('./types.cjs').Staff} Staff */
/** @typedef {Record<string, any>} Row */

const PROBLEM_STATUSES = ['DISAPPROVED', 'WITH_ISSUES'];
const MAX_PAUSES = 5;          // per business per run: a safety net against pausing everything by mistake
const MAX_REASONS = 6;

/**
 * Pure: Meta's reasons for a rejected / flagged ad as plain sentences. Reads `ad_review_feedback` (e.g.
 * { global: { POLICY: "text" }, placement_specific: {...} }) and `issues_info` ([{ error_summary,
 * error_message }]); unknown shapes are walked for text, so a format change at Meta never loses reasons.
 * @param {Row} ad
 */
function reasonsOf(ad) {
  /** @type {string[]} */
  const out = [];
  /** @param {unknown} v @param {number} depth */
  const walk = (v, depth) => {
    if (depth > 4 || out.length >= MAX_REASONS * 2) return;
    if (typeof v === 'string') { const t = v.trim(); if (t.length > 3) out.push(t.slice(0, 400)); return; }
    if (Array.isArray(v)) { v.forEach(x => walk(x, depth + 1)); return; }
    if (v && typeof v === 'object') Object.values(v).forEach(x => walk(x, depth + 1));
  };
  walk(ad?.ad_review_feedback, 0);
  for (const i of Array.isArray(ad?.issues_info) ? ad.issues_info : []) {
    const text = i?.error_summary && i?.error_message && i.error_summary !== i.error_message ? `${i.error_summary}: ${i.error_message}` : (i?.error_message || i?.error_summary);
    if (typeof text === 'string' && text.trim()) out.push(text.trim().slice(0, 400));
  }
  return [...new Set(out)].slice(0, MAX_REASONS);
}

/** @param {unknown} a @param {unknown} b */
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Sync (server/ads.cjs): remember ads Meta rejected or flagged; forget ones that are fine again.
 * Only ads in `metaAds` are touched (an ad missing from Meta's answer keeps its row).
 * @param {string} biz @param {Row[]} metaAds  Meta's ads with id, name, effective_status, ad_review_feedback, issues_info
 */
async function recordIssues(biz, metaAds) {
  requireBusinessId(biz);
  const known = await dbRequest(`ad_issues?business_id=eq.${biz}&kind=eq.review&select=ad_id,status,reasons`);
  if (!known.ok) return { saved: 0 }; // table not there yet (before SQL 20261126)
  /** @type {Map<string, Row>} */
  const byId = new Map((known.data || []).map((/** @type {Row} */ r) => [String(r.ad_id), r]));
  let saved = 0, cleared = 0;
  const now = new Date().toISOString();
  for (const ad of metaAds) {
    const id = String(ad?.id || '');
    if (!/^\d{1,25}$/.test(id)) continue;
    const bad = PROBLEM_STATUSES.includes(ad.effective_status);
    const prev = byId.get(id);
    if (bad) {
      const reasons = reasonsOf(ad);
      if (prev && prev.status === ad.effective_status && same(prev.reasons, reasons)) continue;
      // New or changed problem: (re)announce it (acknowledged_at cleared).
      await dbRequest('ad_issues?on_conflict=business_id,ad_id,kind', {
        method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
        body: { business_id: biz, ad_id: id, kind: 'review', ad_name: String(ad.name || '').slice(0, 200) || null, status: ad.effective_status, reasons, updated_at: now, acknowledged_at: null, acknowledged_by: null, ...(prev ? {} : { first_seen_at: now }) },
      });
      saved++;
    } else if (prev) {
      await dbRequest(`ad_issues?business_id=eq.${biz}&ad_id=eq.${id}&kind=eq.review`, { method: 'DELETE', prefer: 'return=minimal' });
      cleared++;
    }
  }
  if (saved) await require('./events.cjs').logEvent({ level: 'info', source: 'ads', businessId: biz, code: 'ad_review_issue', message: `${saved} ad(s) rejected or flagged by Meta` });
  return { saved, cleared };
}

/** @param {number} n @param {string} currency */
const money = (n, currency) => `${currency} ${Math.round(n * 100) / 100}`;

/**
 * Worker, after a business's hourly sync: pause ACTIVE ads over the cost-alert limits, if switched on.
 * @param {string} biz
 */
async function autoPause(biz) {
  const id = requireBusinessId(biz);
  const status = await ads.accountStatus(id);
  if (!status.connected || !status.alerts?.autoPause) return { paused: 0 };
  const s = status.alerts;
  if (!s.maxCostPerChat && !s.maxCostPerConversion) return { paused: 0 };
  const r = await ads.report(id, { days: s.windowDays });
  /** @type {Row[]} */
  const alerts = /** @type {any} */ (r).report?.alerts || [];
  if (!alerts.length) return { paused: 0 };
  const ctx = await ads.controlContext(id);
  if (ctx.error !== undefined) return { paused: 0, error: ctx.error };
  const currency = ctx.row.currency || 'INR';
  /** @type {Map<string, Row[]>} one entry per ad (an ad may break both limits) */
  const perAd = new Map();
  for (const a of alerts) perAd.set(a.adId, [...(perAd.get(a.adId) || []), a]);
  let paused = 0, failed = 0;
  for (const [adId, hits] of perAd) {
    if (paused >= MAX_PAUSES) break;
    // Check with Meta right now: still this business's ad, and still running.
    const owned = await ads.ownedObject(ctx, adId, 'name,status');
    if (owned.error !== undefined || owned.obj.status !== 'ACTIVE') continue;
    const res = await ads.graph(ctx.version, ctx.token, adId, { method: 'POST', form: { status: 'PAUSED' } });
    const reasons = hits.map(h => `Cost per ${h.kind === 'chat' ? 'chat' : 'conversion'} ${money(h.cost, currency)} is over your limit of ${money(h.max, currency)} (last ${s.windowDays} day${s.windowDays === 1 ? '' : 's'}, ${money(h.spend, currency)} spent, ${h.count} ${h.kind === 'chat' ? 'chats' : 'conversions'}).`);
    if (res.error || res.success === false) {
      failed++;
      reasons.push(`Could not pause it: ${ads.actionError(res)}`);
    } else {
      paused++;
      await dbRequest(`ad_insights_daily?business_id=eq.${id}&ad_id=eq.${adId}`, { method: 'PATCH', prefer: 'return=minimal', body: { effective_status: 'PAUSED' } });
      await ads.audit(null, id, 'ads.ad_auto_paused', { adId, adName: owned.obj.name || null, reasons });
    }
    await dbRequest('ad_issues?on_conflict=business_id,ad_id,kind', {
      method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
      body: { business_id: id, ad_id: adId, kind: 'auto_paused', ad_name: String(owned.obj.name || hits[0].adName || '').slice(0, 200) || null, status: res.error ? 'PAUSE_FAILED' : 'PAUSED', reasons, updated_at: new Date().toISOString(), first_seen_at: new Date().toISOString(), acknowledged_at: null, acknowledged_by: null },
    });
  }
  return { paused, failed };
}

/** Open problems for the Ads page (managers + Business Admin). @param {Staff} staff */
async function listIssues(staff) {
  const biz = requireBusinessId(staff?.businessId);
  if (!(await ads.adsEnabled(biz))) return { issues: [], unread: 0, billingProblem: null };
  const r = await dbRequest(`ad_issues?business_id=eq.${biz}&select=ad_id,kind,ad_name,status,reasons,first_seen_at,updated_at,acknowledged_at,acknowledged_by&order=updated_at.desc&limit=50`);
  const rows = r.ok && Array.isArray(r.data) ? r.data : [];
  return {
    // A payment / account problem (Meta pauses every ad): on the Ads menu badge until it is fixed.
    billingProblem: await require('./adBilling.cjs').problemOf(biz).catch(() => null),
    issues: rows.map((/** @type {Row} */ x) => ({
      adId: x.ad_id, kind: x.kind, adName: x.ad_name, status: x.status, reasons: Array.isArray(x.reasons) ? x.reasons : [],
      since: x.first_seen_at, updatedAt: x.updated_at, acknowledged: !!x.acknowledged_at, acknowledgedBy: x.acknowledged_by || null,
    })),
    unread: rows.filter((/** @type {Row} */ x) => !x.acknowledged_at).length,
  };
}

/** "Got it": mark every open problem as seen (they stay listed until fixed). @param {Staff} staff */
async function acknowledge(staff) {
  const biz = requireBusinessId(staff?.businessId);
  const r = await dbRequest(`ad_issues?business_id=eq.${biz}&acknowledged_at=is.null`, {
    method: 'PATCH', prefer: 'return=minimal', body: { acknowledged_at: new Date().toISOString(), acknowledged_by: staff.email },
  });
  if (!r.ok) return { error: 'Could not save. Has the Ads (phase F) SQL (20261126) been run?' };
  // An auto-paused ad that was seen needs no more listing.
  await dbRequest(`ad_issues?business_id=eq.${biz}&kind=eq.auto_paused&acknowledged_at=not.is.null`, { method: 'DELETE', prefer: 'return=minimal' });
  return listIssues(staff);
}

/**
 * F4: duplicate an ad in Meta: a PAUSED copy in the same ad set ("- Copy" added to the name). Works for any ad
 * in the business's account (made here or in Ads Manager). Owner + manager, like pause / budget.
 * @param {Staff} staff @param {unknown} adId
 */
async function copyAd(staff, adId) {
  const ctx = await ads.controlContext(staff?.businessId);
  if (ctx.error !== undefined) return { error: ctx.error };
  const owned = await ads.ownedObject(ctx, adId, 'name');
  if (owned.error !== undefined) return owned;
  const r = await ads.graph(ctx.version, ctx.token, `${adId}/copies`, { method: 'POST', form: { status_option: 'PAUSED' } });
  const copied = r?.copied_ad_id ? String(r.copied_ad_id) : '';
  if (r?.error || !/^\d{1,25}$/.test(copied)) return { error: r?.error ? ads.actionError(r) : 'Meta didn\'t return the copy. Check Ads Manager before trying again.', status: 502 };
  await ads.audit(staff, ctx.id, 'ads.ad_copied', { adId: String(adId), adName: owned.obj.name || null, copiedAdId: copied });
  return { copiedAdId: copied, message: 'Copied, switched off. It shows here after the next sync (Sync now); change and launch it in Meta Ads Manager, or resume it here.' };
}

module.exports = { reasonsOf, recordIssues, autoPause, listIssues, acknowledge, copyAd, MAX_PAUSES };
