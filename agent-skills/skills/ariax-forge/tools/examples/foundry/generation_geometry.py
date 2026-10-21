"""Measure native conditioning and output geometry without changing a prediction."""

from __future__ import annotations
import math
import re
from pathlib import Path
import gemmi
import numpy as np
from rdkit import Chem
from rdkit.Geometry import Point3D


def atom_rows(path: Path) -> list[dict]:
    return [
        {
            "chain": c.name,
            "res_id": q.seqid.num,
            "res_name": q.name,
            "atom": a.name,
            "element": a.element.name,
            "coord": [a.pos.x, a.pos.y, a.pos.z],
        }
        for c in gemmi.read_structure(str(path))[0]
        for q in c
        for a in q
    ]


def rigid_fit(reference: list, observed: list) -> dict:
    a, b = np.asarray(reference, dtype=float), np.asarray(observed, dtype=float)
    ac, bc = a.mean(0), b.mean(0)
    u, _, vt = np.linalg.svd((a - ac).T @ (b - bc))
    correction = np.eye(3)
    correction[2, 2] = np.linalg.det(u @ vt)
    rotation = u @ correction @ vt
    translation = bc - ac @ rotation
    distances = np.linalg.norm(a @ rotation + translation - b, axis=1)
    return {
        "atom_count": len(a),
        "rmsd_angstrom": float(np.sqrt(np.mean(distances**2))),
        "max_distance_angstrom": float(distances.max()),
        "rotation": rotation.tolist(),
        "translation": translation.tolist(),
    }


def fixed_geometry(
    case_id: str, fixture: Path, rows: list[dict], metadata: dict
) -> dict:
    selectors = {
        "rfd3-indexed-motif": ("protein.pdb", [("E", 6, 13)], None),
        "rfd3-hotspot": ("protein.pdb", [("E", 6, 25)], None),
        "rfd3-unindexed-motif": ("protein.pdb", [("E", 12, 13)], {"N", "CA", "C", "O"}),
        "rfd3-partial-diffusion": (
            "protein.pdb",
            [("E", 6, 13)],
            {"N", "CA", "C", "O"},
        ),
        "rfd3-fixed-backbone": ("protein.pdb", [("E", 6, 45)], {"N", "CA", "C", "O"}),
        "rfd3-dna-binder": ("dna.pdb", [("A", 1, 10), ("B", 15, 24)], None),
    }
    lookup = {(a["chain"], a["res_id"], a["atom"]): a for a in rows}
    reference, observed, missing = [], [], []
    if case_id in selectors:
        name, ranges, names = selectors[case_id]
        originals = [
            a
            for a in atom_rows(fixture / "inputs" / name)
            if any(
                a["chain"] == chain and lo <= a["res_id"] <= hi
                for chain, lo, hi in ranges
            )
            and (names is None or a["atom"] in names)
        ]
        for atom in originals:
            source = atom["chain"] + str(atom["res_id"])
            dest = (
                source
                if case_id == "rfd3-partial-diffusion"
                else metadata.get("diffused_index_map", {}).get(source)
            )
            match = re.fullmatch(r"(.+?)(-?[0-9]+)", dest or "")
            target = (
                lookup.get((match[1], int(match[2]), atom["atom"])) if match else None
            )
            if target is None:
                missing.append([source, atom["atom"]])
            else:
                reference.append(atom["coord"])
                observed.append(target["coord"])
    elif any(a["res_name"] == "AMP" for a in rows):
        originals = atom_rows(fixture / "inputs/AMP.pdb")
        ligand = {a["atom"]: a for a in rows if a["res_name"] == "AMP"}
        for atom in originals:
            if atom["element"] == "H":
                continue
            target = ligand.get(atom["atom"])
            if target is None:
                missing.append(["AMP", atom["atom"]])
            else:
                reference.append(atom["coord"])
                observed.append(target["coord"])
    else:
        return {"applicable": False}
    result = {
        "applicable": True,
        "missing_correspondence": missing,
        "correspondence_method": "native author numbering retained in partial diffusion"
        if case_id == "rfd3-partial-diffusion"
        else "native diffused_index_map"
        if case_id in selectors
        else "fixed ligand atom names",
        "tolerance_angstrom": 0.05,
    }
    if len(reference) >= 3:
        result |= rigid_fit(reference, observed)
        result["preserved"] = not missing and result["max_distance_angstrom"] <= 0.05
    else:
        result["preserved"] = False
    return result


