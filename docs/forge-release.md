# Forge release handoff

Updated October 3, 2026. The approved B12 work and live staging acceptance are complete. Read the [B12 qualification report](forge-b12-qualification.md) for the results, failures retained during qualification, revisions and cleanup. The [contract](forge-contract.md) defines the supported behavior. Cumulative compute is estimated at $10.28 of the authorized $100 ceiling; every campaign VM and tunnel has been deleted.

## Accepted behavior

The installed CLI passed durable tool selection, queued priority changes, explicit preparation retry and create idempotency while commands ran. Model downloads obtained fresh session-authorized URLs at preparation time. The runtime consolidated policy checks and verified timeout cleanup while preserving failure closure.

The Ubuntu 22.04 Vast guest and Ubuntu 24.04 Hyperstack guest both passed the managed Python 3.12 installer. All five native tools ran on both providers during the campaign. FreeBindCraft's first Vast trajectory was scientifically rejected; one additional explicit attempt passed MPNN and three native CUDA relaxations. Both outcomes are retained. Cross-provider restore compared all saved files by bytes and initiated zero native predictions. Normal worker schedules closed sessions on credit exhaustion and natural expiry, with billing cutoff and provider/tunnel/DNS absence verified.

## Integration workspaces

| Repository | Workspace | Qualified implementation |
|---|---|---|
| Backend | `/Users/aaronring/.codex/worktrees/forge-v2-integration/Ariax-Bio-Backend` | `fbb993b` |
| Runtime | `/Users/aaronring/Forge-rebuild/2026-10-01/forged` | `0c3c8fe` |
| CLI | `/Users/aaronring/Forge-rebuild/2026-10-01/cli` | `92036ce` |

Each repository retains `main` and one `codex/forge-v2-integration` branch. Completed worker assignments and intermediate plans are preserved in [the history archive](forge-history.md). The CLI also includes scientific skill recovery commits `88042c5` and `430cf4d`; their offline checks leave broader native qualification limits explicit.

## Deployment work

Production rollout is a separate task. Deploy the coordinated backend, runtime and CLI revisions with migrations `20261002000000_forge_sessions.sql`, `20261002010000_forge_files.sql`, and `20261003000000_forge_tool_selections.sql`, applied through the normal migration process. Configure the daemon's reachable HTTPS origin through `FORGE_CONTROL_PLANE_URL` and retain model storage credentials in the control plane. Catalog assets use `object_key` and `archive`; host catalogs contain archive formats and obtain URLs through the authenticated callback. Keep GHCR packages private and registry credentials outside workloads.

Vast admission remains disabled by default. Its live host, native and lifecycle acceptance passed. Changing admission is part of the rollout decision. Existing admitted sessions continue reconciliation and cleanup when admission is disabled.

## Retained finding

The B11 source session's unexpected early closure has no proven trigger because its runtime journal was lost when that VM was deleted. B12 repeated the original workload beyond that failure interval and passed delayed persistence, new commands and restart recovery with diagnostics retained outside the VM. The integrated Vast session also completed its workload and recovery checks before deliberate credit exhaustion. Keep the historical finding and current diagnostic capture available during rollout.

## Deferred scope

Broader tool families, custom installation, multi-GPU execution, warm pools and migration remain deferred. Extract shared provider operations when a concrete change exposes useful duplication. Preserve the accepted checkpoint semantics and direct native command execution.

## Repository locations

The control plane and public API live in [Ariax-Bio](https://github.com/cytokineking/Ariax-Bio). Native runtime, images and fixtures live in the private [ariax-forged](https://github.com/cytokineking/ariax-forged) repository. The public [ariax-cli](https://github.com/cytokineking/ariax-cli) repository contains the client and agent guides. Keep the coordinated Forge release separate from ordinary branding and managed-job fixes already on backend main.
