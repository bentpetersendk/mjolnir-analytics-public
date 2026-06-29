# Software Inventory Frontend (Software Analytics Milestone 1b)

The Software Inventory page is the frontend half of Software Analytics
Milestone 1 - it renders `software_inventory.json` (private repo's
`scripts/export_software_inventory.py`, schema `software-inventory-v1`,
see that repo's `docs/architecture/SOFTWARE_INVENTORY_ARCHITECTURE.md`)
exactly as exported. No AI enrichment, no usage statistics, no job
metadata, no categories/tags - those are later milestones. This page only
ever displays fields that already exist in the export today.

## JSON contract

Fetched from `${MJOLNIR_DASHBOARD_DATA_BASE}software_inventory/software_inventory.json`
(same dashboard-data CDN base every other module uses - see
`DASHBOARD_DATA_MIGRATION.md`).

```json
{
  "schema_version": "software-inventory-v1",
  "generated_at": "...",
  "collector": "software_inventory_export",
  "collector_status": "ok",
  "platform_module": "Software Inventory",
  "failure_message": null,
  "expected_refresh_seconds": 86400,
  "warning_after_intervals": 2,
  "critical_after_intervals": 3,
  "summary": {
    "installed_modules": 0, "new_modules": 0, "removed_modules": 0,
    "total_modules_ever_seen": 0, "recent_window_days": 7
  },
  "modules": [
    {"module_name": "...", "module_version": "...", "modulefile_path": "...",
     "whatis_text": "...", "first_seen": "...", "last_seen": "...", "removed_at": null}
  ]
}
```

This loader is the one exception to this repo's usual privacy-tier
handling (`PLATFORM_STATUS.md`, `PUBLICATION_REVIEW.md`): `module_catalog`
has no username, jobid, account, or work-directory field anywhere in it, so
there is no forbidden-field gate for this module the way there is for
every job/user-derived export.

**What is deliberately not in this contract**: `help_text` and
`module_show` exist in the private repo's `module_catalog` table but are
not published in this export (raw admin-debug text, not dashboard
payload - see `SOFTWARE_INVENTORY_ARCHITECTURE.md`'s exporter section).
The module detail page therefore has no "module help" / "module show"
section - rendering one would mean inventing a field the export does not
provide, which this milestone's brief explicitly forbids. If a future
milestone changes the exporter to publish them, the detail page gains one
more `<section>`, nothing else changes.

## Rendering flow

```
loadSoftwareInventoryData()        js/data-loader.js
  fetch software_inventory.json (tryOptionalJson - missing file and
  malformed JSON both degrade to the same "unavailable" shape, never throw)
        |
        v
  normalizeSoftwareModule() per row: snake_case export keys -> camelCase
  (moduleName, moduleVersion, modulefilePath, whatisText, firstSeen,
  lastSeen, removedAt) - the one place that contract lives, not duplicated
  across page renderers
        |
        v
softwareInventory (module-level variable, js/app.js)
  loaded once in init()'s Promise.all alongside every other module, kept
  fresh by the existing 5-minute background auto-refresh
  (js/refresh-manager.js) - same pattern as Queue/Node Insights, not a
  separate polling loop
        |
        v
render() -> softwareInventoryPage() / moduleDetailPage(path)
  state.softwareInventoryFilters { search, statusFilter, sortKey, sortDir,
  page } drives client-side filter -> sort -> paginate over the one
  already-loaded modules array - no fetch, no JSON re-parse, on any
  keystroke/sort-click/filter-change/page-click
```

### Why a dedicated module detail *route*, not an inline expand panel

`#/module/<encodeURIComponent(modulefile_path)>` mirrors the existing
`#/node/<name>` Node Detail pattern exactly (`nodeDetailPage`/
`isNodeDetailRoute` in `js/app.js`) rather than introducing a new
inline-expanding-row pattern this codebase doesn't otherwise use.
`modulefile_path` (not `module_name`/`module_version`) is the route key
because the same name/version pair can be installed under more than one
MODULEPATH root - see `SOFTWARE_INVENTORY_ARCHITECTURE.md`'s "shadowed
duplicates" section - and unlike a node name, a modulefile path is itself
full of `/` characters, so the whole remainder of the route after
`module/` is captured as one `encodeURIComponent()`-escaped segment
instead of being split on `/` the way `node/<name>` and `project/<id>` are.

### Search-while-typing without losing focus

`render()` rebuilds the whole page's `innerHTML` on every state change -
fine for clicks, but a naive `render()` on every keystroke in the search
box would destroy and recreate the `<input>` element, dropping focus and
cursor position after every character. The search input's own `input`
listener (`js/app.js` `wireEvents()`) captures `selectionStart` before
calling `render()` and re-focuses + restores the caret position
immediately after - the same fix-up idea `rerenderPreservingViewState()`
already applies to scroll position and open `<details>` elements
elsewhere in this file, just scoped to one input.

## Performance

- **Client-side filtering/sorting**: `softwareInventoryFilteredModules()`
  filters and sorts the in-memory array on every render - trivially fast
  at the scale this catalogue is at (low thousands of modules), no
  pagination-aware fetching needed.
- **Lazy rendering via pagination**: `SOFTWARE_INVENTORY_PAGE_SIZE = 50` -
  only the current page's rows are ever turned into `<tr>` HTML, regardless
  of total catalogue size.
- **No repeated fetches**: `software_inventory.json` is fetched once in
  `init()` and again only by the shared 5-minute background refresh timer -
  never on a keystroke, sort click, filter change, or page click (all of
  those only touch `state.softwareInventoryFilters` and re-render from the
  array already in memory).

## Platform Status integration

Registered in `buildPlatformRegistry()` (`js/status.js`) as module id
`software-inventory`, kind `analytics`, reading
`collector`/`collector_status`/`generated_at`/`expected_refresh_seconds`/
`warning_after_intervals`/`critical_after_intervals` straight from the
export - same Collector Health contract
(`PLATFORM_STATUS.md`/private repo's `COLLECTOR_HEALTH.md`) every other
module uses, not a hardcoded freshness threshold. `softwareInventoryStatusBar()`
renders it at the top of both the inventory and detail pages.

## Status indicators

Two states exist in `module_catalog` today and are the only two this page
renders: 🟢 Installed (`removedAt` is `null`) and ⚪ Removed (`removedAt` is
set). The brief names two future states (🟡 Update Available, 🔵 AI
Enriched) that this milestone explicitly does not implement -
`softwareStatusPill()`'s only job is to read `removedAt`, never to guess at
a state nothing in the export supports yet. Adding a third/fourth state
later is a matter of adding more cases to that one function once the
underlying export field actually exists - no template or layout change.

## Future extension points

This page is meant to become the foundation for a Software Intelligence
dashboard (AI enrichment, categories/tags, usage statistics, popularity,
recommendations - see the private repo's
`docs/roadmap/SOFTWARE_ANALYTICS_COLLECTOR_DESIGN.md`). Nothing here was
built to anticipate those fields with placeholders; instead, the structure
already has clean seams for them:

- **Module detail page**: a sequence of independent `<section>` blocks
  inside one `.stack` container (`moduleDetailPage()` in `js/app.js`). A
  future milestone adds a new `<section>` (e.g. "Enrichment", "Usage",
  "Related Software") wherever it belongs in that sequence - every existing
  section is untouched.
- **Summary cards**: `softwareInventorySummaryCards()` returns a
  `.cards-grid` of `statBlock()` calls. Cards like "Most Popular Package"
  or "Containers Detected" (once usage data exists) are one more
  `statBlock()` call in that same array.
- **Table columns**: `softwareInventorySortableTable()`'s `columns` array
  is the single source of both header labels and sort keys. A future
  column (e.g. "Category" once enrichment exists) is one more entry there
  plus one more `<td>` in the row template - the search/sort/pagination
  logic above it does not change.
- **Data loader contract**: `normalizeSoftwareModule()` in
  `js/data-loader.js` is the one place the export's snake_case keys become
  this app's camelCase fields. A new exported field becomes one more
  destructured key there, immediately available to every page function
  without touching the fetch/error-handling logic around it.
- **Status pill**: `softwareStatusPill()` is a pure function of one field
  (`removedAt`) today; a future "Update Available"/"AI Enriched" state is
  an additional branch reading whatever new field backs it, not a redesign
  of the pill itself.

None of this is implemented speculatively now - it is just why adding it
later does not require restructuring what already exists.
