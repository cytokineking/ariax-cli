# Mol-1 inputs and conditioning

Read with `ariax skills forge --reference mol1-inputs --read --json`. These are
native source contracts at
[`6ad1a133f919dc79b4f829bdc24fad28b9c4d3f0`](https://github.com/molence/Mol-1/blob/6ad1a133f919dc79b4f829bdc24fad28b9c4d3f0/docs/infer_json_format.md),
not evidence that every mode is qualified in Forge. Use the
[entry guide](../mol1.md) for current limits and the initial direct-runner recipe.

Supply a nonempty JSON list even for one job. Each job has a unique `name` and
`sequences` list. Use simple filename-safe names without slashes, traversal or
control characters, because names become output paths. Every sequence entry
contains one entity object. Specify the intended stoichiometry through `count`
and an explicit `id` list with one unique chain ID per copy. Do not infer
oligomerization, protonation, ligand identity or missing partners from a name.

| Entity key | Required identity | Important details |
| --- | --- | --- |
| `proteinChain` | `sequence`, `count` | Canonical amino acids and `X`; unknown residues lose chemical specificity. Optional `modifications` use `ptmType: "CCD_CODE"` and one-based `ptmPosition`. |
| `dnaSequence` | `sequence`, `count` | A single strand. Provide the intended complementary strand explicitly for duplex DNA. Native alphabet includes A/C/G/T, I/U and N/X unknowns. |
| `rnaSequence` | `sequence`, `count` | A single strand; A/C/G/U, I and N/X unknowns. RNA MSA search stays disabled. |
| `ligand` | `ligand`, `count` | `CCD_ATP`-style code, chemically specified SMILES, or `FILE_/inputs/.../ligand.sdf` (also PDB/MOL/MOL2 with a 3D conformation). Preserve stereochemistry, charges and intended component identity. |
| `ion` | `ion`, `count` | A CCD ion code such as `MG`, without the `CCD_` prefix. |

All five entities accept `id`. DNA/RNA modifications use `modificationType` and
one-based `basePosition`. The model constructs molecular features and reference
conformers from these identities; an input ligand conformer is not a guarantee
of fixed output coordinates. The simple fixture needs no cropping or atom
repair. For a real target, record any explicitly selected domain/crop and its
mapping to the original sequence; output sequence positions do not recover
omitted residues or experimental author numbering.

## Supplied alignments, no public search

The Forge recipe calls `python -m mol.runner.inference` on prepared JSON. It
loads local features directly; it does not call `mol pred`'s protein MSA search
preprocessor. `--use_msa false` produces empty/dummy MSA features and ignores
supplied alignments. Use that explicitly for the ubiquitin no-MSA fixture.
No-MSA prediction can be substantially less accurate; it is a scientific change,
not a transparent performance optimization.

For a separately qualified supplied-protein-MSA experiment, set `--use_msa true`
and specify `unpairedMsaPath` and/or `pairedMsaPath` inside **each** appropriate
`proteinChain`. Use absolute paths such as `/inputs/mol1/msas/A.unpaired.a3m`.
Upload every referenced file at that exact path and wait for every input to be
ready. Relative paths resolve against the remote working directory, not the JSON
file. Preserve the query sequence, database provenance, search parameters,
coverage, paired-chain correspondence and any preprocessing decisions. A pairing
file's presence alone does not prove biologically appropriate chain pairing.
`--msa_pair_as_unpair` defaults to `true`: paired rows also enter unpaired
features. Keep this setting with the run record.

Do not substitute `mol pred`: with its default MSA flag, absent paths can cause
public ColabFold requests. Do not use `mol msa`, `mol prep`, or a download script
as an input repair. Report missing/incompatible supplied files and prepare a new
explicit input instead. Avoid the deprecated dictionary-valued `msa` form;
conversion in the high-level preprocessing path can write a new JSON beside its
source, which is incompatible with read-only `/inputs`.

Keep `--use_template false --use_rna_msa false` in the initial offering.
Upstream supports protein `templatesPath` in `.a3m`, `.hhr` or inline-structure
`.json` format, and RNA `unpairedMsaPath`; those modes need separate assets,
input checks and qualification. Native template features may fetch a missing
mmCIF and write into a model-root cache even when hits are supplied. Template
search is not implied by the no-search direct runner. Do not enable it until a
qualified recipe provides local structures and separates writable scratch from
read-only assets. No RNA database search is authorized by these examples.

## Covalent and modified chemistry

Native `covalent_bonds` entries identify `entity1`/`entity2` by one-based order in
`sequences`, optional paired `copy1`/`copy2` by one-based copy index,
`position1`/`position2` by one-based residue/component position, and `atom1`/
`atom2` by CCD atom name. SMILES/file atom indices start at zero; do not confuse
these with one-based polymer positions. Omitting both copy fields bonds
corresponding copies and requires matching copy counts. A single ligand has
component position 1. Multi-CCD ligands such as `CCD_NAG_NAG` need explicit
intercomponent bonds.

These records condition a prediction; validate the resulting bond geometry and
chemistry. Upstream cautions that general polymer–polymer covalent bonds are
unreliable, apart from its described cyclic-peptide/disulfide cases. None are
qualified here yet. An unavailable CCD component is an input/asset limitation,
not permission to silently change chemistry or fetch a new dictionary.

## Seeds, batches and provenance

The direct runner reads one JSON file containing one or more jobs. `--seeds 101`
selects the default seed; a comma-separated value selects several. With
`--use_seeds_in_json true`, the first job's `modelSeeds` list applies to **all**
jobs in the file. Leave it `false` for the supplied fixture to avoid hidden
seed precedence. Give every job a unique output name and preserve all requested
seed/sample identities. Larger batches and additional seeds are unqualified.

Save the exact input JSON, every MSA/template/ligand companion, source revision,
selected named asset identities, command argv and resolved runtime settings. Preserve explicit user chemistry and chain mappings when exporting to
another tool; similar JSON field names do not guarantee compatible semantics.
