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

# Reason text is wrapped in admin-typed quote characters (straight or the
# curly U+201C/U+201D this site's admin actually uses) rather than the plain
# ASCII quotes KV_PATTERN expects, so it's parsed separately straight off the
# raw line: `Reason=<quoted text> [user@2026-06-23T11:11:35]`.
REASON_PATTERN = re.compile(r'Reason=(.*?)\s*\[([^\]@]+)@([^\]]+)\]')
# OS's value is the one other unquoted KV_PATTERN can't handle: a
# space-separated uname string ("Linux 4.18.0-... #1 SMP ... 2026") rather
# than a single token, so KV_PATTERN's `\S*` branch only grabs "Linux". This
# captures everything up to (not including) the next "<word>=" token instead.
OS_PATTERN = re.compile(r'OS=(.*?)\s+(?=\w+=)')
GRES_TYPE_PATTERN = re.compile(r'gpu:([^:,()]+):(\d+)')
GRES_UNTYPED_PATTERN = re.compile(r'gpu:(\d+)')
GRES_IDX_PATTERN = re.compile(r'IDX:([^)]*)')


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
    """Sums GPU counts out of a Gres-style value like 'gpu:a100:4(IDX:0-3)'."""
    if not value or value in ("(null)", "N/A"):
        return 0
    total = 0
    for token in value.split(","):
        match = re.search(r"gpu:[^:]*:(\d+)", token)
        if match:
            total += int(match.group(1))
    return total


def parse_gres_type(value: Optional[str]) -> Optional[str]:
    """First GPU model named in a Gres-style value, e.g. 'a100' out of 'gpu:a100:4'."""
    if not value or value in ("(null)", "N/A"):
        return None
    match = GRES_TYPE_PATTERN.search(value)
    return match.group(1) if match else None


def parse_drain_reason(line: str) -> Tuple[Optional[str], Optional[str]]:
    """Extracts (reason_text, since_timestamp) from a raw scontrol node line.

    Not handled by parse_kv_line/KV_PATTERN: Reason's free-text value is
    quoted with whatever quote character the admin typed (straight or curly),
    not the ASCII '"' KV_PATTERN matches, and is followed by a bracketed
    `[user@timestamp]` suffix outside the KEY=value grammar entirely.
    """
    match = REASON_PATTERN.search(line)
    if not match:
        return None, None
    reason_text = match.group(1).strip().strip('"\'“”‘’')
    return (reason_text or None), match.group(3)


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
        drain_reason, drain_since = parse_drain_reason(line) if "DRAIN" in state else (None, None)
        partitions_raw = fields.get("Partitions", "") or ""
        os_match = OS_PATTERN.search(line)
        os_value = os_match.group(1) if os_match else (fields.get("OS") or None)
        nodes.append({
            "node_name": node_name,
            "state": state,
            # Slurm appends modifiers after '+' (e.g. "MIXED+DRAIN",
            # "DOWN*+DRAIN") - the base state is everything before the first one.
            "state_base": state.split("+")[0].rstrip("*") if state else state,
            "drain": "DRAIN" in state,
            "down": "DOWN" in state or "NOT_RESPONDING" in state or "FAIL" in state,
            "drain_reason": drain_reason,
            "drain_since": drain_since,
            "arch": fields.get("Arch") or None,
            "cpu_total": int(fields.get("CPUTot", 0) or 0),
            "cpu_alloc": int(fields.get("CPUAlloc", 0) or 0),
            "cpu_load": float(fields["CPULoad"]) if fields.get("CPULoad") not in (None, "", "N/A") else None,
            "sockets": int(fields["Sockets"]) if fields.get("Sockets") not in (None, "") else None,
            "cores_per_socket": int(fields["CoresPerSocket"]) if fields.get("CoresPerSocket") not in (None, "") else None,
            "threads_per_core": int(fields["ThreadsPerCore"]) if fields.get("ThreadsPerCore") not in (None, "") else None,
            "real_memory_mib": int(fields.get("RealMemory", 0) or 0),
            "alloc_mem_mib": int(fields.get("AllocMem", 0) or 0),
            "free_mem_mib": int(fields["FreeMem"]) if fields.get("FreeMem") not in (None, "") else None,
            # GPU type/total come from Gres (configured hardware); per-node GPU
            # *allocation* is filled in separately from sinfo's GresUsed below -
            # this Slurm install's `scontrol show node -o` never reports
            # GresUsed at all, only Gres.
            "gpu_type": parse_gres_type(fields.get("Gres")),
            "gpu_total": parse_gres_count(fields.get("Gres")),
            "gpu_alloc": 0,
            "gpu_indexes_allocated": None,
            "partitions": [p for p in partitions_raw.split(",") if p],
            "weight": int(fields["Weight"]) if fields.get("Weight") not in (None, "") else None,
            "boot_time": fields.get("BootTime") or None,
            "slurmd_start_time": fields.get("SlurmdStartTime") or None,
            "os": os_value,
            "slurm_version": fields.get("Version") or None,
        })
    return nodes


