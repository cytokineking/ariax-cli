# Formats and reference roles

The qualified adapter accepts one protein structural model. PDB uses author
chain/residue/insertion IDs. Protein mmCIF uses author IDs for DockQ and label
IDs for DSSP's summary. The ledger preserves both namespaces. Select a single
model before using a multi-model structure.

DSSP commands accept `--format mmcif` or `--format dssp`. Annotated output retains
`_dssp_struct_summary` and `_struct_conf`. Classic output cannot encode long chain
IDs; native rejection remains visible. Blank and dot loop codes normalize to C.
Helix PPII is P. The wrapper exposes assignments; native output may contain other
native fields. Accessibility defaults differ between output formats.

DockQ's native CLI is `DockQ MODEL REFERENCE --mapping XZ:AC --n_cpu 1 --json /workspace/native.json`.
Its mapping goes model to reference. The Python API's `chain_map={'A':'X','C':'Z'}`
goes reference to model. The creator README's Python comment disagrees with the
executable API; use the selected code direction.

The wrapper takes an explicit JSON file:

```json
{"model": [["X"], ["Y", "Z"]], "reference": [["A"], ["B", "C"]]}
```

Two nonempty groups correspond by position. Within each group, chain order is
scientific input. Every selected chain appears once. Concatenated sequences must
match exactly. The adapter copies residues into temporary unique group numbers,
updates the concatenated sequence and retains original identities in
`residue_mapping`. It compares the whole grouped interface, which differs from
averaging pairwise scores. DockQ picks receptor/ligand by group length, so a merge
can alter LRMSD semantics. Arbitrary group sizes, mismatched sequences and
cross-group alignment are outside demonstrated support. Partner order must come
from the intended biological comparison.

Use `--reference-kind predicted` for a predicted model. Its interpretation is
`pose_agreement`, including self comparison. Use `experimental` only with an
experimental reference whose provenance you retain. Automatic mapping can choose
a different homologous-chain assignment; native CLI flags remain available, and
those choices require their own validation.

`interface-results` imports accepted `interface-scores-v1` output. Values,
direction, aggregate definitions and missing reasons stay available with a copy
of the complete report. Its prediction lineage is caller-supplied. Imported
confidence does not independently validate that lineage.

```sh
design-qc ipsae-result --candidate toy --input /workspace/ipsae/toy_10_10.txt --byres /workspace/ipsae/toy_10_10_byres.txt --structure /inputs/ipsae/toy.pdb --out /workspace/qc-ipsae
```

This route accepts retained ipSAE v3 main/byres text. It retains native thresholds,
raw fields and direction/aggregation. The structure supplies an identity ledger;
byres alignment indices remain in the native report. No inferred token join is
made. Missing or unsupported formats reject with a diagnostic. Native zero scores
remain zero. The adapter adds no scientific scoring.

DSSP's experimental Python module, DockQ nucleic-acid/small-molecule/peptide
modes, partial/automatic mapping and mismatch controls have no adapter acceptance
claim. Geometry, independent contacts, buried area and structural alignment await
their recorded dependency. No fallback or automatic scientific replay occurs.

The image includes the wwPDB chemical-component dictionary for libcifpp. The
creator source build alone omitted that file in the checked environment; the
image recipe adds the snapshot so native coordinate parsing can run offline.
