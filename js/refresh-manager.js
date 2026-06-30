// Centralized client-side auto-refresh for every page (docs/EXECUTIVE_OVERVIEW.md,
// "Auto-Refresh"). This is the single place that schedules background
// refreshes, re-fetches the already-used JSON via the existing data-loader.js
// loaders, decides what to keep vs. discard on a partial failure, and tells
// app.js when to re-render and show the "Dashboard updated" toast. No page
// needs its own refresh code - app.js wires this up once in init().
//
// Deliberately does NOT touch the DOM or know about routing/scroll/<details>
// state - that's app.js's job (it owns render() and the page tree). This
// module only owns: scheduling, re-fetching, merge-on-partial-failure, and
// exposing the "Last updated" label / toast-visible flag for app.js's
// renderShell() to read.
import {
  loadMjolnirData,
  loadNodeInsightsData,
  loadNodeInsightsHistory,
  loadSlurmAnalyticsPipelineStatus,
  loadQueueInsightsData,
  loadSoftwareInventoryData,
  loadSoftwareIntelligenceData,
} from './data-loader.js';

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const INDICATOR_TICK_MS = 15 * 1000;
const TOAST_VISIBLE_MS = 4000;

let started = false;
let refreshIntervalHandle = null;
let tickIntervalHandle = null;
let toastTimeoutHandle = null;
let lastUpdatedAt = null;
let toastVisible = false;
let refreshInFlight = false;

function asObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function hasContent(value) {
  const v = asObject(value);
  return Object.keys(v).length > 0;
}

// One module ("data", the big Mjolnir tree) is "fresh" only when it actually
// came from the live export, not the sample-data/fallback path - a fallback
// must never overwrite real data already on screen.
function isFreshTree(result) {
  return Boolean(result && result.source === 'real-export');
}
function isAvailable(result) {
  return Boolean(result && result.available);
}

// loadQueueInsightsData() fetches 7 independent JSON files and already
// tolerates any single one being missing (tryOptionalJson). For a background
// refresh we go one step further: if a given file fails *this* round but
// succeeded on a previous round, keep the previous value for that file
// specifically, rather than blanking it out just because this one fetch
// attempt came back empty.
function mergeQueueInsights(current, next) {
  if (!isAvailable(next)) return current;
  const c = current || {};
  return {
    available: true,
    error: null,
    currentPressure: hasContent(next.currentPressure) ? next.currentPressure : c.currentPressure,
    partitionPressureHistory: next.partitionPressureHistory?.length ? next.partitionPressureHistory : c.partitionPressureHistory,
    pendingReasonsHistory: next.pendingReasonsHistory?.length ? next.pendingReasonsHistory : c.pendingReasonsHistory,
    queueHealthHistory: next.queueHealthHistory?.length ? next.queueHealthHistory : c.queueHealthHistory,
    waitTimeHistory: hasContent(next.waitTimeHistory) ? next.waitTimeHistory : c.waitTimeHistory,
    submissionPatterns: hasContent(next.submissionPatterns) ? next.submissionPatterns : c.submissionPatterns,
    status: hasContent(next.status) ? next.status : c.status,
  };
}

// "Last updated" must reflect when the displayed data was actually
// generated server-side, not when the browser happened to fetch it - the
// JSON is the source of truth, never an in-memory fetch-time stamp (a fresh
// page load and a background refresh that finds nothing new should report
// the same age). This picks the newest generatedAt across every loaded
// module so the label always reflects the most-recently-published dataset.
function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
function latestGeneratedAt(bundle) {
  const b = bundle || {};
  const candidates = [
    b.data?.generatedAt,
    b.nodeInsights?.generatedAt,
    b.nodeInsightsHistory?.generatedAt,
    b.slurmAnalyticsPipeline?.generatedAt,
    b.queueInsights?.status?.generated_at,
    b.queueInsights?.currentPressure?.generated_at,
    b.softwareInventory?.generatedAt,
  ].map(parseDate).filter(Boolean);
  if (!candidates.length) return null;
  return new Date(Math.max(...candidates.map((d) => d.getTime())));
}

// Exposed so app.js can set the real timestamp the moment data lands (i.e.
// before the first render()), instead of waiting for startAutoRefresh().
export function setLastUpdatedFromBundle(bundle) {
  const found = latestGeneratedAt(bundle);
  if (found) lastUpdatedAt = found;
}

function safeStringify(value) {
  try { return JSON.stringify(value); } catch (error) { return null; }
}
function deepEqual(a, b) {
  const sa = safeStringify(a);
  const sb = safeStringify(b);
  if (sa === null || sb === null) return false;
  return sa === sb;
}

