# Forge recovery, human holds, revisions, and file mutations

Use this reference when a Forge command, session, limit edit, resume, or file
mutation is interrupted, conflicted, held, or needs edge-case recovery. For
normal Forge usage see [Ariax Forge](../SKILL.md) and [outputs](../outputs.md).

## 1. Recovering a lost response

`forge create` prints `session_id`, `forge run` prints `command_id`, and file
mutations print their operation/input/sync ID before sending the POST. Each
request is saved under `<state-dir>/.ariax/forge/ID.json` (OS state directory by
default; read-only fallback checks legacy `./.ariax/forge/` when `--root-dir`
is omitted; terminal records prune automatically after 14 days).

```sh
ariax forge operations --json
ariax forge recover OPERATION_ID --json
ariax forge recover COMMAND_ID --wait --wait-timeout 1800 --json
```

- `forge operations` lists account-bound local journals and their last locally
  observed states (not a live inventory).
- `forge recover` supports session admission, tool selection, commands, inputs,
  file copies, file deletions, file hydration, sync, finish, cancellation,
  closure, and limit edits.
- Recovery checks live and retained command records before any retry. A pending,
  unstarted command continues with its original ID; an uncertain, failed,
  interrupted, or cancelled command is not started again. If a previously
  observed operation is absent from current history, recovery stops and reports
  uncertainty instead of resubmitting.
- **Inputs:** URL imports omit the URL from local journals; if no saved result
  exists, repeat `inputs add` with the original `--input-id` and `--url`. Local
  multipart uploads resume only with the unchanged source file; once published,
  status inspection needs no local file.
- **Timeouts:** Ordinary create/run/control submissions use a 60s local retry
  deadline. `run --wait-ready`/`--wait` default `--wait-timeout` to 1800s (max
  86400s); `finish --wait` defaults to 7200s while `--timeout-seconds` fixes the
  remote finish deadline at admission (default 3600s, immutable). `tools wait`,
  `watch`, and `sync --wait` treat omitted/`0` `--wait-timeout` as no local
  deadline. A local timeout or `Ctrl-C` never stops remote compute.
- **Connectivity errors (`network_error`):** Check network connectivity and
  retry read-only status calls. Remote jobs may still be running; keep original
  IDs and do not cancel, reauthenticate, or submit duplicates blindly.

## 2. Human holds & control/limit revisions

- **Human pause (`human_resume_required`):** An authenticated web pause sets a
  human hold that API keys cannot clear. Stop work on that project, share the
  project URL, and explain the two web actions:
  1. **Resume workspace:** shows saved hardware/budget, clears the hold, and
     allocates a same-project session atomically. Inspect `ariax forge project
     PROJECT` for `active_session_id` and continue there without creating
     another session or replaying scientific commands.
  2. **Allow agent to resume later** (dropdown): clears the hold with compute
     stopped. Await the user's direction, verify prior-session cleanup and the
     current `control.revision`, then explicitly run `ariax forge resume`.
  Do not bypass a hold with a replacement project. `ariax abort` and web
  **Delete** are terminal and cannot be reopened.
- **Control revision conflicts:** A newer pause invalidates an observed
  `control.revision`. Recovery retains the original revision/ID; after a
  definitive stale-revision rejection, inspect `forge project`, confirm no
  active session or hold, and issue a deliberate new resume with a fresh
  `--session-id` and updated `--control-revision`.
- **Limit edits (`forge limit`):** Edits replace the total GPU-hour allowance
  from original `allocated_at` (8 GPU-hours on 4 GPUs = 2 wall-clock hours;
  preparation and idle time count). `--clear` removes the cap. Wait for
  `applied_limit_revision` to match `limit_revision` in `forge status` before
  relying on an extension; a `limit_revision_conflict` requires inspection
  because it does not prove whether the prior edit applied.

## 3. Server-side `files recover` (copying into workspace)

