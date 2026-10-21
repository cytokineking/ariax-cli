"""Run unchanged native motif metrics on one explicit B56 managed join.

Execute in the accepted Genie3 image on the authorized GPU VM. A saved-output
check reads the existing PDB; --prepare-pdb explicitly creates its first copy.
"""
import argparse
import csv
import json
from pathlib import Path

import gemmi
from genie3.evaluation.reducer.scaffold import ScaffoldReducer
from genie3.evaluation.utils.parse import parse_motif


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--motif-inputs", type=Path, required=True)
    parser.add_argument("--cif", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--prepare-pdb", action="store_true")
    args = parser.parse_args()
    root = args.root.resolve(strict=True)
    inputs = args.motif_inputs.resolve(strict=True)
    cif = args.cif.resolve(strict=True)
    report = args.report.resolve()
    if not root.is_relative_to(Path("/workspace")) or not cif.is_relative_to(root):
        raise ValueError("Keep this explicit attempt and prediction in /workspace")
    if not inputs.is_relative_to(Path("/inputs")) or not report.is_relative_to(root):
        raise ValueError("Use registered motif inputs and an attempt-local report")
    if report.exists():
        raise FileExistsError(report)

    domain = "04_5WN9_0"
    with (root / "motif/04_5WN9/scaffold_info.tsv").open() as stream:
        rows = list(csv.DictReader(stream, delimiter="\t"))
    if len(rows) != 1 or rows[0]["name"] != domain:
        raise ValueError("Select the actual retained B56 motif candidate")
    prediction = json.loads((root / "motif-prediction-check.json").read_text())
    pdb = root / "motif-final-prediction.pdb"
    text = gemmi.read_structure(str(cif)).make_pdb_string()
    if args.prepare_pdb:
        with pdb.open("x") as stream:
            stream.write(text)
    elif pdb.read_bytes() != text.encode():
        raise ValueError("Saved PDB differs from the same CIF conversion")

    segments = parse_motif(str(inputs), "04_5WN9")
    metrics = ScaffoldReducer._compute_motif_agreement(
        None, domain, str(pdb), {domain: rows[0]["config"]}, segments
    )
    ca = prediction["identity_matched_ca_rmsd_angstrom"]
    metrics.update(
        identity_ca_rmsd_angstrom=ca,
        backbone_success=ca < 2 and metrics["motif_backbone_rmsd"] < 1,
        allatom_success=ca < 2 and metrics["motif_backbone_rmsd"] < 1
        and metrics["motif_allatom_rmsd"] < 2,
        strict_allatom_success=ca < 2 and metrics["motif_backbone_rmsd"] < 1
        and metrics["motif_allatom_rmsd"] < 1,
        definition="Unchanged upstream ScaffoldReducer motif computation and filters; one managed CA-only ProteinMPNN/Boltz2 join.",
    )
    serialized = json.dumps(metrics, indent=2, allow_nan=False) + "\n"
    with report.open("x") as stream:
        stream.write(serialized)
    print(json.dumps({"candidate": domain, "report": str(report)}))


if __name__ == "__main__":
    main()
