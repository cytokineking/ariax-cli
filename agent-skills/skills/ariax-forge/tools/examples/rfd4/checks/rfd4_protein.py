#!/usr/bin/env python3
"""Check the PD-L1 input and motif mapping for prepared RFd4 qualification cases.

This is a remote scientific check, not a mode qualification. It uses RFd4's
native condition-spec builder and the shared structure/metric readers.
"""
from __future__ import annotations

import argparse
from collections import Counter
import json
import math
from pathlib import Path

import numpy as np
from atomworks.ml.conditions import C_CRD, C_SEQ
from rfproteina.conditions import C_CRDGRP, C_HOT
from rfproteina.inference_utils.condition_spec import (
    build_annotated_atom_array_from_condition_spec,
    load_example_input,
    load_spec_file,
)
from rfproteina.inference_utils.contig_spec import (
    EXPANDABLE_SEGMENT_RES_ID_SENTINEL,
    apply_contig,
)
from rfproteina.utils.standard_annotations import SA_CRDSRC, SA_CWI, SA_IDXGRPSRC, SA_SRC, SA_UII
from rfproteina.utils.structure_files import structure_file_stem

from rfd4 import read_metrics, read_structure


EXPECTED_HOTSPOTS = Counter({
    (56, "TYR", "CG"): 1,
    (56, "TYR", "OH"): 1,
    (115, "MET", "CG"): 1,
    (115, "MET", "SD"): 1,
    (123, "TYR", "CD2"): 1,
    (123, "TYR", "OH"): 1,
})


def check_binder_input(spec_path: Path):
    """Verify original-number selections against the native assembled input."""
    document = load_spec_file(spec_path)
    examples = [(key, value) for key, value in document.items() if key != "global_args"]
    if len(examples) != 1 or document.get("global_args"):
        raise ValueError("The PD-L1 fixture check requires one example without global_args")
    example_id, spec = examples[0]
    original = load_example_input(spec, spec_path.parent)
    layout, original_ids = apply_contig(original, spec["contig"])
    built = build_annotated_atom_array_from_condition_spec(
        spec, spec_dir=spec_path.parent, example_id=example_id
    )["atom_array"]
    # The native builder's final parse should preserve the assembled atoms' order.
    fields = ("chain_id", "res_id", "res_name", "atom_name")
    if len(layout) != len(built) or any(
        not np.array_equal(getattr(layout, field), getattr(built, field)) for field in fields
    ):
        raise ValueError("Condition-spec finalization changed atom order; cannot associate original residue IDs")
    preserved = original_ids != EXPANDABLE_SEGMENT_RES_ID_SENTINEL
    hotspots = C_HOT.mask(built, default="generate")
    observed = Counter(
        (int(original_ids[i]), str(built.res_name[i]), str(built.atom_name[i]))
        for i in np.flatnonzero(hotspots)
    )
    if observed != EXPECTED_HOTSPOTS or not np.all(preserved[hotspots]):
        raise ValueError(f"PD-L1 hotspot selection differs from the six intended original atoms: {observed}")
    if not np.array_equal(C_SEQ.mask(built, default="generate"), preserved):
        raise ValueError("Target sequence conditioning is missing or extends into the designed binder")
    expected_internal = preserved & np.isin(built.atom_name, ["N", "CA", "C", "O"])
    expected_internal &= np.isfinite(built.coord).all(axis=1)
    if not expected_internal.any() or not np.array_equal(C_CRDGRP.is_internal(built), expected_internal):
        raise ValueError("Target backbone internal-coordinate selection differs from the intended atoms")
    if C_CRD.mask(built, default="generate")[preserved].any():
        raise ValueError("Target unexpectedly has absolute-coordinate conditioning")
    # Native inference labels the assembled input's current chain/residue IDs,
    # which need not equal the original label_seq_id used in condition selections.
    mapping = {}
    for index in np.flatnonzero(preserved):
        original_label = f"A{int(original_ids[index])}"
        assembled_label = f"{built.chain_id[index]}{int(built.res_id[index])}"
        if original_label in mapping and mapping[original_label] != assembled_label:
            raise ValueError(f"Ambiguous original-to-assembled residue mapping: {original_label}")
        mapping[original_label] = assembled_label
    if len(set(mapping.values())) != len(mapping):
        raise ValueError("Multiple original target residues map to one assembled residue")
    return mapping, {"example_id": example_id, "hotspot_atoms": sum(observed.values()),
                     "original_to_assembled": mapping}


def metric_row(metrics_path: Path, generated: Path, required: tuple[str, ...]) -> dict[str, str]:
    stem = structure_file_stem(generated)
    if not stem.endswith("_generated"):
        raise ValueError("Expected an RFd4 generated structure filename")
    example_id = stem.removesuffix("_generated")
    return read_metrics(metrics_path, required, example_ids=[example_id])[0]


