# Bounded design QC example

Use `ariax skills forge --tool design-qc --json` to find this directory in
`data.examples["design-qc"]`. Copy `prepare.py` to the selected authorized remote
host and run `python3 prepare.py --out design-qc-inputs` there.
The helper downloads the pinned creator 1A2K complex and writes explicit partner
maps plus `provenance.json`. Relabeling changes A/B/C to X/Y/Z. The changed pose
translates chain C by +50 angstrom along X. Preserve the helper's source URL and
all generated inputs in the project.

Register the folder's regular files as `/inputs/design-qc/`, select `design-qc`
and wait for readiness. Run the main guide's commands, then:

```sh
ariax forge run SESSION --tool design-qc -- design-qc dssp --candidate reference-classic --input /inputs/design-qc/reference.pdb --format dssp --out /workspace/qc-dssp-classic
ariax forge run SESSION --tool design-qc -- design-qc dockq --candidate changed --model /inputs/design-qc/changed.pdb --reference /inputs/design-qc/reference.pdb --reference-kind experimental --partners /inputs/design-qc/relabeled-partners.json --out /workspace/qc-changed
ariax forge run SESSION --tool design-qc -- design-qc dockq --candidate predicted-comparison --model /inputs/design-qc/relabeled.pdb --reference /inputs/design-qc/reference.pdb --reference-kind predicted --partners /inputs/design-qc/relabeled-partners.json --out /workspace/qc-pose-agreement
ariax forge run SESSION --tool design-qc -- design-qc table --candidate example-batch --input /inputs/design-qc/table.json --out /workspace/qc-table
```

Inspect each `result.json`. The secondary assignments agree between classic and
annotated formats for the same complete residues. The changed DockQ is lower
than the relabeled identity score. The predicted-reference result says
`pose_agreement`. Retain native reports and partner/residue ledgers before
synchronization. The fixture demonstrates execution and mapping; it makes no
claim about a newly designed binder.

The table keeps one explicit candidate per row. Missing comparisons carry a reason.
Each report must match the row candidate ID; scores from different candidates
cannot silently join. Native report paths and directional interface results stay
available in JSON. `table.tsv` provides the compact comparison.