def fixed_sequence(case_id: str, rows: list[dict], metadata: dict) -> dict:
    annotations = metadata["native_conditioning"]["annotations"]
    selected = {}
    flags = annotations.get("is_motif_atom_with_fixed_seq", [])
    ligands = annotations.get("is_ligand", [False] * len(flags))
    for index, fixed in enumerate(flags):
        if not fixed or ligands[index]:
            continue
        source = annotations.get("src_component", [""] * len(flags))[index]
        if not source:
            source = str(annotations["chain_id"][index]) + str(
                annotations["res_id"][index]
            )
        selected[source] = str(annotations["res_name"][index])
    observed = {(row["chain"], row["res_id"]): row["res_name"] for row in rows}
    comparisons = []
    for source, expected in sorted(selected.items()):
        dest = (
            source
            if case_id == "rfd3-partial-diffusion"
            else metadata.get("diffused_index_map", {}).get(source)
        )
        match = re.fullmatch(r"(.+?)(-?[0-9]+)", dest or "")
        name = observed.get((match[1], int(match[2]))) if match else None
        comparisons.append(
            {
                "source": source,
                "output": dest,
                "expected_res_name": expected,
                "observed_res_name": name,
                "matches": name == expected,
            }
        )
    return {
        "applicable": bool(comparisons),
        "comparisons": comparisons,
        "preserved": all(item["matches"] for item in comparisons)
        if comparisons
        else None,
    }


def amp_identity(
    path: Path, fixture: Path, rows: list[dict], metadata: dict
) -> list[dict]:
    reference = gemmi.cif.read_file(str(fixture / "AMP-reference.cif")).sole_block()
    atoms = reference.get_mmcif_category("_chem_comp_atom.")
    bonds = reference.get_mmcif_category("_chem_comp_bond.")
    expected = {
        n: (e, int(c), st)
        for n, e, c, st in zip(
            atoms["atom_id"],
            atoms["type_symbol"],
            atoms["charge"],
            atoms["pdbx_stereo_config"],
        )
        if e != "H"
    }

    def graph(table: dict) -> list:
        return sorted(
            [*sorted([a, b]), order, aromatic]
            for a, b, order, aromatic in zip(
                table["atom_id_1"],
                table["atom_id_2"],
                table["value_order"],
                table["pdbx_aromatic_flag"],
            )
            if a in expected and b in expected
        )

    expected_bonds = graph(bonds)
    table = (
        gemmi.cif.read_file(str(path))
        .sole_block()
        .get_mmcif_category("_chem_comp_bond.")
    )
    exported = {
        k: [v[i] for i, c in enumerate(table.get("comp_id", [])) if c == "AMP"]
        for k, v in table.items()
    }
    exported_graph = graph(exported) if exported.get("atom_id_1") else []
    ligands = sorted(
        {(a["chain"], a["res_id"]) for a in rows if a["res_name"] == "AMP"}
    )
    native = metadata.get("native_output", {})
    native_ids = native.get("annotations", {})
    if native_ids:
        mapping = {
            "chain_id": "chain",
            "res_id": "res_id",
            "res_name": "res_name",
            "atom_name": "atom",
            "element": "element",
        }
        for field, row_field in mapping.items():
            if native_ids.get(field) != [row[row_field] for row in rows]:
                raise ValueError(
                    "Native final bond endpoints do not match output atom identity/order"
                )
    result = []
    for chain, res_id in ligands:
        xyz = {
            a["atom"]: a["coord"]
            for a in rows
            if a["chain"] == chain and a["res_id"] == res_id
        }
        if set(xyz) != set(expected):
            raise ValueError("AMP heavy atom identity differs from CCD")
        mol = Chem.RWMol()
        indices = {}
        for name, (element, charge, stereo) in expected.items():
            a = Chem.Atom(element)
            a.SetFormalCharge(charge)
            indices[name] = mol.AddAtom(a)
        for a, b, order, aromatic in expected_bonds:
            mol.AddBond(
                indices[a],
                indices[b],
                {
                    "SING": Chem.BondType.SINGLE,
                    "DOUB": Chem.BondType.DOUBLE,
                    "TRIP": Chem.BondType.TRIPLE,
                }[order],
            )
        mol = mol.GetMol()
        Chem.SanitizeMol(mol)
        conf = Chem.Conformer(len(indices))
        conf.Set3D(True)
        for name, i in indices.items():
            conf.SetAtomPosition(i, Point3D(*xyz[name]))
        mol.AddConformer(conf)
        Chem.AssignStereochemistryFrom3D(mol)
        expected_stereo = {n: v[2] for n, v in expected.items() if v[2] in {"R", "S"}}
        observed = {
            n: mol.GetAtomWithIdx(indices[n]).GetProp("_CIPCode")
            if mol.GetAtomWithIdx(indices[n]).HasProp("_CIPCode")
            else None
            for n in expected_stereo
        }
        native_graph, external = [], []
        if native_ids and native.get("bonds") is not None:
            from biotite.structure import BondType

            members = {
                i
                for i, row in enumerate(rows)
                if row["chain"] == chain and row["res_id"] == res_id
            }
            orders = {
                "SINGLE": ("SING", "N"),
                "DOUBLE": ("DOUB", "N"),
                "TRIPLE": ("TRIP", "N"),
                "AROMATIC_SINGLE": ("SING", "Y"),
                "AROMATIC_DOUBLE": ("DOUB", "Y"),
                "AROMATIC_TRIPLE": ("TRIP", "Y"),
                "AROMATIC": ("AROM", "Y"),
            }
            for i, j, kind in native["bonds"]:
                if i in members and j in members:
                    order, aromatic = orders.get(
                        BondType(kind).name, ("UNKNOWN", "UNKNOWN")
                    )
                    native_graph.append(
                        [*sorted([rows[i]["atom"], rows[j]["atom"]]), order, aromatic]
                    )
                elif (i in members) != (j in members):
                    external.append([i, j, BondType(kind).name])
        native_graph.sort()
        result.append(
            {
                "chain": chain,
                "res_id": res_id,
                "ccd_heavy_bond_count": len(expected_bonds),
                "reference_connectivity": {
                    "source": "retained official CCD AMP-reference.cif",
                    "scope": "reference-derived graph used for coordinate chirality; not native generated topology",
                    "heavy_atom_bonds": expected_bonds,
                },
                "native_final_bond_provenance": native.get("bond_provenance"),
                "native_final_bonds_available": bool(native_ids)
                and native.get("bonds") is not None,
                "native_final_atom_identity_order_matches": bool(native_ids),
                "native_final_heavy_bond_count": len(native_graph),
                "native_final_bonds": native_graph,
                "native_final_connectivity_matches": [bond[:2] for bond in native_graph]
                == [bond[:2] for bond in expected_bonds],
                "native_final_bond_order_aromaticity_matches": native_graph
                == expected_bonds,
                "native_ligand_external_bonds": external,
                "CIF_bond_records_available": bool(exported_graph),
                "exported_bond_count": len(exported_graph),
                "exported_bond_order_aromaticity_matches": exported_graph
                == expected_bonds,
                "expected_stereo": expected_stereo,
                "observed_stereo": observed,
                "chirality_matches": observed == expected_stereo,
                "chirality_graph_source": "retained official CCD AMP graph",

            }
        )
    return result


