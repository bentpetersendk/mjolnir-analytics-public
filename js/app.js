import { loadMjolnirData, loadPersonalData } from './data-loader.js';
import { requestDashboardRecovery } from './recovery-service.js';

const app = document.querySelector('#app');
const navItems = [
  { id: 'landing', label: 'Overview', icon: 'home' },
  { id: 'cluster', label: 'Trends', icon: 'chart' },
  { id: 'cluster-health', label: 'Cluster Health', icon: 'cluster' },
  { id: 'rankings', label: 'Rankings', icon: 'trophy' },
  { id: 'benchmarks', label: 'Percentiles', icon: 'gauge' },
  { id: 'recommendations', label: 'Recommendations', icon: 'spark' },
  { id: 'inefficient-jobs', label: 'Inefficient Jobs', icon: 'alert' },
  { id: 'projects', label: 'Projects', icon: 'folder' },
  { id: 'pis', label: 'PIs', icon: 'users' },
  { id: 'groups', label: 'Groups', icon: 'cluster' },
  { id: 'sections', label: 'Sections', icon: 'book' },
  { id: 'users', label: 'Peer Compare', icon: 'users' },
  { id: 'cost', label: 'Cost', icon: 'wallet' },
  { id: 'recovery', label: 'Reveal My Dashboard', icon: 'key' },
  { id: 'methodology', label: 'Methodology', icon: 'book' },
];

const state = {
  theme: localStorage.getItem('med-theme') || 'dark',
  route: location.hash.replace('#/', '') || 'landing',
  recoveryStatus: null,
  personalToken: null,
  personalViewModel: null,
  personalLoading: false,
  personalError: null,
};

let data = null;

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
  };
  return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${icons[name] || icons.home}</svg>`;
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
const GPU_WASTE_NOTE = 'GPU utilization is not currently measured. GPU waste is therefore unknown and is not included in waste calculations.';
const LOWER_BOUND_NOTE = 'Waste estimates are based on measured CPU and memory utilization only and should be considered a lower-bound estimate.';
const AGGREGATE_NOTE = 'Aggregate waste is calculated as the sum of job-level cost-bearer waste and may not equal aggregate cost multiplied by aggregate efficiency.';
function disclaimer(text) { return `<div class="disclaimer" role="note"><span class="pill warn">Note</span><span>${escapeHtml(text)}</span></div>`; }
// Measured / unmeasured bearer split for the lower-bound disclosure.
function coverageCards(coverage) {
  const c = coverage || {};
  const cards = [
    statBlock('CPU-bearer jobs measured', fmt(c.cpu_bearer_jobs_measured), 'Bearer efficiency observed'),
    statBlock('CPU-bearer jobs unmeasured', fmt(c.cpu_bearer_jobs_unmeasured), c.cpu_bearer_jobs_unmeasured_pct != null ? `${c.cpu_bearer_jobs_unmeasured_pct}% of CPU-bearer jobs` : 'No measurement available', 'warn'),
    statBlock('Memory-bearer jobs measured', fmt(c.memory_bearer_jobs_measured), 'Bearer efficiency observed'),
    statBlock('Memory-bearer jobs unmeasured', fmt(c.memory_bearer_jobs_unmeasured), c.memory_bearer_jobs_unmeasured_pct != null ? `${c.memory_bearer_jobs_unmeasured_pct}% of memory-bearer jobs` : 'No measurement available', 'warn'),
  ];
  return `<div class="cards-grid">${cards.join('')}</div>`;
}
function escapeHtml(value) { return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }
function isPersonalRoute(route) { return /^u\/[A-Za-z0-9_-]+$/.test(route || ''); }
function personalRouteToken(route) { return isPersonalRoute(route) ? route.split('/')[1] : null; }
function isHierarchyDetailRoute(route) { return /^(project|pi|group|section)\/[A-Za-z0-9_-]+$/.test(route || ''); }
function detailRouteParts(route) { const parts = String(route || '').split('/'); return { type: parts[0], id: parts[1] }; }
function pageTitle(route) {
  if (isPersonalRoute(route)) return 'Personal Dashboard';
  if (isHierarchyDetailRoute(route)) {
    const part = detailRouteParts(route).type;
    return part === 'pi' ? 'PI Detail' : `${part.charAt(0).toUpperCase()}${part.slice(1)} Detail`;
  }
  return navItems.find((item) => item.id === route)?.label || 'Overview';
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

function localNav(active) {
  return `<aside class="local-nav">${navItems.map((item) => `<a class="${item.label === active ? 'active' : ''}" href="#/${item.id}">${item.label}</a>`).join('')}</aside>`;
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
  return `
    <section class="hero">
      <div class="hero-copy">
        <div class="eyebrow">${dot('green')} REAL MJOLNIR DATA - 90-day validation dataset</div>
        <h1>Find wasted compute before it becomes waiting time.</h1>
        <p>This dashboard turns 90 days of Mjolnir efficiency data into trends, rankings, recommendations, and cost actions while keeping users pseudonymous in public views.</p>
        <div class="hero-actions"><a class="btn btn-primary" href="#/cluster-health">Open health dashboard</a><a class="btn" href="#/rankings">View rankings</a><a class="btn" href="#/recovery">Reveal My Dashboard</a></div>
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
        <section class="section"><div class="section-head"><h2>Where money is being wasted</h2><span class="subtle">Top public-safe job examples</span></div>${inefficientJobsTable(asArray(data?.inefficientJobs).slice(0, 8))}</section>
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

