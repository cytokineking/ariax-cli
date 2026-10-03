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

Preserve unrelated primary-checkout changes. The shared documentation in these repositories describes the accepted implementation. Existing executor chats are idle and retain their isolated work and handoffs.

## Deployment work

Production rollout is a separate task. Deploy the coordinated backend, runtime and CLI revisions with migration `20261003000000_forge_tool_selections.sql`. Configure the daemon's reachable HTTPS origin through `FORGE_CONTROL_PLANE_URL` and retain model storage credentials in the control plane. Catalog assets use `object_key` and `archive`; host catalogs contain archive formats and obtain URLs through the authenticated callback. Keep GHCR packages private and registry credentials outside workloads.

Vast admission remains disabled by default. Its live host, native and lifecycle acceptance passed. Changing admission is part of the rollout decision. Existing admitted sessions continue reconciliation and cleanup when admission is disabled.

## Retained finding

The B11 source session's unexpected early closure has no proven trigger because its runtime journal was lost when that VM was deleted. B12 repeated the original workload beyond that failure interval and passed delayed persistence, new commands and restart recovery with diagnostics retained outside the VM. The integrated Vast session also completed its workload and recovery checks before deliberate credit exhaustion. Keep the historical finding and current diagnostic capture available during rollout.

## Deferred scope

Broader tool families, custom installation, multi-GPU execution, warm pools and migration remain deferred. Extract shared provider operations when a concrete change exposes useful duplication. Preserve the accepted checkpoint semantics and direct native command execution.
