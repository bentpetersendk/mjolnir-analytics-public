# Software Inventory Frontend (Software Analytics Milestone 1b + Software
Intelligence Milestone 2 + Software Knowledge Milestone 3)

The Software Inventory page is the frontend half of Software Analytics
Milestone 1 - it renders `software_inventory.json` (private repo's
`scripts/export_software_inventory.py`, schema `software-inventory-v1`,
see that repo's `docs/architecture/SOFTWARE_INVENTORY_ARCHITECTURE.md`)
exactly as exported. No AI enrichment, no usage statistics, no job
metadata, no categories/tags - those are later milestones. This page only
ever displays fields that already exist in the export today.

Software Intelligence Milestone 2 extends the module detail page with
version relationships (Related Versions, Default Version, Technical
Details renamed from Location) - still zero AI/web/job data, see "Version
relationships (Milestone 2)" below.

Software Knowledge Milestone 3 extends it further with deterministic,
exact-match-only software facts collected from public package registries
(homepage, repository, license, upstream version, ...) - still zero AI,
zero web summarization, zero fuzzy matching. See "Software Knowledge
(Milestone 3)" below.

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
     "whatis_text": "...", "first_seen": "...", "last_seen": "...", "removed_at": null,
     "modulepath_root": "..."}
  ],
  "module_families": {
    "...module_name...": {
      "versions": [{"version": "...", "modulefile_path": "..."}],
      "default_version": "...",
      "default_modulefile_path": "...",
      "latest_installed_version": "..."
    }
  },
  "module_knowledge": {
    "...module_name...": {
      "homepage": "...", "documentation_url": "...", "source_repository_url": "...",
      "github_repository_url": "...", "gitlab_repository_url": "...",
      "license": "...", "citation_info": null, "programming_language": "...",
      "maintainer": "...", "upstream_version": "...", "latest_release": "...",
      "release_date": "...", "changelog_url": "...",
      "knowledge_source": "bioconda", "confidence": "exact",
      "last_checked_at": "...", "update_available": true
    }
  },
  "knowledge_summary": {
    "total_active_modules": 0, "modules_with_homepage": 0,
    "modules_with_documentation": 0, "modules_with_repository": 0,
    "modules_with_license": 0, "modules_with_update_available": 0,
    "modules_missing_metadata": 0, "knowledge_coverage_pct": 0.0
  },
  "related_software": {
    "...module_name...": ["...other module_name..."]
  }
}
```

`modulepath_root`/`latest_installed_version` (per-module) and
`module_families` (top-level) are Milestone 2 additions; `module_knowledge`,
`knowledge_summary`, and `related_software` are Milestone 3 additions - all
optional/additive, `schema_version` is unchanged throughout. An export
from before a given milestone simply omits its keys; this loader treats
that exactly like "nothing collected yet," never an error (see "Version
relationships (Milestone 2)" and "Software Knowledge (Milestone 3)"
below).

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

## Version relationships (Milestone 2)

`normalizeModuleFamilies()`/`normalizeModuleFamily()` (`js/data-loader.js`)
turn the export's `module_families` object into
`softwareInventory.moduleFamilies`, keyed by `module_name` exactly as
exported - no client-side grouping or fuzzy matching, since `module_name`
is already the unambiguous relationship boundary (the export computed it
the same way; see the private repo's
`docs/architecture/SOFTWARE_INVENTORY_ARCHITECTURE.md`).

`moduleDetailPage()` looks up `moduleFamilies[module.moduleName]` and
passes it to two new functions:

- **`relatedVersionsSection(module, family)`**: renders nothing if the
  family has only one version (nothing to relate). Otherwise renders a
  "Default Version" stat (omitted entirely when `family.defaultVersion` is
  `null` - this page never guesses one) and a `<ul class="version-list">`
  of every sibling version, newest-first, each a link to
  `#/module/<encodeURIComponent(modulefile_path)>` except the current
  module's own version, which renders as plain bold text with no link (the
  same "don't link to the page you're already on" rule the existing nav
  sidebar follows). A version that is also the resolved default is
  additionally labelled `(default)` alongside `(current)` when both apply.
- **`technicalDetailsRows(module)`**: replaces the old hardcoded
  two-row table body (renamed from "Location") with a small array of
  `[label, value]` pairs, specifically so a future milestone can append a
  row (Module Family, Hidden Module, Dependencies, Aliases - the brief's
  own future-fields list) by adding one array entry, not restructuring the
  section. Today it has exactly two rows: Modulefile Path and MODULEPATH
  Root (the latter now read from the export's `modulepath_root` field when
  present, falling back to the existing client-side `modulePathRoot()`
  derivation for an older export that doesn't have it yet - so this page
  never breaks against a pre-Milestone-2 `software_inventory.json`).

