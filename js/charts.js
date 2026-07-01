// Shared Apache ECharts framework for Mjolnir Analytics (docs/architecture/
// ANALYTICS_WAREHOUSE.md milestone: "migrate all visualizations to
// ECharts"). Every chart on every page goes through this module so theme,
// tooltip styling, legend, responsiveness, and the mount/dispose lifecycle
// are defined exactly once.
//
// Pattern: page-render functions (pure string builders, called before the
// new HTML is attached to the DOM) call one of the create*() factories
// below. Each factory registers its ECharts `option` in an in-memory
// registry keyed by a generated element id and returns `{ id, html }` -
// `html` is a `<div>` placeholder the caller splices into its template.
// After `app.innerHTML = ...` attaches that markup, app.js calls
// mountCharts(), which walks the registry and calls echarts.init() on each
// id that now exists in the DOM. resetChartRegistry() must be called once
// per render() pass, before any page-render function runs, so stale chart
// options from the previous route don't leak into the next mount.
import { chartTimeLabel, chartTimeTooltipLabel } from './status.js';

function asArray(value) { return Array.isArray(value) ? value : []; }
function num(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function escapeHtml(value) { return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }

function cssVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}
function chartTextColor() { return cssVar('--muted', '#90a2bc'); }
function chartLineColor() { return cssVar('--border', 'rgba(147,166,194,0.16)'); }
function chartPct(rawValue) { return rawValue === null || rawValue === undefined ? null : Math.round(Number(rawValue) * 1000) / 10; }
const TONE_VARS = { good: '--green', warn: '--amber', bad: '--red', info: '--blue' };
function toneColor(tone) { return cssVar(TONE_VARS[tone] || TONE_VARS.info, '#3e8cff'); }

