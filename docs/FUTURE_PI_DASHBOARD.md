# Future PI Dashboard

The current architecture is ready to grow into PI-level summaries without redesign.

## Planned data model

- Project summary cards
- Group summary cards
- Storage usage summaries
- Efficiency by project
- Cost by project

## Architecture direction

- Extend `js/data-loader.js` with a PI projection layer.
- Normalize project and group aggregates into the same shape used by the existing dashboards.
- Keep views data-driven so new PI pages can reuse the same KPI, percentile, chart, and recommendation components.

## UI guidance

- Prefer the same enterprise dashboard shell.
- Add a project selector and a group selector.
- Reuse cluster-style tables and recommendation cards rather than inventing a separate design language.

## Scalability rule

The PI dashboard should consume the same data pipeline as the current app and switch only the view model, not the rendering architecture.
