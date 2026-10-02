**Forge next turn: installation, files, and reference tools**

Prepared October 2, 2026. B02–B04 are accepted and integrated. B06 and B07 can start together. B05 can run alongside them within the three-worker limit; all three must finish before B08. The next turn prepares the shared boundaries, dispatches separate GPT-6.1 chats at xhigh, and reviews their work. This turn prepared the handoff and integrated the completed work.

**Accepted starting point**

All three workspaces below use `codex/forge-v2-integration`. Each was fast-forwarded to the reviewed worker commit. The primary checkouts and their unrelated work remain intact.

| Repository | Integration workspace | Accepted implementation commit |
|---|---|---|
| Backend | `/Users/aaronring/.codex/worktrees/forge-v2-integration/Ariax-Bio-Backend` | `d9e7ec80d584d5a443b3a5288109a649a9074cf9` |
| Runtime | `/Users/aaronring/Forge-rebuild/2026-10-01/forged` | `da82d712f735621223b16a68c3009223b5d9a8d7` |
| CLI | `/Users/aaronring/Forge-rebuild/2026-10-01/cli` | `44ea62d307235442b68b32fb9c305ef328c251a8` |

Documentation commits may follow these implementation commits. Record the actual integration HEAD in each dispatch. Git commits identify the reviewed source; the runtime continues to use ordinary image tags and named assets.

The final independent check passed 229 backend tests and all seven audit cases. Confirmed provider rejection now reaches `failed`, clears the unaccepted allocation, and leaves no sweep entry. Delayed accepted allocation still retains ownership until cleanup. The joined CLI/public proxy/signed backend/daemon flow passed with real PostgreSQL, Redis, and SQLite. Runtime coverage previously passed 23 cases, while CLI coverage passed 531 cases and installed-package checks. Provider, SSH, tunnel, and Docker operations were substituted in local integration. Live VM/GPU qualification remains B08.

The [audit](forge-worker-audit-2026-10-02.md), [contract](forge-contract.md), and [full sequence](forge-rebuild-plan.md) provide the supporting record. Independent final logs are `/private/tmp/forge-b03-final-backend.log` and `/private/tmp/forge-b03-final-probes.log`.

**First actions next turn, owned by the orchestrator**

1. Read this plan and the contract. Check integration HEADs and working-tree status. Preserve concurrent changes. The worker worktrees used by the audit still contain its executable fixtures; retain them until the joined harness has been moved onto the integration workspaces.
2. Add the B05–B07 boundary decisions below to `docs/forge-contract.md`, copy that document to runtime and CLI, and commit the dispatch preparation. Update each integration `AGENTS.md` to refer to the current bite brief instead of its old B02/B04 brief. Approve any needed dependency changes here so two workers cannot edit the same package manifest.
3. Create distinct worktrees from those integration commits. Use one separate chat per bite, GPT-6.1 at xhigh. Give each chat its actual writable paths and base commits. B06 owns three worktrees in one chat; B07 owns two. Existing projectless-chat dispatch can be used for runtime-led work when the runtime is absent from saved projects. Backend work uses a managed worktree where available.
4. Dispatch B05, B06, and B07. Three concurrent workers is the limit. Each worker reads the common contract and its brief, commits its own changes, and reports tests and remaining gates. Workers do not create additional chats, rent compute, publish images/packages, or deploy.

Suggested branches are `codex/forge-v2-b05-installation`, `codex/forge-v2-b06-files`, and `codex/forge-v2-b07-recipes` in their respective repositories. Record the assigned directories in each chat. Existing unrelated worktrees remain outside this wave.

**File ownership for parallel work**

| Owner | Writable implementation area |
|---|---|
| B05 | Runtime `forged/installer.py`, `forged/assets.py`, existing `runtime.py`, `store.py`, `models.py`, and `docker_runtime.py`; installation/runtime tests. |
| B06 | Runtime `forged/inputs.py`, `forged/storage.py`, `forged/file_api.py`, `app.py`, `config.py`, and `paths.py`; focused file-flow tests. Backend Forge file routes/services, public proxy routes, its required SQL, and bounded lifecycle/storage hooks. CLI Forge file commands, arguments/help, and file-flow tests; platform guide and `outputs.md`. |
| B07 | Runtime `science/` recipes, catalog, small native fixtures, and recipe validation. CLI `agent-skills/skills/ariax-forge/tools/{base,ipsae,boltz2}.md` and their examples. |
| Orchestrator | Shared contract, repository instructions, dependency manifests, skill-reference dispatch in `src/commands/skills.js`, common skill indexes, and any cross-bite glue. |

