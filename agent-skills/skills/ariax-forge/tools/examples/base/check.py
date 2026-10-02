"""Check the base fixture's actual result."""
from __future__ import annotations

import json
import sys
from pathlib import Path

result = json.loads(Path(sys.argv[1]).read_text())
if result != {"text": "Forge base fixture\n", "line_count": 1}:
    raise SystemExit(f"Unexpected base result: {result!r}")
print("Base output passed")
