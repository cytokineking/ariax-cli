#!/usr/bin/env python3
"""Check framework and CDR provenance for the upstream RFd4 VHH fixture.

This checks an actual generated structure and optional native antibody metrics;
experiments are required for binding or antibody developability claims.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
from atomworks.io import parse
from atomworks.io.utils.standard_annotations import S_SEGMAX, S_SEGMIN
from atomworks.ml.conditions import C_SEQ
from rfproteina.conditions import C_HOT
from rfproteina.transforms.inference_annotations import build_src_component_annotation
from rfproteina.utils.parse_presets import ANNOTATED_CIF
from rfproteina.utils.standard_annotations import SA_CRDSRC, SA_CWI, SA_SRC
from rfproteina.utils.structure_files import structure_file_stem

from rfd4 import read_metrics, read_structure


def check(source: Path, generated: Path, metrics: Path | None, max_motif_rmsd: float | None) -> dict:
    original = parse(source, config=ANNOTATED_CIF)["assemblies"]["1"][0]
    output = read_structure(generated)
    initial_labels = build_src_component_annotation(original)
    expandable = S_SEGMIN.mask(original)
    minima, maxima = S_SEGMIN.annotation(original), S_SEGMAX.annotation(original)
    segment_indices = np.flatnonzero(expandable & (original.chain_id == "H"))
    segments = [(int(index), str(initial_labels[index]), int(minima[index]), int(maxima[index]))
                for index in segment_indices]
    if len(segments) != 3 or len({item[1] for item in segments}) != 3:
        raise ValueError("The pinned VHH input must contain three distinguishable expandable CDRs")
    seq_mask = C_SEQ.mask(original, default="generate")
    framework = {}
    for index in np.flatnonzero((original.chain_id == "H") & (original.atom_name == "CA") & seq_mask):
        label, residue = str(initial_labels[index]), str(original.res_name[index])
        if label in framework:
            raise ValueError(f"Ambiguous framework source label: {label}")
        framework[label] = residue
    if not framework:
        raise ValueError("The VHH framework has no sequence-conditioned CA atoms")
    output_labels = SA_SRC.annotation(output, default="generate")
    output_sequence = C_SEQ.mask(output, default="generate")
    framework_output = {}
    for index in np.flatnonzero(output.atom_name == "CA"):
        label = str(output_labels[index])
        if label in framework:
            if label in framework_output:
                raise ValueError(f"Duplicate generated framework source label: {label}")
            framework_output[label] = (index, str(output.res_name[index]), str(output.chain_id[index]))
    if set(framework_output) != set(framework):
        raise ValueError("The generated VHH framework source mapping is incomplete")
    if any(framework_output[label][1] != residue or not output_sequence[framework_output[label][0]]
           for label, residue in framework.items()):
        raise ValueError("A conditioned framework sequence identity was not retained")
    chains = {value[2] for value in framework_output.values()}
    if len(chains) != 1:
        raise ValueError("The mapped framework does not form one generated chain")
    chain = next(iter(chains))
    # Expanded CDR atoms can have no SA_SRC label. Locate each one between
    # its uniquely mapped neighboring framework residues, preserving order.
    source_framework = [(int(index), str(initial_labels[index])) for index in
                        np.flatnonzero((original.chain_id == "H") & (original.atom_name == "CA") & seq_mask)]
    output_indices = list(np.flatnonzero((output.chain_id == chain) & (output.atom_name == "CA")))
    positions = {int(index): position for position, index in enumerate(output_indices)}
    framework_positions = [positions[framework_output[label][0]] for _, label in source_framework]
    if framework_positions != sorted(framework_positions) or len(set(framework_positions)) != len(framework_positions):
        raise ValueError("Generated framework residues are not in input order")
    cdr_counts, cdr_output_ranges = {}, {}
    for source_index, label, minimum, maximum in segments:
        previous = [(index, name) for index, name in source_framework if index < source_index]
        following = [(index, name) for index, name in source_framework if index > source_index]
        if not previous or not following:
            raise ValueError(f"CDR segment {label} lacks mapped framework neighbors")
        left_index, left_label = previous[-1]
        right_index, right_label = following[0]
        if any(left_index < other_index < right_index and other_index != source_index
               for other_index, _, _, _ in segments):
            raise ValueError("Multiple CDR segments share the same framework boundaries")
        left = positions[framework_output[left_label][0]]
        right = positions[framework_output[right_label][0]]
        indices = np.asarray(output_indices[left + 1:right], dtype=int)
        count = len(indices)
        if not minimum <= count <= maximum:
            raise ValueError(f"Generated CDR segment {label} has {count} residues outside [{minimum}, {maximum}]")
        if output_sequence[indices].any():
            raise ValueError(f"Generated CDR segment {label} unexpectedly fixes sequence")
        cdr_counts[label] = count
        cdr_output_ranges[label] = ({"chain": chain, "first_residue": int(output.res_id[indices[0]]),
                                     "last_residue": int(output.res_id[indices[-1]])} if count else None)
    if len(output_indices) != len(framework) + sum(cdr_counts.values()):
        raise ValueError("Generated VHH chain contains residues outside the mapped framework and CDRs")
    coords = SA_CRDSRC.mask(output) & SA_CWI.mask(output)
    framework_indices = [value[0] for value in framework_output.values()]
    if not coords[framework_indices].any():
        raise ValueError("No coordinate-conditioned VHH framework targets were retained")
    if not C_HOT.mask(output, default="generate").any():
        raise ValueError("No sampled target hotspot was retained")
    result = {"input": str(source), "generated": str(generated), "framework_chain": chain,
              "framework_residues": len(framework), "cdr_lengths": cdr_counts,
              "framework_source_to_output": {
                  label: f"{value[2]}{int(output.res_id[value[0]])}"
                  for label, value in framework_output.items()
              },
              "cdr_output_ranges": cdr_output_ranges,
              "scope": "framework identity, framework-anchored CDR lengths, retained coordinates and hotspots",
              "qualification": "not established"}
    if metrics is not None:
        stem = structure_file_stem(generated)
        if not stem.endswith("_generated"):
            raise ValueError("Expected an RFd4 generated structure filename")
        required = ("antibody_contacts.cdr_contact_count", "antibody_contacts.fw_contact_count",
                    "antibody_contacts.cdr_contact_fraction", "hotspot_obedience.hotspot_obedience",
                    "sequence_adherence.sequence_adherence", "sequence_adherence.n_violations",
                    "design_motif_allatom_rmsd.rmsd")
        row = read_metrics(metrics, required, example_ids=[stem.removesuffix("_generated")])[0]
        values = {key: float(row[key]) for key in required}
        if values[required[0]] < 0 or values[required[1]] < 0 or not 0 <= values[required[2]] <= 1:
            raise ValueError("Native antibody contact metrics are outside their physical ranges")
        if not 0 <= values[required[3]] <= 1 or values[required[4]] != 1 or values[required[5]] != 0:
            raise ValueError("Hotspot or conditioned sequence adherence is invalid")
        motif_rmsd = values[required[6]]
        if motif_rmsd < 0 or (max_motif_rmsd is not None and motif_rmsd > max_motif_rmsd):
            raise ValueError(f"Conditioned motif RMSD {motif_rmsd:.6g} Å exceeds the permitted range")
        result["native_metrics"] = values
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("generated", type=Path)
    parser.add_argument("--metrics-csv", type=Path)
    parser.add_argument("--max-motif-rmsd-angstrom", type=float)
    args = parser.parse_args()
    if args.max_motif_rmsd_angstrom is not None and (
        args.metrics_csv is None or not math.isfinite(args.max_motif_rmsd_angstrom)
        or args.max_motif_rmsd_angstrom <= 0
    ):
        parser.error("--max-motif-rmsd-angstrom requires metrics and a positive finite value")
    print(json.dumps(check(args.input, args.generated, args.metrics_csv, args.max_motif_rmsd_angstrom), indent=2))


if __name__ == "__main__":
    main()
