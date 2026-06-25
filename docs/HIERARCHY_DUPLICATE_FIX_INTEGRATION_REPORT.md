# Hierarchy + Duplicate-Count Fix — Integration Report

> Note: the Pages URL below used the pre-rename repo name
> (`mjolnir-efficiency-dashboard-public`, since renamed to
> `mjolnir-analytics-public`). This report reflects what was in effect when
> it was written.

**Branch:** `preview-hierarchy-deduplicated`
**Date:** 2026-06-21
**Purpose:** Combine the hierarchy-aware front-end with the duplicate-count
correction so the full dashboard UI renders **and** the metrics are deduplicated.
**Not merged to main.**

---

## 1. What this branch combines

| Layer | Source | Why |
| --- | --- | --- |
| Front-end (HTML/CSS/JS) | `origin/preview-project-hierarchy` | Hierarchy + personal-dashboard app: routes for Projects/PIs/Groups/Sections/Rankings/Recommendations/Inefficient Jobs + personal (`/u/<token>`) + recovery. (`js/app.js` 816 lines, `js/data-loader.js` 502 lines, `js/recovery-service.js`, newer `css/styles.css`, `private-user-data/` mock.) |
| Data (`data/efficiency_v3/site_data_90d_validation/**`) | duplicate-count fix output (`MJOLNIR_ADMIN` `feature/duplicate-count-fix` `a8bca29`; exports = private `preview/duplicate-count-fix`) | Deduplicated exports — one canonical record per Slurm JobID. |

The previous regression happened because `preview/duplicate-count-fix` was branched
from public `main`, whose front-end predates the hierarchy work; it carried the
corrected data on the old app, so the hierarchy/personal nav was absent. This
branch fixes that by starting from the hierarchy front-end and overlaying the
corrected data.

---

## 2. Background — the duplicate-count fix (preserved here)

Overlapping daily `sacct` extracts re-emit the same job across many daily files;
aggregates summed each job once per day it appeared. The fix (Option B + D)
deduplicates at materialization to one canonical `job_metrics` row per JobID
(terminal state > has End > largest elapsed > latest report_date), attributed to a
`canonical_report_date` (End date, else latest report_date). `jobs` and
`raw_sacct_rows` remain immutable audit history. See
`docs/DUPLICATE_FIX_IMPLEMENTATION_REPORT.md` (private repo) for full detail.

---

## 3. Validation results

### Required metrics (overlaid corrected exports)

| Check | Expected | Actual | Pass |
| --- | --- | --- | :--: |
| Distinct jobs | ≈ 934,369 | **934,369** | ✓ |
| Estimated cost | ≈ 680,736 DKK | **680,736.04** | ✓ |
| Underutilized / waste | ≈ 418,783 DKK | **418,782.52** | ✓ |
| CPU-hours allocated | — | 2,985,342.05 | ✓ |
| User count | 133 | **133** | ✓ |
| Project count | 35 | **35** | ✓ |
| PI count | 35 | **35** | ✓ |
| Group count | 35 | **35** | ✓ |
| Section count | 35 | **35** | ✓ |

### Routes / rendering (verified structurally)

- **Nav routes registered** in `js/app.js`: landing, cluster, rankings,
  benchmarks, recommendations, inefficient-jobs, projects, pis, groups, sections,
  users, cost, methodology, recovery — all present.
- **Hierarchy data wired:** `js/data-loader.js` resolves
  `projects / pi_summaries / research_groups / sections` from `index.json.global`
  (which references all four) and fetches them; `projectsPage()`,
  `pisPage()`, `groupsPage()`, `sectionsPage()`, `hierarchyDetailPage()` bind to
  the loaded `data.projects/pis/groups/sections`.
- **Personal dashboards wired:** `isPersonalRoute(/^u\/[A-Za-z0-9_-]+$/)`,
  `loadPersonalData`, `PERSONAL_DATA_BASE='./private-user-data/'`, and
  `js/recovery-service.js` are present; `private-user-data/users/mock-token-alex.json`
  exists, so the personal prototype route renders.
- **All referenced data present & parses:** index → 6 global keys
  (cluster_summary, percentiles, projects, pi_summaries, research_groups,
  sections); all 133 user files referenced by index exist (0 missing).

> Note: rendering was verified structurally (routes registered + loader wiring +
> data present/parseable + page binders), and via the repo validators below. A
> live headless-browser screenshot pass was not run in this environment; once
> deployed, a quick manual click-through of each nav item is recommended.

### Repo validators

- `python3 scripts/validate_data.py` → **validated 7 json files** (incl. hierarchy
  exports + personal mock).
- `python3 scripts/validate_ui.py` → **ui checks passed**.

---

## 4. Deployment

- Branch: `preview-hierarchy-deduplicated` (dedicated preview; **not** merged to
  main).
- Deploy via the public repo's "Deploy Pages" workflow (workflow_dispatch on this
  branch); publishes to
  `https://bentpetersendk.github.io/mjolnir-efficiency-dashboard-public/`.

---

## 5. Remaining issues / risks

1. **Deployment-branch policy.** The `github-pages` environment allows only
   `main`, `preview-project-hierarchy`, and `preview/*`. The name
   `preview-hierarchy-deduplicated` (no slash) does **not** match `preview/*`, so
   the deploy job will be rejected until a policy is added for it (add
   `preview-hierarchy-deduplicated`, or rename to `preview/hierarchy-deduplicated`).
2. **Single Pages URL.** Deploying overrides the live public dashboard at that URL
   until the public repo's `main` redeploys. Restore by re-running Deploy Pages on
   `main` (or deleting the preview branch + redeploying) when review is done.
3. **HMAC secret differs from prior exports.** The deduplicated exports were
   regenerated with a fresh HMAC secret, so user-token filenames differ from
   earlier sets. Internally consistent (index ↔ files verified); external links to
   old tokens won't resolve. Production should regenerate with the canonical
   secret.
4. **PI/Group/Section hierarchy is placeholder.** Per the audits, PI/Group/Section
   IDs are locally seeded (`needs_airtable_sync`), not yet organizationally
   meaningful. Counts (35 each) reflect a 1:1-per-project seeding, not real org
   structure.
5. **Front-end not merged to main.** The hierarchy front-end still lives only on
   preview branches; merging it to public `main` (separately) would prevent
   future data-only previews from regressing the UI.
6. **Cross-repo publish is gated.** Pushing private-origin data to the public repo
   and deploying are performed by the repo owner (private→public guardrail).
