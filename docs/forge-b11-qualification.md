# Forge B09–B11 qualification

This historical report records the B09–B11 campaign. The [B12 report](forge-b12-qualification.md) records the subsequent accepted host support, repeated workload, integrated acceptance and final cleanup.

Updated October 3, 2026. B09 native qualification and CLI guides are complete. Both images and the shared AF2 asset were published privately. B10 is integrated with `FORGE_ENABLE_VASTAI=false`. The Hyperstack campaign exercised all five tools through the installed CLI. Vast live acceptance remains blocked by the selected full VM's Ubuntu version, and an unexpected closure during the first Hyperstack session remains an unresolved reliability finding.

## Native recipes and private publication

The builder used an on-demand Hyperstack L40 full VM with Ubuntu 24.04, systemd, Docker and NVIDIA driver 570.195.03. BindCraft2 completed a trajectory and one MPNN candidate. FreeBindCraft completed a trajectory, one MPNN candidate and three OpenMM CUDA relaxations. The output checkers read the actual structures, sequences and confidence fields. These bounded cases establish executable workflows; they do not establish experimental binding activity.

The first two FreeBindCraft attempts used a 31-residue fixture and stopped at intrinsic confidence or clash checks. Both attempts are retained. The accepted fixture uses an 80-residue binder with the upstream four-stage schedule, 75/45/5/15, and one trajectory attempt. Upstream chooses its random seed, so a later bounded attempt can be scientifically rejected. Guides preserve that behavior and retain native argv. The unsupported `--relax-backend openmm` flag was removed.

| Published image | Access check |
|---|---|
| `ghcr.io/cytokineking/ariax-forge-bindcraft2:b09` | Private; package-read credential returned 200, anonymous request returned 401 |
| `ghcr.io/cytokineking/ariax-forge-freebindcraft:b09` | Private; package-read credential returned 200, anonymous request returned 401 |

The shared `alphafold2` archive contains `LICENSE` and all 15 upstream NPZ files at its root. Every numeric array loaded and contained finite values. Its private R2 object is `ariax-model-artifacts/ariax-forge/science-models/b09-2026-10-03/alphafold2.tar`, 5,587,988,480 bytes. Both design tools mount the same installed directory read-only at `/models/alphafold2`. The protected deployment catalog also includes the previously qualified base, ipSAE and Boltz2 images. Temporary authorized asset URLs and the separate GHCR package-read credential stay outside Git and workload mounts.

## Installed CLI and the Hyperstack campaign

The final CLI package came from `d208316`; all 534 existing package tests passed before installation into a fresh prefix. Its installed fixtures matched the accepted runtime examples. The source session was created with the earlier package `26bb010`, whose command implementation was unchanged; the final package supplied input imports, native execution and subsequent lifecycle operations. The control plane used disposable Supabase services with all 59 repository migrations, the real FastAPI service, Next API proxy, Redis and the Forge ARQ lifecycle. Only Forge reconciliation and its sweep ran in the campaign worker.

Session `f4db6cbe-ac96-4a89-8059-c175c46b983c` exercised partial readiness and imported 16 files. Base and ipSAE completed, followed by native Boltz2 GPU prediction, BindCraft2 design/MPNN and FreeBindCraft design/MPNN with three completed CUDA relaxations. Every native output checker passed. An explicitly cancelled command ended cancelled; a following command succeeded. Restarting the runtime preserved the running container and completed its command once.

At 04:18:53 UTC, that session entered cleanup while its configured expiry was 05:51 UTC. The orchestrator had not requested closure. The runtime journal was lost when the provider deleted the VM. Its last persisted checkpoint retained the original file version and the native results. The exact trigger remains unproven. Forty-five timed policy checks and one traced check on the builder passed.

Investigation found that runtime policy exceptions permanently closed admission while discarding diagnostics, and backend reconciliation then treated the close as successful. Runtime health now includes durable `close_reason`; the first policy failure logs sanitized exception details. The backend retains `network_policy_failed` as a public session error after cleanup. The existing fail-closed behavior is preserved. Twenty-four runtime HTTP tests passed, including cancellation, exception/timeout diagnostics, credential redaction and restart persistence. Three focused PostgreSQL/Redis lifecycle cases passed, including cleanup and billing cutoff with a retained policy-failure reason. These changes fix the observed diagnostic gap; the source closure remains an open reliability finding.

