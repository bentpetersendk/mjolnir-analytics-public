from pathlib import Path

root = Path(__file__).resolve().parents[1]
app = (root / 'js' / 'app.js').read_text()
loader = (root / 'js' / 'data-loader.js').read_text()
index = (root / 'index.html').read_text()

assert 'loadMjolnirData' in app
assert 'fetch(' in loader
assert 'sourcePath' in loader

production_ui = '\n'.join([index, app, loader]).lower()
for forbidden in [
    'placeholder',
    'sample benchmark',
    'regression score placeholder',
    'fake chart',
    'demo users',
]:
    assert forbidden not in production_ui, f'production UI contains forbidden placeholder text: {forbidden}'

print('ui checks passed')
