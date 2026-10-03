**Forge implementation contract**

Updated October 3, 2026, after B12 qualification of reliability, tool selection, model grants and host support. Read the [B12 report](forge-b12-qualification.md) and [release handoff](forge-release.md). The live campaign and its limits are recorded in [the B08 qualification report](forge-b08-qualification.md). The user's latest instruction governs this rebuild: use a clean, simple implementation for infrastructure and content that Ariax controls. This document replaces the historical Forge contracts.

**Implementation rules**

Use ordinary image tags and named model directories chosen by Ariax. Docker performs its normal pull. A completed download is moved into its final location, and a shared asset name identifies the weight directory reused by related tools. Successful download/extraction and the tool's actual execution establish whether content works.

Do not add image digest pins, asset checksums, request hashes, signed installation plans, content-addressed caches, deployment identity graphs, verification receipts, or per-command image/weight inspection. Do not implement old API or runtime compatibility, alternate transport paths, provider fallback, CPU fallback for GPU work, or automatic replay of scientific commands. A failed operation reports the actual error through its supported path.

Keep authentication and project authorization, workload isolation, path safety, durable command IDs, VM ownership records, bounded retries, and termination confirmation. These protect access, prevent duplicate execution, and release billable resources. Existing unrelated managed-job protocols retain their current behavior. Normal package management and Docker's own internals require no replacement implementation.

**Ownership and scope**

The backend owns account access, selected tools and priority, the broker allocation, existing instance billing, and the session lifecycle. The VM daemon owns command execution, the preparation queue, and file operations in its SQLite journal. The file service saves workspace checkpoints to project-scoped object storage. The CLI uses the existing public Next.js agent API, which authenticates the API key and forwards signed compute requests to the backend.

Use one full-VM runtime on Ubuntu with systemd, Docker, the NVIDIA driver/container runtime, writable local storage, and an outbound tunnel. Hyperstack and Vast have accepted full-VM adapters; Hyperstack is the default provider and new Vast admission remains disabled by default. Use on-demand single-GPU offers. An unavailable requested provider/GPU produces an error. An uncertain create is reconciled using its recorded ownership before any subsequent allocation attempt.

Keep all GHCR packages private. The backend receives `FORGE_GHCR_USERNAME` and a separate `FORGE_GHCR_READ_TOKEN` limited to package reads. Bootstrap writes standard Docker auth into `/etc/ariax-forged/docker/config.json`, with root-only directory/file modes 0700/0600. The daemon uses that directory through `DOCKER_CONFIG`. Registry credentials stay in protected host configuration. The backend issues temporary authorized model URLs when preparation needs them; grants remain in memory during transfer. Credentials and grant URLs stay outside workload mounts, public responses, logs, evidence bundles and Git.

The user requires image builds and qualification on remote GPU VMs. Stage source, fixtures, and model assets on those VMs and run Docker commands there through SSH. Keep the user's workstation free of image builds and treat its Docker daemon as outside the requirements for this campaign. Docker on each remote Forge VM supplies workload isolation and container execution.

Each repository uses its existing language and test tools. Coordinate changes to the shared API across backend, runtime and CLI. The current deployment requirements are in [the release handoff](forge-release.md); completed assignments are retained in [the history archive](forge-history.md).

**Public API**

Public routes are under `/api/v1/forge` on the existing CLI API origin. The matching private backend routes are under `/api/forge`. The Next.js routes use the existing agent route handler for API-key scopes/rate limits and the existing signed compute client. Extend its concrete route allowlist for Forge. CLI-facing private Forge handlers require signed compute authentication and use the existing project ownership helpers. The narrowly scoped runtime asset callback below authenticates the existing per-session token. Derive the actor from authentication; a foreign session returns 404. Do not add direct host credentials or an alternate backend URL mode to the CLI.

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

The CLI generates and persists `session_id` before sending. The backend creates one Forge project and job for that request, with the session ID also used as the job ID. Persist the project ID alongside it. Retrying the same session ID and request returns the existing session; changing its request returns 409. Compare stored validated fields directly. Creation of the project/job/session record must be atomic or use the existing durable admission mechanism so a lost response cannot duplicate work. The backend SQL integrates with the existing admission and billing paths.

`provider` defaults to `hyperstack`. `gpu_type` is required. `tools` defaults to an empty list for a base workspace. The base image is always included and is omitted from selection lists. Tool names are explicit catalog keys. Reject duplicates and unknown tool names. `priority` can name any subset of selected tools; append the remaining selected tools in their supplied order. Omitted priority uses selection order. `max_hours` is optional and positive when supplied; expiry counts from allocation. Duration caps and balance exhaustion terminate through the normal backend lifecycle.

