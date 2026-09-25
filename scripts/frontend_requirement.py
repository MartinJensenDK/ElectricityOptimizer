"""Print the home-assistant-frontend requirement matching the installed HA version.

The test suite loads the frontend component (needed for panel registration), and that
package is not pulled in by pytest-homeassistant-custom-component.
Usage: pip install "$(python scripts/frontend_requirement.py)"
"""

import json
from pathlib import Path

import homeassistant.components.frontend as frontend

manifest = json.loads((Path(frontend.__file__).parent / "manifest.json").read_text())
print(next(r for r in manifest["requirements"] if r.startswith("home-assistant-frontend")))
