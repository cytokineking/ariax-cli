# Native Harness controller and explicit continuation

The qualified scope is deterministic native auto/auto CUDA 12.8 execution for
one- and two-cycle CRLF2/VHH ABAG workflows with GPT-6.1. Both campaigns completed
Analyze, Design, Reflection, terminal MPNN/refold/pose processing and PostFilter.
The unchanged 1e-4 native comparison had zero coordinate/confidence differences
on two small fixtures. Historical default/nondeterministic and saved-batch
comparisons failed and remain outside this numerical qualification.

Each cycle had zero candidates requiring Quality review; no paid Quality phase
was exercised. Qualification used fixture account/project admission and restored
fresh logical sessions on the same physical GPU host. Separate-host recovery
and arbitrary workloads are outside this evidence. Scientific scores and a
completed campaign do not establish experimental binding.

Completed-fold, lost-publication-acknowledgement, population-commit, MPNN-parent
and first-pose continuations retained original operation IDs and reused completed
outcomes. A human hold, approval and explicit resume were exercised. An interrupted
model/tool phase without a complete retained outcome remains blocked.

## Controller prerequisites and supported defaults

Use a prepared trusted remote controller with the installed Ariax CLI and pinned
Harness 0.0.4 source `8bb8684b2d3185381f4812c286e044d5679bfd6f`, its continuation
adapter, Python 3.12, Node >=22.19 and native pi-ai/pi-tui 0.85.1. The prepared
native service must expose `openai-codex/gpt-6.1-sol`; confirm that explicit route
before starting. Native account sign-in uses
`ddeharness provider login openai-codex`. Configuration lives in
`~/.opendde_harness/config.json`, outside workload/source/output mounts. Keep
credentials outside saved scientific state. Set the native default model to the
same route as the workflow, low reasoning, tracing disabled and model retries
zero. The controller disables memory/speculation and limits each call to 2048
output tokens. A desktop login alone does not authenticate this controller.

Select a ready `opendde-harness` session with one GPU, at least 47 GiB VRAM,
56 GiB RAM, eight CPUs and 256 GiB disk, with adequate free space for the saved
work. The qualified GPU had 49140 MiB VRAM; these floors are required resources,
not measured peaks or a capacity claim for larger campaigns. Keep the controller
outside `/inputs`, `/workspace` and `/models`. Use the original CLI account/API
origin and the approved session and model-use limits through continuation.

Use the supplied one- or two-cycle example as the documented default workflow.
Both set `fold.deterministic: true`, ABAG checkpoint, fixed seeds and the scoped
sampling settings. The controller requires an explicit normalized workflow;
normalization preserves its deterministic flag and native execution adds
`--deterministic true`. Retain that workflow unchanged when continuing.
The current worker also accepts an explicitly false flag; catalog mode labels
do not enforce this scientific policy. Such a workflow is outside the qualified
scope. The normalizer's descriptive `forge_scoped_policy.opendde_deterministic`
metadata is stale; use the actual `fold_options.deterministic` and retained
execution arguments to inspect the mode. The explicit deterministic example is the accepted invocation. Other callable
settings remain outside its qualification.

Default loss uses offline ESM2-650M revision
`08e4846e537177426273712802403f7ba8261b6c`; terminal redesign uses native
`solublempnn_v_48_020.pt` from LigandMPNN
`26ec57ac976ade5379920dbd43c7f97a91cf82de`. Tool readiness must include these
scientific dependencies and the ABAG checkpoint. Consult current catalog discovery
for admission. The saved-batch `bridge.mjs` has a separate, narrower contract.

Set `HARNESS_SOURCE` to the prepared native controller source, `HARNESS_ADAPTER`
to its prepared continuation adapter directory, and `CLI_SOURCE` to the installed
CLI source. Native outputs live under `/workspace/harness/TASK/`, with the canonical
optimizer at `native/optimizer.json`. Set `tracing.enabled` to `false` in native
configuration and unset `OPENDDE_HARNESS_TRACING` before starting.

Normalize the authored fixture with the native loader on that remote controller.
The helper explicitly records device=cuda in the normalized workflow; the native
YAML loader does not accept a `fold.device` key. Preserve its generated JSON.

```sh
export PYTHONPATH="$HARNESS_SOURCE"
HARNESS_PYTHON="$HARNESS_SOURCE/.venv/bin/python"
HARNESS_EXAMPLES="$CLI_SOURCE/agent-skills/skills/ariax-forge/tools/examples/opendde-harness"
"$HARNESS_PYTHON" "$HARNESS_ADAPTER/prepare_controller.py" \
  --yaml "$HARNESS_EXAMPLES/controller-cycle.yaml" \
  --output /srv/harness/full/workflow.json
"$HARNESS_PYTHON" "$HARNESS_ADAPTER/prepare_controller.py" \
  --yaml "$HARNESS_EXAMPLES/controller-continuation.yaml" \
  --output /srv/harness/partial/workflow.json
```

