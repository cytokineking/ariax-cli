#!/usr/bin/env python3
"""Export one completed native AF2 sample for interface-scores-v1.

Original PDB, rounded native confidence JSON, pickle and settings are preserved.
Token identities must come from the native sidecar, never inferred from dimensions.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import tempfile

from af2_outputs import inspect, require, token_axis


def export(results: Path, manifest: dict, *, job: str, model: int, seed: int,
           run_id: str, output: Path) -> dict:
    require(bool(run_id.strip()), "Missing original run/session identity")
    inspect(results, manifest)
    mode = manifest["mode"]
    cases = [case for case in manifest["cases"] if case["job"] == job]
    require(len(cases) == 1, "Select one manifest query")
    require(model in manifest["models"] and seed in manifest["seeds"], "Unrequested model/seed")
    case = cases[0]
    pattern = re.compile(rf"{re.escape(job)}_scores_(rank_(\d{{3}})_{mode}_model_{model}_seed_0*{seed})\.json")
    matches = [(path, pattern.fullmatch(path.name)) for path in results.glob(f"{job}_scores_rank_*.json")]
    matches = [(path, match) for path, match in matches if match is not None]
    require(len(matches) == 1, "Model/seed has no unique ranked sample")
    confidence, match = matches[0]
    tag, rank = match.groups()
    pdb = results / f"{job}_unrelaxed_{tag}.pdb"
    tokens_file = results / f"{job}_tokens_{tag}.json"
    identity = f"{mode}_model_{model}"
    native = token_axis(tokens_file, pdb, confidence, job=job, mode=mode, model=model,
                        seed=seed, chains=case["chains"])
    sample = native["sample"]
    tokens = native["tokens"]
    config = results / "config.json"
    originals = {path.resolve() for path in results.iterdir() if path.is_file()}
    require(output.resolve() not in originals, "Handoff must preserve all native files")
    relative = lambda path: os.path.relpath(path.resolve(), output.parent.resolve())
    lineage_files = {"config": relative(config), "msa": relative(results / f"{job}.a3m"),
                     "tokens": relative(tokens_file)}
    for key, filename in (("raw", f"{job}_all_{tag}.pickle"),
                          ("templates", f"{job}_template_domain_names.json"), ("log", "log.txt")):
        path = results / filename
        if path.is_file():
            lineage_files[key] = relative(path)
    record = {"schema": "interface-scores-v1", "predictor": "af2", "run_id": run_id,
              "input_id": job, "model": identity, "seed": seed, "sample": sample,
              "pae_units": "angstrom", "plddt_scale": "0-100",
              "selected_chains": list(case["chains"]), "sequences": case["chains"],
              "files": {"structure": relative(pdb), "confidence": relative(confidence)},
              "mapping": {"tokens": tokens},
              "lineage": {"native_rank": int(rank), "files": lineage_files,
                          "settings": json.loads(config.read_text()),
                          "input_source": case.get("source"), "token_derivation": native["derivation"],
                          "confidence": "Native JSON rounds to 2 decimals; full precision pickle retained, never deserialized here",
                          "iptm_scope": "complex" if mode == "alphafold2_multimer_v3" else None}}
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", dir=output.parent, delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(record, stream, indent=2, allow_nan=False)
            stream.write("\n")
        os.replace(temporary, output)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return record


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("results", type=Path)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--job", required=True)
    parser.add_argument("--model", type=int, required=True)
    parser.add_argument("--seed", type=int, required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = export(args.results, json.loads(args.manifest.read_text()), job=args.job,
                        model=args.model, seed=args.seed, run_id=args.run_id, output=args.output)
        print(json.dumps({"handoff": str(args.output), "model": result["model"], "sample": result["sample"]}))
    except (ValueError, KeyError, TypeError, OSError) as exc:
        parser.exit(1, f"AF2 handoff rejected: {exc}\n")


if __name__ == "__main__":
    main()
