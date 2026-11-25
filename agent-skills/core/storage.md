# Inspect storage and delete saved files

## Usage, browsing and downloads

```sh
ariax storage usage --sort bytes_desc --limit 25 --json
ariax storage usage PROJECT --json
ariax storage usage PROJECT --refresh --json
ariax storage ls PROJECT --path output --limit 50 --json
ariax results PROJECT --source storage --path pdbs/input.cif --download ./inputs --json
```

Usage reads retained measurements without initiating a scan. Managed refresh
returns a current complete observation when available, or pending/running
background work. A matching complete observation can be reused for five minutes.
After a failed attempt, read usage to see the failure and any earlier stale result.
Retries may be delayed briefly. Forge reads its file catalog. Null bytes/counts
mean unknown, including Forge projects without catalog counters.

Overview filters are `--q`, `--protocol`, `--status`; `--sort` is `updated_at`,
`name` or `bytes_desc`. Sorting covers the full authorized filtered result with
stable project-ID ties and unknown bytes last. `--limit` is 1–50 (default 25).
Use the returned `--cursor` unchanged. API keys remain owner-only, including
keys belonging to administrators. No exact account/bucket total is supplied.

Managed listing reads one directory page with `--limit` 1–100 (default 50).
Empty visible pages can have a next cursor because hidden entries still bound
traversal. Do not follow every page automatically. Folder size remains null
without complete relevant measurement. Forge listing reuses native Files paths
under `/workspace` or `/inputs` and its existing page size; omit `--limit`.
Forge downloads retain `ariax forge download` and its existing verified transfer.

Managed namespace bytes include hidden/other objects without exposing names.
Pending-deletion bytes overlap that total, never add them. Forge catalog bytes,
physical backlog and retained recovery archives are separate observations;
do not subtract asynchronous counters to infer overhead. Bound input bytes
and retained archives have separate timestamps and are excluded from current
namespace bytes. Shared assets and unbound staging are excluded.

`largest_files` is the global top 20 safe files from a completed full scan,
not a sorted listing page. Directory summaries cover up to 32 top-level safe
roots, including hidden descendants; sizes can exceed visible children.
`summaries_truncated` limits coverage and ranking. Deeper folders remain unknown.
Live multi-page listings are timestamped observations, not atomic snapshots.

`results --source storage` reuses the existing results downloader for one exact
file, requiring both `--path FILE` and `--download DIR`. Canonical server approval
precedes the existing HEAD/signing and transfer, including supported project
inputs, results and approved archives. A listed `downloadable` hint grants no
authority. Directories, private/operational metadata and staging prefixes stay
unavailable. No recursive download, archive generation or automatic structure
regeneration is added. Existing missing-file and transfer errors remain visible;
checksums are verified only when an expected checksum is available.

## Selected file and folder deletion

Delete selected managed paths only with explicit user authorization. When
selected deletion is enabled, completed, failed and aborted projects can accept
new requests. Paused projects may use the whole-project action or abort. Selected
deletion leaves workflow status unchanged and immediately suppresses the selected
content, including any later reappearance. Physical cleanup waits for publication
closure and can remain pending after acceptance.

```sh
ariax storage delete PROJECT --path output/model.cif --dry-run --json
ariax storage delete PROJECT --path output/models --recursive --dry-run --json
ariax storage delete PROJECT --path output/models --recursive --yes --json
ariax storage status PROJECT --deletion-id REQUEST_UUID --json
ariax storage status PROJECT --deletion-id REQUEST_UUID --wait --wait-timeout 300 --json
```

Dry-run performs only a read-only bounded preview and creates no operation
receipt. It requires no confirmation. A directory preview can inspect at most
four 1000-object pages within a deadline; partial totals remain null. A preview
is a timestamped estimate, not a frozen plan. A complete zero object count means
no objects were found at that preview's timestamp. Empty object listings alone
do not complete multipart/grant verification or terminate a pending wait.

Targets are exact relative paths: at most 512 printable Unicode code points and
255 per component. Preserve the submitted spelling for transfer and display.
Managed deletion compares canonically equivalent Unicode spellings as the same
path. Refuse empty/root/dot/traversal,
component-edge whitespace, leading/trailing slash, backslash, percent, colon,
star and question mark. Root deletion requires `ariax delete PROJECT`.
`--recursive` includes the target object and every descendant, including hidden
files and multipart uploads. `output/run` excludes sibling `output/runner`.
An exact object marker for `output/run` leaves its virtual folder and surviving
children accessible. Known safe cache/intermediate targets can be deleted without
becoming browsable or downloadable. Hidden descendant names are never disclosed.

Deletion is path-scoped. Unselected independent archives and other copies remain
readable under existing access policies, even if they contain a copy. Select
each copy's own path to remove it; archives are not rewritten. Whole-project
deletion takes precedence and may return its retained outcome without creating
a selected child.

Mutation requires interactive confirmation or `--yes`. The existing operation
journal saves exact target, recursive flag, revision, UUID and account/origin
before dispatch. The UUID is the public deletion status ID. Keep
`.ariax/operations/` on uncertainty. Repeating the command reconciles a matching
receipt by GET first; only an unacknowledged request with status 404 can replay
the original body/key. Use `--request-id UUID` for a specific receipt, or
`ariax recover UUID` for explicit reconciliation/replay. Never change the target
under that identity or create a new request after a lost reply. Acknowledged 404s
and dependency failures preserve uncertainty without replay. If the project has
reached its 4,096 effective scope limit, a new distinct scope returns
`deletion_scope_limit`. A covering folder may combine existing scopes.

Known-ID status works from another device on the same account and API origin;
there is no remote receipt enumeration. Saved accepted status/recovery remains
available when new-selection exposure is withdrawn. Waits only GET status and
retain the durable ID on timeout, interruption or attention. Verified-empty
records a completed check at its timestamp.

For Forge, `storage delete` with an absolute `/workspace/...` or `/inputs/...`
path delegates to the existing versioned Files engine. Dry-run only reads native
metadata; native folder aggregates stay unknown. Retain `.ariax/forge/` and use
`ariax forge recover UUID` for explicit native recovery. `storage status PROJECT
--deletion-id UUID` can observe a locally retained native receipt without
advancing recursive work. Separately retained archives are excluded.

## Whole-project deletion and cleanup

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
its timestamp. The default local wait is 300 seconds. Set `--wait-timeout 0`
to wait until interrupted.
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
