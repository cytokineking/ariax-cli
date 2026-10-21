"""Check the one-trajectory, one-redesign BindCraft2 fixture without a binding threshold."""
from __future__ import annotations

import csv
import json
import math
from pathlib import Path
import sys

import numpy as np
from biotite.sequence import ProteinSequence
from biotite.structure import AtomArrayStack
from biotite.structure.io import load_structure

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
    structure = load_structure(path)
    if isinstance(structure, AtomArrayStack):
        if structure.stack_depth() != 1:
            raise ValueError(f"Expected one model in {path}")
        structure = structure[0]
    if not np.isfinite(structure.coord).all():
        raise ValueError(f"Non-finite coordinates in {path}")
    alpha_carbons = structure[structure.atom_name == "CA"]
    result = {}
    for chain in np.unique(alpha_carbons.chain_id):
        names = alpha_carbons.res_name[alpha_carbons.chain_id == chain]
        result[str(chain)] = "".join(ProteinSequence.convert_letter_3to1(name) for name in names)
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
    trajectory = rows(output / "1_Trajectories/!_Trajectories.csv")[0]
    refolded = rows(output / "2_Refolded/!_Refolded.csv")[0]
    ranked = rows(output / "3_Ranked/!_Ranked.csv")[0]
    if trajectory["terminated"]:
        raise ValueError(f"Native trajectory terminated: {trajectory['terminated']}")
    binder = sequence(refolded["Binder_Sequence"])
    if ranked["Binder_Sequence"] != binder:
        raise ValueError("Native refold/ranked sequences disagree")
    if refolded["design"] != trajectory["design"] + "_candidate1" or ranked["design"] != trajectory["design"] + "_seq0":
        raise ValueError("Native candidate/ranked identifiers do not belong to the single trajectory")
    if refolded["outcome"] != "passed":
        raise ValueError("The native redesign did not pass its configured filters")
    trajectory_binder = sequence(trajectory["Binder_Sequence"])
    trajectory_structure = output / "1_Trajectories" / trajectory["design"] / f"{trajectory['design']}_trajectory.cif"
    inspect_complex(trajectory_structure, target_sequence, trajectory_binder)
    candidate = refolded["design"]
    refold_structure = output / "2_Refolded/Complexes" / f"{candidate}.cif"
    ranked_structure = output / "3_Ranked" / f"{ranked['design']}.cif"
    inspect_complex(refold_structure, target_sequence, binder)
    inspect_complex(ranked_structure, target_sequence, binder)
    return {"design": ranked["design"], "refold_design": candidate, "binder_sequence": binder, "target_residues": len(target_sequence),
            "confidence": confidence(refolded, ("pLDDT", "i_pTM")),
            "structures": [str(path) for path in (trajectory_structure, refold_structure, ranked_structure)]}


if __name__ == "__main__":
    try:
        print(json.dumps(check(Path(sys.argv[1]), Path(__file__).with_name("PDL1.pdb")), indent=2))
    except (ValueError, KeyError) as failure:
        raise SystemExit(str(failure))
    print("BindCraft2 fixture outputs passed; no biological binding claim")
