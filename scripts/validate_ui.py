from pathlib import Path
root = Path(__file__).resolve().parents[1]
app = (root / 'js' / 'app.js').read_text()
loader = (root / 'js' / 'data-loader.js').read_text()
assert "loadMjolnirData" in app
assert "loadPersonalData" in app
assert "Prototype Personal Dashboard - Authentication Not Yet Enabled" in app
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
print('ui checks passed')