B05 keeps the existing `/tools` handler shape, so it need not edit `app.py`. B06 implements file routes and storage through its own modules; changes it needs inside B05-owned runtime lifecycle code return as a small integration patch for the orchestrator. Workers can exercise those modules through the real app in their own worktrees. Final expiry/close wiring is tested after integration. B07 adds tool guides under the existing Forge platform rather than changing managed-job protocol names. The orchestrator links those guides and enables `ariax skills forge --reference ...` during integration.

A new shared-file need returns to the orchestrator before editing. Keep the ownership split practical: a small explicit call at integration is sufficient; it does not justify a plugin framework or a generic event system.

**B05 brief: priority preparation and shared assets**

Implement one durable preparation queue in the existing SQLite journal. Use the selected-tool order supplied at bootstrap and the existing `SelectTools` priority field for later additions. Preserve ready tools and ongoing commands when selection changes. Explicit selection retries a failed tool; polling only observes it. Base readiness makes the session available while scientific tools prepare.

Use Docker's normal image pull. For each named asset, download/extract into a private temporary location, then atomically publish its completed directory. Reuse the final named directory for tools that declare the same asset. The directory remains read-only to workloads. Set readable permissions explicitly under the daemon's `0077` umask. Reject unsafe archive members and paths. An interrupted installation may restart the unfinished transfer after restart; completed shared assets remain available. Close and expiry stop accepting installation work and bound background activity.

Here, immutable means a published model directory is not modified beneath a running tool. The user prohibits added checksums, image digest pins, content-addressed stores, request hashes, signed install plans, compatibility paths, and fallback machinery. Keep those constraints. Model upgrades, uninstall, and garbage collection stay deferred.

Reuse runtime HTTP/SQLite coverage. Extend it to show a ready command can run while another tool installs or fails, two tools reuse one downloaded asset, and interruption cannot publish a partial directory. Test queue priority and explicit retry through observable tool states. B05 can use tiny local archives and a stateful Docker boundary; it does not depend on B07's large scientific assets to prove orchestration.

Finish with a runtime commit, test results, and any exact shared-file glue needed. The real scientific run remains part of B08.

**B06 brief: inputs, checkpoints, and restore**

Implement the complete user path across the CLI, public API, backend, and daemon. Start with the base tool, so B06 can make progress independently of B05 and B07. Support a local file, an authorized existing Ariax artifact, and an individual HTTPS/presigned S3 object. Stage each input at an explicit safe path under read-only `/inputs`. A completed input cannot be overwritten under the same destination. Keep `/workspace` writable and `/scratch` disposable.

The current `/api/v1/uploads/init` accepts managed PDB/CIF submissions and must retain that behavior. Add a Forge-specific upload-intent route for arbitrary input files, reusing the existing presigning and authorization helpers. Upload bytes directly to the authorized object-storage location. Import an uploaded object only after a completed transfer is established. Prior-artifact imports must authorize the source project as well as the destination session. User URL imports retain public-network/redirect checks and path limits. Keep signed URLs and credentials out of request logs and ordinary persisted CLI records.

Use the existing project-scoped R2 credential facilities and normal storage clients. Parent credentials remain in the control plane. Temporary grants last only for bounded transfers and remain outside workload mounts. Avoid adding a second credential service. Customer S3 account connections, bucket browsing, and recursive remote discovery remain deferred.

The boundary to settle before dispatch is:

| User action | Public API and CLI shape |
|---|---|
| Upload a local input | A Forge session-scoped upload-intent route returns a scoped PUT URL; `ariax forge inputs add SESSION --file FILE --path PATH` uploads then requests import. |
| Import a remote input | `POST /sessions/{id}/inputs` and `GET /sessions/{id}/inputs`; CLI `inputs add` accepts either `--artifact PROJECT_ID:PATH` or `--url URL`, plus the destination path. A durable input ID makes repeated acceptance harmless. |
| List/download files | `GET /sessions/{id}/files` and a scoped download/presign route; CLI `files SESSION` and `download SESSION PATH --dest LOCAL`. Downloads state which completed checkpoint supplies workspace bytes. |
| Save workspace | `POST /sessions/{id}/checkpoints`, checkpoint status/list routes, and `ariax forge sync SESSION --wait`. Start returns promptly; waiting polls a durable checkpoint ID. |
| Restore | Extend ordinary session creation with an authorized source session/checkpoint, exposed as `create --restore-session SOURCE --checkpoint ID`. Restore into the new session before command admission; reuse current create idempotency and billing. |

All public paths retain the `/api/v1/forge` prefix and existing signed compute path. Freeze the small request/response models and daemon counterparts before workers start. Keep file-byte transfer separate from JSON API responses. Add only the schema required for input records, checkpoints, and durable persistence status.