The final source checkpoint served all 62 files through the installed CLI after the VM was absent. Recovery session `37f56711-ba9f-4fdd-af24-ddba759b0dec` started on a fresh Hyperstack VM with an empty command journal. It restored the 16 inputs and native outputs, then passed every native output checker without replaying a prediction. The saved archive contained 43 scientific files and 16 inputs; each matched its downloaded source counterpart byte for byte.

The recovery session saved explicit first and second checkpoints. The second changed `version.txt` and removed `deleted.txt`. After that VM was deleted, session `9cf955a2-ed7e-49dd-aae9-0d4237ec5d58` restored checkpoint `5a744283-d8ed-4afd-8bd2-28b1d26ea2fa` onto another fresh VM. It had an empty command journal before the explicit checks. The second version and deletion survived, all archived files matched by bytes, and the base/ipSAE checks passed. An instrumented runtime restart retained its running container. A delayed checkpoint and subsequent command passed, with no closure during six minutes of follow-up. Closed-session downloads matched again after its VM was deleted. Workload inspections verified UID 10001, a read-only container root and read-only input/model mounts, including one shared AF2 directory for both design tools.

## Vast host gate

The adapter uses the existing allocation, ownership and billing paths, and new Vast admissions remain disabled. An installed-CLI request returned the explicit `provider_unavailable` error and allocated no VM. Its forwarding through the public proxy was corrected and verified by the existing joined CLI workflow.

A separate full-VM probe rented Vast instance `53957680`, an RTX PRO 5000 Blackwell machine. The selected provider image was labelled Ubuntu 24.04, but the actual guest reported Ubuntu 22.04 with systemd and a working NVIDIA driver. Docker/containerd directories were populated. The installer was not run because the required Ubuntu 24.04 gate failed; clean-storage acceptance therefore remains unproven. The probe was deleted, and provider inventory confirmed absence. Its recorded invoice was $0.068 at cleanup.

Inspection of the 34 published KVM image tags found 30 explicit Jammy guests, three generic Ubuntu images and one RHEL image. No Ubuntu 24.04 guest was established. Supporting Ubuntu 22.04 would require an explicit scope decision and a managed Python 3.12 runtime, followed by a real host installation gate. Keep Vast disabled until those decisions and live checks are complete.

## Revisions, evidence and cleanup

- Backend: `caddd51d2da227ea4e896cbd3f5582e0c18ddc5d`
- Runtime: `963567305432344085f0c32e067736a58f76f081`
- CLI: `d2083163b36c350bad275767a3454858f172990c`

These are implementation revisions before this documentation update.

The durable local evidence directory is `/Users/aaronring/Forge-rebuild/2026-10-01/evidence/b11-2026-10-03`. It contains retained failed and successful B09 native cases, the installed CLI package, source command outcomes, output files, restoration comparisons, sanitized lifecycle records and cleanup receipts. Evidence was scanned for known credentials and credential patterns before copying. The protected deployment configuration remains separate.

| Resource | Hours through confirmed absence | Estimated provider cost |
|---|---:|---:|
| Remote builder and disposable database | 2.1737 | $2.1883 |
| Source Forge VM | 0.6062 | $0.6103 |
| Recovery Forge VM | 0.2876 | $0.2896 |
| Restored Forge VM | 0.2418 | $0.2434 |

All three Forge VMs, their Cloudflare tunnels and DNS records were confirmed absent. Each disposable customer billing ledger stopped at the recorded close cutoff and matched its credit transaction. Builder `1078801` was confirmed absent at 2026-10-03T05:09:46.529646+00:00. The disposable API, worker, frontend, Redis and SSH-forward processes were stopped after evidence preservation.

The B11 Hyperstack compute estimate is $3.33, based on quoted GPU/IP rates through confirmed absence. Together with the recorded Vast probe charge and the previous B08 estimate, the campaign total is approximately $6.00, within the authorized $100 ceiling. This estimate excludes unitemized registry/storage/network charges and is not a provider invoice.

No production deployment, Git push or public package publication occurred. The remaining release gates are the unresolved early closure and the Vast host qualification. Broader tool families, custom tool installation and multi-GPU execution remain deferred.