// Reuses the exact seven loaders init() already calls - no duplicate fetch
// logic anywhere in this file. Each loader already catches its own errors
// and returns an "unavailable"/fallback shape rather than throwing, but
// Promise.allSettled is kept as a second line of defense so one truly
// unexpected throw can never take down the whole refresh cycle.
async function fetchAll() {
  const settled = await Promise.allSettled([
    loadMjolnirData(),
    loadNodeInsightsData(),
    loadNodeInsightsHistory(),
    loadSlurmAnalyticsPipelineStatus(),
    loadQueueInsightsData(),
    loadSoftwareInventoryData(),
    loadSoftwareIntelligenceData(),
  ]);
  const value = (result) => (result.status === 'fulfilled' ? result.value : null);
  const [dataResult, nodeInsightsResult, nodeInsightsHistoryResult, slurmResult, queueResult, softwareResult, softwareIntelligenceResult] = settled.map(value);
  return { dataResult, nodeInsightsResult, nodeInsightsHistoryResult, slurmResult, queueResult, softwareResult, softwareIntelligenceResult };
}

export function lastUpdatedLabel() {
  if (!lastUpdatedAt) return 'never';
  const ms = Date.now() - lastUpdatedAt.getTime();
  if (ms < 60 * 1000) return 'just now';
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function isToastVisible() { return toastVisible; }
export function getLastUpdatedAt() { return lastUpdatedAt; }

function showToast(hooks) {
  toastVisible = true;
  hooks.setToastVisible?.(true);
  if (toastTimeoutHandle) clearTimeout(toastTimeoutHandle);
  toastTimeoutHandle = window.setTimeout(() => {
    toastVisible = false;
    hooks.setToastVisible?.(false);
  }, TOAST_VISIBLE_MS);
}

// hooks:
//   getCurrent()      -> { data, nodeInsights, nodeInsightsHistory, slurmAnalyticsPipeline, queueInsights, softwareInventory }
//   applyUpdate(next) -> assign next.* onto app.js's own module-level state
//   rerender()        -> app.js's render(), wrapped so it preserves route/
//                        scroll/<details> state (app.js's responsibility)
//   updateIndicator()  -> cheap, render()-free DOM patch of the "Last
//                        updated" text (no full re-render just for a clock tick)
//   setToastVisible(bool) -> cheap DOM class toggle for the toast, also
//                        render()-free
async function runRefreshCycle(hooks) {
  if (refreshInFlight) return; // never overlap two in-flight refreshes
  refreshInFlight = true;
  try {
    const fetched = await fetchAll();
    const current = hooks.getCurrent();
    const next = {
      data: isFreshTree(fetched.dataResult) ? fetched.dataResult : current.data,
      nodeInsights: isAvailable(fetched.nodeInsightsResult) ? fetched.nodeInsightsResult : current.nodeInsights,
      nodeInsightsHistory: isAvailable(fetched.nodeInsightsHistoryResult) ? fetched.nodeInsightsHistoryResult : current.nodeInsightsHistory,
      slurmAnalyticsPipeline: isAvailable(fetched.slurmResult) ? fetched.slurmResult : current.slurmAnalyticsPipeline,
      queueInsights: mergeQueueInsights(current.queueInsights, fetched.queueResult),
      softwareInventory: isAvailable(fetched.softwareResult) ? fetched.softwareResult : current.softwareInventory,
      softwareIntelligence: isAvailable(fetched.softwareIntelligenceResult) ? fetched.softwareIntelligenceResult : current.softwareIntelligence,
    };
    const changed = !deepEqual(current, next);
    setLastUpdatedFromBundle(next);
    if (changed) {
      hooks.applyUpdate(next);
      hooks.rerender();
      showToast(hooks);
    } else {
      hooks.updateIndicator();
    }
  } catch (error) {
    // Loaders already swallow their own errors; this guards the rare case
    // that isn't one of them (e.g. a bug above). Either way: never clear
    // existing data, never throw out of the timer, just retry next interval.
    if (window.console && typeof window.console.debug === 'function') {
      window.console.debug('[refresh-manager] refresh cycle skipped:', error);
    }
  } finally {
    refreshInFlight = false;
  }
}

// Starts the singleton 5-minute refresh loop plus a lightweight 15s "Last
// updated" label tick. Safe to call more than once - only the first call
// does anything, so app.js can call it unconditionally after its first
// render() without risking duplicate timers (no memory leak from repeated
// init() calls, e.g. in tests or hot reload).
export function startAutoRefresh(hooks) {
  if (started) return;
  started = true;

  tickIntervalHandle = window.setInterval(() => {
    hooks.updateIndicator?.();
  }, INDICATOR_TICK_MS);

  refreshIntervalHandle = window.setInterval(() => {
    runRefreshCycle(hooks);
  }, REFRESH_INTERVAL_MS);
}

// Exposed for completeness/tests - not called in normal operation since the
// dashboard is a single long-lived tab for the lifetime of the page.
export function stopAutoRefresh() {
  if (refreshIntervalHandle) clearInterval(refreshIntervalHandle);
  if (tickIntervalHandle) clearInterval(tickIntervalHandle);
  if (toastTimeoutHandle) clearTimeout(toastTimeoutHandle);
  refreshIntervalHandle = null;
  tickIntervalHandle = null;
  toastTimeoutHandle = null;
  started = false;
}
