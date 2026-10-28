# MPNN structure and constraint examples

These are real structure coordinates prepared for bounded native execution.
No native inference or generated sequence is present in this directory. Find it
with `ariax skills forge --tool mpnn --json`, field `data.examples.mpnn`.

| Fixture | Source and preparation | Constraint case |
| --- | --- | --- |
| `protein.pdb` | ProteinMPNN source fixture [3HTN](https://www.rcsb.org/structure/3HTN), chains A/B, complete N/CA/C/O only | Ten observed positions on A may change; B and remaining A positions fixed |
| `ligand.pdb` | LigandMPNN source fixture [1BC8](https://www.rcsb.org/structure/1BC8), complete protein C with DNA A/B and zinc retained, waters removed | Twenty observed C positions may change; full nucleotide/metal context retained |
| `paired.pdb` | [1N8Z](https://www.rcsb.org/structure/1N8Z), trastuzumab VL A1-107 and VH B1-117, all observed HER2 C residues; complete backbone only | Selected annotated VH/VL loop positions may change; framework and antigen fixed |
| `vhh.pdb` | [4KRL](https://www.rcsb.org/structure/4KRL), VHH 7D12 B and EGFR domain III A; complete backbone only | Selected VHH loop positions may change; framework and antigen fixed |
| `scfv.pdb` | [1NQB](https://www.rcsb.org/structure/1NQB), single-chain antibody fragment A from a trivalent domain-swapped crystal assembly; complete backbone only, zero-occupancy/incomplete terminal residue233 and crystal copy C omitted | VH A2-120 and VL A121-232 retained on one source chain, domain junction120/121 fixed; no modeled linker |

The source copies came from ProteinMPNN commit
`8907e6671bfbfc92303b5f79c4b5e6ce47cdef57`, LigandMPNN commit
`26ec57ac976ade5379920dbd43c7f97a91cf82de`, and the linked RCSB PDB entries.
Coordinates are unrelaxed. Alternate atom locations were
resolved to blank/A during fixture preparation. Retained backbone atoms
must have positive occupancy. No missing coordinates were invented.

Each `.plan.json` retains source metadata and explicit original
`chain:residue` identifiers. The antibody plans use declared fixture loop
windows in author PDB numbering. They do not claim IMGT, Kabat or North
numbering or automatically infer CDR boundaries. The original AbMPNN study
uses North CDR definitions. A scientific campaign must supply its actual
numbering scheme and complete explicit domain/CDR maps.

`mpnn-prepare` creates a fresh `backbone.pdb`, `fixed_positions.jsonl`,
`plan.json` and `residue-map.json` directory. Protein positions become
dense one-based positions, preserving chain IDs and an explicit map to
the source residue numbers/insertion codes. Nucleotide ATOM records become
HETATM records with coordinates and identity retained so original
ProteinMPNN does not interpret nucleotide chains as unknown protein residues.
The ligand runner still receives those context atoms through its native
non-protein atom parser. Invalid/incomplete protein backbones are rejected.

The scFv fixture checks chain/domain mapping and constraints in a real
single-chain fragment. Its crystallographic domain-swapped conformation
does not establish performance on ordinary flexible-linker scFvs. A user-provided
flexible linker requires a resolved backbone and explicit
fixed `linker_positions`. Assess paired, VHH and scFv inputs separately.
