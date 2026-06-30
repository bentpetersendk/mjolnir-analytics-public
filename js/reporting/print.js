// Version 1.3 (Reporting & Executive Briefings): PDF and Markdown download
// wiring for the report shell's action buttons (see render.js's
// reportShellHtml()). PDF generation is browser-native print-to-PDF
// (css/reporting-print.css's @page/@media print rules + window.print()) -
// no new dependency, and the same print-ready view is reusable headlessly
// via Chrome's --print-to-pdf flag for future scheduled generation (see
// scripts/generate_report_pdf.py) without any redesign.

// Generic Blob-download helper (same minimal pattern charts.js's CSV/SVG
// export buttons already use - not duplicated business logic, just a
// browser API wrapper, kept local here to avoid widening charts.js's
// export surface for a one-line utility).
function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function waitForChartsReady(timeoutMs = 5000) {
  if (document.body.dataset.chartsReady === 'true') return Promise.resolve();
  return new Promise((resolve) => {
    const start = Date.now();
    const poll = () => {
      if (document.body.dataset.chartsReady === 'true' || Date.now() - start > timeoutMs) {
        resolve();
        return;
      }
      requestAnimationFrame(poll);
    };
    poll();
  });
}

export async function downloadReportPdf() {
  await waitForChartsReady();
  document.body.classList.add('report-print-mode');
  window.print();
  // afterprint fires once the print dialog closes (cancel or confirm) in
  // every browser this site targets - safe place to drop the print-mode
  // class back off so the live dashboard view returns to normal.
  const cleanup = () => {
    document.body.classList.remove('report-print-mode');
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
}

export function downloadReportMarkdown(model, markdown) {
  const slug = (model.reportType || 'report').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  downloadText(`mjolnir-${slug}-report.md`, markdown, 'text/markdown');
}
