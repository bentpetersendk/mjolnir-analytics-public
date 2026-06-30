from pathlib import Path
import json, os, sys, re
root = Path(__file__).resolve().parents[1]
paths = [
    root / 'sample-data' / 'index.json',
    root / 'sample-data' / 'global' / 'cluster_summary.json',
    root / 'sample-data' / 'global' / 'percentiles.json',
    root / 'private-user-data' / 'users' / 'mock-token-alex.json',
]
for path in paths:
    json.loads(path.read_text())

personal = json.loads((root / 'private-user-data' / 'users' / 'mock-token-alex.json').read_text())
assert personal['username'] == 'alex_mjolnir'
assert 'peer_comparisons' in personal
for peer in personal['peer_comparisons']:
    assert 'username' not in peer
    assert 'account' not in peer

print('validated', len(paths), 'sample/fixture json files')

# ---------------------------------------------------------------------------
# Analytics module (Version 1.2 migration, private repo's
# docs/architecture/ANALYTICS_WAREHOUSE.md Section 10). Live nightly export
# from the warehouse, published to dashboard-data the same way as every
# other module - see private repo's scripts/export_analytics_data.py /
# validate_analytics_export.py for the source-of-truth checks; this is the
# public-repo-side companion: per-job cost-bearer invariants plus the same
# cluster-equals-sum-of-users / percentile-monotonicity / project-coverage
# reconciliation checks, run against whatever copy of the live export this
# checkout has on disk (override via MJOLNIR_ANALYTICS_DATA_DIR for CI/local
# testing against a non-default location; SKIP gracefully if absent, same
# posture as the Node Insights history block below).
# ---------------------------------------------------------------------------
ANALYTICS_DIR = Path(os.environ.get('MJOLNIR_ANALYTICS_DATA_DIR') or (root / 'data' / 'analytics'))
ANALYTICS_FORBIDDEN_PATTERN = re.compile(
    r'"(User|JobName|WorkDir|Account|user_token|username|job_id|jobid|NodeList|personal_route_token)"\s*:'
)

if not (ANALYTICS_DIR / 'global' / 'cluster_summary.json').exists():
    print(f'SKIPPED Analytics export validation: {ANALYTICS_DIR} not found.')
