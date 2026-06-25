# Platform Status framework

Every page that shows collected data tells the viewer three things, in a
consistent format:

1. When the displayed data was collected ("Last Updated").
2. Whether the collector behind it is healthy ("Collector Status").
3. Whether the page is a live infrastructure snapshot or a historical
   analytics window ("Snapshot Age" vs "Data Window").

A platform-wide rollup of all of that ("Platform Status") is shown on the
Overview page and as a one-line badge in the sidebar.

All of this is implemented once, in [`js/status.js`](../js/status.js), and
called from page renderers in `js/app.js`. No page formats a timestamp or
decides a health color on its own.

## Timestamp and timezone handling

- **Storage stays UTC, always.** `data/node_insights.sqlite`, every
  `data/**/*.json` export, and every Node Insights history export now
  published to `dashboard-data/mjolnir/*.json` (see
  [DASHBOARD_DATA_MIGRATION.md](DASHBOARD_DATA_MIGRATION.md)) store
  `generated_at` / `timestamp` as UTC ISO-8601 (`...Z`). Nothing in this
  document changes that - `js/status.js` only ever *reads* those values.
- **Conversion to local time happens once, in the frontend.**
  `js/status.js`'s `parseUtc()` builds a JS `Date` from the UTC string;
  every formatter then reads it back with the browser's local getters
  (`toLocaleString`, `getMonth()`, `getHours()`, ...). Because the
  conversion is the *absence* of a timezone override rather than a manual
  offset, it automatically follows whatever timezone the viewer's OS/browser
  is set to, including DST - a Denmark-based browser shows CEST in summer
  and CET in winter with no special-casing.
- **Where it's used:**
  - `formatLocalDateTime(value, fallback)` - the standard "Last Updated"
    string everywhere (status bars, the Platform Status panel, dataset
    provenance cards).
  - `chartTimeLabel(value)` / `chartTimeTooltipLabel(value)` - ECharts axis
    labels and tooltip headers for the Node Insights history charts
    (`capacity_history.json`, `node_history.json`).
  - `snapshotAgeLabel(value)` - the human "7 minutes" / "3 hours" / "2 days"
    string used for Infrastructure pages' Snapshot Age field.

## Collector Status (per module)

Computed by `collectorHealth(meta)`:

| Status  | Condition                                              | Color  |
|---------|----------------------------------------------------------|--------|
| Healthy | `generated_at` is under 2 hours old                       | green  |
| Warning | `generated_at` is 2-6 hours old                            | amber  |
| Stale   | `generated_at` is over 6 hours old                         | orange |
| Failed  | the collector explicitly reports failure, or has no data  | red    |
| Planned | the module has no collector behind it yet                 | gray   |

Age is computed purely from `generated_at` - there is no separate "stale"
flag in the data. **Failed** is the one status a collector has to report
explicitly (`collector_status: "failed"` in its JSON, or
`available: false` from its loader); everything else is derived.

## Platform Status (aggregate)

Computed by `platformHealth(registry)` over every *active* (non-planned)
module:

| Platform Status | Condition                                  |
|------------------|---------------------------------------------|
| Healthy          | every active collector is Healthy            |
| Warning          | at least one collector is Warning or Stale, none Failed |
| Degraded         | exactly one collector is Failed              |
| Critical         | two or more collectors are Failed            |

Planned modules (no collector yet) are shown in the Platform Status panel
but excluded from this aggregation - a placeholder can't be unhealthy.

## JSON contract

Any collector's export can carry these fields. None are required - if a
field is missing, `js/status.js` derives a sensible default (age-based
health, label fallbacks) - but a generator that wants Platform Status to
reflect its real state should include all five:

```jsonc
{
  "generated_at": "2026-06-24T11:20:00Z",   // UTC ISO-8601, always
  "collector": "node_insights",             // stable machine name
  "collector_status": null,                 // null/absent = "derive from age"; "failed" = explicit failure
  "data_window_days": 90,                   // null for a live snapshot with no window
  "platform_module": "Node Insights"        // display name in the Platform Status panel
}
```

### Today's real implementation

