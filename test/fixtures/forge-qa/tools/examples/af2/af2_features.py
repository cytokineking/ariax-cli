#!/usr/bin/env python3
"""Exercise native feature construction for the absent-MSA-channel failure.

Run in the AF2 image. No search or prediction is submitted by this check.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np
from alphafold.common import residue_constants
from colabfold.batch import generate_input_feature, unserialize_msa
from colabfold.input import get_queries, msa_to_str


ParsedMsa = tuple[list[str] | None, list[str] | None, list[str], list[int], list[dict[str, Any]]]


def parse(path: Path) -> ParsedMsa:
    queries, _ = get_queries(path, "none")
    _, sequence, a3m, _ = queries[0]
    return unserialize_msa(a3m, sequence)


def features(parsed: ParsedMsa, mode: str, max_seq: int = 32) -> dict[str, np.ndarray]:
    unpaired, paired, sequences, copies, templates = parsed
    result, _ = generate_input_feature(sequences, copies, unpaired, paired,
                                      templates, sum(copies) > 1, mode, max_seq=max_seq)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("fixtures", type=Path)
    parser.add_argument("--expect-original-failure", action="store_true")
    parser.add_argument("--msa", type=Path)
    parser.add_argument("--mode", default="alphafold2_multimer_v3")
    parser.add_argument("--manifest", type=Path)
    args = parser.parse_args()
    fixture = args.fixtures
    if args.msa:
        unpaired, paired, sequences, copies, templates = parse(args.msa)
        result = features((unpaired, paired, sequences, copies, templates), args.mode)
        if args.manifest:
            manifest = json.loads(args.manifest.read_text())
            if manifest["mode"] != args.mode or len(manifest["cases"]) != 1:
                raise ValueError("Service feature check needs one case in the selected mode")
            expected = list(manifest["cases"][0]["chains"].values())
            observed = [seq for seq, count in zip(sequences, copies, strict=True) for _ in range(count)]
            if observed != expected:
                raise ValueError(f"Service query/copy register changed: {observed}")
            aatype = result["aatype"]
            if aatype.ndim == 2:
                aatype = np.argmax(aatype, axis=-1)
            wanted = np.array([residue_constants.restype_order[x] for x in "".join(expected)])
            np.testing.assert_array_equal(aatype, wanted, err_msg="Service native feature residue axis changed")
            pair_mode = manifest["settings"]["pair_mode"]
            if len(sequences)>1 and pair_mode == "unpaired" and paired is not None:
                raise ValueError("Unpaired service case acquired paired rows")
            if len(sequences)>1 and pair_mode == "paired" and (paired is None or unpaired is not None):
                raise ValueError("Paired service case has absent pairing or acquired unpaired rows")
        print(json.dumps({"queries": sequences, "copies": copies,
                          "unpaired_rows": None if unpaired is None else [x.count(">") for x in unpaired],
                          "paired_rows": None if paired is None else [x.count(">") for x in paired],
                          "msa_shape": list(result["msa"].shape),
                          "aatype_shape": list(result["aatype"].shape)}, indent=2))
        return
    retained = parse(fixture / "public-unpaired-20261005.a3m")
    if args.expect_original_failure:
        try:
            features(retained, "alphafold2_multimer_v3")
        except ValueError as error:
            if str(error) != "MSA 0 must contain at least one sequence.":
                raise
            print(json.dumps({"reproduced": str(error),
                              "parsed_queries": retained[2],
                              "paired_bytes": [len(x) for x in retained[1]]}, indent=2))
            return
        raise ValueError("The original empty paired-MSA failure did not reproduce")

    insulin = ["GIVEQCCTSICSLYQLENYCN", "FVNQHLCGSHLVEALYLVCGERGFFYTPKA"]
    full = parse(fixture / "insulin.a3m")
    # Select existing paired rows from the disclosed supplied fixture.
    # No service content is generated or relabelled by this diagnostic.
    paired_text = msa_to_str(None, full[1], full[2], full[3])
    paired_only = unserialize_msa([paired_text], "".join(full[2]))
    cases = {
        "retained-public-unpaired": (retained, insulin, "alphafold2_multimer_v3"),
        "supplied-paired-only": (paired_only, insulin, "alphafold2_multimer_v3"),
        "supplied-both": (full, insulin, "alphafold2_multimer_v3"),
        "supplied-homomer": (parse(fixture / "homomer.a3m"), ["AGSTAGSTAGSTAGST"], "alphafold2_multimer_v3"),
        "supplied-monomer": (parse(fixture / "monomer.a3m"), ["MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG"], "alphafold2_ptm"),
    }
    assert retained[1] is None, "Unpaired-only input acquired paired rows"
    assert paired_only[0] is None, "Paired-only input acquired unpaired rows"
    report = {}
    for name, (parsed, expected, mode) in cases.items():
        unpaired, paired, sequences, copies, _ = parsed
        if sequences != expected:
            raise ValueError(f"Query identity changed for {name}: {sequences}")
        result = features(parsed, mode)
        sequence = "".join(seq * n for seq, n in zip(sequences, copies, strict=True))
        aatype = result["aatype"]
        if aatype.ndim == 2:
            aatype = np.argmax(aatype, axis=-1)
        wanted = np.array([residue_constants.restype_order[x] for x in sequence])
        np.testing.assert_array_equal(aatype, wanted, err_msg=f"Feature residue axis changed for {name}")
        report[name] = {
            "queries": sequences, "copies": copies,
            "unpaired_rows": None if unpaired is None else [x.count(">") for x in unpaired],
            "paired_rows": None if paired is None else [x.count(">") for x in paired],
            "msa_shape": list(result["msa"].shape),
            "aatype_shape": list(result["aatype"].shape),
        }
    print(json.dumps({"native_feature_cases": report, "prediction": False}, indent=2))


if __name__ == "__main__":
    main()
