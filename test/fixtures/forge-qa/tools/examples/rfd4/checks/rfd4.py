#!/usr/bin/env python3
"""Inspect native RFd4 structures and required per-example metric values.

The public functions are reusable by mode-specific checks. They report the
observed structure/metrics; they do not declare scientific qualification.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
from pathlib import Path
from typing import Iterable


def read_structure(path: Path):
    """Return the native AtomWorks array, including standard RFd4 annotations."""
    import numpy as np
    from atomworks.io import parse
    from rfproteina.utils.parse_presets import ANNOTATED_CIF

    array = parse(path, config=ANNOTATED_CIF)["assemblies"]["1"][0]
    if len(array) == 0 or array.coord.shape != (len(array), 3) or not np.isfinite(array.coord).all():
        raise ValueError(f"Empty structure or nonfinite coordinates: {path}")
    return array


def inspect_structure(path: Path) -> dict:
    """Check finite coordinates and return basic atom, chain and residue identity."""
    array = read_structure(path)
    residues: dict[tuple[str, int, str], str] = {}
    chains: list[str] = []
    for chain, number, insertion, name in zip(array.chain_id, array.res_id, array.ins_code, array.res_name):
        chain, number, insertion, name = str(chain), int(number), str(insertion), str(name)
        if not chain or not name:
            raise ValueError(f"Missing chain or residue identity: {path}")
        key = (chain, number, insertion)
        if key in residues and residues[key] != name:
            raise ValueError(f"Conflicting residue identity: {path}")
        residues[key] = name
        if chain not in chains:
            chains.append(chain)
    return {"path": str(path), "atoms": len(array), "chains": chains, "residues": len(residues)}


def read_metrics(path: Path, required: Iterable[str] = (), *,
                 example_ids: Iterable[str] | None = None) -> list[dict[str, str]]:
    """Require one finite metric row for each selected native example.

    A combined CSV can contain other inputs or search checkpoints with different
    metric providers. Check required values only for the requested examples.
    """
    required = tuple(required)
    with path.open(newline="") as handle:
        reader = csv.DictReader(handle)
        fields = reader.fieldnames or []
        if len(fields) != len(set(fields)) or "example_id" not in fields:
            raise ValueError(f"Invalid native metric columns: {path}")
        missing = set(required) - set(fields)
        if missing:
            raise ValueError(f"Missing required metric columns: {sorted(missing)}")
        rows = list(reader)
    if not rows or any(not row.get("example_id") for row in rows):
        raise ValueError(f"Missing native metric rows or example IDs: {path}")
    if example_ids is not None:
        selected = set(example_ids)
        if not selected:
            raise ValueError("Metric validation needs at least one example ID")
        rows = [row for row in rows if row["example_id"] in selected]
        absent = selected - {row["example_id"] for row in rows}
        if absent:
            raise ValueError(f"Missing metric rows for examples: {sorted(absent)}")
    identities = [row["example_id"] for row in rows]
    if len(identities) != len(set(identities)):
        raise ValueError(f"Ambiguous duplicate metric example IDs: {path}")
    for row in rows:
        for key in required:
            value = row.get(key, "")
            try:
                number = float(value)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"Missing or nonnumeric {key} for {row['example_id']}") from exc
            if not math.isfinite(number):
                raise ValueError(f"Nonfinite {key} for {row['example_id']}")
    return rows


def inspect_run(run_dir: Path, expected_count: int | None = None,
                metrics_path: Path | None = None, required_metrics: Iterable[str] = ()) -> dict:
    """Discover native generated CIFs in all supported encodings."""
    from rfproteina.utils.structure_files import iter_structure_files, structure_file_stem

    paths = list(iter_structure_files(run_dir / "inference_samples", stem_suffix="_generated"))
    if not paths or (expected_count is not None and len(paths) != expected_count):
        raise ValueError(f"Generated structure count {len(paths)} does not match expectation {expected_count}")
    result = {"structures": [inspect_structure(path) for path in paths]}
    required_metrics = tuple(required_metrics)
    if required_metrics and metrics_path is None:
        raise ValueError("Required metrics need an explicit native metrics CSV")
    if metrics_path is not None:
        identities = [structure_file_stem(path).removesuffix("_generated") for path in paths]
        if len(identities) != len(set(identities)):
            raise ValueError("Generated structures have ambiguous duplicate example IDs")
        rows = read_metrics(metrics_path, required_metrics, example_ids=identities)
        result["metric_rows"] = len(rows)
        result["required_metrics"] = list(required_metrics)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_dir", type=Path)
    parser.add_argument("--expected-count", type=int)
    parser.add_argument("--metrics-csv", type=Path)
    parser.add_argument("--require-metric", action="append", default=[])
    args = parser.parse_args()
    print(json.dumps(inspect_run(args.run_dir, args.expected_count, args.metrics_csv, args.require_metric), indent=2))


if __name__ == "__main__":
    main()
