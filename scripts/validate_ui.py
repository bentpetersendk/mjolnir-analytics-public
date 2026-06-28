from pathlib import Path
root = Path(__file__).resolve().parents[1]
app = (root / 'js' / 'app.js').read_text()
loader = (root / 'js' / 'data-loader.js').read_text()
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
print('ui checks passed')
