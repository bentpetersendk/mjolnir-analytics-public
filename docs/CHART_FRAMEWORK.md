# Chart Framework

Every visualization on Mjolnir Analytics renders through Apache ECharts via
one shared module, `js/charts.js`. No page builds a chart by hand, and no
page duplicates theme, export, tooltip, or accessibility logic - it all
lives here, once.

## How a chart gets on the page

Page-render functions in `js/app.js` are pure string builders, called
*before* the result is attached to the DOM. A chart call site:

1. Calls one of the `create*()` factories below, which builds an ECharts
   `option` object and calls `registerChart(option, { ...meta })`.
2. `registerChart()` stores `{ option, onClick, csv, label }` in an
   in-memory `Map` keyed by a generated id (`echart-0`, `echart-1`, ...) and
   returns `{ id, html }` - `html` is a placeholder `<div>` the page
   template splices in.
3. Once `app.innerHTML = ...` attaches that markup, `app.js`'s `render()`
   calls `mountCharts()`, which walks the registry, calls
   `echarts.init()` on each id that now exists in the DOM, wires
   click/keyboard drill-down, and mounts the export toolbar.

`resetChartRegistry()` is called once per `render()` pass, before any
page-render function runs, so a previous route's chart options never leak
into the next mount. `disposeCharts()` runs at the top of every
`mountCharts()` call, so there is no leak across route changes or resize
remounts - **this dispose-before-mount ordering is an invariant; do not
reorder it.**

## Factory reference

| Factory | Replaces | Use for |
|---|---|---|
| `createLineChart(title, rows, series, formatter, options)` | hand-rolled inline SVG `lineChart()` | Any daily/hourly trend |
| `createAreaChart(...)` | - | `createLineChart` with `areaStyle` filled |
| `createGauge(pctValue, tone, meta)` | CSS width-percentage bar | Allocation/utilization gauges |
| `createDistribution(values, formatter, tone, opts)` | CSS height-percentage bars | p5/p25/p50/p75/p95 distributions |
| `createFunnel(steps, options)` | CSS arrow diagram | Two-or-more-stage reduction/conversion funnels |
| `createBarChart(categories, values, formatter, options)` | CSS width-percentage rows | Categorical breakdowns, vertical or horizontal |

`rows`/`series` for `createLineChart` follow the same shape the original
`lineChart()` used (`chartSeries()`/`rollingSeries()` in `app.js`) - the
factory is a drop-in upgrade, not a new calling convention.

## Export (PNG / SVG / CSV)

Automatic for every chart - no page ever implements its own export button.

- **PNG**: ECharts' built-in `toolbox.feature.saveAsImage`, baked into
  `baseChartOption()`. Desktop only (icons are too cramped on phone-width
  charts).
- **SVG**: a small custom button in the `.chart-toolbar` row rendered by
  `mountChartToolbar()`, calling `chart.getDataURL({ type: 'svg' })`.
  Available on every chart, including gauges/funnels.