def apply_gpu_usage(nodes: List[dict], sinfo_gres_output: str) -> None:
    """Fills in gpu_alloc/gpu_indexes_allocated from `sinfo --Format=NodeHost,Gres,GresUsed`.

    Needed because GresUsed isn't available from `scontrol show node -o` on
    this Slurm version (confirmed empty on every node) - sinfo is the only
    live source for per-node GPU allocation. Each line is
    "<node> <Gres> <GresUsed>"; GresUsed looks like
    "gpu:a100:2(IDX:0-1)" or "(null)" on non-GPU nodes.
    """
    usage_by_node: Dict[str, dict] = {}
    for line in sinfo_gres_output.splitlines():
        parts = line.split()
        if len(parts) < 3:
            continue
        node_name, _gres, gres_used = parts[0], parts[1], parts[2]
        idx_match = GRES_IDX_PATTERN.search(gres_used)
        usage_by_node[node_name] = {
            "gpu_alloc": parse_gres_count(gres_used),
            "gpu_indexes_allocated": idx_match.group(1) if idx_match and idx_match.group(1) not in ("N/A", "") else None,
        }
    for node in nodes:
        usage = usage_by_node.get(node["node_name"])
        if usage:
            node["gpu_alloc"] = usage["gpu_alloc"]
            node["gpu_indexes_allocated"] = usage["gpu_indexes_allocated"]


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


def collect_running_jobs_per_node(scontrol_hostnames_output: str) -> Counter:
    """Running-job count per node, from the expanded hostlist of every
    running job's NodeList (one line per node occurrence - a multi-node job
    contributes one occurrence per node it runs on).
    """
    counts: Counter = Counter()
    for line in scontrol_hostnames_output.splitlines():
        node_name = line.strip()
        if node_name:
            counts[node_name] += 1
    return counts


def collect_partition_queue(squeue_partition_state_output: str) -> Dict[str, Dict[str, int]]:
    """Running/pending job counts per partition, from `squeue -h -o "%P %T"`."""
    by_partition: Dict[str, Dict[str, int]] = {}
    for line in squeue_partition_state_output.splitlines():
        parts = line.strip().split()
        if len(parts) != 2:
            continue
        partition, state = parts
        bucket = by_partition.setdefault(partition, {"running": 0, "pending": 0})
        if state == "RUNNING":
            bucket["running"] += 1
        elif state == "PENDING":
            bucket["pending"] += 1
    return by_partition


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


def node_detail_rows(nodes: List[dict], running_jobs_per_node: Dict[str, int], timestamp: str) -> List[tuple]:
    rows = []
    for n in nodes:
        cpu_pct = (n["cpu_alloc"] / n["cpu_total"] * 100) if n["cpu_total"] else None
        mem_pct = (n["alloc_mem_mib"] / n["real_memory_mib"] * 100) if n["real_memory_mib"] else None
        gpu_pct = (n["gpu_alloc"] / n["gpu_total"] * 100) if n["gpu_total"] else None
        rows.append((
            timestamp, n["node_name"], n["state"], n["state_base"], cpu_pct, mem_pct, gpu_pct,
            n["arch"], n["cpu_total"], n["cpu_alloc"], n["cpu_load"],
            n["sockets"], n["cores_per_socket"], n["threads_per_core"],
            n["real_memory_mib"], n["alloc_mem_mib"], n["free_mem_mib"],
            n["gpu_type"], n["gpu_total"], n["gpu_alloc"], n["gpu_indexes_allocated"],
            n["drain"], n["down"], n["drain_reason"], n["drain_since"],
            ",".join(n["partitions"]), n["weight"], n["boot_time"], n["slurmd_start_time"],
            n["os"], n["slurm_version"], running_jobs_per_node.get(n["node_name"], 0),
        ))
    return rows


