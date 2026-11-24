#!/usr/bin/env python3
"""Compare captured Hydra settings before and after an explicit RFd4 continuation."""
from __future__ import annotations
import argparse
from copy import deepcopy
import json
from pathlib import Path
import yaml


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--initial-run", type=Path, required=True)
    parser.add_argument("--resume-run", type=Path, required=True)
    parser.add_argument("--resume-path", required=True)
    parser.add_argument("--resume-seed", type=int, required=True)
    args = parser.parse_args()

    def load(run: Path) -> dict:
        with (run / "ariax_provenance/config.resolved-at-capture.yaml").open() as handle:
            value = yaml.safe_load(handle)
        if not isinstance(value, dict):
            raise ValueError("Captured Hydra configuration is not a mapping")
        return value

    before, after = load(args.initial_run), load(args.resume_run)
    keys = ["inputs", "hf_ckpt_path", "hf_ckpt_revision", "seed", "batch_size", "num_workers",
            "num_replicates", "compile_lengths", "inference_backend", "metrics_tags", "metrics",
            "generation", "nn", "precision", "torch_deterministic", "hardware"]
    missing = [key for key in keys if key not in before or key not in after]
    if missing:
        raise ValueError(f"Sampling configuration keys missing: {missing}")
    different = [key for key in keys if before[key] != after[key]]
    first_search, next_search = deepcopy(before.get("search")), deepcopy(after.get("search"))
    if not isinstance(first_search, dict) or not isinstance(next_search, dict):
        raise ValueError("Captured search settings are missing")
    for key in ("resume_from", "resume_seed"):
        first_search.pop(key, None)
        next_search.pop(key, None)
    if first_search != next_search:
        different.append("search (excluding explicit resume path and seed)")
    if different:
        raise ValueError(f"Input/model/sampling configuration differs: {different}")
    if (after["search"].get("resume_from") != args.resume_path or
            after["search"].get("resume_seed") != args.resume_seed):
        raise ValueError("Continuation does not use the expected explicit resume path and seed")
    print(json.dumps({"same_fields": keys + ["search excluding resume path/seed"],
                      "resume_from": args.resume_path, "resume_seed": args.resume_seed,
                      "scope": "captured resolved Hydra configurations"}, indent=2))


if __name__ == "__main__":
    main()
