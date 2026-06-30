// Version 1.3 (Reporting & Executive Briefings) - User Report. Built
// entirely from the already-loaded PersonalUserViewModel (the exact same
// object Personal Analytics renders - see data-loader.js's
// normalizePersonalUserViewModel()) - no new fetch, no recalculation, and
// reuses the SAME personal_route_token capability-link privacy model: this
// report is reached only via #/u/<token>/report, never a separate,
// more-guessable identifier (see app.js's isPersonalRoute()).
//
// Known data gap: the legacy `ranking` field (rank/totalUsers/label) is
// effectively unpopulated since the Version 1.2 migration (replaced by
// rolling_summaries/percentile_position) - omitted in favor of
// percentile_position, which is the real, currently-exported ranking
// signal.
import { reportModel, statGrid, table, text, recommendationList, omitted } from '../model.js';
import { sumTrendWindow } from '../rules/insights.js';

function asArray(value) { return Array.isArray(value) ? value : []; }
function pctLabel(value) { return value == null ? '-' : `${(Number(value) * 100).toFixed(0)}%`; }
function moneyLabel(value) { return value == null ? '-' : `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })} DKK`; }

function percentileBand(value) {
  if (value == null) return 'Unavailable';
  if (value >= 75) return 'Top quartile (high resource use)';
  if (value >= 50) return 'Above median';
  if (value >= 25) return 'Below median';
  return 'Bottom quartile';
}

export function buildUserReportModel(vm) {
  if (!vm) {
    return reportModel({
      reportType: 'user',
      title: 'User Report',
      subtitle: 'No personal bundle loaded',
      generatedAt: new Date().toISOString(),
      sections: [text('Not Found', 'Open this report via your personal Analytics link (#/u/<token>/report).')],
    });
  }

  const m = vm.metrics || {};
  const p = vm.percentile || {};
  const recs = asArray(vm.recommendations);
  const jobs = asArray(vm.topInefficientJobs);
  const trends = asArray(vm.trends);

  // "Progress vs. previous period": coverage-checked sum over the
  // already-exported daily_trends 8-14-days-ago slice vs. the 0-6-days-ago
  // slice (see rules/insights.js's sumTrendWindow - returns null rather
  // than a misleading partial figure if either window has too few days).
  const currentCost = sumTrendWindow(trends, 'estimated_cost_dkk', 0, 6);
  const previousCost = sumTrendWindow(trends, 'estimated_cost_dkk', 7, 13);
  const progressAvailable = currentCost != null && previousCost != null;

  const sections = [
    text('Summary', `Personal usage report for ${vm.displayPseudonym}.`),
    statGrid('Usage', [
      { label: 'Jobs (all-time)', value: m.jobs?.toLocaleString() ?? '-', trend: 'All-time' },
      { label: 'Completed', value: m.completedJobs?.toLocaleString() ?? '-', trend: 'All-time' },
      { label: 'Failed', value: m.failedJobs?.toLocaleString() ?? '-', trend: 'All-time' },
      { label: 'GPU Hours', value: m.gpuHours?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? '-', trend: 'All-time' },
      { label: 'Estimated Cost', value: moneyLabel(m.estimatedCost), trend: 'All-time' },
      { label: 'Savings Opportunity', value: moneyLabel(m.potentialSavings), trend: 'All-time' },
    ]),
    statGrid('Efficiency', [
      { label: 'CPU Efficiency', value: pctLabel(m.cpuEfficiency), trend: 'All-time average' },
      { label: 'Memory Efficiency', value: pctLabel(m.memoryEfficiency), trend: 'All-time average' },
      { label: 'Cost Bearer', value: m.costBearer || '-', trend: 'Dominant cost driver' },
    ]),
    statGrid('Ranking & Percentiles', [
      { label: 'Overall Percentile', value: p.overall != null ? `${p.overall.toFixed(0)}th` : '-', trend: percentileBand(p.overall) },
      { label: 'CPU Percentile', value: p.cpu != null ? `${p.cpu.toFixed(0)}th` : '-', trend: 'Among comparable users' },
      { label: 'Memory Percentile', value: p.memory != null ? `${p.memory.toFixed(0)}th` : '-', trend: 'Among comparable users' },
      { label: 'Savings Percentile', value: p.savings != null ? `${p.savings.toFixed(0)}th` : '-', trend: 'Among comparable users' },
    ]),
    progressAvailable
      ? statGrid('Progress vs. Previous Period', [
          { label: 'Cost (last 7 days)', value: moneyLabel(currentCost), trend: 'Sum of daily figures' },
          { label: 'Cost (prior 7 days)', value: moneyLabel(previousCost), trend: 'Sum of daily figures' },
          { label: 'Change', value: `${(((currentCost - previousCost) / Math.abs(previousCost || 1)) * 100).toFixed(0)}%`, trend: currentCost > previousCost ? 'Increased' : 'Decreased', tone: currentCost > previousCost ? 'warn' : 'good' },
        ])
      : omitted('Progress vs. Previous Period', 'Not enough daily history is available yet to compare the last two 7-day windows.'),
    jobs.length
      ? table('Top Inefficient Jobs', ['CPU Eff.', 'Mem Eff.', 'Elapsed (h)', 'GPUs', 'Cost', 'Waste'], jobs.slice(0, 10).map((j) => [
          pctLabel(j.cpuEfficiency),
          pctLabel(j.memoryEfficiency),
          j.elapsedHours?.toFixed(1) ?? '-',
          j.gpuCount?.toString() ?? '0',
          moneyLabel(j.estimatedCost),
          moneyLabel(j.costBearerWaste),
        ]))
      : text('Top Inefficient Jobs', 'No inefficient jobs identified for this period.'),
    recommendationList('Recommendations', recs.map((r) => ({
      severity: r.severity || r.priority || 'info',
      title: r.title,
      suggestion: r.detail || r.suggestion || '',
    }))),
  ];

  return reportModel({
    reportType: 'user',
    title: 'My Analytics Report',
    subtitle: `Public pseudonym: ${vm.displayPseudonym}`,
    generatedAt: new Date().toISOString(),
    metadata: { routeToken: vm.routeToken },
    sections,
  });
}
