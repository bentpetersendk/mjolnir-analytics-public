#!/usr/bin/env bash
# Runs one full Node Insights cycle, invoked hourly by
# mjolnir-node-collector.timer via mjolnir-node-collector.service:
#
#   1. collect_node_insights.py - one Slurm snapshot into SQLite
#   2. publish_dashboard.sh     - export_node_insights.py, then commit+push
#                                 the generated JSON into the separate
#                                 dashboard-data repo (mjolnir/ directory) -
#                                 see docs/DASHBOARD_DATA_MIGRATION.md. This
#                                 repo (mjolnir-efficiency-dashboard-public)
#                                 is never committed to by this cycle.
#
# set -e means a failed collection never reaches the publish step, and a
# failed export (see publish_dashboard.sh's own checks) never gets
# committed or pushed. data/node_insights.sqlite is never staged - only
# the explicit PUBLIC_FILES list in publish_dashboard.sh is.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "=== Node Insights cycle: collect ==="
python3 scripts/collect_node_insights.py --db data/node_insights.sqlite

echo "=== Node Insights cycle: export + publish ==="
bash scripts/publish_dashboard.sh