function clusterPage() {
  const rows = asArray(data?.clusterSummary?.dailyTrends);
  return `
    <div class="page-layout">
      ${localNav('Trends')}
      <div class="stack">
        <section class="section"><div class="section-head"><h2>Efficiency and cost trends</h2><span class="subtle">Daily values with rolling averages</span></div><p class="subtle">Use these charts to spot whether Mjolnir is becoming more efficient or drifting toward larger resource gaps.</p></section>
        <div class="trend-grid">
          ${lineChart('CPU efficiency', rows, [chartSeries(rows, 'avg_cpu_efficiency', 'Daily', '#3e8cff'), rollingSeries(rows, 'avg_cpu_efficiency', 7, '7-day', '#30d5d0'), rollingSeries(rows, 'avg_cpu_efficiency', 30, '30-day', '#ffb84d')], pct, { zeroBase: true })}
          ${lineChart('Memory efficiency', rows, [chartSeries(rows, 'avg_memory_efficiency', 'Daily', '#53d88a'), rollingSeries(rows, 'avg_memory_efficiency', 7, '7-day', '#30d5d0'), rollingSeries(rows, 'avg_memory_efficiency', 30, '30-day', '#ffb84d')], pct, { zeroBase: true })}
          ${lineChart('Daily cost and waste', rows, [chartSeries(rows, 'estimated_cost_dkk', 'Estimated cost', '#3e8cff'), chartSeries(rows, 'underutilized_cost_dkk', 'Underutilized cost', '#ff6b7a')], money, { zeroBase: true })}
          ${lineChart('GPU hours', rows, [chartSeries(rows, 'gpu_hours', 'GPU hours', '#9cd0ff'), rollingSeries(rows, 'gpu_hours', 7, '7-day', '#30d5d0'), rollingSeries(rows, 'gpu_hours', 30, '30-day', '#ffb84d')], fmt, { zeroBase: true })}
        </div>
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
    <div class="page-layout">
      ${localNav('Cluster Health')}
      <div class="stack">
        <section class="section"><div class="section-head"><h2>Cluster Health Dashboard</h2><span class="subtle">All metrics from the 90-day validation export</span></div><div class="cards-grid">${[
          statBlock('Total jobs', fmt(allTime.jobs), 'Measured job metrics rows'),
          statBlock('Completed jobs', fmt(allTime.completed_jobs), 'Successful workload volume', 'good'),
          statBlock('Failed jobs', fmt(allTime.failed_jobs), `${pct(failureRate, 1)} failure rate`, failureRate > 0.1 ? 'warn' : 'good'),
          statBlock('Average CPU efficiency', pct(allTime.avg_cpu_efficiency), cpuTrend.text, cpuTrend.tone),
          statBlock('Average memory efficiency', pct(allTime.avg_memory_efficiency), memoryTrend.text, memoryTrend.tone),
          statBlock('Estimated cost', money(allTime.estimated_cost_dkk), '90-day estimated spend'),
          statBlock('Potential savings', money(allTime.underutilized_cost_dkk), savingsTrend.text, savingsTrend.tone),
          statBlock('GPU hours', fmt(allTime.gpu_hours, 1), 'Measured GPU allocation time'),
          statBlock('GPU spend', money(allTime.gpu_cost_dkk), 'Estimated GPU cost'),
          statBlock('GPU waste', 'Unknown', 'GPU utilization not measured'),
          statBlock('Cost bearer', bearerLabel(allTime.cost_bearer), 'Dominant cost resource (CPU vs memory)'),
          statBlock('Cost bearer cost', money(allTime.cost_bearer_cost_dkk), 'Cost attributable to the bearer resource'),
          statBlock('Cost bearer efficiency', pct(allTime.cost_bearer_efficiency), 'Measured efficiency of the bearer resource'),
          statBlock('Cost bearer waste', money(allTime.cost_bearer_waste_dkk ?? allTime.underutilized_cost_dkk), 'Revised Cost-Bearer waste (charged to the bearer resource)'),
        ].join('')}</div>${disclaimer(LOWER_BOUND_NOTE)}${disclaimer(GPU_WASTE_NOTE)}${disclaimer(AGGREGATE_NOTE)}</section>
        <section class="section"><div class="section-head"><h2>Measurement coverage</h2><span class="subtle">How much of the cluster has measured utilization</span></div>${coverageCards(data?.clusterSummary?.measurementCoverage)}</section>
        <section class="section"><div class="section-head"><h2>Immediate operational reading</h2><span class="subtle">Actionable interpretation</span></div><div class="insight-grid">${[
          insight('CPU requests', `Average CPU efficiency is ${pct(allTime.avg_cpu_efficiency)}. Focus first on users with high savings opportunity and low measured CPU use.`),
          insight('Memory requests', `Average memory efficiency is ${pct(allTime.avg_memory_efficiency)}. Many jobs likely request much more memory than they use.`),
          insight('Cost control', `${money(allTime.underutilized_cost_dkk)} of 90-day cost is marked as underutilized. Treat this as the main optimization queue.`),
        ].join('')}</div></section>
      </div>
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
    <div class="page-layout">
      ${localNav('Rankings')}
      <div class="stack">
        <section class="section"><div class="section-head"><h2>Pseudonymous efficiency leaderboards</h2><span class="subtle">No usernames, emails, job names, or paths</span></div><p class="subtle">Rankings are designed to show efficient behavior and savings opportunity without exposing real user identity.</p></section>
        ${rankingTable('Best CPU efficiency', asArray(rankings.bestCpu), 'CPU efficiency', pct, 'cpu')}
        ${rankingTable('Best memory efficiency', asArray(rankings.bestMemory), 'Memory efficiency', pct, 'memory')}
        ${rankingTable('Most improved CPU efficiency', asArray(rankings.mostImproved), 'Improvement', (value) => pct(value, 1), 'cpuImprovement')}
        ${rankingTable('Largest savings opportunity', asArray(rankings.largestSavings), 'Potential savings', money, 'savings')}
      </div>
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
    <div class="page-layout">
      ${localNav('Percentiles')}
      <div class="stack">
        <section class="section"><div class="section-head"><h2>Percentile visualizations</h2><span class="subtle">Cluster population context</span></div><p class="subtle">Percentiles help users understand whether their jobs are above or below peer behavior without showing real peer identities.</p></section>
        <div class="trend-grid">
          ${percentileBar('CPU efficiency percentiles', asObject(percentiles.cpu), pct, 'info')}
          ${percentileBar('Memory efficiency percentiles', asObject(percentiles.memory), pct, 'good')}
          ${percentileBar('Cost percentiles', asObject(percentiles.cost), money, 'warn')}
          ${percentileBar('GPU hour percentiles', asObject(percentiles.gpu), fmt, 'info')}
        </div>
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
    <div class="page-layout">
      ${localNav('Recommendations')}
      <div class="stack">
        <section class="section"><div class="section-head"><h2>Recommendation Dashboard</h2><span class="subtle">Aggregated across pseudonymous users</span></div><div class="cards-grid">${[
          statBlock('Affected users', fmt(groups.reduce((sum, group) => sum + group.affectedUsers, 0)), 'Recommendation-user relationships'),
          statBlock('Recommendation types', fmt(groups.length), 'Grouped by action category'),
          statBlock('Waste context', money(groups.reduce((sum, group) => sum + num(group.wasteContext), 0)), 'Potential savings associated with affected users'),
        ].join('')}</div></section>
        <section class="section"><div class="section-head"><h2>Most common actions</h2><span class="subtle">Do these first</span></div>${tableFromRows(['Type', 'Action', 'Affected users', 'Estimated savings', 'Waste context'], rows)}</section>
      </div>
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
  return tableFromRows(['Pseudonym', 'Inefficiency score', 'Wasted cost', 'Cost bearer', 'Bearer efficiency', 'CPU efficiency', 'Memory efficiency', 'Elapsed hours'], tableRows);
}

function inefficientJobsPage() {
  const rows = asArray(data?.inefficientJobs).slice(0, 100);
  return `
    <div class="page-layout">
      ${localNav('Inefficient Jobs')}
      <div class="stack">
        <section class="section"><div class="section-head"><h2>Top inefficient job examples</h2><span class="subtle">Public-safe job metrics only</span></div><p class="subtle">Rows are sorted by wasted cost and efficiency gaps. Job names, job identifiers, usernames, paths, and node details are not displayed.</p></section>
        <section class="table-card">${inefficientJobsTable(rows)}</section>
      </div>
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
    <div class="page-layout">
      ${localNav('Projects')}
      <div class="stack">
        <section class="section"><div class="section-head"><h2>Research Project portfolio</h2><span class="subtle">Derived from project directory extraction, not Slurm account</span></div><div class="cards-grid">${[
          statBlock('Projects', fmt(projects.length), 'Public-safe project IDs'),
          statBlock('Assigned rows', fmt(coverage.assigned_project_rows), 'Valid /maps/projects extraction', 'good'),
          statBlock('Home directory rows', fmt(coverage.home_directory_rows), 'Kept in unassigned bucket'),
        ].join('')}</div></section>
        <section class="table-card"><div class="section-head"><h2>Project ranking</h2><span class="subtle">Cost opportunity first</span></div>${tableFromRows(['Rank', 'Project', 'Jobs', 'CPU', 'Memory', 'Cost opportunity', 'GPU hours'], hierarchyRows(projects, 'project'))}</section>
        <section class="section"><div class="section-head"><h2>Portfolio trends</h2><span class="subtle">Cluster-level context until project export is available</span></div>${lineChart('Project portfolio cost opportunity', asArray(data?.clusterSummary?.dailyTrends), [chartSeries(asArray(data?.clusterSummary?.dailyTrends), 'underutilized_cost_dkk', 'Opportunity', '#ff6b7a'), chartSeries(asArray(data?.clusterSummary?.dailyTrends), 'estimated_cost_dkk', 'Estimated cost', '#3e8cff')], money, { zeroBase: true })}</section>
      </div>
    </div>`;
}

function hierarchyIndexPage(kind, title, items, detailPrefix, countLabel) {
  const sorted = asArray(items).slice().sort((a, b) => num(b.savings) - num(a.savings));
  return `
    <div class="page-layout">
      ${localNav(title)}
      <div class="stack">
        <section class="section"><div class="section-head"><h2>${title}</h2><span class="subtle">Hierarchy rollup view</span></div><div class="cards-grid">${[
          statBlock(countLabel, fmt(sorted.length), 'Loaded from project hierarchy export'),
          statBlock('Jobs', fmt(sorted.reduce((sum, item) => sum + num(item.jobs), 0)), 'Aggregated workload'),
          statBlock('Cost opportunity', money(sorted.reduce((sum, item) => sum + num(item.savings), 0)), 'Underutilized cost'),
        ].join('')}</div></section>
        <section class="table-card"><div class="section-head"><h2>${kind} ranking</h2><span class="subtle">Cost opportunity first</span></div>${tableFromRows(['Rank', kind, 'Jobs', 'CPU', 'Memory', 'Cost opportunity', 'GPU hours'], hierarchyRows(sorted, detailPrefix))}</section>
      </div>
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
    <div class="page-layout">
      ${localNav('Peer Compare')}
      <div class="stack">
        <section class="section"><div class="section-head"><h2>Peer comparison</h2><span class="subtle">Pseudonymous public users</span></div><p class="subtle">This page shows how public pseudonymous users compare on efficiency and savings opportunity. Personal dashboards will later reveal only the signed-in user's real username.</p></section>
        <section class="table-card">${tableFromRows(['Pseudonym', 'CPU efficiency', 'Memory efficiency', 'Savings opportunity', 'Jobs', 'Recommendations'], rows)}</section>
      </div>
    </div>`;
}

function costPage() {
  const allTime = asObject(data?.clusterSummary?.allTime);
  const rows = asArray(data?.clusterSummary?.dailyTrends);
  return `
    <div class="page-layout">
      ${localNav('Cost')}
      <div class="stack">
        <section class="section"><div class="section-head"><h2>Cost Dashboard</h2><span class="subtle">Spend, savings, and waste</span></div><div class="cards-grid">${[
          statBlock('Estimated cost', money(allTime.estimated_cost_dkk), '90-day observed cost'),
          statBlock('Potential savings', money(allTime.underutilized_cost_dkk), `${money(annualized(allTime.underutilized_cost_dkk))} annualized run-rate`, 'warn'),
          statBlock('Waste share', pct(num(allTime.underutilized_cost_dkk) / Math.max(1, num(allTime.estimated_cost_dkk)), 1), 'Underutilized / estimated cost'),
          statBlock('GPU spend', money(allTime.gpu_cost_dkk), 'Estimated GPU cost'),
          statBlock('GPU waste', 'Unknown', 'GPU utilization not measured'),
          statBlock('Cost bearer', bearerLabel(allTime.cost_bearer), 'Dominant cost resource (CPU vs memory)'),
          statBlock('Cost bearer cost', money(allTime.cost_bearer_cost_dkk), 'Cost attributable to the bearer resource'),
          statBlock('Cost bearer efficiency', pct(allTime.cost_bearer_efficiency), 'Measured efficiency of the bearer resource'),
          statBlock('Cost bearer waste', money(allTime.cost_bearer_waste_dkk ?? allTime.underutilized_cost_dkk), 'Revised Cost-Bearer waste'),
        ].join('')}</div>${disclaimer(LOWER_BOUND_NOTE)}${disclaimer(GPU_WASTE_NOTE)}${disclaimer(AGGREGATE_NOTE)}</section>
        <section class="section"><div class="section-head"><h2>Measurement coverage</h2><span class="subtle">Measured vs unmeasured jobs by cost bearer</span></div>${coverageCards(data?.clusterSummary?.measurementCoverage)}</section>
        ${lineChart('Daily cost opportunity', rows, [chartSeries(rows, 'estimated_cost_dkk', 'Estimated cost', '#3e8cff'), chartSeries(rows, 'underutilized_cost_dkk', 'Savings opportunity', '#ff6b7a')], money, { zeroBase: true })}
        <section class="section"><div class="section-head"><h2>Cost actions</h2><span class="subtle">Impact-ranked</span></div><div class="rec-list">${recommendationCards(5).join('')}</div></section>
      </div>
    </div>`;
}

function recoveryPage() {
  const status = state.recoveryStatus;
  const statusClass = status?.ok ? 'success' : 'info';
  const statusMessage = status
    ? `<div class="form-status ${statusClass}">${escapeHtml(status.message)}</div>`
    : '<div class="subtle">Enter your Mjolnir username. The future recovery service will look up the Airtable identity record and email the personal dashboard URL.</div>';
  return `
    <div class="page-layout">
      ${localNav('Reveal My Dashboard')}
      <div class="stack">
        <section class="section"><div class="section-head"><h2>Reveal My Dashboard</h2><span class="subtle">Self-service recovery workflow</span></div><p class="subtle" style="line-height:1.8">Public rankings use pseudonyms only. This form is the planned recovery entry point for users who want their personal dashboard link without exposing usernames in the public dataset.</p><form class="recovery-form" data-recovery-form><label for="recovery-username">Mjolnir username</label><div class="recovery-row"><input id="recovery-username" class="search" name="username" autocomplete="username" placeholder="Enter your Mjolnir username" /><button class="btn btn-primary" type="submit">Request email</button></div>${statusMessage}</form></section>
        <section class="section"><div class="section-head"><h2>What happens next?</h2><span class="subtle">No public identity leak</span></div><div class="cards-grid">${[
          statBlock('1. Lookup', 'Airtable', 'Server-side lookup by username'),
          statBlock('2. Email', 'Private', 'URL is sent only to the registered email'),
          statBlock('3. Dashboard', '/u/token', 'Personal route uses a high-entropy token'),
        ].join('')}</div></section>
      </div>
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
      <div class="metric-explain"><strong>Why this matters</strong><span>${escapeHtml(rec.category || 'Optimization')} changes reduce wasted allocation before your next similar run.</span></div>
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
    statBlock('Cost bearer', bearerLabel(metrics.costBearer), 'Resource that drives most of your cost (CPU vs memory).'),
    statBlock('Cost bearer waste', money(metrics.costBearerWaste ?? metrics.potentialSavings), 'Revised Cost-Bearer waste charged to your bearer resource.'),
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
  return tableFromRows(['Job label', 'Savings opportunity', 'Cost bearer', 'CPU use', 'Memory use', 'Decision'], tableRows);
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
    return `${prototypeBanner()}<section class="section"><div class="section-head"><h2>Loading personal dashboard</h2><span class="subtle">${escapeHtml(state.personalToken || '')}</span></div><div class="empty-state">Loading private mock bundle for this route token.</div></section>`;
  }
  if (state.personalError) {
    return `${prototypeBanner()}<section class="section"><div class="section-head"><h2>Personal dashboard unavailable</h2><span class="pill warn">Mock data missing</span></div><p class="subtle" style="line-height:1.8">No mock private bundle was found for this route token. Public dashboard data has not been changed.</p><div class="empty-state">${escapeHtml(state.personalError)}</div></section>`;
  }

  const vm = state.personalViewModel;
  if (!vm) {
    return `${prototypeBanner()}<section class="section"><div class="section-head"><h2>Personal dashboard route</h2><span class="subtle">Private data required</span></div><div class="empty-state">Open a route such as <strong>#/u/mock-token-alex</strong> to load the prototype personal dashboard.</div></section>`;
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
      <section class="section"><div class="section-head"><h2>Worst Jobs</h2><span class="subtle">What are my worst jobs?</span></div><p class="subtle" style="line-height:1.7">These jobs are shown because they combine cost with low CPU or memory use. Treat them as templates to fix before submitting similar work again.</p>${personalJobsTable(vm.topInefficientJobs)}</section>
    </div>`;
}

function methodologyPage() {
  const meta = asObject(data?.datasetMeta);
  const rows = asObject(meta.rowCounts);
  return `
    <div class="page-layout">
      ${localNav('Methodology')}
      <div class="stack">
        <section class="section"><div class="section-head"><h2>Data provenance</h2><span class="subtle">Raw jobs to dashboard widgets</span></div><div class="cards-grid">${[
          statBlock('Source database', '90-day validation', meta.sourceDatabase || 'Unavailable'),
          statBlock('Validation window', meta.validationWindow || 'Unavailable', 'Daily cluster summary range'),
          statBlock('Export date', meta.exportDate ? new Date(meta.exportDate).toLocaleString() : '-', 'JSON generation timestamp'),
          statBlock('Users', fmt(meta.userCount), 'Pseudonymous user bundles'),
          statBlock('Projects', meta.accountExportAvailable ? fmt(meta.projectCount) : 'Not exported', 'Public-safe project data status'),
          statBlock('Recommendations', fmt(meta.recommendationCount), 'Generated from user summaries'),
        ].join('')}</div></section>
        <section class="section"><div class="section-head"><h2>Import row counts</h2><span class="subtle">Validated source tables</span></div>${tableFromRows(['Table', 'Rows', 'Dashboard use'], [
          ['raw jobs', fmt(rows.jobs), 'Input for metrics calculation'],
          ['job_metrics', fmt(rows.job_metrics), 'Efficiency and cost metrics'],
          ['daily_user_summary', fmt(rows.daily_user_summary), 'User bundles, percentiles, recommendations'],
          ['daily_account_summary', fmt(rows.daily_account_summary), 'Future anonymized project summaries'],
          ['daily_cluster_summary', fmt(rows.daily_cluster_summary), 'Cluster trend charts and health KPIs'],
        ])}</section>
        <section class="section"><div class="section-head"><h2>Lineage</h2><span class="subtle">Transformation path</span></div><div class="lineage"><span>raw jobs</span><b>metrics</b><b>daily summaries</b><b>JSON export</b><b>data-loader.js</b><strong>dashboard widgets</strong></div><p class="subtle" style="line-height:1.8">Pages consume normalized objects from the data loader. Public views show pseudonyms only and omit usernames, job names, node details, and filesystem paths.</p></section>
      </div>
    </div>`;
}

function dot(tone) {
  return `<span style="display:inline-block;width:10px;height:10px;border-radius:999px;background:var(--${tone})"></span>`;
}

function renderShell(content) {
  const sourceText = data?.source === 'real-export' ? 'REAL MJOLNIR DATA' : 'Sample fallback active';
  return `
    <div class="app-shell" data-theme="${state.theme}">
      <aside class="sidebar">
        <div class="brand"><div class="brand-mark">${icon('cluster')}</div><div><div class="brand-name">Mjolnir</div><div class="brand-sub">Efficiency Dashboard</div></div></div>
        <nav class="nav-group">${navItems.map((item) => navLink(item)).join('')}</nav>
        <div class="context-card"><div class="context-label">Viewing context</div><div class="context-item"><span>Environment</span><strong>Production review</strong></div><div class="context-item"><span>Mode</span><strong>${sourceText}</strong></div><div class="context-item"><span>Schema</span><strong>${data?.schemaVersion || 'unknown'}</strong></div><div class="context-item"><span>Users</span><strong>${fmt(data?.datasetMeta?.userCount || 0)}</strong></div></div>
      </aside>
      <main class="main">
        <div class="mobile-topbar"><div class="brand"><div class="brand-mark">${icon('cluster')}</div><div><div class="brand-name">Mjolnir</div><div class="brand-sub">Efficiency Dashboard</div></div></div><button class="toolbar-button" data-action="menu" aria-label="Open navigation">${icon('menu')}</button></div>
        <div class="topbar"><div class="topbar-left"><div class="crumb">${icon('menu')} <span>${pageTitle(state.route)}</span></div></div><div class="topbar-right"><a class="btn" href="#/recovery">Who am I?</a><button class="toolbar-button" data-action="theme" aria-label="Toggle theme">${state.theme === 'dark' ? icon('sun') : icon('moon')}</button></div></div>
        ${data?.source === 'real-export' ? '<div class="load-banner real"><strong>REAL MJOLNIR DATA</strong><span>90-day validation dataset</span></div>' : ''}
        <div class="page">${content}</div>
      </main>
    </div>`;
}

function render() {
  document.documentElement.dataset.theme = state.theme;
  const renderers = {
    landing: landingPage,
    cluster: clusterPage,
    'cluster-health': clusterHealthPage,
    rankings: rankingsPage,
    benchmarks: benchmarkPage,
    recommendations: recommendationsPage,
    'inefficient-jobs': inefficientJobsPage,
    projects: projectsPage,
    pis: pisPage,
    groups: groupsPage,
    sections: sectionsPage,
    users: userPage,
    cost: costPage,
    recovery: recoveryPage,
    methodology: methodologyPage,
  };
  const content = isPersonalRoute(state.route)
    ? personalDashboardPage()
    : isHierarchyDetailRoute(state.route)
      ? hierarchyDetailPage(detailRouteParts(state.route).type, detailRouteParts(state.route).id)
      : (renderers[state.route] || renderers.landing)();
  app.innerHTML = renderShell(content);
  wireEvents();
}

function wireEvents() {
  document.querySelector('[data-action="theme"]')?.addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('med-theme', state.theme);
    render();
  });
  document.querySelector('[data-action="menu"]')?.addEventListener('click', () => {
    document.querySelector('.sidebar')?.classList.toggle('hidden');
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
  if (isPersonalRoute(state.route)) {
    loadPersonalRoute(state.route);
  } else {
    loadPersonalRoute(null);
    render();
  }
}

window.addEventListener('hashchange', handleRoute);

async function init() {
  data = await loadMjolnirData();
  render();
  if (isPersonalRoute(state.route)) await loadPersonalRoute(state.route);
}

init();
