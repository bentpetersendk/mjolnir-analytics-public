# Chart Standardization Report

Reference document for the platform-wide time-range and numeric-formatting
standardization work. This is the living source of truth for how a chart on
this dashboard should behave - new charts should be built to match this
table, not to match whatever the nearest existing chart happens to do.

See `js/chartPolicy.js` for the enforced policy (`CHART_POLICY`,
`chartRangeSelector()`, `defineChart()`) and `js/ui-helpers.js`
(`VALUE_TYPES`/`resolveFormatter()`) for the enforced formatting rules. This
report documents the *decisions*; the code is the *enforcement*.

## Categories

| Category | Answers | Default range | Selectable ranges | KPI cards sync by default? |
|---|---|---|---|---|
| **Operational** | "What is happening now?" | 7d | 24h / 7d / 30d / 90d / 180d | No - cards show live/current state |
| **Analytical** | "How has behaviour changed over time?" | 180d | 30d / 90d / 180d / 365d / Lifetime | Yes - cards track the chart's range |
| **Historical/Inventory** | "How has the platform evolved?" | Lifetime | 180d / 365d / Lifetime | Yes |

Internal id for the unbounded range is always `all`; "Lifetime" is a display
label only.

## Value types (precision policy)

One formatter per metric kind, applied identically in tooltips, axes, KPI
cards, and chart headline numbers (`js/ui-helpers.js`'s `VALUE_TYPES`):

| Value type | Format | Example |
|---|---|---|
| `percent` | 1 decimal | `40.1%` |
| `leafScore` | integer, 0-100 scale | `72` |
| `currency` | whole DKK ≥ 1,000; 2 decimals below | `42,241 DKK` / `842.50 DKK` |
| `cpuHours` | 1 decimal | `123.5 CPU hours` |
| `gpuHours` | 1 decimal | `2,569.3 GPU hours` |
| `count` | integer | `3,196` |
| `storage` | auto-unit, 1 decimal above KB | `542 GB` / `2.3 TB` |
| `waitTime` | `N min` below 1h, `H h M min` at/above | `12 min` / `3 h 24 min` |
| `percentile` | integer (prose adds ordinal) | `87` → `"87th percentile"` |
| `axisCount` | k/M/B abbreviated (axes only) | `10k` / `1.5M` |

CSV exports (`chartCsv()` in `js/charts.js`) always use raw underlying
values, never the formatted strings above - formatting is presentation-only.

## Chart inventory

| Page | Chart | Category | Default range | Available ranges | Value type | KPI cards sync? | Notes / deviation |
|---|---|---|---|---|---|---|---|
| Trends | CPU efficiency | Analytical | 180d | 30/90/180/365d/Lifetime | percent | n/a (no cards on page) | |
| Trends | Memory efficiency | Analytical | 180d | 30/90/180/365d/Lifetime | percent | n/a | |
| Trends | Daily cost & optimization opportunity | Analytical | 180d | 30/90/180/365d/Lifetime | currency | n/a | |
| Trends | GPU hours | Analytical | 180d | 30/90/180/365d/Lifetime | gpuHours | n/a | |
| Projects | Project portfolio cost opportunity | Analytical | 180d | 30/90/180/365d/Lifetime | currency | n/a (table above is all-time, independent) | |
| PI / Group / Section detail | `{label}` efficiency trend | Analytical | 180d | 30/90/180/365d/Lifetime | percent | **Yes** | Summary cards above recomputed from the same filtered rows |
| PI / Group / Section detail | `{label}` cost trend | Analytical | 180d | 30/90/180/365d/Lifetime | currency | **Yes** | completed/failed job breakdown only shown for all-time (not exported per-day) |
| Cost Insights | Estimated Compute Cost vs. Potential Savings | Analytical | 180d | 30/90/180/365d/Lifetime | currency | **No, explicit** | Cards above are labeled "All-time totals - independent of the trend chart" |
| My Analytics (prototype) | Efficiency trend evidence | Analytical | 180d | 30/90/180/365d/Lifetime | percent | No (percentile/comparison cards are peer-distribution based, not derivable from one user's trend rows) | Prototype route, auth not yet enabled |
| My Analytics (prototype) | Estimated Compute Cost Trend | Analytical | 180d | 30/90/180/365d/Lifetime | currency | same as above | |
| User Profile | LEAF Index trend | Analytical | 180d | 30/90/180/365d/Lifetime | leafScore | **No, explicit** | See "LEAF Index KPI deviation" below |
| User Profile | Efficiency trend (CPU/Memory + 7d avg) | Analytical | 180d | 30/90/180/365d/Lifetime | percent | **No, explicit** | Same deviation |
| User Profile | Estimated compute cost trend | Analytical | 180d | 30/90/180/365d/Lifetime | currency | **No, explicit** | Same deviation |
| User Comparison | CPU efficiency (per user) | Analytical (target) | fixed 30d | none | percent | n/a | **Deviation - backend-limited**, see below |
| User Comparison | Memory efficiency (per user) | Analytical (target) | fixed 30d | none | percent | n/a | Same deviation |
| Live Queue | Running/pending jobs | Operational | 7d | 24h/7d/30d/90d/180d | count | No (live snapshot cards) | |
| Wait Time Analysis | Median/P90 wait trend | Operational | 7d | 24h/7d/30d/90d/180d | waitTime | No (latest-day snapshot cards) | Previously a static backend-window label with no selector; now shares `HISTORY_RANGE_SELECTOR` with the identical Historical Trends chart |
| Historical Trends | Queue depth | Operational | 7d | 24h/7d/30d/90d/180d | count | n/a | |
| Historical Trends | Queue Health score | Operational | 7d | 24h/7d/30d/90d/180d | count | n/a | Click-through to Queue Overview preserved |
| Historical Trends | Top pending reasons | Operational | 7d | 24h/7d/30d/90d/180d | count | n/a | |
| Historical Trends | Wait time (Median/P90) | Operational | 7d | 24h/7d/30d/90d/180d | waitTime | n/a | **Bug fixed**: previously not filtered by the page's own range buttons at all |
| Infrastructure Overview | Cluster pressure trend | Operational | 7d | 24h/7d/30d/90d/180d | percent (pressure) / axisCount (jobs/nodes) | No (Fleet/Queue cards are live) | Mixed-unit tooltip: `%` for pressure series, integers for jobs/nodes |
| Node Inventory | Node availability trend | Operational | 7d | 24h/7d/30d/90d/180d | count | No (table header is live) | |
| Capacity Planning | Pressure & queue trend | Operational | 7d | 24h/7d/30d/90d/180d | percent / axisCount | No (current-pressure cards are live) | Same chart/option as Infrastructure Overview |
| Node Detail | Utilization history (CPU/Mem/GPU) | Operational | 7d | 24h/7d/30d/90d/180d | percent | n/a | |
| Software Intelligence Overview | Recent Activity (30d) | n/a | fixed 30d | none | count | n/a | **Deviation - intentional fixed-window widget**, see below |
| Trending | Cluster-wide Daily Jobs (60d) | n/a | fixed 60d | none | count | n/a | **Deviation - intentional fixed-window widget**, see below |
| Timeline | Cluster-wide / `{module}` usage | Historical | Lifetime | 180d/365d/Lifetime | count | n/a | Range selector only applies at daily granularity (weekly/monthly buckets aren't calendar-day windows) |
| Module Detail | Usage History | Historical | Lifetime | 180d/365d/Lifetime | count | n/a | |
| Module Detail | Version Migration Over Time | Historical | Lifetime | 180d/365d/Lifetime | count | n/a | Shares the Usage History selector (one state key, two co-plotted charts) |
| Percentiles, gauges, Warehouse funnel, Version Adoption, Top-10-software, savings breakdown | — | Point-in-time / not time-series | n/a | n/a | (per chart: percent/currency/count) | n/a | Correctly excluded from range selection; already had correct tooltip/axis formatting before this work |

## Documented deviations

### User Comparison - backend-limited, out of scope this pass
`js/data-loader.js`'s `trends30d` field (sourced from the export's
`trends_30d`) is a pre-baked 30-day-only series with no daily granular data
behind it. A real Analytical range selector here requires a private-repo
export change (exporting each compared user's full `daily_trends`, as
already happens for a single User Profile). Flagged, not silently worked
around; left as a fixed 30d comparison until that export change lands.

### Software Intelligence Overview "Recent Activity" / Trending "Cluster-wide Daily Jobs" - intentional fixed-window widgets
Both are small glance widgets tied to specific fixed-window context
elsewhere on the same page (Recent Activity previews the most recent month
next to all-time top-module rankings; the Trending chart sits directly above
the 7d/30d/all-time up/down/flat classification it illustrates). Converting
either to a full range selector would decouple them from the fixed
classification they exist to illustrate, so they intentionally stay fixed
rather than adopting the Analytical policy.

### LEAF Index KPI deviation (User Profile)
The User Profile's Summary/LEAF Dashboard cards (LEAF Index, CPU/Memory
efficiency, savings opportunity) are computed from a compound,
methodology-defined sustainability score (`docs/LEAF_INDEX_METHODOLOGY.md`),
pre-computed server-side only for the 180d rolling window
(`bundle.rolling_summaries['180d']`, `bundle.leaf`). Recomputing this
client-side for an arbitrary selected range (30d/365d/Lifetime) would risk
silently diverging from the documented methodology - a worse outcome than a
clearly-labeled fixed window. This is a deliberate `kpiSyncs: false`
override, explicitly labeled in the UI ("LEAF, efficiency & savings: LEAF
(180d rolling)") rather than left ambiguous. The Daily Trends chart directly
below it *is* range-selectable and does sync visually; only the Summary/LEAF
Dashboard cards stay fixed. Because the Analytical policy's default is now
180d, the common case (a first-time visitor who hasn't touched the range
selector) shows the chart and the cards agreeing on the same window with no
visible dissonance at all - the deviation is only visible once a user
deliberately picks a different range for the chart.

## Known bug fixed during this work

Historical Trends page (`#/queue-trends`): the page's own range buttons
visibly rendered above all four charts but silently did not affect the
fourth ("Wait time") - it read `clusterWaitSeriesRows()` directly with no
range filtering applied, unlike its three siblings on the same page. Fixed
by routing it through the same `filterByRange()` call as the others
(`js/app.js`, `queueTrendsPage()`).

## Known formatting exceptions outside chart scope (not touched)

This work's `VALUE_TYPES` registry covers every chart, chart-adjacent KPI
card, and leaderboard number reachable from the chart inventory above. Two
pre-existing helpers were found during review that look superficially
similar to `VALUE_TYPES.percent`/`storage` but operate on a genuinely
different input domain, live on pages with no charts (out of this work's
scope), and were deliberately left as-is rather than force-fit:

- **`pctLabel()`** (`js/app.js`) - Software Inventory's "Knowledge/Homepage/
  Documentation/.../License Coverage" cards. Takes an **already 0-100
  scaled** number (`s.knowledgeCoveragePct`, etc.), whereas
  `VALUE_TYPES.percent`/`pct()` take a **0-1 fraction**. Converting call
  sites would mean changing what the underlying export fields mean, not
  just how they're displayed - out of scope for a presentation-layer
  standardization pass. Software Inventory has no charts (tables/cards
  only, confirmed in the original audit), so it never intersects
  `chartPolicy.js`.
- **`gib()`** (`js/app.js`) - cluster/node/partition memory capacity figures
  (e.g. "RAM: 512 GiB"). Deliberately fixed-unit GiB (not auto-scaling
  B/KB/MB/GB/TB like `VALUE_TYPES.storage`/`bytesLabel()`), since HPC node
  RAM is always sensibly expressed in GiB - auto-scaling would make small
  and large nodes' capacity harder to compare at a glance, which is the
  opposite of what auto-scaling storage is for.
- **User Rankings leaderboard "Largest Memory Consumers"** (`js/app.js`,
  `userLeaderboard(...)`) shows GB·h (a memory x time integral), a compound
  unit not covered by the precision policy's Hours/Storage categories
  (neither is quite right: it is not a duration and not a point-in-time
  size). Left as `fmt(v, 0) + ' GB·h'`, consistent with its own established
  convention elsewhere in the same leaderboard list.

None of the three appear in any chart tooltip, chart axis, or chart-attached
KPI card - only in static cards/leaderboard rows unrelated to any
`chartPolicy.js` selector.
