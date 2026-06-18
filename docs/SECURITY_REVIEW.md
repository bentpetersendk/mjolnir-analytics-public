# Security Review

## Findings

- The runtime UI does not expose usernames, account names, job names, nodelists, WorkDir values, or raw Slurm identifiers.
- The data loader only consumes the mirrored export tree and the local `sample-data/` fallback.
- The UI uses anonymized display labels such as `User 01` rather than raw anonymized user labels.

## Risks

- The mirrored export directory still contains sensitive operational data in the repository history and current tree.
- The loader must continue to avoid rendering any raw identity fields if new fields are added later.
- Future PI or project views could accidentally surface identifiers if their schemas are not filtered.

## Mitigations

- Keep `js/data-loader.js` as the single data access layer.
- Maintain a normalization step that maps raw records to anonymized display models.
- Add a strict allow-list of visible fields before rendering any future detail tables.
- Keep the rendered UI focused on aggregates, percentiles, and recommendations.

## Remaining Concerns

- The mirrored dataset should be treated as restricted internal data.
- Any future expansion should re-run a privacy review before new fields are shown.
- If additional exports introduce job-level identity fields, they must be dropped during normalization.
