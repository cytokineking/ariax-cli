#!/usr/bin/env python3
"""Score or Cartesian-minimize an explicitly selected canonical-protein model.

This uploadable adapter uses the public Tmol 0.2.0 Python interface. See the
accompanying guide for preparation, score interpretation, and qualification.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import math
import platform
import shutil
from pathlib import Path

import numpy as np
import torch
import tmol
from biotite.structure.io import pdb, pdbx
from tmol.io import atom_array_from_file, atom_array_from_pose_stack, file_from_atom_array, pose_stack_from_atom_array
from tmol.ops import calculate_block_pair_ddg
from tmol.optimization import run_cart_min
from tmol.score import beta2016_score_function

# Heavy-atom names for the standard protein residues. OXT is permitted separately.
SIDECHAINS = {
    "ALA": "CB", "ARG": "CB CG CD NE CZ NH1 NH2", "ASN": "CB CG OD1 ND2",
    "ASP": "CB CG OD1 OD2", "CYS": "CB SG", "GLN": "CB CG CD OE1 NE2",
    "GLU": "CB CG CD OE1 OE2", "GLY": "", "HIS": "CB CG ND1 CD2 CE1 NE2",
    "ILE": "CB CG1 CG2 CD1", "LEU": "CB CG CD1 CD2", "LYS": "CB CG CD CE NZ",
    "MET": "CB CG SD CE", "PHE": "CB CG CD1 CD2 CE1 CE2 CZ",
    "PRO": "CB CG CD", "SER": "CB OG", "THR": "CB OG1 CG2",
    "TRP": "CB CG CD1 CD2 NE1 CE2 CE3 CZ2 CZ3 CH2",
    "TYR": "CB CG CD1 CD2 CE1 CE2 CZ OH", "VAL": "CB CG1 CG2",
}


def atom_key(array, index: int) -> tuple[str, int, str, str, str]:
    return (str(array.chain_id[index]).strip(), int(array.res_id[index]),
            str(array.ins_code[index]).strip(), str(array.res_name[index]).strip(),
            str(array.atom_name[index]).strip())


def index_atoms(array, label: str) -> dict[tuple[str, int, str, str, str], int]:
    if len(array) == 0 or array.coord.shape != (len(array), 3) or not np.isfinite(array.coord).all():
        raise ValueError(f"{label}: empty structure or nonfinite coordinates")
    result = {}
    for i in range(len(array)):
        key = atom_key(array, i)
        if not key[0] or ':' in key[0] or not key[3] or not key[4]:
            raise ValueError(f"{label}: missing or ambiguous atom identity: {key}")
        if key in result:
            raise ValueError(f"{label}: duplicate atom identity: {key}")
        result[key] = i
    return result


def validate_protein(array, label: str) -> dict:
    indices = index_atoms(array, label)
    residues: dict[tuple[str, int, str], tuple[str, set[str]]] = {}
    for key, i in indices.items():
        chain, number, insertion, name, atom = key
        if name not in SIDECHAINS or bool(array.hetero[i]):
            raise ValueError(f"{label}: unsupported noncanonical/hetero residue: {key}")
        element = str(array.element[i]).strip().upper()
        if element not in {"C", "N", "O", "S", "H"}:
            raise ValueError(f"{label}: unsupported element {element!r}: {key}")
        rid = (chain, number, insertion)
        if rid not in residues:
            residues[rid] = (name, set())
        if residues[rid][0] != name:
            raise ValueError(f"{label}: conflicting residue identity: {rid}")
        if element != "H":
            if atom[0] != element:
                raise ValueError(f"{label}: inconsistent heavy-atom element: {key}")
            residues[rid][1].add(atom)
    for rid, (name, actual) in residues.items():
        required = set("N CA C O".split()) | set(SIDECHAINS[name].split())
        if not required <= actual or actual - required - {"OXT"}:
            raise ValueError(f"{label}: incomplete or unknown heavy atoms in {rid} {name}: "
                             f"missing={sorted(required - actual)}, extra={sorted(actual - required - {'OXT'})}")
    return indices


def read_authored(path: Path, model: int):
    suffix = path.suffix.lower()
    if suffix == ".pdb":
        array = pdb.PDBFile.read(str(path)).get_structure(model=model, altloc="all", extra_fields=["charge"])
    elif suffix in {".cif", ".mmcif"}:
        array = pdbx.get_structure(pdbx.CIFFile.read(str(path)), model=model,
                                   altloc="all", use_author_fields=True, extra_fields=["charge"])
    else:
        raise ValueError("input must be an uncompressed .pdb, .cif, or .mmcif file")
    if "altloc_id" in array.get_annotation_categories():
        if any(str(x).strip() not in {"", ".", "?"} for x in array.altloc_id):
            raise ValueError("alternate locations are ambiguous; resolve them explicitly before input")
    return array


def check_input_bonds(array) -> None:
    # Only peptide connections and cysteine disulfides are supported across residues.
    if array.bonds is None:
        return
    residue_order = []
    for i in range(len(array)):
        rid = atom_key(array, i)[:3]
        if not residue_order or residue_order[-1] != rid:
            residue_order.append(rid)
    if len(set(residue_order)) != len(residue_order):
        raise ValueError("residue atoms are not contiguous in the input")
    position = {rid: i for i, rid in enumerate(residue_order)}
    for left, right, _ in array.bonds.as_array():
        a, b = atom_key(array, int(left)), atom_key(array, int(right))
        if a[:3] == b[:3]:
            continue
        earlier, later = (a, b) if position[a[:3]] < position[b[:3]] else (b, a)
        peptide = (earlier[0] == later[0] and earlier[4] == "C" and later[4] == "N"
                   and position[later[:3]] == position[earlier[:3]] + 1)
        disulfide = a[3] == b[3] == "CYS" and a[4] == b[4] == "SG"
        if not peptide and not disulfide:
            raise ValueError(f"unsupported inter-residue bond: {a} -- {b}")


def select_chains(array, chains: list[str], label: str):
    found = {str(x).strip() for x in array.chain_id}
    missing = set(chains) - found
    if missing:
        raise ValueError(f"{label}: selected chains absent: {sorted(missing)}")
    return array[np.isin(array.chain_id, chains)]


def verify_reader(authored, native) -> None:
    original = validate_protein(authored, "authored input")
    converted = validate_protein(native, "Tmol input")
    if set(original) != set(converted):
        raise ValueError("Tmol input reader changed atom identities: "
                         f"lost={sorted(set(original) - set(converted))[:8]}, "
                         f"added={sorted(set(converted) - set(original))[:8]}")
    for key, i in original.items():
        j = converted[key]
        if (str(authored.element[i]).upper() != str(native.element[j]).upper()
                or not np.allclose(authored.coord[i], native.coord[j], rtol=0, atol=1e-4)):
            raise ValueError(f"Tmol input reader changed atom element or coordinates: {key}")
        if int(authored.charge[i]) != 0 and int(authored.charge[i]) != int(native.charge[j]):
            raise ValueError(f"Tmol input reader changed a stated formal charge: {key}")
    check_input_bonds(native)


def pose_indices(pose) -> tuple[dict, list[dict]]:
    if pose.n_poses != 1 or pose.pdb_info is None:
        raise ValueError("expected exactly one pose with author residue metadata")
    info = pose.pdb_info
    blocks = pose.block_type_ind64[0].detach().cpu().tolist()
    offsets = pose.block_coord_offset64[0].detach().cpu().tolist()
    mapping, residues = {}, []
    for block, (type_index, offset) in enumerate(zip(blocks, offsets)):
        if type_index < 0:
            continue
        bt = pose.packed_block_types.active_block_types[type_index]
        rid = (str(info.chain_labels[0, block]).strip(),
               int(info.residue_labels[0, block]),
               str(info.residue_insertion_codes[0, block]).strip())
        if not rid[0]:
            raise ValueError(f"pose block {block} has no author chain")
        residues.append({"chain": rid[0], "residue": rid[1], "insertion": rid[2],
                         "block_index": block, "tmol_type": str(bt.name)})
        for local, atom in enumerate(bt.atoms):
            key = (*rid, str(atom.name).strip())
            if key in mapping:
                raise ValueError(f"ambiguous pose atom: {key}")
            mapping[key] = (block, offset + local)
    return mapping, residues


def build_mapping(authored, prepared, pose):
    original = validate_protein(authored, "authored input")
    built = validate_protein(prepared, "prepared structure")
    lost = set(original) - set(built)
    if lost:
        raise ValueError(f"preparation lost or renamed atoms: {sorted(lost)[:8]}")
    pose_atoms, residues = pose_indices(pose)
    pose_coords = pose.coords[0].detach().cpu().numpy()
    records = []
    for key, j in built.items():
        chain, number, insertion, name, atom = key
        pose_key = (chain, number, insertion, atom)
        if pose_key not in pose_atoms:
            raise ValueError(f"prepared atom is missing in pose: {key}")
        block, offset = pose_atoms[pose_key]
        if not np.allclose(prepared.coord[j], pose_coords[offset], rtol=0, atol=1e-5):
            raise ValueError(f"prepared atom maps to the wrong pose coordinate: {key}")
        i = original.get(key)
        element = str(prepared.element[j]).strip().upper()
        if i is None and element != "H":
            raise ValueError(f"preparation added an unexpected heavy atom: {key}")
        if i is not None and element != "H" and not np.allclose(
                authored.coord[i], prepared.coord[j], rtol=0, atol=1e-4):
            raise ValueError(f"preparation changed a supplied heavy-atom coordinate: {key}")
        records.append({"chain": chain, "residue": number, "insertion": insertion,
                        "residue_name": name, "atom": atom, "element": element,
                        "input_index": i, "input_formal_charge": None if i is None else int(authored.charge[i]),
                        "prepared_index": j, "block_index": block,
                        "pose_atom_index": offset,
                        "input_coord": None if i is None else authored.coord[i].astype(float).tolist(),
                        "prepared_coord": prepared.coord[j].astype(float).tolist()})
    if len({r["pose_atom_index"] for r in records}) != len(records):
        raise ValueError("prepared atoms map ambiguously to pose coordinates")
    return records, residues


def verify_bonds(native, prepared) -> None:
    def bond_pairs(array):
        if array.bonds is None:
            return set()
        return {frozenset((atom_key(array, int(a)), atom_key(array, int(b))))
                for a, b, _ in array.bonds.as_array()}
    lost = bond_pairs(native) - bond_pairs(prepared)
    if lost:
        raise ValueError(f"preparation lost input bond connectivity: {list(lost)[:8]}")


def residue_bonds(array) -> list[dict]:
    result = []
    if array.bonds is None:
        return result
    for left, right, order in array.bonds.as_array():
        a, b = atom_key(array, int(left)), atom_key(array, int(right))
        if a[:3] != b[:3]:
            result.append({"atom_a": list(a), "atom_b": list(b), "bond_type": int(order)})
    return result


def values(tensor, label: str) -> list[float]:
    result = tensor.detach().cpu().reshape(-1).tolist()
    if not all(math.isfinite(float(x)) for x in result):
        raise ValueError(f"{label} contains nonfinite values")
    return [float(x) for x in result]


def term_result(sfxn, tensor, label: str) -> dict:
    names = [st.name for st in sfxn.all_score_types()]
    vals = values(tensor, label)
    if len(names) != len(vals) or len(set(names)) != len(names):
        raise ValueError(f"{label}: inconsistent score term layout")
    return {"total": math.fsum(vals), "weighted_terms": dict(zip(names, vals))}


def whole_score(sfxn, pose) -> dict:
    scorer = sfxn.render_whole_pose_scoring_module(pose)
    with torch.no_grad():
        total = values(scorer(pose.coords), "whole total")
        terms = scorer(pose.coords, sum_terms=False, apply_weights=True)
    if len(total) != 1:
        raise ValueError("expected a single whole-pose score")
    result = term_result(sfxn, terms, "whole terms")
    if not math.isclose(result["total"], total[0], rel_tol=1e-4, abs_tol=1e-3):
        raise ValueError("whole-pose weighted terms do not sum to the total")
    result["total"] = total[0]
    return result


def atom_selector(value: str) -> tuple[str, int, str, str]:
    parts = value.split(":")
    if len(parts) != 4 or not parts[0] or not parts[2] or not parts[3]:
        raise ValueError(f"invalid atom selector {value!r}; use CHAIN:RESID:ICODE:ATOM, '_' for blank insertion")
    try:
        number = int(parts[1])
    except ValueError as exc:
        raise ValueError(f"invalid residue number in {value!r}") from exc
    return parts[0], number, "" if parts[2] == "_" else parts[2], parts[3]


def version(name: str) -> str:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return "not-installed"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("score", "interface-score", "minimize"):
        command = commands.add_parser(name)
        command.add_argument("--input", type=Path, required=True)
        command.add_argument("--model", type=int, required=True, help="one-based input model index")
        command.add_argument("--chain", action="append", required=True, help="author chain to include; repeat")
        command.add_argument("--device", default="cuda:0", help="CUDA device visible inside the tool")
        command.add_argument("--out-dir", type=Path, required=True, help="new directory under /workspace")
        if name == "interface-score":
            command.add_argument("--partner-a", action="append", required=True, help="selected author chain; repeat")
            command.add_argument("--partner-b", action="append", required=True, help="selected author chain; repeat")
        if name == "minimize":
            command.add_argument("--move-atom", action="append", required=True, help="CHAIN:RESID:ICODE:ATOM; '_' for blank insertion; repeat")
            command.add_argument("--max-iter", type=int, default=20, help="LBFGS iteration bound, 1-200")
    args = parser.parse_args()
    if args.model < 1 or len(args.chain) != len(set(args.chain)) or any(not c or ':' in c for c in args.chain):
        parser.error("model must be positive and selected chains must be distinct and nonempty")
    if args.command == "minimize" and not 1 <= args.max_iter <= 200:
        parser.error("--max-iter must be between 1 and 200")
    device = torch.device(args.device)
    if device.type != "cuda" or not torch.cuda.is_available() or not tmol.has_cuda():
        raise ValueError("this adapter requires the available Tmol CUDA device")
    raw = select_chains(read_authored(args.input, args.model), args.chain, "authored input")
    native = select_chains(atom_array_from_file(str(args.input), model=args.model), args.chain, "Tmol input")
    verify_reader(raw, native)
    pose = pose_stack_from_atom_array(native, device, no_optH=True, prepare_ligands=False,
                                      ligand_ph=7.4, missing_density_distance_threshold=2.4,
                                      packer_seed=0)
    if not torch.isfinite(pose.coords).all().item():
        raise ValueError("prepared pose contains nonfinite coordinates")
    prepared = atom_array_from_pose_stack(pose)
    mapping, residues = build_mapping(raw, prepared, pose)
    verify_bonds(native, prepared)
    sfxn = beta2016_score_function(device)
    before = whole_score(sfxn, pose)
    score_types = sfxn.all_score_types()
    weights = values(sfxn.weights_tensor(), "score weights")
    if len(weights) != len(score_types):
        raise ValueError("score weights do not match term layout")
    results = {"schema_version": 1, "command": args.command,
        "input": {"name": args.input.name, "sha256": hashlib.sha256(args.input.read_bytes()).hexdigest(),
                  "model_index": args.model, "chains": args.chain},
        "preparation": {"no_optH": True, "prepare_ligands": False, "packer_seed": 0,
                        "protonation_ph": 7.4, "missing_density_distance_threshold_angstrom": 2.4,
                        "description": "Tmol may add hydrogens or rebuild coincident hydrogens; supplied heavy coordinates and atom identities are checked.",
                        "residues": residues, "inter_residue_bonds": residue_bonds(prepared)},
        "score_function": {"name": "beta2016", "weights": dict(zip([s.name for s in score_types], weights))},
        "whole_pose_before": before, "atom_mapping": mapping,
        "versions": {"tmol": version("tmol"), "tmol_ops_cu12": version("tmol-ops-cu12"),
                     "torch": torch.__version__, "torch_cuda": torch.version.cuda,
                     "biotite": version("biotite"), "atomworks": version("atomworks"),
                     "python": platform.python_version(), "device": str(device),
                     "gpu": torch.cuda.get_device_name(device)}}
    minimized = None
    if args.command == "interface-score":
        a, b = set(args.partner_a), set(args.partner_b)
        if (len(a) != len(args.partner_a) or len(b) != len(args.partner_b)
                or not a or not b or a & b or not (a | b) <= set(args.chain)):
            raise ValueError("interface partners must be distinct, nonempty, disjoint selected chains")
        labels = pose.pdb_info.chain_labels
        mask_a = torch.as_tensor(np.isin(labels, list(a)), dtype=torch.bool, device=device)
        mask_b = torch.as_tensor(np.isin(labels, list(b)), dtype=torch.bool, device=device)
        if not mask_a.any().item() or not mask_b.any().item() or (mask_a & mask_b).any().item():
            raise ValueError("interface partner masks are empty or overlap")
        with torch.no_grad():
            per_term = calculate_block_pair_ddg(pose, mask_a, mask_b, sfxn=sfxn,
                                                 sum_terms=False, minimize=False, pack=False)
        interface = term_result(sfxn, per_term, "interface terms")
        interface.update({"partner_a": sorted(a), "partner_b": sorted(b),
                          "blocks_a": torch.nonzero(mask_a[0]).flatten().cpu().tolist(),
                          "blocks_b": torch.nonzero(mask_b[0]).flatten().cpu().tolist(),
                          "minimize": False, "pack": False})
        results["interface"] = interface
    if args.command == "minimize":
        selected = [atom_selector(s) for s in args.move_atom]
        if len(set(selected)) != len(selected):
            raise ValueError("movable atom selections must be unique")
        by_key = {(r["chain"], r["residue"], r["insertion"], r["atom"]): r for r in mapping}
        missing = set(selected) - set(by_key)
        if missing:
            raise ValueError(f"movable atoms absent from prepared pose: {sorted(missing)}")
        mask = torch.zeros(pose.coords.shape[:2], dtype=torch.bool, device=device)
        for key in selected:
            mask[0, by_key[key]["pose_atom_index"]] = True
        original_coords = pose.coords.detach().clone()
        minimized = run_cart_min(pose, sfxn, coord_mask=mask, optimizer_kwargs={"max_iter": args.max_iter})
        if not torch.isfinite(minimized.coords).all().item():
            raise ValueError("minimized pose contains nonfinite coordinates")
        if not torch.equal(minimized.coords[~mask], original_coords[~mask]):
            raise ValueError("Cartesian minimization changed a fixed atom")
        minimized_array = atom_array_from_pose_stack(minimized)
        # Minimized heavy coordinates can move; require exact atom identity and fixed-atom coordinates.
        if set(index_atoms(prepared, "prepared structure")) != set(index_atoms(minimized_array, "minimized structure")):
            raise ValueError("minimization changed atom identities")
        after = whole_score(sfxn, minimized)
        if after["total"] > before["total"] + max(1e-3, abs(before["total"]) * 1e-5):
            raise ValueError("minimized objective increased beyond numerical tolerance")
        results["minimization"] = {"method": "Tmol run_cart_min / LBFGS_Armijo", "max_iter": args.max_iter,
                                   "movable_atoms": [list(x) for x in selected], "whole_pose_after": after}
    args.out_dir.mkdir(parents=True, exist_ok=False)
    shutil.copyfile(args.input, args.out_dir / ("input" + args.input.suffix.lower()))
    file_from_atom_array(prepared, args.out_dir / "prepared.cif")
    if minimized is not None:
        file_from_atom_array(minimized_array, args.out_dir / "minimized.cif")
    (args.out_dir / "scores.json").write_text(json.dumps(results, indent=2, allow_nan=False) + "\n")


if __name__ == "__main__":
    main()
