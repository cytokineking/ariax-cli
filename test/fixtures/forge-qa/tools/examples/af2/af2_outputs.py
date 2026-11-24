#!/usr/bin/env python3
"""Check actual unzipped ColabFold outputs against the requested cases.

No confidence threshold is imposed. Pickles are retained but never deserialized.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import re


RESIDUES = dict(zip(
    "ALA ARG ASN ASP CYS GLN GLU GLY HIS ILE LEU LYS MET PHE PRO SER THR TRP TYR VAL".split(),
    "ARNDCQEGHILKMFPSTWYV",
))
MODES = ("alphafold2", "alphafold2_ptm", "alphafold2_multimer_v3")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def nonempty(path: Path) -> None:
    require(path.is_file() and path.stat().st_size > 0, f"Missing/empty output: {path}")


def number(value: object, lower: float, upper: float, label: str) -> float:
    require(isinstance(value, (int, float)) and not isinstance(value, bool), f"Invalid {label}")
    result = float(value)
    require(math.isfinite(result) and lower <= result <= upper, f"Invalid {label}: {result}")
    return result


def structure(path: Path, expected: dict[str, str]) -> list[dict]:
    nonempty(path)
    chains: dict[str, dict[tuple[str, str], str]] = {}
    ca_counts: dict[tuple[str, str, str], int] = {}
    atoms = []
    models = 0
    for line in path.read_text().splitlines():
        if line.startswith("MODEL"):
            models += 1
            require(models == 1, f"Multiple PDB models: {path}")
        if not line.startswith("ATOM  "):
            continue
        require(len(line) >= 66, f"Truncated ATOM record: {path}")
        require(line[16] == " ", f"Alternative conformer: {path}")
        chain, residue = line[21], (line[22:26].strip(), line[26])
        name = line[17:20].strip()
        require(name in RESIDUES, f"Unsupported residue {name}: {path}")
        observed = chains.setdefault(chain, {}).setdefault(residue, RESIDUES[name])
        require(observed == RESIDUES[name], f"Conflicting residue identity: {path}")
        for start in (30, 38, 46):
            require(math.isfinite(float(line[start:start + 8])), f"Nonfinite coordinate: {path}")
        number(float(line[60:66]), 0, 100, "PDB pLDDT")
        if line[12:16].strip() == "CA":
            key = (chain, *residue)
            ca_counts[key] = ca_counts.get(key, 0) + 1
            atoms.append({"chain": chain, "residue": int(residue[0]), "name": name,
                          "insertion": residue[1].strip(), "plddt": float(line[60:66])})
    observed = {chain: "".join(residues.values()) for chain, residues in chains.items()}
    require(observed == expected, f"Chain/sequence mismatch: {path}: {observed}")
    require(len(ca_counts) == sum(map(len, expected.values())) and all(n == 1 for n in ca_counts.values()),
            f"Missing/duplicate CA atoms: {path}")
    return atoms


def scores(path: Path, mode: str, length: int) -> dict[str, object]:
    nonempty(path)
    data = json.loads(path.read_text())
    plddt = data.get("plddt", [])
    require(len(plddt) == length, f"Wrong pLDDT length: {path}")
    values = [number(x, 0, 100, "pLDDT") for x in plddt]
    observed: dict[str, object] = {"mean_plddt": sum(values) / length}
    if mode != "alphafold2":
        pae = data.get("pae", [])
        require(len(pae) == length and all(isinstance(row, list) and len(row) == length for row in pae),
                f"Wrong PAE dimensions: {path}")
        for row in pae:
            for x in row:
                number(x, 0, float("inf"), "PAE Angstrom")
        observed["ptm"] = number(data.get("ptm"), 0, 1, "pTM")
        number(data.get("max_pae"), 0, float("inf"), "max PAE")
    if mode == "alphafold2_multimer_v3":
        observed["iptm"] = number(data.get("iptm"), 0, 1, "ipTM")
    return observed


def token_axis(path: Path, pdb: Path, confidence: Path, *, job: str, mode: str,
               model: int, seed: int, chains: dict[str, str]) -> dict:
    nonempty(path)
    native = json.loads(path.read_text())
    require(native.get("schema") == "af2-token-order-v1", "Missing native token-axis schema")
    require((native.get("job"), native.get("mode"), native.get("model"), native.get("seed")) ==
            (job, mode, f"{mode}_model_{model}", seed), "Token map belongs to another query/model/seed")
    sample = native.get("sample", {})
    require(sample.get("record_id") == job and type(sample.get("index")) is int and sample["index"] >= 0,
            "Missing native sample identity")
    require(bool(native.get("derivation")), "Missing token derivation")
    atoms = structure(pdb, chains)
    require(native.get("tokens") == [{key: atom[key] for key in ("chain", "residue", "name", "insertion")}
                                      for atom in atoms], "Native token axis differs from the PDB residue order")
    values = json.loads(confidence.read_text())["plddt"]
    require(all(abs(atom["plddt"] - value) <= .011 for atom, value in zip(atoms, values, strict=True)),
            "PDB and confidence pLDDT belong to different samples")
    return native


def inspect(result_dir: Path, manifest: dict[str, object]) -> dict[str, object]:
    nonempty(result_dir / "config.json")
    config = json.loads((result_dir / "config.json").read_text())
    mode = manifest["mode"]
    require(mode in MODES, "Unsupported manifest mode")
    require(config.get("model_type") == mode, "Result model type differs from requested mode")
    for key, expected in manifest.get("settings", {}).items():
        require(config.get(key) == expected, f"Result setting differs: {key}")
    cases = manifest["cases"]
    expected_pairs = {(int(model), int(seed)) for model in manifest["models"] for seed in manifest["seeds"]}
    require(bool(expected_pairs) and bool(cases), "Manifest must request cases, models and seeds")
    require(config.get("num_queries") == len(cases), "Wrong number of requested queries")
    results = {}
    for case in cases:
        job, expected = case["job"], case["chains"]
        require(re.fullmatch(r"[A-Za-z0-9_.-]+", job) is not None and job not in (".", ".."), "Unsafe job name")
        length = sum(map(len, expected.values()))
        require(length > 0, "Empty expected chains")
        require((result_dir / f"{job}.done.txt").is_file(), f"Query not completed: {job}")
        nonempty(result_dir / f"{job}.a3m")
        found = {}
        pattern = re.compile(rf"{re.escape(job)}_scores_(rank_\d{{3}}_{mode}_model_(\d)_seed_(\d+))\.json")
        for path in result_dir.glob(f"{job}_scores_rank_*.json"):
            match = pattern.fullmatch(path.name)
            require(match is not None, f"Unexpected model output: {path}")
            tag, model, seed = match.groups()
            pair = (int(model), int(seed))
            require(pair not in found, f"Duplicate model/seed output: {path}")
            structure(result_dir / f"{job}_unrelaxed_{tag}.pdb", expected)
            found[pair] = scores(path, mode, length)
            if manifest.get("raw", False):
                nonempty(result_dir / f"{job}_all_{tag}.pickle")
            if manifest.get("tokens", False):
                token_axis(result_dir / f"{job}_tokens_{tag}.json",
                           result_dir / f"{job}_unrelaxed_{tag}.pdb", path,
                           job=job, mode=mode, model=pair[0], seed=pair[1], chains=expected)
        require(set(found) == expected_pairs, f"Missing/unexpected models or seeds for {job}: {sorted(found)}")
        if mode != "alphafold2":
            path = result_dir / f"{job}_predicted_aligned_error_v1.json"
            nonempty(path)
            exported = json.loads(path.read_text()).get("predicted_aligned_error", [])
            require(len(exported) == length and all(len(row) == length for row in exported), "Wrong exported PAE dimensions")
        template_expectations = case.get("templates", {})
        required_template_chains = case.get("require_templates", [])
        if template_expectations or required_template_chains:
            path = result_dir / f"{job}_template_domain_names.json"
            nonempty(path)
            domains = json.loads(path.read_text())
            for chain in required_template_chains:
                names = domains.get(chain)
                require(isinstance(names, list) and bool(names) and
                        all(isinstance(name, str) and bool(name.strip()) for name in names),
                        f"No native service template selected for {job} chain {chain}")
            for chain, names in template_expectations.items():
                require(any(name in domains.get(chain, []) for name in names), f"Selected template absent for {job} chain {chain}")
        results[job] = {f"model_{model}_seed_{seed}": value for (model, seed), value in sorted(found.items())}
    return {"mode": mode, "cases": results, "scientific_success_threshold": None}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("results", type=Path)
    parser.add_argument("manifest", type=Path)
    args = parser.parse_args()
    print(json.dumps(inspect(args.results, json.loads(args.manifest.read_text())), indent=2))


if __name__ == "__main__":
    main()
