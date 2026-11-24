"""Inspect scorer output. Real predictor qualification also retains the raw handoff."""
from __future__ import annotations

import argparse
import itertools
import json
import math
from pathlib import Path


def inspect(path: Path, require_available: bool = False) -> dict:
    result = json.loads(path.read_text())
    chains = result["selected_chains"]
    expected = set(itertools.permutations(chains, 2))
    pairs = result["pairs"]
    observed = [(pair["reference_chain"], pair["partner_chain"]) for pair in pairs]
    if set(observed) != expected or len(observed) != len(expected):
        raise ValueError("Missing, duplicated or mislabeled directional pairs")
    if not result["prediction"]["sample"] or not result["residues"]:
        raise ValueError("Missing sample/residue identity")
    unavailable = []
    for pair in pairs:
        if set(pair["metrics"]) != {"ipSAE", "pDockQ", "pDockQ2", "LIS"}:
            raise ValueError("Missing interface metrics")
        for name, item in pair["metrics"].items():
            value = item["value"]
            if value is None:
                if item["status"] != "unavailable" or not item["reason"]:
                    raise ValueError("Unlabeled unavailable metric")
                unavailable.append([pair["reference_chain"], pair["partner_chain"], name, item["reason"]])
            elif type(value) not in (float, int) or not math.isfinite(value) or value < 0 or item["status"] != "available":
                raise ValueError("Invalid numeric metric")
    if require_available and (not pairs or unavailable):
        raise ValueError("Native complete-interface gate requires all four scores in both directions")
    if not pairs and set(result["unavailable"].values()) != {"no_protein_interface"}:
        raise ValueError("Unlabeled monomer/no-interface output")
    return {"predictor": result["predictor"], "sample": result["prediction"]["sample"],
            "pairs": len(pairs), "residues": len(result["residues"]), "unavailable": unavailable}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("result", type=Path)
    parser.add_argument("--require-available", action="store_true")
    args = parser.parse_args()
    try:
        print(json.dumps(inspect(args.result, args.require_available)))
    except (KeyError, ValueError, TypeError, OSError) as exc:
        parser.exit(1, f"interface score output rejected: {exc}\n")
