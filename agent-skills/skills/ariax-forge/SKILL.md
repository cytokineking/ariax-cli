---
name: ariax-forge
description: Create and operate Ariax Forge compute sessions, select tools, run native commands, recover submissions, and cancel or close work through the Ariax CLI.
---

# Ariax Forge

Use Forge for native commands and custom workflows. You choose tools and
inputs, run commands, save outputs and close the session. If a managed project
fits the goal, compare it with [engine choice](../../core/engine-choice.md).
Managed and native settings can differ for the same engine.

## Discover, plan, run and close

1. Find the tool with [capability discovery](tools/capabilities.md), inspect
   its model/mode's current workload and resource limits, and read its guide.
2. Check `ariax pricing --json` and choose hardware and a GPU-hour limit within
   the user's authorization. Extra GPUs need a supported parallel workflow.
3. Stage inputs, wait for the tool, run commands and inspect their results.
   Use [campaign guidance](references/campaign-recipes.md) to compose stages
   or size a pilot; example sizes are not campaign recommendations.
4. Flush useful files under `/workspace`, close the session when done,
   and confirm both resource release and saved files.

Creating or resuming a session starts paid resource allocation. Preparation and
idle time consume the GPU-hour allowance; an omitted limit leaves the session
open-ended. A successful command does not close the session. A local wait or
interruption leaves remote work running. After an uncertain response, inspect
the same session or command ID and reconcile its saved request before retrying;
a fresh ID can duplicate work or allocate another session.

```sh
ariax forge catalog --task binder-design --compact --json
ariax forge catalog --tool TOOL --model MODEL --json
ariax skills forge --tool GUIDE_ID --json
ariax skills forge --reference GUIDE_ID --read --json
ariax pricing --json
ariax forge create --name "My workspace" --gpu GPU --gpu-count COUNT --tools TOOL --max-gpu-hours LIMIT --json
ariax forge list --json
ariax forge status SESSION --json
ariax forge tools SESSION --json
ariax forge tools wait SESSION TOOL --timeout 1800 --json
# Run and inspect the selected native commands; then save and close:
ariax forge sync SESSION --wait --json
ariax forge files PROJECT --json
ariax forge close SESSION --json
ariax forge status SESSION --json
```

Copy `TOOL`, `MODEL` and `GUIDE_ID` from the compact result's `tool`,
`models[].id` and `capabilities.guide` fields. Add `--mode MODE` for a listed
mode; omit `--model` for a tool without model IDs. Scoped skill discovery returns that guide's references and example
paths; `ariax skills forge --json` returns the complete index. The `ariax-forge`
alias uses the same guides. Upload required input files and companions before
executing examples, following their scientific provenance and license conditions.

JSON results are in `data`; progress goes to stderr. Run `ariax help forge`
for complete syntax or use the [tool index](tools/capabilities/matrix.md) to
compare methods.

## Select and prepare tools

Omit `--tools` for a base workspace; base is always included. Use tool keys
from `ariax forge catalog`. `--priority` names a subset of selected tools;
the rest prepare in selection order.

Session `available` means the host and base workspace accept commands. Each
scientific tool separately reports `queued`, `installing`, `ready`, or `failed`.
Wait for the requested tool to be ready. A tool failure does not revoke host
availability. Ready tools remain usable while preparation runs in the background.

`--min-ram-gib`, `--min-cpu-count` and `--min-disk-gib` request hardware minima.
Ariax tries `--gpu` first. Use `--allowed-gpus RTX5090,L40S` to permit
fallbacks; the list must include the preferred GPU and at least one core GPU
(H100, A100_80GB, L40, L40S, or RTX6000PRO). An omitted
list permits only `--gpu`, which must then be a core GPU. Fallbacks preserve
the requested device count and resource minima. Inspect returned `hardware`
for the selected resources.

If a tool-selection response is uncertain, use `ariax forge recover ID` with
the original root directory, account and API origin. After a confirmed
preparation failure, submit a new selection; omitting `--selection-id`
generates one. Use status and wait to observe preparation.

## Execute and observe

```sh
ariax forge run SESSION --tool TOOL --wait-ready --input-ids INPUT_ID --wait --wait-timeout 1800 -- NATIVE_EXECUTABLE NATIVE_ARGUMENTS
ariax forge commands SESSION --json
ariax forge command SESSION COMMAND_ID --json
ariax forge watch SESSION COMMAND_ID --timeout 600 --json
ariax forge logs SESSION COMMAND_ID --tail 1000 --no-json
ariax forge logs SESSION COMMAND_ID --cursor CURSOR --wait-seconds 25 --json
ariax forge logs SESSION COMMAND_ID --retained --json
ariax forge activity PROJECT --limit 50 --json
```

