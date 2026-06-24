#!/usr/bin/env python3
"""Hourly Slurm fleet collector for Mjolnir Node Insights.

Runs sinfo / scontrol show node / scontrol show partition / squeue once,
aggregates public-safe cluster and node state (no usernames, job IDs, job
names, or account names anywhere in this script), and writes one row per
table into data/node_insights.sqlite for the current timestamp.

Designed to be invoked by mjolnir-node-collector.timer once an hour as a
oneshot systemd service: each run is a single fast pass, not a daemon loop.
Raw snapshots are kept in SQLite indefinitely; retention/trimming for the
public site happens only in scripts/export_node_insights.py.
"""
import argparse
import logging
import re
import subprocess
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from node_insights_db import DEFAULT_DB_PATH, connect, ensure_schema, record_collector_run

COLLECTOR_NAME = "node_insights"

logger = logging.getLogger("collect_node_insights")

# Matches KEY=value or KEY="quoted value" tokens in scontrol -o output.
KV_PATTERN = re.compile(r'(\w+)=("(?:[^"\\]|\\.)*"|\S*)')


def run_command(args: List[str]) -> str:
    result = subprocess.run(
        args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True, timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(f"{' '.join(args)} failed (rc={result.returncode}): {result.stderr.strip()}")
    return result.stdout


def parse_kv_line(line: str) -> dict:
    return {key: value.strip('"') for key, value in KV_PATTERN.findall(line)}


def parse_gres_count(value: Optional[str]) -> int:
    """Sums GPU counts out of a Gres/GresUsed value like 'gpu:a100:4(IDX:0-3)'."""
    if not value or value in ("(null)", "N/A"):
        return 0
    total = 0
    for token in value.split(","):
        match = re.search(r"gpu:[^:]*:(\d+)", token)
        if match:
            total += int(match.group(1))
    return total


def collect_nodes(scontrol_node_output: str) -> List[dict]:
    nodes = []
    for line in scontrol_node_output.splitlines():
        line = line.strip()
        if not line:
            continue
        fields = parse_kv_line(line)
        node_name = fields.get("NodeName")
        if not node_name:
            continue
        state = fields.get("State", "") or ""
        nodes.append({
            "node_name": node_name,
            "state": state,
            "drain": "DRAIN" in state,
            "down": "DOWN" in state or "NOT_RESPONDING" in state or "FAIL" in state,
            "cpu_total": int(fields.get("CPUTot", 0) or 0),
            "cpu_alloc": int(fields.get("CPUAlloc", 0) or 0),
            "real_memory_mib": int(fields.get("RealMemory", 0) or 0),
            "alloc_mem_mib": int(fields.get("AllocMem", 0) or 0),
            "gpu_total": parse_gres_count(fields.get("Gres")),
            "gpu_alloc": parse_gres_count(fields.get("GresUsed")),
        })
    return nodes


def collect_partitions(scontrol_partition_output: str) -> List[dict]:
    """Parsed for parity with the required data sources and reserved for a
    future Slurm Insights Queue Analytics module; not yet persisted."""
    partitions = []
    for line in scontrol_partition_output.splitlines():
        line = line.strip()
        if not line:
            continue
        fields = parse_kv_line(line)
        if fields.get("PartitionName"):
            partitions.append(fields)
    return partitions


def collect_job_counts(squeue_states_output: str) -> Tuple[int, int]:
    running = pending = 0
    for line in squeue_states_output.splitlines():
        state = line.strip()
        if state == "RUNNING":
            running += 1
        elif state == "PENDING":
            pending += 1
    return running, pending


def collect_pending_reasons(squeue_reasons_output: str) -> Counter:
    reasons: Counter = Counter()
    for line in squeue_reasons_output.splitlines():
        reason = line.strip()
        if reason:
            reasons[reason] += 1
    return reasons


def build_snapshot(nodes: List[dict], running_jobs: int, pending_jobs: int, timestamp: str) -> dict:
    total_nodes = len(nodes)
    draining_nodes = sum(1 for n in nodes if n["drain"])
    down_nodes = sum(1 for n in nodes if n["down"] and not n["drain"])
    available_nodes = total_nodes - draining_nodes - down_nodes
    return {
        "timestamp": timestamp,
        "total_nodes": total_nodes,
        "available_nodes": available_nodes,
        "draining_nodes": draining_nodes,
        "down_nodes": down_nodes,
        "cpu_total": sum(n["cpu_total"] for n in nodes),
        "cpu_allocated": sum(n["cpu_alloc"] for n in nodes),
        "memory_total_gib": round(sum(n["real_memory_mib"] for n in nodes) / 1024, 2),
        "memory_allocated_gib": round(sum(n["alloc_mem_mib"] for n in nodes) / 1024, 2),
        "gpu_total": sum(n["gpu_total"] for n in nodes),
        "gpu_allocated": sum(n["gpu_alloc"] for n in nodes),
        "running_jobs": running_jobs,
        "pending_jobs": pending_jobs,
    }


def node_utilization_rows(nodes: List[dict], timestamp: str) -> List[tuple]:
    rows = []
    for n in nodes:
        cpu_pct = (n["cpu_alloc"] / n["cpu_total"] * 100) if n["cpu_total"] else None
        mem_pct = (n["alloc_mem_mib"] / n["real_memory_mib"] * 100) if n["real_memory_mib"] else None
        gpu_pct = (n["gpu_alloc"] / n["gpu_total"] * 100) if n["gpu_total"] else None
        rows.append((timestamp, n["node_name"], n["state"], cpu_pct, mem_pct, gpu_pct))
    return rows


def gather(mock_dir: Optional[Path] = None) -> dict:
    def read(args: List[str], fixture_name: str) -> str:
        if mock_dir is not None:
            return (mock_dir / fixture_name).read_text()
        return run_command(args)

    sinfo_output = read(["sinfo", "-h"], "sinfo.txt")
    node_output = read(["scontrol", "show", "node", "-o"], "scontrol_show_node.txt")
    partition_output = read(["scontrol", "show", "partition", "-o"], "scontrol_show_partition.txt")
    squeue_states_output = read(["squeue", "-h", "-o", "%T"], "squeue_states.txt")
    squeue_reasons_output = read(["squeue", "-h", "-t", "PD", "-o", "%r"], "squeue_reasons.txt")

    logger.debug("sinfo returned %d lines (cross-check only, not persisted)", len(sinfo_output.splitlines()))
    nodes = collect_nodes(node_output)
    partitions = collect_partitions(partition_output)
    logger.debug("collected %d partitions (reserved for future Queue Analytics)", len(partitions))
    running_jobs, pending_jobs = collect_job_counts(squeue_states_output)
    pending_reasons = collect_pending_reasons(squeue_reasons_output)
    return {
        "nodes": nodes,
        "running_jobs": running_jobs,
        "pending_jobs": pending_jobs,
        "pending_reasons": pending_reasons,
    }


def store_snapshot(conn, snapshot: dict, pending_reasons: Counter, node_rows: List[tuple]) -> None:
    conn.execute(
        """
        INSERT OR REPLACE INTO snapshots (
            timestamp, total_nodes, available_nodes, draining_nodes, down_nodes,
            cpu_total, cpu_allocated, memory_total_gib, memory_allocated_gib,
            gpu_total, gpu_allocated, running_jobs, pending_jobs
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            snapshot["timestamp"], snapshot["total_nodes"], snapshot["available_nodes"],
            snapshot["draining_nodes"], snapshot["down_nodes"], snapshot["cpu_total"],
            snapshot["cpu_allocated"], snapshot["memory_total_gib"], snapshot["memory_allocated_gib"],
            snapshot["gpu_total"], snapshot["gpu_allocated"], snapshot["running_jobs"], snapshot["pending_jobs"],
        ),
    )
    conn.execute("DELETE FROM pending_reasons WHERE timestamp = ?", (snapshot["timestamp"],))
    conn.executemany(
        "INSERT INTO pending_reasons (timestamp, reason, count) VALUES (?, ?, ?)",
        [(snapshot["timestamp"], reason, count) for reason, count in pending_reasons.items()],
    )
    conn.execute("DELETE FROM node_snapshots WHERE timestamp = ?", (snapshot["timestamp"],))
    conn.executemany(
        """
        INSERT INTO node_snapshots (
            timestamp, node_name, node_state, cpu_utilization_percent,
            memory_utilization_percent, gpu_utilization_percent
        ) VALUES (?, ?, ?, ?, ?, ?)
        """,
        node_rows,
    )
    conn.commit()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH), help="Path to node_insights.sqlite")
    parser.add_argument(
        "--mock-dir", default=None,
        help="Read sinfo/scontrol/squeue output from text fixtures in this directory instead of "
             "invoking the Slurm CLI (for testing on a host without Slurm access).",
    )
    parser.add_argument("--dry-run", action="store_true", help="Collect and log the snapshot without writing to SQLite.")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    mock_dir = Path(args.mock_dir) if args.mock_dir else None

    try:
        collected = gather(mock_dir)
    except Exception as exc:
        logger.exception("Failed to collect Slurm fleet state; skipping this run.")
        if not args.dry_run:
            conn = connect(Path(args.db))
            try:
                ensure_schema(conn)
                record_collector_run(conn, COLLECTOR_NAME, ok=False, message=str(exc))
            finally:
                conn.close()
        return 1

    snapshot = build_snapshot(collected["nodes"], collected["running_jobs"], collected["pending_jobs"], timestamp)
    node_rows = node_utilization_rows(collected["nodes"], timestamp)

    logger.info(
        "snapshot %s: %d nodes (%d available, %d draining, %d down), "
        "cpu %d/%d, mem %.1f/%.1f GiB, gpu %d/%d, jobs running=%d pending=%d",
        timestamp, snapshot["total_nodes"], snapshot["available_nodes"], snapshot["draining_nodes"],
        snapshot["down_nodes"], snapshot["cpu_allocated"], snapshot["cpu_total"],
        snapshot["memory_allocated_gib"], snapshot["memory_total_gib"],
        snapshot["gpu_allocated"], snapshot["gpu_total"], snapshot["running_jobs"], snapshot["pending_jobs"],
    )

    if args.dry_run:
        logger.info("dry run: not writing to %s", args.db)
        return 0

    conn = connect(Path(args.db))
    try:
        ensure_schema(conn)
        store_snapshot(conn, snapshot, collected["pending_reasons"], node_rows)
        record_collector_run(conn, COLLECTOR_NAME, ok=True)
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
