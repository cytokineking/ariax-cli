"""Export an explicitly chosen, checked native BoltzGen candidate on the VM."""
import argparse
import csv
import json
from pathlib import Path
import shutil


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    parser.add_argument("--check", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--candidate", action="append", default=[])
    parser.add_argument("--review-rejected", action="store_true")
    args = parser.parse_args()
    root = args.root.resolve(strict=True)
    out = args.out.resolve()
    if not root.is_relative_to(Path("/workspace")) or not out.is_relative_to(Path("/workspace")):
        raise ValueError("Keep native results and exports under /workspace on the VM")
    with (root / "final_ranked_designs/all_designs_metrics.csv").open() as stream:
        rows = list(csv.DictReader(stream))
    check = json.loads(args.check.read_text())
    samples = {sample["id"]: sample for sample in check["samples"]}
    decisions = {row["id"]: row for row in check["filter_decisions"]}
    if len(samples) != len(check["samples"]) or len(decisions) != len(check["filter_decisions"]):
        raise ValueError("Duplicate checked candidate identity")
    if len(rows) != len(samples) or {row["id"] for row in rows} != set(samples) or set(samples) != set(decisions):
        raise ValueError("Native CSV and checked candidate identities differ")
    if len(set(args.candidate)) != len(args.candidate) or not set(args.candidate) <= set(samples):
        raise ValueError("Select unique existing native candidate IDs")
    selected = []
    for candidate in args.candidate:
        row = next(row for row in rows if row["id"] == candidate)
        decision = decisions[candidate]
        if type(decision["pass_filters"]) is not bool or row["pass_filters"].lower() not in {"true", "false"}:
            raise ValueError("Missing native boolean acceptance")
        accepted = decision["pass_filters"]
        if accepted != (row["pass_filters"].lower() == "true"):
            raise ValueError("Native CSV/checker decisions differ")
        if not accepted and not args.review_rejected:
            raise ValueError("Rejected candidate requires --review-rejected")
        filename = row["file_name"]
        if Path(filename).name != filename or Path(filename).stem != candidate or Path(candidate).name != candidate:
            raise ValueError("Candidate filename/ID does not identify one native refold")
        sequence_dir = root / "intermediate_designs_inverse_folded"
        files = [sequence_dir / "refold_cif" / filename,
                 sequence_dir / "fold_out_npz" / (candidate + ".npz")]
        for file in files:
            if not file.resolve(strict=True).is_relative_to(root) or not file.is_file():
                raise ValueError("Missing native same-candidate file")
        binder_chain = samples[candidate]["input_to_emitted_chain_mapping"]["input_design_B"]
        sequence = samples[candidate]["sequence_stage"][binder_chain]
        if sequence != row["designed_sequence"]:
            raise ValueError("Native CSV and checked binder sequence differ")
        target_chain = samples[candidate]["input_to_emitted_chain_mapping"]["input_target_A"]
        target_sequence = samples[candidate]["sequence_stage"][target_chain]
        context = [root / "intermediate_designs" / (candidate + suffix) for suffix in (".cif", ".npz")]
        context += [sequence_dir / (candidate + suffix) for suffix in (".cif", ".npz")]
        context += [sequence_dir / folder / (candidate + suffix) for folder, suffix in (
            ("fold_out_design_npz", ".npz"), ("refold_design_cif", ".cif"))]
        context += [root / "steps.yaml", root / "final_ranked_designs/all_designs_metrics.csv"]
        context += sorted((root / "config").glob("*.yaml"))
        for file in context:
            if not file.resolve(strict=True).is_relative_to(root) or not file.is_file():
                raise ValueError("Missing native provenance or same-candidate context")
        selected.append((candidate, accepted, sequence, target_chain, target_sequence, files, context))
    out.mkdir(parents=True, exist_ok=False)
    (out / "review.json").write_text(json.dumps({
        "native_rows": rows, "checked_decisions": check["filter_decisions"],
        "samples": check["samples"], "unavailable_metric_columns": check["unavailable_metric_columns"],
        "accepted_count": sum(d["pass_filters"] for d in decisions.values()),
        "selected_ids": args.candidate, "binding_claim": False,
    }, indent=2) + "\n")
    for candidate, accepted, sequence, target_chain, target_sequence, files, context in selected:
        directory = out / ("accepted-selection" if accepted else "rejected-review") / candidate
        directory.mkdir(parents=True)
        for file in files:
            shutil.copyfile(file, directory / file.name)
        (directory / "binder.fasta").write_text(f">{candidate}\n{sequence}\n")
        (directory / "target.fasta").write_text(f">{candidate}_target_{target_chain}\n{target_sequence}\n")
        (directory / "native-check.json").write_text(json.dumps(check, indent=2) + "\n")
        for file in context:
            destination = directory / "native" / file.relative_to(root)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(file, destination)
        (directory / "selection.json").write_text(json.dumps({
            "candidate_id": candidate, "native_rank": decisions[candidate]["rank"],
            "pass_filters": accepted, "review_rejected": args.review_rejected,
            "decision": decisions[candidate], "source_root": str(root),
            "input_to_emitted_chain_mapping": samples[candidate]["input_to_emitted_chain_mapping"],
            "binding_claim": False,
        }, indent=2) + "\n")
    print(json.dumps({"out": str(out), "selected_ids": args.candidate,
                      "accepted_selected": sum(item[1] for item in selected)}))


if __name__ == "__main__":
    main()
