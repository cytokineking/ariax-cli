#!/usr/bin/env python3
"""Check a deliberately rejected RFd4 evaluation retains its actual input."""
from __future__ import annotations

import argparse
import csv
import filecmp
import json
import math
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--run-dir", type=Path, required=True)
    args = parser.parse_args()
    with (args.run_dir / "evaluation_metrics/per_example_metrics.csv").open(newline="") as handle:
        rows = list(csv.DictReader(handle))
    if len(rows) != 1:
        raise ValueError("Expected one evaluated negative-control design")
    row = rows[0]
    key = "amino_acid_composition.n_generated_unknown_residues"
    count, passed = float(row[key]), float(row["pre_oracle_pass"])
    if not math.isfinite(count) or count < 0 or passed != 0:
        raise ValueError("The deliberately impossible threshold did not reject a measured nonnegative count")
    copies = [path for path in (args.run_dir / "evaluation_samples").rglob(args.source.name)
              if path.is_file() and not path.is_symlink()]
    if len(copies) != 1 or not filecmp.cmp(args.source, copies[0], shallow=False):
        raise ValueError("The rejected evaluation sidecar is absent, linked or differs from the source")
    if any(path.is_symlink() for path in args.run_dir.rglob("*")):
        raise ValueError("A symlink remains in the retained run")
    print(json.dumps({"source": str(args.source), "rejected": True, "measured_unknown_residues": count,
                      "retained_sidecar": str(copies[0]), "scope": "one explicit negative filter control"}, indent=2))


if __name__ == "__main__":
    main()