Both fixtures preserve the pinned upstream CRLF2/VHH chain sequences, chain IDs
A/D, CDR positions and original seed 973520. They explicitly reduce ten cycles
to one/two, eight proposals to one, reflections every five cycles to every cycle,
and inference to one recycle/20 diffusion steps/one sample. Point mutation is
the only proposal route. Default loss and gate formulas are unchanged. Terminal
MPNN/refolding/PostFilter is explicitly enabled with top_k=1 (upstream quickstart
leaves it disabled). Native scientific failures and zero accepted candidates are
valid recorded outcomes, never binding evidence. Broader modes stay unqualified.

## Complete one native design cycle

Create or select an authorized project/session with ready `opendde-harness`,
observe `ariax forge project PROJECT --json`, and use its current revision.
Here `FULL_SESSION`, `FULL_PROJECT`, `OBSERVED_REVISION` and `CLI_ROOT` must be
actual durable IDs/settings from the ordinary Forge workflow.

```sh
"$HARNESS_PYTHON" "$HARNESS_ADAPTER/controller.py" start \
  --workflow /srv/harness/full/workflow.json --state-dir /srv/harness/full/state \
  --cli-root "$CLI_ROOT" --session "$FULL_SESSION" --project "$FULL_PROJECT" \
  --task-id harness-full --control-revision "$OBSERVED_REVISION" \
  --max-model-calls 16 --max-input-bytes 524288 --max-output-tokens 32768
```

Require the real native snapshot to be completed and remote optimizer state to
be `ready` with phase `completed`. Read native population/search_history/
final_selection and all rejected/failed candidates. A successful process alone
is insufficient. Retain each original FoldRequest, actual native one-shot argv,
actual executed argv, candidate order and every retained item/attempt report.
Run the existing strict output checker on its actual prediction directories.

## Interrupt the real optimizer and explicitly continue it

Start the two-cycle campaign on an authorized session of its own project, with
`--hold-after-cycle 1`. This holds after its first complete native cycle and
before the second parent draw. It is a real saved optimizer boundary, including
initial analysis/bootstrap, selected population/diversity reference, sampler and
Python RNG, working parent, exact history, failures, current native config and
pending adjustments.

```sh
"$HARNESS_PYTHON" "$HARNESS_ADAPTER/controller.py" start \
  --workflow /srv/harness/partial/workflow.json --state-dir /srv/harness/partial/state \
  --cli-root "$CLI_ROOT" --session "$PARTIAL_SESSION" --project "$PARTIAL_PROJECT" \
  --task-id harness-partial --control-revision "$OBSERVED_REVISION" \
  --max-model-calls 16 --max-input-bytes 524288 --max-output-tokens 32768 \
  --hold-after-cycle 1
ariax --root-dir "$CLI_ROOT" forge sync "$PARTIAL_SESSION" --wait --timeout 900 --json
# Save the exact returned checkpoint ID as PARTIAL_CHECKPOINT.
ariax --root-dir "$CLI_ROOT" forge close "$PARTIAL_SESSION" --json
ariax --root-dir "$CLI_ROOT" forge status "$PARTIAL_SESSION" --json
ariax --root-dir "$CLI_ROOT" forge project "$PARTIAL_PROJECT" --json
```

Confirm the previous session is closed before same-project resume.
If a human hold is present, the user approves **Allow agent to resume** on that
same project. Approval alone creates no compute. Read control again and explicitly
choose a fresh durable session ID, observed revision, checkpoint and approved limit:

```sh
ariax --root-dir "$CLI_ROOT" forge resume "$PARTIAL_PROJECT" \
  --session-id "$RESUMED_SESSION" --gpu "$SELECTED_GPU" --tools opendde-harness \
  --restore-session "$PARTIAL_SESSION" --checkpoint "$PARTIAL_CHECKPOINT" \
  --control-revision "$RESUME_REVISION" --max-gpu-hours "$APPROVED_HOURS" --json
ariax --root-dir "$CLI_ROOT" forge tools wait "$RESUMED_SESSION" opendde-harness --timeout 1800 --json
ariax --root-dir "$CLI_ROOT" forge download "$PARTIAL_SESSION" \
  /workspace/harness/harness-partial/native/optimizer.json \
  --checkpoint "$PARTIAL_CHECKPOINT" --dest /srv/harness/partial/restored-optimizer.json --json
"$HARNESS_PYTHON" "$HARNESS_ADAPTER/controller.py" continue --resume \
  --restored-boundary /srv/harness/partial/restored-optimizer.json \
  --restore-session "$PARTIAL_SESSION" --restore-checkpoint "$PARTIAL_CHECKPOINT" \
  --workflow /srv/harness/partial/workflow.json --state-dir /srv/harness/partial/state \
  --cli-root "$CLI_ROOT" --session "$RESUMED_SESSION" --project "$PARTIAL_PROJECT" \
  --task-id harness-partial --control-revision "$RESUME_REVISION" \
  --max-model-calls 16 --max-input-bytes 524288 --max-output-tokens 32768
```

