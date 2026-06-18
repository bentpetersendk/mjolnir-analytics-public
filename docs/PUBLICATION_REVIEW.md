# Publication Review

## Audited

- Tracked HTML, CSS, JavaScript, workflow files, docs, and sample data.
- The mirrored 90-day validation export under `data/efficiency_v3/site_data_90d_validation/`.
- Rendered pages and their public-facing copy.

## Removed or Kept

- Removed from git tracking: the mirrored validation export tree.
- Kept: dashboard source code, workflows, documentation, and `sample-data/`.

## Why the repository is safe to make public

- The public tree no longer depends on private Mjolnir operational data.
- The app falls back to anonymized demo data when the real export is absent.
- The visible UI uses anonymized labels and aggregates instead of identity fields.

## Remaining Privacy Assumptions

- Future contributors must continue to treat any real Mjolnir export as restricted.
- Any new data source must be normalized before it reaches page code.

## Must Never Be Committed Later

- Raw Slurm exports.
- Identity fields, job metadata, or filesystem paths.
- Private organization reports or raw bundle archives.
