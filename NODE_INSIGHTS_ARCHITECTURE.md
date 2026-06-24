# Node Insights: Architecture

Node Insights converts the public dashboard's Slurm fleet views from a
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
site/data/node_insights.json
site/data/capacity_history.json
site/data/node_history.json
        │  git add + commit + push (scripts/publish_dashboard.sh)
        ▼
GitHub Pages (this repo)             <- public, no raw data, no SQLite
        │
        ▼
js/data-loader.js  →  js/app.js  →  Apache ECharts on the
Infrastructure / Capacity / Nodes pages
```

The live-snapshot views that already existed (`data/node_insights/*.json`,
loaded via `loadNodeInsightsData()`) are unchanged. The history pipeline
described here is purely additive: it adds trend charts to the same pages
without altering how the current-instant fleet state is collected or
rendered.

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

Reads `data/node_insights.sqlite` and writes three files (default
`site/data/`):

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
- **Public JSON (`site/data/*.json`)**: only the most recent 90 days are
  exported. Older history remains queryable directly against the SQLite
  file on the headnode if ever needed, but never leaves it.

## 6. Frontend: Apache ECharts on existing pages

`js/data-loader.js` exports `loadNodeInsightsHistory()`, which fetches
`site/data/capacity_history.json` and `site/data/node_history.json` (both
optional - a 404 simply yields `available: false` and the pages fall back
to the existing "historical trend collection has not started yet"
messaging). `js/app.js` loads it alongside the existing
`loadNodeInsightsData()` call in `init()`.

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

## 8. Deployment: `scripts/publish_dashboard.sh`

Run manually (or from its own periodic job, separate from the hourly
collector) to publish the latest history to GitHub Pages:

1. Runs `scripts/export_node_insights.py` to regenerate the three
   `site/data/*.json` files from the current SQLite database.
2. `git add`s exactly those three files (never `git add -A`/`.`).
3. Commits only if they changed.
4. Pushes to the current branch's remote.

It never stages `data/node_insights.sqlite`, logs, or any other generated
artifact - the explicit file list in the script is the enforcement
mechanism, backed by `.gitignore` (`*.sqlite`, `*.sqlite-wal`,
`*.sqlite-shm`, `*.log`) as a second line of defense.

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
  `site/data/<module>_*.json` files, following the same "aggregate-only,
  90-day public window, indefinite raw retention" rules.
- **Deployment**: extend `scripts/publish_dashboard.sh`'s `PUBLIC_FILES`
  list rather than writing a new publish script.
- **Frontend**: add chart sections to the relevant page using the same
  `[data-chart-kind]` + `mountCharts()` convention in `js/app.js`.

No Airtable, ever - this database is the only source of truth, and SQLite
on the headnode is the only place raw data lives.
