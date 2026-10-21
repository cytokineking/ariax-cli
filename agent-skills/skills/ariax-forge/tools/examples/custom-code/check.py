"""Check actual custom-code outputs, including output after environment recreation."""
from __future__ import annotations

import json
import sys
from pathlib import Path

expected = {"label": "project-local", "records": {"target": {"length": 8, "gc_fraction": 0.5}, "control": {"length": 8, "gc_fraction": 0.0}}}
for argument in sys.argv[1:]:
    if json.loads(Path(argument).read_text()) != expected:
        raise SystemExit(f"Unexpected custom-code result: {argument}")
if len(sys.argv) < 2:
    raise SystemExit("Supply at least one output path")
print("Custom-code output passed")