Active output reads return the current command, incremental text, `next_cursor`
and `gap`. Keep the returned cursor for the next read. A gap reports an interval
lost to rotation or reconnection; save fuller output in workspace files when
needed. `watch` shares the same bounded cursor protocol. Cancellation first
reports `stopping` while the host enforces the saved intent.

Use `--retained` with commands, command, logs or inputs list/status
reads to inspect saved history after closure or host loss. Retained records
may lag live commands; keep the original ID while an outcome is uncertain.

Put the native executable and arguments after `--`. Include an explicit shell
when needed. Native examples run inside the selected ready tool's container.
Check its help with, for example, `ariax forge run SESSION --tool boltz2
--gpus 0 -- boltz predict --help`.

`--cwd` defaults to `/workspace` and must stay under it.
`--timeout-seconds` limits remote execution (default 86400 seconds).
`--wait-ready` waits locally for the session, selected tool and available
command resources. List the input IDs the command needs with `--input-ids`
(comma-separated); omit that option when none are required. Local file inputs
must have confirmed installation in the active workspace. `--wait` follows the
command and returns an error for failed, interrupted or cancelled work. It
does not inspect the scientific meaning of a successful result: read native
output and check the files as well.

GPU commands reserve their selected devices; overlapping requests receive
`gpu_busy`. The installed CLI supports `--gpu-count` at creation and `--gpus`
on commands. CPU commands have a small concurrency limit and share writable
workspace paths. Use distinct
output paths when work overlaps. `unknown` keeps its GPU reservation until
reconciliation establishes an outcome. Read the command's state, exit code,
error, and logs. `watch` reports failed or interrupted work as an error;
`command` remains available to inspect its full record.

Use `--gpus 1,0` to reserve those devices in that supplied order. Multi-GPU
sessions require an explicit selection for GPU tools. A one-GPU session can
omit the flag for a GPU command. CPU commands omit it. Command timeouts and
cancellation retain devices until reconciliation confirms the container stopped.

`activity PROJECT` lists command and project-control history. Pass its
`next_cursor` to `--cursor` for older pages; `--limit` accepts 1–100. Session
command lists contain the newest 100 records. Retained logs are bounded and
may omit earlier output; save fuller logs in workspace files and flush them.

## Recover a lost response

Create prints `session_id` and run prints `command_id` before the POST. Each
request is saved under `.ariax/forge/ID.json` in the chosen `--root-dir`.
Retain the ID, root directory, account, and API origin. Transient failures are
retried a bounded number of times using that request and identity. Ordinary
session, command and control submissions have a 60-second local retry deadline.

After a lost acknowledgment, recover the printed identity:

```sh
ariax forge operations --json
ariax forge recover OPERATION_ID --json
ariax forge recover COMMAND_ID --wait --wait-timeout 1800 --json
```

`operations` lists this root's account-bound records and their last locally
observed states; it is not a live inventory.
Recovery supports session admission, tool selection, commands, inputs, sync,
cancellation, closure, and limit edits. It checks live and retained command
records before any retry. A pending, unstarted command can continue with its
same ID; an uncertain, failed, interrupted or cancelled command is not started
again. If a previously observed operation is absent from current history,
recovery stops and reports the uncertainty instead of submitting it again.
A limit-revision conflict requires inspection: it does not establish
whether an earlier edit took effect. URL imports keep the URL out of the saved
record. If there is no saved successful result, repeat the original input
request with its URL and ID so the server can compare the source. A local upload
can resume only with the unchanged source file;
a published input can be inspected without that file. Changing an ID can
allocate another VM or execute another command. A new science run after a
confirmed failure or interruption requires an explicit new action.

`run --wait-ready` and `run --wait` use `--wait-timeout SECONDS` for the whole
local operation (default 1800, maximum 86400); `recover` defaults to 60 seconds.
`tools wait`, `watch` and `sync --wait` accept `--wait-timeout SECONDS`, with
zero or omission meaning no local deadline. Their older `--timeout` spelling
also means seconds; elsewhere global `--timeout` is a per-request limit in
milliseconds. A local timeout or Ctrl-C does not cancel remote work. Use
`recover` with the same ID, or resume a wait/watch with the same operands.

## Project controls and resume

