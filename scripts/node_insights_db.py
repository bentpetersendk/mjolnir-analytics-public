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
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Union

SCHEMA_VERSION = 3
REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB_PATH = REPO_ROOT / "data" / "node_insights.sqlite"

# Each CREATE statement is idempotent (CREATE TABLE/INDEX IF NOT EXISTS), so
# this always covers a fresh database. Columns added to node_snapshots after
# schema v2 are backfilled onto pre-existing databases by the ALTER TABLE
# migration in ensure_schema() instead - SQLite's IF NOT EXISTS doesn't add
# columns to a table that already exists with an older shape.
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
    CREATE TABLE IF NOT EXISTS partition_queue (
        timestamp TEXT NOT NULL REFERENCES snapshots(timestamp),
        partition TEXT NOT NULL,
        running INTEGER NOT NULL,
        pending INTEGER NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_partition_queue_timestamp ON partition_queue(timestamp)",
    """
    CREATE TABLE IF NOT EXISTS node_snapshots (
        timestamp TEXT NOT NULL REFERENCES snapshots(timestamp),
        node_name TEXT NOT NULL,
        node_state TEXT,
        state_base TEXT,
        cpu_utilization_percent REAL,
        memory_utilization_percent REAL,
        gpu_utilization_percent REAL,
        arch TEXT,
        cpu_total INTEGER,
        cpu_alloc INTEGER,
        cpu_load REAL,
        sockets INTEGER,
        cores_per_socket INTEGER,
        threads_per_core INTEGER,
        real_memory_mib INTEGER,
        alloc_mem_mib INTEGER,
        free_mem_mib INTEGER,
        gpu_type TEXT,
        gpu_total INTEGER,
        gpu_alloc INTEGER,
        gpu_indexes_allocated TEXT,
        drain INTEGER,
        down INTEGER,
        drain_reason TEXT,
        drain_since TEXT,
        partitions TEXT,
        weight INTEGER,
        boot_time TEXT,
        slurmd_start_time TEXT,
        os TEXT,
        slurm_version TEXT,
        running_jobs_count INTEGER
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_node_snapshots_timestamp ON node_snapshots(timestamp)",
    "CREATE INDEX IF NOT EXISTS idx_node_snapshots_node_name ON node_snapshots(node_name)",
    "CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    # Platform Status framework (docs/PLATFORM_STATUS.md): one row per
    # collector, updated on every run (success or failure) by
    # record_collector_run() below. export_node_insights.py reads this to
    # populate the collector_status field on every exported JSON document -
    # the frontend only trusts an explicit "failed" here; otherwise it
    # judges Healthy/Warning/Stale purely from how old the data is.
    """
    CREATE TABLE IF NOT EXISTS collector_runs (
        collector TEXT PRIMARY KEY,
        last_attempt_at TEXT NOT NULL,
        last_success_at TEXT,
        status TEXT NOT NULL,
        message TEXT
    )
    """,
)

# Columns added to node_snapshots in schema v3, with the type used for the
# ALTER TABLE migration below. Order doesn't matter - each is added
# independently and is a no-op if already present.
NODE_SNAPSHOTS_V3_COLUMNS = (
    ("state_base", "TEXT"),
    ("arch", "TEXT"),
    ("cpu_total", "INTEGER"),
    ("cpu_alloc", "INTEGER"),
    ("cpu_load", "REAL"),
    ("sockets", "INTEGER"),
    ("cores_per_socket", "INTEGER"),
    ("threads_per_core", "INTEGER"),
    ("real_memory_mib", "INTEGER"),
    ("alloc_mem_mib", "INTEGER"),
    ("free_mem_mib", "INTEGER"),
    ("gpu_type", "TEXT"),
    ("gpu_total", "INTEGER"),
    ("gpu_alloc", "INTEGER"),
    ("gpu_indexes_allocated", "TEXT"),
    ("drain", "INTEGER"),
    ("down", "INTEGER"),
    ("drain_reason", "TEXT"),
    ("drain_since", "TEXT"),
    ("partitions", "TEXT"),
    ("weight", "INTEGER"),
    ("boot_time", "TEXT"),
    ("slurmd_start_time", "TEXT"),
    ("os", "TEXT"),
    ("slurm_version", "TEXT"),
    ("running_jobs_count", "INTEGER"),
)


def migrate_node_snapshots(conn: sqlite3.Connection) -> None:
    """Adds schema-v3 columns to a node_snapshots table created under v2.

    No-op on a fresh database (CREATE TABLE above already includes every
    column) or on a database already migrated.
    """
    existing = {row["name"] for row in conn.execute("PRAGMA table_info(node_snapshots)")}
    for column, sql_type in NODE_SNAPSHOTS_V3_COLUMNS:
        if column not in existing:
            conn.execute(f"ALTER TABLE node_snapshots ADD COLUMN {column} {sql_type}")


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
    migrate_node_snapshots(conn)
    conn.execute(
        "INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schema_version', ?)",
        (str(SCHEMA_VERSION),),
    )
    conn.commit()


def record_collector_run(conn: sqlite3.Connection, collector: str, ok: bool, message: Optional[str] = None) -> None:
    """Upserts the Platform Status row for `collector` (docs/PLATFORM_STATUS.md).

    Only success/failure of *this* run is recorded here - staleness (a
    collector that keeps succeeding but hasn't run in 6+ hours) is judged
    later from last_success_at's age, not stored as a status string.
    """
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    existing = conn.execute(
        "SELECT last_success_at FROM collector_runs WHERE collector = ?", (collector,)
    ).fetchone()
    last_success_at = now if ok else (existing["last_success_at"] if existing else None)
    conn.execute(
        """
        INSERT INTO collector_runs (collector, last_attempt_at, last_success_at, status, message)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(collector) DO UPDATE SET
            last_attempt_at = excluded.last_attempt_at,
            last_success_at = excluded.last_success_at,
            status = excluded.status,
            message = excluded.message
        """,
        (collector, now, last_success_at, "healthy" if ok else "failed", message),
    )
    conn.commit()


def get_collector_run(conn: sqlite3.Connection, collector: str) -> Optional[dict]:
    row = conn.execute("SELECT * FROM collector_runs WHERE collector = ?", (collector,)).fetchone()
    return dict(row) if row is not None else None
