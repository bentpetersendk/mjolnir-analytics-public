# Reporting Architecture (Version 1.3 — Reporting & Executive Briefings)

Version 1.2 (Warehouse Analytics Migration) brought every dashboard page onto
live, nightly-exported, already-computed warehouse data. Version 1.3 does not
add a new dashboard - it adds a **presentation-only reporting layer** on top
of the data that already powers Executive Overview, Queue Insights, Node
Insights, Platform Status, and Personal Analytics: PDF/HTML/Markdown
executive briefings, a weekly operational report, and per-PI/per-user/queue/
capacity reports. The guiding rule, enforced both by convention and by a
mechanical check in `scripts/validate_ui.py`:

> Reports consume only the exported analytics JSON already powering the
> dashboard. No duplicate business logic. No recalculation of metrics
> already produced by the warehouse.

Job/entity efficiency recommendations (`recommendations[]`) are already
computed server-side by the admin repo's `export_analytics_data.py` and
surfaced as-is. The reporting layer's own `js/reporting/rules/insights.js`
only generates the *new* category of insight the spec asked for that has no
server-side equivalent (queue-pressure trend, GPU demand, node availability,
warehouse freshness) - and even those are simple comparison/threshold logic
over numbers the warehouse already computed, never a recalculation of
efficiency, cost, or aggregation metrics from raw data.

## The shared structured intermediate (`js/reporting/model.js`)

Every report's `data/<name>ReportData.js` module produces a `ReportModel` -
plain data, no HTML - built from a small, fixed vocabulary of typed section
descriptors:

```
stat-grid             - a row of stat cards (label/value/trend/tone)
table                 - headers + rows
chart                 - a raw ECharts option object
text                  - a heading + paragraph
recommendation-list   - severity/title/suggestion entries
html                  - an escape hatch for embedding a complete,
                         already-built HTML fragment (see below)
omitted               - "not yet available" - see "Known data gaps"
```

Every render target (HTML, print, Markdown) is a thin reader over the same
`sections` array, so "what sections exist, what order, what's omitted when
data is missing" is decided exactly once per report, not once per render
target. This is the single biggest design decision in this layer: it
prevents the four render targets the spec asked for from becoming four
independent, driftable template authors.

### The `html` escape hatch

