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
]
for path in paths:
    json.loads(path.read_text())
print('validated', len(paths), 'json files')
