# LEAF Index Methodology

## Philosophy

Mjolnir Analytics is not simply reporting HPC usage - it helps researchers
become more efficient, more sustainable HPC citizens. The LEAF Index is the
platform's primary sustainability metric: a single, recognizable number a
user can watch move over time ("my LEAF Index went from 58 to 84"), rather
than a scattered set of percentages.

The LEAF glow (the neon leaf icon used throughout the dashboard) communicates
efficiency at a glance: the brighter and more vibrant the green, the more
sustainable the usage. Amber and red tiers signal room for improvement
without being alarming - the platform's tone is encouraging, not punitive.

## What the LEAF Index is today

The LEAF Index is a composite, weighted sustainability score from 0-100.
Today it is computed from two components:

| Component | Weight | Source field |
|---|---|---|
| CPU efficiency | 60% | `cpu_efficiency` (measured vs. allocated CPU time) |
| Memory efficiency | 40% | `memory_efficiency` (measured vs. requested memory) |

The score is `round(100 * (0.6 * cpu_efficiency + 0.4 * memory_efficiency))`,
with weights renormalized over whichever components have data for a given
user (so a user with only CPU data still gets a meaningful score from CPU
alone, rather than a missing value).

Glow/tier thresholds (shared with the LEAF icon and the LEAF Dashboard's
efficiency bands):

| Tier | LEAF Index | Efficiency fraction |
|---|---|---|
| Excellent | ≥ 85 | ≥ 0.85 |
| Good | ≥ 70 | ≥ 0.70 |
| Amber (medium) | ≥ 40 | ≥ 0.40 |
| Red (poor) | < 40 | < 0.40 |

## Where it's computed

The LEAF Index is computed **server-side**, in
`scripts/export_analytics_data.py`'s `compute_leaf_index()`, using the
`LEAF_INDEX_COMPONENTS` weights/availability registry defined in that same
file. It is added to:

- Per-user records in `global/users_summary.json` (`leaf_index`,
  `leaf_index_components`)
- Benchmark profiles (cluster average/median, top 10%/25%) in the same file
- All-time and rolling-window summaries in personal bundles
  (`private-user-data/users/*.json`)

The frontend (`js/app.js`) mirrors the same weights/registry
(`LEAF_INDEX_COMPONENTS`, `computeLeafIndex()`) as a fallback only - used
when a record predates the exported `leaf_index` field (e.g. cached JSON).
The exported field is always preferred when present.

## Extensibility - how future dimensions get added

Both the backend registry (`LEAF_INDEX_COMPONENTS` in
`export_analytics_data.py`) and the frontend mirror (`LEAF_INDEX_COMPONENTS`
in `app.js`) list every component with an `available` flag:

```python
LEAF_INDEX_COMPONENTS = [
    {"id": "cpu",    "label": "CPU efficiency",    "field": "cpu_efficiency",    "weight": 0.6, "available": True},
    {"id": "memory", "label": "Memory efficiency", "field": "memory_efficiency", "weight": 0.4, "available": True},
    {"id": "gpu",    "label": "GPU efficiency",    "field": "gpu_efficiency",    "weight": 0.0, "available": False},
    {"id": "queue",  "label": "Queue behavior",    "field": "queue_score",       "weight": 0.0, "available": False},
]
```

Adding a real future dimension (GPU efficiency, queue behavior, workflow
optimization, energy efficiency, carbon footprint, storage efficiency,
scheduling behavior) means:

1. Export the raw metric from the backend (e.g. measured GPU utilization).
2. Flip that component's `available` to `True` and give it a nonzero
   weight (rebalancing the others as appropriate) in **both** registries.
3. Nothing else changes. `compute_leaf_index()`/`computeLeafIndex()`
   renormalize weights over whichever components are available, the LEAF
   Dashboard's sub-score loop (`leafDashboardSection()` in `app.js`) already
   iterates `LEAF_INDEX_COMPONENTS.filter(c => c.available)`, and the LEAF
   Index badge/tooltip/glow tiers are unaffected.

Per current product direction, a not-yet-available component (GPU, queue,
etc.) is **not** shown as a "coming soon" placeholder in the UI - it simply
does not appear until it has real data, keeping the dashboard honest about
what's actually being measured today.

## What the LEAF Index is not

- It is not a billing figure. See "Estimated Compute Cost" / "Potential
  Savings" for cost-related metrics, which remain allocation-based
  estimates, not invoices.
- It does not change `underutilized_cost_dkk` or any other existing
  cost/waste field - the LEAF Index is purely additive and does not alter
  the cost model, which is documented separately as "under review."

## Phase 8.1 — Rolling 180-day consistency for efficiency rankings (2026-07-02)

