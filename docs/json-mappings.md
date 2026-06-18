# JSON Mappings

## Source tree

- `index.json`
  - `generated_at` -> display source timestamp
  - `schema_version` -> compatibility marker
  - `global.cluster_summary` -> summary file path
  - `global.percentiles` -> percentile file path
  - `users[]` -> user bundle list
- `global/cluster_summary.json`
  - `cluster_all_time_summary` -> landing, cluster, cost KPIs
  - `cluster_rolling_summaries.7d` / `30d` / `90d` -> rolling summary widgets
  - `daily_trends` -> trend line chart data
- `global/percentiles.json`
  - `percentiles.avg_cpu_efficiency` -> CPU percentile widgets
  - `percentiles.avg_memory_efficiency` -> memory percentile widgets
  - `percentiles.estimated_cost_dkk` -> cost percentile widgets
  - `percentiles.gpu_hours` -> GPU usage percentile widgets
  - `percentiles.underutilized_cost_dkk` -> savings percentile widgets
- `users/<token>.json`
  - `all_time_summary` -> user dashboard summary cards
  - `daily_trends` -> per-user trend data
  - `rolling_summaries` -> derived rollup context
  - `recommendations` -> recommendation cards
  - `top_inefficient_jobs` -> future detail tables

## Normalized app layer

- `clusterSummary.allTime`
- `clusterSummary.rolling7d`
- `clusterSummary.rolling30d`
- `clusterSummary.rolling90d`
- `clusterSummary.dailyTrends`
- `percentiles.cpu`
- `percentiles.memory`
- `percentiles.cost`
- `percentiles.gpu`
- `percentiles.underutilized`
- `userBundles[]`
- `recommendations[]`
