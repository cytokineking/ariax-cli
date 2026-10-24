---
name: ariax-forge
description: Create and operate Ariax Forge compute sessions, select tools, run native commands, recover submissions, and cancel or close work through the Ariax CLI.
---

# Ariax Forge

Create a workspace by choosing its GPU model, count and resource limits.
Ariax manages compute placement. Use `ariax forge catalog --details --json`
for available tools, scientific source versions, model choices and resource
requirements. Unknown resource minima are reported as null.

Read this guide with `ariax skills forge --read --json`. Discover native guides
and installed example directories with `ariax skills forge --json`, then read
one with `ariax skills forge --reference NAME --read --json`. The `ariax-forge`
alias uses the same guides. Upload each example's inputs and companion files
before running its commands. Scientific provenance and applicable license
conditions remain in the native tool guides.

Use the [campaign benchmark](tools/campaign-benchmark.md) for bounded tables from retained candidate results, declared QC and database searches.

The CLI opens a temporary HTTPS connection for active commands, tools and file transfers. Lifecycle controls and retained project history use the authenticated Ariax API. JSON responses put results in `data`;
progress and diagnostic references go to stderr. Use `ariax forge --help` for
commands. Files checkpoints preserve registered inputs and workspace outputs
between sessions. Complete a save before closing compute, and inspect existing
command IDs after an interrupted response so scientific work runs once.

## Start and select tools

```sh
ariax forge create --name "Base workspace" --gpu L40 --gpu-count 1 --max-gpu-hours 2 --json
ariax forge catalog --details --json
ariax forge list --json
ariax forge status SESSION --json
ariax forge tools SESSION --json
ariax forge tools wait SESSION base --timeout 600 --json
# When ipsae is in the deployed catalog:
ariax forge tools add SESSION --tools ipsae --priority ipsae --json
ariax forge tools wait SESSION ipsae --timeout 1800 --json
```

Omit `--tools` for a base workspace. Base is always included; leave it out of
selection lists. Tool keys come from the configured public catalog at
`GET /api/v1/forge/catalog`, not managed protocol names or invented image
selectors. `--priority` names any subset of selected tools; the remaining tools
follow in their selection order. Ariax manages ordinary image tags and named
shared model assets.

Session `available` means the host and base workspace accept commands. Each
scientific tool separately reports `queued`, `installing`, `ready`, or `failed`.
Wait for the requested tool to be ready. A tool failure does not revoke host
availability. Ready tools remain usable while preparation runs in the background.

`--min-ram-gib`, `--min-cpu-count` and `--min-disk-gib` request hardware minima.
Ariax admits the selected GPU model and exact device count using its current
catalog. Inspect the returned `hardware`; unavailable fields remain unknown.

The CLI saves a `selection_id` and the request before dispatch. If a response is uncertain, repeat the request with `--selection-id` set to that saved ID, identical tool and priority fields, and the same CLI root directory, account and API origin. An accepted selection keeps its outcome across repeat delivery and daemon restart. To retry a confirmed preparation failure, submit a new selection ID; omitting `--selection-id` generates one. Status and wait commands observe progress. Model downloads obtain a fresh grant when preparation reaches an absent asset.

## Execute and observe

