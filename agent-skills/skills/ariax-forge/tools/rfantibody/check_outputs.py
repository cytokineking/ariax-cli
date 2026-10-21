#!/usr/bin/env python3
"""Inspect native HLT identity, CDR constraints, numbering and RF2 confidence."""
import argparse
import json
import math
from pathlib import Path
import re
import sys

import numpy as np
from prepare import read_pdb
from check import check_sequences

NATIVE_METRICS = {
    "interaction_pae", "pae", "pred_lddt", "target_aligned_antibody_rmsd",
    "target_aligned_cdr_rmsd", "framework_aligned_antibody_rmsd", "framework_aligned_cdr_rmsd",
    *[f"framework_aligned_{chain}{loop}_rmsd" for chain in "HL" for loop in [1, 2, 3]],
}
JSON_NATIVE_METRICS = {"interaction_pae", "pae", "pred_lddt"}


def native_arrays(path: Path, total: int, unavailable=(), fields=None) -> dict:
    """Require the complete pinned RF2 export and its native shape/field mapping."""
    with np.load(path, allow_pickle=False) as archive:
        if set(archive.files) != (NATIVE_METRICS if fields is None else fields):
            raise ValueError("Missing or unexpected native RF2 array fields")
        arrays = {key: archive[key].copy() for key in archive.files}
    for key, array in arrays.items():
        shape = (1, total, total) if key == "pae" else (1, total) if key == "pred_lddt" else ()
        if array.shape != shape:
            raise ValueError("Native RF2 array shape does not map to the construct: " + key)
        if key in unavailable and np.isnan(array).all():
            continue
        if not np.isfinite(array).all():
            raise ValueError("Nonfinite available native RF2 metric: " + key)
    return arrays


def read_hlt(path: Path) -> dict:
    residues, lines = read_pdb(path)
    if list(residues) not in [["H", "L"], ["H"], ["T"], ["H", "L", "T"], ["H", "T"]]:
        raise ValueError("Expected explicit H/L/T order, with H as VH or VHH")
    mapping, sequences, loops = [], {}, {}
    for chain, entries in residues.items():
        sequences[chain] = "".join(r["aa"] for r in entries.values())
        for pos, (label, residue) in enumerate(entries.items(), 1):
            mapping.append({"chain": chain, "source_residue": label, "native_position": pos,
                            "aa": residue["aa"], "design": False, "atoms": residue["atoms"]})
    for line in lines:
        m = re.match(r"REMARK PDBinfo-LABEL:\s*(\d+) (H[123]|L[123])$", line)
        if m:
            number, loop = m.groups()
            chain = loop[0]
            hit = [r for r in mapping if r["chain"] == chain and r["source_residue"] == number]
            if len(hit) != 1:
                raise ValueError("CDR annotation does not identify one H/L residue")
            key = chain + ":" + number
            if key in loops:
                raise ValueError("Overlapping CDR annotation")
            loops[key] = loop
    for r in mapping:
        r["region"] = loops.get(r["chain"] + ":" + r["source_residue"], "fixed_context" if r["chain"] == "T" else "framework")
        if any(atom not in r["atoms"] for atom in ["N", "CA", "C", "O"]):
            raise ValueError("Every residue requires N/CA/C/O backbone atoms")
    for loop in set(loops.values()):
        positions = [r["native_position"] for r in mapping if r["region"] == loop]
        if positions != list(range(min(positions), max(positions) + 1)):
            raise ValueError("CDR annotations must be contiguous")
    if "H" in residues and set(v for v in loops.values() if v.startswith("H")) != {"H1", "H2", "H3"}:
        raise ValueError("Annotate H1, H2 and H3 explicitly")
    if "L" in residues and set(v for v in loops.values() if v.startswith("L")) != {"L1", "L2", "L3"}:
        raise ValueError("Annotate L1, L2 and L3 explicitly")
    return {"sequences": sequences, "residue_map": mapping, "lines": lines}


def xyz(rows: list[dict]) -> np.ndarray:
    return np.asarray([r["atoms"][a] for r in rows for a in ["N", "CA", "C", "O"]])


def read_target(path: Path) -> dict:
    residues, lines = read_pdb(path)
    mapping = []
    for chain, entries in residues.items():
        for label, residue in entries.items():
            if any(atom not in residue["atoms"] for atom in ["N", "CA", "C", "O"]):
                raise ValueError("Every target residue requires N/CA/C/O backbone atoms")
            mapping.append({"chain": "T", "source_residue": label if list(residues) == ["T"] else chain + ":" + label,
                            "native_position": len(mapping) + 1, "aa": residue["aa"], "design": False,
                            "atoms": residue["atoms"], "region": "fixed_context"})
    return {"sequences": {"T": "".join(r["aa"] for r in mapping)}, "residue_map": mapping, "lines": lines}


