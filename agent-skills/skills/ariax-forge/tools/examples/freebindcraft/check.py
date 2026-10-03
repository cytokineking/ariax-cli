"""Check one native FreeBindCraft redesign, refolds and relaxed structures."""
from __future__ import annotations

import csv
import json
import math
from pathlib import Path
import sys

import gemmi

AMINO_ACIDS = set("ACDEFGHIKLMNPQRSTVWY")


def rows(path: Path) -> list[dict[str, str]]:
    if not path.is_file():
        raise ValueError(f"Missing result: {path}")
    with path.open(newline="") as stream:
        values = list(csv.DictReader(stream))
    if len(values) != 1:
        raise ValueError(f"Expected one completed design row in {path}, found {len(values)}")
    return values


def chain_sequences(path: Path) -> dict[str, str]:
    if not path.is_file() or path.stat().st_size == 0:
        raise ValueError(f"Missing/empty structure: {path}")
    structure = gemmi.read_structure(str(path))
    if len(structure) != 1:
        raise ValueError(f"Expected one model in {path}")
    result = {}
    for chain in structure[0]:
        residues = [res for res in chain if res.find_atom("CA", "*")]
        result[chain.name] = "".join(gemmi.find_tabulated_residue(res.name).one_letter_code for res in residues)
        for residue in residues:
            for atom in residue:
                if not all(math.isfinite(value) for value in (atom.pos.x, atom.pos.y, atom.pos.z)):
                    raise ValueError(f"Non-finite coordinates in {path}")
    return result


def inspect_complex(path: Path, target_sequence: str, binder_sequence: str) -> None:
    actual = chain_sequences(path)
    if actual != {"A": target_sequence, "B": binder_sequence}:
        raise ValueError(f"Structure sequences disagree with requested target/design in {path}: {actual}")


def sequence(value: str) -> str:
    if len(value) != 31 or not set(value) <= AMINO_ACIDS:
        raise ValueError(f"Expected a 31-residue native binder sequence, got {value!r}")
    return value


def confidence(row: dict[str, str], fields: tuple[str, ...]) -> dict[str, float]:
    result = {field: float(row[field]) for field in fields}
    if not all(math.isfinite(value) and 0 <= value <= 1 for value in result.values()):
        raise ValueError(f"Invalid native confidence values: {result}")
    return result


def check(output: Path, target: Path) -> dict[str, object]:
    target_sequence = chain_sequences(target)["A"]
    trajectory = rows(output / "trajectory_stats.csv")[0]
    redesigned = rows(output / "mpnn_design_stats.csv")[0]
    final = rows(output / "final_design_stats.csv")[0]
    original_binder = sequence(trajectory["Sequence"])
    binder = sequence(redesigned["Sequence"])
    if final["Sequence"] != binder or final["Design"] != redesigned["Design"]:
        raise ValueError("Native redesigned/final records disagree")
    trajectory_name = trajectory["Design"]
    design = redesigned["Design"]
    structures = []
    for folder in ("Trajectory", "Trajectory/Relaxed"):
        path = output / folder / f"{trajectory_name}.pdb"
        inspect_complex(path, target_sequence, original_binder)
        structures.append(path)
    for model in (1, 2):
        for folder in ("MPNN", "MPNN/Relaxed"):
            path = output / folder / f"{design}_model{model}.pdb"
            inspect_complex(path, target_sequence, binder)
            structures.append(path)
    accepted = list((output / "Accepted").glob("*.pdb"))
    if len(accepted) != 1:
        raise ValueError(f"Expected one accepted relaxed structure, found {len(accepted)}")
    inspect_complex(accepted[0], target_sequence, binder)
    fasta = output / "MPNN/Sequences" / f"{design}.fasta"
    if not fasta.is_file():
        raise ValueError(f"Missing native redesigned FASTA: {fasta}")
    written_sequence = "".join(line.strip() for line in fasta.read_text().splitlines() if not line.startswith(">"))
    if written_sequence != binder:
        raise ValueError("Native FASTA and design record disagree")
    return {"design": design, "binder_sequence": binder, "target_residues": len(target_sequence),
            "confidence": confidence(redesigned, ("Average_pLDDT", "Average_pTM", "Average_i_pTM")),
            "structures": [str(path) for path in (*structures, accepted[0])], "fasta": str(fasta)}


if __name__ == "__main__":
    try:
        print(json.dumps(check(Path(sys.argv[1]), Path(__file__).with_name("PDL1.pdb")), indent=2))
    except (ValueError, KeyError) as failure:
        raise SystemExit(str(failure))
    print("FreeBindCraft fixture outputs passed; no biological binding claim")
