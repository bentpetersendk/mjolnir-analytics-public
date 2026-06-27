# Node Insights: Architecture

Node Insights converts the public Analytics site's Slurm fleet views from a
live-snapshot-only system into a persistent historical monitoring platform.
It collects cluster statistics every hour on the Mjolnir headnode, stores
every raw snapshot indefinitely in a local SQLite database, and publishes
only aggregated, public-safe JSON to GitHub Pages.

This document describes that pipeline and the conventions future Slurm
Insights modules (job analytics, queue analytics, wait-time prediction,
utilization forecasting) should follow to share the same database, export,
and deployment framework - together, the foundation of the future Mjolnir
Analytics platform.

No Airtable is used anywhere in this pipeline. No usernames, job IDs, job
names, or account names are ever read, stored, or exported.

## 1. Overview

```
Slurm CLI (sinfo / scontrol / squeue)
        │  hourly, via systemd timer
        ▼
scripts/collect_node_insights.py
        │  writes raw rows
        ▼
data/node_insights.sqlite            <- authoritative source of truth
        │                               (kept indefinitely, never pushed)
        │  reads + aggregates
        ▼
scripts/export_node_insights.py
        │  writes public JSON (last 90 days only)
        ▼
mjolnir/node_insights.json
mjolnir/capacity_history.json
mjolnir/node_history.json
        │  git add + commit + push (scripts/publish_dashboard.sh)
        ▼
dashboard-data repo (bentpetersendk/dashboard-data)  <- public, separate
        │                                                from this repo
        ▼
js/data-loader.js  →  js/app.js  →  Apache ECharts on the
Infrastructure / Capacity / Nodes pages
```

The generated JSON is published to a separate repo, not this one - see
[docs/DASHBOARD_DATA_MIGRATION.md](docs/DASHBOARD_DATA_MIGRATION.md) for
the full rationale and the credential/clone setup.

The live-snapshot views (Cluster Overview / Node Inventory / Hardware
Inventory / Capacity Planning, loaded via `loadNodeInsightsData()`) read the
`cluster_overview`/`node_inventory`/`hardware_inventory`/`capacity_planning`
sections nested inside the same hourly-published `node_insights.json` this
document describes - there is no separate static snapshot file. The history
pipeline adds trend charts to the same pages without altering how the
current-instant fleet state is collected.

## 2. Database schema (`data/node_insights.sqlite`)

Schema defined in `scripts/node_insights_db.py`, shared by the collector and
exporter so there is exactly one place that creates or migrates tables.

### `snapshots` - one row per collection run

| column | type | meaning |
|---|---|---|
| `timestamp` | TEXT (PK) | UTC ISO-8601, e.g. `2026-06-24T12:00:00Z` |
| `total_nodes` | INTEGER | nodes seen by `scontrol show node` |
| `available_nodes` | INTEGER | `total - draining - down` |
| `draining_nodes` | INTEGER | nodes with `DRAIN` in their state |
| `down_nodes` | INTEGER | nodes with `DOWN`/`NOT_RESPONDING`/`FAIL`, excluding draining |
| `cpu_total` / `cpu_allocated` | INTEGER | fleet-wide logical CPUs |
| `memory_total_gib` / `memory_allocated_gib` | REAL | fleet-wide RAM |
| `gpu_total` / `gpu_allocated` | INTEGER | from `Gres`/`GresUsed` |
| `running_jobs` / `pending_jobs` | INTEGER | aggregate job counts only |

### `pending_reasons` - one row per (timestamp, reason)

| column | type | meaning |
|---|---|---|
| `timestamp` | TEXT | FK → `snapshots.timestamp` |
| `reason` | TEXT | squeue's `%r` pending reason (e.g. `Priority`) |
| `count` | INTEGER | number of pending jobs with that reason |

Aggregated by reason text, never by job ID - this is the mechanism that
keeps the queue-pressure view public-safe.

### `node_snapshots` - one row per (timestamp, node)

| column | type | meaning |
|---|---|---|
| `timestamp` | TEXT | FK → `snapshots.timestamp` |
| `node_name` | TEXT | e.g. `mjolnircomp01fl` |
| `node_state` | TEXT | raw Slurm state string, e.g. `MIXED+DRAIN` |
| `cpu_utilization_percent` | REAL | 0-100, `CPUAlloc / CPUTot * 100` |
| `memory_utilization_percent` | REAL | 0-100, `AllocMem / RealMemory * 100` |
| `gpu_utilization_percent` | REAL | 0-100, `null` if the node has no GPUs |

