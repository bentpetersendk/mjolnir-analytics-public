// Version 1.3 (Reporting & Executive Briefings): thin renderers over the
// shared ReportModel/section-descriptor vocabulary (see model.js). Two
// render targets live here - sectionsToHtml() and sectionsToMarkdown() -
// both reading the exact same `sections` array, so neither can drift from
// the other on "what sections exist." The third and fourth render targets
// (print-friendly HTML and PDF) are NOT separate code: print is the same
// HTML view of the report route plus css/reporting-print.css, and PDF is
// that same print view captured via window.print()/--print-to-pdf - see
// print.js.
import { registerChart } from '../charts.js';
import { escapeHtml, fmt, statBlock, tableFromRows } from '../ui-helpers.js';

function sectionHeading(section) {
  return `<div class="section-head"><h2>${escapeHtml(section.title)}</h2>${section.subtitle ? `<span class="subtle">${escapeHtml(section.subtitle)}</span>` : ''}</div>`;
}

const SEVERITY_TONE = { high: 'warn', medium: 'info', low: '', info: '' };

function recommendationCardHtml(rec) {
  const tone = SEVERITY_TONE[rec.severity] ?? '';
  return `<article class="rec-card ${tone}">
    <div class="rec-card-head"><span class="pill ${tone}">${escapeHtml(rec.severity || 'info')}</span><strong>${escapeHtml(rec.title || rec.text || 'Recommendation')}</strong></div>
    <p class="subtle">${escapeHtml(rec.suggestion || rec.text || '')}</p>
  </article>`;
}

function sectionToHtml(section) {
  switch (section.type) {
    case 'stat-grid':
      return `<section class="section">${sectionHeading(section)}<div class="cards-grid">${section.stats
        .map((s) => statBlock(escapeHtml(s.label), s.value, s.trend || '', s.tone || ''))
        .join('')}</div></section>`;
    case 'table':
      return `<section class="section">${sectionHeading(section)}<div class="table-card">${tableFromRows(
        section.headers.map(escapeHtml),
        section.rows
      )}</div></section>`;
    case 'chart': {
      const { html } = registerChart(section.option, { label: section.title, height: section.height, csv: section.csv });
      return `<section class="section">${sectionHeading(section)}${html}</section>`;
    }
    case 'text':
      return `<section class="section">${sectionHeading(section)}<p class="subtle" style="line-height:1.8">${escapeHtml(section.body)}</p></section>`;
    case 'recommendation-list':
      return `<section class="section">${sectionHeading(section)}<div class="rec-list">${
        section.recommendations.length
          ? section.recommendations.map(recommendationCardHtml).join('')
          : '<div class="empty-state">No recommendations for this period.</div>'
      }</div></section>`;
    case 'omitted':
      return `<section class="section"><div class="section-head"><h2>${escapeHtml(section.title)}</h2><span class="pill warn">Not yet available</span></div><div class="empty-state">${escapeHtml(section.reason)}</div></section>`;
    case 'html':
      // Already-built HTML from a reused chart/page helper (createLineChart()
      // etc.) - see model.js's htmlSection(). Not escaped, by design: this
      // is markup the helper already produced, not user-supplied text.
      return `<section class="section">${sectionHeading(section)}${section.html}</section>`;
    default:
      return '';
  }
}

export function sectionsToHtml(sections) {
  return sections.map(sectionToHtml).join('');
}

function markdownTable(headers, rows) {
  if (!rows.length) return '_No data available._\n';
  const headerLine = `| ${headers.join(' | ')} |`;
  const sepLine = `| ${headers.map(() => '---').join(' | ')} |`;
  const bodyLines = rows.map((row) => `| ${row.map((cell) => String(cell).replace(/\|/g, '\\|')).join(' | ')} |`);
  return [headerLine, sepLine, ...bodyLines].join('\n') + '\n';
}

function stripHtml(value) {
  return String(value ?? '').replace(/<[^>]+>/g, '').trim();
}

function sectionToMarkdown(section) {
  const heading = `## ${section.title}${section.subtitle ? ` — ${section.subtitle}` : ''}\n`;
  switch (section.type) {
    case 'stat-grid':
      return heading + section.stats.map((s) => `- **${s.label}**: ${stripHtml(s.value)}${s.trend ? ` _(${s.trend})_` : ''}`).join('\n') + '\n';
    case 'table':
      return heading + markdownTable(section.headers, section.rows.map((row) => row.map(stripHtml)));
    case 'chart':
      return heading + `_Chart: ${section.title} (see HTML/PDF report for the rendered chart)._\n`;
    case 'text':
      return heading + `${section.body}\n`;
    case 'recommendation-list':
      return heading + (section.recommendations.length
        ? section.recommendations.map((rec) => `- **[${rec.severity || 'info'}] ${rec.title || rec.text}** — ${rec.suggestion || ''}`).join('\n') + '\n'
        : '_No recommendations for this period._\n');
    case 'omitted':
      return heading + `_Not yet available: ${section.reason}_\n`;
    case 'html':
      return heading + `_Chart: ${section.title} (see HTML/PDF report for the rendered chart)._\n`;
    default:
      return '';
  }
}

export function sectionsToMarkdown(model) {
  const header = [
    `# ${model.title}`,
    model.subtitle ? `_${model.subtitle}_` : '',
    `Generated: ${model.generatedAt}`,
    '',
  ].filter(Boolean).join('\n');
  return [header, ...model.sections.map(sectionToMarkdown)].join('\n');
}

// The full report "page" wrapper: header band (title/subtitle/generated-at),
// download buttons (PDF via print.js, Markdown via a Blob download - the
// same downloadText() pattern charts.js already uses for CSV), the
// rendered sections, and a footer band. This is what each report's page
// function in pages.js returns - same shape as any other app.js page
// function, so it goes through the existing render()/mountCharts() pipeline
// unmodified.
export function reportShellHtml(model) {
  return `
    <div class="report-shell" data-report-type="${escapeHtml(model.reportType)}">
      <div class="report-header">
        <div>
          <div class="context-label">Mjolnir Analytics Report</div>
          <h1>${escapeHtml(model.title)}</h1>
          ${model.subtitle ? `<p class="subtle">${escapeHtml(model.subtitle)}</p>` : ''}
        </div>
        <div class="report-actions">
          <button type="button" class="btn" data-action="report-download-pdf">Download PDF</button>
          <button type="button" class="btn" data-action="report-download-markdown">Download Markdown</button>
        </div>
      </div>
      <div class="stack">${sectionsToHtml(model.sections)}</div>
      <div class="report-footer">
        <span>Generated ${escapeHtml(model.generatedAt)}</span>
        <span>Mjolnir Analytics — data reused from existing warehouse exports, no recalculation</span>
      </div>
    </div>`;
}
