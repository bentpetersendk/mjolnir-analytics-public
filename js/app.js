import { loadMjolnirData, loadPersonalData, loadNodeInsightsData, loadNodeInsightsHistory } from './data-loader.js';
import { requestDashboardRecovery } from './recovery-service.js';
import {
  formatLocalDateTime, chartTimeLabel, chartTimeTooltipLabel,
  buildPlatformRegistry, findModule, statusBar, platformStatusPanel, platformStatusBadge,
  renderSystemHealthCard,
} from './status.js';

const app = document.querySelector('#app');

// Visible sidebar navigation, grouped into labeled sections. Groups and Sections
// pages are intentionally omitted here (UI simplification for the PI demo) but
// their routes/renderers stay registered below so direct links and underlying
// data generation keep working.
const navGroups = [
  {
    heading: 'Analysis',
    items: [
      { id: 'landing', label: 'Overview', icon: 'home' },
      { id: 'cluster', label: 'Trends', icon: 'chart' },
      { id: 'cluster-health', label: 'Cluster Resource Health', icon: 'cluster' },
      { id: 'rankings', label: 'Rankings', icon: 'trophy' },
      { id: 'benchmarks', label: 'Percentiles', icon: 'gauge' },
      { id: 'recommendations', label: 'Recommendations', icon: 'spark' },
      { id: 'inefficient-jobs', label: 'Optimization Opportunities', icon: 'alert' },
    ],
  },
  {
    heading: 'Infrastructure',
    items: [
      { id: 'infrastructure', label: 'Infrastructure', icon: 'server' },
      { id: 'nodes', label: 'Nodes', icon: 'cluster' },
      { id: 'hardware', label: 'Hardware', icon: 'cpu' },
      { id: 'capacity', label: 'Capacity', icon: 'gauge' },
    ],
  },
  {
    heading: 'Organization',
    items: [
      { id: 'projects', label: 'Projects', icon: 'folder' },
      { id: 'pis', label: 'PIs', icon: 'users' },
    ],
  },
  {
    heading: 'Personal',
    items: [
      { id: 'users', label: 'Community Comparison', icon: 'users' },
      { id: 'recovery', label: 'View My Analytics', icon: 'key' },
    ],
  },
  {
    heading: 'Administration',
    items: [
      { id: 'cost', label: 'Cost Insights', icon: 'wallet' },
      { id: 'methodology', label: 'Methodology', icon: 'book' },
    ],
  },
];
const navItems = navGroups.flatMap((group) => group.items);
// Hidden routes (not linked from the UI) still need labels for page titles.
const hiddenRouteItems = [
  { id: 'groups', label: 'Groups', icon: 'cluster' },
  { id: 'sections', label: 'Sections', icon: 'book' },
  { id: 'platform-status', label: 'Platform Status', icon: 'gauge' },
];
const allRouteItems = navItems.concat(hiddenRouteItems);

const state = {
  theme: localStorage.getItem('med-theme') || 'dark',
  route: location.hash.replace('#/', '') || 'landing',
  recoveryStatus: null,
  personalToken: null,
  personalViewModel: null,
  personalLoading: false,
  personalError: null,
  menuOpen: false,
  nodeFilters: { class: 'all', partition: 'all', state: 'all', sortKey: 'node', sortDir: 'asc' },
  historyRange: '7d',
};

let data = null;
let nodeInsights = null;
let nodeInsightsHistory = null;
let platformRegistry = [];

// Data Freshness / Platform Status framework (docs/PLATFORM_STATUS.md):
// page renderers call analyticsStatusBar()/infraStatusBar() rather than
// touching status.js directly, so every page stays on the same registry.
function analyticsStatusBar() { return statusBar('analytics', findModule(platformRegistry, 'mjolnir-analytics')); }
function infraStatusBar() { return statusBar('infrastructure', findModule(platformRegistry, 'node-insights')); }

