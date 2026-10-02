**Forge implementation contract**

Accepted for bites 01–07; the B05–B07 extension was settled on October 2, 2026. The user's latest instruction governs this rebuild: use a clean, simple implementation for infrastructure and content that Ariax controls. This document replaces the historical Forge contracts.

**Implementation rules**

Use ordinary image tags and named model directories chosen by Ariax. Docker performs its normal pull. A completed download is moved into its final location, and a shared asset name identifies the weight directory reused by related tools. Successful download/extraction and the tool's actual execution establish whether content works.

Do not add image digest pins, asset checksums, request hashes, signed installation plans, content-addressed caches, deployment identity graphs, verification receipts, or per-command image/weight inspection. Do not implement old API or runtime compatibility, alternate transport paths, provider fallback, CPU fallback for GPU work, or automatic replay of scientific commands. A failed operation reports the actual error through its supported path.

Keep authentication and project authorization, workload isolation, path safety, durable command IDs, VM ownership records, bounded retries, and termination confirmation. These protect access, prevent duplicate execution, and release billable resources. Existing unrelated managed-job protocols retain their current behavior. Normal package management and Docker's own internals require no replacement implementation.

**Ownership and scope**

The backend owns account access, selected tools and priority, the broker allocation, existing instance billing, and the session lifecycle. The VM daemon owns command execution, the preparation queue, and file operations in its SQLite journal. The file service saves workspace checkpoints to project-scoped object storage. The CLI uses the existing public Next.js agent API, which authenticates the API key and forwards signed compute requests to the backend.

Use one full-VM runtime on Ubuntu with systemd, Docker, the NVIDIA driver/container runtime, writable local storage, and an outbound tunnel. Hyperstack is the sole implementation in bite 03. Vast is a separate later adapter. Use on-demand single-GPU offers. An unavailable requested provider/GPU produces an error. An uncertain create is reconciled using its recorded ownership before any subsequent allocation attempt.

The user requires image builds and qualification on remote GPU VMs. Stage source, fixtures, and model assets on those VMs and run Docker commands there through SSH. Keep the user's workstation free of image builds and treat its Docker daemon as outside the requirements for this campaign. Docker on each remote Forge VM supplies workload isolation and container execution.

Each repository uses its existing language and test tools. The original worker briefs record implementation ownership. The orchestrator now owns the combined integration branches and assigns later work through the current handoff in docs/forge-next-turn-plan.md. Changes to this contract need orchestrator review before other workers consume them.

**Public API**

Public routes are under `/api/v1/forge` on the existing CLI API origin. The matching private backend routes are under `/api/forge`. The Next.js routes use the existing agent route handler for API-key scopes/rate limits and the existing signed compute client. Extend its concrete route allowlist for Forge. Private Forge handlers require signed compute authentication and use the existing project ownership helpers. Derive the actor from authentication; a foreign session returns 404. Do not add direct host credentials or an alternate backend URL mode to the CLI.

Successful JSON responses use `{"data": ...}`. Public errors use the existing `{"error": {"code": "...", "message": "...", "retryable": false}}` envelope and normal request metadata. Use 422 for invalid input, 409 for conflicting request IDs, a busy GPU, or an unready tool, and 503 when the host cannot be reached. Runtime errors use `{"error": {"code": "...", "message": "..."}}`.

