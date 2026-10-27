# RFd4 structure-only search and continuation

This is the bounded native SAM example. The input is an annotated ligand and
its atom-level hydrogen-bond conditions, not a generic ligand-design template.
Check the live catalog and user authorization before running. Preserve its
component identity, charges, bonds and conditions. No AF3 or coupled oracle is
used or enabled by this recipe.

With `$EXAMPLES` and a ready `$SESSION`, stage the input and these reviewed
checkers. Record every returned input ID and inspect its status until ready:

```sh
ariax forge inputs add "$SESSION" --file "$EXAMPLES/search/SAM_hbonds.cif.zst" --path rfd4/search/SAM_hbonds.cif.zst --json
for name in rfd4.py rfd4_search.py check_search_settings.py; do
  ariax forge inputs add "$SESSION" --file "$EXAMPLES/checks/$name" --path "rfd4/checks/$name" --json
done
ariax forge inputs status "$SESSION" INPUT_ID --json
```

Use one input, one process and a fresh trace path whose parent already exists.
The trace below is directly under `/workspace`, which exists before the command.
The preset's in-image default input is not present; the explicit uploaded path
is required. The preset composes the metrics group, so `metrics=no_oracle`
replaces it; its checkpoint provider is `interchain_interactions`.

```sh
ariax forge run "$SESSION" --tool rfd4 --gpus 0 --timeout-seconds 2400 -- \
  env OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 NUMEXPR_NUM_THREADS=1 \
  ARIAX_RFD4_SEARCH_TRACE=/workspace/rfd4-search-001-selection.jsonl \
  rfd4-generate --config-dir /opt/ariax/rfd4 \
  inference_experiment=sm_binder_hbond_search metrics=no_oracle \
  inputs=/inputs/rfd4/search/SAM_hbonds.cif.zst \
  hf_ckpt_path=/models/rfd4-proteina hf_ckpt_revision=null \
  out_dir=/workspace/rfd4/search-001 hydra.run.dir=/workspace/rfd4/search-001/hydra \
  seed=7 batch_size=1 num_workers=0 num_replicates=1 \
  compile_lengths=null inference_backend=native delete_failing_pre_oracle=false \
  +search.save_rollouts=true search.save_states=true
```

The preset uses two branches and two beams, with checkpoints at steps 40 and
60. At 40 it maximizes H-bond atom-pair count. At 60 it maximizes
`min(hbond_atom_pair_count_coi, 6) + 0.5 * hydrophobic_atom_pair_count_coi`.
These are counts for the indicated interface, not binding affinities. Compare
candidates within the same input and checkpoint and retain the losing rollouts.

After the writer stops, capture provenance and inspect selection against native
candidate metrics, saved states and outputs:

```sh
ariax forge run "$SESSION" --tool rfd4 --timeout-seconds 600 -- \
  python /opt/ariax/rfd4/prepare_outputs.py --run-dir /workspace/rfd4/search-001 \
  --input-spec /inputs/rfd4/search/SAM_hbonds.cif.zst --model-dir /models/rfd4-proteina \
  --materialize-sidecars
ariax forge run "$SESSION" --tool rfd4 --timeout-seconds 120 -- \
  python /inputs/rfd4/checks/rfd4_search.py --run-dir /workspace/rfd4/search-001 \
  --trace /workspace/rfd4-search-001-selection.jsonl \
  --metrics-csv /workspace/rfd4/search-001/inference_metrics/per_example_metrics.csv
```

The JSONL records candidate IDs, raw metrics, rewards, selected indices/ranks,
continuation decision, expected state paths and resume metadata. The observer
does not change sampling or selection; a trace failure stops the command. The
native CSV alone does not mark winners, and state filenames give beam rank rather
than the originating candidate ID. Confirm that expected state files actually
exist and match the trace. Save the trace with the run and inspect the completed
checkpoint before any restore. Consult the catalog for the bounded restoration
scope; restoring files does not automatically continue a search.

## Continue a selected state explicitly

Only continue after the source writer stopped and the selected state, trace,
input, model and settings were saved and verified. Match the trace's step-40
selected rank to its actual ordinary state file; select that state intentionally,
not merely the largest-scoring row in a different pool. Compare the restored
input bytes and model metadata to their captured originals. For this exact run:

```sh
ariax forge run "$SESSION" --tool rfd4 --timeout-seconds 120 -- python -c '
from pathlib import Path
run = Path("/workspace/rfd4/search-001/ariax_provenance")
pairs = [(Path("/inputs/rfd4/search/SAM_hbonds.cif.zst"), run / "inputs/SAM_hbonds.cif.zst")]
pairs += [(Path("/models/rfd4-proteina") / n, run / "model" / n)
          for n in ("config.json", "release-checkpoints.json", "provenance.json")]
for current, saved in pairs:
    if not current.is_file() or not saved.is_file() or current.read_bytes() != saved.read_bytes():
        raise ValueError(f"Input/model differs or is missing: {current}")
    print("matches", current)
'
```

