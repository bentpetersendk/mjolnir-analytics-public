#!/usr/bin/env bash
# Exports the latest Node Insights public JSON from data/node_insights.sqlite
# and pushes only those generated files to the GitHub Pages repo.
#
# This script NEVER adds the SQLite database, raw data, or logs to git - it
# stages exactly the three generated files under site/data/. Run manually or
# from a periodic job on the headnode after the collector has accumulated
# data (the hourly collector itself does not publish anything).
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

git add -- "${PUBLIC_FILES[@]}"

if git diff --cached --quiet -- "${PUBLIC_FILES[@]}"; then
  echo "No changes to Node Insights public data; nothing to publish."
  exit 0
fi

git commit -m "Update Node Insights data ($(date -u +%Y-%m-%dT%H:%M:%SZ))"
git push origin HEAD

echo "Published Node Insights data to GitHub Pages."
