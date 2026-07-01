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
  - `all_time_summary` -> user Analytics summary cards
    - `all_time_summary.leaf_index` -> LEAF Index badge (0-100, or `null`); see `docs/LEAF_INDEX_METHODOLOGY.md`
    - `all_time_summary.leaf_index_components` -> per-component contributions (CPU/memory today)
  - `daily_trends` -> per-user trend data
  - `rolling_summaries` -> derived rollup context (each window also carries `leaf_index`/`leaf_index_components`; `7d` vs `30d` powers the positive-reinforcement banner)
  - `recommendations` -> recommendation cards
  - `top_inefficient_jobs` -> future detail tables
- `global/users_summary.json`
  - `users[].leaf_index` / `users[].leaf_index_components` -> LEAF Index shown on Users Explorer, Rankings, and comparison dashboard
  - `benchmark_profiles[].leaf_index` -> LEAF Index for the four synthetic benchmark profiles (cluster avg/median, top 10%/25%)

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
