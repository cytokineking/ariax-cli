**Forge implementation contract**

Accepted for bites 01–04 on October 1, 2026. The user's latest instruction governs this rebuild: use a clean, simple implementation for infrastructure and content that Ariax controls. This document replaces the historical Forge contracts.

**Implementation rules**

Use ordinary image tags and named model directories chosen by Ariax. Docker performs its normal pull. A completed download is moved into its final location, and a shared asset name identifies the weight directory reused by related tools. Successful download/extraction and the tool's actual execution establish whether content works.

Do not add image digest pins, asset checksums, request hashes, signed installation plans, content-addressed caches, deployment identity graphs, verification receipts, or per-command image/weight inspection. Do not implement old API or runtime compatibility, alternate transport paths, provider fallback, CPU fallback for GPU work, or automatic replay of scientific commands. A failed operation reports the actual error through its supported path.

Keep authentication and project authorization, workload isolation, path safety, durable command IDs, VM ownership records, bounded retries, and termination confirmation. These protect access, prevent duplicate execution, and release billable resources. Existing unrelated managed-job protocols retain their current behavior. Normal package management and Docker's own internals require no replacement implementation.

**Ownership and scope**

The backend owns account access, selected tools and priority, the broker allocation, existing instance billing, and the session lifecycle. The VM daemon owns command execution and its SQLite journal. Bite 05 adds its installation queue. Bite 06 adds file import and durable output storage. The CLI uses the existing public Next.js agent API, which authenticates the API key and forwards signed compute requests to the backend.

Use one full-VM runtime on Ubuntu with systemd, Docker, the NVIDIA driver/container runtime, writable local storage, and an outbound tunnel. Hyperstack is the sole implementation in bite 03. Vast is a separate later adapter. Use on-demand single-GPU offers. An unavailable requested provider/GPU produces an error. An uncertain create is reconciled using its recorded ownership before any subsequent allocation attempt.

Each repository uses its existing language and test tools. B02 owns the runtime code and bootstrap. B03 is the sole writer of new backend Forge routes, services, database migration, the thin Next.js agent API proxy, and necessary shared wiring. B04 owns the CLI Forge commands, dispatch, request records, and platform skill. Changes to this contract need orchestrator review before other workers consume them.

**Public API**

Public routes are under `/api/v1/forge` on the existing CLI API origin. The matching private backend routes are under `/api/forge`. The Next.js routes use the existing agent route handler for API-key scopes/rate limits and the existing signed compute client. Extend its concrete route allowlist for Forge. Private Forge handlers require signed compute authentication and use the existing project ownership helpers. Derive the actor from authentication; a foreign session returns 404. Do not add direct host credentials or an alternate backend URL mode to the CLI.

Successful JSON responses use `{"data": ...}`. Public errors use the existing `{"error": {"code": "...", "message": "...", "retryable": false}}` envelope and normal request metadata. Use 422 for invalid input, 409 for conflicting request IDs, a busy GPU, or an unready tool, and 503 when the host cannot be reached. Runtime errors use `{"error": {"code": "...", "message": "..."}}`.

| Method and path | Request and result |
|---|---|
| `GET /catalog` | Public tool metadata: `{"tools": [{"tool": "base", "name": "Base workspace", "gpu": false}]}`. Include only configured supported tools. |
| `POST /sessions` | `CreateSession` below. Persist acceptance before queueing allocation; return 202 and a session. |
| `GET /sessions/{session_id}` | Return the session. |
| `GET /sessions` | Return `{"sessions": [...]}` for the authenticated actor, newest first, bounded to the most recent 100. |
| `POST /sessions/{session_id}/tools` | `SelectTools` below. Return 202 and current session/tool states. Installation belongs to B05; until it exists return an explicit unavailable error for additions that need it. |
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

The persistence fields reserve the B06 boundary. Until storage is implemented they remain `pending` with a null checkpoint. They must never imply that unsynced files are durable. Future values are `syncing`, `synced`, and `failed`, with a simple checkpoint identifier unrelated to file hashes.

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

Daemon routes are `/health`, `/tools`, `/commands`, `/commands/{id}`, `/commands/{id}/logs`, `/commands/{id}/cancel`, and `/close`, using the methods and command payloads above. `/tools` GET returns `{"data": {"tools": [...]}}`; POST accepts `SelectTools`. `/health` returns `{"data": {"session_id": "...", "state": "available", "tools": [...], "active_command_id": null}}`. `/close` returns `{"data": {"session_id": "...", "state": "closed"}}` after local command admission is closed and containers are stopped. Backend resource termination remains independent of the daemon's response.

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

`tools` maps names to image tags and the named model assets they mount. `assets` maps those names to Ariax-controlled download locations. The catalog is deployed as an ordinary file. The backend reads the same format to validate selection, then copies the intended catalog to the host. Use catalog names to share weights intentionally; each asset downloads/extracts once into `data_dir/models/{asset}`. Bite 05 implements that path. There are no catalog version negotiations or digest fields.

The bootstrap creates state, inputs, workspace, scratch, and models directories under the configured data directory. Mount `/inputs` and model directories read-only. `/workspace` and `/scratch` are writable workload mounts. The daemon, SQLite journal, credentials, Docker socket, and host root remain outside workload access. Preserve the existing container/network isolation policy and protect against path traversal and unsafe archive extraction.

B02 implements base-image preparation and command execution. Missing science preparation returns a clear unready-tool response until B05 is integrated. The seed's `/health` reports `starting`; it must not claim execution readiness before B02 adds the real runtime.

**CLI surface for B04**

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

File commands belong to B06. Keep their deferred status clear in the platform skill. B04's local tests should exercise the installed CLI against an HTTP boundary and preserve existing managed-job command behavior.

**Verification and handoff**

Reuse meaningful existing tests. Exercise public paths with provider/Docker boundaries substituted when local execution requires it. Cover duplicate submission and lost acknowledgments, restart reconciliation, cancellation, unauthorized access, and cleanup after host failure. Avoid source-inspection tests, schema snapshot matrices, and tests that only assert configured mocks.

Workers commit their bite in their own worktree and finish with changed files, test results, and remaining integration needs. Do not create additional worker chats, rent VMs, publish artifacts, or deploy during B02–04. The orchestrator reads worker progress and integrates accepted work. Live GPU qualification belongs to B08.
