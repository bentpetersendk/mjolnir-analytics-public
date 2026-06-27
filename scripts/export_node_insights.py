#!/usr/bin/env python3
"""Export aggregate-only public JSON from the Node Insights SQLite database.

Reads data/node_insights.sqlite (the authoritative source of truth) and
writes, to --out-dir (default site/data/ for standalone/local runs; the
hourly cycle passes a dashboard-data clone's mjolnir/ directory instead -
see docs/DASHBOARD_DATA_MIGRATION.md):
  - node_insights.json    latest snapshot, broken into the cluster_overview /
                          node_inventory / hardware_inventory /
                          capacity_planning sections the four Node Insights
                          pages render
  - capacity_history.json cluster-level time series (CPU/memory/GPU
                           pressure, queue, draining nodes)
  - node_history.json     per-node time series (state + utilization)

These three files are the only Node Insights artifacts this pipeline ever
publishes (see scripts/publish_dashboard.sh). Raw snapshots stay in SQLite
indefinitely; only the most recent --days (default 90) are included in the
exported JSON. No usernames, job IDs, job names, or account names are ever
read from this database - the schema doesn't carry them.
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

# Pressure reading thresholds shared by Cluster Overview's allocation gauges
# and Capacity Planning's pressure cards.
PRESSURE_WARN_PCT = 0.70
PRESSURE_BAD_PCT = 0.90


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


def pressure_reading(pct: Optional[float]) -> str:
    if pct is None:
        return "good"
    if pct >= PRESSURE_BAD_PCT:
        return "bad"
    if pct >= PRESSURE_WARN_PCT:
        return "warn"
    return "good"


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


def fetch_latest_partition_queue(conn, latest_timestamp: Optional[str]) -> List[dict]:
    if latest_timestamp is None:
        return []
    rows = conn.execute(
        "SELECT partition, running, pending FROM partition_queue WHERE timestamp = ? ORDER BY partition ASC",
        (latest_timestamp,),
    ).fetchall()
    return [{"partition": r["partition"], "running": r["running"], "pending": r["pending"]} for r in rows]


def classify_node(node: dict, mode_profile: Optional[tuple]) -> tuple:
    """Buckets a node into the class/class_label shown on Node Inventory and
    Cluster Overview's "by class" breakdown.

    Hardware-derived only: GPU presence, then comparison against the fleet's
    most common non-GPU (cpu_total, real_memory_mib) profile. Nodes can also
    be set aside for non-hardware reasons (e.g. a dedicated teaching
    partition) that aren't visible from scontrol's node fields at all - this
    heuristic can't reproduce that, so such nodes fall back to whichever
    hardware bucket they match.
    """
    if node["gpu_total"]:
        return "gpu", "GPU"
    profile = (node["cpu_total"], node["real_memory_mib"])
    if mode_profile is not None and profile == mode_profile:
        return "standard_compute", "Standard Compute"
    if mode_profile is not None and mode_profile[1] and node["real_memory_mib"] >= mode_profile[1] * 1.5:
        return "high_memory", "High Memory"
    return "other", "Other"


def fetch_latest_node_details(conn, latest_timestamp: Optional[str]) -> List[dict]:
    if latest_timestamp is None:
        return []
    rows = conn.execute(
        "SELECT * FROM node_snapshots WHERE timestamp = ? ORDER BY node_name ASC",
        (latest_timestamp,),
    ).fetchall()
    node_rows = [dict(r) for r in rows]

    non_gpu_profiles: Dict[tuple, int] = {}
    for row in node_rows:
        if not row["gpu_total"]:
            profile = (row["cpu_total"], row["real_memory_mib"])
            non_gpu_profiles[profile] = non_gpu_profiles.get(profile, 0) + 1
    mode_profile = max(non_gpu_profiles, key=non_gpu_profiles.get) if non_gpu_profiles else None

    nodes = []
    for row in node_rows:
        node_class, class_label = classify_node(row, mode_profile)
        partitions = [p for p in (row["partitions"] or "").split(",") if p]
        physical_cores = (
            row["sockets"] * row["cores_per_socket"]
            if row["sockets"] is not None and row["cores_per_socket"] is not None else None
        )
        nodes.append({
            "node": row["node_name"],
            "class": node_class,
            "class_label": class_label,
            "arch": row["arch"],
            "cpu_total": row["cpu_total"],
            "cpu_alloc": row["cpu_alloc"],
            "cpu_alloc_pct": ratio(row["cpu_alloc"], row["cpu_total"]),
            "cpu_load": row["cpu_load"],
            "sockets": row["sockets"],
            "cores_per_socket": row["cores_per_socket"],
            "threads_per_core": row["threads_per_core"],
            "physical_cores": physical_cores,
            "real_memory_mib": row["real_memory_mib"],
            "alloc_mem_mib": row["alloc_mem_mib"],
            "free_mem_mib": row["free_mem_mib"],
            "mem_alloc_pct": ratio(row["alloc_mem_mib"], row["real_memory_mib"]),
            "gpu_type": row["gpu_type"],
            "gpu_total": row["gpu_total"],
            "gpu_alloc": row["gpu_alloc"],
            "gpu_alloc_pct": ratio(row["gpu_alloc"], row["gpu_total"]),
            "gpu_indexes_allocated": row["gpu_indexes_allocated"],
            "state": row["node_state"],
            "state_base": row["state_base"],
            "drain": bool(row["drain"]),
            "down": bool(row["down"]),
            "drain_reason": row["drain_reason"],
            "drain_since": row["drain_since"],
            "partitions": partitions,
            "weight": row["weight"],
            "boot_time": row["boot_time"],
            "slurmd_start_time": row["slurmd_start_time"],
            "os": row["os"],
            "slurm_version": row["slurm_version"],
            "running_jobs_count": row["running_jobs_count"] or 0,
        })
    return nodes


def build_cluster_overview(latest: Optional[dict], pending_reasons: List[dict],
                            partition_queue: List[dict], nodes: List[dict]) -> dict:
    if latest is None:
        return {}
    cpu_alloc_pct = ratio(latest["cpu_allocated"], latest["cpu_total"])
    mem_alloc_pct = ratio(latest["memory_allocated_gib"], latest["memory_total_gib"])
    gpu_alloc_pct = ratio(latest["gpu_allocated"], latest["gpu_total"])
    # "Online" GPUs exclude nodes currently down or draining for maintenance -
    # a draining node's GPUs aren't accepting new allocations even though
    # the node hasn't been marked down.
    online_gpu_total = sum(n["gpu_total"] or 0 for n in nodes if not n["down"] and not n["drain"])

    by_class: Dict[str, int] = {}
    for n in nodes:
        by_class[n["class_label"]] = by_class.get(n["class_label"], 0) + 1

    by_partition: Dict[str, int] = {}
    for n in nodes:
        for p in n["partitions"]:
            by_partition[p] = by_partition.get(p, 0) + 1

    draining = [n for n in nodes if n["drain"]]

    return {
        "totals": {
            "nodes_total": latest["total_nodes"],
            "nodes_available": latest["available_nodes"],
            "nodes_draining": latest["draining_nodes"],
            "nodes_down": latest["down_nodes"],
        },
        "cpu": {"alloc": latest["cpu_allocated"], "total": latest["cpu_total"], "alloc_pct": cpu_alloc_pct},
        "memory_mib": {
            "alloc": round(latest["memory_allocated_gib"] * 1024),
            "total": round(latest["memory_total_gib"] * 1024),
            "alloc_pct": mem_alloc_pct,
        },
        "gpu": {
            "alloc": latest["gpu_allocated"],
            "total": latest["gpu_total"],
            "alloc_pct": gpu_alloc_pct,
            "online_total": online_gpu_total,
            "alloc_pct_of_online": ratio(latest["gpu_allocated"], online_gpu_total),
        },
        "queue": {
            "jobs_total": latest["running_jobs"] + latest["pending_jobs"],
            "running": latest["running_jobs"],
            "pending": latest["pending_jobs"],
            "by_partition": [{"partition": p["partition"], "running": p["running"], "pending": p["pending"]} for p in partition_queue],
            "pending_reasons": pending_reasons,
        },
        "maintenance": {
            "nodes_draining": len(draining),
            "nodes": [{"node": n["node"], "reason": n["drain_reason"], "since": n["drain_since"]} for n in draining],
        },
        "by_class": [{"class": c, "count": count} for c, count in sorted(by_class.items())],
        "by_partition": [{"partition": p, "node_count": count} for p, count in sorted(by_partition.items())],
    }


def build_hardware_inventory(nodes: List[dict]) -> dict:
    if not nodes:
        return {}
    profiles: Dict[tuple, dict] = {}
    for n in nodes:
        gpu_count = n["gpu_total"] or 0
        key = (n["cpu_total"], n["real_memory_mib"], n["gpu_type"], gpu_count)
        bucket = profiles.setdefault(key, {
            "label": f"{n['cpu_total']}c / {round(n['real_memory_mib'] / 1024, 1)} GiB RAM"
            + (f" / {gpu_count}x {n['gpu_type'].upper()}" if gpu_count and n["gpu_type"] else ""),
            "node_count": 0,
            "cpu_total": n["cpu_total"],
            "real_memory_mib": n["real_memory_mib"],
            "real_memory_gib": round(n["real_memory_mib"] / 1024, 1),
            "gpu_type": n["gpu_type"],
            "gpu_count": gpu_count,
            "nodes": [],
        })
        bucket["node_count"] += 1
        bucket["nodes"].append(n["node"])

    slurm_versions: Dict[str, int] = {}
    os_builds: Dict[str, int] = {}
    for n in nodes:
        if n["slurm_version"]:
            slurm_versions[n["slurm_version"]] = slurm_versions.get(n["slurm_version"], 0) + 1
        if n["os"]:
            os_builds[n["os"]] = os_builds.get(n["os"], 0) + 1

    gpu_types = sorted({n["gpu_type"] for n in nodes if n["gpu_type"]})
    return {
        "fleet": {
            "nodes_total": len(nodes),
            "logical_cpus_total": sum(n["cpu_total"] or 0 for n in nodes),
            "physical_cores_total": sum(n["physical_cores"] or 0 for n in nodes),
            "ram_mib_total": sum(n["real_memory_mib"] or 0 for n in nodes),
            "ram_gib_total": round(sum(n["real_memory_mib"] or 0 for n in nodes) / 1024, 1),
            "gpu_total": sum(n["gpu_total"] or 0 for n in nodes),
            "gpu_types": gpu_types,
        },
        "profiles": sorted(profiles.values(), key=lambda p: (-p["node_count"], p["label"])),
        "slurm_versions": [{"version": v, "node_count": c} for v, c in sorted(slurm_versions.items())],
        "os_kernel_builds": [{"os": o, "node_count": c} for o, c in sorted(os_builds.items())],
        "kernel_drift": {
            "note": "All nodes report identical OS/kernel builds." if len(os_builds) <= 1
            else f"{len(os_builds)} distinct OS/kernel builds across the fleet.",
        },
    }


def build_capacity_planning(latest: Optional[dict], pending_reasons: List[dict], nodes: List[dict]) -> dict:
    if latest is None:
        return {}
    cpu_alloc_pct = ratio(latest["cpu_allocated"], latest["cpu_total"])
    mem_alloc_pct = ratio(latest["memory_allocated_gib"], latest["memory_total_gib"])
    online_gpu_total = sum(n["gpu_total"] or 0 for n in nodes if not n["down"] and not n["drain"])
    gpu_alloc_pct_of_online = ratio(latest["gpu_allocated"], online_gpu_total)

    draining = [n for n in nodes if n["drain"]]
    cpu_removed = sum(n["cpu_total"] or 0 for n in draining)
    gpu_removed = sum(n["gpu_total"] or 0 for n in draining)

    return {
        "history_status": {
            "collecting_since": None,
            "note": "Pressure trend is shown on the chart above, sourced from the hourly Node Insights collector.",
        },
        "pressure": {
            "cpu": {"alloc_pct": cpu_alloc_pct, "alloc": latest["cpu_allocated"], "total": latest["cpu_total"],
                     "reading": pressure_reading(cpu_alloc_pct)},
            "memory": {"alloc_pct": mem_alloc_pct, "alloc": round(latest["memory_allocated_gib"] * 1024),
                       "total": round(latest["memory_total_gib"] * 1024), "reading": pressure_reading(mem_alloc_pct)},
            "gpu": {"alloc_pct": ratio(latest["gpu_allocated"], latest["gpu_total"]),
                    "alloc_pct_of_online": gpu_alloc_pct_of_online,
                    "alloc": latest["gpu_allocated"], "total": latest["gpu_total"], "online_total": online_gpu_total,
                    "reading": pressure_reading(gpu_alloc_pct_of_online)},
        },
        "queue_pressure": {
            "pending_total": latest["pending_jobs"],
            "pending_reasons": pending_reasons,
        },
        "maintenance_exposure": {
            "nodes_draining": len(draining),
            "nodes_draining_pct": ratio(len(draining), latest["total_nodes"]),
            "cpu_removed": cpu_removed,
            "cpu_removed_pct": ratio(cpu_removed, latest["cpu_total"]),
            "gpu_removed": gpu_removed,
            "gpu_removed_pct": ratio(gpu_removed, latest["gpu_total"]),
        },
    }


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

        pending_reasons = fetch_latest_pending_reasons(conn, latest_timestamp)
        partition_queue = fetch_latest_partition_queue(conn, latest_timestamp)
        nodes = fetch_latest_node_details(conn, latest_timestamp)

        node_insights_doc = {
            "schema_version": SNAPSHOT_SCHEMA_VERSION,
            "generated_at": generated_at,
            "source": "sqlite:node_insights",
            "collector": COLLECTOR_NAME,
            "collector_status": collector_status,
            "platform_module": PLATFORM_MODULE,
            "data_window_days": None,
            "files": {
                "cluster_overview": "cluster_overview",
                "node_inventory": "node_inventory",
                "hardware_inventory": "hardware_inventory",
                "capacity_planning": "capacity_planning",
            },
            "cluster_overview": build_cluster_overview(latest, pending_reasons, partition_queue, nodes),
            "node_inventory": {"node_count": len(nodes), "nodes": nodes},
            "hardware_inventory": build_hardware_inventory(nodes),
            "capacity_planning": build_capacity_planning(latest, pending_reasons, nodes),
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
