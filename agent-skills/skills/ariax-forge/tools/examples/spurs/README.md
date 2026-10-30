# SPURS native example

DOCK1_MOUSE chain A comes from the [creator's MIT source example](https://github.com/luo-group/SPURS/blob/70cbb99af5cdf1f6da392389aaf93fd245610efb/data/inference_example/DOCK1_MOUSE.pdb). The native sequence begins WVP; mutation numbering starts at its first parsed residue. This bounded case exercises inference and output identity. Functional-site biological accuracy remains unmeasured. The example compares the corrected paper-aligned formula with the explicitly labeled creator notebook path.

Locate this directory with `ariax skills forge --tool spurs --json` and read
`data.examples.spurs`. Register every file under `spurs/` in an authorized Forge
session, following the [tool guide](../../spurs.md). Run in the ready tool:

```sh
ariax forge run SESSION --tool spurs --gpus 0 --timeout-seconds 900 -- sh /inputs/spurs/run.sh /workspace/spurs-example
```

Inspect `checks.json` for WT controls, both double-mutant scores and the constituent single-model sums. The `functional` directory retains ESM1v and corrected residual arrays with fit status; `functional-native` retains the source notebook comparison. These checks are specific to this example and do not validate arbitrary proteins or functional annotations. Follow the [saved-results instructions](../../../outputs.md) to flush inputs and results. Select a new output directory for each explicit rerun.

`DOCK1_MOUSE-offset.pdb` changes only PDB residue numbers to 101–166. The example still scores W1A at parsed sequence position 1 and checks agreement with the unshifted file, retaining the auth-residue mapping.
