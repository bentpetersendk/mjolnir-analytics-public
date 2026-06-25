# Cost-Bearer Waste Model — Public Integration Report

> Note: the Pages URL below used the pre-rename repo name
> (`mjolnir-efficiency-dashboard-public`, since renamed to
> `mjolnir-analytics-public`). This report reflects what was in effect when
> it was written.

**Branch:** `preview/cost-bearer-waste`
**Date:** 2026-06-22
**Purpose:** Bring the approved (APPROVE-FOR-MERGE) revised Cost-Bearer waste model
to the public dashboard: the cost-bearer front-end **and** the cost-bearer exports,
as a single release. **Not merged to main.**

---

## 1. What this branch combines

| Layer | Source | Why |
| --- | --- | --- |
| Front-end (HTML/CSS/JS) | hierarchy front-end + cost-bearer UI additions | Adds Cost Bearer / bearer-efficiency / bearer-waste stat blocks, cost-bearer columns on the inefficient-jobs and personal tables, the measurement-coverage section, and the GPU / lower-bound / aggregate-reconciliation disclosures. Existing charts untouched. |
| Data (`data/efficiency_v3/site_data_90d_validation/**`) | cost-bearer exports (deduplicated, one canonical record per Slurm JobID, revised Cost-Bearer waste) | Replaces the previous CPU-only deduplicated exports. |

The previous public preview (`preview-hierarchy-deduplicated`) carried the
duplicate-count fix on the hierarchy front-end but still used the **CPU-only**
waste model (418,782.52 DKK). This branch overlays the revised Cost-Bearer model
exports and the matching front-end so cost bearer, bearer efficiency, bearer waste,
and the required disclosures all render.

---

## 2. The model (summary)

For each deduplicated job: `cpu_cost`, `mem_cost`, `gpu_cost` are computed; the
**cost bearer** is whichever of CPU vs memory drove the larger cost, and waste is
charged only against that bearer's own cost at its (capped `[0,1]`) efficiency:

```
bearer = memory if mem_cost > cpu_cost else cpu
waste  = bearer_cost * (1 - capped_bearer_efficiency)
gpu_waste = null            # GPU utilization is not measured; never estimated
```

`underutilized_cost_dkk` is retained as an alias of the cost-bearer waste so every
existing chart/field keeps working. GPU waste is intentionally `null`. Waste is a
lower-bound estimate (unmeasured jobs contribute zero).

---

## 3. Validation results

### Required metrics

| Check | Expected | Actual | Pass |
| --- | --- | --- | :--: |
| Estimated cost | 680,736.04 DKK | **680,736.04** | ✓ |
| Cluster waste (cost-bearer) | 351,675.50 DKK | **351,675.50** | ✓ |
| Distinct jobs | 934,369 | **934,369** | ✓ |
| User count | 133 | **133** | ✓ |
| Project count | 35 | **35** | ✓ |
| PI count | 35 | **35** | ✓ |
| Group count | 35 | **35** | ✓ |
| Section count | 35 | **35** | ✓ |

### Aggregate reconciliation (enforced by `scripts/validate_data.py`)

- cluster/export waste **351,675.50** == SUM(per-user all-time waste) **351,675.52** (rounding).
- SUM(project waste) **314,639.23** + unassigned **37,036.27** == cluster **351,675.50**
  (projects cover 918,168 / 934,369 = **98.27%** of jobs; home-directory / other-path
  jobs belong to no project — projects never exceed the cluster total).

### Tooling

- `node --check js/app.js`, `node --check js/data-loader.js`: pass.
- `python3 scripts/validate_data.py`: aggregate reconciliation OK; cost-bearer invariants OK.
- `python3 scripts/validate_ui.py`: ui checks passed.
- Privacy scan: no real project keys, usernames, WorkDir, or filesystem paths in any
  exported JSON; per-user bundles named only by HMAC-SHA256 token (133, unchanged from
  the previous export set).

---

## 4. Deployment

- Deploy via the public repo's "Deploy Pages" workflow (workflow_dispatch on this
  branch) to `https://bentpetersendk.github.io/mjolnir-efficiency-dashboard-public/`.
- **Branch-policy note:** the `github-pages` environment restricts which branches may
  deploy. This branch is named `preview/cost-bearer-waste` specifically so it matches
  the existing `preview/*` allowed-branches rule — no repo-settings change is required.
  (If the policy ever lacks a `preview/*` rule, add `preview/cost-bearer-waste` to the
  environment's allowed branches.)
- Deploying overrides the single live Pages URL until `main` is redeployed.