// Daily (report_date, "2026-06-15") vs hourly (timestamp, has a "T") data
// share the same chart factories, so axis/tooltip labels auto-detect which
// one they're looking at instead of requiring every caller to say so.
function dailyAxisLabel(value) {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
function dailyTooltipLabel(value) {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
function smartAxisLabel(value) { return String(value).includes('T') ? chartTimeLabel(value) : dailyAxisLabel(value); }
function smartTooltipLabel(value) { return String(value).includes('T') ? chartTimeTooltipLabel(value) : dailyTooltipLabel(value); }

const CHART_MOBILE_BREAKPOINT = 768;
function isMobileChartViewport() {
  return window.matchMedia(`(max-width: ${CHART_MOBILE_BREAKPOINT - 1}px)`).matches;
}

// Animation polish should communicate change, not attract attention - and
// should disappear entirely for visitors who've asked for less motion.
export function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
function animationConfig() {
  if (prefersReducedMotion()) return { animation: false };
  return {
    animation: true,
    animationDuration: 600,
    animationDurationUpdate: 450,
    animationEasing: 'cubicOut',
    animationEasingUpdate: 'cubicOut',
  };
}

// Theme/tooltip base shared by every chart type, time-series or not.
function chartBase() {
  return Object.assign({
    backgroundColor: 'transparent',
    textStyle: { color: chartTextColor(), fontFamily: 'inherit' },
    tooltip: { trigger: 'item', confine: true, extraCssText: 'max-width:90vw;border-radius:10px;' },
  }, animationConfig());
}

// Built into every time-series chart's toolbox: PNG export (ECharts
// built-in feature) and reset zoom/restore (pairs with dataZoom below).
// SVG/CSV export use a small custom HTML toolbar instead (see
// chartToolbarHtml()/wireChartToolbar() below) since neither is a native
// toolbox feature.
function exportToolbox(mobile) {
  if (mobile) return undefined; // toolbox icons are too cramped to be usable at phone width
  return {
    show: true,
    right: 8,
    top: 0,
    iconStyle: { borderColor: chartTextColor() },
    emphasis: { iconStyle: { borderColor: cssVar('--blue', '#3e8cff') } },
    feature: {
      restore: { title: 'Restore default view' },
      saveAsImage: { title: 'Save as PNG', name: 'mjolnir-analytics-chart', backgroundColor: cssVar('--bg', '#05070d') },
    },
  };
}

// Time-series base (line/area charts): responsive legend, dataZoom, and
// category axis with smart date/time labels. Reused by every line-chart
// factory and by the Node Insights history option builders below.
// `unitLabel`, when given, is appended once to every tooltip so values read
// with context ("CPU pressure: 61% (allocated cores)") instead of a bare
// number.
function baseChartOption(categories, extraGrid, { unitLabel } = {}) {
  const mobile = isMobileChartViewport();
  // containLabel lets ECharts grow the grid to fit whatever the y-axis
  // formatter actually produces (e.g. "40,000 DKK") instead of clipping it
  // to a fixed left margin sized for short percentage labels.
  const grid = mobile
    ? Object.assign({ left: 44, right: 12, top: 136, bottom: 56, containLabel: true }, extraGrid)
    : Object.assign({ left: 48, right: 16, top: 44, bottom: 64, containLabel: true }, extraGrid);
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
    : { top: 0, right: 96, textStyle: { color: chartTextColor() } };
  return Object.assign(chartBase(), {
    grid,
    legend,
    toolbox: exportToolbox(mobile),
    tooltip: {
      trigger: 'axis',
      confine: true,
      extraCssText: 'max-width:90vw;border-radius:10px;',
      axisPointer: mobile ? { type: 'line' } : { type: 'cross', label: { color: chartTextColor() } },
      formatter: (params) => {
        const list = Array.isArray(params) ? params : [params];
        if (!list.length) return '';
        const header = smartTooltipLabel(list[0].axisValue);
        const rows = list
          .filter((p) => p.value !== null && p.value !== undefined)
          .map((p) => `${p.marker}${p.seriesName}: <strong>${p.value}</strong>`)
          .join('<br/>');
        return `${header}<br/>${rows}${unitLabel ? `<br/><span style="opacity:.7">${escapeHtml(unitLabel)}</span>` : ''}`;
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
        { color: chartTextColor(), formatter: smartAxisLabel, interval: 'auto' },
        mobile ? { rotate: 45 } : {},
      ),
    },
  });
}

function lineSeries(def, data) {
  return {
    name: def.name,
    type: 'line',
    smooth: true,
    showSymbol: false,
    yAxisIndex: def.axis || 0,
    itemStyle: { color: def.color },
    lineStyle: { color: def.color, width: 2, type: def.dashed ? 'dashed' : 'solid' },
    areaStyle: def.area ? { color: def.color, opacity: 0.12 } : undefined,
    data,
  };
}

// --- Chart registry / mount lifecycle --------------------------------------
// Each entry carries the ECharts option plus the bits mountCharts() needs
// once the element actually exists in the DOM: a route to drill down into
// on click (onClick), and whether to offer a CSV download (csv) alongside
// the always-available PNG/SVG image exports.
let chartRegistry = new Map();
let chartIdCounter = 0;

export function resetChartRegistry() {
  chartRegistry = new Map();
  chartIdCounter = 0;
}

// `label` becomes the chart's accessible name (role="img" aria-label) and
// the basis of a visually-hidden text summary for screen readers - every
// chart on the site should pass one. `onClick`, given a route like
// '#/warehouse', turns the whole chart into a drill-down entry point reusing
// the app's existing hash-based router (no separate navigation system).
// `csv`, when true, adds a CSV download button alongside the PNG/SVG ones
// (only meaningful for charts with tabular series data).
export function registerChart(option, { height, className = '', label, onClick, csv } = {}) {
  const id = `echart-${chartIdCounter++}`;
  chartRegistry.set(id, { option, onClick, csv, label });
  const style = height ? ` style="height:${height}px"` : '';
  const cls = className ? ` ${className}` : '';
  const a11yLabel = label ? escapeHtml(label) : 'Chart';
  const clickable = onClick ? ' chart-container--clickable' : '';
  const html = `<div id="${id}" class="chart-container is-loading${cls}${clickable}"${style} role="img" aria-label="${a11yLabel}" tabindex="${onClick ? '0' : '-1'}">`
    + `<span class="sr-only">${a11yLabel}</span></div>`;
  return { id, html };
}

export function emptyState(message) {
  return `<div class="empty-state">${message}</div>`;
}

let activeCharts = [];
let chartsRenderedForMobile = null;

export function disposeCharts() {
  activeCharts.forEach((chart) => {
    try { chart.dispose(); } catch (error) { /* chart already gone with its DOM node */ }
  });
  activeCharts = [];
  // mountCharts() can re-run without a full innerHTML replace (crossing the
  // mobile breakpoint - see setupChartResize()), so the toolbar siblings
  // inserted by mountChartToolbar() need explicit cleanup or they'd stack.
  document.querySelectorAll('.chart-toolbar').forEach((bar) => bar.remove());
}

// Generic CSV extraction: works for any option built from baseChartOption()
// (category xAxis + named series) or the categorical bar/distribution
// factories - i.e. every chart type except gauge/funnel (single-value,
// nothing tabular to export).
function chartCsv(option) {
  const categories = option?.xAxis?.data || option?.yAxis?.data;
  const series = asArray(option?.series);
  if (!categories || !series.length) return null;
  const header = ['category', ...series.map((s) => s.name || 'value')].join(',');
  const rows = categories.map((cat, i) => [cat, ...series.map((s) => (s.data ? s.data[i] : ''))].join(','));
  return [header, ...rows].join('\n');
}

function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Small custom toolbar for the two exports ECharts' built-in toolbox can't
// do itself (SVG download, CSV download) - PNG/restore/reset-zoom come from
// the toolbox already baked into baseChartOption(). Appended next to the
// chart, not inside it, so it never gets covered by `overflow:hidden` SVG
// content.
function mountChartToolbar(el, chart, entry) {
  const slug = (entry.label || 'chart').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const bar = document.createElement('div');
  bar.className = 'chart-toolbar';

  const svgBtn = document.createElement('button');
  svgBtn.type = 'button';
  svgBtn.className = 'chart-toolbar-btn';
  svgBtn.textContent = 'SVG';
  svgBtn.setAttribute('aria-label', `Save ${entry.label || 'chart'} as SVG`);
  svgBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    const a = document.createElement('a');
    a.href = chart.getDataURL({ type: 'svg' });
    a.download = `${slug}.svg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
  bar.appendChild(svgBtn);

  if (entry.csv && chartCsv(entry.option)) {
    const csvBtn = document.createElement('button');
    csvBtn.type = 'button';
    csvBtn.className = 'chart-toolbar-btn';
    csvBtn.textContent = 'CSV';
    csvBtn.setAttribute('aria-label', `Download ${entry.label || 'chart'} data as CSV`);
    csvBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      downloadText(`${slug}.csv`, chartCsv(entry.option), 'text/csv');
    });
    bar.appendChild(csvBtn);
  }

  el.parentElement?.insertBefore(bar, el);
}

export function mountCharts() {
  disposeCharts();
  delete document.body.dataset.chartsReady;
  if (!window.echarts) return;
  chartsRenderedForMobile = isMobileChartViewport();
  // Readiness signal (Version 1.3, Reporting & Executive Briefings): ECharts'
  // SVG layout can still settle in a microtask/animation-frame after init()+
  // setOption() return, so a headless --print-to-pdf invocation can't just
  // fire on page load - it needs something to wait on. Once every chart
  // mounted this pass has fired its own 'finished' event, mark the body
  // ready; reporting/print.js (and any future headless PDF script) polls
  // this instead of a fixed sleep. Harmless on every other page too - it's
  // just an unused attribute if nothing reads it.
  const pendingIds = new Set(chartRegistry.keys());
  const markFinished = (id) => {
    pendingIds.delete(id);
    if (pendingIds.size === 0) document.body.dataset.chartsReady = 'true';
  };
  if (pendingIds.size === 0) document.body.dataset.chartsReady = 'true';
  chartRegistry.forEach((entry, id) => {
    const el = document.getElementById(id);
    if (!el) { markFinished(id); return; }
    const chart = window.echarts.init(el, null, { renderer: 'svg' });
    chart.on('finished', () => markFinished(id));
    chart.setOption(entry.option);
    el.classList.remove('is-loading');
    if (entry.onClick) {
      // A plain DOM listener on the container (not chart.on('click')) so the
      // whole chart is a drill-down target, not just clicks that land
      // exactly on a series shape (a funnel/line chart has plenty of empty
      // space inside its own bounding box). Guarded by pointer-travel
      // distance so dragging the dataZoom slider/inside-zoom doesn't get
      // misread as a click-to-navigate.
      const go = () => { location.hash = entry.onClick; };
      let downPoint = null;
      el.addEventListener('pointerdown', (event) => { downPoint = { x: event.clientX, y: event.clientY }; });
      el.addEventListener('click', (event) => {
        if (downPoint && Math.hypot(event.clientX - downPoint.x, event.clientY - downPoint.y) > 6) return;
        go();
      });
      el.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); go(); }
      });
    }
    mountChartToolbar(el, chart, entry);
    activeCharts.push(chart);
  });
}

let chartResizeAttached = false;
export function setupChartResize() {
  if (chartResizeAttached) return;
  chartResizeAttached = true;
  // Crossing the mobile breakpoint (e.g. rotating an iPhone) needs a full
  // remount so the legend/grid/axis switch layouts, not just a resize.
  window.addEventListener('resize', () => {
    if (chartsRenderedForMobile !== null && chartsRenderedForMobile !== isMobileChartViewport()) {
      mountCharts();
      return;
    }
    activeCharts.forEach((chart) => chart.resize());
  });
}

// --- Factories --------------------------------------------------------------

// Time-series line/area chart. `rows` is an array of objects with a
// `report_date` (daily) or `timestamp` (hourly) field; `series` is an array
// of `{ label, color, values, dashed?, area? }` built by chartSeries()/
// rollingSeries() in app.js. Replaces the old hand-rolled inline-SVG
// lineChart().
//
// `options` additions over the original signature (all optional, all
// backwards compatible):
//   unitLabel  - one-line context appended to every tooltip
//   onClick    - route ('#/...') to drill into when the chart is clicked
//   csv        - true to offer a CSV download of the plotted series
//   events     - array of { date, label } annotations (see js/events.js);
//                rendered as dashed vertical markLines when their date
//                falls within the plotted range
//   emptyMessage - overrides the default "No data available for <title>."
//   bands      - Phase 7: array of { from, to, color, opacity? } low-opacity
//                background markArea bands (e.g. green/amber/red efficiency
//                bands), drawn behind the first series
//   referenceLines - Phase 7: array of { value, label, color } horizontal
//                markLines (e.g. cluster average or benchmark overlays),
//                drawn on the first series
export function createLineChart(title, rows, series, formatter = (v) => v, options = {}) {
  const allValues = series.flatMap((s) => s.values).filter((v) => Number.isFinite(Number(v)));
  if (!allValues.length) return emptyState(options.emptyMessage || `No data available for ${escapeHtml(title)} yet.`);
  const categories = asArray(rows).map((r) => r.report_date ?? r.timestamp);
  const seriesDefs = series.map((s) => lineSeries({ name: s.label, color: s.color, dashed: s.dashed, area: options.area }, s.values));
  if (options.events?.length) annotateTimeline(seriesDefs[0], categories, options.events);
  if (options.bands?.length) applyBands(seriesDefs[0], options.bands);
  if (options.referenceLines?.length) applyReferenceLines(seriesDefs[0], options.referenceLines);
  const option = Object.assign(baseChartOption(categories, {}, { unitLabel: options.unitLabel }), {
    yAxis: {
      type: 'value',
      min: options.zeroBase === false ? undefined : 0,
      axisLabel: { color: chartTextColor() },
      splitLine: { lineStyle: { color: chartLineColor() } },
    },
    series: seriesDefs,
  });
  const firstSeriesVals = series[0].values.filter((v) => Number.isFinite(Number(v)));
  const headlineMode = options.headlineMode || 'last';
  let headlineValue;
  if (headlineMode === 'sum') headlineValue = firstSeriesVals.reduce((a, b) => a + b, 0);
  else if (headlineMode === 'mean') headlineValue = firstSeriesVals.length ? firstSeriesVals.reduce((a, b) => a + b, 0) / firstSeriesVals.length : null;
  else if (headlineMode === 'max') headlineValue = firstSeriesVals.length ? Math.max(...firstSeriesVals) : null;
  else headlineValue = allValues[allValues.length - 1];
  const headlineLabel = options.headlineLabel || `${asArray(rows).length} data points`;
  const { html } = registerChart(option, { label: options.label || title, onClick: options.onClick, csv: options.csv !== false });
  return `<article class="chart-card">
    <div class="chart-head"><div><h3>${escapeHtml(title)}</h3><span class="subtle">${headlineLabel}</span></div><strong>${headlineValue !== null && headlineValue !== undefined ? formatter(headlineValue) : '—'}</strong></div>
    ${html}
  </article>`;
}

// Phase 7: subtle background bands (e.g. green ≥0.70 / amber 0.40-0.70 /
// red <0.40 efficiency zones) so a chart communicates "am I improving?" at
// a glance instead of requiring the reader to compare against a remembered
// threshold. Deliberately low-opacity and unlabeled by default so a chart
// with bands off still reads exactly like one without this option.
export function applyBands(series, bands) {
  if (!series || !bands?.length) return;
  series.markArea = {
    silent: true,
    itemStyle: { opacity: 0.07 },
    data: bands.map((b) => [
      { yAxis: b.from, itemStyle: { color: b.color } },
      { yAxis: b.to },
    ]),
  };
}

// Phase 7: horizontal reference lines (cluster average, benchmark profiles)
// drawn on top of a chart's own series - purely visual comparison, no new
// data fetched (values come from already-exported aggregates/benchmarks).
export function applyReferenceLines(series, referenceLines) {
  if (!series || !referenceLines?.length) return;
  const existing = series.markLine;
  const data = referenceLines
    .filter((r) => Number.isFinite(Number(r.value)))
    .map((r) => ({
      name: r.label || '',
      yAxis: Number(r.value),
      lineStyle: { color: r.color || cssVar('--muted', '#90a2bc'), type: 'dashed', width: 1 },
      label: { color: chartTextColor(), fontSize: 11, formatter: (p) => p.name },
    }));
  if (!data.length) return;
  series.markLine = {
    silent: true,
    symbol: 'none',
    data: [...(existing?.data || []), ...data],
  };
}

// Adds dashed vertical markLines for operational events (js/events.js) that
// fall within `categories`' date range, onto the first series of a
// time-series chart. Future events only need an entry in js/events.js - no
// code change here. Exported so any chart option built from
// baseChartOption() (not just createLineChart()) can opt in, e.g. the
// Node Insights capacity-history chart.
export function annotateTimeline(series, categories, events) {
  if (!series || !categories.length) return;
  const dateOf = (cat) => String(cat).slice(0, 10);
  const catDates = categories.map(dateOf);
  const matches = asArray(events).filter((e) => catDates.includes(e.date));
  if (!matches.length) return;
  series.markLine = {
    silent: false,
    symbol: 'none',
    lineStyle: { color: cssVar('--amber', '#ffb84d'), type: 'dashed', width: 1.5 },
    label: { color: chartTextColor(), fontSize: 11, formatter: (p) => p.name },
    data: matches.map((e) => ({ name: e.label, xAxis: catDates.indexOf(e.date) })),
  };
}

export function createAreaChart(title, rows, series, formatter = (v) => v, options = {}) {
  return createLineChart(title, rows, series, formatter, Object.assign({}, options, { area: true }));
}

// Allocation gauge (CPU/memory/GPU). Replaces the CSS width-percentage bar
// in the old allocationGauge(). `pctValue` is a 0..1 fraction or null;
// `tone` picks the progress-arc color (good/warn/bad/info). `meta` is
// optional rich-tooltip context: { label, allocLabel, healthyRange: [min,
// max] (0-100 each), updatedLabel }. Returns the registerChart() fragment
// only - callers build the surrounding card.
export function createGauge(pctValue, tone = 'info', meta = {}) {
  const value = pctValue === null ? 0 : Math.round(pctValue * 1000) / 10;
  const [rangeMin, rangeMax] = meta.healthyRange || [];
  const option = Object.assign(chartBase(), {
    tooltip: {
      show: true,
      trigger: 'item',
      confine: true,
      formatter: () => {
        const lines = [`<strong>${meta.label || 'Allocation'}</strong>`];
        lines.push(pctValue === null ? 'No data' : `${value}% allocated`);
        if (meta.allocLabel) lines.push(meta.allocLabel);
        if (rangeMin != null && rangeMax != null) lines.push(`Healthy operating range: ${rangeMin}-${rangeMax}%`);
        if (meta.updatedLabel) lines.push(`<span style="opacity:.7">Updated ${meta.updatedLabel}</span>`);
        return lines.join('<br/>');
      },
    },
    series: [{
      type: 'gauge',
      startAngle: 210,
      endAngle: -30,
      min: 0,
      max: 100,
      radius: '95%',
      center: ['50%', '62%'],
      progress: { show: true, width: 12, itemStyle: { color: toneColor(tone) } },
      axisLine: { lineStyle: { width: 12, color: [[1, chartLineColor()]] } },
      pointer: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { show: false },
      title: { show: false },
      detail: {
        valueAnimation: true,
        formatter: () => (pctValue === null ? '-' : `${value}%`),
        color: chartTextColor(),
        fontSize: 22,
        offsetCenter: [0, '4%'],
      },
      data: [{ value }],
    }],
  });
  return registerChart(option, { height: 150, label: meta.label || 'Allocation gauge', onClick: meta.onClick });
}

// p5/p25/p50/p75/p95 distribution. Replaces the CSS height-percentage bars
// in the old percentileBar(). `sampleLabel` (e.g. "Based on 14,382 jobs")
// is optional rich-tooltip context. Returns the registerChart() fragment
// only - callers build the surrounding card.
export function createDistribution(values, formatter, tone = 'info', { sampleLabel, label, csv } = {}) {
  const keys = ['5', '25', '50', '75', '95'];
  const nums = keys.map((key) => num(values[key]));
  if (!nums.some((n) => n !== 0)) return emptyState('No distribution data available for this period.');
  const option = Object.assign(chartBase(), {
    tooltip: {
      trigger: 'axis',
      confine: true,
      formatter: (params) => {
        const lines = [`p${params[0].name}`, `${params[0].marker}${formatter(nums[params[0].dataIndex])}`];
        if (sampleLabel) lines.push(`<span style="opacity:.7">${escapeHtml(sampleLabel)}</span>`);
        return lines.join('<br/>');
      },
    },
    grid: { left: 12, right: 16, top: 16, bottom: 32, containLabel: true },
    xAxis: {
      type: 'category',
      data: keys,
      axisLine: { lineStyle: { color: chartLineColor() } },
      axisLabel: { color: chartTextColor(), formatter: (v) => `p${v}` },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: chartTextColor(), formatter: (v) => formatter(v) },
      splitLine: { lineStyle: { color: chartLineColor() } },
    },
    series: [{
      type: 'bar',
      name: 'value',
      data: nums,
      barWidth: '55%',
      itemStyle: { color: toneColor(tone), borderRadius: [6, 6, 0, 0] },
    }],
  });
  return registerChart(option, { height: 240, label: label || 'Percentile distribution', csv: csv !== false });
}

// Two-stage reduction funnel (Accounting Records -> Canonical Jobs).
// Replaces the CSS arrow diagram in the old reductionFunnel().
const FUNNEL_COLORS = ['--blue', '--cyan'];
export function createFunnel(steps, options = {}) {
  if (!steps.some((s) => num(s.value) > 0)) return emptyState('No warehouse volume recorded for this period yet.');
  const data = steps.map((s, i) => ({ name: s.name, value: num(s.value), itemStyle: { color: cssVar(FUNNEL_COLORS[i % FUNNEL_COLORS.length], '#3e8cff') } }));
  const option = Object.assign(chartBase(), {
    tooltip: { trigger: 'item', confine: true, formatter: (p) => `${p.name}: <strong>${p.value.toLocaleString()}</strong>` },
    series: [{
      type: 'funnel',
      left: '4%',
      right: '4%',
      top: 8,
      bottom: 8,
      sort: 'descending',
      gap: 4,
      label: { color: chartTextColor(), formatter: '{b}\n{c}' },
      itemStyle: { borderColor: chartLineColor(), borderWidth: 1 },
      data,
    }],
  });
  return registerChart(option, { height: 200, label: options.label || 'Reduction funnel', onClick: options.onClick });
}

// Generic bar chart (vertical or horizontal). Replaces the CSS
// width-percentage rows in the old savingsBreakdown().
export function createBarChart(categories, values, formatter, options = {}) {
  if (!categories.length || !values.some((v) => num(v) !== 0)) return emptyState(options.emptyMessage || 'No data available for this breakdown yet.');
  const horizontal = Boolean(options.horizontal);
  const valueAxis = {
    type: 'value',
    axisLabel: { color: chartTextColor(), formatter: (v) => formatter(v) },
    splitLine: { lineStyle: { color: chartLineColor() } },
  };
  const categoryAxis = {
    type: 'category',
    data: categories,
    axisLine: { lineStyle: { color: chartLineColor() } },
    axisLabel: { color: chartTextColor() },
  };
  const option = Object.assign(chartBase(), {
    tooltip: {
      trigger: 'axis',
      confine: true,
      axisPointer: { type: 'shadow' },
      formatter: (params) => `${params[0].name}<br/>${params[0].marker}${formatter(params[0].value)}`,
    },
    grid: horizontal
      ? { left: 12, right: 24, top: 16, bottom: 16, containLabel: true }
      : { left: 12, right: 16, top: 16, bottom: 48, containLabel: true },
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal ? categoryAxis : valueAxis,
    series: [{
      type: 'bar',
      data: values,
      barWidth: '55%',
      itemStyle: { color: options.color || cssVar('--blue', '#3e8cff'), borderRadius: horizontal ? [0, 6, 6, 0] : [6, 6, 0, 0] },
    }],
  });
  return registerChart(option, {
    height: options.height || Math.max(160, categories.length * 36),
    label: options.label || 'Bar chart',
    onClick: options.onClick,
    csv: options.csv !== false,
  });
}

// --- Node Insights history option builders (unchanged math, now routed
// through the same registerChart()/mountCharts() path as every other
// chart instead of being special-cased). ---------------------------------
export function capacityHistoryChartOption(points) {
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

export function drainingHistoryChartOption(points) {
  const categories = points.map((p) => p.timestamp);
  const seriesDefs = [
    { key: 'available_nodes', name: 'Available', color: cssVar('--green', '#53d88a') },
    { key: 'draining_nodes', name: 'Draining', color: cssVar('--amber', '#ffb84d') },
    { key: 'down_nodes', name: 'Down', color: cssVar('--red', '#ff6b7a') },
  ];
  return Object.assign(baseChartOption(categories, {}), {
    yAxis: { type: 'value', name: 'nodes', min: 0, axisLabel: { color: chartTextColor() }, splitLine: { lineStyle: { color: chartLineColor() } } },
    series: seriesDefs.map((def) => lineSeries(def, points.map((p) => (p[def.key] === null || p[def.key] === undefined ? null : Number(p[def.key]))))),
  });
}

export function nodeHistoryChartOption(points) {
  const categories = points.map((p) => p.timestamp);
  const seriesDefs = [
    { key: 'cpu_pct', name: 'CPU utilization', color: cssVar('--blue', '#3e8cff') },
    { key: 'mem_pct', name: 'Memory utilization', color: cssVar('--teal', '#2dd4bf') },
    { key: 'gpu_pct', name: 'GPU utilization', color: cssVar('--amber', '#ffb84d') },
  ];
  return Object.assign(baseChartOption(categories, {}), {
    yAxis: { type: 'value', name: '%', min: 0, max: 100, axisLabel: { color: chartTextColor(), formatter: '{value}%' }, splitLine: { lineStyle: { color: chartLineColor() } } },
    series: seriesDefs.map((def) => lineSeries(def, points.map((p) => chartPct(p[def.key])))),
  });
}
