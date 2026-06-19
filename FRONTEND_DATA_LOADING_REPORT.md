# Frontend Data Loading Report

## Runtime Source

The dashboard runtime selected `real-export`.

The Methodology diagnostics panel reports:

| Diagnostic | Value |
| --- | --- |
| Selected runtime source | `real-export` |
| Index users count | `133` |
| Loaded user bundle count | `133` |
| Failed user bundle count | `0` |
| First 5 pseudonymous labels/tokens | `User-0001`, `User-0002`, `User-0003`, `User-0004`, `User-0005` |
| Cluster daily trend length | `90` |
| Percentiles keys | `avg_cpu_efficiency`, `avg_memory_efficiency`, `cpu_hours_allocated`, `estimated_cost_dkk`, `gpu_hours`, `underutilized_cost_dkk` |

No usernames, accounts, job names, node lists, working directories, filesystem paths, or raw private identifiers are shown in the diagnostics panel.

## Loader Changes

`js/data-loader.js` now loads every user bundle listed in the approved export index. It uses settled fetch results so one failed bundle cannot blank the whole dashboard, then reports both loaded and failed bundle counts.

The loader now exposes these UI-layer properties:

- `diagnostics`
- `userBundles`
- `userLookup`
- `rankings.cpu`
- `rankings.memory`
- `rankings.savings`

## UI Changes

The Users page now consumes the real `userBundles` array and displays:

- Total user bundle count
- Top 25 users by CPU efficiency
- Top 25 users by memory efficiency
- Top 25 users by potential savings
- Links to individual pseudonymous user pages

The app now supports individual pseudonymous user routes:

- `#/user/<public_user_id-or-user_token>`

Each individual user page shows:

- Pseudonymous label or public token preview
- All-time summary
- Rolling 7d, 30d, and 90d summaries
- Daily trends
- Top inefficient jobs without job names or raw identifiers
- Recommendations

## Routes Tested

Playwright tested the static dashboard with the approved export loaded:

- `/`
- `#/methodology`
- `#/users`
- `#/user/919aeee1510248c61517b4e5cd4df410c1f0e86f3d25fbad739e47c060715600`

The browser runtime observed `133` user bundle JSON resources loaded.

## Screenshots

- Users page: `docs/screenshots/frontend-data-users.png`
- Individual user page: `docs/screenshots/frontend-data-user-detail.png`

## Validation

Validation commands completed successfully:

- `node --check js/data-loader.js`
- `node --check js/app.js`
- `python3 scripts/validate_data.py`
- `python3 scripts/validate_ui.py`
- Playwright static runtime test

A privacy-pattern scan of runtime source files found no matches for restricted fields or filesystem path patterns.