`SelectTools` contains a UUID `selection_id`, `tools` and optional `priority` with the same ordering rules, and at least one tool. The CLI generates and saves the ID before dispatch. The backend persists the ordered selection independently of the immutable create request and delivers pending selections in order. The daemon records the ID and compares validated fields directly on redelivery. Repeating an ID observes its existing acceptance; changed fields return 409. Ready tools retain their running containers. Priority affects queued preparation without interrupting active work. A failed tool can be explicitly requested again with a new selection ID. Polling and redelivery of an existing selection never initiate that retry.

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

Daemon routes are `/health`, `/tools`, `/commands`, `/commands/{id}`, `/commands/{id}/logs`, `/commands/{id}/cancel`, and `/close`, using the methods and command payloads above. `/tools` GET returns `{"data": {"tools": [...]}}`; POST accepts `SelectTools`. `/health` returns `{"data": {"session_id": "...", "state": "available", "close_reason": null, "tools": [...], "active_command_id": null}}`. `/close` fences admission and confirms that command writers have stopped before attempting final sync. Its response contains `session_id`, `state`, and `persistence`. Local state can remain `closing` while image preparation finishes cancellation; `closed` confirms local work has stopped. The backend confirms provider-resource release before reporting public session state `closed`.

Every daemon route requires the per-session bearer token over the existing authenticated tunnel. Keep the daemon listening on loopback. Its root-only configuration is a single JSON file selected by `FORGED_CONFIG`, default `/etc/ariax-forged/config.json`:

```json
{
  "session_id": "11111111-1111-4111-8111-111111111111",
  "token": "generated-private-session-token",
  "data_dir": "/var/lib/ariax-forge",
  "catalog_path": "/etc/ariax-forged/catalog.json",
  "selected_tools": [],
  "control_plane_url": "https://compute.example",
  "expires_at": null
}
```

The backend creates the token with the existing secret-handling facilities and retains it only in private control-plane storage. Never include it in public responses, CLI logs, source, or workload environments. A host replacement gets a fresh token and is activated only after the old VM is confirmed terminated. Both the backend and daemon honor the configured expiry. HTTP failure does not prove VM loss or command failure.

Backend catalog example, with an illustrative object key:

```json
{
  "tools": {
    "base": {"image": "registry.example/ariax/forge-base:current", "gpu": false, "model_mounts": {}},
    "boltz2": {"image": "registry.example/ariax/forge-boltz2:current", "gpu": true, "model_mounts": {"boltz2": "/models/boltz2"}}
  },
  "assets": {
    "boltz2": {"object_key": "ariax-forge/science-models/boltz2.tar", "archive": "tar"}
  }
}
```

`tools` maps names to image tags and the named model assets they mount. Backend `assets` entries contain an `object_key` within the configured model bucket and `archive` (`tar` or `zip`). Deployment supplies this ordinary catalog file and the existing `MODEL_ARTIFACT_R2_*` storage settings. The host receives the same tool entries and an asset map containing only archive types. Use catalog names to share weights intentionally; each asset downloads/extracts once into `data_dir/models/{asset}`. Completed named assets are reused. There are no catalog version negotiations or digest fields.

The backend supplies `FORGE_CONTROL_PLANE_URL` as the daemon's configured HTTPS `control_plane_url`. Immediately before downloading an absent asset, the daemon calls `POST /api/forge-runtime/sessions/{session_id}/assets/{asset}/url` with its existing session bearer token. The backend authorizes that live session and an asset required by its selected tools, then issues an ordinary signed object URL with a lifetime bounded by the transfer window and session expiry. The exact callback route has its own session-authenticated middleware path. Parent storage and compute-signing credentials remain in the control plane. Queued work and late additions obtain fresh grants when preparation reaches them. A failed preparation requires an explicit new selection to retry; that attempt obtains a fresh grant.

The bootstrap creates state, inputs, workspace, scratch, and models directories under the configured data directory. Mount `/inputs` and model directories read-only. `/workspace` and `/scratch` are writable workload mounts. The daemon, SQLite journal, credentials, Docker socket, and host root remain outside workload access. Preserve the existing container/network isolation policy and protect against path traversal and unsafe archive extraction.

Base preparation runs first. Its readiness makes the host available while other selected tools prepare. Each science command requires its named tool to be ready. A pending restore keeps admission unavailable until its chosen files are restored.

**CLI command surface**

Use the existing CLI client, output conventions, errors, and atomic writer. The commands are:

```text
ariax forge create --name NAME --gpu GPU [--provider hyperstack] [--tools boltz2,bindcraft2] [--priority boltz2] [--max-hours 2]
ariax forge list
ariax forge status SESSION
ariax forge tools SESSION
ariax forge tools add SESSION --tools boltz2 [--priority boltz2] [--selection-id UUID]
ariax forge tools wait SESSION TOOL [--timeout SECONDS]
ariax forge run SESSION --tool TOOL [--cwd /workspace] [--timeout-seconds 3600] -- COMMAND ARG...
ariax forge commands SESSION
ariax forge command SESSION COMMAND_ID
ariax forge watch SESSION COMMAND_ID [--timeout SECONDS]
ariax forge logs SESSION COMMAND_ID [--tail 1000]
ariax forge cancel SESSION COMMAND_ID
ariax forge close SESSION
```

Support existing global JSON output. Wait/watch timeouts end local waiting and retain the remote operation. Save a small request record under `.ariax/forge/{id}.json` containing its ID, API origin, actor, method/path/body, and the latest known result. Reuse/export the existing atomic writer and account lookup. The managed-job operation format includes request hashes and compatibility checks, so leave that format untouched and keep Forge's record plain. Do not build another journal framework. Expose explicit `--session-id` on create, `--command-id` on run and `--selection-id` on tools add for retry/recovery. A retry must use the same saved request and account. Return the IDs promptly so an agent can continue later.

The file command surface is specified below. Local acceptance exercises the installed CLI through the public API and preserves existing managed-job command behavior.

**Verification and handoff**

Reuse meaningful existing tests. Exercise public paths with provider/Docker boundaries substituted when local execution requires it. Cover duplicate submission and lost acknowledgments, restart reconciliation, cancellation, unauthorized access, and cleanup after host failure. Avoid source-inspection tests, schema snapshot matrices, and tests that only assert configured mocks.

Record the changed behavior, relevant test results and remaining qualification limits with each change. The completed [B12 campaign](forge-b12-qualification.md) supplies live GPU, provider and lifecycle evidence. New workloads and production rollout follow the current user-authorized scope.

**Tool preparation and shared assets**

The integrated implementation passed local and live staging acceptance. Read [the release handoff](forge-release.md) before deployment.

Each tool retains `image`, `gpu`, and `model_mounts`. The current backend catalog uses `object_key` and `archive` for assets, and the daemon obtains temporary download URLs through the runtime callback described above. The selected tool order at bootstrap is already the desired priority. Later `SelectTools` requests prioritize the named selected tools and retain other selections. One durable queue prepares base first, then scientific tools. Ready tools remain usable while the queue works. Published named assets remain read-only. An asset that is complete at its final path is reused directly. Unsafe archive entries and incomplete transfer are failures; there is no checksum or digest protocol.

The runtime repository supplies `science/catalog.json`, image build contexts, and native fixtures. The image must expose its documented executable on PATH because Forge passes argv directly. Model paths in native commands must agree with the catalog mount destinations. The tool keys are `base`, `ipsae`, `boltz2`, `bindcraft2`, and `freebindcraft`; base and ipSAE use CPU, and the other tools use GPU. A base workspace contains a POSIX shell and Python 3. Science guides live under `agent-skills/skills/ariax-forge/tools/`. The qualification reports record private publication and native execution.

**Public file API**

All paths below have the existing public prefix `/api/v1/forge`; the backend uses `/api/forge` with signed compute authentication. Keep the normal data/error envelopes. UUID operation IDs are durable and compare validated fields directly. Repeating an accepted ID observes that operation; different fields produce 409. Foreign sessions, source projects, inputs, and checkpoints return 404. Every operation authorizes the destination session, and imported/restored data also authorizes its source.

`path` in an input request is a relative POSIX file path within `/inputs`, such as `targets/target.yaml`. Reject absolute paths, empty/dot/traversal components, backslashes, NULs, symlink traversal, and destinations outside that root. Imports create regular files. A published destination cannot be overwritten. Enforce configured transfer size/time limits. The file service enforces its documented transfer limits.

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

The daemon exposes `/inputs`, `/inputs/{input_id}`, `/checkpoints`, `/checkpoints/{checkpoint_id}`, and `/restore` endpoints over the existing bearer-authenticated tunnel. They use the operation IDs and status records above. The backend supplies validated transfer locations and temporary project-scoped grants through private request fields. Public callers cannot choose bucket prefixes or submit those grants. The backend and runtime share these private transfer structures. `/health` and `/close` gain the existing public-shaped `persistence` object without secrets. A pending restore keeps health at `starting` and command admission unavailable.

