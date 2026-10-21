# ImmuneBuilder examples

Creator README receptors at commit 0df4e2ad82a1aa60f37ea9dae335d1198159ef78, with one synthetic N-terminal variant per family. Each file contains two receptors for sequential reuse of one loaded predictor. Original chain labels deliberately differ from native H/L/A/B keys and remain in the exported mapping.

Read the installed immunebuilder guide through `ariax skills forge --reference immunebuilder --read --json`. Its documented ABodyBuilder2 command registers abodybuilder2.json under /inputs/immunebuilder and writes /workspace/immunebuilder-abodybuilder2. Substitute another family and its matching input file for nanobody or TCR prediction. Inputs and selected outputs must survive a Files checkpoint before session closure.

These are bounded execution and identity fixtures. Predictive accuracy and experimental binding are unmeasured. Full default four-checkpoint ensembles and CUDA refinement remain enabled. The raw-numbering diagnostic uses the same inputs with `--numbering raw --unrefined-only` and a fresh output directory.
