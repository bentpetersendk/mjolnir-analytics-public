// Data Freshness & Platform Status framework.
//
// Every collector (Node Insights, Analytics Warehouse, Analytics Pipeline,
// and any future module) is stored and exported in UTC. This module is the
// single place that
// converts those UTC instants to the viewer's browser timezone, judges
// collector/platform health from them, and renders the standard "Last
// Updated / Collector Status / Data Source" UI fragments. Pages should
// never format a timestamp or compute a health tone themselves - call the
// helpers here so every page stays visually and behaviorally consistent.
//
// Registration contract for a future module (Queue Insights, Slurm Insights,
// Cost Insights, Predictions, Recommendations Engine, ...): once its loader
// in data-loader.js returns { generatedAt, collectorName, collectorStatus,
// dataWindowDays, platformModule, available }, add one entry to
// ACTIVE_MODULE_SOURCES below (or PLANNED_MODULES while it has no collector
// yet) pointing at that loader's result. No other frontend code - the
// status bars, the Platform Status panel, the sidebar badge - needs to
// change. See docs/PLATFORM_STATUS.md.

const TONE_TO_VAR = {
  healthy: '--green',
  warning: '--amber',
  critical: '--orange',
  failed: '--red',
  planned: '--muted',
  unknown: '--muted',
};

const TONE_TO_PILL_CLASS = {
  healthy: 'good',
  warning: 'warn',
  critical: 'critical',
  failed: 'bad',
  planned: 'muted',
  unknown: 'muted',
};

const TONE_TO_LABEL = {
  healthy: 'Healthy',
  warning: 'Warning',
  critical: 'Critical',
  failed: 'Failed',
  planned: 'Planned',
  unknown: 'Unknown',
};

