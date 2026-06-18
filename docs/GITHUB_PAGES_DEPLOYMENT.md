# GitHub Pages Deployment

## Method

- Static GitHub Pages deployment via GitHub Actions.
- Workflow file: `.github/workflows/pages.yml`

## Branch / Source

- Deploy from `main`.
- `main` is the public-safe branch.

## Final URL

- Expected site URL: `https://bentpetersendk.github.io/mjolnir-efficiency-dashboard/`

## Updating the Site

- Merge public-safe changes into `main`.
- Push to GitHub.
- GitHub Actions will validate and deploy automatically.

## Keeping Real Exports Private

- Never add the mirrored Mjolnir export tree back to the repository.
- Keep `data/efficiency_v3/` ignored.
- Only publish anonymized sample data or aggregated demo JSON.
