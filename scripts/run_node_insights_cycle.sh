#!/usr/bin/env bash
# Runs one full Node Insights cycle, invoked hourly by
# mjolnir-node-collector.timer via mjolnir-node-collector.service:
#
#   1. collect_node_insights.py - one Slurm snapshot into SQLite
#   2. publish_dashboard.sh     - export_node_insights.py, then commit+push
#                                 the generated JSON into the separate
#                                 dashboard-data repo (mjolnir/ directory) -
#                                 see docs/DASHBOARD_DATA_MIGRATION.md. This
#                                 repo (mjolnir-analytics-public)
#                                 is never committed to by this cycle.
#
# set -e means a failed collection never reaches the publish step, and a
# failed export (see publish_dashboard.sh's own checks) never gets
# committed or pushed. data/node_insights.sqlite is never staged - only
# the explicit PUBLIC_FILES list in publish_dashboard.sh is.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Production checkouts live at apps/mjolnir/repos/<name>/scripts/..., so the
# application root (apps/mjolnir) is REPO_ROOT's grandparent. Compute it as its
# own step rather than inlining a relative "../../etc/mjolnir.env" string, so
# it's easy to read/log and doesn't depend on guessing path depth by eye. A
# personal dev checkout does not sit under apps/mjolnir, so APP_ROOT there
# resolves to some unrelated directory, MJOLNIR_ENV below is simply absent,
# and this is a no-op - dev always falls back to in-script defaults and can
# never inherit production config.
APP_ROOT="$(cd "$REPO_ROOT/../.." 2>/dev/null && pwd || true)"
MJOLNIR_ENV="${MJOLNIR_ENV:-$APP_ROOT/etc/mjolnir.env}"
if [ -n "$APP_ROOT" ] && [ -r "$MJOLNIR_ENV" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$MJOLNIR_ENV"
  set +a
fi

echo "=== Node Insights cycle: collect ==="
python3 scripts/collect_node_insights.py --db data/node_insights.sqlite

echo "=== Node Insights cycle: export + publish ==="
bash scripts/publish_dashboard.sh
