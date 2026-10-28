# ImmuneBuilder

Choose `immunebuilder` for variable-domain structure prediction: `abodybuilder2` for paired H/L antibodies, `nanobodybuilder2` for H-chain VHHs, and `tcrbuilder2-plus` for alpha/beta TCRs. `tcrbuilder2-original` selects the older TCR ensemble. Each choice loads all four checkpoints. Inputs contain sequence alone; antigen binding and experimental efficacy are unmeasured.

Find installed examples with `ariax skills forge --tool immunebuilder --json`; set `EXAMPLES` to `data.examples.immunebuilder`. Read `ariax skills forge --reference immunebuilder-modes --read --json` for output definitions and limitations. Both `forge` and `ariax-forge` aliases resolve these guides.

Register the installed `abodybuilder2.json` example with Files, then select the tool:

```sh
ariax forge inputs add SESSION --file "$EXAMPLES/abodybuilder2.json" --path immunebuilder/abodybuilder2.json
ariax forge tools add SESSION --tools immunebuilder
ariax forge tools wait SESSION immunebuilder --timeout 1800
ariax forge run SESSION --tool immunebuilder --gpus 0 --timeout-seconds 1800 -- immunebuilder --family abodybuilder2 --input /inputs/immunebuilder/abodybuilder2.json --out /workspace/immunebuilder-abodybuilder2
ariax forge run SESSION --tool immunebuilder --gpus 0 -- immunebuilder-check --input /inputs/immunebuilder/abodybuilder2.json --out /workspace/immunebuilder-abodybuilder2
ariax forge sync SESSION --wait
ariax forge files SESSION --path /workspace/immunebuilder-abodybuilder2
```

`SESSION` is the existing Forge session ID. Choose a fresh output directory for each explicit run. This example has two receptors and reuses one loaded predictor sequentially. It retains all four unrefined structures and a CUDA-refined top-ranked structure per item, plus native error arrays and original residue mappings. The selected asset `immunebuilder-weights` mounts read-only at `/models/immunebuilder-weights`; outputs use `/workspace`, caches use scratch. Use `ariax forge catalog --tool immunebuilder --json` for available model IDs and resource requirements.

Inspect `batch.json` and each `result.json` before using a prediction. A failed refinement returns a failed command while retaining the unrefined output and diagnostics. `error_estimates.npy` stores Å²; `final_model.pdb` B-factors store its square root in Å. Smaller values mean less ensemble disagreement. These fields do not estimate binding affinity. Original chain IDs and supplied-sequence positions remain in `residue-mapping.json`, including trimmed prefix/suffix. Save the JSON input, all mappings, PDBs, arrays and result records through Files. See [saved results](../outputs.md) and [project controls](../SKILL.md#project-controls-and-resume) for checkpointing, closure and continuation.

Use the creator defaults for substantive work. `--unrefined-only` serves an explicit diagnostic path with no final refined PDB. `--numbering raw` gives sequential positions within the retained domain; IMGT remains the default. Arbitrary checkpoint subsets, CPU refinement and tensor batching are outside the supported scope. Long-batch memory behavior is unmeasured.

Source: ImmuneBuilder 1.2, commit `0df4e2ad82a1aa60f37ea9dae335d1198159ef78`, with documented CUDA/refinement and chain-aware writer corrections. Code BSD-3-Clause; original and plus checkpoints CC BY 4.0. ANARCI's underlying IMGT data has separate attribution; terms for the packaged derived HMM snapshot remain unverified. [Creator guidance](https://github.com/oxpig/ImmuneBuilder), [paper](https://doi.org/10.1038/s42003-023-04927-7), [original weights](https://zenodo.org/records/7258553), [plus weights](https://zenodo.org/records/10892159). See the mode reference for exact terms and native behavior.