Phase 8 (LEAF 2.0) moved LEAF, Savings Opportunity, and Recommendations to
the rolling 180-day window, but the "Highest CPU Efficiency" / "Highest
Memory Efficiency" leaderboards on the Rankings page, the Users Explorer's
per-metric efficiency displays, the Compare page, and the Personal Analytics
dashboard's headline efficiency cards were left ranking/displaying by
lifetime `cpuEfficiency`/`memoryEfficiency`/`overallEfficiency`/
`percentileCpu`/`percentileEfficiency` - a user could rank #2 in CPU
Efficiency (lifetime) and #18 in LEAF (180d) simultaneously. This addendum
closes that gap on the frontend, using the backend's Phase 8.1
`cpu_efficiency_180d`/`memory_efficiency_180d`/`overall_efficiency_180d`/
`percentile_cpu_180d`/`percentile_memory_180d` fields (`mjolnir-analytics`
`scripts/export_analytics_data.py`).

**Audit result** - every reference to `cpuEfficiency`/`memoryEfficiency`/
`overallEfficiency`/`percentileCpu`/`percentileEfficiency` (and their raw
`avg_cpu_efficiency`/`avg_memory_efficiency`/`cpu_efficiency`/
`memory_efficiency`/`overall_efficiency`/`percentile_cpu`/
`percentile_efficiency` JSON counterparts) was reviewed and classified:

| Surface | Classification | Change |
|---|---|---|
| Rankings page "Highest CPU/Memory Efficiency" (`userRankingsPage`) | Current performance | Now sorts/filters/displays `cpuEfficiency180d`/`memoryEfficiency180d`; headings renamed to "Highest CPU Efficiency (180d)" / "Highest Memory Efficiency (180d)" |
| User profile "Cluster Context" percentile cards (`userProfilePage`) | Current performance | Now reads `percentileCpu180d` and `leaf.percentile` instead of lifetime `percentileCpu`/`percentileEfficiency`; relabeled "LEAF percentile" |
| Compare page summary bullets, KPI cards, full comparison table, CSV export (`compareSummary`, `compareKpiDashboard`, `compareWithGroup`, `userComparisonPage`) | Current performance | Switched to `windowOverallEfficiency()`/`cpuEfficiency180d`/`memoryEfficiency180d`/`percentileCpu180d`/`leaf.percentile`; row/column labels now say "(180d)" |
| Personal Analytics dashboard headline CPU/Memory efficiency cards (`personalContextCards`) | Current performance | Now reads `metrics.cpuEfficiency180d`/`memoryEfficiency180d` (sourced from the personal bundle's `leaf.leaf_index_components`), matching the Savings Opportunity card already on the same page |
| Users Explorer efficiency column/filter | Already current performance | No change needed - already used `windowOverallEfficiency()` since Phase 8 |
| User profile KPI cards (CPU efficiency, Memory efficiency, Savings Opportunity) | Already current performance | No change needed - already used `leafComponentFromBlock()`/`rolling_summaries["180d"]` since Phase 8 |
| Profile page "Top 10% benchmark" trend overlay reference lines | Current performance | Switched to the benchmark's `cpuEfficiency180d`/`memoryEfficiency180d` |
| Executive User Report PDF (`userReportData.js` "Efficiency" section) | **Intentional historical statistic** | Left unchanged - explicitly labeled "All-time average" in the UI, satisfying the "unless explicitly labelled as a lifetime statistic" exception |
| PI Report PDF (`piReportData.js` "CPU/Memory Efficiency") | **Intentional historical statistic** | Left unchanged - explicitly labeled "All-time average" |
| Per-job `cpuEfficiency`/`memoryEfficiency` (job tables, job detail cards) | Not applicable | A single job has no lifetime-vs-rolling distinction - left unchanged |
| Daily trend charts (`avg_cpu_efficiency`/`avg_memory_efficiency` series) | Not applicable | Time series of actual per-day values, not a summarized aggregate - left unchanged |

**Backward compatibility**: `normalizeUserRow()` and
`normalizePersonalUserViewModel()` in `data-loader.js` detect missing
`*_180d` fields/leaf blocks (older cached JSON) via key presence, not
value-nullness, and fall back to the lifetime field without throwing - a
genuinely null 180d value (no activity in the window) is preserved as "no
recent activity," never silently replaced by a stale lifetime number.

**New tooltip**: `EFFICIENCY_WINDOW_TOOLTIP` ("Efficiency values reflect the
previous 180 days unless explicitly marked as lifetime/all-time.") added to
the Rankings page info panel.

**Validation**: `scripts/validate_ui.py`, `scripts/validate_data.py`
(re-run against a real 306-user export from the backend, via
`MJOLNIR_ANALYTICS_DATA_DIR`), and `scripts/validate_reports.py` all pass.
`node --check` passes on `app.js` and `data-loader.js`. A standalone Node
harness against the real export confirmed the Rankings leaderboard's top-5
by `cpuEfficiency180d` genuinely differs from the top-5 by lifetime
`cpuEfficiency`, and that the backward-compatibility fallback produces the
lifetime value byte-for-byte when the `*_180d` fields are absent.
