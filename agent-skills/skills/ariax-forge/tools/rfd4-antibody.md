# RFd4 antibody checkpoint

Use `rfd4-antibody` to generate a VHH sequence and structure from a target
structure and a conditioned VHH framework. The
[antibody checkpoint](https://huggingface.co/nvidia/RFD4-Proteina/tree/621b785abf9d61dd24f4b81ae4dbd1330728f030/antibody)
is separate from the October 19 generalist in [RFd4](rfd4.md). For paired VH/VL, scFv or Fab
work, compare the live scope of [RFantibody](rfantibody.md),
[IgDesign](igdesign.md), and other relevant tools. Preserve the generated
sequence for independent prediction and experimental evaluation: coordinates,
contacts and scores do not establish binding or developability.

Check the exact live model and mode before planning a run:

```sh
ariax forge catalog --task antibodies --compact --json
ariax forge catalog --tool rfd4-antibody --model rfd4-proteina-antibody-2026-10-30 --mode antibody-nanobody --json
ariax skills forge --tool rfd4-antibody --json
ariax skills forge --reference rfd4-antibody --read --json
```

Use the row's qualification and workload information; a guide or fixture alone
does not establish availability. The [campaign guidance](../references/campaign-recipes.md#antibody-or-nanobody-design-prediction-and-export)
describes alternatives and downstream handoffs.

## Input and conditions

Supply an annotated target/framework structure with chain and residue mappings,
fixed framework sequence and internal geometry, and intended CDR masks and
length ranges. The framework can move relative to the target while preserving
its internal geometry. Check missing atoms, target cropping, and the intended epitope. Input
numbering need not match output numbering. The [RFd4 input guide](rfd4/inputs.md)
explains the annotations and mappings.

The bundled example contains a cropped MZB1 target and h-NbBCII10 VHH. Its
three expandable CDRs and A79 ASN CB target hotspot are authored in the CIF.
The recipe below keeps that fixed hotspot; a sampled-hotspot transform is a
separate choice and its realized sites must be inspected. A requested hotspot
is a conditioning signal, not a guarantee of contact. See the
[fixture inventory](examples/rfd4/README.md) for source and license notices.

The native loader can adopt an input path-length cutoff from a checkpoint after
Hydra saves its configuration. Set and retain the cutoff explicitly for matched
comparisons; the recipe uses the shared value `64` for these checkpoints.

## One-VHH recipe

Create or reuse an authorized session with `rfd4-antibody`, following the
[Forge lifecycle](../SKILL.md). Set `SESSION` and `PROJECT` from that session,
and set `EXAMPLES` to the installed `data.examples['rfd4-antibody']` path from
scoped skill discovery. Stage the input and checker files, retaining each input
ID returned by the CLI:

```sh
ariax forge tools wait "$SESSION" rfd4-antibody --timeout 1800 --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/antibody/mzb1_7AAH__h-NbBCII10_cdr123.cif.zst" --path rfd4-antibody/mzb1.cif.zst --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/checks/rfd4.py" --path rfd4-antibody/checks/rfd4.py --json
ariax forge inputs add "$SESSION" --file "$EXAMPLES/checks/rfd4_antibody.py" --path rfd4-antibody/checks/rfd4_antibody.py --json
```

Set `STRUCTURE_INPUT_ID`, `READER_INPUT_ID`, and `CHECK_INPUT_ID` to those IDs.
This command generates one design in a fresh output directory using the native
antibody preset and non-oracle metrics:

```sh
ariax forge run "$SESSION" --tool rfd4-antibody --gpus 0 --wait-ready \
  --input-ids "$STRUCTURE_INPUT_ID" --wait --wait-timeout 3000 --timeout-seconds 2400 -- \
  env OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 NUMEXPR_NUM_THREADS=1 \
  CUEQ_TRIMUL_BLACKWELL_INFERENCE=0 rfd4-generate --config-dir /opt/ariax/rfd4 \
  inference_experiment=inference_on_user_inputs metrics=no_oracle \
  +model_preset=rfd4_antibody inputs=/inputs/rfd4-antibody/mzb1.cif.zst \
  'metrics_tags=[design,antibody,3d_coordinate_conditioning,internal_coordinate_conditioning,hotspot_conditioning]' \
  out_dir=/workspace/rfd4-antibody/vhh-001 \
  hydra.run.dir=/workspace/rfd4-antibody/vhh-001/hydra \
  num_replicates=1 batch_size=1 num_workers=0 seed=7 \
  recycle_strategy=high/front_loaded compile_lengths=null skip_existing=false \
  +generation.dataset.transform.path_length_search_cutoff=64 \
  delete_failing_pre_oracle=false
```

Observe the command ID and logs; reconcile the same ID if its outcome is
uncertain. After success, set `GENERATED` and `METRICS` to the actual generated
CIF and `inference_metrics/per_example_metrics.csv`, then run the fixture check:

```sh
ariax forge run "$SESSION" --tool rfd4-antibody --wait-ready \
  --input-ids "$STRUCTURE_INPUT_ID,$READER_INPUT_ID,$CHECK_INPUT_ID" --wait --timeout-seconds 120 -- \
  python /inputs/rfd4-antibody/checks/rfd4_antibody.py \
  /inputs/rfd4-antibody/mzb1.cif.zst "$GENERATED" --metrics-csv "$METRICS"
ariax forge run "$SESSION" --tool rfd4-antibody --wait-ready --input-ids "$STRUCTURE_INPUT_ID" --wait --timeout-seconds 600 -- \
  python /opt/ariax/rfd4/prepare_outputs.py \
  --run-dir /workspace/rfd4-antibody/vhh-001 \
  --input-spec /inputs/rfd4-antibody/mzb1.cif.zst --model-dir /models/rfd4-antibody
```

The fixture checker verifies framework identity, CDR lengths and retained
conditions, but does not establish that the authored hotspot was contacted.
Inspect the hotspot, mapped framework cysteines and their geometry in the
output. Retain the full structure, sequence, mappings, Hydra settings, model
provenance, metrics and logs. The [RFd4 outputs guide](rfd4/outputs.md)
explains metric and recovery semantics. Sync the workspace, inspect the saved
files, and finish the session as described in the lifecycle guide.

This guide adapts the upstream [VHH example](https://github.com/RosettaCommons/RFD4-Proteina/blob/aaccdd2ad0720c180468df5f9cf037a713d403e5/examples/antibody_design/README.md)
by the Institute for Protein Design / Baker Lab and NVIDIA GenAIR. Upstream
documentation is [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/);
the fixture retains its [BSD 3-Clause notice](examples/rfd4/baseline/LICENSE).