else:
    TOL = 0.02  # rounded-export tolerance (2 decimal places)
    AGG_TOL = 2.0  # DKK; sum of up to several hundred values each rounded to 2 decimals

    for jsonpath in (ANALYTICS_DIR / 'index.json', ANALYTICS_DIR / 'global' / 'cluster_summary.json',
                     ANALYTICS_DIR / 'global' / 'percentiles.json'):
        text = jsonpath.read_text()
        assert not ANALYTICS_FORBIDDEN_PATTERN.search(text), f'forbidden field pattern found in {jsonpath}'
        json.loads(text)

    cluster = json.loads((ANALYTICS_DIR / 'global' / 'cluster_summary.json').read_text())
    coverage = cluster.get('measurement_coverage', {})
    cluster_at = cluster['cluster_all_time_summary']
    cluster_waste = cluster_at.get('cost_bearer_waste_dkk') or 0.0
    cluster_cost = cluster_at.get('estimated_cost_dkk') or 0.0
    cluster_jobs = cluster_at.get('jobs') or 0

    def check_job(job):
        est = job.get('estimated_cost_dkk')
        gpu = job.get('gpu_cost_dkk')
        cb_cost = job.get('cost_bearer_cost_dkk')
        cb_waste = job.get('cost_bearer_waste_dkk')
        under = job.get('underutilized_cost_dkk')
        if None not in (est, gpu, cb_cost):
            # 1. cost_bearer_cost == estimated_cost - gpu_cost
            assert abs(cb_cost - (est - gpu)) <= TOL, f'bearer-cost identity: {job}'
        if cb_waste is not None and cb_cost is not None:
            # 2. 0 <= cost_bearer_waste <= cost_bearer_cost
            assert -TOL <= cb_waste <= cb_cost + TOL, f'waste bound: {job}'
        # 3. underutilized == cost_bearer_waste (alias), incl. matching nulls
        assert (under is None) == (cb_waste is None), f'alias null mismatch: {job}'
        if under is not None and cb_waste is not None:
            assert abs(under - cb_waste) <= TOL, f'alias value mismatch: {job}'
        # 4. gpu_waste is exported as null, never a number
        assert job.get('gpu_waste_dkk', None) is None, f'gpu_waste must be null: {job}'

    user_files = sorted((ANALYTICS_DIR / 'users').glob('*.json'))
    user_waste = user_cost = 0.0
    user_jobs = 0
    for uf in user_files:
        bundle = json.loads(uf.read_text())
        for job in bundle.get('top_inefficient_jobs', []):
            check_job(job)
        s = bundle.get('all_time_summary', {})
        user_waste += s.get('cost_bearer_waste_dkk') or 0.0
        user_cost += s.get('estimated_cost_dkk') or 0.0
        user_jobs += s.get('jobs') or 0

    assert abs(user_waste - cluster_waste) <= AGG_TOL, (
        f'SUM(user waste) {user_waste:.2f} != cluster/export waste {cluster_waste:.2f}')
    assert abs(user_cost - cluster_cost) <= AGG_TOL, (
        f'SUM(user cost) {user_cost:.2f} != cluster/export cost {cluster_cost:.2f}')
    assert user_jobs == cluster_jobs, (
        f'SUM(user jobs) {user_jobs} != cluster jobs {cluster_jobs}')

    # Percentile monotonicity (5/25/50/75/95, per field, non-decreasing).
    percentiles_doc = json.loads((ANALYTICS_DIR / 'global' / 'percentiles.json').read_text())
    for field, buckets in percentiles_doc.get('percentiles', {}).items():
        values = [buckets[b] for b in ('5', '25', '50', '75', '95')]
        assert values == sorted(values), f'percentiles not monotonic for {field}: {values}'

    # Project reconciliation. Projects only cover WorkDir-assigned jobs (>=97%,
    # scoped to the workdir-capture era - see the reconciliation report);
    # home-directory / other-path jobs belong to no project. SUM(project waste)
    # must never exceed the cluster total (that would mean double counting).
    projects_doc = json.loads((ANALYTICS_DIR / 'global' / 'projects.json').read_text())
    proj_waste = sum((p['all_time_summary'].get('cost_bearer_waste_dkk') or 0.0)
                     for p in projects_doc['projects'])
    proj_cost = sum((p['all_time_summary'].get('estimated_cost_dkk') or 0.0)
                    for p in projects_doc['projects'])
    cov = projects_doc.get('coverage', {})
    total_rows = cov.get('job_metrics_rows') or 0
    assigned_rows = cov.get('assigned_project_rows') or 0
    assert proj_waste <= cluster_waste + AGG_TOL, (
        f'SUM(project waste) {proj_waste:.2f} exceeds cluster waste {cluster_waste:.2f} '
        f'(double counting?)')
    assert proj_cost <= cluster_cost + AGG_TOL, (
        f'SUM(project cost) {proj_cost:.2f} exceeds cluster cost {cluster_cost:.2f}')
    assert total_rows and assigned_rows / total_rows >= 0.97, (
        f'project coverage regressed: {assigned_rows}/{total_rows}')
    unassigned_waste = cluster_waste - proj_waste
    unassigned_cost = cluster_cost - proj_cost
    assert unassigned_waste >= -AGG_TOL, f'negative unassigned waste {unassigned_waste:.2f}'
    assert unassigned_cost >= -AGG_TOL, f'negative unassigned cost {unassigned_cost:.2f}'

    print(f'Analytics export OK: cluster waste {cluster_waste:,.2f} DKK '
          f'== SUM(user) {user_waste:,.2f}; SUM(project) {proj_waste:,.2f} '
          f'+ unassigned {unassigned_waste:,.2f} '
          f'(coverage {assigned_rows}/{total_rows} = {100*assigned_rows/total_rows:.2f}%)')