def rigid_max(a: np.ndarray, b: np.ndarray) -> float:
    a, b = a - a.mean(0), b - b.mean(0)
    u, _, vt = np.linalg.svd(a.T @ b)
    correction = np.eye(3)
    correction[-1, -1] = np.linalg.det(u @ vt)
    return float(np.linalg.norm(a @ (u @ correction @ vt) - b, axis=1).max())


def compare_constraints(source: dict, result: dict, designed: list[str], rigid: bool) -> dict:
    if source["sequences"].keys() != result["sequences"].keys():
        raise ValueError("Native chain identities changed")
    for r in source["residue_map"]:
        r["design"] = r["region"] in designed
    pairs = correspondence(source, result, designed)
    changes = sum(before is not None and before["aa"] != after["aa"] for before, after in pairs)
    if not rigid:
        changes = check_sequences([result["sequences"]], source)[0]
    comparisons = {}
    for role in ["framework", "target"]:
        selected = [(before, after) for before, after in pairs if before is not None and
                    (before["chain"] == "T" if role == "target" else before["region"] not in designed and before["chain"] != "T")]
        if not selected:
            continue
        a = xyz([before for before, _ in selected])
        b = xyz([after for _, after in selected])
        difference = rigid_max(a, b) if rigid else float(np.linalg.norm(a - b, axis=1).max())
        if difference > 0.05 and not rigid:
            raise ValueError(f"{role} backbone changed beyond 0.05 A: {difference}")
        comparisons[role + "_max_angstrom"] = difference
        comparisons[role + "_within_0.05_angstrom"] = difference <= 0.05
    report = {"changed_designed_residues": changes, **comparisons}
    length_changes = [{"chain": old[0]["chain"], "region": old[0]["region"],
                       "source_length": len(old), "output_length": len(new)}
                      for old, new in zip(region_blocks(source["residue_map"]), region_blocks(result["residue_map"]))
                      if len(old) != len(new)]
    if length_changes:
        report.update(length_changed_regions=length_changes,
                      changed_designed_residues_scope="Only one-to-one pairs; length-changing CDRs retain region-level lineage",
                      unmapped_designed_output_residues=sum(before is None for before, _ in pairs))
    return report


def region_blocks(rows: list[dict]) -> list[list[dict]]:
    blocks = []
    for row in rows:
        if not blocks or (row["chain"], row["region"]) != (blocks[-1][-1]["chain"], blocks[-1][-1]["region"]):
            blocks.append([])
        blocks[-1].append(row)
    return blocks


