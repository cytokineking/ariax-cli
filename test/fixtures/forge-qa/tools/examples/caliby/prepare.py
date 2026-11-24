#!/usr/bin/env python3
"""Prepare small chain-control and correspondence fixtures from public 1CRN."""
import argparse
from pathlib import Path
p = argparse.ArgumentParser()
p.add_argument("source", type=Path)
p.add_argument("destination", type=Path)
a = p.parse_args()
a.destination.mkdir(parents=True, exist_ok=True)
lines = [x for x in a.source.read_text().splitlines() if x.startswith("ATOM  ")]
(a.destination / "monomer").mkdir(exist_ok=True)
(a.destination / "monomer/1crn.pdb").write_text("\n".join(lines) + "\nEND\n")
multichain = lines + [x[:21] + "B" + x[22:30] + f"{float(x[30:38])+25:8.3f}" + x[38:] for x in lines]
(a.destination / "multichain").mkdir(exist_ok=True)
(a.destination / "multichain/pair.pdb").write_text("\n".join(multichain) + "\nEND\n")
(a.destination / "constraints.csv").write_text('pdb_key,fixed_pos_seq,pos_restrict_aatype\n1crn,A1-5,A6:AG\npair,"A1-5,B",A6:AG\n')
