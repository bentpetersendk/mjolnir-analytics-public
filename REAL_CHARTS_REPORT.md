# Real Charts Report

## Summary

This phase removed production placeholder visualizations from the public dashboard and replaced them with charts driven by loaded JSON data.

## Removed Placeholder Visuals

Removed or replaced from production UI:

- Hardcoded cluster trend SVG points
- Hardcoded KPI sparklines
- Benchmark comparison bars using fixed values
- Benchmark "Regression score" card
- Benchmark "Sample benchmark" labels
- Cost page fixed bar series
- Cost page placeholder series label
- Generated recommendation insight cards mixed into exported recommendations
- Static alert list with unrelated service names

## Real Data Sources By Chart

| Page | Chart or widget | JSON source | Loader/UI property |
| --- | --- | --- | --- |
| Landing | KPI sparklines | `global/cluster_summary.json` daily trends | `clusterSummary.dailyTrends` |
| Landing | CPU and memory efficiency trend | `global/cluster_summary.json` daily trends | `clusterSummary.dailyTrends[*].avg_cpu_efficiency`, `avg_memory_efficiency` |
| Cluster | CPU and memory trend | `global/cluster_summary.json` daily trends | `clusterSummary.dailyTrends` |
| Cluster | Cost and underutilized cost trend | `global/cluster_summary.json` daily trends | `estimated_cost_dkk`, `underutilized_cost_dkk` |
| Cluster | GPU hours trend | `global/cluster_summary.json` daily trends | `gpu_hours` |
| Cluster | Jobs and failed jobs trend | `global/cluster_summary.json` daily trends | `jobs`, `failed_jobs` |
| Cluster | Percentile cards | `global/percentiles.json` | `percentiles` |
| Users | All-user daily trends | `users/*.json` daily trends | Aggregated `userBundles[*].dailyTrends` |
| Users | Ranking tables | `users/*.json` all-time summaries | `rankings.cpu`, `rankings.memory`, `rankings.savings` |
| Benchmarks | Percentile bars | `global/percentiles.json` | p5, p25, p50, p75, p95 values |
| Cost | Cost and waste trend | `global/cluster_summary.json` daily trends | `estimated_cost_dkk`, `underutilized_cost_dkk` |
| Cost | Resource cards | `global/cluster_summary.json` all-time summary | CPU hours, memory GB-hours, GPU hours, failed jobs |
| Recommendations | Recommendation cards | `users/*.json` recommendations | `recommendations` |
| User detail | Daily trends | selected user bundle | `user.dailyTrends` |

## Limitations

- True cost composition is not exported yet. The Cost page now says: "Cost composition is not exported yet." It does not show a fabricated composition chart.
- Recommendations are shown only when exported recommendation rows exist. The UI no longer invents recommendation text for production pages.
- User trend aggregation is computed from loaded pseudonymous bundles in the browser. For a much larger historical archive, this should move to a precomputed aggregate export.

## Validation

Commands and checks completed:

- `node --check js/app.js`
- `node --check js/data-loader.js`
- `python3 scripts/validate_data.py`
- `python3 scripts/validate_ui.py`
- Production UI scan for forbidden placeholder strings
- Playwright route sweep for Landing, Cluster, Users, Benchmarks, Cost, Methodology, and one individual user page

The UI validator now fails if production UI contains:

- `Placeholder`
- `Sample benchmark`
- `Regression score placeholder`
- `fake chart`
- `demo users`

## Screenshots

- Landing: `docs/screenshots/real-charts-landing.png`
- Cluster: `docs/screenshots/real-charts-cluster.png`
- Users: `docs/screenshots/real-charts-users.png`
- Benchmarks: `docs/screenshots/real-charts-benchmarks.png`
- Cost: `docs/screenshots/real-charts-cost.png`
- Methodology: `docs/screenshots/real-charts-methodology.png`
- User detail: `docs/screenshots/real-charts-user-detail.png`