def correspondence(source: dict, result: dict, designed: list[str]) -> list[tuple[dict | None, dict]]:
    """Match fixed blocks exactly; length-changing CDRs have region-level lineage."""
    before, after = region_blocks(source["residue_map"]), region_blocks(result["residue_map"])
    if [(b[0]["chain"], b[0]["region"]) for b in before] != [(b[0]["chain"], b[0]["region"]) for b in after]:
        raise ValueError("Native chain/CDR block identities changed")
    pairs = []
    for old, new in zip(before, after):
        mutable = old[0]["region"] in designed
        if not mutable and (len(old) != len(new) or [r["aa"] for r in old] != [r["aa"] for r in new]):
            raise ValueError("Changed fixed framework, CDR or target sequence")
        if len(old) != len(new):
            if not mutable:
                raise ValueError("Changed fixed region length")
            pairs.extend((None, row) for row in new)
        else:
            pairs.extend(zip(old, new))
    return pairs


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--framework", type=Path, required=True)
    p.add_argument("--target", type=Path, required=True)
    p.add_argument("--generated", type=Path, required=True)
    p.add_argument("--sequenced", type=Path, required=True)
    p.add_argument("--predicted", type=Path, required=True)
    p.add_argument("--loops", required=True)
    p.add_argument("--out", type=Path, required=True)
    a = p.parse_args()
    designed = a.loops.split(",")
    f, g, s, pred = [read_hlt(x) for x in [a.framework, a.generated, a.sequenced, a.predicted]]
    t = read_target(a.target)
    source = {"sequences": {**f["sequences"], **t["sequences"]}, "residue_map": f["residue_map"] + t["residue_map"]}
    gen = compare_constraints(source, g, designed, True)
    seq = compare_constraints(g, s, designed, False)
    if s["sequences"] != pred["sequences"]:
        raise ValueError("Prediction does not preserve the native sequence-stage candidate")
    if [r["region"] for r in s["residue_map"]] != [r["region"] for r in pred["residue_map"]]:
        raise ValueError("Prediction CDR identity changed")
    scores = {}
    unavailable = {}
    for line in pred["lines"]:
        m = re.match(r"SCORE ([^:]+): (.*)", line)
        if m:
            key, value = m.groups()
            value = float(value)
            if not math.isfinite(value):
                if "L" not in pred["sequences"] and re.fullmatch(r"framework_aligned_L[123]_rmsd", key) and math.isnan(value):
                    unavailable[key] = "No light chain in this VHH; native empty-selection RMSD is NaN"
                    continue
                raise ValueError("Nonfinite RF2 confidence")
            scores[key] = value
    for key in ["pred_lddt", "pae", "interaction_pae", "target_aligned_antibody_rmsd"]:
        if key not in scores:
            raise ValueError("Missing native RF2 metric " + key)
    if not 0 <= scores["pred_lddt"] <= 1 or any(scores[k] < 0 for k in ["pae", "interaction_pae", "target_aligned_antibody_rmsd"]):
        raise ValueError("Invalid confidence range")
    arrays_path = a.predicted.with_suffix(".native.npz")
    native_means = {}
    if set(scores) | set(unavailable) != NATIVE_METRICS:
        raise ValueError("Missing or unexpected native RF2 SCORE fields")
    total = sum(map(len, pred["sequences"].values()))
    arrays = native_arrays(arrays_path, total, unavailable)
    if arrays:
        for key in scores:
            if key not in arrays or not np.isfinite(arrays[key]).all():
                raise ValueError("Missing/nonfinite native metric array " + key)
            native_means[key] = float(arrays[key].mean())
            if abs(native_means[key] - scores[key]) > 0.0051:
                raise ValueError("Native confidence array disagrees with PDB metric " + key)
        for key in unavailable:
            if key not in arrays or not np.isnan(arrays[key]).all():
                raise ValueError("Native absent-light metric disagrees with its PDB value")
    rejected = ["generation " + key.replace("_within_0.05_angstrom", "") + " exceeds 0.05 A"
                for key, value in gen.items() if key.endswith("_within_0.05_angstrom") and not value]
    if native_means["pred_lddt"] <= 0.9:
        rejected.append("pred_lddt <= 0.9")
    if native_means["interaction_pae"] >= 10:
        rejected.append("interaction_pae >= 10 A")
    if native_means["target_aligned_antibody_rmsd"] >= 2:
        rejected.append("target_aligned_antibody_rmsd >= 2 A")
    # Preserve source labels, including author insertion codes, next to each native position.
    mapped = []
    for before, after in correspondence(source, g, designed):
        predicted = next(r for r in pred["residue_map"] if r["chain"] == after["chain"] and r["native_position"] == after["native_position"])
        if before is None:
            row = {"chain": after["chain"], "source_residue": None, "native_position": None, "region": after["region"],
                   "source_region_residues": [r["source_residue"] for r in source["residue_map"] if r["chain"] == after["chain"] and r["region"] == after["region"]]}
        else:
            row = {k: before[k] for k in ["chain", "source_residue", "native_position", "region"]}
        mapped.append(row | {"native_output_residue": predicted["source_residue"], "predicted_aa": predicted["aa"]})
    confidence_order = [c for c in ["T", "H", "L"] if c in pred["sequences"]]
    confidence_rows = [row for c in confidence_order for row in mapped if row["chain"] == c]
    confidence_map = [{"array_index_zero_based": i, **row} for i, row in enumerate(confidence_rows)]
    report = {"format": "paired VH/VL" if "L" in f["sequences"] else "VHH", "numbering_scheme": "explicit upstream HLT labels; no Chothia/IMGT assignment inferred",
              "generation": gen, "sequence": seq, "native_confidence": native_means, "pdb_rounded_confidence": scores, "unavailable_native_metrics": unavailable,
              "filter": {"accepted": not rejected, "reasons": rejected, "scope": "screening example, no experimental binding claim"},
              "sequences": pred["sequences"], "residue_map": mapped,
              "native_confidence_chain_order": confidence_order, "confidence_residue_map": confidence_map}
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({k: v for k, v in report.items() if k not in ["sequences", "residue_map", "confidence_residue_map"]}, indent=2))


if __name__ == "__main__":
    main()