Review the saved `hydra/.hydra/config.yaml`, `overrides.yaml`, native logs and
input ordering. The state contains sampling tensors and a step, not authenticated
input, model or settings. The example below selects rank 0 of the verified
step-40 beam and copies its exact bytes to a new ordinary file; use the trace's
actual path if it differs:

```sh
SELECTED=/workspace/rfd4/search-001/sampling_states/SAM_hbonds_step40_beam0.pt
ariax forge run "$SESSION" --tool rfd4 --timeout-seconds 120 -- python -c '
import shutil, sys
from pathlib import Path
source, dest = map(Path, sys.argv[1:])
if source.is_symlink() or not source.is_file() or source.stat().st_size == 0:
    raise ValueError("Selected state must be a nonempty ordinary file")
with source.open("rb") as src, dest.open("xb") as dst:
    shutil.copyfileobj(src, dst)
print("copied", source, "to", dest)
' "$SELECTED" /workspace/rfd4/resume-001.pt
```

The following is a **new intended command**, retaining the original input,
ordering, model and settings, with a new run/trace path and both required
continuation arguments. `resume_seed=11` controls the new branches; `seed=7`
keeps input preprocessing settings matched.

```sh
ariax forge run "$SESSION" --tool rfd4 --gpus 0 --timeout-seconds 2400 -- \
  env OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 NUMEXPR_NUM_THREADS=1 \
  ARIAX_RFD4_SEARCH_TRACE=/workspace/rfd4-search-resume-001-selection.jsonl \
  rfd4-generate --config-dir /opt/ariax/rfd4 \
  inference_experiment=sm_binder_hbond_search metrics=no_oracle \
  inputs=/inputs/rfd4/search/SAM_hbonds.cif.zst \
  hf_ckpt_path=/models/rfd4-proteina hf_ckpt_revision=null \
  out_dir=/workspace/rfd4/search-resume-001 hydra.run.dir=/workspace/rfd4/search-resume-001/hydra \
  seed=7 batch_size=1 num_workers=0 num_replicates=1 \
  compile_lengths=null inference_backend=native delete_failing_pre_oracle=false \
  +search.save_rollouts=true search.save_states=true \
  search.resume_from=/workspace/rfd4/resume-001.pt search.resume_seed=11
```

After completion, capture the resumed run with `prepare_outputs.py` as above,
substituting `/workspace/rfd4/search-resume-001`. Then check state bytes,
selection, continuation trace and captured configuration:

```sh
ariax forge run "$SESSION" --tool rfd4 --timeout-seconds 120 -- \
  python /inputs/rfd4/checks/rfd4_search.py --run-dir /workspace/rfd4/search-001 \
  --trace /workspace/rfd4-search-001-selection.jsonl \
  --metrics-csv /workspace/rfd4/search-001/inference_metrics/per_example_metrics.csv \
  --continuation-run /workspace/rfd4/search-resume-001 \
  --continuation-trace /workspace/rfd4-search-resume-001-selection.jsonl \
  --continuation-metrics-csv /workspace/rfd4/search-resume-001/inference_metrics/per_example_metrics.csv \
  --source-rank 0 --resume-seed 11
ariax forge run "$SESSION" --tool rfd4 --timeout-seconds 120 -- \
  python /inputs/rfd4/checks/check_search_settings.py \
  --initial-run /workspace/rfd4/search-001 --resume-run /workspace/rfd4/search-resume-001 \
  --resume-path /workspace/rfd4/resume-001.pt --resume-seed 11
```

The second check compares capture-time resolved Hydra settings; retain and
compare original runtime files and logs as well. It is not a substitute for
checking input/model bytes. New output or trace paths must be fresh. A lost
command response is reconciled by its original command ID, not by launching a
replacement command.

## Reward semantics

Checkpoint indices are positive integration steps; step zero is implicit.
List each needed metric provider at every checkpoint that uses its outputs.
Higher total reward ranks first. Each term is clipped, divided by its positive
`normalize_by`, then multiplied by its weight and summed; use a negative
weight to minimize. These operations do not alter the saved raw metrics. A
missing or nonfinite required value is not a favorable zero. Without a terminal
checkpoint there is no final reward for the resulting survivors. Advanced
clean-prediction, save and continuation criteria are described in the pinned
[search reference](https://github.com/RosettaCommons/RFD4-Proteina/blob/aaccdd2ad0720c180468df5f9cf037a713d403e5/docs/reference/search-parameters.md);
their presence does not qualify alternative rewards, oracles or configurations.

This Forge adaptation inherits the attribution in the [entrypoint](../rfd4.md).