| Method and path | Request and result |
|---|---|
| `GET /catalog` | Public tool metadata: `{"tools": [{"tool": "base", "name": "Base workspace", "gpu": false}]}`. Include only configured supported tools. |
| `POST /sessions` | `CreateSession` below. Persist acceptance before queueing allocation; return 202 and a session. |
| `GET /sessions/{session_id}` | Return the session. |
| `GET /sessions` | Return `{"sessions": [...]}` for the authenticated actor, newest first, bounded to the most recent 100. |
| `POST /sessions/{session_id}/tools` | `SelectTools` below. Return 202 and current session/tool states. Preparation queues the selected tools and retains ready tools while other work installs. |
| `POST /sessions/{session_id}/commands` | `RunCommand` below. Return 202 and the command after durable admission. A replay of an already accepted ID returns the existing command. |
| `GET /sessions/{session_id}/commands` | Return `{"commands": [...]}`, most recent 100. |
| `GET /sessions/{session_id}/commands/{command_id}` | Return the command. |
| `GET /sessions/{session_id}/commands/{command_id}/logs?tail=1000` | Return `{"command_id": "...", "text": "..."}`. Bound `tail` to 1–5000 lines. |
| `POST /sessions/{session_id}/commands/{command_id}/cancel` | Return 202 and the command with cancellation requested. Repeated cancellation is harmless. |
| `POST /sessions/{session_id}/close` | Return 202 and the session. Repeated close observes the same closure. |

`CreateSession`:

```json
{
  "session_id": "11111111-1111-4111-8111-111111111111",
  "name": "Binding experiment",
  "provider": "hyperstack",
  "gpu_type": "L40",
  "tools": ["boltz2", "bindcraft2"],
  "priority": ["boltz2", "bindcraft2"],
  "max_hours": 2
}
```

The CLI generates and persists `session_id` before sending. The backend creates one Forge project and job for that request, with the session ID also used as the job ID. Persist the project ID alongside it. Retrying the same session ID and request returns the existing session; changing its request returns 409. Compare stored validated fields directly. Creation of the project/job/session record must be atomic or use the existing durable admission mechanism so a lost response cannot duplicate work. B03 owns the concrete SQL and integrates with current main's admission and billing paths.

`provider` defaults to `hyperstack`. `gpu_type` is required. `tools` defaults to an empty list for a base workspace. The base image is always included and is omitted from selection lists. Tool names are explicit catalog keys. Reject duplicates and unknown tool names. `priority` can name any subset of selected tools; append the remaining selected tools in their supplied order. Omitted priority uses selection order. `max_hours` is optional and positive when supplied; expiry counts from allocation. Duration caps and balance exhaustion terminate through the normal backend lifecycle.

`SelectTools` contains `tools` and optional `priority` with the same rules, and at least one tool. It adds selections; ready tools retain their running containers. Ensuring a ready/queued/installing tool again is harmless. A failed tool can be explicitly requested again. Status polling never initiates that retry.

Session fields:

```json
{
  "session_id": "11111111-1111-4111-8111-111111111111",
  "project_id": "22222222-2222-4222-8222-222222222222",
  "name": "Binding experiment",
  "state": "available",
  "provider": "hyperstack",
  "gpu_type": "L40",
  "tools": [
    {"tool": "base", "state": "ready", "error": null},
    {"tool": "boltz2", "state": "ready", "error": null},
    {"tool": "bindcraft2", "state": "installing", "error": null}
  ],
  "expires_at": "2026-10-02T10:00:00Z",
  "persistence": {"state": "pending", "checkpoint": null, "error": null},
  "error": null
}
```

Session states are `provisioning`, `starting`, `available`, `closing`, `closed`, and `failed`. `available` means the host and base workspace accept commands. Each scientific tool has its own `queued`, `installing`, `ready`, or `failed` state. Tool failure does not revoke host availability. The backend reports `closed` only after its owned resources have been released; a cleanup problem leaves it `closing` with an error. Provider-resource discovery/termination works even when the host is unreachable.

Persistence begins as `pending` with a null checkpoint. `syncing`, `synced`, and `failed` describe the current or most recent persistence attempt. The checkpoint ID retains the latest completed checkpoint when a later attempt fails. Unsynced files remain local to the VM.

`RunCommand`:

```json
{
  "command_id": "33333333-3333-4333-8333-333333333333",
  "tool": "boltz2",
  "argv": ["boltz", "predict", "/inputs/target.yaml", "--out_dir", "/workspace/outputs/run1"],
  "cwd": "/workspace",
  "timeout_seconds": 3600
}
```

