#!/usr/bin/env bash
# Exports the latest Node Insights public JSON from data/node_insights.sqlite
# and, only if it actually changed, commits and pushes those generated files
# to GitHub. Workflow: export -> detect changes -> commit+push if changed,
# otherwise exit cleanly with no commit. See "Workflow" in
# NODE_INSIGHTS_ARCHITECTURE.md Section 8 for the full description.
#
# This script NEVER adds the SQLite database, raw data, or logs to git - it
# stages exactly the three generated files under site/data/. Run manually,
# or as the second half of scripts/run_node_insights_cycle.sh (invoked
# hourly by mjolnir-node-collector.timer).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PUBLIC_FILES=(
  "site/data/node_insights.json"
  "site/data/capacity_history.json"
  "site/data/node_history.json"
)

echo "Exporting Node Insights history from data/node_insights.sqlite ..."
python3 scripts/export_node_insights.py

for f in "${PUBLIC_FILES[@]}"; do
  if [ ! -f "$f" ]; then
    echo "error: expected export $f was not generated" >&2
    exit 1
  fi
done

# Safety gate: this runs unattended every hour with nobody reviewing the
# diff before it ships, so refuse to publish if a forbidden field ever
# shows up or a file isn't valid JSON. Same field list as
# scripts/validate_data.py's Node Insights checks.
FORBIDDEN_PATTERN='"(User|JobName|WorkDir|Account|user_token|username|job_id|jobid)"[[:space:]]*:'
for f in "${PUBLIC_FILES[@]}"; do
  if grep -qE "$FORBIDDEN_PATTERN" "$f"; then
    echo "error: forbidden field pattern found in $f - refusing to publish" >&2
    exit 1
  fi
  if ! python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$f"; then
    echo "error: $f is not valid JSON - refusing to publish" >&2
    exit 1
  fi
done

git add -- "${PUBLIC_FILES[@]}"

if git diff --cached --quiet -- "${PUBLIC_FILES[@]}"; then
  echo "No dashboard data changes detected. Skipping commit and push."
  exit 0
fi

echo "Dashboard data changed. Publishing update."
git commit -m "Update Node Insights data ($(date -u +%Y-%m-%dT%H:%M:%SZ))"

if ! git push origin HEAD; then
  echo "error: git push failed - public JSON was committed locally but NOT published to GitHub" >&2
  exit 1
fi

echo "Published Node Insights data to GitHub Pages."
