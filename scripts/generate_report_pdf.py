#!/usr/bin/env python3
"""Generate a report PDF headlessly via Chrome's native --print-to-pdf.

Version 1.3 (Reporting & Executive Briefings), Phase 9 foundation. The
PRINT ARTIFACT is identical whether triggered interactively (a user
clicking "Download PDF" - js/reporting/print.js's window.print()) or
headlessly here: both go through the exact same report route + the exact
same css/reporting-print.css. This script is the concrete starting point
for future scheduled generation (weekly/monthly emails, scheduled PDFs per
the v1.3 spec's Phase 9) - manual invocation only for Version 1.3 itself,
not wired to any scheduler yet.

Honest limitation: this environment has a raw Chrome binary but no
CDP-scriptable driver (no Node 18+/Puppeteer, no Python Playwright), so
this script cannot poll the page's `document.body.dataset.chartsReady`
flag (set by js/charts.js's mountCharts() once every chart has fired its
'finished' event - see that file's comment) the way a real Puppeteer/
Playwright-driven Phase 9 implementation eventually should. Instead it
waits via Chrome's own --virtual-time-budget, generous by default. If/when
a CDP-scriptable driver is introduced for Phase 9, replace the
--virtual-time-budget wait with an explicit wait on chartsReady - the
chartsReady attribute already exists for exactly that upgrade.

Usage:
  python3 scripts/generate_report_pdf.py \\
      --route reports-executive --base-url http://localhost:8080 \\
      --out /tmp/executive-report.pdf
"""
import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path

DEFAULT_CHROME_CANDIDATES = (
    "/home/jsd606/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome",
    "google-chrome",
    "chromium",
    "chromium-browser",
)

REPORT_ROUTES = {
    "executive": "reports-executive",
    "weekly": "reports-weekly",
    "queue": "reports-queue",
    "capacity": "reports-capacity",
    # PI and User reports are parameterized (#/reports/pi/<id>,
    # #/u/<token>/report) - pass the full route via --route for those,
    # e.g. --route "reports/pi/pi_004ac09860645b5a".
}


def find_chrome(explicit):
    if explicit:
        return explicit
    for candidate in DEFAULT_CHROME_CANDIDATES:
        if Path(candidate).exists():
            return candidate
        found = shutil.which(candidate)
        if found:
            return found
    raise SystemExit("error: no Chrome/Chromium binary found - pass --chrome-bin explicitly")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--route", required=True, help="Report route, e.g. 'executive', 'weekly', 'queue', 'capacity', or a full path like 'reports/pi/<id>' or 'u/<token>/report'")
    parser.add_argument("--base-url", required=True, help="Base URL the dashboard is served from, e.g. http://localhost:8080")
    parser.add_argument("--out", required=True, help="Output PDF path")
    parser.add_argument("--chrome-bin", default=None, help="Path to Chrome/Chromium binary (auto-detected if omitted)")
    parser.add_argument("--virtual-time-budget-ms", type=int, default=20000, help="Wait time for charts/data to settle before printing (default 20000ms)")
    args = parser.parse_args()

    chrome = find_chrome(args.chrome_bin)
    route = REPORT_ROUTES.get(args.route, args.route)
    url = f"{args.base_url.rstrip('/')}/index.html#/{route}"
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        chrome,
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--disable-setuid-sandbox",
        "--no-first-run",
        f"--virtual-time-budget={args.virtual_time_budget_ms}",
        "--run-all-compositor-stages-before-draw",
        f"--print-to-pdf={out_path}",
        "--no-pdf-header-footer",
        url,
    ]
    print(f"Generating PDF for route '{route}' -> {out_path}")
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
    if result.returncode != 0:
        sys.stderr.write(result.stderr.decode("utf-8", errors="replace"))
        raise SystemExit(f"error: Chrome exited with code {result.returncode}")

    if not out_path.exists() or out_path.stat().st_size == 0:
        raise SystemExit(f"error: {out_path} was not generated or is empty")
    pdf_bytes = out_path.read_bytes()
    if pdf_bytes[:5] != b"%PDF-":
        raise SystemExit(f"error: {out_path} does not start with a valid PDF header")
    # A real multi-section report is always more than one printed page;
    # a single page (a Chrome network-error interstitial, a 404, an empty
    # app shell) means --base-url likely wasn't reachable or correct -
    # catch that here rather than silently "succeeding" with a near-empty
    # PDF (this exact failure mode was hit during development: a stopped
    # local server produced a "valid" 1-page, ~30KB PDF that looked
    # superficially fine by header/size-nonzero checks alone).
    page_count = len(re.findall(rb"/Type\s*/Page[^s]", pdf_bytes))
    if page_count < 2:
        raise SystemExit(
            f"error: {out_path} has only {page_count} page(s) - this usually means "
            f"--base-url ({args.base_url}) was unreachable or the route was wrong, "
            f"not a real rendered report. Verify the dashboard is being served there first."
        )

    print(f"OK: {out_path} ({out_path.stat().st_size:,} bytes, {page_count} pages)")


if __name__ == "__main__":
    main()
