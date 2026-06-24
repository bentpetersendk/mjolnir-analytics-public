#!/usr/bin/env python3
"""Export aggregate-only public JSON from the Node Insights SQLite database.

Reads data/node_insights.sqlite (the authoritative source of truth) and
writes:
  - site/data/node_insights.json    latest snapshot + pending reasons + node states
  - site/data/capacity_history.json cluster-level time series (CPU/memory/GPU
                                     pressure, queue, draining nodes)
  - site/data/node_history.json     per-node time series (state + utilization)

These three files are the only Node Insights artifacts this pipeline ever
pushes to GitHub Pages (see scripts/publish_dashboard.sh). Raw snapshots
stay in SQLite indefinitely; only the most recent --days (default 90) are
included in the exported JSON. No usernames, job IDs, job names, or account
names are ever read from this database - the schema doesn't carry them.
"""
import argparse
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional

from node_insights_db import DEFAULT_DB_PATH, REPO_ROOT, connect, ensure_schema, get_collector_run

DEFAULT_OUT_DIR = REPO_ROOT / "site" / "data"
HISTORY_SCHEMA_VERSION = "node-insights-history-v1"
SNAPSHOT_SCHEMA_VERSION = "node-insights-v1"
COLLECTOR_NAME = "node_insights"
PLATFORM_MODULE = "Node Insights"


def collector_status_field(conn) -> Optional[str]:
    """Platform Status framework (docs/PLATFORM_STATUS.md): only ever
    surfaces an explicit "failed" here. Leaving it null/absent when the
    collector is fine lets the frontend judge Healthy/Warning/Stale from
    generated_at's age instead, which is what staleness actually means."""
    run = get_collector_run(conn, COLLECTOR_NAME)
    return "failed" if run and run["status"] == "failed" else None


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def ratio(numerator, denominator) -> Optional[float]:
    if numerator is None or not denominator:
        return None
    return round(numerator / denominator, 4)


def fetch_capacity_points(conn, cutoff_iso: str) -> List[dict]:
    rows = conn.execute(
        "SELECT * FROM snapshots WHERE timestamp >= ? ORDER BY timestamp ASC",
        (cutoff_iso,),
    ).fetchall()
    return [{
        "timestamp": row["timestamp"],
        "total_nodes": row["total_nodes"],
        "available_nodes": row["available_nodes"],
        "draining_nodes": row["draining_nodes"],
        "down_nodes": row["down_nodes"],
        "cpu_pct": ratio(row["cpu_allocated"], row["cpu_total"]),
        "memory_pct": ratio(row["memory_allocated_gib"], row["memory_total_gib"]),
        "gpu_pct": ratio(row["gpu_allocated"], row["gpu_total"]),
        "running_jobs": row["running_jobs"],
        "pending_jobs": row["pending_jobs"],
    } for row in rows]


def fetch_node_points(conn, cutoff_iso: str) -> List[dict]:
    rows = conn.execute(
        "SELECT * FROM node_snapshots WHERE timestamp >= ? ORDER BY node_name ASC, timestamp ASC",
        (cutoff_iso,),
    ).fetchall()
    nodes = {}
    for row in rows:
        bucket = nodes.setdefault(row["node_name"], [])
        bucket.append({
            "timestamp": row["timestamp"],
            "state": row["node_state"],
            "cpu_pct": ratio(row["cpu_utilization_percent"], 100),
            "mem_pct": ratio(row["memory_utilization_percent"], 100),
            "gpu_pct": ratio(row["gpu_utilization_percent"], 100),
        })
    return [{"node_name": name, "points": points} for name, points in sorted(nodes.items())]


def fetch_latest_snapshot(conn) -> Optional[dict]:
    row = conn.execute("SELECT * FROM snapshots ORDER BY timestamp DESC LIMIT 1").fetchone()
    return dict(row) if row is not None else None


def fetch_latest_pending_reasons(conn, latest_timestamp: Optional[str]) -> List[dict]:
    if latest_timestamp is None:
        return []
    rows = conn.execute(
        "SELECT reason, count FROM pending_reasons WHERE timestamp = ? ORDER BY count DESC",
        (latest_timestamp,),
    ).fetchall()
    return [{"reason": r["reason"], "count": r["count"]} for r in rows]


def fetch_latest_node_states(conn, latest_timestamp: Optional[str]) -> List[dict]:
    if latest_timestamp is None:
        return []
    rows = conn.execute(
        "SELECT * FROM node_snapshots WHERE timestamp = ? ORDER BY node_name ASC",
        (latest_timestamp,),
    ).fetchall()
    return [{
        "node_name": r["node_name"],
        "node_state": r["node_state"],
        "cpu_pct": ratio(r["cpu_utilization_percent"], 100),
        "memory_pct": ratio(r["memory_utilization_percent"], 100),
        "gpu_pct": ratio(r["gpu_utilization_percent"], 100),
    } for r in rows]


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH))
    parser.add_argument("--out-dir", default=str(DEFAULT_OUT_DIR))
    parser.add_argument("--days", type=int, default=90, help="Retention window exported to the public site.")
    args = parser.parse_args()

    db_path = Path(args.db)
    out_dir = Path(args.out_dir)
    cutoff_iso = (datetime.now(timezone.utc) - timedelta(days=args.days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    generated_at = utc_now_iso()

    conn = connect(db_path)
    try:
        ensure_schema(conn)
        latest = fetch_latest_snapshot(conn)
        latest_timestamp = latest["timestamp"] if latest else None
        collector_status = collector_status_field(conn)

        node_insights_doc = {
            "schema_version": SNAPSHOT_SCHEMA_VERSION,
            "generated_at": generated_at,
            "source": "sqlite:node_insights",
            "collector": COLLECTOR_NAME,
            "collector_status": collector_status,
            "platform_module": PLATFORM_MODULE,
            "data_window_days": None,
            "latest_snapshot": latest,
            "pending_reasons": fetch_latest_pending_reasons(conn, latest_timestamp),
            "nodes": fetch_latest_node_states(conn, latest_timestamp),
        }
        capacity_points = fetch_capacity_points(conn, cutoff_iso)
        capacity_history_doc = {
            "schema_version": HISTORY_SCHEMA_VERSION,
            "generated_at": generated_at,
            "source": "sqlite:node_insights",
            "collector": COLLECTOR_NAME,
            "collector_status": collector_status,
            "platform_module": PLATFORM_MODULE,
            "data_window_days": args.days,
            "retention_days": args.days,
            "points": capacity_points,
        }
        node_history_nodes = fetch_node_points(conn, cutoff_iso)
        node_history_doc = {
            "schema_version": HISTORY_SCHEMA_VERSION,
            "generated_at": generated_at,
            "source": "sqlite:node_insights",
            "collector": COLLECTOR_NAME,
            "collector_status": collector_status,
            "platform_module": PLATFORM_MODULE,
            "data_window_days": args.days,
            "retention_days": args.days,
            "nodes": node_history_nodes,
        }

        write_json(out_dir / "node_insights.json", node_insights_doc)
        write_json(out_dir / "capacity_history.json", capacity_history_doc)
        write_json(out_dir / "node_history.json", node_history_doc)
    finally:
        conn.close()

    print(
        f"Exported Node Insights history to {out_dir} "
        f"({len(capacity_points)} capacity points, {len(node_history_nodes)} nodes, "
        f"retention {args.days}d)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
