# Dashboard data migration: generated JSON moved to `dashboard-data`

## Why

The hourly Node Insights collector used to commit its generated JSON
(`node_insights.json`, `capacity_history.json`, `node_history.json`)
straight into this repo's `site/data/` directory, every time the data
changed - often every hour. That meant `mjolnir-efficiency-dashboard-public`
mixed two very different kinds of history: deliberate website source
changes, and unattended hourly data updates. It also meant every other
GitHub Pages-published site Bent runs had to invent its own version of the
same "where does generated JSON live" problem.

`bentpetersendk/dashboard-data` already exists to solve that: one repo,
namespaced by service (`biohpc/`, `webservices/`, `mjolnir/`), that holds
nothing but generated public JSON. BioHPC's stats already publish there.
This migration moves Mjolnir's Node Insights exports into the same place,
under `mjolnir/`.

## What changed

This repo (`mjolnir-efficiency-dashboard-public`) now contains only:
HTML/CSS/JS, documentation, the collector pipeline (`scripts/`,
`systemd/`), and deployment scripts. It no longer contains, or commits,
any generated Node Insights JSON.

`dashboard-data` (separate repo) now contains the generated public JSON
under `mjolnir/`:

```
dashboard-data/
└── mjolnir/
    ├── node_insights.json        <- latest snapshot + pending reasons + node states
    ├── capacity_history.json     <- cluster-level time series
    ├── node_history.json         <- per-node time series
    ├── queue_insights.json       <- future: Queue Insights
    ├── slurm_insights.json       <- future: Slurm Insights
    ├── platform_status.json      <- future: standalone platform status export
    └── predictions.json          <- future: Predictions
```

Fetched by the frontend at:

```
https://raw.githubusercontent.com/bentpetersendk/dashboard-data/main/mjolnir/<file>.json
```

## What did not change

- **Collection** (`scripts/collect_node_insights.py`, hourly via
  `mjolnir-node-collector.timer`) still writes every raw snapshot to
  `data/node_insights.sqlite` on the headnode. Unchanged.
- **SQLite** (`data/node_insights.sqlite`) is still never published
  anywhere - still matched by `.gitignore`'s `*.sqlite` rule, and the new
  `publish_dashboard.sh` still only ever stages the three generated JSON
  files (now inside the `dashboard-data` clone, not this repo).
- **Health monitoring** (`record_collector_run()` / `get_collector_run()`
  in `scripts/node_insights_db.py`, the Platform Status framework in
  `js/status.js`) is unchanged - it judges health from `generated_at`'s
  age and an explicit `collector_status: "failed"` field exactly as
  before. Only the URL the frontend fetches that field from changed.
- **Timezone handling** (`js/status.js`'s `parseUtc()` /
  `formatLocalDateTime()`) is unchanged - storage stays UTC, conversion to
  the viewer's local time still happens once, in the frontend.
- `export_node_insights.py` needed no code change at all - it already
  accepted `--out-dir`; the migration just points that flag at a different
  directory.

## How publishing works now

`scripts/publish_dashboard.sh` maintains a persistent sibling clone of
`dashboard-data` (default path: `../dashboard-data` next to this repo's
checkout; override with `MJOLNIR_DASHBOARD_DATA_DIR`). Each run:

1. Clones the repo if the sibling directory doesn't exist yet.
2. `git fetch` + `git reset --hard origin/main` to sync the clone (it's
   only ever written by this script, so a hard reset to the remote tip is
   always safe).
3. Runs `export_node_insights.py --out-dir <clone>/mjolnir`.
4. Re-checks every exported file for forbidden fields and valid JSON
   (same gate as before - see `NODE_INSIGHTS_ARCHITECTURE.md` Section 9).
5. Stages, and if anything actually changed, commits and pushes - inside
   the `dashboard-data` clone, never inside this repo.

This repo's own git history is untouched by the hourly cycle from now on.

## Credentials

Pushing to `dashboard-data` uses a dedicated SSH deploy key
(`~/.ssh/dashboard_data_deploy_key`, registered as a write-enabled deploy
key on `bentpetersendk/dashboard-data` only), routed through the
`github.com-dashboard-data` host alias in `~/.ssh/config`. This is
deliberately a *different* key from `mjolnir_dashboard_deploy_key` (which
deploys this repo to GitHub Pages and has no access to `dashboard-data`) -
each key is scoped to exactly one repository, so a compromise of one never
grants access to the other.

## Frontend

`js/data-loader.js`'s `NODE_INSIGHTS_HISTORY_BASE` now points at
`https://raw.githubusercontent.com/bentpetersendk/dashboard-data/main/mjolnir/`
instead of the same-origin `./site/data/`. Override with
`window.MJOLNIR_DASHBOARD_DATA_BASE` before `js/app.js` loads for a
private/internal deployment - the same pattern `MJOLNIR_PERSONAL_DATA_BASE`
already uses for personal dashboard data.

## Adding a future module's data

When Queue Insights, Slurm Insights, Predictions, or a standalone Platform
Status export get a real collector:

1. Export to `<dashboard-data clone>/mjolnir/<module>.json` (extend
   `export_node_insights.py` or add a sibling `export_<module>.py`).
2. Add that filename to `publish_dashboard.sh`'s `PUBLIC_FILES` list.
3. Add a `loadXyzData()` to `js/data-loader.js` that fetches it from
   `NODE_INSIGHTS_HISTORY_BASE` (or a new constant following the same
   pattern).
4. Register it in `buildPlatformRegistry()` (`js/status.js`) per
   `docs/PLATFORM_STATUS.md`.

No new repo, deploy key, or publish script is needed - `mjolnir/` and the
existing credential already cover any future Mjolnir Analytics module.
