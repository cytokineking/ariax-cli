# Proteina-Complexa input examples

Find this directory through `ariax skills forge --tool proteina-complexa --json`,
field `data.examples["proteina-complexa"]`. The original PDBs come from upstream
commit `6c6bd71a72741a4d8c139ab54e2fd0012eb0bdd9`.

| Input | Identity and selections |
| --- | --- |
| `PD-L1.pdb` | Target A1–115; hotspots A37/A39/A49/A98; example binder length 100 |
| `7v11_ligand_centered.pdb` | OQO ligand with its explicit upstream chemical identity; example binder length 100 |
| `M0024_1nzy_v3.pdb` | Observed 53-atom BCA subgraph and six residue atom selections on B; example scaffold length 180 |

The BCA input lacks O7A/O8A/O9A/P3D coordinates. Do not invent them. Its native
selector is `L:1`; the upstream task’s `L:0` selection needs an explicit
`conditional_features.1.ligand=L:1` override if using this fixture directly.
Preserve atom names, input bonds and the motif atom specification.

Run `prepare-inputs.py` inside the remote tool. It retains the original inputs,
fetches public CCD records and natural structures, and writes explicit chemistry
for OQO, the observed BCA subgraph and complete DHZ/Zn from 1CTT chain A. Its
`preparation.json` records component identities, bonds and omissions.
`run-native.py --model ame` uses the complete DHZ/Zn case with the native v2
architecture and rank-32 LoRA; it does not use the incomplete BCA case.

The [guide](../../proteina-complexa.md) gives staging, runner arguments and
supported profiles. Defaults keep 400 sampling steps, seed 5, one sample,
batch one and eight CPUs. Keep each reward/refinement selection explicit.
Native conditioning recenters coordinates; inspect relative geometry and the
retained transform with the native arrays. These examples establish no binding
or general design-quality claim.