The CLI persists `command_id` and request before submission, reusing its existing atomic file writer. The backend forwards the same body to the daemon. Compare the stored validated request fields on replay; no canonical hash is needed. `tool` and nonempty `argv` are required. `cwd` defaults to `/workspace` and must stay under it. `timeout_seconds` defaults to 86400 and must be positive. Users can explicitly execute a shell through argv. No host shell interprets user argv.

The command response includes `command_id`, `tool`, `argv`, `cwd`, `timeout_seconds`, `state`, `cancel_requested`, `exit_code`, and `error`. States are `starting`, `running`, `succeeded`, `failed`, `cancelled`, `interrupted`, and `unknown`. A duplicate ID with a different request returns 409. `unknown` retains its GPU reservation until container reconciliation establishes the outcome. One GPU command runs per session; another gets `gpu_busy`. CPU commands obey a small configured concurrency limit. A command identifies its tool by name; the catalog provides its image and model mounts.

**Daemon HTTP and configuration**

Daemon routes are `/health`, `/tools`, `/commands`, `/commands/{id}`, `/commands/{id}/logs`, `/commands/{id}/cancel`, and `/close`, using the methods and command payloads above. `/tools` GET returns `{"data": {"tools": [...]}}`; POST accepts `SelectTools`. `/health` returns `{"data": {"session_id": "...", "state": "available", "tools": [...], "active_command_id": null}}`. `/close` fences admission and confirms that command writers have stopped before attempting final sync. Its response contains `session_id`, `state`, and `persistence`. Local state can remain `closing` while image preparation finishes cancellation; `closed` confirms local work has stopped. The backend confirms provider-resource release before reporting public session state `closed`.

Every daemon route requires the per-session bearer token over the existing authenticated tunnel. Keep the daemon listening on loopback. Its root-only configuration is a single JSON file selected by `FORGED_CONFIG`, default `/etc/ariax-forged/config.json`:

```json
{
  "session_id": "11111111-1111-4111-8111-111111111111",
  "token": "generated-private-session-token",
  "data_dir": "/var/lib/ariax-forge",
  "catalog_path": "/etc/ariax-forged/catalog.json",
  "selected_tools": [],
  "expires_at": null
}
```

The backend creates the token with the existing secret-handling facilities and retains it only in private control-plane storage. Never include it in public responses, CLI logs, source, or workload environments. A host replacement gets a fresh token and is activated only after the old VM is confirmed terminated. Both the backend and daemon honor the configured expiry. HTTP failure does not prove VM loss or command failure.

Catalog example, with illustrative URLs only:

```json
{
  "tools": {
    "base": {"image": "registry.example/ariax/forge-base:current", "gpu": false, "model_mounts": {}},
    "boltz2": {"image": "registry.example/ariax/forge-boltz2:current", "gpu": true, "model_mounts": {"boltz2": "/models/boltz2"}}
  },
  "assets": {
    "boltz2": {"url": "https://models.example/boltz2.tar", "archive": "tar"}
  }
}
```

`tools` maps names to image tags and the named model assets they mount. `assets` maps those names to Ariax-controlled download locations. The catalog is deployed as an ordinary file. The backend reads the same format to validate selection, then copies the intended catalog to the host. Use catalog names to share weights intentionally; each asset downloads/extracts once into `data_dir/models/{asset}`. The durable preparation queue implements that path. There are no catalog version negotiations or digest fields.

The bootstrap creates state, inputs, workspace, scratch, and models directories under the configured data directory. Mount `/inputs` and model directories read-only. `/workspace` and `/scratch` are writable workload mounts. The daemon, SQLite journal, credentials, Docker socket, and host root remain outside workload access. Preserve the existing container/network isolation policy and protect against path traversal and unsafe archive extraction.

Base preparation runs first. Its readiness makes the host available while other selected tools prepare. Each science command requires its named tool to be ready. A pending restore keeps admission unavailable until its chosen files are restored.

**CLI command surface**

Use the existing CLI client, output conventions, errors, and atomic writer. The commands are:

