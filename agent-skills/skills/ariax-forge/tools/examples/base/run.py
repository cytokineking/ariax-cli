"""Copy a staged text input into an inspectable workspace result."""
from __future__ import annotations

import json
import sys
from pathlib import Path

source, destination = map(Path, sys.argv[1:])
text = source.read_text()
destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_text(json.dumps({"text": text, "line_count": len(text.splitlines())}) + "\n")
print(destination)
