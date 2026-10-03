# Forge remaining release gates

Updated October 3, 2026. B09 recipes, AF2 assets and CLI guides are complete and privately published. B10 is integrated with Vast admission off. All five native workflows and checkpoint recovery passed on Hyperstack; the [B11 report](forge-b11-qualification.md) records an unexplained early source closure and the incomplete Vast gate. Every campaign VM and local control-plane process has been cleaned up.

Continue from the existing `codex/forge-v2-integration` workspaces:

| Repository | Workspace |
|---|---|
| Backend | `/Users/aaronring/.codex/worktrees/forge-v2-integration/Ariax-Bio-Backend` |
| Runtime | `/Users/aaronring/Forge-rebuild/2026-10-01/forged` |
| CLI | `/Users/aaronring/Forge-rebuild/2026-10-01/cli` |

The [contract](forge-contract.md) governs implementation. Preserve unrelated primary-checkout changes. Existing worker chats remain available; the orchestrator owns integration, shared documents, provisioning and cleanup. Remote GPU image work stays on remote full VMs. The authorized campaign ceiling is $100; cumulative compute estimates and the recorded probe charge currently total approximately $6.00.

## Unresolved early closure

Source session `f4db6cbe-ac96-4a89-8059-c175c46b983c` closed before expiry without an orchestrator close request. Its last completed checkpoint retained all native results, and subsequent fresh restores passed. The original runtime journal was lost, so its trigger remains unproven. Runtime health now preserves `close_reason`, policy-check exceptions are logged with credential redaction, and the backend retains policy failure through cleanup. Any further live reliability qualification must retain the runtime journal while the VM exists. Keep the original incident as an unresolved finding until evidence identifies its cause.

## Vast host decision

Keep `FORGE_ENABLE_VASTAI=false`. Probe `53957680` was a full VM but booted Ubuntu 22.04 despite the image label. The Ubuntu 24.04 installer gate failed, and clean Docker/containerd storage was not established. The probe was deleted. Supporting Ubuntu 22.04 requires the user's pending scope decision, an explicit managed Python 3.12 installation, and safe handling of Docker/containerd state. Existing workload data must remain intact. Alternatively, obtain a verified Ubuntu 24.04 full-VM image before continuing. Run the real installer gate before enabling an isolated Vast Forge campaign.

A later Vast campaign must cover native tool execution, persistence and restore, allocation recovery, billing cutoff and provider/tunnel/DNS cleanup. Its admission switch must remain off for ordinary users until those gates pass. Existing accepted sessions must still reconcile and clean up with admission disabled.

## Deployment preparation

Private image tags are published. Use `science/catalog.all-tools.example.json` as the configuration shape and supply fresh authorized Boltz2/AF2 URLs in a protected deployment catalog. Configure the separate GHCR package-read credential through the existing host bootstrap. Credentials stay outside workload mounts, public responses and Git. The campaign control plane was disposable; production rollout requires its own deployment step.

Broader tools, custom installation, multi-GPU execution, warm pools and migration remain deferred.