```text
ariax forge create --name NAME --gpu GPU [--provider hyperstack] [--tools boltz2,bindcraft2] [--priority boltz2] [--max-hours 2]
ariax forge list
ariax forge status SESSION
ariax forge tools SESSION
ariax forge tools add SESSION --tools boltz2 [--priority boltz2]
ariax forge tools wait SESSION TOOL [--timeout SECONDS]
ariax forge run SESSION --tool TOOL [--cwd /workspace] [--timeout-seconds 3600] -- COMMAND ARG...
ariax forge commands SESSION
ariax forge command SESSION COMMAND_ID
ariax forge watch SESSION COMMAND_ID [--timeout SECONDS]
ariax forge logs SESSION COMMAND_ID [--tail 1000]
ariax forge cancel SESSION COMMAND_ID
ariax forge close SESSION
```

Support existing global JSON output. Wait/watch timeouts end local waiting and retain the remote operation. Save a small request record under `.ariax/forge/{id}.json` containing its ID, API origin, actor, method/path/body, and the latest known result. Reuse/export the existing atomic writer and account lookup. The managed-job operation format includes request hashes and compatibility checks, so leave that format untouched and keep Forge's record plain. Do not build another journal framework. Expose explicit `--session-id` on create and `--command-id` on run for retry/recovery. A retry must use the same saved request and account. Return the IDs promptly so an agent can continue later.

The file command surface is specified below. Local acceptance exercises the installed CLI through the public API and preserves existing managed-job command behavior.

**Verification and handoff**

Reuse meaningful existing tests. Exercise public paths with provider/Docker boundaries substituted when local execution requires it. Cover duplicate submission and lost acknowledgments, restart reconciliation, cancellation, unauthorized access, and cleanup after host failure. Avoid source-inspection tests, schema snapshot matrices, and tests that only assert configured mocks.

Workers commit their bite in their own worktree and finish with changed files, test results, and remaining integration needs. Do not create additional worker chats, rent VMs, publish artifacts, or deploy during B02–07. The orchestrator reads worker progress and integrates accepted work. Live GPU qualification belongs to B08.

**B05–B07 shared boundary, October 2, 2026**

B05–B07 code and guides are integrated and have passed local acceptance. The current B08 handoff is `docs/forge-next-turn-plan.md`; `docs/forge-integration-bite.md` records the completed worker assignments. The orchestrator owns integration branches and lifecycle decisions.

B05 keeps the catalog shape above: each tool has `image`, `gpu`, and `model_mounts`; each asset has `url` and `archive` (`tar` or `zip`). The selected tool order at bootstrap is already the desired priority. Later `SelectTools` requests prioritize the named selected tools and retain other selections. One durable queue prepares base first, then scientific tools. Ready tools remain usable while the queue works. Published named assets remain read-only. An asset that is complete at its final path is reused directly. Unsafe archive entries and incomplete transfer are failures; there is no checksum or digest protocol.

B07 supplies `science/catalog.json`, image build contexts, and native fixtures. The image must expose its documented executable on PATH because Forge passes argv directly. Model paths in native commands must agree with the catalog mount destinations. The reference keys are `base`, `ipsae`, and `boltz2`; base and ipSAE use CPU, and Boltz2 uses GPU. A base workspace contains a POSIX shell and Python 3. Science guides live under `agent-skills/skills/ariax-forge/tools/`. Publication and native GPU qualification belong to B08.

**B06 public file API**

All paths below have the existing public prefix `/api/v1/forge`; the backend uses `/api/forge` with signed compute authentication. Keep the normal data/error envelopes. UUID operation IDs are durable and compare validated fields directly. Repeating an accepted ID observes that operation; different fields produce 409. Foreign sessions, source projects, inputs, and checkpoints return 404. Every operation authorizes the destination session, and imported/restored data also authorizes its source.

`path` in an input request is a relative POSIX file path within `/inputs`, such as `targets/target.yaml`. Reject absolute paths, empty/dot/traversal components, backslashes, NULs, symlink traversal, and destinations outside that root. Imports create regular files. A published destination cannot be overwritten. Enforce configured transfer size/time limits. The worker chooses and documents those limits without adding another general policy service.

