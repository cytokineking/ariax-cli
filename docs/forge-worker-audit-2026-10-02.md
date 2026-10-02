**Forge worker audit, October 2, 2026**

B02–B04 are accepted for their assigned scopes and integrated into the three `codex/forge-v2-integration` branches. All five findings below have been corrected and independently verified. The final B03 run passed 229 backend tests and all seven audit/integration cases. The reviewed worker worktrees were clean at the commits below. Production deployment and live VM qualification remain pending.

| Bite | Audited commit | Assessment |
|---|---|---|
| B02, runtime and bootstrap | `da82d712f735621223b16a68c3009223b5d9a8d7` | Directory permissions now survive umask `0077`. Accepted within B02's scope. Fresh Ubuntu installation, actual container isolation, and NVIDIA execution still need qualification. |
| B03, backend and Hyperstack | `d9e7ec80d584d5a443b3a5288109a649a9074cf9` | All lifecycle findings are repaired, including terminal failure after definite rejection. Accepted and integrated. |
| B04, CLI and platform skill | `44ea62d307235442b68b32fb9c305ef328c251a8` | Requested commands, durable request IDs, recovery, and platform guidance are implemented. No blocking defect found in this audit. |

Scientific installation belongs to B05. Inputs and durable output storage remain B06 work. The current persistence response correctly says `pending`; native scientific recipes and live qualification are later bites.

**Follow-up finding, now resolved**

The confirmed-rejection probe failed at `1e7ccd2` and passed at `d9e7ec8`. Forge now releases the fresh, unaccepted create intent after a definite rejection or a proven failure before submission. Ambiguous submissions retain ownership. The final independent result was `failed`, zero VMs, no pending sweep entry, and a cleared instance type. The following paragraph records the failure that prompted this correction.

**P2: a confirmed provider rejection never reaches a terminal state.** The cleanup fix preserves a claimed allocation whenever there is no known provider ID. Hyperstack already reports a definite HTTP 400 rejection through `GpuCreateFailedError`, but Forge's generic exception handling keeps that create intent. Cleanup consequently cannot finish. The independent probe returned `400 invalid_request` for an unavailable image, with no VM ever created. After two reconciliation passes the session remained `closing`, retained `instance_type=n3-L40x1`, and stayed eligible for every cleanup sweep.

Relevant code: [the cleanup completion condition](/Users/aaronring/.codex/worktrees/b724/Ariax-Bio-Backend/backend/app/services/forge_lifecycle.py:236). The worker has been asked to distinguish definite rejection and provably pre-submission failure from ambiguous create outcomes, using the existing guarded ownership helpers. Lost replies and temporary empty inventory must continue to retain ownership. This defect leaves a failed request pending indefinitely; the probe had zero billable VMs.

Reproduction: [definite-rejection probe](/private/tmp/forge-worker-audit-20261002/test_definitive_rejection.py) and [original failing output](/private/tmp/forge-fix-audit-probes.log). The worker completed the correction in the existing B03 chat. The orchestrator reran [all seven checks](/private/tmp/forge-b03-final-probes.log) and the [229-case backend suite](/private/tmp/forge-b03-final-backend.log) before accepting it.

**Independent verification of the fixes**

| Check | Result |
|---|---|
| Runtime suite at `da82d71` | 23 passed. |
| Backend focused suite at `d9e7ec8` | 229 passed with a short temporary path for Redis sockets. |
| Original four failure probes | All passed. The late-visible VM was removed; a temporary HTML 502 preserved the live session; daemon restart remained eligible to recover; inputs and models had mode `0755` under umask `0077`. |
| Backend/runtime integration and joined public workflow | Both passed again. The joined flow used the real CLI, public proxy, request signer, backend, daemon, PostgreSQL, Redis, and SQLite. |
| Definite-rejection probe at `d9e7ec8` | Passed. The final combined audit run passed all seven cases. |

Logs: [runtime](/private/tmp/forge-fix-audit-runtime.log), [final backend suite](/private/tmp/forge-b03-final-backend.log), and [final cross-component and failure probes](/private/tmp/forge-b03-final-probes.log). CLI and frontend files were unchanged by the fixes; their earlier passing results are recorded below.

B02 added an explicit permission setting for the two read-only mount roots and extended an existing test. B03 classifies transient HTTP failures before decoding JSON, retains discovered allocation IDs through cleanup, and records when a later daemon restart begins. Its final correction distinguishes definite rejection and failure before submission from an uncertain accepted allocation. These changes stay within the existing design.

