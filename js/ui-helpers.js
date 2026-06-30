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

export function statBlock(label, value, trend, tone = '') {
  return `<article class="stat-card ${tone}"><div class="label">${label}</div><div class="value">${value}</div><div class="subtle">${trend}</div></article>`;
}

export function tableFromRows(headers, rows) {
  const body = rows.length
    ? rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${headers.length}">No data available.</td></tr>`;
  return `<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
}
