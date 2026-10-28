# SPURS mutation stability

Use `spurs` for a structure-aware change in stability relative to the supplied wild-type protein. Select `single` for one substitution or a saturation scan. `higher-order` loads a distinct trained checkpoint for combinations. Functional-site scoring combines the single checkpoint with ESM1v model 1.

The [mode reference](spurs/modes.md) describes score interpretation and source
limits. Discover the current model selection and installed example with:

```sh
ariax forge catalog --tool spurs --compact --json
ariax forge catalog --tool spurs --model MODEL --json
ariax skills forge --tool spurs --json
ariax skills forge --reference spurs --read --json
ariax skills ariax-forge --reference spurs-modes --read --json
```

Copy `MODEL` from the compact catalog's `models[].id`; omit `--model` if the
tool has no model IDs. The selected result lists its modes and support rows;
add `--mode MODE` to inspect an intended mode. `EXAMPLES` is the absolute `data.examples.spurs` directory from
the scoped skill lookup. It contains the creator's DOCK1_MOUSE chain-A PDB,
mutation arrays and runnable `run.sh`. Register every file from that directory
at `spurs/<filename>`:

```sh
ariax forge inputs add SESSION --file "$EXAMPLES/FILENAME" --path spurs/FILENAME
```

Observe each input's `ready` state. The installed directory and remote
`/inputs/spurs` directory serve different stages.

Use the shared [session lifecycle](../SKILL.md#discover-plan-run-and-close) to
select an authorized one-GPU session with the `spurs` tool and wait for readiness:

```sh
ariax forge tools add SESSION --tools spurs
ariax forge tools wait SESSION spurs
ariax forge run SESSION --tool spurs --gpus 0 --timeout-seconds 900 -- sh /inputs/spurs/run.sh /workspace/spurs-example
```

The example runs single-score controls, a complete saturation scan, a copy numbered 101–166 that checks parsed-position mapping, two double mutants plus a wild-type control, and both the corrected paper-aligned and creator notebook functional-site workflows on one real structure. Inspect `/workspace/spurs-example/checks.json` and each `result.json`. These example checks cover execution and output identity; experimental stability and functional-site accuracy remain unmeasured. The resource example is limited to 66 residues on an L40; assess larger proteins and other GPU architectures separately. Hardware minima remain unmeasured.

For a selected substitution:

```sh
ariax forge run SESSION --tool spurs --gpus 0 -- spurs score --model single --pdb /inputs/spurs/DOCK1_MOUSE.pdb --chain A --mutations /inputs/spurs/mutations.json --output /workspace/spurs-single
```

Mutation strings use 1-based positions in the parsed chain sequence. Check `residue-map.json` against original PDB chain/residue identity. Canonical residues require N, CA, C and O atoms. This adapter rejects numbering gaps, insertion codes, multiple structure models, repeated positions and mismatched WT letters. A user-reviewed contiguous copy can be prepared with its original mapping retained. Each output directory must be new.

Single scores are already mutant-minus-WT in kcal/mol. Negative values predict stabilization; the single-model WT diagonal is zero. Higher-order scores retain the native learned correction and can have a WT offset. Compare those values with the constituent single-model sum as separate model outputs. That difference includes checkpoint changes and correction terms. Absolute folding stability requires a different method.

Save the registered inputs, mutation selections, all `result.json` and residue maps, arrays and CSV outputs using the shared [saved-results instructions](../outputs.md). A later session restores these files without replaying scientific commands. Failed or empty requests produce an explicit failed result with its reason, and require an explicit corrected command.

For the bundled example, inspect saved outputs with the checker inside the ready
tool container:

```sh
ariax forge run SESSION --tool spurs --gpus 0 --timeout-seconds 900 -- python /inputs/spurs/check.py /workspace/spurs-example
```

The checker consumes the example's saved outputs and checks its specific
controls. It does not establish biological accuracy or validate arbitrary user
inputs. The creator notebook method is a comparison path with native
qualification on hold and unvalidated biological interpretation; inspect its
current catalog status and the [mode reference](spurs/modes.md) before use.
