# Software Explorer Architecture (Software Explorer Milestone 4)

Software Explorer transforms the Software Inventory page (Milestone 1b)
and its Software Knowledge extensions (Milestones 2-3,
`docs/SOFTWARE_INVENTORY_FRONTEND.md`) from a searchable catalogue into an
interactive dashboard - every summary card is now a filter, a persistent
quick-filter bar sits above the search box, status is multiple independent
badges instead of one pill, and Related Software is a card grid instead of
a plain link list. No AI, no new client-side computation beyond simple
presence/equality checks: every number, percentage, and precedence
decision this page renders was already computed server-side by Milestones
2-3's exporter (`export_software_inventory.py`) or this milestone's small
backend addition (`apply_display_description()`,
`docs/architecture/SOFTWARE_KNOWLEDGE_ARCHITECTURE.md`'s "Milestone 4
additions" in the private repo).

## Interactive filtering: one framework, three surfaces

`QUICK_FILTERS` (`js/app.js`) is a single array of `{id, label, predicate}`
entries - the one filtering implementation the brief asked for, reused by:

1. **The quick-filter bar** (`quickFilterBar()`) - persistent buttons for
   the subset named in Part 2 (`QUICK_FILTER_BAR_IDS`).
2. **Every clickable summary/health/admin card** (`clickableStatBlock()`) -
   Installed Modules, Newly Added, Removed on the inventory summary;
   Knowledge/Homepage/Documentation/Repository/License/Update coverage on
   Software Health; Updates Available/Missing Metadata/Deprecated
   Versions/Missing Homepage/Repository/License on the Administrator
   Dashboard.
3. **Clickable badges** (`clickableBadge()`) - Installed/Removed/Update
   Available/Knowledge Available badges, both in the inventory table and
   on the module detail page.

All three render call sites share one click handler in `wireEvents()`
(`data-action="set-quick-filter"`): it sets
`state.softwareInventoryFilters.quickFilter` and either calls `render()`
directly (already on the inventory page) or navigates there via
`location.hash` (clicked from the detail page) - the existing
`hashchange` -> `handleRoute()` -> `render()` pipeline, no second
rendering path introduced for this.

`softwareInventoryFilteredModules()` (already the one place filtering
happened before this milestone) now applies the selected quick filter's
predicate before the search term, instead of the old separate
`statusFilter` dropdown - **Installed/Removed are now two more entries in
the same `QUICK_FILTERS` vocabulary**, not a second, parallel filtering
axis. This is the literal implementation of the brief's "reuse the
existing client-side filtering framework rather than introducing a second
filtering implementation."

### What a predicate is allowed to read

Every predicate takes `(module, helpers)`, where `helpers.knowledge(m)`/
`helpers.family(m)` look up `module_knowledge`/`module_families` by
`module.moduleName` (`softwareInventoryFilterHelpers()`) - the exact same
two export structures every other part of this page already reads. The
only "new" client-side logic across all sixteen predicates is:

- A handful of presence/equality checks (`!!knowledge?.homepage`, etc.)
- `isDeprecatedVersion()`: a plain string inequality against
  `family.latestInstalledVersion` - a value already sorted server-side by
  `db.version_sort_key()` (Milestone 2/3). This is **not** a new
  version-comparison implementation; it is one equality check against an
  already-resolved result, the same category of operation Milestone 2's
  "no version-ordering logic in the frontend" rule was always about.
- `isRecent()`: a recency window using `snapshotAgeMs()` (`js/status.js`),
  already used elsewhere in this codebase for collector freshness, not a
  new date-handling concept introduced for this milestone.

`validate_ui.py` asserts no `versionSortKey`/`version_sort_key` function
is ever *defined* in `app.js` - comments referencing the backend's
function by name are fine, an actual reimplementation is not.

## Rich status badges (Part 3)

`softwareStatusBadges(module, knowledge, family)` replaces the old single
Installed/Removed pill with however many of four independent badges
apply - **no new states invented**, every badge reads a field the export
already provided before this milestone:

| Badge | Source field |
|---|---|
| 🟢 Installed / ⚪ Removed | `module.removedAt` |
| 🟡 Update Available | `module_knowledge.update_available === true` |
| 🔵 Knowledge Available | `module_knowledge.knowledge_source` present |
| ⭐ Default Version | `family.defaultVersion === module.moduleVersion` |

Used identically in `softwareInventorySortableTable()` and
`moduleDetailPage()` - one function, two call sites, so the table and the
detail page can never show a different status for the same module.
Default Version is the one non-clickable badge: there is no useful
"show me only default versions" filter (the same reasoning
`softwareInventorySummaryCards()` already applies to Module
Roots/Distinct Packages/Versions - a card or badge is only made clickable
when clicking it actually changes the result set).

## Better Descriptions (Part 4)

The table and detail page render `module.displayDescription` - the
exporter's own precedence (registry description -> `module whatis` ->
`module help` -> none), computed once, server-side
(`apply_display_description()`). This page never re-derives that
precedence; it only renders the field. `module.whatisText` remains
available and is shown as a labelled secondary line on the detail page
("Original `module whatis`: ...") whenever it differs from what's
displayed - the brief's "original module whatis should remain stored for
provenance" requirement, made visible, not just retained silently in the
data.

## Software Collections (Part 6)