No job-level or per-user fields exist anywhere in this schema - there is no
table to forget to scrub.

### Extending the schema for future Slurm Insights modules

Add new tables, keyed by the same UTC ISO-8601 `timestamp` convention used
above (e.g. `job_state_snapshots`, `queue_wait_samples`,
`utilization_forecasts`). Do not add columns to `snapshots`,
`pending_reasons`, or `node_snapshots` for unrelated concerns - new modules
get new tables, joined by `timestamp`, so existing exporters and consumers
never need to change. Bump `SCHEMA_VERSION` in `node_insights_db.py` and add
the new `CREATE TABLE IF NOT EXISTS` statement to `SCHEMA_STATEMENTS`.

## 3. Collection: `scripts/collect_node_insights.py`

Runs once per invocation (no internal loop or daemon) and is designed to be
triggered hourly by `mjolnir-node-collector.timer`. Each run:

1. Shells out to `sinfo -h`, `scontrol show node -o`,
   `scontrol show partition -o`, `squeue -h -o %T`, and
   `squeue -h -t PD -o %r`.
2. Parses `scontrol show node -o` into per-node records (state, CPU, memory,
   GPU from `Gres`/`GresUsed`).
3. Aggregates those records into one `snapshots` row, one `pending_reasons`
   row per distinct reason, and one `node_snapshots` row per node.
4. Writes all three with `INSERT OR REPLACE`/`INSERT` in a single
   transaction, keyed by the run's timestamp.

`scontrol show partition` output is parsed and logged but not yet persisted
- it is collected now (per the data-source requirement) and reserved for a
future Queue Analytics module that needs partition-level detail.

Failure handling: any exception while gathering data is logged
(`logger.exception`) and the run exits non-zero without writing a partial
snapshot; the next hourly run simply tries again. This keeps the collector
safe to run unattended and to `Restart=` under systemd without producing
corrupt rows.

Useful flags:

- `--db PATH` - override the SQLite path (default `data/node_insights.sqlite`).
- `--mock-dir DIR` - read command output from text fixtures in `DIR` instead
  of invoking the Slurm CLI, for testing on a host without Slurm access.
- `--dry-run` - collect and log the snapshot without writing to SQLite.
- `-v` - debug logging.

## 4. Export: `scripts/export_node_insights.py`

Reads `data/node_insights.sqlite` and writes three files via `--out-dir`
(default `site/data/` for standalone/local runs; the hourly cycle passes a
`dashboard-data` clone's `mjolnir/` directory instead - see
[docs/DASHBOARD_DATA_MIGRATION.md](docs/DASHBOARD_DATA_MIGRATION.md)):

- **`node_insights.json`** - the latest snapshot, its pending reasons, and
  the latest per-node state list. A compact "what does the fleet look like
  right now" digest derived from the database rather than a fresh Slurm
  call.
- **`capacity_history.json`** - one entry per collected hour (within the
  retention window) with `cpu_pct`/`memory_pct`/`gpu_pct` (0-1 fractions),
  node counts, and running/pending job counts.
- **`node_history.json`** - per-node time series of state and
  utilization fractions over the same window.

`--days` (default 90) controls how much history is exported; it has no
effect on what is retained in SQLite - raw snapshots are kept indefinitely.
Re-running the exporter is always safe: it only reads the database and
overwrites the three JSON files.

Percent-style SQLite columns (`*_utilization_percent`, 0-100) are converted
to 0-1 fractions on export so they match the convention already used by the
existing snapshot exports and the frontend's `pct()` formatter.

## 5. Retention strategy

- **SQLite (`data/node_insights.sqlite`)**: every hourly snapshot is kept
  forever. Nothing in this pipeline deletes rows. Disk usage is small: three
  narrow tables, one row (or one row per node/reason) per hour.
- **Public JSON (`dashboard-data/mjolnir/*.json`)**: only the most recent 90
  days are exported. Older history remains queryable directly against the
  SQLite file on the headnode if ever needed, but never leaves it.

