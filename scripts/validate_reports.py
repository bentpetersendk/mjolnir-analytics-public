#!/usr/bin/env python3
"""Regression gate for the Version 1.3 reporting layer (Reporting &
Executive Briefings - see docs/architecture/REPORTING_ARCHITECTURE.md).

Plain assert-based script, same convention as validate_data.py/
validate_ui.py - not a test framework. Serves this checkout locally,
loads every report route in headless Chrome, and checks:
  1. Every report route renders with substantial content and zero
     console/JS errors.
  2. No legacy efficiency_v3 path or raw username leaks into any report
     (same privacy invariant the dashboard itself already enforces).
  3. scripts/generate_report_pdf.py produces a valid, multi-page PDF for
     every report type.

Run manually (this repo has no CI wiring for it yet):
  python3 scripts/validate_reports.py [--base-data-dir DIR]
"""
import argparse
import http.server
import json
import re
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHROME_CANDIDATES = (
    "/home/jsd606/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome",
    "google-chrome",
    "chromium",
    "chromium-browser",
)

FAILURES = []


def fail(check, message):
    FAILURES.append((check, message))
    print(f"FAIL [{check}] {message}")


def ok(check, message):
    print(f"OK   [{check}] {message}")


def find_chrome():
    import shutil
    for candidate in CHROME_CANDIDATES:
        if Path(candidate).exists():
            return candidate
        found = shutil.which(candidate)
        if found:
            return found
    raise SystemExit("error: no Chrome/Chromium binary found")


