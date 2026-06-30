// Version 1.3 (Reporting & Executive Briefings) - Capacity Report. Built
// entirely from already-loaded nodeInsights/nodeInsightsHistory/
// warehouseSummary - no new fetch, no recalculation. Uses the A4 landscape
// print variant (see app.js's capacityReportPage()) since its utilization
// tables run wide.
import { reportModel, statGrid, chartSection, omitted } from '../model.js';
import { capacityInsight } from '../rules/insights.js';

function asObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function asArray(value) { return Array.isArray(value) ? value : []; }
function bytesLabel(value) {
  if (value === null || value === undefined) return '-';
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n; let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(1)} ${units[i]}`;
}

export function buildCapacityReportModel(ctx) {
  const { nodeInsights, nodeInsightsHistory, warehouseSummary, capacityHistoryChartOption } = ctx;
  const co = asObject(nodeInsights?.clusterOverview);
  const totals = asObject(co.totals);
  const cpu = asObject(co.cpu);
  const mem = asObject(co.memory_mib);
  const gpu = asObject(co.gpu);
  const cpuPct = cpu.alloc_pct != null ? cpu.alloc_pct * 100 : null;
  const memPct = mem.alloc_pct != null ? mem.alloc_pct * 100 : null;
  const gpuPct = (gpu.alloc_pct_of_online ?? gpu.alloc_pct) != null ? (gpu.alloc_pct_of_online ?? gpu.alloc_pct) * 100 : null;

  const capacityPoints = asArray(nodeInsightsHistory?.capacity);
  const capacityAvailable = Boolean(nodeInsightsHistory?.available) && capacityPoints.length > 1;

  const concerns = [
    capacityInsight('CPU', cpuPct),
    capacityInsight('Memory', memPct),
    capacityInsight('GPU', gpuPct),
  ].filter(Boolean).filter((c) => c.severity !== 'info');

  const sections = [
    statGrid('CPU Utilization', [
      { label: 'CPU Allocated', value: cpuPct != null ? `${cpuPct.toFixed(0)}%` : '-', trend: `${cpu.alloc ?? '-'} / ${cpu.total ?? '-'} cores` },
    ]),
    statGrid('Memory Utilization', [
      { label: 'Memory Allocated', value: memPct != null ? `${memPct.toFixed(0)}%` : '-', trend: `${bytesLabel((mem.alloc || 0) * 1024 * 1024)} / ${bytesLabel((mem.total || 0) * 1024 * 1024)}` },
    ]),
    statGrid('GPU Utilization', [
      { label: 'GPU Allocated', value: gpuPct != null ? `${gpuPct.toFixed(0)}%` : '-', trend: `${gpu.alloc ?? '-'} / ${gpu.total ?? '-'} GPUs` },
    ]),
    capacityAvailable
      ? chartSection('Capacity Trend', capacityHistoryChartOption(capacityPoints), { subtitle: 'Available history' })
      : omitted('Capacity Trend', 'Node Insights history is not yet available.'),
    omitted('Storage Growth', 'Filesystem/storage growth is not yet tracked by any current export.'),
    statGrid('Warehouse', [
      { label: 'Database Size', value: bytesLabel(warehouseSummary?.databaseSizeBytes), trend: 'Current snapshot' },
      { label: 'Nodes', value: totals.nodes_total != null ? String(totals.nodes_total) : '-', trend: `${totals.nodes_available ?? '-'} online` },
    ]),
    concerns.length
      ? statGrid('Capacity Concerns', concerns.map((c) => ({ label: c.severity === 'high' ? 'Critical' : 'Warning', value: c.text, trend: '', tone: c.severity === 'high' ? 'warn' : 'info' })))
      : omitted('Capacity Concerns', 'No capacity concerns detected at current utilization levels.'),
  ];
  // Warehouse growth is intentionally not shown as a trend - only the
  // current database_size_bytes snapshot is exported, no historical
  // series exists yet to derive growth from (see "Storage Growth" above
  // for the same constraint).

  return reportModel({
    reportType: 'capacity',
    title: 'Capacity Report',
    subtitle: 'CPU, memory, and GPU utilization with capacity concerns',
    generatedAt: new Date().toISOString(),
    sections,
  });
}
