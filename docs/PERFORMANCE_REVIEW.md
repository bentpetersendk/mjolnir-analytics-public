# Performance Review

## Current status

- Static HTML, CSS, and ES module JavaScript.
- One JSON loader with a fallback tree.
- No client-side framework overhead.

## Bottlenecks

- Loading the full 90-day export currently means fetching many user JSON files.
- Rendering large tables and recommendation lists can grow expensive as the archive expands.
- Re-rendering the entire app on theme changes is simple but not the most efficient pattern.

## Recommendations

- Add cached fetches or a manifest-backed batch endpoint when a full archive becomes available.
- Keep the normalized data object small and derived before render.
- Virtualize large tables if row counts rise substantially.
- Memoize expensive chart transformations when the dataset grows.

## Future scale path

The current loader and view model can support a much larger archive if the data source changes from many small files to a manifest plus aggregated rollups.
