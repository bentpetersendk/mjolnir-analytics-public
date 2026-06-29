# Architecture

## Frontend architecture

- Plain HTML entry point.
- CSS design system in `css/styles.css`.
- ES module app shell in `js/app.js`.
- Single data access layer in `js/data-loader.js`.

## Data flow

1. The app starts in `js/app.js`.
2. `js/data-loader.js` loads the real export tree.
3. The loader falls back to `sample-data/` if needed.
4. The loader normalizes the data into one view model.
5. Pages render from that normalized object only.

## Chart architecture

- Every chart on the site renders through Apache ECharts via the shared
  framework in `js/charts.js` - no page builds a chart by hand.
- See [CHART_FRAMEWORK.md](CHART_FRAMEWORK.md) for the factory reference,
  the registry/mount lifecycle, export/drill-down/annotation conventions,
  and accessibility requirements.
- Future chart expansion should add a factory or extend an existing one in
  `js/charts.js`, not a page-local one-off.

## Future expansion strategy

- Keep raw JSON isolated from page code.
- Add new projections in the loader for project, group, and storage summaries.
- Preserve the current shell and extend the view model instead of redesigning the layout.
- Support the full historical archive by switching the loader source, not the page implementations.

## Platform Status framework

Every page that shows collected data also shows when it was collected and
whether the collector behind it is healthy. See
[PLATFORM_STATUS.md](PLATFORM_STATUS.md) for the JSON contract, the health
logic, and how a future module (Queue Insights, Slurm Insights, Predictions,
...) registers itself.

## Software Inventory

The Software Inventory page (installed Environment Modules, scanned
nightly by the private repo) follows this same shell/loader/Platform
Status pattern - see
[SOFTWARE_INVENTORY_FRONTEND.md](SOFTWARE_INVENTORY_FRONTEND.md) for its
JSON contract and rendering flow, and
[SOFTWARE_EXPLORER_ARCHITECTURE.md](SOFTWARE_EXPLORER_ARCHITECTURE.md) for
the interactive filtering/dashboard layer built on top of it.
