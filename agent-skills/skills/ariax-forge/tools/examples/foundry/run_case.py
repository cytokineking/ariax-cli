#!/usr/bin/env python3
"""Run one explicitly selected native case, or inspect its retained outputs."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import sys


def main() -> None:
    fixture = Path(__file__).resolve().parent
    cases = {item["id"]: item for item in json.loads((fixture / "cases.json").read_text())}
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("case", choices=cases)
    parser.add_argument("--check-only", action="store_true")
    args = parser.parse_args()
    case = cases[args.case]
    output = Path("/workspace/outputs") / args.case
    if not args.check_only:
        if output.exists():
            raise ValueError("Output directory exists; select --check-only to inspect retained results")
        output.mkdir(parents=True)
        with (output / "native.log").open("x") as log:
            subprocess.run(case["argv"], stdout=log, stderr=subprocess.STDOUT, check=True)
    stem = output / case["output_stem"]
    if case["tool"] == "rf3":
        stem = stem / case["output_stem"]
    checker = fixture.parents[1] / "checks/foundry_outputs.py"
    if not checker.exists():
        checker = fixture.parent / "foundry_outputs.py"  # installed image layout
    structure = Path(str(stem) + ("_model.cif" if case["tool"] == "rf3" else ".cif.gz"))
    command = [sys.executable, str(checker), str(structure),
               "--expected", str(fixture / case["expected"])]
    if case["tool"] == "rf3":
        command += ["--summary", str(stem) + "_summary_confidences.json",
                    "--confidences", str(stem) + "_confidences.json"]
    else:
        command += ["--metadata", str(stem) + ".json", "--checkpoint", case["model"]]
    # The report is ordinary inspected scientific output, never native-success evidence by itself.
    temporary = output / "inspection.json.part"
    with temporary.open("w") as report:
        subprocess.run(command, stdout=report, check=True)
    temporary.replace(output / "inspection.json")


if __name__ == "__main__":
    main()
