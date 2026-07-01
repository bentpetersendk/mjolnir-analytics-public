// Phase 7: shared time-range selector, extracted from the two parallel
// implementations that used to live only in app.js (HISTORY_RANGES/
// rangeButtons/filterPointsByRange for Node/Queue/Infrastructure pages, and
// USER_PROFILE_RANGES/profileRangeButtons/filterTrendsByPeriod for the user
// profile). Both are now thin wrappers around the functions below so their
// existing behaviour, state keys, and data-action attributes are unchanged.
//
// A range entry is `{ id, label, ms }` (rolling window in milliseconds,
// compared against a timestamp field) or `{ id, label, days }` (calendar
// days, compared against a YYYY-MM-DD date-string field). `days: null`/no
// `ms`/`days` at all means "no cutoff" (e.g. an "All" option).
//
// This module holds no state itself - callers pass in whichever id is
// currently selected, so it works with any page's own state object.

export function createRangeSelector({ id, ranges, stateKey, action, defaultId }) {
  return { id, ranges, stateKey, action, defaultId: defaultId ?? ranges[0]?.id };
}

export function rangeButtonsHtml(selector, currentId) {
  return `<div class="range-toggle">${selector.ranges.map((r) =>
    `<button type="button" class="range-button${r.id === currentId ? ' active' : ''}" data-action="${selector.action}" data-range="${r.id}">${r.label}</button>`
  ).join('')}</div>`;
}

export function filterByRange(rows, selector, currentId, timestampField) {
  const list = Array.isArray(rows) ? rows : [];
  const range = selector.ranges.find((r) => r.id === currentId) || selector.ranges[0];
  if (!range) return list;

  if (range.ms != null) {
    const cutoff = Date.now() - range.ms;
    return list.filter((row) => row && row[timestampField] && new Date(row[timestampField]).getTime() >= cutoff);
  }
  if (range.days != null) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - range.days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    return list.filter((row) => row && row[timestampField] >= cutoffStr);
  }
  return list; // no cutoff configured (e.g. an "All" range)
}
