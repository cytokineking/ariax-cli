# Forge B05–B07 review, October 2, 2026

The reviewed B05/B06/B07 code and guides are integrated, including both lifecycle fixes and the shared hooks. The maintained workflow passes against the integration branches and installed CLI. Integration also exposed and fixed a proxy error that converted a backend denial into a 500 response. Image builds, the complete published Boltz2 asset, and GPU execution remain B08 gates.

The initial review and fix recheck used temporary copies. The later integration described below merged the accepted commits into the dedicated integration branches. No cloud resources were rented, artifacts published, or production migrations applied during this bite.

## Initial worker submissions

| Bite | Result | Commits |
|---|---|---|
| B05, installation | Durable preparation queue, partial readiness, ordinary Docker pulls, atomic named-asset publication and reuse. Its interaction with final checkpoint needs correction. | Runtime `9c05e14c31f1d746a6e95d086a0f25fdb8daf728` |
| B06, files | Local upload, authorized artifact and URL import; checkpoints, download, restore, and bounded cleanup across CLI/backend/runtime. Startup recovery needs the daemon lock; close needs the B05 integration fix. | Backend `62c854dcc8f28a27e907e100a931dd562fc49fa6`; runtime `3cb856c656cacb40e403a5cca38516e15628aafc`; CLI `60f51919cf15fc9fdf855e9a3b69ef2ed6f6e27b` |
| B07, recipes | Base/ipSAE/Boltz2 recipes, scientific guides and fixtures. Native host CPU checks pass. The catalog currently contains base/ipSAE publication targets; Boltz2 stays in an explicitly unqualified example. | Runtime `38becefa600adbe126f6ff44693695a7965cca06`; CLI `f588639d825c2232cfec8c204ae6a230d6ebe310` |

There are no overlapping changed files between the worker branches. The review combined their runtime files, applied B06's planned lifecycle hooks to B05, and combined the CLI code and guides. The B06 tests' readiness predicate was adapted to B05's queued tool states in the temporary copy.

The reviewed deployment path uses ordinary image tags and named assets. It adds no content hashes, digest verification scheme, compatibility adapter, scientific replay, or CPU fallback. The recipes retain explicit scientific package versions.

## Initial findings

### P1: slow preparation can bypass the final checkpoint

Resolved by B05 commit `f99b48c7f824982fdbb330c72d9bbf0b6cc1a5bf` plus its close-handler patch. The independent follow-up exercised actual controller deletion and confirmed the newest bytes were already saved while the pull was still cancelling.