function icon(name) {
  const icons = {
    home: '<path d="M3 11.5 12 4l9 7.5v8.5a1 1 0 0 1-1 1h-5.5v-6.5h-5V21H4a1 1 0 0 1-1-1z"/><path d="M9 21v-5h6v5" fill="none"/>',
    cluster: '<path d="M7 7h4v4H7zM13 7h4v4h-4zM10 13h4v4h-4zM4 15h3v3H4zM17 15h3v3h-3z"/>',
    users: '<path d="M8.5 11a3.5 3.5 0 1 0-3.5-3.5A3.5 3.5 0 0 0 8.5 11Zm7 0a3 3 0 1 0-3-3 3 3 0 0 0 3 3Zm-8 2c-2.5 0-5 1.3-5 3.5V19h10v-2.5c0-2.2-2.5-3.5-5-3.5Zm7 .2c-.7 0-1.4.1-2 .3 1.3.8 2 1.9 2 3.2V19h5v-2.3c0-1.9-2-3.5-5-3.5Z"/>',
    chart: '<path d="M5 19h14"/><path d="M7 17V9"/><path d="M12 17V5"/><path d="M17 17v-6"/>',
    wallet: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H20v14H6.5A2.5 2.5 0 0 1 4 16.5z"/><path d="M16 12h4" fill="none"/>',
    key: '<circle cx="7.5" cy="12.5" r="3.5"/><path d="M11 12.5h9M16 12.5v3M19 12.5v2" fill="none"/>',
    book: '<path d="M6 4.5h9.5A2.5 2.5 0 0 1 18 7v12H8.5A2.5 2.5 0 0 0 6 21.5z"/><path d="M6 4.5A2.5 2.5 0 0 0 3.5 7v12A2.5 2.5 0 0 1 6 16.5" fill="none"/>',
    trophy: '<path d="M8 4h8v3a4 4 0 0 1-8 0z"/><path d="M8 6H4a4 4 0 0 0 4 4M16 6h4a4 4 0 0 1-4 4M12 11v5M9 20h6M10 16h4" fill="none"/>',
    gauge: '<path d="M4 15a8 8 0 1 1 16 0" fill="none"/><path d="M12 15l4-5" fill="none"/><path d="M6 15h12" fill="none"/>',
    spark: '<path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z"/>',
    alert: '<path d="M12 3 2.5 20h19z" fill="none"/><path d="M12 8v5M12 16.5v.5"/>',
    folder: '<path d="M3 7h7l2 2h9v9.5A2.5 2.5 0 0 1 18.5 21h-13A2.5 2.5 0 0 1 3 18.5z"/>',
    moon: '<path d="M14.5 3.5a7.5 7.5 0 1 0 6 13 8 8 0 0 1-6-13Z"/>',
    sun: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2.5M12 19v2.5M4.7 4.7l1.8 1.8M17.5 17.5l1.8 1.8M2.5 12H5M19 12h2.5M4.7 19.3l1.8-1.8M17.5 6.5l1.8-1.8"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
    bell: '<path d="M6 17h12l-1.3-2.1A8.5 8.5 0 0 1 15 10V9a3 3 0 0 0-6 0v1a8.5 8.5 0 0 1-1.7 4.9z"/><path d="M10 19a2 2 0 0 0 4 0"/>',
    settings: '<path d="M12 8.5A3.5 3.5 0 1 0 15.5 12 3.5 3.5 0 0 0 12 8.5Z"/><path d="M19 12a7.1 7.1 0 0 0-.1-1l2.1-1.6-2-3.5-2.5.8a7 7 0 0 0-1.7-1l-.4-2.7H9.6l-.4 2.7a7 7 0 0 0-1.7 1l-2.5-.8-2 3.5L5.1 11A7.1 7.1 0 0 0 5 12c0 .3 0 .7.1 1l-2.1 1.6 2 3.5 2.5-.8a7 7 0 0 0 1.7 1l.4 2.7h4.8l.4-2.7a7 7 0 0 0 1.7-1l2.5.8 2-3.5L18.9 13c.1-.3.1-.7.1-1Z"/>',
    info: '<path fill-rule="evenodd" d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 2a7 7 0 1 1 0 14 7 7 0 0 1 0-14Z"/><rect x="11" y="10.5" width="2" height="7" rx="1"/><rect x="11" y="6.5" width="2" height="2" rx="1"/>',
    server: '<rect x="4" y="4" width="16" height="5" rx="1" fill="none"/><rect x="4" y="11" width="16" height="5" rx="1" fill="none"/><path d="M7 6.5h.01M7 13.5h.01" stroke-width="2.4"/><path d="M4 18.5h16" fill="none"/>',
    cpu: '<rect x="7" y="7" width="10" height="10" rx="1.5" fill="none"/><path d="M9 4v3M12 4v3M15 4v3M9 17v3M12 17v3M15 17v3M4 9h3M4 12h3M4 15h3M17 9h3M17 12h3M17 15h3" fill="none"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.home}</svg>`;
}

function asArray(value) { return Array.isArray(value) ? value : []; }
function asObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function num(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function pct(value, digits = 0) { return value === null || value === undefined || Number.isNaN(Number(value)) ? '-' : `${(Number(value) * 100).toFixed(digits)}%`; }
function money(value, digits = 0) { return value === null || value === undefined || Number.isNaN(Number(value)) ? '-' : `${Number(value).toLocaleString('en-US', { maximumFractionDigits: digits })} DKK`; }
function fmt(value, digits = 0) { return value === null || value === undefined || Number.isNaN(Number(value)) ? '-' : Number(value).toLocaleString('en-US', { maximumFractionDigits: digits }); }
function annualized(value) { return num(value) * (365 / 90); }
// Revised Cost-Bearer waste model (docs/COST_BEARER_RESOURCE_AUDIT.md).
function bearerLabel(value) { return value === 'memory' ? 'Memory' : value === 'cpu' ? 'CPU' : '-'; }
// Required display safeguards from the independent audit (APPROVE WITH CHANGES).
const GPU_WASTE_NOTE = 'GPU utilization is not currently measured. GPU optimization opportunity is therefore unknown and is not included in the optimization opportunity totals below.';
const LOWER_BOUND_NOTE = 'Optimization opportunity estimates are based on measured CPU and memory utilization only and should be considered a lower-bound estimate.';
const AGGREGATE_NOTE = 'Aggregate optimization opportunity is calculated as the sum of job-level Cost-Bearer optimization opportunity and may not equal aggregate cost multiplied by aggregate efficiency.';
function disclaimer(text) { return `<div class="disclaimer" role="note"><span class="pill warn">Note</span><span>${escapeHtml(text)}</span></div>`; }
function infoPanel(question, body) {
  return `<div class="info-panel"><div class="info-panel-icon">${icon('info')}</div><div><strong>${escapeHtml(question)}</strong><p>${escapeHtml(body)}</p></div></div>`;
}
// Measured / unmeasured bearer split for the lower-bound disclosure.
function coverageCards(coverage) {
  const c = coverage || {};
  const cards = [
    statBlock('CPU-driven jobs measured', fmt(c.cpu_bearer_jobs_measured), 'Driver efficiency observed'),
    statBlock('CPU-driven jobs unmeasured', fmt(c.cpu_bearer_jobs_unmeasured), c.cpu_bearer_jobs_unmeasured_pct != null ? `${c.cpu_bearer_jobs_unmeasured_pct}% of CPU-driven jobs` : 'No measurement available', 'warn'),
    statBlock('Memory-driven jobs measured', fmt(c.memory_bearer_jobs_measured), 'Driver efficiency observed'),
    statBlock('Memory-driven jobs unmeasured', fmt(c.memory_bearer_jobs_unmeasured), c.memory_bearer_jobs_unmeasured_pct != null ? `${c.memory_bearer_jobs_unmeasured_pct}% of memory-driven jobs` : 'No measurement available', 'warn'),
  ];
  return `<div class="cards-grid">${cards.join('')}</div>`;
}
function escapeHtml(value) { return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }
function isPersonalRoute(route) { return /^u\/[A-Za-z0-9_-]+$/.test(route || ''); }
function personalRouteToken(route) { return isPersonalRoute(route) ? route.split('/')[1] : null; }
function isHierarchyDetailRoute(route) { return /^(project|pi|group|section)\/[A-Za-z0-9_-]+$/.test(route || ''); }
function detailRouteParts(route) { const parts = String(route || '').split('/'); return { type: parts[0], id: parts[1] }; }
function isNodeDetailRoute(route) { return /^node\/[A-Za-z0-9_.-]+$/.test(route || ''); }
function nodeDetailRouteName(route) { return isNodeDetailRoute(route) ? route.split('/')[1] : null; }
function pageTitle(route) {
  if (isPersonalRoute(route)) return 'My Analytics';
  if (isHierarchyDetailRoute(route)) {
    const part = detailRouteParts(route).type;
    return part === 'pi' ? 'PI Detail' : `${part.charAt(0).toUpperCase()}${part.slice(1)} Detail`;
  }
  if (isNodeDetailRoute(route)) return 'Node Detail';
  return allRouteItems.find((item) => item.id === route)?.label || 'Overview';
}
function trendDirection(current, previous, lowerIsBetter = false) { const delta = num(current) - num(previous); const good = lowerIsBetter ? delta < 0 : delta > 0; if (Math.abs(delta) < 0.0001) return { text: 'Flat', tone: 'info' }; return { text: `${good ? 'Improving' : 'Needs attention'} (${delta > 0 ? '+' : ''}${pct(delta, 1)})`, tone: good ? 'good' : 'warn' }; }

function navLink(item) {
  const active = state.route === item.id ? 'aria-current="page"' : '';
  return `<a class="nav-link" href="#/${item.id}" ${active}>${icon(item.icon)}<span>${item.label}</span></a>`;
}

function rollingAverage(rows, key, windowSize) {
  return asArray(rows).map((row, index, all) => {
    const slice = all.slice(Math.max(0, index - windowSize + 1), index + 1);
    const values = slice.map((item) => Number(item && item[key])).filter(Number.isFinite);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  });
}

function chartSeries(rows, key, label, color, options = {}) {
  return {
    label,
    color,
    values: asArray(rows).map((row) => {
      const value = typeof key === 'function' ? key(row) : row && row[key];
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }),
    dashed: Boolean(options.dashed),
  };
}

function rollingSeries(rows, key, windowSize, label, color) {
  return { label, color, values: rollingAverage(rows, key, windowSize), dashed: true };
}

function lineChart(title, rows, series, formatter = fmt, options = {}) {
  const width = 680;
  const height = 230;
  const pad = { left: 42, right: 16, top: 18, bottom: 34 };
  const allValues = series.flatMap((item) => item.values).filter((value) => Number.isFinite(Number(value)));
  if (!allValues.length) return `<div class="empty-state">No data available for ${escapeHtml(title)}.</div>`;
  const minValue = options.zeroBase === false ? Math.min(...allValues) : Math.min(0, ...allValues);
  const maxValue = Math.max(...allValues);
  const yMin = minValue === maxValue ? minValue - 1 : minValue;
  const yMax = minValue === maxValue ? maxValue + 1 : maxValue;
  const xFor = (index, count) => pad.left + ((width - pad.left - pad.right) * (count <= 1 ? 0 : index / (count - 1)));
  const yFor = (value) => pad.top + ((height - pad.top - pad.bottom) * (1 - ((value - yMin) / (yMax - yMin))));
  const paths = series.map((item) => {
    const points = item.values
      .map((value, index) => Number.isFinite(Number(value)) ? [xFor(index, item.values.length), yFor(Number(value))] : null)
      .filter(Boolean);
    if (!points.length) return '';
    const path = points.map(([x, y], index) => `${index ? 'L' : 'M'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    return `<path d="${path}" fill="none" stroke="${item.color}" stroke-width="2.3" stroke-linecap="round" ${item.dashed ? 'stroke-dasharray="5 5"' : ''}/>`;
  }).join('');
  const latest = allValues[allValues.length - 1];
  return `
    <article class="chart-card">
      <div class="chart-head"><div><h3>${title}</h3><span class="subtle">${asArray(rows).length} daily points</span></div><strong>${formatter(latest)}</strong></div>
      <svg class="chart trend-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
        ${[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const y = pad.top + ((height - pad.top - pad.bottom) * tick);
          return `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="rgba(147,166,194,.16)"/>`;
        }).join('')}
        ${paths}
        <text x="${pad.left}" y="${height - 10}" fill="currentColor" opacity=".55" font-size="11">${escapeHtml(asArray(rows)[0]?.report_date || '')}</text>
        <text x="${width - pad.right}" y="${height - 10}" fill="currentColor" opacity=".55" font-size="11" text-anchor="end">${escapeHtml(asArray(rows).at(-1)?.report_date || '')}</text>
      </svg>
      <div class="legend">${series.map((item) => `<span><i style="background:${item.color}"></i>${item.label}</span>`).join('')}</div>
    </article>`;
}

function metricCard(kpi) {
  return `<article class="metric-card ${kpi.tone || ''}"><div class="metric-label">${kpi.label}</div><div class="metric-value">${kpi.value}</div><div class="metric-trend">${kpi.trend}</div></article>`;
}

function statBlock(label, value, trend, tone = '') {
  return `<article class="stat-card ${tone}"><div class="label">${label}</div><div class="value">${value}</div><div class="subtle">${trend}</div></article>`;
}

function percentileCard(label, value, status, tone) {
  return `<article class="percentile-card"><span class="pill ${tone}">${label}</span><strong>${value}</strong><div class="subtle">${status}</div></article>`;
}

function tableFromRows(headers, rows) {
  const body = rows.length
    ? rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${headers.length}">No data available.</td></tr>`;
  return `<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
}

// Node Insights: live Slurm fleet state (sinfo / scontrol -d / squeue).
// Public-safe aggregate and node-hardware views only - no Airtable, no
// usernames, no job-identity or job-directory fields, no per-job identity.
// GPU allocation always comes from scontrol -d show node's GresUsed field,
// never from plain AllocTRES.
const ALLOCATION_THRESHOLDS = { warn: 0.7, bad: 0.9 };
function allocationReading(pctValue) {
  if (pctValue === null || pctValue === undefined || Number.isNaN(Number(pctValue))) return 'info';
  if (pctValue >= ALLOCATION_THRESHOLDS.bad) return 'bad';
  if (pctValue >= ALLOCATION_THRESHOLDS.warn) return 'warn';
  return 'good';
}
function toneFromReading(reading) { return reading === 'bad' || reading === 'warn' || reading === 'good' ? reading : ''; }
function gib(mib, digits = 0) { return mib === null || mib === undefined || Number.isNaN(Number(mib)) ? '-' : `${fmt(Number(mib) / 1024, digits)} GiB`; }

function nodeInsightsUnavailable(pageLabel) {
  return `<div class="empty-state">${escapeHtml(pageLabel)} data has not been collected yet.</div>`;
}

function allocationGauge(label, alloc, total, formatter, note) {
  const pctValue = total ? Number(alloc) / Number(total) : null;
  const tone = allocationReading(pctValue);
  const widthPct = pctValue === null ? 0 : Math.max(2, Math.min(100, pctValue * 100));
  return `<article class="stat-card gauge-card ${tone}">
    <div class="label">${escapeHtml(label)}</div>
    <div class="value">${formatter(alloc)} / ${formatter(total)}</div>
    <div class="breakdown-track"><i style="width:${widthPct.toFixed(1)}%"></i></div>
    <div class="subtle">${pct(pctValue)} allocated${note ? ` &middot; ${escapeHtml(note)}` : ''}</div>
  </article>`;
}

function nodeStatePill(node) {
  const tone = node.drain ? 'warn' : (node.state_base === 'DOWN' ? 'bad' : 'good');
  const label = node.drain ? `${node.state_base} (maintenance)` : node.state_base;
  return `<span class="pill ${tone}">${escapeHtml(label || 'unknown')}</span>`;
}

function selectFilter(filterKey, label, options, selected) {
  return `<label class="filter-field"><span>${escapeHtml(label)}</span><select data-action="filter-nodes" data-filter="${filterKey}">
    <option value="all" ${selected === 'all' ? 'selected' : ''}>All</option>
    ${options.map((o) => `<option value="${escapeHtml(o)}" ${selected === o ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}
  </select></label>`;
}

function sortableTableFromRows(columns, rows, sortKey, sortDir) {
  const headers = columns.map(([label, key]) => {
    if (!key) return `<th>${escapeHtml(label)}</th>`;
    const active = key === sortKey;
    const arrow = active ? (sortDir === 'desc' ? ' ↓' : ' ↑') : '';
    return `<th><button type="button" class="sort-button" data-action="sort-nodes" data-key="${key}">${escapeHtml(label)}${arrow}</button></th>`;
  }).join('');
  const body = rows.length
    ? rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${columns.length}">No nodes match the current filters.</td></tr>`;
  return `<table><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table>`;
}

// Node Insights history: hourly time series collected by
// scripts/collect_node_insights.py into data/node_insights.sqlite and
// exported as public-safe aggregate JSON by scripts/export_node_insights.py
// into the dashboard-data repo (capacity_history.json, node_history.json -
// see docs/DASHBOARD_DATA_MIGRATION.md). Charts render with Apache ECharts
// (CDN <script> in index.html) after each render() pass - see
// mountCharts() near the bottom of this file.
const HISTORY_RANGES = [
  { id: '24h', label: '24h', ms: 24 * 60 * 60 * 1000 },
  { id: '7d', label: '7d', ms: 7 * 24 * 60 * 60 * 1000 },
  { id: '30d', label: '30d', ms: 30 * 24 * 60 * 60 * 1000 },
  { id: '90d', label: '90d', ms: 90 * 24 * 60 * 60 * 1000 },
];

function rangeButtons() {
  return `<div class="range-toggle">${HISTORY_RANGES.map((r) => `<button type="button" class="range-button${r.id === state.historyRange ? ' active' : ''}" data-action="set-history-range" data-range="${r.id}">${r.label}</button>`).join('')}</div>`;
}

function filterPointsByRange(points) {
  const range = HISTORY_RANGES.find((r) => r.id === state.historyRange) || HISTORY_RANGES[1];
  const cutoff = Date.now() - range.ms;
  return asArray(points).filter((p) => p && p.timestamp && new Date(p.timestamp).getTime() >= cutoff);
}

function hasCapacityHistory() {
  return Boolean(nodeInsightsHistory && nodeInsightsHistory.available && asArray(nodeInsightsHistory.capacity).length);
}

function historyUnavailableNote() {
  return disclaimer('Historical trend collection has not started yet. Once the hourly collector (scripts/collect_node_insights.py) has been running for a while, pressure and queue trends will appear here.');
}

function capacityHistorySection(chartId, title, subtitle) {
  if (!hasCapacityHistory()) return historyUnavailableNote();
  return `<section class="section">
    <div class="section-head"><h2>${escapeHtml(title)}</h2>${rangeButtons()}</div>
    ${subtitle ? `<p class="subtle">${escapeHtml(subtitle)}</p>` : ''}
    <div id="${chartId}" class="chart-container" data-chart-kind="capacity-history"></div>
  </section>`;
}

function drainingHistorySection(chartId) {
  if (!hasCapacityHistory()) return historyUnavailableNote();
  return `<section class="section">
    <div class="section-head"><h2>Node availability trend</h2>${rangeButtons()}</div>
    <p class="subtle">Available, draining, and down node counts over time.</p>
    <div id="${chartId}" class="chart-container" data-chart-kind="draining-history"></div>
  </section>`;
}

function nodeHistorySection(chartId, nodeName, title) {
  const points = nodeInsightsHistory && nodeInsightsHistory.available ? nodeInsightsHistory.nodes[nodeName] : null;
  if (!points || !points.length) return historyUnavailableNote();
  return `<section class="section">
    <div class="section-head"><h2>${escapeHtml(title)}</h2>${rangeButtons()}</div>
    <div id="${chartId}" class="chart-container" data-chart-kind="node-history" data-chart-node="${escapeHtml(nodeName)}"></div>
  </section>`;
}

function cssVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}
function chartTextColor() { return cssVar('--muted', '#90a2bc'); }
function chartLineColor() { return cssVar('--border', 'rgba(147,166,194,0.16)'); }
function chartPct(rawValue) { return rawValue === null || rawValue === undefined ? null : Math.round(Number(rawValue) * 1000) / 10; }

// Shared mobile/desktop ECharts config. Every chart on the dashboard
// (current and future - infrastructure, capacity, nodes, queue insights,
// etc.) should build its option through baseChartOption() so it picks up
// the responsive legend/grid/axis/tooltip/dataZoom behavior automatically
// instead of needing page-specific mobile fixes.
const CHART_MOBILE_BREAKPOINT = 768;
function isMobileChartViewport() {
  return window.matchMedia(`(max-width: ${CHART_MOBILE_BREAKPOINT - 1}px)`).matches;
}

function baseChartOption(categories, extraGrid) {
  const mobile = isMobileChartViewport();
  const grid = mobile
    ? Object.assign({ left: 44, right: 12, top: 136, bottom: 56 }, extraGrid)
    : Object.assign({ left: 48, right: 16, top: 44, bottom: 64 }, extraGrid);
  // Mobile: vertical, scrollable legend pinned above the plot area (grid.top
  // is pushed down to make room for it) instead of the desktop horizontal
  // row, which wraps awkwardly once there are more than a couple of series.
  const legend = mobile
    ? {
        type: 'scroll',
        orient: 'vertical',
        top: 4,
        left: 'center',
        align: 'left',
        itemGap: 14,
        height: 110,
        textStyle: { color: chartTextColor(), fontSize: 12 },
        pageIconColor: chartTextColor(),
        pageIconInactiveColor: chartLineColor(),
        pageTextStyle: { color: chartTextColor() },
      }
    : { top: 0, textStyle: { color: chartTextColor() } };
  return {
    backgroundColor: 'transparent',
    textStyle: { color: chartTextColor(), fontFamily: 'inherit' },
    grid,
    legend,
    tooltip: {
      trigger: 'axis',
      confine: true,
      extraCssText: 'max-width:90vw;',
      formatter: (params) => {
        const list = Array.isArray(params) ? params : [params];
        if (!list.length) return '';
        const header = chartTimeTooltipLabel(list[0].axisValue);
        const rows = list
          .filter((p) => p.value !== null && p.value !== undefined)
          .map((p) => `${p.marker}${p.seriesName}: <strong>${p.value}</strong>`)
          .join('<br/>');
        return `${header}<br/>${rows}`;
      },
    },
    dataZoom: mobile
      ? [{ type: 'inside' }, { type: 'slider', height: 10, bottom: 4, handleSize: '70%', textStyle: { color: chartTextColor(), fontSize: 10 } }]
      : [{ type: 'inside' }, { type: 'slider', height: 16, bottom: 8, textStyle: { color: chartTextColor() } }],
    xAxis: {
      type: 'category',
      data: categories,
      axisLine: { lineStyle: { color: chartLineColor() } },
      axisLabel: Object.assign(
        { color: chartTextColor(), formatter: chartTimeLabel, interval: 'auto' },
        mobile ? { rotate: 45 } : {},
      ),
    },
  };
}

function lineSeries(def, data) {
  return {
    name: def.name,
    type: 'line',
    smooth: true,
    showSymbol: false,
    yAxisIndex: def.axis || 0,
    itemStyle: { color: def.color },
    lineStyle: { color: def.color, width: 2 },
    data,
  };
}

function capacityHistoryChartOption(points) {
  const categories = points.map((p) => p.timestamp);
  const seriesDefs = [
    { key: 'cpu_pct', name: 'CPU pressure', color: cssVar('--blue', '#3e8cff'), axis: 0, pct: true },
    { key: 'memory_pct', name: 'Memory pressure', color: cssVar('--teal', '#2dd4bf'), axis: 0, pct: true },
    { key: 'gpu_pct', name: 'GPU pressure', color: cssVar('--amber', '#ffb84d'), axis: 0, pct: true },
    { key: 'running_jobs', name: 'Running jobs', color: cssVar('--green', '#53d88a'), axis: 1 },
    { key: 'pending_jobs', name: 'Pending jobs', color: cssVar('--red', '#ff6b7a'), axis: 1 },
    { key: 'draining_nodes', name: 'Draining nodes', color: cssVar('--cyan', '#30d5d0'), axis: 1 },
  ];
  return Object.assign(baseChartOption(categories, { right: 48 }), {
    yAxis: [
      { type: 'value', name: '%', min: 0, max: 100, axisLabel: { color: chartTextColor(), formatter: '{value}%' }, splitLine: { lineStyle: { color: chartLineColor() } } },
      { type: 'value', name: 'jobs / nodes', min: 0, axisLabel: { color: chartTextColor() }, splitLine: { show: false } },
    ],
    series: seriesDefs.map((def) => lineSeries(def, points.map((p) => (def.pct ? chartPct(p[def.key]) : (p[def.key] === null || p[def.key] === undefined ? null : Number(p[def.key])))))),
  });
}

function drainingHistoryChartOption(points) {
  const categories = points.map((p) => p.timestamp);
  const seriesDefs = [
    { key: 'available_nodes', name: 'Available', color: cssVar('--green', '#53d88a') },
    { key: 'draining_nodes', name: 'Draining', color: cssVar('--amber', '#ffb84d') },
    { key: 'down_nodes', name: 'Down', color: cssVar('--red', '#ff6b7a') },
  ];
  return Object.assign(baseChartOption(categories), {
    yAxis: { type: 'value', name: 'nodes', min: 0, axisLabel: { color: chartTextColor() }, splitLine: { lineStyle: { color: chartLineColor() } } },
    series: seriesDefs.map((def) => lineSeries(def, points.map((p) => (p[def.key] === null || p[def.key] === undefined ? null : Number(p[def.key]))))),
  });
}

function nodeHistoryChartOption(points) {
  const categories = points.map((p) => p.timestamp);
  const seriesDefs = [
    { key: 'cpu_pct', name: 'CPU utilization', color: cssVar('--blue', '#3e8cff') },
    { key: 'mem_pct', name: 'Memory utilization', color: cssVar('--teal', '#2dd4bf') },
    { key: 'gpu_pct', name: 'GPU utilization', color: cssVar('--amber', '#ffb84d') },
  ];
  return Object.assign(baseChartOption(categories), {
    yAxis: { type: 'value', name: '%', min: 0, max: 100, axisLabel: { color: chartTextColor(), formatter: '{value}%' }, splitLine: { lineStyle: { color: chartLineColor() } } },
    series: seriesDefs.map((def) => lineSeries(def, points.map((p) => chartPct(p[def.key])))),
  });
}

let activeCharts = [];
let chartsRenderedForMobile = null;
function disposeCharts() {
  activeCharts.forEach((chart) => {
    try { chart.dispose(); } catch (error) { /* chart already gone with its DOM node */ }
  });
  activeCharts = [];
}

function mountCharts() {
  disposeCharts();
  if (!window.echarts) return;
  chartsRenderedForMobile = isMobileChartViewport();
  document.querySelectorAll('[data-chart-kind]').forEach((el) => {
    const kind = el.dataset.chartKind;
    let option = null;
    if (kind === 'capacity-history' && hasCapacityHistory()) {
      option = capacityHistoryChartOption(filterPointsByRange(nodeInsightsHistory.capacity));
    } else if (kind === 'draining-history' && hasCapacityHistory()) {
      option = drainingHistoryChartOption(filterPointsByRange(nodeInsightsHistory.capacity));
    } else if (kind === 'node-history') {
      const points = nodeInsightsHistory && nodeInsightsHistory.available ? nodeInsightsHistory.nodes[el.dataset.chartNode] : null;
      if (points && points.length) option = nodeHistoryChartOption(filterPointsByRange(points));
    }
    if (!option) return;
    const chart = window.echarts.init(el, null, { renderer: 'svg' });
    chart.setOption(option);
    activeCharts.push(chart);
  });
}

let chartResizeAttached = false;
function setupChartResize() {
  if (chartResizeAttached) return;
  chartResizeAttached = true;
  // Crossing the mobile breakpoint (e.g. rotating an iPhone) needs a full
  // re-render so the legend/grid/axis switch layouts, not just a resize.
  window.addEventListener('resize', () => {
    if (chartsRenderedForMobile !== null && chartsRenderedForMobile !== isMobileChartViewport()) {
      mountCharts();
      return;
    }
    activeCharts.forEach((chart) => chart.resize());
  });
}

function infrastructureOverviewPage() {
  if (!nodeInsights || !nodeInsights.available) return nodeInsightsUnavailable('Infrastructure Overview');
  const co = asObject(nodeInsights.clusterOverview);
  const totals = asObject(co.totals);
  const cpu = asObject(co.cpu);
  const mem = asObject(co.memory_mib);
  const gpu = asObject(co.gpu);
  const queue = asObject(co.queue);
  const maintenance = asObject(co.maintenance);
  const byClass = asArray(co.by_class);
  const byPartition = asArray(co.by_partition);
  const topReason = asArray(queue.pending_reasons)[0];

  return `
    <div class="stack">
      ${infraStatusBar()}
      <section class="section"><div class="section-head"><h2>Fleet status</h2></div><div class="cards-grid">${[
        statBlock('Total nodes', fmt(totals.nodes_total), 'Live Slurm node count'),
        statBlock('Available nodes', fmt(totals.nodes_available), 'Not draining, not down', 'good'),
        statBlock('Draining nodes', fmt(totals.nodes_draining), 'Scheduled for maintenance', totals.nodes_draining ? 'warn' : 'good'),
        statBlock('Down nodes', fmt(totals.nodes_down), 'Unreachable or failed', totals.nodes_down ? 'bad' : 'good'),
      ].join('')}</div></section>
      <div class="cards-grid">
        ${allocationGauge('CPU allocation', cpu.alloc, cpu.total, fmt)}
        ${allocationGauge('Memory allocation', mem.alloc, mem.total, gib)}
        ${allocationGauge('GPU allocation', gpu.alloc, gpu.total, fmt, gpu.alloc_pct_of_online !== null && gpu.alloc_pct_of_online !== undefined ? `${pct(gpu.alloc_pct_of_online)} of online GPUs` : null)}
      </div>
      <section class="section"><div class="section-head"><h2>Queue right now</h2><span class="subtle">Aggregate counts only - no job or user identity</span></div><div class="cards-grid">${[
        statBlock('Jobs in queue', fmt(queue.jobs_total), 'Running + pending'),
        statBlock('Running', fmt(queue.running), 'Across all partitions', 'good'),
        statBlock('Pending', fmt(queue.pending), 'Waiting to start', 'info'),
      ].join('')}</div>
        ${tableFromRows(['Partition', 'Running', 'Pending'], asArray(queue.by_partition).map((p) => [escapeHtml(p.partition), fmt(p.running), fmt(p.pending)]))}
        <p class="subtle" style="margin-top:10px">Top pending reason: <strong>${escapeHtml((topReason && topReason.reason) || 'none')}</strong>${topReason ? ` (${fmt(topReason.count)} jobs)` : ''}</p>
      </section>
      <section class="section"><div class="section-head"><h2>Nodes in maintenance (${fmt(maintenance.nodes_draining)})</h2><span class="subtle"><a href="#/nodes">View Node Inventory</a></span></div>
        ${asArray(maintenance.nodes).length
          ? tableFromRows(['Node', 'Reason', 'Since'], asArray(maintenance.nodes).map((n) => [`<a href="#/node/${escapeHtml(n.node)}">${escapeHtml(n.node)}</a>`, escapeHtml(n.reason || '-'), escapeHtml(n.since || '-')]))
          : '<div class="empty-state">No nodes are currently draining.</div>'}
      </section>
      <div class="trend-grid">
        <section class="section"><div class="section-head"><h2>By class</h2><span class="subtle">Live classification rules</span></div>${tableFromRows(['Class', 'Nodes'], byClass.map((c) => [escapeHtml(c.class), fmt(c.count)]))}</section>
        <section class="section"><div class="section-head"><h2>By partition</h2><span class="subtle">Node membership</span></div>${tableFromRows(['Partition', 'Nodes'], byPartition.map((p) => [escapeHtml(p.partition), fmt(p.node_count)]))}</section>
      </div>
      ${capacityHistorySection('chart-infra-history', 'Cluster pressure trend', 'CPU, memory, and GPU pressure plus running/pending jobs and draining nodes over time.')}
      ${disclaimer('GPU allocation reflects scheduler reservation (GresUsed from scontrol -d show node), not measured GPU utilization. GPU utilization is not currently measured on Mjolnir.')}
    </div>`;
}

function nodeInventoryPage() {
  if (!nodeInsights || !nodeInsights.available) return nodeInsightsUnavailable('Node Inventory');
  const allNodes = asArray(nodeInsights.nodeInventory.nodes);
  const filters = state.nodeFilters;
  const classes = Array.from(new Set(allNodes.map((n) => n.class_label))).sort();
  const partitions = Array.from(new Set(allNodes.flatMap((n) => asArray(n.partitions)))).sort();
  const states = Array.from(new Set(allNodes.map((n) => n.state))).sort();

  const filtered = allNodes.filter((n) =>
    (filters.class === 'all' || n.class_label === filters.class) &&
    (filters.partition === 'all' || asArray(n.partitions).includes(filters.partition)) &&
    (filters.state === 'all' || n.state === filters.state));

  const dir = filters.sortDir === 'desc' ? -1 : 1;
  const sorted = filtered.slice().sort((a, b) => {
    const av = a[filters.sortKey];
    const bv = b[filters.sortKey];
    if (typeof av === 'string' || typeof bv === 'string') return dir * String(av || '').localeCompare(String(bv || ''));
    return dir * (num(av) - num(bv));
  });

  const tableRows = sorted.map((n) => [
    `<a href="#/node/${escapeHtml(n.node)}"><strong>${escapeHtml(n.node)}</strong></a>`,
    escapeHtml(n.class_label),
    fmt(n.cpu_total),
    n.cpu_alloc_pct === null || n.cpu_alloc_pct === undefined ? '-' : pct(n.cpu_alloc_pct),
    gib(n.real_memory_mib),
    n.mem_alloc_pct === null || n.mem_alloc_pct === undefined ? '-' : pct(n.mem_alloc_pct),
    n.gpu_total ? `${fmt(n.gpu_total)}x ${escapeHtml((n.gpu_type || 'GPU').toUpperCase())}` : '-',
    n.gpu_total ? `${fmt(n.gpu_alloc)}/${fmt(n.gpu_total)} (${pct(n.gpu_alloc_pct)})` : '-',
    nodeStatePill(n),
    escapeHtml(asArray(n.partitions).join(', ')),
  ]);

  return `
    <div class="stack">
      ${infraStatusBar()}
      <section class="section">
        <div class="section-head"><h2>Node Inventory</h2><span class="subtle">${fmt(sorted.length)} of ${fmt(allNodes.length)} nodes</span></div>
        <div class="filter-bar">
          ${selectFilter('class', 'Class', classes, filters.class)}
          ${selectFilter('partition', 'Partition', partitions, filters.partition)}
          ${selectFilter('state', 'State', states, filters.state)}
        </div>
        <div class="table-card">${sortableTableFromRows([
          ['Node', 'node'], ['Class', 'class_label'], ['CPUs', 'cpu_total'], ['CPU %', 'cpu_alloc_pct'],
          ['RAM', 'real_memory_mib'], ['Mem %', 'mem_alloc_pct'], ['GPUs', 'gpu_total'], ['GPU %', 'gpu_alloc_pct'],
          ['State', 'state'], ['Partitions', null],
        ], tableRows, filters.sortKey, filters.sortDir)}</div>
      </section>
      ${drainingHistorySection('chart-nodes-draining-history')}
      ${disclaimer('GPU% reflects scheduler-reserved GPUs from scontrol -d show node (GresUsed), not measured GPU utilization.')}
    </div>`;
}

function hardwareInventoryPage() {
  if (!nodeInsights || !nodeInsights.available) return nodeInsightsUnavailable('Hardware Inventory');
  const hw = asObject(nodeInsights.hardwareInventory);
  const fleet = asObject(hw.fleet);
  const profiles = asArray(hw.profiles);
  const slurmVersions = asArray(hw.slurm_versions);
  const osBuilds = asArray(hw.os_kernel_builds);
  const drift = asObject(hw.kernel_drift);

  return `
    <div class="stack">
      ${infraStatusBar()}
      <section class="section"><div class="section-head"><h2>Fleet composition</h2><span class="subtle">Asset inventory, from scontrol show node static fields</span></div><div class="cards-grid">${[
        statBlock('Nodes', fmt(fleet.nodes_total), 'Total fleet size'),
        statBlock('Logical CPUs', fmt(fleet.logical_cpus_total), `${fmt(fleet.physical_cores_total)} physical cores`),
        statBlock('RAM', gib(fleet.ram_mib_total), 'Configured fleet-wide'),
        statBlock('GPUs', fmt(fleet.gpu_total), asArray(fleet.gpu_types).map((t) => String(t).toUpperCase()).join(', ') || 'None'),
      ].join('')}</div></section>
      <section class="table-card"><div class="section-head"><h2>Hardware profiles</h2><span class="subtle">${fmt(profiles.length)} distinct tiers</span></div>${tableFromRows(
        ['Profile', 'Nodes', 'CPUs', 'RAM', 'GPU'],
        profiles.map((p) => [escapeHtml(p.label), fmt(p.node_count), fmt(p.cpu_total), gib(p.real_memory_mib), p.gpu_count ? `${fmt(p.gpu_count)}x ${escapeHtml(String(p.gpu_type || '').toUpperCase())}` : '-'])
      )}</section>
      <div class="trend-grid">
        <section class="section"><div class="section-head"><h2>Slurm version</h2><span class="subtle">Daemon version per node</span></div>${tableFromRows(['Version', 'Nodes'], slurmVersions.map((v) => [escapeHtml(v.version), fmt(v.node_count)]))}</section>
        <section class="section"><div class="section-head"><h2>OS / kernel drift</h2><span class="subtle">${escapeHtml(drift.note || '')}</span></div>${tableFromRows(['Kernel build', 'Nodes'], osBuilds.map((o) => [escapeHtml(o.os), fmt(o.node_count)]))}</section>
      </div>
    </div>`;
}

function capacityPlanningPage() {
  if (!nodeInsights || !nodeInsights.available) return nodeInsightsUnavailable('Capacity Planning');
  const cp = asObject(nodeInsights.capacityPlanning);
  const pressure = asObject(cp.pressure);
  const cpu = asObject(pressure.cpu);
  const mem = asObject(pressure.memory);
  const gpu = asObject(pressure.gpu);
  const qp = asObject(cp.queue_pressure);
  const maint = asObject(cp.maintenance_exposure);
  const fleetTotal = asObject(asObject(nodeInsights.clusterOverview).totals).nodes_total;

  return `
    <div class="stack">
      ${infraStatusBar()}
      ${capacityHistorySection('chart-capacity-history', 'Pressure & queue trend', 'CPU, memory, and GPU pressure plus running/pending jobs and draining nodes over time.')}
      <section class="section"><div class="section-head"><h2>Current pressure</h2><span class="subtle">Live snapshot</span></div><div class="cards-grid">${[
        statBlock('CPU pressure', pct(cpu.alloc_pct), `${fmt(cpu.alloc)} / ${fmt(cpu.total)} logical CPUs allocated`, toneFromReading(cpu.reading)),
        statBlock('Memory pressure', pct(mem.alloc_pct), `${gib(mem.alloc)} / ${gib(mem.total)} allocated`, toneFromReading(mem.reading)),
        statBlock('GPU pressure', pct(gpu.alloc_pct_of_online !== null && gpu.alloc_pct_of_online !== undefined ? gpu.alloc_pct_of_online : gpu.alloc_pct), `${fmt(gpu.alloc)} / ${fmt(gpu.total)} GPUs allocated (${fmt(gpu.online_total)} online)`, toneFromReading(gpu.reading)),
      ].join('')}</div></section>
      <section class="section"><div class="section-head"><h2>Pending-job pressure right now</h2><span class="subtle">${fmt(qp.pending_total)} pending jobs</span></div>
        ${tableFromRows(['Reason', 'Count'], asArray(qp.pending_reasons).map((r) => [escapeHtml(r.reason), fmt(r.count)]))}
        <p class="subtle" style="margin-top:10px">${escapeHtml(qp.read || '')}</p>
      </section>
      <section class="section"><div class="section-head"><h2>Maintenance exposure</h2><span class="subtle">${fmt(maint.nodes_draining)} of ${fmt(fleetTotal)} nodes draining</span></div><div class="cards-grid">${[
        statBlock('Nodes draining', `${fmt(maint.nodes_draining)} (${pct(maint.nodes_draining_pct)})`, 'Share of fleet offline for maintenance', maint.nodes_draining ? 'warn' : 'good'),
        statBlock('CPU capacity removed', `${fmt(maint.cpu_removed)} (${pct(maint.cpu_removed_pct)})`, 'Logical CPUs unavailable due to maintenance'),
        statBlock('GPU capacity removed', `${fmt(maint.gpu_removed)} (${pct(maint.gpu_removed_pct)})`, 'GPUs unavailable due to maintenance', maint.gpu_removed ? 'warn' : 'good'),
      ].join('')}</div></section>
    </div>`;
}

function nodeDetailPage(nodeName) {
  if (!nodeInsights || !nodeInsights.available) return nodeInsightsUnavailable('Node Detail');
  const node = asArray(nodeInsights.nodeInventory.nodes).find((n) => n.node === nodeName);
  if (!node) {
    return `<div class="stack"><section class="section"><div class="section-head"><h2>Node not found</h2><span class="pill warn">Unknown node</span></div><div class="empty-state">No live Slurm record was found for ${escapeHtml(nodeName)}. <a href="#/nodes">Back to Node Inventory</a></div></section></div>`;
  }
  const gpuIdleCpuBusy = node.gpu_total > 0 && node.gpu_alloc === 0 && node.cpu_alloc > 0;
  return `
    <div class="stack">
      ${infraStatusBar()}
      <section class="section">
        <div class="section-head"><h2>${escapeHtml(node.node)}</h2>${nodeStatePill(node)}</div>
        ${node.drain ? disclaimer(`Maintenance reason: "${node.drain_reason || 'unspecified'}"${node.drain_since ? ` - since ${node.drain_since}` : ''}`) : ''}
        <div class="cards-grid">${[
          statBlock('Class', escapeHtml(node.class_label || '-'), 'Live classification'),
          statBlock('Partitions', escapeHtml(asArray(node.partitions).join(', ') || '-'), 'Queue membership'),
          statBlock('Architecture', escapeHtml(node.arch || '-'), 'CPU architecture'),
        ].join('')}</div>
      </section>
      <div class="trend-grid">
        <section class="section"><div class="section-head"><h2>Hardware</h2><span class="subtle">Static fields from scontrol show node</span></div>${tableFromRows(['Field', 'Value'], [
          ['Sockets', fmt(node.sockets)],
          ['Cores / socket', fmt(node.cores_per_socket)],
          ['Threads / core', fmt(node.threads_per_core)],
          ['Logical CPUs', fmt(node.cpu_total)],
          ['Physical cores', fmt(node.physical_cores)],
          ['RAM', gib(node.real_memory_mib)],
          ['GPU', node.gpu_total ? `${fmt(node.gpu_total)}x ${escapeHtml(String(node.gpu_type || '').toUpperCase())}` : 'None'],
          ['Slurm version', escapeHtml(node.slurm_version || '-')],
          ['OS / kernel', escapeHtml(node.os || '-')],
          ['Boot time', escapeHtml(node.boot_time || '-')],
          ['Slurmd start time', escapeHtml(node.slurmd_start_time || '-')],
        ])}</section>
        <section class="section"><div class="section-head"><h2>Live allocation</h2><span class="subtle">From scontrol -d show node (GresUsed for GPU)</span></div>${tableFromRows(['Field', 'Value'], [
          ['CPU allocation', `${fmt(node.cpu_alloc)} / ${fmt(node.cpu_total)} (${pct(node.cpu_alloc_pct)})`],
          ['CPU load', node.cpu_load === null || node.cpu_load === undefined ? '-' : fmt(node.cpu_load, 2)],
          ['Memory allocation', `${gib(node.alloc_mem_mib)} / ${gib(node.real_memory_mib)} (${pct(node.mem_alloc_pct)})`],
          ['Memory free', gib(node.free_mem_mib)],
          ['GPU allocation', node.gpu_total ? `${fmt(node.gpu_alloc)} / ${fmt(node.gpu_total)} (${pct(node.gpu_alloc_pct)})` : 'No GPUs on this node'],
          ['GPU indexes allocated', node.gpu_indexes_allocated ? escapeHtml(node.gpu_indexes_allocated) : 'None'],
          ['Running jobs on this node', fmt(node.running_jobs_count)],
        ])}</section>
      </div>
      ${nodeHistorySection('chart-node-history', node.node, 'Utilization history')}
      ${gpuIdleCpuBusy ? insight('GPU-idle, CPU-busy', `This node has ${fmt(node.cpu_alloc)} CPUs allocated but 0 of its ${fmt(node.gpu_total)} GPUs are reserved.${node.drain ? ' It is draining for maintenance but still absorbing CPU-only work.' : ''}`) : ''}
      ${disclaimer('Job-level detail (which user or job is running here) requires admin access and is not shown in this public view. No usernames, job names, or job IDs are exposed on this page.')}
      <p class="subtle"><a href="#/nodes">&larr; Back to Node Inventory</a></p>
    </div>`;
}

function recommendationCards(limit = 3) {
  const groups = asArray(data?.recommendationSummary);
  return groups.slice(0, limit).map((item) => recCard(
    item.priority === 'high' ? 'High impact' : 'Medium impact',
    item.title || item.type,
    `${fmt(item.affectedUsers)} users affected`,
    money(item.wasteContext)
  ));
}

function recCard(level, title, detail, savings) {
  return `<article class="rec-card"><div class="rec-top"><span class="pill ${level.startsWith('High') ? 'warn' : 'info'}">${level}</span><strong>${savings}</strong></div><div>${escapeHtml(title)}</div><div class="subtle">${escapeHtml(detail)}</div></article>`;
}

function landingPage() {
  const allTime = asObject(data?.clusterSummary?.allTime);
  const meta = asObject(data?.datasetMeta);
  const rows = asArray(data?.clusterSummary?.dailyTrends);
  const failureRate = num(allTime.failed_jobs) / Math.max(1, num(allTime.jobs));
  const snapshotCount = asArray(nodeInsightsHistory?.capacity).length + rows.length;
  const activeModuleCount = platformRegistry.filter((m) => !m.planned && m.available).length;
  return `
    ${platformStatusPanel(platformRegistry, { snapshotCount, activeModuleCount })}
    <div class="overview-top-grid">
      <section class="intro-card">
        <div class="intro-card-icon">${icon('cluster')}</div>
        <div>
          <h2>Mjolnir Analytics</h2>
          <p>Mjolnir Analytics provides researchers and Principal Investigators with a clear view of how compute resources are being used across the Mjolnir platform.</p>
          <p>It combines resource consumption, cost drivers, project-level trends, and optimization opportunities to help research groups make informed decisions about their use of shared HPC resources.</p>
          <p class="subtle">Future versions will also include storage usage, storage growth, and sustainability metrics.</p>
        </div>
      </section>
      ${renderSystemHealthCard(platformRegistry)}
    </div>
    <section class="hero">
      <div class="hero-copy">
        <div class="eyebrow">${dot('green')} REAL MJOLNIR DATA - 90-day validation dataset</div>
        <h1>See how Mjolnir's resources are really being used.</h1>
        <p>Helping researchers understand resource usage, cost drivers, and optimization opportunities across Mjolnir.</p>
        <div class="hero-actions"><a class="btn btn-primary" href="#/cluster-health">View Cluster Resource Health</a><a class="btn" href="#/rankings">View rankings</a><a class="btn" href="#/recovery">View My Analytics</a></div>
      </div>
      <div class="hero-panel">
        <div class="hero-panel-head"><div class="panel-title">90-day operating picture</div><div class="subtle">${meta.validationWindow || 'Validation window unavailable'}</div></div>
        <div class="mini-grid">
          ${[
            { label: 'CPU efficiency', value: pct(allTime.avg_cpu_efficiency), trend: `${fmt(allTime.jobs)} measured jobs`, tone: 'warn' },
            { label: 'Memory efficiency', value: pct(allTime.avg_memory_efficiency), trend: `${fmt(allTime.jobs_with_measured_memory)} memory-measured jobs`, tone: 'warn' },
            { label: 'Potential savings', value: money(allTime.underutilized_cost_dkk), trend: `${money(annualized(allTime.underutilized_cost_dkk))} annualized run-rate`, tone: 'info' },
            { label: 'Failure rate', value: pct(failureRate, 1), trend: `${fmt(allTime.failed_jobs)} failed jobs`, tone: failureRate > 0.1 ? 'warn' : 'good' },
          ].map(metricCard).join('')}
        </div>
        ${lineChart('CPU efficiency trend', rows, [chartSeries(rows, 'avg_cpu_efficiency', 'Daily', '#3e8cff'), rollingSeries(rows, 'avg_cpu_efficiency', 7, '7-day', '#30d5d0'), rollingSeries(rows, 'avg_cpu_efficiency', 30, '30-day', '#ffb84d')], pct, { zeroBase: true })}
      </div>
    </section>
    <section class="dashboard-grid">
      <div class="stack">
        <section class="section"><div class="section-head"><h2>What needs action?</h2><span class="subtle">Recommendations from exported user bundles</span></div><div class="rec-list">${recommendationCards(3).join('')}</div></section>
        <section class="section"><div class="section-head"><h2>Optimization opportunities</h2><span class="subtle">Top public-safe job examples</span></div>${inefficientJobsTable(asArray(data?.inefficientJobs).slice(0, 8))}</section>
      </div>
      <div class="stack">
        <section class="section"><div class="section-head"><h2>Dataset coverage</h2><span class="subtle">Export provenance</span></div><div class="cards-grid one-col">${[
          statBlock('Users', fmt(meta.userCount), 'Pseudonymous public bundles'),
          statBlock('Recommendations', fmt(meta.recommendationCount), 'Generated from user summaries'),
          statBlock('Top job examples', fmt(meta.inefficientJobCount), 'No job names or paths shown'),
        ].join('')}</div></section>
      </div>
    </section>`;
}

// Placeholder destination for the System Health card's "View Platform
// Status" button - a fuller breakdown of the same buildPlatformRegistry()
// data shown in the Overview page's Platform Status panel and System
// Health card. Expand this page as dedicated module detail pages
// (Queue Insights, Slurm Insights, ...) come online.
function platformStatusPage() {
  const activeModuleCount = platformRegistry.filter((m) => !m.planned && m.available).length;
  return `
    <div class="stack">
      ${platformStatusPanel(platformRegistry, { activeModuleCount })}
      <section class="section"><div class="section-head"><h2>Module detail</h2><span class="subtle">Per-collector freshness</span></div>
        <div class="stack">${platformRegistry.filter((m) => !m.planned).map((m) => (
          `<div><h3 style="margin:0 0 8px;font-size:0.95rem">${m.label}</h3>${statusBar(m.kind === 'infrastructure' ? 'infrastructure' : 'analytics', m)}</div>`
        )).join('')}</div>
      </section>
    </div>`;
}

function clusterPage() {
  const rows = asArray(data?.clusterSummary?.dailyTrends);
  return `
    <div class="stack">
      ${analyticsStatusBar()}
      <section class="section"><div class="section-head"><h2>Efficiency and cost trends</h2><span class="subtle">Daily values with rolling averages</span></div><p class="subtle">Use these charts to spot whether Mjolnir is becoming more efficient or drifting toward larger resource gaps.</p></section>
      <div class="trend-grid">
        ${lineChart('CPU efficiency', rows, [chartSeries(rows, 'avg_cpu_efficiency', 'Daily', '#3e8cff'), rollingSeries(rows, 'avg_cpu_efficiency', 7, '7-day', '#30d5d0'), rollingSeries(rows, 'avg_cpu_efficiency', 30, '30-day', '#ffb84d')], pct, { zeroBase: true })}
        ${lineChart('Memory efficiency', rows, [chartSeries(rows, 'avg_memory_efficiency', 'Daily', '#53d88a'), rollingSeries(rows, 'avg_memory_efficiency', 7, '7-day', '#30d5d0'), rollingSeries(rows, 'avg_memory_efficiency', 30, '30-day', '#ffb84d')], pct, { zeroBase: true })}
        ${lineChart('Daily cost and optimization opportunity', rows, [chartSeries(rows, 'estimated_cost_dkk', 'Estimated cost', '#3e8cff'), chartSeries(rows, 'underutilized_cost_dkk', 'Underutilized cost', '#ff6b7a')], money, { zeroBase: true })}
        ${lineChart('GPU hours', rows, [chartSeries(rows, 'gpu_hours', 'GPU hours', '#9cd0ff'), rollingSeries(rows, 'gpu_hours', 7, '7-day', '#30d5d0'), rollingSeries(rows, 'gpu_hours', 30, '30-day', '#ffb84d')], fmt, { zeroBase: true })}
      </div>
      </div>`;
}

function clusterHealthPage() {
  const allTime = asObject(data?.clusterSummary?.allTime);
  const rolling7 = asObject(data?.clusterSummary?.rolling7d);
  const rolling30 = asObject(data?.clusterSummary?.rolling30d);
  const failureRate = num(allTime.failed_jobs) / Math.max(1, num(allTime.jobs));
  const cpuTrend = trendDirection(rolling7.avg_cpu_efficiency, rolling30.avg_cpu_efficiency);
  const memoryTrend = trendDirection(rolling7.avg_memory_efficiency, rolling30.avg_memory_efficiency);
  const savingsTrend = trendDirection(rolling7.underutilized_cost_dkk, rolling30.underutilized_cost_dkk, true);
  return `
    <div class="stack">
      <section class="section"><div class="section-head"><h2>Cluster Resource Health</h2><span class="subtle">All metrics from the 90-day validation export</span></div><div class="cards-grid">${[
        statBlock('Total jobs', fmt(allTime.jobs), 'Measured job metrics rows'),
        statBlock('Completed jobs', fmt(allTime.completed_jobs), 'Successful workload volume', 'good'),
        statBlock('Failed jobs', fmt(allTime.failed_jobs), `${pct(failureRate, 1)} failure rate`, failureRate > 0.1 ? 'warn' : 'good'),
        statBlock('Average CPU efficiency', pct(allTime.avg_cpu_efficiency), cpuTrend.text, cpuTrend.tone),
        statBlock('Average memory efficiency', pct(allTime.avg_memory_efficiency), memoryTrend.text, memoryTrend.tone),
        statBlock('Estimated cost', money(allTime.estimated_cost_dkk), '90-day estimated spend'),
        statBlock('Potential savings', money(allTime.underutilized_cost_dkk), savingsTrend.text, savingsTrend.tone),
        statBlock('GPU hours', fmt(allTime.gpu_hours, 1), 'Measured GPU allocation time'),
        statBlock('GPU spend', money(allTime.gpu_cost_dkk), 'Estimated GPU cost'),
        statBlock('GPU optimization opportunity', 'Unknown', 'GPU utilization not measured'),
        statBlock('Main cost driver', bearerLabel(allTime.cost_bearer), 'Whichever resource - CPU or memory - drives most of the cost'),
        statBlock('Driver-resource cost', money(allTime.cost_bearer_cost_dkk), 'Spend attributable to the main cost driver'),
        statBlock('Driver-resource efficiency', pct(allTime.cost_bearer_efficiency), 'How efficiently the main cost driver is used'),
        statBlock('Driver-resource potential savings', money(allTime.cost_bearer_waste_dkk ?? allTime.underutilized_cost_dkk), 'Estimated potential savings from the main cost driver (Cost-Bearer model)'),
      ].join('')}</div>${disclaimer(LOWER_BOUND_NOTE)}${disclaimer(GPU_WASTE_NOTE)}${disclaimer(AGGREGATE_NOTE)}</section>
      <section class="section"><div class="section-head"><h2>Measurement coverage</h2><span class="subtle">How much of the cluster has measured utilization</span></div>${coverageCards(data?.clusterSummary?.measurementCoverage)}</section>
      <section class="section"><div class="section-head"><h2>Immediate operational reading</h2><span class="subtle">Actionable interpretation</span></div><div class="insight-grid">${[
        insight('CPU requests', `Average CPU efficiency is ${pct(allTime.avg_cpu_efficiency)}. Focus first on users with high savings opportunity and low measured CPU use.`),
        insight('Memory requests', `Average memory efficiency is ${pct(allTime.avg_memory_efficiency)}. Many jobs likely request much more memory than they use.`),
        insight('Cost control', `${money(allTime.underutilized_cost_dkk)} of 90-day cost is marked as underutilized. Treat this as the main optimization queue.`),
      ].join('')}</div></section>
      </div>`;
}

function insight(title, body) {
  return `<article class="rec-card"><div class="rec-top"><span class="pill info">Insight</span><strong>${escapeHtml(title)}</strong></div><div>${escapeHtml(body)}</div></article>`;
}

function rankingTable(title, rows, valueLabel, valueFormatter, key) {
  const tableRows = rows.map((user, index) => [
    fmt(index + 1),
    escapeHtml(user.label),
    valueFormatter(user[key]),
    pct(user.cpu),
    pct(user.memory),
    money(user.savings),
  ]);
  return `<section class="section"><div class="section-head"><h2>${title}</h2><span class="subtle">Top ${rows.length}</span></div>${tableFromRows(['Rank', 'Pseudonym', valueLabel, 'CPU', 'Memory', 'Savings opportunity'], tableRows)}</section>`;
}

function rankingsPage() {
  const rankings = asObject(data?.rankings);
  return `
    <div class="stack">
      ${analyticsStatusBar()}
      ${infoPanel('What do these rankings mean?', 'Rankings are not performance scores. They highlight which projects and users have the greatest optimization potential - where improving resource allocation could have the largest impact across Mjolnir. A higher ranking does not mean misuse; it means there may be more room to optimize.')}
      <section class="section"><div class="section-head"><h2>Optimization potential rankings</h2><span class="subtle">Which projects and users have the greatest optimization potential?</span></div><p class="subtle">Rankings highlight optimization potential and savings opportunity without exposing real user identity.</p></section>
      ${rankingTable('Best CPU efficiency', asArray(rankings.bestCpu), 'CPU efficiency', pct, 'cpu')}
      ${rankingTable('Best memory efficiency', asArray(rankings.bestMemory), 'Memory efficiency', pct, 'memory')}
      ${rankingTable('Most improved CPU efficiency', asArray(rankings.mostImproved), 'Improvement', (value) => pct(value, 1), 'cpuImprovement')}
      ${rankingTable('Largest savings opportunity', asArray(rankings.largestSavings), 'Potential savings', money, 'savings')}
      </div>`;
}

function percentileBar(label, values, formatter, tone = 'info') {
  const keys = ['5', '25', '50', '75', '95'];
  const nums = keys.map((key) => num(values[key]));
  const max = Math.max(...nums, 1e-9);
  return `<article class="section percentile-viz"><div class="section-head"><h2>${label}</h2><span class="pill ${tone}">5-95 percentile</span></div><div class="percentile-scale">${keys.map((key) => `<div class="percentile-step"><div class="bar-track"><span style="height:${Math.max(5, (num(values[key]) / max) * 100)}%"></span></div><strong>p${key}</strong><em>${formatter(values[key])}</em></div>`).join('')}</div></article>`;
}

function benchmarkPage() {
  const percentiles = asObject(data?.percentiles);
  return `
    <div class="stack">
      ${analyticsStatusBar()}
      ${infoPanel('How do percentiles work?', 'Percentiles show how a project or user\'s resource usage compares with the broader Mjolnir community. A percentile of 90 means usage is higher than 90% of comparable peers, while a percentile of 10 means usage is lower than most peers. Percentiles provide context, not judgement, and are most useful for spotting unusually high or unusually low resource usage patterns.')}
      <section class="section"><div class="section-head"><h2>How resource usage compares across Mjolnir</h2><span class="subtle">Context, not judgement - anonymized population view</span></div><p class="subtle">Percentiles help put your resource usage in context against peer behavior without showing real peer identities.</p></section>
      <div class="trend-grid">
        ${percentileBar('CPU efficiency percentiles', asObject(percentiles.cpu), pct, 'info')}
        ${percentileBar('Memory efficiency percentiles', asObject(percentiles.memory), pct, 'good')}
        ${percentileBar('Cost percentiles', asObject(percentiles.cost), money, 'warn')}
        ${percentileBar('GPU hour percentiles', asObject(percentiles.gpu), fmt, 'info')}
      </div>
      </div>`;
}

function recommendationsPage() {
  const groups = asArray(data?.recommendationSummary);
  const rows = groups.map((group) => [
    escapeHtml(group.type),
    escapeHtml(group.title || 'Recommendation'),
    fmt(group.affectedUsers),
    group.estimatedSavings ? money(group.estimatedSavings) : 'Not exported',
    money(group.wasteContext),
  ]);
  return `
    <div class="stack">
      ${analyticsStatusBar()}
      ${infoPanel('How are recommendations generated?', 'Recommendations are generated from observed resource usage patterns. They identify opportunities to improve resource allocation and reduce unnecessary costs.')}
      <section class="section"><div class="section-head"><h2>Resource Optimization Recommendations</h2><span class="subtle">Aggregated across pseudonymous users</span></div><div class="cards-grid">${[
        statBlock('Affected users', fmt(groups.reduce((sum, group) => sum + group.affectedUsers, 0)), 'Recommendation-user relationships'),
        statBlock('Recommendation types', fmt(groups.length), 'Grouped by action category'),
        statBlock('Cost impact', money(groups.reduce((sum, group) => sum + num(group.wasteContext), 0)), 'Potential savings associated with affected users'),
      ].join('')}</div></section>
      <section class="section"><div class="section-head"><h2>Most common actions</h2><span class="subtle">Do these first</span></div>${tableFromRows(['Type', 'Action', 'Affected users', 'Estimated savings', 'Cost impact'], rows)}</section>
      </div>`;
}

function inefficientJobsTable(rows) {
  const tableRows = rows.map((job) => [
    escapeHtml(job.userLabel),
    fmt(job.inefficiencyScore, 1),
    money(job.wastedCost),
    bearerLabel(job.costBearer),
    pct(job.costBearerEfficiency),
    pct(job.cpuEfficiency),
    pct(job.memoryEfficiency),
    fmt(job.elapsedHours, 1),
  ]);
  return tableFromRows(['Pseudonym', 'Optimization score', 'Potential savings', 'Cost driver', 'Driver efficiency', 'CPU efficiency', 'Memory efficiency', 'Elapsed hours'], tableRows);
}

function inefficientJobsPage() {
  const rows = asArray(data?.inefficientJobs).slice(0, 100);
  return `
    <div class="stack">
      ${analyticsStatusBar()}
      ${infoPanel('What is an optimization opportunity?', 'These examples show jobs with the largest optimization opportunity according to the Cost-Bearer model. Appearing here does not indicate a mistake - it highlights jobs where allocated resources could be better matched to actual usage.')}
      <section class="section"><div class="section-head"><h2>High-Impact Optimization Opportunities</h2><span class="subtle">Public-safe job metrics only</span></div><p class="subtle">Rows are sorted by optimization opportunity and efficiency gaps. Job names, job identifiers, usernames, paths, and node details are not displayed.</p></section>
      <section class="table-card">${inefficientJobsTable(rows)}</section>
      </div>`;
}

function metricSummaryCards(entity) {
  return `<div class="cards-grid">${[
    statBlock('Jobs', fmt(entity.jobs), `${fmt(entity.completedJobs)} completed / ${fmt(entity.failedJobs)} failed`),
    statBlock('CPU efficiency', pct(entity.cpu), 'Average measured CPU efficiency', entity.cpu && entity.cpu >= 0.5 ? 'good' : 'warn'),
    statBlock('Memory efficiency', pct(entity.memory), 'Average measured memory efficiency', entity.memory && entity.memory >= 0.5 ? 'good' : 'warn'),
    statBlock('Cost opportunity', money(entity.savings), `${money(entity.cost)} estimated cost`, 'warn'),
    statBlock('GPU hours', fmt(entity.gpu, 1), 'Allocated GPU time'),
  ].join('')}</div>`;
}

function hierarchyRows(items, detailPrefix) {
  return asArray(items).map((item, index) => [
    fmt(index + 1),
    `<a href="#/${detailPrefix}/${escapeHtml(item.id)}"><strong>${escapeHtml(item.label)}</strong></a>`,
    fmt(item.jobs),
    pct(item.cpu),
    pct(item.memory),
    money(item.savings),
    fmt(item.gpu, 1),
  ]);
}

function projectsPage() {
  const projects = asArray(data?.projects).slice().sort((a, b) => num(b.savings) - num(a.savings));
  const coverage = asObject(data?.hierarchyCoverage);
  return `
    <div class="stack">
      <section class="section"><div class="section-head"><h2>Research Project portfolio</h2><span class="subtle">Derived from project directory extraction, not Slurm account</span></div><div class="cards-grid">${[
        statBlock('Projects', fmt(projects.length), 'Public-safe project IDs'),
        statBlock('Assigned rows', fmt(coverage.assigned_project_rows), 'Valid /maps/projects extraction', 'good'),
        statBlock('Home directory rows', fmt(coverage.home_directory_rows), 'Kept in unassigned bucket'),
      ].join('')}</div></section>
      <section class="table-card"><div class="section-head"><h2>Project ranking</h2><span class="subtle">Cost opportunity first</span></div>${tableFromRows(['Rank', 'Project', 'Jobs', 'CPU', 'Memory', 'Cost opportunity', 'GPU hours'], hierarchyRows(projects, 'project'))}</section>
      <section class="section"><div class="section-head"><h2>Portfolio trends</h2><span class="subtle">Cluster-level context until project export is available</span></div>${lineChart('Project portfolio cost opportunity', asArray(data?.clusterSummary?.dailyTrends), [chartSeries(asArray(data?.clusterSummary?.dailyTrends), 'underutilized_cost_dkk', 'Opportunity', '#ff6b7a'), chartSeries(asArray(data?.clusterSummary?.dailyTrends), 'estimated_cost_dkk', 'Estimated cost', '#3e8cff')], money, { zeroBase: true })}</section>
      </div>`;
}

function hierarchyIndexPage(kind, title, items, detailPrefix, countLabel) {
  const sorted = asArray(items).slice().sort((a, b) => num(b.savings) - num(a.savings));
  return `
    <div class="stack">
      <section class="section"><div class="section-head"><h2>${title}</h2><span class="subtle">Hierarchy rollup view</span></div><div class="cards-grid">${[
        statBlock(countLabel, fmt(sorted.length), 'Loaded from project hierarchy export'),
        statBlock('Jobs', fmt(sorted.reduce((sum, item) => sum + num(item.jobs), 0)), 'Aggregated workload'),
        statBlock('Cost opportunity', money(sorted.reduce((sum, item) => sum + num(item.savings), 0)), 'Underutilized cost'),
      ].join('')}</div></section>
      <section class="table-card"><div class="section-head"><h2>${kind} ranking</h2><span class="subtle">Cost opportunity first</span></div>${tableFromRows(['Rank', kind, 'Jobs', 'CPU', 'Memory', 'Cost opportunity', 'GPU hours'], hierarchyRows(sorted, detailPrefix))}</section>
      </div>`;
}

function pisPage() { return hierarchyIndexPage('PI', 'PIs', data?.pis, 'pi', 'PIs'); }
function groupsPage() { return hierarchyIndexPage('Group', 'Groups', data?.groups, 'group', 'Groups'); }
function sectionsPage() { return hierarchyIndexPage('Section', 'Sections', data?.sections, 'section', 'Sections'); }

function findHierarchyEntity(type, id) {
  const source = type === 'project' ? data?.projects : type === 'pi' ? data?.pis : type === 'group' ? data?.groups : data?.sections;
  return asArray(source).find((item) => item.id === id);
}

function linkList(items, prefix, idKey, labelKey) {
  const rows = asArray(items).slice(0, 8).map((item, index) => [
    fmt(index + 1),
    `<a href="#/${prefix}/${escapeHtml(item[idKey] || item.id)}">${escapeHtml(item[labelKey] || item.label || 'Item')}</a>`,
    money(item.underutilized_cost_dkk ?? item.savings),
    money(item.estimated_cost_dkk ?? item.cost),
  ]);
  return tableFromRows(['Rank', 'Name', 'Cost opportunity', 'Estimated cost'], rows);
}

function hierarchyDetailPage(type, id) {
  const entity = findHierarchyEntity(type, id);
  if (!entity) return `<section class="section"><div class="section-head"><h2>Hierarchy item not found</h2><span class="pill warn">Missing export</span></div><div class="empty-state">No ${escapeHtml(type)} record was found for ${escapeHtml(id)}.</div></section>`;
  const title = type === 'pi' ? 'PI portfolio' : `${type.charAt(0).toUpperCase()}${type.slice(1)} rollup`;
  const related = type === 'project'
    ? `<section class="section"><div class="section-head"><h2>Hierarchy</h2><span class="subtle">Registry cache enrichment</span></div><div class="cards-grid">${[
        statBlock('PI', escapeHtml(entity.hierarchy.pi_label || '-'), 'Public PI ID only'),
        statBlock('Group', escapeHtml(entity.hierarchy.group_label || '-'), 'Research group rollup'),
        statBlock('Section', escapeHtml(entity.hierarchy.section_label || '-'), 'Section rollup'),
      ].join('')}</div></section>`
    : `<section class="section"><div class="section-head"><h2>Top projects</h2><span class="subtle">Portfolio contributors</span></div>${linkList(entity.topProjects, 'project', 'project_id', 'project_label')}</section>`;
  return `
    <div class="stack">
      <section class="section"><div class="section-head"><h2>${escapeHtml(entity.label)}</h2><span class="subtle">${title}</span></div>${metricSummaryCards(entity)}</section>
      ${lineChart(`${escapeHtml(entity.label)} efficiency trend`, entity.dailyTrends, [chartSeries(entity.dailyTrends, 'avg_cpu_efficiency', 'CPU', '#3e8cff'), chartSeries(entity.dailyTrends, 'avg_memory_efficiency', 'Memory', '#53d88a')], pct, { zeroBase: true })}
      ${lineChart(`${escapeHtml(entity.label)} cost trend`, entity.dailyTrends, [chartSeries(entity.dailyTrends, 'estimated_cost_dkk', 'Estimated cost', '#3e8cff'), chartSeries(entity.dailyTrends, 'underutilized_cost_dkk', 'Opportunity', '#ff6b7a')], money, { zeroBase: true })}
      ${related}
      <section class="section"><div class="section-head"><h2>Recommendations</h2><span class="subtle">Generated from aggregate efficiency signals</span></div><div class="rec-list">${asArray(entity.recommendations).length ? entity.recommendations.map((rec) => recCard(rec.priority || rec.severity || 'Review', rec.title, rec.detail || rec.category || '', rec.savings ? money(rec.savings) : 'Impact TBD')).join('') : '<div class="empty-state">No hierarchy-level recommendations are available yet.</div>'}</div></section>
    </div>`;
}


function userPage() {
  const users = asArray(data?.users).slice(0, 25);
  const rows = users.map((user) => [escapeHtml(user.label), pct(user.cpu), pct(user.memory), money(user.savings), fmt(user.jobs), fmt(user.recommendations.length)]);
  return `
    <div class="stack">
      ${infoPanel('What is Community Comparison?', 'Compare your resource usage patterns with similar users. Individual identities remain protected. Comparisons are intended for context and learning, not ranking.')}
      <section class="section"><div class="section-head"><h2>Community Comparison</h2><span class="subtle">Pseudonymous public users</span></div><p class="subtle">This page shows how public pseudonymous users compare on resource usage and optimization opportunity. Individual Analytics pages will later reveal only the signed-in user's real username.</p></section>
      <section class="table-card">${tableFromRows(['Pseudonym', 'CPU efficiency', 'Memory efficiency', 'Savings opportunity', 'Jobs', 'Recommendations'], rows)}</section>
      </div>`;
}

function costPage() {
  const allTime = asObject(data?.clusterSummary?.allTime);
  const rows = asArray(data?.clusterSummary?.dailyTrends);
  return `
    <div class="stack">
      ${analyticsStatusBar()}
      ${infoPanel('What drives cost on Mjolnir?', 'Jobs are billed by whichever resource is larger relative to demand: reserved CPU cores or reserved memory. Memory often ends up driving cost because it is easy to over-request "just in case." The Cost-Bearer model looks at each job, decides whether CPU or memory is the dominant cost driver, and estimates the optimization opportunity only on that resource - a conservative, defensible savings number. GPU optimization opportunity is not shown below because GPU utilization is not yet measured on Mjolnir. Future versions of Analytics may also include storage usage and sustainability metrics.')}
      <section class="section"><div class="section-head"><h2>Resource Cost Insights</h2><span class="subtle">Spend, cost drivers, and optimization opportunities</span></div><div class="cards-grid">${[
        statBlock('Estimated cost', money(allTime.estimated_cost_dkk), '90-day observed cost'),
        statBlock('Potential savings', money(allTime.underutilized_cost_dkk), `${money(annualized(allTime.underutilized_cost_dkk))} annualized run-rate`, 'warn'),
        statBlock('Optimization opportunity share', pct(num(allTime.underutilized_cost_dkk) / Math.max(1, num(allTime.estimated_cost_dkk)), 1), 'Share of cost with potential savings'),
        statBlock('GPU spend', money(allTime.gpu_cost_dkk), 'Estimated GPU cost'),
        statBlock('GPU optimization opportunity', 'Unknown', 'GPU utilization not measured yet'),
        statBlock('Main cost driver', bearerLabel(allTime.cost_bearer), 'Whichever resource - CPU or memory - drives most of the cost'),
        statBlock('Driver-resource cost', money(allTime.cost_bearer_cost_dkk), 'Spend attributable to the main cost driver'),
        statBlock('Driver-resource efficiency', pct(allTime.cost_bearer_efficiency), 'How efficiently the main cost driver is used'),
        statBlock('Driver-resource potential savings', money(allTime.cost_bearer_waste_dkk ?? allTime.underutilized_cost_dkk), 'Estimated potential savings from the main cost driver (Cost-Bearer model)'),
      ].join('')}</div>${disclaimer(LOWER_BOUND_NOTE)}${disclaimer(GPU_WASTE_NOTE)}${disclaimer(AGGREGATE_NOTE)}</section>
      <section class="section"><div class="section-head"><h2>Measurement coverage</h2><span class="subtle">Measured vs unmeasured jobs by main cost driver</span></div>${coverageCards(data?.clusterSummary?.measurementCoverage)}</section>
      ${lineChart('Daily cost opportunity', rows, [chartSeries(rows, 'estimated_cost_dkk', 'Estimated cost', '#3e8cff'), chartSeries(rows, 'underutilized_cost_dkk', 'Savings opportunity', '#ff6b7a')], money, { zeroBase: true })}
      <section class="section"><div class="section-head"><h2>Cost actions</h2><span class="subtle">Impact-ranked</span></div><div class="rec-list">${recommendationCards(5).join('')}</div></section>
      </div>`;
}

function recoveryPage() {
  const status = state.recoveryStatus;
  const statusClass = status?.ok ? 'success' : 'info';
  const statusMessage = status
    ? `<div class="form-status ${statusClass}">${escapeHtml(status.message)}</div>`
    : '<div class="subtle">Enter your Mjolnir username. The future recovery service will look up the Airtable identity record and email your Analytics link.</div>';
  return `
    <div class="stack">
      <section class="section"><div class="section-head"><h2>View My Analytics</h2><span class="subtle">Self-service recovery workflow</span></div><p class="subtle" style="line-height:1.8">Public rankings use pseudonyms only. This form is the planned recovery entry point for users who want their Analytics link without exposing usernames in the public dataset.</p><form class="recovery-form" data-recovery-form><label for="recovery-username">Mjolnir username</label><div class="recovery-row"><input id="recovery-username" class="search" name="username" autocomplete="username" placeholder="Enter your Mjolnir username" /><button class="btn btn-primary" type="submit">Request email</button></div>${statusMessage}</form></section>
      <section class="section"><div class="section-head"><h2>What happens next?</h2><span class="subtle">No public identity leak</span></div><div class="cards-grid">${[
        statBlock('1. Lookup', 'Airtable', 'Server-side lookup by username'),
        statBlock('2. Email', 'Private', 'URL is sent only to the registered email'),
        statBlock('3. Analytics', '/u/token', 'Personal route uses a high-entropy token'),
      ].join('')}</div></section>
      </div>`;
}

function prototypeBanner() {
  return '<div class="prototype-banner"><strong>Prototype Personal Dashboard - Authentication Not Yet Enabled</strong><span>Decision support view. Peer comparisons remain pseudonymous.</span></div>';
}

function percentileBand(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return { label: 'Band unavailable', detail: 'Not enough comparison data is exported yet.', tone: 'info' };
  if (n >= 0.8) return { label: 'Top band', detail: '80th-100th percentile among exported users.', tone: 'good' };
  if (n >= 0.6) return { label: 'Upper band', detail: '60th-80th percentile among exported users.', tone: 'info' };
  if (n >= 0.4) return { label: 'Middle band', detail: '40th-60th percentile among exported users.', tone: 'info' };
  if (n >= 0.2) return { label: 'Watch band', detail: '20th-40th percentile among exported users.', tone: 'warn' };
  return { label: 'Action band', detail: 'Bottom 20th percentile among exported users.', tone: 'warn' };
}

function actionPriority(rec, index) {
  const priority = String(rec.priority || '').toLowerCase();
  if (priority === 'high') return `Priority ${index + 1}`;
  if (priority === 'medium') return `Next ${index + 1}`;
  return `Review ${index + 1}`;
}

function priorityActions(recommendations) {
  const rows = asArray(recommendations)
    .slice()
    .sort((a, b) => num(b.savings) - num(a.savings));
  if (!rows.length) return '<div class="empty-state">No priority actions are available for this bundle yet.</div>';
  return `<div class="priority-grid">${rows.slice(0, 4).map((rec, index) => `
    <article class="priority-card">
      <div class="priority-top"><span class="pill ${rec.priority === 'high' ? 'warn' : 'info'}">${actionPriority(rec, index)}</span><strong>${rec.savings ? money(rec.savings) : 'Savings TBD'}</strong></div>
      <h3>${escapeHtml(rec.title)}</h3>
      <p>${escapeHtml(rec.detail || rec.category || 'Right-size future submissions based on this pattern.')}</p>
      <div class="metric-explain"><strong>Why this matters</strong><span>${escapeHtml(rec.category || 'Optimization')} changes reduce unused allocation before your next similar run.</span></div>
    </article>`).join('')}</div>`;
}

function savingsBreakdown(recommendations, metrics) {
  const groups = new Map();
  asArray(recommendations).forEach((rec) => {
    const category = rec.category || 'Other';
    groups.set(category, (groups.get(category) || 0) + num(rec.savings));
  });
  const total = Math.max(num(metrics.potentialSavings), [...groups.values()].reduce((sum, value) => sum + value, 0));
  const rows = [...groups.entries()].sort((a, b) => b[1] - a[1]);
  if (!rows.length && !total) return '<div class="empty-state">No savings breakdown is available yet.</div>';
  const residual = Math.max(0, total - rows.reduce((sum, [, value]) => sum + value, 0));
  const allRows = residual > 0 ? rows.concat([['Unassigned opportunity', residual]]) : rows;
  return `<div class="savings-summary"><div class="savings-total"><span>Total practical opportunity</span><strong>${money(total)}</strong><em>Estimated from your personal bundle and recommendations.</em></div><div class="breakdown-list">${allRows.map(([label, value]) => {
    const share = total ? Math.max(4, (value / total) * 100) : 0;
    return `<div class="breakdown-row"><div><strong>${escapeHtml(label)}</strong><span>${money(value)} available</span></div><div class="breakdown-track"><i style="width:${share.toFixed(1)}%"></i></div></div>`;
  }).join('')}</div></div>`;
}

function personalContextCards(metrics, percentile) {
  const cpuBand = percentileBand(percentile.cpu);
  const memoryBand = percentileBand(percentile.memory);
  const savingsBand = percentileBand(percentile.savings);
  return `<div class="cards-grid">${[
    statBlock('CPU efficiency', pct(metrics.cpuEfficiency), `Decision signal: ${cpuBand.label}. ${cpuBand.detail}`, cpuBand.tone),
    statBlock('Memory efficiency', pct(metrics.memoryEfficiency), `Decision signal: ${memoryBand.label}. ${memoryBand.detail}`, memoryBand.tone),
    statBlock('Savings opportunity', money(metrics.potentialSavings), `Prioritize actions with the largest repeatable savings. ${savingsBand.label}.`, 'warn'),
    statBlock('Estimated spend', money(metrics.estimatedCost), 'Context only: use this to size the opportunity, not as a score.'),
    statBlock('Main cost driver', bearerLabel(metrics.costBearer), 'Whichever resource - CPU or memory - drives most of your cost.'),
    statBlock('Driver-resource potential savings', money(metrics.costBearerWaste ?? metrics.potentialSavings), 'Estimated potential savings from your main cost driver (Cost-Bearer model).'),
    statBlock('Job volume', fmt(metrics.jobs), 'Confidence signal: more jobs make the recommendations more reliable.'),
    statBlock('Failure count', fmt(metrics.failedJobs), 'Reliability signal: failed jobs can hide or distort efficiency patterns.'),
  ].join('')}</div>${disclaimer(LOWER_BOUND_NOTE)}${disclaimer(AGGREGATE_NOTE)}`;
}

function personalJobsTable(rows) {
  const tableRows = asArray(rows).map((job) => [
    escapeHtml(job.label),
    money(job.wastedCost),
    bearerLabel(job.costBearer),
    pct(job.cpuEfficiency),
    pct(job.memoryEfficiency),
    escapeHtml(job.recommendation || 'Review resource request'),
  ]);
  return tableFromRows(['Job label', 'Savings opportunity', 'Cost driver', 'CPU use', 'Memory use', 'Decision'], tableRows);
}

function peerComparisonTable(rows) {
  const tableRows = asArray(rows).map((peer) => {
    const band = percentileBand(peer.percentile);
    return [
      escapeHtml(peer.pseudonym),
      band.label,
      pct(peer.cpu),
      pct(peer.memory),
      money(peer.savings),
    ];
  });
  return tableFromRows(['Pseudonymous peer', 'Comparison band', 'CPU efficiency', 'Memory efficiency', 'Savings opportunity'], tableRows);
}

function personalDashboardPage() {
  if (state.personalLoading) {
    return `${prototypeBanner()}<section class="section"><div class="section-head"><h2>Loading My Analytics</h2><span class="subtle">${escapeHtml(state.personalToken || '')}</span></div><div class="empty-state">Loading private mock bundle for this route token.</div></section>`;
  }
  if (state.personalError) {
    return `${prototypeBanner()}<section class="section"><div class="section-head"><h2>My Analytics unavailable</h2><span class="pill warn">Mock data missing</span></div><p class="subtle" style="line-height:1.8">No mock private bundle was found for this route token. The public Analytics data has not been changed.</p><div class="empty-state">${escapeHtml(state.personalError)}</div></section>`;
  }

  const vm = state.personalViewModel;
  if (!vm) {
    return `${prototypeBanner()}<section class="section"><div class="section-head"><h2>My Analytics</h2><span class="subtle">Private data required</span></div><div class="empty-state">Open a route such as <strong>#/u/mock-token-alex</strong> to load the prototype Analytics view.</div></section>`;
  }

  const metrics = asObject(vm.metrics);
  const percentile = asObject(vm.percentile);
  const trends = asArray(vm.trends);
  const comparisonBand = percentileBand(percentile.overall);
  const topAction = asArray(vm.recommendations).slice().sort((a, b) => num(b.savings) - num(a.savings))[0];
  return `
    ${prototypeBanner()}
    <section class="decision-hero section">
      <div>
        <div class="context-label">Personal Decision Support</div>
        <h1>Do this next: ${escapeHtml(topAction?.title || 'review your resource requests')}</h1>
        <p class="subtle">For <strong>${escapeHtml(vm.username)}</strong>, public pseudonym <strong>${escapeHtml(vm.displayPseudonym)}</strong>. This view favors action and savings over raw monitoring.</p>
      </div>
      <div class="decision-summary">
        <span class="subtle">How you compare</span>
        <strong>${comparisonBand.label}</strong>
        <em>${comparisonBand.detail}</em>
      </div>
    </section>
    <div class="stack">
      <section class="section"><div class="section-head"><h2>Priority Actions</h2><span class="subtle">What should I do?</span></div>${priorityActions(vm.recommendations)}</section>
      <section class="section"><div class="section-head"><h2>Savings Opportunity Breakdown</h2><span class="subtle">How much can I save?</span></div>${savingsBreakdown(vm.recommendations, metrics)}</section>
      <section class="section"><div class="section-head"><h2>How do I compare?</h2><span class="subtle">Percentile bands, not rank numbers</span></div>${personalContextCards(metrics, percentile)}<div class="metric-explain wide"><strong>How to read these bands</strong><span>Percentile bands summarize position among exported users without exposing exact ranks. Higher savings opportunity means more room to improve, not a badge of failure.</span></div></section>
      <section class="section"><div class="section-head"><h2>Trend evidence</h2><span class="subtle">Why these actions are being recommended</span></div><div class="trend-grid">
        ${lineChart('Efficiency trend evidence', trends, [chartSeries(trends, 'avg_cpu_efficiency', 'CPU efficiency', '#3e8cff'), chartSeries(trends, 'avg_memory_efficiency', 'Memory efficiency', '#53d88a')], pct, { zeroBase: true })}
        ${lineChart('Cost opportunity trend', trends, [chartSeries(trends, 'estimated_cost_dkk', 'Estimated cost', '#3e8cff'), chartSeries(trends, 'underutilized_cost_dkk', 'Savings opportunity', '#ff6b7a')], money, { zeroBase: true })}
      </div></section>
      <section class="section"><div class="section-head"><h2>Keep perspective: anonymous peers</h2><span class="subtle">Peer comparison stays pseudonymous</span></div>${peerComparisonTable(vm.peerComparisons)}</section>
      <section class="section"><div class="section-head"><h2>Highest-Impact Jobs to Review</h2><span class="subtle">Which jobs offer the most room to improve?</span></div><p class="subtle" style="line-height:1.7">These jobs are shown because they combine cost with low CPU or memory use. Reviewing them can help you adjust similar submissions in the future.</p>${personalJobsTable(vm.topInefficientJobs)}</section>
    </div>`;
}

function methodologyPage() {
  const meta = asObject(data?.datasetMeta);
  const rows = asObject(meta.rowCounts);
  return `
    <div class="stack">
      <section class="section"><div class="section-head"><h2>Data provenance</h2><span class="subtle">Raw jobs to Analytics widgets</span></div><div class="cards-grid">${[
        statBlock('Source database', '90-day validation', meta.sourceDatabase || 'Unavailable'),
        statBlock('Validation window', meta.validationWindow || 'Unavailable', 'Daily cluster summary range'),
        statBlock('Export date', formatLocalDateTime(meta.exportDate, '-'), 'JSON generation timestamp'),
        statBlock('Users', fmt(meta.userCount), 'Pseudonymous user bundles'),
        statBlock('Projects', meta.accountExportAvailable ? fmt(meta.projectCount) : 'Not exported', 'Public-safe project data status'),
        statBlock('Recommendations', fmt(meta.recommendationCount), 'Generated from user summaries'),
      ].join('')}</div></section>
      <section class="section"><div class="section-head"><h2>Import row counts</h2><span class="subtle">Validated source tables</span></div>${tableFromRows(['Table', 'Rows', 'Analytics use'], [
        ['raw jobs', fmt(rows.jobs), 'Input for metrics calculation'],
        ['job_metrics', fmt(rows.job_metrics), 'Efficiency and cost metrics'],
        ['daily_user_summary', fmt(rows.daily_user_summary), 'User bundles, percentiles, recommendations'],
        ['daily_account_summary', fmt(rows.daily_account_summary), 'Future anonymized project summaries'],
        ['daily_cluster_summary', fmt(rows.daily_cluster_summary), 'Cluster trend charts and health KPIs'],
      ])}</section>
      <section class="section"><div class="section-head"><h2>Lineage</h2><span class="subtle">Transformation path</span></div><div class="lineage"><span>raw jobs</span><b>metrics</b><b>daily summaries</b><b>JSON export</b><b>data-loader.js</b><strong>Analytics widgets</strong></div><p class="subtle" style="line-height:1.8">Pages consume normalized objects from the data loader. Public views show pseudonyms only and omit usernames, job names, node details, and filesystem paths.</p></section>
      <section class="section"><div class="section-head"><h2>Roadmap</h2><span class="subtle">Where Analytics is headed</span></div><div class="panel-grid">
        <div><h3 style="margin:0 0 8px;font-size:0.95rem">Current metrics</h3><ul style="margin:0;padding-left:18px;line-height:1.8;color:var(--text)"><li>CPU</li><li>Memory</li><li>GPU allocation</li><li>Cost-Bearer analysis</li></ul></div>
        <div><h3 style="margin:0 0 8px;font-size:0.95rem">Planned metrics</h3><ul style="margin:0;padding-left:18px;line-height:1.8;color:var(--text)"><li>Storage usage</li><li>Storage growth</li><li>Energy consumption</li><li>Sustainability indicators</li></ul></div>
      </div></section>
      </div>`;
}

function dot(tone) {
  return `<span style="display:inline-block;width:10px;height:10px;border-radius:999px;background:var(--${tone})"></span>`;
}

function renderShell(content) {
  const sourceText = data?.source === 'real-export' ? 'REAL MJOLNIR DATA' : 'Sample fallback active';
  return `
    <div class="app-shell" data-theme="${state.theme}">
      <aside class="sidebar ${state.menuOpen ? 'open' : ''}">
        <div class="brand"><div class="brand-mark">${icon('cluster')}</div><div><div class="brand-name">Mjolnir</div><div class="brand-sub">Analytics</div></div></div>
        <nav class="nav-group">${navGroups.map((group) => `
          <div class="nav-section">
            <div class="nav-heading">${group.heading}</div>
            ${group.items.map((item) => navLink(item)).join('')}
          </div>`).join('')}</nav>
        <div class="context-card">${platformStatusBadge(platformRegistry)}<div class="context-label" style="margin-top:12px">Viewing context</div><div class="context-item"><span>Environment</span><strong>Production review</strong></div><div class="context-item"><span>Mode</span><strong>${sourceText}</strong></div><div class="context-item"><span>Schema</span><strong>${data?.schemaVersion || 'unknown'}</strong></div><div class="context-item"><span>Users</span><strong>${fmt(data?.datasetMeta?.userCount || 0)}</strong></div></div>
      </aside>
      <div class="sidebar-backdrop ${state.menuOpen ? 'open' : ''}" data-action="close-menu"></div>
      <main class="main">
        <div class="sticky-header">
          <div class="mobile-topbar"><div class="brand"><div class="brand-mark">${icon('cluster')}</div><div><div class="brand-name">Mjolnir</div><div class="brand-sub">Analytics</div></div></div><button class="toolbar-button" data-action="menu" aria-label="Open navigation">${icon('menu')}</button></div>
          <div class="topbar"><div class="topbar-left"><div class="crumb">${icon('menu')} <span>${pageTitle(state.route)}</span></div></div><div class="topbar-right"><a class="btn" href="#/recovery">Who am I?</a><button class="toolbar-button" data-action="theme" aria-label="Toggle theme">${state.theme === 'dark' ? icon('sun') : icon('moon')}</button></div></div>
        </div>
        ${data?.source === 'real-export' ? '<div class="load-banner real"><strong>REAL MJOLNIR DATA</strong><span>90-day validation dataset</span></div>' : ''}
        <div class="page">${content}</div>
      </main>
    </div>`;
}

function render() {
  document.documentElement.dataset.theme = state.theme;
  platformRegistry = buildPlatformRegistry({ data, nodeInsights, nodeInsightsHistory });
  const renderers = {
    landing: landingPage,
    cluster: clusterPage,
    'cluster-health': clusterHealthPage,
    rankings: rankingsPage,
    benchmarks: benchmarkPage,
    recommendations: recommendationsPage,
    'inefficient-jobs': inefficientJobsPage,
    infrastructure: infrastructureOverviewPage,
    nodes: nodeInventoryPage,
    hardware: hardwareInventoryPage,
    capacity: capacityPlanningPage,
    projects: projectsPage,
    pis: pisPage,
    groups: groupsPage,
    sections: sectionsPage,
    users: userPage,
    cost: costPage,
    recovery: recoveryPage,
    methodology: methodologyPage,
    'platform-status': platformStatusPage,
  };
  const content = isPersonalRoute(state.route)
    ? personalDashboardPage()
    : isNodeDetailRoute(state.route)
      ? nodeDetailPage(nodeDetailRouteName(state.route))
      : isHierarchyDetailRoute(state.route)
        ? hierarchyDetailPage(detailRouteParts(state.route).type, detailRouteParts(state.route).id)
        : (renderers[state.route] || renderers.landing)();
  app.innerHTML = renderShell(content);
  wireEvents();
  mountCharts();
  setupChartResize();
}

let stickyHeaderScrollAttached = false;
const STICKY_HEADER_COMPACT_THRESHOLD = 24;

function applyStickyHeaderCompactState() {
  const header = document.querySelector('.sticky-header');
  if (header) header.classList.toggle('is-compact', window.scrollY > STICKY_HEADER_COMPACT_THRESHOLD);
}

function setupStickyHeaderScroll() {
  if (stickyHeaderScrollAttached) return;
  stickyHeaderScrollAttached = true;
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      applyStickyHeaderCompactState();
      ticking = false;
    });
  }, { passive: true });
}

function wireEvents() {
  setupStickyHeaderScroll();
  applyStickyHeaderCompactState();
  document.querySelector('[data-action="theme"]')?.addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('med-theme', state.theme);
    render();
  });
  document.querySelector('[data-action="menu"]')?.addEventListener('click', () => {
    state.menuOpen = !state.menuOpen;
    render();
  });
  document.querySelector('[data-action="close-menu"]')?.addEventListener('click', () => {
    state.menuOpen = false;
    render();
  });
  document.querySelectorAll('[data-action="filter-nodes"]').forEach((el) => {
    el.addEventListener('change', (event) => {
      const filterKey = event.currentTarget.dataset.filter;
      state.nodeFilters[filterKey] = event.currentTarget.value;
      render();
    });
  });
  document.querySelectorAll('[data-action="sort-nodes"]').forEach((el) => {
    el.addEventListener('click', (event) => {
      const key = event.currentTarget.dataset.key;
      if (state.nodeFilters.sortKey === key) {
        state.nodeFilters.sortDir = state.nodeFilters.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.nodeFilters.sortKey = key;
        state.nodeFilters.sortDir = 'asc';
      }
      render();
    });
  });
  document.querySelectorAll('[data-action="set-history-range"]').forEach((el) => {
    el.addEventListener('click', (event) => {
      state.historyRange = event.currentTarget.dataset.range;
      render();
    });
  });
  document.querySelector('[data-recovery-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const username = new FormData(form).get('username');
    state.recoveryStatus = { ok: false, message: 'Submitting recovery request...' };
    render();
    try {
      state.recoveryStatus = await requestDashboardRecovery(username);
    } catch (error) {
      state.recoveryStatus = { ok: false, message: 'The recovery service is unavailable. No email was sent.' };
    }
    render();
  });
}

