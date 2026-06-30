// Version 1.3 (Reporting & Executive Briefings): the shared structured
// intermediate every report is built from. A report's data/*ReportData.js
// module produces a ReportModel - plain data, no HTML - and every render
// target (HTML, print, Markdown) is a thin reader over the SAME
// `sections` array, so "what sections, what order, what's omitted when
// data is missing" is decided exactly once per report, not once per
// render target. See docs/architecture/REPORTING_ARCHITECTURE.md.
//
// ReportModel shape:
//   { reportType, title, subtitle, generatedAt, metadata, sections }
//
// Section descriptor shapes (the only vocabulary render/*.js understands):
//   {type:'stat-grid', title, subtitle, stats:[{label,value,trend,tone}]}
//   {type:'table', title, subtitle, headers:[...], rows:[[...]]}
//   {type:'chart', title, subtitle, option, height, csv}
//   {type:'text', title, body}
//   {type:'recommendation-list', title, subtitle, recommendations:[
//      {type,severity,title,suggestion,confidence,evidence}]}
//   {type:'omitted', title, reason}   - data not yet available upstream;
//      rendered as a visible note in every target, never silently dropped,
//      never approximated by recomputing the missing value client-side.

export function reportModel({ reportType, title, subtitle, generatedAt, metadata = {}, sections = [] }) {
  return { reportType, title, subtitle, generatedAt, metadata, sections };
}

export function statGrid(title, stats, { subtitle = '' } = {}) {
  return { type: 'stat-grid', title, subtitle, stats };
}

export function table(title, headers, rows, { subtitle = '' } = {}) {
  return { type: 'table', title, subtitle, headers, rows };
}

export function chartSection(title, option, { subtitle = '', height = null, csv = false } = {}) {
  return { type: 'chart', title, subtitle, option, height, csv };
}

export function text(title, body) {
  return { type: 'text', title, body };
}

// Escape hatch for embedding a complete, already-built HTML fragment - used
// when a report wants to reuse an existing high-level chart helper
// (createLineChart() etc.) that builds its own option AND calls
// registerChart() AND wraps the result in a card, all at once. Those
// helpers must run at template-build time in the page function (the same
// place every other app.js page already calls them), not in a data
// assembler - see pages.js's executiveReportPage(). The Markdown renderer
// shows a placeholder note instead of attempting to convert arbitrary HTML.
export function htmlSection(title, html, { subtitle = '' } = {}) {
  return { type: 'html', title, subtitle, html };
}

export function recommendationList(title, recommendations, { subtitle = '' } = {}) {
  return { type: 'recommendation-list', title, subtitle, recommendations };
}

// Use this instead of recomputing or approximating a metric the warehouse
// hasn't exported yet (see the "Known data gaps" section of the v1.3 plan -
// PI top_inefficient_jobs, Capacity storage growth, etc). Always visible,
// never a silent omission.
export function omitted(title, reason) {
  return { type: 'omitted', title, reason };
}
