#!/usr/bin/env python3
"""Compare a partial-diffusion or inverse-folding result to its RFd4 seed.

The fixture carries no sequence or absolute-coordinate conditions. Output source
labels map generated CA atoms to the loaded seed; a rigid proper-rotation fit
measures the observed drift. No general quality or affinity claim follows.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import re

import numpy as np
from atomworks.ml.conditions import C_CRD, C_SEQ
from rfproteina.inference_utils.condition_spec import (
    build_annotated_atom_array_from_condition_spec,
    load_example_input,
    load_spec_file,
)
from rfproteina.inference_utils.contig_spec import EXPANDABLE_SEGMENT_RES_ID_SENTINEL, apply_contig
from rfproteina.transforms.inference_annotations import build_src_component_annotation
from rfproteina.utils.standard_annotations import SA_SRC
from rfproteina.utils.structure_files import structure_file_stem

from rfd4 import read_metrics, read_structure


def ca_records(array, labels, *, input_structure: bool) -> dict[str, tuple]:
    records = {}
    for index, (label, atom, residue, coord) in enumerate(
        zip(labels, array.atom_name, array.res_name, array.coord, strict=True)
    ):
        label, atom, residue = str(label), str(atom), str(residue)
        if atom != "CA":
            continue
        if not label or label in (".", "?"):
            raise ValueError("A protein CA atom lacks source identity")
        if not np.isfinite(coord).all():
            if input_structure:
                continue  # unresolved input atoms are not a coordinate reference
            raise ValueError(f"Output CA coordinates are nonfinite: {label}")
        if label in records:
            raise ValueError(f"Duplicate source CA atom: {label}")
        records[label] = (index, residue, np.asarray(coord, dtype=float))
    if not records:
        raise ValueError("No resolved protein CA atoms were found")
    return records


def inspect_seed(spec_path: Path):
    document = load_spec_file(spec_path)
    examples = [(name, spec) for name, spec in document.items() if name != "global_args"]
    if len(examples) != 1 or document.get("global_args"):
        raise ValueError("Expected one seed spec without global_args")
    example_id, spec = examples[0]
    loaded = load_example_input(spec, spec_path.parent)
    contig = spec.get("contig")
    if contig:
        match = re.fullmatch(r"([A-Za-z0-9])(\d+)-(\d+)", contig)
        if match is None:
            raise ValueError("The seed contig must select one complete, non-expandable chain range")
        layout, original_ids = apply_contig(loaded, contig)
        if np.any(original_ids == EXPANDABLE_SEGMENT_RES_ID_SENTINEL):
            raise ValueError("A partial-diffusion seed must not contain expandable segments")
        original_chain = match.group(1)
    else:
        layout, original_ids = loaded, loaded.res_id.astype(np.int64).copy()
        original_chain = None
    original = build_annotated_atom_array_from_condition_spec(
        spec, spec_dir=spec_path.parent, example_id=example_id
    )["atom_array"]
    fields = ("chain_id", "res_id", "res_name", "atom_name")
    if len(layout) != len(original) or any(
        not np.array_equal(getattr(layout, field), getattr(original, field)) for field in fields
    ):
        raise ValueError("Seed assembly changed atom order; original residue mapping is ambiguous")
    if C_SEQ.mask(original, default="generate").any() or C_CRD.mask(original, default="generate").any():
        raise ValueError("Seed unexpectedly fixes sequence or absolute coordinates")
    heavy = ~np.isin(np.char.upper(original.element.astype(str)), ["H", "D"])
    nonfinite = heavy & ~np.isfinite(original.coord).all(axis=1)
    if nonfinite.any():
        raise ValueError(f"Seed contains {int(nonfinite.sum())} nonfinite heavy-atom coordinates")
    mapping = {}
    for i in np.flatnonzero(original.atom_name == "CA"):
        source = f"{original_chain or layout.chain_id[i]}{int(original_ids[i])}"
        assembled = f"{original.chain_id[i]}{int(original.res_id[i])}"
        if source in mapping and mapping[source] != assembled:
            raise ValueError(f"Ambiguous seed residue mapping: {source}")
        mapping[source] = assembled
    if not mapping or len(set(mapping.values())) != len(mapping):
        raise ValueError("Seed residue mapping is empty or not one-to-one")
    return original, {"input": str(spec_path), "example_id": example_id,
                      "residues": len(mapping), "nonfinite_heavy_atoms": 0,
                      "original_to_assembled": mapping}


def check(spec_path: Path, generated: Path, mode: str, metrics: Path | None,
          max_ca_rmsd: float | None, max_backbone_rmsd: float | None,
          max_backbone_displacement: float | None, min_sequence_changes: int | None) -> dict:
    original, input_summary = inspect_seed(spec_path)
    output = read_structure(generated)
    before = ca_records(original, build_src_component_annotation(original), input_structure=True)
    after = ca_records(output, SA_SRC.annotation(output, default="generate"), input_structure=False)
    missing = set(before) - set(after)
    extra = set(after) - set(before)
    if missing or extra:
        raise ValueError(f"Seed/output CA identity mismatch: missing={sorted(missing)}, extra={sorted(extra)}")
    keys = sorted(before)
    reference = np.stack([before[key][2] for key in keys])
    predicted = np.stack([after[key][2] for key in keys])
    reference_centered = reference - reference.mean(axis=0)
    predicted_centered = predicted - predicted.mean(axis=0)
    u, _, vt = np.linalg.svd(predicted_centered.T @ reference_centered)
    rotation = u @ np.diag([1.0, 1.0, np.linalg.det(u @ vt)]) @ vt
    distances = np.linalg.norm(predicted_centered @ rotation - reference_centered, axis=1)
    rmsd = float(np.sqrt(np.mean(distances**2)))
    changes = sum(before[key][1] != after[key][1] for key in keys)
    identity = 1.0 - changes / len(keys)
    if min_sequence_changes is not None and (min_sequence_changes < 0 or changes < min_sequence_changes):
        raise ValueError(f"Observed {changes} changed residues; minimum is {min_sequence_changes}")
    if mode == "inverse" and (max_ca_rmsd is None or not math.isfinite(max_ca_rmsd) or max_ca_rmsd <= 0):
        raise ValueError("Inverse-folding comparison requires an explicit positive CA RMSD tolerance")
    if max_ca_rmsd is not None and (not math.isfinite(max_ca_rmsd) or max_ca_rmsd <= 0 or rmsd > max_ca_rmsd):
        raise ValueError(f"Aligned CA RMSD {rmsd:.6g} Å exceeds the supplied tolerance {max_ca_rmsd}")
    result = {"mode": mode, "input": input_summary, "generated": str(generated),
              "mapped_residues": len(keys), "sequence_identity": identity, "changed_residues": changes,
              "inference_source_to_output": {
                  key: f"{output.chain_id[after[key][0]]}{int(output.res_id[after[key][0]])}" for key in keys
              },
              "aligned_ca_rmsd_angstrom": rmsd, "max_aligned_ca_displacement_angstrom": float(distances.max()),
              "scope": "mapped resolved seed CA atoms and sequence; no sidechain or experimental claim",
              "qualification": "not established"}
    if mode == "inverse":
        if max_backbone_rmsd is None or not math.isfinite(max_backbone_rmsd) or max_backbone_rmsd <= 0:
            raise ValueError("Inverse-folding comparison requires an explicit positive backbone RMSD tolerance")
        if (max_backbone_displacement is None or not math.isfinite(max_backbone_displacement)
                or max_backbone_displacement <= 0):
            raise ValueError("Inverse folding requires an explicit positive per-atom backbone displacement tolerance")

        def backbone_records(array, labels, *, input_structure: bool) -> dict[tuple[str, str], np.ndarray]:
            records = {}
            for label, atom, coord in zip(labels, array.atom_name, array.coord, strict=True):
                label, atom = str(label), str(atom)
                if label not in before or atom not in {"N", "CA", "C", "O"}:
                    continue
                if not np.isfinite(coord).all():
                    if input_structure:
                        continue
                    raise ValueError(f"Output backbone coordinates are nonfinite: {label} {atom}")
                key = (label, atom)
                if key in records:
                    raise ValueError(f"Duplicate source backbone atom: {key}")
                records[key] = np.asarray(coord, dtype=float)
            return records

        input_backbone = backbone_records(original, build_src_component_annotation(original), input_structure=True)
        output_backbone = backbone_records(output, SA_SRC.annotation(output, default="generate"), input_structure=False)
        missing_backbone = set(input_backbone) - set(output_backbone)
        if missing_backbone:
            raise ValueError(f"Resolved seed backbone atoms missing from output: {sorted(missing_backbone)}")
        if not all(any(atom == name for _, atom in input_backbone) for name in ("N", "CA", "C", "O")):
            raise ValueError("Resolved seed does not contain all four backbone atom types")
        backbone_keys = sorted(input_backbone)
        input_coords = np.stack([input_backbone[key] for key in backbone_keys])
        output_coords = np.stack([output_backbone[key] for key in backbone_keys])
        aligned = (output_coords - predicted.mean(axis=0)) @ rotation + reference.mean(axis=0)
        displacement = np.linalg.norm(aligned - input_coords, axis=1)
        backbone_rmsd = float(np.sqrt(np.mean(displacement**2)))
        if backbone_rmsd > max_backbone_rmsd:
            raise ValueError(f"Aligned backbone RMSD {backbone_rmsd:.6g} Å exceeds {max_backbone_rmsd}")
        worst_index = int(np.argmax(displacement))
        worst = float(displacement[worst_index])
        if worst > max_backbone_displacement:
            raise ValueError(f"Aligned backbone atom {backbone_keys[worst_index]} displaced {worst:.6g} Å; "
                             f"per-atom tolerance is {max_backbone_displacement}")
        result.update({"mapped_backbone_atoms": len(backbone_keys),
                       "aligned_backbone_rmsd_angstrom": backbone_rmsd,
                       "max_aligned_backbone_displacement_angstrom": worst,
                       "max_displacement_atom": list(backbone_keys[worst_index]),
                       "backbone_tolerance_angstrom": max_backbone_rmsd,
                       "backbone_atom_displacement_tolerance_angstrom": max_backbone_displacement,
                       "scope": "mapped resolved seed N/CA/C/O atoms and sequence; no sidechain or experimental claim"})
    if metrics is not None:
        if mode != "partial":
            raise ValueError("The selected partial-diffusion metrics are not inverse-folding metrics")
        stem = structure_file_stem(generated)
        if not stem.endswith("_generated"):
            raise ValueError("Expected an RFd4 generated structure filename")
        required = ("sequence_similarity_to_input.sequence_identity_to_input", "ca_rmsd_to_input.rmsd")
        row = read_metrics(metrics, required, example_ids=[stem.removesuffix("_generated")])[0]
        native_identity, native_rmsd = (float(row[key]) for key in required)
        if not 0 <= native_identity <= 1 or native_rmsd < 0:
            raise ValueError("Native partial-diffusion metrics are outside their physical ranges")
        result["native_metrics"] = {required[0]: native_identity, required[1]: native_rmsd}
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-spec", type=Path, required=True)
    parser.add_argument("--generated", type=Path)
    parser.add_argument("--mode", choices=("partial", "inverse"))
    parser.add_argument("--input-only", action="store_true", help="Validate and map a seed before generation")
    parser.add_argument("--metrics-csv", type=Path)
    parser.add_argument("--max-ca-rmsd-angstrom", type=float)
    parser.add_argument("--max-backbone-rmsd-angstrom", type=float)
    parser.add_argument("--max-backbone-displacement-angstrom", type=float)
    parser.add_argument("--min-sequence-changes", type=int)
    args = parser.parse_args()
    if args.input_only:
        if any(value is not None for value in (args.generated, args.mode, args.metrics_csv,
                                                args.max_ca_rmsd_angstrom, args.max_backbone_rmsd_angstrom,
                                                args.max_backbone_displacement_angstrom, args.min_sequence_changes)):
            parser.error("--input-only cannot be combined with generated-output options")
        _, result = inspect_seed(args.input_spec)
        print(json.dumps({"input": result, "qualification": "not established"}, indent=2))
        return
    if args.generated is None or args.mode is None:
        parser.error("--generated and --mode are required unless --input-only is used")
    if args.mode != "inverse" and (args.max_backbone_rmsd_angstrom is not None
                                   or args.max_backbone_displacement_angstrom is not None
                                   or args.min_sequence_changes is not None):
        parser.error("Backbone and sequence-design bounds apply to inverse folding")
    print(json.dumps(check(args.input_spec, args.generated, args.mode, args.metrics_csv,
                           args.max_ca_rmsd_angstrom, args.max_backbone_rmsd_angstrom,
                           args.max_backbone_displacement_angstrom, args.min_sequence_changes), indent=2))


if __name__ == "__main__":
    main()
