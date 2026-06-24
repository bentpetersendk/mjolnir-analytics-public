// Data Freshness & Platform Status framework.
//
// Every collector (Node Insights, Mjolnir Analytics, and any future module)
// is stored and exported in UTC. This module is the single place that
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

const HEALTH_THRESHOLDS_MS = {
  healthy: 2 * 60 * 60 * 1000,
  warning: 6 * 60 * 60 * 1000,
};

const TONE_TO_VAR = {
  healthy: '--green',
  warning: '--amber',
  stale: '--orange',
  failed: '--red',
  planned: '--muted',
  unknown: '--muted',
};

const TONE_TO_PILL_CLASS = {
  healthy: 'good',
  warning: 'warn',
  stale: 'stale',
  failed: 'bad',
  planned: 'muted',
  unknown: 'muted',
};

const TONE_TO_LABEL = {
  healthy: 'Healthy',
  warning: 'Warning',
  stale: 'Stale',
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

export function snapshotAgeLabel(value) {
  const ms = snapshotAgeMs(value);
  if (ms === null) return 'Unavailable';
  if (ms < 0) return 'Just now';
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

// Collector Status:
//   Healthy  - last update under 2 hours old
//   Warning  - last update 2-6 hours old
//   Stale    - last update over 6 hours old
//   Failed   - collector explicitly reports failure, or has no data at all
export function collectorHealth(meta) {
  const m = meta || {};
  if (m.planned) return { status: 'planned', label: TONE_TO_LABEL.planned, tone: 'planned' };
  if (m.status === 'failed' || m.available === false) {
    return { status: 'failed', label: TONE_TO_LABEL.failed, tone: 'failed' };
  }
  const ms = snapshotAgeMs(m.generatedAt);
  if (ms === null) return { status: 'unknown', label: TONE_TO_LABEL.unknown, tone: 'unknown' };
  if (ms < HEALTH_THRESHOLDS_MS.healthy) return { status: 'healthy', label: TONE_TO_LABEL.healthy, tone: 'healthy' };
  if (ms < HEALTH_THRESHOLDS_MS.warning) return { status: 'warning', label: TONE_TO_LABEL.warning, tone: 'warning' };
  return { status: 'stale', label: TONE_TO_LABEL.stale, tone: 'stale' };
}

// Platform Status aggregates every active (non-planned) collector:
//   Healthy  - every collector healthy
//   Warning  - at least one collector warning or stale, none failed
//   Degraded - exactly one collector failed
//   Critical - two or more collectors failed
export function platformHealth(collectors) {
  const healths = (collectors || []).filter((m) => !m.planned).map(collectorHealth);
  if (!healths.length) return { status: 'unknown', label: TONE_TO_LABEL.unknown, tone: 'unknown' };
  const failedCount = healths.filter((h) => h.status === 'failed').length;
  if (failedCount >= 2) return { status: 'critical', label: 'Critical', tone: 'failed' };
  if (failedCount === 1) return { status: 'degraded', label: 'Degraded', tone: 'failed' };
  if (healths.some((h) => h.status === 'stale' || h.status === 'warning')) {
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
export function buildPlatformRegistry({ data, nodeInsights, nodeInsightsHistory }) {
  const meta = (data && data.datasetMeta) || {};
  const analyticsGeneratedAt = meta.exportDate || data?.generatedAt || null;
  const analyticsAvailable = Boolean(data) && data.source !== 'fallback';
  const analyticsModule = {
    id: 'mjolnir-analytics',
    label: meta.platformModule || 'Mjolnir Analytics',
    kind: 'analytics',
    collectorName: meta.collectorName || 'mjolnir_efficiency',
    generatedAt: analyticsGeneratedAt,
    dataWindowDays: meta.dataWindowDays ?? dataWindowDaysFromRange(meta.dateRange, 90),
    available: analyticsAvailable,
    status: meta.collectorStatus || (analyticsAvailable ? null : 'failed'),
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
    dataWindowDays: nodeInsightsHistory?.dataWindowDays ?? nodeInsightsHistory?.retentionDays ?? null,
    available: nodeAvailable,
    status: nodeInsights?.collectorStatus || nodeInsightsHistory?.collectorStatus || (nodeAvailable ? null : 'failed'),
    planned: false,
  };

  const planned = PLANNED_MODULES.map((m) => ({
    ...m, planned: true, available: true, generatedAt: null, dataWindowDays: null, status: null,
  }));

  return [analyticsModule, nodeModule, ...planned];
}

export function findModule(registry, id) {
  return (registry || []).find((m) => m.id === id) || { id, label: id, planned: false, available: false };
}

// Reusable per-page freshness strip. kind 'infrastructure' shows Snapshot
// Age (a live fleet snapshot has no "window"); kind 'analytics' shows Data
// Window (a historical rollup has no meaningful "age" beyond its export
// time).
export function statusBar(kind, meta) {
  const health = collectorHealth(meta);
  const windowOrAge = kind === 'infrastructure'
    ? ['Snapshot Age', snapshotAgeLabel(meta?.generatedAt)]
    : ['Data Window', meta?.dataWindowDays ? `Last ${meta.dataWindowDays} Days` : 'Unavailable'];
  const rows = [
    ['Last Updated', formatLocalDateTime(meta?.generatedAt)],
    windowOrAge,
    ['Collector Status', statusPillHtml(health)],
    ['Data Source', meta?.label || 'Unknown'],
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
// This is what the System Health card's Last Update/Snapshot Age/Data
// Source/Collector Status rows describe, and it's why new modules need no
// frontend change: a future Queue/Slurm/Cost collector that goes stale
// simply becomes the new "worst" entry the next time this runs.
const HEALTH_PRIORITY = { failed: 0, stale: 1, warning: 2, unknown: 3, healthy: 4, planned: 5 };
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

// platformHealth() collapses a lone stale collector into "Warning" (see its
// header comment) - that's the right call for the aggregate Degraded/Critical
// scale, but the System Health card promises exactly four words (Healthy/
// Warning/Stale/Failed). This re-expresses the same tones platformHealth()
// already computed into that four-word vocabulary, using collectorHealth()
// (already computed per module) to tell "nothing but stale collectors" apart
// from "an actual warning" - no new threshold math.
function systemHealthStatus(registry) {
  const overall = platformHealth(registry);
  if (overall.tone === 'failed') return { status: 'failed', label: TONE_TO_LABEL.failed, tone: 'failed' };
  if (overall.tone === 'warning') {
    const healths = (registry || []).filter((m) => !m.planned).map(collectorHealth);
    const tone = healths.some((h) => h.status === 'warning') ? 'warning' : 'stale';
    return { status: tone, label: TONE_TO_LABEL[tone], tone };
  }
  return overall;
}

const SYSTEM_HEALTH_COPY = {
  healthy: { headline: 'Healthy', sub: 'All systems operational' },
  warning: { headline: 'Warning', sub: 'Data becoming stale' },
  stale: { headline: 'Stale', sub: 'Update overdue' },
  failed: { headline: 'Failed', sub: 'Collector error detected' },
  unknown: { headline: 'Unknown', sub: 'Status unavailable' },
};

// The prominent Overview-page card: a pulsating health indicator plus the
// Last Update/Snapshot Age/Data Source/Collector Status of whichever module
// is currently driving that health. Pure presentation over
// buildPlatformRegistry()'s output - registering a future module there is
// still the only step needed for this card to reflect it.
export function renderSystemHealthCard(registry) {
  const overall = systemHealthStatus(registry);
  const copy = SYSTEM_HEALTH_COPY[overall.tone] || SYSTEM_HEALTH_COPY.unknown;
  const worst = worstActiveModule(registry);
  const meta = worst?.module || null;
  const detailHealth = worst?.health || overall;
  const rows = [
    ['Last Update', formatLocalDateTime(meta?.generatedAt)],
    ['Snapshot Age', snapshotAgeLabel(meta?.generatedAt)],
    ['Data Source', meta?.label || 'Unknown'],
    ['Collector Status', statusPillHtml(detailHealth)],
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
