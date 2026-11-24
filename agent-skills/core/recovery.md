# Managed operation recovery, failures, and support

Use this reference when a managed submission, upload, provisioning attempt, or
job encounters uncertainty or failure. For routine preparation, submission, and
results, see [managed lifecycle](managed-projects.md).

## Operation recovery & upload intents

```sh
ariax operations --json
ariax recover OPERATION_ID --wait
# Once a project ID is known, polling alone is sufficient:
ariax status PROJECT_ID --wait
```

- Mutation journals are stored in the CLI's OS state directory (with read-only
  fallback to legacy `./.ariax/` in the working directory; override via
  `--root-dir`). Terminal journals are automatically pruned after 14 days.
- `ariax recover` reconciles the original idempotent request and replays it only
  when safe, without creating a duplicate campaign. Follow `in_progress` with
  `--wait`. A failed operation with `retryable: false` is terminal: diagnose it
  before a separately authorized new submission. Changed inputs, API origin, or
  account block replay.
- **Unjournaled upload intent:** If a direct input upload succeeds but local
  journaling fails, the CLI prints an upload intent ID and confirms project
  creation was not sent. Keep the original job, input bytes, account, API
  origin, and project name; retry with a writable `--root-dir` and
  `--input-upload-intent-id ID` before the intent expires (typically 15 min).
- **Pause, restart, abort:** Only `paused` projects can be restarted (`ariax
  restart` preserves saved scientific settings and GPU policy; scientific edits
  require a new project). `failed` projects cannot be restarted. Terminal states
  are `completed`, `failed`, `paused`, and `aborted`; a local wait timeout or
  `Ctrl-C` never aborts remote work.

## Provisioning and job failures

Use public status, returned `action` guidance, and retained campaign logs. Do
not guess internal provider diagnostics from generic status. Defaults below do
not expand spending authorization.

| Public evidence | Action |
| --- | --- |
| Provisioning or compute still in progress | Poll the same project. Do not submit a duplicate, restart a running project, or alter scientific settings for unexplained delays. |
| Public status identifies a restartable provisioning pause | Within existing restart authorization, attempt at most one delayed restart on the same project. If it recurs, seek support instead of looping. |
| GPU choices are narrow | Suggest broadening `allowed_gpus` within authorized memory and hourly limits (retaining at least one core GPU) via `ariax gpu-preferences PROJECT_ID -f prefs.json` before restart. |
| Submission or restart outcome is uncertain | Run `ariax operations` and `ariax recover OPERATION_ID --wait` before considering replacement work. |
| Stop/cleanup unconfirmed or status/allocation conflicts | Continue read-only `status` checks and seek support. |
| Execution failed | Inspect `status`, `ariax jobs --project ID`, `ariax logs JOB_ID --list`, the campaign summary, and the failed worker's `log_ref`. Diagnose a concrete input or scientific cause before proposing new paid compute. |
| Completed with zero accepted designs | Review scientific evidence via [campaign planning](campaigns.md#decide-the-next-wave-from-evidence); this is not automatically a failure or relaunch authorization. |

Validation passing does not guarantee runtime success. Distinguish pre-design
execution failure from completed designs rejected by filters. Missing retained
logs do not promise future availability.

## Seek technical support

Recommend emailing `support@ariax.bio` for repeated provisioning failures after
one bounded retry, failures with missing logs or no supported correction,
inconsistent status/results evidence, or an unconfirmed stop. Include available
project/job IDs, operation/request IDs, CLI version (`ariax --version`), command
and public error, expected vs. observed behavior, and actions tried — never
credentials, signed URLs, or bulk logs.

Send email only if the user explicitly asks; do not claim a ticket was created.
To record project-linked feedback or obtain a reference ID, run
`ariax feedback` (see [agent feedback](feedback.md)).
