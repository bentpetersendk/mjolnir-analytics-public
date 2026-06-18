# Mjolnir Efficiency Dashboard

Mjolnir Efficiency Dashboard is a private project for organizing, validating, and presenting Mjolnir efficiency metrics. This repository currently contains only the project skeleton, shared asset locations, data staging areas, documentation, and CI placeholders. Dashboard pages will be added in later phases.

## Architecture

- `assets/`: Static media and shared visual assets.
- `css/`: Stylesheets for future dashboard views.
- `js/`: Client-side JavaScript for future dashboard behavior.
- `data/`: Checked-in source data fixtures and schemas, excluding generated exports.
- `dashboard/`: Future dashboard pages and view-specific assets.
- `docs/`: Project documentation, notes, and operational guidance.
- `.github/workflows/`: GitHub Actions workflows for linting, JSON validation, and build checks.

The initial architecture keeps source assets, data, presentation code, and documentation separate so future dashboard work can evolve without mixing generated outputs with maintained source files.

## Development Workflow

Development starts from the `develop` branch. Feature work should branch from `develop`, be reviewed, and merge back into `develop` before promotion to `main`.

Recommended flow:

1. Sync `develop`.
2. Create a focused feature branch.
3. Add or update source files only; keep generated JSON exports out of git.
4. Run local validation before opening a pull request.
5. Merge reviewed changes into `develop`.
6. Promote stable releases from `develop` to `main`.

## Current Status

Phase 4A.1 establishes the repository skeleton only. Dashboard pages, application logic, and production data pipelines are intentionally out of scope for this phase.
