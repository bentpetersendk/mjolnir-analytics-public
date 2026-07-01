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
