// Small, pure, dependency-free presentation helpers shared by the dashboard
// (js/app.js) and the reporting layer (js/reporting/). Extracted from app.js
// during Version 1.3 (Reporting & Executive Briefings) so reports can reuse
// the exact same number/HTML formatting and stat-card/table markup the
// dashboard already uses, instead of re-implementing it - moved, not
// rewritten; verified pure (no closures over module-level state) before
// extraction.

export function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function fmt(value, digits = 0) {
  return value === null || value === undefined || Number.isNaN(Number(value))
    ? '-'
    : Number(value).toLocaleString('en-US', { maximumFractionDigits: digits });
}

export function pct(value, digits = 0) {
  return value === null || value === undefined || Number.isNaN(Number(value))
    ? '-'
    : `${(Number(value) * 100).toFixed(digits)}%`;
}

export function money(value, digits = 0) {
  return value === null || value === undefined || Number.isNaN(Number(value))
    ? '-'
    : `${Number(value).toLocaleString('en-US', { maximumFractionDigits: digits })} DKK`;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function bytesLabel(value) {
  if (value === null || value === undefined) return '-';
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = n;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

// Single reusable human-friendly number formatter for the whole app.
// Below 1,000,000 there is no abbreviation - fmt() already renders "523" and
// "6,016" exactly as an HPC dashboard should (no "6 thousand"-style wording).
// At 1,000,000 and above, scales to million/billion/trillion: style:'long'
// -> "55.1 million" (prose); style:'short' -> "55.1M" (compact KPI tiles/axes).
// One decimal place by default; if that would round to a deceptively exact
// "X.0" (hiding that the real value isn't a round number), a second decimal
// is used instead - so 1,018,000 reads "1.02M", not the misleading "1.0M",
// while 55,108,521 still reads the cleaner "55.1M".
const NUMBER_TIERS = [
  { value: 1e12, long: 'trillion', short: 'T' },
  { value: 1e9, long: 'billion', short: 'B' },
  { value: 1e6, long: 'million', short: 'M' },
  { value: 1e3, long: 'thousand', short: 'k' },
];
function tierScaledLabel(scaledAbs) {
  const oneDecimal = scaledAbs.toFixed(1);
  if (!oneDecimal.endsWith('.0')) return oneDecimal;
  return scaledAbs.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}
export function humanNumber(value, { style = 'long' } = {}) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  const n = Number(value);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  // 'short' (axis labels) abbreviates from 1,000 up (10k, 1.5M); 'long'
  // (prose/KPI tiles) keeps the existing convention of no abbreviation
  // below 1,000,000 ("6,016", not "6k").
  const tier = NUMBER_TIERS.find((t) => abs >= t.value && (style === 'short' || t.value >= 1e6));
  if (!tier) return `${sign}${fmt(abs)}`;
  const scaled = tierScaledLabel(abs / tier.value);
  const suffix = style === 'short' ? tier.short : ` ${tier.long}`;
  return `${sign}${scaled}${suffix}`;
}

// Wait-time precision policy: minutes below 1h, "H h M min" at/above 1h -
// never a bare decimal-hour number. Distinct from durationLabel() in
// app.js (a compact "12m"/"3.5h" table-cell format used elsewhere); this is
// the prose format for chart tooltips/axes/KPI cards per the platform's
// numeric-formatting standard.
export function waitTimeLabel(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(Number(seconds))) return '-';
  const totalMinutes = Math.round(Number(seconds) / 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

// Percentile display: integer only ("87"); callers building prose add the
// ordinal suffix themselves (e.g. `${percentileLabel(v)}th percentile`) so
// this stays reusable for the (rarer) non-English-ordinal case too.
export function percentileLabel(value) {
  return value === null || value === undefined || Number.isNaN(Number(value)) ? '-' : `${Math.round(Number(value))}`;
}

// Value-type registry (Phase 5/6 numeric-formatting standard): one entry
// per kind of metric shown on the dashboard, each with exactly one
// formatting rule applied everywhere that metric appears (tooltip, axis,
// KPI card, chart headline). Chart call sites should pass a `valueType`
// string (resolved here) instead of picking a formatter function ad hoc, so
// a metric's precision never drifts between two charts that show it.
//
// Precision policy encoded below:
//   percent      1 decimal            "40.1%"
//   leafScore    integer, 0-100 scale "72"
//   currency     whole DKK >= 1000, 2 decimals below      "42,241 DKK" / "842.50 DKK"
//   cpuHours     1 decimal            "123.5 CPU hours"
//   gpuHours     1 decimal            "2,569.3 GPU hours"
//   count        integer              "3,196"
//   storage        auto-unit, 1 decimal above KB            "542 GB" / "2.3 TB"
//   waitTime       "N min" / "H h M min"
//   percentile     integer (prose adds ordinal)
//   axisCount      k/M/B abbreviated, for axes only          "10k" / "1.5M"
//   percentScaled  1 decimal, input already 0-100 scaled     "62.3%" (see below)
export const VALUE_TYPES = {
  percent: (v) => pct(v, 1),
  // Distinct from `percent` above: some series (chart.js's chartPct()
  // pre-rounds efficiency/pressure/utilization fractions to a 0-100 number
  // before they ever reach a formatter, e.g. Node Insights gauges and
  // pressure-history charts) already carry a 0-100 value, not a 0-1
  // fraction - applying `percent`/pct() to them would multiply by 100
  // twice. This is the single shared formatter for that "already scaled"
  // case, replacing four separate ad-hoc `${v}%` string templates that
  // used to live directly in charts.js's gauge/pressure-chart code.
  percentScaled: (v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? '-' : `${fmt(v, 1)}%`),
  leafScore: (v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? '-' : `${Math.round(Number(v))}`),
  currency: (v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? '-' : money(v, Math.abs(Number(v)) >= 1000 ? 0 : 2)),
  cpuHours: (v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? '-' : `${fmt(v, 1)} CPU hours`),
  gpuHours: (v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? '-' : `${fmt(v, 1)} GPU hours`),
  count: (v) => fmt(v, 0),
  storage: (v) => bytesLabel(v),
  waitTime: (v) => waitTimeLabel(v),
  percentile: (v) => percentileLabel(v),
  axisCount: (v) => humanNumber(v, { style: 'short' }),
};

export function resolveFormatter(valueType) {
  return VALUE_TYPES[valueType] || ((v) => fmt(v, 0));
}

export function statBlock(label, value, trend, tone = '') {
  return `<article class="stat-card ${tone}"><div class="label">${label}</div><div class="value">${value}</div><div class="subtle">${trend}</div></article>`;
}

export function tableFromRows(headers, rows) {
  const body = rows.length
    ? rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${headers.length}">No data available.</td></tr>`;
  return `<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
}
