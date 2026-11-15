// Scheduled every 5 minutes (see netlify.toml).
//  1. Sends follow-ups (automations) that are due   - time-sensitive, goes first
//  2. Checks for quiet customers ("inactive" automations), about hourly
//  3. Sends queued broadcast campaign messages with the remaining time
//  4. Syncs Meta ad results (Ads module): each account about hourly; a new account's first 30 days over a few runs
// When nothing is waiting it makes a few cheap database calls and exits.
// Every run is recorded in worker_runs (steps, counts, duration, errors) for the Platform
// Admin's console; failed steps also go to system_events.
const { processBatches } = require('../../server/campaigns.cjs');
const { processDueRuns, scanInactive } = require('../../server/automations.cjs');
const { enforceBilling } = require('../../server/limits.cjs');
const { autoClose: autoCloseQueries } = require('../../server/queries.cjs');
const { syncDue: syncAdsDue } = require('../../server/ads.cjs');
const events = require('../../server/events.cjs');

// Scheduled functions may run up to 30s; leave a safety margin.
const BUDGET_MS = 25000;

const TASKS = {
  enforceBilling, autoCloseQueries, prune: () => events.prune(), processDueRuns, scanInactive, processBatches, syncAdsDue,
  recordingSweep: (/** @type {any} */ o) => require('../../server/callRecordings.cjs').sweep(o),
  adConversions: (/** @type {any} */ o) => require('../../server/adConversions.cjs').sweep(o),
  signupPrune: () => require('../../server/signupRequests.cjs').prune(),
  importUndoPrune: () => require('../../server/leadImport.cjs').pruneUndo(),
  activityPrune: () => require('../../server/activity.cjs').prune(),
};

async function runWorker({ now = () => Date.now(), hourly = new Date().getUTCMinutes() < 5, tasks = {} } = {}) {
  const t = { ...TASKS, ...tasks }; // tests may replace a task
  const started = now();
  const steps = {};
  const errors = [];

  // Runs one step; records its result (counts only) and time, or its error.
  const step = async (name, fn) => {
    const t0 = now();
    try {
      const out = await fn();
      if (out !== undefined && out !== null) steps[name] = { result: summarize(out), ms: now() - t0 };
      else steps[name] = { skipped: true };
    } catch (err) {
      console.error(`[worker] ${name} failed:`, events.scrub(err?.stack || err?.message || err, 1000));
      errors.push({ step: name, message: err?.message || String(err) });
      steps[name] = { failed: true, ms: now() - t0 };
      await events.logEvent({ level: 'error', source: 'worker', code: `${name}_failed`, message: err?.message || String(err) });
    }
  };
  const left = () => BUDGET_MS - (now() - started);

  // Payments: a business more than the grace period past its "paid until" date is paused.
  // Checked once an hour (the first run of each hour) - payments are counted in days.
  if (hourly) {
    await step('billing', () => t.enforceBilling());
    // Queries resolved 3+ days ago with no objection are closed (hourly is plenty).
    await step('queriesAutoClose', () => t.autoCloseQueries());
    // Retention: old events and worker runs are deleted.
    await step('prune', () => t.prune());
    // Retention (DPDP): decided sign-up requests are deleted after 30 / 90 days.
    await step('signupPrune', () => t.signupPrune());
    // Customer imports: the old values kept for Undo are deleted after the 7-day window (they may hold private details).
    await step('importUndoPrune', () => t.importUndoPrune());
    await step('activityPrune', () => t.activityPrune());
  }
  // Maintenance mode (Platform Admin): hold everything that sends to customers or calls Meta; it all
  // continues on the first run after maintenance ends. (The webhook and bot keep running.)
  const maint = await (t.maintenanceState || (() => require('../../server/maintenance.cjs').getState({ fresh: true })))().catch(() => ({ on: false }));
  if (maint.on) {
    steps.maintenance = { result: { on: true }, ms: 0 };
    const finished = now();
    await events.recordWorkerRun({ startedAt: started, finishedAt: finished, steps, errors });
    return { steps, errors, durationMs: finished - started };
  }
  await step('followUps', () => t.processDueRuns({ deadlineMs: 10000 }));
  await step('inactiveScan', () => t.scanInactive());
  await step('campaigns', () => (left() > 5000 ? t.processBatches({ deadlineMs: left() }) : null));
  // Ad results from Meta, with whatever time is left. syncDue itself limits each account to about
  // once an hour; checking every run lets a newly connected account load its first 30 days in a few
  // runs (one cheap database read when nothing is due). Low priority, so it goes last.
  await step('adsSync', () => (left() > 6000 ? t.syncAdsDue({ deadlineMs: left() - 2000 }) : null));
  // Call recordings: join pieces left by a browser that closed mid-call; delete recordings past 90 days.
  await step('callRecordings', () => (left() > 4000 ? t.recordingSweep({ deadlineMs: left() - 2000 }) : null));
  // Bookings from Click-to-WhatsApp ads, reported to Meta (Ads E1; one cheap read when nothing waits).
  await step('adConversions', () => (left() > 3000 ? t.adConversions({ deadlineMs: left() - 2000 }) : null));

  const finished = now();
  await events.recordWorkerRun({ startedAt: started, finishedAt: finished, steps, errors });
  const busy = Object.entries(steps).filter(([, s]) => s.result && Object.values(s.result).some(v => v));
  if (busy.length || errors.length) console.log('[worker]', JSON.stringify({ steps: Object.fromEntries(busy), errors: errors.length }));
  return { steps, errors, durationMs: finished - started };
}

/** Keep only numbers and booleans from a step's result (never contact data). */
function summarize(out) {
  if (typeof out === 'number' || typeof out === 'boolean') return { value: out };
  const r = {};
  for (const [k, v] of Object.entries(out || {})) {
    if (typeof v === 'number' || typeof v === 'boolean') r[k] = v;
  }
  return r;
}

exports.handler = async () => {
  await runWorker();
  return { statusCode: 200 };
};
exports.runWorker = runWorker;
exports.summarize = summarize;
