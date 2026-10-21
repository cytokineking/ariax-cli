# Design quality checks

Use `design-qc` for protein secondary-structure assignments, DockQ comparison
against a specified reference and tables made from existing interface reports.
DSSP assigns structure from coordinates. DockQ reports pose agreement when the
reference is predicted. These observations do not measure binding.

There are no checkpoints or named model assets. The CPU tool runs within the
selected Forge worker. The planned bounded examples target one CPU and 1 GiB RAM;
preparing the image requires a larger host. Read [formats and mapping](design-qc/formats.md)
for supported inputs and native limits.

Find the installed examples with `ariax skills forge --json`, using
`data.examples['design-qc']`. Both `forge` and `ariax-forge` aliases expose
`design-qc`, `design-qc-formats` and `design-qc-fixtures`. The example helper
fetches the pinned creator fixture on the remote worker; prepare the folder there
with `python3 prepare.py --out design-qc-inputs`. Register its files through the
normal project input upload/import path as `design-qc/`. Local installed paths
and remote `/inputs/design-qc` are distinct locations.

```sh
ariax forge tools add SESSION --tools design-qc --json
ariax forge tools wait SESSION design-qc --timeout 600 --json
ariax forge run SESSION --tool design-qc -- design-qc dssp --candidate reference --input /inputs/design-qc/reference.pdb --format mmcif --out /workspace/qc-dssp
ariax forge run SESSION --tool design-qc -- design-qc dockq --candidate relabeled --model /inputs/design-qc/relabeled.pdb --reference /inputs/design-qc/reference.pdb --reference-kind experimental --partners /inputs/design-qc/relabeled-partners.json --out /workspace/qc-dockq
```

Watch the returned command IDs with `ariax forge watch SESSION COMMAND --json`.
Output directories must be new so prior reports survive. Inspect `result.json`
and every `native_reports` member. Identical relabeled partner groups should give
DockQ near one. Run the changed pose example from the fixtures guide to see a
lower score. The fixture has three protein chains; the second partner combines
two ordered chains. This bounded example establishes adapter behavior.

`secondary_structure` uses DSSP letters with C for a loop. Each residue retains
its author chain, residue number and insertion code plus label IDs when supplied.
DockQ and fnat increase with agreement; iRMSD and LRMSD use angstrom and decrease.
An empty reference interface has null DockQ and `no_reference_interface`.
A missing assignment records `missing_backbone_or_unassigned`. A native process
failure retains its diagnostic log. Held dependent metrics carry
`dependent_structural_tools_unavailable`.

For an existing accepted report, run
`design-qc interface-results --candidate CANDIDATE --input /inputs/result.json --out /workspace/qc-interface`.
It accepts `interface-scores-v1` result output, retains directional scores,
original residue identities, prediction lineage and native missing reasons.
The ipSAE text adapter takes the main report, byres report and original structure;
see the format reference. It performs no new interface calculation.

Keep registered structures, partner maps, prediction/reference provenance,
input interface reports and all output directories in Files. A checkpoint saves
inputs and workspace. On restore, inspect the saved reports and their identity
ledgers before explicitly requesting more work. A restore does not rerun science.

Sources: DSSP v4.6.1 at
[d8278f9](https://github.com/PDB-REDO/dssp/tree/d8278f9f4f8c49fc353b580b7d0d7bc8b1b4e384)
(BSD-2-Clause), DockQ v2.1.3 source tag at
[d9cbb19](https://github.com/wallnerlab/DockQ/tree/d9cbb1940bb0f42db3257f7da3b0e96f162b94d9)
(MIT; package metadata says 2.1.2). Cite the creator papers listed in each README
when using these metrics. Grouping limitations and the reported sequence-update
fix are explained in [issue 33](https://github.com/wallnerlab/DockQ/issues/33).
