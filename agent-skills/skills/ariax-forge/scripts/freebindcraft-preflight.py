#!/usr/bin/env python3
"""Conservative offline target/register check; not the native model parser."""
import argparse
import json
import math
import re
from pathlib import Path

def check(settings: dict, pdb: str, family: str) -> dict:
    if not isinstance(settings, dict):
        raise ValueError("settings must be a JSON object")
    required = {"design_path", "binder_name", "starting_pdb", "chains",
                "target_hotspot_residues", "lengths", "number_of_final_designs"}
    if required - settings.keys():
        raise ValueError("missing settings keys: " + ", ".join(sorted(required - settings.keys())))
    lengths = settings["lengths"]
    if not isinstance(lengths, list) or len(lengths) != 2 or any(type(x) is not int for x in lengths):
        raise ValueError("lengths must contain two integers")
    lo, hi = lengths
    if lo > hi or (family == "peptide" and not 8 <= lo <= hi <= 30) or (family == "miniprotein" and lo < 31):
        raise ValueError("length range incompatible with chosen family")
    if type(settings["number_of_final_designs"]) is not int or settings["number_of_final_designs"] < 1:
        raise ValueError("accepted design target must be a positive integer")
    for key in ("starting_pdb", "design_path", "binder_name", "chains"):
        if not isinstance(settings[key], str) or not settings[key].strip():
            raise ValueError(key + " must be a nonempty string")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", settings["binder_name"]) or settings["binder_name"] in (".", ".."):
        raise ValueError("binder_name must be a simple filename stem")
    chains = settings["chains"].split(",")
    if len(chains) != len(set(chains)) or any(len(c) != 1 or c.isspace() for c in chains):
        raise ValueError("use distinct single-character PDB chains")
    residues = {}
    ca_residues = set()
    atom_ids = set()
    model_count = 0
    standard = set("ALA ARG ASN ASP CYS GLN GLU GLY HIS ILE LEU LYS MET PHE PRO SER THR TRP TYR VAL".split())
    for line in pdb.splitlines():
        if line.startswith("MODEL"):
            model_count += 1
            if model_count > 1:
                raise ValueError("multiple PDB models require a reviewed single-model copy")
        if line.startswith(("ATOM  ", "HETATM")) and line[21:22] in chains:
            if len(line) < 54:
                raise ValueError("truncated target atom record")
            if line[26] != " ":
                raise ValueError("insertion-coded residues require reviewed mapping; unsupported here")
            if line[16] != " ":
                raise ValueError("alternate conformers require a reviewed selection")
            residue_name = line[17:20]
            if not line.startswith("ATOM  ") or residue_name not in standard:
                raise ValueError("nonstandard target residue/context requires separate preparation")
            if not all(math.isfinite(float(line[a:b])) for a, b in ((30, 38), (38, 46), (46, 54))):
                raise ValueError("target has nonfinite coordinates")
            identity = (line[21], int(line[22:26]))
            if identity in residues and residues[identity] != residue_name:
                raise ValueError("ambiguous residue identity in author register")
            atom = (*identity, line[12:16].strip())
            if atom in atom_ids:
                raise ValueError("duplicate target atom/register")
            atom_ids.add(atom)
            residues[identity] = residue_name
            if atom[-1] == "CA":
                ca_residues.add(identity)
    if set(residues) != ca_residues:
        raise ValueError("selected residue lacks a CA representative")
    if set(chains) - {c for c, n in residues}:
        raise ValueError("selected target chain absent from ATOM records")
    hotspot = settings["target_hotspot_residues"]
    if not isinstance(hotspot, str):
        raise ValueError("hotspots must be a string; empty means no preference")
    for token in hotspot.split(",") if hotspot else []:
        match = re.fullmatch(r"([A-Za-z0-9])([0-9]+)(?:-([0-9]+))?", token)
        if not match:
            raise ValueError("use explicit chain-number hotspots or resolve unsupported syntax manually")
        c, a, b = match.groups()
        start, end = int(a), int(b or a)
        if start > end or end - start > len(residues):
            raise ValueError("invalid hotspot range")
        if any((c, n) not in residues for n in range(start, end + 1)):
            raise ValueError("hotspot absent from selected target author register")
    return {"family": family, "target_residues": len(residues), "chains": chains,
            "lengths": lengths, "atom_completeness_checked": False}

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--settings", required=True)
    parser.add_argument("--pdb", required=True, help="local PDB copy, independent of remote starting_pdb")
    parser.add_argument("--family", required=True, choices=["miniprotein", "peptide"])
    args = parser.parse_args()
    try:
        print(json.dumps(check(json.loads(Path(args.settings).read_text()), Path(args.pdb).read_text(), args.family)))
    except (ValueError, KeyError, TypeError, OSError) as exc:
        parser.exit(2, str(exc) + "\n")
