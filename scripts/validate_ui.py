from pathlib import Path
root = Path(__file__).resolve().parents[1]
app = (root / 'js' / 'app.js').read_text()
loader = (root / 'js' / 'data-loader.js').read_text()
status = (root / 'js' / 'status.js').read_text()
assert "loadMjolnirData" in app
assert "loadPersonalData" in app
assert "Prototype Personal Analytics - Authentication Not Yet Enabled" in app
assert "fetch(" in loader
assert "loadPersonalData" in loader
assert "normalizePersonalUserViewModel" in loader
assert "sourcePath" in loader
assert "user_token" not in app
assert "WorkDir" not in app

# Node Insights (Phase 1 public port): public-safe live Slurm fleet views.
assert "loadNodeInsightsData" in app
assert "loadNodeInsightsData" in loader
for fn in (
    "infrastructureOverviewPage", "nodeInventoryPage", "hardwareInventoryPage",
    "capacityPlanningPage", "nodeDetailPage",
):
    assert fn in app, f"missing Node Insights page renderer: {fn}"
for route_id in ("infrastructure", "nodes", "hardware", "capacity"):
    assert f"id: '{route_id}'" in app, f"missing Node Insights nav route: {route_id}"
assert "isNodeDetailRoute" in app
assert "GresUsed" in app
assert "WorkDir" not in loader
assert "JobName" not in app and "JobName" not in loader

# Node Insights history (Phase 2: persistent historical monitoring).
assert "loadNodeInsightsHistory" in app
assert "loadNodeInsightsHistory" in loader
assert "mountCharts" in app
for fn in ("capacityHistorySection", "drainingHistorySection", "nodeHistorySection"):
    assert fn in app, f"missing Node Insights history renderer: {fn}"

# Queue Insights (docs/architecture/QUEUE_INSIGHTS_ARCHITECTURE.md): one
# shared module, five pages, fed by a single loader rather than each page
# fetching its own data.
assert "loadQueueInsightsData" in app
assert "loadQueueInsightsData" in loader
for fn in (
    "queueOverviewPage", "queueLivePage", "queueWaitTimesPage",
    "queueAdvisorPage", "queueTrendsPage", "queueHealthBadge",
):
    assert fn in app, f"missing Queue Insights page renderer: {fn}"
for route_id in ("queue-overview", "queue-live", "queue-wait-times", "queue-advisor", "queue-trends"):
    assert f"id: '{route_id}'" in app, f"missing Queue Insights nav route: {route_id}"
assert "JobName" not in app and "JobName" not in loader

# Collector Health architecture (docs/architecture/COLLECTOR_HEALTH.md): one
# generic helper, fed by per-collector cadence metadata, no module-specific
# or hardcoded freshness thresholds anywhere in the frontend.
assert "calculateCollectorHealth" in status, "missing calculateCollectorHealth() helper"
assert "HEALTH_THRESHOLDS_MS" not in status, "hardcoded freshness threshold constant must not exist"
for hardcoded in ("2 * 60 * 60 * 1000", "6 * 60 * 60 * 1000"):
    assert hardcoded not in status, f"hardcoded freshness threshold found: {hardcoded}"
for field in ("expectedRefreshSeconds", "warningAfterIntervals", "criticalAfterIntervals"):
    assert field in status, f"missing collector cadence field: {field}"
    assert field in loader, f"data-loader.js does not thread through {field}"
assert "Expected Refresh" in status, "missing Expected Refresh UI row"
assert "Next Expected Update" in status, "missing Next Expected Update UI row"
assert "Snapshot Age" not in status, "Snapshot Age must not appear in the collector status display"

# Executive Overview (docs/EXECUTIVE_OVERVIEW.md): the landing page reuses
# loaded module data rather than fetching anything new, and the eight
# required sections all render from landingPage().
for fn in (
    "clusterHealthState", "clusterHealthHero", "executiveKpiSection",
    "overnightSummarySection", "executiveWarehouseSection", "reductionFunnel",
    "executiveQueueSection", "currentAlerts", "currentAlertsSection",
    "executiveRecommendations", "recommendationsSection", "platformOverviewSection",
):
    assert fn in app, f"missing Executive Overview renderer: {fn}"
assert "queueInsights" in app and "buildPlatformRegistry({ data, nodeInsights, nodeInsightsHistory, slurmAnalyticsPipeline, queueInsights, softwareInventory })" in app, \
    "Queue Insights/Software Inventory must be registered in buildPlatformRegistry, not left planned"
