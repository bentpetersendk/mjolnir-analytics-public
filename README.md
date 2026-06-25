# Mjolnir Analytics

Mjolnir Analytics is the public frontend for the Mjolnir Analytics platform:
a decision-support site for understanding resource usage, cost drivers, and
optimization opportunities on the Mjolnir HPC cluster, built from real Slurm
accounting data. Deployed via GitHub Pages at
`https://bentpetersendk.github.io/mjolnir-analytics-public/`.

## Architecture

- `index.html`, `css/styles.css`, `js/{app.js,data-loader.js,recovery-service.js,status.js}`: the single-page app - Overview, Trends, Rankings, Infrastructure/Nodes/Hardware/Capacity (Node Insights), Platform Status, Projects/PIs hierarchy, personal analytics views, and Cost Insights.
- `data/`: checked-in 90-day validation export (`data/efficiency_v3/`) and fallback `sample-data/`.
- `private-user-data/`: mock personal-bundle fixture for local development.
- `docs/`: architecture, deployment, and point-in-time reports.
- `.github/workflows/`: linting, JSON validation, and GitHub Pages deployment.

See [docs/PLATFORM_STATUS.md](docs/PLATFORM_STATUS.md) for the data-freshness
framework and [docs/DASHBOARD_DATA_MIGRATION.md](docs/DASHBOARD_DATA_MIGRATION.md)
for how live collector data reaches this frontend via the separate
`dashboard-data` repository.

## Development Workflow

Development starts from the `develop` branch. Feature work should branch from `develop`, be reviewed, and merge back into `develop` before promotion to `main`.

Recommended flow:

1. Sync `develop`.
2. Create a focused feature branch.
3. Add or update source files only; keep generated JSON exports out of git.
4. Run local validation before opening a pull request.
5. Merge reviewed changes into `develop`.
6. Promote stable releases from `develop` to `main`.

## Validation

Before committing:

```
python3 scripts/validate_data.py
python3 scripts/validate_ui.py
node --check js/app.js
node --check js/data-loader.js
```
