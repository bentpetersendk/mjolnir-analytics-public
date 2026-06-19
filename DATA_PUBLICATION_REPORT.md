# Data Publication Report

## Summary

The public dashboard repository contains the complete approved 90-day Mjolnir validation export, including all exported user bundles. Source and public repo file inventories matched before publication checks. One non-metric metadata note in `global/cluster_summary.json` was sanitized in the public repo because it contained forbidden privacy-scan marker words while explaining that those fields were excluded.

No dashboard UI, routes, charts, or loader logic were changed in this phase.

## Source Export

- Source export path: `/projects/mjolnir_admin/people/jsd606/mjolnir-efficiency-dashboard/data/efficiency_v3/site_data_90d_validation/`
- Source JSON file count: 136
- Source user bundle count: 133
- Source global JSON file count: 2
- Source total JSON size: 2,588,991 bytes
- Source `index.json` user count: 133
- Source `global/cluster_summary.json`: present
- Source `global/percentiles.json`: present

## Public Export

- Public export path: `data/efficiency_v3/site_data_90d_validation/`
- Public JSON file count: 136
- Public user bundle count: 133
- Public global JSON file count: 2
- Public total JSON size: 2,588,987 bytes
- Public `index.json` user count: 133
- Public `global/cluster_summary.json`: present
- Public `global/percentiles.json`: present

## Comparison Result

- Missing public JSON files before scan: 0
- Extra public JSON files before scan: 0
- Missing user bundles before scan: 0
- Source/public tree content hash before metadata note sanitization: `dabda34da3685f5aa5176e137f2848e86c104e6a776dd8f0726a8556bad4a552`

## Privacy Scan Result

Strict forbidden-pattern scan after metadata note sanitization:

| Pattern | Matches |
|---|---:|
| `/maps/projects` | 0 |
| `/projects/` | 0 |
| `WorkDir` | 0 |
| `NodeList` | 0 |
| `nodelist` | 0 |
| `JobName` | 0 |
| `job_name` | 0 |
| `account` | 0 |
| `username` | 0 |

Result: PASS.

## Publication Details

- GitHub repository: `https://github.com/bentpetersendk/mjolnir-efficiency-dashboard-public`
- GitHub Pages URL: `https://bentpetersendk.github.io/mjolnir-efficiency-dashboard-public/`
- Deployed branch: `main`
- Deployed commit hash: recorded in the final delivery message for the commit containing this report.

## Notes

The public export path is not excluded by `.gitignore`. The approved export files are tracked in the public repository.
