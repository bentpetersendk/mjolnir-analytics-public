# Data Architecture

```mermaid
flowchart LR
  A[Real export\n/data/efficiency_v3/site_data_90d_validation/] --> B[js/data-loader.js]
  C[sample-data/] --> B
  B --> D[Normalized app data]
  D --> E[Landing Page]
  D --> F[Cluster Analytics]
  D --> G[User Analytics]
  D --> H[Benchmark Analytics]
  D --> I[Cost Analytics]
  D --> J[Methodology Page]
```

The loader always attempts the mirrored real export first. If that path is unavailable or incomplete, it falls back to `sample-data/` so the UI remains functional during development and in offline environments.
