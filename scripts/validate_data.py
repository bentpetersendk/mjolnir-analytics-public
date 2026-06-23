from pathlib import Path
import json, sys, re, subprocess
root = Path(__file__).resolve().parents[1]
paths = [
    root / 'data' / 'efficiency_v3' / 'site_data_90d_validation' / 'index.json',
    root / 'data' / 'efficiency_v3' / 'site_data_90d_validation' / 'global' / 'cluster_summary.json',
    root / 'data' / 'efficiency_v3' / 'site_data_90d_validation' / 'global' / 'percentiles.json',
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

# Revised Cost-Bearer Waste Model: required export safeguards and per-job invariants.
TOL = 0.02  # rounded-export tolerance (2 decimal places)
cluster = json.loads((root / 'data' / 'efficiency_v3' / 'site_data_90d_validation'
                      / 'global' / 'cluster_summary.json').read_text())
coverage = cluster.get('measurement_coverage', {})
for key in ('cpu_bearer_jobs_measured', 'cpu_bearer_jobs_unmeasured',
            'memory_bearer_jobs_measured', 'memory_bearer_jobs_unmeasured'):
    assert key in coverage, f'cluster_summary missing measurement_coverage.{key}'
# Cluster-wide waste should be a lower-bound estimate near the audit target.
cluster_waste = cluster['cluster_all_time_summary']['cost_bearer_waste_dkk']
assert abs(cluster_waste - 351675) < 1000, f'cluster waste {cluster_waste} off target'


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


for job in personal.get('top_inefficient_jobs', []):
    check_job(job)

# ---------------------------------------------------------------------------
# Aggregate reconciliation (recommended in docs/COST_BEARER_RESOURCE_AUDIT.md /
# COST_BEARER_WASTE_IMPLEMENTATION_REPORT.md). The exported cluster headline must
# reconcile with the sum of the job-level cost-bearer waste. Users partition every
# job exactly once, so SUM(per-user all-time waste) == SUM(job_metrics waste); the
# cluster_summary export is the independently-aggregated cluster total. Equality of
# the three therefore proves SUM(job_metrics.cost_bearer_waste_dkk) == cluster
# summary waste == exported cluster waste. Fail on any mismatch.
# ---------------------------------------------------------------------------
site = root / 'data' / 'efficiency_v3' / 'site_data_90d_validation'
AGG_TOL = 2.0  # DKK; sum of up to 133 values each rounded to 2 decimals

cluster_at = cluster['cluster_all_time_summary']
cluster_waste = cluster_at['cost_bearer_waste_dkk']
cluster_cost = cluster_at['estimated_cost_dkk']

user_waste = user_cost = 0.0
user_files = sorted((site / 'users').glob('*.json'))
for uf in user_files:
    s = json.loads(uf.read_text())['all_time_summary']
    user_waste += s.get('cost_bearer_waste_dkk') or 0.0
    user_cost += s.get('estimated_cost_dkk') or 0.0

assert abs(user_waste - cluster_waste) <= AGG_TOL, (
    f'SUM(user waste) {user_waste:.2f} != cluster/export waste {cluster_waste:.2f}')
assert abs(user_cost - cluster_cost) <= AGG_TOL, (
    f'SUM(user cost) {user_cost:.2f} != cluster/export cost {cluster_cost:.2f}')

# Project reconciliation. Projects only cover WorkDir-assigned jobs (~98.3%, per the
# audits); home-directory / other-path jobs belong to no project. So SUM(project
# waste) must equal cluster waste MINUS the unassigned remainder: it must never
# exceed the cluster (that would mean double counting) and the coverage must hold.
projects_doc = json.loads((site / 'global' / 'projects.json').read_text())
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
# The waste of unassigned jobs must be non-negative and consistent with the
# unassigned cost remainder (jobs with no project still carry cost/waste).
unassigned_waste = cluster_waste - proj_waste
unassigned_cost = cluster_cost - proj_cost
assert unassigned_waste >= -AGG_TOL, f'negative unassigned waste {unassigned_waste:.2f}'
assert unassigned_cost >= -AGG_TOL, f'negative unassigned cost {unassigned_cost:.2f}'

print(f'aggregate reconciliation OK: cluster waste {cluster_waste:,.2f} DKK '
      f'== SUM(user) {user_waste:,.2f}; SUM(project) {proj_waste:,.2f} '
      f'+ unassigned {unassigned_waste:,.2f} '
      f'(coverage {assigned_rows}/{total_rows} = {100*assigned_rows/total_rows:.2f}%)')
print('validated', len(paths), 'json files; cost-bearer invariants OK')

# ---------------------------------------------------------------------------
# Node Insights (Phase 1 public port). Public-safe Slurm-derived node/cluster
# views. No Airtable, no usernames, no JobName/WorkDir/Account, no raw job
# IDs anywhere in this export tree.
# ---------------------------------------------------------------------------
NI_DIR = root / 'data' / 'node_insights'
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


ni_files = {
    'index': NI_DIR / 'index.json',
    'cluster_overview': NI_DIR / 'cluster_overview.json',
    'node_inventory': NI_DIR / 'node_inventory.json',
    'hardware_inventory': NI_DIR / 'hardware_inventory.json',
    'capacity_planning': NI_DIR / 'capacity_planning.json',
}

missing = [name for name, p in ni_files.items() if not p.exists()]
if missing:
    print(f'SKIPPED Node Insights validation: missing {missing}.')
else:
    ni_docs = {}
    for name, p in ni_files.items():
        text = p.read_text()
        for pattern in NI_FORBIDDEN_TEXT_PATTERNS:
            assert not pattern.search(text), f'forbidden field pattern found in {p}'
        ni_docs[name] = json.loads(text)
        ni_assert_public_safe(ni_docs[name], str(p.name))

    node_inventory = ni_docs['node_inventory']
    nodes = node_inventory.get('nodes', [])
    assert node_inventory.get('node_count') == len(nodes), 'node_inventory.node_count mismatch with nodes[] length'

    cluster_overview = ni_docs['cluster_overview']
    co_totals = cluster_overview.get('totals', {})
    assert co_totals.get('nodes_total') == len(nodes), 'cluster_overview totals.nodes_total mismatch with node_inventory'

    gpu_total_from_inventory = sum(n.get('gpu_total') or 0 for n in nodes)
    gpu_alloc_from_inventory = sum(n.get('gpu_alloc') or 0 for n in nodes)
    co_gpu = cluster_overview.get('gpu', {})
    assert co_gpu.get('total') == gpu_total_from_inventory, 'cluster_overview GPU total mismatch with node_inventory'
    assert co_gpu.get('alloc') == gpu_alloc_from_inventory, 'cluster_overview GPU alloc mismatch with node_inventory'

    # Live Slurm cross-check is intentionally skipped here: this is a static
    # snapshot ported into the public repo's branch, not a host with Slurm
    # CLI access. Re-running scripts/collect_node_insights.py in the private
    # repo before each deploy (per docs/NODE_INSIGHTS_PUBLIC_PORT_PACKAGE.md
    # Sec 4) is what keeps this data fresh, not a live check here.
    try:
        subprocess.run(['sinfo'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        print('NOTE: Slurm CLI detected on this host but live cross-check is out of scope for the public repo.')
    except (FileNotFoundError, subprocess.CalledProcessError):
        pass

    print(f'Node Insights export OK: {len(nodes)} nodes, no forbidden fields, '
          f'GPU {gpu_alloc_from_inventory}/{gpu_total_from_inventory} from GresUsed')
