#!/usr/bin/env python3
"""Check native Boltz2 affinity JSON values and input-derived filename offline."""
import argparse
import json
import math
from pathlib import Path
import re


def number(data: dict, key: str, probability: bool = False) -> float:
    value = data[key]
    if type(value) not in (int, float) or not math.isfinite(value):
        raise ValueError(key + " must be a finite JSON number")
    if probability and not 0 <= value <= 1:
        raise ValueError(key + " must be in [0, 1]")
    return value


def check(path: str, record_id: str) -> dict:
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", record_id) or record_id in (".", ".."):
        raise ValueError("record_id must be the native input record name")
    path = Path(path)
    if path.name != f"affinity_{record_id}.json":
        raise ValueError("affinity filename does not match input record_id")
    data = json.loads(path.read_text())
    if not isinstance(data, dict):
        raise ValueError("affinity output must be a JSON object")
    value = number(data, "affinity_pred_value")
    probability = number(data, "affinity_probability_binary", probability=True)
    component_keys = [key + suffix for suffix in ("1", "2")
                      for key in ("affinity_pred_value", "affinity_probability_binary")]
    components = {}
    if any(key in data for key in component_keys):
        for key in component_keys:
            components[key] = number(data, key, probability="probability" in key)
    return {
        "record_id": record_id,
        "affinity_pred_value": value,
        "value_units": "log10(IC50 in micromolar)",
        "predicted_pIC50": 6 - value,
        "affinity_probability_binary": probability,
        "ensemble_components": components,
        "limit": "output consistency only; verify chemistry and originating run separately",
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", help="native affinity_<record_id>.json")
    parser.add_argument("--record-id", required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(check(args.output, args.record_id), allow_nan=False))
    except (ValueError, KeyError, OSError, TypeError, OverflowError) as exc:
        parser.exit(2, f"affinity check rejected: {exc}\n")
