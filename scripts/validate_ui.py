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
print('ui checks passed')