```sh
ariax forge run SESSION --tool base -- python3 -c 'print("hello")'
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

Use `--retained` with commands, command, logs, inputs list/status or checkpoint
reads to inspect backend history after closure or host loss. Activity and session
responses expose the stored sequence and last synchronization time. An unknown
command keeps its original ID while its outcome remains uncertain. Retained
history never starts replacement execution.


The agent chooses native argv inside the selected Docker image. Put the
native executable and every native argument after `--`; Forge passes that
argv unchanged. Include an explicit shell through argv when the task needs
one. The native guides provide examples, with the workflow chosen by the
agent for the user's task. Native helper commands shown without a Forge prefix
still execute inside their documented ready workload container. Match help to
that image's source version, for example `ariax forge run SESSION --tool boltz2
--gpus 0 -- boltz predict --help`. Help does not qualify an untested mode.

`--cwd` defaults to
`/workspace` and must stay under it. `--timeout-seconds` controls remote command
execution and defaults to 86400 seconds. Native tool options and scientific
interpretation require that tool's documentation; a command record is not its
stdout or evidence of scientific quality.

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

`activity PROJECT` returns durable command and attributed control events.
Read older pages with the returned opaque `next_cursor` using `--cursor`;
`--limit` accepts 1–100. Session command lists show the newest 100 records.
Command detail and bounded output remain readable after compute teardown.
Inspect `output_available`, `output_truncated`, `output_complete` and
`output_error`. A captured empty tail is available. A complete terminal tail
can still omit an earlier prefix. Fuller useful logs require explicit workspace
files and checkpoints; `output_files` is currently empty. Activity contains
public commands and controls; external agents' private conversations stay private.

## Recover a lost response

Create prints `session_id` and run prints `command_id` before the POST. Each
request is saved under `.ariax/forge/ID.json` in the chosen `--root-dir`. Retain
the ID, original request fields, root directory, account, and API origin.

After a lost acknowledgment, inspect the printed identity:

```sh
ariax forge status SESSION --json
ariax forge command SESSION COMMAND_ID --json
```

Retry the original create or resume with `--session-id SESSION`, or the original run with
`--command-id COMMAND_ID`, using identical fields and the same account and root
directory. The CLI compares fields directly with the saved request. The server
returns accepted work for a duplicate ID. Changing an ID can allocate another
VM or execute another command. Do not automatically rerun scientific commands
under a new ID after a timeout, failure, or uncertain acknowledgment.

`tools wait` and `watch` use `--timeout SECONDS` to limit local polling; zero or
omission waits without a local deadline. A local timeout or Ctrl-C leaves remote
work running. Resume with the same wait/watch operands. For other commands,
the usual global `--timeout` remains a per-request limit in milliseconds.

## Project controls and resume

```sh
ariax forge project PROJECT --limit 50 --json
ariax forge status SESSION --json
ariax forge resume PROJECT --session-id NEW_SESSION_UUID --restore-session SOURCE_SESSION --checkpoint CHECKPOINT_UUID --control-revision N --gpu L40 --gpu-count 2 --tools boltz2 --max-gpu-hours 8 --json
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

Resume requires a terminal source session from the same project and a completed
checkpoint. Wait for confirmed source cleanup and inspect `project` if another
session is active. A newer pause invalidates an observed control revision.
A definitive hold or stale-revision rejection permits a new explicit request
with the newly observed revision and a fresh session ID. A lost acknowledgment
requires the original ID and fields. Local saved requests remain immutable.

Resume creates a new allocation/job within the existing project and restores
the selected saved files before command admission. It leaves the next scientific
command to the agent. Choose provider, hardware, tools, priority and an optional
new cap explicitly; the old session's allowance is separate.

Limits use total GPU-hours including preparation and idle time. Eight GPU-hours
on four GPUs allow two wall-clock hours. An edit replaces the total allowance
from the original `allocated_at`. Read the current `limit_revision` before
editing, especially after a lost reply; stale revisions reject the edit.
`--clear` removes the cap and deadline. A reduced allowance can make cleanup
immediately eligible. Closing sessions reject edits. New runtimes enforce the
optional limit locally during backend outages. Omitting the cap creates an
open-ended session subject to explicit project controls and ordinary credit
exhaustion stops. Command timeouts retain their own path.

A successful edit saves `limit_revision`. Inspect `applied_limit_revision` to
confirm host delivery: it must equal the saved revision. While delivery is
pending (or the field is absent on an older service), the host retains its
previous local deadline. An extension or `--clear` can therefore be saved while
the prior timer still stops work. Human output reports this pending state;
JSON preserves both revisions. A locally stopped session cannot be revived by
an edit. Inspect status and cleanup before an explicit same-project resume.

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

Stage a local file, an authorized Ariax artifact, or an individual public HTTPS object with `ariax forge inputs add SESSION --file FILE --path targets/input.yaml`. Use `--artifact PROJECT_ID:PATH` or `--url URL` for the other sources. Published inputs appear under read-only `/inputs`; inspect readiness with `inputs status SESSION INPUT_ID` before a command reads them.

Run `ariax forge sync SESSION --wait` to publish a checkpoint, then use `files` or `download`. Read `ariax skills forge --reference outputs --read --json` for these commands
and restore. Checkpoints preserve stable file versions and ready inputs. Concurrent writers can fail a sync. Inspect `persistence.checkpoint` and `persistence.error` after close or expiry to learn what became durable.

Use `resume PROJECT` for continuing a project's saved work. An explicitly
requested new project can use `create --restore-session SOURCE --checkpoint
CHECKPOINT` from an authorized terminal source whose hold permits restoration.
Read [project-local code](references/custom-code.md) for saved source/bootstrap
instructions and explicit environment recreation after restoration.

Use [capability discovery](tools/capabilities.md) to route tasks and inspect each model/mode evidence scope before selecting a tool.