```sh
ariax forge project PROJECT --limit 50 --json
ariax forge status SESSION --json
ariax forge resume PROJECT --session-id NEW_SESSION_UUID --control-revision N --gpu L40 --gpu-count 2 --tools boltz2 --max-gpu-hours 8 --json
ariax forge limit SESSION --gpu-hours 12 --limit-revision N --json
ariax forge limit SESSION --clear --limit-revision N --json
```

`project` returns the project's status, control snapshot, session history and
current active/latest session IDs. Older history uses `--cursor`. `status`
reports the session's compute and persistence state with its `limit_revision`
and the project's current `control.revision` and hold.

A human pause sets `human_resume_required`. Stop the project's work and ask
the user to open the supplied project page and choose **Allow agent to resume**.
Approval requires authenticated web use and keeps compute stopped. Await the
user's direction, inspect the new control revision, then explicitly resume
that same project. API-key requests cannot approve the hold. Preserve the
held project's identity when its files or outputs are needed.

Resume loads the current saved files of the same project. Wait for confirmed
prior-session cleanup and inspect `project` if another session is active. A
newer pause invalidates an observed control revision.
A definitive hold or stale-revision rejection permits a new explicit request
with the newly observed revision and a fresh session ID. A lost acknowledgment
requires the original ID and fields. Local saved requests remain immutable.

Resume starts a new allocation in the same project and loads its current
saved files. Choose hardware, tools, priority and an optional new cap; the old
session's allowance is separate. Run the next scientific command explicitly.

Limits count preparation and idle time. Eight GPU-hours on four GPUs allow
two wall-clock hours. An edit replaces the total allowance from the original
`allocated_at`, not the remaining allowance. Use the current `limit_revision`;
stale revisions reject the edit. `--clear` removes the cap. Reducing it can
stop work immediately; closing sessions reject edits.

A saved limit can be pending on the host. Wait for `applied_limit_revision`
to equal `limit_revision` before relying on an extension or cleared cap;
the previous deadline applies until delivery. An edit cannot revive a stopped
session. Check cleanup, then use explicit same-project resume if authorized.

## Pause, terminal controls and close

Use `ariax pause PROJECT --json` for an agent-requested project pause.
An authenticated human page pause establishes a human hold. Inspect the
project control and session cleanup after either action; acknowledgment means
stop intent is durable while compute may still be stopping. For a requested
terminal stop, `ariax abort PROJECT --json` retains saved files and prevents
resume. The project's web **Delete** action also removes saved artifacts after
cleanup. Aborted/deleted work stays terminal; approval cannot reopen it.

```sh
ariax forge cancel SESSION COMMAND_ID --json
ariax forge close SESSION --json
ariax forge status SESSION --json
```

Cancellation targets one command. It returns cancellation requested; inspect
the command until its final state is known. Repeated cancellation is harmless.
Close stops the session and releases its allocation. Poll session status until
`closed`, which confirms resource release. A cleanup problem leaves `closing`
with an error. A failed HTTP request does not establish VM loss or cleanup.
Repeated close observes the same closure.

## Inputs and durable outputs

Before active file operations, wait for the workspace with `ariax forge tools wait SESSION base --timeout 1800`; `session_unready` means inspect that session's lifecycle and retain the original operation IDs.

Stage a local file, an authorized Ariax artifact, or an individual public HTTPS object with `ariax forge inputs add SESSION --file FILE --path targets/input.yaml`. Use `--artifact PROJECT_ID:PATH` or `--url URL` for the other sources. `--path` is relative to `/inputs` (for example `targets/input.yaml`); commands read the absolute `/inputs/targets/input.yaml`. Inspect readiness with `inputs status SESSION INPUT_ID` before a command reads them. Local files use the project workspace multipart API and keep their input and attempt IDs in the original CLI root for safe recovery. Storage publication alone does not confirm installation in the active workspace: without daemon-backed confirmation the input reports `pending` with `installation_status: unconfirmed`. Wait for `ready` before dispatching a dependent command. Local input entries in `inputs list` come from the current CLI root and are not an account-wide inventory.

Run `ariax forge sync SESSION --wait` to flush changed files, then use
`ariax forge files PROJECT`, `download PROJECT PATH`, or `link PROJECT PATH`
with the session's `project_id`. Sync reports saved, pending or failed work;
it is not an atomic multi-file snapshot. Files changed after the flush can remain
pending. Inspect synchronization and errors after close or expiry; abrupt loss
can leave unsaved changes unavailable. Links identify the current path and do
not pin an earlier version.

Use `resume PROJECT` to continue the same project's saved work. It loads current
files without replaying scientific commands. Read the [outputs reference](outputs.md)
and [project-local code](references/custom-code.md) for file operations and
explicit environment recreation after resume.