- **CSV**: same toolbar, shown only when the option has tabular series data
  (`chartCsv()` reads `xAxis.data`/`yAxis.data` + `series[].data` - works
  generically for any line/bar/distribution chart, returns `null` for
  gauges/funnels so the button doesn't appear). Default-on for
  `createLineChart`/`createDistribution`/`createBarChart`; pass `csv:
  false` to opt out, or `csv: true` when calling `registerChart()`
  directly for a chart option not built by a factory (see the Node
  Insights history charts in `app.js`).
- **Restore default view / reset zoom**: `toolbox.feature.restore` plus the
  existing `dataZoom` slider/inside-zoom, both already in
  `baseChartOption()`.

## Drill-down navigation

Pass `onClick: '#/route'` to any factory (or to `registerChart()` directly)
to turn the whole chart into a navigation entry point. `mountCharts()`
wires `chart.on('click', ...)` plus an `Enter`/`Space` keydown handler on
the container (it's a real `tabindex="0" role="img"` element) to
`location.hash = onClick` - reusing the app's existing hash-router
(`window.addEventListener('hashchange', handleRoute)`), not a new
navigation system.

Only wire `onClick` to a route that actually exists and that the click
target is the *natural* next level of detail for - a chart should never
surprise the user by becoming a link to somewhere unrelated. Current
examples: the Overview's reduction funnel → `#/warehouse`; the Historical
Trends page's Queue Health chart → `#/queue-overview`; the
Infrastructure/Capacity pages' pressure-trend chart → `#/nodes`. When you
add an `onClick`, also add a one-line "Click chart to..." hint near the
chart so the affordance isn't hidden (see `.chart-drilldown-hint` in
`css/styles.css`).

## Tooltips

`baseChartOption()`'s axis tooltip already shows series name + value with a
smart date/time header (`smartTooltipLabel()` - auto-detects daily
`report_date` vs hourly `timestamp` categories). Two ways to add more
context without a page repeating tooltip logic:

- `options.unitLabel` on `createLineChart()` - one line appended to every
  point's tooltip (e.g. "Share of allocated CPU time actually used").
- `createGauge(pctValue, tone, meta)`'s `meta`: `{ label, allocLabel,
  healthyRange: [min, max], updatedLabel }` - builds a multi-line tooltip
  (value, raw allocation, healthy range, freshness) instead of the bare
  percentage. `createDistribution(...)`'s `sampleLabel` does the same for
  percentile charts ("Based on 14,382 jobs").

Reuse existing thresholds/labels when populating these (e.g.
`ALLOCATION_THRESHOLDS` in `app.js`) - don't invent new analytical
thresholds just to fill a tooltip.

## Event annotations

`js/events.js` exports `OPERATIONAL_EVENTS`, a plain array of
`{ date: 'YYYY-MM-DD', label, type }`. `annotateTimeline(series,
categories, events)` in `charts.js` adds a dashed `markLine` at any event
date that falls inside the chart's plotted category range. `createLineChart`
takes this via `options.events`; charts built from a raw option (like the
Node Insights history builders) call `annotateTimeline()` directly on
`option.series[0]` before registering.

**Adding a future event is a one-line addition to `js/events.js` - never a
code change.**

## Animation & reduced motion

`chartBase()` sets `animationDuration`/`animationDurationUpdate`/easing on
every option. `prefersReducedMotion()` (exported from `charts.js`) checks
`matchMedia('(prefers-reduced-motion: reduce)')` and zeroes all of the above
out when true - the same media query also disables CSS transitions/
keyframes app-wide (see `css/styles.css`). Never add an animation that
bypasses this check.

## Accessibility

- Every `registerChart()` call should pass a descriptive `label`. It
  becomes `role="img" aria-label="<label>"` on the container plus a
  `.sr-only` text node for screen readers - charts are not currently
  keyboard-navigable internally (ECharts has no native keyboard nav), so
  the label is the only thing a screen-reader user gets; make it count.
- `:focus-visible` outlines are global (`css/styles.css`) for every
  interactive element, including chart containers that have `onClick`
  wired (they're real focusable elements with Enter/Space support, not
  just click targets).
- Every factory has a specific empty-state message instead of a blank
  area - pass `emptyMessage` to override the default where the generic
  copy ("No data available for X yet.") isn't specific enough (see the GPU
  hours chart's "No GPU jobs during this period." in `app.js`).

## Loading & refresh

`registerChart()` renders containers with an `is-loading` shimmer class
(CSS keyframe in `styles.css`), removed the instant `mountCharts()` calls
`echarts.init()` on that id. Auto-refresh
(`rerenderPreservingViewState()` in `app.js`) toggles a `.refreshing` class
on `.main` around the `render()` call to cross-fade the swap.

**Known limitation, not silently glossed over**: the app's rendering model
is a full `innerHTML` replace per `render()`, so a data-changed auto-refresh
tick still disposes and re-initializes every chart - the fade above masks
that, it doesn't eliminate it. True zero-flicker incremental updates would
need a different rendering model (DOM diffing or keeping persistent chart
instances across renders) - out of scope for this milestone, flagged here
for whoever picks it up next.

## Trend context: bands, moving averages, reference lines (Phase 7)

Efficiency/sustainability charts should answer "am I improving?" at a
glance, not just plot isolated daily points. `createLineChart()` supports
three additions, all optional and off by default where they'd add clutter:

- **Moving averages** are just another series - call `rollingSeries(rows,
  key, windowSize, label, color)` (in `app.js`) alongside `chartSeries()`
  and pass both in the `series` array. Rendered dashed, no chart-level
  option needed. Used on the user profile's efficiency chart (7-day
  average) and the cluster page's CPU/memory charts (7-day + 30-day).
- **`options.bands`**: `[{ from, to, color }, ...]`, rendered as a
  low-opacity (`0.07`) ECharts `markArea` behind the first series -
  `applyBands()` in `charts.js`. `EFFICIENCY_BANDS`/`LEAF_INDEX_BANDS` in
  `app.js` define the green/amber/red zones once so every chart agrees with
  the LEAF glow tiers (`leafGlowClass()`) on what "good" means.
- **`options.referenceLines`**: `[{ value, label, color }, ...]`, rendered
  as dashed horizontal `markLine`s - `applyReferenceLines()` in
  `charts.js`. Used for the user profile's optional "Cluster average" and
  "Top 10% benchmark" overlays, sourced entirely from already-exported
  aggregates (`clusterSummary.dailyTrends`, `benchmark_profiles`) - no new
  data fetched. These overlays are user-toggled (`state.profileChartOverlays`,
  off by default) via `.chip-toggle` buttons so a first-time viewer sees an
  uncluttered chart.

## Shared time-range selector (Phase 7)

`js/timeRange.js` replaces what used to be two parallel range/button/filter
implementations (`HISTORY_RANGES` for Node/Queue/Infrastructure pages,
`USER_PROFILE_RANGES` for the user profile) with one generic pair:

- `createRangeSelector({ id, ranges, stateKey, action, defaultId })` -
  `ranges` is `[{ id, label, ms }]` (rolling window) or `[{ id, label, days }]`
  (calendar days; `days: null` means "no cutoff", e.g. an "All" option).
- `rangeButtonsHtml(selector, currentId)` - renders the toggle group.
- `filterByRange(rows, selector, currentId, timestampField)` - filters
  `rows` by whichever cutoff the selected range implies.

`HISTORY_RANGES`/`USER_PROFILE_RANGES` in `app.js` are now instances of
`createRangeSelector`; `rangeButtons()`/`filterPointsByRange()` and
`profileRangeButtons()`/`filterTrendsByPeriod()` are thin wrappers so no
existing call site changed. **New dashboards should call
`createRangeSelector()` directly** instead of writing another parallel
range/button/filter trio.

## Deferred / future work

Documented here rather than built, per the "no unnecessary visualizations,
no architecture rewrite" scope of this milestone:

- Full keyboard-drivable chart internals (arrow-key data point navigation) -
  ECharts has no built-in support; would need a custom keyboard layer.
- Brush-selection multi-series comparison - adds interaction complexity
  without a concrete page that currently needs it.
- Incremental DOM patching for genuinely flicker-free auto-refresh (see
  "Loading & refresh" above).
