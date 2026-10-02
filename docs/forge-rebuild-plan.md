**Forge rebuild and worker plan**

Updated October 2, 2026. B00–B04 are complete within their assigned scopes, and B02–B04 have been integrated after independent audit and correction. The [implementation contract](forge-contract.md) is authoritative. The [next-turn plan](forge-next-turn-plan.md) prepares B05, B06, and B07 for parallel work.

Ariax provisions on-demand full VMs and runs workloads in Docker. The initial tools are Boltz2, BindCraft2, FreeBindCraft, ipSAE, and a base workspace. Hyperstack is the reference provider. Vast full VMs follow after the first integrated pilot. User-supplied hosts and custom tool installation are outside this release.

**Simplicity requirements**

Ariax controls the deployed images and weights. Use ordinary image tags and named assets. Share weight directories by their declared asset names, and publish completed downloads with an atomic move. Docker handles image transfer. Ready tools remain usable while other tools prepare.

The implementation has one current API and runtime format. It contains no artifact checksums, digest pins, request hashes, content-addressed cache, deployment identity graph, compatibility adapters, fallback transports, provider fallback, or automatic scientific replay. Keep ordinary authentication, authorization, isolation, direct request comparison, command journaling, owned-resource reconciliation, and billing cleanup.

The backend owns desired session state and the VM lifecycle. SQLite on the VM owns commands and the future preparation queue. The CLI uses the existing public agent API. A ready tool, a completed command, and a durable output checkpoint have separate statuses.

**B00: source preservation and cleanup**

Private archives live at `/Users/aaronring/Forge-rebuild/2026-10-01/archive`. Git bundles include the retained Forge tips and stashes. Each existing worktree's tracked changes and relevant untracked files were restored into a temporary checkout and compared with the source before branch retirement.

| Repository | Starting point and preservation |
|---|---|
| Backend | Fresh `origin/main` is `54636bc`. Existing AGENTS/frontend WIP and the other chat's banner worktree remain intact. Nine obsolete local Forge branches were archived and retired. |
| CLI | The two original directories share one Git repository. Fresh main is `638457a`. The primary checkout's BindCraft2/input/skill WIP remains intact. Three obsolete Forge branches were archived and retired; enumerated `.DS_Store` files were removed and excluded locally. |
| Runtime | The new integration worktree starts from the later runtime source at `84676af`. Four obsolete local branches were archived and retired; four registrations for missing temporary worktrees were pruned. The original snapshot checkout remains a preserved source location. |

Backend and CLI integration begin on current main. Runtime cleanup is an ordinary commit preserving the full history. Old modules, recipes, and qualification evidence remain recoverable from archive tags and Git bundles. No production schema or cloud resource is changed by this cleanup.

**B01: contract and seed**

The orchestrator settles the public API, private daemon API, simple catalog format, state ownership, and worker boundaries in `docs/forge-contract.md`. The runtime starts with a small authenticated health service and one configuration format. It reports `starting` until B02 adds command execution. The backend receives request models; B03 supplies its sole new Forge migration and the normal public API wiring. The existing CLI remains runnable while B04 adds Forge.

Each worker receives the same contract and the user's repository/testing instructions. Historical source is available for selected behavior and regression cases. The old runtime and deployment machinery are removed from the active seed so workers implement the current contract directly.

**Bites and dependencies**

| Bite | Outcome | Starts after |
|---|---|---|
| 00 | Preserve source and establish clean workspaces | First, orchestrator |
| 01 | Settle contracts and prepare the seed | 00, orchestrator |
| 02 | Daemon, command recovery, container isolation, bootstrap | 01, runtime worker |
| 03 | Backend lifecycle, public API proxy, billing, Hyperstack, cleanup | 01, backend worker |
| 04 | CLI commands, request records, platform skill | 01, CLI worker |
| 05 | Priority preparation queue and shared named model assets | 02 |
| 06 | Local/Ariax/S3 input import, durable workspace, restore | 02–04 |
| 07 | Base/ipSAE/Boltz2 images, native cases, skills | 01 when a slot opens |
| 08 | Integrated user workflow and one live Hyperstack pilot | 03–07, orchestrator gate |
| 09 | BindCraft2/FreeBindCraft recipes, shared AF2 assets, skills | 08 |
| 10 | Vast full-VM adapter | 08 |
| 11 | Scientific and lifecycle release qualification | 09, plus 10 for Vast |