// Collector timestamps are stored and exported as UTC ISO-8601 (trailing
// 'Z' or an explicit offset). new Date() parses that as an absolute
// instant; every formatter below then reads it back with the local
// (non-UTC) getters, so the displayed value automatically follows whatever
// timezone the viewer's browser is set to - including DST transitions like
// Denmark's CET/CEST switch - with no manual offset math.
export function parseUtc(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatLocalDateTime(value, fallback = 'Unavailable') {
  const date = parseUtc(value);
  if (!date) return fallback;
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// Compact "MM-DD HH:mm" form used for ECharts axis ticks.
export function chartTimeLabel(value) {
  const date = parseUtc(value);
  if (!date) return String(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function chartTimeTooltipLabel(value) {
  return formatLocalDateTime(value, String(value));
}

export function snapshotAgeMs(value) {
  const date = parseUtc(value);
  if (!date) return null;
  return Date.now() - date.getTime();
}

function humanizeDurationMs(ms) {
  const minutes = Math.round(Math.abs(ms) / 60000);
  if (minutes < 1) return 'less than a minute';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

export function snapshotAgeLabel(value) {
  const ms = snapshotAgeMs(value);
  if (ms === null) return 'Unavailable';
  if (ms < 0) return 'Just now';
  const duration = humanizeDurationMs(ms);
  return duration === 'less than a minute' ? 'Just now' : duration;
}

// Expected-cadence label for the "Expected Refresh" UI row - purely derived
// from expected_refresh_seconds, never a hardcoded per-module string.
export function expectedRefreshLabel(expectedRefreshSeconds) {
  const seconds = Number(expectedRefreshSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Unavailable';
  if (seconds % 86400 === 0) {
    const days = seconds / 86400;
    return days === 1 ? 'Nightly' : `Every ${days} days`;
  }
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return hours === 1 ? 'Every hour' : `Every ${hours} hours`;
  }
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `Every ${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  return `Every ${seconds} seconds`;
}

function sameLocalDate(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// "Next Expected Update" label for the UI row - derived from the same
// calculateCollectorHealth() result every module already computed, never
// recomputed ad hoc per page.
export function nextExpectedUpdateLabel(health) {
  const h = health || {};
  if (h.nextExpectedAt === null || h.nextExpectedAt === undefined) return 'Unavailable';
  if (h.overdueMs > 0) return `Overdue by ${humanizeDurationMs(h.overdueMs)}`;
  const next = new Date(h.nextExpectedAt);
  const now = new Date();
  const deltaMs = next.getTime() - now.getTime();
  if (deltaMs < 90 * 60 * 1000) return `in ${humanizeDurationMs(deltaMs)}`;
  const time = next.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameLocalDate(next, now)) return `Today at ${time}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (sameLocalDate(next, tomorrow)) return `${next.getHours() < 6 ? 'Tonight' : 'Tomorrow'} at ${time}`;
  return formatLocalDateTime(h.nextExpectedAt);
}

// The single collector-health helper every module reuses (Node Insights,
// Queue Insights, Analytics Warehouse, Analytics Pipeline, and any future
// module). No module-specific freshness math should exist anywhere else -
// each collector just declares its own cadence in its exported JSON
// (expected_refresh_seconds / warning_after_intervals /
// critical_after_intervals; see docs/architecture/COLLECTOR_HEALTH.md in the
// private repo) and this function turns that + generatedAt into a health
// state. A module whose export predates this contract (missing cadence
// fields) renders Unknown rather than guessing a threshold or breaking.
//
// Status:
//   Healthy  - age <= warning_after_intervals * expected_refresh_seconds
//   Warning  - age <= critical_after_intervals * expected_refresh_seconds
//   Critical - age beyond that
//   Failed   - collector explicitly reports failure, or has no data at all
//   Unknown  - no collector metadata (generatedAt/cadence) exists
export function calculateCollectorHealth(meta) {
  const m = meta || {};
  if (m.planned) {
    return { status: 'planned', label: TONE_TO_LABEL.planned, tone: 'planned', ageMs: null, expectedIntervalMs: null, nextExpectedAt: null, overdueMs: 0 };
  }
  if (m.status === 'failed' || m.available === false) {
    return { status: 'failed', label: TONE_TO_LABEL.failed, tone: 'failed', ageMs: null, expectedIntervalMs: null, nextExpectedAt: null, overdueMs: 0 };
  }
  const generated = parseUtc(m.generatedAt);
  const expectedRefreshSeconds = Number(m.expectedRefreshSeconds);
  const warningAfterIntervals = Number(m.warningAfterIntervals);
  const criticalAfterIntervals = Number(m.criticalAfterIntervals);
  const hasCadence = Number.isFinite(expectedRefreshSeconds) && expectedRefreshSeconds > 0
    && Number.isFinite(warningAfterIntervals) && Number.isFinite(criticalAfterIntervals);
  if (!generated || !hasCadence) {
    return { status: 'unknown', label: TONE_TO_LABEL.unknown, tone: 'unknown', ageMs: snapshotAgeMs(m.generatedAt), expectedIntervalMs: null, nextExpectedAt: null, overdueMs: 0 };
  }
  const ageMs = Date.now() - generated.getTime();
  const expectedIntervalMs = expectedRefreshSeconds * 1000;
  const warningThresholdMs = warningAfterIntervals * expectedIntervalMs;
  const criticalThresholdMs = criticalAfterIntervals * expectedIntervalMs;
  const nextExpectedAt = generated.getTime() + expectedIntervalMs;
  const overdueMs = Math.max(0, Date.now() - nextExpectedAt);
  let status = 'healthy';
  if (ageMs > criticalThresholdMs) status = 'critical';
  else if (ageMs > warningThresholdMs) status = 'warning';
  return {
    status,
    label: TONE_TO_LABEL[status] || TONE_TO_LABEL.unknown,
    tone: status,
    ageMs,
    expectedIntervalMs,
    nextExpectedAt,
    overdueMs,
  };
}

// Backwards-compatible name used throughout this file and app.js - same
// function, see calculateCollectorHealth() above for the canonical home.
export const collectorHealth = calculateCollectorHealth;

// Platform Status aggregates every active (non-planned) collector:
//   Healthy  - every collector healthy
//   Warning  - at least one collector warning, none failed or critical
//   Critical - at least one collector critical, none failed
//   Degraded - exactly one collector failed
//   Critical - two or more collectors failed
export function platformHealth(collectors) {
  const healths = (collectors || []).filter((m) => !m.planned).map(collectorHealth);
  if (!healths.length) return { status: 'unknown', label: TONE_TO_LABEL.unknown, tone: 'unknown' };
  const failedCount = healths.filter((h) => h.status === 'failed').length;
  if (failedCount >= 2) return { status: 'critical', label: 'Critical', tone: 'failed' };
  if (failedCount === 1) return { status: 'degraded', label: 'Degraded', tone: 'failed' };
  if (healths.some((h) => h.status === 'critical')) {
    return { status: 'critical', label: TONE_TO_LABEL.critical, tone: 'critical' };
  }
  if (healths.some((h) => h.status === 'warning')) {
    return { status: 'warning', label: TONE_TO_LABEL.warning, tone: 'warning' };
  }
  return { status: 'healthy', label: TONE_TO_LABEL.healthy, tone: 'healthy' };
}

export function statusDotHtml(tone) {
  return `<span class="status-dot" style="background:var(${TONE_TO_VAR[tone] || '--muted'})"></span>`;
}

export function statusPillHtml(health) {
  const pillClass = TONE_TO_PILL_CLASS[health.tone] || 'muted';
  return `<span class="pill status-pill ${pillClass}">${statusDotHtml(health.tone)}${health.label}</span>`;
}

// Modules with a real collector behind them today. Each entry pulls its
// metadata out of the corresponding data-loader.js result; if the source
// JSON has not yet adopted the collector_status/data_window_days/
// platform_module fields, sensible derived values are used instead.
function dataWindowDaysFromRange(dateRange, fallbackDays) {
  if (!dateRange || !dateRange.start || !dateRange.end) return fallbackDays;
  const start = parseUtc(dateRange.start);
  const end = parseUtc(dateRange.end);
  if (!start || !end) return fallbackDays;
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
}

const PLANNED_MODULES = [
  { id: 'queue-insights', label: 'Queue Insights', kind: 'analytics' },
  { id: 'slurm-insights', label: 'Slurm Insights', kind: 'analytics' },
  { id: 'predictions', label: 'Predictions', kind: 'analytics' },
];

// Builds the live Platform Status registry from whatever has already been
// loaded by data-loader.js. This is the one place that knows which fields
// each module's data lives in - statusBar()/platformStatusPanel() below
// just iterate the result, so adding a module here is the only frontend
// change a future collector needs (see the file header).
export function buildPlatformRegistry({ nodeInsights, nodeInsightsHistory, slurmAnalyticsPipeline }) {
  const warehouse = slurmAnalyticsPipeline?.warehouse || {};
  const warehouseAvailable = Boolean(slurmAnalyticsPipeline?.available) && Boolean(warehouse.total_jobs);
  const warehouseModule = {
    id: 'analytics-warehouse',
    label: 'Analytics Warehouse',
    kind: 'analytics',
    collectorName: 'mjolnir_analytics_warehouse',
    generatedAt: warehouse.last_import_at || warehouse.last_materialization_at || warehouse.last_success_at || null,
    expectedRefreshSeconds: slurmAnalyticsPipeline?.expectedRefreshSeconds ?? null,
    warningAfterIntervals: slurmAnalyticsPipeline?.warningAfterIntervals ?? null,
    criticalAfterIntervals: slurmAnalyticsPipeline?.criticalAfterIntervals ?? null,
    dataWindowDays: dataWindowDaysFromRange({ start: warehouse.earliest_date, end: warehouse.latest_date }, null),
    available: warehouseAvailable,
    status: warehouseAvailable ? null : 'failed',
    planned: false,
  };

  const nodeGeneratedAt = [nodeInsights?.generatedAt, nodeInsightsHistory?.generatedAt]
    .filter(Boolean)
    .sort()
    .pop() || null;
  const nodeAvailable = Boolean(nodeInsights?.available || nodeInsightsHistory?.available);
  const nodeModule = {
    id: 'node-insights',
    label: nodeInsights?.platformModule || nodeInsightsHistory?.platformModule || 'Node Insights',
    kind: 'infrastructure',
    collectorName: nodeInsights?.collectorName || nodeInsightsHistory?.collectorName || 'node_insights',
    generatedAt: nodeGeneratedAt,
    expectedRefreshSeconds: nodeInsights?.expectedRefreshSeconds ?? nodeInsightsHistory?.expectedRefreshSeconds ?? null,
    warningAfterIntervals: nodeInsights?.warningAfterIntervals ?? nodeInsightsHistory?.warningAfterIntervals ?? null,
    criticalAfterIntervals: nodeInsights?.criticalAfterIntervals ?? nodeInsightsHistory?.criticalAfterIntervals ?? null,
    dataWindowDays: nodeInsightsHistory?.dataWindowDays ?? nodeInsightsHistory?.retentionDays ?? null,
    available: nodeAvailable,
    status: nodeInsights?.collectorStatus || nodeInsightsHistory?.collectorStatus || (nodeAvailable ? null : 'failed'),
    planned: false,
  };

  const pipelineModule = {
    id: 'analytics-pipeline',
    label: slurmAnalyticsPipeline?.platformModule || 'Analytics Pipeline',
    kind: 'infrastructure',
    collectorName: slurmAnalyticsPipeline?.collectorName || 'slurm_analytics_pipeline',
    generatedAt: slurmAnalyticsPipeline?.generatedAt ?? null,
    expectedRefreshSeconds: slurmAnalyticsPipeline?.expectedRefreshSeconds ?? null,
    warningAfterIntervals: slurmAnalyticsPipeline?.warningAfterIntervals ?? null,
    criticalAfterIntervals: slurmAnalyticsPipeline?.criticalAfterIntervals ?? null,
    dataWindowDays: slurmAnalyticsPipeline?.dataWindowDays ?? null,
    available: Boolean(slurmAnalyticsPipeline?.available),
    status: slurmAnalyticsPipeline?.collectorStatus || (slurmAnalyticsPipeline?.available ? null : 'failed'),
    planned: false,
  };

  const planned = PLANNED_MODULES.map((m) => ({
    ...m,
    planned: true,
    available: true,
    generatedAt: null,
    expectedRefreshSeconds: null,
    warningAfterIntervals: null,
    criticalAfterIntervals: null,
    dataWindowDays: null,
    status: null,
  }));

  return [warehouseModule, nodeModule, pipelineModule, ...planned];
}

export function findModule(registry, id) {
  return (registry || []).find((m) => m.id === id) || { id, label: id, planned: false, available: false };
}

// Normalized live Analytics Warehouse stats - the single source both the
// Overview "Warehouse Summary" cards and the dedicated Warehouse page read
// from, so the two never drift. Everything here comes straight out of
// status.json's `warehouse` block (export_dashboard_data.py) plus the live
// Node Insights snapshot for compute node count - no hardcoded numbers.
export function buildWarehouseSummary({ slurmAnalyticsPipeline, nodeInsights }) {
  const w = slurmAnalyticsPipeline?.warehouse || {};
  const available = Boolean(slurmAnalyticsPipeline?.available) && Boolean(w.total_jobs);
  const computeNodes = nodeInsights?.clusterOverview?.totals?.nodes_total
    ?? nodeInsights?.nodeInventory?.nodeCount
    ?? null;
  const accountingRecords = w.total_accounting_records ?? null;
  const canonicalJobs = w.total_jobs ?? null;
  return {
    available,
    accountingRecords,
    jobSteps: w.total_job_steps ?? null,
    canonicalJobs,
    users: w.total_users ?? null,
    projects: w.total_projects ?? null,
    accounts: w.total_accounts ?? null,
    partitions: w.total_partitions ?? null,
    computeNodes,
    databaseSizeBytes: w.database_size_bytes ?? null,
    earliestDate: w.earliest_date ?? null,
    latestDate: w.latest_date ?? null,
    lastImportAt: w.last_import_at ?? null,
    lastMaterializationAt: w.last_materialization_at ?? null,
    lastPublishAt: w.last_publish_at ?? null,
    nodeSnapshotAt: nodeInsights?.generatedAt ?? null,
    expectedRefreshSeconds: slurmAnalyticsPipeline?.expectedRefreshSeconds ?? null,
    warningAfterIntervals: slurmAnalyticsPipeline?.warningAfterIntervals ?? null,
    criticalAfterIntervals: slurmAnalyticsPipeline?.criticalAfterIntervals ?? null,
    schemaVersion: w.db_schema_version ?? null,
    warehouseVersion: w.warehouse_version ?? null,
    reductionRatio: accountingRecords && canonicalJobs ? canonicalJobs / accountingRecords : null,
  };
}

// Reusable per-page freshness strip. Every module renders the same four
// rows, driven entirely by calculateCollectorHealth() - no module-specific
// freshness math (docs/architecture/COLLECTOR_HEALTH.md).
export function statusBar(meta) {
  const health = collectorHealth(meta);
  const rows = [
    ['Last Update', formatLocalDateTime(meta?.generatedAt)],
    ['Expected Refresh', expectedRefreshLabel(meta?.expectedRefreshSeconds)],
    ['Collector Status', statusPillHtml(health)],
    ['Next Expected Update', nextExpectedUpdateLabel(health)],
  ];
  return `<div class="status-bar">${rows.map(([label, value]) => (
    `<div class="status-bar-item"><span class="status-bar-label">${label}</span><span class="status-bar-value">${value}</span></div>`
  )).join('')}</div>`;
}

// The big "Mjolnir Analytics Platform Status" section for the Overview page.
export function platformStatusPanel(registry, stats = {}) {
  const overall = platformHealth(registry);
  const rows = registry.map((m) => (
    `<div class="platform-module-row"><span>${m.label}</span>${statusPillHtml(collectorHealth(m))}</div>`
  )).join('');
  const lastUpdate = registry
    .filter((m) => !m.planned && m.generatedAt)
    .map((m) => m.generatedAt)
    .sort()
    .pop();
  const metaItems = [
    ['Last Platform Update', formatLocalDateTime(lastUpdate)],
    stats.snapshotCount !== undefined ? ['Snapshots Collected', String(stats.snapshotCount)] : null,
    stats.activeModuleCount !== undefined ? ['Active Analytics Modules', String(stats.activeModuleCount)] : null,
  ].filter(Boolean);
  return `<section class="section platform-status">
    <div class="section-head"><h2>Mjolnir Analytics Platform Status</h2>${statusPillHtml(overall)}</div>
    <div class="platform-module-list">${rows}</div>
    <div class="platform-status-meta">${metaItems.map(([label, value]) => (
      `<div><span class="status-bar-label">${label}</span><strong>${value}</strong></div>`
    )).join('')}</div>
  </section>`;
}

// Compact sidebar/header badge - "optionally available in the sidebar".
export function platformStatusBadge(registry) {
  const overall = platformHealth(registry);
  return `<div class="context-item platform-status-badge"><span>Platform Status</span>${statusPillHtml(overall)}</div>`;
}

// The module driving the platform's current status - whichever active
// (non-planned) collector has the worst health, most-recent first on ties.
// This is what the System Health card's rows describe, and it's why new
// modules need no frontend change: a future Queue/Slurm/Cost collector that
// goes stale simply becomes the new "worst" entry the next time this runs.
const HEALTH_PRIORITY = { failed: 0, critical: 1, warning: 2, unknown: 3, healthy: 4, planned: 5 };
function worstActiveModule(registry) {
  const active = (registry || []).filter((m) => !m.planned);
  if (!active.length) return null;
  return active
    .map((module) => ({ module, health: collectorHealth(module) }))
    .sort((a, b) => (
      (HEALTH_PRIORITY[a.health.status] ?? 9) - (HEALTH_PRIORITY[b.health.status] ?? 9)
      || String(b.module.generatedAt || '').localeCompare(String(a.module.generatedAt || ''))
    ))[0];
}

const SYSTEM_HEALTH_COPY = {
  healthy: { headline: 'Healthy', sub: 'All systems operational' },
  warning: { headline: 'Warning', sub: 'Update overdue' },
  critical: { headline: 'Critical', sub: 'Update significantly overdue' },
  failed: { headline: 'Failed', sub: 'Collector error detected' },
  unknown: { headline: 'Unknown', sub: 'Status unavailable' },
};

// The prominent Overview-page card: a pulsating health indicator plus the
// Last Update/Expected Refresh/Collector Status/Next Expected Update of
// whichever module is currently driving that health. Pure presentation over
// buildPlatformRegistry()'s output - registering a future module there is
// still the only step needed for this card to reflect it.
export function renderSystemHealthCard(registry) {
  const overall = platformHealth(registry);
  const copy = SYSTEM_HEALTH_COPY[overall.tone] || SYSTEM_HEALTH_COPY.unknown;
  const worst = worstActiveModule(registry);
  const meta = worst?.module || null;
  const detailHealth = worst?.health || overall;
  const rows = [
    ['Last Update', formatLocalDateTime(meta?.generatedAt)],
    ['Expected Refresh', expectedRefreshLabel(meta?.expectedRefreshSeconds)],
    ['Collector Status', statusPillHtml(detailHealth)],
    ['Next Expected Update', nextExpectedUpdateLabel(detailHealth)],
  ];
  return `<section class="section system-health-card">
    <div class="section-head"><h2>System Health</h2>${statusPillHtml(overall)}</div>
    <div class="system-health-main">
      <span class="system-health-indicator system-health-${overall.tone}" role="img" aria-label="System health: ${copy.headline}"></span>
      <div class="system-health-text">
        <div class="system-health-headline">${copy.headline}</div>
        <div class="system-health-sub">${copy.sub}</div>
      </div>
    </div>
    <div class="system-health-details">${rows.map(([label, value]) => (
      `<div class="system-health-detail-row"><span class="status-bar-label">${label}</span><span class="status-bar-value">${value}</span></div>`
    )).join('')}</div>
    <a class="btn system-health-cta" href="#/platform-status">View Platform Status</a>
  </section>`;
}
