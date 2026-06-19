from pathlib import Path
import json, sys
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
assert personal['username'] == 'demo_user'
assert personal['display_pseudonym'] == 'Silver Falcon'
assert len(personal['peer_comparisons']) == 3
print('validated', len(paths), 'json files')
