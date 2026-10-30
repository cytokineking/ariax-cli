# Native Harness controller and explicit continuation

Use this controller for deterministic native auto/auto CUDA 12.8 execution of
the one- or two-cycle CRLF2/VHH ABAG workflow with GPT-6.1 Sol. It runs native
Analyze, Design, Reflection and terminal MPNN/refold/pose/PostFilter stages,
and saves optimizer state for explicit continuation. Broader workloads,
nondeterministic execution, paid Quality phases and separate-host recovery
are outside the established scope. Scores and a completed workflow do not
establish experimental binding.

## Prepare the controller and workflow

Use a trusted remote controller with the installed Ariax CLI, pinned Harness
0.0.4 source `8bb8684b2d3185381f4812c286e044d5679bfd6f`, its prepared
continuation adapter, Python 3.12, Node >=22.19 and native pi-ai/pi-tui 0.85.1.
The native service must expose `openai-codex/gpt-6.1-sol`. Authenticate with
`ddeharness provider login openai-codex`; desktop login alone is insufficient.
Configuration lives in `~/.opendde_harness/config.json`, outside workload,
source and output mounts. Keep credentials outside saved scientific state.

Set the native default model to that same route, low reasoning, model retries
zero and `tracing.enabled: false`; unset `OPENDDE_HARNESS_TRACING`. The
controller disables memory/speculation and limits each call to 2048 output
tokens. Native timeouts, pi errors or aborted responses do not trigger fallback
model calls or retries.

Discover the exact selection before allocating:

```sh
ariax forge catalog --task binder-design --compact --json
ariax forge catalog --tool opendde-harness --model MODEL --json
ariax skills forge --tool opendde-harness --json
```

Copy `MODEL` from `models[].id`; omit the model filter if the tool has no
models. Select a listed mode with `--mode MODE` as needed. Use a ready
`opendde-harness` session with one GPU, at least 47 GiB VRAM, eight CPUs and
256 GiB disk, with enough free space for saved work. No fixed RAM floor is
specified; this is not a capacity claim for larger workflows. Keep the trusted
controller outside `/inputs`, `/workspace` and `/models`. Follow the shared
[Forge lifecycle](../../../SKILL.md) within approved session/model-use limits.

Both supplied workflows set `fold.deterministic: true`, the ABAG checkpoint,
fixed seeds, one recycle, 20 diffusion steps and one sample, without MSA
search or templates. Normalization preserves that flag and execution adds
`--deterministic true`. Inspect actual `fold_options.deterministic` and
executed arguments. The worker also accepts false; catalog labels do not
enforce this restriction. False is outside this supported workflow. Preserve
the normalized workflow unchanged through continuation.

Default loss requires offline ESM2-650M revision
`08e4846e537177426273712802403f7ba8261b6c`; terminal redesign requires native
`solublempnn_v_48_020.pt` from LigandMPNN
`26ec57ac976ade5379920dbd43c7f97a91cf82de`. Readiness must include these
dependencies and ABAG. The [saved-batch bridge](../../opendde-harness.md)
uses a separate kernel/determinism contract and does not restore the optimizer.

Set `HARNESS_SOURCE` to the prepared native source, `HARNESS_ADAPTER` to its
prepared continuation adapter directory and `HARNESS_EXAMPLES` to
`data.examples["opendde-harness"]` from the scoped skill lookup. Normalize the
chosen YAML on that remote controller. The helper records device=cuda;
the native YAML loader does not accept `fold.device`.

```sh
export PYTHONPATH="$HARNESS_SOURCE"
HARNESS_PYTHON="$HARNESS_SOURCE/.venv/bin/python"
"$HARNESS_PYTHON" "$HARNESS_ADAPTER/prepare_controller.py" \
  --yaml "$HARNESS_EXAMPLES/controller-cycle.yaml" \
  --output /srv/harness/full/workflow.json
"$HARNESS_PYTHON" "$HARNESS_ADAPTER/prepare_controller.py" \
  --yaml "$HARNESS_EXAMPLES/controller-continuation.yaml" \
  --output /srv/harness/partial/workflow.json
```

These source examples retain the pinned upstream CRLF2/VHH sequences, chain
IDs A/D, CDR positions and fold seed 973520. They request one/two cycles, one
proposal and reflection every cycle. Point mutation is the only proposal route;
native loss and gate formulas are unchanged. Terminal MPNN/refolding/PostFilter
is enabled with `top_k=1`. Failed or rejected candidates and zero accepted
candidates remain valid outcomes.

## Start and inspect a native workflow

Select an authorized project/session with ready `opendde-harness` and read
`ariax forge project PROJECT --json` for its current control revision. Set
`FULL_SESSION`, `FULL_PROJECT`, `OBSERVED_REVISION` and `CLI_ROOT` to the actual
durable IDs/settings.

```sh
"$HARNESS_PYTHON" "$HARNESS_ADAPTER/controller.py" start \
  --workflow /srv/harness/full/workflow.json --state-dir /srv/harness/full/state \
  --cli-root "$CLI_ROOT" --session "$FULL_SESSION" --project "$FULL_PROJECT" \
  --task-id harness-full --control-revision "$OBSERVED_REVISION" \
  --max-model-calls 16 --max-input-bytes 524288 --max-output-tokens 32768
```

Native outputs live under `/workspace/harness/TASK/`; the canonical optimizer
is `native/optimizer.json`. Inspect the native snapshot, optimizer state,
`population.json`, `search_history.json`, `final_selection.json` and all failed
or rejected candidates. Completion requires a completed snapshot and optimizer
state `ready` with phase `completed`; process exit alone is insufficient.
Retain original FoldRequests, one-shot and executed argv, candidate order and
item/attempt reports alongside native prediction files. Use the prepared strict
output checker on actual prediction directories.

