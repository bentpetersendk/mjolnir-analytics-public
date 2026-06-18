from pathlib import Path
root = Path(__file__).resolve().parents[1]
app = (root / 'js' / 'app.js').read_text()
loader = (root / 'js' / 'data-loader.js').read_text()
assert "loadMjolnirData" in app
assert "fetch(" in loader
assert "sourcePath" in loader
print('ui checks passed')
