# Personal Dashboard Report

## Summary

Phase 6 adds a prototype Personal User Dashboard route without changing the public dashboard data path or production exports. The route shape is:

```text
#/u/{personal_route_token}
```

A demo mock bundle is available at:

```text
#/u/mock-token-alex
```

## Implemented

- Added `loadPersonalData(token)` in `js/data-loader.js`.
- Added a normalized `PersonalUserViewModel` for personal dashboard rendering.
- Added personal route loading, loading/error states, and stale request protection in `js/app.js`.
- Added a personal dashboard page showing real username, public pseudonym, CPU efficiency, memory efficiency, estimated cost, potential savings, ranking, percentile position, historical trends, top inefficient jobs, recommendations, and pseudonymous peer comparisons.
- Added the visible banner: `Prototype Personal Dashboard - Authentication Not Yet Enabled`.
- Added mock private JSON under `private-user-data/users/mock-token-alex.json`.

## Privacy Notes

The public loader path still uses `loadMjolnirData()` and public/sample data trees. The personal route is the only code path that calls `loadPersonalData(token)`. Peer comparisons in the mock personal bundle use display pseudonyms only and do not include peer usernames, accounts, paths, or lookup tables.

No production exports were modified. No public deployment artifacts were modified.

## Validation

Run from the repository root:

```text
/opt/shared_software/shared_envmodules/conda/nodejs-25.2.1/bin/node --check js/app.js
/opt/shared_software/shared_envmodules/conda/nodejs-25.2.1/bin/node --check js/data-loader.js
python3 scripts/validate_data.py
python3 scripts/validate_ui.py
```