let personalRequestId = 0;

async function loadPersonalRoute(route) {
  const token = personalRouteToken(route);
  personalRequestId += 1;
  const requestId = personalRequestId;

  if (!token) {
    state.personalToken = null;
    state.personalViewModel = null;
    state.personalLoading = false;
    state.personalError = null;
    return;
  }

  state.personalToken = token;
  state.personalViewModel = null;
  state.personalLoading = true;
  state.personalError = null;
  render();

  try {
    const result = await loadPersonalData(token);
    if (requestId !== personalRequestId) return;
    state.personalViewModel = result.personalUser;
    state.personalError = result.personalUser ? null : 'Personal bundle did not return a PersonalUserViewModel.';
  } catch (error) {
    if (requestId !== personalRequestId) return;
    state.personalError = error && error.message ? error.message : String(error);
  } finally {
    if (requestId === personalRequestId) {
      state.personalLoading = false;
      render();
    }
  }
}

function handleRoute() {
  state.route = location.hash.replace('#/', '') || 'landing';
  state.menuOpen = false;
  if (isPersonalRoute(state.route)) {
    loadPersonalRoute(state.route);
  } else {
    loadPersonalRoute(null);
    render();
  }
}

window.addEventListener('hashchange', handleRoute);

async function init() {
  [data, nodeInsights, nodeInsightsHistory] = await Promise.all([
    loadMjolnirData(),
    loadNodeInsightsData(),
    loadNodeInsightsHistory(),
  ]);
  render();
  if (isPersonalRoute(state.route)) await loadPersonalRoute(state.route);
}

init();
