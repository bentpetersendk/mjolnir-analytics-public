from pathlib import Path
import json, sys
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