# ---------------------------------------------------------------------------
# Node Insights. Public-safe Slurm-derived node/cluster views, generated
# hourly from data/node_insights.sqlite by scripts/export_node_insights.py
# and published to the dashboard-data repo (see
# docs/DASHBOARD_DATA_MIGRATION.md) - node_insights.json is the single live
# source of truth for Cluster Overview, Node Inventory, Hardware Inventory,
# and Capacity Planning; this repo no longer ships any static node_insights
# JSON of its own. No Airtable, no usernames, no JobName/WorkDir/Account, no
# raw job IDs anywhere in this export tree.
# ---------------------------------------------------------------------------
NI_FORBIDDEN_KEYS = ('User', 'JobName', 'WorkDir', 'Account', 'user_token', 'username')
NI_FORBIDDEN_TEXT_PATTERNS = (
    re.compile(r'"(User|JobName|WorkDir|Account)"\s*:'),
)


def ni_assert_public_safe(obj, path='<root>'):
    if isinstance(obj, dict):
        for key, value in obj.items():
            assert key not in NI_FORBIDDEN_KEYS, f'forbidden field "{key}" found at {path}'
            ni_assert_public_safe(value, f'{path}.{key}')
    elif isinstance(obj, list):
        for i, item in enumerate(obj):
            ni_assert_public_safe(item, f'{path}[{i}]')


# ---------------------------------------------------------------------------
# Node Insights history (Phase 2: persistent historical monitoring). Public
# JSON generated from data/node_insights.sqlite by
# scripts/export_node_insights.py. Aggregate-only - same forbidden-field
# guardrails as above, plus structural checks on the live snapshot's nested
# sections and the time-series shape.
# ---------------------------------------------------------------------------
NI_HISTORY_DIR = root / 'site' / 'data'
ni_history_files = {
    'node_insights': NI_HISTORY_DIR / 'node_insights.json',
    'capacity_history': NI_HISTORY_DIR / 'capacity_history.json',
    'node_history': NI_HISTORY_DIR / 'node_history.json',
}
missing_history = [name for name, p in ni_history_files.items() if not p.exists()]
if missing_history:
    print(f'SKIPPED Node Insights history validation: missing {missing_history}.')
else:
    ni_history_docs = {}
    for name, p in ni_history_files.items():
        text = p.read_text()
        for pattern in NI_FORBIDDEN_TEXT_PATTERNS:
            assert not pattern.search(text), f'forbidden field pattern found in {p}'
        ni_history_docs[name] = json.loads(text)
        ni_assert_public_safe(ni_history_docs[name], str(p.name))

    capacity_points = ni_history_docs['capacity_history'].get('points', [])
    REQUIRED_CAPACITY_KEYS = {
        'timestamp', 'total_nodes', 'available_nodes', 'draining_nodes', 'down_nodes',
        'cpu_pct', 'memory_pct', 'gpu_pct', 'running_jobs', 'pending_jobs',
    }
    for point in capacity_points:
        assert REQUIRED_CAPACITY_KEYS.issubset(point.keys()), f'capacity_history point missing keys: {point}'

    node_history_nodes = ni_history_docs['node_history'].get('nodes', [])
    for node_entry in node_history_nodes:
        assert 'node_name' in node_entry and 'points' in node_entry, f'node_history entry malformed: {node_entry}'
        for point in node_entry['points']:
            assert {'timestamp', 'state', 'cpu_pct', 'mem_pct', 'gpu_pct'}.issubset(point.keys()), (
                f'node_history point missing keys: {point}')

    node_insights_doc = ni_history_docs['node_insights']
    node_inventory = node_insights_doc.get('node_inventory', {})
    nodes = node_inventory.get('nodes', [])
    assert node_inventory.get('node_count') == len(nodes), 'node_inventory.node_count mismatch with nodes[] length'

    cluster_overview = node_insights_doc.get('cluster_overview', {})
    co_totals = cluster_overview.get('totals', {})
    assert co_totals.get('nodes_total') == len(nodes), 'cluster_overview totals.nodes_total mismatch with node_inventory'

    gpu_total_from_inventory = sum(n.get('gpu_total') or 0 for n in nodes)
    gpu_alloc_from_inventory = sum(n.get('gpu_alloc') or 0 for n in nodes)
    co_gpu = cluster_overview.get('gpu', {})
    assert co_gpu.get('total') == gpu_total_from_inventory, 'cluster_overview GPU total mismatch with node_inventory'
    assert co_gpu.get('alloc') == gpu_alloc_from_inventory, 'cluster_overview GPU alloc mismatch with node_inventory'

    print(f'Node Insights history export OK: {len(capacity_points)} capacity points, '
          f'{len(node_history_nodes)} nodes, no forbidden fields, '
          f'GPU {gpu_alloc_from_inventory}/{gpu_total_from_inventory} from sinfo GresUsed')

