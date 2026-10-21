"""Compare AMP heavy-atom bond identity and observed 3D chirality with the CCD."""

import json
import argparse
from pathlib import Path
import gemmi
from rdkit import Chem
from rdkit.Geometry import Point3D

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument("root",nargs="?",type=Path,default=Path("/workspace/b28a"))
args=parser.parse_args()
reference = gemmi.cif.read_file(str(Path(__file__).parent/"AMP-reference.cif")).sole_block()
atoms = reference.get_mmcif_category("_chem_comp_atom.")
bonds = reference.get_mmcif_category("_chem_comp_bond.")
expected_atoms = {
    n: (e, int(c), st)
    for n, e, c, st in zip(
        atoms["atom_id"],
        atoms["type_symbol"],
        atoms["charge"],
        atoms["pdbx_stereo_config"],
    )
    if e != "H"
}


def graph(table: dict[str, list[str]]) -> list[list[str]]:
    return sorted(
        [*sorted([a, b]), order, aromatic]
        for a, b, order, aromatic in zip(
            table["atom_id_1"],
            table["atom_id_2"],
            table["value_order"],
            table["pdbx_aromatic_flag"],
        )
        if a in expected_atoms and b in expected_atoms
    )


expected_bonds = graph(bonds)
root = args.root
report = []
for p in sorted(root.rglob("*_model.cif")):
    structure = gemmi.read_structure(str(p))
    ligands = [r for c in structure[0] for r in c if r.name == "AMP"]
    if not ligands:
        continue
    table = (
        gemmi.cif.read_file(str(p)).sole_block().get_mmcif_category("_chem_comp_bond.")
    )
    native = {
        k: [v[i] for i, c in enumerate(table["comp_id"]) if c == "AMP"]
        for k, v in table.items()
    }
    graph_matches = bool(native.get("atom_id_1")) and graph(native) == expected_bonds
    for residue in ligands:
        mol = Chem.RWMol()
        indices = {}
        xyz = {a.name: a.pos for a in residue}
        if set(xyz) != set(expected_atoms):
            raise ValueError("AMP heavy atoms differ from CCD")
        for name, (element, charge, stereo) in expected_atoms.items():
            atom = Chem.Atom(element)
            atom.SetFormalCharge(charge)
            indices[name] = mol.AddAtom(atom)
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
            v = xyz[name]
            conf.SetAtomPosition(i, Point3D(v.x, v.y, v.z))
        mol.AddConformer(conf)
        Chem.AssignStereochemistryFrom3D(mol)
        observed = {
            name: mol.GetAtomWithIdx(i).GetProp("_CIPCode")
            if mol.GetAtomWithIdx(i).HasProp("_CIPCode")
            else None
            for name, i in indices.items()
            if expected_atoms[name][2] in ["R", "S"]
        }
        expected = {
            name: values[2]
            for name, values in expected_atoms.items()
            if values[2] in ["R", "S"]
        }
        report.append(
            {
                "structure": str(p.relative_to(Path("/workspace"))),
                "bond_graph_order_aromaticity_matches": graph_matches,
                "exported_heavy_bonds": graph(native) if native.get("atom_id_1") else [],
                "expected_stereo": expected,
                "observed_stereo": observed,
                "chirality_matches": observed == expected,
            }
        )
print(
    json.dumps(
        {
            "reference": "https://files.rcsb.org/ligands/download/AMP.cif",
            "reference_modified": "2025-04-15",
            "comparisons": report,
        },
        indent=2,
    )
)
