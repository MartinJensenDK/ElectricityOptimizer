"""The panel script must carry the same version as the manifest (cache-busting + stale banner)."""

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
