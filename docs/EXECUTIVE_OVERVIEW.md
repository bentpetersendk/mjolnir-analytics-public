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