A checkpoint publishes its file index only after all referenced bytes are durable. Use file size/mtime metadata to avoid rereading unchanged files, retain stable file versions, and detect writes during copying. A changing file leaves the operation pending or failed with a clear reason. Preserve the previous completed checkpoint through failed uploads. The index records the files present, so restore respects deletion. Use ordinary IDs and object keys without introducing content hashes. Save staged-input references needed by the restored workspace; never restore credentials, command journals, scratch, or model caches. Restoration prepares files for explicit future commands and does not replay commands.

Persist the latest checkpoint/status in the backend so it remains queryable after the VM disappears. `closed` continues to mean resources were released. `persistence` separately reports whether a final checkpoint succeeded. Close/expiry stops commands and allows a bounded final sync; storage failure must not trap a billable VM. The first implementation uses a 60-second final-sync budget, while explicit sync can use a longer bounded operation. Coordinate the daemon response and controller timeout so the final attempt has that full budget. An unreachable host yields an explicit durability gap while provider cleanup continues.

Use one joined application scenario to upload, import, execute a base command, checkpoint, modify/delete a file, checkpoint again, close, and restore the chosen checkpoint into a new session. Verify file contents, deletion, source/destination authorization, safe paths, and access as the workload UID. Add failure branches for a write during checkpoint and storage failure during closure. Substitute object storage/provider/Docker boundaries where required; keep real HTTP handlers, databases, and CLI execution. These tests protect data loss, access outside the workspace, and billable-resource leakage. They must exercise outcomes beyond configured mocks.

Finish with commits for each owned repository and instructions for the orchestrator's small runtime glue. Keep backend SQL ownership in this chat and exercise the migration in disposable PostgreSQL.

**B07 brief: base, ipSAE, and Boltz2**

Create the reference `science/` catalog and image recipes for base, ipSAE, and Boltz2. Use ordinary Ariax image tags and named assets matching the existing catalog fields. Keep the base image small enough to supply the documented shell/Python file workflow. Separate the tool image from model assets. Review historical source under the retained Forge archive tags and verify native flags against the tool's official source before writing the guides.

Provide a tiny base case, an ipSAE fixture with inspectable expected output, and a bounded Boltz2 input with its native command and expected output files. Document scientific settings and how to inspect outcomes. Each guide includes readiness, inputs, command, output paths, and the checks that distinguish command completion from usable scientific results. GPU work uses the GPU path. The maintained deployment catalog contains only supported recipes with actual asset locations; placeholders belong in examples and must remain visibly unqualified.

Build and run available local CPU/image checks. Docker was unavailable during the preceding audit, so record any blocked image-build/native check precisely. Image publication and live GPU execution are orchestrator tasks at the B08 gate. Recipe code and fixtures can be reviewed while that infrastructure is prepared; a recipe without a successful build/native run remains unqualified. Additional tools and variants stay outside B07.

Finish with runtime and CLI commits, native commands, build status, and the small inputs needed for B08. Do not copy the historical evidence archive into the new implementation.

**Integration and the path through B11**

Integrate B05 first to settle runtime preparation, then B06 and its lifecycle hooks. B07's science files and tool guides can merge independently. The orchestrator handles contract or shared-file differences and adds skill-reference wiring. Run existing suites affected by those changes, then extend the joined workflow to exercise partial tool readiness, imported data, a successful checkpoint, restore, and cleanup. Repeat passing checks only after a relevant change or failure.

B08 begins after all three bites pass local acceptance and the reference images/assets are available. Its serial gate first runs the complete installed-CLI workflow, then one bounded Hyperstack pilot with real containers, GPU execution, native output inspection, storage, and confirmed VM/tunnel cleanup. Record startup/transfer time and cost from that campaign. B08 is where the current cloud/Docker substitutions are removed.

After B08 passes, B09 adds BindCraft2/FreeBindCraft recipes and their shared AF2 assets. B10 adds the Vast full-VM adapter in parallel. B11 qualifies each advertised scientific/provider combination and its lifecycle behavior. Hyperstack release readiness depends on B09; advertising Vast also requires B10 and its qualification. Wider tools, custom installation, multi-GPU scheduling, warm pools, snapshots, and migration remain deferred.

**Next-turn instruction**

Resume from this plan. Prepare and commit the shared B05–B07 boundaries, create isolated worktrees from the three integration branches, and launch separate GPT-6.1 xhigh chats for B05 installation, B06 files/persistence/restore, and B07 reference recipes/guides. Keep at most three workers active. Review and integrate their results through the acceptance checks above. Stop before renting compute or publishing/deploying for B08 so its concrete campaign can be reviewed.
