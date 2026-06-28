// Operational event annotations overlaid on time-series charts (see
// docs/CHART_FRAMEWORK.md "Event annotations"). Each entry needs a `date`
// (YYYY-MM-DD, matched against a chart's plotted category range), a short
// `label` shown on the chart, and a `type` for future filtering/styling.
// Adding a future event is a one-line addition here - no code change.
export const OPERATIONAL_EVENTS = [
  { date: '2025-09-08', label: 'Slurm upgrade', type: 'upgrade' },
  { date: '2025-11-21', label: 'Storage upgrade', type: 'upgrade' },
  { date: '2026-02-14', label: 'Emergency maintenance', type: 'outage' },
  { date: '2026-04-02', label: 'OS upgrade (compute nodes)', type: 'upgrade' },
];