No version-ordering logic exists in the frontend: `family.versions` is
already sorted by the exporter's `version_sort_key()` (natural/numeric,
not alphabetic - see the private repo's architecture doc), so this page
only ever reverses that array for newest-first display, never re-sorts it.

## Software Knowledge (Milestone 3)

Six new render functions, all pure functions of already-loaded data (no
new fetch, no new state) - five on the module detail page, one on the
inventory page. **Every one of them returns `''` when its module has
nothing to show, rather than rendering an empty section or a table full of
dashes** - this is the literal implementation of the brief's "only display
sections when data exists, never display empty placeholders" rule, applied
function-by-function rather than as a single page-level check:

- **`knowledgeSection(knowledge)`**: License, Programming Language,
  Maintainer, Knowledge Source (with confidence), Last Checked - skipped
  entirely when `knowledge.knowledgeSource` is `null` (no registry ever
  matched this exact `module_name`), the same signal
  `knowledge_summary.modules_missing_metadata` counts server-side.
- **`projectLinksSection(knowledge)`**: Homepage/Documentation/Source
  Repository/GitHub/GitLab, each rendered as a real `<a>` (not just
  displayed as plain text) - only the fields that are actually present;
  `''` if none are.
- **`releaseInformationSection(family, knowledge)`**: the one function
  that reads from *both* `moduleFamilies` (installed side) and
  `moduleKnowledge` (upstream side) - Latest Installed Version, Default
  Version, Latest Upstream Version, an Update Available pill, Release
  Date, Changelog link. The Update Available pill is rendered only when
  `knowledge.updateAvailable` is strictly `true` or `false` - never when it
  is `null` (the exporter could not determine it, e.g. no upstream version
  is known at all) - see the next paragraph for why this page never
  computes that comparison itself.
- **`citationSection(knowledge)`**: renders `citation_info` verbatim as a
  paragraph if present. None of the four current backend collectors
  populate this field (see the private repo's
  `SOFTWARE_KNOWLEDGE_ARCHITECTURE.md`) - this section exists so a future
  collector that does needs zero frontend changes, but renders nothing
  today.
- **`relatedSoftwareSection(module, relatedNames, moduleFamilies)`**:
  resolves each related `module_name` (from the export's `related_software`
  - exact shared repository/homepage, computed server-side, never
  keywords or fuzzy matching) to a real link via that name's own family
  entry. `relatedSoftware`/`moduleFamilies` are both keyed by `module_name`,
  so no new lookup structure was needed for this.
- **`softwareHealthSection(knowledgeSummary)`** (inventory page, not the
  detail page): Knowledge Coverage, and a card each for
  homepage/documentation/repository/license/update-available coverage plus
  modules missing metadata - every number is `knowledgeSummary`'s own
  field, rendered, never recomputed from `modules`/`moduleFamilies` client
  side. Renders `''` when `knowledgeSummary.totalActiveModules` is
  `null`/`undefined` (collection has never run, or the export predates
  Milestone 3) rather than a row of zeroes that would misleadingly read as
  "no module has a homepage" instead of "not collected yet."

**No version-comparison logic was added to the frontend for this
milestone either** - `update_available` is computed once,
server-side, by `export_software_inventory.py` (comparing
`module_knowledge.upstream_version` against
`module_families.latest_installed_version` via the exporter's
`version_sort_key()`) and merely rendered here as a pill. This is the same
discipline "No version-ordering logic exists in the frontend" above
already established for Milestone 2's Version Timeline, now applied to
Version Intelligence too - `validate_ui.py` asserts no
`versionSortKey`/`version_sort_key` function is ever defined in `app.js`.

`relatedVersionsSection()` (Milestone 2) also gained a "Latest Installed
Version" stat alongside "Default Version" - both real, sometimes-different
answers (see the private repo's architecture doc for the `gcc` example
where they differ), each skipped individually when `null`.

## Future extension points

This page is meant to become the foundation for a Software Intelligence
dashboard (AI enrichment/`module_intelligence`, usage statistics,
popularity - see the private repo's
`docs/roadmap/SOFTWARE_ANALYTICS_COLLECTOR_DESIGN.md` and
`SOFTWARE_KNOWLEDGE_ARCHITECTURE.md`'s "Future compatibility"). Nothing
here was built to anticipate those fields with placeholders; instead, the
structure already has clean seams for them - Knowledge/Project
Links/Release Information/Citation/Related Software (Milestone 3) are
themselves proof of this: each was added as one more independent
`<section>` without touching Related Versions, Technical Details, or
Description above them.

- **Module detail page**: a sequence of independent `<section>` blocks
  inside one `.stack` container (`moduleDetailPage()` in `js/app.js`). A
  future milestone (e.g. AI enrichment) adds a new `<section>` wherever it
  belongs in that sequence - every existing section is untouched.
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
