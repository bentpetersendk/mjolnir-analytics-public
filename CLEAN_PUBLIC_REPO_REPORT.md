# Clean Public Repository Report

- Source repository: `mjolnir-efficiency-dashboard`
- Source commit used: `8626bdaa7521d6d18d3699a8acddca68d49ec91e`
- Public repository: pending
- Pages URL: pending
- Deployment status: pending

## Files copied

- `.github/workflows/build-check.yml`
- `.github/workflows/lint.yml`
- `.github/workflows/pages.yml`
- `.github/workflows/validate-json.yml`
- `.gitignore`
- `README.md`
- `assets/.gitkeep`
- `css/.gitkeep`
- `css/styles.css`
- `dashboard/.gitkeep`
- `data/.gitkeep`
- `docs/.gitkeep`
- `docs/ARCHITECTURE.md`
- `docs/DEPLOYMENT.md`
- `docs/FUTURE_PI_DASHBOARD.md`
- `docs/GITHUB_PAGES_DEPLOYMENT.md`
- `docs/PERFORMANCE_REVIEW.md`
- `docs/PUBLICATION_REVIEW.md`
- `docs/SECURITY_REVIEW.md`
- `docs/data-architecture.md`
- `docs/json-mappings.md`
- `docs/validation-results.md`
- `index.html`
- `js/.gitkeep`
- `js/app.js`
- `js/data-loader.js`
- `sample-data/global/cluster_summary.json`
- `sample-data/global/percentiles.json`
- `sample-data/index.json`
- `sample-data/users/sample-user-a.json`
- `sample-data/users/sample-user-b.json`
- `scripts/validate_data.py`
- `scripts/validate_ui.py`

## Files excluded

- `.git/`
- `data/efficiency_v3/`
- raw exports
- private JSON exports
- logs
- backups
- SQLite and database files
- any path containing `/maps/projects`
- any path containing `/projects/mjolnir_admin`

## Privacy scan result

The clean export was scanned for the sensitive path strings `/maps/projects` and `/projects/mjolnir_admin`. No matches were found in the exported file contents.

## Notes

- The clean repository is intended to be public-safe and to rely on the sample-data fallback only.
- Real Mjolnir export data remains outside this repository and must not be reintroduced into the public branch.
