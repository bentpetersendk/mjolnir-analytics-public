#!/usr/bin/env bash
# Exports the latest Node Insights public JSON from data/node_insights.sqlite
# and, only if it actually changed, commits and pushes those generated files
# to the dashboard-data repo (bentpetersendk/dashboard-data, mjolnir/
# directory) - NOT this repo. Workflow: sync clone -> export -> detect
# changes -> commit+push if changed, otherwise exit cleanly with no commit.
# See "Workflow" in NODE_INSIGHTS_ARCHITECTURE.md Section 8 and
# docs/DASHBOARD_DATA_MIGRATION.md for the full description and rationale.
#
# This script NEVER adds the SQLite database, raw data, or logs to git, and
# NEVER commits anything into this repo (mjolnir-analytics-public)
# - it stages exactly the three generated files inside a separate clone of
# dashboard-data. Run manually, or as the second half of
# scripts/run_node_insights_cycle.sh (invoked hourly by
# mjolnir-node-collector.timer).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Persistent sibling clone of bentpetersendk/dashboard-data, pushed to over
# SSH using a deploy key scoped to that repo only (~/.ssh/config Host
# github.com-dashboard-data) - distinct from mjolnir_dashboard_deploy_key,
# which is scoped to this repo and never used for this purpose.
DASHBOARD_DATA_DIR="${MJOLNIR_DASHBOARD_DATA_DIR:-$REPO_ROOT/../dashboard-data}"
DASHBOARD_DATA_REMOTE="git@github.com-dashboard-data:bentpetersendk/dashboard-data.git"
DASHBOARD_DATA_BRANCH="main"
DASHBOARD_DATA_SUBDIR="mjolnir"

PUBLIC_FILES=(
  "node_insights.json"
  "capacity_history.json"
  "node_history.json"
)

if [ ! -d "$DASHBOARD_DATA_DIR/.git" ]; then
  echo "dashboard-data clone not found at $DASHBOARD_DATA_DIR - cloning ..."
  git clone "$DASHBOARD_DATA_REMOTE" "$DASHBOARD_DATA_DIR"
fi

echo "Syncing dashboard-data clone ..."
git -C "$DASHBOARD_DATA_DIR" fetch origin "$DASHBOARD_DATA_BRANCH"
git -C "$DASHBOARD_DATA_DIR" checkout "$DASHBOARD_DATA_BRANCH"
# This clone is only ever written by this script, so a hard reset to the
# remote tip is always safe - it's never a place for manual edits.
git -C "$DASHBOARD_DATA_DIR" reset --hard "origin/$DASHBOARD_DATA_BRANCH"

OUT_DIR="$DASHBOARD_DATA_DIR/$DASHBOARD_DATA_SUBDIR"
mkdir -p "$OUT_DIR"

echo "Exporting Node Insights history from data/node_insights.sqlite ..."
python3 scripts/export_node_insights.py --out-dir "$OUT_DIR"

for f in "${PUBLIC_FILES[@]}"; do
  if [ ! -f "$OUT_DIR/$f" ]; then
    echo "error: expected export $OUT_DIR/$f was not generated" >&2
    exit 1
  fi
done

# Safety gate: this runs unattended every hour with nobody reviewing the
# diff before it ships, so refuse to publish if a forbidden field ever
# shows up or a file isn't valid JSON. Same field list as
# scripts/validate_data.py's Node Insights checks.
FORBIDDEN_PATTERN='"(User|JobName|WorkDir|Account|user_token|username|job_id|jobid)"[[:space:]]*:'
for f in "${PUBLIC_FILES[@]}"; do
  path="$OUT_DIR/$f"
  if grep -qE "$FORBIDDEN_PATTERN" "$path"; then
    echo "error: forbidden field pattern found in $path - refusing to publish" >&2
    exit 1
  fi
  if ! python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$path"; then
    echo "error: $path is not valid JSON - refusing to publish" >&2
    exit 1
  fi
done

cd "$DASHBOARD_DATA_DIR"
STAGE_PATHS=("${PUBLIC_FILES[@]/#/$DASHBOARD_DATA_SUBDIR/}")
git add -- "${STAGE_PATHS[@]}"

if git diff --cached --quiet -- "${STAGE_PATHS[@]}"; then
  echo "No dashboard data changes detected. Skipping commit and push."
  exit 0
fi

echo "Dashboard data changed. Publishing update."
git commit -m "Update Mjolnir Node Insights data ($(date -u +%Y-%m-%dT%H:%M:%SZ))"

if ! git push origin "HEAD:$DASHBOARD_DATA_BRANCH"; then
  echo "error: git push failed - public JSON was committed locally in $DASHBOARD_DATA_DIR but NOT published to GitHub" >&2
  exit 1
fi

echo "Published Mjolnir Node Insights data to dashboard-data."
