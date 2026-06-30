// Version 1.3 (Reporting & Executive Briefings) - Queue Report. Built
// entirely from already-loaded queueInsights data (same object
// queueOverviewPage()/queueWaitTimesPage()/queueAdvisorPage() already
// render) - no new fetch, no recalculation.
import { reportModel, statGrid, table, chartSection, text, omitted } from '../model.js';

function asObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function asArray(value) { return Array.isArray(value) ? value : []; }
function num(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function durationLabel(seconds) {
  if (seconds === null || seconds === undefined) return '-';
  const s = Number(seconds);
  if (!Number.isFinite(s)) return '-';
  if (s < 60) return `${s.toFixed(0)}s`;
  if (s < 3600) return `${(s / 60).toFixed(1)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Weighted-average per-partition wait stats from already-exported daily
// rows - the exact same aggregation queueWaitTimesPage()'s private
// waitByPartitionRows() does (kept local here since that helper isn't
// exported), just summarizing already-computed daily figures, not
// recalculating wait time itself.
function waitByPartition(series) {
  const byPartition = new Map();
  series.forEach((row) => {
    const n = num(row.jobs_with_wait_time);
    if (!n) return;
    const bucket = byPartition.get(row.partition_name) || { partition: row.partition_name, weightedMedian: 0, weightedP90: 0, jobs: 0 };
    bucket.weightedMedian += (row.median_wait_seconds || 0) * n;
    bucket.weightedP90 += (row.p90_wait_seconds || 0) * n;
    bucket.jobs += n;
    byPartition.set(row.partition_name, bucket);
  });
  return Array.from(byPartition.values()).map((b) => ({
    partition: b.partition,
    medianWait: b.jobs ? b.weightedMedian / b.jobs : null,
    p90Wait: b.jobs ? b.weightedP90 / b.jobs : null,
    jobs: b.jobs,
  }));
}

function waitTrendChartOption(series) {
  const byDate = new Map();
  series.forEach((r) => {
    const n = num(r.jobs_with_wait_time);
    if (!n) return;
    const bucket = byDate.get(r.report_date) || { report_date: r.report_date, sumMedian: 0, sumP90: 0, n: 0 };
    bucket.sumMedian += (r.median_wait_seconds || 0) * n;
    bucket.sumP90 += (r.p90_wait_seconds || 0) * n;
    bucket.n += n;
    byDate.set(r.report_date, bucket);
  });
  const sorted = Array.from(byDate.values()).sort((a, b) => a.report_date.localeCompare(b.report_date));
  return {
    grid: { left: 56, right: 16, top: 24, bottom: 32 },
    xAxis: { type: 'category', data: sorted.map((b) => b.report_date) },
    yAxis: { type: 'value', name: 'minutes', min: 0 },
    series: [
      { type: 'line', name: 'Median wait', data: sorted.map((b) => (b.n ? Math.round(b.sumMedian / b.n / 60) : null)), smooth: true },
      { type: 'line', name: 'P90 wait', data: sorted.map((b) => (b.n ? Math.round(b.sumP90 / b.n / 60) : null)), smooth: true },
    ],
    legend: { data: ['Median wait', 'P90 wait'] },
    tooltip: { trigger: 'axis' },
  };
}

export function buildQueueReportModel(queueInsights) {
  if (!queueInsights || !queueInsights.available) {
    return reportModel({
      reportType: 'queue', title: 'Queue Report', subtitle: 'Queue Insights unavailable',
      generatedAt: new Date().toISOString(), sections: [text('Unavailable', 'Queue Insights data is not currently available.')],
    });
  }

  const cp = asObject(queueInsights.currentPressure);
  const queue = asObject(cp.queue);
  const queueHealth = asObject(cp.queue_health);
  const byPartitionLive = asArray(cp.by_partition);
  const series = asArray(asObject(queueInsights.waitTimeHistory).series);
  // waitTrendChartOption() already aggregates across all partitions by
  // report_date (weighted by jobs_with_wait_time) - the series is
  // per-partition rows with no separate "ALL" aggregate row, same as
  // clusterWaitSeriesRows() in app.js handles it.
  const byPartitionWait = waitByPartition(series);
  const bestWindows = asArray(asObject(queueInsights.submissionPatterns).best_submission_windows).slice(0, 5);
  const pendingReasons = asArray(cp.pending_reasons);

  const busiest = byPartitionLive.slice().sort((a, b) => num(b.pending) - num(a.pending)).slice(0, 5);
  const bottlenecks = byPartitionWait.slice().sort((a, b) => (b.p90Wait || 0) - (a.p90Wait || 0)).slice(0, 5);

  const sections = [
    statGrid('Queue Health', [
      { label: 'Health Status', value: queueHealth.label || '-', trend: queueHealth.score != null ? `Score ${queueHealth.score.toFixed(0)}/100` : '' },
      { label: 'Running Jobs', value: num(queue.running).toLocaleString(), trend: 'Across all partitions' },
      { label: 'Pending Jobs', value: num(queue.pending).toLocaleString(), trend: 'Waiting to start' },
    ]),
    series.length
      ? chartSection('Wait Time Trend', waitTrendChartOption(series), { subtitle: '90-day window, cluster-wide' })
      : omitted('Wait Time Trend', 'No wait-time history available.'),
    byPartitionLive.length
      ? table('Busy Partitions', ['Partition', 'Running', 'Pending'], busiest.map((p) => [p.partition || '-', num(p.running).toLocaleString(), num(p.pending).toLocaleString()]))
      : omitted('Busy Partitions', 'No live partition pressure data available.'),
    bottlenecks.length
      ? table('Capacity Bottlenecks', ['Partition', 'Median Wait', 'P90 Wait', 'Jobs'], bottlenecks.map((b) => [b.partition || '-', durationLabel(b.medianWait), durationLabel(b.p90Wait), b.jobs.toLocaleString()]))
      : omitted('Capacity Bottlenecks', 'No 90-day wait-time-by-partition data available.'),
    bestWindows.length
      ? table('Best Submission Windows', ['Day', 'Hour', 'Median Wait', 'Confidence'], bestWindows.map((w) => [WEEKDAY_NAMES[w.weekday] || '-', `${w.hour_of_day}:00`, durationLabel(w.median_wait_seconds), w.confidence || '-']))
      : omitted('Submission Patterns', 'No submission-pattern data available.'),
    pendingReasons.length
      ? table('Top Pending Reasons', ['Reason', 'Jobs'], pendingReasons.slice(0, 8).map((r) => [r.reason || '-', num(r.count).toLocaleString()]))
      : text('Top Pending Reasons', 'No jobs are currently pending.'),
  ];

  return reportModel({
    reportType: 'queue',
    title: 'Queue Report',
    subtitle: 'Queue health, wait times, and capacity bottlenecks',
    generatedAt: new Date().toISOString(),
    sections,
  });
}
