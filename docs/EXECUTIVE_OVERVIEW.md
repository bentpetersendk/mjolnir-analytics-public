# Executive Overview (landing page)

The landing page (`#/landing`, rendered by `landingPage()` in
[`js/app.js`](../js/app.js)) is built to answer four questions within
20-30 seconds:

1. Is Mjolnir healthy?
2. Can users expect long queue times?
3. Did last night's analytics complete successfully?
4. Is there anything requiring attention?

Every section is presentation over data the five module loaders in
`js/data-loader.js` already fetch once at startup (`data`, `nodeInsights`,
`nodeInsightsHistory`, `platformRegistry`/`warehouseSummary`, `queueInsights`).
The page issues no `fetch()` calls of its own and introduces exactly one new
calculation - Cluster Health's max-of-two-already-computed-severities
(Section 1). Every other section is a reused helper, a sort, or a filter over
fields another page on this site already renders, listed below with its
exact source so nothing here drifts into a second, slightly different
definition of a number another page already shows.

## Section 1: Cluster Health

`clusterHealthState()` combines two values every other page already trusts:

- `platformHealth(platformRegistry)` (`js/status.js`) - the aggregate of
  Analytics Pipeline + Analytics Warehouse + Node Insights + Queue Insights
  collector freshness, exactly as shown on `#/platform-status`.
- `queueInsights.currentPressure.queue_health.label` - the live Queue Health
  label shown on `#/queue-overview`.

Each is mapped to a severity (0 = healthy, 1 = warning, 2 = critical/failed):

| platformHealth().status | severity | queue_health.label | severity |
|---|---|---|---|
| healthy | 0 | Healthy / Busy | 0 |
| warning / unknown | 1 | Congested | 1 |
| degraded / critical | 2 | Severely Congested | 2 |

The hero shows `max(platformSeverity, queueSeverity)` re-expressed as
Healthy / Warning / Critical. No new freshness threshold is introduced -
this is a pure `Math.max()` over two numbers other pages already compute.

## Section 2: Current Cluster Status

| KPI | Source |
|---|---|
| Running / Pending Jobs | `queueInsights.currentPressure.queue` (authoritative live queue source) |
| Queue Health | `queueInsights.currentPressure.queue_health` |
| Current Wait Time | `clusterWaitSeriesRows(queueInsights.waitTimeHistory.series)`, latest day, median |
| Nodes Online / Draining | `nodeInsights.clusterOverview.totals` |
| GPUs Busy, CPU/Memory Utilization | `nodeInsights.clusterOverview.{gpu,cpu,memory_mib}` |

**Omitted: "Users Active Today."** No collector exposes a daily-active-user
count anywhere in the platform today. This page never approximates a metric
that doesn't exist - it would need a new collector field, not frontend work.

## Section 3: Overnight Summary

Reads `warehouseSummary.overnight` - real deltas from
`export_dashboard_data.py`'s `overnight_deltas()` (private repo), computed
from data the import/materialize stages already wrote
(`import_files`, `job_metrics`, `daily_account_summary`,
`daily_partition_summary`, `daily_project_summary`). Never inferred; `null`
fields render "N/A", not a guessed value.

**Deferred (rendered as "N/A", not approximated):** database-size growth and
coverage-window (earliest/latest date) change. Nothing currently retains
yesterday's `status.json` to diff against - `status.json` is overwritten
nightly, not versioned. A future iteration could have
`update_warehouse_stats.py` stash yesterday's `database_size_bytes`/
`earliest_date`/`latest_date` into `warehouse_metadata` before overwriting
them, the same pattern every other field here already uses.

## Section 4: Warehouse Summary

`warehouseStatusCard()` and `warehouseSummaryTiles()` - the exact functions
the dedicated `#/warehouse` page renders. `reductionFunnel()` is the one new
presentational piece (Accounting Records -> Canonical Jobs -> Ratio).

## Section 5: Queue Summary

Pure presentation over `queueInsights`, reusing `queueHealthBadge()`,
`clusterWaitSeriesRows()`, `durationLabel()`, `hourLabel()`. Most/least busy
partition is a sort (not a calculation) of `currentPressure.by_partition` by
live load (`running + pending`); best submission window is the same
lowest-median-wait sort `queueAdvisorPage()` performs.

## Section 6: Current Alerts

Built only from health/threshold computations made elsewhere:

- `collectorHealth(module)` per `platformRegistry` entry - warning/critical/
  failed collectors become alerts.
- `partitionsUnderPressure()` (shared with `queueOverviewPage()`) when Queue
  Health is Congested or Severely Congested.
- `nodeInsights.clusterOverview.maintenance.nodes` - one informational alert
  per draining node, the same list `infrastructureOverviewPage()` shows.

No new threshold is introduced. Empty list renders "No active alerts."

## Section 7: Recommendations

`executiveRecommendations()` decision rules - each reads fields already
loaded for Sections 2-6; a rule whose inputs are unavailable is omitted, never
replaced with a guess:

1. Queue Congested/Severely Congested and a saturated partition exists ->
   "*partition or GPU* users should expect longer waits today."
2. Queue Health score improved by more than 5 points over the last 7
   `queueHealthHistory` points -> "The queue is improving compared to the
   last week."
