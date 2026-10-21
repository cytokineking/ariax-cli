#!/usr/bin/env python3
"""Inspect native Boltz 2.2.1 outputs against one staged YAML input.

Uses Boltz's tokenizer on its processed structure. No inference is performed.
Chemical inspection reads only trusted native molecule files from this run and
the prepared model mount, using the same RDKit objects as the native loader.
"""
from __future__ import annotations

import argparse
from collections import Counter
import json
import math
from pathlib import Path
import pickle
from types import SimpleNamespace

import gemmi
import numpy as np
import yaml
from boltz.data.tokenize.boltz2 import tokenize_structure
from boltz.data import const


def nonempty(path: Path) -> Path:
    if not path.is_file() or not path.stat().st_size:
        raise ValueError(f"Missing/empty native output: {path}")
    return path


def finite_number(value: object, name: str, probability: bool = False) -> float:
    if type(value) not in (float, int) or not math.isfinite(value):
        raise ValueError(f"{name} must be a finite JSON number")
    if probability and not 0 <= value <= 1:
        raise ValueError(f"{name} must be in [0, 1]")
    return value


def array(path: Path, key: str) -> np.ndarray:
    with np.load(nonempty(path), allow_pickle=False) as data:
        return data[key].copy()


def check_constraints(spec: dict, record: dict, native: SimpleNamespace, chain_map: dict) -> None:
    atom_map = {}
    for chain in native.chains:
        for res in native.residues[int(chain["res_idx"]):int(chain["res_idx"] + chain["res_num"])]:
            for i in range(int(res["atom_idx"]), int(res["atom_idx"] + res["atom_num"])):
                atom_map[(str(chain["name"]), int(res["res_idx"]) + 1, str(native.atoms[i]["name"]))] = i

    def token(value):
        name, position = value
        if isinstance(position, str):
            return [chain_map[name], atom_map[(name, 1, position)]]
        return [chain_map[name], position - 1]

    expected_pockets, expected_contacts = [], []
    for constraint in spec.get("constraints", []):
        if "bond" in constraint:
            bond = constraint["bond"]
            a, b = atom_map[tuple(bond["atom1"])], atom_map[tuple(bond["atom2"])]
            if not any({int(x["atom_1"]), int(x["atom_2"])} == {a, b} for x in native.bonds):
                raise ValueError("Requested covalent bond missing from native structure")
        elif "pocket" in constraint:
            pocket = constraint["pocket"]
            expected_pockets.append([chain_map[pocket["binder"]], [token(c) for c in pocket["contacts"]],
                                     pocket.get("max_distance", 6.0), pocket.get("force", False)])
        elif "contact" in constraint:
            contact = constraint["contact"]
            expected_contacts.append([token(contact["token1"]), token(contact["token2"]),
                                      contact.get("max_distance", 6.0), contact.get("force", False)])
    options = record.get("inference_options") or {}
    if (options.get("pocket_constraints") or []) != expected_pockets or (options.get("contact_constraints") or []) != expected_contacts:
        raise ValueError("Native contact/pocket identity mismatch")


