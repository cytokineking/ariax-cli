"""Inspect the one-sample synthetic Boltz2 result, without a score target."""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import gemmi
import numpy as np

prediction = Path(sys.argv[1]) / "boltz_results_complex" / "predictions" / "complex"
structure_path = prediction / "complex_model_0.cif"
confidence_path = prediction / "confidence_complex_model_0.json"
pae_path = prediction / "pae_complex_model_0.npz"
plddt_path = prediction / "plddt_complex_model_0.npz"
for path in (structure_path, confidence_path, pae_path, plddt_path):
    if not path.is_file() or path.stat().st_size == 0:
        raise SystemExit(f"Missing/empty result: {path}")
structure = gemmi.read_structure(str(structure_path))
if len(structure) != 1:
    raise SystemExit("Expected one structural model")
chains = {chain.name: chain for chain in structure[0]}
if set(chains) != {"A", "B"}:
    raise SystemExit(f"Unexpected structural chains: {list(chains)}")
for chain_id, sequence in (("A", "AGSTAGST"), ("B", "GSTAGSTA")):
    residues = [res for res in chains[chain_id] if res.find_atom("CA", "*")]
    actual_sequence = "".join(gemmi.find_tabulated_residue(res.name).one_letter_code for res in residues)
    if actual_sequence != sequence:
        raise SystemExit(f"Unexpected sequence in chain {chain_id}: {actual_sequence}")
    for residue in residues:
        for atom in residue:
            if not all(math.isfinite(value) for value in (atom.pos.x, atom.pos.y, atom.pos.z)):
                raise SystemExit("Non-finite coordinates")
confidence = json.loads(confidence_path.read_text())
for field in ("confidence_score", "ptm", "iptm", "complex_plddt"):
    value = confidence[field]
    if not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 1:
        raise SystemExit(f"Invalid confidence field {field}: {value!r}")
with np.load(pae_path, allow_pickle=False) as data:
    pae = data["pae"]
with np.load(plddt_path, allow_pickle=False) as data:
    plddt = data["plddt"]
if pae.shape != (16, 16) or not np.isfinite(pae).all() or (pae < 0).any():
    raise SystemExit(f"Invalid PAE for 16 protein residues: {pae.shape}")
if plddt.shape != (16,) or not np.isfinite(plddt).all() or (plddt < 0).any() or (plddt > 1).any():
    raise SystemExit(f"Invalid Boltz pLDDT: {plddt.shape}")
print(json.dumps({"prediction": str(prediction), "chains": {key: len(chain) for key, chain in chains.items()},
                  "pae_shape": list(pae.shape), "confidence": {key: confidence[key] for key in
                  ("confidence_score", "ptm", "iptm", "complex_plddt")}}, indent=2))
print("Boltz2 fixture files passed; this does not establish biological binding")