def gather(mock_dir: Optional[Path] = None) -> dict:
    def read(args: List[str], fixture_name: str) -> str:
        if mock_dir is not None:
            return (mock_dir / fixture_name).read_text()
        return run_command(args)

    sinfo_output = read(["sinfo", "-h"], "sinfo.txt")
    node_output = read(["scontrol", "show", "node", "-o"], "scontrol_show_node.txt")
    partition_output = read(["scontrol", "show", "partition", "-o"], "scontrol_show_partition.txt")
    gres_output = read(["sinfo", "--Format=NodeHost:30,Gres:40,GresUsed:60", "-h"], "sinfo_gres.txt")
    squeue_states_output = read(["squeue", "-h", "-o", "%T"], "squeue_states.txt")
    squeue_reasons_output = read(["squeue", "-h", "-t", "PD", "-o", "%r"], "squeue_reasons.txt")
    squeue_partition_state_output = read(["squeue", "-h", "-o", "%P %T"], "squeue_partition_states.txt")
    squeue_running_nodelists_output = read(["squeue", "-h", "-t", "RUNNING", "-o", "%N"], "squeue_running_nodelists.txt")

    logger.debug("sinfo returned %d lines (cross-check only, not persisted)", len(sinfo_output.splitlines()))
    nodes = collect_nodes(node_output)
    apply_gpu_usage(nodes, gres_output)
    partitions = collect_partitions(partition_output)
    logger.debug("collected %d partitions (reserved for future Queue Analytics)", len(partitions))
    running_jobs, pending_jobs = collect_job_counts(squeue_states_output)
    pending_reasons = collect_pending_reasons(squeue_reasons_output)
    partition_queue = collect_partition_queue(squeue_partition_state_output)

    # Per-node running-job counts: each running job's NodeList (e.g.
    # "mjolnircomp[01-03]fl") is a Slurm hostlist expression, not a literal
    # node name, and a job can span multiple nodes - `scontrol show
    # hostnames` is the one call that expands every such expression (joined
    # by commas) into one node name per line, one line per node *occurrence*,
    # which is exactly the per-node count we want.
    nodelists = [line.strip() for line in squeue_running_nodelists_output.splitlines() if line.strip()]
    if nodelists:
        hostnames_output = read(["scontrol", "show", "hostnames", ",".join(nodelists)], "scontrol_show_hostnames.txt")
    else:
        hostnames_output = ""
    running_jobs_per_node = collect_running_jobs_per_node(hostnames_output)

    return {
        "nodes": nodes,
        "running_jobs": running_jobs,
        "pending_jobs": pending_jobs,
        "pending_reasons": pending_reasons,
        "partition_queue": partition_queue,
        "running_jobs_per_node": running_jobs_per_node,
    }


def store_snapshot(
    conn, snapshot: dict, pending_reasons: Counter, node_rows: List[tuple],
    partition_queue: Dict[str, Dict[str, int]],
) -> None:
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
    conn.execute("DELETE FROM partition_queue WHERE timestamp = ?", (snapshot["timestamp"],))
    conn.executemany(
        "INSERT INTO partition_queue (timestamp, partition, running, pending) VALUES (?, ?, ?, ?)",
        [(snapshot["timestamp"], partition, counts["running"], counts["pending"])
         for partition, counts in partition_queue.items()],
    )
    conn.execute("DELETE FROM node_snapshots WHERE timestamp = ?", (snapshot["timestamp"],))
    conn.executemany(
        """
        INSERT INTO node_snapshots (
            timestamp, node_name, node_state, state_base, cpu_utilization_percent,
            memory_utilization_percent, gpu_utilization_percent,
            arch, cpu_total, cpu_alloc, cpu_load,
            sockets, cores_per_socket, threads_per_core,
            real_memory_mib, alloc_mem_mib, free_mem_mib,
            gpu_type, gpu_total, gpu_alloc, gpu_indexes_allocated,
            drain, down, drain_reason, drain_since,
            partitions, weight, boot_time, slurmd_start_time,
            os, slurm_version, running_jobs_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    node_rows = node_detail_rows(collected["nodes"], collected["running_jobs_per_node"], timestamp)

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
        store_snapshot(conn, snapshot, collected["pending_reasons"], node_rows, collected["partition_queue"])
        record_collector_run(conn, COLLECTOR_NAME, ok=True)
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
