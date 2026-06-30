// Deterministic, rule-based report insights ("Queue pressure increased by
// 14%", "Three nodes are unavailable", "Warehouse updated successfully").
//
// IMPORTANT BOUNDARY (see docs/architecture/REPORTING_ARCHITECTURE.md):
// these helpers only ever COMPARE OR THRESHOLD numbers the warehouse has
// already computed - percent-change between two already-exported figures,
// a count already in an exported object, a freshness check against an
// already-exported timestamp. They never recompute an efficiency, cost,
// or aggregation metric from raw data. Per-job/per-entity efficiency
// recommendations are a SEPARATE, pre-existing category already generated
// server-side (export_analytics_data.py's recommendations()) and are
// surfaced as-is by report data assemblers - this module never duplicates
// or regenerates those.
//
// No LLM summarization anywhere in this module - every insight below is a
// plain comparison or threshold check with a fixed text template.

export function percentChange(current, previous) {
  if (current == null || previous == null || !Number.isFinite(Number(previous)) || Number(previous) === 0) {
    return null;
  }
  return ((Number(current) - Number(previous)) / Math.abs(Number(previous))) * 100;
}

function trendWord(change) {
  if (change == null) return null;
  if (change > 0) return 'increased';
  if (change < 0) return 'improved';
  return 'held steady';
}

// Compares this week's vs. last week's average wait time (both already
// exported in wait_time_history.json's daily rows - this only sums/averages
// already-final per-day numbers, see the v1.3 plan's "previous period"
// derivation note).
export function queuePressureInsight(currentAvgWaitSeconds, previousAvgWaitSeconds) {
  const change = percentChange(currentAvgWaitSeconds, previousAvgWaitSeconds);
  if (change == null) return null;
  const rounded = Math.abs(change).toFixed(0);
  if (Math.abs(change) < 3) {
    return { severity: 'info', text: 'Queue pressure is stable compared to the prior period.' };
  }
  if (change > 0) {
    return { severity: change > 15 ? 'high' : 'medium', text: `Queue pressure increased by ${rounded}% (average wait time) compared to the prior period.` };
  }
  return { severity: 'info', text: `Queue pressure is improving - average wait time decreased by ${rounded}% compared to the prior period.` };
}

// allocPct/totalUnits already come from the exported cluster_overview snapshot
// (Node Insights) - no recomputation.
export function gpuDemandInsight(gpuAllocPct, gpuPending) {
  if (gpuAllocPct == null) return null;
  if (gpuAllocPct >= 90) {
    return { severity: 'high', text: `GPU demand exceeds capacity - ${gpuAllocPct.toFixed(0)}% of GPUs allocated${gpuPending ? `, ${gpuPending} job(s) pending` : ''}.` };
  }
  if (gpuAllocPct >= 70) {
    return { severity: 'medium', text: `GPU utilization is high (${gpuAllocPct.toFixed(0)}% allocated).` };
  }
  return { severity: 'info', text: `GPU capacity is stable (${gpuAllocPct.toFixed(0)}% allocated).` };
}

// nodesDraining already comes from the exported cluster_overview.totals -
// no recomputation. (cluster_overview.maintenance.nodes_draining mirrors the
// same count with per-node detail; totals.nodes_draining is the headline
// figure every other page already reads, so this stays consistent with
// Capacity Planning/Infrastructure Overview rather than introducing a
// second, slightly different "unavailable" definition.)
export function nodeAvailabilityInsight(nodesDraining) {
  const unavailable = Number(nodesDraining) || 0;
  if (unavailable === 0) {
    return { severity: 'info', text: 'All nodes are online - none draining.' };
  }
  const word = unavailable === 1 ? 'node is' : 'nodes are';
  return { severity: unavailable >= 3 ? 'medium' : 'info', text: `${unavailable} ${word} unavailable (draining for maintenance).` };
}

// collectorStatus/lastPublishAt already come from the exported Platform
// Status document - no recomputation, just a freshness/status check.
export function warehouseFreshnessInsight(collectorStatus, generatedAtIso, expectedRefreshSeconds) {
  if (collectorStatus === 'failed') {
    return { severity: 'high', text: 'Warehouse export reported a failure on its last run - see Platform Status for details.' };
  }
  if (!generatedAtIso) {
    return { severity: 'medium', text: 'Warehouse freshness could not be determined - no generation timestamp available.' };
  }
  const ageSeconds = (Date.now() - new Date(generatedAtIso).getTime()) / 1000;
  if (expectedRefreshSeconds && ageSeconds > expectedRefreshSeconds * 2) {
    return { severity: 'high', text: 'Warehouse data is stale - the last successful export is significantly overdue.' };
  }
  return { severity: 'info', text: 'Warehouse updated successfully and is current.' };
}

// capacityAllocPct already comes from the exported cluster_overview snapshot.
export function capacityInsight(label, allocPct) {
  if (allocPct == null) return null;
  if (allocPct >= 90) return { severity: 'high', text: `${label} utilization is near capacity (${allocPct.toFixed(0)}%).` };
  if (allocPct <= 30) return { severity: 'info', text: `${label} has headroom (${allocPct.toFixed(0)}% allocated).` };
  return { severity: 'info', text: `${label} capacity is stable (${allocPct.toFixed(0)}% allocated).` };
}

// Coverage-checked sum over an already-exported daily_trends slice (used for
// "previous period" comparisons - see the v1.3 plan). Returns null rather
// than a misleading partial average if too many days are missing from the
// requested window.
export function sumTrendWindow(dailyTrends, field, startDaysAgo, endDaysAgo, { minCoverageDays = 5 } = {}) {
  const rows = Array.isArray(dailyTrends) ? dailyTrends : [];
  if (!rows.length) return null;
  const latest = rows.reduce((max, row) => (row && row.report_date > max ? row.report_date : max), rows[0]?.report_date || '');
  if (!latest) return null;
  const latestMs = new Date(`${latest}T00:00:00Z`).getTime();
  const windowRows = rows.filter((row) => {
    if (!row || !row.report_date) return false;
    const ms = new Date(`${row.report_date}T00:00:00Z`).getTime();
    const daysAgo = (latestMs - ms) / 86400000;
    return daysAgo >= endDaysAgo && daysAgo <= startDaysAgo;
  });
  const expectedDays = startDaysAgo - endDaysAgo + 1;
  if (windowRows.length < Math.min(minCoverageDays, expectedDays)) return null;
  const values = windowRows.map((row) => Number(row[field])).filter(Number.isFinite);
  if (!values.length) return null;
  return values.reduce((sum, v) => sum + v, 0);
}

export function avgTrendWindow(dailyTrends, field, startDaysAgo, endDaysAgo, opts) {
  const rows = Array.isArray(dailyTrends) ? dailyTrends : [];
  const latest = rows.reduce((max, row) => (row && row.report_date > max ? row.report_date : max), rows[0]?.report_date || '');
  if (!latest) return null;
  const latestMs = new Date(`${latest}T00:00:00Z`).getTime();
  const windowRows = rows.filter((row) => {
    if (!row || !row.report_date) return false;
    const ms = new Date(`${row.report_date}T00:00:00Z`).getTime();
    const daysAgo = (latestMs - ms) / 86400000;
    return daysAgo >= endDaysAgo && daysAgo <= startDaysAgo;
  });
  const minCoverageDays = (opts && opts.minCoverageDays) || 5;
  const expectedDays = startDaysAgo - endDaysAgo + 1;
  if (windowRows.length < Math.min(minCoverageDays, expectedDays)) return null;
  const values = windowRows.map((row) => Number(row[field])).filter(Number.isFinite);
  if (!values.length) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