```sh
ariax forge files recover PROJECT --path /workspace/copied.cif --catalog SOURCE_PROJECT:/workspace/original.cif --version VERSION --wait --json
ariax forge files recover PROJECT --path /workspace/old.cif --archive SOURCE_PROJECT:CHECKPOINT_ID:/workspace/old.cif --wait --json
ariax forge files recover PROJECT --path /workspace/artifact.cif --artifact SOURCE_PROJECT:output/result.cif --wait --json
```

`files recover` copies an authorized catalog version, archived checkpoint file,
or managed-project artifact server-side without transferring bytes through the
CLI. It journals source, destination, writer epoch, and revisions before POST;
recover the same ID after uncertainty. Existing destinations require
`--overwrite`. A published copy is `ready` once confirmed in the active
workspace; `saved` with `installation_status: not_applicable` means it is stored
for a future session. Archive and managed-artifact sources pin to their observed
storage ETag.

## 4. Permanent deletion (`files delete`) & recursive recovery

`files delete` permanently removes the selected saved path and, with
`--recursive`, its saved descendants; it does not create an archive or trash
copy. It frees catalog file and byte capacity when the deletion is committed,
while object cleanup proceeds separately. `--wait` also observes cleanup.
Inspect `cleanup_state` for `complete`, `pending`, `attention`, or `unknown`.

Saved-file deletion is offline-only under single-writer ownership: requests
submitted while a Forge session is active are rejected with `409`
`project_session_active`. Pause or close the active session first to delete
saved files externally, or edit/delete `/workspace` files inside the running
session via `ariax forge run`. For offline recursive deletions, the result's
`progress` counts accepted children, catalog deletions, confirmed removals, and
failures separately from `cleanup_remaining`; it excludes paths not yet
discovered by the CLI. A failed child does not stop independent accepted
children, and its containing directories remain in place. Inspect retained
failure details before deciding on a new operation.

Recursive deletion is driven by the CLI: after an interruption, submitted
batches may finish, but remaining paths require `ariax forge recover ID --wait`
with the original operation ID, CLI root, account, and API origin. Recovery
continues the deletion; it does not restore deleted files.

A saved file changed locally before deletion reports a conflict and stays in
place. If a file is replaced during removal, the replacement may be preserved
at the reported `ariax-recovered-...` workspace path. An unresolved input
conflict continues to block commands. Unsaved local entries can prevent
recursive removal; delete those entries, then start a new deletion with a new
operation ID.

## 5. Offline sessions and error codes

Pass `--offline` to `ariax forge create` or `ariax forge resume` to declare
that the workload does not need outbound internet access, enabling faster
startup and broader single-GPU capacity. Offline sessions block outbound
internet access, keep a fixed tool set for the life of the session, and run one
command at a time. Note that `--offline` is a workload declaration for
scheduling, not a security guarantee that outbound network access is blocked on
every host. Omit `--offline` when a session needs outbound internet, concurrent
commands, multi-GPU execution, or mid-session tool additions.

| Error code | Meaning & recommended action |
| --- | --- |
| `memory_limit_exceeded` | Command exceeded the session memory limit (exit `11`). Reduce memory or batch size, request more RAM with `--min-ram-gib`, or launch a larger GPU. |
| `disk_limit_exceeded` | Command exceeded the workspace/scratch disk limit (exit `11`). Free space under `/scratch` or `/workspace`, or request larger disk with `--min-disk-gib`. |
| `host_restarted` | The remote host restarted and the session was fenced (exit `10`, both at session level and when watching an interrupted command); in-flight commands were interrupted and are not replayed. Inspect saved files and `ariax forge resume` or create a new session. |
| `container_image_fixed` | This session has a fixed tool set (exit `7`). Start a new session for another tool, or omit `--offline` to add tools mid-session. |
| `incarnation_fenced` | This session was fenced (exit `7`). Finish or emergency `ariax forge close SESSION --force` if still open, then resume or create a new session. |
