#!/usr/bin/env python3
"""Export a condition spec's original-to-assembled atom mapping in the RFd4 image.

This is an input map, not evidence that a generated output kept the same atoms.
Compare its expected source labels and identities against each annotated output.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from rfproteina.inference_utils.condition_spec import (
    build_annotated_atom_array_from_condition_spec,
    load_example_input,
    load_spec_file,
    split_global_args,
)
from rfproteina.inference_utils.contig_spec import EXPANDABLE_SEGMENT_RES_ID_SENTINEL, apply_contig
from rfproteina.transforms.inference_annotations import build_src_component_annotation


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spec", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    examples = split_global_args(load_spec_file(args.spec))
    if not examples:
        raise ValueError("The condition specification has no examples")
    results = {}
    for name, spec in examples.items():
        loaded = load_example_input(spec, args.spec.parent)
        if spec.get("contig"):
            layout, original_ids = apply_contig(loaded, spec["contig"])
        else:
            layout, original_ids = loaded, loaded.res_id.astype(np.int64).copy()
        built = build_annotated_atom_array_from_condition_spec(
            spec, spec_dir=args.spec.parent, example_id=name, validate=True
        )["atom_array"]
        fields = ("chain_id", "res_id", "res_name", "atom_name")
        if len(layout) != len(built) or any(
            not np.array_equal(getattr(layout, field), getattr(built, field)) for field in fields
        ):
            raise ValueError(f"{name}: final assembly changed atom order; mapping is ambiguous")
        source_keys = [
            (str(chain), int(resid), str(resname), str(atom))
            for chain, resid, resname, atom in zip(
                loaded.chain_id, loaded.res_id, loaded.res_name, loaded.atom_name, strict=True
            )
        ]
        if len(source_keys) != len(set(source_keys)):
            raise ValueError(f"{name}: source atom identities are not unique")
        source_keys = set(source_keys)
        labels = build_src_component_annotation(built)
        rows = []
        for i in np.flatnonzero(original_ids != EXPANDABLE_SEGMENT_RES_ID_SENTINEL):
            chain = str(built.chain_id[i])  # preserved contig segments keep their input chain ID
            key = (chain, int(original_ids[i]), str(built.res_name[i]), str(built.atom_name[i]))
            if key not in source_keys:
                raise ValueError(f"{name}: assembled atom lacks a unique original identity: {key}")
            rows.append({
                "original_chain": chain,
                "original_label_seq_id": key[1],
                "res_name": key[2],
                "atom_name": key[3],
                "assembled_chain": str(built.chain_id[i]),
                "assembled_res_id": int(built.res_id[i]),
                "expected_inference_SA_SRC": str(labels[i]),
            })
        if not rows:
            raise ValueError(f"{name}: no preserved atoms to map")
        results[name] = {"atoms": rows, "expandable_placeholder_atoms": int(
            (original_ids == EXPANDABLE_SEGMENT_RES_ID_SENTINEL).sum()
        )}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x") as handle:
        json.dump(results, handle, indent=2)
        handle.write("\n")
    print(json.dumps({"spec": str(args.spec), "output": str(args.output),
                      "examples": {name: len(data["atoms"]) for name, data in results.items()}}))


if __name__ == "__main__":
    main()
