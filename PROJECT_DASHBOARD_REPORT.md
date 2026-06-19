# Project Dashboard Report

Date: 2026-06-19

## Scope

- Added optional loading for `global/projects.json` in `js/data-loader.js`.
- Added a `#/projects` route and navigation item in `js/app.js`.
- The Projects page uses only anonymized project IDs, pseudonymous labels, summaries, and daily trends.

## Dashboard Data

The normalized frontend model now exposes:

- `projectBundles`
- `projectRankings.cost`
- `projectRankings.savings`
- `projectRankings.cpu`
- `datasetMeta.projectCount`

The page renders:

- project count
- estimated cost
- CPU efficiency
- memory efficiency
- GPU hours
- potential savings
- daily project trends
- top 25 project rankings by cost, savings, and CPU efficiency

## Runtime Behavior

`global/projects.json` is optional so existing sample/fallback data still loads. When the file exists in the real validation export, `#/projects` renders the approved public-safe project summaries.

## Privacy

The page never expects or renders real account names. Project labels come from `project_pseudonym`; IDs come from `project_id`. The copied public file was checked for literal account-name leaks before being placed under `data/efficiency_v3/site_data_90d_validation/global/projects.json`.