Use the existing project-scoped R2 credential facilities with an ordinary storage client. Never send parent credentials to the VM. Temporary credentials remain outside workloads and last only for bounded transfers. Existing authentication signing is retained. The prohibition on new content hashes does not replace standard SDK/authentication internals. Runtime storage uses `boto3`; the backend uses its existing botocore client.

Close fences command admission and stops workspace writers. Its handler shares a sixty-second deadline across that stop and the final checkpoint. Image preparation can finish cancellation while the checkpoint saves workspace bytes. Expiry stops local work and permits a final sync of up to sixty seconds. The controller bounds close at seventy seconds including transport and bookkeeping. Resource cleanup continues when storage or the host is unavailable. Preserve the last completed checkpoint and report any durability gap in `persistence.error`; public session `closed` confirms resource release.

File recovery runs after successful acquisition of the existing daemon lock and before preparation or watchers start. Constructing a second app leaves active transfer state untouched. The file service keeps its tables in the existing SQLite database. Lifecycle hooks are part of the integrated runtime.

**File CLI surface**

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

Forge reference dispatch and guide indexes expose `outputs` and the five native tools through both platform aliases. The CLI discovers additional scientific references from its packaged skill directories. The Forge platform guide describes the public workflow; each tool guide describes its native inputs, invocation, output inspection, and qualification status.

**Design-tool assets**

Both design tools use the named asset `alphafold2`, mounted read-only at `/models/alphafold2`. Its archive root contains `LICENSE` and fifteen native parameter files: `params_model_N.npz`, `params_model_N_ptm.npz` and `params_model_N_multimer_v3.npz`, for N from 1 through 5. There is no enclosing directory in the archive. These filenames preserve the retained FreeBindCraft asset layout and include the models used by the accepted BindCraft2 runtime. Use the native NPZ contents from the maintained upstream/Ariax assets. Successful preparation, loader access and native GPU execution supply the acceptance evidence. Weights stay outside image layers. Configure `BINDCRAFT_AF2_PARAMS=/models/alphafold2` for BindCraft2 and wire the FreeBindCraft loader to the same mounted directory through its native path setting or ordinary image path wiring. Report any source-level format mismatch before changing this shared boundary.

Keep the small tool-specific ProteinMPNN weights with their recipe or a separately named ordinary asset if the native package requires it; do not mix them into `alphafold2`. Use scratch for compilation/cache writes. Recipe targets are private tags `ghcr.io/cytokineking/ariax-forge-bindcraft2:b09` and `ghcr.io/cytokineking/ariax-forge-freebindcraft:b09`. Preserve native tool versions and behavior supported by the maintained sources; the historical deployment wrappers and content-verification machinery remain reference material. Native option/format contracts must be stated in the recipe notes before guides depend on them. FreeBindCraft's bounded reference case uses its explicit native OpenMM/PyRosetta-free mode with GPU relaxation. CPU relaxation or an automatic fallback is outside this contract.

**Vast admission and supported hosts**

Vast uses public provider name `vastai`, on-demand full-VM offers and the existing instance ownership/billing machinery. Keep the current catalog and session shape. Provider dispatch is explicit, with no automatic fallback. Use the server-only `FORGE_ENABLE_VASTAI` switch, default false, to gate new Vast session admission. Its live qualification passed; production enablement remains part of the rollout decision. Existing persisted Vast sessions must continue reconciliation and cleanup when the switch is false. Lost allocation acknowledgment must recover the recorded owned VM before any subsequent allocation. The adapter must establish full-VM eligibility, SSH address/user/port, driver/Docker readiness and confirmed deletion using actual provider fields. Keep provider-specific details inside the small adapter and existing host/lifecycle boundaries. Production deployment remains separate.

The installer supports Ubuntu 22.04 and 24.04 hosts with managed Python 3.12. Verify a real amd64 VM, systemd, one supported NVIDIA GPU and suitable local storage. Query actual Docker/containerd inventories before changing storage. Unknown inventory or existing workload data stops installation before mutation. Preserve existing stores. Keep Vast admission disabled until the production rollout enables it.

**Qualification and release**

The approved implementation and live staging gates passed. Both supported Ubuntu versions passed the managed installer. Durable tool selection, fresh model grants, native execution on Hyperstack and Vast, cross-provider byte restoration, controller/runtime recovery, cancellation, normal-worker credit exhaustion and expiry all completed with billing and resource cleanup verified. The original B11 close trigger remains historically unexplained. The default Vast admission switch remains false; production rollout is separate. The [B12 report](forge-b12-qualification.md) retains failed preparation, the rejected first Vast FreeBindCraft trajectory, the explicit additional native attempt and final cleanup evidence.