## 6. Frontend: Apache ECharts on existing pages

`js/data-loader.js` exports `loadNodeInsightsHistory()`, which fetches
`capacity_history.json` and `node_history.json` from the `dashboard-data`
repo over `raw.githubusercontent.com` (both optional - a 404 simply yields
`available: false` and the pages fall back to the existing "historical
trend collection has not started yet" messaging). `js/app.js` loads it
alongside the existing `loadNodeInsightsData()` call in `init()`.

Apache ECharts is loaded from a CDN `<script>` tag in `index.html` (before
the `app.js` module script, so `window.echarts` is ready when the app
renders). Chart sections are added to the existing pages without changing
their layout or styling:

- **Infrastructure** (`infrastructureOverviewPage`) - "Cluster pressure
  trend": CPU/memory/GPU pressure plus running/pending jobs and draining
  nodes, one multi-series chart with a dual y-axis (percent + count).
- **Capacity** (`capacityPlanningPage`) - the same chart, replacing the old
  static "no trend history yet" disclaimer now that history exists.
- **Nodes** (`nodeInventoryPage`) - "Node availability trend": available /
  draining / down node counts over time.
- **Node detail** (`nodeDetailPage`) - "Utilization history" for that one
  node (CPU/memory/GPU utilization), sourced from `node_history.json`.

All four share a 24h/7d/30d/90d range toggle (`state.historyRange`) that
filters already-loaded data client-side - switching ranges never triggers a
new fetch. `mountCharts()` runs after every `render()` pass, finds
`[data-chart-kind]` containers, builds an ECharts option from
`nodeInsightsHistory`, and disposes the previous chart instances first (the
app re-renders full page HTML on most interactions, so charts must be
explicitly disposed to avoid leaking ECharts instances/listeners). Chart
colors are read from the page's CSS variables (`--blue`, `--muted`, etc.) at
render time, so charts follow the existing dark/light theme automatically.

If a page has no history yet (fresh deployment, or the JSON simply isn't
present), every chart section falls back to the same disclaimer copy used
before this change - the pages degrade gracefully rather than showing a
broken chart.

## 7. systemd: hourly collection on the headnode

`systemd/mjolnir-node-collector.service` (oneshot) and
`systemd/mjolnir-node-collector.timer` (`OnCalendar=hourly`,
`Persistent=true`). Install:

```bash
sudo cp systemd/mjolnir-node-collector.service systemd/mjolnir-node-collector.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mjolnir-node-collector.timer
```

- `Persistent=true` on the timer means a missed run (headnode reboot,
  maintenance window) fires as soon as the timer is next active, so
  collection resumes automatically without manual intervention.
- `Restart=on-failure` / `RestartSec=60` on the service means a failed run
  (e.g. Slurm controller briefly unreachable) retries a minute later rather
  than waiting for the next hourly tick. `Restart=always` is **not** valid
  for `Type=oneshot` - systemd 239 (this host) refuses to load the unit with
  it ("Service has Restart= set to either always or on-success, which isn't
  allowed for Type=oneshot services").
- `User=jsd606` / `Group=users` run the collector as the repo's owner, not
  root, and there is **no `WorkingDirectory=`** - this repo lives on an NFS
  export (Isilon, `root_squash` enabled), and systemd performs the
  `WorkingDirectory=` chdir while the unit is still root, before dropping to
  `User=`. Root gets `EACCES` on this export even though `jsd606` can `cd`
  into it fine, and the unit fails with
  `Main process exited, code=exited, status=200/CHDIR`. `ExecStart` uses
  absolute paths for both the script and `--db` instead, since by the time
  it runs the process has already dropped to `User=jsd606`.
- Logs go to journald (`SyslogIdentifier=mjolnir-node-collector`); inspect
  with `journalctl -u mjolnir-node-collector.service`.
- `WorkingDirectory` points at this repo's checkout on the headnode; update
  it if the deployment path changes.

## 8. Deployment: `scripts/run_node_insights_cycle.sh` and `scripts/publish_dashboard.sh`

Every hourly tick of `mjolnir-node-collector.timer` runs
`scripts/run_node_insights_cycle.sh`, which is the full workflow in one
place:

```
collect_node_insights.py  (one Slurm snapshot -> SQLite)
        ↓
publish_dashboard.sh:
  sync dashboard-data clone (git fetch + reset --hard origin/main)
        ↓
  export_node_insights.py  (SQLite -> <clone>/mjolnir/*.json)
        ↓
  detect changes           (git diff --cached, in the dashboard-data clone)
        ↓
  ┌─ unchanged → log "No dashboard data changes detected.
  │              Skipping commit and push." → exit 0
  └─ changed   → log "Dashboard data changed. Publishing update."
                 → commit → push origin HEAD (in the dashboard-data clone)
```

This repo (`mjolnir-analytics-public`) is never committed to by
this cycle - see
[docs/DASHBOARD_DATA_MIGRATION.md](docs/DASHBOARD_DATA_MIGRATION.md) for why
generated data moved to a separate repo and how the publishing clone and
its dedicated deploy key are set up.

`set -euo pipefail` in both scripts means a failed collection never reaches
export/publish, and a failed export (missing file, forbidden field, invalid
JSON - see the safety gate below) never gets committed. A failed `git push`
is checked explicitly and returns a non-zero exit code with an error log
line (`public JSON was committed locally but NOT published to GitHub`) -
the commit still happens locally in the dashboard-data clone in that case,
so the next cycle's `git diff` correctly sees no further changes to publish
until something new is collected, rather than retrying the same stale
commit forever.

`publish_dashboard.sh` can also be run standalone (e.g. manually, or from a
separate periodic job) - it always re-syncs the clone and re-exports from
the current database state before checking for changes, so it's safe to run
anytime.

Change detection is staged-diff based (`git diff --cached --quiet --
"${STAGE_PATHS[@]}"`, run inside the dashboard-data clone), so a cycle where
the collected snapshot doesn't move any exported percentage/count (rare,
but possible) produces zero commits - only real data changes ever reach
GitHub.

It never stages `data/node_insights.sqlite`, logs, or any other generated
artifact - the explicit `PUBLIC_FILES` list in the script is the
enforcement mechanism, backed by `.gitignore` (`*.sqlite`, `*.sqlite-wal`,
`*.sqlite-shm`, `*.log`) as a second line of defense. Before staging
anything, the script also re-checks every exported file for the forbidden
field patterns (same list as Section 9) and valid JSON, and refuses to
commit/push if either check fails - this runs unattended every hour with no
human reviewing the diff first, so the gate has to catch problems on its
own.

## 9. Public-safety guardrails

- The schema (Section 2) has no column capable of holding a username, job
  ID, job name, or account name.
- `scripts/validate_data.py` asserts the exported JSON contains none of
  `User`, `JobName`, `WorkDir`, `Account`, `user_token`, `username`, and
  checks the shape of `capacity_history.json`/`node_history.json`.
- `scripts/validate_ui.py` checks that the new loader/render functions
  exist and that forbidden identifiers never appear in `js/app.js` or
  `js/data-loader.js`.

## 10. Future Mjolnir Analytics platform

This pipeline is intentionally generic so a future Slurm Insights module
(job analytics, queue analytics, wait-time prediction, utilization
forecasting, efficiency reporting) can reuse it without rework:

- **Database**: add tables to `data/node_insights.sqlite` via
  `node_insights_db.py`, keyed by the same `timestamp` convention.
- **Collection**: add a new `collect_<module>.py` (or extend the existing
  collector) that writes to those tables on the same hourly cadence, or its
  own systemd timer if a different cadence is needed.
- **Export**: add a new `export_<module>.py` (or extend
  `export_node_insights.py`) that reads the new tables and writes its own
  `<module>_*.json` files into the same dashboard-data `mjolnir/` directory,
  following the same "aggregate-only, 90-day public window, indefinite raw
  retention" rules.
- **Deployment**: extend `scripts/publish_dashboard.sh`'s `PUBLIC_FILES`
  list rather than writing a new publish script - it already points at
  `dashboard-data/mjolnir/`, so a new module's files land there
  automatically.
- **Frontend**: add chart sections to the relevant page using the same
  `[data-chart-kind]` + `mountCharts()` convention in `js/app.js`.

No Airtable, ever - this database is the only source of truth, and SQLite
on the headnode is the only place raw data lives.
