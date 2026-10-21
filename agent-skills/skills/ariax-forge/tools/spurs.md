# SPURS mutation stability

Use `spurs` for a structure-aware change in stability relative to the supplied wild-type protein. Select `single` for one substitution or a saturation scan. `higher-order` loads a distinct trained checkpoint for combinations. Functional-site scoring combines the single checkpoint with ESM1v model 1.

The [mode reference](spurs/modes.md) describes score interpretation and source limits. Find the installed example with:

```sh
ariax skills forge --json
ariax skills forge --reference spurs --read --json
ariax skills ariax-forge --reference spurs-modes --read --json
```

Read `data.examples.spurs` from discovery. It contains the creator's DOCK1_MOUSE chain-A PDB, mutation arrays and the runnable `run.sh`. Register every file from that directory at `spurs/<filename>` using `ariax forge inputs add SESSION --file LOCAL_FILE --path spurs/FILENAME`. Observe each input's `ready` state. The local installed directory and the remote `/inputs/spurs` directory serve different stages.

Select a one-GPU session with the `spurs` tool and wait for readiness:

```sh
ariax forge tools add SESSION --tools spurs
ariax forge tools wait SESSION spurs
ariax forge run SESSION --tool spurs --gpus 0 --timeout-seconds 900 -- sh /inputs/spurs/run.sh /workspace/spurs-example
```

The example runs single-score controls, a complete saturation scan, a copy numbered 101–166 that checks parsed-position mapping, two double mutants plus a wild-type control, and both the corrected paper-aligned and creator notebook functional-site workflows on one real structure. Inspect `/workspace/spurs-example/checks.json` and each `result.json`. A passing process still needs scientifically appropriate inputs and interpretation. Larger proteins and newer GPU architectures require their own resource assessment; the bounded 66-residue case was exercised on an L40; hardware minima remain unmeasured.

For a selected substitution:

```sh
ariax forge run SESSION --tool spurs --gpus 0 -- spurs score --model single --pdb /inputs/spurs/DOCK1_MOUSE.pdb --chain A --mutations /inputs/spurs/mutations.json --output /workspace/spurs-single
```

Mutation strings use 1-based positions in the parsed chain sequence. Check `residue-map.json` against original PDB chain/residue identity. Canonical residues require N, CA, C and O atoms. This adapter rejects numbering gaps, insertion codes, multiple structure models, repeated positions and mismatched WT letters. A user-reviewed contiguous copy can be prepared with its original mapping retained. Each output directory must be new.

Single scores are already mutant-minus-WT in kcal/mol. Negative values predict stabilization; the single-model WT diagonal is zero. Higher-order scores retain the native learned correction and can have a WT offset. Compare those values with the constituent single-model sum as separate model outputs. That difference includes checkpoint changes and correction terms. Absolute folding stability requires a different method.

Save the registered inputs, mutation selections, all `result.json` and residue maps, arrays and CSV outputs through `ariax forge sync SESSION --wait`. Inspect `ariax forge files SESSION` and retain its checkpoint ID before closing. A later session restores these files without replaying scientific commands. Failed or empty requests produce an explicit failed result with its reason, and require an explicit corrected command.

The bounded example passed fresh-session recovery with complete comparison of all 36 input and output files. After Files restoration, explicitly check the saved scientific outputs with:

```sh
ariax forge run SESSION --tool spurs --gpus 0 --timeout-seconds 900 -- python /inputs/spurs/check.py /workspace/spurs-example
```

The checker consumes the saved outputs. Restoration passed for every shipped mode, including the creator notebook comparison. That comparison retains its held native qualification and unqualified functional interpretation.
