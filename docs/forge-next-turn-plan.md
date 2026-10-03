# Forge remaining release gates

Updated October 2, 2026 (Pacific). The user approved this plan and reuse of the existing executor chats. B09 recipes, AF2 assets and CLI guides passed private qualification. All five native workflows and checkpoint recovery passed on Hyperstack. The [B11 report](forge-b11-qualification.md) preserves the unexpected early closure and incomplete Vast host qualification. Earlier campaign resources have been deleted; the recorded cumulative compute estimate is approximately $6.00 of the authorized $100 ceiling.

Continue from the existing integration workspaces:

| Repository | Workspace |
|---|---|
| Backend | `/Users/aaronring/.codex/worktrees/forge-v2-integration/Ariax-Bio-Backend` |
| Runtime | `/Users/aaronring/Forge-rebuild/2026-10-01/forged` |
| CLI | `/Users/aaronring/Forge-rebuild/2026-10-01/cli` |

The [contract](forge-contract.md) governs implementation. Preserve unrelated primary-checkout changes. The orchestrator owns shared interfaces, integration, live qualification, credentials and cleanup. At most two paid VMs may run concurrently. Image work stays on remote GPU VMs. Every paid resource needs a recorded owner and a cleanup deadline; cleanup must proceed after failed acceptance as well as successful acceptance.

## Executor assignments

The runtime executor reuses `b07-forged` to simplify policy inspection and test timeout handling. The tool-installation executor uses backend `b724`, runtime `b05-forged` and CLI `b07-cli` to finish tool selection and automatic model URL issuance. The Vast executor prepares host changes in backend `0256` and runtime `b06-forged`; implementation follows agreement on the shared bootstrap interface. Executors preserve their old branches and work from the accepted integration revisions. The orchestrator alone edits the integration branches and shared documents.

## 1. Session reliability

Source session `f4db6cbe-ac96-4a89-8059-c175c46b983c` closed before expiry without an orchestrator close request. The runtime journal was lost on deletion, and its trigger remains unproven. Later restores and restarts passed. Runtime health now preserves `close_reason`, and the backend retains policy failure through cleanup.

Repeat the original workload against the accepted release while retaining bounded, sanitized runtime, Docker, tunnel and control-plane diagnostics outside the VM. Record each observed close origin before deletion. Preserve failed attempts and distinguish them from harness errors.

Consolidate the monitor's repeated firewall queries, preserve the enforced network policy, and distinguish a policy mismatch from failure to observe it. Verify subprocess timeout cleanup. Changes to recovery semantics need review of how isolation remains enforced. A successful repeat leaves the historical cause unresolved.

## 2. On-demand tool installation

Make `tools add` an explicit release gate. Connect the public endpoint to the existing durable preparation queue, preserving ownership checks and create idempotency. Added selections and priorities must not mutate the original create request. Ready tools remain usable during preparation, explicit requests can retry failed preparation, and polling never initiates a retry. Priority changes affect queued preparation without interrupting active work.

Installed-CLI acceptance must create a base workspace, start a command, add a scientific tool while that command runs, observe readiness and execute the tool. Exercise queued priority changes and a meaningful preparation failure followed by explicit retry. Check the same create request remains idempotent after tool selection changes.

## 3. Automatic model URLs

Issue ordinary short-lived authorized URLs through existing storage signing when preparation needs them. Cover queue delay, late tool addition and explicit retry after an earlier URL expires. Deployment supplies stable named asset locations. Keep credentials and temporary URLs outside workload mounts, public responses, logs, evidence and Git. Preserve named shared assets and atomic completed-download publication. Agree on the backend-to-daemon interface before changing shared bootstrap code.

## 4. Vast host support and qualification

The user approved support for the actual Ubuntu 22.04 guest with managed Python 3.12. Keep one installer with an explicit OS branch and retain Ubuntu 24.04 support. Probe `53957680` was deleted; its image label did not match the guest. Docker/containerd storage suitability remains unproven.

Inspect engine inventories before changing storage and preserve existing workload data. Run the real installer on a full VM, then qualify all native tools, persistence, cross-provider restore, controller recovery, billing cutoff and provider/tunnel/DNS cleanup. Keep `FORGE_ENABLE_VASTAI=false` for ordinary users until acceptance passes. Existing admitted sessions must reconcile and clean up with admission disabled.

## 5. Final staging under normal schedules

Use the normal worker configuration, including Forge reconciliation, credit/resource management and orphan cleanup, against isolated staging data. Exercise expiry and credit exhaustion and verify billing cutoff, resource absence and retained diagnostics. Run acceptance through the installed CLI and public API with the integrated runtime. Keep publication private and prepare coordinated release revisions after these gates pass.

## Deferred work

Extract shared Vast operations after behavior stabilizes. Preserve the accepted checkpoint semantics; simplify individual persistence responsibilities when a concrete change exposes duplication. Broader tools, custom installation, multi-GPU execution, warm pools and migration remain deferred.
