"""Prepare the B56 diagnostic from one explicitly named BoltzGen cohort on the VM."""
import argparse
import json
from pathlib import Path

TARGET = "MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG"
AA = set("ACDEFGHIKLMNPQRSTVWY")


def prepare(review: Path, cohort: str, candidate: str, out: Path, review_rejected: bool) -> dict:
    source = review.resolve(strict=True)
    destination = out.resolve()
    if not source.is_relative_to(Path("/workspace")) or not destination.is_relative_to(Path("/workspace")):
        raise ValueError("Keep reviews and new inputs under /workspace on the VM")
    if cohort not in {"B43", "B55g"} or candidate not in {"ubiquitin_0", "ubiquitin_1"}:
        raise ValueError("Choose an assigned retained cohort and native candidate ID")
    report = json.loads(source.read_text())
    groups = [report[key] for key in ("samples", "checked_decisions", "native_rows")]
    for rows in groups:
        if len(rows) != 2 or {row["id"] for row in rows} != {"ubiquitin_0", "ubiquitin_1"}:
            raise ValueError("Retained review must contain both unique native candidate IDs")
    sample, decision, native_row = [next(row for row in rows if row["id"] == candidate) for rows in groups]
    chain_map = sample["input_to_emitted_chain_mapping"]
    binder_chain, target_chain = chain_map["input_design_B"], chain_map["input_target_A"]
    if binder_chain == target_chain or set(sample["sequence_stage"]) != {binder_chain, target_chain}:
        raise ValueError("Checked native chains do not identify one binder and full target")
    binder = sample["sequence_stage"][binder_chain]
    target = sample["sequence_stage"][target_chain]
    if target != TARGET or len(binder) != 40 or not set(binder) <= AA or native_row["designed_sequence"] != binder:
        raise ValueError("Checked full 1UBQ target or actual binder sequence differs")
    accepted = decision["pass_filters"]
    if type(accepted) is not bool or native_row["pass_filters"].lower() not in {"true", "false"}:
        raise ValueError("Missing native boolean decision")
    if accepted != (native_row["pass_filters"].lower() == "true"):
        raise ValueError("Native CSV and checked decisions differ")
    if not accepted and not review_rejected:
        raise ValueError("Rejected candidate requires --review-rejected")
    # The source_root in the existing export is the authority for the cohort.
    selection_path = source.parent / "rejected-review" / candidate / "selection.json"
    if accepted:
        selection_path = source.parent / "accepted-selection" / candidate / "selection.json"
    selection = json.loads(selection_path.read_text())
    if (selection["candidate_id"] != candidate or selection["decision"] != decision
            or selection["input_to_emitted_chain_mapping"] != chain_map
            or selection["pass_filters"] is not accepted
            or Path(selection["source_root"]).name != cohort):
        raise ValueError("Selected export does not belong to the explicit cohort/candidate")
    export = selection_path.parent
    if (export / "binder.fasta").read_text().splitlines() != [f">{candidate}", binder]:
        raise ValueError("Selected binder FASTA differs from native checked sequence")
    if (export / "target.fasta").read_text().splitlines() != [f">{candidate}_target_{target_chain}", target]:
        raise ValueError("Selected target FASTA differs from native checked full target")
    name = f"{cohort}_{candidate}_full_target"
    request = [{"name": name, "sequences": [
        {"proteinChain": {"id": ["A"], "count": 1, "sequence": target}},
        {"proteinChain": {"id": ["B"], "count": 1, "sequence": binder}},
    ]}]
    roles = {
        "cohort": cohort, "native_candidate_id": candidate, "input_id": name,
        "review": str(source), "selection": selection, "generation_chain_map": chain_map,
        "evaluation_target": "A", "evaluation_binder": "B",
        "sequences": {"A": target, "B": binder}, "generation_filter_decision": decision,
        "msa": "none", "template": "none", "binding_claim": False,
    }
    destination.mkdir(parents=True, exist_ok=False)
    (destination / "input.json").write_text(json.dumps(request, indent=2, allow_nan=False) + "\n")
    (destination / "chain-roles.json").write_text(json.dumps(roles, indent=2, allow_nan=False) + "\n")
    return {"cohort": cohort, "candidate_id": candidate, "input_id": name,
            "generation_pass_filters": accepted, "out": str(destination)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("review", type=Path)
    parser.add_argument("--cohort", choices=["B43", "B55g"], required=True)
    parser.add_argument("--candidate", choices=["ubiquitin_0", "ubiquitin_1"], required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--review-rejected", action="store_true")
    args = parser.parse_args()
    print(json.dumps(prepare(args.review, args.cohort, args.candidate, args.out, args.review_rejected)))