`registerChart()`/`createLineChart()` (`js/charts.js`) build their own
ECharts option **and** call into the page-global chart registry **and**
return finished HTML, all in one call - and that call has to happen at
template-build time, in the page function, the same place every other
dashboard page already calls them (the chart registry is only valid during
the current `render()` pass; a data assembler can't call it). `htmlSection()`
exists for exactly this case - see `js/reporting/pages.js`'s
`executiveReportPage()` for the pattern: `buildExecutiveReportModel()`
returns a data-only model, then the page function splices in
`htmlSection('Cluster Trends', createLineChart(...))` before rendering. The
Markdown renderer shows a placeholder note for `html` sections instead of
attempting to convert arbitrary HTML.

## Render targets

### HTML (`js/reporting/render.js`'s `sectionsToHtml()`)

Each report is a normal app.js "page" function (`(ctx) => htmlString`),
registered into the existing `renderers` route-dispatch object exactly like
`landingPage()`/`clusterPage()`/etc. No parallel router. Charts use the
existing two-phase `registerChart()`/`mountCharts()` pattern unmodified.

### Markdown (`sectionsToMarkdown()`)

Reads the same `sections` array, driven entirely from the model - never by
parsing the HTML back into Markdown. Downloaded via a Blob (the same pattern
`charts.js`'s CSV export button already uses), triggered by the report
shell's "Download Markdown" button.

### Print-friendly HTML and PDF (`css/reporting-print.css`, `js/reporting/print.js`)

These are **not two separate rendering passes**. Print is the exact same
report route's already-rendered DOM, shown through `@media print` CSS. PDF
is that same print view captured via the browser's own print-to-PDF -
either interactively (`window.print()`, the "Download PDF" button - the
user picks "Save as PDF" in the system print dialog, the same pattern many
SaaS report-download buttons already use) or headlessly
(`scripts/generate_report_pdf.py`, Chrome's native `--print-to-pdf` flag).
The artifact is identical either way, which is what makes Phase 9
(scheduled generation) possible later without redesigning anything here.

No new dependency was introduced for any of this - this repo has zero build
tooling and that wasn't going to change for a reporting feature.

#### Chart readiness

ECharts' SVG layout can still settle in a microtask/animation-frame after
`init()`/`setOption()` return, so a headless `--print-to-pdf` invocation
can't just fire on page load. `js/charts.js`'s `mountCharts()` now sets
`document.body.dataset.chartsReady = 'true'` once every chart mounted in
that render pass has fired its own `finished` event;
`js/reporting/print.js`'s interactive PDF trigger polls this before calling
`window.print()`. This was built into Phase 1 deliberately, not retrofitted
after building all 6 report types - retrofitting a readiness hook after the
fact is exactly the kind of redesign Phase 9's "without redesign"
requirement is meant to avoid.

`scripts/generate_report_pdf.py` (today, headless, manual-invocation only)
cannot poll this flag the way a real Phase 9 implementation eventually
should - this environment has a raw Chrome binary but no CDP-scriptable
driver (no Node 18+/Puppeteer, no Python Playwright) to do that polling. It
uses a generous `--virtual-time-budget` instead, and validates its own
output (PDF header + page count, not just a nonzero file size - see
"Lessons from the headless PDF generator" below) rather than trusting the
wait blindly. The `chartsReady` attribute already exists for whichever
CDP-scriptable driver eventually upgrades this script.

#### A4 landscape is a whole-document variant

`body.report-landscape` (toggled in `app.js`'s `render()` for the Capacity
Report, whose utilization tables run wide) switches the entire document's
`@page` rule to landscape. This is **not** mixed per-page orientation within
one PDF - cross-browser support for switching orientation mid-document is
unreliable, so every other report stays A4 portrait and Capacity Report is
landscape for its whole length. A deliberate constraint, not an oversight.

## Data flow

`app.js`'s `init()` already does one bulk `Promise.all()` over every global
data source (`data`, `nodeInsights`, `nodeInsightsHistory`,
`slurmAnalyticsPipeline`, `queueInsights`, `softwareInventory`) before the
first `render()`. Executive, Weekly, Queue, and Capacity reports are
**synchronous** - they just read these already-loaded, module-level
view-models, the same way every other dashboard page does. No new fetch.

PI Report (`#/reports/pi/<id>`) looks the PI up from the already-loaded
`data.pis[]` array (`findPi()`, the same array `hierarchyDetailPage('pi',
id)` already uses) - also synchronous.

User Report (`#/u/<token>/report`) is the one report that needs the
existing async personal-bundle fetch - and it reuses that fetch exactly,
rather than adding a second one. `isPersonalRoute()`'s regex was extended
(not duplicated into a parallel matcher) to also match the `/report`
suffix, so `handleRoute()`'s existing `isPersonalRoute -> loadPersonalRoute()`
trigger fires automatically for the report route with no further wiring.
This also means the User Report inherits the exact same privacy model
Personal Analytics already has: reached only via the unguessable
`personal_route_token` capability link, never a second, more-guessable
identifier, and never any plaintext token logging.

## Known data gaps

Handled by graceful, visible omission (the `omitted()` section type) -
**never** approximated or recomputed client-side:

- **PI-level `top_inefficient_jobs`**: `pi_summaries.json` is built from
  pre-aggregated `daily_pi_summary` rollups with no per-job/per-PI join
  path materialized today. (PI-level `recommendations[]`, by contrast,
  *was* already present - `build_hierarchy_entity()` in the admin repo
  calls the same generic `recommendations()` for every hierarchy entity,
  PI included - confirmed against live production data during
  development, not duplicated here.)
- **Per-PI active-user counts**: `all_time_summary` at PI/project/group/
  section level does not include `unique_users` - that field only exists
  at cluster level in the current export.
- **Storage growth / warehouse-size growth**: only the current
  `database_size_bytes` snapshot is exported, no historical series exists
  to derive a growth trend from.
- **7-day-summed new-user/new-project totals**: only the most recent single
  night's delta (`warehouse_metadata.overnight`) is exported, not a
  retained week of deltas. The Weekly Report shows that single night's
  figure, correctly labeled, rather than mislabeling it as a 7-day sum.

The User Report's "progress vs. previous period" is the one case where a
real comparison *is* derivable from already-exported data: summing the
already-exported `daily_trends` array's 8-14-days-ago slice against its
0-6-days-ago slice (`rules/insights.js`'s `sumTrendWindow()`/
`avgTrendWindow()`) is aggregation of already-final per-day numbers, not
recalculation - but it includes a coverage check that returns `null`
(rendered as `omitted()`) rather than a misleading partial figure if either
window has too few days present.

## Lessons from the headless PDF generator

Two issues surfaced during development that are worth keeping in mind for
anyone extending this layer, both findings from testing against real
production data rather than fixtures:

1. **A "render check passed" can hide a real lookup failure.** PI Report's
   and User Report's not-found fallback states deliberately reuse the same
   report title as the success state (so the page is recognizably "a PI
   Report", just one reporting that nothing was found) - which means a
   render check that only looks for the title string is a false-positive
   risk. `scripts/validate_reports.py` checks for the exact fallback
   sentences (`"No PI record was found for this identifier."` etc.)
   instead.
2. **This server has real outbound internet access to the production CDN.**
   A test script that assumes the dashboard always falls back to
   `sample-data/` (because "there's no internet in a sandboxed test
   environment") will silently test against sample IDs that don't exist in
   whatever data actually loaded. `validate_reports.py`'s PI-id lookup
   replicates `data-loader.js`'s own real-CDN-then-sample-data fallback
   chain for exactly this reason.

## Future extensions (not implemented in Version 1.3)

- **Phase 9, scheduled generation**: `scripts/generate_report_pdf.py` is
  the concrete foundation - swap its `--virtual-time-budget` wait for a
  `chartsReady`-polling CDP driver (Puppeteer/Playwright) when one is
  available, then wire it to a scheduler (cron, systemd timer) for
  weekly/monthly emails. No redesign of the rendering layer needed.
- **Phase 10, sharing**: PDF/HTML/Markdown download all exist today.
  Email and share-links would need a server-side component to actually
  send/host the generated artifact - the artifact itself (the PDF bytes
  from `generate_report_pdf.py`, or the Markdown string from
  `sectionsToMarkdown()`) is already produceable without a browser in the
  loop, which is the prerequisite either future feature needs.
- A REST API for on-demand report generation would call the same
  `data/*ReportData.js` + `render.js` functions this layer already has,
  from a server-side JS runtime instead of the browser - the section-
  descriptor model was deliberately kept framework-agnostic (plain data
  in, plain strings out) to make that possible later without rewriting
  the report logic itself.