**Original findings, now resolved**

The following findings record behavior at the initial B02 commit `e5b9e6c` and B03 commit `7346ca3`. All four probes now pass. The current implementation has moved some of the referenced code.

1. **P1: a late-visible provider allocation escapes cleanup.** After a provider accepts a create request and its reply is lost, inventory can temporarily omit the new VM. The provider adapter performs two inventory reads; Forge cleanup repeats that check and treats an empty set of IDs as successful termination. It then marks the session terminal. Subsequent reconciliation immediately returns, and the sweep only lists active sessions. In the probe, the provider exposed the accepted VM on the next pass: one VM remained, the session was `failed`, there were zero instance rows, and the recovery sweep had zero pending sessions. Keep uncertain create ownership eligible for cleanup until the create outcome has been resolved. This needs the existing ownership record and a defined recovery window, without another identity protocol.

   Relevant code: [cleanup's absence decision](/Users/aaronring/.codex/worktrees/b724/Ariax-Bio-Backend/backend/app/services/forge_lifecycle.py:203), [terminal-state return](/Users/aaronring/.codex/worktrees/b724/Ariax-Bio-Backend/backend/app/services/forge_lifecycle.py:258), and [active-session selection](/Users/aaronring/.codex/worktrees/b724/Ariax-Bio-Backend/backend/app/services/forge_store.py:25). The probe models delayed provider visibility; it makes no claim about the frequency of that behavior on Hyperstack.

2. **P1: a temporary HTML gateway response terminates a live VM.** `ForgeHost.request` attempts JSON decoding before handling the HTTP status. A 502 HTML response becomes `invalid_host_response`. The lifecycle preserves the VM only for `runtime_unavailable`, so it proceeds to cleanup. A single injected 502 on an available session caused `failed` and zero remaining VMs. Handle transient gateway failures as uncertain reachability and continue observation within the lifecycle's bounds.

   Relevant code: [response decoding](/Users/aaronring/.codex/worktrees/b724/Ariax-Bio-Backend/backend/app/services/forge_host.py:57) and [error-to-cleanup decision](/Users/aaronring/.codex/worktrees/b724/Ariax-Bio-Backend/backend/app/services/forge_lifecycle.py:385).

3. **P1: the initial bootstrap deadline kills a later daemon restart.** B02 reports `starting` while preparing the base image after a daemon restart. B03 evaluates every such response against the original `bootstrap_started_at`. For a session already an hour old, one `starting` response caused `bootstrap_failed` and VM deletion. Apply the initial installation deadline to initial installation. A later daemon restart needs its own bounded recovery handling so it can reconcile running containers.

   Relevant code: [handling of the starting state](/Users/aaronring/.codex/worktrees/b724/Ariax-Bio-Backend/backend/app/services/forge_lifecycle.py:371) and [runtime startup](/Users/aaronring/Forge-rebuild/2026-10-01/b02-forged/forged/runtime.py:50).

4. **P2: the bootstrap umask makes `/inputs` inaccessible to workloads.** Both the installer and daemon use umask `0077`. `Layout.ensure` requests mode `0755`, which that umask reduces to `0700`. The installer explicitly repairs workspace and scratch ownership, while inputs remains root-owned `0700`. Containers run as UID 10001. The local filesystem probe reproduced `0700` for inputs and models; the `/inputs` bind mount will therefore prevent the workload from listing or reading input files. Set the intended input-directory permissions explicitly. Asset-directory permissions should also be established when B05 creates them.

   Relevant code: [directory creation](/Users/aaronring/Forge-rebuild/2026-10-01/b02-forged/forged/paths.py:22), [bootstrap ownership](/Users/aaronring/Forge-rebuild/2026-10-01/b02-forged/deploy/bootstrap-host.py:73), and [container user](/Users/aaronring/Forge-rebuild/2026-10-01/b02-forged/forged/docker_runtime.py:63).

**Simplicity**

The new Forge implementation follows the requested image and weight policy. It uses ordinary image tags and named assets, compares stored request fields directly, and has one runtime/API format. I found no new artifact checksums, digest pins, install-plan signatures, compatibility modes, provider fallback, or automatic scientific replay.

The code retains authentication, durable command IDs, container ownership, access checks, and resource cleanup. The request signer remains the existing authenticated compute transport. PostgreSQL's hash functions supply advisory-lock keys; they do not introduce a Forge request-hash protocol. The runtime's constant-time bearer comparison serves authentication. These uses preserve the boundaries accepted in the contract.

The corrections fit within the existing modules. This review found no need for further architecture changes. All reproduced lifecycle failures now have passing checks through the application paths.

**Initial audit evidence**

| Check | Result | What it exercises |
|---|---|---|
| B02 runtime suite | 23 passed | Real HTTP handlers and SQLite, with a stateful Docker substitute; one case uses the real Docker SDK against a test HTTP server. Includes duplicate requests, lost acknowledgments, restart, cancellation, timeouts, expiry, ownership, and container configuration. |
| Backend focused suite | 222 unique tests passed after resolving the local Redis socket-path issue | Three Forge cases exercise the actual migration in disposable PostgreSQL, real Redis/ARQ, signed HTTP routes, broker/provider logic, and billing concurrency. Other tests cover existing auth, admission, provider selection, and worker behavior. |
| Frontend selected suite | 28 passed | Signed compute routes and existing agent authentication/rate-limit foundations. The worker's added frontend case covers the Forge allowlist. |
| CLI full suite | 531 passed | Includes the Forge lifecycle/recovery flow against a stateful HTTP boundary, argument handling, and existing managed-job behavior. |
| CLI package checks | Passed for GitHub and npm packages | Installs the actual packed CLI and exercises the Forge HTTP lifecycle/recovery flow through its executable. |
| Added backend/runtime integration probe | Passed | Actual B03 routes/transport and B02 bearer authentication/journal work together through create, run, identical retry, conflicting retry, logs, cancellation, and close. |
| Added joined local workflow | Passed | CLI → public Forge proxy → signed backend → daemon, with real PostgreSQL, Redis, and SQLite. Verifies tool wait, command exit/stdout, duplicate suppression, cancellation, explicit installation-unavailable errors, and closure. |
| Added failure probes | Four failures at the initial commits; all repaired | The original findings recorded above. |

The first backend test attempt hit the filesystem sandbox's log-write restriction. The rerun completed 220 tests and encountered two Redis setup errors because the default macOS temporary socket paths were too long. Rerunning the three Forge cases with `--basetemp=/private/tmp/forge-audit-pytest` passed all three, yielding 222 distinct passing cases across the focused suite. These setup issues were separate from the product failures demonstrated by the additional probes.

The joined workflow runs the actual public proxy and compute signer in a small local HTTP server. Full Next.js server startup remains untested. Supabase API-key authentication and rate limits are substituted at that boundary. The backend verifies the real signed requests. Provider, tunnel, SSH/bootstrap, and Docker are substituted; the daemon still executes its real admission and reconciliation logic. A bounded local `printf` process verifies exit-status and stdout propagation. Duplicate submission produced one execution, and the complete flow ended with two recorded commands, a closed SQLite session, and zero simulated provider VMs.

The workers had tested their components against separate boundaries. This audit added the joined path. No live Hyperstack allocation, Ubuntu bootstrap, NVIDIA/container execution, firewall enforcement, scientific run, or R2 persistence test has passed for these commits. Docker was unavailable locally. The B03 handoff also records existing errors from the full frontend typecheck; this audit reran the selected behavioral tests listed above.

**Reproduction material**

The disposable harness and logs are saved under [forge-worker-audit-20261002](/private/tmp/forge-worker-audit-20261002). They have not been added to a worker branch or its permanent test suite.

- [Failure and backend/runtime probes](/private/tmp/forge-worker-audit-20261002/test_audit_probes.py), [first probe results](/private/tmp/forge-worker-audit-20261002/probes.log), and [late allocation results](/private/tmp/forge-worker-audit-20261002/late-create.log).
- [Joined workflow harness](/private/tmp/forge-worker-audit-20261002/test_joined_public.py), [public proxy/CLI flow](/private/tmp/forge-worker-audit-20261002/joined-flow.test.ts), and [joined results](/private/tmp/forge-worker-audit-20261002/joined.log).
- [Backend regression output](/private/tmp/forge-audit-backend-tests.log), [Forge database rerun](/private/tmp/forge-audit-backend-forge-tests.log), [frontend output](/private/tmp/forge-audit-frontend-tests.log), [CLI output](/private/tmp/forge-audit-cli-tests.log), and [package output](/private/tmp/forge-audit-cli-package.log).

The next implementation wave is B05 installation, B06 files/persistence/restore, and B07 reference recipes. The [next-turn plan](forge-next-turn-plan.md) assigns their shared-file boundaries and acceptance checks. Live qualification still needs a provisioned VM, real containers and GPU execution, scientific installation, and durable storage.