[B06's close handler](/Users/aaronring/Forge-rebuild/2026-10-01/b06-forged/forged/app.py:163) calls `runtime.close()` before attempting `files.final_sync()`. [B05 waits ten seconds for preparation](/Users/aaronring/Forge-rebuild/2026-10-01/b05-forged/forged/runtime.py:244), then raises `cleanup_pending` if the installer remains active. Docker's pull socket timeout is fifteen seconds. A valid close during a stalled pull can therefore return 503 while command writers have already stopped.

The review reproduced this through the combined authenticated HTTP handler: zero active commands, an unsaved workspace result, a 503 response, and zero uploaded objects. Persistence remained `pending` because final sync was never called. The [controller catches the failure](/Users/aaronring/.codex/worktrees/0256/Ariax-Bio-Backend/backend/app/services/forge_files.py:905), records a durability gap, and proceeds with VM deletion. Results since the last checkpoint can be lost despite time remaining in the close budget.

The orchestrator should fix this while integrating B05/B06. Keep one bounded close sequence and let stopped workspace writers permit final sync even while image preparation finishes cancellation. Alternatively, wait for that cancellation within the same deadline. Preserve the existing rule that an exhausted deadline or unreachable host releases the VM and reports the durability gap. Extend the joined close scenario to hold an image pull past ten seconds and require the new output to be retained before provider deletion.

### P2: a rejected second daemon damages an active transfer

Resolved by B06 commit `4cd047ed4a7374a03d8e131fc2121151e83ccb72` plus its startup hook. The rejected-contender case and recovery after an actual daemon-process crash both pass in the combined runtime.

[File service construction](/Users/aaronring/Forge-rebuild/2026-10-01/b06-forged/forged/app.py:28) occurs before `runtime.start()` acquires the daemon lock. Its [constructor deletes staging directories](/Users/aaronring/Forge-rebuild/2026-10-01/b06-forged/forged/file_api.py:41) and marks unfinished file operations interrupted.

With the first daemon checkpointing a file, constructing and starting a second app changed that checkpoint from `syncing` to `failed` and removed its staging directory. Only afterward did the second daemon fail with “Another daemon already owns this journal.” The first transfer could no longer complete.

Move staging cleanup and interrupted-transfer recovery into startup after acquiring the existing daemon lock, before the watcher and HTTP admission begin. A constructor should prepare the object without changing an active daemon's transfer state. B06 can make this small change; the orchestrator owns the startup call shared with B05. One HTTP/SQLite scenario with an active transfer and rejected second start covers the failure.

## Initial verification

| Check | Independent result |
|---|---|
| B05 runtime suite | 41 passed |
| B06 runtime suite | 26 passed |
| B06 backend, including disposable PostgreSQL/Redis lifecycle, auth and billing checks | 230 passed |
| B06 full CLI suite | 532 passed |
| B07 native CPU fixtures and constructed Boltz output inspection | 5 + 4 passed; Boltz inference was not executed |
| Combined CLI skill checks | 7 passed |
| Combined runtime suite | 43 cases passed initially; the remaining case passed after correcting the temporary readiness-predicate adaptation. All 44 existing cases passed across these runs. |
| Combined CLI/public proxy/signed backend/daemon workflow | Passed with real PostgreSQL, Redis and SQLite. Imported local, artifact and URL inputs; saved two versions; preserved deletion through restore; downloaded after close; checked source/destination access and credential omission from CLI records. |
| Storage failure during joined closure | Passed: retained earlier checkpoint, reported persistence failure, stopped billing records and released the provider boundary. |
| Expiry after a prior checkpoint | Passed with the combined lifecycle hooks: expiry closed the session and saved the changed workspace bytes in a new final checkpoint. |
| Additional lifecycle review probes | Both findings above reproduced. These are disposable review probes, outside the worker branches. |

The joined harness substitutes provider, object storage, external URL, tunnel and Docker boundaries. Its base command executes a local process through that Docker substitute. The test environment initially mixed incompatible AWS SDK versions; rerunning with a compatible SDK installed only under the review's temporary directory passed. That harness issue required no application change.

Evidence and the exact source manifest are in `/private/tmp/forge-wave2-audit/`. Relevant logs are `/private/tmp/forge-wave2-review-probes.log`, `/private/tmp/forge-wave2-combined-joined.log`, `/private/tmp/forge-wave2-combined-runtime.log`, `/private/tmp/forge-wave2-combined-files-retest.log`, and `/private/tmp/forge-wave2-expiry-probe.log`. Individual suite logs use the `/private/tmp/forge-wave2-` prefix. Keep the harness available through integration, then move the useful application scenarios into maintained coverage.

## Fix follow-up

At the fix recheck, both existing GPT-6.1 xhigh workers had completed their follow-up assignments and all checked worktrees were clean. The following table records the commits and integration requirements at that point; the local integration below now includes them.

| Branch | Current commit | Integration requirement |
|---|---|---|
| Runtime B05 | `f99b48c7f824982fdbb330c72d9bbf0b6cc1a5bf` | Apply its close-handler patch after bringing in B06's app. The handler shares a sixty-second deadline and permits final sync once command writers stop, while preparation keeps the host honestly `closing`. |
| Runtime B06 | `4cd047ed4a7374a03d8e131fc2121151e83ccb72` | Apply its startup hook after lock acquisition and before installer/watchers, plus the existing health, restore-admission and expiry hooks. |
| Backend B06 | `62c854dcc8f28a27e907e100a931dd562fc49fa6` | Bring in the file API, migration and lifecycle work. |
| CLI B06 | `60f51919cf15fc9fdf855e9a3b69ef2ed6f6e27b` | Bring in file commands and guides. |
| Runtime/CLI B07 | `38becefa600adbe126f6ff44693695a7965cca06` / `f588639d825c2232cfec8c204ae6a230d6ebe310` | Bring in the independent science recipes and tool guides, then finish their shared reference wiring. |

The orchestrator combined the exact commits in `/private/tmp/forge-wave2-fix-review/runtime` and verified both fixes together. The new startup and close patches apply cleanly. The older health/restore/expiry patch needs its health hunk adapted to B05's tool-state implementation; that adaptation is included in the prepared [combined hook patch](/private/tmp/forge-wave2-fix-review/integration-hooks.patch).

The full combined run passed 49 of 51 cases, including both original failure reproductions, the process-crash recovery case, and final checkpoint on expiry. Two older installation tests expected an immediate `closed` HTTP response. After the close fix, `closing` is valid while preparation unwinds. The [test adjustment](/private/tmp/forge-wave2-fix-review/test-expectations.patch) waits for terminal health before retaining all the existing assertions about queue fencing, installer termination and removal of temporary files. The focused close/expiry rerun passed all three selected cases. These test changes were prepared in the review copy and have now been committed with the integration hooks.

All three independent controller cases passed with actual PostgreSQL, Redis and SQLite: slow pull with the newest output durable before VM deletion, ordinary close, and storage failure preserving the earlier checkpoint while releasing the VM and billing record. The slow-pull close completed in 0.39 seconds while installation cancellation remained pending. This is local boundary-substituted evidence, not a cloud timing measurement.

Follow-up logs are `/private/tmp/forge-wave2-fix-review/runtime-tests.log`, `close-tests-retest.log`, and `controller-tests.log`. No worker or integration branch was changed during this recheck.

## Local integration accepted

The orchestrator combined B05, B06, and B07, applied the close/startup/restore/expiry hooks, and aligned the two existing close assertions with the documented `closing` state. Three existing GPT-6.1 xhigh chats handled runtime verification, maintained workflow coverage, and CLI reference wiring. Their accepted commits are `f6b96921b65f20ea8de3a0bebbfb3054b7e10e31`, `ad325a360383f4d0266307cc6f76c2d6940627ed`, and `2ea139018bfea323c48e7b548c6d83d109e1da39`, respectively.

The final application verification used these implementation commits on `codex/forge-v2-integration`. Later documentation commits only record the result and handoff.

| Repository | Accepted implementation |
|---|---|
| Backend | `11d26b4e756f322fad2ea3a33c64289742cb54b3` |
| Runtime | `f6b96921b65f20ea8de3a0bebbfb3054b7e10e31` |
| CLI | `2ea139018bfea323c48e7b548c6d83d109e1da39` |

All 49 runtime cases pass, including rejected second-daemon startup, recovery after a real process crash, and the new expiry case that saves changed workspace bytes while retaining the prior checkpoint. Five native host CPU fixture checks also pass. The full CLI suite passes 534 cases; both npm and GitHub installation checks exercise every Forge reference and the bundled examples. Shared/core references and managed-tool reads retain their existing behavior.

The maintained acceptance flow reuses the backend's disposable PostgreSQL/Redis fixtures and the daemon's real SQLite journal. The installed CLI calls the real public proxy and signed backend routes. Its workflow covers all three input sources, checkpoint versions, deletion, post-close download, source/destination authorization, and restore. Separate slow-pull and storage-failure cases inspect persistence and saved file bytes at provider DELETE, then verify resource release and the billing cutoff. The final orchestrator run passes all three scenarios, including the nested CLI/Vitest workflow. The worker also passed eleven existing backend Forge cases and checked that ordinary test runs skip the opt-in flow.

The harness substitutes cloud/provider/tunnel/bootstrap, object transfer, API-key lookup, rate limits, email delivery, and Docker boundaries. CPU command execution uses local child processes. These results establish application behavior under those substitutions. The image and live GPU gates retain their pending status.

### Proxy error found during integration

A mismatched signing identity in the first harness setup produced a real backend error with a string-valued `error` field. The Forge proxy assumed an object and applied the `in` operator, raising `TypeError` and converting the denial into public status 500. The orchestrator reproduced this through the public sessions route before changing production code.

Backend commit `2a57bf8` checks the error value's type before reading structured Forge fields. Plain backend errors now use the existing sanitized status mapping. One regression in the existing compute-service test file requires the public route to return the backend's 403 with a safe `forbidden` message. The original code failed that case; the corrected code passes all 39 relevant frontend checks and focused ESLint. The completed joined workflow also passes with this fix included.

The maintained new cases protect distinct gaps: expiry must save output changed since a previous checkpoint; installed guide discovery must expose usable bundled files; joined operations must preserve data and release billing resources across the real application layers; backend error shapes must retain their public status. No test framework or production dependency was added.

### Evidence and repeatable run

Use the [maintained run instructions](/Users/aaronring/.codex/worktrees/forge-v2-integration/Ariax-Bio-Backend/docs/forge-joined-acceptance.md). They take explicit runtime and installed-CLI paths and fail when an enabled run lacks its prerequisites. The stable reviewed CLI executable is `/private/tmp/forge-integration-cli-package/prefix/lib/node_modules/ariax-cli/bin/ariax.js`; the local archive is `/private/tmp/forge-integration-cli-package/review/ariax-cli-0.1.2.tgz`.

The final manifest is `/private/tmp/forge-integration-final-manifest.json`. Runtime logs are in `/private/tmp/forge-runtime-acceptance-yp4kgdlb/`. The orchestrator's final workflow log is `/private/tmp/forge-integration-joined-final.log`, with its CLI transcript beneath the output directory recorded in the manifest. Proxy reproduction and corrected results are `/private/tmp/forge-integration-proxy-regression-before.log` and `forge-integration-proxy-regression-after.log`; focused lint is `forge-integration-proxy-lint.log` in the same temporary directory.

The orchestrator's first final-workflow invocation stopped at environment setup because its reused Python environment lacked the Docker SDK. A temporary dependency directory supplied the existing runtime requirement and compatible boto3/botocore versions; no repository dependency manifest changed. The successful run uses that prepared environment. Local frontend verification used the existing dependencies and an equivalent temporary Vitest configuration because the installed Node/Vite combination could not load the repository's older configuration directly. The maintained joined configuration already uses the working ESM loader path.

## Next work

Follow the [B08 handoff](forge-next-turn-plan.md): prepare the three Linux amd64 images on a working Docker builder and run their native CPU checks. Publish the complete named Boltz2 asset and accepted images, then set the actual catalog location through the existing deployment path. The concrete campaign records its deployment/migration target and cost bound before allocation.

The bounded Hyperstack campaign runs base during science preparation, inspects real Boltz2 GPU output, and proves checkpoint/download/restore with verified VM/tunnel cleanup. Source and restore sessions run sequentially. B09 design recipes and B10 Vast full-VM work follow that gate.
