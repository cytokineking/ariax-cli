# Forge next bites: design tools and Vast full VMs

Updated October 2, 2026. B08 passed the remote build and Hyperstack campaign recorded in [the qualification report](forge-b08-qualification.md). Continue from the three `codex/forge-v2-integration` workspaces. The orchestrator owns shared contracts, integration and live qualification. Reuse the existing GPT-6.1 xhigh worker chats, with at most three workers active.

## Accepted starting point

| Repository | Integration workspace |
|---|---|
| Backend | `/Users/aaronring/.codex/worktrees/forge-v2-integration/Ariax-Bio-Backend` |
| Runtime | `/Users/aaronring/Forge-rebuild/2026-10-01/forged` |
| CLI | `/Users/aaronring/Forge-rebuild/2026-10-01/cli` |

Check each branch and working tree before dispatch. Preserve the existing worker branches and unrelated primary-checkout work. The [contract](forge-contract.md) governs behavior, and [the earlier audit](forge-worker-wave2-audit-2026-10-02.md) retains the local review history. Current implementation commits and campaign evidence are in the B08 report; documentation commits can follow them.

Base, ipSAE and Boltz2 have passed their remote image checks and the installed-CLI workflow on fresh Hyperstack VMs. The campaign exercised partial readiness, private pulls, scoped input transfers, native GPU execution, checkpoint versions, deletion, download after close and restore. Billing and resource cleanup were verified. Its control plane used disposable Supabase services; production deployment remains a separate release step.

All image builds and image qualification run on remote Linux amd64 GPU full VMs. Keep GHCR packages private. Supply `FORGE_GHCR_USERNAME` with a separate `FORGE_GHCR_READ_TOKEN` limited to `read:packages`; bootstrap stores standard Docker auth in a root-only host directory. Model URLs and registry credentials belong in protected deployment configuration. The B08 model URL expires; generate a fresh authorized HTTPS URL before reusing its catalog. The workstation does not need Docker.

## B09: BindCraft2 and FreeBindCraft

Assign the runtime recipes and native cases to one existing worker. A second worker can prepare the shared AF2 asset and CLI guides in a separate assigned path. Establish each tool's native executable, input format, weight layout and bounded output checks before building. Choose one maintained AF2 asset name for the directory shared by both tools, and agree on its exact layout in the contract before either implementation depends on it.

Retain ordinary image tags and native command arguments. Keep the shared weights read-only and compilation/cache writes in scratch. Check the expected scientific output files after execution. A corrected run uses a fresh output directory and an explicit new command ID.

The orchestrator provisions the remote builder, records its current price and cleanup deadline, and supplies workers with bounded remote directories. Account for completed B08 spending against the user's $100 compute ceiling if this remains the same authorized campaign. Publication follows native image qualification and the user's private-package requirement. B11 records the full advertised combinations.

## B10: Vast full-VM adapter

This can proceed alongside B09 from the accepted backend branch. One existing worker owns the adapter and its meaningful application-flow coverage. Select only full VMs with Docker/GPU support. Keep the session API and catalog unchanged. Provider-specific ownership, address/SSH readiness and deletion stay inside the adapter and existing lifecycle boundaries.

Cover allocation acknowledgment loss, recovery of an owned VM, close/expiry and verified deletion through the real application path, with the provider boundary substituted when a paid scenario adds no useful evidence. Preserve billing cutoffs and project authorization. Vast remains unavailable to ordinary sessions until its B11 live gate passes.

## B11 and dispatch boundary

The orchestrator reviews and integrates B09/B10, then runs bounded native and lifecycle qualification for each advertised tool/provider combination. Record output checks and actual cleanup, including interruption/cancellation and recovery cases. Keep failed scientific attempts and use explicit new requests after a correction.

B09 and B10 are being dispatched to the existing worker chats. The recipes worker owns both native design-tool recipes and their cases. The assets/guides worker owns the shared `alphafold2` preparer and CLI references. The backend worker owns the Vast adapter. Each starts from the accepted integration branch in an isolated worktree; the orchestrator reviews progress and integrates completed work. The shared AF2 layout and Vast admission switch are settled in the contract. Broader tools, custom installation, multi-GPU execution, warm pools, snapshots and migration remain deferred.
