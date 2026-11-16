# Delete projects and observe cleanup

`ariax delete PROJECT` permanently deletes a whole project's current saved files.
Confirm the exact project UUID and the user's deletion authorization first.
Interactive use asks for confirmation; automation must pass `--yes`.
This is irreversible. Separately retained Forge archives are excluded.

For managed projects, paused, aborted, completed and failed workflows can be
deleted. A running, created, queued or starting project must be aborted first.
Pausing keeps a project resumable; deleting it prevents resume immediately.
Deletion begins independently of compute teardown and does not preserve a final
save. This command does not select individual files or directories.

```sh
ariax storage status PROJECT --json
ariax delete PROJECT --yes --json
ariax delete PROJECT --yes --wait --wait-timeout 300 --json
```

The CLI writes a durable request before dispatch. Its UUID is also the
Idempotency-Key. Keep `.ariax/operations/` until an uncertain request is reconciled.
A lost reply leaves the exact body, revision and identity unchanged. Repeating
`ariax delete PROJECT` reuses an uncertain request for that account/origin/project;
use `--request-id UUID` to select an existing receipt or supply a new identity.
Existing receipts cannot be rebound to another action, project, account, billing
account or API origin. Reconcile with the same account and origin:

```sh
ariax operations
ariax recover REQUEST_UUID
ariax delete PROJECT --request-id REQUEST_UUID --yes
```

Accepted deletion and storage verification are separate. Cleanup reports pending,
attention or verified_empty with check timestamps. Counts are unknown until a
complete check; zero is meaningful only with `last_complete_check_at`. A
verification_not_before timestamp is an earliest check bound, not a completion
promise. Unknown historical authority remains unknown and can require attention.

`ariax storage status PROJECT --wait` only reads. It never resubmits deletion,
scans storage or controls compute. Waiting stops at verified_empty and reports
its timestamp; infrequent backend reconciliation continues afterward. The
default local wait is 300 seconds; `--wait-timeout 0` waits until interrupted.
Timeout, interruption or attention includes the project and any deletion request
identity in the error details. Deletion remains accepted; use the status command
to observe it, and do not create a new request merely to continue waiting.

Native Forge cleanup keeps its pending/completed semantics and separate release,
saved-file and error fields. Completed native cleanup is not relabeled as a
managed verified-empty observation. Current-project deletion excludes separately
retained archives. Continue using `ariax forge files` for native file operations.

Deleted-project content, logs, listings, new download grants and recovery-source
admissions are refused. Authorized project metadata, cleanup status and deletion
retries remain readable. Use the project UUID after deletion; ordinary project
name lookup may no longer include it. Save scientific results before requesting
deletion when the user wants to retain them.
