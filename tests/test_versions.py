"""The panel script must carry the same version as the manifest, and CHANGELOG.md must describe that version."""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "custom_components" / "electricity_optimizer"


def test_panel_js_version_matches_manifest():
    manifest = json.loads((ROOT / "manifest.json").read_text())
    js = (ROOT / "frontend" / "electricity-optimizer-panel.js").read_text()
    match = re.search(r'PANEL_JS_VERSION = "([^"]+)"', js)
    assert match, "PANEL_JS_VERSION missing in panel script"
    assert match.group(1) == manifest["version"]


def test_changelog_has_section_for_current_version():
    manifest = json.loads((ROOT / "manifest.json").read_text())
    changelog = (ROOT.parent.parent / "CHANGELOG.md").read_text(encoding="utf-8")
    match = re.search(rf"^## {re.escape(manifest['version'])}\n(.*?)(?=^## |\Z)", changelog, re.M | re.S)
    assert match and match.group(1).strip(), f"CHANGELOG.md has no notes for {manifest['version']}"
