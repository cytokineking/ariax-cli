# OpenDDE-Harness native controller and saved batch bridge

Use OpenDDE-Harness for iterative protein design with native analysis, design,
reflection, loss/gates and terminal MPNN/refold/pose/PostFilter stages. This
integration pins [Harness 0.0.4](https://github.com/aurekaresearch/OpenDDE-Harness/tree/8bb8684b2d3185381f4812c286e044d5679bfd6f),
source `8bb8684b2d3185381f4812c286e044d5679bfd6f`.

Choose the [native controller](examples/opendde-harness/controller.md) for the
documented deterministic CRLF2/VHH ABAG workflow and explicit optimizer
continuation. Choose the [saved-batch bridge](examples/opendde-harness/bridge.mjs)
to execute an already prepared native fold batch using standalone
[OpenDDE](opendde.md). The bridge does not restore the optimizer or run native
loss, quality gates or population admission. Run either on a trusted remote GPU
controller; keep credentials outside workloads and saved scientific state.
Desktop sign-in alone does not authenticate Harness.

The controller and saved-batch bridge hold before dispatch if the project-files
API cannot confirm that a published local input is installed on the active
session. They can continue when the server reports daemon-backed installation
status; retain the original controller, CLI root, input IDs and command IDs in
the meantime. Older servers may not expose this confirmation.

```sh
ariax forge catalog --task binder-design --compact --json
ariax forge catalog --tool TOOL --model MODEL --json
ariax skills forge --tool opendde-harness --json
```

Copy `TOOL` and `MODEL` from the compact result's `tool` and `models[].id`,
then select a listed mode with `--mode MODE` as needed. Omit `--model` for a
model-less tool. Use `opendde-harness` for the controller and `opendde` for the
bridge's fold execution; use task `molecular-prediction` to discover the latter.
Inspect the exact selection's support and resources.
The scoped skill lookup returns `data.examples["opendde-harness"]`; set
`HARNESS_EXAMPLES` to that absolute directory.

## Saved-batch inputs and supported mode

The native task directory contains `workflow.json`, `snapshot.json`,
`control.json` and `worker.json`. `control.json` records a revision, stop
request and pending adjustments. The prepared compute batch contains
`meta.json` and `input/batch_input.json`; labels such as `input_0000` reflect
original request order. Supply the actual original FoldRequest as
`fold-request.json`, including task/candidate IDs, per-chain sequences, options
and placement. Capture it from its call/trace before execution; a ranked
population cannot recover that order.

The bridge saves six original texts: workflow, snapshot, control, FoldRequest,
batch input and metadata. It checks target/binder chains and numeric seeds
against the prepared batch. Its supported contract is:

- One CUDA GPU at index 0, local or Docker one-shot execution, no context
  parallelism or API mode. Local commands expose only GPU 0; Docker commands
  request only that device. CPU or an unresolved `auto` device is unsupported.
- Explicit `use_msa: false`, atom confidence enabled, no MSA search or templates.
  Dtype, RNA-MSA and CP overrides for fields omitted by the pinned builder are
  unsupported; the OpenDDE defaults are fp32, RNA-MSA false and single/one CP.
- The recorded checkpoint is preserved: `opendde.pt` means general and
  `opendde_abag.pt` means ABAG. Minibinder requires general. Native recycling
  cycles and diffusion steps/samples are preserved.
- The saved one-shot command must contain the pinned builder's device, seeds,
  MSA, template, atom-confidence and sampling arguments. Missing, repeated,
  unknown or conflicting arguments fail before staging.

Harness's saved `deterministic` choice controls `PYTHONHASHSEED=0` and
`CUBLAS_WORKSPACE_CONFIG=:4096:8`. The bridge checks and preserves that
environment; it does not enable OpenDDE's separate deterministic flag, which
the pinned one-shot builder omits. The bridge selects
`trimul_kernel=torch` and `triatt_kernel=torch`, whereas the native controller
uses auto/auto kernels. Numerical equivalence between these paths is not
established; the saved-batch path failed its numerical comparison. Use the
controller's explicit deterministic workflow when that mode is required.

## Execute a prepared fold batch

Select an authorized session with ready `opendde` through the shared
[Forge workflow](../SKILL.md). Creation/resume starts paid allocation; the
bridge itself creates no session or allowance. Node >=20 and the installed CLI
own transfers, durable requests and journal writes. Keep `bridge.mjs` inside
the installed package because it imports CLI helpers. Set `HARNESS_SESSION`
and `HARNESS_PROJECT` to the selected session and project IDs.

On the remote controller, set `HARNESS_BRIDGE` to
`$HARNESS_EXAMPLES/bridge.mjs` and `HARNESS_RUNNER` to `native_batch.py` in the
prepared adapter directory. Set `HARNESS_TASK` and `HARNESS_RUN` to the actual
native saved directories, and `HARNESS_REQUEST` to their captured FoldRequest.
The packaged files under `task/`, `batch-run/` and `fold-request.json` are
authored inputs, not completed native results.

```bash
mkdir -p /srv/harness/controller

node "$HARNESS_BRIDGE" prepare --task-dir "$HARNESS_TASK" --run-dir "$HARNESS_RUN" \
  --request "$HARNESS_REQUEST" --runner "$HARNESS_RUNNER" \
  --session "$HARNESS_SESSION" --project "$HARNESS_PROJECT" \
  --output /workspace/harness/native-batch \
  --state /srv/harness/controller/batch.json --root-dir /srv/harness/controller

node "$HARNESS_BRIDGE" submit --state /srv/harness/controller/batch.json
# If input_pending is returned, inspect that input ID and repeat submit.
node "$HARNESS_BRIDGE" status --state /srv/harness/controller/batch.json
ariax --root-dir /srv/harness/controller forge watch \
  "$HARNESS_SESSION" "$HARNESS_COMMAND" --timeout 7200 --json
ariax --root-dir /srv/harness/controller forge run "$HARNESS_SESSION" \
  --tool opendde --gpus 0 -- \
  python /opt/forge-opendde/opendde_outputs.py \
  /workspace/harness/native-batch/prediction
```

Set `HARNESS_COMMAND` from `prepare`/`submit`. Repeated `submit` observes the
same command ID and does not create a new attempt. Inspect report
`batch_complete`, every item state, attempt exit code and native file. A zero
exit with pending items is partial success. `native_campaign_complete` remains
false even when every fold succeeds.

Request cancellation with
`node "$HARNESS_BRIDGE" stop --state /srv/harness/controller/batch.json`.
Wait for that command to become terminal before another attempt. Reading
snapshot/control or `status` runs no scientific work. Native stops or pending
adjustments prevent a new initial batch until explicitly reviewed.

## Continue unfinished fold items

Preserve the original CLI root/account/API origin, state, bundle and runner
files. Follow [saved results](../outputs.md) and
[same-project resume](../SKILL.md#project-controls-and-resume) to save and
restore `/workspace/harness/native-batch` when moving to a new allocation.
Require a successful flush and a ready same-project `opendde` session.
Set `HARNESS_PROJECT` to the project ID and `HARNESS_RESUMED` to the
ready resumed session ID. All downloads below stay on the remote controller.

```bash
ariax --root-dir /srv/harness/controller forge download "$HARNESS_PROJECT" \
  /workspace/harness/native-batch/prediction/batch.json \
  --dest /srv/harness/controller/restored-batch-state.json --json
node "$HARNESS_BRIDGE" continue --state /srv/harness/controller/batch.json \
  --session "$HARNESS_RESUMED" \
  --batch-state /srv/harness/controller/restored-batch-state.json \
  --items input_0001 --resume
# If input_pending is returned, finish staging with the saved command ID:
node "$HARNESS_BRIDGE" submit --state /srv/harness/controller/batch.json
```

Replace `input_0001` with the actual unfinished names; `--items` accepts a
comma-separated list. The prior command must be terminal. Continuation checks
the saved OpenDDE jobs, source and settings, creates a new attempt and skips
successful items. `--max-items N` on initial preparation can bound how many
items that attempt processes; use distinct state/output paths for a different
batch. The backend rechecks human holds at admission.

`--resume` recovers fold items; it does not clear native stops, change
adjustments or restore the search loop. Native `start` creates new population
and RNG state. `population.json`, `search_history.json` and
`final_selection.json` alone cannot restore the optimizer; use the separate
native controller for that operation. An uncertain submission must be inspected
under its existing ID before retrying the identical request.

If a report is missing, preserve `prediction/batch.json` and native files,
inspect the original command, and use the prepared native runner's `report`
operation with a fresh report UUID to summarize retained state. Reporting
starts no prediction. Unsaved outputs remain unavailable and cannot be inferred
from process status.

## Outputs and scientific limits

`native-source/` retains the original texts. `prediction/batch.json` and attempt
directories retain exact jobs, seeds, failures and logs. Every successful
job/seed/sample requires a complete nonempty CIF, summary-confidence,
full-data-confidence and identity-sidecar set from its latest OpenDDE attempt.
Reports reject absolute, traversing or symlinked output paths, other items'
files, missing output lists and unavailable successful files. Failed, pending
and interrupted rows retain their states and `retained_files` availability.
Partial files do not establish successful predictions.

The sidecar distinguishes diffusion index from filename confidence rank and
maps original asym IDs and token/atom axes. Native atom pLDDT is 0–1; CIF
B-factors are 0–100; PAE/PDE use angstrom. Preserve these files together.
Reports keep candidate IDs/metadata, parent relationships and native input
names. Bridge metrics are unavailable; the native parser's zero fallback for
optional failed metrics is not scientific evidence. For completed protein
samples, use [OpenDDE's original-run-ID handoff](opendde.md#inspect-outputs-and-score-a-protein-interface)
and the [interface-scoring consumer](interface-scores.md). Keep exclusions,
rejected candidates and unavailable metrics. Scores do not establish binding.

The bridge uses OpenDDE 1.1.1 source
`ddfa1df8aff1babf1fddac4247b7d2351bd0ce9f`, Torch 2.7.1/CUDA 12.6 and model
revision `eddd563ce96571f784012edd8f045181c8f8627d`. The native controller uses
GPT-6.1 Sol, ABAG, offline ESM2-650M revision
`08e4846e537177426273712802403f7ba8261b6c` and soluble ProteinMPNN from
LigandMPNN `26ec57ac976ade5379920dbd43c7f97a91cf82de`.
Its documented scope is the deterministic one-/two-cycle CRLF2/VHH workflow;
broader settings, nondeterministic execution, paid Quality phases and
separate-host recovery are not established by these examples. An interrupted
paid/tool loop without a complete retained outcome remains blocked.

Sources: [native control files](https://github.com/aurekaresearch/OpenDDE-Harness/blob/8bb8684b2d3185381f4812c286e044d5679bfd6f/opendde_harness/plugin/protein_design/core/detached.py),
[native loop](https://github.com/aurekaresearch/OpenDDE-Harness/blob/8bb8684b2d3185381f4812c286e044d5679bfd6f/opendde_harness/plugin/protein_design/core/orchestrator.py),
[compute/scoring](https://github.com/aurekaresearch/OpenDDE-Harness/blob/8bb8684b2d3185381f4812c286e044d5679bfd6f/opendde_harness/plugin/protein_design/servers/harness.py),
[native fold files](https://github.com/aurekaresearch/OpenDDE-Harness/blob/8bb8684b2d3185381f4812c286e044d5679bfd6f/opendde_harness/plugin/protein_design/servers/backends/fold.py).
