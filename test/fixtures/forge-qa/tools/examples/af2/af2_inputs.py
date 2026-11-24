#!/usr/bin/env python3
"""Exercise the installed ColabFold input parser on the supplied B31 fixtures.

This is a parser check, not native prediction evidence. For a local source check,
set PYTHONPATH to the pinned checkout after applying the shipped patches.
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
import tempfile

from colabfold.input import get_queries


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("fixtures", type=Path)
    args = parser.parse_args()
    fixtures = args.fixtures.resolve()
    seq = "MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG"
    expected = {
        "monomer.a3m": ([("monomer", seq)], False),
        "paired.a3m": ([("paired", "AGSTAGSTAGSTAGSTGSTAGSTAGSTAGSTA")], True),
        "homomer.a3m": ([("homomer", "AGSTAGSTAGSTAGST")], True),
        "insulin.a3m": ([("insulin", "GIVEQCCTSICSLYQLENYCNFVNQHLCGSHLVEALYLVCGERGFFYTPKA")], True),
        "insulin.fasta": ([("insulin", ["GIVEQCCTSICSLYQLENYCN", "FVNQHLCGSHLVEALYLVCGERGFFYTPKA"])], True),
        "batch.fasta": ([("ubiquitin", seq), ("ubiquitin_variant", seq[:-1] + "A")], False),
        "search.fasta": ([("ubiquitin", seq)], False),
    }
    report = {}
    for filename, (wanted, complex_input) in expected.items():
        queries, is_complex = get_queries(fixtures / filename, "none")
        observed = [(q[0], q[1]) for q in queries]
        if observed != wanted or is_complex != complex_input:
            raise ValueError(f"Native input parser changed construct: {filename}: {observed}")
        report[filename] = {"queries": observed, "complex": is_complex}
    # Rewrite only the mount prefix for local checks. Image fixtures retain /inputs.
    with tempfile.TemporaryDirectory() as temporary:
        for filename in ("supplied.csv", "templates.csv"):
            path = Path(temporary) / filename
            path.write_text((fixtures / filename).read_text().replace("/inputs/af2", str(fixtures)))
            queries, is_complex = get_queries(path, "msa_depth")
            if len(queries) != 1 or queries[0][1] != seq or is_complex:
                raise ValueError(f"CSV supplied alignment changed construct: {filename}")
            if queries[0][2] != fixtures / "monomer.a3m":
                raise ValueError("CSV lost the selected supplied MSA")
            if filename == "templates.csv" and queries[0][3] != fixtures / "templates/1ubq.cif":
                raise ValueError("CSV lost the selected custom template")
            report[filename] = {"queries": 1, "supplied_alignment": True}
        # A complex CSV with a Path must also retain complex detection.
        path = Path(temporary) / "paired.csv"
        with path.open("w") as handle:
            writer = csv.writer(handle)
            writer.writerow(["id", "sequence", "a3mpath"])
            writer.writerow(["paired", "AGSTAGSTAGSTAGSTGSTAGSTAGSTAGSTA", fixtures / "paired.a3m"])
        queries, is_complex = get_queries(path, "msa_depth")
        if not is_complex or queries[0][2] != fixtures / "paired.a3m":
            raise ValueError("CSV Path lost supplied complex metadata")
        report["paired.csv"] = {"complex": True, "supplied_alignment": True}
    print(json.dumps({"parser_only": True, "inputs": report}, indent=2))


if __name__ == "__main__":
    main()
