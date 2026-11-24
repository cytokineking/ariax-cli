"""Export checked native RFantibody candidates without changing screening decisions."""
import argparse
import json
from pathlib import Path
import shutil
import re


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path, help="Parent of checked profile directories")
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--candidate", action="append", default=[])
    parser.add_argument("--review-rejected", action="store_true")
    args = parser.parse_args()
    root = args.root.resolve(strict=True)
    out = args.out.resolve()
    if not root.is_relative_to(Path("/workspace")) or not out.is_relative_to(Path("/workspace")):
        raise ValueError("Keep native results and exports under /workspace on the VM")
    candidates = {}
    for report_file in sorted(root.rglob("*.json")):
        report = json.loads(report_file.read_text())
        if not isinstance(report, dict) or not {"filter", "sequences", "confidence_residue_map"} <= report.keys():
            continue
        if report_file.parent.name == "checks":
            directory, stem = report_file.parent.parent, report_file.stem
        else:
            match = re.fullmatch(r"check-(\d+)", report_file.stem)
            if not match:
                continue
            directory, stem = report_file.parent, f"design_0_dldesign_{match[1]}"
        if not re.fullmatch(r"design_\d+_dldesign_\d+", stem):
            raise ValueError("Report filename must retain its native design/sequence identity")
        generated = stem.split("_dldesign_")[0]
        candidate = str(directory.relative_to(root) / stem)
        if candidate in candidates:
            raise ValueError("Duplicate native candidate report")
        chains = ["H", "L", "T"] if "L" in report["sequences"] else ["H", "T"]
        if set(report["sequences"]) != set(chains) or type(report["filter"]["accepted"]) is not bool:
            raise ValueError("Missing native chains or screening decision")
        if report["native_confidence_chain_order"] != ["T", *chains[:-1]]:
            raise ValueError("RF2 confidence chain order differs from the checked construct")
        count = sum(map(len, report["sequences"].values()))
        if [row["array_index_zero_based"] for row in report["confidence_residue_map"]] != list(range(count)):
            raise ValueError("Incomplete native confidence residue map")
        predicted = directory / "predict/pdbs" / (stem + "_best.pdb")
        files = [report_file, predicted, predicted.with_suffix(".native.npz"),
                 directory / "generate/pdbs" / (generated + ".pdb"),
                 directory / "generate/pdbs" / (generated + ".trb"),
                 directory / "sequence/pdbs" / (stem + ".pdb")]
        files += [directory / stage / "stage.json" for stage in ("generate", "sequence", "predict")]
        files += [file for file in (directory / "generate").rglob(generated + "*") if file.is_file() and file not in files]
        source_map = directory / "generate/input-residue-map.json"
        if source_map.is_file():files.append(source_map)
        for file in files:
            if not file.is_file() or not file.resolve(strict=True).is_relative_to(root):
                raise ValueError("Missing native same-candidate/stage file")
        candidates[candidate] = {"report": report, "files": files, "directory": directory}
    if len(set(args.candidate)) != len(args.candidate) or not set(args.candidate) <= set(candidates):
        raise ValueError("Select unique modality/native sequence IDs")
    for candidate in args.candidate:
        if not candidates[candidate]["report"]["filter"]["accepted"] and not args.review_rejected:
            raise ValueError("Rejected candidate requires --review-rejected")
    out.mkdir(parents=True, exist_ok=False)
    (out / "review.json").write_text(json.dumps({
        "candidates": {key: value["report"] for key, value in candidates.items()},
        "accepted_count": sum(c["report"]["filter"]["accepted"] for c in candidates.values()),
        "selected_ids": args.candidate, "binding_claim": False,
    }, indent=2) + "\n")
    for candidate in args.candidate:
        item = candidates[candidate]
        accepted = item["report"]["filter"]["accepted"]
        directory = out / ("accepted-selection" if accepted else "rejected-review") / candidate
        directory.mkdir(parents=True)
        for file in item["files"]:
            destination = directory / file.relative_to(item["directory"])
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(file, destination)
        for chain in ("H", "L", "T"):
            if chain in item["report"]["sequences"]:
                sequence = item["report"]["sequences"][chain]
                (directory / (chain + ".fasta")).write_text(f">{candidate.replace('/', '_')}_{chain}\n{sequence}\n")
    print(json.dumps({"out": str(out), "selected_ids": args.candidate,
                      "accepted_selected": sum(candidates[c]["report"]["filter"]["accepted"] for c in args.candidate)}))


if __name__ == "__main__":
    main()