def inspect_chemistry(root: Path, record_id: str, specs: dict, chains: np.ndarray,
                      residues: np.ndarray, atoms: np.ndarray, mols_dir: Path) -> list:
    from rdkit import Chem
    from boltz.data.parse.schema import standardize

    with nonempty(root / "processed/mols" / f"{record_id}.pkl").open("rb") as handle:
        extra_mols = pickle.load(handle)
    reports = []
    for chain in chains:
        entity_type, spec = specs[str(chain["name"])]
        if entity_type != "ligand":
            continue
        start = int(chain["res_idx"])
        for res in residues[start:start + int(chain["res_num"])]:
            name = str(res["name"])
            if name in extra_mols:
                mol = extra_mols[name]
            else:
                with nonempty(mols_dir / f"{name}.pkl").open("rb") as handle:
                    mol = pickle.load(handle)
            # The native parser emits heavy atoms and preserves their names.
            heavy = [atom for atom in mol.GetAtoms() if atom.GetAtomicNum() != 1]
            native_names = [atom.GetProp("name") for atom in heavy]
            atom_start = int(res["atom_idx"])
            emitted_names = atoms[atom_start:atom_start + int(res["atom_num"])] ["name"].tolist()
            if native_names != emitted_names:
                raise ValueError(f"Chemical atom identity changed in chain {chain['name']}")
            smiles = Chem.MolToSmiles(Chem.RemoveHs(mol), isomericSmiles=True)
            original = None
            if "smiles" in spec:
                original = Chem.MolToSmiles(Chem.MolFromSmiles(spec["smiles"]), isomericSmiles=True)
                expected = standardize(spec["smiles"]) if spec.get("affinity") else spec["smiles"]
                expected = Chem.MolToSmiles(Chem.MolFromSmiles(expected), isomericSmiles=True)
                if smiles != expected:
                    raise ValueError(f"Processed SMILES identity changed in chain {chain['name']}")
            reports.append({"chain": str(chain["name"]), "ccd": name,
                            "input_isomeric_smiles": original, "processed_isomeric_smiles": smiles,
                            "standardization_changed_input": original is not None and original != smiles,
                            "formal_charge": Chem.GetFormalCharge(mol), "heavy_atoms": len(heavy),
                            "atom_names": native_names})
    return reports


def inspect_modified_chemistry(native: SimpleNamespace, specs: dict, mols_dir: Path, structures: list) -> list:
    from rdkit import Chem

    reports = []
    for chain in native.chains:
        entity_type, entity = specs[str(chain["name"])]
        for modification in entity.get("modifications", []):
            position = modification["position"]
            residue = native.residues[int(chain["res_idx"]) + position - 1]
            with nonempty(mols_dir / f"{modification['ccd']}.pkl").open("rb") as handle:
                molecule = pickle.load(handle)
            # Native modified polymers omit CCD leaving atoms at the peptide bond.
            heavy = [atom for atom in molecule.GetAtoms() if atom.GetAtomicNum() != 1
                     and not int(atom.GetProp("leaving_atom"))]
            expected = [(atom.GetProp("name"), atom.GetAtomicNum(), atom.GetFormalCharge()) for atom in heavy]
            start = int(residue["atom_idx"])
            observed = native.atoms[start:start + int(residue["atom_num"])]["name"].tolist()
            if [atom[0] for atom in expected] != observed:
                raise ValueError(f"Modified CCD atom identity changed: {chain['name']}:{position}")
            for structure in structures:
                emitted = structure[0][str(chain["name"])][position - 1]
                if [(atom.name, atom.element.atomic_number) for atom in emitted] != [(name, element) for name, element, _ in expected]:
                    raise ValueError(f"Modified CCD CIF elements changed: {chain['name']}:{position}")
            reports.append({"chain": str(chain["name"]), "position": position,
                            "input_ccd": modification["ccd"], "native_residue": str(residue["name"]),
                            "ccd_component_isomeric_smiles": Chem.MolToSmiles(Chem.RemoveHs(molecule), isomericSmiles=True),
                            "ccd_component_formal_charge": Chem.GetFormalCharge(molecule),
                            "retained_atoms": [{"name": name, "element": element, "charge": charge}
                                               for name, element, charge in expected],
                            "scope": "Retained names match native AtomV2 and elements match CIF; charges come from the CCD component. Native AtomV2 does not serialize elements or charges."})
    return reports


def check_pairing(msas: dict, required_chains: list[str]) -> dict | None:
    """Require a non-query, non-gap homolog with the same native key per chain."""
    if not required_chains:
        return None
    if len(required_chains) < 2 or len(set(required_chains)) != len(required_chains):
        raise ValueError("Pairing requires at least two distinct chain IDs")
    if any(name not in msas for name in required_chains):
        raise ValueError("Pairing requires a processed MSA for every selected chain")
    keys = [set(row["key"] for row in msas[name]["paired_homolog_rows"])
            for name in required_chains]
    shared = sorted(set.intersection(*keys))
    if not shared:
        raise ValueError("No shared non-query native pairing key with nongap homologs")
    return {"chains": required_chains, "shared_homolog_keys": shared,
            "scope": "Native pairing/register consistency; no evolutionary or accuracy claim"}


