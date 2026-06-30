// Version 1.3 (Reporting & Executive Briefings) - Executive Report.
// Assembles a ReportModel entirely from data already loaded by app.js's
// init() (data, nodeInsights, queueInsights, slurmAnalyticsPipeline) plus
// the already-computed warehouseSummary/platformRegistry derived view-models
// - no new fetch, no recalculation. See docs/architecture/REPORTING_ARCHITECTURE.md.
import { reportModel, statGrid, table, text, recommendationList } from '../model.js';
import {
  queuePressureInsight, gpuDemandInsight, nodeAvailabilityInsight,
  warehouseFreshnessInsight, capacityInsight, avgTrendWindow,
} from '../rules/insights.js';

function asObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function asArray(value) { return Array.isArray(value) ? value : []; }
function num(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }

function durationLabel(seconds) {
  if (seconds === null || seconds === undefined) return 'Unavailable';
  const s = Number(seconds);
  if (!Number.isFinite(s)) return 'Unavailable';
  if (s < 60) return `${s.toFixed(0)}s`;
  if (s < 3600) return `${(s / 60).toFixed(1)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// `ctx` carries exactly the same module-level objects app.js's page
// functions already read (data, nodeInsights, queueInsights,
// slurmAnalyticsPipeline, warehouseSummary) - passed in explicitly so this
// module never reaches into app.js's private state and stays independently
// testable.
export function buildExecutiveReportModel(ctx) {
  const { data, nodeInsights, queueInsights, warehouseSummary } = ctx;

  const co = asObject(nodeInsights?.clusterOverview);
  const totals = asObject(co.totals);
  const cpu = asObject(co.cpu);
  const mem = asObject(co.memory_mib);
  const gpu = asObject(co.gpu);
  const cpuPct = cpu.alloc_pct != null ? cpu.alloc_pct * 100 : null;
  const memPct = mem.alloc_pct != null ? mem.alloc_pct * 100 : null;
  const gpuPct = (gpu.alloc_pct_of_online ?? gpu.alloc_pct) != null ? (gpu.alloc_pct_of_online ?? gpu.alloc_pct) * 100 : null;

  const cp = asObject(queueInsights?.currentPressure);
  const queue = asObject(cp.queue);
  const queueHealth = asObject(cp.queue_health);
  const byPartition = asArray(cp.by_partition);
  const busiest = byPartition.slice().sort((a, b) => num(b.pending) - num(a.pending))[0] || null;
  const bestWindow = asArray(asObject(queueInsights?.submissionPatterns).best_submission_windows)
    .slice().sort((a, b) => num(a.median_wait_seconds) - num(b.median_wait_seconds))[0] || null;

  const waitSeries = asArray(asObject(queueInsights?.waitTimeHistory).series);
  const clusterWait = waitSeries.filter((row) => row.partition_name == null || row.partition_name === 'ALL');
  const currentAvgWait = avgTrendWindow(
    clusterWait.map((r) => ({ report_date: r.report_date, avg_wait_seconds: r.avg_wait_seconds })),
    'avg_wait_seconds', 0, 6
  );
  const previousAvgWait = avgTrendWindow(
    clusterWait.map((r) => ({ report_date: r.report_date, avg_wait_seconds: r.avg_wait_seconds })),
    'avg_wait_seconds', 7, 13
  );

  const allTime = asObject(data?.clusterSummary?.allTime);
  const clusterRecommendations = asArray(data?.recommendations).slice(0, 8);

  // --- Rule-based insights (comparison/threshold over already-exported numbers only) ---
  const insights = [
    queuePressureInsight(currentAvgWait, previousAvgWait),
    gpuDemandInsight(gpuPct, queue.pending),
    nodeAvailabilityInsight(totals.nodes_draining),
    warehouseFreshnessInsight(
      ctx.slurmAnalyticsPipeline?.collectorStatus,
      ctx.slurmAnalyticsPipeline?.generatedAt,
      ctx.slurmAnalyticsPipeline?.expectedRefreshSeconds
    ),
    capacityInsight('CPU', cpuPct),
    capacityInsight('Memory', memPct),
  ].filter(Boolean);

  const majorIssues = insights.filter((i) => i.severity === 'high');
  const summaryText = majorIssues.length
    ? `${majorIssues.length} item(s) need attention: ${majorIssues.map((i) => i.text).join(' ')}`
    : 'No major issues detected. Cluster operating within normal parameters.';

  const sections = [
    text('Executive Summary', summaryText),
    statGrid('Cluster Health & Capacity Status', [
      { label: 'Queue Health', value: queueHealth.label || '-', trend: queueHealth.score != null ? `Score ${queueHealth.score.toFixed(0)}/100` : '', tone: queueHealth.label === 'Severely Congested' ? 'warn' : '' },
      { label: 'CPU Utilization', value: cpuPct != null ? `${cpuPct.toFixed(0)}%` : '-', trend: `${num(cpu.alloc) ?? '-'} / ${num(cpu.total) ?? '-'} cores` },
      { label: 'Memory Utilization', value: memPct != null ? `${memPct.toFixed(0)}%` : '-', trend: 'Allocated / total' },
      { label: 'GPU Utilization', value: gpuPct != null ? `${gpuPct.toFixed(0)}%` : '-', trend: `${num(gpu.alloc) ?? '-'} / ${num(gpu.total) ?? '-'} GPUs` },
      { label: 'Nodes Online', value: num(totals.nodes_available) ?? '-', trend: `${num(totals.nodes_draining) ?? 0} draining` },
    ]),
    statGrid('Operations', [
      { label: 'Jobs (all-time)', value: num(allTime.jobs)?.toLocaleString() ?? '-', trend: 'Canonical jobs in warehouse' },
      { label: 'CPU Hours Allocated', value: num(allTime.cpu_hours_allocated)?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? '-', trend: 'All-time' },
      { label: 'GPU Hours', value: num(allTime.gpu_hours)?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? '-', trend: 'All-time' },
      { label: 'Active Users', value: num(allTime.unique_users) ?? '-', trend: 'All-time' },
      { label: 'Active Accounts/Projects', value: num(allTime.unique_accounts) ?? '-', trend: 'All-time' },
    ]),
    statGrid('Queue', [
      { label: 'Running Jobs', value: num(queue.running) ?? '-', trend: 'Across all partitions' },
      { label: 'Pending Jobs', value: num(queue.pending) ?? '-', trend: 'Waiting to start' },
      { label: 'Busiest Partition', value: busiest?.partition || '-', trend: busiest ? `${num(busiest.pending) ?? 0} pending` : '' },
      { label: 'Best Submission Window', value: bestWindow ? `${WEEKDAY_NAMES[bestWindow.weekday] || ''} ${bestWindow.hour_of_day}:00` : 'Unavailable', trend: bestWindow ? `Median wait ${durationLabel(bestWindow.median_wait_seconds)}` : '' },
    ]),
    statGrid('Infrastructure', [
      { label: 'Nodes Online', value: num(totals.nodes_available) ?? '-', trend: 'Not draining, not down' },
      { label: 'Nodes Draining', value: num(totals.nodes_draining) ?? '-', trend: 'Scheduled for maintenance', tone: num(totals.nodes_draining) ? 'warn' : '' },
      { label: 'Nodes Down', value: num(totals.nodes_down) ?? '-', trend: 'Offline', tone: num(totals.nodes_down) ? 'warn' : '' },
      { label: 'Nodes Total', value: num(totals.nodes_total) ?? '-', trend: '' },
    ]),
    statGrid('Warehouse', [
      { label: 'Last Import', value: warehouseSummary?.lastImportAt ? durationLabel(warehouseSummary.lastImportDurationSeconds) : 'Unavailable', trend: warehouseSummary?.lastImportAt || '' },
      { label: 'Last Materialization', value: warehouseSummary?.lastMaterializationAt ? durationLabel(warehouseSummary.lastMaterializationDurationSeconds) : 'Unavailable', trend: warehouseSummary?.lastMaterializationAt || '' },
      { label: 'Last Publish', value: warehouseSummary?.lastPublishAt ? 'Completed' : 'Unavailable', trend: warehouseSummary?.lastPublishAt || '' },
      { label: 'Coverage', value: warehouseSummary?.earliestDate && warehouseSummary?.latestDate ? `${warehouseSummary.earliestDate} to ${warehouseSummary.latestDate}` : '-', trend: 'Warehouse date range' },
    ]),
    recommendationList('Recommendations', [
      ...insights.map((i) => ({ severity: i.severity, title: i.text, suggestion: '' })),
      ...clusterRecommendations.map((r) => ({ severity: r.severity || r.priority || 'info', title: r.title, suggestion: r.detail || r.suggestion || '' })),
    ]),
  ];

  return reportModel({
    reportType: 'executive',
    title: 'Executive Report',
    subtitle: 'Cluster health, operations, and recommendations',
    generatedAt: new Date().toISOString(),
    metadata: { warehouseCoverage: { earliest: warehouseSummary?.earliestDate, latest: warehouseSummary?.latestDate } },
    sections,
  });
}