| Method and suffix | Body or result |
|---|---|
| `POST /sessions/{id}/uploads` | `{input_id, path, size_bytes}` reserves a local-file upload and returns `{input_id, upload_url, upload_method:"PUT", upload_headers, expires_at}`. Same ID and fields may renew the short-lived PUT grant. |
| `POST /sessions/{id}/inputs` | `{input_id, path, source}` returns 202 with the input record. Source forms are listed below. |
| `GET /sessions/{id}/inputs` | `{inputs:[...]}`, most recent 100. |
| `GET /sessions/{id}/inputs/{input_id}` | One input record. |
| `POST /sessions/{id}/checkpoints` | `{checkpoint_id}` starts or observes a checkpoint; returns 202 with its record. |
| `GET /sessions/{id}/checkpoints` | `{checkpoints:[...]}`, most recent 100. |
| `GET /sessions/{id}/checkpoints/{checkpoint_id}` | One checkpoint record, available after the VM closes. |
| `GET /sessions/{id}/files?path=/workspace&checkpoint=UUID&cursor=...` | A bounded listing from a completed checkpoint: `{checkpoint, entries:[{path,kind,size_bytes}], next_cursor}`. Omitted checkpoint selects the latest completed checkpoint. |
| `POST /sessions/{id}/files/presign` | `{path, checkpoint}` returns `{path, checkpoint, download_url, expires_at, size_bytes}` for one checkpoint file. Omitted checkpoint selects the latest completed checkpoint. |

Input `source` is one of `{"kind":"upload"}`, `{"kind":"artifact","project_id":"UUID","path":"artifact/path"}`, or `{"kind":"url","url":"https://..."}`. For uploads, the same `input_id` identifies the preceding upload reservation. The control plane derives the object key from that reservation and confirms the uploaded size before import. Keep the existing managed `/uploads/init` behavior unchanged; it accepts managed PDB/CIF inputs. Reuse its storage/auth helpers where applicable.

An input record has `input_id`, `session_id`, `path`, `state`, `size_bytes`, and `error`. States are `queued`, `importing`, `ready`, or `failed`. The record excludes signed URLs and credentials. `ready` means the file is published at `/inputs/{path}` with permissions allowing the workload UID to read it. Retain a durable Ariax-owned copy or reference for checkpoints; an expiring external URL cannot be the only restore source. Inputs that fail before publication leave no partially visible destination. A new explicit import can replace a failed attempt only after its unfinished work has stopped.

Checkpoints have `checkpoint_id`, `session_id`, `state`, `created_at`, `completed_at`, `file_count`, `size_bytes`, and `error`. States are `queued`, `syncing`, `synced`, or `failed`. A checkpoint is published only after all referenced file objects and its index are durable. Its index covers workspace files and ready staged inputs. It excludes scratch, models, runtime journals, and credentials. Preserve the previous good checkpoint after a failed attempt. Use file metadata for changed-file detection and reject a file version that changes during copying. Checkpoints preserve stable file versions; they do not claim a simultaneous database-style snapshot across files while commands write.

`files` and `download` describe completed checkpoint content. Without a completed checkpoint they return 409 `checkpoint_required`; with an incomplete chosen checkpoint they return 409 `checkpoint_unready`. The CLI explains that `sync --wait` creates the checkpoint needed for inspection/download. This makes source selection explicit after a session closes. Inputs have their own readiness/list API before the first checkpoint.

The session's existing `persistence` fields become real stored state. `checkpoint` names the latest completed checkpoint and remains that value when a later sync fails. `state` describes the current/most recent persistence attempt. Reconciliation stores it in the backend, so status survives VM loss. Periodic sync uses a bounded cadence and changed-file detection; explicit sync queues an immediate attempt. One checkpoint runs at a time. A concurrent explicit request can return 409 `sync_busy` with the active checkpoint ID. Status polling only observes work.