def check(root: Path, input_path: Path, samples: int, mols_dir: Path | None = None,
          require_paired_chains: list[str] | None = None) -> dict:
    if samples < 1:
        raise ValueError("samples must be positive")
    record_id = input_path.stem
    spec = yaml.safe_load(input_path.read_text())
    specs = {}
    for item in spec["sequences"]:
        entity_type, entity = next(iter(item.items()))
        ids = entity["id"] if isinstance(entity["id"], list) else [entity["id"]]
        for chain_id in ids:
            if chain_id in specs:
                raise ValueError(f"Duplicate input chain: {chain_id}")
            specs[chain_id] = (entity_type, dict(entity))
    record = json.loads(nonempty(root / "processed/records" / f"{record_id}.json").read_text())
    manifest = json.loads(nonempty(root / "processed/manifest.json").read_text())
    if record["id"] != record_id or record_id not in {r["id"] for r in manifest["records"]}:
        raise ValueError("Native record/manifest does not match the input")
    with np.load(nonempty(root / "processed/structures" / f"{record_id}.npz"), allow_pickle=False) as data:
        native = SimpleNamespace(**{key: data[key].copy() for key in
                                    ("atoms", "bonds", "residues", "chains", "mask", "coords", "ensemble")})
    chains, residues, atoms = native.chains, native.residues, native.atoms
    if not native.mask.all() or set(chains["name"]) != set(specs):
        raise ValueError("Missing, invalid or unexpected native chain")
    record_chains = {c["chain_name"]: c for c in record["chains"]}
    if len(record_chains) != len(specs) or set(record_chains) != set(specs):
        raise ValueError("Processed record chain identity mismatch")
    chain_map = {}
    msa_reports = {}
    for chain in chains:
        name = str(chain["name"])
        entity_type, entity = specs[name]
        info = record_chains[name]
        mol_type = const.chain_type_ids[{"protein": "PROTEIN", "dna": "DNA", "rna": "RNA", "ligand": "NONPOLYMER"}[entity_type]]
        if info["chain_id"] != int(chain["asym_id"]) or int(chain["mol_type"]) != mol_type or info["mol_type"] != mol_type:
            raise ValueError(f"Native chain index/type mismatch: {name}")
        start = int(chain["res_idx"])
        names = residues[start:start + int(chain["res_num"])] ["name"].tolist()
        if entity_type == "protein":
            expected = [const.prot_letter_to_token[letter] for letter in entity["sequence"]]
        elif entity_type in ("dna", "rna"):
            expected = [("D" if entity_type == "dna" else "") + letter for letter in entity["sequence"]]
        elif "ccd" in entity:
            expected = entity["ccd"] if isinstance(entity["ccd"], list) else [entity["ccd"]]
        else:
            expected = names  # Chemical identity is checked against processed RDKit below.
        for mod in entity.get("modifications", []):
            expected[mod["position"] - 1] = mod["ccd"]
        if names != expected or info["num_residues"] != len(names):
            raise ValueError(f"Native residue identity mismatch: {name}")
        if int(chain["cyclic_period"]) != (len(names) if entity.get("cyclic") else 0):
            raise ValueError(f"Native cyclic identity mismatch: {name}")
        chain_map[name] = int(chain["asym_id"])
        if entity_type == "protein" and entity.get("msa") != "empty":
            msa_id = info["msa_id"]
            if not isinstance(msa_id, str) or Path(msa_id).name != msa_id:
                raise ValueError(f"Missing processed MSA: {name}")
            with np.load(nonempty(root / "processed/msa" / f"{msa_id}.npz"), allow_pickle=False) as msa:
                seqs = msa["sequences"]
                if not len(seqs) or any(int(s["res_end"] - s["res_start"]) != len(entity["sequence"]) for s in seqs):
                    raise ValueError(f"Processed MSA length mismatch: {name}")
                query = msa["residues"][int(seqs[0]["res_start"]):int(seqs[0]["res_end"])] ["res_type"]
                expected_query = [const.token_ids[const.prot_letter_to_token[c]] for c in entity["sequence"]]
                if query.tolist() != expected_query:
                    raise ValueError(f"Processed MSA query mismatch: {name}")
                paired_rows = []
                for index, row in enumerate(seqs):
                    key = int(row["taxonomy"])
                    aligned = msa["residues"][int(row["res_start"]):int(row["res_end"])]["res_type"]
                    # compute_msa assigns query key 0 and homolog keys by aligned
                    # row position. Query row is never evidence of native pairing.
                    nongap = int(np.count_nonzero(aligned != const.token_ids["-"]))
                    if index > 0 and key >= 0 and nongap:
                        paired_rows.append({"row": index, "key": key, "nongap_tokens": nongap})
                msa_reports[name] = {"id": msa_id, "rows": len(seqs),
                                     "pairing_keys": seqs["taxonomy"].tolist(),
                                     "paired_homolog_rows": paired_rows}
    pairing = check_pairing(msa_reports, require_paired_chains or [])
    templates = record.get("templates") or []
    if spec.get("templates") and not templates:
        raise ValueError("Requested template produced no native alignment")
    for template in templates:
        nonempty(root / "processed/templates" / f"{record_id}_{template['name']}.npz")
    for template in spec.get("templates", []):
        if "chain_id" in template and "template_id" in template:
            query_ids = template["chain_id"] if isinstance(template["chain_id"], list) else [template["chain_id"]]
            target_ids = template["template_id"] if isinstance(template["template_id"], list) else [template["template_id"]]
            name = Path(template.get("cif") or template["pdb"]).stem
            actual = {(t["query_chain"], t["template_chain"]) for t in templates if t["name"] == name}
            if set(zip(query_ids, target_ids)) != actual:
                raise ValueError("Native template chain correspondence mismatch")
    check_constraints(spec, record, native, chain_map)
    binders = [prop["affinity"]["binder"] for prop in spec.get("properties", []) if "affinity" in prop]
    affinity = record.get("affinity")
    if bool(binders) != bool(affinity) or (binders and affinity["chain_id"] != chain_map[binders[0]]):
        raise ValueError("Native affinity binder identity mismatch")
    if binders:
        specs[binders[0]][1]["affinity"] = True
    tokens, _ = tokenize_structure(native, SimpleNamespace(**affinity) if affinity else None)
    token_map = [{"token": int(t["token_idx"]), "chain": str(chains[int(t["asym_id"])]["name"]),
                  "chain_index": int(t["asym_id"]), "position": int(t["res_idx"]) + 1,
                  "residue": str(t["res_name"]), "atom": str(atoms[int(t["atom_idx"])]["name"]) if int(t["mol_type"]) == 3 else None}
                 for t in tokens]
    prediction = root / "predictions" / record_id
    outputs = []
    structures = []
    for rank in range(samples):
        stem = f"{record_id}_model_{rank}"
        structure = gemmi.read_structure(str(nonempty(prediction / f"{stem}.cif")))
        structures.append(structure)
        if len(structure) != 1 or {c.name for c in structure[0]} != set(specs):
            raise ValueError("Emitted CIF chain identity mismatch")
        for chain in chains:
            name = str(chain["name"])
            expected_atoms = []
            for res in residues[int(chain["res_idx"]):int(chain["res_idx"] + chain["res_num"])]:
                for atom in atoms[int(res["atom_idx"]):int(res["atom_idx"] + res["atom_num"])]:
                    expected_atoms.append((int(res["res_idx"]) + 1, str(res["name"]), str(atom["name"])))
            emitted_atoms = []
            for res in structure[0][name]:
                for atom in res:
                    if not all(math.isfinite(v) for v in (atom.pos.x, atom.pos.y, atom.pos.z)):
                        raise ValueError("Non-finite CIF coordinates")
                    emitted_atoms.append((res.seqid.num, res.name, atom.name))
            if Counter(emitted_atoms) != Counter(expected_atoms):
                raise ValueError(f"Emitted CIF atom/residue identity mismatch: {name}")
        confidence = json.loads(nonempty(prediction / f"confidence_{stem}.json").read_text())
        for key in ("confidence_score", "ptm", "iptm", "complex_plddt"):
            finite_number(confidence[key], key, True)
        for key in ("chains_ptm", "pair_chains_iptm"):
            if set(confidence[key]) != {str(v) for v in chain_map.values()}:
                raise ValueError("Confidence chain-index map mismatch")
        for pairs in confidence["pair_chains_iptm"].values():
            if set(pairs) != {str(v) for v in chain_map.values()}:
                raise ValueError("Confidence pair-index map mismatch")
            for value in pairs.values():
                finite_number(value, "pair_chains_iptm", True)
        for value in confidence["chains_ptm"].values():
            finite_number(value, "chains_ptm", True)
        pae = array(prediction / f"pae_{stem}.npz", "pae")
        plddt = array(prediction / f"plddt_{stem}.npz", "plddt")
        if pae.shape != (len(tokens), len(tokens)) or not np.isfinite(pae).all() or (pae < 0).any():
            raise ValueError("Invalid native PAE/token count")
        if plddt.shape != (len(tokens),) or not np.isfinite(plddt).all() or (plddt < 0).any() or (plddt > 1).any():
            raise ValueError("Invalid native pLDDT/token count")
        outputs.append({"rank": rank, "confidence_score": confidence["confidence_score"]})
    affinity_output = None
    if binders:
        pre_affinity = array(prediction / f"pre_affinity_{record_id}.npz", "atoms")
        top = gemmi.read_structure(str(prediction / f"{record_id}_model_0.cif"))
        top_coords = np.array([(a.pos.x, a.pos.y, a.pos.z) for c in top[0] for r in c for a in r])
        if pre_affinity["name"].tolist() != atoms["name"].tolist() or not np.allclose(pre_affinity["coords"], top_coords, atol=0.002, rtol=0):
            raise ValueError("Affinity preprocessing does not match the top-ranked CIF")
        affinity_output = json.loads(nonempty(prediction / f"affinity_{record_id}.json").read_text())
        for suffix in ("", "1", "2"):
            finite_number(affinity_output["affinity_pred_value" + suffix], "affinity_pred_value" + suffix)
            finite_number(affinity_output["affinity_probability_binary" + suffix], "affinity_probability_binary" + suffix, True)
    chemistry = inspect_chemistry(root, record_id, specs, chains, residues, atoms, mols_dir) if mols_dir else None
    modified_chemistry = inspect_modified_chemistry(native, specs, mols_dir, structures) if mols_dir else None
    return {"record_id": record_id, "chain_indices": chain_map, "token_map": token_map,
            "msas": msa_reports, "required_pairing": pairing, "templates": [{**t, "threshold": t.get("threshold") if t.get("force") else None} for t in templates],
            "ranks": outputs, "chemistry": chemistry, "modified_polymer_chemistry": modified_chemistry,
            "affinity": affinity_output, "affinity_value_units": "log10(IC50 in micromolar)" if binders else None,
            "limit": "native output consistency; no experimental binding or accuracy claim"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("results", type=Path, help="native boltz_results_<input/directory> directory")
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--samples", type=int, default=1)
    parser.add_argument("--mols-dir", type=Path, help="trusted prepared /models/boltz2/mols; required for chemical qualification")
    parser.add_argument("--require-paired-chains", nargs="+", default=[],
                        help="require shared non-query native pairing keys in these chains")
    args = parser.parse_args()
    try:
        print(json.dumps(check(args.results, args.input, args.samples, args.mols_dir, args.require_paired_chains), allow_nan=False, indent=2))
    except (ValueError, KeyError, IndexError, OSError, TypeError) as exc:
        parser.exit(2, f"Boltz output rejected: {exc}\n")
