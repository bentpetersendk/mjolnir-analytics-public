from pathlib import Path
import json, sys
root = Path(__file__).resolve().parents[1]
paths = [
    root / 'sample-data' / 'index.json',
    root / 'sample-data' / 'global' / 'cluster_summary.json',
    root / 'sample-data' / 'global' / 'percentiles.json',
]
for path in paths:
    json.loads(path.read_text())
print('validated', len(paths), 'json files')