assert "{ id: 'queue-insights'" not in status, "Queue Insights must not remain in PLANNED_MODULES now that it has a real collector"
assert "renderSystemHealthCard" not in app and "renderSystemHealthCard" not in status, \
    "renderSystemHealthCard was superseded by the Executive Overview hero/Platform Overview - should be removed, not left dead"

# Software Intelligence Milestone 2 (docs/architecture/SOFTWARE_INVENTORY_ARCHITECTURE.md,
# "Milestone 2: version relationships"): related versions/default version/
# version navigation on the module detail page, all derived from the new
# module_families export key - no AI, no web lookup, no job/usage data.
assert "normalizeModuleFamilies" in loader, "missing module_families normalizer in data-loader.js"
assert "moduleFamilies" in loader and "moduleFamilies" in app, \
    "moduleFamilies must be threaded from data-loader.js through to app.js"
assert "relatedVersionsSection" in app, "missing Related Versions section renderer"
assert "Related Versions" in app, "missing Related Versions section heading"
assert "Default Version" in app, "missing Default Version stat label"
assert "Technical Details" in app, "Location section must be renamed to Technical Details"
assert "<h2>Location</h2>" not in app, "old Location heading must not remain alongside the new Technical Details heading"
assert "technicalDetailsRows" in app, "Technical Details rows must come from an extensible row-list helper, not a hardcoded table body"

# Software Knowledge Milestone 3 (docs/architecture/SOFTWARE_KNOWLEDGE_ARCHITECTURE.md):
# deterministic, exact-match-only software facts (homepage/repository/
# license/upstream version), Software Health summary cards, and
# deterministic Related Software - no AI, no web summarization, no fuzzy
# matching anywhere in the frontend.
assert "normalizeModuleKnowledge" in loader, "missing module_knowledge normalizer in data-loader.js"
assert "normalizeKnowledgeSummary" in loader, "missing knowledge_summary normalizer in data-loader.js"
assert "normalizeRelatedSoftware" in loader, "missing related_software normalizer in data-loader.js"
assert "moduleKnowledge" in loader and "moduleKnowledge" in app, \
    "moduleKnowledge must be threaded from data-loader.js through to app.js"
assert "knowledgeSummary" in loader and "knowledgeSummary" in app, \
    "knowledgeSummary must be threaded from data-loader.js through to app.js"
assert "relatedSoftware" in loader and "relatedSoftware" in app, \
    "relatedSoftware must be threaded from data-loader.js through to app.js"
for fn in (
    "knowledgeSection", "projectLinksSection", "releaseInformationSection",
    "citationSection", "relatedSoftwareSection", "softwareHealthSection",
):
    assert fn in app, f"missing Software Knowledge section renderer: {fn}"
assert "Latest Installed Version" in app, "missing Latest Installed Version stat (Version Intelligence)"
assert "Update Available" in app, "missing Update Available row (Version Intelligence)"
assert "updateAvailable" in loader, "update_available must be threaded through by data-loader.js, not recomputed in app.js"
# The frontend must never implement its own version comparison - Milestone
# 2 already established this rule (pre-sorted arrays only); update_available
# being computed server-side and merely rendered here is the same rule
# applied to Milestone 3's Version Intelligence. (Comments referencing the
# backend's version_sort_key() by name are fine - only a same-named
# function *definition* in app.js would violate this.)
assert "function versionSortKey" not in app and "function version_sort_key" not in app, \
    "app.js must not implement its own version-sort/comparison function"

# Software Explorer Milestone 4 (interactive dashboard - clickable cards,
# quick filter bar, rich badges, description precedence, Software
# Collections, Administrator Dashboard). "filter-software-status" (the old
# single Status <select>) must be gone - quickFilter replaces it, the same
# one filtering framework extended, not a second one introduced alongside it.
assert 'data-action="filter-software-status"' not in app, \
    "old single Status <select> must be removed, not left alongside the new quick-filter mechanism"
assert "QUICK_FILTERS" in app, "missing the shared quick-filter predicate registry"
assert "set-quick-filter" in app, "missing the single click-action every clickable card/badge/bar-button must share"
assert "quickFilterBar" in app, "missing the persistent quick-filter bar renderer"
assert "clickableStatBlock" in app, "summary/health/admin cards must use a clickable card helper, not plain statBlock()"
assert "softwareStatusBadges" in app, "missing the rich multi-badge status renderer"
assert "administratorDashboardSection" in app, "missing the Administrator Action Needed section"
assert "displayDescription" in app and "displayDescription" in loader, \
    "displayDescription (server-computed description precedence) must be threaded through, not recomputed in app.js"