# ---------------------------------------------------------------------------
# Queue Insights, live half (docs/architecture/QUEUE_INSIGHTS_ARCHITECTURE.md).
# Generated hourly from data/node_insights.sqlite by export_node_insights.py,
# alongside the Node Insights exports above - same forbidden-field
# guardrails, plus structural checks on the queue_health scoring output and
# the full-history (not latest-only) shape of partition/pending-reason data.
# ---------------------------------------------------------------------------
QI_DIR = NI_HISTORY_DIR / 'queue_insights'
qi_files = {
    'current_pressure': QI_DIR / 'current_pressure.json',
    'partition_pressure': QI_DIR / 'partition_pressure.json',
    'pending_reasons': QI_DIR / 'pending_reasons.json',
    'queue_health_history': QI_DIR / 'queue_health_history.json',
}
missing_qi = [name for name, p in qi_files.items() if not p.exists()]
if missing_qi:
    print(f'SKIPPED Queue Insights validation: missing {missing_qi}.')
else:
    qi_docs = {}
    for name, p in qi_files.items():
        text = p.read_text()
        for pattern in NI_FORBIDDEN_TEXT_PATTERNS:
            assert not pattern.search(text), f'forbidden field pattern found in {p}'
        qi_docs[name] = json.loads(text)
        ni_assert_public_safe(qi_docs[name], str(p.name))

    QUEUE_HEALTH_LABELS = {'Healthy', 'Busy', 'Congested', 'Severely Congested'}
    current_pressure = qi_docs['current_pressure']
    health = current_pressure.get('queue_health')
    if health is not None:
        assert health['label'] in QUEUE_HEALTH_LABELS, f'unknown Queue Health label: {health["label"]}'
        assert 0 <= health['score'] <= 100, f'Queue Health score out of range: {health["score"]}'

    partition_pressure_points = qi_docs['partition_pressure'].get('points', [])
    for point in partition_pressure_points:
        assert {'timestamp', 'partition', 'running', 'pending'}.issubset(point.keys()), (
            f'partition_pressure point missing keys: {point}')
    # Diagnostic, not a hard failure (a brand-new collector may legitimately
    # have only one hour of history yet): full-history exports should have
    # more than one distinct timestamp once more than an hour has elapsed.
    distinct_pp_timestamps = {p['timestamp'] for p in partition_pressure_points}
    if len(partition_pressure_points) > 0 and len(distinct_pp_timestamps) == 1:
        print('NOTE: partition_pressure.json currently has only one distinct timestamp '
              '(expected once more than one hourly collection has run)')

    pending_reasons_points = qi_docs['pending_reasons'].get('points', [])
    for point in pending_reasons_points:
        assert {'timestamp', 'reason', 'count'}.issubset(point.keys()), (
            f'pending_reasons point missing keys: {point}')

    queue_health_points = qi_docs['queue_health_history'].get('points', [])
    for point in queue_health_points:
        assert {'timestamp', 'score', 'label', 'components'}.issubset(point.keys()), (
            f'queue_health_history point missing keys: {point}')
        assert point['label'] in QUEUE_HEALTH_LABELS, f'unknown Queue Health label: {point["label"]}'
        assert 0 <= point['score'] <= 100, f'Queue Health score out of range: {point["score"]}'

    print(f'Queue Insights export OK: {len(partition_pressure_points)} partition-pressure points, '
          f'{len(pending_reasons_points)} pending-reason points, {len(queue_health_points)} queue-health points, '
          f'no forbidden fields')
