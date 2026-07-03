// Central chart policy — the single source of truth for "what kind of
// chart is this, and how should it behave". Sits one layer above
// js/timeRange.js's generic primitives (createRangeSelector/
// rangeButtonsHtml/filterByRange), which stay category-agnostic. Pages
// should reference CHART_POLICY by category name (via chartRangeSelector()
// or defineChart()) instead of hand-writing a ranges array, so every chart
// in a category gets the same default range, selectable ranges, and
// KPI-sync behavior by construction.
//
// The internal id for the unbounded range is always 'all' (`days: null`)
// everywhere in this codebase - state keys, data-action attributes,
// CHART_POLICY entries. "Lifetime" is a *display label only* (see the
// `all` entries below); do not introduce 'lifetime'/'full'/'max' as a
// competing id anywhere else.
//
// Future policy properties (interpolation, aggregation granularity,
// sampling/downsampling, smoothing, export behavior, annotation sets,
// etc.) belong as new keys on CHART_POLICY[category] (category-wide
// defaults) and/or as overrides on the object returned by defineChart()
// (per-chart overrides) - not as bespoke logic inside individual
// page-render functions or chart factories. This keeps CHART_POLICY the
// single source of truth for "how does this class of chart behave" as the
// dashboard grows.
import { createRangeSelector } from './timeRange.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export const CHART_POLICY = {
  // "What is happening now?" - Live Queue, Running/Pending Jobs, Queue
  // Pressure, Wait Time, node/capacity utilization snapshots and their
  // short history. No Lifetime option by default: an operational chart
  // answering "what's happening now" doesn't usually benefit from decades
  // of history, and offering it invites confusion with Analytical charts.
  operational: {
    defaultRangeId: '7d',
    ranges: [
      { id: '24h', label: '24h', ms: 1 * DAY_MS },
      { id: '7d', label: '7d', ms: 7 * DAY_MS },
      { id: '30d', label: '30d', ms: 30 * DAY_MS },
      { id: '90d', label: '90d', ms: 90 * DAY_MS },
      { id: '180d', label: '180d', ms: 180 * DAY_MS },
    ],
    kpiSyncsByDefault: false, // operational KPI cards show live/current state, not a rolled-up window
  },
  // "How has behaviour changed over time?" - CPU/Memory efficiency, cost,
  // GPU hours, LEAF, user/project/organization trends. Defaults to 180d so
  // users see medium-term behaviour first, with full history one click away.
  analytical: {
    defaultRangeId: '180d',
    ranges: [
      { id: '30d', label: '30d', days: 30 },
      { id: '90d', label: '90d', days: 90 },
      { id: '180d', label: '180d', days: 180 },
      { id: '365d', label: '365d', days: 365 },
      { id: 'all', label: 'Lifetime', days: null },
    ],
    kpiSyncsByDefault: true, // analytical KPI cards track whatever range the chart is showing
  },
  // "How has the platform evolved?" - version adoption, installed software,
  // infrastructure growth, hardware inventory, capacity history. Defaults
  // to the full picture; narrower windows are opt-in.
  historical: {
    defaultRangeId: 'all',
    ranges: [
      { id: '180d', label: '180d', days: 180 },
      { id: '365d', label: '365d', days: 365 },
      { id: 'all', label: 'Lifetime', days: null },
    ],
    kpiSyncsByDefault: true,
  },
};

// One call per page/chart-group: wires a category's range selector and
// declares KPI-sync intent explicitly. `kpiSyncs` can be overridden per
// call site (e.g. a card block that is deliberately a different, fixed
// concept from the chart above it - see Cost Insights' all-time totals)
// but the override should be a conscious, commented choice at the call
// site, not a silent omission.
export function chartRangeSelector(category, { id, stateKey, action, kpiSyncs } = {}) {
  const policy = CHART_POLICY[category];
  if (!policy) throw new Error(`Unknown chart policy category: ${category}`);
  return {
    selector: createRangeSelector({
      id,
      stateKey,
      action,
      ranges: policy.ranges,
      defaultId: policy.defaultRangeId,
    }),
    kpiSyncs: kpiSyncs ?? policy.kpiSyncsByDefault,
  };
}

// Forward-looking declarative layer on top of chartRangeSelector(): where a
// chart's page-render code is already being touched, describe it once as
// data - { id, title, category, valueType, kpiSyncs? } - and derive its
// selector/KPI behavior from that object, rather than calling
// chartRangeSelector()/resolveFormatter() separately. Not a requirement to
// retrofit every existing chart, but new charts (and any chart this pass
// already has to edit) should move to this shape so the codebase converges
// on "charts declare what they are" over time.
export function defineChart({ id, title, category, valueType, kpiSyncs }) {
  const { selector, kpiSyncs: syncs } = chartRangeSelector(category, {
    id,
    stateKey: id,
    action: `set-${id}-range`,
    kpiSyncs,
  });
  return { id, title, category, valueType, selector, kpiSyncs: syncs };
}