B02, B03, and B04 run in separate chats and worktrees using GPT-6.1 at xhigh. At most three implementation workers run together. B05, B06, and B07 can subsequently overlap under their dependencies. B09 and B10 run in parallel after the Hyperstack pilot. The orchestrator owns integration and all live VM runs.

**Acceptance for the current workers**

B02 must exercise actual HTTP handlers and a durable command store with Docker substituted at the external boundary when needed. Cover one execution after a lost acknowledgment, restart reconciliation, cancellation, and uncertain GPU ownership. Protect workload mounts and network access. Bootstrap follows one supported Ubuntu/full-VM path with systemd and a loopback daemon behind the existing tunnel. GPU execution is qualified in B08.

B03 must use the real application path for session creation, authorization, lifecycle, credit admission, and cleanup, substituting provider calls where necessary. A lost allocation response must not allocate another VM. Closing an unreachable runtime must still release its owned resource and update the existing billing path. The Next.js API-key boundary forwards signed requests to private backend routes through current helpers. Do not create a second billing system.

B04 must exercise the installed CLI against an HTTP boundary. Preserve create/run request IDs after lost acknowledgments; allow explicit recovery with the same stored request. Wait/watch timeouts end local waiting. Add a platform skill that explains tool readiness and deferred file support. Existing managed-job commands keep their current behavior.

Full briefs are in `docs/forge-worker-b02.md`, `docs/forge-worker-b03.md`, and `docs/forge-worker-b04.md`.

**Later acceptance gates**

B05 proves that tool A runs while B installs or fails, and that named shared assets are downloaded/extracted once. Successful transfer and atomic publication protect incomplete downloads. Keep one queue and bounded concurrency. A readiness record describes installed tools; it is not an identity-verification protocol.

B06 provides immutable staged inputs, writable `/workspace`, and disposable `/scratch`. `sync --wait` confirms a completed checkpoint containing stable file versions. Changed-file detection avoids rereading every unchanged output. Restore respects deletion. Expiry and cleanup use a bounded final sync and report any durability gap.

B07 builds only the reference tool set and pairs each tool with its native cases and skill. B08 drives the installed CLI through import, partial readiness, execution, persistence, restore, and close using the actual backend and daemon. Then one bounded Hyperstack run proves native GPU execution and verified resource cleanup. Record useful startup and transfer measurements.

B09 builds the design tools and prepares their native cases for B11. Share AF2 by the maintained asset name and expected format. B10 adds only the Vast adapter and tests its ownership/cleanup behavior. B11 runs the advertised tool/provider combinations, cancellation and recovery cases, and records costs and cleanup. A provider remains unavailable until its gate passes.

**Scope deferred**

- Broader tools and model variants: Foundry and Protenix v2 first, then BoltzGen/PXDesign, followed by individual Genie/OpenDDE/OpenFold bites.
- Multi-GPU jobs and concurrent GPU commands.
- Live upgrades, uninstall, and cache garbage collection.
- Suspension, live migration, resizing, and automatic command replay.
- Customer S3 account connections and bucket browsing; individual presigned objects remain supported.
- Browser terminals, notebooks, warm pools, provider snapshots, cross-VM caches, and custom transfer optimization.

**Orchestration**

Maintain one integration branch per repository. Record each worker's accepted base commit and writable paths, review the resulting diff, and run proportionate checks before integration. Reuse existing integration coverage and add only cases that protect a concrete plausible failure. Shared-contract changes return to the orchestrator. Keep handoffs to commits, test results, and remaining issues.

Workers finish their assigned bite without starting further chats, renting VMs, publishing artifacts, or deploying. Their worktrees are archived after accepted changes are recoverable. Live qualification uses one bounded campaign at a time with cleanup completed before a revised attempt.
