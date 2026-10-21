#!/usr/bin/env python3
"""Prepare the explicit 1TIM monomer/dimer qualification inputs from a downloaded PDB."""

import argparse
import csv
import json
from pathlib import Path

AMINO = dict(zip(
    ("ALA", "ARG", "ASN", "ASP", "CYS", "GLN", "GLU", "GLY", "HIS", "ILE", "LEU",
     "LYS", "MET", "PHE", "PRO", "SER", "THR", "TRP", "TYR", "VAL"),
    "ARNDCQEGHILKMFPSTWYV",
))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdb", type=Path)
    parser.add_argument("--out-dir", type=Path, required=True)
    args = parser.parse_args()
    args.out_dir.mkdir(exist_ok=False, parents=True)
    raw = args.pdb.read_text().splitlines()
    summary = {}
    for name, chains, count in [("tim-monomer", "A", 247), ("tim-dimer", "AB", 494)]:
        lines = []
        rows = []
        for line in raw:
            if not line.startswith("ATOM  ") or line[21] not in chains or line[16] != " " or line[12:16].strip() == "OXT":
                continue
            if line[17:20] not in AMINO or line[26] != " ":
                raise ValueError("Review nonstandard residue or insertion code")
            chain = {"A": "Y", "B": "Z"}[line[21]]
            number = int(line[22:26]) + {"A": 1000, "B": 2000}[line[21]]
            lines.append(line[:21] + chain + f"{number:4d}" + line[26:])
            if line[12:16].strip() == "CA":
                rows.append({
                    "position": len(rows),
                    "source_chain_id": line[21],
                    "source_residue_number": int(line[22:26]),
                    "chain_id": chain,
                    "residue_number": number,
                    "amino_acid": AMINO[line[17:20]],
                })
        if len(rows) != count:
            raise ValueError(f"{name}: expected {count} residues, got {len(rows)}")
        (args.out_dir / (name + ".pdb")).write_text("\n".join(lines) + "\nEND\n")
        (args.out_dir / (name + "-source-map.json")).write_text(json.dumps(rows, indent=2) + "\n")
        positions = [0, 1, len(rows) // 2, len(rows) - 1]
        tokens = [
            rows[index]["amino_acid"] + str(index) + ("G" if rows[index]["amino_acid"] == "A" else "A")
            for index in positions
        ]
        groups = ["wt"] + tokens + [":".join(tokens[:2]), ":".join(tokens[2:]), ":".join(tokens)]
        if name == "tim-dimer":
            groups += list(reversed(groups))
        with (args.out_dir / (name + "-mutations.csv")).open("w") as stream:
            writer = csv.writer(stream)
            writer.writerow(["mutations"])
            writer.writerows([[group] for group in groups])
        by_chain: dict[str, list[str]] = {}
        for row in rows:
            by_chain.setdefault(row["chain_id"], []).append(row["chain_id"] + str(row["residue_number"]))
        summary[name] = {
            "residues": len(rows),
            "mutation_groups": len(groups),
            "fixed_sequence": ",".join(position for chain_rows in by_chain.values() for position in chain_rows[:10]),
            "fixed_sidechains": ",".join(position for chain_rows in by_chain.values() for position in chain_rows[:5]),
            "all_sequence_positions": ",".join(position for chain_rows in by_chain.values() for position in chain_rows),
        }
    (args.out_dir / "profiles.json").write_text(json.dumps(summary, indent=2) + "\n")


if __name__ == "__main__":
    main()