`scripts/node_insights_db.py` adds a `collector_runs` table
(`collector`, `last_attempt_at`, `last_success_at`, `status`, `message`),
written by `record_collector_run()`. `scripts/collect_node_insights.py`
calls it on every run - success or failure - including in the exception
path, so a Slurm CLI failure is recorded even though no snapshot is stored
that run. Crucially, `--dry-run` still performs zero database writes, exactly
as before. `scripts/export_node_insights.py` reads the latest row back via
`get_collector_run()` and only ever emits an explicit `"failed"`
`collector_status` (never an explicit `"healthy"`) so that a collector which
recovers immediately starts being judged by age again instead of being
pinned to a stale "healthy" string.

This is wired into all three files `export_node_insights.py` writes
(`node_insights.json`, `capacity_history.json`, `node_history.json`).

### Snapshots this repo doesn't generate

`data/node_insights/*.json` (the live fleet snapshot bundle used by the
Infrastructure/Nodes/Hardware/Capacity pages) and
`data/efficiency_v3/site_data_90d_validation/**` (the Slurm efficiency
export used by Trends/Rankings/Percentiles/Recommendations/Optimization
Opportunities/Cost Insights) are produced upstream and synced into this
public repo as snapshots - there is no generator script for them here. The
frontend already reads `collector`, `collector_status`, `platform_module`,
and `data_window_days` from both (`js/data-loader.js`) with graceful
fallbacks, so once their upstream generators adopt this contract, the
Platform Status panel reflects them automatically with **no frontend
change required**. Until then, their health is derived purely from
`generated_at`'s age.

## Frontend pieces

- **`js/status.js`** - all of the above: timestamp/timezone helpers,
  `collectorHealth()`, `platformHealth()`, `buildPlatformRegistry()`, and
  the HTML renderers (`statusBar()`, `platformStatusPanel()`,
  `platformStatusBadge()`).
- **`js/app.js`** - calls `buildPlatformRegistry()` once per `render()` into
  the module-level `platformRegistry`, then:
  - `infraStatusBar()` / `analyticsStatusBar()` wrap `statusBar()` for the
    two page kinds and are called from every Infrastructure page
    (Infrastructure, Nodes, Node Detail, Hardware, Capacity) and every
    Analytics page (Trends, Rankings, Percentiles, Recommendations,
    Optimization Opportunities, Cost Insights).
  - `landingPage()` (Overview) renders `platformStatusPanel()` near the top.
  - `renderShell()` renders `platformStatusBadge()` in the sidebar.
- **`css/styles.css`** - `.status-bar`, `.platform-status*`, `.status-dot`,
  and the `.pill.stale` / `.pill.muted` tones (Healthy/Warning/Failed reuse
  the existing `.pill.good` / `.pill.warn` / `.pill.bad`).

## Registering a future module

Queue Insights, Slurm Insights, Cost Insights (already active - see below),
Predictions, and a Recommendations Engine are all meant to plug into this
same framework. The registration contract for a brand-new module, end to
end:

1. **Collector**: emit `generated_at` (UTC) plus, ideally, `collector`,
   `collector_status`, `data_window_days`, and `platform_module` per the
   JSON contract above.
2. **Loader**: add a `loadXyzData()` to `js/data-loader.js` that returns
   `{ available, generatedAt, collectorName, collectorStatus,
   platformModule, dataWindowDays, ... }` - the same shape every other
   loader already returns.
3. **Registry**: add one entry to `buildPlatformRegistry()` in
   `js/status.js` (or move it out of `PLANNED_MODULES` if it already has a
   placeholder there) pointing at that loader's result.
4. **Pages**: call `analyticsStatusBar()` / `infraStatusBar()` (or add a new
   page-kind wrapper if the module needs a third shape) at the top of the
   module's page renderer.

Steps 3-4 are the entire frontend footprint - the Platform Status panel,
the sidebar badge, and the health/aggregation logic need no changes at all
once a module is in the registry.

Note: **Cost Insights already exists** as an active page (`costPage()` in
`js/app.js`, nav id `cost`) backed by the same Slurm efficiency collector as
Trends/Rankings - it is intentionally listed as Healthy/Degraded/etc. via
the `analytics-warehouse` registry entry, not as a Planned placeholder.
**Queue Insights**, **Slurm Insights**, and **Predictions** have no
collector yet (`scripts/collect_node_insights.py`'s `collect_partitions()`
parses partition data but doesn't persist it - that's reserved for Queue
Insights) and are listed as Planned in `PLANNED_MODULES`.