def evaluate(case_id: str, structure: Path, fixture: Path, metadata: dict) -> dict:
    rows = atom_rows(structure)
    native = metadata["native_conditioning"]
    annotations = native["annotations"]
    flags = {}
    for key in [
        "is_motif_atom_with_fixed_coord",
        "is_motif_atom_with_fixed_seq",
        "is_motif_atom_unindexed",
        "is_atom_level_hotspot",
        "active_donor",
        "active_acceptor",
    ]:
        values = annotations.get(key, [])
        flags[key] = [
            {
                "chain": annotations["chain_id"][i],
                "res_id": annotations["res_id"][i],
                "atom": annotations["atom_name"][i],
                "source": annotations.get("src_component", [None] * len(values))[i],
            }
            for i, v in enumerate(values)
            if v
        ]
    features = {
        key: {
            "shape": list(np.asarray(value).shape),
            "nonzero_count": int(np.count_nonzero(np.asarray(value))),
        }
        for key, value in native["features"].items()
    }
    result = {
        "native_conditioning_atoms": flags,
        "native_conditioning_features": features,
        "native_rasa_bins": {
            str(v): annotations.get("rasa_bin", []).count(v)
            for v in sorted(set(annotations.get("rasa_bin", [])))
        },
        "fixed_geometry": fixed_geometry(case_id, fixture, rows, metadata),
        "fixed_sequence": fixed_sequence(case_id, rows, metadata),
        "amp": amp_identity(structure, fixture, rows, metadata)
        if any(a["res_name"] == "AMP" for a in rows)
        else [],
    }
    if "input_bonds" in native:
        ids = annotations
        result["input_chemical_representation"] = {
            "scope": "native parsed conditioning only; generated native topology remains separate",
            "input_bonds": native["input_bonds"],
            "input_atom_identity": {
                key: ids.get(key) for key in ("chain_id", "res_id", "res_name", "atom_name", "gt_atom_name", "element", "token_id")
            },
            "model_token_bonds": native["features"].get("token_bonds"),
            "model_token_bonds_semantics": "boolean token adjacency, without bond orders or aromaticity",
        }
    if case_id == "rfd3-symmetry-c2":
        chains = sorted({a["chain"] for a in rows})
        if len(chains) != 2:
            raise ValueError("C2 did not produce two chains")
        ca = [
            [a["coord"] for a in rows if a["chain"] == c and a["atom"] == "CA"]
            for c in chains
        ]
        fit = rigid_fit(*ca)
        rotation = np.asarray(fit["rotation"])
        translation = np.asarray(fit["translation"])
        angle = math.degrees(
            math.acos(float(np.clip((np.trace(rotation) - 1) / 2, -1, 1)))
        )
        closure = float(np.linalg.norm(translation @ rotation + translation))
        sequences = [
            [a["res_name"] for a in rows if a["chain"] == c and a["atom"] == "CA"]
            for c in chains
        ]
        fit |= {
            "chain_sequences_match": sequences[0] == sequences[1],
            "rotation_degrees": angle,
            "two_operation_translation_angstrom": closure,
            "c2_geometry_matches": sequences[0] == sequences[1]
            and fit["max_distance_angstrom"] <= 0.05
            and abs(angle - 180) <= 2
            and closure <= 0.1,
        }
        result["symmetry"] = fit
    if case_id == "rfd3-hotspot":
        dest = metadata["diffused_index_map"].get("E12", "")
        match = re.fullmatch(r"(.+?)([0-9]+)", dest)
        selected = [
            a
            for a in rows
            if match
            and a["chain"] == match[1]
            and a["res_id"] == int(match[2])
            and a["atom"] == "CA"
        ]
        target_chains = {
            re.fullmatch(r"(.+?)([0-9]+)", v)[1]
            for v in metadata["diffused_index_map"].values()
        }
        binder = [a for a in rows if a["chain"] not in target_chains]
        if selected and binder:
            distance = float(
                np.linalg.norm(
                    np.asarray([a["coord"] for a in binder]) - selected[0]["coord"],
                    axis=1,
                ).min()
            )
            result["hotspot"] = {
                "native_selection": dest,
                "min_binder_distance_angstrom": distance,
                "within_8_angstrom": distance <= 8,
            }
    if case_id in {"rfd3-rasa-hbond", "rfd3na-aptamer", "rfd3na-rna-secondary"}:
        from atomworks import parse

        array = parse(
            filename=str(structure),
            build_assembly=None,
            add_missing_atoms=False,
            remove_ccds=[],
            fix_arginines=False,
            hydrogen_policy="remove",
        )["asym_unit"][0]
        if case_id in {"rfd3-rasa-hbond", "rfd3na-aptamer"}:
            from atomworks.ml.transforms.sasa import calculate_atomwise_rasa

            rasa = calculate_atomwise_rasa(array, 1.4, "ProtOr", 100)
            ligand = array.res_name == "AMP"
            values = rasa[ligand]
            finite = values[np.isfinite(values)]
            result["ligand_rasa"] = {
                "probe_radius_angstrom": 1.4,
                "sampling_points": 100,
                "finite_atom_count": len(finite),
                "total_atom_count": len(values),
                "mean": float(finite.mean()) if len(finite) else None,
                "maximum": float(finite.max()) if len(finite) else None,
                "atom_rasa": [
                    {"atom": str(name), "rasa": float(value) if np.isfinite(value) else None,
                     "below_0_1": bool(value < 0.1) if np.isfinite(value) else None}
                    for name, value in zip(array.atom_name[ligand], values)
                ],
                "fraction_below_0_1": float(np.mean(finite < 0.1))
                if len(finite)
                else None,
            }
            metrics = metadata.get("metrics", {})
            result["hydrogen_bonds"] = {
                key: metrics.get(key)
                for key in (
                    "correct_donor_percent",
                    "correct_acceptor_percent",
                    "num_hbonds",
                    "hbond_connections",
                )
            }
            result["hydrogen_bonds"]["native_hbplus_metrics_available"] = all(
                key in metrics
                for key in (
                    "correct_donor_percent",
                    "correct_acceptor_percent",
                    "num_hbonds",
                )
            )
            result["hydrogen_bonds"]["selected_atom_satisfaction"] = [
                {**atom, "role": role,
                 "satisfied": f"{atom['atom']}_AMP_{atom['res_id']}" in metrics.get(metric, [])
                 if metric in metrics else None}
                for role, flag, metric in (
                    ("donor", "active_donor", "donor_atom_names"),
                    ("acceptor", "active_acceptor", "acceptor_atom_names"),
                )
                for atom in flags[flag]
            ]
        if case_id == "rfd3na-rna-secondary":
            from secondary_structure import inspect

            dbn = metadata["specification"]["ss_dbn"]
            result["secondary_structure"] = inspect(array, dbn, native, metadata.get("native_output"))
    return result
