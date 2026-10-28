# RFd4 generation and non-oracle evaluation

These are finite native examples, not general design guarantees. Check the live
catalog, confirm the user's compute authorization and stage only the selected
inputs before running. `$SESSION` is a ready Forge session, `$EXAMPLES` is
`data.examples.rfd4`, and `ariax forge run` returns the command ID to observe.
Use fresh directories and retain all resulting structures, metrics and logs.
The [output guide](outputs.md) explains interpretation and persistence.

## Stage reviewed inputs and checks

The [entrypoint](../rfd4.md) stages the monomer or binder. For the other cases,
this shell loop stages the small examples; omit files for cases not selected:

```sh
for rel in protein/indexed_1qjg.cif.zst protein/unindexed_1qjg.cif.zst \
  partial/resolved_seed.yaml partial/1ubq.cif \
  antibody/mzb1_7AAH__h-NbBCII10_cdr123.cif.zst; do
  ariax forge inputs add "$SESSION" --file "$EXAMPLES/$rel" --path "rfd4/$rel" --json
done
for name in rfd4.py rfd4_protein.py rfd4_partial.py rfd4_antibody.py check_rejected.py; do
  ariax forge inputs add "$SESSION" --file "$EXAMPLES/checks/$name" --path "rfd4/checks/$name" --json
done
```

Record each returned input ID and use `ariax forge inputs status "$SESSION"
INPUT_ID --json` until every selected input and checker is ready. A YAML's
companions must retain their relative paths. The checkers run inside the RFd4
image; they are case-specific evidence, not scientific qualification.

## Generate with inline metrics

In Bash or Zsh, select **one** of these cases. `CASE` selects a fresh directory;
`EXTRA` contains native overrides for that case. For the binder, first stage
`baseline/binder.yaml` and `baseline/5o45_cropped.cif.zst` as in the entrypoint.

```sh
# PD-L1 binder
CASE=binder-001
INPUT=/inputs/rfd4/baseline/binder.yaml
TAGS='[design,hotspot_conditioning,internal_coordinate_conditioning]'
EXTRA=()

# Indexed 1QJG motif
CASE=indexed-001
INPUT=/inputs/rfd4/protein/indexed_1qjg.cif.zst
TAGS='[design,3d_coordinate_conditioning]'
EXTRA=()

# Unindexed 1QJG motif
CASE=unindexed-001
INPUT=/inputs/rfd4/protein/unindexed_1qjg.cif.zst
TAGS='[design,3d_coordinate_conditioning,unindexed]'
EXTRA=()

# Resolved 1UBQ partial diffusion
CASE=partial-001
INPUT=/inputs/rfd4/partial/resolved_seed.yaml
TAGS='[design,partial_diffusion]'
EXTRA=('generation.args.partial_trajectory_fraction_steps=0.3333')

# Cropped MZB1 / VHH with sampled target hotspots
CASE=vhh-001
INPUT=/inputs/rfd4/antibody/mzb1_7AAH__h-NbBCII10_cdr123.cif.zst
TAGS='[design,antibody,3d_coordinate_conditioning,internal_coordinate_conditioning,hotspot_conditioning]'
EXTRA=('recycle_strategy=high/front_loaded' '+generation.dataset.sampling_transforms=[{_target_:rfproteina.transforms.hotspot_sampling.SampleNearbyHotspots,num_hotspots:[2,3],min_distance:5.0,patch_diameter:15.0,min_atom_sasa:1.0}]')
```

For authored, fixed `C_HOT` sites, omit the hotspot-sampling transform. The
pinned default config has no `generation.dataset.sampling_transforms` key;
omit an unnecessary null override, or use Hydra's `+` syntax when adding it.


For partial diffusion, check the actual assembled seed **before** sampling:

```sh
ariax forge run "$SESSION" --tool rfd4 --timeout-seconds 120 -- \
  python /inputs/rfd4/checks/rfd4_partial.py --input-spec "$INPUT" --input-only
```