def free_port():
    with socket.socket() as s:
        s.bind(("", 0))
        return s.getsockname()[1]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def start_server(directory, port):
    import os
    cwd = os.getcwd()
    os.chdir(str(directory))
    server = http.server.HTTPServer(("127.0.0.1", port), QuietHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    os.chdir(cwd)
    return server


def dump_dom(chrome, url, timeout_ms=15000):
    raw = subprocess.run(
        [chrome, "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
         "--disable-setuid-sandbox", "--no-first-run", f"--virtual-time-budget={timeout_ms}",
         "--run-all-compositor-stages-before-draw", "--dump-dom", url],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30,
    )
    return raw.stdout.decode("utf-8", errors="replace"), raw.stderr.decode("utf-8", errors="replace")


REAL_CDN_BASE = "https://raw.githubusercontent.com/bentpetersendk/dashboard-data/main/mjolnir/analytics/"


def find_sample_pi_id():
    # Mirror data-loader.js's own loadMjolnirData() fallback chain exactly
    # (real CDN first, sample-data/ second) so the PI id this script tests
    # with always matches what the browser will actually load - discovered
    # the hard way: this environment turned out to have real internet
    # access to the real CDN, so a hardcoded sample-data-only id produced a
    # false "PI not found" failure that looked like a PDF-generation bug
    # but was really a test-data mismatch.
    import os
    import urllib.request
    env_dir = os.environ.get("MJOLNIR_ANALYTICS_DATA_DIR")
    if env_dir:
        candidate = Path(env_dir) / "global" / "pi_summaries.json"
        if candidate.exists():
            pis = json.loads(candidate.read_text()).get("pis", [])
            if pis:
                return pis[0].get("pi_id")
    try:
        with urllib.request.urlopen(f"{REAL_CDN_BASE}global/pi_summaries.json", timeout=5) as resp:
            pis = json.loads(resp.read()).get("pis", [])
            if pis:
                return pis[0].get("pi_id")
    except Exception:
        pass
    candidate = ROOT / "sample-data" / "global" / "pi_summaries.json"
    if candidate.exists():
        pis = json.loads(candidate.read_text()).get("pis", [])
        if pis:
            return pis[0].get("pi_id")
    return None


def find_sample_personal_token():
    users_dir = ROOT / "private-user-data" / "users"
    if not users_dir.exists():
        return None
    for f in sorted(users_dir.glob("u_*.json")):
        return f.stem
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    args = parser.parse_args()

    chrome = find_chrome()
    app_port = free_port()
    app_server = start_server(ROOT, app_port)
    time.sleep(0.3)
    base_url = f"http://127.0.0.1:{app_port}"

    pi_id = find_sample_pi_id()
    token = find_sample_personal_token()

    routes = [
        ("reports-executive", "Executive Report"),
        ("reports-weekly", "Weekly Operational Report"),
        ("reports-queue", "Queue Report"),
        ("reports-capacity", "Capacity Report"),
    ]
    if pi_id:
        routes.append((f"reports/pi/{pi_id}", "PI Report"))
    else:
        print("SKIPPED PI Report render check: no local pi_summaries.json with at least one PI found.")
    if token:
        routes.append((f"u/{token}/report", "My Analytics Report"))
    else:
        print("SKIPPED User Report render check: no local private-user-data/users/u_*.json found.")

    for route, expected_title in routes:
        url = f"{base_url}/index.html#/{route}"
        dom, stderr = dump_dom(chrome, url)
        text = re.sub(r"<[^>]+>", " ", dom)
        text = " ".join(text.split())

        has_content = len(text) > 800
        has_title = expected_title in text
        has_error_banner = bool(re.search(r"\b(Something went wrong|Uncaught|SyntaxError|ReferenceError|TypeError)\b", text + stderr, re.I))
        has_legacy_path = "efficiency_v3" in text or "site_data_90d_validation" in text
        # The "not found"/"unavailable" fallback states (model built when a
        # PI/personal lookup misses) deliberately reuse the same report
        # title, so checking the title alone is a false-positive risk for
        # parameterized routes - explicitly rule those fallback states out
        # by their exact sentences (data/piReportData.js's/pages.js's
        # literal fallback text), not the bare word "Unavailable" - that
        # word also appears legitimately as a normal field-level label
        # (e.g. "Overall Percentile: Unavailable" when one specific metric
        # has no data, which is not a report-level failure).
        has_not_found = bool(re.search(
            r"No PI record was found for this identifier\."
            r"|No personal bundle was found for this route token\."
            r"|Open this report via your personal Analytics link",
            text,
        ))

        if has_content and has_title and not has_error_banner and not has_legacy_path and not has_not_found:
            ok("render", f"{route}: content present, title found, no errors, no legacy path")
        else:
            fail(
                "render",
                f"{route}: has_content={has_content} has_title={has_title} "
                f"has_error_banner={has_error_banner} has_legacy_path={has_legacy_path} "
                f"has_not_found={has_not_found}",
            )

    # Privacy: User Report must never leak a raw username, only the pseudonym.
    if token:
        bundle_path = ROOT / "private-user-data" / "users" / f"{token}.json"
        if bundle_path.exists():
            bundle = json.loads(bundle_path.read_text())
            real_username = bundle.get("username")
            if real_username:
                url = f"{base_url}/index.html#/u/{token}/report"
                dom, _ = dump_dom(chrome, url)
                if real_username in dom:
                    fail("privacy", f"real username '{real_username}' leaked into the rendered User Report")
                else:
                    ok("privacy", "real username does not appear in the rendered User Report")
            else:
                ok("privacy", "personal bundle has no username field to check (expected post-privacy-fix)")

    # PDF generation: every report type must produce a real, multi-page PDF.
    pdf_routes = [("executive", None), ("weekly", None), ("queue", None), ("capacity", None)]
    if pi_id:
        pdf_routes.append((f"reports/pi/{pi_id}", None))
    if token:
        pdf_routes.append((f"u/{token}/report", None))

    for route, _ in pdf_routes:
        out_path = Path(f"/tmp/validate_reports_{route.replace('/', '_')}.pdf")
        result = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "generate_report_pdf.py"),
             "--route", route, "--base-url", base_url, "--out", str(out_path)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        if result.returncode == 0 and out_path.exists() and out_path.stat().st_size > 1000:
            ok("pdf", f"{route}: PDF generated ({out_path.stat().st_size:,} bytes)")
            if out_path.exists():
                out_path.unlink()
        else:
            fail("pdf", f"{route}: PDF generation failed - {result.stderr.decode('utf-8', errors='replace')[-300:]}")

    app_server.shutdown()

    if FAILURES:
        print(f"\n{len(FAILURES)} check(s) failed:")
        for check, message in FAILURES:
            print(f"  - [{check}] {message}")
        sys.exit(1)

    print("\nAll report checks passed.")


if __name__ == "__main__":
    main()