The shown limits allow at most 16 model requests, 524288 serialized input bytes
and 32768 reserved output tokens, 2048 per request. They include failed or
uncertain reservations and every resumed turn; separate state directories add
no allowance. Input bytes are not billed tokens. Output-limit widening beyond
this bound is refused. Retain reported usage and model identity. Paid hosted
tools, embeddings, memory and research services are not included.

## Hold and explicitly continue the optimizer

For a two-cycle workflow, `--hold-after-cycle 1` saves state after the first
complete cycle and before the next parent draw. The boundary contains analysis/
bootstrap state, population/diversity reference, sampler/Python RNG, working
parent, history, failures, current configuration and pending adjustments.
Set `PARTIAL_SESSION` and `PARTIAL_PROJECT` to that workflow's authorized
session/project and read its current `OBSERVED_REVISION` before starting.

```sh
"$HARNESS_PYTHON" "$HARNESS_ADAPTER/controller.py" start \
  --workflow /srv/harness/partial/workflow.json --state-dir /srv/harness/partial/state \
  --cli-root "$CLI_ROOT" --session "$PARTIAL_SESSION" --project "$PARTIAL_PROJECT" \
  --task-id harness-partial --control-revision "$OBSERVED_REVISION" \
  --max-model-calls 16 --max-input-bytes 524288 --max-output-tokens 32768 \
  --hold-after-cycle 1
ariax --root-dir "$CLI_ROOT" forge sync "$PARTIAL_SESSION" --wait --timeout 900 --json
ariax --root-dir "$CLI_ROOT" forge close "$PARTIAL_SESSION" --json
ariax --root-dir "$CLI_ROOT" forge status "$PARTIAL_SESSION" --json
```

Require the flush state `saved` and confirm resource release. Follow
[same-project resume](../../../SKILL.md#project-controls-and-resume): resolve
any human hold, read the current control revision and choose an authorized new
session and allocation limit. Set `RESUME_REVISION` from `control.revision`.
Approval itself starts no compute.

```sh
ariax --root-dir "$CLI_ROOT" forge project "$PARTIAL_PROJECT" --json
ariax --root-dir "$CLI_ROOT" forge resume "$PARTIAL_PROJECT" \
  --session-id "$RESUMED_SESSION" --gpu "$SELECTED_GPU" --tools opendde-harness \
  --control-revision "$RESUME_REVISION" --max-gpu-hours "$APPROVED_HOURS" --json
ariax --root-dir "$CLI_ROOT" forge tools wait "$RESUMED_SESSION" opendde-harness --timeout 1800 --json
"$HARNESS_PYTHON" "$HARNESS_ADAPTER/controller.py" continue --resume \
  --workflow /srv/harness/partial/workflow.json --state-dir /srv/harness/partial/state \
  --cli-root "$CLI_ROOT" --session "$RESUMED_SESSION" --project "$PARTIAL_PROJECT" \
  --task-id harness-partial --control-revision "$RESUME_REVISION" \
  --max-model-calls 16 --max-input-bytes 524288 --max-output-tokens 32768
```

The controller reads the current project's `native/optimizer.json` through the
authorized file service and requires an exact match with its retained optimizer
or publication intent. An optional `--restored-boundary FILE` supplies an
additional JSON document to compare with that current file. A missing, older or
different optimizer blocks continuation. Keep the original trusted controller
journals, CLI account/API origin and model-use reservations. Retained operation
results must match their original requests and current project files; do not
rerun scientific work to reconstruct missing state. Because a flush is not an
atomic multi-file snapshot, stop writers and verify the actual files needed.

Use matching versions of the CLI, Forge services and Harness adapter. The new
project-file continuation requires remote integration and scientific validation
before release; earlier checkpoint-based qualification does not establish it.

Other explicit hold points are available for the corresponding native cursors:

| Start flag | Continuation behavior |
| --- | --- |
| `--hold-after-operation cycle:3:fold` | Consume the completed fold's original command/result and finish its cycle. |
| `--hold-at cycle:8` | Continue after population/history/RNG/streak commit, before remote publication. |
| `--hold-at terminal/1/mpnn:1` | Continue remaining MPNN parents after the first saved parent, preserving 40-sample filtering and the four-survivor policy. |
| `--hold-at terminal/3/pose:1` | Continue remaining pose processing after the first candidate, preserving metadata and command IDs. |
| `--hold-after-publication cycle:4` | Hold after the current optimizer and operation result are saved, before local acknowledgement. |

Use these only when eligible native inputs reach that cursor. Omit the previous
hold flag when continuing. Keep native filter failures and shortfalls; partial
fold files do not constitute a complete phase result. The controller retains
complete results or the exact pending request and never automatically resumes
partial scientific work.

## Failures and controls

SIGTERM/SIGINT request a hold before new work; `forge cancel` targets the retained
compute command ID. Ready/active cursors can continue explicitly when complete
authoritative outcomes exist. An unresolved command or interrupted model/tool
loop without a complete outcome stays blocked. Inspect the original IDs;
native `start`, rewritten markers or rewound files cannot recover that outcome.
No partial conversation/session continuation is implemented. Failed/uncertain
reservations remain counted, and an unexpected returned model identity blocks
continuation.

The controller checks project identity, control revision/hold and tool readiness
before stages and compute/model calls. The backend rechecks admission. A newer
native stop must be explicitly cleared at an increasing native control revision;
`--resume` does not clear it. Source preparation, inspection, restoration,
native status and web approval run no scientific work.
