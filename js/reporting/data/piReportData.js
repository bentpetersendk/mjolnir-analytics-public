// Version 1.3 (Reporting & Executive Briefings) - PI Report. Built entirely
// from the already-loaded/normalized `data.pis[]` array (same view-model
// findHierarchyEntity()/hierarchyDetailPage() already use in app.js) - no
// new fetch, no recalculation.
//
// Known data gaps (see docs/architecture/REPORTING_ARCHITECTURE.md and the
// v1.3 plan's "known data gaps" policy - graceful omission, never
// approximated client-side):
//   - top_inefficient_jobs: pi_summaries.json has no per-job/per-user join
//     path (built from pre-aggregated daily_pi_summary rollups) - would
//     need a real admin-repo exporter extension, not implemented here.
//   - "Active users": all_time_summary at PI/project/group/section level
//     does not include unique_users (confirmed absent in the real export -
//     that field only exists at cluster level). Omitted, not approximated
//     from a partial top_projects sample.
import { reportModel, statGrid, table, text, recommendationList, omitted } from '../model.js';

function asObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function asArray(value) { return Array.isArray(value) ? value : []; }
function num(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function pctLabel(value) { return value == null ? '-' : `${(Number(value) * 100).toFixed(0)}%`; }
function moneyLabel(value) { return value == null ? '-' : `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })} DKK`; }

export function findPi(pis, piId) {
  return asArray(pis).find((item) => item.id === piId) || null;
}

export function buildPiReportModel(pi) {
  if (!pi) {
    return reportModel({
      reportType: 'pi',
      title: 'PI Report',
      subtitle: 'PI not found',
      generatedAt: new Date().toISOString(),
      sections: [text('Not Found', 'No PI record was found for this identifier.')],
    });
  }

  const allTime = asObject(pi.allTime);
  const rolling7d = asObject(pi.rollingSummaries?.['7d']);
  const recs = asArray(pi.recommendations);
  const topProjects = asArray(pi.hierarchy?.topProjects || pi.topProjects);

  const sections = [
    text('Summary', `Portfolio summary for ${pi.label}.`),
    statGrid('Usage & Cost', [
      { label: 'Jobs (all-time)', value: num(allTime.jobs)?.toLocaleString() ?? '-', trend: 'All-time' },
      { label: 'CPU Hours', value: num(allTime.cpu_hours_allocated)?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? '-', trend: 'All-time' },
      { label: 'GPU Hours', value: num(allTime.gpu_hours)?.toLocaleString(undefined, { maximumFractionDigits: 0 }) ?? '-', trend: 'All-time' },
      { label: 'Estimated Cost', value: moneyLabel(allTime.estimated_cost_dkk), trend: 'All-time' },
      { label: 'Optimization Opportunity', value: moneyLabel(allTime.underutilized_cost_dkk), trend: 'All-time' },
    ]),
    statGrid('Efficiency', [
      { label: 'CPU Efficiency', value: pctLabel(allTime.avg_cpu_efficiency), trend: 'All-time average' },
      { label: 'Memory Efficiency', value: pctLabel(allTime.avg_memory_efficiency), trend: 'All-time average' },
      { label: 'Cost Bearer', value: allTime.cost_bearer || '-', trend: 'Dominant cost driver' },
    ]),
    omitted('Active Users', 'Per-PI unique-user counts are not yet exported by the warehouse (only available at cluster level today).'),
    statGrid('Active Projects', [
      { label: 'Project Count', value: num(pi.hierarchy?.projectCount ?? pi.projectCount) ?? topProjects.length ?? '-', trend: 'Projects under this PI' },
    ]),
    topProjects.length
      ? table('Top Projects', ['Project', 'Jobs', 'Cost', 'Opportunity'], topProjects.slice(0, 10).map((p) => [
          p.project_label || p.label || p.project_id || '-',
          num(p.jobs)?.toLocaleString() ?? '-',
          moneyLabel(p.estimated_cost_dkk),
          moneyLabel(p.underutilized_cost_dkk),
        ]))
      : omitted('Top Projects', 'No project rollup available for this PI.'),
    omitted('Top Inefficient Jobs', 'Per-PI inefficient-job listings are not yet exported by the warehouse - this requires a per-job/per-PI join not currently materialized (pi_summaries.json is built from pre-aggregated daily rollups).'),
    rolling7d.jobs != null
      ? statGrid('Weekly Trend (7d)', [
          { label: 'Jobs (7d)', value: num(rolling7d.jobs)?.toLocaleString() ?? '-', trend: 'Rolling 7-day window' },
          { label: 'Cost (7d)', value: moneyLabel(rolling7d.estimated_cost_dkk), trend: 'Rolling 7-day window' },
        ])
      : omitted('Weekly Trend', 'No 7-day rolling summary available for this PI.'),
    recommendationList('Recommendations', recs.map((r) => ({
      severity: r.severity || r.priority || 'info',
      title: r.title,
      suggestion: r.detail || r.suggestion || '',
    }))),
  ];

  return reportModel({
    reportType: 'pi',
    title: `PI Report: ${pi.label}`,
    subtitle: 'Usage, cost, efficiency, and recommendations',
    generatedAt: new Date().toISOString(),
    metadata: { piId: pi.id },
    sections,
  });
}
