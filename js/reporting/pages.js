// Version 1.3 (Reporting & Executive Briefings): one (ctx) => htmlString
// "page" function per report type, the same shape as every existing
// app.js page function (landingPage(), clusterPage(), etc.) - these get
// registered into app.js's existing `renderers` route-dispatch object, so
// they go through the SAME render()/mountCharts()/wireEvents() pipeline
// unmodified. No parallel router, no parallel chart-mounting logic.
import { buildExecutiveReportModel } from './data/executiveReportData.js';
import { buildWeeklyReportModel } from './data/weeklyReportData.js';
import { findPi, buildPiReportModel } from './data/piReportData.js';
import { buildUserReportModel } from './data/userReportData.js';
import { buildQueueReportModel } from './data/queueReportData.js';
import { buildCapacityReportModel } from './data/capacityReportData.js';
import { reportModel, text } from './model.js';
import { reportShellHtml, sectionsToMarkdown } from './render.js';
import { htmlSection } from './model.js';
import { createLineChart, capacityHistoryChartOption } from '../charts.js';
import { pct, money } from '../ui-helpers.js';
import { OPERATIONAL_EVENTS } from '../events.js';

// The most recently rendered report's model, for the "Download Markdown"
// button's click handler (wired in app.js's wireEvents()) to read without
// re-assembling it. Reset on every report-page render; harmless if stale
// (the button only exists in the DOM while a report page is showing).
let currentReportModel = null;
export function getCurrentReportModel() { return currentReportModel; }
export function getCurrentReportMarkdown() { return currentReportModel ? sectionsToMarkdown(currentReportModel) : ''; }

function renderReport(model) {
  currentReportModel = model;
  return reportShellHtml(model);
}

function asArray(value) { return Array.isArray(value) ? value : []; }

// createLineChart() (charts.js) builds its own ECharts option AND calls
// registerChart() AND returns a finished card - it must run here, at
// template-build time, the same place every other app.js page calls it
// (a data assembler can't call it - the chart registry is only valid
// during the current render() pass). See model.js's htmlSection().
export function executiveReportPage(ctx) {
  const model = buildExecutiveReportModel(ctx);
  const trends = asArray(ctx.data?.clusterSummary?.dailyTrends);
  const efficiencyChartHtml = createLineChart(
    'Cluster Efficiency Trend',
    trends,
    [
      { label: 'CPU efficiency', color: '#3e8cff', values: trends.map((r) => r.avg_cpu_efficiency) },
      { label: 'Memory efficiency', color: '#53d88a', values: trends.map((r) => r.avg_memory_efficiency) },
    ],
    pct,
    { zeroBase: true }
  );
  const costChartHtml = createLineChart(
    'Cluster Cost Trend',
    trends,
    [
      { label: 'Estimated cost', color: '#3e8cff', values: trends.map((r) => r.estimated_cost_dkk) },
      { label: 'Optimization opportunity', color: '#ff6b7a', values: trends.map((r) => r.underutilized_cost_dkk) },
    ],
    money,
    { zeroBase: true }
  );
  // Insert before the final Recommendations section so the narrative
  // reads: summary -> KPIs -> operations/queue/infra/warehouse -> trend
  // charts -> recommendations.
  model.sections.splice(
    model.sections.length - 1, 0,
    htmlSection('Cluster Trends', efficiencyChartHtml, { subtitle: '90-day window' }),
    htmlSection('Cost Trends', costChartHtml, { subtitle: '90-day window' })
  );
  return renderReport(model);
}

export function weeklyReportPage(ctx) {
  return renderReport(buildWeeklyReportModel({ ...ctx, operationalEvents: OPERATIONAL_EVENTS, capacityHistoryChartOption }));
}

export function piReportPage(piId, ctx) {
  const pi = findPi(ctx.data?.pis, piId);
  return renderReport(buildPiReportModel(pi));
}

// userCtx mirrors the exact state app.js's personalAnalyticsPage() already
// reads (state.personalLoading/personalError/personalToken/
// personalViewModel) - same async-loading flow, same privacy model, just a
// different render target. See app.js's userReportPage() wrapper.
export function userReportPage(userCtx) {
  if (userCtx.loading) {
    return renderReport(reportModel({
      reportType: 'user', title: 'My Analytics Report', subtitle: 'Loading...',
      generatedAt: new Date().toISOString(), sections: [text('Loading', `Loading report for ${userCtx.token || ''}.`)],
    }));
  }
  if (userCtx.error || !userCtx.viewModel) {
    return renderReport(reportModel({
      reportType: 'user', title: 'My Analytics Report', subtitle: 'Unavailable',
      generatedAt: new Date().toISOString(),
      sections: [text('Unavailable', userCtx.error || 'No personal bundle was found for this route token.')],
    }));
  }
  return renderReport(buildUserReportModel(userCtx.viewModel));
}

export function queueReportPage(queueInsights) {
  return renderReport(buildQueueReportModel(queueInsights));
}

export function capacityReportPage(ctx) {
  return renderReport(buildCapacityReportModel({ ...ctx, capacityHistoryChartOption }));
}