The selected input uses A1–76 of resolved 1UBQ and excludes waters. The fraction
`0.3333` runs approximately the final third of the default 60-step trajectory;
it is not a distance. The [input guide](inputs.md) explains finite-coordinate
checks and how native prevalidation can miss unresolved heavy atoms.

Then run the chosen case:

```sh
ariax forge run "$SESSION" --tool rfd4 --gpus 0 --timeout-seconds 2400 -- \
  env OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 NUMEXPR_NUM_THREADS=1 \
  rfd4-generate --config-dir /opt/ariax/rfd4 \
  inference_experiment=inference_on_user_inputs metrics=no_oracle \
  hf_ckpt_path=/models/rfd4-proteina hf_ckpt_revision=null \
  inputs="$INPUT" "metrics_tags=$TAGS" \
  out_dir="/workspace/rfd4/$CASE" hydra.run.dir="/workspace/rfd4/$CASE/hydra" \
  num_replicates=1 batch_size=1 num_workers=0 seed=7 \
  compile_lengths=null delete_failing_pre_oracle=false \
  "${EXTRA[@]}"
```

`inference_on_user_inputs` already composes a metrics group, so
`metrics=no_oracle` replaces it. The separate quickstart preset in the
entrypoint has no metrics group; adding that group there requires
`+metrics=no_oracle`. The no-oracle group itself has no filters or pass criteria.
It does not qualify every tag or metric dependency. Thread limits keep metric
workers within Forge's process limit; image caches use disposable `/scratch`.

After completion, inspect command state and logs. Check that one generated CIF
and its matching native `inference_metrics/per_example_metrics.csv` exist:

```sh
ariax forge run "$SESSION" --tool rfd4 --timeout-seconds 120 -- \
  python /inputs/rfd4/checks/rfd4.py "/workspace/rfd4/$CASE" --expected-count 1 \
  --metrics-csv "/workspace/rfd4/$CASE/inference_metrics/per_example_metrics.csv"
```

Set `GENERATED` to the exact returned `*_generated.cif` path and `METRICS` to
that run's `inference_metrics/per_example_metrics.csv`. Run the corresponding
case checker below; for unindexed motifs supply the **generation-time** CSV.
The 1 Å bound shown for motif checks is the bound used in these finite checks,
not a universal acceptance threshold.

```sh
# Binder: also verifies the six original-numbered hotspot atoms and both mappings.
ariax forge run "$SESSION" --tool rfd4 --timeout-seconds 120 -- \
  python /inputs/rfd4/checks/rfd4_protein.py --case binder \
  --input-spec "$INPUT" --generated "$GENERATED" --metrics-csv "$METRICS" --max-motif-rmsd-angstrom 1.0

# Indexed or unindexed: replace CASE_KIND with exactly indexed or unindexed.
ariax forge run "$SESSION" --tool rfd4 --timeout-seconds 120 -- \
  python /inputs/rfd4/checks/rfd4_protein.py --case CASE_KIND \
  --generated "$GENERATED" --metrics-csv "$METRICS" --max-motif-rmsd-angstrom 1.0

# Partial: check finite generated coordinates, seed mapping, sequence and CA metrics.
ariax forge run "$SESSION" --tool rfd4 --timeout-seconds 120 -- \
  python /inputs/rfd4/checks/rfd4_partial.py --input-spec "$INPUT" \
  --generated "$GENERATED" --mode partial --metrics-csv "$METRICS"

# VHH: compare framework and CDR flanks/realized lengths, conditions and metrics.
ariax forge run "$SESSION" --tool rfd4 --timeout-seconds 120 -- \
  python /inputs/rfd4/checks/rfd4_antibody.py "$INPUT" "$GENERATED" --metrics-csv "$METRICS"
```

Choose only the matching checker. The VHH evidence is limited to this example:
check the conditioned framework, expanded CDRs between mapped flanks, sequence
freedom and sampled target hotspots. Expanded CDR atoms may lack original source
labels. This does not establish support for every antibody format or binding.
For a custom spec, export its [input mapping](inputs.md) and inspect its actual
masks and output; the fixture checker is intentionally not a generic binder test.

