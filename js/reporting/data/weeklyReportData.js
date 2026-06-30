// Version 1.3 (Reporting & Executive Briefings) - Weekly Operational Report.
// Same rule as every other report: built entirely from data already loaded
// by app.js's init(), no new fetch, no recalculation.
import { reportModel, statGrid, table, chartSection, text, recommendationList, omitted } from '../model.js';
import { queuePressureInsight, avgTrendWindow } from '../rules/insights.js';

function asObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function asArray(value) { return Array.isArray(value) ? value : []; }
function num(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }

export function buildWeeklyReportModel(ctx) {
  const { data, queueInsights, nodeInsightsHistory, warehouseSummary, operationalEvents, capacityHistoryChartOption } = ctx;

  const allTime = asObject(data?.clusterSummary?.allTime);
  const rolling7d = asObject(data?.clusterSummary?.rolling7d);

  const waitSeries = asArray(asObject(queueInsights?.waitTimeHistory).series)
    .filter((row) => row.partition_name == null || row.partition_name === 'ALL');
  const currentAvgWait = avgTrendWindow(waitSeries, 'avg_wait_seconds', 0, 6);
  const previousAvgWait = avgTrendWindow(waitSeries, 'avg_wait_seconds', 7, 13);
  const queueInsight = queuePressureInsight(currentAvgWait, previousAvgWait);

  const now = Date.now();
  const sevenDaysAgo = now - 7 * 86400000;
  const capacityPoints = asArray(nodeInsightsHistory?.capacity)
    .filter((p) => p && p.timestamp && new Date(p.timestamp).getTime() >= sevenDaysAgo);
  const capacityAvailable = Boolean(nodeInsightsHistory?.available) && capacityPoints.length > 1;

  const recentEvents = asArray(operationalEvents).filter((e) => {
    const t = new Date(`${e.date}T00:00:00Z`).getTime();
    return t >= sevenDaysAgo && t <= now;
  });

  const overnight = warehouseSummary?.overnight || null;

  const sections = [
    text(
      'Weekly Summary',
      queueInsight ? queueInsight.text : 'Weekly queue comparison unavailable.'
    ),
    statGrid('Weekly Usage', [
      { label: 'Jobs (7d)', value: num(rolling7d.jobs)?.toLocaleString() ?? '-', trend: 'Rolling 7-day window' },
      { label: 'CPU Hours (7d)', value: num(rolling7d.cpu_hours_allocated)?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? '-', trend: 'Rolling 7-day window' },
      { label: 'GPU Hours (7d)', value: num(rolling7d.gpu_hours)?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? '-', trend: 'Rolling 7-day window' },
      { label: 'Estimated Cost (7d)', value: num(rolling7d.estimated_cost_dkk) != null ? `${num(rolling7d.estimated_cost_dkk).toLocaleString(undefined, { maximumFractionDigits: 0 })} DKK` : '-', trend: 'Rolling 7-day window' },
    ]),
    chartSection(
      'Queue Wait Time Trend',
      queueWaitChartOption(waitSeries.filter((r) => new Date(`${r.report_date}T00:00:00Z`).getTime() >= sevenDaysAgo)),
      { subtitle: 'Last 7 days, cluster-wide median wait' }
    ),
    capacityAvailable
      ? chartSection('Capacity Changes', capacityHistoryChartOption(capacityPoints), { subtitle: 'Last 7 days' })
      : omitted('Capacity Changes', 'Node Insights history is not yet available for this window.'),
    overnight
      ? statGrid('New Activity (most recent night)', [
          { label: 'New Users', value: num(overnight.new_users) ?? 0, trend: overnight.report_date || '' },
          { label: 'New Projects', value: num(overnight.new_projects) ?? 0, trend: overnight.report_date || '' },
          { label: 'New Accounts', value: num(overnight.new_accounts) ?? 0, trend: overnight.report_date || '' },
        ])
      : omitted('New Activity', 'No overnight import recorded yet.'),
    // True 7-day-summed new-user/new-project totals are not exported -
    // only the most recent single night's delta is published (see above).
    // Per the v1.3 plan's "known data gaps" policy, this is omitted rather
    // than approximated from a single night's figure mislabeled as weekly.
    omitted('New Users/Projects (7-day total)', 'Only the most recent single night\'s new-user/new-project delta is exported today, not a 7-day sum - see the figure above for that single night.'),
    recentEvents.length
      ? table('Significant Events', ['Date', 'Event', 'Type'], recentEvents.map((e) => [e.date, e.label, e.type]))
      : text('Significant Events', 'No significant operational events recorded in the last 7 days.'),
    recommendationList('Recommendations', [
      ...(queueInsight ? [{ severity: queueInsight.severity, title: queueInsight.text, suggestion: '' }] : []),
      ...asArray(allTime.recommendations || data?.recommendations).slice(0, 5).map((r) => ({ severity: r.severity || r.priority || 'info', title: r.title, suggestion: r.detail || r.suggestion || '' })),
    ]),
  ];

  return reportModel({
    reportType: 'weekly',
    title: 'Weekly Operational Report',
    subtitle: 'Usage, queue trends, and significant events for the past 7 days',
    generatedAt: new Date().toISOString(),
    metadata: { window: '7d' },
    sections,
  });
}

// Builds a plain ECharts option for a small multi-series wait-time line
// chart from already-exported wait_time_history rows - no recomputation,
// just option-building (the same role baseChartOption()/lineSeries() play
// in charts.js, kept local here since those two helpers aren't exported).
function queueWaitChartOption(rows) {
  const byDate = new Map();
  rows.forEach((r) => {
    const bucket = byDate.get(r.report_date) || { report_date: r.report_date, sum: 0, n: 0 };
    if (r.median_wait_seconds != null) { bucket.sum += r.median_wait_seconds; bucket.n += 1; }
    byDate.set(r.report_date, bucket);
  });
  const sorted = Array.from(byDate.values()).sort((a, b) => a.report_date.localeCompare(b.report_date));
  const categories = sorted.map((b) => b.report_date);
  const values = sorted.map((b) => (b.n ? Math.round(b.sum / b.n / 60) : null));
  return {
    grid: { left: 48, right: 16, top: 24, bottom: 32 },
    xAxis: { type: 'category', data: categories },
    yAxis: { type: 'value', name: 'minutes', min: 0 },
    series: [{ type: 'line', data: values, smooth: true, name: 'Median wait (min)' }],
    tooltip: { trigger: 'axis' },
  };
}
