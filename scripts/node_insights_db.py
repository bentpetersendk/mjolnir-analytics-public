"""Shared SQLite schema and connection helpers for Mjolnir Node Insights.

data/node_insights.sqlite is the authoritative source of truth for the Node
Insights pipeline. This module is the shared foundation for the future
Mjolnir Analytics platform: additional Slurm Insights modules (job
analytics, queue analytics, wait-time prediction, utilization forecasting)
can add their own tables to the same database, keyed by the same
`timestamp` (UTC ISO-8601) convention used below, without altering the
tables already defined here.
"""
import sqlite3
from pathlib import Path
from typing import Union

SCHEMA_VERSION = 1
REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB_PATH = REPO_ROOT / "data" / "node_insights.sqlite"

# Each statement is idempotent (CREATE TABLE/INDEX IF NOT EXISTS) so this can
# run on every collector/export invocation with no migration step. New
# tables for future modules belong in their own statements, not as columns
# bolted onto these three.
SCHEMA_STATEMENTS = (
    """
    CREATE TABLE IF NOT EXISTS snapshots (
        timestamp TEXT PRIMARY KEY,
        total_nodes INTEGER,
        available_nodes INTEGER,
        draining_nodes INTEGER,
        down_nodes INTEGER,
        cpu_total INTEGER,
        cpu_allocated INTEGER,
        memory_total_gib REAL,
        memory_allocated_gib REAL,
        gpu_total INTEGER,
        gpu_allocated INTEGER,
        running_jobs INTEGER,
        pending_jobs INTEGER
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS pending_reasons (
        timestamp TEXT NOT NULL REFERENCES snapshots(timestamp),
        reason TEXT NOT NULL,
        count INTEGER NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_pending_reasons_timestamp ON pending_reasons(timestamp)",
    """
    CREATE TABLE IF NOT EXISTS node_snapshots (
        timestamp TEXT NOT NULL REFERENCES snapshots(timestamp),
        node_name TEXT NOT NULL,
        node_state TEXT,
        cpu_utilization_percent REAL,
        memory_utilization_percent REAL,
        gpu_utilization_percent REAL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_node_snapshots_timestamp ON node_snapshots(timestamp)",
    "CREATE INDEX IF NOT EXISTS idx_node_snapshots_node_name ON node_snapshots(node_name)",
    "CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
)


def connect(db_path: Union[Path, str] = DEFAULT_DB_PATH) -> sqlite3.Connection:
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path), timeout=30)
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("PRAGMA foreign_keys = ON")
    conn.row_factory = sqlite3.Row
    return conn


def ensure_schema(conn: sqlite3.Connection) -> None:
    for statement in SCHEMA_STATEMENTS:
        conn.execute(statement)
    conn.execute(
        "INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schema_version', ?)",
        (str(SCHEMA_VERSION),),
    )
    conn.commit()
