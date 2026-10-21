# OpenDDE-Harness native controller and saved batch bridge

Scoped integration of [Harness 0.0.4](https://github.com/aurekaresearch/OpenDDE-Harness/tree/8bb8684b2d3185381f4812c286e044d5679bfd6f),
source `8bb8684b2d3185381f4812c286e044d5679bfd6f`. The native controller uses
the explicitly deterministic mode; check the current Forge catalog for admission.

Remote validation has passed two small native auto/auto CUDA 12.8 folds with
native loss/gates, exact offline model consumers, authenticated Files restoration,
and installed CLI/bridge checks. The explicitly deterministic native controller
passed the unchanged 1e-4 comparison with zero coordinate and confidence
differences on both small fixtures. Historical nondeterministic and saved-batch
OpenDDE comparisons failed; their failures remain recorded.

Use the [saved-batch driver](examples/opendde-harness/bridge.mjs) or
[native controller recipe](examples/opendde-harness/controller.md) on an authorized
remote GPU controller.
The controller retains original operation IDs and optimizer state for explicit
continuation; unavailable paid outcomes stay blocked. The one-cycle GPT-6.1 campaign completed Analyze, Design, Reflection,
terminal MPNN/refold/pose processing and PostFilter. The two-cycle campaign also
completed its human hold/resume and MPNN/pose continuation checks. Each cycle
had zero Quality targets, so no paid Quality phase is claimed. Account/project
admission used a fixture; fresh logical sessions shared one physical GPU host.
The continuation recipe preserves native state and original operation IDs at explicit saved cursors. Native account sign-in and API-key facilities are
preserved; desktop sign-in alone does not authenticate Harness.

## Native files and controls

The native task directory contains `workflow.json`, `snapshot.json`,
`control.json` and `worker.json`. `control.json` has a revision, stop request and
pending adjustments. The prepared compute batch has `meta.json` and
`input/batch_input.json`; its labels `input_0000`, etc. reflect original request
order. Supply the **actual original FoldRequest** as `fold-request.json`, including
task ID, candidate IDs, per-chain sequences, options and placement. Export it
from its actual call/trace before execution. A ranked population is insufficient
to recover that order. Do not manufacture a native result from the example.

The adapter retains all six files as original text. It compares each native
target/binder chain and numeric seed against the prepared inputs before staging.
It respects the actual recorded checkpoint: `opendde.pt` is general,
`opendde_abag.pt` is ABAG; minibinder requires general. It preserves native
recycling cycles and diffusion steps/samples. The saved one-shot command must
contain the pinned builder's device, seeds, MSA, template, atom-confidence and
sampling arguments. Missing, repeated, unknown or conflicting arguments fail
before staging. Local commands must expose only CUDA GPU 0; Docker commands must
request only that device. CPU, unresolved `auto`, CP and request overrides for
omitted inference fields are outside this scope.

The pinned builder omits dtype, RNA-MSA, CP and OpenDDE's deterministic argument.
Their OpenDDE defaults are fp32, false, single/one and false. Harness's separate
`deterministic` choice controls `PYTHONHASHSEED=0` and
`CUBLAS_WORKSPACE_CONFIG=:4096:8`; the bridge compares those saved environment
settings with the request and preserves them for the OpenDDE child. It does not turn
that choice into OpenDDE's deterministic flag. Native numerical agreement still
requires remote qualification.
Its first scope requires one GPU at index 0, explicit `use_msa: false`, atom
confidence, no search/templates/API mode and no context parallelism. Other modes
need readiness and qualification before admission.

The saved-batch kernel path remains outside numerical qualification. The pinned Harness
builder omits both triangle kernel arguments, leaving OpenDDE's `auto` defaults.
OpenDDE explicitly selects `trimul_kernel=torch` and `triatt_kernel=torch`; this
saved-batch adapter uses those OpenDDE choices. Native comparison
recorded that difference and failed the unchanged 1e-4 numerical tolerance. The
separate controller has passed the unchanged 1e-4 comparison in its explicitly
deterministic native auto/auto mode, with zero differences for the two small
fixtures. Its workflow deterministic flag now also enables OpenDDE deterministic
algorithms. This saved-batch adapter keeps its explicit OpenDDE contract.

| Native state/action | Forge behavior |
| --- | --- |
| Read saved snapshot/control | Read files or `status`; no new scientific command. |
| Prepared native fold batch | `prepare` saves input/command IDs without remote mutation; `submit` stages ordinary files and invokes one `forge run`. |
| Native stop or adjustment before submission | Refuse a new initial batch; inspect and decide explicitly. `stop` requests cancellation of the current Forge command. |
| Uncertain submission | Read the same command ID; resubmit only that identical durable request if absent. |
| Process loss or partial batch | Preserve attempts/files and name unfinished items with explicit `continue --resume`. Successful OpenDDE items are skipped. |
| Human hold | Preserve the Forge project; its trusted web approval clears the hold. Approval allocates nothing. |
| Session creation, device reservation, billing, close | Existing Forge commands/backend own them. This adapter creates no session or allocation. |

The native CLI has no full optimizer resume command. Its `start` constructs new
run/population/RNG state. Native compute saves `population.json`,
`search_history.json` and optional `final_selection.json`, but those files do not
restore the entire search loop. This bridge never runs `start`, clears a native
stop, changes adjustments, rebuilds optimizer state or declares the campaign
completed. The native controller supplies explicit native substage continuation in its separate controller.
Continuation supports the documented native cursors and complete retained outcomes.
An interrupted paid/tool loop without a complete outcome stays blocked.

## Remote application recipe

Select an authorized session with a ready `opendde` tool for this saved-batch
recipe. Read its current model/resource requirements from catalog discovery.
The native controller has its own [qualified settings](examples/opendde-harness/controller.md).
Obtain Ariax authentication through its existing credential facilities on the
trusted controller and keep credentials outside saved workspace files.

Set these paths on that remote controller. `HARNESS_BRIDGE` is the packaged example
above; `HARNESS_RUNNER` is `native_batch.py` in the prepared controller adapter
directory. `HARNESS_TASK` and `HARNESS_RUN` are native saved directories.
`HARNESS_REQUEST` is their original captured FoldRequest. The owned example directory
contains six small, authored source inputs for the initial application exercise.
They are not a real completed Harness campaign.

```bash
mkdir -p /srv/harness/controller

ariax forge create --name 'Saved native batch' --gpu L40 --gpu-count 1 \
  --tools opendde --max-gpu-hours APPROVED_LIMIT --json
# Set HARNESS_SESSION and HARNESS_PROJECT to the returned durable IDs.
ariax forge tools wait "$HARNESS_SESSION" opendde --timeout 1800 --json

node "$HARNESS_BRIDGE" prepare --task-dir "$HARNESS_TASK" --run-dir "$HARNESS_RUN" \
  --request "$HARNESS_REQUEST" --runner "$HARNESS_RUNNER" \
  --session "$HARNESS_SESSION" --project "$HARNESS_PROJECT" \
  --output /workspace/harness/native-batch-complete \
  --state /srv/harness/controller/complete.json --root-dir /srv/harness/controller

node "$HARNESS_BRIDGE" submit --state /srv/harness/controller/complete.json
# If input_pending is returned, submit again after inspecting the input ID.
# Repeated submit observes the same command ID; it never creates a new attempt.
node "$HARNESS_BRIDGE" status --state /srv/harness/controller/complete.json
ariax forge watch "$HARNESS_SESSION" "$HARNESS_COMMAND" --timeout 7200 --json
ariax forge run "$HARNESS_SESSION" --tool opendde --gpus 0 -- \
  python /opt/forge-opendde/opendde_outputs.py \
  /workspace/harness/native-batch-complete/prediction
ariax forge sync "$HARNESS_SESSION" --wait --timeout 900 --json
ariax forge files "$HARNESS_SESSION" --path /workspace/harness/native-batch-complete \
  --checkpoint "$HARNESS_CHECKPOINT" --json
ariax forge link "$HARNESS_SESSION" \
  "/workspace/harness/native-batch-complete/reports/$HARNESS_COMMAND.json" \
  --checkpoint "$HARNESS_CHECKPOINT" --json
```

Set `HARNESS_COMMAND` from `prepare`/`submit` and `HARNESS_CHECKPOINT` from successful
sync. Inspect report `batch_complete`, all item states, attempt exit codes and
actual native files. A zero process exit with pending items is partial success.
The helper reports `native_campaign_complete: false` even when every fold
succeeds. Stop a running fold with
`node "$HARNESS_BRIDGE" stop --state /srv/harness/controller/complete.json`;
wait for its existing command to become terminal before another attempt.

Use a **distinct output and state** for the partial exercise:

```bash
node "$HARNESS_BRIDGE" prepare --task-dir "$HARNESS_TASK" --run-dir "$HARNESS_RUN" \
  --request "$HARNESS_REQUEST" --runner "$HARNESS_RUNNER" \
  --session "$HARNESS_SESSION" --project "$HARNESS_PROJECT" \
  --output /workspace/harness/native-batch-partial --max-items 1 \
  --state /srv/harness/controller/partial.json --root-dir /srv/harness/controller
node "$HARNESS_BRIDGE" submit --state /srv/harness/controller/partial.json
# Inspect the returned command ID and actual first-item-success/second-item-pending state.
ariax forge sync "$HARNESS_SESSION" --wait --timeout 900 --json
ariax forge close "$HARNESS_SESSION" --json
ariax forge status "$HARNESS_SESSION" --json
ariax forge project "$HARNESS_PROJECT" --json

ariax forge resume "$HARNESS_PROJECT" --session-id NEW_DURABLE_SESSION_UUID \
  --gpu L40 --tools opendde --restore-session "$HARNESS_SESSION" \
  --checkpoint "$HARNESS_PARTIAL_CHECKPOINT" --control-revision OBSERVED_REVISION \
  --max-gpu-hours APPROVED_LIMIT --json
# Set HARNESS_RESUMED to the returned session ID, after restore/preparation finishes.
ariax forge tools wait "$HARNESS_RESUMED" opendde --timeout 1800 --json
ariax forge download "$HARNESS_SESSION" \
  /workspace/harness/native-batch-partial/prediction/batch.json \
  --checkpoint "$HARNESS_PARTIAL_CHECKPOINT" \
  --dest /srv/harness/controller/partial-batch-state.json --json
node "$HARNESS_BRIDGE" continue --state /srv/harness/controller/partial.json \
  --session "$HARNESS_RESUMED" --batch-state /srv/harness/controller/partial-batch-state.json \
  --items input_0001 --resume
# Finish any input_pending import with submit, retaining the new command ID.
node "$HARNESS_BRIDGE" submit --state /srv/harness/controller/partial.json
```

All downloads above stay on the remote controller. Use fresh destination paths.
Keep the original CLI root/account/API origin and journal files, including its
bundle/runner source. Continuation verifies that the prior Forge command is
terminal and that saved OpenDDE jobs/source/settings match directly. Its new session
must belong to the same project. The original bundle's native control remains
unchanged; `--resume` explicitly selects recovery of those fold items, not the
stopped native optimizer. The backend rechecks a newer human pause at admission.
Inspect the previous and newly saved successful files byte for byte on the GPU
VM and require no prior successful attempt to rerun. Sync, inspect links and close
the final session through the existing [file/control workflow](../outputs.md).

For loss before the report was written, preserve `prediction/batch.json` and its
files. After reading the original command ID, explicitly run the helper's
`report` operation with a fresh report UUID to summarize the retained state.
It launches no prediction. Missing unsaved outputs remain unavailable; do not
reconstruct them from a successful process status.

## Outputs and scientific meaning

`native-source/` retains original texts. `prediction/batch.json` and item attempt
directories retain exact native jobs, seeds, failures and logs. Every successful
job/seed/sample must list the complete nonempty CIF, summary-confidence, full-data
confidence and identity sidecar set from its latest OpenDDE attempt. Reports reject
absolute, traversing or symlinked output paths, other items' files, missing output
lists and unavailable successful files. Failed, pending and interrupted rows
retain their states and explicit `retained_files` availability; absent partial
files never become successful predictions. The sidecar distinguishes diffusion
index from filename confidence rank, and maps original asym IDs and token/atom
axes. Native atom pLDDT is 0–1; CIF
B-factors are 0–100; PAE/PDE are angstrom. Preserve all these files together.

Reports retain original candidate IDs/metadata, parent relationships and native
input names. Bridge metrics are unavailable: it has not run native Harness loss,
quality gates or population admission. The native parser's zero fallback for
optional failed metrics is not scientific evidence. To score a completed
protein sample, explicitly use OpenDDE's original-run-ID handoff and the corrected
[interface-scoring consumer](interface-scores.md). Keep exclusions, rejected candidates and
unavailable metrics. Native score values do not establish experimental binding.

## Scientific dependencies and qualification limits

The saved-batch helper uses OpenDDE 1.1.1 source
`ddfa1df8aff1babf1fddac4247b7d2351bd0ce9f`, Torch 2.7.1/CUDA 12.6 and explicit
PyTorch triangle kernels. Its named OpenDDE models retain revision
`eddd563ce96571f784012edd8f045181c8f8627d`. Node >=20 and the installed CLI own
transfers, durable requests and journal writes. The saved-batch comparison failed
its unchanged numerical tolerance and is outside the controller's deterministic
native auto/auto qualification.

The native controller uses GPT-6.1, the ABAG checkpoint, offline ESM2-650M revision
`08e4846e537177426273712802403f7ba8261b6c` and native soluble ProteinMPNN from
LigandMPNN `26ec57ac976ade5379920dbd43c7f97a91cf82de`. Follow its explicit
[deterministic workflow](examples/opendde-harness/controller.md). Catalog mode
names describe the qualified scope; the current worker can still accept false
for the deterministic flag. Broader model/settings changes need qualification.

Both scoped native campaigns completed. No paid Quality phase ran because all
cycles had zero eligible Quality targets. Account/project admission used a
fixture, and continuation restored fresh logical sessions on the same physical
host. These outcomes do not establish separate-host recovery or experimental
binding. Keep native credentials on the trusted controller, outside workloads
and saved scientific state. Save completed Files checkpoints and close sessions
through the ordinary Forge workflow within the approved limits.

Sources: [native control files](https://github.com/aurekaresearch/OpenDDE-Harness/blob/8bb8684b2d3185381f4812c286e044d5679bfd6f/opendde_harness/plugin/protein_design/core/detached.py),
[native loop](https://github.com/aurekaresearch/OpenDDE-Harness/blob/8bb8684b2d3185381f4812c286e044d5679bfd6f/opendde_harness/plugin/protein_design/core/orchestrator.py),
[compute/scoring](https://github.com/aurekaresearch/OpenDDE-Harness/blob/8bb8684b2d3185381f4812c286e044d5679bfd6f/opendde_harness/plugin/protein_design/servers/harness.py),
[native fold files](https://github.com/aurekaresearch/OpenDDE-Harness/blob/8bb8684b2d3185381f4812c286e044d5679bfd6f/opendde_harness/plugin/protein_design/servers/backends/fold.py).