def inspect_generated(case: str, generated: Path, metrics_path: Path | None,
                      input_mapping: dict[str, str] | None = None,
                      max_motif_rmsd: float | None = None) -> dict:
    array = read_structure(generated)
    result = {"case": case, "generated": str(generated)}
    if case == "binder":
        hotspots = C_HOT.mask(array, default="generate")
        if input_mapping is None:
            raise ValueError("Binder output needs its original-to-assembled input mapping")
        expected = Counter((input_mapping[f"A{number}"], residue, atom)
                           for (number, residue, atom), count in EXPECTED_HOTSPOTS.items()
                           for _ in range(count))
        source_labels = SA_SRC.annotation(array, default="generate")
        observed = Counter((str(source_labels[i]), str(array.res_name[i]), str(array.atom_name[i]))
                           for i in np.flatnonzero(hotspots))
        if observed != expected or not C_SEQ.mask(array, default="generate").any():
            raise ValueError("Generated target lacks the intended hotspot or sequence conditioning")
        result["hotspot_atoms"] = sum(observed.values())
        assembled_labels = set(input_mapping.values())
        assembled_to_output = {}
        for index in np.flatnonzero(array.atom_name == "CA"):
            source = str(source_labels[index])
            if source not in assembled_labels:
                continue
            label = f"{array.chain_id[index]}{int(array.res_id[index])}"
            if source in assembled_to_output:
                raise ValueError(f"Ambiguous output mapping for assembled residue {source}")
            assembled_to_output[source] = label
        if set(assembled_to_output) != assembled_labels or len(set(assembled_to_output.values())) != len(assembled_labels):
            raise ValueError("Generated target residue mapping is incomplete or ambiguous")
        result["assembled_to_output"] = assembled_to_output
        required = ("hotspot_obedience.hotspot_obedience", "sequence_adherence.sequence_adherence",
                    "sequence_adherence.n_violations", "design_motif_allatom_rmsd.rmsd")
    else:
        conditioned = SA_CRDSRC.mask(array)
        target_coords = SA_CWI.mask(array)
        if not (conditioned & target_coords).any():
            raise ValueError("No coordinate-conditioned motif and reference coordinates were retained")
        result["coordinate_conditioned_atoms"] = int((conditioned & target_coords).sum())
        required = ("design_motif_allatom_rmsd.rmsd",)
        if case == "unindexed":
            mapped = SA_UII.mask(array)
            source_groups = SA_IDXGRPSRC.mask(array)
            if not (mapped & conditioned & target_coords & source_groups).any():
                raise ValueError("No unindexed motif insertion with retained source group and target coordinates")
            result["unindexed_conditioned_atoms"] = int((mapped & conditioned & target_coords).sum())
            required += ("design_unindexed_motif_allatom_rmsd.rmsd",
                         "unindexed_insertion_mapping.n_unmapped_tokens",
                         "unindexed_insertion_mapping.n_sequence_mismatches")
    if metrics_path is not None:
        row = metric_row(metrics_path, generated, required)
        if case == "binder":
            if not 0 <= float(row[required[0]]) <= 1 or float(row[required[1]]) != 1:
                raise ValueError("Hotspot or target sequence adherence is invalid")
            if float(row[required[2]]) != 0:
                raise ValueError("Target sequence has conditioned-residue violations")
        else:
            if any(float(row[key]) < 0 for key in required if key.endswith(".rmsd")):
                raise ValueError("Motif RMSD cannot be negative")
            if case == "unindexed" and any(float(row[key]) != 0 for key in required[-2:]):
                raise ValueError("Unindexed motif mapping is incomplete or has sequence mismatches")
        motif_rmsd = float(row["design_motif_allatom_rmsd.rmsd"])
        if motif_rmsd < 0 or (max_motif_rmsd is not None and motif_rmsd > max_motif_rmsd):
            raise ValueError(f"Conditioned motif RMSD {motif_rmsd:.6g} Å exceeds the permitted range")
        result["metrics"] = {key: float(row[key]) for key in required}
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case", choices=("binder", "indexed", "unindexed"), required=True)
    parser.add_argument("--input-spec", type=Path, help="PD-L1 YAML condition spec")
    parser.add_argument("--generated", type=Path, help="Corresponding native generated CIF")
    parser.add_argument("--metrics-csv", type=Path, help="Native per-example metrics CSV")
    parser.add_argument("--max-motif-rmsd-angstrom", type=float,
                        help="Optional explicit upper bound for conditioned motif RMSD")
    args = parser.parse_args()
    if args.case == "binder" and args.input_spec is None:
        parser.error("binder requires --input-spec")
    if args.case != "binder" and (args.input_spec is not None or args.generated is None):
        parser.error("motif cases require --generated and do not use --input-spec")
    if args.metrics_csv is not None and args.generated is None:
        parser.error("--metrics-csv requires --generated")
    if args.max_motif_rmsd_angstrom is not None and (
        args.metrics_csv is None or not math.isfinite(args.max_motif_rmsd_angstrom)
        or args.max_motif_rmsd_angstrom <= 0
    ):
        parser.error("--max-motif-rmsd-angstrom requires metrics and a positive finite value")
    result = {"qualification": "not established"}
    mapping = None
    if args.input_spec is not None:
        mapping, result["input"] = check_binder_input(args.input_spec)
    if args.generated is not None:
        result["output"] = inspect_generated(args.case, args.generated, args.metrics_csv, mapping,
                                             args.max_motif_rmsd_angstrom)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
