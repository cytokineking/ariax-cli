"""Small custom DNA composition tool with an explicitly installed dependency."""
from __future__ import annotations

import json
import sys
from pathlib import Path

from fixture_stats import composition

LABEL = "upstream"

source, destination = map(Path, sys.argv[1:])
records = {}
name = None
for line in source.read_text().splitlines():
    if line.startswith(">"):
        name = line[1:]
        if not name or name in records:
            raise ValueError("FASTA identifiers must be nonempty and distinct")
        records[name] = ""
    elif line.strip():
        if name is None:
            raise ValueError("Sequence needs a FASTA identifier")
        records[name] += line.strip().upper()
if not records:
    raise ValueError("No sequences")
result = {"label": LABEL, "records": {name: composition(sequence) for name, sequence in records.items()}}
destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_text(json.dumps(result, indent=2) + "\n")
print(destination)