3. A best submission window exists in `submissionPatterns` -> "Best
   submission window begins around *hour* (*partition*)."
4. Warehouse imported new canonical jobs within the last 24h
   (`overnight.new_canonical_jobs > 0` and `lastImportAt` < 24h old) ->
   "Warehouse updated successfully overnight."
5. Nodes are draining for maintenance -> "Node maintenance has reduced
   available capacity by *pct*."

## Section 8: Platform Overview

Thin wrapper over `platformRegistry` / `collectorHealth()` /
`statusPillHtml()` - the same data `platformStatusPanel()` renders on
`#/platform-status`, condensed to one row per module with a link to that
module's existing detail page. Registering a future module in
`buildPlatformRegistry()` (`js/status.js`) is still the only step needed for
both pages to pick it up.

## Auto-Refresh (applies to every page, not just the landing page)

[`js/refresh-manager.js`](../js/refresh-manager.js) keeps every page's data
current without a manual reload. It is the one centralized place that
schedules, fetches, and merges refreshes; every other page benefits
automatically because it reads from the same module-level `data` /
`nodeInsights` / `nodeInsightsHistory` / `slurmAnalyticsPipeline` /
`queueInsights` variables in `js/app.js` that `render()` already reads on
every route.

### What it does

- Every 5 minutes, re-runs the exact same five loaders `init()` calls once at
  startup - `loadMjolnirData()`, `loadNodeInsightsData()`,
  `loadNodeInsightsHistory()`, `loadSlurmAnalyticsPipelineStatus()`,
  `loadQueueInsightsData()` (all from `js/data-loader.js`). No new fetch
  logic, no new endpoints, no new collectors - this only re-requests JSON
  the SPA already loads on every visit.
- Compares the freshly-fetched bundle against what's currently on screen
  (`JSON.stringify` equality). If nothing changed, it skips the re-render
  entirely and only patches the "Last updated" text - no DOM churn for an
  unchanged refresh.
- If something changed, it hands the new data to `app.js`, which re-renders
  the current page through the same `render()`/`renderShell()` path every
  user interaction already uses, then shows the "&check; Dashboard updated"
  toast for ~4 seconds.

### Never losing data on a partial failure

Each of the five loaders already returns an explicit
`available`/`source` flag rather than throwing (this predates Auto-Refresh -
see `js/data-loader.js`). `refresh-manager.js` reads that flag per module
before accepting a refreshed value:

- `loadMjolnirData()`'s result is only accepted when `source === 'real-export'`
  (i.e. the live tree, not its own sample-data/empty fallback).
- `loadNodeInsightsData()` / `loadNodeInsightsHistory()` /
  `loadSlurmAnalyticsPipelineStatus()` results are only accepted when
  `available === true`.
- `loadQueueInsightsData()` fetches 7 independent JSON files
  (`current_pressure.json`, `partition_pressure.json`,
  `pending_reasons.json`, `queue_health_history.json`,
  `wait_time_history.json`, `submission_patterns.json`, `status.json`) and
  already tolerates any one of them being missing. `refresh-manager.js`
  merges at that same per-file granularity: if one file comes back empty on
  a given 5-minute cycle but was previously loaded successfully, the
  previous value for *that file* is kept rather than blanked out.

In every case, a failed or partial fetch keeps whatever was already
rendered and retries on the next 5-minute tick - it never clears existing
data and never spams the console (loaders already catch their own errors;
`refresh-manager.js`'s own `try/catch` around the cycle is a second line of
defense, not the expected path).

### Not disturbing the viewer

`app.js`'s `rerenderPreservingViewState()` is the only function Auto-Refresh
ever calls to re-render. It wraps the normal `render()` call with:

- Saving and restoring `window.scrollY` and the `.main` panel's `scrollTop`.
- Saving and restoring which `<details>` disclosures (e.g. "Why are there
  fewer unique jobs than accounting records?" on `#/warehouse`) were open,
  matched by their `<summary>` text since the page being refreshed is still
  the same page.
- Never touching `location.hash` / `state.route` - a refresh re-renders
  whatever route is already active, it never navigates.

The "Last updated" label (15-second tick) and the toast show/hide are DOM
patches (`textContent` / `classList.toggle`) done without calling `render()`
at all, so the vast majority of refresh cycles - the 5-minute ones where
nothing changed, and every 15-second clock tick - touch only one text node
or one CSS class, never the page tree.

### UI

- A small `Live · Last updated: <relative time>` indicator lives inside the
  existing green "Live production data" banner at the top of every page
  (`refreshStatusHtml()` in `js/app.js`), so it's visible at every viewport
  width without its own layout.
- A "&check; Dashboard updated" toast (`refreshToastHtml()`) appears as a
  fixed top-right overlay only when a refresh actually changed something,
  and auto-hides after ~4 seconds.

### Guarantees

- `startAutoRefresh()` is idempotent (guarded by a module-level `started`
  flag) - calling it more than once never creates a second pair of timers,
  so there's no double-fetching and no leaked intervals.
- The 5-minute refresh and 15-second indicator tick are the only two timers
  Auto-Refresh ever creates, for the lifetime of the tab.
