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
print('validated', len(paths), 'json files')