for filter_id in (
    "updates-available", "knowledge-available", "missing-metadata", "with-repository",
    "with-homepage", "with-documentation", "with-license", "recently-added", "recently-updated",
    "deprecated-versions", "missing-homepage", "missing-repository", "missing-license",
):
    assert f"'{filter_id}'" in app, f"missing quick filter id: {filter_id}"

# Analytics module migration (Version 1.2, private repo's
# docs/architecture/ANALYTICS_WAREHOUSE.md Section 10): retires the
# locally-committed efficiency_v3 90-day snapshot for the eight pages that
# still depended on it, in favor of the same dashboard-data CDN pattern
# every other module above already uses.
assert "data/efficiency_v3/site_data_90d_validation" not in loader, \
    "loader must no longer read the retired efficiency_v3 snapshot path"
assert "public_user_id" in loader, "loader must read public_user_id, not the legacy user_token"
for fn in (
    "clusterPage", "clusterHealthPage", "rankingsPage", "benchmarkPage",
    "recommendationsPage", "inefficientJobsPage", "costPage", "personalAnalyticsPage",
):
    assert fn in app, f"missing Analytics page renderer: {fn}"
for route_id in (
    "cluster", "cluster-health", "rankings", "benchmarks",
    "recommendations", "inefficient-jobs", "cost",
):
    assert f"id: '{route_id}'" in app, f"missing Analytics nav route: {route_id}"

# Version 1.3 (Reporting & Executive Briefings,
# docs/architecture/REPORTING_ARCHITECTURE.md): a presentation-only layer
# on top of the existing exports - reports must never recalculate a metric
# or duplicate the server-side business logic already in the admin repo's
# export_analytics_data.py.
ui_helpers = (root / 'js' / 'ui-helpers.js').read_text()
reporting_dir = root / 'js' / 'reporting'
reporting_files = {p: p.read_text() for p in reporting_dir.rglob('*.js')}
reporting_src = '\n'.join(reporting_files.values())

assert "report-shell" in reporting_src, "missing report shell wrapper (render.js's reportShellHtml())"
assert "sectionsToMarkdown" in reporting_src, "missing Markdown render target"
assert "chartsReady" in reporting_src, "missing chart-readiness signal usage in print.js"
assert "document.body.dataset.chartsReady" in app or "document.body.dataset.chartsReady" in reporting_src, \
    "missing chart-readiness signal (charts.js's mountCharts() must set this)"

for fn in (
    "buildExecutiveReportModel", "buildWeeklyReportModel", "buildPiReportModel",
    "buildUserReportModel", "buildQueueReportModel", "buildCapacityReportModel",
):
    assert fn in reporting_src, f"missing report data assembler: {fn}"
for fn in (
    "executiveReportPage", "weeklyReportPage", "piReportPage",
    "userReportPage", "queueReportPage", "capacityReportPage",
):
    assert fn in reporting_src, f"missing report page function: {fn}"
for route_id in ("reports-executive", "reports-weekly", "reports-queue", "reports-capacity"):
    assert f"id: '{route_id}'" in app, f"missing Reports nav route: {route_id}"
assert "isUserReportRoute" in app, "missing User Report route matcher"
assert "isPiReportRoute" in app, "missing PI Report route matcher"

# Shared-helper extraction: statBlock/tableFromRows/pct/money/fmt/escapeHtml
# must be defined exactly once (ui-helpers.js), imported by both app.js and
# the reporting layer - not redefined locally in either.
for helper in ("statBlock", "tableFromRows", "pct", "money", "fmt", "escapeHtml", "num"):
    assert f"export function {helper}(" in ui_helpers, f"missing shared helper in ui-helpers.js: {helper}"
for helper in ("statBlock", "tableFromRows", "pct", "money", "escapeHtml"):
    assert f"\nfunction {helper}(" not in app, f"{helper} must not be redefined locally in app.js - it lives in ui-helpers.js"

# Mechanical "no duplicated business logic" check: the specific cost-model/
# recommendation-threshold constants and arithmetic the admin repo's
# export_analytics_data.py already owns must never reappear in the
# reporting layer. This doesn't prove correctness, but it catches the
# concrete failure mode of someone copy-pasting a formula instead of
# reading the already-exported field.
FORBIDDEN_RECALCULATION_PATTERNS = (
    "LOW_EFFICIENCY_THRESHOLD",
    "MIN_JOBS_FOR_RECOMMENDATION",
    "measured_cpu_hours /",
    "measured_mem_gb_max_sum /",
    "cpu_hours_allocated /",
    "requested_mem_gb_hours /",
)
for pattern in FORBIDDEN_RECALCULATION_PATTERNS:
    for path, src in reporting_files.items():
        assert pattern not in src, f"possible duplicated business logic in {path.name}: found '{pattern}'"

print('ui checks passed')