Keep the original trusted controller journals through resume; they contain the
model-use reservations and operation IDs. Scientific boundary restoration alone
does not erase those records. To recover the trusted controller itself, restore
only its reviewed source, scientific state and concise private ID/use records
from remote private storage, never its complete credential environment.

Compare all previously completed prediction files directly, byte for byte, on
the GPU VM. Require unchanged original attempts and no repeated analysis/bootstrap/
cycle-0 model calls or fold commands. Compare restored optimizer/population/history
before the next stage, and the next parent draw against the retained RNG state on
the remote VM. Final native history must contain both cycles and real terminal
selection, including failed post-refold or rejected candidates. Save the final
Files checkpoint and result links, then close and confirm resource release.

## Substage and lost-response qualification

Apply successive holds to the same two-cycle task and trusted directory through
explicit continuation. Keep its settings/use reservations. Use a distinct task
only for a probe expected to remain blocked, within the remaining aggregate
allowance. All campaigns and fault probes together share their explicitly approved model
and session limits; per-directory maxima add no allowance. Continue with the authenticated source checkpoint flags above and
omit the previous hold flag.

| Start flag | Required recovery |
| --- | --- |
| `--hold-after-operation cycle:3:fold` | Native fold caller remains unfinished; consume its existing command/result and finish the native cycle without another fold or model call. |
| `--hold-at cycle:8` | Restore already committed native population/history/RNG/streak before remote publication. |
| `--hold-at terminal/1/mpnn:1` | Continue remaining MPNN parents after the first saved parent, preserving all 40-sample filtering and four-survivor policy. |
| `--hold-at terminal/3/pose:1` | Continue remaining pose evidence after the first candidate; retain prior metadata and command IDs. |
| `--hold-after-publication cycle:4` | Retain local publishing intent after canonical commit; exact-target pinned restoration finishes its acknowledgement. |

The terminal flags require real eligible inputs. Keep failed/shortfall rows if
native filters reject them; do not alter settings to manufacture a pass. Check
native candidates, selection, history and all prior output bytes/attempts on the
GPU VM. For operation recovery, inspect the original session/command and result
checkpoint, then confirm no replacement command UUID was submitted for that call.
Controller state retains the complete native result or exact pending request.
No complete worker envelope means blocked/unavailable, even if partial fold files
exist. The controller never resumes partial scientific work automatically.

Separately interrupt an actual agent/model/tool loop before its complete native
phase result is saved. Explicit continuation must report blocked, retain paid-call
reservations/inner Forge IDs and send no replacement calls. Complete phase results
already retained locally or in the native document are consumed. A model timeout or native pi error/aborted response bypasses native fallback/retry.
Reservations and any reported model/usage remain saved, and an unexpected
returned model identity blocks continuation. No partial
conversation/session continuation is implemented. The qualified complete-outcome and substage cases cover the listed workflows
and same-host logical-session restoration.

## Holds, failures and limits

SIGTERM/SIGINT request a hold before new work; `forge cancel` uses the actual
retained compute ID. Ready/active native cursors can continue explicitly when
authoritative outcomes exist. Publishing accepts only its exact committed target.
An unresolved command or agent/tool loop remains blocked; inspect retained IDs
without calling native `start`, manufacturing ready markers or rewinding files.

The controller checks project identity, revision/hold and tool readiness before
stages and compute/model calls. The backend performs its normal admission guard
again. A newer native stop must be explicitly cleared at an increasing native
control revision before continuation; `--resume` cannot clear it. Source
preparation, inspection, restoration, native status and web approval do not run
scientific work.

Each campaign has at most 16 model requests, 524288 serialized input bytes and
32768 reserved output tokens, 2048/request, including failed/uncertain reservations
and all resumed turns. Bytes are not billed tokens. Native output-limit widening
that exceeds this bound is refused. Keep reported usage/model identity. No paid hosted tools, embeddings, memory or research service is included.
