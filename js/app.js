import { loadMjolnirData, loadPersonalData, loadUserBundle, loadNodeInsightsData, loadNodeInsightsHistory, loadSlurmAnalyticsPipelineStatus, loadQueueInsightsData, loadSoftwareInventoryData, loadSoftwareIntelligenceData, loadSoftwareIntelligenceModuleDetail } from './data-loader.js';
import { requestAnalyticsRecovery } from './recovery-service.js';
import { startAutoRefresh, setLastUpdatedFromBundle, lastUpdatedLabel, getLastUpdatedAt, isToastVisible } from './refresh-manager.js';
import {
  formatLocalDateTime, formatLocalTimestamp, snapshotAgeLabel, snapshotAgeMs,
  buildPlatformRegistry, findModule, statusBar, platformStatusPanel, platformStatusBadge,
  buildWarehouseSummary, collectorHealth, statusPillHtml, platformHealth,
} from './status.js';
import {
  resetChartRegistry, registerChart, mountCharts, setupChartResize,
  createLineChart, createGauge, createDistribution, createFunnel, createBarChart,
  capacityHistoryChartOption, drainingHistoryChartOption, nodeHistoryChartOption,
  annotateTimeline,
} from './charts.js';
import { OPERATIONAL_EVENTS } from './events.js';
import { num, fmt, pct, money, escapeHtml, statBlock, tableFromRows } from './ui-helpers.js';
import { createRangeSelector, rangeButtonsHtml, filterByRange } from './timeRange.js';
import {
  executiveReportPage, weeklyReportPage, piReportPage as piReportPageImpl,
  userReportPage as userReportPageImpl, queueReportPage, capacityReportPage,
  getCurrentReportModel, getCurrentReportMarkdown,
} from './reporting/pages.js';
import { downloadReportPdf, downloadReportMarkdown } from './reporting/print.js';

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
    heading: 'Queue Insights',
    items: [
      { id: 'queue-overview', label: 'Queue Overview', icon: 'gauge' },
      { id: 'queue-live', label: 'Live Queue', icon: 'bell' },
      { id: 'queue-wait-times', label: 'Wait Time Analysis', icon: 'chart' },
      { id: 'queue-advisor', label: 'Submission Advisor', icon: 'spark' },
      { id: 'queue-trends', label: 'Historical Trends', icon: 'cluster' },
    ],
  },
  {
    heading: 'Software',
    items: [
      { id: 'software-inventory', label: 'Software Inventory', icon: 'box' },
    ],
  },
  {
    heading: 'Software Intelligence',
    items: [
      { id: 'si-overview', label: 'Overview', icon: 'home' },
      { id: 'si-most-used', label: 'Most Used Software', icon: 'trophy' },
      { id: 'si-trending', label: 'Trending', icon: 'spark' },
      { id: 'si-versions', label: 'Version Adoption', icon: 'chart' },
      { id: 'si-relationships', label: 'Relationships', icon: 'cluster' },
      { id: 'si-timeline', label: 'Timeline', icon: 'chart' },
    ],
  },
  {
    heading: 'Infrastructure',
    items: [
      { id: 'infrastructure', label: 'Infrastructure', icon: 'server' },
      { id: 'nodes', label: 'Nodes', icon: 'cluster' },
      { id: 'hardware', label: 'Hardware', icon: 'cpu' },
      { id: 'capacity', label: 'Capacity', icon: 'gauge' },
      { id: 'warehouse', label: 'Warehouse', icon: 'server' },
      { id: 'platform-status', label: 'Platform Status', icon: 'gauge' },
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
    heading: 'Users',
    items: [
      { id: 'users', label: 'All Users', icon: 'users' },
      { id: 'user-rankings', label: 'Rankings', icon: 'trophy' },
      { id: 'user-compare', label: 'Compare Users', icon: 'users' },
    ],
  },
  {
    heading: 'Personal',
    items: [
      { id: 'recovery', label: 'View My Analytics', icon: 'key' },
    ],
  },
  {
    heading: 'Reports',
    items: [
      { id: 'reports-executive', label: 'Executive Report', icon: 'spark' },
      { id: 'reports-weekly', label: 'Weekly Operational Report', icon: 'chart' },
      { id: 'reports-queue', label: 'Queue Report', icon: 'gauge' },
      { id: 'reports-capacity', label: 'Capacity Report', icon: 'cluster' },
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
  { id: 'si-module', label: 'Module Detail', icon: 'box' },
  { id: 'user', label: 'User Profile', icon: 'users' },
  { id: 'compare', label: 'User Comparison', icon: 'users' },
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
  userProfileRange: '90d',
  // Phase 7: off by default so charts stay subtle/uncluttered until a user
  // opts in.
  profileChartOverlays: { clusterAvg: false, benchmark: false },
  // Software Inventory (Software Analytics Milestone 1 frontend, see
  // docs/architecture/SOFTWARE_INVENTORY_FRONTEND.md). All filtering/
  // sorting/pagination happens client-side over the already-loaded
  // softwareInventory.modules array - this is just the current view state,
  // never re-fetched on a keystroke.
  // quickFilter replaces the old separate statusFilter dropdown (Software
  // Explorer Milestone 4, Parts 1-2) - 'installed'/'removed' are now two
  // more entries in the same QUICK_FILTERS vocabulary instead of a second,
  // parallel filtering axis, per the brief's "reuse the existing
  // client-side filtering framework rather than introducing a second
  // filtering implementation."
  softwareInventoryFilters: { search: '', quickFilter: 'all', sortKey: 'moduleName', sortDir: 'asc', page: 1 },
  // Software Intelligence (docs/architecture/SOFTWARE_INTELLIGENCE_ARCHITECTURE.md
  // in the private repo). Same client-side-only filter/sort/paginate state
  // shape as softwareInventoryFilters above, namespaced for this module's
  // Most Used Software table.
  softwareIntelligenceFilters: { search: '', sortKey: 'jobs', sortDir: 'desc', page: 1 },
  softwareIntelligenceTrendingWindow: 'all-time',
  softwareIntelligenceRelationshipsModule: null,
  softwareIntelligenceTimelineModule: 'all',
  softwareIntelligenceTimelineGranularity: 'daily',
  usersExplorer: {
    search: '',
    sort: { key: 'cpu_hours', dir: 'desc' },
    page: 1,
    filters: { activity: 'all', resource: 'all', efficiency: 'all', jobs: 'all' },
  },
  comparison: { selected: [] },
};

let data = null;
let nodeInsights = null;
let nodeInsightsHistory = null;
let slurmAnalyticsPipeline = null;
let queueInsights = null;
let softwareInventory = null;
let softwareIntelligence = null;
let platformRegistry = [];
let warehouseSummary = {};

// Lazy per-module Software Intelligence detail fetches (module/<name>.json) -
// deliberately outside `state` (not part of view-state serialization
// concerns) and outside the init() Promise.all bundle, so opening a module
// detail page or filtering Timeline/Relationships to one module is the only
// thing that ever fetches that module's file. Map<moduleName, detailOrNull>;
// a pending fetch is tracked in the Set so a second render() while it's in
// flight doesn't trigger a duplicate request.
const softwareIntelligenceModuleCache = new Map();
const softwareIntelligenceModuleLoading = new Set();

// User Profile lazy-load cache: Map<public_user_id, bundle|null>.
// A pending fetch is tracked in the Set so navigating to a profile twice in
// quick succession never fires two fetches for the same user.
const userProfileCache = new Map();
const userProfileLoading = new Set();

function requestUserBundle(publicUserId) {
  if (!publicUserId || userProfileCache.has(publicUserId) || userProfileLoading.has(publicUserId)) return;
  const base = data?.sourcePath;
  if (!base) return;
  userProfileLoading.add(publicUserId);
  loadUserBundle(base, publicUserId).then((bundle) => {
    userProfileLoading.delete(publicUserId);
    userProfileCache.set(publicUserId, bundle);
    if (state.route === `user/${encodeURIComponent(publicUserId)}`) render();
  });
}

function requestSoftwareIntelligenceModuleDetail(moduleName) {
  if (!moduleName || softwareIntelligenceModuleCache.has(moduleName) || softwareIntelligenceModuleLoading.has(moduleName)) return;
  softwareIntelligenceModuleLoading.add(moduleName);
  loadSoftwareIntelligenceModuleDetail(moduleName).then((detail) => {
    softwareIntelligenceModuleLoading.delete(moduleName);
    softwareIntelligenceModuleCache.set(moduleName, detail);
    if (state.route === `si-module/${encodeURIComponent(moduleName)}`
      || (isSoftwareIntelligenceTimelineRoute(state.route) && state.softwareIntelligenceTimelineModule === moduleName)) {
      render();
    }
  });
}

// Data Freshness / Platform Status framework (docs/PLATFORM_STATUS.md):
// page renderers call analyticsStatusBar()/infraStatusBar() rather than
// touching status.js directly, so every page stays on the same registry.
function analyticsStatusBar() { return statusBar(findModule(platformRegistry, 'analytics-warehouse')); }
function infraStatusBar() { return statusBar(findModule(platformRegistry, 'node-insights')); }
function softwareInventoryStatusBar() { return statusBar(findModule(platformRegistry, 'software-inventory')); }
function softwareIntelligenceStatusBar() { return statusBar(findModule(platformRegistry, 'software-intelligence')); }

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
    box: '<path d="M12 3 4 7.5v9L12 21l8-4.5v-9z" fill="none"/><path d="M4 7.5 12 12l8-4.5M12 12v9" fill="none"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.home}</svg>`;
}

function asArray(value) { return Array.isArray(value) ? value : []; }
function asObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function annualized(value) { return num(value) * (365 / 90); }
function bytesLabel(value) {
  if (value === null || value === undefined) return '-';
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = n;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}
// Single reusable human-friendly number formatter for the whole app.
// Below 1,000,000 there is no abbreviation - fmt() already renders "523" and
// "6,016" exactly as an HPC dashboard should (no "6 thousand"-style wording).
// At 1,000,000 and above, scales to million/billion/trillion: style:'long'
// -> "55.1 million" (prose); style:'short' -> "55.1M" (compact KPI tiles).
// One decimal place by default; if that would round to a deceptively exact
// "X.0" (hiding that the real value isn't a round number), a second decimal
// is used instead - so 1,018,000 reads "1.02M", not the misleading "1.0M",
// while 55,108,521 still reads the cleaner "55.1M".
const NUMBER_TIERS = [
  { value: 1e12, long: 'trillion', short: 'T' },
  { value: 1e9, long: 'billion', short: 'B' },
  { value: 1e6, long: 'million', short: 'M' },
];
function tierScaledLabel(scaledAbs) {
  const oneDecimal = scaledAbs.toFixed(1);
  if (!oneDecimal.endsWith('.0')) return oneDecimal;
  return scaledAbs.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}
function humanNumber(value, { style = 'long' } = {}) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  const n = Number(value);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const tier = NUMBER_TIERS.find((t) => abs >= t.value);
  if (!tier) return `${sign}${fmt(abs)}`;
  const scaled = tierScaledLabel(abs / tier.value);
  const suffix = style === 'short' ? tier.short : ` ${tier.long}`;
  return `${sign}${scaled}${suffix}`;
}
function dateLabel(value) {
  if (!value) return '-';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
function coverageLabel(warehouse) {
  if (!warehouse?.earliestDate) return 'Coverage unavailable';
  const end = warehouse.latestDate ? dateLabel(warehouse.latestDate) : 'Present';
  return `${dateLabel(warehouse.earliestDate)} - ${end}`;
}
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
// Version 1.3 (Reporting & Executive Briefings): the User Report is just a
// different VIEW of the exact same per-token personal bundle Personal
// Analytics already fetches - same privacy-sensitive capability-link model
// (docs/architecture/ANALYTICS_WAREHOUSE.md's identity model), so it reuses
// loadPersonalRoute()/state.personalViewModel rather than a second fetch.
// Extending isPersonalRoute()'s own regex (instead of a parallel check)
// means handleRoute()'s existing "isPersonalRoute -> loadPersonalRoute()"
// trigger fires for the report route automatically, no further wiring.
function isPersonalRoute(route) { return /^u\/[A-Za-z0-9_-]+(\/report)?$/.test(route || ''); }
function isUserReportRoute(route) { return /^u\/[A-Za-z0-9_-]+\/report$/.test(route || ''); }
function personalRouteToken(route) { return isPersonalRoute(route) ? route.split('/')[1] : null; }
function isHierarchyDetailRoute(route) { return /^(project|pi|group|section)\/[A-Za-z0-9_-]+$/.test(route || ''); }
function detailRouteParts(route) { const parts = String(route || '').split('/'); return { type: parts[0], id: parts[1] }; }
function isPiReportRoute(route) { return /^reports\/pi\/[A-Za-z0-9_-]+$/.test(route || ''); }
function piReportRouteId(route) { return String(route || '').split('/')[2] || null; }
function isNodeDetailRoute(route) { return /^node\/[A-Za-z0-9_.-]+$/.test(route || ''); }
function nodeDetailRouteName(route) { return isNodeDetailRoute(route) ? route.split('/')[1] : null; }
// Software module detail route: #/module/<encoded modulefile_path>. A plain
// `/^module\/[id]+$/` split-on-slash pattern (as nodeDetailRouteName above
// uses) does not work here - modulefile_path is itself a filesystem path
// full of slashes (e.g. /opt/software/modules/ABC/1.0.0), and it is the
// only field that uniquely identifies one module_catalog row (the same
// module_name/module_version pair can be installed under more than one
// MODULEPATH root - see SOFTWARE_INVENTORY_ARCHITECTURE.md). So the whole
// remainder of the route after "module/" is captured as one
// encodeURIComponent()-escaped segment instead.
function isSoftwareModuleDetailRoute(route) { return /^module\/.+$/.test(route || ''); }
function softwareModuleDetailKey(route) {
  return isSoftwareModuleDetailRoute(route) ? decodeURIComponent(route.slice('module/'.length)) : null;
}
// Software Intelligence module detail: #/si-module/<encoded module_name>.
// Module names don't contain "/", but decoded/encoded the same defensive
// way as softwareModuleDetailKey() above rather than a plain split-on-slash.
function isSoftwareIntelligenceModuleDetailRoute(route) { return /^si-module\/.+$/.test(route || ''); }
function softwareIntelligenceModuleDetailKey(route) {
  return isSoftwareIntelligenceModuleDetailRoute(route) ? decodeURIComponent(route.slice('si-module/'.length)) : null;
}
// Relationships deep-link: #/si-relationships (default selection) or
// #/si-relationships/<encoded module_name> (pre-selected). This app's
// router has no query-string parsing anywhere - every parametrized route is
// a plain hash segment (module/<path>, u/<token>) - so an optional segment
// after si-relationships follows that same convention rather than
// introducing ?module= parsing for the first time.
function isSoftwareIntelligenceRelationshipsRoute(route) { return /^si-relationships(\/.+)?$/.test(route || ''); }

function isUserProfileRoute(route) { return /^user\/.+$/.test(route || ''); }
function userProfileRouteId(route) { return isUserProfileRoute(route) ? decodeURIComponent(route.slice('user/'.length)) : null; }
function isUserComparisonRoute(route) { return /^compare\/.+\/.+/.test(route || ''); }
function userComparisonRouteIds(route) { return isUserComparisonRoute(route) ? route.slice('compare/'.length).split('/').map(decodeURIComponent).filter(Boolean) : []; }
function softwareIntelligenceRelationshipsModuleKey(route) {
  if (!isSoftwareIntelligenceRelationshipsRoute(route)) return null;
  const rest = route.slice('si-relationships'.length);
  return rest.startsWith('/') ? decodeURIComponent(rest.slice(1)) : null;
}
function isSoftwareIntelligenceTimelineRoute(route) { return route === 'si-timeline'; }
function pageTitle(route) {
  if (isUserReportRoute(route)) return 'My Analytics Report';
  if (isPersonalRoute(route)) return 'My Analytics';
  if (isPiReportRoute(route)) return 'PI Report';
  if (isHierarchyDetailRoute(route)) {
    const part = detailRouteParts(route).type;
    return part === 'pi' ? 'PI Detail' : `${part.charAt(0).toUpperCase()}${part.slice(1)} Detail`;
  }
  if (isNodeDetailRoute(route)) return 'Node Detail';
  if (isSoftwareModuleDetailRoute(route)) return 'Module Detail';
  if (isSoftwareIntelligenceModuleDetailRoute(route)) return 'Software Intelligence: Module Detail';
  if (isSoftwareIntelligenceRelationshipsRoute(route)) return 'Relationships';
  if (isUserProfileRoute(route)) {
    const id = userProfileRouteId(route);
    const pseudonym = data?.usersSummary?.byId?.[id]?.displayPseudonym;
    return pseudonym ? pseudonym : 'User Profile';
  }
  if (isUserComparisonRoute(route)) {
    const ids = userComparisonRouteIds(route);
    const pseudonyms = ids.map((id) => data?.usersSummary?.byId?.[id]?.displayPseudonym).filter(Boolean);
    return pseudonyms.length >= 2 ? `${pseudonyms[0]} vs ${pseudonyms[1]}` : 'User Comparison';
  }
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

function meanOf(rows, key) {
  const values = asArray(rows).map((row) => Number(row && row[key])).filter(Number.isFinite);
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
}

// Efficiency bands - kept in one place so the chart legend and the LEAF
// glow tiers (leafGlowClass) always agree on what "good" means.
const EFFICIENCY_BANDS = [
  { from: 0, to: 0.40, color: '#ff6b7a' },
  { from: 0.40, to: 0.70, color: '#e0a94d' },
  { from: 0.70, to: 1, color: '#53d88a' },
];

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

// Thin compatibility shim: every call site below still calls lineChart()
// with the same signature it always has, now rendering through the shared
// ECharts framework (js/charts.js) instead of hand-rolled inline SVG.
function lineChart(title, rows, series, formatter = fmt, options = {}) {
  return createLineChart(title, rows, series, formatter, options);
}


// Shared "(i)" tooltip affordance - a native title tooltip, no new
// dependency. Used anywhere a label needs a short explanatory hint (LEAF
// Index, Savings Opportunity, warehouse tiles, etc).
function infoTip(hint) {
  if (!hint) return '';
  return `<span class="info-tooltip" tabindex="0" role="img" aria-label="${escapeHtml(hint)}" title="${escapeHtml(hint)}">${icon('info')}</span>`;
}

// Live "Warehouse Summary" KPI tile - used on both the Overview hero and the
// dedicated Warehouse page so the two never show different numbers for the
// same metric. `hint` renders as a native title tooltip (no new dependency).
function warehouseTile(label, value, sub, hint) {
  return `<article class="warehouse-tile">
    <div class="warehouse-tile-label">${escapeHtml(label)}${infoTip(hint)}</div>
    <div class="warehouse-tile-value">${value}</div>
    <div class="warehouse-tile-sub">${sub || ''}</div>
  </article>`;
}

// Shared by the Overview page's "Warehouse Summary" grid and the dedicated
// Warehouse page - source data is buildWarehouseSummary() in status.js,
// itself a thin read of status.json's `warehouse` block
// (export_dashboard_data.py). No number here is computed in the browser.
function warehouseSummaryTiles(w) {
  return `<div class="warehouse-grid">${[
    warehouseTile('Coverage', coverageLabel(w), 'Earliest to latest accounting record'),
    warehouseTile('Accounting Records', humanNumber(w.accountingRecords), 'Raw Slurm accounting rows'),
    warehouseTile('Job Steps', humanNumber(w.jobSteps), 'Step records within accounting rows'),
    warehouseTile('Unique Jobs', humanNumber(w.canonicalJobs), 'One canonical record per completed job', 'Slurm generates multiple accounting records for many jobs (job steps, updates while running, retries, etc.). Mjolnir Analytics consolidates these into one canonical record per completed job for analysis.'),
    warehouseTile('Reduction Ratio', `${humanNumber(w.accountingRecords, { style: 'short' })} → ${humanNumber(w.canonicalJobs, { style: 'short' })}`, w.reductionRatio !== null ? `${pct(w.reductionRatio, 1)} retained` : 'Retained share unavailable', 'How many raw accounting records collapse into one canonical job, and what share of records survive as unique jobs.'),
    warehouseTile('Unique Users', humanNumber(w.users), 'Distinct submitters, all time'),
    warehouseTile('Projects', humanNumber(w.projects), 'Tracked in the project registry'),
    warehouseTile('Accounts', humanNumber(w.accounts), 'Distinct Slurm accounts'),
    warehouseTile('Partitions', humanNumber(w.partitions), 'Distinct Slurm partitions'),
    warehouseTile('Compute Nodes', humanNumber(w.computeNodes), 'Live from Node Insights'),
    warehouseTile('Last Accounting Import', snapshotAgeLabel(w.lastImportAt), 'ago', formatLocalDateTime(w.lastImportAt)),
    warehouseTile('Last Analytics Build', snapshotAgeLabel(w.lastMaterializationAt), 'ago', formatLocalDateTime(w.lastMaterializationAt)),
    warehouseTile('Node Snapshot', snapshotAgeLabel(w.nodeSnapshotAt), 'ago', formatLocalDateTime(w.nodeSnapshotAt)),
  ].join('')}</div>`;
}

// Canonical-selection explainer - one of the platform's actual technical
// strengths, so it gets a real diagram, not a one-line caption. Plain
// <details> keeps this dependency-free and accessible (native disclosure).
function canonicalSelectionExplainer() {
  return `<details class="disclosure">
    <summary>Why are there fewer unique jobs than accounting records?</summary>
    <div class="flow-diagram flow-diagram-compact">
      <div class="flow-step"><strong>Accounting records</strong><span>Job steps, retries, updates</span></div>
      <div class="flow-arrow">&darr;</div>
      <div class="flow-step"><strong>Canonical selection</strong><span>Latest terminal state per JobID</span></div>
      <div class="flow-arrow">&darr;</div>
      <div class="flow-step flow-step-result"><strong>One unique job</strong><span>Deduplicated, analysis-ready</span></div>
    </div>
  </details>`;
}

// "How does Mjolnir Analytics work?" pipeline diagram - the full path from
// raw Slurm accounting to the analytics modules built on top of it.
function analyticsPipelineDiagram() {
  return `<details class="disclosure" open>
    <summary>How does Mjolnir Analytics work?</summary>
    <div class="pipeline-diagram">
      <div class="pipeline-stage"><span class="pipeline-node">Slurm Accounting</span></div>
      <div class="pipeline-arrow">&darr;</div>
      <div class="pipeline-stage"><span class="pipeline-node">Accounting Records</span></div>
      <div class="pipeline-arrow">&darr;</div>
      <div class="pipeline-stage"><span class="pipeline-node">Canonical Selection</span></div>
      <div class="pipeline-arrow">&darr;</div>
      <div class="pipeline-stage"><span class="pipeline-node pipeline-node-highlight">Analytics Warehouse</span></div>
      <div class="pipeline-arrow">&darr;</div>
      <div class="pipeline-stage"><span class="pipeline-node">Daily Summaries</span></div>
      <div class="pipeline-arrow">&darr;</div>
      <div class="pipeline-stage pipeline-stage-branch">
        <span class="pipeline-node">User Analytics</span>
        <span class="pipeline-node">Queue Analytics</span>
        <span class="pipeline-node">Project Analytics</span>
        <span class="pipeline-node">PI Analytics</span>
        <span class="pipeline-node">Cost Analytics</span>
      </div>
      <div class="pipeline-arrow">&darr;</div>
      <div class="pipeline-stage"><span class="pipeline-node pipeline-node-highlight">Mjolnir Analytics</span></div>
    </div>
    <p class="subtle" style="margin-top:12px">Node Insights runs alongside this pipeline as a separate, live collector (sinfo/scontrol/squeue), feeding compute-node counts and fleet health directly into the same dashboards.</p>
  </details>`;
}

// Richer "Analytics Warehouse" card - disk footprint, engine, schema version,
// and freshness in one glance, in place of a bare "Warehouse Size" number.
function warehouseOverviewCard(w) {
  return `<article class="stat-card warehouse-overview-card">
    <div class="label">Analytics Warehouse</div>
    <div class="value">${bytesLabel(w.databaseSizeBytes)} <span class="unit-tag">SQLite</span></div>
    <div class="subtle">${w.schemaVersion !== null && w.schemaVersion !== undefined ? `Schema v${escapeHtml(String(w.schemaVersion))}` : 'Schema unavailable'}</div>
    <div class="subtle">Updated ${snapshotAgeLabel(w.lastMaterializationAt)} ago</div>
  </article>`;
}

// Warehouse Status card - Health, Last Import/Materialization/Publish, size,
// and the three headline counts. Reuses collectorHealth()/statusPillHtml()
// from status.js so its health tone always agrees with Platform Status.
function warehouseStatusCard(w) {
  const health = collectorHealth({
    generatedAt: w.lastImportAt || w.lastMaterializationAt,
    expectedRefreshSeconds: w.expectedRefreshSeconds,
    warningAfterIntervals: w.warningAfterIntervals,
    criticalAfterIntervals: w.criticalAfterIntervals,
    available: w.available,
    status: w.available ? null : 'failed',
  });
  return `<section class="section warehouse-status-card">
    <div class="section-head"><h2>Warehouse Status</h2>${statusPillHtml(health)}</div>
    <div class="cards-grid">${[
      statBlock('Last Import', formatLocalDateTime(w.lastImportAt), `${snapshotAgeLabel(w.lastImportAt)} ago`),
      statBlock('Last Materialization', formatLocalDateTime(w.lastMaterializationAt), `${snapshotAgeLabel(w.lastMaterializationAt)} ago`),
      statBlock('Last Publication', formatLocalDateTime(w.lastPublishAt), `${snapshotAgeLabel(w.lastPublishAt)} ago`),
      warehouseOverviewCard(w),
      statBlock('Accounting Records', humanNumber(w.accountingRecords), 'Raw Slurm accounting rows'),
      statBlock('Unique Jobs', humanNumber(w.canonicalJobs), 'One canonical record per completed job'),
      statBlock('Job Steps', humanNumber(w.jobSteps), 'Step records'),
      statBlock('Reduction Ratio', `${humanNumber(w.accountingRecords, { style: 'short' })} → ${humanNumber(w.canonicalJobs, { style: 'short' })}`, w.reductionRatio !== null ? `${pct(w.reductionRatio, 1)} retained` : 'Retained share unavailable'),
    ].join('')}</div>
  </section>`;
}

// Clickable summary cards (Software Explorer Milestone 4, Part 1): same
// markup as statBlock() above, as a real <button> instead of an <article>
// so it's keyboard-accessible, wired to the exact same QUICK_FILTERS
// vocabulary the persistent quick-filter bar (Part 2) and Administrator
// Dashboard cards (Part 7) use - one click handler in wireEvents()
// (data-action="set-quick-filter") serves all three call sites.
function clickableStatBlock(label, value, trend, filterId, tone = '') {
  return `<button type="button" class="stat-card stat-card-clickable ${tone}" data-action="set-quick-filter" data-filter="${filterId}">
    <div class="label">${label}</div><div class="value">${value}</div><div class="subtle">${trend}</div>
  </button>`;
}

function percentileCard(label, value, status, tone) {
  return `<article class="percentile-card"><span class="pill ${tone}">${label}</span><strong>${value}</strong><div class="subtle">${status}</div></article>`;
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

function allocationGauge(label, alloc, total, formatter, note, updatedLabel) {
  const pctValue = total ? Number(alloc) / Number(total) : null;
  const tone = allocationReading(pctValue);
  const { html } = createGauge(pctValue, tone, {
    label,
    allocLabel: `${formatter(alloc)} / ${formatter(total)} allocated`,
    healthyRange: [0, Math.round(ALLOCATION_THRESHOLDS.warn * 100)],
    updatedLabel,
  });
  return `<article class="stat-card gauge-card ${tone}">
    <div class="label">${escapeHtml(label)}</div>
    <div class="value">${formatter(alloc)} / ${formatter(total)}</div>
    ${html}
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
// Phase 7: both of these are now instances of the shared createRangeSelector
// (js/timeRange.js) rather than one-off range/button/filter trios. New
// dashboards should call createRangeSelector() directly instead of adding
// another parallel implementation.
const HISTORY_RANGE_SELECTOR = createRangeSelector({
  id: 'history',
  stateKey: 'historyRange',
  action: 'set-history-range',
  defaultId: '7d',
  ranges: [
    { id: '24h', label: '24h', ms: 24 * 60 * 60 * 1000 },
    { id: '7d', label: '7d', ms: 7 * 24 * 60 * 60 * 1000 },
    { id: '30d', label: '30d', ms: 30 * 24 * 60 * 60 * 1000 },
    { id: '90d', label: '90d', ms: 90 * 24 * 60 * 60 * 1000 },
  ],
});
const HISTORY_RANGES = HISTORY_RANGE_SELECTOR.ranges;

function rangeButtons() {
  return rangeButtonsHtml(HISTORY_RANGE_SELECTOR, state.historyRange);
}

function filterPointsByRange(points) {
  return filterByRange(points, HISTORY_RANGE_SELECTOR, state.historyRange, 'timestamp');
}

const USER_PROFILE_RANGE_SELECTOR = createRangeSelector({
  id: 'userProfile',
  stateKey: 'userProfileRange',
  action: 'set-profile-range',
  defaultId: '90d',
  ranges: [
    { id: '30d',  label: '30d',  days: 30 },
    { id: '90d',  label: '90d',  days: 90 },
    { id: '180d', label: '180d', days: 180 },
    { id: '1y',   label: '1y',   days: 365 },
    { id: 'all',  label: 'All',  days: null },
  ],
});
const USER_PROFILE_RANGES = USER_PROFILE_RANGE_SELECTOR.ranges;

function profileRangeButtons() {
  return rangeButtonsHtml(USER_PROFILE_RANGE_SELECTOR, state.userProfileRange);
}

function filterTrendsByPeriod(trends) {
  return filterByRange(trends, USER_PROFILE_RANGE_SELECTOR, state.userProfileRange, 'report_date');
}

function hasCapacityHistory() {
  return Boolean(nodeInsightsHistory && nodeInsightsHistory.available && asArray(nodeInsightsHistory.capacity).length);
}

function historyUnavailableNote() {
  return disclaimer('Historical trend collection has not started yet. Once the hourly collector (scripts/collect_node_insights.py) has been running for a while, pressure and queue trends will appear here.');
}

// onClick: '#/nodes' - drilling from the fleet-wide pressure trend into the
// per-node inventory is the one concrete "aggregate -> detail" hop this
// chart can make without inventing a route that doesn't exist.
function capacityHistorySection(title, subtitle) {
  if (!hasCapacityHistory()) return historyUnavailableNote();
  const points = filterPointsByRange(nodeInsightsHistory.capacity);
  const option = capacityHistoryChartOption(points);
  annotateTimeline(option.series[0], points.map((p) => p.timestamp), OPERATIONAL_EVENTS);
  const { html } = registerChart(option, { label: title, onClick: '#/nodes', csv: true });
  return `<section class="section">
    <div class="section-head"><h2>${escapeHtml(title)}</h2>${rangeButtons()}</div>
    ${subtitle ? `<p class="subtle">${escapeHtml(subtitle)}</p>` : ''}
    <p class="subtle chart-drilldown-hint">Click the chart to view the Node Inventory.</p>
    ${html}
  </section>`;
}

function drainingHistorySection() {
  if (!hasCapacityHistory()) return historyUnavailableNote();
  const { html } = registerChart(drainingHistoryChartOption(filterPointsByRange(nodeInsightsHistory.capacity)), {
    label: 'Node availability trend', csv: true,
  });
  return `<section class="section">
    <div class="section-head"><h2>Node availability trend</h2>${rangeButtons()}</div>
    <p class="subtle">Available, draining, and down node counts over time.</p>
    ${html}
  </section>`;
}

function nodeHistorySection(nodeName, title) {
  const points = nodeInsightsHistory && nodeInsightsHistory.available ? nodeInsightsHistory.nodes[nodeName] : null;
  if (!points || !points.length) return historyUnavailableNote();
  const { html } = registerChart(nodeHistoryChartOption(filterPointsByRange(points)), {
    className: 'chart-container--tall', label: title, csv: true,
  });
  return `<section class="section">
    <div class="section-head"><h2>${escapeHtml(title)}</h2>${rangeButtons()}</div>
    ${html}
  </section>`;
}

// ---------------------------------------------------------------------------
// Queue Insights (docs/architecture/QUEUE_INSIGHTS_ARCHITECTURE.md). One
// shared in-memory model (the `queueInsights` global, loaded once by
// loadQueueInsightsData() in init()) feeds all five pages below - Queue
// Overview, Live Queue, Wait Time Analysis, Submission Advisor, Historical
// Trends - rather than each page fetching its own data, per the "not
// disconnected pages" requirement. Live fields (current pressure, partition
// pressure, pending reasons, Queue Health) come from the hourly Node
// Insights cycle; historical fields (wait-time series, distribution,
// submission patterns) come from the nightly Slurm Analytics cycle - see
// the architecture doc's "two-pipeline seam" note for why these stay two
// exports instead of one. No usernames, job IDs, job names, accounts,
// work directories, or node lists anywhere in this data - aggregate counts,
// percentiles, and reason-text buckets only.
// ---------------------------------------------------------------------------
const QUEUE_HEALTH_TONE = { Healthy: 'good', Busy: 'info', Congested: 'warn', 'Severely Congested': 'bad' };
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function queueInsightsUnavailable(pageLabel) {
  return `<div class="empty-state">${escapeHtml(pageLabel)} data has not been collected yet.</div>`;
}

function queueHealthBadge(health) {
  if (!health) return '<span class="pill info">Unknown</span>';
  const tone = QUEUE_HEALTH_TONE[health.label] || 'info';
  return `<span class="pill ${tone}">${escapeHtml(health.label)}</span> <span class="subtle">score ${fmt(health.score)}/100</span>`;
}

function hourLabel(hour) { return `${String(hour).padStart(2, '0')}:00`; }

function durationLabel(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(Number(seconds))) return '-';
  const s = Number(seconds);
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${(s / 3600).toFixed(1)}h`;
  return `${(s / 86400).toFixed(1)}d`;
}

// Cluster-wide rollup of queue_statistics (per-partition, per-day - see
// QUEUE_INSIGHTS_ARCHITECTURE.md Section 1.1: there is no cluster-wide row
// in that table) into one row per report_date, weighted by
// jobs_with_wait_time so a thin partition can't skew the cluster figure.
function clusterWaitSeriesRows(series) {
  const byDate = new Map();
  asArray(series).forEach((row) => {
    const n = num(row.jobs_with_wait_time);
    if (!n) return;
    const bucket = byDate.get(row.report_date) || { report_date: row.report_date, weighted_median: 0, weighted_p90: 0, weighted_avg: 0, jobs: 0 };
    bucket.weighted_median += (row.median_wait_seconds || 0) * n;
    bucket.weighted_p90 += (row.p90_wait_seconds || 0) * n;
    bucket.weighted_avg += (row.avg_wait_seconds || 0) * n;
    bucket.jobs += n;
    byDate.set(row.report_date, bucket);
  });
  return Array.from(byDate.values())
    .sort((a, b) => a.report_date.localeCompare(b.report_date))
    .map((b) => ({
      report_date: b.report_date,
      median_wait_seconds: b.jobs ? b.weighted_median / b.jobs : null,
      p90_wait_seconds: b.jobs ? b.weighted_p90 / b.jobs : null,
      avg_wait_seconds: b.jobs ? b.weighted_avg / b.jobs : null,
      jobs: b.jobs,
    }));
}

// Per-partition rollup of queue_statistics over the whole exported window,
// for the Wait Time Analysis page's partition comparison table.
function waitByPartitionRows(series) {
  const byPartition = new Map();
  asArray(series).forEach((row) => {
    const n = num(row.jobs_with_wait_time);
    if (!n) return;
    const bucket = byPartition.get(row.partition_name) || { partition: row.partition_name, weighted_median: 0, weighted_p90: 0, jobs: 0 };
    bucket.weighted_median += (row.median_wait_seconds || 0) * n;
    bucket.weighted_p90 += (row.p90_wait_seconds || 0) * n;
    bucket.jobs += n;
    byPartition.set(row.partition_name, bucket);
  });
  return Array.from(byPartition.values())
    .map((b) => ({
      partition: b.partition,
      median_wait_seconds: b.jobs ? b.weighted_median / b.jobs : null,
      p90_wait_seconds: b.jobs ? b.weighted_p90 / b.jobs : null,
      jobs: b.jobs,
    }))
    .sort((a, b) => b.jobs - a.jobs);
}

// Queue depth over time reuses Node Insights' already-exported
// capacity_history.json (running_jobs/pending_jobs) rather than collecting
// it again - see QUEUE_INSIGHTS_ARCHITECTURE.md Section 5's "no duplicate
// collection" principle. Same state.historyRange/filterPointsByRange()
// selector the Infrastructure pages already use.
function queueDepthHistoryRows() {
  if (!nodeInsightsHistory || !nodeInsightsHistory.available) return [];
  return filterPointsByRange(nodeInsightsHistory.capacity).map((p) => ({
    report_date: p.timestamp, running_jobs: p.running_jobs, pending_jobs: p.pending_jobs,
  }));
}

function queueDepthChart() {
  const rows = queueDepthHistoryRows();
  if (!rows.length) return historyUnavailableNote();
  return lineChart('Running / pending jobs', rows, [
    chartSeries(rows, 'running_jobs', 'Running', '#30d5d0'),
    chartSeries(rows, 'pending_jobs', 'Pending', '#ff8a65'),
  ], fmt, { zeroBase: true });
}

// Shared by queueOverviewPage() and the Executive Overview's Current Alerts
// section, so "what counts as saturated" is defined exactly once.
function partitionsUnderPressure(byPartition, threshold = 0.6) {
  return asArray(byPartition)
    .map((p) => ({ ...p, pressure: (num(p.running) + num(p.pending)) ? num(p.pending) / (num(p.running) + num(p.pending)) : 0 }))
    .filter((p) => p.pressure >= threshold)
    .sort((a, b) => b.pressure - a.pressure);
}

function queueOverviewPage() {
  if (!queueInsights || !queueInsights.available) return queueInsightsUnavailable('Queue Insights');
  const cp = asObject(queueInsights.currentPressure);
  const queue = asObject(cp.queue);
  const byPartition = asArray(cp.by_partition);
  const health = cp.queue_health || null;
  const clusterSeries = clusterWaitSeriesRows(asObject(queueInsights.waitTimeHistory).series);
  const latestWait = clusterSeries.length ? clusterSeries[clusterSeries.length - 1] : null;
  const saturated = partitionsUnderPressure(byPartition);

  return `
    <div class="stack">
      <section class="section"><div class="section-head"><h2>Queue Overview</h2>${queueHealthBadge(health)}</div>
        <div class="cards-grid">${[
          statBlock('Running', fmt(queue.running), 'Jobs currently executing', 'good'),
          statBlock('Pending', fmt(queue.pending), 'Jobs waiting to start', num(queue.pending) ? 'info' : 'good'),
          statBlock('Median wait (latest day)', durationLabel(latestWait && latestWait.median_wait_seconds), 'Cluster-wide, weighted by partition'),
          statBlock('P90 wait (latest day)', durationLabel(latestWait && latestWait.p90_wait_seconds), 'Cluster-wide, weighted by partition'),
        ].join('')}</div>
      </section>
      <section class="section"><div class="section-head"><h2>Partitions under pressure</h2><span class="subtle">Pending share of partition's own queue &ge; 60%</span></div>
        ${saturated.length
          ? tableFromRows(['Partition', 'Running', 'Pending', 'Pending share'], saturated.map((p) => [escapeHtml(p.partition), fmt(p.running), fmt(p.pending), pct(p.pressure)]))
          : '<div class="empty-state">No partition is currently under elevated pressure.</div>'}
      </section>
      <div class="cards-grid">
        <a class="metric-card" href="#/queue-live"><div class="metric-label">Live Queue</div><div class="metric-trend">Current depth, pending reasons, by-partition pressure</div></a>
        <a class="metric-card" href="#/queue-wait-times"><div class="metric-label">Wait Time Analysis</div><div class="metric-trend">Percentiles, distribution, partition/size comparisons</div></a>
        <a class="metric-card" href="#/queue-advisor"><div class="metric-label">Submission Advisor</div><div class="metric-trend">Historically lower-wait windows, never a guarantee</div></a>
        <a class="metric-card" href="#/queue-trends"><div class="metric-label">Historical Trends</div><div class="metric-trend">Queue depth, health, and wait time over time</div></a>
      </div>
      ${disclaimer('Queue Health is a composite score from the live pending/running ratio, CPU allocation pressure, and worst-partition concentration (docs/architecture/QUEUE_INSIGHTS_ARCHITECTURE.md Section 5a) - a summary signal, not a guarantee for any individual job.')}
    </div>`;
}

function queueLivePage() {
  if (!queueInsights || !queueInsights.available) return queueInsightsUnavailable('Live Queue');
  const cp = asObject(queueInsights.currentPressure);
  const queue = asObject(cp.queue);
  const byPartition = asArray(cp.by_partition);
  const pendingReasons = asArray(cp.pending_reasons);
  const health = cp.queue_health || null;

  return `
    <div class="stack">
      <section class="section"><div class="section-head"><h2>Live Queue</h2>${queueHealthBadge(health)}</div>
        <div class="cards-grid">${[
          statBlock('Running', fmt(queue.running), 'Across all partitions', 'good'),
          statBlock('Pending', fmt(queue.pending), 'Waiting to start', num(queue.pending) ? 'info' : 'good'),
          statBlock('Partitions reporting', fmt(byPartition.length), 'Live squeue/sinfo snapshot'),
        ].join('')}</div>
      </section>
      <div class="trend-grid">
        <section class="section"><div class="section-head"><h2>By partition</h2></div>${tableFromRows(['Partition', 'Running', 'Pending'], byPartition.map((p) => [escapeHtml(p.partition), fmt(p.running), fmt(p.pending)]))}</section>
        <section class="section"><div class="section-head"><h2>Pending reasons</h2></div>${tableFromRows(['Reason', 'Jobs'], pendingReasons.map((r) => [escapeHtml(r.reason), fmt(r.count)]))}</section>
      </div>
      <section class="section"><div class="section-head"><h2>Trend</h2>${rangeButtons()}</div>${queueDepthChart()}</section>
      ${disclaimer('Refreshed hourly from live squeue/sinfo polling, not a real-time stream. No job IDs, usernames, or job names - aggregate counts and reason-text buckets only.')}
    </div>`;
}

function queueWaitTimesPage() {
  if (!queueInsights || !queueInsights.available) return queueInsightsUnavailable('Wait Time Analysis');
  const wth = asObject(queueInsights.waitTimeHistory);
  const series = asArray(wth.series);
  const clusterRows = clusterWaitSeriesRows(series);
  const latest = clusterRows.length ? clusterRows[clusterRows.length - 1] : null;
  const byPartition = waitByPartitionRows(series);
  const histogram = asArray(wth.wait_time_histogram);
  const bySize = asArray(wth.wait_time_by_size);
  const cpuBuckets = bySize.filter((r) => r.bucket_type === 'cpu');
  const memoryBuckets = bySize.filter((r) => r.bucket_type === 'memory');

  return `
    <div class="stack">
      <section class="section"><div class="section-head"><h2>Wait Time Analysis</h2><span class="subtle">${wth.histogram_date ? `Distribution as of ${escapeHtml(wth.histogram_date)}` : ''}</span></div>
        <div class="cards-grid">${[
          statBlock('Median wait', durationLabel(latest && latest.median_wait_seconds), 'Cluster-wide, latest day'),
          statBlock('Average wait', durationLabel(latest && latest.avg_wait_seconds), 'Cluster-wide, latest day'),
          statBlock('P90 wait', durationLabel(latest && latest.p90_wait_seconds), 'Cluster-wide, latest day'),
          statBlock('Jobs measured', fmt(latest && latest.jobs), 'With a measurable wait time'),
        ].join('')}</div>
      </section>
      <section class="section"><div class="section-head"><h2>Wait time trend</h2><span class="subtle">${wth.data_window_days || 90}-day window, daily</span></div>
        ${clusterRows.length ? lineChart('Median / P90 wait (seconds)', clusterRows, [
          chartSeries(clusterRows, 'median_wait_seconds', 'Median', '#3e8cff'),
          chartSeries(clusterRows, 'p90_wait_seconds', 'P90', '#ff8a65'),
        ], fmt) : '<div class="empty-state">No wait-time history yet.</div>'}
      </section>
      <div class="trend-grid">
        <section class="section"><div class="section-head"><h2>By partition</h2></div>${tableFromRows(['Partition', 'Median wait', 'P90 wait', 'Jobs'], byPartition.map((p) => [escapeHtml(p.partition), durationLabel(p.median_wait_seconds), durationLabel(p.p90_wait_seconds), fmt(p.jobs)]))}</section>
        <section class="section"><div class="section-head"><h2>Wait time distribution (latest day)</h2></div>
          ${histogram.length ? tableFromRows(['Partition', 'Bucket', 'Jobs'], histogram.map((h) => [escapeHtml(h.partition_name), escapeHtml(h.bucket), fmt(h.jobs)])) : '<div class="empty-state">No distribution data yet.</div>'}
        </section>
      </div>
      <div class="trend-grid">
        <section class="section"><div class="section-head"><h2>By requested CPUs</h2></div>${tableFromRows(['Partition', 'Bucket', 'Jobs', 'Median wait'], cpuBuckets.map((r) => [escapeHtml(r.partition_name), escapeHtml(r.bucket), fmt(r.jobs), durationLabel(r.median_wait_seconds)]))}</section>
        <section class="section"><div class="section-head"><h2>By requested memory</h2></div>${tableFromRows(['Partition', 'Bucket', 'Jobs', 'Median wait'], memoryBuckets.map((r) => [escapeHtml(r.partition_name), escapeHtml(r.bucket), fmt(r.jobs), durationLabel(r.median_wait_seconds)]))}</section>
      </div>
      ${disclaimer('Wait time is measured from job submission to job start (sacct-derived), not a live queue position. Size buckets use allocated CPUs/memory as a proxy for the original request.')}
    </div>`;
}

function queueAdvisorPage() {
  if (!queueInsights || !queueInsights.available) return queueInsightsUnavailable('Submission Advisor');
  const sp = asObject(queueInsights.submissionPatterns);
  const bestWindows = asArray(sp.best_submission_windows).slice()
    .sort((a, b) => num(a.median_wait_seconds) - num(b.median_wait_seconds));
  // Total submissions actually analyzed per partition over the trailing
  // window (sum of every weekday x hour cell already in sp.cells) - shown
  // alongside the best-window sample so a low best-window count (a quiet
  // partition's busiest qualifying hour) is never mistaken for a small
  // analysis sample (which would instead show up here as a low total).
  const totalsByPartition = {};
  asArray(sp.cells).forEach((c) => {
    totalsByPartition[c.partition_name] = (totalsByPartition[c.partition_name] || 0) + num(c.jobs);
  });

  return `
    <div class="stack">
      <section class="section"><div class="section-head"><h2>Submission Advisor</h2><span class="subtle">${sp.window_days || 90}-day trailing window</span></div>
        <p class="subtle">Historical tendencies only - never a guarantee for any individual job. "Best-window sample" is how many jobs landed in that specific recommended day/hour - it is normally much smaller than the partition's total submissions (shown alongside it) because it is one of up to 168 weekday x hour slots, not the whole queue. Windows with fewer than ${fmt(sp.min_cell_sample)} sampled jobs are flagged low-confidence.</p>
        ${bestWindows.length
          ? tableFromRows(['Partition', 'Best day', 'Best hour', 'Typical wait', 'Best-window sample', 'Total submissions (90d)', 'Confidence'], bestWindows.map((w) => [
              escapeHtml(w.partition_name),
              escapeHtml(WEEKDAY_NAMES[w.weekday] || String(w.weekday)),
              hourLabel(w.hour_of_day),
              durationLabel(w.median_wait_seconds),
              fmt(w.sample_jobs),
              fmt(totalsByPartition[w.partition_name] || 0),
              `<span class="pill ${w.confidence === 'low' ? 'warn' : 'good'}">${escapeHtml(w.confidence)}</span>`,
            ]))
          : '<div class="empty-state">Not enough submission history yet to recommend a window.</div>'}
      </section>
      ${disclaimer(sp.guidance || 'Recommendations are historical tendencies, not guarantees for any individual job.')}
    </div>`;
}

function queueTrendsPage() {
  if (!queueInsights || !queueInsights.available) return queueInsightsUnavailable('Historical Trends');
  const healthRows = filterPointsByRange(queueInsights.queueHealthHistory).map((p) => ({ report_date: p.timestamp, score: p.score }));
  const depthRows = queueDepthHistoryRows();
  const clusterWaitRows = clusterWaitSeriesRows(asObject(queueInsights.waitTimeHistory).series);

  const reasonHistory = filterPointsByRange(queueInsights.pendingReasonsHistory);
  const reasonTotals = new Map();
  reasonHistory.forEach((p) => reasonTotals.set(p.reason, (reasonTotals.get(p.reason) || 0) + num(p.count)));
  const topReasons = Array.from(reasonTotals.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([reason]) => reason);
  const reasonTimestamps = Array.from(new Set(reasonHistory.map((p) => p.timestamp))).sort();
  const reasonRows = reasonTimestamps.map((ts) => {
    const row = { report_date: ts };
    topReasons.forEach((reason) => { row[reason] = 0; });
    reasonHistory.filter((p) => p.timestamp === ts && topReasons.includes(p.reason)).forEach((p) => { row[p.reason] = num(p.count); });
    return row;
  });
  const reasonColors = ['#3e8cff', '#ff8a65', '#30d5d0'];

  return `
    <div class="stack">
      <section class="section"><div class="section-head"><h2>Historical Trends</h2>${rangeButtons()}</div></section>
      <div class="trend-grid">
        <section class="section"><div class="section-head"><h2>Queue depth</h2></div>${depthRows.length ? lineChart('Running / pending jobs', depthRows, [
          chartSeries(depthRows, 'running_jobs', 'Running', '#30d5d0'),
          chartSeries(depthRows, 'pending_jobs', 'Pending', '#ff8a65'),
        ], fmt, { zeroBase: true }) : historyUnavailableNote()}</section>
        <section class="section"><div class="section-head"><h2>Queue Health score</h2><span class="subtle chart-drilldown-hint">Click chart for live Queue Overview</span></div>${healthRows.length ? lineChart('Queue Health score (0-100)', healthRows, [
          chartSeries(healthRows, 'score', 'Score', '#ffb74d'),
        ], fmt, { zeroBase: true, onClick: '#/queue-overview', csv: true }) : historyUnavailableNote()}</section>
      </div>
      <div class="trend-grid">
        <section class="section"><div class="section-head"><h2>Top pending reasons</h2></div>${reasonRows.length ? lineChart('Pending jobs by reason', reasonRows, topReasons.map((reason, i) => chartSeries(reasonRows, reason, reason, reasonColors[i % reasonColors.length])), fmt, { zeroBase: true }) : historyUnavailableNote()}</section>
        <section class="section"><div class="section-head"><h2>Wait time</h2><span class="subtle">Daily, cluster-wide</span></div>${clusterWaitRows.length ? lineChart('Median / P90 wait (seconds)', clusterWaitRows, [
          chartSeries(clusterWaitRows, 'median_wait_seconds', 'Median', '#3e8cff'),
          chartSeries(clusterWaitRows, 'p90_wait_seconds', 'P90', '#ff8a65'),
        ], fmt) : '<div class="empty-state">No wait-time history yet.</div>'}</section>
      </div>
      ${disclaimer('Queue depth, Queue Health, and pending reasons are hourly (filterable above, up to 90 days); wait time is daily (sacct-derived). Different cadences are expected - see docs/architecture/QUEUE_INSIGHTS_ARCHITECTURE.md Section 1.5.')}
    </div>`;
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
  const allocationUpdatedLabel = `${snapshotAgeLabel(findModule(platformRegistry, 'node-insights')?.generatedAt)} ago`;

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
        ${allocationGauge('CPU allocation', cpu.alloc, cpu.total, fmt, null, allocationUpdatedLabel)}
        ${allocationGauge('Memory allocation', mem.alloc, mem.total, gib, null, allocationUpdatedLabel)}
        ${allocationGauge('GPU allocation', gpu.alloc, gpu.total, fmt, gpu.alloc_pct_of_online !== null && gpu.alloc_pct_of_online !== undefined ? `${pct(gpu.alloc_pct_of_online)} of online GPUs` : null, allocationUpdatedLabel)}
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
      ${capacityHistorySection('Cluster pressure trend', 'CPU, memory, and GPU pressure plus running/pending jobs and draining nodes over time.')}
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
      ${drainingHistorySection()}
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
      ${capacityHistorySection('Pressure & queue trend', 'CPU, memory, and GPU pressure plus running/pending jobs and draining nodes over time.')}
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
      ${nodeHistorySection(node.node, 'Utilization history')}
      ${gpuIdleCpuBusy ? insight('GPU-idle, CPU-busy', `This node has ${fmt(node.cpu_alloc)} CPUs allocated but 0 of its ${fmt(node.gpu_total)} GPUs are reserved.${node.drain ? ' It is draining for maintenance but still absorbing CPU-only work.' : ''}`) : ''}
      ${disclaimer('Job-level detail (which user or job is running here) requires admin access and is not shown in this public view. No usernames, job names, or job IDs are exposed on this page.')}
      <p class="subtle"><a href="#/nodes">&larr; Back to Node Inventory</a></p>
    </div>`;
}

// ---- Software Inventory (Software Analytics Milestone 1 frontend) -------
// Renders module_catalog exactly as published in software_inventory.json
// (schema software-inventory-v1, scripts/export_software_inventory.py) -
// see docs/architecture/SOFTWARE_INVENTORY_FRONTEND.md. No AI enrichment, no
// usage statistics, no job metadata: every field rendered here already
// exists in that export today. Filtering/sorting/pagination are all
// client-side over the one already-loaded modules array - no per-keystroke
// fetch, no server round-trip.
const SOFTWARE_INVENTORY_PAGE_SIZE = 50;

function softwareInventoryUnavailable() {
  return `<div class="empty-state">Software Inventory data has not been published yet (or the file failed to load/parse). The nightly scanner and exporter run as part of the Slurm Analytics cycle - see docs/architecture/SOFTWARE_INVENTORY_ARCHITECTURE.md in the private repo.</div>`;
}

// Only two states exist in module_catalog today. The future states named
// in the Software Analytics brief (update available / AI enriched) are
// deliberately not implemented - this function's only job is to read
// removedAt, never to guess at a state nothing in the export supports yet.
function softwareStatusPill(m) {
  return m.removedAt
    ? '<span class="pill muted">&#9898; Removed</span>'
    : '<span class="pill good">&#128994; Installed</span>';
}

// Rich status badges (Software Explorer Milestone 4, Part 3) - replaces
// the single Installed/Removed pill above with however many of four
// independent, data-driven badges actually apply to this module. Every
// badge reads a field the export already provides; none is a new state
// invented for this milestone ("do not invent new states" - the brief's
// own words):
//   - Installed/Removed: removedAt, same as softwareStatusPill() above.
//   - Update Available: module_knowledge.update_available, already
//     computed server-side (export_software_inventory.py).
//   - Knowledge Available: module_knowledge.knowledge_source presence.
//   - Default Version: this row's moduleVersion equals its family's
//     default_version (Milestone 2, already exported) - a plain string
//     equality check against an already-resolved value, not a new
//     computation.
// Used identically in the inventory table and the module detail page so
// the two never drift apart - one function, two call sites.
// Clickable badge (Part 10): same data-action/click handler as every
// other quick-filter trigger on this page. Default Version has no
// dedicated quick filter (there is no useful "show me only default
// versions" view - same reasoning softwareInventorySummaryCards() already
// applies to Module Roots/Distinct Packages/Versions), so it stays a
// plain, non-clickable badge below.
function clickableBadge(tone, html, filterId) {
  return `<button type="button" class="pill ${tone}" data-action="set-quick-filter" data-filter="${filterId}">${html}</button>`;
}

function softwareStatusBadges(m, knowledge, family) {
  const badges = [m.removedAt
    ? clickableBadge('muted', '&#9898; Removed', 'removed')
    : clickableBadge('good', '&#128994; Installed', 'installed')];
  if (knowledge?.updateAvailable === true) {
    badges.push(clickableBadge('warn', '&#128993; Update Available', 'updates-available'));
  }
  if (knowledge?.knowledgeSource) {
    badges.push(clickableBadge('info', '&#128311; Knowledge Available', 'knowledge-available'));
  }
  if (family?.defaultVersion && family.defaultVersion === m.moduleVersion) {
    badges.push('<span class="pill">&#11088; Default Version</span>');
  }
  return `<span class="badge-group">${badges.join('')}</span>`;
}

function truncateText(text, maxLength) {
  const value = String(text || '');
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

// MODULEPATH directory a modulefile_path was found under, e.g.
// "/opt/software/modules/ABC/1.0.0" -> "/opt/software/modules" - the same
// derivation scan_software_inventory.py's directory_of() does server-side,
// just over a path string that is already in the export (not new data).
function modulePathRoot(modulefilePath) {
  const parts = String(modulefilePath || '').split('/');
  return parts.slice(0, -2).join('/') || '-';
}

// Software Explorer Milestone 4 (Parts 1-2): one filter vocabulary shared
// by the quick-filter bar, every clickable summary/health/admin card, and
// softwareInventoryFilteredModules() below - this is "reuse the existing
// client-side filtering framework rather than introducing a second
// filtering implementation" made literal. A predicate reads only fields
// the export already provides (module_knowledge/module_families via the
// two helpers passed in) - no new client-side computation beyond simple
// presence/equality checks and a recency window using the existing
// snapshotAgeMs() (already used elsewhere for collector freshness, not a
// new date-handling concept introduced for this milestone).
const RECENTLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const QUICK_FILTERS = [
  { id: 'all', label: 'All', predicate: () => true },
  { id: 'installed', label: 'Installed', predicate: (m) => !m.removedAt },
  { id: 'removed', label: 'Removed', predicate: (m) => !!m.removedAt },
  { id: 'updates-available', label: 'Updates Available', predicate: (m, h) => h.knowledge(m)?.updateAvailable === true },
  { id: 'knowledge-available', label: 'Knowledge Available', predicate: (m, h) => !!h.knowledge(m)?.knowledgeSource },
  { id: 'missing-metadata', label: 'Missing Metadata', predicate: (m, h) => !h.knowledge(m)?.knowledgeSource },
  { id: 'with-repository', label: 'With Repository', predicate: (m, h) => hasRepository(h.knowledge(m)) },
  { id: 'with-homepage', label: 'With Homepage', predicate: (m, h) => !!h.knowledge(m)?.homepage },
  { id: 'with-documentation', label: 'With Documentation', predicate: (m, h) => !!h.knowledge(m)?.documentationUrl },
  { id: 'with-license', label: 'With License', predicate: (m, h) => !!h.knowledge(m)?.license },
  { id: 'recently-added', label: 'Recently Added', predicate: (m) => isRecent(m.firstSeen) },
  { id: 'recently-updated', label: 'Recently Updated', predicate: (m, h) => isRecent(h.knowledge(m)?.lastCheckedAt) },
  // Administrator Dashboard (Part 7) targets - same predicates the health/
  // admin cards link to, not exposed as quick-filter-bar buttons (Part 2's
  // suggested list does not include them) but reachable by clicking the
  // relevant card, same mechanism throughout.
  { id: 'deprecated-versions', label: 'Deprecated Versions', predicate: (m, h) => isDeprecatedVersion(m, h) },
  { id: 'missing-homepage', label: 'Missing Homepage', predicate: (m, h) => !m.removedAt && !h.knowledge(m)?.homepage },
  { id: 'missing-repository', label: 'Missing Repository', predicate: (m, h) => !m.removedAt && !hasRepository(h.knowledge(m)) },
  { id: 'missing-license', label: 'Missing License', predicate: (m, h) => !m.removedAt && !h.knowledge(m)?.license },
];
const QUICK_FILTER_BY_ID = new Map(QUICK_FILTERS.map((f) => [f.id, f]));
// Part 2's persistent bar only shows this subset - the rest (removed,
// deprecated-versions, missing-*) are still real, working filters, just
// reached via a card click (Parts 1/7) rather than a permanent button,
// so the bar doesn't grow to sixteen buttons.
const QUICK_FILTER_BAR_IDS = [
  'all', 'installed', 'updates-available', 'knowledge-available', 'missing-metadata',
  'with-repository', 'with-homepage', 'with-documentation', 'with-license',
  'recently-added', 'recently-updated',
];

function hasRepository(knowledge) {
  return !!(knowledge?.sourceRepositoryUrl || knowledge?.githubRepositoryUrl || knowledge?.gitlabRepositoryUrl);
}

function isRecent(isoDate) {
  if (!isoDate) return false;
  const age = snapshotAgeMs(isoDate);
  return age !== null && age >= 0 && age <= RECENTLY_WINDOW_MS;
}

// Deprecated = an older installed version of a module_name that also has
// a newer version installed right now - compares against
// moduleFamilies[name].latestInstalledVersion, a value already sorted
// server-side (db.version_sort_key()); this is a plain string equality
// check against that pre-sorted result, not a new version-comparison
// implementation.
function isDeprecatedVersion(m, h) {
  if (m.removedAt) return false;
  const family = h.family(m);
  return !!family?.latestInstalledVersion && family.latestInstalledVersion !== m.moduleVersion;
}

function softwareInventoryFilterHelpers() {
  const knowledgeByName = asObject(softwareInventory?.moduleKnowledge);
  const familiesByName = asObject(softwareInventory?.moduleFamilies);
  return {
    knowledge: (m) => knowledgeByName[m.moduleName] || null,
    family: (m) => familiesByName[m.moduleName] || null,
  };
}

function softwareInventoryFilteredModules() {
  const filters = state.softwareInventoryFilters;
  const all = asArray(softwareInventory?.modules);
  const term = filters.search.trim().toLowerCase();
  const helpers = softwareInventoryFilterHelpers();
  const quickFilter = QUICK_FILTER_BY_ID.get(filters.quickFilter) || QUICK_FILTER_BY_ID.get('all');
  const filtered = all.filter((m) => {
    if (!quickFilter.predicate(m, helpers)) return false;
    if (!term) return true;
    return [m.moduleName, m.moduleVersion, m.displayDescription, m.whatisText, m.modulefilePath]
      .some((field) => String(field || '').toLowerCase().includes(term));
  });
  const dir = filters.sortDir === 'desc' ? -1 : 1;
  return filtered.slice().sort((a, b) => dir * String(a[filters.sortKey] || '').localeCompare(String(b[filters.sortKey] || '')));
}

// Software Explorer Milestone 4, Part 1: each card that maps cleanly to a
// real QUICK_FILTERS predicate is now clickable. Module Roots/Distinct
// Software Packages/Distinct Versions deliberately stay plain statBlock()s -
// there is no sensible single-predicate filter for "show me the modules
// contributing to this directory/name/version count" (it would just be
// "all" again), so making them clickable would be decorative, not
// functional - a card is only made clickable when clicking it changes the
// result set.
function softwareInventorySummaryCards(summary, modules) {
  const distinctPackages = new Set(modules.map((m) => m.moduleName)).size;
  const distinctVersions = new Set(modules.map((m) => `${m.moduleName}/${m.moduleVersion}`)).size;
  const moduleRoots = new Set(modules.map((m) => modulePathRoot(m.modulefilePath))).size;
  const windowDays = summary.recent_window_days ?? 7;
  return `<div class="cards-grid">${[
    clickableStatBlock('Installed Modules', fmt(summary.installed_modules), 'Currently active in module_catalog', 'installed'),
    clickableStatBlock('Newly Added', fmt(summary.new_modules), `Last ${fmt(windowDays)} days`, 'recently-added'),
    clickableStatBlock('Removed', fmt(summary.removed_modules), `Last ${fmt(windowDays)} days`, 'removed'),
    statBlock('Module Roots', fmt(moduleRoots), 'Distinct MODULEPATH directories'),
    statBlock('Distinct Software Packages', fmt(distinctPackages), 'Unique module names'),
    statBlock('Distinct Versions', fmt(distinctVersions), 'Unique name/version pairs'),
  ].join('')}</div>`;
}

// Software Health (Software Knowledge Milestone 3, expanded in Software
// Explorer Milestone 4 Part 8): coverage metrics and their percentages,
// both computed server-side by export_software_inventory.py's
// build_knowledge_summary() - this function only renders them, it never
// recomputes a count or a percentage. Returns '' entirely when knowledge
// collection has not run yet (totalActiveModules is null on an export
// that predates Milestone 3, or before collect_module_knowledge.py's
// first run), rather than a section full of zeroes that would
// misleadingly read as "no module has documentation" instead of "not
// collected yet." Every card is clickable (Part 1) - same QUICK_FILTERS
// mechanism the inventory summary cards and quick-filter bar use.
function pctLabel(value) {
  return value === null || value === undefined ? '-' : `${fmt(value, 1)}%`;
}

function softwareHealthSection(knowledgeSummary) {
  const s = asObject(knowledgeSummary);
  if (s.totalActiveModules === null || s.totalActiveModules === undefined) return '';
  return `<section class="section">
    <div class="section-head"><h2>Software Health</h2><span class="subtle">Knowledge coverage across ${fmt(s.totalActiveModules)} active module(s)</span></div>
    <div class="cards-grid">${[
      clickableStatBlock('Knowledge Coverage', pctLabel(s.knowledgeCoveragePct), 'Modules with at least one matched registry', 'knowledge-available'),
      clickableStatBlock('Homepage Coverage', pctLabel(s.homepageCoveragePct), `${fmt(s.modulesWithHomepage)} modules with a known homepage`, 'with-homepage'),
      clickableStatBlock('Documentation Coverage', pctLabel(s.documentationCoveragePct), `${fmt(s.modulesWithDocumentation)} modules with a known documentation URL`, 'with-documentation'),
      clickableStatBlock('Repository Coverage', pctLabel(s.repositoryCoveragePct), `${fmt(s.modulesWithRepository)} modules with a known repository`, 'with-repository'),
      clickableStatBlock('License Coverage', pctLabel(s.licenseCoveragePct), `${fmt(s.modulesWithLicense)} modules with a known license`, 'with-license'),
      clickableStatBlock('Update Coverage', pctLabel(s.updateCoveragePct), `${fmt(s.modulesWithUpdateAvailable)} modules with an update available`, 'updates-available', 'warn'),
      clickableStatBlock('Missing Metadata', fmt(s.modulesMissingMetadata), 'No exact match on any registry yet', 'missing-metadata'),
    ].join('')}</div>
  </section>`;
}

// Administrator Dashboard (Software Explorer Milestone 4, Part 7) - the
// operational "what needs attention" view, every card clickable into the
// same filtered inventory below it. Returns '' under the same condition
// softwareHealthSection() does (knowledge collection has never run) -
// there is nothing actionable to show before that.
function administratorDashboardSection(knowledgeSummary) {
  const s = asObject(knowledgeSummary);
  if (s.totalActiveModules === null || s.totalActiveModules === undefined) return '';
  const deprecatedCount = asArray(softwareInventory?.modules)
    .filter((m) => isDeprecatedVersion(m, softwareInventoryFilterHelpers())).length;
  return `<section class="section">
    <div class="section-head"><h2>Administrator Action Needed</h2><span class="subtle">Click a card to see the affected modules</span></div>
    <div class="cards-grid">${[
      clickableStatBlock('Updates Available', fmt(s.modulesWithUpdateAvailable), 'Installed version is older than the known upstream version', 'updates-available', 'warn'),
      clickableStatBlock('Missing Metadata', fmt(s.modulesMissingMetadata), 'No exact match on any registry yet', 'missing-metadata'),
      clickableStatBlock('Deprecated Versions', fmt(deprecatedCount), 'Installed versions superseded by a newer install of the same module', 'deprecated-versions'),
      clickableStatBlock('Missing Homepage', fmt(s.totalActiveModules - s.modulesWithHomepage), 'Active modules with no known homepage', 'missing-homepage'),
      clickableStatBlock('Missing Repository', fmt(s.totalActiveModules - s.modulesWithRepository), 'Active modules with no known repository', 'missing-repository'),
      clickableStatBlock('Missing License', fmt(s.totalActiveModules - s.modulesWithLicense), 'Active modules with no known license', 'missing-license'),
    ].join('')}</div>
  </section>`;
}

// Quick Filter Bar (Software Explorer Milestone 4, Part 2) - replaces the
// old single Status <select>. Persistent buttons for the subset of
// QUICK_FILTERS named in the brief's Part 2 list; "Removed" and the
// Administrator Dashboard's deprecated/missing-* filters are still real,
// reachable filters (via a card click, Part 1/7) but not given a
// permanent button here, so the bar doesn't grow unbounded as more
// filters are added later (Part 11's future-compatibility goal).
function quickFilterBar(selected) {
  const buttons = QUICK_FILTER_BAR_IDS.map((id) => {
    const filter = QUICK_FILTER_BY_ID.get(id);
    const pressed = selected === id;
    return `<button type="button" class="quick-filter-button" data-action="set-quick-filter" data-filter="${id}" aria-pressed="${pressed}">${escapeHtml(filter.label)}</button>`;
  }).join('');
  return `<div class="quick-filter-bar" role="group" aria-label="Quick filters">${buttons}</div>`;
}

function softwareInventorySortableTable(rows) {
  const filters = state.softwareInventoryFilters;
  const columns = [
    ['Module Name', 'moduleName'], ['Version', 'moduleVersion'], ['Description', null],
    ['Module Path', null], ['Status', null], ['First Seen', 'firstSeen'], ['Last Seen', 'lastSeen'],
  ];
  const headers = columns.map(([label, key]) => {
    if (!key) return `<th>${escapeHtml(label)}</th>`;
    const active = key === filters.sortKey;
    const arrow = active ? (filters.sortDir === 'desc' ? ' ↓' : ' ↑') : '';
    return `<th><button type="button" class="sort-button" data-action="sort-software-inventory" data-key="${key}">${escapeHtml(label)}${arrow}</button></th>`;
  }).join('');
  const helpers = softwareInventoryFilterHelpers();
  const body = rows.length
    ? rows.map((m) => `<tr>
        <td><a href="#/module/${encodeURIComponent(m.modulefilePath)}"><strong>${escapeHtml(m.moduleName)}</strong></a></td>
        <td>${escapeHtml(m.moduleVersion)}</td>
        <td>${m.displayDescription ? escapeHtml(truncateText(m.displayDescription, 90)) : '<span class="subtle">No description</span>'}</td>
        <td><code class="subtle">${escapeHtml(truncateText(m.modulefilePath, 60))}</code></td>
        <td>${softwareStatusBadges(m, helpers.knowledge(m), helpers.family(m))}</td>
        <td>${formatLocalDateTime(m.firstSeen, '-')}</td>
        <td>${formatLocalDateTime(m.lastSeen, '-')}</td>
      </tr>`).join('')
    : `<tr><td colspan="${columns.length}">No modules match the current search/filters.</td></tr>`;
  return `<table><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table>`;
}

function softwareInventoryPagination(page, totalPages, totalCount) {
  if (totalPages <= 1) return '';
  return `<div class="pagination">
    <button type="button" class="btn" data-action="page-software-inventory" data-direction="prev" ${page <= 1 ? 'disabled' : ''}>&larr; Prev</button>
    <span class="subtle">Page ${page} of ${totalPages} (${fmt(totalCount)} modules)</span>
    <button type="button" class="btn" data-action="page-software-inventory" data-direction="next" ${page >= totalPages ? 'disabled' : ''}>Next &rarr;</button>
  </div>`;
}

function softwareInventoryPage() {
  if (!softwareInventory || !softwareInventory.available) return `<div class="stack">${softwareInventoryUnavailable()}</div>`;
  const allModules = asArray(softwareInventory.modules);
  if (!allModules.length) {
    return `<div class="stack">${softwareInventoryStatusBar()}<div class="empty-state">The software inventory catalogue is empty - either the nightly scanner has not populated module_catalog yet, or every previously-installed module has since been removed.</div></div>`;
  }

  const filters = state.softwareInventoryFilters;
  const filtered = softwareInventoryFilteredModules();
  const totalPages = Math.max(1, Math.ceil(filtered.length / SOFTWARE_INVENTORY_PAGE_SIZE));
  const page = Math.min(Math.max(1, filters.page), totalPages);
  const pageRows = filtered.slice((page - 1) * SOFTWARE_INVENTORY_PAGE_SIZE, page * SOFTWARE_INVENTORY_PAGE_SIZE);

  return `
    <div class="stack">
      ${softwareInventoryStatusBar()}
      <section class="section">
        <div class="section-head"><h2>Software Inventory</h2><span class="subtle">Installed Environment Modules, scanned nightly via module -t avail</span></div>
        ${softwareInventorySummaryCards(asObject(softwareInventory.summary), allModules)}
      </section>
      ${administratorDashboardSection(softwareInventory.knowledgeSummary)}
      ${softwareHealthSection(softwareInventory.knowledgeSummary)}
      <section class="section">
        <div class="section-head"><h2>Search &amp; Filter</h2><span class="subtle">${fmt(filtered.length)} of ${fmt(allModules.length)} modules</span></div>
        ${quickFilterBar(filters.quickFilter)}
        <div class="table-toolbar">
          <input type="search" class="search" data-action="search-software-inventory" placeholder="Search name, version, description, or path..." value="${escapeHtml(filters.search)}" />
        </div>
        <div class="table-card">${softwareInventorySortableTable(pageRows)}</div>
        ${softwareInventoryPagination(page, totalPages, filtered.length)}
      </section>
    </div>`;
}

// Related Versions (Software Intelligence Milestone 2): looks up the
// module's family in softwareInventory.moduleFamilies, keyed by exact
// module_name - the same unambiguous boundary Environment Modules itself
// uses (python/python2/python-newick are three distinct families, never
// merged - see export_software_inventory.py's build_module_families()).
// Displayed newest-first for quick scanning (the family object itself
// stores versions ascending, by version_sort_key(), for Version Timeline
// use elsewhere); the current module's own version is highlighted and not
// a link. Returns '' (renders nothing) when the family has only this one
// version - a module with no siblings has nothing to relate.
function relatedVersionsSection(module, family) {
  if (!family || family.versions.length <= 1) return '';
  const newestFirst = family.versions.slice().reverse();
  const items = newestFirst.map((v) => {
    const isCurrent = v.modulefilePath === module.modulefilePath;
    const isDefault = family.defaultVersion != null && v.version === family.defaultVersion;
    const suffix = [isCurrent ? 'current' : null, isDefault ? 'default' : null].filter(Boolean).join(', ');
    const label = `${escapeHtml(v.version)}${suffix ? ` (${suffix})` : ''}`;
    return isCurrent
      ? `<li><strong>${label}</strong></li>`
      : `<li><a href="#/module/${encodeURIComponent(v.modulefilePath)}">${label}</a></li>`;
  }).join('');
  // Version Intelligence (Software Knowledge Milestone 3): Default Version
  // and Latest Installed Version are two different, both real, answers -
  // Default Version is MODULEPATH-priority-scoped (can be lower than the
  // highest installed version, e.g. gcc - see
  // SOFTWARE_KNOWLEDGE_ARCHITECTURE.md); Latest Installed Version is
  // simply the highest by version_sort_key(). Both stats are skipped
  // individually when null, never shown as a guess.
  const versionStats = [
    family.defaultVersion
      ? statBlock('Default Version', escapeHtml(family.defaultVersion), 'Resolved by a bare `module load ' + escapeHtml(module.moduleName) + '`, no version given')
      : null,
    family.latestInstalledVersion
      ? statBlock('Latest Installed Version', escapeHtml(family.latestInstalledVersion), 'Highest version currently installed, any MODULEPATH root')
      : null,
  ].filter(Boolean);
  const statsBlock = versionStats.length ? `<div class="cards-grid">${versionStats.join('')}</div>` : '';
  return `<section class="section">
    <div class="section-head"><h2>Related Versions</h2><span class="subtle">${escapeHtml(module.moduleName)} - ${fmt(family.versions.length)} installed version(s)</span></div>
    ${statsBlock}
    <ul class="version-list">${items}</ul>
  </section>`;
}

// Knowledge (Software Knowledge Milestone 3): license/language/maintainer/
// provenance - the deterministic facts collect_module_knowledge.py found
// for this module's exact module_name, or '' if nothing was ever found
// (knowledgeSource is null) so no empty section/table renders for the
// large fraction of modules with no exact registry match (e.g. compiled
// tools with no PyPI/CRAN/conda package at all).
function knowledgeSection(knowledge) {
  if (!knowledge || !knowledge.knowledgeSource) return '';
  const rows = [
    knowledge.programmingLanguage ? ['Programming Language', escapeHtml(knowledge.programmingLanguage)] : null,
    knowledge.license ? ['License', escapeHtml(knowledge.license)] : null,
    knowledge.maintainer ? ['Maintainer', escapeHtml(knowledge.maintainer)] : null,
    ['Knowledge Source', escapeHtml(knowledge.knowledgeSource) + (knowledge.confidence ? ` (${escapeHtml(knowledge.confidence)} match)` : '')],
    knowledge.lastCheckedAt ? ['Last Checked', formatLocalDateTime(knowledge.lastCheckedAt, '-')] : null,
  ].filter(Boolean);
  if (!rows.length) return '';
  return `<section class="section"><div class="section-head"><h2>Knowledge</h2><span class="subtle">Deterministic facts only - no AI, no web summarization</span></div>${tableFromRows(['Field', 'Value'], rows)}</section>`;
}

// Project Links (Milestone 3): every URL field is rendered as a real link,
// never just displayed as text - this section returns '' entirely when no
// link field is present, rather than a table of dashes.
function projectLinksSection(knowledge) {
  if (!knowledge) return '';
  const link = (url) => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`;
  const rows = [
    knowledge.homepage ? ['Homepage', link(knowledge.homepage)] : null,
    knowledge.documentationUrl ? ['Documentation', link(knowledge.documentationUrl)] : null,
    knowledge.sourceRepositoryUrl ? ['Source Repository', link(knowledge.sourceRepositoryUrl)] : null,
    knowledge.githubRepositoryUrl ? ['GitHub', link(knowledge.githubRepositoryUrl)] : null,
    knowledge.gitlabRepositoryUrl ? ['GitLab', link(knowledge.gitlabRepositoryUrl)] : null,
  ].filter(Boolean);
  if (!rows.length) return '';
  return `<section class="section"><div class="section-head"><h2>Project Links</h2></div>${tableFromRows(['Field', 'Link'], rows)}</section>`;
}

// Release Information (Milestone 3, Version Intelligence): combines
// module_families (installed-side) with module_knowledge (upstream-side).
// Update Available is rendered as a pill only when the exporter could
// actually determine it (updateAvailable is true/false, never when null -
// see export_software_inventory.py's build_module_knowledge() for why
// that field is sometimes deliberately unknown rather than guessed).
function releaseInformationSection(family, knowledge) {
  const rows = [
    family?.latestInstalledVersion ? ['Latest Installed Version', escapeHtml(family.latestInstalledVersion)] : null,
    family?.defaultVersion ? ['Default Version', escapeHtml(family.defaultVersion)] : null,
    knowledge?.upstreamVersion ? ['Latest Upstream Version', escapeHtml(knowledge.upstreamVersion)] : null,
    knowledge && knowledge.updateAvailable !== null && knowledge.updateAvailable !== undefined
      ? ['Update Available', knowledge.updateAvailable
          ? '<span class="pill warn">Yes</span>'
          : '<span class="pill good">No - up to date</span>']
      : null,
    knowledge?.releaseDate ? ['Release Date', formatLocalDateTime(knowledge.releaseDate, '-')] : null,
    knowledge?.changelogUrl ? ['Changelog', `<a href="${escapeHtml(knowledge.changelogUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(knowledge.changelogUrl)}</a>`] : null,
  ].filter(Boolean);
  if (!rows.length) return '';
  return `<section class="section"><div class="section-head"><h2>Release Information</h2></div>${tableFromRows(['Field', 'Value'], rows)}</section>`;
}

// Citation (Milestone 3): citation_info is not populated by any of the
// four current collectors (none expose a clean structured citation field -
// see SOFTWARE_KNOWLEDGE_ARCHITECTURE.md) - this section exists so a
// future collector that does populate it (e.g. a CRAN CITATION-file
// parser) needs zero frontend changes, but renders nothing today.
function citationSection(knowledge) {
  if (!knowledge || !knowledge.citationInfo) return '';
  return `<section class="section"><div class="section-head"><h2>Citation</h2></div><p style="line-height:1.7">${escapeHtml(knowledge.citationInfo)}</p></section>`;
}

// Related Software (Milestone 3): deterministic, exact-shared-identity
// grouping computed server-side (compute_related_software() - shared
// repository or homepage, never keywords/fuzzy matching). Each related
// name is resolved to a real link via its own family's default (or first)
// version - relatedSoftware/moduleFamilies are both keyed by module_name,
// so no new lookup structure is needed here.
// Software Collections (Software Explorer Milestone 4, Part 6): each
// related module_name renders as a small card carrying the same
// already-exported metadata the rest of this page already reads
// (installed/latest version from moduleFamilies, update-available/
// knowledge-available from moduleKnowledge) - no new fields, no new
// computation, just a richer presentation of data this page already has
// in hand. The whole card is one <a> (Part 10's "clickable related
// software"). Laid out as a plain CSS grid of fixed-shape cards
// specifically so a future milestone can add one more row inside a card
// (e.g. a usage-statistics line) without restructuring the grid itself -
// the brief's explicit "design so future usage statistics can be added
// without redesign."
function relatedSoftwareSection(module, relatedNames, moduleFamilies, moduleKnowledgeByName) {
  if (!relatedNames || !relatedNames.length) return '';
  const cards = relatedNames.map((name) => {
    const family = asObject(moduleFamilies)[name];
    const knowledge = asObject(moduleKnowledgeByName)[name] || null;
    const path = family?.defaultModulefilePath || family?.versions?.[0]?.modulefilePath;
    const rows = [
      family?.latestInstalledVersion ? `Latest: ${escapeHtml(family.latestInstalledVersion)}` : null,
      knowledge?.updateAvailable === true ? '<span class="pill warn">Update Available</span>' : null,
      knowledge?.knowledgeSource ? '<span class="pill info">Knowledge Available</span>' : null,
    ].filter(Boolean).map((row) => `<div class="subtle">${row}</div>`).join('');
    const inner = `<div class="name">${escapeHtml(name)}</div>${rows}`;
    return path
      ? `<a class="related-software-card" href="#/module/${encodeURIComponent(path)}">${inner}</a>`
      : `<div class="related-software-card">${inner}</div>`;
  }).join('');
  return `<section class="section">
    <div class="section-head"><h2>Related Software</h2><span class="subtle">Shares a repository or homepage with ${escapeHtml(module.moduleName)}</span></div>
    <div class="related-software-grid">${cards}</div>
  </section>`;
}

// Technical Details (renamed from "Location" in Milestone 2): a plain
// [label, value] row list rather than a hardcoded two-cell table body, so
// a future milestone can append a row (Module Family, Hidden Module,
// Dependencies, Aliases, ...) without restructuring this section - see
// SOFTWARE_INVENTORY_ARCHITECTURE.md's "Milestone 2: version relationships"
// for why only Modulefile Path/MODULEPATH Root are populated today; every
// other field named in the brief is intentionally not invented yet.
function technicalDetailsRows(module) {
  return [
    ['Modulefile Path', `<code>${escapeHtml(module.modulefilePath)}</code>`],
    ['MODULEPATH Root', `<code>${escapeHtml(module.modulepathRoot || modulePathRoot(module.modulefilePath))}</code>`],
  ];
}

// Intentionally no "module help" / "module show" section below: those
// fields exist in the database (mjolnir_analytics_db.py's module_catalog)
// but export_software_inventory.py deliberately does not publish them (raw
// admin-debug text, not dashboard payload - see
// SOFTWARE_INVENTORY_ARCHITECTURE.md). This page must not invent fields the
// export does not provide. A future milestone that changes the exporter's
// contract can add another <section> here (e.g. between "Description" and
// "Technical Details") without touching anything else on this page - same
// reason no empty placeholder is rendered for AI enrichment, license,
// homepage, etc.
function moduleDetailPage(modulefilePath) {
  if (!softwareInventory || !softwareInventory.available) return `<div class="stack">${softwareInventoryUnavailable()}</div>`;
  const module = asArray(softwareInventory.modules).find((m) => m.modulefilePath === modulefilePath);
  if (!module) {
    return `<div class="stack"><section class="section"><div class="section-head"><h2>Module not found</h2><span class="pill warn">Unknown module</span></div><div class="empty-state">No module_catalog record matches this path. <a href="#/software-inventory">Back to Software Inventory</a></div></section></div>`;
  }
  const family = asObject(softwareInventory.moduleFamilies)[module.moduleName];
  const knowledge = asObject(softwareInventory.moduleKnowledge)[module.moduleName] || null;
  const relatedNames = asObject(softwareInventory.relatedSoftware)[module.moduleName];
  // Better Descriptions (Software Explorer Milestone 4, Part 4): renders
  // module.displayDescription (the exporter's own precedence - registry
  // description -> whatis -> help -> none), never recomputes the
  // precedence here. The original `module whatis` text remains visible as
  // a labelled secondary line whenever it differs from what's actually
  // displayed - the brief's "original module whatis should remain stored
  // for provenance" requirement, made visible rather than just retained
  // in the data.
  const descriptionSource = knowledge?.registryDescription && knowledge.registryDescription === module.displayDescription
    ? `registry description via ${knowledge.knowledgeSource}`
    : (module.displayDescription === module.whatisText ? 'module whatis' : 'module help');
  const showWhatisProvenance = module.whatisText && module.displayDescription !== module.whatisText;
  return `
    <div class="stack">
      <p class="breadcrumb"><a href="#/software-inventory">Software Inventory</a> &rsaquo; ${escapeHtml(module.moduleName)}</p>
      ${softwareInventoryStatusBar()}
      <section class="section">
        <div class="section-head"><h2>${escapeHtml(module.moduleName)} / ${escapeHtml(module.moduleVersion)}</h2>${softwareStatusBadges(module, knowledge, family)}</div>
        ${module.removedAt ? disclaimer(`No longer present in the most recent nightly module -t avail scan. Removed: ${formatLocalDateTime(module.removedAt, '-')}.`) : ''}
        <div class="cards-grid">${[
          statBlock('First Seen', formatLocalDateTime(module.firstSeen, '-'), 'First nightly scan that found this modulefile'),
          statBlock('Last Seen', formatLocalDateTime(module.lastSeen, '-'), 'Most recent nightly scan that found it'),
        ].join('')}</div>
      </section>
      <section class="section"><div class="section-head"><h2>Description</h2><span class="subtle">${escapeHtml(descriptionSource)}</span></div>
        ${module.displayDescription ? `<p style="line-height:1.7">${escapeHtml(module.displayDescription)}</p>` : '<div class="empty-state">No description is available from any source for this modulefile.</div>'}
        ${showWhatisProvenance ? `<p class="subtle" style="margin-top:10px">Original <code>module whatis</code>: ${escapeHtml(module.whatisText)}</p>` : ''}
      </section>
      ${relatedVersionsSection(module, family)}
      <section class="section"><div class="section-head"><h2>Technical Details</h2></div>${tableFromRows(['Field', 'Value'], technicalDetailsRows(module))}</section>
      ${knowledgeSection(knowledge)}
      ${projectLinksSection(knowledge)}
      ${releaseInformationSection(family, knowledge)}
      ${citationSection(knowledge)}
      ${relatedSoftwareSection(module, relatedNames, softwareInventory.moduleFamilies, softwareInventory.moduleKnowledge)}
      <p class="subtle"><a href="#/software-inventory">&larr; Back to Software Inventory</a></p>
    </div>`;
}

// ============================================================================
// Software Intelligence (private repo's docs/architecture/
// SOFTWARE_INTELLIGENCE_ARCHITECTURE.md) - "what software is actually being
// used," complementing Software Inventory above ("what software exists").
// The export is documented as the complete public API for this module (no
// server-side Top-N truncation anywhere) - every list-rendering page below
// sorts/paginates/limits-for-display purely client-side over an
// already-loaded array, the same posture Software Inventory's table uses.
// ============================================================================

// Two distinct empty states, per the brief: a true "data has not been
// published yet" failure (file missing/unparseable, or collectorStatus
// explicitly 'failed') vs. an operational-but-empty state (the collector
// ran fine, there is simply no usage data ingested yet - expected and
// healthy before a Slurm Prolog exists). Every page calls this first and
// renders whatever it returns instead of its own content when non-null.
function softwareIntelligenceUnavailable() {
  return `<div class="empty-state">Software Intelligence data has not been published yet (or the file failed to load/parse). See docs/architecture/SOFTWARE_INTELLIGENCE_ARCHITECTURE.md in the private repo.</div>`;
}

function softwareIntelligenceWaitingForData() {
  return `<div class="empty-state">Software Intelligence is operational. Waiting for usage data. The importer, materializer, and export run nightly - this view will populate automatically once a Slurm Prolog (or the sample generator) starts dropping per-job usage records.</div>`;
}

function softwareIntelligenceGuard() {
  if (!softwareIntelligence || !softwareIntelligence.available) {
    return `<div class="stack">${softwareIntelligenceUnavailable()}</div>`;
  }
  if (!softwareIntelligence.overview.totalJobsIngested) {
    return `<div class="stack">${softwareIntelligenceStatusBar()}${softwareIntelligenceWaitingForData()}</div>`;
  }
  return null;
}

// Richer than the standard 4-row statusBar() - every operational metric
// overview.collectorStats actually carries, declared as a [label, key]
// list so a future additional metric the backend starts exposing needs no
// change here beyond one more row.
const COLLECTOR_STATS_ROWS = [
  ['Files Discovered', 'filesDiscovered'],
  ['Files Processed', 'filesProcessed'],
  ['Files Invalid', 'filesInvalid'],
  ['Files Failed', 'filesFailed'],
  ['Jobs Imported', 'jobsImported'],
];
function softwareIntelligenceHealthPanel() {
  const stats = asObject(softwareIntelligence?.overview?.collectorStats);
  const rows = COLLECTOR_STATS_ROWS
    .filter(([, key]) => stats[key] !== null && stats[key] !== undefined)
    .map(([label, key]) => [label, fmt(stats[key])]);
  rows.push(['Last Import', formatLocalDateTime(stats.lastImportAt, 'Never')]);
  rows.push(['Last Materialized', formatLocalDateTime(stats.lastMaterializedAt, 'Never')]);
  rows.push(['Drop Zone Status', stats.dropZoneHasData
    ? '<span class="pill good">Receiving data</span>'
    : '<span class="pill info">Waiting for usage data</span>']);
  return `<section class="section">
    <div class="section-head"><h2>Software Intelligence Health</h2><span class="subtle">Operational detail behind the collector status above</span></div>
    ${tableFromRows(['Metric', 'Value'], rows)}
  </section>`;
}

function trendBadge(direction) {
  const tones = { up: ['good', '&#8593; Up'], down: ['bad', '&#8595; Down'], flat: ['muted', '&#8594; Flat'] };
  const [tone, label] = tones[direction] || tones.flat;
  return `<span class="pill ${tone}">${label}</span>`;
}

function softwareIntelligenceModuleLink(moduleName) {
  return `<a href="#/si-module/${encodeURIComponent(moduleName)}">${escapeHtml(moduleName)}</a>`;
}

// --- Overview ---------------------------------------------------------------

function softwareIntelligenceOverviewPage() {
  const guard = softwareIntelligenceGuard();
  if (guard) return guard;
  const o = softwareIntelligence.overview;
  const allTime = asArray(softwareIntelligence.topModules.all_time);
  const top10 = allTime.slice(0, 10);
  const growing = asArray(softwareIntelligence.growthDecline.growing).slice(0, 5);
  const declining = asArray(softwareIntelligence.growthDecline.declining).slice(0, 5);
  // createLineChart() reads each row's report_date/timestamp field for its
  // x-axis categories - the normalized dailyUsage shape uses `date`, so
  // rows are remapped here rather than changing that normalization (other
  // callers read `.date` directly, e.g. buildWeeklyUsage() below).
  const recentDays = asArray(softwareIntelligence.dailyUsage).slice(-30).map((r) => ({ report_date: r.date, jobs: r.jobs }));

  const topChart = createBarChart(
    top10.map((m) => m.moduleName),
    top10.map((m) => m.jobs),
    (v) => fmt(v),
    { horizontal: true, label: 'Top 10 modules by jobs', csv: true },
  );
  const activityChart = createLineChart(
    'Recent Activity (last 30 days)',
    recentDays,
    [{ label: 'Jobs', color: 'var(--blue)', values: recentDays.map((r) => r.jobs) }],
    (v) => fmt(v),
    { label: 'Software Intelligence recent activity', csv: true },
  );

  const growthList = (entries, emptyMessage) => (entries.length
    ? `<ul class="version-list">${entries.map((e) => `<li>${softwareIntelligenceModuleLink(e.moduleName)} <span class="subtle">${pct((e.changePct ?? 0) / 100, 1)}</span></li>`).join('')}</ul>`
    : `<div class="empty-state">${emptyMessage}</div>`);

  return `
    <div class="stack">
      ${softwareIntelligenceStatusBar()}
      ${softwareIntelligenceHealthPanel()}
      <section class="section">
        <div class="section-head"><h2>Software Intelligence Overview</h2><span class="subtle">Usage analytics derived from per-job module-load records</span></div>
        <div class="cards-grid">${[
          statBlock('Total Jobs Analysed', fmt(o.totalJobsIngested), 'Jobs ingested into software_usage_raw'),
          statBlock('Distinct Software Packages', fmt(o.distinctModules), 'Unique module names observed'),
          statBlock('Distinct Versions', fmt(o.distinctModuleVersions), 'Unique name/version pairs observed'),
          statBlock('Unique Users', fmt(o.uniqueUsers), 'Count only - no usernames ever published'),
          statBlock('Unique Accounts', fmt(o.uniqueAccounts), 'Count only - see Top Software by Account'),
          statBlock('Total CPU Hours', fmt(o.totalCpuHours), 'Summed across all ingested jobs'),
          statBlock('Date Range', `${o.dateRange.firstDate || '-'} &rarr; ${o.dateRange.lastDate || '-'}`, 'Coverage of software_usage_daily'),
        ].join('')}</div>
      </section>
      <section class="section">
        <div class="section-head"><h2>Top 10 Software</h2><span class="subtle">By job count, all time</span></div>
        ${typeof topChart === 'string' ? topChart : topChart.html}
      </section>
      <div class="cards-grid">
        <section class="section"><div class="section-head"><h2>Fastest Growing</h2><span class="subtle">Trailing 30d vs prior 30d</span></div>${growthList(growing, 'No module shows growth over the trailing 30 days yet.')}</section>
        <section class="section"><div class="section-head"><h2>Fastest Declining</h2><span class="subtle">Trailing 30d vs prior 30d</span></div>${growthList(declining, 'No module shows decline over the trailing 30 days yet.')}</section>
      </div>
      <section class="section">
        <div class="section-head"><h2>Recent Activity</h2></div>
        ${typeof activityChart === 'string' ? activityChart : activityChart.html}
      </section>
    </div>`;
}

// --- Most Used Software -----------------------------------------------------

const SOFTWARE_INTELLIGENCE_PAGE_SIZE = 50;

function softwareIntelligenceTrendForModule(moduleName) {
  const entry = asArray(softwareIntelligence?.trending?.modules).find((m) => m.moduleName === moduleName);
  return entry ? entry.trendDirection : 'flat';
}

function softwareIntelligenceFilteredModules() {
  const filters = state.softwareIntelligenceFilters;
  const all = asArray(softwareIntelligence?.topModules?.all_time);
  const term = filters.search.trim().toLowerCase();
  const filtered = term ? all.filter((m) => m.moduleName.toLowerCase().includes(term)) : all.slice();
  const dir = filters.sortDir === 'desc' ? -1 : 1;
  filtered.sort((a, b) => {
    const av = a[filters.sortKey];
    const bv = b[filters.sortKey];
    if (typeof av === 'number' && typeof bv === 'number') return dir * (av - bv);
    return dir * String(av || '').localeCompare(String(bv || ''));
  });
  return filtered;
}

function softwareIntelligenceMostUsedTable(rows) {
  const filters = state.softwareIntelligenceFilters;
  const columns = [
    ['Module', 'moduleName'], ['Jobs', 'jobs'], ['Users', 'uniqueUsers'], ['CPU Hours', 'cpuHours'],
    ['First Seen', 'firstSeen'], ['Last Seen', 'lastSeen'], ['Trend', null],
  ];
  const headers = columns.map(([label, key]) => {
    if (!key) return `<th>${escapeHtml(label)}</th>`;
    const active = key === filters.sortKey;
    const arrow = active ? (filters.sortDir === 'desc' ? ' &darr;' : ' &uarr;') : '';
    return `<th><button type="button" class="sort-button" data-action="sort-software-intelligence" data-key="${key}">${escapeHtml(label)}${arrow}</button></th>`;
  }).join('');
  const body = rows.length
    ? rows.map((m) => `<tr>
        <td>${softwareIntelligenceModuleLink(m.moduleName)}</td>
        <td>${fmt(m.jobs)}</td>
        <td>${fmt(m.uniqueUsers)}</td>
        <td>${fmt(m.cpuHours)}</td>
        <td>${formatLocalDateTime(m.firstSeen, '-')}</td>
        <td>${formatLocalDateTime(m.lastSeen, '-')}</td>
        <td>${trendBadge(softwareIntelligenceTrendForModule(m.moduleName))}</td>
      </tr>`).join('')
    : `<tr><td colspan="${columns.length}">No modules match the current search.</td></tr>`;
  return `<table><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table>`;
}

function softwareIntelligencePagination(page, totalPages, totalCount) {
  if (totalPages <= 1) return '';
  return `<div class="pagination">
    <button type="button" class="btn" data-action="page-software-intelligence" data-direction="prev" ${page <= 1 ? 'disabled' : ''}>&larr; Prev</button>
    <span class="subtle">Page ${page} of ${totalPages} (${fmt(totalCount)} modules)</span>
    <button type="button" class="btn" data-action="page-software-intelligence" data-direction="next" ${page >= totalPages ? 'disabled' : ''}>Next &rarr;</button>
  </div>`;
}

function softwareIntelligenceMostUsedPage() {
  const guard = softwareIntelligenceGuard();
  if (guard) return guard;
  const filters = state.softwareIntelligenceFilters;
  const filtered = softwareIntelligenceFilteredModules();
  const totalPages = Math.max(1, Math.ceil(filtered.length / SOFTWARE_INTELLIGENCE_PAGE_SIZE));
  const page = Math.min(Math.max(1, filters.page), totalPages);
  const pageRows = filtered.slice((page - 1) * SOFTWARE_INTELLIGENCE_PAGE_SIZE, page * SOFTWARE_INTELLIGENCE_PAGE_SIZE);
  return `
    <div class="stack">
      ${softwareIntelligenceStatusBar()}
      <section class="section">
        <div class="section-head"><h2>Most Used Software</h2><span class="subtle">${fmt(filtered.length)} of ${fmt(softwareIntelligence.topModules.all_time.length)} modules</span></div>
        <div class="table-toolbar">
          <input type="search" class="search" data-action="search-software-intelligence" placeholder="Search module name..." value="${escapeHtml(filters.search)}" />
        </div>
        <div class="table-card">${softwareIntelligenceMostUsedTable(pageRows)}</div>
        ${softwareIntelligencePagination(page, totalPages, filtered.length)}
      </section>
    </div>`;
}

// --- Trending -----------------------------------------------------------

const TRENDING_WINDOWS = [
  { id: '7d', label: '7 Day', key: 'changeVsWeekAvgPct' },
  { id: '30d', label: '30 Day', key: 'changeVsMonthAvgPct' },
  { id: 'all-time', label: 'All Time', key: null },
];

function trendingBucket(module, windowId) {
  if (windowId === 'all-time') return module.trendDirection;
  const window = TRENDING_WINDOWS.find((w) => w.id === windowId);
  const value = module[window.key];
  if (value === null || value === undefined) return 'flat';
  if (value > 10) return 'up';
  if (value < -10) return 'down';
  return 'flat';
}

function trendingModuleRow(m) {
  return `<li>${softwareIntelligenceModuleLink(m.moduleName)} <span class="subtle">${fmt(m.jobsToday)} jobs today &middot; 7d avg ${fmt(m.avgJobsPerDayLast7d, 1)} &middot; 30d avg ${fmt(m.avgJobsPerDayLast30d, 1)}</span></li>`;
}

function softwareIntelligenceTrendingPage() {
  const guard = softwareIntelligenceGuard();
  if (guard) return guard;
  const windowId = state.softwareIntelligenceTrendingWindow;
  const modules = asArray(softwareIntelligence.trending.modules);
  const buckets = { up: [], down: [], flat: [] };
  modules.forEach((m) => buckets[trendingBucket(m, windowId)].push(m));

  const recentDays = asArray(softwareIntelligence.dailyUsage).slice(-60).map((r) => ({ report_date: r.date, jobs: r.jobs }));
  const contextChart = createLineChart(
    'Cluster-wide Daily Jobs (last 60 days)',
    recentDays,
    [{ label: 'Jobs', color: 'var(--blue)', values: recentDays.map((r) => r.jobs) }],
    (v) => fmt(v),
    { label: 'Software Intelligence cluster activity context', csv: true },
  );

  const windowButtons = TRENDING_WINDOWS.map((w) => `<button type="button" class="quick-filter-button" data-action="set-trending-window" data-window="${w.id}" aria-pressed="${windowId === w.id}">${w.label}</button>`).join('');

  const section = (title, tone, list) => `<section class="section">
    <div class="section-head"><h2><span class="pill ${tone}">${list.length}</span> ${title}</h2></div>
    ${list.length ? `<ul class="version-list">${list.map(trendingModuleRow).join('')}</ul>` : '<div class="empty-state">No modules in this category for the selected window.</div>'}
  </section>`;

  return `
    <div class="stack">
      ${softwareIntelligenceStatusBar()}
      <section class="section">
        <div class="section-head"><h2>Trending</h2><span class="subtle">As of ${softwareIntelligence.trending.asOf || '-'}</span></div>
        <div class="quick-filter-bar" role="group" aria-label="Trending window">${windowButtons}</div>
      </section>
      <section class="section">${typeof contextChart === 'string' ? contextChart : contextChart.html}</section>
      ${section('Trending Up', 'good', buckets.up)}
      ${section('Trending Down', 'bad', buckets.down)}
      ${section('Stable', 'muted', buckets.flat)}
    </div>`;
}

// --- Version Adoption ---------------------------------------------------

function versionAdoptionRow(moduleName, info) {
  const versions = asArray(info.versions);
  const totalJobs = versions.reduce((sum, v) => sum + (v.jobs || 0), 0);
  const chart = createBarChart(
    versions.map((v) => v.moduleVersion),
    versions.map((v) => v.jobs),
    (v) => fmt(v),
    { horizontal: true, height: Math.max(120, versions.length * 32), label: `${moduleName} version distribution`, csv: true },
  );
  const rows = versions.map((v) => [
    v.moduleVersion,
    fmt(v.jobs),
    fmt(v.users),
    totalJobs ? pct(v.jobs / totalJobs, 1) : '-',
    formatLocalDateTime(v.firstSeen, '-'),
    formatLocalDateTime(v.lastSeen, '-'),
  ]);
  return `<section class="section">
    <div class="section-head"><h2>${softwareIntelligenceModuleLink(moduleName)}</h2><span class="subtle">Latest: ${escapeHtml(info.latestVersion || '-')} &middot; Most used: ${escapeHtml(info.mostUsedVersion || '-')}</span></div>
    ${typeof chart === 'string' ? chart : chart.html}
    ${tableFromRows(['Version', 'Jobs', 'Users', 'Adoption %', 'First Seen', 'Last Seen'], rows)}
    <p class="subtle"><a href="#/si-module/${encodeURIComponent(moduleName)}">View migration over time &rarr;</a></p>
  </section>`;
}

function softwareIntelligenceVersionsPage() {
  const guard = softwareIntelligenceGuard();
  if (guard) return guard;
  const entries = Object.entries(asObject(softwareIntelligence.versions)).sort(([a], [b]) => a.localeCompare(b));
  return `
    <div class="stack">
      ${softwareIntelligenceStatusBar()}
      <section class="section">
        <div class="section-head"><h2>Version Adoption</h2><span class="subtle">${fmt(entries.length)} module(s) with version history</span></div>
      </section>
      ${entries.length ? entries.map(([name, info]) => versionAdoptionRow(name, info)).join('') : '<div class="empty-state">No version data available yet.</div>'}
    </div>`;
}

// --- Relationships ---------------------------------------------------------

function relationshipStrengthLabel(lift) {
  if (lift === null || lift === undefined) return '<span class="pill muted">Unknown</span>';
  if (lift > 1.5) return '<span class="pill good">Strong</span>';
  if (lift > 1) return '<span class="pill info">Moderate</span>';
  return '<span class="pill muted">Weak</span>';
}

function softwareIntelligenceRelationshipsPage(presetModule) {
  const guard = softwareIntelligenceGuard();
  if (guard) return guard;
  const moduleNames = Object.keys(asObject(softwareIntelligence.versions)).sort();
  if (!moduleNames.length) {
    return `<div class="stack">${softwareIntelligenceStatusBar()}<div class="empty-state">No modules available to explore relationships for yet.</div></div>`;
  }
  const allTimeByJobs = asArray(softwareIntelligence.topModules.all_time);
  const defaultModule = allTimeByJobs.length ? allTimeByJobs[0].moduleName : moduleNames[0];
  const selected = (presetModule && moduleNames.includes(presetModule))
    ? presetModule
    : (moduleNames.includes(state.softwareIntelligenceRelationshipsModule) ? state.softwareIntelligenceRelationshipsModule : defaultModule);
  state.softwareIntelligenceRelationshipsModule = selected;

  const related = asArray(asObject(softwareIntelligence.relationships)[selected]);
  const options = moduleNames.map((name) => `<option value="${escapeHtml(name)}" ${name === selected ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('');
  const rows = related.length
    ? related.map((r) => `<tr>
        <td>${softwareIntelligenceModuleLink(r.module)}</td>
        <td>${fmt(r.count)}</td>
        <td>${r.confidence === null ? '-' : pct(r.confidence, 1)}</td>
        <td>${relationshipStrengthLabel(r.lift)}</td>
      </tr>`).join('')
    : `<tr><td colspan="4">No co-occurring modules recorded for ${escapeHtml(selected)} yet.</td></tr>`;

  return `
    <div class="stack">
      ${softwareIntelligenceStatusBar()}
      <section class="section">
        <div class="section-head"><h2>Relationships</h2><span class="subtle">Users who use this module also use...</span></div>
        <div class="table-toolbar">
          <select data-action="set-relationship-module" aria-label="Select module">${options}</select>
        </div>
        <div class="table-card"><table><thead><tr><th>Module</th><th>Observed Together</th><th>Confidence</th><th>Strength</th></tr></thead><tbody>${rows}</tbody></table></div>
      </section>
    </div>`;
}

// --- Timeline ---------------------------------------------------------

function isoWeekKey(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateStr;
  const target = new Date(d.getTime());
  target.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((target - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function buildWeeklyUsage(dailyUsage) {
  const byWeek = new Map();
  asArray(dailyUsage).forEach((row) => {
    const key = isoWeekKey(row.date);
    const existing = byWeek.get(key) || { week: key, jobs: 0, cpuHours: 0 };
    existing.jobs += row.jobs || 0;
    existing.cpuHours += row.cpuHours || 0;
    byWeek.set(key, existing);
  });
  return Array.from(byWeek.values()).sort((a, b) => a.week.localeCompare(b.week));
}

const TIMELINE_GRANULARITIES = ['daily', 'weekly', 'monthly'];

function softwareIntelligenceTimelinePage() {
  const guard = softwareIntelligenceGuard();
  if (guard) return guard;
  const moduleNames = Object.keys(asObject(softwareIntelligence.versions)).sort();
  const selectedModule = state.softwareIntelligenceTimelineModule;
  const granularity = state.softwareIntelligenceTimelineGranularity;

  let series;
  let categories;
  if (selectedModule === 'all') {
    if (granularity === 'monthly') {
      const rows = asArray(softwareIntelligence.monthlyUsage);
      categories = rows.map((r) => r.month);
      series = rows.map((r) => r.jobs);
    } else if (granularity === 'weekly') {
      const rows = buildWeeklyUsage(softwareIntelligence.dailyUsage);
      categories = rows.map((r) => r.week);
      series = rows.map((r) => r.jobs);
    } else {
      const rows = asArray(softwareIntelligence.dailyUsage);
      categories = rows.map((r) => r.date);
      series = rows.map((r) => r.jobs);
    }
  } else {
    requestSoftwareIntelligenceModuleDetail(selectedModule);
    const detail = softwareIntelligenceModuleCache.get(selectedModule);
    if (!detail) {
      categories = [];
      series = [];
    } else if (granularity === 'monthly' || granularity === 'weekly') {
      const rows = granularity === 'weekly' ? buildWeeklyUsage(detail.dailyHistory) : (() => {
        const byMonth = new Map();
        detail.dailyHistory.forEach((r) => {
          const key = String(r.date || '').slice(0, 7);
          const existing = byMonth.get(key) || { month: key, jobs: 0 };
          existing.jobs += r.jobs || 0;
          byMonth.set(key, existing);
        });
        return Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month));
      })();
      categories = rows.map((r) => r.week || r.month);
      series = rows.map((r) => r.jobs);
    } else {
      categories = detail.dailyHistory.map((r) => r.date);
      series = detail.dailyHistory.map((r) => r.jobs);
    }
  }

  const chartRows = categories.map((c, i) => ({ report_date: c, jobs: series[i] }));
  const chart = createLineChart(
    selectedModule === 'all' ? 'Cluster-wide Usage' : `${selectedModule} Usage`,
    chartRows,
    [{ label: 'Jobs', color: 'var(--blue)', values: series }],
    (v) => fmt(v),
    { label: 'Software Intelligence timeline', csv: true, emptyMessage: selectedModule === 'all' ? undefined : 'Loading module history...' },
  );

  const moduleOptions = [`<option value="all" ${selectedModule === 'all' ? 'selected' : ''}>All Modules</option>`]
    .concat(moduleNames.map((name) => `<option value="${escapeHtml(name)}" ${name === selectedModule ? 'selected' : ''}>${escapeHtml(name)}</option>`))
    .join('');
  const granularityButtons = TIMELINE_GRANULARITIES.map((g) => `<button type="button" class="quick-filter-button" data-action="set-timeline-granularity" data-granularity="${g}" aria-pressed="${granularity === g}">${g.charAt(0).toUpperCase()}${g.slice(1)}</button>`).join('');

  return `
    <div class="stack">
      ${softwareIntelligenceStatusBar()}
      <section class="section">
        <div class="section-head"><h2>Timeline</h2><span class="subtle">Historical usage, daily/weekly/monthly</span></div>
        <div class="table-toolbar">
          <select data-action="set-timeline-module" aria-label="Filter by module">${moduleOptions}</select>
          <div class="quick-filter-bar" role="group" aria-label="Granularity">${granularityButtons}</div>
        </div>
        ${typeof chart === 'string' ? chart : chart.html}
      </section>
    </div>`;
}

// --- Module Detail -----------------------------------------------------

function softwareIntelligenceModuleDetailPage(moduleName) {
  const guard = softwareIntelligenceGuard();
  if (guard) return guard;
  if (!moduleName || !asObject(softwareIntelligence.versions)[moduleName]) {
    return `<div class="stack"><section class="section"><div class="section-head"><h2>Module not found</h2><span class="pill warn">Unknown module</span></div><div class="empty-state">No Software Intelligence usage data matches this module name. <a href="#/si-most-used">Back to Most Used Software</a></div></section></div>`;
  }
  requestSoftwareIntelligenceModuleDetail(moduleName);
  const detail = softwareIntelligenceModuleCache.get(moduleName);
  if (!detail) {
    return `<div class="stack">
      <p class="breadcrumb"><a href="#/si-most-used">Most Used Software</a> &rsaquo; ${escapeHtml(moduleName)}</p>
      ${softwareIntelligenceStatusBar()}
      <section class="section"><div class="section-head"><h2>${escapeHtml(moduleName)}</h2></div><div class="empty-state">Loading module detail...</div></section>
    </div>`;
  }

  const historyRows = detail.dailyHistory.map((r) => ({ report_date: r.date, jobs: r.jobs }));
  const historyChart = createLineChart(
    'Usage History',
    historyRows,
    [{ label: 'Jobs', color: 'var(--blue)', values: historyRows.map((r) => r.jobs) }],
    (v) => fmt(v),
    { label: `${moduleName} usage history`, csv: true },
  );

  const versionNames = Array.from(new Set(detail.versionDailyHistory.map((r) => r.version))).sort();
  const datesSet = Array.from(new Set(detail.versionDailyHistory.map((r) => r.date))).sort();
  const migrationSeries = versionNames.map((version, i) => {
    const byDate = new Map(detail.versionDailyHistory.filter((r) => r.version === version).map((r) => [r.date, r.jobs]));
    const palette = ['var(--blue)', 'var(--teal)', 'var(--amber)', 'var(--green)', 'var(--red)', 'var(--cyan)'];
    return { label: version, color: palette[i % palette.length], values: datesSet.map((d) => byDate.get(d) ?? 0) };
  });
  const migrationChart = createLineChart(
    'Version Migration Over Time',
    datesSet.map((d) => ({ report_date: d })),
    migrationSeries,
    (v) => fmt(v),
    { area: true, label: `${moduleName} version migration`, csv: true, emptyMessage: 'No per-version history recorded yet.' },
  );

  const versionRows = asArray(detail.versionInfo.versions).map((v) => [
    v.moduleVersion, fmt(v.jobs), fmt(v.users), formatLocalDateTime(v.firstSeen, '-'), formatLocalDateTime(v.lastSeen, '-'),
  ]);

  const relatedRows = detail.relatedModules.length
    ? detail.relatedModules.map((r) => `<tr>
        <td>${softwareIntelligenceModuleLink(r.module)}</td>
        <td>${fmt(r.count)}</td>
        <td>${r.confidence === null ? '-' : pct(r.confidence, 1)}</td>
        <td>${relationshipStrengthLabel(r.lift)}</td>
      </tr>`).join('')
    : '<tr><td colspan="4">No related modules recorded yet.</td></tr>';

  // Cross-link to Software Explorer (zero new fetch - softwareInventory is
  // already loaded globally). Software Intelligence only knows module_name;
  // Software Explorer's route key is the modulefile path, looked up via the
  // family the two modules share by name.
  const inventoryFamily = asObject(softwareInventory?.moduleFamilies)[moduleName];
  const inventoryPath = inventoryFamily?.defaultModulefilePath || inventoryFamily?.versions?.[0]?.modulefilePath;
  const explorerLink = inventoryPath
    ? `<p class="subtle"><a href="#/module/${encodeURIComponent(inventoryPath)}">View in Software Inventory (what is this software?) &rarr;</a></p>`
    : '';

  return `
    <div class="stack">
      <p class="breadcrumb"><a href="#/si-most-used">Most Used Software</a> &rsaquo; ${escapeHtml(moduleName)}</p>
      ${softwareIntelligenceStatusBar()}
      <section class="section">
        <div class="section-head"><h2>${escapeHtml(moduleName)}</h2>${trendBadge(detail.trendDirection || 'flat')}</div>
        ${explorerLink}
        <div class="cards-grid">${[
          statBlock('Total Jobs', fmt(detail.totalJobs), 'All-time, this module'),
          statBlock('Total Users', fmt(detail.totalUsers), 'Summed across versions'),
          statBlock('Total CPU Hours', fmt(detail.totalCpuHours), 'All-time, this module'),
          statBlock('Jobs Today', fmt(detail.jobsToday ?? 0), 'Most recent ingested date'),
          statBlock('First Seen', formatLocalDateTime(detail.versionInfo.versions?.[detail.versionInfo.versions.length - 1]?.firstSeen, '-'), 'Earliest version first_seen'),
          statBlock('Last Seen', formatLocalDateTime(detail.versionInfo.versions?.[0]?.lastSeen, '-'), 'Most recent version last_seen'),
        ].join('')}</div>
      </section>
      <section class="section"><div class="section-head"><h2>Usage History</h2></div>${typeof historyChart === 'string' ? historyChart : historyChart.html}</section>
      <section class="section"><div class="section-head"><h2>Version Migration Over Time</h2></div>${typeof migrationChart === 'string' ? migrationChart : migrationChart.html}</section>
      <section class="section">
        <div class="section-head"><h2>Version Timeline</h2><span class="subtle">Latest: ${escapeHtml(detail.versionInfo.latestVersion || '-')} &middot; Most used: ${escapeHtml(detail.versionInfo.mostUsedVersion || '-')}</span></div>
        ${tableFromRows(['Version', 'Jobs', 'Users', 'First Seen', 'Last Seen'], versionRows)}
      </section>
      <section class="section">
        <div class="section-head"><h2>Top Relationships</h2><span class="subtle"><a href="#/si-relationships/${encodeURIComponent(moduleName)}">Open in Relationships explorer &rarr;</a></span></div>
        <div class="table-card"><table><thead><tr><th>Module</th><th>Observed Together</th><th>Confidence</th><th>Strength</th></tr></thead><tbody>${relatedRows}</tbody></table></div>
      </section>
      <p class="subtle"><a href="#/si-most-used">&larr; Back to Most Used Software</a></p>
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

// ============================================================================
// Executive Overview (the landing page) - docs/EXECUTIVE_OVERVIEW.md.
//
// Every section below is presentation over data already loaded by the five
// module loaders in data-loader.js (data, nodeInsights, nodeInsightsHistory,
// platformRegistry/warehouseSummary, queueInsights) - no fetch() calls here,
// and the only new "calculation" on this whole page is clusterHealthState()'s
// max-of-two-already-computed-severities (Section 1). Everything else is a
// reused helper, a sort, or a filter over fields other pages already render.
// ============================================================================

// --- Section 1: Cluster Health ---------------------------------------------
// Combines platformHealth() (Analytics Pipeline + Analytics Warehouse + Node
// Insights + Queue Insights collector freshness, status.js) with the live
// Queue Health label (queueInsights.currentPressure.queue_health) and takes
// whichever is worse, then re-expresses that as the three-word vocabulary
// this hero promises. No new freshness threshold is introduced anywhere in
// this function - it is a pure max() over two values every other page on
// this site already computes and trusts.
const CLUSTER_HEALTH_PLATFORM_SEVERITY = { healthy: 0, warning: 1, degraded: 2, critical: 2, unknown: 1 };
const CLUSTER_HEALTH_QUEUE_SEVERITY = { Healthy: 0, Busy: 0, Congested: 1, 'Severely Congested': 2 };
const CLUSTER_HEALTH_LABELS = ['Healthy', 'Warning', 'Critical'];
const CLUSTER_HEALTH_COPY = [
  { sub: 'All systems operational', tone: 'healthy' },
  { sub: 'Some systems need attention', tone: 'warning' },
  { sub: 'Action required', tone: 'failed' },
];

function clusterHealthState() {
  const platformSeverity = CLUSTER_HEALTH_PLATFORM_SEVERITY[platformHealth(platformRegistry).status] ?? 1;
  const queueLabel = queueInsights?.currentPressure?.queue_health?.label;
  const queueSeverity = queueLabel != null ? (CLUSTER_HEALTH_QUEUE_SEVERITY[queueLabel] ?? 0) : 0;
  const severity = Math.max(platformSeverity, queueSeverity);
  return { severity, label: CLUSTER_HEALTH_LABELS[severity], ...CLUSTER_HEALTH_COPY[severity] };
}

function clusterHealthHero() {
  const s = clusterHealthState();
  return `<section class="cluster-health-hero cluster-health-${s.tone}">
    <div class="cluster-health-label">Cluster Health</div>
    <div class="cluster-health-value">${escapeHtml(s.label)}</div>
    <div class="cluster-health-sub">${escapeHtml(s.sub)}</div>
  </section>`;
}

// --- Section 2: Current Cluster Status (KPI cards) --------------------------
// Queue figures come from Queue Insights (the authoritative live source for
// queue state); fleet figures come from Node Insights' clusterOverview -
// the exact fields infrastructureOverviewPage()/queueOverviewPage() already
// render. "Users Active Today" is intentionally omitted: no collector
// exposes a daily-active-user count anywhere today, and this page never
// approximates a metric that doesn't exist (docs/EXECUTIVE_OVERVIEW.md).
function executiveKpiSection() {
  const cp = asObject(queueInsights?.currentPressure);
  const queue = asObject(cp.queue);
  const co = asObject(nodeInsights?.clusterOverview);
  const totals = asObject(co.totals);
  const cpu = asObject(co.cpu);
  const mem = asObject(co.memory_mib);
  const gpu = asObject(co.gpu);
  const clusterSeries = clusterWaitSeriesRows(asObject(queueInsights?.waitTimeHistory).series);
  const latestWait = clusterSeries.length ? clusterSeries[clusterSeries.length - 1] : null;
  // Read the same pre-computed pressure fields Capacity Planning reads
  // (export_node_insights.py's build_cluster_overview) rather than
  // recomputing alloc/total locally, so the two pages never drift apart -
  // GPU in particular prefers alloc_pct_of_online, excluding offline GPUs
  // from the denominator the same way Capacity Planning does.
  const cpuPct = cpu.alloc_pct ?? null;
  const memPct = mem.alloc_pct ?? null;
  const gpuPct = (gpu.alloc_pct_of_online ?? gpu.alloc_pct) ?? null;

  const cards = [
    statBlock('Running Jobs', fmt(queue.running), 'Across all partitions', 'good'),
    statBlock('Pending Jobs', fmt(queue.pending), 'Waiting to start', num(queue.pending) ? 'info' : 'good'),
    statBlock('Queue Health', cp.queue_health ? escapeHtml(cp.queue_health.label) : '-', cp.queue_health ? `Score ${fmt(cp.queue_health.score)}/100` : 'Unavailable'),
    statBlock('Current Wait Time', durationLabel(latestWait && latestWait.median_wait_seconds), 'Median, cluster-wide'),
    statBlock('Nodes Online', fmt(totals.nodes_available), 'Not draining, not down', 'good'),
    statBlock('Nodes Draining', fmt(totals.nodes_draining), 'Scheduled for maintenance', totals.nodes_draining ? 'warn' : 'good'),
    statBlock('GPUs Busy', gpuPct !== null ? `${fmt(gpu.alloc)} / ${fmt(gpu.total)}` : '-', gpuPct !== null ? pct(gpuPct) : 'Unavailable'),
    statBlock('Cluster CPU Utilization', cpuPct !== null ? pct(cpuPct) : '-', `${fmt(cpu.alloc)} / ${fmt(cpu.total)} cores`),
    statBlock('Cluster Memory Utilization', memPct !== null ? pct(memPct) : '-', `${gib(mem.alloc)} / ${gib(mem.total)}`),
  ];
  return `<section class="section"><div class="section-head"><h2>Current Cluster Status</h2></div><div class="cards-grid">${cards.join('')}</div></section>`;
}

// --- Section 3: Overnight Summary -------------------------------------------
// Reads warehouseSummary.overnight (export_dashboard_data.py's real
// import_files/job_metrics/daily_*_summary deltas - never inferred) plus
// per-module snapshotAgeLabel() and the shared totalSnapshotCount() helper.
// "New X" rows for users/projects/accounts/partitions are hidden when 0 to
// avoid clutter; the three headline deltas always show, including 0, since
// "nothing imported last night" is itself a signal worth surfacing.
function overnightSummarySection() {
  const w = warehouseSummary;
  const o = w.overnight || {};
  const headline = [
    statBlock('New Accounting Records', o.new_accounting_records != null ? humanNumber(o.new_accounting_records) : 'N/A', o.report_date ? `Imported for ${dateLabel(o.report_date)}` : 'No import recorded yet'),
    statBlock('New Job Steps', o.new_job_steps != null ? humanNumber(o.new_job_steps) : 'N/A', 'Step records within those imports'),
    statBlock('New Canonical Jobs', o.new_canonical_jobs != null ? humanNumber(o.new_canonical_jobs) : 'N/A', 'Materialized into the warehouse'),
  ];
  const growthRows = [
    ['New Users', o.new_users], ['New Projects', o.new_projects],
    ['New Accounts', o.new_accounts], ['New Partitions', o.new_partitions],
  ].filter(([, value]) => value != null && value > 0)
    .map(([label, value]) => statBlock(label, humanNumber(value), 'First seen overnight'));
  const freshness = platformRegistry.filter((m) => !m.planned)
    .map((m) => statBlock(m.label, snapshotAgeLabel(m.generatedAt), 'Latest snapshot age'));
  const durations = [
    ['Import Duration', w.lastImportDurationSeconds],
    ['Materialization Duration', w.lastMaterializationDurationSeconds],
    ['Publication Duration', w.lastPublishDurationSeconds],
  ].map(([label, seconds]) => statBlock(label, seconds != null ? durationLabel(seconds) : 'N/A', 'Last nightly run'));

  return `<section class="section"><div class="section-head"><h2>Overnight Summary</h2><span class="subtle">${o.report_date ? `Since ${dateLabel(o.report_date)}` : 'Since the last import'}</span></div>
    <div class="cards-grid">${headline.join('')}</div>
    ${growthRows.length ? `<div class="cards-grid">${growthRows.join('')}</div>` : ''}
    <div class="cards-grid">${durations.join('')}</div>
    <div class="cards-grid">${[
      statBlock('Node Snapshots Collected', fmt(totalSnapshotCount()), 'Total retained history'),
      statBlock('Database Growth', 'N/A', 'No historical size snapshot tracked yet'),
      statBlock('Coverage Change', 'N/A', 'No historical coverage snapshot tracked yet'),
    ].join('')}</div>
    <div class="cards-grid">${freshness.join('')}</div>
  </section>`;
}

// --- Section 4: Warehouse Summary -------------------------------------------
// warehouseStatusCard()/warehouseSummaryTiles() are the same functions the
// dedicated Warehouse page renders - this section never recomputes a number
// they already produce. reductionFunnel() is the one new presentational
// piece (Accounting Records -> Canonical Jobs -> Ratio), built once and
// reusable from the Warehouse page too if useful later.
function reductionFunnel(w) {
  const ratio = w.reductionRatio ? `${(1 / w.reductionRatio).toFixed(2)} : 1` : '-';
  const { html } = createFunnel([
    { name: 'Accounting Records', value: w.accountingRecords },
    { name: 'Canonical Jobs', value: w.canonicalJobs },
  ], { label: 'Warehouse reduction funnel', onClick: '#/warehouse' });
  return `<div class="reduction-funnel">
    <div class="reduction-funnel-chart">${html}</div>
    <div class="reduction-funnel-ratio"><strong>${ratio}</strong><span>Reduction</span></div>
  </div>`;
}

function executiveWarehouseSection() {
  const w = warehouseSummary;
  if (!w.available) {
    return `<section class="section"><div class="section-head"><h2>Warehouse Summary</h2></div>${disclaimer('The Analytics Warehouse pipeline status has not been published yet, or the warehouse has no jobs recorded.')}</section>`;
  }
  return `<div class="stack">
    ${warehouseStatusCard(w)}
    ${reductionFunnel(w)}
    <section class="section"><div class="section-head"><h2>Scope &amp; Versions</h2><a class="btn" href="#/warehouse">Full warehouse detail</a></div>
      <div class="cards-grid">${[
        statBlock('Users', humanNumber(w.users), 'Distinct submitters, all time'),
        statBlock('Projects', humanNumber(w.projects), 'Tracked in the project registry'),
        statBlock('Accounts', humanNumber(w.accounts), 'Distinct Slurm accounts'),
        statBlock('Partitions', humanNumber(w.partitions), 'Distinct Slurm partitions'),
        statBlock('Database Size', bytesLabel(w.databaseSizeBytes), 'SQLite warehouse on disk'),
        statBlock('Schema Version', w.schemaVersion ?? '-', 'mjolnir_analytics.sqlite schema'),
        statBlock('Warehouse Version', w.warehouseVersion ?? '-', 'Warehouse metadata version'),
        statBlock('Node Snapshot', snapshotAgeLabel(w.nodeSnapshotAt), formatLocalDateTime(w.nodeSnapshotAt)),
      ].join('')}</div>
    </section>
  </div>`;
}

// --- Section 5: Queue Summary -----------------------------------------------
// Pure presentation over queueInsights, reusing queueHealthBadge(),
// clusterWaitSeriesRows(), durationLabel(), hourLabel() and WEEKDAY_NAMES -
// the exact helpers the dedicated Queue Insights pages already use. Most/
// least busy partition is a sort (not a calculation) of currentPressure.
// by_partition by live load; best submission window is the same
// lowest-wait sort queueAdvisorPage() performs.
function executiveQueueSection() {
  if (!queueInsights || !queueInsights.available) {
    return `<section class="section"><div class="section-head"><h2>Queue Summary</h2></div>${disclaimer('Queue Insights data has not been collected yet.')}</section>`;
  }
  const cp = asObject(queueInsights.currentPressure);
  const queue = asObject(cp.queue);
  const byLoad = asArray(cp.by_partition)
    .map((p) => ({ ...p, load: num(p.running) + num(p.pending) }))
    .sort((a, b) => b.load - a.load);
  const busiest = byLoad[0] || null;
  const least = byLoad.length ? byLoad[byLoad.length - 1] : null;
  const topReason = asArray(cp.pending_reasons)[0] || null;
  const clusterSeries = clusterWaitSeriesRows(asObject(queueInsights.waitTimeHistory).series);
  const latestWait = clusterSeries.length ? clusterSeries[clusterSeries.length - 1] : null;
  const bestWindow = asArray(asObject(queueInsights.submissionPatterns).best_submission_windows).slice()
    .sort((a, b) => num(a.median_wait_seconds) - num(b.median_wait_seconds))[0] || null;

  return `<section class="section"><div class="section-head"><h2>Queue Summary</h2>${queueHealthBadge(cp.queue_health)}</div>
    <div class="cards-grid">${[
      statBlock('Running Jobs', fmt(queue.running), 'Across all partitions', 'good'),
      statBlock('Pending Jobs', fmt(queue.pending), 'Waiting to start', num(queue.pending) ? 'info' : 'good'),
      statBlock('Median Wait', durationLabel(latestWait && latestWait.median_wait_seconds), 'Cluster-wide, latest day'),
      statBlock('P90 Wait', durationLabel(latestWait && latestWait.p90_wait_seconds), 'Cluster-wide, latest day'),
      statBlock('Most Busy Partition', busiest ? escapeHtml(busiest.partition) : '-', busiest ? `${fmt(busiest.running)} running, ${fmt(busiest.pending)} pending` : 'No live data'),
      statBlock('Least Busy Partition', least ? escapeHtml(least.partition) : '-', least ? `${fmt(least.running)} running, ${fmt(least.pending)} pending` : 'No live data'),
      statBlock('Top Pending Reason', topReason ? escapeHtml(topReason.reason) : 'None', topReason ? `${fmt(topReason.count)} jobs` : 'No pending jobs'),
      statBlock('Best Submission Window', bestWindow ? `${WEEKDAY_NAMES[bestWindow.weekday]} ${hourLabel(bestWindow.hour_of_day)}` : 'Not enough data', bestWindow ? `${escapeHtml(bestWindow.partition_name)}, typical wait ${durationLabel(bestWindow.median_wait_seconds)}` : 'Historical tendency only'),
    ].join('')}</div>
    <a class="btn" href="#/queue-overview">Full Queue Insights</a>
  </section>`;
}

// --- Section 6: Current Alerts -----------------------------------------------
// Derived only from health/threshold computations made elsewhere -
// collectorHealth() per module, partitionsUnderPressure() (the same filter
// queueOverviewPage() uses), and the maintenance node list
// infrastructureOverviewPage() already lists. No new threshold anywhere.
const ALERT_SEVERITY_TONE = { Critical: 'bad', Warning: 'warn', Information: 'info' };

function currentAlerts() {
  const alerts = [];
  platformRegistry.filter((m) => !m.planned).forEach((m) => {
    const health = collectorHealth(m);
    if (health.status === 'failed') alerts.push({ severity: 'Critical', text: `${escapeHtml(m.label)} collector failed` });
    else if (health.status === 'critical') alerts.push({ severity: 'Critical', text: `${escapeHtml(m.label)} update significantly overdue` });
    else if (health.status === 'warning') alerts.push({ severity: 'Warning', text: `${escapeHtml(m.label)} update overdue` });
  });
  const queueLabel = queueInsights?.currentPressure?.queue_health?.label;
  if (queueLabel === 'Severely Congested' || queueLabel === 'Congested') {
    const worst = partitionsUnderPressure(asArray(queueInsights?.currentPressure?.by_partition))[0];
    alerts.push({
      severity: queueLabel === 'Severely Congested' ? 'Critical' : 'Warning',
      text: worst ? `${escapeHtml(worst.partition)} queue saturated (${pct(worst.pressure)} pending)` : `Queue is ${queueLabel.toLowerCase()}`,
    });
  }
  asArray(asObject(asObject(nodeInsights?.clusterOverview).maintenance).nodes).forEach((n) => {
    alerts.push({ severity: 'Information', text: `Node ${escapeHtml(n.node)} in maintenance${n.reason ? ` (${escapeHtml(n.reason)})` : ''}` });
  });
  return alerts;
}

function currentAlertsSection() {
  const alerts = currentAlerts();
  return `<section class="section"><div class="section-head"><h2>Current Alerts</h2></div>
    ${alerts.length
      ? `<div class="stack">${alerts.map((a) => `<div class="alert-row"><span class="pill ${ALERT_SEVERITY_TONE[a.severity] || 'info'}">${a.severity}</span><span>${a.text}</span></div>`).join('')}</div>`
      : '<div class="empty-state">No active alerts.</div>'}
  </section>`;
}

// --- Section 7: Recommendations ----------------------------------------------
// Decision rules (each reads fields already loaded for Sections 2-6 above;
// a rule whose inputs are unavailable is simply omitted, never replaced
// with a guess):
//   1. Queue Congested/Severely Congested + a saturated partition exists
//      -> "<partition or GPU> users should expect longer waits today."
//   2. Queue health score improved over the last 7 history points
//      -> "The queue is improving."
//   3. A best submission window exists in submissionPatterns
//      -> "Best submission window begins around <hour> (<partition>)."
//   4. Warehouse imported new canonical jobs within the last 24h
//      -> "Warehouse updated successfully overnight."
//   5. Nodes are draining for maintenance
//      -> "Node maintenance has reduced available capacity by <pct>."
function executiveRecommendations() {
  const recs = [];
  const cp = asObject(queueInsights?.currentPressure);
  const queueLabel = cp.queue_health?.label;
  if (queueLabel === 'Congested' || queueLabel === 'Severely Congested') {
    const worst = partitionsUnderPressure(asArray(cp.by_partition))[0];
    if (worst) {
      const subject = /gpu/i.test(worst.partition || '') ? 'GPU' : escapeHtml(worst.partition);
      recs.push(`${subject} users should expect longer waits today.`);
    }
  }
  const healthHistory = asArray(queueInsights?.queueHealthHistory).slice(-7);
  if (healthHistory.length >= 2) {
    const first = num(healthHistory[0].score);
    const last = num(healthHistory[healthHistory.length - 1].score);
    if (last < first - 5) recs.push('The queue is improving compared to the last week.');
  }
  const bestWindow = asArray(asObject(queueInsights?.submissionPatterns).best_submission_windows).slice()
    .sort((a, b) => num(a.median_wait_seconds) - num(b.median_wait_seconds))[0];
  if (bestWindow) {
    recs.push(`Best submission window begins around ${hourLabel(bestWindow.hour_of_day)} (${escapeHtml(bestWindow.partition_name)}).`);
  }
  const w = warehouseSummary;
  if (w.available && w.lastImportAt && num(w.overnight?.new_canonical_jobs) > 0 && snapshotAgeMs(w.lastImportAt) < 24 * 60 * 60 * 1000) {
    recs.push('Warehouse updated successfully overnight.');
  }
  const maintenance = asObject(asObject(nodeInsights?.clusterOverview).maintenance);
  const totals = asObject(asObject(nodeInsights?.clusterOverview).totals);
  if (num(maintenance.nodes_draining) > 0 && num(totals.nodes_total)) {
    recs.push(`Node maintenance has reduced available capacity by ${pct(num(maintenance.nodes_draining) / num(totals.nodes_total), 0)}.`);
  }
  return recs;
}

function recommendationsSection() {
  const recs = executiveRecommendations();
  return `<section class="section"><div class="section-head"><h2>Recommendations</h2></div>
    ${recs.length ? `<ul class="rec-simple-list">${recs.map((r) => `<li>${r}</li>`).join('')}</ul>` : '<div class="empty-state">No recommendations right now - everything looks nominal.</div>'}
  </section>`;
}

// --- Section 8: Platform Overview --------------------------------------------
// Thin wrapper over platformRegistry/collectorHealth()/statusPillHtml() -
// the same data platformStatusPanel() renders, condensed and linked out to
// each module's existing detail page.
const PLATFORM_OVERVIEW_LINKS = {
  'analytics-warehouse': '#/warehouse',
  'node-insights': '#/infrastructure',
  'analytics-pipeline': '#/platform-status',
  'queue-insights': '#/queue-overview',
};

function platformOverviewSection() {
  return `<section class="section"><div class="section-head"><h2>Platform Overview</h2><a class="btn" href="#/platform-status">Platform Status detail</a></div>
    <div class="platform-module-list">${platformRegistry.map((m) => (
      `<div class="platform-module-row"><a href="${PLATFORM_OVERVIEW_LINKS[m.id] || '#/platform-status'}">${escapeHtml(m.label)}</a><span class="subtle">${m.planned ? 'Planned' : snapshotAgeLabel(m.generatedAt)}</span>${statusPillHtml(collectorHealth(m))}</div>`
    )).join('')}</div>
  </section>`;
}

function landingPage() {
  return `
    <div class="stack">
      ${clusterHealthHero()}
      ${executiveKpiSection()}
      ${overnightSummarySection()}
      ${executiveWarehouseSection()}
      ${executiveQueueSection()}
      ${currentAlertsSection()}
      ${recommendationsSection()}
      ${platformOverviewSection()}
    </div>`;
}

// Dedicated Warehouse page (sidebar: Infrastructure > Warehouse) - the
// operational overview for administrators: warehouse health, the three
// headline counts (accounting records / job steps / canonical jobs) and how
// they relate, organizational scope (users/projects/accounts/partitions),
// compute fleet size, and pipeline/version metadata. Every value comes from
// buildWarehouseSummary() (status.json's `warehouse` block) - nothing here
// is computed client-side or hardcoded.
function warehousePage() {
  const w = warehouseSummary;
  if (!w.available) {
    return `<div class="stack">${disclaimer('The Analytics Warehouse pipeline status has not been published yet, or the warehouse has no jobs recorded. This page will populate automatically once status.json is available.')}</div>`;
  }
  return `
    <div class="stack">
      ${warehouseStatusCard(w)}
      <section class="section"><div class="section-head"><h2>Warehouse Summary</h2><span class="subtle">Live scale and freshness</span></div>
        ${warehouseSummaryTiles(w)}
        ${canonicalSelectionExplainer()}
      </section>
      <section class="section"><div class="section-head"><h2>Organizational scope</h2><span class="subtle">Who and what the warehouse covers</span></div><div class="cards-grid">${[
        statBlock('Unique users', fmt(w.users), 'Distinct submitters, all time'),
        statBlock('Projects', fmt(w.projects), 'Tracked in the project registry'),
        statBlock('Accounts', fmt(w.accounts), 'Distinct Slurm accounts'),
        statBlock('Partitions', fmt(w.partitions), 'Distinct Slurm partitions'),
        statBlock('Compute nodes', fmt(w.computeNodes), 'Live from Node Insights'),
      ].join('')}</div></section>
      <section class="section"><div class="section-head"><h2>Versions</h2><span class="subtle">Schema and pipeline</span></div><div class="cards-grid">${[
        statBlock('Schema version', w.schemaVersion ?? '-', 'mjolnir_analytics.sqlite schema'),
        statBlock('Pipeline version', w.warehouseVersion ?? '-', 'Warehouse metadata version'),
      ].join('')}</div></section>
      ${analyticsPipelineDiagram()}
      ${disclaimer('Daily imported job counts and historical warehouse-size growth are not yet exported by the pipeline. This page will gain a growth-over-time chart once that history is tracked.')}
    </div>`;
}

// Dedicated Platform Status page (sidebar: Infrastructure > Platform
// Status; also the System Health card's "View Platform Status" button).
// The detailed breakdown formerly shown inline on the Overview page -
// Platform Health, Collector Health, Module Status, Last Platform Update,
// Snapshots Collected, Active Analytics Modules - all from the same
// buildPlatformRegistry() data the Overview page's System Health card
// summarizes. Expand this page as dedicated module detail pages (Queue
// Insights, Slurm Insights, ...) come online.
// Shared by platformStatusPage() and the Executive Overview's Overnight
// Summary - total historical snapshots retained (Node Insights hourly
// history + daily cluster-summary rows), not a "last 24h" count, so both
// pages always agree.
function totalSnapshotCount() {
  return asArray(nodeInsightsHistory?.capacity).length + asArray(data?.clusterSummary?.dailyTrends).length;
}

function platformStatusPage() {
  const snapshotCount = totalSnapshotCount();
  const activeModuleCount = platformRegistry.filter((m) => !m.planned && m.available).length;
  return `
    <div class="stack">
      ${platformStatusPanel(platformRegistry, { snapshotCount, activeModuleCount })}
      <section class="section"><div class="section-head"><h2>Module detail</h2><span class="subtle">Per-collector freshness</span></div>
        <div class="stack">${platformRegistry.filter((m) => !m.planned).map((m) => (
          `<div><h3 style="margin:0 0 8px;font-size:0.95rem">${m.label}</h3>${statusBar(m)}</div>`
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
        ${lineChart('CPU efficiency', rows, [chartSeries(rows, 'avg_cpu_efficiency', 'Daily', '#3e8cff'), rollingSeries(rows, 'avg_cpu_efficiency', 7, '7-day', '#30d5d0'), rollingSeries(rows, 'avg_cpu_efficiency', 30, '30-day', '#ffb84d')], pct, { zeroBase: true, events: OPERATIONAL_EVENTS, unitLabel: 'Share of allocated CPU time actually used' })}
        ${lineChart('Memory efficiency', rows, [chartSeries(rows, 'avg_memory_efficiency', 'Daily', '#53d88a'), rollingSeries(rows, 'avg_memory_efficiency', 7, '7-day', '#30d5d0'), rollingSeries(rows, 'avg_memory_efficiency', 30, '30-day', '#ffb84d')], pct, { zeroBase: true })}
        ${lineChart('Daily cost and optimization opportunity', rows, [chartSeries(rows, 'estimated_cost_dkk', 'Estimated cost', '#3e8cff'), chartSeries(rows, 'underutilized_cost_dkk', 'Underutilized cost', '#ff6b7a')], money, { zeroBase: true })}
        ${lineChart('GPU hours', rows, [chartSeries(rows, 'gpu_hours', 'GPU hours', '#9cd0ff'), rollingSeries(rows, 'gpu_hours', 7, '7-day', '#30d5d0'), rollingSeries(rows, 'gpu_hours', 30, '30-day', '#ffb84d')], fmt, { zeroBase: true, emptyMessage: 'No GPU jobs during this period.' })}
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
  const windowDays = data?.datasetMeta?.dataWindowDays;
  const windowLabel = windowDays ? `${fmt(windowDays)}-day` : 'recent';
  return `
    <div class="stack">
      <section class="section"><div class="section-head"><h2>Cluster Resource Health</h2><span class="subtle">All metrics from the live analytics export (${windowLabel} window)</span></div><div class="cards-grid">${[
        statBlock('Total jobs', fmt(allTime.jobs), 'Measured job metrics rows'),
        statBlock('Completed jobs', fmt(allTime.completed_jobs), 'Successful workload volume', 'good'),
        statBlock('Failed jobs', fmt(allTime.failed_jobs), `${pct(failureRate, 1)} failure rate`, failureRate > 0.1 ? 'warn' : 'good'),
        statBlock('Average CPU efficiency', pct(allTime.avg_cpu_efficiency), cpuTrend.text, cpuTrend.tone),
        statBlock('Average memory efficiency', pct(allTime.avg_memory_efficiency), memoryTrend.text, memoryTrend.tone),
        statBlock('Estimated cost', money(allTime.estimated_cost_dkk), `${windowLabel} estimated spend`),
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
        insight('Cost control', `${money(allTime.underutilized_cost_dkk)} of ${windowLabel} cost is marked as underutilized. Treat this as the main optimization queue.`),
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

function percentileBar(label, values, formatter, tone = 'info', sampleLabel) {
  const { html } = createDistribution(values, formatter, tone, { label, sampleLabel });
  return `<article class="section percentile-viz"><div class="section-head"><h2>${label}</h2><span class="pill ${tone}">5-95 percentile</span></div>${html}</article>`;
}

function benchmarkPage() {
  const percentiles = asObject(data?.percentiles);
  const sampleLabel = data?.clusterSummary?.allTime?.jobs ? `Based on ${fmt(data.clusterSummary.allTime.jobs)} jobs` : undefined;
  return `
    <div class="stack">
      ${analyticsStatusBar()}
      ${infoPanel('How do percentiles work?', 'Percentiles show how a project or user\'s resource usage compares with the broader Mjolnir community. A percentile of 90 means usage is higher than 90% of comparable peers, while a percentile of 10 means usage is lower than most peers. Percentiles provide context, not judgement, and are most useful for spotting unusually high or unusually low resource usage patterns.')}
      <section class="section"><div class="section-head"><h2>How resource usage compares across Mjolnir</h2><span class="subtle">Context, not judgement - anonymized population view</span></div><p class="subtle">Percentiles help put your resource usage in context against peer behavior without showing real peer identities.</p></section>
      <div class="trend-grid">
        ${percentileBar('CPU efficiency percentiles', asObject(percentiles.cpu), pct, 'info', sampleLabel)}
        ${percentileBar('Memory efficiency percentiles', asObject(percentiles.memory), pct, 'good', sampleLabel)}
        ${percentileBar('Cost percentiles', asObject(percentiles.cost), money, 'warn', sampleLabel)}
        ${percentileBar('GPU hour percentiles', asObject(percentiles.gpu), fmt, 'info', sampleLabel)}
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
      <section class="section"><div class="section-head"><h2>${escapeHtml(entity.label)}</h2><span class="subtle">${title}</span>${type === 'pi' ? `<a class="btn" href="#/reports/pi/${escapeHtml(id)}">View PI Report</a>` : ''}</div>${metricSummaryCards(entity)}</section>
      ${lineChart(`${escapeHtml(entity.label)} efficiency trend`, entity.dailyTrends, [chartSeries(entity.dailyTrends, 'avg_cpu_efficiency', 'CPU', '#3e8cff'), chartSeries(entity.dailyTrends, 'avg_memory_efficiency', 'Memory', '#53d88a')], pct, { zeroBase: true })}
      ${lineChart(`${escapeHtml(entity.label)} cost trend`, entity.dailyTrends, [chartSeries(entity.dailyTrends, 'estimated_cost_dkk', 'Estimated cost', '#3e8cff'), chartSeries(entity.dailyTrends, 'underutilized_cost_dkk', 'Opportunity', '#ff6b7a')], money, { zeroBase: true })}
      ${related}
      <section class="section"><div class="section-head"><h2>Recommendations</h2><span class="subtle">Generated from aggregate efficiency signals</span></div><div class="rec-list">${asArray(entity.recommendations).length ? entity.recommendations.map((rec) => recCard(rec.priority || rec.severity || 'Review', rec.title, rec.detail || rec.category || '', rec.savings ? money(rec.savings) : 'Impact TBD')).join('') : '<div class="empty-state">No hierarchy-level recommendations are available yet.</div>'}</div></section>
    </div>`;
}


const USERS_EXPLORER_PAGE_SIZE = 50;

function dateNDaysAgo(referenceDate, n) {
  if (!referenceDate) return null;
  const d = new Date(referenceDate);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function usersExplorerFiltered() {
  const summaryUsers = asArray(data?.usersSummary?.users);
  const { search, sort, filters } = state.usersExplorer;
  const dates = summaryUsers.map((u) => u.lastActive).filter(Boolean).sort();
  const refDate = dates[dates.length - 1] || null;
  const q = search.trim().toLowerCase();

  let result = summaryUsers.filter((u) => {
    if (q && !u.displayPseudonym.toLowerCase().includes(q)) return false;

    if (filters.activity === 'today' && u.lastActive !== refDate) return false;
    if (filters.activity === '7d') { const c = dateNDaysAgo(refDate, 7); if (!u.lastActive || u.lastActive < c) return false; }
    if (filters.activity === '30d') { const c = dateNDaysAgo(refDate, 30); if (!u.lastActive || u.lastActive < c) return false; }
    if (filters.activity === '90d') { const c = dateNDaysAgo(refDate, 90); if (!u.lastActive || u.lastActive < c) return false; }
    if (filters.activity === 'inactive') { const c = dateNDaysAgo(refDate, 90); if (u.lastActive && u.lastActive >= c) return false; }

    if (filters.resource === 'gpu' && !(u.gpuHours > 0)) return false;
    if (filters.resource === 'cpu' && u.gpuHours > 0) return false;

    // Phase 8: filter/sort/display by the 180d rolling efficiency, not
    // lifetime overallEfficiency, so Explorer/Rankings reflect current
    // behaviour like everything else in this phase.
    const eff = windowOverallEfficiency(u);
    if (filters.efficiency === 'under50' && (eff === null || eff >= 0.5)) return false;
    if (filters.efficiency === '50-70' && (eff === null || eff < 0.5 || eff >= 0.7)) return false;
    if (filters.efficiency === '70-90' && (eff === null || eff < 0.7 || eff >= 0.9)) return false;
    if (filters.efficiency === 'over90' && (eff === null || eff < 0.9)) return false;

    if (filters.jobs === 'over10' && u.totalJobs <= 10) return false;
    if (filters.jobs === 'over100' && u.totalJobs <= 100) return false;
    if (filters.jobs === 'over500' && u.totalJobs <= 500) return false;

    return true;
  });

  const { key, dir } = sort;
  const accessor = {
    pseudonym:       (u) => u.displayPseudonym,
    total_jobs:      (u) => u.totalJobs,
    cpu_hours:       (u) => u.cpuHours,
    gpu_hours:       (u) => u.gpuHours,
    efficiency:      (u) => windowOverallEfficiency(u) ?? -1,
    last_active:     (u) => u.lastActive ?? '',
    cost:            (u) => u.estimatedCostDkk,
    recommendations: (u) => u.recommendationCount,
  }[key] || ((u) => u.cpuHours);

  return result.slice().sort((a, b) => {
    const av = accessor(a);
    const bv = accessor(b);
    if (typeof av === 'string') return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    return dir === 'asc' ? av - bv : bv - av;
  });
}

function usersExplorerSortHeader(label, key) {
  const { sort } = state.usersExplorer;
  const active = sort.key === key;
  const arrow = active ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : '';
  return `<th><button type="button" class="sort-button" data-action="sort-users-explorer" data-key="${key}">${escapeHtml(label)}${arrow}</button></th>`;
}

function efficiencyPill(eff) {
  if (eff === null || eff === undefined || !Number.isFinite(eff)) return '<span class="subtle">—</span>';
  const tone = eff >= 0.7 ? 'good' : eff >= 0.5 ? 'info' : 'warn';
  return `<span class="pill ${tone}">${pct(eff)}</span>`;
}

// ── Phase 6: LEAF Sustainability Indicator ─────────────────────────────────

const LEAF_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>`;

// Phase 7: four glow tiers so glow intensity communicates efficiency, not
// just hue. `leaf-green`/`leaf-yellow` are kept as CSS aliases of
// `leaf-good`/`leaf-amber` for backward compatibility with anything still
// referencing the old class names.
function leafGlowClass(eff) {
  if (eff === null || eff === undefined || !Number.isFinite(Number(eff))) return 'leaf-muted';
  const v = Number(eff);
  if (v >= 0.85) return 'leaf-excellent';
  if (v >= 0.70) return 'leaf-good';
  if (v >= 0.40) return 'leaf-amber';
  return 'leaf-red';
}

const LEAF_TONE_LABEL = {
  'leaf-excellent': 'Excellent efficiency',
  'leaf-good': 'Good efficiency',
  'leaf-amber': 'Medium efficiency',
  'leaf-red': 'Poor efficiency',
  'leaf-muted': 'No data',
};

function leafIndicator(eff, size = '') {
  const cls = leafGlowClass(eff);
  const sizeCls = size ? ` leaf-${size}` : '';
  const effLabel = (eff !== null && eff !== undefined && Number.isFinite(Number(eff)))
    ? pct(Number(eff))
    : '—';
  const tone = LEAF_TONE_LABEL[cls];
  return `<span class="leaf ${cls}${sizeCls}" title="${tone}: ${effLabel}" aria-label="LEAF sustainability: ${tone} (${effLabel})">${LEAF_SVG}</span>`;
}

function efficiencyWithLeaf(eff) {
  if (eff === null || eff === undefined || !Number.isFinite(Number(eff))) return '<span class="subtle">—</span>';
  return `<span class="leaf-pair">${leafIndicator(eff)}${efficiencyPill(eff)}</span>`;
}

// ── Phase 7: LEAF Sustainability Index ──────────────────────────────────────
//
// The LEAF Index is a composite 0-100 sustainability score. Weights and the
// set of active components mirror scripts/export_analytics_data.py's
// LEAF_INDEX_COMPONENTS/compute_leaf_index() exactly, kept in sync by hand
// since this is a static site with no shared build step. Adding a future
// dimension (GPU, queue behavior, energy, carbon, ...) means: export the raw
// metric from the backend, add one entry here with available:true, and
// nothing else changes - LEAF_INDEX_COMPONENTS below already drives every
// display (badge, tooltip, LEAF Dashboard sub-scores).
// `fields` lists every field name this component might be found under,
// since callers pass either a users_summary row (`cpu_efficiency`) or a raw
// personal-bundle summary (`avg_cpu_efficiency`).
const LEAF_INDEX_COMPONENTS = [
  { id: 'cpu',    label: 'CPU efficiency',    weight: 0.6, available: true,  fields: ['cpu_efficiency', 'avg_cpu_efficiency'] },
  { id: 'memory', label: 'Memory efficiency', weight: 0.4, available: true,  fields: ['memory_efficiency', 'avg_memory_efficiency'] },
  { id: 'gpu',    label: 'GPU efficiency',    weight: 0.0, available: false, fields: ['gpu_efficiency'] },
  { id: 'queue',  label: 'Queue behavior',    weight: 0.0, available: false, fields: ['queue_score'] },
];

function leafComponentValue(record, component) {
  for (const field of component.fields) {
    const v = record?.[field];
    if (Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

// Phase 8: LEAF 2.0 - the only LEAF Index meant for display, ranking, or
// sorting is the rolling-window one exported as bundle/record.leaf (a
// users_summary row, personal bundle, or user/hierarchy bundle all carry the
// same "leaf" shape - see data-loader.js normalizeLeafBlock and
// scripts/export_analytics_data.py build_leaf_block()). The legacy
// leafIndex/leaf_index fields are lifetime-scoped and kept only for
// external backward compatibility - nothing in this file reads them for
// display after this point.
const LEAF_ROLLING_LABEL = 'LEAF (180d rolling)';

// `record.leaf` may be pre-normalized (camelCase, from data-loader.js
// normalizeLeafBlock - users_summary rows, personal bundles) or raw JSON
// (snake_case - a user/hierarchy bundle fetched straight off the wire, see
// requestUserBundle/loadUserBundle) - support both so callers never need to
// care which shape they were handed.
function leafBlockOf(record) {
  const leaf = record?.leaf;
  if (!leaf) return null;
  return {
    leafIndex: leaf.leafIndex ?? leaf.leaf_index ?? null,
    leafIndexComponents: leaf.leafIndexComponents ?? leaf.leaf_index_components ?? [],
    confidence: leaf.confidence ?? null,
    percentile: leaf.percentile ?? null,
    windowDays: leaf.windowDays ?? leaf.window_days ?? null,
    measurementCoverage: leaf.measurementCoverage ?? {
      jobsMeasured: leaf.measurement_coverage?.jobs_measured ?? null,
      jobsExcluded: leaf.measurement_coverage?.jobs_excluded ?? null,
      jobsMeasuredPct: leaf.measurement_coverage?.jobs_measured_pct ?? null,
      cpuHoursMeasuredPct: leaf.measurement_coverage?.cpu_hours_measured_pct ?? null,
      memoryMeasuredPct: leaf.measurement_coverage?.memory_measured_pct ?? null,
    },
  };
}

function leafComponentFromBlock(leaf, componentId) {
  const c = (leaf?.leafIndexComponents || []).find((x) => x.id === componentId);
  return c ? c.value : null;
}

// Rolling-window analogue of a record's (lifetime) overallEfficiency, used
// wherever Users Explorer/Rankings ranks or filters by "efficiency" so that
// ranking reflects recent behaviour, not lifetime history.
function windowOverallEfficiency(record) {
  const leaf = leafBlockOf(record);
  const present = ['cpu', 'memory']
    .map((id) => leafComponentFromBlock(leaf, id))
    .filter((v) => v !== null && v !== undefined && Number.isFinite(v));
  return present.length ? present.reduce((a, b) => a + b, 0) / present.length : null;
}

const LEAF_CONFIDENCE_LABEL = { high: 'High', medium: 'Medium', low: 'Low', very_low: 'Very low' };
const LEAF_CONFIDENCE_TOOLTIP = 'Confidence reflects how much of your recent activity actually has measured CPU/memory utilization data - low confidence means most jobs in this window lack the accounting data needed to compute efficiency, not that your efficiency is poor.';

function leafConfidenceChip(leaf) {
  const key = leaf?.confidence;
  const label = LEAF_CONFIDENCE_LABEL[key] || '—';
  const cls = key === 'high' ? 'good' : key === 'medium' ? 'info' : key === 'low' ? 'warn' : 'bad';
  return `<span class="pill ${cls}" title="${escapeHtml(LEAF_CONFIDENCE_TOOLTIP)}">${escapeHtml(label)} confidence${infoTip(LEAF_CONFIDENCE_TOOLTIP)}</span>`;
}

// Fallback only: used when a record predates the exported `leaf_index`
// field (e.g. cached/older JSON). Prefer the exported field when present.
function computeLeafIndex(record) {
  const active = LEAF_INDEX_COMPONENTS
    .filter((c) => c.available)
    .map((c) => ({ c, value: leafComponentValue(record, c) }))
    .filter(({ value }) => value !== null);
  const totalWeight = active.reduce((sum, { c }) => sum + c.weight, 0);
  if (!active.length || totalWeight <= 0) return { score: null, components: [] };
  let score = 0;
  const components = active.map(({ c, value }) => {
    const normWeight = c.weight / totalWeight;
    const contribution = value * normWeight;
    score += contribution;
    return { id: c.id, label: c.label, value, weight: normWeight, contribution };
  });
  return { score: Math.round(score * 100), components };
}

function leafIndexTier(score) {
  if (score === null || score === undefined || !Number.isFinite(Number(score))) return 'leaf-muted';
  const v = Number(score);
  if (v >= 85) return 'leaf-excellent';
  if (v >= 70) return 'leaf-good';
  if (v >= 40) return 'leaf-amber';
  return 'leaf-red';
}

// Phase 8: LEAF measures resource efficiency/environmental sustainability
// and is independent of price; Savings Opportunity measures realistic
// near-term cost reduction from measurable jobs. They can move independently
// (e.g. low LEAF from years of history but small realistic savings today) -
// this tooltip is the one place that distinction is explained, reused on
// every "Savings opportunity" stat card.
const LEAF_VS_SAVINGS_TOOLTIP = 'LEAF measures resource efficiency (environmental sustainability), independent of cost. Savings Opportunity measures realistic near-term cost reduction, estimated only from jobs with measured utilization, over the same 180-day window as LEAF. A user can have a low LEAF but a small Savings Opportunity if most of their recent jobs lack measurement data - see the Measurement Coverage note above.';

const LEAF_INDEX_TOOLTIP = 'The LEAF Index reflects sustainable use of HPC resources over the last 180 days (not your all-time history), so it can actually improve as your usage improves. It currently reflects CPU and memory efficiency, weighted 60/40, and will expand to include additional sustainability dimensions (GPU efficiency, queue behaviour, energy, carbon) as they become available. Version 2.0.';

// `record` may be a users_summary row, personal bundle, or user/hierarchy
// bundle - all carry a `leaf` block (see data-loader.js normalizeLeafBlock /
// export_analytics_data.py build_leaf_block). Falls back to computeLeafIndex
// only for JSON that predates the `leaf` block entirely (very old cache).
function leafIndexBadge(record, size = 'lg') {
  const leaf = leafBlockOf(record);
  const score = leaf?.leafIndex ?? computeLeafIndex(record || {}).score;
  const cls = leafIndexTier(score);
  const display = Number.isFinite(Number(score)) ? Math.round(Number(score)) : '—';
  const tone = LEAF_TONE_LABEL[cls];
  return `<span class="leaf-index-badge">
    <span class="leaf ${cls} leaf-${size}" title="${escapeHtml(tone)}" aria-hidden="true">${LEAF_SVG}</span>
    <span class="leaf-index-value">${display}<span class="leaf-index-scale">/100</span></span>
    <span class="leaf-index-window subtle">${escapeHtml(LEAF_ROLLING_LABEL)}</span>
    ${infoTip(LEAF_INDEX_TOOLTIP)}
  </span>`;
}

const LEAF_INDEX_BANDS = [
  { from: 0, to: 40, color: '#ff6b7a' },
  { from: 40, to: 70, color: '#e0a94d' },
  { from: 70, to: 100, color: '#53d88a' },
];

// Phase 7: the LEAF Dashboard - a "health dashboard" summary of a user's
// sustainability standing, built entirely from data already computed
// elsewhere on the profile page (no new backend calls). Sub-scores are
// looped from LEAF_INDEX_COMPONENTS filtered to `available: true`, so GPU/
// queue sub-scores appear automatically the day they go live - nothing on
// this page needs to change when that happens.
function leafDashboardSection(record, filteredTrends, recs, potentialSavingsDkk) {
  const leaf = leafBlockOf(record);
  // Phase 8: sub-scores read the same rolling-window components as the
  // headline badge (leaf.leafIndexComponents), not the lifetime
  // cpu_efficiency/memory_efficiency fields leafComponentValue() reads -
  // otherwise the sub-scores and the badge above them would silently
  // describe two different time windows.
  const subScoreCards = LEAF_INDEX_COMPONENTS
    .filter((c) => c.available)
    .map((c) => {
      const value = leafComponentFromBlock(leaf, c.id);
      return `<article class="stat-card">
        <div class="label">${escapeHtml(c.label)} LEAF</div>
        <div class="value"><span class="leaf-pair">${leafIndicator(value)}${efficiencyPill(value)}</span></div>
        <div class="subtle">${Math.round(c.weight * 100)}% of LEAF Index · ${escapeHtml(LEAF_ROLLING_LABEL)}</div>
      </article>`;
    })
    .join('');

  const leafTrendValues = asArray(filteredTrends).map((row) => computeLeafIndex(row).score);
  const hasTrend = leafTrendValues.some((v) => Number.isFinite(v));
  const leafTrendChart = hasTrend
    ? lineChart('LEAF Index trend', filteredTrends,
        [{ label: 'LEAF Index', color: '#4CE28F', values: leafTrendValues, dashed: false }],
        (v) => `${Math.round(v)} / 100`, { zeroBase: true, bands: LEAF_INDEX_BANDS })
    : '<div class="empty-state">Not enough daily history yet to chart a LEAF Index trend.</div>';

  const improvementsNote = recs.length
    ? `${recs.length} improvement ${recs.length === 1 ? 'suggestion is' : 'suggestions are'} available below.`
    : 'No outstanding improvement suggestions - keep it up.';

  const coverage = leaf?.measurementCoverage || {};
  const coverageNote = Number.isFinite(coverage.jobsMeasured) && Number.isFinite(coverage.jobsExcluded)
    ? `LEAF calculated from ${fmt(coverage.jobsMeasured)} measured jobs${coverage.jobsExcluded > 0 ? ` · ${fmt(coverage.jobsExcluded)} jobs excluded (utilization data unavailable)` : ''}.`
    : 'Not enough measured jobs in this window to compute measurement coverage.';
  const coverageTooltip = 'Jobs without measured CPU/memory utilization are excluded from LEAF entirely - they are never treated as 0% efficient, since that would be unrepresentative of unknown data.';

  return `<section class="section">
    <div class="section-head"><h2>LEAF Dashboard</h2><span class="subtle">Your sustainability health summary · ${escapeHtml(LEAF_ROLLING_LABEL)}</span></div>
    <div class="cards-grid">
      <article class="stat-card"><div class="label">LEAF Index</div><div class="value">${leafIndexBadge(record, 'xl')}</div><div class="subtle">${leafConfidenceChip(leaf)}</div></article>
      ${subScoreCards}
      <article class="stat-card"><div class="label">Measurement coverage${infoTip(coverageTooltip)}</div><div class="value" style="font-size:1rem;font-weight:600">${escapeHtml(coverageNote)}</div></article>
      <article class="stat-card"><div class="label">Potential improvements</div><div class="value" style="font-size:1rem;font-weight:600">${escapeHtml(improvementsNote)}</div></article>
      <article class="stat-card warn"><div class="label">Savings opportunity${infoTip(LEAF_VS_SAVINGS_TOOLTIP)}</div><div class="value">${money(potentialSavingsDkk)}</div><div class="subtle">Estimated reducible cost · ${escapeHtml(LEAF_ROLLING_LABEL)}</div></article>
    </div>
    ${leafTrendChart}
  </section>`;
}

// Phase 7: positive reinforcement - celebrate improvements instead of only
// surfacing what's wrong. Compares the 7-day rolling window against the
// 30-day rolling window (both already exported, same pair trendDirection()
// uses elsewhere) as a practical proxy for "recent vs. a month ago." Only
// improvements are called out; flat or negative movement stays silent here
// (the Recommendations section already covers what needs attention).
function positiveReinforcementBanner(rolling) {
  const recent = asObject(rolling['7d']);
  const baseline = asObject(rolling['30d']);
  const delta = (a, b) => {
    const an = Number(a), bn = Number(b);
    return (Number.isFinite(an) && Number.isFinite(bn)) ? an - bn : null;
  };

  const leafDelta = delta(recent.leaf_index, baseline.leaf_index);
  const cpuDelta = delta(recent.avg_cpu_efficiency, baseline.avg_cpu_efficiency);
  const memDelta = delta(recent.avg_memory_efficiency, baseline.avg_memory_efficiency);
  const savingsDelta = delta(baseline.underutilized_cost_dkk, recent.underutilized_cost_dkk); // positive = savings opportunity shrank

  const messages = [];
  if (leafDelta !== null && Math.round(leafDelta) >= 1) {
    const points = Math.round(leafDelta);
    messages.push(`LEAF Index improved by ${points} point${points === 1 ? '' : 's'} recently.`);
  }
  if (cpuDelta !== null && cpuDelta >= 0.02) messages.push(`CPU efficiency improved by ${Math.round(cpuDelta * 100)}%.`);
  if (memDelta !== null && memDelta >= 0.02) messages.push(`Memory requests are now better matched to actual usage.`);
  if (savingsDelta !== null && savingsDelta >= 1) messages.push(`Estimated savings opportunity reduced by ${money(savingsDelta)}.`);

  if (!messages.length) return '';
  return `<div class="leaf-celebration">${messages.map((m) => `<span class="leaf-celebration-item">${escapeHtml(m)}</span>`).join('')}</div>`;
}

// ── Phase 8: LEAF Journey ────────────────────────────────────────────────────
//
// Turns the LEAF Dashboard from a report card into a coaching view: is this
// user improving, and if so at what, and if not what's the single biggest
// remaining lever. Built entirely from bundle.daily_trends (already
// unbounded full history) and bundle.leaf - no new backend data.

function nearestTrendPoint(trends, daysAgo) {
  const rows = asArray(trends).filter((r) => r && r.report_date);
  if (!rows.length) return null;
  const target = new Date();
  target.setDate(target.getDate() - daysAgo);
  let best = null;
  let bestDiff = Infinity;
  for (const row of rows) {
    const diff = Math.abs(new Date(row.report_date).getTime() - target.getTime());
    if (diff < bestDiff) { bestDiff = diff; best = row; }
  }
  return best;
}

function leafJourneyDeltaLabel(delta) {
  if (delta === null || !Number.isFinite(delta)) return '—';
  if (delta > 0) return `▲ +${delta}`;
  if (delta < 0) return `▼ ${delta}`;
  return 'No change';
}

function leafJourneySection(bundle, su) {
  const leaf = leafBlockOf(bundle);
  const trends = asArray(bundle.daily_trends);
  if (leaf?.leafIndex == null || !trends.length) return '';

  const current = leaf.leafIndex;
  const point30 = nearestTrendPoint(trends, 30);
  const point180 = nearestTrendPoint(trends, 180);
  const leaf30 = point30 ? computeLeafIndex(point30).score : null;
  const leaf180 = point180 ? computeLeafIndex(point180).score : null;
  const delta30 = Number.isFinite(leaf30) ? Math.round(current - leaf30) : null;
  const delta180 = Number.isFinite(leaf180) ? Math.round(current - leaf180) : null;

  const cpuNow = leafComponentFromBlock(leaf, 'cpu');
  const memNow = leafComponentFromBlock(leaf, 'memory');
  const cpu30 = point30 ? point30.avg_cpu_efficiency : null;
  const mem30 = point30 ? point30.avg_memory_efficiency : null;

  const improvements = [];
  const opportunities = [];
  if (Number.isFinite(cpuNow) && Number.isFinite(cpu30) && cpuNow - cpu30 >= 0.03) improvements.push('Improved CPU utilization');
  else if (Number.isFinite(cpuNow) && cpuNow < 0.4) opportunities.push('CPU requests remain higher than measured usage');
  if (Number.isFinite(memNow) && Number.isFinite(mem30) && memNow - mem30 >= 0.03) improvements.push('Reduced memory over-allocation');
  else if (Number.isFinite(memNow) && memNow < 0.4) opportunities.push('Memory requests remain higher than measured usage');

  const improvementsHtml = improvements.length
    ? improvements.map((m) => `<div>✓ ${escapeHtml(m)}</div>`).join('')
    : '<div class="subtle">No clear improvements yet - keep going.</div>';
  const opportunitiesHtml = opportunities.length
    ? opportunities.map((m) => `<div>• ${escapeHtml(m)}</div>`).join('')
    : '<div class="subtle">No major remaining opportunities identified.</div>';

  return `<section class="section">
    <div class="section-head"><h2>Your LEAF Journey</h2><span class="subtle">Tracking progress, not judging history</span></div>
    <div class="cards-grid">
      <article class="stat-card"><div class="label">Current LEAF</div><div class="value">${Math.round(current)}<span class="leaf-index-scale">/100</span></div><div class="subtle">${leafJourneyDeltaLabel(delta30)} vs ~30 days ago</div></article>
      <article class="stat-card"><div class="label">6-month change</div><div class="value">${leafJourneyDeltaLabel(delta180)}</div><div class="subtle">vs ~180 days ago</div></article>
      <article class="stat-card"><div class="label">Cluster percentile</div><div class="value">${Number.isFinite(leaf.percentile) ? Math.round(leaf.percentile) + 'th' : '—'}</div><div class="subtle">${percentileContext(leaf.percentile) || `Among users with measured activity in the last ${leaf.windowDays || 180} days`}</div></article>
      <article class="stat-card"><div class="label">Biggest improvements</div><div class="value" style="font-size:0.95rem;font-weight:600">${improvementsHtml}</div></article>
      <article class="stat-card"><div class="label">Remaining opportunity</div><div class="value" style="font-size:0.95rem;font-weight:600">${opportunitiesHtml}</div></article>
    </div>
  </section>`;
}

// ── Phase 8: Sustainability Achievements ─────────────────────────────────────
//
// Informational only - purely derived from already-exported data, never fed
// back into LEAF, confidence, coverage, or any ranking.

function sustainabilityAchievements(bundle, su) {
  const leaf = leafBlockOf(bundle);
  if (leaf?.leafIndex == null) return '';
  const trends = asArray(bundle.daily_trends);
  const point180 = nearestTrendPoint(trends, 180);
  const latestPoint = trends.length ? trends[trends.length - 1] : null;
  const leaf180 = point180 ? computeLeafIndex(point180).score : null;
  const improvedPct = Number.isFinite(leaf180) && leaf180 > 0 ? ((leaf.leafIndex - leaf180) / leaf180) * 100 : null;
  const wasteNow = latestPoint ? Number(latestPoint.underutilized_cost_dkk) : null;
  const wasteThen = point180 ? Number(point180.underutilized_cost_dkk) : null;
  const wasteReducedPct = Number.isFinite(wasteNow) && Number.isFinite(wasteThen) && wasteThen > 0
    ? ((wasteThen - wasteNow) / wasteThen) * 100
    : null;

  const badges = [];
  if (leaf.leafIndex > 50) badges.push({ icon: '🌱', label: 'LEAF > 50%' });
  if (leaf.leafIndex > 70) badges.push({ icon: '🌿', label: 'LEAF > 70%' });
  if (leaf.leafIndex > 85) badges.push({ icon: '🌳', label: 'LEAF > 85%' });
  if (Number.isFinite(leaf.percentile) && leaf.percentile >= 90) badges.push({ icon: '🏆', label: 'Top 10%' });
  if (Number.isFinite(improvedPct) && improvedPct >= 15) badges.push({ icon: '⚡', label: `Improved ${Math.round(improvedPct)}% over 6 months` });
  if (Number.isFinite(wasteReducedPct) && wasteReducedPct >= 50) badges.push({ icon: '💚', label: `Reduced estimated waste by ${Math.round(wasteReducedPct)}%` });

  if (!badges.length) return '';
  return `<section class="section">
    <div class="section-head"><h2>Sustainability Achievements</h2><span class="subtle">Informational only - never affects your score</span></div>
    <div class="chip-toggle-row">${badges.map((b) => `<span class="pill info" title="${escapeHtml(b.label)}">${b.icon} ${escapeHtml(b.label)}</span>`).join('')}</div>
  </section>`;
}

// ── Phase 6: Comparison helper functions ────────────────────────────────────

function compareWinnerBadge(values, winnerFn = Math.max) {
  const finite = values.map((v) => (Number.isFinite(v) ? v : null));
  const best = winnerFn(...finite.filter((v) => v !== null));
  return finite.map((v) => (v !== null && v === best && finite.filter((x) => x === best).length < finite.length)
    ? `<span class="compare-winner" title="Best value">▲ Best</span>`
    : '');
}

function compareWinnerBadgeLow(values) {
  const finite = values.map((v) => (Number.isFinite(v) ? v : null));
  const best = Math.min(...finite.filter((v) => v !== null));
  return finite.map((v) => (v !== null && v === best && finite.filter((x) => x === best).length < finite.length)
    ? `<span class="compare-winner" title="Best value (lower is better)">▼ Best</span>`
    : '');
}

function compareSummary(users) {
  const bullets = [];
  const names = users.map((u) => escapeHtml(u.displayPseudonym));

  const finiteEffs = users.map((u) => u.overallEfficiency).filter(Number.isFinite);
  if (finiteEffs.length >= 2) {
    const effs = users.map((u) => u.overallEfficiency);
    const maxEff = Math.max(...effs.filter(Number.isFinite));
    const minEff = Math.min(...effs.filter(Number.isFinite));
    if (maxEff - minEff > 0.15) {
      const best = users.find((u) => u.overallEfficiency === maxEff);
      const worst = users.find((u) => u.overallEfficiency === minEff);
      bullets.push(`<strong>${escapeHtml(best.displayPseudonym)}</strong> achieves substantially higher resource efficiency (${pct(maxEff)}) compared to <strong>${escapeHtml(worst.displayPseudonym)}</strong> (${pct(minEff)}).`);
    } else {
      bullets.push(`All compared users achieve broadly similar overall efficiency (${pct(minEff)}–${pct(maxEff)}).`);
    }
  }

  const cpuEffs = users.map((u) => u.cpuEfficiency).filter(Number.isFinite);
  if (cpuEffs.length >= 2) {
    const max = Math.max(...cpuEffs);
    const min = Math.min(...cpuEffs);
    if (max - min > 0.15) {
      const best = users.find((u) => u.cpuEfficiency === max);
      bullets.push(`<strong>${escapeHtml(best.displayPseudonym)}</strong> has notably higher CPU efficiency (${pct(max)} vs ${pct(min)}).`);
    }
  }

  const memEffs = users.map((u) => u.memoryEfficiency).filter(Number.isFinite);
  if (memEffs.length >= 2) {
    const max = Math.max(...memEffs);
    const min = Math.min(...memEffs);
    if (max - min > 0.15) {
      const best = users.find((u) => u.memoryEfficiency === max);
      bullets.push(`<strong>${escapeHtml(best.displayPseudonym)}</strong> uses memory more efficiently (${pct(max)} vs ${pct(min)}).`);
    }
  }

  const jobs = users.map((u) => u.totalJobs);
  if (Math.max(...jobs) / Math.max(1, Math.min(...jobs.filter((j) => j > 0))) > 3) {
    const hi = users.reduce((a, b) => a.totalJobs > b.totalJobs ? a : b);
    const lo = users.reduce((a, b) => a.totalJobs < b.totalJobs ? a : b);
    if (hi !== lo) bullets.push(`<strong>${escapeHtml(hi.displayPseudonym)}</strong> runs significantly more jobs (${fmt(hi.totalJobs)}) than <strong>${escapeHtml(lo.displayPseudonym)}</strong> (${fmt(lo.totalJobs)}).`);
  }

  const waits = users.map((u) => u.averageQueueWaitSeconds).filter((w) => w !== null && Number.isFinite(w));
  if (waits.length >= 2) {
    const max = Math.max(...waits);
    const min = Math.min(...waits);
    if (max - min > 300) {
      const lo = users.find((u) => u.averageQueueWaitSeconds === min);
      bullets.push(`<strong>${escapeHtml(lo.displayPseudonym)}</strong> experiences shorter average queue wait times (${Math.round(min / 60)} min vs ${Math.round(max / 60)} min).`);
    }
  }

  const waste = users.map((u) => u.underutilizedCostDkk);
  if (Math.max(...waste) > 0 && Math.max(...waste) / Math.max(1, Math.min(...waste.filter((w) => w > 0))) > 3) {
    const hi = users.reduce((a, b) => a.underutilizedCostDkk > b.underutilizedCostDkk ? a : b);
    bullets.push(`<strong>${escapeHtml(hi.displayPseudonym)}</strong> has the largest estimated savings opportunity (${money(hi.underutilizedCostDkk)}).`);
  }

  const swCounts = users.map((u) => u.softwareCount).filter((s) => s > 0);
  if (swCounts.length >= 2 && Math.max(...swCounts) > Math.min(...swCounts) + 2) {
    const hi = users.find((u) => u.softwareCount === Math.max(...swCounts));
    bullets.push(`<strong>${escapeHtml(hi.displayPseudonym)}</strong> uses a broader software portfolio (${fmt(hi.softwareCount)} modules).`);
  }

  const benchmarks = users.filter((u) => u.isBenchmark);
  const realUsers = users.filter((u) => !u.isBenchmark);
  if (benchmarks.length > 0 && realUsers.length > 0) {
    const ref = benchmarks[0];
    realUsers.forEach((u) => {
      const effDiff = (u.overallEfficiency || 0) - (ref.overallEfficiency || 0);
      if (Math.abs(effDiff) > 0.05) {
        bullets.push(`<strong>${escapeHtml(u.displayPseudonym)}</strong> is ${effDiff > 0 ? `${pct(effDiff)} above` : `${pct(-effDiff)} below`} the <strong>${escapeHtml(ref.displayPseudonym)}</strong> in overall efficiency.`);
      }
    });
  }

  if (!bullets.length) {
    bullets.push(`${names.join(' and ')} show comparable resource usage patterns. Review the metrics below for detailed differences.`);
  }

  return `<div class="compare-summary">
    <div class="compare-summary-title">Executive Summary</div>
    <div class="compare-summary-body"><ul>${bullets.map((b) => `<li>${b}</li>`).join('')}</ul></div>
  </div>`;
}

function compareKpiDashboard(users) {
  const cards = users.map((u) => {
    const isBenchmark = u.isBenchmark;
    const href = isBenchmark ? null : `#/user/${encodeURIComponent(u.publicUserId)}`;
    const nameHtml = href
      ? `<a href="${href}">${escapeHtml(u.displayPseudonym)}</a>`
      : escapeHtml(u.displayPseudonym);
    const label = isBenchmark ? 'Benchmark' : 'User';
    return `<div class="compare-kpi-card${isBenchmark ? ' is-benchmark' : ''}">
      <div class="compare-kpi-user">${label}</div>
      <div class="compare-kpi-name">${nameHtml}</div>
      <div class="compare-kpi-leaf">
        ${leafIndexBadge(u, 'lg')}
      </div>
      <div class="compare-kpi-stats">
        <div class="compare-kpi-stat"><span class="compare-kpi-stat-label">Jobs</span><span class="compare-kpi-stat-value">${fmt(u.totalJobs)}</span></div>
        <div class="compare-kpi-stat"><span class="compare-kpi-stat-label">CPU h</span><span class="compare-kpi-stat-value">${fmt(u.cpuHours, 0)}</span></div>
        <div class="compare-kpi-stat"><span class="compare-kpi-stat-label">CPU eff.</span><span class="compare-kpi-stat-value">${efficiencyPill(u.cpuEfficiency)}</span></div>
        <div class="compare-kpi-stat"><span class="compare-kpi-stat-label">Mem eff.</span><span class="compare-kpi-stat-value">${efficiencyPill(u.memoryEfficiency)}</span></div>
        <div class="compare-kpi-stat"><span class="compare-kpi-stat-label">Est. cost</span><span class="compare-kpi-stat-value">${money(u.estimatedCostDkk)}</span></div>
        <div class="compare-kpi-stat"><span class="compare-kpi-stat-label">Savings opp.</span><span class="compare-kpi-stat-value">${money(u.underutilizedCostDkk)}</span></div>
      </div>
    </div>`;
  });
  return `<div class="compare-kpi-grid">${cards.join('')}</div>`;
}

function compareWithGroup(currentUserId) {
  const summary = data?.usersSummary;
  const benchmarks = summary?.benchmarkProfiles || [];
  const btnsByBenchmark = benchmarks.map((b) => {
    const href = `#/compare/${encodeURIComponent(currentUserId)}/${encodeURIComponent(b.publicUserId)}`;
    return `<a href="${href}" class="compare-with-btn is-benchmark">${leafIndicator(b.overallEfficiency, 'sm')} ${escapeHtml(b.displayPseudonym)}</a>`;
  });
  const randomUsers = (summary?.users || []).filter((u) => u.publicUserId !== currentUserId);
  const randomUser = randomUsers[Math.floor(Math.random() * randomUsers.length)];
  const randomBtn = randomUser
    ? `<button type="button" class="compare-with-btn" data-action="compare-random" data-base-id="${escapeHtml(currentUserId)}" data-users-json='${JSON.stringify(randomUsers.map((u) => u.publicUserId))}'>Random User</button>`
    : '';
  return `<div class="compare-with-group">
    <span class="compare-with-label">Compare with:</span>
    ${btnsByBenchmark.join('')}
    ${randomBtn}
    <a href="#/users" class="compare-with-btn">Select User…</a>
  </div>`;
}

function compareTrendCharts(users) {
  const usersWithTrends = users.filter((u) => u.trends30d && u.trends30d.length > 0);
  if (!usersWithTrends.length) return '';
  const colors = ['#3e8cff', '#53d88a', '#ffb84d', '#ff6b7a', '#30d5d0'];
  const allDates = [...new Set(usersWithTrends.flatMap((u) => u.trends30d.map((t) => t.d)))].sort();

  const cpuSeries = usersWithTrends.map((u, i) => {
    const byDate = Object.fromEntries((u.trends30d || []).map((t) => [t.d, t.c]));
    return chartSeries(allDates.map((d) => ({ d, val: byDate[d] ?? null })), 'val', escapeHtml(u.displayPseudonym), colors[i % colors.length]);
  });
  const memSeries = usersWithTrends.map((u, i) => {
    const byDate = Object.fromEntries((u.trends30d || []).map((t) => [t.d, t.m]));
    return chartSeries(allDates.map((d) => ({ d, val: byDate[d] ?? null })), 'val', escapeHtml(u.displayPseudonym), colors[i % colors.length]);
  });
  const rows = allDates.map((d) => ({ report_date: d }));

  return `${lineChart('CPU Efficiency (30-day trend)', rows, cpuSeries, pct, { zeroBase: true })}
    ${lineChart('Memory Efficiency (30-day trend)', rows, memSeries, pct, { zeroBase: true })}`;
}

function usersCompareBar() {
  const sel = state.comparison.selected;
  if (sel.length < 2) return '';
  const summary = data?.usersSummary;
  const labels = sel.map((id) => {
    const u = summary?.byId?.[id];
    const pseudonym = u?.displayPseudonym;
    const isBenchmark = u?.isBenchmark;
    return `<span class="compare-bar-chip${isBenchmark ? ' is-benchmark' : ''}">${escapeHtml(pseudonym || id)}</span>`;
  });
  const href = `#/compare/${sel.map(encodeURIComponent).join('/')}`;
  return `<div class="compare-bar">
    <span class="compare-bar-label">Comparing:</span>
    ${labels.join('')}
    <a href="${href}" class="btn btn-primary compare-bar-btn">Compare →</a>
    <button type="button" class="btn btn-secondary" data-action="clear-comparison">Clear</button>
  </div>`;
}

function usersExplorerTable(rows) {
  const selected = new Set(state.comparison.selected);
  const headers = `<tr>
    <th class="col-check"><span class="sr-only">Compare</span></th>
    ${usersExplorerSortHeader('User', 'pseudonym')}
    ${usersExplorerSortHeader('Jobs', 'total_jobs')}
    ${usersExplorerSortHeader('CPU hours', 'cpu_hours')}
    ${usersExplorerSortHeader('GPU hours', 'gpu_hours')}
    ${usersExplorerSortHeader('Efficiency (180d)', 'efficiency')}
    ${usersExplorerSortHeader('Last active', 'last_active')}
    ${usersExplorerSortHeader('Est. cost', 'cost')}
    ${usersExplorerSortHeader('Recs', 'recommendations')}
  </tr>`;
  const body = rows.length
    ? rows.map((u) => `<tr${selected.has(u.publicUserId) ? ' class="compare-selected"' : ''}>
        <td class="col-check"><input type="checkbox" class="compare-checkbox" data-action="toggle-compare" data-user-id="${escapeHtml(u.publicUserId)}"${selected.has(u.publicUserId) ? ' checked' : ''} aria-label="Select ${escapeHtml(u.displayPseudonym)} for comparison" /></td>
        <td><a href="#/user/${encodeURIComponent(u.publicUserId)}" class="user-table-link">${escapeHtml(u.displayPseudonym)}</a></td>
        <td>${fmt(u.totalJobs)}</td>
        <td>${fmt(u.cpuHours, 1)}</td>
        <td>${u.gpuHours > 0 ? fmt(u.gpuHours, 1) : '<span class="subtle">—</span>'}</td>
        <td><div class="leaf-cell">${leafIndicator(windowOverallEfficiency(u))}${efficiencyPill(windowOverallEfficiency(u))}</div></td>
        <td>${u.lastActive || '<span class="subtle">—</span>'}</td>
        <td>${money(u.estimatedCostDkk)}</td>
        <td>${u.recommendationCount > 0 ? `<span class="pill warn">${u.recommendationCount}</span>` : '<span class="subtle">—</span>'}</td>
      </tr>`).join('')
    : `<tr><td colspan="9"><div class="empty-state">No users match the current search or filters.</div></td></tr>`;
  return `<table><thead>${headers}</thead><tbody>${body}</tbody></table>`;
}

function usersExplorerPagination(page, totalPages, total) {
  if (totalPages <= 1) return '';
  return `<div class="pagination">
    <button type="button" class="btn" data-action="page-users-explorer" data-direction="prev" ${page <= 1 ? 'disabled' : ''}>&larr; Prev</button>
    <span class="subtle">Page ${page} of ${totalPages} &mdash; ${fmt(total)} users</span>
    <button type="button" class="btn" data-action="page-users-explorer" data-direction="next" ${page >= totalPages ? 'disabled' : ''}>Next &rarr;</button>
  </div>`;
}

function usersExplorerFilterBar() {
  const { filters } = state.usersExplorer;
  const sel = (action, opts, current) =>
    `<select data-action="${action}">${opts.map(([v, l]) => `<option value="${v}"${current === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  return `<div class="filter-bar">
    <div class="filter-field"><span>Activity</span>${sel('filter-users-activity', [
      ['all', 'All time'], ['today', 'Active today'], ['7d', 'Last 7 days'],
      ['30d', 'Last 30 days'], ['90d', 'Last 90 days'], ['inactive', 'Inactive (>90 d)'],
    ], filters.activity)}</div>
    <div class="filter-field"><span>Resource</span>${sel('filter-users-resource', [
      ['all', 'All users'], ['gpu', 'GPU users'], ['cpu', 'CPU-only users'],
    ], filters.resource)}</div>
    <div class="filter-field"><span>Efficiency</span>${sel('filter-users-efficiency', [
      ['all', 'Any'], ['under50', '<50%'], ['50-70', '50–70%'], ['70-90', '70–90%'], ['over90', '>90%'],
    ], filters.efficiency)}</div>
    <div class="filter-field"><span>Jobs</span>${sel('filter-users-jobs', [
      ['all', 'Any count'], ['over10', '>10'], ['over100', '>100'], ['over500', '>500'],
    ], filters.jobs)}</div>
  </div>`;
}

function userPage() {
  const summary = data?.usersSummary;
  if (!summary?.available) {
    return `<div class="stack">
      ${analyticsStatusBar()}
      <div class="empty-state">User summary data is not yet available in this export. Run the updated export pipeline to generate global/users_summary.json.</div>
    </div>`;
  }
  const filtered = usersExplorerFiltered();
  const totalPages = Math.max(1, Math.ceil(filtered.length / USERS_EXPLORER_PAGE_SIZE));
  const page = Math.min(Math.max(1, state.usersExplorer.page), totalPages);
  const pageRows = filtered.slice((page - 1) * USERS_EXPLORER_PAGE_SIZE, page * USERS_EXPLORER_PAGE_SIZE);
  return `
    <div class="stack">
      ${analyticsStatusBar()}
      <section class="section">
        <div class="section-head"><h2>All Users</h2><span class="subtle">${fmt(summary.users.length)} pseudonymous users · ${fmt(filtered.length)} shown</span></div>
        <p class="subtle">Every user is identified by a stable pseudonym only. No usernames, emails, or account names are exposed. Click any row to open a full analytics profile.</p>
        ${usersExplorerFilterBar()}
        <div class="table-toolbar">
          <input type="search" class="search" data-action="search-users-explorer" placeholder="Search by pseudonym…" value="${escapeHtml(state.usersExplorer.search)}" />
        </div>
        ${usersCompareBar()}
        <div class="table-card">${usersExplorerTable(pageRows)}</div>
        ${usersExplorerPagination(page, totalPages, filtered.length)}
      </section>
    </div>`;
}

function userProfilePage(publicUserId) {
  requestUserBundle(publicUserId);
  const su = data?.usersSummary?.byId?.[publicUserId];
  const pseudonym = su?.displayPseudonym || publicUserId;
  const compareIds = state.comparison.selected.filter((id) => id !== publicUserId);
  const compareHref = compareIds.length >= 1
    ? `#/compare/${[publicUserId, ...compareIds].map(encodeURIComponent).join('/')}`
    : null;
  const compareButton = compareHref
    ? `<a href="${compareHref}" class="btn btn-secondary">Compare ↔</a>`
    : `<button type="button" class="btn btn-secondary" data-action="add-to-compare" data-user-id="${escapeHtml(publicUserId)}" title="Select this user for comparison">+ Add to Compare</button>`;
  const backLink = `<div class="profile-actions">${compareButton}<a href="#/users" class="btn btn-secondary">&larr; All Users</a></div>
    ${compareWithGroup(publicUserId)}`;

  if (userProfileLoading.has(publicUserId)) {
    return `<div class="stack"><div class="profile-hero"><div><div class="context-label">User Profile</div><h1>${escapeHtml(pseudonym)}</h1></div>${backLink}</div><div class="empty-state">Loading…</div></div>`;
  }
  const bundle = userProfileCache.get(publicUserId);
  if (!bundle) {
    return `<div class="stack"><div class="profile-hero"><div><div class="context-label">User Profile</div><h1>${escapeHtml(pseudonym)}</h1></div>${backLink}</div><div class="empty-state">Profile unavailable for this user.</div></div>`;
  }

  const summary = asObject(bundle.all_time_summary);
  const trends = asArray(bundle.daily_trends);
  const recs = asArray(bundle.recommendations);
  const topJobs = asArray(bundle.top_inefficient_jobs);
  const rolling = asObject(bundle.rolling_summaries);
  const rolling180 = asObject(rolling['180d']);

  const effTone = (v) => (v === null || !Number.isFinite(v)) ? '' : v >= 0.7 ? 'good' : v >= 0.5 ? 'info' : 'warn';

  // Phase 8: leafBadgeSource is the raw bundle (bundle.leaf, 180d rolling) -
  // no longer a mix of the normalized users_summary row and the lifetime
  // all_time_summary. su is still used for percentile context/pseudonym.
  const leafBadgeSource = bundle;
  const leaf = leafBlockOf(bundle);
  const windowCpuEff = leafComponentFromBlock(leaf, 'cpu');
  const windowMemEff = leafComponentFromBlock(leaf, 'memory');
  const kpiCards = `<div class="cards-grid">
    ${statBlock('LEAF Index', leafIndexBadge(leafBadgeSource, 'lg'), leafConfidenceChip(leaf), effTone(windowOverallEfficiency(su || {})))}
    ${statBlock('Jobs', fmt(summary.jobs), `${fmt(summary.completed_jobs)} completed · ${fmt(summary.failed_jobs)} failed`)}
    ${statBlock('CPU hours', fmt(summary.cpu_hours_allocated, 1), 'All-time allocated')}
    ${statBlock('GPU hours', fmt(summary.gpu_hours, 1), 'All-time allocated')}
    ${statBlock('Memory GB·h', fmt(summary.requested_mem_gb_hours, 0), 'All-time requested')}
    ${statBlock('CPU efficiency', `<span class="leaf-pair">${leafIndicator(windowCpuEff)}${efficiencyPill(windowCpuEff)}</span>`, `Measured vs. allocated · ${LEAF_ROLLING_LABEL}`, effTone(windowCpuEff))}
    ${statBlock('Memory efficiency', `<span class="leaf-pair">${leafIndicator(windowMemEff)}${efficiencyPill(windowMemEff)}</span>`, `MaxRSS vs. requested · ${LEAF_ROLLING_LABEL}`, effTone(windowMemEff))}
    ${statBlock('Estimated cost', money(summary.estimated_cost_dkk), 'All-time, based on allocation')}
    ${statBlock(`Savings opportunity${infoTip(LEAF_VS_SAVINGS_TOOLTIP)}`, money(rolling180.underutilized_cost_dkk), `Estimated reducible cost · ${LEAF_ROLLING_LABEL}`, 'warn')}
  </div>`;

  const clusterCtxCards = su ? `<div class="cards-grid">
    ${statBlock('CPU eff. percentile', percentileContext(su.percentileCpu) || '—', 'Among all active users')}
    ${statBlock('Overall eff. percentile', percentileContext(su.percentileEfficiency) || '—', 'Among all active users')}
    ${statBlock('Active days', fmt(su.activeDays), 'Days with at least one job')}
    ${statBlock('Software modules', su.softwareCount > 0 ? fmt(su.softwareCount) : '—', 'Distinct modules loaded')}
    ${statBlock('Favourite partition', su.favoritePartition ? escapeHtml(su.favoritePartition) : '—', 'Most frequently used')}
    ${statBlock('Favourite software', su.favoriteSoftware ? escapeHtml(su.favoriteSoftware) : '—', 'Most-used module')}
  </div>` : '';

  const rollingRows = ['7d', '30d', '90d', '180d'].map((k) => {
    const w = asObject(rolling[k]);
    return [k, fmt(w.jobs), pct(w.avg_cpu_efficiency), pct(w.avg_memory_efficiency), money(w.estimated_cost_dkk), money(w.underutilized_cost_dkk)];
  });

  const jobsRows = topJobs.map((j) => [
    escapeHtml(j.partition_name || '—'),
    pct(j.measured_cpu_efficiency),
    pct(j.memory_efficiency),
    money(j.underutilized_cost_dkk),
    money(j.estimated_cost_dkk),
    fmt(j.elapsed_hours, 1),
    fmt(j.alloc_cpus),
  ]);

  const recCards = recs.length
    ? recs.map((r) => recCard(r.severity || r.priority || 'medium', r.title, r.suggestion || r.detail || '', '')).join('')
    : '<div class="empty-state">No recommendations for this user.</div>';

  const filteredTrends = filterTrendsByPeriod(trends);
  const rangeLabel = USER_PROFILE_RANGES.find((r) => r.id === state.userProfileRange)?.label || '90d';
  const overlays = state.profileChartOverlays;
  const overlayToggles = `<div class="chip-toggle-row">
    <button type="button" class="chip-toggle${overlays.clusterAvg ? ' active' : ''}" data-action="toggle-chart-overlay" data-overlay="clusterAvg">Cluster average</button>
    <button type="button" class="chip-toggle${overlays.benchmark ? ' active' : ''}" data-action="toggle-chart-overlay" data-overlay="benchmark">Top 10% benchmark</button>
  </div>`;
  const clusterTrendRows = filterByRange(data?.clusterSummary?.dailyTrends, USER_PROFILE_RANGE_SELECTOR, state.userProfileRange, 'report_date');
  const top10Benchmark = data?.usersSummary?.benchmarkProfiles?.find((b) => b.publicUserId === 'benchmark_top_10pct');
  const effReferenceLines = [
    ...(overlays.clusterAvg ? [
      { value: meanOf(clusterTrendRows, 'avg_cpu_efficiency'), label: 'Cluster avg CPU', color: '#3e8cff' },
      { value: meanOf(clusterTrendRows, 'avg_memory_efficiency'), label: 'Cluster avg memory', color: '#53d88a' },
    ] : []),
    ...(overlays.benchmark && top10Benchmark ? [
      { value: top10Benchmark.cpuEfficiency, label: 'Top 10% CPU', color: '#ffd166' },
      { value: top10Benchmark.memoryEfficiency, label: 'Top 10% memory', color: '#c084fc' },
    ] : []),
  ].filter((r) => Number.isFinite(r.value));
  const trendCharts = filteredTrends.length
    ? lineChart(`${escapeHtml(pseudonym)} — efficiency`, filteredTrends,
        [chartSeries(filteredTrends, 'avg_cpu_efficiency', 'CPU', '#3e8cff'),
         chartSeries(filteredTrends, 'avg_memory_efficiency', 'Memory', '#53d88a'),
         rollingSeries(filteredTrends, 'avg_cpu_efficiency', 7, 'CPU (7d avg)', '#30d5d0'),
         rollingSeries(filteredTrends, 'avg_memory_efficiency', 7, 'Memory (7d avg)', '#9dd8ff')],
        pct, { zeroBase: true, headlineMode: 'mean', headlineLabel: `Average efficiency (${rangeLabel})`,
               bands: EFFICIENCY_BANDS, referenceLines: effReferenceLines }) +
      lineChart(`${escapeHtml(pseudonym)} — estimated compute cost`, filteredTrends,
        [chartSeries(filteredTrends, 'estimated_cost_dkk', 'Estimated allocation cost', '#3e8cff'),
         chartSeries(filteredTrends, 'underutilized_cost_dkk', 'Potential savings', '#ff6b7a')],
        money, { zeroBase: true, headlineMode: 'sum', headlineLabel: `Total estimated cost (${rangeLabel})` })
    : '<div class="empty-state">No trend data for this period.</div>';

  return `<div class="stack">
    <div class="profile-hero">
      <div>
        <div class="context-label">User Profile</div>
        <h1>${escapeHtml(pseudonym)}</h1>
        <p class="subtle">Last active: ${su?.lastActive || '—'} · Stable pseudonymous identifier</p>
      </div>
      ${backLink}
    </div>
    ${positiveReinforcementBanner(rolling)}
    <section class="section"><div class="section-head"><h2>Summary</h2><span class="subtle">LEAF, efficiency & savings: ${LEAF_ROLLING_LABEL} · volume metrics: all-time totals</span></div>${kpiCards}</section>
    ${leafDashboardSection(leafBadgeSource, filteredTrends, recs, rolling180.underutilized_cost_dkk)}
    ${leafJourneySection(bundle, su)}
    ${sustainabilityAchievements(bundle, su)}
    ${clusterCtxCards ? `<section class="section"><div class="section-head"><h2>Cluster Context</h2><span class="subtle">Position among all users</span></div>${clusterCtxCards}</section>` : ''}
    <section class="section"><div class="section-head"><h2>Rolling Summaries</h2><span class="subtle">Recent windows</span></div><div class="table-card">${tableFromRows(['Window', 'Jobs', 'CPU eff.', 'Mem eff.', 'Est. cost', 'Savings opp.'], rollingRows)}</div></section>
    <section class="section"><div class="section-head"><h2>Daily Trends</h2>${profileRangeButtons()}</div>${overlayToggles}${trendCharts}${disclaimer('Cost figures are allocation-based estimates, not billing figures.')}</section>
    <section class="section"><div class="section-head"><h2>Recommendations</h2><span class="subtle">${recs.length} generated</span></div><div class="rec-list">${recCards}</div></section>
    ${topJobs.length ? `<section class="section"><div class="section-head"><h2>Highest-Impact Jobs</h2><span class="subtle">By savings opportunity</span></div><div class="table-card">${tableFromRows(['Partition', 'CPU eff.', 'Mem eff.', 'Savings opp.', 'Est. cost', 'Elapsed h', 'CPUs'], jobsRows)}</div></section>` : ''}
  </div>`;
}

function userLeaderboard(title, users, valueKey, formatter, limit = 10, showLeaf = false) {
  const sorted = asArray(users)
    .filter((u) => {
      const v = u[valueKey];
      return v !== null && v !== undefined && Number.isFinite(Number(v)) && Number(v) > 0;
    })
    .slice()
    .sort((a, b) => Number(b[valueKey]) - Number(a[valueKey]))
    .slice(0, limit);
  if (!sorted.length) return '';
  const rows = sorted.map((u, i) => {
    const eff = showLeaf ? (u.overallEfficiency ?? null) : null;
    const leafHtml = showLeaf ? `${leafIndicator(eff)} ` : '';
    return `<tr>
      <td><span class="rank-badge">${i + 1}</span></td>
      <td><a href="#/user/${encodeURIComponent(u.publicUserId)}" class="user-table-link">${escapeHtml(u.displayPseudonym)}</a></td>
      <td><div class="leaf-cell">${leafHtml}${formatter(u[valueKey])}</div></td>
    </tr>`;
  }).join('');
  return `<section class="section">
    <div class="section-head"><h2>${escapeHtml(title)}</h2><span class="subtle">Top ${sorted.length}</span></div>
    <div class="table-card"><table><thead><tr><th>#</th><th>User</th><th>Value</th></tr></thead><tbody>${rows}</tbody></table></div>
  </section>`;
}

function userRankingsPage() {
  const summary = data?.usersSummary;
  if (!summary?.available) {
    return `<div class="stack">
      ${analyticsStatusBar()}
      <div class="empty-state">User summary data is not yet available. Run the updated export pipeline to generate global/users_summary.json.</div>
    </div>`;
  }
  const users = summary.users;
  // Phase 8: "Most Sustainable Users" ranks by rolling-window LEAF
  // (leaf.leafIndex, 180d), not lifetime overallEfficiency - each user
  // record gets a flat leafIndex180 so userLeaderboard() (which reads
  // u[valueKey] directly) can rank/format it like any other numeric field.
  const measuredUsers = users
    .filter((u) => u.leaf?.leafIndex != null && u.totalJobs >= 5)
    .map((u) => ({ ...u, leafIndex180: u.leaf.leafIndex }));
  const measuredCpuUsers = users.filter((u) => u.cpuEfficiency !== null && u.totalJobs >= 5);
  const measuredMemUsers = users.filter((u) => u.memoryEfficiency !== null && u.totalJobs >= 5);
  const swUsers = users.filter((u) => u.softwareCount > 0);
  const leafNote = `<section class="section">
    <div class="section-head"><h2>${leafIndicator(0.85, 'lg')} LEAF Sustainability Indicators</h2></div>
    <p class="subtle">The ${leafIndicator(0.85)} green leaf indicates excellent resource efficiency — sustainable, environmentally responsible HPC computing. The ${leafIndicator(0.55)} yellow leaf indicates room for optimisation. The ${leafIndicator(0.15)} red leaf indicates significant waste and optimisation potential. LEAF indicators are shown throughout the platform wherever efficiency is displayed.</p>
  </section>`;
  return `<div class="stack">
    ${analyticsStatusBar()}
    ${infoPanel('About these rankings', 'All users are identified by stable pseudonyms only. Rankings highlight resource usage patterns — not individual performance judgements.')}
    ${leafNote}
    <div class="trend-grid">
      ${userLeaderboard(`Most Sustainable Users (${LEAF_ROLLING_LABEL})`, measuredUsers, 'leafIndex180', (v) => `<span class="leaf-pair">${leafIndicator(v / 100)}${Math.round(v)} / 100</span>`, 10, false)}
      ${userLeaderboard('Highest CPU Efficiency', measuredCpuUsers, 'cpuEfficiency', (v) => `<span class="leaf-pair">${leafIndicator(v)}${pct(v)}</span>`, 10, false)}
      ${userLeaderboard('Highest Memory Efficiency', measuredMemUsers, 'memoryEfficiency', (v) => `<span class="leaf-pair">${leafIndicator(v)}${pct(v)}</span>`, 10, false)}
      ${userLeaderboard('Highest Savings Opportunity', users, 'underutilizedCostDkk', money)}
      ${userLeaderboard('Highest CPU Consumption', users, 'cpuHours', (v) => `${fmt(v, 0)} h`)}
      ${userLeaderboard('Highest GPU Consumption', users, 'gpuHours', (v) => `${fmt(v, 1)} h`)}
      ${userLeaderboard('Most Active Users', users, 'totalJobs', (v) => `${fmt(v)} jobs`)}
      ${userLeaderboard('Largest Memory Consumers', users, 'memoryGbHours', (v) => `${fmt(v, 0)} GB·h`)}
      ${userLeaderboard('Most Software Diversity', swUsers, 'softwareCount', (v) => `${fmt(v)} modules`)}
      ${userLeaderboard('Most Active Days', users, 'activeDays', (v) => `${fmt(v)} days`)}
    </div>
  </div>`;
}

function userCompareSelectorPage() {
  const summary = data?.usersSummary;
  if (!summary?.available) {
    return `<div class="stack">${analyticsStatusBar()}<div class="empty-state">User summary data is not yet available.</div></div>`;
  }
  const sel = state.comparison.selected;
  return `<div class="stack">
    ${analyticsStatusBar()}
    <section class="section">
      <div class="section-head"><h2>Compare Users</h2><span class="subtle">Side-by-side analysis of pseudonymous users</span></div>
      <p class="subtle">Select two or more users from the <a href="#/users">All Users explorer</a> using the checkboxes in the table, then click <strong>Compare →</strong>. All identifiers remain pseudonymous.</p>
      ${sel.length >= 2
        ? `${usersCompareBar()}<p class="subtle" style="margin-top:8px">Or go back to <a href="#/users">All Users</a> to change your selection.</p>`
        : `<div class="empty-state">No users selected yet. <a href="#/users">Go to All Users →</a> and use the checkboxes to pick two users.</div>`}
    </section>
  </div>`;
}

function userComparisonPage(ids) {
  const summary = data?.usersSummary;
  if (!summary?.available) {
    return `<div class="stack">${analyticsStatusBar()}<div class="empty-state">User summary data is not yet available.</div></div>`;
  }
  const users = ids.map((id) => summary.byId[id]).filter(Boolean);
  if (users.length < 2) {
    return `<div class="stack">${analyticsStatusBar()}<div class="empty-state">At least two valid user IDs are required for comparison. <a href="#/users">&larr; Back to All Users</a></div></div>`;
  }

  const dash = '<span class="subtle">—</span>';

  // ── Winner badge helpers: find best value in each row ───────────────────
  const winHigh = (vals) => compareWinnerBadge(vals, Math.max);
  const winLow  = (vals) => compareWinnerBadgeLow(vals);

  const row = (label, rawVals, winBadges) => {
    const cells = rawVals.map((v, i) => {
      const badge = winBadges ? winBadges[i] : '';
      return `<td class="compare-value">${v}${badge}</td>`;
    });
    return `<tr><th class="compare-label">${escapeHtml(label)}</th>${cells.join('')}</tr>`;
  };

  const effRow = (label, key) => {
    const vals = users.map((u) => u[key]);
    const display = vals.map((v) => efficiencyWithLeaf(v));
    return row(label, display, winHigh(vals.map((v) => Number(v))));
  };

  const numRow = (label, displayFn, numFn, preferHigh = true) => {
    const nums = users.map(numFn);
    const display = users.map((u, i) => displayFn(u, i));
    return row(label, display, preferHigh ? winHigh(nums) : winLow(nums));
  };

  const tableRows = [
    effRow('Overall efficiency',  'overallEfficiency'),
    effRow('CPU efficiency',      'cpuEfficiency'),
    effRow('Memory efficiency',   'memoryEfficiency'),
    numRow('Total jobs',          (u) => fmt(u.totalJobs), (u) => u.totalJobs),
    numRow('Completed',           (u) => fmt(u.completedJobs), (u) => u.completedJobs),
    numRow('Failed',              (u) => u.failedJobs > 0 ? `<span class="pill warn">${fmt(u.failedJobs)}</span>` : '<span class="subtle">0</span>', (u) => -u.failedJobs),
    numRow('CPU hours',           (u) => fmt(u.cpuHours, 1), (u) => u.cpuHours),
    numRow('GPU hours',           (u) => u.gpuHours > 0 ? fmt(u.gpuHours, 1) : dash, (u) => u.gpuHours),
    numRow('Memory GB·h',         (u) => fmt(u.memoryGbHours, 0), (u) => u.memoryGbHours),
    numRow('Walltime hours',      (u) => fmt(u.walltimeHours, 1), (u) => u.walltimeHours),
    numRow('Estimated cost',      (u) => money(u.estimatedCostDkk), (u) => u.estimatedCostDkk),
    numRow('Savings opportunity', (u) => money(u.underutilizedCostDkk), (u) => -u.underutilizedCostDkk, false),
    numRow('Avg queue wait',      (u) => u.averageQueueWaitSeconds != null ? `${Math.round(u.averageQueueWaitSeconds / 60)} min` : dash, (u) => -(u.averageQueueWaitSeconds ?? Infinity), false),
    numRow('Active days',         (u) => fmt(u.activeDays), (u) => u.activeDays),
    row('Last active',            users.map((u) => u.lastActive || dash)),
    numRow('Software modules',    (u) => u.softwareCount > 0 ? fmt(u.softwareCount) : dash, (u) => u.softwareCount),
    row('Recommendations',        users.map((u) => {
      if (u.isBenchmark) return dash;
      return u.recommendationCount > 0 ? `<span class="pill warn">${u.recommendationCount}</span>` : dash;
    })),
    row('Favourite partition',    users.map((u) => u.favoritePartition ? escapeHtml(u.favoritePartition) : dash)),
    row('Favourite software',     users.map((u) => u.favoriteSoftware ? escapeHtml(u.favoriteSoftware) : dash)),
    numRow('CPU eff. percentile', (u) => u.percentileCpu !== null ? `${Math.round(u.percentileCpu)}th` : dash, (u) => u.percentileCpu ?? -1),
    numRow('Eff. percentile',     (u) => u.percentileEfficiency !== null ? `${Math.round(u.percentileEfficiency)}th` : dash, (u) => u.percentileEfficiency ?? -1),
  ];

  const userHeaders = users.map((u) => {
    const isBenchmark = u.isBenchmark;
    const inner = isBenchmark
      ? `<span title="${escapeHtml(u.displayPseudonym)}">${escapeHtml(u.displayPseudonym)}</span>`
      : `<a href="#/user/${encodeURIComponent(u.publicUserId)}" class="user-table-link">${escapeHtml(u.displayPseudonym)}</a>`;
    return `<th class="compare-user-head${isBenchmark ? ' is-benchmark' : ''}">${inner}</th>`;
  }).join('');

  // ── Copy URL and CSV export ──────────────────────────────────────────────
  const currentUrl = window.location.href;
  const csvData = [
    ['Metric', ...users.map((u) => u.displayPseudonym)].join(','),
    ['Overall efficiency', ...users.map((u) => u.overallEfficiency ?? '')].join(','),
    ['CPU efficiency', ...users.map((u) => u.cpuEfficiency ?? '')].join(','),
    ['Memory efficiency', ...users.map((u) => u.memoryEfficiency ?? '')].join(','),
    ['Total jobs', ...users.map((u) => u.totalJobs)].join(','),
    ['CPU hours', ...users.map((u) => u.cpuHours)].join(','),
    ['GPU hours', ...users.map((u) => u.gpuHours)].join(','),
    ['Estimated cost (DKK)', ...users.map((u) => u.estimatedCostDkk)].join(','),
    ['Savings opportunity (DKK)', ...users.map((u) => u.underutilizedCostDkk)].join(','),
  ].join('\n');
  const csvBlob = `data:text/csv;charset=utf-8,${encodeURIComponent(csvData)}`;

  const actionsBar = `<div class="compare-actions-bar">
    <button type="button" class="btn btn-secondary" data-action="copy-compare-url" data-url="${escapeHtml(currentUrl)}">Copy URL</button>
    <a href="${csvBlob}" download="comparison-${Date.now()}.csv" class="btn btn-secondary">Export CSV</a>
    <a href="#/users" class="btn btn-secondary">&larr; All Users</a>
  </div>`;

  return `<div class="stack">
    ${analyticsStatusBar()}
    <section class="section">
      <div class="section-head">
        <h2>User Comparison</h2>
        <span class="subtle">${users.length} compared &mdash; all-time aggregates</span>
      </div>
      <p class="subtle">All real users are identified by stable pseudonyms only. Benchmark profiles are synthetic aggregates computed from the full user population.</p>
      ${actionsBar}
      ${compareKpiDashboard(users)}
      ${compareSummary(users)}
      <div class="table-card compare-table-wrapper">
        <table class="compare-table">
          <thead><tr><th class="compare-label">Metric</th>${userHeaders}</tr></thead>
          <tbody>${tableRows.join('')}</tbody>
        </table>
      </div>
    </section>
    ${compareTrendCharts(users)}
  </div>`;
}

function costPage() {
  const allTime = asObject(data?.clusterSummary?.allTime);
  const rows = asArray(data?.clusterSummary?.dailyTrends);
  const windowDays = data?.datasetMeta?.dataWindowDays;
  const windowLabel = windowDays ? `${fmt(windowDays)}-day` : 'recent';
  return `
    <div class="stack">
      ${analyticsStatusBar()}
      ${infoPanel('What drives cost on Mjolnir?', 'Jobs are billed by whichever resource is larger relative to demand: reserved CPU cores or reserved memory. Memory often ends up driving cost because it is easy to over-request "just in case." The Cost-Bearer model looks at each job, decides whether CPU or memory is the dominant cost driver, and estimates the optimization opportunity only on that resource - a conservative, defensible savings number. GPU optimization opportunity is not shown below because GPU utilization is not yet measured on Mjolnir. Future versions of Analytics may also include storage usage and sustainability metrics.')}
      <section class="section"><div class="section-head"><h2>Resource Cost Insights</h2><span class="subtle">Spend, cost drivers, and optimization opportunities</span></div><div class="cards-grid">${[
        statBlock('Estimated cost', money(allTime.estimated_cost_dkk), `${windowLabel} observed cost`),
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
      ${lineChart('Estimated Compute Cost vs. Potential Savings', rows, [chartSeries(rows, 'estimated_cost_dkk', 'Estimated allocation cost', '#3e8cff'), chartSeries(rows, 'underutilized_cost_dkk', 'Potential savings', '#ff6b7a')], money, { zeroBase: true })}
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
  return '<div class="prototype-banner"><strong>Prototype Personal Analytics - Authentication Not Yet Enabled</strong><span>Decision support view. Peer comparisons remain pseudonymous.</span></div>';
}

// Phase 7: cluster-context phrasing - turns an already-exported percentile
// rank (0-100, e.g. su.percentileCpu/percentileEfficiency) into a short,
// human sentence ("Top 10%", "Better than 82% of users"). No new
// computation: purely a presentation layer over existing percentile fields.
function percentileContext(percentile0to100) {
  const n = Number(percentile0to100);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded >= 90) return `Top ${Math.max(1, 100 - rounded)}%`;
  if (rounded >= 50) return `Better than ${rounded}% of users`;
  if (rounded > 0) return `Below median (${rounded}th percentile)`;
  return `${rounded}th percentile`;
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
  const { html } = createBarChart(allRows.map(([label]) => label), allRows.map(([, value]) => value), money, { horizontal: true, color: '#53d88a', label: 'Savings opportunity breakdown', emptyMessage: 'No savings breakdown is available yet.' });
  return `<div class="savings-summary"><div class="savings-total"><span>Total practical opportunity</span><strong>${money(total)}</strong><em>Estimated from your personal bundle and recommendations.</em></div>${html}</div>`;
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

function personalAnalyticsPage() {
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
        <p class="subtle">Public pseudonym <strong>${escapeHtml(vm.displayPseudonym)}</strong>. This view favors action and savings over raw monitoring.</p>
        <a class="btn" href="#/u/${escapeHtml(vm.routeToken)}/report">View Full Report</a>
      </div>
      <div class="decision-summary">
        <span class="subtle">How you compare</span>
        <strong>${comparisonBand.label}</strong>
        <em>${comparisonBand.detail}</em>
      </div>
    </section>
    <div class="stack">
      <section class="section"><div class="section-head"><h2>Priority Actions</h2><span class="subtle">What should I do?</span></div>${priorityActions(vm.recommendations)}</section>
      <section class="section"><div class="section-head"><h2>Potential Savings Breakdown${infoTip('Estimated savings if historical jobs had requested closer to the optimal CPU and memory resources while performing the same work. Based on historical allocation behavior, not a billing figure.')}</h2><span class="subtle">How much can I save?</span></div>${savingsBreakdown(vm.recommendations, metrics)}</section>
      <section class="section"><div class="section-head"><h2>How do I compare?</h2><span class="subtle">Percentile bands, not rank numbers</span></div>${personalContextCards(metrics, percentile)}<div class="metric-explain wide"><strong>How to read these bands</strong><span>Percentile bands summarize position among exported users without exposing exact ranks. Higher savings opportunity means more room to improve, not a badge of failure.</span></div></section>
      <section class="section"><div class="section-head"><h2>Trend evidence</h2><span class="subtle">Why these actions are being recommended</span></div><div class="trend-grid">
        ${lineChart('Efficiency trend evidence', trends, [chartSeries(trends, 'avg_cpu_efficiency', 'CPU efficiency', '#3e8cff'), chartSeries(trends, 'avg_memory_efficiency', 'Memory efficiency', '#53d88a')], pct, { zeroBase: true, bands: EFFICIENCY_BANDS })}
        ${lineChart('Estimated Compute Cost Trend', trends, [chartSeries(trends, 'estimated_cost_dkk', 'Estimated allocation cost', '#3e8cff'), chartSeries(trends, 'underutilized_cost_dkk', 'Potential savings', '#ff6b7a')], money, { zeroBase: true })}
      </div></section>
      <section class="section"><div class="section-head"><h2>Keep perspective: anonymous peers</h2><span class="subtle">Peer comparison stays pseudonymous</span></div>${peerComparisonTable(vm.peerComparisons)}</section>
      <section class="section"><div class="section-head"><h2>Highest-Impact Jobs to Review</h2><span class="subtle">Which jobs offer the most room to improve?</span></div><p class="subtle" style="line-height:1.7">These jobs are shown because they combine cost with low CPU or memory use. Reviewing them can help you adjust similar submissions in the future.</p>${personalJobsTable(vm.topInefficientJobs)}</section>
    </div>`;
}

// Version 1.3 (Reporting & Executive Briefings): thin wrappers handing
// app.js's own module-private state to js/reporting/pages.js's report
// functions, keeping that module decoupled from app.js's private `data`/
// `state` singletons (see js/reporting/pages.js's userReportPage()/
// piReportPage() docstrings).
function piReportPage(piId) {
  return piReportPageImpl(piId, { data });
}
function userReportPage() {
  return userReportPageImpl({
    loading: state.personalLoading,
    error: state.personalError,
    token: state.personalToken,
    viewModel: state.personalViewModel,
  });
}

function methodologyPage() {
  const meta = asObject(data?.datasetMeta);
  const rows = asObject(meta.rowCounts);
  return `
    <div class="stack">
      <section class="section"><div class="section-head"><h2>Data provenance</h2><span class="subtle">Raw jobs to Analytics widgets</span></div><div class="cards-grid">${[
        statBlock('Source database', meta.sourceDatabase || 'Unavailable', 'Analytics export backing this view'),
        statBlock('Coverage window', meta.coverageWindow || 'Unavailable', 'Daily cluster summary range'),
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

// Auto-Refresh status indicator (docs/EXECUTIVE_OVERVIEW.md, "Auto-Refresh").
// Pure presentation - all state (lastUpdatedAt/toast-visible) lives in
// refresh-manager.js so this stays a one-line read on every render() pass.
// #refresh-last-updated keeps a stable id so the manager's 15s tick can
// patch just this text node directly, without forcing a full page re-render.
// Shows both the absolute timestamp (so it's unambiguous and sortable) and
// the relative age (so it's readable at a glance) - the relative half keeps
// advancing every 15s via patchLastUpdatedIndicator() without a full render.
function lastUpdatedFullLabel() {
  const at = getLastUpdatedAt();
  if (!at) return 'never';
  return `${formatLocalTimestamp(at)} (${lastUpdatedLabel()})`;
}
function refreshStatusHtml() {
  return `<span class="refresh-status"><span class="refresh-status-dot" aria-hidden="true"></span>Live<span id="refresh-last-updated" class="refresh-status-updated">Last updated: ${lastUpdatedFullLabel()}</span></span>`;
}

function refreshToastHtml() {
  return `<div id="refresh-toast" class="refresh-toast${isToastVisible() ? ' visible' : ''}" role="status" aria-live="polite">&check; Dashboard updated</div>`;
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
        ${data?.source === 'real-export' ? `<div class="load-banner real"><strong>${dot('green')} Live production data</strong><span>${coverageLabel(warehouseSummary)}</span>${refreshStatusHtml()}</div>` : ''}
        <div class="page">${content}</div>
      </main>
      ${refreshToastHtml()}
    </div>`;
}

function render() {
  document.documentElement.dataset.theme = state.theme;
  // Version 1.3 (Reporting & Executive Briefings): A4 landscape is a
  // whole-document print variant (css/reporting-print.css), not mixed
  // per-page orientation - see that file's header comment for why. Only
  // the Capacity Report's wide utilization tables need it today.
  document.body.classList.toggle('report-landscape', state.route === 'reports-capacity');
  resetChartRegistry();
  platformRegistry = buildPlatformRegistry({ data, nodeInsights, nodeInsightsHistory, slurmAnalyticsPipeline, queueInsights, softwareInventory, softwareIntelligence });
  warehouseSummary = buildWarehouseSummary({ slurmAnalyticsPipeline, nodeInsights });
  const renderers = {
    landing: landingPage,
    cluster: clusterPage,
    'cluster-health': clusterHealthPage,
    rankings: rankingsPage,
    benchmarks: benchmarkPage,
    recommendations: recommendationsPage,
    'inefficient-jobs': inefficientJobsPage,
    'queue-overview': queueOverviewPage,
    'queue-live': queueLivePage,
    'queue-wait-times': queueWaitTimesPage,
    'queue-advisor': queueAdvisorPage,
    'queue-trends': queueTrendsPage,
    infrastructure: infrastructureOverviewPage,
    nodes: nodeInventoryPage,
    hardware: hardwareInventoryPage,
    capacity: capacityPlanningPage,
    warehouse: warehousePage,
    projects: projectsPage,
    pis: pisPage,
    groups: groupsPage,
    sections: sectionsPage,
    users: userPage,
    'user-rankings': userRankingsPage,
    'user-compare': userCompareSelectorPage,
    cost: costPage,
    recovery: recoveryPage,
    methodology: methodologyPage,
    'platform-status': platformStatusPage,
    'software-inventory': softwareInventoryPage,
    'si-overview': softwareIntelligenceOverviewPage,
    'si-most-used': softwareIntelligenceMostUsedPage,
    'si-trending': softwareIntelligenceTrendingPage,
    'si-versions': softwareIntelligenceVersionsPage,
    'si-timeline': softwareIntelligenceTimelinePage,
    'reports-executive': () => executiveReportPage({ data, nodeInsights, queueInsights, slurmAnalyticsPipeline, warehouseSummary }),
    'reports-weekly': () => weeklyReportPage({ data, queueInsights, nodeInsightsHistory, warehouseSummary }),
    'reports-queue': () => queueReportPage(queueInsights),
    'reports-capacity': () => capacityReportPage({ nodeInsights, nodeInsightsHistory, warehouseSummary }),
  };
  const content = isUserReportRoute(state.route)
    ? userReportPage()
    : isPersonalRoute(state.route)
      ? personalAnalyticsPage()
      : isPiReportRoute(state.route)
        ? piReportPage(piReportRouteId(state.route))
        : isNodeDetailRoute(state.route)
          ? nodeDetailPage(nodeDetailRouteName(state.route))
          : isSoftwareModuleDetailRoute(state.route)
            ? moduleDetailPage(softwareModuleDetailKey(state.route))
            : isSoftwareIntelligenceModuleDetailRoute(state.route)
              ? softwareIntelligenceModuleDetailPage(softwareIntelligenceModuleDetailKey(state.route))
              : isSoftwareIntelligenceRelationshipsRoute(state.route)
                ? softwareIntelligenceRelationshipsPage(softwareIntelligenceRelationshipsModuleKey(state.route))
                : isHierarchyDetailRoute(state.route)
                  ? hierarchyDetailPage(detailRouteParts(state.route).type, detailRouteParts(state.route).id)
                  : isUserProfileRoute(state.route)
                    ? userProfilePage(userProfileRouteId(state.route))
                    : isUserComparisonRoute(state.route)
                      ? userComparisonPage(userComparisonRouteIds(state.route))
                      : (renderers[state.route] || renderers.landing)();
  app.innerHTML = renderShell(content);
  wireEvents();
  mountCharts();
  setupChartResize();
}

// --- Auto-Refresh glue (docs/EXECUTIVE_OVERVIEW.md, "Auto-Refresh") ---------
// refresh-manager.js owns scheduling/fetching/merge-on-failure; everything
// here is the small amount of app.js-specific glue it needs: read/write the
// module-level data variables above, and re-render without disturbing what
// the viewer is currently doing (route, scroll position, open <details>).
function currentDataBundle() {
  return { data, nodeInsights, nodeInsightsHistory, slurmAnalyticsPipeline, queueInsights, softwareInventory, softwareIntelligence };
}

function applyDataUpdate(next) {
  data = next.data;
  nodeInsights = next.nodeInsights;
  nodeInsightsHistory = next.nodeInsightsHistory;
  slurmAnalyticsPipeline = next.slurmAnalyticsPipeline;
  queueInsights = next.queueInsights;
  softwareInventory = next.softwareInventory;
  softwareIntelligence = next.softwareIntelligence;
}

// <details> elements (the "Why are there fewer unique jobs..." /
// "How does Mjolnir Analytics work?" disclosures) don't have their
// open/closed state tracked in `state`, so a naive render() would reset
// them to their hardcoded default every time. Identify each by its
// <summary> text (stable across a refresh, since the page being refreshed
// is still the same page) and restore whichever ones were open.
function captureOpenDisclosures() {
  return Array.from(document.querySelectorAll('.page details')).map((el) => ({
    key: el.querySelector('summary')?.textContent?.trim() || '',
    open: el.open,
  }));
}
function restoreOpenDisclosures(saved) {
  const elements = Array.from(document.querySelectorAll('.page details'));
  saved.forEach((entry) => {
    const match = elements.find((el) => (el.querySelector('summary')?.textContent?.trim() || '') === entry.key);
    if (match) match.open = entry.open;
  });
}

// The one render() wrapper a background refresh should ever use: same
// route, same scroll position (window and the scrollable .main panel),
// same open/closed disclosures - the viewer should not notice anything
// happened beyond the numbers updating and the brief toast.
function rerenderPreservingViewState() {
  const scrollY = window.scrollY;
  const mainEl = document.querySelector('.main');
  const mainScrollTop = mainEl ? mainEl.scrollTop : null;
  const savedDisclosures = captureOpenDisclosures();
  // The full innerHTML replace inside render() necessarily disposes and
  // re-inits every ECharts instance - this brief opacity dip masks that as
  // a soft cross-fade instead of an instant pop. Not real DOM diffing (that
  // would need a different rendering model entirely), but enough to keep a
  // background data refresh from looking like a layout jump.
  if (mainEl) mainEl.classList.add('refreshing');
  render();
  restoreOpenDisclosures(savedDisclosures);
  window.scrollTo(0, scrollY);
  const newMainEl = document.querySelector('.main');
  if (newMainEl && mainScrollTop !== null) newMainEl.scrollTop = mainScrollTop;
  requestAnimationFrame(() => newMainEl?.classList.remove('refreshing'));
}

// Cheap, render()-free DOM patches used for the 15s indicator tick and the
// toast show/hide - neither needs to rebuild the page tree, so neither one
// risks the scroll/disclosure state the full rerender above protects.
function patchLastUpdatedIndicator() {
  const el = document.getElementById('refresh-last-updated');
  if (el) el.textContent = `Last updated: ${lastUpdatedFullLabel()}`;
}
function patchToastVisibility(visible) {
  const el = document.getElementById('refresh-toast');
  if (el) el.classList.toggle('visible', visible);
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
  document.querySelector('[data-action="report-download-pdf"]')?.addEventListener('click', () => {
    downloadReportPdf();
  });
  document.querySelector('[data-action="report-download-markdown"]')?.addEventListener('click', () => {
    const model = getCurrentReportModel();
    if (model) downloadReportMarkdown(model, getCurrentReportMarkdown());
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
  document.querySelectorAll('[data-action="set-profile-range"]').forEach((el) => {
    el.addEventListener('click', (event) => {
      state.userProfileRange = event.currentTarget.dataset.range;
      render();
    });
  });
  document.querySelectorAll('[data-action="toggle-chart-overlay"]').forEach((el) => {
    el.addEventListener('click', (event) => {
      const key = event.currentTarget.dataset.overlay;
      state.profileChartOverlays[key] = !state.profileChartOverlays[key];
      render();
    });
  });
  // Software Inventory search: 'input' (not 'change') for instant, every-
  // keystroke filtering. render() rebuilds the whole page, which would
  // normally drop focus/cursor position out of a freshly-typed-in <input> -
  // refocusing and restoring the caret position immediately after is the
  // same fix-up rerenderPreservingViewState() already applies to scroll
  // position and open <details> elsewhere in this file, just scoped to one
  // input instead of the whole page.
  document.querySelector('[data-action="search-software-inventory"]')?.addEventListener('input', (event) => {
    const cursor = event.currentTarget.selectionStart;
    state.softwareInventoryFilters.search = event.currentTarget.value;
    state.softwareInventoryFilters.page = 1;
    render();
    const refocused = document.querySelector('[data-action="search-software-inventory"]');
    if (refocused) {
      refocused.focus();
      refocused.setSelectionRange(cursor, cursor);
    }
  });
  // Software Explorer Milestone 4, Parts 1-2: one click handler for every
  // clickable card and quick-filter-bar button, all wired to the same
  // data-action - this is what "reuse the existing client-side filtering
  // framework" means in practice, not three separate handlers for three
  // visually different UI elements that happen to do the same thing.
  document.querySelectorAll('[data-action="set-quick-filter"]').forEach((el) => {
    el.addEventListener('click', (event) => {
      state.softwareInventoryFilters.quickFilter = event.currentTarget.dataset.filter;
      state.softwareInventoryFilters.page = 1;
      // Badges on the module detail page (Part 10, "clickable badges") use
      // this same data-action - clicking one there must also navigate to
      // the inventory page itself. Setting location.hash triggers the
      // existing 'hashchange' -> handleRoute() -> render() pipeline (no
      // second render path introduced); when already on the inventory
      // page, the hash is unchanged so we render() directly instead.
      if (state.route === 'software-inventory') {
        render();
      } else {
        location.hash = '#/software-inventory';
      }
    });
  });
  document.querySelectorAll('[data-action="sort-software-inventory"]').forEach((el) => {
    el.addEventListener('click', (event) => {
      const key = event.currentTarget.dataset.key;
      if (state.softwareInventoryFilters.sortKey === key) {
        state.softwareInventoryFilters.sortDir = state.softwareInventoryFilters.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.softwareInventoryFilters.sortKey = key;
        state.softwareInventoryFilters.sortDir = 'asc';
      }
      state.softwareInventoryFilters.page = 1;
      render();
    });
  });
  document.querySelectorAll('[data-action="page-software-inventory"]').forEach((el) => {
    el.addEventListener('click', (event) => {
      const direction = event.currentTarget.dataset.direction;
      state.softwareInventoryFilters.page += direction === 'prev' ? -1 : 1;
      render();
    });
  });
  // Software Intelligence: same search/sort/page wiring pattern as
  // Software Inventory above, namespaced for the Most Used Software table.
  document.querySelector('[data-action="search-software-intelligence"]')?.addEventListener('input', (event) => {
    const cursor = event.currentTarget.selectionStart;
    state.softwareIntelligenceFilters.search = event.currentTarget.value;
    state.softwareIntelligenceFilters.page = 1;
    render();
    const refocused = document.querySelector('[data-action="search-software-intelligence"]');
    if (refocused) {
      refocused.focus();
      refocused.setSelectionRange(cursor, cursor);
    }
  });
  document.querySelectorAll('[data-action="sort-software-intelligence"]').forEach((el) => {
    el.addEventListener('click', (event) => {
      const key = event.currentTarget.dataset.key;
      if (state.softwareIntelligenceFilters.sortKey === key) {
        state.softwareIntelligenceFilters.sortDir = state.softwareIntelligenceFilters.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.softwareIntelligenceFilters.sortKey = key;
        state.softwareIntelligenceFilters.sortDir = 'asc';
      }
      state.softwareIntelligenceFilters.page = 1;
      render();
    });
  });
  document.querySelectorAll('[data-action="page-software-intelligence"]').forEach((el) => {
    el.addEventListener('click', (event) => {
      const direction = event.currentTarget.dataset.direction;
      state.softwareIntelligenceFilters.page += direction === 'prev' ? -1 : 1;
      render();
    });
  });
  document.querySelectorAll('[data-action="set-trending-window"]').forEach((el) => {
    el.addEventListener('click', (event) => {
      state.softwareIntelligenceTrendingWindow = event.currentTarget.dataset.window;
      render();
    });
  });
  document.querySelector('[data-action="set-relationship-module"]')?.addEventListener('change', (event) => {
    state.softwareIntelligenceRelationshipsModule = event.currentTarget.value;
    if (state.route === 'si-relationships' || isSoftwareIntelligenceRelationshipsRoute(state.route)) {
      location.hash = `#/si-relationships/${encodeURIComponent(event.currentTarget.value)}`;
    } else {
      render();
    }
  });
  document.querySelector('[data-action="set-timeline-module"]')?.addEventListener('change', (event) => {
    state.softwareIntelligenceTimelineModule = event.currentTarget.value;
    render();
  });
  document.querySelectorAll('[data-action="set-timeline-granularity"]').forEach((el) => {
    el.addEventListener('click', (event) => {
      state.softwareIntelligenceTimelineGranularity = event.currentTarget.dataset.granularity;
      render();
    });
  });
  // Users Explorer: search, sort, filter, pagination — same data-action/
  // rerenderPreservingViewState() pattern as Software Inventory above.
  document.querySelector('[data-action="search-users-explorer"]')?.addEventListener('input', (event) => {
    const cursor = event.currentTarget.selectionStart;
    state.usersExplorer.search = event.currentTarget.value;
    state.usersExplorer.page = 1;
    render();
    const refocused = document.querySelector('[data-action="search-users-explorer"]');
    if (refocused) { refocused.focus(); refocused.setSelectionRange(cursor, cursor); }
  });
  document.querySelectorAll('[data-action="sort-users-explorer"]').forEach((el) => {
    el.addEventListener('click', (event) => {
      const key = event.currentTarget.dataset.key;
      if (state.usersExplorer.sort.key === key) {
        state.usersExplorer.sort.dir = state.usersExplorer.sort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.usersExplorer.sort = { key, dir: key === 'pseudonym' ? 'asc' : 'desc' };
      }
      state.usersExplorer.page = 1;
      render();
    });
  });
  document.querySelectorAll('[data-action="page-users-explorer"]').forEach((el) => {
    el.addEventListener('click', (event) => {
      state.usersExplorer.page += event.currentTarget.dataset.direction === 'prev' ? -1 : 1;
      render();
    });
  });
  document.querySelector('[data-action="filter-users-activity"]')?.addEventListener('change', (event) => {
    state.usersExplorer.filters.activity = event.currentTarget.value;
    state.usersExplorer.page = 1;
    render();
  });
  document.querySelector('[data-action="filter-users-resource"]')?.addEventListener('change', (event) => {
    state.usersExplorer.filters.resource = event.currentTarget.value;
    state.usersExplorer.page = 1;
    render();
  });
  document.querySelector('[data-action="filter-users-efficiency"]')?.addEventListener('change', (event) => {
    state.usersExplorer.filters.efficiency = event.currentTarget.value;
    state.usersExplorer.page = 1;
    render();
  });
  document.querySelector('[data-action="filter-users-jobs"]')?.addEventListener('change', (event) => {
    state.usersExplorer.filters.jobs = event.currentTarget.value;
    state.usersExplorer.page = 1;
    render();
  });
  // User Comparison: toggle individual checkbox, clear all, add from profile page.
  document.querySelectorAll('[data-action="toggle-compare"]').forEach((el) => {
    el.addEventListener('change', (event) => {
      const id = event.currentTarget.dataset.userId;
      if (!id) return;
      const idx = state.comparison.selected.indexOf(id);
      if (event.currentTarget.checked && idx === -1) state.comparison.selected.push(id);
      else if (!event.currentTarget.checked && idx !== -1) state.comparison.selected.splice(idx, 1);
      render();
    });
  });
  document.querySelector('[data-action="clear-comparison"]')?.addEventListener('click', () => {
    state.comparison.selected = [];
    render();
  });
  document.querySelector('[data-action="add-to-compare"]')?.addEventListener('click', (event) => {
    const id = event.currentTarget.dataset.userId;
    if (id && !state.comparison.selected.includes(id)) state.comparison.selected.push(id);
    render();
  });
  document.querySelectorAll('[data-action="copy-compare-url"]').forEach((el) => {
    el.addEventListener('click', (event) => {
      const url = event.currentTarget.dataset.url;
      if (url) navigator.clipboard?.writeText(url).catch(() => {});
      const btn = event.currentTarget;
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    });
  });
  document.querySelectorAll('[data-action="compare-random"]').forEach((el) => {
    el.addEventListener('click', (event) => {
      const baseId = event.currentTarget.dataset.baseId;
      let userIds = [];
      try { userIds = JSON.parse(event.currentTarget.dataset.usersJson || '[]'); } catch (_) { return; }
      if (!baseId || !userIds.length) return;
      const randomId = userIds[Math.floor(Math.random() * userIds.length)];
      window.location.hash = `/compare/${encodeURIComponent(baseId)}/${encodeURIComponent(randomId)}`;
    });
  });

  document.querySelector('[data-recovery-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const username = new FormData(form).get('username');
    state.recoveryStatus = { ok: false, message: 'Submitting recovery request...' };
    render();
    try {
      state.recoveryStatus = await requestAnalyticsRecovery(username);
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

// Software Explorer Milestone 4, Part 10 ("preserve scroll position"):
// state.softwareInventoryFilters already survives navigation untouched
// (handleRoute() never resets it, so quickFilter/search/sort/page are
// "remembered when returning from a detail page" for free) - this map is
// the one piece that genuinely didn't exist before: scroll position per
// route, saved on the way out and restored on the way back in. Distinct
// from rerenderPreservingViewState() below, which handles the background
// auto-refresh case (same route, re-rendered in place); this handles
// navigating between routes via the back button or a breadcrumb link.
const routeScrollPositions = new Map();

function handleRoute() {
  routeScrollPositions.set(state.route, window.scrollY);
  state.route = location.hash.replace('#/', '') || 'landing';
  state.menuOpen = false;
  if (isPersonalRoute(state.route)) {
    loadPersonalRoute(state.route);
  } else {
    loadPersonalRoute(null);
    render();
    const savedScrollY = routeScrollPositions.get(state.route);
    if (savedScrollY) window.scrollTo(0, savedScrollY);
  }
}

window.addEventListener('hashchange', handleRoute);

async function init() {
  [data, nodeInsights, nodeInsightsHistory, slurmAnalyticsPipeline, queueInsights, softwareInventory, softwareIntelligence] = await Promise.all([
    loadMjolnirData(),
    loadNodeInsightsData(),
    loadNodeInsightsHistory(),
    loadSlurmAnalyticsPipelineStatus(),
    loadQueueInsightsData(),
    loadSoftwareInventoryData(),
    loadSoftwareIntelligenceData(),
  ]);
  setLastUpdatedFromBundle(currentDataBundle());
  render();
  if (isPersonalRoute(state.route)) await loadPersonalRoute(state.route);
  startAutoRefresh({
    getCurrent: currentDataBundle,
    applyUpdate: applyDataUpdate,
    rerender: rerenderPreservingViewState,
    updateIndicator: patchLastUpdatedIndicator,
    setToastVisible: patchToastVisibility,
  });
}

init();
