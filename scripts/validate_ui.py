from pathlib import Path
root = Path(__file__).resolve().parents[1]
app = (root / 'js' / 'app.js').read_text()
loader = (root / 'js' / 'data-loader.js').read_text()
assert "loadMjolnirData" in app
assert "loadPersonalData" in app
assert "Prototype Personal Dashboard - Authentication Not Yet Enabled" in app
assert "fetch(" in loader
assert "loadPersonalData" in loader
assert "normalizePersonalUserViewModel" in loader
assert "sourcePath" in loader
assert "user_token" not in app
assert "WorkDir" not in app
print('ui checks passed')