**Restore, daemon calls, and closure**

`CreateSession` gains optional `restore: {session_id, checkpoint_id}`, default null. The source session must be terminal (`closed` or `failed`) and the chosen checkpoint must be complete. Authorize both the source session and its project before admission. Persist the restore source in the ordinary create request so its retry keeps the current idempotency behavior. Restore into the newly allocated session before command admission. Restore the chosen index exactly, including deletion between checkpoints. Commands and old runtime credentials are never restored or replayed. A restored session has a new project/job/session and the normal allocation/billing path.

B06 adds daemon `/inputs`, `/inputs/{input_id}`, `/checkpoints`, `/checkpoints/{checkpoint_id}`, and `/restore` endpoints over the existing bearer-authenticated tunnel. They use the operation IDs and status records above. The backend supplies validated transfer locations and temporary project-scoped grants through private request fields. Public callers cannot choose bucket prefixes or submit those grants. B06 owns the exact private transfer structures across its three worktrees and records them in its handoff; these are internal to that bite. `/health` and `/close` gain the existing public-shaped `persistence` object without secrets. A pending restore keeps health at `starting` and command admission unavailable.

Use the existing project-scoped R2 credential facilities with an ordinary storage client. Never send parent credentials to the VM. Temporary credentials remain outside workloads and last only for bounded transfers. Existing authentication signing is retained. The prohibition on new content hashes does not replace standard SDK/authentication internals. Runtime `boto3` is the approved storage dependency for this wave; backend can use its existing botocore client. Additional package-manifest changes return to the orchestrator.

Close fences command admission and stops workspace writers. Its handler shares a sixty-second deadline across that stop and the final checkpoint. Image preparation can finish cancellation while the checkpoint saves workspace bytes. Expiry stops local work and permits a final sync of up to sixty seconds. The controller bounds close at seventy seconds including transport and bookkeeping. Resource cleanup continues when storage or the host is unavailable. Preserve the last completed checkpoint and report any durability gap in `persistence.error`; public session `closed` confirms resource release.

File recovery runs after successful acquisition of the existing daemon lock and before preparation or watchers start. Constructing a second app leaves active transfer state untouched. The file service keeps its tables in the existing SQLite database. Lifecycle hooks are part of the integrated runtime; the current worker boundaries are in the integration brief.

**B06 CLI surface**

```text
ariax forge inputs add SESSION --file FILE --path RELATIVE_PATH [--input-id UUID]
ariax forge inputs add SESSION --artifact PROJECT_ID:PATH --path RELATIVE_PATH [--input-id UUID]
ariax forge inputs add SESSION --url URL --path RELATIVE_PATH [--input-id UUID]
ariax forge inputs list SESSION
ariax forge inputs status SESSION INPUT_ID
ariax forge sync SESSION [--wait] [--checkpoint-id UUID] [--timeout SECONDS]
ariax forge checkpoints SESSION
ariax forge checkpoint SESSION CHECKPOINT_ID
ariax forge files SESSION [--path /workspace] [--checkpoint UUID]
ariax forge download SESSION PATH --dest LOCAL [--checkpoint UUID]
ariax forge create --name NAME --gpu GPU --restore-session SOURCE --checkpoint UUID [usual create options]
```

The three input sources are mutually exclusive. Print and retain input/checkpoint IDs before mutation, and use the existing atomic writer for private request records. Keep credentials and signed URLs out of logs. Persist durable IDs and safe source metadata; temporary upload/download grants are not saved as ordinary request results. After a lost reply, query the same ID before resubmitting. A URL import can require the original user-supplied URL again if no accepted operation is found. Wait timeouts end local polling and leave accepted work intact. CLI downloads stream directly to the chosen local destination using a temporary file and final rename. Reuse existing CLI file/output conventions.

Forge reference dispatch and guide indexes expose `outputs`, `base`, `ipsae`, and `boltz2` through both platform aliases. The Forge platform guide describes the public workflow; each tool guide describes its native inputs, invocation, output inspection, and qualification status.
