# Structural score definitions

| Output | Definition |
|---|---|
| Kabsch `rmsd_angstrom` | Unweighted CA least-squares RMSD after a proper rigid rotation on the saved explicit residue pairs. No sequence alignment is inferred. |
| Native `rmsd_angstrom` | Native US-align/TM-align RMSD of its structure-aligned residues. Its correspondence can differ from Kabsch. |
| `tm_mobile`, `tm_reference` | Native TM-score normalized by the full selected mobile or reference length, respectively. Save both and the alignment; use a matched normalization for comparisons. |
| Contact residue pair | At least one non-H/D atom pair across the selected disjoint partners at or below the stated Angstrom cutoff. The record has minimum distance and atom-pair count. Heterogens are included when selected. |
| SASA `area_angstrom2` | FreeSASA Lee-Richards accessible surface area with the stated probe/radii/slice count. Per-residue areas sum to the total. This is not interface burial. |
| Geometry `overlaps` | Heavy-atom radius sum minus interatomic distance above the stated threshold. Same/adjacent polymer residues are excluded. Elements outside C/N/O/S/P remain unscored. Covalent, disulfide and metal topology can create false flags; this is not MolProbity clashscore. |
| OpenMM energies | Potential energy in kJ/mol for the recorded Amber14/OBC2 system. Total includes the recorded positional restraint; the reported physical contribution subtracts that restraint. It is not binding affinity or ΔG. |
| Foldseek E-value / bits | Native structure-search significance and alignment bit score for the selected database and settings. Database choice affects interpretation. |
| Foldseek `qtmscore` / `ttmscore` | Native aligned structural scores normalized by query/target lengths. Do not substitute them for full complex interface scores. |

The adapter selects one model and author chain IDs. Insertion codes, residue
names, heterogen identities and explicit alternate-location policy stay with
results. Atom-only PDB/mmCIF conversion does not retain all metadata categories.
Standard-protein FASTA omits nonstandard/non-protein residues and lists the
unmapped polymer residues explicitly; use its residue map when relating sequence
positions back to the structure.

PDBFixer repairs standard protein atoms/hydrogens. Loop reconstruction, explicit
solvation, arbitrary ligand/cofactor parameterization, exhaustive geometry
validation and non-protein confidence scoring are outside this adapter's current
interface. Direct native tools may expose additional options; using one requires
recorded settings and its own applicable native qualification.