`relatedSoftwareSection()` renders each related `module_name` (from
`related_software` - exact shared repository/homepage, Milestone 3, never
keywords or fuzzy matching) as a card in a CSS grid
(`.related-software-grid`), carrying whatever of "Latest installed
version / Update Available / Knowledge Available" applies - all data this
page already had in hand via `moduleFamilies`/`moduleKnowledge`, no new
fields. The whole card is one `<a>` (Part 10). The grid layout was chosen
specifically so a future milestone can add one more line inside a card
(e.g. a usage-statistics row) without restructuring the grid itself - the
brief's explicit "design so future usage statistics can be added without
redesign."

## Administrator Dashboard (Part 7)

A new section on the inventory page, six `clickableStatBlock()` cards
(Updates Available, Missing Metadata, Deprecated Versions, Missing
Homepage/Repository/License) into the exact same `QUICK_FILTERS`
mechanism as everything else on this page - this is the "operational
dashboard for software maintenance" the brief asked for, built entirely
out of the filtering framework already described above rather than a
separate page or a new data structure. Renders nothing
(`administratorDashboardSection()` returns `''`) under the same condition
`softwareHealthSection()` already does: knowledge collection has never
run, so there is nothing actionable to show yet.

## Software Health expansion (Part 8)

Five new percentage cards (Homepage/Documentation/Repository/License/
Update Coverage), each reading one of the five new
`knowledge_summary.*_coverage_pct` fields the backend now exports
(`pctLabel()` formats `null` as `-`, never as `0%` or a guess). Every card
is clickable, same mechanism as Part 1.

## Module detail page ordering (Part 9)

Current section order: header (Overview-equivalent: name/version,
badges, First/Last Seen) -> Description -> Related Versions (Installed
Versions) -> Technical Details -> Knowledge -> Project Links -> Release
Information -> Citation -> Related Software. This already matches the
brief's suggested order; no reordering was needed this milestone.
Administrator Notes and Software Usage (both named as future sections in
the brief) are not implemented and have no placeholder - per "every
section should disappear automatically when no data exists. No empty
placeholders," they simply do not exist as functions yet; adding either
later is one more `<section>` appended to this sequence, the same pattern
every section since Milestone 2 has already followed.

## Explorer UX (Part 10)

- **Clickable badges/versions/repositories/related software**: all real
  `<a>`/`<button>` elements, never decorative text - versions and
  repositories were already clickable (Milestones 2-3); badges and
  related-software cards are new this milestone.
- **Breadcrumb navigation**: one line at the top of the detail page
  (`Software Inventory > <module name>`), linking back to the inventory.
- **Remember filter state when returning from a detail page**: already
  true before this milestone and required no new code -
  `state.softwareInventoryFilters` is a module-level object `handleRoute()`
  never resets on navigation, so `quickFilter`/`search`/`sort`/`page` all
  survive a round trip to a detail page and back for free.
- **Preserve scroll position**: genuinely new this milestone. `handleRoute()`
  previously called `render()` directly on every navigation (only the
  background-refresh path, `rerenderPreservingViewState()`, preserved
  scroll position - a different code path, for a different situation: the
  same route re-rendering in place, not navigating between routes). A
  small `routeScrollPositions` map, keyed by route, is now saved on the
  way out of a route and restored on the way back in.
- **Maintain search focus / no unnecessary page reloads**: already true
  before this milestone (Milestone 1b's caret-preserving search input
  listener; this is a hash-routed SPA with no full page reload anywhere) -
  verified still correct, no new code needed.

## Architecture: still server-side, still layered

```
Software Inventory  ->  Software Knowledge  ->  Software Explorer  ->  (future) Software Intelligence
```

Every number, percentage, badge state, and precedence decision Software
Explorer renders was computed by an earlier stage; this milestone adds
**zero** new deterministic computation to the frontend beyond the simple
presence/equality/recency checks listed above. The brief's "do not move
deterministic logic into the frontend - all calculations should remain
server-side whenever practical" is the organizing constraint behind every
decision in this document: `update_available`, `latest_installed_version`,
`display_description`, and all five coverage percentages were already
server-computed before this milestone touched the frontend at all; this
milestone only had to decide *how to render* them, not *how to compute*
them.

## Future compatibility

Nothing in this milestone closes off any of the brief's named future
additions (local AI summaries, scientific domains, tags, workflow
recommendations, Slurm software usage, user/project/PI statistics,
CPU/GPU usage, dependency graphs, co-usage analysis, retirement
recommendations) - none of them are implemented, and no placeholder fields
exist for them anywhere in this milestone, per the brief's explicit "do
not implement these yet." The seams already exist for all of them:

- **A new detail-page section** is one more `<section>` appended to the
  existing sequence (Part 9), the same pattern every section since
  Milestone 2 has followed - no restructuring of existing sections.
- **A new quick filter** is one more entry in `QUICK_FILTERS` (and
  optionally `QUICK_FILTER_BAR_IDS` if it should also be a permanent
  button) - the click handler, `clickableStatBlock()`, and
  `softwareInventoryFilteredModules()` do not change.
- **A new Software Collections card field** (e.g. a usage-statistics
  count) is one more line inside the existing `.related-software-card`
  template - the grid layout does not change.
- **A new Administrator Dashboard card** is one more `clickableStatBlock()`
  call in `administratorDashboardSection()`'s array.