## Score a selected generated structure offline

The evaluator recursively finds structure files; it does **not** select only
`*_generated` files. Stage a new directory containing only the intended
annotated generated CIFs, as regular files. This example copies the one monomer
from the entrypoint after that generation has completed:

```sh
ariax forge run "$SESSION" --tool rfd4 --timeout-seconds 120 -- python -c '
from pathlib import Path
from shutil import copyfile
source = Path("/workspace/rfd4/monomer-001/inference_samples/monomer_0/monomer_0_generated.cif")
target = Path("/workspace/rfd4/eval-input-001")
target.mkdir(parents=True, exist_ok=False)
copyfile(source, target / source.name)
print("selected", source, "->", target / source.name)
'
ariax forge run "$SESSION" --tool rfd4 --timeout-seconds 1800 -- \
  env OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 NUMEXPR_NUM_THREADS=1 \
  rfd4-evaluate --config-dir /opt/ariax/rfd4 metrics=no_oracle \
  inputs=/workspace/rfd4/eval-input-001 'metrics_tags=[design]' \
  out_dir=/workspace/rfd4/eval-001 hydra.run.dir=/workspace/rfd4/eval-001/hydra \
  delete_failing_pre_oracle=false
```

The `design` tag asks for applicable inline design metrics on this unconditioned
monomer. Select tags appropriate to other annotated structures; the metric table
in [outputs](outputs.md) identifies context limits. Verify the selected paths and
count against `evaluation_metrics/per_example_metrics.csv`: its `example_id`
includes a hash of the relative input path, and `designed_structure_path` points
to the evaluated copy. Input/chain/trajectory sidecars are evidence, not extra
candidates. A `task_csv` is optional; it maps exact `designed_structure_path` and
`task` columns for grouping, defaulting to task `all` when omitted.

For a deliberately failing **negative control only**, use the same selected
input and a fresh output directory. `check_rejected.py` must be staged and ready:

```sh
ariax forge run "$SESSION" --tool rfd4 --timeout-seconds 1800 -- \
  env OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 NUMEXPR_NUM_THREADS=1 \
  rfd4-evaluate --config-dir /opt/ariax/rfd4 metrics=no_oracle \
  inputs=/workspace/rfd4/eval-input-001 'metrics_tags=[design]' \
  out_dir=/workspace/rfd4/eval-negative-001 hydra.run.dir=/workspace/rfd4/eval-negative-001/hydra \
  delete_failing_pre_oracle=false \
  '+metrics.pre_oracle_filters={unknown_residue_filter:{_target_:rfproteina.metrics.oracles.pass_criterion_metric.PassCriterionMetric,metric_thresholds:{amino_acid_composition.n_generated_unknown_residues:{max:-1}}}}'
ariax forge run "$SESSION" --tool rfd4 --timeout-seconds 600 -- \
  python /opt/ariax/rfd4/prepare_outputs.py --run-dir /workspace/rfd4/eval-negative-001 \
  --input-spec /workspace/rfd4/eval-input-001/monomer_0_generated.cif \
  --model-dir /models/rfd4-proteina --materialize-sidecars
ariax forge run "$SESSION" --tool rfd4 --timeout-seconds 120 -- \
  python /inputs/rfd4/checks/check_rejected.py \
  --source /workspace/rfd4/eval-input-001/monomer_0_generated.cif \
  --run-dir /workspace/rfd4/eval-negative-001
```

The unknown count cannot be negative, so the impossible threshold rejects the
selected design; it is not a scientific cutoff. The checker requires the
nonnegative measured count, `pre_oracle_pass=0`, an ordinary sidecar identical
to the input and no remaining symlinks. Retain the rejected input, filter outcome,
IDs and all score rows. Do not interpret an absent score as a pass. For normal
evaluation, materialize sidecars and capture provenance using the
[outputs procedure](outputs.md) before syncing.

This Forge adaptation inherits the attribution in the [entrypoint](../rfd4.md).
