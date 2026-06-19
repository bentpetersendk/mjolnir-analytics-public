# Mobile UX Audit and Redesign Report

Date: 2026-06-19
Branch: `feature/personal-user-dashboards`
App audited: Mjolnir Efficiency Dashboard public frontend

## Scope

Audited routes:

- Landing: `#/landing`
- Cluster: `#/cluster`
- Cluster Health: `#/cluster-health`
- Users: `#/users`
- User Detail / Rankings: `#/rankings`
- Personal Dashboard: `#/u/mock-token-alex`
- Benchmarks: `#/benchmarks`
- Cost: `#/cost`
- Recommendations: `#/recommendations`
- Inefficient Jobs: `#/inefficient-jobs`
- Projects: `#/projects`
- Methodology: `#/methodology`

Tested viewport widths:

- iPhone 13 Pro: 390 x 844
- iPhone 16 Pro: 402 x 874
- Pixel: 412 x 915
- iPad portrait: 768 x 1024

## Screenshot Evidence

### Landing

Before:

![Before landing iPhone 13 Pro](./screenshots/before-iphone13pro-landing.png)

After:

![After landing iPhone 13 Pro](./screenshots/after-iphone13pro-landing.png)

### Personal Dashboard

Before:

![Before personal dashboard iPhone 13 Pro](./screenshots/before-iphone13pro-personal.png)

After:

![After personal dashboard iPhone 13 Pro](./screenshots/after-iphone13pro-personal.png)

### Inefficient Jobs

Before:

![Before inefficient jobs iPhone 13 Pro](./screenshots/before-iphone13pro-inefficient-jobs.png)

After:

![After inefficient jobs iPhone 13 Pro](./screenshots/after-iphone13pro-inefficient-jobs.png)

### Methodology on iPad Portrait

Before:

![Before methodology iPad portrait](./screenshots/before-ipad-methodology.png)

After:

![After methodology iPad portrait](./screenshots/after-ipad-methodology.png)

## Issues Identified

| Route | Before issues |
| --- | --- |
| Landing | Horizontal scrolling at phone widths; dense hero panel; table remained a desktop table inside the first-page flow. |
| Cluster | Four charts stacked with tiny SVG labels; many nav links below 44 px tap target due desktop sidebar/local nav behavior. |
| Cluster Health | KPI cards collapsed acceptably, but navigation was still desktop-derived and touch targets were small. |
| Users | Desktop table used for peer comparison; row scanning required zooming on phones. |
| User Detail / Rankings | Four desktop ranking tables created horizontal overflow at phone widths. |
| Personal Dashboard | First screen did not directly answer all four personal questions; peer and job tables were dense; chart labels were small. |
| Benchmarks | Percentile visualizations needed intentional swipe behavior and containment. |
| Cost | Cost chart labels were small and the page inherited desktop navigation. |
| Recommendations | Desktop table caused horizontal overflow at phone widths. |
| Inefficient Jobs | Large desktop table was usable only by horizontal table scrolling. |
| Projects | Empty/future project table still rendered as a desktop table. |
| Methodology | Import row table and lineage content caused phone-width overflow. |

## Changes Made

- Added sticky mobile top navigation and a horizontally scrollable route-chip nav for phone and tablet widths.
- Hid the local desktop side navigation below 1200 px so mobile users get one navigation model.
- Converted every shared table render into a dual presentation:
  - desktop keeps the accessible table;
  - mobile gets expandable detail cards using native `<details>` rows.
- Added `data-label` metadata to table cells for responsive labeling.
- Added overflow containment for intentional horizontal scroll regions so charts, route chips, percentiles, and lineage do not widen the page.
- Added swipeable chart containers with a visible “Swipe chart” cue where SVG charts need more horizontal room.
- Reworked mobile spacing, typography, card padding, and touch target sizes.
- Added a Personal Dashboard first-screen pulse row answering:
  - How am I doing?
  - What should I fix next?
  - How much can I save?
  - Am I improving?
- Kept privacy rules and export schemas unchanged.

## Validation Results

Automated Playwright audit after redesign found no page-level horizontal overflow on any audited route at iPhone 13 Pro, iPhone 16 Pro, Pixel, or iPad portrait widths.

Before examples:

| Route | iPhone 13 Pro before overflow |
| --- | --- |
| Landing | 546 px scroll width on 390 px viewport |
| Rankings | 521 px scroll width on 390 px viewport |
| Personal Dashboard | 528 px scroll width on 390 px viewport |
| Recommendations | 514 px scroll width on 390 px viewport |
| Methodology | 434 px scroll width on 390 px viewport |

After examples:

| Route | iPhone 13 Pro after overflow |
| --- | --- |
| Landing | 390 px scroll width on 390 px viewport |
| Rankings | 390 px scroll width on 390 px viewport |
| Personal Dashboard | 390 px scroll width on 390 px viewport |
| Recommendations | 390 px scroll width on 390 px viewport |
| Methodology | 390 px scroll width on 390 px viewport |

Touch target audit improved from 13-14 small targets on many routes to 1 detected small target. The remaining detected target is an SVG/internal element measurement artifact, not a visible button or link.

## Commands Run

```bash
/opt/shared_software/shared_envmodules/conda/nodejs-25.2.1/bin/node --check js/app.js
/opt/shared_software/shared_envmodules/conda/nodejs-25.2.1/bin/node --check js/data-loader.js
python3 scripts/validate_ui.py
python3 scripts/validate_data.py
/opt/shared_software/shared_envmodules/conda/nodejs-25.2.1/bin/node /tmp/mjolnir_mobile_audit.js before
/opt/shared_software/shared_envmodules/conda/nodejs-25.2.1/bin/node /tmp/mjolnir_mobile_audit.js after2
```

## Remaining Limitations

- SVG chart internals still contain small axis/date text. The redesign makes charts swipeable instead of shrinking them further, but a future chart component could add mobile-specific labeling.
- The mobile route nav is intentionally horizontally scrollable; it is contained and does not create page-level overflow.
- The Personal Dashboard still uses prototype/mock private data for `#/u/mock-token-alex`; authentication was not changed in this task.
- Browser visual inspection through the image viewer was blocked by local sandbox namespace exhaustion, but Playwright screenshot capture and layout metrics completed successfully.
