"""Inspect and explicitly export the retained B51 motif with its native rejection."""
import argparse
import csv
import json
import math
from pathlib import Path
import shutil


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    parser.add_argument("--candidate", required=True)
    parser.add_argument("--generation-check", required=True, type=Path)
    parser.add_argument("--prediction-check", required=True, type=Path)
    parser.add_argument("--motif-check", required=True, type=Path)
    parser.add_argument("--motif-inputs", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--review-rejected", action="store_true")
    args = parser.parse_args()
    root = args.root.resolve(strict=True)
    out = args.out.resolve()
    inputs = args.motif_inputs.resolve(strict=True)
    if not root.is_relative_to(Path("/workspace")) or not out.is_relative_to(Path("/workspace")) or not inputs.is_relative_to(Path("/inputs")):
        raise ValueError("Keep retained results/exports in /workspace and motif inputs in /inputs")
    if args.candidate != "04_5WN9_0":
        raise ValueError("This retained B51 fixture requires its actual candidate 04_5WN9_0")
    generation = json.loads(args.generation_check.read_text())
    prediction = json.loads(args.prediction_check.read_text())
    metrics = json.loads(args.motif_check.read_text())
    sequence_map = json.loads((root / "predict-input-motif/sequence-map.json").read_text())
    native = sequence_map["native"]
    if native["mode"] != "motif" or Path(native["source_pdb"]).stem != args.candidate:
        raise ValueError("Handoff candidate/mode differs")
    with (root / "motif/04_5WN9/scaffold_info.tsv").open() as stream:
        rows = list(csv.DictReader(stream, delimiter="\t"))
    if len(rows) != 1 or rows[0]["name"] != args.candidate:
        raise ValueError("Sampled scaffold configuration differs")
    chains = sequence_map["chains"]
    if prediction["chain_sequences"] != chains or generation["source_identity_retained"] is not True:
        raise ValueError("Native/checker sequence or source identity differs")
    fasta = (root / "mpnn-motif/seqs/backbone.fa").read_text().splitlines()
    if len(fasta) != 4 or "CA_model_name=v_48_020" not in fasta[0] or fasta[3].split("/") != list(chains.values()):
        raise ValueError("Retained CA-only MPNN sample does not identify the final sequence")
    fixed_positions = json.loads((root / "prepared-motif/fixed_positions.jsonl").read_text())["backbone"]
    fixed = []
    expected_positions = {}
    offsets = {}
    for residue in native["residues"]:
        chain, label = residue["native_residue"].split(":")
        offsets[chain] = offsets.get(chain, 0) + 1
        if residue["fixed_aa"] is not None:
            if residue["design"] or chains[chain][offsets[chain] - 1] != residue["fixed_aa"]:
                raise ValueError("Fixed motif sequence changed")
            expected_positions.setdefault(chain, []).append(offsets[chain])
            fixed.append({**residue, "sequence_position_one_based": offsets[chain]})
    if fixed_positions != expected_positions or not fixed:
        raise ValueError("Native motif and MPNN fixed-position maps differ")
    values = {key: metrics[key] for key in ("identity_ca_rmsd_angstrom", "motif_backbone_rmsd", "motif_allatom_rmsd")}
    if any(not math.isfinite(value) for value in values.values()) or abs(values["identity_ca_rmsd_angstrom"] - prediction["identity_matched_ca_rmsd_angstrom"]) > 1e-8:
        raise ValueError("Native motif and predictor agreement differ")
    decisions = {
        "backbone_success": values["identity_ca_rmsd_angstrom"] < 2 and values["motif_backbone_rmsd"] < 1,
        "allatom_success": values["identity_ca_rmsd_angstrom"] < 2 and values["motif_backbone_rmsd"] < 1 and values["motif_allatom_rmsd"] < 2,
        "strict_allatom_success": values["identity_ca_rmsd_angstrom"] < 2 and values["motif_backbone_rmsd"] < 1 and values["motif_allatom_rmsd"] < 1,
    }
    if any(type(metrics[key]) is not bool or metrics[key] != value for key, value in decisions.items()):
        raise ValueError("Native motif flags disagree with unchanged thresholds")
    accepted = decisions["allatom_success"]
    if not accepted and not args.review_rejected:
        raise ValueError("Rejected candidate requires --review-rejected")
    selected_paths = [root / name for name in (
        "motif", "handoff-motif", "prepared-motif", "mpnn-motif", "predict-input-motif", "predict-motif", "motif-final-prediction.pdb")]
    files = []
    for path in selected_paths:
        files.extend(sorted(path.rglob("*")) if path.is_dir() else [path])
    files = [path for path in files if path.is_file()]
    for path in files:
        if path.is_symlink() or not path.resolve(strict=True).is_relative_to(root):
            raise ValueError("Unsafe retained native file")
    report = {
        "candidate_id": args.candidate, "sampled_scaffold": rows[0], "chain_sequences": chains,
        "fixed_sequence_preserved": True, "fixed_positions": fixed,
        "native_motif_metrics": metrics, "native_filter_decisions": decisions,
        "accepted": accepted, "review_rejected": args.review_rejected,
        "generation_check": generation, "prediction_check": prediction,
        "unavailable_colabfold_metrics": ["binder_ptm", "minimum_interface_pae", "native_hotspot_coverage"],
        "missing_motif_source_atoms": metrics["motif_allatom_n_missing_atom_verbose"],
        "binding_claim": False,
    }
    out.mkdir(parents=True, exist_ok=False)
    (out / "review.json").write_text(json.dumps(report, indent=2) + "\n")
    destination = out / ("accepted-selection" if accepted else "rejected-review") / args.candidate
    destination.mkdir(parents=True)
    (destination / "scaffold.fasta").write_text("".join(f">{args.candidate}_{chain}\n{sequence}\n" for chain, sequence in chains.items()))
    shutil.copyfile(root / "motif-final-prediction.pdb", destination / "motif-final-prediction.pdb")
    for path in files:
        target = destination / "native" / path.relative_to(root)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, target)
    for path in (args.generation_check, args.prediction_check, args.motif_check):
        shutil.copyfile(path, destination / path.name)
    shutil.copytree(inputs, destination / "motif-inputs")
    print(json.dumps({"candidate_id": args.candidate, "accepted": accepted, "fixed_positions": len(fixed), "out": str(out)}))


if __name__ == "__main__":
    main()
